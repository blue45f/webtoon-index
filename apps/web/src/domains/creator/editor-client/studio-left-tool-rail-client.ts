import {
  CommandRegistry,
  createEditorClientRuntime,
  EDITOR_REQUEST_SERVICE_KEY,
} from "@toonspectrum/studio-command-registry";

import type { StudioAppSettings, StudioAppSettingsTab, StudioRailToolId } from "../studio-app-settings";
import type { BubbleVariant } from "../studio-assets";
import type { DrawMode, DrawShapeKind, StudioMenu, Tool } from "../studio-editor-tool-model";
import type { El } from "../studio-element-model";
import type { PixelSelection, SelectionToolKind } from "../studio-selection-tools";
import type {
  CommandContext,
  CommandId,
  EditorClient,
  EditorCommandRequest,
} from "@toonspectrum/studio-command-registry";
import type { ChangeEvent } from "react";

/**
 * The immutable view state consumed by the left tool rail.
 *
 * Host-owned React setters deliberately do not appear here. The rail reads this
 * snapshot through `useEditorSelector` and changes state only by dispatching a
 * registered command through the accompanying `EditorClient`.
 */
export interface StudioLeftToolRailSnapshot {
  readonly activeSurfaceReviewLocked: boolean;
  readonly pixelToolTargetAvailable: boolean;
  readonly rasterRetouchTargetAvailable: boolean;
  readonly advancedFillActive: boolean;
  readonly advancedFillUnsupportedReason: string | null;
  readonly appSettings: StudioAppSettings;
  readonly appSettingsOpen: boolean;
  readonly canvasOnlyMode: boolean;
  readonly commentPinArmed: boolean;
  readonly cropActive: boolean;
  readonly drawMode: DrawMode;
  readonly drawShape: DrawShapeKind;
  readonly eyedropperActive: boolean;
  readonly frameAnimOpen: boolean;
  readonly frameAnimTargetId: string | null;
  readonly isRailToolVisible: (id: StudioRailToolId) => boolean;
  readonly liquifyActive: boolean;
  readonly mobileImmersive: boolean;
  readonly perspectiveRulerActive: boolean;
  readonly pixelForceCircle: boolean;
  readonly pixelSel: PixelSelection | null;
  readonly pixelTool: SelectionToolKind | "wand" | null;
  readonly quickShapeActive: boolean;
  readonly railMoreOpen: boolean;
  readonly referencePanelOpen: boolean;
  readonly mannequinPoserOpen: boolean;
  readonly poserVrmOpen: boolean;
  readonly characterShaperOpen: boolean;
  readonly bg3dOpen: boolean;
  readonly hybridDccOpen: boolean;
  readonly selected: El | null;
  readonly selectedImageMutationLocked: boolean;
  readonly dodgeBurnActive: boolean;
  readonly wetMixActive: boolean;
  readonly smudgeActive: boolean;
  readonly tool: Tool;
  readonly uiDensityMode: "simple" | "full" | "focus";
  readonly viewTransformSuppressed: boolean;
  readonly viewTool: "zoom" | "rotate" | null;
}

