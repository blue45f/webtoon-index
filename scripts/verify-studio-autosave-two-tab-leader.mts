/**
 * Production-bundled Chromium gate for the ToonStudio two-tab document fork (D3).
 *
 * Two pages inside a single browser context — same origin, same OPFS, same Web Locks manager,
 * same autosave document key — open the same manuscript. The gate reproduces the historical
 * fork and then pins the leader discipline that replaces it:
 *
 *   tab1 opens + writes 3 strokes  -> tab1 is the document leader
 *   tab2 opens the same key        -> tab2 is a follower: it must NOT be able to persist
 *   tab2 writes 1 stroke           -> the durable snapshot still holds tab1's 3 strokes
 *   tab1 releases (pagehide/close) -> tab2 can take over the document
 *
 * Run:
 *   pnpm exec tsx scripts/verify-studio-autosave-two-tab-leader.mts
 *
 * Exit codes:
 *   0 = leader discipline observed
 *   1 = build / browser / discipline failure (a fork was observed)
 *   2 = structured environment skip because native OPFS or Web Locks is unavailable
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { build, preview, type PreviewServer } from "vite";

const RESULT_GLOBAL = "__studioTwoTabLeaderResult";
const READY_GLOBAL = "__studioTwoTabLeaderReady";
const PREVIEW_PORT = Number(process.env.TOONSPECTRUM_TWO_TAB_PORT ?? 4354);
const RESULT_TIMEOUT_MS = 120_000;
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function harnessImport(repositoryRoot: string, relativePath: string): string {
  return JSON.stringify(resolve(repositoryRoot, relativePath));
}

/** Exported so Vitest can audit the browser boundary source without launching Chromium. */
export function createStudioTwoTabLeaderHarnessSource(repositoryRoot: string): string {
  const sessionImport = harnessImport(
    repositoryRoot,
    "apps/web/src/domains/creator/studio-autosave-opfs-session.ts",
  );
  return `
globalThis.__zod_globalConfig ??= {};
globalThis.__zod_globalConfig.jitless = true;

const {
  createStudioAutosaveOpfsSession,
  openStudioAutosaveDocumentSession,
  persistStudioAutosaveWithOpfsPrimary,
  reconcileStudioAutosaveWithOpfsPrimary,
  studioAutosaveDocumentBusy,
} = await import(${sessionImport});

const RESULT_GLOBAL = ${JSON.stringify(RESULT_GLOBAL)};
const READY_GLOBAL = ${JSON.stringify(READY_GLOBAL)};
const params = new URLSearchParams(window.location.search);
const documentKey = params.get("documentKey") ?? "";
const baseEpoch = Number(params.get("baseEpoch"));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    snapshot: () => [...map.keys()].sort(),
  };
}

function payload(savedAt, strokeIds) {
  return {
    version: 2,
    savedAt,
    pagesList: [{
      id: "two-tab-page",
      elements: strokeIds.map((id, index) => ({
        id,
        type: "draw",
        points: [16 + index * 8, 16, 72 + index * 8, 72],
        color: "#121212",
        strokeWidth: 6,
      })),
      canvasH: 2_000,
    }],
    currentPageId: "two-tab-page",
  };
}

function strokeIdsOf(reconciliation) {
  const elements = reconciliation?.candidate?.payload?.pagesList?.[0]?.elements;
  return Array.isArray(elements) ? elements.map(element => element?.id ?? null) : [];
}

function errorShape(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    code: error && typeof error === "object" && "code" in error ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
    busy: studioAutosaveDocumentBusy ? studioAutosaveDocumentBusy(error) : null,
  };
}

/**
 * Second persistence authority, shaped exactly like StudioAutosaveSqlitePort. Backed by
 * localStorage so both tabs of this origin share one row, the way the real SQLite mirror does.
 */
function sharedSecondAuthority() {
  const rowKey = "two-tab-verifier-sqlite:" + documentKey;
  return {
    async read(key) {
      const raw = window.localStorage.getItem(rowKey + ":" + key);
      return raw ? JSON.parse(raw) : null;
    },
    async write(key, next) {
      window.localStorage.setItem(
        rowKey + ":" + key,
        JSON.stringify({ state: "snapshot", savedAt: next.savedAt, payload: next }),
      );
    },
    async clear(key, savedAt) {
      window.localStorage.setItem(
        rowKey + ":" + key,
        JSON.stringify({ state: "cleared", savedAt: savedAt ?? new Date().toISOString() }),
      );
    },
  };
}

const storage = memoryStorage();
const sqlite = sharedSecondAuthority();
let opened = null;

const api = {
  documentKey,
  /** Legacy (pre-fix) open path: no leadership, session is created unconditionally. */
  async openLegacy() {
    const session = await createStudioAutosaveOpfsSession(documentKey);
    opened = { session, lease: null, role: "legacy" };
    return { role: "legacy", hasSession: session !== null };
  },
  /** Leader-disciplined open path. */
  async openLeaderAware() {
    const result = await openStudioAutosaveDocumentSession(documentKey);
    opened = { session: result.session, lease: result.lease, role: result.role };
    return {
      role: result.role,
      basis: result.lease.basis,
      hasSession: result.session !== null,
    };
  },
  async reconcile() {
    const reconciliation = await reconcileStudioAutosaveWithOpfsPrimary({
      session: opened?.session ?? null,
      sqlite,
      storage,
      key: documentKey,
    });
    return {
      authority: reconciliation.authority,
      durability: reconciliation.durability,
      savedAt: reconciliation.candidate?.savedAt ?? null,
      strokeIds: strokeIdsOf(reconciliation),
    };
  },
  async write(offsetMs, strokeIds) {
    const savedAt = new Date(baseEpoch + offsetMs).toISOString();
    try {
      const receipt = await persistStudioAutosaveWithOpfsPrimary({
        session: opened?.session ?? null,
        sqlite,
        storage,
        key: documentKey,
        payload: payload(savedAt, strokeIds),
      });
      return { ok: true, authority: receipt.authority, savedAt: receipt.savedAt };
    } catch (error) {
      return { ok: false, error: errorShape(error), browserKeys: storage.snapshot() };
    }
  },
  /**
   * The pre-fix persistence rule, reproduced verbatim: an OPFS refusal fell through to the second
   * authority regardless of *why* it was refused. Kept as the measurement baseline.
   */
  async writeLegacyFallthrough(offsetMs, strokeIds) {
    const savedAt = new Date(baseEpoch + offsetMs).toISOString();
    const next = payload(savedAt, strokeIds);
    try {
      await opened.session.write(next);
      return { ok: true, authority: "opfs-journal", savedAt };
    } catch (opfsError) {
      await sqlite.write(documentKey, next);
      return { ok: true, authority: "sqlite-fallback", savedAt, opfs: errorShape(opfsError) };
    }
  },
  /** Emulates the tab going away: dispose the session and drop the document lease. */
  async close() {
    await opened?.session?.dispose();
    await opened?.lease?.release();
    opened = null;
    return { closed: true };
  },
  async waitForPromotion(timeoutMs) {
    const lease = opened?.lease ?? null;
    if (!lease || typeof lease.waitForLeadership !== "function") {
      return { promoted: false, reason: "no-lease" };
    }
    const promoted = await lease.waitForLeadership({ timeoutMs });
    return { promoted, role: lease.role };
  },
  async adoptAfterPromotion() {
    if (!opened || opened.role === "leader") return { adopted: false, reason: "already-leader" };
    const session = await createStudioAutosaveOpfsSession(documentKey);
    opened = { ...opened, session, role: "leader" };
    return { adopted: session !== null };
  },
  capabilities: {
    navigatorStorageGetDirectory: typeof navigator.storage?.getDirectory === "function",
    webLocksRequest: typeof navigator.locks?.request === "function",
  },
};

window[RESULT_GLOBAL] = api;
window[READY_GLOBAL] = true;
`;
}

