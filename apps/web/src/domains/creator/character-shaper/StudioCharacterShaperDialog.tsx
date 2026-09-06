/**
 * Character Shaper — the workshop shell (summary bar · slot rail · shelf · viewport + HUD ·
 * inspector · output dock) rendered as a modal over the studio, on top of the existing poser host.
 *
 * Keyboard (inside the dialog only): `Esc` closes drawer → expanded mobile sheet → 표면 드로잉 →
 * dialog; `⌘Z / ⇧⌘Z` go to the Shaper history (the runtime keeps them while paint mode owns undo);
 * `T` toggles the turntable; `B` toggles 표면 드로잉; digits jump slots while focus is in the rail.
 * Tab trapping, first focus and focus return are the poser runtime's (`h.dialogRef` /
 * `h.closeButtonRef`), exactly as in `StudioVrmPoserDialog`.
 */
import { PanelRightClose, PanelRightOpen, Upload, UserRound, X } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { STUDIO_FOCUS_RING, StudioEmptyState } from "../studio-panel-ui";
import { StudioVrmPoserViewport } from "../vrm/StudioVrmPoserViewport";

import {
  CHARACTER_SHAPER_DESKTOP_QUERY,
  CHARACTER_SHAPER_TABLET_QUERY,
  createCharacterShaperUiState,
  isCharacterShaperTypingTarget,
  pushCharacterShaperKeyLayer,
  reduceCharacterShaperUiState,
} from "./character-shaper-ui-model";
import { CharacterShaperInspector } from "./CharacterShaperInspector";
import { CharacterShaperMobileSheet } from "./CharacterShaperMobileSheet";
import { CharacterShaperOutputDock } from "./CharacterShaperOutputDock";
import { CharacterShaperPaintHud } from "./CharacterShaperPaintHud";
import { CharacterShaperReferenceDrawer } from "./CharacterShaperReferenceDrawer";
import { CharacterShaperShelf } from "./CharacterShaperShelf";
import { CharacterShaperSlotRail } from "./CharacterShaperSlotRail";
import { CharacterShaperSummaryBar } from "./CharacterShaperSummaryBar";
import { CharacterShaperViewportHud } from "./CharacterShaperViewportHud";

