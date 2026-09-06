/**
 * Application Settings modal — tabs:
 * General · Shortcuts · Mouse · Touch · Toolbar · Grids · Other
 * Warm-ink design tokens only; no external brand styling.
 */
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import {
  DEFAULT_STUDIO_RAIL_TOOL_ORDER,
  formatStudioShortcutChord,
  hideStudioRailTool,
  listStudioShortcutConflicts,
  moveStudioRailTool,
  normalizeStudioShortcutChordKey,
  studioShortcutActionLabel,
  showStudioRailTool,
  STUDIO_APP_SETTINGS_TABS,
  STUDIO_PIXEL_GRID_SIZE_OPTIONS,
  STUDIO_SHORTCUT_ACTIONS,
  studioAppSettingsTabLabel,
  studioRailHiddenIds,
  studioRailToolLabel,
  type StudioAppSettings,
  type StudioAppSettingsTab,
  type StudioShortcutActionId,
} from "./studio-app-settings";
import { runStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioResetApplicationSettingsRequest } from "./studio-destructive-command-catalog";
import { StudioToggleChip } from "./studio-panel-ui";
import {
  MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
  MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
  STUDIO_TOOL_HINT_MODES,
  studioToolHintModeLabel,
} from "./studio-tool-hint-preferences";
import {
  STUDIO_UI_DENSITY_MODES,
  studioUiDensityDescription,
  studioUiDensityLabel,
  type StudioUiDensityMode,
} from "./studio-ui-density";
import { StudioPressureCurveGraph } from "./StudioPressureCurveGraph";
import { activateStudioModalSheet } from "./useStudioModalSheet";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

export type StudioAppSettingsPanelProps = {
  open: boolean;
  settings: StudioAppSettings;
  initialTab?: StudioAppSettingsTab;
  persistenceState?: "loading" | "saved" | "session-only";
  onClose: () => void;
  onChange: (next: StudioAppSettings) => void;
  onResetAll: () => void;
  onRetryPersistence?: () => void;
};

function SectionLabel({ children }: { children: string }): ReactElement {
  return <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-fg-3">{children}</p>;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-fg">{label}</p>
        {hint ? <p className="text-[0.68rem] leading-snug text-fg-3">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function SelectChipGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}): ReactElement {
  return (
    <span className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <StudioToggleChip key={opt.id} active={value === opt.id} onClick={() => onChange(opt.id)}>
          {opt.label}
        </StudioToggleChip>
      ))}
    </span>
  );
}

