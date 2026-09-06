import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION = 2 as const;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT = "rgba16float" as const;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE =
  "linear-srgb" as const;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL =
  "scene-linear-premultiplied" as const;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_OUTPUT_COLOR_SPACE = "srgb" as const;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_DEFAULT_MAX_SURFACE_PIXELS =
  67_108_864;
export const STUDIO_ENGINE_WEBGPU_PRESENTATION_BYTES_PER_PIXEL = 8;

const GPU_TEXTURE_COPY_SRC = 0x01;
const GPU_TEXTURE_COPY_DST = 0x02;
const GPU_TEXTURE_BINDING = 0x04;
const GPU_TEXTURE_STORAGE_BINDING = 0x08;
const GPU_TEXTURE_RENDER_ATTACHMENT = 0x10;

export const STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE =
  GPU_TEXTURE_COPY_SRC
  | GPU_TEXTURE_COPY_DST
  | GPU_TEXTURE_BINDING
  | GPU_TEXTURE_STORAGE_BINDING
  | GPU_TEXTURE_RENDER_ATTACHMENT;

const STUDIO_ENGINE_WEBGPU_PRESENTATION_CANVAS_USAGE =
  GPU_TEXTURE_RENDER_ATTACHMENT;

const PRESENTATION_SHADER = /* wgsl */ `
@group(0) @binding(0) var linear_surface: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
};

fn linear_to_srgb_channel(value: f32) -> f32 {
  let safe = clamp(value, 0.0, 1.0);
  return select(
    1.055 * pow(safe, 1.0 / 2.4) - 0.055,
    12.92 * safe,
    safe <= 0.0031308,
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertex_index], 0.0, 1.0);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let pixel = textureLoad(linear_surface, vec2i(input.position.xy), 0);
  let alpha = clamp(pixel.a, 0.0, 1.0);
  let straight_linear = select(
    vec3f(0.0),
    pixel.rgb / max(alpha, 0.000001),
    alpha > 0.0,
  );
  let encoded = vec3f(
    linear_to_srgb_channel(straight_linear.r),
    linear_to_srgb_channel(straight_linear.g),
    linear_to_srgb_channel(straight_linear.b),
  );
  return vec4f(encoded * alpha, alpha);
}
`;

export type StudioEngineWebGpuPresentationCanvasFormat =
  | "bgra8unorm"
  | "rgba8unorm";

/**
 * The presentation owner mutates only the physical backing dimensions. DOM styling remains a
 * product-shell concern, so the same boundary also works with an OffscreenCanvas.
 */
export interface StudioEngineWebGpuPresentationCanvas {
  width: number;
  height: number;
}

