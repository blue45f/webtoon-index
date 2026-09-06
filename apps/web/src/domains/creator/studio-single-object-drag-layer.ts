import type Konva from "konva";

/** Explicit promise that a visible main-Layer sibling paints no pixels during a transform. */
export const STUDIO_LIVE_TRANSFORM_Z_ORDER_EXEMPT_ATTR =
  "studioLiveTransformZOrderExempt";

/** Stable, hit-testable owner for Konva's authored shadow while FrameGraph paints document pixels. */
export const STUDIO_KONVA_DOCUMENT_SHADOW_NAME =
  "studio-konva-document-shadow";

type LiftedNodeRestorePhase =
  | "complete"
  | "owned-in-drag-layer"
  | "moved-home-position-pending"
  | "position-restored-z-pending"
  | "externally-reparented";

interface LiftedNodeRecord {
  readonly node: Konva.Node;
  readonly parent: Konva.Container;
  readonly zIndex: number;
  phase: LiftedNodeRestorePhase;
  restoreAbsolutePosition: { x: number; y: number } | null;
  /** True only when this session observed moveTo reach the captured parent. */
  moveReachedHome: boolean;
}

export interface StudioSingleObjectDragLayerSession {
  readonly elementId: string;
  readonly mainLayer: Konva.Layer;
  readonly dragLayer: Konva.Layer;
  readonly target: Konva.Node;
  readonly transformer: Konva.Transformer | null;
  readonly lifted: readonly LiftedNodeRecord[];
  /** Whether canvas authority receipts are deferred or must complete inside this transition. */
  readonly presentationMode: "deferred-batch" | "synchronous-authority";
  restored: boolean;
}

interface StudioSingleObjectDragLayerRestoreResult {
  readonly attempted: boolean;
  /** Ownership/geometry writes that still need another phase-aware retry. */
  readonly structuralErrors: readonly unknown[];
  /** Nodes are home, but Transformer/canvas pixels did not acknowledge the restored scene. */
  readonly presentationErrors: readonly unknown[];
  readonly errors: readonly unknown[];
}

const STUDIO_SINGLE_OBJECT_RECOVERY_INITIAL_DELAY_MS = 16;
const STUDIO_SINGLE_OBJECT_RECOVERY_MAX_DELAY_MS = 1_000;
const pendingStudioSingleObjectRecoveries = new Set<StudioSingleObjectDragLayerSession>();
let studioSingleObjectRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let studioSingleObjectRecoveryDelayMs = STUDIO_SINGLE_OBJECT_RECOVERY_INITIAL_DELAY_MS;

interface StudioSingleObjectRecoveryConflictInput {
  readonly elementId: string | null;
  readonly dragLayer: Konva.Layer | null;
  readonly nodes: readonly (Konva.Node | null | undefined)[];
}

function studioSingleObjectRecoveryConflicts(
  input: StudioSingleObjectRecoveryConflictInput,
): boolean {
  const nodes = new Set(input.nodes.filter((node): node is Konva.Node => node != null));
  for (const session of pendingStudioSingleObjectRecoveries) {
    if (input.elementId && session.elementId === input.elementId) return true;
    // The transform/drag Layer and Transformer are shared across selections. A different element
    // still cannot claim them while an older setup rollback owns unfinished records there.
    if (input.dragLayer && session.dragLayer === input.dragLayer) return true;
    if (
      nodes.has(session.target)
      || (session.transformer !== null && nodes.has(session.transformer))
      || session.lifted.some((record) => nodes.has(record.node))
    ) {
      return true;
    }
  }
  return false;
}

/** O(number of exceptional recovery leases), normally O(0), for transform-start exclusion. */
export function studioSingleObjectDragLayerRecoveryPendingForElement(
  elementId: string,
): boolean {
  return studioSingleObjectRecoveryConflicts({ elementId, dragLayer: null, nodes: [] });
}