/** Named editor operations already owned by the Studio host. */
export interface StudioLeftToolRailHandlersContract {
  readonly activatePrimaryCanvasTool: (
    tool: "select" | "draw",
    drawMode?: DrawMode,
  ) => void;
  readonly toggleHandTool: () => void;
  readonly returnToSelectTool: () => void;
  readonly fitCanvasToWidth: () => void;
  readonly fitCanvasToWidthWithFocus?: () => void;
  readonly openFrameAnimationForSelected: () => void;
  readonly openPixelSelectionTransform: () => void;
  readonly openSelectedLayerCrop: () => void;
  readonly toggleBg3dEditor: () => void;
  readonly addBubble: (
    variant: BubbleVariant,
    at?: { x: number; y: number },
    editImmediately?: boolean,
  ) => void;
  readonly addText: (
    at?: { x: number; y: number },
    editImmediately?: boolean,
  ) => void;
  readonly announceDrawingShortcut: (message: string) => void;
  readonly clearPolyLassoDraft: () => void;
  readonly commitAppSettings: (next: StudioAppSettings) => void;
  readonly disarmAllPixelTools: () => void;
  readonly onRequestPixelSelection: () => void;
  readonly onRequestSelectImage: () => void;
  readonly onPickImage: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  readonly revealDrawToolProperties: () => void;
  readonly toggleAdvancedFill: () => void;
  readonly toggleDodgeBurnTool: () => void;
  readonly toggleWetMixTool: () => void;
  readonly toggleLiquifyTool: () => void;
  readonly togglePixelMarquee: (kind: "rect" | "circle") => void;
  readonly toggleSmudgeTool: () => void;
  readonly toggleStudioCommentPinPlacement: () => void;
}

/**
 * Concrete mutation ports held by the adapter, never exposed as component props.
 * State-updater functions are resolved in the rail before dispatch so command
 * payloads contain values rather than React closures.
 */
export interface StudioLeftToolRailActions
  extends StudioLeftToolRailHandlersContract {
  readonly setAppSettingsInitialTab: (value: StudioAppSettingsTab) => void;
  readonly setAppSettingsOpen: (value: boolean) => void;
  readonly setDrawShape: (value: DrawShapeKind) => void;
  readonly setEyedropperActive: (value: boolean) => void;
  readonly setMenu: (value: StudioMenu | null) => void;
  readonly setPerspectiveRulerActive: (value: boolean) => void;
  readonly setPixelForceCircle: (value: boolean) => void;
  readonly setPixelTool: (value: SelectionToolKind | "wand" | null) => void;
  readonly setQuickShapeActive: (value: boolean) => void;
  readonly setRailMoreOpen: (value: boolean) => void;
  readonly setReferencePanelOpen: (value: boolean) => void;
  readonly setMannequinPoserOpen?: (value: boolean) => void;
  readonly setPoserVrmOpen?: (value: boolean) => void;
  readonly setCharacterShaperOpen?: (value: boolean) => void;
  readonly setHybridDccOpen?: (value: boolean) => void;
  readonly setViewTool: (value: "zoom" | "rotate" | null) => void;
}

export type StudioLeftToolRailClientInput =
  StudioLeftToolRailSnapshot & StudioLeftToolRailActions;
export type StudioLeftToolRailClient = EditorClient<StudioLeftToolRailSnapshot>;
export type StudioLeftToolRailActionName = keyof StudioLeftToolRailActions;
export type StudioLeftToolRailActionArguments<
  K extends StudioLeftToolRailActionName,
> = NonNullable<StudioLeftToolRailActions[K]> extends (...args: infer A) => unknown ? A : never;

/** Stable owner mounted once by the Studio workspace. */
export interface StudioLeftToolRailRuntime {
  readonly client: StudioLeftToolRailClient;
  update(input: StudioLeftToolRailClientInput): boolean;
}

