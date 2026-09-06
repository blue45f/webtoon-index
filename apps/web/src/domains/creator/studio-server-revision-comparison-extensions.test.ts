import { describe, expect, it } from "vitest";


import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import { parseStudioProjectFile } from "./studio-project-file";
import { STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT } from "./studio-revision-diff";
import {
  STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD,
  type StudioRevisionDocumentExtensionEntry,
} from "./studio-revision-document-extensions";
import { buildStudioServerRevisionComparison } from "./studio-server-revision-comparison";

import { projectRevisionComparisonValue } from "@/shared/lib/revision-comparison-projection";

function page() {
  return {
    id: "page-1",
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_600,
  };
}

function snapshot(doc: Record<string, unknown>) {
  return {
    title: "현재",
    description: "",
    tags: [],
    doc: { pagesList: [page()], ...doc },
  };
}

function extensionEntries(project: unknown): readonly StudioRevisionDocumentExtensionEntry[] {
  return (project as Record<string, unknown>)[
    STUDIO_REVISION_DOCUMENT_EXTENSIONS_FIELD
  ] as readonly StudioRevisionDocumentExtensionEntry[];
}

describe("server revision unknown document extensions", () => {
  it("indexes only future doc keys and excludes mapped, registered, and legacy fields", () => {
    const project = creatorWorkSnapshotToStudioProject(
      snapshot({
        width: 720,
        currentPageId: "page-1",
        elements: [],
        bg: "#000000",
        bgGrad: null,
        height: 2_000,
        master: { elements: [] },
        characterBible: { version: 1, characters: [] },
        writerRoom: { version: 1, stages: {} },
        aiProvenance: { version: 1, operations: [] },
        comments: { version: 1, threads: [] },
        releaseSchedule: { version: 1, items: [] },
        publicationAnalytics: { version: 1, records: [] },
        publishPack: { profile: "generic" },
        webtoonTheme: "classic",
        panelGutter: 24,
        fx: { reveal: "fade-up" },
        futureLightingGraph: { version: 3, nodes: [] },
      }),
      { includeRevisionDocumentExtensions: true }
    );

    expect(extensionEntries(project).map(([key]) => key)).toEqual(["futureLightingGraph"]);
  });

  it("reports unknown extension add/remove/change from base to target without exposing values", async () => {
    const privateSuffix = "private-extension-key-suffix";
    const longChangedKey = `${"x".repeat(STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT + 8)}${privateSuffix}`;
    const baseSnapshot = await projectRevisionComparisonValue(snapshot({
      width: 720,
      elements: [{ id: "legacy-base" }],
      bg: "#111111",
      height: 1_800,
      futureRemoved: { payload: "base-only-private-value" },
      [longChangedKey]: { payload: "before-private-value" },
    }));
    const targetSnapshot = await projectRevisionComparisonValue(snapshot({
      width: 1_080,
      elements: [{ id: "legacy-target" }],
      bg: "#eeeeee",
      height: 2_400,
      futureAdded: { payload: "target-only-private-value" },
      [longChangedKey]: { payload: "after-private-value" },
    }));

    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot,
      baseSnapshot,
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [page()],
      }),
    });
    const extensionChanges = comparison.localToTarget.changes.filter(
      (change) => change.kind === "document-extension-changed"
    );
    const serialized = JSON.stringify(comparison);

    expect(comparison.localToTarget.summary["document-extension-changed"]).toBe(3);
    expect(extensionChanges).toContainEqual({
      kind: "document-extension-changed",
      scope: "document",
      field: "futureAdded",
    });
    expect(extensionChanges).toContainEqual({
      kind: "document-extension-changed",
      scope: "document",
      field: "futureRemoved",
    });
    expect(extensionChanges).toContainEqual(expect.objectContaining({
      kind: "document-extension-changed",
      field: "x".repeat(STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT),
    }));
    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(serialized).not.toContain("base-only-private-value");
    expect(serialized).not.toContain("target-only-private-value");
    expect(serialized).not.toContain("before-private-value");
    expect(serialized).not.toContain("after-private-value");
    expect(serialized).not.toContain(privateSuffix);
    // Modern pagesList owns the page content, so changed legacy aliases are not double-counted.
    expect(comparison.localToTarget.totalChanges).toBe(3);
  });
});
