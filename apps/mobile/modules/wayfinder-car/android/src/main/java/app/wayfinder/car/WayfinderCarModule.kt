package app.wayfinder.car

import app.wayfinder.car.bridge.CarBridge
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side's handle on the car app. */
class WayfinderCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WayfinderCar")
    Events("onCall")

    // JavaScript calls this once it is listening; anything the car asked meanwhile goes out now.
    Function("ready") {
      CarBridge.shared.connect { id, method, params ->
        sendEvent("onCall", mapOf("id" to id, "method" to method, "params" to params))
      }
    }
    Function("resolve") { id: String, json: String -> CarBridge.shared.resolve(id, json) }
    Function("reject") { id: String, message: String -> CarBridge.shared.reject(id, message) }
    Function("setNavigation") { json: String? -> CarBridge.shared.setNavigation(json) }

    OnDestroy { CarBridge.shared.disconnect() }
  }
}
