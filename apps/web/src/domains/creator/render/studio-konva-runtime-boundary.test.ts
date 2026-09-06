import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

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
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allImports.push(specifier);
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
            && namedBindings.elements.some((item) => !item.isTypeOnly)
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

  visit(file);
  return { allImports, dynamicImports, source, valueImports };
}

const STUDIO_KONVA_SHAPE_IMPORTS = [
  "konva/lib/shapes/Arrow",
  "konva/lib/shapes/Circle",
  "konva/lib/shapes/Ellipse",
  "konva/lib/shapes/Image",
  "konva/lib/shapes/Line",
  "konva/lib/shapes/Path",
  "konva/lib/shapes/Rect",
  "konva/lib/shapes/Star",
  "konva/lib/shapes/Text",
  "konva/lib/shapes/TextPath",
  "konva/lib/shapes/Transformer",
] as const;

describe("studio Konva runtime ownership boundary", () => {
  it("centralizes Core, Filters, and the exact editor shape registry", () => {
    const runtime = moduleEdges("./studio-konva-runtime.ts");

    expect(runtime.valueImports.filter((specifier) => specifier === "konva/lib/Core")).toEqual([
      "konva/lib/Core",
    ]);
    expect(
      runtime.valueImports.filter((specifier) => specifier.startsWith("konva/lib/shapes/")),
    ).toEqual(STUDIO_KONVA_SHAPE_IMPORTS);
    expect(runtime.source).toContain(
      "export const studioKonvaRuntime = KonvaCore as unknown as typeof Konva;",
    );
    expect(runtime.source).toContain(
      "studioKonvaRuntime.Filters = studioKonvaRuntime.Filters ?? {};",
    );
  });

  it("keeps StudioPage as a consumer instead of a second runtime owner", () => {
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");

    expect(
      page.valueImports.filter((specifier) => specifier === "./render/studio-konva-runtime"),
    ).toEqual(["./render/studio-konva-runtime"]);
    expect(page.valueImports).not.toContain("konva/lib/Core");
    expect(
      page.valueImports.some((specifier) => specifier.startsWith("konva/lib/shapes/")),
    ).toBe(false);
    expect(page.source).toContain(
      'import { studioKonvaRuntime as KonvaRuntime } from "./render/studio-konva-runtime";',
    );
    expect(page.source).not.toContain("const KonvaRuntime = KonvaCore");
    expect(page.source).not.toContain("KonvaRuntime.Filters = KonvaRuntime.Filters ?? {};");
  });

  it("does not eager-load heavy filters and preserves both literal intent boundaries", () => {
    const runtime = moduleEdges("./studio-konva-runtime.ts");
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const imageNode = moduleEdges("../StudioKonvaImageNode.tsx");

    expect(runtime.dynamicImports).toEqual([]);
    expect(runtime.allImports).not.toContain("./studio-konva-filters");
    expect(runtime.allImports).not.toContain("../studio-image-filter-worker-client");
    expect(runtime.allImports.some((specifier) => specifier.startsWith("react-konva"))).toBe(false);
    expect(runtime.allImports).not.toContain("../StudioPage");
    expect(
      page.dynamicImports.filter((specifier) =>
        specifier === "./studio-konva-filters"
        || specifier === "../studio-image-filter-worker-client"
      ),
    ).toEqual([]);
    expect(imageNode.dynamicImports).toEqual([
      "./render/studio-konva-filters",
      // Linked-pass OPFS/CAS locators are verified only when an image actually needs them.
      "./render/studio-raster-source-lease",
      "./studio-image-filter-worker-client",
      // M1 GPU 필터 경로 — Worker 앞에서 시도하는 지연 청크(폴백은 기존 Worker/Konva).
      "./render/studio-gpu-filter-apply",
    ]);
    expect(imageNode.valueImports).toContain("./render/studio-konva-runtime");
  });

  it("registers every non-Core shape named by StudioPage and extracted canvas nodes", () => {
    const runtime = moduleEdges("./studio-konva-runtime.ts");
    const viewport = moduleEdges("../canvas/StudioCanvasViewportStageHost.tsx");
    const documentLayer = moduleEdges("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const toolLayers = moduleEdges("../canvas/StudioCanvasViewportToolLayers.tsx");
    const drawNode = moduleEdges("../brush/StudioDrawNode.tsx");
    const bubbleNode = moduleEdges("../StudioKonvaBubbleNode.tsx");
    const textNodes = moduleEdges("../StudioKonvaTextNodes.tsx");

    for (const shapeName of [
      "Arrow",
      "Circle",
      "Ellipse",
      "Image",
      "Line",
      "Path",
      "Rect",
      "Star",
      "Text",
      "TextPath",
      "Transformer",
    ]) {
      expect(runtime.valueImports).toContain(`konva/lib/shapes/${shapeName}`);
    }
    expect(viewport.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(documentLayer.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(toolLayers.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(drawNode.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(bubbleNode.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(textNodes.valueImports).toContain("react-konva/lib/ReactKonvaCore");
    expect(drawNode.source).toContain("Arrow,");
    expect(drawNode.source).toContain('if (kind === "arrow")');
    expect(bubbleNode.source).toContain("Path,");
    expect(textNodes.source).toContain("TextPath as KTextPath");
  });
});
