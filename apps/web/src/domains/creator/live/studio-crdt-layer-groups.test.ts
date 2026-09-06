import { describe, expect, it, vi } from "vitest";

import { isEffectivelyHidden, isEffectivelyLocked } from "../studio-layers";

import {
  STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
  StudioCrdtDocument,
  type StudioCrdtLayerGroupInput,
  type StudioCrdtLayerGroupRecord,
  type StudioCrdtSceneElementRecord,
} from "./studio-crdt-document";
import { reconcileStudioCrdtSceneGraphHistory } from "./studio-crdt-history";
import {
  reconcileStudioCrdtSceneGraphPages,
  studioLayerGroupToCrdtGroup,
} from "./studio-crdt-page-bridge";
import { publishStudioCrdtSceneGraphDiff } from "./studio-crdt-scene-publisher";
import { studioCrdtLayerGroupKey } from "./studio-crdt-scene-schema";

function group(
  pageId: string,
  id = "cast",
  overrides: Record<string, string | boolean> = {}
): StudioCrdtLayerGroupInput {
  return {
    id,
    pageId,
    payload: {
      version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
      props: { name: "등장인물", hidden: false, locked: false, ...overrides },
    },
  };
}

function groupRecord(
  pageId: string,
  id = "cast",
  overrides: Partial<StudioCrdtLayerGroupRecord> = {}
): StudioCrdtLayerGroupRecord {
  return { ...group(pageId, id), deleted: false, ...overrides };
}

function textRecord(
  id: string,
  pageId: string,
  layerId: string,
  groupId = layerId
): StudioCrdtSceneElementRecord {
  return {
    id,
    pageId,
    layerId,
    deleted: false,
    orderIndex: 0,
    payload: {
      version: 1,
      type: "text",
      props: {
        text: "대사",
        x: 10,
        y: 20,
        width: 240,
        fontSize: 28,
        fill: "#111111",
        rotation: 0,
        groupId,
      },
    },
  };
}

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
  name?: string;
  note?: string;
  groups?: Array<{
    id: string;
    name: string;
    hidden?: boolean;
    locked?: boolean;
    collapsed?: boolean;
  }>;
}

function page(
  id: string,
  groups: NonNullable<TestPage["groups"]> = [],
  elements: TestElement[] = []
): TestPage {
  return { id, elements, groups, bg: "#ffffff", bgGrad: null, canvasH: 1600 };
}

