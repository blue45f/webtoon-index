#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { validateRuntimeDatabaseRole } from "./run-production-database-migrations.mjs";

const { Pool } = pg;
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const require = createRequire(import.meta.url);
const VITEST_ENTRYPOINT = resolve(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const TSX_ENTRYPOINT = require.resolve("tsx/cli");
const CREATOR_MARKETPLACE_DB_VERIFIER =
  "scripts/verify-creator-marketplace-db.mts";

export const POSTGRES_INTEGRATION_SUITES = Object.freeze([
  "scripts/bootstrap-runtime-login-gate.integration.test.mjs",
  "apps/web/src/shared/lib/__tests__/oauth-runtime.integration.test.ts",
  "apps/api/src/modules/health/health-readiness.repository.integration.test.ts",
  "apps/api/src/modules/studio-ai/studio-ai-admission.repository.integration.test.ts",
  "apps/api/src/modules/creator/creator-asset-schema-preflight.integration.test.ts",
  "apps/api/src/modules/creator/creator-asset-runtime.integration.test.ts",
  "apps/api/src/modules/creator/studio-team-comment-reanchor-migration.integration.test.ts",
  "apps/api/src/realtime/studio-postgres-io.adapter.integration.test.ts",
  "apps/api/src/modules/creator/studio-live-lock.repository.integration.test.ts",
  "apps/api/src/modules/creator/studio-work-asset.repository.integration.test.ts",
]);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const AUTHORITY_OVERRIDE_PARAMETERS = new Set([
  "database",
  "dbname",
  "host",
  "hostaddr",
  "options",
  "password",
  "passfile",
  "port",
  "service",
  "user",
]);
const ALLOWED_CONNECTION_PARAMETERS = new Set([
  "channel_binding",
  "sslmode",
]);
const REMOTE_TEST_DATABASE_PATTERN =
  /(?:^|[_-])(?:ci|integration|preview|staging|test|testing)(?:$|[_-])/iu;

// Root Vitest imports application modules which require DATABASE_URL even when a
// DB-backed assertion is going to skip. Point the default at a deliberately
// unreachable loopback endpoint instead of inheriting a developer's production
// URL from .env.local. An explicit TEST_DATABASE_URL remains the only supported
// way to opt the root suite into a remote disposable test database.
export const VITEST_UNAVAILABLE_DATABASE_URL =
  "postgresql://toonspectrum_test:unavailable@127.0.0.1:1/toonspectrum_test";
export const VITEST_VALIDATED_REMOTE_DATABASE_MARKER =
  "TOONSPECTRUM_VITEST_REMOTE_DATABASE_VALIDATED";

export const POSTGRES_INTEGRATION_USAGE = [
  "Usage:",
  "  TEST_DATABASE_URL='postgresql://…' TEST_RUNTIME_DATABASE_ROLE='<role>' pnpm test:postgres:integration",
  "  pnpm test:postgres:integration -- --database-url 'postgresql://…' --runtime-database-role '<role>'",
  "",
  "The owner test connection must be able to SET ROLE to the non-owning runtime role.",
  "The default policy accepts only localhost, 127.0.0.1, or ::1.",
  "A disposable remote database additionally requires --allow-remote-test-database",
  "and a database name containing test, testing, ci, integration, preview, or staging.",
].join("\n");

function fail(message) {
  throw new Error(message);
}

function isProductionRuntime(environment) {
  return (
    environment.NODE_ENV?.trim().toLowerCase() === "production" ||
    environment.VERCEL_ENV?.trim().toLowerCase() === "production" ||
    environment.VERCEL_TARGET_ENV?.trim().toLowerCase() === "production" ||
    environment.CONTEXT?.trim().toLowerCase() === "production" ||
    Boolean(environment.RENDER_SERVICE_ID?.trim())
  );
}

export function parsePostgresIntegrationArguments(arguments_) { // NOSONAR javascript:S3776
  let allowRemoteTestDatabase = false;
  let databaseUrl;
  let help = false;
  let runtimeDatabaseRole;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--" && index === 0) {
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--allow-remote-test-database") {
      if (allowRemoteTestDatabase) {
        fail("--allow-remote-test-database must not be repeated.");
      }
      allowRemoteTestDatabase = true;
      continue;
    }
    if (argument === "--database-url") {
      if (databaseUrl !== undefined) {
        fail("--database-url must be supplied exactly once.");
      }
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        fail("--database-url requires a value.");
      }
      databaseUrl = value.trim();
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument?.startsWith("--database-url=")) {
      if (databaseUrl !== undefined) {
        fail("--database-url must be supplied exactly once.");
      }
      databaseUrl = argument.slice("--database-url=".length).trim();
      if (!databaseUrl) fail("--database-url requires a value.");
      continue;
    }
    if (argument === "--runtime-database-role") {
      if (runtimeDatabaseRole !== undefined) {
        fail("--runtime-database-role must be supplied exactly once.");
      }
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) {
        fail("--runtime-database-role requires a value.");
      }
      runtimeDatabaseRole = value.trim();
      index += 1; // NOSONAR javascript:S2310
      continue;
    }
    if (argument?.startsWith("--runtime-database-role=")) {
      if (runtimeDatabaseRole !== undefined) {
        fail("--runtime-database-role must be supplied exactly once.");
      }
      runtimeDatabaseRole = argument
        .slice("--runtime-database-role=".length)
        .trim();
      if (!runtimeDatabaseRole) {
        fail("--runtime-database-role requires a value.");
      }
      continue;
    }
    fail("Unsupported PostgreSQL integration-test argument.");
  }

  return Object.freeze({
    allowRemoteTestDatabase,
    databaseUrl,
    help,
    runtimeDatabaseRole,
  });
}

