package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.map.LastPosition
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/**
 * A list to choose from (planned routes, places to discover), with its items on the map, each row
 * numbered as its marker there. A list that couldn't load says why, with "Try again": going back
 * and in again is two taps more while driving.
 */
class PickScreen<T>(
  carContext: CarContext,
  private val map: MapScenes,
  private val title: String,
  private val emptyMessage: String,
  private val load: ((Result<List<T>>) -> Unit) -> Unit,
  private val describe: (T) -> Pair<String, String>,
  private val scene: (List<T>) -> MapScene,
  private val pick: (T) -> Screen,
  /** During a trip, a way back to the directions (C98). */
  private val directions: BackToDirections? = null,
) : Screen(carContext) {
  private var items: Result<List<T>>? = null

  init {
    whenCreated { fetch() }
    whenStarted { showOnMap() }
  }

  private fun fetch() {
    load { r ->
      items = r
      invalidate()
      showOnMap()
    }
  }

  internal fun retry() {
    items = null
    invalidate()
    fetch()
  }

  private fun showOnMap() {
    items?.getOrNull()?.let { show(map, scene(it.take(MAX_ROWS))) }
  }

  override fun onGetTemplate(): Template {
    val b = PlaceListNavigationTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
    directionsStrip(directions)?.let { b.setActionStrip(it) }
    val r = items ?: return b.setLoading(true).build()
    val found = r.getOrElse {
      return MessageTemplate.Builder(it.message ?: "Something went wrong. Try again.")
        .setTitle(title)
        .setHeaderAction(Action.BACK)
        .addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build())
        .build()
    }
    val list = ItemList.Builder()
    if (found.isEmpty()) list.setNoItemsMessage(emptyMessage)
    found.take(MAX_ROWS).forEachIndexed { i, item ->
      val (name, detail) = describe(item)
      list.addItem(row(shortName(name), detail, browsable = true, icon = numberIcon(i + 1)) { screenManager.push(pick(item)) })
    }
    return b.setItemList(list.build()).build()
  }
}

object PickScreens {
  fun discover(carContext: CarContext, api: CarApi, map: MapScenes, directions: BackToDirections? = null) = PickScreen(
    carContext, map, "Discover nearby", "Nothing new nearby. When it’s safe, try a longer time in Discover on your phone.",
    load = api::discover,
    describe = { it.name to it.detail },
    scene = { MapScene.Places(it, LastPosition.at) },
    pick = { RoutePreviewScreen.forPlace(carContext, api, map, it) },
    directions = directions,
  )

  /** Places already found, to choose one: the Assistant's results (C72), or a search's on the map. */
  fun choose(carContext: CarContext, api: CarApi, map: MapScenes, title: String, places: List<CarPlace>, directions: BackToDirections? = null) = PickScreen(
    carContext, map, title, "Nothing found.",
    load = { done -> done(Result.success(places)) },
    describe = { it.name to it.detail },
    scene = { MapScene.Places(it, LastPosition.at) },
    pick = { RoutePreviewScreen.forPlace(carContext, api, map, it) },
    directions = directions,
  )

  /** The saved places Home already had: no need to ask the phone again. */
  fun saved(carContext: CarContext, api: CarApi, map: MapScenes, places: List<CarPlace>) = PickScreen(
    carContext, map, "Saved places", "No saved places. Save one on your phone or the website.",
    load = { done -> done(Result.success(places)) },
    describe = { it.name to it.detail },
    scene = { MapScene.Places(it, LastPosition.at) },
    pick = { RoutePreviewScreen.forPlace(carContext, api, map, it) },
  )

  fun planned(carContext: CarContext, api: CarApi, map: MapScenes) = PickScreen(
    carContext, map, "Planned routes", "Nothing planned for driving. Use Search to find somewhere, or plan a route on your phone when it’s safe.",
    load = api::planned,
    describe = { it.name to it.option.detail },
    // None chosen yet: each route is numbered on the map as its row is.
    scene = { items -> MapScene.Routes(items.map { it.option }, MapScene.Routes.NONE) },
    pick = { RoutePreviewScreen.forPlanned(carContext, api, map, it) },
  )
}
