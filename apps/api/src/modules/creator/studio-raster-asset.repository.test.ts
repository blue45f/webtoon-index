import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  canonicalStudioRasterJson,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import {
  STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK,
} from "../../../../web/src/shared/lib/studio-raster-asset-contract";
import { creatorWorkRasterAssets } from "../../db/studio-raster-asset.schema";

import {
  DrizzleStudioRasterAssetRepository,
  STUDIO_RASTER_ASSET_REPOSITORY,
  StudioRasterAssetQuotaError,
  StudioRasterAssetCleanupOwnershipError,
  StudioRasterAssetReferencedError,
  assertStudioRasterAssetQuota,
  isStudioRasterAssetIdempotentReplay,
  planStudioRasterAssetOrphanCleanup,
  resolveStudioRasterAssetAccess,
  studioRasterAssetRepositoryProvider,
  studioCrdtHydrationReferencesRasterAsset,
} from "./studio-raster-asset.repository";

function names(values: readonly { name?: string; config?: { name?: string } }[]): string[] {
  return values.flatMap((value) => {
    const name = value.name ?? value.config?.name;
    return name ? [name] : [];
  }).sort();
}

describe("studio raster asset persistence contract", () => {
  it("ties immutable content-addressed tile bodies to the work lifecycle", () => {
    const table = getTableConfig(creatorWorkRasterAssets);
    expect(table.name).toBe("creator_work_raster_asset");
    expect(table.primaryKeys.map((key) => key.getName())).toEqual([
      "creator_work_raster_asset_pkey",
    ]);
    expect(table.foreignKeys.map((key) => key.getName()).sort()).toEqual([
      "creator_work_raster_asset_uploaded_by_fkey",
      "creator_work_raster_asset_work_fkey",
    ]);
    expect(names(table.indexes)).toEqual([
      "idx_creator_work_raster_asset_uploader_created",
    ]);
    expect(names(table.checks)).toEqual([
      "creator_work_raster_asset_byte_length_check",
      "creator_work_raster_asset_content_address_check",
      "creator_work_raster_asset_dimensions_check",
      "creator_work_raster_asset_media_type_check",
      "creator_work_raster_asset_payload_size_check",
    ]);
  });

  it("exposes only receipt-bound upload compensation, never general deletion", () => {
    expect(studioRasterAssetRepositoryProvider.provide).toBe(STUDIO_RASTER_ASSET_REPOSITORY);
    expect(studioRasterAssetRepositoryProvider.useFactory()).toBeInstanceOf(
      DrizzleStudioRasterAssetRepository
    );
    expect(DrizzleStudioRasterAssetRepository.prototype).toHaveProperty(
      "deleteUnreferencedUpload"
    );
    expect(DrizzleStudioRasterAssetRepository.prototype).not.toHaveProperty("delete");
    expect(DrizzleStudioRasterAssetRepository.prototype).not.toHaveProperty(
      "deleteInternalForTrustedGarbageCollection"
    );
  });

  it("allows active collaborators to view but only owner/admin/editor to upload", () => {
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "owner",
      ownerUserId: "owner",
    })).toEqual({ view: true, edit: true });
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "admin",
      ownerUserId: "owner",
      membership: { userId: "admin", role: "admin", status: "active" },
    })).toEqual({ view: true, edit: true });
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "editor",
      ownerUserId: "owner",
      membership: { userId: "editor", role: "editor", status: "active" },
    })).toEqual({ view: true, edit: true });
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "commenter",
      ownerUserId: "owner",
      membership: { userId: "commenter", role: "commenter", status: "active" },
    })).toEqual({ view: true, edit: false });
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "viewer",
      ownerUserId: "owner",
      membership: { userId: "viewer", role: "viewer", status: "active" },
    })).toEqual({ view: true, edit: false });
    expect(resolveStudioRasterAssetAccess({
      actorUserId: "pending",
      ownerUserId: "owner",
      membership: { userId: "pending", role: "editor", status: "pending" },
    })).toEqual({ view: false, edit: false });
  });

  it("deduplicates exact retries but refuses immutable metadata conflicts", () => {
    const value = {
      assetId: "a".repeat(64),
      sha256: "a".repeat(64),
      mediaType: "image/png" as const,
      width: 32,
      height: 16,
      byteLength: 1_024,
    };
    expect(isStudioRasterAssetIdempotentReplay(value, structuredClone(value))).toBe(true);
    expect(isStudioRasterAssetIdempotentReplay(value, {
      ...value,
      byteLength: 1_025,
    })).toBe(false);
    expect(isStudioRasterAssetIdempotentReplay(value, {
      ...value,
      width: 31,
    })).toBe(false);
  });

  it("allows compensation only for an exact uploader receipt outside durable history", () => {
    const receipt = {
      assetId: "a".repeat(64),
      sha256: "a".repeat(64),
      mediaType: "image/png" as const,
      width: 32,
      height: 16,
      byteLength: 1_024,
    };
    const existing = { ...receipt, uploadedBy: "editor" };
    expect(planStudioRasterAssetOrphanCleanup({
      existing,
      actorUserId: "editor",
      receipt,
      durablyReferenced: false,
    })).toBe(true);
    expect(planStudioRasterAssetOrphanCleanup({
      existing,
      actorUserId: "editor",
      receipt: { ...receipt, width: 31 },
      durablyReferenced: false,
    })).toBe(false);
    expect(() => planStudioRasterAssetOrphanCleanup({
      existing,
      actorUserId: "other-editor",
      receipt,
      durablyReferenced: false,
    })).toThrow(StudioRasterAssetCleanupOwnershipError);
    expect(() => planStudioRasterAssetOrphanCleanup({
      existing,
      actorUserId: "editor",
      receipt,
      durablyReferenced: true,
    })).toThrow(StudioRasterAssetReferencedError);
  });

  it("detects a raster receipt retained in snapshot or update hydration", () => {
    const asset = {
      scope: "work" as const,
      assetId: "b".repeat(64),
      sha256: "b".repeat(64),
      byteLength: 256,
      mediaType: "image/png" as const,
      width: 8,
      height: 8,
    };
    const surface = {
      version: STUDIO_RASTER_CRDT_VERSION,
      surfaceId: "surface-main",
      width: 128,
      height: 128,
      tileSize: 128,
    };
    const operation = {
      version: STUDIO_RASTER_CRDT_VERSION,
      operationId: "00000000-0000-4000-8000-000000000001",
      order: { logicalClock: "1", actorId: "editor" },
      pageId: "page-1",
      layerId: "page-root",
      intent: "paint" as const,
      kernel: STUDIO_RASTER_KERNEL,
      semanticParametersSha256: "c".repeat(64),
      patches: [{
        tileX: 0,
        tileY: 0,
        region: { x: 0, y: 0, width: 8, height: 8 },
        effect: { kind: "composite" as const, blendMode: "source-over" as const, payload: asset },
      }],
    };
    const doc = new Y.Doc({ gc: false });
    doc.getMap(STUDIO_CRDT_RASTER_SURFACES_ROOT)
      .set(surface.surfaceId, canonicalStudioRasterJson(surface));
    doc.getMap(STUDIO_CRDT_RASTER_OPERATIONS_ROOT)
      .set(operation.operationId, canonicalStudioRasterJson({ surfaceId: surface.surfaceId, operation }));
    doc.getMap(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT);
    doc.getMap(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT);
    doc.getMap(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT);
    const payload = Y.encodeStateAsUpdate(doc);
    const empty = new Y.Doc({ gc: false });
    const emptyPayload = Y.encodeStateAsUpdate(empty);
    empty.destroy();
    doc.destroy();

    expect(studioCrdtHydrationReferencesRasterAsset({
      snapshot: {
        workId: "work-1",
        snapshot: payload,
        compactedSequence: 1n,
        updatedAt: new Date(),
      },
      updates: [],
    }, asset.assetId)).toBe(true);
    expect(studioCrdtHydrationReferencesRasterAsset({
      snapshot: null,
      updates: [{
        workId: "work-1",
        sequence: 1n,
        updateId: "00000000-0000-4000-8000-000000000002",
        actorUserId: "editor",
        payload,
        createdAt: new Date(),
      }],
    }, asset.assetId)).toBe(true);
    expect(studioCrdtHydrationReferencesRasterAsset({
      snapshot: {
        workId: "work-1",
        snapshot: emptyPayload,
        compactedSequence: 0n,
        updatedAt: new Date(),
      },
      updates: [],
    }, asset.assetId)).toBe(false);
  });

  it("fails closed at the 250k row or 2GiB work quota", () => {
    expect(() => assertStudioRasterAssetQuota({
      assetCount: STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK - 1,
      totalBytes: STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK - 1,
      incomingBytes: 1,
    })).not.toThrow();
    expect(() => assertStudioRasterAssetQuota({
      assetCount: STUDIO_RASTER_ASSET_MAX_ASSETS_PER_WORK,
      totalBytes: 0,
      incomingBytes: 1,
    })).toThrow(StudioRasterAssetQuotaError);
    expect(() => assertStudioRasterAssetQuota({
      assetCount: 0,
      totalBytes: STUDIO_RASTER_ASSET_MAX_TOTAL_BYTES_PER_WORK,
      incomingBytes: 1,
    })).toThrow(StudioRasterAssetQuotaError);
    expect(() => assertStudioRasterAssetQuota({
      assetCount: 0,
      totalBytes: Number.NaN,
      incomingBytes: 1,
    })).toThrow(StudioRasterAssetQuotaError);
  });
});
