package app.wayfinder.car.map

import app.wayfinder.car.FakeCarApi
import app.wayfinder.car.Samples
import org.junit.Assert.assertEquals
import org.junit.Test

class MapStylesTest {
  private val api = FakeCarApi()
  private val applied = mutableListOf<Pair<String?, String?>>()
  private val styles = MapStyles(api) { light, dark -> applied += light to dark }

  @Test fun asksOnceAndUsesTheAnswer() {
    styles.ensure()
    styles.ensure() // the driving screen showing while the first ask is out
    assertEquals(listOf("status"), api.calls)
    api.answer("status", Samples.status())
    assertEquals(listOf(Samples.status().styleLight to Samples.status().styleDark), applied)
    styles.ensure()
    assertEquals("known now: not asked again", 1, api.calls.size)
  }

  @Test fun asksAgainNextTimeAfterAFailure() {
    styles.ensure()
    api.fail("status", "Wayfinder on your phone isn’t answering.")
    styles.ensure()
    assertEquals(listOf("status", "status"), api.calls)
  }

  @Test fun homesOwnStatusCountsToo() {
    styles.use(Samples.status())
    styles.ensure()
    assertEquals(emptyList<String>(), api.calls)
    assertEquals(1, applied.size)
  }

  @Test fun noServerAddressIsNoStyleYet() {
    styles.use(Samples.status().copy(styleLight = null, styleDark = null))
    assertEquals(emptyList<Pair<String?, String?>>(), applied)
    styles.ensure()
    assertEquals(listOf("status"), api.calls)
  }
}
