/**
 * Lazy product facade for procedural artistic brush generation.
 *
 * Importing this module is intentionally cheap: planner, module Worker client,
 * p5.brush runtime path, and browser PNG bridge enter the graph only after an
 * explicit probe or generate action. No main-thread rendering fallback exists.
 */
import type { StudioProceduralArtisticBrushReceipt } from "./studio-procedural-artistic-brush-provider";
import type { StudioProceduralArtisticBrushWorkerRequest } from "./studio-procedural-artistic-brush-worker-protocol";
import type {
  StudioProceduralArtisticBrushProbeResult,
  StudioProceduralArtisticBrushSettings,
} from "./StudioProceduralArtisticBrushController";

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS = Object.freeze({
  minDimension: 32,
  maxDimension: 1_024,
  maxPixels: 1_048_576,
  maxRgbaBytes: 4 * 1_024 * 1_024,
  maxPngBlobBytes: 8 * 1_024 * 1_024,
  maxDataUrlCodeUnits:
    "data:image/png;base64,".length
    + Math.ceil((8 * 1_024 * 1_024) / 3) * 4,
} as const);
export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_TECHNIQUES =
  Object.freeze([
    "flow-field",
    "hatch",
    "mass",
    "watercolor-fill",
    "flat-wash",
  ] as const);
export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_ADAPTER_VERSION =
  "2.2.1-adapter.3" as const;

export interface StudioProceduralArtisticBrushProductGenerateOptions {
  readonly width: number;
  readonly height: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly signal: AbortSignal;
}

export interface StudioProceduralArtisticBrushProductResult {
  readonly src: `data:image/png;base64,${string}`;
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly receipt: StudioProceduralArtisticBrushReceipt;
  readonly message: string;
}

export type StudioProceduralArtisticBrushProductFailureReason =
  | "invalid-input"
  | "budget-exceeded"
  | "runtime-unavailable"
  | "render-failed"
  | "png-failed"
  | "integrity-failed";

export class StudioProceduralArtisticBrushProductError extends Error {
  public readonly reason: StudioProceduralArtisticBrushProductFailureReason;
  public readonly path: string;

  public constructor(
    reason: StudioProceduralArtisticBrushProductFailureReason,
    message: string,
    path = "$",
  ) {
    super(message.slice(0, 512));
    this.name = "StudioProceduralArtisticBrushProductError";
    this.reason = reason;
    this.path = path;
  }
}

type UnknownRecord = Record<string, unknown>;

const SETTINGS_KEYS = Object.freeze([
  "technique",
  "color",
  "density",
  "angle",
  "weight",
  "strength",
  "seed",
]);
const OPTION_KEYS = Object.freeze([
  "width",
  "height",
  "requestSequence",
  "engineEpoch",
  "signal",
]);
const TECHNIQUES = new Set<string>(
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_TECHNIQUES,
);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

function fail(
  reason: StudioProceduralArtisticBrushProductFailureReason,
  message: string,
  path = "$",
): never {
  throw new StudioProceduralArtisticBrushProductError(
    reason,
    message,
    path,
  );
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException(
      "Procedural artistic brush generation was aborted.",
      "AbortError",
    );
  }
  const error = new Error(
    "Procedural artistic brush generation was aborted.",
  );
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError"
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function inspectExactRecord(
  candidate: unknown,
  expectedKeys: readonly string[],
  path: string,
): UnknownRecord {
  try {
    if (
      typeof candidate !== "object"
      || candidate === null
      || Array.isArray(candidate)
      || (
        Object.getPrototypeOf(candidate) !== Object.prototype
        && Object.getPrototypeOf(candidate) !== null
      )
    ) {
      fail("invalid-input", "일반 데이터 객체가 필요합니다.", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== "string")
    ) {
      fail("invalid-input", "필드 구성이 올바르지 않습니다.", path);
    }
    const expected = new Set(expectedKeys);
    const output: UnknownRecord = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        !expected.has(key)
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        fail(
          "invalid-input",
          "알 수 없거나 안전하지 않은 필드입니다.",
          `${path}.${key}`,
        );
      }
      output[key] = descriptor.value;
    }
    for (const key of expectedKeys) {
      if (!Object.hasOwn(descriptors, key)) {
        fail("invalid-input", "필수 필드가 없습니다.", `${path}.${key}`);
      }
    }
    return output;
  } catch (error) {
    if (error instanceof StudioProceduralArtisticBrushProductError) {
      throw error;
    }
    fail("invalid-input", "입력을 안전하게 읽을 수 없습니다.", path);
  }
}

function finiteBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function integerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function snapshotSettings(
  candidate: unknown,
): StudioProceduralArtisticBrushSettings {
  const value = inspectExactRecord(candidate, SETTINGS_KEYS, "$.settings");
  if (
    typeof value.technique !== "string"
    || !TECHNIQUES.has(value.technique)
  ) {
    fail("invalid-input", "지원하지 않는 절차적 기법입니다.", "$.settings.technique");
  }
  if (
    typeof value.color !== "string"
    || !COLOR_PATTERN.test(value.color)
  ) {
    fail("invalid-input", "색상은 #RRGGBB 형식이어야 합니다.", "$.settings.color");
  }
  if (!finiteBetween(value.density, 1, 100)) {
    fail("invalid-input", "밀도는 1~100이어야 합니다.", "$.settings.density");
  }
  if (!finiteBetween(value.angle, -180, 180)) {
    fail("invalid-input", "각도는 -180°~180°여야 합니다.", "$.settings.angle");
  }
  if (!finiteBetween(value.weight, 0.1, 32)) {
    fail("invalid-input", "굵기는 0.1~32px여야 합니다.", "$.settings.weight");
  }
  if (!finiteBetween(value.strength, 0, 1)) {
    fail("invalid-input", "강도는 0~1이어야 합니다.", "$.settings.strength");
  }
  if (!integerBetween(value.seed, 0, 0xffff_ffff)) {
    fail("invalid-input", "시드는 uint32 정수여야 합니다.", "$.settings.seed");
  }
  return Object.freeze({
    technique: value.technique as StudioProceduralArtisticBrushSettings["technique"],
    color: value.color.toLowerCase(),
    density: value.density,
    angle: value.angle,
    weight: value.weight,
    strength: value.strength,
    seed: value.seed,
  });
}

function snapshotOptions(
  candidate: unknown,
): StudioProceduralArtisticBrushProductGenerateOptions {
  const value = inspectExactRecord(candidate, OPTION_KEYS, "$.options");
  if (
    !integerBetween(value.width, 1, Number.MAX_SAFE_INTEGER)
    || !integerBetween(value.height, 1, Number.MAX_SAFE_INTEGER)
  ) {
    fail(
      "invalid-input",
      "렌더 크기는 양의 안전한 정수여야 합니다.",
      "$.options.width",
    );
  }
  const pixelCount = value.width * value.height;
  if (
    value.width < STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.minDimension
    || value.height < STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.minDimension
    || value.width > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxDimension
    || value.height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxDimension
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxPixels
  ) {
    fail(
      "budget-exceeded",
      "브라우저 제품 경로는 32~1024px 범위에서만 생성할 수 있습니다.",
      "$.options.width",
    );
  }
  if (!integerBetween(value.requestSequence, 1, Number.MAX_SAFE_INTEGER)) {
    fail(
      "invalid-input",
      "요청 순번은 양의 안전한 정수여야 합니다.",
      "$.options.requestSequence",
    );
  }
  if (!integerBetween(value.engineEpoch, 1, Number.MAX_SAFE_INTEGER)) {
    fail(
      "invalid-input",
      "엔진 epoch는 양의 안전한 정수여야 합니다.",
      "$.options.engineEpoch",
    );
  }
  if (
    typeof AbortSignal === "undefined"
    || !(value.signal instanceof AbortSignal)
  ) {
    fail(
      "invalid-input",
      "취소 신호는 AbortSignal이어야 합니다.",
      "$.options.signal",
    );
  }
  return Object.freeze({
    width: value.width,
    height: value.height,
    requestSequence: value.requestSequence,
    engineEpoch: value.engineEpoch,
    signal: value.signal,
  });
}

function safeDetail(error: unknown, fallback: string): string {
  try {
    if (
      typeof error === "object"
      && error !== null
      && "message" in error
      && typeof error.message === "string"
      && error.message.trim().length > 0
    ) {
      return error.message.trim().slice(0, 320);
    }
  } catch {
    // The fallback is deliberately used for hostile error objects.
  }
  return fallback;
}

