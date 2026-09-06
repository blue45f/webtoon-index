/**
 * Production-bundled Chromium gate for Studio autosave's native OPFS + Web Locks boundary.
 *
 * The verifier creates a focused Vite production bundle in an isolated evidence directory,
 * serves that exact bundle through `vite preview`, and exercises the public autosave session
 * contract with real browser-owned OPFS and Web Locks:
 *
 *   checkpoint -> page reload -> durable read
 *   newer SQLite fallback -> migration into OPFS -> durable read
 *   durable clear tombstone -> SQLite mirror + stale browser-slot suppression -> durable read
 *
 * Run:
 *   pnpm exec tsx scripts/verify-studio-autosave-opfs-session.mts
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_AUTOSAVE_OPFS_VERIFY_DIR=/tmp/studio-autosave-opfs \
 *     pnpm exec tsx scripts/verify-studio-autosave-opfs-session.mts
 *
 * Exit codes:
 *   0 = all native durability and diagnostics gates passed
 *   1 = production build, browser, durability, cleanup, or diagnostics failure
 *   2 = structured environment skip because native OPFS or Web Locks is unavailable
 */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  build,
  preview,
  type PreviewServer,
} from "vite";

import { findFreePort } from "./lib/studio-verify-preview-harness.mjs";

export const STUDIO_AUTOSAVE_OPFS_BROWSER_REPORT_SCHEMA_VERSION = 1 as const;

const RESULT_GLOBAL = "__studioAutosaveOpfsSessionBrowserResult";
const ROOT_NAME = "toonspectrum-studio-autosave-v3";
const RECOVERY_ROOT_NAME = "recovery-journals";
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

export interface StudioAutosaveOpfsBrowserDiagnostics {
  readonly browserVersion: string;
  readonly contentSecurityPolicy: string;
  readonly consoleErrors: readonly string[];
  readonly consoleWarnings: readonly string[];
  readonly pageErrors: readonly string[];
  readonly requestFailures: readonly string[];
  readonly fiveHundredResponses: readonly string[];
  readonly cspViolations: readonly Readonly<{
    effectiveDirective: string;
    blockedUri: string;
  }>[];
  readonly requests: readonly Readonly<{
    method: string;
    resourceType: string;
    url: string;
  }>[];
  readonly responses: readonly Readonly<{
    status: number;
    url: string;
  }>[];
}

export interface StudioAutosaveOpfsBrowserRunPlan {
  readonly scratch: string;
  readonly sourceDirectory: string;
  readonly distributionDirectory: string;
  readonly browserHarness: string;
  readonly htmlEntry: string;
  readonly evidence: Readonly<{
    browserResult: string;
    diagnostics: string;
    productionBuild: string;
    observations: string;
    summary: string;
  }>;
}

interface BrowserObservation {
  readonly status?: unknown;
  readonly schemaVersion?: unknown;
  readonly execution?: unknown;
  readonly document?: unknown;
  readonly native?: unknown;
  readonly checkpoint?: unknown;
  readonly migration?: unknown;
  readonly clear?: unknown;
  readonly cleanup?: unknown;
  readonly securityPolicyViolations?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every(entry => typeof entry === "string")
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : null;
}

function nested(
  value: unknown,
  ...keys: readonly string[]
): unknown {
  let candidate: unknown = value;
  for (const key of keys) {
    candidate = record(candidate)?.[key];
  }
  return candidate;
}

function elementId(value: unknown): string | null {
  const pages = nested(value, "payload", "pagesList");
  if (!Array.isArray(pages)) return null;
  const elements = record(pages[0])?.elements;
  if (!Array.isArray(elements)) return null;
  const id = record(elements[0])?.id;
  return typeof id === "string" ? id : null;
}

/**
 * Pure policy used by both the standalone browser gate and focused Vitest coverage.
 */
