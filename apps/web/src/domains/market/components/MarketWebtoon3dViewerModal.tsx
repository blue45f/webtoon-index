import {
  Box,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Sunset,
  X,
} from "lucide-react";
import { useState } from "react";

import { MarketWebtoonSpecBadge } from "./MarketWebtoonSpecBadge";

import type { WebtoonLicenseTier } from "../models/market-webtoon-licensing";
import type {
  AssetFormatId,
  PolycountGrade,
} from "../models/market-webtoon-spec-inspector";


import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export type RenderShadingMode =
  | "texture-color"
  | "line-art"
  | "cel-shade"
  | "monochrome";

export type LightingAtmosphere = "day" | "sunset" | "night";

export interface MarketWebtoon3dViewerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly assetTitle: string;
  readonly format?: AssetFormatId;
  readonly triangleCount?: number;
  readonly vertexCount?: number;
  readonly polycountGrade?: PolycountGrade;
  readonly licenseTier?: WebtoonLicenseTier;
  readonly onImportToStudio?: () => void;
  readonly studioResourceId?: string;
}

export function MarketWebtoon3dViewerModal({
  open,
  onClose,
  assetTitle,
  format,
  triangleCount,
  vertexCount,
  polycountGrade,
  licenseTier,
  onImportToStudio,
  studioResourceId,
}: MarketWebtoon3dViewerModalProps) {
  const [renderMode, setRenderMode] = useState<RenderShadingMode>("texture-color");
  const [lighting, setLighting] = useState<LightingAtmosphere>("day");
  const [orbitAngle, setOrbitAngle] = useState(45);
  const [showWireframe, setShowWireframe] = useState(false);

  const validTriangleCount = triangleCount !== undefined && Number.isSafeInteger(triangleCount) && triangleCount >= 0 ? triangleCount : undefined;
  const validVertexCount = vertexCount !== undefined && Number.isSafeInteger(vertexCount) && vertexCount >= 0 ? vertexCount : undefined;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-3d-viewer-title"
      data-testid="market-webtoon-3d-viewer-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
    >
      <div className="flex h-[88vh] w-full max-w-5xl flex-col rounded-2xl border border-line bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-raised px-5 py-3.5">
          <div className="flex items-center gap-3">
            <Box className="size-5 text-accent" />
            <div>
              <h2 id="market-3d-viewer-title" className="text-sm font-bold text-fg">
                {assetTitle} · 3D 렌더 모드 예시
              </h2>
              <p className="text-[0.68rem] text-fg-3">
                아래 도형은 렌더 모드를 설명하는 예시이며 이 에셋의 실제 메시가 아닙니다. 실제 모델과 지원 기능은 Studio에서 확인하세요.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="3D 뷰어 닫기"
            className="rounded-lg p-1.5 text-fg-3 hover:bg-card hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Illustrative controls, explicitly not an asset renderer. */}
        <div className="relative flex-1 bg-gradient-to-b from-neutral-900 to-neutral-950 overflow-hidden flex items-center justify-center">
          {/* Render-mode illustration; never presented as the publisher mesh. */}
          <div
            className="relative flex flex-col items-center justify-center p-8 transition-transform duration-200"
            style={{ transform: `rotateY(${orbitAngle}deg)` }}
          >
            {/* Mesh Box Representation */}
            <div
              className={cn(
                "relative h-56 w-56 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 shadow-2xl",
                renderMode === "line-art" && "border-white bg-black/90 text-white font-mono",
                renderMode === "cel-shade" && "border-sky-400 bg-sky-950/70 text-sky-200",
                renderMode === "monochrome" && "border-neutral-500 bg-neutral-800 text-neutral-300",
                renderMode === "texture-color" && lighting === "day" && "border-amber-400/80 bg-amber-950/40 text-amber-200",
                renderMode === "texture-color" && lighting === "sunset" && "border-rose-500/80 bg-rose-950/60 text-rose-200",
                renderMode === "texture-color" && lighting === "night" && "border-indigo-400/80 bg-indigo-950/70 text-indigo-200",
              )}
            >
              {showWireframe && (
                <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 border border-white/20 pointer-events-none opacity-40">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <div key={i} className="border border-white/10" />
                  ))}
                </div>
              )}

              <div className="flex flex-col items-center text-center p-4">
                <Box className="size-16 mb-2 opacity-80" />
                <span className="font-bold text-xs">
                  {renderMode === "line-art" && "은선 추출 (Line-Art)"}
                  {renderMode === "cel-shade" && "셀 툰 셰이딩 (Cel Shading)"}
                  {renderMode === "monochrome" && "모노크롬 명암 (Monochrome)"}
                  {renderMode === "texture-color" && "풀컬러 텍스처 (Full Texture)"}
                </span>
                <span className="text-[0.62rem] opacity-70 mt-0.5">
                  조명: {lighting === "day" ? "주간 자연광" : lighting === "sunset" ? "노을 골든아워" : "야경 달빛"}
                </span>
              </div>
            </div>
          </div>

          {/* Floating Top Badge */}
          <div className="absolute top-4 left-4">
            <MarketWebtoonSpecBadge
              format={format}
              polycountGrade={polycountGrade}
              licenseTier={licenseTier}
            />
          </div>

          {/* Floating HUD Bottom Info */}
          <div className="absolute bottom-4 left-4 rounded-xl border border-white/10 bg-black/70 px-3.5 py-2 text-[0.68rem] text-white/80 backdrop-blur-md">
            <div className="flex items-center gap-3 font-mono">
              {validTriangleCount !== undefined ? (
                <span>Triangles: {validTriangleCount.toLocaleString()}</span>
              ) : null}
              {validVertexCount !== undefined ? (
                <span>Vertices: {validVertexCount.toLocaleString()}</span>
              ) : null}
              {validTriangleCount === undefined && validVertexCount === undefined ? (
                <span>메시 통계 미제공</span>
              ) : null}
              <span>회전각: {orbitAngle}°</span>
            </div>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-card p-4 text-xs">
          {/* Render Mode Switcher */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-fg-3 text-[0.68rem]">렌더 모드:</span>
            <div className="flex gap-1">
              {(
                [
                  { id: "texture-color", label: "컬러 텍스처" },
                  { id: "line-art", label: "웹툰 은선" },
                  { id: "cel-shade", label: "셀 셰이딩" },
                  { id: "monochrome", label: "흑백 명암" },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={renderMode === mode.id}
                  onClick={() => setRenderMode(mode.id)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-semibold transition-all",
                    renderMode === mode.id
                      ? "border-accent bg-accent text-on-accent shadow-sm"
                      : "border-line bg-panel text-fg hover:bg-raised",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lighting Atmosphere */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-fg-3 text-[0.68rem]">조명 환경:</span>
            <div className="flex gap-1">
              <button
                type="button"
                aria-pressed={lighting === "day"}
                onClick={() => setLighting("day")}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-semibold",
                  lighting === "day" ? "border-amber-400 bg-amber-400/20 text-amber-500" : "border-line bg-panel text-fg",
                )}
              >
                <Sun className="size-3" />
                <span>주간</span>
              </button>
              <button
                type="button"
                aria-pressed={lighting === "sunset"}
                onClick={() => setLighting("sunset")}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-semibold",
                  lighting === "sunset" ? "border-rose-400 bg-rose-400/20 text-rose-500" : "border-line bg-panel text-fg",
                )}
              >
                <Sunset className="size-3" />
                <span>노을</span>
              </button>
              <button
                type="button"
                aria-pressed={lighting === "night"}
                onClick={() => setLighting("night")}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[0.68rem] font-semibold",
                  lighting === "night" ? "border-indigo-400 bg-indigo-400/20 text-indigo-400" : "border-line bg-panel text-fg",
                )}
              >
                <Moon className="size-3" />
                <span>야경</span>
              </button>
            </div>
          </div>

          {/* Turntable Slider & Wireframe */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <RotateCcw className="size-3.5 text-fg-3" />
              <input
                type="range"
                aria-label="렌더 모드 예시 회전각"
                min={0}
                max={360}
                value={orbitAngle}
                onChange={(e) => setOrbitAngle(Number(e.target.value))}
                className="accent-accent w-24"
              />
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-[0.68rem]">
              <input
                type="checkbox"
                checked={showWireframe}
                onChange={(e) => setShowWireframe(e.target.checked)}
                className="accent-accent"
              />
              <span>와이어프레임</span>
            </label>

            {studioResourceId ? (
              <Link
                href={`/studio?installMarketResource=${encodeURIComponent(studioResourceId)}&assetMarket=community`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 font-bold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Studio에서 실제 에셋 확인
              </Link>
            ) : null}
            {!studioResourceId && onImportToStudio && (
              <button
                type="button"
                onClick={onImportToStudio}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-bold text-on-accent shadow-sm hover:brightness-105"
              >
                <Sparkles className="size-3.5" />
                <span>Studio에서 확인하기</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
