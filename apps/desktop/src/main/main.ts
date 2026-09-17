import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type {
  MemorySearchInput,
  ObservationIndexRequest,
  ObservationIndexResult,
} from "@nova/memory";
import {
  ApiGateway,
  type ConfigurationSectionName,
  type NovaConfiguration,
  type ExecutionStep,
  type PermissionGrant,
  type RuntimeApplication,
  type GraphQueryInput,
  type DeviceRuntimeMode,
  type PairingRequest,
  type CompanionCapability,
  type EmailDraft,
  type EmailQuery,
  type CalendarDraft,
  type InboundMessage,
  type Briefing,
  type BriefingTrigger,
  type AdaptivePreferenceInput,
  type AdaptivePreferenceProposal,
  type AnalyticsInput,
  type AnalyticsReport,
  type IncidentSeverity,
  type IncidentEntry,
  type RunbookIncident,
  type RunbookResult,
  type CapabilityPolicy,
  type CapabilityRecord,
  type HardwareProfile,
  type LocalModelDiscovery,
  type HealthState,
  type BudgetSamples,
  type PerformanceBudgetReport,
  type ConnectionState,
  type SystemInventorySummary,
  type DeviceSnapshot,
  type CompatibilityResult,
  type LogicalClockValue,
  type JobState,
  type CapabilityGap,
  type McpServerConfiguration,
  type SnapshotMetadata,
  type PreparedRestore,
  type UpgradeRequest,
  type UpgradeResult,
  type RepairRequest,
  type RepairResult,
  type ResourceRequest,
  type ResourceDecision,
  type OfflineAction,
  type OfflineActionResult,
  type SetupStepId,
  type SetupStepPatch,
  type WorkspaceIdentity,
  type WorkspaceLock,
  type DistributedPlacementInput,
  type DistributedPlacementResult,
  type ApiScope,
} from "@nova/runtime";
import {
  createMessage,
  FileJsonlLogSink,
  NamedPipeCommunicationBus,
  StructuredLogger,
  type ServiceHealth,
  type StartupStep,
  type ShutdownStep,
} from "@nova/shared";
import { createDesktopRuntime, getEmailCalendarProviderSetup } from "./runtime.js";
import {
  DesktopAgentController,
  NativeDesktopAgentBridge,
  type ScreenshotRequest,
  type AccessibilityReadRequest,
  type UiActionRequest,
} from "./desktop-agent.js";
import { listDesktopTasks, type DesktopTaskListPage } from "./task-controls.js";
import { submitDesktopTask } from "./task-submission.js";
import { parseBrowserMetadataEvent } from "./browser-gateway.js";
import { readDiagnostics } from "./diagnostics.js";
import { readUpdateInfo } from "./update-info.js";
import { validateWorkflowDraft, type WorkflowDraft } from "./workflow-draft.js";
import {
  projectBackupRestore,
  projectChannelDeliveryReceipt,
  projectEmailSendReceipt,
  projectMcpServer,
  projectMcpServerRemoval,
  projectMcpServers,
  projectPairingOffer,
  projectPreparedRestore,
  projectPluginDiscoveryProposals,
  projectPluginDiscoveryResult,
  projectPluginRecord,
  projectSetupState,
  projectTaskRecord,
  projectTaskRecords,
  projectWorkflowResult,
} from "./response-projections.js";

interface TaskSnapshot {
  readonly task_id: string;
  readonly state: string;
  readonly retry_count: number;
  readonly updated_at: string;
}

const parseCalendarDraft = (data: unknown): CalendarDraft => {
  const draft = data as {
    readonly title?: unknown;
    readonly start?: unknown;
    readonly end?: unknown;
    readonly attendees?: unknown;
    readonly owner?: unknown;
  };
  if (
    typeof draft.title !== "string" ||
    draft.title.trim() === "" ||
    typeof draft.start !== "number" ||
    !Number.isFinite(draft.start) ||
    typeof draft.end !== "number" ||
    !Number.isFinite(draft.end) ||
    draft.end <= draft.start ||
    !Array.isArray(draft.attendees) ||
    !draft.attendees.every(
      (attendee): attendee is string => typeof attendee === "string" && attendee.trim() !== "",
    ) ||
    typeof draft.owner !== "boolean"
  ) {
    throw new Error("Calendar draft fields are invalid.");
  }
  return {
    title: draft.title,
    start: draft.start,
    end: draft.end,
    attendees: draft.attendees,
    owner: draft.owner,
  } satisfies CalendarDraft;
};
const parseBriefingTrigger = (value: unknown): BriefingTrigger => {
  if (value === "time-based" || value === "event-based" || value === "explicit-request")
    return value;
  throw new Error("Briefing trigger is invalid.");
};

const parseIncidentId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Incident ID is required.");
  return value;
};

const parseIncidentDetail = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("Incident detail is required.");
  return value;
};

const setupSteps = [
  "core-llm",
  "perception",
  "voice",
  "devices",
  "channels",
  "plugins",
  "routing",
  "security",
  "summary",
] as const satisfies readonly SetupStepId[];
const parseSetupStep = (value: unknown): SetupStepId => {
  if (typeof value !== "string" || !setupSteps.includes(value as SetupStepId))
    throw new Error("Setup step is invalid.");
  return value as SetupStepId;
};

const parseSetupPatch = (value: unknown): SetupStepPatch | undefined => {
  if (value === undefined) return undefined;
  const patch = value as { readonly section?: unknown; readonly value?: unknown };
  if (
    typeof patch.section !== "string" ||
    !configurationSections.has(patch.section) ||
    patch.value === undefined
  )
    throw new Error("Setup patch is invalid.");
  return patch as SetupStepPatch;
};

const parseWorkspaceText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${field} must be a non-empty string.`);
  return value;
};

const performanceSampleKeys = [
  "chat_first_token_local_ms",
  "chat_first_token_cloud_ms",
  "memory_query_ms",
  "app_cold_start_ms",
  "voice_round_trip_ms",
] as const;

const parseLogicalClockValue = (value: unknown, field: string): LogicalClockValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${field} must be an object.`);
  const input = value as { readonly counter?: unknown; readonly device_id?: unknown };
  if (
    typeof input.counter !== "number" ||
    !Number.isSafeInteger(input.counter) ||
    input.counter < 0 ||
    typeof input.device_id !== "string" ||
    input.device_id.trim() === ""
  )
    throw new Error(`${field} must contain a safe non-negative counter and device ID.`);
  return { counter: input.counter, device_id: input.device_id };
};

const parseBudgetSamples = (value: unknown): BudgetSamples => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Performance samples must be an object.");
  const input = value as Record<string, unknown>;
  const output: Partial<Record<(typeof performanceSampleKeys)[number], readonly number[]>> = {};
  for (const key of Object.keys(input)) {
    if (!performanceSampleKeys.includes(key as (typeof performanceSampleKeys)[number]))
      throw new Error("Performance sample metric is invalid.");
    const samples = input[key];
    if (
      !Array.isArray(samples) ||
      samples.length > 1_000 ||
      !samples.every(
        (sample) => typeof sample === "number" && Number.isFinite(sample) && sample >= 0,
      )
    )
      throw new Error("Performance samples must be bounded finite non-negative numbers.");
    output[key as (typeof performanceSampleKeys)[number]] = samples;
  }
  return output as BudgetSamples;
};

const parseOfflineAction = (value: unknown): OfflineAction => {
  const action = value as { readonly action_id?: unknown; readonly description?: unknown };
  if (
    typeof action.action_id !== "string" ||
    action.action_id.trim() === "" ||
    typeof action.description !== "string" ||
    action.description.trim() === ""
  )
    throw new Error("Offline action is invalid.");
  return action as OfflineAction;
};

const parseArbitrationRequest = (value: unknown): ResourceRequest => {
  const request = value as {
    readonly request_id?: unknown;
    readonly origin?: unknown;
    readonly explicit_remote_override?: unknown;
  };
  if (
    typeof request.request_id !== "string" ||
    request.request_id.trim() === "" ||
    (request.origin !== "local" && request.origin !== "remote") ||
    (request.explicit_remote_override !== undefined &&
      typeof request.explicit_remote_override !== "boolean")
  )
    throw new Error("Resource arbitration request is invalid.");
  return request as ResourceRequest;
};

const parseResourceTaskId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("Resource task ID is required.");
  return value;
};

const parseResourceName = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("Resource name is required.");
  return value;
};

const parseResourceList = (value: unknown): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.some((resource) => typeof resource !== "string" || resource.trim() === "")
  )
    throw new Error("Resource list is invalid.");
  return value;
};

const parseRepairRequest = (value: unknown): RepairRequest => {
  if (value === undefined) return { apply: false };
  const request = value as { readonly apply?: unknown };
  if (typeof request.apply !== "boolean") throw new Error("Repair request is invalid.");
  return { apply: request.apply };
};

const parseUpgradeRequest = (value: unknown): UpgradeRequest => {
  const request = value as {
    readonly current_version?: unknown;
    readonly target_version?: unknown;
  };
  if (
    typeof request.current_version !== "number" ||
    !Number.isSafeInteger(request.current_version) ||
    request.current_version < 0 ||
    typeof request.target_version !== "number" ||
    !Number.isSafeInteger(request.target_version) ||
    request.target_version < 0
  )
    throw new Error("Upgrade request is invalid.");
  return request as UpgradeRequest;
};

const parseSnapshotId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Snapshot ID is required.");
  return value;
};

const parseCapabilityGap = (value: unknown): CapabilityGap => {
  const gap = value as {
    readonly capability_id?: unknown;
    readonly domain?: unknown;
    readonly enabled_provider_count?: unknown;
    readonly force?: unknown;
  };
  if (
    typeof gap.capability_id !== "string" ||
    gap.capability_id.trim() === "" ||
    typeof gap.domain !== "string" ||
    gap.domain.trim() === "" ||
    typeof gap.enabled_provider_count !== "number" ||
    !Number.isSafeInteger(gap.enabled_provider_count) ||
    gap.enabled_provider_count < 0 ||
    (gap.force !== undefined && typeof gap.force !== "boolean")
  )
    throw new Error("Capability gap is invalid.");
  return gap as CapabilityGap;
};

