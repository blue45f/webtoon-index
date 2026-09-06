/**
 * Character Shaper — summary bar: title + model picker, style summary, palette swatches, changed
 * count, undo/redo, hold-to-compare, reset-to-baseline (confirm), save variant (named), 고급 편집
 * toggle and close. Below the tablet breakpoint the secondary actions fold into a "더 보기" panel.
 */
import { ChevronDown, Ellipsis, Eye, Redo2, RotateCcw, Save, SlidersHorizontal, Undo2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";

import { describeCharacterRecipe, diffCharacterRecipes } from "./character-shaper-recipe";
import { CHARACTER_SHAPER_TABLET_QUERY, pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";

import type { CharacterRecipeColors, CharacterSlotKind } from "./character-shaper-contract";
import type { CharacterShaperSummaryBarProps } from "./character-shaper-ui-contract";
import type { VrmLibraryEntry } from "../vrm/vrm-library";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { useMediaQuery } from "@/src/hooks/use-media-query";

type SummaryPopover = "reset" | "save" | "more";

const ICON_BUTTON = cn(
  "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2",
  "transition-colors duration-150 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const TEXT_BUTTON = cn(
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.75rem] font-semibold text-fg-2",
  "transition-colors duration-150 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const PRIMARY_BUTTON = cn(
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-accent/60 bg-accent px-3 text-[0.75rem] font-semibold text-on-accent",
  "transition-colors duration-150 hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

const SWATCHES: readonly { readonly key: keyof CharacterRecipeColors; readonly label: string }[] = [
  { key: "skin", label: "피부" },
  { key: "hairBase", label: "머리" },
  { key: "iris", label: "눈동자" },
  { key: "top", label: "상의" },
  { key: "bottom", label: "하의" },
];

const SAVED_NOTICE_MS = 3200;

function PaletteSwatches({ colors, compact }: { readonly colors: CharacterRecipeColors; readonly compact: boolean }) {
  return (
    <div role="group" aria-label="팔레트" className="flex shrink-0 items-center gap-1">
      {SWATCHES.map((swatch) => {
        const color = colors[swatch.key];
        return (
          <span
            key={swatch.key}
            role="img"
            aria-label={color ? `${swatch.label} ${color}` : `${swatch.label} 색 없음`}
            title={color ? `${swatch.label} ${color}` : `${swatch.label} · 색 없음`}
            className={cn(
              "block rounded-full border",
              compact ? "size-3.5" : "size-4",
              color ? "border-line-strong/70" : "border-dashed border-line-strong bg-raised",
            )}
            style={color ? { backgroundColor: color } : undefined}
          />
        );
      })}
    </div>
  );
}

export function CharacterShaperSummaryBar({
  h,
  binding,
  advanced,
  onToggleAdvanced,
  onClose,
  titleId,
  descriptionId,
}: CharacterShaperSummaryBarProps) {
  const wide = useMediaQuery(CHARACTER_SHAPER_TABLET_QUERY);
  const compact = !wide;
  const selectId = useId();
  const saveInputId = useId();
  const resetTitleId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popover, setPopover] = useState<SummaryPopover | null>(null);
  const [saveName, setSaveName] = useState("");
  const [pendingSave, setPendingSave] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const entries: readonly VrmLibraryEntry[] = Array.isArray(h.libraryEntries) ? h.libraryEntries : [];
  const activeModelId: string | null = typeof h.activeModelId === "string" ? h.activeModelId : null;
  const modelName = entries.find((entry) => entry.id === activeModelId)?.name ?? null;
  const loading = h.status === "loading";
  const capturing = Boolean(h.isCapturing);
  const summary = describeCharacterRecipe(binding.recipe, binding.catalog);
  const changedSlots = diffCharacterRecipes(binding.baselineRecipe, binding.recipe);
  const changedCount = changedSlots.length;
  const slotLabel = (slot: CharacterSlotKind) => binding.catalog.slots.find((meta) => meta.id === slot)?.label ?? slot;
  const changedTitle = changedCount > 0 ? `변경된 슬롯: ${changedSlots.map(slotLabel).join(", ")}` : "아직 바꾼 슬롯이 없습니다";
  const styleText = summary.style.trim().length > 0 ? summary.style : "직접 조합";
  const recentLabel = binding.history.recentLabels[0] ?? null;
  const canCompare = changedCount > 0 && binding.busyReason === null;
  const fullStateName: string = typeof h.fullStateName === "string" ? h.fullStateName : "";
  const savedStates = h.savedFullStates as Readonly<Record<string, unknown>> | undefined;

  // Save flow: the host's handleSaveFullLocal reads `fullStateName` from its own render, so we
  // set the name first and only save once the host echoes it back.
  useEffect(() => {
    if (pendingSave === null || fullStateName !== pendingSave) return;
    h.handleSaveFullLocal();
    setPendingSave(null);
    setSavedNotice(pendingSave);
  }, [pendingSave, fullStateName, h]);

  useEffect(() => {
    if (savedNotice === null) return;
    const timer = window.setTimeout(() => setSavedNotice(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  const closePopover = (restoreFocus: boolean) => {
    setPopover(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const openPopover = (next: SummaryPopover, trigger: HTMLButtonElement) => {
    if (popover === next) {
      closePopover(false);
      return;
    }
    triggerRef.current = trigger;
    if (next === "save") {
      setSaveName(fullStateName || `${modelName ?? "캐릭터"} 변형`);
    }
    setPopover(next);
  };

  useEffect(() => {
    if (popover === null) return;
    const panel = popoverRef.current;
    panel?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || triggerRef.current?.contains(target)) return;
      setPopover(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    const release = pushCharacterShaperKeyLayer((event) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPopover(null);
      triggerRef.current?.focus({ preventScroll: true });
      return true;
    }, window);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      release();
    };
  }, [popover]);

  const startCompare = () => {
    if (!canCompare) return;
    binding.setCompareActive(true);
  };
  const stopCompare = () => {
    binding.setCompareActive(false);
  };
  const handleComparePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional; a plain press/release still works.
    }
    startCompare();
  };
  const handleCompareKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      startCompare();
    }
  };
  const handleCompareKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      stopCompare();
    }
  };

  const submitSave = () => {
    const name = saveName.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!name) return;
    h.setFullStateName(name);
    setPendingSave(name);
    closePopover(true);
  };

  const confirmReset = () => {
    binding.resetToBaseline();
    closePopover(true);
  };

  const savedConfirmed = savedNotice !== null && savedStates !== undefined && savedNotice in savedStates;

  const modelPicker = entries.length > 0 ? (
    <div className="relative shrink-0">
      <label htmlFor={selectId} className="sr-only">
        모델
      </label>
      <select
        id={selectId}
        value={activeModelId ?? ""}
        disabled={loading}
        onChange={(event) => {
          const entry = entries.find((candidate) => candidate.id === event.currentTarget.value);
          if (entry) h.loadModelFromLibraryEntry(entry);
        }}
        className={cn(
          "h-9 max-w-[12rem] appearance-none truncate rounded-lg border border-line bg-card pl-2.5 pr-7 text-[0.75rem] font-semibold text-fg",
          "hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11",
          STUDIO_FOCUS_RING,
        )}
      >
        {activeModelId === null || !entries.some((entry) => entry.id === activeModelId) ? (
          <option value="">모델 없음</option>
        ) : null}
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-3" />
    </div>
  ) : null;

  const resetPanel: ReactNode = (
    <div role="group" aria-labelledby={resetTitleId} className="flex flex-col gap-2">
      <p id={resetTitleId} className="text-sm font-bold text-fg">
        처음 상태로 되돌릴까요?
      </p>
      <p className="text-[0.72rem] leading-relaxed text-fg-3">
        이 세션에서 바꾼 슬롯 {changedCount}개를 열었을 때 상태로 되돌립니다.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className={TEXT_BUTTON} onClick={() => closePopover(true)}>
          취소
        </button>
        <button type="button" className={PRIMARY_BUTTON} onClick={confirmReset}>
          <RotateCcw size={14} aria-hidden />
          되돌리기
        </button>
      </div>
    </div>
  );

  const savePanel: ReactNode = (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submitSave();
      }}
    >
      <label htmlFor={saveInputId} className="text-sm font-bold text-fg">
        변형 이름
      </label>
      <input
        id={saveInputId}
        type="text"
        value={saveName}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => setSaveName(event.currentTarget.value)}
        className={cn(
          "h-11 w-full rounded-lg border border-line bg-panel px-3 text-[0.8rem] text-fg placeholder:text-fg-3",
          STUDIO_FOCUS_RING,
        )}
        placeholder="예: 교복 · 보브 버전"
      />
      <p className="text-[0.7rem] leading-relaxed text-fg-3">전체 상태(조형·의상·포즈·표정)를 이 기기의 라이브러리에 저장합니다.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={TEXT_BUTTON} onClick={() => closePopover(true)}>
          취소
        </button>
        <button type="submit" className={PRIMARY_BUTTON} disabled={saveName.trim().length === 0}>
          <Save size={14} aria-hidden />
          저장
        </button>
      </div>
    </form>
  );

  const undoRedo = (
    <div role="group" aria-label="편집 기록" className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label="실행 취소"
        aria-keyshortcuts="Meta+Z Control+Z"
        title={recentLabel && binding.history.canUndo ? `실행 취소: ${recentLabel} (⌘Z)` : "실행 취소 (⌘Z)"}
        disabled={!binding.history.canUndo}
        onClick={() => binding.undo()}
        className={ICON_BUTTON}
      >
        <Undo2 size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="다시 실행"
        aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
        title="다시 실행 (⇧⌘Z)"
        disabled={!binding.history.canRedo}
        onClick={() => binding.redo()}
        className={ICON_BUTTON}
      >
        <Redo2 size={16} aria-hidden />
      </button>
    </div>
  );

  const compareButton = (
    <button
      type="button"
      aria-pressed={binding.compareActive}
      aria-label="기준 상태와 비교 (누르고 있기)"
      title={canCompare ? "누르고 있는 동안 열었을 때 상태를 보여줍니다" : "바꾼 슬롯이 없어 비교할 내용이 없습니다"}
      disabled={!canCompare}
      data-character-shaper-compare="true"
      onPointerDown={handleComparePointerDown}
      onPointerUp={stopCompare}
      onPointerCancel={stopCompare}
      onLostPointerCapture={stopCompare}
      onKeyDown={handleCompareKeyDown}
      onKeyUp={handleCompareKeyUp}
      onBlur={stopCompare}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        compact ? ICON_BUTTON : TEXT_BUTTON,
        binding.compareActive && "border-accent/60 bg-accent-soft text-accent",
      )}
    >
      <Eye size={16} aria-hidden />
      {compact ? null : "비교"}
    </button>
  );

  const changedPill = (
    <span
      title={changedTitle}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold tabular-nums",
        changedCount > 0 ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-raised/80 text-fg-3",
      )}
    >
      변경 {changedCount}
    </span>
  );

  return (
    <header
      data-character-shaper-summary="true"
      className="relative z-30 flex shrink-0 items-center gap-2 border-b border-line bg-panel/95 px-2.5 py-2 backdrop-blur sm:gap-3 sm:px-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.62rem] font-semibold tracking-wide text-accent">캐릭터 워크숍</p>
          <h2 id={titleId} className="truncate text-[0.95rem] font-bold tracking-tight text-fg sm:text-base">
            캐릭터 셰이퍼
          </h2>
          <p id={descriptionId} className="sr-only">
            {`${modelName ?? "모델 없음"} · ${styleText} · 바꾼 슬롯 ${changedCount}개. 프리셋 카드를 눌러 바로 적용하고, 사진·웹캠으로 포즈를 잡고, 표면에 직접 그립니다.`}
          </p>
        </div>
        {compact ? (
          <span className="min-w-0 truncate text-[0.72rem] text-fg-3" title={modelName ?? "모델 없음"}>
            {modelName ?? "모델 없음"}
          </span>
        ) : (
          <>
            {modelPicker ?? <span className="text-[0.75rem] text-fg-3">모델 없음</span>}
            <span aria-hidden className="h-6 w-px shrink-0 bg-line" />
            <span className="min-w-0 truncate text-[0.75rem] font-medium text-fg-2" title={summary.lines.join("\n")}>
              {styleText}
            </span>
            <PaletteSwatches colors={binding.recipe.colors} compact={false} />
            {changedPill}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {undoRedo}
        {compareButton}
        {compact ? (
          <div className="relative">
            <button
              type="button"
              aria-label="더 보기"
              aria-haspopup="dialog"
              aria-expanded={popover === "more"}
              title="되돌리기 · 저장 · 고급 편집"
              onClick={(event) => openPopover("more", event.currentTarget)}
              className={cn(ICON_BUTTON, popover === "more" && "border-accent/60 bg-accent-soft text-accent")}
            >
              <Ellipsis size={16} aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={popover === "reset"}
                title="열었을 때 상태로 되돌리기"
                disabled={changedCount === 0}
                onClick={(event) => openPopover("reset", event.currentTarget)}
                className={TEXT_BUTTON}
              >
                <RotateCcw size={14} aria-hidden />
                되돌리기
              </button>
            </div>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={popover === "save"}
                title="현재 캐릭터를 이름 붙여 저장"
                disabled={loading || h.status === "empty"}
                onClick={(event) => openPopover("save", event.currentTarget)}
                className={TEXT_BUTTON}
              >
                <Save size={14} aria-hidden />
                저장
              </button>
            </div>
            <button
              type="button"
              aria-pressed={advanced}
              title="원래 3D 캐릭터 빌더(모든 슬라이더·탭)로 전환"
              onClick={onToggleAdvanced}
              className={cn(TEXT_BUTTON, advanced && "border-accent/60 bg-accent-soft text-accent")}
            >
              <SlidersHorizontal size={14} aria-hidden />
              고급 편집
            </button>
          </>
        )}
        <button
          ref={h.closeButtonRef}
          type="button"
          aria-label="닫기"
          title={capturing ? "캡처가 끝난 뒤 닫을 수 있습니다." : "닫기 (Esc)"}
          disabled={capturing}
          onClick={onClose}
          className={ICON_BUTTON}
        >
          <X size={17} aria-hidden />
        </button>
      </div>

      {savedNotice !== null ? (
        <p
          role="status"
          className={cn(
            "absolute right-3 top-full z-30 mt-1 rounded-lg border px-2.5 py-1 text-[0.7rem] font-semibold shadow-md",
            savedConfirmed ? "border-good/40 bg-panel text-good" : "border-line bg-panel text-fg-3",
          )}
        >
          {savedConfirmed ? `저장됨 · ${savedNotice}` : `저장 요청됨 · ${savedNotice}`}
        </p>
      ) : null}

      {popover !== null ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={popover === "reset" ? "처음 상태로 되돌리기" : popover === "save" ? "변형 저장" : "더 보기"}
          data-character-shaper-popover={popover}
          className={cn(
            "absolute top-full z-40 mt-1 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-card p-3 shadow-[0_18px_48px_oklch(0.05_0.01_70/0.5)]",
            compact ? "right-2" : "right-14",
          )}
        >
          {popover === "reset" ? resetPanel : null}
          {popover === "save" ? savePanel : null}
          {popover === "more" ? (
            <div className="flex flex-col gap-3">
              {modelPicker}
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[0.75rem] font-medium text-fg-2">{styleText}</span>
                {changedPill}
              </div>
              <PaletteSwatches colors={binding.recipe.colors} compact />
              <div className="border-t border-line pt-3">
                {changedCount > 0 ? (
                  resetPanel
                ) : (
                  <p className="text-[0.72rem] text-fg-3">아직 바꾼 슬롯이 없습니다.</p>
                )}
              </div>
              <div className="border-t border-line pt-3">{savePanel}</div>
              <button
                type="button"
                aria-pressed={advanced}
                onClick={() => {
                  closePopover(false);
                  onToggleAdvanced();
                }}
                className={cn(TEXT_BUTTON, "justify-center", advanced && "border-accent/60 bg-accent-soft text-accent")}
              >
                <SlidersHorizontal size={14} aria-hidden />
                고급 편집
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
