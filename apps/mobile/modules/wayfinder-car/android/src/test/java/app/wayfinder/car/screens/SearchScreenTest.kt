package app.wayfinder.car.screens

import android.os.Looper
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
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SearchScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private val screen = SearchScreen(carContext, api, scenes, "Where to, explorer?")
  private val controller = ScreenController(screen).also { it.moveToState(Lifecycle.State.STARTED) }

  private fun pause(ms: Long = SearchScreen.TYPING_PAUSE_MS) = shadowOf(Looper.getMainLooper()).idleFor(ms, TimeUnit.MILLISECONDS)
  private fun template() = screen.onGetTemplate() as SearchTemplate
  private fun titles() = template().itemList!!.items.map { (it as Row).title.text() }

  @Test fun searchesOnceTheDriverPausesTypingAndShowsResultsOnTheMap() {
    screen.callback.onSearchTextChanged("co")
    pause()
    assertTrue("too short to search", api.calls.isEmpty())
    screen.callback.onSearchTextChanged("coo")
    screen.callback.onSearchTextChanged("coot")
    assertTrue("not while still typing", api.calls.isEmpty())
    pause()
    assertEquals("only the words typed when the typing stopped", listOf("search coot"), api.calls)
    assertTrue(template().isLoading)
    api.answer("search", listOf(Samples.place()))
    assertEquals("Where to, explorer?", template().searchHint)
    assertEquals(listOf("Mt Coot-tha Lookout"), titles())
    assertEquals(MapScene.Places(listOf(Samples.place())), scenes.shown.last())
  }

  @Test fun submittingSearchesStraightAway() {
    screen.callback.onSearchTextChanged("coot")
    screen.callback.onSearchSubmitted("coot-tha")
    assertEquals(listOf("search coot-tha"), api.calls)
    pause()
    assertEquals("the search waiting for a pause is dropped", listOf("search coot-tha"), api.calls)
  }

  /** The search key after the list for those words is already up: that list, at once (C-U3, C-U4). */
  @Test fun theSearchKeyUsesResultsAlreadyFoundForTheSameWords() {
    screen.callback.onSearchTextChanged("cle")
    pause()
    api.answer("search", listOf(Samples.place()))
    screen.callback.onSearchSubmitted(" cle ")
    assertEquals("no second search for the same words", listOf("search cle"), api.calls)
    val pushed = carContext.getCarService(TestScreenManager::class.java).screensPushed.last()
    assertTrue(pushed is PickScreen<*>)
  }

  @Test fun keepsTheLastResultsUpWhileTheNextLoad() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place()))
    screen.callback.onSearchSubmitted("coot-tha road")
    assertFalse("no spinner over results already there", template().isLoading)
    assertEquals(listOf("Mt Coot-tha Lookout"), titles())
    api.answer("search", listOf(Samples.place("p2", "Coot-tha Road")))
    assertEquals(listOf("Coot-tha Road"), titles())
  }

  @Test fun emptyingTheBoxClearsTheResults() {
    screen.callback.onSearchTextChanged("coot")
    pause()
    api.answer("search", listOf(Samples.place()))
    screen.callback.onSearchSubmitted("cootharaba")
    screen.callback.onSearchTextChanged("  ")
    api.answer("search", listOf(Samples.place("p3", "Cootharaba")))
    assertTrue("a late answer for words no longer there is dropped", titles().isEmpty())
    // Empty again: what to type, not the old "nothing found".
    assertEquals(SearchScreen.NOTHING_YET, template().itemList!!.noItemsMessage!!.text())
    assertEquals(MapScene.Places(emptyList()), scenes.shown.last())
  }

  @Test fun aSearchWaitingForAPauseDoesntRunOnceTheDriverHasLeft() {
    screen.callback.onSearchTextChanged("coot")
    controller.moveToState(Lifecycle.State.DESTROYED)
    pause()
    assertTrue(api.calls.isEmpty())
  }

  @Test fun dropsAnAnswerToAnOlderSearch() {
    screen.callback.onSearchTextChanged("coot")
    pause()
    screen.callback.onSearchSubmitted("coot-tha")
    api.answer("search", listOf(Samples.place("p2", "Coot-tha Road")))
    api.answerStale("search", listOf(Samples.place("p1", "Cootharaba")))
    assertEquals(listOf("Coot-tha Road"), titles())
  }

  @Test fun resultsAreNumberedAsTheirMarkersOnTheMap() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place(), Samples.place("p2", "Coot-tha Road")))
    assertEquals(listOf(numberIcon(1), numberIcon(2)), template().itemList!!.items.map { (it as Row).image })
  }

  @Test fun picksAPlaceToPlanTo() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place()))
    (template().itemList!!.items[0] as Row).click()
    assertTrue(carContext.getCarService(TestScreenManager::class.java).screensPushed.last() is RoutePreviewScreen)
  }

  @Test fun saysWhatWentWrong() {
    screen.callback.onSearchSubmitted("coot")
    api.fail("search", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", template().itemList!!.noItemsMessage.text())
  }

  @Test fun saysWhenNothingIsFound() {
    screen.callback.onSearchSubmitted("zzzz")
    api.answer("search", emptyList<Any>())
    assertEquals("Nothing found. Try another name or address.", template().itemList!!.noItemsMessage.text())
  }

  /** Coming back to Search, the box still says what the results beside it are for (C9). */
  @Test fun keepsTheWordsInTheBoxWithItsResults() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place()))
    assertEquals("coot", template().initialSearchText)
    assertFalse("results to see: no keyboard over them", template().isShowKeyboardByDefault)
  }

  /** One or two letters typed: say why nothing is there, rather than the car's bare "No items" (C37). */
  @Test fun saysToTypeMoreWhenTooFewLettersAreTyped() {
    screen.callback.onSearchTextChanged("co")
    assertEquals(SearchScreen.TOO_SHORT, template().itemList!!.noItemsMessage!!.text())
  }

  /** Before anything is typed, and while driving when typing can't be, your saved places are a tap away (C6, C48, C81). */
  @Test fun offersYourSavedPlacesBeforeAnythingIsTyped() {
    val withSaved = SearchScreen(carContext, api, scenes, "Where to?", listOf(Samples.saved("Home").copy(saved = true)))
    ScreenController(withSaved).moveToState(Lifecycle.State.STARTED)
    val row = (withSaved.onGetTemplate() as SearchTemplate).itemList!!.items.single() as Row
    assertEquals("Home", row.title.text())
    assertTrue(row.texts.single().text()!!.startsWith("Saved place · "))
  }

  @Test fun saysWhatToDoWhenThereIsNothingYet() {
    assertEquals(SearchScreen.NOTHING_YET, template().itemList!!.noItemsMessage!!.text())
  }

  /** The keyboard's search key puts the results on a map, which the search screen has no room for (C49). */
  @Test fun theSearchKeyShowsTheResultsOnTheMap() {
    screen.callback.onSearchSubmitted("coot")
    api.answer("search", listOf(Samples.place(), Samples.place("p2", "Coot Lane")))
    val screens = carContext.getCarService(androidx.car.app.testing.TestScreenManager::class.java)
    assertTrue(screens.screensPushed.last() is PickScreen<*>)
  }
}
