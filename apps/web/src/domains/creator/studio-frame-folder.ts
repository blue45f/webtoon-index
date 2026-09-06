/**
 * CSP-class frame-folder seed + shared-gutter co-edit.
 *
 * 1) Bind selected layers under a contiguous layer group named after a frame (folder chrome).
 * 2) Force `noClip: false` on members so existing `containingPanel` clip keeps them inside the cut.
 * 3) Shared gutter midlines for **axis-aligned and diagonal/poly** abutting frames.
 * 4) Co-edit drag: resize/shift both frames (gap preserved) + reflow children in the translated cut.
 *
 * Nested multi-level folder ownership stacks and freehand multi-panel topology remain deferred.
 * Pure + immutable; no DOM/Konva. StudioPage owns React state and history commits.
 */

import {
  createLayerGroup,
  groupItems,
  type LayerGroup,
  type LayerItemLike,
} from "./studio-layers";

export interface FrameFolderFrameLike {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Local polygon [x0,y0,...] relative to x/y — set after diagonal panel split. */
  readonly points?: readonly number[];
  readonly name?: string;
  readonly type?: string;
}

export interface FrameFolderBindInput<T extends LayerItemLike & { noClip?: boolean }> {
  /** Frame element id that owns the folder. */
  readonly frameId: string;
  readonly frameLabel: string;
  /** New group id (caller generates uid). */
  readonly groupId: string;
  /** Layer ids to place inside the folder (frame itself is excluded). */
  readonly seedIds: readonly string[];
  readonly items: readonly T[];
  readonly groups: readonly LayerGroup[];
}

export interface FrameFolderBindResult<T extends LayerItemLike & { noClip?: boolean }> {
  readonly group: LayerGroup;
  readonly items: readonly T[];
  /** Member ids that had noClip forced off (history / announce). */
  readonly clearedNoClipIds: readonly string[];
  readonly memberIds: readonly string[];
}

/**
 * Shared gutter between two cuts.
 * - axis "h" | "v": classic axis-aligned gap (pos/from/to are meaningful).
 * - axis "d": diagonal/poly cut — use midline endpoints + unit normal.
 */
export interface SharedGutterSegment {
  readonly axis: "h" | "v" | "d";
  /** Axis-aligned: constant coord of midline. Diagonal: midpoint projection (diagnostic). */
  readonly pos: number;
  readonly from: number;
  readonly to: number;
  /** Midline segment endpoints (document space) — always set for rendering. */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Unit normal from frameA toward frameB. */
  readonly nx: number;
  readonly ny: number;
  readonly frameAId: string;
  readonly frameBId: string;
  /** Measured gap width between the two frame edges (px). */
  readonly gap: number;
}

/** Max gap treated as a "shared gutter" candidate (generous for panel-split gutters). */
export const FRAME_FOLDER_SHARED_GUTTER_MAX_GAP_PX = 120;
/** Edge coplanarity / touch epsilon (px). */
export const FRAME_FOLDER_SHARED_GUTTER_EPSILON_PX = 1.5;
/** Minimum overlap along the shared edge axis to count as a gutter (px). */
export const FRAME_FOLDER_SHARED_GUTTER_MIN_OVERLAP_PX = 8;
/** Minimum frame side after a shared-gutter drag (matches panel-split floor). */
export const FRAME_FOLDER_MIN_SIDE_PX = 24;

export interface FrameBoxPatch {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Local polygon when the frame is non-rect (diagonal split); omit for pure AABB frames. */
  readonly points?: readonly number[];
}

