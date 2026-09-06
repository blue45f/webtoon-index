import {
  Box,
  Eye,
  Layers,
  Move3d,
  Palette,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import type { RecipePreviewData } from "../models/market-preview";

interface Market3dAssetPreviewProps {
  readonly recipe: RecipePreviewData;
  className?: string;
}

type ViewMode = "wireframe" | "shaded" | "toon";

/**
 * 3D 에셋 리소스의 인터랙티브 웹 인스펙터.
 * Sketchfab & Clip Studio 스타일의 와이어프레임 / 셰이딩 / 웹툰 셀 렌더 모드 전환과
 * 기술 사양(메쉬·본·텍스처)을 제공한다.
 */
export function Market3dAssetPreview({ recipe, className }: Market3dAssetPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("shaded");

  return (
    <div
      role="region"
      aria-labelledby="market-3d-asset-heading"
      aria-describedby="market-3d-asset-preview-note"
      className={`overflow-hidden rounded-xl border border-line bg-card ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <h2 id="market-3d-asset-heading" className="min-w-0 break-words text-xs font-semibold text-fg">
            3D 에셋 미리보기 ({recipe.name})
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <div role="radiogroup" aria-label="3D 렌더 모드" className="flex rounded-lg border border-line bg-raised/80 p-0.5">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "wireframe"}
              onClick={() => setViewMode("wireframe")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                viewMode === "wireframe"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              <Move3d className="h-3 w-3" aria-hidden="true" />
              와이어프레임
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "shaded"}
              onClick={() => setViewMode("shaded")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                viewMode === "shaded"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              <Eye className="h-3 w-3" aria-hidden="true" />
              셰이딩
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "toon"}
              onClick={() => setViewMode("toon")}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.68rem] font-medium transition-colors ${
                viewMode === "toon"
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              <Palette className="h-3 w-3" aria-hidden="true" />
              웹툰 렌더
            </button>
          </div>
        </div>
      </div>

      <div className="relative flex aspect-[16/9] w-full items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-raised via-canvas to-panel p-6">
        <svg aria-hidden="true" className="h-full w-full max-w-[360px]" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="assetFloor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="shadedBody" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5eead4" />
              <stop offset="60%" stopColor="#0d9488" />
              <stop offset="100%" stopColor="#115e59" />
            </linearGradient>
            <linearGradient id="toonBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ccfbf1" />
              <stop offset="48%" stopColor="#ccfbf1" />
              <stop offset="50%" stopColor="#5eead4" />
              <stop offset="100%" stopColor="#2dd4bf" />
            </linearGradient>
            <radialGradient id="highlightGlow" cx="50%" cy="30%" r="40%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Floor Grid */}
          <polygon points="200,220 350,270 200,285 50,270" fill="url(#assetFloor)" stroke="#14b8a6" strokeWidth="1" strokeOpacity="0.3" />
          <line x1="125" y1="245" x2="275" y2="278" stroke="#2dd4bf" strokeWidth="0.6" strokeOpacity="0.2" />
          <line x1="275" y1="245" x2="125" y2="278" stroke="#2dd4bf" strokeWidth="0.6" strokeOpacity="0.2" />

          {/* 3D Model Rendering based on viewMode */}
          {viewMode === "wireframe" ? (
            <g>
              {/* Head Wireframe */}
              <ellipse cx="200" cy="85" rx="24" ry="22" fill="none" stroke="#2dd4bf" strokeWidth="1.5" />
              <ellipse cx="200" cy="85" rx="24" ry="8" fill="none" stroke="#2dd4bf" strokeWidth="1" strokeDasharray="3,2" />
              <line x1="200" y1="63" x2="200" y2="107" stroke="#2dd4bf" strokeWidth="1" strokeDasharray="3,2" />
              <line x1="176" y1="85" x2="224" y2="85" stroke="#2dd4bf" strokeWidth="1" strokeDasharray="3,2" />

              {/* Neck & Torso Topology */}
              <line x1="200" y1="107" x2="200" y2="120" stroke="#2dd4bf" strokeWidth="1.5" />
              <polygon points="175,120 225,120 230,185 170,185" fill="none" stroke="#2dd4bf" strokeWidth="1.5" />
              <line x1="175" y1="120" x2="230" y2="185" stroke="#2dd4bf" strokeWidth="0.8" strokeDasharray="2,2" strokeOpacity="0.5" />
              <line x1="225" y1="120" x2="170" y2="185" stroke="#2dd4bf" strokeWidth="0.8" strokeDasharray="2,2" strokeOpacity="0.5" />
              <line x1="172" y1="152" x2="228" y2="152" stroke="#2dd4bf" strokeWidth="0.8" strokeDasharray="2,2" strokeOpacity="0.5" />

              {/* Limbs Wireframe */}
              <line x1="175" y1="125" x2="145" y2="165" stroke="#2dd4bf" strokeWidth="1.8" />
              <line x1="145" y1="165" x2="150" y2="200" stroke="#2dd4bf" strokeWidth="1.5" />
              <circle cx="145" cy="165" r="3" fill="#2dd4bf" />
              <circle cx="150" cy="200" r="3" fill="#2dd4bf" />

              <line x1="225" y1="125" x2="255" y2="165" stroke="#2dd4bf" strokeWidth="1.8" />
              <line x1="255" y1="165" x2="250" y2="200" stroke="#2dd4bf" strokeWidth="1.5" />
              <circle cx="255" cy="165" r="3" fill="#2dd4bf" />
              <circle cx="250" cy="200" r="3" fill="#2dd4bf" />

              <line x1="185" y1="185" x2="180" y2="235" stroke="#2dd4bf" strokeWidth="1.8" />
              <line x1="215" y1="185" x2="220" y2="235" stroke="#2dd4bf" strokeWidth="1.8" />
              <circle cx="180" cy="235" r="3" fill="#2dd4bf" />
              <circle cx="220" cy="235" r="3" fill="#2dd4bf" />
            </g>
          ) : viewMode === "shaded" ? (
            <g>
              {/* Head Shaded */}
              <ellipse cx="200" cy="85" rx="24" ry="22" fill="url(#shadedBody)" stroke="#0f766e" strokeWidth="1" />
              <circle cx="192" cy="78" r="8" fill="url(#highlightGlow)" />

              {/* Neck & Torso Shaded */}
              <rect x="195" y="105" width="10" height="15" fill="#0d9488" rx="2" />
              <polygon points="175,120 225,120 230,185 170,185" fill="url(#shadedBody)" stroke="#0f766e" strokeWidth="1" />
              <ellipse cx="200" cy="135" rx="16" ry="6" fill="#5eead4" fillOpacity="0.4" />

              {/* Arms */}
              <line x1="175" y1="125" x2="145" y2="165" stroke="#0d9488" strokeWidth="8" strokeLinecap="round" />
              <line x1="145" y1="165" x2="150" y2="200" stroke="#115e59" strokeWidth="6" strokeLinecap="round" />
              <line x1="225" y1="125" x2="255" y2="165" stroke="#0d9488" strokeWidth="8" strokeLinecap="round" />
              <line x1="255" y1="165" x2="250" y2="200" stroke="#115e59" strokeWidth="6" strokeLinecap="round" />

              {/* Legs */}
              <line x1="185" y1="185" x2="180" y2="235" stroke="#0f766e" strokeWidth="8" strokeLinecap="round" />
              <line x1="215" y1="185" x2="220" y2="235" stroke="#0f766e" strokeWidth="8" strokeLinecap="round" />
            </g>
          ) : (
            <g>
              {/* Toon Cel Mode (Clean Webtoon Inking + 2-Tone Cel Shadow) */}
              {/* Head */}
              <ellipse cx="200" cy="85" rx="24" ry="22" fill="url(#toonBody)" stroke="#042f2e" strokeWidth="2.5" />
              {/* Toon Face guides */}
              <line x1="190" y1="85" x2="196" y2="85" stroke="#042f2e" strokeWidth="2" strokeLinecap="round" />
              <line x1="204" y1="85" x2="210" y2="85" stroke="#042f2e" strokeWidth="2" strokeLinecap="round" />
              <path d="M 197 93 Q 200 95 203 93" fill="none" stroke="#042f2e" strokeWidth="1.5" strokeLinecap="round" />

              {/* Torso */}
              <polygon points="175,120 225,120 230,185 170,185" fill="url(#toonBody)" stroke="#042f2e" strokeWidth="2.5" />

              {/* Inked Limbs */}
              <line x1="175" y1="125" x2="145" y2="165" stroke="#042f2e" strokeWidth="6" strokeLinecap="round" />
              <line x1="145" y1="165" x2="150" y2="200" stroke="#042f2e" strokeWidth="5" strokeLinecap="round" />
              <line x1="225" y1="125" x2="255" y2="165" stroke="#042f2e" strokeWidth="6" strokeLinecap="round" />
              <line x1="255" y1="165" x2="250" y2="200" stroke="#042f2e" strokeWidth="5" strokeLinecap="round" />

              <line x1="185" y1="185" x2="180" y2="235" stroke="#042f2e" strokeWidth="6" strokeLinecap="round" />
              <line x1="215" y1="185" x2="220" y2="235" stroke="#042f2e" strokeWidth="6" strokeLinecap="round" />
            </g>
          )}

          {/* Coordinate Gizmo */}
          <line x1="75" y1="255" x2="105" y2="255" stroke="#ef4444" strokeWidth="1.8" />
          <line x1="75" y1="255" x2="75" y2="225" stroke="#22c55e" strokeWidth="1.8" />
          <line x1="75" y1="255" x2="62" y2="265" stroke="#3b82f6" strokeWidth="1.8" />
          <text x="108" y="258" fontSize="9" fontWeight="bold" fill="#ef4444">X</text>
          <text x="72" y="222" fontSize="9" fontWeight="bold" fill="#22c55e">Y</text>
          <text x="54" y="272" fontSize="9" fontWeight="bold" fill="#3b82f6">Z</text>
        </svg>

        {/* Floating Spec Badges */}
        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-canvas/90 px-2 py-0.5 text-[0.65rem] font-semibold text-fg shadow-sm backdrop-blur-sm">
            <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
            3D 에셋
          </span>
          <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-canvas/90 px-2 py-0.5 text-[0.65rem] text-fg-2 shadow-sm backdrop-blur-sm">
            <RotateCw className="h-3 w-3 text-fg-3" aria-hidden="true" />
            회전 가능
          </span>
        </div>

        {recipe.parameters ? (
          <div className="absolute right-3 top-3 flex min-h-6 items-center gap-1.5 rounded-md bg-canvas/90 px-2.5 py-1 text-[0.68rem] font-medium text-fg shadow-sm backdrop-blur-sm">
            <Layers className="h-3 w-3 text-accent" aria-hidden="true" />
            <span>{Object.keys(recipe.parameters).length}개 파라미터</span>
          </div>
        ) : null}
      </div>

      <p id="market-3d-asset-preview-note" className="border-t border-line bg-panel/30 px-4 py-2 text-[0.68rem] leading-relaxed text-fg-3">
        3D 에셋의 구조를 설명하기 위한 단순화된 일러스트이며 실제 Studio 렌더 결과가 아닙니다.
        Studio에서 Three.js로 실시간 렌더링됩니다.
      </p>
    </div>
  );
}

