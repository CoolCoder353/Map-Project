package app.wayfinder.car.map

import app.wayfinder.car.Samples
import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneLayoutTest {
  private val here = LngLat(153.0, -27.4)

  @Test fun overviewCentresOnYouOrShowsAustralia() {
    assertEquals(CameraSpec.Center(here, 13.0), SceneLayout.camera(MapScene.Overview(here)))
    assertEquals(SceneLayout.AUSTRALIA, SceneLayout.camera(MapScene.Overview(null)))
  }

  /** Numbered as their rows are, so "2" on the map is the second row. */
  @Test fun placesAreNumberedAndFitted() {
    val scene = MapScene.Places(listOf(Samples.place(), Samples.place("p2").copy(location = here)))
    assertEquals(listOf(Pin(LngLat(152.957, -27.4846), "1"), Pin(here, "2")), SceneLayout.drawing(scene).pins)
    assertEquals(CameraSpec.Fit(listOf(LngLat(152.957, -27.4846), here)), SceneLayout.camera(scene))
  }

  @Test fun homeMarksWhereYouAre() {
    assertEquals(here, SceneLayout.drawing(MapScene.Overview(here)).position)
    assertNull(SceneLayout.drawing(MapScene.Overview(null)).position)
  }

  /** A list of routes, none chosen yet: each numbered at its middle, where routes that start together have parted. */
  @Test fun routesToPickFromAreNumberedAtTheirMiddles() {
    val a = Samples.option("a").copy(geometry = listOf(here, LngLat(153.1, -27.4), LngLat(153.2, -27.4)))
    val empty = Samples.option("b").copy(geometry = emptyList())
    val c = Samples.option("c").copy(geometry = listOf(here, LngLat(153.0, -27.6)))
    val d = SceneLayout.drawing(MapScene.Routes(listOf(a, empty, c), MapScene.Routes.NONE))
    assertEquals("a route with no line doesn't renumber the next", listOf(Pin(LngLat(153.1, -27.4), "1"), Pin(LngLat(153.0, -27.6), "3")), d.pins)
    assertEquals(emptyList<LngLat>(), d.selected)
    assertEquals(listOf(a.geometry, empty.geometry, c.geometry), d.others)
    assertNull("nothing chosen, so no destination", d.destination)
  }

  /** Two routes sharing their roads put their numbers in different places, not one on the other (C68). */
  @Test fun routesOnTheSameRoadsAreNumberedApart() {
    val line = (0..9).map { LngLat(153.0 + it * 0.01, -27.4) }
    val d = SceneLayout.drawing(MapScene.Routes(listOf(Samples.option("a").copy(geometry = line), Samples.option("b").copy(geometry = line)), MapScene.Routes.NONE))
    assertNotEquals(d.pins[0].at, d.pins[1].at)
  }

  @Test fun theChosenRouteEndsAtTheDestinationPin() {
    val a = Samples.option("a")
    val chosen = SceneLayout.drawing(MapScene.Routes(listOf(a), 0))
    assertEquals(a.geometry.last(), chosen.destination)
    assertTrue("one route on its own needs no label", chosen.pins.isEmpty())
    val line = listOf(here, LngLat(153.1, -27.5))
    assertEquals(line.last(), SceneLayout.drawing(MapScene.Following(line, here, 90.0)).destination)
    assertNull("not before the route's line has come", SceneLayout.drawing(MapScene.Following(emptyList(), here, 90.0)).destination)
  }

  @Test fun theChosenRouteStandsOut() {
    val a = Samples.option("a")
    val b = Samples.option("b").copy(geometry = listOf(here, LngLat(153.1, -27.5)))
    val d = SceneLayout.drawing(MapScene.Routes(listOf(a, b), 1))
    assertEquals(b.geometry, d.selected)
    assertEquals(listOf(a.geometry), d.others)
    // Each line carries its time, as its row does (C-U5).
    val timed = SceneLayout.drawing(MapScene.Routes(listOf(a, b.copy(durationS = 960.0)), 0))
    assertEquals(listOf("25 min", "16 min"), timed.pins.map { it.label })
    assertEquals("1 h 5 min", SceneLayout.minutes(3900.0))
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

  @Test fun drawsTheLightsAheadOnlyWhileFollowing() {
    val lights = listOf(app.wayfinder.car.bridge.RouteLight(here, true))
    assertEquals(lights, SceneLayout.drawing(MapScene.Following(emptyList(), here, 90.0, lights = lights)).lights)
    assertEquals(emptyList<app.wayfinder.car.bridge.RouteLight>(), SceneLayout.drawing(MapScene.Overview(here)).lights)
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

  /** No position yet: where the car or phone last was, not all of Australia (C67). */
  @Test fun homeOpensWhereYouLastWereBeforeAnyPosition() {
    assertEquals(CameraSpec.Center(here, SceneLayout.HOME_ZOOM), SceneLayout.camera(MapScene.Overview(null), remembered = here))
  }

  /** Search results show where you are among them (C66). */
  @Test fun placesShowWhereYouAre() {
    assertEquals(here, SceneLayout.drawing(MapScene.Places(listOf(Samples.place()), here)).position)
  }

  /** A chosen route is marked where it starts, before Go (C13, C34). */
  @Test fun theChosenRouteIsMarkedWhereItStarts() {
    val a = Samples.option("a")
    assertEquals(a.geometry.first(), SceneLayout.drawing(MapScene.Routes(listOf(a), 0)).start)
    assertNull(SceneLayout.drawing(MapScene.Routes(listOf(a), MapScene.Routes.NONE)).start)
  }

  /** Pins on top of each other share one badge with both numbers (C30). */
  @Test fun pinsThatWouldOverlapShareABadge() {
    val near = LngLat(here.lon + 0.0001, here.lat)
    val far = LngLat(here.lon + 0.2, here.lat - 0.2)
    val pins = SceneLayout.grouped(listOf(Pin(here, "1"), Pin(far, "2"), Pin(near, "3")))
    assertEquals(listOf(Pin(here, "1·3"), Pin(far, "2")), pins)
    assertEquals(listOf(Pin(here, "1")), SceneLayout.grouped(listOf(Pin(here, "1"))))
  }

  /** Only following the car is tilted and turned; every other map is flat and north up (C5, C27). */
  @Test fun browsingMapsAreFlatAndNorthUp() {
    val follow = CameraSpec.Follow(here, 90.0)
    assertEquals(SceneLayout.FOLLOW_TILT, SceneLayout.tilt(follow), 0.0)
    assertEquals(90.0, SceneLayout.bearing(follow), 0.0)
    for (spec in listOf(CameraSpec.Center(here, 13.0), CameraSpec.Fit(listOf(here)))) {
      assertEquals(0.0, SceneLayout.tilt(spec), 0.0)
      assertEquals(0.0, SceneLayout.bearing(spec), 0.0)
    }
  }

  /** The speed readout keeps a column to the left; the car is centred in what's left (C2, C88). */
  @Test fun theCarIsCentredClearOfTheSpeedReadout() {
    val column = SceneLayout.speedColumn(60, 12, shown = true)
    assertEquals(84, column)
    assertEquals(0, SceneLayout.speedColumn(60, 12, shown = false))
    val (x, _) = SceneLayout.followPoint(300, 0, 800, 480, column)
    assertEquals((300 + 84 + 800) / 2f, x, 0f)
  }

  /** The home map centred the car under the list card's edge (R2-C5): the padding keeps it in the open map. */
  @Test fun theCameraIsPaddedToTheMapTheDriverCanSee() {
    // An 800×480 surface with the list card over its left 400 px.
    assertArrayEquals(doubleArrayOf(400.0, 0.0, 0.0, 0.0), SceneLayout.padding(800, 480, 400, 0, 800, 480), 0.0)
    // A speed column, and a visible area short of the right and bottom edges.
    assertArrayEquals(doubleArrayOf(130.0, 10.0, 20.0, 30.0), SceneLayout.padding(800, 480, 100, 10, 780, 450, 30), 0.0)
  }

  /** Search results with where you are among them, so "4 km away" can be seen on the map (C-U2). */
  @Test fun searchResultsAreFittedWithWhereYouAre() {
    val here = LngLat(153.25, -27.56)
    val spec = SceneLayout.camera(MapScene.Places(listOf(Samples.place()), here)) as CameraSpec.Fit
    assertTrue(here in spec.points)
  }
}
