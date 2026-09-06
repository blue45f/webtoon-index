/**
 * Konva's renderer adapter for a MULTI-SELECTION live transform gesture.
 *
 * The single-element adapter (`studio-live-transform-gesture-konva`) can present two ways: a
 * retained affine on the source subtree, or an isolated model draft. This one deliberately offers
 * only the second. A multi-selection resize commits through `planStudioGroupUniformResize`, which
 * PRESERVES stroke width by default -- the layout moves, the line weight does not -- so scaling the
 * source nodes would show ink that thickens with the box and then snaps back thin at release. The
 * only presentation that can be trusted is the one the commit itself produces, so this adapter
 * calls the commit planner's own selection half every frame and draws its output.
 *
 * Everything here is all-or-nothing across the selection, and that is the point rather than a
 * simplification:
 *
 *  - One draft claim owns the whole set, so a superseded gesture can never leave one stroke's
 *    source hidden while its neighbour's is restored.
 *  - Admission is a single verdict. If any member is ineligible, over budget, missing its wrapper
 *    or subtractive, the WHOLE gesture keeps commit-at-release -- the same honest fallback the
 *    editor has today, never a selection where half the strokes follow the handles.
 *  - Stacking is checked once, for the set. The isolated Layer paints after the document Layer, so
 *    a selection with anything painting above it would jump to the front for the drag and drop
 *    back at release; `studioLiveTransformGroupStackingIsolatable` refuses that outright.
 *
 * The frame's angle is forwarded to the group planner untouched. That planner is the authority on
 * whether the selection can carry it -- it turns the set as a rigid body and refuses the WHOLE
 * plan when any member cannot (`studioGroupUniformResizeMemberCanRotate`: a panel frame, a
 * bounds-derived shape, a mirrored-symmetry stroke, or a calligraphy stroke with effective
 * per-sample orientation -- the one this adapter has already refused for itself below, for the
 * same tearing reason) -- and a refused plan falls back to commit-at-release here exactly like
 * any other refusal. Admission stays angle-agnostic in every lane, though not for one reason: the
 * ribbon and generic lanes bound the fill by the target box diagonal, which no rotation can
 * exceed, while the causal-ink lane charges dab count times dab area and reads the box only
 * through its scale factor.
 */
import { flushSync } from "react-dom";

import {
  studioDrawHasEffectivePerSampleOrientation,
  studioDrawObjectTransformScale,
  studioDrawShapeIsBoundsDerived,
} from "./brush/studio-draw-object-transform";
import { studioKonvaRuntime } from "./render/studio-konva-runtime";
import { planStudioGroupUniformResizeSelection } from "./studio-group-uniform-resize";
import { studioLiveTransformCommittedClip } from "./studio-live-transform-clip-tracking";
import {
  admitStudioLiveTransformDrawCompilation,
  compileStudioLiveTransformDrawSnapshot,
} from "./studio-live-transform-draw-compiler";
import {
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_MEMBERS,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_WORK,
  admitStudioLiveTransformExactDraft,
} from "./studio-live-transform-exact-draft-admission";
import { studioKonvaDrawTransformIsBusy } from "./studio-live-transform-gesture-konva";
import { studioLiveTransformPreviewBlockedForElement } from "./studio-live-transform-preview-eligibility";
import {
  studioLiveTransformPreviewEligible,
  studioLiveTransformPreviewHasCachedDuplicate,
} from "./studio-live-transform-preview-konva";
import { createStudioLiveTransformPreviewSession } from "./studio-live-transform-preview-session";
import {
  STUDIO_DRAW_SELECTION_INDICATOR_NAME,
  STUDIO_GROUP_SELECTION_OVERLAY_NAME,
  drainStudioLateParkedChrome,
  STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR,
  findStudioDrawWrapperNode,
} from "./studio-selection-chrome-mirror";
import {
  beginStudioSingleDrawTransformChromeLayer,
  restoreStudioSingleObjectDragLayer,
  studioLiveTransformGroupStackingIsolatable,
} from "./studio-single-object-drag-layer";

import type { DrawEl, El } from "./studio-element-model";
import type { StudioGroupUniformResizeBounds } from "./studio-group-uniform-resize";
import type {
  StudioLiveCanvasGestureTransientAdapter,
  StudioLiveSelectionTransformFrame,
} from "./studio-live-canvas-gesture";
import type {
  StudioLiveTransformDraftClaim,
  StudioLiveTransformDraftEntry,
  StudioLiveTransformDraftStore,
} from "./studio-live-transform-draft-store";
import type { StudioLiveTransformDrawSnapshot } from "./studio-live-transform-draw-compiler";
import type { StudioLiveTransformPreviewScheduler } from "./studio-live-transform-preview-session";
import type { StudioSingleObjectDragLayerSession } from "./studio-single-object-drag-layer";
import type Konva from "konva";

