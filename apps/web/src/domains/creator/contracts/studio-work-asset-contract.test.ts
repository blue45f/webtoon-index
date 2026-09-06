import { describe, expect, it } from "vitest";

import {
  parseStudioWorkAssetDescriptor,
  parseStudioWorkAssetSourceUri,
  parseStudioWorkAssetStructuredEditValue,
  isStudioWorkAssetAdmissionOptedIn,
  isStudioWorkAssetImageAdmissionOptedIn,
  STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN,
  STUDIO_WORK_ASSET_IMAGE_ADMISSION_OPT_IN_TOKEN,
  STUDIO_WORK_ASSET_MAX_CURVE_POINTS,
  STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS,
  STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS,
  StudioWorkAssetLayerLiftBatchMetadataSchema,
  StudioWorkAssetLayerLiftBatchReceiptSchema,
  StudioWorkAssetManifestSchema,
  serializeStudioWorkAssetDescriptorCanonical,
  studioWorkAssetReferenceKey,
  studioWorkAssetSourceUri,
} from "./studio-work-asset-contract";

import {
  DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
  DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
  DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
  DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
  type StudioFieldIrisBlurOptions,
  type StudioLensBlurOptions,
  type StudioSelectiveGaussianBlurOptions,
  type StudioTiltShiftBlurOptions,
} from "@/src/domains/creator/studio-advanced-blur-filter-kernels";


function descriptor(id = "asset-1", type: "image" | "vrm" | "background3d" = "image") {
  return {
    version: 1 as const,
    element: { id, type, x: 10, y: 20, width: 300, height: 400, rotation: 0 },
  };
}