/**
 * Restore every still-owned record independently.
 *
 * `restored` is set up front as a re-entrancy seal, but is reopened after a partial failure so a
 * later owner cleanup can retry only the records still left in the drag Layer. Nodes already
 * restored (or claimed by React/another owner) are skipped on that retry.
 */
function restoreStudioSingleObjectDragLayerInternal(
  session: StudioSingleObjectDragLayerSession | null,
): StudioSingleObjectDragLayerRestoreResult {
  if (!session || session.restored) {
    return {
      attempted: false,
      structuralErrors: [],
      presentationErrors: [],
      errors: [],
    };
  }
  session.restored = true;
  const structuralErrors: unknown[] = [];
  const presentationErrors: unknown[] = [];
  const records = [...session.lifted].sort((left, right) => left.zIndex - right.zIndex);

  for (const record of records) {
    if (record.phase === "complete" || record.phase === "externally-reparented") continue;
    try {
      if (record.phase === "owned-in-drag-layer") {
        const currentParent = record.node.getParent();
        if (currentParent !== session.dragLayer) {
          // `moveTo(home)` may mutate and then throw. A captured absolute position proves this was
          // our partial restore and lets the next call resume; otherwise React/another owner moved
          // the node and this session must not reclaim it.
          if (currentParent === record.parent && record.moveReachedHome) {
            record.phase = "moved-home-position-pending";
          } else {
            record.phase = "externally-reparented";
            continue;
          }
        } else {
          if (record.restoreAbsolutePosition === null) {
            record.restoreAbsolutePosition = record.node.getAbsolutePosition();
          }
          try {
            record.node.moveTo(record.parent);
          } catch (error) {
            if (record.node.getParent() === record.parent) {
              record.moveReachedHome = true;
              record.phase = "moved-home-position-pending";
            }
            throw error;
          }
          record.moveReachedHome = true;
          record.phase = "moved-home-position-pending";
        }
      }

      if (record.phase === "moved-home-position-pending") {
        if (record.node.getParent() !== record.parent) {
          record.phase = "externally-reparented";
          continue;
        }
        const absolutePosition = record.restoreAbsolutePosition;
        if (absolutePosition === null) {
          throw new Error("Missing absolute position for a partially restored Studio Layer node");
        }
        record.node.absolutePosition(absolutePosition);
        record.phase = "position-restored-z-pending";
      }

      if (record.phase !== "position-restored-z-pending") continue;
      const lastIndex = Math.max(0, record.parent.getChildren().length - 1);
      record.node.zIndex(Math.min(record.zIndex, lastIndex));
      record.phase = "complete";
    } catch (error) {
      structuralErrors.push(error);
    }
  }
  try {
    session.transformer?.forceUpdate();
  } catch (error) {
    presentationErrors.push(error);
  }
  try {
    if (session.presentationMode === "synchronous-authority") {
      session.mainLayer.drawScene();
    } else {
      session.mainLayer.batchDraw();
    }
  } catch (error) {
    presentationErrors.push(error);
  }
  try {
    if (session.presentationMode === "synchronous-authority") {
      session.dragLayer.drawScene();
    } else {
      session.dragLayer.batchDraw();
    }
  } catch (error) {
    presentationErrors.push(error);
  }
  const errors = [...structuralErrors, ...presentationErrors];
  if (errors.length > 0) session.restored = false;
  return {
    attempted: true,
    structuralErrors,
    presentationErrors,
    errors,
  };
}

/**
 * A scene host may apply a move/position/z write and then throw. Resume the recorded phase inside
 * this call so neither setup rollback nor pointer-up can lose the only reference to lifted nodes.
 */
function restoreStudioSingleObjectDragLayerWithRetries(
  session: StudioSingleObjectDragLayerSession | null,
): StudioSingleObjectDragLayerRestoreResult {
  let attempted = false;
  let latest: StudioSingleObjectDragLayerRestoreResult = {
    attempted: false,
    structuralErrors: [],
    presentationErrors: [],
    errors: [],
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = restoreStudioSingleObjectDragLayerInternal(session);
    attempted ||= latest.attempted;
    if (latest.errors.length === 0) return { ...latest, attempted };
  }
  return { ...latest, attempted };
}

