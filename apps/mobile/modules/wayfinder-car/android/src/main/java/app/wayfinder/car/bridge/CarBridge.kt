package app.wayfinder.car.bridge

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

class CarBridgeError(message: String) : Exception(message)
class CarBridgeTimeout : Exception("Wayfinder on your phone isn’t answering. Open it on your phone, then try again.")

/**
 * The car screens' line to the JavaScript side, which has the account, the server and navigation.
 * Requests made before JavaScript is listening wait for it; each gives up after [timeoutMs].
 * Answers and navigation updates are delivered through [post] (the main thread).
 */
class CarBridge(
  private val post: (Runnable) -> Unit,
  private val postDelayed: (Runnable, Long) -> Unit,
  private val timeoutMs: Long = 30_000,
) {
  private var emit: ((String, String, String) -> Unit)? = null
  private val waiting = ArrayDeque<Triple<String, String, String>>()
  private val pending = HashMap<String, (Result<JSONObject>) -> Unit>()
  private val navListeners = LinkedHashSet<(JSONObject?) -> Unit>()
  private var next = 0

  var navigation: JSONObject? = null
    private set

  @Synchronized
  fun connect(emit: (id: String, method: String, params: String) -> Unit) {
    this.emit = emit
    while (waiting.isNotEmpty()) waiting.removeFirst().let { (id, method, params) -> emit(id, method, params) }
  }

  @Synchronized
  fun disconnect() {
    emit = null
  }

  fun call(method: String, params: JSONObject, done: (Result<JSONObject>) -> Unit) {
    val id: String
    synchronized(this) {
      id = "c${next++}"
      pending[id] = done
      val e = emit
      if (e != null) e(id, method, params.toString()) else waiting.addLast(Triple(id, method, params.toString()))
    }
    postDelayed({ finish(id, Result.failure(CarBridgeTimeout())) }, timeoutMs)
  }

  fun resolve(id: String, json: String) = finish(id, runCatching { JSONObject(json) })

  fun reject(id: String, message: String) = finish(id, Result.failure(CarBridgeError(message)))

  private fun finish(id: String, result: Result<JSONObject>) {
    val done = synchronized(this) {
      waiting.removeAll { it.first == id }
      pending.remove(id)
    } ?: return
    post { done(result) }
  }

  fun setNavigation(json: String?) {
    val parsed = json?.let { runCatching { JSONObject(it) }.getOrNull() }
    post {
      navigation = parsed
      navListeners.toList().forEach { it(parsed) }
    }
  }

  fun onNavigation(listener: (JSONObject?) -> Unit): () -> Unit {
    navListeners += listener
    return { navListeners -= listener }
  }

  companion object {
    /** The one bridge the Expo module and every car session share. */
    val shared: CarBridge by lazy {
      val main = Handler(Looper.getMainLooper())
      CarBridge({ main.post(it) }, { r, ms -> main.postDelayed(r, ms) })
    }
  }
}
