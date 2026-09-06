import { SlidersHorizontal, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { FilterPreviewData } from "../models/market-preview";

interface MarketFilterPreviewProps {
  readonly filter: FilterPreviewData;
  className?: string;
}

export function MarketFilterPreview({ filter, className }: MarketFilterPreviewProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [activeSample, setActiveSample] = useState<"scene" | "character">("scene");

  const filterStyle = useMemo(() => {
    const values = filter.values;
    const filters: string[] = [];

    if (typeof values.brightness === "number") {
      filters.push(`brightness(${values.brightness})`);
    }
    if (typeof values.contrast === "number") {
      filters.push(`contrast(${values.contrast})`);
    }
    if (typeof values.saturate === "number") {
      filters.push(`saturate(${values.saturate})`);
    } else if (typeof values.saturation === "number") {
      filters.push(`saturate(${1 + values.saturation / 100})`);
    }
    if (typeof values.hue === "number") {
      filters.push(`hue-rotate(${values.hue}deg)`);
    } else if (typeof values.hueRotate === "number") {
      filters.push(`hue-rotate(${values.hueRotate}deg)`);
    }
    if (typeof values.blur === "number" && values.blur > 0) {
      filters.push(`blur(${Math.min(8, values.blur)}px)`);
    }
    if (typeof values.sepia === "number") {
      filters.push(`sepia(${values.sepia})`);
    }
    if (typeof values.grayscale === "number") {
      filters.push(`grayscale(${values.grayscale})`);
    }
    if (typeof values.invert === "number") {
      filters.push(`invert(${values.invert})`);
    }

    return filters.length > 0 ? filters.join(" ") : "contrast(1.15) saturate(1.2)";
  }, [filter.values]);

  return (
    <div
      role="region"
      aria-labelledby="market-filter-heading"
      aria-describedby="market-filter-preview-note"
      className={`overflow-hidden rounded-xl border border-line bg-card ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 bg-panel/50">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-accent" aria-hidden="true" />
          <h2 id="market-filter-heading" className="text-xs font-semibold text-fg">필터 효과 참고 일러스트 ({filter.name})</h2>
          <span className="inline-flex min-h-6 items-center rounded bg-raised px-1.5 text-[0.65rem] text-fg-3">
            엔진: {filter.engine}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveSample("scene")}
            aria-pressed={activeSample === "scene"}
            className={`inline-flex min-h-8 items-center rounded px-2.5 text-[0.65rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11 pointer-coarse:px-3 ${
              activeSample === "scene" ? "bg-accent text-on-accent" : "bg-card text-fg-2 hover:bg-raised"
            }`}
          >
            배경 씬
          </button>
          <button
            type="button"
            onClick={() => setActiveSample("character")}
            aria-pressed={activeSample === "character"}
            className={`inline-flex min-h-8 items-center rounded px-2.5 text-[0.65rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 pointer-coarse:min-h-11 pointer-coarse:px-3 ${
              activeSample === "character" ? "bg-accent text-on-accent" : "bg-card text-fg-2 hover:bg-raised"
            }`}
          >
            캐릭터 컷
          </button>
        </div>
      </div>

      {/* Interactive Split Comparison View */}
      <div
        role="group"
        aria-label="필터 적용 예시와 원본 일러스트 비교"
        className="relative aspect-[16/8] w-full select-none overflow-hidden bg-canvas"
      >
        {/* Sample SVG Art */}
        <div className="absolute inset-0">
          <svg className="size-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="60%" stopColor="#bae6fd" />
                <stop offset="100%" stopColor="#fef08a" />
              </linearGradient>
              <linearGradient id="charSky" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f43f5e" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            {activeSample === "scene" ? (
              <>
                <rect width="800" height="400" fill="url(#skyGrad)" />
                <circle cx="680" cy="90" r="45" fill="#fbbf24" opacity="0.9" />
                {/* City skyline silhouettes */}
                <path d="M0 400 L0 280 L40 280 L40 230 L90 230 L90 290 L140 290 L140 180 L200 180 L200 300 L260 300 L260 210 L310 210 L310 320 L370 320 L370 190 L430 190 L430 310 L500 310 L500 240 L570 240 L570 330 L640 330 L640 170 L710 170 L710 280 L800 280 L800 400 Z" fill="#1e293b" opacity="0.85" />
                {/* Foreground street & light poles */}
                <rect x="0" y="340" width="800" height="60" fill="#0f172a" />
                <line x1="120" y1="340" x2="120" y2="220" stroke="#94a3b8" strokeWidth="4" />
                <circle cx="120" cy="220" r="8" fill="#fef08a" />
                <line x1="480" y1="340" x2="480" y2="220" stroke="#94a3b8" strokeWidth="4" />
                <circle cx="480" cy="220" r="8" fill="#fef08a" />
              </>
            ) : (
              <>
                <rect width="800" height="400" fill="url(#charSky)" opacity="0.4" />
                <circle cx="400" cy="180" r="100" fill="#fbcfe8" />
                {/* Character silhouette */}
                <circle cx="400" cy="150" r="55" fill="#1e1b4b" />
                <path d="M345 150 Q400 90 455 150 Q400 180 345 150 Z" fill="#4338ca" />
                <path d="M330 230 Q400 210 470 230 L490 400 L310 400 Z" fill="#1e1b4b" />
                <rect x="360" y="240" width="80" height="120" fill="#f43f5e" opacity="0.8" rx="8" />
              </>
            )}
          </svg>
        </div>

        {/* Filtered Layer (Clipped by slider position) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
          }}
        >
          <div
            className="size-full"
            style={{ filter: filterStyle }}
          >
            <svg className="size-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
              {activeSample === "scene" ? (
                <>
                  <rect width="800" height="400" fill="url(#skyGrad)" />
                  <circle cx="680" cy="90" r="45" fill="#fbbf24" opacity="0.9" />
                  <path d="M0 400 L0 280 L40 280 L40 230 L90 230 L90 290 L140 290 L140 180 L200 180 L200 300 L260 300 L260 210 L310 210 L310 320 L370 320 L370 190 L430 190 L430 310 L500 310 L500 240 L570 240 L570 330 L640 330 L640 170 L710 170 L710 280 L800 280 L800 400 Z" fill="#1e293b" opacity="0.85" />
                  <rect x="0" y="340" width="800" height="60" fill="#0f172a" />
                  <line x1="120" y1="340" x2="120" y2="220" stroke="#94a3b8" strokeWidth="4" />
                  <circle cx="120" cy="220" r="8" fill="#fef08a" />
                  <line x1="480" y1="340" x2="480" y2="220" stroke="#94a3b8" strokeWidth="4" />
                  <circle cx="480" cy="220" r="8" fill="#fef08a" />
                </>
              ) : (
                <>
                  <rect width="800" height="400" fill="url(#charSky)" opacity="0.4" />
                  <circle cx="400" cy="180" r="100" fill="#fbcfe8" />
                  <circle cx="400" cy="150" r="55" fill="#1e1b4b" />
                  <path d="M345 150 Q400 90 455 150 Q400 180 345 150 Z" fill="#4338ca" />
                  <path d="M330 230 Q400 210 470 230 L490 400 L310 400 Z" fill="#1e1b4b" />
                  <rect x="360" y="240" width="80" height="120" fill="#f43f5e" opacity="0.8" rx="8" />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* Divider Line & Handle */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent shadow-sm"
          style={{ left: `${sliderPosition}%` }}
        >
          <div className="absolute top-1/2 flex min-h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-canvas px-1.5 text-[0.6rem] font-bold text-fg shadow-sm">
            ↔
          </div>
        </div>

        {/* Labels */}
        <span className="absolute left-3 top-3 inline-flex min-h-6 items-center rounded bg-canvas px-2 text-[0.65rem] font-semibold text-fg shadow-sm">
          효과 예시
        </span>
        <span className="absolute right-3 top-3 inline-flex min-h-6 items-center rounded bg-canvas px-2 text-[0.65rem] font-semibold text-fg shadow-sm">
          원본 일러스트
        </span>

        {/* Interactive Slider Input Overlay */}
        <input
          type="range"
          min={0}
          max={100}
          value={sliderPosition}
          onChange={(e) => setSliderPosition(Number(e.target.value))}
          aria-label="필터 전후 비교 슬라이더"
          aria-valuetext={`왼쪽 효과 예시 ${sliderPosition}%, 오른쪽 원본 ${100 - sliderPosition}%`}
          className="absolute inset-x-4 bottom-3 z-20 h-8 w-[calc(100%-2rem)] cursor-ew-resize rounded-full bg-canvas/90 px-2 accent-accent shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas pointer-coarse:h-11"
        />
      </div>

      {/* Filter Parameters Inspection Chips */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 bg-panel/30">
        <SlidersHorizontal className="h-3.5 w-3.5 text-fg-3" aria-hidden="true" />
        <span className="text-[0.68rem] text-fg-3">파라미터:</span>
        {Object.entries(filter.values).map(([key, value]) => (
          <span key={key} className="rounded bg-raised px-2 py-0.5 text-[0.65rem] text-fg-2">
            <span className="text-fg-3">{key}:</span> <strong className="font-semibold text-fg">{String(value)}</strong>
          </span>
        ))}
      </div>
      <p id="market-filter-preview-note" className="border-t border-line bg-panel/30 px-4 py-2 text-[0.68rem] leading-relaxed text-fg-3">
        실제 Studio 렌더가 아닌, 브라우저에서 지원되는 일부 파라미터를 단순 적용한 참고 일러스트입니다.
      </p>
    </div>
  );
}
