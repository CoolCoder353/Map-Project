package app.wayfinder.car.map

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * A picture of the car's map, for a report from the car. It is only the map this app draws: the turn
 * card and buttons over it are drawn by Android Auto, which gives an app no way to read them, so the
 * report says in words what they showed.
 */
fun interface MapPictures {
  /** Calls [done] with a base64 JPEG, or null if there's none to be had. */
  fun capture(done: (String?) -> Unit)
}

object MapPicture {
  /** Plenty to read the roads by, and small enough to send over a weak signal. */
  private const val MAX_WIDTH = 1024
  private const val QUALITY = 70
  /** Well inside the 2 MB the server takes (FEEDBACK_SCREENSHOT_MAX_BYTES). */
  private const val MAX_BYTES = 1_500_000

  /** The width and height for a picture [width] wide, kept in proportion. */
  fun scaled(width: Int, height: Int, maxWidth: Int = MAX_WIDTH): Pair<Int, Int> =
    if (width <= maxWidth) width to height else maxWidth to (height * maxWidth.toDouble() / width).roundToInt()

  /** The picture as base64, or null if it can't be made small enough. */
  fun encode(bitmap: Bitmap, maxBytes: Int = MAX_BYTES): String? {
    val (w, h) = scaled(bitmap.width, bitmap.height)
    val out = ByteArrayOutputStream()
    val sized = if (w == bitmap.width) bitmap else Bitmap.createScaledBitmap(bitmap, w, h, true)
    if (!sized.compress(Bitmap.CompressFormat.JPEG, QUALITY, out) || out.size() == 0 || out.size() > maxBytes) return null
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