function databaseNameFromUrl(url) {
  const encodedSegments = url.pathname.split("/").filter(Boolean);
  if (encodedSegments.length !== 1) {
    fail("The PostgreSQL test URL must select exactly one database.");
  }
  let databaseName;
  try {
    databaseName = decodeURIComponent(encodedSegments[0]);
  } catch {
    fail("The PostgreSQL test URL has an invalid database name.");
  }
  if (!databaseName || databaseName.includes("/") || databaseName.includes("\\")) {
    fail("The PostgreSQL test URL has an invalid database name.");
  }
  return databaseName;
}

export function validatePostgresIntegrationUrl( // NOSONAR javascript:S3776
  rawDatabaseUrl,
  { allowRemoteTestDatabase = false, environment = process.env } = {},
) {
  if (isProductionRuntime(environment)) {
    fail("PostgreSQL integration tests are disabled inside a production runtime.");
  }
  if (typeof rawDatabaseUrl !== "string" || rawDatabaseUrl.trim().length === 0) {
    fail(
      "A dedicated test database is required via TEST_DATABASE_URL or --database-url.",
    );
  }

  let url;
  try {
    url = new URL(rawDatabaseUrl.trim());
  } catch {
    fail("The PostgreSQL test URL is malformed.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail("The test database URL must use the postgres or postgresql protocol.");
  }
  if (url.hash) fail("The PostgreSQL test URL must not contain a fragment.");
  if (!url.username) fail("The PostgreSQL test URL must include a user.");

  const seenConnectionParameters = new Set();
  for (const parameterName of url.searchParams.keys()) {
    const normalizedParameterName = parameterName.toLowerCase();
    if (AUTHORITY_OVERRIDE_PARAMETERS.has(normalizedParameterName)) {
      fail("The PostgreSQL test URL contains a forbidden connection override.");
    }
    if (
      parameterName !== normalizedParameterName ||
      !ALLOWED_CONNECTION_PARAMETERS.has(normalizedParameterName)
    ) {
      fail("The PostgreSQL test URL contains an unsupported connection parameter.");
    }
    if (seenConnectionParameters.has(normalizedParameterName)) {
      fail("The PostgreSQL test URL repeats a connection parameter.");
    }
    seenConnectionParameters.add(normalizedParameterName);
  }

  const hostname = url.hostname.toLowerCase();
  const databaseName = databaseNameFromUrl(url);
  const loopback = LOOPBACK_HOSTNAMES.has(hostname);
  if (!loopback) {
    if (!allowRemoteTestDatabase) {
      fail(
        "Remote PostgreSQL targets are blocked by default; use a local loopback test database.",
      );
    }
    if (!REMOTE_TEST_DATABASE_PATTERN.test(databaseName)) {
      fail(
        "A remote override is limited to a clearly named disposable test database.",
      );
    }
    const sslMode = url.searchParams.get("sslmode")?.trim().toLowerCase();
    const channelBinding = url.searchParams
      .get("channel_binding")
      ?.trim()
      .toLowerCase();
    if (sslMode !== "verify-full" || channelBinding !== "require") {
      fail(
        "A remote test database requires sslmode=verify-full and channel_binding=require.",
      );
    }
  }

  return Object.freeze({ databaseName, loopback });
}

function validateOptionalLoopbackDatabaseUrl(rawDatabaseUrl, environment) {
  if (typeof rawDatabaseUrl !== "string" || rawDatabaseUrl.trim().length === 0) {
    return null;
  }
  try {
    const target = validatePostgresIntegrationUrl(rawDatabaseUrl, {
      environment,
    });
    if (!target.loopback) return null;
    return rawDatabaseUrl.trim();
  } catch {
    // DATABASE_URL and .env.local are application runtime inputs, not explicit
    // test opt-ins. Ignore unsafe/non-loopback values instead of connecting to
    // them merely because the module graph contains DB-aware source files.
    return null;
  }
}

export function resolveVitestDatabaseTarget({
  environment = process.env,
  envFileDatabaseUrl,
} = {}) {
  const explicitTestUrl = environment.TEST_DATABASE_URL?.trim();
  if (explicitTestUrl) {
    const allowRemoteTestDatabase =
      environment[VITEST_VALIDATED_REMOTE_DATABASE_MARKER] === "true";
    const target = validatePostgresIntegrationUrl(explicitTestUrl, {
      allowRemoteTestDatabase,
      environment,
    });
    return Object.freeze({
      databaseUrl: explicitTestUrl,
      enabled: true,
      source: "TEST_DATABASE_URL",
      ...target,
    });
  }

  const inheritedLoopbackUrl = validateOptionalLoopbackDatabaseUrl(
    environment.DATABASE_URL,
    environment,
  );
  if (inheritedLoopbackUrl) {
    return Object.freeze({
      databaseUrl: inheritedLoopbackUrl,
      enabled: true,
      source: "DATABASE_URL",
      ...validatePostgresIntegrationUrl(inheritedLoopbackUrl, { environment }),
    });
  }

  const envFileLoopbackUrl = validateOptionalLoopbackDatabaseUrl(
    envFileDatabaseUrl,
    environment,
  );
  if (envFileLoopbackUrl) {
    return Object.freeze({
      databaseUrl: envFileLoopbackUrl,
      enabled: true,
      source: ".env.local",
      ...validatePostgresIntegrationUrl(envFileLoopbackUrl, { environment }),
    });
  }

  return Object.freeze({
    databaseName: "toonspectrum_test",
    databaseUrl: VITEST_UNAVAILABLE_DATABASE_URL,
    enabled: false,
    loopback: true,
    source: "unavailable-loopback",
  });
}

export function resolvePostgresIntegrationTarget({
  arguments_: commandArguments = [],
  environment = process.env,
} = {}) {
  const options = parsePostgresIntegrationArguments(commandArguments);
  if (options.help) return Object.freeze({ help: true });

  const environmentUrl = environment.TEST_DATABASE_URL?.trim();
  if (
    options.databaseUrl &&
    environmentUrl &&
    options.databaseUrl !== environmentUrl
  ) {
    fail(
      "Conflicting test database URLs were supplied; keep exactly one explicit source.",
    );
  }
  const databaseUrl = options.databaseUrl || environmentUrl;
  const target = validatePostgresIntegrationUrl(databaseUrl, {
    allowRemoteTestDatabase: options.allowRemoteTestDatabase,
    environment,
  });
  const environmentRuntimeDatabaseRole =
    environment.TEST_RUNTIME_DATABASE_ROLE?.trim();
  if (
    options.runtimeDatabaseRole &&
    environmentRuntimeDatabaseRole &&
    options.runtimeDatabaseRole !== environmentRuntimeDatabaseRole
  ) {
    fail(
      "Conflicting runtime database roles were supplied; keep exactly one explicit source.",
    );
  }
  const runtimeDatabaseRole = validateRuntimeDatabaseRole(
    options.runtimeDatabaseRole || environmentRuntimeDatabaseRole || "",
  );
  return Object.freeze({
    ...target,
    databaseUrl,
    help: false,
    runtimeDatabaseRole,
  });
}

export function createPostgresIntegrationEnvironment(
  databaseUrl,
  environment = process.env,
  { runtimeDatabaseRole, validatedRemoteDatabase = false } = {},
) {
  const validatedRuntimeDatabaseRole = validateRuntimeDatabaseRole(
    runtimeDatabaseRole,
  );
  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    STUDIO_LIVE_POSTGRES_INTEGRATION_URL: databaseUrl,
    STUDIO_LIVE_POSTGRES_RUNTIME_ROLE: validatedRuntimeDatabaseRole,
    STUDIO_TEAM_COMMENT_POSTGRES_INTEGRATION_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    [VITEST_VALIDATED_REMOTE_DATABASE_MARKER]: validatedRemoteDatabase
      ? "true"
      : "false",
  };
}

