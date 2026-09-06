import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ParsedModule {
  readonly file: ts.SourceFile;
  readonly source: string;
}

interface NamedReExport {
  readonly names: readonly string[];
  readonly specifier: string;
}

const PROOF_ENTRY_SPECIFIER =
  "../domains/creator/bg3d/studio-bg3d-magic-production-proof";
const PROOF_ENTRY_FILE_NAME = "./studio-bg3d-magic-production-proof.ts";
const PROOF_LOADER_NAME =
  "loadStudioBg3dMagicProductionProofFromExplicitDiagnosticQuery";

function parseModule(fileName: string): ParsedModule {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  return {
    file: ts.createSourceFile(
      fileUrl.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    source,
  };
}

function dynamicImports(file: ts.SourceFile): readonly ts.CallExpression[] {
  const imports: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function functionName(node: ts.FunctionLikeDeclaration | null): string | null {
  if (!node) return null;
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  if (
    (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return null;
}

function namedReExports(file: ts.SourceFile): readonly NamedReExport[] {
  return file.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [];
    }
    return [{
      names: statement.exportClause.elements.map((element) => element.name.text),
      specifier: statement.moduleSpecifier.text,
    }];
  });
}

describe("Studio BG3D Magic production proof boundary", () => {
  it("re-exports only the exact shipped Magic product helpers", () => {
    const { file } = parseModule(PROOF_ENTRY_FILE_NAME);

    expect(namedReExports(file)).toEqual([
      {
        names: ["applyStudioBg3dCaptureFrameViewOffset"],
        specifier: "./studio-bg3d-capture-frame-view-offset",
      },
      {
        names: ["encodeStudioBg3dLtLayers"],
        specifier: "./studio-bg3d-lt-layer-encoder",
      },
      {
        names: ["captureStudioBg3dMagicObjectIds"],
        specifier: "./studio-bg3d-magic-object-id-capture",
      },
      {
        names: ["createStudioBg3dRuntimeSnapshot"],
        specifier: "./studio-bg3d-runtime-adapter",
      },
    ]);
    expect(dynamicImports(file)).toEqual([]);
  });

  it("emits one literal Vite lazy entry behind an explicit production diagnostic query", () => {
    const { file, source } = parseModule("../../../app/main.tsx");
    const proofImports = dynamicImports(file).filter((node) => (
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === PROOF_ENTRY_SPECIFIER
    ));

    expect(proofImports).toHaveLength(1);
    expect(functionName(enclosingFunction(proofImports[0]!))).toBe(PROOF_LOADER_NAME);
    expect(source).toContain('const STUDIO_BG3D_MAGIC_PRODUCTION_PROOF_QUERY =');
    expect(source).toContain('"__studioBg3dMagicProductionProof"');
    expect(source).toContain("if (!import.meta.env.PROD) return;");
    expect(source).toContain("new URLSearchParams(globalThis.location.search)");
    expect(source).toContain(
      'if (search.get(STUDIO_BG3D_MAGIC_PRODUCTION_PROOF_QUERY) !== "1") return;',
    );
    expect(source).toContain(`${PROOF_LOADER_NAME}();`);
  });

  it("keeps the proof entry out of every BG3D modal, preload, and capture path", () => {
    const forbiddenProductPaths = [
      "./StudioBackground3D.tsx",
      "../StudioInspectorAside.tsx",
      "../StudioLazyPanelStack.tsx",
      "../StudioThreeDPreviewPanelStack.tsx",
      "../studio-background-3d-loader.ts",
      "../studio-page-lazy-ui.ts",
    ] as const;

    for (const fileName of forbiddenProductPaths) {
      const { source } = parseModule(fileName);
      expect(
        source,
        `${fileName} must not own or preload the production proof entry`,
      ).not.toContain("studio-bg3d-magic-production-proof");
    }
  });
});
