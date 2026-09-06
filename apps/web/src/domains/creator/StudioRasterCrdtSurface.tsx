import { useLayoutEffect, useRef, useState } from "react";

import {
  createStudioRasterHandoffAuthorityKey,
  type StudioRasterHandoffCandidate,
} from "./render/studio-raster-handoff-authority";
import {
  studioRasterOperationIntersectsDocumentRect,
  studioRasterTileIntersectsDocumentRect,
  type StudioRasterVisibleDocumentRect,
} from "./render/studio-raster-visible-rect";
import { StudioTiledDocWebGpuSurface } from "./StudioTiledDocWebGpuSurface";

import type { StudioCrdtDocument } from "./live/studio-crdt-document";
import type { StudioRasterReplayRuntimeResult } from "./live/studio-crdt-raster-replay-runtime";
import type {
  StudioRasterOverlaySourceElement,
  StudioRasterOverlaySourceOperation,
} from "./live/studio-crdt-raster-ui-bridge";
import type { StudioWebGpuCommittedPlanGates } from "./render/studio-webgpu-committed-plan";
import type { StudioWebGpuViewportSurfacePlan } from "./render/studio-webgpu-viewport";

export interface StudioRasterCrdtHandoffInput {
  /** Exact scene/gate/viewport identity owned by StudioPage. */
  readonly baseKey: string;
  readonly pageId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly elements: readonly StudioRasterOverlaySourceElement[];
  readonly gates?: StudioWebGpuCommittedPlanGates;
}

export interface StudioRasterCrdtSurfaceProps {
  readonly document: StudioCrdtDocument | null;
  readonly workId: string | null;
  readonly surfaceId: string;
  readonly viewport: StudioWebGpuViewportSurfacePlan | null;
  readonly visibleDocumentRect: StudioRasterVisibleDocumentRect | null;
  /** Low-level direct source contract retained for isolated non-Studio consumers. */
  readonly sourceOperations?: readonly StudioRasterOverlaySourceOperation[];
  /** Product path: recompute the exact eligible front suffix for every CRDT raster revision. */
  readonly handoff?: StudioRasterCrdtHandoffInput;
  /** Exact candidate selected in the same React commit that hides the Konva fallbacks. */
  readonly authorizedAuthorityKey?: string | null;
  readonly hidden?: boolean;
  readonly className?: string;
  readonly onVisibleOperationIdsChange?: (operationIds: readonly string[]) => void;
  readonly onHandoffCandidateChange?: (candidate: StudioRasterHandoffCandidate | null) => void;
  readonly onConflict?: (operationIds: readonly string[]) => void;
  readonly onError?: (message: string) => void;
}

interface ReadyRasterFrame {
  readonly generation: number;
  readonly result: StudioRasterReplayRuntimeResult;
  readonly signal: AbortSignal;
  readonly candidate: StudioRasterHandoffCandidate;
}

