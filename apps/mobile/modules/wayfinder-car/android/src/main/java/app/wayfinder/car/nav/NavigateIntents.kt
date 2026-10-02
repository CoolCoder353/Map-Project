package app.wayfinder.car.nav

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import app.wayfinder.car.bridge.LngLat

/** Where another app or the Assistant asked to navigate to. */
sealed interface NavigateRequest {
  /** A point. [label] is the name the sender gave it, if any. */
  data class At(val place: LngLat, val label: String?) : NavigateRequest

  /** A name or address that still needs a search. */
  data class Named(val query: String) : NavigateRequest

  /** A navigate intent we can't read; the driver is told rather than left waiting. */
  object Malformed : NavigateRequest
}

/**
 * Reads `androidx.car.app.action.NAVIGATE` intents with a `geo:` URI, the two forms Google's
 * Assistant navigation page lists: `geo:lat,lon` and `geo:0,0?q=place name`.
 *
 * **A geo: URI is `lat,lon`; Wayfinder's coordinates are `[lon, lat]`.** The swap happens here,
 * once, and nowhere else. (Brisbane is `geo:-27.47,153.03`.)
 */
object NavigateIntents {
  /** Null when the intent isn't a navigate request at all (the car opening the app). */
  fun parse(intent: Intent): NavigateRequest? {
    if (intent.action != CarContext.ACTION_NAVIGATE) return null
    val uri = intent.data ?: return NavigateRequest.Malformed
    if (uri.scheme != "geo") return NavigateRequest.Malformed
    return parse(uri)
  }

  internal fun parse(uri: Uri): NavigateRequest {
    // A geo: URI has no "//", so Android treats it as opaque: split the raw text ourselves.
    val raw = uri.encodedSchemeSpecificPart ?: return NavigateRequest.Malformed
    val coords = raw.substringBefore('?').substringBefore(';').split(',')
    if (coords.size != 2) return NavigateRequest.Malformed
    val lat = coords[0].trim().toDoubleOrNull() ?: return NavigateRequest.Malformed
    val lon = coords[1].trim().toDoubleOrNull() ?: return NavigateRequest.Malformed
    if (!valid(lat, lon)) return NavigateRequest.Malformed
    val q = query(raw)?.trim()?.ifEmpty { null }
    if (lat == 0.0 && lon == 0.0) {
      // "0,0" means "no point": the place is in q, as a name or as "lat,lon(label)".
      if (q == null) return NavigateRequest.Malformed
      return COORDS_IN_Q.matchEntire(q)?.let { m ->
        val qLat = m.groupValues[1].toDouble()
        val qLon = m.groupValues[2].toDouble()
        if (valid(qLat, qLon)) NavigateRequest.At(LngLat(lon = qLon, lat = qLat), m.groupValues[3].trim().ifEmpty { null }) else NavigateRequest.Malformed
      } ?: NavigateRequest.Named(q)
    }
    return NavigateRequest.At(LngLat(lon = lon, lat = lat), q)
  }

  private fun valid(lat: Double, lon: Double) = lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0

  private val COORDS_IN_Q = Regex("""(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\((.*)\))?""")

  /** The `q` parameter, decoded ("+" is a space, as in a web query). */
  private fun query(raw: String): String? =
    raw.substringAfter('?', "").split('&')
      .firstOrNull { it.substringBefore('=') == "q" && it.contains('=') }
      ?.substringAfter('=')
      ?.let { Uri.decode(it.replace('+', ' ')) }
}
