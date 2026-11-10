package app.wayfinder.car.nav

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.wayfinder.car.WayfinderCarAppService
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.NavStatus

/**
 * The navigation notification (NF-3): one ongoing notification while a trip runs, carrying the
 * next instruction, which the car shows in its notification area and, as a heads-up, each time
 * the instruction changes. Shaped as in developer.android.com/training/cars/apps/navigation:
 * ongoing, alert-once, category navigation, extended with [CarAppExtender].
 *
 * Tapping it in the car brings Wayfinder's car app forward, on its directions: the car can only send
 * a broadcast, so a receiver registered while the car session lives turns that into `startCarApp`
 * with the [DIRECTIONS] link, which the session answers by showing the driving screen. Without it
 * the app came forward on whatever screen it was last on (Search, say), not the directions tapped.
 */
class NavNotifications(
  private val carContext: CarContext,
  private val icons: ManeuverIcons,
  /** End, from the notification (P89). */
  private val onEnd: () -> Unit = {},
  /** Mute or unmute, from the notification (P89). */
  private val onMute: () -> Unit = {},
) {
  private val manager get() = NotificationManagerCompat.from(carContext)
  private var lastTitle: String? = null
  private var lastText: String? = null
  private var receiver: BroadcastReceiver? = null

  /**
   * Posts the notification, or updates it. A heads-up in the car only when the instruction changed
   * and [headsUp] allows: not while Wayfinder's own directions are on the car's screen, where the
   * card would only cover the same instruction (Google's guidance for navigation apps).
   */
  fun update(nav: CarNav, headsUp: Boolean = true) {
    val title = titleOf(nav)
    // How far to the instruction changes with every fix; it is the quiet part of an update.
    val ahead = if (nav.status == NavStatus.NAVIGATING && nav.maneuver != null && !nav.rerouting && nav.error == null) nav.distanceToManeuverM?.let(::distanceText) else null
    val detail = if (nav.status != NavStatus.ARRIVED && !nav.rerouting) nav.error?.let(::afterFirstSentence) else null
    val text = listOfNotNull(ahead, detail, nav.destinationName?.let { "To $it" }).joinToString(" · ")
    if (title == lastTitle && text == lastText) return // a fix that changed nothing the car shows
    // Not posted at all while Wayfinder's directions are on the car's screen: Android Auto showed
    // the first post as a heads-up card over them however low its importance (R2-C2). It goes up,
    // as a heads-up, once the driver switches to another app, which is when it is wanted.
    if (!headsUp && lastTitle == null) return
    val changed = title != lastTitle && headsUp
    lastTitle = title
    lastText = text
    ensureChannel()
    register()
    val openApp = PendingIntent.getBroadcast(
      carContext, 0, Intent(ACTION_OPEN_APP).setPackage(carContext.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val small = icons.resFor(nav.maneuver?.type ?: "straight")
    fun action(name: String) = PendingIntent.getBroadcast(
      carContext, name.hashCode(), Intent(name).setPackage(carContext.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val notification = NotificationCompat.Builder(carContext, CHANNEL_ID)
      .setSmallIcon(small)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(openApp)
      // Stop or quieten directions without opening the app (P89).
      .addAction(0, actionLabels(nav).first, action(ACTION_MUTE))
      .addAction(0, actionLabels(nav).second, action(ACTION_END))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      // The next turn is what's worth a glance at the lock screen; it says nothing private.
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .extend(
        CarAppExtender.Builder()
          .setContentTitle(title)
          .setContentText(text)
          .setSmallIcon(small)
          .setContentIntent(openApp)
          // A heads-up in the car only for a new instruction; otherwise the car's rail updates quietly.
          .setImportance(if (changed) NotificationManagerCompat.IMPORTANCE_HIGH else NotificationManagerCompat.IMPORTANCE_DEFAULT)
          .build(),
      )
      .build()
    // Without notification permission (Android 13 and up) Android drops it; the trip carries on.
    try {
      manager.notify(ID, notification)
    } catch (e: SecurityException) {
      // ignored: see above
    }
  }

  /** Takes the notification down and stops listening for taps. */
  fun cancel() {
    lastTitle = null
    lastText = null
    manager.cancel(ID)
    receiver?.let { runCatching { carContext.unregisterReceiver(it) } }
    receiver = null
  }

  private fun titleOf(nav: CarNav): String = when {
    nav.status == NavStatus.ARRIVED -> "You’ve arrived"
    nav.rerouting -> "Finding a new route…"
    nav.error != null -> firstSentence(nav.error)
    nav.status == NavStatus.OFF_ROUTE -> "Off route"
    else -> nav.cue.ifEmpty { "Continue" }
  }

  /**
   * On the phone the channel is low: the app's own turn banner is there, and a heads-up for every
   * turn hid it. The car's heads-up comes from [CarAppExtender.Builder.setImportance], not this.
   * The old high channel is removed: an app can't lower a channel it has already made.
   */
  private fun ensureChannel() {
    manager.deleteNotificationChannel(OLD_CHANNEL_ID)
    manager.createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName("Navigation directions")
        .setSound(null, null)
        .setVibrationEnabled(false)
        .build(),
    )
  }

  private fun register() {
    if (receiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          ACTION_END -> onEnd()
          ACTION_MUTE -> onMute()
          else -> carContext.startCarApp(Intent(Intent.ACTION_VIEW, DIRECTIONS).setComponent(ComponentName(carContext, WayfinderCarAppService::class.java)))
        }
      }
    }
    val filter = IntentFilter(ACTION_OPEN_APP).apply {
      addAction(ACTION_END)
      addAction(ACTION_MUTE)
    }
    ContextCompat.registerReceiver(carContext, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    receiver = r
  }

  companion object {
    const val ID = 4201
    const val CHANNEL_ID = "wayfinder_navigation_quiet"
    /** The first channel, high importance, which made a heads-up on the phone for every turn. */
    const val OLD_CHANNEL_ID = "wayfinder_navigation"
    const val ACTION_OPEN_APP = "app.wayfinder.car.action.OPEN_APP"
    const val ACTION_END = "app.wayfinder.car.action.END"
    const val ACTION_MUTE = "app.wayfinder.car.action.MUTE"

    /** The notification's buttons: mute (or unmute) and end, or done once arrived. */
    fun actionLabels(nav: CarNav): Pair<String, String> =
      (if (nav.muted) "Unmute" else "Mute") to (if (nav.status == NavStatus.ARRIVED) "Done" else "End")

    /** The link a tap on the notification opens the car app with: "show the directions". */
    val DIRECTIONS: Uri = Uri.fromParts("wayfinder", "directions", null)

    fun opensDirections(intent: Intent): Boolean = intent.data == DIRECTIONS

    /** "Couldn’t get a new route." from the phone's message: short enough for a title. */
    internal fun firstSentence(message: String): String {
      val end = message.indexOf(". ")
      return (if (end > 0) message.substring(0, end + 1) else message).take(TITLE_MAX)
    }

    internal fun afterFirstSentence(message: String): String? {
      val end = message.indexOf(". ")
      return if (end > 0) message.substring(end + 2).ifBlank { null } else null
    }

    private const val TITLE_MAX = 60
  }
}
