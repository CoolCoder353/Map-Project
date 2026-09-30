package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarStatus
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Where the car starts: search, planned routes and Discover, over the map. */
class HomeScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val onStatus: (CarStatus) -> Unit,
) : Screen(carContext) {
  private var status: Result<CarStatus>? = null

  init {
    // Each time Home is back on top: check the account again and show the overview.
    whenStarted { load() }
  }

  private fun load() {
    api.status { r ->
      status = r
      r.getOrNull()?.let {
        onStatus(it)
        map.show(MapScene.Overview(it.here))
      }
      invalidate()
    }
  }

  private fun retry() {
    status = null
    invalidate()
    load()
  }

  override fun onGetTemplate(): Template {
    val loaded = status
      ?: return PlaceListNavigationTemplate.Builder().setTitle(appName(carContext)).setHeaderAction(Action.APP_ICON).setLoading(true).build()
    val s = loaded.getOrElse { return message(it.message ?: "Something went wrong. Try again.") }
    return when (s.account) {
      Account.SIGNED_OUT -> message("Open Wayfinder on your phone and sign in.")
      Account.OFFLINE -> message("Can’t reach your server. Check your phone has signal, then try again.")
      Account.SIGNED_IN -> PlaceListNavigationTemplate.Builder()
        .setTitle(appName(carContext))
        .setHeaderAction(Action.APP_ICON)
        .setItemList(
          ItemList.Builder()
            .addItem(menuRow("Search") { screenManager.push(SearchScreen(carContext, api, map, s.searchHint)) })
            .addItem(menuRow("Planned routes") { screenManager.push(PickScreens.planned(carContext, api, map)) })
            .addItem(menuRow("Discover nearby") { screenManager.push(PickScreens.discover(carContext, api, map)) })
            .build(),
        )
        .build()
    }
  }

  /** Places lists insist a row is either a place with a distance or a browsable menu entry; these are the latter. */
  private fun menuRow(title: String, onClick: () -> Unit): Row =
    Row.Builder().setTitle(title).setBrowsable(true).setOnClickListener(onClick).build()

  private fun message(text: String): Template =
    MessageTemplate.Builder(text)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.APP_ICON)
      .addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build())
      .build()
}
