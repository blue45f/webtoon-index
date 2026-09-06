/**
 * First local Scene Layer Lift provider slice.
 *
 * Capability is deliberately narrow: one person/character foreground proposal.
 * The injected inference engine may be backed by the existing MediaPipe
 * ImageSegmenter or by the product ONNX provider, but this adapter never claims
 * general object understanding, background reconstruction, or editable text.
 */
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
  STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
  calculateStudioSceneLayerLiftProviderReceiptSha256,
  isStudioSceneLayerLiftTrustedSuccess,
  parseStudioSceneLayerLiftRequest,
  parseStudioSceneLayerLiftResult,
  type StudioSceneLayerLiftConfidence,
  type StudioSceneLayerLiftDiagnostic,
  type StudioSceneLayerLiftLocalProviderReceiptUnsigned,
  type StudioSceneLayerLiftRequest,
  type StudioSceneLayerLiftSha256,
  type StudioSceneLayerLiftSuccess,
} from "./studio-layer-lift-contract";
import {
  prepareStudioLayerLiftMask,
  type StudioLayerLiftPreparedMask,
} from "./studio-layer-lift-mask";

export const STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY =
  "person-character-foreground-beta-v1" as const;
export const STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_DEFAULT_TIMEOUT_MS = 45_000;
export const STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_MAX_TIMEOUT_MS = 120_000;

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_FEATHER = 0.08;
const MODEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const PROVIDER_VERSION_MAX_CHARACTERS =
  STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumProviderVersionCharacters;
const TEXT_ENCODER = new TextEncoder();

export interface StudioLayerLiftLocalForegroundModelIdentity {
  /** Examples: `mediapipe-image-segmenter`, `onnxruntime-web`. */
  readonly providerId: string;
  /** Runtime/adapter version, not a mutable display label. */
  readonly providerVersion: string;
  /** Examples: `selfie-segmenter`, a registered ONNX model ID. */
  readonly modelId: string;
  readonly modelVersion: string;
  /** Stable preselected execution route such as `gpu`, `cpu-explicit`, or `webgpu`. */
  readonly executionRoute: string;
}

export interface StudioLayerLiftLocalForegroundInferenceInput {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly sourceSha256: StudioSceneLayerLiftSha256;
  /**
   * A provider-owned defensive copy. Mutating it cannot mutate the admitted
   * request or the pixels used to construct the returned layer.
   */
  readonly rgba: Uint8Array<ArrayBuffer>;
  readonly signal: AbortSignal;
}

export interface StudioLayerLiftLocalForegroundInferenceOutput {
  /** Native model dimensions are allowed; the mask foundation resamples them. */
  readonly width: number;
  readonly height: number;
  readonly confidence: Float32Array;
}

export interface StudioLayerLiftLocalForegroundInferenceEngine {
  readonly model: StudioLayerLiftLocalForegroundModelIdentity;
  infer(
    input: StudioLayerLiftLocalForegroundInferenceInput,
  ): Promise<StudioLayerLiftLocalForegroundInferenceOutput>;
}

/**
 * Model loading is intentionally injectable. Production can lazy-load the
 * existing MediaPipe route or an ONNX WebGPU/WASM route; unit tests never fetch
 * a model and use a deterministic fake engine.
 */
export type StudioLayerLiftLocalForegroundInferenceLoader = (
  signal: AbortSignal,
) => Promise<StudioLayerLiftLocalForegroundInferenceEngine>;

export interface CreateStudioLayerLiftLocalForegroundProviderOptions {
  readonly loadInference: StudioLayerLiftLocalForegroundInferenceLoader;
  /** Monotonic clock seam used only for the canonical provider receipt. */
  readonly now?: () => number;
}

export interface StudioLayerLiftLocalForegroundAnalyzeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Confidence midpoint. */
  readonly threshold?: number;
  /** Total smoothstep transition width in confidence space. */
  readonly feather?: number;
}

export interface StudioLayerLiftLocalForegroundProvider {
  readonly capability: typeof STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY;
  analyze(
    request: unknown,
    options?: StudioLayerLiftLocalForegroundAnalyzeOptions,
  ): Promise<StudioSceneLayerLiftSuccess>;
}

