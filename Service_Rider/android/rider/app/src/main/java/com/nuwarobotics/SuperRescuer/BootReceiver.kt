package com.nuwarobotics.SuperRescuer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) {
            Log.d("RiderBoot", "Received non-boot intent: ${intent?.action}")
            return
        }
        
        Log.d("RiderBoot", "Boot completed, initializing service")
        
        try {
            DeviceConfig.setProjectionGranted(context, false)
            Log.d("RiderBoot", "Projection permission reset successfully")
            
            RiderStreamService.connect(context)
            Log.d("RiderBoot", "Service started successfully")
        } catch (e: Exception) {
            Log.e("RiderBoot", "Failed to start service on boot", e)
        }
    }
}

