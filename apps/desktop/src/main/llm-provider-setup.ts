import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { StructuredLogger } from "@nova/shared";
import {
  AnthropicProvider,
  CredentialStore,
  ModelRouter,
  ToolRegistry,
  createLlmPlanGenerator,
  type RegisteredTool,
  type ExecutionStep,
} from "@nova/runtime";

import { ElectronSafeStorageVaultBackend } from "./vault-backend.js";
import { openProviderCredentialSettings } from "./provider-settings.js";

/**
 * Closes Tier 0's #1, #2, and #4 together, since in practice they're
 * one dependency chain: a real vault (#2) is what makes a real
 * provider's credential resolvable (#1/#4), and a real provider is
 * what an `llmPlanner` (#1) actually has to call. Splitting them into
 * separate, disconnected fixes would have left at least one seam
 * still broken.
 */

const ANTHROPIC_PROVIDER_ID = "anthropic-claude";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export interface LlmProviderSetup {
  readonly toolRegistry: ToolRegistry;
  readonly credentialStore: CredentialStore;
  readonly llmPlanner: (goal: string) => Promise<readonly ExecutionStep[]>;
  readonly isProviderConfigured: () => boolean;
  /** The underlying provider instance, if one was configured — exposed so the caller can register it against the desktop capability catalog's "text-generation" slot. */
  readonly provider: AnthropicProvider | undefined;
  /** Called by a future settings UI (via IPC) once the user enters an API key. Takes effect on the next app restart — this module builds its ModelRouter once, at startup, from whatever credential is on disk at that moment. */
  readonly saveAnthropicApiKey: (apiKey: string) => void;
}

export function setupLlmProvider(options: {
  readonly userDataPath: string;
  readonly registeredTools: readonly RegisteredTool[];
  readonly logger?: StructuredLogger;
}): LlmProviderSetup {
  const vault = new ElectronSafeStorageVaultBackend({
    filePath: join(options.userDataPath, "secrets", "vault.json"),
    safeStorage,
  });
  const providerSettings = openProviderCredentialSettings(
    join(options.userDataPath, "secrets", "provider-references.json"),
  );
  const credentialStore = new CredentialStore(vault, () => `vault://${randomUUID()}`);

  const toolRegistry = new ToolRegistry();
  for (const tool of options.registeredTools) {
    const registered = toolRegistry.register(tool);
    if (!registered.ok) {
      options.logger?.warning("llm_provider_setup.tool_registration_failed", {
        tool_id: tool.tool_id,
        error: registered.error.message,
      });
    }
  }

  const existingReference = providerSettings.get(ANTHROPIC_PROVIDER_ID);
  const providers = existingReference
    ? [
        new AnthropicProvider({
          providerId: ANTHROPIC_PROVIDER_ID,
          model: DEFAULT_ANTHROPIC_MODEL,
          authReference: existingReference,
          resolveCredential: async (reference) => {
            const resolved = credentialStore.resolve(reference);
            if (!resolved.ok) throw new Error(resolved.error.message);
            return resolved.value.value;
          },
        }),
      ]
    : [];
  if (providers.length === 0) {
    options.logger?.info("llm_provider_setup.no_provider_configured", {
      hint: "No Anthropic API key is saved yet — planning will fail until one is entered.",
    });
  }

  const router = new ModelRouter(providers);
  const llmPlanner = createLlmPlanGenerator({
    router,
    tools: toolRegistry,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return {
    toolRegistry,
    credentialStore,
    llmPlanner,
    isProviderConfigured: () => providers.length > 0,
    provider: providers[0],
    saveAnthropicApiKey: (apiKey: string) => {
      const saved = credentialStore.save({ type: "api_key", value: apiKey });
      if (!saved.ok) {
        throw new Error(saved.error.message);
      }
      providerSettings.set(ANTHROPIC_PROVIDER_ID, saved.value.vault_reference);
    },
  };
}
