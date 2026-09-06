/// <reference lib="webworker" />

import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
  type StudioHokusaiNaturalMediaRenderPlan,
} from "./studio-hokusai-natural-media-contract";
import {
  studioHokusaiNaturalMediaPresetJson,
} from "./studio-hokusai-natural-media-presets";
import {
  applyStudioHokusaiNaturalMediaTextureV2,
} from "./studio-hokusai-natural-media-texture-v2";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
  snapshotStudioHokusaiWorkerRenderMessage,
  studioHokusaiWorkerResultTransfers,
  type StudioHokusaiWorkerFailureMessage,
  type StudioHokusaiWorkerOutboundMessage,
  type StudioHokusaiWorkerResultMessage,
} from "./studio-hokusai-natural-media-worker-protocol";

interface StudioHokusaiBrushHandle {
  setColorHsv(hue: number, saturation: number, value: number): void;
  setRadiusLog(radiusLogarithmic: number): void;
  dispose?(): void;
  free?(): void;
}

interface StudioHokusaiCanvasHandle {
  beginStroke(brush: StudioHokusaiBrushHandle, seed: number): void;
  addSample(
    brush: StudioHokusaiBrushHandle,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    timeMilliseconds: number,
  ): void;
  finishStroke(brush: StudioHokusaiBrushHandle): void;
  dirtyBounds(): Int32Array;
  dirtyFrame(): Uint8Array;
  reset(): void;
  dispose?(): void;
  free?(): void;
}

interface StudioHokusaiRuntimeModule {
  default(input?: unknown): Promise<unknown>;
  HokusaiBrush: new (mybJson: string) => StudioHokusaiBrushHandle;
  HokusaiCanvas: new (
    width: number,
    height: number,
    seed: number,
  ) => StudioHokusaiCanvasHandle;
}

interface StudioHokusaiWorkerScope {
  readonly constructor?: Readonly<{ name?: string }>;
  onmessage:
    | ((event: MessageEvent<unknown>) => void)
    | null;
  onmessageerror:
    | ((event: MessageEvent<unknown>) => void)
    | null;
  postMessage(
    message: StudioHokusaiWorkerOutboundMessage,
    transfer?: readonly Transferable[],
  ): void;
  close(): void;
}

const workerScope =
  globalThis as unknown as StudioHokusaiWorkerScope;
let requestAccepted = false;

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

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digestSource =
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    digestSource,
  );
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function safeDetail(error: unknown, fallback: string): string {
  const detail = error instanceof Error && error.message
    ? error.message
    : fallback;
  return detail.slice(0, 512);
}

function failure(
  requestId: number | null,
  reason: StudioHokusaiWorkerFailureMessage["reason"],
  detail: string,
): void {
  workerScope.postMessage({
    type: "studio-hokusai/failure",
    version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
    requestId,
    reason,
    detail: detail.slice(0, 512),
  });
}

function disposeHandle(
  handle: { dispose?(): void; free?(): void } | null,
): void {
  if (!handle) return;
  try {
    if (typeof handle.dispose === "function") handle.dispose();
    else handle.free?.();
  } catch {
    // The one-shot Worker is about to close. Teardown must not mask a valid
    // render result or replace the primary failure.
  }
}

async function loadRuntime(): Promise<StudioHokusaiRuntimeModule> {
  const runtime = await import("../../../../../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js"
  ) as unknown as StudioHokusaiRuntimeModule;
  if (
    typeof runtime.default !== "function"
    || typeof runtime.HokusaiBrush !== "function"
    || typeof runtime.HokusaiCanvas !== "function"
  ) {
    throw new Error("Hokusai WASM exports are incomplete.");
  }
  await runtime.default();
  return runtime;
}

function normalizedDirtyBounds(
  value: Int32Array,
  width: number,
  height: number,
): readonly [number, number, number, number] | null {
  if (!(value instanceof Int32Array) || value.length !== 4) return null;
  const [x, y, dirtyWidth, dirtyHeight] = value;
  if (
    x === undefined
    || y === undefined
    || dirtyWidth === undefined
    || dirtyHeight === undefined
    || x < 0
    || y < 0
    || dirtyWidth <= 0
    || dirtyHeight <= 0
    || x + dirtyWidth > width
    || y + dirtyHeight > height
  ) {
    return null;
  }
  return [x, y, dirtyWidth, dirtyHeight] as const;
}

function applyOpacity(pixels: Uint8Array, opacity: number): void {
  if (opacity >= 1) return;
  for (let index = 3; index < pixels.length; index += 4) {
    pixels[index] = Math.round((pixels[index] ?? 0) * opacity);
  }
}

function hasVisiblePixel(pixels: Uint8Array): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 0) > 0) return true;
  }
  return false;
}

async function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
    willReadFrequently: false,
  });
  if (!context) throw new Error("OffscreenCanvas 2D is unavailable.");
  const imageData = context.createImageData(width, height);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  canvas.width = 1;
  canvas.height = 1;
  if (
    blob.type !== "image/png"
    || blob.size <= 0
    || blob.size > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxPngBytes
  ) {
    throw new Error("Hokusai PNG output is invalid or over budget.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
  ) {
    throw new Error("Hokusai PNG signature is invalid.");
  }
  return bytes;
}

