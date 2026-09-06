#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { buildFeedbackCapabilitySql, buildFeedbackRuntimeAclSql } from "./feedback-database-contract.mjs";
import {
  createPsqlEnvironment,
  validateProductionDatabaseUrl,
} from "./validate-production-database-url.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const MANIFEST_PATH = resolve(
  SCRIPT_DIRECTORY,
  "production-database-migrations.manifest",
);
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "apps/api/src/db/migrations");
const HEALTH_READINESS_SOURCE = resolve(
  REPOSITORY_ROOT,
  "apps/api/src/modules/health/health-readiness.repository.ts",
);
const ADOPTION_BASELINE_SEQUENCE = 19;
const ADOPTION_MARKER_ID = "__managed_history_through_0019__";
const LEDGER_RELATION = "toonspectrum_ops.deployment_migration";
const LOCK_RELATION = "toonspectrum_ops.deployment_migration_lock";
const REPAIR_LOCK_STALE_AFTER = "60 minutes";
const HISTORICAL_BASELINE_RELATIONS = Object.freeze([
  "account",
  "app_setting",
  "catalog_ingest_run",
  "catalog_snapshot",
  "collection",
  "collection_item",
  "community_cafe",
  "community_cafe_member",
  "creator_asset",
  "creator_asset_report",
  "creator_campaign",
  "creator_challenge",
  "creator_follow",
  "creator_profile",
  "creator_series",
  "creator_work",
  "creator_work_asset",
  "creator_work_asset_tombstone",
  "creator_work_collaboration_event",
  "creator_work_collaborator",
  "creator_work_comment",
  "creator_work_crdt_node_load",
  "creator_work_crdt_raster_checkpoint_job",
  "creator_work_crdt_snapshot",
  "creator_work_crdt_update",
  "creator_work_crdt_update_receipt",
  "creator_work_like",
  "creator_work_live_lock",
  "creator_work_live_lock_clock",
  "creator_work_raster_asset",
  "creator_work_revision",
  "creator_work_team_comment_activity",
  "creator_work_team_comment_message",
  "creator_work_team_comment_mutation",
  "creator_work_team_comment_read",
  "creator_work_team_comment_thread",
  "fan_post",
  "fan_post_reply",
  "feedback_post",
  "feedback_reply",
  "feedback_vote",
  "monetization_plan",
  "rating",
  "read",
  "revenue_ledger",
  "review",
  "review_like",
  "review_reply",
  "session",
  "socket_io_attachments",
  "studio_ai_daily_quota",
  "studio_ai_global_daily_quota",
  "studio_ai_request_gate",
  "studio_ai_request_receipt",
  "studio_ai_usage_ledger",
  "subscription",
  "toonspectrum_schema_migration",
  "user",
  "verificationToken",
]);
export const POST_BASELINE_RELATIONS = Object.freeze([
  "creator_asset_storage_object",
  "creator_draft_collaboration_room",
  "creator_marketplace_library_item",
  "creator_marketplace_package_moderation",
  "creator_marketplace_package_moderation_decision",
  "creator_marketplace_publish_gate",
  "creator_marketplace_resource",
  "creator_marketplace_resource_report",
  "creator_marketplace_resource_report_gate",
  "creator_work_asset_storage_reference",
]);

const MODE_CONFIRMATIONS = Object.freeze({
  apply: "APPLY-TOONSPECTRUM-PRODUCTION-MIGRATIONS",
  adopt: "ADOPT-TOONSPECTRUM-MIGRATION-HISTORY",
  repair: "REPAIR-TOONSPECTRUM-MIGRATION-STATE",
});

function fail(message, cause) {
  throw new Error(message, cause ? { cause } : undefined);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function migrationSequence(id) {
  const match = /^(?<sequence>\d{4})_/u.exec(id);
  if (!match?.groups?.sequence) fail(`Invalid migration id: ${id}`);
  return Number(match.groups.sequence);
}

function migrationId(relativePath) {
  return basename(relativePath, ".sql");
}

function expectedMigrationProvenance(migration) {
  if (migration.sequence <= ADOPTION_BASELINE_SEQUENCE) return "adopted";
  if (migration.id === "0023_production_migration_ledger") return "bootstrap";
  return "executed";
}

function checksum(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function validateRuntimeDatabaseRole(runtimeDatabaseRole) {
  if (
    typeof runtimeDatabaseRole !== "string" ||
    !/^[a-z_][a-z0-9_]{0,62}$/u.test(runtimeDatabaseRole)
  ) {
    fail(
      "Runtime database role must be an explicit lowercase PostgreSQL role name",
    );
  }
  return runtimeDatabaseRole;
}

export function buildAuthRuntimeAclSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const quotedRole = `"${role}"`;
  return `
REVOKE ALL ON TABLE
  public."user",
  public.account
FROM PUBLIC;

REVOKE ALL ON TABLE
  public."user",
  public.account
FROM ${quotedRole};

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."user", public.account
  TO ${quotedRole};
`;
}

/**
 * A true result means the runtime role is missing one of the authentication
 * lifecycle DML capabilities or has gained a privilege outside that contract.
 * Keep this condition beside the GRANT builder so migration normalization and
 * the production verifier cannot drift apart.
 */
export function buildAuthRuntimeAclViolationSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `(
    NOT pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public."user"',
      'SELECT, INSERT, UPDATE, DELETE'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.account',
      'SELECT, INSERT, UPDATE, DELETE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ]::text[]) AS elevated_privilege
      WHERE pg_catalog.has_table_privilege(
        ${sqlLiteral(role)},
        'public."user"',
        elevated_privilege
      )
      OR pg_catalog.has_table_privilege(
        ${sqlLiteral(role)},
        'public.account',
        elevated_privilege
      )
    )
  )`;
}

/**
 * Runtime readiness reads the legacy product-schema ledger only to prove destructive cutovers.
 * Keep that narrow read boundary separate from the deployment-only toonspectrum_ops ledger, which
 * the application role must never be able to inspect.
 */
export function buildRuntimeCutoverLedgerAclSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const quotedRole = `"${role}"`;
  return `
REVOKE ALL ON TABLE public.toonspectrum_schema_migration FROM PUBLIC;
REVOKE ALL ON TABLE public.toonspectrum_schema_migration FROM ${quotedRole};
GRANT SELECT ("id") ON TABLE public.toonspectrum_schema_migration TO ${quotedRole};
`;
}

/**
 * A true result means the readiness ledger is unreadable, writable, publicly exposed, or
 * delegable by the runtime role. Table and column checks are both required because PostgreSQL can
 * retain column grants independently of the table ACL.
 */
export function buildRuntimeCutoverLedgerAclViolationSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const roleLiteral = sqlLiteral(role);
  return `(
    NOT pg_catalog.has_column_privilege(
      ${roleLiteral},
      'public.toonspectrum_schema_migration',
      'id',
      'SELECT'
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.toonspectrum_schema_migration',
      'SELECT'
    )
    OR pg_catalog.has_column_privilege(
      ${roleLiteral},
      'public.toonspectrum_schema_migration',
      'appliedAt',
      'SELECT'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'INSERT',
        'UPDATE',
        'REFERENCES'
      ]::text[]) AS unexpected_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.toonspectrum_schema_migration',
        unexpected_column_privilege
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.toonspectrum_schema_migration',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.toonspectrum_schema_migration',
      'SELECT WITH GRANT OPTION'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'REFERENCES'
      ]::text[]) AS public_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        0::oid,
        'public.toonspectrum_schema_migration',
        public_column_privilege
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS public_table_privilege
      WHERE pg_catalog.has_table_privilege(
        0::oid,
        'public.toonspectrum_schema_migration',
        public_table_privilege
      )
    )
  )`;
}

