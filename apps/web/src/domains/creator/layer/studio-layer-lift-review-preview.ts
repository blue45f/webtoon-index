/**
 * Browser-only review resources for the first local Scene Layer Lift beta.
 *
 * The source preview is encoded from the exact admitted element-local RGBA
 * plane, so image filters baked by the snapshot adapter are never replaced by
 * the original URL. Background and foreground URLs are created only from the
 * compositor's already-admitted PNG artifacts. The composite tab deliberately
 * reuses the exact source preview: this beta has no separately admitted
 * flattened reconstruction artifact, so claiming one would break preview /
 * commit provenance.
 */

import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
  isStudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import { isTrustedStudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";
import {
  isStudioSceneLayerLiftTrustedSuccess,
  parseStudioSceneLayerLiftRequest,
} from "./studio-layer-lift-contract";
import {
  doesStudioLayerLiftArtifactReceiptMatchOperation,
  doesStudioLayerLiftCompositionReceiptMatchOperation,
  doesStudioSceneLayerLiftResultMatchOperation,
} from "./studio-layer-lift-operation-context";

import type { StudioSceneLayerLiftRequest } from "./studio-layer-lift-contract";
import type { StudioLayerLiftWorkflowSession } from "./studio-layer-lift-workflow";
import type {
  StudioLayerLiftReviewDiagnostic,
  StudioLayerLiftReviewPreview,
} from "./StudioLayerLiftDialog";

export const STUDIO_LAYER_LIFT_REVIEW_PREVIEW_MAX_PNG_BYTES =
  80 * 1024 * 1024;

const PNG_SIGNATURE = Object.freeze([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
] as const);

export type StudioLayerLiftReviewPreviewErrorCode =
  | "aborted"
  | "budget-exceeded"
  | "encode-failed"
  | "encode-unavailable"
  | "invalid-session"
  | "url-failed";

export class StudioLayerLiftReviewPreviewError extends Error {
  constructor(
    readonly code: StudioLayerLiftReviewPreviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code === "aborted"
      ? "AbortError"
      : "StudioLayerLiftReviewPreviewError";
  }
}

export interface StudioLayerLiftReviewPreviewEncodeInput {
  readonly width: number;
  readonly height: number;
  /** Complete, exclusively owned RGBA8 storage. */
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
}

export interface StudioLayerLiftReviewPreviewRuntime {
  readonly encodeRgbaPng: (
    input: StudioLayerLiftReviewPreviewEncodeInput,
    signal: AbortSignal | undefined,
  ) => Promise<Blob>;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

export interface CreateStudioLayerLiftReviewPreviewResourceOptions {
  readonly signal?: AbortSignal;
  /** Deterministic browser seams for focused tests. */
  readonly runtime?: Partial<StudioLayerLiftReviewPreviewRuntime>;
}

export interface StudioLayerLiftReviewPreviewResource {
  readonly preview: StudioLayerLiftReviewPreview;
  /** Idempotent. Every distinct object URL is revoked at most once. */
  readonly revoke: () => void;
}

interface Canvas2dLike {
  createImageData(width: number, height: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

function fail(
  code: StudioLayerLiftReviewPreviewErrorCode,
  message: string,
): never {
  throw new StudioLayerLiftReviewPreviewError(code, message);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    fail("aborted", "레이어 분리 미리보기 생성을 취소했습니다.");
  }
}

function isCompleteArrayBufferView(
  value: unknown,
  constructor: typeof Uint8Array | typeof Uint8ClampedArray,
  expectedByteLength: number,
): value is Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> {
  return (
    value instanceof constructor
    && value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === expectedByteLength
    && value.byteLength === value.buffer.byteLength
  );
}

function sha256(bytes: Uint8Array<ArrayBuffer>): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function hasPngSignature(bytes: Uint8Array<ArrayBuffer>): boolean {
  return (
    bytes.byteLength >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  );
}

function validateDimensions(width: unknown, height: unknown): number {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumAxisPixels
    || height > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumAxisPixels
  ) {
    fail("budget-exceeded", "레이어 분리 미리보기 축 크기 예산을 초과했습니다.");
  }
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount < 1
    || pixelCount > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumPixels
  ) {
    fail("budget-exceeded", "레이어 분리 미리보기 픽셀 예산을 초과했습니다.");
  }
  return pixelCount;
}

function sourceBindingMatches(
  session: StudioLayerLiftWorkflowSession,
  source: StudioSceneLayerLiftRequest,
): boolean {
  const binding = session.ticket.source;
  return (
    source.requestId === binding.requestId
    && source.source.sourceId === binding.sourceId
    && source.source.sha256 === binding.sourceSha256
    && source.source.width === binding.width
    && source.source.height === binding.height
  );
}

function validateCurrentArtifactBytes(
  bytes: ArrayBuffer,
  expectedByteLength: number,
  expectedSha256: `sha256:${string}`,
): Uint8Array<ArrayBuffer> {
  if (
    !(bytes instanceof ArrayBuffer)
    || bytes.byteLength !== expectedByteLength
    || bytes.byteLength < PNG_SIGNATURE.length
  ) {
    fail("invalid-session", "검증된 PNG 아티팩트 저장소가 변경되었습니다.");
  }
  const owned = new Uint8Array(
    ArrayBuffer.prototype.slice.call(bytes, 0) as ArrayBuffer,
  );
  if (!hasPngSignature(owned) || sha256(owned) !== expectedSha256) {
    fail("invalid-session", "검증된 PNG 아티팩트 내용이 변경되었습니다.");
  }
  return owned;
}

function mapDiagnostics(
  session: StudioLayerLiftWorkflowSession,
): readonly StudioLayerLiftReviewDiagnostic[] {
  const mapped = session.providerResult.diagnostics.map(
    (diagnostic, index): StudioLayerLiftReviewDiagnostic => Object.freeze({
      id: `${diagnostic.code.toLowerCase()}-${
        diagnostic.layerId ?? "source"
      }-${index}`,
      tone: diagnostic.severity === "warning" ? "warning" : "info",
      message: diagnostic.message,
    }),
  );
  const repair = backgroundRepairAssessment(session);
  if (repair.quality === "review") {
    mapped.push(Object.freeze({
      id: "background-repair-review",
      tone: "warning",
      message:
        `전경이 원본의 ${Math.round(repair.coverageRatio * 100)}%를 가립니다. `
        + "현재 로컬 Beta는 가려진 장면을 새로 상상하지 않으므로 배경 탭의 반복·번짐을 확인해 주세요.",
    }));
  }
  mapped.push(Object.freeze({
    id: "composite-source-parity",
    tone: "info",
    message:
      "합성 탭은 검증된 원본 픽셀과 동일하게 표시됩니다. 복원 경계는 배경·전경 탭에서 확인해 주세요.",
  }));
  return Object.freeze(mapped);
}

function backgroundRepairAssessment(
  session: StudioLayerLiftWorkflowSession,
): Readonly<{
  readonly quality: "good" | "review";
  readonly coverageRatio: number;
}> {
  const {
    selectedPixelCount,
    partialPixelCount,
    transparentSelectedPixelCount,
  } = session.preview.backgroundRepair;
  const pixelCount = session.preview.width * session.preview.height;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount < 1
    || !Number.isSafeInteger(selectedPixelCount)
    || !Number.isSafeInteger(partialPixelCount)
    || !Number.isSafeInteger(transparentSelectedPixelCount)
    || selectedPixelCount < 1
    || selectedPixelCount > pixelCount
    || partialPixelCount < 0
    || transparentSelectedPixelCount < 0
    || partialPixelCount > selectedPixelCount
    || transparentSelectedPixelCount > selectedPixelCount
  ) {
    fail("invalid-session", "배경 복원 진단값이 올바르지 않습니다.");
  }
  const coverageRatio = selectedPixelCount / pixelCount;
  const partialRatio = partialPixelCount / selectedPixelCount;
  const transparentRatio =
    transparentSelectedPixelCount / selectedPixelCount;
  return Object.freeze({
    quality: (
      session.providerResult.confidence.band === "high"
      && coverageRatio <= 0.12
      && partialRatio <= 0.25
      && transparentRatio <= 0.05
    )
      ? "good"
      : "review",
    coverageRatio,
  });
}

