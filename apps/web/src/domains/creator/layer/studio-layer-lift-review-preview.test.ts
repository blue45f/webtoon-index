import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { composeStudioLayerLiftBeta } from "./studio-layer-lift-compositor";
import {
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  parseStudioSceneLayerLiftRequest,
} from "./studio-layer-lift-contract";
import {
  createStudioLayerLiftLocalForegroundProvider,
} from "./studio-layer-lift-local-provider";
import { StudioLayerLiftOperationRegistry } from "./studio-layer-lift-operation-context";
import {
  createStudioLayerLiftReviewPreviewResource,
  StudioLayerLiftReviewPreviewError,
  type StudioLayerLiftReviewPreviewEncodeInput,
  type StudioLayerLiftReviewPreviewRuntime,
} from "./studio-layer-lift-review-preview";

import type { StudioLayerLiftWorkflowSession } from "./studio-layer-lift-workflow";

const PNG_4X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";

const SOURCE_RGBA = Uint8Array.from([
  10, 20, 30, 255,
  40, 50, 60, 255,
  70, 80, 90, 255,
  100, 110, 120, 255,
]);

function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(PNG_4X1_BASE64),
    (character) => character.charCodeAt(0),
  );
}

async function workflowSession(): Promise<StudioLayerLiftWorkflowSession> {
  const sourceBytes = new Uint8Array(SOURCE_RGBA);
  const parsedRequest = parseStudioSceneLayerLiftRequest({
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: "request-review-1",
    source: {
      sourceId: "source-1",
      sourceName: "filtered-source.png",
      mimeType: "image/png",
      width: 4,
      height: 1,
      pixelCount: 4,
      pixelFormat: "rgba8-srgb-straight",
      channels: 4,
      byteLength: sourceBytes.byteLength,
      sha256: `sha256:${sha256HexPortable(sourceBytes)}`,
      bytes: sourceBytes,
    },
    requestedRoles: ["background", "character"],
  });
  if (!parsedRequest.ok) throw new Error(parsedRequest.detail);

  const provider = createStudioLayerLiftLocalForegroundProvider({
    loadInference: async () => ({
      model: {
        providerId: "fixture-segmenter",
        providerVersion: "1.0.0",
        modelId: "fixture-character",
        modelVersion: "1",
        executionRoute: "fixture-cpu",
      },
      infer: async () => ({
        width: 4,
        height: 1,
        confidence: Float32Array.from([0, 1, 1, 0]),
      }),
    }),
    now: () => 1,
  });
  const providerResult = await provider.analyze(parsedRequest.value);
  const foreground = providerResult.layers.find(
    (layer) => layer.role === "character",
  );
  if (!foreground) throw new Error("fixture foreground is missing");

  const composition = await composeStudioLayerLiftBeta({
    requestId: parsedRequest.value.requestId,
    sourceId: parsedRequest.value.source.sourceId,
    width: parsedRequest.value.source.width,
    height: parsedRequest.value.source.height,
    sourceSha256: parsedRequest.value.source.sha256,
    sourceRgba: parsedRequest.value.source.bytes,
    providerReceiptSha256: providerResult.receipt.receiptSha256,
    providerLayers: providerResult.layers.map((layer) => ({
      layerId: layer.layerId,
      role: layer.role,
      order: layer.order,
      rgbaSha256: layer.rgba.sha256,
      maskSha256: layer.mask.sha256,
    })),
    foregroundLayerId: foreground.layerId,
    foregroundMaskSha256: foreground.mask.sha256,
    foregroundMask: foreground.mask.bytes,
    backgroundOutputId: "background-1",
    foregroundOutputId: "foreground-1",
  }, {
    encodePng: async () => pngBytes(),
    decodePngDimensions: async () => ({ width: 4, height: 1 }),
  });

  const ticket = new StudioLayerLiftOperationRegistry().begin({
    mutationTicket: {
      authScopeKey: "user-1",
      workId: null,
      accessGeneration: 1,
      documentGeneration: 1,
    },
    pageId: "page-1",
    masterEditMode: false,
    selectedIds: ["source-1"],
    source: {
      requestId: parsedRequest.value.requestId,
      sourceId: parsedRequest.value.source.sourceId,
      sourceFingerprint: "studio-layer-lift-source-v1:0000000000000000",
      sourceSha256: parsedRequest.value.source.sha256,
      width: 4,
      height: 1,
      backgroundOutputId: "background-1",
      foregroundOutputId: "foreground-1",
    },
  });

  return Object.freeze({
    ticket,
    request: parsedRequest.value,
    providerResult,
    artifacts: composition.artifacts,
    compositionReceipt: composition.compositionReceipt,
    sourceSnapshot: Object.freeze({
      ok: true,
      source: parsedRequest.value.source,
      sourceFingerprint: ticket.source.sourceFingerprint,
      placement: Object.freeze({
        x: 0,
        y: 0,
        width: 4,
        height: 1,
        rotation: 0,
        flipped: false,
        flippedY: false,
        skewX: 0,
        skewY: 0,
      }),
      filterExecution: "worker",
    }),
    preview: Object.freeze({
      width: 4,
      height: 1,
      sourceRgba: new Uint8ClampedArray(parsedRequest.value.source.bytes),
      backgroundRgba: new Uint8ClampedArray(
        composition.backgroundRgba.bytes,
      ),
      foregroundRgba: new Uint8ClampedArray(
        composition.foregroundRgba.bytes,
      ),
      maskAlpha: new Uint8Array(composition.removalMask.bytes),
      confidenceScore: providerResult.confidence.score,
      confidenceBand: providerResult.confidence.band,
      backgroundRepair: Object.freeze({
        mode: "bounded-tile-fill-beta",
        selectedPixelCount: composition.diagnostics.selectedPixelCount,
        partialPixelCount: composition.diagnostics.partialPixelCount,
        transparentSelectedPixelCount:
          composition.diagnostics.transparentSelectedPixelCount,
      }),
      diagnostics: providerResult.diagnostics,
    }),
  });
}

