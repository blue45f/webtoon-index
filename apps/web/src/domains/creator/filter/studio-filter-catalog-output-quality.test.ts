import { describe, expect, it } from "vitest";

import { isStudioGpuFilterChainEligible } from "../render/studio-gpu-filter-apply";
import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "../render/studio-konva-filters";
import {
  STUDIO_ADJUSTMENT_ENGINE_IDS,
  studioAdjustmentDefaultParams,
  studioAdjustmentOperationToFilterFields,
  type StudioAdjustmentEngineId,
} from "../studio-adjustment-stack";
import {
  runStudioImageFilterWorker,
  type StudioImageFilterWorkerLike,
} from "../studio-image-filter-worker-client";
import {
  studioImageFilterSuccessTransfers,
  type StudioImageFilterWorkerResponseMessage,
  type StudioImageFilterWorkerRunMessage,
  type StudioImageFilterWorkerSuccessMessage,
} from "../studio-image-filter-worker-protocol";

import { STUDIO_FILTER_CATALOG } from "./studio-filter-catalog";
import { STUDIO_FILTER_PACK_DEFS } from "./studio-filter-pack";
import { STUDIO_FILTER_UNION_WAVE_KINDS } from "./studio-filter-union-wave";

import type { ImageFilterFields } from "../render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "../studio-filters";

type CatalogEngineId = StudioAdjustmentEngineId;
type FixtureKind = "line-art" | "photo";
type QualityStage = "default" | "effective" | "low" | "high";

const registry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(registry);

/** Neutral defaults are legitimate editor reset states, not broken implementations. */
const INTENTIONAL_IDENTITY_DEFAULTS = new Set<CatalogEngineId>(["levels"]);

/**
 * These operations move or average RGBA support. Every other catalog filter must preserve alpha
 * byte-for-byte, including fully transparent line-art pixels.
 */
const SPATIAL_ALPHA_ENGINES = new Set<CatalogEngineId>([
  "blur",
  "color-to-alpha",
  "pixelate",
  "morphology",
  "offset",
]);

const MONOTONIC_ADJUSTMENT_PARAMS: Readonly<
  Partial<Record<StudioAdjustmentEngineId, {
    readonly low: Readonly<Record<string, number | string | boolean>>;
    readonly high: Readonly<Record<string, number | string | boolean>>;
  }>>
