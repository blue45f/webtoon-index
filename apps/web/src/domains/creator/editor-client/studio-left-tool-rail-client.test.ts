import { describe, expect, it, vi } from "vitest";

import { defaultStudioAppSettings } from "../studio-app-settings";

import {
  STUDIO_LEFT_TOOL_RAIL_COMMANDS,
  createStudioLeftToolRailClient,
  createStudioLeftToolRailRuntime,
  type StudioLeftToolRailClientInput,
} from "./studio-left-tool-rail-client";

function createInput(): StudioLeftToolRailClientInput {
  return {
    activeSurfaceReviewLocked: false,
    pixelToolTargetAvailable: true,
    rasterRetouchTargetAvailable: true,
    advancedFillActive: false,
    advancedFillUnsupportedReason: null,
    appSettings: defaultStudioAppSettings(),
    appSettingsOpen: false,
    canvasOnlyMode: false,
    commentPinArmed: false,
    cropActive: false,
    drawMode: "pen",
    drawShape: "rect",
    eyedropperActive: false,
    frameAnimOpen: false,
    frameAnimTargetId: null,
    isRailToolVisible: () => true,
    liquifyActive: false,
    mobileImmersive: false,
    perspectiveRulerActive: false,
    pixelForceCircle: false,
    pixelSel: null,
    pixelTool: null,
    quickShapeActive: false,
    railMoreOpen: false,
    referencePanelOpen: false,
    mannequinPoserOpen: false,
    poserVrmOpen: false,
    characterShaperOpen: false,
    bg3dOpen: false,
    hybridDccOpen: false,
    selected: null,
    selectedImageMutationLocked: false,
    dodgeBurnActive: false,
    wetMixActive: false,
    smudgeActive: false,
    tool: "select",
    uiDensityMode: "full",
    viewTransformSuppressed: false,
    viewTool: null,
    activatePrimaryCanvasTool: vi.fn(),
    toggleHandTool: vi.fn(),
    returnToSelectTool: vi.fn(),
    fitCanvasToWidth: vi.fn(),
    openFrameAnimationForSelected: vi.fn(),
    openPixelSelectionTransform: vi.fn(),
    openSelectedLayerCrop: vi.fn(),
    toggleBg3dEditor: vi.fn(),
    addBubble: vi.fn(),
    addText: vi.fn(),
    announceDrawingShortcut: vi.fn(),
    clearPolyLassoDraft: vi.fn(),
    commitAppSettings: vi.fn(),
    disarmAllPixelTools: vi.fn(),
    onRequestPixelSelection: vi.fn(),
    onRequestSelectImage: vi.fn(),
    onPickImage: vi.fn(async () => undefined),
    revealDrawToolProperties: vi.fn(),
    toggleAdvancedFill: vi.fn(),
    toggleDodgeBurnTool: vi.fn(),
    toggleWetMixTool: vi.fn(),
    toggleLiquifyTool: vi.fn(),
    togglePixelMarquee: vi.fn(),
    toggleSmudgeTool: vi.fn(),
    toggleStudioCommentPinPlacement: vi.fn(),
    setAppSettingsInitialTab: vi.fn(),
    setAppSettingsOpen: vi.fn(),
    setDrawShape: vi.fn(),
    setEyedropperActive: vi.fn(),
    setMenu: vi.fn(),
    setPerspectiveRulerActive: vi.fn(),
    setPixelForceCircle: vi.fn(),
    setPixelTool: vi.fn(),
    setQuickShapeActive: vi.fn(),
    setRailMoreOpen: vi.fn(),
    setReferencePanelOpen: vi.fn(),
    setViewTool: vi.fn(),
  };
}

describe("Studio left tool rail EditorClient adapter", () => {
  it("exposes an immutable selector snapshot without leaking host mutation ports", () => {
    const input = createInput();
    const client = createStudioLeftToolRailClient(input);
    const snapshot = client.getSnapshot();

    expect(snapshot.drawMode).toBe("pen");
    expect(snapshot.tool).toBe("select");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect("setDrawShape" in snapshot).toBe(false);
    expect("activatePrimaryCanvasTool" in snapshot).toBe(false);
  });

  it("routes a rail command through CommandRegistry and returns an applied receipt", async () => {
    const input = createInput();
    const client = createStudioLeftToolRailClient(input);

    const receipt = await client.dispatch({
      id: STUDIO_LEFT_TOOL_RAIL_COMMANDS.setDrawShape,
      payload: ["ellipse"],
      source: "test",
    });

    expect(input.setDrawShape).toHaveBeenCalledExactlyOnceWith("ellipse");
    expect(receipt.status).toBe("applied");
    expect(receipt.commandId).toBe(STUDIO_LEFT_TOOL_RAIL_COMMANDS.setDrawShape);
  });

  it("fails closed when an optional host action is not wired", async () => {
    const input = createInput();
    const client = createStudioLeftToolRailClient(input);
    const command = STUDIO_LEFT_TOOL_RAIL_COMMANDS.setHybridDccOpen;

    expect(client.availability(command).state).toBe("disabled");
    const receipt = await client.dispatch({
      id: command,
      payload: [true],
      source: "test",
    });

    expect(receipt.status).toBe("unavailable");
  });

  it("keeps one client, publishes changed view state and replaces host action ports", async () => {
    const initial = createInput();
    const runtime = createStudioLeftToolRailRuntime(initial);
    const client = runtime.client;
    const listener = vi.fn();
    client.subscribe(listener);

    const replacementSetDrawShape = vi.fn();
    const changed: StudioLeftToolRailClientInput = {
      ...initial,
      drawShape: "ellipse",
      setDrawShape: replacementSetDrawShape,
    };
    expect(runtime.update(changed)).toBe(true);
    expect(runtime.client).toBe(client);
    expect(client.getSnapshot().drawShape).toBe("ellipse");
    expect(listener).toHaveBeenCalledOnce();

    await client.dispatch({
      id: STUDIO_LEFT_TOOL_RAIL_COMMANDS.setDrawShape,
      payload: ["line"],
      source: "test",
    });
    expect(initial.setDrawShape).not.toHaveBeenCalled();
    expect(replacementSetDrawShape).toHaveBeenCalledExactlyOnceWith("line");

    const openHybridDcc = vi.fn();
    const contextOnly: StudioLeftToolRailClientInput = {
      ...changed,
      setHybridDccOpen: openHybridDcc,
    };
    expect(runtime.update(contextOnly)).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(
      client.availability(STUDIO_LEFT_TOOL_RAIL_COMMANDS.setHybridDccOpen).state,
    ).toBe("enabled");

    await client.dispatch({
      id: STUDIO_LEFT_TOOL_RAIL_COMMANDS.setHybridDccOpen,
      payload: [true],
      source: "test",
    });
    expect(openHybridDcc).toHaveBeenCalledExactlyOnceWith(true);
  });
});
