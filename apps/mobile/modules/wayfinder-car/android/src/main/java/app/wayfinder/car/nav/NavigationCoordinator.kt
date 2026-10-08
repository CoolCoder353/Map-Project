package app.wayfinder.car.nav

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.ScreenManager
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.map.MapControls
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.map.TripTrail
import app.wayfinder.car.screens.NavigationScreen

/**
 * Keeps the car in step with navigation, wherever it was started: shows the driving screen, tells
 * Android Auto a trip is running (so the car's own displays and "End navigation" work), and steps
 * back to the start when it ends. Back on the driving screen leaves the trip running; Home then
 * offers the way back to it ([showDrive]).
 */
class NavigationCoordinator(
  private val carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val icons: ManeuverIcons,
  private val controls: MapControls? = null,
  /** Makes sure the car map has its styles; a trip already running skips Home, which would fetch them. */
  private val ensureStyles: () -> Unit = {},
) {
  /** The road this trip has driven, for the map: kept here as the driving screen can be left and come back to. */
  private val trail = TripTrail()
  private var navigating = false
  /** The running trip is a test drive the car asked for (auto drive). */
  private var testDrive = false
  /** Asked for a test drive and not yet answered: replacing a running trip ends it first, which mustn't clear [testDrive]. */
  private var testDriveStarting = false
  private val notifications = NavNotifications(carContext, icons)
  private val screens get() = carContext.getCarService(ScreenManager::class.java)
  private val navManager get() = carContext.getCarService(NavigationManager::class.java)

  fun attach(): () -> Unit {
    navManager.setNavigationManagerCallback(object : NavigationManagerCallback {
      override fun onStopNavigation() = api.stop()

      /** Google's reviewers and the Desktop Head Unit switch this on to see a trip without driving one (NF-7). */
      override fun onAutoDriveEnabled() {
        testDrive = true
        testDriveStarting = true
        api.simulate { r ->
          testDriveStarting = false
          r.onFailure {
            testDrive = false
            CarToast.makeText(carContext, it.message ?: "Couldn’t start a test drive. Try again.", CarToast.LENGTH_LONG).show()
          }
        }
      }
    })
    val off = api.onNavigation(::update)
    update(api.navigation)
    return {
      off()
      // A test drive ends with the car session; a real trip carries on with the phone.
      if (navigating && testDrive) api.stop()
      testDrive = false
      notifications.cancel()
      if (navigating) navManager.navigationEnded()
      navigating = false
      navManager.clearNavigationManagerCallback()
    }
  }

  private fun update(nav: CarNav?) {
    if (nav != null && !navigating) {
      navigating = true
      trail.clear()
      navManager.navigationStarted()
      screens.popToRoot()
      showDrive()
    } else if (nav == null && navigating) {
      navigating = false
      trail.clear()
      if (!testDriveStarting) testDrive = false
      notifications.cancel()
      navManager.navigationEnded()
      screens.popToRoot()
    }
    if (nav != null) {
      trail.add(nav.position)
      navManager.updateTrip(NavTemplates.trip(nav, icons))
      notifications.update(nav)
    }
  }

  /** Puts the driving screen on top during a trip, unless it already is. */
  fun showDrive() {
    if (api.navigation == null || (screens.stackSize > 0 && screens.top is NavigationScreen)) return
    screens.push(NavigationScreen(carContext, api, map, icons, trail, controls, ensureStyles))
  }
}
