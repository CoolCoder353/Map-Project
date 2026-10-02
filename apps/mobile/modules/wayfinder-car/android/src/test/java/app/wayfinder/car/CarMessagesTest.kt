package app.wayfinder.car

import app.wayfinder.car.bridge.CarBridgeTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Car app quality VI-1: sending the driver to the phone always says to wait until it's safe. */
class CarMessagesTest {
  @Test fun everyMessageThatSendsTheDriverToThePhoneSaysWhenItsSafe() {
    CarMessages.all.filter { Regex("(open|update|sign in|check).*phone", RegexOption.IGNORE_CASE).containsMatchIn(it) }
      .also { assertEquals(3, it.size) }
      .forEach { assertTrue(it, it.contains("When it’s safe")) }
  }

  @Test fun noMessageAsksTheDriverToCheckThePhone() {
    // "Check your phone has signal" sends the driver to the phone screen; say what to do instead.
    CarMessages.all.forEach { assertFalse(it, it.contains("Check your phone", ignoreCase = true)) }
  }

  @Test fun theBridgeUsesThem() {
    // BridgeCarApiTest checks the update message the bridge gives.
    assertEquals(CarMessages.PHONE_NOT_ANSWERING, CarBridgeTimeout().message)
  }
}
