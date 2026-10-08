package app.wayfinder.car.nav

import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.RoutingInfo
import androidx.test.core.app.ApplicationProvider
import app.wayfinder.car.Samples
import app.wayfinder.car.bridge.CarManeuver
import app.wayfinder.car.bridge.NavStatus
import app.wayfinder.car.bridge.NextStep
import app.wayfinder.car.text
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavTemplatesTest {
  private val icons = ManeuverIcons(ApplicationProvider.getApplicationContext())
  private fun template(nav: app.wayfinder.car.bridge.CarNav?) = NavTemplates.navigation(nav, icons, onEnd = {}, onMute = {})

  @Test fun showsTheNextTurnHowFarAndWhenYouArrive() {
    val t = template(Samples.nav().copy(next = NextStep(CarManeuver("right", null), "Turn right")))
    val info = t.navigationInfo as RoutingInfo
    assertEquals("Turn left onto Main St", info.currentStep!!.cue.text())
    assertEquals("Main St", info.currentStep!!.road.text())
    assertEquals(250.0, info.currentDistance!!.displayDistance, 0.0)
    assertEquals("Turn right", info.nextStep!!.cue.text())
    assertEquals(500L, t.destinationTravelEstimate!!.remainingTimeSeconds)
    assertEquals(listOf("Mute", "End"), t.actionStrip!!.actions.map { it.title.text() })
  }

  /** A spinner that never stops reads as the car app hanging; this says what it's waiting for. */
  @Test fun saysItIsFindingYouBeforeTheFirstFix() {
    val info = template(Samples.nav(status = NavStatus.STARTING, maneuver = null)).navigationInfo as MessageInfo
    assertEquals(NavTemplates.FINDING_YOU, info.title.text())
    assertEquals("To Mt Coot-tha Lookout", info.text.text())
  }
  @Test fun loadsUntilThereIsATrip() = assertTrue((template(null).navigationInfo as RoutingInfo).isLoading)

  @Test fun saysWhenItIsFindingANewRoute() =
    assertEquals("Finding a new route…", (template(Samples.nav(rerouting = true)).navigationInfo as MessageInfo).title.text())

  @Test fun passesOnProblems() =
    assertEquals("Navigation needs location permission.", (template(Samples.nav(error = "Navigation needs location permission.")).navigationInfo as MessageInfo).title.text())

  @Test fun saysWhenYouAreOffRoute() =
    assertEquals("Off route", (template(Samples.nav(status = NavStatus.OFF_ROUTE)).navigationInfo as MessageInfo).title.text())

  @Test fun arrives() {
    val t = template(Samples.nav(status = NavStatus.ARRIVED, muted = true))
    val info = t.navigationInfo as MessageInfo
    assertEquals("You’ve arrived", info.title.text())
    assertEquals("Mt Coot-tha Lookout", info.text.text())
    assertEquals(listOf("Unmute", "Done"), t.actionStrip!!.actions.map { it.title.text() })
    assertNull(t.destinationTravelEstimate)
  }

  @Test fun tellsTheCarAboutTheTrip() {
    val trip = NavTemplates.trip(Samples.nav(), icons)
    assertEquals("Mt Coot-tha Lookout", trip.destinations.single().name.text())
    assertEquals("Main St", trip.currentRoad.text())
  }

  @Test fun theCarsStepEstimateIsHowFarToTheTurnNotTheDestination() {
    val trip = NavTemplates.trip(Samples.nav(), icons)
    assertEquals(250.0, trip.stepTravelEstimates.single().remainingDistance!!.displayDistance, 0.0)
    assertEquals(4.0, trip.destinationTravelEstimates.single().remainingDistance!!.displayDistance, 0.0)
    assertEquals(500L, trip.stepTravelEstimates.single().remainingTimeSeconds)
  }

  private fun maneuverOf(nav: app.wayfinder.car.bridge.CarNav) =
    ((template(nav).navigationInfo as RoutingInfo).currentStep!!.maneuver!!)

  @Test fun aRoundaboutWithAnExitNamesIt() {
    val m = maneuverOf(Samples.nav(maneuver = CarManeuver("roundabout", 2)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW, m.type)
    assertEquals(2, m.roundaboutExitNumber)
  }

  @Test fun aRoundaboutDrawsTheExitYouTake() {
    val m = maneuverOf(Samples.nav(maneuver = CarManeuver("roundabout", 3, 268)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW_WITH_ANGLE, m.type)
    assertEquals(3, m.roundaboutExitNumber)
    assertEquals(268, m.roundaboutExitAngle)
    assertEquals(androidx.core.graphics.drawable.IconCompat.TYPE_BITMAP, m.icon!!.icon!!.type)
  }

  private fun click(a: androidx.car.app.model.Action) {
    a.onClickDelegate!!.sendClick(object : androidx.car.app.OnDoneCallback {})
    org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
  }

  @Test fun reportAndTheMapButtons() {
    val icon = icons.iconFor("straight")
    val zooms = mutableListOf<Double>()
    var recentred = 0
    fun withMap(panned: Boolean) = NavTemplates.navigation(Samples.nav(), icons, onEnd = {}, onMute = {}, onReport = {}, map = MapButtons(panned, icon, icon, icon, { zooms += it }, { recentred++ }))
    val t = withMap(panned = false)
    assertEquals(listOf("Mute", "Report", "End"), t.actionStrip!!.actions.map { it.title.text() })
    val mapActions = t.mapActionStrip!!.actions
    assertEquals(listOf(androidx.car.app.model.Action.TYPE_PAN, androidx.car.app.model.Action.TYPE_CUSTOM, androidx.car.app.model.Action.TYPE_CUSTOM), mapActions.map { it.type })
    assertNotNull(t.panModeDelegate)
    click(mapActions[1])
    click(mapActions[2])
    assertEquals(listOf(1.0, -1.0), zooms)
    // Moved away from the car: a way back to following it.
    val panned = withMap(panned = true).mapActionStrip!!.actions
    assertEquals(4, panned.size)
    click(panned[1])
    assertEquals(1, recentred)
    // No trip yet: nothing to report on.
    assertEquals(listOf("Mute", "End"), NavTemplates.navigation(null, icons, onEnd = {}, onMute = {}, onReport = {}).actionStrip!!.actions.map { it.title.text() })
  }

  @Test fun aRoundaboutWithoutAUsableExitStillBuilds() {
    for (exit in listOf(null, 0, -1)) {
      assertEquals("exit $exit", Maneuver.TYPE_ROUNDABOUT_ENTER_CW, maneuverOf(Samples.nav(maneuver = CarManeuver("roundabout", exit))).type)
    }
  }
}
