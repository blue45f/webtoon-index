import { flushSync } from "react-dom";

import { projectStudioFilterMaskElementsForServerSave, projectStudioFilterMaskPagesForServerSave } from "./filter/studio-filter-mask-surface-projection";
import {
  StudioApiPayloadSafetyError,
  assertStudioApiJsonPayloadSize,
} from "./studio-api-payload-safety";
import { CANVAS_W } from "./studio-assets";
import {
  LEGACY_STUDIO_AUTOSAVE_KEY,
  studioLifecycleAutosaveSidecarKey,
} from "./studio-autosave";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import {
  invalidateStudioOwnerDetailAfterSharedSave,
  isStudioEditorAsyncScopeCurrent,
  type StudioEditorMutationTicket,
} from "./studio-editor-scope";
import { downscaleStudioCanvasDataUrl } from "./studio-legacy-editor-runtime-helpers";
import { serializeDocumentMaster, type DocumentMaster } from "./studio-master-page";
import {
  loadStudioSavePayloadRuntime,
  preloadStudioCaptureReadinessRuntime,
  preloadStudioSavePayloadRuntime,
} from "./studio-page-lazy-ui";
import { normalizePageReviewState } from "./studio-page-review";
import { withStudioLinked3dCloudSaveRecoveryState } from "./studio-page-shell-runtime";
import { validateStudioPublishPreflight } from "./studio-publish-preflight";
import { validateStudioWorkMetadata } from "./studio-work-metadata";

import type { StudioCrdtDocument } from "./live/studio-crdt-document";
import type { StudioCrdtAuthoritativeSaveBarrier } from "./live/StudioLiveCollaborationProvider";
import type { StudioDraftCollaborationReadiness } from "./studio-draft-collaboration";
import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";
import type {
  StudioPublishAiProvenance,
  StudioPublishPreflightInput,
} from "./studio-publish-preflight";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type { WorkDetail } from "@/src/infrastructure/creator-client";
import type Konva from "konva";
import type { Location, NavigateFunction } from "react-router-dom";

// 저장 DTO 빌더는 첫 화면에 필요 없는 사용자 의도 런타임이라 studio-save-payload 를 정적으로
// 참조하지 않는다 — 타입은 lazy 로더의 모듈 시그니처에서만 유도해 청크 경계를 그대로 지킨다.
type StudioSavePayloadRuntimeModule = Awaited<ReturnType<typeof loadStudioSavePayloadRuntime>>;
type StudioSaveDocumentInput = Parameters<
  StudioSavePayloadRuntimeModule["buildStudioSavePayload"]
>[0]["document"];
type StudioSavePublishPackInput = StudioSaveDocumentInput["publishPack"];

/** StudioPage 의 공동 문서 scope state 조각 — 저장 성공/실패 후 revision·권한 반영에 쓴다. */
export interface StudioPageSaveSharedDocumentScope {
  authScopeKey: string;
  workId: string;
  value: StudioSharedDocument;
}

/**
 * handleSave 오케스트레이션이 읽고 쓰는 StudioPage 소유 표면 전체. 값 필드는 호출 시점
 * 렌더의 최신 바인딩이고, ref 필드는 StudioPage 가 소유한 안정 ref 그대로다. scoped-async
 * 가드(saveScopeStillCurrent 의 scope ref·mounted ref·abort 판정, mutation ticket 발급/검증)는
 * 전부 이 deps 를 통해 원본과 동일한 대상을 읽는다 — 어느 하나라도 빠지면 라우트/계정 전환
 * 뒤 stale 저장 경쟁이 재발한다.
 */
