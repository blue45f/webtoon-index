import { ImageIcon, LocateFixed, Move } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  normalizeStudioCompanionPoint,
  type StudioCompanionNormalizedPoint,
  type StudioCompanionNormalizedRect,
} from "./studio-companion-review-projection";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

type StudioCompanionNavigatorT = (key: string, fallback?: string) => string;

function localizeText(t: StudioCompanionNavigatorT, fallback: string, key: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function tText(
  t: StudioCompanionNavigatorT,
  fallback: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return localizeText(t, fallback, key);
  return Object.entries(values).reduce(
    (memo, [token, value]) => memo.replaceAll(`{${token}}`, String(value)),
    localizeText(t, fallback, key),
  );
}

export interface StudioCompanionNavigatorProps {
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  viewport: StudioCompanionNormalizedRect;
  connected: boolean;
  captureAllowed: boolean;
  layout?: "embedded" | "dedicated";
  onNavigate: (point: StudioCompanionNormalizedPoint, final?: boolean) => void;
}

interface StudioCompanionNavigatorContainRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

function resolveStudioCompanionNavigatorContainRect(input: {
  containerHeight: number;
  containerWidth: number;
  imageHeight: number;
  imageWidth: number;
}): StudioCompanionNavigatorContainRect {
  const containerWidth = Number.isFinite(input.containerWidth) && input.containerWidth > 0
    ? input.containerWidth
    : 0;
  const containerHeight = Number.isFinite(input.containerHeight) && input.containerHeight > 0
    ? input.containerHeight
    : 0;
  const imageWidth = Number.isFinite(input.imageWidth) && input.imageWidth > 0 ? input.imageWidth : 0;
  const imageHeight = Number.isFinite(input.imageHeight) && input.imageHeight > 0 ? input.imageHeight : 0;
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

function pointFromPointer(
  event: PointerEvent<HTMLButtonElement>,
  imageWidth: number,
  imageHeight: number
): StudioCompanionNormalizedPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0.5, y: 0.5 };
  const contained = resolveStudioCompanionNavigatorContainRect({
    containerWidth: bounds.width,
    containerHeight: bounds.height,
    imageWidth,
    imageHeight,
  });
  if (contained.width <= 0 || contained.height <= 0) return { x: 0.5, y: 0.5 };
  return normalizeStudioCompanionPoint({
    x: (event.clientX - bounds.left - contained.x) / contained.width,
    y: (event.clientY - bounds.top - contained.y) / contained.height,
  });
}