function requestStudioSingleObjectRecoveryPass(): void {
  if (studioSingleObjectRecoveryTimer !== null || pendingStudioSingleObjectRecoveries.size === 0) {
    return;
  }
  try {
    studioSingleObjectRecoveryTimer = globalThis.setTimeout(() => {
      studioSingleObjectRecoveryTimer = null;
      for (const session of [...pendingStudioSingleObjectRecoveries]) {
        const result = restoreStudioSingleObjectDragLayerWithRetries(session);
        if (result.errors.length === 0) pendingStudioSingleObjectRecoveries.delete(session);
      }
      if (pendingStudioSingleObjectRecoveries.size === 0) {
        studioSingleObjectRecoveryDelayMs = STUDIO_SINGLE_OBJECT_RECOVERY_INITIAL_DELAY_MS;
        return;
      }
      studioSingleObjectRecoveryDelayMs = Math.min(
        STUDIO_SINGLE_OBJECT_RECOVERY_MAX_DELAY_MS,
        studioSingleObjectRecoveryDelayMs * 2,
      );
      requestStudioSingleObjectRecoveryPass();
    }, studioSingleObjectRecoveryDelayMs);
    (studioSingleObjectRecoveryTimer as unknown as { unref?: () => void }).unref?.();
  } catch {
    // The Set itself is the ownership lease. A later lift/restore call requests another pass even
    // if this host timer was temporarily unavailable; no lifted session reference is discarded.
    studioSingleObjectRecoveryTimer = null;
  }
}

/**
 * Transfer an incomplete structural/presentation cleanup to the Layer host.
 *
 * This is intentionally exported for renderer adapters: their own lifecycle retries authority
 * transfer, while this registry independently guarantees that a still-lifted node is never left
 * without an owner merely because the originating pointer session has resolved or setup threw.
 */
export function retainStudioSingleObjectDragLayerRecovery(
  session: StudioSingleObjectDragLayerSession | null,
): void {
  if (!session || session.restored) return;
  pendingStudioSingleObjectRecoveries.add(session);
  requestStudioSingleObjectRecoveryPass();
}

function releaseStudioSingleObjectDragLayerRecovery(
  session: StudioSingleObjectDragLayerSession | null,
): void {
  if (session) pendingStudioSingleObjectRecoveries.delete(session);
  if (pendingStudioSingleObjectRecoveries.size > 0) return;
  if (studioSingleObjectRecoveryTimer !== null) {
    globalThis.clearTimeout(studioSingleObjectRecoveryTimer);
    studioSingleObjectRecoveryTimer = null;
  }
  studioSingleObjectRecoveryDelayMs = STUDIO_SINGLE_OBJECT_RECOVERY_INITIAL_DELAY_MS;
}

/** Move a captured ownership set transactionally, rolling every still-owned record back on error. */
function performStudioSingleObjectLayerLift(
  session: StudioSingleObjectDragLayerSession,
): StudioSingleObjectDragLayerSession {
  try {
    for (const record of session.lifted) {
      // Mark ownership before moveTo so a host implementation that mutates and then throws is
      // still included in rollback. A non-mutating failure is harmless: restore sees it already
      // home with no captured position and classifies it as externally reparented.
      record.phase = "owned-in-drag-layer";
      record.node.moveTo(session.dragLayer);
    }
    session.transformer?.forceUpdate();
    if (session.presentationMode === "synchronous-authority") {
      // This lift can run inside the preview rAF. Synchronously clear the departed canvas and
      // acknowledge the new canvas before returning; a queued batch would leave both authorities
      // visible in the browser's imminent paint. Any failure enters the same phase-aware rollback.
      session.mainLayer.drawScene();
      session.dragLayer.drawScene();
    } else {
      session.mainLayer.batchDraw();
      session.dragLayer.batchDraw();
    }
    return session;
  } catch (error) {
    // Setup has not returned a session to its caller yet, so rollback must own the same bounded,
    // phase-aware retry contract as public cleanup. In particular, a final moveTo that mutates and
    // throws must not strand wrapper/proxy/Transformer in the gesture Layer.
    const rollback = restoreStudioSingleObjectDragLayerWithRetries(session);
    if (rollback.errors.length > 0) {
      // `begin` cannot return this session to its caller, so the Layer module must retain the only
      // recovery lease before propagating the setup failure.
      retainStudioSingleObjectDragLayerRecovery(session);
      throw new AggregateError(
        [error, ...rollback.errors],
        "Studio Layer lift failed and rollback was incomplete",
        { cause: error },
      );
    }
    throw error;
  }
}

