import { useEffect, useMemo, useState } from "react";
import type {
  ConfiguredCapabilityRecord,
  ConfigurationSectionName,
  NovaConfiguration,
  PersonalizationCategory,
  PersonalizationPreferenceRecord,
} from "@nova/runtime";
import {
  canOpenView,
  desktopNavOrder,
  initialView,
  isOnboardingComplete,
  type DesktopView,
  type ProviderMode,
  type PermissionGrant,
  viewLabel,
} from "./shell-model.js";

interface TaskSnapshot {
  readonly task_id: string;
  readonly state: string;
  readonly retry_count: number;
  readonly updated_at: string;
}

interface TaskListPage {
  readonly items: readonly TaskSnapshot[];
  readonly next_cursor: string | null;
  readonly has_more: boolean;
}

type SurfaceMetaView = Exclude<DesktopView, "permissions" | "chat" | "tasks">;
type SurfaceView = Exclude<SurfaceMetaView, "memory" | "graph">;
type DesktopMemoryRecord = Awaited<ReturnType<typeof window.nova.searchMemory>>["results"][number];
type DesktopGraphResult = Awaited<ReturnType<typeof window.nova.queryGraph>>;
type DesktopDiagnosticRecord = Awaited<
  ReturnType<typeof window.nova.getDiagnostics>
>["records"][number];
type DesktopUpdateInfo = Awaited<ReturnType<typeof window.nova.getUpdateInfo>>;
type DesktopWorkflowDraft = Parameters<typeof window.nova.validateWorkflow>[0];
type DesktopWorkflowValidation = Awaited<ReturnType<typeof window.nova.validateWorkflow>>;
type DesktopTrustedDevice = Awaited<ReturnType<typeof window.nova.getTrustedDevices>>[number];
type DesktopDeviceSnapshot = Awaited<ReturnType<typeof window.nova.getDeviceSnapshots>>[number];

const actionPermissionSources = new Set(["screen", "desktop_control"]);
const isObserverPermission = (source: string): boolean => !actionPermissionSources.has(source);
const permissionLabel = (source: string): string =>
  source === "screen"
    ? "Screen capture"
    : source === "desktop_control"
      ? "Desktop control"
      : source === "clipboard_metadata"
        ? "Clipboard metadata"
        : source === "clipboard_content"
          ? "Clipboard content"
          : source === "notifications_metadata"
            ? "Notification metadata"
            : source === "notifications_content"
              ? "Notification content"
              : source === "browser_metadata"
                ? "Browser metadata"
                : source === "keyboard_activity"
                  ? "Keyboard activity"
                  : source === "mouse_activity"
                    ? "Mouse activity"
                    : source;
const permissionDescription = (source: string): string => {
  if (source === "filesystem") return "Scoped folders only";
  if (source === "screen") return "One-shot task-bound screenshots; not continuously recorded";
  if (source === "desktop_control")
    return "Windows UI Automation only; focus and confirmation gated";
  if (source === "clipboard_metadata")
    return "Copy occurrence and type only; no clipboard contents";
  if (source === "clipboard_content")
    return "Explicit text capture; sensitive password sources are always excluded";
  if (source === "notifications_metadata") return "Source, timestamp, and title only; no body text";
  if (source === "notifications_content")
    return "Eligible notification bodies; messaging and authentication sources are always excluded";
  if (source === "browser_metadata")
    return "Tab open/close/navigation metadata only; no page content, forms, passwords, or automation";
  if (source === "keyboard_activity")
    return "Activity/idle and registered hotkey triggers only; never keystroke content";
  if (source === "mouse_activity")
    return "Activity/idle only; cursor position is read on demand and never continuously recorded";
  return "Metadata only until expanded";
};

const contentPermissionRequiresMetadata = new Map([
  ["clipboard_content", "clipboard_metadata"],
  ["notifications_content", "notifications_metadata"],
]);
const isSufficientObserverGrant = (
  permission: PermissionGrant,
  permissions: readonly PermissionGrant[],
): boolean => {
  if (!isObserverPermission(permission.source) || !permission.granted) return false;
  const metadataSource = contentPermissionRequiresMetadata.get(permission.source);
  return (
    metadataSource === undefined ||
    permissions.some((candidate) => candidate.source === metadataSource && candidate.granted)
  );
};

const surfaceMeta: Readonly<
  Record<
    SurfaceMetaView,
    { readonly purpose: string; readonly items: readonly string[]; readonly state: string }
  >
> = {
  home: {
    purpose:
      "A concise overview of runtime health, recent work, memory grounding, and next actions.",
    items: ["Core runtime online", "Local memory available", "Permission boundary active"],
    state: "Populated dashboard",
  },
  memory: {
    purpose: "Browse, search, and correct stored memory with lineage visibility.",
    items: ["Working memory", "Recent decisions", "Long-term grounded records"],
    state: "Ready for a grounded query",
  },
  graph: {
    purpose: "Explore entities and relationships in the workspace knowledge graph.",
    items: ["Projects and files", "Tasks and decisions", "Devices and relationships"],
    state: "Graph index available",
  },
  workflow: {
    purpose: "Build and monitor multi-step workflows with live status per node.",
    items: ["Workflow definition", "Approval and rollback nodes", "Checkpoint and execution state"],
    state: "No active workflow",
  },
  voice: {
    purpose: "Use low-latency voice interaction with transcript, feedback, and visible controls.",
    items: ["Live transcript", "Streaming voice pipeline", "Mute and cancel controls"],
    state: "Voice is ready when enabled",
  },
  devices: {
    purpose: "Manage paired devices, capabilities, presence, and cross-device continuity.",
    items: ["This desktop", "Paired companion devices", "Capability and sync status"],
    state: "No remote session active",
  },
  provider: {
    purpose: "Manage provider references, routing preferences, and capability pinning.",
    items: ["Local-first routing", "Cloud fallback policy", "Credential references only"],
    state: "Provider policy is configured locally",
  },
  plugins: {
    purpose: "Browse, install, configure, and manage sandboxed plugin permissions.",
    items: ["Enabled plugins", "Available capabilities", "Permission and lifecycle status"],
    state: "No marketplace request pending",
  },
  diagnostics: {
    purpose: "Collect redacted runtime evidence for support, recovery, and incident review.",
    items: ["Runtime health", "Recent tasks and traces", "Redacted diagnostic bundle"],
    state: "Diagnostics collection is available",
  },
  logs: {
    purpose: "Review structured runtime events, errors, retries, and recovery evidence.",
    items: ["Lifecycle events", "Task and tool evidence", "Dead-letter and recovery signals"],
    state: "No degraded log stream detected",
  },
  settings: {
    purpose: "Configure workspace, privacy, permissions, appearance, and deterministic policies.",
    items: ["Workspace preferences", "Privacy and retention", "Keyboard and accessibility"],
    state: "Settings are local-first",
  },
  updates: {
    purpose: "Review update availability, release notes, backup readiness, and rollback controls.",
    items: ["Current version", "Update channel", "Backup and rollback readiness"],
    state: "No update action requested",
  },
};