const parseHardwareProfile = (value: unknown): HardwareProfile => {
  const profile = value as {
    readonly scanned_at?: unknown;
    readonly signals?: unknown;
    readonly overall_tier?: unknown;
    readonly recommendations?: unknown;
  };
  if (
    typeof profile.scanned_at !== "string" ||
    profile.signals === null ||
    typeof profile.signals !== "object" ||
    (profile.overall_tier !== "Minimal" &&
      profile.overall_tier !== "Standard" &&
      profile.overall_tier !== "High") ||
    profile.recommendations === null ||
    typeof profile.recommendations !== "object"
  )
    throw new Error("Hardware profile is invalid.");
  return profile as HardwareProfile;
};

const parseCapabilityId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error("Capability ID is required.");
  return value;
};

const parseProviderId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Provider ID is required.");
  return value;
};

const parseModelId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Model ID is required.");
  return value;
};

const parseCapabilityPolicy = (value: unknown): CapabilityPolicy => {
  const policy = value as { readonly policy?: unknown; readonly manual_override?: unknown };
  if (
    policy.policy !== "privacy-first" &&
    policy.policy !== "latency-optimized" &&
    policy.policy !== "cost-optimized" &&
    policy.policy !== "manual"
  )
    throw new Error("Capability policy is invalid.");
  if (policy.manual_override !== undefined && typeof policy.manual_override !== "string")
    throw new Error("Capability manual override is invalid.");
  return {
    policy: policy.policy,
    ...(policy.manual_override === undefined ? {} : { manual_override: policy.manual_override }),
  } satisfies CapabilityPolicy;
};

const parseRunbookIncident = (value: unknown): RunbookIncident => {
  if (value === "startup-failure" || value === "provider-down" || value === "sync-failure")
    return value;
  throw new Error("Runbook incident is invalid.");
};

const parseIncidentSeverity = (value: unknown): IncidentSeverity => {
  if (value === "Low" || value === "Medium" || value === "High" || value === "Critical")
    return value;
  throw new Error("Incident severity is invalid.");
};

const unwrapIncident = (result: {
  readonly ok: boolean;
  readonly value?: IncidentEntry;
  readonly error?: { readonly message: string };
}): IncidentEntry => {
  if (!result.ok || !result.value)
    throw new Error(result.error?.message ?? "Incident operation failed.");
  return result.value;
};

const parseAnalyticsInput = (data: unknown): AnalyticsInput => {
  const input = data as {
    readonly period?: { readonly from?: unknown; readonly to?: unknown };
    readonly activity?: unknown;
    readonly tasks?: unknown;
    readonly provider_usage?: unknown;
    readonly communications?: unknown;
  };
  if (
    typeof input.period?.from !== "string" ||
    typeof input.period.to !== "string" ||
    !Array.isArray(input.activity) ||
    !Array.isArray(input.tasks) ||
    !Array.isArray(input.provider_usage) ||
    !Array.isArray(input.communications)
  ) {
    throw new Error("Analytics input fields are invalid.");
  }
  const activity = input.activity.map((event) => {
    const value = event as Record<string, unknown>;
    if (
      typeof value.occurred_at !== "string" ||
      typeof value.source !== "string" ||
      typeof value.domain !== "string" ||
      typeof value.label !== "string" ||
      typeof value.duration_ms !== "number"
    )
      throw new Error("Analytics activity event is invalid.");
    return {
      occurred_at: value.occurred_at,
      source: value.source,
      domain: value.domain,
      label: value.label,
      duration_ms: value.duration_ms,
    };
  });
  const tasks = input.tasks.map((task) => {
    const value = task as Record<string, unknown>;
    if (
      typeof value.task_id !== "string" ||
      typeof value.state !== "string" ||
      typeof value.updated_at !== "string"
    )
      throw new Error("Analytics task record is invalid.");
    return { task_id: value.task_id, state: value.state, updated_at: value.updated_at };
  });
  const providerUsage = input.provider_usage.map((event) => {
    const value = event as Record<string, unknown>;
    if (
      typeof value.occurred_at !== "string" ||
      typeof value.capability_id !== "string" ||
      typeof value.provider_id !== "string" ||
      typeof value.request_count !== "number" ||
      typeof value.cost !== "number"
    )
      throw new Error("Analytics provider usage event is invalid.");
    return {
      occurred_at: value.occurred_at,
      capability_id: value.capability_id,
      provider_id: value.provider_id,
      request_count: value.request_count,
      cost: value.cost,
    };
  });
  const communications = input.communications.map((event) => {
    const value = event as Record<string, unknown>;
    if (
      typeof value.occurred_at !== "string" ||
      typeof value.channel !== "string" ||
      typeof value.topic !== "string" ||
      typeof value.message_count !== "number"
    )
      throw new Error("Analytics communication event is invalid.");
    return {
      occurred_at: value.occurred_at,
      channel: value.channel,
      topic: value.topic,
      message_count: value.message_count,
    };
  });
  return {
    period: { from: input.period.from, to: input.period.to },
    activity,
    tasks: tasks as AnalyticsInput["tasks"],
    provider_usage: providerUsage,
    communications,
  } satisfies AnalyticsInput;
};

const parseAdaptivePreferenceInput = (data: unknown): AdaptivePreferenceInput => {
  const input = data as {
    readonly id?: unknown;
    readonly category?: unknown;
    readonly value?: unknown;
  };
  if (
    typeof input.id !== "string" ||
    input.id.trim() === "" ||
    (input.category !== "tool-default" &&
      input.category !== "provider-default" &&
      input.category !== "proactive-timing" &&
      input.category !== "routing-preference" &&
      input.category !== "tone") ||
    input.value === undefined
  ) {
    throw new Error("Adaptive preference fields are invalid.");
  }
  return {
    id: input.id,
    category: input.category,
    value: input.value,
  } satisfies AdaptivePreferenceInput;
};

const parseBriefing = (data: unknown): Briefing => {
  const briefing = data as { readonly trigger?: unknown; readonly items?: unknown };
  if (!Array.isArray(briefing.items)) throw new Error("Briefing items are required.");
  const items = briefing.items.map((item) => {
    const value = item as {
      readonly title?: unknown;
      readonly summary?: unknown;
      readonly source_id?: unknown;
      readonly requires_confirmation?: unknown;
    };
    if (
      typeof value.title !== "string" ||
      typeof value.summary !== "string" ||
      typeof value.source_id !== "string" ||
      typeof value.requires_confirmation !== "boolean"
    ) {
      throw new Error("Briefing item fields are invalid.");
    }
    return {
      title: value.title,
      summary: value.summary,
      source_id: value.source_id,
      requires_confirmation: value.requires_confirmation,
    };
  });
  return { trigger: parseBriefingTrigger(briefing.trigger), items } satisfies Briefing;
};

