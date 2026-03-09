package com.nuwarobotics.SuperRescuer

import java.nio.ByteBuffer
import java.nio.ByteOrder

object FramePacker {
    // Scrcpy-like framing: config packet + frame metadata (pts/flags/size) + Annex-B payload.
    private const val MSG_SCREEN_CONFIG: Byte = 1
    private const val MSG_SCREEN_FRAME: Byte = 2
    private const val MSG_CAMERA_CONFIG: Byte = 3
    private const val MSG_CAMERA_FRAME: Byte = 4
    private const val MSG_AUDIO_CONFIG: Byte = 5
    private const val MSG_AUDIO_FRAME: Byte = 6

    private const val FLAG_KEY_FRAME: Long = 1L shl 62

    fun buildScreenConfig(codecId: Int, width: Int, height: Int, sps: ByteArray, pps: ByteArray): ByteArray {
        return buildVideoConfig(MSG_SCREEN_CONFIG, codecId, width, height, sps, pps)
    }

    fun buildCameraConfig(codecId: Int, width: Int, height: Int, sps: ByteArray, pps: ByteArray): ByteArray {
        return buildVideoConfig(MSG_CAMERA_CONFIG, codecId, width, height, sps, pps)
    }

    private fun buildVideoConfig(type: Byte, codecId: Int, width: Int, height: Int, sps: ByteArray, pps: ByteArray): ByteArray {
        val size = 1 + 4 + 4 + 4 + 2 + 2 + sps.size + pps.size
        val buffer = ByteBuffer.allocate(size).order(ByteOrder.BIG_ENDIAN)
        buffer.put(type)
        buffer.putInt(codecId)
        buffer.putInt(width)
        buffer.putInt(height)
        buffer.putShort(sps.size.toShort())
        buffer.putShort(pps.size.toShort())
        buffer.put(sps)
        buffer.put(pps)
        return buffer.array()
    }

    fun buildScreenFrame(ptsUs: Long, keyFrame: Boolean, payload: ByteArray): ByteArray {
        return buildVideoFrame(MSG_SCREEN_FRAME, ptsUs, keyFrame, payload)
    }

    fun buildCameraFrame(ptsUs: Long, keyFrame: Boolean, payload: ByteArray): ByteArray {
        return buildVideoFrame(MSG_CAMERA_FRAME, ptsUs, keyFrame, payload)
    }

    private fun buildVideoFrame(type: Byte, ptsUs: Long, keyFrame: Boolean, payload: ByteArray): ByteArray {
        val size = 1 + 8 + 4 + payload.size
        val buffer = ByteBuffer.allocate(size).order(ByteOrder.BIG_ENDIAN)
        var ptsAndFlags = ptsUs
        if (keyFrame) {
            ptsAndFlags = ptsAndFlags or FLAG_KEY_FRAME
        }
        buffer.put(type)
        buffer.putLong(ptsAndFlags)
        buffer.putInt(payload.size)
        buffer.put(payload)
        return buffer.array()
    }

    fun buildAudioConfig(sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
        val buffer = ByteBuffer.allocate(1 + 4 + 2 + 2).order(ByteOrder.BIG_ENDIAN)
        buffer.put(MSG_AUDIO_CONFIG)
        buffer.putInt(sampleRate)
        buffer.putShort(channels.toShort())
        buffer.putShort(bitsPerSample.toShort())
        return buffer.array()
    }

    fun buildAudioFrame(ptsUs: Long, payload: ByteArray): ByteArray {
        val size = 1 + 8 + 4 + payload.size
        val buffer = ByteBuffer.allocate(size).order(ByteOrder.BIG_ENDIAN)
        buffer.put(MSG_AUDIO_FRAME)
        buffer.putLong(ptsUs)
        buffer.putInt(payload.size)
        buffer.put(payload)
        return buffer.array()
    }

    fun ensureAnnexB(data: ByteArray): ByteArray {
        if (data.size >= 3 && data[0] == 0.toByte() && data[1] == 0.toByte()) {
            if (data[2] == 1.toByte()) {
                return data
            }
            if (data.size >= 4 && data[2] == 0.toByte() && data[3] == 1.toByte()) {
                return data
            }
        }
        return convertLengthPrefixed(data)
    }

    private fun convertLengthPrefixed(data: ByteArray): ByteArray {
        val out = ArrayList<Byte>()
        var offset = 0
        while (offset + 4 <= data.size) {
            val length = ((data[offset].toInt() and 0xff) shl 24) or
                ((data[offset + 1].toInt() and 0xff) shl 16) or
                ((data[offset + 2].toInt() and 0xff) shl 8) or
                (data[offset + 3].toInt() and 0xff)
            offset += 4
            if (length <= 0 || offset + length > data.size) {
                break
            }
            out.add(0)
            out.add(0)
            out.add(0)
            out.add(1)
            for (i in 0 until length) {
                out.add(data[offset + i])
            }
            offset += length
        }
        return out.toByteArray()
    }
}

