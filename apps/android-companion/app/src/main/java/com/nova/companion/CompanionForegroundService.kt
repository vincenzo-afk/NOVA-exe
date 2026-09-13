package com.nova.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Persistent, user-visible foreground service, per
 * docs/20-devices/android-companion.md "Background operation":
 * "The companion runs a foreground service with a persistent,
 * user-visible notification whenever always-listening voice or
 * background notification capture is active ... there is no hidden
 * background listening mode."
 *
 * This service only controls the visible notification; it does not
 * itself decide when background capture is allowed — that check lives
 * in CompanionPermissionsManager.startBackground, which requires this
 * service to already be running.
 */
class CompanionForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        return START_STICKY
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NOVA Companion active",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shown whenever NOVA is capturing notifications or listening for voice."
            }
            manager?.createNotificationChannel(channel)
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("NOVA Companion is active")
            .setContentText("Background capture is running. Tap to review permissions.")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "nova_companion_active"
        private const val NOTIFICATION_ID = 1001
    }
}