async function loadProductModules() {
  try {
    const [planner, workerClient, browserBridge] = await Promise.all([
      import("./studio-procedural-artistic-brush-plan"),
      import("./studio-procedural-artistic-brush-worker-client"),
      import("./studio-procedural-artistic-brush-browser"),
    ]);
    if (
      typeof planner.planStudioProceduralArtisticBrushRequest !== "function"
      || typeof workerClient.renderStudioProceduralArtisticBrushInWorker
        !== "function"
      || typeof workerClient.probeStudioProceduralArtisticBrushWorker
        !== "function"
      || typeof browserBridge.encodeStudioProceduralArtisticBrushPngDataUrl
        !== "function"
    ) {
      fail(
        "runtime-unavailable",
        "절차적 브러시 런타임 모듈이 완전하지 않습니다.",
      );
    }
    return Object.freeze({ planner, workerClient, browserBridge });
  } catch (error) {
    if (error instanceof StudioProceduralArtisticBrushProductError) {
      throw error;
    }
    fail(
      "runtime-unavailable",
      safeDetail(error, "절차적 브러시 런타임을 불러오지 못했습니다."),
    );
  }
}

function browserCapability(): StudioProceduralArtisticBrushProbeResult {
  const globals = globalThis as unknown as Record<string, unknown>;
  const cryptoCandidate = globals.crypto;
  if (
    typeof globals.ImageData !== "function"
    || typeof globals.Blob !== "function"
    || typeof globals.FileReader !== "function"
    || typeof globals.atob !== "function"
    || typeof globals.document !== "object"
    || globals.document === null
    || !("createElement" in globals.document)
    || typeof globals.document.createElement !== "function"
    || typeof cryptoCandidate !== "object"
    || cryptoCandidate === null
    || !("subtle" in cryptoCandidate)
    || typeof cryptoCandidate.subtle !== "object"
    || cryptoCandidate.subtle === null
    || !("digest" in cryptoCandidate.subtle)
    || typeof cryptoCandidate.subtle.digest !== "function"
  ) {
    return Object.freeze({
      available: false,
      message: "PNG 레이어 변환에 필요한 브라우저 기능이 없습니다.",
    });
  }
  try {
    const canvas = globals.document.createElement("canvas");
    if (
      typeof canvas !== "object"
      || canvas === null
      || !("getContext" in canvas)
      || typeof canvas.getContext !== "function"
      || !("toBlob" in canvas)
      || typeof canvas.toBlob !== "function"
    ) {
      throw new Error("canvas-contract-unavailable");
    }
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (
      typeof context !== "object"
      || context === null
      || !("putImageData" in context)
      || typeof context.putImageData !== "function"
    ) {
      throw new Error("canvas-2d-context-unavailable");
    }
    canvas.width = 1;
    canvas.height = 1;
  } catch {
    return Object.freeze({
      available: false,
      message: "PNG 레이어 변환용 Canvas 2D 기능을 사용할 수 없습니다.",
    });
  }
  return Object.freeze({
    available: true,
    message: "PNG 레이어 변환 경로를 사용할 수 있습니다.",
  });
}

export async function probeStudioProceduralArtisticBrushProduct(
  signal: AbortSignal,
): Promise<StudioProceduralArtisticBrushProbeResult> {
  if (
    typeof AbortSignal === "undefined"
    || !(signal instanceof AbortSignal)
  ) {
    return Object.freeze({
      available: false,
      message: "유효한 취소 신호가 필요합니다.",
    });
  }
  throwIfAborted(signal);
  const capability = browserCapability();
  if (!capability.available) return capability;
  const { workerClient } = await loadProductModules();
  throwIfAborted(signal);
  let workerProbe;
  try {
    workerProbe =
      await workerClient.probeStudioProceduralArtisticBrushWorker({
        signal,
      });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError();
    return Object.freeze({
      available: false,
      message:
        `전용 Worker를 확인하지 못했습니다. ${safeDetail(
          error,
          "알 수 없는 초기화 오류입니다.",
        )}`,
    });
  }
  throwIfAborted(signal);
  if (!workerProbe.available) {
    const detail = typeof workerProbe.detail === "string"
      ? workerProbe.detail.trim().slice(0, 240)
      : "지원되지 않는 Worker 실행 환경입니다.";
    return Object.freeze({
      available: false,
      message: `전용 Worker를 사용할 수 없습니다. ${detail}`,
    });
  }
  return Object.freeze({
    available: true,
    message:
      `전용 Worker · OffscreenCanvas · ${workerProbe.probe.webglVersion} · PNG 경로를 사용할 수 있습니다.`,
  });
}

