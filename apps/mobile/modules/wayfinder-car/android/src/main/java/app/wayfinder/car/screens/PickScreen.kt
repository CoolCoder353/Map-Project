package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** A list to choose from (planned routes, places to discover), with its items on the map. */
class PickScreen<T>(
  carContext: CarContext,
  private val map: MapScenes,
  private val title: String,
  private val emptyMessage: String,
  private val load: ((Result<List<T>>) -> Unit) -> Unit,
  private val describe: (T) -> Pair<String, String>,
  private val scene: (List<T>) -> MapScene,
  private val pick: (T) -> Screen,
) : Screen(carContext) {
  private var items: Result<List<T>>? = null

  init {
    whenCreated {
      load { r ->
        items = r
        invalidate()
        showOnMap()
      }
    }
    whenStarted { showOnMap() }
  }

  private fun showOnMap() {
    items?.getOrNull()?.let { show(map, scene(it.take(MAX_ROWS))) }
  }

  override fun onGetTemplate(): Template {
    val b = PlaceListNavigationTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
    val r = items ?: return b.setLoading(true).build()
    val list = ItemList.Builder()
    r.onSuccess { found ->
      if (found.isEmpty()) list.setNoItemsMessage(emptyMessage)
      found.take(MAX_ROWS).forEach { item ->
        val (name, detail) = describe(item)
        list.addItem(row(name, detail, browsable = true) { screenManager.push(pick(item)) })
      }
    }.onFailure { list.setNoItemsMessage(it.message ?: "Something went wrong. Go back and try again.") }
    return b.setItemList(list.build()).build()
  }
}

object PickScreens {
  fun discover(carContext: CarContext, api: CarApi, map: MapScenes) = PickScreen(
    carContext, map, "Discover nearby", "Nothing new within half an hour’s drive.",
    load = api::discover,
    describe = { it.name to it.detail },
    scene = { MapScene.Places(it) },
    pick = { RoutePreviewScreen.forPlace(carContext, api, map, it) },
  )

  fun planned(carContext: CarContext, api: CarApi, map: MapScenes) = PickScreen(
    carContext, map, "Planned routes", "Nothing planned for driving. Send a route from the website.",
    load = api::planned,
    describe = { it.name to it.option.detail },
    scene = { items -> MapScene.Routes(items.map { it.option }, 0) },
    pick = { RoutePreviewScreen.forPlanned(carContext, api, map, it) },
  )
}
