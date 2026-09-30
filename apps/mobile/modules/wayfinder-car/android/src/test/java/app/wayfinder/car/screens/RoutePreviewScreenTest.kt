package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import androidx.car.app.testing.ScreenController
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoutePreviewScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private val options = listOf(Samples.option("r-fast", "Fastest"), Samples.option("r-exp", "Explore 1"))
  private val screen = RoutePreviewScreen.forPlace(carContext, api, scenes, Samples.place()).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }

  @Test fun comparesTheFastestWithWaysYouHaventBeen() {
    assertEquals(listOf("plan p1"), api.calls)
    assertTrue((screen.onGetTemplate() as RoutePreviewNavigationTemplate).isLoading)
    api.answer("plan", PlanResult(options, null))
    val t = screen.onGetTemplate() as RoutePreviewNavigationTemplate
    assertEquals(listOf("Fastest", "Explore 1"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Routes(options, 0), scenes.shown.last())
  }

  @Test fun startsTheOneTheDriverChose() {
    api.answer("plan", PlanResult(options, null))
    screen.select(1)
    assertEquals(MapScene.Routes(options, 1), scenes.shown.last())
    screen.go()
    assertEquals("start r-exp Mt Coot-tha Lookout", api.calls.last())
    assertEquals("Starting…", (screen.onGetTemplate() as RoutePreviewNavigationTemplate).navigateAction!!.title.text())
  }

  @Test fun explainsWhyThereIsOnlyOneWay() {
    api.answer("plan", PlanResult(options.take(1), "No other ways fit within your extra time."))
    val row = (screen.onGetTemplate() as RoutePreviewNavigationTemplate).itemList!!.items[0] as Row
    assertEquals("No other ways fit within your extra time.", row.texts[1].text())
  }

  @Test fun saysWhenNoRouteCanBeFound() {
    api.fail("plan", "No route found. Try somewhere nearer a road.")
    assertEquals("No route found. Try somewhere nearer a road.", (screen.onGetTemplate() as MessageTemplate).message.text())
  }
}
