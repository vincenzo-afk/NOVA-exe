import { describe, expect, it } from "vitest";
import { createTarGz, readTarGz } from "../src/archive.js";

describe("createTarGz / readTarGz", () => {
  it("round-trips a single small file", () => {
    const archive = createTarGz([{ path: "manifest.json", content: Buffer.from('{"a":1}') }]);

    const entries = readTarGz(archive);

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("manifest.json");
    expect(entries[0].content.toString("utf8")).toBe('{"a":1}');
  });

  it("round-trips multiple files, including one whose content is an exact multiple of the 512-byte block size", () => {
    const exactBlock = Buffer.alloc(1024, "x");
    const archive = createTarGz([
      { path: "manifest.json", content: Buffer.from("{}") },
      { path: "index.js", content: Buffer.from("export function start() {}") },
      { path: "data.bin", content: exactBlock },
    ]);

    const entries = readTarGz(archive);

    expect(entries.map((entry) => entry.path)).toEqual(["manifest.json", "index.js", "data.bin"]);
    expect(entries[2].content.equals(exactBlock)).toBe(true);
  });

  it("round-trips an empty file", () => {
    const archive = createTarGz([{ path: "empty.txt", content: Buffer.alloc(0) }]);

    const entries = readTarGz(archive);

    expect(entries).toHaveLength(1);
    expect(entries[0].content.length).toBe(0);
  });

  it("round-trips binary content containing null bytes without truncating it", () => {
    const binary = Buffer.from([0, 1, 2, 0, 255, 0, 128]);
    const archive = createTarGz([{ path: "binary.dat", content: binary }]);

    const entries = readTarGz(archive);

    expect(entries[0].content.equals(binary)).toBe(true);
  });

  it("rejects a path longer than USTAR's 100-byte name field", () => {
    const longPath = `${"a".repeat(101)}.txt`;
    expect(() => createTarGz([{ path: longPath, content: Buffer.from("x") }])).toThrow(
      /100-byte name limit/,
    );
  });

  it("produces an archive that is actually gzip-compressed, not just tar", () => {
    const archive = createTarGz([{ path: "x.txt", content: Buffer.alloc(2048, "a") }]);
    // gzip's magic number is 0x1f 0x8b.
    expect(archive[0]).toBe(0x1f);
    expect(archive[1]).toBe(0x8b);
  });

  it("returns an empty array when reading an archive with no entries", () => {
    const archive = createTarGz([]);
    expect(readTarGz(archive)).toEqual([]);
  });
});
