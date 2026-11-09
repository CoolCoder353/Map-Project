package app.wayfinder.car.bridge

/** Everything the car screens need from the rest of the app. */
interface CarApi {
  fun status(done: (Result<CarStatus>) -> Unit)
  fun search(query: String, done: (Result<List<CarPlace>>) -> Unit)
  /** What is at [at], for a destination sent with no name; null when nothing is known there. */
  fun lookup(at: LngLat, done: (Result<CarPlace?>) -> Unit) = done(Result.success(null))
  fun discover(done: (Result<List<CarPlace>>) -> Unit)
  fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit)
  fun planned(done: (Result<List<PlannedItem>>) -> Unit)
  fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit)
  fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit)
  /** The limit on the road at [at], going [headingDeg], for the map with no trip. */
  fun speedLimit(at: LngLat, headingDeg: Double?, done: (Result<CarSpeedLimit>) -> Unit)
  /** The car's own position, from its GNSS: for when the phone can't say where it is. Nothing comes back. */
  fun location(fix: CarFix)
  fun stop()
  fun setMuted(muted: Boolean)
  /** The car app opened or closed: it needs the phone's JavaScript timers while open. Nothing comes back. */
  fun carSession(active: Boolean)
  /** "Report" while driving: files a bug report with what the car is showing, and a picture of its map if there is one (see src/car/handlers.ts). */
  fun report(screenshotJpeg: String? = null, done: (Result<Unit>) -> Unit)
  /** The car's "auto drive": a test drive that records nothing (see src/car/simulation.ts). */
  fun simulate(done: (Result<Unit>) -> Unit)
  val navigation: CarNav?
  fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit
}
