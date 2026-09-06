/**
 * Editor-side glue for rejected-stroke recovery, kept out of StudioCuttoonEditorHost so the host
 * ratchet keeps shrinking. The host only calls `salvageRejectedStroke` at its three cancellation
 * sites and passes `queueDeferredStrokeCommit`; everything else (restorer registration, fresh-id
 * restore through the ordinary deferred commit, user-facing copy) lives here and is unit-testable
 * without the 30k-line component.
 */

import { useEffect, useRef } from "react";

import { uid } from "./studio-id";
import {
  recordStudioRejectedStroke,
  setStudioRejectedStrokeRestorer,
  type StudioRejectedStrokeRecord,
  type StudioRejectedStrokeRestorer,
  type StudioRejectedStrokeSalvagePlan,
} from "./studio-rejected-stroke-recovery";

import type { DrawEl } from "./studio-element-model";

export const STUDIO_GPU_LIVE_INK_PROVIDER_LABEL = "WebGPU 라이브 잉크";

/** Banner copy for a provider rejection; tells the user whether the finished mark survived. */
export function studioRejectedLiveSurfaceMessage(
  providerLabel: string,
  detail: string,
  salvaged: boolean,
): string {
  return salvaged
    ? `${providerLabel} 엔진을 더 이상 사용할 수 없어 현재 획의 미리보기를 중단했습니다. `
      + `완성된 획은 상태 레일의 '획 복구'로 되살릴 수 있습니다. ${detail}`
    : `${providerLabel} 엔진을 더 이상 사용할 수 없어 현재 획을 취소했습니다. ${detail}`;
}

/**
 * The explicit restore. The rejected id was tombstoned in the CRDT draft and its GPU receipt
 * bookkeeping was cleared, so the geometry re-enters under a fresh id through the ordinary deferred
 * commit (Konva document layer). The record holds a frozen snapshot; clone before the document takes
 * ownership. Pages must match — a record from another page is refused and kept.
 */
export function restoreStudioRejectedStrokeIntoDocument(
  record: StudioRejectedStrokeRecord,
  activePageId: string,
  queueDeferredStrokeCommit: (finished: DrawEl) => void,
  nextId: () => string = uid,
): ReturnType<StudioRejectedStrokeRestorer> {
  if (record.pageId !== activePageId) {
    return {
      status: "refused",
      recordId: record.id,
      reason: "다른 페이지에서 그린 획입니다. 그 페이지로 이동한 뒤 복구하세요.",
    };
  }
  const restored: DrawEl = { ...structuredClone(record.stroke), id: nextId() };
  queueDeferredStrokeCommit(restored);
  return { status: "restored", recordId: record.id, restoredStrokeId: restored.id };
}

export type StudioSalvageRejectedStroke = (
  stroke: DrawEl | null | undefined,
  providerLabel: string,
  reason: string,
  pageId?: string,
) => StudioRejectedStrokeSalvagePlan;

export interface StudioRejectedStrokeRecoveryHostInput {
  readonly activePageId: string;
  readonly queueDeferredStrokeCommit: (finished: DrawEl) => void;
}

/**
 * Registers this editor instance as the restorer for the lifetime of the mount and returns the
 * salvage entry point the cancellation sites call. Inputs are read through a ref inside callbacks
 * only, so the latest page and commit queue are used without re-registering on every render.
 */
export function useStudioRejectedStrokeRecoveryHost(
  input: StudioRejectedStrokeRecoveryHostInput,
): { readonly salvageRejectedStroke: StudioSalvageRejectedStroke } {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  useEffect(() => {
    const unregister = setStudioRejectedStrokeRestorer((record) =>
      restoreStudioRejectedStrokeIntoDocument(
        record,
        latest.current.activePageId,
        latest.current.queueDeferredStrokeCommit,
      ));
    return () => {
      unregister();
    };
  }, []);
  return {
    salvageRejectedStroke: (stroke, providerLabel, reason, pageId) =>
      recordStudioRejectedStroke({
        stroke,
        pageId: pageId ?? latest.current.activePageId,
        provider: providerLabel,
        reason,
      }),
  };
}