export interface StudioEngineWebGpuPresentationViewport {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

/**
 * Every visual coordinate family has an explicit monotonic epoch. `presentationEpoch` is the
 * aggregate authority; callers must advance the matching specialist epoch whenever its values
 * change. This prevents an old frame from becoming visible after a resize, DPR, viewport or flip
 * transition that happened to preserve the same physical texture dimensions.
 */
export interface StudioEngineWebGpuPresentationLayout {
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly viewport: StudioEngineWebGpuPresentationViewport;
}

export interface StudioEngineWebGpuDocumentToSurfaceTransform {
  readonly m11: number;
  readonly m12: 0;
  readonly m21: 0;
  readonly m22: number;
  readonly dx: number;
  readonly dy: number;
}

export interface StudioEngineWebGpuPresentationConfiguration {
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly surfacePixels: number;
  readonly surfaceBytes: number;
  readonly viewport: Readonly<StudioEngineWebGpuPresentationViewport>;
  readonly documentToSurface: Readonly<StudioEngineWebGpuDocumentToSurfaceTransform>;
}

export interface StudioEngineWebGpuSharedLinearWorkSurface {
  readonly kind: "studio-engine-webgpu-shared-linear-work-surface";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly format: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT;
  readonly usage: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE;
  readonly colorModel: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL;
  readonly workingColorSpace:
    typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly workSurfaceEpoch: number;
}

export type StudioEngineWebGpuPresentationWriteMode = "append" | "rebuild";

/**
 * Logical authority for the pixels currently stored in the physical work texture. Generation is
 * monotonic for one presentation-owner lifetime. The fingerprint is a canonical render-lineage
 * digest, not a GPU readback checksum.
 */
export interface StudioEngineWebGpuPresentationContentSnapshot {
  readonly initialized: boolean;
  readonly generation: number;
  readonly fingerprint: `sha256:${string}` | null;
}

export interface StudioEngineWebGpuPresentationFrameLease {
  readonly kind: "studio-engine-webgpu-presentation-frame-lease";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  readonly sourceFrameFingerprint: string;
  readonly workSurface: StudioEngineWebGpuSharedLinearWorkSurface;
  readonly configuration: StudioEngineWebGpuPresentationConfiguration;
  readonly contentAtAcquire: StudioEngineWebGpuPresentationContentSnapshot;
}

export interface StudioEngineWebGpuPresentationFrameRequest {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  /**
   * Canonical producer identity. The surface does not infer content provenance from pixels and
   * therefore requires the renderer/provider bridge to supply a deterministic fingerprint.
   */
  readonly sourceFrameFingerprint: string;
}

export interface StudioEngineWebGpuPresentationProducerWriteIntent {
  readonly mode: StudioEngineWebGpuPresentationWriteMode;
  readonly sourceFrameFingerprint: string;
}

export interface StudioEngineWebGpuPresentationProducerWriteClaim {
  readonly kind: "studio-engine-webgpu-presentation-producer-write-claim";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly workSurfaceEpoch: number;
  readonly mode: StudioEngineWebGpuPresentationWriteMode;
  readonly sourceFrameFingerprint: string;
  readonly baseContentGeneration: number;
  readonly baseContentFingerprint: `sha256:${string}` | null;
  readonly contentGeneration: number;
  readonly contentFingerprint: `sha256:${string}`;
}

export type StudioEngineWebGpuPresentationProducerWriteAcquireResult =
  | Readonly<{
      status: "ready";
      claim: StudioEngineWebGpuPresentationProducerWriteClaim;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "content-generation-exhausted"
        | "content-uninitialized"
        | "invalid-frame"
        | "producer-in-flight";
    }>;

export type StudioEngineWebGpuPresentationProducerWriteSettlementResult =
  | Readonly<{
      status: "completed";
      content: StudioEngineWebGpuPresentationContentSnapshot;
    }>
  | Readonly<{
      status: "invalidated";
      reason: "producer-failed";
      content: StudioEngineWebGpuPresentationContentSnapshot;
    }>
  | Readonly<{
      status: "rejected";
      reason: "claim-revoked" | "invalid-claim";
    }>;

/**
 * Minimum producer fence proof required before the owner is allowed to sample the shared work
 * surface. A frame lease by itself only grants write access; it never certifies that any pixels
 * were submitted successfully. Specialist renderers publish this receipt only after their queue
 * fence and nested GPU error scopes have both completed.
 */
export interface StudioEngineWebGpuPresentationProducerReceipt {
  readonly backend: "webgpu";
  readonly textureFormat:
    typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT;
  readonly colorModel:
    typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly renderTarget: "private" | "presentation";
  readonly sourceFrameFingerprint: string;
  readonly workSurfaceEpoch: number | null;
  readonly mode: StudioEngineWebGpuPresentationWriteMode;
  readonly baseContentGeneration: number | null;
  readonly baseContentFingerprint: `sha256:${string}` | null;
  readonly contentGeneration: number | null;
  readonly contentFingerprint: `sha256:${string}` | null;
  readonly queueState: "completed";
  readonly complete: true;
}

export interface StudioEngineWebGpuPresentationReceipt {
  readonly kind: "studio-engine-webgpu-presentation-receipt";
  readonly revision: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION;
  readonly backend: "webgpu";
  readonly requestSequence: number;
  readonly sourceFrameFingerprint: string;
  readonly deviceEpoch: number;
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  readonly workSurfaceEpoch: number;
  readonly mode: StudioEngineWebGpuPresentationWriteMode;
  readonly baseContentGeneration: number;
  readonly baseContentFingerprint: `sha256:${string}` | null;
  readonly contentGeneration: number;
  readonly contentFingerprint: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT;
  readonly canvasFormat: StudioEngineWebGpuPresentationCanvasFormat;
  readonly colorModel: typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL;
  readonly workingColorSpace:
    typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE;
  readonly presentationColorSpace:
    typeof STUDIO_ENGINE_WEBGPU_PRESENTATION_OUTPUT_COLOR_SPACE;
  readonly alphaMode: "premultiplied";
  readonly queueState: "completed";
  readonly presentationState: "presented";
  readonly visible: true;
  readonly complete: true;
}

export type StudioEngineWebGpuPresentationVisibility =
  | Readonly<{
      visible: false;
      reason:
        | "unconfigured"
        | "awaiting-present"
        | "device-lost"
        | "failed"
        | "disposed";
    }>
  | Readonly<{
      visible: true;
      receipt: StudioEngineWebGpuPresentationReceipt;
    }>;

export interface StudioEngineWebGpuPresentationSurfaceOptions {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly canvas: StudioEngineWebGpuPresentationCanvas;
  readonly canvasFormat: StudioEngineWebGpuPresentationCanvasFormat;
  readonly initialDeviceEpoch?: number;
  readonly maximumSurfacePixels?: number;
  readonly ownsDevice?: boolean;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export type StudioEngineWebGpuPresentationSurfaceCreationResult =
  | Readonly<{
      status: "ready";
      surface: StudioEngineWebGpuPresentationSurface;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options" | "initialization-failed";
    }>;

export type StudioEngineWebGpuPresentationConfigureResult =
  | Readonly<{
      status: "ready";
      allocation: "created" | "reused";
      configuration: StudioEngineWebGpuPresentationConfiguration;
    }>
  | Readonly<{
      status: "unchanged";
      configuration: StudioEngineWebGpuPresentationConfiguration;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "device-lost"
        | "disposed"
        | "epoch-conflict"
        | "gpu-backpressure"
        | "invalid-layout"
        | "runtime-failed"
        | "stale-epoch"
        | "surface-limit";
    }>
  | Readonly<{
      status: "failed";
      reason: "configuration-failed";
    }>;

export type StudioEngineWebGpuPresentationBeginFrameResult =
  | Readonly<{
      status: "ready";
      frame: StudioEngineWebGpuPresentationFrameLease;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "device-epoch-mismatch"
        | "device-lost"
        | "disposed"
        | "epoch-mismatch"
        | "frame-in-flight"
        | "invalid-request"
        | "not-configured"
        | "runtime-failed"
        | "stale-request-sequence";
    }>;

export type StudioEngineWebGpuPresentationAbortFrameResult =
  | Readonly<{ status: "aborted" }>
  | Readonly<{ status: "rejected"; reason: "invalid-frame" }>;

export type StudioEngineWebGpuPresentationResult =
  | Readonly<{
      status: "presented";
      receipt: StudioEngineWebGpuPresentationReceipt;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "device-lost"
        | "disposed"
        | "invalid-frame"
        | "producer-receipt-invalid"
        | "runtime-failed";
    }>
  | Readonly<{
      status: "failed";
      reason: "gpu-error" | "presentation-failed";
    }>;

export interface StudioEngineWebGpuPresentationSurfaceStats {
  readonly status: "ready" | "device-lost" | "failed" | "disposed";
  readonly configured: boolean;
  readonly deviceEpoch: number;
  readonly presentationEpoch: number;
  readonly resizeEpoch: number;
  readonly viewportEpoch: number;
  readonly flipEpoch: number;
  readonly workSurfaceEpoch: number;
  readonly lastAcceptedRequestSequence: number;
  readonly lastPresentedRequestSequence: number;
  readonly frameActive: boolean;
  readonly producerWriteInFlight: boolean;
  readonly presentationInFlight: boolean;
  readonly contentInitialized: boolean;
  readonly contentGeneration: number;
  readonly contentFingerprint: `sha256:${string}` | null;
  readonly surfaceTextureAllocations: number;
  readonly presentations: number;
}

interface PresentationResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
}

interface WorkSurfaceResources {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly bindGroup: GPUBindGroup;
  readonly publicSurface: StudioEngineWebGpuSharedLinearWorkSurface;
}

interface NormalizedLayout {
  readonly configuration: StudioEngineWebGpuPresentationConfiguration;
  readonly layout: StudioEngineWebGpuPresentationLayout;
}

type LayoutNormalizationResult =
  | Readonly<{ status: "ready"; normalized: NormalizedLayout }>
  | Readonly<{ status: "rejected"; reason: "invalid-layout" | "surface-limit" }>;

interface FrameWriteCapability {
  acquire(
    intent: StudioEngineWebGpuPresentationProducerWriteIntent,
  ): StudioEngineWebGpuPresentationProducerWriteAcquireResult;
}

interface ProducerWriteClaimCapability {
  settle(
    outcome: "completed" | "failed",
  ): StudioEngineWebGpuPresentationProducerWriteSettlementResult;
}

interface CompletedProducerWrite {
  readonly frame: StudioEngineWebGpuPresentationFrameLease;
  readonly claim: StudioEngineWebGpuPresentationProducerWriteClaim;
}

const frameWriteCapabilities = new WeakMap<
  StudioEngineWebGpuPresentationFrameLease,
  FrameWriteCapability
>();
const producerWriteClaimCapabilities = new WeakMap<
  StudioEngineWebGpuPresentationProducerWriteClaim,
  ProducerWriteClaimCapability
>();

function finite(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function positiveFinite(value: unknown): value is number {
  return finite(value) && value > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && value.trim() === value;
}

function validSha256Fingerprint(
  value: unknown,
): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value);
}

export interface StudioEngineWebGpuPresentationContentFingerprintInput {
  readonly mode: StudioEngineWebGpuPresentationWriteMode;
  readonly baseContentFingerprint: `sha256:${string}` | null;
  readonly sourceFrameFingerprint: string;
  readonly width: number;
  readonly height: number;
  readonly documentToSurface:
    Readonly<StudioEngineWebGpuDocumentToSurfaceTransform>;
}

/**
 * Computes deterministic render lineage for the logical contents of an RGBA16F work surface.
 * This intentionally excludes request/generation/epoch values: equal render inputs and equal
 * target geometry must have equal lineage even when rebuilt on a replacement GPU allocation.
 */
