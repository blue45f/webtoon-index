import type { DrawMode, Tool } from "../studio-editor-tool-model";
import type { SelectionToolKind } from "../studio-selection-tools";

/**
 * `wand` is a StudioPage-local extension of the shared pixel-selection tools. Keeping it in this
 * pure boundary lets the eventual caller remove the current cast/narrowing split without pulling
 * any browser or React code into the state machine.
 */
export type StudioPixelSelectionPointerTool = SelectionToolKind | "wand";

/**
 * Transient tools that take the next canvas pointer away from the remembered primary tool.
 *
 * Pixel-selection data and persisted filter-mask pixels are deliberately absent. They are document
 * state, not pointer ownership, and survive a tool switch even though the armed gesture is cleared.
 */
export type StudioCanvasAuxiliaryPointerOwner =
  | { readonly kind: "advanced-fill" }
  | { readonly kind: "eyedropper" }
  | { readonly kind: "filter-mask" }
  | {
      readonly kind: "pixel-selection";
      readonly tool: StudioPixelSelectionPointerTool;
    };

export type StudioCanvasAuxiliaryPointerOwnerKind =
  StudioCanvasAuxiliaryPointerOwner["kind"];

export type StudioCanvasPrimaryPointerOwner =
  | { readonly kind: "select" }
  | { readonly kind: "hand" }
  | { readonly kind: "draw"; readonly drawMode: DrawMode };

/** Exactly one effective owner is returned: an auxiliary owner, or the remembered primary owner. */
export type StudioCanvasPointerOwner =
  | StudioCanvasPrimaryPointerOwner
  | StudioCanvasAuxiliaryPointerOwner;

/**
 * Imperative work that must not outlive an owner transition.
 *
 * These names map to existing StudioPage refs/controllers. A transition planner returns them in
 * cancellation order before any React setters are invoked.
 */
export type StudioCanvasUnfinishedSession =
  | "drawing-stroke"
  | "advanced-fill-tap"
  | "advanced-fill-work"
  | "advanced-fill-preview"
  | "filter-mask-stroke"
  | "pixel-selection-drag"
  | "poly-lasso-draft"
  | "pixel-selection-scan";

/**
 * Canonical state for the canvas pointer boundary.
 *
 * `drawMode` remains remembered while Select/Hand or an auxiliary owner is active, matching the
 * existing editor UX. `auxiliary` is a discriminated single slot, so two armed auxiliaries cannot
 * be represented by a valid machine state.
 */
export interface StudioCanvasToolMachineState {
  readonly tool: Tool;
  readonly drawMode: DrawMode;
  readonly auxiliary: StudioCanvasAuxiliaryPointerOwner | null;
  readonly unfinished: readonly StudioCanvasUnfinishedSession[];
}

export type StudioCanvasToolEvent =
  | { readonly type: "primary.select" }
  | { readonly type: "primary.hand" }
  | { readonly type: "primary.draw"; readonly drawMode: DrawMode }
  | {
      readonly type: "auxiliary.arm";
      readonly owner: StudioCanvasAuxiliaryPointerOwner;
    }
  | {
      /**
       * The expected kind makes a delayed one-shot completion harmless after another auxiliary has
       * already taken ownership.
       */
      readonly type: "auxiliary.release";
      readonly owner: StudioCanvasAuxiliaryPointerOwnerKind;
    };

/**
 * Ordered integration effects. `auxiliary.disarm-all` maps to the existing
 * `disarmAllPixelTools`; session cancellation commands fill the cleanup holes that function
 * currently leaves to individual callers.
 */
export type StudioCanvasToolTransitionCommand =
  | {
      readonly type: "session.cancel";
      readonly session: StudioCanvasUnfinishedSession;
    }
  | { readonly type: "auxiliary.disarm-all" }
  | { readonly type: "primary.set-tool"; readonly tool: Tool }
  | {
      readonly type: "primary.set-draw-mode";
      readonly drawMode: DrawMode;
    }
  | {
      readonly type: "auxiliary.arm";
      readonly owner: StudioCanvasAuxiliaryPointerOwner;
    };

