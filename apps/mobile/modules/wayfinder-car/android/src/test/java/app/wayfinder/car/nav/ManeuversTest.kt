package app.wayfinder.car.nav

import androidx.car.app.navigation.model.Maneuver
import app.wayfinder.car.bridge.CarManeuver
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ManeuversTest {
  @Test fun turns() {
    assertEquals(Maneuver.TYPE_TURN_NORMAL_LEFT, Maneuvers.typeOf(CarManeuver("left", null)))
    assertEquals(Maneuver.TYPE_TURN_SHARP_RIGHT, Maneuvers.typeOf(CarManeuver("sharpRight", null)))
    assertEquals(Maneuver.TYPE_KEEP_LEFT, Maneuvers.typeOf(CarManeuver("keepLeft", null)))
    assertEquals(Maneuver.TYPE_U_TURN_RIGHT, Maneuvers.typeOf(CarManeuver("uTurnRight", null)))
    assertEquals(Maneuver.TYPE_DESTINATION, Maneuvers.typeOf(CarManeuver("destination", null)))
  }

  @Test fun roundaboutsGoClockwiseAsQueenslandDrivesOnTheLeft() {
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW, Maneuvers.typeOf(CarManeuver("roundabout", 2)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_CW, Maneuvers.typeOf(CarManeuver("roundabout", null)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_CW, Maneuvers.typeOf(CarManeuver("roundabout", 0)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_ENTER_CW, Maneuvers.typeOf(CarManeuver("roundabout", -1)))
    assertEquals(Maneuver.TYPE_ROUNDABOUT_EXIT_CW, Maneuvers.typeOf(CarManeuver("roundaboutExit", null)))
  }

  @Test fun anythingNewIsStraightOn() = assertEquals(Maneuver.TYPE_STRAIGHT, Maneuvers.typeOf(CarManeuver("hover", null)))
}
