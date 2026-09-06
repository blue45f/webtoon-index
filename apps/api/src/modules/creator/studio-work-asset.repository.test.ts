import { createHash } from "node:crypto";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_WORK_ASSET_MAX_TOMBSTONES_PER_WORK,
  STUDIO_WORK_ASSET_MAX_TOTAL_BYTES_PER_WORK,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";
import {
  creatorAssetStorageObjects,
  creatorWorkAssetStorageReferences,
} from "../../db/creator-asset-object-storage.schema";
import {
  creatorWorkAssets,
  creatorWorkAssetTombstones,
} from "../../db/schema";

import {
  assertStudioWorkAssetIdNotReserved,
  assertStudioWorkAssetSourceStorageObject,
  DrizzleStudioWorkAssetRepository,
  isStudioWorkAssetIdempotentReplay,
  planStudioLinked3dPassOrphanCleanup,
  planStudioWorkAssetBatchUpsert,
  planStudioWorkAssetOrphanCleanup,
  planStudioWorkAssetDeletion,
  resolveStudioWorkAssetAccess,
  STUDIO_WORK_ASSET_REPOSITORY,
  STUDIO_WORK_ASSET_MANIFEST_PROJECTION,
  studioCrdtHydrationReferencesWorkAsset,
  studioLinked3dJsonAuthoritiesReferenceAsset,
  StudioWorkAssetCleanupOwnershipError,
  StudioWorkAssetImmutableConflictError,
  StudioWorkAssetQuotaError,
  StudioWorkAssetReferencedError,
  StudioWorkAssetStorageReferenceConflictError,
  StudioWorkAssetTypeConflictError,
  studioWorkAssetRepositoryProvider,
} from "./studio-work-asset.repository";

import type { StudioWorkAssetWrite } from "./studio-work-asset.repository";

function names(values: readonly { name?: string; config?: { name?: string } }[]): string[] {
  return values.flatMap((value) => {
    const name = value.name ?? value.config?.name;
    return name ? [name] : [];
  }).sort();
}

const LINKED_PASS_HASH = "a".repeat(64);
const LINKED_PASS_ASSET_ID = `linked3d-pass-sha256-${LINKED_PASS_HASH}`;
const LINKED_PASS_LOCATOR = `studio-opfs-cas:sha256:${LINKED_PASS_HASH}`;

function linkedPassEnvelope() {
  const sceneHash = `sha256:${"b".repeat(64)}`;
  return {
    cover: "",
    pages: [],
    doc: {
      pagesList: [{
        id: "page-1",
        elements: [{ id: "line-1", type: "image", src: LINKED_PASS_LOCATOR }],
        linked3dRender: {
          kind: "toonspectrum.studio-linked-3d-render",
          version: 2,
          authority: "studio-project-linked-3d-pass-index",
          links: [{
            bundleId: "bundle-1",
            shotId: "shot-1",
            sourceShotId: null,
            stageSourceHash: sceneHash,
            layers: [{ elementId: "line-1", role: "main-line" }],
            passRevision: {
              revision: 1,
              sourceHash: sceneHash,
              sceneHash,
              cameraHash: sceneHash,
              baseGeometryHash: sceneHash,
              topologyHash: sceneHash,
              objectIdentityHash: sceneHash,
              objectStableIds: ["obj/room"],
              passRootHash: sceneHash,
              artifact: {
                pass: "line",
                role: "main-line",
                contentHash: `sha256:${LINKED_PASS_HASH}`,
                byteSize: 68,
                mime: "image/png",
                width: 64,
                height: 32,
                locator: LINKED_PASS_LOCATOR,
              },
            },
            corrections: [],
          }],
        },
      }],
    },
  };
}

function batchWrite(assetId: string, fill: number): StudioWorkAssetWrite {
  const payload = Uint8Array.of(fill, fill + 1);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  return {
    workId: "work-1",
    assetId,
    elementType: "image",
    mimeType: "image/png",
    descriptor: {
      version: 1,
      element: {
        id: assetId,
        type: "image",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
      },
    },
    payload,
    sha256,
    intrinsicImage: { width: 1, height: 1, decodedRgbaBytes: 4 },
    storageObject: {
      contractVersion: "toonspectrum.supabase-object-storage.v1",
      purpose: "source",
      digest: `sha256:${sha256}`,
      objectPath: `sha256/${sha256.slice(0, 2)}/${sha256}`,
      byteLength: payload.byteLength,
      contentType: "image/png",
    },
  };
}

