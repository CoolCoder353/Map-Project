package app.wayfinder.car.map

import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarStatus

/**
 * Which of the server's map styles the car map draws. Asked for as soon as the car connects and
 * again by whichever screen shows next until it's known: a trip already running when the car
 * connects puts the driving screen straight over Home, before Home asks, which left the map black.
 */
class MapStyles(private val api: CarApi, private val apply: (light: String?, dark: String?) -> Unit) {
  private var known = false
  private var asking = false

  fun ensure() {
    if (known || asking) return
    asking = true
    api.status { r ->
      asking = false
      r.getOrNull()?.let(::use)
    }
  }

  /** A status from anywhere (Home asks for its own) carries the styles too. */
  fun use(status: CarStatus) {
    if (status.styleLight == null && status.styleDark == null) return
    known = true
    apply(status.styleLight, status.styleDark)
  }
}
