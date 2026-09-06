/**
 * Inspector-only multi-selection bridge.
 *
 * The canvas already owns an atomic, model-aware group resize/rotation planner. The Inspector
 * must reuse that exact commit path rather than maintaining a second transform implementation:
 * numeric W/H/rotation edits therefore preserve the same lock, mixed-model, draw-stroke and
 * all-or-nothing guarantees as the on-canvas handles.
 */
import {
  planStudioSelectionLayoutPatch,
  unionStudioSelectionBounds,
  type StudioFigmaSelectionLayoutMetrics,
  type StudioFigmaSelectionLayoutPatch,
} from "./studio-figma-selection-ux";
import {
  planStudioSelectionTransformCommit,
  type StudioSelectionTransformCommitPlan,
} from "./studio-selection-transform-commit";
import {
  resolveStudioFigmaSelectionLayoutMetrics as resolvePrecisionSelectionLayoutMetrics,
} from "./studio-selection-transform-metrics";

import type { El } from "./studio-element-model";

export interface StudioInspectorMultiSelectionPatchOptions {
  /** Must include direct element locks and effective parent-group locks. */
  readonly isLocked?: (element: El) => boolean;
}

export type StudioInspectorMultiSelectionLayoutPlan =
  | {
      readonly kind: "unchanged";
      readonly refusal: string | null;
    }
  | {
      readonly kind: "changed";
      readonly next: El[];
      readonly announcement: string;
    };

const SCALE_EPSILON = 1e-6;
const POSITION_EPSILON = 1e-7;
const NEVER_LOCKED = () => false;

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: number | undefined): value is number {
  return finite(value) && value > 0;
}

function nearlyEqual(a: number, b: number, epsilon = SCALE_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

function normalizeSignedDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped === 0 ? 0 : wrapped;
}

function unchanged(refusal: string | null = null): StudioInspectorMultiSelectionLayoutPlan {
  return { kind: "unchanged", refusal };
}

function invalidPatchReason(patch: StudioFigmaSelectionLayoutPatch): string | null {
  if (patch.x !== undefined && !finite(patch.x)) {
    return "가로 위치에 유효한 숫자를 입력해 주세요.";
  }
  if (patch.y !== undefined && !finite(patch.y)) {
    return "세로 위치에 유효한 숫자를 입력해 주세요.";
  }
  if (patch.width !== undefined && !finitePositive(patch.width)) {
    return "전체 너비와 높이는 0보다 큰 숫자로 입력해 주세요.";
  }
  if (patch.height !== undefined && !finitePositive(patch.height)) {
    return "전체 너비와 높이는 0보다 큰 숫자로 입력해 주세요.";
  }
  if (patch.rotation !== undefined && !finite(patch.rotation)) {
    return "회전에 유효한 각도를 입력해 주세요.";
  }
  if (patch.opacity !== undefined && !finite(patch.opacity)) {
    return "불투명도에 유효한 숫자를 입력해 주세요.";
  }
  return null;
}

/**
 * Where an unrotated target box origin must move so that the shared group planner rotates the
 * box around its centre instead of around its top-left origin.
 */
function rotateBoxOriginAboutCentre(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  degrees: number,
): { x: number; y: number; width: number; height: number } {
  if (degrees === 0) return { ...box };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return {
    x: box.x + halfW - halfW * cos + halfH * sin,
    y: box.y + halfH - halfW * sin - halfH * cos,
    width: box.width,
    height: box.height,
  };
}

/**
 * Production Inspector metrics.
 *
 * phase-180 moved capability promotion into the precision resolver, which derives the same group
 * W/H and relative-rotation verdict from the same predicate and additionally reports the resize
 * anchor, aspect-lock and stroke-width facts the precision panel needs. This bridge stays as the
 * Inspector-facing name and delegates, so there is one promotion rule rather than two.
 */
export function resolveStudioInspectorSelectionLayoutMetrics(
  elements: readonly El[],
): StudioFigmaSelectionLayoutMetrics | null {
  return resolvePrecisionSelectionLayoutMetrics(elements);
}

function describeChange(
  count: number,
  {
    moved,
    resized,
    scale,
    rotationDeg,
    opacityChanged,
  }: {
    moved: boolean;
    resized: boolean;
    scale: number;
    rotationDeg: number;
    opacityChanged: boolean;
  },
): string {
  const changes: string[] = [];
  if (moved) changes.push("위치");
  if (resized) changes.push(`크기 ${Math.max(1, Math.round(scale * 100))}%`);
  if (rotationDeg !== 0) changes.push(`회전 ${Math.round(rotationDeg)}°`);
  if (opacityChanged) changes.push("불투명도");
  return `${count}개 요소 · ${changes.join(" · ")} 변경`;
}

