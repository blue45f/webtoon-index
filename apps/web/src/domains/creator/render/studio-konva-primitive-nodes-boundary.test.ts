import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly imports: readonly string[];
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly exportedDeclarations: ReadonlySet<string>;
}

function declarationIsExported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function moduleShape(relativePath: string): ModuleShape {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const sourceFile = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  const topLevelDeclarations = new Set<string>();
  const exportedDeclarations = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelDeclarations.add(statement.name.text);
      if (declarationIsExported(statement)) exportedDeclarations.add(statement.name.text);
    }
  }

  return { imports, source, sourceFile, topLevelDeclarations, exportedDeclarations };
}

function findFunction(shape: ModuleShape, name: string): ts.FunctionDeclaration {
  const declaration = shape.sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
  if (!declaration) throw new Error(`Missing function ${name}`);
  return declaration;
}

function componentPropNames(shape: ModuleShape, name: string): string[] {
  const declaration = findFunction(shape, name);
  const parameter = declaration.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name) || !parameter.type || !ts.isTypeLiteralNode(parameter.type)) {
    throw new Error(`Missing inline props contract for ${name}`);
  }
  return parameter.type.members.flatMap((member) => {
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
  visit(shape.sourceFile);
  if (!match) throw new Error(`Missing JSX call for ${name}`);
  return match;
}

function jsxAttributeNames(node: ts.JsxSelfClosingElement): string[] {
  return node.attributes.properties.flatMap((property) =>
    ts.isJsxAttribute(property) ? [property.name.getText()] : []
  );
}

const MOVED_FUNCTIONS = [
  "StudioWorkAssetPlaceholderNode",
  "coverFitRect",
  "StudioFramePanel",
  "StudioFocusLinesNode",
  "StudioSpeedLinesNode",
] as const;

/**
 * Focus/speed-line geometry (`seededRandom` included) no longer lives here: it
 * moved to the renderer-neutral planner so Konva, the Vello/WebGPU lowering,
 * the SVG exporter, and page thumbnails all draw from one source. It must not
 * come back — a second copy is how the four lanes diverged in the first place.
 */
const GEOMETRY_OWNED_BY_PLANNER = ["seededRandom"] as const;

const EXPORTED_COMPONENTS = [
  "StudioWorkAssetPlaceholderNode",
  "StudioFramePanel",
  "StudioFocusLinesNode",
  "StudioSpeedLinesNode",
] as const;

const LEGACY_COMPONENT_NAMES = ["FramePanel", "FocusLinesNode", "SpeedLinesNode"] as const;

const RESIZABLE_PROPS = [
  "el",
  "draggable",
  "innerRef",
  "onSelect",
  "onChange",
  "dragBoundFunc",
  "onInteractionBegin",
  "onInteractionEnd",
] as const;

describe("Studio Konva primitive node boundary", () => {
  it("owns every primitive implementation outside StudioPage", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const primitives = moduleShape("../StudioKonvaPrimitiveNodes.tsx");

    for (const name of MOVED_FUNCTIONS) {
      expect(primitives.topLevelDeclarations.has(name)).toBe(true);
      expect(page.topLevelDeclarations.has(name)).toBe(false);
    }
    for (const name of EXPORTED_COMPONENTS) {
      expect(primitives.exportedDeclarations.has(name)).toBe(true);
    }
    expect(primitives.exportedDeclarations.has("coverFitRect")).toBe(false);
    for (const name of GEOMETRY_OWNED_BY_PLANNER) {
      expect(primitives.topLevelDeclarations.has(name)).toBe(false);
      expect(page.topLevelDeclarations.has(name)).toBe(false);
    }
    for (const name of LEGACY_COMPONENT_NAMES) {
      expect(page.topLevelDeclarations.has(name)).toBe(false);
      expect(viewport.source).not.toMatch(new RegExp(`<${name}\\b`, "u"));
    }
    expect(
      viewport.imports.filter((specifier) => specifier === "../StudioKonvaPrimitiveNodes"),
    ).toEqual(["../StudioKonvaPrimitiveNodes"]);
  });

  it("keeps the module independent from StudioPage and imports Konva only as a type", () => {
    const primitives = moduleShape("../StudioKonvaPrimitiveNodes.tsx");

    expect(primitives.imports).toEqual([
      "react",
      "react-konva/lib/ReactKonvaCore",
      "./render/studio-radial-line-geometry",
      "./studio-node-props",
      "./studio-element-model",
      "./studio-work-asset-render-projection",
      "konva",
    ]);
    expect(primitives.imports).not.toContain("../StudioPage");
    expect(primitives.source).toContain('import type Konva from "konva";');
    expect(primitives.source).not.toContain('from "konva/lib/Core"');
  });

  it("locks the exported component prop contracts and all four Page call sites", () => {
    const viewport = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx");
    const primitives = moduleShape("../StudioKonvaPrimitiveNodes.tsx");

    expect(componentPropNames(primitives, "StudioWorkAssetPlaceholderNode")).toEqual([
      "placeholder",
      "scale",
    ]);
    expect(componentPropNames(primitives, "StudioFramePanel")).toEqual([
      "el",
      "theme",
      ...RESIZABLE_PROPS.slice(1),
    ]);
    expect(componentPropNames(primitives, "StudioFocusLinesNode")).toEqual(RESIZABLE_PROPS);
    expect(componentPropNames(primitives, "StudioSpeedLinesNode")).toEqual(RESIZABLE_PROPS);

    expect(jsxAttributeNames(findJsx(viewport, "StudioWorkAssetPlaceholderNode"))).toEqual([
      "key",
      "placeholder",
      "scale",
    ]);
    expect(jsxAttributeNames(findJsx(viewport, "StudioFramePanel"))).toEqual([
      "key",
      "el",
      "theme",
      ...RESIZABLE_PROPS.slice(1),
    ]);
    expect(jsxAttributeNames(findJsx(viewport, "StudioFocusLinesNode"))).toEqual([
      "key",
      ...RESIZABLE_PROPS,
    ]);
    expect(jsxAttributeNames(findJsx(viewport, "StudioSpeedLinesNode"))).toEqual([
      "key",
      ...RESIZABLE_PROPS,
    ]);
  });

  it("preserves the frame, focus-line, speed-line, and placeholder branch order", () => {
    const source = moduleShape("../canvas/StudioCanvasViewportDocumentLayer.tsx").source;
    const frame = source.indexOf("<StudioFramePanel");
    const focus = source.indexOf("<StudioFocusLinesNode");
    const speed = source.indexOf("<StudioSpeedLinesNode");
    const placeholder = source.indexOf("<StudioWorkAssetPlaceholderNode");

    expect(frame).toBeGreaterThan(0);
    expect(focus).toBeGreaterThan(frame);
    expect(speed).toBeGreaterThan(focus);
    expect(placeholder).toBeGreaterThan(speed);
    expect(source.match(/<StudioFramePanel\b/gu)).toHaveLength(1);
    expect(source.match(/<StudioFocusLinesNode\b/gu)).toHaveLength(1);
    expect(source.match(/<StudioSpeedLinesNode\b/gu)).toHaveLength(1);
    expect(source.match(/<StudioWorkAssetPlaceholderNode\b/gu)).toHaveLength(1);
  });
});
