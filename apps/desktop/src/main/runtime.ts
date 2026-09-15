import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ObservationIndexer } from "@nova/memory";
import { FileJsonlLogSink, StructuredLogger } from "@nova/shared";
import {
  Executor,
  PermissionGrantStore,
  PermissionManager,
  Planner,
  RuntimeApplication,
  Verifier,
  type CapabilityRegistry,
  type NovaConfiguration,
  type RuntimeApplicationOptions,
} from "@nova/runtime";
import { openDesktopPersistence } from "./persistence.js";
import { createDesktopCapabilityRegistry } from "./capability-catalog.js";
import { setupLlmProvider, type LlmProviderSetup } from "./llm-provider-setup.js";
import {
  createDesktopAccessibilityDefinition,
  createDesktopAccessibilityTool,
  createDesktopScreenCaptureDefinition,
  createDesktopScreenCaptureTool,
  type DesktopAgentController,
} from "./desktop-agent.js";

const desktopPermissions = [
  { source: "filesystem", granted: false },
  { source: "applications", granted: false },
  { source: "windows", granted: false },
  { source: "screen", granted: false },
  { source: "desktop_control", granted: false },
  { source: "browser_metadata", granted: false },
  { source: "keyboard_activity", granted: false },
  { source: "mouse_activity", granted: false },
  { source: "clipboard_metadata", granted: false },
  { source: "clipboard_content", granted: false },
  { source: "notifications_metadata", granted: false },
  { source: "notifications_content", granted: false },
] as const;

const desktopTaskSchedulerOptions = {
  maxConcurrent: 1,
  starvationThresholdMs: 60_000,
} as const;

const desktopConfiguration: NovaConfiguration = {
  schema_version: "1.0.0" as const,
  capabilities: {},
  devices: [],
  channels: [],
  plugins: [],
  mcp_servers: [],
  routing_policies: {},
  permissions: { browser_excluded_domains: [] },
  voice: {
    enabled: false,
    wake_word: "nova",
    always_listening: false,
    barge_in_sensitivity: "conservative",
  },
  personalization: { preferences: [] },
};

export interface DesktopRuntimeOptions {
  readonly userDataPath: string;
  readonly migrationsPath?: string;
  readonly windowObserverBridge?: RuntimeApplicationOptions["windowObserverBridge"];
  readonly clipboardObserverBridge?: RuntimeApplicationOptions["clipboardObserverBridge"];
  readonly notificationObserverBridge?: RuntimeApplicationOptions["notificationObserverBridge"];
  readonly browserObserverBridge?: RuntimeApplicationOptions["browserObserverBridge"];
  readonly browserExcludedDomains?: RuntimeApplicationOptions["browserExcludedDomains"];
  readonly keyboardObserverBridge?: RuntimeApplicationOptions["keyboardObserverBridge"];
  readonly keyboardHotkeys?: RuntimeApplicationOptions["keyboardHotkeys"];
  readonly mouseObserverBridge?: RuntimeApplicationOptions["mouseObserverBridge"];
  readonly mouseIdleThresholdMs?: RuntimeApplicationOptions["mouseIdleThresholdMs"];
  readonly observationIndexer?: RuntimeApplicationOptions["observationIndexer"];
  readonly desktopAgent?: () => DesktopAgentController | undefined;
  readonly logger?: StructuredLogger;
}

const defaultMigrationsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../services/memory/prisma/migrations",
);

