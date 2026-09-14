package com.nova.companion

/**
 * Holds the current device's [PairingSession] (if any) in memory for
 * the app process's lifetime, and exposes a ready-to-use
 * [CompanionApiClient] built from it. This is intentionally
 * process-memory-only, not persisted to disk — a restart requires
 * re-pairing rather than silently resuming trust from a stored
 * secret, consistent with `docs/10-security/secrets.md`'s general
 * caution around persisting session key material. Persisting a
 * pairing (so the app doesn't need re-pairing after every restart) is
 * a real, separate piece of future work — deliberately not implied
 * to already exist by this holder's presence.
 */
object CompanionSessionHolder {
    @Volatile
    var session: PairingSession? = null
        private set

    fun set(newSession: PairingSession) {
        session = newSession
    }

    fun clear() {
        session = null
    }

    fun apiClient(): CompanionApiClient? {
        val current = session ?: return null
        return CompanionApiClient(current.desktopBaseUrl) { session?.bearerToken }
    }
}
