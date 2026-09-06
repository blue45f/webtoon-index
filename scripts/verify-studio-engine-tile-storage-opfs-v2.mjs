/**
 * Real Chromium Dedicated Worker verifier for the OPFS v2 shard backend.
 *
 * Run:
 *   pnpm exec node scripts/verify-studio-engine-tile-storage-opfs-v2.mjs
 *
 * Optional evidence directory:
 *   TOONSPECTRUM_OPFS_V2_VERIFY_DIR=/tmp/opfs-v2 \
 *     pnpm exec node scripts/verify-studio-engine-tile-storage-opfs-v2.mjs
 *
 * Exit codes:
 *   0 = native OPFS sync-access, restart, lock and recovery gates passed
 *   1 = browser/runtime/durability/diagnostic failure
 *   2 = structured environment skip because native OPFS sync-access is unavailable
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

import { WEB_ROOT } from "./lib/repo-paths.mjs";

const SCRATCH =
  process.env.TOONSPECTRUM_OPFS_V2_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), `toonspectrum-opfs-v2-${Date.now()}`);
const HARNESS_PATH = "/__studio_engine_tile_storage_opfs_v2__";
const HARNESS_ENTRY =
  "/scripts/studio-engine-tile-storage-opfs-v2-browser.ts";
const WORKER_ENTRY_FRAGMENT =
  "studio-engine-tile-storage-opfs-v2-worker-browser.ts";
const RESULT_TIMEOUT_MS = 120_000;
const CSP =
  "default-src 'none'; "
  + "script-src 'self'; "
  + "worker-src 'self'; "
  + "connect-src 'self'; "
  + "img-src 'none'; "
  + "style-src 'none'; "
  + "font-src 'none'; "
  + "object-src 'none'; "
  + "base-uri 'none'; "
  + "frame-ancestors 'none'";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate an OPFS v2 harness port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function writeJson(fileName, value) {
  writeFileSync(
    join(SCRATCH, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function zeroFallback(fallback) {
  return (
    fallback?.createWritableCalls === 0
    && fallback?.indexedDbAccesses === 0
    && fallback?.memoryFallbackFactoryCalls === 0
  );
}

function validateSuccess(result, diagnostics) { // NOSONAR javascript:S3776
  const failures = [];
  const main = result.main;
  if (
    result.backend !== "opfs-sync-shards-v2"
    || main?.provider?.kind
      !== "real-chromium-dedicated-worker-opfs-sync-access"
    || !same(main?.provider?.logicalFiles, ["document", "wal", "markers"])
  ) {
    failures.push("the production OPFS v2 backend/provider identity is missing");
  }
  if (
    main?.capabilities?.navigatorStorageGetDirectory !== true
    || main?.capabilities?.fileSystemSyncAccessHandle !== true
    || main?.capabilities?.dedicatedWorker !== true
    || main?.nativeCalls?.getDirectoryCalls < 1
    || main?.nativeCalls?.createSyncAccessHandleCalls < 1
  ) {
    failures.push(
      "native navigator.storage.getDirectory/createSyncAccessHandle was not observed",
    );
  }
  if (
    main?.nativeCalls?.createWritableCalls !== 0
    || main?.nativeCalls?.indexedDbAccesses !== 0
    || main?.nativeCalls?.memoryFallbackFactoryCalls !== 0
  ) {
    failures.push("the supported path touched a forbidden persistence fallback");
  }

  const direct = main?.direct;
  if (
    direct?.initial?.documentLength !== "69"
    || direct?.initial?.walLength !== "6"
    || direct?.initial?.markerLength !== "36"
    || !same(direct?.initial?.documentShard0, [1, 2, 3, 4, 5, 6])
    || !same(direct?.initial?.documentShard1Hole, new Array(32).fill(0))
    || !same(direct?.initial?.documentShard2, [0, 0, 0, 7, 8])
    || !same(direct?.initial?.wal, [11, 12, 13, 14])
    || !same(direct?.initial?.markers, [0, 21, 22, 23])
    || !same(direct?.truncatedHole, [0, 0, 0])
  ) {
    failures.push("native document/WAL/marker write-read-flush evidence drifted");
  }
  if (
    direct?.afterReopen?.documentLength !== "35"
    || direct?.afterReopen?.walLength !== "6"
    || direct?.afterReopen?.markerLength !== "36"
    || !same(direct?.afterReopen?.documentShard0, [1, 2, 3, 4, 5, 6])
    || !same(direct?.afterReopen?.documentShard1, [0, 0, 0])
    || !same(direct?.afterReopen?.wal, [11, 12, 13, 14])
    || !same(direct?.afterReopen?.markers, [0, 21, 22, 23])
  ) {
    failures.push("truncate/close/reopen did not preserve exact native OPFS bytes");
  }

  const recovery = main?.recovery;
  if (
    recovery?.initialOpen?.status !== "ready"
    || recovery?.initialOpen?.frontier?.durableRevision !== 0
    || recovery?.committed?.complete !== true
    || recovery?.committed?.disposition !== "committed"
    || recovery?.committed?.durableRevision !== 1
    || recovery?.reopened?.status !== "ready"
    || recovery?.reopened?.frontier?.durableRevision !== 1
    || recovery?.reopened?.frontier?.transactionSequence !== 1
    || recovery?.replay?.disposition !== "idempotent-replay"
    || recovery?.replay?.durableRevision !== 1
  ) {
    failures.push("v2 worker durable commit/reopen/idempotent recovery is incomplete");
  }

  const lifecycle = main?.lifecycle;
  if (
    lifecycle?.abortError?.code !== "aborted"
    || lifecycle?.syncAccessHandleDeltaDuringPreAbort !== 0
    || lifecycle?.sameClosePromise !== true
    || lifecycle?.disposedError?.code !== "backend-closed"
  ) {
    failures.push("abort/dispose/idempotent-close evidence is incomplete");
  }
  if (
    main?.unsupported?.error?.code !== "opfs-unavailable"
    || !zeroFallback(main?.unsupported?.fallback)
  ) {
    failures.push("the unsupported path did not fail closed with zero fallback");
  }

  const lock = result.exclusiveLock;
  if (
    lock?.whileHeld?.acquired !== false
    || lock?.whileHeld?.error?.code !== "open-failed"
    || lock?.whileHeld?.nativeCalls?.createSyncAccessHandleCalls < 1
    || lock?.afterClose?.acquired !== true
    || lock?.afterClose?.logicalByteLength !== "1"
    || !same(lock?.afterClose?.bytes, [77])
  ) {
    failures.push(
      "native sync-access exclusive-lock collision or close/reacquire failed",
    );
  }

  const crash = result.crashRecovery;
  if (
    crash?.afterWorkerTermination?.status !== "ready"
    || crash?.afterWorkerTermination?.recoveredTransactions !== 1
    || crash?.afterWorkerTermination?.frontier?.durableRevision !== 1
    || crash?.afterCommitMarkerRestart?.status !== "ready"
    || crash?.afterCommitMarkerRestart?.recoveredTransactions !== 0
    || crash?.afterCommitMarkerRestart?.frontier?.durableRevision !== 1
    || crash?.replay?.disposition !== "idempotent-replay"
    || crash?.nativeCalls?.createSyncAccessHandleCalls < 1
  ) {
    failures.push(
      "post-WAL Worker termination did not recover and persist a commit marker",
    );
  }
  if (
    crash?.browserProcessCrash?.status !== "not-automated"
    || typeof crash?.browserProcessCrash?.reason !== "string"
    || crash.browserProcessCrash.reason.length < 40
  ) {
    failures.push("the full Chromium process-kill limitation was not explicit");
  }

  if (
    !Array.isArray(result.workers)
    || result.workers.length < 6
    || result.workers.some(worker => (
      worker.terminated !== true
      || worker.errors.length > 0
      || worker.messageErrors.length > 0
      || worker.unsolicitedFailures.length > 0
      || worker.outboundCommands < 1
      || worker.inboundMessages < 1
    ))
  ) {
    failures.push("one or more real module Workers had lifecycle/message errors");
  }
  if (
    result.securityPolicyViolations?.length > 0
    || result.pageErrors?.length > 0
    || result.unhandledRejections?.length > 0
  ) {
    failures.push("page/Worker harness reported an error or CSP violation");
  }
  if (
    diagnostics.consoleErrors.length > 0
    || diagnostics.pageErrors.length > 0
    || diagnostics.requestFailures.length > 0
    || diagnostics.cspViolations.length > 0
  ) {
    failures.push("Playwright observed console/page/request/CSP errors");
  }
  if (
    !diagnostics.contentSecurityPolicy.includes("script-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("worker-src 'self'")
    || !diagnostics.contentSecurityPolicy.includes("connect-src 'self'")
  ) {
    failures.push("the browser harness CSP does not explicitly isolate Workers");
  }
  if (
    diagnostics.workerUrls.length < 6
    || !diagnostics.workerUrls.every(url => (
      url.includes(WORKER_ENTRY_FRAGMENT)
    ))
    || !diagnostics.responses.some(response => (
      response.url.includes(WORKER_ENTRY_FRAGMENT)
      && response.status >= 200
      && response.status < 300
    ))
  ) {
    failures.push("real module Worker requests were not observed");
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

async function main() { // NOSONAR javascript:S3776
  mkdirSync(SCRATCH, { recursive: true });
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}/`;
  const viteServer = await createViteServer({
    root: WEB_ROOT,
    appType: "custom",
    clearScreen: false,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: false,
    },
    plugins: [{
      name: "studio-engine-opfs-v2-browser-harness",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? "/", origin);
          if (url.pathname !== HARNESS_PATH) {
            next();
            return;
          }
          try {
            const html = await server.transformIndexHtml(
              HARNESS_PATH,
              [
                "<!doctype html>",
                '<html lang="en">',
                "<head>",
                '<meta charset="UTF-8">',
                "<title>Studio OPFS v2 Dedicated Worker boundary</title>",
                "</head>",
                "<body>",
                `<script type="module" src="${HARNESS_ENTRY}"></script>`,
                "</body>",
                "</html>",
              ].join(""),
            );
            response.statusCode = 200;
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.setHeader("content-security-policy", CSP);
            response.setHeader("cache-control", "no-store");
            response.end(html);
          } catch (error) {
            next(error);
          }
        });
      },
    }],
  });
  await viteServer.listen();

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = {
      browserVersion: browser.version(),
      contentSecurityPolicy: "",
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      requestFailures: [],
      requests: [],
      responses: [],
      workerUrls: [],
      cspViolations: [],
    };
    page.on("console", message => {
      if (message.type() === "error") {
        diagnostics.consoleErrors.push(message.text());
      }
      if (message.type() === "warning") {
        diagnostics.consoleWarnings.push(message.text());
      }
    });
    page.on("pageerror", error => diagnostics.pageErrors.push(error.message));
    page.on("request", request => {
      diagnostics.requests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
    });
    page.on("response", response => {
      diagnostics.responses.push({
        status: response.status(),
        url: response.url(),
      });
    });
    page.on("requestfailed", request => {
      diagnostics.requestFailures.push(
        `${request.method()} ${request.url()}: `
        + `${request.failure()?.errorText ?? "unknown"}`,
      );
    });
    page.on("worker", worker => diagnostics.workerUrls.push(worker.url()));

    await page.exposeFunction(
      "__recordStudioOpfsV2CspViolation",
      violation => diagnostics.cspViolations.push(violation),
    );
    await page.addInitScript(() => {
      window.addEventListener("securitypolicyviolation", event => {
        window.__recordStudioOpfsV2CspViolation?.({
          effectiveDirective: event.effectiveDirective,
          blockedUri: event.blockedURI,
        });
      });
    });
    const navigation = await page.goto(`${origin}${HARNESS_PATH.slice(1)}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    diagnostics.contentSecurityPolicy =
      (await navigation?.headerValue("content-security-policy")) ?? "";
    await page.waitForFunction(
      () => window.__studioEngineTileStorageOpfsV2Result !== undefined,
      undefined,
      { timeout: RESULT_TIMEOUT_MS },
    );
    const result = await page.evaluate(
      () => window.__studioEngineTileStorageOpfsV2Result,
    );
    await context.close();

    invariant(result && typeof result === "object", "browser returned no result");
    writeJson("browser-result.json", result);
    if (result.status === "unsupported") {
      const summary = {
        status: "skipped",
        skipKind: "environment-unsupported",
        reason: result.reason,
        message: result.message,
        diagnostics,
        artifactDirectory: SCRATCH,
      };
      writeJson("summary.json", summary);
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 2;
      return;
    }
    invariant(
      result.status === "ok",
      `browser harness failed: ${
        result.status === "error" ? result.stack ?? result.message : "unknown"
      }`,
    );
    const rawObservations = {
      status: "observed-unvalidated",
      backend: result.backend,
      main: result.main,
      exclusiveLock: result.exclusiveLock,
      crashRecovery: result.crashRecovery,
      workers: result.workers,
      securityPolicyViolations: result.securityPolicyViolations,
      pageErrors: result.pageErrors,
      unhandledRejections: result.unhandledRejections,
      diagnostics,
      artifactDirectory: SCRATCH,
    };
    writeJson("observations.json", rawObservations);
    validateSuccess(result, diagnostics);
    const observations = {
      ...rawObservations,
      status: "observed",
      gates: {
        nativeNavigatorStorageGetDirectory: true,
        nativeCreateSyncAccessHandle: true,
        allThreeLogicalFiles: true,
        deterministicFlush: true,
        crossShardTruncate: true,
        closeReopenRecovery: true,
        exclusiveLockCollision: true,
        closeThenReacquire: true,
        abortFailClosed: true,
        disposeFailClosed: true,
        unsupportedFallbackCalls: 0,
        workerTerminationAfterWalFlushRecovered: true,
        commitMarkerRestartObserved: true,
        fullBrowserProcessKillAutomated: false,
        zeroConsoleErrors: true,
        zeroPageErrors: true,
        zeroRequestFailures: true,
        zeroCspViolations: true,
      },
    };
    writeJson("observations.json", observations);
    const summary = { ...observations, status: "ok" };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await viteServer.close().catch(() => undefined);
  }
}

main().catch(error => {
  const summary = {
    status: "failed",
    message: error instanceof Error ? error.stack ?? error.message : String(error),
    artifactDirectory: SCRATCH,
  };
  try {
    mkdirSync(SCRATCH, { recursive: true });
    writeJson("failure.json", summary);
  } catch {
    // Preserve the original verifier failure.
  }
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
});
