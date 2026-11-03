package app.wayfinder.car.map

import android.graphics.Bitmap
import android.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MapPictureTest {
  private fun bitmap() = Bitmap.createBitmap(800, 480, Bitmap.Config.ARGB_8888)

  @Test fun aWideScreenIsScaledDownInProportion() {
    assertEquals(1024 to 512, MapPicture.scaled(2048, 1024))
    assertEquals(800 to 480, MapPicture.scaled(800, 480))
  }

  @Test fun encodesAsBase64() {
    val picture = MapPicture.encode(bitmap())
    assertNotNull(picture)
    assertTrue(Base64.decode(picture, Base64.NO_WRAP).isNotEmpty())
    assertFalse("no line breaks for the bridge", picture!!.contains('\n'))
  }

  @Test fun tooBigToSendIsNoPicture() {
    assertNull(MapPicture.encode(bitmap(), maxBytes = 1))
  }
}
