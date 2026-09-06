/**
 * Small DOM hosts for live drawing surfaces and the frame-local pressure HUD.
 * Loaded beside the canvas so their React wiring stays out of route bootstrap.
 */
import {
  Suspense,
  memo,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { studioPressureHudRatio } from "../brush/studio-draw-hud";
import { StudioHudPill } from "../studio-chrome-ui";

import type { StudioLiveDynamicBrushOverlayRenderer } from "./studio-live-dynamic-brush-overlay";
import type {
  StudioLiveInkOverlayRenderer,
  StudioLiveInkPredictionRenderer,
  StudioLiveInkSurface,
} from "./studio-live-ink-overlay";
import type { StudioLiveRetainedMediaOverlayRenderer } from "./studio-live-retained-media-overlay";
import type { StudioLiveStampOverlayRenderer } from "./studio-live-stamp-overlay";
import type { StudioLiveWetInkOverlayRenderer } from "./studio-live-wet-ink-overlay";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const StudioPressureHudMeter = lazyRetry(
  () => import("../studio-creative-visuals").then((mod) => ({ default: mod.StudioPressureHudMeter })),
  "StudioPressureHudMeter"
);

export interface StudioLivePressureStore {
  value: number | null;
  listeners: Set<() => void>;
}

export const StudioLiveInkOverlayHost = memo(function StudioLiveInkOverlayHost({
  renderer,
  left,
  top,
  width,
  height,
  documentScale,
  documentWidth,
  flipX,
}: StudioLiveInkSurface & { renderer: StudioLiveInkOverlayRenderer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    renderer.attach(canvasRef.current);
    return () => renderer.attach(null);
  }, [renderer]);
  useLayoutEffect(() => {
    renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
  });
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-studio-live-ink-overlay="true"
      className="pointer-events-none absolute z-10"
      style={{ left, top, width, height }}
    />
  );
});

export const StudioLiveRetainedMediaOverlayHost = memo(
  function StudioLiveRetainedMediaOverlayHost({
    renderer,
    left,
    top,
    width,
    height,
    documentScale,
    documentWidth,
    flipX,
  }: StudioLiveInkSurface & { renderer: StudioLiveRetainedMediaOverlayRenderer }) {
    const activeCanvasRef = useRef<HTMLCanvasElement>(null);
    const settledCanvasRef = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      if (!activeCanvasRef.current || !settledCanvasRef.current) return undefined;
      renderer.attach({
        activeCanvas: activeCanvasRef.current,
        settledCanvas: settledCanvasRef.current,
      });
      return () => renderer.attach(null);
    }, [renderer]);
    useLayoutEffect(() => {
      renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
    });
    return (
      <>
        <canvas
          ref={settledCanvasRef}
          aria-hidden="true"
          data-studio-live-retained-settled="true"
          className="pointer-events-none absolute z-10"
          style={{ left, top, width, height }}
        />
        <canvas
          ref={activeCanvasRef}
          aria-hidden="true"
          data-studio-live-retained-active="true"
          className="pointer-events-none absolute z-[11]"
          style={{ left, top, width, height }}
        />
      </>
    );
  },
);

export const StudioLiveStampOverlayHost = memo(function StudioLiveStampOverlayHost({
  renderer,
  left,
  top,
  width,
  height,
  documentScale,
  documentWidth,
  flipX,
}: StudioLiveInkSurface & { renderer: StudioLiveStampOverlayRenderer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    renderer.attach(canvasRef.current);
    return () => renderer.attach(null);
  }, [renderer]);
  useLayoutEffect(() => {
    renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
  });
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-studio-live-stamp-overlay="true"
      className="pointer-events-none absolute z-10"
      style={{ left, top, width, height }}
    />
  );
});

