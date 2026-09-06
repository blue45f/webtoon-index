import {
  planStudioHokusaiNaturalMediaRender,
  type StudioHokusaiNaturalMediaPresetId,
  type StudioHokusaiNaturalMediaRenderPlan,
} from "../apps/web/src/domains/creator/render/studio-hokusai-natural-media-contract";
import {
  studioHokusaiNaturalMediaPresetJson,
} from "../apps/web/src/domains/creator/render/studio-hokusai-natural-media-presets";
import {
  applyStudioHokusaiNaturalMediaTextureV2,
} from "../apps/web/src/domains/creator/render/studio-hokusai-natural-media-texture-v2";
import {
  STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
  type StudioHokusaiWorkerOutboundMessage,
} from "../apps/web/src/domains/creator/render/studio-hokusai-natural-media-worker-protocol";

import type { DrawEl } from "../apps/web/src/domains/creator/studio-element-model";

interface DecodedRender {
  readonly pixels: Uint8ClampedArray;
  readonly pngBytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly elapsedMilliseconds: number;
  readonly maxMainThreadDelayMilliseconds: number;
  readonly pixelHash: string;
  readonly plan: StudioHokusaiNaturalMediaRenderPlan;
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly sourceRgbaBytes: number;
  readonly packedRgbaBytes: number;
}

interface QualityMetrics {
  readonly edgeDensity: number;
  readonly localAlphaVariance: number;
  readonly periodicity: number;
  readonly circleCarrierExposure: number;
  readonly startBackMassRatio: number;
  readonly centerlineGaps: number;
  readonly minimumCenterAlpha: number;
  readonly nonZeroPixels: number;
  readonly alphaMean: number;
  readonly medianVerticalSpan: number;
}

interface HokusaiBrushHandle {
  setColorHsv(hue: number, saturation: number, value: number): void;
  setRadiusLog(radiusLogarithmic: number): void;
  free(): void;
}

interface HokusaiCanvasHandle {
  beginStroke(brush: HokusaiBrushHandle, seed: number): void;
  addSample(
    brush: HokusaiBrushHandle,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    timeMilliseconds: number,
  ): void;
  finishStroke(brush: HokusaiBrushHandle): void;
  fullFrame(): Uint8Array;
  free(): void;
}

interface HokusaiRuntime {
  default(): Promise<unknown>;
  HokusaiBrush: new (json: string) => HokusaiBrushHandle;
  HokusaiCanvas: new (
    width: number,
    height: number,
    seed: number,
  ) => HokusaiCanvasHandle;
}

declare global {
  interface Window {
    __studioHokusaiNaturalMediaQualityResult?: unknown;
  }
}

const PRESETS = [
  "pencil",
  "charcoal",
  "oil",
  "calligraphy",
  "marker",
] as const satisfies readonly StudioHokusaiNaturalMediaPresetId[];
const QUALITY_PRESETS = ["pencil", "charcoal", "oil"] as const;
const DOCUMENT = Object.freeze({ width: 860, height: 280 });
let requestSequence = 0;
let baselineRuntimePromise: Promise<HokusaiRuntime> | null = null;

function setting(
  baseValue: number,
  inputs: Readonly<Record<string, readonly (readonly [number, number])[]>> = {},
) {
  return { base_value: baseValue, inputs };
}

