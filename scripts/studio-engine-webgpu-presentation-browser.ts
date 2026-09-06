/**
 * Real-browser integration probe for the shared RGBA16F presentation owner and the strict
 * `presentationOnly` textured-brush runtime. This file is loaded by Vite in Chromium; it never
 * substitutes fake GPU objects when WebGPU is unavailable.
 */

import {
  createStudioEngineWebGpuPresentationSurface,
  type StudioEngineWebGpuPresentationFrameLease,
  type StudioEngineWebGpuPresentationLayout,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-presentation-surface";
import {
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-textured-brush-plan";
import {
  createStudioEngineWebGpuTexturedBrushRuntime,
} from "../apps/web/src/domains/creator/render/studio-engine-webgpu-textured-brush-runtime";
import { sha256HexPortable } from "../apps/web/src/domains/creator/studio-sha256";

const INITIAL_DEVICE_EPOCH = 1;
const MAP_READ = 0x0001;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_COPY_SRC = 0x0004;
const ROW_ALIGNMENT = 256;
const RGBA16_BYTES_PER_PIXEL = 8;
const DEVICE_LOSS_TIMEOUT_MS = 5_000;

interface BrowserCapabilities {
  readonly webgpu: boolean;
  readonly offscreenCanvas: boolean;
  readonly webgpuCanvasContext: boolean;
  readonly userAgent: string;
}

interface PixelBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface LinearSurfaceEvidence {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly nonZeroAlphaPixels: number;
  readonly maxAlpha: number;
  readonly bounds: PixelBounds | null;
}

interface CanvasPresentationEvidence {
  readonly available: boolean;
  readonly reason: string | null;
  readonly nonZeroAlphaPixels: number;
  readonly maxRed: number;
  readonly maxAlpha: number;
}

type BrowserPresentationResult =
  | Readonly<{
      status: "ok";
      backend: "real-chromium-webgpu-presentation";
      capabilities: BrowserCapabilities;
      adapterInfo: {
        vendor: string;
        architecture: string;
        device: string;
        description: string;
        isFallbackAdapter: boolean | null;
      };
      canvasFormat: GPUTextureFormat;
      initial: {
        configuration: {
          physicalWidth: number;
          physicalHeight: number;
          dpr: number;
          presentationEpoch: number;
          resizeEpoch: number;
          viewportEpoch: number;
          flipEpoch: number;
        };
        missingLeaseReason: string;
        renderReceipt: {
          requestSequence: number;
          renderTarget: string;
          sourceFrameFingerprint: string;
          workSurfaceEpoch: number | null;
          complete: boolean;
        };
        presentationReceipt: {
          requestSequence: number;
          sourceFrameFingerprint: string;
          workSurfaceEpoch: number;
          width: number;
          height: number;
          visible: boolean;
          complete: boolean;
        };
        visibilityAuthorized: boolean;
        linearSurface: LinearSurfaceEvidence;
        canvas: CanvasPresentationEvidence;
      };
      resized: {
        allocation: string;
        canvasWidth: number;
        canvasHeight: number;
        workSurfaceEpoch: number;
        linearSurface: LinearSurfaceEvidence;
        receiptWidth: number;
        receiptHeight: number;
        flipX: boolean;
      };
      contentAuthority: {
        initialGeneration: number;
        initialFingerprint: string;
        appendBaseGeneration: number;
        appendBaseFingerprint: string;
        appendGeneration: number;
        appendFingerprint: string;
        chainLinked: boolean;
      };
      staleLease: {
        runtimeStatus: string;
        runtimeReason: string | null;
        ownerStatus: string;
        ownerReason: string | null;
        abortStatus: string;
      };
      disposal: {
        visibilityReason: string | null;
        surfaceStatus: string;
        configureStatus: string;
        configureReason: string | null;
        externallyOwnedDeviceUsable: boolean;
        deviceLossReason: string;
      };
      diagnostics: {
        uncapturedErrors: readonly string[];
        validationError: string | null;
      };
    }>
  | Readonly<{
      status: "unsupported";
      reason:
        | "adapter-unavailable"
        | "context-unavailable"
        | "device-request-failed"
        | "offscreen-canvas-unavailable"
        | "webgpu-unavailable";
      message: string;
      capabilities: BrowserCapabilities;
    }>
  | Readonly<{
      status: "error";
      message: string;
      stack: string | null;
      capabilities: BrowserCapabilities;
    }>;

declare global {
  interface Window {
    __studioEngineWebGpuPresentationResult?: BrowserPresentationResult;
  }
}

function capabilities(): BrowserCapabilities {
  const offscreenCanvas = typeof OffscreenCanvas !== "undefined";
  let webgpuCanvasContext = false;
  if (offscreenCanvas) {
    try {
      webgpuCanvasContext = new OffscreenCanvas(1, 1).getContext("webgpu") !== null;
    } catch {
      webgpuCanvasContext = false;
    }
  }
  return {
    webgpu: typeof navigator.gpu !== "undefined",
    offscreenCanvas,
    webgpuCanvasContext,
    userAgent: navigator.userAgent,
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function float16ToFloat32(value: number): number {
  const sign = (value & 0x8000) === 0 ? 1 : -1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * (fraction === 0 ? 0 : 2 ** -14 * (fraction / 1024));
  }
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function planWithFingerprint(): StudioEngineWebGpuTexturedBrushPlan {
  const bytes = new Uint8Array([255, 255, 255, 255]);
  const plan: StudioEngineWebGpuTexturedBrushPlan = {
    kind: "studio-engine-webgpu-textured-brush-plan",
    version: 1,
    loweringVersion: 1,
    mode: "rebuild",
    strokeId: "presentation-browser-stroke",
    commandSequence: 1,
    dualTip: "extension-required",
    textureFormat: "rgba16float",
    colorModel: "scene-linear-premultiplied",
    tip: {
      assetIndex: 0,
      channel: "alpha",
      filtering: "bilinear",
      edgeMode: "transparent-zero-border",
      hardnessTransfer: "zero-to-one-smoothstep",
    },
    grain: null,
    assets: [{
      assetIndex: 0,
      role: "tip",
      assetId: "presentation-browser-solid-tip",
      contentHash: `sha256:${sha256HexPortable(bytes)}`,
      width: 2,
      height: 2,
      channel: "alpha",
      format: "r8-unorm",
      byteLength: bytes.byteLength,
      bytes,
    }],
    dabs: [{
      index: 0,
      stationX: 20,
      stationY: 16,
      x: 20,
      y: 16,
      pressure: 0.75,
      diameter: 14,
      opacity: 1,
      flow: 1,
      grainDepth: 0,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [1, 0.04, 0.01, 1],
      },
      composite: { porterDuff: "source-over", blendMode: "normal" },
      tip: {
        hardness: 0.9,
        roundness: 1,
        angleRadians: 0,
        localToDocument: [7, 0, 0, 7],
      },
    }],
    batches: [{
      key: "presentation-browser-solid-tip|none|source-over",
      tipAssetIndex: 0,
      grainAssetIndex: null,
      porterDuff: "source-over",
      firstInstance: 0,
      instanceCount: 1,
    }],
  };
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(plan);
  invariant(semanticFingerprint, "textured plan semantic fingerprint failed");
  return { ...plan, semanticFingerprint };
}

function layout(
  presentationEpoch: number,
  resizeEpoch: number,
  viewportEpoch: number,
  flipEpoch: number,
  cssWidth: number,
  cssHeight: number,
  flipX: boolean,
): StudioEngineWebGpuPresentationLayout {
  return {
    presentationEpoch,
    resizeEpoch,
    viewportEpoch,
    flipEpoch,
    cssWidth,
    cssHeight,
    dpr: 2,
    viewport: {
      logicalWidth: cssWidth,
      logicalHeight: cssHeight,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      flipX,
      flipY: false,
    },
  };
}

async function readLinearSurface(
  device: GPUDevice,
  frame: StudioEngineWebGpuPresentationFrameLease,
): Promise<LinearSurfaceEvidence> {
  const { width, height, texture } = frame.workSurface;
  const bytesPerRow = align(width * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT);
  const buffer = device.createBuffer({
    label: "Studio presentation browser RGBA16F readback",
    size: bytesPerRow * height,
    usage: MAP_READ | BUFFER_COPY_DST,
  });
  try {
    const encoder = device.createCommandEncoder({
      label: "Studio presentation browser RGBA16F copy",
    });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const words = new Uint16Array(buffer.getMappedRange());
    let nonZeroAlphaPixels = 0;
    let maxAlpha = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    const wordsPerRow = bytesPerRow / Uint16Array.BYTES_PER_ELEMENT;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = float16ToFloat32(words[y * wordsPerRow + x * 4 + 3]!);
        if (alpha > 0) {
          nonZeroAlphaPixels += 1;
          maxAlpha = Math.max(maxAlpha, alpha);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return {
      width,
      height,
      bytesPerRow,
      nonZeroAlphaPixels,
      maxAlpha,
      bounds: right >= left ? { left, top, right, bottom } : null,
    };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
  }
}

async function readPresentedCanvas(
  source: OffscreenCanvas,
): Promise<CanvasPresentationEvidence> {
  try {
    if (typeof source.transferToImageBitmap !== "function") {
      return {
        available: false,
        reason: "transferToImageBitmap-unavailable",
        nonZeroAlphaPixels: 0,
        maxRed: 0,
        maxAlpha: 0,
      };
    }
    const bitmap = source.transferToImageBitmap();
    try {
      const readback = new OffscreenCanvas(source.width, source.height);
      const context = readback.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return {
          available: false,
          reason: "2d-readback-unavailable",
          nonZeroAlphaPixels: 0,
          maxRed: 0,
          maxAlpha: 0,
        };
      }
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, source.width, source.height).data;
      let nonZeroAlphaPixels = 0;
      let maxRed = 0;
      let maxAlpha = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3]!;
        if (alpha > 0) nonZeroAlphaPixels += 1;
        maxRed = Math.max(maxRed, pixels[index]!);
        maxAlpha = Math.max(maxAlpha, alpha);
      }
      return {
        available: true,
        reason: null,
        nonZeroAlphaPixels,
        maxRed,
        maxAlpha,
      };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      nonZeroAlphaPixels: 0,
      maxRed: 0,
      maxAlpha: 0,
    };
  }
}

