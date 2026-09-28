package app.wayfinder.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import app.wayfinder.car.screens.MessageScreen

class WayfinderSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = MessageScreen(carContext, "Getting ready…")
}