export function StudioCompanionNavigator({
  imageUrl,
  imageWidth,
  imageHeight,
  viewport,
  connected,
  captureAllowed,
  layout = "embedded",
  onNavigate,
}: StudioCompanionNavigatorProps) {
  const activePointerRef = useRef<number | null>(null);
  const interactionReady = connected && imageUrl !== null && captureAllowed;
  const t = useT();
  const currentCenter = {
    x: viewport.x + viewport.width / 2,
    y: viewport.y + viewport.height / 2,
  };

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!interactionReady) return;
    activePointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Older WebViews still deliver click navigation without pointer capture.
    }
    onNavigate(pointFromPointer(event, imageWidth, imageHeight));
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!interactionReady || activePointerRef.current !== event.pointerId) return;
    onNavigate(pointFromPointer(event, imageWidth, imageHeight));
  }

  function releasePointer(event: PointerEvent<HTMLButtonElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    if (interactionReady) onNavigate(pointFromPointer(event, imageWidth, imageHeight), true);
    activePointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may have released capture after leaving the popup.
    }
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer cancellation commonly means capture was already revoked by the browser.
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!interactionReady) return;
    const step = event.shiftKey ? 0.2 : 0.05;
    let next: StudioCompanionNormalizedPoint | null = null;
    if (event.key === "ArrowLeft") next = { x: currentCenter.x - step, y: currentCenter.y };
    else if (event.key === "ArrowRight") next = { x: currentCenter.x + step, y: currentCenter.y };
    else if (event.key === "ArrowUp") next = { x: currentCenter.x, y: currentCenter.y - step };
    else if (event.key === "ArrowDown") next = { x: currentCenter.x, y: currentCenter.y + step };
    else if (event.key === "Home") next = { x: 0.5, y: 0.5 };
    if (!next) return;
    event.preventDefault();
    onNavigate(normalizeStudioCompanionPoint(next));
  }

  return (
    <section
      aria-labelledby="companion-navigator-title"
      className={cn("space-y-3", layout === "dedicated" && "flex min-h-0 flex-1 flex-col")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="companion-navigator-title" className="text-sm font-semibold text-fg">
            {t("studio.toolsCompanion.navigator.title")}
          </h2>
          <p id="companion-navigator-help" className="mt-0.5 text-xs leading-relaxed text-fg-3">
            {t("studio.toolsCompanion.navigator.description")}
          </p>
        </div>
        <span className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-line bg-card px-2 text-[0.65rem] font-semibold text-fg-2">
          <LocateFixed className="size-3" aria-hidden />
          {t("studio.toolsCompanion.navigator.maxFps")}
        </span>
      </div>

      <button
        type="button"
        disabled={!interactionReady}
        aria-label={t("studio.toolsCompanion.navigator.liveAria")}
        aria-describedby="companion-navigator-help"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={() => {
          activePointerRef.current = null;
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative grid w-full touch-none place-items-center overflow-hidden rounded-xl border border-line bg-[oklch(0.145_0.008_70)] text-left outline-none",
          "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35",
          layout === "dedicated"
            ? "h-[clamp(20rem,calc(100dvh-11rem),52rem)] min-h-80 flex-1"
            : "h-[clamp(18rem,58dvh,42rem)] min-h-48",
          interactionReady
            ? "cursor-crosshair hover:border-line-strong"
            : "cursor-not-allowed opacity-70"
        )}
      >
        {imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={t("studio.toolsCompanion.navigator.previewAlt")}
              draggable={false}
              className="pointer-events-none absolute inset-0 size-full object-contain"
            />
            <svg
              aria-hidden
              viewBox={`0 0 ${Math.max(1, imageWidth)} ${Math.max(1, imageHeight)}`}
              preserveAspectRatio="xMidYMid meet"
              className="pointer-events-none absolute inset-0 size-full overflow-visible text-accent"
            >
              <rect
                data-testid="studio-companion-viewport-box"
                x={viewport.x * imageWidth}
                y={viewport.y * imageHeight}
                width={viewport.width * imageWidth}
                height={viewport.height * imageHeight}
                rx={2}
                vectorEffect="non-scaling-stroke"
                className="fill-accent/10 stroke-current [stroke-width:2px] motion-safe:transition-all motion-safe:duration-150 motion-reduce:transition-none"
              />
            </svg>
          </>
        ) : (
          <span className="flex max-w-56 flex-col items-center px-5 text-center">
            <span className="grid size-11 place-items-center rounded-xl border border-line bg-card text-fg-3">
              <ImageIcon className="size-5" aria-hidden />
            </span>
            <strong className="mt-3 text-xs font-semibold text-fg-2">
              {connected
                ? t("studio.toolsCompanion.navigator.readyTitle")
                : t("studio.toolsCompanion.navigator.notConnected")}
            </strong>
            <span className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
              {t("studio.toolsCompanion.navigator.readySubtitle")}
            </span>
          </span>
        )}
      </button>

      <p role="status" aria-live="polite" className="flex min-h-6 items-center gap-2 text-xs text-fg-3">
        <Move className="size-3.5 shrink-0" aria-hidden />
        {!connected
          ? tText(
            t,
            "연결되면 위치 이동을 사용할 수 있습니다.",
            "studio.toolsCompanion.navigator.disconnectedHint",
          )
          : !captureAllowed
            ? tText(
              t,
              "획을 그리는 동안 캡처를 멈췄습니다. 획이 끝나면 갱신합니다.",
              "studio.toolsCompanion.navigator.captureStoppedHint",
            )
            : imageUrl
              ? tText(
                t,
                "주황색 상자가 기본 탭에서 현재 보이는 영역입니다.",
                "studio.toolsCompanion.navigator.visibleViewportHint",
              )
              : tText(
                t,
                "변경된 캔버스를 압축하는 중입니다.",
                "studio.toolsCompanion.navigator.compressionHint",
              )}
      </p>
    </section>
  );
}

export default StudioCompanionNavigator;
