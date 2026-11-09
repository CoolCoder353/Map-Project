package app.wayfinder.car.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
    assertEquals(listOf("Home", "Work"), s.saved.map { it.name })
    assertEquals(24800.0, s.saved[0].distanceM!!, 0.0)
    assertNull(s.saved[1].distanceM)
    assertTrue(s.saved.all { it.saved })
    assertEquals(listOf(true, false), s.saved.map { it.home })
  }

  @Test fun statusFromAnOlderPhoneAppHasNoSavedPlaces() {
    val o = fixture("status.json").apply { remove("saved") }
    assertTrue(Protocol.status(o).saved.isEmpty())
  }

  @Test fun speedLimit() {
    assertEquals(CarSpeedLimit(60, false, "Panorama Drive"), Protocol.speedLimit(fixture("speed-limit.json")))
    assertEquals(CarSpeedLimit(null, false, null), Protocol.speedLimit(JSONObject("{\"kmh\":null,\"estimated\":false,\"road\":null}")))
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
    assertEquals(FollowingStep(CarManeuver("right", null), "Turn right onto Moggill Rd", "Moggill Rd", 900.0), n.following)
    assertEquals(1790000000000L, n.arrivalEpochMs)
    assertEquals(60, n.speedLimitKmh)
    assertTrue("a limit that is only the road's legal default", n.speedLimitEstimated)
    assertEquals(57, n.speedKmh)
    assertEquals(listOf(RouteLight(LngLat(152.985, -27.481), true), RouteLight(LngLat(152.98, -27.482), false)), n.lights)
  }

  @Test fun arrived() {
    val n = Protocol.nav(fixture("nav-arrived.json"))
    assertEquals(NavStatus.ARRIVED, n.status)
    assertNull(n.destinationName)
    assertNull(n.following)
    assertNull(n.position)
    assertNull(n.distanceToManeuverM)
    assertNull(n.speedLimitKmh)
    assertNull(n.speedKmh)
  }

  /** A phone app one version behind sends none of the newer fields; the car still reads the rest. */
  @Test fun navigatingFromAnOlderPhoneApp() {
    val o = fixture("nav-navigating.json").apply { remove("speedLimitKmh"); remove("speedLimitEstimated"); remove("speedKmh"); remove("lights"); getJSONObject("maneuver").remove("exitAngleDeg") }
    val n = Protocol.nav(o)
    assertEquals(CarManeuver("roundabout", 2, null), n.maneuver)
    assertNull(n.speedLimitKmh)
    assertFalse(n.speedLimitEstimated)
    assertEquals(emptyList<RouteLight>(), n.lights)
  }

  @Test fun statusKnowsSignedOutAndOffline() {
    fun account(name: String) = Protocol.status(JSONObject().put("account", name).put("styleUrl", JSONObject.NULL).put("searchHint", "").put("here", JSONObject.NULL)).account
    assertEquals(Account.OFFLINE, account("offline"))
    assertEquals(Account.SIGNED_OUT, account("signedOut"))
    assertEquals(Account.SIGNED_OUT, account("something new"))
  }

  @Test fun navigationStatesTheAppHasButTheCarDoesntKnowAreStarting() {
    fun status(name: String) = Protocol.nav(fixture("nav-navigating.json").put("status", name)).status
    assertEquals(NavStatus.OFF_ROUTE, status("offRoute"))
    assertEquals(NavStatus.STARTING, status("starting"))
    assertEquals(NavStatus.STARTING, status("something new"))
  }
}
