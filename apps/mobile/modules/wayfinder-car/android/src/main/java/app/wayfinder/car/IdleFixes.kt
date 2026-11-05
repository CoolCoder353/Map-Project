package app.wayfinder.car

import android.location.Location
import android.os.SystemClock
import app.wayfinder.car.bridge.CarFix

/**
 * Positions for the car's map with no trip. The car's own (see [CarLocation]) work with the phone
 * locked; the phone's are the fallback for a car that gives none, and are only listened to while
 * something wants positions (the home screen, with no trip), so a parked car app costs no GPS.
 */
class IdleFixes(private val phone: PhoneFixSource?, private val now: () -> Long = SystemClock::elapsedRealtime) {
  private val listeners = LinkedHashSet<(CarFix) -> Unit>()
  private var lastCarAt: Long? = null
  private var stopPhone: (() -> Unit)? = null

  /** A position from the car's GNSS. */
  fun car(fix: CarFix) {
    lastCarAt = now()
    emit(fix)
  }

  fun listen(onFix: (CarFix) -> Unit): () -> Unit {
    listeners += onFix
    if (listeners.size == 1) stopPhone = phone?.let { p -> runCatching { p.listen(::fromPhone) }.getOrNull() }
    return {
      listeners -= onFix
      if (listeners.isEmpty()) {
        stopPhone?.invoke()
        stopPhone = null
      }
    }
  }

  private fun fromPhone(l: Location) {
    val carAt = lastCarAt
    if (carAt == null || now() - carAt > CAR_QUIET_MS) emit(CarFix.from(l))
  }

  private fun emit(fix: CarFix) = listeners.toList().forEach { it(fix) }

  private companion object {
    /** The car gives a position about once a second; quiet for longer, the phone's are used. */
    const val CAR_QUIET_MS = 5_000L
  }
}
