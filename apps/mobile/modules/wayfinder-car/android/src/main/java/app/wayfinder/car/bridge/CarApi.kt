package app.wayfinder.car.bridge

/** Everything the car screens need from the rest of the app. */
interface CarApi {
  fun status(done: (Result<CarStatus>) -> Unit)
  fun search(query: String, done: (Result<List<CarPlace>>) -> Unit)
  fun discover(done: (Result<List<CarPlace>>) -> Unit)
  fun plan(to: CarPlace, done: (Result<PlanResult>) -> Unit)
  fun planned(done: (Result<List<PlannedItem>>) -> Unit)
  fun routeLine(routeId: String, done: (Result<List<LngLat>>) -> Unit)
  fun start(routeId: String, destinationName: String, done: (Result<Unit>) -> Unit)
  fun stop()
  fun setMuted(muted: Boolean)
  /** "Report" while driving: files a bug report with what the car is showing (see src/car/handlers.ts). */
  fun report(done: (Result<Unit>) -> Unit)
  /** The car's "auto drive": a test drive that records nothing (see src/car/simulation.ts). */
  fun simulate(done: (Result<Unit>) -> Unit)
  val navigation: CarNav?
  fun onNavigation(listener: (CarNav?) -> Unit): () -> Unit
}
