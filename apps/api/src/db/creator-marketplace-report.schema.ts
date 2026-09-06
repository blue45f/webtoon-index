import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES,
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS,
} from "../../../web/src/shared/lib/creator-marketplace-resource-contract";

import { creatorMarketplaceResources } from "./creator-marketplace-resource.schema";
import { bytea, users } from "./schema";

import type {
  CreatorMarketplaceResourceReportEvidence,
} from "../../../web/src/shared/lib/creator-marketplace-resource-contract";

const CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES)
);
const CREATOR_MARKETPLACE_REPORT_DETAILS_MAX_CHARACTERS_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS)
);
const CREATOR_MARKETPLACE_MODERATION_NOTE_MAX_CHARACTERS_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS)
);

/**
 * One immutable evidence row per authenticated reporter and admitted package epoch. `resourceId`
 * may become null only through account-lifecycle cascading; the identity/epoch snapshots and
 * evidence JSON remain intact so a moderator's audit trail is not erased with the publisher.
 */
export const creatorMarketplaceResourceReports = pgTable(
  "creator_marketplace_resource_report",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    resourceId: text("resourceId").references(() => creatorMarketplaceResources.id, {
      onDelete: "set null",
    }),
    resourceSnapshotId: text("resourceSnapshotId").notNull(),
    packagePublisherIdSnapshot: text("packagePublisherIdSnapshot"),
    packageIdSnapshot: text("packageIdSnapshot"),
    packageModerationRevision: integer("packageModerationRevision"),
    packageReportEpoch: integer("packageReportEpoch"),
    reporterId: text("reporterId").references(() => users.id, {
      onDelete: "set null",
    }),
    reporterKeyHash: bytea("reporterKeyHash").notNull(),
    reason: text("reason").notNull(),
    details: text("details").notNull().default(""),
    evidence: jsonb("evidence")
      .$type<CreatorMarketplaceResourceReportEvidence>()
      .notNull(),
    status: text("status").notNull().default("open"),
    resolutionNote: text("resolutionNote").notNull().default(""),
    reviewedBy: text("reviewedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewedAt", { mode: "date", withTimezone: true }),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("creator_marketplace_resource_report_release_reporter_v1_unique")
      .on(table.resourceSnapshotId, table.reporterKeyHash)
      .where(sql`${table.evidence}->>'schemaVersion' = '1'`),
    index("idx_creator_marketplace_resource_report_queue").on(
      table.status,
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_creator_marketplace_resource_report_resource").on(
      table.resourceSnapshotId,
      table.createdAt.desc()
    ),
    index("idx_creator_marketplace_resource_report_package_queue").on(
      table.packagePublisherIdSnapshot,
      table.packageIdSnapshot,
      table.status,
      table.createdAt.desc(),
      table.id.desc()
    ),
    uniqueIndex("creator_marketplace_resource_report_package_reporter_v2_unique")
      .on(
        table.packagePublisherIdSnapshot,
        table.packageIdSnapshot,
        table.packageModerationRevision,
        table.reporterKeyHash
      )
      .where(sql`${table.evidence}->>'schemaVersion' = '2'`),
    uniqueIndex("creator_marketplace_resource_report_package_epoch_reporter_v3_unique")
      .on(
        table.packagePublisherIdSnapshot,
        table.packageIdSnapshot,
        table.packageModerationRevision,
        table.packageReportEpoch,
        table.reporterKeyHash
      )
      .where(sql`${table.evidence}->>'schemaVersion' = '3'`),
    index("idx_creator_marketplace_resource_report_reporter").on(
      table.reporterKeyHash,
      table.createdAt.desc()
    ),
    check(
      "creator_marketplace_resource_report_snapshot_id_check",
      sql`${table.resourceSnapshotId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`
    ),
    check(
      "creator_marketplace_resource_report_reporter_hash_check",
      sql`octet_length(${table.reporterKeyHash}) = 32`
    ),
    check(
      "creator_marketplace_resource_report_package_snapshot_check",
      sql`(
        ${table.packagePublisherIdSnapshot} is null
        and ${table.packageIdSnapshot} is null
        and ${table.packageModerationRevision} is null
        and ${table.packageReportEpoch} is null
      ) or (
        char_length(${table.packagePublisherIdSnapshot}) between 1 and 160
        and ${table.packageIdSnapshot} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
        and ${table.packageModerationRevision} >= 0
        and (${table.packageReportEpoch} is null or ${table.packageReportEpoch} >= 1)
      )`
    ),
    check(
      "creator_marketplace_resource_report_reason_check",
      sql`${table.reason} in ('copyright', 'unsafe', 'spam', 'misleading', 'other')`
    ),
    check(
      "creator_marketplace_resource_report_details_check",
      sql`char_length(${table.details}) <= ${CREATOR_MARKETPLACE_REPORT_DETAILS_MAX_CHARACTERS_SQL}`
    ),
    check(
      "creator_marketplace_resource_report_status_check",
      sql`${table.status} in ('open', 'resolved', 'dismissed')`
    ),
    check(
      "creator_marketplace_resource_report_resolution_note_check",
      sql`char_length(${table.resolutionNote}) <= ${CREATOR_MARKETPLACE_MODERATION_NOTE_MAX_CHARACTERS_SQL}`
    ),
    check(
      "creator_marketplace_resource_report_resolution_state_check",
      sql`(
        ${table.status} = 'open'
        and ${table.resolutionNote} = ''
        and ${table.reviewedBy} is null
        and ${table.reviewedAt} is null
      ) or (
        ${table.status} in ('resolved', 'dismissed')
        and char_length(${table.resolutionNote}) between 1 and ${CREATOR_MARKETPLACE_MODERATION_NOTE_MAX_CHARACTERS_SQL}
        and ${table.reviewedAt} is not null
      )`
    ),
    check(
      "creator_marketplace_resource_report_evidence_check",
      sql`(
        jsonb_typeof(${table.evidence}) = 'object'
        and ${table.evidence}->>'resourceId' = ${table.resourceSnapshotId}
        and (${table.resourceId} is null or ${table.evidence}->>'resourceId' = ${table.resourceId})
        and ${table.evidence}->>'manifestHash' ~ '^[0-9a-f]{64}$'
        and (${table.evidence}->>'manifestByteSize')::integer between 1 and ${CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES_SQL}
        and ${table.evidence}->>'kind' in ('asset', 'brush', 'filter', 'palette', 'template', '3d-preset', '3d-asset')
        and ${table.evidence}->>'license' in ('toonspectrum-standard', 'cc0-1.0', 'cc-by-4.0', 'cc-by-nc-4.0')
        and (
          (
            ${table.evidence}->>'schemaVersion' = '1'
            and ${table.packageReportEpoch} is null
          )
          or (
            ${table.evidence}->>'schemaVersion' = '2'
            and ${table.packagePublisherIdSnapshot} is not null
            and ${table.packageIdSnapshot} is not null
            and ${table.packageModerationRevision} is not null
            and ${table.packageReportEpoch} is null
            and ${table.evidence}->>'publisherId' = ${table.packagePublisherIdSnapshot}
            and ${table.evidence}->>'packageId' = ${table.packageIdSnapshot}
            and (${table.evidence}->>'packageModerationRevision')::integer = ${table.packageModerationRevision}
          )
          or (
            ${table.evidence}->>'schemaVersion' = '3'
            and ${table.packagePublisherIdSnapshot} is not null
            and ${table.packageIdSnapshot} is not null
            and ${table.packageModerationRevision} is not null
            and ${table.packageReportEpoch} is not null
            and ${table.evidence}->>'publisherId' = ${table.packagePublisherIdSnapshot}
            and ${table.evidence}->>'packageId' = ${table.packageIdSnapshot}
            and (${table.evidence}->>'packageModerationRevision')::integer = ${table.packageModerationRevision}
            and (${table.evidence}->>'packageReportEpoch')::integer = ${table.packageReportEpoch}
          )
        )
      ) is true`
    ),
  ]
);