export interface BeginStudioSingleObjectDragLayerOptions {
  readonly target: Konva.Node;
  readonly selectedElementId: string | null;
  readonly selectionSize: number;
  readonly mainLayer: Konva.Layer | null;
  readonly dragLayer: Konva.Layer | null;
  readonly transformer?: Konva.Transformer | null;
  readonly selectedIsDraw: boolean;
  readonly hasMaskOrClip: boolean;
  /** destination-out, clip-below and authored blend modes need the document layer as a backdrop. */
  readonly layerSensitiveComposite?: boolean;
}

function studioLiftHomeParent(
  node: Konva.Node,
  layer: Konva.Layer,
): Konva.Container | null {
  const parent = node.getParent();
  if (parent === layer) return layer;
  if (
    parent?.getParent() === layer
    && parent.getClassName() === "Group"
    && parent.name() === STUDIO_KONVA_DOCUMENT_SHADOW_NAME
  ) {
    return parent;
  }
  return null;
}

function nodeCompositeIsLayerSensitive(node: Konva.Node): boolean {
  const operation = node.getAttr("globalCompositeOperation");
  return (
    typeof operation === "string"
    && operation.length > 0
    && operation !== "source-over"
  );
}

function authoredCompositeOperationIsLayerSensitive(
  target: Konva.Node,
  root: Konva.Node,
): boolean {
  let current: Konva.Node | null = target;
  while (current) {
    if (nodeCompositeIsLayerSensitive(current)) return true;
    if (current === root) break;
    current = current.getParent();
  }
  return false;
}

/**
 * Layer-sensitive composite anywhere in `node`'s subtree, itself included.
 *
 * The ancestor walk above answers the drag lift's question ("does anything between the dragged
 * node and the Layer blend against the backdrop?"), and that sufficed there because draw elements
 * were excluded outright. A stroke's own paint nodes live BELOW its wrapper — StudioDrawNode
 * hangs `globalCompositeOperation` on the shapes it emits (highlighter/wash multiply passes among
 * them) — so the transform lift, whose whole subject is a stroke, has to look down instead.
 */
function subtreeCompositeIsLayerSensitive(node: Konva.Node): boolean {
  if (nodeCompositeIsLayerSensitive(node)) return true;
  const children = (node as Konva.Container).getChildren?.();
  if (!children) return false;
  for (const child of children) {
    if (subtreeCompositeIsLayerSensitive(child)) return true;
  }
  return false;
}

/**
 * Does anything painted ABOVE `node` in its Layer depend on `node` staying below it?
 *
 * The drag Layer is drawn after the whole document Layer, so a lifted node paints above every
 * later sibling for the gesture's duration. For an opaque overlap that is the usual "manipulated
 * object rides on top" convention, but a later `destination-out` eraser stroke — a first-class
 * element in this editor — stops erasing the lifted stroke entirely: the erased pixels reappear
 * for the whole gesture and vanish again at commit. Refuse the lift there rather than previewing
 * artwork the commit will not produce.
 */