function baselinePresetJson(
  presetId: (typeof QUALITY_PRESETS)[number],
): string {
  const settings = (() => {
    switch (presetId) {
      case "pencil":
        return {
          anti_aliasing: setting(1),
          dabs_per_actual_radius: setting(5.82),
          dabs_per_basic_radius: setting(0.51),
          dabs_per_second: setting(70),
          hardness: setting(0.86),
          opaque: setting(0.86, {
            pressure: [[0, -0.78], [0.25, -0.5], [0.62, 0.08], [1, 0.72]],
          }),
          opaque_linearize: setting(0.44),
          opaque_multiply: setting(0, {
            pressure: [[0, 0], [0.02, 0], [0.08, 0.92], [0.3, 1], [1, 1]],
          }),
          radius_logarithmic: setting(1, {
            pressure: [[0, -1.65], [0.25, -1.1], [0.55, -0.25], [1, 1.55]],
          }),
          slow_tracking: setting(3.4),
          slow_tracking_per_dab: setting(1.6),
        };
      case "charcoal":
        return {
          anti_aliasing: setting(0.35),
          dabs_per_actual_radius: setting(10),
          hardness: setting(0.24),
          offset_by_random: setting(0.9, {
            pressure: [[0, 0], [1, -0.68]],
          }),
          opaque: setting(0.48, {
            pressure: [[0, 0], [1, 0.42]],
          }),
          opaque_linearize: setting(0.12),
          opaque_multiply: setting(0, {
            pressure: [[0, 0], [0.05, 0.08], [1, 1]],
          }),
          radius_by_random: setting(0.12),
          radius_logarithmic: setting(0.8, {
            pressure: [[0, -0.45], [1, 0.55]],
          }),
          slow_tracking: setting(1.8),
          tracking_noise: setting(0.12),
        };
      case "oil":
        return {
          anti_aliasing: setting(1),
          dabs_per_actual_radius: setting(7.25),
          dabs_per_basic_radius: setting(0.75),
          hardness: setting(0.62, {
            pressure: [[0, -0.2], [1, 0.28]],
          }),
          opaque: setting(0.76),
          opaque_linearize: setting(0.5),
          opaque_multiply: setting(0, {
            pressure: [[0, 0], [0.08, 0.28], [1, 1]],
          }),
          paint_mode: setting(0.72),
          radius_by_random: setting(0.04),
          radius_logarithmic: setting(1.4, {
            pressure: [[0, -0.6], [1, 0.75]],
          }),
          slow_tracking: setting(2.1),
          slow_tracking_per_dab: setting(0.75),
          smudge: setting(0.2, {
            pressure: [[0, -0.12], [1, 0.16]],
          }),
          smudge_length: setting(0.64),
        };
    }
  })();
  return JSON.stringify({
    version: 3,
    group: "ToonSpectrum natural media QA baseline",
    parent_brush_name: "",
    comment: `Frozen before-quality-v2 ${presetId}`,
    settings,
  });
}

function sha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes.slice()).then((digest) =>
    `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")).join("")}`);
}

function longStroke(retrace = false): DrawEl {
  const points: number[] = [];
  const pressures: number[] = [];
  const tiltXs: number[] = [];
  const tiltYs: number[] = [];
  const speeds: number[] = [];
  const count = 161;
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    points.push(
      50 + progress * 760,
      140
        + Math.sin(progress * Math.PI * 4) * 46
        + Math.sin(progress * Math.PI * 9) * 9,
    );
    pressures.push(
      0.18
        + Math.sin(progress * Math.PI) ** 1.4 * 0.68
        + Math.sin(progress * Math.PI * 5) * 0.04,
    );
    tiltXs.push(28 + Math.sin(progress * Math.PI * 2) * 22);
    tiltYs.push(-18 + Math.cos(progress * Math.PI * 2) * 16);
    speeds.push(0.6 + Math.sin(progress * Math.PI * 3) * 0.15);
  }
  if (retrace) {
    for (let index = count - 2; index >= 0; index -= 1) {
      points.push(points[index * 2] ?? 0, points[index * 2 + 1] ?? 0);
      pressures.push(pressures[index] ?? 0.5);
      tiltXs.push(tiltXs[index] ?? 0);
      tiltYs.push(tiltYs[index] ?? 0);
      speeds.push(speeds[index] ?? 0.5);
    }
  }
  return {
    id: retrace ? "quality-long-retrace" : "quality-long",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    pressures,
    tiltXs,
    tiltYs,
    speeds,
    stroke: "#26211f",
    strokeWidth: 14,
    brush: "natural-media-quality",
  };
}

function pressureStroke(pressure: number): DrawEl {
  const points: number[] = [];
  const pressures: number[] = [];
  const count = 101;
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    points.push(50 + progress * 760, 140 + Math.sin(progress * Math.PI * 2) * 6);
    pressures.push(pressure);
  }
  return {
    id: `quality-pressure-${pressure}`,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    pressures,
    stroke: "#26211f",
    strokeWidth: 14,
    brush: "natural-media-pressure",
  };
}

function plan(
  source: DrawEl,
  presetId: StudioHokusaiNaturalMediaPresetId,
): StudioHokusaiNaturalMediaRenderPlan {
  const result = planStudioHokusaiNaturalMediaRender(
    source,
    {
      presetId,
      color: "#26211f",
      sizeScale: 1,
      opacity: 1,
      seed: 0x0bad_cafe,
    },
    DOCUMENT,
  );
  if (!result.ok) throw new Error(`${presetId} plan failed: ${result.message}`);
  return result.plan;
}

function hexToHsv(color: `#${string}`): readonly [number, number, number] {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [
    hue,
    maximum === 0 ? 0 : delta / maximum,
    maximum,
  ] as const;
}

