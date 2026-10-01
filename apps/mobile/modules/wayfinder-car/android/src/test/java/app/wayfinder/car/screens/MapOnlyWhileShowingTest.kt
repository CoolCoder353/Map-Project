package app.wayfinder.car.screens

import androidx.car.app.testing.ScreenController
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.nav.ManeuverIcons
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** An answer that arrives after the driver has left a screen must not repaint the map under the screen on top. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MapOnlyWhileShowingTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()

  @Test fun homeLeavesTheMapAloneUntilItIsBackOnTop() {
    val screen = HomeScreen(carContext, api, scenes) { }
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.STARTED) }
    controller.moveToState(Lifecycle.State.CREATED) // another screen covers Home
    api.answer("status", Samples.status())
    assertTrue(scenes.shown.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED) // back on top: reloads and shows the overview
    api.answer("status", Samples.status())
    assertEquals(listOf<MapScene>(MapScene.Overview(Samples.status().here)), scenes.shown)
  }

  @Test fun searchResultsAreMarkedOnlyWhileSearchIsOnTop() {
    val screen = SearchScreen(carContext, api, scenes, "Where to?")
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.STARTED) }
    screen.callback.onSearchSubmitted("coot")
    controller.moveToState(Lifecycle.State.CREATED)
    api.answer("search", listOf(Samples.place()))
    assertTrue(scenes.shown.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED)
    assertEquals(listOf<MapScene>(MapScene.Places(listOf(Samples.place()))), scenes.shown)
  }

  @Test fun aPickListIsMarkedOnlyWhileItIsOnTop() {
    val screen = PickScreens.discover(carContext, api, scenes)
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.CREATED) }
    api.answer("discover", listOf(Samples.place()))
    assertTrue(scenes.shown.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED)
    assertEquals(listOf<MapScene>(MapScene.Places(listOf(Samples.place()))), scenes.shown)
  }

  @Test fun aRoutePreviewIsDrawnOnlyWhileItIsOnTop() {
    val options = listOf(Samples.option("r-fast", "Fastest"), Samples.option("r-exp", "Explore 1"))
    val screen = RoutePreviewScreen.forPlace(carContext, api, scenes, Samples.place())
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.CREATED) }
    api.answer("plan", PlanResult(options, null))
    assertTrue(scenes.shown.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED)
    assertEquals(listOf<MapScene>(MapScene.Routes(options, 0)), scenes.shown)
  }

  @Test fun theDriveScreenFollowsYouOnlyWhileItIsOnTop() {
    api.navigation = Samples.nav()
    val screen = NavigationScreen(carContext, api, scenes, ManeuverIcons(carContext))
    val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.CREATED) }
    api.pushNav(Samples.nav())
    assertTrue(scenes.shown.isEmpty())
    controller.moveToState(Lifecycle.State.STARTED)
    assertTrue(scenes.shown.last() is MapScene.Following)
  }
}
