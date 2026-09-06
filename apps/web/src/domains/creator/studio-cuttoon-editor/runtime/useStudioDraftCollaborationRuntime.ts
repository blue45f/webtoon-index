import { useEffect, useRef, useState } from "react";

import { buildStudioLiveShareHref } from "../../creator-studio-links";

import type {
  StudioDraftCollaborationProvisionGate,
  StudioDraftCollaborationReadiness,
} from "../../studio-draft-collaboration";

interface UseStudioDraftCollaborationRuntimeOptions {
  readonly announce: (message: string) => void;
  readonly autosaveKey: string;
  readonly getProjectSnapshot: () => unknown;
  readonly liveRoomQueryParam: string | null;
  readonly reportError: (message: string) => void;
  readonly studioAuthUserId: string | null;
  readonly workId: string | null;
}

/**
 * Owns the lifecycle for an unsaved document's provisional collaboration room.
 *
 * The editor host only consumes readiness and an intent-level `requestShare` command. Identity
 * storage, rate limiting, cancellation, snapshot sizing, and clipboard behavior stay behind this
 * boundary so panels cannot provision competing rooms for the same draft.
 */
export function useStudioDraftCollaborationRuntime({
  announce,
  autosaveKey,
  getProjectSnapshot,
  liveRoomQueryParam,
  reportError,
  studioAuthUserId,
  workId,
}: UseStudioDraftCollaborationRuntimeOptions) {
  const [draftCollaboration, setDraftCollaboration] =
    useState<StudioDraftCollaborationReadiness | null>(null);
  const provisionGateRef = useRef<StudioDraftCollaborationProvisionGate | null>(null);
  const provisionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    provisionAbortRef.current?.abort();
    provisionAbortRef.current = null;
    provisionGateRef.current = null;
    if (workId || liveRoomQueryParam || !studioAuthUserId) {
      setDraftCollaboration(null);
      return;
    }

    let current = true;
    void import("../../studio-draft-collaboration")
      .then(async ({ loadOrCreateStudioDraftCollaborationIdentity }) => {
        if (!current) return;
        const identity = await loadOrCreateStudioDraftCollaborationIdentity({
          documentScopeKey: autosaveKey,
          ownerScopeKey: studioAuthUserId,
        });
        if (current) setDraftCollaboration({ status: "local", identity });
      })
      .catch((error: unknown) => {
        if (!current) return;
        console.error("Failed to prepare the unsaved Studio collaboration identity:", error);
        setDraftCollaboration(null);
      });

    return () => {
      current = false;
      provisionAbortRef.current?.abort();
      provisionAbortRef.current = null;
    };
  }, [autosaveKey, liveRoomQueryParam, studioAuthUserId, workId]);

  async function copyShareLink(provisionalWorkId: string): Promise<void> {
    await navigator.clipboard.writeText(
      buildStudioLiveShareHref(provisionalWorkId, window.location.origin, provisionalWorkId),
    );
    announce("팀 초대 링크를 복사했습니다 · 팀원 권한을 추가한 뒤 전달하세요");
  }

  async function requestShare(): Promise<void> {
    const readiness = draftCollaboration;
    const actorAuthScopeKey = studioAuthUserId;
    if (!readiness || !actorAuthScopeKey || readiness.status === "provisioning") return;
    if (readiness.status === "ready") {
      try {
        await copyShareLink(readiness.room.provisionalWorkId);
      } catch {
        reportError("초대 링크를 복사하지 못했어요. 브라우저 클립보드 권한을 확인해 주세요.");
      }
      return;
    }

    const identity = readiness.identity;
    const controller = new AbortController();
    provisionAbortRef.current?.abort();
    provisionAbortRef.current = controller;
    try {
      const [
        {
          consumeStudioDraftCollaborationProvisionAttempt,
          createStudioDraftCollaborationProvisionRequest,
        },
        { provisionCreatorDraftCollaborationRoom },
      ] = await Promise.all([
        import("../../studio-draft-collaboration"),
        import("../../creator-draft-collaboration-client"),
      ]);
      if (controller.signal.aborted) return;
      const gate = consumeStudioDraftCollaborationProvisionAttempt(
        provisionGateRef.current,
        { identity },
      );
      provisionGateRef.current = gate.next;
      if (!gate.allowed) {
        const retrySeconds = Math.max(1, Math.ceil(gate.retryAfterMs / 1_000));
        setDraftCollaboration({
          status: "error",
          identity,
          message: `공유 작업실 요청이 너무 잦아요. ${retrySeconds}초 뒤 다시 시도해 주세요.`,
        });
        return;
      }

      setDraftCollaboration({ status: "provisioning", identity, intent: "share-link" });
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
      if (controller.signal.aborted) return;
      const snapshotJson = JSON.stringify(getProjectSnapshot());
      const request = createStudioDraftCollaborationProvisionRequest({
        identity,
        actorAuthScopeKey,
        intent: "share-link",
        initialSnapshotByteLength: new TextEncoder().encode(snapshotJson).byteLength,
      });
      const room = await provisionCreatorDraftCollaborationRoom(request, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || provisionAbortRef.current !== controller) return;
      setDraftCollaboration({ status: "ready", identity, room });
      try {
        await copyShareLink(room.provisionalWorkId);
      } catch {
        announce("임시 팀 작업실이 준비됐습니다 · 팀 패널에서 멤버를 추가하세요");
      }
    } catch (cause) {
      if (controller.signal.aborted || provisionAbortRef.current !== controller) return;
      setDraftCollaboration({
        status: "error",
        identity,
        message: cause instanceof Error
          ? cause.message
          : "임시 협업 작업실을 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      });
    } finally {
      if (provisionAbortRef.current === controller) provisionAbortRef.current = null;
    }
  }

  return {
    draftCollaboration,
    draftCollaborationProvisionAbortRef: provisionAbortRef,
    requestStudioDraftCollaborationShare: requestShare,
    setDraftCollaboration,
  } as const;
}
