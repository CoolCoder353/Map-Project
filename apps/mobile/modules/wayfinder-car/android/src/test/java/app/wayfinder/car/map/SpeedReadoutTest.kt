package app.wayfinder.car.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeedReadoutTest {
  @Test fun showsWhicheverIsKnown() {
    assertTrue(SpeedReadout.shown(60, null))
    assertTrue(SpeedReadout.shown(null, 57))
    assertFalse(SpeedReadout.shown(null, null))
  }

  @Test fun overTheLimitOnlyByMoreThanGpsWobble() {
    assertFalse(SpeedReadout.over(60, 61))
    assertTrue(SpeedReadout.over(60, 60 + SpeedReadout.OVER_BY_KMH))
    assertFalse("no limit known", SpeedReadout.over(null, 120))
    assertFalse("no speed known", SpeedReadout.over(60, null))
  }

  /** Over the limit, the whole box goes red, and one chime sounds until back under (C69). */
  @Test fun goingOverTheLimitIsHardToMiss() {
    assertEquals(SpeedReadout.OVER_RED, SpeedReadout.boxColour(60, 70))
    assertNotEquals(SpeedReadout.OVER_RED, SpeedReadout.boxColour(60, 60))
    var chimes = 0
    val chime = OverLimitChime { chimes++ }
    chime.update(60, 70, muted = false)
    chime.update(60, 72, muted = false)
    assertEquals("once per time over", 1, chimes)
    chime.update(60, 55, muted = false)
    chime.update(60, 70, muted = true)
    assertEquals("never while muted", 1, chimes)
    chime.update(60, 55, muted = false)
    chime.update(60, 70, muted = false)
    assertEquals(2, chimes)
  }
}
