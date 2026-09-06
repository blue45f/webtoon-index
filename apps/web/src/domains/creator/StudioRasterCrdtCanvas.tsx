import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";

import {
  StudioRasterTilePresenter,
  type StudioRasterTileFrameRequest,
  type StudioRasterTilePresentationFailureReason,
  type StudioRasterTilePresentationResult,
  type StudioRasterTilePresenterBackend,
  type StudioRasterTileSha256,
  type StudioRasterTileViewport,
} from "./render/studio-raster-tile-presenter";

import type { StudioRasterImmutableTileFrame } from "./live/studio-crdt-raster-replay-runtime";
import type { StudioRasterSurfaceSpec } from "@/shared/lib/studio-crdt-raster-ops";

export interface StudioRasterCrdtCanvasProps {
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly generation: number;
  readonly surface: StudioRasterSurfaceSpec;
  readonly tiles: readonly StudioRasterImmutableTileFrame[];
  readonly viewport: Omit<StudioRasterTileViewport, "devicePixelRatio">;
  readonly devicePixelRatio?: number;
  readonly signal?: AbortSignal;
  /** Show only when the owning commit simultaneously hides the exact Konva compatibility surfaces. */
  readonly presentationAuthorized?: boolean;
  /** Test/runtime override. Omit to use `navigator.gpu`; pass null to force Canvas2D. */
  readonly gpu?: GPU | null;
  readonly sha256?: StudioRasterTileSha256;
  readonly onBackendChange?: (backend: StudioRasterTilePresenterBackend) => void;
  readonly onFrameReady?: (generation: number) => void;
  readonly onFrameInvalid?: (
    generation: number,
    reason: StudioRasterTilePresentationFailureReason | "superseded" | "device-lost"
  ) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  readonly onPresentationResult?: (result: StudioRasterTilePresentationResult) => void;
}

export interface StudioRasterCrdtCanvasHandle {
  readonly getBackend: () => StudioRasterTilePresenterBackend;
  readonly invalidate: (
    reason?: StudioRasterTilePresentationFailureReason | "superseded"
  ) => void;
}

interface LatestCallbacks {
  onBackendChange: StudioRasterCrdtCanvasProps["onBackendChange"];
  onFrameReady: StudioRasterCrdtCanvasProps["onFrameReady"];
  onFrameInvalid: StudioRasterCrdtCanvasProps["onFrameInvalid"];
  onDeviceLost: StudioRasterCrdtCanvasProps["onDeviceLost"];
  onPresentationResult: StudioRasterCrdtCanvasProps["onPresentationResult"];
}

function browserDevicePixelRatio(): number {
  const value = globalThis.devicePixelRatio;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Thin React shell around the imperative presenter. Frame pixels, backend transitions, canvas
 * visibility and high-frequency viewport updates stay in refs/DOM and never enter React state.
 */
export const StudioRasterCrdtCanvas = forwardRef<
  StudioRasterCrdtCanvasHandle,
  StudioRasterCrdtCanvasProps
>(function StudioRasterCrdtCanvas({
  className,
  style,
  generation,
  surface,
  tiles,
  viewport,
  devicePixelRatio,
  signal,
  presentationAuthorized = false,
  gpu,
  sha256,
  onBackendChange,
  onFrameReady,
  onFrameInvalid,
  onDeviceLost,
  onPresentationResult,
}, ref) {
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2dCanvasRef = useRef<HTMLCanvasElement>(null);
  const presenterRef = useRef<StudioRasterTilePresenter | null>(null);
  const callbacksRef = useRef<LatestCallbacks>({
    onBackendChange,
    onFrameReady,
    onFrameInvalid,
    onDeviceLost,
    onPresentationResult,
  });
  callbacksRef.current = {
    onBackendChange,
    onFrameReady,
    onFrameInvalid,
    onDeviceLost,
    onPresentationResult,
  };

  useImperativeHandle(ref, () => ({
    getBackend: () => presenterRef.current?.getBackend() ?? "unavailable",
    invalidate: (reason) => presenterRef.current?.invalidate(reason),
  }), []);

  useLayoutEffect(() => {
    const gpuCanvas = gpuCanvasRef.current;
    const canvas2dCanvas = canvas2dCanvasRef.current;
    if (!gpuCanvas || !canvas2dCanvas) return;
    const presenter = new StudioRasterTilePresenter({
      gpuCanvas,
      canvas2dCanvas,
      gpu,
      sha256,
      onBackendChange: (backend) => callbacksRef.current.onBackendChange?.(backend),
      onFrameReady: (readyGeneration) => callbacksRef.current.onFrameReady?.(readyGeneration),
      onFrameInvalid: (invalidGeneration, reason) => (
        callbacksRef.current.onFrameInvalid?.(invalidGeneration, reason)
      ),
      onDeviceLost: (info) => callbacksRef.current.onDeviceLost?.(info),
    });
    presenterRef.current = presenter;
    return () => {
      if (presenterRef.current === presenter) presenterRef.current = null;
      presenter.dispose();
    };
  }, [gpu, sha256]);

  useLayoutEffect(() => {
    const presenter = presenterRef.current;
    if (!presenter) return;
    const request: StudioRasterTileFrameRequest = {
      generation,
      surface,
      tiles,
      viewport: {
        scaleX: viewport.scaleX,
        scaleY: viewport.scaleY,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY,
        flipX: viewport.flipX,
        surfaceBounds: {
          left: viewport.surfaceBounds.left,
          top: viewport.surfaceBounds.top,
          width: viewport.surfaceBounds.width,
          height: viewport.surfaceBounds.height,
        },
        devicePixelRatio: devicePixelRatio ?? browserDevicePixelRatio(),
      },
      signal,
    };
    void presenter.present(request).then((result) => {
      if (presenterRef.current !== presenter) return;
      callbacksRef.current.onPresentationResult?.(result);
    });
  }, [
    devicePixelRatio,
    generation,
    gpu,
    sha256,
    signal,
    surface,
    tiles,
    viewport.flipX,
    viewport.offsetX,
    viewport.offsetY,
    viewport.scaleX,
    viewport.scaleY,
    viewport.surfaceBounds.height,
    viewport.surfaceBounds.left,
    viewport.surfaceBounds.top,
    viewport.surfaceBounds.width,
  ]);

  const bounds = viewport.surfaceBounds;
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        ...style,
        position: style?.position ?? "absolute",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        overflow: "hidden",
        pointerEvents: "none",
        visibility: presentationAuthorized ? "visible" : "hidden",
      }}
      data-studio-raster-frame-authorized={presentationAuthorized ? "true" : "false"}
    >
      <canvas
        ref={gpuCanvasRef}
        width={1}
        height={1}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={canvas2dCanvasRef}
        width={1}
        height={1}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          pointerEvents: "none",
        }}
      />
    </div>
  );
});
