package app.wayfinder.car.bridge

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

object ReactBoot {
  /**
   * The car can open Wayfinder while the phone app is closed. Starting React loads the app's
   * JavaScript (apps/mobile/index.ts), which starts answering the car without any phone screen.
   */
  fun ensureStarted(context: Context) {
    (context.applicationContext as? ReactApplication)?.reactHost?.start()
  }

  /**
   * Starts the do-nothing headless task that keeps JavaScript timers running with no app screen;
   * JavaScript ends it (src/lib/keepTimers.ts). It has to be on the context the timers listen to,
   * which is the host's current one.
   */
  fun keepTimersRunning(context: Context) {
    val react = (context.applicationContext as? ReactApplication)?.reactHost?.currentReactContext ?: return
    UiThreadUtil.runOnUiThread {
      HeadlessJsTaskContext.getInstance(react).startTask(HeadlessJsTaskConfig("WayfinderKeepTimers", Arguments.createMap(), 0, true))
    }
  }
}
