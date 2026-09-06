import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePostgresIntegrationUrl } from "./run-postgres-integration-tests.mjs";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const API_ROOT = resolve(REPOSITORY_ROOT, "apps/api");
const TEST_DATABASE_NAME_PATTERN = /(?:^|[_-])(?:test|qa)(?:$|[_-])/iu;
const ISOLATED_API_HOST = "127.0.0.1";
const API_START_TIMEOUT_MS = 30_000;
const PROCESS_TERMINATION_GRACE_MS = 5_000;
const PROCESS_FORCE_KILL_WAIT_MS = 5_000;
const PROCESS_EXIT_POLL_INTERVAL_MS = 25;
const SAFE_PARENT_ENV_KEYS = Object.freeze([
  "CI",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_COLOR",
  "PATH",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
]);

/**
 * @typedef {Readonly<{
 *   apiOrigin: string,
 *   apiHost: string,
 *   apiPort: number,
 *   databaseName?: string,
 *   databaseUrl: string,
 * }>} IsolatedMarketApiTarget
 */

function fail(message) {
  throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function childIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function isMissingProcessError(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function isPermissionDeniedProcessError(error) {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

function validProcessId(child) {
  return Number.isSafeInteger(child.pid) && child.pid > 1 ? child.pid : null;
}

function processTreeIsRunning(child) {
  const pid = validProcessId(child);
  if (process.platform === "win32" || pid === null) return childIsRunning(child);

  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) return false;
    // A process group that exists but cannot be signalled is still running. The eventual TERM/KILL
    // call will surface the permission failure instead of letting cleanup claim success.
    if (isPermissionDeniedProcessError(error)) return true;
    throw error;
  }
}

function signalProcessTree(child, signal) {
  const pid = validProcessId(child);
  try {
    if (process.platform !== "win32" && pid !== null) {
      process.kill(-pid, signal);
      return true;
    }
    if (!childIsRunning(child)) return false;
    return child.kill(signal);
  } catch (error) {
    if (isMissingProcessError(error)) return false;
    throw error;
  }
}

async function waitForProcessTreeExit(child, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (processTreeIsRunning(child)) {
    if (Date.now() >= deadline) return false;
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  return true;
}

/**
 * Stops a child started with `detached: true` and every descendant that stayed in its POSIX
 * process group. Windows falls back to the direct ChildProcess because Node does not expose an
 * equivalent negative-PID group signal there.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {{
 *   terminationGraceMs?: number,
 *   forceKillWaitMs?: number,
 *   pollIntervalMs?: number,
 * }} [options]
 */
export async function stopDetachedProcessTree(child, options = {}) {
  const terminationGraceMs = options.terminationGraceMs ?? PROCESS_TERMINATION_GRACE_MS;
  const forceKillWaitMs = options.forceKillWaitMs ?? PROCESS_FORCE_KILL_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? PROCESS_EXIT_POLL_INTERVAL_MS;

  if (!processTreeIsRunning(child)) return;
  signalProcessTree(child, "SIGTERM");
  if (await waitForProcessTreeExit(child, terminationGraceMs, pollIntervalMs)) return;

  signalProcessTree(child, "SIGKILL");
  if (await waitForProcessTreeExit(child, forceKillWaitMs, pollIntervalMs)) return;
  throw new Error("The detached child process group did not exit after SIGKILL.");
}

export function validateIsolatedMarketApiTarget({
  rawApiUrl,
  rawDatabaseUrl,
  environment = process.env,
}) {
  const databaseUrl = rawDatabaseUrl?.trim();
  const database = validatePostgresIntegrationUrl(databaseUrl, { environment });
  if (!database.loopback || !TEST_DATABASE_NAME_PATTERN.test(database.databaseName)) {
    fail("The marketplace gate requires a loopback database with a test- or QA-scoped name.");
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawApiUrl);
  } catch {
    fail("The marketplace API URL is malformed.");
  }
  if (
    apiUrl.protocol !== "http:"
    || apiUrl.hostname !== ISOLATED_API_HOST
    || apiUrl.username
    || apiUrl.password
    || apiUrl.pathname !== "/"
    || apiUrl.search
    || apiUrl.hash
  ) {
    fail("The marketplace API must be an unauthenticated 127.0.0.1 HTTP origin.");
  }

  const apiPort = Number(apiUrl.port);
  if (!Number.isInteger(apiPort) || apiPort < 1_024 || apiPort > 65_535) {
    fail("The marketplace API URL must include an explicit unprivileged port.");
  }

  return Object.freeze({
    apiOrigin: apiUrl.origin,
    apiHost: ISOLATED_API_HOST,
    apiPort,
    databaseName: database.databaseName,
    databaseUrl,
  });
}

export async function requireUnusedApiTarget(target) {
  const host = new URL(target.apiOrigin).hostname.replace(/(?:^\[|\]$)/gu, "");
  await new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection({ host, port: target.apiPort });
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setTimeout(1_000);
    socket.once("connect", () => {
      finish(
        rejectPromise,
        new Error(
          "The opted-in API origin is already in use. Choose an unused loopback port for the isolated API.",
        ),
      );
    });
    socket.once("timeout", () => {
      finish(
        rejectPromise,
        new Error("Could not prove that the isolated marketplace API port is unused."),
      );
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        finish(resolvePromise);
        return;
      }
      finish(
        rejectPromise,
        new Error("Could not prove that the isolated marketplace API port is unused.", {
          cause: error,
        }),
      );
    });
  });
}

