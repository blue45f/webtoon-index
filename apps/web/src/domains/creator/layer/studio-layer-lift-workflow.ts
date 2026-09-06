/**
 * Fail-closed orchestration for the first user-visible "컷 레이어 복원" beta.
 *
 * This module never mutates Studio state. It owns the async authority chain from
 * an exact element-local source snapshot through a trusted local provider and a
 * trusted compositor result. The separate finalization boundary consumes the
 * registry ticket, converts only re-verified PNG artifacts, and returns an
 * atomic document plan for the caller to commit once.
 */

import {
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES,
  isStudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import {
  isStudioLayerLiftTrustedWorkerComposition,
} from "./studio-layer-lift-compose-worker-client";
import {
  isTrustedStudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import {
  isStudioLayerLiftTrustedComposition,
  type StudioLayerLiftCompositorInput,
  type StudioLayerLiftTrustedComposition,
} from "./studio-layer-lift-compositor";
import {
  STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
  STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
  parseStudioSceneLayerLiftRequest,
  parseStudioSceneLayerLiftResult,
  type StudioSceneLayerLiftRequest,
  type StudioSceneLayerLiftSuccess,
} from "./studio-layer-lift-contract";
import {
  doesStudioLayerLiftArtifactReceiptMatchOperation,
  doesStudioLayerLiftCompositionReceiptMatchOperation,
  doesStudioSceneLayerLiftResultMatchOperation,
  type StudioLayerLiftFinalAdmissionBinding,
  type StudioLayerLiftOperationCurrentState,
  type StudioLayerLiftOperationStaleReason,
  type StudioLayerLiftOperationTicket,
  StudioLayerLiftOperationRegistry,
} from "./studio-layer-lift-operation-context";
import {
  STUDIO_LAYER_LIFT_OUTPUT_BASIS,
  STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
  planStudioLayerLift,
  type PlanStudioLayerLiftInput,
  type StudioLayerLiftPlanFailure,
  type StudioLayerLiftPlanSuccess,
} from "./studio-layer-lift-plan";
import {
  createStudioLayerLiftSourceSnapshot,
  type CreateStudioLayerLiftSourceSnapshotInput,
  type StudioLayerLiftSourceSnapshotResult,
  type StudioLayerLiftSourceSnapshotRuntime,
  type StudioLayerLiftSourceSnapshotSuccess,
} from "./studio-layer-lift-source-snapshot";

import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { StudioLayerLiftAvailabilityInput } from "./studio-layer-lift-availability";
import type {
  StudioLayerLiftLocalForegroundAnalyzeOptions,
} from "./studio-layer-lift-local-provider";

type TrustedWorkflowComposition =
  | StudioLayerLiftTrustedComposition
  | import("./studio-layer-lift-compose-worker-client")
      .StudioLayerLiftTrustedWorkerComposition;

export interface StudioLayerLiftWorkflowProvider {
  analyze(
    request: unknown,
    options?: StudioLayerLiftLocalForegroundAnalyzeOptions,
  ): Promise<unknown>;
}

/**
 * Both the Worker client and a thin wrapper around the direct compositor fit
 * this seam. Production should prefer the Worker client.
 */
export interface StudioLayerLiftWorkflowCompositor {
  run(
    input: StudioLayerLiftCompositorInput,
    options?: Readonly<{
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
    }>,
  ): Promise<unknown>;
}

export interface AnalyzeStudioLayerLiftWorkflowInput {
  readonly registry: StudioLayerLiftOperationRegistry;
  readonly mutationTicket: StudioEditorMutationTicket;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly availability: StudioLayerLiftAvailabilityInput;
  readonly readAvailability?: () => StudioLayerLiftAvailabilityInput;
  readonly readCurrent: () => StudioLayerLiftOperationCurrentState;
  readonly requestId: string;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
  readonly provider: StudioLayerLiftWorkflowProvider;
  readonly compositor: StudioLayerLiftWorkflowCompositor;
  readonly providerOptions?: Omit<
    StudioLayerLiftLocalForegroundAnalyzeOptions,
    "signal"
  >;
  readonly compositorTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly snapshotRuntime?: Partial<StudioLayerLiftSourceSnapshotRuntime>;
  /** Test seam; product code should use the default browser snapshot adapter. */
  readonly createSnapshot?: (
    input: CreateStudioLayerLiftSourceSnapshotInput,
  ) => Promise<StudioLayerLiftSourceSnapshotResult>;
}

export type StudioLayerLiftWorkflowFailureCode =
  | "aborted"
  | "compositor-failed"
  | "compositor-rejected"
  | "operation-rejected"
  | "provider-failed"
  | "provider-rejected"
  | "request-rejected"
  | "saved-work-unsupported"
  | "snapshot-failed"
  | "stale"
  | "timeout";

export type StudioLayerLiftWorkflowPhase =
  | "availability"
  | "snapshot"
  | "request"
  | "operation"
  | "provider"
  | "compositor";

export interface StudioLayerLiftWorkflowFailure {
  readonly ok: false;
  readonly phase: StudioLayerLiftWorkflowPhase;
  readonly code: StudioLayerLiftWorkflowFailureCode;
  readonly message: string;
  readonly detail: string;
  readonly staleReason?: StudioLayerLiftOperationStaleReason;
}

export interface StudioLayerLiftWorkflowPreview {
  readonly width: number;
  readonly height: number;
  /** UI-owned copies; correction/preview rendering cannot corrupt final authority. */
  readonly sourceRgba: Uint8ClampedArray<ArrayBuffer>;
  readonly backgroundRgba: Uint8ClampedArray<ArrayBuffer>;
  readonly foregroundRgba: Uint8ClampedArray<ArrayBuffer>;
  readonly maskAlpha: Uint8Array<ArrayBuffer>;
  readonly confidenceScore: number;
  readonly confidenceBand: StudioSceneLayerLiftSuccess["confidence"]["band"];
  readonly backgroundRepair: Readonly<{
    readonly mode: "bounded-tile-fill-beta";
    readonly selectedPixelCount: number;
    readonly partialPixelCount: number;
    readonly transparentSelectedPixelCount: number;
  }>;
  readonly diagnostics: StudioSceneLayerLiftSuccess["diagnostics"];
}

export interface StudioLayerLiftWorkflowSession {
  readonly ticket: StudioLayerLiftOperationTicket;
  readonly request: StudioSceneLayerLiftRequest;
  readonly providerResult: StudioSceneLayerLiftSuccess;
  readonly artifacts: TrustedWorkflowComposition["artifacts"];
  readonly compositionReceipt: TrustedWorkflowComposition["compositionReceipt"];
  readonly sourceSnapshot: StudioLayerLiftSourceSnapshotSuccess;
  readonly preview: StudioLayerLiftWorkflowPreview;
}

export interface StudioLayerLiftWorkflowSuccess {
  readonly ok: true;
  readonly session: StudioLayerLiftWorkflowSession;
}

export type StudioLayerLiftWorkflowResult =
  | StudioLayerLiftWorkflowSuccess
  | StudioLayerLiftWorkflowFailure;

function workflowFailure(
  phase: StudioLayerLiftWorkflowPhase,
  code: StudioLayerLiftWorkflowFailureCode,
  message: string,
  detail: string,
  staleReason?: StudioLayerLiftOperationStaleReason,
): StudioLayerLiftWorkflowFailure {
  return Object.freeze({
    ok: false,
    phase,
    code,
    message,
    detail,
    ...(staleReason === undefined ? {} : { staleReason }),
  });
}

function staleMessage(reason: StudioLayerLiftOperationStaleReason): string {
  switch (reason) {
    case "aborted":
      return "레이어 분리 작업이 취소되었습니다.";
    case "foreign-ticket":
      return "더 최근의 레이어 분리 작업이 시작되어 이전 결과를 버렸습니다.";
    case "stale-document":
      return "분리 중 원고 또는 편집 권한이 바뀌었습니다. 다시 실행해 주세요.";
    case "stale-page":
      return "분리 중 현재 페이지가 바뀌었습니다. 원본 페이지에서 다시 실행해 주세요.";
    case "stale-edit-surface":
      return "분리 중 편집 표면이 바뀌었습니다. 다시 실행해 주세요.";
    case "stale-selection":
      return "분리 중 선택 레이어가 바뀌었습니다. 이미지를 다시 선택해 주세요.";
    case "stale-source":
      return "분리 중 원본 이미지가 바뀌었습니다. 최신 이미지에서 다시 실행해 주세요.";
  }
}

function checkCurrent(
  registry: StudioLayerLiftOperationRegistry,
  ticket: StudioLayerLiftOperationTicket,
  readCurrent: () => StudioLayerLiftOperationCurrentState,
): StudioLayerLiftWorkflowFailure | null {
  let current: StudioLayerLiftOperationCurrentState;
  try {
    current = readCurrent();
  } catch {
    return workflowFailure(
      "operation",
      "stale",
      "현재 원고 상태를 다시 확인하지 못했습니다.",
      "stale-document",
      "stale-document",
    );
  }
  const checked = registry.checkCurrent(ticket, current);
  if (checked.ok) return null;
  return workflowFailure(
    "operation",
    checked.reason === "aborted" ? "aborted" : "stale",
    staleMessage(checked.reason),
    checked.reason,
    checked.reason,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError")
    || (
      typeof error === "object"
      && error !== null
      && (
        (error as { readonly name?: unknown }).name === "AbortError"
        || (error as { readonly code?: unknown }).code === "aborted"
      )
    )
  );
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    readonly name?: unknown;
    readonly code?: unknown;
  };
  return (
    candidate.name === "TimeoutError"
    || candidate.code === "timeout"
    || candidate.code === "worker-timeout"
  );
}

function errorDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const candidate = error as {
    readonly code?: unknown;
    readonly detail?: unknown;
    readonly name?: unknown;
  };
  if (typeof candidate.detail === "string") return candidate.detail;
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.name === "string") return candidate.name;
  return "unknown";
}

