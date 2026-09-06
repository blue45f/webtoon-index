import {
  ArrowLeft,
  Layers3,
  Map,
  PaintBucket,
  PanelRightOpen,
  PanelsTopLeft,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { requestStudioCommandSearch } from "./studio-help-center-channel";
import {
  STUDIO_DOCUMENT_INSPECTOR_SECTIONS,
  STUDIO_IMAGE_INSPECTOR_SECTIONS,
  STUDIO_INSPECTOR_PRIMARY_TABS,
  navigateStudioInspector,
  type StudioDocumentInspectorSection,
  type StudioImageInspectorSection,
  type StudioInspectorLayout,
  type StudioInspectorPrimaryTab,
  type StudioInspectorRoute,
} from "./studio-inspector-layout";
import {
  createStudioInspectorTabA11y,
  type StudioInspectorTabA11y,
} from "./studio-inspector-tab-a11y";
import { STUDIO_FOCUS_RING, StudioContextPill } from "./studio-panel-ui";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export interface StudioInspectorNavigatorProps {
  layout: StudioInspectorLayout;
  tabA11y?: StudioInspectorTabA11y;
  selectedType: string | null;
  selectionLabel: string | null;
  selectionCount?: number;
  drawing: boolean;
  drawingToolPropertiesAvailable?: boolean;
  /**
   * CSP의 도구 팔레트처럼 대상이 아직 없어도 전문 도구를 찾고 준비 조건을 확인할 수
   * 있게 한다. 생략하면 기존 선택 타입 기반 동작을 유지한다.
   */
  imageToolsAvailable?: boolean;
  /** Active professional-tool target state, resolved by the Inspector availability policy. */
  imageToolsStatusLabel?: string;
  imageToolsStatusDescription?: string;
  imageToolsStatusTone?: "neutral" | "accent" | "good" | "warn";
  layerCount: number;
  mobileSheetHandle?: ReactNode;
  onRequestClose?: () => void;
  onChange: (layout: StudioInspectorLayout) => void;
}

/* ----------------------------------------------------------------- copy */

/**
 * 인스펙터 크롬 문구. 로케일 팩에 키가 실리기 전까지는 한국어(제품 목소리)가 기본값이고,
 * 키가 실리는 순간 그 번역이 이긴다 — 메인 메뉴의 `localizeText` 와 같은 계약이다.
 * 라벨을 한 표에 모아 두는 이유는 "속성 / 대상 / 작업 패널"처럼 같은 개념이 컴포넌트마다
 * 다른 이름으로 새어 나가던 것을 여기서 끊기 위해서다(UX 감사 2026-09-02 §5.9).
 */
const COPY = {
  panelTitle: ["studio.inspector.panel.title", "작업 패널"],
  panelHint: ["studio.inspector.panel.hint", "대상 · 레이어 · 문서를 한곳에서 전환합니다"],
  tabTarget: ["studio.inspector.tab.target", "대상"],
  tabLayers: ["studio.inspector.tab.layers", "레이어"],
  tabDocument: ["studio.inspector.tab.document", "문서"],
  tablist: ["studio.inspector.tablist", "스튜디오 작업 패널"],
  search: ["studio.inspector.search", "찾기"],
  searchLabel: ["studio.inspector.search.label", "기능·설정 찾기"],
  close: ["studio.inspector.close", "작업 패널 닫기"],
  openTarget: ["studio.inspector.openTarget", "대상 열기"],
  openTargetSelection: ["studio.inspector.openTarget.selection", "선택한 대상의 속성을 바로 엽니다"],
  openTargetTool: ["studio.inspector.openTarget.tool", "브러시와 그리기 옵션을 바로 엽니다"],
  currentTool: ["studio.inspector.currentTool", "현재 도구 설정"],
  publishTitle: ["studio.inspector.publish.title", "작품 정보"],
  publishHint: ["studio.inspector.publish.hint", "게시 준비 · 초안 저장과 게시에 함께 쓰는 정보"],
  publishBack: ["studio.inspector.publish.back", "편집으로 돌아가기"],
  imageTablist: ["studio.inspector.imageTablist", "이미지 전문 도구"],
  documentTablist: ["studio.inspector.documentTablist", "문서 설정"],
  summaryLayers: ["studio.inspector.summary.layers", "순서·그룹·표시 상태"],
  summaryPublish: ["studio.inspector.summary.publish", "게시 준비"],
  summaryDrawing: ["studio.inspector.summary.drawing", "그리기 도구"],
  summaryEmpty: ["studio.inspector.summary.empty", "B 펜 · V 선택 · 빈 화면에서 바로 그리기"],
  summaryElement: ["studio.inspector.summary.element", "요소"],
} as const satisfies Record<string, readonly [string, string]>;

type CopyKey = keyof typeof COPY;

function useInspectorCopy(): (key: CopyKey) => string {
  const t = useT();
  return (key) => {
    const [localeKey, fallback] = COPY[key];
    const text = t(localeKey);
    return text === localeKey ? fallback : text;
  };
}

const IMAGE_TAB_META: Readonly<
  Record<StudioImageInspectorSection, { label: string; icon: typeof Sparkles }>
> = {
  quick: { label: "빠른 수정", icon: Sparkles },
  fill: { label: "채우기·선화", icon: PaintBucket },
  transform: { label: "변형", icon: Map },
  retouch: { label: "선택·리터치", icon: SlidersHorizontal },
  mask: { label: "마스크", icon: Layers3 },
};

/**
 * 이미지 하위 탭은 단일 정본 순서(`STUDIO_IMAGE_INSPECTOR_SECTIONS`)에서 파생한다.
 * 모델과 표시가 따로 순서를 들고 있던 것이 감사 P1 결함이었다.
 */
const IMAGE_TABS = STUDIO_IMAGE_INSPECTOR_SECTIONS.map((id) => ({ id, ...IMAGE_TAB_META[id] }));

const DOCUMENT_TAB_META: Readonly<
  Record<StudioDocumentInspectorSection, { label: string; icon: typeof PanelsTopLeft }>
> = {
  canvas: { label: "캔버스", icon: PanelsTopLeft },
  grade: { label: "색보정", icon: SlidersHorizontal },
  navigator: { label: "미니맵", icon: Map },
};

const DOCUMENT_TABS = STUDIO_DOCUMENT_INSPECTOR_SECTIONS.map((id) => ({
  id,
  ...DOCUMENT_TAB_META[id],
}));

const PRIMARY_TAB_ICONS: Readonly<Record<StudioInspectorPrimaryTab, typeof SlidersHorizontal>> = {
  properties: SlidersHorizontal,
  layers: Layers3,
  document: PanelsTopLeft,
};

const PRIMARY_TAB_COPY: Readonly<Record<StudioInspectorPrimaryTab, CopyKey>> = {
  properties: "tabTarget",
  layers: "tabLayers",
  document: "tabDocument",
};

const tabFocusClass = STUDIO_FOCUS_RING;

/* -------------------------------------------------------------- helpers */

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function moveTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabList = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
  if (!tabList) return;
  const tabs = Array.from(
    tabList.querySelectorAll<HTMLButtonElement>(':scope > button[role="tab"]')
  ).filter((tab) => !tab.disabled);
  const index = tabs.indexOf(event.currentTarget);
  if (index < 0 || tabs.length === 0) return;

  event.preventDefault();
  // StudioPage의 전역 방향키 nudge가 같은 키 입력으로 선택 원고까지 움직이지 않게 한다.
  event.stopPropagation();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  next?.focus();
  next?.click();
}

