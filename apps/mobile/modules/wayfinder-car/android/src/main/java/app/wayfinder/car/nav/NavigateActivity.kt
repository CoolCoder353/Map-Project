package app.wayfinder.car.nav

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Where Android Auto finds a navigation app's "Navigate to …" support (car app quality NF-6, VC-1).
 * Google's navigation page puts the `androidx.car.app.action.NAVIGATE` filter on the Activity that
 * handles the request when the person isn't using Android Auto, so the host can see the app takes
 * it. In the car the host hands the same intent to the car session (WayfinderSession's
 * onCreateScreen and onNewIntent), which plans the route. On the phone this just opens Wayfinder.
 */
class NavigateActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    finish()
  }
}
