// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./brush/studio-brush-catalog";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import {
  StudioOptionsBars,
  type StudioOptionsBarsDrawModel,
  type StudioOptionsBarsHandlers,
  type StudioOptionsBarsProps,
  type StudioOptionsBarsSelectionModel,
} from "./StudioOptionsBars";

import type { StudioDrawOptionsBarProps } from "./brush/StudioDrawOptionsBar";
import type { StudioSelectOptionsBarProps } from "./StudioSelectOptionsBar";

const capturedLazyProps = vi.hoisted(() => ({
  draw: null as StudioDrawOptionsBarProps | null,
  selection: null as StudioSelectOptionsBarProps | null,
}));
const viewportState = vi.hoisted(() => ({ mobile: false }));

vi.mock("@/src/hooks/use-media-query", () => ({
  useIsMobile: () => viewportState.mobile,
}));

vi.mock("./studio-page-lazy-ui", () => ({
  StudioDrawOptionsBar: (props: StudioDrawOptionsBarProps) => {
    capturedLazyProps.draw = props;
    return <div data-testid="lazy-draw-options" />;
  },
  StudioSelectOptionsBar: (props: StudioSelectOptionsBarProps) => {
    capturedLazyProps.selection = props;
    return <div data-testid="lazy-select-options" />;
  },
}));

const DRAW_MODEL: StudioOptionsBarsDrawModel = {
  visible: true,
  brushId: "gpen",
  activeCatalogBrushId: "hair-fiber",
  activeCatalogBrushName: "머리카락 결",
  brushCatalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  brushCatalogOpen: true,
  brushDefaultRestore: {
    sourceName: "머리카락 결",
    modifiedCount: 4,
    loading: false,
    available: true,
    undoAvailable: false,
  },
  brushOpacity: 0.72,
  brushSlots: [
    { brushId: "pen", strokeWidth: 8, brushOpacity: 0.9 },
    null,
  ],
  canvasFlipH: true,
  color: "#112233",
  dockInsets: { left: 244, right: 308 },
  drawMode: "shape",
  drawShape: "ellipse",
  eyedropperActive: true,
  favoriteBrushIds: ["gpen", "marker"],
  opacityLocked: true,
  postCorrection: 7,
  pressureCurveId: "firm",
  quickShapeActive: true,
  recentBrushIds: ["marker", "gpen"],
  secondaryColor: "#aabbcc",
  shapeFill: true,
  sizeLocked: false,
  stabilizer: 6,
  stabilizerMode: "precision",
  stampTuning: { flow: 0.65, hardness: 0.8, minSize: 0.2 },
  strokeWidth: 18,
  symmetryType: "radial",
  livingInk: {
    supported: true,
    physicalModeEnabled: true,
    state: "ready",
    mode: "ink",
    scope: "all",
    selectionAvailable: false,
    busy: false,
    fixAvailable: false,
    material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
    materialLocked: true,
  },
};

const SELECTION_MODEL: StudioOptionsBarsSelectionModel = {
  visible: false,
  count: 0,
  label: null,
  locked: false,
  canToggleLock: false,
  textEditLabel: null,
  canFitBubble: false,
};

