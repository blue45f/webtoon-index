import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  parseStudioSceneLayerLiftRequest,
} from "./studio-layer-lift-contract";
import {
  createStudioLayerLiftSourceSnapshot,
  type StudioLayerLiftSourceSnapshotRuntime,
} from "./studio-layer-lift-source-snapshot";

import type { El } from "../studio-element-model";

const INLINE_PNG = "data:image/png;base64,AA==";

function image(overrides: Partial<Extract<El, { type: "image" }>> = {}): Extract<
  El,
  { type: "image" }
> {
  return {
    id: "source",
    type: "image",
    name: "Cut source",
    src: INLINE_PNG,
    x: 42.5,
    y: -15.25,
    width: 2,
    height: 1,
    rotation: 23,
    flipped: true,
    flippedY: true,
    skewX: 7,
    skewY: -4,
    ...overrides,
  };
}

function availability(source: El = image()) {
  return {
    elements: [source],
    groups: [],
    selectedIds: [source.id],
  } as const;
}

function runtime(
  pixels: Uint8Array | Uint8ClampedArray,
  overrides: Partial<StudioLayerLiftSourceSnapshotRuntime> = {},
): Partial<StudioLayerLiftSourceSnapshotRuntime> {
  return {
    loadImage: async () => ({
      image: Object.freeze({ fixture: true }),
      naturalWidth: 2,
      naturalHeight: 1,
    }),
    readPixels: () => pixels,
    applyFilters: async (bytes) => ({
      bytes,
      execution: "direct",
    }),
    ...overrides,
  };
}

