import { describe, expect, it } from "vitest";

import {
  areStudioWorkAssetSceneReferencesEqual,
  collectStudioWorkAssetSceneReferences,
  projectStudioWorkAssetPageForReadOnlyPreview,
  projectStudioWorkAssetPageForRender,
  resolveStudioWorkAssetReadableImageSource,
  resolveStudioWorkAssetHydrationScope,
} from "./studio-work-asset-render-projection";

import type { StudioWorkAssetHydrationState } from "./studio-work-asset-hydrator";

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "asset-1",
  pageId: "page-1",
  orderIndex: 2,
  deleted: false,
  payload: {
    type: "reference",
    props: {
      elementType: "image",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 0,
    },
  },
  ...overrides,
});

const ready: StudioWorkAssetHydrationState = {
  status: "ready",
  reference: { assetId: "asset-1", elementType: "image" },
  manifest: {
    version: 1,
    assetId: "asset-1",
    elementType: "image",
    mimeType: "image/png",
    byteSize: 100,
    sha256: "a".repeat(64),
    intrinsicImage: { width: 300, height: 400, decodedRgbaBytes: 480_000 },
    descriptor: {
      version: 1,
      element: {
        id: "asset-1",
        type: "image",
        x: 10,
        y: 20,
        width: 300,
        height: 400,
        rotation: 0,
      },
    },
    updatedAt: "2026-07-16T00:00:00.000Z",
  },
  source: {
    id: "asset-1",
    type: "image",
    src: "work-asset://image/asset-1",
    x: 10,
    y: 20,
    width: 300,
    height: 400,
    rotation: 0,
  },
  resourceUrl: "blob:render-only",
};

