import { describe, expect, it } from "vitest";

import {
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  normalizeStudioBrushDynamicsSettings,
} from "../brush/studio-brush-dynamics";
import { createDefaultStudioDrawingAssistDocument } from "../brush/studio-drawing-assist-document";
import {
  DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
  DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
  DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
  DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
} from "../studio-advanced-blur-filter-kernels";
import { parseStudioAdvancedRulerDocument } from "../studio-advanced-ruler-document";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import { captureStudioOutlineStrokeContractV1 } from "../studio-outline-stroke-contract";
import { createStudioWorkAssetInitialImageDescriptor } from "../studio-work-asset-admission";

import {
  StudioCrdtDocument,
  type StudioCrdtPageRecord,
  type StudioCrdtJsonObject,
  type StudioCrdtSceneElementRecord,
  type StudioCrdtStrokeRecord,
} from "./studio-crdt-document";
import {
  reconcileStudioCrdtPages,
  reconcileStudioCrdtSceneGraphPages,
  studioCrdtElementToSceneElement,
  studioCrdtStrokeToDrawElement,
  studioDrawElementSampleSlice,
  studioDrawElementToCrdtStroke,
  studioElementToCrdtSceneElement,
  studioPageToCrdtPage,
  studioSceneElementToCrdtElement,
  type StudioCrdtCompatibleElement,
  type StudioCrdtCompatibleDrawElement,
  type StudioCrdtCompatibleSceneElement,
} from "./studio-crdt-page-bridge";
import {
  STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
} from "./studio-crdt-protocol";


import {
  captureStudioInkInputContractV1,
  captureStudioInkInputContractV2,
} from "@/shared/lib/studio-ink-input-contract";

function record(
  id: string,
  pageId: string,
  orderIndex: number,
  overrides: Partial<StudioCrdtStrokeRecord> = {}
): StudioCrdtStrokeRecord {
  return {
    id,
    pageId,
    layerId: "page-root",
    status: "finalized",
    deleted: false,
    orderIndex,
    payload: {
      version: 1,
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [orderIndex, orderIndex, orderIndex + 1, orderIndex + 1],
      pressures: [0.4, 0.8],
      stroke: "#123456",
      strokeWidth: 7,
    },
    ...overrides,
  };
}

const R8_ENCODED_HASH = `sha256:${"a".repeat(64)}`;
const R8_DECODED_HASH = `sha256:${"b".repeat(64)}`;

function r8GrainSource() {
  return {
    kind: "r8-texture-v1" as const,
    asset: {
      assetId: "paper.canvas-fine.v1",
      encodedSha256: R8_ENCODED_HASH,
      decodedSha256: R8_DECODED_HASH,
      byteLength: 2_048,
      mediaType: "image/png" as const,
      width: 32,
      height: 32,
      channel: "luminance" as const,
      encoding: "r8-unorm" as const,
    },
  };
}

function sceneRecord(
  id: string,
  pageId: string,
  orderIndex: number,
  type: "text" | "bubble" = "text",
  overrides: Partial<StudioCrdtSceneElementRecord> = {}
): StudioCrdtSceneElementRecord {
  const props: StudioCrdtJsonObject = type === "text"
    ? { text: "대사", x: 10, y: 20, width: 240, fontSize: 28, fill: "#111", rotation: 0 }
    : {
        variant: "round", text: "말풍선", x: 20, y: 30, width: 260, height: 150,
        fill: "#fff", textFill: "#111", rotation: 0,
      };
  return {
    id,
    pageId,
    layerId: "lettering",
    deleted: false,
    orderIndex,
    payload: { version: 1, type, props },
    ...overrides,
  };
}

function pageRecord(
  id: string,
  orderIndex: number,
  overrides: Partial<StudioCrdtPageRecord> = {}
): StudioCrdtPageRecord {
  return {
    id,
    deleted: false,
    orderIndex,
    payload: {
      version: 1,
      props: { bg: "#ffffff", bgGrad: null, canvasH: 1600, name: id },
    },
    ...overrides,
  };
}

describe("phase-two brush CRDT bridge", () => {
  it("keeps colour, grain-space and multi-tip snapshots inside the existing JSON envelope", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      minimumDiameterRatio: 0.68,
      colorDynamics: {
        backgroundColor: "#f0b429",
        foregroundBackgroundMix: 0.25,
        hueJitter: 12,
        saturationJitter: 0.08,
        valueJitter: 0.06,
      },
      grain: { space: "canvas-fixed", amount: 0.5, scale: 7, contrast: 0.6, seed: 91 },
      tip: { shape: "grain" },
      tipLayers: [
        { tip: { shape: "bristle" }, scale: 0.7, opacity: 0.65, offsetY: -0.4 },
        { tip: { shape: "star" }, scale: 0.35, opacity: 0.4, offsetY: 0.5 },
      ],
    });
    const input = studioDrawElementToCrdtStroke("page-brush", {
      id: "phase-two-brush",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 20, 24],
      pressures: [0.4, 0.8],
      stroke: "#315cdd",
      strokeWidth: 12,
      brush: "dry-media",
      brushDynamics,
    });
    const restored = studioCrdtStrokeToDrawElement({
      ...input,
      status: "finalized",
      deleted: false,
      orderIndex: 0,
    });

    expect(input.payload.version).toBe(STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION);
    expect(input.payload.brushDynamics).toEqual(JSON.parse(JSON.stringify(brushDynamics)));
    expect(normalizeStudioBrushDynamicsSettings(restored.brushDynamics)).toEqual(brushDynamics);
    expect(restored.brushDynamics).toMatchObject({ minimumDiameterRatio: 0.68 });
    for (const legacyVersion of [
      STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => studioCrdtStrokeToDrawElement({
        ...input,
        payload: { ...input.payload, version: legacyVersion },
        status: "finalized",
        deleted: false,
        orderIndex: 0,
      })).toThrow("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다");
    }
    expect(() => studioDrawElementToCrdtStroke("page-brush", {
      id: "invalid-dynamic-floor",
      type: "draw",
      points: [1, 2],
      stroke: "#315cdd",
      strokeWidth: 12,
      brush: "dry-media",
      brushDynamics: { minimumDiameterRatio: 1.01 },
    })).toThrow("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다");
  });
});

