/**
 * Local, deterministic region-hint planner for line art.
 *
 * This is deliberately not a semantic-AI colorizer. It labels fillable regions separated by
 * visible ink, validates user-authored color hints, and returns an immutable-by-contract batch
 * description. It never writes pixels and is therefore safe to run before Advanced Fill applies
 * the approved component masks in a worker.
 */

import type {
  AdvancedFillBounds,
  AdvancedFillImageDataLike,
  AdvancedFillRgba,
} from "./studio-advanced-fill";

export const STUDIO_AUTO_COLOR_HINT_MAX_PIXELS = 8 * 1024 * 1024;
export const STUDIO_AUTO_COLOR_HINT_MAX_HINTS = 2_048;
export const STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS = 262_144;
export const STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS = 2_048;
export const STUDIO_AUTO_COLOR_HINT_MAX_RECOMMENDATIONS = 256;
export const STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH = 128;

const BOUNDARY_LABEL = 0xffff_ffff;

export type StudioAutoColorHintRgba = AdvancedFillRgba;
export type StudioAutoColorHintImageDataLike = AdvancedFillImageDataLike;
export type StudioAutoColorHintBounds = AdvancedFillBounds;
export type StudioAutoColorHintConnectivity = 4 | 8;

export interface StudioAutoColorHintSeed {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color: StudioAutoColorHintRgba;
}

export interface StudioAutoColorHintPaletteLock {
  /** Exact RGBA values allowed for every hint. An empty locked palette rejects every hint. */
  readonly colors: readonly StudioAutoColorHintRgba[];
}

export interface StudioAutoColorHintBudgets {
  /** Per-request limits may lower, but never raise, the hard safety limits exported above. */
  readonly maxPixels?: number;
  readonly maxHints?: number;
  readonly maxComponents?: number;
}

export interface StudioAutoColorHintRecommendationPolicy {
  /** Minimum area for every suggested component. */
  readonly minimumArea?: number;
  /** Additional minimum for components touching the canvas edge (treated as background). */
  readonly minimumBackgroundArea?: number;
  /** Additional minimum for components whose pixels are all transparent. */
  readonly minimumTransparentArea?: number;
  readonly maximumRecommendations?: number;
}

export interface StudioAutoColorHintOptions {
  /**
   * Minimum composited darkness that counts as boundary ink (1..255). For example, black at
   * alpha 32 has ink strength 32, while opaque white and fully transparent black both have 0.
   */
  readonly boundaryInkThreshold?: number;
  /** Alpha at or below this value is counted as transparent for recommendation policy. */
  readonly transparentAlphaThreshold?: number;
  readonly connectivity?: StudioAutoColorHintConnectivity;
  readonly budgets?: StudioAutoColorHintBudgets;
  readonly recommendations?: StudioAutoColorHintRecommendationPolicy;
}

export interface StudioAutoColorHintRequest {
  readonly image: StudioAutoColorHintImageDataLike;
  readonly seeds: readonly StudioAutoColorHintSeed[];
  readonly paletteLock?: StudioAutoColorHintPaletteLock;
  readonly options?: StudioAutoColorHintOptions;
}

export interface StudioAutoColorHintComponent {
  /** Stable, one-based label assigned in top-to-bottom, left-to-right discovery order. */
  readonly label: number;
  readonly area: number;
  readonly bounds: StudioAutoColorHintBounds;
  readonly representative: { readonly x: number; readonly y: number };
  readonly touchesCanvasEdge: boolean;
  readonly transparentArea: number;
  readonly fullyTransparent: boolean;
}

export interface StudioAutoColorHintBatchOperation {
  readonly componentLabel: number;
  readonly color: StudioAutoColorHintRgba;
  /** Canonical hint selected by stable id ordering. */
  readonly sourceHintId: string;
  /** Includes sourceHintId and every same-color hint deduplicated into this operation. */
  readonly hintIds: readonly string[];
  readonly area: number;
  readonly bounds: StudioAutoColorHintBounds;
}

export interface StudioAutoColorHintConflictChoice {
  readonly color: StudioAutoColorHintRgba;
  readonly hintIds: readonly string[];
}

export interface StudioAutoColorHintConflict {
  readonly componentLabel: number;
  readonly area: number;
  readonly bounds: StudioAutoColorHintBounds;
  readonly choices: readonly StudioAutoColorHintConflictChoice[];
}

export interface StudioAutoColorHintDeduplication {
  readonly componentLabel: number;
  readonly retainedHintId: string;
  readonly duplicateHintId: string;
  readonly color: StudioAutoColorHintRgba;
}