/**
 * Plans one Inspector edit for a multi-selection.
 *
 * - X/Y translate the union box without changing spacing.
 * - W or H performs a uniform, top-left-anchored scale. Supplying both is accepted only when the
 *   ratios agree; a non-uniform request is refused rather than tearing mixed element models.
 * - Rotation is a delta around the selection centre and is all-or-nothing.
 * - Opacity is normalised across every compatible target in the same returned document snapshot.
 */
export function planStudioInspectorMultiSelectionLayoutPatch(
  elements: readonly El[],
  selectedIds: readonly string[],
  patch: StudioFigmaSelectionLayoutPatch,
  options: StudioInspectorMultiSelectionPatchOptions = {},
): StudioInspectorMultiSelectionLayoutPlan {
  const selected = new Set(selectedIds);
  const targets = elements.filter((element) => selected.has(element.id));
  if (targets.length < 2) return unchanged();
  if (targets.length !== selected.size) {
    return unchanged("선택 정보가 바뀌었어요. 대상을 다시 선택한 뒤 시도해 주세요.");
  }

  const patchRefusal = invalidPatchReason(patch);
  if (patchRefusal) return unchanged(patchRefusal);

  const isLocked = options.isLocked ?? NEVER_LOCKED;
  if (targets.some(isLocked)) {
    return unchanged(
      "잠긴 레이어가 포함되어 있어 함께 수정할 수 없어요. 잠금을 해제한 뒤 다시 시도하세요.",
    );
  }
  if (finite(patch.opacity) && targets.some((element) => element.type === "frame")) {
    return unchanged("프레임이 포함된 선택에는 불투명도를 함께 적용할 수 없어요.");
  }

  const bounds = unionStudioSelectionBounds(targets);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return unchanged("선택 영역을 계산할 수 없어 변경하지 않았어요.");
  }
  const sourceBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.w,
    height: bounds.h,
  };

  const widthScale = finitePositive(patch.width) ? patch.width / sourceBounds.width : null;
  const heightScale = finitePositive(patch.height) ? patch.height / sourceBounds.height : null;
  if (widthScale !== null && heightScale !== null && !nearlyEqual(widthScale, heightScale)) {
    return unchanged(
      "다중 선택은 비율을 유지해 크기를 조절합니다. 전체 너비나 높이 중 하나만 입력해 주세요.",
    );
  }
  const scale = widthScale ?? heightScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    return unchanged("선택 크기를 계산할 수 없어 변경하지 않았어요.");
  }

  const targetX = finite(patch.x) ? patch.x : sourceBounds.x;
  const targetY = finite(patch.y) ? patch.y : sourceBounds.y;
  const rotationDeg = finite(patch.rotation) ? normalizeSignedDegrees(patch.rotation) : 0;
  const moved =
    Math.abs(targetX - sourceBounds.x) > POSITION_EPSILON
    || Math.abs(targetY - sourceBounds.y) > POSITION_EPSILON;
  const resized = !nearlyEqual(scale, 1);
  const transformRequested = moved || resized || rotationDeg !== 0;

  let next: El[] = [...elements];
  let transformChanged = false;
  if (transformRequested) {
    const unrotatedTarget = {
      x: targetX,
      y: targetY,
      width: sourceBounds.width * scale,
      height: sourceBounds.height * scale,
    };
    const transformPlan: StudioSelectionTransformCommitPlan = planStudioSelectionTransformCommit({
      elements,
      selectedIds: targets.map((element) => element.id),
      sourceBounds,
      targetBounds: rotateBoxOriginAboutCentre(unrotatedTarget, rotationDeg),
      rotationDeg,
      isLocked,
    });
    if (transformPlan.kind === "unchanged") {
      if (transformPlan.refusal) return unchanged(transformPlan.refusal);
    } else {
      next = transformPlan.next;
      transformChanged = true;
    }
  }

  let opacityChanged = false;
  if (finite(patch.opacity)) {
    const opacity = Math.min(1, Math.max(0, patch.opacity));
    next = next.map((element) => {
      if (!selected.has(element.id)) return element;
      const opacityPatch = planStudioSelectionLayoutPatch(element, { opacity });
      if (!opacityPatch) return element;
      opacityChanged = true;
      return { ...element, ...opacityPatch } as El;
    });
  }

  if (!transformChanged && !opacityChanged) return unchanged();
  return {
    kind: "changed",
    next,
    announcement: describeChange(targets.length, {
      moved: transformChanged && moved,
      resized: transformChanged && resized,
      scale,
      rotationDeg: transformChanged ? rotationDeg : 0,
      opacityChanged,
    }),
  };
}
