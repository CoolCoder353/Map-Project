package app.wayfinder.car

import app.wayfinder.car.bridge.*
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Plays the JavaScript side: each request waits until the test answers it. */
class FakeCarApi : CarApi {
  val calls = mutableListOf<String>()
  private val waiting = mutableMapOf<String, ArrayDeque<(Result<Any?>) -> Unit>>()
  private val navListeners = mutableSetOf<(CarNav?) -> Unit>()
  override var navigation: CarNav? = null

  @Suppress("UNCHECKED_CAST")
  private fun <T> hold(call: String, done: (Result<T>) -> Unit) {
    calls += call
    waiting.getOrPut(call.substringBefore(' ')) { ArrayDeque() }.addLast(done as (Result<Any?>) -> Unit)
  }

  /** Answers the latest request for [method]. */
  fun answer(method: String, value: Any?) = waiting[method]!!.removeLast()(Result.success(value))
  /** Answers the earliest one still waiting: an answer arriving late. */
  fun answerStale(method: String, value: Any?) = waiting[method]!!.removeFirst()(Result.success(value))
  fun fail(method: String, message: String) = waiting[method]!!.removeLast()(Result.failure(Exception(message)))
  fun pushNav(nav: CarNav?) {
    navigation = nav
    navListeners.toList().forEach { it(nav) }
  }

  override fun status(done: (Result<CarStatus>) -> Unit) = hold("status", done)
  override fun search(query: String, done: (Result<List<CarPlace>>) -> Unit) = hold("search $query", done)
  override fun discover(done: (Result<List<CarPlace>>) -> Unit) = hold("discover", done)
  override fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit) = hold("plan ${to.id}", done)
  override fun planned(done: (Result<List<PlannedItem>>) -> Unit) = hold("planned", done)
  override fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit) = hold("routeLine $routeId", done)
  override fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit) = hold("start $routeId $destinationName", done)
  override fun stop() { calls += "stop" }
  override fun setMuted(muted: Boolean) { calls += "mute $muted" }
  override fun simulate(done: (Result<Unit>) -> Unit) = hold("simulate", done)
  override fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit {
    navListeners += listener
    return { navListeners -= listener }
  }
}

class RecordingScenes : MapScenes {
  val shown = mutableListOf<MapScene>()
  override fun show(scene: MapScene) { shown += scene }
}
