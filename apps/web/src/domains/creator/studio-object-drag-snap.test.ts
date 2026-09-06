import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  STUDIO_OBJECT_DRAG_SNAP_TOLERANCE_PX,
  snapStudioObjectDragPosition,
} from "./studio-object-drag-snap";

const studioPageSource = readStudioCuttoonEditorSource();

describe("studio object drag snap", () => {
  it("keeps free movement continuous away from a grid line", () => {
    expect(snapStudioObjectDragPosition({
      position: { x: 13, y: 22 },
      enabled: true,
      gridSize: 40,
      viewportScale: 1,
    })).toEqual({ x: 13, y: 22 });
  });

  it("magnetically snaps each axis only inside the screen-space tolerance", () => {
    expect(snapStudioObjectDragPosition({
      position: { x: 35, y: 48 },
      enabled: true,
      gridSize: 40,
      viewportScale: 1,
    })).toEqual({ x: 40, y: 48 });
    expect(STUDIO_OBJECT_DRAG_SNAP_TOLERANCE_PX).toBe(6);
  });

  it("keeps the magnetic target readable across zoom levels", () => {
    expect(snapStudioObjectDragPosition({
      position: { x: 30, y: 30 },
      enabled: true,
      gridSize: 40,
      viewportScale: 0.5,
    })).toEqual({ x: 40, y: 40 });
    expect(snapStudioObjectDragPosition({
      position: { x: 36, y: 36 },
      enabled: true,
      gridSize: 40,
      viewportScale: 2,
    })).toEqual({ x: 36, y: 36 });
  });

  it("bypasses snapping when disabled or geometry is invalid", () => {
    const position = { x: 37, y: 42 };
    expect(snapStudioObjectDragPosition({
      position,
      enabled: false,
      gridSize: 40,
      viewportScale: 1,
    })).toBe(position);
    expect(snapStudioObjectDragPosition({
      position,
      enabled: true,
      gridSize: 0,
      viewportScale: 1,
    })).toBe(position);
  });

  it("keeps Stage drag-move as the single snap authority", () => {
    const dragMoveStart = studioPageSource.indexOf("function onStageDragMove");
    const dragEndStart = studioPageSource.indexOf("function onStageDragEnd", dragMoveStart);
    const dragMoveSource = studioPageSource.slice(dragMoveStart, dragEndStart);

    expect(studioPageSource).toContain(
      "const snapBoundFunc = (pos: { x: number; y: number }) => pos;",
    );
    expect(dragMoveSource).toContain("const gridAnchor = snapStudioObjectDragPosition({");
    expect(dragMoveSource).toContain("position: { x: box.x, y: box.y }");
    expect(dragMoveSource).toContain("node instanceof KonvaRuntime.Transformer");
    expect(dragMoveSource).toContain("if (!draggedId) return;");
    expect(studioPageSource).toContain("node.getClientRect({ relativeTo: nodeLayer })");
    expect(dragMoveSource).not.toContain("for (let x = gridSize;");
    expect(dragMoveSource).not.toContain("for (let y = gridSize;");
  });
});