export interface ElementTranslatePatch {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

export interface SharedGutterDragPlan {
  readonly framePatches: readonly FrameBoxPatch[];
  /** Delta actually applied after min-side clamping (may be 0). */
  readonly appliedDelta: number;
  /** Axis-aligned: updated midline constant. Diagonal: unused (0). */
  readonly nextSegmentPos: number;
  readonly childTranslates: readonly ElementTranslatePatch[];
}

export interface SharedGutterDragElementLike {
  readonly id: string;
  readonly type?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly points?: readonly number[];
  readonly hidden?: boolean;
}

function clampMinSide(value: number, minSide: number): number {
  if (!Number.isFinite(value)) return minSide;
  return Math.max(minSide, value);
}

function frameCenterInside(
  el: SharedGutterDragElementLike,
  frame: FrameFolderFrameLike
): boolean {
  if (el.type === "frame") return false;
  let x = el.x;
  let y = el.y;
  let w = el.width ?? 0;
  let h = el.height ?? 0;
  if (el.type === "draw" && el.points && el.points.length >= 2) {
    let minX = el.points[0]!;
    let minY = el.points[1]!;
    let maxX = minX;
    let maxY = minY;
    for (let i = 2; i < el.points.length; i += 2) {
      const px = el.points[i]!;
      const py = el.points[i + 1]!;
      if (px < minX) minX = px;
      else if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      else if (py > maxY) maxY = py;
    }
    x = minX;
    y = minY;
    w = maxX - minX;
    h = maxY - minY;
  }
  if (
    x === undefined ||
    y === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  ) {
    return false;
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    cx >= frame.x &&
    cx <= frame.x + frame.width &&
    cy >= frame.y &&
    cy <= frame.y + frame.height
  );
}

function snapshotFramePatch(frame: FrameFolderFrameLike): FrameBoxPatch {
  return {
    id: frame.id,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    ...(frame.points && frame.points.length >= 6 ? { points: frame.points } : {}),
  };
}

function emptyDragPlan(
  a: FrameFolderFrameLike,
  b: FrameFolderFrameLike,
  segment: SharedGutterSegment
): SharedGutterDragPlan {
  return {
    framePatches: [snapshotFramePatch(a), snapshotFramePatch(b)],
    appliedDelta: 0,
    nextSegmentPos: segment.pos,
    childTranslates: [],
  };
}

/**
 * Plan co-edit of a shared gutter: moving the midline resizes both frames while preserving
 * gap, then reflows children whose center sat in the frame that translated (B / right / bottom).
 *
 * `delta` is document-space along the segment normal (A → B):
 * - axis "v": positive grows the left frame into the gutter
 * - axis "h": positive grows the top frame into the gutter
 * - axis "d": positive grows frameA along (nx,ny) into the gutter (poly vertices on the cut move)
 */
export function planSharedGutterDrag(input: {
  readonly segment: SharedGutterSegment;
  readonly framesById: ReadonlyMap<string, FrameFolderFrameLike>;
  readonly delta: number;
  readonly minSidePx?: number;
  readonly elements?: readonly SharedGutterDragElementLike[];
}): SharedGutterDragPlan | null {
  const minSide = Math.max(1, input.minSidePx ?? FRAME_FOLDER_MIN_SIDE_PX);
  const frameA = input.framesById.get(input.segment.frameAId);
  const frameB = input.framesById.get(input.segment.frameBId);
  if (!frameA || !frameB) return null;
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    return emptyDragPlan(frameA, frameB, input.segment);
  }

  // Diagonal / poly cut: move shared-edge vertices along the normal.
  if (input.segment.axis === "d") {
    return planDiagonalSharedGutterDrag({
      segment: input.segment,
      frameA,
      frameB,
      delta: input.delta,
      minSide,
      elements: input.elements,
    });
  }

  let applied = input.delta;
  if (input.segment.axis === "v") {
    const maxGrow = frameB.width - minSide;
    const maxShrink = frameA.width - minSide;
    applied = Math.max(-maxShrink, Math.min(maxGrow, applied));
    if (applied === 0) return emptyDragPlan(frameA, frameB, input.segment);
    const leftPatch: FrameBoxPatch = {
      id: frameA.id,
      x: frameA.x,
      y: frameA.y,
      width: clampMinSide(frameA.width + applied, minSide),
      height: frameA.height,
    };
    const rightPatch: FrameBoxPatch = {
      id: frameB.id,
      x: frameB.x + applied,
      y: frameB.y,
      width: clampMinSide(frameB.width - applied, minSide),
      height: frameB.height,
    };
    const childTranslates: ElementTranslatePatch[] = [];
    for (const el of input.elements ?? []) {
      if (el.hidden || el.id === frameA.id || el.id === frameB.id) continue;
      if (frameCenterInside(el, frameB)) {
        childTranslates.push({ id: el.id, dx: applied, dy: 0 });
      }
    }
    return {
      framePatches: [leftPatch, rightPatch],
      appliedDelta: applied,
      nextSegmentPos: input.segment.pos + applied,
      childTranslates,
    };
  }

