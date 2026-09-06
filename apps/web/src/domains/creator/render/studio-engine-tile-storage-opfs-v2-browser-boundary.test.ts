import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const workerEntry = readFileSync(
  resolve(
    root,
    "scripts/studio-engine-tile-storage-opfs-v2-worker-browser.ts",
  ),
  "utf8",
);
const browserEntry = readFileSync(
  resolve(root, "scripts/studio-engine-tile-storage-opfs-v2-browser.ts"),
  "utf8",
);
const verifier = readFileSync(
  resolve(root, "scripts/verify-studio-engine-tile-storage-opfs-v2.mjs"),
  "utf8",
);

describe("Studio engine OPFS v2 real Chromium boundary", () => {
  it("uses the production OPFS backend and v2 storage authority in a module Worker", () => {
    expect(workerEntry).toContain(
      "createStudioEngineTileStorageOpfsV2Backend",
    );
    expect(workerEntry).toContain("new StudioEngineTileStorageWorkerV2");
    expect(workerEntry).toContain("navigator.storage.getDirectory()");
    expect(workerEntry).toContain("file.createSyncAccessHandle()");
    expect(browserEntry).toContain("new Worker(WORKER_URL");
    expect(browserEntry).toContain('type: "module"');
    expect(verifier).toContain(
      'const HARNESS_ENTRY =\n  "/scripts/studio-engine-tile-storage-opfs-v2-browser.ts";',
    );
    expect(verifier).toContain('appType: "custom"');
  });

  it("covers document, WAL and marker native I/O plus truncate and restart", () => {
    for (const file of ["document", "wal", "markers"]) {
      expect(workerEntry).toContain(`"${file}"`);
    }
    expect(workerEntry).toContain("directIoScenario");
    expect(workerEntry).toContain("await first.flush");
    expect(workerEntry).toContain("await first.truncate");
    expect(workerEntry).toContain("const reopened = await createBackend");
    expect(verifier).toContain(
      "native document/WAL/marker write-read-flush evidence drifted",
    );
    expect(verifier).toContain(
      "truncate/close/reopen did not preserve exact native OPFS bytes",
    );
  });

  it("requires durable commit recovery and idempotent replay through the real adapter", () => {
    expect(workerEntry).toContain("durableRecoveryScenario");
    expect(workerEntry).toContain("commitRequest(documentId");
    expect(workerEntry).toContain("await reopenedWorker.open");
    expect(verifier).toContain('"idempotent-replay"');
    expect(verifier).toContain(
      "v2 worker durable commit/reopen/idempotent recovery is incomplete",
    );
  });

  it("proves exclusive-lock conflict, close/reacquire, abort and disposal", () => {
    expect(browserEntry).toContain('"hold-lock"');
    expect(browserEntry).toContain('"probe-lock"');
    expect(browserEntry).toContain('"release-lock"');
    expect(workerEntry).toContain("syncAccessHandleDeltaDuringPreAbort");
    expect(workerEntry).toContain("sameClosePromise");
    expect(verifier).toContain('"backend-closed"');
    expect(verifier).toContain("exclusive-lock collision or close/reacquire");
    expect(verifier).toContain("abort/dispose/idempotent-close");
  });

  it("terminates a Worker after WAL flush and verifies marker completion after restart", () => {
    expect(workerEntry).toContain('"after-wal-flush"');
    expect(browserEntry).toContain('"wal-flushed"');
    expect(browserEntry).toContain("terminate(crashWriter.worker");
    expect(workerEntry).toContain("afterWorkerTermination");
    expect(workerEntry).toContain("afterCommitMarkerRestart");
    expect(verifier).toContain(
      "post-WAL Worker termination did not recover and persist a commit marker",
    );
    expect(workerEntry).toContain('status: "not-automated"');
    expect(verifier).toContain("fullBrowserProcessKillAutomated: false");
  });

  it("forbids writable-stream, IndexedDB and memory fallback behavior", () => {
    expect(workerEntry).toContain("createWritableCalls");
    expect(workerEntry).toContain("indexedDbAccesses");
    expect(workerEntry).toContain("memoryFallbackFactoryCalls");
    expect(workerEntry).toContain("unsupportedWorkerScope");
    expect(verifier).toContain("unsupportedFallbackCalls: 0");
    expect(verifier).toContain(
      "unsupported path did not fail closed with zero fallback",
    );
    expect(workerEntry).not.toContain("createStudioOpfsMemory");
    expect(workerEntry).not.toContain("indexedDB.open");
  });

  it("enforces a Worker CSP and rejects every browser diagnostic error channel", () => {
    expect(verifier).toContain("script-src 'self'");
    expect(verifier).toContain("worker-src 'self'");
    expect(verifier).toContain("connect-src 'self'");
    expect(browserEntry).toContain('addEventListener("error"');
    expect(browserEntry).toContain('addEventListener("unhandledrejection"');
    expect(browserEntry).toContain(
      'addEventListener("securitypolicyviolation"',
    );
    expect(workerEntry).toContain('addEventListener("messageerror"');
    expect(workerEntry).toContain(
      'addEventListener("securitypolicyviolation"',
    );
    expect(verifier).toContain('page.on("console"');
    expect(verifier).toContain('page.on("pageerror"');
    expect(verifier).toContain('page.on("requestfailed"');
    expect(verifier).toContain('page.on("worker"');
    expect(verifier).toContain("zeroConsoleErrors: true");
    expect(verifier).toContain("zeroRequestFailures: true");
    expect(verifier).toContain("zeroCspViolations: true");
  });

  it("persists structured browser evidence and distinguishes unsupported environments", () => {
    expect(verifier).toContain('writeJson("browser-result.json"');
    expect(verifier).toContain('writeJson("observations.json"');
    expect(verifier).toContain('writeJson("summary.json"');
    expect(verifier).toContain("process.exitCode = 2");
    expect(verifier).toContain("TOONSPECTRUM_OPFS_V2_VERIFY_DIR");
  });
});
