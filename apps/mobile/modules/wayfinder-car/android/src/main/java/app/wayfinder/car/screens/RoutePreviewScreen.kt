package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.bridge.PlannedItem
import app.wayfinder.car.map.MapScenes

/** Stub until the real preview arrives in Task 10. */
class RoutePreviewScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val destinationName: String,
  private val load: ((Result<PlanResult>) -> Unit) -> Unit,
) : Screen(carContext) {
  override fun onGetTemplate(): Template = MessageTemplate.Builder(destinationName).build()

  companion object {
    fun forPlace(carContext: CarContext, api: CarApi, map: MapScenes, place: CarPlace) =
      RoutePreviewScreen(carContext, api, map, place.name) { done -> api.plan(place, done) }

    fun forPlanned(carContext: CarContext, api: CarApi, map: MapScenes, item: PlannedItem) =
      RoutePreviewScreen(carContext, api, map, item.name) { done -> done(Result.success(PlanResult(listOf(item.option), null))) }
  }
}