function createHtml(): string {
  return `<!doctype html>
<html lang="ko">
  <head><meta charset="utf-8" /><title>studio two-tab leader gate</title></head>
  <body><pre data-verifier-output></pre><script type="module" src="/browser-harness.ts"></script></body>
</html>
`;
}

type TabApiCall = Readonly<{ method: string; args?: readonly unknown[] }>;

async function callTab(page: Page, call: TabApiCall): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ resultGlobal, method, args }) => {
      const api = (window as unknown as Record<string, Record<string, unknown>>)[resultGlobal];
      const fn = api[method] as (...input: unknown[]) => Promise<unknown>;
      return (await fn.apply(api, args)) as Record<string, unknown>;
    },
    { resultGlobal: RESULT_GLOBAL, method: call.method, args: [...(call.args ?? [])] },
  ) as Promise<Record<string, unknown>>;
}

async function openTab(
  context: BrowserContext,
  origin: string,
  documentKey: string,
  baseEpoch: number,
): Promise<Page> {
  const page = await context.newPage();
  const url = new URL("/", origin);
  url.searchParams.set("documentKey", documentKey);
  url.searchParams.set("baseEpoch", String(baseEpoch));
  await page.goto(url.href, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    (readyGlobal) => (window as unknown as Record<string, unknown>)[readyGlobal] === true,
    READY_GLOBAL,
    { timeout: RESULT_TIMEOUT_MS },
  );
  return page;
}