import type { CharacterSlotEntry, CharacterSlotKind } from "./character-shaper-contract";
import type { CharacterShaperDrawerMode, StudioCharacterShaperDialogProps } from "./character-shaper-ui-contract";
import type { CharacterShaperLayout } from "./character-shaper-ui-model";
import type { LoadStatus } from "../vrm/StudioVrmPoserTypes";
import type { ChangeEvent, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { useMediaQuery } from "@/src/hooks/use-media-query";

type MobileSheetTab = "shelf" | "inspector";

const COMMIT_NOTICE_MS = 4000;

const DIALOG_ROOT_CLASS = cn(
  "fixed inset-0 z-[80] isolate overflow-hidden overscroll-none bg-[oklch(0.08_0.01_70/0.86)] p-2 text-fg backdrop-blur-sm sm:p-3",
  "pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11",
  "pointer-coarse:[&_input:not([type=range]):not([type=checkbox]):not([type=color])]:min-h-11 pointer-coarse:[&_input[type=range]]:h-11 pointer-coarse:[&_select]:min-h-11 pointer-coarse:[&_summary]:min-h-11",
);

/** The shared viewport explicitly yields navigation chrome to this shell. */
const VIEWPORT_WRAPPER_CLASS = "relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-card";

const TAB_BUTTON = cn(
  "min-h-11 flex-1 rounded-lg text-[0.75rem] font-semibold transition-colors motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

function ShelfSkeleton() {
  return (
    <div role="status" aria-label="프리셋 불러오는 중" aria-busy="true" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="space-y-2 border-b border-line px-3 pb-3 pt-3">
        <div className="skeleton h-4 w-24 motion-reduce:animate-none" />
        <div className="skeleton h-11 w-full motion-reduce:animate-none" />
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="skeleton aspect-[4/5] w-full rounded-2xl motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

export function StudioCharacterShaperDialog({ h, binding, onOpenAdvanced }: StudioCharacterShaperDialogProps) {
  const isDesktop = useMediaQuery(CHARACTER_SHAPER_DESKTOP_QUERY);
  const isTablet = useMediaQuery(CHARACTER_SHAPER_TABLET_QUERY);
  const layout: CharacterShaperLayout = isDesktop ? "desktop" : isTablet ? "tablet" : "mobile";
  const [ui, dispatch] = useReducer(reduceCharacterShaperUiState, undefined, () => createCharacterShaperUiState());
  const [mobileTab, setMobileTab] = useState<MobileSheetTab>("shelf");
  const [commitNotice, setCommitNotice] = useState<string | null>(null);
  const fallbackTitleId = useId();
  const fallbackDescriptionId = useId();
  const inspectorId = useId();
  const sheetTabsId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreDrawerFocusRef = useRef(false);
  const previousPanelRef = useRef<{ readonly tab: string; readonly section: string } | null>(null);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const titleId: string = typeof h.dialogTitleId === "string" ? h.dialogTitleId : fallbackTitleId;
  const descriptionId: string = typeof h.dialogDescriptionId === "string" ? h.dialogDescriptionId : fallbackDescriptionId;
  const status: LoadStatus = h.status ?? "empty";
  const hostPaintSelected: boolean | null =
    typeof h.texturePaintModeSelected === "boolean" ? h.texturePaintModeSelected : null;
  // The runtime's flag is the truth (paint mode = character tab + surface section); the shell
  // flag only stands in for hosts that do not expose it.
  const paintActive = hostPaintSelected ?? ui.paintActive;
  const modelReady = status === "ready";
  const errorMessage: string = typeof h.error === "string" ? h.error : "";
  const busyReason = binding.busyReason;

  // The runtime can enter or leave paint mode on its own (legacy tab change, capture, a dialog
  // opened while already painting); mirror it so the Esc chain and hotkeys agree with the HUD.
  useEffect(() => {
    if (hostPaintSelected !== null && hostPaintSelected !== ui.paintActive) {
      dispatch({ type: "set-paint", active: hostPaintSelected });
    }
  }, [ui.paintActive, hostPaintSelected]);

  useEffect(() => {
    if (commitNotice === null) return;
    const timer = window.setTimeout(() => setCommitNotice(null), COMMIT_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [commitNotice]);

  const enterPaint = () => {
    previousPanelRef.current = {
      tab: typeof h.activePanelTab === "string" ? h.activePanelTab : "pose",
      section: typeof h.activeCharacterSection === "string" ? h.activeCharacterSection : "forge",
    };
    h.handlePanelTabChange("character");
    h.handleCharacterSectionChange("surface");
    dispatch({ type: "set-paint", active: true });
  };

  const exitPaint = () => {
    const previous = previousPanelRef.current;
    previousPanelRef.current = null;
    const restoreTab = previous && !(previous.tab === "character" && previous.section === "surface") ? previous.tab : "pose";
    h.handlePanelTabChange(restoreTab);
    if (restoreTab === "character" && previous && previous.section !== "surface") {
      h.handleCharacterSectionChange(previous.section);
    }
    dispatch({ type: "set-paint", active: false });
  };

  const togglePaint = () => {
    if (paintActive) exitPaint();
    else enterPaint();
  };

  const openDrawer = (mode: Exclude<CharacterShaperDrawerMode, null>) => {
    if (ui.drawer === null) {
      drawerReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    dispatch({ type: "open-drawer", mode });
  };

  const closeDrawer = () => {
    restoreDrawerFocusRef.current = true;
    dispatch({ type: "close-drawer" });
  };

  useEffect(() => {
    if (ui.drawer !== null) {
      drawerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!restoreDrawerFocusRef.current) return;
    restoreDrawerFocusRef.current = false;
    const target = drawerReturnFocusRef.current;
    drawerReturnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [ui.drawer]);

  const requestClose = () => {
    if (h.isCapturing) return;
    h.cancelActiveTexturePaintStroke?.();
    h.cancelPendingPoseShare?.();
    h.onClose();
  };

  const selectSlot = (slot: CharacterSlotKind) => {
    dispatch({ type: "select-slot", slot });
    if (layout === "mobile") setMobileTab("shelf");
  };

  const commitEntry = (entry: CharacterSlotEntry) => {
    const result = binding.commit(entry);
    if (!result.ok) {
      setCommitNotice(result.reason ?? "지금은 적용할 수 없습니다.");
    }
  };

  const setQuery = (query: string) => dispatch({ type: "set-query", query });
  const setTag = (tag: string | null) => dispatch({ type: "set-tag", tag });
  const setHovered = (entryId: string | null) => dispatch({ type: "hover-entry", entryId });

  const toggleAdvanced = () => {
    const next = !ui.advanced;
    dispatch({ type: "set-advanced", advanced: next });
    if (next) onOpenAdvanced?.();
  };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    // While 고급 편집 shows the legacy builder, its own runtime owns every shortcut.
    if (ui.advanced) return false;
    const target = event.target;
    const typing = isCharacterShaperTypingTarget(target);
    const key = event.key;

    if (key === "Escape") {
      if (event.defaultPrevented) return false;
      const searchInput = target instanceof HTMLInputElement && target.dataset.characterShaperSearch === "true" ? target : null;
      if (searchInput && searchInput.value.length > 0) {
        // The shelf clears its draft on this same event; only keep the runtime from closing.
        event.preventDefault();
        return true;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = reduceCharacterShaperUiState(ui, { type: "escape", layout });
      if (next !== ui) {
        if (ui.drawer !== null) closeDrawer();
        else if (next.mobileSheet !== ui.mobileSheet) dispatch({ type: "set-mobile-sheet", sheet: next.mobileSheet });
        else if (ui.paintActive && !next.paintActive) exitPaint();
        return true;
      }
      requestClose();
      return true;
    }

    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && !event.altKey && (key === "z" || key === "Z" || key === "y" || key === "Y")) {
      if (typing) return false;
      // Paint mode: the runtime routes ⌘Z to the texture-paint stroke history.
      if (paintActive) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      const redo = key === "y" || key === "Y" || event.shiftKey;
      if (redo) binding.redo();
      else binding.undo();
      return true;
    }

    if (typing || modifier || event.altKey) return false;

    if (key === "t" || key === "T") {
      if (paintActive || !modelReady) return false;
      event.preventDefault();
      h.setTurntable?.((value: boolean) => !value);
      return true;
    }

    if (key === "b" || key === "B") {
      const inViewport = target instanceof Element && target.closest("[data-character-shaper-viewport]") !== null;
      // Inside the paint viewport, B selects the brush tool (the canvas owns that key).
      if (paintActive && inViewport) return false;
      if (!paintActive && !modelReady) return false;
      event.preventDefault();
      togglePaint();
      return true;
    }

    return false;
  };

  useEffect(() => {
    keyHandlerRef.current = handleKeyDown;
  });

  useEffect(() => pushCharacterShaperKeyLayer((event) => keyHandlerRef.current(event), window), []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void h.handleFileChange?.(event);
  };

  const summaryBar = (
    <CharacterShaperSummaryBar
      h={h}
      binding={binding}
      advanced={ui.advanced}
      onToggleAdvanced={toggleAdvanced}
      onClose={requestClose}
      titleId={titleId}
      descriptionId={descriptionId}
    />
  );

  const emptyState = (
    <div className="flex h-full min-h-0 flex-col justify-center p-3">
      <StudioEmptyState
        icon={<UserRound size={20} aria-hidden />}
        title={status === "error" ? "모델을 불러오지 못했습니다" : "VRM 캐릭터를 불러오세요"}
        description={
          status === "error"
            ? errorMessage || "파일 형식이나 경로를 확인한 뒤 다시 시도해 주세요."
            : "샘플 캐릭터로 바로 시작하거나 내 .vrm 파일을 올릴 수 있습니다."
        }
        action={
          <>
            <button
              type="button"
              onClick={() => h.handleSampleLoad?.()}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-accent/60 bg-accent px-3 text-[0.78rem] font-semibold text-on-accent hover:bg-accent-2",
                STUDIO_FOCUS_RING,
              )}
            >
              <UserRound size={14} aria-hidden />
              샘플 캐릭터 불러오기
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.78rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_FOCUS_RING,
              )}
            >
              <Upload size={14} aria-hidden />
              VRM 업로드
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".vrm"
              multiple
              tabIndex={-1}
              aria-label="VRM 파일 선택"
              className="sr-only"
              onChange={onFileChange}
            />
          </>
        }
      />
    </div>
  );

  const shelfContent = status === "loading" ? (
    <ShelfSkeleton />
  ) : status === "empty" || status === "error" ? (
    emptyState
  ) : (
    <CharacterShaperShelf
      binding={binding}
      slot={ui.activeSlot}
      query={ui.query}
      tag={ui.tag}
      onQueryChange={setQuery}
      onTagChange={setTag}
      onHoverEntry={setHovered}
      onCommitEntry={commitEntry}
    />
  );

  const inspector = (
    <CharacterShaperInspector
      h={h}
      binding={binding}
      slot={ui.activeSlot}
      hoveredEntryId={ui.hoveredEntryId}
      onClose={layout === "desktop" ? undefined : () => dispatch({ type: "set-inspector", open: false })}
    />
  );

  const drawer = ui.drawer !== null ? (
    <div
      ref={drawerRef}
      tabIndex={-1}
      role="region"
      aria-label="참고 도구"
      data-character-shaper-drawer={ui.drawer}
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex min-h-0 flex-col overflow-hidden border-r border-line bg-panel shadow-[12px_0_40px_oklch(0.05_0.01_70/0.45)] outline-none",
        layout === "mobile" ? "right-0" : "w-[min(30rem,80vw)]",
      )}
    >
      <CharacterShaperReferenceDrawer
        h={h}
        binding={binding}
        mode={ui.drawer}
        onModeChange={(mode) => dispatch({ type: "open-drawer", mode })}
        onClose={closeDrawer}
      />
    </div>
  ) : null;

  const commitNoticeNode = commitNotice !== null ? (
    <p
      role="status"
      className="pointer-events-none absolute inset-x-3 bottom-3 z-30 rounded-xl border border-warn/45 bg-panel/95 px-3 py-2 text-center text-[0.72rem] font-semibold text-warn shadow-lg backdrop-blur"
    >
      {commitNotice}
    </p>
  ) : null;

  const renderViewport = (className?: string) => (
    <div data-character-shaper-viewport="true" className={cn(VIEWPORT_WRAPPER_CLASS, className)}>
      <StudioVrmPoserViewport h={h} presentation="shaper" />
      <CharacterShaperViewportHud h={h} binding={binding} compact={layout === "mobile"} />
      {paintActive ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex justify-center [&>*]:pointer-events-auto">
          <CharacterShaperPaintHud h={h} onExit={exitPaint} />
        </div>
      ) : null}
      {layout !== "mobile" ? (
        <button
          type="button"
          aria-expanded={ui.inspectorOpen}
          aria-controls={inspectorId}
          title={ui.inspectorOpen ? "정밀 조절 패널 닫기" : "정밀 조절 패널 열기"}
          onClick={() => dispatch({ type: "set-inspector", open: !ui.inspectorOpen })}
          className={cn(
            "absolute bottom-2 right-2 z-20 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line/70 bg-panel/85 px-3 text-[0.72rem] font-semibold text-fg-2 shadow-sm backdrop-blur",
            "transition-colors hover:bg-accent-soft hover:text-accent motion-reduce:transition-none",
            STUDIO_FOCUS_RING,
            ui.inspectorOpen && "border-accent/50 text-accent",
          )}
        >
          {ui.inspectorOpen ? <PanelRightClose size={15} aria-hidden /> : <PanelRightOpen size={15} aria-hidden />}
          정밀 조절
        </button>
      ) : null}
      {layout === "tablet" && ui.inspectorOpen ? (
        <aside
          id={inspectorId}
          aria-label="정밀 조절"
          data-character-shaper-inspector="slide-over"
          className="absolute inset-y-0 right-0 z-30 flex w-[320px] max-w-[88%] min-h-0 flex-col border-l border-line bg-panel shadow-[-12px_0_40px_oklch(0.05_0.01_70/0.45)]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="text-sm font-bold text-fg">정밀 조절</p>
            <button
              type="button"
              aria-label="정밀 조절 닫기"
              onClick={() => dispatch({ type: "set-inspector", open: false })}
              className={cn(
                "grid size-11 place-items-center rounded-xl text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_FOCUS_RING,
              )}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{inspector}</div>
        </aside>
      ) : null}
    </div>
  );

  const dock = (
    <CharacterShaperOutputDock
      h={h}
      binding={binding}
      drawer={ui.drawer}
      onOpenDrawer={openDrawer}
      paintActive={paintActive}
      onTogglePaint={togglePaint}
      compact={layout === "mobile"}
    />
  );

  let middle: ReactNode;
  if (layout === "mobile") {
    middle = (
      <div className="relative flex min-h-0 min-w-0 flex-col">
        <div
          inert={ui.drawer !== null ? true : undefined}
          className="flex min-h-0 flex-1 flex-col"
        >
          {renderViewport("min-h-[44vh] flex-1")}
          <CharacterShaperSlotRail
            binding={binding}
            activeSlot={ui.activeSlot}
            onSelectSlot={selectSlot}
            orientation="horizontal"
          />
          <CharacterShaperMobileSheet
            state={ui.mobileSheet}
            onStateChange={(sheet) => dispatch({ type: "set-mobile-sheet", sheet })}
            title="프리셋과 정밀 조절"
          >
            <div role="tablist" aria-label="시트 내용" className="flex shrink-0 gap-1 border-b border-line px-2 pb-1.5">
              {(
                [
                  { id: "shelf", label: "프리셋" },
                  { id: "inspector", label: "정밀 조절" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  id={`${sheetTabsId}-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === tab.id}
                  aria-controls={`${sheetTabsId}-panel`}
                  tabIndex={mobileTab === tab.id ? 0 : -1}
                  onClick={() => setMobileTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      setMobileTab(mobileTab === "shelf" ? "inspector" : "shelf");
                    }
                  }}
                  className={cn(
                    TAB_BUTTON,
                    mobileTab === tab.id ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-raised hover:text-fg",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              id={`${sheetTabsId}-panel`}
              role="tabpanel"
              aria-labelledby={`${sheetTabsId}-${mobileTab}`}
              className="relative min-h-0 flex-1 overflow-hidden"
            >
              {mobileTab === "shelf" ? shelfContent : <div className="h-full overflow-y-auto overscroll-contain">{inspector}</div>}
              {commitNoticeNode}
            </div>
          </CharacterShaperMobileSheet>
        </div>
        {drawer}
      </div>
    );
  } else {
    const showInspectorColumn = layout === "desktop" && ui.inspectorOpen;
    middle = (
      <div
        className={cn(
          "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
          layout === "desktop"
            ? showInspectorColumn
              ? "grid-cols-[72px_minmax(300px,360px)_minmax(520px,1fr)_320px]"
              : "grid-cols-[72px_minmax(300px,360px)_minmax(520px,1fr)]"
            : "grid-cols-[72px_280px_minmax(0,1fr)]",
        )}
      >
        <CharacterShaperSlotRail
          binding={binding}
          activeSlot={ui.activeSlot}
          onSelectSlot={selectSlot}
          orientation="vertical"
        />
        <div className="relative min-h-0 min-w-0 border-r border-line">
          <div inert={ui.drawer !== null ? true : undefined} className="h-full min-h-0">
            {shelfContent}
          </div>
          {commitNoticeNode}
          {drawer}
        </div>
        {renderViewport()}
        {showInspectorColumn ? (
          <aside
            id={inspectorId}
              aria-label="정밀 조절"
            data-character-shaper-inspector="column"
            className="flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain border-l border-line bg-panel"
          >
            {inspector}
          </aside>
        ) : null}
      </div>
    );
  }

  return createPortal(
    <div
      ref={h.dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busyReason !== null || undefined}
      tabIndex={-1}
      data-studio-vrm-dialog="true"
      data-character-shaper="true"
      data-character-shaper-layout={layout}
      data-character-shaper-paint={paintActive ? "true" : undefined}
      className={DIALOG_ROOT_CLASS}
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="relative mx-auto grid h-full max-h-full min-h-0 w-full max-w-[1600px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)]">
        {summaryBar}
        {middle}
        {dock}
      </div>
    </div>,
    document.body,
  );
}
