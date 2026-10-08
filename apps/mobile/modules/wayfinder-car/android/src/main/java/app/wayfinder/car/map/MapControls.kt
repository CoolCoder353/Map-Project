package app.wayfinder.car.map

/** The driver's own moves on the car map: zoom buttons, and dragging it while in pan mode. */
interface MapControls {
  /** The driver has moved the map away from the car; "Re-centre" brings it back. */
  val panned: Boolean
  fun zoomBy(steps: Double)
  fun recentre()
  /** Called when the driver has moved the map (or brought it back), so the screen can redraw its buttons. */
  fun onPannedChanged(listener: (Boolean) -> Unit): () -> Unit
}

/**
 * How close the map follows the car, and whether the driver has moved it away. Kept apart from
 * the renderer (which needs a real map) so it can be tested.
 */
class FollowCamera {
  var zoom = DEFAULT_ZOOM
    private set
  var panned = false
    private set

  /** Returns whether anything changed. */
  fun zoomBy(steps: Double): Boolean {
    val next = (zoom + steps).coerceIn(MIN_ZOOM, MAX_ZOOM)
    if (next == zoom) return false
    zoom = next
    return true
  }

  fun pan(): Boolean = (!panned).also { panned = true }
  fun recentre(): Boolean = panned.also { panned = false }

  companion object {
    const val DEFAULT_ZOOM = 16.0
    const val MIN_ZOOM = 11.0
    const val MAX_ZOOM = 18.5
  }
}
