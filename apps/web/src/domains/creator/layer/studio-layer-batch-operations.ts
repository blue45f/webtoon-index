/**
 * Studio Layer Batch Operations: Draft Layer Batch Hide/Restore & Multi-Layer Tonal Correction
 *
 * CLIP STUDIO PAINT Ver.5.0.0 Parity:
 * 1. Draft Layers Batch Hide / Restore (모든 초안 레이어 일괄 숨김·복원):
 *    - In professional webtoon workflows, rough sketch / storyboard layers are marked as "Draft".
 *    - Allows one-click hiding of all draft layers during inking/coloring/review,
 *      and one-click restoration to previous visibility states.
 *    - Guards export pipelines so draft layers are never leaked into the final publication.
 * 2. Multi-Layer Simultaneous Tonal Correction (여러 레이어에 톤 보정 동시 적용):
 *    - Applies brightness/contrast, hue/saturation, levels, or tone curve corrections
 *      across multiple selected layers in a single atomic transaction.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface StudioLayerModelItem {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly isDraft?: boolean;
  readonly opacity?: number; // 0..1
  readonly brightness?: number; // -100..100
  readonly contrast?: number; // -100..100
  readonly hue?: number; // -180..180
  readonly saturation?: number; // -100..100
  readonly levels?: {
    readonly blackPoint: number; // 0..255
    readonly whitePoint: number; // 0..255
    readonly gamma: number; // 0.1..10.0
  };
}

export interface DraftLayersVisibilitySnapshot {
  readonly timestamp: number;
  readonly visibilityMap: Readonly<Record<string, boolean>>;
}

/**
 * Marks or unmarks a layer as a Draft Layer.
 */
export function setLayerDraftStatus<T extends StudioLayerModelItem>(
  layer: T,
  isDraft: boolean,
): T {
  return Object.freeze({
    ...layer,
    isDraft,
  });
}

/**
 * Batch hides all draft layers, capturing a snapshot of their prior visibility states for restoration.
 */
export function batchHideAllDraftLayers<T extends StudioLayerModelItem>(
  layers: readonly T[],
): {
  readonly updatedLayers: readonly T[];
  readonly snapshot: DraftLayersVisibilitySnapshot;
  readonly affectedCount: number;
} {
  const visibilityMap: Record<string, boolean> = {};
  let affectedCount = 0;

  const updatedLayers = layers.map((layer) => {
    if (layer.isDraft) {
      visibilityMap[layer.id] = layer.visible;
      if (layer.visible) {
        affectedCount += 1;
        return Object.freeze({ ...layer, visible: false }) as T;
      }
    }
    return layer;
  });

  return Object.freeze({
    updatedLayers: Object.freeze(updatedLayers),
    snapshot: Object.freeze({
      timestamp: Date.now(),
      visibilityMap: Object.freeze(visibilityMap),
    }),
    affectedCount,
  });
}

/**
 * Restores visibility of all draft layers from a prior snapshot.
 */
export function batchRestoreAllDraftLayers<T extends StudioLayerModelItem>(
  layers: readonly T[],
  snapshot?: DraftLayersVisibilitySnapshot | null,
): readonly T[] {
  if (!snapshot) {
    // If no snapshot provided, show all draft layers by default
    return Object.freeze(
      layers.map((layer) =>
        layer.isDraft && !layer.visible
          ? (Object.freeze({ ...layer, visible: true }) as T)
          : layer,
      ),
    );
  }

  return Object.freeze(
    layers.map((layer) => {
      if (layer.isDraft && layer.id in snapshot.visibilityMap) {
        const priorVisible = snapshot.visibilityMap[layer.id];
        if (layer.visible !== priorVisible) {
          return Object.freeze({ ...layer, visible: priorVisible }) as T;
        }
      }
      return layer;
    }),
  );
}

/**
 * Determines whether a layer should be rendered into a production export.
 */
export function shouldIncludeLayerInExport(
  layer: StudioLayerModelItem,
  includeDrafts = false,
): boolean {
  if (!layer.visible) return false;
  if (layer.isDraft && !includeDrafts) return false;
  return true;
}

// ── Multi-Layer Simultaneous Tonal Correction ─────────────────────────────

export type StudioTonalCorrection =
  | {
      readonly kind: "brightnessContrast";
      readonly brightness: number; // -100..100
      readonly contrast: number; // -100..100
    }
  | {
      readonly kind: "hueSaturation";
      readonly hue: number; // -180..180
      readonly saturation: number; // -100..100
    }
  | {
      readonly kind: "levels";
      readonly blackPoint: number; // 0..255
      readonly whitePoint: number; // 0..255
      readonly gamma: number; // 0.1..10.0
    };

/**
 * Applies a tonal correction adjustment simultaneously to multiple selected layers.
 */
export function applyTonalCorrectionToMultipleLayers<T extends StudioLayerModelItem>(
  layers: readonly T[],
  targetLayerIds: readonly string[],
  correction: StudioTonalCorrection,
): {
  readonly updatedLayers: readonly T[];
  readonly affectedCount: number;
} {
  const targetSet = new Set(targetLayerIds);
  let affectedCount = 0;

  const updatedLayers = layers.map((layer) => {
    if (!targetSet.has(layer.id)) return layer;

    affectedCount += 1;
    let patch: Partial<StudioLayerModelItem> = {};

    switch (correction.kind) {
      case "brightnessContrast":
        patch = {
          brightness: Math.max(-100, Math.min(100, correction.brightness)),
          contrast: Math.max(-100, Math.min(100, correction.contrast)),
        };
        break;
      case "hueSaturation":
        patch = {
          hue: Math.max(-180, Math.min(180, correction.hue)),
          saturation: Math.max(-100, Math.min(100, correction.saturation)),
        };
        break;
      case "levels":
        patch = {
          levels: {
            blackPoint: Math.max(0, Math.min(255, correction.blackPoint)),
            whitePoint: Math.max(0, Math.min(255, correction.whitePoint)),
            gamma: Math.max(0.1, Math.min(10.0, correction.gamma)),
          },
        };
        break;
    }

    return Object.freeze({ ...layer, ...patch }) as T;
  });

  return Object.freeze({
    updatedLayers: Object.freeze(updatedLayers),
    affectedCount,
  });
}
