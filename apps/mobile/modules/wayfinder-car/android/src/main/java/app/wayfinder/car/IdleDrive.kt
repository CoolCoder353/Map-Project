package app.wayfinder.car

import android.os.SystemClock
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarFix
import app.wayfinder.car.bridge.CarSpeedLimit
import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.TripTrail
import kotlin.math.roundToInt

/**
 * Driving with no trip: the map follows the car the way it's going, with its speed and the limit on
 * the road. The limit comes from the server (see `GET /api/roads/speed-limit`), asked one at a
 * time, after the car has driven on [ASK_AFTER_M], or crept [ASK_CREEPING_M] over [ASK_EVERY_MS]; a
 * parked car never asks. A limit looked up more than [SHOW_WITHIN_M] back isn't shown.
 */
class IdleDrive(private val api: CarApi, private val now: () -> Long = SystemClock::elapsedRealtime) {
  private var heading: Double? = null
  private var position: LngLat? = null
  private var limit: CarSpeedLimit? = null
  private var limitAt: LngLat? = null
  private var askedAt: LngLat? = null
  private var askedWhen = 0L
  private var asking = false
  /** Bumped by [stop], so an answer to an earlier lookup is dropped. */
  private var generation = 0
  private var show: ((MapScene) -> Unit)? = null
  private var lastFix: CarFix? = null
  /** Where the heading was last known or worked out. */
  private var movedFrom: LngLat? = null

  fun onFix(fix: CarFix, show: (MapScene) -> Unit) {
    this.show = show
    lastFix = fix
    val here = LngLat(fix.lon, fix.lat)
    position = here
    // Stopped, a car reports no heading (or 0): keep the way it was going, or none yet. A position
    // with no heading at all: the way from where it last had one, once it has moved far enough to
    // tell, as navigation does (followHeading in navigationService.ts).
    val from = movedFrom
    if (fix.headingDeg != null && (fix.speedMps ?: 0.0) >= MOVING_MPS) {
      heading = fix.headingDeg
      movedFrom = here
    } else if (from == null) {
      movedFrom = here
    } else if (TripTrail.metres(from, here) >= HEADING_FROM_MOVEMENT_M) {
      heading = TripTrail.bearing(from, here)
      movedFrom = here
    }
    draw()
    if (shouldAsk(here, fix)) ask(here)
  }

  /** Home went under another screen, or a trip started: late answers aren't drawn. */
  fun stop() {
    generation++
    asking = false
    show = null
  }

  private fun shouldAsk(here: LngLat, fix: CarFix): Boolean {
    if (asking) return false
    val last = askedAt ?: return true
    val moved = TripTrail.metres(last, here)
    if ((fix.speedMps ?: 0.0) < MOVING_MPS && moved < ASK_CREEPING_M) return false
    return moved >= ASK_AFTER_M || (moved >= ASK_CREEPING_M && now() - askedWhen >= ASK_EVERY_MS)
  }

  private fun ask(at: LngLat) {
    asking = true
    askedAt = at
    askedWhen = now()
    val mine = generation
    api.speedLimit(at, heading) { r ->
      if (mine != generation) return@speedLimit
      asking = false
      r.getOrNull()?.let {
        limit = it
        limitAt = at
      }
      draw()
    }
  }

  private fun draw() {
    val here = position ?: return
    val fix = lastFix ?: return
    val speed = fix.speedMps?.takeIf { it.isFinite() && it >= 0 }?.let { (it * 3.6).roundToInt() }
    // The limit only beside a speed: on its own, parked with a position that carries none, a "50"
    // floated on the map meaning nothing (C-U1).
    val current = limit?.takeIf { speed != null && limitAt?.let { at -> TripTrail.metres(at, here) <= SHOW_WITHIN_M } == true }
    show?.invoke(
      MapScene.Following(
        line = emptyList(),
        position = here,
        headingDeg = heading,
        speedLimitKmh = current?.kmh,
        speedKmh = speed,
        speedLimitEstimated = current?.estimated == true,
      ),
    )
  }

  private companion object {
    const val MOVING_MPS = 2.0
    const val HEADING_FROM_MOVEMENT_M = 20.0
    const val ASK_AFTER_M = 150.0
    const val ASK_CREEPING_M = 30.0
    const val ASK_EVERY_MS = 20_000L
    const val SHOW_WITHIN_M = 300.0
  }
}