export function createIsolatedMarketApiEnvironment(
  target,
  environment = process.env,
) {
  const safeEnvironment = Object.fromEntries(
    SAFE_PARENT_ENV_KEYS.flatMap((key) =>
      typeof environment[key] === "string" ? [[key, environment[key]]] : []),
  );
  return {
    ...safeEnvironment,
    API_LOCAL_ENV_FILE_ENABLED: "false",
    API_RUNTIME_ROLE: "full",
    AUTH_SESSION_SECRET: "toonspectrum-isolated-market-qa-session-v1",
    AUTH_DISTRIBUTED_RATE_LIMIT_ENABLED: "false",
    AUTH_RATE_LIMIT_MODE: "single-instance-local",
    BACKEND_CAPABILITY_WORKER_ENABLED: "false",
    BACKEND_DISTRIBUTION_ENABLED: "false",
    CATALOG_INGEST_MODE: "off",
    CREATOR_IMAGE_AI_ENABLED: "false",
    DATABASE_URL: target.databaseUrl,
    KMAS_LIVE_SEARCH: "0",
    KMAS_MERGE_ON_ACCESS: "0",
    NEST_API_HOST: target.apiHost,
    NEST_API_PORT: String(target.apiPort),
    NODE_ENV: "test",
    PORT: String(target.apiPort),
    STUDIO_LIVE_CLUSTER_ADAPTER: "memory",
    STUDIO_LIVE_POSTGRES_INLINE_BINARY_ENABLED: "false",
    STUDIO_LIVE_VOICE_ENABLED: "false",
    STUDIO_REALTIME_REVOCATION_ENABLED: "false",
    STUDIO_REALTIME_TICKET_ENABLED: "false",
    SUPABASE_OBJECT_STORAGE_ENABLED: "false",
    TEST_DATABASE_URL: target.databaseUrl,
    UPSTASH_COORDINATION_ENABLED: "false",
  };
}

async function requireRunningApi(apiOrigin, child) {
  const deadline = Date.now() + API_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!childIsRunning(child)) {
      fail("The isolated marketplace API exited before becoming live.");
    }

    try {
      const response = await fetch(`${apiOrigin}/api/health/live`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok && childIsRunning(child)) return;
    } catch {
      // The child may still be binding its verified loopback port.
    }
    await delay(250);
  }

  fail("The isolated marketplace API did not become live in time.");
}

/**
 * @param {IsolatedMarketApiTarget} target
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   onSpawn?: (child: import("node:child_process").ChildProcess) => void,
 * }} [options]
 */
export async function startIsolatedMarketApi(target, options = {}) {
  const { environment = process.env, onSpawn } = options;
  await requireUnusedApiTarget(target);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/main.ts"],
    {
      cwd: API_ROOT,
      detached: process.platform !== "win32",
      env: createIsolatedMarketApiEnvironment(target, environment),
      stdio: "inherit",
    },
  );

  try {
    onSpawn?.(child);
    await requireRunningApi(target.apiOrigin, child);
    return child;
  } catch (error) {
    await stopIsolatedMarketApi(child);
    throw error;
  }
}

export async function stopIsolatedMarketApi(child) {
  await stopDetachedProcessTree(child);
}
