import { describe, expect, it, vi } from "vitest";

import {
  StudioFilterMaskSurfaceHydrator,
} from "./studio-filter-mask-surface-hydrator";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  type StudioRasterOperationLog,
} from "@/shared/lib/studio-crdt-raster-ops";

const SURFACE_ID = "filter-mask:v1:11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";

function log(
  overrides: Partial<StudioRasterOperationLog> = {}
): StudioRasterOperationLog {
  const surface = {
    version: STUDIO_RASTER_CRDT_VERSION,
    surfaceId: SURFACE_ID,
    width: 128,
    height: 128,
    tileSize: 1024,
  } as const;
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surface,
    operations: [{
      version: STUDIO_RASTER_CRDT_VERSION,
      operationId: OPERATION_ID,
      order: { actorId: "artist-a", logicalClock: "1" },
      pageId: "page-a",
      layerId: "page-root",
      intent: "paint",
      kernel: STUDIO_RASTER_KERNEL,
      semanticParametersSha256: "a".repeat(64),
      patches: [{
        tileX: 0,
        tileY: 0,
        region: { x: 0, y: 0, width: 128, height: 128 },
        effect: {
          kind: "composite",
          blendMode: "source-over",
          payload: {
            scope: "work",
            assetId: "b".repeat(64),
            sha256: "b".repeat(64),
            byteLength: 68,
            mediaType: "image/png",
            width: 128,
            height: 128,
          },
        },
      }],
    }],
    undoOperations: [],
    undoAcknowledgements: [],
    ...overrides,
  };
}

function replayResult() {
  const pixels = new Uint8ClampedArray(128 * 128 * 4);
  pixels[0] = 255;
  pixels[1] = 255;
  pixels[2] = 255;
  pixels[3] = 255;
  return {
    workId: "work-a",
    surface: log().surface,
    checkpointId: null,
    tiles: [{
      surfaceId: SURFACE_ID,
      tileX: 0,
      tileY: 0,
      width: 128,
      height: 128,
      byteLength: pixels.byteLength,
      sha256: "c".repeat(64),
      get rgba() {
        return Uint8ClampedArray.from(pixels);
      },
      copyRgba: () => Uint8ClampedArray.from(pixels),
    }],
    appliedOperationIds: [OPERATION_ID],
    undoneOperationIds: [],
    conflictedOperationIds: [],
    appliedPatchCount: 1,
  } as const;
}

describe("StudioFilterMaskSurfaceHydrator", () => {
  it("publishes a Blob URL only after exact log replay and PNG materialization", async () => {
    const replay = vi.fn(async () => replayResult());
    const createObjectUrl = vi.fn(() => "blob:mask-ready");
    const revokeObjectUrl = vi.fn();
    const materializePng = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const document = {
      getRasterOperationLogAsync: vi.fn(async () => log()),
    };
    const hydrator = new StudioFilterMaskSurfaceHydrator({
      replay,
      materializePng,
      createObjectUrl,
      revokeObjectUrl,
    });

    hydrator.setScope("work-a", document);
    hydrator.observe([SURFACE_ID], { prioritySurfaceIds: [SURFACE_ID] });
    await vi.waitFor(() => expect(hydrator.get(SURFACE_ID)?.status).toBe("ready"));

    expect(document.getRasterOperationLogAsync).toHaveBeenCalledWith(
      SURFACE_ID,
      { signal: expect.any(AbortSignal) }
    );
    expect(replay).toHaveBeenCalledOnce();
    expect(materializePng).toHaveBeenCalledOnce();
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(hydrator.resourceUrl(SURFACE_ID)).toBe("blob:mask-ready");

    hydrator.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:mask-ready");
  });

  it("never exposes a URL for a missing or non-Magic operation log", async () => {
    const createObjectUrl = vi.fn(() => "blob:must-not-exist");
    const hydrator = new StudioFilterMaskSurfaceHydrator({
      replay: vi.fn(async () => replayResult()),
      materializePng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
      createObjectUrl,
    });
    hydrator.setScope("work-a", {
      getRasterOperationLogAsync: vi.fn(async () => log({
        operations: [],
      })),
    });
    hydrator.observe([SURFACE_ID]);

    await vi.waitFor(() => expect(hydrator.get(SURFACE_ID)?.status).toBe("error"));
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(hydrator.resourceUrl(SURFACE_ID)).toBeNull();
  });

  it("drops a late result after work/document scope rotation", async () => {
    let resolveLog: (value: StudioRasterOperationLog) => void = () => undefined;
    const firstDocument = {
      getRasterOperationLogAsync: vi.fn(() => new Promise<StudioRasterOperationLog>((resolve) => {
        resolveLog = resolve;
      })),
    };
    const createObjectUrl = vi.fn(() => "blob:stale");
    const hydrator = new StudioFilterMaskSurfaceHydrator({
      replay: vi.fn(async () => replayResult()),
      materializePng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
      createObjectUrl,
    });
    hydrator.setScope("work-a", firstDocument);
    hydrator.observe([SURFACE_ID]);
    hydrator.setScope("work-b", {
      getRasterOperationLogAsync: vi.fn(async () => null),
    });
    resolveLog(log());
    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(hydrator.get(SURFACE_ID)).toBeNull();
    hydrator.dispose();
  });

  it("revokes a ready resource when the authored reference leaves the frontier", async () => {
    const revokeObjectUrl = vi.fn();
    const hydrator = new StudioFilterMaskSurfaceHydrator({
      replay: vi.fn(async () => replayResult()),
      materializePng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
      createObjectUrl: () => "blob:evict-me",
      revokeObjectUrl,
    });
    hydrator.setScope("work-a", {
      getRasterOperationLogAsync: vi.fn(async () => log()),
    });
    hydrator.observe([SURFACE_ID]);
    await vi.waitFor(() => expect(hydrator.get(SURFACE_ID)?.status).toBe("ready"));

    hydrator.observe([]);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:evict-me");
    expect(hydrator.get(SURFACE_ID)).toBeNull();
    hydrator.dispose();
  });

  it("aborts a pending hydration when an inline edit invalidates the authored reference", async () => {
    let resolveLog: (value: StudioRasterOperationLog) => void = () => undefined;
    const getRasterOperationLogAsync = vi.fn(() => (
      new Promise<StudioRasterOperationLog>((resolve) => {
        resolveLog = resolve;
      })
    ));
    const replay = vi.fn(async () => replayResult());
    const createObjectUrl = vi.fn(() => "blob:stale-inline-edit");
    const revokeObjectUrl = vi.fn();
    const hydrator = new StudioFilterMaskSurfaceHydrator({
      replay,
      materializePng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
      createObjectUrl,
      revokeObjectUrl,
    });
    hydrator.setScope("work-a", { getRasterOperationLogAsync });
    hydrator.observe([SURFACE_ID]);
    expect(hydrator.get(SURFACE_ID)?.status).toBe("loading");

    hydrator.observe([]);
    resolveLog(log());
    await Promise.resolve();
    await Promise.resolve();

    expect(hydrator.get(SURFACE_ID)).toBeNull();
    expect(replay).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    hydrator.dispose();
  });
});
