/**
 * Semantic "Select all with same…" keys for Studio elements.
 *
 * Never compare the whole document object. Geometry, authored text, locks, AI provenance, raster
 * receipts and runtime caches are intentionally outside these keys: they are not the property the
 * artist asked to match, and some carry megabytes of immutable source data. Each criterion uses a
 * small renderer-facing allow-list so matching remains deterministic as the document schema grows.
 */
import type { El } from "./studio-element-model";

export type StudioSelectMatchingCriterion =
  | "type"
  | "paint"
  | "typography"
  | "source";

export interface StudioSelectMatchingOption {
  readonly criterion: StudioSelectMatchingCriterion;
  readonly label: string;
  readonly description: string;
  /** Includes the current source element. Options with fewer than two matches are omitted. */
  readonly count: number;
}

const ELEMENT_TYPE_LABELS: Record<El["type"], string> = {
  image: "이미지",
  text: "텍스트",
  bubble: "말풍선",
  sticker: "스티커",
  draw: "선화",
  frame: "프레임",
  focusLines: "집중선",
  speedLines: "스피드라인",
};

function normalizeColor(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function stableValue(value: unknown, depth = 0): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "non-finite";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (depth >= 8) return "[depth-limit]";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValue(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(source[key], depth + 1)}`)
      .join(",")}}`;
  }
  return typeof value;
}

function compositeKey(element: El): readonly unknown[] {
  return [element.opacity ?? 1, element.blendMode ?? "source-over"];
}

function drawFillKey(element: Extract<El, { type: "draw" }>): readonly unknown[] {
  // The renderer's precedence is pattern > gradient > solid. Ignore stale lower-priority values so
  // two visually identical strokes still match after switching fill modes back and forth.
  if (element.pattern) return ["pattern", element.pattern];
  if (element.gradient) return ["gradient", element.gradient];
  return ["solid", normalizeColor(element.fill)];
}

function textFillKey(element: Extract<El, { type: "text" }>): readonly unknown[] {
  if (element.gradient) return ["gradient", element.gradient];
  if (element.fillType === "gradient") {
    return [
      "legacy-gradient",
      normalizeColor(element.gradientColorStart),
      normalizeColor(element.gradientColorEnd),
      element.gradientDirection ?? null,
    ];
  }
  return ["solid", normalizeColor(element.fill)];
}

function bubbleFillKey(element: Extract<El, { type: "bubble" }>): readonly unknown[] {
  return element.gradient
    ? ["gradient", element.gradient]
    : ["solid", normalizeColor(element.fill)];
}

function paintKey(element: El): string | null {
  switch (element.type) {
    case "draw":
      return stableValue([
        element.type,
        element.kind ?? "freehand",
        element.mode ?? "pen",
        element.brushCatalogId ?? null,
        element.brush ?? null,
        normalizeColor(element.stroke),
        element.strokeWidth,
        compositeKey(element),
        drawFillKey(element),
        element.strokeStyle ?? null,
        element.shapeParams ?? null,
        element.sketch ?? null,
        element.paintModel ?? null,
        element.brushDynamics ?? null,
        element.brushEnginePrograms ?? null,
        element.brushTip ?? null,
        element.stamp ?? null,
        element.pressureModel ?? null,
        element.paperModel ?? null,
        element.outlineStroke ?? null,
        element.materialPressureModel ?? null,
        element.materialMinimumDiameterRatio ?? null,
        element.stampPipeline ?? null,
        element.watercolorPipeline ?? null,
      ]);
    case "text":
      return stableValue([
        element.type,
        textFillKey(element),
        normalizeColor(element.stroke),
        element.strokeWidth ?? 0,
        normalizeColor(element.shadowColor),
        element.shadowBlur ?? 0,
        element.shadowOffsetX ?? 0,
        element.shadowOffsetY ?? 0,
        element.shadowOpacity ?? 0,
        compositeKey(element),
      ]);
    case "bubble":
      return stableValue([
        element.type,
        element.variant,
        bubbleFillKey(element),
        normalizeColor(element.textFill),
        normalizeColor(element.stroke),
        element.strokeWidth ?? 0,
        element.strokeStyle ?? null,
        element.outlineStyle ?? null,
        normalizeColor(element.shadowColor),
        element.shadowBlur ?? 0,
        element.shadowOffsetX ?? 0,
        element.shadowOffsetY ?? 0,
        element.shadowOpacity ?? 0,
        compositeKey(element),
      ]);
    case "frame":
      return stableValue([
        element.type,
        normalizeColor(element.bg ?? element.bgColor),
        normalizeColor(element.stroke),
        element.strokeWidth ?? 0,
        element.dashStyle ?? "solid",
        compositeKey(element),
      ]);
    case "focusLines":
      return stableValue([
        element.type,
        normalizeColor(element.stroke),
        element.strokeWidth,
        element.lineCount,
        element.innerRadius,
        element.outerRadius,
        element.noise,
        compositeKey(element),
      ]);
    case "speedLines":
      return stableValue([
        element.type,
        normalizeColor(element.stroke),
        element.strokeWidth,
        element.lineCount,
        element.direction,
        element.noise ?? 0,
        compositeKey(element),
      ]);
    case "image":
    case "sticker":
      return null;
  }
}

function typographyKey(element: El): string | null {
  switch (element.type) {
    case "text":
      return stableValue([
        element.type,
        element.font ?? null,
        element.fontSize,
        element.fontStyle ?? null,
        element.letterSpacing ?? null,
        element.lineHeight ?? null,
        element.vertical ?? false,
        element.align ?? null,
        element.textPath ?? null,
      ]);
    case "bubble":
      return stableValue([
        element.type,
        element.font ?? null,
        element.fontSize ?? null,
        element.fontStyle ?? null,
        element.lineHeight ?? null,
        element.vertical ?? false,
        element.align ?? null,
        element.autoShrinkText ?? false,
        element.autoShrinkMinFontSize ?? null,
      ]);
    case "sticker":
      return stableValue([element.type, element.fontSize]);
    case "image":
    case "draw":
    case "frame":
    case "focusLines":
    case "speedLines":
      return null;
  }
}