interface StudioRasterSurfaceCallbacks {
  readonly onVisibleOperationIdsChange?: (operationIds: readonly string[]) => void;
  readonly onHandoffCandidateChange?: (candidate: StudioRasterHandoffCandidate | null) => void;
  readonly onConflict?: (operationIds: readonly string[]) => void;
  readonly onError?: (message: string) => void;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function publishStudioRasterVisibleOperationIds(
  visibleOperationIdsRef: { current: readonly string[] },
  callbacksRef: { current: StudioRasterSurfaceCallbacks },
  operationIds: readonly string[]
): void {
  const stable = [...operationIds].sort();
  if (sameStringArray(visibleOperationIdsRef.current, stable)) return;
  visibleOperationIdsRef.current = stable;
  callbacksRef.current.onVisibleOperationIdsChange?.(stable);
}

/**
 * Owns document subscription, verified replay and the two-phase renderer handoff for one page.
 * The tile presenter prepares a complete hidden frame first. StudioPage then accepts its exact
 * candidate; only that same commit may hide the redundant Konva vectors and reveal this surface.
 */
export function StudioRasterCrdtSurface({
  document,
  workId,
  surfaceId,
  viewport,
  visibleDocumentRect,
  sourceOperations = [],
  handoff,
  authorizedAuthorityKey = null,
  hidden = false,
  className,
  onVisibleOperationIdsChange,
  onHandoffCandidateChange,
  onConflict,
  onError,
}: StudioRasterCrdtSurfaceProps) {
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState<ReadyRasterFrame | null>(null);
  const generationRef = useRef(0);
  const visibleOperationIdsRef = useRef<readonly string[]>([]);
  const sourceOperationsRef = useRef(sourceOperations);
  const handoffRef = useRef(handoff);
  const semanticHashCacheRef = useRef(new Map<string, {
    readonly semanticParameters: string;
    readonly sha256: string;
  }>());
  const callbacksRef = useRef<StudioRasterSurfaceCallbacks>({
    onVisibleOperationIdsChange,
    onHandoffCandidateChange,
    onConflict,
    onError,
  });
  callbacksRef.current = {
    onVisibleOperationIdsChange,
    onHandoffCandidateChange,
    onConflict,
    onError,
  };
  sourceOperationsRef.current = sourceOperations;
  handoffRef.current = handoff;
  const sourceOperationKey = sourceOperations
    .map(({ operationId, semanticParameters }) => `${operationId}:${semanticParameters}`)
    .join("\u001e");
  const handoffBaseKey = handoff?.baseKey ?? null;
  const hasViewport = viewport !== null;
  const visibleRectX = visibleDocumentRect?.x ?? null;
  const visibleRectY = visibleDocumentRect?.y ?? null;
  const visibleRectWidth = visibleDocumentRect?.width ?? null;
  const visibleRectHeight = visibleDocumentRect?.height ?? null;

  useLayoutEffect(() => {
    setRevision((value) => value + 1);
    if (!document) return;
    return document.subscribeChanges((change) => {
      if (
        change.changedRasterSurfaceIds.has(surfaceId) ||
        change.snapshot.rasterOperationLogs.some((log) => log.surface.surfaceId === surfaceId) && (
          change.changedRasterOperationIds.size > 0 ||
          change.changedRasterUndoOperationIds.size > 0 ||
          change.changedRasterUndoAcknowledgementIds.size > 0
        )
      ) {
        setRevision((value) => value + 1);
      }
    }, {
      includeOrigin: () => true,
      includeChange: ({
        changedRasterSurfaceIds,
        changedRasterOperationIds,
        changedRasterUndoOperationIds,
        changedRasterUndoAcknowledgementIds,
        changedRasterCheckpointIds,
      }) =>
        changedRasterSurfaceIds.size > 0 ||
        changedRasterOperationIds.size > 0 ||
        changedRasterUndoOperationIds.size > 0 ||
        changedRasterUndoAcknowledgementIds.size > 0 ||
        changedRasterCheckpointIds.size > 0,
      snapshotFields: ["rasterOperationLogs"] as const,
    });
  }, [document, surfaceId]);

  useLayoutEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    publishStudioRasterVisibleOperationIds(visibleOperationIdsRef, callbacksRef, []);
    callbacksRef.current.onHandoffCandidateChange?.(null);
    setFrame(null);
    if (
      hidden || !document || !workId || !hasViewport ||
      visibleRectX === null || visibleRectY === null ||
      visibleRectWidth === null || visibleRectHeight === null
    ) {
      return () => controller.abort();
    }
    const directSourceSnapshot = sourceOperationsRef.current.map((source) => ({ ...source }));
    const handoffSnapshot = handoffRef.current
      ? {
          ...handoffRef.current,
          elements: handoffRef.current.elements.map((element) => ({ ...element })),
        }
      : null;

    let active = true;
    // 파싱/검증(readRasterOperationLog 계약)을 Worker로 넘기는 async 읽기 — 이미 async였던 동적
    // import들과 나란히 Promise.all에 넣어 병렬로 대기한다(순차 대기보다 빠르거나 최소 동일).
    void Promise.all([
      document.getRasterOperationLogAsync(surfaceId, { signal: controller.signal }),
      import( "./live/studio-crdt-raster-replay-runtime"),
      import("./render/studio-raster-asset-client"),
      import( "./live/studio-crdt-raster-ui-bridge"),
      import("./render/studio-raster-server-authority"),
    ]).then(async ([log, runtime, assetClient, bridge, serverAuthority]) => {
      if (!log) return;
      const planned = handoffSnapshot
        ? bridge.planStudioRasterOverlayHandoff({
            log,
            elements: handoffSnapshot.elements,
            pageId: handoffSnapshot.pageId,
            documentWidth: handoffSnapshot.documentWidth,
            documentHeight: handoffSnapshot.documentHeight,
            gates: handoffSnapshot.gates,
          })
        : null;
      if (handoffSnapshot && planned?.status !== "ready") return;
      const sourceSnapshot = planned?.status === "ready"
        ? planned.sourceOperations
        : directSourceSnapshot;
      if (sourceSnapshot.length === 0) return;
      const sourceById = new Map(sourceSnapshot.map((source) => [source.operationId, source]));
      const operationById = new Map(
        log.operations.map((operation) => [operation.operationId, operation])
      );
      const visibleRect = {
        x: visibleRectX,
        y: visibleRectY,
        width: visibleRectWidth,
        height: visibleRectHeight,
      };
      const visibleSourceSnapshot = sourceSnapshot.filter((source) => {
        const operation = operationById.get(source.operationId);
        return operation !== undefined && studioRasterOperationIntersectsDocumentRect(
          operation,
          log.surface,
          visibleRect
        );
      });
      const [result, rasterLogSha256] = await Promise.all([
        runtime.replayStudioRasterCrdtPixels({
          workId,
          log,
          signal: controller.signal,
          visibleTileFilter: (tile) =>
            studioRasterTileIntersectsDocumentRect(tile, visibleRect, log.surface.tileSize),
        }, {
          download: async (reference, signal) => (
            await assetClient.downloadStudioRasterAsset(workId, reference, signal)
          ).bytes,
        }),
        serverAuthority.sha256StudioRasterOperationLogAuthority(log, controller.signal),
      ]);
      if (result.conflictedOperationIds.length > 0) {
        if (!active || controller.signal.aborted || generationRef.current !== generation) return;
        callbacksRef.current.onConflict?.(result.conflictedOperationIds);
        callbacksRef.current.onError?.(
          `동시 픽셀 편집 ${result.conflictedOperationIds.length}건이 다른 기준 픽셀과 충돌해 벡터 원본으로 복구했습니다.`
        );
        return;
      }
      if (
        result.appliedOperationIds.length !== visibleSourceSnapshot.length ||
        result.appliedOperationIds.some(
          (operationId, index) => operationId !== visibleSourceSnapshot[index]?.operationId
        )
      ) {
        throw new Error("픽셀 재생 결과가 현재 벡터 원본 순서와 일치하지 않습니다.");
      }
      // A viewport with no promoted ink needs no renderer handoff. Keeping every vector mounted is
      // both cheaper and safer than authorizing a complete but fully transparent tile frame.
      if (visibleSourceSnapshot.length === 0) return;
      for (const operationId of result.appliedOperationIds) {
        const source = sourceById.get(operationId);
        const operation = log.operations.find((candidate) => candidate.operationId === operationId);
        if (!source || !operation) {
          throw new Error("표시할 픽셀 작업의 벡터 원본을 확인할 수 없습니다.");
        }
        const cached = semanticHashCacheRef.current.get(operationId);
        const actualSha256 = cached?.semanticParameters === source.semanticParameters
          ? cached.sha256
          : await bridge.sha256StudioRasterSemanticParameters(
              source.semanticParameters,
              controller.signal
            );
        semanticHashCacheRef.current.set(operationId, {
          semanticParameters: source.semanticParameters,
          sha256: actualSha256,
        });
        if (actualSha256 !== operation.semanticParametersSha256) {
          throw new Error("벡터 원본이 변경되어 안전한 픽셀 표시를 중단했습니다.");
        }
      }
      if (!active || controller.signal.aborted || generationRef.current !== generation) return;
      const baseKey = handoffSnapshot?.baseKey ?? [surfaceId, sourceOperationKey].join("\u001d");
      const candidate: StudioRasterHandoffCandidate = {
        baseKey,
        generation,
        operationIds: Object.freeze([...result.appliedOperationIds]),
        rasterLogSha256,
        authorityKey: createStudioRasterHandoffAuthorityKey({
          baseKey,
          generation,
          rasterLogSha256,
          sourceOperations: visibleSourceSnapshot,
        }),
      };
      setFrame({ generation, result, signal: controller.signal, candidate });
    }).catch((cause: unknown) => {
      if (
        !active || controller.signal.aborted ||
        (cause instanceof DOMException && cause.name === "AbortError")
      ) return;
      publishStudioRasterVisibleOperationIds(visibleOperationIdsRef, callbacksRef, []);
      callbacksRef.current.onHandoffCandidateChange?.(null);
      callbacksRef.current.onError?.(
        cause instanceof Error
          ? cause.message
          : "실시간 픽셀 캔버스를 재생하지 못했습니다."
      );
    });

    return () => {
      active = false;
      controller.abort(new DOMException("새 래스터 프레임이 요청되었습니다.", "AbortError"));
    };
  }, [
    document,
    handoffBaseKey,
    hasViewport,
    hidden,
    revision,
    sourceOperationKey,
    surfaceId,
    visibleRectHeight,
    visibleRectWidth,
    visibleRectX,
    visibleRectY,
    workId,
  ]);

  const presentationAuthorized = frame !== null &&
    authorizedAuthorityKey === frame.candidate.authorityKey;

  useLayoutEffect(() => {
    publishStudioRasterVisibleOperationIds(
      visibleOperationIdsRef,
      callbacksRef,
      presentationAuthorized && frame ? frame.candidate.operationIds : []
    );
  }, [frame, presentationAuthorized]);

  useLayoutEffect(() => () => {
    visibleOperationIdsRef.current = [];
    callbacksRef.current.onVisibleOperationIdsChange?.([]);
    callbacksRef.current.onHandoffCandidateChange?.(null);
  }, []);

  if (!frame || !viewport || !visibleDocumentRect || hidden) return null;
  return (
    <StudioTiledDocWebGpuSurface
      className={className}
      generation={frame.generation}
      surface={frame.result.surface}
      tiles={frame.result.tiles}
      viewport={{
        ...viewport.transform,
        surfaceBounds: viewport.surface,
      }}
      documentViewport={visibleDocumentRect}
      signal={frame.signal}
      presentationAuthorized={presentationAuthorized}
      onFrameReady={(generation) => {
        if (generation !== frame.generation || generationRef.current !== generation) return;
        callbacksRef.current.onHandoffCandidateChange?.(frame.candidate);
      }}
      onFrameInvalid={() => {
        publishStudioRasterVisibleOperationIds(visibleOperationIdsRef, callbacksRef, []);
        callbacksRef.current.onHandoffCandidateChange?.(null);
      }}
      onPresentationResult={(result) => {
        if (result.status === "ready" || result.status === "stale") return;
        callbacksRef.current.onError?.(
          `실시간 픽셀 표시가 안전하게 중단되었습니다 (${result.reason}).`
        );
      }}
    />
  );
}
