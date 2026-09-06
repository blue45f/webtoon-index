import { describe, expect, expectTypeOf, it } from "vitest";

import {
  STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES as CLIENT_BLEND_MODES,
  STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS as CLIENT_DRAW_KINDS,
  STUDIO_LIVE_GESTURE_PREVIEW_LIMITS as CLIENT_LIMITS,
  STUDIO_LIVE_GESTURE_PREVIEW_KIND as CLIENT_KIND,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES as CLIENT_MAX_BYTES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE as CLIENT_MAX_GESTURE_SAMPLES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE as CLIENT_MAX_MESSAGE_SAMPLES,
  STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS as CLIENT_OPERATIONS,
  STUDIO_LIVE_GESTURE_PREVIEW_PHASES as CLIENT_PHASES,
  STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS as CLIENT_SAMPLE_CHANNELS,
  STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS as CLIENT_SHAPE_KINDS,
  STUDIO_LIVE_GESTURE_PREVIEW_VERSION as CLIENT_VERSION,
  parseStudioLiveGesturePreviewPayload,
  type StudioLiveGesturePreviewPayload,
} from "../../../../web/src/domains/creator/live/studio-live-gesture-preview";

import {
  STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES,
  STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS,
  STUDIO_LIVE_GESTURE_PREVIEW_LIMITS,
  STUDIO_LIVE_GESTURE_PREVIEW_KIND,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE,
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE,
  STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS,
  STUDIO_LIVE_GESTURE_PREVIEW_PHASES,
  STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS,
  STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS,
  STUDIO_LIVE_GESTURE_PREVIEW_VERSION,
  StudioLiveGesturePreviewPayloadSchema,
  type StudioLiveGesturePreviewInput,
} from "./studio-live-gesture-preview";

function drawBegin() {
  return {
    version: 1,
    gestureId: "00000000-0000-4000-8000-000000000601",
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "draw",
    base: { documentGeneration: 8 },
    renderer: {
      kind: "freehand",
      mode: "pen",
      stroke: "#334455",
      strokeWidth: 24,
      opacity: 0.8,
      brush: "ink-wash",
      brushCatalogId: "ink-wash-v2",
      brushCatalogName: "먹 번짐",
      sampleSpacing: 1.5,
      blendMode: "multiply",
      pressureModel: "linear-residual-path-v3",
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 0.1,
      watercolorPipeline: "causal-walker-v2",
      brushTip: { tiltEnabled: true, angleDeg: 10, roundness: 0.75 },
      symmetry: { type: "none", centerX: 540, centerY: 960 },
      brushDynamics: {
        version: 1,
        presetId: "dry-media",
        seed: 700,
        fallbackPressure: 0.5,
        minimumDiameterRatio: 0.08,
        spacingRatio: 0.12,
        scatterRatio: null,
      },
    },
    samples: {
      startIndex: 0,
      points: [10, 20, 15, 27],
      pressures: [0.4, 0.6],
      tiltXs: [-4, -2],
      tiltYs: [3, 5],
      twists: [0, 2],
      speeds: [0, 1],
      tangentialPressures: [0, 0.1],
      altitudeAngles: [1, 1.1],
      azimuthAngles: [2, 2.1],
      contactWidths: [1, 1.1],
      contactHeights: [1, 1.2],
      sampleTimeOffsets: [0, 8],
    },
  };
}