export function createVitestArguments() {
  return [
    VITEST_ENTRYPOINT,
    "run",
    "--no-file-parallelism",
    ...POSTGRES_INTEGRATION_SUITES,
  ];
}

async function preflightPostgresIntegrationDatabase(
  databaseUrl,
  expectedDatabaseName,
  runtimeDatabaseRole,
) {
  const pool = new Pool({
    application_name: "toonspectrum-postgres-integration-preflight",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max: 1,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });

  try {
    const result = await pool.query(
      `SELECT
         current_database() AS "databaseName",
         current_setting('transaction_read_only') AS "transactionReadOnly",
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_roles AS runtime_role
           WHERE runtime_role.rolname = $1
             AND pg_catalog.pg_has_role(
               current_user,
               runtime_role.oid,
               'SET'
             )
         ) AS "canSetRuntimeRole"`,
      [runtimeDatabaseRole],
    );
    const row = result.rows[0];
    if (
      row?.databaseName !== expectedDatabaseName ||
      row?.transactionReadOnly !== "off" ||
      row?.canSetRuntimeRole !== true
    ) {
      fail(
        "The PostgreSQL test database is not writable or cannot assume the selected runtime role.",
      );
    }
  } catch {
    fail(
      "PostgreSQL test database preflight failed; connection details were withheld.",
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function runVitest(
  databaseUrl,
  { runtimeDatabaseRole, validatedRemoteDatabase = false } = {},
) {
  for (const suite of POSTGRES_INTEGRATION_SUITES) {
    if (!existsSync(resolve(REPOSITORY_ROOT, suite))) {
      fail("A required PostgreSQL integration suite is missing.");
    }
  }

  const child = spawn(process.execPath, createVitestArguments(), {
    cwd: REPOSITORY_ROOT,
    env: createPostgresIntegrationEnvironment(databaseUrl, process.env, {
      runtimeDatabaseRole,
      validatedRemoteDatabase,
    }),
    stdio: "inherit",
  });
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => {
      rejectPromise(
        new Error("The PostgreSQL integration-test process could not start."),
      );
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(
          new Error("The PostgreSQL integration-test process was interrupted."),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new Error("One or more PostgreSQL integration suites failed."),
        );
        return;
      }
      resolvePromise();
    });
  });
}

