import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const fieldsUrl = new URL("./studio-konva-filter-fields.ts", import.meta.url);
const filtersUrl = new URL("./studio-konva-filters.ts", import.meta.url);

function sourceFile(url: URL): { source: string; file: ts.SourceFile } {
  const source = readFileSync(url, "utf8");
  return {
    source,
    file: ts.createSourceFile(
      url.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    ),
  };
}

function namedFunctionCount(file: ts.SourceFile, name: string): number {
  return file.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ).length;
}

describe("Studio Konva filter module boundary", () => {
  it("owns the cache-key implementation in the lightweight fields module only", () => {
    const fields = sourceFile(fieldsUrl);
    const filters = sourceFile(filtersUrl);

    expect(namedFunctionCount(fields.file, "imageFilterCacheKey")).toBe(1);
    expect(namedFunctionCount(filters.file, "imageFilterCacheKey")).toBe(0);
    expect(filters.source).not.toContain("imageFilterCacheKey");
  });

  it("keeps the dependency direction heavy-to-light and the lightweight imports type-only", () => {
    const fields = sourceFile(fieldsUrl);
    const filters = sourceFile(filtersUrl);
    const fieldsImports = fields.file.statements.filter(ts.isImportDeclaration);

    expect(
      fieldsImports.every((statement) => statement.importClause?.isTypeOnly === true)
    ).toBe(true);
    expect(fields.source).not.toContain('from "./studio-konva-filters"');
    expect(filters.source).toContain('from "./studio-konva-filter-fields"');
  });

  it("preserves separate lightweight candidate and heavyweight normalized active checks", () => {
    const fields = sourceFile(fieldsUrl);
    const filters = sourceFile(filtersUrl);

    expect(namedFunctionCount(fields.file, "hasActiveImageFilters")).toBe(1);
    expect(namedFunctionCount(filters.file, "hasActiveImageFilters")).toBe(1);
    expect(filters.source).not.toContain(
      'export { hasActiveImageFilters } from "./studio-konva-filter-fields"'
    );
  });
});
