package app.wayfinder.car.map

import app.wayfinder.car.Samples
import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertEquals
import org.junit.Test

class SceneLayoutTest {
  private val here = LngLat(153.0, -27.4)

  @Test fun overviewCentresOnYouOrShowsAustralia() {
    assertEquals(CameraSpec.Center(here, 13.0), SceneLayout.camera(MapScene.Overview(here)))
    assertEquals(SceneLayout.AUSTRALIA, SceneLayout.camera(MapScene.Overview(null)))
  }

  @Test fun placesAreMarkedAndFitted() {
    val scene = MapScene.Places(listOf(Samples.place(), Samples.place("p2").copy(location = here)))
    assertEquals(listOf(LngLat(152.957, -27.4846), here), SceneLayout.drawing(scene).points)
    assertEquals(CameraSpec.Fit(listOf(LngLat(152.957, -27.4846), here)), SceneLayout.camera(scene))
  }

  @Test fun theChosenRouteStandsOut() {
    val a = Samples.option("a")
    val b = Samples.option("b").copy(geometry = listOf(here, LngLat(153.1, -27.5)))
    val d = SceneLayout.drawing(MapScene.Routes(listOf(a, b), 1))
    assertEquals(b.geometry, d.selected)
    assertEquals(listOf(a.geometry), d.others)
    assertEquals(CameraSpec.Fit(a.geometry + b.geometry), SceneLayout.camera(MapScene.Routes(listOf(a, b), 1)))
  }

  @Test fun drivingFollowsYouHeadingUpOrShowsTheRouteUntilThereIsAFix() {
    val line = listOf(here, LngLat(153.1, -27.5))
    assertEquals(CameraSpec.Follow(here, 90.0), SceneLayout.camera(MapScene.Following(line, here, 90.0)))
    assertEquals(CameraSpec.Fit(line), SceneLayout.camera(MapScene.Following(line, null, null)))
    assertEquals(here, SceneLayout.drawing(MapScene.Following(line, here, 90.0)).position)
  }

  @Test fun drawsTheRoadAlreadyDrivenWhileFollowing() {
    val driven = listOf(LngLat(152.9, -27.4), here)
    assertEquals(driven, SceneLayout.drawing(MapScene.Following(emptyList(), here, 90.0, driven)).travelled)
    assertEquals(emptyList<LngLat>(), SceneLayout.drawing(MapScene.Overview(here)).travelled)
  }

  /** The marker sits where the camera keeps the car: middle across, low in the visible area. */
  @Test fun theCarSitsLowInTheMiddleOfWhatIsVisible() {
    // Visible area 100..900 across, 0..500 down: 40% kept above for the road ahead.
    assertEquals(500f to 350f, SceneLayout.followPoint(100, 0, 900, 500))
  }

  /** Car app quality SA-1: no animation on the car screen, except the map following the car. */
  @Test fun onlyFollowingTheCarMovesSmoothlyEverythingElseJumps() {
    val line = listOf(here, LngLat(153.1, -27.5))
    assertEquals(SceneLayout.FOLLOW_MS, SceneLayout.moveMs(SceneLayout.camera(MapScene.Following(line, here, 90.0))))
    listOf(
      MapScene.Overview(here),
      MapScene.Overview(null),
      MapScene.Places(listOf(Samples.place())),
      MapScene.Routes(listOf(Samples.option("a")), 0),
      MapScene.Following(line, null, null),
    ).forEach { assertEquals(it.toString(), 0, SceneLayout.moveMs(SceneLayout.camera(it))) }
  }
}
