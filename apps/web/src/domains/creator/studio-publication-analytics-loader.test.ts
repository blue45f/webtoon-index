import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  createEmptyStudioPublicationAnalyticsSnapshot,
  isEmptyStudioPublicationAnalyticsSnapshot,
  loadStudioPublicationAnalyticsRuntime,
  normalizeStudioPublicationAnalyticsDeferred,
} from "./studio-publication-analytics-loader";

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
  return { dynamicImports, source, valueImports };
}

describe("Studio publication analytics lazy boundary", () => {
  it("creates independent blank analytics snapshots without loading the engine", () => {
    const first = createEmptyStudioPublicationAnalyticsSnapshot();
    const second = createEmptyStudioPublicationAnalyticsSnapshot();

    expect(first).toEqual({ version: 1, records: [] });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.records).not.toBe(first.records);
  });

  it("restores an omitted optional analytics domain without requesting its runtime", async () => {
    await expect(normalizeStudioPublicationAnalyticsDeferred(undefined)).resolves.toEqual({
      version: 1,
      records: [],
    });
  });

  it("recognizes only the exact canonical empty snapshot as runtime-free", async () => {
    expect(isEmptyStudioPublicationAnalyticsSnapshot({ version: 1, records: [] })).toBe(true);
    expect(
      isEmptyStudioPublicationAnalyticsSnapshot({ version: 1, records: [], unexpected: true }),
    ).toBe(false);
    expect(isEmptyStudioPublicationAnalyticsSnapshot({ version: 1, records: [{}] })).toBe(false);
    await expect(
      normalizeStudioPublicationAnalyticsDeferred({ version: 1, records: [] }),
    ).resolves.toEqual({ version: 1, records: [] });
  });

  it("shares one analyzable runtime request and exposes the canonical normalizer", async () => {
    const firstRequest = loadStudioPublicationAnalyticsRuntime();
    const secondRequest = loadStudioPublicationAnalyticsRuntime();

    expect(secondRequest).toBe(firstRequest);

    const runtime = await firstRequest;
    expect(
      runtime.normalizeStudioPublicationAnalyticsDocument({
        records: [
          {
            id: "unsafe-id",
            destination: "webtoon",
            source: { kind: "manual", label: "  주간 입력  " },
            date: "2026-07-16",
            episode: "  1화  ",
            title: "  시작  ",
            views: 120,
            likes: 12,
            comments: 3,
            subscribersGained: 4,
            revenue: null,
            currency: null,
          },
        ],
      }),
    ).toMatchObject({
      version: 1,
      records: [
        {
          destination: "webtoon",
          episode: "1화",
          title: "시작",
          source: { kind: "manual", label: "주간 입력" },
        },
      ],
    });
  });

  it("keeps the full parser and aggregator behind the loader in StudioPage", () => {
    const loaderImports = moduleImports("./studio-publication-analytics-loader.ts");
    const studioImports = moduleImports("./StudioCuttoonEditorHost.tsx");

    expect(loaderImports.valueImports).not.toContain("./studio-publication-analytics");
    expect(loaderImports.dynamicImports).toEqual(["./studio-publication-analytics"]);
    expect(studioImports.valueImports).not.toContain("./studio-publication-analytics");
    expect(studioImports.valueImports).toContain("./studio-publication-analytics-loader");
  });

  it("normalizes both deferred document domains before crossing one mutation barrier", () => {
    const studioSource = moduleImports("./StudioCuttoonEditorHost.tsx").source;

    expect(studioSource).toMatch(
      /Promise\.all\(\[\s*loadStudioReleaseScheduleRuntime\(\),\s*normalizeStudioPublicationAnalyticsDeferred\(projectData\.publicationAnalytics\)/,
    );
    expect(studioSource).toMatch(
      /if \(!canApplyStudioMutation\(mutationTicket\)\) return false;\s+return applyStudioProjectSnapshotWithPreparedDocuments\(/,
    );
    expect(studioSource).toMatch(
      /setReleaseSchedule\(normalizeReleaseSchedule\(projectData\.releaseSchedule\)\);\s+setPublicationAnalytics\(publicationAnalyticsDocument\)/,
    );
  });

  it("does not make analytics-free server hydration depend on the optional engine", () => {
    const studioSource = moduleImports("./StudioCuttoonEditorHost.tsx").source;

    expect(studioSource).toMatch(
      /remixId\s+\? createEmptyStudioPublicationAnalyticsSnapshot\(\)\s+: await normalizeStudioPublicationAnalyticsDeferred\(doc\?\.publicationAnalytics\)/,
    );
    expect(studioSource).toMatch(
      /if \(!alive\) return;\s+const parsedProject = creatorWorkSnapshotToStudioProject\(w\);\s+const hasLinked3dRender = parsedProject\.pagesList\.some/,
    );
    expect(studioSource).toMatch(
      /if \(remixId && hasLinked3dRender\) \{[\s\S]*?return;\s+\}\s+const hydratedProject = hasLinked3dRender/,
    );
  });
});
