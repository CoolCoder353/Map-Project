package app.wayfinder.car.nav

import androidx.car.app.model.Distance
import kotlin.math.roundToLong

/** The car's distance for [meters], rounded as the phone shows it (formatDistanceShort). */
fun distanceOf(meters: Double): Distance = when {
  meters >= 10_000 -> Distance.create((meters / 1000).roundToLong().toDouble(), Distance.UNIT_KILOMETERS)
  meters >= 1_000 -> Distance.create((meters / 100).roundToLong() / 10.0, Distance.UNIT_KILOMETERS_P1)
  meters >= 100 -> Distance.create((meters / 10).roundToLong() * 10.0, Distance.UNIT_METERS)
  else -> Distance.create(meters.roundToLong().toDouble(), Distance.UNIT_METERS)
}

/** The same rounding as [distanceOf], as words, for the navigation notification: "250 m", "1.4 km", "12 km". */
fun distanceText(meters: Double): String = when {
  meters >= 10_000 -> "${(meters / 1000).roundToLong()} km"
  meters >= 1_000 -> "${(meters / 100).roundToLong() / 10.0} km"
  meters >= 100 -> "${(meters / 10).roundToLong() * 10} m"
  else -> "${meters.roundToLong()} m"
}