export interface StudioCanvasToolTransitionPlan {
  readonly changed: boolean;
  readonly ownerChanged: boolean;
  readonly selectionDisarmedDrawingAuxiliary: boolean;
  readonly previousOwner: StudioCanvasPointerOwner;
  readonly nextOwner: StudioCanvasPointerOwner;
  readonly cancelledUnfinished: readonly StudioCanvasUnfinishedSession[];
  readonly commands: readonly StudioCanvasToolTransitionCommand[];
  readonly next: StudioCanvasToolMachineState;
}

function primaryPointerOwner(
  tool: Tool,
  drawMode: DrawMode,
): StudioCanvasPrimaryPointerOwner {
  return tool === "draw" ? { kind: "draw", drawMode } : { kind: tool };
}

export function studioCanvasPointerOwner(
  state: Pick<StudioCanvasToolMachineState, "tool" | "drawMode" | "auxiliary">,
): StudioCanvasPointerOwner {
  return state.auxiliary ?? primaryPointerOwner(state.tool, state.drawMode);
}

function sameAuxiliaryOwner(
  left: StudioCanvasAuxiliaryPointerOwner | null,
  right: StudioCanvasAuxiliaryPointerOwner | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind !== "pixel-selection"
    || (right.kind === "pixel-selection" && left.tool === right.tool);
}

function samePointerOwner(
  left: StudioCanvasPointerOwner,
  right: StudioCanvasPointerOwner,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "draw") {
    return right.kind === "draw" && left.drawMode === right.drawMode;
  }
  if (left.kind === "pixel-selection") {
    return right.kind === "pixel-selection" && left.tool === right.tool;
  }
  return true;
}

function auxiliaryRequiresSelection(
  owner: StudioCanvasAuxiliaryPointerOwner,
): boolean {
  return owner.kind !== "eyedropper";
}

function isDrawingAuxiliary(
  owner: StudioCanvasAuxiliaryPointerOwner | null,
): boolean {
  return (
    owner?.kind === "advanced-fill"
    || owner?.kind === "eyedropper"
    || owner?.kind === "filter-mask"
  );
}

function isSelectionOwner(owner: StudioCanvasPointerOwner): boolean {
  return owner.kind === "select" || owner.kind === "pixel-selection";
}

type StudioCanvasSessionOwner =
  | "primary-draw"
  | StudioCanvasAuxiliaryPointerOwnerKind;

function unfinishedSessionOwner(
  session: StudioCanvasUnfinishedSession,
): StudioCanvasSessionOwner {
  switch (session) {
    case "drawing-stroke":
      return "primary-draw";
    case "advanced-fill-tap":
    case "advanced-fill-work":
    case "advanced-fill-preview":
      return "advanced-fill";
    case "filter-mask-stroke":
      return "filter-mask";
    case "pixel-selection-drag":
    case "poly-lasso-draft":
    case "pixel-selection-scan":
      return "pixel-selection";
  }
}

function pointerOwnerSessionKind(
  owner: StudioCanvasPointerOwner,
): StudioCanvasSessionOwner | null {
  if (owner.kind === "draw") return "primary-draw";
  if (
    owner.kind === "advanced-fill"
    || owner.kind === "filter-mask"
    || owner.kind === "pixel-selection"
    || owner.kind === "eyedropper"
  ) {
    return owner.kind;
  }
  return null;
}

function uniqueSessions(
  sessions: readonly StudioCanvasUnfinishedSession[],
): StudioCanvasUnfinishedSession[] {
  return [...new Set(sessions)];
}

function resolveRequestedState(
  current: StudioCanvasToolMachineState,
  event: StudioCanvasToolEvent,
): {
  readonly accepted: boolean;
  readonly tool: Tool;
  readonly drawMode: DrawMode;
  readonly auxiliary: StudioCanvasAuxiliaryPointerOwner | null;
} {
  switch (event.type) {
    case "primary.select":
      return {
        accepted: true,
        tool: "select",
        drawMode: current.drawMode,
        auxiliary: null,
      };
    case "primary.hand":
      return {
        accepted: true,
        tool: "hand",
        drawMode: current.drawMode,
        auxiliary: null,
      };
    case "primary.draw":
      return {
        accepted: true,
        tool: "draw",
        drawMode: event.drawMode,
        auxiliary: null,
      };
    case "auxiliary.arm":
      return {
        accepted: true,
        tool: auxiliaryRequiresSelection(event.owner) ? "select" : current.tool,
        drawMode: current.drawMode,
        auxiliary: event.owner,
      };
    case "auxiliary.release":
      return current.auxiliary?.kind === event.owner
        ? {
            accepted: true,
            tool: current.tool,
            drawMode: current.drawMode,
            auxiliary: null,
          }
        : {
            accepted: false,
            tool: current.tool,
            drawMode: current.drawMode,
            auxiliary: current.auxiliary,
          };
  }
}

