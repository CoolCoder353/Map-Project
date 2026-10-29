package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/** A drawing as GeoJSON for the car map's sources. Needs no map, so it is tested apart from the renderer. */
object MapFeatures {
  /** The property naming a marker's image (see [MapPins]). */
  const val IMAGE = "image"

  fun lines(ls: List<List<LngLat>>): FeatureCollection =
    FeatureCollection.fromFeatures(ls.filter { it.size >= 2 }.map { l -> Feature.fromGeometry(LineString.fromLngLats(l.map { point(it) })) })

  fun points(ps: List<LngLat>): FeatureCollection = FeatureCollection.fromFeatures(ps.map { Feature.fromGeometry(point(it)) })

  /** The numbered pins, then the destination on top, each naming its image. */
  fun markers(d: SceneDrawing): FeatureCollection =
    FeatureCollection.fromFeatures(d.pins.map { marker(it.at, MapPins.numbered(it.label)) } + listOfNotNull(d.destination?.let { marker(it, MapPins.DESTINATION) }))

  private fun marker(at: LngLat, image: String): Feature = Feature.fromGeometry(point(at)).also { it.addStringProperty(IMAGE, image) }

  private fun point(p: LngLat): Point = Point.fromLngLat(p.lon, p.lat)
}
