package com.nuwarobotics.SuperRescuer

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.DisplayMetrics
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.WindowManager

class RiderAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d("RiderAccessibility", "Service connected")
        ControlDispatcher.bind(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // No-op: control only.
    }

    override fun onInterrupt() {
        Log.d("RiderAccessibility", "onInterrupt")
    }

    override fun onDestroy() {
        super.onDestroy()
        ControlDispatcher.unbind(this)
    }

    fun performTap(xNorm: Float, yNorm: Float) {
        val (x, y) = resolvePoint(xNorm, yNorm)
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun performSwipe(x1Norm: Float, y1Norm: Float, x2Norm: Float, y2Norm: Float, durationMs: Long) {
        val (x1, y1) = resolvePoint(x1Norm, y1Norm)
        val (x2, y2) = resolvePoint(x2Norm, y2Norm)
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        dispatchGesture(gesture, null, null)
    }

    fun performKey(action: String) {
        when (action) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "lock" -> {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
                }
            }
            "power-menu" -> {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    performGlobalAction(GLOBAL_ACTION_POWER_DIALOG)
                }
            }
            else -> Log.d("RiderAccessibility", "Unknown key: $action")
        }
    }

    private fun resolvePoint(xNorm: Float, yNorm: Float): Pair<Float, Float> {
        val width: Int
        val height: Int
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
            val bounds = windowManager.currentWindowMetrics.bounds
            width = bounds.width()
            height = bounds.height()
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            display?.getRealMetrics(metrics) ?: metrics.setTo(resources.displayMetrics)
            width = metrics.widthPixels
            height = metrics.heightPixels
        }
        val x = (xNorm.coerceIn(0f, 1f) * width)
        val y = (yNorm.coerceIn(0f, 1f) * height)
        return x to y
    }
}