async function baselineRuntime(): Promise<HokusaiRuntime> {
  baselineRuntimePromise ??= import("../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js"
  ).then(async (candidate) => {
    const runtime = candidate as unknown as HokusaiRuntime;
    await runtime.default();
    return runtime;
  });
  return baselineRuntimePromise;
}

async function encodePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG evidence canvas is unavailable.");
  context.putImageData(new ImageData(pixels.slice(), width, height), 0, 0);
  return new Uint8Array(await (
    await canvas.convertToBlob({ type: "image/png" })
  ).arrayBuffer());
}

async function renderBaseline(
  renderPlan: StudioHokusaiNaturalMediaRenderPlan,
): Promise<DecodedRender> {
  if (
    renderPlan.presetId !== "pencil"
    && renderPlan.presetId !== "charcoal"
    && renderPlan.presetId !== "oil"
  ) {
    throw new Error("The frozen baseline covers natural media only.");
  }
  const startedAt = performance.now();
  const runtime = await baselineRuntime();
  const brush = new runtime.HokusaiBrush(
    baselinePresetJson(renderPlan.presetId),
  );
  const canvas = new runtime.HokusaiCanvas(
    renderPlan.raster.width,
    renderPlan.raster.height,
    renderPlan.seed,
  );
  try {
    const [hue, saturation, value] = hexToHsv(renderPlan.color);
    brush.setColorHsv(hue, saturation, value);
    brush.setRadiusLog(Math.log2(renderPlan.raster.radiusPixels));
    canvas.beginStroke(brush, renderPlan.seed);
    for (const sample of renderPlan.samples) {
      canvas.addSample(
        brush,
        sample.x,
        sample.y,
        sample.pressure,
        sample.tiltX,
        sample.tiltY,
        sample.timeMilliseconds,
      );
    }
    canvas.finishStroke(brush);
    const raw = canvas.fullFrame();
    const pixels = new Uint8ClampedArray(raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength,
    ));
    const pngBytes = await encodePixels(
      pixels,
      renderPlan.raster.width,
      renderPlan.raster.height,
    );
    return {
      pixels,
      pngBytes,
      width: renderPlan.raster.width,
      height: renderPlan.raster.height,
      elapsedMilliseconds: performance.now() - startedAt,
      maxMainThreadDelayMilliseconds: 0,
      pixelHash: await sha256(new Uint8Array(
        pixels.buffer,
        pixels.byteOffset,
        pixels.byteLength,
      )),
      plan: renderPlan,
      dirtyBounds: [
        0,
        0,
        renderPlan.raster.width,
        renderPlan.raster.height,
      ],
      sourceRgbaBytes: pixels.byteLength,
      packedRgbaBytes: pixels.byteLength,
    };
  } finally {
    canvas.free();
    brush.free();
  }
}

async function renderCurrentDirect(
  renderPlan: StudioHokusaiNaturalMediaRenderPlan,
  retrace: boolean,
): Promise<DecodedRender> {
  const startedAt = performance.now();
  const runtime = await baselineRuntime();
  const brush = new runtime.HokusaiBrush(
    studioHokusaiNaturalMediaPresetJson(renderPlan.presetId),
  );
  const canvas = new runtime.HokusaiCanvas(
    renderPlan.raster.width,
    renderPlan.raster.height,
    renderPlan.seed,
  );
  try {
    const [hue, saturation, value] = hexToHsv(renderPlan.color);
    brush.setColorHsv(hue, saturation, value);
    brush.setRadiusLog(Math.log2(renderPlan.raster.radiusPixels));
    canvas.beginStroke(brush, renderPlan.seed);
    for (const sample of renderPlan.samples) {
      canvas.addSample(
        brush,
        sample.x,
        sample.y,
        sample.pressure,
        sample.tiltX,
        sample.tiltY,
        sample.timeMilliseconds,
      );
    }
    canvas.finishStroke(brush);
    if (retrace) {
      canvas.beginStroke(brush, renderPlan.seed ^ 0x6d2b_79f5);
      let timeMilliseconds = 0;
      for (
        let index = renderPlan.samples.length - 1;
        index >= 0;
        index -= 1
      ) {
        const sample = renderPlan.samples[index];
        if (!sample) continue;
        const next = renderPlan.samples[index + 1];
        if (next) {
          timeMilliseconds += Math.max(
            0.1,
            next.timeMilliseconds - sample.timeMilliseconds,
          );
        }
        canvas.addSample(
          brush,
          sample.x,
          sample.y,
          sample.pressure,
          sample.tiltX,
          sample.tiltY,
          timeMilliseconds,
        );
      }
      canvas.finishStroke(brush);
    }
    const raw = canvas.fullFrame();
    const textured = new Uint8Array(raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength,
    ));
    applyStudioHokusaiNaturalMediaTextureV2(
      textured,
      renderPlan,
      {
        frameBounds: [
          0,
          0,
          renderPlan.raster.width,
          renderPlan.raster.height,
        ],
        dirtyBounds: [
          0,
          0,
          renderPlan.raster.width,
          renderPlan.raster.height,
        ],
      },
    );
    const sourcePixels = new Uint8ClampedArray(textured.buffer);
    const pngBytes = await encodePixels(
      sourcePixels,
      renderPlan.raster.width,
      renderPlan.raster.height,
    );
    const normalized = await decode(pngBytes);
    normalized.bitmap.close();
    return {
      pixels: normalized.pixels,
      pngBytes,
      width: normalized.width,
      height: normalized.height,
      elapsedMilliseconds: performance.now() - startedAt,
      maxMainThreadDelayMilliseconds: 0,
      pixelHash: await sha256(new Uint8Array(
        normalized.pixels.buffer,
        normalized.pixels.byteOffset,
        normalized.pixels.byteLength,
      )),
      plan: renderPlan,
      dirtyBounds: [
        0,
        0,
        renderPlan.raster.width,
        renderPlan.raster.height,
      ],
      sourceRgbaBytes: normalized.pixels.byteLength,
      packedRgbaBytes: normalized.pixels.byteLength,
    };
  } finally {
    canvas.free();
    brush.free();
  }
}