export interface BeginStudioKonvaGroupDrawTransformGestureOptions {
  readonly preview: {
    readonly scope: string;
    /** The selected elements, in the order the commit will republish them. */
    readonly selection: readonly El[];
    /** The whole page composition, for clip resolution and scene budgeting. */
    readonly elements: readonly El[];
    readonly dragLayer: Konva.Layer | null;
    readonly draftStore?: StudioLiveTransformDraftStore;
    readonly scheduler?: StudioLiveTransformPreviewScheduler;
    readonly isLocked: (element: El) => boolean;
    readonly flushDraftPublication?: (mutation: () => void) => void;
  };
  readonly sourceBounds: StudioGroupUniformResizeBounds;
  readonly stage: Konva.Stage;
  readonly proxy: Konva.Rect;
  readonly transformer: Konva.Transformer;
  readonly onError?: (error: unknown) => void;
  readonly onFatalError?: (error: unknown) => void;
}

interface StudioGroupTransformMember {
  readonly element: DrawEl;
  readonly node: Konva.Node;
  readonly snapshot: StudioLiveTransformDrawSnapshot;
  /**
   * This member's OWN box, padded by the radius its renderer can paint outside the centre line.
   *
   * Work admission is a per-element gate, so it has to be asked about a per-element box. Handing
   * it the whole selection box instead makes its footprint term a per-frame constant, and summing
   * that across members multiplies one union by N -- which refused three ordinary 12px brush
   * strokes over a 400x400 box outright. The padding also keeps the box non-degenerate: a
   * perfectly horizontal stroke spans zero height, and a zero-extent box has no derivable scale.
   */
  readonly paintBounds: StudioGroupUniformResizeBounds;
}

function drawPointBounds(points: readonly number[]): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * One member's box carried through the selection's own uniform frame.
 *
 * Deliberately ignores the gesture angle: work admission reads only `width`/`height` from this
 * box -- the ribbon and generic lanes turn them into `hypot(w, h)`, the causal-ink lane into a
 * scale factor -- and a rotation leaves both alone, so turning the box would move numbers nothing
 * downstream consults.
 */
