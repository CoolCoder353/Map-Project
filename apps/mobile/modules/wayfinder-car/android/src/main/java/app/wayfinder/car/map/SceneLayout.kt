package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat

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
)

sealed interface CameraSpec {
  data class Follow(val target: LngLat, val bearing: Double?) : CameraSpec
  data class Fit(val points: List<LngLat>) : CameraSpec
  data class Center(val target: LngLat, val zoom: Double) : CameraSpec
  data object Keep : CameraSpec
}

/** What to draw and where to look for each scene; the renderer only carries it out. */
object SceneLayout {
  /** The whole country, as the phone map starts (MapCanvas OVERVIEW). */
  val AUSTRALIA = CameraSpec.Center(LngLat(134.5, -27.5), 3.6)

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
  fun followPoint(left: Int, top: Int, right: Int, bottom: Int): Pair<Float, Float> {
    val padTop = top + (bottom - top) * FOLLOW_TOP_SHARE
    return (left + right) / 2f to ((padTop + bottom) / 2).toFloat()
  }

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
    is MapScene.Places -> SceneDrawing(emptyList(), emptyList(), numbered(scene.places.map { it.location }), null)
    is MapScene.Routes -> {
      val chosen = scene.options.getOrNull(scene.selected)?.geometry.orEmpty()
      SceneDrawing(
        chosen,
        scene.options.filterIndexed { i, _ -> i != scene.selected }.map { it.geometry },
        if (scene.selected == MapScene.Routes.NONE) numbered(scene.options.map { middle(it.geometry) }) else emptyList(),
        null,
        destination = chosen.lastOrNull(),
      )
    }
    is MapScene.Following -> SceneDrawing(scene.line, emptyList(), emptyList(), scene.position, scene.travelled, destination = scene.line.lastOrNull())
  }

  /** Numbered by place in the list, so a row with nothing to mark doesn't renumber the ones after it. */
  private fun numbered(at: List<LngLat?>) = at.mapIndexedNotNull { i, p -> p?.let { Pin(it, (i + 1).toString()) } }

  private fun middle(line: List<LngLat>) = line.getOrNull(line.size / 2)

  fun camera(scene: MapScene): CameraSpec = when (scene) {
    is MapScene.Overview -> scene.here?.let { CameraSpec.Center(it, 13.0) } ?: AUSTRALIA
    is MapScene.Places -> if (scene.places.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.places.map { it.location })
    is MapScene.Routes -> scene.options.flatMap { it.geometry }.let { if (it.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(it) }
    is MapScene.Following -> scene.position?.let { CameraSpec.Follow(it, scene.headingDeg) }
      ?: if (scene.line.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.line)
  }
}