export interface ApplyStudioLayerLiftLocalForegroundCorrectionInput {
  readonly request: unknown;
  readonly providerResult: unknown;
  readonly mask: Uint8Array<ArrayBuffer>;
}

export type StudioLayerLiftLocalForegroundProviderErrorCode =
  | "invalid-request"
  | "unsupported-capability"
  | "invalid-options"
  | "invalid-model-identity"
  | "inference-failed"
  | "invalid-inference"
  | "empty-foreground"
  | "contract-rejected"
  | "aborted"
  | "timeout";

export class StudioLayerLiftLocalForegroundProviderError extends Error {
  readonly code: StudioLayerLiftLocalForegroundProviderErrorCode;
  readonly detail: string;

  constructor(
    code: StudioLayerLiftLocalForegroundProviderErrorCode,
    detail: string,
  ) {
    super(messageForProviderError(code));
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : "StudioLayerLiftLocalForegroundProviderError";
    this.code = code;
    this.detail = detail;
  }
}

interface NormalizedAnalyzeOptions {
  readonly timeoutMs: number;
  readonly threshold: number;
  readonly feather: number;
}

interface CanonicalModelBinding {
  readonly providerId: string;
  readonly providerVersion: string;
}

function messageForProviderError(
  code: StudioLayerLiftLocalForegroundProviderErrorCode,
): string {
  switch (code) {
    case "invalid-request":
      return "Scene Layer Lift request validation failed.";
    case "unsupported-capability":
      return "The local beta supports only person or character foreground extraction.";
    case "invalid-options":
      return "Local foreground extraction options are invalid.";
    case "invalid-model-identity":
      return "The local foreground model identity is invalid.";
    case "inference-failed":
      return "The local foreground model could not complete inference.";
    case "invalid-inference":
      return "The local foreground model returned an invalid confidence mask.";
    case "empty-foreground":
      return "The local foreground model found no visible person or character.";
    case "contract-rejected":
      return "The local foreground proposal failed the Scene Layer Lift contract.";
    case "aborted":
      return "Local foreground extraction was cancelled.";
    case "timeout":
      return "Local foreground extraction exceeded its time budget.";
  }
}

function providerError(
  code: StudioLayerLiftLocalForegroundProviderErrorCode,
  detail: string,
): StudioLayerLiftLocalForegroundProviderError {
  return new StudioLayerLiftLocalForegroundProviderError(code, detail);
}

function defaultNow(): number {
  if (
    typeof globalThis.performance === "object"
    && typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
}

function safeElapsedMilliseconds(startedAt: number, endedAt: number): number {
  if (
    !Number.isFinite(startedAt)
    || !Number.isFinite(endedAt)
    || endedAt <= startedAt
  ) {
    return 0;
  }
  return Math.min(
    endedAt - startedAt,
    STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumDurationMilliseconds,
  );
}

function normalizeAnalyzeOptions(
  input: StudioLayerLiftLocalForegroundAnalyzeOptions | undefined,
): NormalizedAnalyzeOptions {
  let timeoutMs: unknown;
  let threshold: unknown;
  let feather: unknown;
  try {
    timeoutMs =
      input?.timeoutMs ?? STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_DEFAULT_TIMEOUT_MS;
    threshold = input?.threshold ?? DEFAULT_THRESHOLD;
    feather = input?.feather ?? DEFAULT_FEATHER;
  } catch {
    throw providerError("invalid-options", "options.unreadable");
  }

  if (
    typeof timeoutMs !== "number"
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_MAX_TIMEOUT_MS
  ) {
    throw providerError("invalid-options", "options.timeoutMs");
  }
  if (
    typeof threshold !== "number"
    || typeof feather !== "number"
    || !Number.isFinite(threshold)
    || !Number.isFinite(feather)
    || threshold < 0
    || threshold > 1
    || feather < 0
    || feather > 1
    || (
      feather > 0
      && (
        threshold - feather / 2 < 0
        || threshold + feather / 2 > 1
      )
    )
  ) {
    throw providerError("invalid-options", "options.mask");
  }
  return Object.freeze({ timeoutMs, threshold, feather });
}

function assertSupportedCapability(request: StudioSceneLayerLiftRequest): void {
  if (
    !request.requestedRoles.includes("character")
    && !request.requestedRoles.includes("foreground")
  ) {
    throw providerError(
      "unsupported-capability",
      "request.requestedRoles.person-character-foreground",
    );
  }
}

function modelIdentifier(value: unknown, detail: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters
    || !MODEL_IDENTIFIER_PATTERN.test(value)
  ) {
    throw providerError("invalid-model-identity", detail);
  }
  return value;
}

