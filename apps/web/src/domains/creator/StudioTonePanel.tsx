/**
 * Studio Tone Panel
 * 만화 스크린톤 피커 — TONE_PRESETS를 카테고리(망점/선/그라데이션/교차선)별로 묶어
 * 흰 바탕에 검은 패턴이 보이는 56px 스와치 그리드로 깐다. 클릭하면 onPick으로 톤 SVG를 캔버스에 넘긴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음, props만 읽는다).
 * 검색어 필터는 상위에서 제어 — query로 라벨을 거르고, 결과 없는 카테고리는 헤더째 생략한다.
 */
import {
  TONE_PRESETS,
  toneCategoryLabel,
  toneDataUrl,
  type ToneCategory,
  type TonePreset,
} from "./studio-tones";

import { cn } from "@/shared/lib/utils";


// 카테고리 표시 순서 고정 — 옅은 망점부터 선·그라데이션·교차선 순으로 읽힌다.
const CATEGORY_ORDER: ToneCategory[] = ["dot", "line", "gradient", "crosshatch"];

// 그룹 헤더 — 인스펙터 다른 패널과 같은 소제목 토큰.
const GROUP_HEADING = "text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider";

// 스와치 — CSP 톤 팔레트처럼 패턴 면이 주인공, 카드 프레임은 warm-ink.
const SWATCH_CLASS =
  "size-14 shrink-0 overflow-hidden rounded-xl border border-line bg-card shadow-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function StudioTonePanel({
  onPick,
  query,
}: {
  onPick: (svg: string, label: string) => void;
  query?: string;
}): React.ReactElement {
  const needle = (query ?? "").trim().toLowerCase();

  return (
    <div className="space-y-3" data-studio-tone-panel="true">
      {CATEGORY_ORDER.map((category) => {
        const presets = TONE_PRESETS.filter(
          (preset) =>
            preset.category === category &&
            (needle === "" || preset.label.toLowerCase().includes(needle))
        );
        if (presets.length === 0) return null;

        return (
          <section key={category} className="space-y-1.5">
            <p className={GROUP_HEADING}>{toneCategoryLabel(category)}</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset: TonePreset) => (
                <div key={preset.id} className="flex w-14 shrink-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    title={preset.tip}
                    aria-label={preset.label}
                    data-studio-tone-swatch={preset.id}
                    onClick={() => onPick(preset.svg, preset.label)}
                    style={{
                      // Warm paper (not pure #fff) so DESIGN.md ink canvas stays consistent.
                      backgroundColor: "oklch(0.96 0.012 85)",
                      backgroundImage: `url("${toneDataUrl(preset.svg)}")`,
                      backgroundSize: "cover",
                    }}
                    className={cn(SWATCH_CLASS)}
                  />
                  <span className="text-center text-[10px] font-medium leading-tight text-fg-2">
                    {preset.label}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