function failFromAsyncError(
  phase: "provider" | "compositor",
  error: unknown,
  signal: AbortSignal,
): StudioLayerLiftWorkflowFailure {
  if (signal.aborted || isAbortError(error)) {
    return workflowFailure(
      phase,
      "aborted",
      phase === "provider"
        ? "인물·캐릭터 분석을 취소했습니다."
        : "배경·전경 합성을 취소했습니다.",
      errorDetail(error),
      "aborted",
    );
  }
  if (isTimeoutError(error)) {
    return workflowFailure(
      phase,
      "timeout",
      phase === "provider"
        ? "로컬 인물·캐릭터 분석 시간이 초과되었습니다."
        : "배경·전경 합성 시간이 초과되었습니다.",
      errorDetail(error),
    );
  }
  return workflowFailure(
    phase,
    phase === "provider" ? "provider-failed" : "compositor-failed",
    phase === "provider"
      ? "로컬 인물·캐릭터 분석을 완료하지 못했습니다."
      : "배경·전경 결과를 만들지 못했습니다.",
    errorDetail(error),
  );
}

function combineSignals(
  primary: AbortSignal,
  secondary: AbortSignal | undefined,
): Readonly<{
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}> {
  if (!secondary) {
    return Object.freeze({ signal: primary, dispose: () => undefined });
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  secondary.addEventListener("abort", abort, { once: true });
  if (primary.aborted || secondary.aborted) controller.abort();
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      primary.removeEventListener("abort", abort);
      secondary.removeEventListener("abort", abort);
    },
  });
}

