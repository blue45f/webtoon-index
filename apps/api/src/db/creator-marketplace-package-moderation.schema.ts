import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS,
} from "../../../web/src/shared/lib/creator-marketplace-resource-contract";

import { creatorMarketplaceResourceReports } from "./creator-marketplace-report.schema";
import { users } from "./schema";

const MODERATION_NOTE_MAX_CHARACTERS_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS)
);

/**
 * Immutable package-scoped moderation decisions. Publisher/package values are snapshots rather
 * than foreign keys so deleting an account cannot erase the administrative audit trail.
 */
export const creatorMarketplacePackageModerationDecisions = pgTable(
  "creator_marketplace_package_moderation_decision",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publisherIdSnapshot: text("publisherIdSnapshot").notNull(),
    packageIdSnapshot: text("packageIdSnapshot").notNull(),
    revision: integer("revision").notNull(),
    action: text("action").notNull(),
    actorKind: text("actorKind").notNull().default("admin"),
    reviewerId: text("reviewerId").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull(),
    sourceResourceSnapshotId: text("sourceResourceSnapshotId"),
    sourceReportId: text("sourceReportId").references(
      () => creatorMarketplaceResourceReports.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("createdAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("creator_marketplace_package_moderation_decision_revision_unique").on(
      table.publisherIdSnapshot,
      table.packageIdSnapshot,
      table.revision
    ),
    index("idx_creator_marketplace_package_moderation_decision_package").on(
      table.publisherIdSnapshot,
      table.packageIdSnapshot,
      table.revision.desc()
    ),
    check(
      "creator_marketplace_package_moderation_decision_pkg_id_check",
      sql`${table.packageIdSnapshot} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'`
    ),
    check(
      "creator_marketplace_package_moderation_decision_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "creator_marketplace_package_moderation_decision_action_check",
      sql`${table.action} in ('hide', 'restore')`
    ),
    check(
      "creator_marketplace_package_moderation_decision_actor_check",
      // reviewerId may later become null through FK ON DELETE SET NULL. The insert trigger below
      // the Drizzle contract requires an administrator on the initial decision.
      sql`${table.actorKind} = 'admin' or (
        ${table.actorKind} = 'system' and ${table.reviewerId} is null
      )`
    ),
    check(
      "creator_marketplace_package_moderation_decision_note_check",
      sql`char_length(${table.note}) between 1 and ${MODERATION_NOTE_MAX_CHARACTERS_SQL}`
    ),
    check(
      "creator_marketplace_package_moderation_decision_source_id_check",
      sql`${table.sourceResourceSnapshotId} is null or ${table.sourceResourceSnapshotId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`
    ),
  ]
);

/**
 * The single runtime visibility authority for a publisher/package identity. Release-row `hidden`
 * remains only as a 0031/0032 migration marker and must not be consulted by runtime code.
 */
export const creatorMarketplacePackageModeration = pgTable(
  "creator_marketplace_package_moderation",
  {
    publisherId: text("publisherId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: text("packageId").notNull(),
    state: text("state").notNull().default("active"),
    revision: integer("revision").notNull().default(0),
    currentDecisionId: text("currentDecisionId").references(
      () => creatorMarketplacePackageModerationDecisions.id
    ),
    hiddenAt: timestamp("hiddenAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    updatedAt: timestamp("updatedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "creator_marketplace_package_moderation_pkey",
      columns: [table.publisherId, table.packageId],
    }),
    index("idx_creator_marketplace_package_moderation_state").on(
      table.state,
      table.updatedAt.desc(),
      table.publisherId,
      table.packageId
    ),
    check(
      "creator_marketplace_package_moderation_package_id_check",
      sql`${table.packageId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'`
    ),
    check(
      "creator_marketplace_package_moderation_state_check",
      sql`${table.state} in ('active', 'hidden')`
    ),
    check(
      "creator_marketplace_package_moderation_revision_check",
      sql`${table.revision} >= 0`
    ),
    check(
      "creator_marketplace_package_moderation_state_shape_check",
      sql`(
        ${table.revision} = 0
        and ${table.state} = 'active'
        and ${table.currentDecisionId} is null
        and ${table.hiddenAt} is null
      ) or (
        ${table.revision} >= 1
        and ${table.currentDecisionId} is not null
        and (
          (${table.state} = 'active' and ${table.hiddenAt} is null)
          or (${table.state} = 'hidden' and ${table.hiddenAt} is not null)
        )
      )`
    ),
  ]
);
