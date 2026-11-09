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
  /** What the screen is headed, when more than the name (a saved place's address). */
  private val title: String = destinationName,
) : Screen(carContext) {
  private var result: Result<PlanResult>? = null
  private var selected = 0
  private var starting = false

  init {
    whenCreated { fetch() }
    whenStarted { showOnMap() }
  }

  private fun fetch() {
    load { r ->
      result = r
      showOnMap()
      // Only the chosen row shows Go: say once that the others can be chosen too (C95).
      if (r.getOrNull()?.options.orEmpty().size > 1 && !hinted) {
        hinted = true
        CarToast.makeText(carContext, PICK_HINT, CarToast.LENGTH_LONG).show()
      }
      invalidate()
    }
  }

  /** Plans again after a failure: no signal, or the phone not finding where it is. */
  internal fun retry() {
    result = null
    selected = 0
    invalidate()
    fetch()
  }

  private val options: List<RouteOption> get() = result?.getOrNull()?.options.orEmpty()

  private fun showOnMap() {
    if (options.isNotEmpty()) show(map, MapScene.Routes(options, selected))
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
    val b = RoutePreviewNavigationTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK)
    val r = result ?: return b.setLoading(true).build()
    val plan = r.getOrElse { return problem(it.message ?: "Couldn’t plan a route. Try again.", canRetry = true) }
    if (plan.options.isEmpty()) return problem("No route found to $destinationName.")
    val list = ItemList.Builder().setOnSelectedListener { select(it) }.setSelectedIndex(selected)
    // One line of text per row, always: a second line (the note, once) left the car's preview empty,
    // with no route and no Go, whenever a trip had only the fastest way. The note rides on that line.
    plan.options.forEachIndexed { i, o ->
      val option = if (i == 0 && plan.note != null) o.copy(detail = listOf(o.detail, plan.note).filter { it.isNotBlank() }.joinToString(" · ")) else o
      list.addItem(Row.Builder().setTitle(o.title).addText(withDuration(option)).build())
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

  private fun problem(text: String, canRetry: Boolean = false): Template =
    MessageTemplate.Builder(text)
      .setTitle(title)
      .setHeaderAction(Action.BACK)
      .apply { if (canRetry) addAction(Action.Builder().setTitle("Try again").setOnClickListener { retry() }.build()) }
      .build()

  companion object {
    const val PICK_HINT = "Tap a route to choose it, then Go."
    /** Said once per car connection: drivers learn it the first time. */
    private var hinted = false

    /** A saved name like "Home" with its address, so the driver can tell which Home it is (C99). */
    fun titleFor(place: CarPlace): String =
      if (place.saved && !place.address.isNullOrBlank() && !place.address.equals(place.name, ignoreCase = true)) "${place.name} · ${place.address}" else place.name

    fun forPlace(carContext: CarContext, api: CarApi, map: MapScenes, place: CarPlace) =
      RoutePreviewScreen(carContext, api, map, place.name, { done -> api.plan(place, done) }, titleFor(place))

    fun forPlanned(carContext: CarContext, api: CarApi, map: MapScenes, item: PlannedItem) =
      RoutePreviewScreen(carContext, api, map, item.name, load = { done -> done(Result.success(PlanResult(listOf(item.option), null))) })
  }
}