describe("studio work asset wire contract", () => {
  it("keeps experimental work-asset admission default-off behind one exact token", () => {
    expect(isStudioWorkAssetAdmissionOptedIn(undefined)).toBe(false);
    expect(isStudioWorkAssetAdmissionOptedIn("true")).toBe(false);
    expect(isStudioWorkAssetAdmissionOptedIn(
      STUDIO_WORK_ASSET_ADMISSION_OPT_IN_TOKEN
    )).toBe(true);
    expect(isStudioWorkAssetImageAdmissionOptedIn(undefined)).toBe(false);
    expect(isStudioWorkAssetImageAdmissionOptedIn("true")).toBe(false);
    expect(isStudioWorkAssetImageAdmissionOptedIn(
      STUDIO_WORK_ASSET_IMAGE_ADMISSION_OPT_IN_TOKEN
    )).toBe(true);
  });

  it("keeps only bounded placement metadata and exact reference identity", () => {
    expect(parseStudioWorkAssetDescriptor(descriptor(), {
      assetId: "asset-1",
      elementType: "image",
    })).toEqual(descriptor());
    expect(() => parseStudioWorkAssetDescriptor(descriptor("asset-2"), {
      assetId: "asset-1",
      elementType: "image",
    })).toThrow(/식별자/u);
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, src: "data:image/png;base64,private" },
    }, {
      assetId: "asset-1",
      elementType: "image",
    })).toThrow();
    expect(parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        opacity: 0.5,
        flippedY: true,
        lockAspect: true,
        blur: 12,
        saturation: -0.4,
      },
    }, {
      assetId: "asset-1",
      elementType: "image",
    }).element).toMatchObject({
      opacity: 0.5,
      flippedY: true,
      lockAspect: true,
      blur: 12,
      saturation: -0.4,
    });
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, blur: 31 },
    }, {
      assetId: "asset-1",
      elementType: "image",
    })).toThrow();
  });

  it("canonicalizes descriptor identity independently from JSON object key order", () => {
    const parsed = parseStudioWorkAssetDescriptor(descriptor(), {
      assetId: "asset-1",
      elementType: "image",
    });
    const reordered = {
      element: {
        rotation: 0,
        height: 400,
        width: 300,
        y: 20,
        x: 10,
        type: "image" as const,
        id: "asset-1",
      },
      version: 1 as const,
    };

    expect(JSON.stringify(parsed)).not.toBe(JSON.stringify(reordered));
    expect(serializeStudioWorkAssetDescriptorCanonical(parsed)).toBe(
      serializeStudioWorkAssetDescriptorCanonical(reordered),
    );
  });

  it("accepts an ordered bounded smart-filter program on image references only", () => {
    const smartFilters = {
      version: 1 as const,
      entries: [
        { id: "tone-1", engine: "brightness-contrast" as const, enabled: true, params: { brightness: 0.2 } },
        { id: "tone-2", engine: "brightness-contrast" as const, enabled: true, params: { brightness: -0.1 } },
      ],
    };
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, smartFilters },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toContain("smartFilters");
    expect(parsed.element.smartFilters).toEqual(smartFilters);
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor("asset-1", "vrm"),
      element: { ...descriptor("asset-1", "vrm").element, smartFilters },
    }, { assetId: "asset-1", elementType: "vrm" })).toThrow(/이미지/u);
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        smartFilters: {
          version: 1,
          entries: Array.from({ length: 25 }, (_, index) => ({
            id: `filter-${index}`,
            engine: "blur",
            enabled: true,
            params: {},
          })),
        },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
  });

  it("preserves the bounded page-composite cache hint on image references", () => {
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, filterPageComposite: true },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toContain("filterPageComposite");
    expect(parsed.element.filterPageComposite).toBe(true);
  });

  it.each([
    { type: "gaussian" as const, strength: 100, radius: 40, angle: 0 },
    { type: "motion" as const, strength: 100, radius: 40, angle: 360 },
  ])("preserves bounded $type blur, tonal extrema, and normalized RGB curves", (blurFx) => {
    const curve = [
      { x: 0, y: 8 },
      { x: 96, y: 72 },
      { x: 255, y: 248 },
    ];
    const curveCh = {
      r: [{ x: 0, y: 0 }, { x: 128, y: 144 }, { x: 255, y: 255 }],
      g: [{ x: 0, y: 12 }, { x: 255, y: 244 }],
      b: [{ x: 0, y: 0 }, { x: 255, y: 232 }],
    };
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        blurFx,
        curve,
        curveCh,
        brightness: 0.8,
        contrast: -80,
        hue: 180,
        saturation: -1,
      },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS).toEqual([
      "blurFx",
      "lensBlur",
      "fieldIrisBlur",
      "tiltShiftBlur",
      "selectiveGaussianBlur",
      "tileableBlur",
      "differenceOfGaussians",
      "dustScratches",
      "colorToAlpha",
      "borderEffect",
      "curve",
      "curveCh",
      "edgeAwareDenoise",
      "jpegArtifactReduction",
      "lineCleanup",
      "screentoneRemoval",
      "smartFilters",
    ]);
    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toEqual(expect.arrayContaining([
      "blurFx",
      "curve",
      "curveCh",
    ]));
    expect(parsed.element).toMatchObject({
      blurFx,
      curve,
      curveCh,
      brightness: 0.8,
      contrast: -80,
      hue: 180,
      saturation: -1,
    });

    const oppositeExtrema = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        brightness: -0.8,
        contrast: 80,
        hue: -180,
        saturation: 1,
      },
    }, { assetId: "asset-1", elementType: "image" });
    expect(oppositeExtrema.element).toMatchObject({
      brightness: -0.8,
      contrast: 80,
      hue: -180,
      saturation: 1,
    });
  });

  it("rejects malformed, non-normalized, and over-point curve metadata", () => {
    const parseCurve = (curve: unknown) => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, curve },
    }, { assetId: "asset-1", elementType: "image" });
    const overPointCurve = Array.from(
      { length: STUDIO_WORK_ASSET_MAX_CURVE_POINTS + 1 },
      (_, index) => ({
        x: Math.round(index * 255 / STUDIO_WORK_ASSET_MAX_CURVE_POINTS),
        y: index,
      })
    );

    expect(() => parseCurve(overPointCurve)).toThrow();
    expect(() => parseCurve([{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 255, y: 255 }]))
      .toThrow(/오름차순/u);
    expect(() => parseCurve([{ x: 1, y: 0 }, { x: 255, y: 255 }]))
      .toThrow(/첫 입력점/u);
    expect(() => parseCurve([{ x: 0, y: 0 }, { x: 255, y: 255.5 }])).toThrow();
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        curveCh: { r: [{ x: 0, y: 0 }, { x: 255, y: 255 }], alpha: [] },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
  });

  it("accepts expanded local filter engines at the immutable asset boundary", () => {
    const engines = [
      "spin-blur",
      "zoom-blur",
      "pixelate",
      "posterize",
      "ink-threshold",
      "line-extraction",
      "line-cleanup",
      "screentone-removal",
      "jpeg-artifact-reduction",
      "edge-aware-denoise",
      "screentone",
      "color-halftone",
      "chromatic-aberration",
      "grayscale",
      "sepia",
      "edge-detect",
      "emboss",
      "high-pass",
      "median-despeckle",
      "solarize",
      "oil-paint",
      "smart-sharpen",
      "color-to-alpha",
      "difference-of-gaussians",
      "dust-scratches",
      "tileable-blur",
    ] as const;
    const parsedEngines: string[] = [];
    for (let offset = 0; offset < engines.length; offset += 12) {
      const batch = engines.slice(offset, offset + 12);
      const parsed = parseStudioWorkAssetDescriptor({
        ...descriptor(),
        element: {
          ...descriptor().element,
          smartFilters: {
            version: 1,
            entries: batch.map((engine) => ({
              id: `filter-${engine}`,
              engine,
              enabled: true,
              params: {},
            })),
          },
        },
      }, { assetId: "asset-1", elementType: "image" });
      parsedEngines.push(
        ...(parsed.element.smartFilters?.entries.map((entry) => entry.engine) ?? []),
      );
    }

    expect(parsedEngines).toEqual(engines);
  });

  it("round-trips exact advanced blur options and rejects widened metadata", () => {
    const lensBlur = {
      ...DEFAULT_STUDIO_LENS_BLUR_OPTIONS,
      radius: 9.5,
      apertureRotationRadians: Math.PI,
    } satisfies StudioLensBlurOptions;
    const fieldIrisBlur = {
      ...DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS,
      focusCenterX: 0.25,
      focusCenterY: 0.75,
      focusRadius: 0.2,
      feather: 0.3,
      maximumBlurRadius: 12,
    } satisfies StudioFieldIrisBlurOptions;
    const tiltShiftBlur = {
      ...DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS,
      axisRadians: -Math.PI / 3,
      focusWidth: 0.28,
      feather: 0.4,
      maximumBlurRadius: 10,
    } satisfies StudioTiltShiftBlurOptions;
    const selectiveGaussianBlur = {
      ...DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS,
      radius: 6,
      spatialSigma: 3.5,
      edgeThreshold: 48,
      edgeSoftness: 0.6,
    } satisfies StudioSelectiveGaussianBlurOptions;
    const advancedBlurEngines = [
      "lens-blur",
      "field-iris-blur",
      "tilt-shift-blur",
      "selective-gaussian-blur",
    ] as const;
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        lensBlur,
        fieldIrisBlur,
        tiltShiftBlur,
        selectiveGaussianBlur,
        smartFilters: {
          version: 1,
          entries: advancedBlurEngines.map((engine) => ({
            id: `filter-${engine}`,
            engine,
            enabled: true,
            params: {},
          })),
        },
      },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toEqual(expect.arrayContaining([
      "lensBlur",
      "fieldIrisBlur",
      "tiltShiftBlur",
      "selectiveGaussianBlur",
    ]));
    expect(parsed.element).toMatchObject({
      lensBlur,
      fieldIrisBlur,
      tiltShiftBlur,
      selectiveGaussianBlur,
    });
    expect(parsed.element.lensBlur).not.toBe(lensBlur);
    expect(parsed.element.fieldIrisBlur).not.toBe(fieldIrisBlur);
    expect(parsed.element.tiltShiftBlur).not.toBe(tiltShiftBlur);
    expect(parsed.element.selectiveGaussianBlur).not.toBe(selectiveGaussianBlur);
    expect(parsed.element.smartFilters?.entries.map((entry) => entry.engine))
      .toEqual(advancedBlurEngines);

    for (const element of [
      {
        ...descriptor().element,
        lensBlur: { ...lensBlur, radius: 18.01 },
      },
      {
        ...descriptor().element,
        fieldIrisBlur: { ...fieldIrisBlur, focusCenterX: 1.01 },
      },
      {
        ...descriptor().element,
        tiltShiftBlur: { ...tiltShiftBlur, axisRadians: Math.PI + 0.01 },
      },
      {
        ...descriptor().element,
        selectiveGaussianBlur: { ...selectiveGaussianBlur, radius: 1.5 },
      },
      {
        ...descriptor().element,
        lensBlur: { ...lensBlur, implementationHint: "gpu-only" },
      },
      {
        ...descriptor().element,
        lensBlur: {
          radius: lensBlur.radius,
          sampleCount: lensBlur.sampleCount,
          apertureBlades: lensBlur.apertureBlades,
        },
      },
      {
        ...descriptor().element,
        selectiveGaussianBlur: {
          ...selectiveGaussianBlur,
          edgeThreshold: Number.POSITIVE_INFINITY,
        },
      },
    ]) {
      expect(() => parseStudioWorkAssetDescriptor({
        ...descriptor(),
        element,
      }, { assetId: "asset-1", elementType: "image" })).toThrow();
    }
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor("asset-1", "vrm"),
      element: {
        ...descriptor("asset-1", "vrm").element,
        lensBlur,
      },
    }, { assetId: "asset-1", elementType: "vrm" })).toThrow(/이미지/u);
  });

  it("preserves bounded direct cleanup and professional metadata on image references only", () => {
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
    const tileableBlur = { radius: 7, sigma: 3.4, strength: 0.72 };
    const dustScratches = { radius: 3, threshold: 42, strength: 0.66 };
    const differenceOfGaussians = {
      smallSigma: 0.8,
      largeSigma: 2.1,
      threshold: 1.5,
      strength: 12,
    };
    const colorToAlpha = { keyColor: "#fefefe", strength: 85 };
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        edgeAwareDenoise,
        jpegArtifactReduction,
        lineCleanup,
        screentoneRemoval,
        tileableBlur,
        dustScratches,
        differenceOfGaussians,
        colorToAlpha,
      },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toEqual(expect.arrayContaining([
      "edgeAwareDenoise",
      "jpegArtifactReduction",
      "lineCleanup",
      "screentoneRemoval",
      "tileableBlur",
      "dustScratches",
      "differenceOfGaussians",
      "colorToAlpha",
    ]));
    expect(parsed.element.edgeAwareDenoise).toEqual(edgeAwareDenoise);
    expect(parsed.element.jpegArtifactReduction).toEqual(jpegArtifactReduction);
    expect(parsed.element.lineCleanup).toEqual(lineCleanup);
    expect(parsed.element.screentoneRemoval).toEqual(screentoneRemoval);
    expect(parsed.element.tileableBlur).toEqual(tileableBlur);
    expect(parsed.element.dustScratches).toEqual(dustScratches);
    expect(parsed.element.differenceOfGaussians).toEqual(differenceOfGaussians);
    expect(parsed.element.colorToAlpha).toEqual(colorToAlpha);
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        lineCleanup: { threshold: 1.01, strength: 0.45 },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor("asset-1", "vrm"),
      element: {
        ...descriptor("asset-1", "vrm").element,
        lineCleanup,
      },
    }, { assetId: "asset-1", elementType: "vrm" })).toThrow(/이미지/u);
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        screentoneRemoval: { ...screentoneRemoval, radius: 4 },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        jpegArtifactReduction: {
          ...jpegArtifactReduction,
          protectedEdgeThreshold: 225,
        },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: {
        ...descriptor().element,
        edgeAwareDenoise: { ...edgeAwareDenoise, rangeThreshold: 193 },
      },
    }, { assetId: "asset-1", elementType: "image" })).toThrow();
  });

  it("round-trips the normalized per-layer border effect on image references exactly", () => {
    const borderEffect = {
      enabled: true,
      thickness: 3,
      color: "#ff8800",
      type: "outer" as const,
      antiAliased: true,
    };
    const parsed = parseStudioWorkAssetDescriptor({
      ...descriptor(),
      element: { ...descriptor().element, borderEffect },
    }, { assetId: "asset-1", elementType: "image" });

    expect(STUDIO_WORK_ASSET_STRUCTURED_EDIT_KEYS).toContain("borderEffect");
    expect(STUDIO_WORK_ASSET_REFERENCE_EDIT_KEYS).toContain("borderEffect");
    expect(parsed.element.borderEffect).toEqual(borderEffect);
    expect(parsed.element.borderEffect).not.toBe(borderEffect);
    expect(parseStudioWorkAssetStructuredEditValue("borderEffect", borderEffect))
      .toEqual(borderEffect);

    // Normalized identity/off forms still sync the collaborator-visible toggle state.
    for (const identityRecipe of [
      { enabled: false, thickness: 3, color: "#000000", type: "outer" as const, antiAliased: true },
      { enabled: true, thickness: 0, color: "#000000", type: "inner" as const },
      {
        enabled: true,
        thickness: 32,
        color: "rgba(255, 128, 0, 0.5)",
        type: "center" as const,
        antiAliased: false,
      },
    ]) {
      expect(parseStudioWorkAssetDescriptor({
        ...descriptor(),
        element: { ...descriptor().element, borderEffect: identityRecipe },
      }, { assetId: "asset-1", elementType: "image" }).element.borderEffect)
        .toEqual(identityRecipe);
    }
  });

  it("fails closed on malformed border effect recipes instead of passing them through", () => {
    const validBorderEffect = {
      enabled: true,
      thickness: 3,
      color: "#ff8800",
      type: "outer" as const,
      antiAliased: true,
    };
    for (const malformed of [
      { ...validBorderEffect, thickness: 33 },
      { ...validBorderEffect, thickness: -1 },
      { ...validBorderEffect, thickness: 0.5 },
      { ...validBorderEffect, thickness: Number.POSITIVE_INFINITY },
      { ...validBorderEffect, color: "" },
      { ...validBorderEffect, color: "not-a-color" },
      { ...validBorderEffect, color: "#ff880" },
      { ...validBorderEffect, color: "rgb(999, 0, 0)" },
      { ...validBorderEffect, color: "url(javascript:alert(1))" },
      { ...validBorderEffect, type: "glow" },
      { ...validBorderEffect, implementationHint: "gpu-only" },
      { thickness: 3, color: "#ff8800", type: "outer" },
      "outer",
      null,
    ]) {
      expect(() => parseStudioWorkAssetStructuredEditValue(
        "borderEffect",
        malformed
      )).toThrow();
      expect(() => parseStudioWorkAssetDescriptor({
        ...descriptor(),
        element: { ...descriptor().element, borderEffect: malformed },
      }, { assetId: "asset-1", elementType: "image" })).toThrow();
    }
    expect(() => parseStudioWorkAssetDescriptor({
      ...descriptor("asset-1", "vrm"),
      element: { ...descriptor("asset-1", "vrm").element, borderEffect: validBorderEffect },
    }, { assetId: "asset-1", elementType: "vrm" })).toThrow(/이미지/u);
  });

  it("keeps envelope output byte-identical for elements without a border effect", () => {
    const parsed = parseStudioWorkAssetDescriptor(descriptor(), {
      assetId: "asset-1",
      elementType: "image",
    });

    expect("borderEffect" in parsed.element).toBe(false);
    expect(serializeStudioWorkAssetDescriptorCanonical(parsed)).toBe(
      '{"element":{"height":400,"id":"asset-1","rotation":0,"type":"image",' +
      '"width":300,"x":10,"y":20},"version":1}'
    );
  });

  it("rejects MIME/type mismatches and over-limit manifests", () => {
    const common = {
      version: 1,
      assetId: "asset-1",
      elementType: "image",
      byteSize: 32,
      sha256: "a".repeat(64),
      intrinsicImage: { width: 2, height: 4, decodedRgbaBytes: 32 },
      descriptor: descriptor(),
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      mimeType: "image/png",
    }).success).toBe(true);
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      mimeType: "model/gltf-binary",
    }).success).toBe(false);
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      byteSize: 9 * 1024 * 1024,
      mimeType: "image/png",
    }).success).toBe(false);
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      intrinsicImage: { width: 2, height: 4, decodedRgbaBytes: 31 },
      mimeType: "image/png",
    }).success).toBe(false);
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      intrinsicImage: null,
      mimeType: "image/png",
    }).success).toBe(false);
    expect(StudioWorkAssetManifestSchema.safeParse({
      ...common,
      intrinsicImage: null,
      elementType: "vrm",
      mimeType: "model/gltf-binary",
      descriptor: descriptor("asset-1", "vrm"),
    }).success).toBe(true);
  });

  it("binds one ordered background/foreground PNG pair to exact immutable metadata", () => {
    const batchId = "11111111-1111-4111-8111-111111111111";
    const metadata = {
      version: 1,
      batchId,
      assets: [
        {
          role: "background",
          assetId: "lift-background",
          descriptor: descriptor("lift-background"),
          expectedSha256: "a".repeat(64),
          byteSize: 77,
          width: 4,
          height: 1,
        },
        {
          role: "foreground",
          assetId: "lift-foreground",
          descriptor: descriptor("lift-foreground"),
          expectedSha256: "b".repeat(64),
          byteSize: 76,
          width: 4,
          height: 1,
        },
      ],
    };

    expect(StudioWorkAssetLayerLiftBatchMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(StudioWorkAssetLayerLiftBatchMetadataSchema.safeParse({
      ...metadata,
      assets: [metadata.assets[1], metadata.assets[0]],
    }).success).toBe(false);
    expect(StudioWorkAssetLayerLiftBatchMetadataSchema.safeParse({
      ...metadata,
      assets: [
        metadata.assets[0],
        { ...metadata.assets[1], assetId: metadata.assets[0].assetId },
      ],
    }).success).toBe(false);
    expect(StudioWorkAssetLayerLiftBatchMetadataSchema.safeParse({
      ...metadata,
      assets: [
        metadata.assets[0],
        {
          ...metadata.assets[1],
          descriptor: descriptor("different-foreground"),
        },
      ],
    }).success).toBe(false);
    expect(StudioWorkAssetLayerLiftBatchMetadataSchema.safeParse({
      ...metadata,
      extra: true,
    }).success).toBe(false);
  });

  it("returns an ordered batch receipt containing only two exact PNG manifests", () => {
    const batchId = "22222222-2222-4222-8222-222222222222";
    const manifestFor = (assetId: string, sha256: string) => ({
      version: 1,
      assetId,
      elementType: "image",
      mimeType: "image/png",
      byteSize: 32,
      sha256,
      intrinsicImage: { width: 2, height: 4, decodedRgbaBytes: 32 },
      descriptor: descriptor(assetId),
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    const receipt = {
      version: 1,
      batchId,
      assets: [
        { role: "background", manifest: manifestFor("lift-background", "a".repeat(64)) },
        { role: "foreground", manifest: manifestFor("lift-foreground", "b".repeat(64)) },
      ],
    };

    expect(StudioWorkAssetLayerLiftBatchReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(StudioWorkAssetLayerLiftBatchReceiptSchema.safeParse({
      ...receipt,
      assets: [receipt.assets[1], receipt.assets[0]],
    }).success).toBe(false);
    expect(StudioWorkAssetLayerLiftBatchReceiptSchema.safeParse({
      ...receipt,
      assets: [
        receipt.assets[0],
        {
          ...receipt.assets[1],
          manifest: {
            ...receipt.assets[1].manifest,
            mimeType: "image/jpeg",
          },
        },
      ],
    }).success).toBe(false);
  });

  it("uses a collision-free compound reference key", () => {
    expect(studioWorkAssetReferenceKey({ assetId: "a:b", elementType: "image" }))
      .not.toBe(studioWorkAssetReferenceKey({ assetId: "a", elementType: "image" }));
    const reference = { assetId: "asset / 한글", elementType: "background3d" as const };
    expect(parseStudioWorkAssetSourceUri(studioWorkAssetSourceUri(reference))).toEqual(reference);
    expect(parseStudioWorkAssetSourceUri("data:image/png;base64,private")).toBeNull();
    expect(parseStudioWorkAssetSourceUri(
      "work-asset://background3d/asset%20%2f%20%ed%95%9c%ea%b8%80"
    )).toBeNull();
  });
});