export function fingerprintStudioEngineWebGpuPresentationContent(
  input: StudioEngineWebGpuPresentationContentFingerprintInput,
): `sha256:${string}` | null {
  try {
    const transform = input?.documentToSurface;
    if (
      !input
      || (input.mode !== "append" && input.mode !== "rebuild")
      || !validFingerprint(input.sourceFrameFingerprint)
      || !positiveSafeInteger(input.width)
      || !positiveSafeInteger(input.height)
      || !transform
      || transform.m12 !== 0
      || transform.m21 !== 0
      || ![
        transform.m11,
        transform.m22,
        transform.dx,
        transform.dy,
      ].every(finite)
      || transform.m11 === 0
      || transform.m22 === 0
      || (
        input.mode === "append"
        && !validSha256Fingerprint(input.baseContentFingerprint)
      )
      || (
        input.mode === "rebuild"
        && input.baseContentFingerprint !== null
      )
    ) return null;
    const canonical = JSON.stringify({
      kind: "studio-engine-webgpu-surface-content-chain",
      version: 1,
      mode: input.mode,
      baseContentFingerprint: input.baseContentFingerprint,
      sourceFrameFingerprint: input.sourceFrameFingerprint,
      target: {
        format: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
        colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
        workingColorSpace:
          STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE,
        width: input.width,
        height: input.height,
        documentToSurface: [
          transform.m11,
          transform.m22,
          transform.dx,
          transform.dy,
        ],
      },
    });
    return `sha256:${sha256HexPortable(new TextEncoder().encode(canonical))}`;
  } catch {
    return null;
  }
}

export function acquireStudioEngineWebGpuPresentationProducerWrite(
  frame: StudioEngineWebGpuPresentationFrameLease,
  intent: StudioEngineWebGpuPresentationProducerWriteIntent,
): StudioEngineWebGpuPresentationProducerWriteAcquireResult {
  try {
    return frameWriteCapabilities.get(frame)?.acquire(intent)
      ?? Object.freeze({ status: "rejected", reason: "invalid-frame" });
  } catch {
    return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  }
}

export function settleStudioEngineWebGpuPresentationProducerWrite(
  claim: StudioEngineWebGpuPresentationProducerWriteClaim,
  outcome: "completed" | "failed",
): StudioEngineWebGpuPresentationProducerWriteSettlementResult {
  if (outcome !== "completed" && outcome !== "failed") {
    return Object.freeze({ status: "rejected", reason: "invalid-claim" });
  }
  try {
    return producerWriteClaimCapabilities.get(claim)?.settle(outcome)
      ?? Object.freeze({ status: "rejected", reason: "invalid-claim" });
  } catch {
    return Object.freeze({ status: "rejected", reason: "invalid-claim" });
  }
}

function validProducerReceipt(
  receipt: StudioEngineWebGpuPresentationProducerReceipt,
  frame: StudioEngineWebGpuPresentationFrameLease,
  completed: CompletedProducerWrite,
): boolean {
  try {
    const claim = completed.claim;
    return Boolean(
      receipt
      && completed.frame === frame
      && receipt.backend === "webgpu"
      && receipt.textureFormat === STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT
      && receipt.colorModel === STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL
      && receipt.requestSequence === frame.requestSequence
      && receipt.deviceEpoch === frame.deviceEpoch
      && receipt.renderTarget === "presentation"
      && receipt.sourceFrameFingerprint === frame.sourceFrameFingerprint
      && receipt.workSurfaceEpoch === frame.workSurface.workSurfaceEpoch
      && receipt.mode === claim.mode
      && receipt.baseContentGeneration === claim.baseContentGeneration
      && receipt.baseContentFingerprint === claim.baseContentFingerprint
      && receipt.contentGeneration === claim.contentGeneration
      && receipt.contentFingerprint === claim.contentFingerprint
      && receipt.queueState === "completed"
      && receipt.complete === true
    );
  } catch {
    return false;
  }
}

function validCanvasFormat(
  value: unknown,
): value is StudioEngineWebGpuPresentationCanvasFormat {
  return value === "bgra8unorm" || value === "rgba8unorm";
}

function snapshotViewport(
  viewport: StudioEngineWebGpuPresentationViewport,
): Readonly<StudioEngineWebGpuPresentationViewport> | null {
  try {
    if (
      !viewport
      || !positiveFinite(viewport.logicalWidth)
      || !positiveFinite(viewport.logicalHeight)
      || !positiveFinite(viewport.scaleX)
      || !positiveFinite(viewport.scaleY)
      || !finite(viewport.offsetX)
      || !finite(viewport.offsetY)
      || typeof viewport.flipX !== "boolean"
      || typeof viewport.flipY !== "boolean"
    ) return null;
    return Object.freeze({
      logicalWidth: viewport.logicalWidth,
      logicalHeight: viewport.logicalHeight,
      scaleX: viewport.scaleX,
      scaleY: viewport.scaleY,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      flipX: viewport.flipX,
      flipY: viewport.flipY,
    });
  } catch {
    return null;
  }
}

function normalizeLayout(
  input: StudioEngineWebGpuPresentationLayout,
  maximumSurfacePixels: number,
  maximumTextureDimension2D: number,
): LayoutNormalizationResult {
  try {
    const viewport = snapshotViewport(input.viewport);
    if (
      !input
      || !positiveSafeInteger(input.presentationEpoch)
      || !positiveSafeInteger(input.resizeEpoch)
      || !positiveSafeInteger(input.viewportEpoch)
      || !positiveSafeInteger(input.flipEpoch)
      || !positiveFinite(input.cssWidth)
      || !positiveFinite(input.cssHeight)
      || !positiveFinite(input.dpr)
      || !viewport
    ) return { status: "rejected", reason: "invalid-layout" };

    const physicalWidth = Math.max(1, Math.round(input.cssWidth * input.dpr));
    const physicalHeight = Math.max(1, Math.round(input.cssHeight * input.dpr));
    if (
      !positiveSafeInteger(physicalWidth)
      || !positiveSafeInteger(physicalHeight)
      || physicalWidth > maximumTextureDimension2D
      || physicalHeight > maximumTextureDimension2D
    ) return { status: "rejected", reason: "surface-limit" };
    const surfacePixels = physicalWidth * physicalHeight;
    const surfaceBytes =
      surfacePixels * STUDIO_ENGINE_WEBGPU_PRESENTATION_BYTES_PER_PIXEL;
    if (
      !positiveSafeInteger(surfacePixels)
      || !positiveSafeInteger(surfaceBytes)
      || surfacePixels > maximumSurfacePixels
    ) return { status: "rejected", reason: "surface-limit" };

    const physicalPerCssX = physicalWidth / input.cssWidth;
    const physicalPerCssY = physicalHeight / input.cssHeight;
    const m11 = (viewport.flipX ? -1 : 1) * viewport.scaleX * physicalPerCssX;
    const m22 = (viewport.flipY ? -1 : 1) * viewport.scaleY * physicalPerCssY;
    const dx = (
      viewport.offsetX
      + (viewport.flipX ? viewport.logicalWidth * viewport.scaleX : 0)
    ) * physicalPerCssX;
    const dy = (
      viewport.offsetY
      + (viewport.flipY ? viewport.logicalHeight * viewport.scaleY : 0)
    ) * physicalPerCssY;
    if (![m11, m22, dx, dy].every(finite)) {
      return { status: "rejected", reason: "invalid-layout" };
    }
    const documentToSurface = Object.freeze({
      m11,
      m12: 0 as const,
      m21: 0 as const,
      m22,
      dx,
      dy,
    });
    const configuration = Object.freeze({
      presentationEpoch: input.presentationEpoch,
      resizeEpoch: input.resizeEpoch,
      viewportEpoch: input.viewportEpoch,
      flipEpoch: input.flipEpoch,
      cssWidth: input.cssWidth,
      cssHeight: input.cssHeight,
      dpr: input.dpr,
      physicalWidth,
      physicalHeight,
      surfacePixels,
      surfaceBytes,
      viewport,
      documentToSurface,
    });
    return {
      status: "ready",
      normalized: Object.freeze({
        layout: Object.freeze({
          presentationEpoch: input.presentationEpoch,
          resizeEpoch: input.resizeEpoch,
          viewportEpoch: input.viewportEpoch,
          flipEpoch: input.flipEpoch,
          cssWidth: input.cssWidth,
          cssHeight: input.cssHeight,
          dpr: input.dpr,
          viewport,
        }),
        configuration,
      }),
    };
  } catch {
    return { status: "rejected", reason: "invalid-layout" };
  }
}

