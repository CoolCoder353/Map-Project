package app.wayfinder.car.map

import org.junit.Assert.assertFalse
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
}