function laterSiblingDependsOnStackingBelow(node: Konva.Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  const index = node.zIndex();
  return parent
    .getChildren()
    .some((sibling) => sibling.zIndex() > index && subtreeCompositeIsLayerSensitive(sibling));
}

/**
 * A visible Konva Container does not necessarily paint. Selection overlays deliberately keep an
 * outer Group mounted while their indicator child is parked, and treating that empty shell as
 * artwork makes every otherwise-safe exact lift fail closed. Recurse to leaf nodes so the z-order
 * gate continues to reject real paint while admitting empty/fully-hidden UI containers.
 */
function subtreeHasVisiblePaint(node: Konva.Node): boolean {
  try {
    // Siblings share the same ancestor visibility/opacity. Inspect local authored state so the
    // reserved document shadow's authority opacity cannot make real Vello-painted siblings look
    // empty to the z-order gate.
    if (!node.visible() || node.opacity() <= 0) return false;
    // A cached container can replay pixels even when its current children are hidden or empty.
    if (node.isCached()) return true;
    const children = (node as Konva.Container).getChildren?.();
    if (children) return children.some((child) => subtreeHasVisiblePaint(child));
    return true;
  } catch {
    // Unreadable paint state is not positive evidence that moving above it preserves composition.
    return true;
  }
}

/**
 * An exact transform draft is expected to match the committed document, including occlusion.
 * Because the isolated drag Layer paints after the document Layer, lifting below any ordinary
 * visible authored sibling would put the draft above that sibling for the gesture and drop it
 * back below on commit. Gesture chrome is explicitly exempt because it is lifted alongside the
 * wrapper; other selection indicators have already been parked before this preflight.
 */
function laterVisiblePaintingSibling(
  node: Konva.Node,
  exempt: ReadonlySet<Konva.Node>,
): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  const index = node.zIndex();
  return parent.getChildren().some((sibling) => {
    if (sibling.zIndex() <= index || exempt.has(sibling)) return false;
    try {
      if (sibling.getAttr(STUDIO_LIVE_TRANSFORM_Z_ORDER_EXEMPT_ATTR) === true) {
        return false;
      }
      return subtreeHasVisiblePaint(sibling);
    } catch {
      // A node whose paint state cannot be read is not evidence that reordering it is safe.
      return true;
    }
  });
}

/**
 * Can this whole set of wrappers be drafted together on the isolated Layer without lying about
 * stacking?
 *
 * A multi-selection draft hides every selected wrapper at once and repaints the transformed copies
 * in the draft root, which the isolated Layer draws AFTER the entire document Layer. So the
 * selection as a whole moves to the top for the duration of the gesture. That is invisible only
 * when nothing else was painting above it -- otherwise a stroke that sits under an image would
 * jump in front of it while the handles move and drop back behind at release, and a later
 * `destination-out` eraser would stop erasing the selection entirely.
 *
 * Checking the LOWEST member is sufficient and necessary: every later painting sibling is above the
 * lowest, and members of the selection are exempt because they are all lifted together and keep
 * their relative order inside the draft root. Split parents mean the members interleave with
 * content this check cannot see, so that fails closed too.
 *
 * Same evidence standard as the single-object lift, one level up; the single lift's own
 * `laterVisiblePaintingSibling` is what this delegates to.
 */
export function studioLiveTransformGroupStackingIsolatable(
  wrappers: readonly Konva.Node[],
): boolean {
  if (wrappers.length === 0) return false;
  const selection = new Set(wrappers);
  if (selection.size !== wrappers.length) return false;
  try {
    const parent = wrappers[0]!.getParent();
    if (!parent) return false;
    let lowest = wrappers[0]!;
    for (const wrapper of wrappers) {
      if (wrapper.getParent() !== parent) return false;
      if (wrapper.zIndex() < lowest.zIndex()) lowest = wrapper;
    }
    return !laterVisiblePaintingSibling(lowest, selection);
  } catch {
    // Unreadable scene state is not positive evidence that the reorder preserves composition.
    return false;
  }
}

