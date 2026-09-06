/**
 * Manual-mask correction boundary for the first local Scene Layer Lift beta.
 *
 * This module deliberately does not own the operation registry and never
 * consumes its ticket. It re-admits one artist-authored mask, recomposes
 * background/foreground artifacts with the exact existing source/output
 * authority, and returns a fresh review session for the caller.
 */

import { sha256HexPortable } from "../studio-sha256";

import {
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
  isStudioSceneLayerLiftTrustedSuccess,
  parseStudioSceneLayerLiftRequest,
  parseStudioSceneLayerLiftResult,
  type StudioSceneLayerLiftSuccess,
} from "./studio-layer-lift-contract";
import {
  applyStudioLayerLiftCorrectionStroke,
  type StudioLayerLiftCorrectionStroke,
} from "./studio-layer-lift-correction";
import {
  applyStudioLayerLiftLocalForegroundCorrection,
  StudioLayerLiftLocalForegroundProviderError,
} from "./studio-layer-lift-local-provider";
import {
  doesStudioLayerLiftArtifactReceiptMatchOperation,
  doesStudioLayerLiftCompositionReceiptMatchOperation,
  doesStudioSceneLayerLiftResultMatchOperation,
} from "./studio-layer-lift-operation-context";

import type {
  StudioLayerLiftTrustedWorkerComposition,
} from "./studio-layer-lift-compose-worker-client";
import type {
  StudioLayerLiftSourceSnapshotSuccess,
} from "./studio-layer-lift-source-snapshot";
import type {
  StudioLayerLiftWorkflowCompositor,
  StudioLayerLiftWorkflowPreview,
  StudioLayerLiftWorkflowSession,
} from "./studio-layer-lift-workflow";

const MAXIMUM_CORRECTION_TIMEOUT_MS = 120_000;

type TrustedCorrectionComposition =
  | StudioLayerLiftTrustedComposition
  | StudioLayerLiftTrustedWorkerComposition;

