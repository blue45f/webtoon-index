import { describe, expect, it, vi } from "vitest";

import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import { parseStudioProjectFile, type StudioProjectFile } from "./studio-project-file";
import {
  diffStudioProjectRevisions,
  STUDIO_REVISION_CHANGE_DETAIL_LIMIT,
  STUDIO_REVISION_CHANGE_FIELD_LIMIT,
  STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT,
  StudioRevisionDiffError,
  type StudioRevisionChange,
} from "./studio-revision-diff";

type TestElement = Record<string, unknown> & { id: string };

function page(
  id: string,
  elements: readonly TestElement[] = [],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    elements: [...elements],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_080,
    ...extra,
  };
}

function project(
  pages: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): StudioProjectFile {
  return parseStudioProjectFile({
    version: 2,
    pagesList: pages,
    ...extra,
  });
}

function image(id: string, extra: Record<string, unknown> = {}): TestElement {
  return {
    id,
    type: "image",
    src: `asset://${id}`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    ...extra,
  };
}

function changesOfKind(
  changes: readonly StudioRevisionChange[],
  kind: StudioRevisionChange["kind"]
): StudioRevisionChange[] {
  return changes.filter((change) => change.kind === kind);
}

describe("studio revision semantic diff", () => {
  it("reports linked Scene Shot receipt changes as page properties", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture();
    const withoutReceipt = {
      ...linkedPage,
      elements: linkedPage.elements.map((element) => element.type === "image"
        ? { ...element, src: "data:image/png;base64,AA==" }
        : element),
      linked3dRender: undefined,
    };
    const before = project([withoutReceipt as unknown as Record<string, unknown>]);
    const after = project([linkedPage as unknown as Record<string, unknown>]);
    const result = diffStudioProjectRevisions(before, after);

    expect(changesOfKind(result.changes, "page-properties-changed")).toEqual([
      expect.objectContaining({
        pageId: linkedPage.id,
        fields: ["linked3dRender"],
      }),
    ]);
  });

  it("ignores transient state, object key order, and explicit semantic defaults without serializing", () => {
    const before = project([
      page("page-1", [{
        id: "hero",
        type: "image",
        src: "asset://hero",
        x: 10,
        y: 20,
        width: 100,
        height: 200,
      }]),
    ], {
      currentPageId: "page-1",
      savedAt: "2026-07-01T00:00:00.000Z",
      characterBible: {
        version: 1,
        characters: [{ id: "hero", name: "윤슬", traits: { brave: true, quiet: false } }],
      },
    });
    const after = project([
      page("page-1", [{
        height: 200,
        width: 100,
        y: 20,
        x: 10,
        src: "asset://hero",
        type: "image",
        id: "hero",
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        groupId: "",
      }], { groups: [], hideMaster: false, name: "", note: "" }),
    ], {
      currentPageId: "missing-page-is-transient",
      savedAt: "2026-07-12T00:00:00.000Z",
      characterBible: {
        characters: [{ traits: { quiet: false, brave: true }, name: "윤슬", id: "hero" }],
        version: 1,
      },
    });

    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("semantic diff must not serialize");
    });
    let result: ReturnType<typeof diffStudioProjectRevisions>;
    try {
      result = diffStudioProjectRevisions(before, after);
    } finally {
      stringify.mockRestore();
    }

    expect(result).toMatchObject({
      hasChanges: false,
      totalChanges: 0,
      truncated: false,
      changes: [],
    });
    expect(Object.values(result.summary).every((count) => count === 0)).toBe(true);
  });

  it("detects character bible, writer room, comments, and publication documents by category", () => {
    const before = project([page("page-1")], {
      title: "초안",
      characterBible: { version: 1, characters: [] },
      writerRoom: { version: 1, stages: {} },
      comments: { version: 1, threads: [] },
      releaseSchedule: { version: 1, items: [] },
      publicationAnalytics: { version: 1, records: [] },
      publishPack: { profile: "generic" },
      master: { elements: [] },
      fx: { duration: 100 },
    });
    const after = project([page("page-1")], {
      title: "완성본",
      characterBible: { version: 1, characters: [{ id: "hero", name: "윤슬" }] },
      writerRoom: { version: 1, stages: { premise: { text: "비밀" } } },
      comments: { version: 1, threads: [{ id: "comment-1", body: "눈 방향 수정" }] },
      releaseSchedule: { version: 1, items: [{ id: "release-1" }] },
      publicationAnalytics: { version: 1, records: [{ id: "episode-1", views: 10 }] },
      publishPack: { profile: "naver-webtoon" },
      master: { elements: [image("master-logo")] },
      linkedTitleId: "title-1",
      fx: { duration: 200 },
    });

    const result = diffStudioProjectRevisions(before, after);

    expect(changesOfKind(result.changes, "document-metadata-changed").map((item) => item.field))
      .toEqual(["title"]);
    expect(changesOfKind(result.changes, "document-content-changed").map((item) => item.field))
      .toEqual(["characterBible", "master", "writerRoom"]);
    expect(changesOfKind(result.changes, "document-review-changed").map((item) => item.field))
      .toEqual(["comments"]);
    expect(changesOfKind(result.changes, "publication-metadata-changed").map((item) => item.field))
      .toEqual(["linkedTitleId", "publicationAnalytics", "publishPack", "releaseSchedule"]);
    expect(changesOfKind(result.changes, "document-extension-changed").map((item) => item.field))
      .toEqual(["fx"]);
    expect(result.totalChanges).toBe(10);
    expect(result.summary["document-content-changed"]).toBe(3);
  });

  it("summarizes page add/remove/order/size/style/group/animation/metadata changes", () => {
    const before = project([
      page("page-a"),
      page("page-b"),
      page("page-c"),
    ]);
    const after = project([
      page("page-c", [], {
        canvasH: 1_400,
        bg: "#101010",
        groups: [{ id: "group-1", name: "인물" }],
        animTimeline: { version: 1, duration: 24 },
        name: "클라이맥스",
      }),
      page("page-a"),
      page("page-d", [image("new-page-element")]),
    ]);

    const result = diffStudioProjectRevisions(before, after);

    expect(changesOfKind(result.changes, "page-added")).toEqual([
      expect.objectContaining({ pageId: "page-d", afterIndex: 2, elementCount: 1 }),
    ]);
    expect(changesOfKind(result.changes, "page-removed")).toEqual([
      expect.objectContaining({ pageId: "page-b", beforeIndex: 1, elementCount: 0 }),
    ]);
    expect(changesOfKind(result.changes, "page-order-changed")).toEqual([
      expect.objectContaining({
        beforePageIds: ["page-a", "page-c"],
        afterPageIds: ["page-c", "page-a"],
      }),
    ]);
    expect(changesOfKind(result.changes, "page-resized")).toEqual([
      expect.objectContaining({
        pageId: "page-c",
        fields: ["canvasHeight"],
        before: { canvasWidth: 720, canvasHeight: 1_080 },
        after: { canvasWidth: 720, canvasHeight: 1_400 },
      }),
    ]);
    expect(changesOfKind(result.changes, "page-style-changed")[0]).toMatchObject({
      pageId: "page-c",
      fields: ["bg"],
    });
    expect(changesOfKind(result.changes, "page-groups-changed")[0]).toMatchObject({
      pageId: "page-c",
      fields: ["groups"],
    });
    expect(changesOfKind(result.changes, "page-animation-changed")[0]).toMatchObject({
      pageId: "page-c",
      fields: ["animTimeline"],
    });
    expect(changesOfKind(result.changes, "page-metadata-changed")[0]).toMatchObject({
      pageId: "page-c",
      fields: ["name"],
    });
  });

  it("treats page canvasW as the canonical per-page width", () => {
    const result = diffStudioProjectRevisions(
      project([page("page-1", [], { canvasW: 720 })]),
      project([page("page-1", [], { canvasW: 1080 })])
    );

    expect(result).toMatchObject({ hasChanges: true, totalChanges: 1 });
    expect(changesOfKind(result.changes, "page-resized")).toEqual([
      expect.objectContaining({
        fields: ["canvasWidth"],
        before: { canvasWidth: 720, canvasHeight: 1080 },
        after: { canvasWidth: 1080, canvasHeight: 1080 },
      }),
    ]);
  });

  it("classifies element transform, text, source, group, style, and metadata independently", () => {
    const before = project([page("page-1", [
      image("hero", {
        x: 10,
        y: 20,
        width: 100,
        height: 200,
        src: "asset://hero-v1",
        groupId: "cast",
        opacity: 1,
        hidden: false,
      }),
      {
        id: "dialogue",
        type: "text",
        text: "안녕",
        x: 0,
        y: 0,
        width: 200,
        fontSize: 24,
        fill: "#000000",
        rotation: 0,
      },
    ])]);
    const after = project([page("page-1", [
      image("hero", {
        x: 30,
        y: 50,
        width: 160,
        height: 240,
        rotation: 15,
        src: "asset://hero-v2",
        groupId: "foreground",
        opacity: 0.5,
        hidden: true,
      }),
      {
        id: "dialogue",
        type: "text",
        text: "다시 만나",
        x: 0,
        y: 0,
        width: 200,
        fontSize: 30,
        fill: "#ff0000",
        rotation: 0,
      },
    ])]);

    const result = diffStudioProjectRevisions(before, after);
    const heroChange = (kind: StudioRevisionChange["kind"]) =>
      changesOfKind(result.changes, kind).find((change) => change.elementId === "hero");

    expect(heroChange("element-moved")).toMatchObject({
      fields: ["x", "y"],
      before: { x: 10, y: 20 },
      after: { x: 30, y: 50 },
    });
    expect(heroChange("element-resized")).toMatchObject({
      fields: ["height", "width"],
      before: { height: 200, width: 100 },
      after: { height: 240, width: 160 },
    });
    expect(heroChange("element-rotated")).toMatchObject({
      fields: ["rotation"],
      before: { rotation: 0 },
      after: { rotation: 15 },
    });
    expect(heroChange("element-source-changed")?.fields).toEqual(["src"]);
    expect(heroChange("element-group-changed")?.fields).toEqual(["groupId"]);
    expect(heroChange("element-style-changed")?.fields).toEqual(["opacity"]);
    expect(heroChange("element-metadata-changed")?.fields).toEqual(["hidden"]);

    const dialogueText = changesOfKind(result.changes, "element-text-changed")[0];
    const dialogueStyle = changesOfKind(result.changes, "element-style-changed")
      .find((change) => change.elementId === "dialogue");
    expect(dialogueText).toMatchObject({ elementId: "dialogue", fields: ["text"] });
    expect(dialogueStyle?.fields).toEqual(["fill", "fontSize"]);
  });

  it("uses stable IDs for element add/remove/reparent and ignores index shifts caused only by insertion", () => {
    const before = project([
      page("page-1", [
        image("keep-a"),
        image("reparent"),
        image("removed"),
        image("keep-b"),
      ]),
      page("page-2", [image("stay")]),
    ]);
    const after = project([
      page("page-1", [
        image("keep-b"),
        image("added"),
        image("keep-a"),
      ]),
      page("page-2", [image("stay"), image("reparent")]),
    ]);

    const result = diffStudioProjectRevisions(before, after);

    expect(changesOfKind(result.changes, "element-added")).toEqual([
      expect.objectContaining({ pageId: "page-1", elementId: "added", afterIndex: 1 }),
    ]);
    expect(changesOfKind(result.changes, "element-removed")).toEqual([
      expect.objectContaining({ pageId: "page-1", elementId: "removed", beforeIndex: 2 }),
    ]);
    expect(changesOfKind(result.changes, "element-reparented")).toEqual([
      expect.objectContaining({
        pageId: "page-2",
        previousPageId: "page-1",
        elementId: "reparent",
        beforeIndex: 1,
        afterIndex: 1,
      }),
    ]);
    expect(changesOfKind(result.changes, "element-order-changed")).toEqual([
      expect.objectContaining({
        pageId: "page-1",
        commonElementCount: 2,
        firstChangedElementId: "keep-b",
      }),
    ]);
  });

  it("keeps only deterministic bounded details while preserving exact totals and summary", () => {
    const elementCount = STUDIO_REVISION_CHANGE_DETAIL_LIMIT + 97;
    const beforeElements = Array.from({ length: elementCount }, (_, index) =>
      image(`element-${String(index).padStart(4, "0")}`, { x: 0 })
    );
    const afterElements = beforeElements.map((element) => ({ ...element, x: 1 }));

    const result = diffStudioProjectRevisions(
      project([page("page-1", beforeElements)]),
      project([page("page-1", afterElements)])
    );

    expect(result.totalChanges).toBe(elementCount);
    expect(result.summary["element-moved"]).toBe(elementCount);
    expect(Object.values(result.summary).reduce((total, count) => total + count, 0)).toBe(elementCount);
    expect(result.truncated).toBe(true);
    expect(result.changes).toHaveLength(STUDIO_REVISION_CHANGE_DETAIL_LIMIT);
    expect(result.changes[0]).toMatchObject({ elementId: "element-0000" });
    expect(result.changes.at(-1)).toMatchObject({ elementId: "element-0239" });
  });

  it("bounds extension field descriptors while retaining the exact field count", () => {
    const extensionFields = Object.fromEntries(
      Array.from({ length: STUDIO_REVISION_CHANGE_FIELD_LIMIT + 12 }, (_, index) => [`custom-${index}`, index])
    );
    const result = diffStudioProjectRevisions(
      project([page("page-1", [image("hero")])]),
      project([page("page-1", [image("hero", extensionFields)])])
    );
    const style = changesOfKind(result.changes, "element-style-changed")[0];

    expect(style.fields).toHaveLength(STUDIO_REVISION_CHANGE_FIELD_LIMIT);
    expect(style.fieldCount).toBe(STUDIO_REVISION_CHANGE_FIELD_LIMIT + 12);
  });

  it("rejects overlong stable IDs without copying their full value into errors", () => {
    const privateSuffix = "private-value-that-must-not-leak";
    const longId = `${"x".repeat(STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT + 1)}${privateSuffix}`;
    let caught: unknown;
    try {
      diffStudioProjectRevisions(project([page(longId)]), project([page("page-1")]));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StudioRevisionDiffError);
    expect(caught).toMatchObject({ code: "STABLE_ID_TOO_LONG" });
    expect(JSON.stringify(caught)).not.toContain(privateSuffix);
    expect((caught as Error).message).not.toContain(privateSuffix);
  });

  it("fails explicitly when stable page or element identity is ambiguous", () => {
    const duplicatePage = project([page("same"), page("same")]);
    const duplicateElement = project([
      page("page-1", [image("same-element")]),
      page("page-2", [image("same-element")]),
    ]);
    const invalidElement = project([page("page-1", [{ id: "valid" }, { id: "" }])]);
    const valid = project([page("page-1")]);

    const capture = (run: () => unknown): StudioRevisionDiffError => {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(StudioRevisionDiffError);
        return error as StudioRevisionDiffError;
      }
      throw new Error("expected StudioRevisionDiffError");
    };

    expect(capture(() => diffStudioProjectRevisions(duplicatePage, valid))).toMatchObject({
      code: "DUPLICATE_PAGE_ID",
      side: "before",
      stableId: "same",
    });
    expect(capture(() => diffStudioProjectRevisions(duplicateElement, valid))).toMatchObject({
      code: "DUPLICATE_ELEMENT_ID",
      side: "before",
      stableId: "same-element",
    });
    expect(capture(() => diffStudioProjectRevisions(invalidElement, valid))).toMatchObject({
      code: "INVALID_ELEMENT_ID",
      side: "before",
      pageId: "page-1",
    });
  });
});
