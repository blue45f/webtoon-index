import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleEdges {
  readonly dynamicImports: readonly string[];
  readonly source: string;
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
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier)
      && !node.importClause?.isTypeOnly
    ) {
      valueImports.push(node.moduleSpecifier.text);
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

describe("Paper vector refinement production entry boundary", () => {
  it("keeps the Paper Worker graph behind one analyzable dynamic import", () => {
    // The async refinement body moved verbatim into the StudioPage vector-ops factory module.
    const page = moduleEdges("../StudioCuttoonEditorHost.tsx");
    const vectorOps = moduleEdges("../studio-page-vector-ops.ts");
    const workerClient = "./brush/studio-paper-vector-refinement-worker-client";

    expect(vectorOps.valueImports).toContain(
      "./brush/studio-paper-vector-document-adapter",
    );
    expect(vectorOps.valueImports).not.toContain(workerClient);
    expect(
      vectorOps.dynamicImports.filter((specifier) => specifier === workerClient),
    ).toEqual([workerClient]);
    expect(page.valueImports).toContain("./studio-page-vector-ops");
    expect(page.valueImports).not.toContain(workerClient);
    expect(page.dynamicImports).not.toContain(workerClient);
  });

  it("captures authority before await and revalidates source identity before one canonical commit", () => {
    const page = moduleEdges("../studio-page-vector-ops.ts").source;
    const start = page.indexOf("async function applyPaperVectorRefinement(");
    const end = page.indexOf(
      "// 벡터 패스 불리언 결합",
      start,
    );
    const handler = page.slice(start, end);
    const ticketAt = handler.indexOf("captureStudioMutationTicket()");
    const importAt = handler.indexOf(
      'await import("./brush/studio-paper-vector-refinement-worker-client")',
    );
    const refineAt = handler.indexOf(
      "await refineStudioDrawElementWithPaper({",
    );
    const staleAt = handler.indexOf(
      "studioVectorAsyncCommandStaleReason(snapshot",
    );
    const commitAt = handler.indexOf(
      "commit(nextElements, undefined, targetPageId)",
    );

    expect(start).toBeGreaterThan(0);
    expect(ticketAt).toBeGreaterThan(0);
    expect(importAt).toBeGreaterThan(ticketAt);
    expect(refineAt).toBeGreaterThan(importAt);
    expect(staleAt).toBeGreaterThan(refineAt);
    expect(commitAt).toBeGreaterThan(staleAt);
    expect(handler).toContain("sourceElements: [source]");
    expect(handler).toContain("elements: latestElements");
    expect(handler).toContain(
      "element === source ? result.replacement : element",
    );
    expect(handler.match(/\bcommit\(/gu)).toHaveLength(1);
    expect(handler).toContain("mutationAllowed: canApplyStudioMutation(mutationTicket)");
    expect(handler).toContain("reviewLocked: activeSurfaceReviewLockedRef.current");
  });

  it("owns cancellation, epoch invalidation and the Inspector controls in Studio", () => {
    const page = readStudioCuttoonEditorSource();
    const inspector = readStudioInspectorAsideSurface();
    const panel = moduleEdges("../StudioNodeEditPanel.tsx").source;

    expect(page).toContain("paperVectorRefinementAbortRef.current?.abort()");
    // 984251d8c 이후 무효화는 useStudioVectorOperationRuntime 안에 있고, 클라이언트가 없을 때를
    // 대비해 삼항으로 갈라진다 — 에폭을 클라이언트에게서 받는다는 계약은 그대로다.
    expect(page).toContain("paperVectorRefinementEngineEpochRef.current = client");
    expect(page).toContain("? client.advanceEngineEpoch()");
    expect(page).toContain(
      "paperVectorRefinementClientRef.current?.dispose()",
    );
    expect(page).toContain(
      "paperVectorRefinementUnavailableReason={",
    );
    expect(page).toContain(
      "applyPaperVectorRefinement={(operation) => {",
    );
    expect(page).toContain(
      "cancelPaperVectorRefinement={cancelPaperVectorRefinement}",
    );
    expect(inspector).toContain('aria-label="잠긴 경로 정리 취소"');
    expect(inspector).toContain("refinementBusy={paperVectorRefinementBusy}");
    expect(inspector).toContain("onRefine={applyPaperVectorRefinement}");
    expect(panel).toContain('aria-label="경로 정리"');
    expect(panel).toContain('aria-label="경로 정리 취소"');
    expect(panel).toContain("aria-live=\"polite\"");
  });

  it("does not recycle the Paper Worker for an outer history-array identity change", () => {
    // The cancellation effect moved into the extracted vector runtime; the host now passes the
    // frontier index in as `pagesHistoryIndex` instead of closing over `pagesHi`.
    const page = moduleEdges(
      "../studio-cuttoon-editor/runtime/useStudioVectorOperationRuntime.ts",
    ).source;
    const effectStart = page.indexOf(
      "if (pathBooleanActiveRef.current) {",
    );
    const effectEnd = page.indexOf(
      "useEffect(() => () => {",
      effectStart,
    );
    const invalidationEffect = page.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThan(0);
    expect(invalidationEffect).toContain(
      "}, [activePageId, invalidatePaperVectorRefinement, masterEditMode, pagesHistoryIndex]);",
    );
    expect(invalidationEffect).not.toContain("pagesHistory, pagesHi");
    expect(invalidationEffect).toContain("invalidatePaperVectorRefinement(false)");
    // 그 무효화가 실제로 진행 중인 Worker 요청을 끊는다.
    const invalidate = page.slice(
      page.indexOf("const invalidatePaperVectorRefinement = useCallback("),
      page.indexOf("const cancelPaperVectorRefinement = useCallback("),
    );
    expect(invalidate).toContain("paperVectorRefinementAbortRef.current?.abort()");
    // 호스트는 프론티어 인덱스를 그대로 넘긴다 — 히스토리 배열 정체성은 넘기지 않는다.
    const host = moduleEdges("../StudioCuttoonEditorHost.tsx").source;
    expect(host).toContain("pagesHistoryIndex: pagesHi,");
  });
});
