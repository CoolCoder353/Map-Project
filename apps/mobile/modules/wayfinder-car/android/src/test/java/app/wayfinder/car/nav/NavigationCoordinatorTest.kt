package app.wayfinder.car.nav

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import androidx.car.app.notification.CarAppExtender
import androidx.car.app.testing.ScreenController
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ApplicationProvider
import org.robolectric.Shadows.shadowOf
import androidx.lifecycle.Lifecycle
import androidx.car.app.testing.TestScreenManager
import androidx.car.app.testing.navigation.TestNavigationManager
import app.wayfinder.car.*
import app.wayfinder.car.bridge.CarManeuver
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.bridge.NavStatus
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.screens.HomeScreen
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

  /** The screen as the car runs it: on top, so it draws the map. */
  private fun driveScreen() = ScreenController(screens.screensPushed.last { it is NavigationScreen }).also { it.moveToState(Lifecycle.State.STARTED) }

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

  /** Off the old route and on a new one: the stretch driven since the trip began stays on the map. */
  @Test fun theRoadAlreadyDrivenStaysOnTheMap() {
    val scenes = RecordingScenes()
    NavigationCoordinator(carContext, api, scenes, ManeuverIcons(carContext)).attach()
    api.pushNav(Samples.nav().copy(position = LngLat(153.0, -27.4)))
    driveScreen()
    api.pushNav(Samples.nav(routeId = "r-reroute").copy(position = LngLat(153.001, -27.4)))
    api.pushNav(Samples.nav(routeId = "r-reroute").copy(position = LngLat(153.002, -27.4), speedLimitKmh = 60, speedKmh = 57))
    val shown = scenes.shown.last() as MapScene.Following
    assertEquals(listOf(LngLat(153.0, -27.4), LngLat(153.001, -27.4), LngLat(153.002, -27.4)), shown.travelled)
    assertEquals(60, shown.speedLimitKmh)
    assertEquals(57, shown.speedKmh)
    // The next trip starts with none.
    api.pushNav(null)
    api.pushNav(Samples.nav().copy(position = LngLat(152.0, -27.0)))
    driveScreen()
    assertEquals(listOf(LngLat(152.0, -27.0)), (scenes.shown.last() as MapScene.Following).travelled)
  }

  /** A trip already running when the car connects goes straight over Home; the map still gets its styles. */
  @Test fun theDrivingScreenMakesSureTheMapHasItsStyles() {
    var asked = 0
    api.navigation = Samples.nav()
    NavigationCoordinator(carContext, api, RecordingScenes(), ManeuverIcons(carContext), ensureStyles = { asked++ }).attach()
    driveScreen()
    assertEquals(1, asked)
  }

  /** The toast (CarToast) isn't observable under Robolectric; one report at a time is. */
  @Test fun reportAsksThePhoneOnceATap() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    val screen = screens.screensPushed.last { it is NavigationScreen } as NavigationScreen
    driveScreen()
    screen.report()
    screen.report() // a second tap while the first is on its way
    assertEquals(1, api.calls.count { it == "report" })
    api.answer("report", Unit)
    screen.report()
    api.fail("report", "Feedback is switched off.")
    screen.report()
    assertEquals("asked again after each answer", 3, api.calls.count { it == "report" })
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

  @Test fun backFromTheDriveCanReturnToIt() {
    ScreenController(HomeScreen(carContext, api, RecordingScenes()) { }).moveToState(Lifecycle.State.CREATED)
    coordinator.attach()
    api.pushNav(Samples.nav())
    driveScreen()
    screens.pop() // the driver pressed Back
    assertFalse(screens.top is NavigationScreen)
    coordinator.showDrive()
    assertTrue(screens.top is NavigationScreen)
    coordinator.showDrive()
    assertEquals("not stacked twice", 2, screens.screensPushed.count { it is NavigationScreen })
  }

  @Test fun noDriveToReturnToOnceTheTripHasEnded() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    api.pushNav(null)
    coordinator.showDrive()
    assertEquals(1, screens.screensPushed.count { it is NavigationScreen })
  }

  // Navigation notifications (NF-3)

  private val notifications get() = shadowOf(ApplicationProvider.getApplicationContext<Context>().getSystemService(NotificationManager::class.java))
  private fun posted(): Notification? = notifications.getNotification(NavNotifications.ID)
  private fun extender(n: Notification) = CarAppExtender(n)

  @Test fun postsOneOngoingNavigationNotificationWhenATripStarts() {
    coordinator.attach()
    assertNull("nothing before a trip", posted())
    api.pushNav(Samples.nav())
    val n = posted()!!
    assertEquals(1, notifications.size())
    assertEquals(NotificationCompat.CATEGORY_NAVIGATION, n.category)
    assertTrue(n.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertTrue(n.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
    assertEquals("Turn left onto Main St", n.extras.getString(Notification.EXTRA_TITLE))
    assertEquals("Turn left onto Main St", extender(n).contentTitle.toString())
    assertEquals("250 m · To Mt Coot-tha Lookout", extender(n).contentText.toString())
    assertNotNull(extender(n).contentIntent)
    assertEquals("a heads-up for the first instruction", NotificationManagerCompat.IMPORTANCE_HIGH, extender(n).importance)
    assertNotNull((ApplicationProvider.getApplicationContext<Context>().getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).getNotificationChannel(NavNotifications.CHANNEL_ID))
  }

  @Test fun updatesInPlaceWhenTheInstructionChangesAndStaysQuietOtherwise() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    api.pushNav(Samples.nav().copy(distanceToManeuverM = 120.0))
    assertEquals("120 m · To Mt Coot-tha Lookout", extender(posted()!!).contentText.toString())
    assertEquals("same instruction: a quiet update, not a heads-up", NotificationManagerCompat.IMPORTANCE_DEFAULT, extender(posted()!!).importance)
    api.pushNav(Samples.nav().copy(cue = "Turn right onto High St", maneuver = CarManeuver("right", null)))
    assertEquals(1, notifications.size())
    assertEquals("Turn right onto High St", posted()!!.extras.getString(Notification.EXTRA_TITLE))
    assertEquals(NotificationManagerCompat.IMPORTANCE_HIGH, extender(posted()!!).importance)
  }

  @Test fun aQuietUpdateIsNotAHeadsUp() {
    val before = Samples.nav()
    coordinator.attach()
    api.pushNav(before)
    val first = posted()
    // Nothing the notification shows has changed (only the time left), so it is left alone.
    api.pushNav(before.copy(remainingDurationS = 400.0))
    assertSame(first, posted())
  }

  @Test fun sayingArrivedAndNewRoutesInTheTitle() {
    coordinator.attach()
    api.pushNav(Samples.nav(rerouting = true))
    assertEquals("Finding a new route…", posted()!!.extras.getString(Notification.EXTRA_TITLE))
    api.pushNav(Samples.nav(status = NavStatus.ARRIVED))
    assertEquals("You’ve arrived", posted()!!.extras.getString(Notification.EXTRA_TITLE))
  }

  @Test fun takesTheNotificationDownWhenTheTripEnds() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    api.pushNav(null)
    assertNull(posted())
  }

  @Test fun takesTheNotificationDownWhenTheCarStopsTheTrip() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    nav.navigationManagerCallback!!.onStopNavigation()
    assertEquals("stop", api.calls.last())
    api.pushNav(null) // the phone ends the trip it was asked to stop
    assertNull(posted())
  }

  @Test fun takesTheNotificationDownWhenTheCarSessionEnds() {
    val detach = coordinator.attach()
    api.pushNav(Samples.nav())
    detach()
    assertNull(posted())
  }

  @Test fun tappingItBringsTheCarAppForward() {
    coordinator.attach()
    api.pushNav(Samples.nav())
    carContext.sendBroadcast(Intent(NavNotifications.ACTION_OPEN_APP).setPackage(carContext.packageName))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(1, carContext.startCarAppIntents.size)
  }

  // Test drive (NF-7)

  @Test fun autoDriveStartsATestDrive() {
    coordinator.attach()
    nav.navigationManagerCallback!!.onAutoDriveEnabled()
    assertEquals(listOf("simulate"), api.calls)
    api.answer("simulate", Unit)
    api.pushNav(Samples.nav())
    assertTrue("shown like any trip", screens.screensPushed.last() is NavigationScreen)
    assertEquals(1, nav.navigationStartedCount)
  }

  @Test fun theTestDriveEndsWithTheTripAndTheCarIsToldSo() {
    coordinator.attach()
    nav.navigationManagerCallback!!.onAutoDriveEnabled()
    api.answer("simulate", Unit)
    api.pushNav(Samples.nav())
    api.pushNav(null)
    assertEquals(1, nav.navigationEndedCount)
    assertNull(posted())
  }

  @Test fun aTestDriveIsStoppedWhenTheCarSessionEnds() {
    val detach = coordinator.attach()
    nav.navigationManagerCallback!!.onAutoDriveEnabled()
    api.answer("simulate", Unit)
    api.pushNav(Samples.nav())
    detach()
    assertEquals("stop", api.calls.last())
    assertEquals(1, nav.navigationEndedCount)
  }

  @Test fun aRealTripIsNotStoppedWhenTheCarSessionEnds() {
    val detach = coordinator.attach()
    api.pushNav(Samples.nav())
    detach()
    assertFalse(api.calls.contains("stop"))
  }

  @Test fun startingATestDriveOverARunningTripStillCountsAsATestDrive() {
    val detach = coordinator.attach()
    api.pushNav(Samples.nav())
    nav.navigationManagerCallback!!.onAutoDriveEnabled()
    api.pushNav(null) // the running trip is replaced: it ends first
    api.pushNav(Samples.nav(routeId = "test-drive"))
    api.answer("simulate", Unit)
    detach()
    assertEquals("stop", api.calls.last())
  }

  @Test fun aTestDriveThatCouldntStartIsNotLeftFlagged() {
    val detach = coordinator.attach()
    nav.navigationManagerCallback!!.onAutoDriveEnabled()
    api.fail("simulate", "Wayfinder on your phone isn’t answering.")
    api.pushNav(Samples.nav())
    detach()
    assertFalse("a real trip started later is left running", api.calls.contains("stop"))
  }
}
