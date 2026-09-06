/**
 * Durable filter-mask publication — immutable raster first, tiny scene reference second.
 *
 * The first phase deliberately goes through the existing raster patch publisher. That publisher
 * uploads and verifies every content-addressed PNG receipt before it appends one grow-only raster
 * operation. This coordinator then crosses a real server acknowledgement barrier before it allows
 * the synchronous scene-reference mutation. If the second phase fails, the acknowledged raster is
 * an unreferenced but valid orphan; a scene element can never point at an unacknowledged surface.
 */

import {
  publishStudioRasterPatch,
  type StudioRasterLayerWriteGuardInput,
  type StudioRasterPatchCompensationInput,
  type StudioRasterPatchEncoder,
  type StudioRasterPatchPublishResult,
  type StudioRasterPatchUploadInput,
  type StudioRasterRgbaPixels,
} from "../live/studio-crdt-raster-patch-publisher";

import {
  canonicalStudioRasterJson,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";
import {
  STUDIO_FILTER_MASK_SURFACE_MAX_EDGE,
  STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
  createStudioFilterMaskSurfaceId,
  createStudioFilterMaskSurfaceSpec,
  isStudioFilterMaskSurfaceSpec,
  type StudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OBJECT_STABLE_ID_PATTERN = /^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_OBJECT_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const MAX_ID_LENGTH = 160;
const MAX_SOURCE_IDENTITY_LENGTH = 512;

export const STUDIO_FILTER_MASK_SURFACE_SEMANTIC_PROFILE =
  "rgba8-white-alpha-mask-topdown-v1" as const;

export type StudioFilterMaskSurfacePublicationGuardPhase =
  | "preflight"
  | "raster-publish"
  | "before-raster-ack"
  | "after-raster-ack";

export type StudioFilterMaskSurfacePublicationAckPhase =
  | "raster"
  | "scene-reference";

export interface StudioFilterMaskSurfacePublicationInput {
  readonly workId: string;
  readonly actorId: string;
  readonly pageId: string;
  readonly layerId: string;
  readonly targetElementId: string;
  /**
   * Stable, bounded identity of the source image bytes/version. This must be a hash or canonical
   * asset identity, never a data/blob URL.
   */
  readonly sourceIdentity: string;
  readonly selectedObjectStableId: string;
  readonly generation: number;
  readonly width: number;
  readonly height: number;
  /** Full-frame straight/unpremultiplied RGBA in top-down row-major order. */
  readonly pixels: StudioRasterRgbaPixels;
  readonly signal?: AbortSignal;
}

export interface StudioFilterMaskSurfacePublicationScope {
  readonly workId: string;
  readonly actorId: string;
  readonly pageId: string;
  readonly layerId: string;
  readonly targetElementId: string;
  readonly sourceIdentity: string;
  readonly selectedObjectStableId: string;
  readonly generation: number;
  readonly surfaceId: StudioFilterMaskSurfaceId;
  readonly operationId: string;
  readonly width: number;
  readonly height: number;
}

export interface StudioFilterMaskSurfacePublicationGuardInput
  extends StudioFilterMaskSurfacePublicationScope {
  readonly phase: StudioFilterMaskSurfacePublicationGuardPhase;
}

export interface StudioFilterMaskSurfacePublicationAckInput
  extends StudioFilterMaskSurfacePublicationScope {
  readonly phase: StudioFilterMaskSurfacePublicationAckPhase;
  readonly signal: AbortSignal;
}

export interface StudioFilterMaskSurfaceSceneAttachInput
  extends StudioFilterMaskSurfacePublicationScope {
  readonly filterMaskSurfaceId: StudioFilterMaskSurfaceId;
  readonly filterMaskEnabled: true;
}

export type StudioFilterMaskSurfaceSemanticHasher = (
  canonicalParameters: string,
  signal: AbortSignal
) => Promise<string>;

export interface StudioFilterMaskSurfacePublicationDependencies {
  readonly encode: StudioRasterPatchEncoder;
  readonly upload: (
    workId: string,
    input: StudioRasterPatchUploadInput
  ) => Promise<StudioRasterAssetReference>;
  readonly append: (
    log: StudioRasterOperationLog,
    signal: AbortSignal
  ) => void | Promise<void>;
  readonly compensate?: (
    workId: string,
    input: StudioRasterPatchCompensationInput
  ) => Promise<boolean>;
  /**
   * This remains mandatory even though the raster publisher also checks the scope predicate. It
   * closes both target-generation and authoritative layer-lock races immediately before append.
   */
  readonly canWriteLayer: (
    input: Readonly<StudioRasterLayerWriteGuardInput>,
    signal: AbortSignal
  ) => boolean | Promise<boolean>;
  readonly isCurrent: (
    input: Readonly<StudioFilterMaskSurfacePublicationGuardInput>,
    signal: AbortSignal
  ) => boolean | Promise<boolean>;
  readonly nextLogicalClock: (
    input: Readonly<StudioFilterMaskSurfacePublicationScope>
  ) => string;
  readonly sha256SemanticParameters: StudioFilterMaskSurfaceSemanticHasher;
  readonly waitForAuthoritativeAck: (
    input: Readonly<StudioFilterMaskSurfacePublicationAckInput>
  ) => Promise<unknown>;
  /**
   * Must perform one synchronous CRDT scene patch. Keeping this callback synchronous leaves no
   * await gap between the final stale check and the mutation.
   */
  readonly attachSceneReference: (
    input: Readonly<StudioFilterMaskSurfaceSceneAttachInput>
  ) => void;
  readonly createSurfaceId?: () => StudioFilterMaskSurfaceId;
  readonly createOperationId?: () => string;
}

export interface StudioFilterMaskSurfacePublicationSkippedResult {
  readonly status: "skipped-transparent";
  readonly surface: StudioRasterSurfaceSpec;
  readonly surfaceId: StudioFilterMaskSurfaceId;
  readonly operationId: string;
}

export interface StudioFilterMaskSurfacePublicationAttachedResult {
  readonly status: "attached";
  readonly surface: StudioRasterSurfaceSpec;
  readonly surfaceId: StudioFilterMaskSurfaceId;
  readonly operation: StudioRasterOperation;
  readonly assets: readonly StudioRasterAssetReference[];
  readonly rasterAcknowledgement: unknown;
  readonly sceneReferenceAcknowledgement: unknown;
}

export type StudioFilterMaskSurfacePublicationResult =
  | StudioFilterMaskSurfacePublicationSkippedResult
  | StudioFilterMaskSurfacePublicationAttachedResult;

export type StudioFilterMaskSurfacePublicationErrorCode =
  | "invalid-input"
  | "invalid-dependencies"
  | "stale-scope"
  | "raster-publication-failed"
  | "raster-ack-failed"
  | "scene-reference-attach-failed"
  | "scene-reference-ack-failed";

export class StudioFilterMaskSurfacePublicationError extends Error {
  constructor(
    readonly code: StudioFilterMaskSurfacePublicationErrorCode,
    message: string,
    readonly details: {
      readonly surfaceId: StudioFilterMaskSurfaceId | null;
      readonly rasterAcknowledged: boolean;
      readonly sceneReferenceAttached: boolean;
      readonly sceneReferenceMayBePending: boolean;
    },
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioFilterMaskSurfacePublicationError";
  }
}

function fail(
  code: StudioFilterMaskSurfacePublicationErrorCode,
  message: string,
  details: StudioFilterMaskSurfacePublicationError["details"],
  cause?: unknown
): never {
  throw new StudioFilterMaskSurfacePublicationError(code, message, details, cause);
}

function noPublicationDetails(): StudioFilterMaskSurfacePublicationError["details"] {
  return {
    surfaceId: null,
    rasterAcknowledged: false,
    sceneReferenceAttached: false,
    sceneReferenceMayBePending: false,
  };
}

function publicationDetails(
  surfaceId: StudioFilterMaskSurfaceId,
  options: {
    readonly rasterAcknowledged?: boolean;
    readonly sceneReferenceAttached?: boolean;
    readonly sceneReferenceMayBePending?: boolean;
  } = {}
): StudioFilterMaskSurfacePublicationError["details"] {
  return {
    surfaceId,
    rasterAcknowledged: options.rasterAcknowledged === true,
    sceneReferenceAttached: options.sceneReferenceAttached === true,
    sceneReferenceMayBePending: options.sceneReferenceMayBePending === true,
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("필터 마스크 게시가 취소되었습니다.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function exactText(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value) &&
    value.trim() === value;
}

function safeId(value: unknown): value is string {
  return exactText(value, MAX_ID_LENGTH) && SAFE_ID_PATTERN.test(value);
}

function isFixedRgbaPixels(
  pixels: StudioRasterRgbaPixels,
  width: number,
  height: number,
  expectedByteLength: number
): boolean {
  if (
    pixels instanceof Uint8Array ||
    pixels instanceof Uint8ClampedArray
  ) {
    return pixels.byteLength === expectedByteLength;
  }
  return typeof pixels === "object" &&
    pixels !== null &&
    pixels.width === width &&
    pixels.height === height &&
    pixels.data instanceof Uint8ClampedArray &&
    pixels.data.byteLength === expectedByteLength;
}

function assertInput(input: StudioFilterMaskSurfacePublicationInput): void {
  if (!input || typeof input !== "object") {
    fail("invalid-input", "필터 마스크 게시 입력이 필요합니다.", noPublicationDetails());
  }
  if (
    !safeId(input.workId) ||
    !safeId(input.actorId) ||
    !safeId(input.pageId) ||
    !safeId(input.layerId) ||
    !safeId(input.targetElementId)
  ) {
    fail("invalid-input", "필터 마스크 게시 범위 식별자가 올바르지 않습니다.", noPublicationDetails());
  }
  if (
    input.width > STUDIO_FILTER_MASK_SURFACE_MAX_EDGE ||
    input.height > STUDIO_FILTER_MASK_SURFACE_MAX_EDGE
  ) {
    fail(
      "invalid-input",
      `필터 마스크의 한 축은 ${STUDIO_FILTER_MASK_SURFACE_MAX_EDGE}px 이하여야 합니다.`,
      noPublicationDetails()
    );
  }
  if (
    !exactText(input.sourceIdentity, MAX_SOURCE_IDENTITY_LENGTH) ||
    input.sourceIdentity.startsWith("data:") ||
    input.sourceIdentity.startsWith("blob:")
  ) {
    fail(
      "invalid-input",
      "필터 마스크 원본은 인라인 URL이 아닌 안정적인 자산 신원이어야 합니다.",
      noPublicationDetails()
    );
  }
  const selectedNodeId = input.selectedObjectStableId.slice("obj/".length).toLowerCase();
  if (
    !OBJECT_STABLE_ID_PATTERN.test(input.selectedObjectStableId) ||
    FORBIDDEN_OBJECT_ID_SET.has(selectedNodeId)
  ) {
    fail("invalid-input", "선택한 3D 객체 식별자가 올바르지 않습니다.", noPublicationDetails());
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) {
    fail("invalid-input", "필터 마스크 게시 generation이 올바르지 않습니다.", noPublicationDetails());
  }
  let surface: StudioRasterSurfaceSpec;
  try {
    surface = createStudioFilterMaskSurfaceSpec({
      surfaceId: createStudioFilterMaskSurfaceId(
        "00000000-0000-4000-8000-000000000000"
      ),
      width: input.width,
      height: input.height,
    });
  } catch (cause) {
    fail(
      "invalid-input",
      "필터 마스크 크기가 허용 범위를 벗어났습니다.",
      noPublicationDetails(),
      cause
    );
  }
  if (!isStudioFilterMaskSurfaceSpec(surface)) {
    fail("invalid-input", "필터 마스크 표면 계약이 올바르지 않습니다.", noPublicationDetails());
  }
  const expectedByteLength = input.width * input.height * 4;
  if (
    !Number.isSafeInteger(expectedByteLength) ||
    !isFixedRgbaPixels(input.pixels, input.width, input.height, expectedByteLength)
  ) {
    fail(
      "invalid-input",
      "필터 마스크 RGBA 길이가 표면 크기와 일치하지 않습니다.",
      noPublicationDetails()
    );
  }
}

function defaultOperationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== "function") {
    fail(
      "invalid-dependencies",
      "필터 마스크 작업 식별자를 만들 보안 난수 생성기가 없습니다.",
      noPublicationDetails()
    );
  }
  return randomUuid.call(globalThis.crypto);
}

function createScope(
  input: StudioFilterMaskSurfacePublicationInput,
  dependencies: StudioFilterMaskSurfacePublicationDependencies
): {
  readonly scope: StudioFilterMaskSurfacePublicationScope;
  readonly surface: StudioRasterSurfaceSpec;
} {
  let surfaceId: StudioFilterMaskSurfaceId;
  let operationId: string;
  let surface: StudioRasterSurfaceSpec;
  try {
    surfaceId = (dependencies.createSurfaceId ?? createStudioFilterMaskSurfaceId)();
    operationId = (dependencies.createOperationId ?? defaultOperationId)();
    surface = createStudioFilterMaskSurfaceSpec({
      surfaceId,
      width: input.width,
      height: input.height,
    });
  } catch (cause) {
    if (cause instanceof StudioFilterMaskSurfacePublicationError) throw cause;
    fail(
      "invalid-dependencies",
      "필터 마스크 표면 또는 작업 식별자를 만들지 못했습니다.",
      noPublicationDetails(),
      cause
    );
  }
  if (!isStudioFilterMaskSurfaceSpec(surface) || !UUID_PATTERN.test(operationId)) {
    fail(
      "invalid-dependencies",
      "주입된 필터 마스크 표면 또는 작업 식별자가 올바르지 않습니다.",
      publicationDetails(surfaceId)
    );
  }
  return {
    surface,
    scope: Object.freeze({
      workId: input.workId,
      actorId: input.actorId,
      pageId: input.pageId,
      layerId: input.layerId,
      targetElementId: input.targetElementId,
      sourceIdentity: input.sourceIdentity,
      selectedObjectStableId: input.selectedObjectStableId,
      generation: input.generation,
      surfaceId,
      operationId,
      width: input.width,
      height: input.height,
    }),
  };
}

function assertDependencies(
  dependencies: StudioFilterMaskSurfacePublicationDependencies
): void {
  if (
    !dependencies ||
    typeof dependencies !== "object" ||
    typeof dependencies.encode !== "function" ||
    typeof dependencies.upload !== "function" ||
    typeof dependencies.append !== "function" ||
    (dependencies.compensate !== undefined && typeof dependencies.compensate !== "function") ||
    typeof dependencies.canWriteLayer !== "function" ||
    typeof dependencies.isCurrent !== "function" ||
    typeof dependencies.nextLogicalClock !== "function" ||
    typeof dependencies.sha256SemanticParameters !== "function" ||
    typeof dependencies.waitForAuthoritativeAck !== "function" ||
    typeof dependencies.attachSceneReference !== "function" ||
    (dependencies.createSurfaceId !== undefined && typeof dependencies.createSurfaceId !== "function") ||
    (dependencies.createOperationId !== undefined && typeof dependencies.createOperationId !== "function")
  ) {
    fail(
      "invalid-dependencies",
      "필터 마스크 게시 의존성이 올바르지 않습니다.",
      noPublicationDetails()
    );
  }
}

async function assertCurrent(
  scope: StudioFilterMaskSurfacePublicationScope,
  phase: StudioFilterMaskSurfacePublicationGuardPhase,
  signal: AbortSignal,
  dependencies: StudioFilterMaskSurfacePublicationDependencies,
  rasterAcknowledged: boolean
): Promise<void> {
  throwIfAborted(signal);
  let current: boolean;
  try {
    current = await dependencies.isCurrent(Object.freeze({ ...scope, phase }), signal);
  } catch (cause) {
    if (signal.aborted) throw abortError(signal);
    fail(
      "stale-scope",
      "필터 마스크 게시 범위가 변경되어 안전하게 중단했습니다.",
      publicationDetails(scope.surfaceId, { rasterAcknowledged }),
      cause
    );
  }
  throwIfAborted(signal);
  if (current !== true) {
    fail(
      "stale-scope",
      "필터 마스크 게시 대상 또는 권한 generation이 변경되었습니다.",
      publicationDetails(scope.surfaceId, { rasterAcknowledged })
    );
  }
}

function semanticParameters(
  scope: StudioFilterMaskSurfacePublicationScope
): string {
  return canonicalStudioRasterJson({
    version: 1,
    profile: STUDIO_FILTER_MASK_SURFACE_SEMANTIC_PROFILE,
    purpose: "filter-mask-surface",
    surfaceId: scope.surfaceId,
    targetElementId: scope.targetElementId,
    sourceIdentity: scope.sourceIdentity,
    selectedObjectStableId: scope.selectedObjectStableId,
    generation: scope.generation,
    width: scope.width,
    height: scope.height,
    tileSize: STUDIO_FILTER_MASK_SURFACE_TILE_SIZE,
  });
}

function resultWasAppended(
  result: StudioRasterPatchPublishResult
): result is Extract<StudioRasterPatchPublishResult, { status: "appended" }> {
  return result.status === "appended";
}

/**
 * Publishes one immutable filter-mask surface and attaches it only after server authority.
 *
 * A successful return includes acknowledgements for both phases. Any failure before the first ACK
 * leaves no scene reference. Any failure after it leaves at worst a durable unreferenced surface;
 * the coordinator intentionally performs no grow-only raster rollback.
 */
export async function publishStudioFilterMaskSurface(
  input: StudioFilterMaskSurfacePublicationInput,
  dependencies: StudioFilterMaskSurfacePublicationDependencies
): Promise<StudioFilterMaskSurfacePublicationResult> {
  assertInput(input);
  assertDependencies(dependencies);
  const controller = new AbortController();
  const signal = controller.signal;
  const externalSignal = input.signal;
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    throwIfAborted(signal);
    const { scope, surface } = createScope(input, dependencies);
    await assertCurrent(scope, "preflight", signal, dependencies, false);

    let semanticParametersSha256: string;
    try {
      semanticParametersSha256 = await dependencies.sha256SemanticParameters(
        semanticParameters(scope),
        signal
      );
    } catch (cause) {
      if (signal.aborted) throw abortError(signal);
      fail(
        "raster-publication-failed",
        "필터 마스크 의미 해시를 계산하지 못했습니다.",
        publicationDetails(scope.surfaceId),
        cause
      );
    }
    if (!SHA256_PATTERN.test(semanticParametersSha256)) {
      fail(
        "raster-publication-failed",
        "필터 마스크 의미 해시가 올바르지 않습니다.",
        publicationDetails(scope.surfaceId)
      );
    }

    let logicalClock: string;
    try {
      logicalClock = dependencies.nextLogicalClock(scope);
    } catch (cause) {
      fail(
        "raster-publication-failed",
        "필터 마스크 논리 시계를 만들지 못했습니다.",
        publicationDetails(scope.surfaceId),
        cause
      );
    }

    let rasterResult: StudioRasterPatchPublishResult;
    try {
      rasterResult = await publishStudioRasterPatch({
        surface,
        operationId: scope.operationId,
        actorId: scope.actorId,
        logicalClock,
        pageId: scope.pageId,
        layerId: scope.layerId,
        intent: "paint",
        semanticParametersSha256,
        rect: {
          x: 0,
          y: 0,
          width: scope.width,
          height: scope.height,
        },
        pixels: input.pixels,
      }, {
        encode: dependencies.encode,
        upload: (uploadInput) => dependencies.upload(scope.workId, uploadInput),
        append: dependencies.append,
        compensate: dependencies.compensate
          ? (compensationInput) =>
              dependencies.compensate!(scope.workId, compensationInput)
          : undefined,
        canWriteLayer: async (guardInput, guardSignal) => {
          const current = await dependencies.isCurrent(
            Object.freeze({ ...scope, phase: "raster-publish" }),
            guardSignal
          );
          if (current !== true) return false;
          return dependencies.canWriteLayer(guardInput, guardSignal);
        },
      }, { signal });
    } catch (cause) {
      if (cause instanceof StudioFilterMaskSurfacePublicationError) throw cause;
      if (signal.aborted) throw abortError(signal);
      fail(
        "raster-publication-failed",
        "필터 마스크 래스터를 게시하지 못했습니다.",
        publicationDetails(scope.surfaceId),
        cause
      );
    }

    if (!resultWasAppended(rasterResult)) {
      return Object.freeze({
        status: "skipped-transparent",
        surface,
        surfaceId: scope.surfaceId,
        operationId: scope.operationId,
      });
    }

    await assertCurrent(scope, "before-raster-ack", signal, dependencies, false);
    let rasterAcknowledgement: unknown;
    try {
      rasterAcknowledgement = await dependencies.waitForAuthoritativeAck(
        Object.freeze({ ...scope, phase: "raster", signal })
      );
    } catch (cause) {
      if (signal.aborted) throw abortError(signal);
      fail(
        "raster-ack-failed",
        "필터 마스크 래스터의 서버 승인을 확인하지 못했습니다.",
        publicationDetails(scope.surfaceId),
        cause
      );
    }

    await assertCurrent(scope, "after-raster-ack", signal, dependencies, true);
    const attachInput = Object.freeze({
      ...scope,
      filterMaskSurfaceId: scope.surfaceId,
      filterMaskEnabled: true as const,
    });
    try {
      dependencies.attachSceneReference(attachInput);
    } catch (cause) {
      fail(
        "scene-reference-attach-failed",
        "승인된 필터 마스크를 장면 요소에 연결하지 못했습니다.",
        publicationDetails(scope.surfaceId, { rasterAcknowledged: true }),
        cause
      );
    }

    let sceneReferenceAcknowledgement: unknown;
    try {
      sceneReferenceAcknowledgement = await dependencies.waitForAuthoritativeAck(
        Object.freeze({ ...scope, phase: "scene-reference", signal })
      );
    } catch (cause) {
      fail(
        "scene-reference-ack-failed",
        "필터 마스크 장면 참조의 서버 승인을 확인하지 못했습니다.",
        publicationDetails(scope.surfaceId, {
          rasterAcknowledged: true,
          sceneReferenceAttached: true,
          sceneReferenceMayBePending: true,
        }),
        cause
      );
    }

    return Object.freeze({
      status: "attached",
      surface,
      surfaceId: scope.surfaceId,
      operation: rasterResult.operation,
      assets: rasterResult.assets,
      rasterAcknowledgement,
      sceneReferenceAcknowledgement,
    });
  } finally {
    externalSignal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
