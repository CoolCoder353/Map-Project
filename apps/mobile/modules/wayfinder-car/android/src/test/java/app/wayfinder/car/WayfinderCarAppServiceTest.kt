package app.wayfinder.car

import android.content.pm.ApplicationInfo
import androidx.car.app.validation.HostValidator
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WayfinderCarAppServiceTest {
  private val service = Robolectric.setupService(WayfinderCarAppService::class.java)
  private val stranger = androidx.car.app.HostInfo("com.example.not.android.auto", 1234)

  @Test fun aDebugBuildAnswersAnyHost() {
    service.applicationInfo.flags = service.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
    assertTrue(service.createHostValidator().isValidHost(stranger))
  }

  @Test fun aReleaseBuildOnlyAnswersGoogleAppsNotAStranger() {
    service.applicationInfo.flags = service.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE.inv()
    val validator: HostValidator = service.createHostValidator()
    assertFalse(validator.isValidHost(stranger))
  }

  @Test fun opensAWayfinderSession() = assertTrue(service.onCreateSession() is WayfinderSession)
}
