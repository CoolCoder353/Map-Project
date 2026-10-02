package app.wayfinder.car.nav

import androidx.car.app.model.Distance
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Rounded the same way as the phone (packages/nav formatDistanceShort). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DistancesTest {
  private fun check(m: Double, shown: Double, unit: Int) = distanceOf(m).let {
    assertEquals(shown, it.displayDistance, 0.0001)
    assertEquals(unit, it.displayUnit)
  }

  @Test fun metresUnderAHundred() = check(47.4, 47.0, Distance.UNIT_METERS)
  @Test fun tensOfMetresUnderAKilometre() = check(347.0, 350.0, Distance.UNIT_METERS)
  @Test fun kilometresToOnePlace() = check(1234.0, 1.2, Distance.UNIT_KILOMETERS_P1)
  @Test fun wholeKilometresFromTen() = check(12_600.0, 13.0, Distance.UNIT_KILOMETERS)

  @Test fun wordsRoundTheSameWay() {
    assertEquals("47 m", distanceText(47.4))
    assertEquals("350 m", distanceText(347.0))
    assertEquals("1.2 km", distanceText(1234.0))
    assertEquals("13 km", distanceText(12_600.0))
  }
}
