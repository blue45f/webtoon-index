import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { creatorMarketplacePublisherGateKey } from "../apps/api/src/modules/creator-marketplace/creator-marketplace-publish-gate";
import { creatorMarketplaceReporterKey } from "../apps/api/src/modules/creator-marketplace/creator-marketplace-report-gate";
import {
  creatorMarketplacePackageIdentityPreimage,
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
} from "../apps/web/src/shared/lib/creator-marketplace-cloud-library-contract";
import {
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplaceResourceManifestSchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

import {
  VITEST_VALIDATED_REMOTE_DATABASE_MARKER,
  validatePostgresIntegrationUrl,
} from "./run-postgres-integration-tests.mjs";

import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceManifest,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeCreatorMarketplaceJson(value))
    .digest("hex");
}

function hasReason(error: unknown, reason: string): boolean {
  return typeof error === "object"
    && error !== null
    && "reason" in error
    && error.reason === reason;
}

function manifestFor(
  kind: Extract<CreatorMarketplaceResourceKind, "brush" | "palette">,
  packageId: string
): CreatorMarketplaceResourceManifest {
  const definition: Record<string, CreatorMarketplaceJsonValue> =
    kind === "brush"
      ? {
          snapshot: {
            renderer: "perfect-freehand",
            presetId: "integration-ink",
            settings: { size: 7, opacity: 1 },
          },
        }
      : {
          colors: ["#111827", "#f8fafc", "#ef4444"],
        };
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: kind,
    runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[kind],
    definition,
  };
  return CreatorMarketplaceResourceManifestSchema.parse({
    schemaVersion: 1,
    packageId,
    name: kind === "brush" ? "통합 잉크 브러시" : "통합 누아르 팔레트",
    description: "격리 PostgreSQL 통합 검증 전용 portable JSON",
    kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["integration", kind],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: `${kind}/integration`,
      kind,
      name: kind === "brush" ? "통합 잉크" : "통합 누아르",
      delivery: {
        mode: "portable-json",
        mediaType:
          kind === "brush"
            ? "application/vnd.toonspectrum.brush+json"
            : "application/vnd.toonspectrum.palette+json",
        payload,
        byteSize: creatorMarketplaceJsonByteSize(payload),
        sha256: sha256(payload),
      },
    }],
  });
}