export async function createDesktopRuntime(
  options: DesktopRuntimeOptions,
): Promise<RuntimeApplication> {
  const persistence = await openDesktopPersistence({
    userDataPath: options.userDataPath,
    migrationsPath: options.migrationsPath ?? defaultMigrationsPath,
  });
  const logger =
    options.logger ??
    new StructuredLogger({
      service: "desktop.runtime",
      sink: new FileJsonlLogSink(join(options.userDataPath, "logs", "nova.jsonl")),
    });
  const registeredTools = [
    createDesktopScreenCaptureDefinition(),
    createDesktopAccessibilityDefinition(),
  ];
  // Wires Tier-0 #1/#2/#4 together: a real vault-backed credential store, a
  // real Anthropic provider (once a key is saved), and the llmPlanner that
  // actually gets passed to Planner below — previously `new Planner({
  // deterministic: new Map() })` had no model fallback at all, so every task
  // with no exact deterministic match failed outright.
  const llmProviderSetup = setupLlmProvider({
    userDataPath: options.userDataPath,
    registeredTools,
    logger,
  });
  return new RuntimeApplication({
    configuration: desktopConfiguration,
    permissionStore: new PermissionGrantStore({ initial: desktopPermissions }, logger),
    planner: new Planner({ deterministic: new Map(), llmPlanner: llmProviderSetup.llmPlanner }),
    executor: new Executor(
      new PermissionManager(
        {
          allowedToolIds: new Set(["nova.screen-capture", "nova.desktop-accessibility"]),
          confirmationTimeoutMs: 30_000,
        },
        logger,
      ),
      new Map([
        [
          "nova.screen-capture",
          createDesktopScreenCaptureTool(options.desktopAgent ?? (() => undefined)),
        ],
        [
          "nova.desktop-accessibility",
          createDesktopAccessibilityTool(options.desktopAgent ?? (() => undefined)),
        ],
      ]),
      undefined,
      logger,
    ),
    verifier: new Verifier(logger, { toolRegistry: llmProviderSetup.toolRegistry }),
    capabilityRegistry: registerConfiguredProviders(
      createDesktopCapabilityRegistry(logger),
      llmProviderSetup,
      logger,
    ),
    persistence: persistence.checkpointStore,
    taskSchedulerOptions: desktopTaskSchedulerOptions,
    memoryStore: persistence.memoryStore,
    dispose: persistence.close,
    logger,
    ...(options.windowObserverBridge === undefined
      ? {}
      : { windowObserverBridge: options.windowObserverBridge }),
    ...(options.clipboardObserverBridge === undefined
      ? {}
      : { clipboardObserverBridge: options.clipboardObserverBridge }),
    ...(options.notificationObserverBridge === undefined
      ? {}
      : { notificationObserverBridge: options.notificationObserverBridge }),
    ...(options.browserObserverBridge === undefined
      ? {}
      : { browserObserverBridge: options.browserObserverBridge }),
    ...(options.browserExcludedDomains === undefined
      ? {}
      : { browserExcludedDomains: options.browserExcludedDomains }),
    ...(options.keyboardObserverBridge === undefined
      ? {}
      : { keyboardObserverBridge: options.keyboardObserverBridge }),
    ...(options.keyboardHotkeys === undefined ? {} : { keyboardHotkeys: options.keyboardHotkeys }),
    ...(options.mouseObserverBridge === undefined
      ? {}
      : { mouseObserverBridge: options.mouseObserverBridge }),
    ...(options.mouseIdleThresholdMs === undefined
      ? {}
      : { mouseIdleThresholdMs: options.mouseIdleThresholdMs }),
    observationIndexer:
      options.observationIndexer ?? new ObservationIndexer(persistence.memoryStore),
    registeredTools,
  });
}

/**
 * Registers whatever provider `setupLlmProvider` actually built against
 * the "text-generation" capability slot — previously all 9 declared
 * capability slots had zero providers registered, regardless of whether
 * a provider existed in code, because nothing ever called `.register()`.
 */
function registerConfiguredProviders(
  registry: CapabilityRegistry,
  llmProviderSetup: LlmProviderSetup,
  logger: StructuredLogger,
): CapabilityRegistry {
  if (!llmProviderSetup.provider) return registry;
  const registered = registry.register("text-generation", llmProviderSetup.provider);
  if (!registered.ok) {
    logger.warning("desktop_runtime.provider_registration_failed", {
      capability_id: "text-generation",
      error: registered.error.message,
    });
  }
  return registry;
}