> = {
  levels: {
    low: { black: 8, white: 248, gamma: 0.98, outBlack: 0, outWhite: 255 },
    high: { black: 64, white: 220, gamma: 0.82, outBlack: 0, outWhite: 255 },
  },
  "brightness-contrast": {
    low: { brightness: 0.03, contrast: 2 },
    high: { brightness: 0.28, contrast: 32 },
  },
  "shadow-highlight": {
    low: {
      shadows: 8,
      shadowsWidth: 50,
      highlights: 4,
      highlightsWidth: 50,
      midtoneContrast: 0,
    },
    high: {
      shadows: 58,
      shadowsWidth: 50,
      highlights: 42,
      highlightsWidth: 50,
      midtoneContrast: 18,
    },
  },
  "hue-saturation": {
    low: { hue: 5, saturation: 0.05 },
    high: { hue: 95, saturation: 0.8 },
  },
  blur: {
    low: { radius: 1 },
    high: { radius: 7 },
  },
  "gaussian-blur": {
    low: { radius: 4, strength: 20 },
    high: { radius: 4, strength: 90 },
  },
  "motion-blur": {
    low: { radius: 8, strength: 20, angle: 18 },
    high: { radius: 8, strength: 90, angle: 18 },
  },
  "spin-blur": {
    low: { radius: 16, strength: 20 },
    high: { radius: 16, strength: 90 },
  },
  "zoom-blur": {
    low: { radius: 18, strength: 20 },
    high: { radius: 18, strength: 90 },
  },
  sharpen: {
    low: { amount: 0.1 },
    high: { amount: 0.9 },
  },
  "smart-sharpen": {
    low: { amount: 15, radius: 2 },
    high: { amount: 90, radius: 2 },
  },
  "median-despeckle": {
    low: { amount: 15, radius: 2 },
    high: { amount: 100, radius: 2 },
  },
  noise: {
    low: { amount: 4, seed: 1_337 },
    high: { amount: 36, seed: 1_337 },
  },
  "color-halftone": {
    low: { dotSize: 4, angle: 15, mode: "cmyk", strength: 15 },
    high: { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 },
  },
  "edge-detect": {
    low: { strength: 15, detail: 2 },
    high: { strength: 100, detail: 2 },
  },
  emboss: {
    low: { strength: 15, detail: 3 },
    high: { strength: 100, detail: 3 },
  },
  solarize: {
    low: { strength: 15, detail: 3 },
    high: { strength: 100, detail: 3 },
  },
  "oil-paint": {
    low: { strength: 15, detail: 3 },
    high: { strength: 100, detail: 3 },
  },
  exposure: {
    low: { exposure: 0.1, gamma: 1, offset: 0 },
    high: { exposure: 1.2, gamma: 1, offset: 0 },
  },
  "unsharp-mask": {
    low: { amount: 0.15, radius: 2, threshold: 4 },
    high: { amount: 1.2, radius: 2, threshold: 4 },
  },
  clouds: {
    low: { amount: 0.08, scale: 24, seed: 1_337, mode: "overlay" },
    high: { amount: 0.7, scale: 24, seed: 1_337, mode: "overlay" },
  },
  "surface-blur": {
    low: { strength: 15, radius: 2 },
    high: { strength: 95, radius: 2 },
  },
  "crystal-mosaic": {
    low: { size: 3, strength: 15 },
    high: { size: 3, strength: 95 },
  },
  "pencil-sketch": {
    low: { strength: 15, detail: 4 },
    high: { strength: 95, detail: 4 },
  },
  crosshatch: {
    low: { strength: 15, detail: 5 },
    high: { strength: 95, detail: 5 },
  },
  "ordered-dither": {
    low: { strength: 15, detail: 4 },
    high: { strength: 100, detail: 4 },
  },
  "glowing-edges": {
    low: { strength: 15, detail: 2, glow: 12, radius: 5, threshold: 18 },
    high: { strength: 95, detail: 2, glow: 88, radius: 5, threshold: 18 },
  },
  watercolor: {
    low: {
      strength: 15,
      spread: 4,
      bleed: 62,
      granulation: 52,
      paper: 46,
      seed: 112,
    },
    high: {
      strength: 95,
      spread: 4,
      bleed: 62,
      granulation: 52,
      paper: 46,
      seed: 112,
    },
  },
  "diffuse-glow": {
    low: { strength: 12, radius: 7, threshold: 45, grain: 3, seed: 1_337 },
    high: { strength: 90, radius: 7, threshold: 45, grain: 3, seed: 1_337 },
  },
};

/**
 * Binary, preset, threshold, and spatial-scale operations have no honest scalar "strength"
 * ordering. They remain covered by non-identity, determinism, alpha, edge, and distinction gates.
 */
const NON_MONOTONIC_ADJUSTMENT_ENGINES = new Set<StudioAdjustmentEngineId>([
  "curves",
  "color-balance",
  "channel-mixer",
  "gradient-map",
  "high-pass",
  "invert",
  "grayscale",
  "sepia",
  "pixelate",
  "posterize",
  "ink-threshold",
  "line-extraction",
  "line-cleanup",
  "screentone-removal",
  "jpeg-artifact-reduction",
  "edge-aware-denoise",
  "lens-blur",
  "field-iris-blur",
  "tilt-shift-blur",
  "selective-gaussian-blur",
  "tileable-blur",
  "dust-scratches",
  "difference-of-gaussians",
  "color-to-alpha",
  "screentone",
  "chromatic-aberration",
  "morphology",
  "offset",
  "custom-convolution",
  "cutout",
  "retro-film",
]);

const GPU_ELIGIBLE_ADJUSTMENT_ENGINES = new Set<StudioAdjustmentEngineId>([
  "curves",
  "levels",
  "brightness-contrast",
  "hue-saturation",
  "color-balance",
  "gaussian-blur",
  "high-pass",
  "morphology",
  "custom-convolution",
]);

function cloneImage(image: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  };
}