function canonicalModelBinding(
  model: StudioLayerLiftLocalForegroundModelIdentity,
  options: NormalizedAnalyzeOptions,
): CanonicalModelBinding {
  let providerIdValue: unknown;
  let providerVersionValue: unknown;
  let modelIdValue: unknown;
  let modelVersionValue: unknown;
  let executionRouteValue: unknown;
  try {
    providerIdValue = model.providerId;
    providerVersionValue = model.providerVersion;
    modelIdValue = model.modelId;
    modelVersionValue = model.modelVersion;
    executionRouteValue = model.executionRoute;
  } catch {
    throw providerError("invalid-model-identity", "model.unreadable");
  }

  const providerBase = modelIdentifier(
    providerIdValue,
    "model.providerId",
  );
  const providerRuntimeVersion = modelIdentifier(
    providerVersionValue,
    "model.providerVersion",
  );
  const modelId = modelIdentifier(modelIdValue, "model.modelId");
  const modelVersion = modelIdentifier(
    modelVersionValue,
    "model.modelVersion",
  );
  const executionRoute = modelIdentifier(
    executionRouteValue,
    "model.executionRoute",
  );
  const providerId = `${providerBase}.${modelId}`;
  if (
    providerId.length
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters
  ) {
    throw providerError("invalid-model-identity", "model.providerBinding");
  }

  const canonicalConfiguration = JSON.stringify([
    STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY,
    providerBase,
    providerRuntimeVersion,
    modelId,
    modelVersion,
    executionRoute,
    options.threshold,
    options.feather,
    "character",
    "straight-alpha-source-multiply-v1",
  ]);
  const configurationSha256 = sha256HexPortable(
    TEXT_ENCODER.encode(canonicalConfiguration),
  );
  const readableVersion =
    `${providerRuntimeVersion}+${modelVersion}+${executionRoute}`
    + `+o.${configurationSha256.slice(0, 16)}`;
  const providerVersion = readableVersion.length <= PROVIDER_VERSION_MAX_CHARACTERS
    ? readableVersion
    : `cfg.${configurationSha256.slice(
        0,
        PROVIDER_VERSION_MAX_CHARACTERS - 4,
      )}`;
  return Object.freeze({ providerId, providerVersion });
}

function createAbortError(): StudioLayerLiftLocalForegroundProviderError {
  return providerError("aborted", "operation.signal");
}

function createTimeoutError(): StudioLayerLiftLocalForegroundProviderError {
  return providerError("timeout", "operation.timeout");
}

function runWithDeadline<Value>(
  work: (signal: AbortSignal) => Promise<Value>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Value> {
  if (callerSignal?.aborted) return Promise.reject(createAbortError());

  return new Promise<Value>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
      }
      callerSignal?.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      const error = createAbortError();
      controller.abort(error);
      settle(() => reject(error));
    };

    callerSignal?.addEventListener("abort", onAbort, { once: true });
    timer = globalThis.setTimeout(() => {
      const error = createTimeoutError();
      controller.abort(error);
      settle(() => reject(error));
    }, timeoutMs);

    void Promise.resolve()
      .then(() => work(controller.signal))
      .then(
        (value) => settle(() => resolve(value)),
        (cause: unknown) => settle(() => reject(cause)),
      );
  });
}

function isAbortError(cause: unknown): boolean {
  return (
    cause instanceof StudioLayerLiftLocalForegroundProviderError
      ? cause.code === "aborted"
      : cause instanceof Error && cause.name === "AbortError"
  );
}