/**
 * Lift one already-selected draggable object into a small, otherwise-empty Layer.
 *
 * Konva redraws the whole owning Layer whenever a draggable node changes position. The Studio
 * document Layer can contain hundreds of pressure strokes, cached masks and images, so one pointer
 * frame can otherwise repaint the entire page. The lift keeps the React-owned scene graph intact
 * logically, but gives Konva a tiny raster invalidation surface for the duration of the gesture.
 *
 * Deliberate exclusions:
 * - multi/group selections (their peers and atomic preview still live in the document Layer),
 * - Transformer anchors (the target is not an authored element node),
 * - draw elements (their point-backed wrapper and selection chrome have a separate live contract),
 * - clipped/cached/masked or non-source-over roots (a separate canvas cannot reproduce backdrop
 *   blending or a parent clip exactly).
 */
export function beginStudioSingleObjectDragLayer(
  options: BeginStudioSingleObjectDragLayerOptions,
): StudioSingleObjectDragLayerSession | null {
  const {
    target,
    selectedElementId,
    selectionSize,
    mainLayer,
    dragLayer,
    transformer = null,
    selectedIsDraw,
    hasMaskOrClip,
    layerSensitiveComposite = false,
  } = options;

  if (
    !selectedElementId
    || selectionSize !== 1
    || !mainLayer
    || !dragLayer
    || mainLayer === dragLayer
    || mainLayer.getStage() === null
    || mainLayer.getStage() !== dragLayer.getStage()
    || target.getLayer() !== mainLayer
    || target.getAttr("studioElementId") !== selectedElementId
    || target.draggable() !== true
    || selectedIsDraw
    || hasMaskOrClip
    || layerSensitiveComposite
    || studioSingleObjectRecoveryConflicts({
      elementId: selectedElementId,
      dragLayer,
      nodes: [target, transformer],
    })
  ) {
    return null;
  }

  const targetHomeParent = studioLiftHomeParent(target, mainLayer);
  const movingRoot = target;
  if (
    !targetHomeParent
    || movingRoot.isCached()
    || authoredCompositeOperationIsLayerSensitive(target, movingRoot)
  ) {
    return null;
  }

  const roots: Konva.Node[] = [movingRoot];
  let liftedTransformer: Konva.Transformer | null = null;
  if (
    transformer
    && transformer.getLayer() === mainLayer
    && transformer.nodes().includes(target)
  ) {
    roots.push(transformer);
    liftedTransformer = transformer;
  }

  // Capture every index before moving the first node; removals compact the remaining indices.
  const lifted: LiftedNodeRecord[] = roots.map((node) => ({
    node,
    parent: node === movingRoot ? targetHomeParent : mainLayer,
    zIndex: node.zIndex(),
    phase: "complete",
    restoreAbsolutePosition: null,
    moveReachedHome: false,
  }));
  // One full document repaint removes the lifted object. Subsequent pointer frames invalidate only
  // dragLayer; its sibling Layer shares the Stage transform, so local and absolute geometry agree.
  return performStudioSingleObjectLayerLift({
    elementId: selectedElementId,
    mainLayer,
    dragLayer,
    target,
    transformer: liftedTransformer,
    lifted,
    presentationMode: "deferred-batch",
    restored: false,
  });
}

export interface BeginStudioSingleDrawTransformLayerOptions {
  readonly elementId: string;
  /** The stroke's draggable wrapper — the node the live transform preview projects onto. */
  readonly wrapper: Konva.Node;
  /** The invisible gesture Rect the group-resize Transformer manipulates. */
  readonly proxy: Konva.Node;
  readonly transformer: Konva.Transformer;
  readonly dragLayer: Konva.Layer | null;
}

