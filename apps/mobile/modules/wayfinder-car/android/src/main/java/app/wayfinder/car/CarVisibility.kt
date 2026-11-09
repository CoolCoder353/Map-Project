package app.wayfinder.car

import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Logs when the car's screen starts and stops showing Wayfinder. The device harness
 * (scripts/device) reads the last of these lines, so it never taps the car's screen while
 * another Android Auto app, such as the dialler or messages, is in front.
 */
class CarVisibility(private val log: (String) -> Unit = { Log.i(TAG, it) }) : DefaultLifecycleObserver {
  override fun onResume(owner: LifecycleOwner) = log("car screen shown")
  override fun onPause(owner: LifecycleOwner) = log("car screen hidden")

  companion object {
    const val TAG = "WayfinderCar"
  }
}
