package app.wayfinder.car.bridge

import org.junit.Assert.assertEquals
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
}