  // Horizontal gutter
  const maxGrow = frameB.height - minSide;
  const maxShrink = frameA.height - minSide;
  applied = Math.max(-maxShrink, Math.min(maxGrow, applied));
  if (applied === 0) return emptyDragPlan(frameA, frameB, input.segment);
  const topPatch: FrameBoxPatch = {
    id: frameA.id,
    x: frameA.x,
    y: frameA.y,
    width: frameA.width,
    height: clampMinSide(frameA.height + applied, minSide),
  };
  const bottomPatch: FrameBoxPatch = {
    id: frameB.id,
    x: frameB.x,
    y: frameB.y + applied,
    width: frameB.width,
    height: clampMinSide(frameB.height - applied, minSide),
  };
  const childTranslates: ElementTranslatePatch[] = [];
  for (const el of input.elements ?? []) {
    if (el.hidden || el.id === frameA.id || el.id === frameB.id) continue;
    if (frameCenterInside(el, frameB)) {
      childTranslates.push({ id: el.id, dx: 0, dy: applied });
    }
  }
  return {
    framePatches: [topPatch, bottomPatch],
    appliedDelta: applied,
    nextSegmentPos: input.segment.pos + applied,
    childTranslates,
  };
}

function planDiagonalSharedGutterDrag(input: {
  segment: SharedGutterSegment;
  frameA: FrameFolderFrameLike;
  frameB: FrameFolderFrameLike;
  delta: number;
  minSide: number;
  elements?: readonly SharedGutterDragElementLike[];
}): SharedGutterDragPlan {
  const { segment, frameA, frameB, minSide } = input;
  const nx = segment.nx;
  const ny = segment.ny;
  // Limit by how far B can shrink along the normal (project AABB size onto normal).
  const extentB = Math.abs(frameB.width * nx) + Math.abs(frameB.height * ny);
  const extentA = Math.abs(frameA.width * nx) + Math.abs(frameA.height * ny);
  const maxGrow = Math.max(0, extentB - minSide);
  const maxShrink = Math.max(0, extentA - minSide);
  const applied = Math.max(-maxShrink, Math.min(maxGrow, input.delta));
  if (applied === 0) return emptyDragPlan(frameA, frameB, segment);

  const patchA = shiftFrameAlongNormal(frameA, nx, ny, applied, /*growEdge*/ true);
  const patchB = shiftFrameAlongNormal(frameB, nx, ny, applied, /*growEdge*/ false);
  if (!patchA || !patchB) return emptyDragPlan(frameA, frameB, segment);
  if (patchA.width < minSide || patchA.height < minSide || patchB.width < minSide || patchB.height < minSide) {
    return emptyDragPlan(frameA, frameB, segment);
  }

  const childTranslates: ElementTranslatePatch[] = [];
  const dx = applied * nx;
  const dy = applied * ny;
  for (const el of input.elements ?? []) {
    if (el.hidden || el.id === frameA.id || el.id === frameB.id) continue;
    if (frameCenterInside(el, frameB)) {
      childTranslates.push({ id: el.id, dx, dy });
    }
  }
  return {
    framePatches: [patchA, patchB],
    appliedDelta: applied,
    nextSegmentPos: 0,
    childTranslates,
  };
}

/**
 * Move the frame's cut-facing edge along the unit normal.
 * growEdge=true: frameA expands into the gutter (cut vertices move +delta·n).
 * growEdge=false: frameB is pushed away and shrinks (all geometry translates +delta·n so the
 * far side stays put relative to document only when combined with A growth — for poly we
 * translate cut vertices of B by +delta·n as well, matching axis-aligned "x += delta").
 */
function shiftFrameAlongNormal(
  frame: FrameFolderFrameLike,
  nx: number,
  ny: number,
  delta: number,
  growEdge: boolean
): FrameBoxPatch | null {
  const abs = absoluteFramePolygon(frame);
  if (abs.length < 6) return null;
  // Vertices near the shared cut are those whose projection onto n is extreme on the B-facing side.
  // For A (grow): max projection onto n (edge toward B). For B (shrink/push): min projection onto n.
  let extreme = growEdge ? -Infinity : Infinity;
  for (let i = 0; i < abs.length; i += 2) {
    const proj = abs[i]! * nx + abs[i + 1]! * ny;
    if (growEdge) extreme = Math.max(extreme, proj);
    else extreme = Math.min(extreme, proj);
  }
  const edgeBand = FRAME_FOLDER_SHARED_GUTTER_EPSILON_PX + 2;
  const moved = abs.slice();
  for (let i = 0; i < moved.length; i += 2) {
    const proj = abs[i]! * nx + abs[i + 1]! * ny;
    if (Math.abs(proj - extreme) <= edgeBand) {
      moved[i] = abs[i]! + delta * nx;
      moved[i + 1] = abs[i + 1]! + delta * ny;
    }
  }
  return framePatchFromAbsolutePolygon(frame.id, moved);
}

