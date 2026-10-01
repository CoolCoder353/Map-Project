package app.wayfinder.car.nav

import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.car.app.navigation.model.Trip
import app.wayfinder.car.bridge.CarManeuver
import app.wayfinder.car.bridge.CarNav
import app.wayfinder.car.bridge.NavStatus
import java.util.TimeZone
import kotlin.math.roundToLong

object NavTemplates {
  fun navigation(nav: CarNav?, icons: ManeuverIcons, onEnd: () -> Unit, onMute: () -> Unit): NavigationTemplate {
    val arrived = nav?.status == NavStatus.ARRIVED
    val strip = ActionStrip.Builder()
      .addAction(Action.Builder().setTitle(if (nav?.muted == true) "Unmute" else "Mute").setOnClickListener(onMute).build())
      .addAction(Action.Builder().setTitle(if (arrived) "Done" else "End").setOnClickListener(onEnd).build())
      .build()
    val b = NavigationTemplate.Builder().setActionStrip(strip)
    when {
      nav == null -> b.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
      arrived -> b.setNavigationInfo(MessageInfo.Builder("You’ve arrived").apply { nav.destinationName?.let { setText(it) } }.build())
      nav.rerouting -> b.setNavigationInfo(MessageInfo.Builder("Finding a new route…").build())
      nav.error != null -> b.setNavigationInfo(MessageInfo.Builder(nav.error).build())
      nav.status == NavStatus.OFF_ROUTE -> b.setNavigationInfo(MessageInfo.Builder("Off route").build())
      nav.maneuver == null -> b.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
      else -> b.setNavigationInfo(routingInfo(nav, nav.maneuver, icons))
    }
    if (nav != null && !arrived) b.setDestinationTravelEstimate(estimate(nav))
    return b.build()
  }

  /** For the car's own displays (the cluster behind the wheel, heads-up). */
  fun trip(nav: CarNav, icons: ManeuverIcons): Trip = Trip.Builder()
    .addDestination(Destination.Builder().setName(nav.destinationName ?: "Destination").build(), estimate(nav))
    .apply {
      if (nav.road.isNotEmpty()) setCurrentRoad(nav.road)
      val m = nav.maneuver
      if (m != null && nav.status == NavStatus.NAVIGATING) addStep(step(m, nav.cue, nav.road, icons), estimate(nav, nav.distanceToManeuverM ?: 0.0))
      else setLoading(nav.status == NavStatus.STARTING)
    }
    .build()

  private fun routingInfo(nav: CarNav, m: CarManeuver, icons: ManeuverIcons): RoutingInfo =
    RoutingInfo.Builder()
      .setCurrentStep(step(m, nav.cue, nav.road, icons), distanceOf(nav.distanceToManeuverM ?: 0.0))
      .apply { nav.next?.let { setNextStep(step(it.maneuver, it.cue, "", icons)) } }
      .build()

  private fun step(m: CarManeuver, cue: String, road: String, icons: ManeuverIcons): Step =
    Step.Builder(cue.ifEmpty { "Continue" })
      .setManeuver(
        Maneuver.Builder(Maneuvers.typeOf(m))
          .apply { if (Maneuvers.typeOf(m) == Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW) setRoundaboutExitNumber(m.exit!!) }
          .setIcon(icons.iconFor(m.type))
          .build(),
      )
      .apply { if (road.isNotEmpty()) setRoad(road) }
      .build()

  /** Arrival time and time left are for the whole trip; [meters] is how far the estimate's subject is (default: the destination). */
  private fun estimate(nav: CarNav, meters: Double = nav.remainingDistanceM): TravelEstimate =
    TravelEstimate.Builder(distanceOf(meters), DateTimeWithZone.create(nav.arrivalEpochMs, TimeZone.getDefault()))
      .setRemainingTimeSeconds(nav.remainingDurationS.roundToLong())
      .build()
}