export const App = () => {
  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);
  const [view, setView] = useState<DesktopView>(initialView(true));
  const [goal, setGoal] = useState("");
  const [lastTask, setLastTask] = useState<TaskSnapshot | null>(null);
  const [tasks, setTasks] = useState<readonly TaskSnapshot[]>([]);
  const [taskCursor, setTaskCursor] = useState<string | null>(null);
  const [taskHasMore, setTaskHasMore] = useState(false);
  const [taskListError, setTaskListError] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<ProviderMode | null>(null);
  const [demonstrationTaskCompleted, setDemonstrationTaskCompleted] = useState(false);
  const [configuration, setConfiguration] = useState<NovaConfiguration | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [observerSyncStatus, setObserverSyncStatus] = useState<string | null>(null);
  const [observerSyncPending, setObserverSyncPending] = useState(false);
  const [googleAccountStatus, setGoogleAccountStatus] = useState<{
    connected: boolean;
    configured: boolean;
  } | null>(null);
  const [googleConnectPending, setGoogleConnectPending] = useState(false);
  const [googleConnectError, setGoogleConnectError] = useState<string | null>(null);

  useEffect(() => {
    void window.nova.getPermissions().then(setPermissions);
    void window.nova.getGoogleAccountStatus().then(setGoogleAccountStatus);
    void window.nova
      .getConfig()
      .then(setConfiguration)
      .catch((error: unknown) =>
        setConfigurationError(
          error instanceof Error ? error.message : "Configuration unavailable.",
        ),
      );
  }, []);

  const observerGranted = useMemo(
    () =>
      permissions.some(
        (permission) => permission.granted && isObserverPermission(permission.source),
      ),
    [permissions],
  );
  const firstRun = useMemo(
    () => !isOnboardingComplete(providerMode, observerGranted, demonstrationTaskCompleted),
    [demonstrationTaskCompleted, observerGranted, providerMode],
  );

  useEffect(() => {
    if (firstRun) setView(initialView(true));
  }, [firstRun]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const page = (await window.nova.listTasks(50)) as TaskListPage;
        if (active) {
          setTasks(page.items);
          setTaskCursor(page.next_cursor);
          setTaskHasMore(page.has_more);
          setTaskListError(null);
        }
      } catch (error: unknown) {
        if (active) {
          setTaskListError(error instanceof Error ? error.message : "Task history unavailable.");
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!lastTask) return;
    let active = true;
    const refresh = async () => {
      try {
        const current = await window.nova.getTask(lastTask.task_id);
        if (active) setLastTask(current);
      } catch {
        // The task monitor retains its last authoritative snapshot while the runtime is unavailable.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [lastTask?.task_id]);

  const submitTask = async () => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    const task = await window.nova.submitTask(trimmed);
    setLastTask(task);
    setGoal("");
    setView("tasks");
  };

  const togglePermission = async (source: string, granted: boolean) => {
    const updated = await window.nova.setPermission(source, granted, true);
    setPermissions(updated);
  };

  const syncObserversNow = async () => {
    setObserverSyncPending(true);
    try {
      const result = await window.nova.syncObservers();
      setObserverSyncStatus(`Windows/applications observer: ${result.windows}.`);
    } catch (error: unknown) {
      setObserverSyncStatus(
        error instanceof Error ? error.message : "Observer sync failed.",
      );
    } finally {
      setObserverSyncPending(false);
    }
  };

  const connectGoogleAccount = async () => {
    setGoogleConnectPending(true);
    setGoogleConnectError(null);
    try {
      await window.nova.connectGoogleAccount();
      setGoogleAccountStatus(await window.nova.getGoogleAccountStatus());
    } catch (error: unknown) {
      setGoogleConnectError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setGoogleConnectPending(false);
    }
  };

  const disconnectGoogleAccount = async () => {
    await window.nova.disconnectGoogleAccount();
    setGoogleAccountStatus(await window.nova.getGoogleAccountStatus());
  };

  const loadMoreTasks = async () => {
    if (!taskHasMore || taskCursor === null) return;
    try {
      const page = (await window.nova.listTasks(50, taskCursor)) as TaskListPage;
      setTasks((current) => [...current, ...page.items]);
      setTaskCursor(page.next_cursor);
      setTaskHasMore(page.has_more);
      setTaskListError(null);
    } catch (error: unknown) {
      setTaskListError(
        error instanceof Error ? error.message : "More task history is unavailable.",
      );
    }
  };

  const cancelTask = async (taskId: string) => {
    if (!window.confirm("Cancel this task?")) return;
    try {
      const cancelled = await window.nova.cancelTask(taskId, true);
      setLastTask(cancelled);
      const page = (await window.nova.listTasks(50)) as TaskListPage;
      setTasks(page.items);
      setTaskCursor(page.next_cursor);
      setTaskHasMore(page.has_more);
      setTaskListError(null);
    } catch (error: unknown) {
      setTaskListError(error instanceof Error ? error.message : "Task cancellation failed.");
    }
  };

  const updateConfiguration = async (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ): Promise<NovaConfiguration> => {
    const updated = await window.nova.updateConfig(section, value, true);
    setConfiguration(updated);
    setConfigurationError(null);
    return updated;
  };

  const submitDemonstrationTask = async (demoGoal: string) => {
    const task = await window.nova.submitTask(demoGoal);
    setLastTask(task);
    setDemonstrationTaskCompleted(true);
    setView("home");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">N</span>
          <div>
            <strong>NOVA</strong>
            <span className="brand-subtitle">local-first intelligence</span>
          </div>
        </div>
        <div className="status-pill" aria-label="Runtime status: core online">
          <span className="status-dot" /> Core online
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="Primary navigation">
          <div className="eyebrow">Workspace</div>
          <nav>
            {desktopNavOrder.map((item) => {
              const disabled = firstRun && item !== "permissions";
              return (
                <button
                  aria-current={view === item ? "page" : undefined}
                  className={`nav-item ${view === item ? "active" : ""}`}
                  disabled={disabled}
                  key={item}
                  onClick={() => {
                    if (canOpenView(item, firstRun)) setView(item);
                  }}
                  type="button"
                >
                  <span className="nav-glyph">
                    {item === "permissions" ? "!" : item.slice(0, 1).toUpperCase()}
                  </span>
                  {viewLabel[item]}
                  {item === "permissions" && firstRun ? (
                    <span className="nav-alert">required</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <span className="eyebrow">Runtime</span>
            <span className="muted">Desktop shell · v0.1</span>
          </div>
        </aside>
        <main className="main-panel">
          {view === "permissions" ? (
            firstRun ? (
              <OnboardingView
                demonstrationTaskCompleted={demonstrationTaskCompleted}
                onDemoTask={submitDemonstrationTask}
                onProviderMode={setProviderMode}
                onToggle={togglePermission}
                permissions={permissions}
                providerMode={providerMode}
              />
            ) : (
              <PermissionCenter
                googleAccountStatus={googleAccountStatus}
                googleConnectError={googleConnectError}
                googleConnectPending={googleConnectPending}
                onConnectGoogle={connectGoogleAccount}
                onDisconnectGoogle={disconnectGoogleAccount}
                onSyncNow={syncObserversNow}
                onToggle={togglePermission}
                permissions={permissions}
                syncPending={observerSyncPending}
                syncStatus={observerSyncStatus}
              />
            )
          ) : view === "chat" ? (
            <ChatView
              goal={goal}
              onGoalChange={setGoal}
              onSubmit={submitTask}
              firstRun={firstRun}
            />
          ) : view === "tasks" ? (
            <TaskMonitor
              error={taskListError}
              hasMore={taskHasMore}
              onCancel={cancelTask}
              onLoadMore={loadMoreTasks}
              task={lastTask}
              tasks={tasks}
            />
          ) : view === "home" ? (
            <HomeView permissions={permissions} task={lastTask} />
          ) : view === "voice" ? (
            <VoiceSettingsView
              configuration={configuration}
              error={configurationError}
              onUpdate={updateConfiguration}
            />
          ) : view === "provider" ? (
            <ProviderSettings
              configuration={configuration}
              error={configurationError}
              onUpdate={updateConfiguration}
            />
          ) : view === "devices" ? (
            <DevicesView
              configuration={configuration}
              error={configurationError}
              onUpdate={updateConfiguration}
            />
          ) : view === "plugins" ? (
            <PluginsView
              configuration={configuration}
              error={configurationError}
              onUpdate={updateConfiguration}
            />
          ) : view === "settings" ? (
            <SettingsView
              configuration={configuration}
              error={configurationError}
              onUpdate={updateConfiguration}
            />
          ) : view === "memory" ? (
            <MemoryView />
          ) : view === "graph" ? (
            <GraphView />
          ) : view === "workflow" ? (
            <WorkflowView />
          ) : view === "diagnostics" ? (
            <DiagnosticsView />
          ) : view === "logs" ? (
            <LogsView />
          ) : view === "updates" ? (
            <UpdatesView />
          ) : (
            <SurfaceView view={view} />
          )}
        </main>
      </div>
    </div>
  );
};

const OnboardingView = ({
  permissions,
  onToggle,
  providerMode,
  onProviderMode,
  demonstrationTaskCompleted,
  onDemoTask,
}: {
  permissions: PermissionGrant[];
  onToggle: (source: string, granted: boolean) => Promise<void>;
  providerMode: ProviderMode | null;
  onProviderMode: (mode: ProviderMode) => void;
  demonstrationTaskCompleted: boolean;
  onDemoTask: (goal: string) => Promise<void>;
}) => {
  const observerGranted = permissions.some((permission) =>
    isSufficientObserverGrant(permission, permissions),
  );
  return (
    <section className="content-column" aria-labelledby="onboarding-title">
      <div className="section-kicker">First launch / Guided setup</div>
      <h1 id="onboarding-title">Prepare NOVA for your workspace.</h1>
      <p className="lede">
        Choose how intelligence runs, grant one explicit observer scope, and start with a concrete
        demonstration task. You can change these choices later.
      </p>
      <div className="onboarding-steps">
        <article className="onboarding-step">
          <span className="step-number">1</span>
          <div>
            <strong>Choose local or cloud reasoning</strong>
            <p className="muted">
              Local keeps data on this device with hardware-dependent latency. Cloud fallback can
              provide broader model capacity but sends approved requests to a configured provider.
            </p>
            <div className="choice-row" role="group" aria-label="Provider mode">
              <button
                className={providerMode === "local" ? "choice active" : "choice"}
                onClick={() => onProviderMode("local")}
                type="button"
              >
                Local-first
              </button>
              <button
                className={providerMode === "cloud" ? "choice active" : "choice"}
                onClick={() => onProviderMode("cloud")}
                type="button"
              >
                Cloud fallback
              </button>
            </div>
          </div>
        </article>
        <article className="onboarding-step">
          <span className="step-number">2</span>
          <div>
            <strong>Enable one observer</strong>
            <p className="muted">
              Observers are disabled by default and remain scoped and auditable.
            </p>
            <div className="permission-grid compact-grid">
              {permissions
                .filter((permission) => isObserverPermission(permission.source))
                .map((permission) => (
                  <label className="permission-card" key={permission.source}>
                    <div>
                      <strong>{permissionLabel(permission.source)}</strong>
                      <span>{permissionDescription(permission.source)}</span>
                    </div>
                    <input
                      checked={permission.granted}
                      onChange={(event) => void onToggle(permission.source, event.target.checked)}
                      type="checkbox"
                    />
                  </label>
                ))}
            </div>
            <span className="step-status">
              {observerGranted ? "Observer scope selected" : "Select at least one observer"}
            </span>
          </div>
        </article>
        <article className="onboarding-step">
          <span className="step-number">3</span>
          <div>
            <strong>Run one demonstration task</strong>
            <p className="muted">
              Pick a small example so the first interaction is concrete instead of an empty chat
              box.
            </p>
            <div className="choice-row" role="group" aria-label="Demonstration task">
              <button
                disabled={!providerMode || !observerGranted || demonstrationTaskCompleted}
                className="choice"
                onClick={() => void onDemoTask("Show my workspace status")}
                type="button"
              >
                Workspace status
              </button>
              <button
                disabled={!providerMode || !observerGranted || demonstrationTaskCompleted}
                className="choice"
                onClick={() => void onDemoTask("Summarize the latest decision")}
                type="button"
              >
                Latest decision
              </button>
              <button
                disabled={!providerMode || !observerGranted || demonstrationTaskCompleted}
                className="choice"
                onClick={() => void onDemoTask("List the active tasks")}
                type="button"
              >
                Active tasks
              </button>
            </div>
            {demonstrationTaskCompleted ? (
              <span className="step-status">Demonstration task completed</span>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
};

const PermissionCenter = ({
  googleAccountStatus,
  googleConnectError,
  googleConnectPending,
  onConnectGoogle,
  onDisconnectGoogle,
  onSyncNow,
  onToggle,
  permissions,
  syncPending,
  syncStatus,
}: {
  googleAccountStatus: { connected: boolean; configured: boolean } | null;
  googleConnectError: string | null;
  googleConnectPending: boolean;
  onConnectGoogle: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onToggle: (source: string, granted: boolean) => Promise<void>;
  permissions: PermissionGrant[];
  syncPending: boolean;
  syncStatus: string | null;
}) => (
  <section className="content-column" aria-labelledby="permissions-title">
    <div className="section-kicker">First launch / Safety boundary</div>
    <h1 id="permissions-title">Choose what NOVA can observe and control.</h1>
    <p className="lede">
      Every observer and desktop action capability is off by default. Grant only the sources and
      controls useful for your task; screen capture is one-shot and raw frames are not retained.
      Clipboard metadata and content capture are separate grants, and sensitive password sources are
      always excluded. You can revoke access at any time.
    </p>
    <div className="permission-grid">
      {permissions.map((permission) => (
        <label className="permission-card" key={permission.source}>
          <div>
            <strong>{permissionLabel(permission.source)}</strong>
            <span>{permissionDescription(permission.source)}</span>
          </div>
          <input
            checked={permission.granted}
            onChange={(event) => void onToggle(permission.source, event.target.checked)}
            type="checkbox"
          />
        </label>
      ))}
    </div>
    <div className="notice" role="note">
      <span>!</span>
      <div>
        <strong>Observer sync</strong>
        <p>
          Grants take effect automatically, but you can force an immediate re-check — useful right
          after changing Windows privacy settings outside NOVA.
        </p>
        <button disabled={syncPending} onClick={() => void onSyncNow()} type="button">
          {syncPending ? "Syncing…" : "Sync observers now"}
        </button>
        {syncStatus ? <p className="muted">{syncStatus}</p> : null}
      </div>
    </div>
    <div className="notice" role="note">
      <span>!</span>
      <div>
        <strong>Email &amp; calendar</strong>
        {googleAccountStatus?.configured === false ? (
          <p>
            Google sign-in is not configured for this build. Set{" "}
            <code>NOVA_GOOGLE_OAUTH_CLIENT_ID</code> to enable it.
          </p>
        ) : googleAccountStatus?.connected ? (
          <>
            <p>Connected. NOVA can read and send email and manage calendar events you approve.</p>
            <button onClick={() => void onDisconnectGoogle()} type="button">
              Disconnect Google account
            </button>
          </>
        ) : (
          <>
            <p>Connect a Google account to let NOVA read email, send drafts you approve, and manage calendar events.</p>
            <button disabled={googleConnectPending} onClick={() => void onConnectGoogle()} type="button">
              {googleConnectPending ? "Connecting…" : "Connect Google account"}
            </button>
          </>
        )}
        {googleConnectError ? <p className="muted">{googleConnectError}</p> : null}
      </div>
    </div>
    <div className="notice" role="note">
      <span>!</span>
      <div>
        <strong>Nothing runs silently.</strong>
        <p>
          Permissions are explicit, granular, and auditable. Chat and task controls unlock after you
          enable at least one source.
        </p>
      </div>
    </div>
  </section>
);

const ChatView = ({
  goal,
  onGoalChange,
  onSubmit,
  firstRun,
}: {
  goal: string;
  onGoalChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  firstRun: boolean;
}) => (
  <section className="content-column chat-column" aria-labelledby="chat-title">
    <div className="section-kicker">Chat / Grounded workspace</div>
    <h1 id="chat-title">What should NOVA help with?</h1>
    <p className="lede">
      Ask a question or issue a task. Deterministic paths are preferred before reasoning, and
      answers carry their grounding.
    </p>
    <div className="chat-card">
      <div className="assistant-message">
        <span className="avatar">N</span>
        <div>
          <strong>NOVA</strong>
          <p>
            Ready when you are. I’ll show task progress and verification evidence in this thread.
          </p>
        </div>
      </div>
      <div className="composer">
        <textarea
          aria-label="Task request"
          disabled={firstRun}
          onChange={(event) => onGoalChange(event.target.value)}
          placeholder="Try: Git status, open my project, or summarize the latest decision…"
          value={goal}
        />
        <button
          disabled={firstRun || goal.trim().length === 0}
          onClick={() => void onSubmit()}
          type="button"
        >
          Submit task <span>↗</span>
        </button>
      </div>
    </div>
  </section>
);

const TaskMonitor = ({
  task,
  tasks,
  error,
  hasMore,
  onCancel,
  onLoadMore,
}: {
  task: TaskSnapshot | null;
  tasks: readonly TaskSnapshot[];
  error: string | null;
  hasMore: boolean;
  onCancel: (taskId: string) => Promise<void>;
  onLoadMore: () => Promise<void>;
}) => (
  <section className="content-column" aria-labelledby="tasks-title">
    <div className="section-kicker">Task Monitor / Live state</div>
    <h1 id="tasks-title">Execution trace</h1>
    <p className="lede">
      Task state is shared across every NOVA surface and never reports unverified work as completed.
    </p>
    {error ? <p className="error-text">{error}</p> : null}
    <div className="task-card">
      {tasks.length > 0 ? (
        tasks.map((entry) => {
          const terminal = ["Completed", "Unverified", "Failed", "Cancelled"].includes(entry.state);
          return (
            <article className="task-row" key={entry.task_id}>
              <div className="task-header">
                <span className="task-status">{entry.state}</span>
                <code>{entry.task_id}</code>
              </div>
              <h2>Task {entry.task_id}</h2>
              <div className="task-meta">
                <span>{entry.retry_count} retries</span>
                <span>Updated {entry.updated_at}</span>
              </div>
              {!terminal ? (
                <button onClick={() => void onCancel(entry.task_id)} type="button">
                  Cancel task
                </button>
              ) : null}
              {entry.task_id === task?.task_id ? (
                <p className="muted">Latest task · refreshed from the authoritative TaskManager.</p>
              ) : null}
            </article>
          );
        })
      ) : (
        <p className="muted">No task history is available. Start from Chat to create one.</p>
      )}
      {hasMore ? (
        <button
          className="secondary-button task-load-more"
          onClick={() => void onLoadMore()}
          type="button"
        >
          Load more task history
        </button>
      ) : null}
    </div>
  </section>
);

const HomeView = ({
  permissions,
  task,
}: {
  permissions: readonly PermissionGrant[];
  task: TaskSnapshot | null;
}) => (
  <section className="content-column" aria-labelledby="home-title">
    <div className="section-kicker">Home / Dashboard</div>
    <h1 id="home-title">Your local-first workspace.</h1>
    <p className="lede">
      NOVA keeps control on your device while making runtime health, memory grounding, and task
      evidence visible at a glance.
    </p>
    <div className="surface-grid">
      <SurfaceCard
        title="Runtime"
        detail="Core services are online and ready for explicit work."
        state="Healthy"
      />
      <SurfaceCard
        title="Permissions"
        detail={`${permissions.filter((permission) => permission.granted).length} observer permissions granted.`}
        state="Audited"
      />
      <SurfaceCard
        title="Latest task"
        detail={task ? `Task ${task.task_id}` : "No task has been submitted yet."}
        state={task?.state ?? "Empty"}
      />
    </div>
  </section>
);

const ProviderSettings = ({
  configuration,
  error,
  onUpdate,
}: {
  configuration: NovaConfiguration | null;
  error: string | null;
  onUpdate: (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ) => Promise<NovaConfiguration>;
}) => {
  const capability = configuration?.capabilities.llm;
  const configuredProvider = capability?.providers[0];
  const [providerId, setProviderId] = useState(configuredProvider?.provider_id ?? "");
  const [vaultReference, setVaultReference] = useState(
    configuredProvider?.credential?.vault_reference ?? "",
  );
  const [policy, setPolicy] = useState<ConfiguredCapabilityRecord["active_policy"]>(
    capability?.active_policy ?? "privacy-first",
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setProviderId(configuredProvider?.provider_id ?? "");
    setVaultReference(configuredProvider?.credential?.vault_reference ?? "");
    setPolicy(capability?.active_policy ?? "privacy-first");
  }, [capability, configuredProvider]);

  const save = async () => {
    const trimmedProvider = providerId.trim();
    if (!trimmedProvider) {
      setStatus("Enter a provider or model identifier.");
      return;
    }
    const provider = {
      provider_id: trimmedProvider,
      enabled: true,
      priority: 1,
      ...(vaultReference.trim() ? { credential: { vault_reference: vaultReference.trim() } } : {}),
    };
    const nextCapability: ConfiguredCapabilityRecord = {
      capability_id: "llm",
      domain: "text-generation",
      required: true,
      providers: [provider],
      active_policy: policy,
      manual_override: null,
    };
    try {
      await onUpdate("capabilities", {
        ...(configuration?.capabilities ?? {}),
        llm: nextCapability,
      });
      setStatus("Provider/model settings saved.");
    } catch (saveError: unknown) {
      setStatus(
        saveError instanceof Error ? saveError.message : "Provider settings could not be saved.",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="provider-settings-title">
      <div className="section-kicker">Provider Settings / Persistent configuration</div>
      <h1 id="provider-settings-title">Choose how NOVA reasons.</h1>
      <p className="lede">
        Provider identifiers and routing policy are saved locally. Credentials remain opaque vault
        references.
      </p>
      {error ? (
        <div className="state-strip">
          <strong>Configuration unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}
      <div className="surface-grid">
        <article className="surface-card">
          <label htmlFor="provider-id">Provider or model identifier</label>
          <input
            id="provider-id"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder="local.llm or provider-model-id"
          />
          <label htmlFor="vault-reference">Optional vault reference</label>
          <input
            id="vault-reference"
            value={vaultReference}
            onChange={(event) => setVaultReference(event.target.value)}
            placeholder="vault://provider-credential"
          />
          <label htmlFor="routing-policy">Routing policy</label>
          <select
            id="routing-policy"
            value={policy}
            onChange={(event) =>
              setPolicy(event.target.value as ConfiguredCapabilityRecord["active_policy"])
            }
          >
            <option value="privacy-first">Privacy first</option>
            <option value="latency-optimized">Latency optimized</option>
            <option value="cost-optimized">Cost optimized</option>
            <option value="manual">Manual</option>
          </select>
          <button type="button" onClick={() => void save()}>
            Save provider settings
          </button>
          {status ? (
            <p className="muted" role="status">
              {status}
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
};

const SettingsView = ({
  configuration,
  error,
  onUpdate,
}: {
  configuration: NovaConfiguration | null;
  error: string | null;
  onUpdate: (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ) => Promise<NovaConfiguration>;
}) => {
  const preferences = configuration?.personalization.preferences ?? [];
  const [id, setId] = useState(preferences[0]?.id ?? "tone.default");
  const [category, setCategory] = useState<PersonalizationCategory>(
    preferences[0]?.category ?? "tone",
  );
  const [valueText, setValueText] = useState(
    JSON.stringify(preferences[0]?.value ?? { style: "concise" }, null, 2),
  );
  const [excludedDomainsText, setExcludedDomainsText] = useState(
    (configuration?.permissions.browser_excluded_domains ?? []).join("\n"),
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setExcludedDomainsText((configuration?.permissions.browser_excluded_domains ?? []).join("\n"));
  }, [configuration?.permissions.browser_excluded_domains]);

  const savePreference = async () => {
    let value: unknown;
    try {
      value = JSON.parse(valueText) as unknown;
    } catch {
      setStatus("Preference value must be valid JSON.");
      return;
    }
    const record: PersonalizationPreferenceRecord = {
      id: id.trim(),
      category,
      value,
      enabled: true,
      source: "user",
      updated_at: new Date().toISOString(),
    };
    if (!record.id) {
      setStatus("Preference id is required.");
      return;
    }
    const next = [...preferences.filter((preference) => preference.id !== record.id), record];
    try {
      await onUpdate("personalization", { preferences: next });
      setStatus("Personalization preference saved.");
    } catch (saveError: unknown) {
      setStatus(saveError instanceof Error ? saveError.message : "Preference could not be saved.");
    }
  };

  const saveBrowserPrivacy = async () => {
    const domains = excludedDomainsText
      .split(/\r?\n/)
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);
    try {
      await onUpdate("permissions", {
        ...(configuration?.permissions ?? {}),
        browser_excluded_domains: domains,
      });
      setStatus("Browser privacy exclusions saved.");
    } catch (saveError: unknown) {
      setStatus(
        saveError instanceof Error
          ? saveError.message
          : "Browser privacy exclusions could not be saved.",
      );
    }
  };

  const resetPreference = async (preferenceId?: string) => {
    const next = preferenceId
      ? preferences.filter((preference) => preference.id !== preferenceId)
      : [];
    try {
      await onUpdate("personalization", { preferences: next });
      setStatus(preferenceId ? "Preference reset." : "All personalization reset.");
    } catch (resetError: unknown) {
      setStatus(
        resetError instanceof Error ? resetError.message : "Preference could not be reset.",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="settings-title">
      <div className="section-kicker">Settings / Visible personalization</div>
      <h1 id="settings-title">Make NOVA fit your working style.</h1>
      <p className="lede">
        Preferences are explicit policy records. They can be inspected, edited, or reset and never
        retrain the model.
      </p>
      {error ? (
        <div className="state-strip">
          <strong>Configuration unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}
      <div className="surface-grid">
        <article className="surface-card">
          <label htmlFor="preference-id">Preference id</label>
          <input id="preference-id" value={id} onChange={(event) => setId(event.target.value)} />
          <label htmlFor="preference-category">Category</label>
          <select
            id="preference-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as PersonalizationCategory)}
          >
            <option value="tone">Tone</option>
            <option value="tool-default">Tool default</option>
            <option value="provider-default">Provider default</option>
            <option value="proactive-timing">Proactive timing</option>
            <option value="routing-preference">Routing preference</option>
          </select>
          <label htmlFor="preference-value">Structured value (JSON)</label>
          <textarea
            id="preference-value"
            rows={7}
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
          />
          <button type="button" onClick={() => void savePreference()}>
            Save preference
          </button>
          <button type="button" onClick={() => void resetPreference()}>
            Reset all personalization
          </button>
          {status ? (
            <p className="muted" role="status">
              {status}
            </p>
          ) : null}
        </article>
        <article className="surface-card">
          <strong>Browser privacy boundary</strong>
          <p className="muted">
            One hostname per line. Prefix a hostname with <code>*.</code> to exclude the host and
            its subdomains before metadata reaches the event bus or memory.
          </p>
          <label htmlFor="browser-excluded-domains">Excluded browser domains</label>
          <textarea
            id="browser-excluded-domains"
            rows={7}
            value={excludedDomainsText}
            onChange={(event) => setExcludedDomainsText(event.target.value)}
            placeholder="bank.example.com\n*.private.example"
          />
          <button type="button" onClick={() => void saveBrowserPrivacy()}>
            Save browser privacy
          </button>
        </article>
        <article className="surface-card">
          <strong>Stored preferences</strong>
          {preferences.length === 0 ? (
            <p className="muted">No personalization records are stored.</p>
          ) : (
            preferences.map((preference) => (
              <div className="task-header" key={preference.id}>
                <span>
                  {preference.id} · {preference.category}
                </span>
                <button type="button" onClick={() => void resetPreference(preference.id)}>
                  Reset
                </button>
              </div>
            ))
          )}
        </article>
      </div>
    </section>
  );
};

const MemoryView = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly DesktopMemoryRecord[]>([]);
  const [selected, setSelected] = useState<DesktopMemoryRecord | null>(null);
  const [state, setState] = useState<
    "idle" | "loading" | "populated" | "empty" | "error" | "offline" | "permission"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setState("loading");
    setError(null);
    setSelected(null);
    try {
      const response = await window.nova.searchMemory({ query: trimmed });
      setResults(response.results);
      setState(response.results.length > 0 ? "populated" : "empty");
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Memory search failed.";
      setError(message);
      const normalized = message.toLocaleLowerCase();
      setState(
        normalized.includes("permission")
          ? "permission"
          : normalized.includes("offline") || normalized.includes("not ready")
            ? "offline"
            : "error",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="memory-title">
      <div className="section-kicker">Memory / Grounded records</div>
      <h1 id="memory-title">Find what NOVA remembers.</h1>
      <p className="lede">
        Search workspace-scoped records across Working, Recent, and Long-term Memory. Each result
        keeps its tier, confidence, checksum-verified reference, and lineage visible.
      </p>
      <div className="surface-card memory-search-card">
        <label htmlFor="memory-query">Search memory</label>
        <div className="inline-form">
          <input
            id="memory-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            placeholder="Try: deployment or latest decision"
          />
          <button
            disabled={!query.trim() || state === "loading"}
            onClick={() => void search()}
            type="button"
          >
            {state === "loading" ? "Searching…" : "Search"}
          </button>
        </div>
      </div>
      {state === "idle" ? (
        <div className="empty-state">
          <span className="empty-glyph">M</span>
          <strong>Memory is ready to search.</strong>
          <span className="muted">Enter a grounded term above to browse workspace records.</span>
        </div>
      ) : state === "loading" ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading memory</strong>
          <span className="muted">
            Checking the local workspace store and verifying record checksums.
          </span>
        </div>
      ) : state === "error" || state === "offline" || state === "permission" ? (
        <div className="state-strip state-error" role="alert">
          <strong>
            {state === "permission"
              ? "Memory permission denied"
              : state === "offline"
                ? "Memory is offline"
                : "Memory search failed"}
          </strong>
          <span className="muted">{error}</span>
          <span className="muted">Try again when the local runtime is available.</span>
        </div>
      ) : state === "empty" ? (
        <div className="empty-state">
          <span className="empty-glyph">?</span>
          <strong>No memory matched “{query.trim()}”.</strong>
          <span className="muted">
            Try a shorter term or search a task, decision, or project reference.
          </span>
        </div>
      ) : (
        <div className="memory-results" aria-live="polite">
          <div className="results-heading">
            <strong>
              {results.length} grounded record{results.length === 1 ? "" : "s"}
            </strong>
            <span className="muted">Complete local result set</span>
          </div>
          <div className="memory-list">
            {results.map((record) => (
              <article className="memory-card" key={record.record_id}>
                <div className="task-header">
                  <div>
                    <span className="memory-tier">{record.tier.replace("_", " ")}</span>
                    <h2>{record.content_ref}</h2>
                  </div>
                  {record.confidence !== undefined ? (
                    <span className="task-status">
                      {Math.round(record.confidence * 100)}% confidence
                    </span>
                  ) : null}
                </div>
                <div className="memory-meta">
                  <code>{record.record_id}</code>
                  <span>{new Date(record.created_at).toLocaleString()}</span>
                  {record.status ? <span>{record.status}</span> : null}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setSelected(record)}
                  type="button"
                >
                  View lineage
                </button>
              </article>
            ))}
          </div>
          {selected ? (
            <article className="surface-card lineage-card" aria-labelledby="lineage-title">
              <div className="task-header">
                <strong id="lineage-title">Lineage for {selected.record_id}</strong>
                <button
                  className="secondary-button"
                  onClick={() => setSelected(null)}
                  type="button"
                >
                  Close
                </button>
              </div>
              {selected.lineage.length === 0 ? (
                <p className="muted">This record is an origin record with no stored predecessor.</p>
              ) : (
                <ul className="lineage-list">
                  {selected.lineage.map((entry) => (
                    <li key={`${entry.relation}-${entry.source_record_id}`}>
                      <span>{entry.relation.replaceAll("_", " ")}</span>
                      <code>{entry.source_record_id}</code>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
};

const GraphView = () => {
  const [nodeId, setNodeId] = useState("");
  const [direction, setDirection] = useState<"in" | "out" | "both">("both");
  const [depth, setDepth] = useState(1);
  const [result, setResult] = useState<DesktopGraphResult | null>(null);
  const [state, setState] = useState<
    "idle" | "loading" | "populated" | "empty" | "error" | "offline" | "permission"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const query = async () => {
    const trimmed = nodeId.trim();
    if (!trimmed) return;
    setState("loading");
    setError(null);
    try {
      const response = await window.nova.queryGraph({
        node_id: trimmed,
        direction,
        depth,
      });
      setResult(response);
      setState(response.nodes.length > 0 ? "populated" : "empty");
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Graph query failed.";
      setError(message);
      const normalized = message.toLocaleLowerCase();
      setState(
        normalized.includes("permission")
          ? "permission"
          : normalized.includes("offline") || normalized.includes("not ready")
            ? "offline"
            : "error",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="graph-title">
      <div className="section-kicker">Knowledge Graph / Relationships</div>
      <h1 id="graph-title">Explore workspace connections.</h1>
      <p className="lede">
        Query a bounded neighborhood around an entity. Traversal depth is limited to three hops and
        the fixed ontology keeps relationships auditable.
      </p>
      <div className="surface-card graph-query-card">
        <label htmlFor="graph-node">Root node id</label>
        <div className="inline-form graph-form">
          <input
            id="graph-node"
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void query();
            }}
            placeholder="project-1 or task-123"
          />
          <select
            aria-label="Graph traversal direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as typeof direction)}
          >
            <option value="both">Both directions</option>
            <option value="out">Outgoing</option>
            <option value="in">Incoming</option>
          </select>
          <select
            aria-label="Graph traversal depth"
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
          <button
            disabled={!nodeId.trim() || state === "loading"}
            onClick={() => void query()}
            type="button"
          >
            {state === "loading" ? "Loading…" : "Query graph"}
          </button>
        </div>
      </div>
      {state === "idle" ? (
        <div className="empty-state">
          <span className="empty-glyph">G</span>
          <strong>Knowledge Graph is ready.</strong>
          <span className="muted">Enter a root node id to inspect its bounded relationships.</span>
        </div>
      ) : state === "loading" ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading graph neighborhood</strong>
          <span className="muted">
            Validating the node, ontology, direction, and traversal bound.
          </span>
        </div>
      ) : state === "error" || state === "offline" || state === "permission" ? (
        <div className="state-strip state-error" role="alert">
          <strong>
            {state === "permission"
              ? "Graph permission denied"
              : state === "offline"
                ? "Graph is offline"
                : "Graph query failed"}
          </strong>
          <span className="muted">{error}</span>
          <span className="muted">Check the node id and try again.</span>
        </div>
      ) : state === "empty" && result ? (
        <div className="state-strip" role="status">
          <strong>Root found; no neighboring nodes matched.</strong>
          <span className="muted">
            {result.root.name} is available, but this bounded query returned no connected records.
          </span>
        </div>
      ) : result ? (
        <div className="graph-results" aria-live="polite">
          <article className="surface-card">
            <div className="task-header">
              <div>
                <span className="memory-tier">Root · {result.root.type}</span>
                <h2>{result.root.name}</h2>
              </div>
              <span className="task-status">{result.nodes.length} neighbors</span>
            </div>
            <code>{result.root.id}</code>
          </article>
          <div className="surface-grid">
            {result.nodes.map((node) => (
              <article className="surface-card" key={node.id}>
                <div className="task-header">
                  <strong>{node.name}</strong>
                  <span className="task-status">{node.type}</span>
                </div>
                <p>{node.id}</p>
                <span className="muted">{node.active ? "Active entity" : "Inactive entity"}</span>
              </article>
            ))}
          </div>
          <article className="surface-card">
            <div className="task-header">
              <strong>Edges in this query</strong>
              <span className="task-status">{result.edges.length}</span>
            </div>
            <ul className="lineage-list">
              {result.edges.map((edge) => (
                <li key={edge.id}>
                  <span>{edge.type.replaceAll("_", " ")}</span>
                  <code>
                    {edge.from_node_id} → {edge.to_node_id}
                  </code>
                </li>
              ))}
            </ul>
          </article>
        </div>
      ) : null}
    </section>
  );
};

const WorkflowView = () => {
  const [draftText, setDraftText] = useState(
    JSON.stringify(
      {
        workflow_id: "daily-review",
        start_node_id: "start",
        nodes: [
          { id: "start", type: "task" },
          { id: "finish", type: "end" },
        ],
        edges: [{ from: "start", to: "finish" }],
      },
      null,
      2,
    ),
  );
  const [draft, setDraft] = useState<DesktopWorkflowDraft | null>(null);
  const [validation, setValidation] = useState<DesktopWorkflowValidation | null>(null);
  const [state, setState] = useState<"empty" | "ready" | "validating" | "invalid" | "error">(
    "empty",
  );
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    setState("validating");
    setError(null);
    let parsed: DesktopWorkflowDraft;
    try {
      parsed = JSON.parse(draftText) as DesktopWorkflowDraft;
    } catch {
      setState("invalid");
      setValidation({
        valid: false,
        code: "NOVA-WFL001",
        message: "Workflow draft must be valid JSON.",
      });
      return;
    }
    try {
      const result = await window.nova.validateWorkflow(parsed);
      setDraft(parsed);
      setValidation(result);
      setState(result.valid ? "ready" : "invalid");
    } catch (cause: unknown) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Workflow validation is unavailable.");
    }
  };

  return (
    <section className="content-column" aria-labelledby="workflow-title">
      <div className="section-kicker">Workflow Builder / Bounded validation</div>
      <h1 id="workflow-title">Compose verified workflow graphs.</h1>
      <p className="lede">
        Draft nodes and directed edges, then validate them against the authoritative WorkflowEngine.
        Execution remains gated behind the existing Planner, Executor, Verifier, and Permission
        Manager.
      </p>
      <div className="surface-grid workflow-grid">
        <article className="surface-card workflow-editor-card">
          <label htmlFor="workflow-json">Workflow draft (JSON)</label>
          <textarea
            id="workflow-json"
            rows={19}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          <button type="button" disabled={state === "validating"} onClick={() => void validate()}>
            {state === "validating" ? "Validating…" : "Validate workflow"}
          </button>
        </article>
        <article className="surface-card workflow-status-card">
          <strong>Validation status</strong>
          {state === "validating" ? (
            <div className="state-strip" aria-busy="true" role="status">
              <strong>Checking graph constraints</strong>
              <span className="muted">
                Validating node identity, edges, start node, and cycles.
              </span>
            </div>
          ) : state === "error" ? (
            <div className="state-strip state-error" role="alert">
              <strong>Workflow service unavailable</strong>
              <span className="muted">{error}</span>
            </div>
          ) : state === "invalid" && validation && !validation.valid ? (
            <div className="state-strip state-error" role="alert">
              <strong>{validation.code}</strong>
              <span className="muted">{validation.message}</span>
            </div>
          ) : state === "ready" && validation && validation.valid ? (
            <div className="state-strip" role="status">
              <strong>Workflow is valid</strong>
              <span className="muted">
                {validation.node_count} nodes and {validation.edge_count} directed edges are ready
                for a runtime execution adapter.
              </span>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-glyph">W</span>
              <strong>No validation result yet.</strong>
              <span className="muted">
                Edit the draft and validate it before execution is considered.
              </span>
            </div>
          )}
          {draft ? (
            <div className="workflow-node-list" aria-label="Workflow node summary">
              {draft.nodes.map((node, index) => (
                <div className="workflow-node-row" key={`${node.id}-${index}`}>
                  <span className="task-status">{node.type}</span>
                  <strong>{node.id}</strong>
                  <span className="muted">{index === 0 ? "start candidate" : "graph node"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      </div>
      <div className="state-strip" role="note">
        <strong>Execution boundary</strong>
        <span className="muted">
          This editor does not run tasks, request permissions, or execute arbitrary workflow JSON.
        </span>
      </div>
    </section>
  );
};

const DiagnosticsView = () => {
  const [records, setRecords] = useState<readonly DesktopDiagnosticRecord[]>([]);
  const [partial, setPartial] = useState(false);
  const [collectedAt, setCollectedAt] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "populated" | "empty" | "degraded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setState("loading");
    setError(null);
    try {
      const snapshot = await window.nova.getDiagnostics();
      setRecords(snapshot.records);
      setPartial(snapshot.partial);
      setCollectedAt(snapshot.collected_at);
      setState(snapshot.partial ? "degraded" : snapshot.records.length > 0 ? "populated" : "empty");
    } catch (cause: unknown) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Diagnostics are unavailable.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const warningCount = records.filter(
    (record) =>
      record.severity === "warning" ||
      record.severity === "error" ||
      record.severity === "critical",
  ).length;

  return (
    <section className="content-column" aria-labelledby="diagnostics-title">
      <div className="section-kicker">Diagnostics / Local evidence</div>
      <div className="task-header diagnostics-heading">
        <div>
          <h1 id="diagnostics-title">Check NOVA’s health.</h1>
          <p className="lede">
            Review bounded, redacted runtime evidence retained on this device. Diagnostic records
            never include credentials, raw content, screenshots, or keystrokes.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={state === "loading"}
          onClick={() => void refresh()}
          type="button"
        >
          {state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="surface-grid diagnostics-grid">
        <SurfaceCard title="Runtime" detail="Core desktop services are available." state="Online" />
        <SurfaceCard
          title="Retained records"
          detail="Bounded local JSONL evidence."
          state={`${records.length}`}
        />
        <SurfaceCard
          title="Attention"
          detail="Warning, error, and critical records."
          state={`${warningCount}`}
        />
      </div>
      {state === "loading" ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading diagnostics</strong>
          <span className="muted">Reading the bounded local diagnostics file.</span>
        </div>
      ) : state === "error" ? (
        <div className="state-strip state-error" role="alert">
          <strong>Diagnostics unavailable</strong>
          <span className="muted">{error}</span>
          <span className="muted">Confirm the local desktop runtime is online, then refresh.</span>
        </div>
      ) : state === "empty" ? (
        <div className="empty-state">
          <span className="empty-glyph">D</span>
          <strong>No diagnostic events retained.</strong>
          <span className="muted">Run a task or refresh later to collect local evidence.</span>
        </div>
      ) : (
        <div className="diagnostic-list" aria-live="polite">
          <div className={state === "degraded" ? "state-strip state-error" : "state-strip"}>
            <strong>{state === "degraded" ? "Partial diagnostics" : "Diagnostics ready"}</strong>
            <span className="muted">
              {partial
                ? "Some log lines were malformed and were excluded from this snapshot."
                : `Collected ${collectedAt ? new Date(collectedAt).toLocaleString() : "just now"}.`}
            </span>
          </div>
          <div className="log-list">
            {records.map((record) => (
              <article
                className="log-row"
                key={`${record.timestamp}-${record.event}-${record.correlation_id ?? ""}`}
              >
                <div className="task-header">
                  <span className={`log-severity log-${record.severity}`}>{record.severity}</span>
                  <time dateTime={record.timestamp}>
                    {new Date(record.timestamp).toLocaleString()}
                  </time>
                </div>
                <strong>{record.event}</strong>
                <span className="muted">{record.service}</span>
                {record.correlation_id ? <code>{record.correlation_id}</code> : null}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const LogsView = () => {
  const [records, setRecords] = useState<readonly DesktopDiagnosticRecord[]>([]);
  const [eventFilter, setEventFilter] = useState("");
  const [severity, setSeverity] = useState<"all" | DesktopDiagnosticRecord["severity"]>("all");
  const [state, setState] = useState<"loading" | "ready" | "empty" | "partial" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setState("loading");
    setError(null);
    try {
      const snapshot = await window.nova.getDiagnostics();
      setRecords(snapshot.records);
      setState(snapshot.partial ? "partial" : snapshot.records.length > 0 ? "ready" : "empty");
    } catch (cause: unknown) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Logs are unavailable.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = records.filter(
    (record) =>
      (severity === "all" || record.severity === severity) &&
      (eventFilter.trim().length === 0 ||
        record.event.toLocaleLowerCase().includes(eventFilter.trim().toLocaleLowerCase())),
  );

  return (
    <section className="content-column" aria-labelledby="logs-title">
      <div className="section-kicker">Logs / Power-user event stream</div>
      <div className="task-header diagnostics-heading">
        <div>
          <h1 id="logs-title">Search runtime events.</h1>
          <p className="lede">
            Filter local structured events by severity or event name. Details are intentionally
            omitted from this view to preserve the privacy-safe diagnostics boundary.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={state === "loading"}
          onClick={() => void refresh()}
          type="button"
        >
          {state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="surface-card log-filter-card">
        <label htmlFor="event-filter">Event filter</label>
        <div className="inline-form">
          <input
            id="event-filter"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
            placeholder="runtime.start or observer"
          />
          <select
            aria-label="Log severity filter"
            value={severity}
            onChange={(event) =>
              setSeverity(event.target.value as "all" | DesktopDiagnosticRecord["severity"])
            }
          >
            <option value="all">All severities</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>
      {state === "loading" ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading event stream</strong>
          <span className="muted">Reading bounded local JSONL diagnostics.</span>
        </div>
      ) : state === "error" ? (
        <div className="state-strip state-error" role="alert">
          <strong>Event stream unavailable</strong>
          <span className="muted">{error}</span>
        </div>
      ) : state === "empty" ? (
        <div className="empty-state">
          <span className="empty-glyph">L</span>
          <strong>No structured events retained.</strong>
          <span className="muted">Run a task or refresh later to collect local events.</span>
        </div>
      ) : (
        <div className="diagnostic-list" aria-live="polite">
          {state === "partial" ? (
            <div className="state-strip state-error" role="status">
              <strong>Partial event stream</strong>
              <span className="muted">Malformed lines were excluded before filtering.</span>
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-glyph">?</span>
              <strong>No events match the active filters.</strong>
              <span className="muted">
                Clear the event or severity filter to broaden the result.
              </span>
            </div>
          ) : (
            <div className="log-list">
              {filtered.map((record) => (
                <article
                  className="log-row"
                  key={`${record.timestamp}-${record.event}-${record.correlation_id ?? ""}`}
                >
                  <div className="task-header">
                    <span className={`log-severity log-${record.severity}`}>{record.severity}</span>
                    <time dateTime={record.timestamp}>
                      {new Date(record.timestamp).toLocaleString()}
                    </time>
                  </div>
                  <strong>{record.event}</strong>
                  <span className="muted">{record.service}</span>
                  {record.correlation_id ? <code>{record.correlation_id}</code> : null}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const UpdatesView = () => {
  const [info, setInfo] = useState<DesktopUpdateInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "degraded" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setState("loading");
    setError(null);
    try {
      const snapshot = await window.nova.getUpdateInfo();
      setInfo(snapshot);
      setState(snapshot.partial ? "degraded" : snapshot.changelog.length > 0 ? "ready" : "empty");
    } catch (cause: unknown) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Update information is unavailable.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="content-column" aria-labelledby="updates-title">
      <div className="section-kicker">Updates / Release readiness</div>
      <div className="task-header diagnostics-heading">
        <div>
          <h1 id="updates-title">Keep NOVA current.</h1>
          <p className="lede">
            Review the local version, release notes, and update controls. This source checkout does
            not silently contact a hosted update service or claim rollback readiness.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={state === "loading"}
          onClick={() => void refresh()}
          type="button"
        >
          {state === "loading" ? "Checking…" : "Refresh"}
        </button>
      </div>
      {state === "loading" ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading release metadata</strong>
          <span className="muted">Reading the local package version and changelog.</span>
        </div>
      ) : state === "error" ? (
        <div className="state-strip state-error" role="alert">
          <strong>Update information unavailable</strong>
          <span className="muted">{error}</span>
        </div>
      ) : info ? (
        <div className="release-content">
          <div className="surface-grid">
            <SurfaceCard
              title="Current version"
              detail="Installed local desktop version."
              state={info.current_version}
            />
            <SurfaceCard
              title="Update service"
              detail="Remote update discovery status."
              state="Not configured"
            />
            <SurfaceCard
              title="Rollback"
              detail="A verified rollback snapshot is not available from this source checkout."
              state="Unavailable"
            />
          </div>
          {state === "degraded" ? (
            <div className="state-strip state-error" role="status">
              <strong>Partial release metadata</strong>
              <span className="muted">
                Some local release files were unavailable; the values shown are incomplete.
              </span>
            </div>
          ) : null}
          {state === "empty" ? (
            <div className="empty-state">
              <span className="empty-glyph">U</span>
              <strong>No changelog entries are available.</strong>
              <span className="muted">
                The local version is known, but release notes were not packaged with this build.
              </span>
            </div>
          ) : (
            <article className="surface-card release-card">
              <div className="task-header">
                <strong>Changelog</strong>
                <span className="muted">Checked {new Date(info.checked_at).toLocaleString()}</span>
              </div>
              <div className="release-list">
                {info.changelog.map((entry) => (
                  <div className="release-row" key={`${entry.version}-${entry.date}`}>
                    <strong>{entry.version}</strong>
                    <time dateTime={entry.date}>{entry.date}</time>
                  </div>
                ))}
              </div>
            </article>
          )}
        </div>
      ) : null}
    </section>
  );
};

const VoiceSettingsView = ({
  configuration,
  error,
  onUpdate,
}: {
  configuration: NovaConfiguration | null;
  error: string | null;
  onUpdate: (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ) => Promise<NovaConfiguration>;
}) => {
  const voice = configuration?.voice;
  const [enabled, setEnabled] = useState(voice?.enabled ?? false);
  const [alwaysListening, setAlwaysListening] = useState(voice?.always_listening ?? false);
  const [wakeWord, setWakeWord] = useState(voice?.wake_word ?? "nova");
  const [sensitivity, setSensitivity] = useState(voice?.barge_in_sensitivity ?? "conservative");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(voice?.enabled ?? false);
    setAlwaysListening(voice?.always_listening ?? false);
    setWakeWord(voice?.wake_word ?? "nova");
    setSensitivity(voice?.barge_in_sensitivity ?? "conservative");
  }, [voice]);

  const save = async () => {
    if (!wakeWord.trim()) {
      setStatus("Wake word is required when voice configuration is enabled.");
      return;
    }
    try {
      await onUpdate("voice", {
        enabled,
        wake_word: wakeWord.trim(),
        always_listening: alwaysListening,
        barge_in_sensitivity: sensitivity,
      });
      setStatus("Voice configuration saved locally.");
    } catch (cause: unknown) {
      setStatus(cause instanceof Error ? cause.message : "Voice configuration could not be saved.");
    }
  };

  return (
    <section className="content-column" aria-labelledby="voice-title">
      <div className="section-kicker">Voice / Privacy-first readiness</div>
      <h1 id="voice-title">Control how NOVA listens.</h1>
      <p className="lede">
        Voice settings are explicit local policy. Audio providers and speech binaries are not
        bundled with this source checkout, so enabling policy never starts a hidden listener.
      </p>
      {error ? (
        <div className="state-strip state-error" role="alert">
          <strong>Voice configuration unavailable</strong>
          <span className="muted">{error}</span>
        </div>
      ) : null}
      {configuration === null ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading voice settings</strong>
          <span className="muted">Reading the local configuration store.</span>
        </div>
      ) : (
        <div className="surface-grid">
          <article className="surface-card">
            <div className="task-header">
              <strong>Voice pipeline</strong>
              <span className="task-status">{enabled ? "Enabled" : "Off"}</span>
            </div>
            <p>
              Streaming transcript, barge-in, and speaking states are available when a provider is
              configured.
            </p>
            <label className="toggle-row">
              <span>Enable voice policy</span>
              <input
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="toggle-row">
              <span>Always listening</span>
              <input
                checked={alwaysListening}
                disabled={!enabled}
                onChange={(event) => setAlwaysListening(event.target.checked)}
                type="checkbox"
              />
            </label>
          </article>
          <article className="surface-card">
            <label htmlFor="wake-word">Wake word</label>
            <input
              id="wake-word"
              value={wakeWord}
              onChange={(event) => setWakeWord(event.target.value)}
            />
            <label htmlFor="barge-in-sensitivity">Barge-in sensitivity</label>
            <select
              id="barge-in-sensitivity"
              value={sensitivity}
              onChange={(event) =>
                setSensitivity(event.target.value as "aggressive" | "conservative")
              }
            >
              <option value="conservative">Conservative</option>
              <option value="aggressive">Aggressive</option>
            </select>
            <button type="button" onClick={() => void save()}>
              Save voice settings
            </button>
            {status ? (
              <p className="muted" role="status">
                {status}
              </p>
            ) : null}
          </article>
          <article className="surface-card">
            <strong>Privacy boundary</strong>
            <p>Voice configuration does not grant microphone access or persist raw audio.</p>
            <span className="muted">
              Provider installation and live hardware validation remain explicit follow-up steps.
            </span>
          </article>
        </div>
      )}
    </section>
  );
};

const DevicesView = ({
  configuration,
  error,
  onUpdate,
}: {
  configuration: NovaConfiguration | null;
  error: string | null;
  onUpdate: (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ) => Promise<NovaConfiguration>;
}) => {
  const devices = configuration?.devices ?? [];
  const [trustedDevices, setTrustedDevices] = useState<readonly DesktopTrustedDevice[]>([]);
  const [trustedState, setTrustedState] = useState<"loading" | "ready" | "error">("loading");
  const [trustedError, setTrustedError] = useState<string | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [syncAction, setSyncAction] = useState<"pull" | "flush" | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [deviceSnapshots, setDeviceSnapshots] = useState<readonly DesktopDeviceSnapshot[]>([]);
  const [snapshotState, setSnapshotState] = useState<"loading" | "ready" | "error">("loading");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [negotiationDeviceId, setNegotiationDeviceId] = useState("");
  const [negotiationCapability, setNegotiationCapability] = useState("");
  const [negotiationState, setNegotiationState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [negotiationResult, setNegotiationResult] = useState<{
    device_id: string;
    capability_id: string;
    status: string;
  } | null>(null);
  const [negotiationError, setNegotiationError] = useState<string | null>(null);
  const [devicesText, setDevicesText] = useState(JSON.stringify(devices, null, 2));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDevicesText(JSON.stringify(configuration?.devices ?? [], null, 2));
  }, [configuration?.devices]);

  useEffect(() => {
    let active = true;
    void window.nova
      .getTrustedDevices()
      .then((next) => {
        if (!active) return;
        setTrustedDevices(next);
        setTrustedState("ready");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setTrustedState("error");
        setTrustedError(
          cause instanceof Error ? cause.message : "Trusted devices are unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void window.nova
      .getDeviceSnapshots()
      .then((next) => {
        if (!active) return;
        setDeviceSnapshots(next);
        setSnapshotState("ready");
        setNegotiationDeviceId((current) => current || next[0]?.device_id || "");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSnapshotState("error");
        setSnapshotError(
          cause instanceof Error ? cause.message : "Device presence is unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const revoke = async (deviceId: string) => {
    if (!window.confirm(`Revoke Nova access for ${deviceId}?`)) return;
    setRevokingDeviceId(deviceId);
    setRevokeError(null);
    try {
      const result = await window.nova.revokeTrustedDevice(deviceId, true);
      if (!result.ok) {
        setRevokeError(result.error?.message ?? "Device access could not be revoked.");
        return;
      }
      setTrustedDevices((current) => current.filter((device) => device.device_id !== deviceId));
    } catch (cause: unknown) {
      setRevokeError(
        cause instanceof Error ? cause.message : "Device access could not be revoked.",
      );
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const runSync = async (action: "pull" | "flush") => {
    setSyncAction(action);
    setSyncStatus(null);
    try {
      if (action === "pull") {
        const result = await window.nova.syncDevices();
        if (!result.ok || !result.value) {
          setSyncStatus(result.error?.message ?? "Device sync could not be completed.");
          return;
        }
        setSyncStatus(
          `Checkpoint ${result.value.checkpoint}; applied ${result.value.applied_change_ids.length} change(s).`,
        );
      } else {
        if (!window.confirm("Push local device-sync changes to other devices?")) return;
        const result = await window.nova.flushDeviceSync(true);
        if (!result.ok || !result.value) {
          setSyncStatus(result.error?.message ?? "Local sync changes could not be flushed.");
          return;
        }
        setSyncStatus(`Flushed ${result.value.pushed_change_ids.length} local change(s).`);
      }
    } catch (cause: unknown) {
      setSyncStatus(cause instanceof Error ? cause.message : "Device sync is unavailable.");
    } finally {
      setSyncAction(null);
    }
  };

  const negotiate = async () => {
    if (!negotiationDeviceId || !negotiationCapability.trim()) {
      setNegotiationState("error");
      setNegotiationError("Choose a device and enter a capability before negotiating.");
      return;
    }
    setNegotiationState("loading");
    setNegotiationError(null);
    try {
      const result = await window.nova.negotiateDeviceCapability(
        negotiationDeviceId,
        negotiationCapability.trim(),
      );
      if (!result.ok || !result.value) {
        setNegotiationState("error");
        setNegotiationError(result.error?.message ?? "Capability negotiation failed.");
        setNegotiationResult(null);
        return;
      }
      setNegotiationResult(result.value);
      setNegotiationState("ready");
    } catch (cause: unknown) {
      setNegotiationState("error");
      setNegotiationError(
        cause instanceof Error ? cause.message : "Capability negotiation failed.",
      );
      setNegotiationResult(null);
    }
  };

  const save = async () => {
    let next: unknown;
    try {
      next = JSON.parse(devicesText) as unknown;
    } catch {
      setStatus("Device configuration must be valid JSON.");
      return;
    }
    if (!Array.isArray(next)) {
      setStatus("Device configuration must be a JSON array.");
      return;
    }
    try {
      await onUpdate("devices", next);
      setStatus("Device configuration saved locally.");
    } catch (cause: unknown) {
      setStatus(
        cause instanceof Error ? cause.message : "Device configuration could not be saved.",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="devices-title">
      <div className="section-kicker">Device Management / Local configuration</div>
      <h1 id="devices-title">Manage paired device records.</h1>
      <p className="lede">
        Device records are stored as validated local configuration. Pairing, presence, capability,
        and sync services can consume these records without exposing credentials in the renderer.
      </p>
      {error ? (
        <div className="state-strip state-error" role="alert">
          <strong>Device configuration unavailable</strong>
          <span className="muted">{error}</span>
        </div>
      ) : null}
      {configuration === null ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading devices</strong>
          <span className="muted">Reading the local configuration store.</span>
        </div>
      ) : (
        <div className="surface-grid">
          <article className="surface-card">
            <div className="task-header">
              <strong>Configured devices</strong>
              <span className="task-status">{devices.length}</span>
            </div>
            <p>
              {devices.length === 0
                ? "No paired device records are configured. Add a record below when a companion is ready."
                : "Paired records are available to the runtime boundary."}
            </p>
          </article>
          <article className="surface-card sync-card">
            <div className="task-header">
              <strong>Sync boundary</strong>
              <span className="muted">on demand</span>
            </div>
            <p>Pull encrypted changes or flush local changes only when explicitly requested.</p>
            <div className="sync-actions">
              <button
                type="button"
                onClick={() => void runSync("pull")}
                disabled={syncAction !== null}
              >
                {syncAction === "pull" ? "Syncing…" : "Sync now"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void runSync("flush")}
                disabled={syncAction !== null}
              >
                {syncAction === "flush" ? "Flushing…" : "Flush local changes"}
              </button>
            </div>
            {syncStatus ? (
              <p className="muted" role="status">
                {syncStatus}
              </p>
            ) : null}
          </article>
          <article className="surface-card trusted-devices-card">
            <div className="task-header">
              <strong>Trusted paired devices</strong>
              {trustedState === "ready" ? (
                <span className="task-status">{trustedDevices.length}</span>
              ) : null}
            </div>
            {revokeError ? (
              <p className="muted" role="alert">
                {revokeError}
              </p>
            ) : null}
            {trustedState === "loading" ? (
              <span className="muted">Loading trusted-device inventory…</span>
            ) : trustedState === "error" ? (
              <span className="muted">{trustedError}</span>
            ) : trustedDevices.length === 0 ? (
              <span className="muted">No trusted devices are paired with this runtime.</span>
            ) : (
              <div className="trusted-device-list">
                {trustedDevices.map((device) => (
                  <div className="trusted-device-row" key={device.device_id}>
                    <div>
                      <strong>{device.device_id}</strong>
                      <span className="muted">
                        {device.runtime_mode} · {device.state}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void revoke(device.device_id)}
                      disabled={revokingDeviceId !== null}
                      aria-label={`Revoke access for ${device.device_id}`}
                    >
                      {revokingDeviceId === device.device_id ? "Revoking…" : "Revoke access"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="surface-card presence-card">
            <div className="task-header">
              <strong>Presence and capabilities</strong>
              {snapshotState === "ready" ? (
                <span className="task-status">{deviceSnapshots.length}</span>
              ) : null}
            </div>
            {snapshotState === "loading" ? (
              <span className="muted">Loading heartbeat status…</span>
            ) : snapshotState === "error" ? (
              <span className="muted">{snapshotError}</span>
            ) : deviceSnapshots.length === 0 ? (
              <span className="muted">No registered device presence is available.</span>
            ) : (
              <div className="presence-list">
                {deviceSnapshots.map((device) => (
                  <div className="presence-row" key={device.device_id}>
                    <div>
                      <strong>{device.device_id}</strong>
                      <span className="muted">{device.capabilities.length} capabilities</span>
                    </div>
                    <span className={`presence-badge presence-${device.presence.toLowerCase()}`}>
                      {device.presence}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="surface-card negotiation-card">
            <div className="task-header">
              <strong>Negotiate a capability</strong>
              <span className="muted">re-check before remote execution</span>
            </div>
            <div className="negotiation-fields">
              <label>
                Device
                <select
                  value={negotiationDeviceId}
                  onChange={(event) => setNegotiationDeviceId(event.target.value)}
                >
                  <option value="">Select a device</option>
                  {deviceSnapshots.map((device) => (
                    <option key={device.device_id} value={device.device_id}>
                      {device.device_id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Capability
                <input
                  value={negotiationCapability}
                  onChange={(event) => setNegotiationCapability(event.target.value)}
                  placeholder="camera, microphone, gps"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void negotiate()}
              disabled={negotiationState === "loading"}
            >
              {negotiationState === "loading" ? "Checking…" : "Check capability"}
            </button>
            {negotiationState === "error" ? (
              <p className="muted" role="alert">
                {negotiationError}
              </p>
            ) : null}
            {negotiationResult ? (
              <p className="muted" role="status">
                {negotiationResult.device_id} · {negotiationResult.capability_id} ·{" "}
                {negotiationResult.status}
              </p>
            ) : null}
          </article>
          <article className="surface-card device-editor-card">
            <label htmlFor="devices-json">Device records (JSON array)</label>
            <textarea
              id="devices-json"
              rows={12}
              value={devicesText}
              onChange={(event) => setDevicesText(event.target.value)}
            />
            <button type="button" onClick={() => void save()}>
              Save device records
            </button>
            {status ? (
              <p className="muted" role="status">
                {status}
              </p>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
};

const PluginsView = ({
  configuration,
  error,
  onUpdate,
}: {
  configuration: NovaConfiguration | null;
  error: string | null;
  onUpdate: (
    section: ConfigurationSectionName,
    value: NovaConfiguration[ConfigurationSectionName],
  ) => Promise<NovaConfiguration>;
}) => {
  const plugins = configuration?.plugins ?? [];
  const [pluginsText, setPluginsText] = useState(JSON.stringify(plugins, null, 2));
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setPluginsText(JSON.stringify(configuration?.plugins ?? [], null, 2));
  }, [configuration?.plugins]);

  const save = async () => {
    let next: unknown;
    try {
      next = JSON.parse(pluginsText) as unknown;
    } catch {
      setStatus("Plugin configuration must be valid JSON.");
      return;
    }
    if (!Array.isArray(next)) {
      setStatus("Plugin configuration must be a JSON array.");
      return;
    }
    try {
      await onUpdate("plugins", next);
      setStatus("Plugin records saved locally.");
    } catch (cause: unknown) {
      setStatus(
        cause instanceof Error ? cause.message : "Plugin configuration could not be saved.",
      );
    }
  };

  return (
    <section className="content-column" aria-labelledby="plugins-title">
      <div className="section-kicker">Plugins / Sandboxed capability records</div>
      <h1 id="plugins-title">Manage trusted extensions.</h1>
      <p className="lede">
        Plugin records are validated local configuration. Installation, updates, and capabilities
        must still pass the core trust, permission, and sandbox boundaries before they become
        reachable.
      </p>
      {error ? (
        <div className="state-strip state-error" role="alert">
          <strong>Plugin configuration unavailable</strong>
          <span className="muted">{error}</span>
        </div>
      ) : null}
      {configuration === null ? (
        <div className="state-strip" aria-busy="true" role="status">
          <strong>Loading plugins</strong>
          <span className="muted">Reading the local configuration store.</span>
        </div>
      ) : (
        <div className="surface-grid">
          <article className="surface-card">
            <div className="task-header">
              <strong>Configured plugins</strong>
              <span className="task-status">{plugins.length}</span>
            </div>
            <p>
              {plugins.length === 0
                ? "No plugin records are configured. The runtime has no marketplace request pending."
                : "Configured records remain subject to plugin discovery and permission checks."}
            </p>
          </article>
          <article className="surface-card">
            <strong>Safety boundary</strong>
            <p>Plugins cannot bypass the Permission Manager, Tool Registry, or Verifier.</p>
            <span className="muted">No plugin code executes from this editor.</span>
          </article>
          <article className="surface-card device-editor-card">
            <label htmlFor="plugins-json">Plugin records (JSON array)</label>
            <textarea
              id="plugins-json"
              rows={12}
              value={pluginsText}
              onChange={(event) => setPluginsText(event.target.value)}
            />
            <button type="button" onClick={() => void save()}>
              Save plugin records
            </button>
            {status ? (
              <p className="muted" role="status">
                {status}
              </p>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
};

const SurfaceView = ({ view }: { view: SurfaceView }) => {
  const meta = surfaceMeta[view];
  return (
    <section className="content-column" aria-labelledby={`${view}-title`}>
      <div className="section-kicker">{viewLabel[view]} / Workspace surface</div>
      <h1 id={`${view}-title`}>{viewLabel[view]}</h1>
      <p className="lede">{meta.purpose}</p>
      <div className="surface-grid">
        {meta.items.map((item) => (
          <SurfaceCard
            key={item}
            title={item}
            detail="Available through the shared runtime boundary."
            state="Ready"
          />
        ))}
      </div>
      <div className="state-strip" aria-live="polite">
        <strong>{meta.state}</strong>
        <span className="muted">
          Loading, empty, error, offline, permission-denied, and partial-data states remain surfaced
          by the connected service boundary.
        </span>
      </div>
    </section>
  );
};

const SurfaceCard = ({
  title,
  detail,
  state,
}: {
  title: string;
  detail: string;
  state: string;
}) => (
  <article className="surface-card">
    <div className="task-header">
      <strong>{title}</strong>
      <span className="task-status">{state}</span>
    </div>
    <p>{detail}</p>
  </article>
);