function runtime(
  overrides: Partial<StudioLayerLiftReviewPreviewRuntime> = {},
): Readonly<{
  readonly value: StudioLayerLiftReviewPreviewRuntime;
  readonly encoded: StudioLayerLiftReviewPreviewEncodeInput[];
  readonly blobs: Blob[];
  readonly revoked: string[];
}> {
  const encoded: StudioLayerLiftReviewPreviewEncodeInput[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const value: StudioLayerLiftReviewPreviewRuntime = {
    encodeRgbaPng: async (input) => {
      encoded.push({
        ...input,
        bytes: new Uint8ClampedArray(input.bytes),
      });
      return new Blob([pngBytes().buffer], { type: "image/png" });
    },
    createObjectURL: (blob) => {
      blobs.push(blob);
      return `blob:layer-lift-${blobs.length}`;
    },
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    ...overrides,
  };
  return { value, encoded, blobs, revoked };
}

describe("Studio Layer Lift review preview resources", () => {
  it("uses exact source RGBA, verified artifact PNGs, and a visible mask", async () => {
    const session = await workflowSession();
    const harness = runtime();

    const resource = await createStudioLayerLiftReviewPreviewResource(
      session,
      { runtime: harness.value },
    );

    expect(resource.preview).toMatchObject({
      width: 4,
      height: 1,
      sourceSrc: "blob:layer-lift-1",
      compositeSrc: "blob:layer-lift-1",
      backgroundSrc: "blob:layer-lift-2",
      foregroundSrc: "blob:layer-lift-3",
      maskSrc: "blob:layer-lift-4",
      confidenceBand: "high",
      backgroundRepairQuality: "review",
    });
    expect([...harness.encoded[0]!.bytes]).toEqual([...SOURCE_RGBA]);
    expect([...harness.encoded[1]!.bytes]).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    expect(harness.blobs[1]!.type).toBe("image/png");
    expect(new Uint8Array(await harness.blobs[1]!.arrayBuffer()))
      .toEqual(pngBytes());
    expect(new Uint8Array(await harness.blobs[2]!.arrayBuffer()))
      .toEqual(pngBytes());
    expect(resource.preview.maskAlpha).not.toBe(session.preview.maskAlpha);
    expect(resource.preview.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "background-repair-review",
        tone: "warning",
      }),
      expect.objectContaining({ id: "composite-source-parity", tone: "info" }),
    ]));

    resource.revoke();
    resource.revoke();
    expect(harness.revoked).toEqual([
      "blob:layer-lift-1",
      "blob:layer-lift-2",
      "blob:layer-lift-3",
      "blob:layer-lift-4",
    ]);
  });

  it("revokes every previously created URL when a later encode fails", async () => {
    const session = await workflowSession();
    let encodeCount = 0;
    const harness = runtime({
      encodeRgbaPng: async () => {
        encodeCount += 1;
        if (encodeCount === 2) throw new Error("mask encoder failed");
        return new Blob([pngBytes().buffer], { type: "image/png" });
      },
    });

    await expect(createStudioLayerLiftReviewPreviewResource(session, {
      runtime: harness.value,
    })).rejects.toMatchObject({
      code: "encode-failed",
    });
    expect(harness.revoked).toEqual([
      "blob:layer-lift-1",
      "blob:layer-lift-2",
      "blob:layer-lift-3",
    ]);
  });

  it("cleans a source URL if the operation aborts immediately after creation", async () => {
    const session = await workflowSession();
    const controller = new AbortController();
    const harness = runtime({
      createObjectURL: (blob) => {
        harness.blobs.push(blob);
        controller.abort();
        return "blob:layer-lift-aborted";
      },
    });

    await expect(createStudioLayerLiftReviewPreviewResource(session, {
      signal: controller.signal,
      runtime: harness.value,
    })).rejects.toBeInstanceOf(StudioLayerLiftReviewPreviewError);
    expect(harness.revoked).toEqual(["blob:layer-lift-aborted"]);
  });

  it("rejects untrusted or malformed sessions before allocating resources", async () => {
    const session = await workflowSession();
    const harness = runtime();
    const untrusted = {
      ...session,
      artifacts: {
        ...session.artifacts,
      },
    } as unknown as StudioLayerLiftWorkflowSession;

    await expect(createStudioLayerLiftReviewPreviewResource(untrusted, {
      runtime: harness.value,
    })).rejects.toMatchObject({
      code: "invalid-session",
    });
    expect(harness.encoded).toHaveLength(0);
    expect(harness.blobs).toHaveLength(0);
  });

  it("rejects a pre-aborted request without reading or encoding the session", async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = runtime({
      encodeRgbaPng: vi.fn(),
    });

    await expect(createStudioLayerLiftReviewPreviewResource(
      {} as StudioLayerLiftWorkflowSession,
      {
        signal: controller.signal,
        runtime: harness.value,
      },
    )).rejects.toMatchObject({
      code: "aborted",
    });
    expect(harness.value.encodeRgbaPng).not.toHaveBeenCalled();
  });
});
