import { describe, expect, it } from "vitest";

import {
  buildStudioAdjustmentLayerCompositorPlan,
  createStudioAdjustmentLayerDocument,
  type StudioAdjustmentEffectLayer,
  type StudioAdjustmentLayerBlendMode,
  type StudioAdjustmentLayerRenderKind,
} from "./studio-adjustment-layer-plan";
import {
  STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
  StudioAdjustmentLayerRuntimeError,
  createStudioAdjustmentLayerGpuAdapter,
  createStudioAdjustmentLayerRuntimeRecipe,
  createStudioAdjustmentLayerWorkerAdapter,
  executeStudioAdjustmentLayerRuntime,
  serializeStudioAdjustmentLayerRuntimeRecipe,
  studioAdjustmentLayerCpuAdapter,
  verifyStudioAdjustmentLayerAdapterParity,
  type StudioAdjustmentLayerCompositeSource,
  type StudioAdjustmentLayerFilterAdapter,
  type StudioAdjustmentLayerFilterAdapterInput,
  type StudioAdjustmentLayerMask,
  type StudioAdjustmentLayerPixelRect,
} from "./studio-adjustment-layer-runtime";

import type {
  StudioAdjustmentEngineId,
  StudioAdjustmentFilterOperation,
  StudioAdjustmentStack,
} from "./studio-adjustment-stack";
import type { StudioImageDataLike } from "./studio-filters";

type OperationInput = {
  readonly id: string;
  readonly engine: StudioAdjustmentEngineId;
  readonly params?: Record<string, number | string | boolean>;
};

const ALL_RENDER_KINDS = [
  "raster",
  "vector",
  "text",
  "shape",
  "group",
  "three-d",
  "other",
] as const satisfies readonly StudioAdjustmentLayerRenderKind[];

function stack(entries: readonly OperationInput[]): StudioAdjustmentStack {
  return {
    version: 1,
    entries: entries.map((entry) => ({
      id: entry.id,
      engine: entry.engine,
      enabled: true,
      params: { ...entry.params },
    })),
  };
}

function planFor(
  operations: readonly OperationInput[],
  options: {
    readonly opacity?: number;
    readonly blendMode?: StudioAdjustmentLayerBlendMode;
    readonly maskId?: string;
    readonly visible?: boolean;
    readonly renderKinds?: readonly StudioAdjustmentLayerRenderKind[];
  } = {},
) {
  const renderKinds = options.renderKinds ?? ["vector"];
  const adjustment: StudioAdjustmentEffectLayer = {
    id: "adjustment",
    kind: "adjustment",
    parentGroupId: null,
    paintOrder: renderKinds.length + 1,
    visible: options.visible ?? true,
    scope: "composite-below",
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? "normal",
    ...(options.maskId === undefined ? {} : { maskId: options.maskId }),
    stack: stack(operations),
  };
  return buildStudioAdjustmentLayerCompositorPlan(
    createStudioAdjustmentLayerDocument({
      version: 1,
      groups: [],
      layers: [
        ...renderKinds.map((renderKind, index) => ({
          id: `content-${index}`,
          kind: "content" as const,
          parentGroupId: null,
          paintOrder: index,
          visible: true,
          renderKind,
        })),
        adjustment,
      ],
    }),
  );
}

function rgbaImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      const index = (y * width + x) * 4;
      data[index] = value[0];
      data[index + 1] = value[1];
      data[index + 2] = value[2];
      data[index + 3] = value[3];
    }
  }
  return { data, width, height };
}

function sourceFor(
  imageData: StudioImageDataLike,
  revision: string | number = "source-1",
  renderKinds: readonly StudioAdjustmentLayerRenderKind[] = ["vector"],
): StudioAdjustmentLayerCompositeSource {
  return {
    revision,
    width: imageData.width,
    height: imageData.height,
    renderKinds,
    imageData,
  };
}

