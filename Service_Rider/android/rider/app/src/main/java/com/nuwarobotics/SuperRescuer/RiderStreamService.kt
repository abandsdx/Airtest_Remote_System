package com.nuwarobotics.SuperRescuer

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import com.nuwarobotics.service.IClientId
import com.nuwarobotics.service.agent.NuwaRobotAPI

class RiderStreamService : Service() {

    companion object {
        private const val ACTION_CONNECT = "com.nuwarobotics.SuperRescuer.action.CONNECT"
        private const val ACTION_START = "com.nuwarobotics.SuperRescuer.action.START"
        private const val ACTION_STOP = "com.nuwarobotics.SuperRescuer.action.STOP"
        private const val ACTION_START_CAMERA = "com.nuwarobotics.SuperRescuer.action.START_CAMERA"
        private const val ACTION_STOP_CAMERA = "com.nuwarobotics.SuperRescuer.action.STOP_CAMERA"
        private const val ACTION_START_MIC = "com.nuwarobotics.SuperRescuer.action.START_MIC"
        private const val ACTION_STOP_MIC = "com.nuwarobotics.SuperRescuer.action.STOP_MIC"
        private const val ACTION_CACHE_PROJECTION = "com.nuwarobotics.SuperRescuer.action.CACHE_PROJECTION"
        private const val EXTRA_RESULT_CODE = "extra_result_code"
        private const val EXTRA_RESULT_DATA = "extra_result_data"

        const val ACTION_STATUS = "com.nuwarobotics.SuperRescuer.action.STATUS"
        const val EXTRA_STREAMING = "extra_streaming"
        const val EXTRA_CONNECTED = "extra_connected"
        const val EXTRA_CAMERA = "extra_camera"
        const val EXTRA_MIC = "extra_mic"

        private const val NOTIFICATION_CHANNEL = "superrescuer_stream"
        private const val NOTIFICATION_ID = 1001
        private const val STORAGE_NOTIFICATION_CHANNEL = "superrescuer_storage"
        private const val STORAGE_NOTIFICATION_ID = 1002
        const val EXTRA_REQUEST_SAF = "extra_request_saf"

        private const val SCRCPY_H264_ID = 0x68323634
        private const val DEFAULT_BROWSE_PATH = "/"

        fun connect(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_CONNECT
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun cacheProjection(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_CACHE_PROJECTION
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        fun startCamera(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_START_CAMERA
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stopCamera(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_STOP_CAMERA
            }
            context.startService(intent)
        }

        fun startMic(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_START_MIC
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stopMic(context: Context) {
            val intent = Intent(context, RiderStreamService::class.java).apply {
                action = ACTION_STOP_MIC
            }
            context.startService(intent)
        }
    }

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var codec: MediaCodec? = null
    private var encoderThread: Thread? = null
    private var streaming = false
    private var connected = false
    private var configSent = false
    private var cameraStreaming = false
    private var micStreaming = false
    private var lastProjectionResultCode: Int? = null
    private var lastProjectionData: Intent? = null
    private var screenWidth = 0
    private var screenHeight = 0

    private var cameraDevice: CameraDevice? = null
    private var cameraSession: CameraCaptureSession? = null
    private var cameraCodec: MediaCodec? = null
    private var cameraEncoderThread: Thread? = null
    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var cameraConfigSent = false
    private var cameraWidth = 0
    private var cameraHeight = 0

    private val keyframeHandler = Handler(Looper.getMainLooper())
    private val keyframeIntervalMs = 5_000L
    private var keyframeScheduled = false

    private var audioRecord: AudioRecord? = null
    private var micThread: Thread? = null
    private var micConfigSent = false
    private var micSampleRate = 0
    private var micChannels = 0
    private var micBitsPerSample = 0

    private lateinit var deviceSocket: DeviceWebSocket
    private var robotAPI: NuwaRobotAPI? = null

    private val keyframeRunnable = object : Runnable {
        override fun run() {
            if (streaming) {
                requestKeyframe(codec, "screen")
            }
            if (cameraStreaming) {
                requestKeyframe(cameraCodec, "camera")
            }
            if (streaming || cameraStreaming) {
                keyframeHandler.postDelayed(this, keyframeIntervalMs)
            } else {
                keyframeScheduled = false
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d("RiderStream", "Service created")
        deviceSocket = DeviceWebSocket(
            context = this,
            onConnected = {
                connected = true
                resetConfigFlagsForReconnect()
                broadcastStatus()
                sendStatusToServer()
                resendActiveConfigs()
            },
            onDisconnected = {
                connected = false
                broadcastStatus()
            },
            onControlMessage = {
                ControlDispatcher.handleControl(it)
            },
            onServiceMessage = {
                handleServiceCommand(it)
            },
            onMissionMessage = {
                val missionId = it.optJSONObject("mission")?.optString("id") ?: return@DeviceWebSocket
                val status = org.json.JSONObject()
                    .put("type", "mission-status")
                    .put("missionId", missionId)
                    .put("status", "received")
                deviceSocket.sendText(status.toString())
            },
        )
        deviceSocket.connect()
        broadcastStatus()
        
        // Initialize Nuwa Robot API
        try {
            robotAPI = NuwaRobotAPI(this, IClientId(packageName))
            Log.d("RiderStream", "NuwaRobotAPI initialized")
        } catch (e: Exception) {
            Log.e("RiderStream", "Failed to initialize NuwaRobotAPI: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d("RiderStream", "onStartCommand action=${intent?.action}")
        when (intent?.action) {
            ACTION_CONNECT -> {
                startForegroundIfNeeded()
                deviceSocket.connect()
                broadcastStatus()
            }
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                Log.d("RiderStream", "MediaProjection resultCode=$resultCode hasData=${data != null}")
                if (resultCode == Activity.RESULT_OK && data != null) {
                    lastProjectionResultCode = resultCode
                    lastProjectionData = data
                    DeviceConfig.setProjectionGranted(this, true)
                    startForegroundIfNeeded()
                    startStreaming(resultCode, data)
                } else {
                    Log.w("RiderStream", "MediaProjection ignored: code=$resultCode hasData=${data != null}")
                }
            }
            ACTION_STOP -> stopSelf()
            ACTION_START_CAMERA -> {
                startForegroundIfNeeded()
                startCamera()
            }
            ACTION_STOP_CAMERA -> stopCamera()
            ACTION_START_MIC -> {
                startForegroundIfNeeded()
                startMic()
            }
            ACTION_STOP_MIC -> stopMic()
            ACTION_CACHE_PROJECTION -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }
                Log.d("RiderStream", "Cache projection resultCode=$resultCode hasData=${data != null}")
                if (resultCode == Activity.RESULT_OK && data != null) {
                    lastProjectionResultCode = resultCode
                    lastProjectionData = data
                    DeviceConfig.setProjectionGranted(this, true)
                    startForegroundIfNeeded()
                } else {
                    DeviceConfig.setProjectionGranted(this, false)
                    Log.w("RiderStream", "Cache projection ignored: code=$resultCode hasData=${data != null}")
                }
                broadcastStatus()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopStreaming()
        stopCamera()
        stopMic()
        robotAPI?.release()
        deviceSocket.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForegroundIfNeeded() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL,
                "SuperRescuer Streaming",
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
            .setContentTitle("SuperRescuer streaming")
            .setContentText("Streaming to control server")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startStreaming(resultCode: Int, data: Intent) {
        if (streaming) {
            Log.d("RiderStream", "startStreaming ignored (already streaming)")
            return
        }
        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = projectionManager.getMediaProjection(resultCode, data)
        if (projection == null) {
            Log.e("RiderStream", "MediaProjection permission denied")
            return
        }

        val metrics = DisplayMetrics()
        val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)

        val (width, height) = computeStreamSize(metrics.widthPixels, metrics.heightPixels)
        Log.d("RiderStream", "startStreaming size=${width}x${height}")
        screenWidth = width
        screenHeight = height
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 2_000_000)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)

        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = codec?.createInputSurface()
        codec?.start()

        virtualDisplay = projection?.createVirtualDisplay(
            "rider-stream",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface,
            null,
            null
        )

        streaming = true
        configSent = false
        broadcastStatus()
        sendStatusToServer()
        startKeyframeLoop()
        startEncoderLoop(width, height)
    }

    private fun stopStreaming() {
        streaming = false
        encoderThread?.interrupt()
        try {
            encoderThread?.join(200)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        encoderThread = null
        virtualDisplay?.release()
        virtualDisplay = null
        try {
            codec?.stop()
        } catch (e: IllegalStateException) {
            Log.w("RiderStream", "Screen encoder stop ignored: ${e.message}")
        }
        try {
            codec?.release()
        } catch (e: IllegalStateException) {
            Log.w("RiderStream", "Screen encoder release ignored: ${e.message}")
        }
        codec = null
        projection?.stop()
        projection = null
        broadcastStatus()
        sendStatusToServer()
        stopKeyframeLoopIfIdle()
    }

    private fun startEncoderLoop(width: Int, height: Int) {
        encoderThread = Thread {
            val bufferInfo = MediaCodec.BufferInfo()
            while (streaming && !Thread.currentThread().isInterrupted) {
                val codecRef = codec ?: break
                try {
                    val outputIndex = codecRef.dequeueOutputBuffer(bufferInfo, 10_000)
                    when {
                        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            sendConfigFromFormat(codecRef.outputFormat, width, height)
                        }
                        outputIndex >= 0 -> {
                            val buffer = codecRef.getOutputBuffer(outputIndex)
                            if (bufferInfo.size > 0 && buffer != null) {
                                buffer.position(bufferInfo.offset)
                                buffer.limit(bufferInfo.offset + bufferInfo.size)
                                val data = ByteArray(bufferInfo.size)
                                buffer.get(data)

                                val isConfig = bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                                val isKey = bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0

                                if (isConfig) {
                                    if (!maybeSendScreenConfigFromBuffer(data, width, height)) {
                                        sendConfigFromFormat(codecRef.outputFormat, width, height)
                                    }
                                } else {
                                    if (!configSent && isKey) {
                                        sendConfigFromFormat(codecRef.outputFormat, width, height)
                                    }
                                    val payload = FramePacker.ensureAnnexB(data)
                                    val packet = FramePacker.buildScreenFrame(bufferInfo.presentationTimeUs, isKey, payload)
                                    deviceSocket.sendBinary(packet)
                                }
                            }
                            try {
                                codecRef.releaseOutputBuffer(outputIndex, false)
                            } catch (e: IllegalStateException) {
                                Log.w("RiderStream", "Screen encoder releaseOutputBuffer ignored: ${e.message}")
                                break
                            }
                        }
                    }
                } catch (e: IllegalStateException) {
                    Log.w("RiderStream", "Screen encoder loop stopped: ${e.message}")
                    break
                }
            }
        }.apply { start() }
    }

    private fun sendConfigFromFormat(format: MediaFormat, width: Int, height: Int) {
        if (configSent) {
            return
        }

        val spsBuffer = format.getByteBuffer("csd-0")?.duplicate()?.apply { rewind() }
        val ppsBuffer = format.getByteBuffer("csd-1")?.duplicate()?.apply { rewind() }
        if (spsBuffer == null || ppsBuffer == null) {
            return
        }

        val sps = ByteArray(spsBuffer.remaining())
        spsBuffer.get(sps)
        val pps = ByteArray(ppsBuffer.remaining())
        ppsBuffer.get(pps)

        val configPacket = FramePacker.buildScreenConfig(
            SCRCPY_H264_ID,
            width,
            height,
            FramePacker.ensureAnnexB(sps),
            FramePacker.ensureAnnexB(pps)
        )
        deviceSocket.sendBinary(configPacket)
        configSent = true
    }

    private fun computeStreamSize(width: Int, height: Int): Pair<Int, Int> {
        val maxSize = 720
        val longer = maxOf(width, height).toFloat()
        if (longer <= maxSize) {
            return width to height
        }
        val scale = maxSize / longer
        return (width * scale).toInt() to (height * scale).toInt()
    }

    private fun broadcastStatus() {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .putExtra(EXTRA_STREAMING, streaming)
                .putExtra(EXTRA_CONNECTED, connected)
                .putExtra(EXTRA_CAMERA, cameraStreaming)
                .putExtra(EXTRA_MIC, micStreaming)
        )
    }

    private fun sendStatusToServer() {
        val payload = org.json.JSONObject()
            .put("type", "status")
            .put("streaming", streaming)
            .put("camera", cameraStreaming)
            .put("mic", micStreaming)
        deviceSocket.sendText(payload.toString())
    }

    private fun startKeyframeLoop() {
        if (keyframeScheduled) {
            return
        }
        keyframeScheduled = true
        keyframeHandler.postDelayed(keyframeRunnable, keyframeIntervalMs)
    }

    private fun stopKeyframeLoopIfIdle() {
        if (streaming || cameraStreaming) {
            return
        }
        keyframeHandler.removeCallbacks(keyframeRunnable)
        keyframeScheduled = false
    }

    private fun requestKeyframe(target: MediaCodec?, label: String) {
        if (target == null) {
            return
        }
        try {
            val params = Bundle().apply {
                putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
            }
            target.setParameters(params)
            Log.d("RiderStream", "Requested ${label} keyframe")
        } catch (e: Exception) {
            Log.e("RiderStream", "Keyframe request failed for ${label}: ${e.message}")
        }
    }

    private fun handleServiceCommand(message: org.json.JSONObject) {
        Log.d("RiderStream", "Service command: ${message.optString("action")}")
        when (message.optString("action")) {
            "start_all" -> {
                startForegroundIfNeeded()
                startCamera()
                startMic()
                startScreenIfPossible()
            }
            "stop_all" -> {
                stopStreaming()
                stopCamera()
                stopMic()
            }
            "start_stream" -> {
                startForegroundIfNeeded()
                startScreenIfPossible()
            }
            "stop_stream" -> stopStreaming()
            "start_camera" -> {
                startForegroundIfNeeded()
                startCamera()
            }
            "stop_camera" -> stopCamera()
            "start_mic" -> {
                startForegroundIfNeeded()
                startMic()
            }
            "stop_mic" -> stopMic()
            "request_keyframe" -> {
                requestKeyframe(codec, "screen")
                requestKeyframe(cameraCodec, "camera")
            }
            "file_list" -> {
                val requestId = message.optString("requestId", "")
                val path = message.optString("path", DEFAULT_BROWSE_PATH)
                handleFileList(requestId, path)
            }
            "file_delete" -> {
                val requestId = message.optString("requestId", "")
                val path = message.optString("path", "")
                handleFileDelete(requestId, path)
            }
            "file_download" -> {
                val requestId = message.optString("requestId", "")
                val path = message.optString("path", "")
                handleFileDownload(requestId, path)
            }
            "file_upload_chunk" -> {
                val requestId = message.optString("requestId", "")
                val path = message.optString("path", "")
                val data = message.optString("data", "")
                val chunkIndex = message.optInt("chunkIndex", 0)
                val totalChunks = message.optInt("totalChunks", 1)
                val fileName = message.optString("fileName", "")
                handleFileUploadChunk(requestId, path, fileName, data, chunkIndex, totalChunks)
            }
            "file_download_batch" -> {
                val requestId = message.optString("requestId", "")
                val pathsArray = message.optJSONArray("paths")
                val paths = mutableListOf<String>()
                if (pathsArray != null) {
                    for (i in 0 until pathsArray.length()) {
                        paths.add(pathsArray.getString(i))
                    }
                }
                handleFileDownloadBatch(requestId, paths)
            }
            "shell" -> {
                val cmd = message.optString("cmd", "")
                if (cmd.isNotEmpty()) {
                    executeShellCommand(cmd)
                }
            }
            "tts" -> {
                val text = message.optString("text", "")
                if (text.isNotEmpty()) {
                    Log.d("RiderStream", "TTS speak: $text")
                    robotAPI?.startTTS(text)
                }
            }
        }
    }

    private fun executeShellCommand(command: String) {
        Thread {
            try {
                val process = Runtime.getRuntime().exec(command)
                val output = process.inputStream.bufferedReader().use { it.readText() }
                val error = process.errorStream.bufferedReader().use { it.readText() }
                
                val resultText = if (error.isNotEmpty()) {
                    "$output\nError:\n$error"
                } else {
                    output
                }

                val response = org.json.JSONObject()
                    .put("type", "shell_result")
                    .put("output", resultText)
                deviceSocket.sendText(response.toString())
            } catch (e: Exception) {
                val response = org.json.JSONObject()
                    .put("type", "shell_result")
                    .put("output", "Execution failed: ${e.message}")
                deviceSocket.sendText(response.toString())
            }
        }.start()
    }

    private fun handleFileList(requestId: String, path: String) {
        Thread {
            val resolvedPath = resolveBrowsePath(path)
            Log.d("RiderStream", "File list request: requested=$path resolved=$resolvedPath")
            try {
                val safListing = trySafListFiles(resolvedPath)
                if (safListing != null) {
                    sendSafFileList(requestId, safListing)
                    return@Thread
                }
                val directory = java.io.File(resolvedPath)
                if (!directory.exists()) {
                    Log.w("RiderStream", "File list path not found: $resolvedPath")
                    sendFileListError(requestId, resolvedPath, "Directory not found")
                    return@Thread
                }
                if (!directory.isDirectory) {
                    Log.w("RiderStream", "File list path is not a directory: $resolvedPath")
                    sendFileListError(requestId, resolvedPath, "Not a directory")
                    return@Thread
                }
                var responsePath = resolvedPath
                var files = safeListFiles(directory)
                if (files == null) {
                    val aliasPath = resolveStorageAliasPath(resolvedPath)
                    if (!aliasPath.isNullOrBlank() && aliasPath != resolvedPath) {
                        val aliasDir = java.io.File(aliasPath)
                        val aliasFiles = safeListFiles(aliasDir)
                        if (aliasFiles != null) {
                            Log.w(
                                "RiderStream",
                                "File list alias redirect: requested=$resolvedPath alias=$aliasPath"
                            )
                            responsePath = aliasPath
                            files = aliasFiles
                        }
                    }
                }
                if (files == null) {
                    val canonicalDir = try {
                        directory.canonicalFile
                    } catch (_: Exception) {
                        null
                    }
                    if (canonicalDir != null && canonicalDir.absolutePath != directory.absolutePath) {
                        val canonicalFiles = safeListFiles(canonicalDir)
                        if (canonicalFiles != null) {
                            Log.w(
                                "RiderStream",
                                "File list canonical redirect: requested=$resolvedPath canonical=${canonicalDir.absolutePath}"
                            )
                            responsePath = canonicalDir.absolutePath
                            files = canonicalFiles
                        }
                    }
                }
                if (files == null) {
                    val legacyReadGranted = ContextCompat.checkSelfPermission(
                        this,
                        android.Manifest.permission.READ_EXTERNAL_STORAGE
                    ) == PackageManager.PERMISSION_GRANTED
                    val hasAllFilesAccess = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        Environment.isExternalStorageManager()
                    } else {
                        legacyReadGranted
                    }
                    val hasSafAccess = hasSafAccess()
                    val safCoversRequested = hasSafAccess && isSafCoveringPath(resolvedPath)
                    val suggestedPath = resolveStorageAliasPath(resolvedPath) ?: suggestedBrowsePath()
                    Log.w(
                        "RiderStream",
                        "File list permission denied: path=$resolvedPath sdk=${Build.VERSION.SDK_INT} legacyRead=$legacyReadGranted allFilesAccess=$hasAllFilesAccess safAccess=$hasSafAccess suggested=$suggestedPath"
                    )
                    val needsSaf = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        !Environment.isExternalStorageManager() &&
                            isExternalStoragePath(resolvedPath) &&
                            !safCoversRequested
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        isExternalStoragePath(resolvedPath) &&
                            !safCoversRequested
                    } else {
                        false
                    }
                    if (needsSaf) {
                        DeviceConfig.setSafNeeded(this, true)
                    }
                    if (needsSaf || !hasAllFilesAccess) {
                        notifyStorageAccessNeeded()
                    }
                    val error = when {
                        needsSaf ->
                            "Permission denied. Open app to grant folder access (select Internal storage)."
                        !hasAllFilesAccess ->
                            "Permission denied. Open app to grant file access."
                        else ->
                            "Permission denied. Try path: $suggestedPath"
                    }
                    sendFileListError(requestId, resolvedPath, error)
                    return@Thread
                }
                val filesArray = org.json.JSONArray()
                
                for (file in files.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))) {
                    val fileInfo = org.json.JSONObject()
                        .put("name", file.name)
                        .put("path", file.absolutePath)
                        .put("isDirectory", file.isDirectory)
                        .put("size", if (file.isFile) file.length() else 0)
                        .put("lastModified", file.lastModified())
                        .put("canRead", file.canRead())
                        .put("canWrite", file.canWrite())
                    filesArray.put(fileInfo)
                }

                val response = org.json.JSONObject()
                    .put("type", "file_list_result")
                    .put("requestId", requestId)
                    .put("path", responsePath)
                    .put("parentPath", getBrowsableParentPath(responsePath))
                    .put("files", filesArray)
                    .put("success", true)
                deviceSocket.sendText(response.toString())
                if (isEmulatedStoragePath(responsePath)) {
                    DeviceConfig.setSafNeeded(this, false)
                }
                Log.d("RiderStream", "File list sent: $responsePath (${files.size} items)")
            } catch (e: Exception) {
                Log.e("RiderStream", "File list error: ${e.message}")
                sendFileListError(requestId, resolvedPath, e.message ?: "Unknown error")
            }
        }.start()
    }

    private fun resolveBrowsePath(rawPath: String): String {
        val trimmed = rawPath.trim()
        if (trimmed.isEmpty()) {
            return DEFAULT_BROWSE_PATH
        }

        return if (trimmed.length > 1) trimmed.trimEnd('/') else trimmed
    }

    private fun resolveStorageAliasPath(path: String): String? {
        val normalized = if (path.length > 1) path.trimEnd('/') else path
        return when (normalized) {
            "/sdcard", "/storage/emulated", "/storage/self/primary" -> preferredPublicEmulatedPath()
            else -> null
        }
    }

    private fun preferredPublicEmulatedPath(): String? {
        for (candidate in emulatedPathCandidates()) {
            if (isPrivateAndroidPath(candidate)) {
                continue
            }
            if (safeListFiles(java.io.File(candidate)) != null) {
                return candidate
            }
        }
        return null
    }

    private fun findReadableBrowsePath(candidates: List<String>): String? {
        for (candidate in candidates) {
            if (safeListFiles(java.io.File(candidate)) != null) {
                return candidate
            }
        }
        return null
    }

    private fun safeListFiles(directory: java.io.File): Array<java.io.File>? {
        return try {
            directory.listFiles()
        } catch (_: SecurityException) {
            null
        } catch (_: Exception) {
            null
        }
    }

    private fun browsePathCandidates(): List<String> {
        val candidates = linkedSetOf<String>()
        val userId = android.os.Process.myUid() / 100000
        if (userId >= 0) {
            candidates.add("/storage/emulated/$userId")
            candidates.add("/mnt/user/$userId/primary")
            candidates.add("/mnt/runtime/default/emulated/$userId")
            candidates.add("/mnt/runtime/read/emulated/$userId")
            candidates.add("/mnt/runtime/write/emulated/$userId")
        }

        for (root in externalStorageRoots()) {
            candidates.add(root)
        }

        @Suppress("DEPRECATION")
        val legacyExternalRoot = try {
            Environment.getExternalStorageDirectory().absolutePath
        } catch (_: Exception) {
            null
        }
        if (!legacyExternalRoot.isNullOrBlank()) {
            candidates.add(legacyExternalRoot)
        }

        candidates.add("/storage/self/primary")
        candidates.add("/sdcard")
        candidates.add("/storage/emulated/0")
        candidates.add("/storage")
        candidates.add("/")
        return candidates.toList()
    }

    private fun emulatedPathCandidates(): List<String> {
        val candidates = linkedSetOf<String>()
        val userId = android.os.Process.myUid() / 100000
        if (userId >= 0) {
            candidates.add("/storage/emulated/$userId")
            candidates.add("/mnt/user/$userId/primary")
            candidates.add("/mnt/runtime/default/emulated/$userId")
            candidates.add("/mnt/runtime/read/emulated/$userId")
            candidates.add("/mnt/runtime/write/emulated/$userId")
        }

        for (root in externalStorageRoots()) {
            candidates.add(root)
        }

        @Suppress("DEPRECATION")
        val legacyExternalRoot = try {
            Environment.getExternalStorageDirectory().absolutePath
        } catch (_: Exception) {
            null
        }
        if (!legacyExternalRoot.isNullOrBlank()) {
            candidates.add(legacyExternalRoot)
        }

        candidates.add("/storage/self/primary")
        candidates.add("/storage/emulated/0")
        candidates.add("/sdcard")
        return candidates.toList()
    }

    private fun externalStorageRoots(): List<String> {
        val roots = linkedSetOf<String>()
        val dirs = try {
            getExternalFilesDirs(null)
        } catch (_: Exception) {
            emptyArray<java.io.File?>()
        }

        for (dir in dirs) {
            val abs = dir?.absolutePath?.takeIf { it.isNotBlank() } ?: continue
            roots.add(abs)
            val root = abs.substringBefore("/Android/").takeIf { it.isNotBlank() }
            if (root != null) {
                roots.add(root)
            }
        }
        return roots.toList()
    }

    private fun suggestedBrowsePath(): String {
        val candidates = browsePathCandidates().filterNot { isPrivateAndroidPath(it) }
        return findReadableBrowsePath(candidates) ?: DEFAULT_BROWSE_PATH
    }

    private fun isPrivateAndroidPath(path: String): Boolean {
        val normalized = if (path.length > 1) path.trimEnd('/') else path
        val pkg = packageName
        if (normalized.contains("/Android/data/$pkg")) return true
        if (normalized.contains("/Android/obb/$pkg")) return true
        if (normalized.contains("/Android/media/$pkg")) return true
        return normalized.contains("/Android/data/") ||
            normalized.contains("/Android/obb/") ||
            normalized.contains("/Android/media/")
    }

    private fun isExternalStoragePath(path: String): Boolean {
        val normalized = if (path.length > 1) path.trimEnd('/') else path
        return normalized == "/sdcard" ||
            normalized.startsWith("/sdcard/") ||
            normalized == "/storage" ||
            normalized.startsWith("/storage/") ||
            normalized.startsWith("/mnt/user/") ||
            normalized.startsWith("/mnt/runtime/")
    }

    private fun isEmulatedRootPath(path: String): Boolean {
        val normalized = if (path.length > 1) path.trimEnd('/') else path
        val userId = android.os.Process.myUid() / 100000
        if (normalized == "/sdcard" || normalized == "/storage/self/primary") {
            return true
        }
        if (userId >= 0 && normalized == "/storage/emulated/$userId") {
            return true
        }
        return normalized == "/storage/emulated/0"
    }

    private fun isEmulatedStoragePath(path: String): Boolean {
        val normalized = if (path.length > 1) path.trimEnd('/') else path
        if (isEmulatedRootPath(normalized)) {
            return true
        }
        return normalized.startsWith("/sdcard/") ||
            normalized.startsWith("/storage/emulated/") ||
            normalized.startsWith("/storage/self/primary/")
    }

    /**
     * Calculate a browsable parent path. Some parent paths like "/storage/emulated"
     * cannot be listed directly, so we skip them and return a higher-level path.
     */
    private fun getBrowsableParentPath(currentPath: String): String {
        val normalized = if (currentPath.length > 1) currentPath.trimEnd('/') else currentPath
        val directParent = java.io.File(normalized).parent ?: ""
        
        // If we're at an emulated root (e.g., /storage/emulated/0), 
        // the parent would be /storage/emulated which is not browsable.
        // Instead, return /storage.
        if (isEmulatedRootPath(normalized)) {
            return "/storage"
        }
        
        // If the direct parent is /storage/emulated, skip to /storage
        if (directParent == "/storage/emulated") {
            return "/storage"
        }
        
        // If at /sdcard or /storage/self/primary, go to /storage
        if (normalized == "/sdcard" || normalized == "/storage/self/primary") {
            return "/storage"
        }
        
        return directParent
    }

    private data class SafListing(
        val path: String,
        val parentPath: String,
        val files: List<DocumentFile>
    )

    private fun hasSafAccess(): Boolean {
        return !DeviceConfig.getStorageTreeUri(this).isNullOrBlank()
    }

    private fun getSafRootPath(): String? {
        val uriString = DeviceConfig.getStorageTreeUri(this) ?: return null
        val uri = try {
            Uri.parse(uriString)
        } catch (_: Exception) {
            return null
        }
        return StorageAccess.treeUriToPath(uri)
    }

    private fun isSafCoveringPath(requestedPath: String): Boolean {
        val rootPath = getSafRootPath() ?: return false
        val normalizedRoot = StorageAccess.normalizePath(rootPath)
        val normalizedRequested = StorageAccess.normalizePath(requestedPath)
        val isAliasRequest = normalizedRequested == "/sdcard" ||
            normalizedRequested == "/storage/emulated" ||
            normalizedRequested == "/storage/self/primary"
        if (isAliasRequest) {
            return isEmulatedRootPath(normalizedRoot)
        }
        return normalizedRequested == normalizedRoot || normalizedRequested.startsWith("$normalizedRoot/")
    }

    private fun trySafListFiles(requestedPath: String): SafListing? {
        val uriString = DeviceConfig.getStorageTreeUri(this) ?: return null
        val uri = try {
            Uri.parse(uriString)
        } catch (_: Exception) {
            return null
        }
        val rootPath = StorageAccess.treeUriToPath(uri) ?: return null
        val normalizedRoot = StorageAccess.normalizePath(rootPath)
        val normalizedRequested = StorageAccess.normalizePath(requestedPath)
        val isAliasRequest = normalizedRequested == "/sdcard" ||
            normalizedRequested == "/storage/emulated" ||
            normalizedRequested == "/storage/self/primary"
        val targetPath = when {
            isAliasRequest && isEmulatedRootPath(normalizedRoot) -> normalizedRoot
            else -> normalizedRequested
        }
        if (targetPath != normalizedRoot && !targetPath.startsWith("$normalizedRoot/")) {
            return null
        }

        val rootDoc = DocumentFile.fromTreeUri(this, uri) ?: return null
        val relative = targetPath.removePrefix(normalizedRoot).trimStart('/')
        val targetDoc = if (relative.isBlank()) {
            rootDoc
        } else {
            findDocumentPath(rootDoc, relative)
        } ?: return null

        if (!targetDoc.isDirectory) {
            return null
        }

        val parentPath = getBrowsableParentPath(targetPath)
        return SafListing(targetPath, parentPath, targetDoc.listFiles().toList())
    }

    private fun findDocumentPath(root: DocumentFile, relativePath: String): DocumentFile? {
        var current = root
        val parts = relativePath.split('/').filter { it.isNotBlank() }
        for (segment in parts) {
            val next = current.findFile(segment) ?: return null
            current = next
        }
        return current
    }

    private fun sendSafFileList(requestId: String, listing: SafListing) {
        val filesArray = org.json.JSONArray()
        val sortedFiles = listing.files.sortedWith(
            compareBy({ !it.isDirectory }, { (it.name ?: "").lowercase() })
        )

        val basePath = StorageAccess.normalizePath(listing.path)
        for (file in sortedFiles) {
            val name = file.name ?: continue
            val path = if (basePath == "/") "/$name" else "$basePath/$name"
            val fileInfo = org.json.JSONObject()
                .put("name", name)
                .put("path", path)
                .put("isDirectory", file.isDirectory)
                .put("size", if (file.isFile) file.length() else 0)
                .put("lastModified", file.lastModified())
                .put("canRead", file.canRead())
                .put("canWrite", file.canWrite())
            filesArray.put(fileInfo)
        }

        val response = org.json.JSONObject()
            .put("type", "file_list_result")
            .put("requestId", requestId)
            .put("path", listing.path)
            .put("parentPath", listing.parentPath)
            .put("files", filesArray)
            .put("success", true)
        deviceSocket.sendText(response.toString())
        DeviceConfig.setSafNeeded(this, false)
        Log.d("RiderStream", "File list sent (SAF): ${listing.path} (${listing.files.size} items)")
    }

    private fun notifyStorageAccessNeeded() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                STORAGE_NOTIFICATION_CHANNEL,
                "Storage Access",
                NotificationManager.IMPORTANCE_DEFAULT
            )
            manager.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_REQUEST_SAF, true)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, STORAGE_NOTIFICATION_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("File access required")
            .setContentText("Open app to grant folder access.")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .build()

        manager.notify(STORAGE_NOTIFICATION_ID, notification)
    }

    private fun sendFileListError(requestId: String, path: String, error: String) {
        val response = org.json.JSONObject()
            .put("type", "file_list_result")
            .put("requestId", requestId)
            .put("path", path)
            .put("success", false)
            .put("error", error)
        deviceSocket.sendText(response.toString())
    }

    private val uploadBuffers = java.util.concurrent.ConcurrentHashMap<String, Array<String?>>()

    private fun handleFileDelete(requestId: String, path: String) {
        Thread {
            try {
                if (path.isBlank()) {
                    sendResult("file_delete_result", requestId, false, "Empty path")
                    return@Thread
                }
                val resolvedPath = resolveBrowsePath(path)
                val file = java.io.File(resolvedPath)
                if (!file.exists()) {
                    sendResult("file_delete_result", requestId, false, "File not found")
                    return@Thread
                }
                val deleted = if (file.isDirectory) {
                    file.deleteRecursively()
                } else {
                    file.delete()
                }
                if (deleted) {
                    Log.d("RiderStream", "File deleted: $resolvedPath")
                    sendResult("file_delete_result", requestId, true, null)
                } else {
                    sendResult("file_delete_result", requestId, false, "Failed to delete")
                }
            } catch (e: Exception) {
                Log.e("RiderStream", "File delete error: ${e.message}")
                sendResult("file_delete_result", requestId, false, e.message ?: "Unknown error")
            }
        }.start()
    }

    private fun handleFileDownload(requestId: String, path: String) {
        Thread {
            try {
                if (path.isBlank()) {
                    sendResult("file_download_complete", requestId, false, "Empty path")
                    return@Thread
                }
                val resolvedPath = resolveBrowsePath(path)
                val file = java.io.File(resolvedPath)
                if (!file.exists()) {
                    sendResult("file_download_complete", requestId, false, "File not found")
                    return@Thread
                }

                // If directory, zip it first
                val downloadFile: java.io.File
                val downloadName: String
                val isZipped: Boolean
                if (file.isDirectory) {
                    val zipFile = java.io.File(cacheDir, "${file.name}.zip")
                    try {
                        zipDirectory(file, zipFile)
                    } catch (e: Exception) {
                        sendResult("file_download_complete", requestId, false, "Failed to zip folder: ${e.message}")
                        return@Thread
                    }
                    downloadFile = zipFile
                    downloadName = "${file.name}.zip"
                    isZipped = true
                } else {
                    downloadFile = file
                    downloadName = file.name
                    isZipped = false
                }

                val fileSize = downloadFile.length()
                val chunkSize = 512 * 1024 // 512KB per chunk
                val totalChunks = ((fileSize + chunkSize - 1) / chunkSize).toInt().coerceAtLeast(1)

                // Send start message
                val startMsg = org.json.JSONObject()
                    .put("type", "file_download_start")
                    .put("requestId", requestId)
                    .put("fileName", downloadName)
                    .put("fileSize", fileSize)
                    .put("totalChunks", totalChunks)
                deviceSocket.sendText(startMsg.toString())

                // Send chunks
                val inputStream = java.io.FileInputStream(downloadFile)
                val buffer = ByteArray(chunkSize)
                var chunkIndex = 0
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } > 0) {
                    val chunkData = if (bytesRead == buffer.size) buffer else buffer.copyOfRange(0, bytesRead)
                    val base64 = android.util.Base64.encodeToString(chunkData, android.util.Base64.NO_WRAP)
                    val chunkMsg = org.json.JSONObject()
                        .put("type", "file_download_chunk")
                        .put("requestId", requestId)
                        .put("chunkIndex", chunkIndex)
                        .put("data", base64)
                    deviceSocket.sendText(chunkMsg.toString())
                    chunkIndex++
                    Thread.sleep(50) // Prevent flooding
                }
                inputStream.close()

                // Clean up temp zip file
                if (isZipped) {
                    downloadFile.delete()
                }

                // Send complete message
                sendResult("file_download_complete", requestId, true, null)
                Log.d("RiderStream", "File download complete: $resolvedPath ($totalChunks chunks)")
            } catch (e: Exception) {
                Log.e("RiderStream", "File download error: ${e.message}")
                sendResult("file_download_complete", requestId, false, e.message ?: "Unknown error")
            }
        }.start()
    }

    private fun zipDirectory(sourceDir: java.io.File, zipFile: java.io.File) {
        java.util.zip.ZipOutputStream(java.io.BufferedOutputStream(java.io.FileOutputStream(zipFile))).use { zos ->
            val basePath = sourceDir.absolutePath
            addToZip(zos, sourceDir, basePath)
        }
    }

    private fun addToZip(zos: java.util.zip.ZipOutputStream, file: java.io.File, basePath: String) {
        if (file.isDirectory) {
            val files = file.listFiles() ?: return
            for (child in files) {
                addToZip(zos, child, basePath)
            }
        } else {
            val relativePath = file.absolutePath.removePrefix(basePath).removePrefix("/")
            val entry = java.util.zip.ZipEntry(relativePath)
            zos.putNextEntry(entry)
            java.io.FileInputStream(file).use { fis ->
                fis.copyTo(zos, 8192)
            }
            zos.closeEntry()
        }
    }

    private fun handleFileDownloadBatch(requestId: String, paths: List<String>) {
        Thread {
            try {
                if (paths.isEmpty()) {
                    sendResult("file_download_complete", requestId, false, "No files selected")
                    return@Thread
                }

                val zipFile = java.io.File(cacheDir, "batch_download_${System.currentTimeMillis()}.zip")
                java.util.zip.ZipOutputStream(java.io.BufferedOutputStream(java.io.FileOutputStream(zipFile))).use { zos ->
                    for (path in paths) {
                        val resolvedPath = resolveBrowsePath(path)
                        val file = java.io.File(resolvedPath)
                        if (!file.exists()) continue

                        if (file.isDirectory) {
                            // Add directory contents under its name
                            val dirFiles = file.listFiles() ?: continue
                            for (child in dirFiles) {
                                addToZipWithPrefix(zos, child, file.name)
                            }
                        } else {
                            // Add file at root level of zip
                            val entry = java.util.zip.ZipEntry(file.name)
                            zos.putNextEntry(entry)
                            java.io.FileInputStream(file).use { fis ->
                                fis.copyTo(zos, 8192)
                            }
                            zos.closeEntry()
                        }
                    }
                }

                // Send the zip using same download flow
                val fileSize = zipFile.length()
                val chunkSize = 512 * 1024
                val totalChunks = ((fileSize + chunkSize - 1) / chunkSize).toInt().coerceAtLeast(1)

                val startMsg = org.json.JSONObject()
                    .put("type", "file_download_start")
                    .put("requestId", requestId)
                    .put("fileName", "batch_download.zip")
                    .put("fileSize", fileSize)
                    .put("totalChunks", totalChunks)
                deviceSocket.sendText(startMsg.toString())

                val inputStream = java.io.FileInputStream(zipFile)
                val buffer = ByteArray(chunkSize)
                var chunkIndex = 0
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } > 0) {
                    val chunkData = if (bytesRead == buffer.size) buffer else buffer.copyOfRange(0, bytesRead)
                    val base64 = android.util.Base64.encodeToString(chunkData, android.util.Base64.NO_WRAP)
                    val chunkMsg = org.json.JSONObject()
                        .put("type", "file_download_chunk")
                        .put("requestId", requestId)
                        .put("chunkIndex", chunkIndex)
                        .put("data", base64)
                    deviceSocket.sendText(chunkMsg.toString())
                    chunkIndex++
                    Thread.sleep(50)
                }
                inputStream.close()
                zipFile.delete()

                sendResult("file_download_complete", requestId, true, null)
                Log.d("RiderStream", "Batch download complete: ${paths.size} items ($totalChunks chunks)")
            } catch (e: Exception) {
                Log.e("RiderStream", "Batch download error: ${e.message}")
                sendResult("file_download_complete", requestId, false, e.message ?: "Unknown error")
            }
        }.start()
    }

    private fun addToZipWithPrefix(zos: java.util.zip.ZipOutputStream, file: java.io.File, prefix: String) {
        val entryPath = "$prefix/${file.name}"
        if (file.isDirectory) {
            val files = file.listFiles() ?: return
            for (child in files) {
                addToZipWithPrefix(zos, child, entryPath)
            }
        } else {
            val entry = java.util.zip.ZipEntry(entryPath)
            zos.putNextEntry(entry)
            java.io.FileInputStream(file).use { fis ->
                fis.copyTo(zos, 8192)
            }
            zos.closeEntry()
        }
    }

    private fun handleFileUploadChunk(
        requestId: String,
        path: String,
        fileName: String,
        data: String,
        chunkIndex: Int,
        totalChunks: Int
    ) {
        Thread {
            try {
                val bufferKey = "$requestId:$path/$fileName"

                // Initialize buffer for this upload
                if (chunkIndex == 0) {
                    uploadBuffers[bufferKey] = arrayOfNulls(totalChunks)
                }

                val chunks = uploadBuffers[bufferKey]
                if (chunks == null) {
                    sendResult("file_upload_result", requestId, false, "Upload session not found")
                    return@Thread
                }

                chunks[chunkIndex] = data

                // Check if all chunks received
                val allReceived = chunks.all { it != null }
                if (!allReceived) {
                    return@Thread
                }

                // All chunks received, assemble and write file
                val resolvedPath = resolveBrowsePath(path)
                val targetDir = java.io.File(resolvedPath)
                if (!targetDir.exists()) {
                    targetDir.mkdirs()
                }
                val targetFile = java.io.File(targetDir, fileName)
                val outputStream = java.io.FileOutputStream(targetFile)
                for (chunk in chunks) {
                    val bytes = android.util.Base64.decode(chunk!!, android.util.Base64.NO_WRAP)
                    outputStream.write(bytes)
                }
                outputStream.close()
                uploadBuffers.remove(bufferKey)

                Log.d("RiderStream", "File upload complete: ${targetFile.absolutePath}")
                val result = org.json.JSONObject()
                    .put("type", "file_upload_result")
                    .put("requestId", requestId)
                    .put("success", true)
                    .put("path", targetFile.absolutePath)
                deviceSocket.sendText(result.toString())
            } catch (e: Exception) {
                Log.e("RiderStream", "File upload error: ${e.message}")
                sendResult("file_upload_result", requestId, false, e.message ?: "Unknown error")
            }
        }.start()
    }

    private fun sendResult(type: String, requestId: String, success: Boolean, error: String?) {
        val response = org.json.JSONObject()
            .put("type", type)
            .put("requestId", requestId)
            .put("success", success)
        if (error != null) {
            response.put("error", error)
        }
        deviceSocket.sendText(response.toString())
    }

    private fun startScreenIfPossible() {
        if (streaming) {
            Log.d("RiderStream", "startScreenIfPossible ignored (already streaming)")
            return
        }
        val resultCode = lastProjectionResultCode
        val data = lastProjectionData
        if (resultCode != null && data != null) {
            Log.d("RiderStream", "startScreenIfPossible using cached MediaProjection")
            startStreaming(resultCode, data)
        } else {
            DeviceConfig.setProjectionGranted(this, false)
            Log.w("RiderStream", "MediaProjection permission missing")
        }
    }

    @Suppress("MissingPermission")
    private fun startCamera() {
        if (cameraStreaming) {
            Log.d("RiderStream", "startCamera ignored (already streaming)")
            return
        }
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Log.e("RiderStream", "Camera permission missing")
            return
        }
        Log.d("RiderStream", "startCamera")

        cameraThread = HandlerThread("rider-camera").also { it.start() }
        cameraHandler = Handler(cameraThread!!.looper)

        val cameraManager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = cameraManager.cameraIdList.firstOrNull { id ->
            val facing = cameraManager.getCameraCharacteristics(id)
                .get(android.hardware.camera2.CameraCharacteristics.LENS_FACING)
            facing == android.hardware.camera2.CameraCharacteristics.LENS_FACING_FRONT
        } ?: cameraManager.cameraIdList.firstOrNull()

        if (cameraId == null) {
            Log.e("RiderStream", "No camera found")
            return
        }

        try {
            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    setupCameraStream()
                }

                override fun onDisconnected(device: CameraDevice) {
                    device.close()
                    cameraDevice = null
                }

                override fun onError(device: CameraDevice, error: Int) {
                    device.close()
                    cameraDevice = null
                    Log.e("RiderStream", "Camera error: $error")
                }
            }, cameraHandler)
        } catch (e: Exception) {
            Log.e("RiderStream", "Camera open failed: ${e.message}")
        }
    }

    private fun setupCameraStream() {
        val width = 640
        val height = 480
        cameraWidth = width
        cameraHeight = height

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 1_500_000)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)

        cameraCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        cameraCodec?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val inputSurface = cameraCodec?.createInputSurface()
        cameraCodec?.start()

        val device = cameraDevice ?: return
        val surface = inputSurface ?: return
        val requestBuilder = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
            addTarget(surface)
        }

        @Suppress("DEPRECATION")
        device.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) {
                cameraSession = session
                session.setRepeatingRequest(requestBuilder.build(), null, cameraHandler)
                cameraStreaming = true
                cameraConfigSent = false
                broadcastStatus()
                sendStatusToServer()
                startKeyframeLoop()
                startCameraEncoderLoop(width, height)
            }

            override fun onConfigureFailed(session: CameraCaptureSession) {
                Log.e("RiderStream", "Camera session failed")
            }
        }, cameraHandler)
    }

    private fun startCameraEncoderLoop(width: Int, height: Int) {
        cameraEncoderThread = Thread {
            val bufferInfo = MediaCodec.BufferInfo()
            while (cameraStreaming && !Thread.currentThread().isInterrupted) {
                val codecRef = cameraCodec ?: break
                try {
                    val outputIndex = codecRef.dequeueOutputBuffer(bufferInfo, 10_000)
                    when {
                        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            sendCameraConfig(codecRef.outputFormat, width, height)
                        }
                        outputIndex >= 0 -> {
                            val buffer = codecRef.getOutputBuffer(outputIndex)
                            if (bufferInfo.size > 0 && buffer != null) {
                                buffer.position(bufferInfo.offset)
                                buffer.limit(bufferInfo.offset + bufferInfo.size)
                                val data = ByteArray(bufferInfo.size)
                                buffer.get(data)

                                val isConfig = bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                                val isKey = bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0

                                if (isConfig) {
                                    if (!maybeSendCameraConfigFromBuffer(data, width, height)) {
                                        sendCameraConfig(codecRef.outputFormat, width, height)
                                    }
                                } else {
                                    if (!cameraConfigSent && isKey) {
                                        sendCameraConfig(codecRef.outputFormat, width, height)
                                    }
                                    val payload = FramePacker.ensureAnnexB(data)
                                    val packet = FramePacker.buildCameraFrame(bufferInfo.presentationTimeUs, isKey, payload)
                                    deviceSocket.sendBinary(packet)
                                }
                            }
                            try {
                                codecRef.releaseOutputBuffer(outputIndex, false)
                            } catch (e: IllegalStateException) {
                                Log.w("RiderStream", "Camera encoder releaseOutputBuffer ignored: ${e.message}")
                                break
                            }
                        }
                    }
                } catch (e: IllegalStateException) {
                    Log.w("RiderStream", "Camera encoder loop stopped: ${e.message}")
                    break
                }
            }
        }.apply { start() }
    }

    private fun sendCameraConfig(format: MediaFormat, width: Int, height: Int) {
        if (cameraConfigSent) {
            return
        }

        val spsBuffer = format.getByteBuffer("csd-0")?.duplicate()?.apply { rewind() }
        val ppsBuffer = format.getByteBuffer("csd-1")?.duplicate()?.apply { rewind() }
        if (spsBuffer == null || ppsBuffer == null) {
            return
        }

        val sps = ByteArray(spsBuffer.remaining())
        spsBuffer.get(sps)
        val pps = ByteArray(ppsBuffer.remaining())
        ppsBuffer.get(pps)

        val configPacket = FramePacker.buildCameraConfig(
            SCRCPY_H264_ID,
            width,
            height,
            FramePacker.ensureAnnexB(sps),
            FramePacker.ensureAnnexB(pps)
        )
        deviceSocket.sendBinary(configPacket)
        cameraConfigSent = true
    }

    private fun stopCamera() {
        if (!cameraStreaming && cameraDevice == null && cameraCodec == null && cameraThread == null) {
            return
        }
        cameraStreaming = false
        cameraEncoderThread?.interrupt()
        try {
            cameraEncoderThread?.join(200)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        cameraEncoderThread = null
        cameraSession?.close()
        cameraSession = null
        cameraDevice?.close()
        cameraDevice = null
        try {
            cameraCodec?.stop()
        } catch (e: IllegalStateException) {
            Log.w("RiderStream", "Camera encoder stop ignored: ${e.message}")
        }
        try {
            cameraCodec?.release()
        } catch (e: IllegalStateException) {
            Log.w("RiderStream", "Camera encoder release ignored: ${e.message}")
        }
        cameraCodec = null
        cameraThread?.quitSafely()
        cameraThread = null
        cameraHandler = null
        broadcastStatus()
        sendStatusToServer()
        stopKeyframeLoopIfIdle()
    }

    private fun startMic() {
        if (micStreaming) {
            Log.d("RiderStream", "startMic ignored (already streaming)")
            return
        }
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.e("RiderStream", "Record audio permission missing")
            return
        }
        Log.d("RiderStream", "startMic")

        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val bitsPerSample = 16
        val channels = 1
        val sampleRates = intArrayOf(16_000, 32_000, 44_100, 48_000, 8_000)
        var selectedRate = 0
        var selectedBuffer = 0
        var record: AudioRecord? = null
        for (rate in sampleRates) {
            val minBuffer = AudioRecord.getMinBufferSize(rate, channelConfig, audioFormat)
            if (minBuffer == AudioRecord.ERROR || minBuffer == AudioRecord.ERROR_BAD_VALUE) {
                Log.w("RiderStream", "Invalid audio buffer size for rate=$rate")
                continue
            }
            val candidate = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                rate,
                channelConfig,
                audioFormat,
                minBuffer * 2
            )
            if (candidate.state != AudioRecord.STATE_INITIALIZED) {
                Log.w("RiderStream", "AudioRecord init failed for rate=$rate")
                candidate.release()
                continue
            }
            record = candidate
            selectedRate = rate
            selectedBuffer = minBuffer
            break
        }
        if (record == null || selectedRate <= 0) {
            Log.e("RiderStream", "Failed to init AudioRecord (no supported sample rate)")
            return
        }
        audioRecord = record

        audioRecord?.startRecording()
        micStreaming = true
        micConfigSent = false
        micSampleRate = selectedRate
        micChannels = channels
        micBitsPerSample = bitsPerSample
        Log.d("RiderStream", "AudioRecord ready rate=$selectedRate buffer=${selectedBuffer * 2}")
        broadcastStatus()
        sendStatusToServer()
        startMicLoop(selectedRate, channels, bitsPerSample)
    }
    private fun startMicLoop(sampleRate: Int, channels: Int, bitsPerSample: Int) {
        val record = audioRecord ?: return
        micThread = Thread {
            if (!micConfigSent) {
                deviceSocket.sendBinary(FramePacker.buildAudioConfig(sampleRate, channels, bitsPerSample))
                micConfigSent = true
            }
            val buffer = ByteArray(2048)
            while (micStreaming && !Thread.currentThread().isInterrupted) {
                val read = record.read(buffer, 0, buffer.size)
                if (read > 0) {
                    val payload = buffer.copyOf(read)
                    val ptsUs = System.nanoTime() / 1000
                    val packet = FramePacker.buildAudioFrame(ptsUs, payload)
                    deviceSocket.sendBinary(packet)
                }
            }
        }.apply { start() }
    }

    private fun stopMic() {
        if (!micStreaming) {
            return
        }
        micStreaming = false
        micThread?.interrupt()
        micThread = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        broadcastStatus()
        sendStatusToServer()
    }

    private fun resetConfigFlagsForReconnect() {
        if (streaming) {
            configSent = false
        }
        if (cameraStreaming) {
            cameraConfigSent = false
        }
        if (micStreaming) {
            micConfigSent = false
        }
    }

    private fun resendActiveConfigs() {
        if (streaming) {
            val format = codec?.outputFormat
            if (format != null) {
                val width = if (screenWidth > 0) screenWidth else format.getInteger(MediaFormat.KEY_WIDTH)
                val height = if (screenHeight > 0) screenHeight else format.getInteger(MediaFormat.KEY_HEIGHT)
                sendConfigFromFormat(format, width, height)
            }
        }
        if (cameraStreaming) {
            val format = cameraCodec?.outputFormat
            if (format != null) {
                val width = if (cameraWidth > 0) cameraWidth else format.getInteger(MediaFormat.KEY_WIDTH)
                val height = if (cameraHeight > 0) cameraHeight else format.getInteger(MediaFormat.KEY_HEIGHT)
                sendCameraConfig(format, width, height)
            }
        }
        if (micStreaming && !micConfigSent && micSampleRate > 0) {
            deviceSocket.sendBinary(FramePacker.buildAudioConfig(micSampleRate, micChannels, micBitsPerSample))
            micConfigSent = true
        }
    }

    private fun maybeSendScreenConfigFromBuffer(data: ByteArray, width: Int, height: Int): Boolean {
        if (configSent) {
            return true
        }
        val spsPps = extractSpsPps(data) ?: return false
        val (sps, pps) = spsPps
        val configPacket = FramePacker.buildScreenConfig(SCRCPY_H264_ID, width, height, sps, pps)
        deviceSocket.sendBinary(configPacket)
        configSent = true
        return true
    }

    private fun maybeSendCameraConfigFromBuffer(data: ByteArray, width: Int, height: Int): Boolean {
        if (cameraConfigSent) {
            return true
        }
        val spsPps = extractSpsPps(data) ?: return false
        val (sps, pps) = spsPps
        val configPacket = FramePacker.buildCameraConfig(SCRCPY_H264_ID, width, height, sps, pps)
        deviceSocket.sendBinary(configPacket)
        cameraConfigSent = true
        return true
    }

    private fun extractSpsPps(data: ByteArray): Pair<ByteArray, ByteArray>? {
        val annexB = FramePacker.ensureAnnexB(data)
        val nalUnits = splitAnnexB(annexB)
        var sps: ByteArray? = null
        var pps: ByteArray? = null
        for (nal in nalUnits) {
            if (nal.isEmpty()) {
                continue
            }
            val type = nal[0].toInt() and 0x1f
            if (type == 7) {
                sps = addStartCode(nal)
            } else if (type == 8) {
                pps = addStartCode(nal)
            }
        }
        return if (sps != null && pps != null) Pair(sps, pps) else null
    }

    private fun splitAnnexB(data: ByteArray): List<ByteArray> {
        val units = mutableListOf<ByteArray>()
        var index = 0
        var nalStart = -1
        while (index <= data.size - 3) {
            val startCodeLength = when {
                index <= data.size - 4 &&
                    data[index] == 0.toByte() &&
                    data[index + 1] == 0.toByte() &&
                    data[index + 2] == 0.toByte() &&
                    data[index + 3] == 1.toByte() -> 4
                data[index] == 0.toByte() &&
                    data[index + 1] == 0.toByte() &&
                    data[index + 2] == 1.toByte() -> 3
                else -> 0
            }
            if (startCodeLength > 0) {
                if (nalStart >= 0 && nalStart < index) {
                    units.add(data.copyOfRange(nalStart, index))
                }
                index += startCodeLength
                nalStart = index
                continue
            }
            index += 1
        }
        if (nalStart >= 0 && nalStart < data.size) {
            units.add(data.copyOfRange(nalStart, data.size))
        }
        return units
    }

    private fun addStartCode(nal: ByteArray): ByteArray {
        val result = ByteArray(nal.size + 4)
        result[0] = 0
        result[1] = 0
        result[2] = 0
        result[3] = 1
        System.arraycopy(nal, 0, result, 4, nal.size)
        return result
    }
}