function validateSession(
  value: StudioLayerLiftWorkflowSession,
): Readonly<{
  readonly width: number;
  readonly height: number;
  readonly sourceRgba: Uint8ClampedArray<ArrayBuffer>;
  readonly maskAlpha: Uint8Array<ArrayBuffer>;
  readonly backgroundPng: Uint8Array<ArrayBuffer>;
  readonly foregroundPng: Uint8Array<ArrayBuffer>;
}> {
  let session: StudioLayerLiftWorkflowSession;
  try {
    session = value;
    if (
      typeof session !== "object"
      || session === null
      || !isStudioSceneLayerLiftTrustedSuccess(session.providerResult)
      || !isStudioLayerLiftTrustedArtifactPair(session.artifacts)
      || !isTrustedStudioLayerLiftCompositionReceipt(
        session.compositionReceipt,
      )
    ) {
      fail("invalid-session", "검증된 레이어 분리 세션이 아닙니다.");
    }
  } catch (error) {
    if (error instanceof StudioLayerLiftReviewPreviewError) throw error;
    fail("invalid-session", "레이어 분리 세션을 읽을 수 없습니다.");
  }

  const parsedRequest = parseStudioSceneLayerLiftRequest(session.request);
  if (
    !parsedRequest.ok
    || !sourceBindingMatches(session, parsedRequest.value)
    || !doesStudioSceneLayerLiftResultMatchOperation(
      session.ticket,
      session.providerResult,
    )
    || !doesStudioLayerLiftArtifactReceiptMatchOperation(
      session.ticket,
      session.artifacts.receipt,
    )
    || !doesStudioLayerLiftCompositionReceiptMatchOperation({
      ticket: session.ticket,
      providerResult: session.providerResult,
      artifacts: session.artifacts,
      compositionReceipt: session.compositionReceipt,
    })
  ) {
    fail("invalid-session", "레이어 분리 세션의 출처 증명이 일치하지 않습니다.");
  }

  const width = parsedRequest.value.source.width;
  const height = parsedRequest.value.source.height;
  const pixelCount = validateDimensions(width, height);
  const rgbaByteLength = pixelCount * 4;
  if (
    !isCompleteArrayBufferView(
      parsedRequest.value.source.bytes,
      Uint8Array,
      rgbaByteLength,
    )
    || sha256(parsedRequest.value.source.bytes)
      !== parsedRequest.value.source.sha256
    || session.preview.width !== width
    || session.preview.height !== height
    || !isCompleteArrayBufferView(
      session.preview.sourceRgba,
      Uint8ClampedArray,
      rgbaByteLength,
    )
    || !isCompleteArrayBufferView(
      session.preview.backgroundRgba,
      Uint8ClampedArray,
      rgbaByteLength,
    )
    || !isCompleteArrayBufferView(
      session.preview.foregroundRgba,
      Uint8ClampedArray,
      rgbaByteLength,
    )
    || !isCompleteArrayBufferView(
      session.preview.maskAlpha,
      Uint8Array,
      pixelCount,
    )
  ) {
    fail("invalid-session", "레이어 분리 미리보기 픽셀 저장소가 올바르지 않습니다.");
  }

  const foregroundLayers = session.providerResult.layers.filter(
    (layer) => layer.role === "character" || layer.role === "foreground",
  );
  if (
    foregroundLayers.length !== 1
    || sha256(session.preview.maskAlpha) !== foregroundLayers[0]!.mask.sha256
  ) {
    fail("invalid-session", "레이어 분리 마스크 증명이 일치하지 않습니다.");
  }

  const backgroundPng = validateCurrentArtifactBytes(
    session.artifacts.background.bytes,
    session.artifacts.background.byteLength,
    session.artifacts.background.sha256,
  );
  const foregroundPng = validateCurrentArtifactBytes(
    session.artifacts.foreground.bytes,
    session.artifacts.foreground.byteLength,
    session.artifacts.foreground.sha256,
  );

  return Object.freeze({
    width,
    height,
    sourceRgba: new Uint8ClampedArray(parsedRequest.value.source.bytes),
    maskAlpha: new Uint8Array(session.preview.maskAlpha),
    backgroundPng,
    foregroundPng,
  });
}

