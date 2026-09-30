package app.wayfinder.car.nav

import android.content.Context
import androidx.car.app.model.CarIcon
import androidx.core.graphics.drawable.IconCompat
import app.wayfinder.car.R

class ManeuverIcons(private val context: Context) {
  fun iconFor(type: String): CarIcon {
    val res = when (type) {
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
      "roundabout" -> R.drawable.wf_roundabout
      "roundaboutExit" -> R.drawable.wf_roundabout_exit
      "waypoint", "destination" -> R.drawable.wf_destination
      else -> R.drawable.wf_straight
    }
    return CarIcon.Builder(IconCompat.createWithResource(context, res)).build()
  }
}
