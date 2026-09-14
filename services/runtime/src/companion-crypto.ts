import { createHmac, createCipheriv, createDecipheriv, randomBytes, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";

import { err, ok, type Result } from "@nova/shared";

/**
 * Shared cryptographic primitives for the companion transport
 * (docs/28-multi-device-protocol/02-device-pairing-protocol.md and
 * docs/20-devices/android-companion.md). One EC (P-256 / secp256r1)
 * key pair per device serves two purposes, deliberately, rather than
 * requiring the phone to generate and exchange two separate key
 * pairs for one pairing operation:
 *
 * 1. Challenge/response signing during pairing itself (already
 *    implemented on the Android side by PairingManager.kt, using
 *    Java's `KeyPairGenerator.getInstance("EC")` /
 *    `Signature.getInstance("SHA256withECDSA")`). This module's key
 *    format (SPKI for public, PKCS8 for private, both DER, base64
 *    wrapped) is chosen specifically to be byte-compatible with
 *    Java's `X509EncodedKeySpec` / `PKCS8EncodedKeySpec` — no format
 *    translation step exists anywhere in this pairing flow.
 * 2. Deriving a shared AES-256-GCM session key via ECDH once the
 *    signature check above has already established trust, so every
 *    sync/command/vision payload afterward is encrypted with a key
 *    neither side transmitted, only independently derived.
 *
 * This is transport-level auth (a bearer token, in
 * companion-pairing-session.ts) layered under payload-level
 * encryption (this module) — a payload is protected even if
 * something on the local network path between phone and desktop can
 * see the raw HTTP traffic.
 */

export interface CompanionKeyPair {
  readonly publicKeyB64: string; // SPKI DER, base64 — matches Android's X509EncodedKeySpec input.
  readonly privateKeyB64: string; // PKCS8 DER, base64 — matches Android's PKCS8EncodedKeySpec input.
}

export interface EncryptedEnvelope {
  readonly iv_b64: string;
  readonly ciphertext_b64: string;
  readonly tag_b64: string;
}

const CURVE = "prime256v1"; // OpenSSL/Node's name for NIST P-256, i.e. Android's "secp256r1" — the same curve, different name per library.

export function generateCompanionKeyPair(): CompanionKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: CURVE,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKeyB64: (publicKey as Buffer).toString("base64"),
    privateKeyB64: (privateKey as Buffer).toString("base64"),
  };
}

function loadPublicKey(publicKeyB64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
}

function loadPrivateKey(privateKeyB64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
}

/**
 * Signs a challenge with this side's EC private key — the desktop
 * half of the challenge/response pairing exchange Android's
 * `PairingManager.completePairing` verifies. Produces a DER-encoded
 * ECDSA signature (Node's default `dsaEncoding`), matching what
 * Java's `Signature.getInstance("SHA256withECDSA")` expects.
 */
export function signChallenge(privateKeyB64: string, challenge: Buffer): string {
  const signature = cryptoSign("sha256", challenge, loadPrivateKey(privateKeyB64));
  return signature.toString("base64");
}

/** Verifies a peer's signature over a challenge — used when the desktop is the verifying side of a future symmetric pairing flow. */
export function verifyChallengeSignature(
  peerPublicKeyB64: string,
  challenge: Buffer,
  signatureB64: string,
): boolean {
  try {
    return cryptoVerify(
      "sha256",
      challenge,
      loadPublicKey(peerPublicKeyB64),
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Derives the AES-256-GCM session key both sides of a pairing share,
 * from this side's EC private key and the peer's EC public key —
 * standard ECDH followed by HKDF-SHA256 so the raw shared point is
 * never used directly as a cipher key.
 */
export function deriveSessionKey(ownPrivateKeyB64: string, peerPublicKeyB64: string): Result<Buffer> {
  try {
    const sharedSecret = diffieHellman({
      privateKey: loadPrivateKey(ownPrivateKeyB64),
      publicKey: loadPublicKey(peerPublicKeyB64),
    });
    return ok(hkdfSha256(sharedSecret, "nova-companion-session-v1", 32));
  } catch {
    return err({
      code: "NOVA-SEC001",
      message: "Could not derive a session key from the provided key material.",
      retryable: false,
    });
  }
}

/** HKDF-Extract-and-Expand (RFC 5869) via HMAC-SHA256, for portability across the Node versions this monorepo targets. */
function hkdfSha256(inputKeyMaterial: Buffer, info: string, lengthBytes: number): Buffer {
  const salt = Buffer.alloc(32, 0); // No salt is exchanged out-of-band; RFC 5869 treats a fixed zero salt as its documented default when none is available.
  const prk = createHmac("sha256", salt).update(inputKeyMaterial).digest();
  const infoBuffer = Buffer.from(info, "utf8");
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < lengthBytes) {
    const hmac = createHmac("sha256", prk);
    hmac.update(previous);
    hmac.update(infoBuffer);
    hmac.update(Buffer.from([counter]));
    previous = hmac.digest();
    blocks.push(previous);
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, lengthBytes);
}

export function encryptPayload(sessionKey: Buffer, plaintext: string): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv_b64: iv.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    tag_b64: tag.toString("base64"),
  };
}

export function decryptPayload(sessionKey: Buffer, envelope: EncryptedEnvelope): Result<string> {
  try {
    const decipher = createDecipheriv("aes-256-gcm", sessionKey, Buffer.from(envelope.iv_b64, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag_b64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext_b64, "base64")),
      decipher.final(),
    ]);
    return ok(plaintext.toString("utf8"));
  } catch {
    return err({
      code: "NOVA-SEC001",
      message: "Payload failed to decrypt or authenticate — it may be corrupted, replayed with a stale key, or tampered with.",
      retryable: false,
    });
  }
}
