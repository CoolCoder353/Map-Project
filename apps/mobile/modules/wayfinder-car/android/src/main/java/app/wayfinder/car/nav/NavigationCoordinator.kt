package app.wayfinder.car.nav

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.ScreenManager
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.map.MapControls
import app.wayfinder.car.bridge.NavStatus
import app.wayfinder.car.map.MapPictures
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.map.OverLimitChime
import app.wayfinder.car.map.TripTrail
import app.wayfinder.car.screens.NavigationScreen
import app.wayfinder.car.screens.RoutePreviewScreen

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
  /** Pictures of the car map, for reports. */
  private val pictures: MapPictures? = null,
  /** Wayfinder is what the car's screen shows (the session is resumed). */
  private val appShowing: () -> Boolean = { false },
  /** A short sound for going over the limit. */
  chime: () -> Unit = ::beep,
  /** Tells the driver something briefly. */
  private val say: (String) -> Unit = { CarToast.makeText(carContext, it, CarToast.LENGTH_LONG).show() },
) {
  private val overLimit = OverLimitChime(chime)
  /** The last update of the running trip, to tell an arrival from directions that stopped. */
  private var last: CarNav? = null
  /** The car asked to end the trip (End, or the car's own "End navigation"): no need to say it ended. */
  private var stopAsked = false
  /** The road this trip has driven, for the map: kept here as the driving screen can be left and come back to. */
  private val trail = TripTrail()
  private var navigating = false
  /** The running trip is a test drive the car asked for (auto drive). */
  private var testDrive = false
  /** Asked for a test drive and not yet answered: replacing a running trip ends it first, which mustn't clear [testDrive]. */
  private var testDriveStarting = false
  private val notifications = NavNotifications(carContext, icons, onEnd = { stop() }, onMute = { api.setMuted(!(api.navigation?.muted ?: false)) })
  private val screens get() = carContext.getCarService(ScreenManager::class.java)
  private val navManager get() = carContext.getCarService(NavigationManager::class.java)

  fun attach(): () -> Unit {
    navManager.setNavigationManagerCallback(object : NavigationManagerCallback {
      override fun onStopNavigation() = stop()

      /** Google's reviewers and the Desktop Head Unit switch this on to see a trip without driving one (NF-7). */
      override fun onAutoDriveEnabled() = startTestDrive()
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

  /** A pretend trip: along the running one, else a built-in route. Records nothing. Also what the car's "auto drive" starts. */
  fun startTestDrive() {
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

  /** Ends the trip at the car's asking. */
  fun stop() {
    stopAsked = true
    api.stop()
  }

  private fun update(nav: CarNav?) {
    if (nav != null && !navigating) {
      navigating = true
      stopAsked = false
      trail.clear()
      navManager.navigationStarted()
      // Started from the car's route preview: that and the screens to it are done with. Started on
      // the phone: the directions go over whatever the car was showing, which is still there after
      // the trip (C45), rather than throwing away a search being typed.
      if (screens.stackSize > 0 && screens.top is RoutePreviewScreen) screens.popToRoot()
      showDrive()
    } else if (nav == null && navigating) {
      navigating = false
      trail.clear()
      if (!testDriveStarting) testDrive = false
      notifications.cancel()
      navManager.navigationEnded()
      if (driving()) screens.pop()
      // Directions gone without the car asking and before arriving: the phone ended them, or its
      // app restarted. Say so, rather than leave the driver at Home wondering (C63, C71).
      if (!stopAsked && last?.status != NavStatus.ARRIVED && !testDrive) say(ENDED_ON_PHONE)
      stopAsked = false
    }
    last = nav
    if (nav != null) {
      overLimit.update(nav.speedLimitKmh, nav.speedKmh, nav.muted)
      trail.add(nav.position)
      navManager.updateTrip(NavTemplates.trip(nav, icons))
      notifications.update(nav, headsUp = !(appShowing() && driving()))
    }
  }

  /** Puts the driving screen on top during a trip, unless it already is. */
  fun showDrive() {
    if (api.navigation == null || driving()) return
    screens.push(NavigationScreen(carContext, api, map, icons, trail, controls, ensureStyles, pictures, onStop = ::stop))
  }

  /**
   * The navigation notification was tapped: the directions, from wherever the driver was (Search,
   * say), with Home under them as after any trip starts, rather than piled on the screens between.
   */
  fun openDirections() {
    if (api.navigation == null || driving()) return
    screens.popToRoot()
    showDrive()
  }

  private fun driving() = screens.stackSize > 0 && screens.top is NavigationScreen

  companion object {
    const val ENDED_ON_PHONE = "Directions stopped on your phone. Start them again from Wayfinder when it’s safe."
  }
}

private fun beep() {
  runCatching {
    val tone = android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC, 80)
    tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP2, 300)
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ tone.release() }, 600)
  }
}
