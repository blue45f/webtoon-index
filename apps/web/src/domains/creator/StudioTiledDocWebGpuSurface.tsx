import { useLayoutEffect, useRef, useState } from "react";

import {
  STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID,
  StudioTileDocProductIslandStore,
} from "./render/studio-tiledoc-product-island";
import { StudioTileDocWebGpuRuntime } from "./render/studio-tiledoc-webgpu-runtime";

import type { StudioRasterImmutableTileFrame } from "./live/studio-crdt-raster-replay-runtime";
import type {
  StudioRasterTilePresentationFailureReason,
  StudioRasterTilePresentationResult,
  StudioRasterTileViewport,
} from "./render/studio-raster-tile-presenter";
import type { StudioTileDocRect } from "./render/studio-tiledoc-geometry";
import type { StudioRasterSurfaceSpec } from "@/shared/lib/studio-crdt-raster-ops";

export interface StudioTiledDocWebGpuSurfaceProps {
  readonly className?: string;
  readonly generation: number;
  readonly surface: StudioRasterSurfaceSpec;
  readonly tiles: readonly StudioRasterImmutableTileFrame[];
  readonly viewport: Omit<StudioRasterTileViewport, "devicePixelRatio">;
  readonly documentViewport: StudioTileDocRect;
  readonly signal?: AbortSignal;
  readonly presentationAuthorized?: boolean;
  readonly onFrameReady?: (generation: number) => void;
  readonly onFrameInvalid?: (
    generation: number,
    reason: StudioRasterTilePresentationFailureReason | "superseded" | "device-lost"
  ) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  readonly onPresentationResult?: (result: StudioRasterTilePresentationResult) => void;
}

interface LatestCallbacks {
  readonly onFrameReady: StudioTiledDocWebGpuSurfaceProps["onFrameReady"];
  readonly onFrameInvalid: StudioTiledDocWebGpuSurfaceProps["onFrameInvalid"];
  readonly onDeviceLost: StudioTiledDocWebGpuSurfaceProps["onDeviceLost"];
  readonly onPresentationResult: StudioTiledDocWebGpuSurfaceProps["onPresentationResult"];
}

function browserDpr(): number {
  const value = globalThis.devicePixelRatio;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(8, value)
    : 1;
}

function validDocumentViewport(rect: StudioTileDocRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && rect.width > 0
    && Number.isFinite(rect.height)
    && rect.height > 0;
}

/**
 * Product surface for the committed CRDT raster island. GPU work uses StudioGpuFabric through the
 * tiledoc compositor. WebGPU is the immutable selected provider: a failed frame becomes explicitly
 * unavailable and never re-executes the committed tiles through Canvas2D.
 */
