import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function moduleSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function moduleImports(fileName: string) {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const valueImports: string[] = [];
  const typeImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = node.importClause?.isTypeOnly ? typeImports : valueImports;
      target.push(node.moduleSpecifier.text);
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
  return { dynamicImports, typeImports, valueImports };
}

describe("Studio BG3D asset-library ownership boundary", () => {
  it("keeps the canonical leaf panel renderer-free and prevents a reverse editor import", () => {
    const imports = moduleImports("./StudioBg3dAssetLibraryPanel.tsx");
    expect(imports.valueImports).toEqual([
      "lucide-react",
      "react",
      "./studio-bg3d-environment-catalog",
    ]);
    expect(imports.typeImports).toEqual(["./bg3d-model-library"]);
    expect(imports.dynamicImports).toEqual(["./studio-bg3d-canonical-glb-download"]);
    expect([...imports.valueImports, ...imports.typeImports]).not.toContain("./StudioBackground3D");
    expect(imports.valueImports).not.toContain("three");
    expect(imports.valueImports.some((source) => source.startsWith("@react-three/"))).toBe(false);
  });

  it("keeps the reference-rebuild wrapper renderer-free and delegates to the canonical file input", () => {
    const imports = moduleImports("./StudioBg3dAssetLibraryPanelWithPresets.tsx");
    expect(imports.valueImports).toEqual([
      "react", "./StudioBg3dAssetLibraryPanel", "./StudioReferenceRebuildPresets",
    ]);
    expect(imports.dynamicImports).toEqual([]);
    const wrapper = moduleSource("./StudioBg3dAssetLibraryPanelWithPresets.tsx");
    expect(wrapper).toContain("<ExistingAssetLibraryPanel {...props} />");
    expect(wrapper).toContain("input.files = transfer.files");
    expect(wrapper).toContain('input.dispatchEvent(new Event("change", { bubbles: true }))');
    expect(wrapper).toContain("importButton.disabled");
    expect(wrapper).not.toContain("saveVerifiedBg3dModel");
    expect(wrapper).not.toContain("importVerifiedBg3dModelsAtomically");
    // The presets component owns no browser API itself: the module worker that builds GLB
    // meshes is constructed by a renderer-free client module (studio-host-architecture-ratchet
    // keeps `new Worker(` out of creator components).
    const presets = moduleImports("./StudioReferenceRebuildPresets.tsx");
    expect(presets.valueImports).toEqual(["react", "./studio-reference-rebuild-worker-client"]);
    expect(presets.dynamicImports).toEqual([]);
    const workerClient = moduleImports("./studio-reference-rebuild-worker-client.ts");
    expect(workerClient.valueImports).toEqual([]);
    expect(workerClient.dynamicImports).toEqual([]);
  });

  it("keeps persistence, validation, resource disposal, scene, history, and selection in the parent", () => {
    const editorSource = [
      moduleSource("./StudioBackground3D.tsx"),
      moduleSource("./studio-bg3d-editor-lt-host.ts"),
      moduleSource("./StudioBg3dEditorSidebarExtras.tsx"),
    ].join("\n");
    const editorImports = moduleImports("./StudioBackground3D.tsx");
    const panelSource = moduleSource("./StudioBg3dAssetLibraryPanel.tsx");
    const editorOwnedSource = `${editorSource}\n${
      moduleSource("./studio-bg3d-editor-model-import-actions.ts")
    }\n${moduleSource("./useStudioBg3dEditor.ts")}\n${
      moduleSource("./studio-bg3d-editor-scene-ops-host.ts")
    }\n${moduleSource("./useStudioBg3dEditorState.ts")}`;

    expect(editorImports.valueImports).not.toContain("./StudioBg3dAssetLibraryPanel");
    expect(editorImports.valueImports).not.toContain("./StudioBg3dAssetLibraryPanelWithPresets");
    expect(editorImports.dynamicImports).toContain("./StudioBg3dAssetLibraryPanelWithPresets");
    expect(editorSource).toContain("<LazyStudioBg3dAssetLibraryPanel");
    expect(editorSource).toContain('if (tab === "models") setModelsPanelActivated(true)');
    expect(editorSource).toContain("modelsPanelActivated ? (");
    for (const ownerToken of [
      "handleUploadModelFiles",
      "importVerifiedBg3dModelsAtomically",
      "deleteStoredBg3dModel",
      "modelImportAbortRef",
      "modelRootCacheRef",
      "cacheEntry.dispose()",
      "removeSceneEntities",
      "historyRef",
      "setSelectedIds",
    ]) {
      expect(editorOwnedSource).toContain(ownerToken);
      expect(panelSource).not.toContain(ownerToken);
    }
    expect(editorSource).not.toContain('aria-label="3D 모델 및 연결 파일 선택"');
    expect(panelSource).toContain('aria-label="3D 모델 및 연결 파일 선택"');
  });

  it("delays SQLite/OPFS model, template, and LT preset authorities until their product surfaces activate", () => {
    const editorSource = [
      moduleSource("./StudioBackground3D.tsx"),
      moduleSource("./useStudioBg3dEditorEffects.ts"),
      moduleSource("./studio-bg3d-editor-lt-host.ts"),
    ].join("\n");
    const _editorImports = moduleImports("./studio-bg3d-editor-runtime-bindings.ts");
    const bindingsSource = moduleSource("./studio-bg3d-editor-runtime-bindings.ts");
    const modelLoaderImports = moduleImports("./studio-bg3d-model-library-loader.ts");
    const templateLoaderImports = moduleImports("./studio-bg3d-template-library-loader.ts");
    const presetLoaderImports = moduleImports("./studio-bg3d-lt-preset-repository-loader.ts");

    expect(bindingsSource).toContain('from "./studio-bg3d-model-library-loader"');
    expect(bindingsSource).toContain('from "./studio-bg3d-template-library-loader"');
    expect(bindingsSource).toContain('from "./studio-bg3d-lt-preset-repository-loader"');
    expect(bindingsSource).not.toContain('from "./bg3d-model-library"');
    expect(bindingsSource).not.toContain('from "./bg3d-template-library"');
    expect(bindingsSource).not.toContain(
      "../scene-3d/studio-mannequin-bg3d-preset-sqlite-repository",
    );
    expect(modelLoaderImports.dynamicImports).toEqual(["./bg3d-model-library"]);
    expect(templateLoaderImports.dynamicImports).toEqual(["./bg3d-template-library"]);
    expect(presetLoaderImports.dynamicImports).toEqual([
      "../scene-3d/studio-mannequin-bg3d-preset-sqlite-repository",
    ]);
    expect(editorSource).toContain("if (!open || !modelsPanelActivated) return;");
    expect(editorSource).toContain("if (!open || !ltPresetPanelActivated) return;");
    expect(editorSource).toContain('if (tab === "models") setModelsPanelActivated(true)');
    expect(editorSource).toContain('if (tab === "lt") setLtPresetPanelActivated(true)');
  });

  it("projects bundled environments before OPFS and degrades only the local library on failure", () => {
    const editorSource = [
      moduleSource("./StudioBackground3D.tsx"),
      moduleSource("./useStudioBg3dEditorState.ts"),
      moduleSource("./useStudioBg3dEditorEffects.ts"),
    ].join("\n");
    const _editorImports = moduleImports("./studio-bg3d-editor-runtime-bindings.ts");
    const effectStart = editorSource.indexOf(
      "// 모델 라이브러리 목록은 모달이 열릴 때 한 번 읽어온다",
    );
    const effectEnd = editorSource.indexOf(
      "setTemplateLibraryStatus(\"loading\")",
      effectStart,
    );
    const modelLibraryEffect = editorSource.slice(effectStart, effectEnd);

    expect(moduleSource("./studio-bg3d-editor-runtime-bindings.ts")).toContain(
      'from "./studio-bg3d-bundled-environment-library"',
    );
    expect(moduleSource("./studio-bg3d-editor-runtime-bindings.ts")).not.toContain(
      'from "./bg3d-model-library"',
    );
    expect(editorSource).toContain(
      "useState<Bg3dModelLibraryEntry[]>(\n    copyStudioBg3dBundledEnvironmentLibraryEntries,",
    );
    expect(modelLibraryEffect).toContain(
      "setModelLibrary(copyStudioBg3dBundledEnvironmentLibraryEntries());",
    );
    expect(modelLibraryEffect).toContain('setModelLibraryStatus("degraded")');
    expect(modelLibraryEffect).not.toContain('setModelLibraryStatus("error")');
    expect(modelLibraryEffect.indexOf("copyStudioBg3dBundledEnvironmentLibraryEntries"))
      .toBeLessThan(modelLibraryEffect.indexOf("listBg3dModelLibraryEntries()"));
  });

  it("keeps the editor operation lifecycle active before the optional Models surface opens", () => {
    const editorSource = moduleSource("./useStudioBg3dEditorEffects.ts");
    const activeAssignment = editorSource.indexOf("componentActiveRef.current = true;");
    const lifecycleStart = editorSource.lastIndexOf("useEffect(() => {", activeAssignment);
    const lifecycleEnd = editorSource.indexOf("}, [", activeAssignment);
    const lifecycleSource = editorSource.slice(lifecycleStart, lifecycleEnd);

    expect(activeAssignment).toBeGreaterThanOrEqual(0);
    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleEnd).toBeGreaterThan(activeAssignment);
    expect(lifecycleSource).toContain("if (!open) return;");
    expect(lifecycleSource).not.toContain("modelsPanelActivated");
  });

  it("preserves the single analyzable lazy editor boundary", () => {
    const loaderImports = moduleImports("../studio-background-3d-loader.ts");

    expect(loaderImports.valueImports).not.toContain("./bg3d/StudioBackground3D");
    expect(loaderImports.dynamicImports).toEqual(["./bg3d/StudioBackground3D"]);
  });
});