function trustedComposition(
  value: unknown,
): value is TrustedWorkflowComposition {
  return (
    isStudioLayerLiftTrustedComposition(value)
    || isStudioLayerLiftTrustedWorkerComposition(value)
  );
}

function providerMatchesComposition(
  ticket: StudioLayerLiftOperationTicket,
  providerResult: StudioSceneLayerLiftSuccess,
  composition: TrustedWorkflowComposition,
): boolean {
  return (
    composition.requestId === ticket.source.requestId
    && composition.sourceId === ticket.source.sourceId
    && composition.width === ticket.source.width
    && composition.height === ticket.source.height
    && isStudioLayerLiftTrustedArtifactPair(composition.artifacts)
    && isTrustedStudioLayerLiftCompositionReceipt(
      composition.compositionReceipt,
    )
    && doesStudioLayerLiftArtifactReceiptMatchOperation(
      ticket,
      composition.artifacts.receipt,
    )
    && doesStudioLayerLiftCompositionReceiptMatchOperation({
      ticket,
      providerResult,
      artifacts: composition.artifacts,
      compositionReceipt: composition.compositionReceipt,
    })
  );
}

function createPreview(
  snapshot: StudioLayerLiftSourceSnapshotSuccess,
  providerResult: StudioSceneLayerLiftSuccess,
  composition: TrustedWorkflowComposition,
): StudioLayerLiftWorkflowPreview {
  return Object.freeze({
    width: composition.width,
    height: composition.height,
    sourceRgba: new Uint8ClampedArray(snapshot.source.bytes),
    backgroundRgba: new Uint8ClampedArray(composition.backgroundRgba.bytes),
    foregroundRgba: new Uint8ClampedArray(composition.foregroundRgba.bytes),
    maskAlpha: new Uint8Array(composition.removalMask.bytes),
    confidenceScore: providerResult.confidence.score,
    confidenceBand: providerResult.confidence.band,
    backgroundRepair: Object.freeze({
      mode: "bounded-tile-fill-beta",
      selectedPixelCount: composition.diagnostics.selectedPixelCount,
      partialPixelCount: composition.diagnostics.partialPixelCount,
      transparentSelectedPixelCount:
        composition.diagnostics.transparentSelectedPixelCount,
    }),
    diagnostics: Object.freeze([...providerResult.diagnostics]),
  });
}

