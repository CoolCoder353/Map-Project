package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CarColoursTest {
  /** At night the route's edge is dark, not a bright band on a dark map (C70). */
  @Test fun nightColoursSuitADarkMap() {
    assertEquals(CarColours.NIGHT, CarColours.of(dark = true))
    assertEquals(CarColours.DAY, CarColours.of(dark = false))
    assertNotEquals(CarColours.DAY.casing, CarColours.NIGHT.casing)
  }

  /** The road already driven is the route's blue faded, not a purple line of its own (C17). */
  @Test fun theRoadDrivenIsTheRoutesColourFaded() {
    assertTrue(CarColours.DAY.travelled.startsWith("#8fb3"))
  }

  /** Buildings, place dots and lights are left off while driving, kept while browsing (C18, C92). */
  @Test fun clutterIsHiddenOnlyWhileDriving() {
    assertTrue(CarMapLayers.hidden(MapScene.Following(emptyList(), LngLat(153.0, -27.4), null)))
    assertFalse(CarMapLayers.hidden(MapScene.Overview(null)))
    assertTrue(CarMapLayers.CLUTTER.containsAll(listOf("building", "poi", "traffic-signals")))
  }
}
