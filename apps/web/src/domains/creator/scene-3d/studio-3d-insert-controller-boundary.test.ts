import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly source: string;
  readonly valueImports: readonly string[];
  readonly wholeClauseTypeImports: readonly string[];
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
  const valueImports: string[] = [];
  const wholeClauseTypeImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      allImports.push(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (clause?.isTypeOnly) wholeClauseTypeImports.push(node.moduleSpecifier.text);
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
      if (hasRuntimeValue) valueImports.push(node.moduleSpecifier.text);
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
    allImports,
    dynamicImports,
    source,
    valueImports,
    wholeClauseTypeImports,
  };
}

describe("Studio 3D insert controller boundary", () => {
  it("keeps the pure controller free of editor and renderer runtime imports", () => {
    const controller = moduleShape("./studio-3d-insert-controller.ts");

    expect(controller.allImports).toEqual([
      "./studio-3d-insert-contract",
      "../studio-editor-scope",
    ]);
    expect(controller.wholeClauseTypeImports).toEqual(controller.allImports);
    expect(controller.valueImports).toEqual([]);
    expect(controller.dynamicImports).toEqual([]);
    expect(controller.source).not.toContain("allowDuringSave");
    expect(controller.source).not.toContain("StudioPage");
    expect(controller.source).not.toContain("konva");
    expect(controller.source).not.toContain("three");
    expect(controller.source).not.toContain("react");
  });

  it("owns insert payloads in a renderer-neutral type-only leaf with compatibility re-exports", () => {
    const contract = moduleShape("./studio-3d-insert-contract.ts");
    const background = moduleShape("../bg3d/StudioBackground3D.tsx");
    const poser = moduleShape("../vrm/StudioVrmPoser.tsx");
    const ltRender = moduleShape("../bg3d/studio-bg3d-lt-render.ts");

    expect(contract.allImports).toEqual([
      "../bg3d/studio-bg3d-scene-document",
      "../studio-shared-3d-insert-contract",
      "../vrm/studio-vrm-scene-document",
    ]);
    expect(contract.wholeClauseTypeImports).toEqual(contract.allImports);
    expect(contract.valueImports).toEqual([]);
    expect(contract.dynamicImports).toEqual([]);
    expect(contract.allImports.some((specifier) => (
      /(?:react|konva|three|StudioBackground3D|StudioVrmPoser|studio-bg3d-lt-render)/iu
        .test(specifier)
    ))).toBe(false);
    expect(contract.source).not.toMatch(/from\s+["'](?:react|konva|three|@react-three)/iu);
    expect(contract.source).toContain("export interface StudioBackground3DLtLayer");
    expect(contract.source).toContain("export interface StudioBackground3DInsertResult");
    expect(contract.source).toContain("export type StudioVrmPoserInsertResult");
    expect(contract.source).toContain("export type StudioBg3dLtRasterLayerRole");
    expect(contract.source.split("\n").length).toBeLessThanOrEqual(70);

    expect(background.source).toContain(
      'export type {\n  StudioBackground3DInsertResult,\n  StudioBackground3DLtLayer,\n} from "../scene-3d/studio-3d-insert-contract";'
    );
    expect(background.source).not.toContain("export interface StudioBackground3DLtLayer");
    expect(background.source).not.toContain("export interface StudioBackground3DInsertResult");
    expect(poser.source).toContain(
      'import type { StudioVrmPoserInsertResult } from "../scene-3d/studio-3d-insert-contract";'
    );
    expect(poser.source).toContain(
      'export type { StudioVrmPoserInsertResult } from "../scene-3d/studio-3d-insert-contract";'
    );
    expect(poser.source).not.toContain("export type StudioVrmPoserInsertResult =");
    expect(ltRender.source).toContain(
      'import type { StudioBg3dLtRasterLayerRole } from "../scene-3d/studio-3d-insert-contract";'
    );
    expect(ltRender.source).toContain(
      'export type { StudioBg3dLtRasterLayerRole } from "../scene-3d/studio-3d-insert-contract";'
    );
    expect(ltRender.source).not.toContain("export type StudioBg3dLtRasterLayerRole =");
  });

  it("keeps StudioPage as the single static orchestration owner", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx");
    const controllerTest = moduleShape("./studio-3d-insert-controller.test.ts");

    expect(
      page.valueImports.filter(
        (specifier) => specifier === "./scene-3d/studio-3d-insert-controller"
      )
    ).toEqual(["./scene-3d/studio-3d-insert-controller"]);
    expect(page.dynamicImports).not.toContain("./scene-3d/studio-3d-insert-controller");
    expect(page.wholeClauseTypeImports).toContain("./scene-3d/studio-3d-insert-contract");
    expect(page.allImports).not.toContain("../bg3d/StudioBackground3D");
    expect(controllerTest.wholeClauseTypeImports).toContain("./studio-3d-insert-contract");
    expect(controllerTest.allImports).not.toContain("../bg3d/StudioBackground3D");
    expect(controllerTest.allImports).not.toContain("../vrm/StudioVrmPoser");
    // 984251d8c 가 티켓 발급/검사를 useStudioMutationAuthorityRuntime 으로 옮겼다. 티켓은 여전히
    // 이름 있는 타입으로만 오간다 — 호스트도 런타임도 ReturnType 추론에 기대지 않는다.
    const mutationAuthority = moduleShape(
      "../studio-cuttoon-editor/runtime/useStudioMutationAuthorityRuntime.ts"
    );
    expect(mutationAuthority.source).toContain(
      "const captureStudioMutationTicket = useCallback((): StudioEditorMutationTicket =>"
    );
    expect(mutationAuthority.source).toContain(
      "ticket: StudioEditorMutationTicket,"
    );
    expect(page.source).toContain(
      "useRef<StudioEditorMutationTicket | null>(null)"
    );
    for (const source of [page.source, mutationAuthority.source]) {
      expect(source).not.toContain("ReturnType<typeof captureStudioMutationTicket>");
    }
  });

  it("exposes only semantic boolean insert transactions to the lazy modal stack", () => {
    const stack = moduleShape("../StudioLazyPanelStack.tsx").source;
    const previewStack = moduleShape("../StudioThreeDPreviewPanelStack.tsx").source;
    const handlersStart = stack.indexOf("export interface StudioLazyPanelStackHandlers");
    const propsStart = stack.indexOf("export interface StudioLazyPanelStackProps", handlersStart);
    const componentStart = stack.indexOf("export const StudioLazyPanelStack =", propsStart);
    const handlerContract = stack.slice(handlersStart, propsStart);
    const propContract = stack.slice(propsStart, componentStart);
    const component = stack.slice(componentStart);

    expect(handlersStart).toBeGreaterThanOrEqual(0);
    expect(propsStart).toBeGreaterThan(handlersStart);
    expect(componentStart).toBeGreaterThan(propsStart);
    expect(handlerContract).toContain("insertVrmResult: StudioVrmInsertHandler;");
    expect(handlerContract).toContain("insertBg3dResult: StudioBg3dInsertHandler;");
    expect(handlerContract).not.toMatch(/^\s*(?:addRenderedImage|applyBg3dRenderedImage|canApplyStudioMutation|patchEl):/mu);
    expect(propContract).not.toContain("RefObject<{ authScopeKey:");
    expect(propContract).not.toMatch(/^\s*bg3dInitialElementId:/mu);
    expect(propContract).not.toMatch(/^\s*(?:poser|bg3d)MutationTicketRef:/mu);
    expect(component).toContain("<StudioThreeDPreviewPanelStack");
    expect(previewStack).toContain("onInsert={insertVrmResult}");
    expect(previewStack).toContain("onInsert={insertBg3dResult}");
    expect(previewStack).not.toContain("poserMutationTicketRef.current");
    expect(previewStack).not.toContain("bg3dMutationTicketRef.current");
    expect(previewStack).not.toContain("canApplyStudioMutation");
    expect(previewStack).not.toContain("applyBg3dRenderedImage");
    expect(previewStack).not.toContain("addRenderedImage");
    expect(previewStack).not.toContain("patchEl");
    const page = moduleShape("../StudioCuttoonEditorHost.tsx").source;
    const insertHandlerStart = page.indexOf("insertBg3dResult: (result) => {");
    const insertHandlerEnd = page.indexOf("insertVrmResult:", insertHandlerStart);
    const insertHandler = page.slice(insertHandlerStart, insertHandlerEnd);
    expect(insertHandlerStart).toBeGreaterThanOrEqual(0);
    expect(insertHandler).toContain("const editorPageId = bg3dMutationPageIdRef.current;");
    expect(insertHandler).toContain("editorPageId !== currentPageIdRef.current");
    expect(insertHandler.indexOf("return false;")).toBeLessThan(
      insertHandler.indexOf("applyStudioBg3dInsertResult({"),
    );
  });

  it("wires fail-closed commit results before selection, tool, and guide side effects", () => {
    const page = moduleShape("../StudioCuttoonEditorHost.tsx").source;
    const addStart = page.indexOf("function addEl(el: El): boolean");
    const addEnd = page.indexOf("// ── 레이어 그룹", addStart);
    const addElement = page.slice(addStart, addEnd);
    const renderedImageStart = page.indexOf("function addRenderedImage(");
    const bgStart = page.indexOf("function applyBg3dRenderedImage(");
    const renderedImage = page.slice(renderedImageStart, bgStart);
    const bgEnd = page.indexOf("async function addBuiltinRasterAsset", bgStart);
    const backgroundInsert = page.slice(bgStart, bgEnd);

    expect(addStart).toBeGreaterThanOrEqual(0);
    expect(addElement.indexOf("if (!commit([...elements, el])) return false;")).toBeGreaterThanOrEqual(0);
    expect(addElement.indexOf("setSelectedId(el.id);")).toBeGreaterThan(
      addElement.indexOf("if (!commit([...elements, el])) return false;")
    );
    expect(renderedImage).toContain("return addEl({");
    expect(backgroundInsert).toContain("if (!patchEl(targetElementId, {");
    expect(backgroundInsert).toContain("if (!addEl({");
    expect(backgroundInsert).toContain(
      "if (targetElementId && renderResult.magicFilterMask) {"
    );
    expect(backgroundInsert).toContain("if (isRealtimeTeamSession) {");
    expect(backgroundInsert.indexOf("if (isRealtimeTeamSession) {")).toBeLessThan(
      backgroundInsert.indexOf("const plan = planStudioBg3dLtLayers")
    );
    expect(backgroundInsert.indexOf(
      "if (targetElementId && renderResult.magicFilterMask) {"
    )).toBeLessThan(backgroundInsert.indexOf(
      "const plan = planStudioBg3dLtLayers"
    ));
    expect(backgroundInsert).toContain("const magicAttachment = detachPlan?.ok");
    expect(backgroundInsert).toContain(": attachStudioBg3dMagicFilterMaskToLtPlan({");
    expect(backgroundInsert).toContain(
      "if (nextLinkedRender === null || !commit(nextElements, {"
    );
    expect(backgroundInsert.indexOf("setSelectedId(plan.anchorElementId);")).toBeGreaterThan(
      backgroundInsert.indexOf(
        "if (!commit(nextElements, {"
      )
    );
    expect(backgroundInsert).toContain("drawingAssist: nextDrawingAssist");
    expect(backgroundInsert).toContain("mapStudioBg3dPerspectiveGuidesToAnchor(");
    expect(backgroundInsert).toContain(
      "const anchor = nextElements.find((element) => element.id === plan.anchorElementId);"
    );
    expect(backgroundInsert).not.toContain("commitStudioDrawingAssistDocument(");
    expect(backgroundInsert.indexOf("setTool(\"select\");")).toBeGreaterThan(
      backgroundInsert.indexOf("if (!commit(nextElements, {")
    );
    expect(backgroundInsert.lastIndexOf("return true;")).toBeGreaterThan(
      backgroundInsert.indexOf("commitStudioDrawingAssistDocument(")
    );
  });
});
