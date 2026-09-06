import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const trackedServerTextCalls = new Set([
  "generateScenarioScenes",
  "generateStudioWriterRoomDraft",
  "suggestColorPalette",
  "suggestDialogueLines",
  "translateDialogueBatch",
]);

function trackedCallSources(): Map<string, string[]> {
  const fileUrl = new URL("../StudioCuttoonEditorHost.tsx", import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const calls = new Map<string, string[]>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (trackedServerTextCalls.has(name)) {
        calls.set(name, [...(calls.get(name) ?? []), node.getText(file)]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls;
}

describe("Studio AI paid request identity boundary", () => {
  it("binds every StudioPage tracked text request to its already-created operation ID", () => {
    const calls = trackedCallSources();

    for (const name of trackedServerTextCalls) {
      expect(calls.get(name), `${name} 호출 수`).toHaveLength(1);
      expect(calls.get(name)?.[0]).toContain(
        "studioTextAiTransportForOperation(textAiTransport, operationId)"
      );
    }
  });
});