describe("studio CRDT layer groups", () => {
  it("uses page-scoped composite identities and never serializes local collapsed state", () => {
    const document = new StudioCrdtDocument();
    document.addLayerGroup(group("page-a", "shared", { hidden: true }));
    document.addLayerGroup(group("page-b", "shared", { locked: true }));

    expect(document.getLayerGroup("page-a", "shared")?.payload.props).toMatchObject({
      name: "등장인물",
      hidden: true,
      locked: false,
    });
    expect(document.getLayerGroup("page-b", "shared")?.payload.props).toMatchObject({
      name: "등장인물",
      hidden: false,
      locked: true,
    });
    expect(studioCrdtLayerGroupKey("ab", "c")).not.toBe(
      studioCrdtLayerGroupKey("a", "bc")
    );
    expect(studioLayerGroupToCrdtGroup("page-a", {
      id: "shared",
      name: "등장인물",
      collapsed: true,
    }).payload.props).toEqual({ name: "등장인물" });
    expect(() => document.addLayerGroup(group("page-a", "page-root"))).toThrow("page-root");
    expect(() => document.addLayerGroup(group("page-a", "bad", { name: "나쁜\u0007이름" })))
      .toThrow("이름");
    document.destroy();
  });

  it("merges concurrent first-registration rename and visibility edits per field", () => {
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    const baseline = group("page-a").payload.props;
    left.upsertLayerGroup(group("page-a", "cast", { name: "주연" }), {
      baselineProps: baseline,
      changedProps: ["name"],
    });
    right.upsertLayerGroup(group("page-a", "cast", { hidden: true }), {
      baselineProps: baseline,
      changedProps: ["hidden"],
    });

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    expect(left.getLayerGroup("page-a", "cast")?.payload.props).toEqual(
      right.getLayerGroup("page-a", "cast")?.payload.props
    );
    expect(left.getLayerGroup("page-a", "cast")?.payload.props).toMatchObject({
      name: "주연",
      hidden: true,
      locked: false,
    });
    left.destroy();
    right.destroy();
  });

  it("keeps a concurrent tombstone authoritative while preserving an independent field edit", () => {
    const seed = new StudioCrdtDocument();
    seed.addLayerGroup(group("page-a"));
    const initial = seed.encodeStateAsUpdate();
    const left = new StudioCrdtDocument(initial);
    const right = new StudioCrdtDocument(initial);
    left.deleteLayerGroup("page-a", "cast");
    right.patchLayerGroup("page-a", "cast", { set: { locked: true } });

    const leftUpdate = left.encodeStateAsUpdate(right.encodeStateVector());
    const rightUpdate = right.encodeStateAsUpdate(left.encodeStateVector());
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    expect(left.getLayerGroup("page-a", "cast")).toBeNull();
    expect(left.getLayerGroup("page-a", "cast", true)?.payload.props.locked).toBe(true);
    expect(left.restoreLayerGroup("page-a", "cast")).toBe(true);
    expect(left.getLayerGroup("page-a", "cast")?.payload.props.locked).toBe(true);
    seed.destroy();
    left.destroy();
    right.destroy();
  });

  it("reports composite changed keys to remote-history subscribers", () => {
    const document = new StudioCrdtDocument();
    const handler = vi.fn();
    document.subscribeChanges(handler);
    document.addLayerGroup(group("page-a", "cast"));

    const change = handler.mock.calls.at(-1)?.[0] as {
      changedLayerGroupIds: ReadonlySet<string>;
    };
    expect(change.changedLayerGroupIds).toEqual(
      new Set([studioCrdtLayerGroupKey("page-a", "cast")])
    );
    document.destroy();
  });

  it("makes record.layerId authoritative and clears deleted, missing, or wrong-page membership", () => {
    const pages = [
      page("page-a", [{ id: "cast", name: "옛 이름", collapsed: true }], [
        { id: "caption", type: "text", groupId: "payload-only" },
        { id: "orphan", type: "text", groupId: "ghost" },
      ]),
      page("page-b", [{ id: "cast", name: "B 그룹", collapsed: false }]),
    ];
    const reconciled = reconcileStudioCrdtSceneGraphPages(
      pages,
      [],
      [
        textRecord("caption", "page-a", "cast", "payload-only"),
        textRecord("orphan", "page-a", "ghost", "ghost"),
      ],
      [],
      [
        groupRecord("page-a", "cast", {
          payload: group("page-a", "cast", { name: "새 이름", hidden: true }).payload,
        }),
        groupRecord("page-b", "cast", {
          payload: group("page-b", "cast", { locked: true }).payload,
        }),
      ]
    );

    const pageA = reconciled.pages[0]!;
    expect(pageA.groups).toEqual([{
      id: "cast",
      name: "새 이름",
      hidden: true,
      locked: false,
      collapsed: true,
    }]);
    expect(pageA.elements.find((element) => element.id === "caption")?.groupId).toBe("cast");
    expect(pageA.elements.find((element) => element.id === "orphan")?.groupId).toBeUndefined();
    expect(isEffectivelyHidden(
      pageA.elements.find((element) => element.id === "caption")!,
      pageA.groups!
    )).toBe(true);
    expect(isEffectivelyLocked(
      reconciled.pages[1]!.elements[0] ?? { id: "none" },
      reconciled.pages[1]!.groups!
    )).toBe(false);

    const deleted = reconcileStudioCrdtSceneGraphPages(
      reconciled.pages,
      [],
      [textRecord("caption", "page-a", "cast")],
      [],
      [groupRecord("page-a", "cast", { deleted: true })]
    );
    expect(deleted.pages[0]!.groups).toEqual([]);
    expect(deleted.pages[0]!.elements[0]?.groupId).toBeUndefined();
  });

  it("publishes tombstones without stale resurrection and models page reparent as two records", () => {
    const document = new StudioCrdtDocument();
    const previous = [page("page-a", [{ id: "cast", name: "등장인물", collapsed: true }])];
    const renamed = [page("page-a", [{ id: "cast", name: "주연", collapsed: false }])];
    const first = publishStudioCrdtSceneGraphDiff(document, previous, renamed);
    expect(first.layerGroupMutations).toBe(1);
    expect(document.getLayerGroup("page-a", "cast")?.payload.props).not.toHaveProperty("collapsed");
    const collapsedOnly = [page("page-a", [{ id: "cast", name: "주연", collapsed: true }])];
    expect(publishStudioCrdtSceneGraphDiff(document, renamed, collapsedOnly).layerGroupMutations)
      .toBe(0);

    document.deleteLayerGroup("page-a", "cast");
    const stale = collapsedOnly.map((candidate) => ({ ...candidate, note: "별도 페이지 변경" }));
    publishStudioCrdtSceneGraphDiff(document, collapsedOnly, stale);
    expect(document.getLayerGroup("page-a", "cast")).toBeNull();

    const absent = [page("page-a")];
    publishStudioCrdtSceneGraphDiff(document, stale, absent);
    publishStudioCrdtSceneGraphDiff(document, absent, renamed);
    expect(document.getLayerGroup("page-a", "cast")?.payload.props.name).toBe("주연");
    document.deleteLayerGroup("page-a", "cast");

    const reparented = [page("page-a"), page("page-b", [{ id: "cast", name: "주연" }])];
    publishStudioCrdtSceneGraphDiff(document, stale, reparented);
    expect(document.getLayerGroup("page-a", "cast", true)?.deleted).toBe(true);
    expect(document.getLayerGroup("page-b", "cast")?.payload.props.name).toBe("주연");
    document.destroy();
  });

  it("reconciles remote hidden/locked metadata through every undo snapshot but keeps collapse local", () => {
    const history = [
      [page("page-a", [{ id: "cast", name: "옛 이름", collapsed: true }], [
        { id: "legacy", type: "image", groupId: "cast" },
      ])],
      [page("page-a", [{ id: "cast", name: "옛 이름", collapsed: false }], [
        { id: "legacy", type: "image", groupId: "cast" },
      ])],
    ];
    const key = studioCrdtLayerGroupKey("page-a", "cast");
    const result = reconcileStudioCrdtSceneGraphHistory(
      history,
      1,
      {
        strokes: [],
        sceneElements: [],
        pages: [],
        layerGroups: [groupRecord("page-a", "cast", {
          payload: group("page-a", "cast", { name: "새 이름", hidden: true, locked: true }).payload,
        })],
      },
      {
        strokeIds: new Set(),
        sceneElementIds: new Set(),
        pageIds: new Set(),
        layerGroupIds: new Set([key]),
      }
    );

    expect(result.history[0]![0]!.groups?.[0]).toMatchObject({
      name: "새 이름", hidden: true, locked: true, collapsed: true,
    });
    expect(result.history[1]![0]!.groups?.[0]).toMatchObject({
      name: "새 이름", hidden: true, locked: true, collapsed: false,
    });
    expect(isEffectivelyHidden(result.history[0]![0]!.elements[0]!, result.history[0]![0]!.groups!))
      .toBe(true);
    expect(isEffectivelyLocked(result.history[1]![0]!.elements[0]!, result.history[1]![0]!.groups!))
      .toBe(true);

    const deleted = reconcileStudioCrdtSceneGraphHistory(
      result.history,
      1,
      {
        strokes: [],
        sceneElements: [],
        pages: [],
        layerGroups: [groupRecord("page-a", "cast", { deleted: true })],
      },
      {
        strokeIds: new Set(),
        sceneElementIds: new Set(),
        pageIds: new Set(),
        layerGroupIds: new Set([key]),
      }
    );
    for (const snapshot of deleted.history) {
      expect(snapshot[0]!.groups).toEqual([]);
      expect(snapshot[0]!.elements[0]!.groupId).toBeUndefined();
    }
  });
});
