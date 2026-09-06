/**
 * Always-on Pixi selectable-scene overlay host.
 *
 * Mounts a dedicated transparent, pointer-inactive Pixi canvas above the Konva
 * stage. Syncs document selection bounds into Pixi; never owns brush pixels or
 * hit-test authority (pointer-events: none).
 *
 * Surface economics (measured, see docs/perf/canvas-findings.md §7-1): the Pixi
 * canvas is sized to the *stage*, so at 500% zoom it is a 4620x6930 WebGL
 * framebuffer — one quarter of the editor's whole raster budget. Wheel-zoom
 * settle time is linear in total canvas backing-store area, so an overlay that
 * has nothing to present must not hold that surface. Two rules follow:
 *
 *   1. The renderer is only created once there is at least one selectable
 *      overlay to draw. With an empty selection the overlay renders nothing, so
 *      not allocating it is pixel-identical and frees the framebuffer.
 *   2. Stage geometry changes resize the live renderer; they must never destroy
 *      and rebuild it. Recreating tore down a WebGL context and re-ran the lazy
 *      pixi.js import on every zoom notch and every panel resize.
 */

import { useEffect, useMemo, useRef } from "react";

import {
  buildStudioPixiSelectableOverlaysForSelection,
  planStudioPixiOverlaySync,
  studioPixiSceneHostIsAlwaysOn,
  type StudioPixiHostElementLike,
} from "./render/studio-pixi-scene-host-admission";
import {
  createStudioPixiSceneProvider,
} from "./render/studio-pixi-scene-provider";

import type {
  StudioSceneDocumentTransform,
  StudioSceneProvider,
  StudioSceneSelectableOverlay,
} from "./studio-scene-provider";

export interface StudioPixiSceneOverlayHostProps {
  readonly enabled?: boolean;
  /** Stage host that already has `position: relative` (e.g. Konva stage wrap). */
  readonly mountParent: HTMLElement | null;
  readonly width: number;
  readonly height: number;
  readonly dpr?: number;
  readonly elements: readonly StudioPixiHostElementLike[];
  readonly selectedIds: readonly string[];
  /**
   * Document → surface placement, mirroring the Konva stage. Overlay geometry is authored in
   * document units, so without this the chrome only lands correctly at 100% zoom.
   */
  readonly documentTransform?: StudioSceneDocumentTransform;
  /** Page box; a selection that covers it is a tool composite, not artist-authored chrome. */
  readonly documentWidth?: number;
  readonly documentHeight?: number;
}

export function StudioPixiSceneOverlayHost({
  enabled = studioPixiSceneHostIsAlwaysOn(),
  mountParent,
  width,
  height,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  elements,
  selectedIds,
  documentTransform,
  documentWidth,
  documentHeight,
}: StudioPixiSceneOverlayHostProps) {
  const providerRef = useRef<StudioSceneProvider | null>(null);
  const trackedIdsRef = useRef<string[]>([]);
  const generationRef = useRef(0);

  const overlays = useMemo(
    () =>
      buildStudioPixiSelectableOverlaysForSelection(elements, selectedIds, {
        documentWidth,
        documentHeight,
      }),
    [elements, selectedIds, documentWidth, documentHeight],
  );
  /** Nothing selected means nothing is drawn; the surface is pure cost. */
  const presentable = overlays.length > 0;

  // Geometry is read through refs inside the lifecycle effect so a stage resize
  // never re-runs it. Resizing is the separate effect below.
  const geometryRef = useRef({ width, height, dpr, documentTransform });
  geometryRef.current = { width, height, dpr, documentTransform };
  const overlaysRef = useRef<readonly StudioSceneSelectableOverlay[]>(overlays);
  overlaysRef.current = overlays;

  // Create / destroy provider for the presentable lifecycle.
  useEffect(() => {
    if (!enabled || !mountParent || !presentable) return;
    const initial = geometryRef.current;
    if (initial.width <= 0 || initial.height <= 0) return;

    let cancelled = false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    void (async () => {
      try {
        const provider = await createStudioPixiSceneProvider({
          renderer: "webgpu",
          width: initial.width,
          height: initial.height,
          dpr: Math.max(1, Math.min(3, initial.dpr)),
          ...(initial.documentTransform
            ? { documentTransform: initial.documentTransform }
            : {}),
          ownerDocument: mountParent.ownerDocument,
        });
        if (cancelled || generation !== generationRef.current) {
          provider.destroy();
          return;
        }
        const canvas = provider.canvas;
        canvas.style.zIndex = "18";
        mountParent.appendChild(canvas);
        providerRef.current = provider;
        // Creation is async, so the selection that asked for this surface has
        // already been through the sync effect below. Seed it here or the first
        // selection after a cold start would present an empty overlay.
        const current = geometryRef.current;
        if (
          current.width !== initial.width
          || current.height !== initial.height
          || current.documentTransform !== initial.documentTransform
        ) {
          provider.resize({
            width: current.width,
            height: current.height,
            dpr: Math.max(1, Math.min(3, current.dpr)),
            ...(current.documentTransform
              ? { documentTransform: current.documentTransform }
              : {}),
          });
        }
        for (const overlay of overlaysRef.current) provider.upsertSelectableOverlay(overlay);
        trackedIdsRef.current = overlaysRef.current.map((overlay) => overlay.documentId);
        provider.render();
      } catch {
        // Headless / no GPU: leave Konva overlays as sole selection chrome.
        providerRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      generationRef.current += 1;
      const provider = providerRef.current;
      providerRef.current = null;
      trackedIdsRef.current = [];
      if (provider) {
        try {
          provider.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled, mountParent, presentable]);

  // Sync selection overlays every selection/layout change.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || provider.destroyed) return;

    const plan = planStudioPixiOverlaySync(trackedIdsRef.current, overlays);
    for (const id of plan.removeIds) {
      provider.removeSelectableOverlay(id);
    }
    for (const overlay of plan.upsert) {
      provider.upsertSelectableOverlay(overlay);
    }
    trackedIdsRef.current = overlays.map((overlay) => overlay.documentId);
    provider.render();
  }, [overlays]);

  // Resize / re-place when stage metrics change, without remounting the provider. The document
  // transform rides along: zoom, flip and rotation change the placement, never the geometry.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || provider.destroyed) return;
    if (width <= 0 || height <= 0) return;
    try {
      provider.resize({
        width,
        height,
        dpr: Math.max(1, Math.min(3, dpr)),
        ...(documentTransform ? { documentTransform } : {}),
      });
      provider.render();
    } catch {
      /* provider may be mid-destroy */
    }
  }, [width, height, dpr, documentTransform]);

  return null;
}
