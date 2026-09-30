package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Row
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner

/** Android Auto shows at most about six rows while driving; lists never offer more. */
const val MAX_ROWS = 6

fun appName(carContext: CarContext): String =
  carContext.applicationInfo.loadLabel(carContext.packageManager).toString()

/**
 * A tappable row. Places lists (PlaceListNavigationTemplate) insist every row is either a place with a
 * distance or a browsable one that opens something else, so rows that open another screen pass
 * `browsable = true`.
 */
fun row(title: String, detail: String? = null, browsable: Boolean = false, onClick: () -> Unit): Row =
  Row.Builder().setTitle(title).apply {
    if (!detail.isNullOrEmpty()) addText(detail)
    if (browsable) setBrowsable(true)
  }.setOnClickListener(onClick).build()

fun Screen.whenCreated(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onCreate(owner: LifecycleOwner) = block()
  })

/** Runs each time the screen comes back to the top, e.g. after Back from the screen above. */
fun Screen.whenStarted(block: () -> Unit) =
  lifecycle.addObserver(object : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) = block()
  })
