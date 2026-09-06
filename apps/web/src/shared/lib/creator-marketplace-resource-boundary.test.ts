import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../../../apps/api/src/db/migrations/0021_creator_marketplace_resource.sql", import.meta.url),
  "utf8"
);
const appModule = readFileSync(
  new URL("../../../../../apps/api/src/app.module.ts", import.meta.url),
  "utf8"
);
const drizzleConfig = readFileSync(
  new URL("../../../../../drizzle.config.ts", import.meta.url),
  "utf8"
);
const client = readFileSync(
  new URL("../../infrastructure/creator-marketplace-client.ts", import.meta.url),
  "utf8"
);

describe("creator marketplace metadata-first persistence boundary", () => {
  it("기존 creator_asset을 변경하지 않고 별도 generic kind/version/license/provenance 표를 둔다", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "creator_marketplace_resource"');
    expect(migration).toContain(
      "'asset', 'brush', 'filter', 'palette', 'template', '3d-preset'"
    );
    expect(migration).toContain('"resourceVersion"');
    expect(migration).toContain('"minimumStudioVersion"');
    expect(migration).toContain('"license"');
    expect(migration).toContain('"provenanceOrigin"');
    expect(migration).not.toContain('ALTER TABLE "creator_asset"');
  });

  it("manifest 크기·해시·JSON shape와 소유자별 버전/중복 경계를 DB에서도 강제한다", () => {
    expect(migration).toContain('"manifestByteSize" BETWEEN 1 AND 65536');
    expect(migration).toContain('"manifestHash" ~');
    expect(migration).toContain("jsonb_array_length");
    expect(migration).toContain(
      '"creator_marketplace_resource_publisher_package_version_unique"'
    );
    expect(migration).toContain(
      '"creator_marketplace_resource_publisher_manifest_hash_unique"'
    );
    expect(migration).toContain('REFERENCES "user"("id") ON DELETE CASCADE');
  });

  it("마켓 표에는 binary payload/data URL 컬럼이 없고 canonical JSON client만 연결한다", () => {
    const tableBody = migration.slice(
      migration.indexOf("CREATE TABLE"),
      migration.indexOf(");", migration.indexOf("CREATE TABLE"))
    );
    expect(tableBody).not.toMatch(/"dataUrl"|"payload" bytea|"binary"/u);
    expect(client).toContain("canonicalizeCreatorMarketplaceJson");
    expect(client).toContain("crypto.subtle.digest");
    expect(client).toContain("CREATOR_MARKETPLACE_RUNTIME_BY_KIND");
    expect(client).toContain("createCreatorMarketplaceBuiltinDelivery");
  });

  it("별도 Nest feature module로 등록해 기존 CreatorModule의 dirty 경계를 건드리지 않는다", () => {
    expect(appModule).toContain(
      'import { CreatorMarketplaceModule } from "./modules/creator-marketplace/creator-marketplace.module";'
    );
    expect(appModule).toContain("CreatorMarketplaceModule,");
    expect(drizzleConfig).toContain(
      '"./apps/api/src/db/creator-marketplace-resource.schema.ts"'
    );
  });
});
