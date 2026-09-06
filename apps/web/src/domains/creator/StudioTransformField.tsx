import { useId, useState } from "react";

import {
  formatStudioTransformFieldValue,
  resolveStudioTransformFieldDraft,
  stepStudioTransformFieldValue,
  type StudioTransformPercentMode,
} from "./studio-transform-field-math";

import { cn } from "@/shared/lib/utils";

export const STUDIO_TRANSFORM_FIELD_SYNTAX_HINT = "숫자 · +=10 · *=2 · 150% · Shift/Alt + ↑↓";

export interface StudioTransformFieldProps {
  readonly label: string;
  readonly controlId: string;
  readonly priority: "essential" | "advanced";
  readonly value: number;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly mixed?: boolean;
  readonly step?: number;
  readonly coarseStep?: number;
  readonly fineStep?: number;
  readonly min?: number;
  readonly max?: number;
  readonly suffix?: string;
  readonly percentMode?: StudioTransformPercentMode;
  readonly onCommit: (next: number) => void;
}

/** Local-draft numeric editor: many keystrokes and arrow repeats still create one history commit. */
export function StudioTransformField({
  label,
  controlId,
  priority,
  value,
  disabled,
  disabledReason,
  mixed = false,
  step = 1,
  coarseStep,
  fineStep,
  min,
  max,
  suffix,
  percentMode = "relative",
  onCommit,
}: StudioTransformFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const settled = Number.isFinite(value) ? value : 0;
  const inertHint = disabled ? (disabledReason ?? undefined) : undefined;
  const inputHint = inertHint ?? STUDIO_TRANSFORM_FIELD_SYNTAX_HINT;

  function commitDraft(reason: "submit" | "blur") {
    if (draft === null) return;
    const next = resolveStudioTransformFieldDraft(draft, settled, { min, max, percentMode });
    if (next === null) {
      if (reason === "blur") {
        setDraft(null);
        setInvalid(false);
      } else {
        setInvalid(true);
      }
      return;
    }
    setDraft(null);
    setInvalid(false);
    if (!mixed && next === settled) return;
    onCommit(next);
  }

  return (
    <label className="grid min-w-0 gap-0.5" title={inertHint}>
      <span className="text-xs font-bold tracking-tight text-fg-3">{label}</span>
      <span
        className={cn(
          "flex w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-lg border bg-card px-1.5 py-1 focus-within:border-accent/50",
          invalid ? "border-danger/70" : "border-line",
        )}
      >
        <input
          type="text"
          role="spinbutton"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          title={inputHint}
          value={draft ?? (mixed ? "" : formatStudioTransformFieldValue(settled))}
          placeholder={mixed ? "혼합" : undefined}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={settled}
          data-inspector-control-id={controlId}
          data-inspector-priority={priority}
          className="w-0 min-w-0 flex-1 bg-transparent text-[0.8rem] font-semibold tabular-nums text-fg outline-none placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setInvalid(false);
          }}
          onBlur={() => commitDraft("blur")}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              const next = stepStudioTransformFieldValue({
                current: settled,
                draft,
                direction: event.key === "ArrowUp" ? 1 : -1,
                step,
                coarseStep,
                fineStep,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                min,
                max,
                percentMode,
              });
              setDraft(formatStudioTransformFieldValue(next));
              setInvalid(false);
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commitDraft("submit");
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
              setInvalid(false);
            }
          }}
        />
        {suffix ? (
          <span className="shrink-0 text-[0.6875rem] font-semibold text-fg-3">{suffix}</span>
        ) : null}
      </span>
      {invalid ? (
        <span id={errorId} role="alert" className="text-[0.625rem] font-medium leading-tight text-danger">
          숫자 또는 안전한 수식을 입력해 주세요.
        </span>
      ) : null}
    </label>
  );
}
