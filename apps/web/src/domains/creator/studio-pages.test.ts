import { describe, expect, it } from "vitest";

import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import {
  adoptMissingPage,
  appendPageState,
  applyBackgroundToAllPages,
  applyGradeToAllPages,
  clearPage,
  computeNextActiveIdAfterBulkDelete,
  computeNextActiveIdAfterDelete,
  createBlankPage,
  deletePageSafe,
  deletePagesBulk,
  duplicateMirroredPage,
  duplicatePageState,
  executeDeletePageTransition,
  findPageIndex,
  insertBlankPageAt,
  movePage,
  movePagesBulk,
  normalizeSelectedPageIds,
  reorderPages,
  type PageLike,
} from "./studio-pages";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";
import { createNativePluralShared3dStageFixture } from "./studio-shared-3d-stage-test-fixture";

const CANVAS_W = 720;
let idCounter = 0;
const makeId = () => `p${++idCounter}`;

function resetIds() {
  idCounter = 0;
}

function samplePage(over: Partial<PageLike> = {}): PageLike {
  return {
    id: "p0",
    elements: [{ id: "e1", type: "image", x: 10, y: 20, width: 100, height: 80 }],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1080,
    ...over,
  };
}

describe("studio-pages (pure, real exports)", () => {
  it("createBlankPage produces fresh page with caller id and defaults", () => {
    resetIds();
    const p = createBlankPage(makeId);
    expect(p.id).toBe("p1");
    expect(p.elements).toEqual([]);
    expect(p.bg).toBe("#ffffff");
    expect(p.canvasH).toBe(1080);
    expect(p.bgGrad).toBeNull();
  });

  it("duplicatePageState clones structure with brand new ids for page and all elements; does not mutate input", () => {
    resetIds();
    const orig: PageLike = samplePage({ id: "orig", elements: [{ id: "eA", x: 5 }] });
    const dup = duplicatePageState(orig, makeId);
    expect(dup.id).toBe("p1");
    expect(dup).not.toBe(orig);
    expect(dup.elements).not.toBe(orig.elements);
    expect(dup.elements[0]).not.toBe(orig.elements[0]);
    expect(dup.elements[0]!.id).toBe("p2");
    expect(dup.elements[0]!.x).toBe(5);
    // orig intact
    expect(orig.id).toBe("orig");
    expect(orig.elements[0]!.id).toBe("eA");
  });

  it("duplicate/mirror가 linked3dRender의 전체 LT element receipt를 새 페이지 ID로 remap한다", () => {
    const source = createStudioLinked3dRenderPageFixture("linked-copy") as PageLike;
    const linked3dRender = source.linked3dRender;

    resetIds();
    const duplicate = duplicatePageState(source, makeId);
    expect(duplicate.linked3dRender).toMatchObject({
      links: [{
        bundleId: "linked-copy-bundle",
        layers: [{ elementId: "p2", role: "main-line" }],
      }],
    });

    resetIds();
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);
    expect(mirrored.linked3dRender).toMatchObject({
      links: [{
        layers: [{ elementId: "p1", role: "main-line" }],
      }],
    });
    expect(source.linked3dRender).toBe(linked3dRender);
  });

  it("remaps Shared Stage character links while retaining the page-local LT bundle", () => {
    const sourceHash = `sha256:${"a".repeat(64)}`;
    const stage = {
      kind: "toonspectrum.studio-shared-3d-stage",
      version: 1,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: { bundleId: "bundle-1", sourceHash },
      characters: [{
        elementId: "character",
        modelRuntimeKey: `character:sha256:${"b".repeat(64)}`,
        sourceHash,
        hiddenByStage: true,
      }],
    };
    const source = samplePage({
      id: "source-page",
      elements: [
        { id: "background", type: "image", x: 0, width: 100 },
        { id: "character", type: "image", x: 200, width: 100 },
      ],
      shared3dStage: stage,
    });

    resetIds();
    const duplicate = duplicatePageState(source, makeId);
    expect(duplicate.shared3dStage).toMatchObject({
      kind: "toonspectrum.studio-shared-3d-stage-collection",
      version: 3,
      stages: [{
        background: { bundleId: "bundle-1", sourceHash },
        characters: [{
          elementId: "p3",
          modelRuntimeKey: `p3:sha256:${"b".repeat(64)}`,
          sourceHash,
        }],
      }],
      visibilityReceipts: [{
        elementId: "p3",
        modelRuntimeKey: `p3:sha256:${"b".repeat(64)}`,
      }],
    });

    resetIds();
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);
    expect(mirrored.shared3dStage).toMatchObject({
      stages: [{
        background: { bundleId: "bundle-1", sourceHash },
        characters: [{
          elementId: "p2",
          modelRuntimeKey: `p2:sha256:${"b".repeat(64)}`,
          sourceHash,
        }],
      }],
      visibilityReceipts: [{ elementId: "p2" }],
    });
    expect(source.shared3dStage).toBe(stage);
  });

  it("remaps one shared character once while preserving two independent Stage placements", () => {
    const shared3dStage = createNativePluralShared3dStageFixture();
    const source = samplePage({
      id: "source-page",
      elements: [
        { id: "background-a", type: "image", x: 0 },
        { id: "background-b", type: "image", x: 100 },
        { id: "character-native-shared", type: "image", x: 200 },
      ],
      shared3dStage,
    });

    resetIds();
    const duplicate = duplicatePageState(source, makeId);
    const duplicateCollection = migrateStudioShared3dStageCollectionDocument(
      duplicate.shared3dStage,
    )!;
    const duplicateStages = duplicateCollection.stages;
    expect(duplicateStages).toHaveLength(2);
    expect(duplicateStages[0]?.characters[0]?.elementId).toBe("p4");
    expect(duplicateStages[1]?.characters[0]?.elementId).toBe("p4");
    expect(duplicateStages.map((stage) => stage.characters[0]?.placement)).toEqual([
      { position: [1, 0.25, -2], rotationY: 0.5 },
      { position: [-4, 1, 3], rotationY: -1.2 },
    ]);
    expect(duplicateCollection.visibilityReceipts).toHaveLength(1);

    resetIds();
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);
    const mirroredStages = migrateStudioShared3dStageCollectionDocument(
      mirrored.shared3dStage,
    )!.stages;
    expect(mirroredStages[0]?.characters[0]?.elementId).toBe("p3");
    expect(mirroredStages[1]?.characters[0]?.elementId).toBe("p3");
    expect(mirroredStages.map((stage) => stage.characters[0]?.placement)).toEqual(
      duplicateStages.map((stage) => stage.characters[0]?.placement),
    );
    expect(source.shared3dStage).toBe(shared3dStage);
  });

  it("gives a missing Shared Stage character tombstone a fresh page-local id", () => {
    const sourceHash = `sha256:${"a".repeat(64)}`;
    const missingId = "missing-character";
    const stage = {
      kind: "toonspectrum.studio-shared-3d-stage",
      version: 1,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: { bundleId: "bundle-1", sourceHash },
      characters: [{
        elementId: missingId,
        modelRuntimeKey: `${missingId}:sha256:${"b".repeat(64)}`,
        sourceHash,
        hiddenByStage: true,
      }],
    };
    const source = samplePage({
      id: "source-page",
      elements: [{ id: "background", type: "image", x: 0, width: 100 }],
      shared3dStage: stage,
    });

    resetIds();
    const duplicate = duplicatePageState(source, makeId);
    expect(duplicate.shared3dStage).toMatchObject({
      stages: [{ characters: [{
        elementId: "p3",
        modelRuntimeKey: `p3:sha256:${"b".repeat(64)}`,
      }] }],
      visibilityReceipts: [{
        elementId: "p3",
        modelRuntimeKey: `p3:sha256:${"b".repeat(64)}`,
      }],
    });
    expect(JSON.stringify(duplicate.shared3dStage)).not.toContain(missingId);

    resetIds();
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);
    expect(mirrored.shared3dStage).toMatchObject({
      stages: [{ characters: [{ elementId: "p3" }] }],
      visibilityReceipts: [{ elementId: "p3" }],
    });
    expect(JSON.stringify(mirrored.shared3dStage)).not.toContain(missingId);
  });

  it("keeps an ambiguous duplicate character link as a fresh missing tombstone", () => {
    const sourceHash = `sha256:${"a".repeat(64)}`;
    const stage = {
      kind: "toonspectrum.studio-shared-3d-stage",
      version: 1,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: { bundleId: "bundle-1", sourceHash },
      characters: [{
        elementId: "character-a",
        modelRuntimeKey: `character-a:sha256:${"b".repeat(64)}`,
        sourceHash,
        hiddenByStage: true,
      }],
    };
    const source = samplePage({
      id: "source-page",
      elements: [
        { id: "character-a", type: "image", x: 10 },
        { id: "character-a", type: "image", x: 20 },
      ],
      shared3dStage: stage,
    });

    resetIds();
    const duplicate = duplicatePageState(source, makeId);
    expect(duplicate.elements.map(({ id }) => id)).toEqual(["p2", "p3"]);
    expect(duplicate.shared3dStage).toMatchObject({
      stages: [{ characters: [{ elementId: "p4" }] }],
      visibilityReceipts: [{ elementId: "p4" }],
    });

    resetIds();
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);
    expect(mirrored.elements.map(({ id }) => id)).toEqual(["p1", "p2"]);
    expect(mirrored.shared3dStage).toMatchObject({
      stages: [{ characters: [{ elementId: "p4" }] }],
      visibilityReceipts: [{ elementId: "p4" }],
    });
    expect(source.elements[0]?.id).toBe("character-a");
    expect(source.elements[1]?.id).toBe("character-a");
  });

  it("insertBlankPageAt inserts at clamped index and preserves order of others", () => {
    resetIds();
    const p0 = samplePage({ id: "a" });
    const p1 = samplePage({ id: "b" });
    const res = insertBlankPageAt([p0, p1], 1, makeId, 1200);
    expect(res).toHaveLength(3);
    expect(res[0].id).toBe("a");
    expect(res[1].id).toBe("p1"); // new
    expect(res[1].canvasH).toBe(1200);
    expect(res[2].id).toBe("b");
  });

  it("reorderPages moves by index (adjusted) and is pure", () => {
    resetIds();
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    const c = samplePage({ id: "c" });
    const res = reorderPages([a, b, c], 0, 2);
    expect(res.map((p) => p.id)).toEqual(["b", "c", "a"]);
    // original unchanged
    expect([a, b, c].map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("deletePageSafe leaves at least one; removes by id", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    expect(deletePageSafe([a], "a")).toHaveLength(1);
    expect(deletePageSafe([a, b], "a").map((p) => p.id)).toEqual(["b"]);
  });

  it("movePage delegates to reorder for up/down", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    const c = samplePage({ id: "c" });
    expect(movePage([a, b, c], "a", 1).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(movePage([a, b, c], "c", -1).map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  it("clearPage removes elements, Shared Stage, and linked render receipt while keeping unrelated page fields", () => {
    const a = samplePage({
      id: "a",
      elements: [{ id: "e" }],
      shared3dStage: { sentinel: true },
      linked3dRender: { sentinel: true },
    });
    const b = samplePage({ id: "b", elements: [{ id: "f" }] });
    const res = clearPage([a, b], "a");
    expect(res[0].elements).toEqual([]);
    expect(res[0].shared3dStage).toBeUndefined();
    expect(res[0].linked3dRender).toBeUndefined();
    expect(res[1].elements.length).toBe(1);
    expect(res[0].bg).toBe(a.bg);
  });

  it("applyGradeToAllPages and applyBackgroundToAllPages set uniformly", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    const g = { contrast: 0.1 };
    const resG = applyGradeToAllPages([a, b], g);
    expect(resG[0].grade).toBe(g);
    expect(resG[1].grade).toBe(g);

    const resB = applyBackgroundToAllPages([a, b], "#111111", ["#000", "#fff"]);
    expect(resB[0].bg).toBe("#111111");
    expect(resB[0].bgGrad).toEqual(["#000", "#fff"]);
  });

  it("duplicateMirroredPage creates new ids and horizontally flips x/width/draw-points", () => {
    resetIds();
    const drawEl = {
      id: "d1",
      type: "draw",
      x: 100,
      width: 50,
      points: [100, 10, 120, 10, 140, 30],
    };
    const p = samplePage({ id: "src", elements: [drawEl as any] });
    const mir = duplicateMirroredPage(p, makeId, CANVAS_W);
    expect(mir.id).not.toBe("src");
    const me = mir.elements[0] as any;
    expect(me.id).not.toBe("d1");
    // x flipped: canvasW - x - w = 720-100-50=570
    expect(me.x).toBe(570);
    // points x flipped around canvas
    expect(me.points[0]).toBe(720 - 100);
    expect(me.points[2]).toBe(720 - 120);
    expect(me.points[4]).toBe(720 - 140);
  });

  it("duplicateMirroredPage mirrors bubble tail left<->right and tailXRatio (and text)", () => {
    resetIds();
    const bubble = {
      id: "b1",
      type: "bubble",
      x: 80,
      width: 120,
      tail: "left",
      tailDirection: "right",
      tailXRatio: 0.2,
      text: "hello",
    };
    const txt = { id: "t1", type: "text", x: 30, width: 80, text: "T" };
    const p = samplePage({ id: "src", elements: [bubble as any, txt as any] });
    const mir = duplicateMirroredPage(p, makeId, CANVAS_W);
    const mb = mir.elements.find((e: any) => e.type === "bubble") as any;
    expect(mb.id).not.toBe("b1");
    expect(mb.x).toBe(720 - 80 - 120); // 520
    expect(mb.tail).toBe("right");
    expect(mb.tailDirection).toBe("left");
    expect(mb.tailXRatio).toBeCloseTo(0.8);
    // text also gets id + x flip
    const mt = mir.elements.find((e: any) => e.type === "text") as any;
    expect(mt.x).toBe(720 - 30 - 80);
    expect(mt.id).not.toBe("t1");
  });

  it("duplicateMirroredPage mirrors drawing-assist horizontal anchors", () => {
    resetIds();
    const drawingAssist = {
      version: 2 as const,
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: 120, y: 300 }],
        eyeLevelY: 300,
        lockHorizon: true,
      },
      isometric: {
        active: false,
        angleDeg: 30,
        cellSize: 40,
        originX: 200,
        originY: 500,
      },
      advanced: {
        version: 1 as const,
        rulers: [],
        activeSnapRulerId: null,
        selectedRulerId: null,
      },
    };
    const source = samplePage({ drawingAssist });
    const mirrored = duplicateMirroredPage(source, makeId, CANVAS_W);

    expect(mirrored.drawingAssist).toEqual({
      ...drawingAssist,
      perspective: {
        active: true,
        points: [{ id: "vp-a", x: 600, y: 300 }],
        eyeLevelY: 300,
        lockHorizon: true,
      },
      isometric: { ...drawingAssist.isometric, originX: 520 },
    });
    expect(source.drawingAssist).toEqual(drawingAssist);
  });

  it("findPageIndex works", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    expect(findPageIndex([a, b], "b")).toBe(1);
    expect(findPageIndex([a, b], "z")).toBe(-1);
  });

  it("computeNextActiveIdAfterDelete selects correct neighbor (prev || next || [0])", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    // delete first -> prefer old [1] which is now [0] in remaining
    expect(computeNextActiveIdAfterDelete([a, b, c], "a")).toBe("b");
    // delete middle -> prefer prev
    expect(computeNextActiveIdAfterDelete([a, b, c], "b")).toBe("a");
    // delete last -> prefer prev
    expect(computeNextActiveIdAfterDelete([a, b, c], "c")).toBe("b");
    // single page -> null (caller guards length)
    expect(computeNextActiveIdAfterDelete([a], "a")).toBeNull();
  });

  it("deletePage full path simulation (pures + history/commit used by StudioPage) selects correct nextActive and produces immutable new list", () => {
    const p1 = { id: "p1", elements: [] };
    const p2 = { id: "p2", elements: [{ id: "e" }] };
    const p3 = { id: "p3", elements: [] };
    const before = [p1, p2, p3] as any;
    // simulate component: current = p2, delete p2
    const nextPages = deletePageSafe(before, "p2");
    const nextActiveId = computeNextActiveIdAfterDelete(before, "p2");
    // history would do commitPages(nextPages) i.e. new array
    expect(nextPages).not.toBe(before);
    expect(nextPages.map((p: any) => p.id)).toEqual(["p1", "p3"]);
    expect(nextActiveId).toBe("p1");
    // commit simulation: caller would setCurrentPageId(nextActiveId) if was current
    expect(nextPages.find((p: any) => p.id === nextActiveId)).toBeTruthy();
  });

  it("adoptMissingPage inserts a blank page with the given id once", () => {
    const before = [samplePage({ id: "p1" })] as PageLike[];
    const adopted = adoptMissingPage(before, "peer-page", 1200);
    expect(adopted).toHaveLength(2);
    expect(adopted[1]).toMatchObject({ id: "peer-page", canvasH: 1200, elements: [] });
    expect(adoptMissingPage(adopted, "peer-page", 1200)).toBe(adopted);
    expect(adoptMissingPage(before, "  ", 1200)).toBe(before);
  });

  it("appendPageState appends and returns new id (length +1, id present)", () => {
    const before = [samplePage({ id: "p1" })] as any;
    const res = appendPageState(before, () => "newp", 1080);
    expect(res.nextPages).toHaveLength(2);
    expect(res.newPageId).toBe("newp");
    expect(res.nextPages[1].id).toBe("newp");
    expect(res.nextPages).not.toBe(before);
  });

  it("executeDeletePageTransition deletes and suggests correct nextActiveId (pure)", () => {
    const p1 = { id: "p1", elements: [] } as any;
    const p2 = { id: "p2", elements: [] } as any;
    const before = [p1, p2];
    const res = executeDeletePageTransition(before, "p2", "p2");
    expect(res.nextPages.map((p: any) => p.id)).toEqual(["p1"]);
    expect(res.nextActiveId).toBe("p1");
  });

  it("normalizeSelectedPageIds keeps document order and drops unknown/dupes", () => {
    const pages = [samplePage({ id: "a" }), samplePage({ id: "b" }), samplePage({ id: "c" })];
    expect(normalizeSelectedPageIds(pages, ["c", "a", "c", "z"])).toEqual(["a", "c"]);
    expect(normalizeSelectedPageIds(pages, [])).toEqual([]);
  });

  it("deletePagesBulk removes selected pages but always keeps ≥1", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    const c = samplePage({ id: "c" });
    const bulk = deletePagesBulk([a, b, c], ["a", "c"]);
    expect(bulk.nextPages.map((p) => p.id)).toEqual(["b"]);
    expect(bulk.removedIds).toEqual(["a", "c"]);
    expect(bulk.keptIds).toEqual(["b"]);

    const wipe = deletePagesBulk([a, b], ["a", "b"]);
    expect(wipe.nextPages.map((p) => p.id)).toEqual(["a"]);
    expect(wipe.removedIds).toEqual(["b"]);

    const single = deletePagesBulk([a], ["a"]);
    expect(single.nextPages.map((p) => p.id)).toEqual(["a"]);
    expect(single.removedIds).toEqual([]);
  });

  it("movePagesBulk shifts the selected block by delta while preserving relative order", () => {
    const a = samplePage({ id: "a" });
    const b = samplePage({ id: "b" });
    const c = samplePage({ id: "c" });
    const d = samplePage({ id: "d" });
    const pages = [a, b, c, d];
    expect(movePagesBulk(pages, ["a", "c"], 1).map((p) => p.id)).toEqual(["b", "a", "c", "d"]);
    expect(movePagesBulk(pages, ["b", "c"], -1).map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
    // non-contiguous selection stays relative-ordered as a block
    expect(movePagesBulk(pages, ["a", "d"], 1).map((p) => p.id)).toEqual(["b", "a", "d", "c"]);
    // no-op / empty
    expect(movePagesBulk(pages, [], 1).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(movePagesBulk(pages, ["a"], 0).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("computeNextActiveIdAfterBulkDelete keeps current when surviving, else nearest neighbour", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const d = { id: "d" };
    const prev = [a, b, c, d];
    const nextKeep = [a, c, d];
    expect(computeNextActiveIdAfterBulkDelete(prev, nextKeep, "c")).toBe("c");
    expect(computeNextActiveIdAfterBulkDelete(prev, nextKeep, "b")).toBe("a");
    expect(computeNextActiveIdAfterBulkDelete(prev, [c, d], "a")).toBe("c");
    expect(computeNextActiveIdAfterBulkDelete(prev, [a], "d")).toBe("a");
  });
});
