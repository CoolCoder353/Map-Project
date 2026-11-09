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
 * brings it back after. Nothing is said while audio focus is refused (a phone call), each
 * direction is queued behind the one being said rather than cutting it off, and every direction
 * asked for before the engine was ready is said once it is.
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
  private val queued = ArrayList<String>()
  private var count = 0

  /** The utterance whose end brings the music back; a late callback from a flushed one is ignored. */
  internal var current: String? = null
    private set

  /** The voice in use: Australian English where the phone has it, else British, else the engine's own. */
  internal var locale: Locale? = null
    private set

  override fun onInit(status: Int) {
    if (status != TextToSpeech.SUCCESS) return
    synchronized(lock) {
      locale = VOICES.firstOrNull { usable(tts.setLanguage(it)) }
      tts.setAudioAttributes(ATTRIBUTES)
      tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) { finished(utteranceId) }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) { finished(utteranceId) }
      })
      ready = true
      queued.forEach { speakNow(it) }
      queued.clear()
    }
  }

  private fun usable(result: Int) = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED

  fun speak(text: String) {
    synchronized(lock) {
      if (!ready) {
        queued += text
        return
      }
      speakNow(text)
    }
  }

  fun stop() {
    synchronized(lock) {
      queued.clear()
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
    // Refused (a phone call, or another app holding the audio): talking over it is worse than silence.
    if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return
    val id = "wayfinder-directions-${++count}"
    current = id
    if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) {
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
    internal val VOICES = listOf(Locale("en", "AU"), Locale.UK, Locale.ENGLISH)

    val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }
}
