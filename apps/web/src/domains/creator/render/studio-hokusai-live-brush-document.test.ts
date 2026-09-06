import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
  snapshotStudioHokusaiLiveDocumentReceipt,
} from "./studio-hokusai-live-brush-document-receipt";
import {
  StudioHokusaiLiveOverlayRenderer,
  projectStudioHokusaiLiveFrame,
} from "./studio-hokusai-live-brush-overlay";
import {
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
} from "./studio-hokusai-live-brush-protocol";
import {
  createStudioHokusaiLiveCanonicalTransaction,
} from "./studio-hokusai-live-brush-transaction";
import { studioHokusaiSourceRevision } from "./studio-hokusai-natural-media-contract";

import type { DrawEl, El } from "../studio-element-model";
import type { StudioHokusaiLiveCanonicalResult } from "./studio-hokusai-live-brush-runtime";

const HASH = `sha256:${"a".repeat(64)}` as const;
const PNG_HASH = `sha256:${"b".repeat(64)}` as const;
const INPUT_HASH = `sha256:${"c".repeat(64)}` as const;

function source(): DrawEl {
  return {
    id: "stroke-hokusai-live",
    type: "draw",
    kind: "freehand",
    points: [12, 24, 13, 25],
    stroke: "#14213d",
    strokeWidth: 8,
    brush: "charcoal",
    pressures: [0.25, 0.75],
    name: "목탄선",
    groupId: "group-1",
    blendMode: "multiply",
  };
}

function canonicalResult(): StudioHokusaiLiveCanonicalResult {
  const logicalPlacement = { x: 12, y: 24, width: 1, height: 1 } as const;
  const pixels = new Uint8Array([20, 30, 40, 210]);
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
  ]).buffer;
  return {
    finalFrame: {
      sequence: 2,
      phase: "canonical",
      segmentIndex: 0,
      dirtyBounds: [0, 0, 1, 1],
      logicalPlacement,
      pixels,
      pixelHash: HASH,
    },
    pngBytes,
    receipt: {
      kind: "studio-hokusai-live/canonical-receipt",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: 1,
      engineEpoch: 1,
      strokeId: "stroke-hokusai-live",
      presetId: "charcoal",
      materialProfileId: "charcoal",
      seed: 7,
      sampleCount: 2,
      finalSequence: 2,
      segmentCount: 1,
      segments: [{
        segmentIndex: 0,
        logicalPlacement,
        pixelHash: HASH,
        pngHash: PNG_HASH,
      }],
      dirtyBounds: [0, 0, 1, 1],
      pixelLayout: "packed-dirty-rgba8",
      inputHash: INPUT_HASH,
      lastLivePixelHash: HASH,
      settledPixelHash: HASH,
      pngHash: PNG_HASH,
      exactLiveCommitParity: true,
      materialTexture: "studio-hokusai-material-texture-v2",
      endpointPolicy: "tapered-start-no-dab-carrier-v1",
      colorOpacityApplication: "worker-once-before-material-transfer-v1",
      execution: "dedicated-worker-wasm-packed-dirty-live",
      canonicalAuthority: "settled-png-receipt-v1",
      undoAuthority: "single-stroke-transaction-v1",
      saveAuthority: "canonical-png-plus-versioned-receipt-v1",
      complete: true,
    },
  };
}

