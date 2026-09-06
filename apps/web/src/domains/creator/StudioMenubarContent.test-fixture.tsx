/**
 * `StudioMenubarContent` 렌더 픽스처 — 프롭 90여 개의 단일 출처.
 *
 * 두 스위트가 이 컴포넌트를 렌더한다: 동작을 보는 `StudioMenubarContent.test.tsx` 와
 * 뷰포트 도달성을 보는 `studio-review-entry-point-viewports.test.tsx`. 둘은 서로 다른
 * `vi.mock` 을 써야 해서(전자는 `StudioMainMenu` 를 통째로 스텁, 후자는 className 게이트를
 * 평가해야 하므로 forward) 파일을 합칠 수 없다. 공유할 수 있는 건 순수 데이터인 이 픽스처뿐이라
 * 여기로 뺐다 — 프롭이 하나 늘 때 한쪽만 고쳐 조용히 갈라지는 걸 막는다.
 */
import { vi } from "vitest";

import type { StudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import type { StudioCharacterBible } from "./studio-character-bible";
import type { WatermarkSettings } from "./studio-watermark";
import type { StudioWriterRoomDocument } from "./studio-writer-room";
import type {
  StudioMenubarContentHandlers,
  StudioMenubarContentProps,
} from "./StudioMenubarContent";

const WATERMARK = {
  enabled: false,
} as WatermarkSettings;

export function createHandlers(): StudioMenubarContentHandlers {
  return {
    applyStudioWorkspaceLayout: vi.fn(),
    cancelInterchangeImport: vi.fn(),
    changeMobileImmersiveMode: vi.fn(),
    ensureWatermarkLoaded: vi.fn(async () => WATERMARK),
    exportCurrentPageToInkMl: vi.fn(async () => ({}) as never),
    exportCurrentPageToWillV1: vi.fn(async () => ({}) as never),
    exportCurrentPageToPsd: vi.fn(async () => ({}) as never),
    exportCurrentPageToRasterInterchange: vi.fn(async () => ({}) as never),
    exportCurrentPageToSvg: vi.fn(async () => ({}) as never),
    handleCapturePagesForPreset: vi.fn(async () => []),
    handleCapturePagesForIndices: vi.fn(async () => []),
    handleCopyToClipboard: vi.fn(async () => undefined),
    handleDownload: vi.fn(async () => undefined),
    handleDownloadAll: vi.fn(async () => undefined),
    handleExportProject: vi.fn(),
    handleExportProjectArchive: vi.fn(async () => undefined),
    handleImportProject: vi.fn(),
    handleImportProjectArchive: vi.fn(async () => undefined),
    handleImportInterchangeArchive: vi.fn(async () => undefined),
    handleImportPsd: vi.fn(async () => undefined),
    handleSave: vi.fn(async () => undefined),
    openAutoActions: vi.fn(async () => undefined),
    openOwnerFxPanel: vi.fn(async () => undefined),
    redo: vi.fn(),
    persistStudioWorkspaceState: vi.fn((state) => ({ state }) as never),
    setWatermark: vi.fn(),
    toggleHistoryPanel: vi.fn(),
    undo: vi.fn(),
    toggleAnimationTimeline: vi.fn(),
    openTimelapse: vi.fn(),
    openStoryboardGrid: vi.fn(),
    openScrollPreview: vi.fn(),
    openContinuityCheck: vi.fn(),
    toggleDocumentComments: vi.fn(),
    openPageReview: vi.fn(),
  };
}

export function createProps(
  overrides: Partial<StudioMenubarContentProps> = {},
): StudioMenubarContentProps {
  return {
    activePageLabel: "첫 장면",
    activeToolbarGroup: null,
    aiProvenance: { version: 1, operations: [] } as StudioAiProvenanceDocument,
    canvasH: 2_000,
    characterBible: { version: 1, characters: [] } as StudioCharacterBible,
    collaborationDocumentLocked: false,
    collaborationLockMessage: () => "협업 잠금",
    currentWorkspaceOwnerScope: "owner",
    displayLinkedTitleId: null,
    exportFormat: "png",
    exportMenuOpen: false,
    exportMenuRef: { current: null },
    exportPresetId: null,
    exportScale: 2,
    exportTransparent: false,
    fxPanelLoading: false,
    isExporting: false,
    isMobile: false,
    liveWorkspaceLayout: {} as StudioMenubarContentProps["liveWorkspaceLayout"],
    resolveWorkspaceDeviceKind: () => null,
    loadedWork: null,
    masterEditMode: false,
    menu: null,
    mobileImmersive: false,
    historyPanelOpen: false,
    openStudioCommentCount: 0,
    pageCount: 2,
    pageEditLocked: false,
    pageLabels: ["첫 장면", "두 번째"],
    projectActionsOpen: false,
    projectActionsRef: { current: null },
    projectArchiveBusy: false,
    projectArchiveImportInputRef: { current: null },
    projectArchiveStatus: null,
    projectImportInputRef: { current: null },
    interchangeImportBusy: false,
    interchangeImportInputRef: { current: null },
    interchangeImportStatus: null,
    psdImportBusy: false,
    psdImportInputRef: { current: null },
    psdImportStatus: null,
    redoDisabled: true,
    saving: false,
    setAiProvenanceOpen: vi.fn(),
    setAnimaticTimelineOpen: vi.fn(),
    setAssetRightsAuditOpen: vi.fn(),
    setCharacterBibleOpen: vi.fn(),
    setCheckpointPanelOpen: vi.fn(),
    setProductionBibleOpen: vi.fn(),
    setHybridDccOpen: vi.fn(),
    setSceneSnapshotOpen: vi.fn(),
    setExportFormat: vi.fn(),
    setExportMenuOpen: vi.fn(),
    setExportPresetId: vi.fn(),
    setExportScale: vi.fn(),
    setExportTransparent: vi.fn(),
    setMenu: vi.fn(),
    setProductionInsightsOpen: vi.fn(),
    setProjectActionsOpen: vi.fn(),
    setPublicationOperationsOpen: vi.fn(),
    setPublishPackageOpen: vi.fn(),
    setPublishPreflightOpen: vi.fn(),
    setWriterRoomOpen: vi.fn(),
    sharedDocument: null,
    stableHandlers: createHandlers(),
    studioMainMenuGroups: [],
    title: "테스트 원고",
    undoDisabled: true,
    watermark: WATERMARK,
    workId: null,
    workspaceMenuEpoch: 0,
    workspacePersistence: {
      ownerScope: "owner",
    } as StudioMenubarContentProps["workspacePersistence"],
    workspaceState: {} as StudioMenubarContentProps["workspaceState"],
    workspaceSyncNotice: null,
    writerRoom: {
      version: 1,
      completion: {
        premise: false,
        synopsis: false,
        "episode-outline": false,
        beats: false,
        scenes: false,
        "panel-plan": false,
        "dialogue-sfx": false,
      },
    } as StudioWriterRoomDocument,
    ...overrides,
  };
}
