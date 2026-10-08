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
}
