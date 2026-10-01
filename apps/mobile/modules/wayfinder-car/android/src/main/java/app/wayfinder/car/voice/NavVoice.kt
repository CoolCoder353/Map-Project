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
class NavVoice(
  context: Context,
  createTts: (Context, TextToSpeech.OnInitListener) -> TextToSpeech = { c, listener -> TextToSpeech(c, listener) },
) : TextToSpeech.OnInitListener {
  private val audio = context.getSystemService(AudioManager::class.java)
  private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(ATTRIBUTES).build()
  internal val tts = createTts(context.applicationContext, this)

  // The engine reports ready on the main thread while JavaScript speaks from its own, so these are
  // only touched with `lock` held.
  private val lock = Any()
  private var ready = false
  private var queued: String? = null
  private var count = 0

  /** The utterance whose end brings the music back; a late callback from a flushed one is ignored. */
  internal var current: String? = null
    private set

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) return
    synchronized(lock) {
      tts.language = Locale("en", "AU")
      tts.setAudioAttributes(ATTRIBUTES)
      tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) { finished(utteranceId) }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) { finished(utteranceId) }
      })
      ready = true
      queued?.let { speakNow(it) }
      queued = null
    }
  }

  fun speak(text: String) {
    synchronized(lock) {
      if (!ready) {
        queued = text
        return
      }
      speakNow(text)
    }
  }

  fun stop() {
    synchronized(lock) {
      queued = null
      current = null
      if (ready) tts.stop()
      audio.abandonAudioFocusRequest(focus)
    }
  }

  /** Stop, and let the speech engine go. */
  fun shutdown() {
    synchronized(lock) {
      stop()
      tts.shutdown()
    }
  }

  private fun speakNow(text: String) {
    val id = "wayfinder-directions-${++count}"
    current = id
    audio.requestAudioFocus(focus)
    if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
      current = null
      audio.abandonAudioFocusRequest(focus)
    }
  }

  private fun finished(utteranceId: String?) {
    synchronized(lock) {
      if (utteranceId != current) return
      current = null
      audio.abandonAudioFocusRequest(focus)
    }
  }

  companion object {
    val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }
}