/* ------------------------------------------------------------- component */

export function StudioInspectorNavigator({
  layout,
  tabA11y: providedTabA11y,
  selectedType,
  selectionLabel,
  selectionCount = 0,
  drawing,
  imageToolsAvailable,
  imageToolsStatusLabel,
  imageToolsStatusDescription,
  imageToolsStatusTone = "neutral",
  layerCount,
  mobileSheetHandle,
  onRequestClose,
  onChange,
}: StudioInspectorNavigatorProps) {
  const copy = useInspectorCopy();
  const titleId = useId();
  const tabA11y = providedTabA11y ?? createStudioInspectorTabA11y(titleId);
  const propertiesTabRef = useRef<HTMLButtonElement>(null);
  const normalizedSelectionCount = safeCount(selectionCount);
  const hasSelection = selectedType !== null || normalizedSelectionCount > 0;
  const resolvedImageToolsAvailable =
    imageToolsAvailable ?? (selectedType === "image" || selectedType === "draw");
  const normalizedLayerCount = safeCount(layerCount);
  const shouldShowImageInspectorTabs =
    layout.primary === "properties" && !drawing && resolvedImageToolsAvailable;
  const imagePanelId = selectedType === "image" || selectedType === "draw"
    ? tabA11y.imagePanels.selected
    : tabA11y.imagePanels.unselected;
  const imageToolsStatusId = `${titleId}-image-tools-status`;
  const publishMode = layout.primary === "publish";

  function navigate(route: StudioInspectorRoute) {
    onChange(navigateStudioInspector(layout, route));
  }

  const selectionSummary = normalizedSelectionCount > 1
    ? `${normalizedSelectionCount}개 요소`
    : selectionLabel ?? copy("summaryElement");
  const summary = (() => {
    if (layout.primary === "layers") return copy("summaryLayers");
    if (layout.primary === "document") {
      return DOCUMENT_TAB_META[layout.document]?.label ?? copy("tabDocument");
    }
    if (publishMode) return copy("summaryPublish");
    if (normalizedSelectionCount > 1) return `${normalizedSelectionCount}개 요소`;
    if (selectionLabel) return selectionLabel;
    if (normalizedSelectionCount > 0) return copy("summaryElement");
    if (drawing) return copy("summaryDrawing");
    // Empty canvas coaching — competitive apps never leave a dead "select something" dead-end.
    return copy("summaryEmpty");
  })();
  const summaryTone = publishMode
    ? "accent"
    : hasSelection || drawing
      ? "good"
      : "neutral";

  return (
    <section
      aria-labelledby={titleId}
      className="sticky top-0 z-30 -mx-0.5 rounded-lg border border-line bg-panel/95 p-1.5 shadow-[0_6px_20px_oklch(0.12_0.01_70/0.28)] backdrop-blur supports-[backdrop-filter]:bg-panel/90"
      data-testid="studio-inspector-navigator"
      data-inspector-chrome="navigator"
    >
      {mobileSheetHandle ? (
        <div className="-mx-1.5 -mt-1.5 mb-0.5 lg:hidden">{mobileSheetHandle}</div>
      ) : null}
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-1.5 px-0.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id={titleId} className="truncate text-xs font-bold tracking-tight text-fg">
              {copy("panelTitle")}
            </h2>
            <StudioContextPill tone={summaryTone}>{summary}</StudioContextPill>
          </div>
          <p className="mt-0.5 truncate text-[0.6875rem] text-fg-3 lg:sr-only">
            {copy("panelHint")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/*
            화면당 검색 표면은 하나다(감사 §5.5). 데스크톱은 바로 위 통합 검색 행이 그 하나이고,
            모바일은 그 행이 숨겨지므로 여기 버튼이 같은 다이얼로그를 '현재 패널' 범위로 연다.
          */}
          <button
            type="button"
            onClick={() => requestStudioCommandSearch({ scope: "inspector" })}
            aria-label={copy("searchLabel")}
            title={`${copy("searchLabel")} (F1)`}
            data-inspector-priority="chrome"
            data-studio-inspector-search-trigger="true"
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-line px-2 text-[0.6875rem] font-semibold text-fg-2 transition-colors duration-150 hover:border-line-strong hover:bg-raised hover:text-fg lg:hidden",
              tabFocusClass
            )}
          >
            <Search size={15} strokeWidth={1.75} aria-hidden />
            <span>{copy("search")}</span>
          </button>
          {onRequestClose ? (
            <button
              type="button"
              onClick={onRequestClose}
              aria-label={copy("close")}
              data-autofocus
              data-inspector-priority="chrome"
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors duration-150 hover:bg-raised hover:text-fg lg:hidden",
                tabFocusClass
              )}
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {(hasSelection || drawing) && layout.primary !== "properties" && !publishMode ? (
        <button
          type="button"
          onClick={() => {
            navigate({ primary: "properties" });
            globalThis.requestAnimationFrame?.(() => {
              propertiesTabRef.current?.focus({ preventScroll: true });
            });
          }}
          data-inspector-priority="chrome"
          className={cn(
            "my-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-accent/35 bg-accent-soft px-2.5 py-2 text-left transition-colors hover:border-accent/65 hover:bg-accent-soft/80",
            tabFocusClass,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-on-accent">
              <PanelRightOpen size={14} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-fg">
                {hasSelection ? `${selectionSummary} 편집` : copy("currentTool")}
              </span>
              <span className="block truncate text-[0.6875rem] text-fg-3">
                {hasSelection ? copy("openTargetSelection") : copy("openTargetTool")}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-[0.6875rem] font-bold text-accent">{copy("openTarget")}</span>
        </button>
      ) : null}

      {publishMode ? (
        /*
         * 작품 정보는 상시 탭이 아니라 게시 CTA·파일 메뉴·검색이 여는 게시 준비 모드다
         * (감사 §5.3 — 사용 빈도가 낮은 영역이 4개 탭 중 하나를 항상 차지하고 있었다).
         * 탭 스트립은 그대로 두어 언제든 편집 범위로 돌아갈 수 있게 한다.
         */
        <div
          className="mb-2 flex min-h-11 items-center justify-between gap-2 rounded-lg border border-accent/35 bg-accent-soft/60 px-2 py-1.5"
          data-studio-inspector-publish-mode="true"
        >
          <div className="min-w-0">
            <p
              id={tabA11y.primary.publish.tabId}
              className="truncate text-xs font-bold text-fg"
            >
              {copy("publishTitle")}
            </p>
            <p className="truncate text-[0.6875rem] text-fg-3">{copy("publishHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate({ primary: "properties" })}
            data-inspector-priority="chrome"
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-line bg-card px-2 text-[0.6875rem] font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg",
              tabFocusClass,
            )}
          >
            <ArrowLeft size={13} aria-hidden />
            {copy("publishBack")}
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label={copy("tablist")}
        className="grid grid-cols-3 gap-0.5 rounded-lg border border-line/70 bg-canvas/55 p-0.5"
      >
        {STUDIO_INSPECTOR_PRIMARY_TABS.map((tabId, index) => {
          const Icon = PRIMARY_TAB_ICONS[tabId];
          const active = layout.primary === tabId;
          // 게시 준비 모드에서는 선택된 탭이 없다. roving tabindex 는 첫 탭이 이어받는다.
          const tabStop = active || (publishMode && index === 0);
          return (
            <button
              key={tabId}
              ref={tabId === "properties" ? propertiesTabRef : undefined}
              id={tabA11y.primary[tabId].tabId}
              type="button"
              data-studio-inspector-primary-tab={tabId}
              data-inspector-priority="chrome"
              role="tab"
              aria-selected={active}
              aria-controls={
                tabId === "document"
                  ? tabA11y.document[layout.document].panelId
                  : tabA11y.primary[tabId].panelId
              }
              tabIndex={tabStop ? 0 : -1}
              onClick={() => navigate({ primary: tabId })}
              onKeyDown={moveTabFocus}
              className={cn(
                "relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-px rounded-md px-0.5 text-[0.6875rem] font-semibold transition-colors duration-150 lg:min-h-9",
                active
                  ? "bg-raised text-fg shadow-sm ring-1 ring-accent/25"
                  : "text-fg-3 hover:bg-card hover:text-fg-2",
                tabFocusClass
              )}
            >
              <Icon size={15} strokeWidth={1.75} className={active ? "text-accent" : undefined} aria-hidden />
              <span className="truncate">{copy(PRIMARY_TAB_COPY[tabId])}</span>
              {active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-accent"
                />
              ) : null}
              {tabId === "layers" && normalizedLayerCount > 0 ? (
                <span className="absolute right-1 top-1 rounded-full bg-accent-soft px-1 text-[0.6875rem] font-bold tabular-nums text-accent">
                  {normalizedLayerCount > 99 ? "99+" : normalizedLayerCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {shouldShowImageInspectorTabs ? (
        /*
         * 다섯 탭을 가로 스크롤에 숨기지 않는다 — 320px 패널에서도 전부 보이는 3+2 그리드.
         * (감사 수용 기준: "이미지 하위 탐색 — 320px에서 숨은 가로 탭 없음")
         */
        <div
          role="tablist"
          aria-label={copy("imageTablist")}
          className="mt-2 grid min-w-0 grid-cols-3 gap-1"
        >
          {IMAGE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = layout.image === tab.id;
            return (
              <button
                key={tab.id}
                id={tabA11y.imageTabs[tab.id]}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={imagePanelId}
                aria-describedby={
                  active && imageToolsStatusLabel ? imageToolsStatusId : undefined
                }
                data-inspector-priority="chrome"
                tabIndex={active ? 0 : -1}
                onClick={() => navigate({ primary: "properties", image: tab.id })}
                onKeyDown={moveTabFocus}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 text-[0.6875rem] font-semibold transition-colors duration-150 lg:min-h-9 pointer-coarse:min-h-11",
                  active
                    ? "border-accent bg-accent-soft text-accent shadow-sm"
                    : "border-line bg-card/60 text-fg-3 hover:border-line-strong hover:bg-raised hover:text-fg-2",
                  tabFocusClass
                )}
              >
                <Icon size={13} className="shrink-0" aria-hidden />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {shouldShowImageInspectorTabs && imageToolsStatusLabel ? (
        <div
          id={imageToolsStatusId}
          role="status"
          className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded-lg border border-line/70 bg-canvas/45 px-2 py-1.5 text-[0.6875rem] leading-relaxed"
        >
          <StudioContextPill tone={imageToolsStatusTone}>
            {imageToolsStatusLabel}
          </StudioContextPill>
          <span className="min-w-0 truncate text-fg-3">
            {imageToolsStatusDescription}
          </span>
        </div>
      ) : null}

      {layout.primary === "document" ? (
        <div
          role="tablist"
          aria-label={copy("documentTablist")}
          className="mt-2 grid grid-cols-3 gap-1"
        >
          {DOCUMENT_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = layout.document === tab.id;
            return (
              <button
                key={tab.id}
                id={tabA11y.document[tab.id].tabId}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={tabA11y.document[tab.id].panelId}
                data-inspector-priority="chrome"
                tabIndex={active ? 0 : -1}
                onClick={() => navigate({ primary: "document", document: tab.id })}
                onKeyDown={moveTabFocus}
                className={cn(
                  "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 text-[0.6875rem] font-semibold transition-colors duration-150 lg:min-h-9 pointer-coarse:min-h-11",
                  active
                    ? "border-accent bg-accent-soft text-accent shadow-sm"
                    : "border-line bg-card/60 text-fg-3 hover:border-line-strong hover:bg-raised hover:text-fg-2",
                  tabFocusClass
                )}
              >
                <Icon size={13} className="shrink-0" aria-hidden />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
