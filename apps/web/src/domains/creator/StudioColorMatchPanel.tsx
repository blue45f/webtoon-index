/**
 * StudioColorMatchPanel.tsx
 *
 * CLIP STUDIO PAINT Ver.3.0 Parity:
 * - Color Match (컬러 매치 / 색상 일치):
 *   - Intuitively harmonizes colors of artwork based on a reference image or palette mood.
 *   - Extracts reference color distribution (mean & standard deviation per RGB channel)
 *     and maps target layer tones toward the reference atmosphere.
 *   - Features:
 *     - Curated Webtoon Atmospheric Presets (Warm Sunset, Cyberpunk Neon, Vintage Pastel, Dramatic Noir, Golden Hour, Mystic Forest)
 *     - Custom Reference Image File Upload / Paste
 *     - Adjustable Match Strength (0..100%), Luminance Preservation, Clip Sigma
 *     - Before/After Split Comparison View (A/B 분할 비교 슬라이더)
 *     - One-click Apply to active canvas or layer
 */

import {
  Check,
  Eye,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  applyStudioReferenceImageColorMatch,
  type StudioAdvancedColorRgbaImage,
} from "./studio-advanced-color-filter-kernels";
import {
  COLOR_MATCH_PRESETS,
  createSyntheticReferenceRgba,
} from "./studio-color-match-presets";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioColorMatchPanelProps {
  readonly sourceImage?: StudioAdvancedColorRgbaImage | null;
  readonly onApply?: (matchedImage: StudioAdvancedColorRgbaImage) => void;
  readonly onApplyDataUrl?: (dataUrl: string) => void;
  readonly className?: string;
}

