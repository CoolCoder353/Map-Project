package app.wayfinder.car.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Spoken directions as navigation audio: the car (or phone) dips music while they play and
 * brings it back after.
 */
class NavVoice(context: Context) : TextToSpeech.OnInitListener {
  private val audio = context.getSystemService(AudioManager::class.java)
  private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(ATTRIBUTES).build()
  internal val tts = TextToSpeech(context.applicationContext, this)
  private var ready = false
  private var queued: String? = null

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) return
    tts.language = Locale("en", "AU")
    tts.setAudioAttributes(ATTRIBUTES)
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {}
      override fun onDone(utteranceId: String?) { audio.abandonAudioFocusRequest(focus) }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) { audio.abandonAudioFocusRequest(focus) }
    })
    ready = true
    queued?.let { speak(it) }
    queued = null
  }

  fun speak(text: String) {
    if (!ready) {
      queued = text
      return
    }
    audio.requestAudioFocus(focus)
    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "wayfinder-directions")
  }

  fun stop() {
    queued = null
    if (ready) tts.stop()
    audio.abandonAudioFocusRequest(focus)
  }

  companion object {
    val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }
}
