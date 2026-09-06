import { useId } from "react";

import type { Studio2dEnvironment, Studio2dTimeOfDay } from "./studio-2d-asset-quality";

export interface Studio2dContentFiltersProps {
  readonly environment: Studio2dEnvironment;
  readonly timeOfDay: Studio2dTimeOfDay;
  readonly textFreeOnly: boolean;
  readonly onEnvironmentChange: (value: Studio2dEnvironment) => void;
  readonly onTimeOfDayChange: (value: Studio2dTimeOfDay) => void;
  readonly onTextFreeOnlyChange: (value: boolean) => void;
}

/** Optional detail controls stay compact on narrow studio panels. */
export function Studio2dContentFilters({ environment, timeOfDay, textFreeOnly,
  onEnvironmentChange, onTimeOfDayChange, onTextFreeOnlyChange }: Studio2dContentFiltersProps) {
  const id = useId();
  const active = Number(environment !== "all") + Number(timeOfDay !== "all") + Number(textFreeOnly);
  const field = "min-w-0 rounded-lg border border-line bg-card px-2 py-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  return <details className="rounded-xl border border-line bg-card p-2.5" data-studio-2d-content-filters="true">
    <summary className="cursor-pointer rounded text-xs font-medium text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      장소·시간·문자 필터{active > 0 ? ` · ${active}개 적용` : ""}
    </summary>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3">
        <label htmlFor={`${id}-environment`}>장소</label>
        <select id={`${id}-environment`} className={field} value={environment}
          onChange={(event) => onEnvironmentChange(event.target.value as Studio2dEnvironment)}>
          <option value="all">모든 장소</option><option value="실내">실내</option><option value="실외">실외</option>
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-[0.66rem] text-fg-3">
        <label htmlFor={`${id}-time`}>시간대</label>
        <select id={`${id}-time`} className={field} value={timeOfDay}
          onChange={(event) => onTimeOfDayChange(event.target.value as Studio2dTimeOfDay)}>
          <option value="all">모든 시간대</option><option value="낮">낮</option><option value="노을">노을</option><option value="밤">밤</option>
        </select>
      </div>
      <label htmlFor={`${id}-text-free`} className="col-span-2 flex min-h-9 items-center gap-2 text-xs text-fg-2">
        <input id={`${id}-text-free`} type="checkbox" checked={textFreeOnly}
          onChange={(event) => onTextFreeOnlyChange(event.target.checked)} />문자 형태 없는 이미지 배경만
      </label>
    </div>
    <p className="mt-2 text-[0.65rem] leading-relaxed text-fg-3">원본 검수 기록이 있는 이미지에 적용합니다. 정보가 없는 소재·벡터는 조건을 확인할 수 없어 제외됩니다.</p>
    {active > 0 && <button type="button" className="mt-2 min-h-8 rounded px-2 text-xs text-fg-3 underline"
      onClick={() => { onEnvironmentChange("all"); onTimeOfDayChange("all"); onTextFreeOnlyChange(false); }}>장소·시간·문자 조건만 지우기</button>}
  </details>;
}
