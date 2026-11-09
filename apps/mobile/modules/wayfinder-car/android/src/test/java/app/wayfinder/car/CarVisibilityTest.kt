package app.wayfinder.car

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CarVisibilityTest {
  private class Owner : LifecycleOwner {
    val registry = LifecycleRegistry.createUnsafe(this)
    override val lifecycle: Lifecycle get() = registry
  }

  /** Scheduled blocks, run by hand; cancelled ones are dropped. */
  private val pending = mutableListOf<() -> Unit>()
  private val later: (Long, () -> Unit) -> () -> Unit = { ms, block ->
    assertEquals(CarVisibility.REPEAT_MS, ms)
    pending += block
    ({ pending.remove(block) })
  }

  @Test fun logsEachTimeTheCarScreenShowsOrHidesWayfinder() {
    val lines = mutableListOf<String>()
    val owner = Owner()
    owner.registry.addObserver(CarVisibility({ lines += it }, later))
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.STARTED // another Android Auto app in front
    owner.registry.currentState = Lifecycle.State.RESUMED
    owner.registry.currentState = Lifecycle.State.DESTROYED
    assertEquals(listOf("car screen shown", "car screen hidden", "car screen shown", "car screen hidden"), lines)
  }

  /** The phone's log is small and busy: while shown, the line is logged again so the harness still finds it (H15). */
  @Test fun saysItAgainWhileShownAndStopsOnceHidden() {
    val lines = mutableListOf<String>()
    val owner = Owner()
    owner.registry.addObserver(CarVisibility({ lines += it }, later))
    owner.registry.currentState = Lifecycle.State.RESUMED
    pending.removeAt(0)()
    pending.removeAt(0)()
    assertEquals(listOf("car screen shown", "car screen shown", "car screen shown"), lines)
    owner.registry.currentState = Lifecycle.State.STARTED
    assertTrue("no repeats once hidden", pending.isEmpty())
    assertEquals("car screen hidden", lines.last())
  }
}
