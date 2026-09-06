import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

import { creatorMarketplacePackageIdentityPreimage } from "../apps/web/src/shared/lib/creator-marketplace-cloud-library-contract.ts";
import {
  CreatorMarketplaceResourceManifestSchema,
  canonicalizeCreatorMarketplaceJson,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract.ts";
import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "../apps/web/src/shared/lib/creator-marketplace-starter-catalog.ts";

const OLD_MIGRATIONS = [
  "0021_creator_marketplace_resource.sql",
  "0022_creator_marketplace_distributed_gate_search.sql",
  "0030_creator_marketplace_immutable_releases.sql",
  "0031_creator_marketplace_moderation.sql",
  "0032_creator_marketplace_release_lifecycle.sql",
  "0033_creator_marketplace_cloud_library.sql",
  "0034_creator_marketplace_package_moderation.sql",
  "0035_creator_marketplace_3d_asset_kind.sql",
];
const KINDS = ["asset", "brush", "filter", "palette", "template", "3d-preset", "3d-asset"];
const PARITY_MIGRATION = "0037_creator_marketplace_3d_asset_parity.sql";
const LIBRARY_CHECK = "creator_marketplace_library_kind_check";
const REPORT_CHECK = "creator_marketplace_resource_report_evidence_check";
const PUBLISHER = "parity-publisher";

async function run() { // NOSONAR javascript:S3776
  assert.equal(process.env.TOONSPECTRUM_MARKETPLACE_PARITY_DB_TEST, "1", "Explicit disposable-DB opt-in is required");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol), "PostgreSQL is required");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Only loopback test databases are permitted");
  assert.equal(target.search, "", "Connection query overrides are not permitted");
  assert.equal(target.hash, "", "Connection fragments are not permitted");
  assert.ok(/(?:^|[_-])test(?:$|[_-])/iu.test(decodeURIComponent(target.pathname.slice(1))), "A test-scoped database name is required");
  const client = new pg.Client({ connectionString: target.href });
  await client.connect();
  let liveAccepted = 0;
  let contractAccepted = 0;
  let rejected = 0;

  async function migration(name) {
    const sql = await readFile(new URL(`../apps/api/src/db/migrations/${name}`, import.meta.url), "utf8");
    await client.query(sql);
  }

  async function publish(kind, license = "toonspectrum-standard") {
    const seed = CREATOR_MARKETPLACE_STARTER_RECORDS.find((record) => record.kind === kind);
    assert.ok(seed, `A validated starter fixture is required for ${kind}`);
    const id = randomUUID();
    const manifest = CreatorMarketplaceResourceManifestSchema.parse({
      schemaVersion: 1,
      packageId: `parity/${id}`,
      name: "Parity probe",
      description: "Disposable database integrity fixture",
      tags: ["integration", kind],
      kind,
      resourceVersion: "1.0.0",
      minimumStudioVersion: seed.minimumStudioVersion,
      license,
      attributionText: "Parity fixture publisher",
      containsAi: false,
      rightsConfirmed: true,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: seed.compatibility,
      entries: seed.entries,
    });
    const json = canonicalizeCreatorMarketplaceJson(manifest);
    const hash = createHash("sha256").update(json).digest("hex");
    const bytes = Buffer.byteLength(json);
    await client.query(
      `INSERT INTO public.creator_marketplace_resource
        ("id", "publisherId", "packageId", "name", "description", "tags", "kind",
         "resourceVersion", "minimumStudioVersion", "license", "provenanceOrigin",
         "manifest", "manifestHash", "manifestByteSize", "releaseOrdinal", "semverContractVersion")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, '1.0.0', $8, $9, 'original', $10::jsonb, $11, $12, 1, 2)`,
      [id, PUBLISHER, manifest.packageId, manifest.name, manifest.description,
        JSON.stringify(manifest.tags), kind, manifest.minimumStudioVersion, license, json, hash, bytes],
    );
    return { id, manifest, hash, bytes };
  }

  async function library(release, overrides = {}) {
    const id = randomUUID();
    const kind = overrides.kind ?? release.manifest.kind;
    const source = Object.hasOwn(overrides, "source") ? overrides.source : release.id;
    const key = createHash("sha256")
      .update(creatorMarketplacePackageIdentityPreimage(PUBLISHER, release.manifest.packageId))
      .digest();
    await client.query(
      `INSERT INTO public.creator_marketplace_library_item
        ("id", "userId", "packageKeyHash", "publisherId", "packageId", "kind",
         "nameSnapshot", "addedFromReleaseId", "addedFromResourceVersion", "addedFromReleaseOrdinal", "addedFromManifestHash")
       VALUES ($1, 'parity-viewer', $2, $3, $4, $5, 'Parity probe', $6, '1.0.0', 1, $7)`,
      [id, key, PUBLISHER, release.manifest.packageId, kind, source, release.hash],
    );
    liveAccepted += 1;
    return id;
  }

  async function refreshEvidenceProbe() {
    // Historical v1/v2 rows are readable, but 0034 deliberately forbids new live v1/v2 reports.
    // Execute the database's exact CHECK definitions on a temporary contract table, separately
    // from the real v3 insert path. No live-table trigger or constraint is disabled or replaced.
    await client.query(`
      DROP TABLE IF EXISTS pg_temp.marketplace_report_evidence_probe;
      CREATE TEMP TABLE marketplace_report_evidence_probe
        (LIKE public.creator_marketplace_resource_report INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
    `);
  }

  async function report(release, schemaVersion = 3, evidencePatch = {}, columnPatch = {}, contractOnly = false) {
    const id = randomUUID();
    const packageFields = schemaVersion === 1 ? {} : {
      publisherId: PUBLISHER,
      packageId: release.manifest.packageId,
      packageModerationRevision: 0,
      ...(schemaVersion === 3 ? { packageReportEpoch: 1 } : {}),
    };
    const evidence = {
      schemaVersion,
      resourceId: release.id,
      manifestHash: release.hash,
      manifestByteSize: release.bytes,
      kind: release.manifest.kind,
      license: release.manifest.license,
      ...packageFields,
      ...evidencePatch,
    };
    const columns = {
      resourceId: release.id,
      publisherId: packageFields.publisherId ?? null,
      packageId: packageFields.packageId ?? null,
      revision: packageFields.packageModerationRevision ?? null,
      epoch: packageFields.packageReportEpoch ?? null,
      ...columnPatch,
    };
    const table = contractOnly ? "pg_temp.marketplace_report_evidence_probe" : "public.creator_marketplace_resource_report";
    await client.query(
      `INSERT INTO ${table}
        ("id", "resourceId", "resourceSnapshotId", "reporterId", "reporterKeyHash", "reason", "evidence",
         "packagePublisherIdSnapshot", "packageIdSnapshot", "packageModerationRevision", "packageReportEpoch")
       VALUES ($1, $2, $3, 'parity-viewer', $4, 'other', $5::jsonb, $6, $7, $8, $9)`,
      [id, columns.resourceId, release.id, randomBytes(32), JSON.stringify(evidence),
        columns.publisherId, columns.packageId, columns.revision, columns.epoch],
    );
    if (contractOnly) contractAccepted += 1;
    else liveAccepted += 1;
    return id;
  }

  async function mustReject(operation, constraint) {
    await assert.rejects(operation, (error) => error?.code === "23514" && (!constraint || error.constraint === constraint),
      `Expected PostgreSQL CHECK rejection${constraint ? " from " + constraint : ""}`);
  }

  async function unchangedGuards() {
    const constraints = await client.query(`
      SELECT conrelid::regclass::text AS relation, conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN ('public.creator_marketplace_library_item'::regclass, 'public.creator_marketplace_resource_report'::regclass)
        AND conname NOT IN ($1, $2)
      ORDER BY relation, conname
    `, [LIBRARY_CHECK, REPORT_CHECK]);
    const triggers = await client.query(`
      SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE tgrelid IN ('public.creator_marketplace_library_item'::regclass, 'public.creator_marketplace_resource_report'::regclass)
        AND NOT tgisinternal
      ORDER BY tgname
    `);
    return { constraints: constraints.rows, triggers: triggers.rows };
  }

  try {
    const tables = await client.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public'");
    assert.equal(tables.rows[0].count, 0, "Refusing a nonempty database; this verifier never resets existing schemas");
    await client.query(`
      CREATE TABLE public."user" (id text PRIMARY KEY, name text, avatar text, status text NOT NULL DEFAULT 'active');
      CREATE TABLE public.toonspectrum_schema_migration (
        id text PRIMARY KEY,
        "appliedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT toonspectrum_schema_migration_id_check CHECK (length(id) BETWEEN 1 AND 160)
      );
      INSERT INTO public."user" (id, name) VALUES ('parity-viewer', 'Parity viewer'), ('parity-publisher', 'Parity publisher');
    `);
    for (const name of OLD_MIGRATIONS) await migration(name);
    const releases = new Map();
    for (const kind of KINDS) releases.set(kind, await publish(kind));
    const brush = releases.get("brush");
    const three = releases.get("3d-asset");
    const retainedLibraryId = await library(brush);
    const retainedReportId = await report(brush);
    await mustReject(() => library(three), LIBRARY_CHECK);
    await mustReject(() => report(three), REPORT_CHECK);
    await refreshEvidenceProbe();
    for (const version of [1, 2, 3]) {
      await mustReject(() => report(three, version, {}, {}, true), REPORT_CHECK);
    }
    const guards = await unchangedGuards();
    console.log("PRE-0037: reproduced live 3D acquisition/report kind failures and historical v1/v2/v3 CHECK rejection.");

    await migration(PARITY_MIGRATION);
    assert.deepEqual(await unchangedGuards(), guards, "Unrelated constraints and all live triggers must remain unchanged");
    await refreshEvidenceProbe();
    for (const kind of KINDS) {
      const release = releases.get(kind);
      if (kind !== "brush") await library(release);
      await report(release);
      for (const version of [1, 2, 3]) await report(release, version, {}, {}, true);
    }
    for (const license of ["cc0-1.0", "cc-by-4.0", "cc-by-nc-4.0"]) {
      await report(await publish("3d-asset", license));
    }
    await mustReject(() => library(three, { kind: "unknown-kind" }));
    await mustReject(() => library(three, { source: null }), "creator_marketplace_library_source_integrity");
    for (const patch of [
      { kind: "unknown-kind" }, { kind: undefined }, { kind: null },
      { resourceId: randomUUID() }, { manifestHash: "invalid" },
      { manifestByteSize: 0 }, { manifestByteSize: 65537 },
      { license: "invented-license" }, { publisherId: "different-publisher" },
      { packageId: "different/package" }, { packageModerationRevision: 2 }, { packageReportEpoch: 2 },
    ]) await mustReject(() => report(three, 3, patch), REPORT_CHECK);
    await mustReject(() => report(three, 99));
    await mustReject(() => report(three, 3, {}, { epoch: null }));
    await mustReject(() => report(three, 3, {}, { resourceId: null }));
    for (const version of [1, 2]) {
      await mustReject(() => report(three, version), "creator_marketplace_resource_report_evidence_v3_required");
      await mustReject(() => report(three, version, {}, { epoch: 1 }, true), REPORT_CHECK);
    }

    assert.equal((await client.query('SELECT kind FROM public.creator_marketplace_library_item WHERE id = $1', [retainedLibraryId])).rows[0].kind, "brush");
    assert.equal((await client.query('SELECT evidence FROM public.creator_marketplace_resource_report WHERE id = $1', [retainedReportId])).rows[0].evidence.kind, "brush");
    const constraints = await client.query(`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid IN ('public.creator_marketplace_library_item'::regclass, 'public.creator_marketplace_resource_report'::regclass)
        AND conname IN ($1, $2)
    `, [LIBRARY_CHECK, REPORT_CHECK]);
    assert.equal(constraints.rowCount, 2);
    assert.ok(constraints.rows.every((row) => row.convalidated));
    console.log(`POST-0037: ${liveAccepted} valid live writes; ${contractAccepted} historical CHECK probes; ${rejected} rejected invalid writes/probes; old rows and all live guards preserved.`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("Marketplace 3D parity verification failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
