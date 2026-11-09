package app.wayfinder.car.voice

import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

  private fun ready(voice: NavVoice) = shadowOf(voice.tts).onInitListener.onInit(TextToSpeech.SUCCESS)

  @Test fun givesTheMusicBackOnStop() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("Turn left")
    assertNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    voice.stop()
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    assertTrue(shadowOf(voice.tts).isStopped)
  }

  @Test fun givesTheMusicBackWhenTheDirectionIsFinished() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("Turn left")
    assertNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    shadowOf(voice.tts).utteranceProgressListener.onDone(voice.current)
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
  }

  @Test fun givesTheMusicBackWhenSpeakingFails() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("Turn left")
    @Suppress("DEPRECATION")
    shadowOf(voice.tts).utteranceProgressListener.onError(voice.current)
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
  }

  @Test fun givesTheMusicBackAtOnceIfTheEngineRefusesTheText() {
    val voice = NavVoice(context, createTts = { c, l -> RefusingTts(c, l) })
    ready(voice)
    voice.speak("Turn left")
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    assertNull(voice.current)
  }

  @Test fun aLateEndOfAnEarlierDirectionDoesNotEndTheNextOne() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("In 200 metres, turn left")
    val first = voice.current
    voice.speak("Turn left")
    val second = voice.current
    assertNotNull(first)
    assertTrue(first != second)
    shadowOf(voice.tts).utteranceProgressListener.onDone(first)
    assertNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    shadowOf(voice.tts).utteranceProgressListener.onDone(second)
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
  }

  @Test fun stoppingBeforeTheVoiceIsReadyDropsWhatWasQueued() {
    val voice = NavVoice(context)
    voice.speak("In 200 metres, turn left")
    voice.stop()
    ready(voice)
    assertNull(shadowOf(voice.tts).lastSpokenText)
  }

  @Test fun shutdownStopsAndReleasesTheEngine() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("Turn left")
    voice.shutdown()
    assertNotNull(shadowOf(audio).lastAbandonedAudioFocusRequest)
    assertTrue(shadowOf(voice.tts).isShutdown)
  }

  /** A phone call holds the audio: talking over it is worse than silence. */
  @Test fun saysNothingWhileAudioFocusIsRefused() {
    val voice = NavVoice(context)
    ready(voice)
    shadowOf(audio).setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
    voice.speak("Turn left")
    assertNull(shadowOf(voice.tts).lastSpokenText)
    assertNull(voice.current)
  }

  @Test fun saysEveryDirectionAskedForBeforeTheVoiceWasReady() {
    val voice = NavVoice(context)
    voice.speak("Head north on Queen Street")
    voice.speak("In 200 metres, turn left")
    ready(voice)
    assertEquals(listOf("Head north on Queen Street", "In 200 metres, turn left"), shadowOf(voice.tts).spokenTextList)
  }

  @Test fun queuesANewDirectionBehindTheOneBeingSaidRatherThanCuttingItOff() {
    val voice = NavVoice(context)
    ready(voice)
    voice.speak("In 200 metres, turn left")
    voice.speak("Route updated. Turn right onto Main Street")
    assertEquals(TextToSpeech.QUEUE_ADD, shadowOf(voice.tts).queueMode)
    assertTrue(!shadowOf(voice.tts).isStopped)
  }

  @Test fun fallsBackToAnotherEnglishVoiceWhenTheAustralianOneIsMissing() {
    val voice = NavVoice(context, createTts = { c, l -> NoAustralianTts(c, l) })
    ready(voice)
    assertEquals(java.util.Locale.UK, voice.locale)
  }

  private class NoAustralianTts(context: android.content.Context, listener: OnInitListener) : TextToSpeech(context, listener) {
    override fun setLanguage(loc: java.util.Locale?) = if (loc?.country == "AU") LANG_MISSING_DATA else LANG_AVAILABLE
  }

  private class RefusingTts(context: android.content.Context, listener: OnInitListener) : TextToSpeech(context, listener) {
    override fun speak(text: CharSequence?, queueMode: Int, params: Bundle?, utteranceId: String?) = ERROR
  }
}