export function StudioTiledDocWebGpuSurface({
  className,
  generation,
  surface,
  tiles,
  viewport,
  documentViewport,
  signal,
  presentationAuthorized = false,
  onFrameReady,
  onFrameInvalid,
  onDeviceLost,
  onPresentationResult,
}: StudioTiledDocWebGpuSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const islandRef = useRef<StudioTileDocProductIslandStore | null>(null);
  const runtimeRef = useRef<StudioTileDocWebGpuRuntime | null>(null);
  const latestGenerationRef = useRef(generation);
  const [backend, setBackend] = useState<"pending" | "unavailable" | "webgpu">("pending");
  const callbacksRef = useRef<LatestCallbacks>({
    onFrameReady,
    onFrameInvalid,
    onDeviceLost,
    onPresentationResult,
  });
  callbacksRef.current = { onFrameReady, onFrameInvalid, onDeviceLost, onPresentationResult };
  latestGenerationRef.current = generation;
  const {
    x: documentViewportX,
    y: documentViewportY,
    width: documentViewportWidth,
    height: documentViewportHeight,
  } = documentViewport;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surfaceId = surface.surfaceId;
    const island = new StudioTileDocProductIslandStore({
      version: surface.version,
      surfaceId,
      width: surface.width,
      height: surface.height,
      tileSize: surface.tileSize,
    });
    const runtime = new StudioTileDocWebGpuRuntime({
      canvas,
      store: island.store,
      onFrameReady: (frameId) => {
        if (frameId !== `${surfaceId}:${latestGenerationRef.current}`) return;
        setBackend("webgpu");
        callbacksRef.current.onFrameReady?.(latestGenerationRef.current);
      },
      onUnavailable: () => {
        const unavailableGeneration = latestGenerationRef.current;
        setBackend("unavailable");
        callbacksRef.current.onFrameInvalid?.(
          unavailableGeneration,
          "webgpu-unavailable"
        );
        callbacksRef.current.onPresentationResult?.({
          status: "rejected",
          generation: unavailableGeneration,
          reason: "webgpu-unavailable",
        });
      },
      onDeviceLost: (info) => {
        setBackend("pending");
        callbacksRef.current.onFrameInvalid?.(
          latestGenerationRef.current,
          "device-lost"
        );
        callbacksRef.current.onDeviceLost?.(info);
      },
    });
    islandRef.current = island;
    runtimeRef.current = runtime;
    setBackend("pending");
    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      if (islandRef.current === island) islandRef.current = null;
      runtime.dispose();
      island.dispose();
    };
  }, [surface.height, surface.surfaceId, surface.tileSize, surface.width, surface.version]);

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    const island = islandRef.current;
    if (!runtime || !island) return;
    if (signal?.aborted) {
      runtime.setVisible(false);
      setBackend("pending");
      return;
    }
    if (viewport.flipX || !validDocumentViewport({
      x: documentViewportX,
      y: documentViewportY,
      width: documentViewportWidth,
      height: documentViewportHeight,
    })) {
      runtime.setVisible(false);
      setBackend("unavailable");
      callbacksRef.current.onFrameInvalid?.(generation, "presentation-failed");
      return;
    }
    runtime.setVisible(true);
    try {
      island.reconcile(tiles);
    } catch {
      runtime.setVisible(false);
      setBackend("unavailable");
      callbacksRef.current.onFrameInvalid?.(generation, "presentation-failed");
      return;
    }
    const resized = runtime.resize({
      cssWidth: viewport.surfaceBounds.width,
      cssHeight: viewport.surfaceBounds.height,
      devicePixelRatio: browserDpr(),
    });
    if (resized.status !== "resized") {
      setBackend("unavailable");
      return;
    }
    setBackend("pending");
    const frameId = `${surface.surfaceId}:${generation}`;
    const frameViewport = {
      x: documentViewportX,
      y: documentViewportY,
      width: documentViewportWidth,
      height: documentViewportHeight,
    };
    void runtime.requestFrame({
      frameId,
      viewport: frameViewport,
      layers: [{ id: STUDIO_TILEDOC_PRODUCT_RASTER_LAYER_ID }],
    }).then((result) => {
      if (latestGenerationRef.current !== generation) return;
      if (result.status === "unavailable") setBackend("unavailable");
    });
    const abort = () => {
      runtime.setVisible(false);
      setBackend("pending");
      callbacksRef.current.onFrameInvalid?.(generation, "superseded");
    };
    signal?.addEventListener("abort", abort, { once: true });
    return () => signal?.removeEventListener("abort", abort);
  }, [
    documentViewportHeight,
    documentViewportWidth,
    documentViewportX,
    documentViewportY,
    generation,
    signal,
    surface.surfaceId,
    tiles,
    viewport.flipX,
    viewport.surfaceBounds.height,
    viewport.surfaceBounds.width,
  ]);

  const owner = presentationAuthorized && backend === "webgpu"
    ? "tiledoc-webgpu"
    : "none";
  return (
    <div
      aria-hidden="true"
      className={className}
      data-studio-tiledoc-product-island="true"
      data-studio-primary-surface-owner={owner}
      data-studio-tiledoc-webgpu-status={backend}
      style={{
        position: "absolute",
        left: viewport.surfaceBounds.left,
        top: viewport.surfaceBounds.top,
        width: viewport.surfaceBounds.width,
        height: viewport.surfaceBounds.height,
        overflow: "hidden",
        pointerEvents: "none",
        visibility: owner === "none" ? "hidden" : "visible",
      }}
    >
      <canvas
        ref={canvasRef}
        width={1}
        height={1}
        data-studio-tiledoc-webgpu-canvas="true"
        style={{
          position: "absolute",
          inset: 0,
          display: owner === "tiledoc-webgpu" ? "block" : "none",
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
