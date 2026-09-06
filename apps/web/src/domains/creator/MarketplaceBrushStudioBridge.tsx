import { useEffect, useRef, type ReactElement } from "react";

import {
  MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT,
  MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT,
  MarketplaceBrushPublishShortcut,
} from "./MarketplaceBrushPublishShortcut";

import {
  loadCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
} from "@/shared/lib/creator-marketplace-authoring-workshop";


export const MARKETPLACE_BRUSH_STUDIO_IMPORT_EVENT =
  "toonspectrum:brush-studio-market-import";
export const MARKETPLACE_BRUSH_STUDIO_IMPORT_STORAGE_KEY =
  "toonspectrum:brush-studio-market-import:v2";

export interface MarketplaceBrushStudioBridgeProps {
  /** Exact normalized snapshot rendered by the open Brush Studio. */
  snapshot?: unknown;
  /** Keep the event bridge mounted, but only show the publish action inside Brush Studio. */
  visible?: boolean;
}

function snapshotFromDraft(draft: CreatorMarketplaceAuthoringDraft | null): unknown {
  if (!draft || draft.kind !== "brush") return null;
  return draft.brush.originalSnapshot
    ?? draft.source.studioSnapshot
    ?? {
      name: draft.title,
      description: draft.description,
      tags: draft.tags,
      seed: draft.brush.deterministicSeed,
      presetFamily: draft.brush.presetFamily,
      enginePrograms: draft.brush.originalEnginePrograms,
      engineGraph: draft.brush.engineNodes,
    };
}

function shouldLoadMarketplaceDraft(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("marketAuthoring")
    || params.has("marketResource")
    || params.get("assetKind") === "brush";
}

export function MarketplaceBrushStudioBridge({
  snapshot = null,
  visible = false,
}: MarketplaceBrushStudioBridgeProps): ReactElement | null {
  const latestSnapshotRef = useRef<unknown>(snapshot);

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (shouldLoadMarketplaceDraft()) {
      const draft = loadCreatorMarketplaceAuthoringDraft();
      const importedSnapshot = snapshotFromDraft(draft);
      if (importedSnapshot !== null) {
        latestSnapshotRef.current = importedSnapshot;
        try {
          window.sessionStorage.setItem(
            MARKETPLACE_BRUSH_STUDIO_IMPORT_STORAGE_KEY,
            JSON.stringify(importedSnapshot),
          );
        } catch {
          // Event delivery remains available when session storage is blocked.
        }
        window.dispatchEvent(new CustomEvent(MARKETPLACE_BRUSH_STUDIO_IMPORT_EVENT, {
          detail: { snapshot: importedSnapshot, resumeToken: draft?.resumeToken ?? null },
        }));
      }
    }

    const respond = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { requestId?: unknown } | null;
      if (!detail || typeof detail.requestId !== "string") return;
      window.dispatchEvent(new CustomEvent(MARKETPLACE_BRUSH_SNAPSHOT_RESPONSE_EVENT, {
        detail: {
          requestId: detail.requestId,
          snapshot: latestSnapshotRef.current,
        },
      }));
    };
    const capture = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { snapshot?: unknown } | null;
      if (detail?.snapshot !== undefined) latestSnapshotRef.current = detail.snapshot;
    };

    window.addEventListener(MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT, respond as EventListener);
    window.addEventListener(MARKETPLACE_BRUSH_STUDIO_IMPORT_EVENT, capture as EventListener);
    return () => {
      window.removeEventListener(MARKETPLACE_BRUSH_SNAPSHOT_REQUEST_EVENT, respond as EventListener);
      window.removeEventListener(MARKETPLACE_BRUSH_STUDIO_IMPORT_EVENT, capture as EventListener);
    };
  }, []);

  if (!visible) return null;
  return <MarketplaceBrushPublishShortcut snapshotProvider={() => latestSnapshotRef.current} />;
}
