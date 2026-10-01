package app.wayfinder.car

import app.wayfinder.car.bridge.CarBridge
import app.wayfinder.car.voice.NavVoice
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side's handle on the car app. */
class WayfinderCarModule : Module() {
  private val voiceLazy = lazy { NavVoice(appContext.reactContext!!) }

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

    // Directions go through the app's own voice so the music dips. Before the app context exists
    // there is nothing to speak with, so a request then is dropped rather than crashing.
    Function("speak") { text: String -> if (appContext.reactContext != null) voiceLazy.value.speak(text) }
    Function("stopSpeaking") { if (voiceLazy.isInitialized()) voiceLazy.value.stop() }

    OnDestroy {
      CarBridge.shared.disconnect()
      if (voiceLazy.isInitialized()) voiceLazy.value.stop()
    }
  }
}
