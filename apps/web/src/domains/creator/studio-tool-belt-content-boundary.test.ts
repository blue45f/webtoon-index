import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly file: ts.SourceFile;
  readonly source: string;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly valueImports: readonly string[];
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
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const exportedDeclarations = new Set<string>();
  const topLevelDeclarations = new Set<string>();
  const valueImports: string[] = [];

  function rememberDeclaration(name: string, node: ts.Node): void {
    topLevelDeclarations.add(name);
    if (declarationIsExported(node)) exportedDeclarations.add(name);
  }

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
            && bindings.elements.some((specifier) => !specifier.isTypeOnly)
          )
        )
      );
      if (hasRuntimeValue) valueImports.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
    ) {
      if (statement.name) rememberDeclaration(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          rememberDeclaration(declaration.name.text, statement);
        }
      }
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

  return {
    allImports,
    dynamicImports,
    exportedDeclarations,
    file,
    source,
    topLevelDeclarations,
    valueImports,
  };
}

function findInterface(shape: ModuleShape, name: string): ts.InterfaceDeclaration {
  const declaration = shape.file.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name
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

function findVariable(shape: ModuleShape, name: string): ts.VariableDeclaration {
  let match: ts.VariableDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(shape.file);
  if (!match) throw new Error(`Missing variable ${name}`);
  return match;
}

function objectPropertyNames(object: ts.ObjectLiteralExpression): string[] {
  return object.properties.flatMap((property) => {
    if (
      ts.isPropertyAssignment(property)
      || ts.isShorthandPropertyAssignment(property)
      || ts.isMethodDeclaration(property)
    ) {
      return [property.name.getText()];
    }
    return [];
  });
}

function findToolBeltJsxAttributes(shape: ModuleShape): string[] {
  let attributes: string[] | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isJsxSelfClosingElement(node)
      && ts.isIdentifier(node.tagName)
      && node.tagName.text === "StudioToolBeltContent"
    ) {
      attributes = node.attributes.properties.flatMap((property) =>
        ts.isJsxAttribute(property) ? [property.name.getText()] : []
      );
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(shape.file);
  if (!attributes) throw new Error("Missing StudioToolBeltContent JSX call site");
  return attributes;
}

const REPRESENTATIVE_OPTIONAL_SURFACES = [
  "./ai/StudioAiAssistHub",
  "./StudioAssetMenuPanel",
  "./StudioBackgroundPanel",
  "./StudioPaletteLibraryPanel",
  "./StudioStockImagePanel",
  "./StudioTonePanel",
] as const;

describe("Studio ToolBelt content module boundary", () => {
  it("keeps StudioPage as the one-way static owner", () => {
    const _page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx");
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");

    expect(
      editorView.valueImports.filter((specifier) => specifier === "../StudioToolBeltContent")
    ).toEqual(["../StudioToolBeltContent"]);
    expect(editorView.source.match(/<StudioToolBeltContent\b/gu)).toHaveLength(1);
    expect(toolBelt.allImports).not.toContain("./StudioPage");
    expect(toolBelt.dynamicImports).not.toContain("./StudioPage");
    expect(toolBelt.source).not.toContain('from "./StudioPage"');
  });

  it("moves the memo component and public contracts out of StudioPage", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");

    for (const declaration of [
      "StudioToolBeltContent",
      "StudioToolBeltContentHandlers",
      "StudioToolBeltContentProps",
    ] as const) {
      expect(toolBelt.exportedDeclarations.has(declaration)).toBe(true);
      expect(page.topLevelDeclarations.has(declaration)).toBe(false);
    }
    expect(toolBelt.source).toContain(
      "export const StudioToolBeltContent = memo(function StudioToolBeltContent("
    );
    expect(toolBelt.source).not.toContain('"use no memo"');
  });

  it("preserves all 73 stable handlers without key drift", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");
    const handlerNames = propertyNames(
      findInterface(toolBelt, "StudioToolBeltContentHandlers").members
    ).toSorted();
    const stableHandlers = findVariable(page, "studioToolBeltContentHandlers");
    expect(stableHandlers.initializer).toBeDefined();
    expect(ts.isCallExpression(stableHandlers.initializer!)).toBe(true);
    const initializer = stableHandlers.initializer as ts.CallExpression;
    expect(initializer.arguments).toHaveLength(1);
    expect(ts.isObjectLiteralExpression(initializer.arguments[0]!)).toBe(true);
    const wiredHandlerNames = objectPropertyNames(
      initializer.arguments[0] as ts.ObjectLiteralExpression
    ).toSorted();

    expect(handlerNames).toHaveLength(75);
    expect(wiredHandlerNames).toHaveLength(75);
    expect(wiredHandlerNames).toEqual(handlerNames);
    expect(page.source).toContain("studioToolBeltContentHandlers={studioToolBeltContentHandlers}");
  });

  // 계약 변경(2026-08, docs/rewrite/ux-audit-v5.md §2.4): 벨트가 disarm+setTool 을 직접 조합하면
  // 진행 중인 획 취소가 이 경로에서만 빠진다. 레일·키보드·컴패니언과 같은 정본 전이를 쓴다.
  it("routes mobile select, pen, and eraser through the stroke-safe primary transition", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx").source;
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx").source;
    const createModeGroups = moduleShape("./StudioToolBeltCreateModeGroups.tsx").source;

    expect(page).toContain("activatePrimaryCanvasTool,");
    expect(toolBelt).toContain(
      'activatePrimaryCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;',
    );
    expect(createModeGroups.match(/activatePrimaryCanvasTool\("select"\)/gu)).toHaveLength(1);
    expect(createModeGroups.match(/activatePrimaryCanvasTool\("draw", "(?:pen|eraser)"\)/gu))
      .toHaveLength(2);
    expect(createModeGroups).not.toContain('setTool("select")');
    expect(createModeGroups).not.toContain('setTool("draw")');
  });

  it("preserves all 207 props at the single Page call site", () => {
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx");
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");
    const propNames = propertyNames(
      findInterface(toolBelt, "StudioToolBeltContentProps").members
    ).toSorted();
    const wiredPropNames = findToolBeltJsxAttributes(editorView).toSorted();

    // 207 = 205 + 캐릭터 셰이퍼 툴 벨트 진입점이 더한 characterShaperOpen/setCharacterShaperOpen.
    expect(propNames).toHaveLength(207);
    expect(wiredPropNames).toHaveLength(207);
    expect(wiredPropNames).toEqual(propNames);
  });

  it("keeps menu ownership and the body-portal dismissal contract in StudioPage", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx").source;
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx").source;
    const createModeGroups = moduleShape("./StudioToolBeltCreateModeGroups.tsx").source;
    const insertTools = moduleShape("./StudioToolBeltCreateModeInsertTools.tsx").source;
    const beltSources = `${toolBelt}\n${createModeGroups}\n${insertTools}`;

    expect(page).toContain("const menuRef = useRef<HTMLDivElement>(null)");
    expect(page).toContain('target.closest("[data-studio-tool-popover]")');
    expect(page).toContain(
      "const activeToolbarGroup: StudioToolbarGroupId | null = resolveStudioToolbarGroup(menu);"
    );
    expect(page).toContain("menuRef={menuRef}");
    expect(beltSources).toContain('id="asset-group"');
    expect(beltSources).toContain('id="bg-group"');
    expect(beltSources).toContain('id="style-group"');
    expect(beltSources).toContain('id="ai-group"');
    expect(beltSources).toContain('id="bubble-menu"');
  });

  it("stays canvas-runtime-free and uses the neutral view helpers", () => {
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");
    const canvasControls = moduleShape("./StudioToolBeltCanvasControls.tsx");
    const viewHelpers = `${toolBelt.source}\n${canvasControls.source}`;

    expect(
      toolBelt.allImports.some((specifier) =>
        specifier === "konva"
        || specifier.startsWith("konva/")
        || specifier.startsWith("react-konva")
        || specifier === "three"
        || specifier.startsWith("three/")
      )
    ).toBe(false);
    expect(viewHelpers).toContain("stepStudioViewZoom");
    expect(viewHelpers).toContain("STUDIO_VIEW_ZOOM_MIN");
    expect(viewHelpers).toContain("STUDIO_VIEW_ZOOM_MAX");
    expect(toolBelt.source).not.toMatch(/\bclampZoom\b/u);
    expect(toolBelt.source).not.toMatch(/\bZOOM_(?:MIN|MAX)\b/u);
  });

  it("loads optional popup leaves only through the neutral lazy registry", () => {
    const toolBelt = moduleShape("./StudioToolBeltContent.tsx");
    const createModeGroups = moduleShape("./StudioToolBeltCreateModeGroups.tsx");
    const registry = moduleShape("./studio-page-lazy-ui.ts");

    expect(createModeGroups.valueImports).toContain("./studio-page-lazy-ui");
    for (const optionalModule of REPRESENTATIVE_OPTIONAL_SURFACES) {
      expect(toolBelt.valueImports).not.toContain(optionalModule);
      expect(toolBelt.dynamicImports).not.toContain(optionalModule);
      expect(createModeGroups.valueImports).not.toContain(optionalModule);
      expect(createModeGroups.dynamicImports).not.toContain(optionalModule);
      expect(registry.valueImports).not.toContain(optionalModule);
      expect(
        registry.dynamicImports.filter((specifier) => specifier === optionalModule)
      ).toEqual([optionalModule]);
    }
  });
});