let gatewayBus: NamedPipeCommunicationBus | undefined;
let runtimeApplication: RuntimeApplication | undefined;
let desktopAgent: DesktopAgentController | undefined;
const preparedRestores = new Map<string, PreparedRestore>();

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.NOVA_DEV_SERVER === "true") {
    await window.loadURL("http://127.0.0.1:5173");
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const requestGateway = async <TValue>(operation: string, data: unknown): Promise<TValue> => {
  if (!gatewayBus) throw new Error("Nova API Gateway is not ready.");
  const replyTo = `api.internal.response.${randomUUID()}`;
  const requestId = randomUUID();
  return await new Promise<TValue>((resolve, reject) => {
    const unsubscribe = gatewayBus?.subscribe(replyTo, async (message) => {
      unsubscribe?.();
      const payload = message.payload as {
        readonly ok?: boolean;
        readonly data?: TValue;
        readonly error?: { readonly message: string };
      };
      if (payload.ok) resolve(payload.data as TValue);
      else reject(new Error(payload.error?.message ?? "Nova API request failed."));
    });
    void gatewayBus
      ?.publish(
        createMessage({
          topic: "api.internal.request",
          schema_version: "1.0.0",
          correlation_id: randomUUID(),
          source_service: "ui.layer",
          payload: { operation, request_id: requestId, reply_to: replyTo, data },
        }),
      )
      .then((result) => {
        if (!result.ok) {
          unsubscribe?.();
          reject(new Error(result.error.message));
        }
      });
  });
};

const executeDesktopStep = async (
  input: Omit<
    ExecutionStep,
    "step_id" | "correlation_id" | "capability_id" | "task_id" | "confirmation_status"
  > & {
    readonly task_id: string;
    readonly confirmation_status: ExecutionStep["confirmation_status"];
  },
): Promise<unknown> => {
  if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
  const result = await runtimeApplication.executeToolStep({
    ...input,
    step_id: randomUUID(),
    correlation_id: randomUUID(),
    capability_id: "desktop-agent",
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.execution.evidence.value;
};

ipcMain.handle("nova:task:submit", (_event, payload: { readonly goal: string }) =>
  requestGateway<TaskSnapshot>("task.submit", { goal: payload.goal }),
);
ipcMain.handle(
  "nova:task:list",
  (_event, payload: { readonly limit?: number; readonly cursor?: string } = {}) => {
    if (
      payload.limit !== undefined &&
      (!Number.isInteger(payload.limit) || payload.limit <= 0 || payload.limit > 200)
    ) {
      throw new Error("Task list limit must be an integer from 1 to 200.");
    }
    if (payload.cursor !== undefined && typeof payload.cursor !== "string") {
      throw new Error("Task list cursor must be opaque text.");
    }
    return requestGateway<DesktopTaskListPage>("task.list", payload);
  },
);
ipcMain.handle(
  "nova:task:cancel",
  (_event, payload: { readonly task_id: string; readonly confirmed: boolean }) =>
    requestGateway<TaskSnapshot>("task.cancel", payload),
);
ipcMain.handle("nova:memory:search", (_event, payload: MemorySearchInput) =>
  requestGateway("memory.search", payload),
);
ipcMain.handle("nova:memory:record", (_event, payload: { readonly record_id: string }) =>
  requestGateway("memory.record", payload),
);
ipcMain.handle("nova:graph:query", (_event, payload: GraphQueryInput) =>
  requestGateway("graph.query", payload),
);
ipcMain.handle("nova:devices:sync", () => requestGateway("devices.sync", undefined));
ipcMain.handle("nova:companion:permission", (_event, permission: string) =>
  requestGateway("companion.permission", { permission }),
);
ipcMain.handle(
  "nova:companion:permission-set",
  (
    _event,
    payload: {
      readonly permission: string;
      readonly granted: boolean;
      readonly confirmed: boolean;
    },
  ) => requestGateway("companion.permission-set", payload),
);
ipcMain.handle("nova:companion:foreground-start", (_event, confirmed: boolean) =>
  requestGateway("companion.foreground-start", { confirmed }),
);
ipcMain.handle("nova:companion:foreground-stop", (_event, confirmed: boolean) =>
  requestGateway("companion.foreground-stop", { confirmed }),
);
ipcMain.handle("nova:calendar:upcoming", () => requestGateway("calendar.upcoming", undefined));
ipcMain.handle("nova:calendar:propose", (_event, draft: CalendarDraft) =>
  requestGateway("calendar.propose", draft),
);
ipcMain.handle(
  "nova:calendar:create",
  (_event, payload: { readonly draft: CalendarDraft; readonly confirmed: boolean }) =>
    requestGateway("calendar.create", payload),
);
ipcMain.handle(
  "nova:channel:send",
  (
    _event,
    payload: {
      readonly channel_id: string;
      readonly chat_id: string;
      readonly content: string;
      readonly confirmed: boolean;
    },
  ) => requestGateway("channel.send", payload),
);
ipcMain.handle(
  "nova:channel:receive",
  (
    _event,
    payload: { readonly channel_id: string; readonly message: Omit<InboundMessage, "channel_id"> },
  ) => requestGateway("channel.receive", payload),
);
ipcMain.handle("nova:channel:media", (_event, channelId: string) =>
  requestGateway("channel.media", channelId),
);
ipcMain.handle("nova:background:generate", (_event, trigger: BriefingTrigger) =>
  requestGateway("background.generate", { trigger }),
);
ipcMain.handle("nova:background:deliver", (_event, briefing: Briefing) =>
  requestGateway("background.deliver", briefing),
);
ipcMain.handle("nova:personalization:propose", (_event, input: AdaptivePreferenceInput) =>
  requestGateway("personalization.propose", input),
);
ipcMain.handle(
  "nova:personalization:approve",
  (_event, payload: { readonly proposal_id: string; readonly confirmed: boolean }) =>
    requestGateway("personalization.approve", payload),
);
ipcMain.handle(
  "nova:personalization:dismiss",
  (_event, payload: { readonly proposal_id: string; readonly confirmed: boolean }) =>
    requestGateway("personalization.dismiss", payload),
);
ipcMain.handle("nova:personalization:pending", () =>
  requestGateway("personalization.pending", undefined),
);
ipcMain.handle(
  "nova:personalization:reset",
  (_event, payload: { readonly preference_id?: string; readonly confirmed: boolean }) =>
    requestGateway("personalization.reset", payload),
);
ipcMain.handle("nova:analytics:generate", (_event, input: AnalyticsInput) =>
  requestGateway("analytics.generate", input),
);
ipcMain.handle("nova:incident:detect", (_event, detail: string) =>
  requestGateway("incident.detect", { detail }),
);
ipcMain.handle(
  "nova:incident:triage",
  (
    _event,
    payload: {
      readonly incident_id: string;
      readonly severity: IncidentSeverity;
      readonly confirmed: boolean;
    },
  ) => requestGateway("incident.triage", payload),
);
ipcMain.handle(
  "nova:incident:mitigate",
  (
    _event,
    payload: {
      readonly incident_id: string;
      readonly detail: string;
      readonly confirmed: boolean;
    },
  ) => requestGateway("incident.mitigate", payload),
);
ipcMain.handle(
  "nova:incident:resolve",
  (
    _event,
    payload: {
      readonly incident_id: string;
      readonly detail: string;
      readonly confirmed: boolean;
    },
  ) => requestGateway("incident.resolve", payload),
);
ipcMain.handle(
  "nova:incident:postmortem",
  (
    _event,
    payload: {
      readonly incident_id: string;
      readonly detail: string;
      readonly confirmed: boolean;
    },
  ) => requestGateway("incident.postmortem", payload),
);
ipcMain.handle("nova:incident:timeline", (_event, incidentId: string) =>
  requestGateway("incident.timeline", { incident_id: incidentId }),
);
ipcMain.handle(
  "nova:runbook:handle",
  (_event, payload: { readonly incident: RunbookIncident; readonly confirmed: boolean }) =>
    requestGateway("runbook.handle", payload),
);
ipcMain.handle("nova:capability:get", (_event, capabilityId: string) =>
  requestGateway("capability.get", { capability_id: capabilityId }),
);
ipcMain.handle(
  "nova:capability:provider-enabled",
  (
    _event,
    payload: {
      readonly capability_id: string;
      readonly provider_id: string;
      readonly enabled: boolean;
      readonly confirmed: boolean;
    },
  ) => requestGateway("capability.provider-enabled", payload),
);
ipcMain.handle(
  "nova:capability:provider-priority",
  (
    _event,
    payload: {
      readonly capability_id: string;
      readonly provider_id: string;
      readonly priority: number;
      readonly confirmed: boolean;
    },
  ) => requestGateway("capability.provider-priority", payload),
);
ipcMain.handle(
  "nova:capability:policy",
  (
    _event,
    payload: {
      readonly capability_id: string;
      readonly policy: CapabilityPolicy;
      readonly confirmed: boolean;
    },
  ) => requestGateway("capability.policy", payload),
);
ipcMain.handle("nova:models:discover", (_event, hardware: HardwareProfile) =>
  requestGateway("models.discover", hardware),
);
ipcMain.handle(
  "nova:models:download",
  (_event, payload: { readonly model_id: string; readonly confirmed: boolean }) =>
    requestGateway("models.download", payload),
);
ipcMain.handle(
  "nova:models:load",
  (_event, payload: { readonly model_id: string; readonly confirmed: boolean }) =>
    requestGateway("models.load", payload),
);
ipcMain.handle(
  "nova:models:retire",
  (_event, payload: { readonly model_id: string; readonly confirmed: boolean }) =>
    requestGateway("models.retire", payload),
);
ipcMain.handle("nova:models:health", (_event, providerId: string) =>
  requestGateway("models.health", { provider_id: providerId }),
);
ipcMain.handle("nova:performance:budgets", (_event, samples: unknown) =>
  requestGateway("performance.budgets", samples),
);
ipcMain.handle("nova:devices:compatibility", (_event, left: string, right: string) =>
  requestGateway("devices.compatibility", { left, right }),
);
ipcMain.handle("nova:devices:logical-clock-compare", (_event, left: unknown, right: unknown) =>
  requestGateway("devices.logical-clock-compare", { left, right }),
);
ipcMain.handle("nova:runtime:service-health", (_event, serviceName: string) =>
  requestGateway("runtime.service-health", { service_name: serviceName }),
);
ipcMain.handle("nova:plugins:record", (_event, pluginId: string) =>
  requestGateway("plugins.record", { plugin_id: pluginId }),
);
ipcMain.handle("nova:jobs:state", (_event, jobId: string) =>
  requestGateway("jobs.state", { job_id: jobId }),
);
ipcMain.handle("nova:system:startup-log", () => requestGateway("system.startup-log", undefined));
ipcMain.handle("nova:system:shutdown-log", () => requestGateway("system.shutdown-log", undefined));
ipcMain.handle("nova:network:state", () => requestGateway("network.state", undefined));
ipcMain.handle("nova:system:inventory-summary", () =>
  requestGateway("system.inventory-summary", undefined),
);
ipcMain.handle("nova:session:devices", () => requestGateway("session.devices", undefined));
ipcMain.handle("nova:personalization:pending-summaries", () =>
  requestGateway("personalization.pending-summaries", undefined),
);
ipcMain.handle("nova:hardware:summary", () => requestGateway("hardware.summary", undefined));
ipcMain.handle("nova:hardware:rescan-summary", () =>
  requestGateway("hardware.rescan-summary", undefined),
);
ipcMain.handle("nova:remote:sessions", () => requestGateway("remote.sessions", undefined));
ipcMain.handle("nova:remote:pre-approvals", () =>
  requestGateway("remote.pre-approvals", undefined),
);
ipcMain.handle("nova:capability:list", () => requestGateway("capability.list", undefined));
ipcMain.handle("nova:resources:held", () => requestGateway("resources.held", undefined));
ipcMain.handle("nova:jobs:list", () => requestGateway("jobs.list", undefined));
ipcMain.handle("nova:jobs:active-groups", () => requestGateway("jobs.active-groups", undefined));
ipcMain.handle("nova:models:health-list", () => requestGateway("models.health-list", undefined));
ipcMain.handle("nova:models:reclaimable", () => requestGateway("models.reclaimable", undefined));
ipcMain.handle("nova:websocket:url", () => requestGateway("websocket.url", undefined));
ipcMain.handle("nova:rest:url", () => requestGateway("rest.url", undefined));
ipcMain.handle("nova:webhook:health", (_event, data) => requestGateway("webhook.health", data));
ipcMain.handle("nova:plugins:list", () => requestGateway("plugins.list", undefined));
ipcMain.handle("nova:tools:list", () => requestGateway("tools.list", undefined));
ipcMain.handle("nova:task-scheduler:status", () =>
  requestGateway("task-scheduler.status", undefined),
);
ipcMain.handle("nova:workflow:checkpoints", (_event, data) =>
  requestGateway("workflow.checkpoints", data),
);
ipcMain.handle("nova:workflow:resume", (_event, data) => requestGateway("workflow.resume", data));
ipcMain.handle("nova:task:retry", (_event, data) => requestGateway("task.retry", data));
ipcMain.handle("nova:task:resume-paused", (_event, data) =>
  requestGateway("task.resume-paused", data),
);
ipcMain.handle("nova:task:confirm-waiting-user", (_event, data) =>
  requestGateway("task.confirm-waiting-user", data),
);
ipcMain.handle("nova:task:deny-waiting-user", (_event, data) =>
  requestGateway("task.deny-waiting-user", data),
);
ipcMain.handle("nova:task:pause", (_event, data) => requestGateway("task.pause", data));

ipcMain.handle("nova:observers:sync", () => requestGateway("observers.sync", undefined));
ipcMain.handle("nova:observers:sync-clipboard", () =>
  requestGateway("observers.sync.clipboard", undefined),
);
ipcMain.handle("nova:observers:sync-notifications", () =>
  requestGateway("observers.sync.notifications", undefined),
);
ipcMain.handle("nova:observers:sync-keyboard", () =>
  requestGateway("observers.sync.keyboard", undefined),
);
ipcMain.handle("nova:observers:sync-mouse", () =>
  requestGateway("observers.sync.mouse", undefined),
);
ipcMain.handle("nova:observers:sync-browser", () =>
  requestGateway("observers.sync.browser", undefined),
);
ipcMain.handle("nova:observation:adopt", (_event, payload: ObservationIndexRequest) =>
  requestGateway("observation.adopt", payload),
);
ipcMain.handle("nova:task:place", (_event, payload: DistributedPlacementInput) =>
  requestGateway("task.place", payload),
);
ipcMain.handle(
  "nova:auth:issue-token",
  (_event, payload: { readonly scopes: readonly ApiScope[]; readonly confirmed: boolean }) =>
    requestGateway("auth.token.issue", payload),
);

ipcMain.handle("nova:google:status", () => ({
  connected: getEmailCalendarProviderSetup()?.isGoogleAccountConnected() ?? false,
  configured: getEmailCalendarProviderSetup() !== undefined,
}));
ipcMain.handle("nova:google:connect", async () => {
  const setup = getEmailCalendarProviderSetup();
  if (!setup) throw new Error("Email and calendar sign-in is not available yet.");
  return await setup.connectGoogleAccount();
});
ipcMain.handle("nova:google:disconnect", () => {
  const setup = getEmailCalendarProviderSetup();
  setup?.disconnectGoogleAccount();
  return { connected: false };
});

ipcMain.handle("nova:voice:start", (_event, confirmed: boolean) =>
  requestGateway("voice.start", { confirmed }),
);
ipcMain.handle("nova:voice:stop", (_event, confirmed: boolean) =>
  requestGateway("voice.stop", { confirmed }),
);
ipcMain.handle("nova:voice:barge-in", () => requestGateway("voice.barge-in", undefined));
ipcMain.handle("nova:voice:state", () => requestGateway("voice.state", undefined));
ipcMain.handle("nova:plugins:discover", (_event, gap: CapabilityGap) =>
  requestGateway("plugins.discover", gap),
);
ipcMain.handle(
  "nova:plugins:confirm",
  (_event, payload: { readonly plugin_id: string; readonly confirmed: boolean }) =>
    requestGateway("plugins.confirm", payload),
);
ipcMain.handle(
  "nova:plugins:enable",
  (_event, payload: { readonly plugin_id: string; readonly confirmed: boolean }) =>
    requestGateway("plugins.enable", payload),
);
ipcMain.handle(
  "nova:plugins:disable",
  (_event, payload: { readonly plugin_id: string; readonly confirmed: boolean }) =>
    requestGateway("plugins.disable", payload),
);
ipcMain.handle(
  "nova:plugins:uninstall",
  (_event, payload: { readonly plugin_id: string; readonly confirmed: boolean }) =>
    requestGateway("plugins.uninstall", payload),
);
ipcMain.handle(
  "nova:plugins:decline",
  (_event, payload: { readonly plugin_id: string; readonly confirmed: boolean }) =>
    requestGateway("plugins.decline", payload),
);
ipcMain.handle("nova:plugins:pending", () => requestGateway("plugins.pending", undefined));
ipcMain.handle(
  "nova:backup:create",
  (_event, payload: { readonly state: unknown; readonly confirmed: boolean }) =>
    requestGateway("backup.create", payload),
);
ipcMain.handle(
  "nova:backup:pre-update",
  (_event, payload: { readonly state: unknown; readonly confirmed: boolean }) =>
    requestGateway("backup.pre-update", payload),
);
ipcMain.handle(
  "nova:backup:restore",
  (_event, payload: { readonly snapshot_id: string; readonly confirmed: boolean }) =>
    requestGateway("backup.restore", payload),
);
ipcMain.handle("nova:restore:prepare", (_event, snapshotId: string) =>
  requestGateway("restore.prepare", { snapshot_id: snapshotId }),
);
ipcMain.handle(
  "nova:restore:apply",
  (_event, payload: { readonly prepared: PreparedRestore; readonly confirmed: boolean }) =>
    requestGateway("restore.apply", payload),
);
ipcMain.handle(
  "nova:upgrade:run",
  (_event, payload: { readonly request: UpgradeRequest; readonly confirmed: boolean }) =>
    requestGateway("upgrade.run", payload),
);
ipcMain.handle(
  "nova:repair:run",
  (_event, payload?: { readonly request?: RepairRequest; readonly confirmed?: boolean }) =>
    requestGateway("repair.run", payload),
);
ipcMain.handle(
  "nova:resources:acquire",
  (_event, payload: { readonly task_id: string; readonly resources: readonly string[] }) =>
    requestGateway("resources.acquire", payload),
);
ipcMain.handle("nova:resources:release", (_event, taskId: string) =>
  requestGateway("resources.release", { task_id: taskId }),
);
ipcMain.handle("nova:resources:holder", (_event, resource: string) =>
  requestGateway("resources.holder", { resource }),
);
ipcMain.handle("nova:resources:expire", () => requestGateway("resources.expire", undefined));
ipcMain.handle(
  "nova:resources:arbitrate",
  (_event, payload: { readonly resource: string; readonly request: ResourceRequest }) =>
    requestGateway("resources.arbitrate", payload),
);
ipcMain.handle(
  "nova:resources:arbitration-release",
  (_event, payload: { readonly resource: string; readonly request_id: string }) =>
    requestGateway("resources.arbitration-release", payload),
);
ipcMain.handle(
  "nova:offline:submit",
  (_event, payload: { readonly action: OfflineAction; readonly confirmed: boolean }) =>
    requestGateway("offline.submit", payload),
);
ipcMain.handle("nova:offline:reconnect", (_event, confirmed: boolean) =>
  requestGateway("offline.reconnect", { confirmed }),
);
ipcMain.handle("nova:setup:start", (_event, confirmed: boolean) =>
  requestGateway("setup.start", { confirmed }),
);
ipcMain.handle("nova:setup:rerun", () => requestGateway("setup.rerun", undefined));
ipcMain.handle(
  "nova:setup:complete",
  (_event, payload: { readonly step: SetupStepId; readonly patch?: SetupStepPatch }) =>
    requestGateway("setup.complete", payload),
);
ipcMain.handle("nova:setup:defer", (_event, step: SetupStepId) =>
  requestGateway("setup.defer", { step }),
);
ipcMain.handle("nova:setup:summary", () => requestGateway("setup.summary", undefined));
ipcMain.handle("nova:workspace:identity", () => requestGateway("workspace.identity", undefined));
ipcMain.handle("nova:workspace:state", () => requestGateway("workspace.state", undefined));
ipcMain.handle(
  "nova:workspace:create",
  (_event, payload: { readonly workspace_id: string; readonly confirmed: boolean }) =>
    requestGateway("workspace.create", payload),
);
ipcMain.handle("nova:workspace:activate", (_event, confirmed: boolean) =>
  requestGateway("workspace.activate", { confirmed }),
);
ipcMain.handle("nova:workspace:acquire-lock", (_event, reason: string) =>
  requestGateway("workspace.acquire-lock", { reason }),
);
ipcMain.handle("nova:workspace:release-lock", (_event, token: string) =>
  requestGateway("workspace.release-lock", { token }),
);
ipcMain.handle("nova:workspace:expire-lock", () =>
  requestGateway("workspace.expire-lock", undefined),
);
ipcMain.handle("nova:workspace:begin-recovery", () =>
  requestGateway("workspace.begin-recovery", undefined),
);
ipcMain.handle("nova:workspace:complete-recovery", () =>
  requestGateway("workspace.complete-recovery", undefined),
);
ipcMain.handle("nova:workspace:can-sync", () => requestGateway("workspace.can-sync", undefined));
ipcMain.handle("nova:email:read", (_event, query: EmailQuery) =>
  requestGateway("email.read", query),
);
ipcMain.handle("nova:email:draft", (_event, draft: EmailDraft) =>
  requestGateway("email.draft", draft),
);
ipcMain.handle(
  "nova:email:send",
  (_event, payload: { readonly draft: EmailDraft; readonly confirmed: boolean }) =>
    requestGateway("email.send", payload),
);
ipcMain.handle(
  "nova:companion:background-start",
  (_event, payload: { readonly capability_id: string; readonly confirmed: boolean }) =>
    requestGateway("companion.background-start", payload),
);
ipcMain.handle(
  "nova:companion:capability",
  (_event, payload: { readonly capability_id: string; readonly required_permissions: string[] }) =>
    requestGateway("companion.capability", payload),
);
ipcMain.handle("nova:devices:sync-flush", (_event, confirmed: boolean) =>
  requestGateway("devices.sync-flush", { confirmed }),
);
ipcMain.handle(
  "nova:devices:pairing-offer",
  (
    _event,
    payload: {
      readonly runtime_mode: DeviceRuntimeMode;
      readonly primary_public_key: string;
      readonly confirmed: boolean;
    },
  ) => requestGateway("devices.pairing-offer", payload),
);
ipcMain.handle(
  "nova:devices:pairing-complete",
  (_event, payload: { readonly code: string; readonly request: PairingRequest }) =>
    requestGateway("devices.pairing-complete", payload),
);
ipcMain.handle(
  "nova:devices:revoke",
  (_event, payload: { readonly device_id: string; readonly confirmed: boolean }) =>
    requestGateway("devices.revoke", payload),
);
ipcMain.handle("nova:devices:trusted", () => requestGateway("devices.trusted", undefined));
ipcMain.handle("nova:devices:snapshots", () => requestGateway("devices.snapshots", undefined));
ipcMain.handle(
  "nova:devices:negotiate",
  (_event, payload: { readonly device_id: string; readonly capability_id: string }) =>
    requestGateway("devices.negotiate", payload),
);
ipcMain.handle("nova:diagnostics:get", () => requestGateway("diagnostics.get", undefined));
ipcMain.handle("nova:updates:get", () => requestGateway("updates.get", undefined));
ipcMain.handle("nova:workflow:validate", (_event, payload: WorkflowDraft) =>
  requestGateway("workflow.validate", payload),
);
ipcMain.handle("nova:desktop:screenshot", (_event, payload: ScreenshotRequest) =>
  requestGateway("desktop.screenshot", payload),
);
ipcMain.handle("nova:desktop:ui-action", (_event, payload: UiActionRequest) =>
  requestGateway("desktop.ui-action", payload),
);
ipcMain.handle("nova:desktop:ui-read", (_event, payload: AccessibilityReadRequest) =>
  requestGateway("desktop.ui-read", payload),
);
ipcMain.handle("nova:permissions:get", () =>
  requestGateway<PermissionGrant[]>("permissions.get", undefined),
);
ipcMain.handle(
  "nova:permissions:set",
  (
    _event,
    payload: {
      readonly source: string;
      readonly granted: boolean;
      readonly confirmed: boolean;
    },
  ) => requestGateway<PermissionGrant[]>("permissions.set", payload),
);
const configurationSections: ReadonlySet<string> = new Set([
  "capabilities",
  "devices",
  "channels",
  "plugins",
  "mcp_servers",
  "routing_policies",
  "permissions",
  "voice",
  "personalization",
]);

ipcMain.handle("nova:config:get", () => requestGateway<NovaConfiguration>("config.get", undefined));
ipcMain.handle(
  "nova:config:update",
  (
    _event,
    payload: {
      readonly section: string;
      readonly value: NovaConfiguration[ConfigurationSectionName];
      readonly confirmed: boolean;
    },
  ) => {
    if (!configurationSections.has(payload.section)) {
      throw new Error("Configuration section is invalid.");
    }
    return requestGateway<NovaConfiguration>("config.update", payload);
  },
);

ipcMain.handle("nova:mcp:list", () => requestGateway("mcp.list", undefined));
ipcMain.handle(
  "nova:mcp:add",
  (_event, payload: { readonly server: McpServerConfiguration; readonly confirmed: boolean }) =>
    requestGateway("mcp.add", payload),
);
ipcMain.handle(
  "nova:mcp:request-approval",
  (_event, payload: { readonly server_id: string; readonly confirmed: boolean }) =>
    requestGateway("mcp.request-approval", payload),
);
ipcMain.handle(
  "nova:mcp:approve",
  (_event, payload: { readonly server_id: string; readonly confirmed: boolean }) =>
    requestGateway("mcp.approve", payload),
);
ipcMain.handle(
  "nova:mcp:disable",
  (_event, payload: { readonly server_id: string; readonly confirmed: boolean }) =>
    requestGateway("mcp.disable", payload),
);
ipcMain.handle(
  "nova:mcp:enable",
  (_event, payload: { readonly server_id: string; readonly confirmed: boolean }) =>
    requestGateway("mcp.enable", payload),
);
ipcMain.handle(
  "nova:mcp:remove",
  (_event, payload: { readonly server_id: string; readonly confirmed: boolean }) =>
    requestGateway("mcp.remove", payload),
);

const startGateway = async (): Promise<void> => {
  const diagnosticsPath = join(app.getPath("userData"), "logs", "nova.jsonl");
  const packagePath = join(app.getAppPath(), "package.json");
  const changelogPath = join(app.getAppPath(), "CHANGELOG.md");
  const logger = new StructuredLogger({
    service: "desktop.main",
    sink: new FileJsonlLogSink(diagnosticsPath),
  });
  gatewayBus = new NamedPipeCommunicationBus(
    {
      path: join(app.getPath("userData"), "nova-api.sock"),
      role: "server",
    },
    logger,
  );
  const gateway = new ApiGateway(gatewayBus, logger);
  runtimeApplication = await createDesktopRuntime({
    logger,
    userDataPath: app.getPath("userData"),
    migrationsPath: join(app.getAppPath(), "dist", "migrations"),
    desktopAgent: () => desktopAgent,
  });
  desktopAgent = new DesktopAgentController({
    permissions: runtimeApplication.permissions,
    focus: () => runtimeApplication?.worldModel.focus() ?? null,
    bridge: new NativeDesktopAgentBridge(),
    confirm: async (request) => {
      const confirmation = await dialog.showMessageBox({
        type: "warning",
        title: "Nova confirmation required",
        message: `Confirm ${request.action_id} in ${request.expected_window_id}?`,
        detail: "This desktop action may cause an irreversible change.",
        buttons: ["Cancel", "Confirm"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return confirmation.response === 1;
    },
  });
  await runtimeApplication.start();
  gateway.register("task.submit", async (data) => {
    const payload = data as { readonly goal?: string };
    if (!payload.goal) throw new Error("Task goal is required.");
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await submitDesktopTask(
      runtimeApplication.coordinator,
      runtimeApplication.scheduler,
      payload.goal,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("task.get", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: string };
    if (!payload.task_id) throw new Error("Task ID is required.");
    const result = runtimeApplication.getTask(payload.task_id);
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("memory.search", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as MemorySearchInput;
    const result = await runtimeApplication.searchMemory(payload);
    if (!result.ok) throw new Error(result.error.message);
    return { results: result.value, query: payload.query };
  });
  gateway.register("memory.record", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly record_id?: string };
    if (!payload.record_id) throw new Error("Memory record ID is required.");
    const result = await runtimeApplication.getMemoryRecord(payload.record_id);
    if (!result.ok) {
      if (result.error.code === "NOVA-MEM003") throw new Error("Memory record not found.");
      throw new Error(result.error.message);
    }
    return result.value;
  });
  gateway.register("graph.query", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as GraphQueryInput;
    const result = runtimeApplication.queryGraph(payload);
    if (!result.ok) {
      if (result.error.code === "NOVA-MEM003") throw new Error("Graph node not found.");
      throw new Error(result.error.message);
    }
    return result.value;
  });
  gateway.register("background.generate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly trigger?: unknown };
    const result = await runtimeApplication.generateBackgroundBriefing(
      parseBriefingTrigger(payload.trigger),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("background.deliver", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.deliverBackgroundBriefing(parseBriefing(data));
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("personalization.propose", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.proposeAdaptivePreference(parseAdaptivePreferenceInput(data));
    if (!result.ok) throw new Error(result.error.message);
    return result satisfies { ok: true; value: AdaptivePreferenceProposal };
  });
  gateway.register("personalization.approve", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly proposal_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.proposal_id !== "string" || payload.proposal_id.trim() === "")
      throw new Error("Adaptive proposal ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Adaptive preference approval confirmation is invalid.");
    const result = runtimeApplication.approveAdaptivePreference(
      payload.proposal_id,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("personalization.dismiss", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly proposal_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.proposal_id !== "string" || payload.proposal_id.trim() === "")
      throw new Error("Adaptive proposal ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Adaptive preference dismissal confirmation is invalid.");
    const result = runtimeApplication.dismissAdaptivePreference(
      payload.proposal_id,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("personalization.pending", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.pendingAdaptivePreferences();
  });
  gateway.register("personalization.reset", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly preference_id?: unknown; readonly confirmed?: unknown };
    if (payload.preference_id !== undefined && typeof payload.preference_id !== "string")
      throw new Error("Adaptive preference ID is invalid.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Adaptive preference reset confirmation is invalid.");
    const result = runtimeApplication.resetAdaptivePreference(
      payload.preference_id,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("analytics.generate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.generatePersonalAnalytics(
      parseAnalyticsInput(data),
    ) satisfies AnalyticsReport;
  });
  gateway.register("incident.detect", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly detail?: unknown };
    return unwrapIncident(runtimeApplication.detectIncident(parseIncidentDetail(payload.detail)));
  });
  gateway.register("incident.triage", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly incident_id?: unknown;
      readonly severity?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Incident triage confirmation is invalid.");
    return unwrapIncident(
      runtimeApplication.triageIncident(
        parseIncidentId(payload.incident_id),
        parseIncidentSeverity(payload.severity),
        payload.confirmed,
      ),
    );
  });
  gateway.register("incident.mitigate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly incident_id?: unknown;
      readonly detail?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Incident mitigation confirmation is invalid.");
    return unwrapIncident(
      runtimeApplication.mitigateIncident(
        parseIncidentId(payload.incident_id),
        parseIncidentDetail(payload.detail),
        payload.confirmed,
      ),
    );
  });
  gateway.register("incident.resolve", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly incident_id?: unknown;
      readonly detail?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Incident resolution confirmation is invalid.");
    return unwrapIncident(
      runtimeApplication.resolveIncident(
        parseIncidentId(payload.incident_id),
        parseIncidentDetail(payload.detail),
        payload.confirmed,
      ),
    );
  });
  gateway.register("incident.postmortem", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly incident_id?: unknown;
      readonly detail?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Incident postmortem confirmation is invalid.");
    return unwrapIncident(
      runtimeApplication.postmortemIncident(
        parseIncidentId(payload.incident_id),
        parseIncidentDetail(payload.detail),
        payload.confirmed,
      ),
    );
  });
  gateway.register("incident.timeline", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly incident_id?: unknown };
    const incidentId = parseIncidentId(payload.incident_id);
    return runtimeApplication.incidentTimeline(incidentId);
  });
  gateway.register("personalization.pending-summaries", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.pendingAdaptivePreferenceSummaries();
  });
  gateway.register("hardware.summary", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.hardwareCapabilitySummary();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("hardware.rescan-summary", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.rescanHardwareCapabilitySummary();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("remote.sessions", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.remoteControlSessionStatuses();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("remote.pre-approvals", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.remoteControlPreApprovalStatuses();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("capability.list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.listCapabilityRecords();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("resources.held", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.heldResourceLocks();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("runbook.handle", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly incident?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Recovery runbook confirmation is invalid.");
    const result = await runtimeApplication.handleRunbook(
      parseRunbookIncident(payload.incident),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies RunbookResult;
  });
  gateway.register("capability.get", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly capability_id?: unknown };
    const result = runtimeApplication.getCapabilityRecord(parseCapabilityId(payload.capability_id));
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies CapabilityRecord;
  });
  gateway.register("capability.provider-enabled", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly capability_id?: unknown;
      readonly provider_id?: unknown;
      readonly enabled?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.enabled !== "boolean") throw new Error("Provider enabled flag is invalid.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Provider enabled-state confirmation is invalid.");
    const result = runtimeApplication.setCapabilityProviderEnabled(
      parseCapabilityId(payload.capability_id),
      parseProviderId(payload.provider_id),
      payload.enabled,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies CapabilityRecord;
  });
  gateway.register("capability.provider-priority", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly capability_id?: unknown;
      readonly provider_id?: unknown;
      readonly priority?: unknown;
      readonly confirmed?: unknown;
    };
    const priority = payload.priority;
    if (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0)
      throw new Error("Provider priority is invalid.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Provider priority confirmation is invalid.");
    const result = runtimeApplication.setCapabilityProviderPriority(
      parseCapabilityId(payload.capability_id),
      parseProviderId(payload.provider_id),
      priority,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies CapabilityRecord;
  });
  gateway.register("capability.policy", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly capability_id?: unknown;
      readonly policy?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Capability policy confirmation is invalid.");
    const result = runtimeApplication.setCapabilityPolicy(
      parseCapabilityId(payload.capability_id),
      parseCapabilityPolicy(payload.policy),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies CapabilityRecord;
  });
  gateway.register("models.discover", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.discoverLocalModels(
      parseHardwareProfile(data),
    ) satisfies readonly LocalModelDiscovery[];
  });
  gateway.register("models.download", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly model_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Local model download confirmation is invalid.");
    const result = await runtimeApplication.downloadLocalModel(
      parseModelId(payload.model_id),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      model_id: result.value.model_id,
      provider_id: result.value.provider_id,
      bytes: result.value.bytes,
      status: result.value.status,
    };
  });
  gateway.register("models.load", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly model_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Local model load confirmation is invalid.");
    const result = await runtimeApplication.loadLocalModel(
      parseModelId(payload.model_id),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      model_id: result.value.model_id,
      provider_id: result.value.provider_id,
      status: "loaded" as const,
    };
  });
  gateway.register("models.retire", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly model_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Local model retirement confirmation is invalid.");
    const result = runtimeApplication.retireLocalModel(
      parseModelId(payload.model_id),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      model_id: result.value.model_id,
      status: result.value.status,
    };
  });
  gateway.register("models.health", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly provider_id?: unknown };
    const result = runtimeApplication.modelProviderHealth(
      parseWorkspaceText(payload.provider_id, "Provider ID"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies HealthState;
  });
  gateway.register("models.health-list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.listModelProviderHealthStatuses();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("models.reclaimable", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.reclaimableLocalModelSummaries();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("websocket.url", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.websocketUrl();
  });
  gateway.register("rest.url", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.restUrl();
  });
  gateway.register("webhook.health", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly webhook_id?: unknown };
    const result = runtimeApplication.webhookHealthSummary(
      parseWorkspaceText(payload.webhook_id, "Webhook ID"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("plugins.list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.pluginRecordSummaries();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("tools.list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.listToolSummaries();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("task-scheduler.status", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.taskSchedulerStatus();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workflow.checkpoints", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly workflow_id?: unknown };
    const result = runtimeApplication.workflowCheckpointSummaries(
      parseWorkspaceText(payload.workflow_id, "Workflow ID"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workflow.resume", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly checkpoint_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Workflow resume confirmation is invalid.");
    const result = await runtimeApplication.resumeWorkflowCheckpoint(
      parseWorkspaceText(payload.checkpoint_id, "Checkpoint ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectWorkflowResult(result.value);
  });
  gateway.register("task.retry", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Task retry confirmation is invalid.");
    const result = await runtimeApplication.retryTask(
      parseWorkspaceText(payload.task_id, "Task ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("task.resume-paused", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Paused-task resume confirmation is invalid.");
    const result = await runtimeApplication.resumePausedTask(
      parseWorkspaceText(payload.task_id, "Task ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("task.confirm-waiting-user", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Waiting-user confirmation is invalid.");
    const result = await runtimeApplication.confirmWaitingUserTask(
      parseWorkspaceText(payload.task_id, "Task ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("task.deny-waiting-user", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Waiting-user denial confirmation is invalid.");
    const result = await runtimeApplication.denyWaitingUserTask(
      parseWorkspaceText(payload.task_id, "Task ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectTaskRecord(result.value);
  });
  gateway.register("performance.budgets", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.evaluatePerformanceBudgets(parseBudgetSamples(data));
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies PerformanceBudgetReport;
  });
  gateway.register("devices.logical-clock-compare", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly left?: unknown; readonly right?: unknown };
    const result = runtimeApplication.compareLogicalClockValues(
      parseLogicalClockValue(payload.left, "Left logical clock"),
      parseLogicalClockValue(payload.right, "Right logical clock"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("devices.compatibility", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly left?: unknown; readonly right?: unknown };
    const result = runtimeApplication.compareDeviceVersions(
      parseWorkspaceText(payload.left, "Left device version"),
      parseWorkspaceText(payload.right, "Right device version"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies CompatibilityResult;
  });
  gateway.register("runtime.service-health", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly service_name?: unknown };
    const result = runtimeApplication.runtimeServiceHealth(
      parseWorkspaceText(payload.service_name, "Service name"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies ServiceHealth;
  });
  gateway.register("plugins.record", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown };
    const result = runtimeApplication.pluginRecord(
      parseWorkspaceText(payload.plugin_id, "Plugin ID"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectPluginRecord(result.value);
  });
  gateway.register("jobs.state", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly job_id?: unknown };
    const result = runtimeApplication.jobState(parseWorkspaceText(payload.job_id, "Job ID"));
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies JobState;
  });
  gateway.register("jobs.list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.listScheduledJobStates();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly JobState[];
  });
  gateway.register("jobs.active-groups", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.activeScheduledJobConcurrencyGroups();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly string[];
  });
  gateway.register("system.startup-log", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.systemStartupLog();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly StartupStep[];
  });
  gateway.register("system.shutdown-log", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.systemShutdownLog();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly ShutdownStep[];
  });
  gateway.register("network.state", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.networkState();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies ConnectionState;
  });
  gateway.register("system.inventory-summary", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.systemInventorySummary();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies SystemInventorySummary;
  });
  gateway.register("session.devices", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.sessionDeviceSnapshots();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly DeviceSnapshot[];
  });
  gateway.register("voice.start", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Voice start confirmation is invalid.");
    const result = await runtimeApplication.startVoicePipeline(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("voice.stop", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Voice stop confirmation is invalid.");
    const result = await runtimeApplication.stopVoicePipeline(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("voice.barge-in", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.bargeInVoice();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("voice.state", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return { state: runtimeApplication.voicePipelineState() };
  });
  gateway.register("plugins.discover", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.discoverPluginsForGap(parseCapabilityGap(data));
    if (!result.ok) throw new Error(result.error.message);
    return projectPluginDiscoveryResult(result.value);
  });
  gateway.register("plugins.confirm", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown; readonly confirmed?: unknown };
    const pluginId = parseProviderId(payload.plugin_id);
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Plugin discovery approval confirmation is invalid.");
    const result = runtimeApplication.confirmPluginDiscovery(pluginId, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("plugins.enable", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown; readonly confirmed?: unknown };
    const pluginId = parseProviderId(payload.plugin_id);
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Plugin enable confirmation is invalid.");
    const result = await runtimeApplication.enablePlugin(pluginId, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return projectPluginRecord(result.value);
  });
  gateway.register("plugins.disable", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown; readonly confirmed?: unknown };
    const pluginId = parseProviderId(payload.plugin_id);
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Plugin disable confirmation is invalid.");
    const result = await runtimeApplication.disablePlugin(pluginId, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return projectPluginRecord(result.value);
  });
  gateway.register("plugins.uninstall", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown; readonly confirmed?: unknown };
    const pluginId = parseProviderId(payload.plugin_id);
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Plugin uninstall confirmation is invalid.");
    const result = await runtimeApplication.uninstallPlugin(pluginId, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("plugins.decline", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly plugin_id?: unknown; readonly confirmed?: unknown };
    const pluginId = parseProviderId(payload.plugin_id);
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Plugin discovery decline confirmation is invalid.");
    const result = runtimeApplication.declinePluginDiscovery(pluginId, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("plugins.pending", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return projectPluginDiscoveryProposals(runtimeApplication.pendingPluginDiscovery());
  });
  gateway.register("backup.create", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly state?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Backup creation confirmation is invalid.");
    const result = runtimeApplication.createBackup(payload.state, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies SnapshotMetadata;
  });
  gateway.register("backup.pre-update", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly state?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Pre-update backup confirmation is invalid.");
    const result = runtimeApplication.preUpdateBackup(payload.state, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies SnapshotMetadata;
  });
  gateway.register("backup.restore", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly snapshot_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Backup restoration confirmation is invalid.");
    const result = runtimeApplication.restoreBackup(
      parseSnapshotId(payload.snapshot_id),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectBackupRestore(result.value);
  });
  gateway.register("restore.prepare", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly snapshot_id?: unknown };
    const result = await runtimeApplication.prepareRestore(parseSnapshotId(payload.snapshot_id));
    if (!result.ok) throw new Error(result.error.message);
    const restoreId = randomUUID();
    preparedRestores.set(restoreId, result.value);
    return projectPreparedRestore(restoreId);
  });
  gateway.register("restore.apply", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly restore_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.restore_id !== "string" || payload.restore_id.trim() === "")
      throw new Error("Prepared restore handle is required.");
    if (typeof payload.confirmed !== "boolean") throw new Error("Restore confirmation is invalid.");
    const prepared = preparedRestores.get(payload.restore_id);
    if (!prepared) throw new Error("Prepared restore is invalid or unavailable.");
    const result = await runtimeApplication.applyPreparedRestore(prepared, payload.confirmed);
    if (result.ok) preparedRestores.delete(payload.restore_id);
    return result;
  });
  gateway.register("upgrade.run", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly request?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean") throw new Error("Upgrade confirmation is invalid.");
    const result = await runtimeApplication.upgradeRuntime(
      parseUpgradeRequest(payload.request),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies UpgradeResult;
  });
  gateway.register("repair.run", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly request?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean") throw new Error("Repair confirmation is invalid.");
    const result = await runtimeApplication.repairRuntime(
      parseRepairRequest(payload.request),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies RepairResult;
  });
  gateway.register("resources.acquire", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown; readonly resources?: unknown };
    const result = runtimeApplication.acquireResources(
      parseResourceTaskId(payload.task_id),
      parseResourceList(payload.resources),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("resources.release", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: unknown };
    const result = runtimeApplication.releaseResources(parseResourceTaskId(payload.task_id));
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("resources.holder", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly resource?: unknown };
    return {
      task_id: runtimeApplication.resourceHolder(parseResourceName(payload.resource)) ?? null,
    };
  });
  gateway.register("resources.expire", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.expireResourceLocks();
  });
  gateway.register("resources.arbitrate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly resource?: unknown; readonly request?: unknown };
    const result = runtimeApplication.acquireArbitratedResource(
      parseResourceName(payload.resource),
      parseArbitrationRequest(payload.request),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies ResourceDecision;
  });
  gateway.register("resources.arbitration-release", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly resource?: unknown; readonly request_id?: unknown };
    const result = runtimeApplication.releaseArbitratedResource(
      parseResourceName(payload.resource),
      parseResourceTaskId(payload.request_id),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("offline.submit", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly action?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Offline-action confirmation is invalid.");
    const result = await runtimeApplication.submitOfflineAction(
      parseOfflineAction(payload.action),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies { status: "QueuedOffline" } | OfflineActionResult;
  });
  gateway.register("offline.reconnect", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Offline reconnect confirmation is invalid.");
    const result = await runtimeApplication.reconnectOfflineActions(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies readonly OfflineActionResult[];
  });
  gateway.register("setup.start", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Setup start confirmation is invalid.");
    const result = await runtimeApplication.startSetupWizard(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return projectSetupState(result.value);
  });
  gateway.register("setup.rerun", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Setup rerun confirmation is invalid.");
    const result = await runtimeApplication.rerunSetupWizard(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return projectSetupState(result.value);
  });
  gateway.register("setup.complete", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly step?: unknown;
      readonly patch?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Setup completion confirmation is invalid.");
    const result = runtimeApplication.completeSetupStep(
      parseSetupStep(payload.step),
      parseSetupPatch(payload.patch),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectSetupState(result.value);
  });
  gateway.register("setup.defer", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly step?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Setup deferral confirmation is invalid.");
    const result = runtimeApplication.deferSetupStep(
      parseSetupStep(payload.step),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return projectSetupState(result.value);
  });
  gateway.register("setup.summary", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.setupSummary();
    if (!result.ok) throw new Error(result.error.message);
    return projectSetupState(result.value);
  });
  gateway.register("workspace.identity", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.workspaceIdentity();
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies WorkspaceIdentity;
  });
  gateway.register("workspace.state", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.workspaceState();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.create", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly workspace_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Workspace creation confirmation is invalid.");
    const result = runtimeApplication.createWorkspace(
      parseWorkspaceText(payload.workspace_id, "Workspace ID"),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies WorkspaceIdentity;
  });
  gateway.register("workspace.activate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Workspace activation confirmation is invalid.");
    const result = runtimeApplication.activateWorkspace(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.acquire-lock", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly reason?: unknown };
    const result = runtimeApplication.acquireWorkspaceLock(
      parseWorkspaceText(payload.reason, "Lock reason"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies WorkspaceLock;
  });
  gateway.register("workspace.release-lock", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly token?: unknown };
    const result = runtimeApplication.releaseWorkspaceLock(
      parseWorkspaceText(payload.token, "Lock token"),
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.expire-lock", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.expireWorkspaceLock();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.begin-recovery", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.beginWorkspaceRecovery();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.complete-recovery", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.completeWorkspaceRecovery();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("workspace.can-sync", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = runtimeApplication.workspaceCanSync();
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("channel.send", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly channel_id?: unknown;
      readonly chat_id?: unknown;
      readonly content?: unknown;
      readonly confirmed?: unknown;
    };
    if (
      typeof payload.channel_id !== "string" ||
      payload.channel_id.trim() === "" ||
      typeof payload.chat_id !== "string" ||
      payload.chat_id.trim() === "" ||
      typeof payload.content !== "string" ||
      payload.content.trim() === ""
    ) {
      throw new Error("Channel ID, chat ID, and content are required.");
    }
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Channel-send confirmation is invalid.");
    const result = await runtimeApplication.sendChannelMessage(
      payload.channel_id,
      payload.chat_id,
      payload.content,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      ok: true,
      value: projectChannelDeliveryReceipt(result.value),
    };
  });
  gateway.register("channel.receive", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly channel_id?: unknown;
      readonly message?: {
        readonly sender_id?: unknown;
        readonly chat_id?: unknown;
        readonly text?: unknown;
        readonly attachments?: unknown;
      };
    };
    const message = payload.message;
    if (
      typeof payload.channel_id !== "string" ||
      payload.channel_id.trim() === "" ||
      typeof message?.sender_id !== "string" ||
      message.sender_id.trim() === "" ||
      typeof message.chat_id !== "string" ||
      message.chat_id.trim() === "" ||
      typeof message.text !== "string" ||
      !Array.isArray(message.attachments)
    ) {
      throw new Error("Channel inbound message fields are invalid.");
    }
    const result = runtimeApplication.receiveChannelMessage(payload.channel_id, {
      sender_id: message.sender_id,
      chat_id: message.chat_id,
      text: message.text,
      attachments: message.attachments,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("channel.media", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly channel_id?: unknown };
    if (typeof payload.channel_id !== "string" || payload.channel_id.trim() === "")
      throw new Error("Channel ID is required.");
    const result = runtimeApplication.getChannelMediaCapabilities(payload.channel_id);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("calendar.upcoming", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.upcomingCalendarEvents();
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("calendar.propose", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.proposeCalendarEvent(parseCalendarDraft(data));
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("calendar.create", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly draft?: unknown; readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Calendar confirmation is required.");
    const result = await runtimeApplication.createCalendarEvent(
      parseCalendarDraft(payload.draft),
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("email.read", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const query = data as { readonly from?: unknown; readonly subject?: unknown };
    if (
      (query.from !== undefined && typeof query.from !== "string") ||
      (query.subject !== undefined && typeof query.subject !== "string")
    ) {
      throw new Error("Email query fields are invalid.");
    }
    const result = await runtimeApplication.readEmail({
      ...(typeof query.from === "string" ? { from: query.from } : {}),
      ...(typeof query.subject === "string" ? { subject: query.subject } : {}),
    } satisfies EmailQuery);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("email.draft", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const draft = data as {
      readonly to?: unknown;
      readonly subject?: unknown;
      readonly body?: unknown;
    };
    if (
      typeof draft.to !== "string" ||
      draft.to.trim() === "" ||
      typeof draft.subject !== "string" ||
      draft.subject.trim() === "" ||
      typeof draft.body !== "string" ||
      draft.body.trim() === ""
    ) {
      throw new Error("Email draft recipient, subject, and body are required.");
    }
    const result = runtimeApplication.draftEmail({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
    } satisfies EmailDraft);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("email.send", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly draft?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean") throw new Error("Email confirmation is required.");
    const draft = payload.draft as {
      readonly to?: unknown;
      readonly subject?: unknown;
      readonly body?: unknown;
    };
    if (
      typeof draft?.to !== "string" ||
      draft.to.trim() === "" ||
      typeof draft?.subject !== "string" ||
      draft.subject.trim() === "" ||
      typeof draft?.body !== "string" ||
      draft.body.trim() === ""
    ) {
      throw new Error("Email draft recipient, subject, and body are required.");
    }
    const result = await runtimeApplication.sendEmail(
      { to: draft.to, subject: draft.subject, body: draft.body } satisfies EmailDraft,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return {
      ok: true,
      value: projectEmailSendReceipt(result.value),
    };
  });
  gateway.register("companion.foreground-start", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Companion foreground start confirmation is invalid.");
    const result = runtimeApplication.startAndroidCompanionForegroundService(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("companion.foreground-stop", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Companion foreground stop confirmation is invalid.");
    const result = runtimeApplication.stopAndroidCompanionForegroundService(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("companion.background-start", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly capability_id?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.capability_id !== "string" || payload.capability_id.trim() === "")
      throw new Error("Companion capability ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Companion background-start confirmation is invalid.");
    const result = runtimeApplication.startAndroidCompanionBackground(
      payload.capability_id,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("companion.permission", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly permission?: unknown };
    if (typeof payload.permission !== "string" || payload.permission.trim() === "")
      throw new Error("Companion permission is required.");
    const result = runtimeApplication.getAndroidCompanionPermission(payload.permission);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("companion.permission-set", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly permission?: unknown;
      readonly granted?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.permission !== "string" || payload.permission.trim() === "")
      throw new Error("Companion permission is required.");
    if (typeof payload.granted !== "boolean") throw new Error("Companion grant state is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Companion permission confirmation is invalid.");
    const result = runtimeApplication.setAndroidCompanionPermission(
      payload.permission,
      payload.granted,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("companion.capability", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly capability_id?: unknown;
      readonly required_permissions?: unknown;
    };
    if (typeof payload.capability_id !== "string" || payload.capability_id.trim() === "")
      throw new Error("Companion capability ID is required.");
    if (
      !Array.isArray(payload.required_permissions) ||
      !payload.required_permissions.every(
        (permission): permission is string =>
          typeof permission === "string" && permission.trim() !== "",
      )
    ) {
      throw new Error("Companion capability permissions are required.");
    }
    const result = runtimeApplication.checkAndroidCompanionCapability({
      capability_id: payload.capability_id,
      required_permissions: payload.required_permissions,
    } satisfies CompanionCapability);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("devices.sync", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncDevices();
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("devices.sync-flush", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly confirmed?: unknown };
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Device-sync flush confirmation is invalid.");
    const result = await runtimeApplication.flushDeviceSync(payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("devices.pairing-offer", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly runtime_mode?: DeviceRuntimeMode;
      readonly primary_public_key?: string;
      readonly confirmed?: boolean;
    };
    if (
      (payload.runtime_mode !== "Full peer" && payload.runtime_mode !== "Companion") ||
      !payload.primary_public_key
    ) {
      throw new Error("Pairing runtime mode and primary public key are required.");
    }
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Pairing-offer confirmation is invalid.");
    const result = runtimeApplication.createPairingOffer(
      {
        runtime_mode: payload.runtime_mode,
        primary_public_key: payload.primary_public_key,
      },
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return { ok: true, value: projectPairingOffer(result.value) };
  });
  gateway.register("devices.pairing-complete", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly code?: string; readonly request?: PairingRequest };
    if (!payload.code || !payload.request)
      throw new Error("Pairing code and request are required.");
    const result = runtimeApplication.completePairing(payload.code, payload.request);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("devices.revoke", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly device_id?: string; readonly confirmed?: unknown };
    if (!payload.device_id) throw new Error("Device ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Trusted-device revocation confirmation is invalid.");
    const result = runtimeApplication.revokeTrustedDevice(payload.device_id, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("devices.trusted", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.listTrustedDevices();
  });
  gateway.register("devices.snapshots", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.listDeviceSnapshots();
  });
  gateway.register("devices.negotiate", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly device_id: string; readonly capability_id: string };
    const result = runtimeApplication.negotiateDeviceCapability(
      payload.device_id,
      payload.capability_id,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result;
  });
  gateway.register("diagnostics.get", async () => readDiagnostics(diagnosticsPath));
  gateway.register("updates.get", async () => readUpdateInfo(packagePath, changelogPath));
  gateway.register("workflow.validate", async (data) =>
    validateWorkflowDraft(data as WorkflowDraft),
  );
  gateway.register("task.list", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly limit?: number; readonly cursor?: string };
    const page = listDesktopTasks(runtimeApplication.listTasks(), payload);
    if (!page.ok) throw new Error(page.error.message);
    return {
      ...page.value,
      items: projectTaskRecords(page.value.items),
    };
  });
  gateway.register("desktop.screenshot", async (data) => {
    const payload = data as ScreenshotRequest;
    return await executeDesktopStep({
      task_id: payload.task_id,
      resolved_tool_id: "nova.screen-capture",
      action_id: "screenshot",
      parameters: payload as unknown as Readonly<Record<string, unknown>>,
      risk_tier: "read_only",
      execution_tier: "vision",
      required_locks: ["desktop.screen"],
      timeout_ms: 15_000,
      confirmation_status: "not_required",
    });
  });
  gateway.register("desktop.ui-read", async (data) => {
    const payload = data as AccessibilityReadRequest;
    return await executeDesktopStep({
      task_id: payload.task_id,
      resolved_tool_id: "nova.desktop-accessibility",
      action_id: "read_state",
      parameters: payload as unknown as Readonly<Record<string, unknown>>,
      risk_tier: "read_only",
      execution_tier: "accessibility",
      required_locks: ["desktop.focus", "desktop.accessibility"],
      timeout_ms: 15_000,
      confirmation_status: "not_required",
    });
  });
  gateway.register("desktop.ui-action", async (data) => {
    const payload = data as UiActionRequest;
    const destructive = payload.risk_tier === "destructive_irreversible";
    if (destructive) {
      if (!desktopAgent) throw new Error("Desktop agent is not ready.");
      const confirmed = await desktopAgent.confirmDestructiveUiAction(payload);
      if (!confirmed) throw new Error("Destructive UI action was not confirmed.");
    }
    const approvedPayload = destructive ? { ...payload, confirmed: true } : payload;
    return await executeDesktopStep({
      task_id: payload.task_id,
      resolved_tool_id: "nova.desktop-accessibility",
      action_id: destructive ? "ui_action_destructive" : "ui_action",
      parameters: approvedPayload as unknown as Readonly<Record<string, unknown>>,
      risk_tier: payload.risk_tier,
      execution_tier: "accessibility",
      required_locks: ["desktop.focus", "desktop.accessibility"],
      timeout_ms: 15_000,
      confirmation_status: destructive || payload.confirmed === true ? "approved" : "not_required",
    });
  });
  gateway.register("browser.activity.capture", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const parsed = parseBrowserMetadataEvent(data);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const result = await runtimeApplication.captureBrowserEvent(parsed.value);
    if (!result.ok) throw new Error(result.error.message);
    return { accepted: true };
  });
  gateway.register("task.cancel", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: string; readonly confirmed?: unknown };
    if (!payload.task_id) throw new Error("Task ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Task cancellation confirmation is invalid.");
    const cancelled = await runtimeApplication.cancelTask(payload.task_id, payload.confirmed);
    if (!cancelled.ok) throw new Error(cancelled.error.message);
    return projectTaskRecord(cancelled.value);
  });
  gateway.register("task.pause", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly task_id?: string; readonly confirmed?: unknown };
    if (!payload.task_id) throw new Error("Task ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Task pause confirmation is invalid.");
    const paused = await runtimeApplication.pauseTask(payload.task_id, payload.confirmed);
    if (!paused.ok) throw new Error(paused.error.message);
    return projectTaskRecord(paused.value);
  });
  gateway.register("permissions.get", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.permissions.list();
  });
  gateway.register("permissions.set", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly source?: string;
      readonly granted?: boolean;
      readonly confirmed?: boolean;
    };
    if (!payload.source || typeof payload.granted !== "boolean") {
      throw new Error("Permission source and boolean grant are required.");
    }
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Permission change confirmation is invalid.");
    const result = await runtimeApplication.setPermission(
      payload.source,
      payload.granted,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  gateway.register("mcp.list", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return projectMcpServers(runtimeApplication.configuration.snapshot().mcp_servers);
  });
  gateway.register("mcp.add", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly server?: unknown;
      readonly confirmed?: unknown;
    };
    if (typeof payload.confirmed !== "boolean") throw new Error("MCP add confirmation is invalid.");
    const result = runtimeApplication.addMcpServer(payload.server as McpServerConfiguration);
    if (!result.ok) throw new Error(result.error.message);
    return projectMcpServer(result.value);
  });
  const registerMcpTransition = (
    method: "request-approval" | "approve" | "disable" | "enable",
    operation: (
      application: RuntimeApplication,
      serverId: string,
      confirmed: boolean,
    ) => ReturnType<RuntimeApplication["requestMcpServerApproval"]>,
  ) => {
    gateway.register(`mcp.${method}`, async (data) => {
      if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
      const payload = data as { readonly server_id?: unknown; readonly confirmed?: unknown };
      if (typeof payload.server_id !== "string" || payload.server_id.trim() === "")
        throw new Error("MCP server ID is required.");
      if (typeof payload.confirmed !== "boolean")
        throw new Error(`MCP ${method} confirmation is invalid.`);
      const result = operation(runtimeApplication, payload.server_id, payload.confirmed);
      if (!result.ok) throw new Error(result.error.message);
      return projectMcpServer(result.value);
    });
  };
  registerMcpTransition("request-approval", (application, serverId, confirmed) =>
    application.requestMcpServerApproval(serverId, confirmed),
  );
  registerMcpTransition("approve", (application, serverId, confirmed) =>
    application.approveMcpServer(serverId, confirmed),
  );
  registerMcpTransition("disable", (application, serverId, confirmed) =>
    application.disableMcpServer(serverId, confirmed),
  );
  registerMcpTransition("enable", (application, serverId, confirmed) =>
    application.enableMcpServer(serverId, confirmed),
  );
  gateway.register("mcp.remove", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly server_id?: unknown; readonly confirmed?: unknown };
    if (typeof payload.server_id !== "string" || payload.server_id.trim() === "")
      throw new Error("MCP server ID is required.");
    if (typeof payload.confirmed !== "boolean")
      throw new Error("MCP remove confirmation is invalid.");
    const result = runtimeApplication.removeMcpServer(payload.server_id, payload.confirmed);
    if (!result.ok) throw new Error(result.error.message);
    return projectMcpServerRemoval(result.value);
  });
  gateway.register("observers.sync", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncObservers();
    if (!result.ok) throw new Error(result.error.message);
    return { windows: result.value };
  });
  gateway.register("observers.sync.clipboard", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncClipboardObserver();
    if (!result.ok) throw new Error(result.error.message);
    return { clipboard: result.value };
  });
  gateway.register("observers.sync.notifications", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncNotificationObserver();
    if (!result.ok) throw new Error(result.error.message);
    return { notifications: result.value };
  });
  gateway.register("observers.sync.keyboard", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncKeyboardObserver();
    if (!result.ok) throw new Error(result.error.message);
    return { keyboard: result.value };
  });
  gateway.register("observers.sync.mouse", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncMouseObserver();
    if (!result.ok) throw new Error(result.error.message);
    return { mouse: result.value };
  });
  gateway.register("observers.sync.browser", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const result = await runtimeApplication.syncBrowserObserver();
    if (!result.ok) throw new Error(result.error.message);
    return { browser: result.value };
  });
  gateway.register("observation.adopt", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as Partial<ObservationIndexRequest> | undefined;
    if (!payload?.event || typeof payload.event !== "object") {
      throw new Error("An observation event payload is required.");
    }
    const request: ObservationIndexRequest = {
      task_id: payload.task_id,
      event: payload.event,
    };
    const result = await runtimeApplication.adoptObservation(request);
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies ObservationIndexResult;
  });
  gateway.register("task.place", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as Partial<DistributedPlacementInput> | undefined;
    if (!payload?.task_id || !payload.origin_device_id) {
      throw new Error("Task ID and origin device ID are required for placement.");
    }
    const input: DistributedPlacementInput = {
      task_id: payload.task_id,
      origin_device_id: payload.origin_device_id,
      required_capability: payload.required_capability,
      cross_peer_assignment_enabled: payload.cross_peer_assignment_enabled ?? false,
      peers: payload.peers ?? [],
    };
    const result = runtimeApplication.placeTask(input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value satisfies DistributedPlacementResult;
  });
  gateway.register("auth.token.issue", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as { readonly scopes?: unknown; readonly confirmed?: unknown };
    if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) {
      throw new Error("At least one API scope is required to issue a token.");
    }
    if (typeof payload.confirmed !== "boolean" || !payload.confirmed) {
      throw new Error("Issuing a local API token requires explicit confirmation.");
    }
    const scopes = payload.scopes as readonly ApiScope[];
    const token = runtimeApplication.issueToken(scopes);
    return { token, scopes };
  });
  gateway.register("config.get", async () => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    return runtimeApplication.configuration.snapshot();
  });
  gateway.register("config.update", async (data) => {
    if (!runtimeApplication) throw new Error("Nova runtime is not ready.");
    const payload = data as {
      readonly section?: string;
      readonly value?: NovaConfiguration[ConfigurationSectionName];
      readonly confirmed?: boolean;
    };
    if (
      !payload.section ||
      !configurationSections.has(payload.section) ||
      payload.value === undefined
    ) {
      throw new Error("Configuration section and value are required.");
    }
    if (typeof payload.confirmed !== "boolean")
      throw new Error("Configuration change confirmation is invalid.");
    const result = runtimeApplication.updateConfiguration(
      payload.section as ConfigurationSectionName,
      payload.value,
      payload.confirmed,
    );
    if (!result.ok) throw new Error(result.error.message);
    return runtimeApplication.configuration.snapshot();
  });
  await gatewayBus.start();
  await gateway.start();
};

app.whenReady().then(async () => {
  await startGateway();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("before-quit", () => {
  void runtimeApplication?.stop();
  void gatewayBus?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
