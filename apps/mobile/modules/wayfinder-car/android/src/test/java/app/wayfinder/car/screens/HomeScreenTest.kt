package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.model.Row
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarFix
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HomeScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private var status: Any? = null
  private val screen = HomeScreen(carContext, api, scenes) { status = it }

  private fun open() = ScreenController(screen).moveToState(Lifecycle.State.STARTED)

  @Test fun waitsForTheAppThenOffersWhatTheDriverCanDo() {
    open()
    assertTrue((screen.onGetTemplate() as PlaceListNavigationTemplate).isLoading)
    api.answer("status", Samples.status())
    val t = screen.onGetTemplate() as PlaceListNavigationTemplate
    assertEquals(listOf("Search", "Discover nearby", "Planned routes"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Overview(Samples.status().here), scenes.shown.last())
    assertNotNull(status)
  }

  @Test fun opensSearch() {
    open()
    api.answer("status", Samples.status())
    ((screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is SearchScreen)
  }

  @Test fun asksToSignInOnThePhone() {
    open()
    api.answer("status", Samples.status(Account.SIGNED_OUT))
    assertEquals("When it’s safe, open Wayfinder on your phone and sign in.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }

  @Test fun saysWhenTheServerCantBeReachedAndTriesAgain() {
    open()
    api.answer("status", Samples.status(Account.OFFLINE))
    val t = screen.onGetTemplate() as MessageTemplate
    assertEquals("Can’t reach your server. Try again when your phone has signal.", t.message.text())
    assertEquals("Try again", t.actions.single().title.text())
  }

  @Test fun saysWhenThePhoneAppDoesntAnswer() {
    open()
    api.fail("status", "Wayfinder on your phone isn’t answering. When it’s safe, open it on your phone, then try again.")
    assertEquals("Wayfinder on your phone isn’t answering. When it’s safe, open it on your phone, then try again.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }

  private fun titles(t: Any?) = (t as PlaceListNavigationTemplate).itemList!!.items.map { (it as Row).title.text() }

  @Test fun offersAWayBackToDirectionsDuringATrip() {
    api.navigation = Samples.nav()
    open()
    api.answer("status", Samples.status())
    assertEquals(listOf("Back to directions", "Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
  }

  @Test fun showsTheWayBackOnlyWhileATripIsRunning() {
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.STARTED) }
    api.answer("status", Samples.status())
    api.pushNav(Samples.nav())
    assertEquals("Back to directions", titles(controller.templatesReturned.last()).first())
    val shown = controller.templatesReturned.size
    api.pushNav(Samples.nav().copy(remainingDistanceM = 3000.0))
    assertEquals("not redrawn on every fix", shown, controller.templatesReturned.size)
    api.pushNav(null)
    assertEquals(listOf("Search", "Discover nearby", "Planned routes"), titles(controller.templatesReturned.last()))
  }

  @Test fun offersTheWayBackEvenWhenTheServerCantBeReached() {
    api.navigation = Samples.nav()
    open()
    api.answer("status", Samples.status(Account.OFFLINE))
    assertEquals(listOf("Try again", "Back to directions"), (screen.onGetTemplate() as MessageTemplate).actions.map { it.title.text() })
  }

  @Test fun theWayBackReturnsToTheDrive() {
    var drives = 0
    val home = HomeScreen(carContext, api, scenes, onDrive = { drives++ }) { }
    api.navigation = Samples.nav()
    ScreenController(home).moveToState(Lifecycle.State.STARTED)
    api.answer("status", Samples.status())
    ((home.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    assertEquals(1, drives)
  }

  @Test fun tryAgainAsksTheAppAgain() {
    open()
    api.answer("status", Samples.status(Account.OFFLINE))
    (screen.onGetTemplate() as MessageTemplate).actions.single().onClickDelegate!!.sendClick(object : androidx.car.app.OnDoneCallback {})
    org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
    assertEquals(listOf("status", "status"), api.calls)
    assertTrue("waits for the new answer", (screen.onGetTemplate() as PlaceListNavigationTemplate).isLoading)
    api.answer("status", Samples.status())
    assertEquals(listOf("Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
  }

  /** A pretend trip on a real dashboard confused drivers (C35); the car's auto drive still starts one. */
  @Test fun noTestDriveRow() {
    open()
    api.answer("status", Samples.status())
    assertFalse("Test drive" in titles(screen.onGetTemplate()))
  }

  /** Each row has its own icon, so a glance finds it. */
  @Test fun everyRowHasItsOwnIcon() {
    api.navigation = Samples.nav()
    open()
    api.answer("status", Samples.status())
    val during = (screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items.map { (it as Row).image!!.icon!!.resId }
    assertEquals(listOf(R.drawable.wf_navigation, R.drawable.wf_search, R.drawable.wf_explore, R.drawable.wf_route), during)
    api.pushNav(null)
    val after = (screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items.map { (it as Row).image!!.icon!!.resId }
    assertEquals(R.drawable.wf_route, after.last())
    assertEquals("one icon each", after.size, after.toSet().size)
  }

  @Test fun homeIsOneTapAwayWithTheOtherSavedPlacesBehindOneRow() {
    open()
    api.answer("status", Samples.status(saved = listOf(Samples.saved("Home"), Samples.saved("Work"))))
    val t = screen.onGetTemplate() as PlaceListNavigationTemplate
    assertEquals(listOf("Home", "Saved places", "Search", "Discover nearby", "Planned routes"), titles(t))
    val home = t.itemList!!.items[0] as Row
    assertEquals("12 Moselle Drive · 25 km away", home.texts.single().text())
    assertEquals(R.drawable.wf_home, home.image!!.icon!!.resId)
    home.click()
    val pushed = carContext.getCarService(TestScreenManager::class.java).screensPushed.last()
    assertTrue(pushed is RoutePreviewScreen)
    ScreenController(pushed).moveToState(Lifecycle.State.STARTED)
    assertEquals("plans the way there", "plan s-Home", api.calls.last())
  }

  @Test fun savedPlacesOpenAsAListToPickFrom() {
    open()
    api.answer("status", Samples.status(saved = listOf(Samples.saved("Gym"), Samples.saved("Work"))))
    assertEquals("no Home saved: no Home row", listOf("Saved places", "Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
    ((screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    val list = carContext.getCarService(TestScreenManager::class.java).screensPushed.last()
    ScreenController(list).moveToState(Lifecycle.State.STARTED)
    assertEquals(listOf("Gym", "Work"), titles(list.onGetTemplate()))
  }

  /** The phone says which saved place is Home, however it was written ("Home 🏠", "My house"). */
  @Test fun findsHomeByWhatThePhoneSaysNotOnlyItsName() {
    open()
    api.answer("status", Samples.status(saved = listOf(Samples.saved("My house").copy(home = true), Samples.saved("Work"))))
    assertEquals(listOf("My house", "Saved places", "Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
  }

  @Test fun onlyHomeSavedNeedsNoSavedPlacesRow() {
    open()
    api.answer("status", Samples.status(saved = listOf(Samples.saved("home"))))
    assertEquals(listOf("home", "Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
  }

  @Test fun neverMoreThanSixRowsDuringATrip() {
    api.navigation = Samples.nav()
    open()
    api.answer("status", Samples.status(saved = listOf(Samples.saved("Home"), Samples.saved("Work"))))
    assertEquals(listOf("Back to directions", "Home", "Saved places", "Search", "Discover nearby", "Planned routes"), titles(screen.onGetTemplate()))
  }

  private class Feed {
    val listeners = mutableListOf<(CarFix) -> Unit>()
    fun listen(l: (CarFix) -> Unit): () -> Unit { listeners += l; return { listeners -= l } }
    fun send(f: CarFix) = listeners.toList().forEach { it(f) }
  }
  private val fix = CarFix(153.25, -27.56, 5.0, 16.7, 182.0, 1L)

  @Test fun withNoTripTheMapFollowsTheCarWhileHomeIsShowing() {
    val feed = Feed()
    val home = HomeScreen(carContext, api, scenes, fixes = feed::listen) { }
    val controller = ScreenController(home).also { it.moveToState(Lifecycle.State.STARTED) }
    api.answer("status", Samples.status())
    assertEquals(1, feed.listeners.size)
    feed.send(fix)
    val s = scenes.shown.last() as MapScene.Following
    assertEquals(182.0, s.headingDeg!!, 0.0)
    assertEquals(60, s.speedKmh)
    assertTrue(api.calls.last().startsWith("speedLimit"))
    controller.moveToState(Lifecycle.State.CREATED) // Search on top
    assertTrue("stops listening under another screen", feed.listeners.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED)
    api.answer("status", Samples.status())
    assertEquals(1, feed.listeners.size)
  }

  @Test fun theMapIsLeftToTheTripDuringOne() {
    val feed = Feed()
    api.navigation = Samples.nav()
    val home = HomeScreen(carContext, api, scenes, fixes = feed::listen) { }
    ScreenController(home).moveToState(Lifecycle.State.STARTED)
    api.answer("status", Samples.status())
    feed.send(fix)
    assertFalse(scenes.shown.any { it is MapScene.Following })
  }

  @Test fun signedOutTheMapStaysStill() {
    val feed = Feed()
    val home = HomeScreen(carContext, api, scenes, fixes = feed::listen) { }
    ScreenController(home).moveToState(Lifecycle.State.STARTED)
    api.answer("status", Samples.status(Account.SIGNED_OUT))
    feed.send(fix)
    assertFalse(scenes.shown.any { it is MapScene.Following })
  }

  /** No planned routes: no row that only says so, keeping the list short enough to see (C4). */
  @Test fun plannedRoutesOnlyWhenThereAreSome() {
    open()
    api.answer("status", Samples.status().copy(plannedRoutes = 0))
    assertFalse(titles(screen.onGetTemplate()).contains("Planned routes"))
  }

  /** A place saved on the phone shows up without leaving Home (C78). */
  @Test fun asksAgainWhileShowing() {
    open()
    api.answer("status", Samples.status())
    org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(HomeScreen.REFRESH_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
    api.answer("status", Samples.status(saved = listOf(Samples.saved("Home").copy(saved = true, home = true))))
    assertTrue(titles(screen.onGetTemplate()).contains("Home"))
  }

  /** Parked, the whole description ran to five lines and pushed Discover off the screen (R2-C4). */
  /** Driving, Home asked the phone, and the phone the server twice, every 30 s of the whole drive. */
  @Test fun asksLessOftenWhileTheCarIsMoving() {
    val feed = Feed()
    val home = HomeScreen(carContext, api, scenes, fixes = feed::listen) { }
    ScreenController(home).moveToState(Lifecycle.State.STARTED)
    api.answer("status", Samples.status())
    feed.send(fix)
    val looper = org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper())
    val asked = { api.calls.count { it == "status" } }
    looper.idleFor(HomeScreen.REFRESH_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
    assertEquals("the refresh already due still runs", 2, asked())
    api.answer("status", Samples.status())
    looper.idleFor(HomeScreen.REFRESH_MS * 2, java.util.concurrent.TimeUnit.MILLISECONDS)
    assertEquals("not again within a minute while moving", 2, asked())
    looper.idleFor(HomeScreen.REFRESH_MOVING_MS - HomeScreen.REFRESH_MS * 2, java.util.concurrent.TimeUnit.MILLISECONDS)
    assertEquals(3, asked())
    api.answer("status", Samples.status())
    feed.send(fix.copy(speedMps = 0.0))
    looper.idleFor(HomeScreen.REFRESH_MOVING_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
    assertEquals(4, asked())
    api.answer("status", Samples.status())
    looper.idleFor(HomeScreen.REFRESH_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
    assertEquals("stopped: every 30 s again", 5, asked())
  }

  @Test fun homesLineIsHowFarAndWhatItIs() {
    assertEquals("4.3 km away · Bunnings Warehouse", HomeScreen.shortDetail("4.3 km away · Bunnings Warehouse, Hardware store · Victoria Point QLD 4165"))
    assertEquals("Lookout · 6.2 km away", HomeScreen.shortDetail("Lookout · 6.2 km away"))
    assertEquals("", HomeScreen.shortDetail(""))
  }
}
