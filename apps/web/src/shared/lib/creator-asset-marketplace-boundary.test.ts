import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../../../../../apps/api/src/db/migrations/0013_creator_asset_marketplace.sql", import.meta.url),
  "utf8"
);
// creator 서버 로직은 server/creator/ 도메인 모듈로 분할됐다 — 배럴과 모듈 전체를 이어
// 읽어야 이 경계 검증이 분할 전과 같은 표면을 본다.
const creatorServerDir = new URL("../../../../../apps/api/src/server/creator/", import.meta.url);
const serverSource = [
  readFileSync(new URL("../../../../../apps/api/src/server/creator.ts", import.meta.url), "utf8"),
  ...readdirSync(creatorServerDir)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => readFileSync(new URL(name, creatorServerDir), "utf8")),
].join("\n");
const preflightSource = readFileSync(
  new URL("../../../../../apps/api/src/modules/creator/creator-asset-schema-preflight.ts",
    import.meta.url
  ),
  "utf8"
);
const checkFingerprintSource = readFileSync(
  new URL("../../../../../apps/api/src/common/postgres-check-definition.ts",
    import.meta.url
  ),
  "utf8"
);
const creatorModuleSource = readFileSync(
  new URL("../../../../../apps/api/src/modules/creator/creator.module.ts", import.meta.url),
  "utf8"
);
const ciSource = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const productionMigrationManifestSource = readFileSync(
  new URL("../../../../../scripts/production-database-migrations.manifest",
    import.meta.url
  ),
  "utf8"
);

describe("creator asset marketplace persistence boundary", () => {
  it("quarantines legacy rows and makes explicit rights a database invariant for publication", () => {
    expect(migrationSource).toMatch(
      /UPDATE "creator_asset"[\s\S]*?SET "moderationStatus" = 'under_review'[\s\S]*?WHERE "rightsConfirmedAt" IS NULL/u
    );
    expect(migrationSource).toContain("creator_asset_published_rights_check");
    expect(migrationSource).toMatch(
      /CHECK \("moderationStatus" <> 'published' OR "rightsConfirmedAt" IS NOT NULL\)/u
    );

    expect(preflightSource).toContain("creator_asset_published_rights_check");
    expect(preflightSource).toContain('"rightsConfirmedAt" IS NULL');
    expect(serverSource).toContain("isNotNull(creatorAssets.rightsConfirmedAt)");
  });

  it("rejects partial preview metadata and repairs the old three-valued CHECK", () => {
    for (const column of [
      "previewDataUrl",
      "previewWidth",
      "previewHeight",
      "previewMimeType",
      "previewByteSize",
      "previewContentHash",
    ]) {
      expect(migrationSource).toContain(`"${column}" IS NOT NULL`);
    }
    expect(migrationSource).toContain(
      'DROP CONSTRAINT IF EXISTS "creator_asset_preview_check"'
    );
    expect(preflightSource).toContain("pg_get_constraintdef");
    expect(preflightSource).toContain("expected_constraint.column_names");
  });

  it("keeps Creator Asset schema mutation in deployment migrations, not user requests", () => {
    expect(serverSource).not.toContain("CREATE_ASSET_TABLE_SQL");
    expect(serverSource).not.toContain("ensureAssetTable");
    expect(serverSource).not.toMatch(
      /\b(?:CREATE|ALTER)\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"creator_asset(?:_report)?"/u
    );
    expect(preflightSource).toContain("pg_catalog.pg_constraint");
    expect(preflightSource).toContain("matchesPostgresCheckDefinition");
    expect(checkFingerprintSource).toContain("fingerprintBooleanExpression");
    expect(preflightSource).toContain("0013_creator_asset_marketplace.sql");
    expect(creatorModuleSource).toContain("creatorAssetSchemaPreflightProvider");
    expect(preflightSource).toContain("to_regclass('public.creator_asset')");
    expect(preflightSource).toContain("to_regclass('public.creator_asset_report')");
    expect(productionMigrationManifestSource).toContain(
      "apps/api/src/db/migrations/0013_creator_asset_marketplace.sql"
    );
    expect(ciSource).toContain("scripts/production-database-migrations.manifest");
    expect(ciSource).toContain("run-production-database-migrations.mjs");
  });

  it("repairs every owned index to its canonical table, key, direction, and predicate", () => {
    expect(migrationSource).not.toMatch(/^\s*CREATE INDEX IF NOT EXISTS/gmu);
    expect(migrationSource).toContain('DROP INDEX IF EXISTS "idx_creator_asset_catalog"');
    expect(migrationSource).toMatch(
      /CREATE INDEX "idx_creator_asset_catalog"[\s\S]*?"moderationStatus" ASC NULLS LAST,[\s\S]*?"hidden" ASC NULLS LAST,[\s\S]*?"createdAt" DESC NULLS FIRST/u
    );
    expect(migrationSource).toMatch(
      /CREATE UNIQUE INDEX "creator_asset_owner_hash_unique"[\s\S]*?WHERE "contentHash" IS NOT NULL/u
    );
    expect(preflightSource).toContain("index_record.indoption::smallint[]");
    expect(preflightSource).toContain("index_record.indnkeyatts");
    expect(preflightSource).toContain("index_record.indnatts");
    expect(preflightSource).toContain("index_record.indexprs IS NULL");
  });

  it("keeps reported assets and their moderation evidence instead of cascading a hard delete", () => {
    expect(serverSource).toMatch(
      /select\(\{[\s\S]*?reportCount: creatorAssets\.reportCount[\s\S]*?\.for\("update"\)/u
    );
    expect(serverSource).toMatch(
      /if \(existing\.reportCount > 0\)[\s\S]*?hidden: true[\s\S]*?return \{ deleted: true \}/u
    );
  });
});