async function decode(
  pngBytes: Uint8Array,
): Promise<Readonly<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}>> {
  const bitmap = await createImageBitmap(new Blob([pngBytes], {
    type: "image/png",
  }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D readback context is unavailable.");
  context.drawImage(bitmap, 0, 0);
  return {
    pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
  };
}

function reconstructPackedDirtyFrame(
  packed: Uint8ClampedArray,
  packedWidth: number,
  packedHeight: number,
  renderPlan: StudioHokusaiNaturalMediaRenderPlan,
  dirtyBounds: readonly [number, number, number, number],
): Uint8ClampedArray {
  const [dirtyX, dirtyY, dirtyWidth, dirtyHeight] = dirtyBounds;
  if (
    packedWidth !== dirtyWidth
    || packedHeight !== dirtyHeight
    || packed.byteLength !== dirtyWidth * dirtyHeight * 4
    || dirtyX < 0
    || dirtyY < 0
    || dirtyWidth <= 0
    || dirtyHeight <= 0
    || dirtyX + dirtyWidth > renderPlan.raster.width
    || dirtyY + dirtyHeight > renderPlan.raster.height
  ) {
    throw new Error("Hokusai packed dirty-frame geometry is invalid.");
  }
  const full = new Uint8ClampedArray(
    renderPlan.raster.width * renderPlan.raster.height * 4,
  );
  for (let row = 0; row < dirtyHeight; row += 1) {
    const sourceStart = row * dirtyWidth * 4;
    const destinationStart = (
      (dirtyY + row) * renderPlan.raster.width
      + dirtyX
    ) * 4;
    full.set(
      packed.subarray(sourceStart, sourceStart + dirtyWidth * 4),
      destinationStart,
    );
  }
  return full;
}

async function render(
  renderPlan: StudioHokusaiNaturalMediaRenderPlan,
): Promise<DecodedRender> {
  const startedAt = performance.now();
  let maximumDelay = 0;
  let expectedTick = startedAt + 4;
  const timer = window.setInterval(() => {
    const now = performance.now();
    maximumDelay = Math.max(maximumDelay, now - expectedTick);
    expectedTick = now + 4;
  }, 4);
  const worker = new Worker(
    new URL("../apps/web/src/domains/creator/render/studio-hokusai-natural-media.worker.ts",
      import.meta.url,
    ),
    { type: "module", name: "studio-hokusai-quality-browser" },
  );
  try {
    const response = await new Promise<StudioHokusaiWorkerOutboundMessage>(
      (resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Hokusai Worker timed out."));
        }, 30_000);
        worker.addEventListener("error", (event) => {
          window.clearTimeout(timeout);
          reject(new Error(event.message || "Hokusai Worker failed."));
        }, { once: true });
        worker.addEventListener("message", (event) => {
          const message = event.data as StudioHokusaiWorkerOutboundMessage;
          if (message.type === "studio-hokusai/failure") {
            window.clearTimeout(timeout);
            reject(new Error(`${message.reason}: ${message.detail}`));
            return;
          }
          if (message.type !== "studio-hokusai/ready") return;
          worker.postMessage({
            type: "studio-hokusai/render",
            version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
            requestId: ++requestSequence,
            engineEpoch: 1,
            plan: renderPlan,
          });
          worker.addEventListener("message", (resultEvent) => {
            const result =
              resultEvent.data as StudioHokusaiWorkerOutboundMessage;
            if (result.type === "studio-hokusai/ready") return;
            window.clearTimeout(timeout);
            resolve(result);
          }, { once: true });
        });
      },
    );
    if (response.type !== "studio-hokusai/result") {
      throw new Error("Hokusai Worker returned no render result.");
    }
    const pngBytes = new Uint8Array(response.pngBytes);
    const decoded = await decode(pngBytes);
    decoded.bitmap.close();
    const pixels = reconstructPackedDirtyFrame(
      decoded.pixels,
      decoded.width,
      decoded.height,
      renderPlan,
      response.receipt.dirtyBounds,
    );
    return {
      pixels,
      pngBytes,
      width: renderPlan.raster.width,
      height: renderPlan.raster.height,
      elapsedMilliseconds: performance.now() - startedAt,
      maxMainThreadDelayMilliseconds: maximumDelay,
      pixelHash: await sha256(new Uint8Array(
        pixels.buffer,
        pixels.byteOffset,
        pixels.byteLength,
      )),
      plan: renderPlan,
      dirtyBounds: response.receipt.dirtyBounds,
      sourceRgbaBytes:
        renderPlan.raster.width * renderPlan.raster.height * 4,
      packedRgbaBytes: decoded.pixels.byteLength,
    };
  } finally {
    window.clearInterval(timer);
    worker.terminate();
  }
}

