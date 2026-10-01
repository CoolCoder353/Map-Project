package app.wayfinder.car.nav

import androidx.test.core.app.ApplicationProvider
import app.wayfinder.car.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
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

  @Test fun eachTurnHasItsOwnIcon() {
    val kinds = listOf("slightLeft", "left", "sharpLeft", "slightRight", "right", "sharpRight", "keepLeft", "keepRight", "uTurnLeft", "uTurnRight", "roundabout", "destination", "hover")
    assertEquals(kinds.size, kinds.map(::res).toSet().size)
    assertEquals(res("destination"), res("waypoint"))
    assertEquals(res("hover"), res("straight"))
    assertNotEquals(res("left"), res("right"))
  }
}
