import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "../bg3d/studio-bg3d-scene-document";
import { createStudioShared3dStageDocument } from "../studio-shared-3d-stage-document";
import { createNativePluralShared3dStageFixture } from "../studio-shared-3d-stage-test-fixture";
import { createStudioStickyNoteElement } from "../studio-sticky-note";
import { createStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

import {
  StudioCrdtDocument,
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT,
  STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT,
  studioCrdtShared3dStageCompositeKey,
  studioCrdtShared3dStageRecordRootName,
  type StudioCrdtStrokeInput,
} from "./studio-crdt-document";
import {
  reconcileStudioCrdtSceneGraphPages,
  studioCrdtElementToSceneElement,
} from "./studio-crdt-page-bridge";
import {
  planStudioCrdtOrderMoves,
  publishStudioCrdtDrawGraphDiff,
  publishStudioCrdtSceneGraphDiff,
} from "./studio-crdt-scene-publisher";

import type { StudioPaperSurfaceSettings } from "../brush/studio-paper-granulation-runtime";
import type { StudioShared3dStagePersistedState } from "../studio-shared-3d-stage-collection";

interface TestElement {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface TestPage {
  id: string;
  elements: TestElement[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  name?: string;
  note?: string;
  paperSurface?: StudioPaperSurfaceSettings;
  paperGrainVisible?: boolean;
  shared3dStage?: StudioShared3dStagePersistedState;
}

function text(id: string, overrides: Record<string, unknown> = {}): TestElement {
  return {
    id,
    type: "text",
    text: "기준 대사",
    x: 10,
    y: 20,
    width: 240,
    fontSize: 28,
    fill: "#111111",
    rotation: 0,
    ...overrides,
  };
}

function drawElement(id: string, overrides: Record<string, unknown> = {}): TestElement {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 10, 10],
    pressures: [0.5, 0.5],
    stroke: "#111111",
    strokeWidth: 4,
    ...overrides,
  };
}

function page(id: string, elements: TestElement[] = [], overrides: Partial<TestPage> = {}): TestPage {
  return {
    id,
    elements,
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1600,
    ...overrides,
  };
}

function stroke(id: string, pageId = "page-a"): StudioCrdtStrokeInput {
  return {
    id,
    pageId,
    layerId: "page-root",
    payload: {
      version: 1,
      type: "draw",
      kind: "freehand",
      mode: "pen",
      stroke: "#111111",
      strokeWidth: 4,
      points: [0, 0, 10, 10],
      pressures: [0.5, 0.5],
    },
  };
}

function linkedCharacterPages() {
  const vrmScene = createStudioVrmSceneDocument();
  const visibleCharacter: TestElement = {
    id: "character-a",
    type: "image",
    hidden: false,
    vrmScene,
  };
  const hiddenCharacter: TestElement = { ...visibleCharacter, hidden: true };
  const shared3dStage = createStudioShared3dStageDocument({
    backgroundBundleId: "bundle-a",
    elements: [
      {
        id: "background-a",
        type: "image",
        bg3dLtBundleId: "bundle-a",
        bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      },
      hiddenCharacter,
    ],
    characterElementIds: [hiddenCharacter.id],
    hiddenByStageElementIds: [hiddenCharacter.id],
  });
  if (!shared3dStage) throw new Error("invalid linked character fixture");
  return {
    disconnected: [page("page-a", [visibleCharacter])],
    connected: [page("page-a", [hiddenCharacter], { shared3dStage })],
    manuallyHidden: [page("page-a", [hiddenCharacter])],
  } as const;
}

function managedSharedStageSnapshot(pageCount: number): Uint8Array {
  const raw = new Y.Doc();
  const pageIndex = raw.getMap<boolean>("studio-pages");
  const stageIndex = raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_RECORDS_ROOT);
  raw.getMap<boolean>(STUDIO_CRDT_SHARED_3D_STAGE_VISIBILITY_RECEIPTS_ROOT);
  raw.transact(() => {
    for (let index = 0; index < pageCount; index += 1) {
      const pageId = `page-publish-cache-${index}`;
      const pageRecord = raw.getMap<unknown>(`studio-page:${encodeURIComponent(pageId)}`);
      pageIndex.set(pageId, true);
      pageRecord.set("id", pageId);
      pageRecord.set("payloadVersion", STUDIO_CRDT_PAGE_PAYLOAD_VERSION);
      pageRecord.set("prop:bg", "#fff");
      pageRecord.set("prop:bgGrad", null);
      pageRecord.set("prop:canvasH", 1_600);

      const stageId = `stage-publish-cache-${index}`;
      const stageKey = studioCrdtShared3dStageCompositeKey(pageId, stageId);
      const stageRecord = raw.getMap<unknown>(studioCrdtShared3dStageRecordRootName(stageKey));
      stageRecord.set("pageId", pageId);
      stageRecord.set("stageId", stageId);
      stageRecord.set("payloadVersion", STUDIO_CRDT_SHARED_3D_STAGE_PAYLOAD_VERSION);
      stageRecord.set("order", 0);
      stageRecord.set("payload", JSON.stringify({
        id: stageId,
        capturePolicy: "background-only",
        background: {
          bundleId: `bundle-publish-cache-${index}`,
          sourceHash: `sha256:${"a".repeat(64)}`,
        },
        characters: [],
      }));
      stageRecord.set("activate:0", true);
      stageIndex.set(stageKey, true);
    }
  });
  try {
    return Y.encodeStateAsUpdate(raw);
  } finally {
    raw.destroy();
  }
}

