import * as Y from "yjs";

import {
  parseStudioBrushRenderProvenanceCrdtSidecar,
  serializeStudioBrushRenderProvenanceCrdtSidecarCanonical,
  type StudioBrushRenderProvenanceCrdtSidecar,
} from "../brush/studio-brush-render-provenance";

import {
  RASTER_LOCAL_UPDATE_ENCODING_HEADROOM_BYTES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES,
  STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT,
} from "./studio-crdt-document-constants";
import {
  addRasterAsset,
  assertRasterSafeId,
  brushRenderProvenanceContentIndexKey,
  brushRenderProvenanceOperationIdFromContentIndexKey,
  crdtMapEntryBytes,
  parseCanonicalBrushRenderProvenanceSidecar,
  type StudioCrdtBrushRenderProvenanceMutation,
  type StudioCrdtBrushRenderProvenanceSnapshot,
  type StudioCrdtRasterMutation,
} from "./studio-crdt-document-helpers";
import { assertAlive, type StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import { STUDIO_CRDT_ORIGIN_LOCAL, STUDIO_CRDT_UPDATE_MAX_BYTES } from "./studio-crdt-protocol";
import { runStudioCrdtRasterWorker } from "./studio-crdt-raster-worker-client";

import type { StudioRasterCompactionCheckpoint } from "@/shared/lib/studio-crdt-raster-compaction";

import {
  STUDIO_CRDT_RASTER_MAX_REFERENCED_BYTES,
  STUDIO_CRDT_RASTER_MAX_SURFACES,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  STUDIO_CRDT_RASTER_SURFACES_ROOT,
  STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT,
  STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT,
  extractStudioCrdtRasterRawRoots,
  readStudioCrdtRasterDocument,
  type StudioCrdtRasterDocumentSnapshot,
  type StudioCrdtRasterIdentityKind,
} from "@/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_MAX_OPERATIONS,
  STUDIO_RASTER_MAX_UNDO_OPERATIONS,
  canonicalStudioRasterJson,
  compareStudioRasterEventOrder,
  createStudioRasterOperationLog,
  mergeStudioRasterOperationLogs,
  type StudioRasterAssetReference,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "@/shared/lib/studio-crdt-raster-ops";

/**
   * Adds the immutable set-union of one validated raster replica. Existing entries are never
   * overwritten or deleted. Every conflict is preflighted before the Yjs transaction because Yjs
   * transactions are atomic for observers but do not roll back JavaScript exceptions.
   */
export function mergeRasterOperationLog(host: StudioCrdtDocumentHost, value: StudioRasterOperationLog): StudioRasterOperationLog {
    return mergeRasterOperationLogInternal(host, value, []);
  }

/**
   * Atomically publishes raster operations and their matching canonical render provenance.
   * Every sidecar must name an operation present in `value`; partial or unrelated attachment is
   * rejected before the Yjs transaction begins.
   */
export function mergeRasterOperationLogWithBrushRenderProvenance(host: StudioCrdtDocumentHost,
    value: StudioRasterOperationLog,
    sidecars: readonly unknown[]
  ): StudioRasterOperationLog {
    if (!Array.isArray(sidecars) || sidecars.length === 0) {
      throw new Error("원자적으로 게시할 브러시 렌더 provenance가 없습니다.");
    }
    return mergeRasterOperationLogInternal(host, value, sidecars);
  }

export function mergeRasterOperationLogInternal(host: StudioCrdtDocumentHost,
    value: StudioRasterOperationLog,
    sidecars: readonly unknown[]
  ): StudioRasterOperationLog {
    assertAlive(host);
    const incoming = createStudioRasterOperationLog(value);
    const snapshot = readExactRasterDocumentSnapshot(host);
    const incomingOperationsById = new Map(
      incoming.operations.map((operation) => [operation.operationId, operation])
    );
    const provenanceMutation = sidecars.length > 0
      ? prepareBrushRenderProvenanceMutation(host, 
          sidecars,
          snapshot,
          incomingOperationsById
        )
      : null;
    const surfaceId = incoming.surface.surfaceId;
    const surfaceJson = canonicalStudioRasterJson(incoming.surface);
    const existingSurfaceValue = host.rasterSurfaces.get(surfaceId);
    if (existingSurfaceValue !== undefined && existingSurfaceValue !== surfaceJson) {
      throw new Error("같은 래스터 surfaceId가 서로 다른 표면 계약을 가리킵니다.");
    }
    const current = snapshot.logs.get(surfaceId) ?? createStudioRasterOperationLog({
      version: STUDIO_RASTER_CRDT_VERSION,
      surface: incoming.surface,
      operations: [],
      undoOperations: [],
      undoAcknowledgements: [],
    });
    const merged = mergeStudioRasterOperationLogs([current, incoming]);
    for (const checkpoint of snapshot.checkpoints) {
      if (checkpoint.surface.surfaceId === surfaceId) {
        assertRasterCheckpointMatchesLog(host, checkpoint, merged);
      }
    }
    const operationEntries = merged.operations.map((operation) => ({
      id: operation.operationId,
      value: canonicalStudioRasterJson({ surfaceId, operation }),
    }));
    const undoEntries = merged.undoOperations.map((undoOperation) => ({
      id: undoOperation.undoOperationId,
      value: canonicalStudioRasterJson({ surfaceId, undoOperation }),
    }));
    const acknowledgementEntries = merged.undoAcknowledgements.map((acknowledgement) => ({
      id: acknowledgement.acknowledgementId,
      value: canonicalStudioRasterJson({ surfaceId, acknowledgement }),
    }));
    assertImmutableRasterEntries(host, host.rasterOperations, operationEntries, "래스터 작업");
    assertImmutableRasterEntries(host, host.rasterUndoOperations, undoEntries, "래스터 실행 취소");
    assertImmutableRasterEntries(host, 
      host.rasterUndoAcknowledgements,
      acknowledgementEntries,
      "래스터 복원 확인"
    );
    assertRasterGlobalIdentities(host, snapshot, [
      ...operationEntries.map(({ id }) => ({ id, kind: "operation" as const })),
      ...undoEntries.map(({ id }) => ({ id, kind: "undo-operation" as const })),
      ...acknowledgementEntries.map(({ id }) => ({
        id,
        kind: "undo-acknowledgement" as const,
      })),
    ]);
    const writesSurface = existingSurfaceValue === undefined;
    const missingOperations = operationEntries.filter(({ id }) => !host.rasterOperations.has(id));
    const missingUndos = undoEntries.filter(({ id }) => !host.rasterUndoOperations.has(id));
    const missingAcknowledgements = acknowledgementEntries.filter(
      ({ id }) => !host.rasterUndoAcknowledgements.has(id)
    );
    if (host.rasterSurfaces.size + (writesSurface ? 1 : 0) > STUDIO_CRDT_RASTER_MAX_SURFACES ||
        host.rasterOperations.size + missingOperations.length > STUDIO_RASTER_MAX_OPERATIONS ||
        host.rasterUndoOperations.size + missingUndos.length > STUDIO_RASTER_MAX_UNDO_OPERATIONS ||
        host.rasterUndoAcknowledgements.size + missingAcknowledgements.length >
          STUDIO_RASTER_MAX_UNDO_OPERATIONS) {
      throw new Error("래스터 CRDT 문서 전역 root 수가 허용 한도를 초과했습니다.");
    }
    assertRasterProjectedAssetBudget(host, snapshot, incoming.operations, []);
    if (
      writesSurface || missingOperations.length > 0 || missingUndos.length > 0 ||
      missingAcknowledgements.length > 0 ||
      (provenanceMutation?.registry.length ?? 0) > 0 ||
      (provenanceMutation?.contentIndex.length ?? 0) > 0
    ) {
      assertRasterMutationFitsTransport(host, {
        surface: writesSurface ? { id: surfaceId, value: surfaceJson } : undefined,
        operations: missingOperations,
        undoOperations: missingUndos,
        undoAcknowledgements: missingAcknowledgements,
        brushRenderProvenance: provenanceMutation
          ? {
              registry: provenanceMutation.registry,
              contentIndex: provenanceMutation.contentIndex,
            }
          : undefined,
      });
      host.doc.transact(() => {
        if (writesSurface) host.rasterSurfaces.set(surfaceId, surfaceJson);
        for (const entry of missingOperations) host.rasterOperations.set(entry.id, entry.value);
        for (const entry of missingUndos) host.rasterUndoOperations.set(entry.id, entry.value);
        for (const entry of missingAcknowledgements) {
          host.rasterUndoAcknowledgements.set(entry.id, entry.value);
        }
        for (const entry of provenanceMutation?.registry ?? []) {
          host.brushRenderProvenance.set(entry.id, entry.value);
        }
        for (const entry of provenanceMutation?.contentIndex ?? []) {
          host.brushRenderProvenanceContentIndex.set(entry.id, entry.value);
        }
      }, STUDIO_CRDT_ORIGIN_LOCAL);
    }
    return merged;
  }

/**
   * Strict full-registry read. Any malformed, non-canonical, orphaned, over-budget, deleted, or
   * concurrently conflicted entry rejects the entire snapshot instead of returning partial truth.
   */
export function getBrushRenderProvenanceSidecars(host: StudioCrdtDocumentHost):
    readonly Readonly<StudioBrushRenderProvenanceCrdtSidecar>[] {
    assertAlive(host);
    return readExactBrushRenderProvenanceSnapshot(host).sidecars;
  }

export function getBrushRenderProvenance(host: StudioCrdtDocumentHost,
    operationId: string
  ): Readonly<StudioBrushRenderProvenanceCrdtSidecar> | null {
    assertAlive(host);
    assertRasterSafeId(operationId, "래스터 작업");
    return readExactBrushRenderProvenanceSnapshot(host)
      .byOperationId.get(operationId) ?? null;
  }

export function getRasterOperationLog(host: StudioCrdtDocumentHost, surfaceId: string): StudioRasterOperationLog | null {
    assertAlive(host);
    assertRasterSafeId(surfaceId, "래스터 surface");
    return tryReadExactRasterDocumentSnapshot(host)?.logs.get(surfaceId) ?? null;
  }

/**
   * getRasterOperationLog 와 동일하지만 파싱·검증(JSON.parse + canonical 재직렬화 비교, exact-schema
   * 검증)을 Worker에서 실행한다 — 화면에 보이는 surface 하나만 필요한 렌더 경로(예:
   * StudioRasterCrdtSurface)가 원격 협업자 트랜잭션마다 메인 스레드를 막지 않도록. Y.Doc에서 각
   * 래스터 root의 원시 항목만 동기로 뽑아내고(가벼움 — JSON 파싱 없음), 무거운 파싱은 명시적으로
   * 선택한 Worker로 넘긴다. Worker 실패 시 동기 parser로 재실행하지 않는다. 로컬 쓰기
   * 프리플라이트처럼
   * Yjs 트랜잭션 준비 도중 동기 결과가 필요한 호출부는 계속 getRasterOperationLog 를 써야 한다.
   */
export async function getRasterOperationLogAsync(host: StudioCrdtDocumentHost,
    surfaceId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<StudioRasterOperationLog | null> {
    assertAlive(host);
    assertRasterSafeId(surfaceId, "래스터 surface");
    const snapshot = await tryReadExactRasterDocumentSnapshotAsync(host, options.signal);
    return snapshot?.logs.get(surfaceId) ?? null;
  }

export function getRasterOperationLogs(host: StudioCrdtDocumentHost): StudioRasterOperationLog[] {
    assertAlive(host);
    const snapshot = tryReadExactRasterDocumentSnapshot(host);
    if (!snapshot) return [];
    return [...snapshot.logs.values()].sort((left, right) => (
      left.surface.surfaceId < right.surface.surfaceId ? -1 :
      left.surface.surfaceId > right.surface.surfaceId ? 1 : 0
    ));
  }

export function getRasterCompactionCheckpoints(host: StudioCrdtDocumentHost, surfaceId?: string): StudioRasterCompactionCheckpoint[] {
    // Advisory metadata only. The wire form does not carry trusted replica membership/frontiers,
    // so callers must never use this as an authoritative replay base or prune events from it.
    assertAlive(host);
    if (surfaceId !== undefined) assertRasterSafeId(surfaceId, "래스터 surface");
    const snapshot = tryReadExactRasterDocumentSnapshot(host);
    if (!snapshot) return [];
    const checkpoints = snapshot.checkpoints.filter((checkpoint) => (
      surfaceId === undefined || checkpoint.surface.surfaceId === surfaceId
    ));
    return checkpoints.sort((left, right) => {
      const order = compareStudioRasterEventOrder(left.through, right.through);
      if (order !== 0) return order;
      return left.checkpointId < right.checkpointId ? -1 :
        left.checkpointId > right.checkpointId ? 1 : 0;
    });
  }

export function assertImmutableRasterEntries(host: StudioCrdtDocumentHost,
    root: Y.Map<string>,
    entries: readonly { readonly id: string; readonly value: string }[],
    label: string
  ): void {
    for (const entry of entries) {
      const existing = root.get(entry.id);
      if (existing !== undefined && existing !== entry.value) {
        throw new Error(`같은 ${label} ID가 서로 다른 불변 내용을 가리킵니다.`);
      }
    }
  }

export function readExactBrushRenderProvenanceSnapshot(host: StudioCrdtDocumentHost,
    rasterSnapshot: StudioCrdtRasterDocumentSnapshot =
      readExactRasterDocumentSnapshot(host)
  ): StudioCrdtBrushRenderProvenanceSnapshot {
    if (
      host.brushRenderProvenance.size >
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES ||
      host.brushRenderProvenanceContentIndex.size >
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES
    ) {
      throw new Error("브러시 렌더 provenance CRDT 항목 수가 허용 한도를 초과했습니다.");
    }

    let totalBytes = 0;
    for (const [key, value] of host.brushRenderProvenance) {
      totalBytes += crdtMapEntryBytes(key, value);
      if (totalBytes > STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES) {
        throw new Error("브러시 렌더 provenance CRDT 바이트 예산을 초과했습니다.");
      }
    }
    for (const [key, value] of host.brushRenderProvenanceContentIndex) {
      totalBytes += crdtMapEntryBytes(key, value);
      if (totalBytes > STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES) {
        throw new Error("브러시 렌더 provenance CRDT 바이트 예산을 초과했습니다.");
      }
    }

    const byOperationId = new Map<
      string,
      Readonly<StudioBrushRenderProvenanceCrdtSidecar>
    >();
    const rasterOperationsById = new Map<string, StudioRasterOperation>();
    for (const log of rasterSnapshot.logs.values()) {
      for (const operation of log.operations) {
        rasterOperationsById.set(operation.operationId, operation);
      }
    }
    for (const [operationId, value] of host.brushRenderProvenance) {
      const sidecar = parseCanonicalBrushRenderProvenanceSidecar(value);
      const rasterOperation = rasterOperationsById.get(operationId);
      if (
        !sidecar ||
        sidecar.operationId !== operationId ||
        rasterSnapshot.identityKinds.get(operationId) !== "operation" ||
        !rasterOperation
      ) {
        throw new Error(
          "브러시 렌더 provenance CRDT에 비정규 또는 고아 항목이 있습니다."
        );
      }
      if (
        rasterOperation.semanticParametersSha256 !==
          sidecar.provenanceSha256.slice("sha256:".length)
      ) {
        throw new Error(
          "래스터 작업 semantic hash가 브러시 렌더 provenance hash와 일치하지 않습니다."
        );
      }
      const expectedIndexKey = brushRenderProvenanceContentIndexKey(sidecar);
      if (
        host.brushRenderProvenanceContentIndex.get(expectedIndexKey) !==
          sidecar.provenanceSha256
      ) {
        throw new Error("브러시 렌더 provenance content index가 일치하지 않습니다.");
      }
      byOperationId.set(operationId, sidecar);
    }

    if (host.brushRenderProvenanceContentIndex.size !== byOperationId.size) {
      throw new Error(
        "브러시 렌더 provenance에 동시 충돌 또는 고아 content index가 있습니다."
      );
    }
    for (const [indexKey, provenanceSha256] of host.brushRenderProvenanceContentIndex) {
      const operationId =
        brushRenderProvenanceOperationIdFromContentIndexKey(indexKey);
      const sidecar = operationId ? byOperationId.get(operationId) : undefined;
      if (
        !sidecar ||
        provenanceSha256 !== sidecar.provenanceSha256 ||
        indexKey !== brushRenderProvenanceContentIndexKey(sidecar)
      ) {
        throw new Error(
          "브러시 렌더 provenance content index가 비정규이거나 충돌했습니다."
        );
      }
    }

    const sidecars = Object.freeze(
      [...byOperationId.values()].sort((left, right) =>
        left.operationId.localeCompare(right.operationId)
      )
    );
    return Object.freeze({ byOperationId, sidecars, totalBytes });
  }

export function prepareBrushRenderProvenanceMutation(host: StudioCrdtDocumentHost,
    values: readonly unknown[],
    rasterSnapshot: StudioCrdtRasterDocumentSnapshot,
    incomingOperationsById: ReadonlyMap<string, StudioRasterOperation>
  ): StudioCrdtBrushRenderProvenanceMutation {
    if (values.length > STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES) {
      throw new Error("브러시 렌더 provenance CRDT 항목 수가 허용 한도를 초과했습니다.");
    }
    const current = readExactBrushRenderProvenanceSnapshot(host, rasterSnapshot);
    const canonicalByOperationId = new Map<string, {
      readonly sidecar: Readonly<StudioBrushRenderProvenanceCrdtSidecar>;
      readonly canonical: string;
    }>();
    for (const value of values) {
      const parsed = parseStudioBrushRenderProvenanceCrdtSidecar(value);
      if (parsed.status !== "ready") {
        throw new Error(
          `브러시 렌더 provenance sidecar가 거부되었습니다: ${parsed.reason} ${parsed.path}`
        );
      }
      const operation = incomingOperationsById.get(parsed.sidecar.operationId);
      if (!operation) {
        throw new Error(
          "브러시 렌더 provenance는 같은 원자 게시 요청의 래스터 작업을 가리켜야 합니다."
        );
      }
      if (
        operation.semanticParametersSha256 !==
          parsed.sidecar.provenanceSha256.slice("sha256:".length)
      ) {
        throw new Error(
          "래스터 작업 semantic hash가 브러시 렌더 provenance hash와 일치하지 않습니다."
        );
      }
      const canonical =
        serializeStudioBrushRenderProvenanceCrdtSidecarCanonical(parsed.sidecar);
      if (!canonical) {
        throw new Error("브러시 렌더 provenance를 정규 직렬화할 수 없습니다.");
      }
      const duplicate = canonicalByOperationId.get(parsed.sidecar.operationId);
      if (duplicate && duplicate.canonical !== canonical) {
        throw new Error(
          "같은 래스터 작업 ID가 서로 다른 불변 브러시 렌더 provenance를 가리킵니다."
        );
      }
      canonicalByOperationId.set(parsed.sidecar.operationId, {
        sidecar: parsed.sidecar,
        canonical,
      });
    }
    if (canonicalByOperationId.size !== incomingOperationsById.size) {
      throw new Error(
        "원자 브러시 래스터 게시에는 모든 작업의 렌더 provenance가 필요합니다."
      );
    }

    const registry: { id: string; value: string }[] = [];
    const contentIndex: { id: string; value: string }[] = [];
    for (const { sidecar, canonical } of canonicalByOperationId.values()) {
      const existing = host.brushRenderProvenance.get(sidecar.operationId);
      if (existing !== undefined && existing !== canonical) {
        throw new Error(
          "같은 래스터 작업 ID가 서로 다른 불변 브러시 렌더 provenance를 가리킵니다."
        );
      }
      const indexKey = brushRenderProvenanceContentIndexKey(sidecar);
      const existingIndex = host.brushRenderProvenanceContentIndex.get(indexKey);
      if (
        existingIndex !== undefined &&
        existingIndex !== sidecar.provenanceSha256
      ) {
        throw new Error("브러시 렌더 provenance content index가 불변 값을 위반합니다.");
      }
      if (existing === undefined) {
        registry.push({ id: sidecar.operationId, value: canonical });
      }
      if (existingIndex === undefined) {
        contentIndex.push({ id: indexKey, value: sidecar.provenanceSha256 });
      }
    }

    if (
      host.brushRenderProvenance.size + registry.length >
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES ||
      host.brushRenderProvenanceContentIndex.size + contentIndex.length >
        STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_ENTRIES
    ) {
      throw new Error("브러시 렌더 provenance CRDT 항목 수가 허용 한도를 초과했습니다.");
    }
    let projectedBytes = current.totalBytes;
    for (const entry of registry) {
      projectedBytes += crdtMapEntryBytes(entry.id, entry.value);
    }
    for (const entry of contentIndex) {
      projectedBytes += crdtMapEntryBytes(entry.id, entry.value);
    }
    if (projectedBytes > STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_MAX_BYTES) {
      throw new Error("브러시 렌더 provenance CRDT 바이트 예산을 초과했습니다.");
    }
    return Object.freeze({
      sidecars: Object.freeze(
        [...canonicalByOperationId.values()].map(({ sidecar }) => sidecar)
      ),
      registry: Object.freeze(registry),
      contentIndex: Object.freeze(contentIndex),
    });
  }

/**
   * Strict local-write preflight. Read APIs remain fail-closed for malformed remote state, while a
   * new local event is rejected until every existing raster root can be accounted for globally.
   */
export function readExactRasterDocumentSnapshot(host: StudioCrdtDocumentHost): StudioCrdtRasterDocumentSnapshot {
    return readStudioCrdtRasterDocument(host.doc);
  }

export function assertRasterCheckpointMatchesLog(host: StudioCrdtDocumentHost,
    checkpoint: StudioRasterCompactionCheckpoint,
    log: StudioRasterOperationLog
  ): void {
    const operationKey = (operation: StudioRasterOperation) => ({
      ...operation.order,
      eventId: operation.operationId,
    });
    const undoKey = (operation: StudioRasterUndoOperation) => ({
      ...operation.order,
      eventId: operation.undoOperationId,
    });
    const acknowledgementKey = (acknowledgement: StudioRasterUndoAcknowledgement) => ({
      ...acknowledgement.order,
      eventId: acknowledgement.acknowledgementId,
    });
    const allKeys = [
      ...log.operations.map(operationKey),
      ...log.undoOperations.map(undoKey),
      ...log.undoAcknowledgements.map(acknowledgementKey),
    ];
    if (!allKeys.some((key) => (
      key.logicalClock === checkpoint.through.logicalClock &&
      key.actorId === checkpoint.through.actorId &&
      key.eventId === checkpoint.through.eventId
    ))) {
      throw new Error("래스터 checkpoint 경계가 실제 이벤트와 일치하지 않습니다.");
    }
    const sealedOperationIds = log.operations
      .filter((operation) => compareStudioRasterEventOrder(operationKey(operation), checkpoint.through) <= 0)
      .map(({ operationId }) => operationId)
      .sort();
    const sealedUndoOperationIds = log.undoOperations
      .filter((operation) => compareStudioRasterEventOrder(undoKey(operation), checkpoint.through) <= 0)
      .map(({ undoOperationId }) => undoOperationId)
      .sort();
    const sealedUndoAcknowledgementIds = log.undoAcknowledgements
      .filter((acknowledgement) => (
        compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), checkpoint.through) <= 0
      ))
      .map(({ acknowledgementId }) => acknowledgementId)
      .sort();
    if (canonicalStudioRasterJson(sealedOperationIds) !==
          canonicalStudioRasterJson(checkpoint.sealedOperationIds) ||
        canonicalStudioRasterJson(sealedUndoOperationIds) !==
          canonicalStudioRasterJson(checkpoint.sealedUndoOperationIds) ||
        canonicalStudioRasterJson(sealedUndoAcknowledgementIds) !==
          canonicalStudioRasterJson(checkpoint.sealedUndoAcknowledgementIds)) {
      throw new Error("래스터 checkpoint 봉인 집합이 안정 prefix와 일치하지 않습니다.");
    }
    const sealedOperations = new Set(sealedOperationIds);
    const sealedUndos = new Set(sealedUndoOperationIds);
    if (log.undoOperations.some((operation) => (
      compareStudioRasterEventOrder(undoKey(operation), checkpoint.through) > 0 &&
      sealedOperations.has(operation.targetOperationId)
    )) || log.undoAcknowledgements.some((acknowledgement) => (
      compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), checkpoint.through) > 0 &&
      sealedUndos.has(acknowledgement.undoOperationId)
    ))) {
      throw new Error("래스터 checkpoint가 닫히지 않은 undo horizon을 봉인합니다.");
    }
  }

