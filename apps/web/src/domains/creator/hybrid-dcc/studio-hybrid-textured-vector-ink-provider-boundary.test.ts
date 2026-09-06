import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleAnalysis {
  readonly source: string;
  readonly file: ts.SourceFile;
  readonly staticImports: readonly string[];
  readonly runtimeStaticImports: readonly string[];
  readonly typeOnlyStaticImports: readonly string[];
  readonly dynamicImports: readonly string[];
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
  const typeOnlyStaticImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      staticImports.push(specifier);
      const clause = node.importClause;
      if (clause?.isTypeOnly) {
        typeOnlyStaticImports.push(specifier);
      } else {
        const bindings = clause?.namedBindings;
        const hasRuntimeValue = !clause || Boolean(clause.name)
          || Boolean(bindings && ts.isNamespaceImport(bindings))
          || Boolean(
            bindings
            && ts.isNamedImports(bindings)
            && bindings.elements.some((element) => !element.isTypeOnly),
          );
        if (hasRuntimeValue) runtimeStaticImports.push(specifier);
      }
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
  return {
    source,
    file,
    staticImports,
    runtimeStaticImports,
    typeOnlyStaticImports,
    dynamicImports,
  };
}

function interfaceText(
  analysis: ModuleAnalysis,
  name: string,
): string {
  let declaration: ts.InterfaceDeclaration | undefined;
  analysis.file.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      declaration = node;
    }
  });
  expect(declaration, `${name} must remain an explicit interface`).toBeDefined();
  return declaration!.getText(analysis.file);
}

const provider = analyze(
  "./studio-hybrid-textured-vector-ink-provider.ts",
);

describe("Studio hybrid textured-vector ink provider source boundary", () => {
  it("uses the existing vector-ink artifact only as a type-level input authority", () => {
    expect(provider.typeOnlyStaticImports).toEqual([
      "../studio-vector-ink-geometry",
    ]);
    expect(provider.runtimeStaticImports).toEqual(["../studio-sha256"]);
    expect(provider.dynamicImports).toEqual([]);
    expect(provider.source).toContain(
      "geometry: StudioVectorInkGeometryArtifact",
    );
    expect(provider.source).toContain(
      'centerlineAuthority: "studio-vector-ink-geometry"',
    );
  });

  it("keeps all R8 assets and renderer outputs plain, hashed, and handle-free", () => {
    const asset = interfaceText(
      provider,
      "StudioHybridTexturedVectorInkR8Asset",
    );
    const station = interfaceText(
      provider,
      "StudioHybridTexturedVectorInkStation",
    );
    const plan = interfaceText(
      provider,
      "StudioHybridTexturedVectorInkPlan",
    );
    for (const declaration of [asset, station, plan]) {
      expect(declaration).not.toMatch(/\bunknown\b/u);
      expect(declaration).not.toMatch(/\bhandle\b/iu);
      expect(declaration).not.toMatch(/\bCanvas\w*\b/u);
      expect(declaration).not.toMatch(/\bKonva\w*\b/u);
    }
    expect(asset).toContain('encoding: "r8-unorm"');
    expect(asset).toContain("pixels: readonly number[]");
    expect(asset).toContain("hash: `sha256:${string}`");
    expect(plan).toContain(
      "stations: readonly StudioHybridTexturedVectorInkStation[]",
    );
    expect(provider.source).toContain("freezeDeep({");
  });

  it("contains no framework, canvas, renderer, network, or server edge", () => {
    expect(
      provider.staticImports.filter((specifier) =>
        /^(?:react|react-dom|react-konva|konva)(?:\/|$)/u.test(specifier)
      ),
    ).toEqual([]);
    expect(
      provider.staticImports.filter((specifier) => specifier.startsWith("node:")),
    ).toEqual([]);
    expect(provider.source).not.toMatch(/\b(?:Canvas|OffscreenCanvas)\b/u);
    expect(provider.source).not.toMatch(/\b(?:WebGL|WebGPU)\b/u);
    expect(provider.source).not.toMatch(/\b(?:DOMParser|ImageBitmap)\b/u);
    expect(provider.source).not.toMatch(/\b(?:fetch|XMLHttpRequest)\s*\(/u);
    expect(provider.source).not.toMatch(/\b(?:window|document)\./u);
    expect(provider.source).not.toMatch(/from\s+["'][^"']+\.tsx["']/u);
  });

  it("locks deterministic transform regeneration, quality, and lineage contracts", () => {
    expect(provider.source).toContain(
      '"deterministic-from-centerline-v1"',
    );
    expect(provider.source).toContain('"document-space-repeat-r8-v1"');
    expect(provider.source).toContain('"seeded-station-stamp-r8-v1"');
    expect(provider.source).toContain('resampleQuality: "target-met"');
    expect(provider.source).toContain("rebuild-v1");
    expect(provider.source).toContain("append-v1");
    expect(provider.source).toContain("replay-v1");
    expect(provider.source).toContain("maxWorkUnits");
    expect(provider.source).toContain("maxStations");
    expect(provider.source).toContain("maxOutputBytesEstimate");
    expect(provider.source).toContain(
      '"current-space-chord-gap-not-raster-coverage"',
    );
    expect(provider.source).toContain(
      '"append-lineage-uses-full-deterministic-replan"',
    );
  });
});
