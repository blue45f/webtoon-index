import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
  DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
  DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
  DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
} from "../studio-advanced-blur-filter-kernels";
import { STUDIO_CURVE_MAX_CONTROL_POINTS } from "../studio-curves";

import {
  STUDIO_CRDT_MAX_RUBY_READING_LENGTH,
  STUDIO_CRDT_MAX_RUBY_SPANS,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
  isStudioCrdtImageAuxiliaryReferencePayload,
  isStudioCrdtTopologyReferencePayload,
  validateStudioCrdtPagePayload,
  validateStudioCrdtSceneElementPayload,
  type StudioCrdtJsonObject,
  type StudioCrdtJsonValue,
} from "./studio-crdt-scene-schema";

import { STUDIO_WORK_ASSET_MAX_CURVE_POINTS } from "@/shared/lib/studio-work-asset-contract";

const FILTER_MASK_SURFACE_ID =
  "filter-mask:v1:10000000-0000-4000-8000-000000000001";

function imageReferenceProps(overrides: StudioCrdtJsonObject = {}): StudioCrdtJsonObject {
  return {
    elementType: "image",
    x: 10,
    y: 20,
    width: 300,
    height: 400,
    rotation: 0,
    ...overrides,
  };
}

function validateReference(props: StudioCrdtJsonObject) {
  return validateStudioCrdtSceneElementPayload({
    version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
    type: "reference",
    props,
  });
}

function validatePage(overrides: StudioCrdtJsonObject = {}) {
  return validateStudioCrdtPagePayload({
    version: STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
    props: {
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 1_600,
      ...overrides,
    },
  });
}

describe("studio CRDT paper surface page payload", () => {
  it("accepts the exact paper surface and grain visibility contract", () => {
    expect(validatePage({
      paperSurface: { kind: "washi", seed: 0xffff_ffff },
      paperGrainVisible: false,
    }).props).toMatchObject({
      paperSurface: { kind: "washi", seed: 0xffff_ffff },
      paperGrainVisible: false,
    });
  });

  it("rejects malformed paper surfaces and a non-boolean visibility flag", () => {
    const invalidSurfaces: StudioCrdtJsonValue[] = [
      null,
      { kind: "papyrus", seed: 41 },
      { kind: "rough" },
      { kind: "rough", seed: 41, privateNote: "smuggled" },
      { kind: "rough", seed: -1 },
      { kind: "rough", seed: 1.5 },
      { kind: "rough", seed: 0x1_0000_0000 },
      { kind: "rough", seed: "41" },
    ];
    for (const paperSurface of invalidSurfaces) {
      expect(() => validatePage({ paperSurface })).toThrow(/종이 표면/u);
    }
    expect(() => validatePage({ paperGrainVisible: "false" })).toThrow(/종이 결 표시/u);
  });
});

