package app.wayfinder.car

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JavaScript side's handle on the car app. */
class WayfinderCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WayfinderCar")
  }
}
