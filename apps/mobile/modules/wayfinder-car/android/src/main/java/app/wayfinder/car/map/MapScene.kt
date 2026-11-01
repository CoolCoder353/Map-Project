package app.wayfinder.car.map

import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.bridge.RouteLight
import app.wayfinder.car.bridge.RouteOption

/** What the car map should be showing; each screen says which. */
sealed interface MapScene {
  data class Overview(val here: LngLat?) : MapScene
  /** Numbered on the map as in the list beside it. */
  data class Places(val places: List<CarPlace>) : MapScene
  /** [selected] is the one drawn as chosen, or [NONE] for a list to pick from, numbered as its rows. */
  data class Routes(val options: List<RouteOption>, val selected: Int) : MapScene {
    companion object {
      const val NONE = -1
    }
  }
  /** Driving: the route ahead, the road already driven ([travelled], off the route too), and the speeds to show. */
  data class Following(
    val line: List<LngLat>,
    val position: LngLat?,
    val headingDeg: Double?,
    val travelled: List<LngLat> = emptyList(),
    val speedLimitKmh: Int? = null,
    val speedKmh: Int? = null,
    /** [speedLimitKmh] is the legal default for the road, not a mapped sign. */
    val speedLimitEstimated: Boolean = false,
    /** Lights ahead, red where the car will likely have to stop. */
    val lights: List<RouteLight> = emptyList(),
  ) : MapScene
}

fun interface MapScenes {
  fun show(scene: MapScene)
}
