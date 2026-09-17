import { describe, expect, it } from "vitest";

import {
  decryptPayload,
  deriveSessionKey,
  encryptPayload,
  generateCompanionKeyPair,
  signChallenge,
  verifyChallengeSignature,
} from "../src/companion-crypto.js";

describe("companion-crypto", () => {
  it("both sides of an ECDH exchange derive the identical session key", () => {
    const desktop = generateCompanionKeyPair();
    const mobile = generateCompanionKeyPair();

    const desktopSideKey = deriveSessionKey(desktop.privateKeyB64, mobile.publicKeyB64);
    const mobileSideKey = deriveSessionKey(mobile.privateKeyB64, desktop.publicKeyB64);

    expect(desktopSideKey.ok).toBe(true);
    expect(mobileSideKey.ok).toBe(true);
    if (!desktopSideKey.ok || !mobileSideKey.ok) return;
    expect(desktopSideKey.value.equals(mobileSideKey.value)).toBe(true);
    expect(desktopSideKey.value.length).toBe(32);
  });

  it("round-trips a payload encrypted and decrypted with the same derived key", () => {
    const desktop = generateCompanionKeyPair();
    const mobile = generateCompanionKeyPair();
    const key = deriveSessionKey(desktop.privateKeyB64, mobile.publicKeyB64);
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const envelope = encryptPayload(key.value, JSON.stringify({ hello: "nova" }));
    const decrypted = decryptPayload(key.value, envelope);

    expect(decrypted).toMatchObject({ ok: true, value: JSON.stringify({ hello: "nova" }) });
  });

  it("rejects a payload decrypted with the wrong key", () => {
    const pair = generateCompanionKeyPair();
    const otherPair = generateCompanionKeyPair();
    const key = deriveSessionKey(pair.privateKeyB64, otherPair.publicKeyB64);
    const wrongKey = deriveSessionKey(
      otherPair.privateKeyB64,
      generateCompanionKeyPair().publicKeyB64,
    );
    expect(key.ok && wrongKey.ok).toBe(true);
    if (!key.ok || !wrongKey.ok) return;

    const envelope = encryptPayload(key.value, "secret");
    const result = decryptPayload(wrongKey.value, envelope);

    expect(result.ok).toBe(false);
  });

  it("verifies a signature produced with the matching private key and rejects a tampered challenge", () => {
    const pair = generateCompanionKeyPair();
    const challenge = Buffer.from("nova-pairing-challenge");
    const signature = signChallenge(pair.privateKeyB64, challenge);

    expect(verifyChallengeSignature(pair.publicKeyB64, challenge, signature)).toBe(true);
    expect(verifyChallengeSignature(pair.publicKeyB64, Buffer.from("tampered"), signature)).toBe(
      false,
    );
  });
});
