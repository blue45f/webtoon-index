/**
 * Commercial layer-palette visual grammar.
 *
 * This module intentionally accepts only a structural projection so the layer palette can classify
 * imported, raster, vector and 3D-backed layers without importing the full Studio document model.
 */

export const STUDIO_LAYER_SEMANTIC_KINDS = [
  "raster",
  "vector",
  "text",
  "bubble",
  "three-d",
  "frame",
  "asset",
  "effect",
  "other",
] as const;

export type StudioLayerSemanticKind =
  (typeof STUDIO_LAYER_SEMANTIC_KINDS)[number];

export const STUDIO_LAYER_SEMANTIC_KIND_LABELS: Record<
  StudioLayerSemanticKind,
  string
> = {
  raster: "래스터",
  vector: "벡터",
  text: "텍스트",
  bubble: "말풍선",
  "three-d": "3D",
  frame: "컷",
  asset: "소재",
  effect: "효과",
  other: "기타",
};

export const STUDIO_LAYER_SEMANTIC_KIND_CLASSES: Record<
  StudioLayerSemanticKind,
  string
> = {
  raster: "border-cool/30 bg-cool/10 text-cool",
  vector: "border-accent/35 bg-accent-soft/45 text-accent",
  text: "border-line-strong bg-raised text-fg-2",
  bubble: "border-good/30 bg-good/10 text-good",
  "three-d": "border-[oklch(0.68_0.16_312/0.35)] bg-[oklch(0.68_0.16_312/0.1)] text-[oklch(0.76_0.13_312)]",
  frame: "border-line-strong bg-card text-fg-2",
  asset: "border-warning/30 bg-warning/10 text-warning",
  effect: "border-accent/35 bg-accent-soft/45 text-accent",
  other: "border-line bg-card text-fg-3",
};

export interface StudioLayerSemanticKindInput {
  readonly type?: string;
  /**
   * Explicit semantic projection for content whose document type is not sufficiently specific.
   * In particular, Studio 3D and VRM render layers currently persist as `type: "image"`.
   */
  readonly semanticKind?: StudioLayerSemanticKind;
}

export function resolveStudioLayerSemanticKind(
  item: StudioLayerSemanticKindInput
): StudioLayerSemanticKind {
  if (
    item.semanticKind
    && STUDIO_LAYER_SEMANTIC_KINDS.includes(item.semanticKind)
  ) {
    return item.semanticKind;
  }
  switch (item.type) {
    case "image":
      return "raster";
    case "draw":
      return "vector";
    case "text":
      return "text";
    case "bubble":
      return "bubble";
    case "frame":
      return "frame";
    case "sticker":
      return "asset";
    case "focusLines":
    case "speedLines":
      return "effect";
    default:
      return "other";
  }
}

export type StudioLayerPaletteStatusKind =
  | "local-hidden"
  | "hidden"
  | "locked"
  | "reference"
  | "mask"
  | "mask-disabled"
  | "clipping"
  | "alpha-locked"
  | "ai"
  | "animated";

export interface StudioLayerPaletteStatus {
  readonly kind: StudioLayerPaletteStatusKind;
  readonly label: string;
}

export interface StudioLayerPaletteStatusInput {
  readonly effectivelyHidden?: boolean;
  readonly locallyHidden?: boolean;
  readonly effectivelyLocked?: boolean;
  readonly fillReference?: boolean;
  readonly masked?: boolean;
  readonly maskEnabled?: boolean;
  readonly clipBelow?: boolean;
  readonly alphaLocked?: boolean;
  readonly aiGenerated?: boolean;
  readonly animated?: boolean;
}

/**
 * Returns the status order used by the dense row. The five most important drawing-safety states
 * come first so a bounded icon strip never hides visibility, lock, reference, mask or clipping.
 */
export function buildStudioLayerPaletteStatuses(
  input: StudioLayerPaletteStatusInput
): readonly StudioLayerPaletteStatus[] {
  const statuses: StudioLayerPaletteStatus[] = [];
  if (input.locallyHidden) {
    statuses.push({ kind: "local-hidden", label: "이 기기에서만 숨김" });
  } else if (input.effectivelyHidden) {
    statuses.push({ kind: "hidden", label: "숨김" });
  }
  if (input.effectivelyLocked) {
    statuses.push({ kind: "locked", label: "잠김" });
  }
  if (input.fillReference) {
    statuses.push({ kind: "reference", label: "채우기 참조 레이어" });
  }
  if (input.masked) {
    statuses.push({
      kind: input.maskEnabled === false ? "mask-disabled" : "mask",
      label: input.maskEnabled === false ? "레이어 마스크 꺼짐" : "레이어 마스크",
    });
  }
  if (input.clipBelow) {
    statuses.push({ kind: "clipping", label: "아래 레이어에 클리핑" });
  }
  if (input.alphaLocked) {
    statuses.push({ kind: "alpha-locked", label: "투명 픽셀 잠금" });
  }
  if (input.aiGenerated) {
    statuses.push({ kind: "ai", label: "AI 작업 포함" });
  }
  if (input.animated) {
    statuses.push({ kind: "animated", label: "애니메이션 레이어" });
  }
  return statuses;
}

/**
 * Rows reserve a bounded five-icon strip. Core drawing-safety states are already ordered first;
 * this projection keeps the layout stable while the row's accessible name still exposes all state.
 */
export function visibleStudioLayerPaletteStatuses(
  statuses: readonly StudioLayerPaletteStatus[],
  maximum = 5
): {
  readonly visible: readonly StudioLayerPaletteStatus[];
  readonly hiddenCount: number;
} {
  const cap = Number.isFinite(maximum)
    ? Math.max(1, Math.min(8, Math.floor(maximum)))
    : 1;
  return {
    visible: statuses.slice(0, cap),
    hiddenCount: Math.max(0, statuses.length - cap),
  };
}
