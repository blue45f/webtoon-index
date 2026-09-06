import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly exportedDeclarations: ReadonlySet<string>;
  readonly source: string;
  readonly topLevelDeclarations: ReadonlySet<string>;
  readonly valueImports: readonly string[];
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
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportedDeclarations.add(name);
    }
  }

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      allImports.push(statement.moduleSpecifier.text);
      if (!statement.importClause?.isTypeOnly) {
        valueImports.push(statement.moduleSpecifier.text);
      }
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
    source,
    topLevelDeclarations,
    valueImports,
  };
}

describe("Studio options-bars module boundary", () => {
  it("keeps StudioPage as the one-way static orchestration owner", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const editorView = moduleShape("./studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx");
    const optionsBars = moduleShape("./StudioOptionsBars.tsx");

    expect(
      page.allImports.filter((specifier) => specifier === "./StudioOptionsBars")
    ).toEqual(["./StudioOptionsBars"]);
    expect(page.dynamicImports).not.toContain("./StudioOptionsBars");
    expect(optionsBars.allImports).not.toContain("./StudioPage");
    expect(optionsBars.dynamicImports).not.toContain("./StudioPage");
    expect(page.source).toContain("useStudioStableHandlers<StudioOptionsBarsHandlers>({");
    expect(page.source).toContain("useMemo<StudioOptionsBarsDrawModel>(");
    expect(page.source).toContain("useMemo<StudioOptionsBarsSelectionModel>(() =>");
    expect(page.source).toContain("const selectionOptionsSuppressed =");
    expect(page.source).toContain("!selectionOptionsSuppressed");
    expect(editorView.source).toContain("<StudioOptionsBars");
  });

  it("moves the component and presentation contracts out of the page monolith", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const optionsBars = moduleShape("./StudioOptionsBars.tsx");

    for (const declaration of [
      "StudioOptionsBars",
      "StudioOptionsBarsDrawModel",
      "StudioOptionsBarsHandlers",
      "StudioOptionsBarsProps",
      "StudioOptionsBarsSelectionModel",
    ]) {
      expect(optionsBars.exportedDeclarations.has(declaration)).toBe(true);
      expect(page.topLevelDeclarations.has(declaration)).toBe(false);
    }
  });

  it("keeps the extracted module presentation-only and independent from canvas runtimes", () => {
    const optionsBars = moduleShape("./StudioOptionsBars.tsx");

    expect(optionsBars.valueImports).toEqual([
      "react",
      "./brush/studio-draw-color-swatches",
      "./studio-page-lazy-ui",
      "@/src/hooks/use-media-query",
    ]);
    expect(optionsBars.allImports).not.toContain("konva");
    expect(optionsBars.allImports).not.toContain("react-konva");
    expect(optionsBars.allImports).not.toContain("@/src/hooks/use-resizable");
    expect(optionsBars.source).not.toContain("localStorage");
    expect(optionsBars.source).not.toContain("saveStudioBrushSlotsState");
    expect(optionsBars.source).not.toContain("saveStudioProDrawPrefs");
    expect(optionsBars.source).not.toContain("studioProDrawStorage");
    expect(optionsBars.source).not.toContain("lazyRetry(");
    expect(optionsBars.dynamicImports).toEqual([]);
  });

  it("preserves the two literal lazy targets and layout-neutral Suspense fallbacks", () => {
    const optionsBars = moduleShape("./StudioOptionsBars.tsx");
    const registry = moduleShape("./studio-page-lazy-ui.ts");

    expect(
      registry.dynamicImports.filter((specifier) => specifier === "./brush/StudioDrawOptionsBar")
    ).toEqual(["./brush/StudioDrawOptionsBar"]);
    expect(
      registry.dynamicImports.filter((specifier) => specifier === "./StudioSelectOptionsBar")
    ).toEqual(["./StudioSelectOptionsBar"]);
    // 그리기 옵션 바는 도구를 바꿀 때만 스왑되고 그 자리를 예약하는 이웃 스트립이 따로 없어
    // `null` 폴백으로 충분하다. 선택 옵션 바는 다르다 — lazy 청크가 풀리는 한 프레임 동안
    // 44px 레인이 사라지면 그 아래 캔버스가 내려갔다 올라온다(측정된 선택 시 2단계 밀림의
    // 뒷단계). 그래서 선택 쪽 폴백은 바와 **같은 기하**를 붙들고 있어야 한다.
    expect(optionsBars.source.match(/<Suspense fallback=\{null\}>/gu)).toHaveLength(1);
    expect(optionsBars.source).toContain('data-studio-select-options-pending="true"');
    expect(optionsBars.source).toContain("h-11 min-h-11 shrink-0 border-b border-line");
    expect(optionsBars.source).toContain("key={draw.drawMode}");
  });

  it("keeps persistence and stateful option actions in the parent controller", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");

    for (const contract of [
      "assignStudioBrushSlot(prev, index",
      "commitStudioBrushSlotsMutation(",
      "failureMessage: `슬롯 ${index + 1}을 SQLite에 저장하지 못했어요.`,",
      "studioBrushSlotAt(brushSlotsState, index)",
      "loadStudioBrushStudio();",
      "setMobileSheet(",
      "setColor(secondaryColor);",
      "setSecondaryColor(color);",
      "disarmAllPixelTools();",
      "patchEl(selected.id, { locked: !selected.locked });",
      "commitProDrawPrefsMutation(",
    ]) {
      expect(page.source).toContain(contract);
    }
  });
});
