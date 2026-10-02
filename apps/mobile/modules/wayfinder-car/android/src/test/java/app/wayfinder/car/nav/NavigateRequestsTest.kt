package app.wayfinder.car.nav

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import android.os.Looper
import androidx.car.app.model.MessageTemplate
import androidx.car.app.navigation.model.RoutePreviewNavigationTemplate
import org.robolectric.Shadows.shadowOf
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestScreenManager
import androidx.lifecycle.Lifecycle
import app.wayfinder.car.*
import app.wayfinder.car.bridge.Account
import app.wayfinder.car.map.MapScene
import app.wayfinder.car.screens.MessageScreen
import app.wayfinder.car.screens.RoutePreviewScreen
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigateRequestsTest {
  private val carContext = newCarContext()
  private val api = FakeCarApi()
  private val scenes = RecordingScenes()
  private var alive = true
  private val requests = NavigateRequests(carContext, api, scenes) { alive }
  private val screens get() = carContext.getCarService(TestScreenManager::class.java)

  private fun navigate(uri: String) = Intent(CarContext.ACTION_NAVIGATE, Uri.parse(uri))
  private fun pushed() = screens.screensPushed
  private fun message(): String? = (pushed().last() as? MessageScreen)?.let { (it.onGetTemplate() as MessageTemplate).message.text() }

  private fun previewTitle() = ((pushed().last() as RoutePreviewScreen).onGetTemplate() as RoutePreviewNavigationTemplate).title.text()

  @Test fun aPointOpensTheRoutePreviewForIt() {
    requests.handle(navigate("geo:-27.47,153.03?q=Story+Bridge"))
    api.answer("status", Samples.status())
    assertTrue(pushed().last() is RoutePreviewScreen)
    assertEquals("Story Bridge", previewTitle())
  }

  @Test fun aNameIsSearchedThenTheFirstPlaceIsPreviewed() {
    requests.handle(navigate("geo:0,0?q=Mt+Coot-tha"))
    api.answer("status", Samples.status())
    assertEquals("search Mt Coot-tha", api.calls.last())
    api.answer("search", listOf(Samples.place("p1", "Mt Coot-tha Lookout"), Samples.place("p2", "Other")))
    assertTrue(pushed().last() is RoutePreviewScreen)
    assertEquals("Mt Coot-tha Lookout", previewTitle())
  }

  @Test fun saysSoWhenNothingMatchesTheName() {
    requests.handle(navigate("geo:0,0?q=Nowhere"))
    api.answer("status", Samples.status())
    api.answer("search", emptyList<Any>())
    assertEquals("Nothing found for “Nowhere”.", message())
  }

  @Test fun saysWhySearchFailedAndOffersToTryAgain() {
    requests.handle(navigate("geo:0,0?q=Nowhere"))
    api.answer("status", Samples.status())
    api.fail("search", "Can’t reach your server.")
    assertEquals("Can’t reach your server.", message())
    val retry = (pushed().last().onGetTemplate() as MessageTemplate).actions.single()
    assertEquals("Try again", retry.title.text())
  }

  @Test fun signedOutAsksToSignInThenTryAgainContinues() {
    requests.handle(navigate("geo:-27.47,153.03"))
    api.answer("status", Samples.status(Account.SIGNED_OUT))
    assertEquals("Open Wayfinder on your phone and sign in.", message())
    (pushed().last().onGetTemplate() as MessageTemplate).actions.single().onClickDelegate!!.sendClick(object : androidx.car.app.OnDoneCallback {})
    shadowOf(Looper.getMainLooper()).idle()
    api.answer("status", Samples.status())
    assertTrue("continues to the place once signed in", pushed().last() is RoutePreviewScreen)
  }

  @Test fun offlineSaysSo() {
    requests.handle(navigate("geo:-27.47,153.03"))
    api.answer("status", Samples.status(Account.OFFLINE))
    assertEquals("Can’t reach your server. Check your phone has signal, then try again.", message())
  }

  @Test fun anAppThatIsntAnsweringIsTold() {
    requests.handle(navigate("geo:-27.47,153.03"))
    api.fail("status", "Wayfinder on your phone isn’t answering. Open it on your phone, then try again.")
    assertEquals("Wayfinder on your phone isn’t answering. Open it on your phone, then try again.", message())
  }

  @Test fun anUnreadableDestinationIsExplainedWithoutAskingThePhone() {
    requests.handle(navigate("geo:0,0"))
    assertEquals("Wayfinder couldn’t read that destination.", message())
    assertTrue(api.calls.isEmpty())
  }

  @Test fun ignoresIntentsThatAreNotNavigateRequests() {
    requests.handle(Intent(Intent.ACTION_MAIN))
    assertTrue(api.calls.isEmpty())
    assertTrue(pushed().isEmpty())
  }

  @Test fun aSecondRequestWhileOpenReplacesTheFirstPreview() {
    screens.push(MessageScreen(carContext, "Home stands in here"))
    requests.handle(navigate("geo:-27.47,153.03"))
    api.answer("status", Samples.status())
    // The host would have created the first preview by now; popping it needs that.
    ScreenController(pushed().last()).moveToState(Lifecycle.State.CREATED)
    requests.handle(navigate("geo:-27.50,153.00"))
    api.answer("status", Samples.status())
    assertEquals(2, pushed().count { it is RoutePreviewScreen })
    assertEquals("the start and only the newest preview", 2, screens.stackSize)
  }

  @Test fun anAnswerAfterTheSessionEndedDoesNothing() {
    requests.handle(navigate("geo:0,0?q=Late"))
    alive = false
    api.answer("status", Samples.status())
    assertTrue(pushed().isEmpty())
  }
}
