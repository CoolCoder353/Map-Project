package app.wayfinder.car.bridge

import android.content.Context
import com.facebook.react.ReactApplication

object ReactBoot {
  /**
   * The car can open Wayfinder while the phone app is closed. Starting React loads the app's
   * JavaScript (apps/mobile/index.ts), which starts answering the car without any phone screen.
   */
  fun ensureStarted(context: Context) {
    (context.applicationContext as? ReactApplication)?.reactHost?.start()
  }
}
