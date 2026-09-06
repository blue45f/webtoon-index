import { Image, encodePng } from "image-js";
import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { isStudioLayerLiftTrustedArtifactPair } from "./studio-layer-lift-artifact";
import { isTrustedStudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";
import {
  StudioLayerLiftCompositorError,
  admitStudioLayerLiftCompositorInput,
  composeStudioLayerLiftBeta,
  isStudioLayerLiftTrustedComposition,
} from "./studio-layer-lift-compositor";

import type {
  StudioLayerLiftCompositorInput,
  StudioLayerLiftCompositorPngEncoder,
} from "./studio-layer-lift-compositor";

function hash(bytes: Uint8Array | Uint8ClampedArray): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ))}`;
}

function digest(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function input(
  sourceRgba = Uint8ClampedArray.from([
    10, 20, 30, 255,
    200, 10, 20, 128,
    50, 60, 70, 255,
    90, 100, 110, 255,
  ]),
  foregroundMask = Uint8Array.from([0, 255, 128, 0]),
): StudioLayerLiftCompositorInput {
  return {
    requestId: "layer-lift-request",
    sourceId: "source-cut",
    width: 4,
    height: 1,
    sourceSha256: hash(sourceRgba),
    sourceRgba,
    providerReceiptSha256: digest("a"),
    providerLayers: [
      {
        layerId: "provider-background",
        role: "background",
        order: 0,
        rgbaSha256: digest("b"),
        maskSha256: digest("c"),
      },
      {
        layerId: "provider-character",
        role: "character",
        order: 1,
        rgbaSha256: digest("d"),
        maskSha256: hash(foregroundMask),
      },
    ],
    foregroundLayerId: "provider-character",
    foregroundMaskSha256: hash(foregroundMask),
    foregroundMask,
    backgroundOutputId: "layer-lift-background",
    foregroundOutputId: "layer-lift-foreground",
    fillTilePixels: 8,
  };
}

const encodePlane: StudioLayerLiftCompositorPngEncoder = async (plane) => {
  const png = encodePng(new Image(plane.width, plane.height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: new Uint8Array(
      plane.bytes.buffer,
      plane.bytes.byteOffset,
      plane.bytes.byteLength,
    ),
  }));
  return png.slice().buffer as ArrayBuffer;
};

const decodeDimensions = async (
  _bytes: Uint8Array<ArrayBuffer>,
): Promise<{ width: number; height: number }> => ({ width: 4, height: 1 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Studio Scene Layer Lift compositor", () => {
  it("owns source/mask snapshots and produces one trusted two-layer authority", async () => {
    const raw = input();
    const rawSourceBefore = new Uint8ClampedArray(raw.sourceRgba);
    const rawMaskBefore = new Uint8Array(raw.foregroundMask);
    const result = await composeStudioLayerLiftBeta(raw, {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    });

    expect(isStudioLayerLiftTrustedComposition(result)).toBe(true);
    expect(isStudioLayerLiftTrustedArtifactPair(result.artifacts)).toBe(true);
    expect(
      isTrustedStudioLayerLiftCompositionReceipt(result.compositionReceipt),
    ).toBe(true);
    expect(result.foregroundRgba.bytes).toEqual(Uint8ClampedArray.from([
      0, 0, 0, 0,
      200, 10, 20, 128,
      50, 60, 70, 128,
      0, 0, 0, 0,
    ]));
    expect(result.removalMask.bytes).toEqual(rawMaskBefore);
    expect(result.backgroundRgba.bytes).not.toBe(raw.sourceRgba);
    expect(result.backgroundRgba.bytes).not.toEqual(result.foregroundRgba.bytes);
    expect(result.artifacts.receipt).toMatchObject({
      requestId: raw.requestId,
      sourceId: raw.sourceId,
      background: { outputId: raw.backgroundOutputId },
      foreground: { outputId: raw.foregroundOutputId },
    });
    expect(result.compositionReceipt).toMatchObject({
      sourceSha256: raw.sourceSha256,
      providerReceiptSha256: raw.providerReceiptSha256,
      background: {
        contributorLayerIds: ["provider-background"],
        artifactSha256: result.artifacts.background.sha256,
      },
      foreground: {
        contributorLayerIds: ["provider-character"],
        artifactSha256: result.artifacts.foreground.sha256,
      },
    });
    expect(result.diagnostics).toMatchObject({
      pixelCount: 4,
      selectedPixelCount: 2,
      partialPixelCount: 1,
      foregroundMaskSha256: raw.foregroundMaskSha256,
      foregroundRgbaSha256: result.foregroundRgba.sha256,
      backgroundRgbaSha256: result.backgroundRgba.sha256,
    });
    expect(raw.sourceRgba).toEqual(rawSourceBefore);
    expect(raw.foregroundMask).toEqual(rawMaskBefore);
  });

  it("snapshots before the first await and rejects late caller mutation authority", async () => {
    const gate = deferred<ArrayBuffer | Uint8Array<ArrayBuffer>>();
    let calls = 0;
    const encoder: StudioLayerLiftCompositorPngEncoder = async (plane) => {
      calls += 1;
      if (calls === 1) return gate.promise;
      return encodePlane(plane, undefined);
    };
    const raw = input();
    const pending = composeStudioLayerLiftBeta(raw, {
      encodePng: encoder,
      decodePngDimensions: decodeDimensions,
    });
    const canonicalBackground = await encodePlane({
      width: 4,
      height: 1,
      bytes: Uint8ClampedArray.from([
        10, 20, 30, 255,
        50, 60, 70, 255,
        50, 60, 70, 255,
        90, 100, 110, 255,
      ]),
    }, undefined);

    raw.sourceRgba.fill(0);
    raw.foregroundMask.fill(0);
    gate.resolve(canonicalBackground);
    const result = await pending;

    expect(result.diagnostics.sourceRgbaSha256).not.toBe(hash(raw.sourceRgba));
    expect(result.diagnostics.foregroundMaskSha256)
      .not.toBe(hash(raw.foregroundMask));
    expect(result.foregroundRgba.bytes.some((value) => value !== 0)).toBe(true);
  });

  it("gives live preview and final commit the same canonical pixels and receipts", async () => {
    const live = await composeStudioLayerLiftBeta(input(), {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    });
    const commit = await composeStudioLayerLiftBeta(input(), {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    });

    expect(commit.backgroundRgba.bytes).toEqual(live.backgroundRgba.bytes);
    expect(commit.foregroundRgba.bytes).toEqual(live.foregroundRgba.bytes);
    expect(commit.removalMask.bytes).toEqual(live.removalMask.bytes);
    expect(commit.artifacts.background.bytes)
      .toEqual(live.artifacts.background.bytes);
    expect(commit.artifacts.foreground.bytes)
      .toEqual(live.artifacts.foreground.bytes);
    expect(commit.artifacts.receipt).toEqual(live.artifacts.receipt);
    expect(commit.compositionReceipt).toEqual(live.compositionReceipt);
    expect(commit.diagnostics.paritySha256)
      .toBe(live.diagnostics.paritySha256);
  });

  it("copies encoder inputs so a codec cannot mutate committed RGBA planes", async () => {
    const encoder: StudioLayerLiftCompositorPngEncoder = async (plane, signal) => {
      const canonical = await encodePlane(plane, signal);
      plane.bytes.fill(0);
      return canonical;
    };
    const result = await composeStudioLayerLiftBeta(input(), {
      encodePng: encoder,
      decodePngDimensions: decodeDimensions,
    });

    expect(result.backgroundRgba.bytes.some((value) => value !== 0)).toBe(true);
    expect(result.foregroundRgba.bytes.some((value) => value !== 0)).toBe(true);
    expect(hash(result.backgroundRgba.bytes))
      .toBe(result.diagnostics.backgroundRgbaSha256);
    expect(hash(result.foregroundRgba.bytes))
      .toBe(result.diagnostics.foregroundRgbaSha256);
  });

  it("fails closed on empty selection, hash mismatch, unknown fields and accessors", async () => {
    const empty = input(undefined, Uint8Array.from([0, 0, 0, 0]));
    await expect(composeStudioLayerLiftBeta(empty, {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    })).rejects.toMatchObject({ code: "invalid-input" });

    const mismatched = input();
    mismatched.foregroundMask[0] = 255;
    await expect(composeStudioLayerLiftBeta(mismatched, {
      encodePng: encodePlane,
      decodePngDimensions: decodeDimensions,
    })).rejects.toMatchObject({ code: "provenance-mismatch" });

    expect(() => admitStudioLayerLiftCompositorInput({
      ...input(),
      remoteUrl: "https://invalid.test",
    } as StudioLayerLiftCompositorInput)).toThrowError(
      StudioLayerLiftCompositorError,
    );

    const accessor = input() as unknown as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, "sourceSha256", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return digest("f");
      },
    });
    expect(() =>
      admitStudioLayerLiftCompositorInput(
        accessor as unknown as StudioLayerLiftCompositorInput,
      )
    ).toThrowError(StudioLayerLiftCompositorError);
    expect(getterCalls).toBe(0);
  });

  it("rejects pixel and interpolation work budgets before encoding", async () => {
    let pixelBudgetError: unknown;
    try {
      admitStudioLayerLiftCompositorInput({
        ...input(),
        width: 8_192,
        height: 8_192,
      });
    } catch (error) {
      pixelBudgetError = error;
    }
    expect(pixelBudgetError).toMatchObject({ code: "budget-exceeded" });

    const width = 2_450;
    const height = 2_000;
    const pixelCount = width * height;
    const sourceRgba = new Uint8ClampedArray(pixelCount * 4);
    const foregroundMask = new Uint8Array(pixelCount);
    sourceRgba.fill(128);
    foregroundMask.fill(255);
    const expensive: StudioLayerLiftCompositorInput = {
      ...input(),
      width,
      height,
      sourceRgba,
      sourceSha256: hash(sourceRgba),
      foregroundMask,
      foregroundMaskSha256: hash(foregroundMask),
      providerLayers: [{
        layerId: "provider-character",
        role: "character",
        order: 0,
        rgbaSha256: digest("d"),
        maskSha256: hash(foregroundMask),
      }],
    };
    const encoder = vi.fn<StudioLayerLiftCompositorPngEncoder>(encodePlane);

    await expect(composeStudioLayerLiftBeta(expensive, {
      encodePng: encoder,
      decodePngDimensions: async () => ({ width, height }),
    })).rejects.toMatchObject({ code: "budget-exceeded" });
    expect(encoder).not.toHaveBeenCalled();
  });

  it("aborts after asynchronous encoding and maps codec failures without placeholders", async () => {
    const gate = deferred<ArrayBuffer | Uint8Array<ArrayBuffer>>();
    const controller = new AbortController();
    const pending = composeStudioLayerLiftBeta(input(), {
      signal: controller.signal,
      encodePng: () => gate.promise,
      decodePngDimensions: decodeDimensions,
    });
    controller.abort();
    gate.resolve(await encodePlane({
      width: 4,
      height: 1,
      bytes: new Uint8ClampedArray(16),
    }, undefined));
    await expect(pending).rejects.toMatchObject({ code: "aborted" });

    const encoder = vi.fn<StudioLayerLiftCompositorPngEncoder>(
      async () => Promise.reject(new Error("codec failed")),
    );
    await expect(composeStudioLayerLiftBeta(input(), {
      encodePng: encoder,
      decodePngDimensions: decodeDimensions,
    })).rejects.toMatchObject({ code: "encode-failed" });
    expect(encoder).toHaveBeenCalled();
  });
});