function absoluteFramePolygon(frame: FrameFolderFrameLike): number[] {
  if (frame.points && frame.points.length >= 6) {
    const out = new Array<number>(frame.points.length);
    for (let i = 0; i < frame.points.length; i += 2) {
      out[i] = frame.x + frame.points[i]!;
      out[i + 1] = frame.y + frame.points[i + 1]!;
    }
    return out;
  }
  const { x, y, width, height } = frame;
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

function framePatchFromAbsolutePolygon(id: string, poly: number[]): FrameBoxPatch | null {
  if (poly.length < 6) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const px = poly[i]!;
    const py = poly[i + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const x = round2(minX);
  const y = round2(minY);
  const width = round2(maxX - minX);
  const height = round2(maxY - minY);
  const local = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    local[i] = round2(poly[i]! - x);
    local[i + 1] = round2(poly[i + 1]! - y);
  }
  // Collapse pure rectangles to AABB-only patches (matches panel-split frameShapeFromPolygon).
  if (local.length === 8) {
    const corners = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ] as const;
    let isRect = true;
    for (let i = 0; i < 4; i += 1) {
      const vx = local[i * 2]!;
      const vy = local[i * 2 + 1]!;
      if (!corners.some(([cx, cy]) => Math.abs(vx - cx) < 0.02 && Math.abs(vy - cy) < 0.02)) {
        isRect = false;
        break;
      }
    }
    if (isRect) return { id, x, y, width, height };
  }
  return { id, x, y, width, height, points: local };
}

/**
 * Apply a gutter drag plan onto a flat element list (frames resized, children translated).
 * Pure: returns a new array; unchanged elements keep identity.
 */
export function applySharedGutterDragPlan<T extends SharedGutterDragElementLike>(
  elements: readonly T[],
  plan: SharedGutterDragPlan
): readonly T[] {
  if (plan.appliedDelta === 0 && plan.childTranslates.length === 0) return elements;
  const frames = new Map(plan.framePatches.map((patch) => [patch.id, patch]));
  const moves = new Map(plan.childTranslates.map((patch) => [patch.id, patch]));
  return elements.map((el) => {
    const frame = frames.get(el.id);
    if (frame) {
      const next = {
        ...el,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      } as T;
      if (frame.points) {
        return { ...next, points: frame.points };
      }
      // Clear stale diagonal points when the patch collapses to an AABB.
      if ("points" in next && next.points !== undefined && !frame.points) {
        const { points: _drop, ...rest } = next as T & { points?: readonly number[] };
        return rest as T;
      }
      return next;
    }
    const move = moves.get(el.id);
    if (!move || (move.dx === 0 && move.dy === 0)) return el;
    if (el.type === "draw" && Array.isArray(el.points)) {
      const points = el.points.map((value, index) =>
        index % 2 === 0 ? value + move.dx : value + move.dy
      );
      return { ...el, points };
    }
    if (typeof el.x === "number" && typeof el.y === "number") {
      return { ...el, x: el.x + move.dx, y: el.y + move.dy };
    }
    return el;
  });
}

/** Stable key for a gutter segment (drag session / undo coalesce). */
export function sharedGutterSegmentKey(segment: SharedGutterSegment): string {
  return `${segment.axis}:${segment.frameAId}:${segment.frameBId}`;
}

function freezeGroup(group: LayerGroup): LayerGroup {
  return Object.freeze({ ...group });
}

/**
 * Build a frame-folder group name (CSP-class "컷 폴더").
 * Labels are truncated to keep navigator chrome readable.
 */
export function formatFrameFolderGroupName(frameLabel: string): string {
  const trimmed = frameLabel.trim().slice(0, 120);
  return trimmed.length > 0 ? `컷 폴더 · ${trimmed}` : "컷 폴더";
}

