package app.wayfinder.car.nav

import androidx.car.app.navigation.model.Maneuver
import app.wayfinder.car.bridge.CarManeuver

/** The app's manoeuvre kinds (src/car/navModel.ts) as Android Auto's. Roundabouts run clockwise: Queensland drives on the left. */
object Maneuvers {
  fun typeOf(m: CarManeuver): Int = when (m.type) {
    "slightLeft" -> Maneuver.TYPE_TURN_SLIGHT_LEFT
    "left" -> Maneuver.TYPE_TURN_NORMAL_LEFT
    "sharpLeft" -> Maneuver.TYPE_TURN_SHARP_LEFT
    "slightRight" -> Maneuver.TYPE_TURN_SLIGHT_RIGHT
    "right" -> Maneuver.TYPE_TURN_NORMAL_RIGHT
    "sharpRight" -> Maneuver.TYPE_TURN_SHARP_RIGHT
    "keepLeft" -> Maneuver.TYPE_KEEP_LEFT
    "keepRight" -> Maneuver.TYPE_KEEP_RIGHT
    "uTurnLeft" -> Maneuver.TYPE_U_TURN_LEFT
    "uTurnRight" -> Maneuver.TYPE_U_TURN_RIGHT
    "roundabout" -> if (m.exit != null) Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW else Maneuver.TYPE_ROUNDABOUT_ENTER_CW
    "roundaboutExit" -> Maneuver.TYPE_ROUNDABOUT_EXIT_CW
    // Android Auto has no waypoint manoeuvre; the cue says "waypoint".
    "waypoint", "destination" -> Maneuver.TYPE_DESTINATION
    else -> Maneuver.TYPE_STRAIGHT
  }
}
