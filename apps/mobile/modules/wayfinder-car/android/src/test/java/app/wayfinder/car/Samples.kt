package app.wayfinder.car

import app.wayfinder.car.bridge.*

object Samples {
  fun status(account: Account = Account.SIGNED_IN) =
    CarStatus(account, "https://maps.example.test/map/style.json?theme=light", "https://maps.example.test/map/style.json?theme=dark", "Search places and addresses", LngLat(153.0, -27.4))

  fun place(id: String = "p1", name: String = "Mt Coot-tha Lookout") =
    CarPlace(id, name, "Lookout · 6.2 km away", LngLat(152.957, -27.4846), 6200.0)

  fun option(routeId: String = "r-fast", title: String = "Fastest") =
    RouteOption(routeId, title, "25 min · 1.2 km you’ve never been", 1500.0, 18400.0, 0.0, listOf(LngLat(153.0, -27.4), LngLat(152.957, -27.4846)))

  fun nav(
    status: NavStatus = NavStatus.NAVIGATING,
    maneuver: CarManeuver? = CarManeuver("left", null),
    rerouting: Boolean = false,
    error: String? = null,
    muted: Boolean = false,
    routeId: String = "r-fast",
  ) = CarNav(
    routeId, "Mt Coot-tha Lookout", status, rerouting, muted, error,
    maneuver, "Turn left onto Main St", "Main St", 250.0, null,
    4000.0, 500.0, 1790000000000L, LngLat(153.0, -27.4), 90.0,
  )
}
