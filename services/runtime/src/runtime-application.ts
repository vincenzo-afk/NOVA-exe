import type {
  ObservationIndexRequest,
  ObservationIndexResult,
  ObservationIndexer,
  MemoryRecordSummary,
  MemorySearchInput,
  MemoryStore,
} from "@nova/memory";
import {
  InMemoryCommunicationBus,
  err,
  ok,
  type Result,
  type ServiceHealth,
  type ShutdownStep,
  type StartupStep,
  type StructuredLogger,
} from "@nova/shared";
import {
  BrowserObserver,
  NativeBrowserEventBridge,
  type NativeBrowserEvent,
  type NativeBrowserEventBridgeContract,
  type BrowserObserverState,
  KeyboardObserver,
  NativeKeyboardEventBridge,
  type KeyboardHotkeyRegistration,
  type NativeKeyboardEventBridgeContract,
  type KeyboardObserverState,
  MouseObserver,
  NativeMouseEventBridge,
  type NativeMouseEventBridgeContract,
  type MouseObserverState,
  ClipboardObserver,
  NativeClipboardEventBridge,
  type NativeClipboardEventBridgeContract,
  NativeNotificationEventBridge,
  NotificationObserver,
  type NativeNotificationEventBridgeContract,
  NativeWindowsEventBridge,
  type NativeWindowsEventBridgeContract,
  WindowsApplicationObserver,
  type WindowsObserverState,
  type ClipboardObserverState,
  type NotificationObserverState,
} from "@nova/observers";
import { WorldModel } from "@nova/state";
import {
  LocalApiTokenIssuer,
  PublicApiServer,
  type GraphQueryInput as PublicGraphQueryInput,
  type PublicApiServerOptions,
} from "./rest-api.js";
import {
  ConfigurationStore,
  type ConfigurationSectionName,
  type McpServerConfiguration,
  type NovaConfiguration,
} from "./configuration-store.js";
import { KnowledgeGraph, type GraphEdgeType, type GraphQueryResult } from "./knowledge-graph.js";
import type { RemovedMcpServer } from "./mcp-server-manager.js";
import {
  RuntimeTaskCoordinator,
  type TaskCheckpointPersistence,
} from "./runtime-task-coordinator.js";
import { TaskManager } from "./task-manager.js";
import { PermissionGrantStore, type StoredPermissionGrant } from "./permission-grant-store.js";
import {
  TaskScheduler,
  type TaskSchedulerOptions,
  type TaskSchedulerStatus,
} from "./task-scheduler.js";
import type {
  WorkflowCheckpointSummary,
  WorkflowEngine,
  WorkflowResult,
} from "./workflow-engine.js";
import type {
  ExecutionResult,
  ExecutionStep,
  Executor,
  Planner,
  Verifier,
  VerificationVerdict,
} from "./orchestration.js";
import { ToolRegistry, type RegisteredTool, type RegisteredToolSummary } from "./tool-registry.js";
import type { TaskRecord } from "./task-manager.js";
import type { CrossDeviceSyncManager, FlushResult, SyncResult } from "./cross-device-sync.js";
import type {
  AndroidCompanionManager,
  CompanionCapability,
  CompanionPermissionState,
} from "./android-companion.js";
import type {
  RemoteControlManager,
  RemotePreApprovalView,
  RemoteSessionView,
} from "./remote-control.js";
import type {
  EmailAssistant,
  EmailDraft,
  EmailMessage,
  EmailQuery,
  EmailSendReceipt,
} from "./email-assistant.js";
import type {
  CalendarAssistant,
  CalendarDraft,
  CalendarEvent,
  CalendarProposal,
} from "./calendar-assistant.js";
import type {
  ChannelManager,
  DeliveryReceipt,
  InboundMessage,
  MediaCapabilities,
} from "./channel-adapter.js";
import type { BackgroundAssistant, Briefing, BriefingTrigger } from "./background-assistant.js";
import {
  AdaptivePersonalization,
  type AdaptivePreferenceInput,
  type AdaptivePreferenceProposal,
  type AdaptivePreferenceSummary,
} from "./adaptive-personalization.js";
import {
  PersonalAnalytics,
  type AnalyticsInput,
  type AnalyticsReport,
} from "./personal-analytics.js";
import {
  IncidentManager,
  type IncidentEntry,
  type IncidentSeverity,
} from "./incident-lifecycle.js";
import type { RunbookIncident, RunbookManager, RunbookResult } from "./runbook-manager.js";
import type {
  CapabilityPolicy,
  CapabilityRecord,
  CapabilityRegistry,
} from "./provider-registry.js";
import type {
  LocalModelDiscovery,
  LocalModelDownloadResult,
  LocalModelLoadResult,
  LocalModelManager,
  LocalModelRetirementResult,
  ReclaimableLocalModelSummary,
} from "./local-model-manager.js";
import type { HealthState, ModelRouter, ProviderHealthStatus } from "./model-router.js";
import type { RuntimeManager } from "./runtime-manager.js";
import {
  PerformanceBudgetEvaluator,
  type BudgetSamples,
  type PerformanceBudgetReport,
} from "./performance-budgets.js";
import type {
  HardwareCapabilitySummary,
  HardwareDetector,
  HardwareProfile,
} from "./hardware-detection.js";
import {
  compareDeviceVersions,
  LogicalClock,
  type CompatibilityResult,
  type LogicalClockValue,
} from "./device-compatibility.js";
import type { VoicePipeline, VoiceState } from "./voice-pipeline.js";
import type {
  CapabilityGap,
  PluginDiscovery,
  PluginDiscoveryProposal,
  PluginDiscoveryResult,
} from "./plugin-discovery.js";
import type { PluginManager, PluginRecord, PluginRecordSummary } from "./plugin-manager.js";
import type { JobScheduler, JobState } from "./job-scheduler.js";
import type { SystemLifecycleOrchestrator } from "./system-lifecycle.js";
import type { ConnectionState, NetworkDiscoveryManager } from "./networking.js";
import type { DeviceSnapshot, SessionContinuityManager } from "./session-continuity.js";
import {
  summarizeSystemInventory,
  type SystemInventorySummary,
  type WindowsSystemInventory,
} from "./system-inventory.js";
import type { BackupManager, SnapshotMetadata } from "./backup-manager.js";
import type { PreparedRestore, RestoreManager } from "./restore-manager.js";
import type { UpgradeManager, UpgradeRequest, UpgradeResult } from "./upgrade-manager.js";
import type { RepairManager, RepairRequest, RepairResult } from "./repair-manager.js";
import type { HeldResourceLock, LockGrant, ResourceManager } from "./resource-manager.js";
import type {
  OfflineAction,
  OfflineActionQueue,
  OfflineActionResult,
  ResourceArbitrator,
  ResourceDecision,
  ResourceRequest,
} from "./resource-arbitration.js";
import type { SetupStepId, SetupStepPatch, SetupState, SetupWizard } from "./setup-wizard.js";
import type {
  WorkspaceIdentity,
  WorkspaceLock,
  WorkspaceManager,
  WorkspaceState,
} from "./workspace-manager.js";
import type {
  DevicePairingManager,
  PairingOffer,
  PairingRequest,
  TrustedDevice,
} from "./device-pairing.js";
import {
  DistributedTaskCoordinator,
  type DistributedPlacementInput,
  type DistributedPlacementResult,
} from "./distributed-task-coordinator.js";
import { WebhookManager, type WebhookHealthSummary } from "./webhook-manager.js";
import {
  CommunicationBusEventJournal,
  PublicWebSocketServer,
  type PublicWebSocketServerOptions,
} from "./websocket-api.js";

const cancellableTaskStates: ReadonlySet<TaskRecord["state"]> = new Set([
  "Created",
  "Planning",
  "WaitingResources",
  "Paused",
  "WaitingUser",
]);

export interface TaskRecoveryPersistence {
  recoverAfterCrash(): Promise<Result<readonly TaskRecord[]>>;
}