export function buildCreatorMarketplaceRuntimeAclSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const quotedRole = `"${role}"`;
  return `
DO $creator_marketplace_acl$
DECLARE
  relation_name text;
  column_list text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'creator_marketplace_resource',
    'creator_marketplace_library_item',
    'creator_marketplace_package_moderation',
    'creator_marketplace_package_moderation_decision',
    'creator_marketplace_publish_gate',
    'creator_marketplace_resource_report',
    'creator_marketplace_resource_report_gate'
  ]::text[] LOOP
    SELECT string_agg(format('%I', attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO column_list
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = format('public.%I', relation_name)::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %I',
      column_list,
      relation_name,
      ${sqlLiteral(role)}
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC',
      column_list,
      relation_name
    );
  END LOOP;
END
$creator_marketplace_acl$;

REVOKE ALL ON TABLE
  public.creator_marketplace_resource,
  public.creator_marketplace_library_item,
  public.creator_marketplace_package_moderation,
  public.creator_marketplace_package_moderation_decision,
  public.creator_marketplace_publish_gate,
  public.creator_marketplace_resource_report,
  public.creator_marketplace_resource_report_gate
FROM PUBLIC;

REVOKE ALL ON TABLE
  public.creator_marketplace_resource,
  public.creator_marketplace_library_item,
  public.creator_marketplace_package_moderation,
  public.creator_marketplace_package_moderation_decision,
  public.creator_marketplace_publish_gate,
  public.creator_marketplace_resource_report,
  public.creator_marketplace_resource_report_gate
FROM ${quotedRole};

GRANT SELECT, INSERT
  ON TABLE public.creator_marketplace_resource
  TO ${quotedRole};
GRANT UPDATE ("delistedAt", "updatedAt")
  ON TABLE public.creator_marketplace_resource
  TO ${quotedRole};

GRANT SELECT, INSERT
  ON TABLE public.creator_marketplace_library_item
  TO ${quotedRole};
GRANT UPDATE (
  "archivedAt",
  "lastConfirmedReleaseId",
  "lastConfirmedResourceVersion",
  "lastConfirmedReleaseOrdinal",
  "lastConfirmedManifestHash",
  "firstConfirmedAt",
  "lastConfirmedAt",
  "updatedAt"
)
  ON TABLE public.creator_marketplace_library_item
  TO ${quotedRole};

GRANT SELECT, INSERT
  ON TABLE public.creator_marketplace_package_moderation
  TO ${quotedRole};
GRANT UPDATE (
  "state",
  "revision",
  "currentDecisionId",
  "hiddenAt",
  "updatedAt"
)
  ON TABLE public.creator_marketplace_package_moderation
  TO ${quotedRole};

GRANT SELECT, INSERT
  ON TABLE public.creator_marketplace_package_moderation_decision
  TO ${quotedRole};

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.creator_marketplace_publish_gate
  TO ${quotedRole};

GRANT SELECT, INSERT
  ON TABLE public.creator_marketplace_resource_report
  TO ${quotedRole};
GRANT UPDATE ("status", "resolutionNote", "reviewedBy", "reviewedAt")
  ON TABLE public.creator_marketplace_resource_report
  TO ${quotedRole};

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.creator_marketplace_resource_report_gate
  TO ${quotedRole};
`;
}

/**
 * Marketplace reads and writes run through a dedicated, non-owning runtime role. Keep its resource
 * and distributed admission tables on the smallest contract used by the repositories. Release
 * content is immutable after insert; release lifecycle writes are limited to owner list/relist
 * timestamps, while package moderation is authoritative in its own append-only decision/state
 * relations. Private cloud-library writes are limited to archive and monotonic confirmation facts.
 * Publish-gate rows require their existing bounded table-level updates.
 */