describe("studio layer-lift source snapshot", () => {
  it("creates an owned straight-alpha sRGB descriptor and preserves placement metadata", async () => {
    const callerPixels = Uint8ClampedArray.from([
      255, 0, 0, 128,
      12, 34, 56, 255,
    ]);
    const loadImage = vi.fn(runtime(callerPixels).loadImage!);
    const readPixels = vi.fn(runtime(callerPixels).readPixels!);
    const result = await createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      runtime: { loadImage, readPixels },
    });

    expect(result).toMatchObject({
      ok: true,
      filterExecution: "none",
      placement: {
        x: 42.5,
        y: -15.25,
        width: 2,
        height: 1,
        rotation: 23,
        flipped: true,
        flippedY: true,
        skewX: 7,
        skewY: -4,
      },
      source: {
        sourceId: "source",
        sourceName: "Cut source",
        mimeType: "image/png",
        width: 2,
        height: 1,
        pixelCount: 2,
        pixelFormat: "rgba8-srgb-straight",
        channels: 4,
        byteLength: 8,
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.source.sha256).toBe(
      `sha256:${sha256HexPortable(new Uint8Array(callerPixels))}`,
    );
    expect([...result.source.bytes]).toEqual([...callerPixels]);
    expect(result.source.bytes).not.toBe(callerPixels);
    expect(result.sourceFingerprint).toMatch(
      /^studio-layer-lift-source-v1:[0-9a-f]{16}$/u,
    );
    expect(loadImage).toHaveBeenCalledWith(INLINE_PNG, undefined);
    expect(readPixels).toHaveBeenCalledWith(
      expect.objectContaining({ naturalWidth: 2, naturalHeight: 1 }),
      2,
      1,
    );

    callerPixels.fill(0);
    expect([...result.source.bytes]).toEqual([
      255, 0, 0, 128,
      12, 34, 56, 255,
    ]);
  });

  it("feeds the exact descriptor into the strict provider request parser", async () => {
    const result = await createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      runtime: runtime(Uint8Array.from([
        1, 2, 3, 4,
        5, 6, 7, 8,
      ])),
    });
    if (!result.ok) throw new Error(result.message);

    const parsed = parseStudioSceneLayerLiftRequest({
      kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
      version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
      requestId: "request-1",
      source: result.source,
      requestedRoles: ["background", "foreground"],
    });

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        source: {
          sourceId: "source",
          sha256: result.source.sha256,
        },
      },
    });
  });

  it("bakes active filters through the injected exact filter path", async () => {
    const raw = Uint8Array.from([
      10, 20, 30, 255,
      40, 50, 60, 128,
    ]);
    const filtered = Uint8Array.from([
      110, 120, 130, 255,
      140, 150, 160, 128,
    ]);
    const applyFilters = vi.fn(async (
      bytes: Uint8Array<ArrayBuffer>,
      width: number,
      height: number,
      source: Readonly<Extract<El, { type: "image" }>>,
    ) => {
      expect([...bytes]).toEqual([...raw]);
      expect({ width, height }).toEqual({ width: 2, height: 1 });
      expect(source).toMatchObject({
        brightness: 0.25,
        flipped: true,
        rotation: 23,
      });
      return { bytes: filtered, execution: "worker" as const };
    });
    const result = await createStudioLayerLiftSourceSnapshot({
      availability: availability(image({ brightness: 0.25 })),
      runtime: runtime(raw, { applyFilters }),
    });

    expect(result).toMatchObject({
      ok: true,
      filterExecution: "worker",
      source: {
        sha256: `sha256:${sha256HexPortable(filtered)}`,
      },
    });
    if (!result.ok) throw new Error(result.message);
    expect([...result.source.bytes]).toEqual([...filtered]);
    expect(result.source.bytes).not.toBe(filtered);
    expect(applyFilters).toHaveBeenCalledOnce();
  });

  it("rejects stale document state after the async decode boundary", async () => {
    const initial = availability();
    let current = initial;
    const readPixels = vi.fn(() => new Uint8Array(8));
    const result = await createStudioLayerLiftSourceSnapshot({
      availability: initial,
      readCurrent: () => current,
      runtime: runtime(new Uint8Array(8), {
        loadImage: async () => {
          current = availability(image({ x: 99 }));
          return {
            image: {},
            naturalWidth: 2,
            naturalHeight: 1,
          };
        },
        readPixels,
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "state",
      code: "source-changed",
    });
    expect(readPixels).not.toHaveBeenCalled();
  });

  it("maps cancellation, load failure, and blocked canvas readback separately", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      signal: controller.signal,
      runtime: runtime(new Uint8Array(8)),
    })).resolves.toMatchObject({
      ok: false,
      code: "aborted",
    });

    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(image({
        src: "https://cdn.example.test/source.png",
      })),
      runtime: runtime(new Uint8Array(8), {
        loadImage: async () => {
          throw new Error("network unavailable");
        },
      }),
    })).resolves.toMatchObject({
      ok: false,
      phase: "decode",
      code: "source-load-failed",
      message: expect.stringMatching(/CORS/u),
    });

    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      runtime: runtime(new Uint8Array(8), {
        readPixels: () => {
          throw Object.assign(new Error("The canvas has been tainted"), {
            name: "SecurityError",
          });
        },
      }),
    })).resolves.toMatchObject({
      ok: false,
      phase: "readback",
      code: "source-readback-blocked",
    });
  });

  it("fails closed for decoded budgets, malformed pixels, and filter failures", async () => {
    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      runtime: runtime(new Uint8Array(8), {
        loadImage: async () => ({
          image: {},
          naturalWidth: 8_193,
          naturalHeight: 1,
        }),
      }),
    })).resolves.toMatchObject({
      ok: false,
      code: "source-decoded-budget-exceeded",
    });

    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(),
      runtime: runtime(new Uint8Array(7)),
    })).resolves.toMatchObject({
      ok: false,
      code: "source-pixel-buffer-invalid",
    });

    await expect(createStudioLayerLiftSourceSnapshot({
      availability: availability(image({ contrast: 0.2 })),
      runtime: runtime(new Uint8Array(8), {
        applyFilters: async () => {
          throw new Error("filter runtime failed");
        },
      }),
    })).resolves.toMatchObject({
      ok: false,
      phase: "filter",
      code: "source-filter-failed",
    });
  });
});
