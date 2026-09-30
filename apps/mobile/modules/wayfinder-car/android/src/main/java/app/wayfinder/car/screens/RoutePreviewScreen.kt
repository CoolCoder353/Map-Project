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
    selected = index
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
      starting = false
      r.onFailure { CarToast.makeText(carContext, it.message ?: "Couldn’t start. Try again.", CarToast.LENGTH_LONG).show() }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = RoutePreviewNavigationTemplate.Builder().setTitle(destinationName).setHeaderAction(Action.BACK)
    val r = result ?: return b.setLoading(true).build()
    val plan = r.getOrElse { return problem(it.message ?: "Couldn’t plan a route. Try again.") }
    if (plan.options.isEmpty()) return problem("No route found to $destinationName.")
    val list = ItemList.Builder().setOnSelectedListener { select(it) }.setSelectedIndex(selected.coerceIn(0, plan.options.lastIndex))
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
   * The route preview only accepts rows that carry a duration, so the "25 min" part of the phone's
   * description (everything before the first "·") is marked as one; the rest reads as written.
   */
  private fun withDuration(o: RouteOption): CarText {
    val text = SpannableString(o.detail)
    val end = o.detail.indexOf('·').let { if (it > 0) o.detail.substring(0, it).trimEnd().length else o.detail.length }
    if (end > 0) text.setSpan(DurationSpan.create(o.durationS.toLong()), 0, end, Spanned.SPAN_INCLUSIVE_EXCLUSIVE)
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
