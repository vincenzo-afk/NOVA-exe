package com.nova.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Behavior parity checks against services/runtime/test/android-companion
 * -style expectations: unknown permissions are rejected, grants/revokes
 * are per-key, capability use is denied until every required permission
 * is granted, and background use requires an active foreground service.
 */
class CompanionPermissionsManagerTest {

    @Test
    fun `rejects grant for an unadvertised permission`() {
        val manager = CompanionPermissionsManager("device-1", listOf(CompanionCapabilities.VOICE))
        val result = manager.grant("not_advertised")
        assertTrue(result is CompanionResult.Err)
    }

    @Test
    fun `revoking one permission does not affect another`() {
        val manager = CompanionPermissionsManager("device-1")
        manager.grant(CompanionCapabilities.NOTIFICATION_ACCESS)
        manager.grant(CompanionCapabilities.VOICE)

        manager.revoke(CompanionCapabilities.NOTIFICATION_ACCESS)

        assertEquals(CompanionPermissionState.REVOKED, manager.permission(CompanionCapabilities.NOTIFICATION_ACCESS))
        assertEquals(CompanionPermissionState.GRANTED, manager.permission(CompanionCapabilities.VOICE))
    }

    @Test
    fun `use is denied until every required permission is granted`() {
        val manager = CompanionPermissionsManager("device-1")
        val capability = CompanionCapability(
            "vision.point_and_ask",
            listOf(CompanionCapabilities.VISION, CompanionCapabilities.VOICE),
        )

        assertTrue(manager.use(capability) is CompanionResult.Err)

        manager.grant(CompanionCapabilities.VISION)
        assertTrue(manager.use(capability) is CompanionResult.Err)

        manager.grant(CompanionCapabilities.VOICE)
        val result = manager.use(capability)
        assertTrue(result is CompanionResult.Ok)
    }

    @Test
    fun `background capability requires an active foreground service`() {
        val manager = CompanionPermissionsManager("device-1")

        assertTrue(manager.startBackground(CompanionCapabilities.VOICE) is CompanionResult.Err)

        manager.startForegroundService()
        assertTrue(manager.startBackground(CompanionCapabilities.VOICE) is CompanionResult.Ok)

        manager.stopForegroundService()
        assertTrue(manager.startBackground(CompanionCapabilities.VOICE) is CompanionResult.Err)
    }
}
