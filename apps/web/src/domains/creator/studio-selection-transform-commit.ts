/**
 * The pure half of a selection resize/rotate commit: which planner runs, whether anything
 * changed, and what the editor should say about it. `commitCanvasSelectionResize` in the host
 * keeps the parts that need its refs (session guards, the document commit, the toast and the
 * live-region announcer) and hands this module the facts.
 *
 * A single stroke is one point array, so it can absorb independent width/height exactly; the
 * group planner stays authoritative for every mixed/multi selection, where a NON-UNIFORM affine
 * is not a safe default. Rotation is available on both paths -- the group planner turns a
 * selection as a rigid body and refuses the angle outright when any member cannot carry one.
 * Both bake into `points` and hand the result to the one document commit, so undo/redo and CRDT
 * publication are identical either way.
 */
import {
  planStudioDrawObjectTransform,
  studioDrawObjectRotationIsDropped,
} from "./brush/studio-draw-object-transform";
import {
  planStudioGroupUniformResize,
  type StudioGroupUniformResizeBounds,
} from "./studio-group-uniform-resize";

import type { El } from "./studio-element-model";

export interface StudioSelectionTransformCommitInput {
  readonly elements: readonly El[];
  readonly selectedIds: readonly string[];
  readonly sourceBounds: StudioGroupUniformResizeBounds;
  readonly targetBounds: StudioGroupUniformResizeBounds;
  /** Clockwise degrees, Konva's convention. The caller has already required it to be finite. */
  readonly rotationDeg: number;
  readonly isLocked: (element: El) => boolean;
}

export type StudioSelectionTransformCommitPlan =
  | {
      readonly kind: "unchanged";
      /** Toast for a refused gesture, or null when the gesture asked for nothing. */
      readonly refusal: string | null;
    }
  | {
      readonly kind: "changed";
      readonly next: El[];
      /** Live-region text describing what was applied. */
      readonly announcement: string;
    };

export const STUDIO_SELECTION_ROTATE_REFUSED_MESSAGE =
  "선택 안에 회전할 수 없는 요소가 있어 변경하지 않았어요.";
export const STUDIO_SELECTION_RESIZE_REFUSED_MESSAGE =
  "선택 안에 크기를 조절할 수 없는 요소가 있어 변경하지 않았어요.";

const BOUNDS_EPSILON = 1e-7;

function boundsDiffer(
  a: StudioGroupUniformResizeBounds,
  b: StudioGroupUniformResizeBounds
): boolean {
  return (
    Math.abs(a.x - b.x) > BOUNDS_EPSILON ||
    Math.abs(a.y - b.y) > BOUNDS_EPSILON ||
    Math.abs(a.width - b.width) > BOUNDS_EPSILON ||
    Math.abs(a.height - b.height) > BOUNDS_EPSILON
  );
}

/**
 * What the editor announces once the commit lands. A rotate-only gesture keeps the box size, so
 * a bare "100%" would narrate the turn to the live region as a resize to its own size.
 */
export function describeStudioSelectionTransform(
  memberCount: number,
  sourceBounds: StudioGroupUniformResizeBounds,
  targetBounds: StudioGroupUniformResizeBounds,
  rotationDeg: number
): string {
  const percent = Math.max(
    1,
    Math.round((targetBounds.width / sourceBounds.width) * 100)
  );
  const angle = Math.round(rotationDeg);
  const subject = memberCount === 1 ? "레이어" : "그룹";
  if (angle === 0) return `${subject} 크기 조절 · ${percent}%`;
  if (percent === 100) return `${subject} 회전 · ${angle}°`;
  return `${subject} 크기 조절 · ${percent}% · 회전 ${angle}°`;
}

export function planStudioSelectionTransformCommit(
  input: StudioSelectionTransformCommitInput
): StudioSelectionTransformCommitPlan {
  const { elements, selectedIds, sourceBounds, targetBounds, rotationDeg, isLocked } = input;
  const currentById = new Map(elements.map((element) => [element.id, element]));
  const soleSelection =
    selectedIds.length === 1 ? currentById.get(selectedIds[0]!) : undefined;
  const soleSelectedDraw =
    soleSelection && soleSelection.type === "draw" && !isLocked(soleSelection)
      ? soleSelection
      : undefined;

  let next: El[];
  if (soleSelectedDraw) {
    // The single-stroke planner DROPS an angle it cannot bake in (a bounds-derived shape, a
    // mirrored-symmetry stroke) and still applies the resize. The handle is withheld from those
    // strokes, so an angle that reaches one here is refused the way the group lane refuses it,
    // never committed as a silent resize.
    const transformed =
      rotationDeg !== 0 && studioDrawObjectRotationIsDropped(soleSelectedDraw)
        ? null
        : planStudioDrawObjectTransform({
            el: soleSelectedDraw,
            sourceBounds,
            targetBounds,
            rotationDeg,
          });
    next = transformed
      ? elements.map((element) => (element.id === transformed.id ? transformed : element))
      : [...elements];
  } else {
    next = planStudioGroupUniformResize({
      items: elements,
      selectedIds,
      sourceBounds,
      targetBounds,
      rotationDeg,
      isLocked,
    });
  }

  const nextById = new Map(next.map((element) => [element.id, element]));
  const changed = selectedIds.some((id) => nextById.get(id) !== currentById.get(id));
  if (!changed) {
    // A refused angle is judged on the angle itself -- not on the box Konva moved while pivoting
    // about the centre -- and the toast names the operation that was refused.
    const refusal =
      rotationDeg !== 0
        ? STUDIO_SELECTION_ROTATE_REFUSED_MESSAGE
        : boundsDiffer(targetBounds, sourceBounds)
          ? STUDIO_SELECTION_RESIZE_REFUSED_MESSAGE
          : null;
    return { kind: "unchanged", refusal };
  }
  return {
    kind: "changed",
    next,
    announcement: describeStudioSelectionTransform(
      selectedIds.length,
      sourceBounds,
      targetBounds,
      rotationDeg
    ),
  };
}
