package app.wayfinder.car

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/**
 * Logs when the car's screen starts and stops showing Wayfinder. The device harness
 * (scripts/device) reads the last of these lines, so it never taps the car's screen while
 * another Android Auto app, such as the dialler or messages, is in front.
 *
 * While shown, "car screen shown" is logged again every [REPEAT_MS]: a phone's log holds a few
 * hundred kilobytes, and other apps (and the harness's own screen reads) push a single line out
 * of it within a minute, after which the harness refused every car tap. Hidden stops the repeats,
 * and its line is always newer than any "shown" left in the log.
 */
class CarVisibility(
  private val log: (String) -> Unit = { Log.i(TAG, it) },
  /** Runs the block after the delay; returns a function that cancels it. */
  private val later: (Long, () -> Unit) -> () -> Unit = { ms, block ->
    val handler = Handler(Looper.getMainLooper())
    val r = Runnable(block)
    handler.postDelayed(r, ms)
    ({ handler.removeCallbacks(r) })
  },
) : DefaultLifecycleObserver {
  private var cancel: (() -> Unit)? = null

  override fun onResume(owner: LifecycleOwner) {
    shown()
  }

  override fun onPause(owner: LifecycleOwner) {
    cancel?.invoke()
    cancel = null
    log("car screen hidden")
  }

  private fun shown() {
    log("car screen shown")
    cancel = later(REPEAT_MS) { shown() }
  }

  companion object {
    const val TAG = "WayfinderCar"
    const val REPEAT_MS = 15_000L
  }
}