function putRgba(
  context: Canvas2dLike,
  width: number,
  height: number,
  bytes: Uint8ClampedArray<ArrayBuffer>,
): void {
  const imageData = context.createImageData(width, height);
  imageData.data.set(bytes);
  context.putImageData(imageData, 0, 0);
}

async function encodeWithHtmlCanvas(
  width: number,
  height: number,
  bytes: Uint8ClampedArray<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  if (typeof document !== "object") {
    fail("encode-unavailable", "브라우저 PNG 인코더를 사용할 수 없습니다.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      fail("encode-unavailable", "Canvas 2D 미리보기 인코더를 열 수 없습니다.");
    }
    putRgba(context, width, height, bytes);
    throwIfAborted(signal);
    return await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const complete = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        callback();
      };
      const abort = () => complete(() => reject(
        new StudioLayerLiftReviewPreviewError(
          "aborted",
          "레이어 분리 미리보기 생성을 취소했습니다.",
        ),
      ));
      signal?.addEventListener("abort", abort, { once: true });
      canvas.toBlob(
        (blob) => complete(() => {
          if (!blob) {
            reject(new StudioLayerLiftReviewPreviewError(
              "encode-failed",
              "Canvas PNG 미리보기 인코딩에 실패했습니다.",
            ));
            return;
          }
          resolve(blob);
        }),
        "image/png",
      );
      if (signal?.aborted) abort();
    });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function defaultEncodeRgbaPng(
  input: StudioLayerLiftReviewPreviewEncodeInput,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  throwIfAborted(signal);
  if (typeof OffscreenCanvas === "function") {
    const surface = new OffscreenCanvas(input.width, input.height);
    try {
      const context = surface.getContext("2d");
      if (!context) {
        fail(
          "encode-unavailable",
          "OffscreenCanvas 2D 미리보기 인코더를 열 수 없습니다.",
        );
      }
      putRgba(context, input.width, input.height, input.bytes);
      throwIfAborted(signal);
      const blob = await surface.convertToBlob({ type: "image/png" });
      throwIfAborted(signal);
      return blob;
    } finally {
      surface.width = 1;
      surface.height = 1;
    }
  }
  return encodeWithHtmlCanvas(
    input.width,
    input.height,
    input.bytes,
    signal,
  );
}