function sourceAvailable(element: El): boolean {
  switch (element.type) {
    case "image":
      return Boolean(element.builtinRasterAssetId || element.bg3dLtBundleId || element.src);
    case "draw":
      return Boolean(element.brushCatalogId || element.brush);
    case "text":
      return Boolean(element.stickyNotePresetId);
    case "bubble":
    case "sticker":
    case "frame":
    case "focusLines":
    case "speedLines":
      return false;
  }
}

function sameSource(source: El, candidate: El): boolean {
  if (source.type !== candidate.type) return false;
  switch (source.type) {
    case "image": {
      if (candidate.type !== "image") return false;
      const sourceStableId = source.builtinRasterAssetId
        ? `builtin:${source.builtinRasterAssetId}`
        : source.bg3dLtBundleId
          ? `bg3d-lt:${source.bg3dLtBundleId}`
          : null;
      const candidateStableId = candidate.builtinRasterAssetId
        ? `builtin:${candidate.builtinRasterAssetId}`
        : candidate.bg3dLtBundleId
          ? `bg3d-lt:${candidate.bg3dLtBundleId}`
          : null;
      if (sourceStableId || candidateStableId) return sourceStableId === candidateStableId;
      return source.src.length > 0 && source.src === candidate.src;
    }
    case "draw": {
      if (candidate.type !== "draw") return false;
      const sourceBrush = source.brushCatalogId
        ? `catalog:${source.brushCatalogId}`
        : source.brush
          ? `brush:${source.brush}`
          : null;
      const candidateBrush = candidate.brushCatalogId
        ? `catalog:${candidate.brushCatalogId}`
        : candidate.brush
          ? `brush:${candidate.brush}`
          : null;
      return sourceBrush !== null && sourceBrush === candidateBrush;
    }
    case "text":
      return candidate.type === "text"
        && Boolean(source.stickyNotePresetId)
        && source.stickyNotePresetId === candidate.stickyNotePresetId;
    case "bubble":
    case "sticker":
    case "frame":
    case "focusLines":
    case "speedLines":
      return false;
  }
}

type StudioElementMatcher = (candidate: El) => boolean;

/** Precompute the source key once; large pages should scale with candidates, not source key size. */
function createCriterionMatcher(
  source: El,
  criterion: StudioSelectMatchingCriterion,
): StudioElementMatcher {
  switch (criterion) {
    case "type":
      return (candidate) => source.type === candidate.type;
    case "paint": {
      const sourceKey = paintKey(source);
      return sourceKey === null
        ? () => false
        : (candidate) => sourceKey === paintKey(candidate);
    }
    case "typography": {
      const sourceKey = typographyKey(source);
      return sourceKey === null
        ? () => false
        : (candidate) => sourceKey === typographyKey(candidate);
    }
    case "source":
      return (candidate) => sameSource(source, candidate);
  }
}

function criterionLabel(
  source: El,
  criterion: StudioSelectMatchingCriterion,
): Pick<StudioSelectMatchingOption, "label" | "description"> {
  switch (criterion) {
    case "type":
      return {
        label: "같은 유형",
        description: `현재 페이지의 다른 ${ELEMENT_TYPE_LABELS[source.type]} 요소를 함께 선택합니다.`,
      };
    case "paint":
      return {
        label:
          source.type === "draw"
            ? "같은 브러시·선"
            : source.type === "bubble"
              ? "같은 말풍선 외형"
              : source.type === "frame"
                ? "같은 프레임 외형"
                : "같은 외형",
        description: "채우기·선·효과처럼 화면에 그려지는 공통 외형이 같은 요소를 선택합니다.",
      };
    case "typography":
      return {
        label: "같은 글꼴·조판",
        description: "글꼴·크기·행간·방향·정렬이 같은 레터링을 선택합니다.",
      };
    case "source":
      return {
        label: source.type === "draw" ? "같은 브러시 원본" : "같은 원본",
        description: "같은 에셋 또는 브러시 카탈로그 원본에서 만들어진 요소를 선택합니다.",
      };
  }
}

function availableCriteria(source: El): StudioSelectMatchingCriterion[] {
  const criteria: StudioSelectMatchingCriterion[] = [];
  if (sourceAvailable(source)) criteria.push("source");
  if (paintKey(source) !== null) criteria.push("paint");
  if (typographyKey(source) !== null) criteria.push("typography");
  criteria.push("type");
  return criteria;
}

/** Resolve only useful actions (the source plus at least one other matching element). */
export function resolveStudioSelectMatchingOptions(
  elements: readonly El[],
  sourceId: string,
): StudioSelectMatchingOption[] {
  const source = elements.find((element) => element.id === sourceId);
  if (!source) return [];
  return availableCriteria(source).flatMap((criterion) => {
    const matches = createCriterionMatcher(source, criterion);
    const count = elements.filter(matches).length;
    if (count < 2) return [];
    return [{ criterion, count, ...criterionLabel(source, criterion) }];
  });
}

/** IDs are returned in document z-order, ready for the authoritative navigator selection adapter. */
export function selectStudioMatchingElementIds(
  elements: readonly El[],
  sourceId: string,
  criterion: StudioSelectMatchingCriterion,
): string[] {
  const source = elements.find((element) => element.id === sourceId);
  if (!source) return [];
  const matches = createCriterionMatcher(source, criterion);
  return elements.filter(matches).map((candidate) => candidate.id);
}
