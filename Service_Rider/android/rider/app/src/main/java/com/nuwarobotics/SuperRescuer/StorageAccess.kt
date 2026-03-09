package com.nuwarobotics.SuperRescuer

import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract

object StorageAccess {
    private const val PRIMARY_TREE_URI = "content://com.android.externalstorage.documents/tree/primary%3A"

    fun primaryTreeUri(): Uri? {
        return try {
            Uri.parse(PRIMARY_TREE_URI)
        } catch (_: Exception) {
            null
        }
    }

    fun treeUriToPath(uri: Uri): String? {
        val docId = try {
            DocumentsContract.getTreeDocumentId(uri)
        } catch (_: Exception) {
            null
        } ?: return null

        val parts = docId.split(":", limit = 2)
        if (parts.isEmpty()) {
            return null
        }

        val volume = parts[0]
        val relative = if (parts.size > 1) parts[1] else ""
        val base = if (volume == "primary") {
            @Suppress("DEPRECATION")
            Environment.getExternalStorageDirectory().absolutePath
        } else {
            "/storage/$volume"
        }

        val normalizedBase = normalizePath(base)
        val normalizedRelative = relative.trimStart('/')
        return if (normalizedRelative.isBlank()) {
            normalizedBase
        } else {
            "$normalizedBase/$normalizedRelative"
        }
    }

    fun normalizePath(path: String): String {
        return if (path.length > 1) path.trimEnd('/') else path
    }
}
