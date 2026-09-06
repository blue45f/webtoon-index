import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonStagePointersSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly typeImports: readonly string[];
  readonly valueImports: readonly string[];
}

function moduleShape(relativePath: string): ModuleShape {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const sourceFile = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const typeImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allImports.push(specifier);
      const clause = node.importClause;
      if (clause?.isTypeOnly) typeImports.push(specifier);
      const namedBindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(namedBindings && ts.isNamespaceImport(namedBindings))
          || Boolean(
            namedBindings
            && ts.isNamedImports(namedBindings)
            && namedBindings.elements.some((item) => !item.isTypeOnly),
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(specifier);
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

  visit(sourceFile);
  return { allImports, dynamicImports, source, sourceFile, typeImports, valueImports };
}

function interfacePropNames(shape: ModuleShape, name: string): string[] {
  const declaration = shape.sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (!declaration) throw new Error(`Missing interface ${name}`);
  return declaration.members.flatMap((member) => (
    ts.isPropertySignature(member) && member.name ? [member.name.getText()] : []
  ));
}

function findJsx(shape: ModuleShape, name: string): ts.JsxSelfClosingElement {
  let match: ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isJsxSelfClosingElement(node)
      && ts.isIdentifier(node.tagName)
      && node.tagName.text === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(shape.sourceFile);
  if (!match) throw new Error(`Missing JSX call ${name}`);
  return match;
}

function jsxPropNames(node: ts.JsxSelfClosingElement): string[] {
  return node.attributes.properties.flatMap((property) => (
    ts.isJsxAttribute(property) ? [property.name.getText()] : []
  ));
}

const UNDERLAY_PROPS = [
  "canvasWidth",
  "canvasHeight",
  "effScale",
  "gridSize",
  "showGrid",
  "showWebtoonGuides",
  "webtoonGuides",
] as const;

const OVERLAY_PROPS = [
  "isExporting",
  "drawingMode",
  "canvasWidth",
  "canvasHeight",
  "effScale",
  "guides",
  "smartGuides",
  "userGuides",
  "setUserGuides",
  "symmetryType",
  "symmetryCenterX",
  "symmetryCenterY",
  "symmetryRadialCount",
  "setSymmetryCenterX",
  "setSymmetryCenterY",
  "perspectiveRulerActive",
  "vanishingPoints",
  "perspectiveEyeLevelY",
  "perspectiveLockHorizon",
  "onPreviewVanishingPoint",
  "onCommitVanishingPoint",
  "onPreviewPerspectiveEyeLevelY",
  "onCommitPerspectiveEyeLevelY",
  "isometricGridActive",
  "isometricConfig",
  "onPreviewIsometricOrigin",
  "onCommitIsometricOrigin",
  "advancedRulers",
  "onPreviewAdvancedRuler",
  "onCommitAdvancedRuler",
  "drawingAssistDisabled",
  "onCancelDrawingAssistPreview",
  "sharedGutters",
  "onBeginSharedGutterDrag",
  "onPreviewSharedGutterDrag",
  "onCommitSharedGutterDrag",
] as const;

describe("Studio canvas guide layer ownership boundary", () => {
  it("keeps one-way guide rendering ownership outside StudioPage", () => {
    const stageHost = moduleShape("./StudioCanvasViewportStageHost.tsx");
    const toolLayers = moduleShape("./StudioCanvasViewportToolLayers.tsx");
    const guides = moduleShape("./StudioCanvasGuideLayers.tsx");

    expect(stageHost.valueImports.filter((specifier) => specifier === "./StudioCanvasGuideLayers"))
      .toEqual(["./StudioCanvasGuideLayers"]);
    expect(toolLayers.valueImports.filter((specifier) => specifier === "./StudioCanvasGuideLayers"))
      .toEqual(["./StudioCanvasGuideLayers"]);
    expect(guides.allImports).not.toContain("../StudioPage");
    expect(guides.dynamicImports).toEqual([]);
    expect(guides.valueImports).toEqual([
      "react",
      "react-konva/lib/ReactKonvaCore",
      "../studio-kaleidoscope",
      "../studio-page-lazy-ui",
    ]);
    expect(guides.typeImports).toEqual([
      "../studio-advanced-ruler-document",
      "../studio-frame-folder",
      "../studio-isometric-grid",
      "../studio-perspective-guide",
      "../studio-smart-guides",
    ]);
    expect(guides.valueImports).not.toContain("../studio-webtoon-guides");
    expect(guides.source).toContain('typeof import("../studio-webtoon-guides")');
    expect(guides.source).not.toMatch(/(?:studio-crdt|studio-webgpu|react-router|StudioPage)/u);
  });

  it("locks both exported contracts and their Page call sites", () => {
    const stageHost = moduleShape("./StudioCanvasViewportStageHost.tsx");
    const toolLayers = moduleShape("./StudioCanvasViewportToolLayers.tsx");
    const guides = moduleShape("./StudioCanvasGuideLayers.tsx");

    expect(interfacePropNames(guides, "StudioCanvasGuideUnderlayProps")).toEqual(UNDERLAY_PROPS);
    expect(interfacePropNames(guides, "StudioCanvasGuideOverlayLayersProps")).toEqual(OVERLAY_PROPS);
    expect(jsxPropNames(findJsx(stageHost, "StudioCanvasGuideUnderlay"))).toEqual(UNDERLAY_PROPS);
    expect(jsxPropNames(findJsx(toolLayers, "StudioCanvasGuideOverlayLayers"))).toEqual(OVERLAY_PROPS);
  });

  it("preserves the underlay/document/overlay Stage z-order", () => {
    const stageHost = moduleShape("./StudioCanvasViewportStageHost.tsx").source;
    const documentLayer = moduleShape("./StudioCanvasViewportDocumentLayer.tsx").source;
    const toolLayers = moduleShape("./StudioCanvasViewportToolLayers.tsx").source;
    const interactive = moduleShape("./StudioCanvasInteractiveOverlays.tsx").source;
    const mainLayer = stageHost.indexOf("<Layer ref={mainLayerRef}>");
    const underlay = stageHost.indexOf("<StudioCanvasGuideUnderlay", mainLayer);
    const documentCall = stageHost.indexOf("<StudioCanvasViewportDocumentLayer", underlay);
    const toolCall = stageHost.indexOf("<StudioCanvasViewportToolLayers", documentCall);
    const stageClose = stageHost.indexOf("</Stage>", toolCall);
    const authoredDocument = documentLayer.indexOf("const canvasRenderElements");
    const lastToolOverlay = interactive.indexOf("<StudioLayerMaskOverlay");
    const overlay = toolLayers.indexOf("<StudioCanvasGuideOverlayLayers");

    expect(mainLayer).toBeGreaterThan(0);
    expect(underlay).toBeGreaterThan(mainLayer);
    expect(documentCall).toBeGreaterThan(underlay);
    expect(toolCall).toBeGreaterThan(documentCall);
    expect(stageClose).toBeGreaterThan(toolCall);
    expect(authoredDocument).toBeGreaterThan(0);
    expect(lastToolOverlay).toBeGreaterThan(0);
    expect(overlay).toBeGreaterThan(0);
    expect(toolLayers.slice(overlay).trim().startsWith("<StudioCanvasGuideOverlayLayers")).toBe(true);
  });

  it("moves every guide node implementation while retaining Stage pointer guards", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx").source;
    const stagePointers = readStudioCuttoonStagePointersSource();
    const guides = moduleShape("./StudioCanvasGuideLayers.tsx").source;

    for (const marker of ["grid-v-", "sgseg-", "kaleido-wedge-"] as const) {
      expect(page).not.toContain(marker);
      expect(guides).toContain(marker);
    }
    expect(page).not.toContain('name="guide-line-handle"');
    expect(page).not.toContain('name="symmetry-handle"');
    expect(page).not.toContain("<StudioPerspectiveOverlay");
    expect(page).not.toContain("<StudioIsometricGridOverlay");
    expect(page).not.toContain("<StudioAdvancedRulerOverlay");
    expect(stagePointers).toContain('e.target.name() === "guide-line-handle"');
    expect(stagePointers).toContain('e.target.name() === "symmetry-handle"');
    expect(guides).toContain('name="guide-line-handle"');
    expect(guides).toContain('name="symmetry-handle"');
    expect(guides).toMatch(/<Suspense fallback=\{null\}>[\s\S]{0,700}<StudioPerspectiveOverlay/u);
    expect(guides).toMatch(/<Suspense fallback=\{null\}>[\s\S]{0,700}<StudioIsometricGridOverlay/u);
    expect(guides).toContain("<StudioAdvancedRulerOverlay");
  });
});
