package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.map.MapScenes

/** Placeholders until the real lists arrive in Task 9. */
object PickScreens {
  fun planned(carContext: CarContext, api: CarApi, map: MapScenes): Screen = MessageScreen(carContext, "Planned routes")
  fun discover(carContext: CarContext, api: CarApi, map: MapScenes): Screen = MessageScreen(carContext, "Discover nearby")
}
