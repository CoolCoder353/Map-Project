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

  @Test fun waitsForTheFirstFix() = assertTrue((template(Samples.nav(status = NavStatus.STARTING, maneuver = null)).navigationInfo as RoutingInfo).isLoading)
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

  @Test fun aRoundaboutWithoutAUsableExitStillBuilds() {
    for (exit in listOf(null, 0, -1)) {
      assertEquals("exit $exit", Maneuver.TYPE_ROUNDABOUT_ENTER_CW, maneuverOf(Samples.nav(maneuver = CarManeuver("roundabout", exit))).type)
    }
  }
}
