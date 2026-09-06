import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleAnalysis {
  readonly source: string;
  readonly file: ts.SourceFile;
  readonly staticImports: readonly string[];
  readonly runtimeStaticImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly topLevelDynamicImports: readonly string[];
}

function analyze(relativePath: string): ModuleAnalysis {
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
      const bindings = clause?.namedBindings;
      const hasRuntimeValue = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || Boolean(bindings && ts.isNamespaceImport(bindings))
          || Boolean(
            bindings
            && ts.isNamedImports(bindings)
            && bindings.elements.some((element) => !element.isTypeOnly)
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
    source,
    file,
    staticImports,
    runtimeStaticImports,
    dynamicImports,
    topLevelDynamicImports,
  };
}

function interfaceSource(
  analysis: ModuleAnalysis,
  interfaceName: string,
): string {
  let match: ts.InterfaceDeclaration | undefined;
  analysis.file.forEachChild((node) => {
    if (
      ts.isInterfaceDeclaration(node)
      && node.name.text === interfaceName
    ) {
      match = node;
    }
  });
  expect(match, `${interfaceName} must remain an explicit interface`).toBeDefined();
  return match!.getText(analysis.file);
}

const bvh = analyze("../studio-three-mesh-bvh-provider.ts");
const gltf = analyze("../studio-gltf-transform-provider.ts");
const manifold = analyze("../studio-manifold-mesh-provider.ts");
const productionModules = [bvh, gltf, manifold];

describe("Studio 3D specialist provider source boundary", () => {
  it("keeps Three injected and loads only three-mesh-bvh behind its literal loader", () => {
    expect(bvh.runtimeStaticImports).not.toContain("three");
    expect(bvh.runtimeStaticImports).not.toContain("three-mesh-bvh");
    expect(bvh.dynamicImports).toEqual(["three-mesh-bvh"]);
    expect(bvh.topLevelDynamicImports).toEqual([]);
    expect(bvh.source).toContain('await import("three-mesh-bvh")');
  });

  it("uses browser WebIO with Khronos extensions and literal lazy transform imports", () => {
    expect(gltf.runtimeStaticImports).not.toContain("@gltf-transform/core");
    expect(gltf.runtimeStaticImports).not.toContain(
      "@gltf-transform/extensions",
    );
    expect(gltf.runtimeStaticImports).not.toContain(
      "@gltf-transform/functions",
    );
    expect(gltf.dynamicImports).toEqual([
      "@gltf-transform/core",
      "@gltf-transform/extensions",
      "@gltf-transform/functions",
    ]);
    expect(gltf.topLevelDynamicImports).toEqual([]);
    expect(gltf.source).toContain("new core.WebIO()");
    expect(gltf.source).toContain(
      ".registerExtensions(extensions.KHRONOS_EXTENSIONS)",
    );
    expect(gltf.source).not.toMatch(/\bNodeIO\b/u);
    expect(gltf.source).not.toMatch(/\bsharp\b/u);
  });

  it("loads Manifold glue and its WASM URL only behind the literal loader", () => {
    expect(manifold.runtimeStaticImports).not.toContain("manifold-3d");
    expect(manifold.dynamicImports).toEqual([
      "manifold-3d",
      "manifold-3d/manifold.wasm?url",
    ]);
    expect(manifold.topLevelDynamicImports).toEqual([]);
    expect(manifold.source).toContain(
      'import("manifold-3d/manifold.wasm?url")',
    );
    expect(manifold.source).toContain("module.setup()");
  });

  it("keeps public receipts plain and free of opaque vendor handles", () => {
    const publicReceipts = [
      interfaceSource(bvh, "StudioThreeMeshBvhBuildReceipt"),
      interfaceSource(bvh, "StudioThreeMeshBvhHitArtifact"),
      interfaceSource(bvh, "StudioThreeMeshBvhCandidateArtifact"),
      interfaceSource(gltf, "StudioGltfTransformReceipt"),
      interfaceSource(manifold, "StudioManifoldMeshReceipt"),
      interfaceSource(manifold, "StudioManifoldPlainMesh"),
    ];
    for (const receipt of publicReceipts) {
      expect(receipt).not.toMatch(/\bunknown\b/u);
      expect(receipt).not.toMatch(/\bDocument\b/u);
      expect(receipt).not.toMatch(/\bMeshBVH\b/u);
      expect(receipt).not.toMatch(/\bManifoldHandle\b/u);
    }
  });

  it("contains no UI, legacy canvas, DOM-parser, or server-runtime edge", () => {
    const moduleSpecifiers = productionModules.flatMap((analysis) => [
      ...analysis.staticImports,
      ...analysis.dynamicImports,
    ]);
    expect(
      moduleSpecifiers.filter((specifier) =>
        /^(?:react|react-dom|react-konva|konva)(?:\/|$)/u.test(specifier)
      ),
    ).toEqual([]);
    expect(
      moduleSpecifiers.filter((specifier) => specifier.startsWith("node:")),
    ).toEqual([]);
    for (const analysis of productionModules) {
      expect(analysis.source).not.toMatch(/\bDOMParser\b/u);
      expect(analysis.source).not.toMatch(/\bDOMException\b/u);
      expect(analysis.source).not.toMatch(/\bwindow\./u);
      expect(analysis.source).not.toMatch(/from\s+["'][^"']+\.tsx["']/u);
    }
  });
});
