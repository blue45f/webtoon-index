/**
 * Konva adapter for panel-clip tracking: which node hosts the clip during a gesture, and how to
 * re-point it without a React commit or a change of parentage.
 *
 * No reparenting, in either host: `restoreStudioSingleDrawTransformLayer` restores only nodes
 * still sitting where the lift put them (anything moved elsewhere is treated as claimed by another
 * owner and left behind), and the parked-chrome bookkeeping keys off the wrapper's parent. Both
 * stay untouched because a clip here is only ever attrs or a `clipFunc` written on an existing
 * node.
 *
 * Two hosts, because the two crossings start from different scene graphs:
 *
 *   - A stroke that STARTS clipped refuses the lift (its wrapper's parent is the clip `Group`, not
 *     the main Layer) and previews in place. `StudioCanvasViewportDocumentLayer` renders that
 *     `Group` per element, so rewriting its `clipX/clipY/clipWidth/clipHeight` affects this stroke
 *     and nothing else. That is the `attrs` host.
 *   - A stroke that STARTS unclipped renders with no clip `Group` at all, so nothing exists to
 *     rewrite; the lift is what gives us a node to drive. The drag `Layer` is the wrong one to
 *     drive, though: `beginStudioSingleDrawTransformLayer` moves the wrapper, the proxy AND the
 *     Transformer into it, so a Layer clip would swallow the resize outline and any handle that
 *     falls outside the panel — chrome that is actively steering the gesture. The clip therefore
 *     goes on the WRAPPER, the only container holding this stroke's ink and nothing else. That is
 *     the `func` host.
 *
 * A wrapper's local space is not document space — the preview writes position, rotation, scale and
 * offset onto it every frame — so the panel rect cannot be expressed there as four axis-aligned
 * numbers, and under rotation it is not an axis-aligned rect at all. `clipFunc` takes an arbitrary
 * path instead, and evaluating it at DRAW time against the node's current transform means the clip
 * is derived from whatever pose the frame settled on, with nothing to keep in sync.
 *
 * When neither host exists — a stroke whose lift was refused for some OTHER reason, a cached
 * ancestor or a composite-sensitive sibling — the clip cannot be re-pointed for that gesture. That
 * case is left alone rather than refused: the preview still tracks position, scale and rotation
 * correctly and only the clip lands at release, which is exactly today's behaviour and strictly
 * better than standing the whole preview down.
 */
import { studioLiveTransformClipChanged } from "./studio-live-transform-clip-tracking";

import type { StudioLiveTransformClipRect } from "./studio-live-transform-clip-tracking";
import type Konva from "konva";

/**
 * Attr holding this gesture's claim on a container: what it last WROTE, and the value to restore.
 *
 * Both halves are needed because the clip can change under us. A collaborator resizing the
 * containing frame mid-gesture re-renders the clip `Group` with new props without changing the
 * stroke's identity, so the gesture continues while React installs a newer rect. `written` lets
 * cleanup tell its own write from that newer one and stand down instead of clobbering it; React
 * has already rendered the new props, so a later render with unchanged values would not repair an
 * imperative mutation.
 *
 * `restore` is the baseline, and it is re-taken whenever such a divergence is seen — the pointer
 * leaving and re-entering the frame is enough to make this module write again, and a claim that
 * simply reset itself would then restore the stale PRE-resize rect at release, leaving the stroke
 * clipped to a frame size that no longer exists.
 */
export const STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR = "studioLiveTransformClipOwned";

interface ClipContainer extends Konva.Node {
  getClipWidth?: () => number | undefined;
  getClipHeight?: () => number | undefined;
  clipFunc?: (value?: unknown) => unknown;
}

/** How a host expresses its clip: rect attrs in document space, or a path in the node's own. */
export type StudioLiveTransformClipHostMode = "attrs" | "func";

export interface StudioLiveTransformClipHost {
  readonly node: Konva.Node;
  readonly mode: StudioLiveTransformClipHostMode;
}

function asContainer(node: Konva.Node | null | undefined): ClipContainer | null {
  if (!node) return null;
  const candidate = node as ClipContainer;
  return typeof candidate.clipFunc === "function" ? candidate : null;
}

interface StudioLiveTransformClipClaim {
  /** The last rect this module wrote — `null` when it cleared the clip. */
  readonly written: StudioLiveTransformClipRect | null;
  /** What the host should go back to when the gesture ends. */
  readonly restore: StudioLiveTransformClipRect | null;
}

function readClaim(node: Konva.Node): StudioLiveTransformClipClaim | undefined {
  return node.getAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR) as
    | StudioLiveTransformClipClaim
    | undefined;
}

/**
 * The container whose clip this stroke's ink should be driven through, or `null` for none.
 *
 * Prefers the lifted wrapper, because a lifted stroke is one the document layer rendered without
 * any clip `Group`, so the wrapper is the only node that can ADD a clip to it. Otherwise the
 * nearest ancestor already carrying one — the per-element `Group` built for a panel member.
 */