export function assertRasterGlobalIdentities(host: StudioCrdtDocumentHost,
    snapshot: StudioCrdtRasterDocumentSnapshot,
    projected: readonly {
      readonly id: string;
      readonly kind: StudioCrdtRasterIdentityKind;
    }[]
  ): void {
    const identities = new Map(snapshot.identityKinds);
    for (const entry of projected) {
      const existingKind = identities.get(entry.id);
      if (existingKind !== undefined && existingKind !== entry.kind) {
        throw new Error("래스터 이벤트 UUID는 operation/undo/ack/checkpoint 전체에서 전역 고유해야 합니다.");
      }
      identities.set(entry.id, entry.kind);
    }
  }

export function assertRasterProjectedAssetBudget(host: StudioCrdtDocumentHost,
    snapshot: StudioCrdtRasterDocumentSnapshot,
    operations: readonly StudioRasterOperation[],
    checkpointAssets: readonly StudioRasterAssetReference[]
  ): void {
    const assets = new Map(snapshot.assets);
    let referencedBytes = snapshot.referencedBytes;
    for (const operation of operations) {
      for (const patch of operation.patches) {
        referencedBytes += addRasterAsset(assets, patch.effect.payload, "래스터 operation 자산");
        if (patch.selectionMask) {
          referencedBytes += addRasterAsset(assets, patch.selectionMask, "래스터 selection 자산");
        }
      }
    }
    for (const asset of checkpointAssets) {
      referencedBytes += addRasterAsset(assets, asset, "래스터 checkpoint 자산");
    }
    if (referencedBytes > STUDIO_CRDT_RASTER_MAX_REFERENCED_BYTES) {
      throw new Error("래스터 CRDT 문서 전역 자산 참조 예산을 초과했습니다.");
    }
  }