describe("studio CRDT page bridge", () => {
  it.each([
    { type: "gaussian" as const, strength: 100, radius: 24, angle: 0 },
    { type: "motion" as const, strength: 100, radius: 40, angle: 315 },
  ])("round-trips admitted page-composite $type metadata from descriptor through hydration", (blurFx) => {
    const canonicalSource = "work-asset://image/filter-composite-1";
    const curve = [{ x: 0, y: 8 }, { x: 128, y: 148 }, { x: 255, y: 248 }];
    const curveCh = {
      r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
      g: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
      b: [{ x: 0, y: 0 }, { x: 255, y: 232 }],
    };
    const lensBlur = {
      ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
      radius: 9.5,
      apertureRotationRadians: Math.PI / 4,
    };
    const fieldIrisBlur = {
      ...DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
      focusCenterX: 0.35,
      focusCenterY: 0.65,
      focusRadius: 0.22,
      feather: 0.3,
      maximumBlurRadius: 12,
    };
    const tiltShiftBlur = {
      ...DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
      axisRadians: -Math.PI / 3,
      focusWidth: 0.32,
      feather: 0.38,
      maximumBlurRadius: 10,
    };
    const selectiveGaussianBlur = {
      ...DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
      radius: 6,
      spatialSigma: 3.5,
      edgeThreshold: 48,
      edgeSoftness: 0.6,
    };
    const lineCleanup = { threshold: 0.64, strength: 0.45 };
    const screentoneRemoval = { radius: 2, strength: 0.88, inkLumaThreshold: 72 };
    const jpegArtifactReduction = {
      deblockStrength: 0.72,
      deringStrength: 0.45,
      boundaryThreshold: 6,
      protectedEdgeThreshold: 88,
      ringingThreshold: 18,
      inkLumaThreshold: 64,
    };
    const edgeAwareDenoise = { radius: 1, strength: 0.78, rangeThreshold: 72 };
    const descriptor = createStudioWorkAssetInitialImageDescriptor({
      id: "filter-composite-1",
      type: "image",
      src: "data:image/png;base64,private",
      x: 24,
      y: 48,
      width: 800,
      height: 1_600,
      rotation: 0,
      filterPageComposite: true,
      blurFx,
      lensBlur,
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
      brightness: 0.8,
      contrast: -80,
      hue: 180,
      saturation: -1,
      curve,
      curveCh,
      edgeAwareDenoise,
      jpegArtifactReduction,
      lineCleanup,
      screentoneRemoval,
    });
    const encoded = studioElementToCrdtSceneElement("page-a", {
      ...descriptor.element,
      src: canonicalSource,
    } as StudioCrdtCompatibleElement & Record<string, unknown>);

    expect(encoded.payload).toMatchObject({
      version: 1,
      type: "reference",
      props: {
        elementType: "image",
        filterPageComposite: true,
        blurFx,
        lensBlur,
        fieldIrisBlur,
        tiltShiftBlur,
        selectiveGaussianBlur,
        brightness: 0.8,
        contrast: -80,
        hue: 180,
        saturation: -1,
        curve,
        curveCh,
        edgeAwareDenoise,
        jpegArtifactReduction,
        lineCleanup,
        screentoneRemoval,
      },
    });
    expect(encoded.payload.props).not.toHaveProperty("src");

    const record = {
      ...encoded,
      orderIndex: 0,
      deleted: false,
    };
    const referenceSource = {
      id: "filter-composite-1",
      type: "image",
      src: canonicalSource,
      decodedWidth: 800,
    };
    const restored = studioCrdtElementToSceneElement(record, referenceSource);
    expect(restored).toMatchObject({
      id: "filter-composite-1",
      type: "image",
      src: canonicalSource,
      decodedWidth: 800,
      filterPageComposite: true,
      blurFx,
      lensBlur,
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
      brightness: 0.8,
      contrast: -80,
      hue: 180,
      saturation: -1,
      curve,
      curveCh,
      edgeAwareDenoise,
      jpegArtifactReduction,
      lineCleanup,
      screentoneRemoval,
    });

    const reconciled = reconcileStudioCrdtSceneGraphPages(
      [{
        id: "page-a",
        bg: "#fff",
        bgGrad: null,
        canvasH: 1_600,
        elements: [structuredClone(referenceSource)],
      }],
      [],
      [record],
      []
    );
    expect(reconciled.pages[0]?.elements[0]).toMatchObject({
      src: canonicalSource,
      filterPageComposite: true,
      blurFx,
      lensBlur,
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
      brightness: 0.8,
      contrast: -80,
      hue: 180,
      saturation: -1,
      curve,
      curveCh,
      edgeAwareDenoise,
      jpegArtifactReduction,
      lineCleanup,
      screentoneRemoval,
    });
  });

  it("clears allowlisted reference edits absent from the envelope on hydration", () => {
    const canonicalSource = "work-asset://image/effect-clear-1";
    const staleEffects = {
      // Structured object key, scalar filter key, boolean key — one per allowlist category.
      borderEffect: {
        enabled: true, thickness: 3, color: "#ff0000", type: "outer" as const, antiAliased: false,
      },
      blur: 12,
      grayscale: true,
    };
    const staleLocal = {
      id: "effect-clear-1",
      type: "image",
      src: canonicalSource,
      x: 24,
      y: 48,
      width: 400,
      height: 300,
      rotation: 0,
      contrast: 30,
      decodedWidth: 800,
      ...structuredClone(staleEffects),
    } as StudioCrdtCompatibleElement & Record<string, unknown>;
    // The remote author removed all three effects: an unset key is entirely absent from the
    // envelope, while the surviving contrast edit still rides along.
    const encoded = studioElementToCrdtSceneElement("page-a", {
      id: "effect-clear-1",
      type: "image",
      src: canonicalSource,
      x: 140,
      y: 60,
      width: 400,
      height: 300,
      rotation: 0,
      contrast: -40,
    } as StudioCrdtCompatibleElement & Record<string, unknown>);
    for (const key of Object.keys(staleEffects)) {
      expect(encoded.payload.props).not.toHaveProperty(key);
    }
    const record = { ...encoded, orderIndex: 0, deleted: false };

    const hydrated = studioCrdtElementToSceneElement(
      record,
      staleLocal
    ) as Record<string, unknown>;
    // The envelope is authoritative for the whole allowlist — absent keys clear stale values.
    for (const key of Object.keys(staleEffects)) {
      expect(hydrated).not.toHaveProperty(key);
    }
    // Present envelope values and non-allowlist local metadata both survive untouched.
    expect(hydrated).toMatchObject({
      id: "effect-clear-1",
      type: "image",
      src: canonicalSource,
      x: 140,
      y: 60,
      contrast: -40,
      decodedWidth: 800,
    });

    // Topology references (not-yet-admitted local source) never carry allowlist props in their
    // envelope; the deletion rule must not touch their byte-preserved local body.
    const topologyLocal = {
      id: "local-1",
      type: "image",
      src: "blob:local-body",
      x: 1,
      y: 2,
      width: 10,
      height: 10,
      rotation: 0,
      borderEffect: structuredClone(staleEffects.borderEffect),
    } as StudioCrdtCompatibleElement & Record<string, unknown>;
    const topologyEncoded = studioElementToCrdtSceneElement("page-a", topologyLocal);
    expect(Object.keys(topologyEncoded.payload.props)).toEqual(["elementType"]);
    const topologyHydrated = studioCrdtElementToSceneElement(
      { ...topologyEncoded, orderIndex: 0, deleted: false },
      topologyLocal
    ) as Record<string, unknown>;
    expect(topologyHydrated.borderEffect).toEqual(staleEffects.borderEffect);
    expect(topologyHydrated.src).toBe("blob:local-body");
  });

  it("clears envelope-absent reference edits through scene-graph reconciliation over the descriptor fallback", () => {
    const canonicalSource = "work-asset://image/effect-clear-2";
    const staleEffects = {
      borderEffect: {
        enabled: true, thickness: 3, color: "#ff0000", type: "outer" as const, antiAliased: false,
      },
      blur: 12,
      grayscale: true,
    };
    type EffectElement = StudioCrdtCompatibleElement & Record<string, unknown>;
    const staleLocal: EffectElement = {
      id: "effect-clear-2",
      type: "image",
      src: canonicalSource,
      x: 24,
      y: 48,
      width: 400,
      height: 300,
      rotation: 0,
      decodedWidth: 800,
      ...structuredClone(staleEffects),
    };
    // The immutable upload-time descriptor may also still carry the removed effects; the realtime
    // envelope must win over both merge inputs ({...descriptor, ...local} feeds the hydrator).
    const descriptorFallback: EffectElement = {
      id: "effect-clear-2",
      type: "image",
      src: canonicalSource,
      x: 1,
      y: 2,
      width: 400,
      height: 300,
      rotation: 0,
      ...structuredClone(staleEffects),
    };
    const encoded = studioElementToCrdtSceneElement("page-a", {
      id: "effect-clear-2",
      type: "image",
      src: canonicalSource,
      x: 140,
      y: 60,
      width: 400,
      height: 300,
      rotation: 0,
    } as EffectElement);
    const record = { ...encoded, orderIndex: 0, deleted: false };

    const reconciled = reconcileStudioCrdtSceneGraphPages(
      [{
        id: "page-a",
        bg: "#fff",
        bgGrad: null,
        canvasH: 1_600,
        elements: [structuredClone(staleLocal)],
      }],
      [],
      [record],
      [],
      [],
      undefined,
      new Map([["effect-clear-2", descriptorFallback]])
    );
    const element = reconciled.pages[0]?.elements[0] as Record<string, unknown> | undefined;
    expect(element).toBeDefined();
    for (const key of Object.keys(staleEffects)) {
      expect(element).not.toHaveProperty(key);
    }
    expect(element).toMatchObject({
      id: "effect-clear-2",
      src: canonicalSource,
      x: 140,
      y: 60,
      decodedWidth: 800,
    });
  });

  it("round-trips the complete drawing metadata and aligns legacy pointer arrays", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-a",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.75],
      pressureModel: "linear-full-v1",
      stroke: "#abcdef",
      strokeWidth: 12,
      opacity: 0.6,
      brush: "calligraphy",
      brushTip: { tiltEnabled: true, angleDeg: 45, roundness: 0.7 },
      stamp: { flow: 0.4, hardness: 0.9, minSize: 0.2 },
      stampPipeline: "causal-walker-v2",
      symmetry: { type: "vertical", centerX: 400, centerY: 600 },
      groupId: "inks",
      hidden: true,
      layerColor: "blue",
      emeresSourceId: "custom:underlay-a",
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.layerId).toBe("inks");
    expect(encoded.payload.pressures).toEqual([0.75, 1]);
    expect(encoded.payload.extensions).toMatchObject({
      groupId: "inks",
      hidden: true,
      layerColor: "blue",
      emeresSourceId: "custom:underlay-a",
      stamp: { flow: 0.4, hardness: 0.9, minSize: 0.2 },
      stampPipeline: "causal-walker-v2",
      pressureModel: "linear-full-v1",
    });
    expect(encoded.payload.version).toBe(1);
    expect(encoded.payload.extensions?.paintModel).toBeUndefined();

    const decoded = studioCrdtStrokeToDrawElement({
      ...record("stroke-a", "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded).toMatchObject({
      id: "stroke-a",
      groupId: "inks",
      hidden: true,
      brush: "calligraphy",
      opacity: 0.6,
      pressureModel: "linear-full-v1",
      emeresSourceId: "custom:underlay-a",
      stamp: { flow: 0.4, hardness: 0.9, minSize: 0.2 },
      stampPipeline: "causal-walker-v2",
    });
    expect(decoded.paintModel).toBeUndefined();
  });

  it("round-trips v2 authoritative Pointer Events channels without upgrading v1", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-input-v2",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.4, 0.8],
      stroke: "#123456",
      strokeWidth: 6,
      inkInput: captureStudioInkInputContractV2("pen"),
      altitudeAngles: [0.7, 0.5],
      azimuthAngles: [1.1, 2.2],
      contactWidths: [3, 4],
      contactHeights: [2, 2.5],
      sampleTimeOffsets: [0, 8.5],
    };
    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    const decoded = studioCrdtStrokeToDrawElement({
      ...encoded,
      status: "finalized",
      deleted: false,
      orderIndex: 0,
    });

    expect(encoded.payload.extensions?.inkInput).toEqual(element.inkInput);
    expect(decoded).toMatchObject({
      inkInput: { version: 2 },
      altitudeAngles: [0.7, 0.5],
      azimuthAngles: [1.1, 2.2],
      contactWidths: [3, 4],
      contactHeights: [2, 2.5],
      sampleTimeOffsets: [0, 8.5],
    });

    const legacy = studioDrawElementToCrdtStroke("page-a", {
      ...element,
      id: "stroke-input-v1",
      inkInput: captureStudioInkInputContractV1("pen"),
      altitudeAngles: undefined,
      azimuthAngles: undefined,
      contactWidths: undefined,
      contactHeights: undefined,
      sampleTimeOffsets: undefined,
    });
    expect(legacy.payload.extensions?.inkInput).toMatchObject({ version: 1 });
    expect(legacy.payload.altitudeAngles).toBeUndefined();
    expect(legacy.payload.sampleTimeOffsets).toBeUndefined();
  });

  it("fails closed on missing, unaligned, out-of-range or regressing v2 sensor arrays", () => {
    const base: StudioCrdtCompatibleDrawElement = {
      id: "stroke-input-invalid",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.4, 0.8],
      stroke: "#123456",
      strokeWidth: 6,
      inkInput: captureStudioInkInputContractV2("pen"),
      altitudeAngles: [0.7, 0.5],
      azimuthAngles: [1.1, 2.2],
      contactWidths: [3, 4],
      contactHeights: [2, 2.5],
      sampleTimeOffsets: [0, 8.5],
    };
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...base,
      altitudeAngles: undefined,
    })).toThrow("altitudeAngles 채널이 획 좌표와 정렬되지 않았습니다");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...base,
      contactWidths: [3, 70_000],
    })).toThrow("contactWidths 채널 범위가 올바르지 않습니다");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...base,
      sampleTimeOffsets: [4, 3],
    })).toThrow("포인터 시작의 0ms");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...base,
      sampleTimeOffsets: [0, -1],
    })).toThrow("sampleTimeOffsets 채널 범위가 올바르지 않습니다");
  });

  it("round-trips normalized catalog identity without changing the canonical render brush", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "catalog-stroke",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [0.5, 0.8],
      stroke: "#334455",
      strokeWidth: 14,
      brush: "dry-media",
      brushCatalogId: "  pro67:chalk-rough\u0000 ",
      brushCatalogName: "\n 거친 초크 \t",
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload).toMatchObject({
      version: 1,
      brush: "dry-media",
      brushCatalogId: "pro67:chalk-rough",
      brushCatalogName: "거친 초크",
    });

    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded).toMatchObject({
      brush: "dry-media",
      brushCatalogId: "pro67:chalk-rough",
      brushCatalogName: "거친 초크",
    });

    const legacy = studioCrdtStrokeToDrawElement(record("legacy-catalog", "page-a", 1));
    expect(legacy.brushCatalogId).toBeUndefined();
    expect(legacy.brushCatalogName).toBeUndefined();
  });

  it("round-trips layered-flow only for compatible ordinary pen and marker strokes", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-layered-marker",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 3, 4],
      pressures: [1, 1],
      paintModel: "layered-flow-v1",
      stroke: "rgba(20, 40, 80, 0.5)",
      strokeWidth: 18,
      opacity: 0.6,
      brush: "marker",
      sampleSpacing: 0,
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload).toMatchObject({
      version: STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      opacity: 0.6,
      brush: "marker",
      extensions: { paintModel: "layered-flow-v1" },
    });

    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded.paintModel).toBe("layered-flow-v1");
    expect(decoded.stroke).toBe(element.stroke);

    const decodedV3 = studioCrdtStrokeToDrawElement({
      ...record(`${element.id}-v3`, "page-a", 1),
      ...encoded,
      id: `${element.id}-v3`,
      payload: {
        ...encoded.payload,
        version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      },
      orderIndex: 1,
      status: "finalized",
      deleted: false,
    });
    expect(decodedV3.paintModel).toBe("layered-flow-v1");
  });

  it("round-trips bounded-flow-v2 only with its snapshotted dynamic brush contract", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round" },
      grain: { amount: 0.4, scale: 8 },
      taper: { enabled: false },
      flow: { base: 0.35, mappings: [] },
    });
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-bounded-airbrush",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 12, 8],
      pressures: [0.5, 0.8],
      paintModel: "bounded-flow-v2",
      stroke: "#285080",
      strokeWidth: 24,
      opacity: 0.55,
      brush: "airbrush",
      brushDynamics,
      sampleSpacing: 0.5,
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(studioDrawElementToCrdtStroke("page-a", element)).toEqual(encoded);
    expect(encoded.payload).toMatchObject({
      version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      brush: "airbrush",
      brushDynamics,
      extensions: { paintModel: "bounded-flow-v2" },
    });
    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded).toMatchObject({
      brush: "airbrush",
      brushDynamics,
      paintModel: "bounded-flow-v2",
    });

    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      id: "stroke-bounded-missing-dynamics",
      brushDynamics: undefined,
    })).toThrow(/페인트 모델과 브러시 합성 모드가 호환되지/u);
  });

  it("writes segmented causal-deposit dynamics only as payload v4", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      tip: { shape: "grain" },
      grain: { amount: 0.55, scale: 6 },
      taper: { enabled: false },
      flow: { base: 0.42, mappings: [] },
    });
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-segmented-dry-media",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 12, 8],
      pressures: [0.5, 0.8],
      paintModel: "bounded-flow-v2",
      stroke: "#285080",
      strokeWidth: 24,
      opacity: 0.55,
      brush: "dry-media",
      brushDynamics,
      sampleSpacing: 0.25,
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload).toMatchObject({
      version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
      brushDynamics: {
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      },
      extensions: { paintModel: "bounded-flow-v2" },
    });
    expect(studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    })).toMatchObject({
      brushDynamics: {
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      },
      paintModel: "bounded-flow-v2",
    });

    for (const legacyVersion of [
      STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => studioCrdtStrokeToDrawElement({
        ...record(`${element.id}-v${legacyVersion}`, "page-a", 0),
        ...encoded,
        id: `${element.id}-v${legacyVersion}`,
        payload: { ...encoded.payload, version: legacyVersion },
        orderIndex: 0,
        status: "finalized",
        deleted: false,
      })).toThrow("분할 연속 브러시 파이프라인과 페이로드 버전이 호환되지 않습니다");
    }
  });

  it("writes strict content-addressed R8 grain only as payload v4", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      grain: {
        amount: 0.7,
        scale: 64,
        source: r8GrainSource(),
      },
    });
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-r8-paper-grain",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1, 2, 12, 8],
      pressures: [0.5, 0.8],
      stroke: "#285080",
      strokeWidth: 24,
      brush: "dry-media",
      brushDynamics,
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload).toMatchObject({
      version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
      brushDynamics: {
        grain: { source: r8GrainSource() },
      },
    });
    expect(studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    })).toMatchObject({
      brushDynamics: {
        grain: { source: r8GrainSource() },
      },
    });

    for (const legacyVersion of [
      STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => studioCrdtStrokeToDrawElement({
        ...record(`${element.id}-v${legacyVersion}`, "page-a", 0),
        ...encoded,
        id: `${element.id}-v${legacyVersion}`,
        payload: { ...encoded.payload, version: legacyVersion },
        orderIndex: 0,
        status: "finalized",
        deleted: false,
      })).toThrow("R8 브러시 그레인과 페이로드 버전이 호환되지 않습니다");
    }

    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      id: "stroke-malformed-r8-paper-grain",
      brushDynamics: {
        grain: {
          amount: 0.7,
          source: {
            ...r8GrainSource(),
            asset: { ...r8GrainSource().asset, decodedSha256: "sha256:bad" },
          },
        },
      },
    })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    for (const invalidSource of [
      { kind: "r8-texture-v2", asset: r8GrainSource().asset },
      "r8-texture-v1",
    ]) {
      expect(() => studioDrawElementToCrdtStroke("page-a", {
        ...element,
        id: `stroke-invalid-r8-source-${typeof invalidSource}`,
        brushDynamics: {
          grain: { amount: 0.7, source: invalidSource },
        },
      })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    }
    let sourceAccessorReads = 0;
    const accessorGrain: Record<string, unknown> = { amount: 0.7 };
    Object.defineProperty(accessorGrain, "source", {
      enumerable: true,
      get() {
        sourceAccessorReads += 1;
        return r8GrainSource();
      },
    });
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      id: "stroke-r8-source-accessor",
      brushDynamics: { grain: accessorGrain },
    })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    expect(sourceAccessorReads).toBe(0);
  });

  it("round-trips the causal watercolor pipeline as an explicit CRDT extension", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "watercolor-v2",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 12, 4, 24, 0],
      pressures: [0.2, 0.6, 0.9],
      stroke: "#315f73",
      strokeWidth: 24,
      brush: "watercolor",
      watercolorPipeline: "causal-walker-v2",
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload.extensions).toEqual({
      watercolorPipeline: "causal-walker-v2",
    });

    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded).toMatchObject({
      id: element.id,
      brush: "watercolor",
      points: element.points,
      pressures: element.pressures,
      watercolorPipeline: "causal-walker-v2",
    });
  });

  it("round-trips only complete v3 material pressure snapshots", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "neon-pressure-v1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 12, 4],
      pressures: [0.5, 0.9],
      stroke: "#39ff14",
      strokeWidth: 18,
      brush: "neon",
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      materialMinimumDiameterRatio: 0.73,
    };
    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload.version).toBe(STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION);
    expect(encoded.payload.extensions?.materialPressureModel).toBe(
      STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    );
    expect(encoded.payload.extensions?.materialMinimumDiameterRatio).toBe(0.73);
    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded.materialPressureModel).toBe(
      STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    );
    expect(decoded.materialMinimumDiameterRatio).toBe(0.73);

    expect(() => studioCrdtStrokeToDrawElement(record("future-fx", "page-a", 0, {
      payload: {
        ...record("future-fx", "page-a", 0).payload,
        version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
        brush: "neon",
        extensions: {
          materialPressureModel: "canonical-material-v99",
          materialMinimumDiameterRatio: 0.73,
        },
      },
    }))).toThrow("재질 필압 모델이 올바르지 않습니다");

    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      materialMinimumDiameterRatio: 1.01,
    })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      materialMinimumDiameterRatio: undefined,
    })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
    expect(() => studioDrawElementToCrdtStroke("page-a", {
      ...element,
      materialPressureModel: undefined,
    })).toThrow("재질 필압 모델이 올바르지 않습니다");
    expect(() => studioCrdtStrokeToDrawElement({
      ...record("forged-model-only", "page-a", 0),
      payload: {
        ...encoded.payload,
        extensions: {
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        },
      },
      status: "finalized",
      deleted: false,
      orderIndex: 0,
    })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
    expect(() => studioCrdtStrokeToDrawElement({
      ...record("forged-minimum-only", "page-a", 0),
      payload: {
        ...encoded.payload,
        extensions: { materialMinimumDiameterRatio: 0.73 },
      },
      status: "finalized",
      deleted: false,
      orderIndex: 0,
    })).toThrow("재질 필압 모델이 올바르지 않습니다");
    for (const legacyVersion of [
      STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => studioCrdtStrokeToDrawElement({
        ...record(`forged-material-v${legacyVersion}`, "page-a", 0),
        payload: { ...encoded.payload, version: legacyVersion },
        status: "finalized",
        deleted: false,
        orderIndex: 0,
      })).toThrow("재질 필압 모델과 페이로드 버전이 호환되지 않습니다");
    }
    expect(() => studioCrdtStrokeToDrawElement({
      ...record("forged-minimum", "page-a", 0),
      payload: {
        ...record("forged-minimum", "page-a", 0).payload,
        version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
        brush: "neon",
        extensions: {
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          materialMinimumDiameterRatio: -0.1,
        },
      },
    })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
  });

  it("preserves omitted legacy pressure semantics and ignores unknown pressure models", () => {
    const legacy: StudioCrdtCompatibleDrawElement = {
      id: "stroke-legacy-pressure",
      type: "draw",
      points: [0, 0],
      pressures: [0.5],
      stroke: "#000000",
      strokeWidth: 8,
    };

    const encodedLegacy = studioDrawElementToCrdtStroke("page-a", legacy);
    expect(encodedLegacy.payload.extensions).toBeUndefined();
    const decodedLegacy = studioCrdtStrokeToDrawElement({
      ...record("stroke-legacy-pressure", "page-a", 0),
      ...encodedLegacy,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decodedLegacy.pressureModel).toBeUndefined();
    expect("pressureModel" in decodedLegacy).toBe(false);
    expect(decodedLegacy.paintModel).toBeUndefined();
    expect("paintModel" in decodedLegacy).toBe(false);
    expect(decodedLegacy.stampPipeline).toBeUndefined();
    expect("stampPipeline" in decodedLegacy).toBe(false);
    expect(decodedLegacy.watercolorPipeline).toBeUndefined();
    expect("watercolorPipeline" in decodedLegacy).toBe(false);

    const encodedUnknown = studioDrawElementToCrdtStroke("page-a", {
      ...legacy,
      id: "stroke-unknown-pressure-write",
      pressureModel: "future-pressure-v2",
    } as unknown as StudioCrdtCompatibleDrawElement);
    expect(encodedUnknown.payload.extensions).toBeUndefined();

    const decodedUnknown = studioCrdtStrokeToDrawElement(record(
      "stroke-unknown-pressure-read",
      "page-a",
      0,
      {
        payload: {
          ...record("source", "page-a", 0).payload,
          extensions: { pressureModel: "future-pressure-v2" },
        },
      }
    ));
    expect(decodedUnknown.pressureModel).toBeUndefined();
    expect("pressureModel" in decodedUnknown).toBe(false);

    const encodedUnknownPaint = studioDrawElementToCrdtStroke("page-a", {
      ...legacy,
      id: "stroke-unknown-paint-write",
      paintModel: "layered-flow-v2",
    } as unknown as StudioCrdtCompatibleDrawElement);
    expect(encodedUnknownPaint.payload.extensions).toBeUndefined();

    const decodedUnknownPaint = studioCrdtStrokeToDrawElement(record(
      "stroke-unknown-paint-read",
      "page-a",
      0,
      {
        payload: {
          ...record("paint-source", "page-a", 0).payload,
          extensions: { paintModel: "layered-flow-v2" },
        },
      }
    ));
    expect(decodedUnknownPaint.paintModel).toBeUndefined();
    expect("paintModel" in decodedUnknownPaint).toBe(false);

    const decodedLegacyPaint = studioCrdtStrokeToDrawElement(record(
      "stroke-legacy-paint-read",
      "page-a",
      0,
      {
        payload: {
          ...record("legacy-paint-source", "page-a", 0).payload,
          version: 1,
          brush: "marker",
          opacity: 0.6,
          extensions: { paintModel: "layered-flow-v1" },
        },
      }
    ));
    expect(decodedLegacyPaint.paintModel).toBeUndefined();

    const decodedIncompatiblePaint = studioCrdtStrokeToDrawElement(record(
      "stroke-incompatible-paint-read",
      "page-a",
      0,
      {
        payload: {
          ...record("incompatible-paint-source", "page-a", 0).payload,
          version: 2,
          mode: "eraser",
          brush: "marker",
          opacity: 0.6,
          extensions: { paintModel: "layered-flow-v1" },
        },
      }
    ));
    expect(decodedIncompatiblePaint.paintModel).toBeUndefined();
  });

  it("round-trips the residual V2 ink contract as an explicit CRDT extension", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-residual-v2",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 4, 0, 8, 0],
      pressures: [0],
      pressureModel: "linear-residual-v2",
      sampleSpacing: 0,
      stroke: "#123456",
      strokeWidth: 16,
    };
    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload.extensions?.pressureModel).toBe("linear-residual-v2");
    expect(encoded.payload.sampleSpacing).toBe(0);
    expect(encoded.payload.pressures).toEqual([0, 1, 1]);

    const decoded = studioCrdtStrokeToDrawElement({
      ...record("stroke-residual-v2", "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded.pressureModel).toBe("linear-residual-v2");
    expect(decoded.sampleSpacing).toBe(0);
    expect(decoded.pressures).toEqual([0, 1, 1]);
  });

  it("round-trips V3 path-phase ink without upgrading or weakening its model", () => {
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-residual-path-v3",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 9, 0, 9, 0, 10, 0],
      pressures: [1, 1, 0, 0],
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
      stroke: "#123456",
      strokeWidth: 50,
    };
    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload.extensions?.pressureModel).toBe("linear-residual-path-v3");
    expect(encoded.payload.pressures).toEqual([1, 1, 0, 0]);

    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded.pressureModel).toBe("linear-residual-path-v3");
    expect(decoded.sampleSpacing).toBe(0);
    expect(decoded.pressures).toEqual([1, 1, 0, 0]);
  });

  it("round-trips the renderer-significant outline snapshot only through the current payload", () => {
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    });
    expect(outlineStroke).not.toBeNull();
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-outline-v1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 12, 4, 24, 0],
      pressures: [0.2, 0.7, 0.4],
      stroke: "#111827",
      strokeWidth: 9,
      brush: "gpen",
      outlineStroke: outlineStroke!,
    };

    const encoded = studioDrawElementToCrdtStroke("page-a", element);
    expect(encoded.payload.version).toBe(STUDIO_CRDT_STROKE_PAYLOAD_VERSION);
    expect(encoded.payload.extensions?.outlineStroke).toEqual(outlineStroke);

    const decoded = studioCrdtStrokeToDrawElement({
      ...record(element.id, "page-a", 0),
      ...encoded,
      orderIndex: 0,
      status: "finalized",
      deleted: false,
    });
    expect(decoded.outlineStroke).toEqual(outlineStroke);
    expect(decoded.outlineStroke).not.toBe(outlineStroke);
    expect(Object.isFrozen(decoded.outlineStroke)).toBe(true);
  });

  it("rejects unknown outline renderer contracts instead of degrading them to legacy geometry", () => {
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    })!;
    const futureContract: StudioCrdtJsonObject = {
      ...outlineStroke,
      version: 2,
      profile: { ...outlineStroke.profile },
    };
    expect(() => studioCrdtStrokeToDrawElement(record(
      "stroke-future-outline",
      "page-a",
      0,
      {
        payload: {
          ...record("future-outline-source", "page-a", 0).payload,
          version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
          extensions: { outlineStroke: futureContract },
        },
      },
    ))).toThrow(/외곽선/u);
  });

  it("streams explicit-model fallback pressure through begin and append while legacy stays 0.5", () => {
    const document = new StudioCrdtDocument();
    const residual: StudioCrdtCompatibleDrawElement = {
      id: "stroke-residual-stream",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0],
      pressures: undefined,
      pressureModel: "linear-residual-v2",
      sampleSpacing: 0,
      stroke: "#123456",
      strokeWidth: 16,
    };
    const legacy: StudioCrdtCompatibleDrawElement = {
      ...residual,
      id: "stroke-legacy-stream",
      pressureModel: undefined,
    };

    document.beginStroke(studioDrawElementToCrdtStroke("page-a", residual));
    document.appendStrokeSamples(
      residual.id,
      studioDrawElementSampleSlice({ ...residual, points: [0, 0, 4, 0, 8, 0] }, 1)!
    );
    document.finalizeStroke(residual.id);

    document.beginStroke(studioDrawElementToCrdtStroke("page-a", legacy));
    document.appendStrokeSamples(
      legacy.id,
      studioDrawElementSampleSlice({ ...legacy, points: [0, 0, 4, 0, 8, 0] }, 1)!
    );
    document.finalizeStroke(legacy.id);

    expect(document.getStroke(residual.id)?.payload.pressures).toEqual([1, 1, 1]);
    expect(document.getStroke(legacy.id)?.payload.pressures).toEqual([0.5, 0.5, 0.5]);
    document.destroy();
  });

  it("aligns only the requested streaming suffix and never reads prior dynamics", () => {
    const accessedIndices: number[] = [];
    const pressures = new Proxy([0.1, 0.2, 0.3, 0.8, 0.9], {
      get(target, key, receiver) {
        const index = typeof key === "string" ? Number(key) : Number.NaN;
        if (Number.isInteger(index)) {
          if (index < 3) throw new Error("streaming suffix read historical pressure data");
          accessedIndices.push(index);
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-stream",
      type: "draw",
      points: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
      pressures,
      stroke: "#000000",
      strokeWidth: 4,
    };

    expect(studioDrawElementSampleSlice(element, 3)).toEqual({
      points: [3, 3, 4, 4],
      pressures: [0.8, 0.9],
      tiltXs: undefined,
      tiltYs: undefined,
      twists: undefined,
      speeds: undefined,
      tangentialPressures: undefined,
    });
    expect(accessedIndices).toEqual([3, 4]);
  });

  it("fills sparse, missing, and non-finite dynamics inside the requested suffix", () => {
    const tiltXs = [11, 12] as number[];
    tiltXs[3] = 33;
    const element: StudioCrdtCompatibleDrawElement = {
      id: "stroke-sparse",
      type: "draw",
      points: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
      pressures: [0.1, 0.2, Number.NaN, 0.8],
      tiltXs,
      twists: [1, 2, Number.POSITIVE_INFINITY, 4, 5],
      stroke: "#000000",
      strokeWidth: 4,
    };

    expect(studioDrawElementSampleSlice(element, 2)).toEqual({
      points: [2, 2, 3, 3, 4, 4],
      pressures: [0.5, 0.8, 0.5],
      tiltXs: [0, 33, 0],
      tiltYs: undefined,
      twists: [0, 4, 5],
      speeds: undefined,
      tangentialPressures: undefined,
    });
  });

  it("reconciles only CRDT-owned IDs and keeps deterministic stroke order in existing slots", () => {
    const pages = [{
      id: "page-a",
      title: "kept",
      elements: [
        { id: "background", type: "image", src: "data:image/png;base64,AA==" },
        { id: "stroke-b", type: "draw", points: [], stroke: "#000", strokeWidth: 1 },
        { id: "lettering", type: "text", text: "hello" },
        { id: "stroke-a", type: "draw", points: [], stroke: "#000", strokeWidth: 1 },
      ],
    }];

    const result = reconcileStudioCrdtPages(pages, [
      record("stroke-a", "page-a", 0),
      record("stroke-b", "page-a", 1),
      record("stroke-c", "page-a", 2),
    ]);

    expect(result.changed).toBe(true);
    expect(result.pages[0]?.title).toBe("kept");
    expect(result.pages[0]?.elements.map((element) => element.id)).toEqual([
      "background",
      "stroke-a",
      "lettering",
      "stroke-b",
      "stroke-c",
    ]);
  });

  it("removes tombstoned strokes without touching legacy drawing IDs", () => {
    const pages = [{
      id: "page-a",
      elements: [
        { id: "legacy", type: "draw", points: [0, 0], stroke: "#000", strokeWidth: 1 },
        { id: "deleted", type: "draw", points: [1, 1], stroke: "#000", strokeWidth: 1 },
      ],
    }];
    const result = reconcileStudioCrdtPages(pages, [
      record("deleted", "page-a", 0, { deleted: true }),
    ]);

    expect(result.pages[0]?.elements.map((element) => element.id)).toEqual(["legacy"]);
  });

  it("round-trips explicitly supported text and bubble fields without accepting raster payloads", () => {
    const text: StudioCrdtCompatibleSceneElement = {
      id: "text-a",
      type: "text",
      text: "세로 대사\n둘째 줄",
      x: 30,
      y: 40,
      width: 260,
      fontSize: 32,
      fill: "#222222",
      rotation: 5,
      fontStyle: "bold",
      gradient: { type: "linear", angle: 90, stops: [] },
      groupId: "lettering",
      hidden: true,
    };
    const encoded = studioSceneElementToCrdtElement("page-a", text);
    const decoded = studioCrdtElementToSceneElement({
      ...sceneRecord("text-a", "page-a", 0),
      ...encoded,
      orderIndex: 0,
      deleted: false,
    });
    expect(decoded).toMatchObject(text);

    const bubble = studioSceneElementToCrdtElement("page-a", {
      id: "bubble-a",
      type: "bubble",
      variant: "cloud",
      text: "동시 편집",
      x: 100,
      y: 120,
      width: 300,
      height: 180,
      fill: "#fff",
      textFill: "#000",
      rotation: 0,
      tailAnchorPoint: { x: 450, y: 500 },
      customShapePoints: [0, 0, 300, 0, 300, 180],
    });
    expect(bubble.payload.type).toBe("bubble");
    expect(bubble.payload.props.tailAnchorPoint).toEqual({ x: 450, y: 500 });
    expect(() => studioSceneElementToCrdtElement("page-a", {
      ...text,
      id: "bad-raster",
      src: "data:image/png;base64,AA==",
    })).toThrow("src 속성은 동기화할 수 없습니다");
  });

  it("uses the shared draw/scene order for deterministic mixed z-order while preserving legacy slots", () => {
    const pages = [{
      id: "page-a",
      bg: "#fff",
      bgGrad: null,
      canvasH: 1600,
      elements: [
        { id: "legacy-image", type: "image", src: "asset:background" },
        { id: "ink", type: "draw", points: [], stroke: "#000", strokeWidth: 1 },
        { id: "caption", type: "text", text: "old" },
      ],
    }];

    const result = reconcileStudioCrdtSceneGraphPages(
      pages,
      [record("ink", "page-a", 4)],
      [sceneRecord("caption", "page-a", 2)],
      []
    );

    expect(result.pages[0]?.elements.map((element) => element.id)).toEqual([
      "legacy-image",
      "caption",
      "ink",
    ]);
    expect(result.pages[0]?.elements[1]).toMatchObject({ type: "text", text: "대사" });
  });

  it("materializes authoritative page payloads, deterministic order, creation and tombstones", () => {
    const pages = [
      {
        id: "page-a", bg: "#aaa", bgGrad: null, canvasH: 1200,
        elements: [{ id: "a-text", type: "text", text: "A" }], future: "preserve-a",
      },
      {
        id: "legacy-page", bg: "#ccc", bgGrad: null, canvasH: 1400,
        elements: [{ id: "legacy-text", type: "text", text: "legacy" }],
      },
      {
        id: "page-b", bg: "#bbb", bgGrad: null, canvasH: 1300,
        elements: [{ id: "b-text", type: "text", text: "B" }], future: "preserve-b",
      },
    ];
    const result = reconcileStudioCrdtSceneGraphPages(
      pages,
      [],
      [],
      [
        pageRecord("page-b", 0, { payload: { version: 1, props: {
          bg: "#0b0b0b", bgGrad: null, canvasH: 2000, name: "이동한 B",
        } } }),
        pageRecord("page-c", 1, { payload: { version: 1, props: {
          bg: "#ffffff", bgGrad: ["#fff", "#eee"], canvasH: 1800, name: "새 C",
        } } }),
        pageRecord("page-a", 2, { deleted: true }),
      ]
    );

    expect(result.pages.map((page) => page.id)).toEqual(["page-b", "legacy-page", "page-c"]);
    expect(result.pages[0]).toMatchObject({
      id: "page-b", bg: "#0b0b0b", canvasH: 2000, future: "preserve-b",
    });
    expect(result.pages[0]?.elements.map((element) => element.id)).toEqual(["b-text"]);
    expect(result.pages[2]).toMatchObject({ id: "page-c", elements: [], name: "새 C" });

    expect(studioPageToCrdtPage(result.pages[0]!)).toMatchObject({
      id: "page-b",
      payload: { props: { bg: "#0b0b0b", canvasH: 2000, name: "이동한 B" } },
    });
  });

  it("round-trips a detached paper surface and grain visibility through page reconciliation", () => {
    const paperSurface = { kind: "washi" as const, seed: 4_294_967_295 };
    const page = {
      id: "page-paper",
      bg: "#f7f1e7",
      bgGrad: null,
      canvasH: 1_600,
      elements: [] as Array<{ id: string; type: string }>,
      paperSurface,
      paperGrainVisible: false,
    };
    const encoded = studioPageToCrdtPage(page);

    expect(encoded.payload.props).toMatchObject({
      paperSurface: { kind: "washi", seed: 4_294_967_295 },
      paperGrainVisible: false,
    });
    paperSurface.seed = 7;
    expect(encoded.payload.props.paperSurface).toEqual({
      kind: "washi",
      seed: 4_294_967_295,
    });

    const reconciled = reconcileStudioCrdtSceneGraphPages(
      [page],
      [],
      [],
      [{
        id: page.id,
        deleted: false,
        orderIndex: 0,
        payload: encoded.payload,
      }]
    );
    expect(reconciled.pages[0]).toMatchObject({
      paperSurface: { kind: "washi", seed: 4_294_967_295 },
      paperGrainVisible: false,
    });
  });

  it("round-trips a canonical, detached page-owned drawing-assist v2 document", () => {
    const drawingAssist = createDefaultStudioDrawingAssistDocument({
      canvasWidth: 800,
      canvasHeight: 1_600,
    });
    drawingAssist.perspective = {
      active: false,
      points: [
        { id: "vp-left", x: -900, y: 520 },
        { id: "vp-right", x: 1_700, y: 520 },
      ],
      eyeLevelY: 520,
      lockHorizon: true,
    };
    drawingAssist.advanced.rulers.push({
      id: "curve-a",
      type: "curve",
      name: "배경 곡선",
      enabled: true,
      visible: true,
      scope: { kind: "group", groupId: "background" },
      snapMode: "through-start",
      fixedOffset: 0,
      p0: { x: 10, y: 20 },
      p1: { x: 100, y: 0 },
      p2: { x: 200, y: 300 },
      p3: { x: 400, y: 500 },
    });
    drawingAssist.advanced.activeSnapRulerId = "curve-a";
    drawingAssist.advanced.selectedRulerId = "curve-a";
    const canonicalDrawingAssist = structuredClone(drawingAssist);
    const page = {
      id: "page-guides",
      bg: "#fff",
      bgGrad: null,
      canvasH: 1_600,
      elements: [] as Array<{ id: string; type: string }>,
      drawingAssist,
    };
    const encoded = studioPageToCrdtPage(page);
    expect(encoded.payload.props.drawingAssist).toEqual(canonicalDrawingAssist);
    drawingAssist.advanced.rulers[0]!.name = "mutated after encoding";
    expect(encoded.payload.props.drawingAssist).toEqual(canonicalDrawingAssist);

    const reconciled = reconcileStudioCrdtSceneGraphPages(
      [page],
      [],
      [],
      [{
        id: page.id,
        deleted: false,
        orderIndex: 0,
        payload: encoded.payload,
      }]
    );
    expect(reconciled.pages[0]?.drawingAssist).toEqual(canonicalDrawingAssist);
  });

  it("rejects an otherwise valid advanced-ruler page when the total payload exceeds 8 KiB", () => {
    const drawingAssist = createDefaultStudioDrawingAssistDocument({
      canvasWidth: 800,
      canvasHeight: 1_600,
    });
    drawingAssist.advanced.rulers = Array.from({ length: 6 }, (_, index) => ({
      id: `curve-${index}-${"x".repeat(140)}`,
      type: "curve" as const,
      name: "곡".repeat(80),
      enabled: true,
      visible: true,
      scope: { kind: "page" as const, groupId: null },
      snapMode: "on-curve" as const,
      fixedOffset: 0,
      p0: { x: 0, y: index },
      p1: { x: 100, y: index + 20 },
      p2: { x: 200, y: index + 20 },
      p3: { x: 300, y: index },
    }));
    expect(parseStudioAdvancedRulerDocument(drawingAssist.advanced)).not.toBeNull();

    expect(() => studioPageToCrdtPage({
      id: "oversized-guides",
      bg: "#fff",
      bgGrad: null,
      canvasH: 1_600,
      note: "가".repeat(2_000),
      elements: [] as Array<{ id: string; type: string }>,
      drawingAssist,
    })).toThrow(/8KiB/u);
  });
});