/**
 * Analyzes one currently selected image. Every dependency is read-only with
 * respect to Studio state; failures invalidate only this operation ticket.
 */
export async function analyzeStudioLayerLiftWorkflow(
  input: AnalyzeStudioLayerLiftWorkflowInput,
): Promise<StudioLayerLiftWorkflowResult> {
  if (input.mutationTicket.workId !== null) {
    return workflowFailure(
      "availability",
      "saved-work-unsupported",
      "첫 베타는 저장 전 로컬 원고에서만 사용할 수 있습니다.",
      "saved-work requires durable batch asset admission and CRDT ops",
    );
  }
  if (input.signal?.aborted) {
    return workflowFailure(
      "snapshot",
      "aborted",
      "레이어 분리 작업을 시작하지 않았습니다.",
      "pre-aborted",
      "aborted",
    );
  }

  const createSnapshot =
    input.createSnapshot ?? createStudioLayerLiftSourceSnapshot;
  let snapshot: StudioLayerLiftSourceSnapshotResult;
  try {
    snapshot = await createSnapshot({
      availability: input.availability,
      ...(input.readAvailability
        ? { readCurrent: input.readAvailability }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.snapshotRuntime ? { runtime: input.snapshotRuntime } : {}),
    });
  } catch (error) {
    return workflowFailure(
      "snapshot",
      input.signal?.aborted || isAbortError(error)
        ? "aborted"
        : "snapshot-failed",
      input.signal?.aborted || isAbortError(error)
        ? "레이어 분리 원본 준비를 취소했습니다."
        : "레이어 분리 원본을 안전하게 준비하지 못했습니다.",
      errorDetail(error),
      input.signal?.aborted || isAbortError(error) ? "aborted" : undefined,
    );
  }
  if (!snapshot.ok) {
    return workflowFailure(
      snapshot.phase === "availability" ? "availability" : "snapshot",
      snapshot.code === "aborted" ? "aborted" : "snapshot-failed",
      snapshot.message,
      snapshot.code,
      snapshot.code === "aborted" ? "aborted" : undefined,
    );
  }

  const parsedRequest = parseStudioSceneLayerLiftRequest({
    kind: STUDIO_SCENE_LAYER_LIFT_REQUEST_KIND,
    version: STUDIO_SCENE_LAYER_LIFT_CONTRACT_VERSION,
    requestId: input.requestId,
    source: snapshot.source,
    requestedRoles: ["background", "character"],
  });
  if (!parsedRequest.ok) {
    return workflowFailure(
      "request",
      "request-rejected",
      "레이어 분리 요청을 안전 계약으로 고정하지 못했습니다.",
      `${parsedRequest.reason}:${parsedRequest.detail}`,
    );
  }

  let ticket: StudioLayerLiftOperationTicket;
  try {
    ticket = input.registry.begin({
      mutationTicket: input.mutationTicket,
      pageId: input.pageId,
      masterEditMode: input.masterEditMode,
      selectedIds: [snapshot.source.sourceId],
      source: {
        requestId: parsedRequest.value.requestId,
        sourceId: snapshot.source.sourceId,
        sourceFingerprint: snapshot.sourceFingerprint,
        sourceSha256: snapshot.source.sha256,
        width: snapshot.source.width,
        height: snapshot.source.height,
        backgroundOutputId: input.backgroundOutputId,
        foregroundOutputId: input.foregroundOutputId,
      },
    });
  } catch (error) {
    return workflowFailure(
      "operation",
      "operation-rejected",
      "레이어 분리 편집 권한을 시작하지 못했습니다.",
      errorDetail(error),
    );
  }

  const initialCurrent = checkCurrent(
    input.registry,
    ticket,
    input.readCurrent,
  );
  if (initialCurrent) {
    input.registry.invalidate(ticket);
    return initialCurrent;
  }

  const signals = combineSignals(ticket.signal, input.signal);
  try {
    let providerValue: unknown;
    try {
      providerValue = await input.provider.analyze(parsedRequest.value, {
        ...input.providerOptions,
        signal: signals.signal,
      });
    } catch (error) {
      const current = checkCurrent(
        input.registry,
        ticket,
        input.readCurrent,
      );
      const failure = failFromAsyncError("provider", error, signals.signal);
      input.registry.invalidate(ticket);
      if (current && current.code === "stale") return current;
      return failure;
    }

    const currentAfterProvider = checkCurrent(
      input.registry,
      ticket,
      input.readCurrent,
    );
    if (currentAfterProvider) {
      input.registry.invalidate(ticket);
      return currentAfterProvider;
    }
    const parsedProvider = parseStudioSceneLayerLiftResult(providerValue);
    if (
      !parsedProvider.ok
      || parsedProvider.value.status !== "success"
      || !doesStudioSceneLayerLiftResultMatchOperation(
        ticket,
        parsedProvider.value,
      )
    ) {
      input.registry.invalidate(ticket);
      const detail = parsedProvider.ok
        ? parsedProvider.value.status === "failure"
          ? parsedProvider.value.code
          : "provider-operation-mismatch"
        : `${parsedProvider.reason}:${parsedProvider.detail}`;
      return workflowFailure(
        "provider",
        parsedProvider.ok && parsedProvider.value.status === "failure"
          ? "provider-failed"
          : "provider-rejected",
        parsedProvider.ok && parsedProvider.value.status === "failure"
          ? "로컬 인물·캐릭터 분석이 결과를 만들지 못했습니다."
          : "로컬 분석 결과가 현재 원본과 일치하지 않아 버렸습니다.",
        detail,
      );
    }
    const providerResult = parsedProvider.value;
    const foregroundLayers = providerResult.layers.filter(
      (layer) => layer.role === "character" || layer.role === "foreground",
    );
    if (foregroundLayers.length !== 1) {
      input.registry.invalidate(ticket);
      return workflowFailure(
        "provider",
        "provider-rejected",
        "첫 베타는 인물·캐릭터 전경 하나만 분리할 수 있습니다.",
        `foreground-layer-count:${foregroundLayers.length}`,
      );
    }
    const foreground = foregroundLayers[0]!;

    let compositionValue: unknown;
    try {
      compositionValue = await input.compositor.run({
        requestId: ticket.source.requestId,
        sourceId: ticket.source.sourceId,
        width: ticket.source.width,
        height: ticket.source.height,
        sourceSha256: ticket.source.sourceSha256,
        sourceRgba: parsedRequest.value.source.bytes,
        providerReceiptSha256: providerResult.receipt.receiptSha256,
        providerLayers: providerResult.layers.map((layer) => ({
          layerId: layer.layerId,
          role: layer.role,
          order: layer.order,
          rgbaSha256: layer.rgba.sha256,
          maskSha256: layer.mask.sha256,
        })),
        foregroundLayerId: foreground.layerId,
        foregroundMaskSha256: foreground.mask.sha256,
        foregroundMask: foreground.mask.bytes,
        backgroundOutputId: ticket.source.backgroundOutputId,
        foregroundOutputId: ticket.source.foregroundOutputId,
      }, {
        signal: signals.signal,
        ...(input.compositorTimeoutMs === undefined
          ? {}
          : { timeoutMs: input.compositorTimeoutMs }),
      });
    } catch (error) {
      const current = checkCurrent(
        input.registry,
        ticket,
        input.readCurrent,
      );
      const failure = failFromAsyncError("compositor", error, signals.signal);
      input.registry.invalidate(ticket);
      if (current && current.code === "stale") return current;
      return failure;
    }

    const currentAfterComposition = checkCurrent(
      input.registry,
      ticket,
      input.readCurrent,
    );
    if (currentAfterComposition) {
      input.registry.invalidate(ticket);
      return currentAfterComposition;
    }
    if (
      !trustedComposition(compositionValue)
      || !providerMatchesComposition(
        ticket,
        providerResult,
        compositionValue,
      )
    ) {
      input.registry.invalidate(ticket);
      return workflowFailure(
        "compositor",
        "compositor-rejected",
        "합성 결과의 원본·레이어·PNG 증명을 확인하지 못해 버렸습니다.",
        "composition-trust-or-provenance-mismatch",
      );
    }

    const session: StudioLayerLiftWorkflowSession = Object.freeze({
      ticket,
      request: parsedRequest.value,
      providerResult,
      artifacts: compositionValue.artifacts,
      compositionReceipt: compositionValue.compositionReceipt,
      sourceSnapshot: snapshot,
      preview: createPreview(snapshot, providerResult, compositionValue),
    });
    return Object.freeze({ ok: true, session });
  } finally {
    signals.dispose();
  }
}