function sourceAlpha(request: StudioSceneLayerLiftRequest): Uint8Array {
  const alpha = new Uint8Array(request.source.pixelCount);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = request.source.bytes[index * 4 + 3]!;
  }
  return alpha;
}

function prepareMask(
  request: StudioSceneLayerLiftRequest,
  inference: StudioLayerLiftLocalForegroundInferenceOutput,
  options: NormalizedAnalyzeOptions,
): StudioLayerLiftPreparedMask {
  let result: ReturnType<typeof prepareStudioLayerLiftMask>;
  try {
    result = prepareStudioLayerLiftMask({
      confidence: {
        width: inference.width,
        height: inference.height,
        confidence: inference.confidence,
      },
      sourceAlpha: {
        width: request.source.width,
        height: request.source.height,
        alpha: sourceAlpha(request),
      },
      options: {
        threshold: options.threshold,
        feather: options.feather,
      },
    });
  } catch {
    throw providerError("invalid-inference", "inference.unreadable");
  }
  if (!result.ok) {
    if (result.code === "empty-foreground") {
      throw providerError("empty-foreground", "inference.emptyForeground");
    }
    throw providerError("invalid-inference", `inference.${result.code}`);
  }
  return result.value;
}

function planeSha256(bytes: Uint8Array): StudioSceneLayerLiftSha256 {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function foregroundLayerId(requestId: string): string {
  const readable = `${requestId}:person-character-foreground`;
  if (
    readable.length
      <= STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumIdentifierCharacters
  ) {
    return readable;
  }
  return `person-character-foreground:${sha256HexPortable(
    TEXT_ENCODER.encode(requestId),
  )}`;
}

function confidenceBand(score: number): StudioSceneLayerLiftConfidence["band"] {
  if (score < 0.5) return "low";
  if (score < 0.8) return "medium";
  return "high";
}

function foregroundConfidence(
  prepared: StudioLayerLiftPreparedMask,
): StudioSceneLayerLiftConfidence {
  let weightedConfidence = 0;
  let matteWeight = 0;
  for (let index = 0; index < prepared.matte.alpha.length; index += 1) {
    const weight = prepared.matte.alpha[index]!;
    weightedConfidence += prepared.confidence.confidence[index]! * weight;
    matteWeight += weight;
  }
  const rawScore = matteWeight > 0 ? weightedConfidence / matteWeight : 0;
  const score = Number(Math.max(0, Math.min(1, rawScore)).toFixed(6));
  return Object.freeze({ score, band: confidenceBand(score) });
}

function boundaryTouchesCanvas(prepared: StudioLayerLiftPreparedMask): boolean {
  const { width, height, alpha } = prepared.matte;
  for (let x = 0; x < width; x += 1) {
    if (alpha[x]! > 0 || alpha[(height - 1) * width + x]! > 0) return true;
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (alpha[y * width]! > 0 || alpha[y * width + width - 1]! > 0) {
      return true;
    }
  }
  return false;
}

function ambiguityCoverage(
  prepared: StudioLayerLiftPreparedMask,
  options: NormalizedAnalyzeOptions,
): number {
  const radius = Math.max(0.05, options.feather / 2);
  let visiblePixels = 0;
  let ambiguousPixels = 0;
  for (let index = 0; index < prepared.confidence.confidence.length; index += 1) {
    if (prepared.foregroundAlpha.alpha[index] === 0) continue;
    visiblePixels += 1;
    if (
      Math.abs(
        prepared.confidence.confidence[index]! - options.threshold,
      ) <= radius
    ) {
      ambiguousPixels += 1;
    }
  }
  return visiblePixels > 0 ? ambiguousPixels / visiblePixels : 0;
}

function diagnostics(
  request: StudioSceneLayerLiftRequest,
  layerId: string,
  confidence: StudioSceneLayerLiftConfidence,
  prepared: StudioLayerLiftPreparedMask,
  options: NormalizedAnalyzeOptions,
): readonly StudioSceneLayerLiftDiagnostic[] {
  const result: StudioSceneLayerLiftDiagnostic[] = [];
  if (
    request.requestedRoles.some(
      (role) => role !== "character" && role !== "foreground",
    )
  ) {
    result.push(Object.freeze({
      code: "PROVIDER_FALLBACK",
      severity: "warning",
      layerId,
      message: "로컬 베타는 인물·캐릭터 전경 한 개만 제안합니다.",
    }));
  }
  if (confidence.band === "low") {
    result.push(Object.freeze({
      code: "LOW_CONFIDENCE",
      severity: "warning",
      layerId,
      message: "인물·캐릭터 전경 신뢰도가 낮아 마스크 검수가 필요합니다.",
    }));
  }
  if (ambiguityCoverage(prepared, options) >= 0.02) {
    result.push(Object.freeze({
      code: "AMBIGUOUS_REGION",
      severity: "warning",
      layerId,
      message: "전경 경계에 신뢰도가 비슷한 영역이 있어 검수가 필요합니다.",
    }));
  }
  if (boundaryTouchesCanvas(prepared)) {
    result.push(Object.freeze({
      code: "PARTIAL_BOUNDARY",
      severity: "warning",
      layerId,
      message: "전경이 원본 가장자리에 닿아 일부 경계가 잘렸을 수 있습니다.",
    }));
  }
  return Object.freeze(result);
}

function rawSuccess(
  request: StudioSceneLayerLiftRequest,
  prepared: StudioLayerLiftPreparedMask,
  model: CanonicalModelBinding,
  options: NormalizedAnalyzeOptions,
  durationMilliseconds: number,
): unknown {
  const layerId = foregroundLayerId(request.requestId);
  const rgbaBytes = new Uint8Array(request.source.bytes);
  const maskBytes = new Uint8Array(request.source.pixelCount);
  for (let index = 0; index < request.source.pixelCount; index += 1) {
    rgbaBytes[index * 4 + 3] = prepared.foregroundAlpha.alpha[index]!;
    maskBytes[index] = Math.round(prepared.matte.alpha[index]! * 255);
  }
  const rgbaSha256 = planeSha256(rgbaBytes);
  const maskSha256 = planeSha256(maskBytes);
  const confidence = foregroundConfidence(prepared);
  const unsignedReceipt: StudioSceneLayerLiftLocalProviderReceiptUnsigned =
    Object.freeze({
      kind: STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
      version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
      providerId: model.providerId,
      providerVersion: model.providerVersion,
      execution: "local-device",
      networkUsed: false,
      requestId: request.requestId,
      sourceSha256: request.source.sha256,
      inputByteLength: request.source.byteLength,
      outputByteLength: rgbaBytes.byteLength + maskBytes.byteLength,
      maskByteLength: maskBytes.byteLength,
      layerCount: 1,
      durationMilliseconds,
      outcome: "success",
    });

  return {
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: request.requestId,
    status: "success",
    source: {
      sourceId: request.source.sourceId,
      width: request.source.width,
      height: request.source.height,
      pixelCount: request.source.pixelCount,
      byteLength: request.source.byteLength,
      sha256: request.source.sha256,
    },
    layers: [{
      layerId,
      role: "character",
      order: 0,
      label: "인물·캐릭터 전경",
      confidence,
      rgba: {
        width: request.source.width,
        height: request.source.height,
        pixelCount: request.source.pixelCount,
        encoding: "rgba8-srgb-straight",
        channels: 4,
        byteLength: rgbaBytes.byteLength,
        sha256: rgbaSha256,
        bytes: rgbaBytes,
      },
      mask: {
        width: request.source.width,
        height: request.source.height,
        pixelCount: request.source.pixelCount,
        encoding: "alpha8",
        channels: 1,
        byteLength: maskBytes.byteLength,
        sha256: maskSha256,
        bytes: maskBytes,
      },
    }],
    confidence,
    diagnostics: diagnostics(
      request,
      layerId,
      confidence,
      prepared,
      options,
    ),
    receipt: {
      ...unsignedReceipt,
      receiptSha256:
        calculateStudioSceneLayerLiftProviderReceiptSha256(unsignedReceipt),
    },
  };
}

function admitSuccess(value: unknown): StudioSceneLayerLiftSuccess {
  const parsed = parseStudioSceneLayerLiftResult(value);
  if (!parsed.ok) {
    throw providerError(
      "contract-rejected",
      `${parsed.reason}:${parsed.detail}`,
    );
  }
  if (
    parsed.value.status !== "success"
    || !isStudioSceneLayerLiftTrustedSuccess(parsed.value)
  ) {
    throw providerError("contract-rejected", "result.notTrustedSuccess");
  }
  return parsed.value;
}

async function inferForeground(
  loader: StudioLayerLiftLocalForegroundInferenceLoader,
  request: StudioSceneLayerLiftRequest,
  options: NormalizedAnalyzeOptions,
  signal: AbortSignal,
  now: () => number,
  startedAt: number,
): Promise<StudioSceneLayerLiftSuccess> {
  let engine: StudioLayerLiftLocalForegroundInferenceEngine;
  try {
    engine = await loader(signal);
  } catch (cause) {
    if (signal.aborted || isAbortError(cause)) throw createAbortError();
    throw providerError("inference-failed", "inference.load");
  }
  if (signal.aborted) throw createAbortError();

  let model: CanonicalModelBinding;
  try {
    model = canonicalModelBinding(engine.model, options);
  } catch (cause) {
    if (cause instanceof StudioLayerLiftLocalForegroundProviderError) {
      throw cause;
    }
    throw providerError("invalid-model-identity", "model.unreadable");
  }

  let inference: StudioLayerLiftLocalForegroundInferenceOutput;
  try {
    inference = await engine.infer(Object.freeze({
      width: request.source.width,
      height: request.source.height,
      pixelCount: request.source.pixelCount,
      sourceSha256: request.source.sha256,
      rgba: new Uint8Array(request.source.bytes),
      signal,
    }));
  } catch (cause) {
    if (signal.aborted || isAbortError(cause)) throw createAbortError();
    throw providerError("inference-failed", "inference.run");
  }
  if (signal.aborted) throw createAbortError();

  let prepared: StudioLayerLiftPreparedMask;
  try {
    prepared = prepareMask(request, inference, options);
  } catch (cause) {
    if (cause instanceof StudioLayerLiftLocalForegroundProviderError) {
      throw cause;
    }
    throw providerError("invalid-inference", "inference.unreadable");
  }
  if (signal.aborted) throw createAbortError();

  return admitSuccess(rawSuccess(
    request,
    prepared,
    model,
    options,
    safeElapsedMilliseconds(startedAt, now()),
  ));
}

export function createStudioLayerLiftLocalForegroundProvider(
  createOptions: CreateStudioLayerLiftLocalForegroundProviderOptions,
): StudioLayerLiftLocalForegroundProvider {
  if (
    typeof createOptions !== "object"
    || createOptions === null
    || typeof createOptions.loadInference !== "function"
  ) {
    throw new TypeError("A local foreground inference loader is required.");
  }
  const loadInference = createOptions.loadInference;
  const now = createOptions.now ?? defaultNow;

  return Object.freeze({
    capability: STUDIO_LAYER_LIFT_LOCAL_FOREGROUND_CAPABILITY,
    async analyze(
      requestInput: unknown,
      analyzeOptions: StudioLayerLiftLocalForegroundAnalyzeOptions = {},
    ): Promise<StudioSceneLayerLiftSuccess> {
      if (analyzeOptions.signal?.aborted) throw createAbortError();
      const options = normalizeAnalyzeOptions(analyzeOptions);
      const parsedRequest = parseStudioSceneLayerLiftRequest(requestInput);
      if (!parsedRequest.ok) {
        throw providerError(
          "invalid-request",
          `${parsedRequest.reason}:${parsedRequest.detail}`,
        );
      }
      assertSupportedCapability(parsedRequest.value);
      const startedAt = now();
      return runWithDeadline(
        (signal) => inferForeground(
          loadInference,
          parsedRequest.value,
          options,
          signal,
          now,
          startedAt,
        ),
        analyzeOptions.signal,
        options.timeoutMs,
      );
    },
  });
}

/**
 * Re-admits a user-corrected alpha8 foreground mask as a new local provider
 * snapshot. The original model result stays immutable; composition receipts
 * can therefore bind to the exact mask the artist approved.
 */
export function applyStudioLayerLiftLocalForegroundCorrection(
  input: ApplyStudioLayerLiftLocalForegroundCorrectionInput,
): StudioSceneLayerLiftSuccess {
  const request = parseStudioSceneLayerLiftRequest(input.request);
  const parsedResult = parseStudioSceneLayerLiftResult(input.providerResult);
  if (
    !request.ok
    || !parsedResult.ok
    || parsedResult.value.status !== "success"
    || !isStudioSceneLayerLiftTrustedSuccess(parsedResult.value)
  ) {
    throw providerError("contract-rejected", "correction.authority");
  }
  const previous = parsedResult.value;
  if (
    previous.requestId !== request.value.requestId
    || previous.source.sourceId !== request.value.source.sourceId
    || previous.source.sha256 !== request.value.source.sha256
    || previous.layers.length !== 1
  ) {
    throw providerError("contract-rejected", "correction.binding");
  }
  if (
    !(input.mask instanceof Uint8Array)
    || input.mask instanceof Uint8ClampedArray
    || !(input.mask.buffer instanceof ArrayBuffer)
    || input.mask.byteOffset !== 0
    || input.mask.byteLength !== input.mask.buffer.byteLength
    || input.mask.byteLength !== request.value.source.pixelCount
  ) {
    throw providerError("invalid-inference", "correction.mask");
  }

  const maskBytes = new Uint8Array(input.mask);
  if (!maskBytes.some((value) => value > 0)) {
    throw providerError("empty-foreground", "correction.emptyForeground");
  }
  const rgbaBytes = new Uint8Array(request.value.source.bytes);
  for (let index = 0; index < maskBytes.length; index += 1) {
    rgbaBytes[index * 4 + 3] = Math.round(
      rgbaBytes[index * 4 + 3]! * maskBytes[index]! / 255,
    );
  }
  const previousLayer = previous.layers[0]!;
  const rgbaSha256 = planeSha256(rgbaBytes);
  const maskSha256 = planeSha256(maskBytes);
  const correctionConfigurationSha256 = sha256HexPortable(
    TEXT_ENCODER.encode(JSON.stringify([
      previous.receipt.providerId,
      previous.receipt.providerVersion,
      previous.receipt.receiptSha256,
      maskSha256,
      "user-mask-correction-v1",
    ])),
  );
  const unsignedReceipt: StudioSceneLayerLiftLocalProviderReceiptUnsigned =
    Object.freeze({
      kind: STUDIO_SCENE_LAYER_LIFT_LOCAL_PROVIDER_RECEIPT_KIND,
      version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
      providerId: previous.receipt.providerId,
      providerVersion: `manual.${correctionConfigurationSha256.slice(0, 32)}`,
      execution: "local-device",
      networkUsed: false,
      requestId: request.value.requestId,
      sourceSha256: request.value.source.sha256,
      inputByteLength: request.value.source.byteLength,
      outputByteLength: rgbaBytes.byteLength + maskBytes.byteLength,
      maskByteLength: maskBytes.byteLength,
      layerCount: 1,
      durationMilliseconds: previous.receipt.durationMilliseconds,
      outcome: "success",
    });

  return admitSuccess({
    kind: STUDIO_SCENE_LAYER_LIFT_RESULT_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: request.value.requestId,
    status: "success",
    source: {
      sourceId: request.value.source.sourceId,
      width: request.value.source.width,
      height: request.value.source.height,
      pixelCount: request.value.source.pixelCount,
      byteLength: request.value.source.byteLength,
      sha256: request.value.source.sha256,
    },
    layers: [{
      ...previousLayer,
      rgba: {
        ...previousLayer.rgba,
        sha256: rgbaSha256,
        bytes: rgbaBytes,
      },
      mask: {
        ...previousLayer.mask,
        sha256: maskSha256,
        bytes: maskBytes,
      },
    }],
    confidence: previous.confidence,
    diagnostics: previous.diagnostics,
    receipt: {
      ...unsignedReceipt,
      receiptSha256:
        calculateStudioSceneLayerLiftProviderReceiptSha256(unsignedReceipt),
    },
  });
}