describe("studio CRDT structured work-asset filters", () => {
  it("keeps the authoring and shared persistence curve ceilings aligned", () => {
    expect(STUDIO_CURVE_MAX_CONTROL_POINTS).toBe(STUDIO_WORK_ASSET_MAX_CURVE_POINTS);
  });

  it("validates and detaches exact blur, curves, and smart-filter programs", () => {
    const curve = [{ x: 0, y: 4 }, { x: 128, y: 144 }, { x: 255, y: 250 }];
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
    const props = imageReferenceProps({
      blurFx: { type: "motion", strength: 100, radius: 40, angle: 360 },
      lensBlur,
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
      curve,
      curveCh: {
        r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
        b: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
      },
      lineCleanup: { threshold: 0.64, strength: 0.45 },
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
      tileableBlur: { radius: 7, sigma: 3.4, strength: 0.72 },
      dustScratches: { radius: 3, threshold: 42, strength: 0.66 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2.1,
        threshold: 1.5,
        strength: 12,
      },
      colorToAlpha: { keyColor: "#fefefe", strength: 85 },
      smartFilters: {
        version: 1,
        entries: [
          {
            id: "tone-1",
            engine: "brightness-contrast",
            enabled: true,
            params: { brightness: 0.2, contrast: -40 },
          },
          {
            id: "tile-1",
            engine: "tileable-blur",
            enabled: true,
            params: { radius: 5, sigma: 2.2, strength: 0.7 },
          },
          {
            id: "dog-1",
            engine: "difference-of-gaussians",
            enabled: true,
            params: { smallSigma: 0.8, largeSigma: 2, threshold: 1, strength: 9 },
          },
          {
            id: "dust-1",
            engine: "dust-scratches",
            enabled: true,
            params: { radius: 2, threshold: 32, strength: 0.8 },
          },
          {
            id: "alpha-1",
            engine: "color-to-alpha",
            enabled: true,
            params: { keyColor: "#ffffff", strength: 80 },
          },
        ],
      },
    });
    const validated = validateReference(props);

    curve[1]!.y = 1;
    lensBlur.radius = 1;
    expect(validated.props).toMatchObject({
      blurFx: { type: "motion", strength: 100, radius: 40, angle: 360 },
      lensBlur: {
        ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
        radius: 9.5,
        apertureRotationRadians: Math.PI / 4,
      },
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
      curve: [{ x: 0, y: 4 }, { x: 128, y: 144 }, { x: 255, y: 250 }],
      curveCh: {
        r: [{ x: 0, y: 0 }, { x: 255, y: 240 }],
        b: [{ x: 0, y: 12 }, { x: 255, y: 255 }],
      },
      lineCleanup: { threshold: 0.64, strength: 0.45 },
      screentoneRemoval: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
      jpegArtifactReduction: {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      },
      edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 72 },
      tileableBlur: { radius: 7, sigma: 3.4, strength: 0.72 },
      dustScratches: { radius: 3, threshold: 42, strength: 0.66 },
      differenceOfGaussians: {
        smallSigma: 0.8,
        largeSigma: 2.1,
        threshold: 1.5,
        strength: 12,
      },
      colorToAlpha: { keyColor: "#fefefe", strength: 85 },
      smartFilters: {
        version: 1,
        entries: [
          { engine: "brightness-contrast", params: { brightness: 0.2, contrast: -40 } },
          { engine: "tileable-blur", params: { radius: 5, sigma: 2.2, strength: 0.7 } },
          {
            engine: "difference-of-gaussians",
            params: { smallSigma: 0.8, largeSigma: 2, threshold: 1, strength: 9 },
          },
          { engine: "dust-scratches", params: { radius: 2, threshold: 32, strength: 0.8 } },
          { engine: "color-to-alpha", params: { keyColor: "#ffffff", strength: 80 } },
        ],
      },
    });
  });

  it("fails closed for over-point, unordered, malformed, and non-image structured edits", () => {
    const overPointCurve = Array.from(
      { length: STUDIO_WORK_ASSET_MAX_CURVE_POINTS + 1 },
      (_, index) => ({
        x: Math.round(index * 255 / STUDIO_WORK_ASSET_MAX_CURVE_POINTS),
        y: index,
      })
    );
    const invalidProps = [
      imageReferenceProps({ curve: overPointCurve }),
      imageReferenceProps({
        curve: [{ x: 0, y: 0 }, { x: 128, y: 100 }, { x: 128, y: 120 }, { x: 255, y: 255 }],
      }),
      imageReferenceProps({
        curveCh: { r: [{ x: 0, y: 0 }, { x: 255, y: 255 }], alpha: [] },
      }),
      imageReferenceProps({
        blurFx: { type: "motion", strength: 100, radius: 41, angle: 0 },
      }),
      imageReferenceProps({
        lensBlur: {
          ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
          radius: 18.01,
        },
      }),
      imageReferenceProps({
        fieldIrisBlur: {
          ...DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
          focusCenterY: -0.01,
        },
      }),
      imageReferenceProps({
        tiltShiftBlur: {
          ...DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
          axisRadians: Math.PI + 0.01,
        },
      }),
      imageReferenceProps({
        selectiveGaussianBlur: {
          ...DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
          radius: 11,
        },
      }),
      imageReferenceProps({
        lensBlur: {
          ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
          backend: "implementation-specific",
        },
      }),
      imageReferenceProps({
        lineCleanup: { threshold: -0.01, strength: 0.5 },
      }),
      imageReferenceProps({
        screentoneRemoval: { radius: 4, strength: 0.88, inkLumaThreshold: 72 },
      }),
      imageReferenceProps({
        jpegArtifactReduction: {
          deblockStrength: 0.72,
          deringStrength: 0.45,
          boundaryThreshold: 6,
          protectedEdgeThreshold: 225,
          ringingThreshold: 18,
          inkLumaThreshold: 64,
        },
      }),
      imageReferenceProps({
        edgeAwareDenoise: { radius: 1, strength: 0.78, rangeThreshold: 193 },
      }),
      imageReferenceProps({
        smartFilters: {
          version: 1,
          entries: [{ id: "bad", engine: "arbitrary-code", enabled: true, params: {} }],
        },
      }),
      {
        ...imageReferenceProps({
          blurFx: { type: "gaussian", strength: 100, radius: 10, angle: 0 },
        }),
        elementType: "vrm",
      },
    ];

    for (const props of invalidProps) {
      expect(() => validateReference(props)).toThrow(/구조화 필터/u);
    }
  });
});