function mapBoundsThroughFrame(
  bounds: StudioGroupUniformResizeBounds,
  sourceBounds: StudioGroupUniformResizeBounds,
  targetBounds: StudioGroupUniformResizeBounds,
  scale: number,
): StudioGroupUniformResizeBounds {
  return {
    x: targetBounds.x + (bounds.x - sourceBounds.x) * scale,
    y: targetBounds.y + (bounds.y - sourceBounds.y) * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}

function studioLiveTransformRasterMetrics(
  stage: Konva.Stage,
  layer: Konva.Layer | null,
): { readonly rasterScale: number; readonly sceneCanvasBackingPixels: number } {
  const stageScale = Math.max(Math.abs(stage.scaleX()), Math.abs(stage.scaleY()));
  const sceneCanvas = layer?.getCanvas();
  const nativeSceneCanvas = layer?.getNativeCanvasElement();
  const pixelRatio = sceneCanvas?.getPixelRatio() ?? studioKonvaRuntime.pixelRatio;
  return {
    rasterScale: stageScale * pixelRatio,
    sceneCanvasBackingPixels: nativeSceneCanvas
      ? nativeSceneCanvas.width * nativeSceneCanvas.height
      : Number.NaN,
  };
}

/**
 * Claims a whole eligible multi-selection, or returns `null` for today's commit-at-release.
 */
export function beginStudioKonvaGroupDrawTransformGesture(
  options: BeginStudioKonvaGroupDrawTransformGestureOptions,
): StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame> | null {
  const { selection, elements, dragLayer } = options.preview;
  if (selection.length < 2) return null;
  // Both ceilings are O(1) and both are charged BEFORE any scene traversal or sample clone, so a
  // selection this lane will refuse costs a pointerdown nothing. The per-member gates below each
  // bound one stroke; these bound the set, which is the dimension they cannot see.
  if (selection.length > STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_MEMBERS) return null;
  if (elements.length > STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS) return null;
  const selectedIdSet = new Set(selection.map((element) => element.id));
  if (selectedIdSet.size !== selection.length) return null;
  // Members are taken in DOCUMENT order, never the caller's selection order.
  //
  // `StudioLiveTransformDraftNode` paints the entries as Konva children in the order it receives
  // them, so member order IS the draft's stacking. A layer-navigator range selection arrives
  // front-to-back, which would put the bottom stroke on top of its neighbour for the whole drag
  // and drop it back at release. It is also what `studioLiveTransformGroupStackingIsolatable`
  // relies on when it exempts the selection from its own z-order check: members may move above
  // the rest of the page together only because they keep their relative order among themselves.
  const orderedSelection = elements.filter((element) => selectedIdSet.has(element.id));
  if (orderedSelection.length !== selection.length) return null;

  const members: StudioGroupTransformMember[] = [];
  for (const element of orderedSelection) {
    if (element.type !== "draw") return null;
    const draw = element as DrawEl & El;
    if (options.preview.isLocked(element)) return null;
    if (
      studioLiveTransformPreviewBlockedForElement(
        element,
        studioDrawShapeIsBoundsDerived(draw.kind),
      )
    ) {
      return null;
    }
    const node = findStudioDrawWrapperNode(options.stage, element.id);
    if (
      !node
      || !studioLiveTransformPreviewEligible(node)
      || studioLiveTransformPreviewHasCachedDuplicate(options.stage, element.id, node)
      // A member still being dragged by another pointer, or one whose previous gesture's Layer
      // cleanup has not finished, already has a writer on its wrapper. Hiding it underneath a
      // draft would give that writer nothing visible to move and leave the release reading bounds
      // the user never saw. Refuse rather than arbitrate -- the same call the single lane makes.
      || studioKonvaDrawTransformIsBusy(options.stage, element.id, node)
    ) {
      return null;
    }
    if (
      !admitStudioLiveTransformDrawCompilation(draw, elements.length).admitted
      || studioDrawHasEffectivePerSampleOrientation(draw)
    ) {
      return null;
    }
    const snapshot = compileStudioLiveTransformDrawSnapshot(draw);
    const bounds = drawPointBounds(draw.points);
    if (!bounds) return null;
    const complexity = snapshot.exactDraftComplexity;
    const paintRadius = Math.max(
      0.5,
      complexity.rendererMaxPaintRadius ?? complexity.causalMaxDabRadius ?? draw.strokeWidth / 2,
    );
    members.push({
      element: draw,
      node,
      snapshot,
      paintBounds: {
        x: bounds.x - paintRadius,
        y: bounds.y - paintRadius,
        width: bounds.w + paintRadius * 2,
        height: bounds.h + paintRadius * 2,
      },
    });
  }
  const selectedIds = members.map((member) => member.element.id);
  const mainLayer = members[0]!.node.getLayer();
  if (!mainLayer || !dragLayer || mainLayer === dragLayer) return null;
  // Bound after the guard because `restoreSources` below is a hoisted `function` declaration, and
  // TypeScript resets a const's narrowing for those -- they are callable before the guard runs.
  const draftLayer: Konva.Layer = dragLayer;

  let parkedIndicators: Konva.Node[] = [];
  let chromeLift: StudioSingleObjectDragLayerSession | null = null;
  let previewSession: ReturnType<typeof createStudioLiveTransformPreviewSession> | null = null;
  let draftClaim: StudioLiveTransformDraftClaim | null = null;
  let terminalDraft: readonly DrawEl[] | null = null;
  let handoffRegistered = false;
  let handoffReleaseRequested = false;
  let handoffSourceRestored = false;
  /**
   * The members currently hidden for the draft, each mapped to the visibility it owes back.
   *
   * Membership IS the state -- there is deliberately no parallel "are they hidden" flag. A flag
   * has to be written either side of the loop and both choices are wrong: written after, a throw
   * part-way leaves members hidden while the flag says otherwise and the next call no-ops; written
   * before, the same thing happens in the RESTORE direction, which is the one that must never fail
   * silently. Per-member entries make both directions idempotent and resumable, so a retry after a
   * partial failure picks up exactly the members still owed.
   */
  const sourceVisibility = new Map<Konva.Node, boolean>();
  let closeState: "open" | "closing" | "closed" = "open";
  let closeOutcome: Parameters<
    StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame>["close"]
  >[0] | null = null;
  let terminalFramePrepared = false;

  const flushDraftPublication = options.preview.flushDraftPublication ?? flushSync;

  /**
   * Hide or restore every source wrapper at once, repainting the document Layer only when the
   * hidden state actually flips.
   *
   * The single-element lane lifts its source into the isolated Layer and can therefore repaint
   * cheaply every frame. A whole selection is not liftable without reordering the document, so
   * this lane leaves the sources in place and pays one main-Layer raster on the way in and one on
   * the way out; the per-frame cost stays confined to the isolated draft Layer.
   */
  const setSourcesHidden = (hidden: boolean): void => {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    const failures: unknown[] = [];
    let mutated = false;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      for (const member of members) {
        // A member already in the wanted state is skipped individually, so one throwing node never
        // decides anything for its neighbours and a retry resumes on exactly what is still owed.
        if (sourceVisibility.has(member.node) === hidden) continue;
        try {
          if (hidden) {
            sourceVisibility.set(member.node, member.node.visible());
            member.node.visible(false);
          } else {
            member.node.visible(sourceVisibility.get(member.node) ?? true);
            sourceVisibility.delete(member.node);
          }
          mutated = true;
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
    if (!mutated && failures.length === 0) return;
    try {
      mainLayer.drawScene();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Failed to ${hidden ? "hide" : "restore"} every group live-transform source`,
      );
    }
  };

  const frameAdmitted = (frame: StudioLiveSelectionTransformFrame): boolean => {
    const rasterMetrics = studioLiveTransformRasterMetrics(options.stage, dragLayer);
    const frameScale = studioDrawObjectTransformScale(options.sourceBounds, frame.targetBounds);
    if (!frameScale || !frameScale.uniform) return false;
    let totalWork = 0;
    let totalBackingPixels = 0;
    for (const member of members) {
      // Each member is graded on its OWN box mapped through this frame, not on the selection box.
      // The scale is identical either way -- the group planner applies one uniform factor to every
      // member -- so the sample and path-length terms are unchanged, while the footprint term
      // becomes the member's own fill instead of a copy of the union.
      const memberTarget = mapBoundsThroughFrame(
        member.paintBounds,
        options.sourceBounds,
        frame.targetBounds,
        frameScale.uniformEquivalent,
      );
      const decision = admitStudioLiveTransformExactDraft({
        complexity: member.snapshot.exactDraftComplexity,
        sourceBounds: member.paintBounds,
        targetBounds: memberTarget,
        sceneElementCount: elements.length,
        rasterScale: rasterMetrics.rasterScale,
        sceneCanvasBackingPixels: rasterMetrics.sceneCanvasBackingPixels,
        // The commit this frame previews preserves stroke width, so the charge must not shrink
        // with the box; see the field's own note.
        strokeWidthPolicy: "preserve",
      });
      if (!decision.admitted) return false;
      totalWork += decision.estimatedWork;
      totalBackingPixels += decision.estimatedBackingPixels;
    }
    // Per-member admission bounds one stroke; the frame draws all of them in one main-thread pass,
    // so the SUM has to fit the same UI-thread path-operation ceiling a single stroke gets.
    // Operation count and shaded area are independent dimensions and a frame pays both. Counting
    // alone would admit sixty two-point dots at a 500px width -- two dabs of work each, ninety
    // million shaded pixels between them -- because every per-element ceiling sees only its own
    // member. Charging the summed area against the same whole-frame ceiling one stroke gets closes
    // that: the selection may shade what a single admitted stroke may shade, and no more.
    return totalWork <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_SELECTION_WORK
      && totalBackingPixels <= STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS;
  };

  const exactPresentation = (
    frame: StudioLiveSelectionTransformFrame,
  ): readonly DrawEl[] | null => {
    if (!draftClaim) return null;
    if (!Number.isFinite(frame.rotationDeg) || !frameAdmitted(frame)) {
      restoreSources();
      return null;
    }
    // The planner is asked for the angle too, and it is the authority on whether the selection can
    // take one: a member that cannot carry an angle makes it return null, and this frame then
    // falls back to commit-at-release like any other refusal.
    const planned = planStudioGroupUniformResizeSelection({
      items: elements,
      selectedIds,
      sourceBounds: options.sourceBounds,
      targetBounds: frame.targetBounds,
      rotationDeg: frame.rotationDeg,
      isLocked: options.preview.isLocked,
    });
    if (!planned || planned.length !== members.length) {
      restoreSources();
      return null;
    }
    // The planner returns its selection in DOCUMENT order; the claim owns the caller's selection
    // order. Re-key by id rather than assuming the two agree -- a mismatch would otherwise refuse
    // every frame of an otherwise perfectly eligible gesture.
    const plannedById = new Map(planned.map((element) => [element.id, element]));
    const entries: StudioLiveTransformDraftEntry[] = [];
    for (const member of members) {
      const element = plannedById.get(member.element.id);
      if (element?.type !== "draw") {
        restoreSources();
        return null;
      }
      const transformedBounds = drawPointBounds(element.points);
      entries.push({
        element,
        clip: studioLiveTransformCommittedClip({
          targetBounds: frame.targetBounds,
          rotationDeg: frame.rotationDeg,
          elements,
          ...(transformedBounds ? { transformedBounds } : {}),
          ...(member.snapshot.noClip !== undefined ? { noClip: member.snapshot.noClip } : {}),
        }),
      });
    }
    const drafted = entries.map((entry) => entry.element);
    let published = false;
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      flushDraftPublication(() => {
        draftClaim?.present(entries);
      });
      // A subscriber may synchronously supersede this generation while the publication barrier is
      // open. Never hide the sources unless this exact publication is still the store authority.
      const publishedSnapshot = options.preview.draftStore?.getSnapshot();
      if (
        publishedSnapshot?.scope === options.preview.scope
        && publishedSnapshot.entries.length === entries.length
        && publishedSnapshot.entries.every((entry, index) => entry.element === drafted[index])
      ) {
        setSourcesHidden(true);
        terminalDraft = drafted;
        published = true;
      }
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
    if (!published) {
      restoreSources();
      return null;
    }
    draftLayer.drawScene();
    return drafted;
  };

  /** Give the document its pixels back and surrender any presented draft. */
  function restoreSources(mode: "clear" | "release" = "clear"): void {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      setSourcesHidden(false);
      const draftWasPresented = draftClaim?.hasPresentation() === true;
      if (draftClaim && (mode === "release" || draftWasPresented)) {
        let claimReceipt: boolean | null = null;
        flushDraftPublication(() => {
          claimReceipt = mode === "release"
            ? draftClaim?.release() ?? false
            : draftClaim?.clear() ?? false;
        });
        if (claimReceipt !== true && !draftClaim.isReleased()) {
          throw new Error(`Failed to ${mode} the group live-transform draft claim`);
        }
        if (draftWasPresented) draftLayer.drawScene();
      }
      terminalDraft = null;
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
  }

  const paintSourceReceiptSynchronously = (): void => {
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      setSourcesHidden(false);
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }
  };

  const cleanup = (
    outcome: Parameters<
      StudioLiveCanvasGestureTransientAdapter<StudioLiveSelectionTransformFrame>["close"]
    >[0],
  ): void => {
    if (closeState === "closed") return;
    if (closeState === "closing") {
      throw new Error("Konva group live-transform renderer cleanup is already in progress");
    }
    closeOutcome ??= outcome;
    const ownedOutcome = closeOutcome;
    closeState = "closing";
    const criticalFailures: unknown[] = [];
    const critical = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        criticalFailures.push(error);
      }
    };
    critical(() => previewSession?.dispose());
    if (!terminalFramePrepared) {
      if (ownedOutcome.kind === "commit") {
        critical(() => {
          terminalDraft = exactPresentation(ownedOutcome.terminalFrame);
          terminalFramePrepared = true;
        });
      } else {
        terminalDraft = null;
        terminalFramePrepared = true;
      }
    }
    let ownershipRestored = true;
    critical(() => {
      if (chromeLift && !chromeLift.restored && !restoreStudioSingleObjectDragLayer(chromeLift)) {
        ownershipRestored = false;
        throw new Error("Failed to restore the group transform chrome Layer ownership");
      }
    });
    critical(() => {
      for (const member of members) {
        member.node.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, undefined);
      }
    });
    if ((ownedOutcome.kind !== "commit" || terminalDraft === null) && ownershipRestored) {
      critical(() => {
        restoreSources("release");
      });
    }
    for (const indicator of parkedIndicators) {
      try {
        indicator.visible(true);
      } catch {
        // Ignore destroyed chrome; authoritative geometry cleanup continues.
      }
    }
    try {
      drainStudioLateParkedChrome(options.stage);
    } catch {
      // A stale hidden indicator is recoverable; a stuck renderer transform is not.
    }
    try {
      mainLayer.drawScene();
    } catch {
      // Cosmetic redraw only; the next authoritative render will repaint the Layer.
    }
    if (criticalFailures.length > 0) {
      closeState = "open";
      throw new AggregateError(
        criticalFailures,
        "Failed to completely release a Konva group live-transform renderer claim",
      );
    }
    closeState = "closed";
  };

  try {
    parkedIndicators = [
      ...options.stage.find(`.${STUDIO_DRAW_SELECTION_INDICATOR_NAME}`),
      ...options.stage.find(`.${STUDIO_GROUP_SELECTION_OVERLAY_NAME}`),
    ].filter((indicator) => indicator.visible());
    for (const indicator of parkedIndicators) indicator.visible(false);

    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    try {
      studioKonvaRuntime.autoDrawEnabled = false;
      for (const member of members) {
        member.node.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, true);
      }
    } finally {
      studioKonvaRuntime.autoDrawEnabled = autoDrawEnabled;
    }

    // Only the handles are lifted. Sources stay in the document Layer, so the isolated Layer holds
    // the chrome plus the draft root and a handle frame never repaints the page.
    chromeLift = beginStudioSingleDrawTransformChromeLayer({
      elementId: members[0]!.element.id,
      wrapper: members[0]!.node,
      proxy: options.proxy,
      transformer: options.transformer,
      dragLayer,
    });
    if (!chromeLift) {
      cleanup({ kind: "cancel", reason: "preview-error" });
      return null;
    }
    // Deliberately after the chrome lift and the indicator parking, not before: the proxy and its
    // Transformer are ordinary later siblings of the strokes until they move to the isolated
    // Layer, and grading the selection against its own gesture chrome would refuse every gesture.
    if (!studioLiveTransformGroupStackingIsolatable(members.map((member) => member.node))) {
      cleanup({ kind: "cancel", reason: "preview-error" });
      return null;
    }
    draftClaim = options.preview.draftStore?.claim(options.preview.scope, selectedIds) ?? null;
    if (!draftClaim) {
      cleanup({ kind: "cancel", reason: "preview-error" });
      return null;
    }

    previewSession = createStudioLiveTransformPreviewSession({
      sourceBounds: options.sourceBounds,
      // Forces every projectable frame down the exact lane: there is no retained affine that can
      // reproduce a width-preserving group resize.
      renderRoute: {
        retainedAffinePolicy: "model-draft-only",
        strokeWidth: 0,
        strokeDistance: 0,
        pointCount: 0,
      },
      scheduler: options.preview.scheduler ?? {
        requestFrame: (callback) => globalThis.requestAnimationFrame(callback),
        cancelFrame: (handle) => globalThis.cancelAnimationFrame(handle),
      },
      adapter: {
        presentationEnvironmentKey: () => {
          const metrics = studioLiveTransformRasterMetrics(options.stage, dragLayer);
          return `rasterScale:${metrics.rasterScale};backingPixels:${metrics.sceneCanvasBackingPixels}`;
        },
        // Unreachable while the route above says model-draft-only, and a refusal is the correct
        // answer if that ever changes: a retained affine here would show scaled line weight.
        apply: () => false,
        applyExact: (frame) => exactPresentation({
          targetBounds: frame.targetBounds,
          rotationDeg: frame.rotationDeg,
        }) !== null,
        neutralize: () => {
          restoreSources();
        },
      },
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
      ...(options.onFatalError !== undefined ? { onFatalError: options.onFatalError } : {}),
    });

    return {
      offer: (frame) => previewSession?.push(frame),
      close: cleanup,
      settle: ({ committed }) => {
        if (committed && terminalDraft) {
          if (!draftClaim) {
            restoreSources("release");
            return true;
          }
          if (!handoffRegistered) {
            const retained = draftClaim.handoff([...terminalDraft], () => {
              handoffReleaseRequested = true;
              paintSourceReceiptSynchronously();
              handoffSourceRestored = true;
            });
            handoffRegistered = retained;
            if (!retained) {
              if (!(handoffSourceRestored && draftClaim.isReleased())) {
                restoreSources("release");
              }
              return true;
            }
          }
          if (handoffSourceRestored && draftClaim.isReleased()) return true;
          if (handoffReleaseRequested) {
            const released = draftClaim.release();
            if (!released && !draftClaim.isReleased()) return false;
            if (!(handoffSourceRestored && draftClaim.isReleased())) {
              restoreSources("release");
            }
            return true;
          }
          // Registration alone is not settlement: hold the writer lease until the authoritative
          // document receipt (or the store's timeout) restores the sources.
          return false;
        }
        restoreSources("release");
        return true;
      },
    };
  } catch (error) {
    cleanup({ kind: "cancel", reason: "preview-error" });
    throw error;
  }
}
