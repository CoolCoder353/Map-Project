package app.wayfinder.car.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.util.DisplayMetrics

/**
 * The markers on the car map, drawn here rather than taken from the server's style: a numbered
 * badge, the same one that is its row's image in the list beside the map (so "2" on the map is row
 * 2), and the destination pin.
 */
object MapPins {
  const val DESTINATION = "wf-destination"
  private const val NUMBERED = "wf-pin-"

  /** How big a list row's badge is drawn; the car scales row images to its own size. */
  const val ROW_PX = 96
  private const val BADGE_DP = 26f
  private const val DESTINATION_DP = 34f

  /** The map image for the badge numbered [label]. */
  fun numbered(label: String) = NUMBERED + label

  /** The map images [d] needs, by name. */
  fun imagesFor(d: SceneDrawing): Set<String> =
    d.pins.map { numbered(it.label) }.toSet() + setOfNotNull(d.destination?.let { DESTINATION })

  /** Those of them the map doesn't have yet ([have] is the map style's image by name, or null). */
  fun missing(d: SceneDrawing, have: (String) -> Any?): List<String> = imagesFor(d).filter { have(it) == null }

  /** The map image called [name], for a map drawn at [densityDpi], so it shows at its size in dp. */
  fun image(name: String, densityDpi: Int): Bitmap {
    val scale = densityDpi / DisplayMetrics.DENSITY_DEFAULT.toFloat()
    val bmp = if (name == DESTINATION) destination((DESTINATION_DP * scale).toInt()) else badge(name.removePrefix(NUMBERED), (BADGE_DP * scale).toInt())
    bmp.density = densityDpi
    return bmp
  }

  /** A badge [sizePx] across: the number in white on the app's blue (the route line's), ringed in white. */
  fun badge(label: String, sizePx: Int): Bitmap {
    val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val r = sizePx / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = Color.WHITE
    canvas.drawCircle(r, r, r, paint)
    paint.color = ACCENT
    canvas.drawCircle(r, r, r * 0.84f, paint)
    paint.color = Color.WHITE
    paint.textAlign = Paint.Align.CENTER
    paint.typeface = Typeface.DEFAULT_BOLD
    paint.textSize = r * 1.1f // one digit: lists stop at six rows
    canvas.drawText(label, r, r - (paint.descent() + paint.ascent()) / 2, paint)
    return bmp
  }

  /**
   * The destination: a red pin [sizePx] wide, ringed in white, with its point at the image's centre
   * (the lower half is empty) so it stands on the spot, as the centred badges do.
   */
  fun destination(sizePx: Int): Bitmap {
    val bmp = Bitmap.createBitmap(sizePx, sizePx * 2, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val cx = sizePx / 2f
    val head = sizePx * 0.34f
    val headY = sizePx * 0.4f
    val tipY = sizePx.toFloat()
    val ring = sizePx * 0.06f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    // The white ring is the same pin, [ring] bigger all round, under the red one.
    fun pin(grow: Float) = Path().apply {
      addCircle(cx, headY, head + grow, Path.Direction.CW)
      moveTo(cx - (head + grow) * 0.8f, headY + head * 0.55f)
      lineTo(cx + (head + grow) * 0.8f, headY + head * 0.55f)
      lineTo(cx, tipY - ring + grow)
      close()
    }
    paint.color = Color.WHITE
    canvas.drawPath(pin(ring), paint)
    paint.color = DESTINATION_RED
    canvas.drawPath(pin(0f), paint)
    paint.color = Color.WHITE
    canvas.drawCircle(cx, headY, head * 0.38f, paint)
    return bmp
  }

  /** The phone's accent (src/lib/theme.ts), as the chosen route is drawn. */
  private val ACCENT = 0xFF1765CC.toInt()
  private val DESTINATION_RED = 0xFFD93025.toInt()
}
