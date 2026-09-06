import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  CREATOR_MARKETPLACE_LEGACY_SEMVER_POSTGRES_PATTERN,
  CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SEMVER_POSTGRES_PATTERN,
} from "../../../web/src/shared/lib/creator-marketplace-semver";

import { creatorMarketplaceResources } from "./creator-marketplace-resource.schema";
import { bytea, users } from "./schema";

const SEMVER_MAX_SQL = sql.raw(String(CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS));
const SEMVER_SQL = sql.raw(
  `'${CREATOR_MARKETPLACE_SEMVER_POSTGRES_PATTERN.replaceAll("'", "''")}'`,
);
const LEGACY_SEMVER_SQL = sql.raw(
  `'${CREATOR_MARKETPLACE_LEGACY_SEMVER_POSTGRES_PATTERN.replaceAll("'", "''")}'`,
);

/**
 * Private account library membership plus the least amount of cross-device install evidence.
 *
 * A row represents a publisher/package identity, never one release or one device. Mutable FK
 * pointers may be nulled by lifecycle deletion; bounded package and release snapshots remain so
 * account history does not silently change meaning.
 */
export const creatorMarketplaceLibraryItems = pgTable(
  "creator_marketplace_library_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageKeyHash: bytea("packageKeyHash").notNull(),
    publisherId: text("publisherId").references(() => users.id, {
      onDelete: "set null",
    }),
    packageId: text("packageId").notNull(),
    kind: text("kind").notNull(),
    nameSnapshot: text("nameSnapshot").notNull(),
    addedFromReleaseId: text("addedFromReleaseId").references(
      () => creatorMarketplaceResources.id,
      { onDelete: "set null" },
    ),
    addedFromResourceVersion: text("addedFromResourceVersion").notNull(),
    addedFromReleaseOrdinal: integer("addedFromReleaseOrdinal").notNull(),
    addedFromManifestHash: text("addedFromManifestHash").notNull(),
    addedAt: timestamp("addedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull().defaultNow(),
    archivedAt: timestamp("archivedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    lastConfirmedReleaseId: text("lastConfirmedReleaseId").references(
      () => creatorMarketplaceResources.id,
      { onDelete: "set null" },
    ),
    lastConfirmedResourceVersion: text("lastConfirmedResourceVersion"),
    lastConfirmedReleaseOrdinal: integer("lastConfirmedReleaseOrdinal"),
    lastConfirmedManifestHash: text("lastConfirmedManifestHash"),
    firstConfirmedAt: timestamp("firstConfirmedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    lastConfirmedAt: timestamp("lastConfirmedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    updatedAt: timestamp("updatedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull().defaultNow(),
  },
  (table) => [
    unique("creator_marketplace_library_user_package_hash_unique").on(
      table.userId,
      table.packageKeyHash,
    ),
    uniqueIndex("creator_marketplace_library_user_raw_package_unique")
      .on(table.userId, table.publisherId, table.packageId)
      .where(sql`${table.publisherId} is not null`),
    index("idx_creator_marketplace_library_active")
      .on(table.userId, table.addedAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} is null`),
    index("idx_creator_marketplace_library_archived")
      .on(table.userId, table.addedAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} is not null`),
    check(
      "creator_marketplace_library_package_hash_check",
      sql`octet_length(${table.packageKeyHash}) = 32`,
    ),
    check(
      "creator_marketplace_library_package_id_check",
      sql`${table.packageId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'`,
    ),
    check(
      "creator_marketplace_library_kind_check",
      sql`${table.kind} in ('asset', 'brush', 'filter', 'palette', 'template', '3d-preset', '3d-asset')`,
    ),
    check(
      "creator_marketplace_library_name_check",
      sql`char_length(${table.nameSnapshot}) between 1 and 80 and ${table.nameSnapshot} = btrim(${table.nameSnapshot})`,
    ),
    check(
      "creator_marketplace_library_added_version_check",
      sql`char_length(${table.addedFromResourceVersion}) between 1 and ${SEMVER_MAX_SQL}
        and (${table.addedFromResourceVersion} ~ ${SEMVER_SQL}
          or ${table.addedFromResourceVersion} ~ ${LEGACY_SEMVER_SQL})`,
    ),
    check(
      "creator_marketplace_library_added_ordinal_check",
      sql`${table.addedFromReleaseOrdinal} between 1 and 2147483647`,
    ),
    check(
      "creator_marketplace_library_added_hash_check",
      sql`${table.addedFromManifestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "creator_marketplace_library_confirmation_state_check",
      sql`(
        ${table.lastConfirmedReleaseId} is null
        and ${table.lastConfirmedResourceVersion} is null
        and ${table.lastConfirmedReleaseOrdinal} is null
        and ${table.lastConfirmedManifestHash} is null
        and ${table.firstConfirmedAt} is null
        and ${table.lastConfirmedAt} is null
      ) or (
        ${table.lastConfirmedResourceVersion} is not null
        and char_length(${table.lastConfirmedResourceVersion}) between 1 and ${SEMVER_MAX_SQL}
        and (${table.lastConfirmedResourceVersion} ~ ${SEMVER_SQL}
          or ${table.lastConfirmedResourceVersion} ~ ${LEGACY_SEMVER_SQL})
        and ${table.lastConfirmedReleaseOrdinal} between 1 and 2147483647
        and ${table.lastConfirmedManifestHash} ~ '^[0-9a-f]{64}$'
        and ${table.firstConfirmedAt} is not null
        and ${table.lastConfirmedAt} is not null
      )`,
    ),
    check(
      "creator_marketplace_library_timestamp_check",
      sql`${table.updatedAt} >= ${table.addedAt}
        and (${table.archivedAt} is null or (
          ${table.archivedAt} >= ${table.addedAt}
          and ${table.updatedAt} >= ${table.archivedAt}
        ))
        and (${table.firstConfirmedAt} is null or (
          ${table.firstConfirmedAt} >= ${table.addedAt}
          and ${table.lastConfirmedAt} >= ${table.firstConfirmedAt}
          and ${table.updatedAt} >= ${table.lastConfirmedAt}
        ))`,
    ),
  ],
);
