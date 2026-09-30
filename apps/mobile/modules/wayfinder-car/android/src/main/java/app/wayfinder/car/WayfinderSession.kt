package app.wayfinder.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import app.wayfinder.car.bridge.BridgeCarApi
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarBridge
import app.wayfinder.car.bridge.ReactBoot
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.screens.HomeScreen

class WayfinderSession(private val api: CarApi = BridgeCarApi(CarBridge.shared)) : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    ReactBoot.ensureStarted(carContext)
    val map = MapScenes { } // the car map arrives in Task 12
    return HomeScreen(carContext, api, map) { }
  }
}
