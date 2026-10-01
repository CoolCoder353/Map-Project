package app.wayfinder.car.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StyleLoadsTest {
  private val light = "https://maps.example.test/map/style.json?theme=light"
  private val dark = "https://maps.example.test/map/style.json?theme=dark"

  @Test fun loadsEachStyleOnceUntilAnotherIsWanted() {
    val loads = StyleLoads()
    assertNull("no style known yet", loads.next(null))
    assertEquals(light, loads.next(light))
    assertNull("already loading or loaded", loads.next(light))
    assertEquals("night falls", dark, loads.next(dark))
  }

  @Test fun triesAgainAfterAFailedLoad() {
    val loads = StyleLoads()
    loads.next(light)
    loads.failed() // no signal when the car started
    assertEquals("the next chance loads it again", light, loads.next(light))
    assertNull(loads.next(light))
  }

  @Test fun startsAfreshWithANewMap() {
    val loads = StyleLoads()
    loads.next(light)
    loads.reset()
    assertEquals(light, loads.next(light))
  }
}