export interface FinalizeStudioLayerLiftWorkflowInput {
  readonly registry: StudioLayerLiftOperationRegistry;
  readonly session: StudioLayerLiftWorkflowSession;
  readonly readCurrent: () => StudioLayerLiftOperationCurrentState;
  readonly groupId: string;
  readonly groupName?: string;
}

export type StudioLayerLiftWorkflowFinalFailureCode =
  | "admission-failed"
  | "artifact-conversion-failed"
  | "plan-rejected";

export interface StudioLayerLiftWorkflowFinalFailure {
  readonly ok: false;
  readonly code: StudioLayerLiftWorkflowFinalFailureCode;
  readonly message: string;
  readonly detail: string;
  readonly planInput?: PlanStudioLayerLiftInput;
  readonly plan?: StudioLayerLiftPlanFailure;
}

export interface StudioLayerLiftWorkflowFinalSuccess {
  readonly ok: true;
  readonly admission: StudioLayerLiftFinalAdmissionBinding;
  readonly planInput: PlanStudioLayerLiftInput;
  readonly plan: StudioLayerLiftPlanSuccess;
}

export type StudioLayerLiftWorkflowFinalResult =
  | StudioLayerLiftWorkflowFinalSuccess
  | StudioLayerLiftWorkflowFinalFailure;

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INPUT_CHUNK_BYTES = 12_288;

