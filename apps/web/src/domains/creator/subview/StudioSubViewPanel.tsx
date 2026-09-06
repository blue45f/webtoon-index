/**
 * StudioSubViewPanel.tsx
 *
 * Clip Studio Paint Sub View Palette (서브 뷰 팔레트).
 * Webtoon and comic artists' dedicated reference image viewer:
 *   - Multi-reference image management (add, remove, browse).
 *   - Independent zoom (25% ~ 400%), rotate (0° ~ 360°), and flip H/V.
 *   - Real-time pixel eyedropper: hover/click samples exact RGB/Hex color
 *     and notifies the studio active color without leaving the workspace.
 */

import {
  ChevronLeft,
  ChevronRight,
  FlipHorizontal,
  FlipVertical,
  Minus,
  Pipette,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  clampSubViewZoom,
  DEFAULT_SUBVIEW_IMAGES,
  normalizeRotationDeg,
  rgbToHex,
  type StudioSubViewImage,
} from "./studio-subview-model";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioSubViewPanelProps {
  readonly onPickColor?: (hexColor: string) => void;
  readonly initialImages?: readonly StudioSubViewImage[];
  readonly className?: string;
}

export function StudioSubViewPanel({
  onPickColor,
  initialImages = DEFAULT_SUBVIEW_IMAGES,
  className,
}: StudioSubViewPanelProps) {
  const [images, setImages] = useState<readonly StudioSubViewImage[]>(initialImages);
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(true);
  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentImage: StudioSubViewImage | undefined = images[activeIndex];

  const handlePrevImage = () => {
    if (images.length === 0) return;
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNextImage = () => {
    if (images.length === 0) return;
    setActiveIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  const handleAddImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) return;
      const newImg: StudioSubViewImage = {
        id: `ref-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, "") || "참조 이미지",
        src,
      };
      setImages((prev) => [...prev, newImg]);
      setActiveIndex(images.length);
    };
    reader.readAsDataURL(file);
    // Reset file input so same file can be chosen again
    event.target.value = "";
  };

  const handleRemoveImage = () => {
    if (images.length <= 1) return;
    setImages((prev) => prev.filter((_, idx) => idx !== activeIndex));
    setActiveIndex((prev) => Math.max(0, prev - 1));
  };

  const handleResetTransform = () => {
    setZoom(1.0);
    setRotationDeg(0);
    setFlipH(false);
    setFlipV(false);
  };

  const handleSampleColor = useCallback(
    (clientX: number, clientY: number): string | null => {
      const img = imgRef.current;
      if (!img) return null;

      const rect = img.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      if (relX < 0 || relY < 0 || relX >= rect.width || relY >= rect.height) {
        return null;
      }

      // Draw to offscreen canvas to sample pixel color
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasRef.current = canvas;
      }

      const naturalW = img.naturalWidth || 300;
      const naturalH = img.naturalHeight || 200;
      if (canvas.width !== naturalW || canvas.height !== naturalH) {
        canvas.width = naturalW;
        canvas.height = naturalH;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      try {
        ctx.clearRect(0, 0, naturalW, naturalH);
        ctx.drawImage(img, 0, 0, naturalW, naturalH);

        const normX = Math.floor((relX / rect.width) * naturalW);
        const normY = Math.floor((relY / rect.height) * naturalH);

        const pixel = ctx.getImageData(normX, normY, 1, 1).data;
        const hex = rgbToHex(pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0);
        return hex;
      } catch {
        return null;
      }
    },
    [],
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!eyedropperActive) return;
    const sampled = handleSampleColor(e.clientX, e.clientY);
    if (sampled) {
      setHoveredColor(sampled);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!eyedropperActive) return;
    const sampled = handleSampleColor(e.clientX, e.clientY) || hoveredColor;
    if (sampled) {
      onPickColor?.(sampled);
      setCopiedToast(sampled);
      setTimeout(() => setCopiedToast(null), 1500);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-line bg-panel/60 p-3 select-none text-slate-200 text-xs shadow-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-line/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Pipette size={14} className="text-pink-400 shrink-0" aria-hidden />
          <span className="font-semibold truncate">서브 뷰 (Sub View)</span>
          <span className="px-1 py-0.2 text-[10px] rounded font-medium bg-pink-500/20 text-pink-300 border border-pink-500/30 shrink-0">
            CSP
          </span>
        </div>

        {/* Image Pagination & Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handlePrevImage}
            disabled={images.length <= 1}
            title="이전 레퍼런스 이미지"
            aria-label="이전 레퍼런스 이미지"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-[11px] tabular-nums font-mono text-slate-400 px-1">
            {images.length > 0 ? `${activeIndex + 1}/${images.length}` : "0/0"}
          </span>
          <button
            type="button"
            onClick={handleNextImage}
            disabled={images.length <= 1}
            title="다음 레퍼런스 이미지"
            aria-label="다음 레퍼런스 이미지"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight size={13} />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAddImage}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="새 레퍼런스 이미지 불러오기"
            aria-label="새 레퍼런스 이미지 불러오기"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
          >
            <Upload size={13} />
          </button>

          <button
            type="button"
            onClick={handleRemoveImage}
            disabled={images.length <= 1}
            title="현재 레퍼런스 삭제"
            aria-label="현재 레퍼런스 삭제"
            className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div
        className={cn(
          "relative flex items-center justify-center my-2 h-44 rounded-lg bg-slate-950/80 border border-line/40 overflow-hidden",
          eyedropperActive ? "cursor-crosshair" : "cursor-grab",
        )}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
      >
        {currentImage ? (
          <div
            className="transition-transform duration-75 flex items-center justify-center"
            style={{
              transform: `scale(${zoom}) rotate(${rotationDeg}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
            }}
          >
            <img
              ref={imgRef}
              src={currentImage.src}
              alt={currentImage.name}
              crossOrigin="anonymous"
              className="max-h-40 max-w-full object-contain pointer-events-auto select-none"
              draggable={false}
            />
          </div>
        ) : (
          <p className="text-slate-500 text-xs">레퍼런스 이미지를 추가하세요</p>
        )}

        {/* Toast feedback when color sampled */}
        {copiedToast && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-pink-600/90 text-white text-[11px] font-mono shadow-md backdrop-blur-sm pointer-events-none animate-fade-in flex items-center gap-1">
            <span
              className="size-2.5 rounded-full border border-white/40 inline-block"
              style={{ background: copiedToast }}
            />
            {copiedToast}
          </div>
        )}

        {/* Live Eyedropper Loupe Badge */}
        {eyedropperActive && hoveredColor && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/90 border border-slate-700/80 text-[11px] font-mono shadow backdrop-blur-sm pointer-events-none">
            <span
              className="size-3.5 rounded border border-white/30 shrink-0"
              style={{ background: hoveredColor }}
            />
            <span className="text-slate-200">{hoveredColor}</span>
          </div>
        )}
      </div>

      {/* Control Toolbar */}
      <div className="flex items-center justify-between gap-1 pt-1">
        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => clampSubViewZoom(z - 0.1))}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            title="축소"
            aria-label="축소"
          >
            <Minus size={13} />
          </button>
          <span className="text-[11px] tabular-nums font-mono text-slate-400 min-w-9 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => clampSubViewZoom(z + 0.1))}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            title="확대"
            aria-label="확대"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={handleResetTransform}
            className={buttonClass({
              size: "sm",
              variant: "outline",
              className: "h-6 px-1.5 text-[10px] text-slate-300 ml-0.5",
            })}
            title="원래 크기 및 회전 초기화"
          >
            <ZoomIn size={11} className="mr-0.5" />
            100%
          </button>
        </div>

        {/* Transform & Tool Buttons */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setRotationDeg((deg) => normalizeRotationDeg(deg + 90))}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10"
            title="90° 시계방향 회전"
            aria-label="90° 시계방향 회전"
          >
            <RotateCw size={13} />
          </button>

          <button
            type="button"
            onClick={() => setFlipH((v) => !v)}
            aria-pressed={flipH}
            className={cn(
              "p-1 rounded transition-colors",
              flipH
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                : "text-slate-400 hover:text-white hover:bg-white/10",
            )}
            title="좌우 반전"
            aria-label="좌우 반전"
          >
            <FlipHorizontal size={13} />
          </button>

          <button
            type="button"
            onClick={() => setFlipV((v) => !v)}
            aria-pressed={flipV}
            className={cn(
              "p-1 rounded transition-colors",
              flipV
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                : "text-slate-400 hover:text-white hover:bg-white/10",
            )}
            title="상하 반전"
            aria-label="상하 반전"
          >
            <FlipVertical size={13} />
          </button>

          <button
            type="button"
            onClick={() => setEyedropperActive((v) => !v)}
            aria-pressed={eyedropperActive}
            className={cn(
              "p-1 rounded transition-colors",
              eyedropperActive
                ? "bg-pink-500/20 text-pink-300 border border-pink-500/40"
                : "text-slate-400 hover:text-white hover:bg-white/10",
            )}
            title={eyedropperActive ? "자동 스포이드 활성화됨" : "스포이드 켜기"}
            aria-label={eyedropperActive ? "자동 스포이드 활성화됨" : "스포이드 켜기"}
          >
            <Pipette size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
