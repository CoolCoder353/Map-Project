package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Test

class TripTrailTest {
  @Test fun keepsAPointEveryTenMetresOrSo() {
    val t = TripTrail()
    t.add(LngLat(153.0, -27.4))
    t.add(LngLat(153.00001, -27.4)) // about a metre: not worth a point
    t.add(null) // no fix
    t.add(LngLat(153.0002, -27.4)) // about 20 m
    assertEquals(listOf(LngLat(153.0, -27.4), LngLat(153.0002, -27.4)), t.points)
    t.clear()
    assertEquals(emptyList<LngLat>(), t.points)
  }

  @Test fun measuresDistanceOnTheGround() =
    assertEquals(111_195.0, TripTrail.metres(LngLat(153.0, -27.0), LngLat(153.0, -28.0)), 50.0)
}