export function buildCreatorMarketplaceRuntimeAclViolationSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const roleLiteral = sqlLiteral(role);
  return `(
    NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'INSERT'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'REFERENCES'
      ]::text[]) AS unexpected_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource',
        unexpected_column_privilege
      )
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'UPDATE'
    )
    OR pg_catalog.has_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'hidden',
      'UPDATE'
    )
    OR NOT pg_catalog.has_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'delistedAt',
      'UPDATE'
    )
    OR NOT pg_catalog.has_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource',
      'updatedAt',
      'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS immutable_attribute
      WHERE immutable_attribute.attrelid =
        'public.creator_marketplace_resource'::regclass
        AND immutable_attribute.attnum > 0
        AND NOT immutable_attribute.attisdropped
        AND immutable_attribute.attname <>
          ALL(ARRAY['delistedAt', 'updatedAt']::name[])
        AND pg_catalog.has_column_privilege(
          ${roleLiteral},
          'public.creator_marketplace_resource',
          immutable_attribute.attname,
          'UPDATE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource',
        unexpected_table_privilege
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT'
      ]::text[]) AS delegable_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource',
        delegable_column_privilege || ' WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['delistedAt', 'updatedAt']::text[]) AS lifecycle_column
      WHERE pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource',
        lifecycle_column,
        'UPDATE WITH GRANT OPTION'
      )
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_library_item',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_library_item',
      'INSERT'
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_library_item',
      'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'archivedAt',
        'lastConfirmedReleaseId',
        'lastConfirmedResourceVersion',
        'lastConfirmedReleaseOrdinal',
        'lastConfirmedManifestHash',
        'firstConfirmedAt',
        'lastConfirmedAt',
        'updatedAt'
      ]::text[]) AS mutable_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_library_item',
        mutable_column,
        'UPDATE'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS immutable_attribute
      WHERE immutable_attribute.attrelid =
        'public.creator_marketplace_library_item'::regclass
        AND immutable_attribute.attnum > 0
        AND NOT immutable_attribute.attisdropped
        AND immutable_attribute.attname <> ALL(ARRAY[
          'archivedAt',
          'lastConfirmedReleaseId',
          'lastConfirmedResourceVersion',
          'lastConfirmedReleaseOrdinal',
          'lastConfirmedManifestHash',
          'firstConfirmedAt',
          'lastConfirmedAt',
          'updatedAt'
        ]::name[])
        AND pg_catalog.has_column_privilege(
          ${roleLiteral},
          'public.creator_marketplace_library_item',
          immutable_attribute.attname,
          'UPDATE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['DELETE', 'TRUNCATE', 'TRIGGER']::text[])
        AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_library_item',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_library_item',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['SELECT', 'INSERT']::text[]) AS delegable_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_library_item',
        delegable_privilege || ' WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'archivedAt',
        'lastConfirmedReleaseId',
        'lastConfirmedResourceVersion',
        'lastConfirmedReleaseOrdinal',
        'lastConfirmedManifestHash',
        'firstConfirmedAt',
        'lastConfirmedAt',
        'updatedAt'
      ]::text[]) AS mutable_column
      WHERE pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_library_item',
        mutable_column,
        'UPDATE WITH GRANT OPTION'
      )
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation',
      'INSERT'
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation',
      'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'revision',
        'currentDecisionId',
        'hiddenAt',
        'updatedAt'
      ]::text[]) AS mutable_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation',
        mutable_column,
        'UPDATE'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS immutable_attribute
      WHERE immutable_attribute.attrelid =
        'public.creator_marketplace_package_moderation'::regclass
        AND immutable_attribute.attnum > 0
        AND NOT immutable_attribute.attisdropped
        AND immutable_attribute.attname <> ALL(ARRAY[
          'state',
          'revision',
          'currentDecisionId',
          'hiddenAt',
          'updatedAt'
        ]::name[])
        AND pg_catalog.has_column_privilege(
          ${roleLiteral},
          'public.creator_marketplace_package_moderation',
          immutable_attribute.attname,
          'UPDATE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['DELETE', 'TRUNCATE', 'TRIGGER']::text[])
        AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['SELECT', 'INSERT']::text[]) AS delegable_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation',
        delegable_privilege || ' WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'revision',
        'currentDecisionId',
        'hiddenAt',
        'updatedAt'
      ]::text[]) AS mutable_column
      WHERE pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation',
        mutable_column,
        'UPDATE WITH GRANT OPTION'
      )
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation_decision',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation_decision',
      'INSERT'
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation_decision',
      'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation_decision',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_package_moderation_decision',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['SELECT', 'INSERT']::text[]) AS delegable_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_package_moderation_decision',
        delegable_privilege || ' WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE'
      ]::text[]) AS required_privilege
      WHERE NOT pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_publish_gate',
        required_privilege
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_publish_gate',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_publish_gate',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE'
      ]::text[]) AS delegable_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_publish_gate',
        delegable_column_privilege || ' WITH GRANT OPTION'
      )
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_publish_gate',
      'DELETE WITH GRANT OPTION'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report',
      'INSERT'
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report',
      'UPDATE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'status',
        'resolutionNote',
        'reviewedBy',
        'reviewedAt'
      ]::text[]) AS lifecycle_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report',
        lifecycle_column,
        'UPDATE'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS immutable_attribute
      WHERE immutable_attribute.attrelid =
        'public.creator_marketplace_resource_report'::regclass
        AND immutable_attribute.attnum > 0
        AND NOT immutable_attribute.attisdropped
        AND immutable_attribute.attname <> ALL(
          ARRAY['status', 'resolutionNote', 'reviewedBy', 'reviewedAt']::name[]
        )
        AND pg_catalog.has_column_privilege(
          ${roleLiteral},
          'public.creator_marketplace_resource_report',
          immutable_attribute.attname,
          'UPDATE'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT'
      ]::text[]) AS delegable_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report',
        delegable_column_privilege || ' WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'status',
        'resolutionNote',
        'reviewedBy',
        'reviewedAt'
      ]::text[]) AS lifecycle_column
      WHERE pg_catalog.has_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report',
        lifecycle_column,
        'UPDATE WITH GRANT OPTION'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE'
      ]::text[]) AS required_privilege
      WHERE NOT pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report_gate',
        required_privilege
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY['TRUNCATE', 'TRIGGER']::text[]) AS unexpected_table_privilege
      WHERE pg_catalog.has_table_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report_gate',
        unexpected_table_privilege
      )
    )
    OR pg_catalog.has_any_column_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report_gate',
      'REFERENCES'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE'
      ]::text[]) AS delegable_column_privilege
      WHERE pg_catalog.has_any_column_privilege(
        ${roleLiteral},
        'public.creator_marketplace_resource_report_gate',
        delegable_column_privilege || ' WITH GRANT OPTION'
      )
    )
    OR pg_catalog.has_table_privilege(
      ${roleLiteral},
      'public.creator_marketplace_resource_report_gate',
      'DELETE WITH GRANT OPTION'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.creator_marketplace_resource',
        'public.creator_marketplace_library_item',
        'public.creator_marketplace_package_moderation',
        'public.creator_marketplace_package_moderation_decision',
        'public.creator_marketplace_publish_gate',
        'public.creator_marketplace_resource_report',
        'public.creator_marketplace_resource_report_gate'
      ]::text[]) AS public_relation(relation_name)
      CROSS JOIN unnest(ARRAY[
        'SELECT',
        'INSERT',
        'UPDATE',
        'REFERENCES'
      ]::text[]) AS public_column_privilege(privilege_name)
      WHERE pg_catalog.has_any_column_privilege(
        0::oid,
        public_relation.relation_name,
        public_column_privilege.privilege_name
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'public.creator_marketplace_resource',
        'public.creator_marketplace_library_item',
        'public.creator_marketplace_package_moderation',
        'public.creator_marketplace_package_moderation_decision',
        'public.creator_marketplace_publish_gate',
        'public.creator_marketplace_resource_report',
        'public.creator_marketplace_resource_report_gate'
      ]::text[]) AS public_relation(relation_name)
      CROSS JOIN unnest(ARRAY[
        'DELETE',
        'TRUNCATE',
        'TRIGGER'
      ]::text[]) AS public_table_privilege(privilege_name)
      WHERE pg_catalog.has_table_privilege(
        0::oid,
        public_relation.relation_name,
        public_table_privilege.privilege_name
      )
    )
  )`;
}

export function buildCreatorAssetObjectStorageRuntimeAclSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const quotedRole = `"${role}"`;
  return `
REVOKE ALL ON TABLE
  public.creator_asset_storage_object,
  public.creator_work_asset_storage_reference
FROM PUBLIC;

REVOKE ALL ON TABLE
  public.creator_asset_storage_object,
  public.creator_work_asset_storage_reference
FROM ${quotedRole};

GRANT SELECT
  ON TABLE public.creator_asset_storage_object
  TO ${quotedRole};
GRANT INSERT (
  "purpose",
  "digest",
  "contractVersion",
  "objectPath",
  "byteLength",
  "contentType"
)
  ON TABLE public.creator_asset_storage_object
  TO ${quotedRole};
GRANT UPDATE ("state", "deleteToken", "updatedAt", "deletedAt")
  ON TABLE public.creator_asset_storage_object
  TO ${quotedRole};

GRANT SELECT, DELETE
  ON TABLE public.creator_work_asset_storage_reference
  TO ${quotedRole};
GRANT INSERT (
  "workId",
  "purpose",
  "referenceId",
  "objectDigest",
  "sourceAssetId",
  "createdBy"
)
  ON TABLE public.creator_work_asset_storage_reference
  TO ${quotedRole};
GRANT UPDATE ("state", "deleteToken", "updatedAt")
  ON TABLE public.creator_work_asset_storage_reference
  TO ${quotedRole};
`;
}

/**
 * A true result means the runtime role has either lost a required lifecycle
 * capability or gained a table/column capability outside the reviewed 0024
 * object-storage contract. Keep this condition beside the GRANT builder so
 * migration normalization and the production verifier cannot drift apart.
 */
export function buildCreatorAssetObjectStorageRuntimeAclViolationSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `(
    NOT pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.creator_asset_storage_object',
      'SELECT'
    )
    OR pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.creator_asset_storage_object',
      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'purpose',
        'digest',
        'contractVersion',
        'objectPath',
        'byteLength',
        'contentType'
      ]::text[]) AS insert_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_asset_storage_object',
        insert_column,
        'INSERT'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'deleteToken',
        'createdAt',
        'updatedAt',
        'deletedAt'
      ]::text[]) AS default_column
      WHERE pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_asset_storage_object',
        default_column,
        'INSERT'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'deleteToken',
        'updatedAt',
        'deletedAt'
      ]::text[]) AS lifecycle_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_asset_storage_object',
        lifecycle_column,
        'UPDATE'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'purpose',
        'digest',
        'contractVersion',
        'objectPath',
        'byteLength',
        'contentType',
        'createdAt'
      ]::text[]) AS immutable_column
      WHERE pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_asset_storage_object',
        immutable_column,
        'UPDATE'
      )
    )
    OR NOT pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.creator_work_asset_storage_reference',
      'SELECT'
    )
    OR NOT pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.creator_work_asset_storage_reference',
      'DELETE'
    )
    OR pg_catalog.has_table_privilege(
      ${sqlLiteral(role)},
      'public.creator_work_asset_storage_reference',
      'INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'workId',
        'purpose',
        'referenceId',
        'objectDigest',
        'sourceAssetId',
        'createdBy'
      ]::text[]) AS insert_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_work_asset_storage_reference',
        insert_column,
        'INSERT'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'deleteToken',
        'createdAt',
        'updatedAt'
      ]::text[]) AS default_column
      WHERE pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_work_asset_storage_reference',
        default_column,
        'INSERT'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'state',
        'deleteToken',
        'updatedAt'
      ]::text[]) AS lifecycle_column
      WHERE NOT pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_work_asset_storage_reference',
        lifecycle_column,
        'UPDATE'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'workId',
        'purpose',
        'referenceId',
        'objectDigest',
        'sourceAssetId',
        'createdBy',
        'createdAt'
      ]::text[]) AS immutable_column
      WHERE pg_catalog.has_column_privilege(
        ${sqlLiteral(role)},
        'public.creator_work_asset_storage_reference',
        immutable_column,
        'UPDATE'
      )
    )
  )`;
}