function alphaAt(
  render: DecodedRender,
  x: number,
  y: number,
  radius = 1,
): number {
  let maximum = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = Math.round(x + offsetX);
      const sampleY = Math.round(y + offsetY);
      if (
        sampleX < 0
        || sampleY < 0
        || sampleX >= render.width
        || sampleY >= render.height
      ) continue;
      maximum = Math.max(
        maximum,
        render.pixels[(sampleY * render.width + sampleX) * 4 + 3] ?? 0,
      );
    }
  }
  return maximum;
}

function localResidual(values: readonly number[], radius: number): number[] {
  return values.map((value, index) => {
    let sum = 0;
    let count = 0;
    for (
      let neighbour = Math.max(0, index - radius);
      neighbour <= Math.min(values.length - 1, index + radius);
      neighbour += 1
    ) {
      sum += values[neighbour] ?? 0;
      count += 1;
    }
    return value - sum / count;
  });
}

function normalizedPeriodicity(values: readonly number[]): number {
  const residual = localResidual(values, 8);
  const energy = residual.reduce((sum, value) => sum + value * value, 0);
  if (energy <= 0.000_001) return 0;
  let maximum = 0;
  for (let lag = 3; lag <= Math.min(24, residual.length / 3); lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < residual.length; index += 1) {
      const left = residual[index] ?? 0;
      const right = residual[index - lag] ?? 0;
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    if (denominator > 0) maximum = Math.max(maximum, correlation / denominator);
  }
  return Math.max(0, maximum);
}

function startBackMassRatio(render: DecodedRender): number {
  const origin = render.plan.samples[0];
  if (!origin) return 0;
  let tangentX = 1;
  let tangentY = 0;
  for (
    let index = 1;
    index < Math.min(render.plan.samples.length, 12);
    index += 1
  ) {
    const sample = render.plan.samples[index];
    if (!sample) continue;
    const deltaX = sample.x - origin.x;
    const deltaY = sample.y - origin.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 0.25) continue;
    tangentX = deltaX / length;
    tangentY = deltaY / length;
    break;
  }
  const normalX = -tangentY;
  const normalY = tangentX;
  const radius = Math.max(3, render.plan.raster.radiusPixels * 1.25);
  let backMass = 0;
  let forwardMass = 0;
  const minimumX = Math.max(0, Math.floor(origin.x - radius * 1.5));
  const maximumX = Math.min(
    render.width - 1,
    Math.ceil(origin.x + radius * 1.5),
  );
  const minimumY = Math.max(0, Math.floor(origin.y - radius * 1.5));
  const maximumY = Math.min(
    render.height - 1,
    Math.ceil(origin.y + radius * 1.5),
  );
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const relativeX = x - origin.x;
      const relativeY = y - origin.y;
      const along = relativeX * tangentX + relativeY * tangentY;
      const across = Math.abs(relativeX * normalX + relativeY * normalY);
      if (across > radius || Math.abs(along) > radius) continue;
      const alpha = render.pixels[(y * render.width + x) * 4 + 3] ?? 0;
      if (along < 0) backMass += alpha;
      else forwardMass += alpha;
    }
  }
  return backMass / Math.max(1, forwardMass);
}

