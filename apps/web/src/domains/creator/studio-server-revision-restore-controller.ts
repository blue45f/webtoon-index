import { studioServerRestoreCheckpointName } from "./studio-checkpoints";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";

import type { StudioEditorMutationTicket } from "./studio-editor-scope";
import type { StudioProjectFile } from "./studio-project-file";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type {
  WorkDetail,
  WorkRevisionSummary,
} from "@/src/infrastructure/creator-client";

interface StudioCurrentValue<T> {
  readonly current: T;
}

interface StudioMutableValue<T> {
  current: T;
}

interface StudioDocumentScope {
  readonly authScopeKey: string | null;
  readonly workId: string | null;
}

export interface StudioServerRevisionRestoreControllerInput {
  readonly revision: WorkRevisionSummary;
  readonly comparedBaseRevision: number;
  readonly workId: string | null;
  readonly studioAuthUserId: string | null;
  readonly serverCurrentRevision: number | undefined;
  readonly sharedDocumentRole: StudioSharedDocument["role"] | null;
  readonly serverRevisionLoading: boolean;
  readonly autosaveKey: string;
  readonly documentSaveInFlightRef: StudioMutableValue<boolean>;
  readonly studioRevisionProjectGenerationRef: StudioCurrentValue<number>;
  readonly sharedDocumentRestoreAbortRef: StudioMutableValue<AbortController | null>;
  readonly currentStudioDocumentScopeRef: StudioCurrentValue<StudioDocumentScope>;
  readonly editorMountedRef: StudioCurrentValue<boolean>;
  readonly isAsyncScopeCurrent: (
    request: StudioDocumentScope,
    current: StudioDocumentScope & {
      readonly mounted: boolean;
      readonly aborted: boolean;
    }
  ) => boolean;
  readonly isCuttoonSourceFormat: (format: unknown) => format is "cuttoon";
  readonly saveNamedCheckpoint: (name: string) => Promise<boolean>;
  readonly markStudioDocumentChanged: () => boolean;
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (
    ticket: StudioEditorMutationTicket,
    options?: { readonly allowDuringSave?: boolean },
  ) => boolean;
  readonly lockStudioMutationsNow: () => void;
  readonly applyStudioProjectSnapshot: (snapshot: StudioProjectFile) => Promise<boolean>;
  readonly reloadServerRevisions: () => Promise<void>;
  readonly setLoadedWork: (work: WorkDetail) => void;
  readonly setSharedDocumentScope: (scope: {
    readonly authScopeKey: string;
    readonly workId: string;
    readonly value: StudioSharedDocument;
  }) => void;
  readonly setDocumentReloadRequired: (required: boolean) => void;
  readonly setServerRevisionLoading: (loading: boolean) => void;
  readonly setServerRevisionError: (message: string | null) => void;
  readonly setHasAutosave: (hasAutosave: boolean) => void;
  readonly setAutosaveRestoreBlockedReason: (
    reason: "legacy-unversioned" | "work-mismatch" | "revision-mismatch" | null,
  ) => void;
  readonly setAutosaveChecked: (checked: boolean) => void;
}

/**
 * Restores a historical server revision as one fenced transaction.
 *
 * React continues to own state and mutable refs. This controller owns the destructive workflow:
 * pre-restore checkpointing, optimistic-concurrency commit, authoritative re-hydration, local
 * snapshot replacement, conflict recovery, autosave cleanup, and fail-closed mutation locking.
 */
