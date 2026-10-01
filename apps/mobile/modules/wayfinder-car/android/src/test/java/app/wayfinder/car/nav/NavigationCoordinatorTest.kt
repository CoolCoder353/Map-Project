package app.wayfinder.car.nav

import androidx.car.app.testing.ScreenController
import androidx.lifecycle.Lifecycle
import androidx.car.app.testing.TestScreenManager
import androidx.car.app.testing.navigation.TestNavigationManager
import app.wayfinder.car.*
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.screens.NavigationScreen
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigationCoordinatorTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val coordinator = NavigationCoordinator(carContext, api, RecordingScenes(), ManeuverIcons(carContext))
  private val screens get() = carContext.getCarService(TestScreenManager::class.java)
  private val nav get() = carContext.getCarService(TestNavigationManager::class.java)

  @Test fun showsTheDriveWhereverItWasStarted() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    assertTrue(screens.screensPushed.last() is NavigationScreen)
    assertEquals(1, nav.navigationStartedCount)
    api.pushNav(Samples.nav().copy(remainingDistanceM = 3000.0))
    assertEquals("one drive screen, updated", 1, screens.screensPushed.count { it is NavigationScreen })
    assertEquals(2, nav.tripsSent.size)
  }

  /** The screen as the car runs it: created once it is on the stack. */
  private fun driveScreen() = ScreenController(screens.screensPushed.last { it is NavigationScreen }).also { it.moveToState(Lifecycle.State.CREATED) }

  @Test fun aFinishedDriveDoesNotRepaintTheMap() {
    val scenes = RecordingScenes()
    // Registered before the coordinator, so it ends the screen first, as the pop does; the screen
    // is still handed that same update, just after it has gone.
    lateinit var drive: ScreenController
    api.onNavigation { if (it == null) drive.moveToState(Lifecycle.State.DESTROYED) }
    NavigationCoordinator(carContext, api, scenes, ManeuverIcons(carContext)).attach()
    api.pushNav(Samples.nav())
    drive = driveScreen()
    val before = scenes.shown.size
    api.pushNav(null)
    assertEquals("nothing shown once the drive screen is gone", before, scenes.shown.size)
  }

  @Test fun aNewRouteDoesNotWearTheOldLine() {
    val scenes = RecordingScenes()
    NavigationCoordinator(carContext, api, scenes, ManeuverIcons(carContext)).attach()
    api.pushNav(Samples.nav())
    driveScreen()
    api.answer("routeLine", listOf(LngLat(153.0, -27.4), LngLat(152.9, -27.5)))
    assertEquals(2, (scenes.shown.last() as MapScene.Following).line.size)
    api.pushNav(Samples.nav(routeId = "r-reroute"))
    assertEquals("old line gone while the new one loads", 0, (scenes.shown.last() as MapScene.Following).line.size)
    api.answer("routeLine", listOf(LngLat(153.0, -27.4)))
    assertEquals(1, (scenes.shown.last() as MapScene.Following).line.size)
  }

  @Test fun picksUpATripAlreadyRunningWhenTheCarConnects() {
    api.navigation = Samples.nav()
    coordinator.attach()
    assertTrue(screens.screensPushed.last() is NavigationScreen)
  }

  @Test fun stepsBackAndTellsAndroidAutoWhenTheTripEnds() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    api.pushNav(null)
    assertEquals(1, nav.navigationEndedCount)
  }

  @Test fun endsTheTripWhenTheCarAsks() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    nav.navigationManagerCallback!!.onStopNavigation()
    assertEquals("stop", api.calls.last())
  }

  @Test fun detachingEndsItsPartInTheTrip() {
    val detach = coordinator.attach()
    api.pushNav(Samples.nav())
    detach()
    assertEquals(1, nav.navigationEndedCount)
    api.pushNav(null)
    assertEquals("no second end after detaching", 1, nav.navigationEndedCount)
  }
}
