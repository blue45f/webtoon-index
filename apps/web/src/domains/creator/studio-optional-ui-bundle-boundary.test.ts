import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";

interface ModuleEdges {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly valueImports: readonly string[];
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      allImports.push(node.moduleSpecifier.text);
      const clause = node.importClause;
      const namedBindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(namedBindings && ts.isNamespaceImport(namedBindings))
          || Boolean(
            namedBindings
            && ts.isNamedImports(namedBindings)
            && namedBindings.elements.some((specifier) => !specifier.isTypeOnly),
          )
        )
      );
      if (hasRuntimeValue) {
        valueImports.push(node.moduleSpecifier.text);
      }
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { allImports, dynamicImports, source, valueImports };
}

const STUDIO_LAZY_UI_OPTIONAL_MODULES = [
  "./StudioColorPalettePanel",
  "./filter/StudioFilterDialog",
  "./StudioFloodFillPanel",
  "./StudioHealCloneOverlay",
  "./StudioHistoryBrushOverlay",
  "./StudioImageAdjustmentsPanel",
  "./StudioIsometricGridOverlay",
  "./layer/StudioLayerMaskOverlay",
  "./layer/StudioLayerNavigator",
  "./StudioPaletteLibraryPanel",
  "./StudioPanelSplitTool",
  "./StudioPerspectiveOverlay",
  "./StudioPuppetWarpOverlay",
] as const;

describe("Studio optional UI bundle boundaries", () => {
  it("owns optional inspector and canvas-tool surfaces in the neutral lazy registry", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const inspector = moduleEdges("./StudioInspectorAside.tsx");
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(registry.allImports).not.toContain("./StudioPage");
    expect(registry.allImports).not.toContain("./StudioInspectorAside");

    for (const specifier of STUDIO_LAZY_UI_OPTIONAL_MODULES) {
      expect(page.valueImports, `${specifier} must not be a StudioPage value import`).not.toContain(specifier);
      expect(page.dynamicImports, `${specifier} must not be loaded by StudioPage`).not.toContain(specifier);
      expect(inspector.valueImports, `${specifier} must not be an Inspector value import`).not.toContain(specifier);
      expect(inspector.dynamicImports, `${specifier} must not be loaded by Inspector`).not.toContain(specifier);
      expect(registry.valueImports, `${specifier} must remain lazy in the registry`).not.toContain(specifier);
      expect(
        registry.dynamicImports.filter((candidate) => candidate === specifier),
        `${specifier} must have one registry-owned literal dynamic import`
      ).toEqual([specifier]);
    }
  });

  it("shares one PanelSplit module loader between the inspector panel and canvas overlay", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(page.dynamicImports).not.toContain("./StudioPanelSplitTool");
    expect(registry.dynamicImports.filter((specifier) => specifier === "./StudioPanelSplitTool")).toEqual([
      "./StudioPanelSplitTool",
    ]);
    expect(registry.source).toContain("const studioPanelSplitToolLoader = createStudioIntentLazyLoader(");
    expect(registry.source).toContain(
      "studioPanelSplitToolLoader.load().then((mod) => ({ default: mod.StudioPanelSplitPanel }))"
    );
    expect(registry.source).toContain(
      "studioPanelSplitToolLoader.load().then((mod) => ({ default: mod.StudioPanelSplitOverlay }))"
    );
  });

  it("mounts only active or actually visited image tabs instead of persisted hidden children", () => {
    const source = readStudioInspectorAsideSurface();

    for (const tab of ["quick", "fill", "retouch", "mask", "transform"] as const) {
      expect(source).toContain(`shouldMountImageInspectorTab("${tab}") ? (`);
      expect(source).toContain(`hidden={activeImageInspectorTab !== "${tab}"}`);
    }
    expect(source).toContain("activatedImageInspectorTabs.has(tab)");
    expect(source).toContain("next.add(activeImageInspectorTab)");
    expect(source).toContain(">(() => new Set());");
    expect(source).not.toContain("new Set([inspectorLayout.image])");
  });

  it("keeps the heavy workspace manager behind the lightweight intent gate", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const menubar = moduleEdges("./StudioMenubarContent.tsx");
    const gate = moduleEdges("./StudioWorkspaceMenuGate.tsx");

    expect(page.valueImports).not.toContain("./StudioWorkspaceMenu");
    expect(page.valueImports).not.toContain("./StudioWorkspaceMenuGate");
    expect(menubar.valueImports).toContain("./StudioWorkspaceMenuGate");
    expect(gate.valueImports).not.toContain("./StudioWorkspaceMenu");
    expect(gate.dynamicImports.filter((specifier) => specifier === "./StudioWorkspaceMenu")).toEqual([
      "./StudioWorkspaceMenu",
    ]);
    expect(gate.source).toContain("createStudioIntentLazyLoader<StudioWorkspaceMenuModule>");
    expect(gate.source).toContain("studioWorkspaceMenuLoader.preload()");
  });

  it("uses local passive Suspense boundaries for lazy Konva overlays", () => {
    const source = moduleEdges("./canvas/StudioCanvasInteractiveOverlays.tsx").source;
    const guideSource = moduleEdges("./canvas/StudioCanvasGuideLayers.tsx").source;

    for (const component of [
      "StudioPanelSplitOverlay",
      "StudioHealCloneOverlay",
      "StudioHistoryBrushOverlay",
      "StudioPuppetWarpOverlay",
      "StudioLayerMaskOverlay",
    ] as const) {
      expect(source).toMatch(
        new RegExp(`<Suspense fallback=\\{null\\}>[\\s\\S]{0,700}<${component}`)
      );
    }
    for (const component of ["StudioPerspectiveOverlay", "StudioIsometricGridOverlay"] as const) {
      expect(guideSource).toMatch(
        new RegExp(`<Suspense fallback=\\{null\\}>[\\s\\S]{0,700}<${component}`)
      );
    }
  });
});