export function StudioColorMatchPanel({
  sourceImage = null,
  onApply,
  onApplyDataUrl,
  className,
}: StudioColorMatchPanelProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("warm-sunset");
  const [customRefImage, setCustomRefImage] =
    useState<StudioAdvancedColorRgbaImage | null>(null);
  const [customRefName, setCustomRefName] = useState<string | null>(null);

  const [strengthPercent, setStrengthPercent] = useState<number>(80);
  const [clipSigma, setClipSigma] = useState<number>(2.5);
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [showSplitView, setShowSplitView] = useState<boolean>(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active reference image: custom uploaded image or synthetic preset
  const activeReferenceImage = useMemo<StudioAdvancedColorRgbaImage>(() => {
    if (customRefImage) return customRefImage;
    const preset =
      COLOR_MATCH_PRESETS.find((p) => p.id === selectedPresetId) ??
      COLOR_MATCH_PRESETS[0];
    return createSyntheticReferenceRgba(preset.sampleColors, 64);
  }, [customRefImage, selectedPresetId]);

  // Compute matched result
  const matchResult = useMemo<StudioAdvancedColorRgbaImage | null>(() => {
    if (!sourceImage) return null;
    try {
      const outcome = applyStudioReferenceImageColorMatch({
        source: sourceImage,
        reference: activeReferenceImage,
        options: {
          strength: strengthPercent / 100,
          clipSigma,
          minimumStandardDeviation: 1.0,
        },
      });
      return outcome.status === "applied" ? outcome.image : null;
    } catch {
      return null;
    }
  }, [sourceImage, activeReferenceImage, strengthPercent, clipSigma]);

  // Handle custom image file upload
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 128;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          setCustomRefImage(
            Object.freeze({
              width: w,
              height: h,
              data: imgData.data,
            }),
          );
          setCustomRefName(file.name);
        }
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    },
    [],
  );

  const handleApplyCommit = () => {
    if (!matchResult) return;
    if (onApply) {
      onApply(matchResult);
    }
    if (onApplyDataUrl) {
      const canvas = document.createElement("canvas");
      canvas.width = matchResult.width;
      canvas.height = matchResult.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const imgData = ctx.createImageData(matchResult.width, matchResult.height);
        imgData.data.set(matchResult.data);
        ctx.putImageData(imgData, 0, 0);
        onApplyDataUrl(canvas.toDataURL("image/png"));
      }
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3.5 text-xs bg-slate-900/90 text-slate-100 rounded-lg border border-slate-800 shadow-xl",
        className,
      )}
      data-testid="studio-color-match-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Sparkles size={15} className="text-amber-400" />
          <span>컬러 매치 (Color Match)</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
            CSP 3.0
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSplitView(!showSplitView)}
          className={buttonClass({
            size: "sm",
            variant: showSplitView ? "solid" : "ghost",
            className: cn(
              "h-6 px-2 text-[11px] gap-1",
              showSplitView ? "bg-slate-700 text-white" : "text-slate-400",
            ),
          })}
          title="Before/After 분할 비교 토글"
        >
          <Eye size={12} />
          <span>{showSplitView ? "비교 뷰 On" : "단일 뷰"}</span>
        </button>
      </div>

      {/* Description */}
      <p className="text-[11px] text-slate-400 leading-relaxed">
        참조 이미지나 분위기 프리셋의 색채 분포(평균/표준편차)를 분석하여 선화
        디테일을 보존하면서 색조를 자연스럽게 조화시킵니다.
      </p>

      {/* Preset Mood Selector */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-300">참조 분위기 프리셋</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
          >
            <Upload size={12} />
            <span>이미지 직접 올리기</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        {customRefName && (
          <div className="flex items-center justify-between px-2 py-1 bg-indigo-950/40 border border-indigo-500/40 rounded text-[11px] text-indigo-200">
            <span className="truncate max-w-[200px]">
              사용자 이미지: {customRefName}
            </span>
            <button
              type="button"
              onClick={() => {
                setCustomRefImage(null);
                setCustomRefName(null);
              }}
              className="text-slate-400 hover:text-slate-200 text-[10px]"
            >
              초기화
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_MATCH_PRESETS.map((preset) => {
            const isSelected =
              !customRefImage && selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setCustomRefImage(null);
                  setCustomRefName(null);
                  setSelectedPresetId(preset.id);
                }}
                className={cn(
                  "flex items-center gap-2 p-1.5 rounded border text-left transition-colors",
                  isSelected
                    ? "bg-amber-950/40 border-amber-500/60 text-white"
                    : "bg-slate-800/40 border-slate-800 hover:bg-slate-800/80 text-slate-300",
                )}
              >
                <div
                  className="w-5 h-5 rounded-full border border-white/20 shrink-0 shadow"
                  style={{ background: preset.previewGradient }}
                />
                <div className="flex flex-col truncate">
                  <span className="font-medium text-[11px] truncate">
                    {preset.name}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Adjustments Controls */}
      <div className="flex flex-col gap-2.5 pt-1 border-t border-slate-800">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">적용 강도 (Match Strength)</span>
            <span className="font-semibold text-slate-200">{strengthPercent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={strengthPercent}
            onChange={(e) => setStrengthPercent(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">대비 클램핑 (Clip Sigma)</span>
            <span className="font-semibold text-slate-200">{clipSigma.toFixed(1)}σ</span>
          </div>
          <input
            type="range"
            min={1.0}
            max={4.0}
            step={0.1}
            value={clipSigma}
            onChange={(e) => setClipSigma(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {showSplitView && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">비교 분할 (Before / After)</span>
              <span className="font-semibold text-slate-200">{splitPercent}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={splitPercent}
              onChange={(e) => setSplitPercent(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
            />
          </div>
        )}
      </div>

      {/* Commit Actions */}
      <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setStrengthPercent(80);
            setClipSigma(2.5);
            setSplitPercent(50);
          }}
          className={buttonClass({
            size: "sm",
            variant: "ghost",
            className: "h-7 px-2 text-[11px] text-slate-400 hover:text-slate-200 gap-1",
          })}
        >
          <RefreshCw size={11} />
          <span>재설정</span>
        </button>

        <button
          type="button"
          onClick={handleApplyCommit}
          disabled={!matchResult}
          className={buttonClass({
            size: "sm",
            variant: "solid",
            className: cn(
              "h-7 px-3 text-[11px] font-medium gap-1.5",
              matchResult
                ? "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30"
                : "bg-slate-800 text-slate-500 cursor-not-allowed",
            ),
          })}
        >
          <Check size={13} />
          <span>컬러 매치 적용</span>
        </button>
      </div>
    </div>
  );
}
