package com.nova.companion

/**
 * Kotlin-side mirror of services/runtime/src/android-companion.ts's
 * AndroidCompanionManager contract, so the on-device permission state
 * machine matches the Primary Runtime's model of it exactly:
 * individually revocable, no bundled grant, and every capability use
 * checked against its declared required permissions at call time.
 *
 * Capability IDs match docs/20-devices/android-companion.md's
 * "Capabilities" section one-to-one.
 */

enum class CompanionPermissionState { GRANTED, REVOKED }

data class CompanionCapability(val capabilityId: String, val requiredPermissions: List<String>)

sealed class CompanionError(val code: String, val message: String) {
    class UnknownPermission(permission: String) :
        CompanionError("NOVA-AI002", "Permission '$permission' is not advertised by this companion.")

    class MissingPermission(capabilityId: String, permission: String) :
        CompanionError(
            "NOVA-SEC001",
            "Capability $capabilityId lacks permission $permission.",
        )

    class BackgroundWithoutForegroundService(capabilityId: String) :
        CompanionError(
            "NOVA-SEC001",
            "Background $capabilityId requires a visible foreground service.",
        )

    /** Network/transport-layer failure talking to companion-server.ts — distinct from a permission denial, which is a local, synchronous decision this app makes about itself. */
    class TransportFailure(reason: String) :
        CompanionError("NOVA-NET001", reason)
}

sealed class CompanionResult<out T> {
    data class Ok<T>(val value: T) : CompanionResult<T>()
    data class Err(val error: CompanionError) : CompanionResult<Nothing>()
}

/** Capabilities advertised by this companion, per android-companion.md. */
object CompanionCapabilities {
    const val NOTIFICATION_ACCESS = "notification_access"
    const val APP_CONTROL = "app_control"
    const val FILE_ACCESS = "file_access"
    const val VISION = "vision"
    const val VOICE = "voice"

    val ALL = listOf(NOTIFICATION_ACCESS, APP_CONTROL, FILE_ACCESS, VISION, VOICE)
}

class CompanionPermissionsManager(
    private val deviceId: String,
    advertisedPermissions: List<String> = CompanionCapabilities.ALL,
) {
    private val permissions = LinkedHashMap<String, CompanionPermissionState>().apply {
        advertisedPermissions.forEach { put(it, CompanionPermissionState.REVOKED) }
    }
    private var foregroundServiceActive = false

    fun grant(permission: String): CompanionResult<Unit> {
        if (!permissions.containsKey(permission)) return CompanionResult.Err(
            CompanionError.UnknownPermission(permission),
        )
        permissions[permission] = CompanionPermissionState.GRANTED
        return CompanionResult.Ok(Unit)
    }

    fun revoke(permission: String): CompanionResult<Unit> {
        if (!permissions.containsKey(permission)) return CompanionResult.Err(
            CompanionError.UnknownPermission(permission),
        )
        permissions[permission] = CompanionPermissionState.REVOKED
        return CompanionResult.Ok(Unit)
    }

    fun permission(permission: String): CompanionPermissionState =
        permissions[permission] ?: CompanionPermissionState.REVOKED

    fun snapshot(): Map<String, CompanionPermissionState> = permissions.toMap()

    fun use(capability: CompanionCapability): CompanionResult<Pair<String, String>> {
        for (required in capability.requiredPermissions) {
            if (permission(required) != CompanionPermissionState.GRANTED) {
                return CompanionResult.Err(
                    CompanionError.MissingPermission(capability.capabilityId, required),
                )
            }
        }
        return CompanionResult.Ok("Available" to deviceId)
    }

    fun startForegroundService() {
        foregroundServiceActive = true
    }

    fun stopForegroundService() {
        foregroundServiceActive = false
    }

    fun isForegroundServiceActive(): Boolean = foregroundServiceActive

    fun startBackground(capabilityId: String): CompanionResult<Unit> {
        if (!foregroundServiceActive) {
            return CompanionResult.Err(CompanionError.BackgroundWithoutForegroundService(capabilityId))
        }
        return CompanionResult.Ok(Unit)
    }
}
