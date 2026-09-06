import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES,
} from "../../../web/src/shared/lib/creator-marketplace-resource-contract";
import {
  CREATOR_MARKETPLACE_LEGACY_SEMVER_POSTGRES_PATTERN,
  CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SEMVER_POSTGRES_PATTERN,
} from "../../../web/src/shared/lib/creator-marketplace-semver";

import { users } from "./schema";

import type {
  CreatorMarketplaceResourceManifest,
} from "../../../web/src/shared/lib/creator-marketplace-resource-contract";

// Drizzle parameterizes primitive `${value}` interpolations as `$1`. PostgreSQL does not accept
// parameters inside a CHECK constraint created by `drizzle-kit push`, so render this trusted,
// compile-time integer as a literal. Never replace this with request- or environment-derived text.
const CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES)
);
const CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS_SQL = sql.raw(
  String(CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS)
);
const CREATOR_MARKETPLACE_SEMVER_PATTERN_SQL = sql.raw(
  `'${CREATOR_MARKETPLACE_SEMVER_POSTGRES_PATTERN.replaceAll("'", "''")}'`
);
const CREATOR_MARKETPLACE_LEGACY_SEMVER_PATTERN_SQL = sql.raw(
  `'${CREATOR_MARKETPLACE_LEGACY_SEMVER_POSTGRES_PATTERN.replaceAll("'", "''")}'`
);

/**
 * Marketplace rows deliberately store only a bounded declarative manifest. Raster/model binaries
 * remain in the existing private work-asset or static built-in pipelines, keeping public catalog
 * reads cheap and preventing this table from becoming an unbounded blob store.
 */
export const creatorMarketplaceResources = pgTable(
  "creator_marketplace_resource",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    publisherId: text("publisherId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageId: text("packageId").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    kind: text("kind").notNull(),
    resourceVersion: text("resourceVersion").notNull(),
    // Immutable, publisher/package-scoped release order. The repository allocates this under a
    // transaction advisory lock; old rows never need an UPDATE when a new release is published.
    releaseOrdinal: integer("releaseOrdinal").notNull().default(1),
    // Contract 1 identifies immutable 0021-era rows whose numeric prerelease identifiers used
    // leading zeroes. New inserts always default to strict SemVer contract 2.
    semverContractVersion: smallint("semverContractVersion").notNull().default(2),
    minimumStudioVersion: text("minimumStudioVersion").notNull(),
    license: text("license").notNull(),
    provenanceOrigin: text("provenanceOrigin").notNull(),
    manifest: jsonb("manifest").$type<CreatorMarketplaceResourceManifest>().notNull(),
    manifestHash: text("manifestHash").notNull(),
    manifestByteSize: integer("manifestByteSize").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    // Owner-controlled unlisting is distinct from moderation `hidden`. The immutable row remains
    // available only to private identity/owner/confirmation boundaries; public exact detail does
    // not expose an explicitly delisted release or any release while the absolute head is delisted.
    delistedAt: timestamp("delistedAt", { mode: "date", withTimezone: true }),
    // Lower-cased, bounded metadata projection for pg_trgm. The manifest contract caps every
    // contributing field; binary/resource bodies are never copied into this search index.
    searchText: text("searchText").generatedAlwaysAs(
      sql`lower(
        "name"
        || ' ' || "description"
        || ' ' || "packageId"
        || ' ' || "tags"::text
      )`
    ),
    createdAt: timestamp("createdAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("creator_marketplace_resource_publisher_package_version_unique").on(
      table.publisherId,
      table.packageId,
      table.resourceVersion
    ),
    uniqueIndex("creator_marketplace_resource_publisher_manifest_hash_unique").on(
      table.publisherId,
      table.manifestHash
    ),
    uniqueIndex("creator_marketplace_resource_publisher_package_ordinal_unique").on(
      table.publisherId,
      table.packageId,
      table.releaseOrdinal
    ),
    uniqueIndex("creator_marketplace_resource_publisher_package_precedence_uniq").on(
      table.publisherId,
      table.packageId,
      sql`split_part(${table.resourceVersion}, '+', 1)`
    ),
    index("idx_creator_marketplace_resource_catalog").on(
      table.hidden,
      table.delistedAt,
      table.kind,
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_creator_marketplace_resource_publisher").on(
      table.publisherId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_creator_marketplace_resource_search")
      .using("gin", table.searchText.asc().op("gin_trgm_ops"))
      .where(sql`${table.delistedAt} is null`),
    index("idx_creator_marketplace_resource_tags")
      .using("gin", table.tags.asc().op("jsonb_path_ops"))
      .where(sql`${table.delistedAt} is null`),
    check(
      "creator_marketplace_resource_kind_check",
      sql`${table.kind} in ('asset', 'brush', 'filter', 'palette', 'template', '3d-preset', '3d-asset')`
    ),
    check(
      "creator_marketplace_resource_license_check",
      sql`${table.license} in ('toonspectrum-standard', 'cc0-1.0', 'cc-by-4.0', 'cc-by-nc-4.0')`
    ),
    check(
      "creator_marketplace_resource_origin_check",
      sql`${table.provenanceOrigin} in ('original', 'permissive')`
    ),
    check(
      "creator_marketplace_resource_package_id_check",
      sql`${table.packageId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'`
    ),
    check(
      "creator_marketplace_resource_version_check",
      sql`(
          ${table.semverContractVersion} = 2
          and char_length(${table.resourceVersion}) between 1 and ${CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS_SQL}
          and ${table.resourceVersion} ~ ${CREATOR_MARKETPLACE_SEMVER_PATTERN_SQL}
          and char_length(${table.minimumStudioVersion}) between 1 and ${CREATOR_MARKETPLACE_SEMVER_MAX_CHARACTERS_SQL}
          and ${table.minimumStudioVersion} ~ ${CREATOR_MARKETPLACE_SEMVER_PATTERN_SQL}
        ) or (
          ${table.semverContractVersion} = 1
          and ${table.resourceVersion} ~ ${CREATOR_MARKETPLACE_LEGACY_SEMVER_PATTERN_SQL}
          and ${table.minimumStudioVersion} ~ ${CREATOR_MARKETPLACE_LEGACY_SEMVER_PATTERN_SQL}
        )`
    ),
    check(
      "creator_marketplace_resource_release_ordinal_check",
      sql`${table.releaseOrdinal} >= 1`
    ),
    check(
      "creator_marketplace_resource_manifest_hash_check",
      sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "creator_marketplace_resource_manifest_size_check",
      sql`${table.manifestByteSize} between 1 and ${CREATOR_MARKETPLACE_RESOURCE_MAX_MANIFEST_BYTES_SQL}`
    ),
    check(
      "creator_marketplace_resource_manifest_shape_check",
      sql`(
        jsonb_typeof(${table.manifest}) = 'object'
        and ${table.manifest}->>'schemaVersion' = '1'
        and ${table.manifest}->>'packageId' = ${table.packageId}
        and ${table.manifest}->>'kind' = ${table.kind}
        and ${table.manifest}->>'resourceVersion' = ${table.resourceVersion}
        and ${table.manifest}->>'minimumStudioVersion' = ${table.minimumStudioVersion}
        and ${table.manifest}->>'license' = ${table.license}
        and ${table.manifest}->'provenance'->>'origin' = ${table.provenanceOrigin}
        and jsonb_typeof(${table.manifest}->'entries') = 'array'
        and jsonb_array_length(${table.manifest}->'entries') between 1 and 32
      ) is true`
    ),
  ]
);
