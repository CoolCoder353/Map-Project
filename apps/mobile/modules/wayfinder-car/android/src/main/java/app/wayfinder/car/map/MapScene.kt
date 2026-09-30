package app.wayfinder.car.map

import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.bridge.RouteOption

/** What the car map should be showing; each screen says which. */
sealed interface MapScene {
  data class Overview(val here: LngLat?) : MapScene
  data class Places(val places: List<CarPlace>) : MapScene
  data class Routes(val options: List<RouteOption>, val selected: Int) : MapScene
  data class Following(val line: List<LngLat>, val position: LngLat?, val headingDeg: Double?) : MapScene
}

fun interface MapScenes {
  fun show(scene: MapScene)
}
