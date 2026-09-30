package app.wayfinder.car.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarBridgeTest {
  private val later = mutableListOf<Runnable>()
  private val bridge = CarBridge(post = { it.run() }, postDelayed = { r, _ -> later += r })
  private val sent = mutableListOf<String>()

  @Test fun holdsRequestsUntilJavaScriptIsListening() {
    var answer: Result<JSONObject>? = null
    bridge.call("status", JSONObject()) { answer = it }
    bridge.connect { id, method, params -> sent += "$id $method $params" }
    assertEquals(listOf("c0 status {}"), sent)
    bridge.resolve("c0", """{"account":"signedIn"}""")
    assertEquals("signedIn", answer!!.getOrThrow().getString("account"))
  }

  @Test fun passesOnWhatJavaScriptCouldNotDo() {
    bridge.connect { _, _, _ -> }
    var answer: Result<JSONObject>? = null
    bridge.call("search", JSONObject().put("q", "coot")) { answer = it }
    bridge.reject("c0", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", answer!!.exceptionOrNull()!!.message)
  }

  @Test fun givesUpWhenNoAnswerComesAndIgnoresALateOne() {
    var answers = 0
    var last: Result<JSONObject>? = null
    bridge.call("status", JSONObject()) { answers++; last = it }
    later.single().run()
    bridge.connect { id, _, _ -> sent += id }
    bridge.resolve("c0", "{}")
    assertEquals(1, answers)
    assertTrue(last!!.exceptionOrNull() is CarBridgeTimeout)
    assertTrue("a timed-out request isn't sent later", sent.isEmpty())
  }

  @Test fun tellsScreensAboutNavigation() {
    val seen = mutableListOf<String?>()
    val off = bridge.onNavigation { seen += it?.getString("routeId") }
    bridge.setNavigation("""{"routeId":"r1"}""")
    bridge.setNavigation(null)
    off()
    bridge.setNavigation("""{"routeId":"r2"}""")
    assertEquals(listOf("r1", null), seen)
    assertEquals("r2", bridge.navigation!!.getString("routeId"))
  }

  @Test fun treatsUnreadableNavigationAsNone() {
    bridge.setNavigation("not json")
    assertNull(bridge.navigation)
  }
}
