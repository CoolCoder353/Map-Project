package app.wayfinder.car

import android.location.Location
import app.wayfinder.car.bridge.CarFix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarLocationTest {
  private val api = FakeCarApi()

  private class FakeSource : CarFixSource {
    var onFix: ((CarFix) -> Unit)? = null
    var stopped = false
    override fun listen(onFix: (CarFix) -> Unit): () -> Unit {
      this.onFix = onFix
      return { stopped = true }
    }
  }

  private fun fix(lon: Double = 153.05, lat: Double = -27.45) = CarFix(lon, lat, 4.0, 13.5, 90.0, 1_790_000_000_000L)

  @Test fun tellsThePhoneEachPositionTheCarReports() {
    val source = FakeSource()
    CarLocation(source, api, now = { 1_790_000_000_000L }).start()
    source.onFix!!(fix())
    source.onFix!!(fix(lon = 153.06))
    assertEquals(listOf(fix(), fix(lon = 153.06)), api.fixes)
  }

  @Test fun dropsAPositionThatIsntOne() {
    val source = FakeSource()
    CarLocation(source, api, now = { 1_790_000_000_000L }).start()
    listOf(fix(lat = Double.NaN), fix(lon = Double.POSITIVE_INFINITY), fix(lon = 0.0, lat = 0.0), fix(lat = 91.0)).forEach { source.onFix!!(it) }
    assertTrue(api.fixes.isEmpty())
  }

  @Test fun stopsListeningWhenToldTo() {
    val source = FakeSource()
    CarLocation(source, api, now = { 1_790_000_000_000L }).start()()
    assertTrue(source.stopped)
  }

  /** Whether a head unit's positions arrive, readable in `pnpm device logs` (R2-H1). */
  @Test fun saysOnceWhetherTheCarsPositionIsFollowed() {
    val lines = mutableListOf<String>()
    val source = FakeSource()
    CarLocation(source, api, now = { 1_790_000_000_000L }, log = { lines += it }).start()
    source.onFix!!(fix())
    source.onFix!!(fix(lon = 153.06))
    assertEquals(listOf("car location: following the car's position"), lines)
    val refusing = object : CarFixSource {
      override fun listen(onFix: (CarFix) -> Unit): () -> Unit = throw IllegalStateException("car API level 2")
    }
    CarLocation(refusing, api, log = { lines += it }).start()
    assertEquals("car location: none from this car (IllegalStateException)", lines.last())
  }

  @Test fun carriesOnWithoutLocationWhenTheCarCantGiveIt() {
    val refusing = object : CarFixSource {
      override fun listen(onFix: (CarFix) -> Unit): () -> Unit = throw SecurityException("no location permission")
    }
    CarLocation(refusing, api).start()()
    assertTrue(api.fixes.isEmpty())
  }

  @Test fun readsASpeedAndHeadingWhenThereAreOnes() {
    val l = Location("car").apply { longitude = 153.05; latitude = -27.45; accuracy = 4f; speed = 13.5f; bearing = 90f; time = 1_790_000_000_000L }
    val f = CarFix.from(l)!!
    assertEquals(CarFix(153.05, -27.45, 4.0, 13.5, 90.0, 1_790_000_000_000L).lon, f.lon, 0.0)
    assertEquals(13.5, f.speedMps!!, 0.001)
    assertEquals(90.0, f.headingDeg!!, 0.001)
    assertEquals(4.0, f.accuracyM!!, 0.001)
  }

  @Test fun leavesOutWhatTheCarDidntSay() {
    val f = CarFix.from(Location("car").apply { longitude = 153.05; latitude = -27.45; time = 5L })!!
    assertNull(f.accuracyM)
    assertNull(f.speedMps)
    assertNull(f.headingDeg)
  }

  @Test fun dropsAFixTooRoughOrTooOldToTrust() {
    val source = FakeSource()
    CarLocation(source, api, now = { 1_790_000_000_000L }).start()
    source.onFix!!(fix().copy(accuracyM = CarLocation.MAX_ACCURACY_M + 1))
    source.onFix!!(fix().copy(timeMs = 1_790_000_000_000L - CarLocation.MAX_AGE_MS - 1))
    assertTrue(api.fixes.isEmpty())
    source.onFix!!(fix())
    assertEquals(1, api.fixes.size)
  }
}