export function buildRuntimeDatabaseRoleBoundaryStateSql(
  runtimeDatabaseRole,
  { requireLogin = true } = {},
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  if (typeof requireLogin !== "boolean") {
    fail("Runtime database login boundary mode must be explicit");
  }
  const loginBoundary = requireLogin ? "\n            OR NOT rolcanlogin" : "";
  return `(
    SELECT CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = ${sqlLiteral(role)}
      ) THEN 'missing'
      WHEN current_user = ${sqlLiteral(role)} THEN 'same-role'
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = ${sqlLiteral(role)}
          AND (
            rolsuper
            OR rolcreaterole
            OR rolcreatedb
            OR rolreplication
            OR rolbypassrls${loginBoundary}
          )
      ) THEN 'unsafe-runtime-attributes'
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS inherited_role
        WHERE inherited_role.rolname <> ${sqlLiteral(role)}
          AND pg_catalog.pg_has_role(
            ${sqlLiteral(role)},
            inherited_role.rolname,
            'MEMBER'
          )
      ) THEN 'runtime-has-memberships'
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_database AS database_record
        JOIN pg_catalog.pg_roles AS owner
          ON owner.oid = database_record.datdba
        WHERE database_record.datname = current_database()
          AND owner.rolname = ${sqlLiteral(role)}
      ) THEN 'runtime-owns-database'
      WHEN pg_catalog.has_database_privilege(
        ${sqlLiteral(role)},
        current_database(),
        'CREATE'
      ) THEN 'runtime-can-create-database-objects'
      WHEN NOT pg_catalog.has_database_privilege(
        ${sqlLiteral(role)},
        current_database(),
        'CONNECT'
      ) THEN 'runtime-cannot-connect'
      WHEN NOT pg_catalog.has_schema_privilege(
        ${sqlLiteral(role)},
        'public',
        'USAGE'
      ) THEN 'runtime-cannot-use-public-schema'
      WHEN pg_catalog.has_schema_privilege(
        ${sqlLiteral(role)},
        'public',
        'CREATE'
      ) THEN 'runtime-can-create-public-objects'
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_roles AS owner
          ON owner.oid = relation.relowner
        WHERE namespace.nspname = 'public'
          AND owner.rolname = ${sqlLiteral(role)}
      ) THEN 'runtime-owns-public-relation'
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension AS extension_record
        JOIN pg_catalog.pg_roles AS owner
          ON owner.oid = extension_record.extowner
        WHERE owner.rolname = ${sqlLiteral(role)}
      ) THEN 'runtime-owns-extension'
      ELSE 'separated'
    END
  )`;
}

const MIGRATION_LEDGER_TABLE_PRIVILEGES = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
]);

export function buildMigrationLedgerRuntimeAclSql(runtimeDatabaseRole) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  return `
DO $toonspectrum_ops_acl$
BEGIN
  EXECUTE 'REVOKE ALL ON SCHEMA toonspectrum_ops FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA toonspectrum_ops FROM PUBLIC';
  EXECUTE format(
    'REVOKE ALL ON SCHEMA toonspectrum_ops FROM %I',
    ${sqlLiteral(role)}
  );
  EXECUTE format(
    'REVOKE ALL ON ALL TABLES IN SCHEMA toonspectrum_ops FROM %I',
    ${sqlLiteral(role)}
  );
END
$toonspectrum_ops_acl$;
`;
}

export function buildMigrationLedgerRuntimeAclViolationSql(
  runtimeDatabaseRole,
) {
  const role = validateRuntimeDatabaseRole(runtimeDatabaseRole);
  const privileges = MIGRATION_LEDGER_TABLE_PRIVILEGES.map(sqlLiteral).join(
    ",\n      ",
  );
  return `(
    pg_catalog.has_schema_privilege(
      ${sqlLiteral(role)},
      'toonspectrum_ops',
      'USAGE'
    )
    OR pg_catalog.has_schema_privilege(
      ${sqlLiteral(role)},
      'toonspectrum_ops',
      'CREATE'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        ${privileges}
      ]::text[]) AS privilege_name
      WHERE pg_catalog.has_table_privilege(
        ${sqlLiteral(role)},
        'toonspectrum_ops.deployment_migration',
        privilege_name
      )
      OR pg_catalog.has_table_privilege(
        ${sqlLiteral(role)},
        'toonspectrum_ops.deployment_migration_lock',
        privilege_name
      )
    )
  )`;
}

