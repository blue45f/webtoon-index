import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly dynamicImports: readonly string[];
  readonly source: string;
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
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
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
            && bindings.elements.some((specifier) => !specifier.isTypeOnly),
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
  return { dynamicImports, source, valueImports };
}

function functionSource(relativePath: string, name: string): string {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let match: ts.FunctionDeclaration | null = null;

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  if (!match) throw new Error(`Missing function ${name} in ${relativePath}`);
  return (match as ts.FunctionDeclaration).getText(file);
}

describe("Studio server-revision restore controller boundary", () => {
  it("keeps StudioPage as a direct adapter without re-inlining the restore transaction", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const wrapper = functionSource("./StudioCuttoonEditorHost.tsx", "restoreServerRevision");

    expect(
      page.valueImports.filter(
        (specifier) => specifier === "./studio-server-revision-restore-controller",
      ),
    ).toEqual([]);
    expect(
      page.dynamicImports.filter(
        (specifier) => specifier === "./studio-server-revision-restore-controller",
      ),
    ).toEqual(["./studio-server-revision-restore-controller"]);
    expect(wrapper).toContain("await loadChunkWithReloadRecovery(");
    expect(wrapper).toContain("return restoreStudioServerRevision({");
    expect(wrapper).toContain("sharedDocumentRole: sharedDocument?.role ?? null");
    expect(wrapper).toContain("sharedDocumentRestoreAbortRef");
    expect(wrapper).toContain("isAsyncScopeCurrent: isStudioEditorAsyncScopeCurrent");
    expect(wrapper).toContain("isCuttoonSourceFormat: isStudioCuttoonSourceFormat");
    expect(wrapper).toContain("captureStudioMutationTicket");
    expect(wrapper).toContain("applyStudioProjectSnapshot");
    expect(wrapper.split("\n").length).toBeLessThanOrEqual(56);
    expect(wrapper).not.toContain("restoreWorkRevision(");
    expect(wrapper).not.toContain("getStudioSharedDocument(");
    expect(wrapper).not.toContain("studioServerRestoreCheckpointName(");
    expect(wrapper).not.toContain("globalThis.localStorage.removeItem(");
    expect(page.source).not.toContain("restoreWorkRevision(");
    expect(page.source).not.toContain("studioServerRestoreCheckpointName(");
    expect(page.source).not.toContain(
      "서버가 복원 커밋 버전을 반환하지 않아 안전하게 적용할 수 없어요.",
    );
  });

  it("owns the lazy, conflict-safe, fail-closed restore transaction", () => {
    const controller = moduleShape("./studio-server-revision-restore-controller.ts");
    const restore = functionSource(
      "./studio-server-revision-restore-controller.ts",
      "restoreStudioServerRevision",
    );

    expect(controller.valueImports).toEqual([
      "./studio-checkpoints",
      "./studio-creator-work-project",
    ]);
    expect(controller.valueImports).not.toContain("./StudioPage");
    expect(controller.valueImports).not.toContain("react");
    expect(controller.dynamicImports).toEqual([
      "@/src/infrastructure/creator-client",
      "./studio-shared-document-client",
      "./studio-linked-3d-pass-cloud-project",
      "./studio-shared-document-client",
    ]);
    expect(restore).toContain("saveNamedCheckpoint(studioServerRestoreCheckpointName(");
    expect(restore).toContain("studioRevisionProjectGenerationRef.current");
    expect(restore).toContain("isAsyncScopeCurrent(");
    expect(restore).toContain("isCuttoonSourceFormat(restoredWork.format)");
    expect(restore).toContain("documentSaveInFlightRef.current = true");
    expect(restore).toContain("captureStudioMutationTicket()");
    expect(
      restore.match(
        /canApplyStudioMutation\(restoreMutationTicket, \{ allowDuringSave: true \}\)/gu,
      ),
    ).toHaveLength(2);
    expect(restore).toContain("restoreWorkRevision(");
    expect(restore).toContain("restoredWork.revision !== committedRevision");
    expect(restore).toContain("restoredShared.revision !== committedRevision");
    expect(restore).toContain("await hydrateStudioLinked3dPassCloudProject({");
    expect(restore).toContain("signal: restoreController.signal");
    expect(restore).toContain("return await applyStudioProjectSnapshot(candidate)");
    expect(restore).toContain("setDocumentReloadRequired(true)");
    expect(restore).toContain('cause.name === "WorkRevisionConflictError"');
    expect(restore).toContain("globalThis.localStorage.removeItem(autosaveKey)");
    expect(restore).toContain("await reloadServerRevisions()");
  });
});
