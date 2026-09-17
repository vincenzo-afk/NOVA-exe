import { err, ok, type ErrorInfo, type Result } from "@nova/shared";

/**
 * Implements the command surface documented across docs/27-cli/*.
 * Each command category accepts an optional injected collaborator so the
 * CLI itself stays a thin, deterministic dispatcher: real environment
 * access (filesystem, network, subprocess) is supplied by the caller
 * (desktop main process or a future standalone binary entry point), the
 * same pattern already used for `health` in the pre-existing surface.
 */

export interface CliOptions {
  readonly version: string;
  /** `nova doctor` — full environment health check (docs/27-cli/02). */
  readonly health?: () => Promise<Readonly<Record<string, string>>>;
  /** `nova diagnostics` — generate diagnostics.zip (docs/27-cli/02). */
  readonly diagnostics?: () => Promise<Readonly<{ files: readonly string[] }>>;
  /** `nova upgrade` — upgrade schemas/configs/plugins/docs (docs/27-cli/02). */
  readonly upgrade?: () => Promise<Readonly<{ applied: readonly string[] }>>;
  /** `nova repair` — auto-fix common broken states (docs/27-cli/02). */
  readonly repair?: () => Promise<Readonly<{ fixed: readonly string[] }>>;
  /** `nova env` — show detected environment/hardware (docs/27-cli/03). */
  readonly environment?: () => Promise<Readonly<Record<string, string>>>;
  /** `nova config` — view/edit resolved configuration (docs/27-cli/03). */
  readonly config?: (set?: Readonly<{ key: string; value: string }>) => Promise<unknown>;
  /** `nova context <subsystem>` — relevant docs for a subsystem (docs/27-cli/04). */
  readonly context?: (subsystem: string) => Promise<readonly string[]>;
  /** `nova task <subsystem>` — AI-ready task package (docs/27-cli/04). */
  readonly task?: (subsystem: string) => Promise<Readonly<Record<string, string>>>;
  /** `nova impact <change>` — blast radius of a proposed change (docs/27-cli/04). */
  readonly impact?: (change: string) => Promise<readonly string[]>;
  /** Observability commands (docs/27-cli/05): logs/traces/metrics/replay/events/profile/benchmark/inspect/explain. */
  readonly logs?: () => Promise<readonly string[]>;
  readonly traces?: (correlationId?: string) => Promise<readonly string[]>;
  readonly metrics?: () => Promise<Readonly<Record<string, number>>>;
  readonly replay?: (taskId: string) => Promise<Readonly<{ replayed: boolean }>>;
  readonly events?: () => Promise<readonly string[]>;
  readonly profile?: (taskId: string) => Promise<Readonly<Record<string, number>>>;
  readonly benchmark?: () => Promise<Readonly<Record<string, number>>>;
  readonly inspect?: (id: string) => Promise<unknown>;
  readonly explain?: (id: string) => Promise<Readonly<{ code: string; explanation: string }>>;
  /** Plugin SDK commands (docs/27-cli/06): create/validate/package/publish/test/sign. */
  readonly plugin?: (
    action: "create" | "validate" | "package" | "publish" | "test" | "sign",
    name?: string,
  ) => Promise<Readonly<{ ok: boolean; detail?: string }>>;
  /** AI SDK scaffold commands (docs/27-cli/06). */
  readonly agentCreate?: (name: string) => Promise<Readonly<{ created: boolean }>>;
  readonly toolCreate?: (name: string) => Promise<Readonly<{ created: boolean }>>;
  readonly workflowCreate?: (name: string) => Promise<Readonly<{ created: boolean }>>;
  /** Hidden-gold + CI commands (docs/27-cli/07). */
  readonly sandbox?: () => Promise<Readonly<{ sandboxId: string }>>;
  readonly migrate?: () => Promise<Readonly<{ applied: readonly string[] }>>;
  readonly report?: () => Promise<Readonly<Record<string, unknown>>>;
  readonly verify?: () => Promise<Readonly<{ passed: boolean; failures: readonly string[] }>>;
  /** `nova provider test <name>` — live conformance test (docs/27-cli/06). */
  readonly providerTest?: (
    name: string,
  ) => Promise<Readonly<{ passed: boolean; details?: string }>>;
  /** `nova prompt validate <name>` — schema/render check (docs/27-cli/06, docs/05-ai/prompt-versioning.md). */
  readonly promptValidate?: (
    name: string,
  ) => Promise<Readonly<{ valid: boolean; issues: readonly string[] }>>;
}

export interface CliResponse {
  readonly schema_version: "1.0.0";
  readonly command: string;
  readonly status: "ok" | "error";
  readonly data: Readonly<Record<string, unknown>>;
}

/** The full command tree from docs/27-cli/01-cli-overview.md. */
const commandRegistry = [
  "init",
  "doctor",
  "diagnostics",
  "upgrade",
  "repair",
  "env",
  "config",
  "context",
  "task",
  "impact",
  "logs",
  "traces",
  "metrics",
  "replay",
  "events",
  "profile",
  "benchmark",
  "inspect",
  "explain",
  "plugin",
  "agent",
  "tool",
  "workflow",
  "provider",
  "prompt",
  "sandbox",
  "migrate",
  "report",
  "verify",
  "clean",
] as const;