function parseManifestLines(contents) {
  return contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function validateMigrationSequenceContinuity(manifest) {
  manifest.forEach((migration, index) => {
    const expectedSequence = index + 1;
    if (migration.sequence !== expectedSequence) {
      fail(
        `Production migration sequence must be continuous from 0001; expected ${String(expectedSequence).padStart(4, "0")} but found ${String(migration.sequence).padStart(4, "0")}`,
      );
    }
  });
  return manifest;
}

export function loadMigrationManifest({
  repositoryRoot = REPOSITORY_ROOT,
  manifestPath = MANIFEST_PATH,
  migrationDirectory = MIGRATION_DIRECTORY,
} = {}) {
  const paths = parseManifestLines(readFileSync(manifestPath, "utf8"));
  if (paths.length === 0) fail("Production migration manifest is empty");
  if (new Set(paths).size !== paths.length) {
    fail("Production migration manifest contains a duplicate path");
  }

  const expectedPaths = readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort()
    .map((name) => `apps/api/src/db/migrations/${name}`);
  if (
    paths.length !== expectedPaths.length ||
    paths.some((entry, index) => entry !== expectedPaths[index])
  ) {
    fail(
      "Production migration manifest must list every numbered SQL migration exactly once in lexical order",
    );
  }

  const manifest = paths.map((relativePath) => {
    if (!/^apps\/api\/src\/db\/migrations\/\d{4}_[a-z0-9_]+\.sql$/u.test(relativePath)) {
      fail(`Invalid production migration manifest path: ${relativePath}`);
    }
    const absolutePath = resolve(repositoryRoot, relativePath);
    if (
      !absolutePath.startsWith(
        `${resolve(repositoryRoot, "apps/api/src/db/migrations")}/`,
      )
    ) {
      fail(`Migration path escapes the migration directory: ${relativePath}`);
    }
    const contents = readFileSync(absolutePath, "utf8");
    const id = migrationId(relativePath);
    return Object.freeze({
      id,
      sequence: migrationSequence(id),
      relativePath,
      absolutePath,
      contents,
      checksum: checksum(contents),
    });
  });
  validateMigrationSequenceContinuity(manifest);
  return Object.freeze(manifest);
}

function adoptionMarkerChecksum(manifest) {
  const historicalContract = manifest
    .filter((migration) => migration.sequence <= ADOPTION_BASELINE_SEQUENCE)
    .map((migration) => `${migration.id}:${migration.checksum}\n`)
    .join("");
  return checksum(historicalContract);
}

function psql(databaseUrl, sql, { tuplesOnly = false } = {}) {
  const arguments_ = ["-X", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) arguments_.push("-A", "-q", "-t");
  const result = spawnSync("psql", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: createPsqlEnvironment(databaseUrl, {
      allowLoopback: true,
      baseEnvironment: { ...process.env, PSQLRC: "/dev/null" },
    }),
    input: sql,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    fail("Unable to execute psql", result.error);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    fail(details ? `PostgreSQL command failed: ${details}` : "PostgreSQL command failed");
  }
  return (result.stdout || "").trim();
}

function queryScalar(databaseUrl, sql) {
  return psql(databaseUrl, sql, { tuplesOnly: true }).split(/\r?\n/u)[0]?.trim() ?? "";
}

function ledgerExists(databaseUrl) {
  return (
    queryScalar(
      databaseUrl,
      `SELECT to_regclass(${sqlLiteral(LEDGER_RELATION)}) IS NOT NULL;`,
    ) === "t"
  );
}

function requireProvisionedBase(databaseUrl) {
  const ready = queryScalar(
    databaseUrl,
    `
      SELECT
        to_regclass('public."user"') IS NOT NULL
        AND to_regclass('public.creator_work') IS NOT NULL
        AND to_regclass('public.creator_work_live_lock') IS NOT NULL;
    `,
  );
  if (ready !== "t") {
    fail(
      "Production migration runner requires a provisioned base schema; bootstrap is a separate approved operation",
    );
  }
}

function requireMigrationRoleSeparation(
  databaseUrl,
  runtimeDatabaseRole,
  { requireRuntimeLogin = true } = {},
) {
  const boundaryState = queryScalar(
    databaseUrl,
    `SELECT ${buildRuntimeDatabaseRoleBoundaryStateSql(runtimeDatabaseRole, {
      requireLogin: requireRuntimeLogin,
    })};`,
  );
  if (boundaryState !== "separated") {
    fail(
      `Production migration role separation failed: ${boundaryState || "unknown"}`,
    );
  }
}

function hardenAndVerifyLedgerRuntimeAcl(
  databaseUrl,
  runtimeDatabaseRole,
) {
  psql(
    databaseUrl,
    `
      ${buildMigrationLedgerRuntimeAclSql(runtimeDatabaseRole)}

      DO $toonspectrum_ops_acl_verify$
      BEGIN
        IF ${buildMigrationLedgerRuntimeAclViolationSql(runtimeDatabaseRole)} THEN
          RAISE EXCEPTION
            'runtime database role retains migration schema or ledger privileges';
        END IF;
      END
      $toonspectrum_ops_acl_verify$;
    `,
  );
}

function loadHistoricalBaselineRelations() {
  const source = readFileSync(HEALTH_READINESS_SOURCE, "utf8");
  const block =
    /export const REQUIRED_DATABASE_RELATIONS = \[([\s\S]*?)\] as const/u.exec(
      source,
    )?.[1];
  if (!block) {
    fail(
      "Unable to derive historical adoption relations from the health readiness contract",
    );
  }
  const currentRelations = new Set(
    [...block.matchAll(/"([^"]+)"/gu)].map((match) => match[1]),
  );
  const classifiedRelations = new Set([
    ...HISTORICAL_BASELINE_RELATIONS,
    ...POST_BASELINE_RELATIONS,
  ]);
  const missingContractRelations = [...classifiedRelations].filter(
    (relation) => !currentRelations.has(relation),
  );
  const unclassifiedRuntimeRelations = [...currentRelations].filter(
    (relation) => !classifiedRelations.has(relation),
  );
  if (
    missingContractRelations.length > 0 ||
    unclassifiedRuntimeRelations.length > 0
  ) {
    fail(
      `Runtime readiness relations must exactly partition into through-0019 and post-baseline sets; missing=${missingContractRelations.join(", ") || "none"} unclassified=${unclassifiedRuntimeRelations.join(", ") || "none"}`,
    );
  }
  return HISTORICAL_BASELINE_RELATIONS;
}

export function buildHistoricalAdoptionVerificationSql() {
  const expectedRelations = loadHistoricalBaselineRelations()
    .map((relation) => sqlLiteral(relation))
    .join(",\n          ");
  return `
DO $toonspectrum_historical_adoption$
DECLARE
  missing_relations text[];
  invalid_constraints text[];
BEGIN
  SELECT array_agg(required_relation ORDER BY required_relation)
  INTO missing_relations
  FROM unnest(ARRAY[
          ${expectedRelations}
       ]::text[]) AS required_relation
  WHERE to_regclass(format('public.%I', required_relation)) IS NULL;

  IF missing_relations IS NOT NULL THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: required historical relations are missing: %',
      missing_relations;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.toonspectrum_schema_migration
    WHERE "id" = '0017_creator_work_live_lock_revision'
  ) THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: destructive 0017 cutover evidence is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    LEFT JOIN pg_catalog.pg_attrdef AS column_default
      ON column_default.adrelid = attribute.attrelid
      AND column_default.adnum = attribute.attnum
    WHERE attribute.attrelid =
      to_regclass('public.creator_work_live_lock')
      AND attribute.attname = 'revision'
      AND attribute.atttypid = 'bigint'::regtype
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND column_default.oid IS NULL
  ) THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: live-lock revision cutover shape is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      to_regclass('public.creator_work_team_comment_mutation')
      AND attribute.attname = 'messageId'
      AND NOT attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: nullable comment re-anchor receipt is missing';
  END IF;

  WITH expected(
    "relationName",
    "constraintName",
    "constraintType",
    "definitionToken"
  ) AS (
    VALUES
      ('creator_asset', 'creator_asset_published_rights_check', 'c', 'rightsConfirmedAt'),
      ('creator_asset_report', 'creator_asset_report_asset_reporter_unique', 'u', ''),
      ('creator_work_crdt_raster_checkpoint_job', 'creator_work_crdt_raster_checkpoint_job_state_check', 'c', 'completed'),
      ('creator_work_team_comment_activity', 'creator_work_team_comment_activity_action_check', 'c', 'reanchored'),
      ('creator_work_team_comment_mutation', 'creator_work_team_comment_mutation_operation_check', 'c', 'thread_reanchor'),
      ('creator_work_live_lock', 'creator_work_live_lock_revision_check', 'c', 'revision > 0'),
      ('creator_work_live_lock_clock', 'creator_work_live_lock_clock_revision_check', 'c', 'revision >= 0'),
      ('studio_ai_request_gate', 'studio_ai_request_gate_request_times_check', 'c', '10000'),
      ('studio_ai_request_gate', 'studio_ai_request_gate_lease_state_check', 'c', 'leaseTokenHash'),
      ('studio_ai_request_receipt', 'studio_ai_request_receipt_pkey', 'p', ''),
      ('studio_ai_request_receipt', 'studio_ai_request_receipt_user_request_unique', 'u', ''),
      ('studio_ai_request_receipt', 'studio_ai_request_receipt_userId_user_id_fk', 'f', ''),
      ('studio_ai_request_receipt', 'studio_ai_request_receipt_status_check', 'c', 'ambiguous'),
      ('studio_ai_request_receipt', 'studio_ai_request_receipt_attempt_count_check', 'c', 'attemptCount')
  )
  SELECT array_agg(
    expected."relationName" || '.' || expected."constraintName"
    ORDER BY expected."relationName", expected."constraintName"
  )
  INTO invalid_constraints
  FROM expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS actual
    WHERE actual.conrelid =
      to_regclass(format('public.%I', expected."relationName"))
      AND actual.conname = expected."constraintName"
      AND actual.contype = expected."constraintType"::"char"
      AND actual.convalidated
      AND (
        expected."definitionToken" = ''
        OR pg_catalog.pg_get_constraintdef(actual.oid, true)
          LIKE '%' || expected."definitionToken" || '%'
      )
  );

  IF invalid_constraints IS NOT NULL THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: historical constraints are incomplete: %',
      invalid_constraints;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_record
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_record.relnamespace
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_record.oid
    JOIN pg_catalog.pg_class AS indexed_table
      ON indexed_table.oid = index_state.indrelid
    WHERE index_namespace.nspname = 'public'
      AND index_record.relname = 'idx_studio_ai_request_receipt_expires'
      AND indexed_table.relname = 'studio_ai_request_receipt'
      AND index_record.relkind = 'i'
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indislive
      AND index_state.indnkeyatts = 1
      AND index_state.indnatts = 1
      AND index_state.indexprs IS NULL
      AND index_state.indpred IS NULL
      AND pg_catalog.pg_get_indexdef(index_record.oid)
        LIKE '%("expiresAt")%'
  ) THEN
    RAISE EXCEPTION
      'cannot adopt through 0019: AI receipt expiry index is missing';
  END IF;
END
$toonspectrum_historical_adoption$;
`;
}

function verifyHistoricalAdoptionCapabilities(databaseUrl) {
  psql(databaseUrl, buildHistoricalAdoptionVerificationSql());
}

function readLedger(databaseUrl) {
  const output = psql(
    databaseUrl,
    `
      SELECT "id", "checksum", "state", "provenance", "releaseSha"
      FROM ${LEDGER_RELATION}
      ORDER BY "id";
    `,
    { tuplesOnly: true },
  );
  const entries = new Map();
  if (!output) return entries;
  for (const line of output.split(/\r?\n/u)) {
    const [id, storedChecksum, state, provenance, releaseSha] = line.split("|");
    if (!id || !storedChecksum || !state || !provenance || !releaseSha) {
      fail("Production migration ledger returned an invalid row");
    }
    entries.set(id, {
      id,
      checksum: storedChecksum,
      state,
      provenance,
      releaseSha,
    });
  }
  return entries;
}

export function decideMigrationAction({
  migration,
  ledgerEntry,
  mode,
  adoptionMarkerPresent,
}) {
  if (ledgerEntry) {
    if (ledgerEntry.checksum !== migration.checksum) {
      fail(
        `Migration checksum drift detected for ${migration.id}; create a new forward migration instead of editing history`,
      );
    }
    const expectedProvenance = expectedMigrationProvenance(migration);
    if (ledgerEntry.provenance !== expectedProvenance) {
      fail(
        `Migration provenance drift detected for ${migration.id}; expected ${expectedProvenance}`,
      );
    }
    if (ledgerEntry.state === "applied") return "skip";
    if (mode === "repair" && ["applying", "failed"].includes(ledgerEntry.state)) {
      return "repair";
    }
    fail(
      `Migration ${migration.id} is ${ledgerEntry.state}; use the explicit repair boundary`,
    );
  }

  if (mode === "adopt" && migration.sequence <= ADOPTION_BASELINE_SEQUENCE) {
    return "adopt";
  }
  if (mode === "repair") {
    fail(
      `Repair cannot create missing migration ${migration.id}; use adopt for reviewed history or apply for a pending migration`,
    );
  }
  if (!adoptionMarkerPresent || migration.sequence <= ADOPTION_BASELINE_SEQUENCE) {
    fail(
      `Historical migration ${migration.id} has no adopted ledger record; run the explicit adoption boundary`,
    );
  }
  return "apply";
}

export function buildRepairLockTakeoverSql(staleLockOwnerToken = "") {
  return `
    WITH current_lock AS MATERIALIZED (
      SELECT "ownerToken", "acquiredAt"
      FROM ${LOCK_RELATION}
      WHERE "singleton" = true
      FOR UPDATE
    ),
    removed AS (
      DELETE FROM ${LOCK_RELATION} AS lock
      USING current_lock
      WHERE lock."singleton" = true
        AND lock."ownerToken" = current_lock."ownerToken"
        AND current_lock."ownerToken" =
          ${sqlLiteral(staleLockOwnerToken)}
        AND current_lock."acquiredAt" <=
          statement_timestamp() - interval ${sqlLiteral(REPAIR_LOCK_STALE_AFTER)}
      RETURNING lock."ownerToken"
    )
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM current_lock) THEN 'absent'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'stale-removed'
      WHEN ${sqlLiteral(staleLockOwnerToken)} = '' THEN 'token-required'
      WHEN NOT EXISTS (
        SELECT 1
        FROM current_lock
        WHERE "ownerToken" = ${sqlLiteral(staleLockOwnerToken)}
      ) THEN 'owner-mismatch'
      ELSE 'active'
    END;
  `;
}

function acquireRunnerLock(
  databaseUrl,
  releaseSha,
  mode,
  staleLockOwnerToken,
) {
  if (mode === "repair") {
    const takeoverState = queryScalar(
      databaseUrl,
      buildRepairLockTakeoverSql(staleLockOwnerToken),
    );
    if (takeoverState === "token-required") {
      fail(
        "A stale lock owner token is required to repair an existing durable migration lock",
      );
    }
    if (takeoverState === "owner-mismatch") {
      fail("The supplied stale lock owner token does not match");
    }
    if (takeoverState === "active") {
      fail(
        `The durable migration lock is younger than ${REPAIR_LOCK_STALE_AFTER}; repair refuses to steal an active runner`,
      );
    }
    if (!["absent", "stale-removed"].includes(takeoverState)) {
      fail("Unable to establish the durable migration lock repair state");
    }
  }
  const ownerToken = randomBytes(32).toString("hex");
  const claimed = queryScalar(
    databaseUrl,
    `
      INSERT INTO ${LOCK_RELATION}
        ("singleton", "ownerToken", "releaseSha", "acquiredAt")
      VALUES (
        true,
        ${sqlLiteral(ownerToken)},
        ${sqlLiteral(releaseSha)},
        statement_timestamp()
      )
      ON CONFLICT ("singleton") DO NOTHING
      RETURNING "ownerToken";
    `,
  );
  if (claimed !== ownerToken) {
    fail(
      "Another migration runner owns the durable database lock; an interrupted lock requires the explicit repair boundary",
    );
  }
  return ownerToken;
}

function releaseRunnerLock(databaseUrl, ownerToken) {
  psql(
    databaseUrl,
    `
      DELETE FROM ${LOCK_RELATION}
      WHERE "singleton" = true
        AND "ownerToken" = ${sqlLiteral(ownerToken)};
    `,
    { tuplesOnly: true },
  );
}

function claimMigration(databaseUrl, migration, releaseSha, action) {
  const overwriteIncomplete = action === "repair";
  const result = queryScalar(
    databaseUrl,
    `
      INSERT INTO ${LEDGER_RELATION} AS existing (
        "id",
        "checksum",
        "state",
        "provenance",
        "releaseSha",
        "startedAt",
        "appliedAt",
        "updatedAt"
      )
      VALUES (
        ${sqlLiteral(migration.id)},
        ${sqlLiteral(migration.checksum)},
        'applying',
        'executed',
        ${sqlLiteral(releaseSha)},
        statement_timestamp(),
        NULL,
        statement_timestamp()
      )
      ON CONFLICT ("id") DO UPDATE
      SET
        "state" = 'applying',
        "provenance" = 'executed',
        "releaseSha" = EXCLUDED."releaseSha",
        "startedAt" = EXCLUDED."startedAt",
        "appliedAt" = NULL,
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE ${overwriteIncomplete ? "true" : "false"}
        AND existing."checksum" = EXCLUDED."checksum"
        AND existing."state" IN ('applying', 'failed')
      RETURNING "id";
    `,
  );
  if (result !== migration.id) {
    fail(`Migration ${migration.id} could not claim its ledger state`);
  }
}

function markMigrationApplied(databaseUrl, migration, releaseSha) {
  const updated = queryScalar(
    databaseUrl,
    `
      UPDATE ${LEDGER_RELATION}
      SET
        "state" = 'applied',
        "appliedAt" = statement_timestamp(),
        "updatedAt" = statement_timestamp()
      WHERE "id" = ${sqlLiteral(migration.id)}
        AND "checksum" = ${sqlLiteral(migration.checksum)}
        AND "releaseSha" = ${sqlLiteral(releaseSha)}
        AND "state" = 'applying'
      RETURNING "id";
    `,
  );
  if (updated !== migration.id) {
    fail(`Migration ${migration.id} committed but its ledger acknowledgement failed`);
  }
}

function markMigrationFailed(databaseUrl, migration, releaseSha) {
  try {
    psql(
      databaseUrl,
      `
        UPDATE ${LEDGER_RELATION}
        SET
          "state" = 'failed',
          "updatedAt" = statement_timestamp()
        WHERE "id" = ${sqlLiteral(migration.id)}
          AND "checksum" = ${sqlLiteral(migration.checksum)}
          AND "releaseSha" = ${sqlLiteral(releaseSha)}
          AND "state" = 'applying';
      `,
      { tuplesOnly: true },
    );
  } catch {
    // An unknown connection outcome deliberately leaves `applying`, which is also fail-closed.
  }
}

function applyMigration(databaseUrl, migration, releaseSha, action) {
  claimMigration(databaseUrl, migration, releaseSha, action);
  process.stdout.write(`Applying ${migration.id} ...\n`);
  try {
    psql(databaseUrl, migration.contents);
    markMigrationApplied(databaseUrl, migration, releaseSha);
  } catch (error) {
    markMigrationFailed(databaseUrl, migration, releaseSha);
    throw error;
  }
}

function recordBootstrappedLedgerMigration(
  databaseUrl,
  migration,
  releaseSha,
) {
  psql(
    databaseUrl,
    `
      INSERT INTO ${LEDGER_RELATION} AS existing (
        "id",
        "checksum",
        "state",
        "provenance",
        "releaseSha",
        "startedAt",
        "appliedAt",
        "updatedAt"
      )
      VALUES (
        ${sqlLiteral(migration.id)},
        ${sqlLiteral(migration.checksum)},
        'applied',
        'bootstrap',
        ${sqlLiteral(releaseSha)},
        statement_timestamp(),
        statement_timestamp(),
        statement_timestamp()
      )
      ON CONFLICT ("id") DO NOTHING;
    `,
  );
}

function recordHistoricalAdoption(databaseUrl, manifest, releaseSha) {
  const historicalMigrations = manifest.filter(
    (migration) => migration.sequence <= ADOPTION_BASELINE_SEQUENCE,
  );
  const adoptedValues = historicalMigrations
    .map(
      (migration) =>
        `(${sqlLiteral(migration.id)}, ${sqlLiteral(migration.checksum)})`,
    )
    .join(",\n          ");
  psql(
    databaseUrl,
    `
      BEGIN;

      WITH adopted("id", "checksum") AS (
        VALUES
          ${adoptedValues}
      )
      INSERT INTO ${LEDGER_RELATION} (
        "id",
        "checksum",
        "state",
        "provenance",
        "releaseSha",
        "startedAt",
        "appliedAt",
        "updatedAt"
      )
      SELECT
        adopted."id",
        adopted."checksum",
        'applied',
        'adopted',
        ${sqlLiteral(releaseSha)},
        statement_timestamp(),
        statement_timestamp(),
        statement_timestamp()
      FROM adopted
      ON CONFLICT ("id") DO NOTHING;

      DO $toonspectrum_adoption_record$
      DECLARE
        invalid_rows text[];
      BEGIN
        WITH adopted("id", "checksum") AS (
          VALUES
            ${adoptedValues}
        )
        SELECT array_agg(adopted."id" ORDER BY adopted."id")
        INTO invalid_rows
        FROM adopted
        LEFT JOIN ${LEDGER_RELATION} AS recorded
          ON recorded."id" = adopted."id"
        WHERE recorded."id" IS NULL
          OR recorded."checksum" <> adopted."checksum"
          OR recorded."state" <> 'applied'
          OR recorded."provenance" <> 'adopted'
          OR recorded."appliedAt" IS NULL;

        IF invalid_rows IS NOT NULL THEN
          RAISE EXCEPTION
            'historical adoption ledger conflicts with reviewed checksums: %',
            invalid_rows;
        END IF;
      END
      $toonspectrum_adoption_record$;

      COMMIT;
    `,
  );
}

function recordAdoptionMarker(databaseUrl, manifest, releaseSha) {
  const markerChecksum = adoptionMarkerChecksum(manifest);
  const result = queryScalar(
    databaseUrl,
    `
      INSERT INTO ${LEDGER_RELATION} AS existing (
        "id",
        "checksum",
        "state",
        "provenance",
        "releaseSha",
        "startedAt",
        "appliedAt",
        "updatedAt"
      )
      VALUES (
        ${sqlLiteral(ADOPTION_MARKER_ID)},
        ${sqlLiteral(markerChecksum)},
        'applied',
        'adopted',
        ${sqlLiteral(releaseSha)},
        statement_timestamp(),
        statement_timestamp(),
        statement_timestamp()
      )
      ON CONFLICT ("id") DO UPDATE
      SET "updatedAt" = EXCLUDED."updatedAt"
      WHERE existing."checksum" = EXCLUDED."checksum"
        AND existing."state" = 'applied'
        AND existing."provenance" = 'adopted'
      RETURNING "id";
    `,
  );
  if (result !== ADOPTION_MARKER_ID) {
    fail("Historical adoption marker conflicts with the reviewed migration history");
  }
}

function validateAdoptionMarker(ledger, manifest) {
  const marker = ledger.get(ADOPTION_MARKER_ID);
  if (!marker) return false;
  if (
    marker.state !== "applied" ||
    marker.provenance !== "adopted" ||
    marker.checksum !== adoptionMarkerChecksum(manifest)
  ) {
    fail("Historical adoption marker is incomplete or has checksum drift");
  }
  return true;
}

function parseArguments(argv) { // NOSONAR javascript:S3776
  const values = new Map();
  const booleanFlags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-loopback") {
      if (booleanFlags.has(argument)) {
        fail(`Duplicate migration runner argument: ${argument}`);
      }
      booleanFlags.add(argument);
      continue;
    }
    if (
      ![
        "--mode",
        "--release-sha",
        "--confirmation",
        "--stale-lock-owner-token",
        "--runtime-database-role",
      ].includes(argument)
    ) {
      fail(`Unknown migration runner argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Migration runner argument ${argument} requires a value`);
    }
    if (values.has(argument)) {
      fail(`Duplicate migration runner argument: ${argument}`);
    }
    values.set(argument, value);
    index += 1; // NOSONAR javascript:S2310
  }

  const mode = values.get("--mode");
  if (!mode || !(mode in MODE_CONFIRMATIONS)) {
    fail("Migration mode must be apply, adopt, or repair");
  }
  const releaseSha = values.get("--release-sha") ?? "";
  if (!/^[0-9a-f]{40}$/u.test(releaseSha)) {
    fail("Migration release SHA must be a full lowercase 40-character commit SHA");
  }
  const confirmation = values.get("--confirmation") ?? "";
  if (confirmation !== MODE_CONFIRMATIONS[mode]) {
    fail(`Migration confirmation does not match the ${mode} boundary`);
  }
  const staleLockOwnerToken =
    values.get("--stale-lock-owner-token") ?? "";
  if (
    staleLockOwnerToken &&
    !/^[0-9a-f]{64}$/u.test(staleLockOwnerToken)
  ) {
    fail("Stale migration lock owner token must be 64 lowercase hex characters");
  }
  if (mode !== "repair" && staleLockOwnerToken) {
    fail("A stale migration lock owner token is valid only in repair mode");
  }
  const runtimeDatabaseRole = validateRuntimeDatabaseRole(
    values.get("--runtime-database-role") ?? "",
  );
  return {
    mode,
    releaseSha,
    staleLockOwnerToken,
    runtimeDatabaseRole,
    allowLoopback: booleanFlags.has("--allow-loopback"),
  };
}

