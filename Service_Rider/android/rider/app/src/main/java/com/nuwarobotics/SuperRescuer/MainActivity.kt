package com.nuwarobotics.SuperRescuer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.storage.StorageManager
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.nuwarobotics.SuperRescuer.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        Log.d("RiderStream", "Projection result: code=${result.resultCode} hasData=${result.data != null}")
        if (result.resultCode == RESULT_OK && result.data != null) {
            DeviceConfig.setProjectionGranted(this, true)
            RiderStreamService.cacheProjection(this, result.resultCode, result.data!!)
            updatePermissionStatus()
            Toast.makeText(this, "Screen permission granted", Toast.LENGTH_SHORT).show()
        } else {
            DeviceConfig.setProjectionGranted(this, false)
            updatePermissionStatus()
            Toast.makeText(this, "Screen capture permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != RiderStreamService.ACTION_STATUS) {
                return
            }
            val streaming = intent.getBooleanExtra(RiderStreamService.EXTRA_STREAMING, false)
            val connected = intent.getBooleanExtra(RiderStreamService.EXTRA_CONNECTED, false)
            val camera = intent.getBooleanExtra(RiderStreamService.EXTRA_CAMERA, false)
            val mic = intent.getBooleanExtra(RiderStreamService.EXTRA_MIC, false)
            binding.connectionText.text = "Streaming: ${if (streaming) "On" else "Off"} | Camera: ${if (camera) "On" else "Off"} | Mic: ${if (mic) "On" else "Off"} | Server: ${if (connected) "Connected" else "Disconnected"}"
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            updatePermissionStatus()
        } else {
            Toast.makeText(this, "Camera permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            updatePermissionStatus()
        } else {
            Toast.makeText(this, "Microphone permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    private val storagePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            updatePermissionStatus()
        } else {
            Toast.makeText(this, "Storage permission denied", Toast.LENGTH_SHORT).show()
        }
    }

    private val multiPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        updatePermissionStatus()
        val allGranted = results.values.all { it }
        if (allGranted) {
            Toast.makeText(this, "Basic permissions granted", Toast.LENGTH_SHORT).show()
        }
        // Continue with permissions that require special handling
        continueGrantAll()
    }

    private val manageStorageLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        if (isStoragePermissionGranted()) {
            Toast.makeText(this, "File access granted", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "File access not granted", Toast.LENGTH_SHORT).show()
        }
        updatePermissionStatus()
    }

    private val storageFolderLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != RESULT_OK) {
            Toast.makeText(this, "Folder access not selected", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        val uri = result.data?.data
        if (uri == null) {
            Toast.makeText(this, "Folder access not selected", Toast.LENGTH_SHORT).show()
            return@registerForActivityResult
        }
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            val rootPath = StorageAccess.treeUriToPath(uri)
            if (rootPath == null || !isEmulatedRootPath(rootPath)) {
                Log.w("RiderStorage", "Invalid storage path selected: $rootPath")
                Toast.makeText(this, "Select Internal storage (root) only", Toast.LENGTH_SHORT).show()
                return@registerForActivityResult
            }
            contentResolver.takePersistableUriPermission(uri, flags)
            DeviceConfig.setStorageTreeUri(this, uri.toString())
            DeviceConfig.setSafNeeded(this, false)
            Log.d("RiderStorage", "Folder access granted: $rootPath")
            Toast.makeText(this, "Folder access saved", Toast.LENGTH_SHORT).show()
        } catch (e: SecurityException) {
            Log.e("RiderStorage", "Security exception when granting folder access", e)
            Toast.makeText(this, "Permission denied", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e("RiderStorage", "Failed to grant folder access", e)
            Toast.makeText(this, "Folder access failed: ${e.message}", Toast.LENGTH_SHORT).show()
        }
        updatePermissionStatus()
    }

    private var promptedPermissions = false
    private var promptedAccessibility = false
    private var promptedStorageFolder = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val initialUrl = DeviceConfig.getServerUrl(this)
        binding.serverText.text = "Server: $initialUrl"
        binding.serverUrlInput.setText(initialUrl)

        binding.titleText.setOnLongClickListener {
            if (binding.serverConfigCard.visibility == View.VISIBLE) {
                binding.serverConfigCard.visibility = View.GONE
                Toast.makeText(this, "Server settings hidden", Toast.LENGTH_SHORT).show()
            } else {
                binding.serverConfigCard.visibility = View.VISIBLE
                Toast.makeText(this, "Server settings unlocked", Toast.LENGTH_SHORT).show()
            }
            true
        }

        binding.saveConfigButton.setOnClickListener {
            val nextUrl = binding.serverUrlInput.text.toString().trim().trimEnd('/')
            if (nextUrl.isEmpty()) {
                Toast.makeText(this, "Server URL is required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            DeviceConfig.setServerUrl(this, nextUrl)
            binding.serverText.text = "Server: $nextUrl"
            binding.serverUrlInput.setText(nextUrl)
            Toast.makeText(this, "Server URL saved", Toast.LENGTH_SHORT).show()
        }
        binding.enableServiceButton.setOnClickListener {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            startActivity(intent)
        }

        binding.connectButton.setOnClickListener {
            RiderStreamService.connect(this)
        }

        binding.grantScreenButton.setOnClickListener {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projectionLauncher.launch(manager.createScreenCaptureIntent())
        }

        binding.requestCameraButton.setOnClickListener {
            requestCameraPermission()
        }

        binding.requestMicButton.setOnClickListener {
            requestMicPermission()
        }

        binding.requestStorageButton.setOnClickListener {
            requestStoragePermission()
        }

        binding.grantAllButton.setOnClickListener {
            grantAllPermissions()
        }

        handleSafIntent(intent, force = false)
    }

    override fun onStart() {
        super.onStart()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                statusReceiver,
                IntentFilter(RiderStreamService.ACTION_STATUS),
                Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(statusReceiver, IntentFilter(RiderStreamService.ACTION_STATUS))
        }
    }

    override fun onStop() {
        unregisterReceiver(statusReceiver)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        updateServiceStatus()
        updatePermissionStatus()
        binding.serverText.text = "Server: ${DeviceConfig.getServerUrl(this)}"
        requestStartupPermissions()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleSafIntent(intent, force = true)
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val service = packageName + "/" + RiderAccessibilityService::class.java.canonicalName
        val accessibilityEnabled =
            try {
                Settings.Secure.getInt(
                    applicationContext.contentResolver,
                    Settings.Secure.ACCESSIBILITY_ENABLED
                )
            } catch (e: Settings.SettingNotFoundException) {
                0
            }

        if (accessibilityEnabled == 1) {
            val settingValue = Settings.Secure.getString(
                applicationContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            )
            if (settingValue != null) {
                val splitter = TextUtils.SimpleStringSplitter(':')
                splitter.setString(settingValue)
                while (splitter.hasNext()) {
                    if (splitter.next().equals(service, ignoreCase = true)) {
                        return true
                    }
                }
            }
        }
        return false
    }

    private fun updateServiceStatus() {
        if (isAccessibilityServiceEnabled()) {
            binding.statusText.text = "Accessibility: Enabled"
            binding.enableServiceButton.isEnabled = false
        } else {
            binding.statusText.text = "Accessibility: Disabled"
            binding.enableServiceButton.isEnabled = true
        }
    }

    private fun updatePermissionStatus() {
        val cameraGranted = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val micGranted = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val screenGranted = DeviceConfig.isProjectionGranted(this)
        val storageGranted = isStoragePermissionGranted()
        val safGranted = hasSafAccess()

        binding.cameraPermissionText.text = "Camera Permission: ${if (cameraGranted) "Granted" else "Missing"}"
        binding.micPermissionText.text = "Mic Permission: ${if (micGranted) "Granted" else "Missing"}"
        binding.screenPermissionText.text = "Screen Permission: ${if (screenGranted) "Granted (this session)" else "Missing"}"
        binding.storagePermissionText.text = "File Access: ${if (storageGranted || safGranted) "Granted" else "Missing"}"
    }

    private fun requestStartupPermissions() {
        if (!promptedPermissions) {
            promptedPermissions = true
            requestCameraPermission()
            requestMicPermission()
            requestStoragePermission()
        }
        if (!promptedStorageFolder && shouldRequestSaf()) {
            promptedStorageFolder = true
            openStorageFolderPicker()
        }
        if (!promptedAccessibility && !isAccessibilityServiceEnabled()) {
            promptedAccessibility = true
            Toast.makeText(this, "Enable Accessibility for remote control", Toast.LENGTH_SHORT).show()
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            startActivity(intent)
        }
    }

    private var grantAllPending = false

    private fun grantAllPermissions() {
        // Collect runtime permissions that are not yet granted
        val needed = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            needed.add(android.Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            needed.add(android.Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                needed.add(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
        }

        grantAllPending = true

        if (needed.isNotEmpty()) {
            multiPermissionLauncher.launch(needed.toTypedArray())
        } else {
            // All basic permissions already granted, continue with special ones
            continueGrantAll()
        }
    }

    private fun continueGrantAll() {
        if (!grantAllPending) return
        grantAllPending = false

        // Handle MANAGE_EXTERNAL_STORAGE for Android 11+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            requestStoragePermission()
        } else if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            DeviceConfig.setSafNeeded(this, false)
        }

        // Screen capture permission
        if (!DeviceConfig.isProjectionGranted(this)) {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projectionLauncher.launch(manager.createScreenCaptureIntent())
        }

        // Accessibility
        if (!isAccessibilityServiceEnabled()) {
            Toast.makeText(this, "Please enable Accessibility service", Toast.LENGTH_SHORT).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        updatePermissionStatus()
    }

    private fun requestCameraPermission() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED) {
            updatePermissionStatus()
        } else {
            cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    private fun requestMicPermission() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED) {
            updatePermissionStatus()
        } else {
            micPermissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun isStoragePermissionGranted(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            // Android 10 (Q) and below: need both READ and WRITE with requestLegacyExternalStorage
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestStoragePermission() {
        if (isStoragePermissionGranted()) {
            // Android 10 and below: using legacy storage, no SAF needed
            // Android 11+: using MANAGE_EXTERNAL_STORAGE, no SAF needed
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager())
            ) {
                DeviceConfig.setSafNeeded(this, false)
            }
            updatePermissionStatus()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val appIntent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                data = Uri.parse("package:$packageName")
            }
            try {
                manageStorageLauncher.launch(appIntent)
            } catch (_: Exception) {
                val fallbackIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                try {
                    manageStorageLauncher.launch(fallbackIntent)
                } catch (_: Exception) {
                    Toast.makeText(this, "Cannot open file access settings", Toast.LENGTH_SHORT).show()
                }
            }
            return
        }

        // WRITE_EXTERNAL_STORAGE implies READ_EXTERNAL_STORAGE on Android <= Q
        storagePermissionLauncher.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
    }

    private fun hasSafAccess(): Boolean {
        return !DeviceConfig.getStorageTreeUri(this).isNullOrBlank()
    }

    private fun shouldRequestSaf(): Boolean {
        if (hasSafAccess()) {
            return false
        }
        // Android 9 and below: no SAF needed, use traditional permissions
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return false
        }
        // Android 10 (Q): use requestLegacyExternalStorage, no SAF needed
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            return false
        }
        // Android 11+: use MANAGE_EXTERNAL_STORAGE, no SAF needed if granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
            return false
        }
        return DeviceConfig.isSafNeeded(this)
    }

    private fun handleSafIntent(intent: Intent?, force: Boolean) {
        val requestSaf = intent?.getBooleanExtra(RiderStreamService.EXTRA_REQUEST_SAF, false) ?: false
        if (requestSaf && force) {
            DeviceConfig.setSafNeeded(this, true)
        }
        if (force && requestSaf) {
            promptedStorageFolder = false
        }

        if (requestSaf && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            requestStoragePermission()
            return
        }

        if (!promptedStorageFolder && shouldRequestSaf()) {
            promptedStorageFolder = true
            openStorageFolderPicker()
        }
    }

    private fun openStorageFolderPicker() {
        val intent = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> {
                val storageManager = getSystemService(StorageManager::class.java)
                storageManager.primaryStorageVolume.createOpenDocumentTreeIntent()
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> {
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    StorageAccess.primaryTreeUri()?.let {
                        putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI, it)
                    }
                }
            }
            else -> Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        }
        storageFolderLauncher.launch(intent)
    }

    private fun isEmulatedRootPath(path: String): Boolean {
        val normalized = StorageAccess.normalizePath(path)
        val userId = android.os.Process.myUid() / 100000
        if (normalized == "/sdcard" || normalized == "/storage/self/primary") {
            return true
        }
        if (userId >= 0 && normalized == "/storage/emulated/$userId") {
            return true
        }
        return normalized == "/storage/emulated/0"
    }
}