describe("studio CRDT immutable filter-mask surface references", () => {
  it("admits a topology-preserving image auxiliary and an admitted image edit", () => {
    const auxiliary = validateReference({
      elementType: "image",
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: true,
    });
    expect(isStudioCrdtImageAuxiliaryReferencePayload(auxiliary)).toBe(true);
    expect(isStudioCrdtTopologyReferencePayload(auxiliary)).toBe(true);

    const visibilityOnly = validateReference({
      elementType: "image",
      hidden: false,
    });
    expect(isStudioCrdtImageAuxiliaryReferencePayload(visibilityOnly)).toBe(true);
    expect(isStudioCrdtTopologyReferencePayload(visibilityOnly)).toBe(true);

    const admitted = validateReference(imageReferenceProps({
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: false,
    }));
    expect(isStudioCrdtImageAuxiliaryReferencePayload(admitted)).toBe(false);
    expect(isStudioCrdtTopologyReferencePayload(admitted)).toBe(false);
    expect(admitted.props).toMatchObject({
      elementType: "image",
      filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      filterMaskEnabled: false,
    });
  });

  it("rejects malformed, inline, orphan-enabled, and non-image mask reference state", () => {
    const invalidProps: StudioCrdtJsonObject[] = [
      {
        elementType: "image",
        filterMaskSurfaceId: "data:image/png;base64,AA==",
      },
      {
        elementType: "image",
        filterMaskEnabled: true,
      },
      {
        ...imageReferenceProps(),
        filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
        filterMaskEnabled: "yes",
      },
      {
        ...imageReferenceProps(),
        elementType: "vrm",
        filterMaskSurfaceId: FILTER_MASK_SURFACE_ID,
      },
      {
        ...imageReferenceProps(),
        filterMaskSrc: "data:image/png;base64,AA==",
      },
    ];
    for (const props of invalidProps) {
      expect(() => validateReference(props)).toThrow();
    }
  });
});

function bubbleProps(overrides: StudioCrdtJsonObject = {}): StudioCrdtJsonObject {
  return {
    variant: "speech",
    text: "漢字テ스트",
    x: 40,
    y: 60,
    width: 220,
    height: 120,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
    ...overrides,
  };
}

function textProps(overrides: StudioCrdtJsonObject = {}): StudioCrdtJsonObject {
  return {
    text: "漢字テ스트",
    x: 10,
    y: 20,
    width: 180,
    fontSize: 24,
    fill: "#111111",
    rotation: 0,
    ...overrides,
  };
}

function validateScene(type: "bubble" | "text", props: StudioCrdtJsonObject) {
  return validateStudioCrdtSceneElementPayload({
    version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
    type,
    props,
  });
}

describe("studio CRDT sticky-note metadata", () => {
  it("syncs current and forward-compatible sticky-note metadata on text elements", () => {
    const current = validateScene("text", textProps({
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    }));
    expect(current.props).toMatchObject({
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    });

    // Preset identifiers are bounded rather than frozen to today's palette so an older peer can
    // preserve a future preset instead of rejecting the entire shared scene.
    expect(() => validateScene("text", textProps({
      stickyNotePresetId: "future-coral",
    }))).not.toThrow();
    expect(() => validateScene("text", textProps({
      stickyNoteFill: "color(display-p3 1 0.45 0.4)",
    }))).not.toThrow();
  });

  it("rejects malformed sticky-note metadata and keeps it text-only", () => {
    const invalidPresetIds: StudioCrdtJsonValue[] = [
      null,
      false,
      42,
      "",
      "bad\u0000preset",
      "bad\npreset",
      "x".repeat(161),
    ];
    for (const stickyNotePresetId of invalidPresetIds) {
      expect(() => validateScene("text", textProps({ stickyNotePresetId })))
        .toThrow(/스티키 노트 프리셋 ID/u);
    }

    const invalidFills: StudioCrdtJsonValue[] = [
      null,
      false,
      42,
      "bad\u0000fill",
      "x".repeat(513),
    ];
    for (const stickyNoteFill of invalidFills) {
      expect(() => validateScene("text", textProps({ stickyNoteFill })))
        .toThrow(/stickyNoteFill 값/u);
    }

    expect(() => validateScene("bubble", bubbleProps({
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    }))).toThrow(/stickyNotePresetId 속성은 동기화할 수 없습니다/u);
  });
});

