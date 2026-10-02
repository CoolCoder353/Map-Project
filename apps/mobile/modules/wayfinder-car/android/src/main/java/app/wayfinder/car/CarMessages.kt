package app.wayfinder.car

/**
 * What the car screen says when the fix is on the phone. Google's car app quality rule VI-1: a
 * message that sends the driver to the phone must tell them to look at it only when it's safe.
 * CarMessagesTest checks every one does.
 */
object CarMessages {
  const val SIGN_IN = "When it’s safe, open Wayfinder on your phone and sign in."
  const val OFFLINE = "Can’t reach your server. Try again when your phone has signal."
  const val PHONE_NOT_ANSWERING = "Wayfinder on your phone isn’t answering. When it’s safe, open it on your phone, then try again."
  const val UPDATE_PHONE_APP = "When it’s safe, update Wayfinder on your phone, then try again."

  val all = listOf(SIGN_IN, OFFLINE, PHONE_NOT_ANSWERING, UPDATE_PHONE_APP)
}
