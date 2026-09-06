/**
 * Bridge auto-color hint plans into Advanced Fill batch jobs.
 *
 * Pure + deterministic: never touches the DOM. A ready plan becomes one Advanced Fill job per
 * batch operation (seed = component representative, fill = operation color). Apply walks jobs
 * sequentially on a cloned working buffer so partial silent overwrites cannot land without an
 * explicit caller encoding the result.
 */

import {
  applyAdvancedFill,
  type AdvancedFillImageDataLike,
  type AdvancedFillOptions,
  type AdvancedFillRgba,
  type AdvancedFillResult,
  type AdvancedFillSeed,
} from "./studio-advanced-fill";

import type {
  StudioAutoColorHintPlan,
  StudioAutoColorHintRgba,
  StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";

export const STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX = 64;

/** Apply destination for auto-color paint. */
export type StudioAutoColorApplyTargetMode = "selected" | "new-paint-layer";

export const STUDIO_AUTO_COLOR_APPLY_TARGET_MODES: readonly {
  readonly id: StudioAutoColorApplyTargetMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "selected",
    label: "선택 레이어",
    description: "선화 레이어에 직접 칠합니다.",
  },
  {
    id: "new-paint-layer",
    label: "새 채색 레이어",
    description: "투명 채색 레이어를 만들고 그 위에만 칠합니다(선화 보존).",
  },
];

export const STUDIO_AUTO_COLOR_SCRIBBLE_PALETTE: readonly {
  readonly id: string;
  readonly label: string;
  readonly color: StudioAutoColorHintRgba;
}[] = [
  { id: "skin", label: "피부", color: [245, 210, 185, 255] },
  { id: "hair", label: "머리", color: [48, 36, 32, 255] },
  { id: "cloth", label: "옷", color: [70, 120, 210, 255] },
  { id: "accent", label: "포인트", color: [230, 70, 90, 255] },
  { id: "shadow", label: "그림자", color: [120, 110, 140, 255] },
  { id: "white", label: "흰색", color: [255, 255, 255, 255] },
];

export interface StudioAutoColorAdvancedFillJob {
  readonly componentLabel: number;
  readonly sourceHintId: string;
  readonly seed: AdvancedFillSeed;
  readonly fill: AdvancedFillRgba;
  readonly area: number;
}

