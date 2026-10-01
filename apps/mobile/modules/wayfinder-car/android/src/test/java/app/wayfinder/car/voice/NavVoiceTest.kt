package app.wayfinder.car.voice

import android.media.AudioAttributes
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NavVoiceTest {
  private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
  private val audio = context.getSystemService(AudioManager::class.java)

  @Test fun speaksAsNavigationSoMusicDips() {
    assertEquals(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE, NavVoice.ATTRIBUTES.usage)
    val voice = NavVoice(context)
    shadowOf(voice.tts).onInitListener.onInit(TextToSpeech.SUCCESS)
    voice.speak("Turn left")
    assertEquals("Turn left", shadowOf(voice.tts).lastSpokenText)
    assertEquals(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK, shadowOf(audio).lastAudioFocusRequest.audioFocusRequest.focusGain)
  }

  @Test fun saysWhatWasAskedBeforeTheVoiceWasReady() {
    val voice = NavVoice(context)
    voice.speak("In 200 metres, turn left")
    assertNull(shadowOf(voice.tts).lastSpokenText)
    shadowOf(voice.tts).onInitListener.onInit(TextToSpeech.SUCCESS)
    assertEquals("In 200 metres, turn left", shadowOf(voice.tts).lastSpokenText)
  }
}
