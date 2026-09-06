/**
 * Studio Panel UI — 필터 패널들이 공유하는 프레젠테이션 프리미티브.
 * 각 Studio*Panel.tsx 가 복붙하던 공용 클래스 상수 + 라벨/슬라이더 행 + 선택 칩을
 * 한 곳으로 모아 중복(copy-paste)을 제거한다. 상태 없는 순수 프레젠테이션.
 *
 * 디자인 규범: DESIGN.md warm-ink 표면 단계, 44px 터치, accent는 활성 신호만,
 * text-white/side-stripe 금지, focus ring = accent.
 */
import { useEffect, useRef, useState } from "react";

import { StudioSurfaceState } from "./StudioSurfaceState";

import type { KeyboardEvent, ReactElement, ReactNode } from "react";


import { cn } from "@/shared/lib/utils";

export { StudioSurfaceState };

/* eslint-disable react-refresh/only-export-components -- panel tokens + class helpers shared across Studio panels */
// ── 공용 상호작용 토큰 ────────────────────────────────────────────────────
export const STUDIO_FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
export const STUDIO_TOUCH_TARGET =
  "min-h-11 pointer-coarse:min-h-11 max-lg:min-h-11";
export const STUDIO_EASE = "transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]";

// 공용 라벨 행 + 레인지/회독(readout) 스타일. 모든 패널이 동일 폭으로 정렬한다.
// 터치 기기(S11 등 작은 폰)에서는 패널 컨트롤을 키워 thumb 로 다루기 쉽게 한다(pointer-coarse).
// 데스크톱(fine pointer)은 기존 컴팩트 사이즈 유지 — 정밀 조작·공간 효율.
export const PANEL_LABEL_ROW =
  "flex items-center justify-between gap-2 text-xs pointer-coarse:text-[0.8125rem] text-fg-2";
export const PANEL_RANGE_CLASS =
  "h-6 w-24 accent-accent cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:w-32";
export const PANEL_READOUT_CLASS =
  "w-8 pointer-coarse:w-9 text-right text-[0.72rem] pointer-coarse:text-[0.75rem] tabular-nums text-fg-3";
// 터치 승격은 높이만 44px 로 올려 두고 폭은 콘텐츠에 맡겼는데, "소·중·대" 처럼 한 글자짜리
// 칩은 34px 밖에 되지 않아 44px 계약을 세로로만 지키고 있었다. 폭도 함께 올린다.
export const PANEL_CHIP_CLASS =
  "min-h-6 rounded-md border border-line bg-card px-2 py-0.5 text-[0.72rem] text-fg-2 transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-45 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2.5 pointer-coarse:py-1.5 pointer-coarse:text-[0.75rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** 툴바 도구 버튼 — 활성은 accent soft, 비활성은 quiet. dense = canvas-max draw-app belt. */
export function studioToolButtonClass(active: boolean, options?: { dense?: boolean }): string {
  return cn(
    "inline-flex shrink-0 items-center whitespace-nowrap rounded-xl border font-semibold tracking-tight",
    STUDIO_EASE,
    STUDIO_FOCUS_RING,
    options?.dense
      ? "h-9 gap-1.5 px-2.5 text-[0.72rem] max-lg:h-11 max-lg:min-h-11 pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:gap-1.5 pointer-coarse:px-3 pointer-coarse:text-[0.8125rem]"
      : cn("h-9 gap-1.5 px-2.5 text-xs", STUDIO_TOUCH_TARGET, "pointer-coarse:px-3"),
    active
      ? "border-accent/50 bg-accent-soft text-fg shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.16),0_1px_4px_oklch(0.72_0.185_42/0.1)]"
      : "border-transparent bg-transparent text-fg-2 hover:border-line/70 hover:bg-raised/90 hover:text-fg"
  );
}

/** 세그먼트/필터 칩 — 활성은 accent 면 + on-accent 글자(white 금지). */
export function studioSegmentChipClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold",
    STUDIO_EASE,
    STUDIO_FOCUS_RING,
    "pointer-coarse:min-h-11 pointer-coarse:px-3",
    active
      ? "border-accent bg-accent text-on-accent"
      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
  );
}

// 프리셋/종류 선택 칩. active 면 강조 테두리(현재 선택)로 표시한다.
export function StudioPanelChip({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(PANEL_CHIP_CLASS, active && "border-accent bg-accent-soft/50 text-fg")}
    >
      {children}
    </button>
  );
}

