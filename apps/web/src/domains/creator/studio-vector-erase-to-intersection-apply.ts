/**
 * Document-level planner for CSP-style vector erase-to-intersection.
 *
 * Pure core (`planStudioEraseToIntersection`) only knows polylines. This module picks the
 * nearest freehand pen stroke under a pointer, plans the cut against every other freehand pen,
 * and returns a next `El[]` ready for history commit. No React / Konva / history.
 */

import {
  locateStudioStrokeHit,
  planStudioEraseToIntersection,
  studioStrokePiecePatchFields,
  STUDIO_ERASE_TO_INTERSECTION_LABEL,
  type StudioStrokePerPointAttributes,
  type StudioStrokePiece,
} from "./studio-vector-erase-to-intersection";

import type { DrawEl, El } from "./studio-element-model";

export { STUDIO_ERASE_TO_INTERSECTION_LABEL, STUDIO_ERASE_TO_INTERSECTION_TIP } from "./studio-vector-erase-to-intersection";

const DEFAULT_HIT_PADDING_PX = 4;
const MIN_HIT_HALF_WIDTH_PX = 4;

export function isStudioVectorEraseTarget(el: El): el is DrawEl {
  if (el.type !== "draw") return false;
  if (el.mode === "eraser") return false;
  if (el.kind !== undefined && el.kind !== "freehand") return false;
  return Array.isArray(el.points) && el.points.length >= 4 && el.points.length % 2 === 0;
}

function hitToleranceForStroke(strokeWidth: number, paddingPx: number): number {
  const half = Math.max(MIN_HIT_HALF_WIDTH_PX, Math.abs(strokeWidth) * 0.5);
  return half + Math.max(0, paddingPx);
}

function attributesFromDraw(el: DrawEl): StudioStrokePerPointAttributes | undefined {
  const attributes: StudioStrokePerPointAttributes = {
    ...(el.pressures ? { pressures: el.pressures } : {}),
    ...(el.tiltXs ? { tiltXs: el.tiltXs } : {}),
    ...(el.tiltYs ? { tiltYs: el.tiltYs } : {}),
    ...(el.twists ? { twists: el.twists } : {}),
    ...(el.speeds ? { speeds: el.speeds } : {}),
    ...(el.tangentialPressures ? { tangentialPressures: el.tangentialPressures } : {}),
  };
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

function drawFromPiece(source: DrawEl, piece: StudioStrokePiece, id: string): DrawEl {
  const patch = studioStrokePiecePatchFields(piece);
  return {
    ...source,
    id,
    points: patch.points,
    ...(patch.pressures ? { pressures: patch.pressures } : { pressures: undefined }),
    ...(patch.tiltXs ? { tiltXs: patch.tiltXs } : { tiltXs: undefined }),
    ...(patch.tiltYs ? { tiltYs: patch.tiltYs } : { tiltYs: undefined }),
    ...(patch.twists ? { twists: patch.twists } : { twists: undefined }),
    ...(patch.speeds ? { speeds: patch.speeds } : { speeds: undefined }),
    ...(patch.tangentialPressures
      ? { tangentialPressures: patch.tangentialPressures }
      : { tangentialPressures: undefined }),
  };
}

/**
 * Drop explicit undefined attribute keys so we do not wipe sibling fields incorrectly when the
 * source never stored pressures (and so JSON/CRDT payloads stay compact).
 */
function compactDrawEl(el: DrawEl): DrawEl {
  const next: DrawEl = { ...el };
  if (next.pressures === undefined) delete next.pressures;
  if (next.tiltXs === undefined) delete next.tiltXs;
  if (next.tiltYs === undefined) delete next.tiltYs;
  if (next.twists === undefined) delete next.twists;
  if (next.speeds === undefined) delete next.speeds;
  if (next.tangentialPressures === undefined) delete next.tangentialPressures;
  return next;
}

export type StudioVectorEraseApplyResult =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true;
      readonly targetId: string;
      readonly nextElements: El[];
      readonly pieceCount: number;
      readonly erasedLengthPx: number;
      readonly label: string;
    };

export function planStudioVectorEraseToIntersectionApply(input: {
  readonly elements: readonly El[];
  readonly point: { readonly x: number; readonly y: number };
  /** Extra ids for pieces after the first (the first piece reuses the target id). */
  readonly allocateId: () => string;
  /** Added on top of strokeWidth/2 when testing pointer proximity. */
  readonly hitPaddingPx?: number;
  /** Optional lock/hidden filter. Geometry reference still uses every freehand pen. */
  readonly isEditable?: (el: DrawEl) => boolean;
}): StudioVectorEraseApplyResult {
  const { elements, point, allocateId } = input;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { ok: false, reason: "유효한 좌표가 아니에요." };
  }
  const padding = Number.isFinite(input.hitPaddingPx)
    ? Math.max(0, input.hitPaddingPx as number)
    : DEFAULT_HIT_PADDING_PX;

  const freehandPens = elements.filter(isStudioVectorEraseTarget);
  if (freehandPens.length === 0) {
    return { ok: false, reason: "지울 자유선이 없어요." };
  }

  let best:
    | {
        el: DrawEl;
        distancePx: number;
        hit: NonNullable<ReturnType<typeof locateStudioStrokeHit>>;
        tolerance: number;
      }
    | null = null;

  for (const el of freehandPens) {
    if (input.isEditable && !input.isEditable(el)) continue;
    const hit = locateStudioStrokeHit(el.points, point);
    if (!hit) continue;
    const tolerance = hitToleranceForStroke(el.strokeWidth, padding);
    if (hit.distancePx > tolerance) continue;
    if (!best || hit.distancePx < best.distancePx) {
      best = { el, distancePx: hit.distancePx, hit, tolerance };
    }
  }

  if (!best) {
    return { ok: false, reason: "선 위를 눌러 주세요." };
  }

  const target = best.el;
  const others = freehandPens
    .filter((el) => el.id !== target.id)
    .map((el) => el.points);

  const planned = planStudioEraseToIntersection(
    {
      points: target.points,
      attributes: attributesFromDraw(target),
    },
    best.hit,
    others,
    {
      hitTolerancePx: best.tolerance,
      touchTolerancePx: Math.max(0, Math.abs(target.strokeWidth) * 0.5),
    }
  );

  if (!planned.ok) {
    return { ok: false, reason: planned.reason };
  }

  if (planned.pieces.length === 0) {
    return {
      ok: true,
      targetId: target.id,
      nextElements: elements.filter((el) => el.id !== target.id),
      pieceCount: 0,
      erasedLengthPx: planned.erasedLengthPx,
      label: STUDIO_ERASE_TO_INTERSECTION_LABEL,
    };
  }

  const replacements: DrawEl[] = planned.pieces.map((piece, index) =>
    compactDrawEl(drawFromPiece(target, piece, index === 0 ? target.id : allocateId()))
  );

  const nextElements: El[] = [];
  for (const el of elements) {
    if (el.id !== target.id) {
      nextElements.push(el);
      continue;
    }
    for (const replacement of replacements) nextElements.push(replacement);
  }

  return {
    ok: true,
    targetId: target.id,
    nextElements,
    pieceCount: replacements.length,
    erasedLengthPx: planned.erasedLengthPx,
    label: STUDIO_ERASE_TO_INTERSECTION_LABEL,
  };
}
