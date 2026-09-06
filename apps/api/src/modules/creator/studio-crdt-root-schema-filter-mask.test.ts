import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  canonicalStudioRasterJson,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import {
  createStudioFilterMaskSurfaceId,
  createStudioFilterMaskSurfaceSpec,
} from "../../../../web/src/shared/lib/studio-filter-mask-surface-contract";

import {
  hasValidStudioCrdtRootSchema,
  snapshotStudioWorkAssetReferences,
} from "./studio-crdt-root-schema";

const MASK_ID = createStudioFilterMaskSurfaceId(
  "10000000-0000-4000-8000-000000000001"
);
const OTHER_MASK_ID = createStudioFilterMaskSurfaceId(
  "10000000-0000-4000-8000-000000000002"
);

function addMaskSurface(
  doc: Y.Doc,
  surfaceId = MASK_ID,
  overrides: Partial<{
    version: number;
    width: number;
    height: number;
    tileSize: number;
  }> = {}
): void {
  const surface = {
    ...createStudioFilterMaskSurfaceSpec({
      surfaceId,
      width: 300,
      height: 400,
    }),
    ...overrides,
  };
  doc.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT).set(
    surfaceId,
    canonicalStudioRasterJson(surface)
  );
}

function addImageReference(
  doc: Y.Doc,
  options: {
    admitted?: boolean;
    elementType?: string;
    surfaceId?: unknown;
    enabled?: unknown;
    hidden?: unknown;
  } = {}
): Y.Map<unknown> {
  const id = "image-1";
  doc.getMap<boolean>("scene-elements").set(id, true);
  const record = doc.getMap<unknown>(`scene-element:${encodeURIComponent(id)}`);
  record.set("id", id);
  record.set("pageId", "page-1");
  record.set("layerId", "page-root");
  record.set("payloadVersion", 1);
  record.set("type", "reference");
  record.set("deleted", false);
  record.set("prop:elementType", options.elementType ?? "image");
  if (options.admitted) {
    record.set("prop:x", 10);
    record.set("prop:y", 20);
    record.set("prop:width", 300);
    record.set("prop:height", 400);
    record.set("prop:rotation", 0);
  }
  if (options.surfaceId !== undefined) {
    record.set("prop:filterMaskSurfaceId", options.surfaceId);
  }
  if (options.enabled !== undefined) {
    record.set("prop:filterMaskEnabled", options.enabled);
  }
  if (options.hidden !== undefined) {
    record.set("prop:hidden", options.hidden);
  }
  return record;
}

describe("Studio CRDT filter-mask surface boundary", () => {
  it("accepts the hidden-only image topology reference emitted for Shared Stage visibility", () => {
    const doc = new Y.Doc();
    addImageReference(doc, { hidden: false });

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    const snapshot = snapshotStudioWorkAssetReferences(doc);
    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.admittedReferences.size).toBe(0);

    const malformed = new Y.Doc();
    addImageReference(malformed, { hidden: "false" });
    expect(hasValidStudioCrdtRootSchema(malformed)).toBe(false);
    doc.destroy();
    malformed.destroy();
  });

  it("accepts a topology-only image binding without admitting its local source body", () => {
    const doc = new Y.Doc();
    addMaskSurface(doc);
    addImageReference(doc, { surfaceId: MASK_ID, enabled: true });

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    expect(snapshotStudioWorkAssetReferences(doc)).toMatchObject({
      activeCount: 0,
    });
    expect(snapshotStudioWorkAssetReferences(doc).admittedReferences.size).toBe(0);
    doc.destroy();
  });

  it("accepts the same binding on an admitted image reference", () => {
    const doc = new Y.Doc();
    addMaskSurface(doc);
    addImageReference(doc, {
      admitted: true,
      surfaceId: MASK_ID,
      enabled: false,
    });

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    const snapshot = snapshotStudioWorkAssetReferences(doc);
    expect(snapshot.activeCount).toBe(1);
    expect([...snapshot.admittedReferences.values()]).toEqual([{
      assetId: "image-1",
      elementType: "image",
    }]);
    doc.destroy();
  });

  it("rejects dangling, non-Magic, malformed, inline, and non-image references", () => {
    const dangling = new Y.Doc();
    addImageReference(dangling, { surfaceId: MASK_ID });
    expect(hasValidStudioCrdtRootSchema(dangling)).toBe(false);

    const wrongSurfaceContract = new Y.Doc();
    addMaskSurface(wrongSurfaceContract, MASK_ID, { tileSize: 512 });
    addImageReference(wrongSurfaceContract, { surfaceId: MASK_ID });
    expect(hasValidStudioCrdtRootSchema(wrongSurfaceContract)).toBe(false);

    const malformed = new Y.Doc();
    addMaskSurface(malformed);
    addImageReference(malformed, { surfaceId: "data:image/png;base64,AA==" });
    expect(hasValidStudioCrdtRootSchema(malformed)).toBe(false);

    const enabledWithoutSurface = new Y.Doc();
    addImageReference(enabledWithoutSurface, { enabled: true });
    expect(hasValidStudioCrdtRootSchema(enabledWithoutSurface)).toBe(false);

    const nonImage = new Y.Doc();
    addMaskSurface(nonImage);
    addImageReference(nonImage, { elementType: "vrm", surfaceId: MASK_ID });
    expect(hasValidStudioCrdtRootSchema(nonImage)).toBe(false);

    const inline = new Y.Doc();
    addMaskSurface(inline);
    const inlineRecord = addImageReference(inline, { surfaceId: MASK_ID });
    inlineRecord.set("prop:filterMaskSrc", "data:image/png;base64,AA==");
    expect(hasValidStudioCrdtRootSchema(inline)).toBe(false);

    for (const doc of [
      dangling,
      wrongSurfaceContract,
      malformed,
      enabledWithoutSurface,
      nonImage,
      inline,
    ]) {
      doc.destroy();
    }
  });

  it("validates hidden base and winning prop surface candidates independently", () => {
    const doc = new Y.Doc();
    addMaskSurface(doc);
    const record = addImageReference(doc, { surfaceId: MASK_ID });
    record.set("base:filterMaskSurfaceId", OTHER_MASK_ID);

    expect(hasValidStudioCrdtRootSchema(doc)).toBe(false);

    addMaskSurface(doc, OTHER_MASK_ID);
    expect(hasValidStudioCrdtRootSchema(doc)).toBe(true);
    doc.destroy();
  });
});