/**
 * Plans one atomic canvas-tool transition.
 *
 * Cancellation always precedes disarm, primary setters, and the new auxiliary arm. Re-selecting
 * the current primary tool still emits `auxiliary.disarm-all`, matching the existing recovery
 * contract for transient owners outside this focused machine. It does not cancel a valid active
 * drawing stroke unless the effective owner or draw mode actually changes.
 */
export function planStudioCanvasToolTransition(
  current: StudioCanvasToolMachineState,
  event: StudioCanvasToolEvent,
): StudioCanvasToolTransitionPlan {
  const requested = resolveRequestedState(current, event);
  const previousOwner = studioCanvasPointerOwner(current);
  if (!requested.accepted) {
    return {
      changed: false,
      ownerChanged: false,
      selectionDisarmedDrawingAuxiliary: false,
      previousOwner,
      nextOwner: previousOwner,
      cancelledUnfinished: [],
      commands: [],
      next: current,
    };
  }

  const requestedState = {
    tool: requested.tool,
    drawMode: requested.drawMode,
    auxiliary: requested.auxiliary,
  };
  const nextOwner = studioCanvasPointerOwner(requestedState);
  const ownerChanged = !samePointerOwner(previousOwner, nextOwner);
  const primaryChanged =
    current.tool !== requested.tool || current.drawMode !== requested.drawMode;
  const auxiliaryChanged = !sameAuxiliaryOwner(
    current.auxiliary,
    requested.auxiliary,
  );
  const transitionBoundary = ownerChanged || primaryChanged || auxiliaryChanged;
  const nextSessionKind = pointerOwnerSessionKind(nextOwner);
  const currentSessions = uniqueSessions(current.unfinished);
  const cancelledUnfinished = currentSessions.filter(
    (session) =>
      transitionBoundary || unfinishedSessionOwner(session) !== nextSessionKind,
  );
  const cancelledSet = new Set(cancelledUnfinished);
  const unfinished = currentSessions.filter(
    (session) => !cancelledSet.has(session),
  );
  const commands: StudioCanvasToolTransitionCommand[] = cancelledUnfinished.map(
    (session) => ({ type: "session.cancel", session }),
  );

  const primaryIntent = event.type.startsWith("primary.");
  const shouldDisarmAll =
    transitionBoundary
    || primaryIntent
    || event.type === "auxiliary.release";
  if (shouldDisarmAll) commands.push({ type: "auxiliary.disarm-all" });
  if (current.tool !== requested.tool) {
    commands.push({ type: "primary.set-tool", tool: requested.tool });
  }
  if (current.drawMode !== requested.drawMode) {
    commands.push({
      type: "primary.set-draw-mode",
      drawMode: requested.drawMode,
    });
  }
  if (
    event.type === "auxiliary.arm"
    && (auxiliaryChanged || primaryChanged)
  ) {
    commands.push({ type: "auxiliary.arm", owner: event.owner });
  }

  const next: StudioCanvasToolMachineState = {
    tool: requested.tool,
    drawMode: requested.drawMode,
    auxiliary: requested.auxiliary,
    unfinished,
  };

  return {
    changed:
      primaryChanged
      || auxiliaryChanged
      || cancelledUnfinished.length > 0,
    ownerChanged,
    selectionDisarmedDrawingAuxiliary:
      isDrawingAuxiliary(current.auxiliary) && isSelectionOwner(nextOwner),
    previousOwner,
    nextOwner,
    cancelledUnfinished,
    commands,
    next,
  };
}

