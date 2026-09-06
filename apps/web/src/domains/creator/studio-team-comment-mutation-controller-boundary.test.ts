import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ModuleShape {
  readonly allImports: readonly string[];
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
  const allImports: string[] = [];
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      allImports.push(node.moduleSpecifier.text);
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
  return { allImports, dynamicImports, source, valueImports };
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

describe("Studio team-comment mutation controller boundary", () => {
  it("keeps StudioPage as a thin state adapter without re-inlining the remote transaction", () => {
    const page = moduleShape("./StudioCuttoonEditorHost.tsx");
    const wrapper = functionSource(
      "./StudioCuttoonEditorHost.tsx",
      "executeStudioTeamCommentMutationPlan",
    );

    expect(
      page.valueImports.filter(
        (specifier) => specifier === "./studio-team-comment-mutation-controller",
      ),
    ).toEqual([]);
    expect(
      page.dynamicImports.filter(
        (specifier) => specifier === "./studio-team-comment-mutation-controller",
      ),
    ).toEqual(["./studio-team-comment-mutation-controller"]);
    expect(wrapper).toContain("await loadChunkWithReloadRecovery(");
    expect(wrapper).toContain("return executeStudioTeamCommentMutation({");
    expect(wrapper).toContain("readScope: currentStudioTeamCommentOperationContext");
    expect(wrapper).toContain("operationRegistry: studioTeamCommentOperationScopeRegistryRef.current");
    expect(wrapper).toContain("mergeMutationReceipt: mergeStudioTeamCommentMutationReceipt");
    expect(wrapper).toContain("loadClient: loadStudioTeamCommentClient");
    expect(wrapper.split("\n").length).toBeLessThanOrEqual(38);
    expect(wrapper).not.toContain("createStudioTeamCommentThread(");
    expect(wrapper).not.toContain("JSON.stringify(plan)");
    expect(wrapper).not.toContain("mergeStudioTeamCommentMutationReceipt(");
    expect(wrapper).not.toContain("new Error(");
    expect(page.source).not.toContain("function studioTeamCommentMutationFlightKey");
    expect(page.source).not.toContain(
      "이 댓글의 다른 변경을 저장하고 있어요. 완료된 뒤 다시 시도해 주세요.",
    );
  });

  it("owns permissions, de-duplication, scope fences, projection, and frontier updates", () => {
    const controller = moduleShape("./studio-team-comment-mutation-controller.ts");
    const execute = functionSource(
      "./studio-team-comment-mutation-controller.ts",
      "executeStudioTeamCommentMutation",
    );

    expect(controller.allImports).not.toContain("./StudioPage");
    expect(controller.valueImports).toEqual(["./studio-comments"]);
    expect(controller.valueImports).not.toContain("./studio-team-comment-client");
    expect(controller.allImports).not.toContain("react");
    expect(execute).toContain("readCapabilities()");
    expect(execute).toContain("legacyThreadIds.has(plan.threadId)");
    expect(execute).toContain("const existingFlight = flights.get(flightKey)");
    expect(execute).toContain("operationRegistry.begin(workId, generation)");
    expect(execute).toContain("operationRegistry.isCurrent(ticket, readScope())");
    expect(execute).toContain("commentClient.createStudioTeamCommentThread(");
    expect(execute).toContain("commentClient.addStudioTeamCommentReply(");
    expect(execute).toContain("commentClient.resolveStudioTeamCommentThread(");
    expect(execute).toContain("commentClient.reopenStudioTeamCommentThread(");
    expect(execute.match(/mergeMutationReceipt\(/gu)).toHaveLength(4);
    expect(execute).toContain("if (!receipt.stale)");
    expect(execute).toContain("if (current?.promise === pending) flights.delete(flightKey)");
  });
});
