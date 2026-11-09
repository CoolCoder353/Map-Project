package app.wayfinder.car.map

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FollowCameraTest {
  @Test fun zoomsWithinSensibleLimits() {
    val c = FollowCamera()
    assertEquals(FollowCamera.DEFAULT_ZOOM, c.zoom, 0.0)
    assertTrue(c.zoomBy(1.0))
    assertEquals(17.0, c.zoom, 0.0)
    repeat(10) { c.zoomBy(1.0) }
    assertEquals(FollowCamera.MAX_ZOOM, c.zoom, 0.0)
    assertFalse("already as close as it goes", c.zoomBy(1.0))
    repeat(20) { c.zoomBy(-1.0) }
    assertEquals(FollowCamera.MIN_ZOOM, c.zoom, 0.0)
  }

  @Test fun movingTheMapStopsFollowingUntilReCentred() {
    val c = FollowCamera()
    assertTrue("the first drag", c.pan())
    assertFalse("more dragging changes nothing", c.pan())
    assertTrue(c.panned)
    assertTrue(c.recentre())
    assertFalse(c.panned)
    assertFalse("already following", c.recentre())
  }

  /** A tap arrives as a tiny scroll: it mustn't stop the map following the car (C62). */
  @Test fun aTapIsNotADrag() {
    val c = FollowCamera()
    assertFalse(c.drag(3f, 4f))
    assertFalse(c.drag(10f, 0f))
    assertTrue("adds up to a real drag", c.drag(20f, 0f))
    c.pan()
    c.recentre()
    assertFalse("counts afresh after re-centring", c.drag(5f, 0f))
  }
}
