import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const pageUrl = new URL("../StudioCuttoonEditorHost.tsx", import.meta.url);
const inspectorUrl = new URL("../StudioInspectorAsideShell.tsx", import.meta.url);
const pageSource = readFileSync(pageUrl, "utf8");
const inspectorSource = readFileSync(inspectorUrl, "utf8");
const pageFile = ts.createSourceFile(
  pageUrl.pathname,
  pageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function nestedFunction(name: string): ts.FunctionDeclaration {
  let match: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(pageFile);
  if (!match) throw new Error(`Missing nested function ${name}`);
  return match;
}

function callsIn(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  function visit(current: ts.Node): void {
    if (ts.isCallExpression(current)) calls.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return calls;
}

function calledIdentifier(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : null;
}

describe("Studio canvas and layer navigator selection boundary", () => {
  it("projects canvas single/multi selection into the navigator without inventing a second owner", () => {
    expect(inspectorSource).toContain(
      "selectedIds={marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : []}",
    );
    expect(inspectorSource).toContain("onSelectionChange={selectLayersFromNavigator}");
  });

  it("maps navigator 0/1/2+ selection back to the authoritative canvas selection shape", () => {
    const selectionAdapter = nestedFunction("selectLayersFromNavigator");
    const calls = callsIn(selectionAdapter);
    const validIdsDeclaration = selectionAdapter.body
      ?.statements.flatMap((statement) =>
        ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
      )
      .find(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === "validIds",
      );
    expect(validIdsDeclaration?.initializer?.getText(pageFile)).toMatch(
      /new Set\(ids\).*filter\(\(id\) => elementById\.has\(id\)\).*slice\(0, 500\)/u,
    );

    const selectToolCall = calls.find(
      (call) =>
        calledIdentifier(call) === "setTool"
        && ts.isStringLiteral(call.arguments[0])
        && call.arguments[0].text === "select",
    );
    expect(selectToolCall).toBeDefined();

    const applySelectionCall = calls.find(
      (call) => calledIdentifier(call) === "applyGroupSelectionState",
    );
    expect(applySelectionCall).toBeDefined();
    expect(validIdsDeclaration!.getStart(pageFile)).toBeLessThan(
      applySelectionCall!.getStart(pageFile),
    );

    const selectionState = applySelectionCall?.arguments[0];
    expect(selectionState && ts.isObjectLiteralExpression(selectionState)).toBe(true);
    if (!selectionState || !ts.isObjectLiteralExpression(selectionState)) return;

    const canonicalShape = selectionState.properties.find(ts.isSpreadAssignment);
    expect(
      canonicalShape
      && ts.isCallExpression(canonicalShape.expression)
      && calledIdentifier(canonicalShape.expression) === "selectionShapeForIds"
      && ts.isIdentifier(canonicalShape.expression.arguments[0])
      && canonicalShape.expression.arguments[0].text === "validIds",
    ).toBe(true);

    const activeGroupReset = selectionState.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property)
        && ts.isIdentifier(property.name)
        && property.name.text === "activeGroupId",
    );
    expect(activeGroupReset && activeGroupReset.initializer.kind === ts.SyntaxKind.NullKeyword).toBe(
      true,
    );

    const callNames = calls.map(calledIdentifier);
    expect(callNames).not.toContain("setSelectedId");
    expect(callNames).not.toContain("setMarqueeIds");
  });
});
