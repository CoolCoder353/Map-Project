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
  private val toPhoneApp = mutableListOf<CarFix>()
  private val fixes = IdleFixes(phone, { clock }) { toPhoneApp += it }
  private val carFix = CarFix(153.0, -27.0, 5.0, 10.0, 90.0, 1L)
  private fun phoneFix(accuracyM: Float? = null) = Location("gps").apply { longitude = 153.1; latitude = -27.1; time = 2L; accuracyM?.let { accuracy = it } }

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
    val refusing = IdleFixes(object : PhoneFixSource { override fun listen(onFix: (Location) -> Unit): () -> Unit = throw SecurityException("no permission") }, { clock })
    val got = mutableListOf<CarFix>()
    val off = refusing.listen { got += it }
    refusing.car(carFix)
    assertEquals(1, got.size)
    off()
  }

  @Test fun aTripGetsThePhonesPositionsWhenTheCarGivesNone() {
    val off = fixes.hold()
    assertEquals(1, phoneListening)
    phoneListener!!(phoneFix())
    assertEquals(153.1, toPhoneApp.single().lon, 0.0)
    off()
    assertEquals("the phone is let go when the trip ends", 0, phoneListening)
  }

  @Test fun aTripLeavesTheCarsPositionsToCarLocation() {
    fixes.hold()
    fixes.car(carFix)
    assertEquals("the car's own fixes already reach the phone app, so not twice", emptyList<CarFix>(), toPhoneApp)
    clock += 2_000
    phoneListener!!(phoneFix())
    assertEquals("the car spoke 2 s ago", emptyList<CarFix>(), toPhoneApp)
  }

  /**
   * With no trip the phone app was told nothing of these, so planning from the car asked the
   * phone's own location again, which a locked phone may not give: no route could be started from
   * a car that has no position of its own, while its map followed the car all along.
   */
  @Test fun thePhoneAppHearsThePhonesPositionsWithNoTripToo() {
    val onMap = mutableListOf<CarFix>()
    fixes.listen { onMap += it }
    phoneListener!!(phoneFix(accuracyM = 6f))
    assertEquals(1, onMap.size)
    assertEquals("planning starts from where the car's map shows you", onMap, toPhoneApp)
  }

  @Test fun aRoughPhonePositionIsNotUsed() {
    val onMap = mutableListOf<CarFix>()
    fixes.listen { onMap += it }
    phoneListener!!(phoneFix(accuracyM = 400f))
    assertEquals("a mobile-tower guess isn't where the car is", emptyList<CarFix>(), onMap)
    assertEquals(emptyList<CarFix>(), toPhoneApp)
    phoneListener!!(phoneFix(accuracyM = 100f))
    assertEquals(1, onMap.size)
  }

  @Test fun aTripAndTheHomeScreenShareOnePhoneListener() {
    val off = fixes.listen { }
    val offTrip = fixes.hold()
    assertEquals(1, phoneListening)
    off()
    assertEquals(1, phoneListening)
    offTrip()
    assertEquals(0, phoneListening)
  }
}

/** Positions for planning, on whichever screen the car shows. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WhileShowingTest {
  private var listening = 0
  private var listener: ((Location) -> Unit)? = null
  private val phone = object : PhoneFixSource {
    override fun listen(onFix: (Location) -> Unit): () -> Unit {
      listening++
      listener = onFix
      return { listening-- }
    }
  }
  private val sent = mutableListOf<CarFix>()
  private val showing = WhileShowing(IdleFixes(phone, { 0L }) { sent += it })
  private val owner = object : androidx.lifecycle.LifecycleOwner {
    override val lifecycle = androidx.lifecycle.LifecycleRegistry.createUnsafe(this)
  }

  @Test fun thePhoneAppGetsPositionsWhileTheCarShowsWayfinderWithHomeNotOnTop() {
    assertEquals(0, listening)
    showing.onStart(owner)
    showing.onStart(owner)
    assertEquals(1, listening)
    listener!!(Location("gps").apply { longitude = 153.1; latitude = -27.1; time = 2L })
    assertEquals(153.1, sent.single().lon, 0.0)
    showing.onStop(owner)
    assertEquals("another app on the car's screen: no GPS for Wayfinder", 0, listening)
    showing.onStop(owner)
    assertEquals(0, listening)
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
  private val trip = TripFixes(api, IdleFixes(phone, { 0L }, api::location))
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
