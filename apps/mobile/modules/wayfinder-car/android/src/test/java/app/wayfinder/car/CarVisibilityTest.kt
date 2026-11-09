package app.wayfinder.car

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Test

class CarVisibilityTest {
  private class Owner : LifecycleOwner {
    val registry = LifecycleRegistry.createUnsafe(this)
    override val lifecycle: Lifecycle get() = registry
  }

  @Test fun logsEachTimeTheCarScreenShowsOrHidesWayfinder() {
    val lines = mutableListOf<String>()
    val owner = Owner()
    owner.registry.addObserver(CarVisibility { lines += it })
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.STARTED // another Android Auto app in front
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.DESTROYED
    assertEquals(listOf("car screen shown", "car screen hidden", "car screen shown", "car screen hidden"), lines)
  }
}
