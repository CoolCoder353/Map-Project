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
class CarLocation(private val source: CarFixSource, private val api: CarApi) {
  fun start(): () -> Unit =
    runCatching { source.listen { fix -> if (usable(fix)) api.location(fix) } }.getOrDefault({})

  private fun usable(f: CarFix) =
    f.lon.isFinite() && f.lat.isFinite() && f.lon in -180.0..180.0 && f.lat in -90.0..90.0 &&
      // 0, 0 is what a sensor with no fix reports.
      !(f.lon == 0.0 && f.lat == 0.0)
}

/** The car's GNSS through Android Auto (Car API level 3 and up). */
class HardwareFixSource(private val carContext: CarContext) : CarFixSource {
  override fun listen(onFix: (CarFix) -> Unit): () -> Unit {
    if (carContext.carAppApiLevel < 3) return {}
    val sensors = carContext.getCarService(CarHardwareManager::class.java).carSensors
    val listener = OnCarDataAvailableListener<CarHardwareLocation> { data ->
      data.location.value?.let { onFix(CarFix.from(it)) }
    }
    sensors.addCarHardwareLocationListener(CarSensors.UPDATE_RATE_NORMAL, ContextCompat.getMainExecutor(carContext), listener)
    return { sensors.removeCarHardwareLocationListener(listener) }
  }
}
