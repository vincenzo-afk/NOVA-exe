import { describe, expect, it } from "vitest";
import { NovaCli } from "../src/cli.js";

describe("NovaCli", () => {
  it("generates help from its command registry", async () => {
    const cli = new NovaCli({ version: "0.1.0" });
    const result = await cli.run(["--help"]);

    expect(result).toMatchObject({
      ok: true,
      value: {
        command: "help",
        commands: expect.arrayContaining([
          "init",
          "doctor",
          "diagnostics",
          "clean",
          "config",
          "env",
        ]),
      },
    });
  });

  it("returns versioned JSON doctor output", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      health: async () => ({ runtime: "healthy", memory: "healthy" }),
    });

    const result = await cli.run(["doctor", "--json"]);

    expect(result).toMatchObject({
      ok: true,
      value: {
        schema_version: "1.0.0",
        command: "doctor",
        status: "ok",
        data: { runtime: "healthy" },
      },
    });
  });

  it("keeps destructive clean dry-run by default and requires explicit apply", async () => {
    const cli = new NovaCli({ version: "0.1.0" });

    expect(await cli.run(["clean", "--json"])).toMatchObject({
      ok: true,
      value: { command: "clean", data: { dry_run: true } },
    });
    expect(await cli.run(["clean", "--apply", "--json"])).toMatchObject({
      ok: true,
      value: { command: "clean", data: { dry_run: false } },
    });
  });

  it("rejects unknown commands with a structured error", async () => {
    const cli = new NovaCli({ version: "0.1.0" });

    expect(await cli.run(["unknown", "--json"])).toMatchObject({
      ok: false,
      error: { code: "NOVA-CFG001" },
    });
  });

  it("reports the fixed init bootstrap step order (docs/27-cli/02)", async () => {
    const cli = new NovaCli({ version: "0.1.0" });

    expect(await cli.run(["init", "--json"])).toMatchObject({
      ok: true,
      value: {
        command: "init",
        data: {
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
        },
      },
    });
  });

  it("resolves an AI-developer-tools context request through the injected collaborator", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      context: async (subsystem) => [`${subsystem}-overview.md`],
    });

    expect(await cli.run(["context", "runtime", "--json"])).toMatchObject({
      ok: true,
      value: { command: "context", data: { subsystem: "runtime", docs: ["runtime-overview.md"] } },
    });
  });

  it("requires a subsystem argument for context/task/impact", async () => {
    const cli = new NovaCli({ version: "0.1.0" });

    expect(await cli.run(["context", "--json"])).toMatchObject({ ok: false });
    expect(await cli.run(["task", "--json"])).toMatchObject({ ok: false });
    expect(await cli.run(["impact", "--json"])).toMatchObject({ ok: false });
  });

  it("dispatches plugin subcommands and rejects unknown plugin actions", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      plugin: async (action, name) => ({ ok: true, detail: `${action}:${name ?? "unnamed"}` }),
    });

    expect(await cli.run(["plugin", "create", "my-plugin", "--json"])).toMatchObject({
      ok: true,
      value: { command: "plugin", data: { action: "create", name: "my-plugin", ok: true } },
    });
    expect(await cli.run(["plugin", "not-a-real-action", "--json"])).toMatchObject({ ok: false });
  });

  it("scaffolds agent/tool/workflow definitions via nova <subject> create", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      agentCreate: async () => ({ created: true }),
      toolCreate: async () => ({ created: true }),
      workflowCreate: async () => ({ created: true }),
    });

    expect(await cli.run(["agent", "create", "researcher", "--json"])).toMatchObject({
      ok: true,
      value: { command: "agent", data: { created: true } },
    });
    expect(await cli.run(["tool", "create", "web-search", "--json"])).toMatchObject({
      ok: true,
      value: { command: "tool", data: { created: true } },
    });
    expect(await cli.run(["workflow", "create", "daily-digest", "--json"])).toMatchObject({
      ok: true,
      value: { command: "workflow", data: { created: true } },
    });
  });

  it("runs nova verify with a default pass-through when no collaborator is configured", async () => {
    const cli = new NovaCli({ version: "0.1.0" });

    expect(await cli.run(["verify", "--json"])).toMatchObject({
      ok: true,
      value: { command: "verify", data: { passed: true, failures: [] } },
    });
  });
});

describe("NovaCli provider test / prompt validate", () => {
  it("runs a provider conformance test through the injected collaborator", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      providerTest: async (name) => ({ passed: true, details: `${name} responded` }),
    });

    expect(await cli.run(["provider", "test", "groq", "--json"])).toMatchObject({
      ok: true,
      value: { command: "provider", data: { name: "groq", passed: true } },
    });
  });

  it("rejects a provider subcommand other than test", async () => {
    const cli = new NovaCli({ version: "0.1.0" });
    expect(await cli.run(["provider", "list", "--json"])).toMatchObject({ ok: false });
  });

  it("validates a prompt template through the injected collaborator", async () => {
    const cli = new NovaCli({
      version: "0.1.0",
      promptValidate: async () => ({ valid: false, issues: ["missing {{variable}} binding"] }),
    });

    expect(await cli.run(["prompt", "validate", "onboarding-intro", "--json"])).toMatchObject({
      ok: true,
      value: {
        command: "prompt",
        data: { valid: false, issues: ["missing {{variable}} binding"] },
      },
    });
  });

  it("requires a name argument for both", async () => {
    const cli = new NovaCli({ version: "0.1.0" });
    expect(await cli.run(["provider", "test", "--json"])).toMatchObject({ ok: false });
    expect(await cli.run(["prompt", "validate", "--json"])).toMatchObject({ ok: false });
  });
});
