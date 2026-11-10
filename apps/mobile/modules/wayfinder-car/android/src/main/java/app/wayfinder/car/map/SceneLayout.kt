package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat
import app.wayfinder.car.bridge.RouteLight

/** A numbered marker on the map; the row with the same number in the list beside it is the same thing. */
data class Pin(val at: LngLat, val label: String)

data class SceneDrawing(
  val selected: List<LngLat>,
  val others: List<List<LngLat>>,
  val pins: List<Pin>,
  val position: LngLat?,
  val travelled: List<LngLat> = emptyList(),
  /** Where the chosen route ends, marked with the destination pin. */
  val destination: LngLat? = null,
  /** Lights ahead, red or green, while driving. */
  val lights: List<RouteLight> = emptyList(),
  /** Where the chosen route starts, before Go: marked so the driver sees where it begins. */
  val start: LngLat? = null,
)

sealed interface CameraSpec {
  data class Follow(val target: LngLat, val bearing: Double?) : CameraSpec
  data class Fit(val points: List<LngLat>) : CameraSpec
  data class Center(val target: LngLat, val zoom: Double) : CameraSpec
  data object Keep : CameraSpec
}

/** What to draw and where to look for each scene; the renderer only carries it out. */
object SceneLayout {
  /** The whole country: only when there is no position now and none remembered from before. */
  val AUSTRALIA = CameraSpec.Center(LngLat(134.5, -27.5), 3.6)

  /** How close to you the home map opens. */
  const val HOME_ZOOM = 13.0

  /** Following the car looks ahead, tilted; every other map is flat and north up (C5, C27). */
  const val FOLLOW_TILT = 45.0

  /** Pins closer than this share of the spread of all of them would overlap: they share one marker (C30). */
  const val PIN_GROUP_SHARE = 0.06

  /** Following the car glides from one fix to the next (about a second apart). */
  const val FOLLOW_MS = 900

  /** How much of the visible map sits above the car when following, so more of the road ahead shows. */
  const val FOLLOW_TOP_SHARE = 0.4

  /**
   * Where on the car screen the car itself is while the map follows it: the middle of what's left
   * of the visible area once [FOLLOW_TOP_SHARE] of it is kept for the road ahead. The position
   * marker is drawn there, fixed, so it stays still while the map glides under it instead of
   * jumping from fix to fix. Arguments are pixels; the visible area is left, top, right, bottom.
   */
  fun followPoint(left: Int, top: Int, right: Int, bottom: Int, reservedLeft: Int = 0): Pair<Float, Float> {
    val padTop = top + (bottom - top) * FOLLOW_TOP_SHARE
    return (left + reservedLeft + right) / 2f to ((padTop + bottom) / 2).toFloat()
  }

  /**
   * How much of the left of the visible area the speed readout keeps for itself while driving: its
   * width and a margin each side. The car and the route are centred in what's left, so the readout
   * is never drawn next to the car on the road ahead (C2, C88).
   */
  fun speedColumn(speedWidthPx: Int, marginPx: Int, shown: Boolean): Int = if (shown) speedWidthPx + 2 * marginPx else 0

  /**
   * The camera's padding, left, top, right, bottom: the surface outside the visible area (under
   * the list card, say) and the speed column. A point the camera centres on lands in the middle of
   * the map the driver can see, not under the card's edge (R2-C5).
   */
  fun padding(surfaceWidth: Int, surfaceHeight: Int, left: Int, top: Int, right: Int, bottom: Int, reservedLeft: Int = 0): DoubleArray =
    doubleArrayOf(
      (left + reservedLeft).toDouble(),
      top.toDouble(),
      (surfaceWidth - right).toDouble().coerceAtLeast(0.0),
      (surfaceHeight - bottom).toDouble().coerceAtLeast(0.0),
    )

  /** How the camera is tilted for [spec]. */
  fun tilt(spec: CameraSpec): Double = if (spec is CameraSpec.Follow) FOLLOW_TILT else 0.0

  /** Which way is up for [spec]: the way you're going while following, else north. */
  fun bearing(spec: CameraSpec): Double = (spec as? CameraSpec.Follow)?.bearing ?: 0.0

  /**
   * How long a camera move takes, in milliseconds; 0 jumps. Only following the car moves smoothly,
   * as the moving map is the driving task itself. Every other move (fitting places or routes on a
   * list or preview) jumps, because the car screen must not animate while driving (car app quality
   * SA-1).
   */
  fun moveMs(spec: CameraSpec): Int = if (spec is CameraSpec.Follow) FOLLOW_MS else 0