/**
 * Plan binding seed layers into a new contiguous group tied to a frame (by naming + member clip).
 * Returns null when there is nothing to bind (empty seeds after filtering the frame itself).
 */
export function planBindSelectionToFrameFolder<
  T extends LayerItemLike & { noClip?: boolean },
>(input: FrameFolderBindInput<T>): FrameFolderBindResult<T> | null {
  if (!input.frameId || !input.groupId) return null;
  const seedSet = new Set(
    input.seedIds.filter((id) => id && id !== input.frameId)
  );
  if (seedSet.size === 0) return null;

  const known = new Set(input.items.map((item) => item.id));
  const memberIds = [...seedSet].filter((id) => known.has(id));
  if (memberIds.length === 0) return null;

  const group = freezeGroup(
    createLayerGroup(input.groupId, formatFrameFolderGroupName(input.frameLabel))
  );
  // Contiguous regroup (existing layer-folder engine).
  let nextItems = groupItems(input.items as T[], memberIds, group.id) as T[];

  const clearedNoClipIds: string[] = [];
  nextItems = nextItems.map((item) => {
    if (!memberIds.includes(item.id)) return item;
    if (item.noClip === true) {
      clearedNoClipIds.push(item.id);
      return { ...item, noClip: false };
    }
    // Explicit false so export/CRDT paths see a deliberate clip-to-panel intent.
    if (item.noClip === undefined) {
      return { ...item, noClip: false };
    }
    return item;
  });

  return {
    group,
    items: nextItems,
    clearedNoClipIds,
    memberIds,
  };
}

function rangeOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number
): { from: number; to: number; length: number } | null {
  const from = Math.max(a0, b0);
  const to = Math.min(a1, b1);
  const length = to - from;
  if (!(length > 0)) return null;
  return { from, to, length };
}

interface FrameEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function frameEdges(frame: FrameFolderFrameLike): FrameEdge[] {
  const poly = absoluteFramePolygon(frame);
  const edges: FrameEdge[] = [];
  const n = Math.floor(poly.length / 2);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    edges.push({
      x1: poly[i * 2]!,
      y1: poly[i * 2 + 1]!,
      x2: poly[j * 2]!,
      y2: poly[j * 2 + 1]!,
    });
  }
  return edges;
}

function tryGutterFromParallelEdges(
  edgeA: FrameEdge,
  edgeB: FrameEdge,
  frameAId: string,
  frameBId: string,
  maxGap: number,
  epsilon: number,
  minOverlap: number
): SharedGutterSegment | null {
  const adx = edgeA.x2 - edgeA.x1;
  const ady = edgeA.y2 - edgeA.y1;
  const bdx = edgeB.x2 - edgeB.x1;
  const bdy = edgeB.y2 - edgeB.y1;
  const alen = Math.hypot(adx, ady);
  const blen = Math.hypot(bdx, bdy);
  if (alen < minOverlap || blen < minOverlap) return null;
  // Parallel when |cross| of unit dirs is small.
  const cross = Math.abs(adx * bdy - ady * bdx) / (alen * blen);
  if (cross > 0.12) return null; // ~7°

  const dirX = adx / alen;
  const dirY = ady / alen;
  let nx = -dirY;
  let ny = dirX;
  const midAx = (edgeA.x1 + edgeA.x2) / 2;
  const midAy = (edgeA.y1 + edgeA.y2) / 2;
  const midBx = (edgeB.x1 + edgeB.x2) / 2;
  const midBy = (edgeB.y1 + edgeB.y2) / 2;
  let gap = (midBx - midAx) * nx + (midBy - midAy) * ny;
  let aId = frameAId;
  let bId = frameBId;
  if (gap < 0) {
    gap = -gap;
    nx = -nx;
    ny = -ny;
  }
  if (gap > maxGap + epsilon) return null;
  if (gap < -epsilon) return null;
  gap = Math.max(0, gap);

  // Overlap along edge direction.
  const proj = (x: number, y: number) => x * dirX + y * dirY;
  const a0 = proj(edgeA.x1, edgeA.y1);
  const a1 = proj(edgeA.x2, edgeA.y2);
  const b0 = proj(edgeB.x1, edgeB.y1);
  const b1 = proj(edgeB.x2, edgeB.y2);
  const overlap = rangeOverlap(
    Math.min(a0, a1),
    Math.max(a0, a1),
    Math.min(b0, b1),
    Math.max(b0, b1)
  );
  if (!overlap || overlap.length < minOverlap) return null;

  // Midline along the average normal position between the two edges.
  const midN =
    ((midAx * nx + midAy * ny) + (midBx * nx + midBy * ny)) / 2;
  const x1 = overlap.from * dirX + midN * nx;
  const y1 = overlap.from * dirY + midN * ny;
  const x2 = overlap.to * dirX + midN * nx;
  const y2 = overlap.to * dirY + midN * ny;

  const axisAligned =
    (Math.abs(nx) > 0.98 && Math.abs(ny) < 0.15) ||
    (Math.abs(ny) > 0.98 && Math.abs(nx) < 0.15);
  if (axisAligned) {
    if (Math.abs(nx) > Math.abs(ny)) {
      // Vertical gutter: normal points left -> right (+x)
      if (nx < 0) {
        const tmp = aId;
        aId = bId;
        bId = tmp;
      }
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      const posX = (x1 + x2) / 2;
      return {
        axis: "v",
        pos: posX,
        from: minY,
        to: maxY,
        x1: posX,
        y1: minY,
        x2: posX,
        y2: maxY,
        nx: 1,
        ny: 0,
        frameAId: aId,
        frameBId: bId,
        gap,
      };
    }
    // Horizontal gutter: normal points top -> bottom (+y)
    if (ny < 0) {
      const tmp = aId;
      aId = bId;
      bId = tmp;
    }
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const posY = (y1 + y2) / 2;
    return {
      axis: "h",
      pos: posY,
      from: minX,
      to: maxX,
      x1: minX,
      y1: posY,
      x2: maxX,
      y2: posY,
      nx: 0,
      ny: 1,
      frameAId: aId,
      frameBId: bId,
      gap,
    };
  }

  return {
    axis: "d",
    pos: midN,
    from: overlap.from,
    to: overlap.to,
    x1,
    y1,
    x2,
    y2,
    nx,
    ny,
    frameAId: aId,
    frameBId: bId,
    gap,
  };
}

