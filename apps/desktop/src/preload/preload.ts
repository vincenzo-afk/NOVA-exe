import { contextBridge, ipcRenderer } from "electron";

const novaApi = {
  submitTask: (goal: string) => ipcRenderer.invoke("nova:task:submit", { goal }),
  getTask: (taskId: string) => ipcRenderer.invoke("nova:task:get", { task_id: taskId }),
  listTasks: (limit?: number, cursor?: string) =>
    ipcRenderer.invoke("nova:task:list", { limit, cursor }),
  cancelTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:cancel", { task_id: taskId, confirmed }),
  searchMemory: (input: unknown) => ipcRenderer.invoke("nova:memory:search", input),
  getMemoryRecord: (recordId: string) =>
    ipcRenderer.invoke("nova:memory:record", { record_id: recordId }),
  queryGraph: (input: unknown) => ipcRenderer.invoke("nova:graph:query", input),
  syncDevices: () => ipcRenderer.invoke("nova:devices:sync"),
  flushDeviceSync: (confirmed: boolean) => ipcRenderer.invoke("nova:devices:sync-flush", confirmed),
  getAndroidCompanionPermission: (permission: string) =>
    ipcRenderer.invoke("nova:companion:permission", permission),
  setAndroidCompanionPermission: (permission: string, granted: boolean, confirmed: boolean) =>
    ipcRenderer.invoke("nova:companion:permission-set", { permission, granted, confirmed }),
  checkAndroidCompanionCapability: (input: unknown) =>
    ipcRenderer.invoke("nova:companion:capability", input),
  startAndroidCompanionForegroundService: (confirmed: boolean) =>
    ipcRenderer.invoke("nova:companion:foreground-start", confirmed),
  stopAndroidCompanionForegroundService: (confirmed: boolean) =>
    ipcRenderer.invoke("nova:companion:foreground-stop", confirmed),
  startAndroidCompanionBackground: (capabilityId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:companion:background-start", {
      capability_id: capabilityId,
      confirmed,
    }),
  readEmail: (query: unknown) => ipcRenderer.invoke("nova:email:read", query),
  draftEmail: (draft: unknown) => ipcRenderer.invoke("nova:email:draft", draft),
  sendEmail: (draft: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:email:send", { draft, confirmed }),
  upcomingCalendarEvents: () => ipcRenderer.invoke("nova:calendar:upcoming"),
  proposeCalendarEvent: (draft: unknown) => ipcRenderer.invoke("nova:calendar:propose", draft),
  createCalendarEvent: (draft: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:calendar:create", { draft, confirmed }),
  sendChannelMessage: (channelId: string, chatId: string, content: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:channel:send", {
      channel_id: channelId,
      chat_id: chatId,
      content,
      confirmed,
    }),
  receiveChannelMessage: (channelId: string, message: unknown) =>
    ipcRenderer.invoke("nova:channel:receive", { channel_id: channelId, message }),
  getChannelMediaCapabilities: (channelId: string) =>
    ipcRenderer.invoke("nova:channel:media", channelId),
  generateBackgroundBriefing: (trigger: string) =>
    ipcRenderer.invoke("nova:background:generate", trigger),
  deliverBackgroundBriefing: (briefing: unknown) =>
    ipcRenderer.invoke("nova:background:deliver", briefing),
  proposeAdaptivePreference: (input: unknown) =>
    ipcRenderer.invoke("nova:personalization:propose", input),
  approveAdaptivePreference: (proposalId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:personalization:approve", {
      proposal_id: proposalId,
      confirmed,
    }),
  dismissAdaptivePreference: (proposalId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:personalization:dismiss", { proposal_id: proposalId, confirmed }),
  pendingAdaptivePreferences: () => ipcRenderer.invoke("nova:personalization:pending"),
  resetAdaptivePreference: (preferenceId: string | undefined, confirmed: boolean) =>
    ipcRenderer.invoke("nova:personalization:reset", { preference_id: preferenceId, confirmed }),
  generatePersonalAnalytics: (input: unknown) =>
    ipcRenderer.invoke("nova:analytics:generate", input),
  detectIncident: (detail: string) => ipcRenderer.invoke("nova:incident:detect", detail),
  triageIncident: (incidentId: string, severity: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:incident:triage", { incident_id: incidentId, severity, confirmed }),
  mitigateIncident: (incidentId: string, detail: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:incident:mitigate", { incident_id: incidentId, detail, confirmed }),
  resolveIncident: (incidentId: string, detail: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:incident:resolve", { incident_id: incidentId, detail, confirmed }),
  postmortemIncident: (incidentId: string, detail: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:incident:postmortem", { incident_id: incidentId, detail, confirmed }),
  incidentTimeline: (incidentId: string) =>
    ipcRenderer.invoke("nova:incident:timeline", incidentId),
  handleRunbook: (incident: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:runbook:handle", { incident, confirmed }),
  getCapabilityRecord: (capabilityId: string) =>
    ipcRenderer.invoke("nova:capability:get", capabilityId),
  setCapabilityProviderEnabled: (
    capabilityId: string,
    providerId: string,
    enabled: boolean,
    confirmed: boolean,
  ) =>
    ipcRenderer.invoke("nova:capability:provider-enabled", {
      capability_id: capabilityId,
      provider_id: providerId,
      enabled,
      confirmed,
    }),
  setCapabilityProviderPriority: (
    capabilityId: string,
    providerId: string,
    priority: number,
    confirmed: boolean,
  ) =>
    ipcRenderer.invoke("nova:capability:provider-priority", {
      capability_id: capabilityId,
      provider_id: providerId,
      priority,
      confirmed,
    }),
  setCapabilityPolicy: (capabilityId: string, policy: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:capability:policy", {
      capability_id: capabilityId,
      policy,
      confirmed,
    }),
  discoverLocalModels: (hardware: unknown) => ipcRenderer.invoke("nova:models:discover", hardware),
  modelProviderHealth: (providerId: string) => ipcRenderer.invoke("nova:models:health", providerId),
  startVoicePipeline: (confirmed: boolean) => ipcRenderer.invoke("nova:voice:start", confirmed),
  stopVoicePipeline: (confirmed: boolean) => ipcRenderer.invoke("nova:voice:stop", confirmed),
  bargeInVoice: () => ipcRenderer.invoke("nova:voice:barge-in"),
  voicePipelineState: () => ipcRenderer.invoke("nova:voice:state"),
  discoverPluginsForGap: (gap: unknown) => ipcRenderer.invoke("nova:plugins:discover", gap),
  confirmPluginDiscovery: (pluginId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:plugins:confirm", { plugin_id: pluginId, confirmed }),
  declinePluginDiscovery: (pluginId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:plugins:decline", { plugin_id: pluginId, confirmed }),
  pendingPluginDiscovery: () => ipcRenderer.invoke("nova:plugins:pending"),
  createBackup: (state: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:backup:create", { state, confirmed }),
  preUpdateBackup: (state: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:backup:pre-update", { state, confirmed }),
  restoreBackup: (snapshotId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:backup:restore", { snapshot_id: snapshotId, confirmed }),
  prepareRestore: (snapshotId: string) => ipcRenderer.invoke("nova:restore:prepare", snapshotId),
  applyPreparedRestore: (restoreId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:restore:apply", { restore_id: restoreId, confirmed }),
  upgradeRuntime: (request: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:upgrade:run", { request, confirmed }),
  repairRuntime: (request?: { apply: boolean }, confirmed = false) =>
    ipcRenderer.invoke("nova:repair:run", { request, confirmed }),
  acquireResources: (taskId: string, resources: readonly string[]) =>
    ipcRenderer.invoke("nova:resources:acquire", { task_id: taskId, resources }),
  releaseResources: (taskId: string) => ipcRenderer.invoke("nova:resources:release", taskId),
  resourceHolder: (resource: string) => ipcRenderer.invoke("nova:resources:holder", resource),
  expireResourceLocks: () => ipcRenderer.invoke("nova:resources:expire"),
  acquireArbitratedResource: (resource: string, request: unknown) =>
    ipcRenderer.invoke("nova:resources:arbitrate", { resource, request }),
  releaseArbitratedResource: (resource: string, requestId: string) =>
    ipcRenderer.invoke("nova:resources:arbitration-release", {
      resource,
      request_id: requestId,
    }),
  submitOfflineAction: (action: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:offline:submit", { action, confirmed }),
  reconnectOfflineActions: (confirmed: boolean) =>
    ipcRenderer.invoke("nova:offline:reconnect", confirmed),
  startSetupWizard: (confirmed: boolean) => ipcRenderer.invoke("nova:setup:start", confirmed),
  rerunSetupWizard: (confirmed: boolean) => ipcRenderer.invoke("nova:setup:rerun", confirmed),
  completeSetupStep: (step: string, patch: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:setup:complete", { step, patch, confirmed }),
  deferSetupStep: (step: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:setup:defer", { step, confirmed }),
  setupSummary: () => ipcRenderer.invoke("nova:setup:summary"),
  workspaceIdentity: () => ipcRenderer.invoke("nova:workspace:identity"),
  workspaceState: () => ipcRenderer.invoke("nova:workspace:state"),
  createWorkspace: (workspaceId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:workspace:create", { workspace_id: workspaceId, confirmed }),
  activateWorkspace: (confirmed: boolean) =>
    ipcRenderer.invoke("nova:workspace:activate", confirmed),
  acquireWorkspaceLock: (reason: string) =>
    ipcRenderer.invoke("nova:workspace:acquire-lock", reason),
  releaseWorkspaceLock: (token: string) => ipcRenderer.invoke("nova:workspace:release-lock", token),
  expireWorkspaceLock: () => ipcRenderer.invoke("nova:workspace:expire-lock"),
  beginWorkspaceRecovery: () => ipcRenderer.invoke("nova:workspace:begin-recovery"),
  completeWorkspaceRecovery: () => ipcRenderer.invoke("nova:workspace:complete-recovery"),
  workspaceCanSync: () => ipcRenderer.invoke("nova:workspace:can-sync"),
  createPairingOffer: (
    input: {
      readonly runtime_mode: "Full peer" | "Companion";
      readonly primary_public_key: string;
    },
    confirmed: boolean,
  ) => ipcRenderer.invoke("nova:devices:pairing-offer", { ...input, confirmed }),

  completePairing: (code: string, request: unknown) =>
    ipcRenderer.invoke("nova:devices:pairing-complete", { code, request }),
  revokeTrustedDevice: (deviceId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:devices:revoke", { device_id: deviceId, confirmed }),
  getTrustedDevices: () => ipcRenderer.invoke("nova:devices:trusted"),
  getDeviceSnapshots: () => ipcRenderer.invoke("nova:devices:snapshots"),
  negotiateDeviceCapability: (deviceId: string, capabilityId: string) =>
    ipcRenderer.invoke("nova:devices:negotiate", {
      device_id: deviceId,
      capability_id: capabilityId,
    }),
  getDiagnostics: () => ipcRenderer.invoke("nova:diagnostics:get"),
  getUpdateInfo: () => ipcRenderer.invoke("nova:updates:get"),
  validateWorkflow: (draft: unknown) => ipcRenderer.invoke("nova:workflow:validate", draft),
  captureScreenshot: (request: unknown) => ipcRenderer.invoke("nova:desktop:screenshot", request),
  executeUiAction: (request: unknown) => ipcRenderer.invoke("nova:desktop:ui-action", request),
  readAccessibilityState: (request: unknown) => ipcRenderer.invoke("nova:desktop:ui-read", request),
  getPermissions: () => ipcRenderer.invoke("nova:permissions:get"),
  setPermission: (source: string, granted: boolean, confirmed: boolean) =>
    ipcRenderer.invoke("nova:permissions:set", { source, granted, confirmed }),
  syncObservers: () => ipcRenderer.invoke("nova:observers:sync"),
  syncClipboardObserver: () => ipcRenderer.invoke("nova:observers:sync-clipboard"),
  syncNotificationObserver: () => ipcRenderer.invoke("nova:observers:sync-notifications"),
  syncKeyboardObserver: () => ipcRenderer.invoke("nova:observers:sync-keyboard"),
  syncMouseObserver: () => ipcRenderer.invoke("nova:observers:sync-mouse"),
  syncBrowserObserver: () => ipcRenderer.invoke("nova:observers:sync-browser"),
  adoptObservation: (input: unknown) => ipcRenderer.invoke("nova:observation:adopt", input),
  placeTask: (input: unknown) => ipcRenderer.invoke("nova:task:place", input),
  issueApiToken: (scopes: readonly string[], confirmed: boolean) =>
    ipcRenderer.invoke("nova:auth:issue-token", { scopes, confirmed }),
  getGoogleAccountStatus: () => ipcRenderer.invoke("nova:google:status"),
  connectGoogleAccount: () => ipcRenderer.invoke("nova:google:connect"),
  disconnectGoogleAccount: () => ipcRenderer.invoke("nova:google:disconnect"),
  getConfig: () => ipcRenderer.invoke("nova:config:get"),
  updateConfig: (section: string, value: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:config:update", { section, value, confirmed }),
  evaluatePerformanceBudgets: (samples: unknown) =>
    ipcRenderer.invoke("nova:performance:budgets", samples),
  compareDeviceVersions: (left: string, right: string) =>
    ipcRenderer.invoke("nova:devices:compatibility", left, right),
  runtimeServiceHealth: (serviceName: string) =>
    ipcRenderer.invoke("nova:runtime:service-health", serviceName),
  pluginRecord: (pluginId: string) => ipcRenderer.invoke("nova:plugins:record", pluginId),
  jobState: (jobId: string) => ipcRenderer.invoke("nova:jobs:state", jobId),
  systemStartupLog: () => ipcRenderer.invoke("nova:system:startup-log"),
  systemShutdownLog: () => ipcRenderer.invoke("nova:system:shutdown-log"),
  compareLogicalClockValues: (left: unknown, right: unknown) =>
    ipcRenderer.invoke("nova:devices:logical-clock-compare", left, right),
  networkState: () => ipcRenderer.invoke("nova:network:state"),
  systemInventorySummary: () => ipcRenderer.invoke("nova:system:inventory-summary"),
  sessionDeviceSnapshots: () => ipcRenderer.invoke("nova:session:devices"),
  pendingAdaptivePreferenceSummaries: () =>
    ipcRenderer.invoke("nova:personalization:pending-summaries"),
  hardwareCapabilitySummary: () => ipcRenderer.invoke("nova:hardware:summary"),
  rescanHardwareCapabilitySummary: () => ipcRenderer.invoke("nova:hardware:rescan-summary"),
  remoteControlSessionStatuses: () => ipcRenderer.invoke("nova:remote:sessions"),
  remoteControlPreApprovalStatuses: () => ipcRenderer.invoke("nova:remote:pre-approvals"),
  listCapabilityRecords: () => ipcRenderer.invoke("nova:capability:list"),
  heldResourceLocks: () => ipcRenderer.invoke("nova:resources:held"),
  listScheduledJobStates: () => ipcRenderer.invoke("nova:jobs:list"),
  activeScheduledJobConcurrencyGroups: () => ipcRenderer.invoke("nova:jobs:active-groups"),
  listModelProviderHealthStatuses: () => ipcRenderer.invoke("nova:models:health-list"),
  reclaimableLocalModelSummaries: () => ipcRenderer.invoke("nova:models:reclaimable"),
  websocketUrl: () => ipcRenderer.invoke("nova:websocket:url"),
  restUrl: () => ipcRenderer.invoke("nova:rest:url"),
  webhookHealthSummary: (webhookId: string) =>
    ipcRenderer.invoke("nova:webhook:health", { webhook_id: webhookId }),
  pluginRecordSummaries: () => ipcRenderer.invoke("nova:plugins:list"),
  listToolSummaries: () => ipcRenderer.invoke("nova:tools:list"),
  taskSchedulerStatus: () => ipcRenderer.invoke("nova:task-scheduler:status"),
  workflowCheckpointSummaries: (workflowId: string) =>
    ipcRenderer.invoke("nova:workflow:checkpoints", { workflow_id: workflowId }),
  retryTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:retry", { task_id: taskId, confirmed }),
  resumePausedTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:resume-paused", { task_id: taskId, confirmed }),
  confirmWaitingUserTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:confirm-waiting-user", { task_id: taskId, confirmed }),
  resumeWorkflowCheckpoint: (checkpointId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:workflow:resume", { checkpoint_id: checkpointId, confirmed }),
  denyWaitingUserTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:deny-waiting-user", { task_id: taskId, confirmed }),
  pauseTask: (taskId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:task:pause", { task_id: taskId, confirmed }),
  enablePlugin: (pluginId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:plugins:enable", { plugin_id: pluginId, confirmed }),
  disablePlugin: (pluginId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:plugins:disable", { plugin_id: pluginId, confirmed }),
  uninstallPlugin: (pluginId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:plugins:uninstall", { plugin_id: pluginId, confirmed }),
  downloadLocalModel: (modelId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:models:download", { model_id: modelId, confirmed }),
  loadLocalModel: (modelId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:models:load", { model_id: modelId, confirmed }),
  retireLocalModel: (modelId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:models:retire", { model_id: modelId, confirmed }),
  listMcpServers: () => ipcRenderer.invoke("nova:mcp:list"),
  addMcpServer: (server: unknown, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:add", { server, confirmed }),
  requestMcpServerApproval: (serverId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:request-approval", { server_id: serverId, confirmed }),
  approveMcpServer: (serverId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:approve", { server_id: serverId, confirmed }),
  disableMcpServer: (serverId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:disable", { server_id: serverId, confirmed }),
  enableMcpServer: (serverId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:enable", { server_id: serverId, confirmed }),
  removeMcpServer: (serverId: string, confirmed: boolean) =>
    ipcRenderer.invoke("nova:mcp:remove", { server_id: serverId, confirmed }),
};

contextBridge.exposeInMainWorld("nova", novaApi);