function encodeBase64Bounded(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (
    let chunkStart = 0;
    chunkStart < bytes.byteLength;
    chunkStart += BASE64_INPUT_CHUNK_BYTES
  ) {
    const chunkEnd = Math.min(
      bytes.byteLength,
      chunkStart + BASE64_INPUT_CHUNK_BYTES,
    );
    let encoded = "";
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index]!;
      const hasSecond = index + 1 < bytes.byteLength;
      const hasThird = index + 2 < bytes.byteLength;
      const second = hasSecond ? bytes[index + 1]! : 0;
      const third = hasThird ? bytes[index + 2]! : 0;
      encoded += BASE64_ALPHABET[first >> 2];
      encoded += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)];
      encoded += hasSecond
        ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)]
        : "=";
      encoded += hasThird ? BASE64_ALPHABET[third & 63] : "=";
    }
    chunks.push(encoded);
  }
  return chunks.join("");
}

function verifiedPngDataUrl(
  bytes: ArrayBuffer,
): string | null {
  if (
    bytes.byteLength < 8
    || bytes.byteLength > STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES
  ) {
    return null;
  }
  const view = new Uint8Array(bytes);
  if (
    view[0] !== 0x89
    || view[1] !== 0x50
    || view[2] !== 0x4e
    || view[3] !== 0x47
    || view[4] !== 0x0d
    || view[5] !== 0x0a
    || view[6] !== 0x1a
    || view[7] !== 0x0a
  ) {
    return null;
  }
  return `data:image/png;base64,${encodeBase64Bounded(view)}`;
}