async function render(
  runtime: StudioHokusaiRuntimeModule,
  plan: StudioHokusaiNaturalMediaRenderPlan,
): Promise<Readonly<{
  pixels: Uint8Array;
  pngBytes: Uint8Array;
  dirtyBounds: readonly [number, number, number, number];
}>> {
  let brush: StudioHokusaiBrushHandle | null = null;
  let canvas: StudioHokusaiCanvasHandle | null = null;
  try {
    brush = new runtime.HokusaiBrush(
      studioHokusaiNaturalMediaPresetJson(plan.presetId),
    );
    const [hue, saturation, value] = hexToHsv(plan.color);
    brush.setColorHsv(hue, saturation, value);
    brush.setRadiusLog(Math.log2(Math.max(0.1, plan.raster.radiusPixels)));
    canvas = new runtime.HokusaiCanvas(
      plan.raster.width,
      plan.raster.height,
      plan.seed,
    );
    canvas.beginStroke(brush, plan.seed);
    for (const sample of plan.samples) {
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
    const dirtyBounds = normalizedDirtyBounds(
      canvas.dirtyBounds(),
      plan.raster.width,
      plan.raster.height,
    );
    if (!dirtyBounds) throw new Error("Hokusai returned no valid dirty tiles.");
    const [, , dirtyWidth, dirtyHeight] = dirtyBounds;
    const pixels = canvas.dirtyFrame();
    if (
      !(pixels instanceof Uint8Array)
      || pixels.byteLength !== dirtyWidth * dirtyHeight * 4
    ) {
      throw new Error("Hokusai returned an invalid packed dirty RGBA frame.");
    }
    applyOpacity(pixels, plan.opacity);
    applyStudioHokusaiNaturalMediaTextureV2(pixels, plan, {
      frameBounds: dirtyBounds,
      dirtyBounds,
    });
    if (!hasVisiblePixel(pixels)) throw new Error("Hokusai returned a blank frame.");
    const pngBytes = await encodePng(
      pixels,
      dirtyWidth,
      dirtyHeight,
    );
    return Object.freeze({ pixels, pngBytes, dirtyBounds });
  } finally {
    disposeHandle(canvas);
    disposeHandle(brush);
  }
}

async function main(): Promise<void> {
  const scopeName = (() => {
    try {
      return Object.getPrototypeOf(globalThis)?.constructor?.name
        ?? workerScope.constructor?.name
        ?? "";
    } catch {
      return "";
    }
  })();
  if (
    scopeName !== "DedicatedWorkerGlobalScope"
    || typeof WebAssembly !== "object"
    || typeof OffscreenCanvas !== "function"
    || typeof globalThis.crypto?.subtle?.digest !== "function"
  ) {
    failure(
      null,
      "runtime-unavailable",
      "Hokusai requires Dedicated Worker, WebAssembly, Web Crypto and OffscreenCanvas.",
    );
    workerScope.close();
    return;
  }

  let runtime: StudioHokusaiRuntimeModule;
  try {
    runtime = await loadRuntime();
  } catch (error) {
    failure(
      null,
      "runtime-unavailable",
      safeDetail(error, "Hokusai WASM could not be initialized."),
    );
    workerScope.close();
    return;
  }

  workerScope.postMessage({
    type: "studio-hokusai/ready",
    version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
    runtime: {
      engine: "reearth-hokusai",
      version: "0.3.0",
      adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
      wasm: true,
      dedicatedWorker: true,
      transparentRgba: true,
      dirtyTiles: true,
      packedDirtyFrame: true,
      mainThreadFallback: false,
    },
  });

  workerScope.onmessageerror = () => {
    if (requestAccepted) return;
    requestAccepted = true;
    failure(null, "invalid-message", "Hokusai Worker could not clone the request.");
    workerScope.close();
  };
  workerScope.onmessage = (event) => {
    if (requestAccepted) {
      failure(
        null,
        "invalid-message",
        "The one-shot Hokusai Worker accepts exactly one render request.",
      );
      workerScope.close();
      return;
    }
    requestAccepted = true;
    const message = snapshotStudioHokusaiWorkerRenderMessage(event.data);
    if (!message) {
      failure(null, "invalid-message", "Hokusai request validation failed.");
      workerScope.close();
      return;
    }
    void (async () => {
      try {
        const output = await render(runtime, message.plan);
        const inputBytes = new TextEncoder().encode(JSON.stringify(message.plan));
        const [inputHash, pixelHash, pngHash] = await Promise.all([
          sha256(inputBytes),
          sha256(output.pixels),
          sha256(output.pngBytes),
        ]);
        const pngBuffer =
          output.pngBytes.buffer instanceof ArrayBuffer
          && output.pngBytes.byteOffset === 0
          && output.pngBytes.byteLength === output.pngBytes.buffer.byteLength
            ? output.pngBytes.buffer
            : output.pngBytes.slice().buffer as ArrayBuffer;
        const response: StudioHokusaiWorkerResultMessage = {
          type: "studio-hokusai/result",
          version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          engineEpoch: message.engineEpoch,
          pngBytes: pngBuffer,
          receipt: {
            kind: "studio-hokusai/receipt",
            version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
            requestId: message.requestId,
            engineEpoch: message.engineEpoch,
            sourceElementId: message.plan.source.elementId,
            presetId: message.plan.presetId,
            materialProfileId: message.plan.materialProfileId,
            seed: message.plan.seed,
            rasterWidth: message.plan.raster.width,
            rasterHeight: message.plan.raster.height,
            outputRasterWidth: output.dirtyBounds[2],
            outputRasterHeight: output.dirtyBounds[3],
            dirtyBounds: output.dirtyBounds,
            pixelLayout: "packed-dirty-rgba8",
            inputHash,
            pixelHash,
            pngHash,
            adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
            execution: "dedicated-worker-wasm-packed-dirty-frame",
            complete: true,
          },
        };
        workerScope.postMessage(
          response,
          studioHokusaiWorkerResultTransfers(response),
        );
      } catch (error) {
        const detail = safeDetail(error, "Hokusai rendering failed.");
        failure(
          message.requestId,
          detail.includes("blank") ? "blank-output" : "render-failed",
          detail,
        );
      } finally {
        workerScope.close();
      }
    })();
  };
}

void main();
