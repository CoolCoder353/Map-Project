package app.wayfinder.car.map

import android.app.Presentation
import android.graphics.Color
import android.graphics.Point as ScreenPoint
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.view.View
import android.widget.FrameLayout
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import app.wayfinder.car.bridge.LngLat
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdate
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
import kotlin.math.ln

/**
 * The map on the car screen: MapLibre (the phone map's engine) in a Presentation on a virtual
 * display that draws into the car's surface. Uses the server's own style, dark at night. While
 * driving, the car's position and the speed readout are views over the map (see CarOverlays.kt),
 * and the driver can zoom and drag it ([MapControls]).
 */
class CarMapRenderer(private val carContext: CarContext) : SurfaceCallback, MapScenes, MapControls {
  private var display: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var map: MapLibreMap? = null
  private var styles: Pair<String?, String?> = null to null
  private val styleLoads = StyleLoads()
  private var scene: MapScene = MapScene.Overview(null)
  private var surfaceSize = Rect()
  private var visible = Rect()
  private var puck: PuckView? = null
  private var speed: SpeedView? = null
  private val follow = FollowCamera()
  private val pannedListeners = LinkedHashSet<(Boolean) -> Unit>()

  override val panned: Boolean get() = follow.panned

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
    val puckView = PuckView(p.context, Color.parseColor(ACCENT)).apply { visibility = View.GONE }
    val speedView = SpeedView(p.context).apply { visibility = View.GONE }
    p.setContentView(
      FrameLayout(p.context).apply {
        addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        addView(puckView, FrameLayout.LayoutParams(puckView.sizePx, puckView.sizePx))
        addView(speedView, FrameLayout.LayoutParams(speedView.sizePx, speedView.heightPx))
      },
    )
    p.show()
    puck = puckView
    speed = speedView
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
    applyOverlays()
  }

  /** The driver dragging the map (in pan mode, or on a touch screen). */
  override fun onScroll(distanceX: Float, distanceY: Float) {
    val m = map ?: return
    if (scene is MapScene.Following && follow.pan()) {
      applyScene() // the car's marker goes onto the map, which no longer follows it
      pannedListeners.toList().forEach { it(true) }
    }
    m.scrollBy(-distanceX, -distanceY)
  }

  /** Pinching, or a double tap (which hosts send as a scale factor of 2 or less than 0). */
  override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
    val steps = if (scaleFactor <= 0f) 1.0 else ln(scaleFactor.toDouble()) / ln(2.0)
    if (scene is MapScene.Following && !follow.panned) zoomBy(steps)
    else map?.moveCamera(CameraUpdateFactory.zoomBy(steps, ScreenPoint(focusX.toInt(), focusY.toInt())))
  }

  override fun zoomBy(steps: Double) {
    val m = map ?: return
    if (scene is MapScene.Following && !follow.panned) {
      if (follow.zoomBy(steps)) applyCamera()
    } else {
      m.moveCamera(CameraUpdateFactory.zoomBy(steps))
    }
  }

  override fun recentre() {
    if (!follow.recentre()) return
    applyScene()
    pannedListeners.toList().forEach { it(false) }
  }

  override fun onPannedChanged(listener: (Boolean) -> Unit): () -> Unit {
    pannedListeners += listener
    return { pannedListeners -= listener }
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
    // Leaving the driving screen ends any panning: the next trip starts following again.
    if (scene !is MapScene.Following && follow.recentre()) pannedListeners.toList().forEach { it(false) }
    this.scene = scene
    refreshStyle() // loads the style if an earlier try failed; otherwise nothing to do
    applyScene()
  }

  fun release() {
    mapView?.run { onPause(); onStop(); onDestroy() }
    presentation?.dismiss()
    display?.release()
    mapView = null
    puck = null
    speed = null
    presentation = null
    display = null
    map = null
    styleLoads.reset()
  }

  private fun addLayers(style: Style) {
    style.addSource(GeoJsonSource(OTHERS))
    style.addSource(GeoJsonSource(TRAVELLED))
    style.addSource(GeoJsonSource(SELECTED))
    style.addSource(GeoJsonSource(POINTS))
    style.addSource(GeoJsonSource(POSITION))
    style.addLayer(LineLayer(OTHERS, OTHERS).withProperties(lineColor(GREY), lineWidth(6f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(LineLayer(TRAVELLED, TRAVELLED).withProperties(lineColor(TRAVELLED_COLOUR), lineWidth(6f), lineOpacity(0.85f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(LineLayer(SELECTED, SELECTED).withProperties(lineColor(ACCENT), lineWidth(8f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
    style.addLayer(CircleLayer(POINTS, POINTS).withProperties(circleColor(ACCENT), circleRadius(7f), circleStrokeColor(WHITE), circleStrokeWidth(2f)))
    style.addLayer(CircleLayer(POSITION, POSITION).withProperties(circleColor(ACCENT), circleRadius(10f), circleStrokeColor(WHITE), circleStrokeWidth(3f)))
  }

  private fun applyScene() {
    val style = map?.style?.takeIf { it.isFullyLoaded } ?: return
    val d = SceneLayout.drawing(scene)
    style.getSourceAs<GeoJsonSource>(SELECTED)?.setGeoJson(lines(listOf(d.selected)))
    style.getSourceAs<GeoJsonSource>(OTHERS)?.setGeoJson(lines(d.others))
    style.getSourceAs<GeoJsonSource>(TRAVELLED)?.setGeoJson(lines(listOf(d.travelled)))
    style.getSourceAs<GeoJsonSource>(POINTS)?.setGeoJson(points(d.points))
    // Following the car, its marker is the fixed view over the map (no jumping from fix to fix).
    val onMap = d.position?.takeUnless { followingCar() }
    style.getSourceAs<GeoJsonSource>(POSITION)?.setGeoJson(points(listOfNotNull(onMap)))
    applyCamera()
    applyOverlays()
  }

  private fun followingCar() = !follow.panned && SceneLayout.camera(scene) is CameraSpec.Follow

  private fun applyOverlays() {
    val s = scene as? MapScene.Following
    puck?.let { p ->
      val on = s != null && map?.style?.isFullyLoaded == true && followingCar()
      p.visibility = if (on) View.VISIBLE else View.GONE
      if (on && !visible.isEmpty) {
        val (x, y) = SceneLayout.followPoint(visible.left, visible.top, visible.right, visible.bottom)
        p.translationX = x - p.sizePx / 2f
        p.translationY = y - p.sizePx / 2f
        p.pointing = s!!.headingDeg != null
      }
    }
    speed?.let { v ->
      v.set(s?.speedLimitKmh, s?.speedKmh)
      if (!visible.isEmpty) {
        val margin = 12 * v.resources.displayMetrics.density
        v.translationX = visible.left + margin
        v.translationY = visible.bottom - margin - v.heightPx
      }
    }
  }

  private fun applyCamera() {
    val m = map ?: return
    if (visible.isEmpty) return
    val left = visible.left.toDouble()
    val top = visible.top.toDouble()
    val right = (surfaceSize.width() - visible.right).toDouble().coerceAtLeast(0.0)
    val bottom = (surfaceSize.height() - visible.bottom).toDouble().coerceAtLeast(0.0)
    val spec = SceneLayout.camera(scene)
    val move = { update: CameraUpdate ->
      val ms = SceneLayout.moveMs(spec)
      if (ms > 0) m.easeCamera(update, ms) else m.moveCamera(update)
    }
    when (spec) {
      // Moved away by the driver: left where they put it until Re-centre.
      is CameraSpec.Follow -> if (!follow.panned) move(
        CameraUpdateFactory.newCameraPosition(
          CameraPosition.Builder()
            .target(spec.target.latLng())
            .zoom(follow.zoom)
            .tilt(45.0)
            .apply { spec.bearing?.let { bearing(it) } }
            // Keep the car low in the view so more of the road ahead shows (see SceneLayout.followPoint).
            .padding(left, top + visible.height() * SceneLayout.FOLLOW_TOP_SHARE, right, bottom)
            .build(),
        ),
      )
      is CameraSpec.Fit -> {
        val distinct = spec.points.distinct()
        if (distinct.size == 1) {
          move(CameraUpdateFactory.newLatLngZoom(distinct[0].latLng(), 15.0))
        } else {
          val bounds = LatLngBounds.Builder().includes(distinct.map { it.latLng() }).build()
          move(CameraUpdateFactory.newLatLngBounds(bounds, (left + 40).toInt(), (top + 40).toInt(), (right + 40).toInt(), (bottom + 40).toInt()))
        }
      }
      is CameraSpec.Center -> move(CameraUpdateFactory.newLatLngZoom(spec.target.latLng(), spec.zoom))
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
    const val TRAVELLED = "wf-travelled"
    // The phone's accent (src/lib/theme.ts) and a quiet grey for the routes not chosen.
    const val ACCENT = "#1765cc"
    const val GREY = "#8a94a6"
    // The road already driven, set apart from the blue route still ahead.
    const val TRAVELLED_COLOUR = "#7b5cd6"
    const val WHITE = "#ffffff"
  }
}
