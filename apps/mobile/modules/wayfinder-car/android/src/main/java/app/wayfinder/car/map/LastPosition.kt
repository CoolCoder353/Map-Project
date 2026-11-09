package app.wayfinder.car.map

import android.content.Context
import app.wayfinder.car.bridge.LngLat

/**
 * Where the car or the phone last was: the maps that open before either knows where it is now
 * start there instead of on all of Australia (C67), and search results show it among them (C66).
 * Saved, so the next time the car connects starts there too.
 */
object LastPosition {
  private const val PREFS = "wayfinder_car_map"

  @Volatile var at: LngLat? = null
    private set

  fun remember(p: LngLat?) {
    if (p != null) at = p
  }

  fun save(context: Context) {
    val p = at ?: return
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("lon", p.lon.toString()).putString("lat", p.lat.toString()).apply()
  }

  fun load(context: Context) {
    if (at != null) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val lon = prefs.getString("lon", null)?.toDoubleOrNull() ?: return
    val lat = prefs.getString("lat", null)?.toDoubleOrNull() ?: return
    at = LngLat(lon, lat)
  }

  /** For tests. */
  internal fun forget() {
    at = null
  }
}