export const StudioLiveDynamicBrushOverlayHost = memo(
  function StudioLiveDynamicBrushOverlayHost({
    renderer,
    left,
    top,
    width,
    height,
    documentScale,
    documentWidth,
    flipX,
  }: StudioLiveInkSurface & { renderer: StudioLiveDynamicBrushOverlayRenderer }) {
    const coverageCanvasRef = useRef<HTMLCanvasElement>(null);
    const presentationCanvasRef = useRef<HTMLCanvasElement>(null);
    const settledCanvasRef = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      if (
        !coverageCanvasRef.current
        || !presentationCanvasRef.current
        || !settledCanvasRef.current
      ) return undefined;
      renderer.attach({
        activeCanvas: coverageCanvasRef.current,
        presentationCanvas: presentationCanvasRef.current,
        settledCanvas: settledCanvasRef.current,
      });
      return () => renderer.attach(null);
    }, [renderer]);
    useLayoutEffect(() => {
      renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
    });
    return (
      <>
        <canvas
          ref={settledCanvasRef}
          aria-hidden="true"
          data-studio-live-dynamic-settled="true"
          className="pointer-events-none absolute z-10"
          style={{ left, top, width, height }}
        />
        <canvas
          ref={coverageCanvasRef}
          aria-hidden="true"
          data-studio-live-dynamic-coverage="true"
          className="hidden"
        />
        <canvas
          ref={presentationCanvasRef}
          aria-hidden="true"
          data-studio-live-dynamic-active="true"
          className="pointer-events-none absolute z-[11]"
          style={{ left, top, width, height }}
        />
      </>
    );
  },
);

export const StudioLiveWetInkOverlayHost = memo(
  function StudioLiveWetInkOverlayHost({
    renderer,
    left,
    top,
    width,
    height,
    documentScale,
    documentWidth,
    flipX,
  }: StudioLiveInkSurface & { renderer: StudioLiveWetInkOverlayRenderer }) {
    // InkWash pen/water run the CPU Stam wash on these canvases without a GPU receipt.
    // Generic watercolor still cannot begin() here — studioLiveWetInkOverlaySupportsElement
    // keeps it behind the async backend. Unmounting the host made InkWash reject every stroke
    // with "선택한 습식 표면을 시작하지 못했습니다."
    const activeCanvasRef = useRef<HTMLCanvasElement>(null);
    const settledCanvasRef = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
      if (!activeCanvasRef.current || !settledCanvasRef.current) {
        renderer.attach(null);
        return undefined;
      }
      renderer.attach({
        activeCanvas: activeCanvasRef.current,
        settledCanvas: settledCanvasRef.current,
      });
      return () => renderer.attach(null);
    }, [renderer]);
    useLayoutEffect(() => {
      renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
    }, [documentScale, documentWidth, flipX, height, left, renderer, top, width]);
    return (
      <>
        <canvas
          ref={settledCanvasRef}
          aria-hidden="true"
          data-studio-live-wet-ink-settled="true"
          className="pointer-events-none absolute z-10"
          style={{ left, top, width, height }}
        />
        <canvas
          ref={activeCanvasRef}
          aria-hidden="true"
          data-studio-live-wet-ink-active="true"
          className="pointer-events-none absolute z-[11]"
          style={{ left, top, width, height }}
        />
      </>
    );
  },
);

export const StudioLiveInkPredictionHost = memo(function StudioLiveInkPredictionHost({
  renderer,
  left,
  top,
  width,
  height,
  documentScale,
  documentWidth,
  flipX,
}: StudioLiveInkSurface & { renderer: StudioLiveInkPredictionRenderer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    renderer.attach(canvasRef.current);
    return () => renderer.attach(null);
  }, [renderer]);
  useLayoutEffect(() => {
    renderer.setSurface({ left, top, width, height, documentScale, documentWidth, flipX });
  });
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-studio-live-ink-prediction="true"
      className="pointer-events-none absolute z-[11]"
      style={{ left, top, width, height }}
    />
  );
});

export function StudioLivePressureHudPill({ store }: { store: StudioLivePressureStore }) {
  const pressure = useSyncExternalStore(
    (onStoreChange) => {
      store.listeners.add(onStoreChange);
      return () => store.listeners.delete(onStoreChange);
    },
    () => store.value
  );
  const ratio = studioPressureHudRatio(pressure);
  if (ratio === null) return null;
  return (
    <StudioHudPill accent>
      <Suspense fallback={null}>
        <StudioPressureHudMeter ratio={ratio} />
      </Suspense>
    </StudioHudPill>
  );
}
