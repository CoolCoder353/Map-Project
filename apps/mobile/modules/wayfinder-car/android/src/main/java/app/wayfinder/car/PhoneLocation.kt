package app.wayfinder.car

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Bundle
import android.os.Looper
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat

/** Where the phone's own positions come from. */
interface PhoneFixSource {
  /** Calls [onFix] for each position until the returned function is called. */
  fun listen(onFix: (Location) -> Unit): () -> Unit
}

/**
 * The phone's positions for navigation, handed straight to JavaScript. With the phone locked,
 * expo-location stops its watch and passes the navigation service's fixes on one background job at
 * a time, and Android 16 holds those jobs back under its job quota (which now counts jobs run beside
 * a foreground service): directions in the car stopped the moment the phone locked. This listener
 * keeps getting fixes while the navigation foreground service runs, and its events reach
 * JavaScript with the phone locked.
 */
class PhoneLocation(private val source: PhoneFixSource, private val emit: (Map<String, Any?>) -> Unit) {
  private var stopListening: (() -> Unit)? = null

  /** Starts listening, once. False when the phone won't give positions (no permission, say). */
  @Synchronized
  fun start(): Boolean {
    if (stopListening == null) stopListening = runCatching { source.listen { emit(event(it)) } }.getOrNull()
    return stopListening != null
  }

  @Synchronized
  fun stop() {
    stopListening?.invoke()
    stopListening = null
  }

  companion object {
    /** Shaped as expo-location's LocationObject, so navigation takes it as it takes the service's. */
    fun event(l: Location): Map<String, Any?> = mapOf(
      "timestamp" to l.time.toDouble(),
      "coords" to mapOf(
        "longitude" to l.longitude,
        "latitude" to l.latitude,
        "altitude" to l.altitude.takeIf { l.hasAltitude() },
        "accuracy" to l.accuracy.toDouble().takeIf { l.hasAccuracy() },
        "speed" to l.speed.toDouble().takeIf { l.hasSpeed() },
        "heading" to l.bearing.toDouble().takeIf { l.hasBearing() },
      ),
    )
  }
}

/** The phone's GPS through Android's own LocationManager: every second or 5 m, as navigation asks expo-location. */
class LocationManagerFixSource(private val context: Context) : PhoneFixSource {
  @SuppressLint("MissingPermission") // without it this throws, and PhoneLocation.start says so
  override fun listen(onFix: (Location) -> Unit): () -> Unit {
    val manager = context.getSystemService(LocationManager::class.java)
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) = onFix(location)
      // Abstract before Android 11; nothing to do for them.
      @Deprecated("Deprecated in Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      override fun onProviderEnabled(provider: String) {}
      override fun onProviderDisabled(provider: String) {}
    }
    // Android 12 and up: asked for by name with GPS accuracy. The older call below leaves the fused
    // provider at "balanced power" (Wi-Fi and mobile towers), which is all a locked phone then gave.
    if (Build.VERSION.SDK_INT >= 31) manager.requestLocationUpdates(provider(manager), request(), ContextCompat.getMainExecutor(context), listener)
    else manager.requestLocationUpdates(provider(manager), INTERVAL_MS, DISTANCE_M, listener, Looper.getMainLooper())
    return { manager.removeUpdates(listener) }
  }

  companion object {
    private const val INTERVAL_MS = 1_000L
    private const val DISTANCE_M = 5f

    @RequiresApi(31)
    fun request(): LocationRequest =
      LocationRequest.Builder(INTERVAL_MS).setMinUpdateDistanceMeters(DISTANCE_M).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build()

    /** Fused (GPS with Wi-Fi and cell) where the phone has it, else GPS. */
    fun provider(manager: LocationManager): String =
      if (Build.VERSION.SDK_INT >= 31 && manager.hasProvider(LocationManager.FUSED_PROVIDER)) LocationManager.FUSED_PROVIDER else LocationManager.GPS_PROVIDER
  }
}
