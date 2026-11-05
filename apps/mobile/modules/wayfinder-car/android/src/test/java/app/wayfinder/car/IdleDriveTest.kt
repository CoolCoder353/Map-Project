package app.wayfinder.car

import app.wayfinder.car.bridge.CarFix
import app.wayfinder.car.bridge.CarSpeedLimit
import app.wayfinder.car.map.MapScene
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Driving with no trip: the map follows the car, with its speed and the limit where it is. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class IdleDriveTest {
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private var clock = 0L
  private val drive = IdleDrive(api) { clock }

  /** [north] metres north of the start, going [speedMps]. */
  private fun fix(north: Double, speedMps: Double? = 15.0, heading: Double? = 0.0) =
    CarFix(153.25, -27.56 + north / 111_195.0, 5.0, speedMps, heading, clock)

  private fun last() = scenes.shown.last() as MapScene.Following

  @Test fun followsTheCarWithItsSpeedAndNoRoute() {
    drive.onFix(fix(0.0, speedMps = 16.7, heading = 182.0), scenes::show)
    val s = last()
    assertTrue(s.line.isEmpty())
    assertEquals(153.25, s.position!!.lon, 1e-9)
    assertEquals(182.0, s.headingDeg!!, 0.0)
    assertEquals(60, s.speedKmh)
    assertNull("no limit until the phone answers", s.speedLimitKmh)
  }

  @Test fun keepsTheWayItWasGoingWhileStopped() {
    drive.onFix(fix(0.0, heading = 182.0), scenes::show)
    drive.onFix(fix(0.0, speedMps = 0.0, heading = null), scenes::show)
    assertEquals(182.0, last().headingDeg!!, 0.0)
    assertEquals(0, last().speedKmh)
  }

  @Test fun asksForTheLimitAndShowsIt() {
    drive.onFix(fix(0.0, heading = 90.0), scenes::show)
    assertEquals(listOf("speedLimit 153.25,-27.56 90.0"), api.calls)
    api.answer("speedLimit", CarSpeedLimit(60, false, "Panorama Drive"))
    assertEquals(60, last().speedLimitKmh)
    assertFalse(last().speedLimitEstimated)
    drive.onFix(fix(20.0, heading = 90.0), scenes::show)
    assertEquals("still the same road a moment later", 60, last().speedLimitKmh)
  }

  @Test fun saysWhenTheLimitIsOnlyTheRoadsDefault() {
    drive.onFix(fix(0.0), scenes::show)
    api.answer("speedLimit", CarSpeedLimit(50, true, null))
    assertTrue(last().speedLimitEstimated)
  }

  @Test fun asksAgainOnlyAfterDrivingOn() {
    drive.onFix(fix(0.0), scenes::show)
    drive.onFix(fix(50.0), scenes::show)
    assertEquals("one at a time", 1, api.calls.size)
    api.answer("speedLimit", CarSpeedLimit(60, false, null))
    drive.onFix(fix(100.0), scenes::show)
    assertEquals("100 m on, a moment later: not yet", 1, api.calls.size)
    drive.onFix(fix(160.0), scenes::show)
    assertEquals("150 m on", 2, api.calls.size)
    api.answer("speedLimit", CarSpeedLimit(80, false, null))
    assertEquals(80, last().speedLimitKmh)
    // Creeping in traffic: 40 m on asks again once 20 s have passed.
    drive.onFix(fix(200.0), scenes::show)
    assertEquals(2, api.calls.size)
    clock += 21_000
    drive.onFix(fix(200.0), scenes::show)
    assertEquals(3, api.calls.size)
  }

  @Test fun neverAsksWhileParked() {
    drive.onFix(fix(0.0, speedMps = 0.0), scenes::show)
    api.answer("speedLimit", CarSpeedLimit(60, false, null))
    clock += 600_000
    drive.onFix(fix(5.0, speedMps = 0.0), scenes::show)
    assertEquals(1, api.calls.size)
  }

  @Test fun dropsALimitLeftFarBehind() {
    drive.onFix(fix(0.0), scenes::show)
    api.answer("speedLimit", CarSpeedLimit(60, false, null))
    drive.onFix(fix(160.0), scenes::show)
    api.fail("speedLimit", "no signal")
    assertEquals("kept a little while", 60, last().speedLimitKmh)
    clock += 5_000
    drive.onFix(fix(400.0), scenes::show)
    assertNull("not shown 400 m from where it was looked up", last().speedLimitKmh)
  }

  @Test fun ignoresAnAnswerForWhereTheCarWasLongAgo() {
    drive.onFix(fix(0.0), scenes::show)
    drive.onFix(fix(600.0), scenes::show)
    api.answer("speedLimit", CarSpeedLimit(100, false, null))
    assertNull(last().speedLimitKmh)
  }

  @Test fun anAnswerAfterStoppingIsntShown() {
    drive.onFix(fix(0.0), scenes::show)
    drive.stop()
    val shown = scenes.shown.size
    api.answer("speedLimit", CarSpeedLimit(60, false, null))
    assertEquals(shown, scenes.shown.size)
  }
}
