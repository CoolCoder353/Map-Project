package app.wayfinder.car

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.BridgeCarApi
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarBridge
import app.wayfinder.car.bridge.ReactBoot
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.NavigationCoordinator
import app.wayfinder.car.screens.HomeScreen

class WayfinderSession(private val api: CarApi = BridgeCarApi(CarBridge.shared)) : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    ReactBoot.ensureStarted(carContext)
    val map = MapScenes { } // the car map arrives in Task 12
    val coordinator = NavigationCoordinator(carContext, api, map, ManeuverIcons(carContext))
    // After Home is on the stack, so a trip already running goes on top of it.
    Handler(Looper.getMainLooper()).post {
      if (lifecycle.currentState == Lifecycle.State.DESTROYED) return@post // ended before this ran: nothing to detach later
      val detach = coordinator.attach()
      lifecycle.addObserver(object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) = detach()
      })
    }
    return HomeScreen(carContext, api, map) { }
  }
}
