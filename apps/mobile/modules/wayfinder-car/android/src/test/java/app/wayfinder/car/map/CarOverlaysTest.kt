package app.wayfinder.car.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The speed readout and position marker over the car map: plain views, so tested without the map. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarOverlaysTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
  private fun View.drawn() = draw(Canvas(Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888)))

  @Test fun theSpeedReadoutShowsOnlyWithSomethingToSay() {
    val v = SpeedView(context).apply { visibility = View.GONE } // as the renderer makes it
    v.set(null, null)
    assertEquals(View.GONE, v.visibility)
    v.set(60, null)
    assertEquals("a limit alone", View.VISIBLE, v.visibility)
    v.drawn()
    v.set(null, 57)
    assertEquals("a speed alone (off the route)", View.VISIBLE, v.visibility)
    v.drawn()
    v.set(110, 118)
    v.drawn() // a three-figure limit, and over it
    v.set(null, null)
    assertEquals(View.GONE, v.visibility)
    assertTrue("the sign and the speed under it", v.heightPx > v.sizePx)
  }

  @Test fun thePositionMarkerPointsOnceTheWayIsKnown() {
    val p = PuckView(context, 0xFF1765CC.toInt())
    p.drawn()
    p.pointing = true
    assertTrue(p.pointing)
    p.drawn()
    p.pointing = true
    assertTrue(p.sizePx > 0)
  }
}
