import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checksumOf,
  createPluginScaffold,
  packagePlugin,
  signPluginChecksum,
  validatePluginManifest,
  verifyPluginSignature,
} from "../src/plugin-sdk.js";
import { readTarGz } from "../src/archive.js";

describe("createPluginScaffold", () => {
  it("scaffolds a manifest with sensible defaults and an entry-point stub", () => {
    const result = createPluginScaffold("weather-lookup", "Weather Lookup", ["network.external"]);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const manifest = JSON.parse(result.value.manifestJson);
    expect(manifest).toMatchObject({
      plugin_id: "weather-lookup",
      display_name: "Weather Lookup",
      required_permissions: ["network.external"],
      entry_point: "index.js",
    });
    expect(result.value.entryPointStub).toContain("export function start()");
  });

  it("rejects an invalid plugin id", () => {
    expect(createPluginScaffold("Not Valid!", "x")).toMatchObject({
      ok: false,
      error: { code: "NOVA-CFG001" },
    });
  });

  it("rejects an unknown permission scope", () => {
    expect(
      createPluginScaffold("weather-lookup", "Weather Lookup", ["not.a.real.scope" as never]),
    ).toMatchObject({ ok: false, error: { code: "NOVA-CFG001" } });
  });
});

describe("validatePluginManifest", () => {
  it("accepts a well-formed manifest", () => {
    const scaffold = createPluginScaffold("weather-lookup", "Weather Lookup");
    if (!scaffold.ok) throw new Error("scaffold should succeed");

    expect(validatePluginManifest(JSON.parse(scaffold.value.manifestJson))).toMatchObject({ ok: true });
  });

  it("reports every failing field in one pass rather than stopping at the first", () => {
    const result = validatePluginManifest({ plugin_id: "Not Valid" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issues = result.error.details?.issues as ReadonlyArray<{ field: string }>;
    const fields = issues.map((issue) => issue.field);
    expect(fields).toContain("plugin_id");
    expect(fields).toContain("version");
    expect(fields).toContain("display_name");
    expect(fields).toContain("required_permissions");
  });

  it("flags an unknown declared permission scope", () => {
    const scaffold = createPluginScaffold("weather-lookup", "Weather Lookup");
    if (!scaffold.ok) throw new Error("scaffold should succeed");
    const manifest = { ...JSON.parse(scaffold.value.manifestJson), required_permissions: ["not.real"] };

    const result = validatePluginManifest(manifest);
    expect(result.ok).toBe(false);
  });
});

describe("plugin signing", () => {
  it("verifies a signature produced with the matching private key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const checksum = "sha256:abc123";

    const signature = signPluginChecksum(checksum, privateKey);

    expect(verifyPluginSignature(checksum, signature, publicKey)).toBe(true);
  });

  it("rejects a signature from a different key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { publicKey: otherPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const checksum = "sha256:abc123";

    const signature = signPluginChecksum(checksum, privateKey);

    expect(verifyPluginSignature(checksum, signature, otherPublicKey)).toBe(false);
  });

  it("rejects a signature against a tampered checksum", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signature = signPluginChecksum("sha256:original", privateKey);

    expect(verifyPluginSignature("sha256:tampered", signature, publicKey)).toBe(false);
  });
});

describe("packagePlugin", () => {
  it("validates the manifest before packaging and rejects an invalid one", () => {
    const result = packagePlugin({ plugin_id: "Not Valid" }, []);
    expect(result).toMatchObject({ ok: false, error: { code: "NOVA-CFG001" } });
  });

  it("bundles the manifest plus source files into a readable tar.gz and returns a matching checksum", () => {
    const scaffold = createPluginScaffold("weather-lookup", "Weather Lookup");
    if (!scaffold.ok) throw new Error("scaffold should succeed");
    const manifest = JSON.parse(scaffold.value.manifestJson);

    const result = packagePlugin(manifest, [
      { path: "index.js", content: Buffer.from(scaffold.value.entryPointStub, "utf8") },
    ]);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);

    const entries = readTarGz(result.value.archive);
    expect(entries.map((entry) => entry.path)).toEqual(["manifest.json", "index.js"]);
    expect(JSON.parse(entries[0].content.toString("utf8"))).toMatchObject({ plugin_id: "weather-lookup" });
  });

  it("produces the same checksum for byte-identical archives, and a different one for different content", () => {
    const scaffold = createPluginScaffold("plugin-a", "Plugin A");
    if (!scaffold.ok) throw new Error("scaffold should succeed");
    const manifestA = JSON.parse(scaffold.value.manifestJson);

    const first = packagePlugin(manifestA, []);
    const second = packagePlugin(manifestA, []);

    expect(first.ok && second.ok && first.value.checksum === second.value.checksum).toBe(true);

    const differentFiles = packagePlugin(manifestA, [{ path: "extra.js", content: Buffer.from("x") }]);
    expect(differentFiles.ok && first.ok && differentFiles.value.checksum !== first.value.checksum).toBe(true);
  });
});

describe("end-to-end: create -> package -> sign -> verify", () => {
  it("a freshly scaffolded plugin can be packaged and its checksum signed and verified", () => {
    const scaffold = createPluginScaffold("weather-lookup", "Weather Lookup");
    if (!scaffold.ok) throw new Error("scaffold should succeed");
    const manifest = JSON.parse(scaffold.value.manifestJson);

    const packaged = packagePlugin(manifest, [
      { path: "index.js", content: Buffer.from(scaffold.value.entryPointStub, "utf8") },
    ]);
    if (!packaged.ok) throw new Error("packaging should succeed");

    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const signature = signPluginChecksum(packaged.value.checksum, privateKey);

    expect(verifyPluginSignature(packaged.value.checksum, signature, publicKey)).toBe(true);
  });
});

describe("checksumOf", () => {
  it("is deterministic for identical bytes and matches the sha256:<hex> shape packagePlugin uses", () => {
    const data = Buffer.from("same content");
    expect(checksumOf(data)).toBe(checksumOf(Buffer.from("same content")));
    expect(checksumOf(data)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("differs for different bytes", () => {
    expect(checksumOf(Buffer.from("a"))).not.toBe(checksumOf(Buffer.from("b")));
  });
});