export function findStudioLiveTransformClipHost(
  wrapper: Konva.Node | null,
  dragLayer: Konva.Node | null,
): StudioLiveTransformClipHost | null {
  if (!wrapper) return null;
  if (dragLayer && wrapper.getLayer() === dragLayer && asContainer(wrapper)) {
    return { node: wrapper, mode: "func" };
  }
  let current: Konva.Node | null = wrapper.getParent();
  while (current) {
    const candidate = asContainer(current);
    if (
      candidate
      && typeof candidate.getClipWidth === "function"
      && (candidate.getClipWidth() ?? 0) > 0
    ) {
      return { node: current, mode: "attrs" };
    }
    current = current.getParent();
  }
  return null;
}

/** Reads the clip a host currently applies, in the shape the tracker compares. */
export function readStudioLiveTransformClip(
  host: StudioLiveTransformClipHost | null,
): StudioLiveTransformClipRect | null {
  if (!host) return null;
  if (host.mode === "func") {
    // A `clipFunc` is a closure, not readable geometry, so what this module wrote is the only
    // honest answer — and nothing else writes `clipFunc` on a stroke wrapper.
    return readClaim(host.node)?.written ?? null;
  }
  const node = asContainer(host.node);
  if (!node) return null;
  const width = node.getClipWidth?.() ?? 0;
  const height = node.getClipHeight?.() ?? 0;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    x: Number(node.getAttr("clipX") ?? 0),
    y: Number(node.getAttr("clipY") ?? 0),
    width,
    height,
  };
}

/**
 * A `clipFunc` that paths `rect` — given in the host's PARENT space, which for a lifted wrapper is
 * the drag Layer's, i.e. document space — through the node's own transform at draw time.
 */
function documentRectClipFunc(
  node: Konva.Node,
  rect: StudioLiveTransformClipRect,
): (ctx: { beginPath: () => void; moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void; closePath: () => void }) => void {
  return (ctx) => {
    const inverse = node.getTransform().copy().invert();
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((point) => inverse.point(point));
    ctx.beginPath();
    corners.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
  };
}

/**
 * Points `host` at `rect`, or clears its clip when `rect` is null. Returns true when the scene
 * graph actually changed, so callers can skip the redraw on the overwhelming majority of frames
 * where the panel verdict has not moved.
 */
export function applyStudioLiveTransformClip(
  host: StudioLiveTransformClipHost | null,
  rect: StudioLiveTransformClipRect | null,
): boolean {
  if (!host) return false;
  const node = asContainer(host.node);
  if (!node) return false;
  const current = readStudioLiveTransformClip(host);
  const claim = readClaim(node);
  // Re-take the baseline whenever the host no longer holds what this module last wrote: someone
  // else owns that value now, and the pre-gesture rect it replaced is no longer what "restore"
  // means. Without this, a frame written after an external update would silently re-claim the host
  // and cleanup would put the stale rect back.
  const restore =
    claim === undefined || studioLiveTransformClipChanged(current, claim.written)
      ? current
      : claim.restore;
  if (!studioLiveTransformClipChanged(current, rect)) {
    // Nothing to write, but a re-taken baseline still has to be recorded — the divergence is just
    // as real on a frame whose verdict happens to match what the other owner wrote.
    if (claim !== undefined) {
      node.setAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR, { written: rect, restore });
    }
    return false;
  }
  writeClip(node, host.mode, rect);
  node.setAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR, { written: rect, restore });
  return true;
}

/** The raw scene-graph write, with no claim bookkeeping. */
function writeClip(
  node: ClipContainer,
  mode: StudioLiveTransformClipHostMode,
  rect: StudioLiveTransformClipRect | null,
): void {
  if (mode === "func") {
    node.clipFunc?.(rect ? documentRectClipFunc(node, rect) : undefined);
  } else if (rect) {
    node.setAttr("clipX", rect.x);
    node.setAttr("clipY", rect.y);
    node.setAttr("clipWidth", rect.width);
    node.setAttr("clipHeight", rect.height);
  } else {
    // Konva treats a zero/absent clip size as "no clip", so clearing the size is the disable.
    node.setAttr("clipWidth", undefined);
    node.setAttr("clipHeight", undefined);
  }
}

/**
 * Restores the clip this module took over, to the baseline recorded in its claim.
 *
 * Only touches a host it claimed AND still holding exactly what it last wrote, so a clip the
 * product changed for its own reasons mid-gesture is left as the newer value rather than reverted.
 *
 * @param fallback used only when the claim carries no baseline of its own.
 */
export function restoreStudioLiveTransformClip(
  host: StudioLiveTransformClipHost | null,
  fallback: StudioLiveTransformClipRect | null,
): boolean {
  if (!host) return false;
  const node = asContainer(host.node);
  if (!node) return false;
  const claim = readClaim(node);
  if (claim === undefined) return false;
  // Read BEFORE dropping the claim: in `func` mode the claim IS the readable state.
  const diverged = studioLiveTransformClipChanged(
    readStudioLiveTransformClip(host),
    claim.written,
  );
  node.setAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR, undefined);
  if (diverged) {
    // Someone else owns this clip now. Drop the claim without touching their value.
    return false;
  }
  // `restore` is legitimately `null` for "no clip", so the fallback is only for a claim that
  // carries no baseline at all — never a nullish coalesce, which would turn "clear it" into
  // "put the caller's rect back".
  const target = claim.restore === undefined ? fallback : claim.restore;
  if (!studioLiveTransformClipChanged(claim.written, target)) return false;
  writeClip(node, host.mode, target);
  return true;
}
