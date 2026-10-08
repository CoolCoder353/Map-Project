package app.wayfinder.car.nav

import androidx.test.core.app.ApplicationProvider
import app.wayfinder.car.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ManeuverIconsTest {
  private val icons = ManeuverIcons(ApplicationProvider.getApplicationContext())
  private fun res(type: String) = icons.iconFor(type).icon!!.resId

  /** Queensland drives on the left: roundabouts, and so their arrows, run clockwise. */
  @Test fun roundaboutsUseTheClockwiseArrow() {
    assertEquals(R.drawable.wf_roundabout_cw, res("roundabout"))
    assertEquals(R.drawable.wf_roundabout_cw, res("roundaboutExit"))
  }

  @Test fun aRoundaboutWithAKnownExitIsDrawnWithIt() {
    val left = icons.iconFor(app.wayfinder.car.bridge.CarManeuver("roundabout", 1, 88)).icon!!
    assertEquals(androidx.core.graphics.drawable.IconCompat.TYPE_BITMAP, left.type)
    assertSame("the same exit isn't drawn again on every update", left, icons.iconFor(app.wayfinder.car.bridge.CarManeuver("roundabout", 1, 89)).icon)
    assertNotSame(left, icons.iconFor(app.wayfinder.car.bridge.CarManeuver("roundabout", 3, 268)).icon)
    // Without the angle, the one clockwise glyph.
    assertEquals(R.drawable.wf_roundabout_cw, icons.iconFor(app.wayfinder.car.bridge.CarManeuver("roundabout", 2, null)).icon!!.resId)
    assertEquals(R.drawable.wf_turn_left, icons.iconFor(app.wayfinder.car.bridge.CarManeuver("left", null, 90)).icon!!.resId)
  }

  /** In from the bottom, clockwise round: a left exit goes off to the left, right to the right. */
  @Test fun theExitArmPointsTheWayYouGo() {
    val c = RoundaboutIcon.SIZE / 2f
    val (_, left) = RoundaboutIcon.exitArm(90)
    val (_, ahead) = RoundaboutIcon.exitArm(180)
    val (_, right) = RoundaboutIcon.exitArm(270)
    assertTrue(left.first < c - 50 && Math.abs(left.second - c) < 1)
    assertTrue(Math.abs(ahead.first - c) < 1 && ahead.second < c - 50)
    assertTrue(right.first > c + 50 && Math.abs(right.second - c) < 1)
    assertEquals(RoundaboutIcon.SIZE, RoundaboutIcon.draw(135).width)
  }

  @Test fun eachTurnHasItsOwnIcon() {
    val kinds = listOf("slightLeft", "left", "sharpLeft", "slightRight", "right", "sharpRight", "keepLeft", "keepRight", "uTurnLeft", "uTurnRight", "roundabout", "destination", "hover")
    assertEquals(kinds.size, kinds.map(::res).toSet().size)
    assertEquals(res("destination"), res("waypoint"))
    assertEquals(res("hover"), res("straight"))
    assertNotEquals(res("left"), res("right"))
  }
}
