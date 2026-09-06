#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  buildCreatorAssetObjectStorageRuntimeAclSql,
  buildRuntimeCutoverLedgerAclSql,
  buildRuntimeDatabaseRoleBoundaryStateSql,
  loadMigrationManifest,
  runProductionDatabaseMigrations,
  validateRuntimeDatabaseRole,
} from "./run-production-database-migrations.mjs";
import {
  createPsqlEnvironment,
  validateProductionDatabaseUrl,
} from "./validate-production-database-url.mjs";
import { verifyProductionDatabaseCapabilities } from "./verify-production-database-capabilities.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

export const EMPTY_DATABASE_BOOTSTRAP_CONFIRMATION =
  "BOOTSTRAP-EMPTY-TOONSPECTRUM-DATABASE";
export const RUNTIME_DATABASE_PASSWORD_ENVIRONMENT_VARIABLE =
  "BOOTSTRAP_RUNTIME_DATABASE_PASSWORD";

const HISTORICAL_BASELINE_SEQUENCE = 19;
const LEDGER_MIGRATION_ID = "0023_production_migration_ledger";
const REQUIRED_PENDING_MIGRATION_IDS = Object.freeze([
  "0020_creator_draft_collaboration_room",
  "0021_creator_marketplace_resource",
  "0022_creator_marketplace_distributed_gate_search",
  "0024_creator_asset_object_storage",
  "0025_auth_lifecycle_contract",
  "0026_creator_draft_cloud_save_intent",
  "0027_creator_draft_atomic_publication",
  "0029_creator_community_runtime_indexes",
  "0030_creator_marketplace_immutable_releases",
  "0031_creator_marketplace_moderation",
  "0032_creator_marketplace_release_lifecycle",
  "0033_creator_marketplace_cloud_library",
  "0034_creator_marketplace_package_moderation",
  "0035_creator_marketplace_3d_asset_kind",
  "0037_creator_marketplace_3d_asset_parity",
]);
const DRIZZLE_SCHEMA_PATHS = Object.freeze([
  "drizzle.config.ts",
  "apps/api/src/db/schema.ts",
  "apps/api/src/db/creator-marketplace-resource.schema.ts",
  "apps/api/src/db/creator-marketplace-report.schema.ts",
  "apps/api/src/db/creator-marketplace-library.schema.ts",
  "apps/api/src/db/creator-marketplace-package-moderation.schema.ts",
  "apps/api/src/db/creator-asset-object-storage.schema.ts",
  "apps/api/src/db/studio-crdt-raster-checkpoint.schema.ts",
  "apps/api/src/db/studio-raster-asset.schema.ts",
]);
const BOOTSTRAP_CONTRACT_PATHS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "scripts/bootstrap-empty-production-database.mjs",
  "scripts/production-database-migrations.manifest",
  "scripts/run-production-database-migrations.mjs",
  "scripts/validate-production-database-url.mjs",
  "scripts/verify-production-database-capabilities.mjs",
  ...DRIZZLE_SCHEMA_PATHS,
]);
const DRIZZLE_ERROR_PATTERN =
  /(^|[\s:])(error|fatal|panic)([\s:]|$)|severity:\s*(ERROR|FATAL|PANIC)/iu;

function fail(message, cause) {
  throw new Error(message, cause ? { cause } : undefined);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function decodeCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail("The validated database URL contains invalid credential encoding");
  }
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export function expectedResetConfirmation(databaseName) {
  if (
    typeof databaseName !== "string" ||
    !databaseName ||
    hasControlCharacters(databaseName)
  ) {
    fail("A canonical database name is required for reset confirmation");
  }
  return `RESET-AND-BOOTSTRAP-TOONSPECTRUM-DATABASE:${databaseName}`;
}

export function validateRuntimeDatabasePassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 24 ||
    password.length > 1_024 ||
    hasControlCharacters(password)
  ) {
    fail(
      `${RUNTIME_DATABASE_PASSWORD_ENVIRONMENT_VARIABLE} must contain 24-1024 non-control characters when the runtime role must be created`,
    );
  }
  return password;
}

export function redactDatabaseSecrets(value, secrets = []) {
  let redacted = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
      try {
        const encoded = encodeURIComponent(secret);
        if (encoded !== secret) {
          redacted = redacted.replaceAll(encoded, "[REDACTED]");
        }
      } catch {
        // The exact secret replacement above is still authoritative.
      }
    }
  }
  return redacted.replace(
    /\b(postgres(?:ql)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu,
    "$1[REDACTED]@",
  );
}

