import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const CONTROL_NAMES = [
  "LtRangeControl",
  "PanoramaRotationNumberField",
  "LtToggleRow",
  "Vec3Field",
  "BgAnimationPlayhead",
] as const;

function moduleSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function moduleImports(fileName: string) {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const valueImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { dynamicImports, valueImports };
}

describe("Studio BG3D control-field ownership boundary", () => {
  it("keeps field behavior in the dedicated module and scene wiring in the editor", () => {
    const editorSource = moduleSource("./StudioBackground3D.tsx");
    const panelSource = [
      moduleSource("./StudioBg3dShapesPanel.tsx"),
      moduleSource("./StudioBg3dViewPanelContent.tsx"),
      moduleSource("./StudioBg3dLtPanel.tsx"),
    ].join("\n");
    const controlSource = moduleSource("./studio-bg3d-control-fields.tsx");
    const bindingsSource = moduleSource("./studio-bg3d-editor-runtime-bindings.ts");

    expect(bindingsSource).toContain('from "./studio-bg3d-control-fields"');
    for (const controlName of CONTROL_NAMES) {
      expect(editorSource).not.toContain(`function ${controlName}(`);
      expect(controlSource).toContain(`export function ${controlName}(`);
      expect(panelSource).toContain(`<${controlName}`);
    }
  });

  it("keeps the extracted fields independent of renderer and physics runtimes", () => {
    const imports = moduleImports("./studio-bg3d-control-fields.tsx");

    expect(imports.dynamicImports).toEqual([]);
    expect(imports.valueImports).toEqual([
      "react",
      "../studio-background-3d-sky",
      "../StudioThreeDToggle",
      "./studio-bg3d-animation-time",
    ]);
    expect(imports.valueImports).not.toContain("three");
    expect(imports.valueImports.some((source) => source.startsWith("@react-three/"))).toBe(false);
    expect(imports.valueImports.some((source) => source.includes("physics"))).toBe(false);
  });

  it("preserves the single lazy editor boundary and renderer ownership", () => {
    const _editorSource = moduleSource("./StudioBackground3D.tsx");
    const loaderImports = moduleImports("../studio-background-3d-loader.ts");

    expect(loaderImports.valueImports).not.toContain("./bg3d/StudioBackground3D");
    expect(loaderImports.dynamicImports).toEqual(["./bg3d/StudioBackground3D"]);
    // 2026-08-21 intentional change: the R3F mesh nodes moved from StudioBackground3D.tsx into
    // StudioBg3dSceneNodes.tsx (editor split); both still sit behind the one lazy editor chunk.
    const sceneNodesSource = moduleSource("./StudioBg3dSceneNodes.tsx");

    expect(moduleSource("./StudioBg3dCaptureBridge.tsx")).toContain("function CaptureBridge(");
    expect(sceneNodesSource).toContain("function BgCustomModelMesh(");
    expect(sceneNodesSource).toContain("function BgCustomModelInstanceBatch(");
  });
});