export type StudioAutoColorAdvancedFillPlanResult =
  | {
      readonly ok: true;
      readonly jobs: readonly StudioAutoColorAdvancedFillJob[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type StudioAutoColorAdvancedFillBatchResult =
  | {
      readonly ok: true;
      readonly status: "applied" | "noop";
      readonly imageData: AdvancedFillImageDataLike;
      readonly jobCount: number;
      readonly paintedPixelCount: number;
      readonly results: readonly AdvancedFillResult[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly imageData: AdvancedFillImageDataLike;
      readonly results: readonly AdvancedFillResult[];
    };

function cloneImageData(image: AdvancedFillImageDataLike): AdvancedFillImageDataLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

/**
 * Blank paint target for multi-layer color workflows (CSP-style: keep line art, paint under/over).
 * Default fill is fully transparent so the line-art layer remains visible beneath.
 */
export function createStudioAutoColorBlankPaintTarget(
  width: number,
  height: number,
  fill: AdvancedFillRgba = [0, 0, 0, 0],
): AdvancedFillImageDataLike {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  const r = fill[0];
  const g = fill[1];
  const b = fill[2];
  const a = fill[3];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width: w, height: h, data };
}

/**
 * Apply a ready plan onto a blank (or existing) paint target using the plan's labels.
 * `reference` is only used for optional Advanced Fill diagnostics; paint authority is labels.
 */
export function applyStudioAutoColorHintsToPaintTarget(input: {
  readonly plan: StudioAutoColorHintPlan;
  /** Usually a transparent canvas matching the line-art plan size. */
  readonly paintTarget: AdvancedFillImageDataLike;
  /** Line-art (or same) raster used when planning; optional diagnostics path. */
  readonly referenceImage?: AdvancedFillImageDataLike;
  readonly options?: AdvancedFillOptions;
}): StudioAutoColorAdvancedFillBatchResult {
  return applyStudioAutoColorHintsAdvancedFillBatch({
    plan: input.plan,
    target: input.paintTarget,
    referenceImage: input.referenceImage ?? input.paintTarget,
    options: input.options,
  });
}

function asFill(color: StudioAutoColorHintRgba): AdvancedFillRgba {
  return [color[0], color[1], color[2], color[3]];
}

/**
 * Append a scribble seed with a stable id. Caps at STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX.
 * Duplicate ids replace the previous entry (id order otherwise preserved).
 */
export function appendStudioAutoColorScribbleSeed(
  seeds: readonly StudioAutoColorHintSeed[],
  seed: StudioAutoColorHintSeed,
): StudioAutoColorHintSeed[] {
  if (!seed || typeof seed.id !== "string" || !seed.id) {
    return seeds.slice();
  }
  const next = seeds.filter((entry) => entry.id !== seed.id);
  next.push({
    id: seed.id,
    x: seed.x,
    y: seed.y,
    color: [seed.color[0], seed.color[1], seed.color[2], seed.color[3]],
  });
  if (next.length <= STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX) return next;
  return next.slice(next.length - STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX);
}

/** Build a seed from a plan recommendation + active scribble color. */
export function studioAutoColorScribbleSeedFromRecommendation(input: {
  readonly componentLabel: number;
  readonly x: number;
  readonly y: number;
  readonly color: StudioAutoColorHintRgba;
  readonly idPrefix?: string;
}): StudioAutoColorHintSeed {
  const prefix = input.idPrefix ?? "scribble";
  return {
    id: `${prefix}-c${input.componentLabel}`,
    x: input.x,
    y: input.y,
    color: [input.color[0], input.color[1], input.color[2], input.color[3]],
  };
}

/**
 * Convert a ready auto-color plan into Advanced Fill jobs.
 * Blocked / empty plans fail closed with a Korean reason string.
 */
export function planStudioAutoColorHintsAdvancedFillJobs(
  plan: StudioAutoColorHintPlan,
): StudioAutoColorAdvancedFillPlanResult {
  if (!plan || typeof plan !== "object") {
    return { ok: false, reason: "힌트 계획이 없어요." };
  }
  if (plan.status !== "ready") {
    return {
      ok: false,
      reason: "충돌·거절이 있는 계획은 고급 채우기로 적용할 수 없어요. 시드를 조정한 뒤 다시 계획하세요.",
    };
  }
  if (plan.operations.length === 0) {
    return {
      ok: false,
      reason: "적용할 연산이 없어요. 스크리블 시드를 추가한 뒤 다시 계획하세요.",
    };
  }

  const componentsByLabel = new Map(
    plan.components.map((component) => [component.label, component] as const),
  );
  const jobs: StudioAutoColorAdvancedFillJob[] = [];
  for (const operation of plan.operations) {
    const component = componentsByLabel.get(operation.componentLabel);
    if (!component) {
      return {
        ok: false,
        reason: `영역 #${operation.componentLabel} 을(를) 찾지 못했어요.`,
      };
    }
    jobs.push({
      componentLabel: operation.componentLabel,
      sourceHintId: operation.sourceHintId,
      seed: { x: component.representative.x, y: component.representative.y },
      fill: asFill(operation.color),
      area: operation.area,
    });
  }
  return { ok: true, jobs };
}

const DEFAULT_APPLY_OPTIONS: AdvancedFillOptions = {
  // Reference line art is usually white paper + black ink. Match the seed paper color until ink.
  matchMode: "seed-color",
  tolerance: 48,
  matchAlpha: false,
  alphaBoundary: "none",
  contiguous: true,
  connectivity: 4,
  closeGapRadius: 0,
  areaAdjustment: 0,
  // Auto-color regions often touch the page edge (open gutters); allow full-canvas components.
  maxAreaRatio: 1,
};

/**
 * Paint ready plan labels onto a cloned target. Uses the planner's component labels as the
 * authority mask so apply matches the plan even when Advanced Fill flood options differ.
 * Jobs remain available for callers that want per-region Advanced Fill integration.
 */
export function applyStudioAutoColorHintsAdvancedFillBatch(input: {
  readonly plan: StudioAutoColorHintPlan;
  readonly target: AdvancedFillImageDataLike;
  /** Defaults to target (paint into the same raster used for region detection). */
  readonly referenceImage?: AdvancedFillImageDataLike;
  readonly options?: AdvancedFillOptions;
}): StudioAutoColorAdvancedFillBatchResult {
  const planned = planStudioAutoColorHintsAdvancedFillJobs(input.plan);
  if (!planned.ok) {
    return {
      ok: false,
      reason: planned.reason,
      imageData: cloneImageData(input.target),
      results: [],
    };
  }

  if (
    input.plan.labels.length !== input.target.width * input.target.height
    || input.plan.diagnostics.width !== input.target.width
    || input.plan.diagnostics.height !== input.target.height
  ) {
    return {
      ok: false,
      reason: "힌트 계획 해상도와 대상 이미지가 달라요. 다시 계획한 뒤 적용하세요.",
      imageData: cloneImageData(input.target),
      results: [],
    };
  }

  const reference = input.referenceImage ?? input.target;
  if (
    reference.width !== input.target.width
    || reference.height !== input.target.height
  ) {
    return {
      ok: false,
      reason: "기준 이미지와 대상 이미지 크기가 달라요.",
      imageData: cloneImageData(input.target),
      results: [],
    };
  }

  // Primary path: paint from the planner's connected-component labels (exact plan authority).
  const working = cloneImageData(input.target);
  const fillByLabel = new Map<number, AdvancedFillRgba>();
  for (const job of planned.jobs) fillByLabel.set(job.componentLabel, job.fill);

  let paintedPixelCount = 0;
  const { width, height } = working;
  const labels = input.plan.labels;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const fill = fillByLabel.get(labels[index]!);
      if (!fill) continue;
      const offset = index * 4;
      working.data[offset] = fill[0];
      working.data[offset + 1] = fill[1];
      working.data[offset + 2] = fill[2];
      working.data[offset + 3] = fill[3];
      paintedPixelCount += 1;
    }
  }

  // Optional verification jobs: one Advanced Fill per operation on the original reference so
  // callers/tests can see engine diagnostics without double-painting the working buffer.
  const options: AdvancedFillOptions = {
    ...DEFAULT_APPLY_OPTIONS,
    ...input.options,
  };
  const results: AdvancedFillResult[] = planned.jobs.map((job) =>
    applyAdvancedFill({
      target: input.target,
      referenceImage: reference,
      seeds: [job.seed],
      fill: job.fill,
      options,
    })
  );

  return {
    ok: true,
    status: paintedPixelCount > 0 ? "applied" : "noop",
    imageData: working,
    jobCount: planned.jobs.length,
    paintedPixelCount,
    results,
  };
}
