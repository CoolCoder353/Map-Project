package app.wayfinder.car.map

import android.app.Presentation
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import app.wayfinder.car.bridge.LngLat
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/**
 * The map on the car screen: MapLibre (the phone map's engine) in a Presentation on a virtual
 * display that draws into the car's surface. Uses the server's own style, dark at night.
 */
class CarMapRenderer(private val carContext: CarContext) : SurfaceCallback, MapScenes {
  private var display: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var map: MapLibreMap? = null
  private var styles: Pair<String?, String?> = null to null
  private val styleLoads = StyleLoads()
  private var scene: MapScene = MapScene.Overview(null)
  private var surfaceSize = Rect()
  private var visible = Rect()

  override fun onSurfaceAvailable(container: SurfaceContainer) {
    // A new surface replaces any earlier one; drop that map rather than leak it.
    release()
    val surface = container.surface ?: return
    MapLibre.getInstance(carContext)
    // No display means no map, but must not crash: the phone's navigation runs in this process.
    val vd = carContext.getSystemService(DisplayManager::class.java).createVirtualDisplay(
      "wayfinder-car-map", container.width, container.height, container.dpi, surface, DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY,
    ) ?: return
    val p = Presentation(carContext, vd.display)
    val view = MapView(p.context)
    view.onCreate(null)
    view.addOnDidFailLoadingMapListener { styleLoads.failed() }
    p.setContentView(view)
    p.show()
    view.onStart()
    view.onResume()
    display = vd
    presentation = p
    mapView = view
    view.getMapAsync { m ->
      if (mapView !== view) return@getMapAsync // released before it was ready
      map = m
      m.uiSettings.isLogoEnabled = false // OSM attribution stays on
      styleLoads.reset()
      refreshStyle()
    }
    surfaceSize = Rect(0, 0, container.width, container.height)
    if (visible.isEmpty) visible = Rect(surfaceSize)
  }

  override fun onVisibleAreaChanged(visibleArea: Rect) {
    visible = visibleArea
    applyCamera()
  }

  override fun onStableAreaChanged(stableArea: Rect) {}

  override fun onSurfaceDestroyed(container: SurfaceContainer) = release()

  fun setStyles(light: String?, dark: String?) {
    styles = light to dark
    refreshStyle()
  }

  /** Also called when the car switches between day and night, and to retry a style that failed. */
  fun refreshStyle() {
    val m = map ?: return
    val url = styleLoads.next(if (carContext.isDarkMode) styles.second else styles.first) ?: return
    m.setStyle(Style.Builder().fromUri(url)) { style ->
      addLayers(style)
      applyScene()
    }
  }

  override fun show(scene: MapScene) {
    this.scene = scene
    refreshStyle() // loads the style if an earlier try failed; otherwise nothing to do
    applyScene()
  }

  fun release() {
    mapView?.run { onPause(); onStop(); onDestroy() }
    presentation?.dismiss()
    display?.release()
    mapView = null
    presentation = null
    display = null
    map = null
    styleLoads.reset()
  }

  private fun addLayers(style: Style) {
    style.addSource(GeoJsonSource(OTHERS))
    style.addSource(GeoJsonSource(SELECTED))
    style.addSource(GeoJsonSource(POINTS))
    style.addSource(GeoJsonSource(POSITION))
    style.addLayer(LineLayer(OTHERS, OTHERS).withProperties(lineColor(GREY), lineWidth(6f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(LineLayer(SELECTED, SELECTED).withProperties(lineColor(ACCENT), lineWidth(8f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(CircleLayer(POINTS, POINTS).withProperties(circleColor(ACCENT), circleRadius(7f), circleStrokeColor(WHITE), circleStrokeWidth(2f)))
    style.addLayer(CircleLayer(POSITION, POSITION).withProperties(circleColor(ACCENT), circleRadius(10f), circleStrokeColor(WHITE), circleStrokeWidth(3f)))
  }

  private fun applyScene() {
    val style = map?.style?.takeIf { it.isFullyLoaded } ?: return
    val d = SceneLayout.drawing(scene)
    style.getSourceAs<GeoJsonSource>(SELECTED)?.setGeoJson(lines(listOf(d.selected)))
    style.getSourceAs<GeoJsonSource>(OTHERS)?.setGeoJson(lines(d.others))
    style.getSourceAs<GeoJsonSource>(POINTS)?.setGeoJson(points(d.points))
    style.getSourceAs<GeoJsonSource>(POSITION)?.setGeoJson(points(listOfNotNull(d.position)))
    applyCamera()
  }

  private fun applyCamera() {
    val m = map ?: return
    if (visible.isEmpty) return
    val left = visible.left.toDouble()
    val top = visible.top.toDouble()
    val right = (surfaceSize.width() - visible.right).toDouble().coerceAtLeast(0.0)
    val bottom = (surfaceSize.height() - visible.bottom).toDouble().coerceAtLeast(0.0)
    when (val spec = SceneLayout.camera(scene)) {
      is CameraSpec.Follow -> m.easeCamera(
        CameraUpdateFactory.newCameraPosition(
          CameraPosition.Builder()
            .target(spec.target.latLng())
            .zoom(16.0)
            .tilt(45.0)
            .apply { spec.bearing?.let { bearing(it) } }
            // Keep the car low in the view so more of the road ahead shows.
            .padding(left, top + visible.height() * 0.4, right, bottom)
            .build(),
        ),
        900,
      )
      is CameraSpec.Fit -> {
        val distinct = spec.points.distinct()
        if (distinct.size == 1) {
          m.easeCamera(CameraUpdateFactory.newLatLngZoom(distinct[0].latLng(), 15.0), 600)
        } else {
          val bounds = LatLngBounds.Builder().includes(distinct.map { it.latLng() }).build()
          m.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, (left + 40).toInt(), (top + 40).toInt(), (right + 40).toInt(), (bottom + 40).toInt()), 600)
        }
      }
      is CameraSpec.Center -> m.moveCamera(CameraUpdateFactory.newLatLngZoom(spec.target.latLng(), spec.zoom))
      CameraSpec.Keep -> Unit
    }
  }

  private fun lines(ls: List<List<LngLat>>) =
    FeatureCollection.fromFeatures(ls.filter { it.size >= 2 }.map { l -> Feature.fromGeometry(LineString.fromLngLats(l.map { Point.fromLngLat(it.lon, it.lat) })) })

  private fun points(ps: List<LngLat>) = FeatureCollection.fromFeatures(ps.map { Feature.fromGeometry(Point.fromLngLat(it.lon, it.lat)) })

  private fun LngLat.latLng() = LatLng(lat, lon)

  private companion object {
    const val SELECTED = "wf-route-selected"
    const val OTHERS = "wf-route-others"
    const val POINTS = "wf-places"
    const val POSITION = "wf-position"
    // The phone's accent (src/lib/theme.ts) and a quiet grey for the routes not chosen.
    const val ACCENT = "#1765cc"
    const val GREY = "#8a94a6"
    const val WHITE = "#ffffff"
  }
}