export interface BeginStudioSingleDrawTransformSourceLayerOptions {
  readonly elementId: string;
  /** Authoritative stroke wrapper. It remains in the document Layer until this claim succeeds. */
  readonly wrapper: Konva.Node;
  /** Already-isolated Transformer, refreshed when source ownership crosses Layer boundaries. */
  readonly transformer: Konva.Transformer;
  readonly dragLayer: Konva.Layer | null;
}

/**
 * Isolate only the resize proxy and Transformer at gesture begin.
 *
 * Admission depends on the first real target frame, so moving the authored wrapper here is too
 * early: an over-budget/rejected gesture would make every handle repaint rasterize that source in
 * the chrome Layer. This claim deliberately leaves the wrapper in its document Layer. A later
 * admitted frame can add a separate source claim with
 * `beginStudioSingleDrawTransformSourceLayer`; both claims use the same phase-aware restore path.
 */
export function beginStudioSingleDrawTransformChromeLayer(
  options: BeginStudioSingleDrawTransformLayerOptions,
): StudioSingleObjectDragLayerSession | null {
  const { elementId, wrapper, proxy, transformer, dragLayer } = options;
  const mainLayer = wrapper.getLayer();
  if (
    !mainLayer
    || !dragLayer
    || mainLayer === dragLayer
    || mainLayer.getStage() === null
    || mainLayer.getStage() !== dragLayer.getStage()
    || wrapper.getAttr("studioElementId") !== elementId
    || proxy.getParent() !== mainLayer
    || transformer.getParent() !== mainLayer
    || studioSingleObjectRecoveryConflicts({
      elementId,
      dragLayer,
      nodes: [wrapper, proxy, transformer],
    })
  ) {
    return null;
  }

  const roots: Konva.Node[] = [proxy, transformer];
  const lifted: LiftedNodeRecord[] = roots.map((node) => ({
    node,
    parent: mainLayer,
    zIndex: node.zIndex(),
    phase: "complete",
    restoreAbsolutePosition: null,
    moveReachedHome: false,
  }));
  return performStudioSingleObjectLayerLift({
    elementId,
    mainLayer,
    dragLayer,
    target: wrapper,
    transformer,
    lifted,
    presentationMode: "synchronous-authority",
    restored: false,
  });
}

/**
 * Claim the authoritative stroke for an already-admitted frame.
 *
 * This is intentionally independent from the chrome claim. A rejected frame never calls it, and
 * an admitted-to-rejected transition restores only this session while the handles remain isolated.
 * Composition and z-order gates are evaluated at the actual authority transition, after gesture
 * chrome has left the document Layer, so only authored paint can refuse the source lift.
 */
export function beginStudioSingleDrawTransformSourceLayer(
  options: BeginStudioSingleDrawTransformSourceLayerOptions,
): StudioSingleObjectDragLayerSession | null {
  const { elementId, wrapper, transformer, dragLayer } = options;
  const mainLayer = wrapper.getLayer();
  const wrapperHomeParent = mainLayer
    ? studioLiftHomeParent(wrapper, mainLayer)
    : null;
  if (
    !mainLayer
    || !dragLayer
    || mainLayer === dragLayer
    || mainLayer.getStage() === null
    || mainLayer.getStage() !== dragLayer.getStage()
    || wrapper.getAttr("studioElementId") !== elementId
    || !wrapperHomeParent
    || wrapper.isCached()
    || subtreeCompositeIsLayerSensitive(wrapper)
    || laterSiblingDependsOnStackingBelow(wrapper)
    || laterVisiblePaintingSibling(wrapper, new Set())
    || transformer.getLayer() !== dragLayer
    || studioSingleObjectRecoveryConflicts({
      elementId,
      dragLayer,
      nodes: [wrapper, transformer],
    })
  ) {
    return null;
  }

  const lifted: LiftedNodeRecord[] = [{
    node: wrapper,
    parent: wrapperHomeParent,
    zIndex: wrapper.zIndex(),
    phase: "complete",
    restoreAbsolutePosition: null,
    moveReachedHome: false,
  }];
  return performStudioSingleObjectLayerLift({
    elementId,
    mainLayer,
    dragLayer,
    target: wrapper,
    transformer,
    lifted,
    presentationMode: "synchronous-authority",
    restored: false,
  });
}

