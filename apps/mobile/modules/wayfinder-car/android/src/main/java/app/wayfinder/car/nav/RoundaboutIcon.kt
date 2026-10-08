package app.wayfinder.car.nav

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kotlin.math.cos
import kotlin.math.sin

/**
 * A roundabout drawn with the exit the driver takes: in from the bottom, clockwise round (Queensland
 * drives on the left) to the exit at [exitAngleDeg] (90 a left turn, 180 straight on, 270 right),
 * and out along it. One glyph for every roundabout said nothing about which way to go.
 */
object RoundaboutIcon {
  const val SIZE = 128
  private const val C = SIZE / 2f
  private const val RING = 26f
  private const val ARM = 58f

  /**
   * Where on the icon, from its centre, the exit leaves the roundabout and where its arm ends, as
   * (x, y) in pixels with y down. The way in is at the bottom; clockwise on the map is anticlockwise
   * from there in maths terms but, with y down, increasing angle.
   */
  fun exitArm(exitAngleDeg: Int): Pair<Pair<Float, Float>, Pair<Float, Float>> {
    val a = Math.toRadians(90.0 + exitAngleDeg)
    val dx = cos(a).toFloat()
    val dy = sin(a).toFloat()
    return (C + dx * RING to C + dy * RING) to (C + dx * ARM to C + dy * ARM)
  }

  fun draw(exitAngleDeg: Int): Bitmap {
    val angle = exitAngleDeg.coerceIn(1, 360)
    val bmp = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
      strokeWidth = 12f
      color = Color.WHITE
    }
    val ring = RectF(C - RING, C - RING, C + RING, C + RING)
    // The rest of the roundabout, faint; the way round to the exit, solid.
    stroke.alpha = 90
    canvas.drawArc(ring, 90f + angle, 360f - angle, false, stroke)
    stroke.alpha = 255
    canvas.drawArc(ring, 90f, angle.toFloat(), false, stroke)
    canvas.drawLine(C, SIZE - 4f, C, C + RING, stroke)
    val (from, to) = exitArm(angle)
    canvas.drawLine(from.first, from.second, to.first, to.second, stroke)
    // Arrow head on the exit arm, pointing out.
    val a = Math.toRadians(90.0 + angle)
    val head = Path().apply {
      val tip = (C + cos(a) * (ARM + 6)).toFloat() to (C + sin(a) * (ARM + 6)).toFloat()
      val back = ARM - 14
      val side = Math.toRadians(90.0)
      moveTo(tip.first, tip.second)
      lineTo((C + cos(a) * back + cos(a + side) * 14).toFloat(), (C + sin(a) * back + sin(a + side) * 14).toFloat())
      lineTo((C + cos(a) * back + cos(a - side) * 14).toFloat(), (C + sin(a) * back + sin(a - side) * 14).toFloat())
      close()
    }
    canvas.drawPath(head, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
    return bmp
  }
}
