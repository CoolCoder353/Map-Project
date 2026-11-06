package app.wayfinder.car

import android.location.Location
import app.wayfinder.car.bridge.CarFix
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Positions for the map with no trip: the car's own, else the phone's. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class IdleFixesTest {
  private var clock = 0L
  private var phoneListening = 0
  private var phoneListener: ((Location) -> Unit)? = null
  private val phone = object : PhoneFixSource {
    override fun listen(onFix: (Location) -> Unit): () -> Unit {
      phoneListening++
      phoneListener = onFix
      return { phoneListening--; phoneListener = null }
    }
  }
  private val fixes = IdleFixes(phone) { clock }
  private val carFix = CarFix(153.0, -27.0, 5.0, 10.0, 90.0, 1L)
  private fun phoneFix() = Location("gps").apply { longitude = 153.1; latitude = -27.1; time = 2L }

  @Test fun listensToThePhoneOnlyWhileSomethingWantsPositions() {
    assertEquals(0, phoneListening)
    val off = fixes.listen { }
    val off2 = fixes.listen { }
    assertEquals(1, phoneListening)
    off()
    assertEquals(1, phoneListening)
    off2()
    assertEquals(0, phoneListening)
  }

  @Test fun passesOnTheCarsPositions() {
    val got = mutableListOf<CarFix>()
    fixes.listen { got += it }
    fixes.car(carFix)
    assertEquals(listOf(carFix), got)
  }

  @Test fun usesThePhoneOnlyWhenTheCarIsQuiet() {
    val got = mutableListOf<CarFix>()
    fixes.listen { got += it }
    fixes.car(carFix)
    clock += 2_000
    phoneListener!!(phoneFix())
    assertEquals("the car spoke 2 s ago", 1, got.size)
    clock += 5_000
    phoneListener!!(phoneFix())
    assertEquals(2, got.size)
    assertEquals(153.1, got.last().lon, 0.0)
  }

  @Test fun aPhoneThatWontGivePositionsLeavesTheCars() {
    val refusing = IdleFixes(object : PhoneFixSource { override fun listen(onFix: (Location) -> Unit): () -> Unit = throw SecurityException("no permission") }) { clock }
    val got = mutableListOf<CarFix>()
    val off = refusing.listen { got += it }
    refusing.car(carFix)
    assertEquals(1, got.size)
    off()
  }

  @Test fun aTripGetsThePhonesPositionsWhenTheCarGivesNone() {
    val got = mutableListOf<CarFix>()
    val off = fixes.forTrip { got += it }
    assertEquals(1, phoneListening)
    phoneListener!!(phoneFix())
    assertEquals(1, got.size)
    assertEquals(153.1, got.single().lon, 0.0)
    off()
    assertEquals("the phone is let go when the trip ends", 0, phoneListening)
  }

  @Test fun aTripLeavesTheCarsPositionsToCarLocation() {
    val got = mutableListOf<CarFix>()
    fixes.forTrip { got += it }
    fixes.car(carFix)
    assertEquals("the car's own fixes already reach the phone app, so not twice", emptyList<CarFix>(), got)
    clock += 2_000
    phoneListener!!(phoneFix())
    assertEquals("the car spoke 2 s ago", emptyList<CarFix>(), got)
  }

  @Test fun aTripAndTheHomeScreenShareOnePhoneListener() {
    val off = fixes.listen { }
    val offTrip = fixes.forTrip { }
    assertEquals(1, phoneListening)
    off()
    assertEquals(1, phoneListening)
    offTrip()
    assertEquals(0, phoneListening)
  }
}

/** The phone's positions for a trip, when the car gives none. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TripFixesTest {
  private var listening = 0
  private var listener: ((Location) -> Unit)? = null
  private val phone = object : PhoneFixSource {
    override fun listen(onFix: (Location) -> Unit): () -> Unit {
      listening++
      listener = onFix
      return { listening-- }
    }
  }
  private val api = FakeCarApi()
  private val trip = TripFixes(api, IdleFixes(phone) { 0L })
  private fun phoneFix() = Location("gps").apply { longitude = 153.1; latitude = -27.1; time = 2L }

  @Test fun listensToThePhoneOnlyWhileATripRuns() {
    trip.attach()
    assertEquals(0, listening)
    api.pushNav(Samples.nav())
    assertEquals(1, listening)
    api.pushNav(Samples.nav())
    assertEquals("each update of the same trip", 1, listening)
    listener!!(phoneFix())
    assertEquals(153.1, api.fixes.single().lon, 0.0)
    api.pushNav(null)
    assertEquals(0, listening)
  }

  @Test fun picksUpATripAlreadyRunning() {
    api.navigation = Samples.nav()
    trip.attach()
    assertEquals(1, listening)
  }

  @Test fun endingTheSessionLetsGoOfThePhone() {
    api.pushNav(Samples.nav())
    val off = trip.attach()
    off()
    assertEquals(0, listening)
    api.pushNav(Samples.nav())
    assertEquals("no longer watching", 0, listening)
  }
}
