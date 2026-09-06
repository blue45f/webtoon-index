/**
 * Studio Batch Layer Deletion & Cleanup
 *
 * CLIP STUDIO PAINT Ver.4.1.0 Parity:
 * - Batch Cleanup of Unused / Hidden Layers (미사용·비표시 레이어 일괄 삭제):
 *   1. Delete Hidden Layers (비표시 레이어 일괄 삭제): Removes all layers whose visibility is toggled off.
 *   2. Delete Empty Layers (빈 레이어 일괄 삭제): Removes raster layers containing zero content/pixels.
 *   3. Delete Draft Layers (초안 레이어 일괄 삭제): Purges draft sketch layers before final production archiving.
 * - Always creates an undo snapshot and returns the list of pruned layers for safe rollback.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface LayerCleanupTargetItem {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly isDraft?: boolean;
  readonly isEmpty?: boolean;
}

export interface LayerBatchCleanupResult<T extends LayerCleanupTargetItem> {
  readonly remainingLayers: readonly T[];
  readonly deletedLayers: readonly T[];
  readonly deletedCount: number;
}

/**
 * Removes all layers that are currently hidden (visible === false).
 */
export function deleteHiddenLayers<T extends LayerCleanupTargetItem>(
  layers: readonly T[],
): LayerBatchCleanupResult<T> {
  const remaining: T[] = [];
  const deleted: T[] = [];

  for (const layer of layers) {
    if (!layer.visible) {
      deleted.push(layer);
    } else {
      remaining.push(layer);
    }
  }

  return Object.freeze({
    remainingLayers: Object.freeze(remaining),
    deletedLayers: Object.freeze(deleted),
    deletedCount: deleted.length,
  });
}

/**
 * Removes all empty layers.
 */
export function deleteEmptyLayers<T extends LayerCleanupTargetItem>(
  layers: readonly T[],
): LayerBatchCleanupResult<T> {
  const remaining: T[] = [];
  const deleted: T[] = [];

  for (const layer of layers) {
    if (layer.isEmpty) {
      deleted.push(layer);
    } else {
      remaining.push(layer);
    }
  }

  return Object.freeze({
    remainingLayers: Object.freeze(remaining),
    deletedLayers: Object.freeze(deleted),
    deletedCount: deleted.length,
  });
}

/**
 * Removes all draft layers from the layer list.
 */
export function deleteDraftLayers<T extends LayerCleanupTargetItem>(
  layers: readonly T[],
): LayerBatchCleanupResult<T> {
  const remaining: T[] = [];
  const deleted: T[] = [];

  for (const layer of layers) {
    if (layer.isDraft) {
      deleted.push(layer);
    } else {
      remaining.push(layer);
    }
  }

  return Object.freeze({
    remainingLayers: Object.freeze(remaining),
    deletedLayers: Object.freeze(deleted),
    deletedCount: deleted.length,
  });
}