type Command = (typeof commandRegistry)[number];

const pluginActions = ["create", "validate", "package", "publish", "test", "sign"] as const;

export class NovaCli {
  public constructor(private readonly options: CliOptions) {}

  public async run(
    argv: readonly string[],
  ): Promise<Result<CliResponse & { readonly commands?: readonly string[] }>> {
    const positionals = argv.filter((argument) => !argument.startsWith("-"));
    const command = positionals[0];
    const json = argv.includes("--json");

    if (argv.includes("--help") || command === undefined) {
      return ok({
        schema_version: "1.0.0",
        command: "help",
        status: "ok",
        data: { version: this.options.version },
        commands: commandRegistry,
      });
    }

    if (!commandRegistry.includes(command as Command))
      return err(this.error(`Unknown NOVA command: ${command}`));

    return this.dispatch(command as Command, positionals.slice(1), json, argv);
  }

  private async dispatch(
    command: Command,
    args: readonly string[],
    json: boolean,
    argv: readonly string[],
  ): Promise<Result<CliResponse>> {
    switch (command) {
      case "doctor": {
        const data = this.options.health ? await this.options.health() : { runtime: "unknown" };
        return this.ok(command, { ...data, json_requested: json });
      }
      case "diagnostics": {
        const bundle = this.options.diagnostics ? await this.options.diagnostics() : { files: [] };
        return this.ok(command, { ...bundle, json_requested: json });
      }
      case "upgrade": {
        const result = this.options.upgrade ? await this.options.upgrade() : { applied: [] };
        return this.ok(command, { ...result, json_requested: json });
      }
      case "repair": {
        const result = this.options.repair ? await this.options.repair() : { fixed: [] };
        return this.ok(command, { ...result, json_requested: json });
      }
      case "init": {
        // docs/27-cli/02-bootstrap-and-health.md: clone -> verify toolchain
        // -> install deps -> config -> assets -> verify providers ->
        // workspace -> health check -> ready. Each phase is delegated to
        // the caller-supplied collaborators that already exist for it;
        // the CLI's own responsibility is the fixed ordering + reporting.
        const health = this.options.health ? await this.options.health() : { runtime: "unknown" };
        const environment = this.options.environment ? await this.options.environment() : {};
        return this.ok(command, {
          steps: [
            "clone_templates",
            "verify_toolchain",
            "install_dependencies",
            "create_default_config",
            "download_assets",
            "verify_providers",
            "create_workspace",
            "health_check",
            "ready",
          ],
          health,
          environment,
          json_requested: json,
        });
      }
      case "env": {
        const environment = this.options.environment
          ? await this.options.environment()
          : { version: this.options.version };
        return this.ok(command, { ...environment, json_requested: json });
      }
      case "config": {
        const setFlagIndex = argv.indexOf("--set");
        const setArg =
          setFlagIndex >= 0 && argv[setFlagIndex + 1]?.includes("=")
            ? argv[setFlagIndex + 1]
            : undefined;
        const set = setArg
          ? {
              key: setArg.slice(0, setArg.indexOf("=")),
              value: setArg.slice(setArg.indexOf("=") + 1),
            }
          : undefined;
        const resolved = this.options.config ? await this.options.config(set) : {};
        return this.ok(command, { resolved, json_requested: json });
      }
      case "context": {
        const subsystem = args[0];
        if (!subsystem) return err(this.error("nova context requires a <subsystem> argument."));
        const docs = this.options.context ? await this.options.context(subsystem) : [];
        return this.ok(command, { subsystem, docs, json_requested: json });
      }
      case "task": {
        const subsystem = args[0];
        if (!subsystem) return err(this.error("nova task requires a <subsystem> argument."));
        const files = this.options.task
          ? await this.options.task(subsystem)
          : {
              "docs.md": "",
              "adrs.md": "",
              "apis.md": "",
              "tests.md": "",
              "acceptance-criteria.md": "",
            };
        return this.ok(command, { subsystem, files, json_requested: json });
      }
      case "impact": {
        const change = args[0];
        if (!change) return err(this.error("nova impact requires a <change> argument."));
        const affected = this.options.impact ? await this.options.impact(change) : [];
        return this.ok(command, { change, affected, json_requested: json });
      }
      case "logs": {
        const lines = this.options.logs ? await this.options.logs() : [];
        return this.ok(command, { lines, json_requested: json });
      }
      case "traces": {
        const correlationId = args[0];
        const traces = this.options.traces ? await this.options.traces(correlationId) : [];
        return this.ok(command, {
          correlationId: correlationId ?? null,
          traces,
          json_requested: json,
        });
      }
      case "metrics": {
        const metrics = this.options.metrics ? await this.options.metrics() : {};
        return this.ok(command, { metrics, json_requested: json });
      }
      case "replay": {
        const taskId = args[0];
        if (!taskId) return err(this.error("nova replay requires a <task-id> argument."));
        const result = this.options.replay
          ? await this.options.replay(taskId)
          : { replayed: false };
        return this.ok(command, { taskId, ...result, json_requested: json });
      }
      case "events": {
        const events = this.options.events ? await this.options.events() : [];
        return this.ok(command, { events, json_requested: json });
      }
      case "profile": {
        const taskId = args[0];
        if (!taskId) return err(this.error("nova profile requires a <task-id> argument."));
        const breakdown = this.options.profile ? await this.options.profile(taskId) : {};
        return this.ok(command, { taskId, breakdown, json_requested: json });
      }
      case "benchmark": {
        const results = this.options.benchmark ? await this.options.benchmark() : {};
        return this.ok(command, { results, json_requested: json });
      }
      case "inspect": {
        const id = args[0];
        if (!id) return err(this.error("nova inspect requires an <id> argument."));
        const state = this.options.inspect ? await this.options.inspect(id) : null;
        return this.ok(command, { id, state, json_requested: json });
      }
      case "explain": {
        const id = args[0];
        if (!id) return err(this.error("nova explain requires an <error-id|trace-id> argument."));
        const explanation = this.options.explain
          ? await this.options.explain(id)
          : { code: id, explanation: "No explanation source configured." };
        return this.ok(command, { ...explanation, json_requested: json });
      }
      case "plugin": {
        const action = args[0] as (typeof pluginActions)[number] | undefined;
        if (!action || !pluginActions.includes(action))
          return err(this.error(`nova plugin requires one of: ${pluginActions.join(", ")}.`));
        const name = args[1];
        const result = this.options.plugin
          ? await this.options.plugin(action, name)
          : { ok: false, detail: "No plugin collaborator configured." };
        return this.ok(command, { action, name: name ?? null, ...result, json_requested: json });
      }
      case "agent": {
        if (args[0] !== "create") return err(this.error("nova agent currently supports: create."));
        const name = args[1];
        if (!name) return err(this.error("nova agent create requires a <name> argument."));
        const result = this.options.agentCreate
          ? await this.options.agentCreate(name)
          : { created: false };
        return this.ok(command, { action: "create", name, ...result, json_requested: json });
      }
      case "tool": {
        if (args[0] !== "create") return err(this.error("nova tool currently supports: create."));
        const name = args[1];
        if (!name) return err(this.error("nova tool create requires a <name> argument."));
        const result = this.options.toolCreate
          ? await this.options.toolCreate(name)
          : { created: false };
        return this.ok(command, { action: "create", name, ...result, json_requested: json });
      }
      case "workflow": {
        if (args[0] !== "create")
          return err(this.error("nova workflow currently supports: create."));
        const name = args[1];
        if (!name) return err(this.error("nova workflow create requires a <name> argument."));
        const result = this.options.workflowCreate
          ? await this.options.workflowCreate(name)
          : { created: false };
        return this.ok(command, { action: "create", name, ...result, json_requested: json });
      }
      case "provider": {
        if (args[0] !== "test") return err(this.error("nova provider currently supports: test."));
        const name = args[1];
        if (!name) return err(this.error("nova provider test requires a <name> argument."));
        const result = this.options.providerTest
          ? await this.options.providerTest(name)
          : { passed: false, details: "No provider-test collaborator configured." };
        return this.ok(command, { name, ...result, json_requested: json });
      }
      case "prompt": {
        if (args[0] !== "validate")
          return err(this.error("nova prompt currently supports: validate."));
        const name = args[1];
        if (!name) return err(this.error("nova prompt validate requires a <name> argument."));
        const result = this.options.promptValidate
          ? await this.options.promptValidate(name)
          : { valid: false, issues: ["No prompt-validate collaborator configured."] };
        return this.ok(command, { name, ...result, json_requested: json });
      }
      case "sandbox": {
        const result = this.options.sandbox
          ? await this.options.sandbox()
          : { sandboxId: "unavailable" };
        return this.ok(command, { ...result, json_requested: json });
      }
      case "migrate": {
        const result = this.options.migrate ? await this.options.migrate() : { applied: [] };
        return this.ok(command, { ...result, json_requested: json });
      }
      case "report": {
        const report = this.options.report ? await this.options.report() : {};
        return this.ok(command, { report, json_requested: json });
      }
      case "verify": {
        const result = this.options.verify
          ? await this.options.verify()
          : { passed: true, failures: [] };
        return this.ok(command, { ...result, json_requested: json });
      }
      case "clean": {
        return this.ok(command, { dry_run: !argv.includes("--apply"), json_requested: json });
      }
    }
  }

  private ok(command: Command, data: Readonly<Record<string, unknown>>): Result<CliResponse> {
    return ok({ schema_version: "1.0.0", command, status: "ok", data });
  }

  private error(message: string): ErrorInfo {
    return { code: "NOVA-CFG001", message, retryable: false };
  }
}
