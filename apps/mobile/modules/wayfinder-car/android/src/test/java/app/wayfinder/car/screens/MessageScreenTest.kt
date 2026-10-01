package app.wayfinder.car.screens

import androidx.car.app.model.MessageTemplate
import app.wayfinder.car.newCarContext
import app.wayfinder.car.text
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MessageScreenTest {
  @Test fun showsTheMessage() {
    val t = MessageScreen(newCarContext(), "Open Wayfinder on your phone and sign in.").onGetTemplate() as MessageTemplate
    assertEquals("Open Wayfinder on your phone and sign in.", t.message.text())
    assertTrue(t.actions.isEmpty())
  }

  @Test fun offersTryAgainWhenThereIsSomethingToRetry() {
    var tried = 0
    val t = MessageScreen(newCarContext(), "Can’t reach your server.") { tried++ }.onGetTemplate() as MessageTemplate
    assertEquals("Try again", t.actions.single().title.text())
  }
}
