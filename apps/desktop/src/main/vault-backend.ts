import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { VaultBackend } from "@nova/runtime";

/**
 * The concrete `VaultBackend` `CredentialStore` was always designed
 * around but never had (docs mention "vault:// reference indirection"
 * with no implementation behind it). Uses Electron's `safeStorage`
 * module rather than hand-rolled encryption — `safeStorage` already
 * wraps each OS's real secret storage (macOS Keychain, Windows DPAPI,
 * libsecret/kwallet on Linux), so this *is* genuine OS keychain
 * integration, not a NOVA-specific alternative to it.
 *
 * `VaultBackend`'s interface is synchronous, so this backend loads its
 * encrypted store once at construction and writes it back to disk
 * synchronously on every mutation — durable across restarts (unlike an
 * in-memory-only vault) without an async write that could lose data on
 * a crash between a `put()` call returning and a background write
 * landing.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface ElectronVaultBackendOptions {
  readonly filePath: string;
  readonly safeStorage: SafeStorageLike;
}

interface VaultFileShape {
  readonly schema_version: "1.0.0";
  readonly entries: Readonly<Record<string, string>>; // reference -> base64 ciphertext
}

export class VaultUnavailableError extends Error {
  public constructor() {
    super(
      "OS-level secret encryption is unavailable on this system (safeStorage.isEncryptionAvailable() returned false) — credentials cannot be stored securely here.",
    );
    this.name = "VaultUnavailableError";
  }
}

export class ElectronSafeStorageVaultBackend implements VaultBackend {
  private readonly filePath: string;
  private readonly safeStorage: SafeStorageLike;
  private entries: Record<string, string>;

  public constructor(options: ElectronVaultBackendOptions) {
    this.filePath = options.filePath;
    this.safeStorage = options.safeStorage;
    if (!this.safeStorage.isEncryptionAvailable()) {
      // Fail loudly at construction rather than silently storing plaintext or
      // silently discarding every credential — a vault that can't actually
      // encrypt has no safe degraded mode to fall back to.
      throw new VaultUnavailableError();
    }
    this.entries = this.load();
  }

  public put(reference: string, value: string): void {
    const ciphertext = this.safeStorage.encryptString(value);
    this.entries[reference] = ciphertext.toString("base64");
    this.persist();
  }

  public get(reference: string): string | undefined {
    const stored = this.entries[reference];
    if (stored === undefined) return undefined;
    try {
      return this.safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      // A corrupted entry or a key that no longer decrypts (e.g. the OS
      // keychain entry was removed outside NOVA) is treated as absent,
      // not thrown — CredentialStore already reports "revoked or
      // unavailable" for a missing value, which is the correct outcome here.
      return undefined;
    }
  }

  public delete(reference: string): void {
    if (!(reference in this.entries)) return;
    const next = { ...this.entries };
    Reflect.deleteProperty(next, reference);
    this.entries = next;
    this.persist();
  }

  private load(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as VaultFileShape;
      return { ...parsed.entries };
    } catch {
      // A missing or corrupt vault file starts empty rather than crashing
      // desktop startup — every credential simply needs re-entering, which
      // is recoverable; refusing to start is not.
      return {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const payload: VaultFileShape = { schema_version: "1.0.0", entries: this.entries };
    writeFileSync(this.filePath, JSON.stringify(payload), { mode: 0o600 });
  }
}
