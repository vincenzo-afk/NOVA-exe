import { gunzipSync, gzipSync } from "node:zlib";

/**
 * `nova plugin package`'s archive format decision, deferred by
 * AUDIT_REPORT_2026-09-11.md's finding 10 pending "an actual archive
 * format decision." Chose plain `.tar.gz` (USTAR format) over `.zip`:
 * Node has a built-in `zlib` for gzip but no built-in archive format at
 * all, so either format needs a hand-written encoder here — USTAR's
 * fixed 512-byte-header layout is small enough to implement correctly
 * without a library, and tar.gz is a completely standard, ubiquitously
 * supported plugin/package distribution format (npm itself ships
 * packages this way). No new dependency, nothing to `pnpm install`
 * that this sandbox can't reach anyway.
 *
 * Implements both directions (`createTarGz`/`readTarGz`) rather than
 * just writing, so `nova plugin package`'s own output can be verified
 * by reading it back — see the test file for round-trip coverage — and
 * so a future `nova plugin validate <package>` (validating an already-
 * built package, not just a manifest) has something to read it with.
 */

export interface ArchiveEntry {
  readonly path: string;
  readonly content: Buffer;
}

const BLOCK_SIZE = 512;

export function createTarGz(entries: readonly ArchiveEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    blocks.push(buildHeader(entry));
    blocks.push(entry.content);
    const remainder = entry.content.length % BLOCK_SIZE;
    if (remainder !== 0) blocks.push(Buffer.alloc(BLOCK_SIZE - remainder));
  }
  // Two zero-filled 512-byte blocks mark the end of a tar archive.
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return gzipSync(Buffer.concat(blocks));
}

export function readTarGz(archive: Buffer): readonly ArchiveEntry[] {
  const tar = gunzipSync(archive);
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker
    const name = readField(header, 0, 100);
    const sizeOctal = readField(header, 124, 12);
    const size = Number.parseInt(sizeOctal.trim() || "0", 8);
    offset += BLOCK_SIZE;
    const content = tar.subarray(offset, offset + size);
    entries.push({ path: name, content: Buffer.from(content) });
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }
  return entries;
}

function buildHeader(entry: ArchiveEntry): Buffer {
  if (Buffer.byteLength(entry.path, "utf8") > 100) {
    throw new Error(`Archive entry path exceeds USTAR's 100-byte name limit: '${entry.path}'.`);
  }
  const header = Buffer.alloc(BLOCK_SIZE);
  writeField(header, entry.path, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, entry.content.length, 124, 12);
  // Fixed rather than Date.now(): packaging the same plugin source
  // twice should produce a byte-identical archive and checksum
  // (reproducible builds), which a real timestamp here would break.
  writeOctal(header, 0, 136, 12);
  header.write("        ", 148, 8, "ascii"); // chksum placeholder while computing
  header.write("0", 156, 1, "ascii"); // typeflag: regular file
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 7);
  header.write(" ", 155, 1, "ascii");

  return header;
}

function writeField(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value, offset, length, "utf8");
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const octal = value.toString(8).padStart(length - 1, "0");
  buffer.write(octal, offset, length - 1, "ascii");
  buffer.write("\0", offset + length - 1, 1, "ascii");
}

function readField(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  return (nullIndex === -1 ? slice : slice.subarray(0, nullIndex)).toString("utf8");
}