/**
 * Lift a single draw stroke plus its transform gesture chrome for a scale/rotate gesture.
 *
 * The drag lift above deliberately excludes draw elements because their selection chrome mirrors
 * live in the document Layer — chrome writes would re-invalidate the big Layer every frame and
 * void the lift. A transform gesture is different: the live preview parks that chrome and gates
 * its mirrors (`STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR`), so for the gesture's duration the
 * only per-frame invalidations are the stroke, the proxy and the Transformer — exactly the nodes
 * moved here. On a stroke-heavy page this turns "repaint the whole document per anchor frame"
 * (measured ~80-157ms per drawScene) into repainting one stroke plus handles.
 *
 * Same fail-closed exclusions as the drag lift: a clipped wrapper (neither a direct Layer child
 * nor a direct child of the reserved document-shadow owner), a cached root, or a layer-sensitive
 * composite refuses the lift and the transform stays release-only. Composite is checked over the
 * whole SUBTREE, not just the wrapper: the
 * eraser's destination-out rides the wrapper, but a highlighter's multiply passes are emitted by
 * StudioDrawNode as descendant shapes, and lifting those onto an empty Layer would blend them
 * against transparency instead of the artwork — a visible appearance change for the gesture.
 */
export function beginStudioSingleDrawTransformLayer(
  options: BeginStudioSingleDrawTransformLayerOptions,
): StudioSingleObjectDragLayerSession | null {
  const { elementId, wrapper, proxy, transformer, dragLayer } = options;
  const mainLayer = wrapper.getLayer();
  const wrapperHomeParent = mainLayer
    ? studioLiftHomeParent(wrapper, mainLayer)
    : null;
  if (
    !mainLayer
    || !dragLayer
    || mainLayer === dragLayer
    || mainLayer.getStage() === null
    || mainLayer.getStage() !== dragLayer.getStage()
    || wrapper.getAttr("studioElementId") !== elementId
    || !wrapperHomeParent
    || wrapper.isCached()
    || subtreeCompositeIsLayerSensitive(wrapper)
    || laterSiblingDependsOnStackingBelow(wrapper)
    || laterVisiblePaintingSibling(wrapper, new Set([proxy, transformer]))
    || proxy.getLayer() !== mainLayer
    || transformer.getLayer() !== mainLayer
    || studioSingleObjectRecoveryConflicts({
      elementId,
      dragLayer,
      nodes: [wrapper, proxy, transformer],
    })
  ) {
    return null;
  }

  const roots: Konva.Node[] = [wrapper, proxy, transformer];
  const lifted: LiftedNodeRecord[] = roots.map((node) => ({
    node,
    parent: node === wrapper ? wrapperHomeParent : mainLayer,
    zIndex: node.zIndex(),
    phase: "complete",
    restoreAbsolutePosition: null,
    moveReachedHome: false,
  }));
  return performStudioSingleObjectLayerLift({
    elementId,
    mainLayer,
    dragLayer,
    target: wrapper,
    transformer,
    lifted,
    presentationMode: "deferred-batch",
    restored: false,
  });
}

/** Restore the imperative lift without changing the object's live drag position or transform. */
export function restoreStudioSingleObjectDragLayer(
  session: StudioSingleObjectDragLayerSession | null,
): boolean {
  // Persistent host failure still returns false and leaves the session retryable/fail-closed.
  const result = restoreStudioSingleObjectDragLayerWithRetries(session);
  if (result.errors.length > 0) retainStudioSingleObjectDragLayerRecovery(session);
  else releaseStudioSingleObjectDragLayerRecovery(session);
  return result.errors.length === 0 && result.attempted;
}