export interface StudioPageSavePipelineDeps {
  // ── 인증·라우트 scope
  readonly studioAuthUserId: string | null;
  readonly workId: string | null;
  readonly remixId: string | null;
  readonly loggedIn: boolean;
  readonly autosaveKey: string;
  readonly linkedTitleId: string | null | undefined;
  readonly linkedSeriesId: string | null | undefined;
  readonly linkedChallengeId: string | null | undefined;
  readonly location: Location;
  readonly navigate: NavigateFunction;
  // ── scoped-async 가드 표면 (studio-editor-scope 계약)
  readonly currentStudioDocumentScopeRef: {
    readonly current: { readonly authScopeKey: string | null; readonly workId: string | null };
  };
  readonly editorMountedRef: { readonly current: boolean };
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (
    ticket: StudioEditorMutationTicket,
    options?: { allowDuringSave?: boolean }
  ) => boolean;
  readonly markStudioDocumentChanged: () => boolean;
  readonly lockStudioMutationsNow: () => void;
  readonly documentSaveInFlightRef: { current: boolean };
  // ── 공동 문서·CRDT 승인 경계
  readonly sharedDocument: StudioSharedDocument | null;
  readonly setSharedDocumentScope: (
    updater: (
      current: StudioPageSaveSharedDocumentScope | null
    ) => StudioPageSaveSharedDocumentScope | null
  ) => void;
  readonly collaborationDocumentLocked: boolean;
  readonly collaborationOperationSyncRequired: boolean;
  readonly collaborationLockMessage: () => string;
  readonly studioCrdtAuthoritativeSaveBarrierRef: {
    readonly current: StudioCrdtAuthoritativeSaveBarrier | null;
  };
  readonly studioCrdtDocumentRef: { readonly current: StudioCrdtDocument | null };
  readonly sharedDocumentSaveAbortRef: { current: AbortController | null };
  readonly ownerDetailAbortRef: { readonly current: AbortController | null };
  readonly setSharedDocumentNotice: (notice: string | null) => void;
  readonly setFxPanelOpen: (open: boolean) => void;
  // ── 문서 상태·히스토리
  readonly pages: PageState[];
  readonly pagesHistoryRef: { readonly current: PageState[][] };
  readonly pagesHiRef: { readonly current: number };
  readonly master: DocumentMaster<El>;
  readonly currentPageId: string;
  readonly setCurrentPageId: (next: string) => boolean;
  readonly masterEditMode: boolean;
  readonly setMasterEditMode: (next: boolean) => void;
  readonly pendingStrokeCommitsRef: { readonly current: object | null };
  readonly flushPendingStrokeCommitsRef: { readonly current: () => boolean };
  // ── 게시 preflight·컴플라이언스
  readonly publishProfile: StudioSavePublishPackInput["profile"];
  readonly publishAiUsage: StudioSavePublishPackInput["aiUsage"];
  readonly publishAiDisclosure: StudioSavePublishPackInput["disclosure"];
  readonly publishCompliance: StudioSavePublishPackInput["compliance"];
  readonly effectivePublishPackageSettings: StudioSavePublishPackInput["packageSettings"];
  readonly publishPackageCredits: StudioSavePublishPackInput["packageCredits"];
  readonly publishComplianceResult: {
    readonly readyForDestinationReview: boolean;
    readonly errors: readonly unknown[];
  };
  readonly collectPublishPreflightProvenance: (
    sourcePages: readonly PageState[]
  ) => StudioPublishAiProvenance[];
  readonly buildPublishPreflightInput: (
    provenance: readonly StudioPublishAiProvenance[],
    sourcePages: readonly PageState[]
  ) => StudioPublishPreflightInput;
  readonly setPageReviewOpen: (open: boolean) => void;
  readonly setPublishPreflightOpen: (open: boolean) => void;
  readonly openWorkMetadataStep: (status: "published" | "draft") => void;
  readonly clearPendingSaveIntent: () => void;
  // ── 캡처 파이프라인
  readonly captureReadyStageForPage: (page: PageState) => Promise<Konva.Stage>;
  readonly preserveStudioViewBeforeCapture: () => void;
  readonly hideStrokeGuide: () => void;
  readonly setIsExporting: (busy: boolean) => void;
  readonly setSelectedId: (next: null) => void;
  readonly effScale: number;
  // ── 저장 DTO 입력 (studio-save-payload 문서 스냅샷 필드)
  readonly title: string;
  readonly description: string;
  readonly tagsText: string;
  readonly characterBible: StudioSaveDocumentInput["characterBible"];
  readonly writerRoom: StudioSaveDocumentInput["writerRoom"];
  readonly aiProvenance: StudioSaveDocumentInput["aiProvenance"];
  readonly scenarioImageReferenceDocument: StudioSaveDocumentInput["aiImageReferences"];
  readonly studioComments: StudioSaveDocumentInput["comments"];
  readonly releaseSchedule: StudioSaveDocumentInput["releaseSchedule"];
  readonly publicationAnalytics: StudioSaveDocumentInput["publicationAnalytics"];
  readonly referenceBoard: StudioSaveDocumentInput["referenceBoard"];
  readonly webtoonTheme: StudioSaveDocumentInput["webtoonTheme"];
  readonly panelGutter: StudioSaveDocumentInput["panelGutter"];
  // ── 연결형 3D cloud-save·임시 협업실
  readonly draftCollaboration: StudioDraftCollaborationReadiness | null;
  readonly setDraftCollaboration: (next: StudioDraftCollaborationReadiness) => void;
  readonly draftCollaborationProvisionAbortRef: { current: AbortController | null };
  // ── 직접 저장 경로·서버 영수증
  readonly loadedWork: WorkDetail | null;
  readonly setLoadedWork: (
    updater: (current: WorkDetail | null) => WorkDetail | null
  ) => void;
  // ── 오토세이브 내구 권위·세대
  readonly clearAutosaveDurableAuthority: () => void;
  readonly studioLifecycleDurableGenerationRef: { current: number };
  readonly studioRevisionProjectGenerationRef: { readonly current: number };
  readonly studioLifecycleDurablePendingFingerprintRef: { current: string };
  // ── UI 상태
  readonly setSaving: (busy: boolean) => void;
  readonly setError: (message: string | null) => void;
}

