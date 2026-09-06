import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  createEmptyStudioReleaseScheduleSnapshot,
  loadStudioReleaseScheduleRuntime,
} from "./studio-release-schedule-loader";

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
  const dynamicImports: string[] = [];
  const valueImports: string[] = [];

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
  return { dynamicImports, valueImports };
}

describe("Studio release schedule lazy boundary", () => {
  it("creates independent blank schedule snapshots without loading the planner", () => {
    const first = createEmptyStudioReleaseScheduleSnapshot();
    const second = createEmptyStudioReleaseScheduleSnapshot();

    expect(first).toEqual({ version: 1, items: [] });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.items).not.toBe(first.items);
  });

  it("shares one analyzable runtime request and exposes the canonical normalizer", async () => {
    const firstRequest = loadStudioReleaseScheduleRuntime();
    const secondRequest = loadStudioReleaseScheduleRuntime();

    expect(secondRequest).toBe(firstRequest);

    const runtime = await firstRequest;
    expect(
      runtime.normalizeStudioReleaseSchedule({
        entries: [
          {
            id: "episode-1",
            title: "  1화  ",
            date: "2026-07-20",
            time: "20:00",
            timezone: "Asia/Seoul",
            status: "planned",
          },
        ],
      }),
    ).toMatchObject({
      version: 1,
      items: [{ id: "episode-1", title: "1화", status: "draft" }],
    });
  });

  it("keeps the full planner behind the loader in StudioPage", () => {
    const loaderImports = moduleImports("./studio-release-schedule-loader.ts");
    const studioImports = moduleImports("./StudioCuttoonEditorHost.tsx");

    expect(loaderImports.valueImports).not.toContain("./studio-release-schedule");
    expect(loaderImports.dynamicImports).toEqual(["./studio-release-schedule"]);
    expect(studioImports.valueImports).not.toContain("./studio-release-schedule");
    expect(studioImports.valueImports).toContain("./studio-release-schedule-loader");
  });
});
