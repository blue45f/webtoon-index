import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleEdges {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly typeImports: readonly string[];
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
  const typeImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      allImports.push(specifier);
      const clause = node.importClause;
      if (clause?.isTypeOnly) typeImports.push(specifier);
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
  return { allImports, dynamicImports, source, typeImports, valueImports };
}

function expectInOrder(source: string, tokens: readonly string[]): void {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    expect(index, `Expected ${JSON.stringify(token)} after offset ${cursor}`).toBeGreaterThanOrEqual(cursor);
    cursor = index + token.length;
  }
}

describe("Studio VRM asset runtime ownership boundary", () => {
  it("keeps a one-way asset runtime import without pulling the editor back into the leaf", () => {
    const poser = moduleEdges("./useStudioVrmPoserInstall.ts");
    const runtime = moduleEdges("./studio-vrm-asset-runtime.ts");
    const binding = moduleEdges("./studio-vrm-texture-paint-binding.ts");

    expect(
      poser.valueImports.filter((specifier) => specifier === "./studio-vrm-asset-runtime"),
    ).toEqual(["./studio-vrm-asset-runtime"]);
    expect(runtime.allImports).not.toContain("./StudioVrmPoser");
    expect(runtime.valueImports).toEqual([
      "three",
      "../bg3d/studio-bg3d-runtime-asset-quality",
      // 라이선스 게이트는 메타데이터·정책 모듈만 잇는 리프다(에디터를 되끌지 않는다).
      // 이 경계가 지키려는 것은 위의 `not.toContain("./StudioVrmPoser")` 쪽이다.
      "./studio-vrm-license-product-gate",
      "./studio-vrm-texture-paint-binding",
      "./vrm-library",
      "@/src/shared/catalog/catalog-static",
    ]);
    expect(runtime.typeImports).toEqual(["@pixiv/three-vrm"]);
    expect(binding.allImports).toEqual([]);
    // MToon 의 WebGPU 노드 재질은 이 리프가 아니라 BG3D 쪽에서 주입한다. 여기서 승인된 WebGPU
    // 지연 entry 를 직접 import 하면 포저의 청크까지 Three 의 WebGPU 그래프에 묶인다.
    expect(runtime.dynamicImports).toEqual([
      "three/examples/jsm/loaders/GLTFLoader.js",
      "@pixiv/three-vrm",
      "@pixiv/three-vrm",
    ]);
  });

  it("keeps React, persistence, request arbitration, object URLs, and install orchestration in the parent", () => {
    const poser = moduleEdges("./useStudioVrmPoserInstall.ts");
    const runtime = moduleEdges("./studio-vrm-asset-runtime.ts");
    // 2026-08-21 의도적 변경: 요청 중재·objectURL·라이브러리 영속은 포저가 소유하는 훅
    // use-studio-vrm-model-loading.ts 로 분리됐다. 이 경계가 지키는 것은 "리프(asset-runtime)가
    // React/영속/설치를 소유하지 않는다"이므로, 소유자 쪽 검사는 포저 + 그 훅을 합친
    // 에디터 계층 소스로 대조한다(리프 쪽 not.toContain 은 그대로).
    const modelLoading = moduleEdges("./use-studio-vrm-model-loading.ts");
    const state = moduleEdges("./useStudioVrmPoserState.ts");
    const history = moduleEdges("./useStudioVrmPoserRuntimeB.ts");
    const editorLayerSource = `${poser.source}\n${modelLoading.source}\n${state.source}\n${history.source}`;

    for (const ownerToken of [
      "loadRequestRef",
      "getStoredVrmModel",
      "URL.createObjectURL",
      "URL.revokeObjectURL",
      "function installVrm",
      "resetFullStateHistory",
      "setVrm(",
    ]) {
      expect(editorLayerSource).toContain(ownerToken);
      expect(runtime.source).not.toContain(ownerToken);
    }
    expect(runtime.allImports.some((specifier) => specifier.startsWith("react"))).toBe(false);
    expect(runtime.source).not.toMatch(
      /\b(?:useEffect|useLayoutEffect|useRef|useState|useSyncExternalStore)\b/u,
    );
    expect(runtime.source).not.toMatch(/\b(?:installVrm|applyPose|historyRef|setVrm)\b/u);
  });

  it("leaves stale-request disposal and object-URL revocation ordering in the parent", () => {
    const source = moduleEdges("./use-studio-vrm-model-loading.ts").source;
    const libraryStart = source.indexOf("function loadModelFromLibraryEntry");
    const libraryEnd = source.indexOf("async function handleFileChange", libraryStart);
    expect(libraryStart).toBeGreaterThanOrEqual(0);
    expect(libraryEnd).toBeGreaterThan(libraryStart);
    const libraryLoad = source.slice(libraryStart, libraryEnd);

    expectInOrder(libraryLoad, [
      "const requestId = beginModelLoad(entry.id);",
      'const storedModel = entry.source === "memory"',
      ": await getStoredVrmModel(entry.id);",
      "if (requestId !== loadRequestRef.current) return;",
      "const objectUrl = URL.createObjectURL(storedModel.blob);",
      "const loadedVrm = await loadVrmAsset(objectUrl);",
      "if (requestId !== loadRequestRef.current) {",
      "disposeVrm(loadedVrm);",
      "installVrm(loadedVrm, storedModel.name, storedModel.id);",
      "finally {",
      "URL.revokeObjectURL(objectUrl);",
    ]);

    expect(source).toContain("const requestId = loadRequestRef.current + 1;");
    expect(source).not.toMatch(/function (?:prepareVrmScene|disposeVrm|loadVrmAsset)\b/u);
    expect(source).not.toContain("function shouldPreflightVrmUrl");
  });
});
