import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { hasValidStudioCrdtRootSchema as directRootValidator } from "./studio-crdt-root-schema";
import { hasValidStudioCrdtRootSchema as compatibilityRootValidator } from "./studio-crdt.service";

function moduleImports(fileName: string) {
  const fileUrl = new URL(fileName, import.meta.url);
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
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
  return { dynamicImports, source, valueImports };
}

describe("Studio CRDT root schema ownership boundary", () => {
  it("preserves the service's public validator export", () => {
    expect(compatibilityRootValidator).toBe(directRootValidator);
  });

  it("keeps validation pure and one-way from the service", () => {
    const schema = moduleImports("./studio-crdt-root-schema.ts");
    const service = moduleImports("./studio-crdt.service.ts");

    expect(service.valueImports).toContain("./studio-crdt-root-schema");
    expect(schema.valueImports).toEqual([
      "yjs",
      "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract",
      "../../../../web/src/shared/lib/studio-crdt-raster-document-contract",
      "../../../../web/src/shared/lib/studio-filter-mask-surface-contract",
      "../../../../web/src/shared/lib/studio-ink-input-contract",
      "../../../../web/src/shared/lib/studio-work-asset-contract",
    ]);
    expect(schema.valueImports).not.toContain("./studio-crdt.service");
    expect(schema.valueImports).not.toContain("./studio-crdt.repository");
    expect(schema.dynamicImports).toEqual([]);
    expect(schema.source).not.toMatch(/@Injectable|@Inject\(|\bLogger\b|\bOnModuleDestroy\b/u);
  });

  it("leaves hydration, queues, compaction, and errors in the service owner", () => {
    const schema = moduleImports("./studio-crdt-root-schema.ts").source;
    const service = moduleImports("./studio-crdt.service.ts").source;

    for (const declaration of [
      "function validateSceneElementRoot",
      "function validatePageRoot",
      "function validateLayerGroupRoot",
      "function validateStrokeRoot",
      "function validateStudioCrdtDeletionRoots",
      "function snapshotStudioCrdtR8GrainReferences",
      "function snapshotStudioWorkAssetReferences",
    ]) {
      expect(schema).toContain(declaration);
      expect(service).not.toContain(declaration);
    }

    for (const serviceResponsibility of [
      "class StudioCrdtInvalidPayloadError",
      "class StudioCrdtStorageCorruptionError",
      "class StudioCrdtService",
      "private async catchUpDocument",
      "private async maybeCompact",
      "private withWorkLock",
    ]) {
      expect(service).toContain(serviceResponsibility);
      expect(schema).not.toContain(serviceResponsibility);
    }
  });
});