function lineArtFixture(width = 37, height = 29): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = 5 + Math.round(8 * Math.sin(x / 5));
      const painted =
        Math.abs(y - wave) <= 1
        || Math.abs(x - Math.floor(width / 2)) <= 1
        || Math.abs(y - (height - 7)) <= 1;
      if (!painted) continue;
      const index = (y * width + x) * 4;
      data[index] = 32 + (x * 9) % 150;
      data[index + 1] = 20 + (y * 13) % 130;
      data[index + 2] = 55 + ((x + y) * 7) % 160;
      data[index + 3] = (x + y) % 3 === 0 ? 96 : (x + y) % 3 === 1 ? 177 : 255;
    }
  }
  return { data, width, height };
}

function photoFixture(width = 37, height = 29): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (x * 31 + y * 17 + ((x * y) % 7) * 13) % 256;
      data[index + 1] = (x * 11 + y * 43 + ((x + y) % 5) * 29) % 256;
      data[index + 2] = (x * 53 + y * 7 + ((x * y) % 3) * 47) % 256;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

function fixture(kind: FixtureKind): StudioImageDataLike {
  return kind === "line-art" ? lineArtFixture() : photoFixture();
}

function effectiveAdjustmentParams(
  engine: StudioAdjustmentEngineId,
): Record<string, number | string | boolean> {
  if (engine === "levels") {
    return { black: 32, white: 230, gamma: 0.9, outBlack: 0, outWhite: 255 };
  }
  // Transparent line-art fixtures intentionally carry zero hidden RGB. Use a stronger valid JPEG
  // cleanup program so the gate measures visible deblock/dering rather than the now-forbidden
  // influence of RGB bytes below alpha=0.
  if (engine === "jpeg-artifact-reduction") {
    return {
      deblockStrength: 1,
      deringStrength: 1,
      boundaryThreshold: 4,
      protectedEdgeThreshold: 96,
      ringingThreshold: 8,
      inkLumaThreshold: 64,
    };
  }
  return { ...studioAdjustmentDefaultParams(engine) };
}

function fieldsFor(
  engine: CatalogEngineId,
  stage: QualityStage,
): ImageFilterFields {
  const monotonic = MONOTONIC_ADJUSTMENT_PARAMS[engine];
  let params: Readonly<Record<string, number | string | boolean>>;
  if (stage === "default") {
    params = studioAdjustmentDefaultParams(engine);
  } else if (stage === "low" && monotonic) {
    params = monotonic.low;
  } else if (stage === "high" && monotonic) {
    params = monotonic.high;
  } else if (STUDIO_FILTER_UNION_WAVE_KINDS.some((candidate) => candidate === engine)) {
    params = {
      ...studioAdjustmentDefaultParams(engine),
      ...(stage === "low" ? { amount: 20 } : {}),
      ...(stage === "high" ? { amount: 80 } : {}),
      ...(engine === "god-rays" ? { detail: 20 } : {}),
    };
  } else {
    params = effectiveAdjustmentParams(engine);
  }
  return studioAdjustmentOperationToFilterFields({
    id: `quality-${engine}-${stage}`,
    engine,
    enabled: true,
    params: { ...params },
  });
}

function render(
  engine: CatalogEngineId,
  kind: FixtureKind,
  stage: QualityStage = "effective",
): { readonly source: StudioImageDataLike; readonly output: StudioImageDataLike } {
  const source = fixture(kind);
  const output = cloneImage(source);
  const built = buildImageFilters(fieldsFor(engine, stage), registry);
  applyImageFilters(output, built.filters, built.attrs);
  return { source, output };
}

/** Alpha-aware byte distance: transparent hidden RGB cannot fake a visible non-identity result. */
function perceptualDistance(
  left: StudioImageDataLike,
  right: StudioImageDataLike,
): number {
  let total = 0;
  const pixels = left.width * left.height;
  for (let index = 0; index < left.data.length; index += 4) {
    const leftAlpha = left.data[index + 3]! / 255;
    const rightAlpha = right.data[index + 3]! / 255;
    total += Math.abs(left.data[index]! * leftAlpha - right.data[index]! * rightAlpha);
    total += Math.abs(left.data[index + 1]! * leftAlpha - right.data[index + 1]! * rightAlpha);
    total += Math.abs(left.data[index + 2]! * leftAlpha - right.data[index + 2]! * rightAlpha);
    total += Math.abs(left.data[index + 3]! - right.data[index + 3]!);
  }
  return total / pixels;
}