export type StudioAutoColorHintRejectionReason = "boundary" | "palette-locked";

export interface StudioAutoColorHintRejection {
  readonly hintId: string;
  readonly reason: StudioAutoColorHintRejectionReason;
  readonly componentLabel: number | null;
}

export interface StudioAutoColorHintRecommendation {
  readonly componentLabel: number;
  readonly area: number;
  readonly bounds: StudioAutoColorHintBounds;
  readonly seed: { readonly x: number; readonly y: number };
  readonly touchesCanvasEdge: boolean;
  readonly fullyTransparent: boolean;
  readonly requiredMinimumArea: number;
}

export interface StudioAutoColorHintDiagnostics {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly boundaryPixelCount: number;
  readonly componentCount: number;
  readonly requestedHintCount: number;
  readonly acceptedHintCount: number;
  readonly rejectedHintCount: number;
  readonly deduplicatedHintCount: number;
  readonly conflictCount: number;
  readonly operationCount: number;
  readonly paletteLockEnabled: boolean;
  readonly budgets: Required<StudioAutoColorHintBudgets>;
}

export interface StudioAutoColorHintPlan {
  readonly engine: "connected-region-hints";
  /** Any conflict or rejected hint blocks the whole batch; partial pixel updates are never planned. */
  readonly status: "ready" | "blocked";
  /** 0 means boundary ink; positive values address components below. */
  readonly labels: Uint32Array;
  readonly components: readonly StudioAutoColorHintComponent[];
  readonly operations: readonly StudioAutoColorHintBatchOperation[];
  readonly conflicts: readonly StudioAutoColorHintConflict[];
  readonly deduplicatedHints: readonly StudioAutoColorHintDeduplication[];
  readonly rejectedHints: readonly StudioAutoColorHintRejection[];
  readonly recommendations: readonly StudioAutoColorHintRecommendation[];
  readonly diagnostics: StudioAutoColorHintDiagnostics;
}

interface NormalizedOptions {
  readonly boundaryInkThreshold: number;
  readonly transparentAlphaThreshold: number;
  readonly connectivity: StudioAutoColorHintConnectivity;
  readonly budgets: Required<StudioAutoColorHintBudgets>;
  readonly recommendations: Required<StudioAutoColorHintRecommendationPolicy>;
}

interface NormalizedSeed extends StudioAutoColorHintSeed {
  readonly position: number;
}

interface MutableColorChoice {
  readonly color: StudioAutoColorHintRgba;
  readonly hintIds: string[];
}

const DEFAULT_OPTIONS = Object.freeze({
  boundaryInkThreshold: 24,
  transparentAlphaThreshold: 0,
  connectivity: 4 as StudioAutoColorHintConnectivity,
  budgets: Object.freeze({
    maxPixels: STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    maxHints: STUDIO_AUTO_COLOR_HINT_MAX_HINTS,
    maxComponents: STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS,
  }),
  recommendations: Object.freeze({
    minimumArea: 4,
    minimumBackgroundArea: 64,
    minimumTransparentArea: 16,
    maximumRecommendations: 12,
  }),
});

