package app.wayfinder.car.map

import app.wayfinder.car.bridge.LngLat

data class SceneDrawing(val selected: List<LngLat>, val others: List<List<LngLat>>, val points: List<LngLat>, val position: LngLat?)

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

  /**
   * How long a camera move takes, in milliseconds; 0 jumps. Only following the car moves smoothly,
   * as the moving map is the driving task itself. Every other move (fitting places or routes on a
   * list or preview) jumps, because the car screen must not animate while driving (car app quality
   * SA-1).
   */
  fun moveMs(spec: CameraSpec): Int = if (spec is CameraSpec.Follow) FOLLOW_MS else 0

  fun drawing(scene: MapScene): SceneDrawing = when (scene) {
    is MapScene.Overview -> SceneDrawing(emptyList(), emptyList(), emptyList(), null)
    is MapScene.Places -> SceneDrawing(emptyList(), emptyList(), scene.places.map { it.location }, null)
    is MapScene.Routes -> SceneDrawing(
      scene.options.getOrNull(scene.selected)?.geometry.orEmpty(),
      scene.options.filterIndexed { i, _ -> i != scene.selected }.map { it.geometry },
      emptyList(),
      null,
    )
    is MapScene.Following -> SceneDrawing(scene.line, emptyList(), emptyList(), scene.position)
  }

  fun camera(scene: MapScene): CameraSpec = when (scene) {
    is MapScene.Overview -> scene.here?.let { CameraSpec.Center(it, 13.0) } ?: AUSTRALIA
    is MapScene.Places -> if (scene.places.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.places.map { it.location })
    is MapScene.Routes -> scene.options.flatMap { it.geometry }.let { if (it.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(it) }
    is MapScene.Following -> scene.position?.let { CameraSpec.Follow(it, scene.headingDeg) }
      ?: if (scene.line.isEmpty()) CameraSpec.Keep else CameraSpec.Fit(scene.line)
  }
}