function runCreatorMarketplaceDatabaseVerifier(
  databaseUrl,
  { runtimeDatabaseRole, validatedRemoteDatabase = false } = {},
) {
  const verifierPath = resolve(REPOSITORY_ROOT, CREATOR_MARKETPLACE_DB_VERIFIER);
  if (!existsSync(verifierPath)) {
    fail("The creator marketplace PostgreSQL verifier is missing.");
  }

  const child = spawn(process.execPath, [TSX_ENTRYPOINT, verifierPath], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...createPostgresIntegrationEnvironment(databaseUrl, process.env, {
        runtimeDatabaseRole,
        validatedRemoteDatabase,
      }),
      TOONSPECTRUM_MARKETPLACE_DB_RUNNER_VALIDATED: "1",
      TOONSPECTRUM_MARKETPLACE_DB_TEST: "1",
    },
    stdio: "inherit",
  });
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => {
      rejectPromise(
        new Error("The creator marketplace PostgreSQL verifier could not start."),
      );
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(
          new Error("The creator marketplace PostgreSQL verifier was interrupted."),
        );
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new Error("The creator marketplace PostgreSQL verifier failed."),
        );
        return;
      }
      resolvePromise();
    });
  });
}

export async function runPostgresIntegrationTests({
  arguments_: commandArguments = process.argv.slice(2),
  environment = process.env,
} = {}) {
  const target = resolvePostgresIntegrationTarget({
    arguments_: commandArguments,
    environment,
  });
  if (target.help) {
    console.log(POSTGRES_INTEGRATION_USAGE);
    return;
  }

  await preflightPostgresIntegrationDatabase(
    target.databaseUrl,
    target.databaseName,
    target.runtimeDatabaseRole,
  );
  console.log(
    `PostgreSQL integration preflight passed (${target.loopback ? "loopback" : "explicit remote test"} target; credentials hidden).`,
  );
  console.log(
    `Running ${POSTGRES_INTEGRATION_SUITES.length} direct PostgreSQL suites without file parallelism.`,
  );
  await runVitest(target.databaseUrl, {
    runtimeDatabaseRole: target.runtimeDatabaseRole,
    validatedRemoteDatabase: !target.loopback,
  });
  console.log(
    "Running the creator marketplace repository and publish-gate verifier against the validated target.",
  );
  await runCreatorMarketplaceDatabaseVerifier(target.databaseUrl, {
    runtimeDatabaseRole: target.runtimeDatabaseRole,
    validatedRemoteDatabase: !target.loopback,
  });
}

function isDirectExecution() {
  const entry = process.argv[1];
  return Boolean(
    entry &&
      pathToFileURL(resolve(entry)).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  runPostgresIntegrationTests().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown PostgreSQL integration-test failure.";
    console.error(`PostgreSQL integration tests failed: ${message}`);
    process.exitCode = 1;
  });
}
