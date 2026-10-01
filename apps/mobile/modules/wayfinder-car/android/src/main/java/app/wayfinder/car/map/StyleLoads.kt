package app.wayfinder.car.map

/**
 * Which map style to load next. A style already loaded or loading isn't asked for again; one that
 * failed to load (no signal when the car started, say) is forgotten, so the next chance tries again
 * instead of leaving the map blank for the rest of the drive.
 */
class StyleLoads {
  private var current: String? = null

  /** The style to load now, or null when there's nothing new to load. */
  fun next(wanted: String?): String? {
    if (wanted == null || wanted == current) return null
    current = wanted
    return wanted
  }

  fun failed() {
    current = null
  }

  /** A new map has no style yet. */
  fun reset() {
    current = null
  }
}