export function runProductionDatabaseMigrations({ // NOSONAR javascript:S3776
  databaseUrl,
  mode,
  releaseSha,
  staleLockOwnerToken = "",
  runtimeDatabaseRole,
  allowLoopback = false,
  runtimeRoleLoginMode = "required",
}) {
  validateProductionDatabaseUrl(databaseUrl, { allowLoopback });
  validateRuntimeDatabaseRole(runtimeDatabaseRole);
  if (!mode || !(mode in MODE_CONFIRMATIONS)) {
    fail("Migration mode must be apply, adopt, or repair");
  }
  if (!/^[0-9a-f]{40}$/u.test(releaseSha)) {
    fail("Migration release SHA must be a full lowercase 40-character commit SHA");
  }
  if (
    staleLockOwnerToken &&
    !/^[0-9a-f]{64}$/u.test(staleLockOwnerToken)
  ) {
    fail("Stale migration lock owner token must be 64 lowercase hex characters");
  }
  if (mode !== "repair" && staleLockOwnerToken) {
    fail("A stale migration lock owner token is valid only in repair mode");
  }
  if (
    runtimeRoleLoginMode !== "required" &&
    runtimeRoleLoginMode !== "bootstrap-gated"
  ) {
    fail("Runtime role login mode must be required or bootstrap-gated");
  }
  requireMigrationRoleSeparation(databaseUrl, runtimeDatabaseRole, {
    requireRuntimeLogin: runtimeRoleLoginMode === "required",
  });
  requireProvisionedBase(databaseUrl);
  const manifest = loadMigrationManifest();
  const ledgerMigration = manifest.find(
    (migration) => migration.id === "0023_production_migration_ledger",
  );
  if (!ledgerMigration) fail("Migration manifest is missing the ledger bootstrap");

  if (!ledgerExists(databaseUrl)) {
    if (mode !== "adopt") {
      fail(
        "Production migration ledger is not initialized; only the explicit adoption boundary may create it",
      );
    }
    psql(databaseUrl, ledgerMigration.contents);
  }
  hardenAndVerifyLedgerRuntimeAcl(databaseUrl, runtimeDatabaseRole);

  let ownerToken;
  try {
    ownerToken = acquireRunnerLock(
      databaseUrl,
      releaseSha,
      mode,
      staleLockOwnerToken,
    );
    let ledger = readLedger(databaseUrl);
    if (!ledger.has(ledgerMigration.id)) {
      if (mode !== "adopt") {
        fail(
          "Migration ledger bootstrap row is missing; only the explicit adoption boundary may record it",
        );
      }
      recordBootstrappedLedgerMigration(
        databaseUrl,
        ledgerMigration,
        releaseSha,
      );
      ledger = readLedger(databaseUrl);
    }

    const ledgerBootstrapEntry = ledger.get(ledgerMigration.id);
    if (
      !ledgerBootstrapEntry ||
      ledgerBootstrapEntry.checksum !== ledgerMigration.checksum ||
      ledgerBootstrapEntry.state !== "applied" ||
      ledgerBootstrapEntry.provenance !== "bootstrap"
    ) {
      fail("Migration ledger bootstrap row is incomplete or has drift");
    }
    let markerPresent = validateAdoptionMarker(ledger, manifest);
    if (mode === "adopt" && markerPresent) {
      fail("Historical migration adoption is already complete; use apply mode");
    }
    if (mode !== "adopt" && !markerPresent) {
      fail(
        "Historical migration adoption marker is missing; use the explicit adoption boundary",
      );
    }

    let adopted = 0;
    if (mode === "adopt") {
      verifyHistoricalAdoptionCapabilities(databaseUrl);
      recordHistoricalAdoption(databaseUrl, manifest, releaseSha);
      recordAdoptionMarker(databaseUrl, manifest, releaseSha);
      adopted = manifest.filter(
        (migration) => migration.sequence <= ADOPTION_BASELINE_SEQUENCE,
      ).length;
      ledger = readLedger(databaseUrl);
      markerPresent = validateAdoptionMarker(ledger, manifest);
    }

    let applied = 0;
    let skipped = 0;
    for (const migration of manifest) {
      const action = decideMigrationAction({
        migration,
        ledgerEntry: ledger.get(migration.id),
        mode,
        adoptionMarkerPresent: markerPresent,
      });
      if (action === "skip") {
        skipped += 1;
        continue;
      }
      if (action === "adopt") {
        fail(
          `Historical migration ${migration.id} was not atomically recorded during adoption`,
        );
      }
      applyMigration(databaseUrl, migration, releaseSha, action);
      applied += 1;
      ledger = readLedger(databaseUrl);
    }

    // Normalize dynamic-role ACLs on every run. This also repairs providers that do not preserve
    // ALTER DEFAULT PRIVILEGES across independently owned migration and application roles.
    psql(databaseUrl, buildAuthRuntimeAclSql(runtimeDatabaseRole));
    psql(databaseUrl, buildFeedbackRuntimeAclSql(runtimeDatabaseRole));
    psql(databaseUrl, buildFeedbackCapabilitySql(runtimeDatabaseRole));
    psql(databaseUrl, buildRuntimeCutoverLedgerAclSql(runtimeDatabaseRole));
    psql(
      databaseUrl,
      buildCreatorMarketplaceRuntimeAclSql(runtimeDatabaseRole),
    );
    psql(
      databaseUrl,
      buildCreatorAssetObjectStorageRuntimeAclSql(runtimeDatabaseRole),
    );

    process.stdout.write(
      `Production migration manifest complete: ${adopted} adopted, ${applied} applied, ${skipped} checksum-verified skips\n`,
    );
    return { adopted, applied, skipped };
  } finally {
    if (ownerToken) releaseRunnerLock(databaseUrl, ownerToken);
  }
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const environmentStaleLockOwnerToken =
    process.env.MIGRATION_STALE_LOCK_OWNER_TOKEN ?? "";
  if (
    options.staleLockOwnerToken &&
    environmentStaleLockOwnerToken &&
    options.staleLockOwnerToken !== environmentStaleLockOwnerToken
  ) {
    fail("Conflicting stale migration lock owner tokens were supplied");
  }
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ??
    process.env.PRODUCTION_DATABASE_DIRECT_URL;
  return runProductionDatabaseMigrations({
    databaseUrl,
    ...options,
    staleLockOwnerToken:
      options.staleLockOwnerToken || environmentStaleLockOwnerToken,
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
      `${error instanceof Error ? error.message : "Production migration runner failed"}\n`,
    );
    process.exitCode = 1;
  }
}