export function parseBootstrapArguments(argv) { // NOSONAR javascript:S3776
  const arguments_ = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map();
  const flags = new Set();
  const valueArguments = new Set([
    "--confirmation",
    "--release-sha",
    "--reset-confirmation",
    "--runtime-database-role",
  ]);
  const booleanArguments = new Set([
    "--allow-loopback",
    "--dry-run",
    "--execute",
    "--help",
    "--plan",
  ]);

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (booleanArguments.has(argument)) {
      if (flags.has(argument)) fail(`Duplicate bootstrap argument: ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!valueArguments.has(argument)) {
      fail(`Unknown bootstrap argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Bootstrap argument ${argument} requires a value`);
    }
    if (values.has(argument)) {
      fail(`Duplicate bootstrap argument: ${argument}`);
    }
    values.set(argument, value);
    index += 1; // NOSONAR javascript:S2310
  }

  const help = flags.has("--help");
  if (help) {
    if (arguments_.length !== 1) fail("--help must be used by itself");
    return Object.freeze({ help: true });
  }

  const planRequested = flags.has("--plan") || flags.has("--dry-run");
  if (flags.has("--plan") && flags.has("--dry-run")) {
    fail("Use exactly one of --plan or --dry-run");
  }
  if (planRequested === flags.has("--execute")) {
    fail("Use exactly one of --plan, --dry-run, or --execute");
  }

  const releaseSha = values.get("--release-sha") ?? "";
  if (!/^[0-9a-f]{40}$/u.test(releaseSha)) {
    fail("Bootstrap release SHA must be a full lowercase 40-character commit SHA");
  }
  const runtimeDatabaseRole = validateRuntimeDatabaseRole(
    values.get("--runtime-database-role") ?? "",
  );
  const confirmation = values.get("--confirmation") ?? "";
  if (flags.has("--execute")) {
    if (confirmation !== EMPTY_DATABASE_BOOTSTRAP_CONFIRMATION) {
      fail("Bootstrap execution requires the exact destructive confirmation");
    }
  } else if (confirmation) {
    fail("A destructive confirmation is not accepted in plan mode");
  }

  return Object.freeze({
    allowLoopback: flags.has("--allow-loopback"),
    confirmation,
    execute: flags.has("--execute"),
    help: false,
    releaseSha,
    resetConfirmation: values.get("--reset-confirmation") ?? "",
    runtimeDatabaseRole,
  });
}

export function buildBootstrapDatabaseInspectionSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
WITH runtime_role AS (
  SELECT
    role.oid,
    role.rolcanlogin,
    role.rolsuper,
    role.rolcreaterole,
    role.rolcreatedb,
    role.rolreplication,
    role.rolbypassrls
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = ${sqlLiteral(role)}
),
application_objects AS (
  SELECT namespace.nspname || '.' || relation.relname AS object_name
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'toonspectrum_ops')
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT namespace.nspname || '.' || procedure.proname || '()'
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_proc'::regclass
        AND dependency.objid = procedure.oid
        AND dependency.deptype = 'e'
    )
  UNION ALL
  SELECT namespace.nspname || '.' || type_record.typname
  FROM pg_catalog.pg_type AS type_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = type_record.typnamespace
  WHERE namespace.nspname = 'public'
    AND type_record.typrelid = 0
    AND type_record.typelem = 0
    AND type_record.typtype IN ('c', 'd', 'e', 'r', 'm')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_depend AS dependency
      WHERE dependency.classid = 'pg_catalog.pg_type'::regclass
        AND dependency.objid = type_record.oid
        AND dependency.deptype = 'e'
    )
),
object_summary AS (
  SELECT
    count(*)::integer AS object_count,
    coalesce(
      (array_agg(object_name ORDER BY object_name))[1:12],
      ARRAY[]::text[]
    ) AS object_sample
  FROM application_objects
)
SELECT json_build_object(
  'databaseName', current_database(),
  'migratorRole', current_user,
  'migratorCanCreateRole', (
    SELECT rolsuper OR rolcreaterole
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user
  ),
  'migratorCanCreateInDatabase',
    pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE'),
  'migratorCanCreateInPublic',
    pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE'),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'activeConnectionCount', (
    SELECT count(*)::integer
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
  ),
  'applicationObjectCount', object_summary.object_count,
  'applicationObjectSample', object_summary.object_sample,
  'operationsSchemaExists',
    to_regnamespace('toonspectrum_ops') IS NOT NULL,
  'trigramExtensionInstalled',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm'
    ),
  'runtimeRoleExists', EXISTS (SELECT 1 FROM runtime_role),
  'runtimeRoleCanLogin',
    coalesce((SELECT rolcanlogin FROM runtime_role), false),
  'runtimeRolePrivileged',
    coalesce((
      SELECT
        rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
      FROM runtime_role
    ), false),
  'runtimeRoleHasMemberships',
    coalesce((
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS membership
        WHERE membership.member = runtime_role.oid
      )
      FROM runtime_role
    ), false),
  'runtimeRoleInheritsMigrator',
    CASE
      WHEN EXISTS (SELECT 1 FROM runtime_role)
      THEN pg_catalog.pg_has_role(
        ${sqlLiteral(role)},
        current_user,
        'MEMBER'
      )
      ELSE false
    END,
  'runtimeRoleOwnsDatabase',
    coalesce((
      SELECT database_record.datdba = runtime_role.oid
      FROM pg_catalog.pg_database AS database_record
      CROSS JOIN runtime_role
      WHERE database_record.datname = current_database()
    ), false),
  'runtimeBoundaryState',
    ${buildRuntimeDatabaseRoleBoundaryStateSql(role)}
)::text
FROM object_summary;
`;
}

function normalizeInspectionState(rawState) {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    fail("PostgreSQL bootstrap inspection returned an invalid state");
  }
  const integerFields = ["activeConnectionCount", "applicationObjectCount"];
  for (const field of integerFields) {
    if (!Number.isInteger(rawState[field]) || rawState[field] < 0) {
      fail(`PostgreSQL bootstrap inspection returned invalid ${field}`);
    }
  }
  const booleanFields = [
    "migratorCanCreateInDatabase",
    "migratorCanCreateInPublic",
    "migratorCanCreateRole",
    "operationsSchemaExists",
    "readOnly",
    "runtimeRoleCanLogin",
    "runtimeRoleExists",
    "runtimeRoleHasMemberships",
    "runtimeRoleInheritsMigrator",
    "runtimeRoleOwnsDatabase",
    "runtimeRolePrivileged",
    "trigramExtensionInstalled",
  ];
  for (const field of booleanFields) {
    if (typeof rawState[field] !== "boolean") {
      fail(`PostgreSQL bootstrap inspection returned invalid ${field}`);
    }
  }
  if (
    typeof rawState.databaseName !== "string" ||
    !rawState.databaseName ||
    typeof rawState.migratorRole !== "string" ||
    !rawState.migratorRole ||
    typeof rawState.runtimeBoundaryState !== "string" ||
    !rawState.runtimeBoundaryState ||
    !Array.isArray(rawState.applicationObjectSample) ||
    rawState.applicationObjectSample.some((entry) => typeof entry !== "string")
  ) {
    fail("PostgreSQL bootstrap inspection returned malformed identity data");
  }
  return Object.freeze({ ...rawState });
}

export function assessBootstrapState({ // NOSONAR javascript:S3776
  databaseContract,
  inspection,
  requireRuntimePassword = false,
  resetConfirmation = "",
  runtimeDatabasePassword = "",
  runtimeDatabaseRole,
}) {
  const state = normalizeInspectionState(inspection);
  validateRuntimeDatabaseRole(runtimeDatabaseRole);
  if (state.databaseName !== databaseContract.databaseName) {
    fail("The connected PostgreSQL database does not match the validated URL");
  }
  if (state.migratorRole === runtimeDatabaseRole) {
    fail("The migration and runtime database roles must be different");
  }
  if (state.readOnly) fail("The bootstrap target is read-only");
  if (
    !state.migratorCanCreateInDatabase ||
    !state.migratorCanCreateInPublic
  ) {
    fail("The migration role cannot create the reviewed application schema");
  }
  if (state.activeConnectionCount !== 0) {
    fail(
      `The target has ${state.activeConnectionCount} other client connection(s); drain all writers and readers before bootstrap`,
    );
  }
  if (
    state.runtimeRoleExists &&
    (state.runtimeBoundaryState !== "separated" ||
      !state.runtimeRoleCanLogin ||
      state.runtimeRolePrivileged ||
      state.runtimeRoleHasMemberships ||
      state.runtimeRoleInheritsMigrator ||
      state.runtimeRoleOwnsDatabase)
  ) {
    fail("The existing runtime database role violates the separation boundary");
  }
  if (!state.runtimeRoleExists) {
    if (state.runtimeBoundaryState !== "missing") {
      fail("The missing runtime role returned an inconsistent boundary state");
    }
    if (!state.migratorCanCreateRole) {
      fail("The runtime role is missing and the migration role cannot create it");
    }
    if (requireRuntimePassword) {
      validateRuntimeDatabasePassword(runtimeDatabasePassword);
    }
  }

  const nonempty =
    state.applicationObjectCount > 0 || state.operationsSchemaExists;
  const expectedReset = expectedResetConfirmation(state.databaseName);
  if (resetConfirmation && resetConfirmation !== expectedReset) {
    fail("The reset confirmation does not exactly match the connected database");
  }
  return Object.freeze({
    expectedResetConfirmation: expectedReset,
    nonempty,
    resetAuthorized: nonempty && resetConfirmation === expectedReset,
    runtimeRoleMustBeCreated: !state.runtimeRoleExists,
    state,
  });
}

export function buildResetApplicationSchemasSql({
  databaseName,
  runtimeDatabaseRole,
}) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
DO $toonspectrum_reset_guard$
BEGIN
  IF current_database() <> ${sqlLiteral(databaseName)} THEN
    RAISE EXCEPTION 'connected database changed after reset approval';
  END IF;
  IF current_user = ${sqlLiteral(role)} THEN
    RAISE EXCEPTION 'runtime role cannot execute the destructive reset';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
  ) THEN
    RAISE EXCEPTION 'other database clients connected after reset approval';
  END IF;
