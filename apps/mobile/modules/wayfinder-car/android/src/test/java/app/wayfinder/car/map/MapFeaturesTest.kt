package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Test
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

class MapFeaturesTest {
  private val here = LngLat(153.0, -27.4)
  private val there = LngLat(152.957, -27.4846)

  @Test fun markersNameTheirImagesWithTheDestinationOnTop() {
    val d = SceneDrawing(emptyList(), emptyList(), listOf(Pin(here, "1"), Pin(there, "2")), null, destination = there)
    val features = MapFeatures.markers(d).features()!!
    assertEquals(listOf("wf-pin-1", "wf-pin-2", MapPins.DESTINATION), features.map { it.getStringProperty(MapFeatures.IMAGE) })
    // [lon, lat] all the way to the map.
    val first = features[0].geometry() as Point
    assertEquals(153.0, first.longitude(), 0.0)
    assertEquals(-27.4, first.latitude(), 0.0)
  }

  @Test fun noMarkersWithNothingToMark() =
    assertEquals(0, MapFeatures.markers(SceneDrawing(emptyList(), emptyList(), emptyList(), here)).features()!!.size)

  @Test fun onlyLinesThatAreLinesAreDrawn() {
    val features = MapFeatures.lines(listOf(listOf(here, there), listOf(here), emptyList())).features()!!
    assertEquals(1, features.size)
    assertEquals(2, (features[0].geometry() as LineString).coordinates().size)
  }

  @Test fun pointsAreDrawnWhereTheyAre() =
    assertEquals(listOf(152.957), MapFeatures.points(listOf(there)).features()!!.map { (it.geometry() as Point).longitude() })
}