function assertSafeTarget(): URL {
  if (process.env.TOONSPECTRUM_MARKETPLACE_DB_TEST !== "1") {
    throw new Error("Set TOONSPECTRUM_MARKETPLACE_DB_TEST=1 for the isolated DB check.");
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required.");
  const runnerValidated =
    process.env.TOONSPECTRUM_MARKETPLACE_DB_RUNNER_VALIDATED === "1";
  const validatedRemoteDatabase =
    process.env[VITEST_VALIDATED_REMOTE_DATABASE_MARKER] === "true";
  const target = validatePostgresIntegrationUrl(rawUrl, {
    allowRemoteTestDatabase: validatedRemoteDatabase,
    environment: process.env,
  });
  const databaseName = String(target.databaseName ?? "");
  if (
    runnerValidated
    && process.env.TEST_DATABASE_URL?.trim() !== rawUrl.trim()
  ) {
    throw new Error(
      "The runner-validated marketplace target must match TEST_DATABASE_URL.",
    );
  }
  const url = new URL(rawUrl);
  if (
    !runnerValidated
    && !/(?:^|[_-])test(?:$|[_-])/iu.test(databaseName)
  ) {
    throw new Error("Refusing to run against a database whose name is not explicitly test-scoped.");
  }
  return url;
}

async function main() {
  const target = assertSafeTarget();
  const publisherId = `market-publisher-${randomUUID()}`;
  const otherUserId = `market-other-${randomUUID()}`;
  const reviewerId = `market-reviewer-${randomUUID()}`;
  const concurrentReporterId = `market-concurrent-reporter-${randomUUID()}`;
  const precisionPublisherId = `market-precision-${randomUUID()}`;
  const packageSuffix = randomUUID();

  const [
    { dbPool },
    { DrizzleCreatorMarketplaceResourceRepository },
    { DrizzleCreatorMarketplaceCloudLibraryRepository },
    { PostgresCreatorMarketplacePublishGate },
  ] = await Promise.all([
    import("../apps/api/src/db/index"),
    import("../apps/api/src/modules/creator-marketplace/creator-marketplace.repository"),
    import("../apps/api/src/modules/creator-marketplace/creator-marketplace-library.repository"),
    import("../apps/api/src/modules/creator-marketplace/creator-marketplace-publish-gate.repository"),
  ]);
  const repository = new DrizzleCreatorMarketplaceResourceRepository();
  const libraryRepository = new DrizzleCreatorMarketplaceCloudLibraryRepository();
  const publishGate = new PostgresCreatorMarketplacePublishGate();
  const publisherGateKey = creatorMarketplacePublisherGateKey(publisherId);
  const reporterKey = creatorMarketplaceReporterKey(otherUserId);
  const publisherReporterKey = creatorMarketplaceReporterKey(publisherId);
  const concurrentReporterKey = creatorMarketplaceReporterKey(concurrentReporterId);
  const precisionReporterKey = creatorMarketplaceReporterKey(precisionPublisherId);
  const cleanupResourceIds: string[] = [];
  let brushId: string | null = null;
  let paletteId: string | null = null;
  let exactPaletteId: string | null = null;
  let brushHeadId: string | null = null;
  let brushRestoredSuccessorId: string | null = null;
  let brushDelistedSuccessorId: string | null = null;
  let otherPublisherBrushId: string | null = null;

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" text PRIMARY KEY,
        "name" text,
        "avatar" text,
        "status" text NOT NULL DEFAULT 'active'
      );
      CREATE TABLE IF NOT EXISTS "toonspectrum_schema_migration" (
        "id" text PRIMARY KEY,
        "appliedAt" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "toonspectrum_schema_migration_id_check"
          CHECK (length("id") BETWEEN 1 AND 160)
      );
    `);
    const migrations = await Promise.all(
      [
        "0021_creator_marketplace_resource.sql",
        "0022_creator_marketplace_distributed_gate_search.sql",
        "0030_creator_marketplace_immutable_releases.sql",
        "0031_creator_marketplace_moderation.sql",
        "0032_creator_marketplace_release_lifecycle.sql",
        "0033_creator_marketplace_cloud_library.sql",
        "0034_creator_marketplace_package_moderation.sql",
        "0035_creator_marketplace_3d_asset_kind.sql",
        "0037_creator_marketplace_3d_asset_parity.sql",
      ].map((name) =>
        readFile(new URL(`../apps/api/src/db/migrations/${name}`, import.meta.url), "utf8")
      )
    );
    for (const migration of migrations) await dbPool.query(migration);
    await dbPool.query(
      `INSERT INTO "user" ("id", "name", "avatar") VALUES
        ($1, $2, $3),
        ($4, $5, $6),
        ($7, $8, $9),
        ($10, $11, $12),
        ($13, $14, $15)`,
      [
        publisherId,
        "Marketplace Integration Publisher",
        "#334155",
        otherUserId,
        "Marketplace Integration Other",
        "#64748b",
        reviewerId,
        "Marketplace Integration Reviewer",
        "#0f766e",
        concurrentReporterId,
        "Marketplace Integration Concurrent Reporter",
        "#7c3aed",
        precisionPublisherId,
        "Marketplace Integration Precision Probe",
        "#be123c",
      ]
    );

    const brushManifest = CreatorMarketplaceResourceManifestSchema.parse({
      ...manifestFor("brush", `integration/brush/${packageSuffix}`),
      description: "누아르 질감의 격리 PostgreSQL 통합 검증 전용 portable JSON",
    });
    const brushPackageKeyHash = createHash("sha256")
      .update(creatorMarketplacePackageIdentityPreimage(
        publisherId,
        brushManifest.packageId,
      ))
      .digest();
    const brushLogicalPackId = creatorMarketplaceLogicalPackIdFromPackageKeyHex(
      brushPackageKeyHash.toString("hex"),
    );
    const paletteManifest = manifestFor("palette", `integration/palette/${packageSuffix}`);
    const exactPaletteManifest = CreatorMarketplaceResourceManifestSchema.parse({
      ...manifestFor("palette", `integration/palette-exact/${packageSuffix}`),
      name: "누아르",
      description: "정확한 이름 일치 관련도 검증 전용 팔레트",
    });
    const brush = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: brushManifest,
      manifestHash: sha256(brushManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(brushManifest),
    });
    brushId = brush.id;
    cleanupResourceIds.push(brush.id);
    const palette = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: paletteManifest,
      manifestHash: sha256(paletteManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(paletteManifest),
    });
    paletteId = palette.id;
    cleanupResourceIds.push(palette.id);
    const exactPalette = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: exactPaletteManifest,
      manifestHash: sha256(exactPaletteManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(exactPaletteManifest),
    });
    exactPaletteId = exactPalette.id;
    cleanupResourceIds.push(exactPalette.id);

    const precisionRows = [
      { id: `precision-a-${packageSuffix}`, fraction: "123900", suffix: "a" },
      { id: `precision-b-${packageSuffix}`, fraction: "123500", suffix: "b" },
      { id: `precision-c-${packageSuffix}`, fraction: "123100", suffix: "c" },
    ];
    for (const [index, precisionRow] of precisionRows.entries()) {
      const precisionPackageId = `integration/precision/${packageSuffix}/${precisionRow.suffix}`;
      const precisionManifest = CreatorMarketplaceResourceManifestSchema.parse({
        ...paletteManifest,
        packageId: precisionPackageId,
        name: `Precision ${precisionRow.suffix}`,
      });
      const precisionId = precisionRow.id;
      cleanupResourceIds.push(precisionId);
      await dbPool.query(
        `INSERT INTO "creator_marketplace_resource" (
           "id", "publisherId", "packageId", "name", "description", "tags",
           "kind", "resourceVersion", "releaseOrdinal", "minimumStudioVersion",
           "license", "provenanceOrigin", "manifest", "manifestHash",
           "manifestByteSize", "createdAt", "updatedAt"
         ) VALUES (
           $1, $2, $3, $4, $5, $6::jsonb,
           $7, $8, 1, $9,
           $10, $11, $12::jsonb, $13,
           $14, ('2026-08-31T10:00:00.' || $15 || 'Z')::timestamptz,
           ('2026-08-31T10:00:00.' || $15 || 'Z')::timestamptz
         )`,
        [
          precisionId,
          precisionPublisherId,
          precisionPackageId,
          precisionManifest.name,
          precisionManifest.description,
          JSON.stringify(precisionManifest.tags),
          precisionManifest.kind,
          precisionManifest.resourceVersion,
          precisionManifest.minimumStudioVersion,
          precisionManifest.license,
          precisionManifest.provenance.origin,
          JSON.stringify(precisionManifest),
          sha256(`precision-${index}-${packageSuffix}`),
          creatorMarketplaceJsonByteSize(precisionManifest),
          precisionRow.fraction,
        ],
      );
    }

    const timestampTypes = await dbPool.query<{ name: string; type: string }>(
      `SELECT attribute.attname AS "name",
              pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS "type"
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'creator_marketplace_resource'::regclass
         AND attribute.attname = ANY($1::text[])
       ORDER BY attribute.attname`,
      [["createdAt", "updatedAt"]],
    );
    assert.deepEqual(timestampTypes.rows, [
      { name: "createdAt", type: "timestamp(3) with time zone" },
      { name: "updatedAt", type: "timestamp(3) with time zone" },
    ]);

    const precisionPageIds: string[] = [];
    let precisionCursor: { createdAt: Date; id: string } | null = null;
    for (;;) {
      const page: { rows: Array<{ id: string; createdAt: Date }> } =
        precisionCursor === null
          ? await dbPool.query(
              `SELECT "id", "createdAt"
               FROM "creator_marketplace_resource"
               WHERE "publisherId" = $1
               ORDER BY "createdAt" DESC, "id" DESC
               LIMIT 1`,
              [precisionPublisherId],
            )
          : await dbPool.query(
              `SELECT "id", "createdAt"
               FROM "creator_marketplace_resource"
               WHERE "publisherId" = $1
                 AND ("createdAt", "id") < ($2::timestamptz, $3::text)
               ORDER BY "createdAt" DESC, "id" DESC
               LIMIT 1`,
              [precisionPublisherId, precisionCursor.createdAt, precisionCursor.id],
            );
      const row = page.rows[0];
      if (!row) break;
      precisionPageIds.push(row.id);
      precisionCursor = row;
    }
    assert.deepEqual(
      [...precisionPageIds].sort(),
      precisionRows.map(({ id }) => id).sort(),
      "millisecond-normalized keyset pages must not skip former microsecond rows",
    );

    const brushRows = await repository.list({
      limit: 10,
      cursor: null,
      sort: "newest",
      kind: "brush",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(brushRows.length, 1);
    assert.equal(brushRows[0]?.manifest.kind, "brush");
    assert.deepEqual(
      brushRows[0]?.manifest.entries[0]?.delivery.mode === "portable-json"
        ? brushRows[0].manifest.entries[0].delivery.payload.definition
        : null,
      brushManifest.entries[0]?.delivery.mode === "portable-json"
        ? brushManifest.entries[0].delivery.payload.definition
        : null
    );

    const firstPage = await repository.list({
      limit: 1,
      cursor: null,
      sort: "newest",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(firstPage.length, 2, "repository must fetch one cursor sentinel row");
    const first = firstPage[0]!;
    const secondPage = await repository.list({
      limit: 1,
      cursor: { sort: "newest", createdAt: first.createdAt, id: first.id },
      sort: "newest",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(
      secondPage.length,
      2,
      "newest query must keep a sentinel when three packages are visible",
    );
    assert.notEqual(secondPage[0]?.id, first.id);

    const relevanceFirstPage = await repository.list({
      limit: 1,
      cursor: null,
      search: "누아르",
      sort: "relevance",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(
      relevanceFirstPage.length,
      2,
      "relevance query must fetch one cursor sentinel row",
    );
    assert.equal(relevanceFirstPage[0]?.id, exactPalette.id);
    assert.equal(relevanceFirstPage[1]?.id, palette.id);
    assert.ok(
      (relevanceFirstPage[0]?.relevanceScore ?? -1)
        > (relevanceFirstPage[1]?.relevanceScore ?? -1),
    );

    const relevanceFirst = relevanceFirstPage[0]!;
    assert.equal(typeof relevanceFirst.relevanceScore, "number");
    const relevanceSecondPage = await repository.list({
      limit: 1,
      cursor: {
        sort: "relevance",
        relevanceScore: relevanceFirst.relevanceScore!,
        createdAt: relevanceFirst.createdAt,
        id: relevanceFirst.id,
      },
      search: "누아르",
      sort: "relevance",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(relevanceSecondPage.length, 2);
    assert.equal(relevanceSecondPage[0]?.id, palette.id);
    assert.equal(relevanceSecondPage[1]?.id, brush.id);

    const relevanceSecond = relevanceSecondPage[0]!;
    assert.equal(typeof relevanceSecond.relevanceScore, "number");
    const relevanceThirdPage = await repository.list({
      limit: 1,
      cursor: {
        sort: "relevance",
        relevanceScore: relevanceSecond.relevanceScore!,
        createdAt: relevanceSecond.createdAt,
        id: relevanceSecond.id,
      },
      search: "누아르",
      sort: "relevance",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(relevanceThirdPage.length, 1);
    assert.equal(relevanceThirdPage[0]?.id, brush.id);
    const tagRows = await repository.list({
      limit: 10,
      cursor: null,
      sort: "newest",
      tag: "brush",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(tagRows.length, 1);
    assert.equal(tagRows[0]?.id, brush.id);

    const indexRows = await dbPool.query<{ indexname: string }>(
      `
        SELECT "indexname"
        FROM "pg_indexes"
        WHERE "schemaname" = current_schema()
          AND "tablename" = 'creator_marketplace_resource'
          AND "indexname" = ANY($1::text[])
      `,
      [[
        "idx_creator_marketplace_resource_search",
        "idx_creator_marketplace_resource_tags",
      ]]
    );
    assert.deepEqual(
      indexRows.rows.map((row) => row.indexname).sort(),
      [
        "idx_creator_marketplace_resource_search",
        "idx_creator_marketplace_resource_tags",
      ]
    );

    const concurrentAdmissions = await Promise.all([
      publishGate.acquire(publisherGateKey),
      publishGate.acquire(publisherGateKey),
    ]);
    assert.deepEqual(
      concurrentAdmissions.map((admission) => admission.status).sort(),
      ["acquired", "rate_limited"]
    );
    const acquiredAdmission = concurrentAdmissions.find(
      (admission) => admission.status === "acquired"
    );
    assert.ok(acquiredAdmission && acquiredAdmission.status === "acquired");
    assert.equal(await publishGate.release(acquiredAdmission.lease), true);

    for (let admittedCount = 1; admittedCount < 20; admittedCount += 1) {
      const admission = await publishGate.acquire(publisherGateKey);
      assert.equal(admission.status, "acquired");
      if (admission.status !== "acquired") {
        throw new Error("Publish gate rejected an admission before the hourly limit.");
      }
      assert.equal(await publishGate.release(admission.lease), true);
    }
    assert.equal((await publishGate.acquire(publisherGateKey)).status, "rate_limited");

    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: brush.id,
        reporterId: publisherId,
        reporterKeyHash: publisherReporterKey,
        reason: "other",
        details: "게시자가 자신의 릴리스를 신고할 수 없어야 합니다.",
      }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "self-report",
    );
    const publisherGateRows = await dbPool.query<{ count: string }>(
      `SELECT count(*)::text AS "count"
       FROM "creator_marketplace_resource_report_gate"
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(publisherReporterKey)],
    );
    assert.equal(
      publisherGateRows.rows[0]?.count,
      "0",
      "self-report rejection must happen before consuming admission",
    );

    const submittedReport = await repository.report({
      id: randomUUID(),
      resourceId: brush.id,
      reporterId: otherUserId,
      reporterKeyHash: reporterKey,
      reason: "misleading",
      details: "표시된 설명과 portable JSON 내용이 다릅니다.",
    });
    const openQueue = await repository.listModeration({
      status: "open",
      limit: 10,
      offset: 0,
    });
    const queuedReport = openQueue.find(
      (report) => report.reportId === submittedReport.reportId,
    );
    assert.ok(queuedReport);
    assert.equal(queuedReport.currentResourceHidden, false);
    assert.equal(queuedReport.currentResourceDelistedAt, null);
    assert.equal(queuedReport.evidence.resourceId, brush.id);
    assert.equal(queuedReport.evidence.manifestHash, sha256(brushManifest));

    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource_report"
         SET "evidence" = jsonb_set("evidence", '{name}', '"tampered"'::jsonb)
         WHERE "id" = $1`,
        [submittedReport.reportId],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514",
    );

    const gateBeforeDuplicate = await dbPool.query<{ requestCount: number }>(
      `SELECT "requestCount"
       FROM "creator_marketplace_resource_report_gate"
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(reporterKey)],
    );
    assert.equal(gateBeforeDuplicate.rows[0]?.requestCount, 1);
    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: brush.id,
        reporterId: otherUserId,
        reporterKeyHash: reporterKey,
        reason: "spam",
        details: "같은 릴리스에 대한 중복 신고입니다.",
      }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "duplicate",
    );
    const gateAfterDuplicate = await dbPool.query<{ requestCount: number }>(
      `SELECT "requestCount"
       FROM "creator_marketplace_resource_report_gate"
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(reporterKey)],
    );
    assert.equal(
      gateAfterDuplicate.rows[0]?.requestCount,
      1,
      "duplicate transaction rollback must not consume daily admission",
    );

    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource_report"
         SET "status" = 'resolved',
             "resolutionNote" = 'reviewer-less transition must fail',
             "reviewedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [submittedReport.reportId],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint
          === "creator_marketplace_resource_report_reviewer_required",
    );

    const hidden = await repository.moderate({
      resourceId: brush.id,
      reviewerId,
      action: "hide",
      note: "통합 검증에서 확인된 설명 불일치로 숨김 처리",
    });
    assert.equal(hidden?.hidden, true);
    assert.equal(hidden?.delisted, false);
    assert.equal(hidden?.packageState, "hidden");
    assert.equal(hidden?.changed, true);
    assert.equal(hidden?.reviewedReportCount, 1);
    assert.equal(await repository.findById(brush.id), null);
    const resolvedQueue = await repository.listModeration({
      status: "resolved",
      limit: 10,
      offset: 0,
    });
    assert.equal(
      resolvedQueue.find((report) => report.reportId === submittedReport.reportId)?.status,
      "resolved",
    );
    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource_report"
         SET "status" = 'open', "resolutionNote" = '',
             "reviewedBy" = NULL, "reviewedAt" = NULL
         WHERE "id" = $1`,
        [submittedReport.reportId],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514",
    );
    const restored = await repository.moderate({
      resourceId: brush.id,
      reviewerId,
      action: "restore",
      note: "통합 검증을 위한 관리자 복구",
    });
    assert.equal(restored?.hidden, false);
    assert.equal(restored?.delisted, false);
    assert.equal(restored?.packageState, "active");
    assert.equal(restored?.changed, true);
    assert.equal(restored?.reviewedReportCount, 0);
    assert.equal((await repository.findById(brush.id))?.id, brush.id);

    await dbPool.query(
      `UPDATE "creator_marketplace_resource_report_gate"
       SET "requestCount" = 20, "updatedAt" = clock_timestamp()
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(reporterKey)],
    );
    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: palette.id,
        reporterId: otherUserId,
        reporterKeyHash: reporterKey,
        reason: "unsafe",
        details: "일일 신고 게이트 상한 검증",
      }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "rate-limited",
    );

    // Report admission is scoped by both the immutable absolute-head ordinal (content epoch) and
    // the package moderation revision. This isolated package keeps the lifecycle probes from
    // changing the original brush/report assertions above.
    const reportEpochPackageId = `integration/report-epoch/${packageSuffix}`;
    const reportEpochManifestV1 = CreatorMarketplaceResourceManifestSchema.parse({
      ...manifestFor("palette", reportEpochPackageId),
      name: "신고 epoch 통합 검증 팔레트",
    });
    const reportEpochHeadV1 = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: reportEpochManifestV1,
      manifestHash: sha256(reportEpochManifestV1),
      manifestByteSize: creatorMarketplaceJsonByteSize(reportEpochManifestV1),
    });
    cleanupResourceIds.push(reportEpochHeadV1.id);

    const epochOneReport = await repository.report({
      id: randomUUID(),
      resourceId: reportEpochHeadV1.id,
      reporterId: concurrentReporterId,
      reporterKeyHash: concurrentReporterKey,
      reason: "misleading",
      details: "첫 절대 head 신고 epoch 검증",
    });
    const epochOneEvidence = await dbPool.query<{
      evidence: { schemaVersion: number; packageModerationRevision: number; packageReportEpoch: number };
      packageModerationRevision: number;
      packageReportEpoch: number;
    }>(
      `SELECT "evidence", "packageModerationRevision", "packageReportEpoch"
       FROM "creator_marketplace_resource_report"
       WHERE "id" = $1`,
      [epochOneReport.reportId],
    );
    assert.equal(epochOneEvidence.rows[0]?.evidence.schemaVersion, 3);
    assert.equal(epochOneEvidence.rows[0]?.evidence.packageModerationRevision, 0);
    assert.equal(epochOneEvidence.rows[0]?.evidence.packageReportEpoch, 1);
    assert.equal(epochOneEvidence.rows[0]?.packageModerationRevision, 0);
    assert.equal(epochOneEvidence.rows[0]?.packageReportEpoch, 1);

    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: reportEpochHeadV1.id,
        reporterId: concurrentReporterId,
        reporterKeyHash: concurrentReporterKey,
        reason: "spam",
        details: "같은 revision과 head epoch 중복",
      }),
      (error: unknown) => hasReason(error, "duplicate"),
    );
    const epochGateAfterDuplicate = await dbPool.query<{ requestCount: number }>(
      `SELECT "requestCount"
       FROM "creator_marketplace_resource_report_gate"
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(concurrentReporterKey)],
    );
    assert.equal(
      epochGateAfterDuplicate.rows[0]?.requestCount,
      1,
      "same-epoch duplicate rollback must preserve the daily allowance",
    );

    const dismissedEpochOne = await repository.moderate({
      resourceId: reportEpochHeadV1.id,
      reviewerId,
      action: "dismiss",
      sourceReportId: epochOneReport.reportId,
      note: "첫 신고는 증거 불충분으로 기각",
    });
    assert.equal(dismissedEpochOne?.changed, false);
    assert.equal(dismissedEpochOne?.packageRevision, 0);
    assert.equal(dismissedEpochOne?.reviewedReportCount, 1);
    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: reportEpochHeadV1.id,
        reporterId: concurrentReporterId,
        reporterKeyHash: concurrentReporterKey,
        reason: "other",
        details: "기각 후에도 동일 head는 같은 epoch",
      }),
      (error: unknown) => hasReason(error, "duplicate"),
    );

    const reportEpochManifestV2 = CreatorMarketplaceResourceManifestSchema.parse({
      ...reportEpochManifestV1,
      resourceVersion: "1.1.0",
      releaseNotes: "신고할 수 있는 새로운 콘텐츠 epoch",
    });
    const reportEpochHeadV2 = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: reportEpochManifestV2,
      manifestHash: sha256(reportEpochManifestV2),
      manifestByteSize: creatorMarketplaceJsonByteSize(reportEpochManifestV2),
    });
    cleanupResourceIds.push(reportEpochHeadV2.id);
    const epochTwoHistoricalReport = await repository.report({
      id: randomUUID(),
      resourceId: reportEpochHeadV1.id,
      reporterId: concurrentReporterId,
      reporterKeyHash: concurrentReporterKey,
      reason: "copyright",
      details: "이전 UUID를 신고해도 현재 절대 head epoch를 사용",
    });
    const epochTwoEvidence = await dbPool.query<{
      evidence: { schemaVersion: number; packageModerationRevision: number; packageReportEpoch: number };
      packageModerationRevision: number;
      packageReportEpoch: number;
    }>(
      `SELECT "evidence", "packageModerationRevision", "packageReportEpoch"
       FROM "creator_marketplace_resource_report"
       WHERE "id" = $1`,
      [epochTwoHistoricalReport.reportId],
    );
    assert.equal(epochTwoEvidence.rows[0]?.evidence.schemaVersion, 3);
    assert.equal(epochTwoEvidence.rows[0]?.evidence.packageModerationRevision, 0);
    assert.equal(epochTwoEvidence.rows[0]?.evidence.packageReportEpoch, 2);
    assert.equal(epochTwoEvidence.rows[0]?.packageModerationRevision, 0);
    assert.equal(epochTwoEvidence.rows[0]?.packageReportEpoch, 2);

    const hiddenEpochPackage = await repository.moderate({
      resourceId: reportEpochHeadV1.id,
      reviewerId,
      action: "hide",
      sourceReportId: epochTwoHistoricalReport.reportId,
      note: "신고 epoch 숨김 차단 검증",
    });
    assert.equal(hiddenEpochPackage?.packageState, "hidden");
    assert.equal(hiddenEpochPackage?.packageRevision, 1);
    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: reportEpochHeadV1.id,
        reporterId: concurrentReporterId,
        reporterKeyHash: concurrentReporterKey,
        reason: "unsafe",
        details: "숨김 패키지는 새 신고를 받지 않음",
      }),
      (error: unknown) => hasReason(error, "not-found"),
    );

    const restoredEpochPackage = await repository.moderate({
      resourceId: reportEpochHeadV1.id,
      reviewerId,
      action: "restore",
      note: "동일 head에서 복원된 moderation revision 검증",
    });
    assert.equal(restoredEpochPackage?.packageState, "active");
    assert.equal(restoredEpochPackage?.packageRevision, 2);
    const restoredRevisionReport = await repository.report({
      id: randomUUID(),
      resourceId: reportEpochHeadV1.id,
      reporterId: concurrentReporterId,
      reporterKeyHash: concurrentReporterKey,
      reason: "other",
      details: "같은 head epoch라도 복원된 moderation revision은 새 신고 가능",
    });
    const restoredRevisionEvidence = await dbPool.query<{
      evidence: { packageModerationRevision: number; packageReportEpoch: number };
      packageModerationRevision: number;
      packageReportEpoch: number;
    }>(
      `SELECT "evidence", "packageModerationRevision", "packageReportEpoch"
       FROM "creator_marketplace_resource_report"
       WHERE "id" = $1`,
      [restoredRevisionReport.reportId],
    );
    assert.equal(restoredRevisionEvidence.rows[0]?.evidence.packageModerationRevision, 2);
    assert.equal(restoredRevisionEvidence.rows[0]?.evidence.packageReportEpoch, 2);
    assert.equal(restoredRevisionEvidence.rows[0]?.packageModerationRevision, 2);
    assert.equal(restoredRevisionEvidence.rows[0]?.packageReportEpoch, 2);

    await assert.rejects(
      dbPool.query(
        `INSERT INTO "creator_marketplace_resource_report" (
           "id", "resourceId", "resourceSnapshotId",
           "packagePublisherIdSnapshot", "packageIdSnapshot",
           "packageModerationRevision", "packageReportEpoch",
           "reporterId", "reporterKeyHash", "reason", "details", "evidence"
         )
         SELECT $1, "resourceId", "resourceSnapshotId",
                "packagePublisherIdSnapshot", "packageIdSnapshot",
                "packageModerationRevision", "packageReportEpoch" + 100,
                $2, $3::bytea, 'other', 'stale report epoch direct insert',
                jsonb_set("evidence", '{packageReportEpoch}',
                  to_jsonb("packageReportEpoch" + 100))
         FROM "creator_marketplace_resource_report"
         WHERE "id" = $4`,
        [
          randomUUID(),
          precisionPublisherId,
          Buffer.from(precisionReporterKey),
          restoredRevisionReport.reportId,
        ],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint === "creator_marketplace_resource_report_package_unavailable",
    );

    assert.equal(await repository.deleteOwned(publisherId, reportEpochHeadV2.id), true);
    assert.deepEqual(
      await repository.relistOwned(publisherId, reportEpochHeadV2.id),
      { id: reportEpochHeadV2.id, changed: true },
    );
    await assert.rejects(
      repository.report({
        id: randomUUID(),
        resourceId: reportEpochHeadV1.id,
        reporterId: concurrentReporterId,
        reporterKeyHash: concurrentReporterKey,
        reason: "spam",
        details: "목록 재등록은 콘텐츠나 moderation epoch를 바꾸지 않음",
      }),
      (error: unknown) => hasReason(error, "duplicate"),
    );
    const epochGateAfterLifecycle = await dbPool.query<{ requestCount: number }>(
      `SELECT "requestCount"
       FROM "creator_marketplace_resource_report_gate"
       WHERE "keyHash" = $1::bytea`,
      [Buffer.from(concurrentReporterKey)],
    );
    assert.equal(
      epochGateAfterLifecycle.rows[0]?.requestCount,
      3,
      "dismiss, hidden rejection, and relist duplicates must not consume daily admission",
    );
    assert.equal(await repository.deleteOwned(publisherId, reportEpochHeadV2.id), true);

    const [concurrentReport, concurrentModeration] = await Promise.allSettled([
      repository.report({
        id: randomUUID(),
        resourceId: exactPalette.id,
        reporterId: concurrentReporterId,
        reporterKeyHash: concurrentReporterKey,
        reason: "copyright",
        details: "신고와 관리자 숨김의 행 잠금 순서 검증",
      }),
      repository.moderate({
        resourceId: exactPalette.id,
        reviewerId,
        action: "hide",
        note: "신고와 동시에 실행된 관리자 숨김",
      }),
    ]);
    assert.equal(concurrentModeration.status, "fulfilled");
    if (concurrentModeration.status !== "fulfilled" || !concurrentModeration.value) {
      throw new Error("Concurrent marketplace moderation did not complete.");
    }
    assert.equal(concurrentModeration.value.hidden, true);
    if (concurrentReport.status === "fulfilled") {
      assert.equal(concurrentModeration.value.reviewedReportCount, 1);
    } else {
      assert.equal(concurrentModeration.value.reviewedReportCount, 0);
      assert.equal(
        typeof concurrentReport.reason === "object"
          && concurrentReport.reason !== null
          && "reason" in concurrentReport.reason
          ? concurrentReport.reason.reason
          : null,
        "not-found",
      );
    }
    const concurrentOpenRows = await dbPool.query<{ count: string }>(
      `SELECT count(*)::text AS "count"
       FROM "creator_marketplace_resource_report"
       WHERE "resourceSnapshotId" = $1 AND "status" = 'open'`,
      [exactPalette.id],
    );
    assert.equal(
      concurrentOpenRows.rows[0]?.count,
      "0",
      "row locks must not leave a hidden release with an unresolved concurrent report",
    );
    await repository.moderate({
      resourceId: exactPalette.id,
      reviewerId,
      action: "restore",
      note: "동시성 검증 후 복구",
    });

    const brushHeadManifest = CreatorMarketplaceResourceManifestSchema.parse({
      ...brushManifest,
      resourceVersion: "1.1.0",
      releaseNotes: "릴리스 이력과 재등록 통합 검증",
    });
    const brushHead = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: brushHeadManifest,
      manifestHash: sha256(brushHeadManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(brushHeadManifest),
    });
    brushHeadId = brushHead.id;
    cleanupResourceIds.push(brushHead.id);

    const originalBrushRow = await dbPool.query<{
      manifest: CreatorMarketplaceResourceManifest;
      manifestHash: string;
    }>(
      `SELECT "manifest", "manifestHash"
       FROM "creator_marketplace_resource"
       WHERE "id" = $1`,
      [brush.id],
    );
    assert.equal(originalBrushRow.rows[0]?.manifestHash, sha256(brushManifest));
    assert.equal(
      "releaseNotes" in (originalBrushRow.rows[0]?.manifest ?? {}),
      false,
      "0032 must not rewrite canonical legacy manifest bytes",
    );

    const publicBrushHead = await repository.list({
      limit: 10,
      cursor: null,
      sort: "newest",
      publisherId,
      viewerId: publisherId,
      kind: "brush",
    });
    assert.deepEqual(publicBrushHead.map(({ id }) => id), [brushHead.id]);
    const ownedHeads = await repository.listOwnedHeads({
      limit: 10,
      cursor: null,
      sort: "newest",
      publisherId,
      kind: "brush",
    });
    assert.deepEqual(ownedHeads.map(({ id }) => id), [brushHead.id]);
    assert.equal(ownedHeads[0]?.manifest.releaseNotes, brushHeadManifest.releaseNotes);

    const publicHistory = await repository.listPublicHistory({
      publisherId,
      packageId: brushManifest.packageId,
      limit: 1,
      cursor: null,
    });
    assert.equal(publicHistory.length, 2, "history must return one ordinal sentinel");
    assert.deepEqual(publicHistory.map(({ id }) => id), [brushHead.id, brush.id]);
    const ownedHistoryFirst = await repository.listOwnedPackageHistory({
      publisherId,
      packageId: brushManifest.packageId,
      limit: 1,
      cursor: null,
    });
    assert.equal(ownedHistoryFirst.length, 2);
    const ownedHistorySecond = await repository.listOwnedPackageHistory({
      publisherId,
      packageId: brushManifest.packageId,
      limit: 1,
      cursor: ownedHistoryFirst[0]!.releaseOrdinal,
    });
    assert.deepEqual(ownedHistorySecond.map(({ id }) => id), [brush.id]);

    const historicalTarget = await libraryRepository.resolveAcquisitionTarget(
      otherUserId,
      brush.id,
    );
    assert.equal(historicalTarget.requestReleaseId, brush.id);
    assert.equal(historicalTarget.currentHeadId, brushHead.id);
    assert.equal(historicalTarget.currentHeadResourceVersion, "1.1.0");

    const confirmedHistorical = await libraryRepository.confirmStudioInstall(
      otherUserId,
      brush.id,
      {
        schemaVersion: 1,
        logicalPackId: brushLogicalPackId,
        packageFingerprint: sha256(brushManifest),
      },
    );
    assert.equal(confirmedHistorical.changed, true);
    assert.equal(confirmedHistorical.row.lastConfirmedReleaseId, brush.id);
    assert.equal(confirmedHistorical.row.lastConfirmedReleaseOrdinal, 1);
    const confirmedHead = await libraryRepository.confirmStudioInstall(
      otherUserId,
      brushHead.id,
      {
        schemaVersion: 1,
        logicalPackId: brushLogicalPackId,
        packageFingerprint: sha256(brushHeadManifest),
      },
    );
    assert.equal(confirmedHead.changed, true);
    assert.equal(confirmedHead.row.lastConfirmedReleaseId, brushHead.id);
    assert.equal(confirmedHead.row.lastConfirmedReleaseOrdinal, 2);
    const retainedNewerConfirmation = await libraryRepository.confirmStudioInstall(
      otherUserId,
      brush.id,
      {
        schemaVersion: 1,
        logicalPackId: brushLogicalPackId,
        packageFingerprint: sha256(brushManifest),
      },
    );
    assert.equal(retainedNewerConfirmation.changed, false);
    assert.equal(retainedNewerConfirmation.row.lastConfirmedReleaseId, brushHead.id);
    assert.equal(retainedNewerConfirmation.row.lastConfirmedReleaseOrdinal, 2);

    await dbPool.query(`UPDATE "user" SET "status" = 'suspended' WHERE "id" = $1`, [
      publisherId,
    ]);
    assert.equal(await repository.findById(brush.id), null);
    assert.equal(await repository.findById(brushHead.id), null);
    assert.equal(await repository.findHistoryAnchor(brush.id), null);
    assert.deepEqual(
      await repository.listPublicHistory({
        publisherId,
        packageId: brushManifest.packageId,
        limit: 10,
        cursor: null,
      }),
      [],
    );
    assert.equal(
      (await repository.findIdentityById(brush.id))?.publisherStatus,
      "suspended",
    );
    const suspendedLibrary = await libraryRepository.list({
      userId: otherUserId,
      view: "all",
      logicalPackId: brushLogicalPackId,
      packageKeyHash: new Uint8Array(brushPackageKeyHash),
      limit: 10,
      cursor: null,
    });
    assert.equal(suspendedLibrary.rows[0]?.lastConfirmedReleaseId, brushHead.id);
    assert.equal(suspendedLibrary.catalogHeads[0]?.publisherStatus, "suspended");
    await assert.rejects(
      libraryRepository.confirmStudioInstall(
        concurrentReporterId,
        brushHead.id,
        {
          schemaVersion: 1,
          logicalPackId: brushLogicalPackId,
          packageFingerprint: sha256(brushHeadManifest),
        },
      ),
      (error: unknown) => hasReason(error, "publisher-unavailable"),
    );
    const suspendedExactReplay = await libraryRepository.confirmStudioInstall(
      otherUserId,
      brushHead.id,
      {
        schemaVersion: 1,
        logicalPackId: brushLogicalPackId,
        packageFingerprint: sha256(brushHeadManifest),
      },
    );
    assert.equal(suspendedExactReplay.changed, false);
    assert.equal(suspendedExactReplay.row.lastConfirmedReleaseId, brushHead.id);
    await dbPool.query(`UPDATE "user" SET "status" = 'active' WHERE "id" = $1`, [
      publisherId,
    ]);
    assert.equal((await repository.findById(brush.id))?.id, brush.id);

    const otherPublisherBrush = await repository.publish({
      id: randomUUID(),
      publisherId: otherUserId,
      manifest: brushManifest,
      manifestHash: sha256(brushManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(brushManifest),
    });
    otherPublisherBrushId = otherPublisherBrush.id;
    cleanupResourceIds.push(otherPublisherBrush.id);
    assert.equal(
      (await repository.findOwnedPackageHead(otherUserId, brushManifest.packageId))?.id,
      otherPublisherBrush.id,
    );
    assert.equal(
      (await repository.findOwnedPackageHead(publisherId, brushManifest.packageId))?.id,
      brushHead.id,
      "package heads must compare publisherId and packageId together",
    );

    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource"
         SET "hidden" = true
         WHERE "id" = $1`,
        [brushHead.id],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint
          === "creator_marketplace_resource_hidden_legacy",
      "legacy row-level hidden must remain read-only under package moderation",
    );
    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource"
         SET "delistedAt" = clock_timestamp()
         WHERE "id" = $1`,
        [brush.id],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint === "creator_marketplace_resource_delist_non_head",
    );

    const beforeDelist = await dbPool.query<{ updatedAt: Date }>(
      `SELECT "updatedAt" FROM "creator_marketplace_resource" WHERE "id" = $1`,
      [brushHead.id],
    );
    assert.equal(await repository.deleteOwned(publisherId, brushHead.id), true);
    const afterDelist = await dbPool.query<{ updatedAt: Date }>(
      `SELECT "updatedAt" FROM "creator_marketplace_resource" WHERE "id" = $1`,
      [brushHead.id],
    );
    assert.ok(afterDelist.rows[0]!.updatedAt > beforeDelist.rows[0]!.updatedAt);
    assert.equal(
      (await repository.list({
        limit: 10,
        cursor: null,
        sort: "newest",
        publisherId,
        viewerId: publisherId,
        kind: "brush",
      })).length,
      0,
      "an invisible package head must not fall back to an older release",
    );
    assert.equal(await repository.findById(brush.id), null);
    assert.equal(await repository.findById(brushHead.id), null);
    assert.equal(await repository.findHistoryAnchor(brushHead.id), null);
    assert.deepEqual(
      (await repository.listPublicHistory({
        publisherId,
        packageId: brushManifest.packageId,
        limit: 10,
        cursor: null,
      })).map(({ id }) => id),
      [],
      "an owner-delisted absolute head withdraws all public package history",
    );
    const delistedIdentity = await repository.findIdentityById(brush.id);
    assert.equal(delistedIdentity?.releaseDelistedAt, null);
    assert.equal(delistedIdentity?.currentHeadDelistedAt !== null, true);
    const delistedTarget = await libraryRepository.resolveAcquisitionTarget(
      concurrentReporterId,
      brush.id,
    );
    assert.equal(delistedTarget.requestReleaseDelistedAt, null);
    assert.equal(delistedTarget.currentHeadId, brushHead.id);
    assert.equal(delistedTarget.currentHeadDelistedAt !== null, true);
    await assert.rejects(
      libraryRepository.confirmStudioInstall(
        concurrentReporterId,
        brushHead.id,
        {
          schemaVersion: 1,
          logicalPackId: brushLogicalPackId,
          packageFingerprint: sha256(brushHeadManifest),
        },
      ),
      (error: unknown) => hasReason(error, "owner-delisted"),
    );
    await assert.rejects(
      libraryRepository.confirmStudioInstall(
        otherUserId,
        brush.id,
        {
          schemaVersion: 1,
          logicalPackId: brushLogicalPackId,
          packageFingerprint: sha256(brushManifest),
        },
      ),
      (error: unknown) => hasReason(error, "owner-delisted"),
    );
    const delistedExactReplay = await libraryRepository.confirmStudioInstall(
      otherUserId,
      brushHead.id,
      {
        schemaVersion: 1,
        logicalPackId: brushLogicalPackId,
        packageFingerprint: sha256(brushHeadManifest),
      },
    );
    assert.equal(delistedExactReplay.changed, false);
    assert.equal(delistedExactReplay.row.lastConfirmedReleaseId, brushHead.id);
    await assert.rejects(
      repository.relistOwned(publisherId, brush.id),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "non-head",
    );
    assert.deepEqual(await repository.relistOwned(publisherId, brushHead.id), {
      id: brushHead.id,
      changed: true,
    });
    assert.deepEqual(await repository.relistOwned(publisherId, brushHead.id), {
      id: brushHead.id,
      changed: false,
    });
    const afterRelist = await dbPool.query<{ updatedAt: Date }>(
      `SELECT "updatedAt" FROM "creator_marketplace_resource" WHERE "id" = $1`,
      [brushHead.id],
    );
    assert.ok(afterRelist.rows[0]!.updatedAt > afterDelist.rows[0]!.updatedAt);
    assert.equal((await repository.findById(brush.id))?.id, brush.id);
    assert.equal(
      (await repository.findHistoryAnchor(brushHead.id))?.id,
      brushHead.id,
    );

    await repository.moderate({
      resourceId: brushHead.id,
      reviewerId,
      action: "hide",
      note: "moderated release relist rejection probe",
    });
    const restoredSuccessorManifest = CreatorMarketplaceResourceManifestSchema.parse({
      ...brushManifest,
      resourceVersion: "1.2.0",
      releaseNotes: "관리자 복구 후 후속 릴리스",
    });
    await assert.rejects(
      repository.publish({
        id: randomUUID(),
        publisherId,
        manifest: restoredSuccessorManifest,
        manifestHash: sha256(restoredSuccessorManifest),
        manifestByteSize: creatorMarketplaceJsonByteSize(restoredSuccessorManifest),
      }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "moderated"
        && "latestVersion" in error
        && error.latestVersion === "1.1.0",
    );
    // The 0034 immutable-release trigger now owns the raw INSERT boundary and runs before the
    // older publish-specific guard, so the canonical package-moderation constraint is authoritative.
    await assert.rejects(
      dbPool.query(
        `INSERT INTO "creator_marketplace_resource" (
           "id", "publisherId", "packageId", "name", "description", "tags",
           "kind", "resourceVersion", "releaseOrdinal", "minimumStudioVersion",
           "license", "provenanceOrigin", "manifest", "manifestHash",
           "manifestByteSize"
         ) VALUES (
           $1, $2, $3, $4, $5, $6::jsonb,
           $7, $8, 3, $9,
           $10, $11, $12::jsonb, $13, $14
         )`,
        [
          randomUUID(),
          publisherId,
          restoredSuccessorManifest.packageId,
          restoredSuccessorManifest.name,
          restoredSuccessorManifest.description,
          JSON.stringify(restoredSuccessorManifest.tags),
          restoredSuccessorManifest.kind,
          restoredSuccessorManifest.resourceVersion,
          restoredSuccessorManifest.minimumStudioVersion,
          restoredSuccessorManifest.license,
          restoredSuccessorManifest.provenance.origin,
          JSON.stringify(restoredSuccessorManifest),
          sha256(restoredSuccessorManifest),
          creatorMarketplaceJsonByteSize(restoredSuccessorManifest),
        ],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint === "creator_marketplace_package_moderated",
    );
    await assert.rejects(
      repository.relistOwned(publisherId, brushHead.id),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "moderated",
    );
    await repository.moderate({
      resourceId: brushHead.id,
      reviewerId,
      action: "restore",
      note: "moderated release probe cleanup",
    });
    const restoredSuccessor = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: restoredSuccessorManifest,
      manifestHash: sha256(restoredSuccessorManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(restoredSuccessorManifest),
    });
    brushRestoredSuccessorId = restoredSuccessor.id;
    cleanupResourceIds.push(restoredSuccessor.id);
    assert.equal(await repository.deleteOwned(publisherId, restoredSuccessor.id), true);
    const delistedSuccessorManifest = CreatorMarketplaceResourceManifestSchema.parse({
      ...brushManifest,
      resourceVersion: "1.3.0",
      releaseNotes: "소유자 내림 이후 허용되는 후속 릴리스",
    });
    const delistedSuccessor = await repository.publish({
      id: randomUUID(),
      publisherId,
      manifest: delistedSuccessorManifest,
      manifestHash: sha256(delistedSuccessorManifest),
      manifestByteSize: creatorMarketplaceJsonByteSize(delistedSuccessorManifest),
    });
    brushDelistedSuccessorId = delistedSuccessor.id;
    cleanupResourceIds.push(delistedSuccessor.id);
    const exactDelistedIdentity = await repository.findIdentityById(
      restoredSuccessor.id,
    );
    assert.equal(exactDelistedIdentity?.releaseDelistedAt !== null, true);
    assert.equal(exactDelistedIdentity?.currentHeadDelistedAt, null);
    assert.equal(await repository.findById(restoredSuccessor.id), null);
    assert.equal((await repository.findById(delistedSuccessor.id))?.id, delistedSuccessor.id);
    const exactDelistedTarget = await libraryRepository.resolveAcquisitionTarget(
      precisionPublisherId,
      restoredSuccessor.id,
    );
    assert.equal(exactDelistedTarget.requestReleaseDelistedAt !== null, true);
    assert.equal(exactDelistedTarget.currentHeadId, delistedSuccessor.id);
    assert.equal(exactDelistedTarget.currentHeadDelistedAt, null);
    await assert.rejects(
      libraryRepository.confirmStudioInstall(
        precisionPublisherId,
        restoredSuccessor.id,
        {
          schemaVersion: 1,
          logicalPackId: brushLogicalPackId,
          packageFingerprint: sha256(restoredSuccessorManifest),
        },
      ),
      (error: unknown) => hasReason(error, "owner-delisted"),
    );
    await assert.rejects(
      dbPool.query(
        `UPDATE "creator_marketplace_resource"
         SET "delistedAt" = NULL
         WHERE "id" = $1`,
        [restoredSuccessor.id],
      ),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint === "creator_marketplace_resource_relist_non_head",
    );

    const orphanReportA = await repository.report({
      id: randomUUID(),
      resourceId: palette.id,
      reporterId: precisionPublisherId,
      reporterKeyHash: precisionReporterKey,
      reason: "other",
      details: "orphan report atomic dismissal probe A",
    });
    const orphanReportB = await repository.report({
      id: randomUUID(),
      resourceId: palette.id,
      reporterId: concurrentReporterId,
      reporterKeyHash: concurrentReporterKey,
      reason: "other",
      details: "orphan report atomic dismissal probe B",
    });
    await assert.rejects(
      repository.dismissOrphanReport({
        reportId: orphanReportA.reportId,
        reviewerId,
        note: "attached reports cannot use orphan dismissal",
      }),
      (error: unknown) =>
        typeof error === "object"
        && error !== null
        && "reason" in error
        && error.reason === "attached",
    );

    assert.equal(await repository.deleteOwned(otherUserId, brush.id), false);
    assert.equal(
      await repository.deleteOwned(publisherId, brush.id),
      false,
      "the repository must reject deletion of a historical non-head release",
    );
    const packageHidden = await repository.moderate({
      resourceId: brush.id,
      reviewerId,
      action: "hide",
      note: "이전 릴리스 신고도 절대 패키지 헤드를 숨김",
    });
    assert.equal(packageHidden?.hidden, true);
    assert.equal(packageHidden?.delisted, false);
    assert.equal(packageHidden?.packageState, "hidden");
    assert.equal(await repository.findById(brush.id), null);
    const packageRestored = await repository.moderate({
      resourceId: brush.id,
      reviewerId,
      action: "restore",
      note: "절대 패키지 헤드의 관리자 숨김 복구",
    });
    assert.equal(packageRestored?.hidden, false);
    assert.equal(packageRestored?.delisted, false);
    assert.equal(packageRestored?.packageState, "active");
    assert.equal(
      (await repository.findById(brush.id))?.id,
      brush.id,
      "a listed historical release is readable while its absolute head is available",
    );
    assert.equal(await repository.deleteOwned(publisherId, brushHead.id), false);
    assert.equal(
      await repository.deleteOwned(publisherId, restoredSuccessor.id),
      false,
      "the delisted predecessor remains delisted",
    );
    assert.equal(await repository.deleteOwned(publisherId, delistedSuccessor.id), true);
    assert.equal(await repository.deleteOwned(otherUserId, palette.id), false);
    assert.equal(await repository.deleteOwned(publisherId, palette.id), true);
    paletteId = null;
    assert.equal(await repository.deleteOwned(otherUserId, exactPalette.id), false);
    assert.equal(await repository.deleteOwned(publisherId, exactPalette.id), true);
    exactPaletteId = null;
    assert.equal(await repository.deleteOwned(otherUserId, otherPublisherBrush.id), true);
    otherPublisherBrushId = null;

    const remaining = await repository.list({
      limit: 10,
      cursor: null,
      sort: "newest",
      publisherId,
      viewerId: publisherId,
    });
    assert.equal(remaining.length, 0);

    await dbPool.query(`DELETE FROM "user" WHERE "id" = $1`, [publisherId]);
    const retainedAfterPublisherRemoval = await libraryRepository.list({
      userId: otherUserId,
      view: "all",
      logicalPackId: brushLogicalPackId,
      packageKeyHash: new Uint8Array(brushPackageKeyHash),
      limit: 10,
      cursor: null,
    });
    assert.equal(retainedAfterPublisherRemoval.rows.length, 1);
    const retainedPublisherHistory = retainedAfterPublisherRemoval.rows[0];
    assert.ok(retainedPublisherHistory);
    assert.equal(retainedPublisherHistory.publisherId, null);
    assert.equal(
      retainedPublisherHistory.lastConfirmedReleaseId,
      null,
      "release FK pointers are cleared when the publisher and releases are deleted",
    );
    assert.equal(retainedPublisherHistory.lastConfirmedResourceVersion, "1.1.0");
    assert.equal(retainedPublisherHistory.lastConfirmedReleaseOrdinal, 2);
    assert.equal(
      retainedPublisherHistory.lastConfirmedManifestHash,
      sha256(brushHeadManifest),
    );
    assert.ok(retainedPublisherHistory.firstConfirmedAt instanceof Date);
    assert.ok(retainedPublisherHistory.lastConfirmedAt instanceof Date);
    assert.ok(
      retainedPublisherHistory.lastConfirmedAt.getTime()
        >= retainedPublisherHistory.firstConfirmedAt.getTime(),
      "bounded confirmation timestamps remain ordered after publisher deletion",
    );
    assert.deepEqual(retainedAfterPublisherRemoval.catalogHeads, []);
    const orphanDismissals = await Promise.allSettled([
      repository.dismissOrphanReport({
        reportId: orphanReportA.reportId,
        reviewerId,
        note: "publisher deletion orphan group dismissal",
      }),
      repository.dismissOrphanReport({
        reportId: orphanReportB.reportId,
        reviewerId,
        note: "publisher deletion orphan group dismissal",
      }),
    ]);
    const fulfilledOrphanDismissal = orphanDismissals.find(
      (result) => result.status === "fulfilled",
    );
    const rejectedOrphanDismissal = orphanDismissals.find(
      (result) => result.status === "rejected",
    );
    assert.ok(fulfilledOrphanDismissal?.status === "fulfilled");
    assert.equal(fulfilledOrphanDismissal.value?.dismissedReportCount, 2);
    assert.ok(rejectedOrphanDismissal?.status === "rejected");
    assert.equal(
      rejectedOrphanDismissal.status === "rejected"
        && typeof rejectedOrphanDismissal.reason === "object"
        && rejectedOrphanDismissal.reason !== null
        && "reason" in rejectedOrphanDismissal.reason
        ? rejectedOrphanDismissal.reason.reason
        : null,
      "closed",
    );
    console.log(
      `creator marketplace DB verification passed: database=${target.pathname.slice(1)} ` +
      "migrations=0021+0022+0030+0031+0032+0033+0034 " +
      "kinds=brush,palette search=trigram+tags " +
      "sort=newest+relevance publish-gate=distributed-20-per-hour " +
      "cursor=millisecond-keyset-no-skip reports=immutable+revision+head-epoch+daily-gated " +
      "moderation=row-locked+hide-restore lifecycle=head-only-delist-relist " +
      "availability=publisher+absolute-head+exact-release " +
      "library=historical-confirm+monotonic-replay+publisher-retention " +
      "orphan-dismiss=atomic-race"
    );
  } finally {
    if (brushId) await repository.deleteOwned(publisherId, brushId).catch(() => false);
    if (paletteId) await repository.deleteOwned(publisherId, paletteId).catch(() => false);
    if (exactPaletteId) {
      await repository.deleteOwned(publisherId, exactPaletteId).catch(() => false);
    }
    if (brushHeadId) {
      await repository.deleteOwned(publisherId, brushHeadId).catch(() => false);
    }
    if (brushRestoredSuccessorId) {
      await repository.deleteOwned(publisherId, brushRestoredSuccessorId).catch(() => false);
    }
    if (brushDelistedSuccessorId) {
      await repository.deleteOwned(publisherId, brushDelistedSuccessorId).catch(() => false);
    }
    if (otherPublisherBrushId) {
      await repository.deleteOwned(otherUserId, otherPublisherBrushId).catch(() => false);
    }
    await dbPool.query(
      `DELETE FROM "creator_marketplace_publish_gate" WHERE "keyHash" = $1::bytea`,
      [publisherGateKey]
    ).catch(() => undefined);
    await dbPool.query(
      `DELETE FROM "creator_marketplace_resource_report"
       WHERE "resourceSnapshotId" = ANY($1::text[])`,
      [cleanupResourceIds],
    ).catch(() => undefined);
    await dbPool.query(
      `DELETE FROM "creator_marketplace_resource_report_gate"
       WHERE encode("keyHash", 'hex') = ANY($1::text[])`,
      [[
        reporterKey,
        publisherReporterKey,
        concurrentReporterKey,
        precisionReporterKey,
      ].map((key) =>
        Buffer.from(key).toString("hex")
      )],
    ).catch(() => undefined);
    await dbPool.query(`DELETE FROM "user" WHERE "id" = ANY($1::text[])`, [
      [
        publisherId,
        otherUserId,
        reviewerId,
        concurrentReporterId,
        precisionPublisherId,
      ],
    ]).catch(() => undefined);
    await dbPool.end();
  }
}

await main();
