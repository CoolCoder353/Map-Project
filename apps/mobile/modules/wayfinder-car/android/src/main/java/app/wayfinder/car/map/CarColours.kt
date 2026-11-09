package app.wayfinder.car.map

/**
 * The colours the car map draws its own things in, by day and by night. The server's style turns
 * dark at night; these follow it (C70), so the route's edge isn't a bright white band on a dark map.
 */
data class CarColours(
  /** The edge around the chosen route. */
  val casing: String,
  /** The road already driven: the route's blue, faded, so it reads as behind you, not a second route (C17). */
  val travelled: String,
  /** Routes not chosen. */
  val others: String,
) {
  companion object {
    const val ACCENT = "#1765cc"
    val DAY = CarColours(casing = "#ffffff", travelled = "#8fb3e6", others = "#8a94a6")
    val NIGHT = CarColours(casing = "#0b1f3d", travelled = "#3f5f8f", others = "#5d6573")

    fun of(dark: Boolean) = if (dark) NIGHT else DAY
  }
}

/** Layers of the server's style the car leaves off or changes. */
object CarMapLayers {
  /**
   * Buildings, place dots and traffic lights: background for browsing, clutter at driving zoom (C18,
   * C92). Hidden while following the car.
   */
  val CLUTTER = listOf("building", "poi", "poi-label", "traffic-signals", "traffic-signals-lamp")

  /** Street names, drawn bigger in the car, which is read at arm's length (C91). */
  const val ROAD_LABEL = "road-label"
  const val ROAD_LABEL_SCALE = 1.35f

  fun hidden(scene: MapScene): Boolean = scene is MapScene.Following
}