function assertObject<Value>(value: Value, label: string): asserts value is Value & object {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object.`);
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function normalizeBudgets(value: StudioAutoColorHintBudgets | undefined): Required<StudioAutoColorHintBudgets> {
  if (value !== undefined) assertObject(value, "options.budgets");
  return {
    maxPixels: integer(
      value?.maxPixels ?? DEFAULT_OPTIONS.budgets.maxPixels,
      "options.budgets.maxPixels",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    maxHints: integer(
      value?.maxHints ?? DEFAULT_OPTIONS.budgets.maxHints,
      "options.budgets.maxHints",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_HINTS,
    ),
    maxComponents: integer(
      value?.maxComponents ?? DEFAULT_OPTIONS.budgets.maxComponents,
      "options.budgets.maxComponents",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_COMPONENTS,
    ),
  };
}

function normalizeRecommendations(
  value: StudioAutoColorHintRecommendationPolicy | undefined,
): Required<StudioAutoColorHintRecommendationPolicy> {
  if (value !== undefined) assertObject(value, "options.recommendations");
  return {
    minimumArea: integer(
      value?.minimumArea ?? DEFAULT_OPTIONS.recommendations.minimumArea,
      "options.recommendations.minimumArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    minimumBackgroundArea: integer(
      value?.minimumBackgroundArea ?? DEFAULT_OPTIONS.recommendations.minimumBackgroundArea,
      "options.recommendations.minimumBackgroundArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    minimumTransparentArea: integer(
      value?.minimumTransparentArea ?? DEFAULT_OPTIONS.recommendations.minimumTransparentArea,
      "options.recommendations.minimumTransparentArea",
      1,
      STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
    ),
    maximumRecommendations: integer(
      value?.maximumRecommendations ?? DEFAULT_OPTIONS.recommendations.maximumRecommendations,
      "options.recommendations.maximumRecommendations",
      0,
      STUDIO_AUTO_COLOR_HINT_MAX_RECOMMENDATIONS,
    ),
  };
}

function normalizeOptions(value: StudioAutoColorHintOptions | undefined): NormalizedOptions {
  if (value !== undefined) assertObject(value, "options");
  const connectivity = value?.connectivity ?? DEFAULT_OPTIONS.connectivity;
  if (connectivity !== 4 && connectivity !== 8) {
    throw new RangeError("options.connectivity must be 4 or 8.");
  }
  return {
    boundaryInkThreshold: integer(
      value?.boundaryInkThreshold ?? DEFAULT_OPTIONS.boundaryInkThreshold,
      "options.boundaryInkThreshold",
      1,
      255,
    ),
    transparentAlphaThreshold: integer(
      value?.transparentAlphaThreshold ?? DEFAULT_OPTIONS.transparentAlphaThreshold,
      "options.transparentAlphaThreshold",
      0,
      255,
    ),
    connectivity,
    budgets: normalizeBudgets(value?.budgets),
    recommendations: normalizeRecommendations(value?.recommendations),
  };
}

function validateImage(image: StudioAutoColorHintImageDataLike, maxPixels: number): number {
  assertObject(image, "image");
  const width = integer(image.width, "image.width", 1, maxPixels);
  const height = integer(image.height, "image.height", 1, maxPixels);
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
    throw new RangeError(`image exceeds the ${maxPixels} pixel request budget.`);
  }
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError("image.data must be a Uint8ClampedArray.");
  }
  if (image.data.length !== pixelCount * 4) {
    throw new RangeError("image.data length must equal width * height * 4.");
  }
  return pixelCount;
}

function normalizeColor(value: StudioAutoColorHintRgba, label: string): StudioAutoColorHintRgba {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${label} must contain exactly four RGBA channels.`);
  }
  return [
    integer(value[0], `${label}[0]`, 0, 255),
    integer(value[1], `${label}[1]`, 0, 255),
    integer(value[2], `${label}[2]`, 0, 255),
    integer(value[3], `${label}[3]`, 0, 255),
  ];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareColors(left: StudioAutoColorHintRgba, right: StudioAutoColorHintRgba): number {
  for (let channel = 0; channel < 4; channel++) {
    const difference = left[channel]! - right[channel]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function colorKey(color: StudioAutoColorHintRgba): string {
  return `${color[0]},${color[1]},${color[2]},${color[3]}`;
}

function normalizePaletteLock(value: StudioAutoColorHintPaletteLock | undefined): ReadonlySet<string> | null {
  if (value === undefined) return null;
  assertObject(value, "paletteLock");
  if (!Array.isArray(value.colors)) throw new TypeError("paletteLock.colors must be an array.");
  if (value.colors.length > STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS) {
    throw new RangeError(
      `paletteLock.colors exceeds the ${STUDIO_AUTO_COLOR_HINT_MAX_PALETTE_COLORS} color safety limit.`,
    );
  }
  const keys = new Set<string>();
  value.colors.forEach((color, index) => {
    keys.add(colorKey(normalizeColor(color, `paletteLock.colors[${index}]`)));
  });
  return keys;
}

function normalizeSeeds(
  seeds: readonly StudioAutoColorHintSeed[],
  width: number,
  height: number,
  maxHints: number,
): NormalizedSeed[] {
  if (!Array.isArray(seeds)) throw new TypeError("seeds must be an array.");
  if (seeds.length > maxHints) throw new RangeError(`seeds exceeds the ${maxHints} hint request budget.`);

  const ids = new Set<string>();
  const normalized = seeds.map((seed, index): NormalizedSeed => {
    assertObject(seed, `seeds[${index}]`);
    if (typeof seed.id !== "string" || seed.id.trim().length === 0) {
      throw new TypeError(`seeds[${index}].id must be a non-empty string.`);
    }
    if (seed.id.length > STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH) {
      throw new RangeError(
        `seeds[${index}].id exceeds the ${STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH} character safety limit.`,
      );
    }
    if (ids.has(seed.id)) throw new RangeError(`seeds contains duplicate id ${JSON.stringify(seed.id)}.`);
    ids.add(seed.id);
    const x = integer(seed.x, `seeds[${index}].x`, 0, width - 1);
    const y = integer(seed.y, `seeds[${index}].y`, 0, height - 1);
    return {
      id: seed.id,
      x,
      y,
      position: y * width + x,
      color: normalizeColor(seed.color, `seeds[${index}].color`),
    };
  });

  normalized.sort((left, right) => compareStrings(left.id, right.id));
  return normalized;
}

function isBoundaryInk(data: Uint8ClampedArray, position: number, threshold: number): boolean {
  const offset = position * 4;
  const red = data[offset]!;
  const green = data[offset + 1]!;
  const blue = data[offset + 2]!;
  const alpha = data[offset + 3]!;
  // Integer Rec.709 approximation. Multipliers total 256, keeping the output in 0..255.
  const luminance = (54 * red + 183 * green + 19 * blue + 128) >> 8;
  const inkStrength = Math.round(((255 - luminance) * alpha) / 255);
  return inkStrength >= threshold;
}

function labelComponents(
  image: StudioAutoColorHintImageDataLike,
  pixelCount: number,
  options: NormalizedOptions,
): {
  labels: Uint32Array;
  components: StudioAutoColorHintComponent[];
  boundaryPixelCount: number;
} {
  const { width, height, data } = image;
  const labels = new Uint32Array(pixelCount);
  let boundaryPixelCount = 0;
  for (let position = 0; position < pixelCount; position++) {
    if (!isBoundaryInk(data, position, options.boundaryInkThreshold)) continue;
    labels[position] = BOUNDARY_LABEL;
    boundaryPixelCount++;
  }

  const queue = new Uint32Array(pixelCount);
  const components: StudioAutoColorHintComponent[] = [];
  for (let start = 0; start < pixelCount; start++) {
    if (labels[start] !== 0) continue;
    if (components.length >= options.budgets.maxComponents) {
      throw new RangeError(
        `image exceeds the ${options.budgets.maxComponents} connected-component request budget.`,
      );
    }

    const label = components.length + 1;
    let head = 0;
    let tail = 0;
    let area = 0;
    let transparentArea = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let touchesCanvasEdge = false;
    labels[start] = label;
    queue[tail++] = start;

    const enqueue = (position: number) => {
      if (labels[position] !== 0) return;
      labels[position] = label;
      queue[tail++] = position;
    };

    while (head < tail) {
      const position = queue[head++]!;
      const x = position % width;
      const y = (position / width) | 0;
      area++;
      if (data[position * 4 + 3]! <= options.transparentAlphaThreshold) transparentArea++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) touchesCanvasEdge = true;

      if (x > 0) enqueue(position - 1);
      if (x < width - 1) enqueue(position + 1);
      if (y > 0) enqueue(position - width);
      if (y < height - 1) enqueue(position + width);
      if (options.connectivity === 8) {
        if (x > 0 && y > 0) enqueue(position - width - 1);
        if (x < width - 1 && y > 0) enqueue(position - width + 1);
        if (x > 0 && y < height - 1) enqueue(position + width - 1);
        if (x < width - 1 && y < height - 1) enqueue(position + width + 1);
      }
    }

    components.push({
      label,
      area,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      representative: { x: start % width, y: (start / width) | 0 },
      touchesCanvasEdge,
      transparentArea,
      fullyTransparent: transparentArea === area,
    });
  }

  for (let position = 0; position < labels.length; position++) {
    if (labels[position] === BOUNDARY_LABEL) labels[position] = 0;
  }
  return { labels, components, boundaryPixelCount };
}

function buildRecommendations(
  components: readonly StudioAutoColorHintComponent[],
  hintedLabels: ReadonlySet<number>,
  policy: Required<StudioAutoColorHintRecommendationPolicy>,
): StudioAutoColorHintRecommendation[] {
  if (policy.maximumRecommendations === 0) return [];
  return components
    .filter((component) => !hintedLabels.has(component.label))
    .map((component): StudioAutoColorHintRecommendation | null => {
      const requiredMinimumArea = Math.max(
        policy.minimumArea,
        component.touchesCanvasEdge ? policy.minimumBackgroundArea : 0,
        component.fullyTransparent ? policy.minimumTransparentArea : 0,
      );
      if (component.area < requiredMinimumArea) return null;
      return {
        componentLabel: component.label,
        area: component.area,
        bounds: component.bounds,
        seed: component.representative,
        touchesCanvasEdge: component.touchesCanvasEdge,
        fullyTransparent: component.fullyTransparent,
        requiredMinimumArea,
      };
    })
    .filter((recommendation): recommendation is StudioAutoColorHintRecommendation => recommendation !== null)
    .sort((left, right) => right.area - left.area || left.componentLabel - right.componentLabel)
    .slice(0, policy.maximumRecommendations);
}

/**
 * Builds a fail-closed, non-mutating batch plan. A blocked result intentionally contains no
 * operations; callers must resolve every conflict/rejection and plan again before painting.
 */
export function planStudioAutoColorHints(request: StudioAutoColorHintRequest): StudioAutoColorHintPlan {
  assertObject(request, "request");
  const options = normalizeOptions(request.options);
  const pixelCount = validateImage(request.image, options.budgets.maxPixels);
  const seeds = normalizeSeeds(
    request.seeds,
    request.image.width,
    request.image.height,
    options.budgets.maxHints,
  );
  const palette = normalizePaletteLock(request.paletteLock);
  const { labels, components, boundaryPixelCount } = labelComponents(request.image, pixelCount, options);

  const rejectedHints: StudioAutoColorHintRejection[] = [];
  const hintedLabels = new Set<number>();
  const choicesByComponent = new Map<number, Map<string, MutableColorChoice>>();
  let acceptedHintCount = 0;

  for (const seed of seeds) {
    const componentLabel = labels[seed.position]!;
    if (componentLabel === 0) {
      rejectedHints.push({ hintId: seed.id, reason: "boundary", componentLabel: null });
      continue;
    }
    hintedLabels.add(componentLabel);
    const key = colorKey(seed.color);
    if (palette && !palette.has(key)) {
      rejectedHints.push({ hintId: seed.id, reason: "palette-locked", componentLabel });
      continue;
    }
    acceptedHintCount++;
    let componentChoices = choicesByComponent.get(componentLabel);
    if (!componentChoices) {
      componentChoices = new Map<string, MutableColorChoice>();
      choicesByComponent.set(componentLabel, componentChoices);
    }
    const existing = componentChoices.get(key);
    if (existing) existing.hintIds.push(seed.id);
    else componentChoices.set(key, { color: seed.color, hintIds: [seed.id] });
  }

  const conflicts: StudioAutoColorHintConflict[] = [];
  const deduplicatedHints: StudioAutoColorHintDeduplication[] = [];
  const candidateOperations: StudioAutoColorHintBatchOperation[] = [];

  for (const component of components) {
    const componentChoices = choicesByComponent.get(component.label);
    if (!componentChoices) continue;
    const choices = [...componentChoices.values()]
      .map((choice): StudioAutoColorHintConflictChoice => ({
        color: choice.color,
        hintIds: choice.hintIds.sort(compareStrings),
      }))
      .sort((left, right) => compareColors(left.color, right.color));

    for (const choice of choices) {
      for (let index = 1; index < choice.hintIds.length; index++) {
        deduplicatedHints.push({
          componentLabel: component.label,
          retainedHintId: choice.hintIds[0]!,
          duplicateHintId: choice.hintIds[index]!,
          color: choice.color,
        });
      }
    }

    if (choices.length > 1) {
      conflicts.push({
        componentLabel: component.label,
        area: component.area,
        bounds: component.bounds,
        choices,
      });
      continue;
    }
    const choice = choices[0]!;
    candidateOperations.push({
      componentLabel: component.label,
      color: choice.color,
      sourceHintId: choice.hintIds[0]!,
      hintIds: choice.hintIds,
      area: component.area,
      bounds: component.bounds,
    });
  }

  const status = conflicts.length > 0 || rejectedHints.length > 0 ? "blocked" : "ready";
  const operations = status === "ready" ? candidateOperations : [];
  return {
    engine: "connected-region-hints",
    status,
    labels,
    components,
    operations,
    conflicts,
    deduplicatedHints,
    rejectedHints,
    recommendations: buildRecommendations(components, hintedLabels, options.recommendations),
    diagnostics: {
      width: request.image.width,
      height: request.image.height,
      pixelCount,
      boundaryPixelCount,
      componentCount: components.length,
      requestedHintCount: seeds.length,
      acceptedHintCount,
      rejectedHintCount: rejectedHints.length,
      deduplicatedHintCount: deduplicatedHints.length,
      conflictCount: conflicts.length,
      operationCount: operations.length,
      paletteLockEnabled: palette !== null,
      budgets: options.budgets,
    },
  };
}
