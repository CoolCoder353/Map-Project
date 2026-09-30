package app.wayfinder.car.screens

import androidx.car.app.model.Row
import androidx.car.app.model.SearchTemplate
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SearchScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private val screen = SearchScreen(carContext, api, scenes, "Where to, explorer?").also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }

  @Test fun searchesAsTheDriverTypesAndShowsResultsOnTheMap() {
    screen.callback.onSearchTextChanged("co")
    assertTrue("too short to search", api.calls.isEmpty())
    screen.callback.onSearchTextChanged("coot")
    assertTrue((screen.onGetTemplate() as SearchTemplate).isLoading)
    api.answer("search", listOf(Samples.place()))
    val t = screen.onGetTemplate() as SearchTemplate
    assertEquals("Where to, explorer?", t.searchHint)
    assertEquals(listOf("Mt Coot-tha Lookout"), t.itemList!!.items.map { (it as Row).title.text() })
    assertEquals(MapScene.Places(listOf(Samples.place())), scenes.shown.last())
  }

  @Test fun dropsAnAnswerToAnOlderSearch() {
    screen.callback.onSearchTextChanged("coot")
    screen.callback.onSearchSubmitted("coot-tha")
    api.answer("search", listOf(Samples.place("p2", "Coot-tha Road")))
    api.answerStale("search", listOf(Samples.place("p1", "Cootharaba")))
    assertEquals(listOf("Coot-tha Road"), (screen.onGetTemplate() as SearchTemplate).itemList!!.items.map { (it as Row).title.text() })
  }

  @Test fun picksAPlaceToPlanTo() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place()))
    ((screen.onGetTemplate() as SearchTemplate).itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
  }

  @Test fun saysWhatWentWrong() {
    screen.callback.onSearchSubmitted("coot")
    api.fail("search", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", (screen.onGetTemplate() as SearchTemplate).itemList!!.noItemsMessage.text())
  }
}
