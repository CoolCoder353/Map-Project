package app.wayfinder.car.nav

import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.screens.NavigationScreen

/**
 * Keeps the car in step with navigation, wherever it was started: shows the driving screen, tells
 * Android Auto a trip is running (so the car's own displays and "End navigation" work), and steps
 * back to the start when it ends.
 */
class NavigationCoordinator(
  private val carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
) {
  private var navigating = false
  private val screens get() = carContext.getCarService(ScreenManager::class.java)
  private val navManager get() = carContext.getCarService(NavigationManager::class.java)

  fun attach(): () -> Unit {
    navManager.setNavigationManagerCallback(object : NavigationManagerCallback {
      override fun onStopNavigation() = api.stop()
    })
    val off = api.onNavigation(::update)
    update(api.navigation)
    return {
      off()
      if (navigating) navManager.navigationEnded()
      navigating = false
      navManager.clearNavigationManagerCallback()
    }
  }

  private fun update(nav: CarNav?) {
    if (nav != null && !navigating) {
      navigating = true
      navManager.navigationStarted()
      screens.popToRoot()
      screens.push(NavigationScreen(carContext, api, map, icons))
    } else if (nav == null && navigating) {
      navigating = false
      navManager.navigationEnded()
      screens.popToRoot()
    }
    if (nav != null) navManager.updateTrip(NavTemplates.trip(nav, icons))
  }
}
