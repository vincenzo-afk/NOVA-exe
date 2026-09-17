import type {
  ConfigurationSectionName,
  DeviceRuntimeMode,
  HealthState,
  BudgetSamples,
  PerformanceBudgetReport,
  CompatibilityResult,
  LogicalClockValue,
  ConnectionState,
  SystemInventorySummary,
  DeviceSnapshot,
  HardwareCapabilitySummary,
  JobState,
  SetupStepId,
  SetupStepPatch,
  WorkspaceIdentity,
  WorkspaceLock,
  WorkspaceState,
  McpServerConfiguration,
  NovaConfiguration,
  PairingRequest,
} from "@nova/runtime";
import type { ServiceHealth, ShutdownStep, StartupStep } from "@nova/shared";
import type { PermissionGrant } from "./shell-model.js";

interface DesktopMcpServerSummary {
  server_id: string;
  label: string;
  state: "Discovered" | "Pending approval" | "Connected" | "Disabled" | "Removed";
  transport: "stdio" | "streamable-http";
}

interface DesktopMemorySearchInput {
  query: string;
  filters?: {
    project?: string;
    time_range?: { start: string; end: string };
    entity_type?: string;
  };
}

interface DesktopMemoryRecord {
  record_id: string;
  tier: "working" | "recent" | "long_term";
  content_ref: string;
  confidence?: number;
  schema_version: string;
  created_at: string;
  status?: string;
  lineage: Array<{ relation: string; source_record_id: string }>;
}

interface DesktopGraphQueryInput {
  node_id: string;
  direction: "in" | "out" | "both";
  edge_type?: string;
  depth: number;
}

interface DesktopTaskSummary {
  task_id: string;
  state: string;
  retry_count: number;
  updated_at: string;
}

interface DesktopSetupStateSummary {
  current_step: SetupStepId;
  completed_steps: readonly SetupStepId[];
  deferred_steps: readonly SetupStepId[];
}

interface DesktopGraphQueryResult {
  root: {
    id: string;
    type: string;
    name: string;
    properties: Record<string, string | number | boolean>;
    active: boolean;
  };
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    properties: Record<string, string | number | boolean>;
    active: boolean;
  }>;
  edges: Array<{
    id: string;
    type: string;
    from_node_id: string;
    to_node_id: string;
    weight: number;
  }>;
}

