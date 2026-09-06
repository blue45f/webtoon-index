/**
 * Keeps selection chrome pinned to a draw(선화) element while Konva drags it.
 *
 * Coordinate elements carry their position in the document, so a Konva Transformer bound to the
 * node follows it for free. A stroke does not: its geometry lives in `points`, the wrapper node is
 * translated imperatively for the duration of the gesture, and the offset is only baked into
 * `points` at drag end. Every piece of chrome derived from document state therefore stands still
 * while the ink moves.
 *
 * Measured on the shipped build before this existed (`tests/benchmarks/harness/drag-selection-sync.ts`):
 * both the dashed selection indicator and the free-scale handle frame diverged 227px over a 233px
 * drag and were still 227px out after the pointer had been held still — not a late frame, a
 * different position entirely.
 *
 * Mirroring rides Konva's own `xChange`/`yChange`. Those fire synchronously inside `Node._setAttr`,
 * before the drag's `_requestDraw`, so chrome and ink are rasterized in the *same* frame with zero
 * React commits — the imperative discipline `translateGroupPreview` already uses for the
 * multi-select overlay, and what the hot-path de-React contract requires.
 */
import type Konva from "konva";

/** Scoped so `off` can never strip listeners the product installed on the same node. */
export const STUDIO_SELECTION_CHROME_MIRROR_NAMESPACE = "studioSelectionChromeMirror";

/**
 * Name on each per-element draw selection indicator group (rendered by
 * StudioDrawSelectionOverlay), for scene-graph assertions, perf probes, and gesture code that
 * must park the chrome. Declared here — the eagerly-bundled mirror module — so the lazily-loaded
 * overlay chunk is never pulled into the main bundle just to read a string.
 */
export const STUDIO_DRAW_SELECTION_INDICATOR_NAME = "studio-draw-selection-indicator";

/**
 * Name on the single/multi selection overlay group (label badge, lock marker, fallback boundary)
 * rendered by StudioCanvasSelectionDecorations. Like the indicator, it is pinned to pre-gesture
 * bounds and has to be parked while a live transform preview moves the ink.
 */
export const STUDIO_GROUP_SELECTION_OVERLAY_NAME = "studio-group-selection-overlay";

/**
 * Wrapper attr set for the duration of a live transform preview (scale/rotate gesture).
 *
 * The preview repurposes the wrapper's x/y as the absolute target origin, so translation mirrors
 * must not interpret those frames as drag offsets — and, once the gesture is lifted onto the
 * dedicated drag Layer, a mirrored chrome write would re-invalidate the document Layer every
 * frame and void the lift. Mirrors resume on the neutral reset that ends every gesture path.
 */
export const STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR =
  "studioLiveTransformPreviewActive";

/**
 * Stage attr holding the chrome nodes an active live transform preview has parked.
 *
 * The gesture parks the chrome it can see when it starts, but the draw selection overlay is a
 * lazily loaded chunk: if it resolves mid-gesture its indicator mounts VISIBLE at the pre-gesture
 * bounds, and the mirror below deliberately refuses to reposition it while the preview owns the
 * wrapper's x/y — so the stale box would sit onscreen until release. Late mounts therefore park
 * themselves here, and the gesture drains this set on the neutral reset that ends every path.
 *
 * A stage attr rather than a module-level global so the set cannot outlive its stage or leak
 * between them, and so the parking and un-parking code share one channel they both already hold.
 */
export const STUDIO_LIVE_TRANSFORM_PARKED_CHROME_ATTR =
  "studioLiveTransformParkedChrome";

/**
 * Records `node` as parked by the active preview so the gesture can restore exactly what it hid.
 *
 * Only ever called for chrome this module just hid, which keeps the un-park symmetric: chrome the
 * product hid for its own reasons is never in the set and is never revealed by the restore.
 */
function registerStudioParkedChrome(stage: Konva.Stage, node: Konva.Node): void {
  const existing = stage.getAttr(STUDIO_LIVE_TRANSFORM_PARKED_CHROME_ATTR);
  const parked: Set<Konva.Node> = existing instanceof Set ? existing : new Set<Konva.Node>();
  parked.add(node);
  stage.setAttr(STUDIO_LIVE_TRANSFORM_PARKED_CHROME_ATTR, parked);
}

/**
 * Un-parks and clears everything late-mounted chrome parked itself into, for the gesture's reset.
 *
 * @returns the nodes restored, so the caller can keep its own accounting honest.
 */
