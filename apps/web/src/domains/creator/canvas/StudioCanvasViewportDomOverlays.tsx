import { Suspense } from "react";

import { StudioRenderSurface } from "../render/StudioRenderSurface";
import { CANVAS_W } from "../studio-assets";
import {
  StudioCanonicalVNextDryMediaCanvas,
  StudioLiveDynamicBrushOverlayHost,
  StudioLiveInkOverlayHost,
  StudioLiveInkPredictionHost,
  StudioLiveRetainedMediaOverlayHost,
  StudioLiveStampOverlayHost,
  StudioLiveWetInkOverlayHost,
  StudioWebGpuCanvas,
} from "../studio-page-lazy-ui";
import { StudioInkMeshLivePreviewHost } from "../StudioInkMeshLivePreviewHost";
import { StudioPixiSceneOverlayHost } from "../StudioPixiSceneOverlayHost";

import type { StudioCanvasViewportLiveSurfaces } from "./studio-canvas-viewport-live-surfaces";
import type {
  StudioCanvasViewportHandlers,
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";

export interface StudioCanvasViewportDomOverlaysProps {
  acceleratedSceneSelectedIds: StudioCanvasViewportLiveSurfaces["acceleratedSceneSelectedIds"];
  canonicalDryMediaCanvasVisible: StudioCanvasViewportLiveSurfaces["canonicalDryMediaCanvasVisible"];
  canonicalDryMediaCandidate: StudioCanvasViewportLiveSurfaces["canonicalDryMediaCandidate"];
  canonicalDryMediaLayoutKey: string;
  canvasFlipH: StudioCanvasViewportProps["canvasFlipH"];
  canvasH: StudioCanvasViewportProps["canvasH"];
  velloHubAuthority: StudioCanvasViewportLiveSurfaces["velloHubAuthority"];
  velloDocumentSurfaceEnabled: StudioCanvasViewportLiveSurfaces["velloDocumentSurfaceEnabled"];
  effScale: StudioCanvasViewportProps["effScale"];
  elements: StudioCanvasViewportProps["elements"];
  hokusaiLiveCanvasRef: StudioCanvasViewportLiveSurfaces["hokusaiLiveCanvasRef"];
  inkMeshLivePreviewRuntime: StudioCanvasViewportProps["inkMeshLivePreviewRuntime"];
  liveDynamicBrushOverlayRenderer: StudioCanvasViewportProps["liveDynamicBrushOverlayRenderer"];
  liveInkOverlayRenderer: StudioCanvasViewportProps["liveInkOverlayRenderer"];
  liveInkPredictionRenderer: StudioCanvasViewportProps["liveInkPredictionRenderer"];
  liveRetainedMediaOverlayRenderer: StudioCanvasViewportProps["liveRetainedMediaOverlayRenderer"];
  liveStampOverlayRenderer: StudioCanvasViewportProps["liveStampOverlayRenderer"];
  liveWetInkOverlayRenderer: StudioCanvasViewportProps["liveWetInkOverlayRenderer"];
  livingInkCanvasRef: StudioCanvasViewportLiveSurfaces["livingInkCanvasRef"];
  onWebGpuBackendChange: StudioCanvasViewportHandlers["onWebGpuBackendChange"];
  onWebGpuDeviceLost: StudioCanvasViewportHandlers["onWebGpuDeviceLost"];
  onWebGpuFrameInvalid: StudioCanvasViewportHandlers["onWebGpuFrameInvalid"];
  onWebGpuFrameReady: StudioCanvasViewportHandlers["onWebGpuFrameReady"];
  onWebGpuFrameRequest: StudioCanvasViewportHandlers["onWebGpuFrameRequest"];
  pixiMountParent: HTMLDivElement | null;
  pixiSceneDocumentTransform: StudioCanvasViewportLiveSurfaces["pixiSceneDocumentTransform"];
  velloSceneDocumentTransform: StudioCanvasViewportLiveSurfaces["velloSceneDocumentTransform"];
  velloSceneRevision: StudioCanvasViewportLiveSurfaces["velloSceneRevision"];
  velloSurfaceDpr: StudioCanvasViewportLiveSurfaces["velloSurfaceDpr"];
  readVelloHubPenDown: StudioCanvasViewportLiveSurfaces["readVelloHubPenDown"];
  setCanonicalDryMediaCanvasAuthority: StudioCanvasViewportLiveSurfaces["setCanonicalDryMediaCanvasAuthority"];
  setVelloHubAuthority: StudioCanvasViewportLiveSurfaces["setVelloHubAuthority"];
  setWebGpuCanvasHandle: StudioCanvasViewportHandlers["setWebGpuCanvasHandle"];
  stageViewLayout: StudioCanvasViewportLiveSurfaces["stageViewLayout"];
  transientPenInkSurfaceEnabled: StudioCanvasViewportProps["transientPenInkSurfaceEnabled"];
  velloHubCapability: StudioCanvasViewportLiveSurfaces["velloHubCapability"];
  webGpuPreviewAuthorized: StudioCanvasViewportProps["webGpuPreviewAuthorized"];
  webGpuPreviewStrokes: StudioCanvasViewportProps["webGpuPreviewStrokes"];
  webGpuViewportSurface: StudioCanvasViewportProps["webGpuViewportSurface"];
}

export function StudioCanvasViewportDomOverlays({
  acceleratedSceneSelectedIds,
  canonicalDryMediaCanvasVisible,
  canonicalDryMediaCandidate,
  canonicalDryMediaLayoutKey,
  canvasFlipH,
  canvasH,
  velloHubAuthority,
  velloDocumentSurfaceEnabled,
  effScale,
  elements,
  hokusaiLiveCanvasRef,
  inkMeshLivePreviewRuntime,
  liveDynamicBrushOverlayRenderer,
  liveInkOverlayRenderer,
  liveInkPredictionRenderer,
  liveRetainedMediaOverlayRenderer,
  liveStampOverlayRenderer,
  liveWetInkOverlayRenderer,
  livingInkCanvasRef,
  onWebGpuBackendChange,
  onWebGpuDeviceLost,
  onWebGpuFrameInvalid,
  onWebGpuFrameReady,
  onWebGpuFrameRequest,
  pixiMountParent,
  pixiSceneDocumentTransform,
  velloSceneDocumentTransform,
  velloSceneRevision,
  velloSurfaceDpr,
  readVelloHubPenDown,
  setCanonicalDryMediaCanvasAuthority,
  setVelloHubAuthority,
  setWebGpuCanvasHandle,
  stageViewLayout,
  transientPenInkSurfaceEnabled,
  velloHubCapability,
  webGpuPreviewAuthorized,
  webGpuPreviewStrokes,
  webGpuViewportSurface,
}: StudioCanvasViewportDomOverlaysProps) {
  return (
    <>
          <Suspense fallback={null}>
            {webGpuViewportSurface ? (
              <StudioLiveInkOverlayHost
                renderer={liveInkOverlayRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {webGpuViewportSurface ? (
              <StudioLiveStampOverlayHost
                renderer={liveStampOverlayRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {webGpuViewportSurface ? (
              <StudioLiveDynamicBrushOverlayHost
                renderer={liveDynamicBrushOverlayRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {webGpuViewportSurface ? (
              <StudioLiveRetainedMediaOverlayHost
                renderer={liveRetainedMediaOverlayRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {webGpuViewportSurface ? (
              <StudioLiveWetInkOverlayHost
                renderer={liveWetInkOverlayRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {transientPenInkSurfaceEnabled && webGpuViewportSurface ? (
              <StudioLiveInkPredictionHost
                renderer={liveInkPredictionRenderer}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
            {transientPenInkSurfaceEnabled && webGpuViewportSurface && inkMeshLivePreviewRuntime ? (
              <StudioInkMeshLivePreviewHost
                runtime={inkMeshLivePreviewRuntime}
                left={webGpuViewportSurface.surface.left}
                top={webGpuViewportSurface.surface.top}
                width={webGpuViewportSurface.surface.width}
                height={webGpuViewportSurface.surface.height}
                documentScale={effScale}
                documentWidth={CANVAS_W}
                flipX={canvasFlipH}
              />
            ) : null}
          </Suspense>
          <StudioRenderSurface
            enabled={velloDocumentSurfaceEnabled}
            mountParent={pixiMountParent}
            width={stageViewLayout.width}
            height={stageViewLayout.height}
            dpr={velloSurfaceDpr}
            documentTransform={velloSceneDocumentTransform}
            documentWidth={CANVAS_W}
            documentHeight={canvasH}
            elements={elements}
            sceneRevision={velloSceneRevision}
            isPenDown={readVelloHubPenDown}
            onAuthorityChange={setVelloHubAuthority}
          />
          {velloHubAuthority.status === "unavailable" ? (
            <div
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              data-studio-vello-unavailable="true"
              className="pointer-events-none absolute inset-x-4 top-4 z-[30] rounded-md border border-red-400/50 bg-red-950/90 px-4 py-3 text-sm font-medium text-red-50 shadow-lg"
            >
              {velloHubAuthority.visibleCanvasCount === 1
                ? "Vello 렌더러를 계속 사용할 수 없어 마지막 정확 프레임을 유지했습니다. 다른 렌더러로 자동 전환하지 않았습니다."
                : "Vello 렌더러를 사용할 수 없어 가속 문서 표면으로 전환하지 않았습니다. 같은 작업을 다른 엔진으로 재실행하지 않았습니다."}
            </div>
          ) : null}
          <StudioPixiSceneOverlayHost
            enabled={
              !velloHubCapability.enabled
              || velloHubAuthority.status === "legacy"
            }
            mountParent={pixiMountParent}
            // Mixed/unsupported pages are an explicit legacy boundary. A Vello
            // runtime failure never re-enables Pixi as a pixel fallback.
            width={stageViewLayout.hostWidth}
            height={stageViewLayout.hostHeight}
            documentTransform={pixiSceneDocumentTransform}
            documentWidth={CANVAS_W}
            documentHeight={canvasH}
            elements={elements}
            selectedIds={acceleratedSceneSelectedIds}
          />
          {webGpuViewportSurface ? (
            <canvas
              ref={livingInkCanvasRef}
              aria-hidden="true"
              data-studio-living-ink-overlay="true"
              className="pointer-events-none absolute z-[13] mix-blend-multiply"
              style={{
                left: webGpuViewportSurface.surface.left,
                top: webGpuViewportSurface.surface.top,
                width: webGpuViewportSurface.surface.width,
                height: webGpuViewportSurface.surface.height,
              }}
            />
          ) : null}
          {webGpuViewportSurface ? (
            <canvas
              ref={hokusaiLiveCanvasRef}
              aria-hidden="true"
              data-studio-hokusai-live-overlay="true"
              className="pointer-events-none absolute z-[12]"
              style={{
                left: webGpuViewportSurface.surface.left,
                top: webGpuViewportSurface.surface.top,
                width: webGpuViewportSurface.surface.width,
                height: webGpuViewportSurface.surface.height,
              }}
            />
          ) : null}
          {webGpuViewportSurface ? (
            <Suspense fallback={null}>
              <StudioCanonicalVNextDryMediaCanvas
                element={canonicalDryMediaCandidate}
                layoutKey={canonicalDryMediaLayoutKey}
                visible={canonicalDryMediaCanvasVisible}
                surfaceBounds={webGpuViewportSurface.surface}
                documentWidth={CANVAS_W}
                documentHeight={canvasH}
                documentScale={effScale}
                flipX={canvasFlipH}
                onAuthorityChange={setCanonicalDryMediaCanvasAuthority}
              />
            </Suspense>
          ) : null}
          {webGpuViewportSurface ? (
            <Suspense fallback={null}>
              <StudioWebGpuCanvas
                className="pointer-events-none z-10"
                width={CANVAS_W}
                height={canvasH}
                surfaceBounds={webGpuViewportSurface.surface}
                scaleX={webGpuViewportSurface.transform.scaleX}
                scaleY={webGpuViewportSurface.transform.scaleY}
                offsetX={webGpuViewportSurface.transform.offsetX}
                offsetY={webGpuViewportSurface.transform.offsetY}
                flipX={webGpuViewportSurface.transform.flipX}
                ref={setWebGpuCanvasHandle}
                strokes={webGpuPreviewStrokes}
                frameAuthorized={webGpuPreviewAuthorized}
                eagerInitialize
                onBackendChange={onWebGpuBackendChange}
                onDeviceLost={onWebGpuDeviceLost}
                onFrameInvalid={onWebGpuFrameInvalid}
                onFrameRequest={onWebGpuFrameRequest}
                onFrameReady={onWebGpuFrameReady}
              />
            </Suspense>
          ) : null}
    </>
  );
}
