import { memo, useLayoutEffect, useRef } from "react";

import type { StudioInkMeshLivePreviewRuntime } from "./brush/studio-ink-mesh-live-preview-loader";
import type { StudioLiveInkSurface } from "./live/studio-live-ink-overlay";

export const StudioInkMeshLivePreviewHost = memo(
  function StudioInkMeshLivePreviewHost({
    runtime,
    left,
    top,
    width,
    height,
    documentScale,
    documentWidth,
    flipX,
  }: StudioLiveInkSurface & { runtime: StudioInkMeshLivePreviewRuntime }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      runtime.attach(canvasRef.current);
      return () => runtime.attach(null);
    }, [runtime]);
    useLayoutEffect(() => {
      runtime.setSurface({
        left,
        top,
        width,
        height,
        documentScale,
        documentWidth,
        flipX,
      });
    }, [documentScale, documentWidth, flipX, height, left, runtime, top, width]);
    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-studio-ink-mesh-live-preview="predicted-tail-only"
        className="pointer-events-none absolute z-[11]"
        style={{ left, top, width, height, visibility: "hidden" }}
      />
    );
  },
);