/** Privacy-minimal distributed fixed-window admission for authenticated report submissions. */
export const creatorMarketplaceResourceReportGates = pgTable(
  "creator_marketplace_resource_report_gate",
  {
    keyHash: bytea("keyHash").primaryKey(),
    windowStartedAt: timestamp("windowStartedAt", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    requestCount: integer("requestCount").notNull(),
    expiresAt: timestamp("expiresAt", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_creator_marketplace_resource_report_gate_expires").on(table.expiresAt),
    check(
      "creator_marketplace_resource_report_gate_key_hash_check",
      sql`octet_length(${table.keyHash}) = 32`
    ),
    check(
      "creator_marketplace_resource_report_gate_window_check",
      sql`${table.windowStartedAt} = date_bin(
        interval '1 day',
        ${table.windowStartedAt},
        timestamptz '1970-01-01 00:00:00+00'
      )`
    ),
    check(
      "creator_marketplace_resource_report_gate_request_count_check",
      sql`${table.requestCount} between 1 and 20`
    ),
    check(
      "creator_marketplace_resource_report_gate_retention_check",
      sql`${table.expiresAt} = ${table.windowStartedAt} + interval '2 days'`
    ),
    check(
      "creator_marketplace_resource_report_gate_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`
    ),
  ]
);
