import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { STUDIO_GROUP_SELECTION_OVERLAY_NAME } from "./studio-selection-chrome-mirror";

const pageSource = readStudioCuttoonEditorSource();
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
// 2026-08-21 intentional: the Konva selection decorations (union-bounds ghost, label badge, resize
// proxy, Transformer, dashed boxes) moved verbatim out of StudioCanvasViewport.tsx into their own
// leaf module. The viewport still owns every input they read, so the split assertions below only
// follow the markup to its new file.
const selectionDecorationsSource = readFileSync(
  new URL("./canvas/StudioCanvasSelectionDecorations.tsx", import.meta.url),
  "utf8",
);

function functionBody(name: string, nextName: string): string {
  const start = pageSource.indexOf(`function ${name}`);
  const end = pageSource.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return pageSource.slice(start, end);
}

describe("Studio PPT-style group convenience boundary", () => {
  it("does not orphan a parent group when one grouped child receives Cmd/Ctrl+G", () => {
    const source = functionBody("addLayerGroup", "groupSelectedElements");

    expect(source).toContain("seed?.groupId");
    expect(source).toContain("selectionShapeForIds([seedElId])");
    expect(source).toContain("return false");
    expect(source).toContain("return true");
  });

  it("keeps the newly created group selected for the next operation", () => {
    const source = functionBody("groupSelectedElements", "completeSelectedGroupId");
    expect(source).toContain("const memberIds = [...marqueeIdsRef.current]");
    expect(source).toContain("const alreadyGrouped");
    expect(source).toContain("먼저 그룹을 해제한 뒤 다시 그룹화");
    expect(source).toContain("applyGroupSelectionState");
    expect(source).toContain("return true");
  });

  it("mirrors click selection through refs before the next native event arrives", () => {
    const selectionAdapter = functionBody(
      "applyGroupSelectionState",
      "selectElementFromCanvas",
    );
    const clickHandler = functionBody(
      "selectElementFromCanvas",
      "openFeatureTutorial",
    );

    expect(selectionAdapter).toContain("selectedIdRef.current = next.selectedId");
    expect(selectionAdapter).toContain("marqueeIdsRef.current = next.marqueeIds");
    expect(clickHandler).toContain("selectedId: selectedIdRef.current");
    expect(clickHandler).toContain("marqueeIds: marqueeIdsRef.current");
  });

  it("publishes select-all through the synchronous selection authority before a rapid group command", () => {
    const selectAllSource = functionBody("selectAllElements", "selectAllForEdit");

    expect(selectAllSource).toContain("applyGroupSelectionState({");
    // The shape comes from the canonical helper rather than a hand-written pair: a one-element
    // page must collapse to `selectedId`, or the selection satisfies neither the multi-selection
    // proxy (`marqueeIds.length > 1`) nor single-stroke free transform (`length === 0`) and
    // loses its resize/rotate handles entirely.
    expect(selectAllSource).toContain("...selectionShapeForIds(ids)");
    expect(selectAllSource).not.toContain("marqueeIds: ids");
    expect(selectAllSource).toContain("activeGroupId: null");
    expect(selectAllSource).not.toContain("setMarqueeIds(");
  });

  it("keeps a complete child selection in internal-edit mode", () => {
    const pageGroupSource = functionBody(
      "completeSelectedGroupId",
      "ungroupSelectedElements",
    );

    expect(pageGroupSource).toContain(
      "activeGroupIdRef.current === groupId",
    );
    expect(viewportSource).toContain("activeGroupId === group.id");
  });

  it("recognizes a one-member group through the canonical single-selection shape", () => {
    const selectionSource = functionBody(
      "currentCanvasSelectionIds",
      "clearCanvasSelection",
    );
    const clearSelectionSource = functionBody(
      "clearCanvasSelection",
      "selectElementFromCanvas",
    );
    const completeGroupSource = functionBody(
      "completeSelectedGroupId",
      "ungroupSelectedElements",
    );
    const ungroupSource = functionBody(
      "ungroupSelectedElements",
      "enterCompleteSelectedGroup",
    );
    const lockSource = functionBody(
      "toggleSelectedElementsLocked",
      "reorderSelectedElements",
    );

    expect(selectionSource).toContain(
      "return selectedIdRef.current ? [selectedIdRef.current] : []",
    );
    expect(completeGroupSource).toContain(
      "const currentSelectionIds = currentCanvasSelectionIds()",
    );
    expect(completeGroupSource).not.toContain(
      "currentMarqueeIds.length < 2",
    );
    expect(completeGroupSource).toContain(
      "groups.some((group) => group.id === groupId)",
    );
    expect(completeGroupSource).toContain(
      "selectedElements.length === selectedIds.size",
    );
    expect(ungroupSource).toContain(
      "selectionShapeForIds(selectedIds.filter",
    );
    expect(lockSource).toContain(
      "const currentSelectionIds = currentCanvasSelectionIds()",
    );
    expect(lockSource).toContain("patchLayerItems(currentSelectionIds");
    expect(viewportSource).toContain(
      "selectionCount={canvasSelectionEls.length}",
    );
    expect(clearSelectionSource).toContain("applyGroupSelectionState");
    expect(clearSelectionSource).toContain("selectedId: null");
    expect(clearSelectionSource).toContain("marqueeIds: []");
    expect(clearSelectionSource).toContain("activeGroupId: null");
    expect(viewportSource).toContain(
      "onClearSelection={clearCanvasSelection}",
    );
  });

  it("keeps selection after ungroup and clears both group and member locks on unlock", () => {
    const ungroupSource = functionBody(
      "ungroupSelectedElements",
      "toggleSelectedElementsLocked",
    );
    const lockSource = functionBody(
      "toggleSelectedElementsLocked",
      "reorderSelectedElements",
    );

    expect(ungroupSource).toContain("ungroupItems(elements, groupId)");
    expect(ungroupSource).toContain("applyGroupSelectionState");
    expect(ungroupSource).toContain("return false");
    expect(ungroupSource).toContain("return true");
    expect(lockSource).toContain("isEffectivelyLocked(element, groups)");
    expect(lockSource).toContain("group.id === groupId");
    expect(lockSource).toContain("locked: false");
  });

  it("routes multi-selection ordering through the group-safe layer planner", () => {
    const source = functionBody("reorderSelectedElements", "deleteLayerGroup");

    expect(source).toContain(
      "const currentSelectionIds = currentCanvasSelectionIds()",
    );
    expect(source).toContain(
      "reorderLayerSelection(elements, currentSelectionIds, direction)",
    );
    expect(source).toContain("commit(next)");
  });

  it("keeps single-selection delete and duplicate on their canonical selection paths", () => {
    const removeSource = functionBody("removeSelected", "mergeSelectedBubbles");
    const clipboardSource = functionBody(
      "captureSelectedStudioClipboard",
      "persistStudioClipboardPayload",
    );
    const duplicateSource = functionBody("duplicateSelected", "nudgeSelected");

    expect(removeSource).toContain(
      "if (selectedId) deleteLayerElements([selectedId])",
    );
    expect(clipboardSource).toContain(
      "collectCopyElements(elements, selectedId, marqueeIds)",
    );
    expect(duplicateSource).toContain("captureSelectedStudioClipboard()");
  });

  it("aligns a complete group as one union instead of rearranging its children", () => {
    const source = functionBody("alignStudioSelection", "reorder");
    expect(source).toContain("completeSelectedGroupId()");
    expect(source).toContain("planAtomicSelectionTranslation");
    expect(source).toContain("그룹 내부 분배");
    expect(source).toContain("const topLevelGroupIds");
    expect(source).toContain("여러 그룹이 포함된 선택");
  });

  it("clears stale active-group state when a group is removed or becomes empty", () => {
    const deleteGroupSource = functionBody(
      "deleteLayerGroup",
      "assignElementToGroup",
    );
    const deleteElementsSource = functionBody(
      "deleteLayerElements",
      "removeSelected",
    );

    expect(deleteGroupSource).toContain(
      "activeGroupIdRef.current === groupId",
    );
    expect(deleteGroupSource).toContain("setActiveGroupId(null)");
    expect(deleteElementsSource).toContain(
      "groupsEmptiedByRemoval.has(activeGroupIdRef.current)",
    );
    expect(deleteElementsSource).toContain("setActiveGroupId(null)");
  });

  it("duplicates through the canonical clipboard planner so group IDs and tracks are remapped", () => {
    const source = functionBody("duplicateSelected", "nudgeSelected");
    expect(source).toContain("captureSelectedStudioClipboard()");
    expect(source).toContain(
      'applyStudioClipboardPayload(captured.payload, "cascade", "복제")',
    );
    expect(source).not.toContain("insertLayerCopiesAdjacent");
  });

  it("commits mixed draw and coordinate groups through one atomic translation plan", () => {
    const start = pageSource.indexOf("function onStageDragEnd");
    const endRaw = pageSource.indexOf("\nfunction ", start + 1);
    const end = endRaw === -1 ? pageSource.length : endRaw;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const source = pageSource.slice(start, end);
    expect(source).toContain("planAtomicSelectionTranslation");
    expect(source).toContain("isEffectivelyLocked(element, groups)");
    expect(source.match(/commit\(next\)/g)).toHaveLength(1);
  });

  it("settles committed draw wrapper previews once the new document elements reach layout", () => {
    const dragEndStart = pageSource.indexOf("function onStageDragEnd");
    const dragEndEnd = pageSource.indexOf(
      "\n  return {\n    onStageDown",
      dragEndStart,
    );
    const dragEndSource = pageSource.slice(dragEndStart, dragEndEnd);
    const failedRestoreSource = functionBody(
      "restoreGroupDragPreview",
      "liveCanvasElementRect",
    );
    const settleStart = pageSource.indexOf(
      "useLayoutEffect(() => {\n    const pending = pendingCommittedGroupDrawResetRef.current",
    );
    const settleEnd = pageSource.indexOf("const drawingRef", settleStart);
    expect(settleStart).toBeGreaterThanOrEqual(0);
    expect(settleEnd).toBeGreaterThan(settleStart);
    const settleSource = pageSource.slice(settleStart, settleEnd);

    expect(dragEndSource).toContain(
      "committed = changed && commit(next)",
    );
    expect(dragEndSource).toContain(
      "pendingCommittedGroupDrawResetRef.current = {",
    );
    expect(dragEndSource).toContain(
      '(id) => elementById.get(id)?.type === "draw"',
    );
    expect(dragEndSource).toContain("sourceElements: elements");
    expect(dragEndSource).toContain("pageId: currentPageIdRef.current");
    expect(dragEndSource).toContain(
      "masterEditMode: masterEditModeRef.current",
    );
    expect(
      dragEndSource.indexOf("pendingCommittedGroupDrawResetRef.current = {"),
    ).toBeGreaterThan(
      dragEndSource.indexOf("committed = changed && commit(next)"),
    );
    expect(dragEndSource).toContain(
      "if (!committed && dnode && (dx !== 0 || dy !== 0))",
    );
    expect(dragEndSource).toContain("restoreGroupDragPreview(g, dx, dy)");
    expect(dragEndSource).not.toContain(
      "resizeProxy.x(resizeProxy.x() - dx)",
    );
    expect(failedRestoreSource).toContain(
      "resizeProxy.x(resizeProxy.x() - deltaX)",
    );
    expect(failedRestoreSource).toContain(
      "resizeProxy.y(resizeProxy.y() - deltaY)",
    );

    expect(settleSource).toContain("activePage.id !== pending.pageId");
    expect(settleSource).toContain(
      "masterEditMode !== pending.masterEditMode",
    );
    expect(settleSource).toContain(
      "if (elements === pending.sourceElements) return",
    );
    expect(settleSource).toContain(
      'currentById.get(id)?.type !== "draw"',
    );
    expect(settleSource).toContain("node.position({ x: 0, y: 0 })");
    expect(settleSource).toContain(
      "pendingCommittedGroupDrawResetRef.current = null",
    );
    expect(settleSource).toContain(
      "[activePage.id, elements, masterEditMode]",
    );
    expect(settleSource).toContain(
      "for (const layer of dirtyLayers) layer.batchDraw()",
    );
    const resetPosition = settleSource.indexOf(
      "node.position({ x: 0, y: 0 })",
    );
    const consumePosition = settleSource.lastIndexOf(
      "pendingCommittedGroupDrawResetRef.current = null",
      resetPosition,
    );
    expect(consumePosition).toBeGreaterThanOrEqual(0);
    expect(consumePosition).toBeLessThan(resetPosition);
  });

  it("consumes the dragged anchor child patch so one gesture cannot create two undo snapshots", () => {
    const source = functionBody("patchEl", "applyMagicResizePreset");
    expect(source).toContain("activeGroupDrag?.id === id");
    expect(source).toContain('key === "x" || key === "y"');
    expect(source).toContain("return true");
  });

  it("keeps authored draw paint non-listening but adds a select-only hit and drag wrapper", () => {
    expect(viewportSource).toContain("<StudioDrawNode");
    expect(viewportSource).toContain("paperSurface={paperSurfaceForPreview}");
    expect(viewportSource).toContain(
      '{tool === "select" && !isNonInteractiveRender ? (',
    );
    expect(viewportSource).toContain("getSymmetricPoints(liveEl.points, liveEl.symmetry)");
    expect(viewportSource).toContain("studioBrushAliasEffectiveDiameter(");
    expect(viewportSource).toContain("if (points.length === 2)");
    expect(viewportSource).toContain("strokeWidth={hitStrokeWidth}");
    expect(viewportSource).toContain(
      "(liveEl.fill || liveEl.gradient || liveEl.pattern)",
    );
    expect(viewportSource).toContain("onMouseDown={onSelect}");
    expect(viewportSource).toContain("draggable={draggable}");
    expect(viewportSource).toContain("isGroupDragMember ||");
    expect(viewportSource).toContain("isCanvasGroupDragActive(el.id)");
  });

  it("suppresses image drag-end and auto-fit commits during a runtime group drag", () => {
    expect(viewportSource).toContain(
      "!isCanvasGroupDragActive(el.id) &&",
    );
    expect(viewportSource).toContain(
      "if (isCanvasGroupDragActive(el.id)) return;",
    );
  });

  it("renders one labelled union boundary for mixed groups and ordinary multi-selection", () => {
    expect(viewportSource).toContain("multiSelectionBounds");
    expect(viewportSource).toContain("marqueeIds.length > 1");
    expect(selectionDecorationsSource).toContain('studioSelectionRole="group-bounds"');
    expect(selectionDecorationsSource).toContain(
      "studioGroupLocked={completeSelectionGroup?.locked === true}",
    );
    expect(selectionDecorationsSource).toContain('name="studio-group-selection-lock-marker"');
    // The overlay's name is now a shared constant rather than a literal here: the live transform
    // preview has to park this exact group, so the decorations and the parking code must never
    // drift apart. Both halves are pinned -- the markup binds the constant, and the constant still
    // carries the name the scene-graph assertions and perf probes look up.
    expect(selectionDecorationsSource).toContain(
      "name={STUDIO_GROUP_SELECTION_OVERLAY_NAME}",
    );
    expect(STUDIO_GROUP_SELECTION_OVERLAY_NAME).toBe("studio-group-selection-overlay");
    expect(selectionDecorationsSource).toContain('name="studio-group-selection-badge"');
    expect(selectionDecorationsSource).toContain('? "잠금"');
    expect(selectionDecorationsSource).toContain('? "일부 잠금"');
    expect(selectionDecorationsSource).toContain(
      'stroke={constrained ? "#b45309" : "#c2410c"}',
    );
    expect(selectionDecorationsSource).toContain("const badgeX = Math.min(");
    expect(selectionDecorationsSource).toContain("preferredBadgeY >= badgeInset");
    expect(viewportSource).toContain(
      'element.type === "draw"',
    );
    expect(viewportSource).toContain("liveNodeDisplayBounds(");
    // Routes whose commit cannot reproduce an affine preview are marked at render time, where the
    // element is in hand, and refused by the preview. The verdict itself lives in one helper
    // (studio-live-transform-preview-eligibility) rather than inline here, so the list stays in a
    // single place as new render paths are found; this only pins that the wrapper carries it.
    expect(viewportSource).toContain("studioLiveTransformPreviewBlocked={");
    expect(viewportSource).toContain("studioLiveTransformPreviewBlockedForElement(el, hitClosedShape)");
  });

  it("claims and releases the complete group lease around one stage commit", () => {
    const beginSource = functionBody("canvasInteractionUnitIds", "startMacroRecord");
    const dragEndStart = pageSource.indexOf("function onStageDragEnd");
    const dragEndEnd = pageSource.indexOf("\n  return {\n    onStageDown", dragEndStart);
    const dragEndSource = pageSource.slice(dragEndStart, dragEndEnd);

    expect(beginSource).toContain("canvasInteractionUnitIds(elementId)");
    expect(beginSource).toContain("beginLiveResourceEdit(unitIds)");
    expect(beginSource).toContain("if (groupDragRef.current) return");
    expect(dragEndSource).toContain("selectedIds: g.selectedIds");
    expect(dragEndSource).toContain("finally");
    expect(dragEndSource).toContain(
      'selectionOverlay.position({ x: 0, y: 0 })',
    );
    expect(dragEndSource).toContain("endLiveResourceEdit()");
  });

  it("uses the live group union for guides and keeps partial transforms fail-closed", () => {
    const transformerStart = pageSource.indexOf("// 트랜스포머를 선택 노드");
    const transformerEnd = pageSource.indexOf(
      "function publishStudioCrdtSceneTransition",
      transformerStart,
    );
    const transformerSource = pageSource.slice(transformerStart, transformerEnd);
    const dragStart = pageSource.indexOf("function onStageDragMove");
    const dragEnd = pageSource.indexOf("function onStageDragEnd", dragStart);
    const dragSource = pageSource.slice(dragStart, dragEnd);

    expect(transformerSource).toContain("tr.nodes([])");
    expect(transformerSource).not.toContain("element.type !== \"draw\"");
    expect(dragSource).toContain("liveSelectionRect()");
    expect(dragSource).toContain("liveCanvasElementRect");
    expect(dragSource).toContain("liveMovingSelectionIds");
    expect(dragSource).toContain("translateGroupPreview(");
  });

  it("keeps context-menu, marquee, desktop double-click and mobile double-tap group-aware", () => {
    expect(viewportSource).toContain("selectElementFromCanvas(elId)");
    expect(viewportSource).toContain("onDblClick={enterGroupFromCanvasGesture}");
    expect(viewportSource).toContain("onDblTap={enterGroupFromCanvasGesture}");
    expect(pageSource).toContain("expandSelectionIdsToGroupUnits(");
    expect(pageSource).toContain("selectionShapeForIds(ids)");
    expect(pageSource).not.toContain("clickCount >= 2");
  });

  it("routes keyboard group commands through complete-selection-safe handlers", () => {
    const shortcutStart = pageSource.indexOf(
      '// Figma/Illustrator/ClipStudio: ⌘G = 그룹 생성',
    );
    const shortcutEnd = pageSource.indexOf(
      'e.key.startsWith("Arrow")',
      shortcutStart,
    );
    const shortcutSource = pageSource.slice(shortcutStart, shortcutEnd);
    const enterSource = functionBody(
      "enterCompleteSelectedGroup",
      "toggleSelectedElementsLocked",
    );

    expect(shortcutSource).toContain("ungroupSelectedElements()");
    expect(shortcutSource).not.toContain("deleteLayerGroup(targetEl.groupId)");
    expect(shortcutSource).not.toContain("그룹 해제 완료");
    expect(shortcutSource).not.toContain("요소 ${marqueeIds.length}개 그룹화");
    expect(enterSource).toContain("completeSelectedGroupId()");
    expect(enterSource).toContain("planGroupEnter");
    expect(pageSource).toContain("if (enterCompleteSelectedGroup()) e.preventDefault()");
    expect(pageSource).toContain("그룹 내부 편집 종료 · 그룹 전체 선택");
  });

  it("keeps Layer Navigator group commands on the canonical Page handlers", () => {
    const actionSource = functionBody(
      "handleLayerNavigatorAction",
      "latestStudioPagesSnapshot",
    );

    expect(actionSource).toContain('case "group-selection"');
    expect(actionSource).toContain("groupSelectedElements()");
    expect(actionSource).toContain('case "ungroup-selection"');
    expect(actionSource).toContain("ungroupSelectedElements()");
    expect(actionSource).toContain("element?.groupId !== undefined");
    expect(actionSource).toContain("먼저 그룹을 해제한 뒤 새 그룹");
    expect(actionSource).toContain("selectionShapeForIds(seedIds)");
  });

  it("treats Layer Navigator selection as a top-level group selection", () => {
    const source = functionBody("selectLayersFromNavigator", "patchLayerItems");
    expect(source).toContain("applyGroupSelectionState");
    expect(source).toContain("selectionShapeForIds(validIds)");
    expect(source).toContain("activeGroupId: null");
  });
});
