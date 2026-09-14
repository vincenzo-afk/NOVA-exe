package com.nova.companion

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class CompanionCryptoTest {

    private fun generateKeyPairB64(): Pair<String, String> {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        return Base64.getEncoder().encodeToString(pair.public.encoded) to Base64.getEncoder().encodeToString(pair.private.encoded)
    }

    @Test
    fun `both sides of an ECDH exchange derive the identical session key`() {
        val (desktopPub, desktopPriv) = generateKeyPairB64()
        val (mobilePub, mobilePriv) = generateKeyPairB64()

        val desktopSideKey = CompanionCrypto.deriveSessionKey(desktopPriv, mobilePub)
        val mobileSideKey = CompanionCrypto.deriveSessionKey(mobilePriv, desktopPub)

        assertArrayEquals(desktopSideKey, mobileSideKey)
        assertEquals(32, desktopSideKey.size)
    }

    @Test
    fun `round-trips a payload encrypted and decrypted with the same derived key`() {
        val (desktopPub, desktopPriv) = generateKeyPairB64()
        val (mobilePub, mobilePriv) = generateKeyPairB64()
        val key = CompanionCrypto.deriveSessionKey(desktopPriv, mobilePub)
        val peerKey = CompanionCrypto.deriveSessionKey(mobilePriv, desktopPub)

        val envelope = CompanionCrypto.encrypt(key, "{\"hello\":\"nova\"}")
        val decrypted = CompanionCrypto.decrypt(peerKey, envelope)

        assertEquals("{\"hello\":\"nova\"}", decrypted)
    }

    @Test
    fun `rejects a payload decrypted with the wrong key`() {
        val (pub1, priv1) = generateKeyPairB64()
        val (pub2, _) = generateKeyPairB64()
        val (pub3, priv3) = generateKeyPairB64()
        val key = CompanionCrypto.deriveSessionKey(priv1, pub2)
        val wrongKey = CompanionCrypto.deriveSessionKey(priv3, pub2)
        assertTrue(!key.contentEquals(wrongKey))
        assertTrue(pub1 != pub3) // sanity: the two generated key pairs are actually distinct

        val envelope = CompanionCrypto.encrypt(key, "secret")
        val result = CompanionCrypto.decrypt(wrongKey, envelope)

        assertNull(result)
    }
}
