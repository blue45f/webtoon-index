import { useLayoutEffect, useRef } from "react";

import { lowerStudioElementsToRenderScene } from "./studio-document-scene-lower";
import { buildStudioDocumentPresentScene } from "./studio-document-scene-present";
import { StudioFrameGraphCompositor } from "./studio-frame-graph-compositor";
import {
  createStudioVelloHub,
  resolveStudioVelloHubProductCapability,
  STUDIO_VELLO_HUB_PRODUCT_CAPABILITY,
  type StudioVelloHub,
  type StudioVelloHubBackendId,
  type StudioVelloHubDecision,
} from "./studio-vello-hub";
import {
  createStudioVelloHubCanvasTarget,
  type StudioVelloHubCanvasTarget,
} from "./studio-vello-hub-canvas-target";

import type { El } from "../studio-element-model";
import type { StudioSceneDocumentTransform } from "../studio-scene-provider";

export type StudioRenderSurfaceAuthorityStatus =
  | "disabled"
  | "idle"
  | "starting"
  | "active"
  | "legacy"
  | "unavailable";

export interface StudioRenderSurfaceAuthority {
  readonly status: StudioRenderSurfaceAuthorityStatus;
  readonly backendId: StudioVelloHubBackendId | null;
  readonly decision: StudioVelloHubDecision | null;
  readonly reason: string | null;
  /** Identity of the exact document + viewport projection this receipt describes. */
  readonly sceneRevision: object | null;
  readonly ownedDocumentIds: readonly string[];
  readonly visibleCanvasCount: 1 | 0;
}

export interface StudioRenderSurfaceProps {
  readonly enabled?: boolean;
  readonly mountParent: HTMLElement | null;
  readonly width: number;
  readonly height: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly dpr?: number;
  readonly elements: readonly El[];
  readonly sceneRevision: object;
  readonly documentTransform?: StudioSceneDocumentTransform;
  readonly isPenDown?: () => boolean;
  readonly onAuthorityChange?: (authority: StudioRenderSurfaceAuthority) => void;
}

const DISABLED_AUTHORITY: StudioRenderSurfaceAuthority = Object.freeze({
  status: "disabled",
  backendId: null,
  decision: null,
  reason: "product capability disabled",
  sceneRevision: null,
  ownedDocumentIds: [],
  visibleCanvasCount: 0,
});

/**
 * Single WebGPU document surface. Konva retains the input/hit graph and an
 * unexposed document shadow until an exact-revision GPU presentation receipt
 * arrives. Selection chrome remains on Konva's UI layer.
 */
