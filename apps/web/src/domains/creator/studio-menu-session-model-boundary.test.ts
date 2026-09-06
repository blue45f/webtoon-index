import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(HERE, "studio-menu-session-model.ts");
const PAGE_PATH = resolve(HERE, "StudioCuttoonEditorHost.tsx");

function modelSource() {
  const source = readFileSync(MODEL_PATH, "utf8");
  return {
    source,
    file: ts.createSourceFile(
      MODEL_PATH,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    ),
  };
}

describe("studio menu session model boundary", () => {
  it("depends on domain types only and emits no runtime import edges", () => {
    const { file } = modelSource();
    const imports = file.statements.filter(ts.isImportDeclaration);

    expect(imports.map((statement) => statement.moduleSpecifier.getText(file))).toEqual([
      '"./studio-editor-tool-model"',
      '"./studio-toolbar-groups"',
      '"./studio-tools-companion"',
    ]);
    expect(imports.every((statement) => statement.importClause?.isTypeOnly === true)).toBe(true);
  });

  it("stays renderer, browser, transport, and network independent", () => {
    const { file } = modelSource();
    const identifiers = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(file);

    for (const identifier of [
      "document",
      "window",
      "navigator",
      "BroadcastChannel",
      "WebSocket",
      "XMLHttpRequest",
      "fetch",
    ]) {
      expect(identifiers.has(identifier)).toBe(false);
    }

    const moduleSpecifiers = file.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
    for (const specifier of [
      "react",
      "react-dom",
      "konva",
      "react-konva",
      "three",
      "./StudioPage",
    ]) {
      expect(moduleSpecifiers).not.toContain(specifier);
    }
  });

  it("uses exhaustive records instead of partial runtime classification", () => {
    const { source } = modelSource();
    expect(source).toContain("Readonly<Record<StudioMenu, StudioToolbarGroupId | null>>");
    expect(source).toContain("Readonly<Record<StudioMenu, StudioCompanionToolId | null>>");
    expect(source).not.toContain("Partial<Record<StudioMenu");
  });

  it("owns the Page mappings and one mutually-exclusive app-menu session", () => {
    const page = readFileSync(PAGE_PATH, "utf8");
    // 컴패니언 도구 매핑은 추출된 컴패니언 런타임 훅이 소유한다 (2026-08-20 B-04 추출).
    const companionRuntime = readFileSync(
      resolve(HERE, "studio-page-companion-runtime.ts"),
      "utf8",
    );

    expect(page).toContain('from "./studio-menu-session-model"');
    expect(page).toContain("useState<StudioMenuSessionState>(");
    expect(page).toContain('const exportMenuOpen = menuSession.appMenu === "export"');
    expect(page).toContain('const projectActionsOpen = menuSession.appMenu === "project"');
    expect(companionRuntime).toContain("resolveStudioCompanionTool(s)");
    expect(companionRuntime).toContain(
      "resolveStudioCompanionTool(companionUiRef.current)",
    );
    expect(page).toContain("resolveStudioToolbarGroup(menu)");
    expect(page).not.toContain("STUDIO_TOOLBAR_GROUP_OF");
    expect(companionRuntime).not.toContain("STUDIO_TOOLBAR_GROUP_OF");
    expect(page).not.toContain("const [exportMenuOpen");
    expect(page).not.toContain("const [projectActionsOpen");
    expect(page).not.toMatch(/const mapTool\s*=/u);
  });
});