END
$toonspectrum_reset_guard$;

DROP SCHEMA IF EXISTS toonspectrum_ops CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
DROP EXTENSION IF EXISTS pg_trgm CASCADE;
CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
`;
}

export function buildRuntimeRoleCreationSql(runtimeDatabaseRole, password) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  validateRuntimeDatabasePassword(password);
  return `
DO $toonspectrum_runtime_role$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${sqlLiteral(role)}
  ) THEN
    RAISE EXCEPTION 'runtime role appeared after bootstrap preflight';
  END IF;
  EXECUTE format(
    'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    ${sqlLiteral(role)},
    ${sqlLiteral(password)}
  );
END
$toonspectrum_runtime_role$;
`;
}

function validateBootstrapDatabaseName(databaseName) {
  expectedResetConfirmation(databaseName);
  return databaseName;
}

/**
 * Block new runtime sessions without changing PUBLIC or unrelated role grants. The preflight
 * requires LOGIN, so this transaction owns the temporary NOLOGIN transition and can restore the
 * original state deterministically after the mutation phase.
 */
export function buildRuntimeLoginGateSql({
  databaseName,
  runtimeDatabaseRole,
}) {
  const canonicalDatabaseName = validateBootstrapDatabaseName(databaseName);
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
BEGIN;
DO $toonspectrum_runtime_login_gate$
BEGIN
  IF current_database() <> ${sqlLiteral(canonicalDatabaseName)} THEN
    RAISE EXCEPTION 'connected database changed before runtime login gate';
  END IF;
  IF current_user = ${sqlLiteral(role)} THEN
    RAISE EXCEPTION 'runtime role cannot own its bootstrap login gate';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = ${sqlLiteral(role)}
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
      AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'runtime role is missing, already gated, or unsafe';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
  ) THEN
    RAISE EXCEPTION 'other database clients connected before runtime login gate';
  END IF;
  EXECUTE format('ALTER ROLE %I NOLOGIN', ${sqlLiteral(role)});
END
$toonspectrum_runtime_login_gate$;
COMMIT;
`;
}

