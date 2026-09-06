/**
 * Figma-style numeric multi-edit for a Studio marquee selection.
 *
 * The Inspector owns only author intent (X/Y/W/H/relative rotation/opacity). Every geometric
 * mutation is delegated to the same selection transform planner used by the canvas handles, so
 * numeric edits and pointer gestures share one model-aware resize/rotation implementation, one
 * undo entry and one CRDT publication. Unsupported mixed selections fail atomically instead of
 * moving a subset and tearing the composition.
 */
import { elBounds } from "./studio-element-geometry";
import {
  planStudioSelectionLayoutPatch,
  unionStudioSelectionBounds,
  type StudioFigmaSelectionLayoutPatch,
} from "./studio-figma-selection-ux";
import { studioGroupUniformResizeMemberCanRotate } from "./studio-group-uniform-resize";
import { planStudioSelectionTransformCommit } from "./studio-selection-transform-commit";

import type { El } from "./studio-element-model";

export interface StudioFigmaMultiEditInput {
  readonly elements: readonly El[];
  readonly selectedIds: readonly string[];
  readonly patch: StudioFigmaSelectionLayoutPatch;
  /** Must include element locks and inherited group locks. */
  readonly isLocked: (element: El) => boolean;
}

export type StudioFigmaMultiEditPlan =
  | {
      readonly kind: "changed";
      readonly next: El[];
      readonly announcement: string;
    }
  | {
      readonly kind: "unchanged";
      /** Null means a genuine no-op; a string is safe to surface as an error/toast. */
      readonly reason: string | null;
    };

const RELATIVE_EPSILON = 1e-6;

