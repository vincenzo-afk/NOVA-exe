import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The append-and-read-back-JSONL pattern `FileJsonlLogSink` already
 * implements for logs, factored out so `FileSpanStore` and
 * `FileMetricStore` (this session's persistent trace/metric stores —
 * see AUDIT_REPORT_2026-09-11.md's "Remaining, in priority order" item
 * 2 from the previous pass) don't each reimplement file I/O.
 */
export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(path: string): readonly T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