type ScenarioReport = Readonly<Record<string, unknown>>;

async function runScenario(
  context: BrowserContext,
  origin: string,
  mode: "legacy" | "leader-aware",
): Promise<ScenarioReport> {
  const documentKey = `toonspectrum-studio-autosave:v12:two-tab-${mode}-${randomUUID()}`;
  const baseEpoch = Date.now();
  const openMethod = mode === "legacy" ? "openLegacy" : "openLeaderAware";

  const writeMethod = mode === "legacy" ? "writeLegacyFallthrough" : "write";

  const tab1 = await openTab(context, origin, documentKey, baseEpoch);
  const tab1Open = await callTab(tab1, { method: openMethod });
  const tab1Strokes = ["stroke-a", "stroke-b", "stroke-c"];
  const tab1Write = await callTab(tab1, { method: writeMethod, args: [0, tab1Strokes] });
  const tab1AfterOwnWrite = await callTab(tab1, { method: "reconcile" });

  // The reported procedure waits ~4s between the leading tab's last save and the second tab.
  await tab1.waitForTimeout(4_000);

  const tab2 = await openTab(context, origin, documentKey, baseEpoch);
  const tab2Open = await callTab(tab2, { method: openMethod });
  const tab2OnOpen = await callTab(tab2, { method: "reconcile" });
  const tab2Write = await callTab(tab2, { method: writeMethod, args: [4_000, ["stroke-z"]] });
  const tab2AfterWrite = await callTab(tab2, { method: "reconcile" });
  const tab1AfterTab2Write = await callTab(tab1, { method: "reconcile" });

  // Yield rule: the leading tab goes away, the follower must be able to take over.
  await callTab(tab1, { method: "close" });
  await tab1.close();
  const promotion = mode === "leader-aware"
    ? await callTab(tab2, { method: "waitForPromotion", args: [10_000] })
    : { promoted: null, reason: "not-applicable" };
  const adoption = mode === "leader-aware"
    ? await callTab(tab2, { method: openMethod })
    : { role: null };
  const tab2AfterTakeover = await callTab(tab2, { method: writeMethod, args: [8_000, tab1Strokes.concat("stroke-z")] });
  const finalState = await callTab(tab2, { method: "reconcile" });
  await callTab(tab2, { method: "close" });
  await tab2.close();

  return Object.freeze({
    mode,
    documentKey,
    tab1: { open: tab1Open, write: tab1Write, afterOwnWrite: tab1AfterOwnWrite, afterTab2Write: tab1AfterTab2Write },
    tab2: {
      open: tab2Open,
      onOpen: tab2OnOpen,
      write: tab2Write,
      afterWrite: tab2AfterWrite,
      promotion,
      adoption,
      afterTakeover: tab2AfterTakeover,
    },
    finalState,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strokeList(value: unknown): readonly string[] {
  const state = record(value);
  const ids = state?.strokeIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Exported for Vitest: the discipline assertions, independent of the browser transport. */
export function validateStudioTwoTabLeaderScenario(scenario: unknown): readonly string[] {
  const report = record(scenario);
  const issues: string[] = [];
  const tab2 = record(report?.tab2);
  const tab1 = record(report?.tab1);

  if (record(tab2?.open)?.role !== "follower") {
    issues.push("the second tab was not demoted to follower when the document was already open");
  }
  if (record(tab2?.write)?.ok !== false) {
    issues.push("the follower tab persisted a checkpoint into the shared document key");
  }
  const afterFollowerWrite = strokeList(tab2?.afterWrite);
  if (afterFollowerWrite.length !== 3) {
    issues.push(
      `the follower write forked the document: durable strokes became [${afterFollowerWrite.join(", ")}]`,
    );
  }
  const leaderView = strokeList(tab1?.afterTab2Write);
  if (leaderView.length !== 3) {
    issues.push(
      `the leading tab lost its own strokes after the follower wrote: [${leaderView.join(", ")}]`,
    );
  }
  if (record(tab2?.promotion)?.promoted !== true) {
    issues.push("the follower was never promoted after the leading tab closed");
  }
  if (record(tab2?.afterTakeover)?.ok !== true) {
    issues.push("the promoted tab could not persist after taking over the document");
  }
  return Object.freeze(issues);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function execute(scratch: string): Promise<void> {
  const repositoryRoot = process.cwd();
  const sourceDirectory = join(scratch, "source");
  const distributionDirectory = join(scratch, "dist");
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(distributionDirectory, { recursive: true });
  const harnessSource = createStudioTwoTabLeaderHarnessSource(repositoryRoot);
  writeFileSync(join(sourceDirectory, "browser-harness.ts"), harnessSource);
  writeFileSync(join(sourceDirectory, "index.html"), createHtml());

  await build({
    root: realpathSync(sourceDirectory),
    configFile: false,
    cacheDir: join(scratch, "vite-cache"),
    clearScreen: false,
    logLevel: "error",
    base: "/",
    build: {
      outDir: realpathSync(distributionDirectory),
      emptyOutDir: true,
      target: "es2022",
      minify: true,
      sourcemap: true,
    },
  });
  writeJson(join(scratch, "production-build.json"), {
    mode: "vite-production-build",
    harnessSha256: createHash("sha256").update(harnessSource).digest("hex"),
    indexSha256: createHash("sha256")
      .update(readFileSync(join(distributionDirectory, "index.html")))
      .digest("hex"),
  });

  const origin = `http://127.0.0.1:${PREVIEW_PORT}`;
  let previewServer: PreviewServer | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    previewServer = await preview({
      root: realpathSync(sourceDirectory),
      configFile: false,
      clearScreen: false,
      logLevel: "error",
      build: { outDir: realpathSync(distributionDirectory) },
      preview: {
        host: "127.0.0.1",
        port: PREVIEW_PORT,
        strictPort: true,
        headers: { "Content-Security-Policy": CSP, "Cache-Control": "no-store" },
      },
    });
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    context = await browser.newContext();

    const probe = await openTab(context, origin, "capability-probe", Date.now());
    const capabilities = await probe.evaluate(
      (resultGlobal) =>
        (window as unknown as Record<string, { capabilities: Record<string, boolean> }>)[
          resultGlobal
        ].capabilities,
      RESULT_GLOBAL,
    );
    await probe.close();
    if (!capabilities.navigatorStorageGetDirectory || !capabilities.webLocksRequest) {
      const summary = {
        status: "skipped",
        skipKind: "environment-unsupported",
        capabilities,
        artifactDirectory: scratch,
      };
      writeJson(join(scratch, "summary.json"), summary);
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }

    // Baseline first: the pre-fix fall-through rule, so the report carries a measured before/after.
    const legacy = await runScenario(context, origin, "legacy");
    writeJson(join(scratch, "legacy-baseline.json"), legacy);
    const leaderAware = await runScenario(context, origin, "leader-aware");
    writeJson(join(scratch, "leader-aware.json"), leaderAware);
    const issues = validateStudioTwoTabLeaderScenario(leaderAware);

    const summary = {
      status: issues.length === 0 ? "ok" : "failed",
      artifactDirectory: scratch,
      origin,
      legacyBaseline: {
        tab2DurableStrokesAfterItsWrite: strokeList(record(record(legacy.tab2)?.afterWrite)),
        tab1DurableStrokesAfterTab2Write: strokeList(record(record(legacy.tab1)?.afterTab2Write)),
        forked: strokeList(record(record(legacy.tab1)?.afterTab2Write)).length !== 3,
      },
      legacy,
      leaderAware,
      issues,
    };
    writeJson(join(scratch, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    if (issues.length > 0) process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await previewServer?.close().catch(() => undefined);
  }
}

export async function runStudioTwoTabLeaderVerifier(): Promise<void> {
  const scratch =
    process.env.TOONSPECTRUM_TWO_TAB_VERIFY_DIR
    ?? join(tmpdir(), `toonspectrum-studio-two-tab-${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(scratch, { recursive: true });
  try {
    await execute(scratch);
  } catch (error) {
    const failure = {
      status: "failed",
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      artifactDirectory: scratch,
    };
    writeJson(join(scratch, "failure.json"), failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runStudioTwoTabLeaderVerifier();
}