export function StudioAppSettingsPanel({
  open,
  settings,
  initialTab = "general",
  persistenceState = "saved",
  onClose,
  onChange,
  onResetAll,
  onRetryPersistence,
}: StudioAppSettingsPanelProps): ReactElement | null {
  const t = useT();
  const titleId = useId();
  const [tab, setTab] = useState<StudioAppSettingsTab>(initialTab);
  const [recordingAction, setRecordingAction] = useState<StudioShortcutActionId | null>(null);
  const [toolbarQuery, setToolbarQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissModal = useEffectEvent(() => {
    if (recordingAction) {
      setRecordingAction(null);
      return;
    }
    onClose();
  });

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setToolbarQuery("");
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || !recordingAction) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingAction(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        onChange({
          ...settings,
          shortcuts: { ...settings.shortcuts, [recordingAction]: "" },
        });
        setRecordingAction(null);
        return;
      }
      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("Mod");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");
      let key = "";
      if (e.code === "BracketLeft") key = "[";
      else if (e.code === "BracketRight") key = "]";
      else if (e.code === "Tab") key = "Tab";
      else if (e.key === "?") key = "?";
      else if (e.key.length === 1) key = e.key.toUpperCase();
      else if (e.key !== "Control" && e.key !== "Meta" && e.key !== "Shift" && e.key !== "Alt") {
        key = e.key;
      }
      if (!key) return;
      parts.push(key);
      onChange({
        ...settings,
        shortcuts: { ...settings.shortcuts, [recordingAction]: parts.join("+") },
      });
      setRecordingAction(null);
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, [open, recordingAction, settings, onChange]);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    return activateStudioModalSheet({
      dialog,
      document: dialog.ownerDocument,
      onDismiss: dismissModal,
      root: dialog.ownerDocument.body,
    });
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const patch = (partial: Partial<StudioAppSettings>) => onChange({ ...settings, ...partial });
  const visible = settings.toolbar.visibleIds;
  const hidden = studioRailHiddenIds(visible);
  const normalizedToolbarQuery = toolbarQuery.trim().normalize("NFKC").toLocaleLowerCase();
  const matchesToolbarQuery = (id: (typeof DEFAULT_STUDIO_RAIL_TOOL_ORDER)[number]) =>
    !normalizedToolbarQuery
    || studioRailToolLabel(id, t).normalize("NFKC").toLocaleLowerCase().includes(normalizedToolbarQuery);
  const visibleMatches = visible.filter(matchesToolbarQuery);
  const hiddenMatches = hidden.filter(matchesToolbarQuery);
  const shortcutConflicts = listStudioShortcutConflicts(settings.shortcuts);
  const shortcutConflictCount = shortcutConflicts.size;
  const actionLabelById = new Map(
    STUDIO_SHORTCUT_ACTIONS.map((a) => [a.id, studioShortcutActionLabel(a.id, t)])
  );

  const body = (
    <div
      className="fixed inset-0 z-[95] grid place-items-end bg-[oklch(0.08_0.01_70/0.55)] p-0 sm:place-items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="flex max-h-[min(92dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-accent" aria-hidden />
            <div>
              <h2 id={titleId} className="text-sm font-bold text-fg">
                {t("studio.settings.title")}
              </h2>
              <p className="text-[0.68rem] text-fg-3">{t("studio.settings.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            className={cn(
              buttonClass({ size: "sm", variant: "quiet" }),
              "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            )}
            onClick={onClose}
            aria-label={t("studio.settings.panelCloseAria")}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-36 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
            aria-label={t("studio.settings.toolbar.tabAria")}
          >
            {STUDIO_APP_SETTINGS_TABS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "min-h-11 min-w-11 shrink-0 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition sm:min-h-8 sm:min-w-0 sm:py-1.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:py-2",
                  tab === id
                    ? "bg-accent-soft text-accent ring-1 ring-accent/20"
                    : "text-fg-2 hover:bg-raised hover:text-fg"
                )}
                aria-current={tab === id ? "page" : undefined}
              >
                {studioAppSettingsTabLabel(id, t)}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {tab === "general" ? (
              <>
                <SectionLabel>{t("studio.settings.section.layout")}</SectionLabel>
                <Row
                  label={t("studio.settings.general.uiDensityLabel")}
                  hint={t("studio.settings.general.uiDensityHint")}
                >
                  <SelectChipGroup
                    value={settings.general.densityMode}
                    options={STUDIO_UI_DENSITY_MODES.map((m) => ({
                      id: m,
                      label: studioUiDensityLabel(m, t),
                    }))}
                    onChange={(densityMode: StudioUiDensityMode) =>
                      patch({ general: { ...settings.general, densityMode } })
                    }
                  />
                </Row>
                <p className="text-[0.68rem] text-fg-3">
                  {studioUiDensityDescription(settings.general.densityMode, t)}
                </p>
                <Row
                  label={t("studio.settings.general.toolHintLabel")}
                  hint={t("studio.settings.general.toolHintHint")}
                >
                  <SelectChipGroup
                    value={settings.general.toolHintMode}
                    options={STUDIO_TOOL_HINT_MODES.map((mode) => ({
                      id: mode,
                      label: studioToolHintModeLabel(mode, t),
                    }))}
                    onChange={(toolHintMode) =>
                      patch({ general: { ...settings.general, toolHintMode } })
                    }
                  />
                </Row>
                <Row
                  label={t("studio.settings.general.brushCursorLabel")}
                  hint={t("studio.settings.general.brushCursorHint")}
                >
                  <SelectChipGroup
                    value={settings.general.brushCursorStyle}
                    options={[
                      { id: "outline", label: t("studio.settings.general.brushCursor.outline") },
                      { id: "dot", label: t("studio.settings.general.brushCursor.dot") },
                      { id: "none", label: t("studio.settings.general.brushCursor.none") },
                    ]}
                    onChange={(brushCursorStyle) =>
                      patch({ general: { ...settings.general, brushCursorStyle } })
                    }
                  />
                </Row>
                <Row
                  label={t("studio.settings.general.strokeGuideLabel")}
                  hint={t("studio.settings.general.strokeGuideHint")}
                >
                  <StudioToggleChip
                    active={settings.general.showStrokeGuide}
                    onClick={() =>
                      patch({
                        general: {
                          ...settings.general,
                          showStrokeGuide: !settings.general.showStrokeGuide,
                        },
                      })
                    }
                  >
                    {settings.general.showStrokeGuide
                      ? t("studio.settings.general.strokeGuide.visible")
                      : t("studio.settings.general.strokeGuide.hidden")}
                  </StudioToggleChip>
                </Row>
                <Row label={t("studio.settings.general.clearLayerConfirmLabel")}>
                  <StudioToggleChip
                    active={settings.general.confirmBeforeClearLayer}
                    onClick={() =>
                      patch({
                        general: {
                          ...settings.general,
                          confirmBeforeClearLayer: !settings.general.confirmBeforeClearLayer,
                        },
                      })
                    }
                  >
                    {settings.general.confirmBeforeClearLayer
                      ? t("studio.settings.general.confirmBeforeClear")
                      : t("studio.settings.general.applyImmediately")}
                  </StudioToggleChip>
                </Row>
              </>
            ) : null}

            {tab === "shortcuts" ? (
              <>
                <SectionLabel>{t("studio.settings.section.shortcuts")}</SectionLabel>
                <p className="text-[0.68rem] leading-relaxed text-fg-3">
                  {t("studio.settings.shortcuts.recordingHint")}
                </p>
                {shortcutConflictCount > 0 ? (
                  <p
                    role="status"
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[0.68rem] leading-relaxed text-amber-900 dark:text-amber-100"
                  >
                    {t("studio.settings.shortcuts.conflictHeader")
                      .replace("{count}", String(shortcutConflictCount))
                      .replace("{marker}", t("studio.settings.shortcuts.conflict"))}
                  </p>
                ) : null}
                <ul className="divide-y divide-line/60 rounded-xl border border-line">
                  {STUDIO_SHORTCUT_ACTIONS.map((action) => {
                    const chord = settings.shortcuts[action.id] ?? "";
                    const recording = recordingAction === action.id;
                    const chordKey = chord ? normalizeStudioShortcutChordKey(chord) : null;
                    const conflictPeers = chordKey ? shortcutConflicts.get(chordKey) : undefined;
                    const hasConflict = !!conflictPeers && conflictPeers.length > 1;
                    const peerLabels = hasConflict
                      ? conflictPeers
                          .filter((id) => id !== action.id)
                          .map((id) => actionLabelById.get(id) ?? id)
                          .join(", ")
                      : "";
                    return (
                      <li key={action.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 text-xs text-fg">
                          <span className="block">{action.label}</span>
                          {hasConflict ? (
                            <span
                              className="mt-0.5 block text-[0.62rem] font-medium text-amber-700 dark:text-amber-200"
                              title={peerLabels
                                ? t("studio.settings.shortcuts.conflictPeers").replace("{peers}", peerLabels)
                                : t("studio.settings.shortcuts.noConflictHint")}
                            >
                              {t("studio.settings.shortcuts.conflict")} {peerLabels ? `· ${peerLabels}` : ""}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          className={cn(
                            buttonClass({ size: "sm", variant: recording ? "outline" : "quiet" }),
                            "min-h-11 min-w-[5.5rem] font-mono text-[0.7rem] sm:min-h-8 pointer-coarse:min-h-11",
                            recording && "ring-2 ring-accent/40",
                            hasConflict && !recording && "ring-1 ring-amber-500/50"
                          )}
                          onClick={() => setRecordingAction(recording ? null : action.id)}
                        >
                          {recording ? t("studio.settings.shortcuts.recordingState") : formatStudioShortcutChord(chord)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className={cn(
                    buttonClass({ size: "sm", variant: "quiet" }),
                    "min-h-11 sm:min-h-8 pointer-coarse:min-h-11"
                  )}
                  onClick={() =>
                    patch({
                      shortcuts: Object.fromEntries(
                        STUDIO_SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKeys])
                      ) as StudioAppSettings["shortcuts"],
                    })
                  }
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t("studio.settings.shortcuts.reset")}
                </button>
              </>
            ) : null}

            {tab === "mouse" ? (
              <>
                <SectionLabel>{t("studio.settings.section.mouse")}</SectionLabel>
                <Row label={t("studio.settings.mouse.wheelLabel")} hint={t("studio.settings.mouse.wheelHint")}>
                  <SelectChipGroup
                    value={settings.mouse.wheel}
                    options={[
                      { id: "zoom", label: t("studio.settings.mouse.wheel.zoom") },
                      { id: "pan", label: t("studio.settings.mouse.wheel.pan") },
                      { id: "brush-size", label: t("studio.settings.mouse.wheel.brushSize") },
                    ]}
                    onChange={(wheel) => patch({ mouse: { ...settings.mouse, wheel } })}
                  />
                </Row>
                <Row label={t("studio.settings.mouse.reverseLabel")}>
                  <StudioToggleChip
                    active={settings.mouse.reverseWheel}
                    onClick={() =>
                      patch({ mouse: { ...settings.mouse, reverseWheel: !settings.mouse.reverseWheel } })
                    }
                  >
                    {settings.mouse.reverseWheel ? t("studio.settings.state.enabled") : t("studio.settings.state.disabled")}
                  </StudioToggleChip>
                </Row>
                <Row label={t("studio.settings.mouse.middleButtonLabel")}>
                  <SelectChipGroup
                    value={settings.mouse.middleButton}
                    options={[
                      { id: "pan", label: t("studio.settings.mouse.middleButton.pan") },
                      { id: "zoom", label: t("studio.settings.mouse.middleButton.zoom") },
                      { id: "eyedropper", label: t("studio.settings.mouse.middleButton.eyedropper") },
                      { id: "none", label: t("studio.settings.state.none") },
                    ]}
                    onChange={(middleButton) => patch({ mouse: { ...settings.mouse, middleButton } })}
                  />
                </Row>
                <Row label={t("studio.settings.mouse.rightButtonLabel")}>
                  <SelectChipGroup
                    value={settings.mouse.rightButton}
                    options={[
                      { id: "context", label: t("studio.settings.mouse.rightButton.context") },
                      { id: "eyedropper", label: t("studio.settings.mouse.rightButton.eyedropper") },
                      { id: "pan", label: t("studio.settings.mouse.rightButton.pan") },
                      { id: "none", label: t("studio.settings.state.none") },
                    ]}
                    onChange={(rightButton) => patch({ mouse: { ...settings.mouse, rightButton } })}
                  />
                </Row>
              </>
            ) : null}

            {tab === "touch" ? (
              <>
                <SectionLabel>{t("studio.settings.section.touchPen")}</SectionLabel>
                <p className="text-[0.68rem] leading-relaxed text-fg-3">
                  {t("studio.settings.touch.sectionHint")}
                </p>
                <Row label={t("studio.settings.touch.oneFingerDragLabel")}>
                  <SelectChipGroup
                    value={settings.touch.oneFingerDrag}
                    options={[
                      { id: "draw", label: t("studio.settings.touch.oneFingerDrag.draw") },
                      { id: "pan", label: t("studio.settings.touch.oneFingerDrag.pan") },
                      { id: "none", label: t("studio.settings.state.none") },
                    ]}
                    onChange={(oneFingerDrag) => patch({ touch: { ...settings.touch, oneFingerDrag } })}
                  />
                </Row>
                <Row label={t("studio.settings.touch.twoFingerLabel")}>
                  <SelectChipGroup
                    value={settings.touch.twoFinger}
                    options={[
                      { id: "pan-zoom", label: t("studio.settings.touch.twoFinger.panZoom") },
                      { id: "undo-redo", label: t("studio.settings.touch.twoFinger.undoRedo") },
                    ]}
                    onChange={(twoFinger) => patch({ touch: { ...settings.touch, twoFinger } })}
                  />
                </Row>
                <Row label={t("studio.settings.touch.threeFingerLabel")}>
                  <SelectChipGroup
                    value={settings.touch.threeFinger}
                    options={[
                      { id: "undo", label: t("studio.settings.touch.threeFinger.undo") },
                      { id: "toggle-ui", label: t("studio.settings.touch.threeFinger.toggleUi") },
                      { id: "none", label: t("studio.settings.state.none") },
                    ]}
                    onChange={(threeFinger) => patch({ touch: { ...settings.touch, threeFinger } })}
                  />
                </Row>
                <Row
                  label={t("studio.settings.touch.palmRejectionLabel")}
                  hint={t("studio.settings.touch.palmRejectionHint")}
                >
                  <StudioToggleChip
                    active={settings.touch.palmRejection}
                    onClick={() =>
                      patch({
                      touch: { ...settings.touch, palmRejection: !settings.touch.palmRejection },
                      })
                    }
                  >
                    {settings.touch.palmRejection ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <Row
                  label={t("studio.settings.touch.toolTipHoldLabel")}
                  hint={t("studio.settings.touch.toolTipHoldHint")}
                >
                  <label className="flex items-center gap-2 text-[0.7rem] text-fg-2">
                    <input
                      type="range"
                      min={MIN_STUDIO_TOOL_HINT_TOUCH_HOLD_MS}
                      max={MAX_STUDIO_TOOL_HINT_TOUCH_HOLD_MS}
                      step={20}
                      value={settings.touch.toolHintHoldMs}
                      onChange={(event) =>
                        patch({
                          touch: {
                            ...settings.touch,
                            toolHintHoldMs: Number(event.target.value),
                          },
                        })
                      }
                      className="min-h-11 w-28 accent-accent sm:min-h-8 pointer-coarse:min-h-11"
                      aria-label={t("studio.settings.touch.toolTipHoldAria")}
                    />
                    <output className="min-w-12 tabular-nums text-fg-3">
                      {settings.touch.toolHintHoldMs}ms
                    </output>
                  </label>
                </Row>
              </>
            ) : null}

            {tab === "toolbar" ? (
              <>
                <div className="sticky -top-4 z-10 -mx-4 -mt-4 space-y-2 border-b border-line bg-panel/95 px-4 pb-3 pt-4 backdrop-blur-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <SectionLabel>{t("studio.settings.section.toolbar")}</SectionLabel>
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                        {t("studio.settings.toolbar.searchLiveHint")}
                      </p>
                    </div>
                    <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.65rem] font-semibold tabular-nums text-fg-3">
                      {`${t("studio.settings.toolbar.visibleLabel")} ${visible.length} · ${t("studio.settings.toolbar.hiddenLabel")} ${hidden.length}`}
                    </span>
                  </div>
                  <label className="relative block">
                    <span className="sr-only">{t("studio.settings.toolbar.searchAria")}</span>
                    <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
                    <input
                      type="search"
                      value={toolbarQuery}
                      onChange={(event) => setToolbarQuery(event.target.value.slice(0, 80))}
                      placeholder={t("studio.settings.toolbar.searchPlaceholder")}
                      className="h-11 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-xs text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-10 pointer-coarse:h-11 pointer-coarse:min-h-11"
                    />
                  </label>
                </div>
                <div className="grid min-h-0 gap-3 sm:grid-cols-2">
                  <section className="flex min-h-0 flex-col rounded-xl border border-line bg-card/20 p-2" aria-labelledby={`${titleId}-toolbar-visible`}>
                    <p id={`${titleId}-toolbar-visible`} className="mb-2 flex items-center justify-between gap-2 px-1 text-[0.66rem] font-semibold text-fg-3">
                      <span>{t("studio.settings.toolbar.visibleLabel")}</span>
                      <span className="tabular-nums">{visibleMatches.length}</span>
                    </p>
                    <ul className="max-h-[min(26rem,50dvh)] space-y-1 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-gutter:stable]">
                      {visibleMatches.map((id) => (
                        <li
                          key={id}
                          className="group flex min-h-11 items-center gap-1 rounded-lg border border-transparent bg-card/70 px-2 py-1.5 text-xs text-fg transition-colors hover:border-line hover:bg-raised"
                        >
                          <span className="min-w-0 flex-1 truncate">{studioRailToolLabel(id, t)}</span>
                          <button
                            type="button"
                            className={cn(
                              buttonClass({ size: "sm", variant: "quiet" }),
                              "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                            )}
                                aria-label={`${studioRailToolLabel(id, t)} ${t("studio.settings.toolbar.moveUp")}`}
                            disabled={visible.indexOf(id) === 0}
                            onClick={() =>
                              patch({
                                toolbar: { visibleIds: moveStudioRailTool(visible, id, -1) },
                              })
                            }
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className={cn(
                              buttonClass({ size: "sm", variant: "quiet" }),
                              "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                            )}
                                aria-label={`${studioRailToolLabel(id, t)} ${t("studio.settings.toolbar.moveDown")}`}
                            disabled={visible.indexOf(id) === visible.length - 1}
                            onClick={() =>
                              patch({
                                toolbar: { visibleIds: moveStudioRailTool(visible, id, 1) },
                              })
                            }
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className={cn(
                              buttonClass({ size: "sm", variant: "quiet" }),
                              "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                            )}
                                aria-label={`${studioRailToolLabel(id, t)} ${t("studio.settings.toolbar.hide")}`}
                            disabled={visible.length <= 1}
                            onClick={() =>
                              patch({ toolbar: { visibleIds: hideStudioRailTool(visible, id) } })
                            }
                          >
                            <EyeOff className="size-3.5" />
                          </button>
                        </li>
                      ))}
                      {visibleMatches.length === 0 ? (
                        <li className="rounded-lg px-2 py-6 text-center text-[0.7rem] text-fg-3">
                          {t("studio.settings.toolbar.visibleHint")}
                        </li>
                      ) : null}
                    </ul>
                  </section>
                  <section className="flex min-h-0 flex-col rounded-xl border border-line border-dashed bg-card/10 p-2" aria-labelledby={`${titleId}-toolbar-hidden`}>
                    <p id={`${titleId}-toolbar-hidden`} className="mb-2 flex items-center justify-between gap-2 px-1 text-[0.66rem] font-semibold text-fg-3">
                      <span>{t("studio.settings.toolbar.hiddenLabel")}</span>
                      <span className="tabular-nums">{hiddenMatches.length}</span>
                    </p>
                    {hiddenMatches.length === 0 ? (
                      <p className="grid min-h-24 place-items-center px-2 py-5 text-center text-[0.68rem] leading-relaxed text-fg-3">
                        {normalizedToolbarQuery
                          ? t("studio.settings.toolbar.hiddenEmptyWithQuery")
                          : t("studio.settings.toolbar.hiddenEmpty")}
                      </p>
                    ) : (
                      <ul className="max-h-[min(26rem,50dvh)] space-y-1 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-gutter:stable]">
                        {hiddenMatches.map((id) => (
                          <li
                            key={id}
                            className="flex min-h-11 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-fg-2 transition-colors hover:bg-raised"
                          >
                            <span className="min-w-0 flex-1 truncate">{studioRailToolLabel(id, t)}</span>
                            <button
                              type="button"
                              className={cn(
                                buttonClass({ size: "sm", variant: "quiet" }),
                                "min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                              )}
                              aria-label={`${studioRailToolLabel(id, t)} ${t("studio.settings.toolbar.show")}`}
                              onClick={() =>
                                patch({ toolbar: { visibleIds: showStudioRailTool(visible, id) } })
                              }
                            >
                              <Eye className="size-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card/20 p-2.5">
                  <p className="text-[0.68rem] text-fg-3">
                    {t("studio.settings.toolbar.moveApplyHint")}
                  </p>
                  <button
                    type="button"
                    className={cn(
                      buttonClass({ size: "sm", variant: "quiet" }),
                      "min-h-11 sm:min-h-8 pointer-coarse:min-h-11"
                    )}
                    aria-label={t("studio.settings.toolbar.resetAria")}
                    onClick={() =>
                      patch({ toolbar: { visibleIds: [...DEFAULT_STUDIO_RAIL_TOOL_ORDER] } })
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t("studio.settings.toolbar.reset")}
                  </button>
                </div>
              </>
            ) : null}

            {tab === "grids" ? (
              <>
                <SectionLabel>{t("studio.settings.section.grids")}</SectionLabel>
                <Row
                  label={t("studio.settings.grids.canvasRulerLabel")}
                  hint={t("studio.settings.grids.canvasRulerHint")}
                >
                  <StudioToggleChip
                    active={settings.grids.showCanvasRulers}
                    onClick={() =>
                      patch({
                        grids: {
                          ...settings.grids,
                          showCanvasRulers: !settings.grids.showCanvasRulers,
                        },
                      })
                    }
                  >
                    {settings.grids.showCanvasRulers ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <Row
                  label={t("studio.settings.grids.pixelGridLabel")}
                  hint={t("studio.settings.grids.pixelGridHint")}
                >
                  <StudioToggleChip
                    active={settings.grids.showPixelGrid}
                    onClick={() =>
                      patch({
                        grids: { ...settings.grids, showPixelGrid: !settings.grids.showPixelGrid },
                      })
                    }
                  >
                    {settings.grids.showPixelGrid ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <Row label={t("studio.settings.grids.gridSizeLabel")}>
                  <select
                    value={settings.grids.pixelGridSize}
                    onChange={(e) =>
                      patch({
                        grids: { ...settings.grids, pixelGridSize: Number(e.target.value) },
                      })
                    }
                    className="min-h-11 rounded-md border border-line bg-card px-2 py-1 text-xs text-fg sm:min-h-8 pointer-coarse:min-h-11"
                  >
                    {STUDIO_PIXEL_GRID_SIZE_OPTIONS.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz}px
                      </option>
                    ))}
                  </select>
                </Row>
                <Row
                  label={t("studio.settings.grids.snapLabel")}
                  hint={t("studio.settings.grids.snapHint")}
                >
                  <StudioToggleChip
                    active={settings.grids.snapToPixelGrid}
                    onClick={() =>
                      patch({
                        grids: {
                          ...settings.grids,
                          snapToPixelGrid: !settings.grids.snapToPixelGrid,
                        },
                      })
                    }
                  >
                    {settings.grids.snapToPixelGrid ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <Row
                  label={t("studio.settings.grids.alignGuideLabel")}
                  hint={t("studio.settings.grids.alignGuideHint")}
                >
                  <StudioToggleChip
                    active={settings.grids.showAlignmentGuides}
                    onClick={() =>
                      patch({
                        grids: {
                          ...settings.grids,
                          showAlignmentGuides: !settings.grids.showAlignmentGuides,
                        },
                      })
                    }
                  >
                    {settings.grids.showAlignmentGuides ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <Row label={t("studio.settings.grids.isometricLabel")}>
                  <StudioToggleChip
                    active={settings.grids.showIsometricOnDraw}
                    onClick={() =>
                      patch({
                        grids: {
                          ...settings.grids,
                          showIsometricOnDraw: !settings.grids.showIsometricOnDraw,
                        },
                      })
                    }
                  >
                    {settings.grids.showIsometricOnDraw ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
              </>
            ) : null}

            {tab === "other" ? (
              <>
                <SectionLabel>{t("studio.settings.section.other")}</SectionLabel>
                <div className="rounded-xl border border-line bg-card/40 p-3">
                  <StudioPressureCurveGraph
                    pressureCurve={settings.other.pressureCurve}
                    onPressureCurveChange={(pressureCurve) =>
                      patch({ other: { ...settings.other, pressureCurve } })
                    }
                  />
                  <p className="mt-2 text-[0.68rem] text-fg-3">{t("studio.settings.other.pressureHint")}</p>
                </div>
                <Row
                  label={t("studio.settings.other.motionReduceLabel")}
                  hint={t("studio.settings.other.motionReduceHint")}
                >
                  <StudioToggleChip
                    active={settings.other.reduceMotion}
                    onClick={() =>
                      patch({
                        other: { ...settings.other, reduceMotion: !settings.other.reduceMotion },
                      })
                    }
                  >
                    {settings.other.reduceMotion ? t("studio.settings.state.on") : t("studio.settings.state.off")}
                  </StudioToggleChip>
                </Row>
                <div className="rounded-xl border border-bad/30 bg-bad/5 p-3">
                  <p className="text-xs font-semibold text-fg">
                    {t("studio.settings.other.resetSectionTitle")}
                  </p>
                  <p className="mt-0.5 text-[0.68rem] text-fg-3">
                    {t("studio.settings.other.resetHint")}
                  </p>
                  <button
                    type="button"
                    className={cn(
                      buttonClass({ size: "sm", variant: "quiet" }),
                      "mt-2 min-h-11 text-bad sm:min-h-8 pointer-coarse:min-h-11"
                    )}
                    onClick={() => {
                      void runStudioDestructiveAction({
                        request: studioResetApplicationSettingsRequest(),
                        execute: onResetAll,
                      });
                    }}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t("studio.settings.other.reset")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <div className="min-w-0 flex-1" aria-live="polite">
            {persistenceState === "session-only" ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] leading-snug text-warning"
              >
                <span>{t("studio.settings.other.persistenceSessionWarning")}</span>
                {onRetryPersistence ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-lg px-2 font-semibold underline decoration-warning/50 underline-offset-2 hover:bg-warning/10 sm:min-h-9 pointer-coarse:min-h-11"
                    aria-label={t("studio.settings.other.persistenceRetry")}
                    onClick={onRetryPersistence}
                  >
                    {t("studio.settings.other.persistenceRetry")}
                  </button>
                ) : null}
              </div>
            ) : persistenceState === "loading" ? (
              <p
                className="text-[0.68rem] text-fg-3"
                data-studio-app-settings-persistence="loading"
              >
                SQLite/OPFS에서 설정을 확인하는 중입니다.
              </p>
            ) : (
              <p className="text-[0.68rem] text-fg-3">
                {t("studio.settings.other.persistenceSaved")}
              </p>
            )}
          </div>
          <button
            type="button"
            className={cn(
              buttonClass({ size: "sm", variant: "outline" }),
              "min-h-11 sm:min-h-8 pointer-coarse:min-h-11"
            )}
            onClick={onClose}
          >
            {t("studio.settings.state.save")}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
