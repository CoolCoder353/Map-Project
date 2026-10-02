package app.wayfinder.car

import android.content.Intent
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import androidx.car.app.AppManager
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.BridgeCarApi
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarBridge
import app.wayfinder.car.bridge.ReactBoot
import app.wayfinder.car.map.CarMapRenderer
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.NavigateRequests
import app.wayfinder.car.nav.NavigationCoordinator
import app.wayfinder.car.screens.HomeScreen

class WayfinderSession(private val api: CarApi = BridgeCarApi(CarBridge.shared)) : Session() {
  private var renderer: CarMapRenderer? = null
  private var requests: NavigateRequests? = null

  override fun onCreateScreen(intent: Intent): Screen {
    ReactBoot.ensureStarted(carContext)
    val map = CarMapRenderer(carContext)
    carContext.getCarService(AppManager::class.java).setSurfaceCallback(map)
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) = map.release()
    })
    renderer = map
    val coordinator = NavigationCoordinator(carContext, api, map, ManeuverIcons(carContext))
    // After Home is on the stack, so a trip already running goes on top of it.
    Handler(Looper.getMainLooper()).post {
      if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@post // ended before this ran: nothing to detach later
      val detach = coordinator.attach()
      lifecycle.addObserver(object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) = detach()
      })
    }
    val navigate = NavigateRequests(carContext, api, map) { lifecycle.currentState != Lifecycle.State.DESTROYED }
    requests = navigate
    // "Navigate to ..." that opened the app: once Home is on the stack, so the preview goes on top of it.
    Handler(Looper.getMainLooper()).post { navigate.handle(intent) }
    return HomeScreen(carContext, api, map, onDrive = coordinator::showDrive) { status -> map.setStyles(status.styleLight, status.styleDark) }
  }

  /** "Navigate to ..." while the car app is already open. */
  override fun onNewIntent(intent: Intent) {
    requests?.handle(intent)
  }

  /** The car switching between day and night changes which of the server's styles to draw. */
  override fun onCarConfigurationChanged(newConfiguration: Configuration) {
    renderer?.refreshStyle()
  }
}
