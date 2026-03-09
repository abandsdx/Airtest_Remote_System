package com.nuwarobotics.SuperRescuer

import android.content.Context

object DeviceConfig {
    private const val PREFS = "rider_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_SHARED_KEY = "shared_key"
    private const val KEY_PROJECTION_GRANTED = "projection_granted"
    private const val KEY_STORAGE_TREE_URI = "storage_tree_uri"
    private const val KEY_SAF_NEEDED = "saf_needed"

    private const val DEFAULT_SERVER_URL = "https://fleetmind.duckdns.org"
    private const val DEFAULT_SHARED_KEY = "rider-dev-key"

    fun getServerUrl(context: Context): String {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
    }

    fun setServerUrl(context: Context, value: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, value)
            .apply()
    }

    fun getSharedKey(context: Context): String {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SHARED_KEY, DEFAULT_SHARED_KEY) ?: DEFAULT_SHARED_KEY
    }

    fun setSharedKey(context: Context, value: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SHARED_KEY, value)
            .apply()
    }

    fun isProjectionGranted(context: Context): Boolean {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_PROJECTION_GRANTED, false)
    }

    fun setProjectionGranted(context: Context, granted: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PROJECTION_GRANTED, granted)
            .apply()
    }

    fun getStorageTreeUri(context: Context): String? {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_STORAGE_TREE_URI, null)
    }

    fun setStorageTreeUri(context: Context, value: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_STORAGE_TREE_URI, value)
            .apply()
    }

    fun isSafNeeded(context: Context): Boolean {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_SAF_NEEDED, false)
    }

    fun setSafNeeded(context: Context, needed: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SAF_NEEDED, needed)
            .apply()
    }
}

