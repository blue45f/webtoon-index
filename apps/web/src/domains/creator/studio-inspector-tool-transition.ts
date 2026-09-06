import type { DrawMode } from "./studio-editor-tool-model";
import type { StudioInspectorLayout } from "./studio-inspector-layout";

export {
  executeStudioPrimaryCanvasToolTransition,
  type StudioCanvasToolState,
  type StudioPrimaryCanvasTool,
} from "./studio-primary-canvas-tool-transition";

export type StudioInspectorTransientOwner =
  | "fill"
  | "retouch"
  | "mask"
  | "transform"
  | "draw"
  | "properties";

export interface StudioInspectorTransientState {
  advancedFillActive: boolean;
  advancedFillBusy: boolean;
  advancedFillPreviewActive: boolean;
  autoColorScribbleArmed: boolean;
  pixelToolActive: boolean;
  polyLassoSessionActive: boolean;
  colorRangePickActive: boolean;
  quickMaskActive: boolean;
  smudgeActive: boolean;
  dodgeBurnActive: boolean;
  wetMixActive: boolean;
  liquifyActive: boolean;
  healCloneActive: boolean;
  historyBrushActive: boolean;
  layerMaskPaintActive: boolean;
  filterMaskPaintActive: boolean;
  cropActive: boolean;
  puppetWarpActive: boolean;
  eyedropperActive: boolean;
  quickShapeActive: boolean;
  nodeEditActive: boolean;
  bubbleAnchorPickActive: boolean;
  bubbleShapeEditActive: boolean;
  panelSplitActive: boolean;
}

type StudioInspectorTransientKey = keyof StudioInspectorTransientState;

/**
 * Canvas pointer ownership table for transient Inspector tools.
 *
 * A session may remain armed only while its owning property panel is visible.
 * Stable settings (radius, tolerance, presets, etc.) are deliberately absent:
 * `disarmAllPixelTools` clears only pointer capture/preview/session state and
 * keeps those settings ready for the next activation.
 */
export const STUDIO_INSPECTOR_TRANSIENT_STATE_TABLE = [
  ["advancedFillActive", "fill"],
  ["advancedFillBusy", "fill"],
  ["advancedFillPreviewActive", "fill"],
  ["autoColorScribbleArmed", "fill"],
  ["pixelToolActive", "retouch"],
  ["polyLassoSessionActive", "retouch"],
  ["colorRangePickActive", "retouch"],
  ["quickMaskActive", "retouch"],
  ["smudgeActive", "retouch"],
  ["dodgeBurnActive", "retouch"],
  ["wetMixActive", "retouch"],
  ["liquifyActive", "retouch"],
  ["healCloneActive", "retouch"],
  ["historyBrushActive", "retouch"],
  ["layerMaskPaintActive", "mask"],
  ["filterMaskPaintActive", "mask"],
  ["cropActive", "transform"],
  ["puppetWarpActive", "transform"],
  ["eyedropperActive", "draw"],
  ["quickShapeActive", "draw"],
  ["nodeEditActive", "properties"],
  ["bubbleAnchorPickActive", "properties"],
  ["bubbleShapeEditActive", "properties"],
  ["panelSplitActive", "properties"],
] as const satisfies readonly [
  StudioInspectorTransientKey,
  StudioInspectorTransientOwner,
][];

export function studioInspectorTransientOwners(
  transient: StudioInspectorTransientState,
): StudioInspectorTransientOwner[] {
  const owners = new Set<StudioInspectorTransientOwner>();
  for (const [state, owner] of STUDIO_INSPECTOR_TRANSIENT_STATE_TABLE) {
    if (transient[state]) owners.add(owner);
  }
  return [...owners];
}

function sameInspectorLayout(
  left: StudioInspectorLayout,
  right: StudioInspectorLayout,
): boolean {
  return (
    left.primary === right.primary &&
    left.image === right.image &&
    left.document === right.document
  );
}

function inspectorRouteSupportsOwner(
  layout: StudioInspectorLayout,
  owner: StudioInspectorTransientOwner,
  drawing: boolean,
): boolean {
  if (layout.primary !== "properties") return false;
  if (owner === "properties") return true;
  if (owner === "draw") return drawing;
  return layout.image === owner;
}

export interface StudioInspectorRouteTransitionInput {
  current: StudioInspectorLayout;
  next: StudioInspectorLayout;
  transient: StudioInspectorTransientState;
  drawing: boolean;
}

export interface StudioInspectorRouteTransitionPlan {
  kind: "unchanged" | "navigate" | "disarm" | "navigate-and-disarm";
  shouldDisarm: boolean;
  shouldNavigate: boolean;
  unsupportedOwners: StudioInspectorTransientOwner[];
}

export function planStudioInspectorRouteTransition({
  current,
  next,
  transient,
  drawing,
}: StudioInspectorRouteTransitionInput): StudioInspectorRouteTransitionPlan {
  const shouldNavigate = !sameInspectorLayout(current, next);
  const unsupportedOwners = studioInspectorTransientOwners(transient).filter(
    (owner) => !inspectorRouteSupportsOwner(next, owner, drawing),
  );
  const shouldDisarm = unsupportedOwners.length > 0;
  const kind = shouldNavigate
    ? shouldDisarm
      ? "navigate-and-disarm"
      : "navigate"
    : shouldDisarm
      ? "disarm"
      : "unchanged";

  return {
    kind,
    shouldDisarm,
    shouldNavigate,
    unsupportedOwners,
  };
}

export interface StudioInspectorRouteTransitionActions {
  disarm: () => void;
  navigate: (next: StudioInspectorLayout) => void;
}

export function executeStudioInspectorRouteTransition(
  input: StudioInspectorRouteTransitionInput,
  actions: StudioInspectorRouteTransitionActions,
): StudioInspectorRouteTransitionPlan {
  const plan = planStudioInspectorRouteTransition(input);
  if (plan.shouldDisarm) actions.disarm();
  if (plan.shouldNavigate) actions.navigate(input.next);
  return plan;
}

export type StudioInspectorDrawModeTransition =
  | { kind: "unchanged"; next: DrawMode }
  | { kind: "change-and-disarm"; next: DrawMode };

export function executeStudioInspectorArmedChange(
  next: boolean,
  actions: {
    disarm: () => void;
    setActive: (next: boolean) => void;
  },
) {
  if (next) actions.disarm();
  actions.setActive(next);
  return {
    kind: next ? "arm" as const : "disarm" as const,
    next,
  };
}

export function executeStudioInspectorArmedToggle(
  current: boolean,
  actions: {
    disarm: () => void;
    setActive: (next: boolean) => void;
  },
) {
  const next = !current;
  return executeStudioInspectorArmedChange(next, actions);
}

export function executeStudioInspectorDrawModeTransition(
  current: DrawMode,
  next: DrawMode,
  actions: {
    disarm: () => void;
    setDrawMode: (next: DrawMode) => void;
  },
): StudioInspectorDrawModeTransition {
  if (current === next) return { kind: "unchanged", next };

  actions.disarm();
  actions.setDrawMode(next);
  return { kind: "change-and-disarm", next };
}

export function planStudioInspectorPanelVisibilityTransition(input: {
  open: boolean;
  nextOpen: boolean;
  layout: StudioInspectorLayout;
  transient: StudioInspectorTransientState;
}) {
  return {
    open: input.nextOpen,
    layout: input.layout,
    transient: input.transient,
    shouldDisarm: false as const,
  };
}