describe("studio live gesture preview API contract", () => {
  it("pins every duplicated catalog and limit to the client contract", () => {
    expect(STUDIO_LIVE_GESTURE_PREVIEW_VERSION).toBe(CLIENT_VERSION);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_KIND).toBe(CLIENT_KIND);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_KIND).toBe("preview:gesture");
    expect(STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES).toBe(CLIENT_MAX_BYTES);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE).toBe(
      CLIENT_MAX_MESSAGE_SAMPLES,
    );
    expect(STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_GESTURE).toBe(
      CLIENT_MAX_GESTURE_SAMPLES,
    );
    expect(STUDIO_LIVE_GESTURE_PREVIEW_PHASES).toEqual(CLIENT_PHASES);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_OPERATIONS).toEqual(CLIENT_OPERATIONS);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_DRAW_KINDS).toEqual(CLIENT_DRAW_KINDS);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_SHAPE_KINDS).toEqual(CLIENT_SHAPE_KINDS);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_BLEND_MODES).toEqual(CLIENT_BLEND_MODES);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_SAMPLE_CHANNEL_KEYS).toEqual(CLIENT_SAMPLE_CHANNELS);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_LIMITS).toEqual(CLIENT_LIMITS);
  });

  it("accepts the same begin, append, replace, retouch, end and cancel corpus as the client", () => {
    const valid = [
      drawBegin(),
      {
        version: 1,
        gestureId: "00000000-0000-4000-8000-000000000601",
        pageId: "page-1",
        seq: 2,
        phase: "append",
        operation: "draw",
        samples: {
          startIndex: 2,
          points: [20, 30],
          pressures: [0.8],
          tiltXs: [0],
          tiltYs: [5],
          twists: [3],
          speeds: [1.2],
          tangentialPressures: [0],
          altitudeAngles: [1.1],
          azimuthAngles: [2.2],
          contactWidths: [1],
          contactHeights: [1],
          sampleTimeOffsets: [16],
        },
      },
      {
        version: 1,
        gestureId: "shape-601",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "shape",
        base: { documentGeneration: 8 },
        renderer: {
          kind: "ellipse",
          mode: "pen",
          stroke: "#112233",
          strokeWidth: 4,
          fill: "#aabbcc",
          shapeParams: {
            starPoints: 5,
            starInnerRatio: 0.5,
            polygonSides: 6,
            cornerRadius: 4,
          },
        },
        shape: { kind: "ellipse", x0: 1, y0: 2, x1: 30, y1: 40 },
      },
      {
        version: 1,
        gestureId: "shape-601",
        pageId: "page-1",
        seq: 2,
        phase: "replace",
        operation: "shape",
        shape: { kind: "ellipse", x0: 1, y0: 2, x1: 60, y1: 70 },
      },
      {
        version: 1,
        gestureId: "retouch-601",
        pageId: "page-1",
        seq: 1,
        phase: "begin",
        operation: "retouch",
        base: {
          documentGeneration: 8,
          targetElementId: "image-1",
          targetRevision: "sha256-601",
        },
        retouch: {
          tool: "smudge",
          startIndex: 0,
          points: [0.2, 0.4],
          radiusNorm: 0.05,
          strength: 0.65,
        },
      },
      {
        version: 1,
        gestureId: "retouch-601",
        pageId: "page-1",
        seq: 2,
        phase: "end",
        operation: "retouch",
      },
      {
        version: 1,
        gestureId: "retouch-601",
        pageId: "page-1",
        seq: 2,
        phase: "cancel",
        operation: "retouch",
      },
    ];

    for (const input of valid) {
      const apiResult = StudioLiveGesturePreviewPayloadSchema.safeParse(input);
      expect(apiResult.success).toBe(true);
      expect(parseStudioLiveGesturePreviewPayload(input)).not.toBeNull();
    }
    expectTypeOf<StudioLiveGesturePreviewInput>().toMatchTypeOf<
      StudioLiveGesturePreviewPayload
    >();
  });

  it("rejects the same strict-key, resource, alignment, range and phase violations as the client", () => {
    const begin = drawBegin();
    const invalid = [
      { ...begin, peerAssetUrl: "https://example.com/stroke.png" },
      { ...begin, base: { documentGeneration: 8, transport: "p2p" } },
      { ...begin, renderer: { ...begin.renderer, extensions: { future: true } } },
      { ...begin, renderer: { ...begin.renderer, fill: "data:image/png;base64,AAAA" } },
      { ...begin, renderer: { ...begin.renderer, brush: "blob:custom-brush" } },
      { ...begin, renderer: { ...begin.renderer, opacity: Number.NaN } },
      { ...begin, seq: 2 },
      { ...begin, samples: { ...begin.samples, points: [0, 1, 2] } },
      { ...begin, samples: { ...begin.samples, pressures: [0.5] } },
      { ...begin, samples: { ...begin.samples, sampleTimeOffsets: [10, 9] } },
      { ...begin, samples: { ...begin.samples, startIndex: 1 } },
      { ...begin, renderer: undefined },
      { ...begin, phase: "append" },
      {
        version: 1,
        gestureId: "shape-1",
        pageId: "page-1",
        seq: 1,
        phase: "replace",
        operation: "draw",
        shape: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 },
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

    for (const input of invalid) {
      expect(StudioLiveGesturePreviewPayloadSchema.safeParse(input).success).toBe(false);
      expect(parseStudioLiveGesturePreviewPayload(input)).toBeNull();
    }
  });

  it("mirrors the client 64 KiB serialized byte cap", () => {
    const count = STUDIO_LIVE_GESTURE_PREVIEW_MAX_SAMPLES_PER_MESSAGE;
    const value = 0.123456789012345;
    const channel = Array.from({ length: count }, () => value);
    const oversized = {
      ...drawBegin(),
      samples: {
        startIndex: 0,
        points: Array.from({ length: count * 2 }, () => value),
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
    };
    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBeGreaterThan(
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
    );
    expect(StudioLiveGesturePreviewPayloadSchema.safeParse(oversized).success).toBe(false);
    expect(parseStudioLiveGesturePreviewPayload(oversized)).toBeNull();
  });
});