export function StudioRenderSurface({
  enabled,
  mountParent,
  width,
  height,
  documentWidth,
  documentHeight,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  elements,
  sceneRevision,
  documentTransform,
  isPenDown,
  onAuthorityChange,
}: StudioRenderSurfaceProps) {
  const authoritySinkRef = useRef(onAuthorityChange);
  authoritySinkRef.current = onAuthorityChange;
  const hubRef = useRef<StudioVelloHub | null>(null);
  const targetRef = useRef<StudioVelloHubCanvasTarget | null>(null);
  const compositorRef = useRef<StudioFrameGraphCompositor | null>(null);
  const ownedDocumentIdsRef = useRef<readonly string[]>([]);
  const sceneRevisionRef = useRef<object | null>(sceneRevision);
  sceneRevisionRef.current = sceneRevision;
  // These refs move only after a product receipt. Render-phase prop updates must never relabel a
  // still-visible last-good frame as belonging to the next scene before its layout effect runs.
  const lastPresentedSceneRevisionRef = useRef<object | null>(null);
  const lastPresentedOwnedDocumentIdsRef = useRef<readonly string[]>([]);
  const generationRef = useRef(0);
  const renderGenerationRef = useRef(0);
  const capability = resolveStudioVelloHubProductCapability({ enabled });

  useLayoutEffect(() => {
    if (!capability.enabled) {
      authoritySinkRef.current?.(DISABLED_AUTHORITY);
      return undefined;
    }
    if (!mountParent) {
      authoritySinkRef.current?.({
        status: "starting",
        backendId: null,
        decision: null,
        reason: "awaiting-canvas-mount",
        sceneRevision: sceneRevisionRef.current,
        ownedDocumentIds: [],
        visibleCanvasCount: 0,
      });
      return undefined;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const target = createStudioVelloHubCanvasTarget(
      mountParent.ownerDocument,
      mountParent,
    );
    const compositor = new StudioFrameGraphCompositor();
    let hub: StudioVelloHub | null = null;
    const markUnavailable = (reason: string) => {
      if (generationRef.current !== generation) return;
      if (ownedDocumentIdsRef.current.length === 0) return;
      renderGenerationRef.current += 1;
      const visibleCanvasCount = target.canvas.style.display === "block" ? 1 : 0;
      const visibleSceneRevision = visibleCanvasCount === 1
        ? lastPresentedSceneRevisionRef.current
        : sceneRevisionRef.current;
      const visibleDocumentIds = visibleCanvasCount === 1
        ? lastPresentedOwnedDocumentIdsRef.current
        : ownedDocumentIdsRef.current;
      authoritySinkRef.current?.({
        status: "unavailable",
        backendId: visibleCanvasCount === 1 ? target.activeBackendId : null,
        decision: null,
        reason,
        sceneRevision: visibleSceneRevision,
        ownedDocumentIds: visibleDocumentIds,
        visibleCanvasCount,
      });
    };
    hub = createStudioVelloHub({
      target,
      isPenDown,
      onUnavailable(failure) {
        markUnavailable(`${failure.source}:${failure.reason}`);
      },
    });
    targetRef.current = target;
    hubRef.current = hub;
    compositorRef.current = compositor;
    authoritySinkRef.current?.({
      status: "starting",
      backendId: null,
      decision: null,
      reason: null,
      sceneRevision: sceneRevisionRef.current,
      ownedDocumentIds: [],
      visibleCanvasCount: 0,
    });

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      renderGenerationRef.current += 1;
      if (hubRef.current === hub) hubRef.current = null;
      if (targetRef.current === target) targetRef.current = null;
      if (compositorRef.current === compositor) compositorRef.current = null;
      ownedDocumentIdsRef.current = [];
      sceneRevisionRef.current = null;
      lastPresentedSceneRevisionRef.current = null;
      lastPresentedOwnedDocumentIdsRef.current = [];
      hub.dispose();
      compositor.dispose();
      target.destroy();
    };
  }, [capability.enabled, isPenDown, mountParent]);

  useLayoutEffect(() => {
    if (!capability.enabled) return undefined;
    const hub = hubRef.current;
    const target = targetRef.current;
    const compositor = compositorRef.current;
    if (!hub || !target || !compositor) return undefined;

    // Prop changes are an authority boundary, including transitions to an
    // empty/legacy page. Invalidate before changing the target island so a
    // late texture cannot resurrect a parked or superseded frame.
    hub.invalidatePendingProductRender();
    target.conceal();
    ownedDocumentIdsRef.current = [];

    const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const backingWidth = Math.max(1, Math.ceil(width * safeDpr));
    const backingHeight = Math.max(1, Math.ceil(height * safeDpr));
    if (
      !Number.isFinite(width)
      || !Number.isFinite(height)
      || width <= 0
      || height <= 0
      || backingWidth > STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingDimension
      || backingHeight > STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingDimension
      || backingWidth * backingHeight
        > STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingPixelArea
    ) {
      target.park();
      authoritySinkRef.current?.({
        status: "legacy",
        backendId: null,
        decision: null,
        reason: "explicit-vello-surface-limit",
        sceneRevision,
        ownedDocumentIds: [],
        visibleCanvasCount: 0,
      });
      return undefined;
    }

    const documentScene = lowerStudioElementsToRenderScene(elements, {
      width: Math.max(1, Math.round(documentWidth)),
      height: Math.max(1, Math.round(documentHeight)),
    });
    const presented = buildStudioDocumentPresentScene({
      elements,
      documentWidth,
      documentHeight,
      viewportWidth: width,
      viewportHeight: height,
      dpr: safeDpr,
      documentTransform,
    });
    ownedDocumentIdsRef.current = presented.ownedDocumentIds;

    if (presented.scene.nodes.length === 0) {
      target.park();
      const hasVisibleDocumentContent = elements.some((element) => (
        !element.hidden && (element.opacity ?? 1) > 0
      ));
      authoritySinkRef.current?.({
        status: hasVisibleDocumentContent ? "legacy" : "idle",
        backendId: null,
        decision: null,
        reason: hasVisibleDocumentContent ? "explicit-legacy-document-boundary" : null,
        sceneRevision,
        ownedDocumentIds: presented.ownedDocumentIds,
        visibleCanvasCount: 0,
      });
      return undefined;
    }

    target.setIsland({
      id: "document-frame-graph",
      scene: presented.scene,
      placement: { left: 0, top: 0, width, height, dpr: safeDpr },
      documentIds: presented.ownedDocumentIds,
    });
    const generation = generationRef.current;
    const renderGeneration = renderGenerationRef.current + 1;
    renderGenerationRef.current = renderGeneration;
    authoritySinkRef.current?.({
      status: "starting",
      backendId: null,
      decision: null,
      reason: null,
      sceneRevision,
      ownedDocumentIds: presented.ownedDocumentIds,
      visibleCanvasCount: 0,
    });
    void compositor.execute(hub, {
      document: documentScene,
      presentScene: presented.scene,
      ownedDocumentIds: presented.ownedDocumentIds,
      dpr: safeDpr,
      penDown: isPenDown?.() ?? false,
    }).then(
      (receipt) => {
        if (
          generation !== generationRef.current
          || renderGeneration !== renderGenerationRef.current
          || hubRef.current !== hub
        ) return;
        const last = receipt.velloReceipts.at(-1);
        lastPresentedSceneRevisionRef.current = sceneRevision;
        lastPresentedOwnedDocumentIdsRef.current = receipt.ownedDocumentIds;
        authoritySinkRef.current?.({
          status: "active",
          backendId: last?.backendId ?? null,
          decision: last?.decision ?? null,
          reason: null,
          sceneRevision,
          ownedDocumentIds: receipt.ownedDocumentIds,
          visibleCanvasCount: 1,
        });
      },
      (error: unknown) => {
        if (
          generation !== generationRef.current
          || renderGeneration !== renderGenerationRef.current
          || hubRef.current !== hub
        ) return;
        authoritySinkRef.current?.({
          status: "unavailable",
          backendId: null,
          decision: null,
          reason: error instanceof Error ? error.message : String(error),
          sceneRevision,
          ownedDocumentIds: presented.ownedDocumentIds,
          visibleCanvasCount: 0,
        });
      },
    );
    return () => {
      if (renderGenerationRef.current === renderGeneration) {
        renderGenerationRef.current += 1;
      }
      hub.invalidatePendingProductRender();
      target.conceal();
    };
  }, [
    capability.enabled,
    documentHeight,
    documentTransform,
    documentWidth,
    dpr,
    elements,
    height,
    isPenDown,
    sceneRevision,
    width,
  ]);

  return null;
}
