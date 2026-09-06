import { X } from "lucide-react";
import {
  Suspense,
  memo,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import { createEmptyStudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import { selectWheelColors } from "./studio-color-wheel";
import {
  StudioAiProvenancePanel,
  StudioAutoActionsPanel,
  StudioCharacterBiblePanel,
  StudioCheckpointPanel,
  StudioColorWheelOverlay,
  StudioCommentsPanelSession,
  StudioContinuityPanel,
  StudioProductionInsightsPanel,
  StudioPublicationOperationsPanel,
  StudioPublishPackagePanel,
  StudioPublishPreflightPanel,
  StudioReferencePanel,
  StudioTeamPanel,
  StudioWriterRoomPanel,
  WorkFxPanel,
} from "./studio-page-lazy-ui";
import { pageDisplayName } from "./studio-page-meta";
import { parseStudioProjectFile } from "./studio-project-file";
import { normalizeStudioPublishCompliance } from "./studio-publish-compliance";
import { StudioDocumentRuntimeContext } from "./studio-router/studio-document-runtime-context";
import { normalizeStudioWriterRoomDocument } from "./studio-writer-room";
import {
  StudioScrollScenarioPreviewPanelStack,
  StudioThreeDPreviewPanelStack,
} from "./StudioThreeDPreviewPanelStack";

import type { StudioAiSettings, StudioTextAiProvenance } from "./ai/studio-ai-client";
import type { StudioAiImageReferenceDocument } from "./ai/studio-ai-image-reference-roles";
import type { StudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import type { StudioAiImageReferenceAssetOption } from "./ai/StudioAiImageReferencePackEditor";
import type { StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import type { StudioBg3dShotBatchRecoveryScope } from "./bg3d/studio-bg3d-shot-batch-plan";
import type { MotionCutImage } from "./export/studio-motion-export";
import type {
  StudioBg3dAiMethodReferenceCapture,
} from "./scene-3d/studio-3d-ai-reference-handoff";
import type {
  StudioBg3dInsertHandler,
  StudioVrmInsertHandler,
} from "./scene-3d/studio-3d-insert-controller";
import type {
  StudioAutoActionExecutionProgress,
  StudioAutoActionPlan,
  StudioAutoActionScope,
  StudioAutoActionSet,
} from "./studio-auto-actions";
import type { StudioCharacterBible } from "./studio-character-bible";
import type { StudioCheckpoint } from "./studio-checkpoints";
import type {
  StudioCommentActor,
  StudioCommentAnchor,
  StudioCommentsDocument,
} from "./studio-comments";
import type {
  StudioContinuityIssue,
  StudioStoryBeat,
} from "./studio-continuity";
import type { StudioDraftCollaborationReadiness } from "./studio-draft-collaboration";
import type { Tool } from "./studio-editor-tool-model";
import type { El } from "./studio-element-model";
import type { StudioMacroSession } from "./studio-macro-recorder";
import type { StudioPageDnd } from "./studio-page-dnd";
import type { PageReviewState } from "./studio-page-review";
import type { PageState } from "./studio-page-state";
import type { StudioProductionInsights } from "./studio-production-insights";
import type {
  StudioPublicationAnalyticsDocument,
} from "./studio-publication-analytics";
import type {
  StudioPublishComplianceChecklist,
  StudioPublishComplianceResult,
} from "./studio-publish-compliance";
import type {
  StudioPublishPackagePlan,
  StudioPublishPackageSettings,
} from "./studio-publish-package";
import type {
  StudioPublishAiUsage,
  StudioPublishPreflightResult,
  StudioPublishProfile,
} from "./studio-publish-preflight";
import type {
  StudioQuickActionId,
  StudioQuickActionsPreferences,
} from "./studio-quick-actions";
import type { StudioReferenceBoardDocument } from "./studio-reference-board";
import type { StudioReleaseSchedule } from "./studio-release-schedule";
import type { ScenarioPreviewItem } from "./studio-scenario-layout";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type { ScenarioBeatType } from "./studio-story-beats";
import type { StudioTeamCommentCapabilities } from "./studio-team-comment-client";
import type {
  StudioWriterRoomDocument,
  StudioWriterRoomStage,
} from "./studio-writer-room";
import type { StudioWriterRoomCanvasProjectionResult } from "./studio-writer-room-canvas-projection";
import type { StudioCommentsPanelSharedReplyController } from "./StudioCommentsPanel";
import type {
  WorkDetail,
  WorkRevisionSummary,
} from "@/src/infrastructure/creator-client";

interface StudioLazyContinuityScene {
  id: string;
  frameId: string;
  pageId: string;
  label: string;
  beat: StudioStoryBeat;
}

interface StudioLazyScenarioResult {
  items: ScenarioPreviewItem[];
  nextCanvasH: number;
  characterDescription: string;
  textAiProvenance: StudioTextAiProvenance;
}

interface StudioLazyWriterRoomAiReview {
  stage: StudioWriterRoomStage;
  rationale: string;
  draft: unknown;
  textProvenance: StudioTextAiProvenance;
}

interface StudioLazySharedDocumentScope {
  authScopeKey: string;
  workId: string;
  value: StudioSharedDocument;
}

export interface StudioLazyPanelStackHandlers {
  addPage: () => void;
  applyStudioCommentsPanelChange: (value: StudioCommentsDocument) => Promise<boolean>;
  markAllStudioCommentThreadsRead: () => Promise<boolean>;
  markStudioCommentThreadRead: (threadId: string) => Promise<boolean>;
  refreshStudioTeamComments: () => void;
  applyWriterRoomAiReview: () => void;
  applyWriterRoomCanvasPlan: () => void;
  cancelAutoAction: () => void;
  cancelWriterRoomAi: () => void;
  captureTimelapseStep: (historyIndex: number, targetWidth: number) => Promise<MotionCutImage>;
  changeAutoActionScope: (scope: StudioAutoActionScope) => void;
  changeAutoActionSelectedPages: (pageIds: readonly string[]) => void;
  commitShotTag: (pageId: string, patch: { shotType?: string | null; cameraAngle?: string | null; }) => void;
  createNamedCheckpoint: (name: string) => void;
  currentStudioProjectSnapshot: () => unknown;
  deletePage: (pageId: string) => void;
  disarmAllPixelTools: () => void;
  downloadAiPublicSummary: (summary: unknown) => Promise<void>;
  downloadPublishPackageManifest: () => Promise<void>;
  downloadPublishPreflightReport: () => Promise<void>;
  duplicatePage: (pageId: string) => void;
  executeAutoAction: () => Promise<void>;
  executePublishPackageExport: () => Promise<void>;
  executeQuickAction: (action: StudioQuickActionId) => void;
  exportAutoActionJson: () => Promise<void>;
  handleTimelapseRecordingEnd: () => void;
  handleTimelapseRecordingStart: () => void;
  importAutoActionJson: (json: string, fileName: string) => Promise<void>;
  insertBg3dResult: StudioBg3dInsertHandler;
  insertVrmResult: StudioVrmInsertHandler;
  useBg3dFrameAsAiMethodReference: (
    capture: StudioBg3dAiMethodReferenceCapture
  ) => boolean | void | Promise<boolean | void>;
  insertMannequinResult: (
    result: { pngDataUrl: string; width: number; height: number; displayWidth?: number; displayHeight?: number }
  ) => boolean | void | Promise<boolean | void>;
  onApplyScenarioPreview: () => void;
  onCancelScenario: () => void;
  onChangeScenarioScene: (index: number, patch: { beatType?: ScenarioBeatType; summary?: string; imagePrompt?: string; dialogue?: string; continuity?: ScenarioPreviewItem["continuity"]; }) => void;
  onDiscardScenarioPreview: () => void;
  onGenerateScenario: () => void;
  onGenerateScenarioImages: () => void;
  onRegenerateScenarioImage: (index: number) => void;
  onRemoveScenarioScene: (index: number) => void;
  onScenarioApplyTargetChange: (target: "current-page" | "new-page") => void;
  patchPageReview: (pageId: string, patch: Partial<Omit<PageReviewState, "updatedAt">>) => void;
  planAutoAction: () => Promise<void>;
  reloadServerRevisions: () => Promise<void>;
  rememberColor: (c: string) => void;
  removeNamedCheckpoint: (checkpoint: StudioCheckpoint) => Promise<void>;
  requestStudioDraftCollaborationShare: () => Promise<void> | void;
  requestWriterRoomAiDraft: (stage: StudioWriterRoomStage) => Promise<void>;
  restoreNamedCheckpoint: (checkpoint: StudioCheckpoint) => Promise<void>;
  restoreServerRevision: (revision: WorkRevisionSummary, comparedBaseRevision: number) => Promise<boolean>;
  selectStudioCommentAnchor: (anchor: StudioCommentAnchor) => void;
  setAiProvenance: (next: SetStateAction<StudioAiProvenanceDocument>) => void;
  setCharacterBible: (next: SetStateAction<StudioCharacterBible>) => void;
  setCurrentPageId: (value: SetStateAction<string>) => boolean;
  setPublicationAnalytics: (next: SetStateAction<StudioPublicationAnalyticsDocument>) => void;
  setReferenceBoard: (next: StudioReferenceBoardDocument) => boolean;
  setPublishAiDisclosure: (next: SetStateAction<string>) => void;
  setPublishAiUsage: (next: SetStateAction<StudioPublishAiUsage>) => void;
  setPublishCompliance: (next: SetStateAction<StudioPublishComplianceChecklist>) => void;
  setPublishPackageCredits: (next: SetStateAction<string>) => void;
  setPublishProfile: (next: SetStateAction<StudioPublishProfile>) => void;
  setReleaseSchedule: (next: SetStateAction<StudioReleaseSchedule>) => void;
  setWriterRoom: (next: SetStateAction<StudioWriterRoomDocument>) => void;
  startMacroRecord: () => void;
  stopMacroRecord: () => Promise<void>;
  updatePublishPackageSettings: (value: StudioPublishPackageSettings) => void;
}

export interface StudioLazyPanelStackProps {
  activeCommentAnchor: StudioCommentAnchor;
  activePage: PageState;
  aiProvenance: StudioAiProvenanceDocument;
  aiProvenanceOpen: boolean;
  aiSettings: StudioAiSettings;
  autoActionBusy: boolean;
  autoActionError: string | null;
  autoActionPlan: StudioAutoActionPlan | null;
  autoActionProgress: StudioAutoActionExecutionProgress | null;
  autoActionScope: StudioAutoActionScope;
  autoActionSelectedPageIds: string[];
  autoActionSet: StudioAutoActionSet | null;
  autoActionsOpen: boolean;
  autoActionStatus: string | null;
  bg3dInitialDataUrl: string | undefined;
  bg3dInitialScene: StudioBg3dSceneDocument | undefined;
  bg3dOperation: "insert" | "update";
  /** View-only LT identity used to resolve the page-owned Shared Stage without exposing a raw target. */
  bg3dTargetBundleId: string | null;
  bg3dBatchRecoveryScope: StudioBg3dShotBatchRecoveryScope | null;
  validateRecoveryAccess: (
    scope: StudioBg3dShotBatchRecoveryScope,
    signal: AbortSignal
  ) => Promise<boolean>;
  bg3dOpen: boolean;
  /** Elements 3D rail one-shot seeds for BG3D (cleared after consume). */
  bg3dSeedTemplateId: string | null;
  bg3dSeedPrimitiveKind: string | null;
  onSeedObjectInsertConsumed: () => void;
  characterBible: StudioCharacterBible;
  characterBibleOpen: boolean;
  checkpointError: string | null;
  checkpointPanelOpen: boolean;
  checkpoints: StudioCheckpoint[];
  collaborationDocumentLocked: boolean;
  colorWheelCenter: { x: number; y: number; } | null;
  colorWheelOpen: boolean;
  commentsOpen: boolean;
  commentsPanelMounted: boolean;
  studioCommentFocusRequest: { threadId: string; requestId: number } | null;
  studioCommentSharedReply?: StudioCommentsPanelSharedReplyController;
  studioCommentSyncError: string | null;
  studioCommentPinsHidden: boolean;
  studioLegacyCommentThreadIdSet: ReadonlySet<string>;
  studioTeamCommentCapabilities: StudioTeamCommentCapabilities | null;
  studioTeamCommentsSyncing: boolean;
  studioTeamCommentsWorkId: string | null;
  studioTeamUnreadCommentIdSet: ReadonlySet<string>;
  composeWorkAssetPreviewPage: (page: PageState) => PageState;
  continuityIssues: StudioContinuityIssue[];
  continuityOpen: boolean;
  continuityScenes: StudioLazyContinuityScene[];
  currentPageId: string;
  currentPublishPackageCreditsText: () => string;
  draftCollaboration?: StudioDraftCollaborationReadiness | null;
  effectivePublishPackageSettings: StudioPublishPackageSettings;
  elementById: Map<string, El>;
  fxPanelOpen: boolean;
  followingStudioSessionId: string | null;
  isMobile: boolean;
  loadedWork: WorkDetail | null;
  loggedIn: boolean;
  macroSession: StudioMacroSession;
  masterEditMode: boolean;
  pageDnd: StudioPageDnd;
  pageReviewOpen: boolean;
  pages: PageState[];
  pagesHi: number;
  pagesHistory: PageState[][];
  mannequinPoserOpen: boolean;
  poserInitialDataUrl: string | undefined;
  poserInitialElementId: string | undefined;
  /** Elements 3D rail one-shot prop seed for VRM (cleared after consume). */
  poserSeedPropId: string | null;
  poserVrmOpen: boolean;
  /** 캐릭터 셰이퍼(`/studio/character`) 표면 열림 여부. */
  characterShaperOpen: boolean;
  productionInsightsOpen: boolean;
  productionInsightsResult: StudioProductionInsights | null;
  publicationAnalytics: StudioPublicationAnalyticsDocument;
  publicationOperationsOpen: boolean;
  publishAiDisclosure: string;
  publishAiUsage: StudioPublishAiUsage;
  publishCompliance: StudioPublishComplianceChecklist;
  publishComplianceResult: StudioPublishComplianceResult;
  publishPackageExportBusy: boolean;
  publishPackageExportProgress: { done: number; total: number; } | null;
  publishPackageExportStatus: { tone: "info" | "good" | "bad"; text: string; } | null;
  publishPackageOpen: boolean;
  publishPackagePlan: StudioPublishPackagePlan | null;
  publishPreflightOpen: boolean;
  publishPreflightResult: StudioPublishPreflightResult | null;
  publishProfile: StudioPublishProfile;
  quickActionsAnchor: { x: number; y: number; };
  quickActionsDisabledActions: Set<StudioQuickActionId>;
  quickActionsOpen: boolean;
  quickActionsPreferences: StudioQuickActionsPreferences;
  recentColors: string[];
  referencePanelOpen: boolean;
  referenceBoard: StudioReferenceBoardDocument;
  releaseSchedule: StudioReleaseSchedule;
  scenarioApplyTarget: "current-page" | "new-page";
  scenarioBusy: boolean;
  scenarioError: string | null;
  scenarioImageReferenceAssetOptions: readonly StudioAiImageReferenceAssetOption[];
  scenarioImageReferenceDocument: StudioAiImageReferenceDocument;
  scenarioImageReferenceMissingCount: number;
  scenarioImageReferencesLoading: boolean;
  scenarioOpen: boolean;
  scenarioProgress: { done: number; total: number; } | null;
  scenarioRegeneratingIndex: number | null;
  scenarioResult: StudioLazyScenarioResult | null;
  scenarioSceneCountHint: number | undefined;
  scenarioStageLabel: string | null;
  scenarioStoryText: string;
  scrollPreviewOpen: boolean;
  serverCurrentRevision: number | undefined;
  serverRevisionError: string | null;
  serverRevisionLoading: boolean;
  serverRevisions: WorkRevisionSummary[];
  setAiProvenanceOpen: Dispatch<SetStateAction<boolean>>;
  setAutoActionsOpen: Dispatch<SetStateAction<boolean>>;
  setBg3dInitialDataUrl: Dispatch<SetStateAction<string | undefined>>;
  setBg3dInitialElementId: Dispatch<SetStateAction<string | undefined>>;
  setBg3dInitialScene: Dispatch<SetStateAction<StudioBg3dSceneDocument | undefined>>;
  setBg3dOpen: Dispatch<SetStateAction<boolean>>;
  setCharacterBibleOpen: Dispatch<SetStateAction<boolean>>;
  setCheckpointPanelOpen: Dispatch<SetStateAction<boolean>>;
  setColor: Dispatch<SetStateAction<string>>;
  setColorWheelOpen: Dispatch<SetStateAction<boolean>>;
  onArmCommentPinPlacement: () => void;
  setCommentsOpen: Dispatch<SetStateAction<boolean>>;
  isStudioCommentAnchorValid: (anchor: StudioCommentAnchor) => boolean;
  setStudioCommentFocusRequest: Dispatch<SetStateAction<{ threadId: string; requestId: number } | null>>;
  setStudioCommentPinsHidden: Dispatch<SetStateAction<boolean>>;
  setContinuityOpen: Dispatch<SetStateAction<boolean>>;
  setFxPanelOpen: Dispatch<SetStateAction<boolean>>;
  setFollowingStudioSessionId: Dispatch<SetStateAction<string | null>>;
  setLoadedWork: Dispatch<SetStateAction<WorkDetail | null>>;
  setMannequinPoserOpen: Dispatch<SetStateAction<boolean>>;
  setPageReviewOpen: Dispatch<SetStateAction<boolean>>;
  setPoserInitialDataUrl: Dispatch<SetStateAction<string | undefined>>;
  setPoserInitialElementId: Dispatch<SetStateAction<string | undefined>>;
  setPoserVrmOpen: Dispatch<SetStateAction<boolean>>;
  setCharacterShaperOpen: Dispatch<SetStateAction<boolean>>;
  setProductionInsightsOpen: Dispatch<SetStateAction<boolean>>;
  setPublicationOperationsOpen: Dispatch<SetStateAction<boolean>>;
  setPublishPackageOpen: Dispatch<SetStateAction<boolean>>;
  setPublishPreflightOpen: Dispatch<SetStateAction<boolean>>;
  setQuickActionsOpen: Dispatch<SetStateAction<boolean>>;
  setQuickActionsPreferences: Dispatch<SetStateAction<StudioQuickActionsPreferences>>;
  setReferencePanelOpen: Dispatch<SetStateAction<boolean>>;
  setScenarioOpen: Dispatch<SetStateAction<boolean>>;
  setScenarioImageReferenceDocument: Dispatch<
    SetStateAction<StudioAiImageReferenceDocument>
  >;
  setScenarioSceneCountHint: Dispatch<SetStateAction<number | undefined>>;
  setScenarioStoryText: Dispatch<SetStateAction<string>>;
  setScrollPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSharedDocumentNotice: Dispatch<SetStateAction<string | null>>;
  setSharedDocumentScope: Dispatch<SetStateAction<StudioLazySharedDocumentScope | null>>;
  setStoryboardGridOpen: Dispatch<SetStateAction<boolean>>;
  setTeamPanelOpen: Dispatch<SetStateAction<boolean>>;
  setTimelapseOpen: Dispatch<SetStateAction<boolean>>;
  setTool: Dispatch<SetStateAction<Tool>>;
  setWriterRoomAiDirection: Dispatch<SetStateAction<string>>;
  setWriterRoomAiReview: Dispatch<SetStateAction<StudioLazyWriterRoomAiReview | null>>;
  setWriterRoomOpen: Dispatch<SetStateAction<boolean>>;
  sharedDocument: StudioSharedDocument | null;
  storyboardGridOpen: boolean;
  studioAuthUserId: string | null;
  studioCommentActor: StudioCommentActor;
  studioCommentAnchorOptions: { anchor: StudioCommentAnchor; label: string; }[];
  studioComments: StudioCommentsDocument;
  studioRevisionProjectGenerationRef: RefObject<number>;
  teamPanelOpen: boolean;
  textAiConfigured: boolean;
  timelapseOpen: boolean;
  title: string;
  workId: string | null;
  writerRoom: StudioWriterRoomDocument;
  writerRoomAiBusy: boolean;
  writerRoomAiDirection: string;
  writerRoomAiError: string | null;
  writerRoomAiReview: StudioLazyWriterRoomAiReview | null;
  writerRoomCanvasPlan: StudioWriterRoomCanvasProjectionResult | null;
  writerRoomOpen: boolean;
  stableHandlers: StudioLazyPanelStackHandlers;
}

function StudioReferencePanelLoadingFallback() {
  return (
    <div
      role="status"
      aria-label="참고 이미지 창 불러오는 중"
      aria-live="polite"
      data-studio-reference-panel-loading="true"
      className="fixed right-3 top-20 z-[70] flex min-h-24 w-[min(300px,calc(100vw-1.5rem))] items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-[0_12px_36px_oklch(0.05_0.01_70/0.4)]"
    >
      <span
        aria-hidden
        className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent-soft"
      >
        <span className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-fg">참고 이미지 창</span>
        <span className="mt-0.5 block text-[0.7rem] leading-relaxed text-fg-3">
          보드와 저장된 배치를 준비하고 있어요…
        </span>
      </span>
    </div>
  );
}

export const StudioLazyPanelStack = memo(function StudioLazyPanelStack({
  activeCommentAnchor,
  activePage,
  aiProvenance,
  aiProvenanceOpen,
  aiSettings,
  autoActionBusy,
  autoActionError,
  autoActionPlan,
  autoActionProgress,
  autoActionScope,
  autoActionSelectedPageIds,
  autoActionSet,
  autoActionsOpen,
  autoActionStatus,
  bg3dInitialDataUrl,
  bg3dInitialScene,
  bg3dOperation,
  bg3dTargetBundleId,
  bg3dBatchRecoveryScope,
  validateRecoveryAccess,
  bg3dOpen,
  bg3dSeedTemplateId,
  bg3dSeedPrimitiveKind,
  onSeedObjectInsertConsumed,
  characterBible,
  characterBibleOpen,
  checkpointError,
  checkpointPanelOpen,
  checkpoints,
  collaborationDocumentLocked,
  colorWheelCenter,
  colorWheelOpen,
  commentsOpen,
  commentsPanelMounted,
  studioCommentFocusRequest,
  studioCommentSharedReply,
  studioCommentSyncError,
  studioCommentPinsHidden,
  studioLegacyCommentThreadIdSet,
  studioTeamCommentCapabilities,
  studioTeamCommentsSyncing,
  studioTeamCommentsWorkId,
  studioTeamUnreadCommentIdSet,
  composeWorkAssetPreviewPage,
  continuityIssues,
  continuityOpen,
  continuityScenes,
  currentPageId,
  currentPublishPackageCreditsText,
  draftCollaboration = null,
  effectivePublishPackageSettings,
  elementById,
  fxPanelOpen,
  isMobile,
  loadedWork,
  loggedIn,
  macroSession,
  masterEditMode,
  pageDnd,
  pageReviewOpen,
  pages,
  pagesHi,
  pagesHistory,
  mannequinPoserOpen,
  poserInitialDataUrl,
  poserInitialElementId,
  poserSeedPropId,
  poserVrmOpen,
  characterShaperOpen,
  productionInsightsOpen,
  productionInsightsResult,
  publicationAnalytics,
  publicationOperationsOpen,
  publishAiDisclosure,
  publishAiUsage,
  publishCompliance,
  publishComplianceResult,
  publishPackageExportBusy,
  publishPackageExportProgress,
  publishPackageExportStatus,
  publishPackageOpen,
  publishPackagePlan,
  publishPreflightOpen,
  publishPreflightResult,
  publishProfile,
  quickActionsAnchor,
  quickActionsDisabledActions,
  quickActionsOpen,
  quickActionsPreferences,
  recentColors,
  referencePanelOpen,
  referenceBoard,
  releaseSchedule,
  scenarioApplyTarget,
  scenarioBusy,
  scenarioError,
  scenarioImageReferenceAssetOptions,
  scenarioImageReferenceDocument,
  scenarioImageReferenceMissingCount,
  scenarioImageReferencesLoading,
  scenarioOpen,
  scenarioProgress,
  scenarioRegeneratingIndex,
  scenarioResult,
  scenarioSceneCountHint,
  scenarioStageLabel,
  scenarioStoryText,
  scrollPreviewOpen,
  serverCurrentRevision,
  serverRevisionError,
  serverRevisionLoading,
  serverRevisions,
  setAiProvenanceOpen,
  setAutoActionsOpen,
  setBg3dInitialDataUrl,
  setBg3dInitialElementId,
  setBg3dInitialScene,
  setBg3dOpen,
  setCharacterBibleOpen,
  setCheckpointPanelOpen,
  setColor,
  setColorWheelOpen,
  onArmCommentPinPlacement,
  setCommentsOpen,
  isStudioCommentAnchorValid,
  setStudioCommentFocusRequest,
  setStudioCommentPinsHidden,
  setContinuityOpen,
  setFxPanelOpen,
  setFollowingStudioSessionId,
  setLoadedWork,
  setMannequinPoserOpen,
  setPageReviewOpen,
  setPoserInitialDataUrl,
  setPoserInitialElementId,
  setPoserVrmOpen,
  setCharacterShaperOpen,
  setProductionInsightsOpen,
  setPublicationOperationsOpen,
  setPublishPackageOpen,
  setPublishPreflightOpen,
  setQuickActionsOpen,
  setQuickActionsPreferences,
  setReferencePanelOpen,
  setScenarioOpen,
  setScenarioImageReferenceDocument,
  setScenarioSceneCountHint,
  setScenarioStoryText,
  setScrollPreviewOpen,
  setSelectedId,
  setSharedDocumentNotice,
  setSharedDocumentScope,
  setStoryboardGridOpen,
  setTeamPanelOpen,
  setTimelapseOpen,
  setTool,
  setWriterRoomAiDirection,
  setWriterRoomAiReview,
  setWriterRoomOpen,
  sharedDocument,
  storyboardGridOpen,
  studioAuthUserId,
  studioCommentActor,
  studioCommentAnchorOptions,
  studioComments,
  studioRevisionProjectGenerationRef,
  teamPanelOpen,
  followingStudioSessionId,
  textAiConfigured,
  timelapseOpen,
  title,
  workId,
  writerRoom,
  writerRoomAiBusy,
  writerRoomAiDirection,
  writerRoomAiError,
  writerRoomAiReview,
  writerRoomCanvasPlan,
  writerRoomOpen,
  stableHandlers,
}: StudioLazyPanelStackProps) {
  const {
    applyWriterRoomAiReview,
    applyWriterRoomCanvasPlan,
    cancelAutoAction,
    cancelWriterRoomAi,
    changeAutoActionScope,
    changeAutoActionSelectedPages,
    createNamedCheckpoint,
    downloadAiPublicSummary,
    downloadPublishPackageManifest,
    downloadPublishPreflightReport,
    executeAutoAction,
    executePublishPackageExport,
    exportAutoActionJson,
    importAutoActionJson,
    planAutoAction,
    rememberColor,
    removeNamedCheckpoint,
    restoreNamedCheckpoint,
    setAiProvenance,
    setCharacterBible,
    setCurrentPageId,
    setPublicationAnalytics,
    setReferenceBoard,
    setPublishAiDisclosure,
    setPublishAiUsage,
    setPublishCompliance,
    setPublishPackageCredits,
    setPublishProfile,
    setReleaseSchedule,
    setWriterRoom,
    startMacroRecord,
    stopMacroRecord,
    updatePublishPackageSettings,
    currentStudioProjectSnapshot,
    reloadServerRevisions,
    requestStudioDraftCollaborationShare,
    requestWriterRoomAiDraft,
    restoreServerRevision,
  } = stableHandlers;
  const documentRuntime = useContext(StudioDocumentRuntimeContext);
  const teamWorkId = workId ?? (
    draftCollaboration?.status === "ready"
      ? draftCollaboration.room.provisionalWorkId
      : null
  );
  return (
    <>
      <StudioThreeDPreviewPanelStack
        activePage={activePage}
        bg3dInitialDataUrl={bg3dInitialDataUrl}
        bg3dInitialScene={bg3dInitialScene}
        bg3dOperation={bg3dOperation}
        bg3dTargetBundleId={bg3dTargetBundleId}
        bg3dBatchRecoveryScope={bg3dBatchRecoveryScope}
        validateRecoveryAccess={validateRecoveryAccess}
        bg3dOpen={bg3dOpen}
        bg3dSeedTemplateId={bg3dSeedTemplateId}
        bg3dSeedPrimitiveKind={bg3dSeedPrimitiveKind}
        onSeedObjectInsertConsumed={onSeedObjectInsertConsumed}
        composeWorkAssetPreviewPage={composeWorkAssetPreviewPage}
        currentPageId={currentPageId}
        elementById={elementById}
        isMobile={isMobile}
        masterEditMode={masterEditMode}
        pageDnd={pageDnd}
        pageReviewOpen={pageReviewOpen}
        pages={pages}
        pagesHi={pagesHi}
        pagesHistory={pagesHistory}
        mannequinPoserOpen={mannequinPoserOpen}
        poserInitialDataUrl={poserInitialDataUrl}
        poserInitialElementId={poserInitialElementId}
        poserSeedPropId={poserSeedPropId}
        poserVrmOpen={poserVrmOpen}
        characterShaperOpen={characterShaperOpen}
        quickActionsAnchor={quickActionsAnchor}
        quickActionsDisabledActions={quickActionsDisabledActions}
        quickActionsOpen={quickActionsOpen}
        quickActionsPreferences={quickActionsPreferences}
        setBg3dInitialDataUrl={setBg3dInitialDataUrl}
        setBg3dInitialElementId={setBg3dInitialElementId}
        setBg3dInitialScene={setBg3dInitialScene}
        setBg3dOpen={setBg3dOpen}
        setMannequinPoserOpen={setMannequinPoserOpen}
        setPageReviewOpen={setPageReviewOpen}
        setPoserInitialDataUrl={setPoserInitialDataUrl}
        setPoserInitialElementId={setPoserInitialElementId}
        setPoserVrmOpen={setPoserVrmOpen}
        setCharacterShaperOpen={setCharacterShaperOpen}
        setQuickActionsOpen={setQuickActionsOpen}
        setQuickActionsPreferences={setQuickActionsPreferences}
        setStoryboardGridOpen={setStoryboardGridOpen}
        setTimelapseOpen={setTimelapseOpen}
        stableHandlers={stableHandlers}
        storyboardGridOpen={storyboardGridOpen}
        timelapseOpen={timelapseOpen}
        title={title}
      />

      <Suspense fallback={null}>
        {commentsPanelMounted ? (
          <StudioCommentsPanelSession
            activeCommentAnchor={activeCommentAnchor}
            collaborationDocumentLocked={collaborationDocumentLocked}
            commentsOpen={commentsOpen}
            isStudioCommentAnchorValid={isStudioCommentAnchorValid}
            onArmCommentPinPlacement={onArmCommentPinPlacement}
            setCommentsOpen={setCommentsOpen}
            setStudioCommentFocusRequest={setStudioCommentFocusRequest}
            setStudioCommentPinsHidden={setStudioCommentPinsHidden}
            {...(studioCommentSharedReply ? { sharedReply: studioCommentSharedReply } : {})}
            stableHandlers={stableHandlers}
            studioCommentActor={studioCommentActor}
            studioCommentAnchorOptions={studioCommentAnchorOptions}
            studioCommentFocusRequest={studioCommentFocusRequest}
            studioComments={studioComments}
            studioCommentPinsHidden={studioCommentPinsHidden}
            studioCommentSyncError={studioCommentSyncError}
            studioLegacyCommentThreadIdSet={studioLegacyCommentThreadIdSet}
            studioTeamCommentCapabilities={studioTeamCommentCapabilities}
            studioTeamCommentsSyncing={studioTeamCommentsSyncing}
            studioTeamCommentsWorkId={studioTeamCommentsWorkId}
            studioTeamUnreadCommentIdSet={studioTeamUnreadCommentIdSet}
            workId={workId}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {teamPanelOpen ? (
          <StudioTeamPanel
            key={studioAuthUserId ?? "guest"}
            open
            authScopeKey={studioAuthUserId}
            draftCollaboration={draftCollaboration}
            followingSessionId={followingStudioSessionId}
            onClose={() => setTeamPanelOpen(false)}
            onDraftShareRequest={() => void requestStudioDraftCollaborationShare()}
            onToggleFollow={(sessionId) =>
              setFollowingStudioSessionId((current) =>
                current === sessionId ? null : sessionId
              )
            }
            workId={teamWorkId}
            loggedIn={loggedIn}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {continuityOpen ? (
          <StudioContinuityPanel
            open
            onClose={() => setContinuityOpen(false)}
            issues={continuityIssues}
            finishDocumentTitle={title}
            finishComments={studioComments}
            pages={pages}
            currentPageId={currentPageId}
            openCommentCount={studioComments.threads.filter((thread) => !thread.resolved).length}
            documentKey={documentRuntime?.documentKey ?? (
              workId ? JSON.stringify(["work", studioAuthUserId ?? "guest", workId]) : undefined
            )}
            scenes={continuityScenes.map((scene) => ({
              id: scene.id,
              label: scene.label,
            }))}
            onSelectScene={(sceneId) => {
              const scene = continuityScenes.find((candidate) => candidate.id === sceneId);
              if (!scene) return;
              if (!setCurrentPageId(scene.pageId)) return;
              setTool("select");
              setSelectedId(scene.frameId);
              setContinuityOpen(false);
            }}
            onSelectTarget={(target) => {
              if (target.pageId && !setCurrentPageId(target.pageId)) return;
              setTool("select");
              setSelectedId(target.elementId ?? null);
              setContinuityOpen(false);
            }}
            onOpenScrollPreview={() => {
              setContinuityOpen(false);
              setScrollPreviewOpen(true);
            }}
            onOpenPublishPreflight={() => {
              setContinuityOpen(false);
              setPublishPreflightOpen(true);
            }}
          />
        ) : null}
      </Suspense>

      <StudioScrollScenarioPreviewPanelStack
        aiSettings={aiSettings}
        composeWorkAssetPreviewPage={composeWorkAssetPreviewPage}
        currentPageId={currentPageId}
        pages={pages}
        scenarioApplyTarget={scenarioApplyTarget}
        scenarioBusy={scenarioBusy}
        scenarioError={scenarioError}
        scenarioImageReferenceAssetOptions={scenarioImageReferenceAssetOptions}
        scenarioImageReferenceDocument={scenarioImageReferenceDocument}
        scenarioImageReferenceMissingCount={scenarioImageReferenceMissingCount}
        scenarioImageReferencesLoading={scenarioImageReferencesLoading}
        scenarioOpen={scenarioOpen}
        scenarioProgress={scenarioProgress}
        scenarioRegeneratingIndex={scenarioRegeneratingIndex}
        scenarioResult={scenarioResult}
        scenarioSceneCountHint={scenarioSceneCountHint}
        scenarioStageLabel={scenarioStageLabel}
        scenarioStoryText={scenarioStoryText}
        scrollPreviewOpen={scrollPreviewOpen}
        setScenarioOpen={setScenarioOpen}
        setScenarioImageReferenceDocument={setScenarioImageReferenceDocument}
        setScenarioSceneCountHint={setScenarioSceneCountHint}
        setScenarioStoryText={setScenarioStoryText}
        setScrollPreviewOpen={setScrollPreviewOpen}
        stableHandlers={stableHandlers}
        textAiConfigured={textAiConfigured}
      />

      <Suspense fallback={null}>
        {productionInsightsOpen && productionInsightsResult ? (
          <StudioProductionInsightsPanel
            open
            onClose={() => setProductionInsightsOpen(false)}
            insights={productionInsightsResult}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {publicationOperationsOpen ? (
          <StudioPublicationOperationsPanel
            open
            onClose={() => setPublicationOperationsOpen(false)}
            schedule={releaseSchedule}
            onScheduleChange={(value) => {
              if (!collaborationDocumentLocked) {
                setReleaseSchedule(value);
                setSharedDocumentNotice(null);
              }
            }}
            analyticsDocument={publicationAnalytics}
            onAnalyticsDocumentChange={(value) => {
              if (!collaborationDocumentLocked) {
                // The operations panel emits a canonical document from the same deferred runtime.
                setPublicationAnalytics(value);
                setSharedDocumentNotice(null);
              }
            }}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {publishPreflightOpen && publishPreflightResult ? (
          <StudioPublishPreflightPanel
            open
            onClose={() => setPublishPreflightOpen(false)}
            profile={publishProfile}
            onProfileChange={(value) => {
              if (!collaborationDocumentLocked) {
                setPublishProfile(value);
                setSharedDocumentNotice(null);
              }
            }}
            aiUsage={publishAiUsage}
            onAiUsageChange={(value) => {
              if (!collaborationDocumentLocked) {
                setPublishAiUsage(value);
                setSharedDocumentNotice(null);
              }
            }}
            disclosure={publishAiDisclosure}
            onDisclosureChange={(value) => {
              if (!collaborationDocumentLocked) {
                setPublishAiDisclosure(value);
                setSharedDocumentNotice(null);
              }
            }}
            compliance={publishCompliance}
            onComplianceChange={(value) => {
              if (!collaborationDocumentLocked) {
                setPublishCompliance(normalizeStudioPublishCompliance(value));
                setSharedDocumentNotice(null);
              }
            }}
            complianceResult={publishComplianceResult}
            result={publishPreflightResult}
            onDownloadReport={downloadPublishPreflightReport}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {publishPackageOpen && publishPackagePlan ? (
          <StudioPublishPackagePanel
            open
            onClose={() => setPublishPackageOpen(false)}
            settings={effectivePublishPackageSettings}
            onSettingsChange={updatePublishPackageSettings}
            plan={publishPackagePlan}
            creditsText={currentPublishPackageCreditsText()}
            onCreditsTextChange={(value) => {
              if (!collaborationDocumentLocked) {
                setPublishPackageCredits(value);
                setSharedDocumentNotice(null);
              }
            }}
            onDownloadManifest={() => void downloadPublishPackageManifest()}
            onBeginExport={() => void executePublishPackageExport()}
            exportBusy={publishPackageExportBusy}
            exportProgress={publishPackageExportProgress}
            exportStatus={publishPackageExportStatus}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {aiProvenanceOpen ? (
          <StudioAiProvenancePanel
            open
            onClose={() => setAiProvenanceOpen(false)}
            document={aiProvenance}
            onExportPublicSummary={(summary) => downloadAiPublicSummary(summary)}
            onClearHistory={() => {
              if (!collaborationDocumentLocked) {
                setAiProvenance(createEmptyStudioAiProvenanceDocument());
                setSharedDocumentNotice(null);
              }
            }}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {writerRoomOpen ? (
          <StudioWriterRoomPanel
            open
            onClose={() => setWriterRoomOpen(false)}
            document={writerRoom}
            onChange={(value) => {
              if (!collaborationDocumentLocked) {
                setWriterRoom(normalizeStudioWriterRoomDocument(value));
                setSharedDocumentNotice(null);
              }
            }}
            characters={characterBible.characters}
            onOpenCharacterBible={() => {
              setWriterRoomOpen(false);
              setCharacterBibleOpen(true);
            }}
            onRequestAi={textAiConfigured ? requestWriterRoomAiDraft : undefined}
            aiBusy={writerRoomAiBusy}
            aiError={writerRoomAiError}
            aiDirection={writerRoomAiDirection}
            onAiDirectionChange={setWriterRoomAiDirection}
            aiReview={writerRoomAiReview ? {
              stage: writerRoomAiReview.stage,
              rationale: writerRoomAiReview.rationale,
              draft: writerRoomAiReview.draft,
              provider: writerRoomAiReview.textProvenance.provider,
              model: writerRoomAiReview.textProvenance.model,
              totalTokens: writerRoomAiReview.textProvenance.usage?.totalTokens,
              failover: writerRoomAiReview.textProvenance.failover,
            } : null}
            onApplyAiReview={applyWriterRoomAiReview}
            onDiscardAiReview={() => setWriterRoomAiReview(null)}
            onCancelAi={cancelWriterRoomAi}
            canvasPlan={writerRoomCanvasPlan ? {
              canApply: writerRoomCanvasPlan.applyReadiness.canApply,
              pageCount: writerRoomCanvasPlan.pageGrouping.pages.length,
              panelCount: writerRoomCanvasPlan.panels.length,
              errorCount: writerRoomCanvasPlan.applyReadiness.errorCount,
              warningCount: writerRoomCanvasPlan.applyReadiness.warningCount,
              diagnosticMessages: writerRoomCanvasPlan.diagnostics.map(({ message }) => message),
            } : undefined}
            onApplyCanvasPlan={applyWriterRoomCanvasPlan}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {characterBibleOpen ? (
          <StudioCharacterBiblePanel
            open
            onClose={() => setCharacterBibleOpen(false)}
            bible={characterBible}
            onChange={(value) => {
              if (!collaborationDocumentLocked) {
                setCharacterBible(value);
                setSharedDocumentNotice(null);
              }
            }}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {autoActionsOpen ? (
          <StudioAutoActionsPanel
            open
            actionSet={autoActionSet}
            scope={autoActionScope}
            pageOptions={pages.map((page, pageIndex) => ({
              id: page.id,
              label: pageDisplayName(page, pageIndex),
            }))}
            selectedPageIds={autoActionSelectedPageIds}
            plan={autoActionPlan}
            progress={autoActionProgress}
            status={autoActionStatus}
            busy={autoActionBusy}
            error={autoActionError}
            macroRecording={macroSession.recording}
            macroCommandCount={macroSession.commands.length}
            onStartMacroRecord={startMacroRecord}
            onStopMacroRecord={() => void stopMacroRecord()}
            onClose={() => {
              if (!autoActionBusy) setAutoActionsOpen(false);
            }}
            onScopeChange={changeAutoActionScope}
            onSelectedPageIdsChange={changeAutoActionSelectedPages}
            onImportJson={importAutoActionJson}
            onExportJson={() => void exportAutoActionJson()}
            onRequestPlan={() => void planAutoAction()}
            onExecute={() => void executeAutoAction()}
            onCancel={cancelAutoAction}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {checkpointPanelOpen ? (
          <StudioCheckpointPanel
            open
            onClose={() => setCheckpointPanelOpen(false)}
            checkpoints={checkpoints}
            error={checkpointError}
            onCreate={createNamedCheckpoint}
            onRestore={restoreNamedCheckpoint}
            onDelete={removeNamedCheckpoint}
            serverRevisions={serverRevisions}
            serverCurrentRevision={sharedDocument?.role === "owner" ? serverCurrentRevision : undefined}
            serverLoading={serverRevisionLoading}
            serverError={serverRevisionError}
            serverWorkId={workId ?? undefined}
            getCurrentProject={() => parseStudioProjectFile(currentStudioProjectSnapshot())}
            getCurrentProjectGeneration={() => studioRevisionProjectGenerationRef.current}
            onReloadServer={workId && serverCurrentRevision && sharedDocument?.role === "owner" && loggedIn ? () => void reloadServerRevisions() : undefined}
            onRestoreServer={workId && serverCurrentRevision && sharedDocument?.role === "owner" && loggedIn
              ? restoreServerRevision
              : undefined}
            onNavigateServerChange={({ pageId, elementId }) => {
              const targetPage = pages.find((page) => page.id === pageId);
              if (!targetPage) return;
              setCurrentPageId(pageId);
              setSelectedId(
                elementId && targetPage.elements.some((element) => element.id === elementId)
                  ? elementId
                  : null
              );
            }}
          />
        ) : null}
      </Suspense>

      {fxPanelOpen && loadedWork ? (
        <div
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-[80] grid place-items-center bg-[oklch(0.08_0.01_70/0.72)] p-3 backdrop-blur-sm"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-bold text-fg">애니메이션 연출</h2>
              <button
                type="button"
                aria-label="닫기"
                title="닫기"
                className="grid size-8 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent"
                onClick={() => setFxPanelOpen(false)}
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <Suspense fallback={<div className="py-8 text-center text-xs text-fg-3">불러오는 중…</div>}>
                <WorkFxPanel
                  work={loadedWork}
                  onUpdated={(doc, revision) => {
                    setLoadedWork((prev) => prev ? { ...prev, doc, revision: revision ?? prev.revision } : prev);
                    if (revision) {
                      setSharedDocumentScope((current) =>
                        current && current.workId === workId && current.authScopeKey === studioAuthUserId
                          ? {
                              ...current,
                              value: {
                                ...current.value,
                                revision,
                                document: { ...current.value.document, doc },
                              },
                            }
                          : current
                      );
                    }
                  }}
                />
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}

      <Suspense fallback={<StudioReferencePanelLoadingFallback />}>
        {referencePanelOpen ? (
          <StudioReferencePanel
            open
            document={referenceBoard}
            onChange={setReferenceBoard}
            onPickColor={(nextColor) => {
              setColor(nextColor);
              rememberColor(nextColor);
            }}
            onClose={() => setReferencePanelOpen(false)}
          />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {colorWheelOpen ? (
          <StudioColorWheelOverlay
            open={colorWheelOpen}
            center={colorWheelCenter}
            colors={selectWheelColors(recentColors)}
            onSelect={(c) => {
              setColor(c);
              rememberColor(c);
            }}
            onClose={() => setColorWheelOpen(false)}
          />
        ) : null}
      </Suspense>
    </>
  );
});