export function drainStudioLateParkedChrome(
  stage: Konva.Stage | null
): readonly Konva.Node[] {
  if (!stage) return [];
  const existing = stage.getAttr(STUDIO_LIVE_TRANSFORM_PARKED_CHROME_ATTR);
  if (!(existing instanceof Set)) return [];
  const restored = [...existing] as Konva.Node[];
  for (const node of restored) node.visible(true);
  stage.setAttr(STUDIO_LIVE_TRANSFORM_PARKED_CHROME_ATTR, new Set<Konva.Node>());
  return restored;
}

function konvaNodeDepth(node: Konva.Node): number {
  let depth = 0;
  let current: Konva.Node | null = node.getParent();
  while (current) {
    depth += 1;
    current = current.getParent();
  }
  return depth;
}

/**
 * Resolves the *draggable wrapper* Konva node authoring `elementId`.
 *
 * Two nodes carry `studioElementId` for a draw element: the outer wrapper that Konva actually
 * drags, and a non-listening inner group inside StudioDrawNode. Only the wrapper's own x/y changes
 * during a drag, so the shallowest match is the one worth mirroring.
 */
export function findStudioDrawWrapperNode(
  stage: Konva.Stage,
  elementId: string
): Konva.Node | null {
  const matches = stage.find(
    (node: Konva.Node) => node.getAttr("studioElementId") === elementId
  );
  let best: Konva.Node | null = null;
  let bestDepth = Number.POSITIVE_INFINITY;
  for (const candidate of matches) {
    const depth = konvaNodeDepth(candidate);
    if (depth < bestDepth) {
      best = candidate;
      bestDepth = depth;
    }
  }
  return best;
}

/**
 * Reports `elementId`'s live drag offset to `apply` — immediately, then on every change.
 *
 * The immediate call matters for chrome that mounts mid-gesture (a lazily loaded overlay, or a
 * selection made during a drag): it must never render one frame behind the ink.
 *
 * At drag end the product zeroes the wrapper *before* committing the new points, and this follows
 * that reset in the same tick, so the chrome tracks the stroke through the handoff too.
 *
 * @returns an unsubscribe; a no-op when the element has no node in the scene.
 */
export function mirrorStudioDrawElementTranslation(
  stage: Konva.Stage,
  elementId: string,
  apply: (offset: { x: number; y: number }) => void
): () => void {
  const wrapper = findStudioDrawWrapperNode(stage, elementId);
  if (!wrapper) return () => undefined;
  const sync = () => {
    if (wrapper.getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR) === true) return;
    apply({ x: wrapper.x(), y: wrapper.y() });
  };
  sync();
  const events =
    `xChange.${STUDIO_SELECTION_CHROME_MIRROR_NAMESPACE}`
    + ` yChange.${STUDIO_SELECTION_CHROME_MIRROR_NAMESPACE}`;
  wrapper.on(events, sync);
  // Detach THIS handler, not the namespace. Several mirrors legitimately share one wrapper -- the
  // resize proxy subscribes for `mirrorDragElementId` while the dashed indicator subscribes for
  // the same selected stroke -- and a namespace-wide `off` tore down the other one too. The proxy
  // then reattached only its own, while the indicator's effect did not re-run (its element id was
  // unchanged), so after one drag commit the dashed box silently stopped following the ink.
  return () => {
    wrapper.off(events, sync);
  };
}

/**
 * Binds each per-element selection indicator group to its stroke's live transform.
 *
 * @param indicators element id → the indicator group to keep pinned to that element's stroke.
 * @returns an unsubscribe for every listener this call installed.
 */
export function mirrorStudioDrawSelectionIndicators(
  indicators: ReadonlyMap<string, Konva.Group>
): () => void {
  const detachers: Array<() => void> = [];
  for (const [elementId, indicator] of indicators) {
    const stage = indicator.getStage();
    if (!stage) continue;
    // Mounted into a gesture already in flight (the lazy overlay chunk resolving mid-transform):
    // park it now, because `sync` below will refuse to move it while the preview owns the wrapper.
    const wrapper = findStudioDrawWrapperNode(stage, elementId);
    if (
      wrapper?.getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR) === true
      && indicator.visible()
    ) {
      indicator.visible(false);
      registerStudioParkedChrome(stage, indicator);
    }
    detachers.push(
      mirrorStudioDrawElementTranslation(stage, elementId, (offset) => {
        indicator.position(offset);
      })
    );
  }
  return () => {
    for (const detach of detachers) detach();
  };
}
