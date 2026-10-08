package app.wayfinder.car.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

fun fixture(name: String): JSONObject =
  JSONObject(ProtocolTest::class.java.classLoader!!.getResource("fixtures/$name")!!.readText())

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProtocolTest {
  @Test fun status() {
    val s = Protocol.status(fixture("status.json"))
    assertEquals(Account.SIGNED_IN, s.account)
    assertEquals("https://maps.example.test/map/style.json?theme=dark", s.styleDark)
    assertEquals(LngLat(153.0251, -27.4698), s.here)
  }

  @Test fun places() {
    val p = Protocol.places(fixture("places.json"))
    assertEquals(listOf("Mt Coot-tha Lookout", "Queen Street Mall"), p.map { it.name })
    assertEquals(6200.0, p[0].distanceM!!, 0.0)
    assertNull(p[1].distanceM)
  }

  @Test fun plan() {
    val p = Protocol.plan(fixture("plan.json"))
    assertEquals(listOf("r-fast", "r-exp"), p.options.map { it.routeId })
    assertEquals(3, p.options[1].geometry.size)
    assertNull(p.note)
  }

  @Test fun planned() = assertEquals("r-sun", Protocol.planned(fixture("planned.json")).single().option.routeId)

  @Test fun routeLine() = assertEquals(LngLat(152.957, -27.4846), Protocol.line(fixture("route-line.json").getJSONArray("geometry")).last())

  @Test fun navigating() {
    val n = Protocol.nav(fixture("nav-navigating.json"))
    assertEquals(NavStatus.NAVIGATING, n.status)
    assertEquals(CarManeuver("roundabout", 2, 175), n.maneuver)
    assertEquals(NextStep(CarManeuver("left", null), "Turn left"), n.next)
    assertEquals(1790000000000L, n.arrivalEpochMs)
    assertEquals(60, n.speedLimitKmh)
    assertEquals(57, n.speedKmh)
  }

  @Test fun arrived() {
    val n = Protocol.nav(fixture("nav-arrived.json"))
    assertEquals(NavStatus.ARRIVED, n.status)
    assertNull(n.destinationName)
    assertNull(n.position)
    assertNull(n.distanceToManeuverM)
    assertNull(n.speedLimitKmh)
    assertNull(n.speedKmh)
  }

  /** A phone app one version behind sends none of the newer fields; the car still reads the rest. */
  @Test fun navigatingFromAnOlderPhoneApp() {
    val o = fixture("nav-navigating.json").apply { remove("speedLimitKmh"); remove("speedKmh"); getJSONObject("maneuver").remove("exitAngleDeg") }
    val n = Protocol.nav(o)
    assertEquals(CarManeuver("roundabout", 2, null), n.maneuver)
    assertNull(n.speedLimitKmh)
  }
}