export interface RuntimeApplicationOptions {
  readonly configuration: NovaConfiguration;
  readonly planner: Planner;
  readonly executor: Executor;
  readonly verifier: Verifier;
  readonly host?: string;
  readonly restPort?: number;
  readonly websocketPort?: number;
  readonly taskManager?: TaskManager;
  readonly permissionStore?: PermissionGrantStore;
  readonly persistence?: TaskCheckpointPersistence & TaskRecoveryPersistence;
  /** Passed straight through to `RuntimeTaskCoordinator` — how many automatic in-flight replan attempts a failed step gets before the task is failed outright. Defaults to 2. */
  readonly maxReplanAttempts?: number;
  readonly scheduler?: TaskScheduler;
  readonly taskSchedulerOptions?: TaskSchedulerOptions;
  readonly workflowEngine?: WorkflowEngine;
  readonly dispose?: () => Promise<void>;
  readonly webhookManager?: WebhookManager;
  readonly authorizeTopics?: PublicWebSocketServerOptions["authorizeTopics"];
  readonly windowObserverBridge?: NativeWindowsEventBridgeContract;
  readonly clipboardObserverBridge?: NativeClipboardEventBridgeContract;
  readonly notificationObserverBridge?: NativeNotificationEventBridgeContract;
  readonly browserObserverBridge?: NativeBrowserEventBridgeContract;
  readonly browserExcludedDomains?: readonly string[];
  readonly keyboardObserverBridge?: NativeKeyboardEventBridgeContract;
  readonly keyboardHotkeys?: readonly KeyboardHotkeyRegistration[];
  readonly mouseObserverBridge?: NativeMouseEventBridgeContract;
  readonly mouseIdleThresholdMs?: number;
  readonly observationIndexer?: ObservationIndexer;
  readonly memoryStore?: MemoryStore;
  readonly knowledgeGraph?: KnowledgeGraph;
  readonly distributedTaskCoordinator?: DistributedTaskCoordinator;
  readonly crossDeviceSyncManager?: CrossDeviceSyncManager;
  readonly androidCompanionManager?: AndroidCompanionManager;
  readonly remoteControlManager?: RemoteControlManager;
  readonly emailAssistant?: EmailAssistant;
  readonly calendarAssistant?: CalendarAssistant;
  readonly channelManager?: ChannelManager;
  readonly backgroundAssistant?: BackgroundAssistant;
  readonly adaptivePersonalization?: AdaptivePersonalization;
  readonly personalAnalytics?: PersonalAnalytics;
  readonly incidentManager?: IncidentManager;
  readonly runbookManager?: RunbookManager;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly localModelManager?: LocalModelManager;
  readonly modelRouter?: ModelRouter;
  readonly runtimeManager?: RuntimeManager;
  readonly performanceBudgetEvaluator?: PerformanceBudgetEvaluator;
  readonly voicePipeline?: VoicePipeline;
  readonly pluginDiscovery?: PluginDiscovery;
  readonly pluginManager?: PluginManager;
  readonly jobScheduler?: JobScheduler;
  readonly systemLifecycle?: SystemLifecycleOrchestrator;
  readonly networkDiscovery?: NetworkDiscoveryManager;
  readonly systemInventory?: WindowsSystemInventory;
  readonly hardwareDetector?: HardwareDetector;
  readonly backupManager?: BackupManager;
  readonly restoreManager?: RestoreManager;
  readonly upgradeManager?: UpgradeManager;
  readonly repairManager?: RepairManager;
  readonly resourceManager?: ResourceManager;
  readonly resourceArbitrator?: ResourceArbitrator;
  readonly offlineActionQueue?: OfflineActionQueue;
  readonly setupWizard?: SetupWizard;
  readonly workspaceManager?: WorkspaceManager;
  readonly devicePairingManager?: DevicePairingManager;
  readonly sessionContinuityManager?: SessionContinuityManager;
  readonly registeredTools?: readonly RegisteredTool[];
  readonly logger?: StructuredLogger;
}

export class RuntimeApplication {
  public readonly tokenIssuer: LocalApiTokenIssuer;
  public readonly tasks: TaskManager;
  public readonly permissions: PermissionGrantStore;
  public readonly configuration: ConfigurationStore;
  public readonly events: CommunicationBusEventJournal;
  public readonly webhook: WebhookManager;
  public readonly coordinator: RuntimeTaskCoordinator;
  public readonly scheduler: TaskScheduler | undefined;
  public readonly workflowEngine: WorkflowEngine | undefined;
  public readonly rest: PublicApiServer;
  public readonly websocket: PublicWebSocketServer;
  public readonly windowsObserver: WindowsApplicationObserver;
  public readonly clipboardObserver: ClipboardObserver;
  public readonly notificationObserver: NotificationObserver;
  public readonly browserObserver: BrowserObserver;
  public readonly keyboardObserver: KeyboardObserver;
  public readonly mouseObserver: MouseObserver;
  public readonly worldModel: WorldModel;
  public readonly observationIndexer: ObservationIndexer | undefined;
  public readonly knowledgeGraph: KnowledgeGraph;
  public readonly distributedTaskCoordinator: DistributedTaskCoordinator;
  public readonly crossDeviceSyncManager: CrossDeviceSyncManager | undefined;
  public readonly androidCompanionManager: AndroidCompanionManager | undefined;
  public readonly remoteControlManager: RemoteControlManager | undefined;
  public readonly emailAssistant: EmailAssistant | undefined;
  public readonly calendarAssistant: CalendarAssistant | undefined;
  public readonly channelManager: ChannelManager | undefined;
  public readonly backgroundAssistant: BackgroundAssistant | undefined;
  public readonly adaptivePersonalization: AdaptivePersonalization | undefined;
  public readonly personalAnalytics: PersonalAnalytics;
  public readonly incidentManager: IncidentManager;
  public readonly runbookManager: RunbookManager | undefined;
  public readonly capabilityRegistry: CapabilityRegistry | undefined;
  public readonly localModelManager: LocalModelManager | undefined;
  public readonly modelRouter: ModelRouter | undefined;
  public readonly runtimeManager: RuntimeManager | undefined;
  public readonly performanceBudgetEvaluator: PerformanceBudgetEvaluator;
  public readonly voicePipeline: VoicePipeline | undefined;
  public readonly pluginDiscovery: PluginDiscovery | undefined;
  public readonly pluginManager: PluginManager | undefined;
  public readonly jobScheduler: JobScheduler | undefined;
  public readonly systemLifecycle: SystemLifecycleOrchestrator | undefined;
  public readonly networkDiscovery: NetworkDiscoveryManager | undefined;
  public readonly systemInventory: WindowsSystemInventory | undefined;
  public readonly hardwareDetector: HardwareDetector | undefined;
  public readonly backupManager: BackupManager | undefined;
  public readonly restoreManager: RestoreManager | undefined;
  public readonly upgradeManager: UpgradeManager | undefined;
  public readonly repairManager: RepairManager | undefined;
  public readonly resourceManager: ResourceManager | undefined;
  public readonly resourceArbitrator: ResourceArbitrator | undefined;
  public readonly offlineActionQueue: OfflineActionQueue | undefined;
  public readonly setupWizard: SetupWizard | undefined;
  public readonly workspaceManager: WorkspaceManager | undefined;
  public readonly devicePairingManager: DevicePairingManager | undefined;
  public readonly sessionContinuityManager: SessionContinuityManager | undefined;
  public readonly toolRegistry: ToolRegistry;
  private readonly executor: Executor;
  private readonly verifier: Verifier;
  private readonly optionsPersistence: RuntimeApplicationOptions["persistence"];
  private readonly dispose: RuntimeApplicationOptions["dispose"];
  private readonly logger: StructuredLogger | undefined;
  private readonly memoryStore: MemoryStore | undefined;

