package app.wayfinder.car

import android.location.Location
import android.os.SystemClock
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarFix

/**
 * Positions for the car's map with no trip. The car's own (see [CarLocation]) work with the phone
 * locked; the phone's are the fallback for a car that gives none, and are only listened to while
 * something wants positions (the home screen, with no trip), so a parked car app costs no GPS.
 */
class IdleFixes(private val phone: PhoneFixSource?, private val now: () -> Long = SystemClock::elapsedRealtime) {
  private val listeners = LinkedHashSet<(CarFix) -> Unit>()
  private val tripListeners = LinkedHashSet<(CarFix) -> Unit>()
  private var holders = 0
  private var lastCarAt: Long? = null
  private var stopPhone: (() -> Unit)? = null

  /** A position from the car's GNSS. */
  fun car(fix: CarFix) {
    lastCarAt = now()
    emit(fix)
  }

  fun listen(onFix: (CarFix) -> Unit): () -> Unit {
    listeners += onFix
    holdPhone()
    return {
      if (listeners.remove(onFix)) releasePhone()
    }
  }

  /**
   * The phone's positions while a trip runs, for a car that gives none (the trip would wait for a
   * first position for ever, as the phone's own GPS isn't running with the phone locked). The car's
   * own go to the phone app through [CarLocation], so only the phone's are passed on here.
   */
  fun forTrip(onFix: (CarFix) -> Unit): () -> Unit {
    tripListeners += onFix
    holdPhone()
    return {
      if (tripListeners.remove(onFix)) releasePhone()
    }
  }

  private fun holdPhone() {
    if (holders++ == 0) stopPhone = phone?.let { p -> runCatching { p.listen(::fromPhone) }.getOrNull() }
  }

  private fun releasePhone() {
    if (--holders == 0) {
      stopPhone?.invoke()
      stopPhone = null
    }
  }

  private fun fromPhone(l: Location) {
    val carAt = lastCarAt
    if (carAt != null && now() - carAt <= CAR_QUIET_MS) return
    val fix = CarFix.from(l)
    emit(fix)
    tripListeners.toList().forEach { it(fix) }
  }

  private fun emit(fix: CarFix) = listeners.toList().forEach { it(fix) }

  private companion object {
    /** The car gives a position about once a second; quiet for longer, the phone's are used. */
    const val CAR_QUIET_MS = 5_000L
  }
}

/**
 * Keeps the phone's positions flowing to the phone app for as long as a trip runs, so a car that
 * gives no position of its own doesn't leave the trip on "Still finding where you are". Idle, it
 * listens to nothing.
 */
class TripFixes(private val api: CarApi, private val fixes: IdleFixes) {
  private var stop: (() -> Unit)? = null

  /** Starts watching for trips; the returned function ends it. */
  fun attach(): () -> Unit {
    update(api.navigation != null)
    val off = api.onNavigation { update(it != null) }
    return {
      off()
      update(false)
    }
  }

  private fun update(navigating: Boolean) {
    if (navigating && stop == null) stop = fixes.forTrip(api::location)
    else if (!navigating) {
      stop?.invoke()
      stop = null
    }
  }
}
