package com.nuwarobotics.SuperRescuer

import org.json.JSONObject

object ControlDispatcher {
    private var service: RiderAccessibilityService? = null

    fun bind(accessibilityService: RiderAccessibilityService) {
        service = accessibilityService
    }

    fun unbind(accessibilityService: RiderAccessibilityService) {
        if (service === accessibilityService) {
            service = null
        }
    }

    fun handleControl(message: JSONObject) {
        val action = message.optString("action")
        val target = service ?: return
        when (action) {
            "tap" -> {
                val x = message.optDouble("x", 0.0).toFloat()
                val y = message.optDouble("y", 0.0).toFloat()
                target.performTap(x, y)
            }
            "swipe" -> {
                val x1 = message.optDouble("x1", 0.0).toFloat()
                val y1 = message.optDouble("y1", 0.0).toFloat()
                val x2 = message.optDouble("x2", 0.0).toFloat()
                val y2 = message.optDouble("y2", 0.0).toFloat()
                val duration = message.optLong("durationMs", 300L)
                target.performSwipe(x1, y1, x2, y2, duration)
            }
            "key" -> {
                val key = message.optString("key")
                target.performKey(key)
            }
        }
    }
}