function defaultCreateObjectURL(blob: Blob): string {
  if (typeof URL.createObjectURL !== "function") {
    fail("url-failed", "브라우저 미리보기 URL 기능을 사용할 수 없습니다.");
  }
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectURL(url: string): void {
  URL.revokeObjectURL(url);
}

function resolveRuntime(
  overrides: Partial<StudioLayerLiftReviewPreviewRuntime> | undefined,
): StudioLayerLiftReviewPreviewRuntime {
  return {
    encodeRgbaPng: overrides?.encodeRgbaPng ?? defaultEncodeRgbaPng,
    createObjectURL: overrides?.createObjectURL ?? defaultCreateObjectURL,
    revokeObjectURL:
      overrides?.revokeObjectURL ?? defaultRevokeObjectURL,
  };
}

async function assertPngBlob(
  blob: Blob,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (
    !(blob instanceof Blob)
    || blob.type.toLowerCase() !== "image/png"
    || blob.size < PNG_SIGNATURE.length
    || blob.size > STUDIO_LAYER_LIFT_REVIEW_PREVIEW_MAX_PNG_BYTES
  ) {
    fail("encode-failed", "미리보기 PNG 인코더가 잘못된 결과를 반환했습니다.");
  }
  const signature = new Uint8Array(
    await blob.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
  );
  throwIfAborted(signal);
  if (!hasPngSignature(signature)) {
    fail("encode-failed", "미리보기 PNG 서명이 올바르지 않습니다.");
  }
}

function visibleMaskRgba(
  alpha: Uint8Array<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(alpha.byteLength * 4);
  for (let index = 0; index < alpha.byteLength; index += 1) {
    const value = alpha[index]!;
    const offset = index * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

/**
 * Creates short-lived browser resources for the protected Layer Lift review
 * dialog. No document state is changed and no network request is performed.
 */
export async function createStudioLayerLiftReviewPreviewResource(
  session: StudioLayerLiftWorkflowSession,
  options: CreateStudioLayerLiftReviewPreviewResourceOptions = {},
): Promise<StudioLayerLiftReviewPreviewResource> {
  throwIfAborted(options.signal);
  const validated = validateSession(session);
  const runtime = resolveRuntime(options.runtime);
  const objectUrls = new Set<string>();
  let revoked = false;

  const revoke = () => {
    if (revoked) return;
    revoked = true;
    for (const url of objectUrls) {
      try {
        runtime.revokeObjectURL(url);
      } catch {
        // Best-effort browser resource cleanup must continue for every URL.
      }
    }
    objectUrls.clear();
  };

  const objectUrl = (blob: Blob): string => {
    throwIfAborted(options.signal);
    let url: string;
    try {
      url = runtime.createObjectURL(blob);
    } catch (error) {
      if (error instanceof StudioLayerLiftReviewPreviewError) throw error;
      return fail("url-failed", "레이어 분리 미리보기 URL을 만들지 못했습니다.");
    }
    if (
      typeof url !== "string"
      || url.length < 1
      || url.length > 4_096
    ) {
      fail("url-failed", "레이어 분리 미리보기 URL이 올바르지 않습니다.");
    }
    objectUrls.add(url);
    return url;
  };

  try {
    const sourceBlob = await runtime.encodeRgbaPng({
      width: validated.width,
      height: validated.height,
      bytes: new Uint8ClampedArray(validated.sourceRgba),
    }, options.signal);
    await assertPngBlob(sourceBlob, options.signal);
    const sourceSrc = objectUrl(sourceBlob);
    throwIfAborted(options.signal);

    const backgroundSrc = objectUrl(new Blob(
      [validated.backgroundPng.buffer],
      { type: "image/png" },
    ));
    const foregroundSrc = objectUrl(new Blob(
      [validated.foregroundPng.buffer],
      { type: "image/png" },
    ));

    const maskBlob = await runtime.encodeRgbaPng({
      width: validated.width,
      height: validated.height,
      bytes: visibleMaskRgba(validated.maskAlpha),
    }, options.signal);
    await assertPngBlob(maskBlob, options.signal);
    const maskSrc = objectUrl(maskBlob);
    throwIfAborted(options.signal);

    const preview: StudioLayerLiftReviewPreview = Object.freeze({
      width: validated.width,
      height: validated.height,
      sourceSrc,
      compositeSrc: sourceSrc,
      maskSrc,
      backgroundSrc,
      foregroundSrc,
      maskAlpha: new Uint8Array(validated.maskAlpha),
      confidenceScore: session.providerResult.confidence.score,
      confidenceBand: session.providerResult.confidence.band,
      backgroundRepairQuality:
        backgroundRepairAssessment(session).quality,
      diagnostics: mapDiagnostics(session),
    });
    return Object.freeze({ preview, revoke });
  } catch (error) {
    revoke();
    if (error instanceof StudioLayerLiftReviewPreviewError) throw error;
    if (options.signal?.aborted) {
      fail("aborted", "레이어 분리 미리보기 생성을 취소했습니다.");
    }
    fail("encode-failed", "레이어 분리 미리보기 PNG를 만들지 못했습니다.");
  }
}