export interface ApplyStudioLayerLiftCorrectionWorkflowInput {
  readonly session: StudioLayerLiftWorkflowSession;
  readonly stroke: StudioLayerLiftCorrectionStroke;
  readonly compositor: StudioLayerLiftWorkflowCompositor;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type StudioLayerLiftCorrectionWorkflowFailureCode =
  | "aborted"
  | "budget-exceeded"
  | "compositor-failed"
  | "correction-rejected"
  | "empty-foreground"
  | "invalid-mask"
  | "invalid-session"
  | "invalid-stroke"
  | "stale-provenance"
  | "timeout";

export interface StudioLayerLiftCorrectionWorkflowFailure {
  readonly ok: false;
  readonly code: StudioLayerLiftCorrectionWorkflowFailureCode;
  readonly message: string;
  readonly detail: string;
}

export interface StudioLayerLiftCorrectionWorkflowSuccess {
  readonly ok: true;
  /** False means the stroke did not alter a pixel and composition was skipped. */
  readonly recomposed: boolean;
  readonly changedPixelCount: number;
  readonly session: StudioLayerLiftWorkflowSession;
  readonly preview: StudioLayerLiftWorkflowPreview;
}

export type StudioLayerLiftCorrectionWorkflowResult =
  | StudioLayerLiftCorrectionWorkflowSuccess
  | StudioLayerLiftCorrectionWorkflowFailure;

function failure(
  code: StudioLayerLiftCorrectionWorkflowFailureCode,
  message: string,
  detail: string,
): StudioLayerLiftCorrectionWorkflowFailure {
  return Object.freeze({ ok: false as const, code, message, detail });
}

function trustedComposition(
  value: unknown,
): value is TrustedCorrectionComposition {
  return (
    isStudioLayerLiftTrustedComposition(value)
    || isStudioLayerLiftTrustedWorkerComposition(value)
  );
}

function hashAlpha(bytes: Uint8Array<ArrayBuffer>): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function sourceMatchesTicket(
  session: StudioLayerLiftWorkflowSession,
  request: ReturnType<typeof parseStudioSceneLayerLiftRequest> & {
    readonly ok: true;
  },
): boolean {
  const { ticket, sourceSnapshot, preview } = session;
  const source = request.value.source;
  return (
    request.value.requestId === ticket.source.requestId
    && source.sourceId === ticket.source.sourceId
    && source.sha256 === ticket.source.sourceSha256
    && source.width === ticket.source.width
    && source.height === ticket.source.height
    && source.pixelCount === source.width * source.height
    && sourceSnapshot.ok
    && sourceSnapshot.sourceFingerprint === ticket.source.sourceFingerprint
    && sourceSnapshot.source.sourceId === source.sourceId
    && sourceSnapshot.source.sha256 === source.sha256
    && sourceSnapshot.source.width === source.width
    && sourceSnapshot.source.height === source.height
    && preview.width === source.width
    && preview.height === source.height
    && preview.maskAlpha.byteLength === source.pixelCount
    && preview.sourceRgba.byteLength === source.byteLength
  );
}

function originalSessionHasCurrentProvenance(
  session: StudioLayerLiftWorkflowSession,
  providerResult: StudioSceneLayerLiftSuccess,
): boolean {
  return (
    isStudioLayerLiftTrustedArtifactPair(session.artifacts)
    && isTrustedStudioLayerLiftCompositionReceipt(
      session.compositionReceipt,
    )
    && doesStudioSceneLayerLiftResultMatchOperation(
      session.ticket,
      providerResult,
    )
    && doesStudioLayerLiftArtifactReceiptMatchOperation(
      session.ticket,
      session.artifacts.receipt,
    )
    && doesStudioLayerLiftCompositionReceiptMatchOperation({
      ticket: session.ticket,
      providerResult,
      artifacts: session.artifacts,
      compositionReceipt: session.compositionReceipt,
    })
  );
}

function correctedCompositionMatchesAuthority(input: {
  readonly session: StudioLayerLiftWorkflowSession;
  readonly providerResult: StudioSceneLayerLiftSuccess;
  readonly composition: TrustedCorrectionComposition;
  readonly correctedMaskSha256: `sha256:${string}`;
}): boolean {
  const { session, providerResult, composition, correctedMaskSha256 } = input;
  return (
    composition.requestId === session.ticket.source.requestId
    && composition.sourceId === session.ticket.source.sourceId
    && composition.width === session.ticket.source.width
    && composition.height === session.ticket.source.height
    && composition.removalMask.sha256 === correctedMaskSha256
    && composition.diagnostics.foregroundMaskSha256 === correctedMaskSha256
    && isStudioLayerLiftTrustedArtifactPair(composition.artifacts)
    && isTrustedStudioLayerLiftCompositionReceipt(
      composition.compositionReceipt,
    )
    && doesStudioSceneLayerLiftResultMatchOperation(
      session.ticket,
      providerResult,
    )
    && doesStudioLayerLiftArtifactReceiptMatchOperation(
      session.ticket,
      composition.artifacts.receipt,
    )
    && doesStudioLayerLiftCompositionReceiptMatchOperation({
      ticket: session.ticket,
      providerResult,
      artifacts: composition.artifacts,
      compositionReceipt: composition.compositionReceipt,
    })
  );
}

function cloneSourceSnapshot(
  snapshot: StudioLayerLiftSourceSnapshotSuccess,
  source: StudioLayerLiftWorkflowSession["request"]["source"],
): StudioLayerLiftSourceSnapshotSuccess {
  return Object.freeze({
    ok: true as const,
    source: Object.freeze({
      ...source,
      bytes: new Uint8Array(source.bytes),
    }),
    sourceFingerprint: snapshot.sourceFingerprint,
    placement: Object.freeze({ ...snapshot.placement }),
    filterExecution: snapshot.filterExecution,
  });
}

function createPreview(
  sourceRgba: Uint8Array<ArrayBuffer>,
  providerResult: StudioSceneLayerLiftSuccess,
  composition: TrustedCorrectionComposition,
): StudioLayerLiftWorkflowPreview {
  return Object.freeze({
    width: composition.width,
    height: composition.height,
    sourceRgba: new Uint8ClampedArray(sourceRgba),
    backgroundRgba: new Uint8ClampedArray(composition.backgroundRgba.bytes),
    foregroundRgba: new Uint8ClampedArray(composition.foregroundRgba.bytes),
    maskAlpha: new Uint8Array(composition.removalMask.bytes),
    confidenceScore: providerResult.confidence.score,
    confidenceBand: providerResult.confidence.band,
    backgroundRepair: Object.freeze({
      mode: "bounded-tile-fill-beta" as const,
      selectedPixelCount: composition.diagnostics.selectedPixelCount,
      partialPixelCount: composition.diagnostics.partialPixelCount,
      transparentSelectedPixelCount:
        composition.diagnostics.transparentSelectedPixelCount,
    }),
    diagnostics: Object.freeze(
      providerResult.diagnostics.map((diagnostic) =>
        Object.freeze({ ...diagnostic })),
    ),
  });
}

function correctionError(error: unknown): StudioLayerLiftCorrectionWorkflowFailure {
  if (error instanceof StudioLayerLiftLocalForegroundProviderError) {
    if (error.code === "empty-foreground") {
      return failure(
        "empty-foreground",
        "보정 결과에 남은 전경이 없어 적용하지 않았습니다.",
        error.detail,
      );
    }
    return failure(
      error.code === "invalid-inference" ? "invalid-mask" : "correction-rejected",
      "보정 마스크를 신뢰 가능한 로컬 결과로 확정하지 못했습니다.",
      `${error.code}:${error.detail}`,
    );
  }
  return failure(
    "correction-rejected",
    "보정 마스크를 신뢰 가능한 로컬 결과로 확정하지 못했습니다.",
    "correction-unreadable",
  );
}

function asyncFailure(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
): StudioLayerLiftCorrectionWorkflowFailure {
  if (timedOut) {
    return failure(
      "timeout",
      "보정된 배경·전경을 다시 만드는 시간이 초과되었습니다.",
      "composition-timeout",
    );
  }
  const candidate = typeof error === "object" && error !== null
    ? error as { readonly code?: unknown; readonly name?: unknown }
    : null;
  if (
    signal.aborted
    || candidate?.name === "AbortError"
    || candidate?.code === "aborted"
  ) {
    return failure(
      "aborted",
      "레이어 마스크 보정 작업을 취소했습니다.",
      "composition-aborted",
    );
  }
  return failure(
    "compositor-failed",
    "보정된 배경·전경 결과를 다시 만들지 못했습니다.",
    typeof candidate?.code === "string"
      ? candidate.code
      : typeof candidate?.name === "string"
        ? candidate.name
        : "composition-failed",
  );
}

function combineSignals(
  ticketSignal: AbortSignal,
  externalSignal: AbortSignal | undefined,
): Readonly<{
  readonly controller: AbortController;
  readonly dispose: () => void;
}> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  ticketSignal.addEventListener("abort", abort, { once: true });
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (ticketSignal.aborted || externalSignal?.aborted) controller.abort();
  return Object.freeze({
    controller,
    dispose: () => {
      ticketSignal.removeEventListener("abort", abort);
      externalSignal?.removeEventListener("abort", abort);
    },
  });
}

