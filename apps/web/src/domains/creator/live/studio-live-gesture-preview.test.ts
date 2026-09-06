import { describe, expect, expectTypeOf, it } from "vitest";

import {
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE,
  StudioLiveGesturePreviewError,
  assertStudioLiveGesturePreviewPayload,
  copyStudioLiveGesturePreviewPayload,
  parseStudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewPayload,
} from "./studio-live-gesture-preview";

function renderer(overrides: Record<string, unknown> = {}) {
  return {
    kind: "freehand",
    mode: "pen",
    stroke: "#224466",
    strokeWidth: 18,
    opacity: 0.72,
    brush: "watercolor-round",
    brushCatalogId: "watercolor-round-v2",
    brushCatalogName: "둥근 수채",
    sampleSpacing: 2,
    blendMode: "multiply",
    pressureModel: "linear-residual-path-v3",
    materialPressureModel: "canonical-material-v1",
    materialMinimumDiameterRatio: 0.08,
    watercolorPipeline: "causal-walker-v2",
    brushTip: { tiltEnabled: true, angleDeg: 12, roundness: 0.8 },
    symmetry: { type: "none", centerX: 540, centerY: 960 },
    ...overrides,
  };
}

function samples(overrides: Record<string, unknown> = {}) {
  return {
    startIndex: 0,
    points: [10, 20, 14, 25],
    pressures: [0.4, 0.7],
    tiltXs: [-12, -10],
    tiltYs: [5, 7],
    twists: [2, 4],
    speeds: [0, 1.2],
    tangentialPressures: [0, 0.1],
    altitudeAngles: [1, 1.1],
    azimuthAngles: [2, 2.1],
    contactWidths: [1, 1.2],
    contactHeights: [1, 1.3],
    sampleTimeOffsets: [0, 8],
    ...overrides,
  };
}

function drawBegin(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    gestureId: "00000000-0000-4000-8000-000000000501",
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "draw",
    base: { documentGeneration: 12 },
    renderer: renderer(),
    samples: samples(),
    ...overrides,
  };
}