export const STUDIO_LEFT_TOOL_RAIL_COMMANDS = {
  activatePrimaryCanvasTool: "rail.tool.activate-primary",
  toggleHandTool: "rail.tool.toggle-hand",
  returnToSelectTool: "rail.tool.return-select",
  fitCanvasToWidth: "rail.view.fit-width",
  fitCanvasToWidthWithFocus: "rail.view.fit-width-focus",
  openFrameAnimationForSelected: "rail.animation.open-selected",
  openPixelSelectionTransform: "rail.selection.open-transform",
  openSelectedLayerCrop: "rail.crop.open-selected-layer",
  toggleBg3dEditor: "rail.scene.toggle-bg3d",
  addBubble: "rail.insert.add-bubble",
  addText: "rail.insert.add-text",
  announceDrawingShortcut: "rail.announce.drawing-shortcut",
  clearPolyLassoDraft: "rail.selection.clear-poly-lasso",
  commitAppSettings: "rail.settings.commit",
  disarmAllPixelTools: "rail.pixel.disarm-all",
  onRequestPixelSelection: "rail.selection.request-pixel",
  onRequestSelectImage: "rail.selection.request-image",
  onPickImage: "rail.image.pick",
  revealDrawToolProperties: "rail.inspector.reveal-draw-properties",
  toggleAdvancedFill: "rail.fill.toggle-advanced",
  toggleDodgeBurnTool: "rail.retouch.toggle-dodge-burn",
  toggleWetMixTool: "rail.retouch.toggle-wet-mix",
  toggleLiquifyTool: "rail.retouch.toggle-liquify",
  togglePixelMarquee: "rail.selection.toggle-marquee",
  toggleSmudgeTool: "rail.retouch.toggle-smudge",
  toggleStudioCommentPinPlacement: "rail.comment.toggle-pin-placement",
  setAppSettingsInitialTab: "rail.settings.set-initial-tab",
  setAppSettingsOpen: "rail.settings.set-open",
  setDrawShape: "rail.draw.set-shape",
  setEyedropperActive: "rail.eyedropper.set-active",
  setMenu: "rail.menu.set",
  setPerspectiveRulerActive: "rail.perspective.set-active",
  setPixelForceCircle: "rail.pixel.set-force-circle",
  setPixelTool: "rail.pixel.set-tool",
  setQuickShapeActive: "rail.quick-shape.set-active",
  setRailMoreOpen: "rail.more.set-open",
  setReferencePanelOpen: "rail.reference.set-open",
  setMannequinPoserOpen: "rail.mannequin.set-open",
  setPoserVrmOpen: "rail.vrm.set-open",
  setCharacterShaperOpen: "rail.character-shaper.set-open",
  setHybridDccOpen: "rail.hybrid-dcc.set-open",
  setViewTool: "rail.view.set-tool",
} as const satisfies Record<StudioLeftToolRailActionName, CommandId>;

const ACTIONS_SERVICE_KEY = "studio.left-tool-rail.actions";

type UnknownAction = (...args: unknown[]) => unknown;

function actionsFromContext(
  context: CommandContext,
): StudioLeftToolRailActions | null {
  const value = context.services.get(ACTIONS_SERVICE_KEY);
  return typeof value === "object" && value !== null
    ? value as StudioLeftToolRailActions
    : null;
}

function actionFromContext(
  context: CommandContext,
  action: StudioLeftToolRailActionName,
): UnknownAction | null {
  const candidate = actionsFromContext(context)?.[action];
  return typeof candidate === "function"
    ? candidate as unknown as UnknownAction
    : null;
}

function requestArguments(context: CommandContext): unknown[] {
  const request = context.services.get(EDITOR_REQUEST_SERVICE_KEY);
  if (typeof request !== "object" || request === null) return [];
  const payload = (request as EditorCommandRequest).payload;
  return Array.isArray(payload) ? payload : [];
}

const RAIL_COMMAND_REGISTRY = new CommandRegistry();
for (const [action, id] of Object.entries(STUDIO_LEFT_TOOL_RAIL_COMMANDS) as Array<
  [StudioLeftToolRailActionName, CommandId]
>) {
  RAIL_COMMAND_REGISTRY.register({
    id,
    title: action,
    category: "rail",
    when: (context) => actionFromContext(context, action) !== null,
    run: async (context) => {
      const handler = actionFromContext(context, action);
      if (!handler) {
        throw new Error(`left tool rail action is unavailable: ${action}`);
      }
      await handler(...requestArguments(context));
    },
  });
}