export async function restoreStudioServerRevision({
  revision,
  comparedBaseRevision,
  workId,
  studioAuthUserId,
  serverCurrentRevision,
  sharedDocumentRole,
  serverRevisionLoading,
  autosaveKey,
  documentSaveInFlightRef,
  studioRevisionProjectGenerationRef,
  sharedDocumentRestoreAbortRef,
  currentStudioDocumentScopeRef,
  editorMountedRef,
  isAsyncScopeCurrent,
  isCuttoonSourceFormat,
  saveNamedCheckpoint,
  markStudioDocumentChanged,
  captureStudioMutationTicket,
  canApplyStudioMutation,
  lockStudioMutationsNow,
  applyStudioProjectSnapshot,
  reloadServerRevisions,
  setLoadedWork,
  setSharedDocumentScope,
  setDocumentReloadRequired,
  setServerRevisionLoading,
  setServerRevisionError,
  setHasAutosave,
  setAutosaveRestoreBlockedReason,
  setAutosaveChecked,
}: StudioServerRevisionRestoreControllerInput): Promise<boolean> {
  if (
    !workId
    || !serverCurrentRevision
    || sharedDocumentRole !== "owner"
    || serverRevisionLoading
  ) {
    return false;
  }
  if (revision.revision === serverCurrentRevision) {
    setServerRevisionError("현재 서버 revision은 다시 복원할 필요가 없어요.");
    return false;
  }
  if (comparedBaseRevision !== serverCurrentRevision) {
    setServerRevisionError("서버 revision이 변경 검토 후 달라졌어요. 최신 목록에서 다시 비교해 주세요.");
    return false;
  }

  const restoreWorkId = workId;
  const restoreAuthScopeKey = studioAuthUserId;
  if (documentSaveInFlightRef.current) {
    setServerRevisionError("다른 저장 또는 복원 작업이 끝난 뒤 다시 시도해 주세요.");
    return false;
  }
  const restorePreparationGeneration = studioRevisionProjectGenerationRef.current;
  if (!(await saveNamedCheckpoint(studioServerRestoreCheckpointName(revision.revision)))) {
    setServerRevisionError(
      "현재 편집본을 브라우저 복구 지점에 보관하지 못해 서버 복원을 시작하지 않았어요. 오래된 지점을 정리하거나 JSON 백업 후 다시 시도해 주세요.",
    );
    return false;
  }
  if (studioRevisionProjectGenerationRef.current !== restorePreparationGeneration) {
    setServerRevisionError(
      "브라우저 복구 지점을 저장하는 동안 원고가 변경되어 서버 복원을 시작하지 않았어요. 최신 상태로 다시 비교해 주세요.",
    );
    return false;
  }
  if (!markStudioDocumentChanged()) return false;

  documentSaveInFlightRef.current = true;
  const restoreMutationTicket = captureStudioMutationTicket();
  let serverRestoreCommitted = false;
  sharedDocumentRestoreAbortRef.current?.abort();
  const restoreController = new AbortController();
  sharedDocumentRestoreAbortRef.current = restoreController;
  const restoreScopeStillCurrent = () =>
    isAsyncScopeCurrent(
      { authScopeKey: restoreAuthScopeKey, workId: restoreWorkId },
      {
        ...currentStudioDocumentScopeRef.current,
        mounted: editorMountedRef.current,
        aborted: restoreController.signal.aborted,
      },
    );

  setServerRevisionLoading(true);
  setServerRevisionError(null);
  try {
    const [
      { getWork, restoreWorkRevision },
      { getStudioSharedDocument, isStudioSharedDocumentScopeCurrent },
    ] = await Promise.all([
      import("@/src/infrastructure/creator-client"),
      import("./studio-shared-document-client"),
    ]);
    if (
      !restoreScopeStillCurrent()
      || !canApplyStudioMutation(restoreMutationTicket, { allowDuringSave: true })
    ) {
      return false;
    }
    const committedRestore = await restoreWorkRevision(
      restoreWorkId,
      revision.revision,
      comparedBaseRevision,
      restoreController.signal,
    );
    const committedRevision = committedRestore.revision;
    if (
      typeof committedRevision !== "number"
      || !Number.isSafeInteger(committedRevision)
      || committedRevision < 1
    ) {
      throw new Error("서버가 복원 커밋 버전을 반환하지 않아 안전하게 적용할 수 없어요.");
    }
    serverRestoreCommitted = true;
    if (!restoreScopeStillCurrent()) return false;

    const [restoredWork, restoredShared] = await Promise.all([
      getWork(restoreWorkId, restoreController.signal),
      getStudioSharedDocument(restoreWorkId, restoreController.signal),
    ]);
    if (
      !restoreScopeStillCurrent()
      || !restoreAuthScopeKey
      || !isStudioSharedDocumentScopeCurrent(
        { authScopeKey: restoreAuthScopeKey, workId: restoreWorkId },
        currentStudioDocumentScopeRef.current,
      )
    ) {
      return false;
    }
    if (!canApplyStudioMutation(restoreMutationTicket, { allowDuringSave: true })) {
      lockStudioMutationsNow();
      setDocumentReloadRequired(true);
      setServerRevisionError(
        "서버 복원은 완료됐지만 로컬 상태가 달라 자동 적용하지 않았어요. 페이지를 다시 불러와 주세요.",
      );
      return false;
    }
    if (
      restoredWork.revision !== committedRevision
      || restoredShared.revision !== committedRevision
    ) {
      throw new Error(
        `복원은 서버 버전 r${committedRevision}로 기록됐지만 그 직후 공동 원고가 다시 변경됐어요. 최신 원고를 다시 열어 확인해 주세요.`,
      );
    }
    if (!isCuttoonSourceFormat(restoredWork.format)) {
      throw new Error("복원된 작품 형식은 컷툰 편집기와 호환되지 않아 자동 적용하지 않았어요.");
    }

    const restoredProject = creatorWorkSnapshotToStudioProject(restoredWork);
    const { hydrateStudioLinked3dPassCloudProject } = await import("./studio-linked-3d-pass-cloud-project"
    );
    documentSaveInFlightRef.current = false;
    const applied = await hydrateStudioLinked3dPassCloudProject({
      workId: restoreWorkId,
      project: restoredProject,
      signal: restoreController.signal,
      apply: async (candidate) => {
        if (
          !restoreScopeStillCurrent()
          || !canApplyStudioMutation(restoreMutationTicket)
        ) {
          return false;
        }
        return await applyStudioProjectSnapshot(candidate);
      },
    });
    if (!applied) {
      lockStudioMutationsNow();
      setDocumentReloadRequired(true);
      setServerRevisionError(
        "서버 복원은 완료됐지만 로컬 편집 상태가 달라 자동 적용하지 않았어요. 페이지를 다시 불러와 주세요.",
      );
      return false;
    }
    setLoadedWork(restoredWork);
    setSharedDocumentScope({
      authScopeKey: restoreAuthScopeKey,
      workId: restoreWorkId,
      value: restoredShared,
    });

    // The pre-restore named checkpoint now owns the old local state. Keeping an autosave whose
    // source revision is the replaced base would surface a false mismatch immediately.
    try {
      globalThis.localStorage.removeItem(autosaveKey);
    } catch {
      // The restore and named checkpoint are already durable; cleanup is best-effort.
    }
    setHasAutosave(false);
    setAutosaveRestoreBlockedReason(null);
    setAutosaveChecked(true);
    await reloadServerRevisions();
    return true;
  } catch (cause) {
    if (restoreScopeStillCurrent()) {
      const isRevisionConflict =
        cause instanceof Error
        && cause.name === "WorkRevisionConflictError"
        && typeof (cause as { currentRevision?: unknown }).currentRevision === "number";
      if (isRevisionConflict && !serverRestoreCommitted) {
        try {
          const { getStudioSharedDocument } = await import("./studio-shared-document-client");
          const latestShared = await getStudioSharedDocument(
            restoreWorkId,
            restoreController.signal,
          );
          if (restoreScopeStillCurrent() && restoreAuthScopeKey) {
            setSharedDocumentScope({
              authScopeKey: restoreAuthScopeKey,
              workId: restoreWorkId,
              value: latestShared,
            });
            setServerRevisionError(
              `다른 창이 서버 버전 r${latestShared.revision}을 먼저 저장했어요. 로컬 편집본은 보존했으며 최신 버전을 기준으로 다시 검토해 주세요.`,
            );
          }
        } catch {
          lockStudioMutationsNow();
          setDocumentReloadRequired(true);
          setServerRevisionError(
            "서버 버전 충돌 후 최신 원고를 확인하지 못해 편집을 잠갔어요. 페이지를 다시 불러와 주세요.",
          );
        }
      } else if (serverRestoreCommitted) {
        lockStudioMutationsNow();
        setDocumentReloadRequired(true);
        setServerRevisionError(
          cause instanceof Error
            ? cause.message
            : "서버 복원 후 최신 상태를 확인하지 못했어요.",
        );
      } else {
        setServerRevisionError(
          cause instanceof Error ? cause.message : "서버 버전을 복원하지 못했어요.",
        );
      }
    }
    return false;
  } finally {
    if (sharedDocumentRestoreAbortRef.current === restoreController) {
      sharedDocumentRestoreAbortRef.current = null;
    }
    documentSaveInFlightRef.current = false;
    if (editorMountedRef.current) setServerRevisionLoading(false);
  }
}
