import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";

interface ModuleEdges {
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
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
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
  return { dynamicImports, source, valueImports };
}

describe("procedural artistic brush inspector boundary", () => {
  it("keeps optional UI and heavy generation behind literal lazy boundaries", () => {
    const inspector = moduleEdges("./StudioInspectorDrawingSection.tsx");
    const section = moduleEdges(
      "./StudioProceduralArtisticBrushInspectorSection.tsx",
    );
    const registry = moduleEdges("./studio-page-lazy-ui.ts");

    expect(inspector.valueImports).toContain(
      "./StudioProceduralArtisticBrushInspectorSection",
    );
    expect(inspector.valueImports).not.toContain(
      "./StudioProceduralArtisticBrushController",
    );
    expect(section.valueImports).toContain("./studio-page-lazy-ui");
    expect(section.valueImports).not.toContain(
      "./StudioProceduralArtisticBrushController",
    );
    expect(
      registry.dynamicImports.filter(
        (specifier) => specifier
          === "./StudioProceduralArtisticBrushController",
      ),
    ).toEqual(["./StudioProceduralArtisticBrushController"]);

    expect(section.valueImports).not.toContain(
      "./studio-procedural-artistic-brush-product",
    );
    expect(
      section.dynamicImports.filter(
        (specifier) => specifier
          === "./studio-procedural-artistic-brush-product",
      ),
    ).toHaveLength(2);
    for (const heavyModule of [
      "./studio-procedural-artistic-brush-provider",
      "./studio-procedural-artistic-brush-worker-client",
      "./studio-procedural-artistic-brush-browser",
      "./studio-p5-brush-real-runtime-client",
    ]) {
      expect(inspector.valueImports).not.toContain(heavyModule);
      expect(inspector.dynamicImports).not.toContain(heavyModule);
      expect(section.valueImports).not.toContain(heavyModule);
      expect(section.dynamicImports).not.toContain(heavyModule);
    }
  });

  it("mounts beside Brush Studio only for pen/eraser-family modes", () => {
    const source = moduleEdges("./StudioInspectorDrawingSection.tsx").source;
    const brushStudioAt = source.indexOf("<StudioBrushStudio");
    const proceduralAt = source.indexOf(
      "<StudioProceduralArtisticBrushInspectorSection",
    );
    const guardAt = source.lastIndexOf(
      'drawMode !== "shape" && drawMode !== "pixel"',
      proceduralAt,
    );

    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(proceduralAt).toBeGreaterThan(brushStudioAt);
    expect(proceduralAt - guardAt).toBeLessThan(300);
    expect(source).toContain(
      'key={`${currentPageId}:${masterEditMode ? "master" : "page"}`}',
    );
    expect(source).toContain("pageId={currentPageId}");
    expect(source).toContain("masterEditMode={masterEditMode}");
  });

  it("enforces locks, bounded dimensions, monotonic requests and canonical insertion", () => {
    const inspector = readStudioInspectorAsideSurface();
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx").source;
    const source = moduleEdges(
      "./StudioProceduralArtisticBrushInspectorSection.tsx",
    ).source;
    const controllerAt = source.indexOf(
      "<StudioProceduralArtisticBrushController",
    );
    const snippet = source.slice(controllerAt, controllerAt + 4_000);

    expect(source).toContain(
      "const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_ENGINE_EPOCH = 1;",
    );
    expect(source).toContain("Number.MAX_SAFE_INTEGER");
    expect(source).toContain(
      "studioProceduralArtisticBrushRequestSequence += 1;",
    );
    expect(snippet.match(/Math\.max\(\s*32,/gu)).toHaveLength(2);
    expect(snippet).toContain("Math.min(CANVAS_W, 1_024)");
    expect(snippet).toContain("Math.min(Math.floor(canvasHeight), 1_024)");
    expect(snippet).toContain(
      "probeStudioProceduralArtisticBrushProduct",
    );
    expect(snippet).toContain(
      "generateStudioProceduralArtisticBrushProduct",
    );
    expect(snippet).toContain(
      "nextStudioProceduralArtisticBrushRequestSequence()",
    );
    expect(snippet).toContain("const targetPageId = pageId;");
    expect(snippet).toContain(
      "const targetMasterEditMode = masterEditMode;",
    );
    expect(snippet).toContain("!onInsert(");
    expect(snippet).toContain("targetPageId,");
    expect(snippet).toContain("targetMasterEditMode,");
    expect(snippet).toContain(
      "절차적 질감 레이어를 현재 문서에 추가하지 못했습니다.",
    );
    expect(inspector).toContain("collaborationDocumentLocked");
    expect(inspector).toContain("activeSurfaceReviewLocked");
    expect(inspector).toContain(
      "협업 문서 잠금을 해제한 뒤 절차적 질감을 만들 수 있어요.",
    );
    expect(inspector).toContain(
      "표면 리뷰를 마친 뒤 절차적 질감을 만들 수 있어요.",
    );
    expect(inspector).toContain(
      "targetPageId: string",
    );
    expect(page).toContain("targetPageId !== activePage.id");
    expect(page).toContain(
      "targetMasterEditMode !== masterEditModeRef.current",
    );
    expect(page).toContain(
      "addProceduralArtisticBrushRaster: (",
    );
  });
});
