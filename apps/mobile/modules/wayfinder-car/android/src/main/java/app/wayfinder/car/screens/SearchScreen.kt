package app.wayfinder.car.screens

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/**
 * Type (parked) to find a place, then plan to it. Android Auto hides the keyboard while driving.
 * Results are numbered as their markers on the map.
 *
 * Typing searches once the typist pauses ([TYPING_PAUSE_MS]), not on every letter, and the last
 * results stay up while the next ones load: a search per letter blanked the list to a spinner with
 * each one and asked the server for words half typed. Emptying the box clears the results.
 */
class SearchScreen(
  carContext: CarContext,
  private val api: CarApi,
  private val map: MapScenes,
  private val hint: String,
) : Screen(carContext) {
  private var results: List<CarPlace> = emptyList()
  private var loading = false
  private var error: String? = null
  /** Every search takes a number; an answer to an older one is dropped. */
  private var ticket = 0
  private val handler = Handler(Looper.getMainLooper())
  /** The search waiting for the typist to pause. */
  private var typed: Runnable? = null

  internal val callback = object : SearchTemplate.SearchCallback {
    override fun onSearchTextChanged(searchText: String) {
      cancelTyped()
      val q = searchText.trim()
      if (q.isEmpty()) return clear()
      if (q.length < MIN_TYPED) return
      val later = Runnable {
        typed = null
        search(q)
      }
      typed = later
      handler.postDelayed(later, TYPING_PAUSE_MS)
    }

    override fun onSearchSubmitted(searchText: String) {
      cancelTyped()
      if (searchText.isNotBlank()) search(searchText)
    }
  }

  init {
    whenStarted { if (results.isNotEmpty()) show(map, MapScene.Places(results)) }
    // A search still waiting for a pause mustn't run after the driver has left.
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) = cancelTyped()
    })
  }

  private fun cancelTyped() {
    typed?.let { handler.removeCallbacks(it) }
    typed = null
  }

  private fun clear() {
    ticket++ // an answer still on its way is for words no longer there
    loading = false
    error = null
    if (results.isNotEmpty()) {
      results = emptyList()
      show(map, MapScene.Places(results))
    }
    invalidate()
  }

  private fun search(q: String) {
    val mine = ++ticket
    loading = true
    error = null
    invalidate()
    api.search(q.trim()) { r ->
      if (mine != ticket) return@search
      loading = false
      r.onSuccess {
        results = it.take(MAX_ROWS)
        if (results.isEmpty()) error = "Nothing found. Try another name or address."
        show(map, MapScene.Places(results))
      }.onFailure {
        results = emptyList()
        error = it.message ?: "Search didn’t work. Try again."
      }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = SearchTemplate.Builder(callback).setHeaderAction(Action.BACK).setSearchHint(hint).setShowKeyboardByDefault(true)
    // Only a spinner when there is nothing to show meanwhile.
    if (loading && results.isEmpty()) return b.setLoading(true).build()
    val list = ItemList.Builder()
    error?.let { list.setNoItemsMessage(it) }
    results.forEachIndexed { i, p -> list.addItem(row(p.name, p.detail, icon = numberIcon(i + 1)) { screenManager.push(RoutePreviewScreen.forPlace(carContext, api, map, p)) }) }
    return b.setItemList(list.build()).build()
  }

  companion object {
    /** Fewer letters than this are too few to search for while typing (submitting searches anyway). */
    const val MIN_TYPED = 3

    /** How long typing must pause before the words are searched for. */
    const val TYPING_PAUSE_MS = 500L
  }
}