function snapshotFromInput(
  input: StudioLeftToolRailClientInput,
  previous?: StudioLeftToolRailSnapshot,
): StudioLeftToolRailSnapshot {
  const next: StudioLeftToolRailSnapshot = {
    activeSurfaceReviewLocked: input.activeSurfaceReviewLocked,
    pixelToolTargetAvailable: input.pixelToolTargetAvailable,
    rasterRetouchTargetAvailable: input.rasterRetouchTargetAvailable,
    advancedFillActive: input.advancedFillActive,
    advancedFillUnsupportedReason: input.advancedFillUnsupportedReason,
    appSettings: input.appSettings,
    appSettingsOpen: input.appSettingsOpen,
    canvasOnlyMode: input.canvasOnlyMode,
    commentPinArmed: input.commentPinArmed,
    cropActive: input.cropActive,
    drawMode: input.drawMode,
    drawShape: input.drawShape,
    eyedropperActive: input.eyedropperActive,
    frameAnimOpen: input.frameAnimOpen,
    frameAnimTargetId: input.frameAnimTargetId,
    isRailToolVisible: input.isRailToolVisible,
    liquifyActive: input.liquifyActive,
    mobileImmersive: input.mobileImmersive,
    perspectiveRulerActive: input.perspectiveRulerActive,
    pixelForceCircle: input.pixelForceCircle,
    pixelSel: input.pixelSel,
    pixelTool: input.pixelTool,
    quickShapeActive: input.quickShapeActive,
    railMoreOpen: input.railMoreOpen,
    referencePanelOpen: input.referencePanelOpen,
    mannequinPoserOpen: input.mannequinPoserOpen,
    poserVrmOpen: input.poserVrmOpen,
    characterShaperOpen: input.characterShaperOpen,
    bg3dOpen: input.bg3dOpen,
    hybridDccOpen: input.hybridDccOpen,
    selected: input.selected,
    selectedImageMutationLocked: input.selectedImageMutationLocked,
    dodgeBurnActive: input.dodgeBurnActive,
    wetMixActive: input.wetMixActive,
    smudgeActive: input.smudgeActive,
    tool: input.tool,
    uiDensityMode: input.uiDensityMode,
    viewTransformSuppressed: input.viewTransformSuppressed,
    viewTool: input.viewTool,
  };

  if (previous) {
    const keys = Object.keys(next) as Array<keyof StudioLeftToolRailSnapshot>;
    if (keys.every((key) => Object.is(next[key], previous[key]))) {
      return previous;
    }
  }
  return Object.freeze(next);
}

function commandContextForInput(
  input: StudioLeftToolRailClientInput,
): CommandContext {
  return {
    workspace: "comic",
    services: new Map<string, unknown>([
      [ACTIONS_SERVICE_KEY, input],
    ]),
  };
}

/**
 * Creates a persistent rail runtime. Parent renders replace its immutable view
 * snapshot and latest action ports, while the client identity and command
 * lifecycle remain stable for the mounted workspace session.
 */
export function createStudioLeftToolRailRuntime(
  initialInput: StudioLeftToolRailClientInput,
): StudioLeftToolRailRuntime {
  let requestSequence = 0;
  const runtime = createEditorClientRuntime({
    registry: RAIL_COMMAND_REGISTRY,
    initialSnapshot: snapshotFromInput(initialInput),
    initialContext: () => commandContextForInput(initialInput),
    requestId: () =>
      `rail-${Date.now().toString(36)}-${(requestSequence += 1).toString(36)}`,
  });

  return {
    client: runtime.client,
    update: (input) => runtime.update({
      snapshot: snapshotFromInput(input, runtime.client.getSnapshot()),
      context: () => commandContextForInput(input),
    }),
  };
}

/**
 * Compatibility factory for isolated consumers and tests that need one static
 * snapshot. Mounted product UI should keep a `StudioLeftToolRailRuntime`.
 */
export function createStudioLeftToolRailClient(
  input: StudioLeftToolRailClientInput,
): StudioLeftToolRailClient {
  return createStudioLeftToolRailRuntime(input).client;
}
