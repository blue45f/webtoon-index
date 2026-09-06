import { Minus, Plus, RotateCcw } from "lucide-react";

export interface StudioVrmForgeRangeControlProps {
  readonly label: string;
  readonly hint?: string;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function precisionFor(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : Math.min(4, text.length - dot - 1);
}

function normalize(value: number, minimum: number, maximum: number, step: number): number {
  const bounded = clamp(value, minimum, maximum);
  const snapped = minimum + Math.round((bounded - minimum) / step) * step;
  return Number(snapped.toFixed(precisionFor(step)));
}

function displayValue(value: number, step: number, unit?: string): string {
  const precision = precisionFor(step);
  if (unit === "×") return `${value.toFixed(Math.max(2, precision))}×`;
  if (unit === "%") return `${Math.round(value * 100)}%`;
  return `${value.toFixed(precision)}${unit ? ` ${unit}` : ""}`;
}

export function StudioVrmForgeRangeControl({
  label,
  hint,
  value,
  minimum,
  maximum,
  step,
  defaultValue,
  unit,
  disabled = false,
  onChange,
}: StudioVrmForgeRangeControlProps) {
  const normalizedDefault = normalize(defaultValue, minimum, maximum, step);
  const atDefault = Math.abs(value - normalizedDefault) < step / 2;
  const commit = (next: number) => {
    if (!Number.isFinite(next) || disabled) return;
    onChange(normalize(next, minimum, maximum, step));
  };

  return (
    <div
      className="rounded-xl border border-line/80 bg-card/75 p-2.5"
      data-forge-range-control={label}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.67rem] font-bold text-fg-2">{label}</p>
          {hint ? (
            <p className="mt-0.5 line-clamp-2 text-[0.58rem] leading-relaxed text-fg-3">
              {hint}
            </p>
          ) : null}
        </div>
        <output
          className="shrink-0 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[0.62rem] font-bold tabular-nums text-fg-2"
          aria-live="off"
        >
          {displayValue(value, step, unit)}
        </output>
      </div>

      <div className="mt-2 grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-1.5">
        <button
          type="button"
          aria-label={`${label} 한 단계 줄이기`}
          className="grid size-10 place-items-center rounded-lg border border-line bg-panel text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled || value <= minimum}
          onClick={() => commit(value - step)}
        >
          <Minus size={13} aria-hidden />
        </button>
        <input
          type="range"
          aria-label={label}
          aria-valuetext={displayValue(value, step, unit)}
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          disabled={disabled}
          className="h-10 min-w-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
          onChange={(event) => commit(event.currentTarget.valueAsNumber)}
        />
        <button
          type="button"
          aria-label={`${label} 한 단계 늘리기`}
          className="grid size-10 place-items-center rounded-lg border border-line bg-panel text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled || value >= maximum}
          onClick={() => commit(value + step)}
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>

      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <label className="flex min-w-0 items-center gap-1.5 text-[0.58rem] font-semibold text-fg-3">
          정확한 값
          <input
            type="number"
            aria-label={`${label} 정확한 값`}
            min={minimum}
            max={maximum}
            step={step}
            value={value}
            disabled={disabled}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 text-right text-[0.65rem] font-semibold tabular-nums text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
            onChange={(event) => {
              if (event.currentTarget.value === "") return;
              commit(event.currentTarget.valueAsNumber);
            }}
          />
        </label>
        <button
          type="button"
          aria-label={`${label} 기본값으로 복원`}
          title={`기본값 ${displayValue(normalizedDefault, step, unit)}로 복원`}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.58rem] font-bold text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
          disabled={disabled || atDefault}
          onClick={() => commit(normalizedDefault)}
        >
          <RotateCcw size={11} aria-hidden />
          초기화
        </button>
      </div>
    </div>
  );
}
