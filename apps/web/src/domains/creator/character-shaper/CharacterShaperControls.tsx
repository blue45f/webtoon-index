/** Precision controls shared by the inspector, paint HUD and output dock. */
import { Check, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";

import {
  CHARACTER_RANGE_EDIT_KEYS,
  characterRangeSpec,
  clampCharacterValue,
  finalizeCharacterValue,
  formatCharacterNumber,
  formatCharacterValue,
  normalizeCharacterHex,
  nudgeCharacterValue,
  parseCharacterNumber,
  previewCharacterEdit,
  snapCharacterValue,
} from "./character-shaper-precision";
import { pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";

import type { CharacterPrecisionEdit } from "./character-shaper-precision";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { cn } from "@/shared/lib/utils";

const ACTION_BUTTON = cn(
  "grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-panel text-fg-3",
  "transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

export interface CharacterRangeControlProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly defaultValue: number;
  readonly format?: (value: number) => string;
  /** Preview may update the controlled value; the pre-edit value is retained independently. */
  readonly onPreview?: (value: number) => void;
  /** Optional host transaction rollback. Otherwise onPreview receives the original value. */
  readonly onCancel?: () => void;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly id?: string;
}

export function CharacterRangeControl({
  label, value, min, max, step, unit, defaultValue, format, onPreview, onCancel, onCommit,
  disabled = false, hint, id,
}: CharacterRangeControlProps) {
  const generatedId = useId();
  const rangeId = id ?? `${generatedId}-range`;
  const numberId = `${rangeId}-number`;
  const hintId = `${rangeId}-hint`;
  const errorId = `${rangeId}-error`;
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<CharacterPrecisionEdit<number> | null>(null);
  const textRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const pointerRef = useRef<number | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const rollbackRef = useRef<() => void>(() => {});
  const spec = characterRangeSpec(min, max, step);
  const safeValue = clampCharacterValue(value, spec, defaultValue);
  const shown = draft ?? safeValue;
  // A default is an authored value, not a pointer-grid sample. Never snap it to a different value.
  const normalizedDefault = clampCharacterValue(defaultValue, spec);
  const readout = format ? format(shown) : formatCharacterValue(shown, spec.step, unit);
  const defaultReadout = format ? format(normalizedDefault) : formatCharacterValue(normalizedDefault, spec.step, unit);
  const changed = safeValue !== normalizedDefault;
  const span = spec.max - spec.min;
  const markerPercent = span > 0 ? ((normalizedDefault - spec.min) / span) * 100 : 0;
  const editing = draft !== null || text !== null;
  const description = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const clearDraft = () => {
    editRef.current = null;
    textRef.current = null;
    setDraft(null);
    setText(null);
  };

  const rollback = () => {
    const edit = editRef.current;
    editRef.current = null;
    if (!edit) return;
    if (onCancel) onCancel();
    else if (edit.value !== edit.before) onPreview?.(edit.before);
  };

  const cancel = () => {
    rollback();
    clearDraft();
    setError(null);
  };

  useEffect(() => {
    cancelRef.current = cancel;
    rollbackRef.current = rollback;
  });

  useEffect(() => () => rollbackRef.current(), []);

  useEffect(() => {
    if (!disabled) return;
    pointerRef.current = null;
    cancelRef.current();
  }, [disabled]);

  useEffect(() => {
    if (!editing) return;
    const release = pushCharacterShaperKeyLayer((event) => {
      if (event.key !== "Escape" || event.isComposing) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelRef.current();
      return true;
    }, window);
    const onWindowBlur = (event: Event) => {
      // WindowProxy identity can differ across realms. At-target dispatch distinguishes
      // the window losing focus from a descendant's bubbling synthetic blur.
      if (event.eventPhase === Event.AT_TARGET) {
        pointerRef.current = null;
        cancelRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancelRef.current();
    };
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      release();
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [editing]);

  const preview = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const settled = finalizeCharacterValue(next, spec);
    editRef.current = previewCharacterEdit(editRef.current, safeValue, settled);
    textRef.current = null;
    setText(null);
    setDraft(settled);
    setError(null);
    onPreview?.(settled);
  };

  const commit = (next: number) => {
    if (disabled || !Number.isFinite(next)) {
      cancel();
      return;
    }
    const edit = editRef.current;
    const before = edit?.before ?? safeValue;
    const settled = finalizeCharacterValue(next, spec);
    // Clear synchronously: pointer-up, lost capture and blur may all arrive before React renders.
    clearDraft();
    setError(null);
    if (settled === before) {
      if (edit) {
        if (onCancel) onCancel();
        else if (edit.value !== before) onPreview?.(before);
      }
      return;
    }
    onCommit(settled);
  };

  const commitDraft = () => {
    const edit = editRef.current;
    if (edit) commit(edit.value);
  };

  const commitText = () => {
    if (composingRef.current) return;
    const raw = textRef.current;
    if (raw === null) {
      commitDraft();
      return;
    }
    const parsed = parseCharacterNumber(raw);
    if (parsed === null) {
      cancel();
      setError("숫자 형식을 확인해 주세요. 예: 1.05 또는 1,05");
      return;
    }
    commit(parsed);
  };

  const currentEditValue = (): number | null => {
    const raw = textRef.current;
    if (raw === null) return editRef.current?.value ?? safeValue;
    const parsed = parseCharacterNumber(raw);
    if (parsed === null) setError("숫자 형식을 확인해 주세요. 예: 1.05 또는 1,05");
    return parsed;
  };

  const onRangeKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing || composingRef.current) return;
    const current = currentEditValue();
    if (current === null) return;
    if (CHARACTER_RANGE_EDIT_KEYS.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home") preview(spec.min);
      else if (event.key === "End") preview(spec.max);
      else {
        const direction = ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 1;
        preview(nudgeCharacterValue(current, direction, spec,
          event.key.startsWith("Page") ? { shiftKey: true } : event));
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Escape" && (editRef.current !== null || textRef.current !== null)) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!event.nativeEvent.isComposing && !composingRef.current && CHARACTER_RANGE_EDIT_KEYS.has(event.key)) commitDraft();
  };

  return (
    <div data-character-range={label} className="rounded-xl border border-line/80 bg-card/70 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <label htmlFor={rangeId} className="block text-[0.72rem] font-bold text-fg-2">{label}</label>
          {hint ? <p id={hintId} className="mt-0.5 line-clamp-2 text-[0.62rem] leading-relaxed text-fg-3">{hint}</p> : null}
        </div>
        <output htmlFor={rangeId} aria-live="off" className="shrink-0 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[0.66rem] font-bold tabular-nums text-fg-2">
          {readout}
        </output>
      </div>
      <div className="relative mt-1.5">
        <input
          id={rangeId} type="range" min={spec.min} max={spec.max} step="any" value={shown} disabled={disabled}
          aria-describedby={description} aria-valuetext={readout}
          className="h-11 w-full min-w-0 cursor-pointer touch-pan-y accent-accent disabled:cursor-not-allowed disabled:opacity-45"
          onChange={(event) => preview(snapCharacterValue(Number(event.currentTarget.value), spec))}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0 || pointerRef.current !== null) return;
            pointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (pointerRef.current !== null && pointerRef.current !== event.pointerId) return;
            pointerRef.current = null;
            commitDraft();
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { pointerRef.current = null; cancel(); }}
          onLostPointerCapture={() => { pointerRef.current = null; commitDraft(); }}
          onKeyDown={onRangeKeyDown} onKeyUp={onKeyUp} onBlur={commitDraft}
        />
        <span aria-hidden title={`기본값 ${defaultReadout}`} className="pointer-events-none absolute bottom-1 h-1.5 w-px -translate-x-1/2 rounded-full bg-fg-3/70" style={{ left: `${markerPercent}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <label htmlFor={numberId} className="shrink-0 text-[0.62rem] font-semibold text-fg-3">값</label>
        <input
          id={numberId} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
          value={text ?? formatCharacterNumber(shown, spec.step)} disabled={disabled}
          aria-label={`${label} 값 입력`} aria-invalid={error ? true : undefined} aria-describedby={description}
          className={cn("min-h-11 w-20 min-w-0 rounded-lg border border-line bg-panel px-2 text-right text-[0.7rem] font-semibold tabular-nums text-fg", STUDIO_FOCUS_RING, "disabled:cursor-not-allowed disabled:opacity-45")}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onChange={(event) => {
            if (disabled) return;
            textRef.current = event.currentTarget.value;
            setText(event.currentTarget.value);
            setError(null);
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composingRef.current) return;
            if (event.key === "Enter") { event.preventDefault(); commitText(); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
            else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) onRangeKeyDown(event);
          }}
          onKeyUp={onKeyUp}
        />
        {([-1, 1] as const).map((direction) => (
          <button
            key={direction} type="button" disabled={disabled || (direction < 0 ? shown <= spec.min : shown >= spec.max)}
            aria-label={`${label} ${direction < 0 ? "줄이기" : "늘리기"}`} title="Shift: 10배 · Alt: 0.1배 미세 조절"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              const current = currentEditValue();
              if (current !== null) commit(nudgeCharacterValue(current, direction, spec, event));
            }}
            className={ACTION_BUTTON}
          >{direction < 0 ? <Minus size={13} aria-hidden /> : <Plus size={13} aria-hidden />}</button>
        ))}
        {changed ? (
          <button type="button" disabled={disabled} aria-label={`${label} 기본값 ${defaultReadout}(으)로 되돌리기`} title={`기본값 ${defaultReadout}(으)로 되돌리기`}
            onPointerDown={(event) => event.preventDefault()} onClick={() => commit(normalizedDefault)} className={ACTION_BUTTON}>
            <RotateCcw size={14} aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[0.6rem] text-fg-3">기본 {defaultReadout} · Shift 10배 · Alt 미세 조절</p>
      {error ? <p id={errorId} role="status" className="mt-1 text-[0.64rem] text-warn">{error}</p> : null}
    </div>
  );
}

export interface CharacterColorSwatch { readonly color: string; readonly label: string }
export interface CharacterColorControlProps {
  readonly label: string;
  readonly value: string | null;
  readonly onCommit: (color: string | null) => void;
  readonly onPreview?: (color: string | null) => void;
  readonly onCancel?: () => void;
  readonly swatches?: readonly CharacterColorSwatch[];
  readonly allowClear?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
}

export function CharacterColorControl({
  label, value, onCommit, onPreview, onCancel, swatches = [], allowClear = false, disabled = false, hint,
}: CharacterColorControlProps) {
  const generatedId = useId();
  const pickerId = `${generatedId}-color`;
  const hexId = `${generatedId}-hex`;
  const errorId = `${generatedId}-error`;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const beforeRef = useRef<{ readonly value: string | null } | null>(null);
  const composingRef = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const rollbackRef = useRef<() => void>(() => {});
  const current = value === null ? null : normalizeCharacterHex(value);
  const previewColor = draft === null ? current : normalizeCharacterHex(draft);
  const editing = draft !== null;

  const clearDraft = () => {
    draftRef.current = null;
    beforeRef.current = null;
    setDraft(null);
  };
  const rollback = () => {
    const before = beforeRef.current;
    beforeRef.current = null;
    if (!before) return;
    if (onCancel) onCancel();
    else onPreview?.(before.value);
  };
  const cancel = () => { rollback(); clearDraft(); setError(null); };

  useEffect(() => { cancelRef.current = cancel; rollbackRef.current = rollback; });
  useEffect(() => () => rollbackRef.current(), []);
  useEffect(() => {
    if (disabled) cancelRef.current();
  }, [disabled]);
  useEffect(() => {
    if (!editing) return;
    return pushCharacterShaperKeyLayer((event) => {
      if (event.key !== "Escape" || event.isComposing) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelRef.current();
      return true;
    }, window);
  }, [editing]);

  const preview = (raw: string) => {
    if (disabled) return;
    beforeRef.current ??= { value: current };
    draftRef.current = raw;
    setDraft(raw);
    setError(null);
    const color = normalizeCharacterHex(raw);
    if (color) onPreview?.(color);
  };
  const commit = (next: string | null) => {
    if (disabled) { cancel(); return; }
    // A null original colour is meaningful; do not replace it with a live preview value.
    const original = beforeRef.current ? beforeRef.current.value : current;
    const hadPreview = beforeRef.current !== null;
    clearDraft();
    setError(null);
    if (next === original) {
      if (hadPreview) {
        if (onCancel) onCancel();
        else onPreview?.(original);
      }
      return;
    }
    onCommit(next);
  };
  const commitDraft = () => {
    if (composingRef.current) return;
    const raw = draftRef.current;
    if (raw === null) return;
    if (!raw.trim() && allowClear) { commit(null); return; }
    const color = normalizeCharacterHex(raw);
    if (color === null) {
      cancel();
      setError("HEX 색상을 확인해 주세요. 예: #A16207 또는 #ABC");
      return;
    }
    commit(color);
  };
  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || composingRef.current) return;
    if (event.key === "Enter") { event.preventDefault(); commitDraft(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
  };

  return (
    <div data-character-color={label} className="rounded-xl border border-line/80 bg-card/70 p-2.5"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        commitDraft();
      }}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={pickerId} className="text-[0.72rem] font-bold text-fg-2">{label}</label>
        <span className="text-[0.62rem] text-fg-3">{previewColor ? previewColor.toUpperCase() : "모델 원본 색"}</span>
      </div>
      {hint ? <p className="mt-0.5 text-[0.62rem] leading-relaxed text-fg-3">{hint}</p> : null}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input id={pickerId} type="color" value={previewColor ?? current ?? "#8a6257"} disabled={disabled}
          aria-label={`${label} 색 선택`} className={cn("size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-panel p-1 disabled:cursor-not-allowed disabled:opacity-45", STUDIO_FOCUS_RING)}
          onChange={(event) => preview(event.currentTarget.value)} onKeyDown={onInputKeyDown} />
        <input id={hexId} type="text" value={draft ?? (current?.toUpperCase() ?? "")} disabled={disabled}
          maxLength={7} placeholder="#RRGGBB" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          aria-label={`${label} HEX 값`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          className={cn("min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-[0.7rem] font-semibold uppercase tabular-nums text-fg", STUDIO_FOCUS_RING, "disabled:cursor-not-allowed disabled:opacity-45")}
          onChange={(event) => preview(event.currentTarget.value)} onKeyDown={onInputKeyDown}
          onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} />
        {allowClear ? (
          <button type="button" disabled={disabled || current === null} aria-label={`${label} 모델 원본 색으로 되돌리기`} title="모델 원본 색으로 되돌리기"
            onClick={() => commit(null)} className={ACTION_BUTTON}><RotateCcw size={14} aria-hidden /></button>
        ) : null}
      </div>
      {draft !== null ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 flex-1 text-[0.62rem] text-fg-3">색을 확인한 뒤 적용하세요.</span>
          <button type="button" disabled={disabled} aria-label={`${label} 색 적용`} onClick={commitDraft} className={ACTION_BUTTON}><Check size={14} aria-hidden /></button>
          <button type="button" aria-label={`${label} 색 변경 취소`} onClick={cancel} className={ACTION_BUTTON}><X size={14} aria-hidden /></button>
        </div>
      ) : null}
      {error ? <p id={errorId} role="status" className="mt-1 text-[0.64rem] text-warn">{error}</p> : null}
      {swatches.length > 0 ? (
        <div role="group" aria-label={`${label} 추천 색`} className="mt-1.5 flex flex-wrap gap-1">
          {swatches.map((swatch) => {
            const hex = normalizeCharacterHex(swatch.color);
            const active = current !== null && current === hex;
            return (
              <button key={`${swatch.color}-${swatch.label}`} type="button" disabled={disabled || hex === null}
                aria-pressed={active} aria-label={`${label} ${swatch.label}`} title={`${swatch.label} ${swatch.color.toUpperCase()}`}
                onClick={() => { if (hex !== null) commit(hex); }}
                className={cn("grid size-11 place-items-center rounded-lg border", STUDIO_FOCUS_RING, "disabled:cursor-not-allowed disabled:opacity-45", active ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line hover:border-line-strong")}>
                <span aria-hidden className="grid size-7 place-items-center rounded-md border border-line/60" style={{ backgroundColor: hex ?? undefined }}>
                  {active ? <Check size={13} className="text-on-accent drop-shadow" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface CharacterChipOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly swatch?: string;
  readonly disabled?: boolean;
}
export interface CharacterChipGroupProps {
  readonly label: string;
  readonly options: readonly CharacterChipOption[];
  readonly value: string | null;
  readonly onSelect: (id: string) => void;
  readonly disabled?: boolean;
  readonly columns?: number;
}
export function CharacterChipGroup({ label, options, value, onSelect, disabled = false, columns }: CharacterChipGroupProps) {
  return (
    <div role="group" aria-label={label} data-character-chip-group={label}
      className={cn("gap-1", columns ? "grid" : "flex flex-wrap")}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button key={option.id} type="button" aria-pressed={active} disabled={disabled || option.disabled}
            title={option.hint ? `${option.label} · ${option.hint}` : option.label} onClick={() => onSelect(option.id)}
            className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[0.7rem] font-semibold", "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none", STUDIO_FOCUS_RING, active ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}>
            {option.swatch ? <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-line/70" style={{ backgroundColor: option.swatch }} /> : null}
            <span className="truncate">{option.label}</span>
            {active ? <Check size={12} aria-hidden className="shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}
