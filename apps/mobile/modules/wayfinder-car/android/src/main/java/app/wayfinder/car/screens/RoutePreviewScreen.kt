package app.wayfinder.car.screens

import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarText
import androidx.car.app.model.DurationSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.bridge.PlanResult
import app.wayfinder.car.bridge.PlannedItem
import app.wayfinder.car.bridge.RouteOption
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** The fastest route and ways you haven't been, to choose between before Go. */
class RoutePreviewScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val destinationName: String,
  private val load: ((Result<PlanResult>) -> Unit) -> Unit,
) : Screen(carContext) {
  private var result: Result<PlanResult>? = null
  private var selected = 0
  private var starting = false

  init {
    whenCreated {
      load { r ->
        result = r
        showOnMap()
        invalidate()
      }
    }
    whenStarted { showOnMap() }
  }

  private val options: List<RouteOption> get() = result?.getOrNull()?.options.orEmpty()

  private fun showOnMap() {
    if (options.isNotEmpty()) map.show(MapScene.Routes(options, selected))
  }

  internal fun select(index: Int) {
    selected = index.coerceIn(0, maxOf(0, options.lastIndex))
    showOnMap()
    invalidate()
  }

  /** Once started, navigation takes over the screen (NavigationCoordinator). */
  internal fun go() {
    val option = options.getOrNull(selected) ?: return
    if (starting) return
    starting = true
    invalidate()
    api.start(option.routeId, destinationName) { r ->
      // On success the action stays "Starting…" until navigation replaces this screen, so a second tap can't start another trip.
      r.onFailure {
        starting = false
        CarToast.makeText(carContext, it.message ?: "Couldn’t start. Try again.", CarToast.LENGTH_LONG).show()
      }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = RoutePreviewNavigationTemplate.Builder().setTitle(destinationName).setHeaderAction(Action.BACK)
    val r = result ?: return b.setLoading(true).build()
    val plan = r.getOrElse { return problem(it.message ?: "Couldn’t plan a route. Try again.") }
    if (plan.options.isEmpty()) return problem("No route found to $destinationName.")
    val list = ItemList.Builder().setOnSelectedListener { select(it) }.setSelectedIndex(selected)
    plan.options.forEachIndexed { i, o ->
      list.addItem(
        Row.Builder().setTitle(o.title).addText(withDuration(o)).apply { if (i == 0 && plan.note != null) addText(plan.note) }.build(),
      )
    }
    return b
      .setItemList(list.build())
      .setNavigateAction(Action.Builder().setTitle(if (starting) "Starting…" else "Go").setOnClickListener { go() }.build())
      .build()
  }

  /**
   * The route preview only accepts rows that carry a duration, and hosts show a DurationSpan as their own
   * formatted duration. So only the leading "25 min" of the phone's description is marked as one, up to the
   * first " (" or " ·"; the extra time and how much is new read as written. With nothing to mark (an empty
   * description), the row's text is the duration itself.
   */
  private fun withDuration(o: RouteOption): CarText {
    val span = DurationSpan.create(o.durationS.toLong())
    val end = listOf(" (", " ·").map { o.detail.indexOf(it) }.filter { it > 0 }.minOrNull() ?: o.detail.length
    if (o.detail.isBlank()) {
      val text = SpannableString("${maxOf(1, Math.round(o.durationS / 60.0))} min")
      text.setSpan(span, 0, text.length, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
      return CarText.create(text)
    }
    val text = SpannableString(o.detail)
    text.setSpan(span, 0, end, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
    return CarText.create(text)
  }

  private fun problem(text: String): Template =
    MessageTemplate.Builder(text).setTitle(destinationName).setHeaderAction(Action.BACK).build()

  companion object {
    fun forPlace(carContext: CarContext, api: CarApi, map: MapScenes, place: CarPlace) =
      RoutePreviewScreen(carContext, api, map, place.name) { done -> api.plan(place, done) }

    fun forPlanned(carContext: CarContext, api: CarApi, map: MapScenes, item: PlannedItem) =
      RoutePreviewScreen(carContext, api, map, item.name) { done -> done(Result.success(PlanResult(listOf(item.option), null))) }
  }
}