function createHandlers(): StudioOptionsBarsHandlers {
  return {
    assignBrushSlot: vi.fn(),
    cycleStabilizer: vi.fn(),
    deleteSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    editSelectionText: vi.fn(),
    fitSelectionBubble: vi.fn(),
    applyLivingInkClear: vi.fn(),
    applyLivingInkFix: vi.fn(),
    openBrushStudio: vi.fn(),
    recallBrushSlot: vi.fn(),
    reorderSelection: vi.fn(),
    restoreBrushDefaults: vi.fn(),
    selectBrushId: vi.fn(),
    setBrushOpacity: vi.fn(),
    setColor: vi.fn(),
    setLivingInkMode: vi.fn(),
    setLivingInkPhysicalModeEnabled: vi.fn(),
    setLivingInkScope: vi.fn(),
    setDrawMode: vi.fn(),
    setDrawShape: vi.fn(),
    setPostCorrection: vi.fn(),
    setPressureCurvePreset: vi.fn(),
    setSecondaryColor: vi.fn(),
    setShapeFill: vi.fn(),
    setStabilizer: vi.fn(),
    setStabilizerMode: vi.fn(),
    setStampTuning: vi.fn(),
    setStrokeWidth: vi.fn(),
    setSymmetryType: vi.fn(),
    swapColors: vi.fn(),
    toggleBrushCatalog: vi.fn(),
    toggleCanvasFlip: vi.fn(),
    toggleFavoriteBrush: vi.fn(),
    toggleEyedropper: vi.fn(),
    toggleOpacityLock: vi.fn(),
    toggleQuickShape: vi.fn(),
    toggleSelectedLock: vi.fn(),
    toggleSizeLock: vi.fn(),
    patchLivingInkMaterial: vi.fn(),
  };
}

function createProps({
  draw,
  selection,
  stableHandlers,
}: {
  draw?: Partial<StudioOptionsBarsDrawModel>;
  selection?: Partial<StudioOptionsBarsSelectionModel>;
  stableHandlers?: StudioOptionsBarsHandlers;
} = {}): StudioOptionsBarsProps {
  return {
    draw: { ...DRAW_MODEL, ...draw },
    selection: { ...SELECTION_MODEL, ...selection },
    stableHandlers: stableHandlers ?? createHandlers(),
  };
}

afterEach(() => {
  cleanup();
  capturedLazyProps.draw = null;
  capturedLazyProps.selection = null;
  viewportState.mobile = false;
  vi.clearAllMocks();
});

