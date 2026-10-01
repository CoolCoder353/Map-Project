package app.wayfinder.car

import android.os.Looper
import androidx.car.app.OnDoneCallback
import androidx.car.app.model.CarText
import androidx.car.app.model.Row
import androidx.car.app.testing.TestCarContext
import androidx.test.core.app.ApplicationProvider
import org.robolectric.Shadows.shadowOf

fun newCarContext(): TestCarContext = TestCarContext.createCarContext(ApplicationProvider.getApplicationContext())

fun CarText?.text(): String? = this?.toCharSequence()?.toString()

/** Taps a row the way the car does, then lets the main thread run what it posted. */
fun Row.click() {
  onClickDelegate!!.sendClick(object : OnDoneCallback {})
  shadowOf(Looper.getMainLooper()).idle()
}