async function executeSingle(
  imageData: StudioImageDataLike,
  operations: readonly OperationInput[],
  options: {
    readonly opacity?: number;
    readonly blendMode?: StudioAdjustmentLayerBlendMode;
    readonly mask?: StudioAdjustmentLayerMask;
    readonly selectionBounds?: StudioAdjustmentLayerPixelRect;
    readonly dirtyRect?: StudioAdjustmentLayerPixelRect;
    readonly renderKinds?: readonly StudioAdjustmentLayerRenderKind[];
  } = {},
) {
  const renderKinds = options.renderKinds ?? ["vector"];
  const plan = planFor(operations, {
    opacity: options.opacity,
    blendMode: options.blendMode,
    maskId: options.mask?.id,
    renderKinds,
  });
  const recipe = createStudioAdjustmentLayerRuntimeRecipe({
    plan,
    source: {
      revision: "source-1",
      width: imageData.width,
      height: imageData.height,
      renderKinds,
    },
    ...(options.mask
      ? { masks: [{ id: options.mask.id, revision: options.mask.revision }] }
      : {}),
    selectionBounds: options.selectionBounds,
    dirtyRect: options.dirtyRect,
  });
  return executeStudioAdjustmentLayerRuntime(
    recipe,
    sourceFor(imageData, "source-1", renderKinds),
    { masks: options.mask ? [options.mask] : [] },
  );
}

function meanAbsoluteDifference(
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
): number {
  let total = 0;
  let channels = 0;
  for (let index = 0; index < left.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      total += Math.abs(left[index + channel]! - right[index + channel]!);
      channels += 1;
    }
  }
  return total / channels;
}

function horizontalVariation(imageData: StudioImageDataLike): number {
  let total = 0;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 1; x < imageData.width; x += 1) {
      const left = (y * imageData.width + x - 1) * 4;
      const right = left + 4;
      total += Math.abs(imageData.data[right]! - imageData.data[left]!);
    }
  }
  return total;
}

function chroma(imageData: StudioImageDataLike): number {
  let total = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index]!;
    const green = imageData.data[index + 1]!;
    const blue = imageData.data[index + 2]!;
    total += Math.max(red, green, blue) - Math.min(red, green, blue);
  }
  return total;
}

function meanRgb(imageData: StudioImageDataLike): number {
  let total = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    total += imageData.data[index]!;
    total += imageData.data[index + 1]!;
    total += imageData.data[index + 2]!;
  }
  return total / (imageData.width * imageData.height * 3);
}

function expectRuntimeError(
  error: unknown,
  code: StudioAdjustmentLayerRuntimeError["code"],
): boolean {
  expect(error).toBeInstanceOf(StudioAdjustmentLayerRuntimeError);
  expect((error as StudioAdjustmentLayerRuntimeError).code).toBe(code);
  return true;
}