function sameViewportValues(
  left: StudioEngineWebGpuPresentationViewport,
  right: StudioEngineWebGpuPresentationViewport,
): boolean {
  return Object.is(left.logicalWidth, right.logicalWidth)
    && Object.is(left.logicalHeight, right.logicalHeight)
    && Object.is(left.scaleX, right.scaleX)
    && Object.is(left.scaleY, right.scaleY)
    && Object.is(left.offsetX, right.offsetX)
    && Object.is(left.offsetY, right.offsetY);
}

function sameFlipValues(
  left: StudioEngineWebGpuPresentationViewport,
  right: StudioEngineWebGpuPresentationViewport,
): boolean {
  return left.flipX === right.flipX && left.flipY === right.flipY;
}

function sameResizeValues(
  left: StudioEngineWebGpuPresentationLayout,
  right: StudioEngineWebGpuPresentationLayout,
): boolean {
  return Object.is(left.cssWidth, right.cssWidth)
    && Object.is(left.cssHeight, right.cssHeight)
    && Object.is(left.dpr, right.dpr);
}

function sameLayout(
  left: StudioEngineWebGpuPresentationLayout,
  right: StudioEngineWebGpuPresentationLayout,
): boolean {
  return left.presentationEpoch === right.presentationEpoch
    && left.resizeEpoch === right.resizeEpoch
    && left.viewportEpoch === right.viewportEpoch
    && left.flipEpoch === right.flipEpoch
    && sameResizeValues(left, right)
    && sameViewportValues(left.viewport, right.viewport)
    && sameFlipValues(left.viewport, right.viewport);
}

function validEpochTransition(
  previous: StudioEngineWebGpuPresentationLayout,
  next: StudioEngineWebGpuPresentationLayout,
): "valid" | "stale" | "conflict" {
  if (
    next.presentationEpoch < previous.presentationEpoch
    || next.resizeEpoch < previous.resizeEpoch
    || next.viewportEpoch < previous.viewportEpoch
    || next.flipEpoch < previous.flipEpoch
  ) return "stale";
  if (sameLayout(previous, next)) return "valid";
  if (next.presentationEpoch <= previous.presentationEpoch) return "conflict";
  if (
    !sameResizeValues(previous, next)
    && next.resizeEpoch <= previous.resizeEpoch
  ) return "conflict";
  if (
    !sameViewportValues(previous.viewport, next.viewport)
    && next.viewportEpoch <= previous.viewportEpoch
  ) return "conflict";
  if (
    !sameFlipValues(previous.viewport, next.viewport)
    && next.flipEpoch <= previous.flipEpoch
  ) return "conflict";
  return "valid";
}

function safeDestroyTexture(texture: GPUTexture | null): void {
  if (!texture) return;
  try {
    texture.destroy();
  } catch {
    // Device loss and duplicate teardown already retire the texture.
  }
}

function safeUnconfigure(context: GPUCanvasContext): void {
  try {
    context.unconfigure();
  } catch {
    // A detached canvas or lost device may already have unconfigured the context.
  }
}

function safeDestroyDevice(device: GPUDevice, owned: boolean): void {
  if (!owned) return;
  try {
    device.destroy();
  } catch {
    // Best-effort ownership teardown.
  }
}

