package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import app.wayfinder.car.bridge.CarApi
import app.wayfinder.car.bridge.CarPlace
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.map.MapScenes

/** Type (parked) to find a place, then plan to it. Android Auto hides the keyboard while driving. */
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

  internal val callback = object : SearchTemplate.SearchCallback {
    override fun onSearchTextChanged(searchText: String) {
      if (searchText.trim().length >= 3) search(searchText)
    }

    override fun onSearchSubmitted(searchText: String) {
      if (searchText.isNotBlank()) search(searchText)
    }
  }

  init {
    whenStarted { if (results.isNotEmpty()) map.show(MapScene.Places(results)) }
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
        map.show(MapScene.Places(results))
      }.onFailure {
        results = emptyList()
        error = it.message ?: "Search didn’t work. Try again."
      }
      invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val b = SearchTemplate.Builder(callback).setHeaderAction(Action.BACK).setSearchHint(hint).setShowKeyboardByDefault(true)
    if (loading) return b.setLoading(true).build()
    val list = ItemList.Builder()
    error?.let { list.setNoItemsMessage(it) }
    results.forEach { p -> list.addItem(row(p.name, p.detail) { screenManager.push(RoutePreviewScreen.forPlace(carContext, api, map, p)) }) }
    return b.setItemList(list.build()).build()
  }
}