export type StudioCanvasToolStateViolation =
  | {
      readonly code: "auxiliary-requires-selection";
      readonly owner: StudioCanvasAuxiliaryPointerOwnerKind;
      readonly tool: Tool;
    }
  | {
      readonly code: "duplicate-unfinished-session";
      readonly session: StudioCanvasUnfinishedSession;
    }
  | {
      readonly code: "unfinished-session-owner-mismatch";
      readonly session: StudioCanvasUnfinishedSession;
      readonly owner: StudioCanvasPointerOwner;
    };

/** Audits a canonical state at integration and test boundaries. */
export function studioCanvasToolStateViolations(
  state: StudioCanvasToolMachineState,
): StudioCanvasToolStateViolation[] {
  const violations: StudioCanvasToolStateViolation[] = [];
  if (
    state.auxiliary
    && auxiliaryRequiresSelection(state.auxiliary)
    && state.tool !== "select"
  ) {
    violations.push({
      code: "auxiliary-requires-selection",
      owner: state.auxiliary.kind,
      tool: state.tool,
    });
  }

  const owner = studioCanvasPointerOwner(state);
  const expectedSessionOwner = pointerOwnerSessionKind(owner);
  const seen = new Set<StudioCanvasUnfinishedSession>();
  for (const session of state.unfinished) {
    if (seen.has(session)) {
      violations.push({
        code: "duplicate-unfinished-session",
        session,
      });
      continue;
    }
    seen.add(session);
    if (unfinishedSessionOwner(session) !== expectedSessionOwner) {
      violations.push({
        code: "unfinished-session-owner-mismatch",
        session,
        owner,
      });
    }
  }
  return violations;
}

/**
 * Adapter-shaped snapshot of the current independent React flags. This remains separate from the
 * canonical state so integration can detect existing overlap instead of silently choosing a
 * winner according to `onStageDown` branch order.
 */
export interface StudioCanvasPointerFlagsSnapshot {
  readonly tool: Tool;
  readonly drawMode: DrawMode;
  readonly advancedFillActive: boolean;
  readonly eyedropperActive: boolean;
  readonly filterMaskPaintActive: boolean;
  readonly pixelSelectionTool: StudioPixelSelectionPointerTool | null;
}

export type StudioCanvasPointerFlagsViolation =
  | {
      readonly code: "multiple-auxiliary-owners";
      readonly owners: readonly StudioCanvasAuxiliaryPointerOwner[];
    }
  | {
      readonly code: "auxiliary-requires-selection";
      readonly owner: StudioCanvasAuxiliaryPointerOwnerKind;
      readonly tool: Tool;
    };

export interface StudioCanvasPointerFlagsAudit {
  readonly valid: boolean;
  readonly owners: readonly StudioCanvasPointerOwner[];
  readonly violations: readonly StudioCanvasPointerFlagsViolation[];
}

/** Detects overlap in the current independently stored boolean/tool flags. */
export function auditStudioCanvasPointerFlags(
  snapshot: StudioCanvasPointerFlagsSnapshot,
): StudioCanvasPointerFlagsAudit {
  const auxiliaryOwners: StudioCanvasAuxiliaryPointerOwner[] = [];
  if (snapshot.advancedFillActive) {
    auxiliaryOwners.push({ kind: "advanced-fill" });
  }
  if (snapshot.eyedropperActive) {
    auxiliaryOwners.push({ kind: "eyedropper" });
  }
  if (snapshot.filterMaskPaintActive) {
    auxiliaryOwners.push({ kind: "filter-mask" });
  }
  if (snapshot.pixelSelectionTool) {
    auxiliaryOwners.push({
      kind: "pixel-selection",
      tool: snapshot.pixelSelectionTool,
    });
  }

  const violations: StudioCanvasPointerFlagsViolation[] = [];
  if (auxiliaryOwners.length > 1) {
    violations.push({
      code: "multiple-auxiliary-owners",
      owners: auxiliaryOwners,
    });
  }
  for (const owner of auxiliaryOwners) {
    if (auxiliaryRequiresSelection(owner) && snapshot.tool !== "select") {
      violations.push({
        code: "auxiliary-requires-selection",
        owner: owner.kind,
        tool: snapshot.tool,
      });
    }
  }

  return {
    valid: violations.length === 0,
    owners:
      auxiliaryOwners.length > 0
        ? auxiliaryOwners
        : [primaryPointerOwner(snapshot.tool, snapshot.drawMode)],
    violations,
  };
}
