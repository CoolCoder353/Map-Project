package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.model.Row
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.Account
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
    assertEquals(listOf("Search", "Planned routes", "Discover nearby"), t.itemList!!.items.map { (it as Row).title.text() })
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
    assertEquals("Open Wayfinder on your phone and sign in.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }

  @Test fun saysWhenTheServerCantBeReachedAndTriesAgain() {
    open()
    api.answer("status", Samples.status(Account.OFFLINE))
    val t = screen.onGetTemplate() as MessageTemplate
    assertEquals("Can’t reach your server. Check your phone has signal, then try again.", t.message.text())
    assertEquals("Try again", t.actions.single().title.text())
  }

  @Test fun saysWhenThePhoneAppDoesntAnswer() {
    open()
    api.fail("status", "Wayfinder on your phone isn’t answering. Open it on your phone, then try again.")
    assertEquals("Wayfinder on your phone isn’t answering. Open it on your phone, then try again.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }

  private fun titles(t: Any?) = (t as PlaceListNavigationTemplate).itemList!!.items.map { (it as Row).title.text() }

  @Test fun offersAWayBackToDirectionsDuringATrip() {
    api.navigation = Samples.nav()
    open()
    api.answer("status", Samples.status())
    assertEquals(listOf("Back to directions", "Search", "Planned routes", "Discover nearby"), titles(screen.onGetTemplate()))
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
    assertEquals(listOf("Search", "Planned routes", "Discover nearby"), titles(controller.templatesReturned.last()))
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
}