function coordinateText(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/**
 * 좌표용 decimal 텍스트 입력. 드래그가 만든 소수 좌표를 반올림하지 않으며, 편집 중에만
 * preview를 발행하고 Enter/blur에서 한 번 커밋한다. focus→blur만으로는 문서를 바꾸지 않는다.
 */
export function StudioCoordinateInput({
  value,
  onPreview,
  onCommit,
  label,
  ariaLabel,
  disabled = false,
}: {
  value: number;
  onPreview?: (next: number) => void;
  onCommit: (next: number) => void;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}): ReactElement {
  const [text, setText] = useState(() => coordinateText(value));
  const editingRef = useRef(false);
  const dirtyRef = useRef(false);
  const committedDuringFocusRef = useRef(false);
  const editStartValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const onPreviewRef = useRef(onPreview);
  latestValueRef.current = value;
  onPreviewRef.current = onPreview;

  useEffect(() => {
    if (!editingRef.current) setText(coordinateText(value));
  }, [value]);

  // A panel/tool switch can remove a focused field before blur. Revert a live preview instead of
  // leaving it in the parent document draft where a later, unrelated action could persist it.
  useEffect(() => () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onPreviewRef.current?.(editStartValueRef.current);
  }, []);

  const restoreEditStart = (): void => {
    const original = editStartValueRef.current;
    dirtyRef.current = false;
    setText(coordinateText(original));
    onPreview?.(original);
  };

  const commitText = (): void => {
    if (!dirtyRef.current) return;
    if (text === "" || text === "-" || text === "." || text === "-.") {
      restoreEditStart();
      return;
    }
    const next = Number(text);
    if (!Number.isFinite(next)) {
      restoreEditStart();
      return;
    }
    dirtyRef.current = false;
    setText(coordinateText(next));
    if (next !== editStartValueRef.current) {
      onCommit(next);
      editStartValueRef.current = next;
      committedDuringFocusRef.current = true;
    }
  };

  return (
    <label className="flex min-w-0 flex-1 items-center gap-1 text-[0.7rem] text-fg-3 pointer-coarse:text-[0.75rem]">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        onFocus={() => {
          editingRef.current = true;
          dirtyRef.current = false;
          committedDuringFocusRef.current = false;
          editStartValueRef.current = value;
        }}
        onChange={(event) => {
          if (disabled) return;
          const raw = event.target.value;
          dirtyRef.current = true;
          setText(raw);
          if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
          const next = Number(raw);
          if (Number.isFinite(next)) onPreview?.(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitText();
          } else if (event.key === "Escape") {
            event.preventDefault();
            restoreEditStart();
          }
        }}
        onBlur={() => {
          const hadPendingEdit = dirtyRef.current;
          commitText();
          editingRef.current = false;
          // A remote/parent value may have changed while an untouched input was focused. Resync it
          // on blur, but never overwrite the text just committed by Enter before the parent renders.
          if (!hadPendingEdit && !committedDuringFocusRef.current) {
            setText(coordinateText(latestValueRef.current));
          }
        }}
        className="min-w-0 w-full rounded border border-line bg-card px-1 py-0.5 text-[0.7rem] text-fg focus-visible:outline focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11 pointer-coarse:px-2 pointer-coarse:text-[0.75rem]"
      />
    </label>
  );
}

/** 패널 섹션 제목 + 보조 설명. 인스펙터·브러시 스튜디오·레이어 공통. */
export function StudioSectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("mb-2 flex min-w-0 items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold tracking-tight text-fg text-pretty">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-3 text-pretty">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** 빈 상태를 가르치는 UI — 공통 상태 프리미티브의 호환 래퍼. */
export function StudioEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <StudioSurfaceState
      state="empty"
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

/** 인스펙터/시트 상단 컨텍스트 칩(선택 요약). */
export function StudioContextPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn";
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold tabular-nums",
        tone === "accent" && "border-accent/40 bg-accent-soft text-accent",
        tone === "good" && "border-good/35 bg-good/10 text-good",
        tone === "warn" && "border-warn/40 bg-warn/10 text-warn",
        tone === "neutral" && "border-line bg-raised/80 text-fg-3"
      )}
    >
      {children}
    </span>
  );
}

// 스와치(색 점)를 품는 프리셋 칩 — CSP/Photopea 룩 팔레트 칩.
export const PANEL_SWATCH_CHIP_CLASS =
  "flex min-h-6 items-center gap-1.5 rounded-lg border border-line/80 bg-card/90 px-2 py-1 text-[0.72rem] font-medium text-fg-2 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.04)] transition-[background,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-raised hover:text-fg pointer-coarse:min-h-11 pointer-coarse:px-2.5 pointer-coarse:py-1.5 pointer-coarse:text-[0.75rem]";