declare global {
  interface Window {
    nova: {
      submitTask: (goal: string) => Promise<DesktopTaskSummary>;
      getTask: (taskId: string) => Promise<DesktopTaskSummary>;
      listTasks: (
        limit?: number,
        cursor?: string,
      ) => Promise<{
        items: Array<DesktopTaskSummary>;
        next_cursor: string | null;
        has_more: boolean;
      }>;
      cancelTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      searchMemory: (input: DesktopMemorySearchInput) => Promise<{
        results: DesktopMemoryRecord[];
        query: string;
      }>;
      getMemoryRecord: (recordId: string) => Promise<DesktopMemoryRecord>;
      queryGraph: (input: DesktopGraphQueryInput) => Promise<DesktopGraphQueryResult>;
      syncDevices: () => Promise<{
        ok: boolean;
        value?: { checkpoint: number; applied_change_ids: string[] };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      flushDeviceSync: (confirmed: boolean) => Promise<{
        ok: boolean;
        value?: { pushed_change_ids: string[] };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      getAndroidCompanionPermission: (permission: string) => Promise<{
        ok: boolean;
        value?: "Granted" | "Revoked";
        error?: { code: string; message: string; retryable: boolean };
      }>;
      setAndroidCompanionPermission: (
        permission: string,
        granted: boolean,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      checkAndroidCompanionCapability: (input: {
        capability_id: string;
        required_permissions: string[];
      }) => Promise<{
        ok: boolean;
        value?: { status: "Available"; device_id: string };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      startAndroidCompanionForegroundService: (confirmed: boolean) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      stopAndroidCompanionForegroundService: (confirmed: boolean) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      startAndroidCompanionBackground: (
        capabilityId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      readEmail: (query: { from?: string; subject?: string }) => Promise<{
        ok: boolean;
        value?: readonly {
          id: string;
          sender: string;
          subject: string;
          body: string;
          attachments: readonly unknown[];
        }[];
        error?: { code: string; message: string; retryable: boolean };
      }>;
      draftEmail: (draft: { to: string; subject: string; body: string }) => Promise<{
        ok: boolean;
        value?: { to: string; subject: string; body: string };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      sendEmail: (
        draft: { to: string; subject: string; body: string },
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        value?: { message_id: string; sent: true };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      sendChannelMessage: (
        channelId: string,
        chatId: string,
        content: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        value?: { message_id: string; status: "sent" | "failed" };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      receiveChannelMessage: (
        channelId: string,
        message: {
          sender_id: string;
          chat_id: string;
          text: string;
          attachments: readonly unknown[];
        },
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      getChannelMediaCapabilities: (channelId: string) => Promise<{
        ok: boolean;
        value?: { images: boolean; audio: boolean; files: boolean };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      generateBackgroundBriefing: (
        trigger: "time-based" | "event-based" | "explicit-request",
      ) => Promise<{
        ok: boolean;
        value?: {
          trigger: "time-based" | "event-based" | "explicit-request";
          items: readonly {
            title: string;
            summary: string;
            source_id: string;
            requires_confirmation: boolean;
          }[];
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      deliverBackgroundBriefing: (briefing: {
        trigger: "time-based" | "event-based" | "explicit-request";
        items: readonly {
          title: string;
          summary: string;
          source_id: string;
          requires_confirmation: boolean;
        }[];
      }) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      proposeAdaptivePreference: (input: {
        id: string;
        category:
          "tool-default" | "provider-default" | "proactive-timing" | "routing-preference" | "tone";
        value: unknown;
      }) => Promise<{
        ok: boolean;
        value?: {
          proposal_id: string;
          status: "pending";
          preference: {
            id: string;
            category:
              | "tool-default"
              | "provider-default"
              | "proactive-timing"
              | "routing-preference"
              | "tone";
            value: unknown;
            enabled: boolean;
            source: "user" | "feedback";
            updated_at: string;
          };
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      approveAdaptivePreference: (
        proposalId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      dismissAdaptivePreference: (
        proposalId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      pendingAdaptivePreferences: () => Promise<
        readonly {
          proposal_id: string;
          status: "pending";
          preference: {
            id: string;
            category:
              | "tool-default"
              | "provider-default"
              | "proactive-timing"
              | "routing-preference"
              | "tone";
            value: unknown;
            enabled: boolean;
            source: "user" | "feedback";
            updated_at: string;
          };
        }[]
      >;
      pendingAdaptivePreferenceSummaries: () => Promise<
        readonly {
          proposal_id: string;
          status: "pending";
          category:
            | "tool-default"
            | "provider-default"
            | "proactive-timing"
            | "routing-preference"
            | "tone";
        }[]
      >;
      hardwareCapabilitySummary: () => Promise<HardwareCapabilitySummary>;
      rescanHardwareCapabilitySummary: () => Promise<HardwareCapabilitySummary>;
      remoteControlSessionStatuses: () => Promise<
        readonly {
          session_id: string;
          initiator_device_id: string;
          expires_at: number;
          state: "AwaitingApproval" | "Active" | "Expired" | "Revoked";
        }[]
      >;
      remoteControlPreApprovalStatuses: () => Promise<
        readonly { device_id: string; expires_at: number }[]
      >;
      listCapabilityRecords: () => Promise<
        readonly {
          capability_id: string;
          domain:
            | "llm"
            | "vision"
            | "speech-to-text"
            | "text-to-speech"
            | "embeddings"
            | "ocr"
            | "reranking"
            | "messaging-channel"
            | "remote-control";
          providers: readonly { provider_id: string; enabled: boolean; priority: number }[];
          active_policy: {
            policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
            manual_override?: string;
          };
          state: "Unconfigured" | "Configured, disabled" | "Active" | "Degraded";
        }[]
      >;
      heldResourceLocks: () => Promise<
        readonly { resource: string; task_id: string; acquired_at: number }[]
      >;
      listScheduledJobStates: () => Promise<readonly JobState[]>;
      activeScheduledJobConcurrencyGroups: () => Promise<readonly string[]>;
      resetAdaptivePreference: (
        preferenceId: string | undefined,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      generatePersonalAnalytics: (input: {
        period: { from: string; to: string };
        activity: readonly {
          occurred_at: string;
          source: string;
          domain: string;
          label: string;
          duration_ms: number;
        }[];
        tasks: readonly { task_id: string; state: string; updated_at: string }[];
        provider_usage: readonly {
          occurred_at: string;
          capability_id: string;
          provider_id: string;
          request_count: number;
          cost: number;
        }[];
        communications: readonly {
          occurred_at: string;
          channel: string;
          topic: string;
          message_count: number;
        }[];
      }) => {
        period: { from: string; to: string };
        time_allocation: readonly { domain: string; label: string; duration_ms: number }[];
        task_summary: { completed: number; in_progress: number; abandoned: number };
        provider_usage: readonly {
          capability_id: string;
          provider_id: string;
          request_count: number;
          cost: number;
        }[];
        communication_summary: readonly { channel: string; topic: string; message_count: number }[];
        totals: {
          activity_duration_ms: number;
          provider_cost: number;
          communication_messages: number;
        };
      };
      detectIncident: (detail: string) => Promise<{
        incident_id: string;
        stage: "Detected" | "Triaged" | "Mitigated" | "Resolved" | "Postmortem";
        owner: string;
        timestamp: number;
        detail: string;
        severity?: "Low" | "Medium" | "High" | "Critical";
      }>;
      triageIncident: (
        incidentId: string,
        severity: "Low" | "Medium" | "High" | "Critical",
        confirmed: boolean,
      ) => Promise<{
        incident_id: string;
        stage: "Triaged";
        owner: string;
        timestamp: number;
        detail: string;
        severity: "Low" | "Medium" | "High" | "Critical";
      }>;
      mitigateIncident: (
        incidentId: string,
        detail: string,
        confirmed: boolean,
      ) => Promise<{
        incident_id: string;
        stage: "Mitigated";
        owner: string;
        timestamp: number;
        detail: string;
        severity?: "Low" | "Medium" | "High" | "Critical";
      }>;
      resolveIncident: (
        incidentId: string,
        detail: string,
        confirmed: boolean,
      ) => Promise<{
        incident_id: string;
        stage: "Resolved";
        owner: string;
        timestamp: number;
        detail: string;
        severity?: "Low" | "Medium" | "High" | "Critical";
      }>;
      postmortemIncident: (
        incidentId: string,
        detail: string,
        confirmed: boolean,
      ) => Promise<{
        incident_id: string;
        stage: "Postmortem";
        owner: string;
        timestamp: number;
        detail: string;
        severity?: "Low" | "Medium" | "High" | "Critical";
      }>;
      incidentTimeline: (incidentId: string) => Promise<
        readonly {
          incident_id: string;
          stage: "Detected" | "Triaged" | "Mitigated" | "Resolved" | "Postmortem";
          owner: string;
          timestamp: number;
          detail: string;
          severity?: "Low" | "Medium" | "High" | "Critical";
        }[]
      >;
      handleRunbook: (
        incident: "startup-failure" | "provider-down" | "sync-failure",
        confirmed: boolean,
      ) => Promise<{
        state: "Resolved" | "Escalated";
        action: string;
      }>;
      getCapabilityRecord: (capabilityId: string) => Promise<{
        capability_id: string;
        domain: string;
        providers: readonly { provider_id: string; enabled: boolean; priority: number }[];
        active_policy: {
          policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
          manual_override?: string;
        };
        state: "Unconfigured" | "Configured, disabled" | "Active" | "Degraded";
      }>;
      setCapabilityProviderEnabled: (
        capabilityId: string,
        providerId: string,
        enabled: boolean,
        confirmed: boolean,
      ) => Promise<{
        capability_id: string;
        domain: string;
        providers: readonly { provider_id: string; enabled: boolean; priority: number }[];
        active_policy: {
          policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
          manual_override?: string;
        };
        state: "Unconfigured" | "Configured, disabled" | "Active" | "Degraded";
      }>;
      setCapabilityProviderPriority: (
        capabilityId: string,
        providerId: string,
        priority: number,
        confirmed: boolean,
      ) => Promise<{
        capability_id: string;
        domain: string;
        providers: readonly { provider_id: string; enabled: boolean; priority: number }[];
        active_policy: {
          policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
          manual_override?: string;
        };
        state: "Unconfigured" | "Configured, disabled" | "Active" | "Degraded";
      }>;
      setCapabilityPolicy: (
        capabilityId: string,
        policy: {
          policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
          manual_override?: string;
        },
        confirmed: boolean,
      ) => Promise<{
        capability_id: string;
        domain: string;
        providers: readonly { provider_id: string; enabled: boolean; priority: number }[];
        active_policy: {
          policy: "privacy-first" | "latency-optimized" | "cost-optimized" | "manual";
          manual_override?: string;
        };
        state: "Unconfigured" | "Configured, disabled" | "Active" | "Degraded";
      }>;
      discoverLocalModels: (hardware: {
        scanned_at: string;
        signals: Record<string, unknown>;
        overall_tier: "Minimal" | "Standard" | "High";
        recommendations: Record<string, string>;
      }) => Promise<
        readonly {
          model_id: string;
          provider_id: string;
          domain: string;
          adapter_id: string;
          minimum_hardware_tier: "Minimal" | "Standard" | "High";
          availability: "recommended" | "available-but-unrecommended";
          reason: "hardware_meets_minimum_tier" | "hardware_below_minimum_tier";
          status: "not-downloaded" | "downloaded" | "loaded" | "reclaimable";
        }[]
      >;
      modelProviderHealth: (providerId: string) => Promise<HealthState>;
      listModelProviderHealthStatuses: () => Promise<
        readonly { provider_id: string; health: HealthState }[]
      >;
      reclaimableLocalModelSummaries: () => Promise<
        readonly {
          model_id: string;
          provider_id: string;
          domain: string;
          status: "reclaimable";
        }[]
      >;
      websocketUrl: () => Promise<string>;
      restUrl: () => Promise<string>;
      webhookHealthSummary: (webhookId: string) => Promise<{
        id: string;
        topics: readonly string[];
        status: "healthy" | "unhealthy";
        failure_count: number;
      }>;
      pluginRecordSummaries: () => Promise<
        readonly {
          plugin_id: string;
          version: string;
          state:
            | "Installed"
            | "Enabled"
            | "Disabled"
            | "Updating"
            | "Failed"
            | "Deprecated"
            | "Uninstalled";
          provided_tool_count: number;
          required_permission_count: number;
        }[]
      >;
      listToolSummaries: () => Promise<
        readonly {
          tool_id: string;
          execution_tier:
            | "native_runtime"
            | "internal_function"
            | "api"
            | "mcp"
            | "cli"
            | "accessibility"
            | "vision"
            | "keyboard_mouse";
          deterministic: boolean;
          action_count: number;
          read_only_action_count: number;
          compensation_action_count: number;
        }[]
      >;
      taskSchedulerStatus: () => Promise<{
        queued_count: number;
        active_count: number;
        max_concurrent: number;
      }>;
      workflowCheckpointSummaries: (workflowId: string) => Promise<
        readonly {
          checkpoint_id: string;
          workflow_id: string;
          state: "Created" | "Valid" | "Superseded";
          completed_node_count: number;
          created_at: string;
        }[]
      >;
      retryTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      resumePausedTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      confirmWaitingUserTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      resumeWorkflowCheckpoint: (
        checkpointId: string,
        confirmed: boolean,
      ) => Promise<{
        workflow_id: string;
        state: "Running" | "Completed" | "Failed" | "Cancelled";
        completed_node_count: number;
        checkpoint_id: string;
      }>;
      denyWaitingUserTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      pauseTask: (taskId: string, confirmed: boolean) => Promise<DesktopTaskSummary>;
      evaluatePerformanceBudgets: (samples: BudgetSamples) => Promise<PerformanceBudgetReport>;
      compareDeviceVersions: (left: string, right: string) => Promise<CompatibilityResult>;
      runtimeServiceHealth: (serviceName: string) => Promise<ServiceHealth>;
      pluginRecord: (pluginId: string) => Promise<{
        plugin_id: string;
        version: string;
        state: string;
        provided_tool_count: number;
        required_permission_count: number;
      }>;
      jobState: (jobId: string) => Promise<JobState>;
      systemStartupLog: () => Promise<readonly StartupStep[]>;
      systemShutdownLog: () => Promise<readonly ShutdownStep[]>;
      compareLogicalClockValues: (
        left: LogicalClockValue,
        right: LogicalClockValue,
      ) => Promise<number>;
      networkState: () => Promise<ConnectionState>;
      systemInventorySummary: () => Promise<SystemInventorySummary>;
      sessionDeviceSnapshots: () => Promise<readonly DeviceSnapshot[]>;
      startVoicePipeline: (confirmed: boolean) => Promise<{
        state: "Idle" | "Listening" | "Transcribing" | "Thinking" | "Speaking";
      }>;
      stopVoicePipeline: (confirmed: boolean) => Promise<{
        state: "Idle" | "Listening" | "Transcribing" | "Thinking" | "Speaking";
      }>;
      bargeInVoice: () => Promise<{
        state: "Idle" | "Listening" | "Transcribing" | "Thinking" | "Speaking";
      }>;
      voicePipelineState: () => Promise<{
        state: "Idle" | "Listening" | "Transcribing" | "Thinking" | "Speaking" | "Unavailable";
      }>;
      discoverPluginsForGap: (gap: {
        capability_id: string;
        domain: string;
        enabled_provider_count: number;
        force?: boolean;
      }) => Promise<{
        capability_id: string;
        domain: string;
        proposals: readonly {
          plugin_id: string;
          latest_version: string;
          publisher: string;
          capability_count: number;
          required_permission_count: number;
          status: "pending";
        }[];
        fallback: "manual-settings" | null;
      }>;
      confirmPluginDiscovery: (
        pluginId: string,
        confirmed: boolean,
      ) => Promise<{
        plugin_id: string;
        status: "approved";
      }>;
      declinePluginDiscovery: (
        pluginId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      pendingPluginDiscovery: () => Promise<
        readonly {
          plugin_id: string;
          latest_version: string;
          publisher: string;
          capability_count: number;
          required_permission_count: number;
          status: "pending";
        }[]
      >;
      createBackup: (
        state: unknown,
        confirmed: boolean,
      ) => Promise<{
        snapshot_id: string;
        owner_id: string;
        encrypted: true;
        created_at: number;
        reason: "scheduled" | "pre-update";
      }>;
      preUpdateBackup: (
        state: unknown,
        confirmed: boolean,
      ) => Promise<{
        snapshot_id: string;
        owner_id: string;
        encrypted: true;
        created_at: number;
        reason: "scheduled" | "pre-update";
      }>;
      restoreBackup: (snapshotId: string, confirmed: boolean) => Promise<{ restored: true }>;
      prepareRestore: (snapshotId: string) => Promise<{
        restore_id: string;
        verified: true;
      }>;
      applyPreparedRestore: (
        restoreId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      upgradeRuntime: (
        request: { current_version: number; target_version: number },
        confirmed: boolean,
      ) => Promise<{
        status: "Upgraded";
        version: number;
      }>;
      repairRuntime: (
        request?: { apply: boolean },
        confirmed?: boolean,
      ) => Promise<{
        applied: readonly string[];
        reported: readonly { issue_id: string; kind: string; safe: boolean }[];
      }>;
      acquireResources: (
        taskId: string,
        resources: readonly string[],
      ) => Promise<{
        status: "granted" | "queued";
        task_id: string;
        resources: readonly string[];
      }>;
      releaseResources: (taskId: string) => Promise<readonly string[]>;
      resourceHolder: (resource: string) => Promise<{ task_id: string | null }>;
      expireResourceLocks: () => Promise<readonly string[]>;
      acquireArbitratedResource: (
        resource: string,
        request: {
          request_id: string;
          origin: "local" | "remote";
          explicit_remote_override?: boolean;
        },
      ) => Promise<{
        status: "Granted" | "Queued";
        request_id?: string;
      }>;
      releaseArbitratedResource: (
        resource: string,
        requestId: string,
      ) => Promise<{
        granted_request_id?: string;
      }>;
      submitOfflineAction: (
        action: {
          action_id: string;
          description: string;
        },
        confirmed: boolean,
      ) => Promise<
        { status: "QueuedOffline" } | { action_id: string; status: "completed" | "failed" }
      >;
      reconnectOfflineActions: (
        confirmed: boolean,
      ) => Promise<readonly { action_id: string; status: "completed" | "failed" }[]>;
      startSetupWizard: (confirmed: boolean) => Promise<DesktopSetupStateSummary>;
      rerunSetupWizard: (confirmed: boolean) => Promise<DesktopSetupStateSummary>;
      completeSetupStep: (
        step: SetupStepId,
        patch: SetupStepPatch | undefined,
        confirmed: boolean,
      ) => Promise<DesktopSetupStateSummary>;
      deferSetupStep: (step: SetupStepId, confirmed: boolean) => Promise<DesktopSetupStateSummary>;
      setupSummary: () => Promise<DesktopSetupStateSummary>;
      workspaceIdentity: () => Promise<WorkspaceIdentity>;
      workspaceState: () => Promise<WorkspaceState>;
      createWorkspace: (workspaceId: string, confirmed: boolean) => Promise<WorkspaceIdentity>;
      activateWorkspace: (confirmed: boolean) => Promise<void>;
      acquireWorkspaceLock: (reason: string) => Promise<WorkspaceLock>;
      releaseWorkspaceLock: (token: string) => Promise<void>;
      expireWorkspaceLock: () => Promise<{ state: "Recovering" }>;
      beginWorkspaceRecovery: () => Promise<{ state: "Recovering" }>;
      completeWorkspaceRecovery: () => Promise<{ state: "Active" }>;
      workspaceCanSync: () => Promise<boolean>;
      upcomingCalendarEvents: () => Promise<{
        ok: boolean;
        value?: readonly {
          id: string;
          title: string;
          start: number;
          end: number;
          owner: boolean;
          attendees: readonly string[];
        }[];
        error?: { code: string; message: string; retryable: boolean };
      }>;
      proposeCalendarEvent: (draft: {
        title: string;
        start: number;
        end: number;
        attendees: readonly string[];
        owner: boolean;
      }) => Promise<{
        ok: boolean;
        value?: {
          title: string;
          start: number;
          end: number;
          attendees: readonly string[];
          owner: boolean;
          conflicts: readonly {
            id: string;
            title: string;
            start: number;
            end: number;
            owner: boolean;
            attendees: readonly string[];
          }[];
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      createCalendarEvent: (
        draft: {
          title: string;
          start: number;
          end: number;
          attendees: readonly string[];
          owner: boolean;
        },
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        value?: {
          id: string;
          title: string;
          start: number;
          end: number;
          owner: boolean;
          attendees: readonly string[];
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      createPairingOffer: (
        input: {
          runtime_mode: DeviceRuntimeMode;
          primary_public_key: string;
        },
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        value?: {
          code: string;
          primary_public_key: string;
          runtime_mode: DeviceRuntimeMode;
          expires_at: number;
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      completePairing: (
        code: string,
        request: PairingRequest,
      ) => Promise<{
        ok: boolean;
        value?: {
          device_id: string;
          device_public_key: string;
          runtime_mode: DeviceRuntimeMode;
          state: "Trusted";
          paired_at: number;
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      revokeTrustedDevice: (
        deviceId: string,
        confirmed: boolean,
      ) => Promise<{
        ok: boolean;
        error?: { code: string; message: string; retryable: boolean };
      }>;
      getTrustedDevices: () => Promise<
        Array<{
          device_id: string;
          device_public_key: string;
          runtime_mode: "Full peer" | "Companion";
          state: "Trusted";
          paired_at: number;
        }>
      >;
      getDeviceSnapshots: () => Promise<
        Array<{
          device_id: string;
          presence: "Online" | "Idle" | "Busy" | "Sleeping" | "Offline" | "Syncing" | "Updating";
          capabilities: Array<{
            capability_id: string;
            status: "Supported" | "Not supported" | "Permission denied" | "Degraded";
          }>;
        }>
      >;
      negotiateDeviceCapability: (
        deviceId: string,
        capabilityId: string,
      ) => Promise<{
        ok: boolean;
        value?: {
          device_id: string;
          capability_id: string;
          status: "Supported" | "Not supported" | "Permission denied" | "Degraded";
        };
        error?: { code: string; message: string; retryable: boolean };
      }>;
      getDiagnostics: () => Promise<{
        collected_at: string;
        partial: boolean;
        records: Array<{
          timestamp: string;
          service: string;
          severity: "debug" | "info" | "warning" | "error" | "critical";
          event: string;
          correlation_id?: string;
        }>;
      }>;
      getUpdateInfo: () => Promise<{
        checked_at: string;
        current_version: string;
        latest_version: string | null;
        update_available: boolean;
        rollback_available: boolean;
        update_service: "not_configured";
        changelog: Array<{ version: string; date: string }>;
        partial: boolean;
      }>;
      validateWorkflow: (draft: {
        workflow_id: string;
        start_node_id: string;
        nodes: Array<{
          id: string;
          type:
            "task" | "decision" | "parallel_split" | "join" | "human_approval" | "rollback" | "end";
        }>;
        edges: Array<{ from: string; to: string; condition?: string }>;
      }) => Promise<
        | { valid: true; workflow_id: string; node_count: number; edge_count: number }
        | { valid: false; code: "NOVA-WFL001" | "NOVA-WFL002"; message: string }
      >;
      captureScreenshot: (request: {
        task_id: string;
        target: "screen" | "focused-window";
        max_bytes?: number;
      }) => Promise<{
        mime_type: "image/png";
        width: number;
        height: number;
        byte_length: number;
        data_base64: string;
        captured_at: string;
      }>;
      executeUiAction: (request: {
        task_id: string;
        action_id: string;
        action: "invoke" | "set_value";
        risk_tier: "read_only" | "reversible_write" | "destructive_irreversible";
        expected_window_id: string;
        target: { name?: string; automation_id?: string; control_type?: string };
        value?: string;
        confirmed?: boolean;
      }) => Promise<{
        action_id: string;
        outcome: "completed" | "unverified";
        verification: "accessibility_state";
        detail: string;
        resulting_value?: string;
        accessibility_state?: {
          task_id: string;
          window_id: string;
          name: string;
          automation_id: string;
          control_type: string;
          enabled: boolean;
          offscreen: boolean;
          value?: string;
        };
      }>;
      readAccessibilityState: (request: {
        task_id: string;
        expected_window_id: string;
        target: { name?: string; automation_id?: string; control_type?: string };
      }) => Promise<{
        task_id: string;
        window_id: string;
        name: string;
        automation_id: string;
        control_type: string;
        enabled: boolean;
        offscreen: boolean;
        value?: string;
      }>;
      getPermissions: () => Promise<PermissionGrant[]>;
      setPermission: (
        source: string,
        granted: boolean,
        confirmed: boolean,
      ) => Promise<PermissionGrant[]>;
      syncObservers: () => Promise<{ windows: string }>;
      syncClipboardObserver: () => Promise<{ clipboard: string }>;
      syncNotificationObserver: () => Promise<{ notifications: string }>;
      syncKeyboardObserver: () => Promise<{ keyboard: string }>;
      syncMouseObserver: () => Promise<{ mouse: string }>;
      syncBrowserObserver: () => Promise<{ browser: string }>;
      adoptObservation: (
        input: unknown,
      ) => Promise<
        | { readonly persisted: false; readonly reason: "no_task_context" }
        | { readonly persisted: true; readonly memory_id: string; readonly task_id: string }
      >;
      placeTask: (input: unknown) => Promise<unknown>;
      issueApiToken: (
        scopes: readonly string[],
        confirmed: boolean,
      ) => Promise<{ token: string; scopes: readonly string[] }>;
      getGoogleAccountStatus: () => Promise<{ connected: boolean; configured: boolean }>;
      connectGoogleAccount: () => Promise<{ connected: true }>;
      disconnectGoogleAccount: () => Promise<{ connected: false }>;
      getConfig: () => Promise<NovaConfiguration>;
      updateConfig: (
        section: ConfigurationSectionName,
        value: NovaConfiguration[ConfigurationSectionName],
        confirmed: boolean,
      ) => Promise<NovaConfiguration>;
      enablePlugin: (
        pluginId: string,
        confirmed: boolean,
      ) => Promise<{
        plugin_id: string;
        version: string;
        state: string;
        provided_tool_count: number;
        required_permission_count: number;
      }>;
      disablePlugin: (
        pluginId: string,
        confirmed: boolean,
      ) => Promise<{
        plugin_id: string;
        version: string;
        state: string;
        provided_tool_count: number;
        required_permission_count: number;
      }>;
      uninstallPlugin: (pluginId: string, confirmed: boolean) => Promise<void>;
      downloadLocalModel: (
        modelId: string,
        confirmed: boolean,
      ) => Promise<{
        model_id: string;
        provider_id: string;
        bytes: number;
        status: "downloaded" | "already-present";
      }>;
      loadLocalModel: (
        modelId: string,
        confirmed: boolean,
      ) => Promise<{
        model_id: string;
        provider_id: string;
        status: "loaded";
      }>;
      retireLocalModel: (
        modelId: string,
        confirmed: boolean,
      ) => Promise<{
        model_id: string;
        status: "reclaimable";
      }>;
      listMcpServers: () => Promise<DesktopMcpServerSummary[]>;
      addMcpServer: (
        server: McpServerConfiguration,
        confirmed: boolean,
      ) => Promise<DesktopMcpServerSummary>;
      requestMcpServerApproval: (
        serverId: string,
        confirmed: boolean,
      ) => Promise<DesktopMcpServerSummary>;
      approveMcpServer: (serverId: string, confirmed: boolean) => Promise<DesktopMcpServerSummary>;
      disableMcpServer: (serverId: string, confirmed: boolean) => Promise<DesktopMcpServerSummary>;
      enableMcpServer: (serverId: string, confirmed: boolean) => Promise<DesktopMcpServerSummary>;
      removeMcpServer: (
        serverId: string,
        confirmed: boolean,
      ) => Promise<{ server_id: string; state: "Removed" }>;
    };
  }
}

export {};