function alphaBytes(image: StudioImageDataLike): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(image.width * image.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    alpha[pixel] = image.data[pixel * 4 + 3]!;
  }
  return alpha;
}

class ApplyingWorker implements StudioImageFilterWorkerLike {
  onmessage: StudioImageFilterWorkerLike["onmessage"] = null;
  onerror: StudioImageFilterWorkerLike["onerror"] = null;
  private terminated = false;

  constructor() {
    queueMicrotask(() => {
      if (this.terminated) return;
      this.onmessage?.({
        data: { type: "studio-image-filter/ready", version: 1 },
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  postMessage(message: StudioImageFilterWorkerRunMessage, transfer: Transferable[]): void {
    const received = structuredClone(message, { transfer });
    queueMicrotask(() => {
      if (this.terminated) return;
      const built = buildImageFilters(received.request.el, registry, "worker");
      applyImageFilters(received.request.imageData, built.filters, built.attrs);
      const response: StudioImageFilterWorkerSuccessMessage = {
        type: "studio-image-filter/success",
        version: received.version,
        imageData: received.request.imageData,
      };
      const returned = structuredClone(response, {
        transfer: studioImageFilterSuccessTransfers(response),
      });
      this.onmessage?.({
        data: returned,
      } as MessageEvent<StudioImageFilterWorkerResponseMessage>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("studio filter catalog output quality", () => {
  it("enumerates one 77-engine source-of-truth with no duplicate or unsupported entries", () => {
    const catalogIds = STUDIO_FILTER_CATALOG.map((entry) => entry.engine);
    const executableIds = [...STUDIO_ADJUSTMENT_ENGINE_IDS];
    expect(catalogIds).toHaveLength(77);
    expect(new Set(catalogIds).size).toBe(77);
    expect([...catalogIds].sort()).toEqual([...executableIds].sort());

    const monotonicIds = Object.keys(MONOTONIC_ADJUSTMENT_PARAMS);
    const classifiedAdjustmentIds = [
      ...monotonicIds,
      ...NON_MONOTONIC_ADJUSTMENT_ENGINES,
      ...STUDIO_FILTER_UNION_WAVE_KINDS,
    ];
    expect(new Set(classifiedAdjustmentIds).size).toBe(STUDIO_ADJUSTMENT_ENGINE_IDS.length);
    expect([...classifiedAdjustmentIds].sort())
      .toEqual([...STUDIO_ADJUSTMENT_ENGINE_IDS].sort());
    expect([...GPU_ELIGIBLE_ADJUSTMENT_ENGINES].sort()).toEqual([
      "brightness-contrast",
      "color-balance",
      "curves",
      "custom-convolution",
      "gaussian-blur",
      "high-pass",
      "hue-saturation",
      "levels",
      "morphology",
    ]);
  });

  it("allows only explicitly documented neutral defaults to compile as identity", () => {
    const identityDefaults: CatalogEngineId[] = [];
    for (const engine of STUDIO_ADJUSTMENT_ENGINE_IDS) {
      const built = buildImageFilters(fieldsFor(engine, "default"), registry);
      if (built.filters.length === 0) identityDefaults.push(engine);
    }
    expect(identityDefaults).toEqual([...INTENTIONAL_IDENTITY_DEFAULTS]);
  });

  it.each(["line-art", "photo"] as const)(
    "makes every valid filter visibly non-identity and deterministic on %s pixels",
    (kind) => {
      for (const engine of STUDIO_ADJUSTMENT_ENGINE_IDS) {
        const first = render(engine, kind);
        const repeated = render(engine, kind);
        expect(
          perceptualDistance(first.source, first.output),
          `${engine}/${kind} visible non-identity`,
        ).toBeGreaterThan(0.1);
        expect(first.output.data, `${engine}/${kind} deterministic`)
          .toEqual(repeated.output.data);
        expect(first.output.width, `${engine}/${kind} width`).toBe(first.source.width);
        expect(first.output.height, `${engine}/${kind} height`).toBe(first.source.height);
        expect(first.output.data.length, `${engine}/${kind} RGBA bounds`)
          .toBe(first.source.data.length);
        expect(
          alphaBytes(first.output).some((value) => value > 0),
          `${engine}/${kind} must retain visible support`,
        ).toBe(true);
        if (!SPATIAL_ALPHA_ENGINES.has(engine)) {
          expect(alphaBytes(first.output), `${engine}/${kind} alpha preservation`)
            .toEqual(alphaBytes(first.source));
        }
      }
    },
  );

  it.each(["line-art", "photo"] as const)(
    "keeps every distinct filter perceptually distinguishable on %s pixels",
    (kind) => {
      const outputs = STUDIO_ADJUSTMENT_ENGINE_IDS.map((engine) => ({
        engine,
        output: render(engine, kind).output,
      }));
      for (let left = 0; left < outputs.length; left += 1) {
        for (let right = left + 1; right < outputs.length; right += 1) {
          const first = outputs[left]!;
          const second = outputs[right]!;
          expect(
            perceptualDistance(first.output, second.output),
            `${first.engine} must not alias ${second.engine} on ${kind}`,
          ).toBeGreaterThan(1);
        }
      }
    },
  );

  it.each(["line-art", "photo"] as const)(
    "increases visible effect monotonically for every scalar-strength filter on %s pixels",
    (kind) => {
      for (const engine of STUDIO_ADJUSTMENT_ENGINE_IDS) {
        if (!MONOTONIC_ADJUSTMENT_PARAMS[engine]) continue;
        const low = render(engine, kind, "low");
        const high = render(engine, kind, "high");
        const lowDistance = perceptualDistance(low.source, low.output);
        const highDistance = perceptualDistance(high.source, high.output);
        expect(lowDistance, `${engine}/${kind} low strength`).toBeGreaterThan(0);
        expect(
          highDistance,
          `${engine}/${kind} high=${highDistance} low=${lowDistance}`,
        ).toBeGreaterThan(lowDistance);
      }
      for (const engine of STUDIO_FILTER_UNION_WAVE_KINDS) {
        if (engine === "polar-coordinates") continue;
        const low = render(engine, kind, "low");
        const high = render(engine, kind, "high");
        const lowDistance = perceptualDistance(low.source, low.output);
        const highDistance = perceptualDistance(high.source, high.output);
        expect(lowDistance, `${engine}/${kind} low amount`).toBeGreaterThan(0);
        expect(
          highDistance,
          `${engine}/${kind} high=${highDistance} low=${lowDistance}`,
        ).toBeGreaterThan(lowDistance);
      }
    },
  );

  it("keeps all 77 CPU outputs byte-identical through the existing module Worker contract", async () => {
    for (const engine of STUDIO_ADJUSTMENT_ENGINE_IDS) {
      const source = photoFixture(23, 17);
      const cpu = cloneImage(source);
      const fields = fieldsFor(engine, "effective");
      const built = buildImageFilters(fields, registry);
      applyImageFilters(cpu, built.filters, built.attrs);
      const worker = await runStudioImageFilterWorker(
        { imageData: cloneImage(source), el: fields },
        { workerFactory: () => new ApplyingWorker() },
      );
      expect(worker.execution, engine).toBe("worker");
      expect(worker.imageData.data, `${engine} Worker parity`).toEqual(cpu.data);
    }
  });

  it("classifies exactly the nine adjustment engines accepted by the current WebGPU chain", () => {
    const eligible: StudioAdjustmentEngineId[] = [];
    for (const engine of STUDIO_ADJUSTMENT_ENGINE_IDS) {
      const fields = fieldsFor(engine, "effective");
      const actual = isStudioGpuFilterChainEligible(fields);
      expect(actual, `${engine} GPU eligibility`)
        .toBe(GPU_ELIGIBLE_ADJUSTMENT_ENGINES.has(engine));
      if (actual) eligible.push(engine);
    }
    expect(eligible).toEqual([
      "curves",
      "levels",
      "brightness-contrast",
      "hue-saturation",
      "color-balance",
      "gaussian-blur",
      "high-pass",
      "morphology",
      "custom-convolution",
    ]);
  });

  it("keeps union-wave defaults wired to their schema definitions", () => {
    for (const engine of STUDIO_FILTER_UNION_WAVE_KINDS) {
      const definition = STUDIO_FILTER_PACK_DEFS[engine];
      expect(definition.kind).toBe(engine);
      expect(definition.defaults.amount).toBeGreaterThan(0);
      expect(fieldsFor(engine, "default").filterUnionWave).toMatchObject({ kind: engine });
    }
  });
});
