import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleEdges {
  readonly staticImports: readonly string[];
  readonly runtimeStaticImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly topLevelDynamicImports: readonly string[];
  readonly source: string;
}

function moduleEdges(relativePath: string): ModuleEdges {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const staticImports: string[] = [];
  const runtimeStaticImports: string[] = [];
  const dynamicImports: string[] = [];
  const topLevelDynamicImports: string[] = [];

  function insideFunction(node: ts.Node): boolean {
    let parent = node.parent;
    while (parent) {
      if (
        ts.isFunctionDeclaration(parent)
        || ts.isFunctionExpression(parent)
        || ts.isArrowFunction(parent)
        || ts.isMethodDeclaration(parent)
      ) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      staticImports.push(specifier);
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
      if (hasRuntimeValue) runtimeStaticImports.push(specifier);
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      dynamicImports.push(specifier);
      if (!insideFunction(node)) topLevelDynamicImports.push(specifier);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return {
    staticImports,
    runtimeStaticImports,
    dynamicImports,
    topLevelDynamicImports,
    source,
  };
}

const harfbuzz = moduleEdges("../studio-harfbuzz-shaping-provider.ts");
const resvg = moduleEdges("../studio-resvg-svg-provider.ts");
const registry = moduleEdges("../render/studio-wasm-provider-registry.ts");
const productionModules = [harfbuzz, resvg, registry];

describe("Studio text and SVG WASM provider source boundary", () => {
  it("loads HarfBuzz JS glue only behind the literal lazy loader", () => {
    expect(harfbuzz.runtimeStaticImports).not.toContain("harfbuzzjs");
    expect(harfbuzz.dynamicImports).toEqual(["harfbuzzjs"]);
    expect(harfbuzz.topLevelDynamicImports).toEqual([]);
    expect(harfbuzz.source).toContain(
      'const hb = await import("harfbuzzjs");',
    );
  });

  it("loads resvg JS glue and its binary only behind the literal lazy loader", () => {
    expect(resvg.runtimeStaticImports).not.toContain("@resvg/resvg-wasm");
    expect(resvg.runtimeStaticImports).not.toContain(
      "@resvg/resvg-wasm/index_bg.wasm?url",
    );
    expect(resvg.dynamicImports).toEqual([
      "@resvg/resvg-wasm",
      "@resvg/resvg-wasm/index_bg.wasm?url",
    ]);
    expect(resvg.topLevelDynamicImports).toEqual([]);
    expect(resvg.source).toContain(
      'import("@resvg/resvg-wasm/index_bg.wasm?url")',
    );
  });

  it("keeps the neutral registry free of engine imports and eager initialization", () => {
    expect(registry.dynamicImports).toEqual([]);
    expect(registry.runtimeStaticImports).toEqual([]);
    expect(registry.source).not.toContain("WebAssembly.instantiate");
    expect(registry.source).not.toContain("initWasm(");
  });

  it("contains no legacy canvas-library module edge in any provider module", () => {
    const moduleSpecifiers = productionModules.flatMap((module) => [
      ...module.staticImports,
      ...module.dynamicImports,
    ]);
    expect(
      moduleSpecifiers.filter((specifier) =>
        /^(?:react-)?konva(?:\/|$)/u.test(specifier)
      ),
    ).toEqual([]);
  });

  it("keeps UI and framework modules outside the portable provider graph", () => {
    const runtimeImports = productionModules.flatMap(
      ({ runtimeStaticImports }) => runtimeStaticImports,
    );
    expect(runtimeImports).not.toContain("react");
    expect(runtimeImports).not.toContain("react-dom");
    expect(
      runtimeImports.some((specifier) => specifier.endsWith(".tsx")),
    ).toBe(false);
  });
});
