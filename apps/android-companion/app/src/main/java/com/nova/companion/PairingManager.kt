package com.nova.companion

import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * Device pairing per docs/28-multi-device-protocol/02-device-pairing-protocol.md:
 * Desktop renders a QR containing (pairing code, Desktop public key,
 * short-lived channel token) -> Mobile scans it -> Mobile verifies a
 * signed challenge/response against that embedded public key before
 * trusting the pairing. "Simply scanning a QR code is not sufficient
 * to establish trust" — the signature check below is the hard
 * requirement the doc calls out (FM-26-006), not optional.
 *
 * Uses the platform's built-in EC (secp256r1) signature support rather
 * than a bundled crypto library, since no additional dependency is
 * required for it to be a real signature check.
 */

data class PairingQrPayload(
    val pairingCode: String,
    val desktopPublicKeyB64: String,
    val channelToken: String,
    val expiresAtEpochMs: Long,
)

sealed class PairingOutcome {
    data class Paired(val deviceId: String, val desktopPublicKey: PublicKey) : PairingOutcome()
    data class Rejected(val reason: String) : PairingOutcome()
}

class PairingManager(private val mobileKeyPair: KeyPair = generateKeyPair()) {

    /** Parses the QR payload. Expected format: `code|desktopPubKeyB64|token|expiresAtMs`. */
    fun parseQrPayload(raw: String): PairingQrPayload? {
        val parts = raw.split("|")
        if (parts.size != 4) return null
        val expiresAt = parts[3].toLongOrNull() ?: return null
        return PairingQrPayload(parts[0], parts[1], parts[2], expiresAt)
    }

    /**
     * Verifies the challenge/response signature before trusting the
     * pairing. [challenge] is the nonce sent to the desktop over the
     * short-lived channel; [signature] is the desktop's signature over
     * it, produced with the private key matching [payload]'s embedded
     * public key (FM-26-006's non-optional check).
     */
    fun completePairing(
        payload: PairingQrPayload,
        challenge: ByteArray,
        signature: ByteArray,
        nowEpochMs: Long,
    ): PairingOutcome {
        if (nowEpochMs > payload.expiresAtEpochMs) {
            return PairingOutcome.Rejected("Pairing code expired — request a fresh QR code.")
        }
        val desktopKey = decodePublicKey(payload.desktopPublicKeyB64)
            ?: return PairingOutcome.Rejected("Malformed desktop public key in QR payload.")

        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(desktopKey)
        verifier.update(challenge)
        val valid = try {
            verifier.verify(signature)
        } catch (_: Exception) {
            false
        }
        if (!valid) {
            return PairingOutcome.Rejected("Challenge/response signature verification failed.")
        }
        return PairingOutcome.Paired(deviceId = payload.pairingCode, desktopPublicKey = desktopKey)
    }

    fun generateChallenge(): ByteArray {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes
    }

    fun mobilePublicKeyB64(): String = Base64.getEncoder().encodeToString(mobileKeyPair.public.encoded)

    private fun decodePublicKey(b64: String): PublicKey? = try {
        val bytes = Base64.getDecoder().decode(b64)
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes))
    } catch (_: Exception) {
        null
    }

    companion object {
        fun generateKeyPair(): KeyPair {
            val generator = KeyPairGenerator.getInstance("EC")
            generator.initialize(ECGenParameterSpec("secp256r1"))
            return generator.generateKeyPair()
        }
    }
}