function normalizeTimeout(
  value: number | undefined,
): number | StudioLayerLiftCorrectionWorkflowFailure | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAXIMUM_CORRECTION_TIMEOUT_MS
  ) {
    return failure(
      "invalid-session",
      "레이어 보정 시간 제한 설정이 올바르지 않습니다.",
      "invalid-timeout",
    );
  }
  return value;
}

/**
 * Applies one pointer-up correction stroke and, only when pixels changed,
 * generates a fresh provider/compositor authority chain for review.
 */
export async function applyStudioLayerLiftCorrectionWorkflow(
  input: ApplyStudioLayerLiftCorrectionWorkflowInput,
): Promise<StudioLayerLiftCorrectionWorkflowResult> {
  if (
    typeof input !== "object"
    || input === null
    || typeof input.compositor?.run !== "function"
  ) {
    return failure(
      "invalid-session",
      "레이어 보정 작업 정보를 확인하지 못했습니다.",
      "invalid-input",
    );
  }
  const timeout = normalizeTimeout(input.timeoutMs);
  if (typeof timeout === "object") return timeout;
  if (input.signal?.aborted || input.session.ticket.signal.aborted) {
    return failure(
      "aborted",
      "레이어 마스크 보정 작업을 시작하지 않았습니다.",
      "pre-aborted",
    );
  }

  const parsedRequest = parseStudioSceneLayerLiftRequest(
    input.session.request,
  );
  const parsedProvider = parseStudioSceneLayerLiftResult(
    input.session.providerResult,
  );
  if (
    !parsedRequest.ok
    || !parsedProvider.ok
    || parsedProvider.value.status !== "success"
    || !isStudioSceneLayerLiftTrustedSuccess(parsedProvider.value)
    || !sourceMatchesTicket(input.session, parsedRequest)
    || !originalSessionHasCurrentProvenance(
      input.session,
      parsedProvider.value,
    )
  ) {
    return failure(
      "stale-provenance",
      "현재 레이어 분리 결과가 원본 작업과 일치하지 않아 보정하지 않았습니다.",
      "session-authority-mismatch",
    );
  }
  const providerResult = parsedProvider.value;
  const foregroundLayers = providerResult.layers.filter(
    (layer) => layer.role === "character" || layer.role === "foreground",
  );
  if (
    providerResult.layers.length !== 1
    || foregroundLayers.length !== 1
    || hashAlpha(input.session.preview.maskAlpha)
      !== foregroundLayers[0]!.mask.sha256
  ) {
    return failure(
      "stale-provenance",
      "화면의 보정 마스크가 현재 분석 결과와 일치하지 않습니다.",
      "preview-mask-authority-mismatch",
    );
  }

  const corrected = applyStudioLayerLiftCorrectionStroke({
    mask: input.session.preview.maskAlpha,
    width: parsedRequest.value.source.width,
    height: parsedRequest.value.source.height,
    stroke: input.stroke,
  });
  if (!corrected.ok) {
    const code = corrected.code === "invalid-stroke"
      ? "invalid-stroke"
      : corrected.code === "invalid-mask"
        ? "invalid-mask"
        : "budget-exceeded";
    return failure(code, corrected.message, corrected.code);
  }
  if (corrected.changedPixelCount === 0) {
    return Object.freeze({
      ok: true as const,
      recomposed: false,
      changedPixelCount: 0,
      session: input.session,
      preview: input.session.preview,
    });
  }

  let correctedProvider: StudioSceneLayerLiftSuccess;
  try {
    correctedProvider = applyStudioLayerLiftLocalForegroundCorrection({
      request: parsedRequest.value,
      providerResult,
      mask: corrected.mask,
    });
  } catch (error) {
    return correctionError(error);
  }
  if (
    !doesStudioSceneLayerLiftResultMatchOperation(
      input.session.ticket,
      correctedProvider,
    )
    || correctedProvider.layers.length !== 1
  ) {
    return failure(
      "stale-provenance",
      "보정 결과가 현재 원본 작업과 일치하지 않아 버렸습니다.",
      "corrected-provider-authority-mismatch",
    );
  }
  const correctedForeground = correctedProvider.layers[0]!;
  if (correctedForeground.mask.sha256 !== hashAlpha(corrected.mask)) {
    return failure(
      "stale-provenance",
      "보정 결과의 마스크 증명이 일치하지 않아 버렸습니다.",
      "corrected-mask-digest-mismatch",
    );
  }

  const combined = combineSignals(
    input.session.ticket.signal,
    input.signal,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (timeout !== undefined) {
    timer = setTimeout(() => {
      timedOut = true;
      combined.controller.abort();
    }, timeout);
  }
  let rejectCompositorAbort = (): void => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectCompositorAbort = () => {
      reject(new DOMException("aborted", "AbortError"));
    };
    combined.controller.signal.addEventListener(
      "abort",
      rejectCompositorAbort,
      {
      once: true,
      },
    );
    if (combined.controller.signal.aborted) rejectCompositorAbort();
  });

  let compositionValue: unknown;
  try {
    const compositorInput: StudioLayerLiftCompositorInput = {
      requestId: input.session.ticket.source.requestId,
      sourceId: input.session.ticket.source.sourceId,
      width: input.session.ticket.source.width,
      height: input.session.ticket.source.height,
      sourceSha256: input.session.ticket.source.sourceSha256,
      sourceRgba: new Uint8Array(parsedRequest.value.source.bytes),
      providerReceiptSha256: correctedProvider.receipt.receiptSha256,
      providerLayers: correctedProvider.layers.map((layer) => Object.freeze({
        layerId: layer.layerId,
        role: layer.role,
        order: layer.order,
        rgbaSha256: layer.rgba.sha256,
        maskSha256: layer.mask.sha256,
      })),
      foregroundLayerId: correctedForeground.layerId,
      foregroundMaskSha256: correctedForeground.mask.sha256,
      foregroundMask: new Uint8Array(correctedForeground.mask.bytes),
      backgroundOutputId: input.session.ticket.source.backgroundOutputId,
      foregroundOutputId: input.session.ticket.source.foregroundOutputId,
    };
    compositionValue = await Promise.race([
      input.compositor.run(compositorInput, {
        signal: combined.controller.signal,
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
      }),
      abortPromise,
    ]);
  } catch (error) {
    return asyncFailure(
      error,
      combined.controller.signal,
      timedOut,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    combined.controller.signal.removeEventListener(
      "abort",
      rejectCompositorAbort,
    );
    combined.dispose();
  }

  if (
    timedOut
    || input.signal?.aborted
    || input.session.ticket.signal.aborted
  ) {
    return failure(
      timedOut ? "timeout" : "aborted",
      timedOut
        ? "보정된 배경·전경을 다시 만드는 시간이 초과되었습니다."
        : "레이어 마스크 보정 작업을 취소했습니다.",
      timedOut ? "composition-timeout" : "post-composition-aborted",
    );
  }
  if (
    !trustedComposition(compositionValue)
    || !correctedCompositionMatchesAuthority({
      session: input.session,
      providerResult: correctedProvider,
      composition: compositionValue,
      correctedMaskSha256: correctedForeground.mask.sha256,
    })
  ) {
    return failure(
      "stale-provenance",
      "재합성 결과의 원본·레이어·출력 증명이 일치하지 않아 버렸습니다.",
      "corrected-composition-authority-mismatch",
    );
  }

  const preview = createPreview(
    parsedRequest.value.source.bytes,
    correctedProvider,
    compositionValue,
  );
  const session: StudioLayerLiftWorkflowSession = Object.freeze({
    ticket: input.session.ticket,
    request: parsedRequest.value,
    providerResult: correctedProvider,
    artifacts: compositionValue.artifacts,
    compositionReceipt: compositionValue.compositionReceipt,
    sourceSnapshot: cloneSourceSnapshot(
      input.session.sourceSnapshot,
      parsedRequest.value.source,
    ),
    preview,
  });
  return Object.freeze({
    ok: true as const,
    recomposed: true,
    changedPixelCount: corrected.changedPixelCount,
    session,
    preview,
  });
}
