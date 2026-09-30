package app.wayfinder.car.nav

import androidx.car.app.testing.TestScreenManager
import androidx.car.app.testing.navigation.TestNavigationManager
import app.wayfinder.car.*
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
