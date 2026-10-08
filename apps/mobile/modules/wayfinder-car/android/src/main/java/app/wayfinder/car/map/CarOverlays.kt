package app.wayfinder.car.map

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View

/** What the speed readout in the car says; drawing is [SpeedView]'s. */
object SpeedReadout {
  /** Over the limit by enough that it isn't GPS wobble. */
  const val OVER_BY_KMH = 3

  fun shown(limitKmh: Int?, speedKmh: Int?) = limitKmh != null || speedKmh != null

  fun over(limitKmh: Int?, speedKmh: Int?) = limitKmh != null && speedKmh != null && speedKmh >= limitKmh + OVER_BY_KMH
}

/**
 * The speed limit as Australian signs show it (black on white in a red ring, as on the phone's
 * Navigate screen) with the car's speed under it, red when over the limit. Drawn over the car map.
 */
class SpeedView(context: Context) : View(context) {
  private val density = context.resources.displayMetrics.density
  private var limitKmh: Int? = null
  private var speedKmh: Int? = null
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }

  val sizePx: Int get() = (SIGN_DP * density).toInt()
  val heightPx: Int get() = ((SIGN_DP + GAP_DP + SPEED_DP) * density).toInt()

  fun set(limitKmh: Int?, speedKmh: Int?) {
    if (limitKmh == this.limitKmh && speedKmh == this.speedKmh) return
    this.limitKmh = limitKmh
    this.speedKmh = speedKmh
    visibility = if (SpeedReadout.shown(limitKmh, speedKmh)) VISIBLE else GONE
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val d = density
    val size = SIGN_DP * d
    limitKmh?.let { limit ->
      val r = size / 2
      fill.color = Color.WHITE
      canvas.drawCircle(r, r, r, fill)
      fill.style = Paint.Style.STROKE
      fill.strokeWidth = 6 * d
      fill.color = SIGN_RED
      canvas.drawCircle(r, r, r - 3 * d, fill)
      fill.style = Paint.Style.FILL
      text.color = Color.BLACK
      text.textSize = (if (limit >= 100) 19 else 22) * d
      canvas.drawText(limit.toString(), r, r - (text.descent() + text.ascent()) / 2, text)
    }
    speedKmh?.let { speed ->
      val top = (SIGN_DP + GAP_DP) * d
      fill.color = 0xE6202124.toInt()
      canvas.drawRoundRect(RectF(0f, top, size, top + SPEED_DP * d), 8 * d, 8 * d, fill)
      text.color = if (SpeedReadout.over(limitKmh, speed)) 0xFFFF6B6B.toInt() else Color.WHITE
      text.textSize = 18 * d
      canvas.drawText(speed.toString(), size / 2, top + 19 * d, text)
      text.textSize = 10 * d
      text.color = Color.WHITE
      canvas.drawText("km/h", size / 2, top + 32 * d, text)
    }
  }

  private companion object {
    const val SIGN_DP = 60f
    const val GAP_DP = 6f
    const val SPEED_DP = 38f
    val SIGN_RED = Color.parseColor("#d0021b")
  }
}

/**
 * The car's position while the map follows it: fixed on the screen where the camera keeps the car
 * ([SceneLayout.followPoint]), so it stays still while the map glides under it. Points up, the way
 * the map is turned (the direction of travel), once that is known.
 */
class PuckView(context: Context, private val accent: Int) : View(context) {
  private val density = context.resources.displayMetrics.density
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val arrow = Path()
  var pointing = false
    set(value) {
      if (field != value) invalidate()
      field = value
    }

  val sizePx: Int get() = (SIZE_DP * density).toInt()

  override fun onDraw(canvas: Canvas) {
    val r = SIZE_DP * density / 2
    paint.color = Color.WHITE
    canvas.drawCircle(r, r, r, paint)
    paint.color = accent
    canvas.drawCircle(r, r, r - 3 * density, paint)
    if (!pointing) return
    val s = r * 0.55f
    arrow.reset()
    arrow.moveTo(r, r - s)
    arrow.lineTo(r + s * 0.75f, r + s * 0.8f)
    arrow.lineTo(r, r + s * 0.4f)
    arrow.lineTo(r - s * 0.75f, r + s * 0.8f)
    arrow.close()
    paint.color = Color.WHITE
    canvas.drawPath(arrow, paint)
  }

  private companion object {
    const val SIZE_DP = 26f
  }
}
