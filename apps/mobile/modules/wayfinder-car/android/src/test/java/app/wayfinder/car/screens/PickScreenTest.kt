package app.wayfinder.car.screens

import androidx.car.app.model.Row
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.PlannedItem
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PickScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()

  @Test fun discoverListsPlacesInUnexploredAreas() {
    val screen = PickScreens.discover(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    assertTrue((screen.onGetTemplate() as PlaceListNavigationTemplate).isLoading)
    api.answer("discover", listOf(Samples.place()))
    val t = screen.onGetTemplate() as PlaceListNavigationTemplate
    assertEquals("Lookout · 6.2 km away", (t.itemList!!.items[0] as Row).texts[0].text())
    assertEquals(MapScene.Places(listOf(Samples.place())), scenes.shown.last())
    (t.itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
  }

  @Test fun plannedSaysWhenThereAreNone() {
    val screen = PickScreens.planned(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    api.answer("planned", emptyList<PlannedItem>())
    assertEquals("Nothing planned for driving. Send a route from the website.", (screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.noItemsMessage.text())
  }

  @Test fun plannedGoesStraightToItsRoute() {
    val screen = PickScreens.planned(carContext, api, scenes).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
    api.answer("planned", listOf(PlannedItem("pl1", "Sunday drive", Samples.option("r-sun", "Sunday drive"))))
    ((screen.onGetTemplate() as PlaceListNavigationTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
    assertFalse("a planned route needs no planning", api.calls.any { it.startsWith("plan ") })
  }
}
