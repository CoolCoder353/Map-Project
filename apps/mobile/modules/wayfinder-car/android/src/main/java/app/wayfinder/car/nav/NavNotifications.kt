package app.wayfinder.car.nav

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
 * Tapping it in the car brings Wayfinder's car app forward: the car can only send a broadcast, so
 * a receiver registered while the car session lives turns that into `startCarApp`.
 */
class NavNotifications(private val carContext: CarContext, private val icons: ManeuverIcons) {
  private val manager get() = NotificationManagerCompat.from(carContext)
  private var lastTitle: String? = null
  private var lastText: String? = null
  private var receiver: BroadcastReceiver? = null

  /** Posts the notification, or updates it. Quiet unless the instruction changed since the last post. */
  fun update(nav: CarNav) {
    val title = titleOf(nav)
    // How far to the instruction changes with every fix; it is the quiet part of an update.
    val ahead = if (nav.status == NavStatus.NAVIGATING && nav.maneuver != null && !nav.rerouting && nav.error == null) nav.distanceToManeuverM?.let(::distanceText) else null
    val text = listOfNotNull(ahead, nav.destinationName?.let { "To $it" }).joinToString(" · ")
    if (title == lastTitle && text == lastText) return // a fix that changed nothing the car shows
    val changed = title != lastTitle
    lastTitle = title
    lastText = text
    ensureChannel()
    register()
    val openApp = PendingIntent.getBroadcast(
      carContext, 0, Intent(ACTION_OPEN_APP).setPackage(carContext.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val small = icons.resFor(nav.maneuver?.type ?: "straight")
    val notification = NotificationCompat.Builder(carContext, CHANNEL_ID)
      .setSmallIcon(small)
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(openApp)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
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
    nav.error != null -> nav.error
    nav.status == NavStatus.OFF_ROUTE -> "Off route"
    else -> nav.cue.ifEmpty { "Continue" }
  }

  private fun ensureChannel() {
    manager.createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
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
        carContext.startCarApp(Intent(Intent.ACTION_VIEW).setComponent(ComponentName(carContext, WayfinderCarAppService::class.java)))
      }
    }
    ContextCompat.registerReceiver(carContext, r, IntentFilter(ACTION_OPEN_APP), ContextCompat.RECEIVER_NOT_EXPORTED)
    receiver = r
  }

  companion object {
    const val ID = 4201
    const val CHANNEL_ID = "wayfinder_navigation"
    const val ACTION_OPEN_APP = "app.wayfinder.car.action.OPEN_APP"
  }
}