function qualityMetrics(render: DecodedRender): QualityMetrics {
  let nonZeroPixels = 0;
  let alphaSum = 0;
  let alphaSquareSum = 0;
  let edgeCount = 0;
  let neighbourCount = 0;
  const verticalSpans: number[] = [];
  for (let y = 1; y < render.height - 1; y += 1) {
    for (let x = 1; x < render.width - 1; x += 1) {
      const index = (y * render.width + x) * 4 + 3;
      const alpha = render.pixels[index] ?? 0;
      if (alpha <= 0) continue;
      nonZeroPixels += 1;
      alphaSum += alpha;
      alphaSquareSum += alpha * alpha;
      const right = render.pixels[index + 4] ?? 0;
      const down = render.pixels[index + render.width * 4] ?? 0;
      edgeCount += Math.abs(alpha - right) >= 12 ? 1 : 0;
      edgeCount += Math.abs(alpha - down) >= 12 ? 1 : 0;
      neighbourCount += 2;
    }
  }
  for (let x = 1; x < render.width - 1; x += 1) {
    let minimumY = render.height;
    let maximumY = -1;
    for (let y = 1; y < render.height - 1; y += 1) {
      const alpha = render.pixels[(y * render.width + x) * 4 + 3] ?? 0;
      if (alpha < 8) continue;
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
    }
    if (maximumY >= minimumY) verticalSpans.push(maximumY - minimumY + 1);
  }
  verticalSpans.sort((left, right) => left - right);
  const middle = Math.floor(verticalSpans.length / 2);
  const medianVerticalSpan = verticalSpans.length === 0
    ? 0
    : verticalSpans.length % 2 === 0
      ? ((verticalSpans[middle - 1] ?? 0) + (verticalSpans[middle] ?? 0)) / 2
      : verticalSpans[middle] ?? 0;
  const centerline = render.plan.samples.map((sample) =>
    alphaAt(render, sample.x, sample.y, 1));
  const mean = nonZeroPixels > 0 ? alphaSum / nonZeroPixels : 0;
  const variance = nonZeroPixels > 0
    ? Math.max(0, alphaSquareSum / nonZeroPixels - mean * mean)
    : 0;
  const periodicity = normalizedPeriodicity(centerline);
  return {
    edgeDensity: neighbourCount > 0 ? edgeCount / neighbourCount : 0,
    localAlphaVariance: variance,
    periodicity,
    circleCarrierExposure:
      periodicity * Math.min(1, Math.sqrt(variance) / 64),
    startBackMassRatio: startBackMassRatio(render),
    centerlineGaps: centerline.filter((alpha) => alpha <= 0).length,
    minimumCenterAlpha: Math.min(...centerline),
    nonZeroPixels,
    alphaMean: mean / 255,
    medianVerticalSpan,
  };
}

function alphaDecreasePixels(
  onePass: DecodedRender,
  retraced: DecodedRender,
): number {
  if (onePass.width !== retraced.width || onePass.height !== retraced.height) {
    throw new Error("one-pass/retrace rasters are not comparable.");
  }
  let decreases = 0;
  for (let index = 3; index < onePass.pixels.length; index += 4) {
    if ((retraced.pixels[index] ?? 0) < (onePass.pixels[index] ?? 0)) {
      decreases += 1;
    }
  }
  return decreases;
}

function checkerCanvas(render: DecodedRender): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = render.width;
  canvas.height = render.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("visual evidence canvas is unavailable.");
  context.putImageData(
    new ImageData(render.pixels.slice(), render.width, render.height),
    0,
    0,
  );
  return canvas;
}

