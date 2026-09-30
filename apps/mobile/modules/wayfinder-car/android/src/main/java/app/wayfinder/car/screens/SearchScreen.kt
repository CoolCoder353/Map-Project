package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.map.MapScenes

/** Placeholder until the real search screen arrives in Task 9. */
class SearchScreen(carContext: CarContext, api: CarApi, map: MapScenes, hint: String) : Screen(carContext) {
  override fun onGetTemplate(): Template = MessageTemplate.Builder("Search").build()
}