describe("Studio Hokusai live document transaction", () => {
  it("commits hidden source and canonical PNG through one immutable undo payload", () => {
    const original = source();
    const elements: readonly El[] = [original];
    const result = createStudioHokusaiLiveCanonicalTransaction({
      elements,
      sourceElementId: original.id,
      expectedSourceRevision: studioHokusaiSourceRevision(original),
      canonicalImageId: "hokusai-png-1",
      result: canonicalResult(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction).toMatchObject({
      historyEntryCount: 1,
      hiddenSourceId: original.id,
      canonicalImageId: "hokusai-png-1",
      selectionId: "hokusai-png-1",
    });
    expect(elements).toEqual([original]);
    expect(result.transaction.nextElements).toHaveLength(2);
    expect(result.transaction.nextElements[0]).toMatchObject({
      id: original.id,
      type: "draw",
      hidden: true,
      groupId: "group-1",
    });
    expect(result.transaction.nextElements[1]).toMatchObject({
      id: "hokusai-png-1",
      type: "image",
      x: 12,
      y: 24,
      width: 1,
      height: 1,
      groupId: "group-1",
      blendMode: "multiply",
      hokusaiLiveReceipt: {
        kind: "studio-hokusai-live/document-receipt",
        sourceElementId: original.id,
        canonical: {
          settledPixelHash: HASH,
          pngHash: PNG_HASH,
        },
      },
    });
    expect((result.transaction.nextElements[1] as Extract<El, { type: "image" }>).src)
      .toMatch(/^data:image\/png;base64,/u);
  });

  it("persists and revalidates the authority receipt through a JSON document round-trip", () => {
    const original = source();
    const result = createStudioHokusaiLiveCanonicalTransaction({
      elements: [original],
      sourceElementId: original.id,
      expectedSourceRevision: studioHokusaiSourceRevision(original),
      canonicalImageId: "hokusai-png-1",
      result: canonicalResult(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = JSON.parse(JSON.stringify(
      result.transaction.nextElements,
    )) as El[];
    const image = restored[1];
    expect(image?.type).toBe("image");
    if (image?.type !== "image") return;
    const receipt = snapshotStudioHokusaiLiveDocumentReceipt(
      image.hokusaiLiveReceipt,
    );
    expect(receipt).toMatchObject({
      sourceElementId: original.id,
      canonical: {
        exactLiveCommitParity: true,
        materialProfileId: "charcoal",
        inputHash: INPUT_HASH,
        settledPixelHash: HASH,
        pngHash: PNG_HASH,
      },
    });
    expect(receipt?.sourceRevision).toMatch(/^hokusai-source-v1:[a-f0-9]{16}$/u);
  });

  it("restores legacy receipts to their carrier profile and rejects incompatible profiles", () => {
    const legacy = canonicalResult().receipt as unknown as Record<string, unknown>;
    const { materialProfileId: _legacyProfile, ...withoutProfile } = legacy;
    const base = {
      kind: "studio-hokusai-live/document-receipt",
      version: 1,
      liveAdapterVersion: "0.3.0-packed-dirty-live-adapter.2",
      sourceElementId: "stroke-hokusai-live",
      sourceRevision: "hokusai-source-v1:0123456789abcdef",
    } as const;
    expect(snapshotStudioHokusaiLiveDocumentReceipt({
      ...base,
      canonical: { ...withoutProfile, version: 1 },
    })?.canonical.materialProfileId).toBe("charcoal");
    expect(snapshotStudioHokusaiLiveDocumentReceipt({
      ...base,
      canonical: { ...legacy, version: 1, materialProfileId: "acrylic" },
    })).toBeNull();
    expect(snapshotStudioHokusaiLiveDocumentReceipt({
      ...base,
      version: STUDIO_HOKUSAI_LIVE_DOCUMENT_RECEIPT_VERSION,
      canonical: { ...legacy, version: 1 },
    })).toBeNull();
    expect(snapshotStudioHokusaiLiveDocumentReceipt({
      ...base,
      liveAdapterVersion: "0.3.0-packed-dirty-live-adapter.3-profile-routing",
      canonical: { ...legacy, version: 1 },
    })).toBeNull();
  });

  it("fails closed before mutation when the receipt or source identity changes", () => {
    const original = source();
    const bad = canonicalResult();
    const mismatched = {
      ...bad,
      receipt: { ...bad.receipt, strokeId: "different-source" },
    } as StudioHokusaiLiveCanonicalResult;
    expect(createStudioHokusaiLiveCanonicalTransaction({
      elements: [original],
      sourceElementId: original.id,
      expectedSourceRevision: studioHokusaiSourceRevision(original),
      canonicalImageId: "hokusai-png-1",
      result: mismatched,
    })).toMatchObject({
      ok: false,
      code: "canonical-result-invalid",
    });
  });

  it("rejects a canonical receipt that did not consume every source sample", () => {
    const original = source();
    const partial = canonicalResult();
    expect(createStudioHokusaiLiveCanonicalTransaction({
      elements: [original],
      sourceElementId: original.id,
      expectedSourceRevision: studioHokusaiSourceRevision(original),
      canonicalImageId: "hokusai-png-partial",
      result: {
        ...partial,
        receipt: { ...partial.receipt, sampleCount: 1 },
      },
    })).toMatchObject({
      ok: false,
      code: "canonical-result-invalid",
    });
  });

  it("rejects a result when the source changed after the finalized revision", () => {
    const original = source();
    const expectedSourceRevision = studioHokusaiSourceRevision(original);
    const changed: DrawEl = {
      ...original,
      points: [...original.points, 14, 28],
      pressures: [...(original.pressures ?? []), 0.5],
    };
    expect(createStudioHokusaiLiveCanonicalTransaction({
      elements: [changed],
      sourceElementId: original.id,
      expectedSourceRevision,
      canonicalImageId: "hokusai-png-1",
      result: canonicalResult(),
    })).toMatchObject({
      ok: false,
      code: "source-changed",
    });
  });
});

describe("Studio Hokusai packed dirty live overlay", () => {
  it("projects document pixels into the DPR-aware viewport", () => {
    expect(projectStudioHokusaiLiveFrame({
      logicalPlacement: { x: 120, y: 260, width: 30, height: 20 },
    }, {
      documentX: 100,
      documentY: 200,
      scaleX: 0.5,
      scaleY: 0.5,
      devicePixelRatio: 2,
    })).toEqual({ x: 20, y: 60, width: 30, height: 20 });
  });

  it("stages only the transferred dirty crop and clears the previous presentation", () => {
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const targetContext = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect,
      drawImage,
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    const targetCanvas = {
      width: 800,
      height: 600,
      getContext: vi.fn(() => targetContext),
    } as unknown as HTMLCanvasElement;
    const putImageData = vi.fn();
    const scratchSizes: Array<[number, number]> = [];
    const createScratchCanvas = (width: number, height: number) => {
      scratchSizes.push([width, height]);
      return {
        width,
        height,
        getContext: () => ({ putImageData }),
      } as unknown as HTMLCanvasElement;
    };
    let receivedPixels: Uint8ClampedArray | null = null;
    const renderer = new StudioHokusaiLiveOverlayRenderer(targetCanvas, {
      createScratchCanvas,
      createImageData: (pixels, width, height) => {
        receivedPixels = pixels;
        return { data: pixels, width, height } as ImageData;
      },
    });
    const pixels = new Uint8Array(2 * 3 * 4).fill(80);
    const frame = {
      sequence: 1,
      phase: "live" as const,
      segmentIndex: 0,
      dirtyBounds: [7, 9, 2, 3] as const,
      logicalPlacement: { x: 107, y: 209, width: 2, height: 3 },
      pixels,
      pixelHash: HASH,
    };
    const projection = {
      documentX: 100,
      documentY: 200,
      scaleX: 2,
      scaleY: 2,
      devicePixelRatio: 1,
    };
    expect(renderer.present(frame, projection)).toMatchObject({
      status: "presented",
      transferredBytes: 24,
      projectedRect: { x: 14, y: 18, width: 4, height: 6 },
    });
    expect(scratchSizes).toEqual([[2, 3]]);
    expect((receivedPixels as Uint8ClampedArray | null)?.buffer).toBe(pixels.buffer);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(renderer.present({ ...frame, sequence: 2 }, projection).status)
      .toBe("presented");
    expect(clearRect).toHaveBeenCalledTimes(2);
    renderer.dispose();
    expect(clearRect).toHaveBeenCalledTimes(3);
  });
});