function addRenderCard(
  section: HTMLElement,
  title: string,
  render: DecodedRender,
  metrics: QualityMetrics,
): void {
  const card = document.createElement("article");
  card.className = "card";
  const header = document.createElement("header");
  header.innerHTML = `<strong>${title}</strong><span>${
    render.elapsedMilliseconds.toFixed(1)
  }ms · main ${render.maxMainThreadDelayMilliseconds.toFixed(1)}ms</span>`;
  const meta = document.createElement("p");
  meta.textContent =
    `edge ${metrics.edgeDensity.toFixed(3)} · variance ${
      metrics.localAlphaVariance.toFixed(1)
    } · periodicity ${metrics.periodicity.toFixed(3)} · circle ${
      metrics.circleCarrierExposure.toFixed(3)
    } · start-back ${metrics.startBackMassRatio.toFixed(3)} · gaps ${
      metrics.centerlineGaps
    }`;
  const frame = document.createElement("div");
  frame.className = "frame";
  frame.append(checkerCanvas(render));
  card.append(header, frame, meta);
  section.append(card);
}

function addPressureCard(
  section: HTMLElement,
  presetId: StudioHokusaiNaturalMediaPresetId,
  low: DecodedRender,
  high: DecodedRender,
): void {
  const card = document.createElement("article");
  card.className = "card pressure";
  const header = document.createElement("header");
  header.innerHTML = `<strong>${presetId}</strong><span>pressure 0.18 → 0.86</span>`;
  const lowFrame = document.createElement("div");
  lowFrame.className = "frame half";
  lowFrame.dataset.label = "low";
  lowFrame.append(checkerCanvas(low));
  const highFrame = document.createElement("div");
  highFrame.className = "frame half";
  highFrame.dataset.label = "high";
  highFrame.append(checkerCanvas(high));
  const pair = document.createElement("div");
  pair.className = "pressure-pair";
  pair.append(lowFrame, highFrame);
  card.append(header, pair);
  section.append(card);
}

