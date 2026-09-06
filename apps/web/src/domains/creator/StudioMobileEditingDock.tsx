import {
  ArrowDownToLine,
  ArrowUpToLine,
  Download,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Files,
  Grid3X3,
  Hand,
  Layers,
  Lock,
  LockOpen,
  MessageCircle,
  MessageSquareText,
  Minus,
  MousePointer2,
  PaintBucket,
  Palette,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Search,
  Shapes,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  Suspense,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { DRAW_COLOR_SWATCHES } from "./brush/studio-draw-color-swatches";
import { STUDIO_DRAW_SHAPE_PICKER_KINDS } from "./brush/studio-draw-hud";
import {
  STUDIO_BRUSH_OPACITY_RANGE,
  STUDIO_BRUSH_SIZE_RANGE,
} from "./brush/studio-draw-ux";
import { resolveStudioBrushPresetOperation } from "./studio-brush";
import {
  StudioContextActionButton,
  StudioDockButton,
  StudioDockNavButton,
} from "./studio-chrome-ui";
import { elementLabel } from "./studio-element-label";
import { requestStudioCommandSearch } from "./studio-help-center-channel";
import { preloadStudioInspectorDrawingSurface } from "./studio-inspector-aside-loader";
import { localizeStudioText } from "./studio-localize-text";
import {
  STUDIO_MOBILE_DRAW_SHEET_COMPACT_MIN_HEIGHT,
  STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP,
  STUDIO_MOBILE_PAGES_SHEET_ID,
  STUDIO_MOBILE_SHEET_DEFAULT_SNAP,
  studioMobileSheetSizeStyle,
  type StudioMobileSheetSnap,
} from "./studio-mobile-sheet-snap";
import { STUDIO_EASE } from "./studio-panel-ui";
import {
  STUDIO_ERASE_TO_INTERSECTION_LABEL,
  STUDIO_ERASE_TO_INTERSECTION_TIP,
} from "./studio-vector-erase-to-intersection-apply";
import { StudioColorBlindPreviewToggle } from "./StudioColorBlindPreviewToggle";
import {
  StudioEraserQuickPicker,
  type StudioEraserQuickPickerId,
} from "./StudioEraserQuickPicker";
import { StudioLineCorrectionControls } from "./StudioLineCorrectionControls";
import {
  StudioLivingInkControls,
  type StudioLivingInkControlsProps,
} from "./StudioLivingInkControls";
import { StudioSavedBrushShelf } from "./StudioSavedBrushShelf";

import type {
  StudioBrushDefaultRestoreDirection,
  StudioBrushDefaultRestoreTransaction,
} from "./brush/studio-brush-default-restore";
import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioBrushDynamicsPresetId,
} from "./brush/studio-brush-dynamics";
import type { StudioBrushEngineProgramSet } from "./brush/studio-brush-engine-program-set";
import type {
  DeletedBrushRecord,
  StudioBrushSnapshot,
  StudioBrushStampTuning,
  StudioSavedBrush,
} from "./brush/studio-brush-library";
import type {
  StudioBrushCatalogCloseReason,
  StudioBrushCatalogPlacement,
  StudioBrushCatalogRestoredView,
} from "./brush/StudioBrushLibrarySheet";
import type { StudioBrushDefaultRestoreViewState } from "./brush/useStudioBrushBaselineController";
import type { StudioFilterKind } from "./filter/studio-filter-menu";
import type { BrushPreset } from "./studio-brush";
import type { CvdMode } from "./studio-color-vision-model";
import type { StudioBrushTrayItem } from "./studio-creative-ux";
import type {
  DrawMode,
  DrawShapeKind,
  StudioMenu,
  Tool,
} from "./studio-editor-tool-model";
import type { El } from "./studio-element-model";
import type { StudioInspectorRoute } from "./studio-inspector-layout";
import type { PageState } from "./studio-page-state";
import type { StudioProDrawPrefs } from "./studio-pro-draw-prefs";
import type { StudioWorkspaceState } from "./studio-workspaces";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
const MOBILE_DRAW_SETTINGS_ID = "studio-mobile-draw-settings";
const MOBILE_WORKSPACE_TOOLS_ID = "studio-mobile-workspace-tools";
const STUDIO_MOBILE_FILTER_KINDS = [
  ["gaussian-blur", "가우시안 블러"],
  ["motion-blur", "모션 블러"],
  ["hue-saturation-brightness", "색조 / 채도 / 밝기"],
  ["brightness-contrast", "명도 / 대비"],
  ["color-curves", "색상 커브"],
] as const satisfies readonly (readonly [StudioFilterKind, string])[];

type StudioDrawSheetStyle = CSSProperties & {
  "--studio-draw-sheet-height": string;
  "--studio-draw-sheet-reserved-bottom": string;
};

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 20) / 20));
}

function syncStudioMobileScrollCue(scroller: HTMLDivElement | null): void {
  if (!scroller) return;
  const host = scroller.closest<HTMLElement>("[data-studio-mobile-scroll-host]");
  if (!host) return;

  const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const overflow = maxScrollLeft > 1;
  const before = overflow && scroller.scrollLeft > 1;
  const after = overflow && scroller.scrollLeft < maxScrollLeft - 1;
  host.style.setProperty("--studio-mobile-scroll-before", before ? "1" : "0");
  host.style.setProperty("--studio-mobile-scroll-after", after ? "1" : "0");
  scroller.dataset.studioMobileOverflow = !overflow
    ? "none"
    : before && after
      ? "both"
      : before
        ? "before"
        : "after";

  const status = host.querySelector<HTMLElement>("[data-studio-mobile-scroll-status]");
  if (!status) return;
  status.textContent = !overflow
    ? "현재 도구막대의 모든 도구가 표시되어 있습니다."
    : before && after
      ? "왼쪽과 오른쪽에 도구가 더 있습니다. 도구막대를 좌우로 밀어 이동하세요."
      : before
        ? "왼쪽에 도구가 더 있습니다. 도구막대를 오른쪽으로 밀어 이동하세요."
        : "오른쪽에 도구가 더 있습니다. 도구막대를 왼쪽으로 밀어 이동하세요.";
}

function StudioMobileScrollCues({
  descriptionId,
  placement,
}: {
  descriptionId: string;
  placement: "primary" | "secondary";
}) {
  return (
    <>
      <span
        aria-hidden
        data-studio-mobile-scroll-cue={`${placement}-before`}
        className="pointer-events-none absolute inset-y-0 left-0 z-[2] grid w-5 place-items-center bg-gradient-to-r from-panel via-panel/80 to-transparent text-[0.8rem] font-black leading-none text-fg-2 opacity-0 transition-opacity"
        style={{ opacity: "var(--studio-mobile-scroll-before, 0)" }}
      >
        ‹
      </span>
      <span
        aria-hidden
        data-studio-mobile-scroll-cue={`${placement}-after`}
        className="pointer-events-none absolute inset-y-0 right-0 z-[2] grid w-5 place-items-center bg-gradient-to-l from-panel via-panel/80 to-transparent text-[0.8rem] font-black leading-none text-fg-2 opacity-0 transition-opacity"
        style={{ opacity: "var(--studio-mobile-scroll-after, 0)" }}
      >
        ›
      </span>
      <span
        id={descriptionId}
        data-studio-mobile-scroll-status={placement}
        className="sr-only"
      >
        도구막대를 좌우로 밀면 숨은 도구를 볼 수 있습니다.
      </span>
    </>
  );
}

function studioDrawSheetSizeStyle(
  snap: StudioMobileSheetSnap,
  keyboardInset: number,
): StudioDrawSheetStyle {
  const baseSize = studioMobileSheetSizeStyle(
    snap,
    keyboardInset,
    // Only the compact snap needs the floor; medium and full are already taller than it everywhere.
    snap === "compact" ? STUDIO_MOBILE_DRAW_SHEET_COMPACT_MIN_HEIGHT : undefined,
  );
  // Some compact editor breakpoints intentionally reduce the root rem size while the dock keeps
  // 44px touch targets plus borders/padding. A rem-only inset can therefore become shorter than
  // the physical dock and let the draw sheet cover its top edge. Keep a pixel floor that reflects
  // the real one-row dock while retaining the larger expanded/safe-area CSS variable.
  const reservedBottom =
    `calc(max(var(--studio-canvas-bottom-inset, 7rem), calc(72px + env(safe-area-inset-bottom))) + ${keyboardInset}px)`;
  const height = `min(${String(baseSize.height)}, calc(100dvh - env(safe-area-inset-top) - 0.75rem - ${reservedBottom}))`;
  return {
    "--studio-draw-sheet-height": height,
    "--studio-draw-sheet-reserved-bottom": reservedBottom,
    bottom: "var(--studio-draw-sheet-reserved-bottom)",
    height: "var(--studio-draw-sheet-height)",
    maxHeight: "var(--studio-draw-sheet-height)",
  };
}

interface StudioMobileFilterSelectProps {
  filterMutationLocked: boolean;
  filterPreparationBusy: boolean;
  filterTargetLabel: "선택 이미지" | "현재 페이지 합성본";
  filterUnavailableReason: string | null;
  onSelect: (kind: StudioFilterKind) => void;
  placement: "context" | "workspace";
}

/**
 * Keeps the invisible native select affordance identical in both thumb-reachable mobile rows.
 * The visible shell remains a 44px target while native selection provides familiar mobile UX.
 */
function StudioMobileFilterSelect({
  filterMutationLocked,
  filterPreparationBusy,
  filterTargetLabel,
  filterUnavailableReason,
  onSelect,
  placement,
}: StudioMobileFilterSelectProps) {
  const guidanceId = useId();
  const unavailableReason = filterUnavailableReason ?? (
    filterMutationLocked ? "편집 잠금을 해제한 뒤 필터를 적용하세요." : null
  );
  const disabled = unavailableReason !== null || filterPreparationBusy;
  const guidance = filterPreparationBusy
    ? `${filterTargetLabel}: 필터 미리보기를 준비하는 중입니다.`
    : unavailableReason
      ? `${filterTargetLabel}: ${unavailableReason}`
      : `${filterTargetLabel}: 적용할 필터를 선택하세요.`;
  const shellClassName = cn(
    "relative flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.62rem] font-semibold text-fg-2",
    STUDIO_EASE,
    "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-raised",
  );

  if (disabled) {
    return (
      <button
        type="button"
        data-studio-mobile-filter-select={placement}
        data-studio-mobile-filter-target={filterTargetLabel}
        aria-busy={filterPreparationBusy}
        aria-disabled="true"
        aria-label={`${filterTargetLabel} 필터를 사용할 수 없음`}
        aria-describedby={guidanceId}
        className={shellClassName}
        title={guidance}
      >
        <WandSparkles size={16} aria-hidden />
        <span>필터</span>
        <span id={guidanceId} className="sr-only">{guidance}</span>
      </button>
    );
  }

  return (
    <label
      data-studio-mobile-filter-select={placement}
      data-studio-mobile-filter-target={filterTargetLabel}
      className={shellClassName}
      title={guidance}
    >
      <WandSparkles size={16} aria-hidden />
      <span>필터</span>
      <span id={guidanceId} className="sr-only">{guidance}</span>
      <select
        aria-label={`${filterTargetLabel} 필터 선택`}
        aria-describedby={guidanceId}
        defaultValue=""
        title={guidance}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={(event) => {
          const kind = event.currentTarget.value as StudioFilterKind;
          if (!kind) return;
          onSelect(kind);
          event.currentTarget.value = "";
        }}
      >
        <option value="" disabled>필터 선택</option>
        {STUDIO_MOBILE_FILTER_KINDS.map(([kind, label]) => (
          <option key={kind} value={kind}>{label}</option>
        ))}
      </select>
    </label>
  );
}

