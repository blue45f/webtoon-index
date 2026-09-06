import { describe, expect, it } from "vitest";

import { groupItems, moveLayerGroup, ungroupItems } from "../studio-layers";

import { StudioCrdtDocument } from "./studio-crdt-document";
import { reconcileStudioCrdtSceneGraphHistory } from "./studio-crdt-history";
import { reconcileStudioCrdtSceneGraphPages } from "./studio-crdt-page-bridge";
import { publishStudioCrdtSceneGraphDiff } from "./studio-crdt-scene-publisher";

interface TestElement {
  id: string;
  type: string;
  groupId?: string;
  [key: string]: unknown;
}

interface TestPage {
  id: string;
  elements: TestElement[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  groups?: Array<{ id: string; name: string; hidden?: boolean; locked?: boolean }>;
}

function draw(id: string, stroke: string, groupId?: string): TestElement {
  return {
    id,
    type: "draw",
    points: [10, 10, 200, 200],
    stroke,
    strokeWidth: 12,
    ...(groupId ? { groupId } : {}),
  };
}

function text(id: string, fill: string): TestElement {
  return {
    id,
    type: "text",
    text: "대사",
    x: 10,
    y: 20,
    width: 240,
    fontSize: 28,
    fill,
    rotation: 0,
  };
}

function page(
  elements: TestElement[],
  groups: TestPage["groups"] = [],
  id = "page-a"
): TestPage {
  return { id, elements, groups, bg: "#ffffff", bgGrad: null, canvasH: 1600 };
}

function ids(pages: readonly TestPage[], pageId = "page-a"): string[] {
  return pages.find((candidate) => candidate.id === pageId)!.elements.map(({ id }) => id);
}

function merge(document: StudioCrdtDocument, pages: TestPage[]): TestPage[] {
  return reconcileStudioCrdtSceneGraphPages(
    pages,
    document.getStrokes({ includeDeleted: true }),
    document.getSceneElements({ includeDeleted: true }),
    document.getPages(true),
    document.getLayerGroups({ includeDeleted: true })
  ).pages;
}

/** Applies one authored transition exactly the way `commit()` does: publish, then merge. */
function commit(
  document: StudioCrdtDocument,
  previous: TestPage[],
  next: TestPage[]
): TestPage[] {
  publishStudioCrdtSceneGraphDiff(document, previous, next);
  return merge(document, next);
}

/** BACK -> FRONT: red, green, blue, orange. The topmost element is the last array entry. */
function seed(document: StudioCrdtDocument, extraPages: TestPage[] = []): TestPage[] {
  const initial = [
    page([
      draw("red", "#ff0000"),
      draw("green", "#00ff00"),
      draw("blue", "#0000ff"),
      draw("orange", "#ff8800"),
    ]),
    ...extraPages,
  ];
  return commit(document, [], initial);
}

function grouped(pages: TestPage[], memberIds: string[], groupId = "g1"): TestPage[] {
  return pages.map((candidate) => (candidate.id !== "page-a" ? candidate : {
    ...candidate,
    groups: [...(candidate.groups ?? []), { id: groupId, name: "그룹 1" }],
    elements: groupItems(candidate.elements, memberIds, groupId),
  }));
}

describe("studio CRDT scene graph z-order under grouping", () => {
  // Regression: a layer reparent used to push the shared `stroke-order` entry to the tail, and the
  // publisher skipped the order pass because `groupItems` leaves the authored array order intact.
  // Grouping therefore repainted the canvas as "ungrouped elements first, group members last".
  it("keeps document z-order when the middle two elements are grouped", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);
    expect(ids(base)).toEqual(["red", "green", "blue", "orange"]);

    const next = grouped(base, ["green", "blue"]);
    expect(ids(next)).toEqual(["red", "green", "blue", "orange"]);
    expect(ids(commit(document, base, next))).toEqual(["red", "green", "blue", "orange"]);
    document.destroy();
  });

  it("keeps document z-order when the bottom two elements are grouped", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);

