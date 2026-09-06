import { useEffect, useEffectEvent, useRef, useState } from "react";

import { clampPanoramaRotationDegrees } from "../studio-background-3d-sky";
import { StudioThreeDToggleControl } from "../StudioThreeDToggle";

import { resolveStudioBg3dAnimationDisplayTime } from "./studio-bg3d-animation-time";

import type { StudioBg3dAnimationPlayback } from "./studio-bg3d-scene-document";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

interface LtRangeControlProps {
  readonly id: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly onChangeEnd?: () => void;
  readonly step: number;
  readonly value: number;
  readonly valueText: string;
  readonly disabled?: boolean;
}

export function LtRangeControl({
  id,
  label,
  max,
  min,
  onChange,
  onChangeEnd,
  step,
  value,
  valueText,
  disabled = false,
}: LtRangeControlProps) {
  return (
    <label
      htmlFor={id}
      className={cx(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line/70 py-1.5 last:border-b-0",
        disabled && "opacity-45"
      )}
    >
      <span className="text-xs font-semibold text-fg-2">{label}</span>
      <output htmlFor={id} className="min-w-12 text-right text-[0.6875rem] tabular-nums text-fg-3">
        {valueText}
      </output>
      <input
        id={id}
        type="range"
        aria-valuetext={valueText}
        className="col-span-2 h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed sm:h-8"
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onChangeEnd}
        onKeyUp={onChangeEnd}
        onPointerCancel={onChangeEnd}
        onPointerUp={onChangeEnd}
      />
    </label>
  );
}

interface PanoramaRotationNumberFieldProps {
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
  readonly value: number;
}

/** Keeps incomplete mobile/keyboard drafts local and commits one clamped degree value on blur. */
export function PanoramaRotationNumberField({
  disabled = false,
  onCommit,
  value,
}: PanoramaRotationNumberFieldProps) {
  const cancelCommitRef = useRef(false);
  const [editState, setEditState] = useState<{
    readonly draft: string;
    readonly sourceValue: number;
  } | null>(null);
  const draft = editState?.sourceValue === value ? editState.draft : String(value);

  const commitDraft = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setEditState(null);
      return;
    }
    const parsed = Number(draft.trim());
    setEditState(null);
    if (!draft.trim() || !Number.isFinite(parsed)) return;
    const committed = Math.round(clampPanoramaRotationDegrees(parsed));
    if (committed !== value) onCommit(committed);
  };

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 sm:min-h-9">
      <span className="shrink-0">각도</span>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label="360도 환경 배경 수평 회전 각도"
        aria-valuemax={180}
        aria-valuemin={-180}
        aria-valuenow={
          draft.trim().length > 0 && Number.isFinite(Number(draft)) ? Number(draft) : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={draft}
        onBlur={commitDraft}
        onChange={(event) => {
          setEditState({ draft: event.target.value, sourceValue: value });
        }}
        onFocus={() => {
          cancelCommitRef.current = false;
          setEditState({ draft: String(value), sourceValue: value });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelCommitRef.current = true;
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
      />
      <span className="text-fg-3">°</span>
    </label>
  );
}

interface LtToggleRowProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}

export function LtToggleRow({ checked, label, onChange, disabled = false }: LtToggleRowProps) {
  return (
    <StudioThreeDToggleControl
      checked={checked}
      label={label}
      disabled={disabled}
      className="border-b border-line/70 py-2 last:border-b-0 hover:text-fg"
      labelClassName="text-xs font-semibold text-fg-2 group-hover:text-fg"
      onChange={onChange}
    />
  );
}

interface Vec3FieldProps {
  readonly label: string;
  readonly values: [number, number, number];
  readonly step: number;
  readonly precision: number;
  readonly suffix?: string;
  readonly disabled?: boolean;
  readonly touchFriendly?: boolean;
  readonly onCommit: (index: 0 | 1 | 2, value: number) => void;
}

export function Vec3Field({
  label,
  values,
  step,
  precision,
  suffix,
  disabled = false,
  touchFriendly = false,
  onCommit,
}: Vec3FieldProps) {
  const axisLabels = ["X", "Y", "Z"] as const;
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1 text-[0.6875rem] font-semibold text-fg-3">{label}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {axisLabels.map((axisLabel, i) => (
          <label
            key={axisLabel}
            className={cx(
              "flex items-center gap-1 rounded-lg border border-line bg-card px-1.5 py-1 text-[0.7rem]",
              touchFriendly && "min-h-11 sm:min-h-8 pointer-coarse:min-h-11",
            )}
          >
            <span className="text-fg-3">{axisLabel}</span>
            <input
              aria-label={`${label} ${axisLabel}`}
              type="number"
              disabled={disabled}
              step={step}
              value={round(values[i as 0 | 1 | 2], precision)}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                if (Number.isFinite(nextValue)) onCommit(i as 0 | 1 | 2, nextValue);
              }}
              className="w-full min-w-0 bg-transparent text-right text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            />
            {suffix ? <span className="text-fg-3">{suffix}</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

interface BgAnimationPlayheadProps {
  readonly active: boolean;
  readonly modelId: string;
  readonly playback: StudioBg3dAnimationPlayback;
  readonly durationSeconds: number;
  readonly readLiveTime: () => number | undefined;
  readonly onCommit: (timeSeconds: number) => void;
}

export function BgAnimationPlayhead({
  active,
  modelId,
  playback,
  durationSeconds,
  readLiveTime,
  onCommit,
}: BgAnimationPlayheadProps) {
  const [liveSample, setLiveSample] = useState<{
    readonly modelId: string;
    readonly clipIndex: number;
    readonly baseTimeSeconds: number;
    readonly timeSeconds: number;
  } | null>(null);
  const readCurrentLiveTime = useEffectEvent(readLiveTime);
  const displayTime = resolveStudioBg3dAnimationDisplayTime({
    modelId,
    playback,
    durationSeconds,
    liveSample,
  });

  useEffect(() => {
    if (!active || !playback.playing) return;
    const interval = globalThis.setInterval(() => {
      const timeSeconds = readCurrentLiveTime();
      if (!Number.isFinite(timeSeconds)) return;
      setLiveSample((current) => {
        const next = {
          modelId,
          clipIndex: playback.clipIndex,
          baseTimeSeconds: playback.timeSeconds,
          timeSeconds: Math.max(0, timeSeconds!),
        };
        return current?.modelId === next.modelId &&
          current.clipIndex === next.clipIndex &&
          current.baseTimeSeconds === next.baseTimeSeconds &&
          Math.abs(current.timeSeconds - next.timeSeconds) < 0.000_1
          ? current
          : next;
      });
    }, 100);
    return () => globalThis.clearInterval(interval);
  }, [
    active,
    modelId,
    playback.clipIndex,
    playback.playing,
    playback.timeSeconds,
  ]);

  return (
    <div className="min-w-0">
      <input
        aria-label="애니메이션 시간"
        className="h-11 w-full sm:h-8 pointer-coarse:h-11"
        type="range"
        min="0"
        max={durationSeconds}
        step={Math.max(0.001, durationSeconds / 1_000)}
        value={displayTime}
        onChange={(event) => onCommit(Number(event.target.value))}
      />
      <output
        aria-label="현재 애니메이션 시간"
        className="block text-right text-[0.6875rem] tabular-nums text-fg-3"
      >
        {displayTime.toFixed(2)}s / {durationSeconds.toFixed(2)}s
      </output>
    </div>
  );
}
