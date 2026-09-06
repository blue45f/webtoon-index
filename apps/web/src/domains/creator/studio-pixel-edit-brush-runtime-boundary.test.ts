import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleEdges {
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly valueImports: readonly string[];
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const rawSource = readFileSync(fileUrl, "utf8");
  const source = relativePath.endsWith("StudioPage.tsx") || relativePath.endsWith("StudioCuttoonEditorHost.tsx")
    ? readStudioCuttoonEditorSource()
    : rawSource;
  const file = ts.createSourceFile(
    fileUrl.pathname,
    rawSource,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
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
            && namedBindings.elements.some((specifier) => !specifier.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      const hasRuntimeValue = !clause || (
        ts.isNamedExports(clause)
        && clause.elements.some((specifier) => !specifier.isTypeOnly)
      );
      if (hasRuntimeValue) valueImports.push(node.moduleSpecifier.text);
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

const BROWSER_ORCHESTRATORS = [
  "./studio-heal-clone-browser",
  "./studio-magic-wand-browser",
  "./render/studio-raster-retouch-region",
  "./studio-retouch-browser",
  "./studio-smudge-browser",
] as const;

describe("Studio pixel-edit brush runtime boundary", () => {
  it("keeps one cached intent boundary out of the Studio static graph", () => {
    const page = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const runtimeLoaders = moduleEdges("./studio-page-editor-runtime-loaders.ts");
    const runtime = moduleEdges("./studio-pixel-edit-brush-runtime.ts");

    expect(page.valueImports).toContain("./studio-page-editor-runtime-loaders");
    expect(page.dynamicImports.filter(
      (specifier) => specifier === "./studio-pixel-edit-brush-runtime"
    )).toEqual([]);
    expect(page.valueImports).not.toContain("./studio-pixel-edit-brush-runtime");
    for (const specifier of BROWSER_ORCHESTRATORS) {
      expect(page.valueImports).not.toContain(specifier);
    }
    expect(runtimeLoaders.dynamicImports.toSorted()).toEqual([
      "./brush/studio-brush-library-sqlite-repository",
      "./brush/studio-brush-slots-sqlite-repository",
      "./studio-liquify-browser",
      "./studio-pixel-edit-brush-runtime",
    ]);
    expect(runtime.valueImports.toSorted()).toEqual(BROWSER_ORCHESTRATORS.toSorted());
    expect(runtime.dynamicImports).toEqual([]);
    expect(runtimeLoaders.source).toContain(
      "studioPixelEditBrushRuntimePromise ??= import(\"./studio-pixel-edit-brush-runtime\")"
    );
  });

  it("awaits the shared runtime inside every async pixel mutation guard", () => {
    const { source } = moduleEdges("./StudioCuttoonEditorHost.tsx");

    expect(source).toContain(
      "const { magicWandScanFromImage } = await loadStudioPixelEditBrushRuntime();"
    );
    expect(source).toContain(
      "const { smudgeStrokeImage } = await loadStudioPixelEditBrushRuntime();"
    );
    expect(source).toContain("bakeHealCloneStrokeToCanvas");
    expect(source).toContain("runStudioDodgeBurnRetouch");
    expect(source).toContain("runStudioWetMixRetouch");
    expect(source).toContain("encodeStudioRetouchCanvasPng");
    expect(source).not.toContain('await import("./studio-dodge-burn")');
    expect(source).not.toContain('await import("./brush/studio-wet-mix")');
  });

  it("keeps PNG encoding on the preselected runtime when module loading fails", () => {
    const helper = moduleEdges("./studio-legacy-editor-runtime-helpers.ts");
    const start = helper.source.indexOf(
      "export async function encodeStudioPixelEditResultPng(",
    );
    const end = helper.source.indexOf(
      "export async function yieldStudioPixelEditMainThread",
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const encode = helper.source.slice(start, end);

    expect(encode).toContain("await loadStudioPixelEditBrushRuntime()");
    expect(encode).toContain("runtime.encodeStudioRetouchCanvasPng(canvas, { signal })");
    expect(encode).not.toContain(".catch(");
    expect(encode).not.toContain("encodeStudioPixelEditCanvasPng");
  });

  it("keeps heal/clone completion cancellable and its pointer-move preview off React state", () => {
    const { source } = moduleEdges("./StudioCuttoonEditorHost.tsx");
    const bakeStart = source.indexOf("async function bakeHealCloneDragStroke");
    const bakeEnd = source.indexOf("// ── 히스토리 브러시 소스 지정", bakeStart);
    expect(bakeStart).toBeGreaterThanOrEqual(0);
    expect(bakeEnd).toBeGreaterThan(bakeStart);
    const bakeSource = source.slice(bakeStart, bakeEnd);
    expect(bakeSource).toContain("bakeHealCloneStrokeToCanvas");
    expect(bakeSource).toContain("encodeStudioRetouchCanvasPng");
    expect(bakeSource).toContain("{ signal: controller.signal }");
    expect(bakeSource).not.toContain(".toDataURL(");

    const moveStart = source.indexOf("function onStageMove");
    const moveEnd = source.indexOf("function onStageUp", moveStart);
    const healMoveStart = source.indexOf("if (healCloneDragRef.current)", moveStart);
    const healMoveEnd = source.indexOf("// 히스토리 브러시 드래그 중이면", healMoveStart);
    expect(moveEnd).toBeGreaterThan(moveStart);
    expect(healMoveStart).toBeGreaterThan(moveStart);
    expect(healMoveEnd).toBeLessThan(moveEnd);
    const healMoveSource = source.slice(healMoveStart, healMoveEnd);
    // The guarantee is that the drag appends into the live session IN PLACE and never rebuilds the
    // array — `[...points, next]` per pointer move is what made these drags O(n²). The direct
    // `session.points.push(appended)` was replaced by the shared `appendBrushPointInPlace` helper,
    // which also carries the min-distance dedup; the in-place contract is unchanged.
    expect(healMoveSource).toContain("appendBrushPointInPlace(session.points");
    expect(healMoveSource).toContain("scheduleHealCloneDragPreview(session)");
    expect(healMoveSource).not.toContain("setHealCloneDragPreview");
    expect(healMoveSource).not.toContain("session.points =");
    expect(healMoveSource).not.toContain("...session.points");
  });
});
