package app.wayfinder.car.nav

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import androidx.car.app.CarContext
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** NF-6 / VC-1: Android Auto finds "Navigate to …" support through an activity's intent filter. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigateActivityTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val navigate = Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:0,0?q=Mt+Coot-tha+Lookout"))

  @Test fun androidAutoFindsAnActivityForNavigateRequests() {
    val found = context.packageManager.queryIntentActivities(navigate, 0).map { it.activityInfo.name }
    assertEquals(listOf(NavigateActivity::class.java.name), found)
  }

  @Test fun onThePhoneItOpensWayfinderAndGetsOutOfTheWay() {
    val main = ComponentName(context.packageName, "app.wayfinder.maps.MainActivity")
    shadowOf(context.packageManager).apply {
      addActivityIfNotPresent(main)
      addIntentFilterForActivity(main, IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) })
    }
    val activity = Robolectric.buildActivity(NavigateActivity::class.java, navigate).create().get()
    assertEquals(main, shadowOf(activity).nextStartedActivity.component)
    assertTrue(activity.isFinishing)
  }
}
