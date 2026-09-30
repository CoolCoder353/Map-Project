package app.wayfinder.car.screens

import android.text.Spanned
import androidx.car.app.model.DurationSpan
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

  private fun rowsOf() = (screen.onGetTemplate() as RoutePreviewNavigationTemplate).itemList!!.items.map { it as Row }

  private fun durationSpans(row: Row): List<Triple<Int, Int, Long>> {
    val text = row.texts[0].toCharSequence() as Spanned
    return text.getSpans(0, text.length, DurationSpan::class.java).map { Triple(text.getSpanStart(it), text.getSpanEnd(it), it.durationSeconds) }
  }

  @Test fun marksOnlyTheLeadingDurationSoTheExtraTimeStaysReadable() {
    val detail = "32 min (7 min longer) · 9.4 km you’ve never been"
    val slower = Samples.option("r-exp", "Explore 1").copy(detail = detail, durationS = 1920.0)
    val unbracketed = Samples.option("r-x", "Explore 2").copy(detail = "40 min · 3 km you’ve never been", durationS = 2400.0)
    val plain = Samples.option("r-y", "Explore 3").copy(detail = "50 min", durationS = 3000.0)
    api.answer("plan", PlanResult(listOf(slower, unbracketed, plain), null))
    val rows = rowsOf()
    assertEquals(detail, rows[0].texts[0].text())
    assertEquals(listOf(Triple(0, "32 min".length, 1920L)), durationSpans(rows[0]))
    assertEquals(listOf(Triple(0, "40 min".length, 2400L)), durationSpans(rows[1]))
    assertEquals(listOf(Triple(0, "50 min".length, 3000L)), durationSpans(rows[2]))
  }

  @Test fun aRouteWithNoDescriptionStillShowsItsDuration() {
    api.answer("plan", PlanResult(listOf(Samples.option("r-fast", "Fastest").copy(detail = "", durationS = 1500.0)), null))
    val row = rowsOf()[0]
    assertEquals("25 min", row.texts[0].text())
    assertEquals(listOf(Triple(0, "25 min".length, 1500L)), durationSpans(row))
  }

  @Test fun ignoresSelectionsOutsideTheList() {
    api.answer("plan", PlanResult(options, null))
    screen.select(5)
    assertEquals(MapScene.Routes(options, 1), scenes.shown.last())
    assertEquals(1, (screen.onGetTemplate() as RoutePreviewNavigationTemplate).itemList!!.selectedIndex)
    screen.select(-2)
    assertEquals(MapScene.Routes(options, 0), scenes.shown.last())
    assertEquals(0, (screen.onGetTemplate() as RoutePreviewNavigationTemplate).itemList!!.selectedIndex)
  }

  private fun goTitle() = (screen.onGetTemplate() as RoutePreviewNavigationTemplate).navigateAction!!.title.text()
  private fun starts() = api.calls.count { it.startsWith("start ") }

  @Test fun aSecondTapWhileStartingDoesNotStartAnotherTrip() {
    api.answer("plan", PlanResult(options, null))
    screen.go()
    screen.go()
    assertEquals(1, starts())
    assertEquals("Starting…", goTitle())
  }

  @Test fun staysOnStartingOnceTheTripHasStarted() {
    api.answer("plan", PlanResult(options, null))
    screen.go()
    api.answer("start", Unit)
    assertEquals("Starting…", goTitle())
    screen.go()
    assertEquals(1, starts())
  }

  // The failure toast (CarToast) isn't observable under Robolectric, so only the reset is asserted.
  @Test fun offersGoAgainWhenStartingFails() {
    api.answer("plan", PlanResult(options, null))
    screen.go()
    api.fail("start", "Couldn’t start. Try again.")
    assertEquals("Go", goTitle())
    screen.go()
    assertEquals(2, starts())
  }
}