describe("studio CRDT scene publisher", () => {
  it("reads the Shared Stage frontier once for a multi-page scene publish", () => {
    const document = new StudioCrdtDocument();
    const getFrontier = vi.spyOn(document, "getShared3dStageFrontier");
    const getPageState = vi.spyOn(document, "getShared3dStagePageState");
    const pages = Array.from({ length: 128 }, (_, index) => page(`page-${index}`));

    publishStudioCrdtSceneGraphDiff(document, pages, pages);

    expect(getFrontier).toHaveBeenCalledTimes(1);
    expect(getPageState).not.toHaveBeenCalled();
    document.destroy();
  });

  it("parses each managed Shared Stage once for an identical many-page publish", () => {
    const pageCount = 128;
    const document = new StudioCrdtDocument(managedSharedStageSnapshot(pageCount));
    const pages = document.getPages().map((record) => page(record.id, [], {
      shared3dStage: record.shared3dStage,
    }));
    expect(pages.every(({ shared3dStage }) => shared3dStage !== undefined)).toBe(true);
    const parse = vi.spyOn(JSON, "parse");

    try {
      expect(publishStudioCrdtSceneGraphDiff(document, pages, pages)).toEqual({
        sceneElementMutations: 0,
        layerGroupMutations: 0,
        pageMutations: 0,
        elementMoves: 0,
        pageMoves: 0,
      });
      const stagePayloadParseCount = parse.mock.calls.filter(([value]) =>
        typeof value === "string" && value.startsWith('{"id":"stage-publish-cache-'))
        .length;
      expect(stagePayloadParseCount).toBe(pageCount);
    } finally {
      parse.mockRestore();
      document.destroy();
    }
  });

  it("publishes Shared Stage authority outside the page envelope and hydrates it on a peer", () => {
    const source = new StudioCrdtDocument();
    const shared3dStage = createNativePluralShared3dStageFixture();

    publishStudioCrdtSceneGraphDiff(
      source,
      [page("page-a")],
      [page("page-a", [], { shared3dStage })],
    );

    expect(source.getPage("page-a")?.payload.props).not.toHaveProperty("shared3dStage");
    expect(source.getPage("page-a")?.shared3dStageManaged).toBe(true);
    expect(source.getPage("page-a")?.shared3dStage).toEqual(shared3dStage);

    const peer = new StudioCrdtDocument(source.encodeStateAsUpdate());
    expect(peer.getPage("page-a")?.payload.props).not.toHaveProperty("shared3dStage");
    expect(peer.getPage("page-a")?.shared3dStageManaged).toBe(true);
    expect(peer.getPage("page-a")?.shared3dStage).toEqual(shared3dStage);
    peer.destroy();
    source.destroy();
  });

  it("still bootstraps a missing managed page and sweeps its sidecar on page deletion", () => {
    const document = new StudioCrdtDocument();
    const shared3dStage = createNativePluralShared3dStageFixture();
    const connected = [page("page-a", [], { shared3dStage })];
    document.publishShared3dStagePageDiff("page-a", undefined, shared3dStage);
    expect(document.getPage("page-a", true)).toBeNull();

    expect(publishStudioCrdtSceneGraphDiff(document, connected, connected).pageMutations).toBe(1);
    expect(document.getPage("page-a")?.shared3dStage).toEqual(shared3dStage);

    publishStudioCrdtSceneGraphDiff(document, connected, []);
    expect(document.getPage("page-a", true)?.deleted).toBe(true);
    expect(document.getShared3dStagePageState("page-a")).toEqual({
      pageId: "page-a",
      managed: true,
      value: undefined,
    });
    document.destroy();
  });

  it("rejects a malformed Shared Stage before creating a page or scene element", () => {
    const document = new StudioCrdtDocument();
    const invalid = {
      kind: "toonspectrum.studio-shared-3d-stage-collection",
      version: 3,
      authority: "page-shared-3d-stage-collection",
      stages: [],
      visibilityReceipts: [],
    } as unknown as StudioShared3dStagePersistedState;

    expect(() => publishStudioCrdtSceneGraphDiff(
      document,
      [page("page-a")],
      [page("page-a", [text("must-not-publish")], { shared3dStage: invalid })],
    )).toThrow("공유 3D 장면 연결 정보가 손상되었습니다");
    expect(document.getPages(true)).toEqual([]);
    expect(document.getSceneElements({ includeDeleted: true })).toEqual([]);
    expect(document.getShared3dStageFrontier()).toEqual([]);
    document.destroy();
  });

  it("uses an inactive Shared Stage tombstone to remove a stale local connection", () => {
    const document = new StudioCrdtDocument();
    const shared3dStage = createNativePluralShared3dStageFixture();
    const connected = [page("page-a", [], { shared3dStage })];
    const disconnected = [page("page-a")];
    publishStudioCrdtSceneGraphDiff(document, [page("page-a")], connected);
    publishStudioCrdtSceneGraphDiff(document, connected, disconnected);

    const record = document.getPage("page-a");
    expect(record?.shared3dStageManaged).toBe(true);
    expect(record?.shared3dStage).toBeUndefined();
    const reconciled = reconcileStudioCrdtSceneGraphPages(
      connected,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(reconciled.pages[0]).not.toHaveProperty("shared3dStage");
    document.destroy();
  });

  it("derives Stage-owned character hiding without persisting it as the user visibility scalar", () => {
    const document = new StudioCrdtDocument();
    const fixture = linkedCharacterPages();
    publishStudioCrdtSceneGraphDiff(document, fixture.disconnected, fixture.connected);

    expect(document.getSceneElement("character-a")?.payload.props.hidden).toBe(false);
    const connected = reconcileStudioCrdtSceneGraphPages(
      fixture.disconnected,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(connected.pages[0]?.elements[0]).toMatchObject({
      id: "character-a",
      hidden: true,
    });

    publishStudioCrdtSceneGraphDiff(document, fixture.connected, fixture.disconnected);
    const disconnected = reconcileStudioCrdtSceneGraphPages(
      connected.pages,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(disconnected.pages[0]?.shared3dStage).toBeUndefined();
    expect(disconnected.pages[0]?.elements[0]).toMatchObject({ hidden: false });

    publishStudioCrdtSceneGraphDiff(document, fixture.disconnected, fixture.manuallyHidden);
    const manuallyHidden = reconcileStudioCrdtSceneGraphPages(
      fixture.disconnected,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(manuallyHidden.pages[0]?.elements[0]).toMatchObject({ hidden: true });
    document.destroy();
  });

  it("backfills a visible scalar before unlinking an existing image topology reference", () => {
    const document = new StudioCrdtDocument();
    const fixture = linkedCharacterPages();
    document.addSceneElement({
      id: "character-a",
      pageId: "page-a",
      layerId: "page-root",
      payload: {
        version: 1,
        type: "reference",
        // Existing filter-mask/legacy topology records can predate image visibility sync.
        props: { elementType: "image" },
      },
    });

    publishStudioCrdtSceneGraphDiff(document, fixture.disconnected, fixture.connected);
    expect(document.getSceneElement("character-a")?.payload.props.hidden).toBe(false);
    const connected = reconcileStudioCrdtSceneGraphPages(
      fixture.disconnected,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(connected.pages[0]?.elements[0]).toMatchObject({
      id: "character-a",
      hidden: true,
    });

    publishStudioCrdtSceneGraphDiff(document, fixture.connected, fixture.disconnected);
    const disconnected = reconcileStudioCrdtSceneGraphPages(
      connected.pages,
      document.getStrokes({ includeDeleted: true }),
      document.getSceneElements({ includeDeleted: true }),
      document.getPages(true),
      document.getLayerGroups({ includeDeleted: true }),
    );
    expect(disconnected.pages[0]?.shared3dStage).toBeUndefined();
    expect(disconnected.pages[0]?.elements[0]).toMatchObject({
      id: "character-a",
      hidden: false,
    });
    document.destroy();
  });

  it("converges concurrent connect and unlink to a visible source in either update order", () => {
    const fixture = linkedCharacterPages();
    const connector = new StudioCrdtDocument();
    const unlinker = new StudioCrdtDocument();
    publishStudioCrdtSceneGraphDiff(connector, fixture.disconnected, fixture.connected);
    publishStudioCrdtSceneGraphDiff(unlinker, fixture.connected, fixture.disconnected);
    const connectUpdate = connector.encodeStateAsUpdate();
    const unlinkUpdate = unlinker.encodeStateAsUpdate();

    const left = new StudioCrdtDocument();
    left.applyUpdate(connectUpdate);
    left.applyUpdate(unlinkUpdate);
    const right = new StudioCrdtDocument();
    right.applyUpdate(unlinkUpdate);
    right.applyUpdate(connectUpdate);

    for (const peer of [left, right]) {
      const reconciled = reconcileStudioCrdtSceneGraphPages(
        fixture.connected,
        peer.getStrokes({ includeDeleted: true }),
        peer.getSceneElements({ includeDeleted: true }),
        peer.getPages(true),
        peer.getLayerGroups({ includeDeleted: true }),
      );
      expect(reconciled.pages[0]?.shared3dStage).toBeUndefined();
      expect(reconciled.pages[0]?.elements[0]).toMatchObject({
        id: "character-a",
        hidden: false,
      });
    }

    connector.destroy();
    unlinker.destroy();
    left.destroy();
    right.destroy();
  });

  it("publishes a legacy source's visible scalar before its unlink tombstone", () => {
    const fixture = linkedCharacterPages();
    const source = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    source.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    publishStudioCrdtSceneGraphDiff(source, fixture.connected, fixture.disconnected);

    const peer = new StudioCrdtDocument();
    let observedTombstone = false;
    for (const update of updates) {
      peer.applyUpdate(update);
      const state = peer.getShared3dStagePageState("page-a");
      if (!state.managed) continue;
      observedTombstone = true;
      expect(state.value).toBeUndefined();
      expect(peer.getSceneElement("character-a")?.payload.props.hidden).toBe(false);
      break;
    }
    expect(observedTombstone).toBe(true);
    peer.destroy();
    source.destroy();
  });

  it("publishes sticky-note text metadata to every peer", () => {
    const source = new StudioCrdtDocument();
    const stickyNote: TestElement = {
      ...createStudioStickyNoteElement({
        id: "sticky-note",
        x: 80,
        y: 120,
        presetId: "mint",
        text: "공유 아이디어",
      }),
    };

    const result = publishStudioCrdtSceneGraphDiff(
      source,
      [page("page-a")],
      [page("page-a", [stickyNote])]
    );

    expect(result.sceneElementMutations).toBe(1);
    expect(source.getSceneElement("sticky-note")?.payload.props).toMatchObject({
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    });

    const peer = new StudioCrdtDocument(source.encodeStateAsUpdate());
    const peerRecord = peer.getSceneElement("sticky-note");
    expect(peerRecord?.payload.props).toMatchObject({
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    });
    expect(studioCrdtElementToSceneElement(peerRecord!)).toMatchObject({
      id: "sticky-note",
      type: "text",
      stickyNotePresetId: "mint",
      stickyNoteFill: "#bbf7d0",
    });
    peer.destroy();
    source.destroy();
  });

  it("plans minimum tail-to-head moves while retaining an LIS", () => {
    expect(planStudioCrdtOrderMoves(["a", "b", "c"], ["b", "c", "a"]))
      .toEqual([{ id: "a", beforeId: null }]);
    expect(planStudioCrdtOrderMoves(["a", "b", "c"], ["c", "b", "a"]))
      .toHaveLength(2);
    expect(planStudioCrdtOrderMoves(["a", "c"], ["a", "b", "c"]))
      .toEqual([{ id: "b", beforeId: "c" }]);
  });

  it("bootstraps exact legacy field edits and optional removals, then protects a peer tombstone", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [text("caption", { font: "Pretendard" })])];
    const edited = [page("page-a", [text("caption", { text: "수정 대사", x: 80 })])];

    const result = publishStudioCrdtSceneGraphDiff(document, previous, edited);

    expect(result.sceneElementMutations).toBe(1);
    expect(document.getSceneElement("caption")?.payload.props).toMatchObject({
      text: "수정 대사",
      x: 80,
      y: 20,
    });
    expect(document.getSceneElement("caption")?.payload.props).not.toHaveProperty("font");

    document.deleteSceneElement("caption");
    publishStudioCrdtSceneGraphDiff(
      document,
      edited,
      [page("page-a", [text("caption", { text: "수정 대사", x: 80 })], { note: "별도 변경" })]
    );
    expect(document.getSceneElement("caption")).toBeNull();

    publishStudioCrdtSceneGraphDiff(document, [page("page-a")], edited);
    expect(document.getSceneElement("caption")?.deleted).toBe(false);
    document.destroy();
  });

  it("keeps a durable remote addition that is absent from both local snapshots", () => {
    const document = new StudioCrdtDocument();
    document.addSceneElement({
      id: "remote",
      pageId: "page-a",
      layerId: "lettering",
      payload: {
        version: 1,
        type: "text",
        props: {
          text: "원격 추가", x: 10, y: 20, width: 240, fontSize: 28, fill: "#111", rotation: 0,
        },
      },
    });
    publishStudioCrdtSceneGraphDiff(
      document,
      [page("page-a")],
      [page("page-a", [], { note: "로컬 페이지만 변경" })]
    );

    expect(document.getSceneElement("remote")?.payload.props.text).toBe("원격 추가");
    document.destroy();
  });

  it("bootstraps and tombstones deleted legacy scene elements and pages", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [text("removed")]), page("page-b")];
    const next = [page("page-b")];

    publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(document.getSceneElement("removed", true)?.deleted).toBe(true);
    expect(document.getPage("page-a", true)?.deleted).toBe(true);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b"]);
    document.destroy();
  });

  it("registers all legacy siblings for middle insertions and exact mixed ordering", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [text("a"), drawElement("ink"), text("c")])];
    const next = [page("page-a", [text("a"), text("b"), drawElement("ink"), text("c")])];

    publishStudioCrdtSceneGraphDiff(document, previous, next);

    const order = [
      ...document.getStrokes({ pageId: "page-a" }),
      ...document.getSceneElements({ pageId: "page-a" }),
    ].sort((left, right) => left.orderIndex - right.orderIndex).map(({ id }) => id);
    expect(order).toEqual(["a", "b", "ink", "c"]);
    expect(document.getSceneElement("a")).not.toBeNull();
    expect(document.getSceneElement("c")).not.toBeNull();
    expect(document.getStroke("ink")).not.toBeNull();
    document.destroy();
  });

  it("syncs mixed draw/scene z-order in both directions with one common order", () => {
    const document = new StudioCrdtDocument();
    document.addStroke(stroke("ink"));
    const ink = drawElement("ink");
    const previous = [page("page-a", [
      ink,
      text("caption"),
    ])];
    publishStudioCrdtSceneGraphDiff(document, [page("page-a", [ink])], previous);
    const next = [page("page-a", [text("caption"), ink])];

    const result = publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(result.elementMoves).toBeGreaterThan(0);
    expect(document.getSceneElement("caption")!.orderIndex)
      .toBeLessThan(document.getStroke("ink")!.orderIndex);
    document.destroy();
  });

  it("reparents one scene record across pages instead of delete-resurrect order races", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [text("moving")]), page("page-b")];
    publishStudioCrdtSceneGraphDiff(document, [page("page-a"), page("page-b")], previous);
    const next = [page("page-a"), page("page-b", [text("moving", { x: 500 })])];

    publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(document.getSceneElement("moving")).toMatchObject({
      pageId: "page-b",
      payload: { props: { x: 500 } },
    });
    document.destroy();
  });

  it("treats a draw moved across pages as one global reparent without tombstoning it", () => {
    const document = new StudioCrdtDocument();
    const original = drawElement("moving-ink");
    const previous = [page("page-a", [original]), page("page-b")];
    publishStudioCrdtSceneGraphDiff(
      document,
      [page("page-a"), page("page-b")],
      previous
    );
    const next = [page("page-a"), page("page-b", [original])];

    publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(document.getStroke("moving-ink", true)).toMatchObject({
      pageId: "page-b",
      deleted: false,
    });
    expect(document.getStrokes({ pageId: "page-a" })).toEqual([]);
    expect(document.getStrokes({ pageId: "page-b" }).map(({ id }) => id))
      .toEqual(["moving-ink"]);
    document.destroy();
  });

  it("materializes the first real edit of a legacy draw and preserves a peer reparent", () => {
    const legacyDocument = new StudioCrdtDocument();
    const previousElement = drawElement("legacy-ink");
    const editedElement = { ...previousElement, strokeWidth: 12 };

    publishStudioCrdtDrawGraphDiff(
      legacyDocument,
      [page("page-a", [previousElement])],
      [page("page-a", [editedElement])]
    );

    expect(legacyDocument.getStroke("legacy-ink")).toMatchObject({
      pageId: "page-a",
      payload: { strokeWidth: 12 },
    });
    legacyDocument.destroy();

    const peerReparentDocument = new StudioCrdtDocument();
    peerReparentDocument.addStroke(stroke("peer-moved", "page-b"));
    const staleElement = drawElement("peer-moved");
    publishStudioCrdtDrawGraphDiff(
      peerReparentDocument,
      [page("page-a", [staleElement]), page("page-b")],
      [page("page-a", [{ ...staleElement, stroke: "#ff0000" }]), page("page-b")]
    );

    expect(peerReparentDocument.getStroke("peer-moved")).toMatchObject({
      pageId: "page-b",
      deleted: false,
      payload: { stroke: "#ff0000" },
    });
    peerReparentDocument.destroy();
  });

  it("treats deep-cloned equal draws as no-ops and never truncates a peer streaming stroke", () => {
    const document = new StudioCrdtDocument();
    document.beginStroke(stroke("streaming"));
    document.appendStrokeSamples("streaming", {
      points: [20, 20, 30, 30],
      pressures: [0.5, 0.5],
    });
    const snapshot = drawElement("streaming");
    const deepClone = structuredClone(snapshot);

    const mutations = publishStudioCrdtDrawGraphDiff(
      document,
      [page("page-a", [snapshot])],
      [page("page-a", [deepClone])]
    );

    expect(mutations).toBe(0);
    expect(document.getStroke("streaming")).toMatchObject({
      status: "drawing",
      payload: { points: [0, 0, 10, 10, 20, 20, 30, 30] },
    });
    document.destroy();

    const finalizedDocument = new StudioCrdtDocument();
    const peerStroke = stroke("peer-newer");
    peerStroke.payload = {
      ...peerStroke.payload,
      stroke: "#ff0000",
      strokeWidth: 9,
      points: [0, 0, 50, 50],
    };
    finalizedDocument.addStroke(peerStroke);
    const staleSnapshot = drawElement("peer-newer");
    expect(publishStudioCrdtDrawGraphDiff(
      finalizedDocument,
      [page("page-a", [staleSnapshot])],
      [page("page-a", [structuredClone(staleSnapshot)])]
    )).toBe(0);
    expect(finalizedDocument.getStroke("peer-newer")?.payload).toMatchObject({
      stroke: "#ff0000",
      strokeWidth: 9,
      points: [0, 0, 50, 50],
    });
    finalizedDocument.destroy();
  });

  it("patches only locally changed draw metadata and preserves an independent peer field edit", () => {
    const document = new StudioCrdtDocument();
    const previousElement = drawElement("metadata-ink");
    document.addStroke(stroke("metadata-ink"));
    const peerPayload = {
      ...document.getStroke("metadata-ink")!.payload,
      opacity: 0.25,
    };
    document.patchStroke("metadata-ink", {
      payload: peerPayload,
      changedPayloadKeys: ["opacity"],
    });

    publishStudioCrdtDrawGraphDiff(
      document,
      [page("page-a", [previousElement])],
      [page("page-a", [{ ...previousElement, stroke: "#ff0000" }])]
    );

    expect(document.getStroke("metadata-ink")?.payload).toMatchObject({
      stroke: "#ff0000",
      opacity: 0.25,
    });
    document.destroy();
  });

  it("patches all aligned pointer arrays as one group when point count changes", () => {
    const document = new StudioCrdtDocument();
    document.addStroke(stroke("reshaped"));
    const previousElement = drawElement("reshaped", { pressures: undefined });
    const nextElement = {
      ...previousElement,
      points: [0, 0, 10, 10, 20, 20],
    };

    expect(() => publishStudioCrdtDrawGraphDiff(
      document,
      [page("page-a", [previousElement])],
      [page("page-a", [nextElement])]
    )).not.toThrow();

    expect(document.getStroke("reshaped")?.payload).toMatchObject({
      points: [0, 0, 10, 10, 20, 20],
      pressures: [0.5, 0.5, 0.5],
      tiltXs: [0, 0, 0],
      tiltYs: [0, 0, 0],
    });
    document.destroy();
  });

  it("does not replace a draw reparent a second time in the scene topology pass", () => {
    const document = new StudioCrdtDocument();
    const ink = drawElement("one-pass-reparent");
    document.addStroke(stroke("one-pass-reparent"));
    const previous = [page("page-a", [ink]), page("page-b")];
    const next = [page("page-a"), page("page-b", [ink])];

    expect(publishStudioCrdtDrawGraphDiff(document, previous, next)).toBe(1);
    expect(publishStudioCrdtDrawGraphDiff(document, previous, next)).toBe(0);
    const sceneResult = publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(sceneResult.sceneElementMutations).toBe(0);
    expect(document.getStroke("one-pass-reparent")).toMatchObject({
      pageId: "page-b",
      deleted: false,
    });
    document.destroy();
  });

  it("preserves legacy mixed z-order across sequential payload-only registrations", () => {
    const document = new StudioCrdtDocument();
    const caption = text("caption");
    const ink = drawElement("ink");
    const previous = [page("page-a", [caption, ink])];
    const inkEdited = [page("page-a", [caption, { ...ink, strokeWidth: 9 }])];

    publishStudioCrdtSceneGraphDiff(document, previous, inkEdited);
    const orderAfterInk = [
      ...document.getStrokes({ pageId: "page-a" }),
      ...document.getSceneElements({ pageId: "page-a" }),
    ].sort((left, right) => left.orderIndex - right.orderIndex).map(({ id }) => id);
    expect(orderAfterInk).toEqual(["caption", "ink"]);

    const captionEdited = [page("page-a", [
      { ...caption, text: "두 번째 편집" },
      { ...ink, strokeWidth: 9 },
    ])];
    publishStudioCrdtSceneGraphDiff(document, inkEdited, captionEdited);
    const orderAfterCaption = [
      ...document.getStrokes({ pageId: "page-a" }),
      ...document.getSceneElements({ pageId: "page-a" }),
    ].sort((left, right) => left.orderIndex - right.orderIndex).map(({ id }) => id);
    expect(orderAfterCaption).toEqual(["caption", "ink"]);
    document.destroy();
  });

  it("does not undo a peer reparent or peer z-order during an unrelated local scalar edit", () => {
    const document = new StudioCrdtDocument();
    document.addSceneElement({
      id: "a",
      pageId: "page-a",
      layerId: "lettering",
      payload: {
        version: 1,
        type: "text",
        props: { text: "A", x: 10, y: 20, width: 200, fontSize: 28, fill: "#111", rotation: 0 },
      },
    });
    document.addSceneElement({
      id: "b",
      pageId: "page-a",
      layerId: "lettering",
      payload: {
        version: 1,
        type: "text",
        props: { text: "B", x: 20, y: 30, width: 200, fontSize: 28, fill: "#111", rotation: 0 },
      },
    });
    document.addSceneElement({
      id: "c",
      pageId: "page-a",
      layerId: "lettering",
      payload: {
        version: 1,
        type: "text",
        props: { text: "C", x: 30, y: 40, width: 200, fontSize: 28, fill: "#111", rotation: 0 },
      },
    });
    document.moveElement("b", "a");
    document.patchSceneElement("c", { pageId: "page-b" });
    const previous = [page("page-a", [
      text("a", { text: "A" }), text("b", { text: "B" }), text("c", { text: "C" }),
    ]), page("page-b")];
    const next = [page("page-a", [
      text("a", { text: "A local" }), text("b", { text: "B" }), text("c", { text: "C local" }),
    ]), page("page-b")];

    publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(document.getSceneElement("c")?.pageId).toBe("page-b");
    expect(document.getSceneElement("c")?.payload.props.text).toBe("C local");
    expect(document.getSceneElement("a")?.payload.props.text).toBe("A local");
    expect(document.getSceneElements({ pageId: "page-a" }).map(({ id }) => id)).toEqual(["b", "a"]);
    document.destroy();
  });

  it("bootstraps page reorder context and publishes page payload patches and tombstones", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [], { name: "A" }), page("page-b", [], { name: "B" })];
    const next = [page("page-b", [], { name: "B 수정" }), page("page-a", [], { name: "A" })];

    const result = publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(result.pageMutations).toBe(2);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b", "page-a"]);
    expect(document.getPage("page-b")?.payload.props.name).toBe("B 수정");

    document.deletePage("page-a");
    publishStudioCrdtSceneGraphDiff(document, next, [
      page("page-b", [], { name: "B 수정", note: "다른 변경" }),
      page("page-a", [], { name: "A" }),
    ]);
    expect(document.getPage("page-a")).toBeNull();
    document.destroy();
  });

  it("publishes paper surface and grain visibility edits as page mutations", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [], {
      paperSurface: { kind: "cold-press", seed: 41 },
      paperGrainVisible: true,
    })];
    const next = [page("page-a", [], {
      paperSurface: { kind: "rough", seed: 73 },
      paperGrainVisible: false,
    })];

    const result = publishStudioCrdtSceneGraphDiff(document, previous, next);

    expect(result.pageMutations).toBe(1);
    expect(document.getPage("page-a")?.payload.props).toMatchObject({
      paperSurface: { kind: "rough", seed: 73 },
      paperGrainVisible: false,
    });
    document.destroy();
  });

  it("registers every legacy page around a middle insertion and preserves peer order on metadata edits", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a"), page("page-c")];
    const inserted = [page("page-a"), page("page-b"), page("page-c")];
    publishStudioCrdtSceneGraphDiff(document, previous, inserted);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-a", "page-b", "page-c"]);

    document.movePage("page-c", "page-a");
    publishStudioCrdtSceneGraphDiff(
      document,
      inserted,
      [page("page-a", [], { note: "로컬 메모" }), page("page-b"), page("page-c")]
    );
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-c", "page-a", "page-b"]);
    expect(document.getPage("page-a")?.payload.props.note).toBe("로컬 메모");
    document.destroy();
  });

  it("preserves legacy page order across sequential metadata-only registrations", () => {
    const document = new StudioCrdtDocument();
    const previous = [
      page("page-b", [], { name: "B" }),
      page("page-a", [], { name: "A" }),
    ];
    const pageAEdited = [
      page("page-b", [], { name: "B" }),
      page("page-a", [], { name: "A 수정" }),
    ];

    publishStudioCrdtSceneGraphDiff(document, previous, pageAEdited);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b", "page-a"]);

    publishStudioCrdtSceneGraphDiff(document, pageAEdited, [
      page("page-b", [], { name: "B 수정" }),
      page("page-a", [], { name: "A 수정" }),
    ]);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b", "page-a"]);
    document.destroy();
  });
});
