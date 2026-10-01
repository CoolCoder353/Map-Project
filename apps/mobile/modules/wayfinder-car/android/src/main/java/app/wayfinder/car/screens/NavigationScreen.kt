package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.NavTemplates

/** Directions while driving, over a map that follows you. */
class NavigationScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
) : Screen(carContext) {
  private var nav: CarNav? = api.navigation
  private var line: List<LngLat> = emptyList()
  private var lineFor: String? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      private var off: (() -> Unit)? = null
      override fun onCreate(owner: LifecycleOwner) {
        off = api.onNavigation(::update)
        update(api.navigation)
      }
      override fun onDestroy(owner: LifecycleOwner) {
        off?.invoke()
      }
    })
  }

  private fun update(n: CarNav?) {
    // The coordinator pops this screen when the trip ends; a late update must not repaint the map
    // over the screen that took its place.
    if (lifecycle.currentState == Lifecycle.State.DESTROYED) return
    nav = n
    // The route changes on a reroute; fetch its line once per route, not on every fix.
    if (n != null && n.routeId != lineFor) {
      val id = n.routeId
      lineFor = id
      line = emptyList() // not the old route's line on the new route
      api.routeLine(id) { r ->
        if (lineFor == id) {
          line = r.getOrDefault(emptyList())
          showMap()
        }
      }
    }
    showMap()
    invalidate()
  }

  private fun showMap() = map.show(MapScene.Following(line, nav?.position, nav?.headingDeg))

  override fun onGetTemplate(): Template =
    NavTemplates.navigation(nav, icons, onEnd = { api.stop() }, onMute = { api.setMuted(!(nav?.muted ?: false)) })
}
