package app.wayfinder.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/**
 * A sentence for the driver, with "Try again" when there is something to retry. It is always pushed
 * over another screen, so its header is Back: with the app icon there, a car with only a touch
 * screen had no way off it ("couldn't read that destination", "Nothing found").
 */
class MessageScreen(
  carContext: CarContext,
  private val message: String,
  private val retry: (() -> Unit)? = null,
) : Screen(carContext) {
  override fun onGetTemplate(): Template =
    MessageTemplate.Builder(message)
      .setTitle(appName(carContext))
      .setHeaderAction(Action.BACK)
      .apply { retry?.let { r -> addAction(Action.Builder().setTitle("Try again").setOnClickListener { r() }.build()) } }
      .build()
}
