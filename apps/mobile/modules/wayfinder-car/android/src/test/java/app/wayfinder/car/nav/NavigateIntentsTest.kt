package app.wayfinder.car.nav

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import app.wayfinder.car.bridge.LngLat
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavigateIntentsTest {
  private fun parse(uri: String, action: String = CarContext.ACTION_NAVIGATE) = NavigateIntents.parse(Intent(action, Uri.parse(uri)))

  @Test fun aPointIsLatThenLonInTheUriAndLonThenLatHere() {
    // Brisbane: about -27.47 south, 153.03 east. Swapping them would put it in the Arctic.
    assertEquals(NavigateRequest.At(LngLat(lon = 153.03, lat = -27.47), null), parse("geo:-27.47,153.03"))
  }

  @Test fun aPointKeepsTheNameItWasSentWith() {
    assertEquals(NavigateRequest.At(LngLat(153.03, -27.47), "Story Bridge"), parse("geo:-27.47,153.03?q=Story+Bridge"))
  }

  @Test fun aNameAtZeroZeroNeedsASearch() {
    assertEquals(NavigateRequest.Named("Mt Coot-tha Lookout"), parse("geo:0,0?q=Mt%20Coot-tha%20Lookout"))
    assertEquals(NavigateRequest.Named("coffee shop"), parse("geo:0,0?q=coffee+shop&mode=w&intent=navigation"))
  }

  @Test fun coordinatesInsideTheQueryAreAPoint() {
    assertEquals(NavigateRequest.At(LngLat(153.03, -27.47), "Brisbane"), parse("geo:0,0?q=-27.47,153.03(Brisbane)"))
    assertEquals(NavigateRequest.At(LngLat(153.03, -27.47), null), parse("geo:0,0?q=-27.47,153.03"))
  }

  @Test fun anEncodedQuestionMarkOrAmpersandStaysInTheName() {
    assertEquals(NavigateRequest.Named("Fish & Chips?"), parse("geo:0,0?q=Fish%20%26%20Chips%3F"))
  }

  @Test fun anUncertaintySuffixIsIgnored() {
    assertEquals(NavigateRequest.At(LngLat(153.03, -27.47), null), parse("geo:-27.47,153.03;u=35"))
  }

  @Test fun unreadableDestinationsAreMalformedNotCrashes() {
    listOf(
      "geo:", "geo:abc,def", "geo:1", "geo:1,2,3", "geo:0,0", "geo:0,0?q=", "geo:91,0", "geo:0,181", "geo:NaN,1", "geo:0,0?q=999,999(x)",
    ).forEach { assertEquals(it, NavigateRequest.Malformed, parse(it)) }
  }

  @Test fun otherSchemesAndMissingDataAreMalformed() {
    assertEquals(NavigateRequest.Malformed, parse("https://example.com/-27.47,153.03"))
    assertEquals(NavigateRequest.Malformed, NavigateIntents.parse(Intent(CarContext.ACTION_NAVIGATE)))
  }

  @Test fun otherIntentsAreNotNavigateRequests() {
    assertNull(parse("geo:-27.47,153.03", action = Intent.ACTION_VIEW))
    assertNull(NavigateIntents.parse(Intent()))
  }
}