describe("studio work asset render projection", () => {
  it("keeps hydration scoped to an authenticated active document viewer", () => {
    const base = {
      workId: "work-1",
      authUserId: "user-1",
      remixId: null,
      documentStatus: "active",
      canView: true,
    };
    expect(resolveStudioWorkAssetHydrationScope(base)).toBe("work-1");
    expect(resolveStudioWorkAssetHydrationScope({ ...base, canView: false })).toBeNull();
    expect(resolveStudioWorkAssetHydrationScope({ ...base, documentStatus: null })).toBeNull();
    expect(resolveStudioWorkAssetHydrationScope({ ...base, authUserId: null })).toBeNull();
    expect(resolveStudioWorkAssetHydrationScope({ ...base, remixId: "remix-1" })).toBeNull();
  });

  it("collects only active supported reference records in deterministic order", () => {
    const references = collectStudioWorkAssetSceneReferences([
      record({ id: "deleted", deleted: true }),
      record({ id: "text", payload: { type: "text", props: {} } }),
      record({ id: "future", payload: { type: "reference", props: { elementType: "future" } } }),
      record({ id: "legacy", payload: { type: "reference", props: { elementType: "image" } } }),
      record(),
    ]);
    expect(references).toEqual([{
      pageId: "page-1",
      orderIndex: 2,
      reference: { assetId: "asset-1", elementType: "image" },
    }]);
    expect(areStudioWorkAssetSceneReferencesEqual(references, structuredClone(references)))
      .toBe(true);
  });

  it("leaves a topology-only legacy reference and its real local source untouched", () => {
    const persistent = [{
      id: "asset-1",
      type: "image",
      src: "data:image/png;base64,legacy-local-body",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 0,
    }];
    const references = collectStudioWorkAssetSceneReferences([
      record({ payload: { type: "reference", props: { elementType: "image" } } }),
    ]);
    let hydrationReads = 0;
    const projected = projectStudioWorkAssetPageForRender({
      pageId: "page-1",
      elements: persistent,
      references,
      hydrationRevision: 1,
      resolveState: () => {
        hydrationReads += 1;
        return null;
      },
    });

    expect(references).toEqual([]);
    expect(hydrationReads).toBe(0);
    expect(projected.elements).toEqual(persistent);
    expect(projected.elements[0]).toBe(persistent[0]);
    expect(projected.placeholders).toEqual([]);
    expect(projected.elements[0]?.src).toContain("legacy-local-body");
  });

  it("uses a Blob URL only in the returned render element and preserves the stable source", () => {
    const persistent = [{
      id: "asset-1",
      type: "image",
      src: "work-asset://image/asset-1",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 0,
    }];
    const references = collectStudioWorkAssetSceneReferences([record()]);
    const projected = projectStudioWorkAssetPageForRender({
      pageId: "page-1",
      elements: persistent,
      references,
      hydrationRevision: 2,
      resolveState: () => ready,
    });

    expect(projected.elements[0]?.src).toBe("blob:render-only");
    expect(persistent[0]!.src).toBe("work-asset://image/asset-1");
    expect(projected.placeholders).toEqual([]);
  });

  it("renders inert loading/error placeholders without persisting their state", () => {
    const persistent = [{
      id: "asset-1",
      type: "image",
      src: "work-asset://image/asset-1",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      rotation: 0,
    }];
    const references = collectStudioWorkAssetSceneReferences([record()]);
    const error: StudioWorkAssetHydrationState = {
      status: "error",
      reference: { assetId: "asset-1", elementType: "image" },
      placeholder: { assetId: "asset-1", elementType: "image", label: "오류" },
      code: "missing",
      message: "원본 없음",
    };
    const projected = projectStudioWorkAssetPageForRender({
      pageId: "page-1",
      elements: persistent,
      references,
      hydrationRevision: 3,
      resolveState: () => error,
    });

    expect(projected.elements).toEqual([]);
    expect(projected.placeholders[0]).toMatchObject({
      assetId: "asset-1",
      status: "error",
      x: 10,
      y: 20,
      message: "원본 없음",
    });
    expect(JSON.stringify(persistent)).not.toContain("원본 없음");
  });

  it("hides a stale local data URL until the authoritative server asset is ready", () => {
    const persistent = [{
      id: "asset-1",
      type: "image",
      src: "data:image/png;base64,stale-local-body",
      x: 1,
      y: 2,
      width: 100,
      height: 100,
      rotation: 0,
    }];
    const references = collectStudioWorkAssetSceneReferences([record()]);
    const projected = projectStudioWorkAssetPageForRender({
      pageId: "page-1",
      elements: persistent,
      references,
      hydrationRevision: 1,
      resolveState: () => ({
        status: "loading",
        reference: { assetId: "asset-1", elementType: "image" },
        placeholder: { assetId: "asset-1", elementType: "image", label: "불러오는 중" },
      }),
    });
    expect(projected.elements).toEqual([]);
    expect(projected.placeholders[0]).toMatchObject({ status: "loading", x: 1, y: 2 });
    expect(JSON.stringify(projected)).not.toContain("stale-local-body");
    expect(persistent[0]!.src).toContain("stale-local-body");
  });

  it("materializes a ready remote image for the current render before history catches up", () => {
    const references = collectStudioWorkAssetSceneReferences([record()]);
    const projected = projectStudioWorkAssetPageForRender({
      pageId: "page-1",
      elements: [],
      references,
      hydrationRevision: 4,
      resolveState: () => ready,
    });
    expect(projected.elements[0]).toMatchObject({
      id: "asset-1",
      type: "image",
      src: "blob:render-only",
    });
    expect(projected.placeholders).toEqual([]);
  });

  it("projects Blob URLs into read-only previews without mutating authored CRDT sources", () => {
    const authored = {
      id: "page-1",
      elements: [{
        id: "asset-1",
        type: "image",
        src: "work-asset://image/asset-1",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }],
    };
    expect(resolveStudioWorkAssetReadableImageSource(authored.elements[0]!, () => ready))
      .toBe("blob:render-only");
    const preview = projectStudioWorkAssetPageForReadOnlyPreview({
      page: authored,
      hydrationRevision: 5,
      resolveState: () => ready,
    });
    expect(preview).not.toBe(authored);
    expect(preview.elements[0]?.src).toBe("blob:render-only");
    expect(authored.elements[0]!.src).toBe("work-asset://image/asset-1");

    const unresolved = projectStudioWorkAssetPageForReadOnlyPreview({
      page: authored,
      hydrationRevision: 6,
      resolveState: () => ({
        status: "loading",
        reference: ready.reference,
        placeholder: { ...ready.reference, label: "불러오는 중" },
      }),
    });
    expect(unresolved).toBe(authored);
    expect(unresolved.elements[0]?.src).toBe("work-asset://image/asset-1");
  });
});