function unchanged(reason: string | null = null): StudioFigmaMultiEditPlan {
  return { kind: "unchanged", reason };
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: number | undefined): value is number {
  return finite(value) && value > 0;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= RELATIVE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Fold full turns away while preserving the user's clockwise/counter-clockwise direction. */
function normalizeRelativeRotation(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * The group planner rotates about targetBounds.x/y. Move that origin to the place the unrotated
 * top-left reaches when the target box turns around its own centre, matching the canvas handle.
 */
function rotateBoxOriginAboutCentre(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  degrees: number,
): { x: number; y: number; width: number; height: number } {
  if (degrees === 0) return { ...box };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  return {
    x: box.x + halfWidth - halfWidth * cos + halfHeight * sin,
    y: box.y + halfHeight - halfWidth * sin - halfHeight * cos,
    width: box.width,
    height: box.height,
  };
}

/**
 * The shared union helper pads strokes and floors the box at 1px so zoom/flip pivots stay stable.
 * A refusal has to look at the real extent instead, or a selection of zero-size targets would be
 * scaled against a fabricated 1x1 box.
 */
function hasUsableExtent(targets: readonly El[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of targets) {
    const box = elBounds(element);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return false;
  return maxX - minX > 0 && maxY - minY > 0;
}

function validatePatch(patch: StudioFigmaSelectionLayoutPatch): string | null {
  if (patch.x !== undefined && !finite(patch.x)) return "가로 위치에 유효한 숫자를 입력해 주세요.";
  if (patch.y !== undefined && !finite(patch.y)) return "세로 위치에 유효한 숫자를 입력해 주세요.";
  if (patch.width !== undefined && !finitePositive(patch.width)) {
    return "너비는 0보다 큰 숫자여야 해요.";
  }
  if (patch.height !== undefined && !finitePositive(patch.height)) {
    return "높이는 0보다 큰 숫자여야 해요.";
  }
  if (patch.rotation !== undefined && !finite(patch.rotation)) {
    return "회전에 유효한 각도를 입력해 주세요.";
  }
  if (patch.opacity !== undefined && !finite(patch.opacity)) {
    return "불투명도에 유효한 숫자를 입력해 주세요.";
  }
  return null;
}

function describeMultiEdit(
  count: number,
  options: {
    readonly moved: boolean;
    readonly scale: number;
    readonly rotationDeg: number;
    readonly opacity: number | null;
  },
): string {
  const parts: string[] = [];
  if (options.moved) parts.push("이동");
  if (!nearlyEqual(options.scale, 1)) {
    parts.push(`크기 ${Math.max(1, Math.round(options.scale * 100))}%`);
  }
  if (options.rotationDeg !== 0) parts.push(`회전 ${Math.round(options.rotationDeg)}°`);
  if (options.opacity !== null) parts.push(`불투명도 ${Math.round(options.opacity * 100)}%`);
  if (parts.length === 0) parts.push("공통 속성 변경");
  return `${count}개 요소 · ${parts.join(" · ")}`;
}

/**
 * Plan one atomic multi-edit.
 *
 * - X/Y move the selection union without changing internal spacing.
 * - Typing either W or H performs a uniform resize and preserves the selection ratio.
 * - Supplying both W and H is admitted only when they describe the same uniform scale.
 * - Rotation is relative and turns the selection as one rigid body around its centre.
 * - Opacity is included in the same returned document snapshot; a refused transform applies
 *   nothing, including opacity.
 */
export function planStudioFigmaMultiEdit(
  input: StudioFigmaMultiEditInput,
): StudioFigmaMultiEditPlan {
  const patchError = validatePatch(input.patch);
  if (patchError) return unchanged(patchError);

  const selected = new Set(input.selectedIds);
  const targets = input.elements.filter((element) => selected.has(element.id));
  if (targets.length < 2) return unchanged();
  if (targets.length !== selected.size) {
    return unchanged("선택 정보가 바뀌었어요. 대상을 다시 선택한 뒤 시도해 주세요.");
  }
  if (targets.some(input.isLocked)) {
    return unchanged("잠긴 레이어가 포함되어 있어 함께 수정할 수 없어요. 잠금을 해제한 뒤 다시 시도하세요.");
  }
  // A turn is all-or-nothing, so an incapable member is reported before any other refusal:
  // otherwise a mixed patch would blame the opacity it was never going to apply either.
  if (
    finite(input.patch.rotation)
    && normalizeRelativeRotation(input.patch.rotation) !== 0
    && !targets.every(studioGroupUniformResizeMemberCanRotate)
  ) {
    return unchanged(
      "선택 안에 함께 회전할 수 없는 요소가 있어요. 해당 요소를 제외한 뒤 다시 시도하세요.",
    );
  }
  if (input.patch.opacity !== undefined && targets.some((element) => element.type === "frame")) {
    return unchanged("프레임이 포함된 선택에는 불투명도를 함께 적용할 수 없어요.");
  }

  const bounds = unionStudioSelectionBounds(targets);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0 || !hasUsableExtent(targets)) {
    return unchanged("선택 영역의 크기를 계산할 수 없어요. 대상을 다시 선택해 주세요.");
  }

  const widthScale = finitePositive(input.patch.width)
    ? input.patch.width / bounds.w
    : null;
  const heightScale = finitePositive(input.patch.height)
    ? input.patch.height / bounds.h
    : null;
  if (widthScale !== null && heightScale !== null && !nearlyEqual(widthScale, heightScale)) {
    return unchanged("여러 요소의 너비와 높이는 비율을 유지해야 해요. 한쪽 값만 입력해 주세요.");
  }
  const scale = widthScale ?? heightScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    return unchanged("선택 영역을 해당 크기로 조절할 수 없어요.");
  }

  const targetX = finite(input.patch.x) ? input.patch.x : bounds.x;
  const targetY = finite(input.patch.y) ? input.patch.y : bounds.y;
  const rotationDeg = finite(input.patch.rotation)
    ? normalizeRelativeRotation(input.patch.rotation)
    : 0;
  const moved = !nearlyEqual(targetX, bounds.x) || !nearlyEqual(targetY, bounds.y);
  const geometryRequested =
    input.patch.x !== undefined
    || input.patch.y !== undefined
    || input.patch.width !== undefined
    || input.patch.height !== undefined
    || input.patch.rotation !== undefined;

  let next: El[] = [...input.elements];
  let transformChanged = false;
  if (geometryRequested) {
    const unrotatedTarget = {
      x: targetX,
      y: targetY,
      width: bounds.w * scale,
      height: bounds.h * scale,
    };
    const transform = planStudioSelectionTransformCommit({
      elements: input.elements,
      selectedIds: targets.map((element) => element.id),
      sourceBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h,
      },
      targetBounds: rotateBoxOriginAboutCentre(unrotatedTarget, rotationDeg),
      rotationDeg,
      isLocked: input.isLocked,
    });
    if (transform.kind === "unchanged" && transform.refusal) {
      return unchanged(transform.refusal);
    }
    if (transform.kind === "changed") {
      next = transform.next;
      transformChanged = true;
    }
  }

  let opacityChanged = false;
  let opacity: number | null = null;
  if (finite(input.patch.opacity)) {
    // Bound once into a non-nullable local: the map callback below is a closure, so the mutable
    // `opacity` accumulator does not stay narrowed inside it.
    const nextOpacity = Math.min(1, Math.max(0, input.patch.opacity));
    opacity = nextOpacity;
    next = next.map((element) => {
      if (!selected.has(element.id)) return element;
      const planned = planStudioSelectionLayoutPatch(element, { opacity: nextOpacity });
      if (!planned) return element;
      opacityChanged = true;
      return { ...element, ...planned } as El;
    });
  }

  if (!transformChanged && !opacityChanged) return unchanged();
  return {
    kind: "changed",
    next,
    announcement: describeMultiEdit(targets.length, {
      moved: moved && transformChanged,
      scale: transformChanged ? scale : 1,
      rotationDeg: transformChanged ? rotationDeg : 0,
      opacity: opacityChanged ? opacity : null,
    }),
  };
}
