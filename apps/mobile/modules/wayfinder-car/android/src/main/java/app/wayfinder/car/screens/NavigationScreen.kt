package app.wayfinder.car.screens

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Template
import androidx.car.app.versioning.CarAppApiLevels
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.R
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.map.MapControls
import app.wayfinder.car.map.MapPictures
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.map.TripTrail
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.MapButtons
import app.wayfinder.car.nav.NavTemplates

/**
 * Directions while driving, over a map that follows you and shows the road already driven
 * ([trail]). [controls] are the map's zoom and pan, where the car can do them; [onShown] runs
 * each time the screen comes on top (the map's styles, if nothing has fetched them yet).
 */
class NavigationScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
  private val trail: TripTrail = TripTrail(),
  private val controls: MapControls? = null,
  private val onShown: () -> Unit = {},
  private val pictures: MapPictures? = null,
  /** Ends the trip (the coordinator's, so it knows the car asked). */
  private val onStop: () -> Unit = { api.stop() },
) : Screen(carContext) {
  private var nav: CarNav? = api.navigation
  private var line: List<LngLat> = emptyList()
  private var lineFor: String? = null
  private var reporting = false
  /** End was tapped once, [END_CONFIRM_MS] ago at most. */
  private var confirmingEnd = false
  /** Muted or not as last tapped, until the phone's update says the same. */
  private var mutedAsked: Boolean? = null
  private val handler = Handler(Looper.getMainLooper())
  private val mapIcons by lazy {
    fun icon(res: Int) = CarIcon.Builder(IconCompat.createWithResource(carContext, res)).build()
    Triple(icon(R.drawable.wf_zoom_in), icon(R.drawable.wf_zoom_out), icon(R.drawable.wf_recentre))
  }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      private var off: (() -> Unit)? = null
      private var offPanned: (() -> Unit)? = null
      override fun onCreate(owner: LifecycleOwner) {
        off = api.onNavigation(::update)
        offPanned = controls?.onPannedChanged { invalidate() }
        update(api.navigation)
      }
      override fun onDestroy(owner: LifecycleOwner) {
        off?.invoke()
        offPanned?.invoke()
      }
    })
    whenStarted {
      onShown()
      showMap()
    }
  }

  private fun update(n: CarNav?) {
    // The coordinator pops this screen when the trip ends; a late update must not repaint the map
    // over the screen that took its place.
    if (lifecycle.currentState == Lifecycle.State.DESTROYED) return
    nav = n
    if (n == null || n.muted == mutedAsked) mutedAsked = null
    // The route changes on a reroute; fetch its line once per route, not on every fix.
    if (n != null && n.routeId != lineFor) {
      val id = n.routeId
      lineFor = id
      line = emptyList() // not the old route's line on the new route
      api.routeLine(id) { r ->
        if (lineFor == id) {
          line = r.getOrDefault(emptyList())
          // Directions still come; say why the map has no line rather than leave it blank (C58).
          if (r.isFailure && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) CarToast.makeText(carContext, NO_LINE, CarToast.LENGTH_LONG).show()
          showMap()
        }
      }
    }
    showMap()
    invalidate()
  }

  private fun showMap() {
    val n = nav
    show(map, MapScene.Following(line, n?.position, n?.headingDeg, trail.points, n?.speedLimitKmh, n?.speedKmh, n?.speedLimitEstimated == true, n?.lights.orEmpty()))
  }

  /**
   * One tap: the phone files a report with what the car is showing and a picture of the map; the
   * driver explains later. The report goes without the picture if it isn't ready by [PICTURE_WAIT_MS].
   */
  internal fun report() {
    if (reporting) return
    reporting = true
    val source = pictures ?: return sendReport(null)
    var sent = false
    val once = { picture: String? ->
      if (!sent) {
        sent = true
        sendReport(picture)
      }
    }
    Handler(Looper.getMainLooper()).postDelayed({ once(null) }, PICTURE_WAIT_MS)
    source.capture(once)
  }

  private fun sendReport(picture: String?) {
    api.report(picture) { r ->
      reporting = false
      val said = r.fold({ "Reported. When it’s safe, add what went wrong from Wayfinder on your phone." }, { it.message ?: "Couldn’t send the report. Try again." })
      CarToast.makeText(carContext, said, CarToast.LENGTH_LONG).show()
    }
  }

  private fun mapButtons(): MapButtons? {
    val c = controls ?: return null
    if (carContext.carAppApiLevel < CarAppApiLevels.LEVEL_2) return null
    val (zoomIn, zoomOut, recentre) = mapIcons
    return MapButtons(c.panned, zoomIn, zoomOut, recentre, onZoom = c::zoomBy, onRecentre = c::recentre)
  }

  private val muted get() = mutedAsked ?: (nav?.muted == true)

  /**
   * Ending is two taps unless arrived: the phone asks "End this trip?" and a car at speed can't, so
   * the first tap turns End into "Tap to end" for [END_CONFIRM_MS].
   */
  internal fun end() {
    if (nav?.status == app.wayfinder.car.bridge.NavStatus.ARRIVED || confirmingEnd) {
      onStop()
      return
    }
    confirmingEnd = true
    invalidate()
    handler.postDelayed({
      confirmingEnd = false
      invalidate()
    }, END_CONFIRM_MS)
  }

  /** Shown straight away, so the button answers the tap rather than waiting on the phone. */
  internal fun toggleMute() {
    mutedAsked = !muted
    api.setMuted(mutedAsked!!)
    invalidate()
  }

  override fun onGetTemplate(): Template =
    NavTemplates.navigation(
      nav, icons,
      onEnd = ::end,
      onMute = ::toggleMute,
      onReport = ::report,
      map = mapButtons(),
      confirmingEnd = confirmingEnd,
      muted = muted,
    )

  companion object {
    const val PICTURE_WAIT_MS = 1_500L
    const val NO_LINE = "Can’t draw this route on the map. The directions still work."
    const val END_CONFIRM_MS = 5_000L
  }
}
