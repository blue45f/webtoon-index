import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly file: ts.SourceFile;
  readonly source: string;
  readonly valueImports: readonly string[];
}

function declarationIsExported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function moduleShape(relativePath: string): ModuleShape {
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
  const exportedDeclarations = new Set<string>();
  const valueImports: string[] = [];

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      allImports.push(statement.moduleSpecifier.text);
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(bindings && ts.isNamespaceImport(bindings))
          || Boolean(
            bindings
            && ts.isNamedImports(bindings)
            && bindings.elements.some((specifier) => !specifier.isTypeOnly),
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(statement.moduleSpecifier.text);
    }
    if (
      (ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement))
      && statement.name
      && declarationIsExported(statement)
    ) {
      exportedDeclarations.add(statement.name.text);
    }
  }

  function visit(node: ts.Node): void {
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

  return { allImports, dynamicImports, exportedDeclarations, file, source, valueImports };
}

function findInterface(shape: ModuleShape, name: string): ts.InterfaceDeclaration {
  const declaration = shape.file.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (!declaration) throw new Error(`Missing interface ${name}`);
  return declaration;
}

function propertyNames(members: ts.NodeArray<ts.TypeElement>): string[] {
  return members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.name) return [];
    return [member.name.getText()];
  });
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
  visit(shape.file);
  if (!match) throw new Error(`Missing ${name} JSX call site`);
  return match;
}

function jsxAttributes(node: ts.JsxSelfClosingElement): Map<string, string | null> {
  return new Map(node.attributes.properties.flatMap((property) => {
    if (!ts.isJsxAttribute(property)) return [];
    return [[property.name.getText(), property.initializer?.getText() ?? null] as const];
  }));
}

const INTERACTION_PROPS = [
  "draggable",
  "innerRef",
  "onSelect",
  "onEdit",
  "onPatch",
  "dragBoundFunc",
  "onInteractionBegin",
  "onInteractionEnd",
  "onCommitTransform",
] as const;

const PAGE_PROPS = ["key", "el", ...INTERACTION_PROPS] as const;

