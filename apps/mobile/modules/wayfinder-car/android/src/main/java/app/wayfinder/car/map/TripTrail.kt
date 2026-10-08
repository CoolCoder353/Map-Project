package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The road a trip has driven, kept on the car side for the car map: after a reroute the route line
 * starts where the car is, so without this the stretch already driven (off the old route, say)
 * would vanish from the map.
 */
class TripTrail(private val stepM: Double = 10.0) {
  private val line = mutableListOf<LngLat>()
  val points: List<LngLat> get() = line.toList()

  /** Adds where the car is now, if it has moved [stepM] since the last point. */
  fun add(p: LngLat?) {
    if (p == null) return
    val last = line.lastOrNull()
    if (last == null || metres(last, p) >= stepM) line += p
  }

  fun clear() = line.clear()

  companion object {
    fun metres(a: LngLat, b: LngLat): Double {
      val r = 6_371_008.8
      val dLat = Math.toRadians(b.lat - a.lat)
      val dLon = Math.toRadians(b.lon - a.lon)
      val h = sin(dLat / 2).pow(2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).pow(2)
      return 2 * r * asin(sqrt(h))
    }
  }
}