/**
 * Consumes the operation ticket exactly once. It still performs no mutation:
 * the caller receives a verified plan and can put the plan's next document
 * state through the normal single Studio commit/Undo transaction.
 */
export async function finalizeStudioLayerLiftWorkflow(
  input: FinalizeStudioLayerLiftWorkflowInput,
): Promise<StudioLayerLiftWorkflowFinalResult> {
  const latestReadRef: {
    current: StudioLayerLiftOperationCurrentState | null;
  } = { current: null };
  const admission = await input.registry.admitFinal({
    ticket: input.session.ticket,
    readCurrent: () => {
      const current = input.readCurrent();
      latestReadRef.current = current;
      return current;
    },
    providerResult: input.session.providerResult,
    artifacts: input.session.artifacts,
    compositionReceipt: input.session.compositionReceipt,
  });
  if (!admission.ok) {
    return Object.freeze({
      ok: false,
      code: "admission-failed",
      message: admission.reason === "aborted"
        ? "레이어 분리 적용을 취소했습니다."
        : "원고가 바뀌어 레이어 분리 결과를 적용하지 않았습니다.",
      detail: admission.reason,
    });
  }
  const latestRead = latestReadRef.current;
  if (latestRead === null) {
    return Object.freeze({
      ok: false,
      code: "admission-failed",
      message: "최종 원고 상태를 확인하지 못해 결과를 적용하지 않았습니다.",
      detail: "missing-final-current-state",
    });
  }

  const backgroundPngDataUrl = verifiedPngDataUrl(
    admission.artifacts.background.bytes,
  );
  const foregroundPngDataUrl = verifiedPngDataUrl(
    admission.artifacts.foreground.bytes,
  );
  if (!backgroundPngDataUrl || !foregroundPngDataUrl) {
    return Object.freeze({
      ok: false,
      code: "artifact-conversion-failed",
      message: "검증된 배경·전경 PNG를 로컬 레이어 데이터로 변환하지 못했습니다.",
      detail: "verified-png-data-url-conversion",
    });
  }

  const planInput: PlanStudioLayerLiftInput = {
    elements: latestRead.elements,
    groups: latestRead.groups,
    sourceId: input.session.ticket.source.sourceId,
    groupId: input.groupId,
    backgroundId: input.session.ticket.source.backgroundOutputId,
    foregroundId: input.session.ticket.source.foregroundOutputId,
    outputBasis: STUDIO_LAYER_LIFT_OUTPUT_BASIS,
    persistenceScope: STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
    backgroundPngDataUrl,
    foregroundPngDataUrl,
    ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
    confidence: input.session.providerResult.confidence.score,
  };
  const plan = planStudioLayerLift(planInput);
  if (!plan.ok) {
    return Object.freeze({
      ok: false,
      code: "plan-rejected",
      message: plan.message,
      detail: plan.code,
      planInput,
      plan,
    });
  }
  return Object.freeze({
    ok: true,
    admission: admission.binding,
    planInput,
    plan,
  });
}