export async function generateStudioProceduralArtisticBrushProduct(
  settingsCandidate: StudioProceduralArtisticBrushSettings,
  optionsCandidate: StudioProceduralArtisticBrushProductGenerateOptions,
): Promise<StudioProceduralArtisticBrushProductResult> {
  const settings = snapshotSettings(settingsCandidate);
  const options = snapshotOptions(optionsCandidate);
  throwIfAborted(options.signal);

  const { planner, workerClient, browserBridge } =
    await loadProductModules();
  throwIfAborted(options.signal);
  const planned = planner.planStudioProceduralArtisticBrushRequest({
    ...settings,
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    requestSequence: options.requestSequence,
    engineEpoch: options.engineEpoch,
    strokeId:
      `studio-procedural-${settings.technique}-${settings.seed}-${options.requestSequence}`,
  });
  if (!planned.ok) {
    fail(
      planned.code === "dimension-budget-exceeded"
        ? "budget-exceeded"
        : "invalid-input",
      planned.message,
      planned.path,
    );
  }
  throwIfAborted(options.signal);

  // Rebuild the exact clone-safe Worker request instead of spreading the
  // provider type: its optional `signal` must never cross postMessage.
  const workerRequest: StudioProceduralArtisticBrushWorkerRequest =
    Object.freeze({
      kind: planned.request.kind,
      version: planned.request.version,
      requestSequence: planned.request.requestSequence,
      engineEpoch: planned.request.engineEpoch,
      strokeId: planned.request.strokeId,
      stage: "settled",
      seed: planned.request.seed,
      width: planned.request.width,
      height: planned.request.height,
      pixelRatio: planned.request.pixelRatio,
      plan: Object.freeze({
        technique: planned.request.plan.technique,
        presetId: planned.request.plan.presetId,
        samples: planned.request.plan.samples,
        parameters: planned.request.plan.parameters,
      }),
    });
  let providerArtifact;
  try {
    providerArtifact =
      await workerClient.renderStudioProceduralArtisticBrushInWorker(
        workerRequest,
        { signal: options.signal },
      );
  } catch (error) {
    if (options.signal.aborted || isAbortError(error)) throw abortError();
    fail(
      "render-failed",
      safeDetail(error, "절차적 질감 Worker 렌더링에 실패했습니다."),
    );
  }
  throwIfAborted(options.signal);

  const pngResult =
    await browserBridge.encodeStudioProceduralArtisticBrushPngDataUrl(
      providerArtifact,
      {
        signal: options.signal,
        limits: {
          maxWidth:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxDimension,
          maxHeight:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxDimension,
          maxPixels:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxPixels,
          maxRgbaBytes:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxRgbaBytes,
          maxPngBlobBytes:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxPngBlobBytes,
          maxDataUrlCodeUnits:
            STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_LIMITS.maxDataUrlCodeUnits,
        },
      },
    );
  throwIfAborted(options.signal);
  if (pngResult.status !== "completed") {
    fail(
      pngResult.reason === "budget-exceeded"
        ? "budget-exceeded"
        : "png-failed",
      pngResult.detail,
    );
  }
  const png = pngResult.artifact;
  const receipt = providerArtifact.receipt;
  if (
    png.mediaType !== "image/png"
    || !png.dataUrl.startsWith("data:image/png;base64,")
    || png.width !== options.width
    || png.height !== options.height
    || png.source.requestSequence !== receipt.requestSequence
    || png.source.engineEpoch !== receipt.engineEpoch
    || png.source.strokeId !== receipt.strokeId
    || png.source.pixelHash !== receipt.pixelHash
    || png.source.replayFingerprint !== receipt.replayFingerprint
    || receipt.requestSequence !== options.requestSequence
    || receipt.engineEpoch !== options.engineEpoch
    || receipt.seed !== settings.seed
    || receipt.technique !== settings.technique
    || receipt.adapter.version
      !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PRODUCT_ADAPTER_VERSION
  ) {
    fail(
      "integrity-failed",
      "PNG 결과와 절차적 브러시 영수증이 일치하지 않습니다.",
    );
  }
  const name = planned.display.name;
  return Object.freeze({
    src: png.dataUrl,
    width: png.width,
    height: png.height,
    name,
    receipt,
    message: `${name} 결과를 새 래스터 레이어로 준비했습니다.`,
  });
}