function startCropCanvas(render: DecodedRender): HTMLCanvasElement {
  const origin = render.plan.samples[0];
  if (!origin) return checkerCanvas(render);
  const radius = Math.max(8, render.plan.raster.radiusPixels);
  const sourceX = Math.max(0, Math.floor(origin.x - radius * 2));
  const sourceY = Math.max(0, Math.floor(origin.y - radius * 2));
  const sourceWidth = Math.min(
    render.width - sourceX,
    Math.ceil(radius * 6),
  );
  const sourceHeight = Math.min(
    render.height - sourceY,
    Math.ceil(radius * 4),
  );
  const source = checkerCanvas(render);
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("start-cap evidence canvas is unavailable.");
  context.fillStyle = "#faf8f4";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function addStartCapCard(
  section: HTMLElement,
  presetId: StudioHokusaiNaturalMediaPresetId,
  before: DecodedRender,
  after: DecodedRender,
): void {
  const card = document.createElement("article");
  card.className = "card pressure";
  const header = document.createElement("header");
  header.innerHTML =
    `<strong>${presetId}</strong><span>identical start · frozen → v2</span>`;
  const beforeFrame = document.createElement("div");
  beforeFrame.className = "frame half";
  beforeFrame.dataset.label = "before";
  beforeFrame.append(startCropCanvas(before));
  const afterFrame = document.createElement("div");
  afterFrame.className = "frame half";
  afterFrame.dataset.label = "after";
  afterFrame.append(startCropCanvas(after));
  const pair = document.createElement("div");
  pair.className = "pressure-pair";
  pair.append(beforeFrame, afterFrame);
  card.append(header, pair);
  section.append(card);
}

async function main(): Promise<void> {
  const beforeSection = document.querySelector<HTMLElement>("#before");
  const afterSection = document.querySelector<HTMLElement>("#after");
  const pressureSection = document.querySelector<HTMLElement>("#pressure");
  const startCapSection = document.querySelector<HTMLElement>("#start-caps");
  if (!beforeSection || !afterSection || !pressureSection || !startCapSection) {
    throw new Error("quality evidence sections are missing.");
  }

  // The first product render intentionally happens before the QA-only direct
  // baseline imports the same WASM asset. This keeps the reported cold-start
  // timing honest for the Dedicated Worker route.
  const coldPencilPlan = plan(longStroke(false), "pencil");
  const coldPencil = await render(coldPencilPlan);
  const firstLoadMilliseconds = coldPencil.elapsedMilliseconds;
  let maximumMainThreadDelay = coldPencil.maxMainThreadDelayMilliseconds;

  const beforeResults: Record<string, unknown> = {};
  const beforeRenders = new Map<
    (typeof QUALITY_PRESETS)[number],
    DecodedRender
  >();
  for (const presetId of QUALITY_PRESETS) {
    const before = await renderBaseline(plan(longStroke(false), presetId));
    beforeRenders.set(presetId, before);
    const metrics = qualityMetrics(before);
    addRenderCard(beforeSection, `${presetId} · before`, before, metrics);
    beforeResults[presetId] = {
      elapsedMilliseconds: before.elapsedMilliseconds,
      pixelHash: before.pixelHash,
      ...metrics,
    };
  }

  const longResults: Record<string, unknown> = {};
  const afterRenders = new Map<
    (typeof QUALITY_PRESETS)[number],
    DecodedRender
  >();
  for (const [index, presetId] of PRESETS.entries()) {
    const currentPlan = plan(longStroke(false), presetId);
    const onePass = index === 0 ? coldPencil : await render(currentPlan);
    maximumMainThreadDelay = Math.max(
      maximumMainThreadDelay,
      onePass.maxMainThreadDelayMilliseconds,
    );
    const metrics = qualityMetrics(onePass);
    addRenderCard(afterSection, `${presetId} · after`, onePass, metrics);

    const deterministic = await render(currentPlan);
    maximumMainThreadDelay = Math.max(
      maximumMainThreadDelay,
      deterministic.maxMainThreadDelayMilliseconds,
    );
    const isQualityPreset = QUALITY_PRESETS.includes(
      presetId as (typeof QUALITY_PRESETS)[number],
    );
    if (isQualityPreset) {
      afterRenders.set(
        presetId as (typeof QUALITY_PRESETS)[number],
        onePass,
      );
    }
    const directOnePass = isQualityPreset
      ? await renderCurrentDirect(currentPlan, false)
      : null;
    const directRetraced = isQualityPreset
      ? await renderCurrentDirect(currentPlan, true)
      : null;
    longResults[presetId] = {
      elapsedMilliseconds: onePass.elapsedMilliseconds,
      maxMainThreadDelayMilliseconds: onePass.maxMainThreadDelayMilliseconds,
      pixelHash: onePass.pixelHash,
      dirtyBounds: onePass.dirtyBounds,
      sourceRgbaBytes: onePass.sourceRgbaBytes,
      packedRgbaBytes: onePass.packedRgbaBytes,
      packedRgbaRatio:
        onePass.packedRgbaBytes / onePass.sourceRgbaBytes,
      deterministicPixel:
        onePass.pixelHash === deterministic.pixelHash
        && onePass.pixels.every((value, byteIndex) =>
          value === deterministic.pixels[byteIndex]),
      deterministicPng: await sha256(onePass.pngBytes)
        === await sha256(deterministic.pngBytes),
      directPixelParity: directOnePass
        ? onePass.pixelHash === directOnePass.pixelHash
        : null,
      alphaDecreasePixels:
        directOnePass && directRetraced
          ? alphaDecreasePixels(directOnePass, directRetraced)
          : null,
      ...metrics,
    };
  }

  for (const presetId of QUALITY_PRESETS) {
    const before = beforeRenders.get(presetId);
    const after = afterRenders.get(presetId);
    if (before && after) {
      addStartCapCard(startCapSection, presetId, before, after);
    }
  }

  const pressureResults: Record<string, unknown> = {};
  for (const presetId of QUALITY_PRESETS) {
    const low = await render(plan(pressureStroke(0.18), presetId));
    const high = await render(plan(pressureStroke(0.86), presetId));
    const lowMetrics = qualityMetrics(low);
    const highMetrics = qualityMetrics(high);
    addPressureCard(pressureSection, presetId, low, high);
    pressureResults[presetId] = {
      low: lowMetrics,
      high: highMetrics,
      inkMassRatio:
        highMetrics.nonZeroPixels * highMetrics.alphaMean
        / Math.max(1, lowMetrics.nonZeroPixels * lowMetrics.alphaMean),
      widthRatio:
        highMetrics.medianVerticalSpan
        / Math.max(1, lowMetrics.medianVerticalSpan),
    };
  }

  window.__studioHokusaiNaturalMediaQualityResult = {
    status: "ok",
    backend:
      "real-chromium-dedicated-worker-hokusai-wasm-packed-dirty-frame-v2",
    firstLoadMilliseconds,
    maximumMainThreadDelayMilliseconds: maximumMainThreadDelay,
    before: beforeResults,
    after: longResults,
    pressure: pressureResults,
  };
  document.body.dataset.ready = "true";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  window.__studioHokusaiNaturalMediaQualityResult = {
    status: "error",
    message,
    stack: error instanceof Error ? error.stack ?? null : null,
  };
  document.body.dataset.ready = "error";
  const output = document.createElement("pre");
  output.textContent = message;
  document.body.append(output);
});
