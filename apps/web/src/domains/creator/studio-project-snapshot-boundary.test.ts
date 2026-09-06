import { readFileSync } from "node:fs";


import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readFileSync(new URL("./studio-project-snapshot.ts", import.meta.url), "utf8");
const pageSource = readStudioPageCompositionSource();
const moduleSpecifiers = [
  ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
].map((match) => match[1]);
const sourceFile = ts.createSourceFile(
  "studio-project-snapshot.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const identifiers = new Set<string>();
function collectIdentifiers(node: ts.Node): void {
  if (ts.isIdentifier(node)) identifiers.add(node.text);
  ts.forEachChild(node, collectIdentifiers);
}
collectIdentifiers(sourceFile);

describe("Studio project snapshot boundary", () => {
  it("stays a pure one-way document module without UI, renderer, transport, or browser ownership", () => {
    expect(moduleSpecifiers.every((specifier) => specifier?.startsWith("./"))).toBe(true);
    expect(moduleSpecifiers).not.toContain("./StudioPage");
    expect(moduleSpecifiers.some((specifier) =>
      specifier === "react"
      || specifier === "react-dom"
      || specifier === "konva"
      || specifier === "react-konva"
      || specifier === "three"
      || specifier?.startsWith("@react-three/")
    )).toBe(false);
    expect(
      ["document", "window", "navigator", "localStorage", "fetch"]
        .filter((identifier) => identifiers.has(identifier))
    ).toEqual([]);
    expect(
      ["useRef", "useState", "useEffect", "createPortal"]
        .filter((identifier) => identifiers.has(identifier))
    ).toEqual([]);
    expect(source).not.toContain("import(");
  });

  it("keeps time and mutable editor refs outside the builder contract", () => {
    expect(source).not.toMatch(/\bnew Date\b/u);
    expect(source).toContain("savedAt: string;");
    expect(source).toContain("pagesHistory: readonly (readonly Page[])[];");
    expect(source).toContain("projectStudioPendingStrokes(");
    expect(source).toContain("serializeDocumentMaster(input.master)");
  });

  it("keeps ref reads in StudioPage while sharing one persisted-field builder", () => {
    expect(pageSource).toContain('from "./studio-project-snapshot"');
    expect(pageSource).toContain("const { buildCurrentStudioProjectFileSnapshot } = useStudioStableHandlers<{");
    expect(pageSource).toContain("buildStudioProjectFileSnapshot({");
    expect(pageSource.match(/resolveStudioDurableProjectPages\(\{/gu)).toHaveLength(4);
    expect(pageSource).toContain("studioProjectSnapshotHasMeaningfulContent(");
    expect(pageSource).not.toContain("studioWriterRoomHasContent(");
    expect(pageSource).not.toContain("studioReferenceBoardHasContent(");
    expect(source).not.toContain("pagesHistoryRef");
    expect(source).not.toContain("pendingStrokeCommitsRef");
  });
});
