import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";

import {
  findFreePort,
  spawnVitePreview,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";

const MODE = process.env.TOONSPECTRUM_ALL_BRUSH_MODE === "gpu" ? "gpu" : "baseline";
const SHARD_INDEX = Number(process.env.TOONSPECTRUM_ALL_BRUSH_SHARD_INDEX ?? "0");
const SHARD_COUNT = Number(process.env.TOONSPECTRUM_ALL_BRUSH_SHARD_COUNT ?? "1");
const OUTPUT_ROOT = process.env.TOONSPECTRUM_ALL_BRUSH_OUTPUT_DIR
  ?? join(tmpdir(), "toonspectrum-all-brush-long-stroke");
const CASE_TIMEOUT_MS = Number(process.env.TOONSPECTRUM_ALL_BRUSH_CASE_TIMEOUT_MS ?? "480000");
const REQUESTED_IDS = new Set(
  (process.env.TOONSPECTRUM_ALL_BRUSH_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

interface CaseResult {
  readonly id: string;
  readonly name: string;
  readonly operation: StudioBrushCatalogItem["operation"];
  readonly mediaGroup: StudioBrushCatalogItem["mediaGroup"];
  readonly source: StudioBrushCatalogItem["source"];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMilliseconds: number;
  readonly reportPath: string;
  readonly reportExists: boolean;
  readonly verifierOk: boolean | null;
  readonly fatal: string | null;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "brush";
}

function selectedBrushes(): readonly StudioBrushCatalogItem[] {
  invariant(Number.isSafeInteger(SHARD_INDEX) && SHARD_INDEX >= 0, "invalid shard index");
  invariant(Number.isSafeInteger(SHARD_COUNT) && SHARD_COUNT > 0, "invalid shard count");
  invariant(SHARD_INDEX < SHARD_COUNT, "shard index exceeds shard count");
  return STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item, index) =>
    (REQUESTED_IDS.size === 0 || REQUESTED_IDS.has(item.id))
    && index % SHARD_COUNT === SHARD_INDEX
  );
}

function runCase(
  item: StudioBrushCatalogItem,
  caseRoot: string,
  studioUrl: string,
): Promise<CaseResult> {
  return new Promise((resolve) => {
    mkdirSync(caseRoot, { recursive: true });
    const logPath = join(caseRoot, "verifier.log");
    const log = createWriteStream(logPath, { flags: "w" });
    const started = performance.now();
    let timedOut = false;
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "scripts/verify-studio-long-stroke.mts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STUDIO_URL: studioUrl,
          TOONSPECTRUM_VERIFY_DIR: caseRoot,
          TOONSPECTRUM_LONG_STROKE_BRUSH: item.name,
          TOONSPECTRUM_LONG_STROKE_BRUSH_ID: item.id,
          TOONSPECTRUM_LONG_STROKE_OPERATION: item.operation,
          TOONSPECTRUM_LONG_STROKE_BRUSH_WIDTH: String(item.defaultWidth),
          TOONSPECTRUM_LONG_STROKE_PATH: "screen-fill",
          TOONSPECTRUM_LONG_STROKE_HEADED: "1",
          TOONSPECTRUM_LONG_STROKE_WEBGPU: MODE === "gpu" ? "1" : "0",
          TOONSPECTRUM_LONG_STROKE_SPAWN_PREVIEW: "0",
          TOONSPECTRUM_LONG_STROKE_LONG_TASK_MAX:
            process.env.TOONSPECTRUM_LONG_STROKE_LONG_TASK_MAX ?? "12",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
    }, CASE_TIMEOUT_MS);
    child.once("error", (error) => log.write(`\nspawn error: ${error.stack ?? error.message}\n`));
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      log.end();
      const reportPath = join(caseRoot, "studio-long-stroke", "report.json");
      let reportExists = false;
      let verifierOk: boolean | null = null;
      let fatal: string | null = null;
      try {
        const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
          ok?: unknown;
          fatal?: unknown;
        };
        reportExists = true;
        verifierOk = typeof parsed.ok === "boolean" ? parsed.ok : null;
        fatal = typeof parsed.fatal === "string" ? parsed.fatal : null;
      } catch {
        // The aggregate report treats a missing/unreadable case as failed measurement.
      }
      resolve({
        id: item.id,
        name: item.name,
        operation: item.operation,
        mediaGroup: item.mediaGroup,
        source: item.source,
        exitCode,
        signal,
        timedOut,
        durationMilliseconds: performance.now() - started,
        reportPath,
        reportExists,
        verifierOk,
        fatal,
      });
    });
  });
}

async function main(): Promise<void> {
  const brushes = selectedBrushes();
  invariant(brushes.length > 0, "this shard contains no listed brushes");
  const shardRoot = join(OUTPUT_ROOT, MODE, `shard-${SHARD_INDEX}-of-${SHARD_COUNT}`);
  mkdirSync(shardRoot, { recursive: true });
  const port = await findFreePort({ unavailableMessage: "could not reserve all-brush preview port" });
  const previewLog = join(shardRoot, "preview.log");
  const preview: { child: ChildProcess; studioUrl: string } = await (async () => {
    const child = spawnVitePreview({ port, runner: "node-vite-bin", logPath: previewLog });
    const origin = `http://127.0.0.1:${port}/`;
    await waitForServer(origin, {
      maxAttempts: 180,
      pollIntervalMs: 100,
      requestInit: { redirect: "manual" },
    });
    return { child, studioUrl: `${origin}studio` };
  })();
  const results: CaseResult[] = [];
  try {
    for (let index = 0; index < brushes.length; index += 1) {
      const item = brushes[index]!;
      const caseRoot = join(
        shardRoot,
        `${String(index).padStart(3, "0")}-${safePart(item.id)}`,
      );
      process.stdout.write(
        `[all-brush-long-stroke] ${MODE} ${index + 1}/${brushes.length} ${item.id}\n`,
      );
      const result = await runCase(item, caseRoot, preview.studioUrl);
      results.push(result);
      writeFileSync(join(shardRoot, "shard-report.json"), `${JSON.stringify({
        kind: "toonspectrum-all-brush-long-stroke-shard-v1",
        generatedAt: new Date().toISOString(),
        sourceCommit: process.env.GITHUB_SHA ?? null,
        mode: MODE,
        shardIndex: SHARD_INDEX,
        shardCount: SHARD_COUNT,
        listedBrushCount: STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
        selectedBrushCount: brushes.length,
        completedBrushCount: results.length,
        results,
      }, null, 2)}\n`);
    }
  } finally {
    await stopChildProcess(preview.child).catch(() => undefined);
  }
  const missing = results.filter((result) => !result.reportExists || result.timedOut);
  process.stdout.write(
    `[all-brush-long-stroke] ${MODE} shard ${SHARD_INDEX}/${SHARD_COUNT} `
      + `completed ${results.length}; missing ${missing.length}\n`,
  );
  // Individual quality failures are data for the election, not shard infrastructure failures.
  if (missing.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
