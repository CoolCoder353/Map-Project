package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.CarMessages
import app.wayfinder.car.IdleDrive
import app.wayfinder.car.R
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarFix
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.CarStatus
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/**
 * Where the car starts: Home and the other saved places, search, planned routes and Discover, over
 * the map. During a trip it also offers the way back to directions ([onDrive]), for a driver who
 * pressed Back on them. Otherwise it offers a test drive ([onTestDrive]), and the map follows the
 * car on [fixes] with its speed and the road's limit (see [IdleDrive]). Each row has its own icon,
 * so a glance finds it, and there are never more than six.
 */
class HomeScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val onDrive: () -> Unit = {},
  private val onTestDrive: () -> Unit = {},
  private val fixes: ((CarFix) -> Unit) -> () -> Unit = { { } },
  private val onStatus: (CarStatus) -> Unit,
) : Screen(carContext) {
  private var status: Result<CarStatus>? = null
  private val idle = IdleDrive(api)
  private var stopFollowing: (() -> Unit)? = null

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
            follow()
            invalidate()
          }
        }
      }
      override fun onStop(owner: LifecycleOwner) = unfollow()
      override fun onDestroy(owner: LifecycleOwner) {
        off?.invoke()
      }
    })
  }

  /** Follows the car while Home is on top, signed in, with no trip; the trip's screen has the map otherwise. */
  private fun follow() {
    val wanted = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) && api.navigation == null &&
      status?.getOrNull()?.account == Account.SIGNED_IN
    if (!wanted) return unfollow()
    if (stopFollowing == null) stopFollowing = fixes { fix -> idle.onFix(fix) { show(map, it) } }
  }

  private fun unfollow() {
    stopFollowing?.invoke()
    stopFollowing = null
    idle.stop()
  }

  private val backToDirections get() = api.navigation != null

  private fun load() {
    api.status { r ->
      status = r
      r.getOrNull()?.let {
        onStatus(it)
        show(map, MapScene.Overview(it.here))
      }
      follow()
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
      Account.SIGNED_OUT -> message(CarMessages.SIGN_IN)
      Account.OFFLINE -> message(CarMessages.OFFLINE)
      Account.SIGNED_IN -> PlaceListNavigationTemplate.Builder()
        .setTitle(appName(carContext))
        .setHeaderAction(Action.APP_ICON)
        .setItemList(
          ItemList.Builder()
            .apply { if (backToDirections) addItem(row("Back to directions", browsable = true, icon = icon(R.drawable.wf_navigation)) { onDrive() }) }
            .apply { savedRows(s.saved).forEach { addItem(it) } }
            .addItem(row("Search", browsable = true, icon = icon(R.drawable.wf_search)) { screenManager.push(SearchScreen(carContext, api, map, s.searchHint)) })
            .addItem(row("Planned routes", browsable = true, icon = icon(R.drawable.wf_route)) { screenManager.push(PickScreens.planned(carContext, api, map)) })
            .addItem(row("Discover nearby", browsable = true, icon = icon(R.drawable.wf_explore)) { screenManager.push(PickScreens.discover(carContext, api, map)) })
            // A pretend trip for trying the car app without driving; not offered over a real one.
            .apply { if (!backToDirections) addItem(row("Test drive", "Follow a pretend trip, nothing is recorded", browsable = true, icon = icon(R.drawable.wf_car)) { onTestDrive() }) }
            .build(),
        )
        .build()
    }
  }

  private fun icon(res: Int) = carIcon(carContext, res)

  /**
   * Home as a row of its own, one tap from its routes (most drives end there), and the other saved
   * places behind one "Saved places" row, so the list stays at six rows.
   */
  private fun savedRows(saved: List<CarPlace>): List<Row> {
    val home = saved.firstOrNull { it.name.trim().equals("home", ignoreCase = true) }
    val others = saved.filter { it !== home }
    return listOfNotNull(
      home?.let { h -> row(h.name, h.detail, browsable = true, icon = icon(R.drawable.wf_home)) { screenManager.push(RoutePreviewScreen.forPlace(carContext, api, map, h)) } },
      others.takeIf { it.isNotEmpty() }?.let { row("Saved places", browsable = true, icon = icon(R.drawable.wf_bookmark)) { screenManager.push(PickScreens.saved(carContext, api, map, saved)) } },
    )
  }

  private fun message(text: String): Template =
    MessageTemplate.Builder(text)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.APP_ICON)
      .addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build())
      .apply { if (backToDirections) addAction(Action.Builder().setTitle("Back to directions").setOnClickListener { onDrive() }.build()) }
      .build()
}
