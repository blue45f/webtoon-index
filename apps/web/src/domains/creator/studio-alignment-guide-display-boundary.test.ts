import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioCuttoonEditorSource();
const file = ts.createSourceFile(
  "StudioCuttoonEditor.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nestedFunction(name: string): string {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!match) throw new Error(`Missing nested function ${name}`);
  return (match as ts.FunctionDeclaration).getText(file);
}

describe("Studio alignment-guide display boundary", () => {
  it("keeps guide visibility independent from positional snapping", () => {
    const dragMove = nestedFunction("onStageDragMove");
    const snapDisabledBranch = dragMove.slice(dragMove.indexOf("if (!snapEnabled)"));

    expect(source).toContain("buildSmartGuideOverlayPreview");
    expect(snapDisabledBranch).toContain("showAlignmentGuides");
    expect(snapDisabledBranch).toContain("computeSmartSnap(");
    expect(snapDisabledBranch).toContain("buildSmartGuideOverlayPreview(");
    expect(snapDisabledBranch).toContain("applySmartGuides(");
    expect(snapDisabledBranch).toContain("applyGuides([], [])");
  });

  it("does not move the dragged node in the snap-off preview branch", () => {
    const dragMove = nestedFunction("onStageDragMove");
    const branchStart = dragMove.indexOf("if (!snapEnabled)");
    const branchEnd = dragMove.indexOf("const box =", branchStart);
    const snapDisabledBranch = dragMove.slice(branchStart, branchEnd);

    expect(snapDisabledBranch).not.toContain("node.x(");
    expect(snapDisabledBranch).not.toContain("node.y(");
    expect(snapDisabledBranch).not.toContain("commit(");
  });

  it("clears every transient guide when the drag finishes", () => {
    const dragEnd = nestedFunction("onStageDragEnd");

    expect(dragEnd).toContain("applyGuides([], [])");
    expect(dragEnd).toContain("applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY)");
  });
});
