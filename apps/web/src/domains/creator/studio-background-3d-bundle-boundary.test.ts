import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ParsedModule {
  readonly file: ts.SourceFile;
  readonly source: string;
}

function parseModule(fileName: string): ParsedModule {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return { file, source };
}

function moduleImports(fileName: string) {
  const { file } = parseModule(fileName);
  const valueImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      dynamicImports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { dynamicImports, valueImports };
}

function functionName(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return null;
}

function isFunctionLikeDeclarationNode(
  node: ts.Node,
): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node);
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current = node.parent;
  while (current) {
    if (isFunctionLikeDeclarationNode(current)) return current;
    current = current.parent;
  }
  return null;
}

function hasAncestor(
  node: ts.Node,
  predicate: (candidate: ts.Node) => boolean,
): boolean {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return true;
    current = current.parent;
  }
  return false;
}

describe("Studio background 3D bundle boundary", () => {
  it("does not let the OCCT Node isolation URL glob test sources into production", () => {
    const workerClient = readFileSync(
      new URL("./studio-occt-worker-client.ts", import.meta.url),
      "utf8",
    );
    const bundleCheck = readFileSync(
      new URL("../../../../../scripts/check-studio-bundle.mjs", import.meta.url),
      "utf8",
    );

    expect(workerClient).toContain("const moduleUrl = import.meta.url;");
    expect(workerClient).not.toContain("`./studio-occt-worker-client.${");
    expect(bundleCheck).toContain("production manifest emitted test/source assets");
    expect(bundleCheck).toContain("emittedTestSourceEntries");
  });

  it("keeps the room-builder metadata path independent of Three.js geometry", () => {
    const imports = moduleImports("./bg3d/studio-bg3d-room-builder.ts");

    expect(imports.valueImports).toContain("../studio-id");
    expect(imports.valueImports).not.toContain("./studio-background-3d-primitives");
    expect(imports.valueImports).not.toContain("three");
  });

  it("keeps StudioPage tool detection on the Three-free metadata module", () => {
    const imports = moduleImports("./StudioCuttoonEditorHost.tsx");

    expect(imports.valueImports).toContain("./studio-background-3d-metadata");
    expect(imports.valueImports).not.toContain("./studio-background-3d-primitives");
    expect(imports.valueImports).not.toContain("./bg3d/StudioBackground3D");
  });

  it("loads the 3D editor from one analyzable dynamic-import boundary", () => {
    const imports = moduleImports("./studio-background-3d-loader.ts");

    expect(imports.valueImports).not.toContain("./bg3d/StudioBackground3D");
    expect(imports.dynamicImports).toEqual(["./bg3d/StudioBackground3D"]);
  });

  it("loads durable shot production only after the user starts a batch", () => {
    const imports = moduleImports("./bg3d/studio-bg3d-editor-runtime-bindings.ts");
    // 2026-08-21 intentional change: the batch orchestration moved from StudioBackground3D.tsx into
    // studio-bg3d-shot-batch-export-run.ts (editor split), so the runtime-loader boundary now lives
    // in that module. Both files still have to stay off the durable production chunks.
    const runImports = moduleImports("./bg3d/studio-bg3d-shot-batch-export-run.ts");
    const loaderImports = moduleImports("./bg3d/studio-bg3d-shot-batch-runtime-loader.ts");
    const runtimeSource = readFileSync(
      new URL("./bg3d/studio-bg3d-shot-batch-runtime.ts", import.meta.url),
      "utf8",
    );

    for (const editorImports of [imports, runImports]) {
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-batch-runtime");
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-artifact-pipeline");
      expect(editorImports.dynamicImports).not.toContain("./studio-bg3d-shot-batch-runtime");
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-batch-recovery-store");
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-batch-worker-client");
      expect(editorImports.valueImports).not.toContain(
        "./studio-bg3d-shot-contact-sheet-worker-client",
      );
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-psd-worker-client");
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-batch");
      expect(editorImports.valueImports).not.toContain("./studio-bg3d-shot-batch-plan");
    }
    const bindingsSource = readFileSync(
      new URL("./bg3d/studio-bg3d-editor-runtime-bindings.ts", import.meta.url),
      "utf8",
    );
    expect(bindingsSource).toContain('from "./studio-bg3d-shot-batch-export-run"');
    expect(runImports.valueImports).toContain("./studio-bg3d-shot-batch-runtime-loader");
    expect(loaderImports.dynamicImports).toEqual([
      "./studio-bg3d-shot-batch-runtime",
      "./studio-bg3d-shot-batch-recovery-store",
    ]);
    expect(runImports.valueImports).toContain("./studio-bg3d-shot-batch-limits");
    expect(bindingsSource).toContain('from "./studio-bg3d-shot-batch-pass-catalog"');
    expect(runtimeSource).toContain('from "./studio-bg3d-shot-artifact-pipeline"');
    expect(runtimeSource).not.toContain('from "./studio-bg3d-shot-batch-recovery-store"');
  });

  it("keeps the metadata contract independent of rendering runtimes", () => {
    const imports = moduleImports("./studio-background-3d-metadata.ts");

    expect(imports.valueImports).toEqual([]);
    expect(imports.dynamicImports).toEqual([]);
  });

  it("loads Babylon exactly once from its named explicit diagnostic loader", () => {
    const combined = [
      readFileSync(new URL("./bg3d/StudioBackground3DTypes.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./bg3d/studio-bg3d-editor-misc-host.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./bg3d/studio-bg3d-editor-insert-host.ts", import.meta.url), "utf8"),
      readFileSync(new URL("./bg3d/StudioBg3dCaptureBridge.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("./bg3d/StudioBackground3D.tsx", import.meta.url), "utf8"),
    ].join("\n");
    const file = ts.createSourceFile(
      "studio-bg3d-editor-babylon-boundary.tsx",
      combined,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const source = combined;
    const imports = moduleImports("./bg3d/studio-bg3d-editor-runtime-bindings.ts");
    const specialistImports = moduleImports(
      "./bg3d/studio-bg3d-babylon-specialist-entry.ts",
    );
    const babylonDynamicImports: ts.CallExpression[] = [];
    const loaderCalls: ts.CallExpression[] = [];
    const loaderFunctions: ts.FunctionLikeDeclaration[] = [];
    const automaticActivationProps = new Set([
      "onFocus",
      "onMouseEnter",
      "onPointerEnter",
      "onTouchStart",
    ]);

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === "./studio-bg3d-babylon-specialist-entry"
      ) {
        babylonDynamicImports.push(node);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "loadStudioBg3dBabylonSpecialistEntry"
      ) {
        loaderCalls.push(node);
      }
      if (
        isFunctionLikeDeclarationNode(node) &&
        functionName(node) === "loadStudioBg3dBabylonSpecialistEntry"
      ) {
        loaderFunctions.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);

    expect(
      imports.valueImports.filter((specifier) => (
        specifier.includes("babylon") || specifier.startsWith("@babylonjs/")
      )),
    ).toEqual([]);
    expect(specialistImports.valueImports).toContain(
      "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender",
    );
    expect(babylonDynamicImports).toHaveLength(1);
    expect(loaderFunctions).toHaveLength(1);
    expect(
      enclosingFunction(babylonDynamicImports[0]!) === loaderFunctions[0],
    ).toBe(true);
    expect(loaderCalls.length).toBeGreaterThan(0);

    for (const call of loaderCalls) {
      const owner = enclosingFunction(call);
      expect(owner, "Babylon loader call must stay behind a user action function").not.toBeNull();
      expect(
        ["handleInsert", "runBabylonDiagnostic"],
        "Babylon loader calls are limited to explicit diagnostic and opt-in Magic insertion actions",
      ).toContain(functionName(owner!));
      expect(functionName(owner!)).not.toMatch(/(?:capturebridge|mount|preload)/i);
      expect(
        hasAncestor(call, (candidate) => (
          ts.isCallExpression(candidate) &&
          ts.isIdentifier(candidate.expression) &&
          /^(?:useEffect|useLayoutEffect|useInsertionEffect)$/u.test(candidate.expression.text)
        )),
        "Babylon loader must never run from a React mount/effect path",
      ).toBe(false);
      expect(
        hasAncestor(call, (candidate) => (
          ts.isJsxAttribute(candidate) &&
          ts.isIdentifier(candidate.name) &&
          automaticActivationProps.has(candidate.name.text)
        )),
        "hover, focus, and touch preload paths must not activate Babylon",
      ).toBe(false);
      expect(
        hasAncestor(call, (candidate) => (
          isFunctionLikeDeclarationNode(candidate) &&
          functionName(candidate) === "CaptureBridge"
        )),
        "the automatic Three capture bridge must remain Babylon-free",
      ).toBe(false);
    }

    const captureBridgeStart = source.indexOf("function CaptureBridge(");
    const componentStart = source.indexOf("export function StudioBackground3D(");
    expect(captureBridgeStart).toBeGreaterThanOrEqual(0);
    expect(componentStart).toBeGreaterThan(captureBridgeStart);
    expect(source.slice(captureBridgeStart, componentStart)).not.toContain(
      "loadStudioBg3dBabylonSpecialistEntry(",
    );
  });
});