/**
 * Detect frame pairs that share a near-touching edge with a gutter gap.
 * Supports axis-aligned AABB pairs and diagonal/poly cuts (FrameEl.points).
 */
export function planSharedGutterSegments(
  frames: readonly FrameFolderFrameLike[],
  options: {
    maxGapPx?: number;
    epsilonPx?: number;
    minOverlapPx?: number;
  } = {}
): readonly SharedGutterSegment[] {
  const maxGap = options.maxGapPx ?? FRAME_FOLDER_SHARED_GUTTER_MAX_GAP_PX;
  const epsilon = options.epsilonPx ?? FRAME_FOLDER_SHARED_GUTTER_EPSILON_PX;
  const minOverlap = options.minOverlapPx ?? FRAME_FOLDER_SHARED_GUTTER_MIN_OVERLAP_PX;
  if (frames.length < 2 || !(maxGap >= 0)) return Object.freeze([]);

  const valid = frames.filter(
    (frame) =>
      frame.id &&
      Number.isFinite(frame.x) &&
      Number.isFinite(frame.y) &&
      Number.isFinite(frame.width) &&
      Number.isFinite(frame.height) &&
      frame.width > 0 &&
      frame.height > 0
  );
  const segments: SharedGutterSegment[] = [];
  const seen = new Set<string>();

  const pushUnique = (segment: SharedGutterSegment) => {
    const key = `${segment.axis}:${segment.frameAId}:${segment.frameBId}`;
    const keySwap = `${segment.axis}:${segment.frameBId}:${segment.frameAId}`;
    if (seen.has(key) || seen.has(keySwap)) return;
    seen.add(key);
    segments.push(segment);
  };

  for (let i = 0; i < valid.length; i += 1) {
    const a = valid[i]!;
    for (let j = i + 1; j < valid.length; j += 1) {
      const b = valid[j]!;
      // Prefer poly edge pairing when either frame is non-rect (diagonal split).
      const edgesA = frameEdges(a);
      const edgesB = frameEdges(b);
      for (const edgeA of edgesA) {
        for (const edgeB of edgesB) {
          const found = tryGutterFromParallelEdges(
            edgeA,
            edgeB,
            a.id,
            b.id,
            maxGap,
            epsilon,
            minOverlap
          );
          if (found) pushUnique(found);
        }
      }
    }
  }

  return Object.freeze(segments);
}
