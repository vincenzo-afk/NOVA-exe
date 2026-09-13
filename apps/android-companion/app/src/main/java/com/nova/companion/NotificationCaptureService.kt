package com.nova.companion

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Notification-access capability (docs/20-devices/android-companion.md):
 * "incoming notifications are structured and made available to the
 * Primary Runtime as an observer source, following the same
 * observer-framework pattern as docs/07-observers/notifications.md
 * (desktop)."
 *
 * Android only delivers callbacks here once the user has separately
 * granted Notification Listener access in system settings — declaring
 * the service in the manifest does not by itself enable capture, which
 * keeps this consistent with the individually-revocable permission
 * model in CompanionPermissionsManager. This class only normalizes the
 * platform event into the same metadata-vs-content split the desktop
 * notifications observer uses; delivery to the Primary Runtime is the
 * transport layer's responsibility (docs/28-multi-device-protocol),
 * not this class's.
 */
class NotificationCaptureService : NotificationListenerService() {

    data class NormalizedNotification(
        val packageName: String,
        val postedAt: Long,
        val category: String?,
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Metadata-only normalization, mirroring the desktop observer's
        // metadata/content split — no notification body/text is read
        // here, only routing metadata.
        NormalizedNotification(
            packageName = sbn.packageName,
            postedAt = sbn.postTime,
            category = sbn.notification?.category,
        )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // No-op: removal events are not currently forwarded.
    }
}
