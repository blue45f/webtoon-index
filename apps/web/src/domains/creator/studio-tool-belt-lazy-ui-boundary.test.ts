import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const BODY_SPECS = [
  {
    id: "asset-group",
    module: "StudioAssetToolPopoverBody",
    lazyComponent: "LazyStudioAssetToolPopoverBody",
    preload: "preloadStudioAssetToolPopoverBody",
    importPath: "./StudioAssetToolPopoverBody",
  },
  {
    id: "bg-group",
    module: "StudioSceneToolPopoverBody",
    lazyComponent: "LazyStudioSceneToolPopoverBody",
    preload: "preloadStudioSceneToolPopoverBody",
    importPath: "./StudioSceneToolPopoverBody",
  },
  {
    id: "style-group",
    module: "StudioStyleToolPopoverBody",
    lazyComponent: "LazyStudioStyleToolPopoverBody",
    preload: "preloadStudioStyleToolPopoverBody",
    importPath: "./StudioStyleToolPopoverBody",
  },
  {
    id: "ai-group",
    module: "ai/StudioAiToolPopoverBody",
    lazyComponent: "LazyStudioAiToolPopoverBody",
    preload: "preloadStudioAiToolPopoverBody",
    importPath: "./ai/StudioAiToolPopoverBody",
  },
  {
    id: "bubble-menu",
    module: "lettering/StudioBubbleToolPopoverBody",
    lazyComponent: "LazyStudioBubbleToolPopoverBody",
    preload: "preloadStudioBubbleToolPopoverBody",
    importPath: "./lettering/StudioBubbleToolPopoverBody",
  },
] as const;

const DEFAULT_LEAF_MODULES = [
  "./ai/StudioAiAssistHub",
  "./ai/StudioAiBackgroundPanel",
  "./StudioBackgroundPanel",
  "./canvas/StudioCanvasResizer",
  "./StudioPaletteLibraryPanel",
] as const;

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function sourceFile(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function dynamicImports(file: ts.SourceFile): string[] {
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

function callCount(file: ts.SourceFile, name: string): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return count;
}

function namedImportIsTypeOnly(file: ts.SourceFile, module: string): boolean {
  const declaration = file.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && (statement.moduleSpecifier.text === module || statement.moduleSpecifier.text === `../${module.replace(/^\.\//, "")}`)
  );
  return declaration?.importClause?.isTypeOnly === true;
}

describe("Studio ToolBelt intent-lazy popover boundary", () => {
  it("keeps exactly five literal body chunks behind retryable intent loaders", () => {
    const registry = sourceFile("./studio-tool-belt-lazy-ui.ts");

    expect(callCount(registry, "createStudioIntentLazyLoader")).toBe(5);
    expect(callCount(registry, "lazyRetry")).toBe(5);
    expect(dynamicImports(registry).toSorted()).toEqual(
      [
        ...BODY_SPECS.map(({ importPath }) => importPath),
        ...DEFAULT_LEAF_MODULES,
      ].toSorted()
    );

    const source = registry.getFullText();
    for (const { importPath, lazyComponent, preload } of BODY_SPECS) {
      expect(source.match(new RegExp(`import\\("${importPath.replace(".", "\\.")}"\\)`, "gu"))).toHaveLength(1);
      expect(source).toContain(`export const ${lazyComponent} = lazyRetry(`);
      expect(source).toContain(`export function ${preload}(): void`);
    }
  });

  it("warms each initially visible lazy leaf in parallel with its owning body", () => {
    const registry = sourceFile("./studio-tool-belt-lazy-ui.ts");
    const source = registry.getFullText();

    expect(callCount(registry, "warmStudioToolPopoverChunk")).toBe(
      DEFAULT_LEAF_MODULES.length
    );
    for (const module of DEFAULT_LEAF_MODULES) {
      expect(source).toContain(
        `warmStudioToolPopoverChunk(() => import("${module}"))`
      );
    }
  });

  it("keeps the five portal roots in ToolBelt while only their children suspend", () => {
    const toolBelt =
      read("./StudioToolBeltContent.tsx") +
      read("./StudioToolBeltCreateModeGroups.tsx") +
      read("./StudioToolBeltCreateModeInsertTools.tsx");

    expect(toolBelt.match(/<StudioFloatingToolPopover\b/gu)).toHaveLength(5);
    expect(toolBelt.match(/<LazyStudio\w+ToolPopoverBody\b/gu)).toHaveLength(5);

    for (const { id, module, lazyComponent, preload } of BODY_SPECS) {
      expect(toolBelt).toContain(`id="${id}"`);
      expect(toolBelt).toContain(`<${lazyComponent}`);
      expect(toolBelt).not.toContain(`from "./${module}"`);
      expect(toolBelt).not.toContain(`import("./${module}")`);
      expect(toolBelt.match(new RegExp(`\\b${preload}\\b`, "gu"))?.length ?? 0).toBeGreaterThanOrEqual(1);

      const rootStart = toolBelt.indexOf(`id="${id}"`);
      const rootEnd = toolBelt.indexOf("</StudioFloatingToolPopover>", rootStart);
      const root = toolBelt.slice(rootStart, rootEnd);
      expect(root.indexOf("<Suspense")).toBeGreaterThan(0);
      expect(root.indexOf(`<${lazyComponent}`)).toBeGreaterThan(root.indexOf("<Suspense"));
    }
  });

  it("keeps body modules one-way, root-free, and independent from StudioPage", () => {
    for (const { id, module } of BODY_SPECS) {
      const relativePath = `./${module}.tsx`;
      const file = sourceFile(relativePath);
      const source = file.getFullText();

      expect(namedImportIsTypeOnly(file, "./StudioToolBeltContent")).toBe(true);
      expect(source).not.toContain("StudioFloatingToolPopover");
      expect(source).not.toContain(`id="${id}"`);
      expect(source).not.toContain("./StudioPage");
      expect(dynamicImports(file)).toEqual([]);
    }
  });

  it("does not introduce a second menu-state owner in the lazy registry or bodies", () => {
    const sources = [
      read("./studio-tool-belt-lazy-ui.ts"),
      ...BODY_SPECS.map(({ module }) => read(`./${module}.tsx`)),
    ];

    for (const source of sources) {
      expect(source).not.toContain("useState(");
      expect(source).not.toContain("useReducer(");
    }
  });
});
