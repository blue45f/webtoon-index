import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const ENCODER = "apps/web/src/domains/creator/bg3d/studio-bg3d-model-thumbnail-encode.ts";
const CLIENT = "apps/web/src/domains/creator/bg3d/studio-bg3d-shot-png-worker-client.ts";

function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(resolve(process.cwd(), path), "utf8"), ts.ScriptTarget.Latest, true);
}

function visitTree(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => visitTree(child, visit));
}

describe("BG3D thumbnail PNG client chunk boundary", () => {
  it("co-locates only the unconditional encoder/client pair, not a Worker or renderer", () => {
    const paths: string[] = [];
    let groups = 0;
    visitTree(parseFile("vite.config.ts"), (node) => {
      if (!ts.isIfStatement(node) || !ts.isBlock(node.thenStatement)) return;
      const matches = node.thenStatement.statements.some((statement) =>
        ts.isReturnStatement(statement) && statement.expression !== undefined
        && ts.isStringLiteral(statement.expression)
        && statement.expression.text === "studio-bg3d-png-client",
      );
      if (!matches) return;
      groups += 1;
      visitTree(node.expression, (condition) => {
        if (ts.isStringLiteral(condition)) paths.push(condition.text);
      });
    });
    expect(groups).toBe(1);
    expect(paths.toSorted()).toEqual([`/${ENCODER}`, `/${CLIENT}`].toSorted());
  });

  it("keeps the thumbnail wrapper dependent only on the already-required PNG client", () => {
    const emitted = ts.transpileModule(parseFile(ENCODER).text, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const imports: string[] = [];
    visitTree(ts.createSourceFile(ENCODER, emitted, ts.ScriptTarget.Latest, true), (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node)) {
        expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        expect(ts.isIdentifier(node.expression) && node.expression.text === "require").toBe(false);
      }
    });
    expect(imports).toEqual(["./studio-bg3d-shot-png-worker-client"]);
  });
});