function createPresentationResources(
  device: GPUDevice,
  canvasFormat: StudioEngineWebGpuPresentationCanvasFormat,
): PresentationResources {
  const bindGroupLayout = device.createBindGroupLayout({
    label: "Studio Engine shared linear presentation binding",
    entries: [{
      binding: 0,
      visibility: 0x02,
      texture: {
        sampleType: "unfilterable-float",
        viewDimension: "2d",
      },
    }],
  });
  const shader = device.createShaderModule({
    label: "Studio Engine shared linear presentation shader",
    code: PRESENTATION_SHADER,
  });
  const pipeline = device.createRenderPipeline({
    label: "Studio Engine shared linear presentation pipeline",
    layout: device.createPipelineLayout({
      label: "Studio Engine shared linear presentation pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shader,
      entryPoint: "vs_main",
    },
    fragment: {
      module: shader,
      entryPoint: "fs_main",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  return { bindGroupLayout, pipeline };
}

function structurallyValidOptions(
  options: StudioEngineWebGpuPresentationSurfaceOptions,
): boolean {
  try {
    const device = options?.device;
    const queue = device?.queue;
    const context = options?.context;
    const canvas = options?.canvas;
    return Boolean(
      device
      && queue
      && context
      && canvas
      && typeof device.createTexture === "function"
      && typeof device.createBindGroupLayout === "function"
      && typeof device.createShaderModule === "function"
      && typeof device.createPipelineLayout === "function"
      && typeof device.createRenderPipeline === "function"
      && typeof device.createBindGroup === "function"
      && typeof device.createCommandEncoder === "function"
      && typeof device.pushErrorScope === "function"
      && typeof device.popErrorScope === "function"
      && typeof queue.submit === "function"
      && typeof queue.onSubmittedWorkDone === "function"
      && typeof context.configure === "function"
      && typeof context.unconfigure === "function"
      && typeof context.getCurrentTexture === "function"
      && finite(canvas.width)
      && finite(canvas.height)
      && validCanvasFormat(options.canvasFormat)
      && (
        options.initialDeviceEpoch === undefined
        || positiveSafeInteger(options.initialDeviceEpoch)
      )
      && (
        options.maximumSurfacePixels === undefined
        || positiveSafeInteger(options.maximumSurfacePixels)
      )
      && (
        options.ownsDevice === undefined
        || typeof options.ownsDevice === "boolean"
      )
      && (
        options.onDeviceLost === undefined
        || typeof options.onDeviceLost === "function"
      )
    );
  } catch {
    return false;
  }
}

function configuredWorkSurface(
  device: GPUDevice,
  resources: PresentationResources,
  configuration: StudioEngineWebGpuPresentationConfiguration,
  workSurfaceEpoch: number,
): WorkSurfaceResources {
  const texture = device.createTexture({
    label: `Studio Engine shared linear RGBA16F surface epoch ${workSurfaceEpoch}`,
    size: {
      width: configuration.physicalWidth,
      height: configuration.physicalHeight,
      depthOrArrayLayers: 1,
    },
    format: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
    usage: STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE,
  });
  try {
    const view = texture.createView({
      label: `Studio Engine shared linear RGBA16F view epoch ${workSurfaceEpoch}`,
    });
    const bindGroup = device.createBindGroup({
      label: `Studio Engine shared linear presentation bind group epoch ${workSurfaceEpoch}`,
      layout: resources.bindGroupLayout,
      entries: [{ binding: 0, resource: view }],
    });
    const publicSurface = Object.freeze({
      kind: "studio-engine-webgpu-shared-linear-work-surface" as const,
      revision: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION,
      texture,
      view,
      format: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
      usage: STUDIO_ENGINE_WEBGPU_PRESENTATION_WORK_SURFACE_USAGE,
      colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
      workingColorSpace:
        STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE,
      width: configuration.physicalWidth,
      height: configuration.physicalHeight,
      byteLength: configuration.surfaceBytes,
      workSurfaceEpoch,
    });
    return { texture, view, bindGroup, publicSurface };
  } catch (error) {
    safeDestroyTexture(texture);
    throw error;
  }
}

export function createStudioEngineWebGpuPresentationSurface(
  options: StudioEngineWebGpuPresentationSurfaceOptions,
): StudioEngineWebGpuPresentationSurfaceCreationResult {
  if (!structurallyValidOptions(options)) {
    return { status: "rejected", reason: "invalid-options" };
  }
  try {
    const resources = createPresentationResources(options.device, options.canvasFormat);
    return {
      status: "ready",
      surface: new StudioEngineWebGpuPresentationSurface(options, resources),
    };
  } catch {
    safeDestroyDevice(options.device, options.ownsDevice === true);
    return { status: "rejected", reason: "initialization-failed" };
  }
}

export class StudioEngineWebGpuPresentationSurface {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvas: StudioEngineWebGpuPresentationCanvas;
  private readonly canvasFormat: StudioEngineWebGpuPresentationCanvasFormat;
  private readonly ownsDevice: boolean;
  private readonly maximumSurfacePixels: number;
  private readonly maximumTextureDimension2D: number;
  private readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  private readonly resources: PresentationResources;
  private status: "ready" | "device-lost" | "failed" | "disposed" = "ready";
  private deviceEpoch: number;
  private workSurfaceEpoch = 0;
  private configuration: StudioEngineWebGpuPresentationConfiguration | null = null;
  private layout: StudioEngineWebGpuPresentationLayout | null = null;
  private workSurface: WorkSurfaceResources | null = null;
  private activeFrame: StudioEngineWebGpuPresentationFrameLease | null = null;
  private activeProducerClaim:
    StudioEngineWebGpuPresentationProducerWriteClaim | null = null;
  private completedProducerWrite: CompletedProducerWrite | null = null;
  private producerWriteInFlight = false;
  private presentationInFlight = false;
  private contentInitialized = false;
  private contentGeneration = 0;
  private contentFingerprint: `sha256:${string}` | null = null;
  private visibleReceipt: StudioEngineWebGpuPresentationReceipt | null = null;
  private lastAcceptedRequestSequence = 0;
  private lastPresentedRequestSequence = 0;
  private surfaceTextureAllocations = 0;
  private presentations = 0;

  public constructor(
    options: StudioEngineWebGpuPresentationSurfaceOptions,
    resources: PresentationResources,
  ) {
    this.device = options.device;
    this.context = options.context;
    this.canvas = options.canvas;
    this.canvasFormat = options.canvasFormat;
    this.ownsDevice = options.ownsDevice === true;
    this.maximumSurfacePixels =
      options.maximumSurfacePixels
      ?? STUDIO_ENGINE_WEBGPU_PRESENTATION_DEFAULT_MAX_SURFACE_PIXELS;
    const deviceLimit = Number(options.device.limits?.maxTextureDimension2D);
    this.maximumTextureDimension2D = positiveSafeInteger(deviceLimit)
      ? deviceLimit
      : 8_192;
    this.onDeviceLost = options.onDeviceLost;
    this.resources = resources;
    this.deviceEpoch = options.initialDeviceEpoch ?? 1;
    void this.device.lost.then((info) => this.handleDeviceLost(info));
  }

  public configure(
    input: StudioEngineWebGpuPresentationLayout,
  ): StudioEngineWebGpuPresentationConfigureResult {
    if (this.status === "disposed") {
      return { status: "rejected", reason: "disposed" };
    }
    if (this.status === "device-lost") {
      return { status: "rejected", reason: "device-lost" };
    }
    if (this.status === "failed") {
      return { status: "rejected", reason: "runtime-failed" };
    }
    if (
      this.activeFrame
      || this.producerWriteInFlight
      || this.presentationInFlight
    ) {
      return { status: "rejected", reason: "gpu-backpressure" };
    }
    if (this.configuration && !this.backingDimensionsMatch()) {
      this.failClosed();
      return { status: "failed", reason: "configuration-failed" };
    }
    const normalized = normalizeLayout(
      input,
      this.maximumSurfacePixels,
      this.maximumTextureDimension2D,
    );
    if (normalized.status === "rejected") return normalized;
    const nextLayout = normalized.normalized.layout;
    const nextConfiguration = normalized.normalized.configuration;
    if (this.layout) {
      const transition = validEpochTransition(this.layout, nextLayout);
      if (transition === "stale") {
        return { status: "rejected", reason: "stale-epoch" };
      }
      if (transition === "conflict") {
        return { status: "rejected", reason: "epoch-conflict" };
      }
      if (sameLayout(this.layout, nextLayout)) {
        return {
          status: "unchanged",
          configuration: this.configuration!,
        };
      }
    }

    const hadConfiguration = this.configuration !== null;
    if (
      hadConfiguration
      && this.contentGeneration === Number.MAX_SAFE_INTEGER
    ) {
      this.failClosed();
      return { status: "failed", reason: "configuration-failed" };
    }
    const physicalSizeChanged =
      !this.configuration
      || this.configuration.physicalWidth !== nextConfiguration.physicalWidth
      || this.configuration.physicalHeight !== nextConfiguration.physicalHeight;
    let replacement: WorkSurfaceResources | null = null;
    const nextWorkSurfaceEpoch = physicalSizeChanged
      ? this.workSurfaceEpoch + 1
      : this.workSurfaceEpoch;
    const previousCanvasWidth = this.canvas.width;
    const previousCanvasHeight = this.canvas.height;
    try {
      if (physicalSizeChanged) {
        if (!positiveSafeInteger(nextWorkSurfaceEpoch)) {
          this.failClosed();
          return { status: "failed", reason: "configuration-failed" };
        }
        replacement = configuredWorkSurface(
          this.device,
          this.resources,
          nextConfiguration,
          nextWorkSurfaceEpoch,
        );
        this.canvas.width = nextConfiguration.physicalWidth;
        this.canvas.height = nextConfiguration.physicalHeight;
        this.context.configure({
          device: this.device,
          format: this.canvasFormat,
          usage: STUDIO_ENGINE_WEBGPU_PRESENTATION_CANVAS_USAGE,
          alphaMode: "premultiplied",
          colorSpace: STUDIO_ENGINE_WEBGPU_PRESENTATION_OUTPUT_COLOR_SPACE,
        });
      }
    } catch {
      safeDestroyTexture(replacement?.texture ?? null);
      try {
        this.canvas.width = previousCanvasWidth;
        this.canvas.height = previousCanvasHeight;
      } catch {
        // The failed runtime is never reused, even when a detached canvas cannot be restored.
      }
      this.failClosed();
      return { status: "failed", reason: "configuration-failed" };
    }

    const previousWorkSurface = this.workSurface;
    if (replacement) {
      this.workSurface = replacement;
      this.workSurfaceEpoch = nextWorkSurfaceEpoch;
      this.surfaceTextureAllocations += 1;
    }
    this.layout = nextLayout;
    this.configuration = nextConfiguration;
    this.completedProducerWrite = null;
    if (
      hadConfiguration
      && !this.invalidateContent(this.contentGeneration + 1)
    ) {
      this.failClosed();
      return { status: "failed", reason: "configuration-failed" };
    }
    this.visibleReceipt = null;
    if (replacement) safeDestroyTexture(previousWorkSurface?.texture ?? null);
    return {
      status: "ready",
      allocation: replacement ? "created" : "reused",
      configuration: nextConfiguration,
    };
  }

  public beginFrame(
    request: StudioEngineWebGpuPresentationFrameRequest,
  ): StudioEngineWebGpuPresentationBeginFrameResult {
    if (this.status === "disposed") {
      return { status: "rejected", reason: "disposed" };
    }
    if (this.status === "device-lost") {
      return { status: "rejected", reason: "device-lost" };
    }
    if (this.status === "failed") {
      return { status: "rejected", reason: "runtime-failed" };
    }
    if (!this.configuration || !this.layout || !this.workSurface) {
      return { status: "rejected", reason: "not-configured" };
    }
    if (!this.backingDimensionsMatch()) {
      this.failClosed();
      return { status: "rejected", reason: "runtime-failed" };
    }
    if (
      this.activeFrame
      || this.producerWriteInFlight
      || this.presentationInFlight
    ) {
      return { status: "rejected", reason: "frame-in-flight" };
    }
    try {
      if (
        !request
        || !positiveSafeInteger(request.requestSequence)
        || !positiveSafeInteger(request.deviceEpoch)
        || !positiveSafeInteger(request.presentationEpoch)
        || !positiveSafeInteger(request.resizeEpoch)
        || !positiveSafeInteger(request.viewportEpoch)
        || !positiveSafeInteger(request.flipEpoch)
        || !validFingerprint(request.sourceFrameFingerprint)
      ) return { status: "rejected", reason: "invalid-request" };
      if (request.requestSequence <= this.lastAcceptedRequestSequence) {
        return { status: "rejected", reason: "stale-request-sequence" };
      }
      if (request.deviceEpoch !== this.deviceEpoch) {
        return { status: "rejected", reason: "device-epoch-mismatch" };
      }
      if (
        request.presentationEpoch !== this.configuration.presentationEpoch
        || request.resizeEpoch !== this.configuration.resizeEpoch
        || request.viewportEpoch !== this.configuration.viewportEpoch
        || request.flipEpoch !== this.configuration.flipEpoch
      ) return { status: "rejected", reason: "epoch-mismatch" };

      const contentAtAcquire = this.contentSnapshot();
      const frame = Object.freeze({
        kind: "studio-engine-webgpu-presentation-frame-lease" as const,
        revision: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION,
        requestSequence: request.requestSequence,
        deviceEpoch: request.deviceEpoch,
        presentationEpoch: request.presentationEpoch,
        resizeEpoch: request.resizeEpoch,
        viewportEpoch: request.viewportEpoch,
        flipEpoch: request.flipEpoch,
        sourceFrameFingerprint: request.sourceFrameFingerprint,
        workSurface: this.workSurface.publicSurface,
        configuration: this.configuration,
        contentAtAcquire,
      });
      this.lastAcceptedRequestSequence = request.requestSequence;
      this.activeFrame = frame;
      frameWriteCapabilities.set(frame, {
        acquire: (intent) => this.acquireProducerWrite(frame, intent),
      });
      return { status: "ready", frame };
    } catch {
      return { status: "rejected", reason: "invalid-request" };
    }
  }

  public abortFrame(
    frame: StudioEngineWebGpuPresentationFrameLease,
  ): StudioEngineWebGpuPresentationAbortFrameResult {
    if (this.activeFrame !== frame) {
      return { status: "rejected", reason: "invalid-frame" };
    }
    frameWriteCapabilities.delete(frame);
    this.activeFrame = null;
    this.completedProducerWrite = null;
    const minimumGeneration =
      this.activeProducerClaim?.contentGeneration
      ?? this.contentGeneration + 1;
    if (!this.invalidateContent(minimumGeneration)) this.failClosed();
    return { status: "aborted" };
  }

  /**
   * Acquires the browser's current presentation texture, submits the colour-conversion pass and
   * waits for both queue completion and nested GPU error scopes. Only then is a receipt published
   * by `visibility()`. Until that point the product shell must keep its authoritative fallback
   * visible.
   */
  public async presentFrame(
    frame: StudioEngineWebGpuPresentationFrameLease,
    producerReceipt: StudioEngineWebGpuPresentationProducerReceipt,
  ): Promise<StudioEngineWebGpuPresentationResult> {
    if (this.status === "disposed") {
      return { status: "rejected", reason: "disposed" };
    }
    if (this.status === "device-lost") {
      return { status: "rejected", reason: "device-lost" };
    }
    if (this.status === "failed") {
      return { status: "rejected", reason: "runtime-failed" };
    }
    if (
      this.activeFrame !== frame
      || !this.configuration
      || !this.workSurface
      || frame.workSurface !== this.workSurface.publicSurface
      || frame.deviceEpoch !== this.deviceEpoch
      || frame.presentationEpoch !== this.configuration.presentationEpoch
      || frame.resizeEpoch !== this.configuration.resizeEpoch
      || frame.viewportEpoch !== this.configuration.viewportEpoch
      || frame.flipEpoch !== this.configuration.flipEpoch
    ) return { status: "rejected", reason: "invalid-frame" };
    const completedProducerWrite = this.completedProducerWrite;
    if (
      !completedProducerWrite
      || completedProducerWrite.frame !== frame
      || this.producerWriteInFlight
      || !this.contentInitialized
      || this.contentGeneration
        !== completedProducerWrite.claim.contentGeneration
      || this.contentFingerprint
        !== completedProducerWrite.claim.contentFingerprint
      || !validProducerReceipt(
        producerReceipt,
        frame,
        completedProducerWrite,
      )
    ) {
      return { status: "rejected", reason: "producer-receipt-invalid" };
    }
    if (!this.backingDimensionsMatch()) {
      this.failClosed();
      return { status: "failed", reason: "presentation-failed" };
    }

    frameWriteCapabilities.delete(frame);
    this.activeFrame = null;
    this.completedProducerWrite = null;
    this.presentationInFlight = true;
    // Acquiring/submitting a new browser presentation texture may replace the displayed pixels
    // before its fence settles. Revoke the previous authority synchronously so every visible frame
    // — not only the first one — is guarded by its own completed receipt.
    this.visibleReceipt = null;
    let errorScopeDepth = 0;
    const pendingScopes: Array<Promise<GPUError | null>> = [];
    try {
      for (const filter of [
        "internal",
        "out-of-memory",
        "validation",
      ] as const satisfies readonly GPUErrorFilter[]) {
        this.device.pushErrorScope(filter);
        errorScopeDepth += 1;
      }
      const encoder = this.device.createCommandEncoder({
        label: `Studio Engine shared linear presentation ${frame.requestSequence}`,
      });
      const presentationTexture = this.context.getCurrentTexture();
      const pass = encoder.beginRenderPass({
        label: `Studio Engine shared linear presentation pass ${frame.requestSequence}`,
        colorAttachments: [{
          view: presentationTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.resources.pipeline);
      pass.setBindGroup(0, this.workSurface.bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      const queueCompletion = this.device.queue.onSubmittedWorkDone();
      while (errorScopeDepth > 0) {
        pendingScopes.push(this.device.popErrorScope());
        errorScopeDepth -= 1;
      }
      const [, scopedErrors] = await Promise.all([
        queueCompletion,
        Promise.all(pendingScopes),
      ]);
      if (this.currentStatus() === "disposed") {
        return { status: "rejected", reason: "disposed" };
      }
      if (this.currentStatus() === "device-lost") {
        return { status: "rejected", reason: "device-lost" };
      }
      if (
        this.status !== "ready"
        || this.configuration !== frame.configuration
        || this.workSurface.publicSurface !== frame.workSurface
      ) return { status: "rejected", reason: "runtime-failed" };
      if (scopedErrors.some((error) => error !== null)) {
        this.failClosed();
        return { status: "failed", reason: "gpu-error" };
      }
      const receipt = Object.freeze({
        kind: "studio-engine-webgpu-presentation-receipt" as const,
        revision: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION,
        backend: "webgpu" as const,
        requestSequence: frame.requestSequence,
        sourceFrameFingerprint: frame.sourceFrameFingerprint,
        deviceEpoch: frame.deviceEpoch,
        presentationEpoch: frame.presentationEpoch,
        resizeEpoch: frame.resizeEpoch,
        viewportEpoch: frame.viewportEpoch,
        flipEpoch: frame.flipEpoch,
        workSurfaceEpoch: frame.workSurface.workSurfaceEpoch,
        mode: completedProducerWrite.claim.mode,
        baseContentGeneration:
          completedProducerWrite.claim.baseContentGeneration,
        baseContentFingerprint:
          completedProducerWrite.claim.baseContentFingerprint,
        contentGeneration: completedProducerWrite.claim.contentGeneration,
        contentFingerprint: completedProducerWrite.claim.contentFingerprint,
        width: frame.workSurface.width,
        height: frame.workSurface.height,
        textureFormat: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_FORMAT,
        canvasFormat: this.canvasFormat,
        colorModel: STUDIO_ENGINE_WEBGPU_PRESENTATION_COLOR_MODEL,
        workingColorSpace:
          STUDIO_ENGINE_WEBGPU_PRESENTATION_WORKING_COLOR_SPACE,
        presentationColorSpace:
          STUDIO_ENGINE_WEBGPU_PRESENTATION_OUTPUT_COLOR_SPACE,
        alphaMode: "premultiplied" as const,
        queueState: "completed" as const,
        presentationState: "presented" as const,
        visible: true as const,
        complete: true as const,
      });
      this.visibleReceipt = receipt;
      this.lastPresentedRequestSequence = frame.requestSequence;
      this.presentations += 1;
      return { status: "presented", receipt };
    } catch {
      while (errorScopeDepth > 0) {
        try {
          pendingScopes.push(this.device.popErrorScope());
        } catch {
          // The runtime is retired below, so an already-collapsed scope stack is harmless.
        }
        errorScopeDepth -= 1;
      }
      if (pendingScopes.length > 0) void Promise.allSettled(pendingScopes);
      if (this.currentStatus() === "disposed") {
        return { status: "rejected", reason: "disposed" };
      }
      if (this.currentStatus() === "device-lost") {
        return { status: "rejected", reason: "device-lost" };
      }
      this.failClosed();
      return { status: "failed", reason: "presentation-failed" };
    } finally {
      this.presentationInFlight = false;
    }
  }

  public visibility(): StudioEngineWebGpuPresentationVisibility {
    if (this.status === "disposed") {
      return Object.freeze({ visible: false, reason: "disposed" });
    }
    if (this.status === "device-lost") {
      return Object.freeze({ visible: false, reason: "device-lost" });
    }
    if (this.status === "failed") {
      return Object.freeze({ visible: false, reason: "failed" });
    }
    if (!this.configuration) {
      return Object.freeze({ visible: false, reason: "unconfigured" });
    }
    if (!this.visibleReceipt) {
      return Object.freeze({ visible: false, reason: "awaiting-present" });
    }
    return Object.freeze({ visible: true, receipt: this.visibleReceipt });
  }

  public authorizesVisibility(
    receipt: StudioEngineWebGpuPresentationReceipt,
  ): boolean {
    return this.status === "ready"
      && this.visibleReceipt === receipt
      && receipt.complete
      && receipt.visible;
  }

  public stats(): StudioEngineWebGpuPresentationSurfaceStats {
    return Object.freeze({
      status: this.status,
      configured: this.configuration !== null,
      deviceEpoch: this.deviceEpoch,
      presentationEpoch: this.configuration?.presentationEpoch ?? 0,
      resizeEpoch: this.configuration?.resizeEpoch ?? 0,
      viewportEpoch: this.configuration?.viewportEpoch ?? 0,
      flipEpoch: this.configuration?.flipEpoch ?? 0,
      workSurfaceEpoch: this.workSurfaceEpoch,
      lastAcceptedRequestSequence: this.lastAcceptedRequestSequence,
      lastPresentedRequestSequence: this.lastPresentedRequestSequence,
      frameActive: this.activeFrame !== null,
      producerWriteInFlight: this.producerWriteInFlight,
      presentationInFlight: this.presentationInFlight,
      contentInitialized: this.contentInitialized,
      contentGeneration: this.contentGeneration,
      contentFingerprint: this.contentFingerprint,
      surfaceTextureAllocations: this.surfaceTextureAllocations,
      presentations: this.presentations,
    });
  }

  public dispose(): void {
    if (this.status === "disposed") return;
    this.status = "disposed";
    this.visibleReceipt = null;
    this.revokeCapabilities();
    this.activeFrame = null;
    this.activeProducerClaim = null;
    this.completedProducerWrite = null;
    this.producerWriteInFlight = false;
    this.presentationInFlight = false;
    this.contentInitialized = false;
    this.contentFingerprint = null;
    safeUnconfigure(this.context);
    safeDestroyTexture(this.workSurface?.texture ?? null);
    this.workSurface = null;
    this.configuration = null;
    this.layout = null;
    safeDestroyDevice(this.device, this.ownsDevice);
  }

  private contentSnapshot():
    StudioEngineWebGpuPresentationContentSnapshot {
    return Object.freeze({
      initialized: this.contentInitialized,
      generation: this.contentGeneration,
      fingerprint: this.contentFingerprint,
    });
  }

  private acquireProducerWrite(
    frame: StudioEngineWebGpuPresentationFrameLease,
    intent: StudioEngineWebGpuPresentationProducerWriteIntent,
  ): StudioEngineWebGpuPresentationProducerWriteAcquireResult {
    if (
      this.status !== "ready"
      || this.activeFrame !== frame
      || this.producerWriteInFlight
      || this.completedProducerWrite !== null
      || frame.workSurface !== this.workSurface?.publicSurface
      || frame.configuration !== this.configuration
      || frame.contentAtAcquire.initialized !== this.contentInitialized
      || frame.contentAtAcquire.generation !== this.contentGeneration
      || frame.contentAtAcquire.fingerprint !== this.contentFingerprint
    ) {
      return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    }
    if (
      !intent
      || (intent.mode !== "append" && intent.mode !== "rebuild")
      || !validFingerprint(intent.sourceFrameFingerprint)
      || intent.sourceFrameFingerprint !== frame.sourceFrameFingerprint
    ) {
      return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    }
    if (
      intent.mode === "append"
      && (!this.contentInitialized || !this.contentFingerprint)
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "content-uninitialized",
      });
    }
    if (this.contentGeneration === Number.MAX_SAFE_INTEGER) {
      return Object.freeze({
        status: "rejected",
        reason: "content-generation-exhausted",
      });
    }
    const baseContentFingerprint =
      intent.mode === "append" ? this.contentFingerprint : null;
    const contentFingerprint =
      fingerprintStudioEngineWebGpuPresentationContent({
        mode: intent.mode,
        baseContentFingerprint,
        sourceFrameFingerprint: intent.sourceFrameFingerprint,
        width: frame.workSurface.width,
        height: frame.workSurface.height,
        documentToSurface: frame.configuration.documentToSurface,
      });
    if (!contentFingerprint) {
      return Object.freeze({ status: "rejected", reason: "invalid-frame" });
    }
    const claim = Object.freeze({
      kind: "studio-engine-webgpu-presentation-producer-write-claim" as const,
      revision: STUDIO_ENGINE_WEBGPU_PRESENTATION_SURFACE_REVISION,
      requestSequence: frame.requestSequence,
      deviceEpoch: frame.deviceEpoch,
      workSurfaceEpoch: frame.workSurface.workSurfaceEpoch,
      mode: intent.mode,
      sourceFrameFingerprint: intent.sourceFrameFingerprint,
      baseContentGeneration: this.contentGeneration,
      baseContentFingerprint,
      contentGeneration: this.contentGeneration + 1,
      contentFingerprint,
    });
    this.activeProducerClaim = claim;
    this.completedProducerWrite = null;
    this.producerWriteInFlight = true;
    producerWriteClaimCapabilities.set(claim, {
      settle: (outcome) => this.settleProducerWrite(frame, claim, outcome),
    });
    return Object.freeze({ status: "ready", claim });
  }

  private settleProducerWrite(
    frame: StudioEngineWebGpuPresentationFrameLease,
    claim: StudioEngineWebGpuPresentationProducerWriteClaim,
    outcome: "completed" | "failed",
  ): StudioEngineWebGpuPresentationProducerWriteSettlementResult {
    if (
      this.activeProducerClaim !== claim
      || !this.producerWriteInFlight
    ) {
      producerWriteClaimCapabilities.delete(claim);
      return Object.freeze({ status: "rejected", reason: "invalid-claim" });
    }
    producerWriteClaimCapabilities.delete(claim);
    this.activeProducerClaim = null;
    this.producerWriteInFlight = false;
    if (this.status !== "ready" || this.activeFrame !== frame) {
      return Object.freeze({ status: "rejected", reason: "claim-revoked" });
    }
    if (outcome === "failed") {
      this.completedProducerWrite = null;
      if (!this.invalidateContent(claim.contentGeneration)) {
        this.failClosed();
        return Object.freeze({ status: "rejected", reason: "claim-revoked" });
      }
      return Object.freeze({
        status: "invalidated",
        reason: "producer-failed",
        content: this.contentSnapshot(),
      });
    }
    this.contentGeneration = claim.contentGeneration;
    this.contentInitialized = true;
    this.contentFingerprint = claim.contentFingerprint;
    this.completedProducerWrite = Object.freeze({ frame, claim });
    return Object.freeze({
      status: "completed",
      content: this.contentSnapshot(),
    });
  }

  private invalidateContent(minimumGeneration: number): boolean {
    if (
      !unsignedSafeInteger(minimumGeneration)
      || minimumGeneration > Number.MAX_SAFE_INTEGER
    ) return false;
    if (
      !this.contentInitialized
      && this.contentFingerprint === null
      && this.contentGeneration >= minimumGeneration
    ) return true;
    const nextGeneration = Math.max(
      minimumGeneration,
      this.contentGeneration + 1,
    );
    if (!unsignedSafeInteger(nextGeneration)) return false;
    this.contentGeneration = nextGeneration;
    this.contentInitialized = false;
    this.contentFingerprint = null;
    this.completedProducerWrite = null;
    return true;
  }

  private revokeCapabilities(): void {
    if (this.activeFrame) frameWriteCapabilities.delete(this.activeFrame);
    if (this.activeProducerClaim) {
      producerWriteClaimCapabilities.delete(this.activeProducerClaim);
    }
  }

  private currentStatus(): "ready" | "device-lost" | "failed" | "disposed" {
    return this.status;
  }

  private backingDimensionsMatch(): boolean {
    return this.configuration !== null
      && this.canvas.width === this.configuration.physicalWidth
      && this.canvas.height === this.configuration.physicalHeight;
  }

  private failClosed(): void {
    if (this.status !== "ready") return;
    this.status = "failed";
    this.visibleReceipt = null;
    this.revokeCapabilities();
    this.activeFrame = null;
    this.activeProducerClaim = null;
    this.completedProducerWrite = null;
    this.producerWriteInFlight = false;
    this.presentationInFlight = false;
    this.contentInitialized = false;
    this.contentFingerprint = null;
    safeUnconfigure(this.context);
    safeDestroyTexture(this.workSurface?.texture ?? null);
    this.workSurface = null;
    this.configuration = null;
    this.layout = null;
    safeDestroyDevice(this.device, this.ownsDevice);
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.status !== "ready") return;
    this.status = "device-lost";
    if (this.deviceEpoch < Number.MAX_SAFE_INTEGER) this.deviceEpoch += 1;
    this.visibleReceipt = null;
    this.revokeCapabilities();
    this.activeFrame = null;
    this.activeProducerClaim = null;
    this.completedProducerWrite = null;
    this.producerWriteInFlight = false;
    this.presentationInFlight = false;
    this.contentInitialized = false;
    this.contentFingerprint = null;
    safeUnconfigure(this.context);
    safeDestroyTexture(this.workSurface?.texture ?? null);
    this.workSurface = null;
    this.configuration = null;
    this.layout = null;
    try {
      this.onDeviceLost?.(info);
    } catch {
      // Host callbacks cannot revive or corrupt a retired runtime generation.
    }
  }
}
