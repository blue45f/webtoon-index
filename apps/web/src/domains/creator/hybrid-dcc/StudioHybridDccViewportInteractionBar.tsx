import { useId, useState } from "react";

import {
  STUDIO_HYBRID_DCC_SNAP_LIMITS,
  type StudioHybridDccViewportPreferences,
} from "./studio-hybrid-dcc-viewport-interaction";

interface Props {
  readonly preferences: StudioHybridDccViewportPreferences;
  readonly onChange: (patch: Partial<StudioHybridDccViewportPreferences>) => void;
  readonly isolatedAssetId: string | null;
  readonly hasSelection: boolean;
  readonly dragging: boolean;
  readonly onToggleIsolation: () => void;
  readonly notice: string;
}
const CONTROL = "min-h-11 min-w-0 rounded-lg border border-line bg-card px-2.5 text-xs text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9";

export function StudioHybridDccViewportInteractionBar({
  preferences, onChange, isolatedAssetId, hasSelection, dragging, onToggleIsolation, notice,
}: Props) {
  const id = useId();
  const [inputError, setInputError] = useState("");
  return (
    <section aria-label="뷰포트 스냅과 표시 설정" className="mt-2 space-y-2 rounded-xl border border-line bg-panel p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={CONTROL} aria-pressed={preferences.snapping} disabled={dragging}
          onClick={() => onChange({ snapping: !preferences.snapping })}>
          스냅 {preferences.snapping ? "켜짐" : "꺼짐"} · Shift+Tab
        </button>
        <button type="button" className={CONTROL} aria-pressed={Boolean(isolatedAssetId)}
          disabled={dragging || (!hasSelection && !isolatedAssetId)} onClick={onToggleIsolation}>
          {isolatedAssetId ? "격리 해제 · 전체 복원" : "선택 오브젝트 격리"}
        </button>
        {([
          ["showGrid", "그리드"], ["showAxes", "좌표축"], ["showGround", "바닥 그림자"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" className={CONTROL} aria-pressed={preferences[key]}
            onClick={() => onChange({ [key]: !preferences[key] })}>{label}</button>
        ))}
        <span className="text-[11px] text-fg-3">/ 격리 · F 선택 맞춤 · Esc 드래그 취소</span>
      </div>
      <fieldset disabled={!preferences.snapping || dragging} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <legend className="sr-only">드래그 스냅 간격</legend>
        {([
          ["translationStep", "이동 스냅 간격 (m)", 0.01],
          ["rotationStepDegrees", "회전 스냅 각도 (°)", 1],
          ["scaleStep", "크기 스냅 간격 (배율)", 0.01],
        ] as const).map(([key, label, step]) => (
          <div key={key} className="grid gap-1">
            <label htmlFor={`${id}-${key}`} className="text-[11px] text-fg-3">{label}</label>
            <input key={`${key}:${preferences[key]}`} id={`${id}-${key}`} type="number" className={CONTROL}
              min={STUDIO_HYBRID_DCC_SNAP_LIMITS[key].min} max={STUDIO_HYBRID_DCC_SNAP_LIMITS[key].max}
              step={step} defaultValue={preferences[key]}
              onBlur={(event) => {
                const input = event.currentTarget;
                const value = input.valueAsNumber;
                const { min, max } = STUDIO_HYBRID_DCC_SNAP_LIMITS[key];
                if (!Number.isFinite(value) || value < min || value > max) {
                  input.value = String(preferences[key]);
                  setInputError(`${label}: ${min}~${max} 범위의 유한한 값을 입력하세요.`);
                  return;
                }
                setInputError("");
                onChange({ [key]: value });
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  event.currentTarget.value = String(preferences[key]);
                  event.currentTarget.blur();
                }
              }} />
          </div>
        ))}
      </fieldset>
      {isolatedAssetId ? <p role="status" className="truncate text-xs text-accent">{isolatedAssetId}만 표시 중 · 문서의 숨김 상태는 변경하지 않습니다.</p> : null}
      {inputError ? <p role="alert" className="text-xs text-fg-2">{inputError}</p> : null}
      {notice ? <p role="status" className="text-xs text-fg-2">{notice}</p> : null}
    </section>
  );
}