function frameRequest(
  requestSequence: number,
  activeLayout: StudioEngineWebGpuPresentationLayout,
  sourceFrameFingerprint: string,
) {
  return {
    requestSequence,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    presentationEpoch: activeLayout.presentationEpoch,
    resizeEpoch: activeLayout.resizeEpoch,
    viewportEpoch: activeLayout.viewportEpoch,
    flipEpoch: activeLayout.flipEpoch,
    sourceFrameFingerprint,
  };
}

function adapterInfo(adapter: GPUAdapter) {
  const info = adapter.info;
  return {
    vendor: String(info?.vendor ?? ""),
    architecture: String(info?.architecture ?? ""),
    device: String(info?.device ?? ""),
    description: String(info?.description ?? ""),
    isFallbackAdapter:
      typeof adapter.isFallbackAdapter === "boolean"
        ? adapter.isFallbackAdapter
        : null,
  };
}

async function run(): Promise<BrowserPresentationResult> {
  const browserCapabilities = capabilities();
  if (!browserCapabilities.webgpu) {
    return {
      status: "unsupported",
      reason: "webgpu-unavailable",
      message: "navigator.gpu is unavailable",
      capabilities: browserCapabilities,
    };
  }
  if (!browserCapabilities.offscreenCanvas) {
    return {
      status: "unsupported",
      reason: "offscreen-canvas-unavailable",
      message: "OffscreenCanvas is unavailable",
      capabilities: browserCapabilities,
    };
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "adapter-unavailable",
      message: "navigator.gpu.requestAdapter returned null",
      capabilities: browserCapabilities,
    };
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return {
      status: "unsupported",
      reason: "device-request-failed",
      message: error instanceof Error ? error.message : String(error),
      capabilities: browserCapabilities,
    };
  }

  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    return {
      status: "unsupported",
      reason: "context-unavailable",
      message: 'OffscreenCanvas.getContext("webgpu") returned null',
      capabilities: browserCapabilities,
    };
  }

  const uncapturedErrors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    uncapturedErrors.push(event.error.message);
  });
  device.pushErrorScope("validation");
  const lostPromise = device.lost;

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  invariant(
    canvasFormat === "bgra8unorm" || canvasFormat === "rgba8unorm",
    `unsupported canvas format ${canvasFormat}`,
  );
  const presentationResult = createStudioEngineWebGpuPresentationSurface({
    device,
    context,
    canvas,
    canvasFormat,
    initialDeviceEpoch: INITIAL_DEVICE_EPOCH,
    ownsDevice: false,
  });
  invariant(
    presentationResult.status === "ready",
    `presentation surface creation failed: ${presentationResult.reason}`,
  );
  const presentation = presentationResult.surface;
  const runtimeResult = createStudioEngineWebGpuTexturedBrushRuntime({
    device,
    presentationOnly: true,
    initialDeviceEpoch: INITIAL_DEVICE_EPOCH,
    ownsDevice: false,
  });
  invariant(
    runtimeResult.status === "ready",
    `textured presentation runtime creation failed: ${runtimeResult.reason}`,
  );
  const runtime = runtimeResult.runtime;
  const plan = planWithFingerprint();
  const sourceFrameFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(plan);
  invariant(sourceFrameFingerprint, "source frame fingerprint unavailable");

  const firstLayout = layout(1, 1, 1, 1, 80, 48, false);
  const firstConfiguration = presentation.configure(firstLayout);
  invariant(
    firstConfiguration.status === "ready",
    `initial presentation configure failed: ${firstConfiguration.status}`,
  );
  const missingLease = await runtime.execute({
    requestSequence: 1,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
  });
  invariant(
    missingLease.status === "rejected"
      && missingLease.reason === "presentation-lease-required",
    "presentationOnly runtime did not fail closed without a lease",
  );

  const firstFrameResult = presentation.beginFrame(
    frameRequest(1, firstLayout, sourceFrameFingerprint),
  );
  invariant(
    firstFrameResult.status === "ready",
    `initial beginFrame failed: ${firstFrameResult.status}`,
  );
  const firstRender = await runtime.execute({
    requestSequence: 1,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
    presentationLease: firstFrameResult.frame,
  });
  invariant(
    firstRender.status === "completed",
    `initial textured render failed: ${firstRender.status}`,
  );
  invariant(
    firstRender.receipt.renderTarget === "presentation",
    "textured runtime did not render into the shared presentation target",
  );
  const firstLinearSurface = await readLinearSurface(device, firstFrameResult.frame);
  invariant(
    firstLinearSurface.nonZeroAlphaPixels > 0 && firstLinearSurface.maxAlpha > 0.5,
    "shared RGBA16F surface did not contain the deterministic textured dab",
  );
  const firstPresentation = await presentation.presentFrame(
    firstFrameResult.frame,
    firstRender.receipt,
  );
  invariant(
    firstPresentation.status === "presented",
    `initial present failed: ${firstPresentation.status}`,
  );
  const firstCanvas = await readPresentedCanvas(canvas);
  if (firstCanvas.available) {
    invariant(
      firstCanvas.nonZeroAlphaPixels > 0
        && firstCanvas.maxRed > 0
        && firstCanvas.maxAlpha > 0,
      "presented browser canvas did not contain visible pixels",
    );
  }
  const firstVisibility = presentation.visibility();
  invariant(
    firstVisibility.visible
      && presentation.authorizesVisibility(firstPresentation.receipt),
    "completed presentation receipt did not authorize visibility",
  );

  const appendPlanWithoutFingerprint: StudioEngineWebGpuTexturedBrushPlan = {
    ...plan,
    semanticFingerprint: undefined,
    mode: "append",
    strokeId: "presentation-browser-append",
    commandSequence: 2,
    dabs: plan.dabs.map((dab) => ({
      ...dab,
      index: dab.index,
      x: dab.x + 8,
      stationX: dab.stationX + 8,
    })),
  };
  const appendSourceFrameFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(
      appendPlanWithoutFingerprint,
    );
  invariant(
    appendSourceFrameFingerprint,
    "append source frame fingerprint unavailable",
  );
  const appendPlan: StudioEngineWebGpuTexturedBrushPlan = {
    ...appendPlanWithoutFingerprint,
    semanticFingerprint: appendSourceFrameFingerprint,
  };
  const appendFrameResult = presentation.beginFrame(
    frameRequest(2, firstLayout, appendSourceFrameFingerprint),
  );
  invariant(
    appendFrameResult.status === "ready",
    `append beginFrame failed: ${appendFrameResult.status}`,
  );
  const appendRender = await runtime.execute({
    requestSequence: 2,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan: appendPlan,
    presentationLease: appendFrameResult.frame,
  });
  invariant(
    appendRender.status === "completed",
    `append textured render failed: ${appendRender.status}`,
  );
  invariant(
    appendRender.receipt.baseContentGeneration
      === firstRender.receipt.contentGeneration
      && appendRender.receipt.baseContentFingerprint
        === firstRender.receipt.contentFingerprint
      && appendRender.receipt.contentGeneration !== null
      && firstRender.receipt.contentGeneration !== null
      && appendRender.receipt.contentGeneration
        > firstRender.receipt.contentGeneration
      && appendRender.receipt.contentFingerprint !== null
      && appendRender.receipt.contentFingerprint
        !== firstRender.receipt.contentFingerprint,
    "append content authority did not chain from the presented rebuild",
  );
  const appendPresentation = await presentation.presentFrame(
    appendFrameResult.frame,
    appendRender.receipt,
  );
  invariant(
    appendPresentation.status === "presented",
    `append present failed: ${appendPresentation.status}`,
  );

  const secondLayout = layout(2, 2, 2, 2, 64, 40, true);
  const secondConfiguration = presentation.configure(secondLayout);
  invariant(
    secondConfiguration.status === "ready",
    `resize configure failed: ${secondConfiguration.status}`,
  );
  const secondFrameResult = presentation.beginFrame(
    frameRequest(3, secondLayout, sourceFrameFingerprint),
  );
  invariant(
    secondFrameResult.status === "ready",
    `resized beginFrame failed: ${secondFrameResult.status}`,
  );
  const secondRender = await runtime.execute({
    requestSequence: 3,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
    presentationLease: secondFrameResult.frame,
  });
  invariant(
    secondRender.status === "completed",
    `resized textured render failed: ${secondRender.status}`,
  );
  const secondLinearSurface = await readLinearSurface(device, secondFrameResult.frame);
  invariant(
    secondLinearSurface.nonZeroAlphaPixels > 0
      && secondFrameResult.frame.configuration.viewport.flipX,
    "resized/flipped shared surface evidence is incomplete",
  );
  const secondPresentation = await presentation.presentFrame(
    secondFrameResult.frame,
    secondRender.receipt,
  );
  invariant(
    secondPresentation.status === "presented",
    `resized present failed: ${secondPresentation.status}`,
  );
  invariant(
    secondPresentation.receipt.workSurfaceEpoch
      > firstPresentation.receipt.workSurfaceEpoch,
    "physical resize did not allocate a new work-surface epoch",
  );

  const thirdFrameResult = presentation.beginFrame(
    frameRequest(4, secondLayout, sourceFrameFingerprint),
  );
  invariant(thirdFrameResult.status === "ready", "third beginFrame failed");
  const invalidStaleLease: StudioEngineWebGpuPresentationFrameLease = {
    ...thirdFrameResult.frame,
    presentationEpoch: firstLayout.presentationEpoch,
  };
  const staleRuntime = await runtime.execute({
    requestSequence: 4,
    deviceEpoch: INITIAL_DEVICE_EPOCH,
    plan,
    presentationLease: invalidStaleLease,
  });
  invariant(
    staleRuntime.status === "rejected"
      && staleRuntime.reason === "presentation-lease-invalid",
    "textured runtime did not reject a stale presentation lease",
  );
  const staleOwner = await presentation.presentFrame(
    firstFrameResult.frame,
    firstRender.receipt,
  );
  invariant(
    staleOwner.status === "rejected" && staleOwner.reason === "invalid-frame",
    "presentation owner accepted a retired pre-resize lease",
  );
  const aborted = presentation.abortFrame(thirdFrameResult.frame);
  invariant(aborted.status === "aborted", "active frame was not abortable");

  runtime.dispose();
  presentation.dispose();
  const disposedVisibility = presentation.visibility();
  const disposedStats = presentation.stats();
  const configureAfterDispose = presentation.configure(secondLayout);

  const ownershipProbe = device.createBuffer({
    label: "Studio presentation external-device ownership probe",
    size: 16,
    usage: BUFFER_COPY_SRC | BUFFER_COPY_DST,
  });
  try {
    device.queue.writeBuffer(ownershipProbe, 0, new Uint32Array([0x51a7face]));
    await device.queue.onSubmittedWorkDone();
  } finally {
    ownershipProbe.destroy();
  }
  const externallyOwnedDeviceUsable = true;

  const validationError = await device.popErrorScope();
  device.destroy();
  const lost = await Promise.race([
    lostPromise,
    new Promise<GPUDeviceLostInfo>((_, reject) => {
      globalThis.setTimeout(
        () => reject(new Error("device loss did not settle after explicit destroy")),
        DEVICE_LOSS_TIMEOUT_MS,
      );
    }),
  ]);

  return {
    status: "ok",
    backend: "real-chromium-webgpu-presentation",
    capabilities: browserCapabilities,
    adapterInfo: adapterInfo(adapter),
    canvasFormat,
    initial: {
      configuration: {
        physicalWidth: firstConfiguration.configuration.physicalWidth,
        physicalHeight: firstConfiguration.configuration.physicalHeight,
        dpr: firstConfiguration.configuration.dpr,
        presentationEpoch: firstConfiguration.configuration.presentationEpoch,
        resizeEpoch: firstConfiguration.configuration.resizeEpoch,
        viewportEpoch: firstConfiguration.configuration.viewportEpoch,
        flipEpoch: firstConfiguration.configuration.flipEpoch,
      },
      missingLeaseReason: missingLease.reason,
      renderReceipt: {
        requestSequence: firstRender.receipt.requestSequence,
        renderTarget: firstRender.receipt.renderTarget,
        sourceFrameFingerprint: firstRender.receipt.sourceFrameFingerprint,
        workSurfaceEpoch: firstRender.receipt.workSurfaceEpoch,
        complete: firstRender.receipt.complete,
      },
      presentationReceipt: {
        requestSequence: firstPresentation.receipt.requestSequence,
        sourceFrameFingerprint: firstPresentation.receipt.sourceFrameFingerprint,
        workSurfaceEpoch: firstPresentation.receipt.workSurfaceEpoch,
        width: firstPresentation.receipt.width,
        height: firstPresentation.receipt.height,
        visible: firstPresentation.receipt.visible,
        complete: firstPresentation.receipt.complete,
      },
      visibilityAuthorized: firstVisibility.visible,
      linearSurface: firstLinearSurface,
      canvas: firstCanvas,
    },
    resized: {
      allocation: secondConfiguration.allocation,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      workSurfaceEpoch: secondPresentation.receipt.workSurfaceEpoch,
      linearSurface: secondLinearSurface,
      receiptWidth: secondPresentation.receipt.width,
      receiptHeight: secondPresentation.receipt.height,
      flipX: secondFrameResult.frame.configuration.viewport.flipX,
    },
    contentAuthority: {
      initialGeneration: firstPresentation.receipt.contentGeneration,
      initialFingerprint: firstPresentation.receipt.contentFingerprint,
      appendBaseGeneration:
        appendPresentation.receipt.baseContentGeneration,
      appendBaseFingerprint:
        appendPresentation.receipt.baseContentFingerprint
        ?? "",
      appendGeneration: appendPresentation.receipt.contentGeneration,
      appendFingerprint: appendPresentation.receipt.contentFingerprint,
      chainLinked:
        appendPresentation.receipt.baseContentGeneration
          === firstPresentation.receipt.contentGeneration
        && appendPresentation.receipt.baseContentFingerprint
          === firstPresentation.receipt.contentFingerprint,
    },
    staleLease: {
      runtimeStatus: staleRuntime.status,
      runtimeReason: "reason" in staleRuntime ? staleRuntime.reason : null,
      ownerStatus: staleOwner.status,
      ownerReason: "reason" in staleOwner ? staleOwner.reason : null,
      abortStatus: aborted.status,
    },
    disposal: {
      visibilityReason:
        disposedVisibility.visible ? null : disposedVisibility.reason,
      surfaceStatus: disposedStats.status,
      configureStatus: configureAfterDispose.status,
      configureReason:
        "reason" in configureAfterDispose ? configureAfterDispose.reason : null,
      externallyOwnedDeviceUsable,
      deviceLossReason: lost.reason,
    },
    diagnostics: {
      uncapturedErrors,
      validationError: validationError?.message ?? null,
    },
  };
}

void run().then(
  (result) => {
    window.__studioEngineWebGpuPresentationResult = result;
  },
  (error: unknown) => {
    window.__studioEngineWebGpuPresentationResult = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
    };
  },
);
