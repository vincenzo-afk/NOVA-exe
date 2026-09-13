package com.nova.companion

import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class PairingManagerTest {

    @Test
    fun `rejects a payload signed with the wrong key`() {
        val desktopKeys = generateKeyPair()
        val impostorKeys = generateKeyPair()
        val manager = PairingManager()
        val payload = PairingQrPayload(
            pairingCode = "ABC-123",
            desktopPublicKeyB64 = Base64.getEncoder().encodeToString(desktopKeys.public.encoded),
            channelToken = "token",
            expiresAtEpochMs = System.currentTimeMillis() + 60_000,
        )
        val challenge = manager.generateChallenge()
        val signature = sign(impostorKeys.private, challenge)

        val outcome = manager.completePairing(payload, challenge, signature, System.currentTimeMillis())
        assertTrue(outcome is PairingOutcome.Rejected)
    }

    @Test
    fun `accepts a correctly signed, unexpired payload`() {
        val desktopKeys = generateKeyPair()
        val manager = PairingManager()
        val payload = PairingQrPayload(
            pairingCode = "ABC-123",
            desktopPublicKeyB64 = Base64.getEncoder().encodeToString(desktopKeys.public.encoded),
            channelToken = "token",
            expiresAtEpochMs = System.currentTimeMillis() + 60_000,
        )
        val challenge = manager.generateChallenge()
        val signature = sign(desktopKeys.private, challenge)

        val outcome = manager.completePairing(payload, challenge, signature, System.currentTimeMillis())
        assertTrue(outcome is PairingOutcome.Paired)
    }

    @Test
    fun `rejects an expired pairing code even with a valid signature`() {
        val desktopKeys = generateKeyPair()
        val manager = PairingManager()
        val payload = PairingQrPayload(
            pairingCode = "ABC-123",
            desktopPublicKeyB64 = Base64.getEncoder().encodeToString(desktopKeys.public.encoded),
            channelToken = "token",
            expiresAtEpochMs = System.currentTimeMillis() - 1_000,
        )
        val challenge = manager.generateChallenge()
        val signature = sign(desktopKeys.private, challenge)

        val outcome = manager.completePairing(payload, challenge, signature, System.currentTimeMillis())
        assertTrue(outcome is PairingOutcome.Rejected)
    }

    private fun generateKeyPair() =
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private fun sign(privateKey: java.security.PrivateKey, data: ByteArray): ByteArray {
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(data)
        return signer.sign()
    }
}