  /**
   * What each scene puts on the map. Home marks where you are. Places and a list of routes are
   * numbered 1, 2, 3 as their rows are (a route at its middle, where routes that start together
   * have parted). A chosen route, before Go and while driving, ends at the destination pin.
   */
  fun drawing(scene: MapScene): SceneDrawing = when (scene) {
    is MapScene.Overview -> SceneDrawing(emptyList(), emptyList(), emptyList(), scene.here)
    is MapScene.Places -> SceneDrawing(emptyList(), emptyList(), grouped(numbered(scene.places.map { it.location })), scene.here)
    is MapScene.Routes -> {
      val chosen = scene.options.getOrNull(scene.selected)?.geometry.orEmpty()
      SceneDrawing(
        chosen,
        scene.options.filterIndexed { i, _ -> i != scene.selected }.map { it.geometry },
        when {
          scene.selected == MapScene.Routes.NONE -> grouped(numbered(scene.options.mapIndexed { i, o -> along(o.geometry, (i + 1.0) / (scene.options.size + 1)) }))
          // Choosing between routes: each line carries its time, as its row does, so a line can be
          // matched to its row (C-U5). One route needs no label.
          scene.options.size > 1 -> scene.options.mapIndexedNotNull { i, o -> along(o.geometry, (i + 1.0) / (scene.options.size + 1))?.let { Pin(it, minutes(o.durationS)) } }
          else -> emptyList()
        },
        null,
        destination = chosen.lastOrNull(),
        start = chosen.firstOrNull(),
      )
    }
    is MapScene.Following -> SceneDrawing(scene.line, emptyList(), emptyList(), scene.position, scene.travelled, destination = scene.line.lastOrNull(), lights = scene.lights)
  }

  /** A route's time as its row gives it: "16 min", "1 h 5 min". */
  internal fun minutes(durationS: Double): String {
    val m = Math.round(durationS / 60).toInt().coerceAtLeast(1)
    return if (m < 60) "$m min" else if (m % 60 == 0) "${m / 60} h" else "${m / 60} h ${m % 60} min"
  }

  /** Numbered by place in the list, so a row with nothing to mark doesn't renumber the ones after it. */
  private fun numbered(at: List<LngLat?>) = at.mapIndexedNotNull { i, p -> p?.let { Pin(it, (i + 1).toString()) } }

  /**
   * Pins that would sit on each other become one, labelled with both numbers ("2·4") at the first
   * one's place: three overlapping badges were unreadable (C30). "Close" is a share of how far the
   * pins spread, as the map is fitted to them.
   */
  internal fun grouped(pins: List<Pin>): List<Pin> {
    if (pins.size < 2) return pins
    val spread = Math.hypot(pins.maxOf { it.at.lon } - pins.minOf { it.at.lon }, pins.maxOf { it.at.lat } - pins.minOf { it.at.lat })
    val near = spread * PIN_GROUP_SHARE
    val groups = mutableListOf<MutableList<Pin>>()
    for (p in pins) {
      val g = groups.firstOrNull { g -> Math.hypot(g[0].at.lon - p.at.lon, g[0].at.lat - p.at.lat) < near }
      if (g != null) g += p else groups += mutableListOf(p)
    }
    return groups.map { g -> Pin(g[0].at, g.joinToString("·") { it.label }) }
  }

  /**
   * A point [share] of the way along [line], by vertex. Each route's number sits at a different
   * share (1/3 and 2/3 for two), so routes that share roads don't stack their numbers.
   */
  internal fun along(line: List<LngLat>, share: Double) = line.getOrNull(Math.round((line.size - 1) * share).toInt().coerceIn(0, maxOf(0, line.size - 1)))

  /** [remembered]: where the car or phone last was, for a map opened before either knows where it is now (C67). */
  fun camera(scene: MapScene, remembered: LngLat? = null): CameraSpec = when (scene) {
    is MapScene.Overview -> (scene.here ?: remembered)?.let { CameraSpec.Center(it, HOME_ZOOM) } ?: AUSTRALIA
    // Where you are too, so "4 km away" can be seen on the map (C-U2).
    is MapScene.Places -> if (scene.places.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.places.map { it.location } + listOfNotNull(scene.here))
    is MapScene.Routes -> scene.options.flatMap { it.geometry }.let { if (it.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(it) }
    is MapScene.Following -> scene.position?.let { CameraSpec.Follow(it, scene.headingDeg) }
      ?: if (scene.line.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.line)
  }
}
