/**
 * Studio Layer Comps Manager (레이어 콤프)
 *
 * CLIP STUDIO PAINT Ver.3.0 & Ver.4.0 Parity:
 * - Layer Comps (레이어 표시 상태 세트):
 *   - Allows creators to capture and switch between different layer state combinations:
 *     - Visibility (표시 / 비표시)
 *     - Opacity (불투명도 0..100)
 *     - Blend Mode (합성 모드)
 *   - Use Cases in Webtoon Production:
 *     1. "선화 전용" (Lineart review)
 *     2. "밑색 버전" (Flat coloring guide)
 *     3. "대사 없음 클린본" (Clean art export for merchandise/posters)
 *     4. "야간/노을 조명 콤프" (Lighting mood variations)
 *   - Batch export planning: export each comp as an individual image.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface LayerCompStateItem {
  readonly layerId: string;
  readonly visible: boolean;
  readonly opacity: number; // 0..1
  readonly blendMode?: string;
}

export interface StudioLayerComp {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly layerStates: Readonly<Record<string, LayerCompStateItem>>;
  readonly notes?: string;
}

export interface StudioLayerLikeItem {
  readonly id: string;
  readonly visible: boolean;
  readonly opacity?: number;
  readonly blendMode?: string;
}

/**
 * Captures the current layer states into a new Layer Comp.
 */
export function captureLayerComp<T extends StudioLayerLikeItem>(
  name: string,
  layers: readonly T[],
  id?: string,
  nowMs = Date.now(),
): StudioLayerComp {
  const compId = id || `comp-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const states: Record<string, LayerCompStateItem> = {};

  for (const layer of layers) {
    states[layer.id] = Object.freeze({
      layerId: layer.id,
      visible: layer.visible,
      opacity: typeof layer.opacity === "number" ? layer.opacity : 1.0,
      blendMode: layer.blendMode,
    });
  }

  return Object.freeze({
    id: compId,
    name: name.trim() || "새 레이어 콤프",
    createdAt: nowMs,
    layerStates: Object.freeze(states),
  });
}

/**
 * Applies a Layer Comp to an array of layers, updating their visibility and opacity.
 */
export function applyLayerComp<T extends StudioLayerLikeItem>(
  layers: readonly T[],
  comp: StudioLayerComp,
): readonly T[] {
  return Object.freeze(
    layers.map((layer) => {
      const savedState = comp.layerStates[layer.id];
      if (!savedState) return layer;

      return Object.freeze({
        ...layer,
        visible: savedState.visible,
        opacity: savedState.opacity,
        ...(savedState.blendMode ? { blendMode: savedState.blendMode } : {}),
      }) as T;
    }),
  );
}

/**
 * Updates an existing Layer Comp with the current layer states.
 */
export function updateLayerCompWithCurrentLayers<T extends StudioLayerLikeItem>(
  comp: StudioLayerComp,
  layers: readonly T[],
): StudioLayerComp {
  const states: Record<string, LayerCompStateItem> = {};

  for (const layer of layers) {
    states[layer.id] = Object.freeze({
      layerId: layer.id,
      visible: layer.visible,
      opacity: typeof layer.opacity === "number" ? layer.opacity : 1.0,
      blendMode: layer.blendMode,
    });
  }

  return Object.freeze({
    ...comp,
    layerStates: Object.freeze(states),
  });
}

/**
 * Plans batch export jobs for a list of layer comps.
 */
export function planLayerCompsBatchExport(
  comps: readonly StudioLayerComp[],
  fileBaseName = "cut",
  format: "png" | "webp" = "png",
): readonly { readonly compId: string; readonly fileName: string; readonly compName: string }[] {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9가-힣_-]/gu, "_").trim();

  return Object.freeze(
    comps.map((c, index) => {
      const safeCompName = sanitize(c.name) || `comp_${index + 1}`;
      const fileName = `${fileBaseName}_${safeCompName}.${format}`;
      return Object.freeze({
        compId: c.id,
        fileName,
        compName: c.name,
      });
    }),
  );
}