describe("studio adjustment-layer runtime", () => {
  it("accepts a compositor revision containing raster, vector, text, shape, group, and 3D sources", async () => {
    const image = rgbaImage(4, 3, (x, y) => [20 + x * 10, 50 + y * 20, 90, 255]);
    const sourceSnapshot = new Uint8ClampedArray(image.data);
    const result = await executeSingle(
      image,
      [{ id: "invert", engine: "invert" }],
      { renderKinds: ALL_RENDER_KINDS },
    );

    expect(result.sourceRenderKinds).toEqual([...ALL_RENDER_KINDS].sort());
    expect(result.trace).toEqual([
      expect.objectContaining({
        adjustmentLayerId: "adjustment",
        executed: true,
        backend: "cpu",
      }),
    ]);
    expect(result.imageData.data).not.toEqual(sourceSnapshot);
    expect(image.data).toEqual(sourceSnapshot);
  });

  it("executes duplicate filters in deterministic stored order", async () => {
    const image = rgbaImage(15, 11, (x, y) => [
      (x * 37 + y * 11) % 256,
      (x * 13 + y * 29) % 256,
      (x * 7 + y * 41) % 256,
      255,
    ]);
    const blurThenNoise = await executeSingle(image, [
      { id: "blur", engine: "gaussian-blur", params: { radius: 2, strength: 100 } },
      { id: "noise", engine: "noise", params: { amount: 24, seed: 77 } },
    ]);
    const noiseThenBlur = await executeSingle(image, [
      { id: "noise", engine: "noise", params: { amount: 24, seed: 77 } },
      { id: "blur", engine: "gaussian-blur", params: { radius: 2, strength: 100 } },
    ]);
    const replay = await executeSingle(image, [
      { id: "blur", engine: "gaussian-blur", params: { radius: 2, strength: 100 } },
      { id: "noise", engine: "noise", params: { amount: 24, seed: 77 } },
    ]);

    expect(blurThenNoise.imageData.data).not.toEqual(noiseThenBlur.imageData.data);
    expect(replay.imageData.data).toEqual(blurThenNoise.imageData.data);
  });

  it("produces non-identity, monotonic Gaussian and motion blur intensity", async () => {
    const checker = rgbaImage(33, 17, (x, y) => {
      const value = (x + y) % 2 === 0 ? 255 : 0;
      return [value, value, value, 255];
    });
    const gaussianSmall = await executeSingle(checker, [
      { id: "gaussian", engine: "gaussian-blur", params: { radius: 1, strength: 100 } },
    ]);
    const gaussianLarge = await executeSingle(checker, [
      { id: "gaussian", engine: "gaussian-blur", params: { radius: 6, strength: 100 } },
    ]);
    expect(gaussianSmall.imageData.data).not.toEqual(checker.data);
    expect(horizontalVariation(gaussianLarge.imageData))
      .toBeLessThan(horizontalVariation(gaussianSmall.imageData));

    const impulse = rgbaImage(41, 9, (x, y) => {
      const value = x === 20 && y === 4 ? 255 : 0;
      return [value, value, value, 255];
    });
    const motionSmall = await executeSingle(impulse, [
      {
        id: "motion",
        engine: "motion-blur",
        params: { radius: 2, strength: 100, angle: 0 },
      },
    ]);
    const motionLarge = await executeSingle(impulse, [
      {
        id: "motion",
        engine: "motion-blur",
        params: { radius: 10, strength: 100, angle: 0 },
      },
    ]);
    const peak = (value: StudioImageDataLike) =>
      Math.max(...Array.from(value.data).filter((_, index) => index % 4 === 0));
    const support = (value: StudioImageDataLike) =>
      Array.from(value.data).filter((channel, index) => index % 4 === 0 && channel > 0).length;
    expect(motionSmall.imageData.data).not.toEqual(impulse.data);
    expect(peak(motionLarge.imageData)).toBeLessThanOrEqual(peak(motionSmall.imageData));
    expect(support(motionLarge.imageData)).toBeGreaterThan(support(motionSmall.imageData));
  });

  it("produces monotonic HSL, levels, curves, noise, and sharpen adjustments", async () => {
    const colored = rgbaImage(24, 8, (x, y) => [
      120 + (x % 4) * 10,
      100 + (y % 3) * 5,
      90,
      255,
    ]);
    const saturationLow = await executeSingle(colored, [
      { id: "hsl", engine: "hue-saturation", params: { saturation: 0.15, hue: 0 } },
    ]);
    const saturationHigh = await executeSingle(colored, [
      { id: "hsl", engine: "hue-saturation", params: { saturation: 0.8, hue: 0 } },
    ]);
    expect(chroma(saturationLow.imageData)).toBeGreaterThan(chroma(colored));
    expect(chroma(saturationHigh.imageData)).toBeGreaterThan(chroma(saturationLow.imageData));

    const gradient = rgbaImage(32, 4, (x) => {
      const value = 20 + x * 7;
      return [value, value, value, 255];
    });
    const levelsLow = await executeSingle(gradient, [
      { id: "levels", engine: "levels", params: { black: 16, white: 255, gamma: 1 } },
    ]);
    const levelsHigh = await executeSingle(gradient, [
      { id: "levels", engine: "levels", params: { black: 72, white: 255, gamma: 1 } },
    ]);
    expect(meanRgb(levelsLow.imageData)).toBeLessThan(meanRgb(gradient));
    expect(meanRgb(levelsHigh.imageData)).toBeLessThan(meanRgb(levelsLow.imageData));

    const oneCurve = await executeSingle(gradient, [
      { id: "curve-1", engine: "curves", params: { preset: "soft-contrast" } },
    ]);
    const twoCurves = await executeSingle(gradient, [
      { id: "curve-1", engine: "curves", params: { preset: "soft-contrast" } },
      { id: "curve-2", engine: "curves", params: { preset: "soft-contrast" } },
    ]);
    expect(meanAbsoluteDifference(oneCurve.imageData.data, gradient.data)).toBeGreaterThan(0);
    expect(meanAbsoluteDifference(twoCurves.imageData.data, gradient.data))
      .toBeGreaterThan(meanAbsoluteDifference(oneCurve.imageData.data, gradient.data));

    const noiseLow = await executeSingle(gradient, [
      { id: "noise", engine: "noise", params: { amount: 5, seed: 321 } },
    ]);
    const noiseHigh = await executeSingle(gradient, [
      { id: "noise", engine: "noise", params: { amount: 35, seed: 321 } },
    ]);
    expect(meanAbsoluteDifference(noiseHigh.imageData.data, gradient.data))
      .toBeGreaterThan(meanAbsoluteDifference(noiseLow.imageData.data, gradient.data));

    const softEdge = rgbaImage(31, 5, (x) => {
      const value = x < 14 ? 70 : x > 16 ? 180 : 100 + (x - 14) * 25;
      return [value, value, value, 255];
    });
    const sharpenLow = await executeSingle(softEdge, [
      { id: "sharpen", engine: "sharpen", params: { amount: 0.2 } },
    ]);
    const sharpenHigh = await executeSingle(softEdge, [
      { id: "sharpen", engine: "sharpen", params: { amount: 1 } },
    ]);
    expect(meanAbsoluteDifference(sharpenLow.imageData.data, softEdge.data)).toBeGreaterThan(0);
    expect(meanAbsoluteDifference(sharpenHigh.imageData.data, softEdge.data))
      .toBeGreaterThan(meanAbsoluteDifference(sharpenLow.imageData.data, softEdge.data));
  });

  it("composites opacity, blend, selection bounds, and a revisioned mask without touching excluded pixels", async () => {
    const image = rgbaImage(6, 4, () => [100, 100, 100, 255]);
    const mask: StudioAdjustmentLayerMask = {
      id: "mask",
      revision: "mask-1",
      width: 6,
      height: 4,
      data: new Uint8ClampedArray([
        255, 255, 255, 0, 0, 0,
        255, 255, 255, 0, 0, 0,
        255, 255, 255, 0, 0, 0,
        255, 255, 255, 0, 0, 0,
      ]),
    };
    const result = await executeSingle(
      image,
      [{ id: "invert", engine: "invert" }],
      {
        opacity: 0.5,
        mask,
        selectionBounds: { x: 1, y: 1, width: 4, height: 2 },
      },
    );
    const redAt = (x: number, y: number) =>
      result.imageData.data[(y * result.imageData.width + x) * 4]!;

    expect(redAt(1, 1)).toBeGreaterThan(100);
    expect(redAt(1, 1)).toBeLessThan(155);
    expect(redAt(2, 2)).toBe(redAt(1, 1));
    expect(redAt(0, 1)).toBe(100);
    expect(redAt(3, 1)).toBe(100);
    expect(redAt(2, 0)).toBe(100);
    expect(result.dirtyRect).toEqual({ x: 1, y: 1, width: 4, height: 2 });
  });

  it("honours non-normal blend modes and never executes hidden passes", async () => {
    const image = rgbaImage(3, 2, () => [100, 100, 100, 255]);
    const normal = await executeSingle(
      image,
      [{ id: "invert", engine: "invert" }],
      { blendMode: "normal" },
    );
    const multiply = await executeSingle(
      image,
      [{ id: "invert", engine: "invert" }],
      { blendMode: "multiply" },
    );
    expect(normal.imageData.data[0]).toBe(155);
    expect(multiply.imageData.data[0]).toBeLessThan(image.data[0]!);

    const hiddenPlan = planFor(
      [{ id: "invert", engine: "invert" }],
      { visible: false },
    );
    const hiddenRecipe = createStudioAdjustmentLayerRuntimeRecipe({
      plan: hiddenPlan,
      source: { revision: 1, width: 3, height: 2, renderKinds: ["vector"] },
    });
    const hidden = await executeStudioAdjustmentLayerRuntime(
      hiddenRecipe,
      sourceFor(image, 1),
    );
    expect(hidden.imageData.data).toEqual(image.data);
    expect(hidden.trace).toEqual([
      expect.objectContaining({ status: "hidden", executed: false, backend: null }),
    ]);
  });

  it("uses a padded incremental read rect and commits only the requested dirty rect", async () => {
    const image = rgbaImage(30, 20, (x, y) => [
      (x * 19 + y * 7) % 256,
      (x * 11 + y * 13) % 256,
      (x * 3 + y * 23) % 256,
      255,
    ]);
    const dirtyRect = { x: 12, y: 8, width: 4, height: 3 };
    const result = await executeSingle(
      image,
      [{ id: "blur", engine: "gaussian-blur", params: { radius: 2, strength: 100 } }],
      { dirtyRect },
    );
    expect(result.readRect.x).toBeLessThan(dirtyRect.x);
    expect(result.readRect.y).toBeLessThan(dirtyRect.y);
    expect(result.readRect.width).toBeGreaterThan(dirtyRect.width);
    expect(result.readRect.height).toBeGreaterThan(dirtyRect.height);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const inside = x >= 12 && x < 16 && y >= 8 && y < 11;
        const index = (y * image.width + x) * 4;
        if (!inside) {
          expect(result.imageData.data.slice(index, index + 4))
            .toEqual(image.data.slice(index, index + 4));
        }
      }
    }
    expect(result.imageData.data).not.toEqual(image.data);
  });

  it("creates a deeply immutable deterministic undo recipe", () => {
    const plan = planFor([
      { id: "levels", engine: "levels", params: { gamma: 0.8, black: 10 } },
    ], { renderKinds: ["text", "shape", "three-d"] });
    const input = {
      plan,
      source: {
        revision: 7,
        width: 80,
        height: 60,
        renderKinds: ["three-d", "shape", "text"] as const,
      },
      masks: [{ id: "m", revision: "r1" }],
      dirtyRect: { x: 2.2, y: 3.8, width: 10.1, height: 11.1 },
    };
    const first = createStudioAdjustmentLayerRuntimeRecipe(input);
    const second = createStudioAdjustmentLayerRuntimeRecipe(input);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(serializeStudioAdjustmentLayerRuntimeRecipe(first))
      .toBe(serializeStudioAdjustmentLayerRuntimeRecipe(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
    expect(Object.isFrozen(first.passes)).toBe(true);
    expect(Object.isFrozen(first.passes[0])).toBe(true);
    expect(Object.isFrozen(first.passes[0]?.operations)).toBe(true);
    expect(Object.isFrozen(first.passes[0]?.operations[0]?.params)).toBe(true);
    expect(first.source.renderKinds).toEqual(["shape", "text", "three-d"]);
    expect(first.dirtyRect).toEqual({ x: 2, y: 3, width: 11, height: 12 });
  });

  it("rejects stale sources, stale masks, budget overflow, and aborts before work", async () => {
    const image = rgbaImage(8, 8, () => [90, 100, 110, 255]);
    const plan = planFor(
      [{ id: "invert", engine: "invert" }],
      { maskId: "mask" },
    );
    const recipe = createStudioAdjustmentLayerRuntimeRecipe({
      plan,
      source: { revision: "source-1", width: 8, height: 8, renderKinds: ["vector"] },
      masks: [{ id: "mask", revision: "mask-1" }],
    });
    const mask: StudioAdjustmentLayerMask = {
      id: "mask",
      revision: "mask-1",
      width: 8,
      height: 8,
      data: new Uint8ClampedArray(64).fill(255),
    };
    await expect(executeStudioAdjustmentLayerRuntime(
      recipe,
      sourceFor(image, "source-2"),
      { masks: [mask] },
    )).rejects.toSatisfy((error) => expectRuntimeError(error, "STALE_SOURCE"));
    await expect(executeStudioAdjustmentLayerRuntime(
      recipe,
      sourceFor(image),
      { masks: [{ ...mask, revision: "mask-2" }] },
    )).rejects.toSatisfy((error) => expectRuntimeError(error, "STALE_MASK"));
    expect(() => createStudioAdjustmentLayerRuntimeRecipe({
      plan,
      source: { revision: "source-1", width: 8, height: 8, renderKinds: ["vector"] },
      limits: { maxPixels: 63 },
    })).toThrowError(StudioAdjustmentLayerRuntimeError);
    try {
      createStudioAdjustmentLayerRuntimeRecipe({
        plan,
        source: { revision: "source-1", width: 8, height: 8, renderKinds: ["vector"] },
        limits: { maxPixels: 63 },
      });
    } catch (error) {
      expectRuntimeError(error, "LIMIT_EXCEEDED");
    }

    const controller = new AbortController();
    controller.abort();
    const sourceSnapshot = new Uint8ClampedArray(image.data);
    await expect(executeStudioAdjustmentLayerRuntime(
      recipe,
      sourceFor(image),
      { masks: [mask], signal: controller.signal },
    )).rejects.toSatisfy((error) => expectRuntimeError(error, "ABORTED"));
    expect(image.data).toEqual(sourceSnapshot);
  });

  it("fails closed on stale adapter metadata without committing a partial result", async () => {
    const image = rgbaImage(5, 5, () => [25, 50, 75, 255]);
    const plan = planFor([{ id: "invert", engine: "invert" }]);
    const recipe = createStudioAdjustmentLayerRuntimeRecipe({
      plan,
      source: { revision: "source-1", width: 5, height: 5, renderKinds: ["vector"] },
    });
    const sourceSnapshot = new Uint8ClampedArray(image.data);
    const staleAdapter: StudioAdjustmentLayerFilterAdapter = {
      contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
      id: "stale-test-adapter",
      preservesOperationOrder: true,
      failClosed: true,
      async run(input: StudioAdjustmentLayerFilterAdapterInput) {
        return {
          contractVersion: STUDIO_ADJUSTMENT_LAYER_ADAPTER_CONTRACT_VERSION,
          backend: "test",
          imageData: {
            data: new Uint8ClampedArray(input.imageData.data).fill(0),
            width: input.imageData.width,
            height: input.imageData.height,
          },
          sourceRevision: "stale-source",
          operationsFingerprint: input.operationsFingerprint,
        };
      },
    };

    await expect(executeStudioAdjustmentLayerRuntime(
      recipe,
      sourceFor(image),
      { adapter: staleAdapter },
    )).rejects.toSatisfy((error) => expectRuntimeError(error, "ADAPTER_MISMATCH"));
    expect(image.data).toEqual(sourceSnapshot);
  });

  it("holds the explicitly selected direct adapter to the CPU reference parity contract", async () => {
    const image = rgbaImage(19, 7, (x, y) => [
      (x * 21 + y * 9) % 256,
      (x * 7 + y * 31) % 256,
      (x * 15 + y * 3) % 256,
      255,
    ]);
    const operations: readonly StudioAdjustmentFilterOperation[] = [
      {
        id: "levels",
        engine: "levels",
        enabled: true,
        params: { black: 16, white: 235, gamma: 0.9 },
      },
      {
        id: "noise",
        engine: "noise",
        enabled: true,
        params: { amount: 12, seed: 8 },
      },
    ];
    const input: StudioAdjustmentLayerFilterAdapterInput = {
      imageData: image,
      operations,
      sourceRevision: "parity-source",
      operationsFingerprint: "ops-1",
    };
    const report = await verifyStudioAdjustmentLayerAdapterParity(
      createStudioAdjustmentLayerWorkerAdapter({
        executionMode: "direct",
        workerFactory: null,
      }),
      input,
      { maxChannelDelta: 0, maxDifferentChannelRatio: 0 },
    );

    expect(report).toEqual({
      adapterId: "image-filter-worker",
      comparedChannels: image.data.length,
      differentChannels: 0,
      maximumChannelDelta: 0,
      differentChannelRatio: 0,
    });
    const cpu = await studioAdjustmentLayerCpuAdapter.run(input);
    expect(cpu.imageData.data).not.toEqual(image.data);
  });

  it("fails the selected WebGPU adapter without switching the pass to CPU", async () => {
    const image = rgbaImage(2, 1, () => [32, 64, 96, 255]);
    const input: StudioAdjustmentLayerFilterAdapterInput = {
      imageData: image,
      operations: [{
        id: "levels",
        engine: "levels",
        enabled: true,
        params: { black: 4, white: 240, gamma: 1 },
      }],
      sourceRevision: "webgpu-fail-closed",
      operationsFingerprint: "ops-webgpu",
    };

    await expect(
      createStudioAdjustmentLayerGpuAdapter({ gpu: null }).run(input),
    ).rejects.toMatchObject({ code: "ADAPTER_FAILURE" });
    expect(image.data).toEqual(new Uint8ClampedArray([
      32, 64, 96, 255,
      32, 64, 96, 255,
    ]));
  });
});
