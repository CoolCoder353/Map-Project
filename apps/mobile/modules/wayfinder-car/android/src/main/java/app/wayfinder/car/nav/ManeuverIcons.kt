package app.wayfinder.car.nav

import android.content.Context
import androidx.car.app.model.CarIcon
import androidx.core.graphics.drawable.IconCompat
import app.wayfinder.car.R
import app.wayfinder.car.bridge.CarManeuver

class ManeuverIcons(private val context: Context) {
  private val roundabouts = HashMap<Int, CarIcon>()

  fun iconFor(type: String): CarIcon = CarIcon.Builder(IconCompat.createWithResource(context, resFor(type))).build()

  /** A roundabout whose exit is known is drawn with that exit (see [RoundaboutIcon]). */
  fun iconFor(m: CarManeuver): CarIcon {
    val angle = m.exitAngleDeg?.takeIf { m.type == "roundabout" && it in 1..360 } ?: return iconFor(m.type)
    // Rounded to 5°: the same exit drawn again as the trip updates every second.
    val key = ((angle + 2) / 5 * 5).coerceIn(5, 360)
    return roundabouts.getOrPut(key) { CarIcon.Builder(IconCompat.createWithBitmap(RoundaboutIcon.draw(key))).build() }
  }

  /** The drawable for a manoeuvre; also the small icon of the navigation notification. */
  fun resFor(type: String): Int =
    when (type) {
      "slightLeft" -> R.drawable.wf_turn_slight_left
      "left" -> R.drawable.wf_turn_left
      "sharpLeft" -> R.drawable.wf_turn_sharp_left
      "slightRight" -> R.drawable.wf_turn_slight_right
      "right" -> R.drawable.wf_turn_right
      "sharpRight" -> R.drawable.wf_turn_sharp_right
      "keepLeft" -> R.drawable.wf_keep_left
      "keepRight" -> R.drawable.wf_keep_right
      "uTurnLeft" -> R.drawable.wf_u_turn_left
      "uTurnRight" -> R.drawable.wf_u_turn_right
      // Queensland drives on the left, so roundabouts run clockwise: one clockwise glyph serves
      // both entering and leaving (Material's "roundabout_right"; its "roundabout_left" is anticlockwise).
      "roundabout", "roundaboutExit" -> R.drawable.wf_roundabout_cw
      "waypoint", "destination" -> R.drawable.wf_destination
      else -> R.drawable.wf_straight
    }
}