describe("StudioOptionsBars", () => {
  it("renders only the visible contextual lazy surface", () => {
    const view = render(<StudioOptionsBars {...createProps()} />);

    expect(screen.getByTestId("lazy-draw-options")).toBeTruthy();
    expect(screen.queryByTestId("lazy-select-options")).toBeNull();

    view.rerender(
      <StudioOptionsBars
        {...createProps({
          draw: { visible: false },
          selection: {
            visible: true,
            count: 3,
            label: "3개 레이어",
            locked: true,
            canToggleLock: true,
          },
        })}
      />
    );

    expect(screen.queryByTestId("lazy-draw-options")).toBeNull();
    expect(screen.getByTestId("lazy-select-options")).toBeTruthy();

    view.rerender(
      <StudioOptionsBars
        {...createProps({
          draw: { visible: false },
          selection: { visible: false },
        })}
      />
    );
    expect(screen.queryByTestId("lazy-draw-options")).toBeNull();
    expect(screen.queryByTestId("lazy-select-options")).toBeNull();
  });

  it("remounts the draw surface when its tool context changes so local disclosures cannot linger", () => {
    const view = render(
      <StudioOptionsBars
        {...createProps({
          draw: { drawMode: "pen" },
        })}
      />
    );
    const penSurface = screen.getByTestId("lazy-draw-options");

    view.rerender(
      <StudioOptionsBars
        {...createProps({
          draw: { drawMode: "shape" },
        })}
      />
    );

    expect(screen.getByTestId("lazy-draw-options")).not.toBe(penSurface);
  });

  it("passes the caller-owned draw model to the commercial options bar", () => {
    render(<StudioOptionsBars {...createProps()} />);

    const drawProps = capturedLazyProps.draw;
    if (!drawProps) throw new Error("draw options props were not captured");

    expect(drawProps.docked).toBe(true);
    expect(drawProps.brushId).toBe("gpen");
    expect(drawProps.activeCatalogBrushId).toBe("hair-fiber");
    expect(drawProps.activeCatalogBrushName).toBe("머리카락 결");
    expect(drawProps.brushCatalogItems).toBe(STUDIO_ALL_BRUSH_CATALOG_ITEMS);
    expect(drawProps.brushCatalogOpen).toBe(true);
    expect(drawProps.brushDefaultRestore).toEqual({
      sourceName: "머리카락 결",
      modifiedCount: 4,
      loading: false,
      available: true,
      undoAvailable: false,
    });
    expect(drawProps.brushOpacity).toBe(0.72);
    expect(drawProps.brushSlots).toEqual(DRAW_MODEL.brushSlots);
    expect(drawProps.canvasFlipH).toBe(true);
    expect(drawProps.color).toBe("#112233");
    expect(drawProps.dockInsets).toEqual({ left: 244, right: 308 });
    expect(drawProps.drawMode).toBe("shape");
    expect(drawProps.eyedropperActive).toBe(true);
    expect(drawProps.shapeKind).toBe("ellipse");
    expect(drawProps.shapeFill).toBe(true);
    expect(drawProps.pressureCurveId).toBe("firm");
    expect(drawProps.stabilizerMode).toBe("precision");
    expect(drawProps.stampTuning).toEqual({
      flow: 0.65,
      hardness: 0.8,
      minSize: 0.2,
    });
    expect(drawProps.favoriteBrushIds).toEqual(["gpen", "marker"]);
    expect(drawProps.recentBrushIds).toEqual(["marker", "gpen"]);
    expect(drawProps.sizeLocked).toBe(false);
    expect(drawProps.opacityLocked).toBe(true);
    expect(drawProps.livingInk).toMatchObject({
      supported: true,
      state: "ready",
      mode: "ink",
      fixAvailable: false,
      materialLocked: true,
    });
  });

  it("does not duplicate hidden desktop Living Ink controls on a mobile surface", () => {
    viewportState.mobile = true;
    render(
      <StudioOptionsBars
        {...createProps({ draw: { drawMode: "pen" } })}
      />,
    );

    const drawProps = capturedLazyProps.draw;
    if (!drawProps) throw new Error("draw options props were not captured");
    expect(drawProps.livingInk).toBeUndefined();
  });

  it("delegates draw interactions through the semantic stable handler contract", () => {
    const stableHandlers = createHandlers();
    render(<StudioOptionsBars {...createProps({ stableHandlers })} />);

    const drawProps = capturedLazyProps.draw;
    if (!drawProps) throw new Error("draw options props were not captured");
    const trigger = document.createElement("button");

    drawProps.onToggleBrushCatalog?.(trigger);
    drawProps.onSelectBrush({ id: "marker" } as Parameters<typeof drawProps.onSelectBrush>[0]);
    drawProps.onRestoreBrushDefaults?.();
    drawProps.onStrokeWidthChange(22);
    drawProps.onOpacityChange(0.55);
    drawProps.onStabilizerChange(4);
    drawProps.onPressureCurveChange?.("soft");
    drawProps.onSetDrawMode?.("eraser");
    drawProps.onShapeKindChange?.("rect");
    drawProps.onRecallBrushSlot?.(2);
    drawProps.onAssignBrushSlot?.(4);
    drawProps.onToggleFavoriteBrush?.("marker");
    drawProps.onToggleQuickShape();
    drawProps.onSwapColors?.();
    drawProps.onCycleStabilizer?.();
    drawProps.onToggleSizeLock?.();
    drawProps.onToggleOpacityLock?.();
    drawProps.onToggleEyedropper?.();
    drawProps.livingInk?.onModeChange("water");
    drawProps.livingInk?.onScopeChange("selection");
    drawProps.livingInk?.onClear();
    drawProps.livingInk?.onFix();
    drawProps.livingInk?.onMaterialChange({ bleed: 0.8 });

    expect(stableHandlers.toggleBrushCatalog).toHaveBeenCalledWith(trigger);
    expect(stableHandlers.selectBrushId).toHaveBeenCalledWith("marker");
    expect(stableHandlers.restoreBrushDefaults).toHaveBeenCalledTimes(1);
    expect(stableHandlers.setStrokeWidth).toHaveBeenCalledWith(22);
    expect(stableHandlers.setBrushOpacity).toHaveBeenCalledWith(0.55);
    expect(stableHandlers.setStabilizer).toHaveBeenCalledWith(4);
    expect(stableHandlers.setPressureCurvePreset).toHaveBeenCalledWith("soft");
    expect(stableHandlers.setDrawMode).toHaveBeenCalledWith("eraser");
    expect(stableHandlers.setDrawShape).toHaveBeenCalledWith("rect");
    expect(stableHandlers.recallBrushSlot).toHaveBeenCalledWith(2);
    expect(stableHandlers.assignBrushSlot).toHaveBeenCalledWith(4);
    expect(stableHandlers.toggleFavoriteBrush).toHaveBeenCalledWith("marker");
    expect(stableHandlers.toggleQuickShape).toHaveBeenCalledOnce();
    expect(stableHandlers.swapColors).toHaveBeenCalledOnce();
    expect(stableHandlers.cycleStabilizer).toHaveBeenCalledOnce();
    expect(stableHandlers.toggleSizeLock).toHaveBeenCalledOnce();
    expect(stableHandlers.toggleOpacityLock).toHaveBeenCalledOnce();
    expect(stableHandlers.toggleEyedropper).toHaveBeenCalledOnce();
    expect(stableHandlers.setLivingInkMode).toHaveBeenCalledWith("water");
    expect(stableHandlers.setLivingInkScope).toHaveBeenCalledWith("selection");
    expect(stableHandlers.applyLivingInkClear).toHaveBeenCalledOnce();
    expect(stableHandlers.applyLivingInkFix).toHaveBeenCalledOnce();
    expect(stableHandlers.patchLivingInkMaterial).toHaveBeenCalledWith({ bleed: 0.8 });
  });

  it("passes selection state and delegates selection actions without leaking an element", () => {
    const stableHandlers = createHandlers();
    const view = render(
      <StudioOptionsBars
        {...createProps({
          draw: { visible: false },
          selection: {
            visible: true,
            count: 2,
            label: "대사 말풍선",
            locked: true,
            canToggleLock: true,
            textEditLabel: "대사 편집",
            canFitBubble: true,
          },
          stableHandlers,
        })}
      />
    );

    let selectionProps = capturedLazyProps.selection;
    if (!selectionProps) throw new Error("selection options props were not captured");
    expect(selectionProps.selectionCount).toBe(2);
    expect(selectionProps.selectionLabel).toBe("대사 말풍선");
    expect(selectionProps.locked).toBe(true);
    expect(selectionProps.textEditLabel).toBe("대사 편집");

    selectionProps.onDuplicate();
    selectionProps.onDelete();
    selectionProps.onBringFront();
    selectionProps.onSendBack();
    selectionProps.onToggleLock?.();
    selectionProps.onEditText?.();
    selectionProps.onFitBubble?.();

    expect(stableHandlers.duplicateSelection).toHaveBeenCalledOnce();
    expect(stableHandlers.deleteSelection).toHaveBeenCalledOnce();
    expect(stableHandlers.reorderSelection).toHaveBeenNthCalledWith(1, "front");
    expect(stableHandlers.reorderSelection).toHaveBeenNthCalledWith(2, "back");
    expect(stableHandlers.toggleSelectedLock).toHaveBeenCalledOnce();
    expect(stableHandlers.editSelectionText).toHaveBeenCalledOnce();
    expect(stableHandlers.fitSelectionBubble).toHaveBeenCalledOnce();

    view.rerender(
      <StudioOptionsBars
        {...createProps({
          draw: { visible: false },
          selection: {
            visible: true,
            count: 3,
            canToggleLock: false,
          },
          stableHandlers,
        })}
      />
    );
    selectionProps = capturedLazyProps.selection;
    if (!selectionProps) throw new Error("selection options props were not recaptured");
    expect(selectionProps.onToggleLock).toBeUndefined();
  });
});
