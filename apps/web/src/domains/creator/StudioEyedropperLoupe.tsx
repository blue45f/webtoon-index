import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { normalizeHexColor } from "./studio-color-utils";
import {
  STUDIO_EYEDROPPER_LOUPE_HEIGHT,
  STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE,
  STUDIO_EYEDROPPER_LOUPE_WIDTH,
  placeStudioEyedropperLoupe,
  studioEyedropperLoupeCrosshair,
} from "./studio-eyedropper-loupe";

import type { StudioEyedropperSample, StudioEyedropperTarget } from "./studio-eyedropper";
import type { StudioEyedropperCapture } from "./studio-eyedropper-capture";
import type { StudioEyedropperPointerAnchor } from "./studio-eyedropper-loupe";
import type { StudioEyedropperPreviewStore } from "./studio-eyedropper-preview-store";
import type { ReactElement } from "react";

export interface StudioEyedropperLoupeProps {
  open: boolean;
  pointer: StudioEyedropperPointerAnchor;
  capture: StudioEyedropperCapture | null;
  sample: StudioEyedropperSample | null;
  target: StudioEyedropperTarget;
  currentTargetColor: string;
  referenceLabel: string;
  layerName?: string | null;
  viewport?: Readonly<{ width: number; height: number }>;
}

function safeSwatch(color: string | null | undefined): string {
  return normalizeHexColor(color ?? "") ?? "oklch(0.57 0.012 76)";
}

export function StudioEyedropperLoupe({
  open,
  pointer,
  capture,
  sample,
  target,
  currentTargetColor,
  referenceLabel,
  layerName = null,
  viewport,
}: StudioEyedropperLoupeProps): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open || !capture) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const context = canvas.getContext("2d");
      if (!context) return;
      const image = capture.imageData;
      const scratch = scratchCanvasRef.current ?? document.createElement("canvas");
      scratchCanvasRef.current = scratch;
      scratch.width = image.width;
      scratch.height = image.height;
      const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
      if (!scratchContext) return;
      const nativeImageData = scratchContext.createImageData(image.width, image.height);
      nativeImageData.data.set(image.data);
      scratchContext.putImageData(nativeImageData, 0, 0);

      const viewSize = STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE;
      canvas.width = viewSize;
      canvas.height = viewSize;
      context.clearRect(0, 0, viewSize, viewSize);
      context.imageSmoothingEnabled = false;
      const scale = Math.min(viewSize / image.width, viewSize / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(scratch, (viewSize - width) / 2, (viewSize - height) / 2, width, height);
    } catch {
      // Unsupported canvas mocks and transient tainted frames should only hide pixels, never the tool.
    }
  }, [capture, open]);

  if (!open || !capture || typeof document === "undefined") return null;
  const visualViewport = viewport ?? {
    width: globalThis.visualViewport?.width ?? globalThis.innerWidth ?? 320,
    height: globalThis.visualViewport?.height ?? globalThis.innerHeight ?? 320,
  };
  const placement = placeStudioEyedropperLoupe({ pointer, viewport: visualViewport });
  const crosshair = studioEyedropperLoupeCrosshair({
    imageWidth: capture.imageData.width,
    imageHeight: capture.imageData.height,
    sampleX: capture.sampleX,
    sampleY: capture.sampleY,
  });
  const sampledHex = sample?.hex ?? "투명";
  const targetLabel = target === "primary" ? "주 색" : "보조 색";

  return createPortal(
    <aside
      aria-hidden="true"
      data-studio-eyedropper-loupe="true"
      data-studio-eyedropper-loupe-side={placement.side}
      className="pointer-events-none fixed z-[var(--studio-z-help,110)] overflow-hidden rounded-2xl border border-line-strong bg-panel p-2 shadow-[0_18px_52px_oklch(0.06_0.01_70/0.58),inset_0_1px_0_oklch(0.97_0.01_85/0.08)]"
      style={{
        left: placement.left,
        top: placement.top,
        width: STUDIO_EYEDROPPER_LOUPE_WIDTH,
        minHeight: STUDIO_EYEDROPPER_LOUPE_HEIGHT,
      }}
    >
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-line-strong bg-canvas"
        style={{
          width: STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE,
          height: STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE,
          backgroundImage:
            "linear-gradient(45deg, oklch(0.245 0.011 64) 25%, transparent 25%), linear-gradient(-45deg, oklch(0.245 0.011 64) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, oklch(0.245 0.011 64) 75%), linear-gradient(-45deg, transparent 75%, oklch(0.245 0.011 64) 75%)",
          backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
          backgroundSize: "12px 12px",
        }}
      >
        <canvas
          ref={canvasRef}
          className="block size-full"
          width={STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE}
          height={STUDIO_EYEDROPPER_LOUPE_VIEW_SIZE}
        />
        <span
          className="absolute rounded-[2px] border border-fg shadow-[0_0_0_1px_oklch(0.15_0.01_70/0.95)]"
          style={{
            left: crosshair.left,
            top: crosshair.top,
            width: crosshair.pixelSize,
            height: crosshair.pixelSize,
            transform: "translate(-50%, -50%)",
          }}
        />
        <span
          className="absolute h-px w-4 bg-fg shadow-[0_1px_0_oklch(0.15_0.01_70/0.95)]"
          style={{ left: crosshair.left, top: crosshair.top, transform: "translate(-50%, -50%)" }}
        />
        <span
          className="absolute h-4 w-px bg-fg shadow-[1px_0_0_oklch(0.15_0.01_70/0.95)]"
          style={{ left: crosshair.left, top: crosshair.top, transform: "translate(-50%, -50%)" }}
        />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="size-5 shrink-0 rounded-md border border-line-strong"
            style={{ backgroundColor: safeSwatch(sample?.hex) }}
          />
          <span className="min-w-0">
            <span className="block text-[0.56rem] text-fg-3">채집</span>
            <span className="block truncate font-mono text-[0.62rem] font-semibold uppercase text-fg">
              {sampledHex}
            </span>
          </span>
        </span>
        <span className="h-7 w-px bg-line" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="size-5 shrink-0 rounded-md border border-line-strong"
            style={{ backgroundColor: safeSwatch(currentTargetColor) }}
          />
          <span className="min-w-0">
            <span className="block text-[0.56rem] text-fg-3">{targetLabel}</span>
            <span className="block truncate font-mono text-[0.62rem] uppercase text-fg-2">
              {normalizeHexColor(currentTargetColor) ?? currentTargetColor}
            </span>
          </span>
        </span>
      </div>
      <p className="mt-1.5 truncate text-center text-[0.56rem] text-fg-3">
        {referenceLabel}{layerName ? ` · ${layerName}` : ""}
      </p>
    </aside>,
    document.body,
  );
}

/** Isolated subscriber for the rAF-coalesced hover path; mounting it does not subscribe StudioPage. */
export function StudioEyedropperLoupeHost({
  store,
}: {
  store: StudioEyedropperPreviewStore;
}): ReactElement | null {
  const frame = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  if (!frame) return null;
  return (
    <StudioEyedropperLoupe
      open
      pointer={frame.pointer}
      capture={frame.capture}
      sample={frame.sample}
      target={frame.target}
      currentTargetColor={frame.currentTargetColor}
      referenceLabel={frame.referenceLabel}
      layerName={frame.layerName}
      viewport={frame.viewport}
    />
  );
}
