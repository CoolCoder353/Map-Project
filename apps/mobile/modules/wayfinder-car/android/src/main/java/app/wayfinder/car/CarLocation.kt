package app.wayfinder.car

import androidx.car.app.CarContext
import androidx.car.app.hardware.CarHardwareManager
import androidx.car.app.hardware.common.OnCarDataAvailableListener
import androidx.car.app.hardware.info.CarHardwareLocation
import androidx.car.app.hardware.info.CarSensors
import androidx.core.content.ContextCompat
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarFix

/** Where the car's positions come from. */
interface CarFixSource {
  /** Calls [onFix] for each position until the returned function is called. */
  fun listen(onFix: (CarFix) -> Unit): () -> Unit
}

/**
 * Tells the phone app where the car is. The phone's own GPS goes quiet when the app was started
 * from the car with the phone locked, so the car's position (always there while driving) is what
 * keeps directions and planning working. A car without location, or without permission for it,
 * leaves things as they were.
 */
class CarLocation(
  private val source: CarFixSource,
  private val api: CarApi,
  private val now: () -> Long = System::currentTimeMillis,
  private val log: (String) -> Unit = { android.util.Log.i("WayfinderCar", it) },
) {
  /** Starts listening; each usable position also goes to [also] (the map with no trip). */
  fun start(also: (CarFix) -> Unit = {}): () -> Unit =
    runCatching {
      var logged = false
      source.listen { fix ->
        val ok = usable(fix)
        // Once a session, so a drive replayed through a head unit shows whether its positions
        // arrive and are used (R2-H1): `pnpm device logs`.
        if (!logged) {
          logged = true
          log(if (ok) "car location: following the car's position" else "car location: a position from the car was too rough or old to use")
        }
        if (ok) {
          api.location(fix)
          also(fix)
        }
      }
    }.getOrElse {
      log("car location: none from this car (${it.javaClass.simpleName})")
      NOTHING
    }

  private fun usable(f: CarFix) =
    f.lon.isFinite() && f.lat.isFinite() && f.lon in -180.0..180.0 && f.lat in -90.0..90.0 &&
      // 0, 0 is what a sensor with no fix reports.
      !(f.lon == 0.0 && f.lat == 0.0) &&
      // A rough or stale fix would pull the map and the phone's trip away from the road (C19).
      (f.accuracyM == null || f.accuracyM <= MAX_ACCURACY_M) && now() - f.timeMs <= MAX_AGE_MS

  companion object {
    private val NOTHING: () -> Unit = {}
    const val MAX_ACCURACY_M = 100.0
    const val MAX_AGE_MS = 30_000L
  }
}

/** The car's GNSS through Android Auto (Car API level 3 and up). */
class HardwareFixSource(private val carContext: CarContext) : CarFixSource {
  override fun listen(onFix: (CarFix) -> Unit): () -> Unit {
    // Too old a host: said once in the log by CarLocation, and the phone's GPS carries on.
    check(carContext.carAppApiLevel >= 3) { "car API level ${carContext.carAppApiLevel}" }
    val sensors = carContext.getCarService(CarHardwareManager::class.java).carSensors
    val listener = OnCarDataAvailableListener<CarHardwareLocation> { data ->
      data.location.value?.let { onFix(CarFix.from(it)) }
    }
    sensors.addCarHardwareLocationListener(CarSensors.UPDATE_RATE_NORMAL, ContextCompat.getMainExecutor(carContext), listener)
    return { sensors.removeCarHardwareLocationListener(listener) }
  }
}
