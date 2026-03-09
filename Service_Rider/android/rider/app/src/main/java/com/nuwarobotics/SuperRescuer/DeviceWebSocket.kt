package com.nuwarobotics.SuperRescuer

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

class DeviceWebSocket(
    private val context: Context,
    private val onConnected: () -> Unit,
    private val onDisconnected: () -> Unit = {},
    private val onControlMessage: (JSONObject) -> Unit,
    private val onServiceMessage: (JSONObject) -> Unit = {},
    private val onMissionMessage: (JSONObject) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val logTag = "DeviceWebSocket"
    private var reconnectAttempt = 0
    private val baseReconnectDelayMs = 5_000L
    private val maxReconnectDelayMs = 60_000L
    private val heartbeatIntervalMs = 10_000L

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(10, TimeUnit.SECONDS)
        .eventListenerFactory { SocketEventListener() }
        .build()

    private var webSocket: WebSocket? = null
    private var isClosing = false
    private var connected = false
    private var loggedFirstTextMessage = false
    private var loggedFirstBinaryMessage = false
    private val heartbeatRunnable = Runnable {
        if (connected) {
            sendText(JSONObject().put("type", "heartbeat").toString())
            scheduleHeartbeat()
        }
    }

    fun connect() {
        isClosing = false
        loggedFirstTextMessage = false
        loggedFirstBinaryMessage = false
        val baseUrl = DeviceConfig.getServerUrl(context)
        val wsUrl = buildWsUrl(baseUrl)
        Log.d(logTag, "Base URL: $baseUrl")
        Log.d(logTag, "Connecting to $wsUrl")
        Log.d(logTag, "Shared key length: ${DeviceConfig.getSharedKey(context).length}")
        val request = Request.Builder()
            .url(wsUrl)
            .build()
        Log.d(logTag, "Request headers: ${request.headers}")
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(logTag, "Connected (${response.code} ${response.message}) proto=${response.protocol}")
                Log.d(logTag, "Handshake headers: ${response.headers}")
                connected = true
                reconnectAttempt = 0
                val payload = buildHelloPayload()
                logHelloPayload(payload)
                val hello = payload.toString()
                Log.d(logTag, "Hello length: ${hello.length}")
                if (!webSocket.send(hello)) {
                    Log.w(logTag, "Hello not sent (socket may be closing)")
                }
                onConnected()
                scheduleHeartbeat()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!loggedFirstTextMessage) {
                    Log.d(logTag, "First text message: ${text.take(200)}")
                    loggedFirstTextMessage = true
                }
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "control" -> {
                            Log.d(logTag, "Control message: ${json.optString("action")}")
                            onControlMessage(json)
                        }
                        "service" -> {
                            Log.d(logTag, "Service message: ${json.optString("action")}")
                            onServiceMessage(json)
                        }
                        "mission" -> onMissionMessage(json)
                    }
                } catch (e: Exception) {
                    Log.e("DeviceWebSocket", "Invalid message: ${e.message}")
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (!loggedFirstBinaryMessage) {
                    val preview = bytes.substring(0, minOf(16, bytes.size)).hex()
                    Log.d(logTag, "First binary message: size=${bytes.size} head=$preview")
                    loggedFirstBinaryMessage = true
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
                onDisconnected()
                handler.removeCallbacks(heartbeatRunnable)
                webSocket.close(1000, null)
                Log.d(logTag, "Closing: $code / $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(logTag, "Closed: $code / $reason")
                connected = false
                onDisconnected()
                handler.removeCallbacks(heartbeatRunnable)
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val responseInfo = if (response != null) {
                    " code=${response.code} message=${response.message} headers=${response.headers}"
                } else {
                    " no response"
                }
                Log.e(logTag, "Error: ${t.javaClass.simpleName}: ${t.message}.$responseInfo", t)
                connected = false
                onDisconnected()
                handler.removeCallbacks(heartbeatRunnable)
                scheduleReconnect()
            }
        })
    }

    fun sendBinary(data: ByteArray) {
        val ok = webSocket?.send(ByteString.of(*data)) ?: false
        if (!ok) {
            Log.w(logTag, "Binary send failed (socket not open)")
        }
    }

    fun sendText(text: String) {
        val ok = webSocket?.send(text) ?: false
        if (!ok) {
            Log.w(logTag, "Text send failed (socket not open)")
        }
    }

    fun close() {
        isClosing = true
        connected = false
        onDisconnected()
        handler.removeCallbacks(heartbeatRunnable)
        webSocket?.close(1000, "closed")
        client.dispatcher.executorService.shutdown()
    }

    private fun buildWsUrl(baseUrl: String): String {
        val uri = android.net.Uri.parse(baseUrl)
        val scheme = if (uri.scheme == "https") "wss" else "ws"
        return uri.buildUpon()
            .scheme(scheme)
            .path("/ws/device")
            .clearQuery()
            .build()
            .toString()
    }

    private fun buildHelloPayload(): JSONObject {
        val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val serial = resolveRobotSerial(deviceId)
        val productName = resolveProductName()
        val info = JSONObject()
            .put("name", serial)
            .put("model", productName)
            .put("manufacturer", Build.MANUFACTURER)
            .put("osVersion", Build.VERSION.RELEASE)
            .put("appVersion", BuildConfig.VERSION_NAME)
        val payload = JSONObject()
            .put("type", "hello")
            .put("token", DeviceConfig.getSharedKey(context))
            .put("deviceId", deviceId)
            .put("info", info)
        return payload
    }

    private fun resolveRobotSerial(fallback: String): String {
        val serial = getRobotSerial()
        if (serial.isNotBlank() && !serial.equals("UNKNOWN", true)) {
            return serial
        }
        return fallback
    }

    private fun resolveProductName(): String {
        val name = getSystemProperty("ro.nuwa.product.name")
        if (name.isNotBlank()) {
            return name
        }
        return "UNKNOWN"
    }

    private fun getRobotSerial(): String {
        val serial = getSystemProperty("ro.serialno")
        if (serial.isNotBlank()) {
            return serial
        }
        return "UNKNOWN"
    }

    private fun getSystemProperty(key: String): String {
        return try {
            val clazz = Class.forName("android.os.SystemProperties")
            val method = clazz.getMethod("get", String::class.java)
            method.invoke(null, key) as String
        } catch (e: Exception) {
            "UNKNOWN"
        }
    }

    private fun logHelloPayload(payload: JSONObject) {
        val safe = JSONObject(payload.toString())
        val token = safe.optString("token")
        if (token.isNotEmpty()) {
            safe.put("token", maskToken(token))
        }
        Log.d(logTag, "Hello payload: $safe")
    }

    private fun maskToken(token: String): String {
        if (token.length <= 4) {
            return "***"
        }
        return token.take(2) + "***" + token.takeLast(2)
    }

    private fun scheduleReconnect() {
        if (isClosing) {
            return
        }
        handler.removeCallbacksAndMessages(null)
        
        // Calculate delay with exponential backoff: base * 2^attempt
        val expDelay = baseReconnectDelayMs * (1L shl minOf(reconnectAttempt, 6))
        
        // Add jitter (0% to 50% of the delay) to prevent thundering herd
        val jitter = (Math.random() * expDelay * 0.5).toLong()
        val delayMs = minOf(expDelay + jitter, maxReconnectDelayMs)
        
        Log.d(logTag, "Scheduling reconnect attempt ${reconnectAttempt + 1} in ${delayMs}ms")
        reconnectAttempt++
        
        handler.postDelayed({ connect() }, delayMs)
    }

    private fun scheduleHeartbeat() {
        handler.postDelayed(heartbeatRunnable, heartbeatIntervalMs)
    }

    private class SocketEventListener : EventListener() {
        override fun callStart(call: Call) {
            Log.d("DeviceWebSocket", "OkHttp callStart: ${call.request().url}")
        }

        override fun dnsStart(call: Call, domainName: String) {
            Log.d("DeviceWebSocket", "OkHttp dnsStart: $domainName")
        }

        override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
            Log.d("DeviceWebSocket", "OkHttp dnsEnd: $domainName -> ${inetAddressList.joinToString()}")
        }

        override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
            Log.d("DeviceWebSocket", "OkHttp connectStart: $inetSocketAddress via $proxy")
        }

        override fun secureConnectStart(call: Call) {
            Log.d("DeviceWebSocket", "OkHttp secureConnectStart")
        }

        override fun secureConnectEnd(call: Call, handshake: Handshake?) {
            Log.d("DeviceWebSocket", "OkHttp secureConnectEnd: $handshake")
        }

        override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) {
            Log.d("DeviceWebSocket", "OkHttp connectEnd: $inetSocketAddress proto=$protocol")
        }

        override fun connectFailed(
            call: Call,
            inetSocketAddress: InetSocketAddress,
            proxy: Proxy,
            protocol: Protocol?,
            ioe: IOException
        ) {
            Log.e("DeviceWebSocket", "OkHttp connectFailed: $inetSocketAddress proto=$protocol error=${ioe.message}", ioe)
        }

        override fun requestHeadersStart(call: Call) {
            Log.d("DeviceWebSocket", "OkHttp requestHeadersStart")
        }

        override fun requestHeadersEnd(call: Call, request: Request) {
            Log.d("DeviceWebSocket", "OkHttp requestHeadersEnd: ${request.headers}")
        }

        override fun responseHeadersStart(call: Call) {
            Log.d("DeviceWebSocket", "OkHttp responseHeadersStart")
        }

        override fun responseHeadersEnd(call: Call, response: Response) {
            Log.d("DeviceWebSocket", "OkHttp responseHeadersEnd: code=${response.code} headers=${response.headers}")
        }

        override fun callEnd(call: Call) {
            Log.d("DeviceWebSocket", "OkHttp callEnd")
        }

        override fun callFailed(call: Call, ioe: IOException) {
            Log.e("DeviceWebSocket", "OkHttp callFailed: ${ioe.message}", ioe)
        }

        override fun canceled(call: Call) {
            Log.w("DeviceWebSocket", "OkHttp canceled")
        }
    }
}

