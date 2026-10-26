package app.wayfinder.car.bridge

import app.wayfinder.car.Samples
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BridgeCarApiTest {
  private val bridge = CarBridge(post = { it.run() }, postDelayed = { _, _ -> }).also { it.connect { _, _, _ -> } }
  private val api = BridgeCarApi(bridge)

  private fun statusAfter(answer: CarBridge.() -> Unit): String? {
    var r: Result<CarStatus>? = null
    api.status { r = it }
    bridge.answer()
    return r!!.exceptionOrNull()?.message
  }

  @Test fun asksForAnUpdateWhenThePhoneSendsSomethingItCantRead() {
    val update = "When it’s safe, update Wayfinder on your phone, then try again."
    assertEquals("missing fields", update, statusAfter { resolve("c0", "{}") })
    assertEquals("not JSON at all", update, statusAfter { resolve("c1", "not json") })
  }

  @Test fun passesOnWhatThePhoneSaid() {
    assertEquals("Can’t reach your server.", statusAfter { reject("c0", "Can’t reach your server.") })
  }

  @Test fun asksThePhoneToStartATestDrive() {
    val sent = mutableListOf<String>()
    val b = CarBridge(post = { it.run() }, postDelayed = { _, _ -> }).also { it.connect { id, method, _ -> sent += "$id $method" } }
    var r: Result<Unit>? = null
    BridgeCarApi(b).simulate { r = it }
    assertEquals(listOf("c0 simulate"), sent)
    b.resolve("c0", "{}")
    assertEquals(true, r!!.isSuccess)
  }

  @Test fun sendsEachRequestToThePhoneWithItsDetails() {
    val sent = mutableListOf<String>()
    val b = CarBridge(post = { it.run() }, postDelayed = { _, _ -> }).also { it.connect { _, method, params -> sent += "$method $params" } }
    val phone = BridgeCarApi(b)
    phone.search("coot") { }
    phone.discover { }
    phone.plan(Samples.place()) { }
    phone.planned { }
    phone.routeLine("r-fast") { }
    phone.start("r-fast", "Mt Coot-tha Lookout") { }
    phone.stop()
    phone.setMuted(true)
    phone.report { }
    phone.location(CarFix(153.05, -27.45, 4.0, 13.5, 90.0, 1790000000000L))
    assertEquals(
      listOf(
        """search {"q":"coot"}""",
        "discover {}",
        """plan {"to":[152.957,-27.4846]}""",
        "planned {}",
        """routeLine {"routeId":"r-fast"}""",
        """start {"routeId":"r-fast","destinationName":"Mt Coot-tha Lookout"}""",
        "stop {}",
        """mute {"muted":true}""",
        "report {}",
        """location {"lon":153.05,"lat":-27.45,"accuracyM":4,"speedMps":13.5,"headingDeg":90,"timeMs":1790000000000}""",
      ),
      sent,
    )
  }

  @Test fun readsPlacesAndRouteLinesFromTheAnswers() {
    var places: Result<List<CarPlace>>? = null
    var line: Result<List<LngLat>>? = null
    api.search("coot") { places = it }
    api.routeLine("r-fast") { line = it }
    bridge.resolve("c0", fixture("places.json").toString())
    bridge.resolve("c1", fixture("route-line.json").toString())
    assertEquals("Mt Coot-tha Lookout", places!!.getOrThrow().first().name)
    assertEquals(LngLat(152.957, -27.4846), line!!.getOrThrow().last())
  }

  @Test fun givesNavigationOnlyWhenItCanBeRead() {
    var seen: CarNav? = null
    api.onNavigation { seen = it }
    bridge.setNavigation(fixture("nav-navigating.json").toString())
    assertEquals(NavStatus.NAVIGATING, seen!!.status)
    assertEquals(NavStatus.NAVIGATING, api.navigation!!.status)
    seen = null
    bridge.setNavigation("{}")
    assertNull(seen)
    assertNull(api.navigation)
  }
}
