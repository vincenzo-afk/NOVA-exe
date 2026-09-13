#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { FileJsonlLogSink, FileMetricStore, FileSpanStore } from "@nova/shared";
import { HardwareDetector } from "../hardware-detection.js";
import { checksumOf, createPluginScaffold, packagePlugin, signPluginChecksum, validatePluginManifest } from "../plugin-sdk.js";
import { NovaCli } from "../cli.js";

/**
 * Real executable entry point for the CLI specified in docs/27-cli/.
 * This is what `pnpm --filter @nova/runtime build` compiles to
 * `dist/bin/nova.js`, wired as the `nova` bin in package.json — closing
 * the gap noted in AUDIT_REPORT_2026-09-11.md finding 2, where NovaCli
 * existed as a library class but nothing ever constructed or invoked it.
 *
 * `logs`/`traces`/`metrics` all read from `~/.nova/` files that a
 * long-running `nova` process would also write to via the sink options
 * below, so each reflects real history across invocations — not just
 * the current process. (This closes the "Remaining, in priority order"
 * item 2 the previous pass left open: file-backed span/metric storage
 * mirroring what `FileJsonlLogSink` already gave logging.)
 */

const logPath = join(homedir(), ".nova", "logs", "nova.jsonl");
const tracesPath = join(homedir(), ".nova", "logs", "traces.jsonl");
const metricsPath = join(homedir(), ".nova", "logs", "metrics.jsonl");
const logSink = new FileJsonlLogSink(logPath);
const spanStore = new FileSpanStore(tracesPath);
const metricStore = new FileMetricStore(metricsPath);

const detector = new HardwareDetector(async () => ({
  os: (process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform === "linux"
        ? "linux"
        : "unknown") as "windows" | "macos" | "linux" | "android" | "unknown",
  cpu_architecture: process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : "unknown",
  cpu_cores: cpus().length,
  avx2: "unknown",
  avx512: "unknown",
  // GPU signals have no Node-builtin source; left to a future
  // platform-specific probe rather than guessed here.
  gpu_vendor: null,
  gpu_vram_gb: 0,
  gpu_accelerator: null,
  system_ram_gb: Math.round(totalmem() / 1024 ** 3),
  // Free disk space also has no Node-builtin cross-platform source.
  available_disk_gb: 0,
  battery_powered: false,
}));

const cli = new NovaCli({
  version: process.env.npm_package_version ?? "0.1.0",
  health: async () => ({
    runtime: "healthy",
    node: process.version,
    platform: process.platform,
  }),
  environment: async () => {
    const profile = await detector.scan();
    return {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      hardware_tier: profile.overall_tier,
    };
  },
  logs: async () =>
    logSink.records().map((record) => `${record.timestamp} [${record.severity}] ${record.service}: ${record.event}`),
  traces: async (correlationId) => (correlationId ? spanStore.query(correlationId) : []).map(
    (span) => `${span.name} (${span.status}) ${span.started_at}`,
  ),
  metrics: async () => {
    const summary: Record<string, number> = {};
    for (const name of metricStore.names()) {
      for (const series of metricStore.query(name)) {
        const value = series.kind === "histogram" ? series.avg : series.value;
        summary[name] = value;
      }
    }
    return summary;
  },
  plugin: async (action, name) => {
    if (action === "create") {
      if (!name) return { ok: false, detail: "plugin create requires a <name> argument." };
      const scaffold = createPluginScaffold(name, name);
      return scaffold.ok
        ? { ok: true, detail: scaffold.value.manifestJson }
        : { ok: false, detail: scaffold.error.message };
    }
    if (action === "validate") {
      if (!name) return { ok: false, detail: "plugin validate requires a <manifest-path> argument." };
      try {
        const manifest = JSON.parse(readFileSync(name, "utf8"));
        const result = validatePluginManifest(manifest);
        return result.ok
          ? { ok: true, detail: "Manifest is valid." }
          : { ok: false, detail: result.error.message };
      } catch (error) {
        return { ok: false, detail: `Could not read or parse '${name}': ${(error as Error).message}` };
      }
    }
    if (action === "package") {
      if (!name) return { ok: false, detail: "plugin package requires a <plugin-directory> argument." };
      try {
        const manifestPath = join(name, "manifest.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const sourceFiles = readdirSync(name)
          .filter((fileName) => fileName !== "manifest.json")
          .map((fileName) => ({ path: fileName, content: readFileSync(join(name, fileName)) }));
        const packaged = packagePlugin(manifest, sourceFiles);
        if (!packaged.ok) return { ok: false, detail: packaged.error.message };
        const outputPath = `${name.replace(/\/$/, "")}.tar.gz`;
        writeFileSync(outputPath, packaged.value.archive);
        return { ok: true, detail: `Wrote ${outputPath} (${packaged.value.checksum}).` };
      } catch (error) {
        return { ok: false, detail: `Packaging failed: ${(error as Error).message}` };
      }
    }
    if (action === "sign") {
      if (!name) return { ok: false, detail: "plugin sign requires a <package-path> (.tar.gz) argument." };
      const keyPath = process.env.NOVA_PLUGIN_SIGNING_KEY_PATH;
      if (!keyPath) {
        return {
          ok: false,
          detail:
            "No signing key configured — set NOVA_PLUGIN_SIGNING_KEY_PATH to a PEM private key file.",
        };
      }
      try {
        const archive = readFileSync(name);
        const checksum = checksumOf(archive);
        const privateKey = readFileSync(keyPath, "utf8");
        const signature = signPluginChecksum(checksum, privateKey);
        const signaturePath = `${name}.sig`;
        writeFileSync(signaturePath, `${checksum}\n${signature}\n`, "utf8");
        return { ok: true, detail: `Wrote ${signaturePath} (${checksum}).` };
      } catch (error) {
        return { ok: false, detail: `Signing failed: ${(error as Error).message}` };
      }
    }
    return { ok: false, detail: `plugin ${action} is not implemented — see AUDIT_REPORT_2026-09-11.md.` };
  },
});

cli.run(process.argv.slice(2)).then((result) => {
  if (result.ok) {
    process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
    process.exitCode = 0;
  } else {
    process.stderr.write(`${JSON.stringify(result.error, null, 2)}\n`);
    process.exitCode = 1;
  }
});

