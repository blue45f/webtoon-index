import { useEffect, useMemo, useRef } from "react";

import { buildStudioPixiSelectableOverlaysForSelection } from "./studio-pixi-scene-host-admission";
import {
  createStudioVelloHub,
  lowerStudioSceneOverlaysToVelloIsland,
  resolveStudioVelloHubProductCapability,
  type StudioVelloHub,
  type StudioVelloHubBackendId,
  type StudioVelloHubDecision,
} from "./studio-vello-hub";
import {
  createStudioVelloHubCanvasTarget,
  type StudioVelloHubCanvasTarget,
} from "./studio-vello-hub-canvas-target";

import type { StudioPixiHostElementLike } from "./studio-pixi-scene-host-admission";
import type { StudioSceneDocumentTransform } from "../studio-scene-provider";

export type StudioVelloHubAuthorityStatus =
  | "disabled"
  | "idle"
  | "starting"
  | "active"
  | "unavailable";

export interface StudioVelloHubAuthority {
  readonly status: StudioVelloHubAuthorityStatus;
  readonly backendId: StudioVelloHubBackendId | null;
  readonly decision: StudioVelloHubDecision | null;
  readonly reason: string | null;
}

export interface StudioVelloHubSurfaceProps {
  readonly enabled?: boolean;
  readonly mountParent: HTMLElement | null;
  readonly width: number;
  readonly height: number;
  readonly dpr?: number;
  readonly elements: readonly StudioPixiHostElementLike[];
  readonly selectedIds: readonly string[];
  readonly documentTransform?: StudioSceneDocumentTransform;
  readonly documentWidth?: number;
  readonly documentHeight?: number;
  /** Reads the live pointer session; a ref snapshot is insufficient during async rendering. */
  readonly isPenDown?: () => boolean;
  readonly onAuthorityChange?: (authority: StudioVelloHubAuthority) => void;
}

const DISABLED_AUTHORITY: StudioVelloHubAuthority = Object.freeze({
  status: "disabled",
  backendId: null,
  decision: null,
  reason: "product capability disabled",
});

/** Product host mounted from StudioCanvasViewport on the existing /studio path. */
export function StudioVelloHubSurface({
  enabled,
  mountParent,
  width,
  height,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  elements,
  selectedIds,
  documentTransform,
  documentWidth,
  documentHeight,
  isPenDown,
  onAuthorityChange,
}: StudioVelloHubSurfaceProps) {
  const authoritySinkRef = useRef(onAuthorityChange);
  authoritySinkRef.current = onAuthorityChange;
  const hubRef = useRef<StudioVelloHub | null>(null);
  const targetRef = useRef<StudioVelloHubCanvasTarget | null>(null);
  const generationRef = useRef(0);
  const renderGenerationRef = useRef(0);
  const capability = resolveStudioVelloHubProductCapability({ enabled });

  const overlays = useMemo(
    () => buildStudioPixiSelectableOverlaysForSelection(elements, selectedIds, {
      documentWidth,
      documentHeight,
    }),
    [documentHeight, documentWidth, elements, selectedIds],
  );
  const admission = useMemo(
    () => lowerStudioSceneOverlaysToVelloIsland(overlays, {
      width,
      height,
      dpr,
      ...(documentTransform ? { documentTransform } : {}),
    }),
    [documentTransform, dpr, height, overlays, width],
  );
  const admitted = admission.admitted;
  const admissionReason = admission.admitted ? null : admission.reason;

  useEffect(() => {
    if (!capability.enabled) {
      authoritySinkRef.current?.(DISABLED_AUTHORITY);
      return undefined;
    }
    if (!admitted) {
      authoritySinkRef.current?.({
        status: admissionReason === "empty-island" ? "idle" : "unavailable",
        backendId: null,
        decision: null,
        reason: admissionReason,
      });
      return undefined;
    }
    if (!mountParent) {
      authoritySinkRef.current?.({
        status: "starting",
        backendId: null,
        decision: null,
        reason: "awaiting-canvas-mount",
      });
      return undefined;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const target = createStudioVelloHubCanvasTarget(
      mountParent.ownerDocument,
      mountParent,
    );
    let hub: StudioVelloHub | null = null;
    const markUnavailable = (reason: string) => {
      if (generationRef.current !== generation) return;
      renderGenerationRef.current += 1;
      authoritySinkRef.current?.({
        status: "unavailable",
        backendId: null,
        decision: null,
        reason,
      });
    };
    hub = createStudioVelloHub({
      target,
      isPenDown,
      onUnavailable(failure) {
        markUnavailable(
          `${failure.source}:${failure.reason}`,
        );
      },
    });
    targetRef.current = target;
    hubRef.current = hub;
    authoritySinkRef.current?.({
      status: "starting",
      backendId: null,
      decision: null,
      reason: null,
    });

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      renderGenerationRef.current += 1;
      if (hubRef.current === hub) hubRef.current = null;
      if (targetRef.current === target) targetRef.current = null;
      hub.dispose();
      target.destroy();
    };
  }, [admissionReason, admitted, capability.enabled, isPenDown, mountParent]);

  useEffect(() => {
    if (!capability.enabled || !admission.admitted) return;
    const hub = hubRef.current;
    const target = targetRef.current;
    if (!hub || !target) return;
    const generation = generationRef.current;
    const renderGeneration = renderGenerationRef.current + 1;
    renderGenerationRef.current = renderGeneration;
    target.setIsland(admission.island);
    void hub.render(admission.island.scene, { penDown: isPenDown?.() ?? false }).then(
      (receipt) => {
        if (
          generation !== generationRef.current
          || renderGeneration !== renderGenerationRef.current
          || hubRef.current !== hub
        ) return;
        authoritySinkRef.current?.({
          status: "active",
          backendId: receipt.backendId,
          decision: receipt.decision,
          reason: null,
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
        });
      },
    );
    return () => {
      if (renderGenerationRef.current === renderGeneration) {
        renderGenerationRef.current += 1;
      }
    };
  }, [admission, capability.enabled, isPenDown]);

  return null;
}