  public constructor(options: RuntimeApplicationOptions) {
    this.optionsPersistence = options.persistence;
    this.dispose = options.dispose;
    this.logger = options.logger;
    const bus = new InMemoryCommunicationBus(this.logger);
    this.executor = options.executor;
    this.verifier = options.verifier;
    this.toolRegistry = new ToolRegistry();
    for (const tool of options.registeredTools ?? []) {
      const registration = this.toolRegistry.register(tool);
      if (!registration.ok) throw new Error(registration.error.message);
    }
    this.observationIndexer = options.observationIndexer;
    this.memoryStore = options.memoryStore;
    this.knowledgeGraph = options.knowledgeGraph ?? new KnowledgeGraph();
    this.tokenIssuer = new LocalApiTokenIssuer();
    this.tasks = options.taskManager ?? new TaskManager();
    this.distributedTaskCoordinator =
      options.distributedTaskCoordinator ?? new DistributedTaskCoordinator(this.tasks);
    this.crossDeviceSyncManager = options.crossDeviceSyncManager;
    this.androidCompanionManager = options.androidCompanionManager;
    this.remoteControlManager = options.remoteControlManager;
    this.emailAssistant = options.emailAssistant;
    this.calendarAssistant = options.calendarAssistant;
    this.channelManager = options.channelManager;
    this.backgroundAssistant = options.backgroundAssistant;
    this.devicePairingManager = options.devicePairingManager;
    this.sessionContinuityManager = options.sessionContinuityManager;
    this.permissions = options.permissionStore ?? new PermissionGrantStore({ initial: [] });
    const initialConfiguration =
      options.browserExcludedDomains === undefined
        ? options.configuration
        : {
            ...options.configuration,
            permissions: {
              ...options.configuration.permissions,
              browser_excluded_domains: options.browserExcludedDomains,
            },
          };
    this.configuration = new ConfigurationStore({
      initial: initialConfiguration,
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    });
    this.adaptivePersonalization =
      options.adaptivePersonalization ??
      new AdaptivePersonalization(this.configuration, undefined, this.logger);
    this.personalAnalytics = options.personalAnalytics ?? new PersonalAnalytics(this.logger);
    this.incidentManager =
      options.incidentManager ?? new IncidentManager({ owner: "desktop-runtime" });
    this.runbookManager = options.runbookManager;
    this.capabilityRegistry = options.capabilityRegistry;
    this.localModelManager = options.localModelManager;
    this.modelRouter = options.modelRouter;
    this.runtimeManager = options.runtimeManager;
    this.performanceBudgetEvaluator =
      options.performanceBudgetEvaluator ?? new PerformanceBudgetEvaluator();
    this.voicePipeline = options.voicePipeline;
    this.pluginDiscovery = options.pluginDiscovery;
    this.pluginManager = options.pluginManager;
    this.jobScheduler = options.jobScheduler;
    this.systemLifecycle = options.systemLifecycle;
    this.networkDiscovery = options.networkDiscovery;
    this.systemInventory = options.systemInventory;
    this.hardwareDetector = options.hardwareDetector;
    this.backupManager = options.backupManager;
    this.restoreManager = options.restoreManager;
    this.upgradeManager = options.upgradeManager;
    this.repairManager = options.repairManager;
    this.resourceManager = options.resourceManager;
    this.resourceArbitrator = options.resourceArbitrator;
    this.offlineActionQueue = options.offlineActionQueue;
    this.setupWizard = options.setupWizard;
    this.workspaceManager = options.workspaceManager;
    this.events = new CommunicationBusEventJournal(bus);
    this.worldModel = new WorldModel(this.logger === undefined ? {} : { logger: this.logger });
    this.worldModel.attach(bus);
    this.windowsObserver = new WindowsApplicationObserver({
      permissions: this.permissions,
      bridge: options.windowObserverBridge ?? new NativeWindowsEventBridge(),
      bus,
    });
    this.clipboardObserver = new ClipboardObserver({
      permissions: this.permissions,
      bridge: options.clipboardObserverBridge ?? new NativeClipboardEventBridge(),
      bus,
    });
    this.notificationObserver = new NotificationObserver({
      permissions: this.permissions,
      bridge: options.notificationObserverBridge ?? new NativeNotificationEventBridge(),
      bus,
    });
    this.browserObserver = new BrowserObserver({
      permissions: this.permissions,
      bridge: options.browserObserverBridge ?? new NativeBrowserEventBridge(),
      bus,
      excludedDomains: this.configuration.snapshot().permissions.browser_excluded_domains ?? [],
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    });
    this.keyboardObserver = new KeyboardObserver({
      permissions: this.permissions,
      bridge: options.keyboardObserverBridge ?? new NativeKeyboardEventBridge(),
      bus,
      hotkeys: options.keyboardHotkeys ?? [],
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    });
    this.mouseObserver = new MouseObserver({
      permissions: this.permissions,
      bridge: options.mouseObserverBridge ?? new NativeMouseEventBridge(),
      bus,
      ...(options.mouseIdleThresholdMs === undefined
        ? {}
        : { idleThresholdMs: options.mouseIdleThresholdMs }),
      ...(this.logger === undefined ? {} : { logger: this.logger }),
    });
    this.configuration.subscribe((configuration) => {
      this.browserObserver.setExcludedDomains(
        configuration.permissions.browser_excluded_domains ?? [],
      );
    });
    this.webhook = options.webhookManager ?? new WebhookManager({});
    this.coordinator = new RuntimeTaskCoordinator({
      tasks: this.tasks,
      planner: options.planner,
      executor: options.executor,
      verifier: options.verifier,
      events: bus,
      ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
      ...(options.maxReplanAttempts === undefined ? {} : { maxReplanAttempts: options.maxReplanAttempts }),
    });
    this.scheduler =
      options.scheduler ??
      (options.taskSchedulerOptions === undefined
        ? undefined
        : new TaskScheduler(
            { execute: (taskId) => this.coordinator.execute(taskId) },
            options.taskSchedulerOptions,
          ));
    this.workflowEngine = options.workflowEngine;
    this.rest = new PublicApiServer(this.restOptions(options));
    this.websocket = new PublicWebSocketServer({
      tokenIssuer: this.tokenIssuer,
      events: this.events,
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.websocketPort === undefined ? {} : { port: options.websocketPort }),
      authorizeTopics:
        options.authorizeTopics ??
        (({ topics }) => topics.every((topic) => topic === "task.progress")),
    });
  }

  public addMcpServer(server: McpServerConfiguration): Result<McpServerConfiguration> {
    return this.configuration.addMcpServer(server);
  }

  public requestMcpServerApproval(
    serverId: string,
    confirmed: boolean,
  ): Result<McpServerConfiguration> {
    return this.configuration.requestMcpServerApproval(serverId, confirmed);
  }

  public approveMcpServer(serverId: string, confirmed: boolean): Result<McpServerConfiguration> {
    return this.configuration.approveMcpServer(serverId, confirmed);
  }

  public disableMcpServer(serverId: string, confirmed: boolean): Result<McpServerConfiguration> {
    return this.configuration.disableMcpServer(serverId, confirmed);
  }

  public enableMcpServer(serverId: string, confirmed: boolean): Result<McpServerConfiguration> {
    return this.configuration.enableMcpServer(serverId, confirmed);
  }

  public removeMcpServer(serverId: string, confirmed: boolean): Result<RemovedMcpServer> {
    return this.configuration.removeMcpServer(serverId, confirmed);
  }

  public updateConfiguration<TSection extends ConfigurationSectionName>(
    section: TSection,
    value: NovaConfiguration[TSection],
    confirmed: boolean,
  ): Result<void> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing configuration requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.configuration.update(section, value);
  }

  public async setPermission(
    source: string,
    granted: boolean,
    confirmed: boolean,
  ): Promise<Result<readonly StoredPermissionGrant[]>> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing an observation permission requires explicit confirmation.",
        retryable: false,
      });
    }
    const updated = this.permissions.update(source, granted);
    if (!updated.ok) return err(updated.error);
    const observerSync = await this.syncObservers();
    if (!observerSync.ok) return err(observerSync.error);
    return ok(this.permissions.list());
  }

  public async start(): Promise<void> {
    this.logger?.info("runtime.start.begin", {
      persistence_enabled: this.optionsPersistence !== undefined,
    });
    if (this.optionsPersistence) {
      const recovered = await this.optionsPersistence.recoverAfterCrash();
      if (!recovered.ok) {
        this.logger?.error("runtime.recovery.failed", { error_code: recovered.error.code });
        throw new Error(recovered.error.message);
      }
      this.tasks.restore(recovered.value);
      this.logger?.info("runtime.recovery.completed", {
        recovered_task_count: recovered.value.length,
      });
    }
    const observers = await this.syncObservers();
    if (!observers.ok) {
      this.logger?.error("runtime.observers.sync_failed", { error_code: observers.error.code });
      throw new Error(observers.error.message);
    }
    await this.rest.start();
    try {
      await this.websocket.start();
      this.logger?.info("runtime.started", { observer_state: observers.value });
    } catch (cause) {
      this.logger?.error("runtime.start.failed", { component: "websocket" });
      await this.rest.stop();
      throw cause;
    }
  }

  public async stop(): Promise<void> {
    this.logger?.info("runtime.stop.begin", {});
    try {
      if (this.windowsObserver.state() !== "Disabled") await this.windowsObserver.revoke();
      if (this.clipboardObserver.state() !== "Disabled") await this.clipboardObserver.revoke();
      if (this.notificationObserver.state() !== "Disabled")
        await this.notificationObserver.revoke();
      if (this.browserObserver.state() !== "Disabled") await this.browserObserver.revoke();
      if (this.keyboardObserver.state() !== "Disabled") await this.keyboardObserver.revoke();
      if (this.mouseObserver.state() !== "Disabled") await this.mouseObserver.revoke();
      this.worldModel.detach();
      await this.websocket.stop();
      await this.rest.stop();
      this.logger?.info("runtime.stopped", {});
    } catch (cause) {
      this.logger?.error("runtime.stop.failed", { component: "runtime" });
      throw cause;
    } finally {
      await this.dispose?.();
    }
  }

  public async executeToolStep(
    input: ExecutionStep,
  ): Promise<
    Result<{ readonly execution: ExecutionResult; readonly verification: VerificationVerdict }>
  > {
    this.logger?.info(
      "runtime.task_step.begin",
      {
        task_id: input.task_id,
        step_id: input.step_id,
        tool_id: input.resolved_tool_id,
        action_id: input.action_id,
      },
      input.correlation_id,
    );
    const execution = await this.executor.execute(input);
    if (!execution.ok) {
      this.logger?.warning(
        "runtime.task_step.execution_rejected",
        { step_id: input.step_id, error_code: execution.error.code },
        input.correlation_id,
      );
      return execution;
    }
    const verification = this.verifier.verify(input, execution.value);
    if (!verification.ok) {
      this.logger?.error(
        "runtime.task_step.verification_failed",
        { step_id: input.step_id, error_code: verification.error.code },
        input.correlation_id,
      );
      return verification;
    }
    this.logger?.info(
      "runtime.task_step.completed",
      {
        step_id: input.step_id,
        execution_status: execution.value.status,
        verification_outcome: verification.value.outcome,
      },
      input.correlation_id,
    );
    return ok({ execution: execution.value, verification: verification.value });
  }

  public async adoptObservation(
    request: ObservationIndexRequest,
  ): Promise<Result<ObservationIndexResult>> {
    this.logger?.debug(
      "runtime.observation.adoption_begin",
      { task_id: request.task_id, topic: request.event.topic },
      request.event.correlation_id,
    );
    if (!this.observationIndexer) {
      this.logger?.warning(
        "runtime.observation.adoption_rejected",
        { topic: request.event.topic, error_code: "NOVA-MEM001" },
        request.event.correlation_id,
      );
      return err({
        code: "NOVA-MEM001",
        message: "Observation indexing is not configured for this runtime.",
        retryable: true,
      });
    }
    const result = await this.observationIndexer.index(request);
    this.logger?.info(
      result.ok ? "runtime.observation.adopted" : "runtime.observation.adoption_failed",
      {
        topic: request.event.topic,
        ...(result.ok
          ? result.value.persisted
            ? { memory_id: result.value.memory_id }
            : { persisted: false }
          : { error_code: result.error.code }),
      },
      request.event.correlation_id,
    );
    return result;
  }

  public async syncObservers(): Promise<Result<WindowsObserverState>> {
    const keyboard = await this.syncKeyboardObserver();
    if (!keyboard.ok) return err(keyboard.error);
    const browser = await this.syncBrowserObserver();
    if (!browser.ok) return err(browser.error);
    const mouse = await this.syncMouseObserver();
    if (!mouse.ok) return err(mouse.error);
    const clipboard = await this.syncClipboardObserver();
    if (!clipboard.ok) return err(clipboard.error);
    const notifications = await this.syncNotificationObserver();
    if (!notifications.ok) return err(notifications.error);
    const grants = new Map(this.permissions.list().map((grant) => [grant.source, grant.granted]));
    const permitted = grants.get("applications") === true && grants.get("windows") === true;
    if (!permitted) {
      if (this.windowsObserver.state() !== "Disabled") return await this.windowsObserver.revoke();
      return ok("Disabled");
    }
    if (this.windowsObserver.state() === "Disabled") return await this.windowsObserver.enable();
    return ok(this.windowsObserver.state());
  }

  public async syncClipboardObserver(): Promise<Result<ClipboardObserverState>> {
    const metadataGranted = this.permissions
      .list()
      .some((grant) => grant.source === "clipboard_metadata" && grant.granted);
    if (!metadataGranted) {
      if (this.clipboardObserver.state() !== "Disabled")
        return await this.clipboardObserver.revoke();
      return ok("Disabled");
    }
    if (this.clipboardObserver.state() === "Disabled") return await this.clipboardObserver.enable();
    return ok(this.clipboardObserver.state());
  }

  public async syncNotificationObserver(): Promise<Result<NotificationObserverState>> {
    const metadataGranted = this.permissions
      .list()
      .some((grant) => grant.source === "notifications_metadata" && grant.granted);
    if (!metadataGranted) {
      if (this.notificationObserver.state() !== "Disabled")
        return await this.notificationObserver.revoke();
      return ok("Disabled");
    }
    if (this.notificationObserver.state() === "Disabled")
      return await this.notificationObserver.enable();
    return ok(this.notificationObserver.state());
  }

  public async syncKeyboardObserver(): Promise<Result<KeyboardObserverState>> {
    const activityGranted = this.permissions
      .list()
      .some((grant) => grant.source === "keyboard_activity" && grant.granted);
    if (!activityGranted) {
      if (this.keyboardObserver.state() !== "Disabled") return await this.keyboardObserver.revoke();
      return ok("Disabled");
    }
    if (this.keyboardObserver.state() === "Disabled") return await this.keyboardObserver.enable();
    return ok(this.keyboardObserver.state());
  }

  public async syncMouseObserver(): Promise<Result<MouseObserverState>> {
    const activityGranted = this.permissions
      .list()
      .some((grant) => grant.source === "mouse_activity" && grant.granted);
    if (!activityGranted) {
      if (this.mouseObserver.state() !== "Disabled") return await this.mouseObserver.revoke();
      return ok("Disabled");
    }
    if (this.mouseObserver.state() === "Disabled") return await this.mouseObserver.enable();
    return ok(this.mouseObserver.state());
  }

  public async syncBrowserObserver(): Promise<Result<BrowserObserverState>> {
    const metadataGranted = this.permissions
      .list()
      .some((grant) => grant.source === "browser_metadata" && grant.granted);
    if (!metadataGranted) {
      if (this.browserObserver.state() !== "Disabled") return await this.browserObserver.revoke();
      return ok("Disabled");
    }
    if (this.browserObserver.state() === "Disabled") return await this.browserObserver.enable();
    return ok(this.browserObserver.state());
  }

  public async captureBrowserEvent(event: NativeBrowserEvent): Promise<Result<void>> {
    return await this.browserObserver.captureAndPublish(event);
  }

  public placeTask(input: DistributedPlacementInput): Result<DistributedPlacementResult> {
    return this.distributedTaskCoordinator.place(input);
  }

  public async syncDevices(): Promise<Result<SyncResult>> {
    if (!this.crossDeviceSyncManager) {
      return err({
        code: "NOVA-EVT001",
        message: "Cross-device synchronization is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.crossDeviceSyncManager.sync();
  }

  public async flushDeviceSync(confirmed: boolean): Promise<Result<FlushResult>> {
    if (!this.crossDeviceSyncManager) {
      return err({
        code: "NOVA-EVT001",
        message: "Cross-device synchronization is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Pushing device-sync changes requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.crossDeviceSyncManager.flush();
  }

  public getAndroidCompanionPermission(permission: string): Result<CompanionPermissionState> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    return ok(this.androidCompanionManager.permission(permission));
  }

  public setAndroidCompanionPermission(
    permission: string,
    granted: boolean,
    confirmed: boolean,
  ): Result<void> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing an Android companion permission requires explicit confirmation.",
        retryable: false,
      });
    }
    return granted
      ? this.androidCompanionManager.grant(permission)
      : this.androidCompanionManager.revoke(permission);
  }

  public checkAndroidCompanionCapability(
    capability: CompanionCapability,
  ): ReturnType<AndroidCompanionManager["use"]> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    return this.androidCompanionManager.use(capability);
  }

  public async generateBackgroundBriefing(trigger: BriefingTrigger): Promise<Result<Briefing>> {
    if (!this.backgroundAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Background assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.backgroundAssistant.generate(trigger);
  }

  public async deliverBackgroundBriefing(briefing: Briefing): Promise<Result<void>> {
    if (!this.backgroundAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Background assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.backgroundAssistant.deliver(briefing);
  }

  public generatePersonalAnalytics(input: AnalyticsInput): AnalyticsReport {
    return this.personalAnalytics.generate(input);
  }

  public async handleRunbook(
    incident: RunbookIncident,
    confirmed: boolean,
  ): Promise<Result<RunbookResult>> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Executing a recovery runbook requires explicit confirmation.",
        retryable: false,
      });
    }
    if (!this.runbookManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Runbook manager is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.runbookManager.handle(incident);
  }

  public discoverLocalModels(hardware: HardwareProfile): readonly LocalModelDiscovery[] {
    return this.localModelManager?.discover(hardware) ?? [];
  }
  public async downloadLocalModel(
    modelId: string,
    confirmed: boolean,
  ): Promise<Result<LocalModelDownloadResult>> {
    if (!this.localModelManager) return err(this.localModelManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Downloading a local model requires explicit confirmation.",
        retryable: false,
      });
    }
    const result = await this.localModelManager.download(modelId);
    if (!result.ok) return result;
    return ok({
      model_id: result.value.model_id,
      provider_id: result.value.provider_id,
      path: result.value.path,
      sha256: result.value.sha256,
      bytes: result.value.bytes,
      status: result.value.status,
    });
  }
  public async loadLocalModel(
    modelId: string,
    confirmed: boolean,
  ): Promise<Result<LocalModelLoadResult>> {
    if (!this.localModelManager) return err(this.localModelManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Loading a local model requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.localModelManager.load(modelId);
  }
  public retireLocalModel(modelId: string, confirmed: boolean): Result<LocalModelRetirementResult> {
    if (!this.localModelManager) return err(this.localModelManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Marking a local model reclaimable requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.localModelManager.markRetired(modelId);
  }
  public reclaimableLocalModelSummaries(): Result<readonly ReclaimableLocalModelSummary[]> {
    if (!this.localModelManager) return err(this.localModelManagerUnavailableError());
    return ok(this.localModelManager.reclaimableSummaries());
  }

  public modelProviderHealth(providerId: string): Result<HealthState> {
    if (!this.modelRouter) return err(this.modelRouterUnavailableError());
    return ok(this.modelRouter.health(providerId));
  }
  public listModelProviderHealthStatuses(): Result<readonly ProviderHealthStatus[]> {
    if (!this.modelRouter) return err(this.modelRouterUnavailableError());
    return ok(this.modelRouter.providerHealthStatuses());
  }

  public compareDeviceVersions(left: string, right: string): Result<CompatibilityResult> {
    return ok(compareDeviceVersions(left, right));
  }

  public compareLogicalClockValues(
    left: LogicalClockValue,
    right: LogicalClockValue,
  ): Result<number> {
    return ok(LogicalClock.compare(left, right));
  }

  public evaluatePerformanceBudgets(samples: BudgetSamples): Result<PerformanceBudgetReport> {
    return ok(this.performanceBudgetEvaluator.evaluate(samples));
  }

  public runtimeServiceHealth(serviceName: string): Result<ServiceHealth> {
    if (!this.runtimeManager) return err(this.runtimeManagerUnavailableError());
    return ok(this.runtimeManager.health(serviceName));
  }

  public async enablePlugin(pluginId: string, confirmed: boolean): Promise<Result<PluginRecord>> {
    if (!this.pluginManager) return err(this.pluginManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Enabling a plugin requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.pluginManager.enable(pluginId);
  }

  public async disablePlugin(pluginId: string, confirmed: boolean): Promise<Result<PluginRecord>> {
    if (!this.pluginManager) return err(this.pluginManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Disabling a plugin requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.pluginManager.disable(pluginId);
  }

  public async uninstallPlugin(pluginId: string, confirmed: boolean): Promise<Result<void>> {
    if (!this.pluginManager) return err(this.pluginManagerUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Uninstalling a plugin requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.pluginManager.uninstall(pluginId);
  }

  public pluginRecord(pluginId: string): Result<PluginRecord> {
    if (!this.pluginManager) return err(this.pluginManagerUnavailableError());
    return this.pluginManager.get(pluginId);
  }
  public pluginRecordSummaries(): Result<readonly PluginRecordSummary[]> {
    if (!this.pluginManager) return err(this.pluginManagerUnavailableError());
    return ok(this.pluginManager.listSummaries());
  }
  public listToolSummaries(): Result<readonly RegisteredToolSummary[]> {
    return ok(this.toolRegistry.listSummaries());
  }
  public getTask(taskId: string): Result<TaskRecord> {
    return this.tasks.get(taskId);
  }

  public listTasks(): readonly TaskRecord[] {
    return this.tasks.list();
  }

  public taskSchedulerStatus(): Result<TaskSchedulerStatus> {
    if (!this.scheduler) {
      return err({
        code: "NOVA-SEC001",
        message: "Task scheduler is not configured for this runtime.",
        retryable: false,
      });
    }
    return ok(this.scheduler.status());
  }
  public cancelTask(taskId: string, confirmed: boolean): Result<TaskRecord> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Cancelling a task requires explicit confirmation.",
        retryable: false,
      });
    }
    const current = this.tasks.get(taskId);
    if (!current.ok) return current;
    if (current.value.state === "Cancelled") return current;
    this.scheduler?.cancel(taskId);
    if (!cancellableTaskStates.has(current.value.state)) {
      return err({
        code: "NOVA-TL003",
        message: "Running task cancellation is not supported by the current executor.",
        retryable: false,
        details: { taskId, state: current.value.state },
      });
    }
    return this.tasks.transition(taskId, "Cancelled");
  }

  public pauseTask(taskId: string, confirmed: boolean): Result<TaskRecord> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Pausing a task requires explicit confirmation.",
        retryable: false,
      });
    }
    const current = this.tasks.get(taskId);
    if (!current.ok) return current;
    if (current.value.state !== "Created") {
      return err({
        code: "NOVA-TL003",
        message: "Active task execution cannot be interrupted by the current scheduler.",
        retryable: false,
        details: { taskId, state: current.value.state },
      });
    }
    this.scheduler?.cancel(taskId);
    return this.tasks.transition(taskId, "Paused");
  }

  public async retryTask(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    return this.coordinator.retry(taskId, confirmed);
  }
  public async resumePausedTask(taskId: string, confirmed: boolean): Promise<Result<TaskRecord>> {
    return this.coordinator.resumePaused(taskId, confirmed);
  }
  public async confirmWaitingUserTask(
    taskId: string,
    confirmed: boolean,
  ): Promise<Result<TaskRecord>> {
    return this.coordinator.confirmWaitingUser(taskId, confirmed);
  }
  public async denyWaitingUserTask(
    taskId: string,
    confirmed: boolean,
  ): Promise<Result<TaskRecord>> {
    return this.coordinator.denyWaitingUser(taskId, confirmed);
  }
  public workflowCheckpointSummaries(
    workflowId: string,
  ): Result<readonly WorkflowCheckpointSummary[]> {
    if (!this.workflowEngine) {
      return err({
        code: "NOVA-SEC001",
        message: "Workflow engine is not configured for this runtime.",
        retryable: false,
      });
    }
    return ok(this.workflowEngine.checkpointSummaries(workflowId));
  }
  public async resumeWorkflowCheckpoint(
    checkpointId: string,
    confirmed: boolean,
  ): Promise<Result<WorkflowResult>> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Resuming a workflow checkpoint requires explicit confirmation.",
        retryable: false,
      });
    }
    if (!this.workflowEngine) {
      return err({
        code: "NOVA-SEC001",
        message: "Workflow engine is not configured for this runtime.",
        retryable: false,
      });
    }
    return this.workflowEngine.resume(checkpointId);
  }

  public listScheduledJobStates(): Result<readonly JobState[]> {
    if (!this.jobScheduler) return err(this.jobSchedulerUnavailableError());
    return ok(this.jobScheduler.listStates());
  }
  public activeScheduledJobConcurrencyGroups(): Result<readonly string[]> {
    if (!this.jobScheduler) return err(this.jobSchedulerUnavailableError());
    return ok(this.jobScheduler.activeGroups());
  }

  public jobState(jobId: string): Result<JobState> {
    if (!this.jobScheduler) return err(this.jobSchedulerUnavailableError());
    return this.jobScheduler.get(jobId);
  }

  public systemStartupLog(): Result<readonly StartupStep[]> {
    if (!this.systemLifecycle) return err(this.systemLifecycleUnavailableError());
    return ok(this.systemLifecycle.startupLog());
  }

  public systemShutdownLog(): Result<readonly ShutdownStep[]> {
    if (!this.systemLifecycle) return err(this.systemLifecycleUnavailableError());
    return ok(this.systemLifecycle.shutdownLog());
  }

  public networkState(): Result<ConnectionState> {
    if (!this.networkDiscovery) return err(this.networkDiscoveryUnavailableError());
    return ok(this.networkDiscovery.state());
  }

  public hardwareCapabilitySummary(): Result<HardwareCapabilitySummary> {
    const summary = this.hardwareDetector?.lastCapabilitySummary();
    if (!summary) return err(this.hardwareSummaryUnavailableError());
    return ok(summary);
  }
  public remoteControlSessionStatuses(): Result<readonly RemoteSessionView[]> {
    if (!this.remoteControlManager) return err(this.remoteControlUnavailableError());
    return ok(this.remoteControlManager.listSessions());
  }
  public remoteControlPreApprovalStatuses(): Result<readonly RemotePreApprovalView[]> {
    if (!this.remoteControlManager) return err(this.remoteControlUnavailableError());
    return ok(this.remoteControlManager.listPreApprovals());
  }
  public async rescanHardwareCapabilitySummary(): Promise<Result<HardwareCapabilitySummary>> {
    if (!this.hardwareDetector) return err(this.hardwareSummaryUnavailableError());
    try {
      await this.hardwareDetector.rescan();
      const summary = this.hardwareDetector.lastCapabilitySummary();
      if (!summary) return err(this.hardwareSummaryUnavailableError());
      return ok(summary);
    } catch {
      return err({
        code: "NOVA-CFG001",
        message: "Hardware capability rescan failed.",
        retryable: true,
      });
    }
  }
  public async systemInventorySummary(): Promise<Result<SystemInventorySummary>> {
    if (!this.systemInventory) return err(this.systemInventoryUnavailableError());
    try {
      return ok(summarizeSystemInventory(await this.systemInventory.collect()));
    } catch {
      return err({
        code: "NOVA-CFG001",
        message: "System inventory collection failed validation.",
        retryable: true,
      });
    }
  }

  public sessionDeviceSnapshots(): Result<readonly DeviceSnapshot[]> {
    if (!this.sessionContinuityManager) return err(this.sessionContinuityUnavailableError());
    return ok(this.sessionContinuityManager.listDevices());
  }

  public workspaceIdentity(): Result<WorkspaceIdentity> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return ok(this.workspaceManager.identity());
  }

  public workspaceState(): Result<WorkspaceState> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return ok(this.workspaceManager.state());
  }

  public createWorkspace(workspaceId: string, confirmed: boolean): Result<WorkspaceIdentity> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Creating a workspace requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.workspaceManager.createWorkspace(workspaceId);
  }

  public activateWorkspace(confirmed: boolean): Result<void> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Activating a workspace requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.workspaceManager.activate();
  }

  public acquireWorkspaceLock(reason: string): Result<WorkspaceLock> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return this.workspaceManager.acquireLock(reason);
  }

  public releaseWorkspaceLock(token: string): Result<void> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return this.workspaceManager.releaseLock(token);
  }

  public expireWorkspaceLock(): Result<{ state: "Recovering" }> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return this.workspaceManager.expireLock();
  }

  public beginWorkspaceRecovery(): Result<{ state: "Recovering" }> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return this.workspaceManager.beginRecovery();
  }

  public completeWorkspaceRecovery(): Result<{ state: "Active" }> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return this.workspaceManager.completeRecovery();
  }

  public workspaceCanSync(): Result<boolean> {
    if (!this.workspaceManager) return err(this.workspaceUnavailableError());
    return ok(this.workspaceManager.canSync());
  }

  public async startSetupWizard(confirmed: boolean): Promise<Result<SetupState>> {
    if (!this.setupWizard) return err(this.setupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Starting the setup wizard requires explicit confirmation.",
        retryable: false,
      });
    }
    try {
      return ok(await this.setupWizard.start());
    } catch {
      return err(this.setupFailureError("Setup wizard could not start."));
    }
  }

  public async rerunSetupWizard(confirmed: boolean): Promise<Result<SetupState>> {
    if (!this.setupWizard) return err(this.setupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Rerunning the setup wizard requires explicit confirmation.",
        retryable: false,
      });
    }
    try {
      return ok(await this.setupWizard.rerun());
    } catch {
      return err(this.setupFailureError("Setup wizard could not rerun."));
    }
  }

  public completeSetupStep(
    step: SetupStepId,
    patch: SetupStepPatch | undefined,
    confirmed: boolean,
  ): Result<SetupState> {
    if (!this.setupWizard) return err(this.setupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Completing a setup step requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.setupWizard.complete(step, patch);
  }
  public deferSetupStep(step: SetupStepId, confirmed: boolean): Result<SetupState> {
    if (!this.setupWizard) return err(this.setupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Deferring a setup step requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.setupWizard.defer(step);
  }

  public setupSummary(): Result<SetupState> {
    if (!this.setupWizard) return err(this.setupUnavailableError());
    try {
      return ok(this.setupWizard.summary());
    } catch {
      return err(this.setupFailureError("Setup wizard has not been started."));
    }
  }

  public async submitOfflineAction(
    action: OfflineAction,
    confirmed: boolean,
  ): Promise<Result<{ status: "QueuedOffline" } | OfflineActionResult>> {
    if (!this.offlineActionQueue) return err(this.offlineUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Submitting an offline action requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.offlineActionQueue.submit(action);
  }

  public async reconnectOfflineActions(
    confirmed: boolean,
  ): Promise<Result<readonly OfflineActionResult[]>> {
    if (!this.offlineActionQueue) return err(this.offlineUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Reconnecting offline actions requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.offlineActionQueue.reconnect();
  }

  public acquireArbitratedResource(
    resource: string,
    request: ResourceRequest,
  ): Result<ResourceDecision> {
    if (!this.resourceArbitrator) return err(this.arbitrationUnavailableError());
    return this.resourceArbitrator.acquire(resource, request);
  }

  public releaseArbitratedResource(
    resource: string,
    requestId: string,
  ): Result<{ readonly granted_request_id?: string }> {
    if (!this.resourceArbitrator) return err(this.arbitrationUnavailableError());
    return this.resourceArbitrator.release(resource, requestId);
  }

  public acquireResources(taskId: string, resources: readonly string[]): Result<LockGrant> {
    if (!this.resourceManager) return err(this.resourceUnavailableError());
    return this.resourceManager.acquire(taskId, resources);
  }

  public releaseResources(taskId: string): Result<readonly string[]> {
    if (!this.resourceManager) return err(this.resourceUnavailableError());
    return this.resourceManager.release(taskId);
  }

  public resourceHolder(resource: string): string | undefined {
    return this.resourceManager?.holder(resource);
  }
  public heldResourceLocks(): Result<readonly HeldResourceLock[]> {
    if (!this.resourceManager) return err(this.resourceUnavailableError());
    return ok(this.resourceManager.listHeldLocks());
  }

  public expireResourceLocks(): readonly string[] {
    return this.resourceManager?.expireLocks() ?? [];
  }

  public async repairRuntime(
    request: RepairRequest = { apply: false },
    confirmed = false,
  ): Promise<Result<RepairResult>> {
    if (!this.repairManager) return err(this.repairUnavailableError());
    if (request.apply && !confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Applying runtime repairs requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.repairManager.repair(request);
  }

  public async upgradeRuntime(
    request: UpgradeRequest,
    confirmed: boolean,
  ): Promise<Result<UpgradeResult>> {
    if (!this.upgradeManager) return err(this.upgradeUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Runtime upgrade requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.upgradeManager.upgrade(request);
  }

  public async prepareRestore(snapshotId: string): Promise<Result<PreparedRestore>> {
    if (!this.restoreManager) return err(this.restoreUnavailableError());
    return await this.restoreManager.prepare(snapshotId);
  }

  public async applyPreparedRestore(
    prepared: PreparedRestore,
    confirmed: boolean,
  ): Promise<Result<void>> {
    if (!this.restoreManager) return err(this.restoreUnavailableError());
    return await this.restoreManager.apply(prepared, confirmed);
  }

  public createBackup<T>(state: T, confirmed: boolean): Result<SnapshotMetadata> {
    if (!this.backupManager) return err(this.backupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Creating a backup snapshot requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.backupManager.create(state);
  }

  public preUpdateBackup<T>(state: T, confirmed: boolean): Result<SnapshotMetadata> {
    if (!this.backupManager) return err(this.backupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Creating a pre-update backup requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.backupManager.preUpdate(state);
  }

  public restoreBackup<T>(snapshotId: string, confirmed: boolean): Result<T> {
    if (!this.backupManager) return err(this.backupUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Restoring a backup snapshot requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.backupManager.restore<T>(snapshotId);
  }

  public async discoverPluginsForGap(gap: CapabilityGap): Promise<Result<PluginDiscoveryResult>> {
    if (!this.pluginDiscovery) return err(this.pluginUnavailableError());
    return await this.pluginDiscovery.discover(gap);
  }

  public confirmPluginDiscovery(
    pluginId: string,
    confirmed: boolean,
  ): Result<{ readonly plugin_id: string; readonly status: "approved" }> {
    if (!this.pluginDiscovery) return err(this.pluginUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Approving a plugin discovery proposal requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.pluginDiscovery.confirm(pluginId);
  }

  public declinePluginDiscovery(pluginId: string, confirmed: boolean): Result<void> {
    if (!this.pluginDiscovery) return err(this.pluginUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Declining a plugin-discovery proposal requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.pluginDiscovery.decline(pluginId);
  }

  public pendingPluginDiscovery(): readonly PluginDiscoveryProposal[] {
    return this.pluginDiscovery?.pending() ?? [];
  }

  public async startVoicePipeline(confirmed: boolean): Promise<Result<{ state: VoiceState }>> {
    if (!this.voicePipeline) return err(this.voiceUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Starting the voice pipeline requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.voicePipeline.start();
  }

  public async stopVoicePipeline(confirmed: boolean): Promise<Result<{ state: VoiceState }>> {
    if (!this.voicePipeline) return err(this.voiceUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Stopping the voice pipeline requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.voicePipeline.stop();
  }

  public bargeInVoice(): Result<{ state: VoiceState }> {
    if (!this.voicePipeline) return err(this.voiceUnavailableError());
    return this.voicePipeline.bargeIn();
  }

  public voicePipelineState(): VoiceState | "Unavailable" {
    return this.voicePipeline?.currentState() ?? "Unavailable";
  }

  public getCapabilityRecord(capabilityId: string): Result<CapabilityRecord> {
    if (!this.capabilityRegistry) return err(this.capabilityUnavailableError());
    return this.capabilityRegistry.get(capabilityId);
  }
  public listCapabilityRecords(): Result<readonly CapabilityRecord[]> {
    if (!this.capabilityRegistry) return err(this.capabilityUnavailableError());
    return ok(this.capabilityRegistry.listCapabilities());
  }

  public setCapabilityProviderEnabled(
    capabilityId: string,
    providerId: string,
    enabled: boolean,
    confirmed: boolean,
  ): Result<CapabilityRecord> {
    if (!this.capabilityRegistry) return err(this.capabilityUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing a capability provider enabled state requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.capabilityRegistry.setEnabled(capabilityId, providerId, enabled);
  }

  public setCapabilityProviderPriority(
    capabilityId: string,
    providerId: string,
    priority: number,
    confirmed: boolean,
  ): Result<CapabilityRecord> {
    if (!this.capabilityRegistry) return err(this.capabilityUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing a capability provider priority requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.capabilityRegistry.setPriority(capabilityId, providerId, priority);
  }

  public setCapabilityPolicy(
    capabilityId: string,
    policy: CapabilityPolicy,
    confirmed: boolean,
  ): Result<CapabilityRecord> {
    if (!this.capabilityRegistry) return err(this.capabilityUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Changing a capability routing policy requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.capabilityRegistry.setPolicy(capabilityId, policy);
  }

  public detectIncident(detail: string): Result<IncidentEntry> {
    return this.incidentManager.detect(detail);
  }

  public triageIncident(
    incidentId: string,
    severity: IncidentSeverity,
    confirmed: boolean,
  ): Result<IncidentEntry> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Triaging an incident requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.incidentManager.triage(incidentId, severity);
  }

  public mitigateIncident(
    incidentId: string,
    detail: string,
    confirmed: boolean,
  ): Result<IncidentEntry> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Mitigating an incident requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.incidentManager.mitigate(incidentId, detail);
  }

  public resolveIncident(
    incidentId: string,
    detail: string,
    confirmed: boolean,
  ): Result<IncidentEntry> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Resolving an incident requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.incidentManager.resolve(incidentId, detail);
  }

  public postmortemIncident(
    incidentId: string,
    detail: string,
    confirmed: boolean,
  ): Result<IncidentEntry> {
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Recording an incident postmortem requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.incidentManager.postmortem(incidentId, detail);
  }

  public incidentTimeline(incidentId: string): readonly IncidentEntry[] {
    return this.incidentManager.timeline(incidentId);
  }

  public proposeAdaptivePreference(
    input: AdaptivePreferenceInput,
  ): Result<AdaptivePreferenceProposal> {
    if (!this.adaptivePersonalization) return err(this.adaptiveUnavailableError());
    return this.adaptivePersonalization.propose(input);
  }

  public approveAdaptivePreference(proposalId: string, confirmed: boolean): Result<void> {
    if (!this.adaptivePersonalization) return err(this.adaptiveUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Approving an adaptive preference requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.adaptivePersonalization.approve(proposalId);
  }

  public dismissAdaptivePreference(proposalId: string, confirmed: boolean): Result<void> {
    if (!this.adaptivePersonalization) return err(this.adaptiveUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Dismissing an adaptive preference proposal requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.adaptivePersonalization.dismiss(proposalId);
  }

  public pendingAdaptivePreferences(): readonly AdaptivePreferenceProposal[] {
    return this.adaptivePersonalization?.pending() ?? [];
  }
  public pendingAdaptivePreferenceSummaries(): readonly AdaptivePreferenceSummary[] {
    return this.adaptivePersonalization?.pendingSummaries() ?? [];
  }

  public resetAdaptivePreference(
    preferenceId: string | undefined,
    confirmed: boolean,
  ): Result<void> {
    if (!this.adaptivePersonalization) return err(this.adaptiveUnavailableError());
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Resetting adaptive preferences requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.adaptivePersonalization.reset(preferenceId);
  }

  public async sendChannelMessage(
    channelId: string,
    chatId: string,
    content: string,
    confirmed: boolean,
  ): Promise<Result<DeliveryReceipt>> {
    if (!this.channelManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Messaging channels are not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Sending a channel message requires explicit confirmation.",
        retryable: false,
      });
    }
    return await this.channelManager.send(channelId, chatId, content);
  }

  public receiveChannelMessage(
    channelId: string,
    message: Omit<InboundMessage, "channel_id">,
  ): Result<void> {
    if (!this.channelManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Messaging channels are not configured for this runtime.",
        retryable: true,
      });
    }
    return this.channelManager.receive(channelId, message);
  }

  public getChannelMediaCapabilities(channelId: string): Result<MediaCapabilities> {
    if (!this.channelManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Messaging channels are not configured for this runtime.",
        retryable: true,
      });
    }
    return this.channelManager.mediaCapabilities(channelId);
  }

  public async upcomingCalendarEvents(): Promise<Result<readonly CalendarEvent[]>> {
    if (!this.calendarAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Calendar assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.calendarAssistant.upcoming();
  }

  public async proposeCalendarEvent(draft: CalendarDraft): Promise<Result<CalendarProposal>> {
    if (!this.calendarAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Calendar assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.calendarAssistant.propose(draft);
  }

  public async createCalendarEvent(
    draft: CalendarDraft,
    confirmed: boolean,
  ): Promise<Result<CalendarEvent>> {
    if (!this.calendarAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Calendar assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.calendarAssistant.create(draft, confirmed);
  }

  public async readEmail(query: EmailQuery): Promise<Result<readonly EmailMessage[]>> {
    if (!this.emailAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Email assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.emailAssistant.read(query);
  }

  public draftEmail(input: EmailDraft): Result<EmailDraft> {
    if (!this.emailAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Email assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return this.emailAssistant.draft(input);
  }

  public async sendEmail(draft: EmailDraft, confirmed: boolean): Promise<Result<EmailSendReceipt>> {
    if (!this.emailAssistant) {
      return err({
        code: "NOVA-SEC001",
        message: "Email assistant is not configured for this runtime.",
        retryable: true,
      });
    }
    return await this.emailAssistant.send(draft, confirmed);
  }

  public startAndroidCompanionForegroundService(confirmed: boolean): Result<void> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message:
          "Starting the Android companion foreground service requires explicit confirmation.",
        retryable: false,
      });
    }
    this.androidCompanionManager.startForegroundService();
    return ok(undefined);
  }

  public stopAndroidCompanionForegroundService(confirmed: boolean): Result<void> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message:
          "Stopping the Android companion foreground service requires explicit confirmation.",
        retryable: false,
      });
    }
    this.androidCompanionManager.stopForegroundService();
    return ok(undefined);
  }

  public startAndroidCompanionBackground(capabilityId: string, confirmed: boolean): Result<void> {
    if (!this.androidCompanionManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion is not configured for this runtime.",
        retryable: true,
      });
    }
    if (capabilityId.trim() === "") {
      return err({
        code: "NOVA-SEC001",
        message: "Android companion capability ID is required.",
        retryable: false,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Starting Android companion background operation requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.androidCompanionManager.startBackground(capabilityId);
  }

  public listTrustedDevices(): readonly TrustedDevice[] {
    return this.devicePairingManager?.listTrusted() ?? [];
  }

  public createPairingOffer(
    input: Parameters<DevicePairingManager["createOffer"]>[0],
    confirmed: boolean,
  ): Result<PairingOffer> {
    if (!this.devicePairingManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Device pairing is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Creating a device-pairing offer requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.devicePairingManager.createOffer(input);
  }

  public completePairing(code: string, request: PairingRequest): Result<TrustedDevice> {
    if (!this.devicePairingManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Device pairing is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!request.confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Completing device pairing requires explicit confirmation.",
        retryable: false,
      });
    }
    return this.devicePairingManager.completePairing(code, request);
  }
  public listDeviceSnapshots(): readonly DeviceSnapshot[] {
    return this.sessionContinuityManager?.listDevices() ?? [];
  }

  public revokeTrustedDevice(deviceId: string, confirmed: boolean): Result<void> {
    if (!this.devicePairingManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Device pairing is not configured for this runtime.",
        retryable: true,
      });
    }
    if (!confirmed) {
      return err({
        code: "NOVA-SEC001",
        message: "Revoking a trusted device requires explicit confirmation.",
        retryable: false,
      });
    }
    const result = this.devicePairingManager.unpair(deviceId);
    if (result.ok) {
      this.sessionContinuityManager?.unregisterDevice(deviceId);
      this.remoteControlManager?.revoke(deviceId);
    }
    return result;
  }

  public negotiateDeviceCapability(
    deviceId: string,
    capabilityId: string,
  ): ReturnType<SessionContinuityManager["negotiate"]> {
    if (!this.sessionContinuityManager) {
      return err({
        code: "NOVA-SEC001",
        message: "Device capability negotiation is not configured for this runtime.",
        retryable: true,
      });
    }
    return this.sessionContinuityManager.negotiate(deviceId, capabilityId);
  }

  public issueToken(scopes: Parameters<LocalApiTokenIssuer["issue"]>[0]): string {
    return this.tokenIssuer.issue(scopes);
  }

  public restUrl(): string {
    return this.rest.url();
  }

  public websocketUrl(): string {
    return this.websocket.url();
  }
  public webhookHealthSummary(id: string): Result<WebhookHealthSummary> {
    try {
      return ok(this.webhook.healthSummary(id));
    } catch {
      return err({
        code: "NOVA-SEC001",
        message: "Webhook health is unavailable for the requested registration.",
        retryable: false,
      });
    }
  }

  public async searchMemory(
    input: MemorySearchInput,
  ): Promise<Result<readonly MemoryRecordSummary[]>> {
    if (!this.memoryStore) {
      return err({
        code: "NOVA-MEM001",
        message: "Nova memory store is not ready.",
        retryable: true,
      });
    }
    return await this.memoryStore.search(input);
  }

  public async getMemoryRecord(input: string): Promise<Result<MemoryRecordSummary>> {
    if (!this.memoryStore) {
      return err({
        code: "NOVA-MEM001",
        message: "Nova memory store is not ready.",
        retryable: true,
      });
    }
    return await this.memoryStore.readRecord(input);
  }

  public queryGraph(input: PublicGraphQueryInput): Result<GraphQueryResult> {
    return this.knowledgeGraph.query({
      node_id: input.node_id,
      direction: input.direction,
      depth: input.depth,
      ...(input.edge_type === undefined ? {} : { edge_type: input.edge_type as GraphEdgeType }),
    });
  }

  private sessionContinuityUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Session continuity is not configured for this runtime.",
      retryable: false,
    };
  }

  private remoteControlUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Remote control is not configured for this runtime.",
      retryable: true,
    };
  }
  private hardwareSummaryUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Hardware capability summary is unavailable until a scan completes.",
      retryable: true,
    };
  }
  private systemInventoryUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "System inventory is not configured for this runtime.",
      retryable: false,
    };
  }

  private networkDiscoveryUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Network discovery manager is not configured for this runtime.",
      retryable: false,
    };
  }

  private systemLifecycleUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "System lifecycle orchestrator is not configured for this runtime.",
      retryable: false,
    };
  }

  private jobSchedulerUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Job scheduler is not configured for this runtime.",
      retryable: false,
    };
  }

  private pluginManagerUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Plugin manager is not configured for this runtime.",
      retryable: false,
    };
  }

  private runtimeManagerUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Runtime manager is not configured for this runtime.",
      retryable: false,
    };
  }

  private localModelManagerUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Local model manager is not configured for this runtime.",
      retryable: false,
    };
  }
  private modelRouterUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Model router is not configured for this runtime.",
      retryable: false,
    };
  }

  private workspaceUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: false;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Workspace manager is not configured for this runtime.",
      retryable: false,
    };
  }

  private setupUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Setup wizard is not configured for this runtime.",
      retryable: true,
    };
  }

  private setupFailureError(message: string): {
    code: "NOVA-CFG001";
    message: string;
    retryable: false;
  } {
    return { code: "NOVA-CFG001", message, retryable: false };
  }

  private offlineUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Offline action queue is not configured for this runtime.",
      retryable: true,
    };
  }

  private arbitrationUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Resource arbitration is not configured for this runtime.",
      retryable: true,
    };
  }

  private resourceUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Resource manager is not configured for this runtime.",
      retryable: true,
    };
  }

  private repairUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Repair manager is not configured for this runtime.",
      retryable: true,
    };
  }

  private upgradeUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Upgrade manager is not configured for this runtime.",
      retryable: true,
    };
  }

  private restoreUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Restore manager is not configured for this runtime.",
      retryable: true,
    };
  }

  private backupUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Backup manager is not configured for this runtime.",
      retryable: true,
    };
  }

  private pluginUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Plugin discovery is not configured for this runtime.",
      retryable: true,
    };
  }

  private voiceUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Voice pipeline is not configured for this runtime.",
      retryable: true,
    };
  }

  private capabilityUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Capability registry is not configured for this runtime.",
      retryable: true,
    };
  }

  private adaptiveUnavailableError(): {
    code: "NOVA-SEC001";
    message: string;
    retryable: true;
  } {
    return {
      code: "NOVA-SEC001",
      message: "Adaptive personalization is not configured for this runtime.",
      retryable: true,
    };
  }

  private restOptions(options: RuntimeApplicationOptions): PublicApiServerOptions {
    return {
      tokenIssuer: this.tokenIssuer,
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.restPort === undefined ? {} : { port: options.restPort }),
      handlers: {
        submitTask: async (input) => {
          const result = this.optionsPersistence
            ? await this.coordinator.submitDurable({ goal: input.goal })
            : this.coordinator.submit({ goal: input.goal });
          if (!result.ok) throw new Error(result.error.message);
          if (this.scheduler) {
            this.scheduler.enqueue(result.value.task_id, input.priority);
            void this.scheduler.dispatch();
          }
          return result.value;
        },
        getTask: async (taskId) => {
          const result = this.tasks.get(taskId);
          return result.ok ? result.value : undefined;
        },
        listTasks: async () => this.tasks.list(),
        search: async (input) => {
          const result = await this.searchMemory(input);
          if (!result.ok) throw new Error(result.error.message);
          return { results: result.value, query: input.query };
        },
        getMemoryRecord: async (recordId) => {
          const result = await this.getMemoryRecord(recordId);
          if (!result.ok) {
            if (result.error.code === "NOVA-MEM003") return undefined;
            throw new Error(result.error.message);
          }
          return result.value;
        },
        queryGraph: async (input) => {
          const result = this.queryGraph(input);
          if (!result.ok) {
            if (result.error.code === "NOVA-MEM003") return undefined;
            throw new Error(result.error.message);
          }
          return result.value;
        },
        listPermissions: async () => this.permissions.list(),
        updatePermission: async (grantId, patch) => {
          const result = this.permissions.update(grantId, patch.granted);
          return result.ok ? result.value : undefined;
        },
        getConfig: async () => this.configuration.snapshot(),
        updateConfig: async (input) => {
          const result = this.configuration.update(input.section, input.value as never);
          if (!result.ok) throw new Error(result.error.message);
          return this.configuration.snapshot();
        },
        registerWebhook: async (input) => this.webhook.register(input),
      },
    };
  }
}