export interface StudioBrushCatalogHandlers {
  close: (
    reason: StudioBrushCatalogCloseReason
  ) => void;
  selectBrushId: (brushId: string) => void;
  toggle: (
    placement: StudioBrushCatalogPlacement,
    trigger: HTMLButtonElement
  ) => void;
  toggleFavorite: (brushId: string) => void;
  /** Records where the artist left the catalogue so the next visit reopens there. */
  rememberView?: (view: StudioBrushCatalogRestoredView) => void;
}

export interface StudioMobileEditingDockHandlers {
  activateCanvasTool: (
    tool: "select" | "draw",
    drawMode?: DrawMode
  ) => void;
  applyBuiltInBrushPreset: (preset: BrushPreset) => void;
  /** 엔진 조합 변경 — 브러시 스튜디오의 조합 탭이 호출한다. */
  onBrushEngineProgramsChange?: (next: StudioBrushEngineProgramSet | null) => void;
  applyBrushDefaultRestoreTransaction: (
    transaction: StudioBrushDefaultRestoreTransaction,
    direction: StudioBrushDefaultRestoreDirection,
  ) => void;
  applyDynamicsPreset: (id: StudioBrushDynamicsPresetId, settings: NormalizedStudioBrushDynamicsSettings) => void;
  applySavedBrush: (saved: StudioSavedBrush) => void;
  dismissBrushManager: () => void;
  dismissMobileHint: () => void;
  duplicateSelected: () => void;
  /** 선택한 말풍선·글자를 캔버스 위 편집기로 연다(데스크톱 선택 옵션 바와 같은 구현). */
  editSelectionText: () => void;
  fitCanvasToWidth: () => void;
  openBrushManager: (launcher: HTMLButtonElement) => void;
  openInspectorRoute: (
    route: StudioInspectorRoute,
    mobileSheetTarget?: StudioMobileSheet | null
  ) => void;
  openStudioFilter: (kind: StudioFilterKind) => void;
  queueBrushDelete: (deleted: DeletedBrushRecord) => void;
  redo: () => void;
  removeSelected: () => void;
  reorder: (dir: "front" | "back" | "forward" | "backward") => void;
  restoreBrushDefaults: () => void;
  toggleAdvancedFill: () => void;
  /** 선택(그룹 상속 포함)의 잠금을 토글한다 — 데스크톱 선택 명령 레인과 같은 구현. */
  toggleSelectionLock: () => void;
  toggleStudioCommentPinPlacement: () => void;
  undo: () => void;
  handleDownload?: () => void;
}

export interface StudioMobileEditingDockUi {
  StudioBrushLibraryPanel: typeof import("./studio-page-lazy-ui").StudioBrushLibraryPanel;
  StudioBrushStudio: typeof import("./studio-page-lazy-ui").StudioBrushStudio;
  StudioMobileSheetHandle: typeof import("./StudioMobileSheetHandle").StudioMobileSheetHandle;
  StudioShapePickerGrid: typeof import("./studio-page-lazy-ui").StudioShapePickerGrid;
  StudioUnifiedBrushPicker: typeof import("./studio-page-lazy-ui").StudioUnifiedBrushPicker;
  loadStudioBrushStudio: typeof import("./studio-page-lazy-ui").loadStudioBrushStudio;
}

export type StudioMobileSheet =
  | "draw"
  | "pages"
  | "props"
  | "brushes"
  | "color-vision"
  | null;

export interface StudioMobileEditingDockProps {
  activeCatalogBrushId: string;
  activeCatalogBrushName: string;
  activeSavedBrushId: string | null;
  activeSurfaceReviewLocked: boolean;
  advancedFillActive: boolean;
  advancedFillUnsupportedReason: string | null;
  brush: string;
  brushCatalogHandlers: StudioBrushCatalogHandlers;
  brushCatalogItems?: readonly StudioBrushTrayItem[];
  brushCatalogOpen: boolean;
  brushDefaultRestore: StudioBrushDefaultRestoreViewState;
  brushDynamics: NormalizedStudioBrushDynamicsSettings;
  brushManagerSheetRef: import("react").RefObject<HTMLDivElement | null>;
  brushOpacity: number;
  collaborationDocumentLocked: boolean;
  commentPinArmed: boolean;
  color: string;
  colorBlindPreview: CvdMode;
  colorVisionSheetRef: import("react").RefObject<HTMLElement | null>;
  currentBrushSnapshot: StudioBrushSnapshot;
  drawMode: DrawMode;
  drawShape: DrawShapeKind;
  drawSheetRef: import("react").RefObject<HTMLDivElement | null>;
  /** CSP vector eraser: click freehand to erase between nearest intersections. */
  eraseToIntersection?: boolean;
  filterMutationLocked: boolean;
  filterPreparationBusy: boolean;
  filterTargetLabel: "선택 이미지" | "현재 페이지 합성본";
  filterUnavailableReason: string | null;
  hi: number;
  history: PageState[][];
  /**
   * 통합 실행취소 저널의 다음 ⌘Z/⇧⌘Z 대상이 사이드카 편집(캐릭터 바이블·Writer Room)인가.
   * 이 문서들은 `history` 스냅샷 밖이라 `hi` 만 보면 동작하는 ⌘Z 버튼이 꺼진 채로 보인다.
   */
  sidecarUndoAvailable?: boolean;
  sidecarRedoAvailable?: boolean;
  isMobile: boolean;
  livingInk: StudioLivingInkControlsProps;
  marqueeIds: string[];
  mobileBrushDockButtonRef: import("react").RefObject<HTMLButtonElement | null>;
  mobileKeyboardInset: number;
  mobileQuickActionsButton: ReactNode;
  mobileSheet: StudioMobileSheet;
  postCorrection: number;
  preserveCorners: boolean;
  pressureCurve: number;
  pressureMinSize?: number;
  setPressureMinSize?: (value: number) => void;
  proDrawPrefs: StudioProDrawPrefs;
  quickActionsOpen: boolean;
  savedBrushes: StudioSavedBrush[];
  /** Page-owned product authority shared with imports and the desktop projection. */
  openBrushLibraryRepository?: () => Promise<
    import("./brush/studio-brush-library-sqlite-repository").ProductBrushLibraryRepository
  >;
  selected: El | null;
  /**
   * 현재 선택이 (그룹 상속을 포함해) 잠겨 있는지. 빠른 작업 바의 잠금 버튼 라벨이
   * 실제로 일어날 동작을 가리키게 하려면 토글 구현과 같은 판정을 써야 한다.
   */
  selectionLocked: boolean;
  /**
   * 말풍선이면 "대사 편집", 글자·스티커면 "글자 편집", 편집할 수 없으면 null.
   * 데스크톱 선택 옵션 바와 같은 계산 결과를 그대로 받는다.
   */
  selectionTextEditLabel: "대사 편집" | "글자 편집" | null;
  setBrushDynamics: import("react").Dispatch<import("react").SetStateAction<NormalizedStudioBrushDynamicsSettings>>;
  setBrushOpacity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setColor: import("react").Dispatch<import("react").SetStateAction<string>>;
  setColorBlindPreview: import("react").Dispatch<import("react").SetStateAction<CvdMode>>;
  setDrawMode: import("react").Dispatch<import("react").SetStateAction<DrawMode>>;
  setDrawShape: import("react").Dispatch<import("react").SetStateAction<DrawShapeKind>>;
  setEraseToIntersection?: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setMarqueeIds: import("react").Dispatch<import("react").SetStateAction<string[]>>;
  setMenu: import("react").Dispatch<import("react").SetStateAction<StudioMenu | null>>;
  setMobileSheet: import("react").Dispatch<import("react").SetStateAction<StudioMobileSheet>>;
  setPostCorrection: import("react").Dispatch<import("react").SetStateAction<number>>;
  setPreserveCorners: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setPressureCurve: import("react").Dispatch<import("react").SetStateAction<number>>;
  setQuickStartOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setSavedBrushes: import("react").Dispatch<import("react").SetStateAction<StudioSavedBrush[]>>;
  setSelectedId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  setShapeFill: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setStampTuning: import("react").Dispatch<import("react").SetStateAction<StudioBrushStampTuning | null>>;
  setStabilizer: import("react").Dispatch<import("react").SetStateAction<number>>;
  setStabilizerMode: import("react").Dispatch<import("react").SetStateAction<"standard" | "adaptive" | "precision">>;
  setStrokeWidth: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTiltEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setTipAngle: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTipRoundness: import("react").Dispatch<import("react").SetStateAction<number>>;
  setTool: import("react").Dispatch<import("react").SetStateAction<Tool>>;
  setUseVelocityPressure: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  setVelocitySensitivity: import("react").Dispatch<import("react").SetStateAction<number>>;
  setZoom: import("react").Dispatch<import("react").SetStateAction<number>>;
  shapeFill: boolean;
  showMobileHint: boolean;
  stabilizer: number;
  stabilizerMode: "standard" | "adaptive" | "precision";
  stampTuning: StudioBrushStampTuning | null;
  strokeWidth: number;
  tiltEnabled: boolean;
  tipAngle: number;
  tipRoundness: number;
  tool: Tool;
  ui: StudioMobileEditingDockUi;
  useVelocityPressure: boolean;
  velocitySensitivity: number;
  workspaceState: StudioWorkspaceState;
  zoom: number;
  stableHandlers: StudioMobileEditingDockHandlers;
}

