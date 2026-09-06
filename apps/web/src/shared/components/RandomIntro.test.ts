import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RandomIntro } from "./RandomIntro";

const fileUrl = new URL("./RandomIntro.tsx", import.meta.url);

function introSplashImports() {
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const staticImports: string[] = [];
  const dynamicImports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      staticImports.push(node.moduleSpecifier.text);
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
  return { staticImports, dynamicImports };
}

describe("RandomIntro bundle boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Three.js 인트로를 정적으로 가져오지 않고 literal dynamic import로만 연다", () => {
    const imports = introSplashImports();

    expect(imports.staticImports).not.toContain("./IntroSplash");
    expect(imports.dynamicImports).toEqual(["./IntroSplash"]);
  });

  it("이미 인트로를 본 세션에서는 lazy fallback과 Three 청크를 열기 전에 끝낸다", () => {
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => "true" },
    });

    expect(renderToStaticMarkup(createElement(RandomIntro))).toBe("");
  });

  it("sessionStorage가 차단돼도 장식용 인트로가 앱 진입을 막지 않는다", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(renderToStaticMarkup(createElement(RandomIntro))).toBe("");
  });
});