describe("studio CRDT dialogue ruby spans", () => {
  it("syncs ruby spans on both dialogue element types with an identical canonical shape", () => {
    const rubySpans = [
      { start: 0, end: 2, ruby: "한자" },
      { start: 3, end: 5, ruby: "테스트" },
    ];

    // 회귀 방지: 이 두 호출이 던지면 스튜디오 상단에
    // "실시간 장면 동기화: bubble 요소의 rubySpans 속성은 동기화할 수 없습니다." 배너가 뜬다.
    const bubble = validateScene("bubble", bubbleProps({ rubySpans }));
    const text = validateScene("text", textProps({ rubySpans }));

    expect(bubble.props.rubySpans).toEqual(rubySpans);
    expect(text.props.rubySpans).toEqual(rubySpans);
    // 정규 사본 — 입력 배열/항목을 그대로 물고 있지 않다.
    expect(bubble.props.rubySpans).not.toBe(rubySpans);
    expect((bubble.props.rubySpans as StudioCrdtJsonObject[])[0]).not.toBe(rubySpans[0]);
  });

  it("keeps spans that outrun the current text so shrinking a line is never a sync failure", () => {
    const shortened = validateScene(
      "bubble",
      bubbleProps({ text: "가", rubySpans: [{ start: 0, end: 2, ruby: "한자" }] })
    );
    expect(shortened.props.rubySpans).toEqual([{ start: 0, end: 2, ruby: "한자" }]);
  });

  it("admits the authoring ceilings with headroom instead of undercutting them", () => {
    const spans = Array.from({ length: STUDIO_CRDT_MAX_RUBY_SPANS }, (_unused, index) => ({
      start: index * 2,
      end: index * 2 + 1,
      ruby: "가",
    }));
    expect(() => validateScene("text", textProps({ rubySpans: spans }))).not.toThrow();
    expect(STUDIO_CRDT_MAX_RUBY_SPANS).toBeGreaterThanOrEqual(64);
    expect(STUDIO_CRDT_MAX_RUBY_READING_LENGTH).toBeGreaterThanOrEqual(80);
    expect(() =>
      validateScene("text", textProps({
        rubySpans: [{ start: 0, end: 2, ruby: "가".repeat(STUDIO_CRDT_MAX_RUBY_READING_LENGTH) }],
      }))
    ).not.toThrow();
  });

  it("rejects malformed ruby payloads instead of trusting an admitted key", () => {
    const invalidSpans: unknown[] = [
      "루비",
      [{ start: 0, end: 2 }],
      [{ start: 0, end: 2, ruby: "한자", note: "x" }],
      [{ start: 0, end: 2, ruby: "" }],
      [{ start: 0, end: 2, ruby: 12 }],
      [{ start: 0, end: 2, ruby: "\u0007" }],
      [{ start: 0, end: 2, ruby: "a\u0000b" }],
      [{ start: 2, end: 2, ruby: "한자" }],
      [{ start: 3, end: 1, ruby: "한자" }],
      [{ start: -1, end: 2, ruby: "한자" }],
      [{ start: 0.5, end: 2, ruby: "한자" }],
      [{ start: 0, end: Number.MAX_SAFE_INTEGER, ruby: "한자" }],
      [{ start: 0, end: 2, ruby: "가".repeat(STUDIO_CRDT_MAX_RUBY_READING_LENGTH + 1) }],
      [null],
      [["start", 0]],
      Array.from({ length: STUDIO_CRDT_MAX_RUBY_SPANS + 1 }, (_unused, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        ruby: "가",
      })),
    ];

    for (const rubySpans of invalidSpans) {
      expect(() =>
        validateScene("bubble", bubbleProps({ rubySpans: rubySpans as never }))
      ).toThrow(/루비 구간|장면 확장/u);
      expect(() =>
        validateScene("text", textProps({ rubySpans: rubySpans as never }))
      ).toThrow(/루비 구간|장면 확장/u);
    }
  });

  it("still refuses ruby spans on element types whose renderers do not read them", () => {
    expect(() =>
      validateStudioCrdtSceneElementPayload({
        version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
        type: "sticker",
        props: {
          text: "★",
          x: 0,
          y: 0,
          fontSize: 24,
          rotation: 0,
          rubySpans: [{ start: 0, end: 1, ruby: "별" }],
        },
      })
    ).toThrow(/rubySpans 속성은 동기화할 수 없습니다/u);
  });
});
