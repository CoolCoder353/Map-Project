package app.wayfinder.car.nav

import android.content.Intent
import androidx.car.app.CarContext
import androidx.car.app.ScreenManager
import app.wayfinder.car.CarMessages
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.map.MapScenes
import app.wayfinder.car.screens.MessageScreen
import app.wayfinder.car.screens.PickScreens
import app.wayfinder.car.screens.RoutePreviewScreen

/**
 * "Navigate to ..." from Google Assistant or another app: gets the driver to the route preview for
 * that place, the same screen the car's Search leads to. Used for the intent that opened the app
 * and for any that arrive while it is open.
 *
 * It asks the phone app for its account first (which also starts React when the phone app was
 * closed), so a signed-out or unreachable phone is told so, with "Try again", rather than leaving
 * the driver at Home wondering.
 */
class NavigateRequests(
  private val carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  /** False once the car session has ended: late answers then do nothing. */
  private val alive: () -> Boolean = { true },
) {
  private val screens get() = carContext.getCarService(ScreenManager::class.java)

  /** Does what [intent] asks, if it is a navigate request; ignores any other intent. */
  fun handle(intent: Intent) {
    when (val request = NavigateIntents.parse(intent) ?: return) {
      NavigateRequest.Malformed -> show("Wayfinder couldn’t read that destination.")
      else -> run(request)
    }
  }

  private fun run(request: NavigateRequest) {
    api.status { r ->
      if (!alive()) return@status
      val status = r.getOrElse { return@status show(it.message ?: "Something went wrong. Try again.", request) }
      when (status.account) {
        Account.SIGNED_OUT -> show(CarMessages.SIGN_IN, request)
        Account.OFFLINE -> show(CarMessages.OFFLINE, request)
        Account.SIGNED_IN -> open(request)
      }
    }
  }

  private fun open(request: NavigateRequest) {
    when (request) {
      is NavigateRequest.At -> if (request.label != null) {
        preview(CarPlace("geo", request.label, "", request.place, null))
      } else {
        // No name sent: what is there, so the preview says where it's going (C75).
        api.lookup(request.place) { r ->
          if (!alive()) return@lookup
          val found = r.getOrNull()
          preview(CarPlace("geo", found?.name ?: DESTINATION, found?.detail.orEmpty(), request.place, null, address = found?.address))
        }
      }
      is NavigateRequest.Named -> api.search(request.query) { r ->
        if (!alive()) return@search
        r.onSuccess { places ->
          when {
            places.isEmpty() -> show("Nothing found for “${request.query}”.")
            places.size == 1 -> preview(places[0])
            // More than one: the driver picks, rather than being sent to whichever came first (C72).
            else -> {
              screens.popToRoot()
              screens.push(PickScreens.choose(carContext, api, map, "Which ${request.query}?", places))
            }
          }
        }.onFailure { show(it.message ?: "Search didn’t work. Try again.", request) }
      }
      NavigateRequest.Malformed -> Unit
    }
  }

  /** Back to the start, then the preview, so repeated requests don't pile up screens. */
  private fun preview(place: CarPlace) {
    screens.popToRoot()
    screens.push(RoutePreviewScreen.forPlace(carContext, api, map, place))
  }

  private fun show(message: String, retry: NavigateRequest? = null) {
    screens.push(
      MessageScreen(carContext, message, retry?.let { r -> { screens.pop(); run(r) } }),
    )
  }

  private companion object {
    /** Shown when a sender gives a point and no name. */
    const val DESTINATION = "Chosen place"
  }
}
