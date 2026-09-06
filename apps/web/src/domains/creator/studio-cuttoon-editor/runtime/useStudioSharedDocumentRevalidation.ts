import {
  useEffect,
  useEffectEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { isStudioEditorAsyncScopeCurrent } from "../../studio-editor-scope";

import type { StudioSharedDocument } from "../../studio-shared-document-client";

export interface StudioSharedDocumentScope {
  readonly authScopeKey: string;
  readonly workId: string;
  readonly value: StudioSharedDocument;
}

interface UseStudioSharedDocumentRevalidationOptions {
  readonly currentDocumentScopeRef: RefObject<{
    readonly authScopeKey: string | null;
    readonly workId: string | null;
  }>;
  readonly documentRevalidateAbortRef: RefObject<AbortController | null>;
  readonly editorMountedRef: RefObject<boolean>;
  readonly lockMutations: () => void;
  readonly reportError: (message: string) => void;
  readonly setSharedDocumentScope: Dispatch<SetStateAction<StudioSharedDocumentScope | null>>;
  readonly sharedDocument: StudioSharedDocument | null;
  readonly studioAuthUserId: string | null;
  readonly studioTeamCanComment: boolean;
  readonly workHydrated: boolean;
  readonly workId: string | null;
}

/**
 * Revalidates collaborative access on browser focus without silently advancing the document's
 * optimistic revision. Any ambiguous response fails closed to view-only and preserves local export.
 */
export function useStudioSharedDocumentRevalidation({
  currentDocumentScopeRef,
  documentRevalidateAbortRef,
  editorMountedRef,
  lockMutations,
  reportError,
  setSharedDocumentScope,
  sharedDocument,
  studioAuthUserId,
  studioTeamCanComment,
  workHydrated,
  workId,
}: UseStudioSharedDocumentRevalidationOptions): void {
  const lockMutationsEvent = useEffectEvent(lockMutations);
  const reportErrorEvent = useEffectEvent(reportError);

  useEffect(() => {
    if (!workHydrated || !workId || !studioAuthUserId || !sharedDocument) return;
    const requestScope = { authScopeKey: studioAuthUserId, workId };

    const revalidate = async (): Promise<void> => {
      documentRevalidateAbortRef.current?.abort();
      const controller = new AbortController();
      documentRevalidateAbortRef.current = controller;
      const requestIsCurrent = (): boolean =>
        isStudioEditorAsyncScopeCurrent(requestScope, {
          ...currentDocumentScopeRef.current,
          mounted: editorMountedRef.current,
          aborted: controller.signal.aborted,
        });

      try {
        const { getStudioSharedDocumentMeta } = await import("../../studio-shared-document-client");
        if (!requestIsCurrent()) return;
        const fresh = await getStudioSharedDocumentMeta(workId, controller.signal);
        if (!requestIsCurrent()) return;
        const revisionChanged = fresh.revision !== sharedDocument.revision;
        if (fresh.access !== "edit") lockMutationsEvent();
        setSharedDocumentScope((current) =>
          current
          && current.authScopeKey === requestScope.authScopeKey
          && current.workId === requestScope.workId
            ? {
                ...current,
                value: {
                  ...current.value,
                  role: fresh.role,
                  status: fresh.status,
                  capabilities: fresh.capabilities,
                  access: fresh.access,
                  // A remote revision must not silently become the optimistic local base. The next
                  // save keeps its conflict contract and requires an explicit reopen/merge.
                  ...(revisionChanged ? {} : { updatedAt: fresh.updatedAt }),
                },
              }
            : current,
        );
        if (fresh.access !== "edit") {
          reportErrorEvent(
            fresh.role === "commenter"
              ? studioTeamCanComment
                ? "검토 전용 권한으로 변경되었습니다. 원고 편집은 잠기지만 댓글 핀과 답글로 피드백을 계속 남길 수 있어요."
                : "검토 전용 권한으로 변경되었습니다. 원고와 댓글 작성은 읽기 전용이며 기존 피드백만 확인할 수 있어요."
              : "팀 편집 권한이 회수되었습니다. 로컬 변경은 JSON·이미지로 내보낼 수 있지만 서버에는 저장할 수 없어요.",
          );
        } else if (revisionChanged) {
          reportErrorEvent(
            "다른 팀원이 새 revision을 저장했습니다. 로컬 원고를 내보낸 뒤 공동 문서를 다시 열어 병합해 주세요.",
          );
        }
      } catch {
        if (!requestIsCurrent()) return;
        lockMutationsEvent();
        setSharedDocumentScope((current) =>
          current
          && current.authScopeKey === requestScope.authScopeKey
          && current.workId === requestScope.workId
            ? {
                ...current,
                value: {
                  ...current.value,
                  capabilities: { ...current.value.capabilities, edit: false },
                  access: "view",
                },
              }
            : current,
        );
        reportErrorEvent(
          "팀 권한을 다시 확인하지 못해 안전하게 읽기 전용으로 전환했습니다. 로컬 변경은 내보낸 뒤 다시 접속해 주세요.",
        );
      } finally {
        if (documentRevalidateAbortRef.current === controller) {
          documentRevalidateAbortRef.current = null;
        }
      }
    };

    const onFocus = (): void => void revalidate();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void revalidate();
    };
    globalThis.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      globalThis.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      documentRevalidateAbortRef.current?.abort();
    };
  }, [
    currentDocumentScopeRef,
    documentRevalidateAbortRef,
    editorMountedRef,
    setSharedDocumentScope,
    sharedDocument,
    studioAuthUserId,
    studioTeamCanComment,
    workHydrated,
    workId,
  ]);
}