function existingFrom(write: StudioWorkAssetWrite) {
  return {
    assetId: write.assetId,
    elementType: write.elementType,
    sha256: write.sha256,
    descriptor: write.descriptor,
    intrinsicImage: write.intrinsicImage,
  };
}

describe("studio work-scoped asset persistence contract", () => {
  it("ties opaque asset IDs and bounded payloads to the work lifecycle", () => {
    const table = getTableConfig(creatorWorkAssets);
    expect(table.name).toBe("creator_work_asset");
    expect(table.primaryKeys.map((key) => key.getName())).toEqual(["creator_work_asset_pkey"]);
    expect(table.foreignKeys.map((key) => key.getName()).sort()).toEqual([
      "creator_work_asset_uploaded_by_fkey",
      "creator_work_asset_work_fkey",
    ]);
    expect(names(table.indexes)).toEqual(["idx_creator_work_asset_uploader_updated"]);
    expect(names(table.checks)).toEqual([
      "creator_work_asset_byte_size_check",
      "creator_work_asset_descriptor_check",
      "creator_work_asset_element_type_check",
      "creator_work_asset_id_check",
      "creator_work_asset_intrinsic_image_check",
      "creator_work_asset_media_contract_check",
      "creator_work_asset_payload_size_check",
      "creator_work_asset_sha256_check",
    ]);
    expect(STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK).toBe(250);
    expect(STUDIO_WORK_ASSET_MAX_TOTAL_BYTES_PER_WORK).toBe(256 * 1024 * 1024);
  });

  it("persists exact object identity and work-scoped references with source-retention constraints", () => {
    const objectTable = getTableConfig(creatorAssetStorageObjects);
    expect(objectTable.name).toBe("creator_asset_storage_object");
    expect(objectTable.primaryKeys.map((key) => key.getName())).toEqual([
      "creator_asset_storage_object_pkey",
    ]);
    expect(names(objectTable.indexes)).toEqual([
      "creator_asset_storage_object_path_unique",
    ]);
    expect(names(objectTable.checks)).toEqual([
      "creator_asset_storage_object_byte_length_check",
      "creator_asset_storage_object_content_type_check",
      "creator_asset_storage_object_contract_check",
      "creator_asset_storage_object_digest_path_check",
      "creator_asset_storage_object_lifecycle_check",
      "creator_asset_storage_object_purpose_check",
      "creator_asset_storage_object_source_retention_check",
      "creator_asset_storage_object_state_check",
    ]);

    const referenceTable = getTableConfig(creatorWorkAssetStorageReferences);
    expect(referenceTable.name).toBe("creator_work_asset_storage_reference");
    expect(referenceTable.primaryKeys.map((key) => key.getName())).toEqual([
      "creator_work_asset_storage_reference_pkey",
    ]);
    expect(referenceTable.foreignKeys.map((key) => key.getName()).sort()).toEqual([
      "creator_work_asset_storage_reference_asset_fkey",
      "creator_work_asset_storage_reference_created_by_fkey",
      "creator_work_asset_storage_reference_object_fkey",
    ]);
    expect(names(referenceTable.indexes)).toEqual([
      "idx_creator_work_asset_storage_reference_object",
      "idx_creator_work_asset_storage_reference_source",
    ]);
    expect(names(referenceTable.checks)).toEqual([
      "creator_work_asset_storage_reference_digest_check",
      "creator_work_asset_storage_reference_id_check",
      "creator_work_asset_storage_reference_lifecycle_check",
      "creator_work_asset_storage_reference_purpose_check",
      "creator_work_asset_storage_reference_source_binding_check",
    ]);
  });

  it("binds every source reference to the exact immutable payload digest and metadata", () => {
    const write = batchWrite("asset-1", 1);
    expect(assertStudioWorkAssetSourceStorageObject(write)).toEqual(write.storageObject);
    expect(() => assertStudioWorkAssetSourceStorageObject({
      ...write,
      payload: Uint8Array.of(9, 9),
    })).toThrow(StudioWorkAssetStorageReferenceConflictError);
    expect(() => assertStudioWorkAssetSourceStorageObject({
      ...write,
      storageObject: { ...write.storageObject, purpose: "derived" },
    })).toThrow(StudioWorkAssetStorageReferenceConflictError);
    expect(() => assertStudioWorkAssetSourceStorageObject({
      ...write,
      storageObject: { ...write.storageObject, contentType: "image/jpeg" },
    })).toThrow(StudioWorkAssetStorageReferenceConflictError);
  });

  it("permanently reserves deleted IDs inside the work lifecycle", () => {
    const table = getTableConfig(creatorWorkAssetTombstones);
    expect(table.name).toBe("creator_work_asset_tombstone");
    expect(table.primaryKeys.map((key) => key.getName())).toEqual([
      "creator_work_asset_tombstone_pkey",
    ]);
    expect(table.foreignKeys.map((key) => key.getName()).sort()).toEqual([
      "creator_work_asset_tombstone_deleted_by_fkey",
      "creator_work_asset_tombstone_work_fkey",
    ]);
    expect(names(table.indexes)).toEqual([
      "idx_creator_work_asset_tombstone_deleted_by",
    ]);
    expect(names(table.checks)).toEqual([
      "creator_work_asset_tombstone_element_type_check",
      "creator_work_asset_tombstone_id_check",
    ]);
    expect(STUDIO_WORK_ASSET_MAX_TOMBSTONES_PER_WORK).toBe(5_000);
  });

  it("exposes a swappable repository provider", () => {
    expect(studioWorkAssetRepositoryProvider.provide).toBe(STUDIO_WORK_ASSET_REPOSITORY);
    const repository = studioWorkAssetRepositoryProvider.useFactory();
    expect(repository).toBeInstanceOf(
      DrizzleStudioWorkAssetRepository
    );
    expect(repository).toHaveProperty("getContents");
    expect(repository).toHaveProperty("getContentsInTransaction");
    expect(repository).toHaveProperty("upsertBatch");
  });

  it("keeps manifest preflight queries metadata-only", () => {
    expect(Object.keys(STUDIO_WORK_ASSET_MANIFEST_PROJECTION).sort()).toEqual([
      "assetId",
      "byteSize",
      "decodedRgbaBytes",
      "descriptor",
      "elementType",
      "intrinsicHeight",
      "intrinsicWidth",
      "mimeType",
      "sha256",
      "updatedAt",
    ]);
    expect(STUDIO_WORK_ASSET_MANIFEST_PROJECTION).not.toHaveProperty("payload");
  });

  it("exposes only receipt-bound orphan cleanup plus the trusted maintenance seam", () => {
    expect(DrizzleStudioWorkAssetRepository.prototype).not.toHaveProperty("delete");
    expect(DrizzleStudioWorkAssetRepository.prototype)
      .toHaveProperty("deleteInternalForTrustedGarbageCollection");
    expect(DrizzleStudioWorkAssetRepository.prototype)
      .toHaveProperty("deleteUnreferencedUpload");
  });

  it("grants reads to active viewers but mutations only to owner/admin/editor", () => {
    expect(resolveStudioWorkAssetAccess({
      actorUserId: "owner",
      ownerUserId: "owner",
    })).toEqual({ view: true, edit: true });
    expect(resolveStudioWorkAssetAccess({
      actorUserId: "editor",
      ownerUserId: "owner",
      membership: { userId: "editor", role: "editor", status: "active" },
    })).toEqual({ view: true, edit: true });
    expect(resolveStudioWorkAssetAccess({
      actorUserId: "viewer",
      ownerUserId: "owner",
      membership: { userId: "viewer", role: "viewer", status: "active" },
    })).toEqual({ view: true, edit: false });
    expect(resolveStudioWorkAssetAccess({
      actorUserId: "invitee",
      ownerUserId: "owner",
      membership: { userId: "invitee", role: "editor", status: "pending" },
    })).toEqual({ view: false, edit: false });
    expect(resolveStudioWorkAssetAccess({
      actorUserId: "intruder",
      ownerUserId: "owner",
      membership: { userId: "someone-else", role: "admin", status: "active" },
    })).toEqual({ view: false, edit: false });
  });

  it("allows exact retry deduplication but keeps every asset ID immutable", () => {
    const descriptor = {
      version: 1 as const,
      element: {
        id: "asset-1",
        type: "image" as const,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
    };
    const existing = { elementType: "image" as const, sha256: "a".repeat(64), descriptor };
    const intrinsicImage = { width: 10, height: 10, decodedRgbaBytes: 400 };
    const existingWithIntrinsic = { ...existing, intrinsicImage };
    expect(isStudioWorkAssetIdempotentReplay(existingWithIntrinsic, structuredClone(existingWithIntrinsic))).toBe(true);
    expect(isStudioWorkAssetIdempotentReplay(existingWithIntrinsic, {
      ...existingWithIntrinsic,
      descriptor: {
        element: {
          rotation: 0,
          height: 10,
          width: 10,
          y: 0,
          x: 0,
          type: "image",
          id: "asset-1",
        },
        version: 1,
      },
    })).toBe(true);
    expect(isStudioWorkAssetIdempotentReplay(existingWithIntrinsic, {
      ...existingWithIntrinsic,
      sha256: "b".repeat(64),
    })).toBe(false);
    expect(isStudioWorkAssetIdempotentReplay(existingWithIntrinsic, {
      ...existingWithIntrinsic,
      descriptor: {
        ...descriptor,
        element: { ...descriptor.element, x: 1 },
      },
    })).toBe(false);
    expect(isStudioWorkAssetIdempotentReplay(existingWithIntrinsic, {
      ...existingWithIntrinsic,
      intrinsicImage: { ...intrinsicImage, decodedRgbaBytes: 399 },
    })).toBe(false);
    expect(() => assertStudioWorkAssetIdNotReserved(true))
      .toThrow(StudioWorkAssetImmutableConflictError);
    expect(() => assertStudioWorkAssetIdNotReserved(false)).not.toThrow();
  });

  it("preflights the complete pair before exposing any insertable row set", () => {
    const background = batchWrite("lift-background", 1);
    const foreground = batchWrite("lift-foreground", 3);
    const insert = vi.fn();

    try {
      const missing = planStudioWorkAssetBatchUpsert({
        writes: [background, foreground],
        existing: [{
          ...existingFrom(foreground),
          sha256: "f".repeat(64),
        }],
        reservedAssetIds: new Set(),
        assetCount: 10,
        totalBytes: 100,
      });
      insert(missing);
    } catch (error) {
      expect(error).toBeInstanceOf(StudioWorkAssetImmutableConflictError);
    }
    expect(insert).not.toHaveBeenCalled();

    expect(planStudioWorkAssetBatchUpsert({
      writes: [background, foreground],
      existing: [existingFrom(background)],
      reservedAssetIds: new Set(),
      assetCount: 10,
      totalBytes: 100,
    })).toEqual([foreground]);
    expect(planStudioWorkAssetBatchUpsert({
      writes: [background, foreground],
      existing: [existingFrom(background), existingFrom(foreground)],
      reservedAssetIds: new Set(),
      assetCount: 10,
      totalBytes: 100,
    })).toEqual([]);
  });

  it("rejects a reserved, conflicting, duplicate, or aggregate-over-quota pair as one plan", () => {
    const background = batchWrite("lift-background", 1);
    const foreground = batchWrite("lift-foreground", 3);
    const plan = (overrides: Partial<Parameters<typeof planStudioWorkAssetBatchUpsert>[0]> = {}) =>
      planStudioWorkAssetBatchUpsert({
        writes: [background, foreground],
        existing: [],
        reservedAssetIds: new Set(),
        assetCount: 0,
        totalBytes: 0,
        ...overrides,
      });

    expect(() => plan({
      reservedAssetIds: new Set([foreground.assetId]),
    })).toThrow(StudioWorkAssetImmutableConflictError);
    expect(() => plan({
      existing: [{
        ...existingFrom(foreground),
        elementType: "vrm",
      }],
    })).toThrow(StudioWorkAssetTypeConflictError);
    expect(() => plan({
      writes: [background, { ...foreground, assetId: background.assetId }],
    })).toThrow(StudioWorkAssetImmutableConflictError);
    expect(() => plan({
      assetCount: STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK - 1,
    })).toThrow(StudioWorkAssetQuotaError);
    expect(() => plan({
      totalBytes: STUDIO_WORK_ASSET_MAX_TOTAL_BYTES_PER_WORK - 3,
    })).toThrow(StudioWorkAssetQuotaError);
  });

  it("reserves before physical deletion and fails closed at the tombstone cap", () => {
    expect(planStudioWorkAssetDeletion(null, "image", 0)).toBe(false);
    expect(planStudioWorkAssetDeletion("vrm", "image", 0)).toBe(false);
    expect(planStudioWorkAssetDeletion("image", "image", 4_999)).toBe(true);
    expect(() => planStudioWorkAssetDeletion("image", "image", 5_000))
      .toThrow(StudioWorkAssetQuotaError);
    expect(() => planStudioWorkAssetDeletion("image", "image", Number.NaN))
      .toThrow(StudioWorkAssetQuotaError);
  });

  it("allows compensation only for the exact uploader receipt and no durable reference", () => {
    const existing = {
      elementType: "image",
      sha256: "a".repeat(64),
      uploadedBy: "editor-1",
    };
    expect(planStudioWorkAssetOrphanCleanup({
      existing,
      actorUserId: "editor-1",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: false,
    })).toBe(true);
    expect(planStudioWorkAssetOrphanCleanup({
      existing,
      actorUserId: "editor-1",
      elementType: "image",
      expectedSha256: "b".repeat(64),
      durablyReferenced: false,
    })).toBe(false);
    expect(() => planStudioWorkAssetOrphanCleanup({
      existing,
      actorUserId: "editor-2",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: false,
    })).toThrow(StudioWorkAssetCleanupOwnershipError);
    expect(() => planStudioWorkAssetOrphanCleanup({
      existing,
      actorUserId: "editor-1",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: true,
    })).toThrow(StudioWorkAssetReferencedError);
  });

  it("treats referenced or collaborator-owned linked compensation as a safe no-op", () => {
    const existing = {
      elementType: "image",
      sha256: "a".repeat(64),
      uploadedBy: "editor-1",
    };
    expect(planStudioLinked3dPassOrphanCleanup({
      existing,
      actorUserId: "editor-1",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: false,
    })).toBe(true);
    expect(planStudioLinked3dPassOrphanCleanup({
      existing,
      actorUserId: "editor-1",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: true,
    })).toBe(false);
    expect(planStudioLinked3dPassOrphanCleanup({
      existing,
      actorUserId: "editor-2",
      elementType: "image",
      expectedSha256: "a".repeat(64),
      durablyReferenced: false,
    })).toBe(false);
  });

  it("retains linked pass uploads referenced by current or retained JSON authority", () => {
    const empty = { cover: "", pages: [], doc: { pagesList: [] } };
    expect(studioLinked3dJsonAuthoritiesReferenceAsset({
      assetId: LINKED_PASS_ASSET_ID,
      current: linkedPassEnvelope(),
      revisionSnapshots: [],
    })).toBe(true);
    expect(studioLinked3dJsonAuthoritiesReferenceAsset({
      assetId: LINKED_PASS_ASSET_ID,
      current: empty,
      revisionSnapshots: [{
        ...linkedPassEnvelope(),
        status: "draft",
        revision: 1,
      }],
    })).toBe(true);
    expect(studioLinked3dJsonAuthoritiesReferenceAsset({
      assetId: LINKED_PASS_ASSET_ID,
      current: empty,
      revisionSnapshots: [{ ...empty, status: "draft", revision: 1 }],
    })).toBe(false);
  });

  it("fails linked pass upload cleanup closed for malformed retained JSON", () => {
    const empty = { cover: "", pages: [], doc: { pagesList: [] } };
    expect(studioLinked3dJsonAuthoritiesReferenceAsset({
      assetId: LINKED_PASS_ASSET_ID,
      current: empty,
      revisionSnapshots: [{ cover: "", pages: [] }],
    })).toBe(true);
    expect(studioLinked3dJsonAuthoritiesReferenceAsset({
      assetId: LINKED_PASS_ASSET_ID,
      current: {
        cover: "",
        pages: [],
        doc: { hidden: LINKED_PASS_LOCATOR },
      },
      revisionSnapshots: [],
    })).toBe(true);
  });

  it("retains materialized asset references even after the scene element is deleted", () => {
    const document = new Y.Doc();
    document.getMap("scene-elements").set("asset-1", true);
    const reference = document.getMap(`scene-element:${encodeURIComponent("asset-1")}`);
    reference.set("type", "reference");
    reference.set("deleted", true);
    const state = {
      snapshot: {
        workId: "work-1",
        snapshot: Y.encodeStateAsUpdate(document),
        compactedSequence: 1n,
        updatedAt: new Date(0),
      },
      updates: [],
    };
    document.destroy();

    expect(studioCrdtHydrationReferencesWorkAsset(state, "asset-1")).toBe(true);
    expect(studioCrdtHydrationReferencesWorkAsset(state, "asset-2")).toBe(false);
    expect(() => studioCrdtHydrationReferencesWorkAsset({
      snapshot: null,
      updates: [{
        workId: "work-1",
        sequence: 1n,
        updateId: "update-1",
        actorUserId: "editor-1",
        payload: Uint8Array.of(255),
        createdAt: new Date(0),
      }],
    }, "asset-1")).toThrow();
  });

  it("retains R8 grain uploads referenced only by deleted durable strokes", () => {
    const source = {
      kind: "r8-texture-v1",
      asset: {
        assetId: "paper-r8",
        encodedSha256: `sha256:${"a".repeat(64)}`,
        decodedSha256: `sha256:${"b".repeat(64)}`,
        byteLength: 128,
        mediaType: "image/png",
        width: 2,
        height: 2,
        channel: "luminance",
        encoding: "r8-unorm",
      },
    };
    const document = new Y.Doc();
    const stroke = new Y.Map<unknown>();
    stroke.set("deleted", true);
    stroke.set("brushDynamics", { grain: { source } });
    document.getMap<Y.Map<unknown>>("strokes").set("stroke-r8", stroke);
    const state = {
      snapshot: null,
      updates: [{
        workId: "work-r8",
        sequence: 1n,
        updateId: "update-r8",
        actorUserId: "editor",
        payload: Y.encodeStateAsUpdate(document),
        createdAt: new Date(0),
      }],
    };
    document.destroy();

    expect(studioCrdtHydrationReferencesWorkAsset(state, "paper-r8")).toBe(true);
    expect(studioCrdtHydrationReferencesWorkAsset(state, "unrelated")).toBe(false);
  });

  it("fails R8 cleanup closed for malformed or conflicting durable identities", () => {
    const source = (decodedHash: string) => ({
      kind: "r8-texture-v1",
      asset: {
        assetId: "paper-r8",
        encodedSha256: `sha256:${"a".repeat(64)}`,
        decodedSha256: `sha256:${decodedHash}`,
        byteLength: 128,
        mediaType: "image/png",
        width: 2,
        height: 2,
        channel: "luminance",
        encoding: "r8-unorm",
      },
    });
    const stateFor = (dynamics: readonly unknown[]) => {
      const document = new Y.Doc();
      const strokes = document.getMap<Y.Map<unknown>>("strokes");
      dynamics.forEach((brushDynamics, index) => {
        const stroke = new Y.Map<unknown>();
        stroke.set("brushDynamics", brushDynamics);
        strokes.set(`stroke-${index}`, stroke);
      });
      const state = {
        snapshot: {
          workId: "work-r8",
          snapshot: Y.encodeStateAsUpdate(document),
          compactedSequence: 1n,
          updatedAt: new Date(0),
        },
        updates: [],
      };
      document.destroy();
      return state;
    };

    const valid = source("b".repeat(64));
    const malformed = stateFor([{
      grain: {
        source: {
          ...valid,
          asset: { ...valid.asset, decodedSha256: "sha256:bad" },
        },
      },
    }]);
    expect(studioCrdtHydrationReferencesWorkAsset(malformed, "paper-r8")).toBe(true);
    expect(studioCrdtHydrationReferencesWorkAsset(malformed, "unrelated")).toBe(true);

    const conflicting = stateFor([
      { grain: { source: source("b".repeat(64)) } },
      { grain: { source: source("c".repeat(64)) } },
    ]);
    expect(studioCrdtHydrationReferencesWorkAsset(conflicting, "paper-r8")).toBe(true);
    expect(studioCrdtHydrationReferencesWorkAsset(conflicting, "unrelated")).toBe(true);

    const procedural = stateFor([
      { grain: { amount: 0.4, scale: 8 } },
      { width: { base: 12 } },
    ]);
    expect(studioCrdtHydrationReferencesWorkAsset(procedural, "unrelated")).toBe(false);
  });
});
