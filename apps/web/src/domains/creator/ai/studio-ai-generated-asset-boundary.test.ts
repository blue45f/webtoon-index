import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";

const fileUrl = new URL("../StudioCuttoonEditorHost.tsx", import.meta.url);
// The scenario image executors moved verbatim into the ctx-parameterized factory module.
const scenarioModuleUrl = new URL("./studio-scenario-image-generation.ts", import.meta.url);
const source = readFileSync(fileUrl, "utf8");
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const file = ts.createSourceFile(
  fileUrl.pathname,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const scenarioModuleFile = ts.createSourceFile(
  scenarioModuleUrl.pathname,
  readFileSync(scenarioModuleUrl, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function functionSource(name: string): string {
  let match: ts.FunctionDeclaration | null = null;
  let matchFile: ts.SourceFile = file;
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!match) {
    matchFile = scenarioModuleFile;
    visit(scenarioModuleFile);
  }
  if (!match) throw new Error(`Missing function ${name}`);
  return (match as ts.FunctionDeclaration).getText(matchFile);
}

function expectInOrder(value: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = value.indexOf(fragment, cursor + 1);
    expect(next, `Expected ${JSON.stringify(fragment)} after index ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function expectProvenanceBeforeFirstAwait(name: string): void {
  const value = functionSource(name);
  const captureIndex = value.indexOf("captureStudioAiGeneratedAssetProvenance");
  const firstAwaitIndex = value.indexOf("await ");
  expect(captureIndex, `${name} must capture request provenance`).toBeGreaterThanOrEqual(0);
  expect(firstAwaitIndex, `${name} must perform an asynchronous image request`).toBeGreaterThanOrEqual(0);
  expect(
    captureIndex,
    `${name} must capture provenance before its first await`,
  ).toBeLessThan(firstAwaitIndex);
}

describe("Studio AI generated asset fail-closed boundary", () => {
  it("discards the pending notice action before closing and wires the named cancel handler", () => {
    expectInOrder(functionSource("cancelAiNotice"), [
      "aiNoticePendingActionRef.current = null",
      "setAiNoticeOpen(false)",
    ]);
    expect(viewportSource).toContain("<AiAssetNotice onCancel={cancelAiNotice}");
    expect(viewportSource).toContain("cancelAiNotice: () => void;");
    expect(viewportSource).not.toContain("setAiNoticeOpen={setAiNoticeOpen}");
  });

  it("captures request provenance before image awaits and never derives it after completion", () => {
    for (const functionName of [
      "executeGenerateAsset",
      "executeAiBackgroundGenerate",
      "executeAiColorize",
      "executeAiCharacterConsistency",
      "executeGenerateScenarioImages",
      "executeRegenerateScenarioImage",
    ] as const) {
      expectProvenanceBeforeFirstAwait(functionName);
    }
    expect(source).not.toContain("currentImageAiProvenance");
  });

  it("fails closed before recording or paying for unresolved scenario references", () => {
    for (const functionName of [
      "executeGenerateScenarioImages",
      "executeRegenerateScenarioImage",
    ]) {
      const value = functionSource(functionName);
      expectInOrder(value, [
        "scenarioImageReferenceResolution.missing.length > 0",
        "return;",
        "beginTrackedStudioAiOperation",
        "await generateImageWithRoleReferences",
      ]);
      expect(value).toContain(
        "scenarioImageReferenceResolution.trackingAssetIds"
      );
      expect(value).toContain(
        "trackedReferenceAssetIds.map((assetId) => ({ assetId }))"
      );
    }
  });

  it("captures the character reference identity, source, and size before the notice gate", () => {
    expectInOrder(functionSource("onGenerateAiCharacter"), [
      "const reference = {",
      "elementId: selected.id",
      "src: selected.src",
      "width: selected.width",
      "height: selected.height",
      "runWithAiNotice",
    ]);
    expect(functionSource("executeAiCharacterConsistency")).toContain(
      "references: [{ assetId: reference.elementId }]"
    );
  });

  it("keeps prompts and menus open when a generated result cannot be committed", () => {
    expectInOrder(functionSource("executeGenerateAsset"), [
      "finalizeStudioAiGeneratedAssetProvenance(requestProvenance",
      "model: generated.model",
      "if (!addRenderedImage",
      "return;",
      "setAssetPrompt(\"\")",
      "setMenu(null)",
    ]);
    expectInOrder(functionSource("executeAiBackgroundGenerate"), [
      "if (!insertAiBackgroundImage",
      "setAiBgError",
      "return;",
      "setMenu(null)",
    ]);
    expectInOrder(functionSource("executeAiCharacterConsistency"), [
      "if (!addRenderedImage",
      "setAiCharacterError",
      "return;",
      "setMenu(null)",
    ]);
    expect(functionSource("executeAiColorize")).toContain("if (!patchEl(elId");
    expect(functionSource("executeAiColorize")).toContain("setAiColorizeError");
  });

  it("requires a successful document commit before dismissing a scenario preview", () => {
    const applyScenario = functionSource("onApplyScenarioPreview");
    expect(applyScenario).toContain("if (!commitPages(populatedPages))");
    expect(applyScenario).toContain("if (!commit([...elements, ...newEls]");
    expectInOrder(applyScenario, [
      "if (!commit([...elements, ...newEls]",
      "return;",
      "setScenarioResult(null)",
      "setScenarioOpen(false)",
    ]);
  });
});
