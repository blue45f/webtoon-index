import { memo } from "react";

import { StudioToolbarDivider } from "./studio-chrome-ui";
import { studioToolButtonClass } from "./studio-panel-ui";
import { studioToolHintFromLabel, type StudioToolHintSpec } from "./studio-tool-hints";
import { studioUiDensityAllows } from "./studio-ui-density";
import { STUDIO_VIEW_ACTION_HINTS } from "./studio-view-action-hints";
import { StudioToolBeltCanvasControls } from "./StudioToolBeltCanvasControls";
import { StudioToolBeltCreateModeGroups } from "./StudioToolBeltCreateModeGroups";
import { StudioToolBeltQuickActions } from "./StudioToolBeltQuickActions";

import type {
  StudioAiAssistToolId,
  StudioAiRecentPromptsState,
} from "./ai/studio-ai-assist-ux";
import type {
  StudioAiImageSize,
  StudioAiSettings,
  StudioTextAiProvenance,
  StudioTextAiTransport,
} from "./ai/studio-ai-client";
import type {
  StudioAiObservableResult,
  StudioAiPendingOperationInput,
} from "./ai/studio-ai-provenance-recorder";
import type { StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import type { DialogueSuggestionCandidate } from "./lettering/studio-dialogue-suggest";
import type { StudioRasterAsset } from "./render/studio-raster-assets";
import type {
  StudioAssetFavoriteId,
  StudioAssetFavoriteState,
} from "./studio-asset-favorites";
import type { StudioAsset } from "./studio-asset-library";
import type { BubbleVariant, TemplateSpec } from "./studio-assets";
import type { BrandKit } from "./studio-brand-kit";
import type { StudioClip } from "./studio-clips";
import type { DrawMode, StudioMenu, Tool } from "./studio-editor-tool-model";
import type { El, ImageEl } from "./studio-element-model";
import type { StudioEmeresLibraryItem } from "./studio-emeres-library";
import type {
  MagicResizePreset,
  MagicResizeStrategy,
} from "./studio-magic-resize";
import type { PageState } from "./studio-page-state";
import type { PaletteSuggestion } from "./studio-palette-suggest";
import type { PanelLayoutPreset } from "./studio-panel-layouts";
import type { StudioPublishAiProvenance } from "./studio-publish-preflight";
import type { SceneTemplate } from "./studio-scene-templates";
import type {
  StudioServerAiProviderPreference,
  StudioServerAiStatus,
} from "./studio-server-ai-client";
import type { SfxPreset } from "./studio-sfx-presets";
import type { StudioSharedDocument } from "./studio-shared-document-client";
import type { StudioStockPhoto } from "./studio-stock-image-client";
import type { StudioToolbarGroupId } from "./studio-toolbar-groups";
import type {
  StudioAssetShareOptions,
  StudioAssetSortOrder,
  StudioAssetTab,
} from "./StudioAssetMenuPanel";
import type { StudioDialogueTranslateSurface } from "./StudioDialogueTranslatePanel";
import type { CreatorAssetReportReason } from "@/shared/lib/creator-asset-contract";
import type {
  GeneratedAssetQuality,
  GeneratedAssetSize,
  SharedAssetCatalogItem,
} from "@/src/infrastructure/creator-client";

const STUDIO_CANVAS_IMAGE_ACCEPT =
  "image/*,.bmp,.dib,.tga,.icb,.vda,.vst,.ppm,.pam,.qoi,.tif,.tiff";

const toolBtn = (active: boolean) => studioToolButtonClass(active, { dense: true });

/** Icon-only belt buttons: keep the 44px touch-target contract on coarse pointers
 *  (the dense px-3 padding alone leaves a 14–15px glyph at ~40px width). */
const iconToolBtnTouch = "pointer-coarse:min-w-11 pointer-coarse:justify-center";

// undo/redo/history 힌트는 실제 렌더 주체인 StudioToolBeltQuickActions 의
// QUICK_ACTION_HINTS 가 단독 소유한다 — 여기 사본은 죽은 중복이라 제거했다.
const TOOL_BELT_HINTS = {
  assets: studioToolHintFromLabel(
    "템플릿·에셋",
    "템플릿, 콜라주, 장면, 클립, 효과와 내 에셋을 한곳에서 찾아 캔버스에 추가합니다.",
    undefined,
    "assets"
  ),
  panelAdd: studioToolHintFromLabel(
    "컷 패널 추가",
    "현재 페이지에 새 사각 패널을 추가해 다음 컷을 배치합니다.",
    undefined,
    "panel-layout",
    "add"
  ),
  panelSplit: studioToolHintFromLabel(
    "사선 컷 추가",
    "기울어진 경계로 나뉜 두 패널을 한 번에 추가합니다.",
    undefined,
    "panel-layout",
    "split-diagonal"
  ),
  panelDiagonalize: studioToolHintFromLabel(
    "패널 사선화",
    "선택한 사각 패널을 평행사변형 형태의 사선 패널로 바꿉니다.",
    undefined,
    "panel-layout",
    "diagonalize"
  ),
  panelStraighten: studioToolHintFromLabel(
    "패널 직선화",
    "선택한 사선 패널을 다시 사각 패널로 바꿉니다.",
    undefined,
    "panel-layout",
    "straighten"
  ),
  select: studioToolHintFromLabel(
    "선택",
    "캔버스 요소를 선택해 이동하거나 크기와 속성을 편집합니다.",
    "V"
  ),
  pen: studioToolHintFromLabel(
    "펜",
    "현재 브러시와 필압 설정으로 자유롭게 선을 그립니다.",
    "B"
  ),
  eraser: studioToolHintFromLabel(
    "지우개",
    "현재 획을 브러시 크기와 필압에 맞춰 지웁니다.",
    "E"
  ),
  fill: studioToolHintFromLabel(
    "고급 채우기",
    "선택한 래스터의 닫힌 영역을 참조 경계로 인식해 현재 색으로 채웁니다.",
    "G"
  ),
  frameAnimation: studioToolHintFromLabel(
    "프레임 애니메이션",
    "선택한 이미지에 프레임을 쌓아 셀 애니메이션을 만듭니다."
  ),
  character3d: studioToolHintFromLabel(
    "3D 캐릭터",
    "베이스 캐릭터를 고른 뒤 포즈, 표정, 의상과 색상을 조정해 투명 배경 이미지로 추가합니다.",
    undefined,
    "character-3d"
  ),
  characterShaper: studioToolHintFromLabel(
    "캐릭터 셰이퍼",
    "프리셋 카드로 얼굴·헤어·체형·의상을 고르고, 사진·웹캠으로 포즈를 잡고, 투명 PNG나 레이어 PSD로 내보냅니다.",
    undefined,
    "character-3d"
  ),
  mannequin3d: studioToolHintFromLabel(
    "3D 데생 인형",
    "모델 파일 없이 체형을 조절하고 포즈를 잡아 드로잉 참고 이미지로 캡처합니다.",
    undefined,
    "mannequin-3d"
  ),
  bg3d: studioToolHintFromLabel(
    "3D 배경",
    "3D 오브젝트와 씬을 배치하고 카메라 앵글을 조절해 웹툰 배경 이미지를 추출합니다.",
    undefined,
    "background-library"
  ),
  reference: studioToolHintFromLabel(
    "참고 이미지",
    "그리는 동안 캔버스 옆에 참고 이미지를 고정해 형태와 색을 비교합니다."
  ),
  background: studioToolHintFromLabel(
    "배경·장면",
    "배경 채우기, 장면 템플릿, 톤과 3D 배경을 찾아 현재 페이지에 적용합니다.",
    undefined,
    "background-library"
  ),
  style: studioToolHintFromLabel(
    "스타일",
    "색상 팔레트와 브랜드 킷의 글꼴·로고를 작품 전체에 일관되게 적용합니다.",
    undefined,
    "style-library"
  ),
  ai: studioToolHintFromLabel(
    "AI 어시스트",
    "장면 구성, 대사, 팔레트, 이미지 생성과 AI 연동 설정을 한곳에서 엽니다.",
    undefined,
    "ai-assist"
  ),
  text: studioToolHintFromLabel(
    "텍스트",
    "클릭하면 텍스트를 추가하고, 끌어 놓으면 원하는 캔버스 위치에 바로 배치합니다."
  ),
  bubble: studioToolHintFromLabel(
    "말풍선",
    "말풍선 라이브러리에서 형태를 골라 대사와 함께 캔버스에 배치합니다.",
    undefined,
    "bubble",
    "open-library",
  ),
  image: studioToolHintFromLabel(
    "이미지 추가",
    "기기의 이미지 파일을 가져옵니다. 클립보드 이미지는 ⌘V 또는 Ctrl+V로 붙여넣을 수 있어요."
  ),
  timelapse: studioToolHintFromLabel(
    "타임랩스 녹화",
    "그리기 과정을 기록해 작업 흐름을 타임랩스 영상으로 만듭니다.",
    undefined,
    "timelapse"
  ),
  storyboard: studioToolHintFromLabel(
    "스토리보드 그리드",
    "모든 페이지를 격자로 펼쳐 컷 흐름, 밀도와 장면 전환을 한눈에 비교합니다.",
    undefined,
    "storyboard-grid"
  ),
  review: studioToolHintFromLabel(
    "페이지 검토",
    "페이지별 승인 상태, 담당자와 메모를 관리하고 검토 중 편집을 잠급니다.",
    undefined,
    "review-workflow"
  ),
  team: studioToolHintFromLabel(
    "팀 작업 공간",
    "작품 팀원을 초대하고 역할, 권한과 공동 작업 상태를 관리합니다.",
    undefined,
    "team-collaboration"
  ),
  continuity: studioToolHintFromLabel(
    "마감·품질 검사",
    "문서 무결성, 이미지 해상도, 레이어, 식자, 컷 간격, 검토 상태와 이야기 연속성을 한 번에 검사합니다.",
    undefined,
    "continuity-check"
  ),
  scrollPreview: studioToolHintFromLabel(
    "세로 스크롤 미리보기",
    "페이지를 모바일 독자 폭으로 이어 붙여 컷 간격과 읽기 흐름을 확인합니다.",
    undefined,
    "vertical-preview"
  ),
  timeline: studioToolHintFromLabel(
    "다중 레이어 타임라인",
    "레이어별 키프레임과 재생 구간을 시간축에서 편집합니다.",
    undefined,
    "timeline"
  ),
  zoomOut: STUDIO_VIEW_ACTION_HINTS.zoomOut,
  zoomIn: STUDIO_VIEW_ACTION_HINTS.zoomIn,
  actualSize: STUDIO_VIEW_ACTION_HINTS.actualSize,
  fitWidth: STUDIO_VIEW_ACTION_HINTS.fitWidth,
  resetView: STUDIO_VIEW_ACTION_HINTS.reset,
  workspaceFocus: studioToolHintFromLabel(
    "집중 모드",
    "좌우 속성 패널을 함께 접어 캔버스를 더 넓게 사용합니다.",
    undefined,
    "workspace-focus"
  ),
  workspaceRestore: studioToolHintFromLabel(
    "작업 패널 열기",
    "접어 둔 좌우 속성 패널을 다시 열어 편집 도구와 설정을 표시합니다.",
    undefined,
    "workspace-focus",
    "restore"
  ),
  maximizeWindow: studioToolHintFromLabel(
    "브라우저 맞춤",
    "사이트 헤더와 주변 영역을 숨기고 브라우저 창 전체를 편집기에 사용합니다. Esc로 복원할 수 있어요.",
    undefined,
    "fullscreen",
    "maximize-window"
  ),
  restoreWindow: studioToolHintFromLabel(
    "브라우저 맞춤 종료",
    "편집기 주변의 사이트 헤더와 영역을 다시 표시해 일반 화면으로 돌아갑니다.",
    "Esc",
    "fullscreen",
    "restore-window"
  ),
  fullscreen: studioToolHintFromLabel(
    "전체화면",
    "브라우저의 전체화면 모드로 전환해 편집 공간을 최대화합니다. Esc로 종료할 수 있어요.",
    "F11",
    "fullscreen",
    "fullscreen"
  ),
  exitFullscreen: studioToolHintFromLabel(
    "전체화면 종료",
    "브라우저 전체화면을 종료하고 이전 편집기 크기로 돌아갑니다.",
    "F11",
    "fullscreen",
    "exit-fullscreen"
  ),
  canvasOnly: studioToolHintFromLabel(
    "캔버스만 보기",
    "제목, 툴바와 양쪽 패널을 잠시 숨겨 캔버스에만 집중합니다. Esc로 복원할 수 있어요.",
    undefined,
    "fullscreen",
    "canvas-only"
  ),
} satisfies Record<string, StudioToolHintSpec>;

export type StudioToolBeltHintMap = typeof TOOL_BELT_HINTS;

export type StudioBgScene = {
  id: string;
  label: string;
  genre: string;
  svg?: string;
  imgSrc?: string;
  width?: number;
  height?: number;
};

export type StudioFxAsset = {
  id: string;
  label: string;
  svg: string;
  width: number;
  height: number;
};

export type StudioEmeresTemplate = {
  id: string;
  label: string;
  category: string;
  svg: string;
  width: number;
  height: number;
  tip: string;
};

export type StudioOptionalAssetPacks = {
  bgSceneSections: Array<{ genre: string; scenes: StudioBgScene[] }>;
  bgSceneGenreGroups: Array<{ genre: string; scenes: StudioBgScene[] }>;
  comicVectorStickers: StudioFxAsset[];
  creatureStickers: StudioFxAsset[];
  propStickers: StudioFxAsset[];
  fxOverlays: StudioFxAsset[];
  emeresSections: Array<{ category: string; templates: StudioEmeresTemplate[] }>;
  emeresUnderlayOpacity: number;
};

export type StudioSceneTemplatePacks = {
  categories: Array<{ id: string; label: string }>;
  templates: SceneTemplate[];
};

export type StudioSfxPacks = {
  categories: Array<{ id: SfxPreset["category"]; label: string }>;
  presets: SfxPreset[];
};

export type FxPickerSection =
  | "all"
  | "raster"
  | "sfx"
  | "emoji"
  | "comic"
  | "creature"
  | "prop"
  | "lines"
  | "overlay";

export interface StudioToolBeltContentHandlers {
  /**
   * 선택/그리기 전환의 단일 정본. 진행 중인 획 취소 → 픽셀 도구 disarm(스포이드 포함) →
   * tool/drawMode 커밋을 한 순서로 수행한다. 도구 벨트가 setTool/setDrawMode를 직접 만지면
   * 같은 명령이 진입점마다 다른 부수효과를 갖게 되므로 항상 이 핸들러를 거친다.
   */
  activatePrimaryCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;
  openFrameAnimationForSelected: () => void;
  addBgScene: (bg: StudioBgScene) => void;
  addBubble: (
    variant: BubbleVariant,
    at?: { x: number; y: number; },
    editImmediately?: boolean
  ) => void;
  addBuiltinRasterAsset: (asset: StudioRasterAsset) => Promise<void>;
  addCatalogElement: (item: { svg: string; width: number; height: number; label: string; }) => void;
  /**
   * Elements 3D rail: open BG3D / VRM with a one-shot template·primitive·prop seed.
   * Host owns seed state so drag/drop and click share one entry.
   */
  openStudioObjectInsert: (request: {
    readonly openTarget: "bg3d-editor" | "vrm-poser" | "bg3d-templates";
    readonly sourceId: string;
  }) => void;
  addDiagonalSplit: () => void;
  addDialogueBubbles: () => Promise<void>;
  addDialogueSuggestionToScript: (candidate: DialogueSuggestionCandidate) => void;
  addEmeresLibraryItem: (item: StudioEmeresLibraryItem) => void;
  addEmeresTemplate: (t: StudioEmeresTemplate) => void;
  addFocusLines: () => void;
  addFrame: () => void;
  addFxOverlay: (svgMarkup: string, w: number, h: number) => void;
  addRenderedImage: (
    src: string,
    width: number,
    height: number,
    aiProvenance?: StudioPublishAiProvenance,
    isAnimatedGif?: boolean,
    elementPatch?: Partial<ImageEl> & { name?: string }
  ) => boolean;
  addSceneTemplate: (template: SceneTemplate) => Promise<void>;
  addSfxPreset: (preset: SfxPreset) => Promise<void>;
  addSpeedLines: () => void;
  addSticker: (emoji: string, at?: { x: number; y: number; }) => void;
  addText: (at?: { x: number; y: number; }, editImmediately?: boolean) => void;
  addTone: (svg: string) => Promise<void>;
  announceDrawingShortcut: (message: string) => void;
  applyAiAssistPresetPrompt: (tool: StudioAiAssistToolId, prompt: string) => void;
  applyBrandKitFont: (font: string) => void;
  applyBrandKitLogo: (kit: BrandKit) => void;
  applyCollage: (payload: { canvasH: number; canvasBg: string; frames: readonly { x: number; y: number; width: number; height: number; bg: string; stroke: string; strokeWidth: number; name: string; groupId: string; }[]; groupId: string; imagePlacements: readonly { imageId: string; slotIndex: number; x: number; y: number; width: number; height: number; }[]; replaceExisting: boolean; }) => void;
  applyMagicResizePreset: (preset: MagicResizePreset) => void;
  applyPanelLayout: (layout: PanelLayoutPreset) => Promise<void>;
  applyStudioBackgroundFill: (payload: { kind: "solid" | "gradient" | "svg"; color?: string; stops?: string[]; direction?: "vertical" | "horizontal"; svg?: string; width?: number; height?: number; label?: string; presetId?: string; }) => Promise<void>;
  applyTemplate: (tpl: TemplateSpec) => void;
  beginTrackedStudioAiOperation: (scope: string, input: Omit<StudioAiPendingOperationInput, "id">) => string;
  deleteClip: (id: string) => Promise<void>;
  disarmAllPixelTools: () => void;
  ensureRecentColorsLoaded: () => void;
  enterCanvasOnlyMode: () => void;
  executeSuggestColorPalette: () => Promise<void>;
  executeSuggestDialogueLines: () => Promise<void>;
  fitCanvasToWidth: () => void;
  handleRenameAsset: (id: string) => Promise<void>;
  insertAiCompositionNote: (text: string) => void;
  insertClip: (clip: StudioClip) => void;
  insertDialogueSuggestionToSelected: (candidate: DialogueSuggestionCandidate) => void;
  insertStockImage: (photo: StudioStockPhoto, dataUrl: string, width: number, height: number) => void;
  loadSharedAssets: () => Promise<void>;
  loadMoreSharedAssets: () => Promise<void>;
  onDeleteAsset: (id: string) => Promise<void>;
  onDeleteSharedAsset: (id: string) => Promise<void>;
  onReportSharedAsset: (asset: SharedAssetCatalogItem, reason: CreatorAssetReportReason, details: string) => Promise<void>;
  onGenerateAiBackground: () => void;
  onGenerateAiCharacter: () => void;
  onGenerateAsset: () => Promise<void>;
  onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onShareAsset: (asset: StudioAsset, options: StudioAssetShareOptions) => Promise<void>;
  onUploadAsset: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onUseSharedAsset: (asset: SharedAssetCatalogItem) => Promise<void>;
  openFeatureTutorial: (tutorialId?: string | null) => void;
  pendingTextAiProviderContext: () => import( "./ai/studio-ai-provenance-recorder").StudioAiOperationProviderContext;
  redo: () => void;
  rememberColor: (c: string) => void;
  removeEmeresUnderlays: () => void;
  resetView: () => void;
  setActualPixelView: () => void;
  saveSelectionAsClip: () => Promise<void>;
  saveSuggestedPaletteToLibrary: (suggestion: PaletteSuggestion) => void;
  setCanvasH: (newH: number | ((prev: number) => number)) => void;
  settleTrackedTextAiOperation: (operationId: string, result: StudioAiObservableResult, textProvenance?: StudioTextAiProvenance, aborted?: boolean) => void;
  toggleAdvancedFill: () => void;
  toggleAssetFavorite: (id: StudioAssetFavoriteId) => void;
  toggleFullscreen: () => void;
  toggleMaximize: () => void;
  toggleSelectedFrameDiagonal: () => void;
  undo: () => void;
  updateAiSettings: (next: StudioAiSettings) => void;
  updateServerAiProvider: (next: StudioServerAiProviderPreference) => void;
}

export interface StudioToolBeltContentProps {
  activePage: PageState;
  activeServerAiProviderLabel: string;
  activeSurfaceReviewLocked: boolean;
  activeToolbarGroup: StudioToolbarGroupId | null;
  advancedFillActive: boolean;
  advancedFillUnsupportedReason: string | null;
  aiAssistTool: StudioAiAssistToolId;
  aiBgBusy: boolean;
  aiBgError: string | null;
  aiBgPrompt: string;
  aiBgSize: StudioAiImageSize;
  aiCharacterBusy: boolean;
  aiCharacterError: string | null;
  aiCharacterPrompt: string;
  aiCompositionDraft: string;
  aiDialogueSuggestBusy: boolean;
  aiDialogueSuggestCandidates: DialogueSuggestionCandidate[] | null;
  aiDialogueSuggestError: string | null;
  aiDialogueSuggestIncludeContext: boolean;
  aiDialogueSuggestSituation: string;
  aiPaletteSuggestBusy: boolean;
  aiPaletteSuggestError: string | null;
  aiPaletteSuggestion: PaletteSuggestion | null;
  aiPaletteSuggestMood: string;
  aiPaletteSuggestSavedMsg: string | null;
  aiRecentPrompts: StudioAiRecentPromptsState;
  aiSettings: StudioAiSettings;
  assetFavoriteOnly: boolean;
  assetFavoriteState: StudioAssetFavoriteState;
  assetGenerating: boolean;
  assetPrompt: string;
  assetPromptName: string;
  assetPromptQuality: GeneratedAssetQuality;
  assetPromptSize: GeneratedAssetSize;
  assets: StudioAsset[];
  assetSearchQuery: string;
  assetsLoading: boolean;
  assetSortOrder: StudioAssetSortOrder;
  assetTab: StudioAssetTab;
  bg: string;
  bg3dOpen: boolean;
  bgGrad: string[] | null;
  bgSceneGenreFilter: string;
  bgSceneSearchQuery: string;
  bgSceneSectionsFiltered: { genre: string; scenes: StudioBgScene[]; }[];
  builtinRasterBusyId: string | null;
  canvasH: number;
  canvasOnlyMode: boolean;
  clips: StudioClip[];
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  color: string;
  commentsOpen: boolean;
  configuredServerAiProviders: { id: import("./studio-server-ai-client").StudioServerAiProvider; label: string; configured: boolean; model: string; }[];
  continuityOpen: boolean;
  dialogueScript: string;
  drawMode: DrawMode;
  elements: El[];
  emeresCategoryFilter: string;
  emeresFlatCatalog: StudioEmeresTemplate[];
  emeresSearchQuery: string;
  emeresSectionsFiltered: { category: string; templates: StudioEmeresTemplate[]; }[];
  emeresSimilarAnchor: StudioEmeresTemplate | null;
  emeresSimilarSiblings: StudioEmeresTemplate[];
  emeresTab: "mine" | "catalog";
  emeresUnderlayCount: number;
  frameAnimOpen: boolean;
  frameAnimTargetId: string | null;
  fxComicFiltered: StudioFxAsset[];
  fxCreatureFiltered: StudioFxAsset[];
  fxEmojisFiltered: string[];
  fxLinePresetsFiltered: { id: "focus" | "speed"; label: string; }[];
  fxOverlaysFiltered: StudioFxAsset[];
  fxPickerHasResults: boolean;
  fxPickerSection: FxPickerSection;
  fxPropFiltered: StudioFxAsset[];
  fxQuery: string;
  fxRasterFiltered: readonly StudioRasterAsset[];
  fxSearchQuery: string;
  fxSectionVisible: (section: Exclude<FxPickerSection, "all">) => boolean;
  fxSfxFiltered: SfxPreset[];
  hi: number;
  history: PageState[][];
  historyPanelOpen: boolean;
  isFullscreen: boolean;
  magicResizeStrategy: MagicResizeStrategy;
  masterEditMode: boolean;
  maximized: boolean;
  menu: StudioMenu | null;
  menuRef: import("react").RefObject<HTMLDivElement | null>;
  openStudioCommentCount: number;
  pageEditLocked: boolean;
  pageReviewOpen: boolean;
  mannequinPoserOpen: boolean;
  panelLayoutPresets: PanelLayoutPreset[];
  panelLayoutsError: string | null;
  panelLayoutsLoading: boolean;
  poserVrmOpen: boolean;
  characterShaperOpen: boolean;
  presentationPanelsHidden: boolean;
  publishingId: string | null;
  rasterFavoriteOnly: boolean;
  recentColors: string[];
  referencePanelOpen: boolean;
  renamingAssetId: string | null;
  renamingAssetName: string;
  sceneSimilarAnchor: SceneTemplate | null;
  sceneSimilarSiblings: SceneTemplate[];
  sceneTemplates: StudioSceneTemplatePacks;
  sceneTemplatesError: string | null;
  sceneTemplatesLoading: boolean;
  selected: El | null;
  serverAiProvider: StudioServerAiProviderPreference;
  serverAiStatus: StudioServerAiStatus | null;
  setAiAssistTool: import("react").Dispatch<import("react").SetStateAction<StudioAiAssistToolId>>;
  setAiBgPrompt: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAiBgSize: import("react").Dispatch<import("react").SetStateAction<StudioAiImageSize>>;
  setAiCharacterPrompt: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAiCompositionDraft: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAiDialogueSuggestIncludeContext: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setAiDialogueSuggestSituation: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAiPaletteSuggestMood: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAiRecentPrompts: import("react").Dispatch<import("react").SetStateAction<StudioAiRecentPromptsState>>;
  setAssetFavoriteOnly: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setAssetPrompt: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAssetPromptName: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAssetPromptQuality: import("react").Dispatch<import("react").SetStateAction<GeneratedAssetQuality>>;
  setAssetPromptSize: import("react").Dispatch<import("react").SetStateAction<GeneratedAssetSize>>;
  setAssetSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  setAssetSortOrder: import("react").Dispatch<import("react").SetStateAction<StudioAssetSortOrder>>;
  setAssetTab: import("react").Dispatch<import("react").SetStateAction<StudioAssetTab>>;
  setBg3dInitialDataUrl: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setBg3dInitialElementId: import("react").Dispatch<import("react").SetStateAction<string | undefined>>;
  setBg3dInitialScene: import("react").Dispatch<import("react").SetStateAction<StudioBg3dSceneDocument | undefined>>;
  setBg3dOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setBgSceneGenreFilter: import("react").Dispatch<import("react").SetStateAction<string>>;
  setBgSceneSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  setColor: import("react").Dispatch<import("react").SetStateAction<string>>;
  setCommentsOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setContinuityOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setDialogueBatchOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setDialogueScript: import("react").Dispatch<import("react").SetStateAction<string>>;
  setDialogueTranslateOpen: import("react").Dispatch<import("react").SetStateAction<StudioDialogueTranslateSurface>>;
  setDrawMode: import("react").Dispatch<import("react").SetStateAction<DrawMode>>;
  setEmeresCategoryFilter: import("react").Dispatch<import("react").SetStateAction<string>>;
  setEmeresSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  setEmeresSimilarAnchorId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setEmeresTab: import("react").Dispatch<import("react").SetStateAction<"mine" | "catalog">>;
  setFxPickerSection: import("react").Dispatch<import("react").SetStateAction<FxPickerSection>>;
  setFxSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  setHistoryPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setLeftPanelOpen?: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setMagicResizeStrategy: import("react").Dispatch<import("react").SetStateAction<MagicResizeStrategy>>;
  setMenu: import("react").Dispatch<import("react").SetStateAction<StudioMenu | null>>;
  setMannequinPoserOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPageReviewOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPoserVrmOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setCharacterShaperOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setRasterFavoriteOnly: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setReferencePanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setRenamingAssetId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setRenamingAssetName: import("react").Dispatch<import("react").SetStateAction<string>>;
  setScale: import("react").Dispatch<import("react").SetStateAction<number>>;
  setScenarioOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSceneSimilarAnchorId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setScrollPreviewOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setStoryboardGridOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setRightPanelOpen?: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTeamPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTimelapseOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTimelineOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setToneSearchQuery: import("react").Dispatch<import("react").SetStateAction<string>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
  setZoom: import("react").Dispatch<import("react").SetStateAction<number>>;
  sfxError: string | null;
  sfxLoading: boolean;
  sfxPacks: StudioSfxPacks | null;
  shared: SharedAssetCatalogItem[];
  sharedDocument: StudioSharedDocument | null;
  sharedError: string | null;
  sharedHasMore: boolean;
  sharedLoading: boolean;
  sharedLoadingMore: boolean;
  studioBgSceneAssetsError: string | null;
  studioBgSceneAssetsLoaded: boolean;
  studioBgSceneAssetsLoading: boolean;
  studioEmeresAssetsError: string | null;
  studioEmeresAssetsLoaded: boolean;
  studioEmeresAssetsLoading: boolean;
  studioOptionalAssets: StudioOptionalAssetPacks;
  studioSfx: StudioSfxPacks;
  studioStickerAssetsError: string | null;
  studioStickerAssetsLoaded: boolean;
  studioStickerAssetsLoading: boolean;
  teamPanelOpen: boolean;
  textAiConfigured: boolean;
  textAiTransport: StudioTextAiTransport;
  timelineOpen: boolean;
  toneSearchQuery: string;
  tool: Tool;
  uiDensityMode: "focus" | "simple" | "full";
  visibleLeftPanelOpen: boolean;
  visibleRightPanelOpen: boolean;
  toggleWorkspaceWideMode: () => void;
  wrapRef: import("react").RefObject<HTMLDivElement | null>;
  zoom: number;
  stableHandlers: StudioToolBeltContentHandlers;
}

export const StudioToolBeltContent = memo(function StudioToolBeltContent(
  props: StudioToolBeltContentProps
) {
  const {
    canvasOnlyMode,
    collaborationDocumentLocked,
    collaborationLockMessage,
    hi,
    history,
    historyPanelOpen,
    isFullscreen,
    maximized,
    presentationPanelsHidden,
    setHistoryPanelOpen,
    setZoom,
    uiDensityMode,
    visibleLeftPanelOpen,
    visibleRightPanelOpen,
    toggleWorkspaceWideMode,
    zoom,
    stableHandlers,
  } = props;
  const isWorkspaceWideMode = !visibleLeftPanelOpen && !visibleRightPanelOpen;
  const isUndoDisabled = hi === 0 || collaborationDocumentLocked;
  const isRedoDisabled = hi >= history.length - 1 || collaborationDocumentLocked;
  const {
    enterCanvasOnlyMode,
    fitCanvasToWidth,
    redo,
    resetView,
    setActualPixelView,
    toggleFullscreen,
    toggleMaximize,
    undo,
  } = stableHandlers;

  const fitCanvasToWidthWithFocus = () => {
    fitCanvasToWidth();
    if (!isWorkspaceWideMode && !presentationPanelsHidden) {
      toggleWorkspaceWideMode();
    }
  };

  return (
    <>
        {/* 모바일: 가로 스크롤 가능 힌트(좌측 페이드). 데스크톱에선 숨김. */}
        <span aria-hidden className="pointer-events-none sticky left-0 -ml-1 h-8 w-2 shrink-0 self-stretch bg-gradient-to-r from-panel to-transparent lg:hidden" />
        {/* Quick Actions — undo/redo/history always near the left of the top bar */}
        {studioUiDensityAllows(uiDensityMode, "quick-actions") ? (
          <StudioToolBeltQuickActions
            collaborationDocumentLocked={collaborationDocumentLocked}
            collaborationLockMessage={collaborationLockMessage}
            buttonClass={iconToolBtnTouch}
            hi={hi}
            history={history}
            historyPanelOpen={historyPanelOpen}
            isRedoDisabled={isRedoDisabled}
            isUndoDisabled={isUndoDisabled}
            redo={redo}
            setHistoryPanelOpen={setHistoryPanelOpen}
            toolBtn={toolBtn}
            undo={undo}
          />
        ) : null}
        <StudioToolbarDivider />
        <StudioToolBeltCreateModeGroups
          hints={TOOL_BELT_HINTS}
          studioCanvasImageAccept={STUDIO_CANVAS_IMAGE_ACCEPT}
          toolBelt={props}
        />
        {/* 줌·화면 맞춤·캔버스 최대화 — 모바일은 하단 도구막대가 대체 */}
        <StudioToolBeltCanvasControls
          canvasOnlyMode={canvasOnlyMode}
          isFullscreen={isFullscreen}
          maximized={maximized}
          presentationPanelsHidden={presentationPanelsHidden}
          zoom={zoom}
          isWorkspaceWideMode={isWorkspaceWideMode}
          toolBtn={toolBtn}
          setZoom={setZoom}
          enterCanvasOnlyMode={enterCanvasOnlyMode}
          onFitCanvasToWidth={fitCanvasToWidthWithFocus}
          resetView={resetView}
          setActualPixelView={setActualPixelView}
          toggleWorkspaceWideMode={toggleWorkspaceWideMode}
          toggleMaximize={toggleMaximize}
          toggleFullscreen={toggleFullscreen}
          hints={{
            zoomOut: TOOL_BELT_HINTS.zoomOut,
            zoomIn: TOOL_BELT_HINTS.zoomIn,
            actualSize: TOOL_BELT_HINTS.actualSize,
            fitWidth: TOOL_BELT_HINTS.fitWidth,
            resetView: TOOL_BELT_HINTS.resetView,
            workspaceFocus: TOOL_BELT_HINTS.workspaceFocus,
            workspaceRestore: TOOL_BELT_HINTS.workspaceRestore,
            maximizeWindow: TOOL_BELT_HINTS.maximizeWindow,
            restoreWindow: TOOL_BELT_HINTS.restoreWindow,
            fullscreen: TOOL_BELT_HINTS.fullscreen,
            exitFullscreen: TOOL_BELT_HINTS.exitFullscreen,
            canvasOnly: TOOL_BELT_HINTS.canvasOnly,
          }}
        />
    </>
  );
});
