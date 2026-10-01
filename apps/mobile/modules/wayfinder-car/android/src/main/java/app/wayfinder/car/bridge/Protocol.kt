package app.wayfinder.car.bridge

import org.json.JSONArray
import org.json.JSONObject

/** [lon, lat], as everywhere in Wayfinder; turned into LatLng only at the map. */
data class LngLat(val lon: Double, val lat: Double)

enum class Account { SIGNED_IN, SIGNED_OUT, OFFLINE }
data class CarStatus(val account: Account, val styleLight: String?, val styleDark: String?, val searchHint: String, val here: LngLat?)
data class CarPlace(val id: String, val name: String, val detail: String, val location: LngLat, val distanceM: Double?)
data class RouteOption(
  val routeId: String, val title: String, val detail: String,
  val durationS: Double, val distanceM: Double, val extraDurationS: Double, val geometry: List<LngLat>,
)
data class PlanResult(val options: List<RouteOption>, val note: String?)
data class PlannedItem(val id: String, val name: String, val option: RouteOption)
data class CarManeuver(val type: String, val exit: Int?)
data class NextStep(val maneuver: CarManeuver, val cue: String)
enum class NavStatus { STARTING, NAVIGATING, OFF_ROUTE, ARRIVED }
data class CarNav(
  val routeId: String, val destinationName: String?, val status: NavStatus,
  val rerouting: Boolean, val muted: Boolean, val error: String?,
  val maneuver: CarManeuver?, val cue: String, val road: String, val distanceToManeuverM: Double?, val next: NextStep?,
  val remainingDistanceM: Double, val remainingDurationS: Double, val arrivalEpochMs: Long,
  val position: LngLat?, val headingDeg: Double?,
)

/**
 * Reads what the JavaScript side sends. apps/mobile/src/car/protocol.ts is the other half; the
 * fixtures under src/test/resources keep the two in step.
 */
object Protocol {
  fun status(o: JSONObject): CarStatus {
    val style = if (o.isNull("styleUrl")) null else o.getJSONObject("styleUrl")
    return CarStatus(
      account = when (o.getString("account")) {
        "signedIn" -> Account.SIGNED_IN
        "offline" -> Account.OFFLINE
        else -> Account.SIGNED_OUT
      },
      styleLight = style?.getString("light"),
      styleDark = style?.getString("dark"),
      searchHint = o.getString("searchHint"),
      here = if (o.isNull("here")) null else lngLat(o.getJSONArray("here")),
    )
  }

  fun places(o: JSONObject): List<CarPlace> = o.getJSONArray("places").objects().map(::place)

  fun place(o: JSONObject) = CarPlace(o.getString("id"), o.getString("name"), o.getString("detail"), lngLat(o.getJSONArray("location")), o.doubleOrNull("distanceM"))

  fun plan(o: JSONObject) = PlanResult(o.getJSONArray("options").objects().map(::option), o.stringOrNull("note"))

  fun planned(o: JSONObject): List<PlannedItem> =
    o.getJSONArray("items").objects().map { PlannedItem(it.getString("id"), it.getString("name"), option(it.getJSONObject("option"))) }

  fun option(o: JSONObject) = RouteOption(
    o.getString("routeId"), o.getString("title"), o.getString("detail"),
    o.getDouble("durationS"), o.getDouble("distanceM"), o.getDouble("extraDurationS"), line(o.getJSONArray("geometry")),
  )

  fun line(a: JSONArray): List<LngLat> = (0 until a.length()).map { lngLat(a.getJSONArray(it)) }

  fun nav(o: JSONObject) = CarNav(
    routeId = o.getString("routeId"),
    destinationName = o.stringOrNull("destinationName"),
    status = when (o.getString("status")) {
      "navigating" -> NavStatus.NAVIGATING
      "offRoute" -> NavStatus.OFF_ROUTE
      "arrived" -> NavStatus.ARRIVED
      else -> NavStatus.STARTING
    },
    rerouting = o.getBoolean("rerouting"),
    muted = o.getBoolean("muted"),
    error = o.stringOrNull("error"),
    maneuver = if (o.isNull("maneuver")) null else maneuver(o.getJSONObject("maneuver")),
    cue = o.getString("cue"),
    road = o.getString("road"),
    distanceToManeuverM = o.doubleOrNull("distanceToManeuverM"),
    next = if (o.isNull("next")) null else o.getJSONObject("next").let { NextStep(maneuver(it.getJSONObject("maneuver")), it.getString("cue")) },
    remainingDistanceM = o.getDouble("remainingDistanceM"),
    remainingDurationS = o.getDouble("remainingDurationS"),
    arrivalEpochMs = o.getLong("arrivalEpochMs"),
    position = if (o.isNull("position")) null else lngLat(o.getJSONArray("position")),
    headingDeg = o.doubleOrNull("headingDeg"),
  )

  private fun maneuver(o: JSONObject) = CarManeuver(o.getString("type"), if (o.isNull("exit")) null else o.getInt("exit"))
  private fun lngLat(a: JSONArray) = LngLat(a.getDouble(0), a.getDouble(1))
  private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
  private fun JSONObject.doubleOrNull(k: String): Double? = if (isNull(k)) null else getDouble(k)
  private fun JSONObject.stringOrNull(k: String): String? = if (isNull(k)) null else getString(k)
}
