package com.nova.companion

import java.util.Base64
import org.json.JSONObject

/**
 * The missing transport half of pairing: `PairingManager.kt` already
 * verifies a challenge/response signature correctly — what it never
 * had was a way to actually get that challenge to the desktop and the
 * signature back. This class runs the full exchange described in
 * docs/28-multi-device-protocol/02-device-pairing-protocol.md against
 * companion-server.ts's real endpoints:
 *
 * 1. `sign-challenge` — send a freshly generated nonce, get back the
 *    desktop's signature over it.
 * 2. Verify that signature locally via the existing, unmodified
 *    `PairingManager.completePairing` — the actual trust decision
 *    still happens entirely on-device, this class only supplies it
 *    with real data instead of test doubles.
 * 3. `pair/complete` — register this device as trusted and receive
 *    the bearer token + derive the shared session key every later
 *    request (sync, commands, vision) authenticates and encrypts with.
 */

data class PairingSession(
    val deviceId: String,
    val bearerToken: String,
    val sessionKey: ByteArray,
    val desktopBaseUrl: String,
)

sealed class PairingTransportOutcome {
    data class Success(val session: PairingSession) : PairingTransportOutcome()
    data class Failure(val reason: String) : PairingTransportOutcome()
}

class PairingTransport(private val pairingManager: PairingManager) {

    suspend fun pairFromQr(rawQrPayload: String, thisDeviceId: String, runtimeMode: String = "Companion"): PairingTransportOutcome {
        val payload = pairingManager.parseQrPayload(rawQrPayload)
            ?: return PairingTransportOutcome.Failure("QR payload is malformed or missing a field.")

        val client = CompanionApiClient(payload.desktopBaseUrl) { null } // Pairing endpoints are unauthenticated by design — no session token exists yet.
        val challenge = pairingManager.generateChallenge()

        val signResponse = client.postJson(
            "/v1/companion/pair/sign-challenge",
            JSONObject()
                .put("code", payload.pairingCode)
                .put("channel_token", payload.channelToken)
                .put("challenge_b64", Base64.getEncoder().encodeToString(challenge))
                .toString(),
            requireAuth = false,
        )
        val signatureB64 = when (signResponse) {
            is CompanionResult.Err -> return PairingTransportOutcome.Failure(
                "Could not reach the desktop to sign the pairing challenge: ${signResponse.error.message}",
            )
            is CompanionResult.Ok -> JSONObject(signResponse.value).optString("signature_b64", "")
        }
        if (signatureB64.isEmpty()) {
            return PairingTransportOutcome.Failure("Desktop did not return a challenge signature.")
        }

        val localOutcome = pairingManager.completePairing(
            payload,
            challenge,
            Base64.getDecoder().decode(signatureB64),
            System.currentTimeMillis(),
        )
        when (localOutcome) {
            is PairingOutcome.Rejected -> return PairingTransportOutcome.Failure(localOutcome.reason)
            is PairingOutcome.Paired -> Unit // Local trust established — desktopPublicKey isn't needed further here since payload.desktopPublicKeyB64 (already verified above) is what session-key derivation uses.
        }

        val sessionKey = CompanionCrypto.deriveSessionKey(
            ownPrivateKeyB64 = pairingManager.mobilePrivateKeyB64(),
            peerPublicKeyB64 = payload.desktopPublicKeyB64,
        )

        val completeRequest = JSONObject()
            .put("device_id", thisDeviceId)
            .put("device_public_key", pairingManager.mobilePublicKeyB64())
            .put("challenge", Base64.getEncoder().encodeToString(challenge))
            .put("signature", signatureB64)
            .put("runtime_mode", runtimeMode)
            .put("confirmed", true)
        val completeResponse = client.postJson(
            "/v1/companion/pair/complete",
            JSONObject().put("code", payload.pairingCode).put("request", completeRequest).toString(),
            requireAuth = false,
        )
        val token = when (completeResponse) {
            is CompanionResult.Err -> return PairingTransportOutcome.Failure(
                "Desktop rejected the pairing registration: ${completeResponse.error.message}",
            )
            is CompanionResult.Ok -> JSONObject(completeResponse.value).optString("token", "")
        }
        if (token.isEmpty()) {
            return PairingTransportOutcome.Failure("Desktop did not return a session token.")
        }

        // Local trust in the desktop was already established by pairingManager.completePairing
        // above (step 2) before this registration call was ever sent.
        return PairingTransportOutcome.Success(
            PairingSession(
                deviceId = thisDeviceId,
                bearerToken = token,
                sessionKey = sessionKey,
                desktopBaseUrl = payload.desktopBaseUrl,
            ),
        )
    }
}