/**
 * StudioPage handleSave 의 저장 오케스트레이션 본체 — StudioPage.tsx 에서 추출(2026-08, B-09).
 * 스냅샷/preflight/export 는 export/studio-publish-package-export.ts, 커밋 엔진은
 * studio-cuttoon-editor/studio-deferred-stroke-commit.ts 로 먼저 나갔고, 여기는 순서 계약만
 * 남는다: preflight → 이전 저장 abort → CRDT 승인 장벽(10s) → 페이지 캡처 → DTO 빌드 →
 * 공유/직접/연결형 3D 전송 → 내구 오토세이브 tombstone → navigate. 모든 단계 사이의
 * saveScopeStillCurrent()·canApplyStudioMutation(ticket, { allowDuringSave: true }) 가드와
 * revision fencing(수신 revision = baseRevision + 1 검증)은 원본 동작 그대로다.
 */
export async function runStudioPageSavePipeline(
  status: "published" | "draft",
  deps: StudioPageSavePipelineDeps
): Promise<void> {
  const {
    studioAuthUserId,
    workId,
    remixId,
    loggedIn,
    autosaveKey,
    linkedTitleId,
    linkedSeriesId,
    linkedChallengeId,
    location,
    navigate,
    currentStudioDocumentScopeRef,
    editorMountedRef,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    markStudioDocumentChanged,
    lockStudioMutationsNow,
    documentSaveInFlightRef,
    sharedDocument,
    setSharedDocumentScope,
    collaborationDocumentLocked,
    collaborationOperationSyncRequired,
    collaborationLockMessage,
    studioCrdtAuthoritativeSaveBarrierRef,
    studioCrdtDocumentRef,
    sharedDocumentSaveAbortRef,
    ownerDetailAbortRef,
    setSharedDocumentNotice,
    setFxPanelOpen,
    pages,
    pagesHistoryRef,
    pagesHiRef,
    master,
    currentPageId,
    setCurrentPageId,
    masterEditMode,
    setMasterEditMode,
    pendingStrokeCommitsRef,
    flushPendingStrokeCommitsRef,
    publishProfile,
    publishAiUsage,
    publishAiDisclosure,
    publishCompliance,
    effectivePublishPackageSettings,
    publishPackageCredits,
    publishComplianceResult,
    collectPublishPreflightProvenance,
    buildPublishPreflightInput,
    setPageReviewOpen,
    setPublishPreflightOpen,
    openWorkMetadataStep,
    clearPendingSaveIntent,
    captureReadyStageForPage,
    preserveStudioViewBeforeCapture,
    hideStrokeGuide,
    setIsExporting,
    setSelectedId,
    effScale,
    title,
    description,
    tagsText,
    characterBible,
    writerRoom,
    aiProvenance,
    scenarioImageReferenceDocument,
    studioComments,
    releaseSchedule,
    publicationAnalytics,
    referenceBoard,
    webtoonTheme,
    panelGutter,
    draftCollaboration,
    setDraftCollaboration,
    draftCollaborationProvisionAbortRef,
    loadedWork,
    setLoadedWork,
    clearAutosaveDurableAuthority,
    studioLifecycleDurableGenerationRef,
    studioRevisionProjectGenerationRef,
    studioLifecycleDurablePendingFingerprintRef,
    setSaving,
    setError,
  } = deps;
  const saveAuthScopeKey = studioAuthUserId;
  const saveWorkScope = workId;
  let saveSignal: AbortSignal | null = null;
  const saveScopeStillCurrent = () =>
    isStudioEditorAsyncScopeCurrent(
      { authScopeKey: saveAuthScopeKey, workId: saveWorkScope },
      {
        ...currentStudioDocumentScopeRef.current,
        mounted: editorMountedRef.current,
        aborted: saveSignal?.aborted === true,
      }
    );
  if (!loggedIn) {
    setError(
      status === "draft"
        ? "로그인 후 서버 초안으로 저장할 수 있어요."
        : "로그인 후 게시할 수 있어요."
    );
    return;
  }
  if (collaborationDocumentLocked) {
    setError(collaborationLockMessage());
    return;
  }
  if (documentSaveInFlightRef.current) return;
  if (status === "published" && sharedDocument && sharedDocument.role !== "owner") {
    setError("공동 편집자는 원고 내용만 저장할 수 있어요. 게시 상태 변경은 작품 소유자에게 요청해 주세요.");
    return;
  }
  const metadataError = validateStudioWorkMetadata({ title, description, tagsText });
  if (metadataError) {
    setError(metadataError);
    openWorkMetadataStep(status);
    return;
  }
  // 저장 DTO와 캡처 준비 검사는 첫 화면에 필요 없는 사용자 의도 런타임이다. 캡처가 시작되기
  // 전에 두 요청을 함께 데워 첫 저장에서 순차 import waterfall이 생기지 않게 한다.
  preloadStudioCaptureReadinessRuntime();
  preloadStudioSavePayloadRuntime();
  // A deferred stroke is still outside React history. Flush it before installing the save lock;
  // otherwise `commit` correctly rejects the flush and the server doc/images diverge. flushSync
  // also gives the capture stage the projected page before the first screenshot is requested.
  if (pendingStrokeCommitsRef.current) {
    flushSync(() => {
      flushPendingStrokeCommitsRef.current();
    });
    if (pendingStrokeCommitsRef.current) {
      setError(
        "마지막 획을 원고에 확정하지 못해 저장을 시작하지 않았어요. 잠금·동기화 상태를 확인한 뒤 다시 시도해 주세요."
      );
      return;
    }
  }
  const saveHistory = pagesHistoryRef.current;
  const saveHistoryIndex = Math.max(
    0,
    Math.min(pagesHiRef.current, Math.max(0, saveHistory.length - 1))
  );
  const savePages = saveHistory[saveHistoryIndex] ?? pages;
  if (
    status === "published" &&
    savePages.some((page) => normalizePageReviewState(page.review).status === "changes-requested")
  ) {
    clearPendingSaveIntent();
    setError("수정 요청 상태인 페이지가 있어 게시할 수 없어요. 검토 메모를 반영한 뒤 상태를 변경해 주세요.");
    setPageReviewOpen(true);
    return;
  }
  if (status === "published") {
    const structuralResult = validateStudioPublishPreflight(
      buildPublishPreflightInput(
        collectPublishPreflightProvenance(savePages),
        savePages
      ),
      publishProfile
    );
    if (!structuralResult.canPublish || !publishComplianceResult.readyForDestinationReview) {
      const blockedCount = structuralResult.errors.length + publishComplianceResult.errors.length;
      clearPendingSaveIntent();
      setError(`게시 전 필수 점검 ${blockedCount}개를 확인해 주세요.`);
      setPublishPreflightOpen(true);
      return;
    }
  }
  sharedDocumentSaveAbortRef.current?.abort();
  const saveController = new AbortController();
  sharedDocumentSaveAbortRef.current = saveController;
  saveSignal = saveController.signal;
  // 이미 진행 중인 AI/PSD/pixel continuation을 저장 스냅샷과 경쟁하지 못하게 세대 장벽을 세운다.
  if (!markStudioDocumentChanged()) return;
  // 메타데이터 단계의 CTA는 저장 중 중복 제출을 막기 위해 닫는다. 아래 catch에서는 같은
  // draft/published 의도를 다시 열어 API·캡처 실패 뒤 사용자가 상단 버튼을 찾지 않아도 된다.
  clearPendingSaveIntent();
  documentSaveInFlightRef.current = true;
  const saveMutationTicket = captureStudioMutationTicket();
  preserveStudioViewBeforeCapture();
  setSaving(true);
  setError(null);
  setSharedDocumentNotice(null);
  setSelectedId(null);
  const originalPageId = currentPageId;
  const originalMasterEditMode = masterEditMode;
  setMasterEditMode(false);
  preserveStudioViewBeforeCapture();
  hideStrokeGuide();
  setIsExporting(true);
  let authoritativeCrdtServerSequence: string | null = null;
  let linkedCloudUploadWorkId: string | null = null;
  let linkedCloudUploadReceipts: Awaited<ReturnType<
    typeof import("./studio-linked-3d-pass-cloud-project").ensureStudioLinked3dPassCloudProject
  >> = [];
  let linkedCloudSaveCommitted = false;
  try {
    if (collaborationOperationSyncRequired) {
      const authoritativeSaveBarrier = studioCrdtAuthoritativeSaveBarrierRef.current;
      if (!authoritativeSaveBarrier) {
        throw new Error(
          "팀 원고의 서버 승인 경계가 준비되지 않아 저장을 시작하지 않았습니다. 연결을 확인해 주세요."
        );
      }
      setSharedDocumentNotice("대기 중인 공동 편집 변경을 서버에 승인받은 뒤 저장합니다.");
      const barrierResult = await authoritativeSaveBarrier(10_000);
      authoritativeCrdtServerSequence = barrierResult.serverSequence;
      if (!saveScopeStillCurrent()) return;
      if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })) {
        throw new Error(
          "서버 승인 중 원고가 변경되어 저장을 중단했습니다. 최신 원고를 확인한 뒤 다시 저장해 주세요."
        );
      }
      setSharedDocumentNotice(null);
    }
    // Render-only Blob URLs never cross the canonical save boundary. Once a referenced
    // immutable mask is present in the exact CRDT raster registry (and, for shared documents,
    // the authoritative barrier above has acknowledged the registry), its inline data-URL
    // fallback is redundant and deliberately omitted. Local/unpublished masks retain the
    // fallback so an unsaved document remains portable.
    const crdtDocumentAtSave = studioCrdtDocumentRef.current;
    const isDurableFilterMaskSurface = (surfaceId: string) =>
      (crdtDocumentAtSave?.getRasterOperationLog(surfaceId) ?? null) !== null;
    const serverSavePages = projectStudioFilterMaskPagesForServerSave(
      savePages,
      isDurableFilterMaskSurface
    );
    const serverSaveMaster: DocumentMaster<El> = {
      ...master,
      elements: projectStudioFilterMaskElementsForServerSave(
        master.elements,
        isDurableFilterMaskSurface
      ),
    };
    const pageImages: string[] = [];

    for (const page of savePages) {
      if (!saveScopeStillCurrent()) return;
      setCurrentPageId(page.id);
      const stage = await captureReadyStageForPage(page);
      if (!saveScopeStillCurrent()) return;
      const dataUrl = stage.toDataURL({ pixelRatio: 1 / effScale });
      pageImages.push(dataUrl);
    }

    // API 저장이 이어지는 동안 사용자가 보던 페이지를 먼저 복구한다. 캡처 준비 게이트가 이미
    // 모든 픽셀을 pageImages에 고정했으므로 여기서는 추가 sleep이 필요 없다.
    setCurrentPageId(originalPageId);
    setMasterEditMode(originalMasterEditMode);

    const cover = await downscaleStudioCanvasDataUrl(pageImages[0] || "", 480);
    const {
      buildStudioDirectWorkSavePlan,
      buildStudioSavePayload,
      buildStudioSharedSavePatch,
    } = await loadStudioSavePayloadRuntime();
    if (!saveScopeStillCurrent()) return;
    const payload = buildStudioSavePayload({
      title,
      description,
      tagsText,
      linkedTitleId,
      cover,
      pageImages,
      document: {
        // 연출(fx) 등 다른 owner 도구가 저장한 확장 키를 보존하고, 스튜디오 소유 키만 덮어쓴다.
        extensionBase: sharedDocument?.document.doc ?? loadedWork?.doc,
        width: CANVAS_W,
        pagesList: serverSavePages,
        // 비어 있는 마스터는 undefined여서 JSON 직렬화 시 키가 떨어진다(하위호환).
        master: serializeDocumentMaster(serverSaveMaster),
        characterBible,
        writerRoom,
        aiProvenance,
        aiImageReferences: scenarioImageReferenceDocument,
        comments: studioComments,
        releaseSchedule,
        publicationAnalytics,
        referenceBoard,
        currentPageId,
        webtoonTheme,
        panelGutter,
        publishPack: {
          profile: publishProfile,
          aiUsage: publishAiUsage,
          disclosure: publishAiDisclosure,
          compliance: publishCompliance,
          packageSettings: effectivePublishPackageSettings,
          packageCredits: publishPackageCredits,
        },
      },
      status,
      workId,
      remixId,
      linkedSeriesId,
      linkedChallengeId,
    });
    let savedWorkId: string;
    let keepSharedEditorOpen = false;
    let stagedLinkedNewWork: {
      readonly outcome: "promoted" | "recovered-existing";
      readonly revision: number | null;
      readonly workId: string;
    } | null = null;
    if (!saveScopeStillCurrent()) return;
    if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })) return;
    if (serverSavePages.some((page) => page.linked3dRender !== undefined)) {
      const canonicalSaveProject = creatorWorkSnapshotToStudioProject(payload);
      const { ensureStudioLinked3dPassCloudProject } = await import("./studio-linked-3d-pass-cloud-project"
      );
      if (workId) {
        linkedCloudUploadReceipts = await ensureStudioLinked3dPassCloudProject({
          workId,
          project: canonicalSaveProject,
          signal: saveController.signal,
        });
        linkedCloudUploadWorkId = workId;
      } else {
        if (!saveAuthScopeKey) {
          throw new Error("연결형 3D cloud-save 소유자 범위를 확인하지 못했습니다.");
        }
        if (
          remixId
          || (payload.remixFromId !== undefined && payload.remixFromId !== null)
        ) {
          throw new Error(
            "연결형 3D 리믹스 신규 저장은 원본 provenance를 원자 승격할 수 없어 지원하지 않습니다.",
          );
        }
        let draftIdentity = draftCollaboration?.identity;
        if (!draftIdentity) {
          const { loadOrCreateStudioDraftCollaborationIdentity } = await import("./studio-draft-collaboration"
          );
          draftIdentity = await loadOrCreateStudioDraftCollaborationIdentity({
            documentScopeKey: autosaveKey,
            ownerScopeKey: saveAuthScopeKey,
          });
        }
        draftCollaborationProvisionAbortRef.current?.abort();
        draftCollaborationProvisionAbortRef.current = null;
        setDraftCollaboration({
          status: "provisioning",
          identity: draftIdentity,
          intent: "cloud-save",
        });
        try {
          const [
            { saveStudioLinked3dNewWorkThroughCloudRoom },
            {
              promoteCreatorDraftCollaborationRoom,
              provisionCreatorDraftCollaborationRoom,
            },
            { getWork, updateWork },
            { retireStudioDraftCollaborationIdentity },
          ] = await Promise.all([
            import("./studio-linked-3d-new-work-cloud-save"),
            import("./creator-draft-collaboration-client"),
            import("@/src/infrastructure/creator-client"),
            import("./studio-draft-collaboration"),
          ]);
          const directSavePlan = buildStudioDirectWorkSavePlan({
            payload,
            workId: null,
            baseRevision: undefined,
          });
          if (directSavePlan.kind !== "create") {
            throw new Error("새 작품 cloud-save 계획이 create 경계와 일치하지 않습니다.");
          }
          const cloudSaveResult = await saveStudioLinked3dNewWorkThroughCloudRoom({
            actorAuthScopeKey: saveAuthScopeKey,
            assertFresh: () => {
              if (
                !saveScopeStillCurrent()
                || !canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })
              ) {
                throw new DOMException("The Studio document changed during cloud save.", "AbortError");
              }
            },
            createPayload: directSavePlan.payload,
            dependencies: {
              ensureCloudArtifacts: async (provisionalWorkId, signal) => {
                return await ensureStudioLinked3dPassCloudProject({
                  workId: provisionalWorkId,
                  project: canonicalSaveProject,
                  signal,
                });
              },
              compensateCloudArtifacts: async (provisionalWorkId, receipts) => {
                const { compensateStudioLinked3dPassCloudUploads } = await import("./studio-linked-3d-pass-cloud-sync"
                );
                await compensateStudioLinked3dPassCloudUploads({
                  workId: provisionalWorkId,
                  receipts,
                });
              },
              inspectWorkRevision: async (provisionalWorkId, signal) => {
                const staged = await getWork(provisionalWorkId, signal);
                if (staged.id !== provisionalWorkId) {
                  throw new Error("임시 cloud-save 작품 조회 영수증의 작품 ID가 다릅니다.");
                }
                return staged.revision ?? 0;
              },
              promote: promoteCreatorDraftCollaborationRoom,
              provision: provisionCreatorDraftCollaborationRoom,
              retireIdentity: retireStudioDraftCollaborationIdentity,
              updateWork: async (provisionalWorkId, stagedPayload, signal) => {
                assertStudioApiJsonPayloadSize(stagedPayload);
                const staged = await updateWork(provisionalWorkId, stagedPayload, signal);
                if (staged.id !== provisionalWorkId) {
                  throw new Error("임시 cloud-save 작품 저장 영수증의 작품 ID가 다릅니다.");
                }
                return staged.revision ?? 0;
              },
            },
            finalStatus: status,
            identity: draftIdentity,
            initialSnapshotByteLength: new TextEncoder().encode(
              JSON.stringify(canonicalSaveProject),
            ).byteLength,
            signal: saveController.signal,
          });
          stagedLinkedNewWork = {
            outcome: cloudSaveResult.outcome,
            revision: cloudSaveResult.revision,
            workId: cloudSaveResult.workId,
          };
          setDraftCollaboration({
            status: "ready",
            identity: draftIdentity,
            room: cloudSaveResult.room,
          });
        } catch (cause) {
          if (saveScopeStillCurrent()) {
            setDraftCollaboration({
              status: "error",
              identity: draftIdentity,
              message: cause instanceof Error
                ? cause.message
                : "연결형 3D cloud-save 작업실을 준비하지 못했습니다.",
            });
          }
          throw cause;
        }
      }
      // Upload completion is not permission to save an older snapshot. Immutable hash-derived
      // rows remain reusable, while a stale route/document must stop before either PATCH starts.
      if (!saveScopeStillCurrent()) return;
      if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })) return;
    }
    if (stagedLinkedNewWork) {
      savedWorkId = stagedLinkedNewWork.workId;
    } else if (workId && sharedDocument) {
      const {
        isStudioSharedDocumentScopeCurrent,
        updateStudioSharedDocument,
      } = await import("./studio-shared-document-client");
      if (
        !saveAuthScopeKey ||
        !saveScopeStillCurrent() ||
        !canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })
      ) return;
      if (authoritativeCrdtServerSequence === null) {
        throw new Error(
          "팀 원고의 CRDT 서버 순번을 확인하지 못해 저장을 시작하지 않았습니다."
        );
      }
      const sharedPatch = buildStudioSharedSavePatch({
        payload,
        baseRevision: sharedDocument.revision,
        crdtServerSequence: authoritativeCrdtServerSequence,
        role: sharedDocument.role,
      });
      assertStudioApiJsonPayloadSize(sharedPatch);
      const saved = await updateStudioSharedDocument(
        workId,
        sharedDocument.role,
        sharedPatch,
        saveController.signal
      );
      linkedCloudSaveCommitted = true;
      if (
        !saveScopeStillCurrent() ||
        !isStudioSharedDocumentScopeCurrent(
          { authScopeKey: saveAuthScopeKey, workId },
          currentStudioDocumentScopeRef.current
        )
      ) {
        return;
      }
      savedWorkId = saved.workId;
      keepSharedEditorOpen = sharedDocument.role !== "owner";
      setSharedDocumentScope((current) =>
        current &&
        current.authScopeKey === studioAuthUserId &&
        current.workId === workId
          ? {
              ...current,
              value: {
                ...current.value,
                revision: saved.revision,
                updatedAt: saved.updatedAt,
                document: {
                  ...current.value.document,
                  title: payload.title,
                  description: payload.description,
                  tags: payload.tags,
                  cover: payload.cover,
                  pages: payload.pages,
                  doc: payload.doc,
                  ...(sharedDocument.role === "owner" ? { status: payload.status } : {}),
                },
              },
            }
          : current
      );
      // owner detail에는 FX가 쓰는 전체 doc이 들어간다. revision 숫자만 전진시키면 다음 FX 저장이
      // 오래된 doc을 최신 baseRevision으로 덮을 수 있으므로 캐시를 폐기하고 다음 open에서 재조회한다.
      ownerDetailAbortRef.current?.abort();
      setFxPanelOpen(false);
      setLoadedWork(invalidateStudioOwnerDetailAfterSharedSave);
      setSharedDocumentNotice(
        status === "published"
          ? `공동 문서 revision ${saved.revision}로 게시 상태를 저장했습니다.`
          : `공동 문서 revision ${saved.revision}로 저장했습니다.`
      );
    } else {
      const { createWork, updateWork } = await import("@/src/infrastructure/creator-client");
      if (
        !saveScopeStillCurrent() ||
        !canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })
      ) return;
      const directSavePlan = buildStudioDirectWorkSavePlan({
        payload,
        workId,
        baseRevision: loadedWork?.revision,
      });
      let work: Awaited<ReturnType<typeof createWork>>;
      if (directSavePlan.kind === "update") {
        assertStudioApiJsonPayloadSize(directSavePlan.payload);
        work = await updateWork(
          directSavePlan.workId,
          directSavePlan.payload,
          saveController.signal,
        );
        const receivedRevision = work.revision;
        if (
          work.id !== directSavePlan.workId
          || !Number.isSafeInteger(receivedRevision)
          || (receivedRevision ?? 0) < 1
          || (
            directSavePlan.payload.baseRevision !== undefined
            && receivedRevision !== directSavePlan.payload.baseRevision + 1
          )
        ) {
          throw new Error("작품 저장 영수증의 ID·revision이 요청과 일치하지 않습니다.");
        }
        linkedCloudSaveCommitted = true;
      } else {
        assertStudioApiJsonPayloadSize(directSavePlan.payload);
        work = await createWork(directSavePlan.payload, saveController.signal);
      }
      if (!saveScopeStillCurrent()) return;
      savedWorkId = work.id;
      if (workId && work.revision) {
        setLoadedWork((current) => current ? { ...current, revision: work.revision } : current);
      }
    }

    if (!canApplyStudioMutation(saveMutationTicket, { allowDuringSave: true })) {
      setError("저장 요청 중 원고가 바뀌어 현재 로컬 변경을 유지했습니다. 내용을 확인한 뒤 다시 저장해 주세요.");
      return;
    }

    if (stagedLinkedNewWork?.outcome === "recovered-existing") {
      // The promoted-room receipt identifies a prior successful save, but there is no exact
      // payload fingerprint proving that it contains this tab's current draft. Keep every local
      // autosave authority intact and open the existing work with an explicit recovery notice.
      navigate(`/create/${stagedLinkedNewWork.workId}`, {
        state: withStudioLinked3dCloudSaveRecoveryState(
          location.state,
          stagedLinkedNewWork.workId,
        ),
      });
      return;
    }

    clearAutosaveDurableAuthority();
    try {
      localStorage.removeItem(autosaveKey);
      localStorage.removeItem(studioLifecycleAutosaveSidecarKey(autosaveKey));
      if (!workId && !remixId) localStorage.removeItem(LEGACY_STUDIO_AUTOSAVE_KEY);
      studioLifecycleDurableGenerationRef.current =
        studioRevisionProjectGenerationRef.current;
      studioLifecycleDurablePendingFingerprintRef.current = "";
    } catch {
      // 무시
    }

    if (!keepSharedEditorOpen) navigate(`/create/${savedWorkId}`);
  } catch (err) {
    if (saveScopeStillCurrent()) {
      let message = err instanceof Error ? err.message : "저장에 실패했어요.";
      if (
        !(err instanceof StudioApiPayloadSafetyError) &&
        sharedDocument &&
        workId &&
        saveAuthScopeKey
      ) {
        try {
          const { getStudioSharedDocumentMeta } = await import("./studio-shared-document-client");
          const fresh = await getStudioSharedDocumentMeta(workId, saveController.signal);
          if (saveScopeStillCurrent()) {
            if (fresh.access !== "edit") lockStudioMutationsNow();
            setSharedDocumentScope((current) =>
              current &&
              current.authScopeKey === saveAuthScopeKey &&
              current.workId === workId
                ? {
                    ...current,
                    value: {
                      ...current.value,
                      role: fresh.role,
                      status: fresh.status,
                      capabilities: fresh.capabilities,
                      access: fresh.access,
                    },
                  }
                : current
            );
            if (fresh.access !== "edit") {
              message = "팀 편집 권한이 변경되어 서버 저장을 중단했습니다. 로컬 변경은 내보낸 뒤 소유자에게 전달해 주세요.";
            }
          }
        } catch {
          if (saveScopeStillCurrent()) {
            lockStudioMutationsNow();
            setSharedDocumentScope((current) =>
              current &&
              current.authScopeKey === saveAuthScopeKey &&
              current.workId === workId
                ? {
                    ...current,
                    value: {
                      ...current.value,
                      capabilities: { ...current.value.capabilities, edit: false },
                      access: "view",
                    },
                  }
                : current
            );
            message = "팀 권한을 확인하지 못해 안전하게 읽기 전용으로 전환했습니다. 로컬 변경을 내보낸 뒤 다시 접속해 주세요.";
          }
        }
      }
      if (saveScopeStillCurrent()) {
        setError(message);
        openWorkMetadataStep(status);
      }
    }
  } finally {
    if (
      !linkedCloudSaveCommitted
      && linkedCloudUploadWorkId
      && linkedCloudUploadReceipts.length > 0
    ) {
      try {
        const { compensateStudioLinked3dPassCloudUploads } = await import("./studio-linked-3d-pass-cloud-sync"
        );
        await compensateStudioLinked3dPassCloudUploads({
          workId: linkedCloudUploadWorkId,
          receipts: linkedCloudUploadReceipts,
        });
      } catch {
        if (saveScopeStillCurrent()) {
          setError(
            "저장은 중단했지만 업로드된 3D pass 정리를 완료하지 못했습니다. 다음 저장에서 같은 영수증으로 다시 확인해 주세요."
          );
        }
      }
    }
    if (sharedDocumentSaveAbortRef.current === saveController) {
      sharedDocumentSaveAbortRef.current = null;
    }
    documentSaveInFlightRef.current = false;
    if (editorMountedRef.current) {
      setCurrentPageId(originalPageId);
      setMasterEditMode(originalMasterEditMode);
      setSaving(false);
      setIsExporting(false);
    }
  }
}
