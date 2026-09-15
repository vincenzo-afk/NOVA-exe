import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * `CredentialStore.save()` mints a fresh, opaque `vault://...`
 * reference on every call rather than accepting a caller-chosen one —
 * correct for its own scope (it doesn't know what a reference is
 * "for"), but it means something has to remember *which* reference
 * corresponds to, e.g., "the Anthropic API key" across restarts. This
 * is that small, deliberately dumb mapping: provider id → the vault
 * reference last saved for it. It stores no secret material itself —
 * only the reference string, which is meaningless without the vault
 * backend that can actually decrypt what it points to.
 */

export interface ProviderCredentialSettings {
  get(providerId: string): string | undefined;
  set(providerId: string, vaultReference: string): void;
  clear(providerId: string): void;
}

export function openProviderCredentialSettings(filePath: string): ProviderCredentialSettings {
  const load = (): Record<string, string> => {
    if (!existsSync(filePath)) return {};
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const persist = (entries: Record<string, string>): void => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(entries, null, 2));
  };

  return {
    get(providerId) {
      return load()[providerId];
    },
    set(providerId, vaultReference) {
      const entries = load();
      entries[providerId] = vaultReference;
      persist(entries);
    },
    clear(providerId) {
      const entries = load();
      delete entries[providerId];
      persist(entries);
    },
  };
}