export const StudioMobileEditingDock = memo(function StudioMobileEditingDock({
  activeCatalogBrushId,
  activeCatalogBrushName,
  activeSavedBrushId,
  activeSurfaceReviewLocked,
  advancedFillActive,
  advancedFillUnsupportedReason,
  brush,
  brushCatalogHandlers,
  brushCatalogItems,
  brushCatalogOpen,
  brushDefaultRestore,
  brushDynamics,
  brushManagerSheetRef,
  brushOpacity,
  collaborationDocumentLocked,
  commentPinArmed,
  color,
  colorBlindPreview,
  colorVisionSheetRef,
  currentBrushSnapshot,
  drawMode,
  drawShape,
  drawSheetRef,
  eraseToIntersection = false,
  filterMutationLocked,
  filterPreparationBusy,
  filterTargetLabel,
  filterUnavailableReason,
  hi,
  history,
  sidecarUndoAvailable = false,
  sidecarRedoAvailable = false,
  isMobile,
  livingInk,
  marqueeIds,
  mobileBrushDockButtonRef,
  mobileKeyboardInset,
  mobileQuickActionsButton,
  mobileSheet,
  postCorrection,
  preserveCorners,
  pressureCurve,
  pressureMinSize,
  setPressureMinSize,
  proDrawPrefs,
  quickActionsOpen,
  savedBrushes,
  openBrushLibraryRepository,
  selected,
  selectionLocked,
  selectionTextEditLabel,
  setBrushDynamics,
  setBrushOpacity,
  setColor,
  setColorBlindPreview,
  setDrawShape,
  setEraseToIntersection,
  setMarqueeIds,
  setMenu,
  setMobileSheet,
  setPostCorrection,
  setPreserveCorners,
  setPressureCurve,
  setQuickStartOpen,
  setSavedBrushes,
  setSelectedId,
  setShapeFill,
  setStampTuning,
  setStabilizer,
  setStabilizerMode,
  setStrokeWidth,
  setTiltEnabled,
  setTipAngle,
  setTipRoundness,
  setUseVelocityPressure,
  setVelocitySensitivity,
  setZoom,
  shapeFill,
  showMobileHint,
  stabilizer,
  stabilizerMode,
  stampTuning,
  strokeWidth,
  tiltEnabled,
  tipAngle,
  tipRoundness,
  tool,
  ui,
  useVelocityPressure,
  velocitySensitivity,
  workspaceState,
  zoom,
  stableHandlers,
}: StudioMobileEditingDockProps) {
  const {
    StudioBrushLibraryPanel,
    StudioBrushStudio,
    StudioMobileSheetHandle,
    StudioShapePickerGrid,
    StudioUnifiedBrushPicker,
    loadStudioBrushStudio,
  } = ui;
  const {
    activateCanvasTool,
    applyBuiltInBrushPreset,
    onBrushEngineProgramsChange,
    applyBrushDefaultRestoreTransaction,
    applyDynamicsPreset,
    applySavedBrush,
    dismissBrushManager,
    dismissMobileHint,
    duplicateSelected,
    editSelectionText,
    fitCanvasToWidth,
    openBrushManager,
    openInspectorRoute,
    openStudioFilter,
    queueBrushDelete,
    redo,
    removeSelected,
    reorder,
    restoreBrushDefaults,
    toggleAdvancedFill,
    toggleSelectionLock,
    toggleStudioCommentPinPlacement,
    undo,
    handleDownload,
  } = stableHandlers;
  const t = useT();
  const localizedWorkspaceToggle = localizeStudioText(
    t,
    "작업 메뉴",
    "studio.mobileDock.workspaceToggle",
  );
  // 도크 라벨은 로케일 팩 키를 우선하고, 팩이 아직 안 붙었거나 키가 없으면 저작 한국어로 되돌아온다.
  // 기존 키가 정확히 같은 의미면 새 키를 만들지 않고 재사용한다(75개 팩 전부에 이미 번역이 있다).
  const label = {
    dock: localizeStudioText(t, "스튜디오 모바일 도구막대", "studio.mobileDock.label"),
    drawingTools: localizeStudioText(t, "드로잉 도구", "studio.mobileDock.drawingTools"),
    workspaceTools: localizeStudioText(t, "작업 공간", "studio.mobileDock.workspaceTools"),
    pages: localizeStudioText(t, "페이지", "studio.mobileDock.tool.pages"),
    export: localizeStudioText(t, "내보내기", "studio.mobileDock.tool.export"),
    exportAria: localizeStudioText(t, "현재 페이지 다운로드", "studio.commandBar.command.download"),
    search: localizeStudioText(t, "찾기", "studio.mobileDock.tool.search"),
    searchAria: localizeStudioText(t, "기능·설정 찾기", "studio.commandSearch.label"),
    searchTitle: localizeStudioText(
      t,
      "기능·설정 찾기 · CSP·Photoshop 용어로도 검색",
      "studio.mobileDock.tool.search.title",
    ),
    select: localizeStudioText(t, "선택", "studio.settings.tool.select"),
    pen: localizeStudioText(t, "펜", "studio.settings.tool.pen"),
    pixel: localizeStudioText(t, "픽셀", "studio.mobileDock.tool.pixel"),
    eraser: localizeStudioText(t, "지우개", "studio.settings.tool.eraser"),
    fill: localizeStudioText(t, "채우기", "studio.mainMenu.item.draw.fill"),
    shape: localizeStudioText(t, "도형", "studio.mobileDock.tool.shape"),
    undo: localizeStudioText(t, "되돌리기", "studio.mobileDock.tool.undo"),
    undoAria: localizeStudioText(t, "실행취소", "studio.mainMenu.item.edit.command.undo"),
    redo: localizeStudioText(t, "다시", "studio.mobileDock.tool.redo"),
    redoAria: localizeStudioText(t, "다시실행", "studio.mainMenu.item.edit.command.redo"),
    brush: localizeStudioText(t, "브러시", "studio.quickStart.step.brush-kit.label"),
    pagesOpenAria: localizeStudioText(t, "페이지 목록 열기", "studio.mobileDock.pagesOpen"),
    pagesCloseAria: localizeStudioText(t, "페이지 목록 닫기", "studio.mobileDock.pagesClose"),
    brushSettings: localizeStudioText(
      t,
      "브러시 설정 (굵기·색·프리셋)",
      "studio.mobileDock.brushSettings",
    ),
    // 한국어 팩의 레거시 "작업"·"도구"는 무엇이 펼쳐지는지 설명하지 못했다. 기존 키의
    // 다른 로케일 번역(Tools 등)은 유지하면서 한국어 표시만 동작에 맞는 이름으로 정리한다.
    workspaceToggle:
      localizedWorkspaceToggle === "작업" || localizedWorkspaceToggle === "도구"
        ? "작업 메뉴"
        : localizedWorkspaceToggle,
    collapse: localizeStudioText(t, "접기", "studio.toolsCompanion.layoutSettings.collapse"),
  };
  // 브러시 시트는 판단 대상인 캔버스 위에 뜬다. medium 으로 열면 360×640 에서 캔버스가 126행(19.7%)만
  // 남아 굵기를 바꿔도 결과를 볼 수 없다. compact 로 열고 그래버로 승격하게 둔다.
  const [drawSheetSnap, setDrawSheetSnap] = useState<StudioMobileSheetSnap>(
    STUDIO_MOBILE_DRAW_SHEET_DEFAULT_SNAP,
  );
  const [brushManagerSheetSnap, setBrushManagerSheetSnap] = useState<StudioMobileSheetSnap>(
    STUDIO_MOBILE_SHEET_DEFAULT_SNAP,
  );
  const [workspaceDockExpanded, setWorkspaceDockExpanded] = useState<boolean>(false);
  const scrollDescriptionId = useId();
  const primaryDockScrollRef = useRef<HTMLDivElement>(null);
  const secondaryDockScrollRef = useRef<HTMLDivElement>(null);
  const suppressBrushHintOnReturnFocusRef = useRef(false);
  const dismissDrawSettings = () => {
    suppressBrushHintOnReturnFocusRef.current = true;
    setMobileSheet(null);
  };
  const mobileControlSide = workspaceState.mobileControlSide === "left" ? "left" : "right";
  const colorVisionOpen = mobileSheet === "color-vision";
  const safeMobileKeyboardInset = Number.isFinite(mobileKeyboardInset)
    ? Math.max(0, Math.round(mobileKeyboardInset))
    : 0;
  const drawSettingsOpen = mobileSheet === "draw";
  const drawSettingsVisible = drawSettingsOpen && !brushCatalogOpen;
  const selectionModeActive = tool === "select" && !advancedFillActive;
  const penModeActive = tool === "draw" && drawMode === "pen";
  const pixelModeActive = tool === "draw" && drawMode === "pixel";
  const shapeModeActive = tool === "draw" && drawMode === "shape";
  const eraserPresetActive =
    drawMode === "eraser" && resolveStudioBrushPresetOperation(brush) === "erase";
  const activeEraserQuickId: StudioEraserQuickPickerId =
    brush === "kneaded-eraser" ? "kneaded-eraser" : "standard-eraser";
  const undoDisabled = (hi === 0 && !sidecarUndoAvailable) || collaborationDocumentLocked;
  const redoDisabled =
    (hi >= history.length - 1 && !sidecarRedoAvailable) || collaborationDocumentLocked;
  const undoUnavailableTitle = collaborationDocumentLocked
    ? "공동 작업 문서 잠금을 해제한 뒤 편집 기록을 이동할 수 있어요."
    : "아직 되돌릴 편집 기록이 없어요.";
  const redoUnavailableTitle = collaborationDocumentLocked
    ? "공동 작업 문서 잠금을 해제한 뒤 편집 기록을 이동할 수 있어요."
    : "다시 적용할 편집 기록이 없어요.";
  const brushDefaultRestoreModified = brushDefaultRestore.modifiedCount > 0;
  const brushDefaultRestoreDisabled =
    brushDefaultRestore.loading
    || !brushDefaultRestore.available
    || (!brushDefaultRestoreModified && !brushDefaultRestore.undoAvailable);
  const brushDefaultRestoreDescriptionId =
    `${scrollDescriptionId}-brush-default-restore`;
  const brushDefaultRestoreDescription = brushDefaultRestore.loading
    ? `${brushDefaultRestore.sourceName} 기본값을 확인하고 있어요.`
    : !brushDefaultRestore.available
      ? "브러시 목록에서 다시 선택하면 안전한 기본값 기준을 새로 불러옵니다."
      : brushDefaultRestore.undoAvailable
        ? "방금 적용한 전체 설정 복원을 한 번 되돌릴 수 있어요."
        : brushDefaultRestoreModified
          ? `굵기·불투명도·필압·보정·촉 중 ${brushDefaultRestore.modifiedCount}개 설정이 기본값과 달라요. 현재 색상은 유지됩니다.`
          : "굵기·불투명도·필압·보정·촉이 이미 기본값이에요. 현재 색상은 유지됩니다.";
  const brushDefaultRestoreLabel = brushDefaultRestore.loading
    ? "확인 중"
    : !brushDefaultRestore.available
      ? "기준 없음"
      : brushDefaultRestore.undoAvailable
        ? "복원 되돌리기"
        : brushDefaultRestoreModified
          ? "기본값 복원"
          : "기본값";
  const selectedSupportsContextFilter =
    marqueeIds.length === 0 &&
    selected !== null;
  const workspaceDockHasActiveTool =
    commentPinArmed ||
    quickActionsOpen ||
    mobileSheet === "pages" ||
    mobileSheet === "props" ||
    mobileSheet === "color-vision";
  const workspaceToggleAccessibleLabel = workspaceDockExpanded
    ? `${label.collapse} · ${label.workspaceToggle}`
    : label.workspaceToggle;

  useEffect(() => {
    if (!isMobile || mobileSheet === null) return;
    setQuickStartOpen(false);
  }, [isMobile, mobileSheet, setQuickStartOpen]);

  useEffect(() => {
    if (!isMobile) return;
    const scrollers = [
      primaryDockScrollRef.current,
      secondaryDockScrollRef.current,
    ].filter((scroller): scroller is HTMLDivElement => scroller !== null);
    const update = () => {
      for (const scroller of scrollers) syncStudioMobileScrollCue(scroller);
    };
    update();
    const frame = globalThis.requestAnimationFrame?.(update) ?? null;
    const observer = typeof globalThis.ResizeObserver === "function"
      ? new globalThis.ResizeObserver(update)
      : null;
    for (const scroller of scrollers) {
      scroller.addEventListener("scroll", update, { passive: true });
      observer?.observe(scroller);
    }
    globalThis.addEventListener("resize", update);
    return () => {
      if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
      for (const scroller of scrollers) {
        scroller.removeEventListener("scroll", update);
        observer?.unobserve(scroller);
      }
      observer?.disconnect();
      globalThis.removeEventListener("resize", update);
    };
  }, [isMobile, workspaceDockExpanded]);

  const penHintPreviewProps = penModeActive
    ? {
        hintPreview: "draw-settings" as const,
        hintPreviewVariant: drawSettingsOpen ? "collapse" as const : "expand" as const,
      }
    : { hintPreview: "ink" as const };
  const shapeHintPreviewProps = shapeModeActive
    ? {
        hintPreview: "draw-settings" as const,
        hintPreviewVariant: drawSettingsOpen ? "collapse" as const : "expand" as const,
      }
    : {
        hintPreview: "shape" as const,
        hintPreviewVariant: drawShape,
      };
  return (
    <>
        {/* Photoshop Mobile식 선택 문맥 작업바. 속성 패널까지 왕복하지 않고 가장 빈번한 후속 행동을
            엄지 영역에 노출한다. 선택이 없거나 시트/첫 안내가 열리면 캔버스를 가리지 않도록 숨긴다.

            모바일에는 상단 선택 레인(선택 옵션 44px + 선택 명령 51px)이 아예 없다 — 그 95px 은
            전부 그리기 면적으로 돌아갔다. 대신 레인에만 있던 두 명령(잠금 · 대사/글자 편집)을
            이 바가 넘겨받는다. 라벨과 아이콘은 데스크톱 레인과 같은 용어를 쓴다. */}
        {isMobile && !mobileSheet && !quickActionsOpen && !showMobileHint && (selected || marqueeIds.length > 0) ? (
          <div
            role="toolbar"
            aria-label="선택 항목 빠른 작업"
            className="fixed inset-x-2 z-[53] mx-auto flex max-w-[34rem] items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-panel/95 p-1.5 shadow-2xl backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden"
            style={{
              bottom: `calc(var(--studio-canvas-bottom-inset, 7rem) + 0.35rem + ${safeMobileKeyboardInset}px)`,
            }}
          >
            <div className="w-[4.75rem] shrink-0 px-2">
              <p className="truncate text-[0.68rem] font-bold text-fg">
                {marqueeIds.length > 0
                  ? `${marqueeIds.length}개 선택`
                  : selected
                    ? elementLabel(selected)
                    : "선택"}
              </p>
              <p className="text-[0.58rem] font-medium uppercase tracking-wide text-fg-3">빠른 작업</p>
            </div>
            <span aria-hidden className="h-8 w-px shrink-0 bg-line" />
            <StudioContextActionButton
              icon={SlidersHorizontal}
              label="속성"
              data-studio-selection-properties-trigger="true"
              onClick={() => {
                openInspectorRoute({ primary: "properties" }, "props");
                // Keep the thumb-bar action responsive even when the shared route helper defers
                // sheet presentation for desktop-to-mobile layout stabilization. The helper still
                // records this button as the return-focus target; this immediate state write only
                // removes the otherwise visible two-frame dead period.
                setMobileSheet("props");
              }}
            />
            {/* 말풍선·글자를 고른 순간에만 뜬다. 더블탭으로도 편집에 들어가지만 그건 보이지
                않는 제스처라, 데스크톱 선택 옵션 바와 같은 자리·같은 라벨로 노출해 둔다.
                잠기거나 검수 잠금이면 라벨이 null 로 와서 항목 자체가 사라진다. */}
            {selectionTextEditLabel && marqueeIds.length === 0 ? (
              <StudioContextActionButton
                icon={MessageSquareText}
                label={selectionTextEditLabel}
                className="whitespace-nowrap"
                title={`${selectionTextEditLabel} · 요소를 더블탭해도 열려요`}
                onClick={editSelectionText}
              />
            ) : null}
            {selectedSupportsContextFilter ? (
              <StudioMobileFilterSelect
                filterMutationLocked={filterMutationLocked}
                filterPreparationBusy={filterPreparationBusy}
                filterTargetLabel={filterTargetLabel}
                filterUnavailableReason={filterUnavailableReason}
                onSelect={openStudioFilter}
                placement="context"
              />
            ) : null}
            {selected?.type === "image" && marqueeIds.length === 0 ? (
              <>
                <StudioContextActionButton
                  icon={PaintBucket}
                  label="채우기"
                  active={advancedFillActive}
                  title={advancedFillUnsupportedReason
                    ? `${advancedFillUnsupportedReason} 눌러서 사용할 수 있는 래스터를 찾거나 조건을 확인하세요.`
                    : "고급 채우기"}
                  onClick={toggleAdvancedFill}
                />
              </>
            ) : null}
            <StudioContextActionButton icon={Copy} label="복제" onClick={duplicateSelected} />
            {selected && marqueeIds.length === 0 ? (
              <>
                <StudioContextActionButton icon={ArrowUpToLine} label="앞으로" onClick={() => reorder("front")} />
                <StudioContextActionButton icon={ArrowDownToLine} label="뒤로" onClick={() => reorder("back")} />
              </>
            ) : null}
            {/* 잠금은 상단 레인에만 있던 명령이라 모바일에서 사라지면 안 된다. 그룹 상속 잠금과
                다중 선택까지 데스크톱과 같은 구현으로 처리한다. */}
            <StudioContextActionButton
              icon={selectionLocked ? LockOpen : Lock}
              label={selectionLocked ? "잠금 해제" : "잠금"}
              className="whitespace-nowrap"
              active={selectionLocked}
              title={selectionLocked
                ? "잠금을 풀어 다시 이동·변형·편집할 수 있게 합니다."
                : "선택 요소를 고정해 실수로 이동하거나 편집하지 않도록 보호합니다."}
              onClick={toggleSelectionLock}
            />
            <StudioContextActionButton icon={Trash2} label="삭제" danger onClick={removeSelected} />
            <StudioContextActionButton
              icon={X}
              label="해제"
              onClick={() => {
                setSelectedId(null);
                setMarqueeIds([]);
              }}
            />
          </div>
        ) : null}

        {/* 모바일 첫 사용 안내 — 하단 도구막대 + 두 손가락 이동/확대를 한 줄로. 1회만, 시트가 떠 있지 않을 때만. */}
        {showMobileHint && !mobileSheet && !quickActionsOpen && (
          <div
            role="status"
            data-studio-canvas-transient="coach"
            className="fixed inset-x-3 z-[53] mx-auto flex max-w-[32rem] items-start gap-2.5 rounded-2xl border border-accent/30 bg-panel/95 p-3 shadow-2xl backdrop-blur motion-safe:animate-hud-in lg:hidden"
            style={{
              bottom: `calc(var(--studio-canvas-bottom-inset, 7rem) + 0.5rem + ${safeMobileKeyboardInset}px)`,
            }}
          >
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Hand size={15} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8rem] font-semibold text-fg">한 손으로 그려보세요</p>
              <p className="mt-0.5 text-[0.72rem] leading-snug text-fg-3">
                아래 막대에서 <span className="font-medium text-fg-2">펜·픽셀 펜·지우개·도형</span>을 고르고,{" "}
                <span className="font-medium text-fg-2">브러시</span>를 눌러 굵기·색을 바꿔요. 두 손가락으로
                이동·확대하고, 짧게 두 손가락 톡은 되돌리기·세 손가락 톡은 다시 실행이에요.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissMobileHint}
              className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised"
              aria-label="안내 닫기"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        )}

        {/* 모바일 전용 브러시 관리자 — 일반 속성 패널을 거치지 않고 저장·고정·복제·내보내기에 바로 접근한다. */}
        {isMobile && mobileSheet === "brushes" ? (
          <div
            ref={brushManagerSheetRef}
            role="dialog"
            aria-modal="true"
            data-studio-sheet-id="brushes"
            data-studio-mobile-sheet="true"
            data-studio-sheet-snap={brushManagerSheetSnap}
            data-popup-kind="sheet"
            aria-label="내 브러시 관리"
            tabIndex={-1}
            data-studio-shortcut-boundary="true"
            className="fixed inset-x-0 z-[60] mx-auto max-w-[34rem] overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-panel px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl transition-[height,max-height] duration-300 ease-out motion-reduce:transition-none lg:hidden"
            style={{
              bottom: safeMobileKeyboardInset,
              ...studioMobileSheetSizeStyle(
                brushManagerSheetSnap,
                safeMobileKeyboardInset,
              ),
            }}
          >
            <div className="sticky top-0 z-10 -mx-3 mb-2 border-b border-line bg-panel/95 px-3 backdrop-blur">
              <StudioMobileSheetHandle
                active
                kind="brushes"
                label="내 브러시 관리"
                onDismiss={dismissBrushManager}
                onSnapChange={setBrushManagerSheetSnap}
                sheetRef={brushManagerSheetRef}
                snap={brushManagerSheetSnap}
              />
              <div className="flex min-h-12 items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-fg">내 브러시 관리</p>
                  <p className="text-[0.68rem] text-fg-3">저장·고정·복제·이름 변경·내보내기</p>
                </div>
                <button
                  type="button"
                  onClick={dismissBrushManager}
                  className="grid size-11 place-items-center rounded-xl text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label="브러시 관리 닫기"
                  data-autofocus
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
            </div>
            <Suspense fallback={<p className="py-6 text-center text-xs text-fg-3">브러시를 불러오는 중…</p>}>
              <StudioBrushLibraryPanel
                currentSnapshot={currentBrushSnapshot}
                brushes={savedBrushes}
                activeBrushId={activeSavedBrushId}
                onBrushesChange={setSavedBrushes}
                onApplyBrush={applySavedBrush}
                onBrushDeleted={queueBrushDelete}
                {...(openBrushLibraryRepository
                  ? { repositoryFactory: openBrushLibraryRepository }
                  : {})}
              />
            </Suspense>
          </div>
        ) : null}

        {/* 모바일 브러시 설정 시트 — 드로잉 도크 바로 위에 떠서 도구를 보며 굵기·색·프리셋·도형을 조절한다.
            도크(z-55)는 가리지 않게 그 위쪽에 앉히고, 캔버스는 계속 보이게 반투명 배경. 데스크톱엔 인라인 브러시 바가 있으므로 모바일 전용. */}
        {isMobile && (
          <div
            id={MOBILE_DRAW_SETTINGS_ID}
            ref={drawSheetRef}
            role={drawSettingsVisible ? "dialog" : undefined}
            aria-label={drawSettingsVisible ? "브러시 설정" : undefined}
            aria-modal={drawSettingsVisible ? false : undefined}
            aria-hidden={drawSettingsVisible ? undefined : true}
            tabIndex={drawSettingsVisible ? -1 : undefined}
            data-studio-sheet-id="draw"
            data-studio-mobile-sheet={mobileSheet === "draw" ? "draw" : undefined}
            data-studio-sheet-snap={drawSheetSnap}
            className={cn(
              "fixed inset-x-0 z-[54] mx-auto max-w-[34rem] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-panel/95 p-3 shadow-2xl backdrop-blur transition-[transform,opacity,height,max-height] duration-300 ease-out motion-reduce:transition-none lg:hidden",
              drawSettingsVisible
                ? "pointer-events-auto translate-y-0 opacity-100"
                : "pointer-events-none translate-y-3 opacity-0"
            )}
            inert={drawSettingsVisible ? undefined : true}
            style={studioDrawSheetSizeStyle(
              drawSheetSnap,
              safeMobileKeyboardInset,
            )}
          >
            <div className="sticky -top-3 z-10 -mx-3 -mt-3 mb-2 border-b border-line/70 bg-panel/95 px-3 backdrop-blur">
              <StudioMobileSheetHandle
                active={mobileSheet === "draw"}
                kind="draw"
                label="브러시 설정"
                onDismiss={dismissDrawSettings}
                onSnapChange={setDrawSheetSnap}
                sheetRef={drawSheetRef}
                snap={drawSheetSnap}
              />
              <div className="flex min-h-12 items-center justify-between">
                <p className="text-sm font-semibold text-fg">
                  {drawMode === "eraser"
                    ? eraserPresetActive ? activeCatalogBrushName : "지우개"
                    : drawMode === "shape"
                      ? "도형"
                      : drawMode === "pixel"
                        ? "픽셀 펜"
                        : "브러시"} 설정
                </p>
                <button
                  type="button"
                  onClick={dismissDrawSettings}
                  className="grid size-11 place-items-center rounded-xl text-fg-3 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label="브러시 설정 닫기"
                  data-autofocus
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>

            {/* 굵기·색이 시트의 첫 화면에 오도록 유지한다. 이 둘은 캔버스를 보면서 조절하는 값이라
                프리셋·선 보정보다 먼저 와야 compact 스냅에서도 스크롤 없이 손이 닿는다. */}
            {/* 굵기 + 투명도 — 큰 터치 슬라이더 */}
            <div className="mb-2.5 space-y-2.5">
              {drawMode !== "pixel" ? <div>
                <span className="mb-1 flex items-center justify-between text-[0.7rem] font-medium text-fg-3">
                  <span>{drawMode === "eraser" ? "지우개 굵기" : "굵기"}</span>
                  <span className="tabular-nums text-fg-2">{strokeWidth}px</span>
                </span>
                <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
                  <input
                    type="range"
                    min={STUDIO_BRUSH_SIZE_RANGE.min}
                    max={STUDIO_BRUSH_SIZE_RANGE.max}
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="h-11 w-full accent-accent"
                    aria-label="브러시 굵기 슬라이더"
                  />
                  <label className="sr-only" htmlFor="mobile-brush-width">브러시 굵기 숫자</label>
                  <input
                    id="mobile-brush-width"
                    type="number"
                    min={STUDIO_BRUSH_SIZE_RANGE.min}
                    max={STUDIO_BRUSH_SIZE_RANGE.max}
                    inputMode="numeric"
                    value={strokeWidth}
                    onChange={(event) =>
                      setStrokeWidth(
                        Math.min(
                          STUDIO_BRUSH_SIZE_RANGE.max,
                          Math.max(
                            STUDIO_BRUSH_SIZE_RANGE.min,
                            Number(event.target.value) || STUDIO_BRUSH_SIZE_RANGE.min
                          )
                        )
                      )
                    }
                    className="min-h-11 w-full rounded-lg border border-line bg-card px-2 text-center text-xs tabular-nums text-fg outline-none focus:border-accent"
                  />
                </div>
              </div> : null}
              {(drawMode !== "eraser" || eraserPresetActive) && (
                <div>
                  <span className="mb-1 flex items-center justify-between text-[0.7rem] font-medium text-fg-3">
                    <span>{drawMode === "eraser" ? "지우기 강도" : "투명도"}</span>
                    <span className="tabular-nums text-fg-2">{Math.round(brushOpacity * 100)}%</span>
                  </span>
                  <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
                    <input
                      type="range"
                      min={STUDIO_BRUSH_OPACITY_RANGE.min * 100}
                      max={STUDIO_BRUSH_OPACITY_RANGE.max * 100}
                      step={1}
                      value={Math.round(brushOpacity * 100)}
                      onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)}
                      className="h-11 w-full accent-accent"
                      aria-label={drawMode === "eraser" ? "지우기 강도 슬라이더" : "브러시 투명도 슬라이더"}
                    />
                    <label className="sr-only" htmlFor="mobile-brush-opacity">
                      {drawMode === "eraser" ? "지우기 강도 숫자" : "브러시 투명도 숫자"}
                    </label>
                    <input
                      id="mobile-brush-opacity"
                      type="number"
                      min={STUDIO_BRUSH_OPACITY_RANGE.min * 100}
                      max={STUDIO_BRUSH_OPACITY_RANGE.max * 100}
                      step={1}
                      inputMode="numeric"
                      value={Math.round(brushOpacity * 100)}
                      onChange={(event) =>
                        setBrushOpacity(
                          Math.min(
                            STUDIO_BRUSH_OPACITY_RANGE.max * 100,
                            Math.max(
                              STUDIO_BRUSH_OPACITY_RANGE.min * 100,
                              Number(event.target.value) || STUDIO_BRUSH_OPACITY_RANGE.min * 100
                            )
                          ) / 100
                        )
                      }
                      className="min-h-11 w-full rounded-lg border border-line bg-card px-2 text-center text-xs tabular-nums text-fg outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 색상 — 지우개에선 의미 없으니 숨김 */}
            {drawMode !== "eraser" && (
              <div className="mb-2.5">
                <p className="mb-1 text-[0.7rem] font-medium text-fg-3">색상</p>
                <div className="flex flex-wrap items-center gap-2">
                  {DRAW_COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setColor(swatch)}
                      aria-label={`색상 ${swatch}`}
                      aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                      className={cn(
                        "size-11 rounded-xl transition-transform active:scale-95",
                        color.toLowerCase() === swatch.toLowerCase()
                          ? "ring-2 ring-accent ring-offset-2 ring-offset-panel"
                          : "border border-line/60"
                      )}
                      style={{ background: swatch }}
                    />
                  ))}
                  <label
                    className="relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-xl border border-line shadow-sm"
                    title="사용자 정의 색상"
                    style={{ background: color }}
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      aria-label="사용자 정의 브러시 색상"
                      className="absolute inset-[-1px] h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0"
                    />
                    <Palette size={14} className="text-white mix-blend-difference" aria-hidden />
                  </label>
                </div>
              </div>
            )}

            {/* 모드 전환 — 일반 브러시와 1px raw 픽셀 도구를 같은 것으로 오인하지 않게 분리한다. */}
            <div className="mb-2.5 grid grid-cols-4 gap-1 rounded-xl border border-line bg-card/60 p-1" role="group" aria-label="그리기 모드">
              {([
                { v: "pen" as const, label: "펜", icon: Pencil },
                { v: "pixel" as const, label: "픽셀 펜", icon: Grid3X3 },
                { v: "eraser" as const, label: "지우개", icon: Eraser },
                { v: "shape" as const, label: "도형", icon: Shapes },
              ]).map((m) => {
                const Icon = m.icon;
                const active = drawMode === m.v;
                return (
                  <button
                    key={m.v}
                    type="button"
                    onClick={() => {
                      if (!active) {
                        activateCanvasTool("draw", m.v);
                      }
                    }}
                    aria-pressed={active}
                    aria-label={m.label}
                    title={m.label}
                    className={cn(
                      "grid min-h-11 place-items-center rounded-lg transition-colors",
                      active ? "bg-accent text-on-accent shadow-sm" : "text-fg-2 hover:bg-raised"
                    )}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                );
              })}
            </div>

            {drawMode === "pixel" ? (
              <div
                data-studio-mobile-pixel-pencil-identity="true"
                role="status"
                className="mb-2.5 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft/30 p-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent" aria-hidden>
                  <Grid3X3 size={20} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-xs font-extrabold text-fg">픽셀 펜 · 1px 고정</strong>
                  <span className="mt-1 block text-[0.68rem] leading-relaxed text-fg-3">
                    격자 정렬 · 안티앨리어싱 없음 · 필압 없음 · 선 보정 없음
                  </span>
                </span>
              </div>
            ) : null}

            {drawMode === "eraser" && setEraseToIntersection ? (
              <div
                data-studio-mobile-erase-to-intersection="true"
                className="mb-2.5 rounded-2xl border border-line bg-card/60 p-3"
              >
                <button
                  type="button"
                  aria-pressed={eraseToIntersection}
                  aria-label={STUDIO_ERASE_TO_INTERSECTION_LABEL}
                  data-studio-erase-to-intersection="true"
                  onClick={() => {
                    setEraseToIntersection((prev) => !prev);
                  }}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    eraseToIntersection
                      ? "border-accent/60 bg-accent-soft/40 text-accent"
                      : "border-line bg-card text-fg-2 hover:bg-raised"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl",
                      eraseToIntersection ? "bg-accent/15 text-accent" : "bg-raised text-fg-3"
                    )}
                    aria-hidden
                  >
                    <Scissors size={18} strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-xs font-extrabold text-fg">
                      {STUDIO_ERASE_TO_INTERSECTION_LABEL}
                    </strong>
                    <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3">
                      {eraseToIntersection
                        ? "켜짐 · 자유선 위를 탭하면 교차 사이만 지웁니다"
                        : STUDIO_ERASE_TO_INTERSECTION_TIP}
                    </span>
                  </span>
                </button>
              </div>
            ) : null}

            {drawMode === "eraser" && mobileSheet === "draw" ? (
              <section
                aria-label="지우개 종류"
                className="mb-2.5 rounded-2xl border border-line/70 bg-card/45 p-2"
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div>
                    <p className="text-xs font-extrabold text-fg">지우개 종류</p>
                    <p className="mt-0.5 text-[0.66rem] text-fg-3">
                      한 번에 지울 양과 남는 결과를 보고 선택하세요.
                    </p>
                  </div>
                </div>
                <StudioEraserQuickPicker
                  selectedId={activeEraserQuickId}
                  onSelect={(id) => brushCatalogHandlers.selectBrushId(id)}
                  ariaLabel="모바일 지우개 종류 빠른 선택"
                />
              </section>
            ) : null}

            {/* 펜 프리셋 — 데스크톱과 같은 현재/빠른 선반/전체 카탈로그 구조 */}
            {drawMode === "pen" && mobileSheet === "draw" && (
              <>
                <StudioSavedBrushShelf
                  brushes={savedBrushes}
                  activeBrushId={activeSavedBrushId}
                  onApply={applySavedBrush}
                  onManage={(event) => openBrushManager(event.currentTarget)}
                />
                <div className="mb-2.5">
                  <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-raised/40 motion-reduce:animate-none" aria-hidden />}>
                    <div
                      data-studio-mobile-unified-brush-layout="true"
                      className="min-w-0 [&_[data-studio-brush-tray=true]]:min-w-0 [&_[data-studio-brush-tray=true]>[role=listbox]]:min-w-0 [&_[data-studio-brush-tray=true]>[role=listbox]]:flex-1"
                    >
                      <StudioUnifiedBrushPicker
                        activeBrushId={brush}
                        activeCatalogBrushId={activeCatalogBrushId}
                        activeCatalogBrushName={activeCatalogBrushName}
                        brushOpacity={brushOpacity}
                        brushCatalogItems={brushCatalogItems}
                        catalogOpen={brushCatalogOpen}
                        color={color}
                        proDrawPrefs={proDrawPrefs}
                        stampTuning={stampTuning}
                        stabilizer={stabilizer}
                        stabilizerMode={stabilizerMode}
                        strokeWidth={strokeWidth}
                        tipAngle={tipAngle}
                        tipRoundness={tipRoundness}
                        onStampTuningChange={setStampTuning}
                        onSelectBrush={applyBuiltInBrushPreset}
                        onSelectBrushId={brushCatalogHandlers.selectBrushId}
                        onToggleCatalog={(trigger) =>
                          brushCatalogHandlers.toggle("mobile-sheet", trigger)
                        }
                        onToggleFavoriteBrush={brushCatalogHandlers.toggleFavorite}
                      />
                    </div>
                  </Suspense>
                </div>
                {livingInk.supported ? (
                  <section
                    aria-label="수채 번짐 빠른 도구"
                    data-studio-mobile-living-ink="true"
                    data-studio-brush-behavior="wash"
                    className="mb-2.5 rounded-2xl border border-line/70 bg-card/70 p-2"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                      <p className="text-[0.68rem] font-bold text-fg-2">수채 번짐</p>
                      <p className="text-[0.6rem] text-fg-3">안료 · 물 · 정착 · 지우기 · 크기·농도는 위와 동일</p>
                    </div>
                    <div className="overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <StudioLivingInkControls {...livingInk} />
                    </div>
                  </section>
                ) : null}
              </>
            )}

            {drawMode === "pen" ? (
              <div
              className={cn(
                "mt-2.5 rounded-xl border p-2.5",
                brushDefaultRestoreModified
                  ? "border-accent/45 bg-accent-soft/25"
                  : "border-line/70 bg-card/55",
              )}
              data-studio-mobile-brush-default-restore="true"
              data-studio-brush-preset-modified={
                brushDefaultRestoreModified ? "true" : "false"
              }
              data-studio-brush-preset-modified-count={
                brushDefaultRestore.modifiedCount
              }
            >
              <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.7rem] font-semibold text-fg-2">
                    {brushDefaultRestore.sourceName} 기본값
                  </p>
                  <p
                    id={brushDefaultRestoreDescriptionId}
                    className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3"
                  >
                    {brushDefaultRestoreDescription}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={brushDefaultRestoreDisabled}
                  aria-busy={brushDefaultRestore.loading}
                  aria-describedby={brushDefaultRestoreDescriptionId}
                  aria-label={
                    brushDefaultRestore.loading
                      ? `${brushDefaultRestore.sourceName} 기본값을 불러오는 중`
                      : !brushDefaultRestore.available
                        ? `${brushDefaultRestore.sourceName} 기본값 없음, 브러시를 다시 선택하세요`
                        : brushDefaultRestore.undoAvailable
                          ? `${brushDefaultRestore.sourceName} 기본값 복원 되돌리기`
                          : brushDefaultRestoreModified
                            ? `${brushDefaultRestore.sourceName} 기본값으로 복원, 변경된 설정 ${brushDefaultRestore.modifiedCount}개`
                            : `${brushDefaultRestore.sourceName} 기본값, 변경된 설정 없음`
                  }
                  onClick={restoreBrushDefaults}
                  className={cn(
                    "flex min-h-11 min-w-[7rem] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[0.68rem] font-bold",
                    STUDIO_EASE,
                    brushDefaultRestore.loading
                      ? "cursor-wait border-line bg-card text-fg-3"
                      : brushDefaultRestoreDisabled
                        ? "cursor-not-allowed border-line bg-card text-fg-3 opacity-55"
                        : brushDefaultRestoreModified
                          ? "border-accent/55 bg-accent text-on-accent hover:bg-accent-2"
                          : "border-line-strong bg-card text-fg-2 hover:bg-raised",
                  )}
                >
                  {brushDefaultRestore.undoAvailable ? (
                    <Undo2 size={15} aria-hidden />
                  ) : (
                    <RotateCcw
                      size={15}
                      className={cn(
                        brushDefaultRestore.loading
                          && "animate-spin motion-reduce:animate-none",
                      )}
                      aria-hidden
                    />
                  )}
                  <span>{brushDefaultRestoreLabel}</span>
                  {brushDefaultRestoreModified ? (
                    <span
                      aria-hidden
                      className="grid min-w-4 place-items-center rounded-full bg-current/10 px-1 text-[0.56rem] tabular-nums"
                    >
                      {brushDefaultRestore.modifiedCount}
                    </span>
                  ) : null}
                </button>
              </div>
              </div>
            ) : null}

            {drawMode !== "shape" && drawMode !== "pixel" ? (
              <>
                <StudioLineCorrectionControls
                  density="touch"
                  stabilizer={stabilizer}
                  onStabilizerChange={setStabilizer}
                  mode={stabilizerMode}
                  onModeChange={setStabilizerMode}
                  postCorrection={postCorrection}
                  onPostCorrectionChange={setPostCorrection}
                  preserveCorners={preserveCorners}
                  onPreserveCornersChange={setPreserveCorners}
                />
                <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-raised/35 motion-reduce:animate-none" aria-hidden />}>
                  <StudioBrushStudio
                    density="touch"
                    brushId={brush}
                    strokeWidth={strokeWidth}
                    color={color}
                    currentSnapshot={currentBrushSnapshot}
                    savedBrushBaseline={
                      activeSavedBrushId
                        ? savedBrushes.find((candidate) => candidate.id === activeSavedBrushId)
                          ?? null
                        : null
                    }
                    settings={brushDynamics}
                    onSettingsChange={setBrushDynamics}
                    onSelectDynamicsPreset={applyDynamicsPreset}
                    useVelocityPressure={useVelocityPressure}
                    onUseVelocityPressureChange={setUseVelocityPressure}
                    velocitySensitivity={velocitySensitivity}
                    onVelocitySensitivityChange={setVelocitySensitivity}
                    pressureCurve={pressureCurve}
                    onPressureCurveChange={setPressureCurve}
                    pressureMinSize={pressureMinSize ?? 0}
                    onPressureMinSizeChange={setPressureMinSize ?? (() => undefined)}
                    tiltEnabled={tiltEnabled}
                    onTiltEnabledChange={setTiltEnabled}
                    tipAngle={tipAngle}
                    onTipAngleChange={setTipAngle}
                    tipRoundness={tipRoundness}
                    onTipRoundnessChange={setTipRoundness}
                    onRestoreDefaults={applyBrushDefaultRestoreTransaction}
                    onEngineProgramsChange={onBrushEngineProgramsChange}
                    onBeforeOpen={() => setQuickStartOpen(false)}
                  />
                </Suspense>
              </>
            ) : null}

            {/* 도형 모양 + 채우기 — Photopea/Canva glyph strip (mobile touch) */}
            {drawMode === "shape" && (
              <div className="mt-2.5 border-t border-line/60 pt-2.5">
                <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-fg-3">
                  도형 모양
                </p>
                <Suspense fallback={<div className="h-24 rounded-xl bg-raised/40" aria-hidden />}>
                  <StudioShapePickerGrid
                    activeKind={drawShape}
                    filled={shapeFill}
                    onSelect={(kind) => setDrawShape(kind as DrawShapeKind)}
                    kinds={STUDIO_DRAW_SHAPE_PICKER_KINDS}
                    className="grid-cols-4"
                  />
                </Suspense>
                <button
                  type="button"
                  aria-pressed={shapeFill}
                  disabled={drawShape === "line" || drawShape === "arrow"}
                  title="채우기"
                  aria-label="도형 채우기"
                  onClick={() => setShapeFill((v) => !v)}
                  className={cn(
                    "mt-2 grid min-h-11 w-full place-items-center rounded-lg border transition-colors",
                    drawShape === "line" || drawShape === "arrow"
                      ? "cursor-not-allowed border-line bg-card text-fg-3 opacity-50"
                      : shapeFill
                        ? "border-accent/60 bg-accent-soft/50 text-accent"
                        : "border-line bg-card text-fg-2"
                  )}
                >
                  <PaintBucket size={18} aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}

        {isMobile && colorVisionOpen ? (
          <section
            ref={colorVisionSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="색각 검수"
            tabIndex={-1}
            data-studio-mobile-sheet="true"
            data-studio-shortcut-boundary="true"
            className="fixed inset-x-2 z-[60] mx-auto max-w-[32rem] rounded-2xl border border-line bg-panel/98 p-3 shadow-2xl backdrop-blur lg:hidden"
            style={{
              bottom: `calc(var(--studio-canvas-bottom-inset, 7rem) + 0.5rem + ${safeMobileKeyboardInset}px)`,
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[0.8rem] font-bold text-fg">색각·명암 검수</h2>
                <p className="text-[0.68rem] text-fg-3">원고를 바꾸지 않고 화면 표시만 전환합니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileSheet(null)}
                className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-2 hover:bg-raised"
                aria-label="색각 검수 닫기"
              >
                <X size={17} aria-hidden />
              </button>
            </div>
            <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <StudioColorBlindPreviewToggle
                value={colorBlindPreview}
                onChange={setColorBlindPreview}
              />
            </div>
          </section>
        ) : null}

        {/* 모바일 하단 드로잉 도크 — 한 손으로 그리기 위한 핵심 도구를 thumb 사정권에.
            1행: 가로 스크롤 그리기 도구 + 고정 도구 disclosure. 2행: 보조 내비와 작업 패널. */}
        {isMobile && (
          <nav
            aria-label={label.dock}
            data-studio-mobile-editing-dock="true"
            data-studio-mobile-dock-expanded={workspaceDockExpanded ? "true" : "false"}
            onFocusCapture={(event) => {
              if (!suppressBrushHintOnReturnFocusRef.current) return;
              suppressBrushHintOnReturnFocusRef.current = false;
              event.stopPropagation();
            }}
            className="fixed inset-x-0 bottom-0 z-[55] flex flex-col gap-1 border-t border-line bg-panel/95 pb-[max(0.35rem,env(safe-area-inset-bottom))] pl-[max(0.375rem,env(safe-area-inset-left))] pr-[max(0.375rem,env(safe-area-inset-right))] pt-1.5 backdrop-blur lg:hidden"
            style={{ bottom: safeMobileKeyboardInset }}
          >
            {/* 1행: 핵심 드로잉 도구 — 선택 | 펜/지우개/채우기/도형 | 히스토리 | 브러시 (CSP/Procreate 도크 IA) */}
            <div className="flex min-w-0 items-stretch gap-1">
              <div
                className="relative min-w-0 flex-1 overflow-hidden"
                data-studio-mobile-scroll-host="primary"
              >
                <div
                  ref={primaryDockScrollRef}
                  // 44px 드로잉 타깃 9개는 어느 폰에서도 한 줄에 들어가지 않는다. 우측 44px
                  // disclosure 를 고정해도 다음 도구의 일부와 페이드 큐가 남도록 작은 간격을 쓰고,
                  // 여유가 생기는 390px 부터만 4px 간격으로 넓힌다.
                  className="flex min-w-0 touch-pan-x items-stretch gap-0.5 overflow-x-auto overscroll-x-contain pr-1 [scrollbar-width:none] min-[390px]:gap-1 [&::-webkit-scrollbar]:hidden"
                  role="toolbar"
                  aria-label={label.drawingTools}
                  aria-describedby={`${scrollDescriptionId}-primary`}
                  data-studio-mobile-dock-scroll="primary"
                >
              <StudioDockButton
                icon={MousePointer2}
                label={label.select}
                hintDescription="요소를 선택해 이동·크기 조절·정렬하고 속성 패널에서 세부 값을 편집합니다."
                hintShortcut="V"
                active={selectionModeActive}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  activateCanvasTool("select");
                  setMenu(null);
                  setMobileSheet(null);
                }}
                aria-pressed={selectionModeActive}
              />
              <span aria-hidden className="my-1 w-px self-stretch bg-line/70" />
              <StudioDockButton
                icon={Pencil}
                label={label.pen}
                data-studio-primary-action="draw"
                hintDescription={penModeActive
                  ? drawSettingsOpen
                    ? "열려 있는 브러시 설정을 닫고 펜으로 그리던 캔버스로 돌아갑니다."
                    : "펜은 유지하고 브러시 설정을 열어 굵기·색·필압·보정을 조절합니다."
                  : "필압과 보정이 적용되는 자유선을 그립니다. 선택한 뒤 다시 누르면 브러시 설정을 열 수 있어요."}
                {...penHintPreviewProps}
                hintShortcut="B"
                active={penModeActive}
                disabled={activeSurfaceReviewLocked}
                title={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 펜을 사용할 수 있어요" : "펜 (B)"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  if (penModeActive) {
                    setMobileSheet((s) => (s === "draw" ? null : "draw"));
                    return;
                  }
                  activateCanvasTool("draw", "pen");
                  setMenu(null);
                  setMobileSheet(null);
                }}
                aria-pressed={penModeActive}
                aria-expanded={penModeActive ? drawSettingsOpen : undefined}
                aria-controls={penModeActive ? MOBILE_DRAW_SETTINGS_ID : undefined}
              />
              <StudioDockButton
                icon={Grid3X3}
                label={label.pixel}
                hintDescription={pixelModeActive
                  ? drawSettingsOpen
                    ? "픽셀 펜 설정을 닫고 1px 도트 작업으로 돌아갑니다."
                    : "픽셀 펜은 유지하고 색과 불투명도 설정을 엽니다."
                  : "안티앨리어싱·필압·선 보정 없이 격자에 1px 하드 픽셀을 찍습니다."}
                hintPreview="pixel-ink"
                hintShortcut="P"
                active={pixelModeActive}
                disabled={activeSurfaceReviewLocked}
                title={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 픽셀 펜을 사용할 수 있어요" : "픽셀 펜 (P)"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  if (pixelModeActive) {
                    setMobileSheet((sheet) => (sheet === "draw" ? null : "draw"));
                    return;
                  }
                  activateCanvasTool("draw", "pixel");
                  setMenu(null);
                  setMobileSheet(null);
                }}
                aria-pressed={pixelModeActive}
                aria-expanded={pixelModeActive ? drawSettingsOpen : undefined}
                aria-controls={pixelModeActive ? MOBILE_DRAW_SETTINGS_ID : undefined}
              />
              <StudioDockButton
                icon={Eraser}
                label={label.eraser}
                data-studio-mobile-tool="eraser"
                hintDescription="현재 레이어의 획을 지웁니다. 브러시 크기와 불투명도 설정을 그대로 활용합니다."
                hintShortcut="E"
                active={tool === "draw" && drawMode === "eraser"}
                disabled={activeSurfaceReviewLocked}
                title={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 지우개를 사용할 수 있어요" : "지우개 (E)"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  activateCanvasTool("draw", "eraser");
                  setMenu(null);
                  setMobileSheet(null);
                }}
                aria-pressed={tool === "draw" && drawMode === "eraser"}
              />
              <StudioDockButton
                icon={PaintBucket}
                label={label.fill}
                hintDescription={advancedFillUnsupportedReason
                  ? `${advancedFillUnsupportedReason} 눌러서 안전한 단일 래스터 후보를 찾거나 필요한 조건을 확인하세요.`
                  : "래스터의 닫힌 영역을 탭해 색을 채웁니다. 경계와 참조 범위는 채우기 속성에서 조절합니다."}
                hintShortcut="G"
                active={advancedFillActive}
                title={advancedFillUnsupportedReason
                  ? `${advancedFillUnsupportedReason} 눌러서 사용할 수 있는 래스터를 찾거나 조건을 확인하세요.`
                  : "채우기 (G)"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  setMenu(null);
                  setMobileSheet(null);
                  toggleAdvancedFill();
                }}
                aria-pressed={advancedFillActive}
              />
              <StudioDockButton
                icon={Square}
                label={label.shape}
                hintDescription={shapeModeActive
                  ? drawSettingsOpen
                    ? "열려 있는 도형 설정을 닫고 캔버스로 돌아가 현재 도형을 계속 배치합니다."
                    : "도형 모드는 유지하고 설정을 열어 종류·채우기·선 굵기를 조절합니다."
                  : "선·사각형·타원·화살표를 정돈된 벡터 도형으로 빠르게 배치합니다."}
                {...shapeHintPreviewProps}
                active={shapeModeActive}
                disabled={activeSurfaceReviewLocked}
                title={activeSurfaceReviewLocked ? "편집 잠금을 해제한 뒤 도형을 사용할 수 있어요" : "도형"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  if (shapeModeActive) {
                    setMobileSheet((s) => (s === "draw" ? null : "draw"));
                    return;
                  }
                  activateCanvasTool("draw", "shape");
                  setMenu(null);
                  setMobileSheet(null);
                }}
                aria-pressed={shapeModeActive}
                aria-expanded={shapeModeActive ? drawSettingsOpen : undefined}
                aria-controls={shapeModeActive ? MOBILE_DRAW_SETTINGS_ID : undefined}
              />
              <span aria-hidden className="my-1 w-px self-stretch bg-line/70" />
              <StudioDockButton
                icon={Undo2}
                label={label.undo}
                data-studio-primary-action="undo"
                hintDescription="마지막 편집을 한 단계 되돌립니다. 공동 작업 변경 이력과 함께 안전하게 이동합니다."
                hintUnavailableReason={undoDisabled ? undoUnavailableTitle : undefined}
                disabled={undoDisabled}
                title={undoDisabled ? undoUnavailableTitle : "실행취소"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  undo();
                }}
                aria-label={label.undoAria}
              />
              <StudioDockButton
                icon={Redo2}
                label={label.redo}
                data-studio-primary-action="redo"
                hintDescription="되돌린 편집을 한 단계 다시 적용합니다."
                hintUnavailableReason={redoDisabled ? redoUnavailableTitle : undefined}
                disabled={redoDisabled}
                title={redoDisabled ? redoUnavailableTitle : "다시실행"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  redo();
                }}
                aria-label={label.redoAria}
              />
              <span aria-hidden className="my-1 w-px self-stretch bg-line/70" />
              <StudioDockButton
                icon={Files}
                label={label.pages}
                hintDescription="페이지 목록을 열어 추가·복제·순서를 바꿉니다."
                data-studio-primary-action="pages"
                active={mobileSheet === "pages"}
                aria-label={mobileSheet === "pages" ? label.pagesCloseAria : label.pagesOpenAria}
                aria-pressed={mobileSheet === "pages"}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  setMobileSheet((s) => (s === "pages" ? null : "pages"));
                }}
              />
              {handleDownload ? (
                <StudioDockButton
                  icon={Download}
                  label={label.export}
                  hintDescription="현재 페이지를 선택한 배율과 이미지 형식으로 즉시 내보냅니다."
                  data-studio-primary-action="export"
                  aria-label={label.exportAria}
                  onClick={() => {
                    setWorkspaceDockExpanded(false);
                    void handleDownload();
                  }}
                />
              ) : null}
              <span aria-hidden className="my-1 w-px self-stretch bg-line/70" />
              <StudioDockButton
                ref={mobileBrushDockButtonRef}
                label={label.brush}
                hintDescription={drawSettingsOpen
                  ? "열려 있는 브러시 설정을 닫고 캔버스로 돌아갑니다."
                  : "브러시 설정을 열어 굵기·불투명도·색·보정·프리셋을 한곳에서 조절합니다."}
                hintPreview="draw-settings"
                hintPreviewVariant={drawSettingsOpen ? "collapse" : "expand"}
                aria-expanded={drawSettingsOpen}
                aria-controls={MOBILE_DRAW_SETTINGS_ID}
                aria-label={label.brushSettings}
                onPointerEnter={() => void loadStudioBrushStudio()}
                onFocus={(event) => {
                  void loadStudioBrushStudio();
                  if (!suppressBrushHintOnReturnFocusRef.current) return;
                  suppressBrushHintOnReturnFocusRef.current = false;
                  // The non-modal sheet restores keyboard focus to this launcher after closing.
                  // Keep that accessibility contract, but do not let the synthetic return-focus
                  // bubble into StudioToolHint and cover the touch canvas with a rich coach.
                  event.stopPropagation();
                }}
                onClick={() => {
                  setWorkspaceDockExpanded(false);
                  void loadStudioBrushStudio();
                  setMenu(null);
                  setMobileSheet((s) => (s === "draw" ? null : "draw"));
                }}
                swatch={(
                  <span
                    aria-hidden
                    className="size-[19px] rounded-full border-2 border-current"
                    style={drawMode === "eraser" ? undefined : { backgroundColor: color, borderColor: "oklch(0.95 0.01 85 / 0.45)" }}
                  />
                )}
              />
                </div>
                <StudioMobileScrollCues
                  descriptionId={`${scrollDescriptionId}-primary`}
                  placement="primary"
                />
              </div>
              {/* 보조 도구 disclosure 는 가로 스크롤 밖에 고정한다. 320px 에서도 사용자가
                  숨은 도구를 찾기 위해 먼저 드로잉 행을 밀지 않도록 하는 발견성 계약이다. */}
              <button
                type="button"
                aria-controls={MOBILE_WORKSPACE_TOOLS_ID}
                aria-expanded={workspaceDockExpanded}
                aria-label={workspaceToggleAccessibleLabel}
                title={workspaceDockExpanded
                  ? workspaceToggleAccessibleLabel
                  : "댓글·페이지·필터·새 작업·작업 패널·색각·줌 도구 펼치기"}
                data-studio-mobile-workspace-toggle="true"
                onFocus={preloadStudioInspectorDrawingSurface}
                onPointerDown={preloadStudioInspectorDrawingSurface}
                onPointerEnter={preloadStudioInspectorDrawingSurface}
                onClick={() => setWorkspaceDockExpanded((expanded) => !expanded)}
                className={cn(
                  "relative flex min-h-11 min-w-11 flex-none flex-col items-center justify-center gap-0.5 rounded-xl border border-line/70 bg-raised/75 px-1 text-[0.6rem] font-bold leading-none text-fg-2",
                  STUDIO_EASE,
                  "hover:bg-raised",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  (workspaceDockExpanded || workspaceDockHasActiveTool) && "text-accent",
                )}
              >
                {workspaceDockExpanded ? (
                  <ChevronDown size={17} strokeWidth={2} aria-hidden />
                ) : (
                  <ChevronUp size={17} strokeWidth={2} aria-hidden />
                )}
                <span>{workspaceDockExpanded ? label.collapse : label.workspaceToggle}</span>
                {!workspaceDockExpanded && workspaceDockHasActiveTool ? (
                  <span
                    aria-hidden
                    className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent"
                  />
                ) : null}
              </button>
            </div>

            {/* 2행: 보조 내비 — 댓글·퀵 메뉴·작업 패널·페이지·필터·새 작업·색각·줌 */}
            <div
              id={MOBILE_WORKSPACE_TOOLS_ID}
              hidden={!workspaceDockExpanded}
              className="flex min-w-0 items-stretch overflow-hidden border-t border-line/60 pt-1"
              role="toolbar"
              aria-label={label.workspaceTools}
              aria-describedby={`${scrollDescriptionId}-secondary`}
              data-studio-mobile-control-side={mobileControlSide}
            >
              <StudioDockNavButton
                icon={commentPinArmed ? X : MessageCircle}
                label={commentPinArmed ? "취소" : "댓글"}
                active={commentPinArmed}
                aria-pressed={commentPinArmed}
                aria-label={commentPinArmed ? "댓글 위치 선택 취소" : "캔버스 위치 댓글"}
                title={commentPinArmed ? "댓글 위치 선택 취소" : "캔버스 위치 댓글"}
                data-studio-mobile-comment-trigger="true"
                className="min-h-11 min-w-11 shrink-0"
                onClick={() => {
                  setMobileSheet(null);
                  toggleStudioCommentPinPlacement();
                }}
              />
              {mobileControlSide === "left" ? (
                <div
                  className="flex size-11 min-h-11 min-w-11 shrink-0 [&>button]:min-h-11 [&>button]:min-w-11"
                  data-studio-mobile-quick-actions-slot="left"
                >
                  {mobileQuickActionsButton}
                </div>
              ) : null}
              <div
                className="relative min-w-0 flex-1"
                data-studio-mobile-scroll-host="secondary"
              >
                <div
                  ref={secondaryDockScrollRef}
                  className="flex h-full min-w-0 touch-pan-x items-stretch gap-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] min-[360px]:gap-0.5 [&::-webkit-scrollbar]:hidden"
                  data-studio-mobile-dock-scroll="secondary"
                >
                <StudioDockNavButton
                  icon={Layers}
                  label="작업 패널"
                  aria-label={
                    "작업 패널"
                  }
                  title={
                    mobileSheet === "props"
                      ? "작업 패널 닫기"
                      : "작업 패널 열기 · 대상·레이어·문서"
                  }
                  aria-haspopup="dialog"
                  aria-expanded={mobileSheet === "props"}
                  active={mobileSheet === "props"}
                  onFocus={preloadStudioInspectorDrawingSurface}
                  onPointerDown={preloadStudioInspectorDrawingSurface}
                  onPointerEnter={preloadStudioInspectorDrawingSurface}
                  onClick={() => {
                    if (mobileSheet === "props") {
                      setMobileSheet(null);
                      return;
                    }
                    openInspectorRoute(
                      {
                        primary:
                          selected || tool === "draw"
                            ? "properties"
                            : "layers",
                      },
                      "props"
                    );
                  }}
                />
                {/*
                  통합 검색(F1)의 트리거는 데스크톱 인스펙터 안에만 있어 모바일에서는 눈에 보이는
                  진입점이 없었다(UX 감사 2026-09-02 §6). 도크의 '찾기'가 같은 다이얼로그를 연다.
                */}
                <StudioDockNavButton
                  icon={Search}
                  label={label.search}
                  aria-label={label.searchAria}
                  title={label.searchTitle}
                  aria-haspopup="dialog"
                  data-studio-mobile-search-trigger="true"
                  onClick={() => {
                    requestStudioCommandSearch({ scope: "all" });
                  }}
                />
                <StudioDockNavButton
                  icon={Files}
                  label={label.pages}
                  aria-label={mobileSheet === "pages" ? label.pagesCloseAria : label.pagesOpenAria}
                  aria-controls={STUDIO_MOBILE_PAGES_SHEET_ID}
                  aria-haspopup="dialog"
                  aria-expanded={mobileSheet === "pages"}
                  active={mobileSheet === "pages"}
                  onClick={() => setMobileSheet((s) => (s === "pages" ? null : "pages"))}
                />
                <StudioMobileFilterSelect
                  filterMutationLocked={filterMutationLocked}
                  filterPreparationBusy={filterPreparationBusy}
                  filterTargetLabel={filterTargetLabel}
                  filterUnavailableReason={filterUnavailableReason}
                  onSelect={openStudioFilter}
                  placement="workspace"
                />
                <StudioDockNavButton
                  icon={WandSparkles}
                  label="새 작업"
                  aria-label="빠른 시작 · 새 작업 열기"
                  aria-haspopup="dialog"
                  title="템플릿과 웹툰 마법사로 새 작업 시작"
                  onClick={() => {
                    setMobileSheet(null);
                    setQuickStartOpen(true);
                  }}
                />
                <StudioDockNavButton
                  icon={Palette}
                  label="색각"
                  aria-label="색각·명암 검수"
                  active={colorVisionOpen || colorBlindPreview !== "none"}
                  aria-pressed={colorVisionOpen}
                  data-studio-color-vision-trigger="true"
                  onClick={() => setMobileSheet((sheet) =>
                    sheet === "color-vision" ? null : "color-vision"
                  )}
                />
                <div className="flex w-[8.25rem] flex-none items-center justify-center">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                    disabled={zoom <= ZOOM_MIN}
                    className="grid size-11 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-raised disabled:opacity-40"
                    aria-label="축소"
                  >
                    <Minus size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={fitCanvasToWidth}
                    className="min-h-11 min-w-11 flex-1 rounded-lg px-1 py-2 text-center text-[0.7rem] font-semibold tabular-nums text-fg transition-colors hover:bg-raised"
                    aria-label="화면 폭에 맞춤"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                    disabled={zoom >= ZOOM_MAX}
                    className="grid size-11 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-raised disabled:opacity-40"
                    aria-label="확대"
                  >
                    <Plus size={16} aria-hidden />
                  </button>
                </div>
                </div>
                <StudioMobileScrollCues
                  descriptionId={`${scrollDescriptionId}-secondary`}
                  placement="secondary"
                />
              </div>
              {mobileControlSide === "right" ? (
                <div
                  className="flex size-11 min-h-11 min-w-11 shrink-0 [&>button]:min-h-11 [&>button]:min-w-11"
                  data-studio-mobile-quick-actions-slot="right"
                >
                  {mobileQuickActionsButton}
                </div>
              ) : null}
            </div>
          </nav>
        )}
    </>
  );
});
