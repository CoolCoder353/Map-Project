package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MapPinsTest {
  private val here = LngLat(153.0, -27.4)

  @Test fun aDrawingAsksForEachImageItShowsOnce() {
    val d = SceneDrawing(emptyList(), emptyList(), listOf(Pin(here, "1"), Pin(here, "2")), null, destination = here)
    assertEquals(setOf("wf-pin-1", "wf-pin-2", MapPins.DESTINATION), MapPins.imagesFor(d))
    assertEquals(emptySet<String>(), MapPins.imagesFor(SceneDrawing(emptyList(), emptyList(), emptyList(), here)))
  }

  /** Each image is drawn once, the first time the map needs it, not on every fix. */
  @Test fun onlyImagesTheMapHasntGotAreDrawn() {
    val d = SceneDrawing(emptyList(), emptyList(), listOf(Pin(here, "1")), null, destination = here)
    assertEquals(listOf("wf-pin-1", MapPins.DESTINATION), MapPins.missing(d) { null })
    assertEquals(listOf(MapPins.DESTINATION), MapPins.missing(d) { name -> if (name == "wf-pin-1") Unit else null })
  }

  /** Drawn for the car screen's density, and marked with it, so the map shows them at their size in dp. */
  @Test fun mapImagesAreSizedForTheCarScreen() {
    val badge = MapPins.image(MapPins.numbered("3"), 320)
    assertEquals(52, badge.width)
    assertEquals(52, badge.height)
    assertEquals(320, badge.density)
    val flag = MapPins.image(MapPins.DESTINATION, 160)
    assertEquals(34, flag.width)
    assertEquals("the pin's point is the image's centre", 68, flag.height)
  }

  @Test fun aRowsBadgeIsTheSameDrawingAtTheRowsSize() {
    val row = MapPins.badge("2", MapPins.ROW_PX)
    assertEquals(MapPins.ROW_PX, row.width)
    assertEquals(MapPins.ROW_PX, row.height)
  }
}