    const next = grouped(base, ["red", "green"]);
    expect(ids(next)).toEqual(["red", "green", "blue", "orange"]);
    expect(ids(commit(document, base, next))).toEqual(["red", "green", "blue", "orange"]);
    document.destroy();
  });

  it("keeps document z-order when the topmost two elements are grouped", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);

    const next = grouped(base, ["blue", "orange"]);
    expect(ids(commit(document, base, next))).toEqual(["red", "green", "blue", "orange"]);
    document.destroy();
  });

  // "아래와 묶기" — the merge-down fallback groups the selection with the layer directly below it.
  it("keeps document z-order for the merge-down group fallback", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);

    const next = grouped(base, ["green", "blue"], "merged");
    expect(ids(commit(document, base, next))).toEqual(["red", "green", "blue", "orange"]);
    document.destroy();
  });

  it("keeps document z-order across ungroup", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);
    const groupedPages = commit(document, base, grouped(base, ["green", "blue"]));

    const ungrouped = groupedPages.map((candidate) => ({
      ...candidate,
      groups: [],
      elements: ungroupItems(candidate.elements, "g1"),
    }));
    expect(ids(commit(document, groupedPages, ungrouped)))
      .toEqual(["red", "green", "blue", "orange"]);
    document.destroy();
  });

  it("keeps document z-order when a non-draw scene element joins a group", () => {
    const document = new StudioCrdtDocument();
    const base = commit(document, [], [page([
      draw("red", "#ff0000"),
      text("caption", "#00ff00"),
      draw("blue", "#0000ff"),
      draw("orange", "#ff8800"),
    ])]);
    expect(ids(base)).toEqual(["red", "caption", "blue", "orange"]);

    const next = grouped(base, ["caption", "blue"]);
    expect(ids(commit(document, base, next))).toEqual(["red", "caption", "blue", "orange"]);
    document.destroy();
  });

  it("still honours explicit reordering after a group was created", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);
    const groupedPages = commit(document, base, grouped(base, ["green", "blue"]));

    // Drag the whole group to the very back through the layer navigator.
    const reordered = groupedPages.map((candidate) => ({
      ...candidate,
      elements: moveLayerGroup(candidate.elements, "g1", "down"),
    }));
    expect(ids(commit(document, groupedPages, reordered)))
      .toEqual(["green", "blue", "red", "orange"]);
    document.destroy();
  });

  it("keeps z-order stable across an undo snapshot reconciliation", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document);
    const groupedPages = commit(document, base, grouped(base, ["green", "blue"]));

    const history = [base, groupedPages];
    const reconciled = reconcileStudioCrdtSceneGraphHistory(history, 1, {
      strokes: document.getStrokes({ includeDeleted: true }),
      sceneElements: document.getSceneElements({ includeDeleted: true }),
      pages: document.getPages(true),
      layerGroups: document.getLayerGroups({ includeDeleted: true }),
    }, null);
    for (const snapshot of reconciled.history) {
      expect(ids(snapshot as TestPage[])).toEqual(["red", "green", "blue", "orange"]);
    }
    document.destroy();
  });

  it("converges peers on the grouped z-order", () => {
    const local = new StudioCrdtDocument();
    const base = seed(local);
    const remote = new StudioCrdtDocument(local.encodeStateAsUpdate());

    commit(local, base, grouped(base, ["green", "blue"]));
    remote.applyUpdate(local.encodeStateAsUpdate(remote.encodeStateVector()));

    expect(ids(merge(remote, base))).toEqual(["red", "green", "blue", "orange"]);
    local.destroy();
    remote.destroy();
  });

  // Fallback contract: a cross-page reparent has no slot to preserve on the destination page, so it
  // keeps the historical "append to the destination tail" behaviour.
  it("appends to the destination tail when an element changes page", () => {
    const document = new StudioCrdtDocument();
    const base = seed(document, [page([draw("violet", "#8800ff")], [], "page-b")]);
    expect(ids(base, "page-b")).toEqual(["violet"]);

    const moved = base.map((candidate) => {
      if (candidate.id === "page-a") {
        return {
          ...candidate,
          elements: candidate.elements.filter(({ id }) => id !== "green"),
        };
      }
      return {
        ...candidate,
        elements: [...candidate.elements, draw("green", "#00ff00")],
      };
    });
    const result = commit(document, base, moved);
    expect(ids(result)).toEqual(["red", "blue", "orange"]);
    expect(ids(result, "page-b")).toEqual(["violet", "green"]);
    document.destroy();
  });
});
