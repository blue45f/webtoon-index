import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type ModuleImports = {
  readonly dynamic: readonly string[];
  readonly static: readonly string[];
};

function readModuleImports(fileName: string): ModuleImports {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const sourceFile = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const dynamic: string[] = [];
  const staticImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      staticImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      dynamic.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { dynamic, static: staticImports };
}

const LAYOUT_MODULES = [
  "./studio-companion-window-layout",
  "./studio-companion-window-preferences-sqlite",
  "./use-studio-companion-window-layout",
  "./StudioCompanionWindowLayoutControls",
  "./StudioCompanionWorkspacePresets",
] as const;

describe("Studio companion layout bundle boundary", () => {
  it("keeps one analyzable companion protocol import behind the StudioPage lazy boundary", () => {
    const runtime = readModuleImports("./studio-tools-companion-runtime.ts");

    expect(
      runtime.dynamic.filter((specifier) => specifier === "./studio-tools-companion")
    ).toEqual(["./studio-tools-companion"]);
  });

  it("keeps companion-only layout modules out of the main Studio canvas graph", () => {
    const page = readModuleImports("./StudioCuttoonEditorHost.tsx");

    for (const specifier of LAYOUT_MODULES) {
      expect(page.static, `${specifier} must not be statically imported by StudioPage`).not.toContain(
        specifier
      );
      expect(page.dynamic, `${specifier} must not be dynamically imported by StudioPage`).not.toContain(
        specifier
      );
    }
  });

  it("keeps the companion page as the layout UI owner", () => {
    const companionPage = readModuleImports("./StudioToolsCompanionPage.tsx");

    for (const specifier of [
      "./use-studio-companion-window-layout",
      "./StudioCompanionWindowLayoutControls",
      "./StudioCompanionWorkspacePresets",
    ]) {
      expect(companionPage.static.filter((candidate) => candidate === specifier)).toEqual([
        specifier,
      ]);
      expect(companionPage.dynamic).not.toContain(specifier);
    }
    expect(companionPage.static).not.toContain("./studio-companion-window-layout");
    expect(companionPage.dynamic).not.toContain("./studio-companion-window-layout");
  });

  it("keeps low-level persistence and placement ownership inside the companion hook", () => {
    const hook = readModuleImports("./use-studio-companion-window-layout.ts");

    expect(
      hook.static.filter((specifier) => specifier === "./studio-companion-window-layout")
    ).toEqual(["./studio-companion-window-layout"]);
    expect(
      hook.static.filter(
        (specifier) => specifier === "./studio-companion-window-preferences-sqlite",
      ),
    ).toEqual(["./studio-companion-window-preferences-sqlite"]);
    expect(hook.dynamic).not.toContain("./studio-companion-window-layout");
    expect(hook.dynamic).not.toContain("./studio-companion-window-preferences-sqlite");
  });
});
