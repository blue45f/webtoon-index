import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const PANEL_FILES = [
  "./StudioBg3dImmersivePanel.tsx",
  "./StudioBg3dShapesPanel.tsx",
  "./StudioBg3dViewPanel.tsx",
  "./StudioBg3dViewPanelContent.tsx",
  "./StudioBg3dLtPanel.tsx",
] as const;

function moduleSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function moduleImports(fileName: string) {
  const source = moduleSource(fileName);
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const staticImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      staticImports.push(node.moduleSpecifier.text);
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

  visit(sourceFile);
  return { dynamicImports, staticImports };
}

describe("Studio BG3D panel source boundary", () => {
  it("keeps every React Compiler source unit below the guarded 480 KB ceiling", () => {
    for (const fileName of ["./StudioBackground3D.tsx", ...PANEL_FILES]) {
      expect(
        Buffer.byteLength(moduleSource(fileName), "utf8"),
        `${fileName} must keep React Compiler headroom`,
      ).toBeLessThan(512_000);
    }
  });

  it("keeps the panels inside the single static BG3D editor closure", () => {
    const bindingsSource = moduleSource("./studio-bg3d-editor-runtime-bindings.ts");
    expect(bindingsSource).toContain('from "./StudioBg3dImmersivePanel"');
    expect(bindingsSource).toContain('from "./StudioBg3dShapesPanel"');
    expect(bindingsSource).toContain('from "./StudioBg3dViewPanel"');
    expect(bindingsSource).toContain('from "./StudioBg3dLtPanel"');

    const loaderImports = moduleImports("../studio-background-3d-loader.ts");
    expect(loaderImports.staticImports).not.toContain("./bg3d/StudioBackground3D");
    expect(loaderImports.dynamicImports).toEqual(["./bg3d/StudioBackground3D"]);
  });

  it("does not create renderer back-edges or nested lazy boundaries in UI-only panels", () => {
    for (const fileName of [...PANEL_FILES, "./studio-bg3d-editor-ui.ts"]) {
      const imports = moduleImports(fileName);
      expect(imports.dynamicImports, fileName).toEqual([]);
      expect(imports.staticImports, fileName).not.toContain("./StudioBackground3D");
      expect(imports.staticImports, fileName).not.toContain("three");
      expect(
        imports.staticImports.some((source) => source.startsWith("@react-three/")),
        fileName,
      ).toBe(false);
    }
  });

  it("preserves always-mounted tab panels through the hidden attribute", () => {
    const editorSource = [
      moduleSource("./StudioBackground3D.tsx"),
      moduleSource("./StudioBg3dEditorSidebar.tsx"),
      moduleSource("./StudioBg3dEditorSidebarExtras.tsx"),
    ].join("\n");
    const expectations = [
      ["StudioBg3dShapesPanel", "shapes", "./StudioBg3dShapesPanel.tsx"],
      ["StudioBg3dViewPanel", "view", "./StudioBg3dViewPanelContent.tsx"],
      ["StudioBg3dLtPanel", "lt", "./StudioBg3dLtPanel.tsx"],
    ] as const;

    for (const [componentName, tab, sourceFile] of expectations) {
      expect(editorSource).toContain(`<${componentName}`);
      expect(editorSource).toContain(`hidden={hideOnTab("${tab}")}`);
      expect(moduleSource(sourceFile)).toContain("<section hidden={hidden}>");
    }
  });
});