export function assertRasterMutationFitsTransport(host: StudioCrdtDocumentHost, mutation: StudioCrdtRasterMutation): void {
    const probe = new Y.Doc();
    try {
      probe.transact(() => {
        if (mutation.surface) {
          probe.getMap<string>(STUDIO_CRDT_RASTER_SURFACES_ROOT)
            .set(mutation.surface.id, mutation.surface.value);
        }
        const operations = probe.getMap<string>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
        for (const entry of mutation.operations ?? []) operations.set(entry.id, entry.value);
        const undoOperations = probe.getMap<string>(STUDIO_CRDT_RASTER_UNDO_OPERATIONS_ROOT);
        for (const entry of mutation.undoOperations ?? []) undoOperations.set(entry.id, entry.value);
        const acknowledgements = probe.getMap<string>(STUDIO_CRDT_RASTER_UNDO_ACKS_ROOT);
        for (const entry of mutation.undoAcknowledgements ?? []) {
          acknowledgements.set(entry.id, entry.value);
        }
        const provenance = probe.getMap<string>(
          STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_ROOT
        );
        for (const entry of mutation.brushRenderProvenance?.registry ?? []) {
          provenance.set(entry.id, entry.value);
        }
        const provenanceContentIndex = probe.getMap<string>(
          STUDIO_CRDT_BRUSH_RENDER_PROVENANCE_CONTENT_INDEX_ROOT
        );
        for (const entry of mutation.brushRenderProvenance?.contentIndex ?? []) {
          provenanceContentIndex.set(entry.id, entry.value);
        }
      });
      const encoded = Y.encodeStateAsUpdate(probe);
      if (encoded.byteLength + RASTER_LOCAL_UPDATE_ENCODING_HEADROOM_BYTES >
          STUDIO_CRDT_UPDATE_MAX_BYTES) {
        throw new Error(
          "래스터 CRDT 로컬 업데이트가 전송 한도를 초과합니다. 더 작은 이벤트 묶음으로 나눠 주세요."
        );
      }
    } finally {
      probe.destroy();
    }
  }

export function tryReadExactRasterDocumentSnapshot(host: StudioCrdtDocumentHost): StudioCrdtRasterDocumentSnapshot | null {
    try {
      return readExactRasterDocumentSnapshot(host);
    } catch {
      return null;
    }
  }

/** Worker-backed counterpart of tryReadExactRasterDocumentSnapshot — see getRasterOperationLogAsync. */
export async function tryReadExactRasterDocumentSnapshotAsync(host: StudioCrdtDocumentHost,
    signal?: AbortSignal
  ): Promise<StudioCrdtRasterDocumentSnapshot | null> {
    try {
      const roots = extractStudioCrdtRasterRawRoots(host.doc);
      if (!roots) return null;
      const { snapshot } = await runStudioCrdtRasterWorker(roots, {
        executionMode: "worker",
        signal,
      });
      return snapshot;
    } catch {
      return null;
    }
  }
