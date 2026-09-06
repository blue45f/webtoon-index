
import {
  STUDIO_CRDT_DELETION_OPERATION_MAX_ENTRIES,
  UUID_PATTERN,
} from "./studio-crdt-document-constants";
import {
  createDeletionOperationId,
  parseDeletionTarget,
} from "./studio-crdt-document-helpers";
import { STUDIO_CRDT_ORIGIN_LOCAL } from "./studio-crdt-protocol";
import { studioCrdtLayerGroupKey } from "./studio-crdt-scene-schema";

import type { StudioCrdtDocumentHost } from "./studio-crdt-document-host";
import type * as Y from "yjs";

export function changedIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedStrokeIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedStrokeIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedSceneElementIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedSceneElementIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedSceneElementIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedPageIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedPageIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedPageIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedLayerGroupIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedLayerGroupIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedLayerGroupIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedRasterSurfaceIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedRasterSurfaceIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedRasterSurfaceIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedRasterOperationIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedRasterOperationIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedRasterOperationIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedRasterUndoOperationIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedRasterUndoOperationIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedRasterUndoOperationIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedRasterUndoAcknowledgementIdsFor(host: StudioCrdtDocumentHost,
    transaction: Y.Transaction
  ): Set<string> {
    const existing = host.changedRasterUndoAcknowledgementIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedRasterUndoAcknowledgementIdsByTransaction.set(transaction, created);
    return created;
  }

export function changedRasterCheckpointIdsFor(host: StudioCrdtDocumentHost, transaction: Y.Transaction): Set<string> {
    const existing = host.changedRasterCheckpointIdsByTransaction.get(transaction);
    if (existing) return existing;
    const created = new Set<string>();
    host.changedRasterCheckpointIdsByTransaction.set(transaction, created);
    return created;
  }

export function indexDeletionOperation(host: StudioCrdtDocumentHost, operationId: string, target: string): void {
    if (!UUID_PATTERN.test(operationId) || !parseDeletionTarget(target)) return;
    const operationIds = host.deletionOpIdsByTarget.get(target) ?? new Set<string>();
    operationIds.add(operationId);
    host.deletionOpIdsByTarget.set(target, operationIds);
  }

export function unindexDeletionOperation(host: StudioCrdtDocumentHost, operationId: string, target: string): void {
    const operationIds = host.deletionOpIdsByTarget.get(target);
    if (!operationIds) return;
    operationIds.delete(operationId);
    if (operationIds.size === 0) host.deletionOpIdsByTarget.delete(target);
  }

export function markDeletionTargetChanged(host: StudioCrdtDocumentHost, targetValue: string, transaction: Y.Transaction): void {
    const target = parseDeletionTarget(targetValue);
    if (!target) return;
    if (target.kind === "stroke") changedIdsFor(host, transaction).add(target.id);
    else if (target.kind === "scene") {
      changedSceneElementIdsFor(host, transaction).add(target.id);
    } else if (target.kind === "page") {
      changedPageIdsFor(host, transaction).add(target.id);
    } else {
      changedLayerGroupIdsFor(host, transaction).add(
        studioCrdtLayerGroupKey(target.pageId, target.id)
      );
    }
  }

export function activeDeletionOperationIds(host: StudioCrdtDocumentHost, target: string): string[] {
    const operationIds = host.deletionOpIdsByTarget.get(target);
    if (!operationIds) return [];
    const active: string[] = [];
    for (const operationId of operationIds) {
      if (
        host.deletionOps.get(operationId) === target &&
        host.deletionAcks.get(operationId) !== target
      ) active.push(operationId);
    }
    return active;
  }

export function hasActiveDeletionOperation(host: StudioCrdtDocumentHost, target: string): boolean {
    const operationIds = host.deletionOpIdsByTarget.get(target);
    if (!operationIds) return false;
    for (const operationId of operationIds) {
      if (
        host.deletionOps.get(operationId) === target &&
        host.deletionAcks.get(operationId) !== target
      ) return true;
    }
    return false;
  }

export function isDeleted(host: StudioCrdtDocumentHost, record: Y.Map<unknown>, target: string): boolean {
    return record.get("deleted") === true || hasActiveDeletionOperation(host, target);
  }

export function addDeletionOperation(host: StudioCrdtDocumentHost, target: string): void {
    if (!parseDeletionTarget(target)) throw new Error("삭제 대상 식별자가 올바르지 않습니다.");
    if (host.deletionOps.size >= STUDIO_CRDT_DELETION_OPERATION_MAX_ENTRIES) {
      throw new Error("삭제 작업 기록이 최대 한도를 초과했습니다. 문서를 압축해 주세요.");
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const operationId = createDeletionOperationId();
      if (host.deletionOps.has(operationId) || host.deletionAcks.has(operationId)) continue;
      host.deletionOps.set(operationId, target);
      return;
    }
    throw new Error("충돌 없는 삭제 작업 식별자를 생성하지 못했습니다.");
  }

export function acknowledgeCurrentDeletionOperations(host: StudioCrdtDocumentHost, record: Y.Map<unknown>, target: string): void {
    const activeOperationIds = activeDeletionOperationIds(host, target);
    let newAcknowledgementCount = 0;
    for (const operationId of activeOperationIds) {
      const current = host.deletionAcks.get(operationId);
      if (current === undefined) newAcknowledgementCount += 1;
      else if (current !== target) {
        throw new Error("삭제 복원 승인 기록이 손상되었습니다.");
      }
    }
    if (
      host.deletionAcks.size + newAcknowledgementCount >
      STUDIO_CRDT_DELETION_OPERATION_MAX_ENTRIES
    ) {
      throw new Error("삭제 복원 승인 기록이 최대 한도를 초과했습니다. 문서를 압축해 주세요.");
    }
    // `deleted` is a read-only legacy fallback for normal edits. Only an explicit restore may
    // clear it; new deletes and all ordinary writes live exclusively in the OR-set roots.
    if (record.get("deleted") === true) record.set("deleted", false);
    for (const operationId of activeOperationIds) {
      if (!host.deletionAcks.has(operationId)) host.deletionAcks.set(operationId, target);
    }
  }

export function restoreDeletedRecord(host: StudioCrdtDocumentHost, record: Y.Map<unknown>, target: string): boolean {
    if (!isDeleted(host, record, target)) return false;
    host.doc.transact(
      () => acknowledgeCurrentDeletionOperations(host, record, target),
      STUDIO_CRDT_ORIGIN_LOCAL
    );
    return true;
  }