export function buildRuntimeLoginGateVerificationSql({
  databaseName,
  runtimeDatabaseRole,
}) {
  const canonicalDatabaseName = validateBootstrapDatabaseName(databaseName);
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
DO $toonspectrum_runtime_login_gate_verify$
BEGIN
  IF current_database() <> ${sqlLiteral(canonicalDatabaseName)} THEN
    RAISE EXCEPTION 'connected database changed after runtime login gate';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = ${sqlLiteral(role)}
      AND NOT rolcanlogin
  ) THEN
    RAISE EXCEPTION 'runtime login gate is not active';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'
  ) THEN
    RAISE EXCEPTION 'database client raced the runtime login gate';
  END IF;
END
$toonspectrum_runtime_login_gate_verify$;
`;
}

export function buildRuntimeLoginRestoreSql({
  databaseName,
  runtimeDatabaseRole,
}) {
  const canonicalDatabaseName = validateBootstrapDatabaseName(databaseName);
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
BEGIN;
DO $toonspectrum_runtime_login_restore$
BEGIN
  IF current_database() <> ${sqlLiteral(canonicalDatabaseName)} THEN
    RAISE EXCEPTION 'connected database changed before runtime login restore';
  END IF;
  IF current_user = ${sqlLiteral(role)} THEN
    RAISE EXCEPTION 'runtime role cannot restore its own bootstrap login';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = ${sqlLiteral(role)}
      AND NOT rolsuper
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
      AND NOT rolbypassrls
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS inherited_role
    WHERE inherited_role.rolname <> ${sqlLiteral(role)}
      AND pg_catalog.pg_has_role(
        ${sqlLiteral(role)},
        inherited_role.rolname,
        'MEMBER'
      )
  ) THEN
    RAISE EXCEPTION 'runtime role became missing or unsafe while login was gated';
  END IF;
  EXECUTE format('ALTER ROLE %I LOGIN', ${sqlLiteral(role)});
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = ${sqlLiteral(role)}
      AND rolcanlogin
  ) THEN
    RAISE EXCEPTION 'runtime login restore did not take effect';
  END IF;
END
$toonspectrum_runtime_login_restore$;
COMMIT;
`;
}

export function buildRuntimeBootstrapAclSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const quotedRole = `"${role}"`;
  return `
REVOKE ALL ON SCHEMA public FROM ${quotedRole};
GRANT USAGE ON SCHEMA public TO ${quotedRole};
SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  ${sqlLiteral(role)}
) \\gexec

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quotedRole};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quotedRole};

DO $toonspectrum_runtime_acl$
DECLARE
  relation_name text;
BEGIN
  FOR relation_name IN
    SELECT format('%I.%I', namespace.nspname, relation.relname)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname NOT IN (
        'creator_asset_storage_object',
        'creator_work_asset_storage_reference',
        'toonspectrum_schema_migration'
      )
    ORDER BY relation.relname
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO %I',
      relation_name,
      ${sqlLiteral(role)}
    );
  END LOOP;
END
$toonspectrum_runtime_acl$;

${buildRuntimeCutoverLedgerAclSql(role)}
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole};
${buildCreatorAssetObjectStorageRuntimeAclSql(role)}
`;
}

function psql(
  databaseUrl,
  sql,
  {
    allowLoopback,
    description,
    sensitiveValues = [],
    tuplesOnly = false,
  },
) {
  const arguments_ = ["-X", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) arguments_.push("-A", "-q", "-t");
  const result = spawnSync("psql", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: createPsqlEnvironment(databaseUrl, {
      allowLoopback,
      baseEnvironment: { ...process.env, PSQLRC: "/dev/null" },
    }),
    input: sql,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${description}: psql is unavailable`, result.error);
  if (result.status !== 0) {
    const details = redactDatabaseSecrets(
      (result.stderr || result.stdout || "").trim(),
      [databaseUrl, ...sensitiveValues],
    ).slice(0, 16_384);
    fail(details ? `${description} failed: ${details}` : `${description} failed`);
  }
  return (result.stdout || "").trim();
}

function inspectBootstrapDatabase({
  allowLoopback,
  databaseUrl,
  runtimeDatabaseRole,
}) {
  const output = psql(
    databaseUrl,
    buildBootstrapDatabaseInspectionSql(runtimeDatabaseRole),
    {
      allowLoopback,
      description: "Bootstrap preflight",
      tuplesOnly: true,
    },
  );
  let state;
  try {
    state = JSON.parse(output.split(/\r?\n/u).at(-1) ?? "");
  } catch {
    fail("Bootstrap preflight returned malformed JSON");
  }
  return normalizeInspectionState(state);
}

function assertExecutable(command, arguments_, label) {
  const result = spawnSync(command, arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(`${label} is required for the database bootstrap`, result.error);
  }
}

function runDrizzleFreshProvision(databaseUrl, allowLoopback) {
  const psqlEnvironment = createPsqlEnvironment(databaseUrl, {
    allowLoopback,
    baseEnvironment: process.env,
  });
  const result = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "push", "--force"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        DATABASE_URL: databaseUrl,
        PGCHANNELBINDING: psqlEnvironment.PGCHANNELBINDING,
        PGSSLMODE: psqlEnvironment.PGSSLMODE,
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) fail("Current Drizzle schema provision failed", result.error);
  const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0 || DRIZZLE_ERROR_PATTERN.test(combinedOutput)) {
    const url = new URL(databaseUrl);
    const details = redactDatabaseSecrets(combinedOutput.trim(), [
      databaseUrl,
      decodeCredential(url.password),
    ]).slice(0, 16_384);
    fail(
      details
        ? `Current Drizzle schema provision failed: ${details}`
        : "Current Drizzle schema provision failed",
    );
  }
}

export function loadBootstrapContract() {
  const manifest = loadMigrationManifest();
  const ledgerMigration = manifest.find(
    (migration) => migration.id === LEDGER_MIGRATION_ID,
  );
  if (!ledgerMigration) {
    fail("The reviewed migration manifest is missing the ledger bootstrap");
  }
  const historical = manifest.filter(
    (migration) => migration.sequence <= HISTORICAL_BASELINE_SEQUENCE,
  );
  if (
    historical.length !== HISTORICAL_BASELINE_SEQUENCE ||
    historical.some((migration, index) => migration.sequence !== index + 1)
  ) {
    fail("The reviewed historical baseline must be continuous through 0019");
  }
  const migrationIds = new Set(manifest.map((migration) => migration.id));
  const missingRequired = REQUIRED_PENDING_MIGRATION_IDS.filter(
    (id) => !migrationIds.has(id),
  );
  if (missingRequired.length > 0) {
    fail(
      `The reviewed pending migration contract is incomplete: ${missingRequired.join(", ")}`,
    );
  }
  const fingerprintPaths = [
    ...BOOTSTRAP_CONTRACT_PATHS,
    ...manifest.map((migration) => migration.relativePath),
  ];
  const uniquePaths = [...new Set(fingerprintPaths)].sort();
  const hash = createHash("sha256");
  for (const relativePath of uniquePaths) {
    const contents = readFileSync(resolve(REPOSITORY_ROOT, relativePath));
    hash.update(`${relativePath}\0`);
    hash.update(contents);
    hash.update("\0");
  }
  return Object.freeze({
    fingerprint: hash.digest("hex"),
    fingerprintPaths: Object.freeze(uniquePaths),
    historical: Object.freeze(historical),
    manifest,
    pending: Object.freeze(
      manifest.filter(
        (migration) =>
          migration.sequence > HISTORICAL_BASELINE_SEQUENCE &&
          migration.id !== LEDGER_MIGRATION_ID,
      ),
    ),
  });
}

function assertBootstrapContractUnchanged(expectedFingerprint) {
  const current = loadBootstrapContract();
  if (current.fingerprint !== expectedFingerprint) {
    fail(
      "Bootstrap source drift was detected during execution; the target remains fail-closed and must be inspected before retry",
    );
  }
  return current;
}

function printPlan({ assessment, contract, databaseContract, options }) {
  const state = assessment.state;
  const applicationState = assessment.nonempty ? `nonempty (${state.applicationObjectCount} object(s))` : "empty";
  const lines = [
    "ToonSpectrum disposable PostgreSQL bootstrap plan",
    `Target: ${databaseContract.hostname}:${databaseContract.port}/${databaseContract.databaseName}`,
    `Transport: ${databaseContract.tlsVerified ? "direct TLS verify-full + channel binding" : "explicit loopback test override"}`,
    `Release: ${options.releaseSha}`,
    `Runtime role: ${options.runtimeDatabaseRole} (${assessment.runtimeRoleMustBeCreated ? "create with environment secret" : "reuse verified separated role"})`,
    `Current application state: ${applicationState}`,
    `Other client connections: ${state.activeConnectionCount}`,
    `Schema contract fingerprint: ${contract.fingerprint}`,
    `Historical baseline: ${contract.historical[0].id} .. ${contract.historical.at(-1).id}`,
    `Forward migrations after adoption: ${contract.pending.map((migration) => migration.id).join(", ")}`,
    "Execution phases:",
    "  1. Re-inspect target, require zero other clients, and verify role separation",
    assessment.nonempty
      ? "  2. Drop only public/toonspectrum_ops under the database-bound reset confirmation"
      : "  2. Preserve the verified empty public schema",
    "  3. Provision pg_trgm and the current Drizzle base schema",
    "  4. Apply reviewed historical structure through 0019, then prove adoption shape",
    "  5. Adopt exact 0001-0019 checksums and apply 0020-0022/0024-0027 plus later reviewed forward migrations",
    "  6. Normalize runtime ACL, rerun apply as an idempotency proof, and verify all production capabilities",
  ];
  if (assessment.nonempty && !assessment.resetAuthorized) {
    lines.push(
      "Execution is blocked until this separate database-bound token is supplied:",
      `  --reset-confirmation ${assessment.expectedResetConfirmation}`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function prepareRuntimeRole({
  allowLoopback,
  assessment,
  databaseUrl,
  runtimeDatabasePassword,
  runtimeDatabaseRole,
}) {
  if (assessment.runtimeRoleMustBeCreated) {
    psql(
      databaseUrl,
      buildRuntimeRoleCreationSql(
        runtimeDatabaseRole,
        runtimeDatabasePassword,
      ),
      {
        allowLoopback,
        description: "Runtime role creation",
        sensitiveValues: [runtimeDatabasePassword],
      },
    );
  }
}

function executeBootstrap({
  contract,
  databaseContract,
  databaseUrl,
  options,
  runtimeDatabasePassword,
}) {
  assertExecutable("psql", ["--version"], "PostgreSQL client");
  assertExecutable("pnpm", ["--version"], "pnpm");
  assertBootstrapContractUnchanged(contract.fingerprint);

  const executionAssessment = assessBootstrapState({
    databaseContract,
    inspection: inspectBootstrapDatabase({
      allowLoopback: options.allowLoopback,
      databaseUrl,
      runtimeDatabaseRole: options.runtimeDatabaseRole,
    }),
    requireRuntimePassword: true,
    resetConfirmation: options.resetConfirmation,
    runtimeDatabasePassword,
    runtimeDatabaseRole: options.runtimeDatabaseRole,
  });
  if (executionAssessment.nonempty && !executionAssessment.resetAuthorized) {
    fail(
      `The target is not empty; rerun only after review with --reset-confirmation ${executionAssessment.expectedResetConfirmation}`,
    );
  }

  prepareRuntimeRole({
    allowLoopback: options.allowLoopback,
    assessment: executionAssessment,
    databaseUrl,
    runtimeDatabasePassword,
    runtimeDatabaseRole: options.runtimeDatabaseRole,
  });
  let runtimeLoginGated = false;
  try {
    psql(
      databaseUrl,
      buildRuntimeLoginGateSql({
        databaseName: databaseContract.databaseName,
        runtimeDatabaseRole: options.runtimeDatabaseRole,
      }),
      {
        allowLoopback: options.allowLoopback,
        description: "Runtime NOLOGIN writer gate",
      },
    );
    runtimeLoginGated = true;
    psql(
      databaseUrl,
      buildRuntimeLoginGateVerificationSql({
        databaseName: databaseContract.databaseName,
        runtimeDatabaseRole: options.runtimeDatabaseRole,
      }),
      {
        allowLoopback: options.allowLoopback,
        description: "Runtime NOLOGIN writer gate verification",
      },
    );

    if (executionAssessment.nonempty) {
      psql(
        databaseUrl,
        buildResetApplicationSchemasSql({
          databaseName: databaseContract.databaseName,
          runtimeDatabaseRole: options.runtimeDatabaseRole,
        }),
        {
          allowLoopback: options.allowLoopback,
          description: "Approved application schema reset",
        },
      );
      process.stdout.write("Application schemas: reset under exact confirmation\n");
    }

    psql(
      databaseUrl,
      `REVOKE ALL ON SCHEMA public FROM "${options.runtimeDatabaseRole}";`,
      {
        allowLoopback: options.allowLoopback,
        description: "Runtime schema writer boundary",
      },
    );
    assertBootstrapContractUnchanged(contract.fingerprint);

    psql(databaseUrl, "CREATE EXTENSION IF NOT EXISTS pg_trgm;", {
      allowLoopback: options.allowLoopback,
      description: "pg_trgm provision",
    });
    runDrizzleFreshProvision(databaseUrl, options.allowLoopback);
    process.stdout.write("Current Drizzle base schema: provisioned\n");
    assertBootstrapContractUnchanged(contract.fingerprint);

    for (const migration of contract.historical) {
      psql(databaseUrl, migration.contents, {
        allowLoopback: options.allowLoopback,
        description: `Historical structure ${migration.id}`,
      });
    }
    process.stdout.write("Historical structure through 0019: verified locally\n");

    psql(
      databaseUrl,
      `
        DROP TABLE IF EXISTS
          public.creator_work_asset_storage_reference,
          public.creator_asset_storage_object,
          public.creator_marketplace_library_item,
          public.creator_marketplace_package_moderation,
          public.creator_marketplace_package_moderation_decision,
          public.creator_marketplace_publish_gate,
          public.creator_marketplace_resource_report_gate,
          public.creator_marketplace_resource_report,
          public.creator_marketplace_resource,
          public.creator_draft_collaboration_room
        CASCADE;
        DROP EXTENSION IF EXISTS pg_trgm;
      `,
      {
        allowLoopback: options.allowLoopback,
        description: "Forward migration boundary preparation",
      },
    );
    assertBootstrapContractUnchanged(contract.fingerprint);

    psql(
      databaseUrl,
      `
        SELECT format(
          'GRANT CONNECT ON DATABASE %I TO %I',
          current_database(),
          ${sqlLiteral(options.runtimeDatabaseRole)}
        ) \\gexec
        GRANT USAGE ON SCHEMA public TO "${options.runtimeDatabaseRole}";
      `,
      {
        allowLoopback: options.allowLoopback,
        description: "Runtime role separation prerequisite",
      },
    );
    runProductionDatabaseMigrations({
      allowLoopback: options.allowLoopback,
      databaseUrl,
      mode: "adopt",
      releaseSha: options.releaseSha,
      runtimeDatabaseRole: options.runtimeDatabaseRole,
      runtimeRoleLoginMode: "bootstrap-gated",
    });
    assertBootstrapContractUnchanged(contract.fingerprint);

    psql(databaseUrl, buildRuntimeBootstrapAclSql(options.runtimeDatabaseRole), {
      allowLoopback: options.allowLoopback,
      description: "Runtime application ACL normalization",
    });
    runProductionDatabaseMigrations({
      allowLoopback: options.allowLoopback,
      databaseUrl,
      mode: "apply",
      releaseSha: options.releaseSha,
      runtimeDatabaseRole: options.runtimeDatabaseRole,
      runtimeRoleLoginMode: "bootstrap-gated",
    });
    assertBootstrapContractUnchanged(contract.fingerprint);
  } finally {
    if (runtimeLoginGated) {
      psql(
        databaseUrl,
        buildRuntimeLoginRestoreSql({
          databaseName: databaseContract.databaseName,
          runtimeDatabaseRole: options.runtimeDatabaseRole,
        }),
        {
          allowLoopback: options.allowLoopback,
          description: "Runtime LOGIN restoration",
        },
      );
    }
  }

  verifyProductionDatabaseCapabilities({
    allowLoopback: options.allowLoopback,
    databaseUrl,
    runtimeDatabaseRole: options.runtimeDatabaseRole,
  });
  assertBootstrapContractUnchanged(contract.fingerprint);
  process.stdout.write(
    `Disposable PostgreSQL bootstrap complete: ${databaseContract.databaseName} is checksum-ledgered and capability-verified\n`,
  );
}

export function runEmptyProductionDatabaseBootstrap({
  databaseUrl,
  options,
  runtimeDatabasePassword = "",
}) {
  const databaseContract = validateProductionDatabaseUrl(databaseUrl, {
    allowLoopback: options.allowLoopback,
  });
  const contract = loadBootstrapContract();
  const inspection = inspectBootstrapDatabase({
    allowLoopback: options.allowLoopback,
    databaseUrl,
    runtimeDatabaseRole: options.runtimeDatabaseRole,
  });
  const assessment = assessBootstrapState({
    databaseContract,
    inspection,
    requireRuntimePassword: options.execute,
    resetConfirmation: options.resetConfirmation,
    runtimeDatabasePassword,
    runtimeDatabaseRole: options.runtimeDatabaseRole,
  });
  printPlan({ assessment, contract, databaseContract, options });
  if (!options.execute) return { assessment, contract, databaseContract };
  executeBootstrap({
    contract,
    databaseContract,
    databaseUrl,
    options,
    runtimeDatabasePassword,
  });
  return { assessment, contract, databaseContract };
}

function usage() {
  return [
    "Usage:",
    "  MIGRATION_DATABASE_URL='postgresql://…' pnpm db:bootstrap:production-empty -- --plan --runtime-database-role <role> --release-sha <40-char-sha>",
    "  MIGRATION_DATABASE_URL='postgresql://…' BOOTSTRAP_RUNTIME_DATABASE_PASSWORD='<secret-if-role-is-missing>' pnpm db:bootstrap:production-empty -- --execute --runtime-database-role <role> --release-sha <40-char-sha> --confirmation BOOTSTRAP-EMPTY-TOONSPECTRUM-DATABASE [--reset-confirmation RESET-AND-BOOTSTRAP-TOONSPECTRUM-DATABASE:<database>]",
    "",
    "Use --allow-loopback only for a disposable local PostgreSQL target.",
    "The database URL is accepted only from MIGRATION_DATABASE_URL or PRODUCTION_DATABASE_DIRECT_URL and is never printed.",
  ].join("\n");
}

function runCli() {
  const options = parseBootstrapArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.PRODUCTION_DATABASE_DIRECT_URL;
  runEmptyProductionDatabaseBootstrap({
    databaseUrl,
    options,
    runtimeDatabasePassword:
      process.env[RUNTIME_DATABASE_PASSWORD_ENVIRONMENT_VARIABLE] ?? "",
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Disposable PostgreSQL bootstrap failed"}\n`,
    );
    process.exitCode = 1;
  }
}