export function validateStudioAutosaveOpfsBrowserResult(
  resultValue: unknown,
  diagnostics: StudioAutosaveOpfsBrowserDiagnostics,
  productionAssets: readonly string[],
): readonly string[] {
  const issues: string[] = [];
  const result = record(resultValue) as BrowserObservation | null;
  const native = record(result?.native);
  const checkpoint = record(result?.checkpoint);
  const migration = record(result?.migration);
  const clear = record(result?.clear);
  const cleanup = record(result?.cleanup);
  const document = record(result?.document);
  const securityPolicyViolations = Array.isArray(
    result?.securityPolicyViolations,
  )
    ? result.securityPolicyViolations
    : null;

  if (
    result?.status !== "ok"
    || result?.schemaVersion
      !== STUDIO_AUTOSAVE_OPFS_BROWSER_REPORT_SCHEMA_VERSION
    || result?.execution !== "focused-vite-production-build-and-preview"
  ) {
    issues.push("production-preview browser result identity is incomplete");
  }

  const documentKey = document?.key;
  const documentId = document?.journalDocumentId;
  if (
    typeof documentKey !== "string"
    || !documentKey.startsWith("toonspectrum-studio-autosave:v2:browser-opfs-")
    || typeof documentId !== "string"
    || !/^autosave-[0-9a-f]{48}$/u.test(documentId)
  ) {
    issues.push("the verifier did not use a unique, valid autosave document identity");
  }

  const lockRequests = stringArray(native?.lockRequests);
  const expectedLockName = native?.expectedLockName;
  if (
    nested(native, "capabilities", "navigatorStorageGetDirectory") !== true
    || nested(native, "capabilities", "webLocksRequest") !== true
    || positiveInteger(native?.getDirectoryCalls) === null
    || !lockRequests
    || lockRequests.length < 4
    || typeof expectedLockName !== "string"
    || !lockRequests.every(name => name === expectedLockName)
  ) {
    issues.push("real navigator.storage.getDirectory and origin-wide Web Locks were not observed");
  }
  const filesAfterCheckpoint = stringArray(native?.filesAfterCheckpoint);
  const filesAfterCleanup = stringArray(native?.filesAfterCleanup);
  if (
    !filesAfterCheckpoint
    || filesAfterCheckpoint.length < 4
    || typeof documentId !== "string"
    || !filesAfterCheckpoint.every(path => path.includes(documentId))
    || !filesAfterCleanup
    || filesAfterCleanup.length !== 0
  ) {
    issues.push("native OPFS files were not created and uniquely cleaned up");
  }

  const receipt = record(checkpoint?.receipt);
  const afterReload = record(checkpoint?.afterReload);
  if (
    receipt?.authority !== "opfs-journal"
    || positiveInteger(receipt?.sequence) === null
    || positiveInteger(receipt?.revision) === null
    || checkpoint?.sqliteMirrorState !== "snapshot"
    || elementId(checkpoint?.sqliteMirror) !== "checkpoint-stroke"
    || checkpoint?.pageReloadObserved !== true
    || checkpoint?.navigationType !== "reload"
    || afterReload?.state !== "snapshot"
    || elementId(afterReload) !== "checkpoint-stroke"
    || afterReload?.savedAt !== checkpoint?.savedAt
  ) {
    issues.push("checkpoint save -> real page reload -> durable read did not round-trip");
  }

  const reconciliation = record(migration?.reconciliation);
  const migratedRead = record(migration?.afterFreshSessionRead);
  if (
    migration?.fallbackKind !== "sqlite-fallback"
    || reconciliation?.authority !== "opfs-journal"
    || reconciliation?.migratedToOpfs !== true
    || elementId(reconciliation?.candidate) !== "newer-sqlite-fallback-stroke"
    || migratedRead?.state !== "snapshot"
    || elementId(migratedRead) !== "newer-sqlite-fallback-stroke"
    || migratedRead?.savedAt !== migration?.savedAt
    || (
      positiveInteger(migratedRead?.revision) ?? 0
    ) <= (
      positiveInteger(afterReload?.revision) ?? Number.MAX_SAFE_INTEGER
    )
  ) {
    issues.push("newer SQLite fallback was not promoted into native OPFS");
  }

  const clearReceipt = record(clear?.receipt);
  const afterClearReopen = record(clear?.afterFreshSessionRead);
  const clearReconciliation = record(clear?.reconciliation);
  const finalRead = record(clear?.finalFreshSessionRead);
  if (
    clearReceipt?.authority !== "opfs-journal"
    || positiveInteger(clearReceipt?.sequence) === null
    || positiveInteger(clearReceipt?.revision) === null
    || afterClearReopen?.state !== "cleared"
    || clearReconciliation?.candidate !== null
    || clearReconciliation?.authority !== "opfs-journal"
    || clearReconciliation?.migratedToOpfs !== false
    || clear?.stalePrimaryRemoved !== true
    || clear?.staleSidecarRemoved !== true
    || nested(clear, "sqliteAfterClear", "state") !== "cleared"
    || finalRead?.state !== "cleared"
    || finalRead?.savedAt !== clear?.savedAt
  ) {
    issues.push("durable clear tombstone did not suppress and remove stale browser recovery");
  }

  if (
    cleanup?.opfsDocumentRemoved !== true
    || cleanup?.sqliteRowRemoved !== true
    || cleanup?.localStorageCleared !== true
    || cleanup?.sessionStorageCleared !== true
  ) {
    issues.push("the unique verifier document was not fully cleaned up");
  }

  if (
    diagnostics.consoleErrors.length > 0
    || diagnostics.pageErrors.length > 0
    || diagnostics.requestFailures.length > 0
    || diagnostics.fiveHundredResponses.length > 0
    || diagnostics.cspViolations.length > 0
  ) {
    issues.push("Chromium observed console, page, request, 5xx, or CSP failures");
  }
  if (!securityPolicyViolations || securityPolicyViolations.length > 0) {
    issues.push("the bundled browser harness observed a CSP violation");
  }
  if (
    !diagnostics.contentSecurityPolicy.includes("script-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("connect-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("worker-src 'self'")
  ) {
    issues.push("the production preview did not serve the isolated verifier CSP");
  }
  if (
    productionAssets.length === 0
    || !productionAssets.some(path => /^assets\/.+\.js$/u.test(path))
    || !productionAssets.some(path => /^assets\/.+\.wasm$/u.test(path))
    || diagnostics.requests.some(request => (
      request.url.includes("/src/")
      || /\.(?:[cm]?ts|tsx)(?:[?#]|$)/u.test(request.url)
    ))
  ) {
    issues.push("the browser did not execute a focused Vite production bundle");
  }
  return Object.freeze(issues);
}

function browserHarnessImport(
  repositoryRoot: string,
  relativePath: string,
): string {
  return JSON.stringify(resolve(repositoryRoot, relativePath));
}

/**
 * Kept as an exported source factory so Vitest can audit the real-browser boundary without
 * pretending an in-memory filesystem is equivalent to Chromium OPFS.
 */
export function createStudioAutosaveOpfsBrowserHarnessSource(
  repositoryRoot: string,
): string {
  const sessionImport = browserHarnessImport(
    repositoryRoot,
    "apps/web/src/domains/creator/studio-autosave-opfs-session.ts",
  );
  const autosaveImport = browserHarnessImport(
    repositoryRoot,
    "apps/web/src/domains/creator/studio-autosave.ts",
  );
  const sqliteStoreImport = browserHarnessImport(
    repositoryRoot,
    "apps/web/src/domains/creator/studio-autosave-sqlite-store.ts",
  );
  const sqliteRuntimeImport = browserHarnessImport(
    repositoryRoot,
    "apps/web/src/domains/creator/studio-local-database-runtime.ts",
  );
  return `
globalThis.__zod_globalConfig ??= {};
globalThis.__zod_globalConfig.jitless = true;

const {
  createStudioAutosaveOpfsSession,
  persistStudioAutosaveWithOpfsPrimary,
  reconcileStudioAutosaveWithOpfsPrimary,
} = await import(${sessionImport});
const {
  serializeStudioAutosave,
  studioLifecycleAutosaveSidecarKey,
} = await import(${autosaveImport});
const {
  STUDIO_AUTOSAVE_SQLITE_NAMESPACE,
  acquireStudioAutosaveSqliteStore,
} = await import(${sqliteStoreImport});
const {
  acquireStudioLocalDatabase,
  closeStudioLocalDatabaseRuntime,
} = await import(${sqliteRuntimeImport});

const RESULT_GLOBAL = ${JSON.stringify(RESULT_GLOBAL)};
const ROOT_NAME = ${JSON.stringify(ROOT_NAME)};
const RECOVERY_ROOT_NAME = ${JSON.stringify(RECOVERY_ROOT_NAME)};
const REPORT_SCHEMA_VERSION = ${STUDIO_AUTOSAVE_OPFS_BROWSER_REPORT_SCHEMA_VERSION};

const params = new URLSearchParams(window.location.search);
const documentKey = params.get("documentKey");
const runId = params.get("runId");
const baseEpoch = Number(params.get("baseEpoch"));
const phaseKey = runId ? "toonspectrum-opfs-verifier-phase:" + runId : "";
const securityPolicyViolations = [];

window.addEventListener("securitypolicyviolation", event => {
  securityPolicyViolations.push({
    effectiveDirective: event.effectiveDirective,
    blockedUri: event.blockedURI,
  });
});

function publish(value) {
  window[RESULT_GLOBAL] = value;
  document.documentElement.dataset.verifierStatus = value.status;
  const output = document.querySelector("[data-verifier-output]");
  if (output) output.textContent = JSON.stringify(value, null, 2);
}

function errorShape(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  };
}

function payload(savedAt, elementId) {
  return {
    version: 2,
    savedAt,
    pagesList: [{
      id: "browser-opfs-page",
      elements: [{
        id: elementId,
        type: "draw",
        points: [16, 16, 72, 72],
        color: "#121212",
        strokeWidth: 6,
      }],
      canvasH: 2_000,
    }],
    currentPageId: "browser-opfs-page",
  };
}

function firstElementId(readResult) {
  return readResult?.state === "snapshot"
    ? readResult.payload?.pagesList?.[0]?.elements?.[0]?.id ?? null
    : null;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function listTree(directory, prefix = "") {
  const paths = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? prefix + "/" + name : name;
    if (handle.kind === "directory") {
      paths.push(...await listTree(handle, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

async function studioRoot(create) {
  const base = await navigator.storage.getDirectory();
  try {
    return await base.getDirectoryHandle(ROOT_NAME, { create });
  } catch (error) {
    if (!create && error?.name === "NotFoundError") return null;
    throw error;
  }
}

async function uniqueDocumentFiles(journalDocumentId) {
  const root = await studioRoot(false);
  if (!root) return [];
  return (await listTree(root)).filter(path => path.includes(journalDocumentId));
}

async function removeUniqueDocument(journalDocumentId) {
  const root = await studioRoot(false);
  if (!root) return false;
  try {
    const recoveryRoot = await root.getDirectoryHandle(
      RECOVERY_ROOT_NAME,
      { create: false },
    );
    await recoveryRoot.removeEntry(journalDocumentId, { recursive: true });
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") return false;
    throw error;
  }
}

function nativeScope(telemetry) {
  return {
    navigator: {
      storage: {
        async getDirectory() {
          telemetry.getDirectoryCalls += 1;
          return navigator.storage.getDirectory();
        },
        async estimate() {
          telemetry.estimateCalls += 1;
          return navigator.storage.estimate();
        },
      },
      locks: {
        request(name, options, callback) {
          telemetry.lockRequests.push(name);
          return navigator.locks.request(name, options, () => callback());
        },
      },
    },
    localStorage: window.localStorage,
    crypto: window.crypto,
  };
}

async function cleanupBrowserSlots(sidecarKey) {
  window.localStorage.removeItem(documentKey);
  window.localStorage.removeItem(sidecarKey);
}

async function run() {
  if (
    !documentKey
    || !runId
    || !Number.isSafeInteger(baseEpoch)
    || baseEpoch <= 0
    || !phaseKey
  ) {
    throw new Error("verifier query identity is invalid");
  }
  const capabilities = {
    navigatorStorageGetDirectory:
      typeof navigator.storage?.getDirectory === "function",
    webLocksRequest: typeof navigator.locks?.request === "function",
  };
  if (
    !capabilities.navigatorStorageGetDirectory
    || !capabilities.webLocksRequest
  ) {
    publish({
      status: "unsupported",
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "focused-vite-production-build-and-preview",
      reason: !capabilities.navigatorStorageGetDirectory
        ? "native-opfs-unavailable"
        : "web-locks-unavailable",
      capabilities,
    });
    return;
  }

  const digest = await sha256Hex(documentKey);
  const journalDocumentId = "autosave-" + digest.slice(0, 48);
  const expectedLockName = "toonspectrum-opfs-recovery:" + journalDocumentId;
  const sidecarKey = studioLifecycleAutosaveSidecarKey(documentKey);
  const checkpointSavedAt = new Date(baseEpoch).toISOString();
  const migrationSavedAt = new Date(baseEpoch + 10_000).toISOString();
  const clearSavedAt = new Date(baseEpoch + 20_000).toISOString();
  const checkpointPayload = payload(checkpointSavedAt, "checkpoint-stroke");
  const migrationPayload = payload(
    migrationSavedAt,
    "newer-sqlite-fallback-stroke",
  );
  const telemetry = {
    getDirectoryCalls: 0,
    estimateCalls: 0,
    lockRequests: [],
  };
  const scope = nativeScope(telemetry);
  const storedPhase = window.sessionStorage.getItem(phaseKey);

  if (!storedPhase) {
    let session = null;
    try {
      await cleanupBrowserSlots(sidecarKey);
      await removeUniqueDocument(journalDocumentId).catch(() => false);
      const sqlite = await acquireStudioAutosaveSqliteStore();
      session = await createStudioAutosaveOpfsSession(documentKey, scope);
      if (!session) throw new Error("native OPFS session selection returned null");
      const receipt = await persistStudioAutosaveWithOpfsPrimary({
        session,
        sqlite,
        storage: window.localStorage,
        key: documentKey,
        payload: checkpointPayload,
      });
      await session.flush();
      const sqliteMirror = await sqlite.read(documentKey);
      const filesAfterCheckpoint = await uniqueDocumentFiles(journalDocumentId);
      const phase = {
        receipt,
        savedAt: checkpointSavedAt,
        sqliteMirrorState: sqliteMirror?.state ?? null,
        sqliteMirror,
        filesAfterCheckpoint,
        telemetry,
      };
      window.sessionStorage.setItem(phaseKey, JSON.stringify(phase));
      publish({
        status: "reload-required",
        schemaVersion: REPORT_SCHEMA_VERSION,
        execution: "focused-vite-production-build-and-preview",
        document: { key: documentKey, journalDocumentId },
        checkpoint: phase,
      });
    } finally {
      await session?.dispose();
      await closeStudioLocalDatabaseRuntime();
    }
    return;
  }

  const phaseOne = JSON.parse(storedPhase);
  let reloadSession = null;
  let migrationReadSession = null;
  let clearReadSession = null;
  let finalReadSession = null;
  let sqlite = null;
  let cleanup = {
    opfsDocumentRemoved: false,
    sqliteRowRemoved: false,
    localStorageCleared: false,
    sessionStorageCleared: false,
  };
  try {
    sqlite = await acquireStudioAutosaveSqliteStore();
    reloadSession = await createStudioAutosaveOpfsSession(documentKey, scope);
    if (!reloadSession) throw new Error("reload native OPFS session selection returned null");
    const afterReload = await reloadSession.readLatest();
    if (
      afterReload?.state !== "snapshot"
      || firstElementId(afterReload) !== "checkpoint-stroke"
    ) {
      throw new Error("checkpoint did not survive the real page reload");
    }

    await sqlite.write(documentKey, migrationPayload);
    const reconciliation = await reconcileStudioAutosaveWithOpfsPrimary({
      session: reloadSession,
      sqlite,
      storage: window.localStorage,
      key: documentKey,
    });
    await reloadSession.flush();
    await reloadSession.dispose();
    reloadSession = null;

    migrationReadSession = await createStudioAutosaveOpfsSession(
      documentKey,
      scope,
    );
    if (!migrationReadSession) {
      throw new Error("migration read native OPFS session selection returned null");
    }
    const afterFreshSessionRead = await migrationReadSession.readLatest();
    if (
      afterFreshSessionRead?.state !== "snapshot"
      || firstElementId(afterFreshSessionRead)
        !== "newer-sqlite-fallback-stroke"
    ) {
      throw new Error("newer SQLite fallback did not persist into OPFS");
    }
    const clearReceipt = await migrationReadSession.clear(clearSavedAt);
    await migrationReadSession.flush();
    await migrationReadSession.dispose();
    migrationReadSession = null;

    window.localStorage.setItem(
      documentKey,
      serializeStudioAutosave(checkpointPayload),
    );
    window.localStorage.setItem(
      sidecarKey,
      serializeStudioAutosave(migrationPayload),
    );
    clearReadSession = await createStudioAutosaveOpfsSession(documentKey, scope);
    if (!clearReadSession) {
      throw new Error("clear read native OPFS session selection returned null");
    }
    const afterClearFreshSessionRead = await clearReadSession.readLatest();
    const clearReconciliation = await reconcileStudioAutosaveWithOpfsPrimary({
      session: clearReadSession,
      sqlite,
      storage: window.localStorage,
      key: documentKey,
    });
    const stalePrimaryRemoved =
      window.localStorage.getItem(documentKey) === null;
    const staleSidecarRemoved =
      window.localStorage.getItem(sidecarKey) === null;
    const sqliteAfterClear = await sqlite.read(documentKey);
    await clearReadSession.dispose();
    clearReadSession = null;

    finalReadSession = await createStudioAutosaveOpfsSession(documentKey, scope);
    if (!finalReadSession) {
      throw new Error("final read native OPFS session selection returned null");
    }
    const finalFreshSessionRead = await finalReadSession.readLatest();
    await finalReadSession.dispose();
    finalReadSession = null;

    const filesAfterCheckpoint = phaseOne.filesAfterCheckpoint;
    const combinedTelemetry = {
      capabilities,
      getDirectoryCalls:
        Number(phaseOne.telemetry?.getDirectoryCalls ?? 0)
        + telemetry.getDirectoryCalls,
      estimateCalls:
        Number(phaseOne.telemetry?.estimateCalls ?? 0)
        + telemetry.estimateCalls,
      lockRequests: [
        ...(phaseOne.telemetry?.lockRequests ?? []),
        ...telemetry.lockRequests,
      ],
      expectedLockName,
      filesAfterCheckpoint,
      filesAfterCleanup: [],
    };
    const opfsDocumentRemoved = await removeUniqueDocument(journalDocumentId);
    const database = await acquireStudioLocalDatabase();
    await database.kvDelete(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, documentKey);
    const sqliteRowRemoved =
      await database.kvGet(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, documentKey) === null;
    await cleanupBrowserSlots(sidecarKey);
    window.sessionStorage.removeItem(phaseKey);
    combinedTelemetry.filesAfterCleanup =
      await uniqueDocumentFiles(journalDocumentId);
    cleanup = {
      opfsDocumentRemoved,
      sqliteRowRemoved,
      localStorageCleared:
        window.localStorage.getItem(documentKey) === null
        && window.localStorage.getItem(sidecarKey) === null,
      sessionStorageCleared:
        window.sessionStorage.getItem(phaseKey) === null,
    };

    const navigation = performance.getEntriesByType("navigation")[0];
    publish({
      status: "ok",
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "focused-vite-production-build-and-preview",
      document: {
        key: documentKey,
        journalDocumentId,
      },
      native: combinedTelemetry,
      checkpoint: {
        receipt: phaseOne.receipt,
        savedAt: phaseOne.savedAt,
        sqliteMirrorState: phaseOne.sqliteMirrorState,
        sqliteMirror: phaseOne.sqliteMirror,
        afterReload,
        pageReloadObserved: navigation?.type === "reload",
        navigationType: navigation?.type ?? null,
      },
      migration: {
        savedAt: migrationSavedAt,
        fallbackKind: reconciliation.candidate?.key === documentKey
          ? "sqlite-fallback"
          : "unexpected",
        reconciliation,
        afterFreshSessionRead,
      },
      clear: {
        savedAt: clearSavedAt,
        receipt: clearReceipt,
        afterFreshSessionRead: afterClearFreshSessionRead,
        reconciliation: clearReconciliation,
        stalePrimaryRemoved,
        staleSidecarRemoved,
        sqliteAfterClear,
        finalFreshSessionRead,
      },
      cleanup,
      securityPolicyViolations,
    });
  } finally {
    await Promise.allSettled([
      reloadSession?.dispose(),
      migrationReadSession?.dispose(),
      clearReadSession?.dispose(),
      finalReadSession?.dispose(),
    ].filter(Boolean));
    await closeStudioLocalDatabaseRuntime();
  }
}

run().catch(async error => {
  try {
    if (documentKey && phaseKey) {
      const digest = await sha256Hex(documentKey);
      const journalDocumentId = "autosave-" + digest.slice(0, 48);
      await removeUniqueDocument(journalDocumentId).catch(() => false);
      window.localStorage.removeItem(documentKey);
      window.localStorage.removeItem(
        studioLifecycleAutosaveSidecarKey(documentKey),
      );
      window.sessionStorage.removeItem(phaseKey);
      const database = await acquireStudioLocalDatabase().catch(() => null);
      await database?.kvDelete(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, documentKey);
      await closeStudioLocalDatabaseRuntime();
    }
  } finally {
    publish({
      status: "error",
      schemaVersion: REPORT_SCHEMA_VERSION,
      execution: "focused-vite-production-build-and-preview",
      error: errorShape(error),
      securityPolicyViolations,
    });
  }
});
`.trimStart();
}

export function createStudioAutosaveOpfsBrowserRunPlan(
  scratch: string,
): StudioAutosaveOpfsBrowserRunPlan {
  const sourceDirectory = join(scratch, "production-source");
  const distributionDirectory = join(scratch, "production-dist");
  return Object.freeze({
    scratch,
    sourceDirectory,
    distributionDirectory,
    browserHarness: join(sourceDirectory, "browser-harness.js"),
    htmlEntry: join(sourceDirectory, "index.html"),
    evidence: Object.freeze({
      browserResult: join(scratch, "browser-result.json"),
      diagnostics: join(scratch, "diagnostics.json"),
      productionBuild: join(scratch, "production-build.json"),
      observations: join(scratch, "observations.json"),
      summary: join(scratch, "summary.json"),
    }),
  });
}

function createHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>Studio autosave native OPFS boundary</title>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>Studio autosave native OPFS boundary</h1>",
    '<pre data-verifier-output>running</pre>',
    "</main>",
    '<script type="module" src="/browser-harness.js"></script>',
    "</body>",
    "</html>",
  ].join("");
}

function walkFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap(name => {
    const absolute = join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(absolute).isDirectory()
      ? walkFiles(absolute, relative)
      : [relative];
  }).sort();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function waitForBrowserResult(page: Page): Promise<unknown> {
  await page.waitForFunction(
    resultGlobal => (
      (window as unknown as Record<string, unknown>)[resultGlobal]
      !== undefined
    ),
    RESULT_GLOBAL,
    { timeout: RESULT_TIMEOUT_MS },
  );
  return page.evaluate(
    resultGlobal => (
      (window as unknown as Record<string, unknown>)[resultGlobal]
    ),
    RESULT_GLOBAL,
  );
}

function observePage(
  page: Page,
  browserVersion: string,
): StudioAutosaveOpfsBrowserDiagnostics {
  const diagnostics: {
    browserVersion: string;
    contentSecurityPolicy: string;
    consoleErrors: string[];
    consoleWarnings: string[];
    pageErrors: string[];
    requestFailures: string[];
    fiveHundredResponses: string[];
    cspViolations: Array<{ effectiveDirective: string; blockedUri: string }>;
    requests: Array<{ method: string; resourceType: string; url: string }>;
    responses: Array<{ status: number; url: string }>;
  } = {
    browserVersion,
    contentSecurityPolicy: "",
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    fiveHundredResponses: [],
    cspViolations: [],
    requests: [],
    responses: [],
  };
  page.on("console", message => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    if (message.type() === "warning") diagnostics.consoleWarnings.push(message.text());
  });
  page.on("pageerror", error => diagnostics.pageErrors.push(error.message));
  page.on("request", request => {
    diagnostics.requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  page.on("requestfailed", request => {
    diagnostics.requestFailures.push(
      `${request.method()} ${request.url()}: `
      + `${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  page.on("response", response => {
    diagnostics.responses.push({
      status: response.status(),
      url: response.url(),
    });
    if (response.status() >= 500) {
      diagnostics.fiveHundredResponses.push(
        `${response.status()} ${response.url()}`,
      );
    }
  });
  return diagnostics;
}

async function executeProductionBrowser(
  plan: StudioAutosaveOpfsBrowserRunPlan,
): Promise<Readonly<{
  result: unknown;
  diagnostics: StudioAutosaveOpfsBrowserDiagnostics;
  productionAssets: readonly string[];
  productionBuild: Readonly<Record<string, unknown>>;
}>> {
  const repositoryRoot = process.cwd();
  mkdirSync(plan.sourceDirectory, { recursive: true });
  mkdirSync(plan.distributionDirectory, { recursive: true });
  const viteSourceDirectory = realpathSync(plan.sourceDirectory);
  const viteDistributionDirectory = realpathSync(plan.distributionDirectory);
  const harnessSource = createStudioAutosaveOpfsBrowserHarnessSource(
    repositoryRoot,
  );
  writeFileSync(plan.browserHarness, harnessSource);
  writeFileSync(plan.htmlEntry, createHtml());

  await build({
    root: viteSourceDirectory,
    configFile: false,
    cacheDir: join(plan.scratch, "vite-cache"),
    clearScreen: false,
    logLevel: "error",
    base: "/",
    build: {
      outDir: viteDistributionDirectory,
      emptyOutDir: true,
      target: "es2022",
      minify: true,
      sourcemap: true,
      manifest: true,
    },
  });
  const productionAssets = walkFiles(plan.distributionDirectory);
  const productionBuild = Object.freeze({
    mode: "vite-production-build",
    sourceDirectory: plan.sourceDirectory,
    distributionDirectory: plan.distributionDirectory,
    assets: productionAssets,
    harnessSha256: createHash("sha256").update(harnessSource).digest("hex"),
    indexSha256: createHash("sha256")
      .update(readFileSync(join(plan.distributionDirectory, "index.html")))
      .digest("hex"),
  });
  writeJson(plan.evidence.productionBuild, productionBuild);

  const port = await findFreePort({
    unavailableMessage: "could not allocate a Studio autosave OPFS verifier port",
  });
  const origin = `http://127.0.0.1:${port}`;
  let previewServer: PreviewServer | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    previewServer = await preview({
      root: viteSourceDirectory,
      configFile: false,
      clearScreen: false,
      logLevel: "error",
      build: {
        outDir: viteDistributionDirectory,
      },
      preview: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        headers: {
          "Content-Security-Policy": CSP,
          "Cache-Control": "no-store",
        },
      },
    });
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = observePage(page, browser.version());

    const runId = randomUUID();
    const documentKey =
      `toonspectrum-studio-autosave:v2:browser-opfs-${runId}`;
    const url = new URL("/", origin);
    url.searchParams.set("documentKey", documentKey);
    url.searchParams.set("runId", runId);
    url.searchParams.set("baseEpoch", String(Date.now()));
    const navigation = await page.goto(url.href, {
      waitUntil: "load",
      timeout: 30_000,
    });
    (
      diagnostics as { contentSecurityPolicy: string }
    ).contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    const firstResult = record(await waitForBrowserResult(page));
    if (firstResult?.status === "reload-required") {
      await page.reload({ waitUntil: "load", timeout: 30_000 });
    }
    const result = firstResult?.status === "reload-required"
      ? await waitForBrowserResult(page)
      : firstResult;
    return Object.freeze({
      result,
      diagnostics,
      productionAssets,
      productionBuild,
    });
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await previewServer?.close().catch(() => undefined);
  }
}

export async function runStudioAutosaveOpfsBrowserVerifier(): Promise<void> {
  const scratch =
    process.env.TOONSPECTRUM_AUTOSAVE_OPFS_VERIFY_DIR
    ?? process.env.TOONSPECTRUM_VERIFY_DIR
    ?? join(
      tmpdir(),
      `toonspectrum-studio-autosave-opfs-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
  const plan = createStudioAutosaveOpfsBrowserRunPlan(scratch);
  mkdirSync(plan.scratch, { recursive: true });

  try {
    const execution = await executeProductionBrowser(plan);
    writeJson(plan.evidence.browserResult, execution.result);
    writeJson(plan.evidence.diagnostics, execution.diagnostics);
    const result = record(execution.result);
    if (result?.status === "unsupported") {
      const summary = {
        status: "skipped",
        skipKind: "environment-unsupported",
        reason: result.reason,
        capabilities: result.capabilities,
        artifactDirectory: plan.scratch,
      };
      writeJson(plan.evidence.summary, summary);
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    const issues = validateStudioAutosaveOpfsBrowserResult(
      execution.result,
      execution.diagnostics,
      execution.productionAssets,
    );
    const observations = {
      status: issues.length === 0 ? "observed" : "observed-with-failures",
      artifactDirectory: plan.scratch,
      productionBuild: execution.productionBuild,
      browserResult: execution.result,
      diagnostics: execution.diagnostics,
      issues,
    };
    writeJson(plan.evidence.observations, observations);
    if (issues.length > 0) {
      throw new Error(issues.join("\n"));
    }
    const summary = {
      status: "ok",
      artifactDirectory: plan.scratch,
      gates: {
        focusedViteProductionBundle: true,
        nativeNavigatorStorageGetDirectory: true,
        nativeOriginWideWebLocks: true,
        checkpointSurvivesPageReload: true,
        sqliteMirrorSurvivesPageReload: true,
        newerSqliteFallbackMigratesToOpfs: true,
        durableClearTombstoneWins: true,
        uniqueDocumentCleanup: true,
        zeroConsoleErrors: true,
        zeroPageErrors: true,
        zeroRequestFailures: true,
        zeroFiveHundredResponses: true,
        zeroCspViolations: true,
      },
      evidence: plan.evidence,
    };
    writeJson(plan.evidence.summary, summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const failure = {
      status: "failed",
      message: error instanceof Error ? error.stack ?? error.message : String(error),
      artifactDirectory: plan.scratch,
      evidence: plan.evidence,
    };
    writeJson(join(plan.scratch, "failure.json"), failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runStudioAutosaveOpfsBrowserVerifier();
}
