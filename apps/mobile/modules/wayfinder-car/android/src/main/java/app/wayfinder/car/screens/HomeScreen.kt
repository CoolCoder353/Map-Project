package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarStatus
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/**
 * Where the car starts: search, planned routes and Discover, over the map. During a trip it also
 * offers the way back to directions ([onDrive]), for a driver who pressed Back on them.
 */
class HomeScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val onDrive: () -> Unit = {},
  private val onStatus: (CarStatus) -> Unit,
) : Screen(carContext) {
  private var status: Result<CarStatus>? = null

  init {
    // Each time Home is back on top: check the account again and show the overview.
    whenStarted { load() }
    // Redrawn only when a trip starts or ends, not on every fix.
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      private var off: (() -> Unit)? = null
      private var navigating = api.navigation != null
      override fun onCreate(owner: LifecycleOwner) {
        off = api.onNavigation { nav ->
          if ((nav != null) != navigating) {
            navigating = nav != null
            invalidate()
          }
        }
      }
      override fun onDestroy(owner: LifecycleOwner) {
        off?.invoke()
      }
    })
  }

  private val backToDirections get() = api.navigation != null

  private fun load() {
    api.status { r ->
      status = r
      r.getOrNull()?.let {
        onStatus(it)
        show(map, MapScene.Overview(it.here))
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
            .apply { if (backToDirections) addItem(row("Back to directions", browsable = true) { onDrive() }) }
            .addItem(row("Search", browsable = true) { screenManager.push(SearchScreen(carContext, api, map, s.searchHint)) })
            .addItem(row("Planned routes", browsable = true) { screenManager.push(PickScreens.planned(carContext, api, map)) })
            .addItem(row("Discover nearby", browsable = true) { screenManager.push(PickScreens.discover(carContext, api, map)) })
            .build(),
        )
        .build()
    }
  }

  private fun message(text: String): Template =
    MessageTemplate.Builder(text)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.APP_ICON)
      .addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build())
      .apply { if (backToDirections) addAction(Action.Builder().setTitle("Back to directions").setOnClickListener { onDrive() }.build()) }
      .build()
}
