import { Box, Camera, Layers, Sun } from "lucide-react";
import { useState } from "react";

import type { RecipePreviewData } from "../models/market-preview";

interface MarketScene3dPreviewProps {
  readonly recipe: RecipePreviewData;
  className?: string;
}

export function MarketScene3dPreview({ recipe, className }: MarketScene3dPreviewProps) {
  const [lightPreset, setLightPreset] = useState<"day" | "sunset" | "night">("day");

  return (
    <div
      role="region"
      aria-labelledby="market-3d-heading"
      aria-describedby="market-3d-preview-note"
      className={`overflow-hidden rounded-xl border border-line bg-card ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <h2 id="market-3d-heading" className="min-w-0 break-words text-xs font-semibold text-fg">
            3D 프리셋 참고 일러스트 ({recipe.name})
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-6 min-w-0 max-w-full items-center break-all rounded bg-raised px-2 text-[0.65rem] text-fg-3">
            레시피: {recipe.recipeId}
          </span>
          <div role="radiogroup" aria-label="조명 프리셋" className="flex rounded-lg border border-line bg-raised/80 p-0.5">
            <button
              type="button"
              role="radio"
              aria-checked={lightPreset === "day"}
              onClick={() => setLightPreset("day")}
              className={`rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                lightPreset === "day"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              주간
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={lightPreset === "sunset"}
              onClick={() => setLightPreset("sunset")}
              className={`rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                lightPreset === "sunset"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              노을
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={lightPreset === "night"}
              onClick={() => setLightPreset("night")}
              className={`rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                lightPreset === "night"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              야간
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex aspect-[16/9] w-full items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-raised via-canvas to-panel p-6">
        <svg aria-hidden="true" className="h-full w-full max-w-[360px]" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="wallLeft" x1="0" y1="0" x2="1" y2="1">
              <stop
                offset="0%"
                stopColor={lightPreset === "sunset" ? "#f97316" : lightPreset === "night" ? "#1e1b4b" : "#475569"}
                stopOpacity="0.5"
              />
              <stop
                offset="100%"
                stopColor={lightPreset === "sunset" ? "#9a3412" : lightPreset === "night" ? "#0f172a" : "#1e293b"}
                stopOpacity="0.8"
              />
            </linearGradient>
            <linearGradient id="wallRight" x1="0" y1="0" x2="1" y2="1">
              <stop
                offset="0%"
                stopColor={lightPreset === "sunset" ? "#fbbf24" : lightPreset === "night" ? "#312e81" : "#64748b"}
                stopOpacity="0.4"
              />
              <stop
                offset="100%"
                stopColor={lightPreset === "sunset" ? "#c2410c" : lightPreset === "night" ? "#1e1b4b" : "#334155"}
                stopOpacity="0.7"
              />
            </linearGradient>
            <linearGradient id="floor" x1="0" y1="0" x2="1" y2="1">
              <stop
                offset="0%"
                stopColor={lightPreset === "sunset" ? "#f59e0b" : lightPreset === "night" ? "#06b6d4" : "#3b82f6"}
                stopOpacity="0.2"
              />
              <stop
                offset="100%"
                stopColor={lightPreset === "sunset" ? "#b45309" : lightPreset === "night" ? "#0369a1" : "#1d4ed8"}
                stopOpacity="0.4"
              />
            </linearGradient>
          </defs>

          {/* Floor grid */}
          <polygon points="200,160 360,230 200,295 40,230" fill="url(#floor)" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.5" />
          <line x1="120" y1="195" x2="280" y2="262" stroke="#60a5fa" strokeWidth="0.8" strokeOpacity="0.3" />
          <line x1="280" y1="195" x2="120" y2="262" stroke="#60a5fa" strokeWidth="0.8" strokeOpacity="0.3" />

          {/* Left Wall */}
          <polygon points="40,90 200,20 200,160 40,230" fill="url(#wallLeft)" stroke="#475569" strokeWidth="1" />
          {/* Right Wall */}
          <polygon points="200,20 360,90 360,230 200,160" fill="url(#wallRight)" stroke="#475569" strokeWidth="1" />

          {/* 3D Prop Object (Desk / Block) */}
          <polygon points="180,180 230,158 260,172 210,194" fill={lightPreset === "sunset" ? "#fb923c" : lightPreset === "night" ? "#38bdf8" : "#f59e0b"} opacity="0.8" />
          <polygon points="180,180 210,194 210,218 180,204" fill={lightPreset === "sunset" ? "#ea580c" : lightPreset === "night" ? "#0284c7" : "#d97706"} opacity="0.9" />
          <polygon points="210,194 260,172 260,196 210,218" fill={lightPreset === "sunset" ? "#c2410c" : lightPreset === "night" ? "#0369a1" : "#b45309"} opacity="0.9" />

          {/* Camera Visualizer Cones */}
          <circle cx="80" cy="250" r="10" fill="#3b82f6" opacity="0.9" />
          <polygon points="80,250 160,180 210,210" fill="#3b82f6" opacity="0.15" stroke="#60a5fa" strokeWidth="1" strokeDasharray="3,3" />
        </svg>

        <div className="absolute bottom-3 left-3 flex min-h-6 items-center gap-2 rounded bg-canvas/90 px-2 py-0.5 text-[0.65rem] text-fg shadow-sm backdrop-blur-sm">
          <Camera className="h-3 w-3 text-accent" aria-hidden="true" />
          <span>자유 카메라 시점</span>
        </div>
        <div className="absolute bottom-3 right-3 flex min-h-6 items-center gap-2 rounded bg-canvas/90 px-2 py-0.5 text-[0.65rem] text-fg shadow-sm backdrop-blur-sm">
          <Sun className="h-3 w-3 text-warn" aria-hidden="true" />
          <span>{lightPreset === "day" ? "주간 햇살 조명" : lightPreset === "sunset" ? "노을빛 골든아워" : "네온 야간 조명"}</span>
        </div>

        {recipe.parameters ? (
          <div className="absolute right-3 top-3 flex min-h-6 items-center gap-1.5 rounded-md bg-canvas/90 px-2.5 py-1 text-[0.68rem] font-medium text-fg shadow-sm backdrop-blur-sm">
            <Layers className="h-3 w-3 text-accent" aria-hidden="true" />
            <span>{Object.keys(recipe.parameters).length}개 씬 환경변수</span>
          </div>
        ) : null}
      </div>

      <p id="market-3d-preview-note" className="border-t border-line bg-panel/30 px-4 py-2 text-[0.68rem] leading-relaxed text-fg-3">
        레시피 메타데이터를 설명하기 위한 단순화된 일러스트이며 실제 Studio 렌더 결과가 아닙니다.
      </p>
    </div>
  );
}