// 색 스와치 + 라벨을 한 칩에 담는 프리셋 칩. swatch 는 color 로 칠하고, active 면 강조 테두리로 표시한다.
export function StudioSwatchChip({
  color,
  label,
  active = false,
  title,
  onClick,
}: {
  color: string;
  label: ReactNode;
  active?: boolean;
  title?: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-studio-swatch-chip="true"
      className={cn(
        PANEL_SWATCH_CHIP_CLASS,
        active && "border-accent/60 bg-accent-soft/40 text-fg shadow-sm ring-1 ring-accent/20"
      )}
    >
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-md border border-line/50 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.25),0_1px_2px_oklch(0.1_0.01_70/0.25)] ring-1 ring-black/10"
        style={{ backgroundColor: color }}
      />
      {label}
    </button>
  );
}

// aria-pressed 를 가진 토글/세그먼트 칩 한 개. 단일 on/off(글로우 원색) 또는 다중 모드 선택(하프톤)에 모두 쓴다.
export function StudioToggleChip({
  active,
  disabled = false,
  title,
  onClick,
  children,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
  "aria-label"?: string;
  "aria-describedby"?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      title={title}
      className={cn(PANEL_CHIP_CLASS, active && "border-accent bg-accent-soft/50 text-fg")}
    >
      {children}
    </button>
  );
}

// 라벨 + 레인지 슬라이더 + 우측 readout 한 줄. readout 미지정 시 value 를 그대로 표시한다.
export function StudioSliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  disabled = false,
  readout,
  formatReadout,
}: {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  /**
   * Immediate value notification. Without onCommit this keeps the historical,
   * fully-controlled behavior. With onCommit it is a transient preview only.
   */
  onChange: (next: number) => void;
  /**
   * Enables deferred mode. The slider owns its visible draft and calls this
   * once when a pointer, keyboard, or focus interaction finishes.
   */
  onCommit?: (next: number) => void;
  disabled?: boolean;
  readout?: ReactNode;
  /** Deferred mode readout derived from the visible draft value. */
  formatReadout?: (draftValue: number) => ReactNode;
}): ReactElement {
  const deferred = onCommit !== undefined;
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const hasPendingCommitRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!deferred || !hasPendingCommitRef.current) {
      draftValueRef.current = value;
      committedValueRef.current = value;
      setDraftValue(value);
    }
  }, [deferred, value]);

  const finishDeferredInteraction = (): void => {
    if (!onCommit || !hasPendingCommitRef.current) return;
    const next = draftValueRef.current;
    hasPendingCommitRef.current = false;
    committedValueRef.current = next;
    onCommit(next);
  };

  const cancelDeferredInteraction = (updateLocalDraft = true): void => {
    if (!deferred || !hasPendingCommitRef.current) return;
    const committed = committedValueRef.current;
    hasPendingCommitRef.current = false;
    draftValueRef.current = committed;
    if (updateLocalDraft) setDraftValue(committed);
    // Clear the caller-owned transient preview without creating a document commit.
    onChangeRef.current(committed);
  };

  const cancelDeferredInteractionRef = useRef<(updateLocalDraft?: boolean) => void>(() => undefined);
  cancelDeferredInteractionRef.current = cancelDeferredInteraction;

  useEffect(() => () => {
    // React does not guarantee blur before a focused subtree unmounts. Clear the parent's transient
    // preview without updating this already-unmounting component's local state.
    cancelDeferredInteractionRef.current(false);
  }, []);

  useEffect(() => {
    if (disabled) cancelDeferredInteractionRef.current();
  }, [disabled]);

  const handleRangeKeyUp = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      finishDeferredInteraction();
    }
  };

  const handleRangeKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelDeferredInteraction();
  };

  const visibleValue = deferred ? draftValue : value;
  return (
    <label className={PANEL_LABEL_ROW}>
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={visibleValue}
          disabled={disabled}
          onChange={(event) => {
            if (disabled) return;
            const next = Number(event.target.value);
            if (deferred) {
              draftValueRef.current = next;
              setDraftValue(next);
              hasPendingCommitRef.current = next !== committedValueRef.current;
            }
            onChange(next);
          }}
          onPointerUp={finishDeferredInteraction}
          onPointerCancel={() => cancelDeferredInteraction()}
          onLostPointerCapture={() => cancelDeferredInteraction()}
          onKeyDown={handleRangeKeyDown}
          onKeyUp={handleRangeKeyUp}
          onBlur={finishDeferredInteraction}
          className={PANEL_RANGE_CLASS}
        />
        <span className={PANEL_READOUT_CLASS}>
          {formatReadout ? formatReadout(visibleValue) : (readout ?? visibleValue)}
        </span>
      </span>
    </label>
  );
}
