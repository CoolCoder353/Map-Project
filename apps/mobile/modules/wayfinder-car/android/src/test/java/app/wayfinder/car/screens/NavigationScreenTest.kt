package app.wayfinder.car.screens

import android.os.Looper
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.testing.ScreenController
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.NavStatus
import app.wayfinder.car.nav.ManeuverIcons
import app.wayfinder.car.nav.NavTemplates
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigationScreenTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi().also { it.navigation = Samples.nav() }
  private val screen = NavigationScreen(carContext, api, RecordingScenes(), ManeuverIcons(carContext)).also { ScreenController(it).moveToState(Lifecycle.State.STARTED) }
  private fun endTitle() = (screen.onGetTemplate() as NavigationTemplate).actionStrip!!.actions.last().title!!.toCharSequence().toString()

  /** One tap at speed mustn't end the trip (C23): the phone asks first, the car takes a second tap. */
  @Test fun endingTakesASecondTap() {
    screen.end()
    assertFalse(api.calls.contains("stop"))
    assertEquals(NavTemplates.END_CONFIRM, endTitle())
    screen.end()
    assertEquals("stop", api.calls.last())
  }

  @Test fun theSecondTapIsOnlyWaitedForAWhile() {
    screen.end()
    shadowOf(Looper.getMainLooper()).idleFor(NavigationScreen.END_CONFIRM_MS, TimeUnit.MILLISECONDS)
    assertEquals("End", endTitle())
    screen.end()
    assertFalse(api.calls.contains("stop"))
  }

  @Test fun arrivedEndsAtOnce() {
    api.pushNav(Samples.nav(status = NavStatus.ARRIVED))
    screen.end()
    assertEquals("stop", api.calls.last())
  }

  /** The speaker answers the tap at once rather than waiting on the phone (C64). */
  @Test fun muteShowsStraightAway() {
    val before = (screen.onGetTemplate() as NavigationTemplate).actionStrip!!.actions[1].icon!!.icon!!.resId
    screen.toggleMute()
    assertEquals("mute true", api.calls.last())
    val after = (screen.onGetTemplate() as NavigationTemplate).actionStrip!!.actions[1].icon!!.icon!!.resId
    assertNotEquals(before, after)
  }
}
