package app.wayfinder.car.map

/**
 * Which map style to load next. A style already loaded or loading isn't asked for again; one that
 * failed to load (no signal when the car started, say) is forgotten, so the next chance tries again
 * instead of leaving the map blank for the rest of the drive.
 */
class StyleLoads {
  private var current: String? = null
  private var isLoaded = false

  /** The style to load now, or null when there's nothing new to load. */
  fun next(wanted: String?): String? {
    if (wanted == null || wanted == current) return null
    current = wanted
    isLoaded = false
    return wanted
  }

  /** The style asked for is in. */
  fun loaded() {
    isLoaded = true
  }

  /**
   * The map failed to load something. MapLibre says so for a tile that didn't come as much as for
   * the style; only a style that never came in is tried again.
   */
  fun failed() {
    if (!isLoaded) current = null
  }

  /** A new map has no style yet. */
  fun reset() {
    current = null
    isLoaded = false
  }
}
