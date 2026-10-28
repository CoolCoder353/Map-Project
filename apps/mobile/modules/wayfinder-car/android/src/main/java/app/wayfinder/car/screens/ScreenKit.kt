package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Row
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.map.MapPins
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Android Auto shows at most about six rows while driving; lists never offer more. */
const val MAX_ROWS = 6

fun appName(carContext: CarContext): String =
  carContext.applicationInfo.loadLabel(carContext.packageManager).toString()

/**
 * One of the module's icons (Material Symbols, white), for a row or a message. The car tints it to
 * suit its screen, day or night, rather than it staying white on a light one.
 */
fun carIcon(carContext: CarContext, res: Int): CarIcon =
  CarIcon.Builder(IconCompat.createWithResource(carContext, res)).setTint(CarColor.DEFAULT).build()

private val badges = HashMap<Int, CarIcon>()

/**
 * Row [n]'s numbered badge: the same as its marker on the car map ([MapPins]), so the driver can
 * match "2" in the list to "2" on the map. Not tinted: it keeps the route line's blue.
 */
fun numberIcon(n: Int): CarIcon =
  badges.getOrPut(n) { CarIcon.Builder(IconCompat.createWithBitmap(MapPins.badge(n.toString(), MapPins.ROW_PX))).build() }

/**
 * A tappable row, with an [icon] to tell it apart at a glance. Places lists
 * (PlaceListNavigationTemplate) insist every row is either a place with a distance or a browsable
 * one that opens something else, so rows that open another screen pass `browsable = true`.
 */
fun row(title: String, detail: String? = null, browsable: Boolean = false, icon: CarIcon? = null, onClick: () -> Unit): Row =
  Row.Builder().setTitle(title).apply {
    if (!detail.isNullOrEmpty()) addText(detail)
    if (browsable) setBrowsable(true)
    icon?.let { setImage(it) }
  }.setOnClickListener(onClick).build()

fun Screen.whenCreated(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onCreate(owner: LifecycleOwner) = block()
  })

/** Runs each time the screen comes back to the top, e.g. after Back from the screen above. */
fun Screen.whenStarted(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) = block()
  })

/**
 * Puts [scene] on the car map, but only while this screen is on top. An answer that arrives after the
 * driver has moved on (a late search, plan or status) must not repaint the map under the screen that
 * took over; the screen shows it again when it is back on top (see [whenStarted]).
 */
fun Screen.show(map: MapScenes, scene: MapScene) {
  if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) map.show(scene)
}