describe("Studio Konva lettering node boundary", () => {
  it("moves text, text-path, and sticker rendering out of StudioPage", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const nodes = moduleShape("../StudioKonvaTextNodes.tsx");

    expect(
      viewport.valueImports.filter((specifier) => specifier === "../StudioKonvaTextNodes"),
    ).toEqual(["../StudioKonvaTextNodes"]);
    expect(viewport.source.match(/<StudioKonvaTextNode\b/gu)).toHaveLength(1);
    expect(viewport.source.match(/<StudioKonvaStickerNode\b/gu)).toHaveLength(1);
    expect(viewport.source).not.toContain("<KTextPath");
    expect(viewport.source).not.toContain("textNodeProps<Partial<El>>");
    expect(viewport.source).not.toContain("buildTextPathData(");
    expect(viewport.source).not.toMatch(/el\.type === "text"\s*&&\s*el\.textPath/u);
    expect(nodes.exportedDeclarations).toEqual(new Set([
      "StudioTextTransformOptions",
      "StudioKonvaTextNodeProps",
      "StudioKonvaStickerNodeProps",
      "StudioKonvaTextNode",
      "StudioKonvaStickerNode",
    ]));
  });

  it("moves the complete bubble renderer behind one clipped Page call site", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const bubbleNode = moduleShape("../StudioKonvaBubbleNode.tsx");

    expect(
      viewport.valueImports.filter((specifier) => specifier === "../StudioKonvaBubbleNode"),
    ).toEqual(["../StudioKonvaBubbleNode"]);
    expect(viewport.source.match(/<StudioKonvaBubbleNode\b/gu)).toHaveLength(1);
    expect(viewport.source).not.toContain("const avgSize = (el.width + el.height) / 2;");
    expect(viewport.source).not.toContain("const tailHandle =");
    expect(viewport.source).not.toContain("bubblePathData(el.width");
    expect(viewport.source).not.toContain("fitBubbleFontSize(");
    expect(bubbleNode.exportedDeclarations).toEqual(new Set([
      "StudioKonvaBubbleNodeProps",
      "StudioKonvaBubbleNode",
    ]));
  });

  it("locks the shared interaction contract, Extract element types, and both Page call sites", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const nodes = moduleShape("../StudioKonvaTextNodes.tsx");

    expect(propertyNames(findInterface(nodes, "StudioKonvaTextInteractionProps").members)).toEqual(
      INTERACTION_PROPS,
    );
    expect(propertyNames(findInterface(nodes, "StudioKonvaTextNodeProps").members)).toEqual(["el"]);
    expect(propertyNames(findInterface(nodes, "StudioKonvaStickerNodeProps").members)).toEqual(["el"]);
    expect(nodes.source).toContain('el: Extract<El, { type: "text" }>;');
    expect(nodes.source).toContain('el: Extract<El, { type: "sticker" }>;');

    for (const name of ["StudioKonvaTextNode", "StudioKonvaStickerNode"] as const) {
      const attributes = jsxAttributes(findJsx(viewport, name));
      expect([...attributes.keys()]).toEqual(PAGE_PROPS);
      expect(attributes.get("el")).toBe("{el}");
      expect(attributes.get("draggable")).toBe("{draggable}");
      expect(attributes.get("innerRef")).toBe("{setRef}");
      expect(attributes.get("onSelect")).toBe("{onSelect}");
      expect(attributes.get("onEdit")).toBe("{startEditText}");
      expect(attributes.get("onPatch")).toBe("{patchElementAfterDragRestore}");
      expect(attributes.get("dragBoundFunc")).toBe("{snapBoundFunc}");
      expect(attributes.get("onInteractionBegin")).toContain("nodeInteractionBegin(el.id)");
      expect(attributes.get("onInteractionEnd")).toBe("{endLiveResourceEdit}");
      expect(attributes.get("onCommitTransform")).toBe("{commitTextTransformEnd}");
    }
  });

  it("keeps the module one-way, statically light, and independent from SFX authoring catalogs", () => {
    const nodes = moduleShape("../StudioKonvaTextNodes.tsx");

    expect(nodes.valueImports).toEqual([
      "react-konva/lib/ReactKonvaCore",
      "./lettering/studio-bubble-text-runtime",
      // Shared horizontal + vertical-rl ruby overlay planners.
      "./lettering/studio-dialogue-ruby-layout",
      "./lettering/studio-text-path",
      "./studio-gradient-engine",
      "./studio-node-props",
      "./studio-skew",
    ]);
    expect(nodes.allImports).toContain("./studio-element-model");
    expect(nodes.allImports).toContain("konva");
    expect(nodes.allImports).not.toContain("./StudioPage");
    expect(nodes.allImports).not.toContain("./studio-sfx-presets");
    expect(nodes.allImports).not.toContain("react-router-dom");
    expect(nodes.allImports.some((specifier) => /(?:crdt|collaboration|gpu)/u.test(specifier))).toBe(false);
    expect(nodes.source).toContain('import type { El } from "./studio-element-model";');
    expect(nodes.source).toContain('import type Konva from "konva";');
    expect(nodes.source).not.toContain('from "konva/lib/Core"');
  });

  it("locks the minimal bubble props and resolves the live draft at the Page boundary", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const bubbleNode = moduleShape("../StudioKonvaBubbleNode.tsx");
    const expectedProps = [
      "el",
      "theme",
      "customShapeDraftPoints",
      "selected",
      "exporting",
      "effectiveScale",
      "draggable",
      "innerRef",
      "dragBoundFunc",
      "onSelect",
      "onEdit",
      "onChange",
      "onInteractionBegin",
      "onInteractionEnd",
    ];

    expect(propertyNames(findInterface(bubbleNode, "StudioKonvaBubbleNodeProps").members)).toEqual(
      expectedProps,
    );
    expect(bubbleNode.source).toContain('el: Extract<El, { type: "bubble" }>;');
    const attributes = jsxAttributes(findJsx(viewport, "StudioKonvaBubbleNode"));
    expect([...attributes.keys()]).toEqual(["key", ...expectedProps]);
    expect(attributes.get("el")).toBe("{el}");
    expect(attributes.get("theme")).toBe("{webtoonTheme}");
    expect(attributes.get("customShapeDraftPoints")).toContain(
      "bubbleShapeDraft?.elId === el.id ? bubbleShapeDraft.points : undefined",
    );
    expect(attributes.get("selected")).toBe("{selectedId === el.id}");
    expect(attributes.get("exporting")).toBe("{isExporting}");
    expect(attributes.get("effectiveScale")).toBe("{effScale}");
    expect(attributes.get("draggable")).toBe("{draggable}");
    expect(attributes.get("innerRef")).toBe("{setRef}");
    expect(attributes.get("dragBoundFunc")).toBe("{snapBoundFunc}");
    expect(attributes.get("onSelect")).toBe("{onSelect}");
    expect(attributes.get("onEdit")).toContain("startEditText(el.id)");
    expect(attributes.get("onChange")).toContain("patchElementAfterDragRestore(el.id, patch)");
    expect(attributes.get("onInteractionBegin")).toContain("nodeInteractionBegin(el.id)");
    expect(attributes.get("onInteractionEnd")).toBe("{endLiveResourceEdit}");
  });

  it("keeps bubble rendering one-way and shares the collaboration interaction guards", () => {
    const bubbleNode = moduleShape("../StudioKonvaBubbleNode.tsx");

    expect(bubbleNode.dynamicImports).toEqual([]);
    expect(bubbleNode.valueImports).toEqual([
      "react-konva/lib/ReactKonvaCore",
      "./brush/studio-stroke-shapes",
      "./lettering/studio-bubble-custom-shape",
      // 의도적 변경(2026-07-24): 말풍선 손그림 외곽선(rough/wobbly) 스타일 엔진 도입.
      "./lettering/studio-bubble-outline-style",
      "./lettering/studio-bubble-path",
      "./lettering/studio-bubble-text-fit",
      "./lettering/studio-bubble-text-runtime",
      // Shared horizontal + vertical-rl ruby overlay planners.
      "./lettering/studio-dialogue-ruby-layout",
      "./studio-gradient-engine",
      "./studio-node-props",
    ]);
    expect(bubbleNode.allImports).toContain("./studio-element-model");
    expect(bubbleNode.allImports).toContain("konva");
    expect(bubbleNode.allImports).not.toContain("../StudioPage");
    expect(bubbleNode.allImports).toContain("./studio-node-props");
    expect(bubbleNode.allImports).not.toContain("react-router-dom");
    expect(bubbleNode.allImports.some((specifier) => /(?:crdt|collaboration|gpu)/u.test(specifier))).toBe(false);
    expect(bubbleNode.source).toContain('import type { El } from "./studio-element-model";');
    expect(bubbleNode.source).toContain('import type Konva from "konva";');
    expect(bubbleNode.source).not.toContain('from "konva/lib/Core"');
    expect(bubbleNode.source).toContain("computeBubbleShapeGeometry");
    expect(bubbleNode.source).not.toContain("const automaticTailBase =");
    expect(bubbleNode.source).not.toContain("const tailIsVertical =");
    expect(bubbleNode.source).toContain("withStudioNodeInteractionGuards");
    expect(bubbleNode.source).toContain("onInteractionBegin");
    expect(bubbleNode.source).toContain("onInteractionEnd");
    expect(bubbleNode.source).toContain("const bTailLen =");
    expect(bubbleNode.source).toContain("const tailHandle = selected && showTail && !exporting && !showCustomShape");
    expect(bubbleNode.source).toContain("const w = Math.max(60, el.width * node.scaleX());");
    expect(bubbleNode.source).toContain("const h = Math.max(50, el.height * node.scaleY());");
  });

  it("keeps the transform commit and unconditional live-lock release in the parent", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const nodes = moduleShape("../StudioKonvaTextNodes.tsx");

    expect(page.source).toContain("function commitTextTransformEnd(");
    expect(page.source).toMatch(
      /function commitTextTransformEnd\([\s\S]*?try \{[\s\S]*?patchEl\(elId, patch\);[\s\S]*?finally \{\s*endLiveResourceEdit\(\);\s*\}/u,
    );
    expect(nodes.source).not.toContain("function commitTextTransformEnd(");
    expect(nodes.source).toContain("onCommitTransform(el.id, el.fontSize, event, { minFontSize: 10 })");
    expect(nodes.source).toContain("{ minFontSize: 10, patchWidth: true }");
    expect(nodes.source).toContain("onCommitTransform(el.id, el.fontSize, event, { minFontSize: 16 })");
  });

  it("paints horizontal and vertical-rl ruby overlays in both product lettering mounts", () => {
    const nodes = moduleShape("../StudioKonvaTextNodes.tsx");
    const bubbleNode = moduleShape("../StudioKonvaBubbleNode.tsx");
    const layout = moduleShape("../lettering/studio-dialogue-ruby-layout.ts");

    // Layout planner is a pure export used by both paint sites (not reimplemented in nodes).
    expect(layout.exportedDeclarations.has("planDialogueRubyOverlayPlacements")).toBe(true);
    expect(layout.exportedDeclarations.has("planDialogueVerticalRubyOverlayPlacements")).toBe(true);
    expect(layout.exportedDeclarations.has("planDialogueRubyRuns")).toBe(true);

    expect(nodes.valueImports).toContain("./lettering/studio-dialogue-ruby-layout");
    expect(nodes.source).toContain("readDialogueRubySpans(");
    expect(nodes.source).toContain("planDialogueRubyOverlayPlacements(");
    expect(nodes.source).toContain("planDialogueVerticalRubyOverlayPlacements(");
    expect(nodes.source).toContain('name="studio-vertical-ruby"');
    expect(nodes.source).toMatch(/rubyOverlays\.length\s*>\s*0/u);

    expect(bubbleNode.valueImports).toContain("./lettering/studio-dialogue-ruby-layout");
    expect(bubbleNode.source).toContain("readDialogueRubySpans(");
    expect(bubbleNode.source).toContain("planDialogueRubyOverlayPlacements(");
    expect(bubbleNode.source).toContain("planDialogueVerticalRubyOverlayPlacements(");
    expect(bubbleNode.source).toContain('name="studio-vertical-ruby"');
    expect(bubbleNode.source).not.toMatch(
      /const rubySpans = !el\.vertical\s*\?\s*readDialogueRubySpans\(/u,
    );
    expect(bubbleNode.source).not.toContain("planDialogueRubyRuns(");
    expect(nodes.source).not.toContain("planDialogueRubyRuns(");
    // Ruby overlays never capture pointer hits; the parent group owns selection/edit transforms.
    expect(nodes.source).toMatch(/name="studio-vertical-ruby"[\s\S]*?listening=\{false\}/u);
    expect(bubbleNode.source).toMatch(/name="studio-vertical-ruby"[\s\S]*?listening=\{false\}/u);
  });
});
