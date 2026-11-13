package app.wayfinder.car

import android.Manifest
import android.app.Application
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneLocationTest {
  private val sent = mutableListOf<Map<String, Any?>>()

  private class FakeSource : PhoneFixSource {
    var onFix: ((Location) -> Unit)? = null
    var listens = 0
    var stopped = 0
    override fun listen(onFix: (Location) -> Unit): () -> Unit {
      listens++
      this.onFix = onFix
      return { stopped++ }
    }
  }

  private fun location(provider: String = "gps") = Location(provider).apply {
    longitude = 153.05; latitude = -27.45; accuracy = 4f; speed = 13.5f; bearing = 90f; altitude = 30.0; time = 1_790_000_000_000L
  }

  @Test fun sendsEachPositionAsNavigationReadsOne() {
    val source = FakeSource()
    assertTrue(PhoneLocation(source) { sent += it }.start())
    source.onFix!!(location())
    assertEquals(1, sent.size)
    assertEquals(1_790_000_000_000.0, sent[0]["timestamp"])
    @Suppress("UNCHECKED_CAST") val coords = sent[0]["coords"] as Map<String, Any?>
    assertEquals(153.05, coords["longitude"] as Double, 0.0)
    assertEquals(-27.45, coords["latitude"] as Double, 0.0)
    assertEquals(4.0, coords["accuracy"] as Double, 0.001)
    assertEquals(13.5, coords["speed"] as Double, 0.001)
    assertEquals(90.0, coords["heading"] as Double, 0.001)
    assertEquals(30.0, coords["altitude"] as Double, 0.001)
  }

  @Test fun leavesOutWhatThePhoneDidntSay() {
    @Suppress("UNCHECKED_CAST") val coords = PhoneLocation.event(Location("gps").apply { longitude = 1.0; latitude = 2.0; time = 5L })["coords"] as Map<String, Any?>
    listOf("accuracy", "speed", "heading", "altitude").forEach { assertNull(it, coords[it]) }
  }

  @Test fun listensOnceHowEverOftenItIsStarted() {
    val source = FakeSource()
    val phone = PhoneLocation(source) { sent += it }
    phone.start()
    phone.start()
    assertEquals(1, source.listens)
    phone.stop()
    phone.stop()
    assertEquals(1, source.stopped)
    phone.start()
    assertEquals(2, source.listens)
  }

  @Test fun saysSoWhenThePhoneWontGivePositions() {
    val refusing = object : PhoneFixSource {
      override fun listen(onFix: (Location) -> Unit): () -> Unit = throw SecurityException("no location permission")
    }
    val phone = PhoneLocation(refusing) { sent += it }
    assertFalse(phone.start())
    phone.stop()
    assertTrue(sent.isEmpty())
  }

  /**
   * Asked the old way (provider, interval, distance), Android 12 and up treat the fused provider
   * as "balanced power": Wi-Fi and mobile towers, no GPS. With the phone locked nothing else has
   * GPS on, so the car got the same few points, hundreds of metres from the road.
   */
  @Test fun asksForGpsAccuracyEverySecondOrFiveMetres() {
    val request = LocationManagerFixSource.request()
    assertEquals(android.location.LocationRequest.QUALITY_HIGH_ACCURACY, request.quality)
    assertEquals(1_000L, request.intervalMillis)
    assertEquals(5f, request.minUpdateDistanceMeters, 0f)
  }

  @Test fun followsTheRealLocationManagerUntilStopped() {
    val app = ApplicationProvider.getApplicationContext<Application>()
    shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    val manager = app.getSystemService(LocationManager::class.java)
    val provider = LocationManagerFixSource.provider(manager)
    val got = mutableListOf<Location>()
    val stop = LocationManagerFixSource(app).listen { got += it }
    assertEquals(android.location.LocationRequest.QUALITY_HIGH_ACCURACY, shadowOf(manager).getLegacyLocationRequests(provider).single().locationRequest.quality)
    shadowOf(manager).simulateLocation(location(provider))
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(1, got.size)
    stop()
    shadowOf(manager).simulateLocation(location(provider).apply { time += 1_000 })
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(1, got.size)
  }
}