describe("studio live gesture preview contract", () => {
  it("accepts every bounded phase/operation form without normalizing renderer input", () => {
    const messages = [
      drawBegin(),
      drawBegin({
        operation: "erase",
        renderer: renderer({ mode: "eraser", brush: "kneaded-eraser", blendMode: "normal" }),
      }),
      drawBegin({
        operation: "lasso-fill",
        renderer: renderer({ fill: "rgba(20, 30, 40, 0.5)", brush: "pen" }),
      }),
      {
        version: 1,
        gestureId: "00000000-0000-4000-8000-000000000501",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "shape",
        renderer: renderer({
          kind: "rect",
          brush: "pen",
          fill: "#ffeeaa",
          strokeStyle: {
            dash: "dashDot",
            lineCap: "round",
            arrowStart: "none",
            arrowEnd: "none",
          },
          shapeParams: {
            starPoints: 5,
            starInnerRatio: 0.5,
            polygonSides: 6,
            cornerRadius: 12,
          },
          sketch: { enabled: true, roughness: 1.4, bowing: 2, fillStyle: "hachure" },
        }),
        base: { documentGeneration: 12 },
        shape: { kind: "rect", x0: 10, y0: 20, x1: 40, y1: 70 },
      },
      {
        version: 1,
        gestureId: "00000000-0000-4000-8000-000000000501",
        pageId: "page-1",
        seq: 2,
        phase: "append",
        operation: "draw",
        samples: samples({ startIndex: 2 }),
      },
      {
        version: 1,
        gestureId: "00000000-0000-4000-8000-000000000501",
        pageId: "page-1",
        seq: 2,
        phase: "replace",
        operation: "shape",
        shape: { kind: "rect", x0: 10, y0: 20, x1: 80, y1: 100 },
      },
      {
        version: 1,
        gestureId: "retouch-501",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "retouch",
        base: {
          documentGeneration: 12,
          targetElementId: "image-1",
          targetRevision: "sha256-abcdef",
        },
        retouch: {
          tool: "smudge",
          startIndex: 0,
          points: [0.2, 0.3],
          radiusNorm: 0.04,
          strength: 0.5,
        },
      },
      {
        version: 1,
        gestureId: "retouch-501",
        pageId: "page-1",
        seq: 2,
        phase: "append",
        operation: "retouch",
        retouch: {
          tool: "smudge",
          startIndex: 1,
          points: [0.25, 0.35],
          radiusNorm: 0.04,
          strength: 0.5,
        },
      },
      {
        version: 1,
        gestureId: "retouch-501",
        pageId: "page-1",
        seq: 3,
        phase: "end",
        operation: "retouch",
      },
      {
        version: 1,
        gestureId: "retouch-501",
        pageId: "page-1",
        seq: 2,
        phase: "cancel",
        operation: "retouch",
      },
    ];

    for (const message of messages) expect(parseStudioLiveGesturePreviewPayload(message)).not.toBeNull();
    expectTypeOf(parseStudioLiveGesturePreviewPayload(messages[0])).toEqualTypeOf<
      StudioLiveGesturePreviewPayload | null
    >();
  });

  it("rejects unknown keys at the payload and every nested renderer boundary", () => {
    const invalid = [
      { ...drawBegin(), transportHint: "p2p" },
      drawBegin({ base: { documentGeneration: 12, serverOnly: true } }),
      drawBegin({ renderer: renderer({ extensions: { future: true } }) }),
      drawBegin({ renderer: renderer({ gradient: { colors: ["#fff"] } }) }),
      drawBegin({
        renderer: renderer({
          brushTip: { tiltEnabled: true, angleDeg: 0, roundness: 1, alphaMapBase64: "AAAA" },
        }),
      }),
      drawBegin({
        renderer: renderer({
          brushDynamics: {
            version: 1,
            presetId: "dry-media",
            seed: 2,
            fallbackPressure: 0.5,
            grain: { source: "paper.png" },
          },
        }),
      }),
      drawBegin({ samples: samples({ predicted: [true, false] }) }),
      drawBegin({
        operation: "shape",
        renderer: renderer({ kind: "rect" }),
        samples: undefined,
        shape: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1, rotation: 0 },
      }),
      {
        version: 1,
        gestureId: "retouch-1",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "retouch",
        base: { documentGeneration: 1, targetElementId: "image-1", targetRevision: "r1" },
        retouch: {
          tool: "smudge",
          startIndex: 0,
          points: [0.1, 0.1],
          radiusNorm: 0.1,
          strength: 0.5,
          imageBytes: "AAAA",
        },
      },
    ];

    for (const message of invalid) expect(parseStudioLiveGesturePreviewPayload(message)).toBeNull();
  });

  it("enforces phase ownership and renderer-operation agreement", () => {
    const invalid = [
      drawBegin({ renderer: renderer({ mode: "eraser" }) }),
      drawBegin({ operation: "erase", renderer: renderer() }),
      drawBegin({ operation: "lasso-fill", renderer: renderer() }),
      drawBegin({
        operation: "shape",
        renderer: renderer({ kind: "ellipse" }),
        samples: undefined,
        shape: { kind: "rect", x0: 0, y0: 0, x1: 10, y1: 10 },
      }),
      { ...drawBegin(), phase: "append" },
      {
        version: 1,
        gestureId: "shape-1",
        pageId: "page-1",
        seq: 2,
        phase: "append",
        operation: "shape",
        samples: samples({ startIndex: 2 }),
      },
      {
        version: 1,
        gestureId: "draw-1",
        pageId: "page-1",
        seq: 2,
        phase: "replace",
        operation: "draw",
        samples: samples(),
      },
      {
        version: 1,
        gestureId: "draw-1",
        pageId: "page-1",
        seq: 3,
        phase: "end",
        operation: "draw",
        samples: samples({ startIndex: 2 }),
      },
      {
        version: 1,
        gestureId: "retouch-1",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "retouch",
        base: { documentGeneration: 1, targetElementId: "image-1" },
        retouch: {
          tool: "smudge",
          startIndex: 0,
          points: [0.1, 0.1],
          radiusNorm: 0.1,
          strength: 0.5,
        },
      },
    ];

    for (const message of invalid) expect(parseStudioLiveGesturePreviewPayload(message)).toBeNull();
  });

  it("requires finite in-range, even, aligned and bounded sample channels", () => {
    const tooManyPoints = Array.from(
      { length: (STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE + 1) * 2 },
      (_, index) => index,
    );
    const invalid = [
      drawBegin({ seq: 0 }),
      drawBegin({ seq: 2 }),
      drawBegin({ seq: Number.MAX_SAFE_INTEGER + 1 }),
      drawBegin({ renderer: renderer({ strokeWidth: 0 }) }),
      drawBegin({ renderer: renderer({ opacity: Number.NaN }) }),
      drawBegin({ samples: samples({ points: [0, 1, 2] }) }),
      drawBegin({ samples: samples({ points: [0, Number.POSITIVE_INFINITY] }) }),
      drawBegin({ samples: samples({ points: [0, 10_000_001] }) }),
      drawBegin({ samples: samples({ pressures: [0.5] }) }),
      drawBegin({ samples: samples({ pressures: [0.5, 1.1] }) }),
      drawBegin({ samples: samples({ tiltXs: [-91, 0] }) }),
      drawBegin({ samples: samples({ sampleTimeOffsets: [8, 7] }) }),
      drawBegin({ samples: samples({ points: tooManyPoints }) }),
      drawBegin({
        samples: samples({
          startIndex: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE - 1,
        }),
      }),
    ];

    for (const message of invalid) expect(parseStudioLiveGesturePreviewPayload(message)).toBeNull();
  });

  it("rejects non-finite or out-of-range target-local retouch input", () => {
    const base = {
      version: 1,
      gestureId: "retouch-1",
      pageId: "page-1",
      seq: 1,
      phase: "begin",
      operation: "retouch",
      base: { documentGeneration: 1, targetElementId: "image-1", targetRevision: "r1" },
      retouch: {
        tool: "smudge",
        startIndex: 0,
        points: [0.1, 0.1],
        radiusNorm: 0.1,
        strength: 0.5,
      },
    };
    const invalidRetouches = [
      { ...base.retouch, points: [-0.1, 0.2] },
      { ...base.retouch, points: [0.1, 1.1] },
      { ...base.retouch, points: [0.1, 0.2, 0.3] },
      { ...base.retouch, radiusNorm: 0 },
      { ...base.retouch, strength: 1.1 },
      { ...base.retouch, startIndex: STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE },
    ];
    for (const retouch of invalidRetouches) {
      expect(parseStudioLiveGesturePreviewPayload({ ...base, retouch })).toBeNull();
    }
  });

  it("rejects URL, data, blob, file and CSS resource strings", () => {
    const invalid = [
      drawBegin({ gestureId: "data:image/png;base64,AAAA" }),
      drawBegin({ renderer: renderer({ stroke: "url(https://example.com/ink.svg)" }) }),
      drawBegin({ renderer: renderer({ fill: "data:image/png;base64,AAAA" }) }),
      drawBegin({ renderer: renderer({ brush: "blob:preview-brush" }) }),
      drawBegin({ renderer: renderer({ brushCatalogId: "https://example.com/brush" }) }),
      drawBegin({ base: { documentGeneration: 1, targetRevision: "file:///tmp/source.png" } }),
      drawBegin({ renderer: renderer({ brushCatalogName: "javascript:alert(1)" }) }),
    ];
    for (const message of invalid) expect(parseStudioLiveGesturePreviewPayload(message)).toBeNull();
  });

  it("applies the serialized 64 KiB cap after field validation", () => {
    const count = STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE;
    const longNumber = 0.123456789012345;
    const points = Array.from({ length: count * 2 }, () => longNumber);
    const channel = Array.from({ length: count }, () => longNumber);
    const oversized = drawBegin({
      samples: {
        startIndex: 0,
        points,
        pressures: channel,
        tiltXs: channel,
        tiltYs: channel,
        twists: channel,
        speeds: channel,
        tangentialPressures: channel,
        altitudeAngles: channel,
        azimuthAngles: channel,
        contactWidths: channel,
        contactHeights: channel,
        sampleTimeOffsets: channel,
      },
    });
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
    );
    expect(parseStudioLiveGesturePreviewPayload(oversized)).toBeNull();
  });

  it("returns detached copies and exposes an assertive hot-path guard", () => {
    const input = drawBegin();
    const parsed = parseStudioLiveGesturePreviewPayload(input);
    expect(parsed).not.toBeNull();
    const copied = copyStudioLiveGesturePreviewPayload(parsed!);

    input.samples.points[0] = 999;
    input.renderer.brushTip.angleDeg = 99;
    expect(parsed?.samples?.points[0]).toBe(10);
    expect(parsed?.renderer?.brushTip?.angleDeg).toBe(12);
    expect(copied.samples?.points).not.toBe(parsed?.samples?.points);

    expect(() => assertStudioLiveGesturePreviewPayload(parsed)).not.toThrow();
    expect(() => assertStudioLiveGesturePreviewPayload({ ...parsed, seq: 0 })).toThrow(
      StudioLiveGesturePreviewError,
    );
  });
});
