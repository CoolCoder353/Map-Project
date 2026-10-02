package app.wayfinder.car.bridge

import org.json.JSONArray
import org.json.JSONObject

class BridgeCarApi(private val bridge: CarBridge) : CarApi {
  override fun status(done: (Result<CarStatus>) -> Unit) = ask("status", JSONObject(), Protocol::status, done)
  override fun search(query: String, done: (Result<List<CarPlace>>) -> Unit) = ask("search", JSONObject().put("q", query), Protocol::places, done)
  override fun discover(done: (Result<List<CarPlace>>) -> Unit) = ask("discover", JSONObject(), Protocol::places, done)
  override fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit) =
    ask("plan", JSONObject().put("to", JSONArray().put(to.location.lon).put(to.location.lat)), Protocol::plan, done)
  override fun planned(done: (Result<List<PlannedItem>>) -> Unit) = ask("planned", JSONObject(), Protocol::planned, done)
  override fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit) =
    ask("routeLine", JSONObject().put("routeId", routeId), { Protocol.line(it.getJSONArray("geometry")) }, done)
  override fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit) =
    ask("start", JSONObject().put("routeId", routeId).put("destinationName", destinationName), { }, done)
  override fun stop() = bridge.call("stop", JSONObject()) { }
  override fun setMuted(muted: Boolean) = bridge.call("mute", JSONObject().put("muted", muted)) { }
  override fun simulate(done: (Result<Unit>) -> Unit) = ask("simulate", JSONObject(), { }, done)
  override val navigation: CarNav? get() = bridge.navigation?.let(::readNav)
  override fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit = bridge.onNavigation { json -> listener(json?.let(::readNav)) }

  private fun readNav(json: JSONObject): CarNav? = runCatching { Protocol.nav(json) }.getOrNull()

  /**
   * An answer that can't be read means the phone app and the car app are out of step (one was
   * updated, the other not); the driver gets told what to do rather than the parser's words.
   */
  private fun <T> ask(method: String, params: JSONObject, read: (JSONObject) -> T, done: (Result<T>) -> Unit) =
    bridge.call(method, params) { r ->
      done(r.mapCatching(read).recoverCatching { e -> throw if (e is CarBridgeError || e is CarBridgeTimeout) e else CarBridgeError(OUT_OF_STEP) })
    }

  private companion object {
    const val OUT_OF_STEP = "Update Wayfinder on your phone, then try again."
  }
}
