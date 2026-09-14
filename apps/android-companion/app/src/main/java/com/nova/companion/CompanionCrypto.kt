package com.nova.companion

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random

/**
 * Mirrors services/runtime/src/companion-crypto.ts exactly — same
 * curve (secp256r1 / prime256v1, same curve under two names), same
 * key encodings (X.509/SPKI for public, PKCS8 for private — Java's
 * default `PublicKey.encoded` / `PrivateKey.encoded` output for "EC"
 * keys already IS this format, so no conversion step exists on this
 * side either), same ECDH + HKDF-SHA256 + AES-256-GCM pipeline. Two
 * independently-written implementations of the same protocol, in two
 * languages, deriving byte-identical session keys — this is what
 * makes the pairing key `PairingManager.kt` already generates usable
 * for post-pairing transport encryption too, not just the
 * challenge/response signature it already verifies.
 */

data class EncryptedEnvelope(val ivB64: String, val ciphertextB64: String, val tagB64: String)

object CompanionCrypto {

    fun decodePublicKey(b64: String): PublicKey {
        val bytes = Base64.getDecoder().decode(b64)
        return KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes))
    }

    fun decodePrivateKey(b64: String): PrivateKey {
        val bytes = Base64.getDecoder().decode(b64)
        return KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(bytes))
    }

    /**
     * Derives the same AES-256-GCM session key the desktop derives
     * via `deriveSessionKey` in companion-crypto.ts, from this
     * device's own EC private key and the peer's EC public key.
     */
    fun deriveSessionKey(ownPrivateKeyB64: String, peerPublicKeyB64: String): ByteArray {
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(decodePrivateKey(ownPrivateKeyB64))
        agreement.doPhase(decodePublicKey(peerPublicKeyB64), true)
        val sharedSecret = agreement.generateSecret()
        return hkdfSha256(sharedSecret, "nova-companion-session-v1", 32)
    }

    /** RFC 5869 HKDF-Extract-and-Expand via HMAC-SHA256 — byte-for-byte the same construction as companion-crypto.ts's hkdfSha256. */
    private fun hkdfSha256(inputKeyMaterial: ByteArray, info: String, lengthBytes: Int): ByteArray {
        val salt = ByteArray(32) // Fixed zero salt — no salt is exchanged out-of-band, matching the desktop side exactly.
        val prk = hmacSha256(salt, inputKeyMaterial)
        val infoBytes = info.toByteArray(Charsets.UTF_8)
        var previous = ByteArray(0)
        var counter = 1
        val output = mutableListOf<Byte>()
        while (output.size < lengthBytes) {
            val block = previous + infoBytes + byteArrayOf(counter.toByte())
            previous = hmacSha256(prk, block)
            output.addAll(previous.toList())
            counter += 1
        }
        return output.take(lengthBytes).toByteArray()
    }

    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    fun encrypt(sessionKey: ByteArray, plaintext: String): EncryptedEnvelope {
        val iv = Random.nextBytes(12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sessionKey, "AES"), GCMParameterSpec(128, iv))
        val output = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        // Java's GCM output is ciphertext||tag concatenated; split so the wire format matches
        // companion-crypto.ts's separate ciphertext_b64/tag_b64 fields exactly.
        val ciphertext = output.copyOfRange(0, output.size - 16)
        val tag = output.copyOfRange(output.size - 16, output.size)
        return EncryptedEnvelope(
            ivB64 = Base64.getEncoder().encodeToString(iv),
            ciphertextB64 = Base64.getEncoder().encodeToString(ciphertext),
            tagB64 = Base64.getEncoder().encodeToString(tag),
        )
    }

    fun decrypt(sessionKey: ByteArray, envelope: EncryptedEnvelope): String? = try {
        val iv = Base64.getDecoder().decode(envelope.ivB64)
        val ciphertext = Base64.getDecoder().decode(envelope.ciphertextB64)
        val tag = Base64.getDecoder().decode(envelope.tagB64)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(sessionKey, "AES"), GCMParameterSpec(128, iv))
        val plaintext = cipher.doFinal(ciphertext + tag)
        String(plaintext, Charsets.UTF_8)
    } catch (_: Exception) {
        null
    }

    /** SHA-256 of a public key, for a short human-comparable pairing fingerprint — not used in the trust decision itself, which relies solely on the signature check in PairingManager.kt. */
    fun fingerprint(publicKeyB64: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(publicKeyB64))
        return digest.joinToString(":") { "%02x".format(it) }.take(23)
    }
}
