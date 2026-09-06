import { describe, expect, it } from "vitest";

import {
  reconcileStudioCrdtHistory,
  reconcileStudioCrdtSceneGraphHistory,
} from "./studio-crdt-history";

import type {
  StudioCrdtPageRecord,
  StudioCrdtSceneElementRecord,
  StudioCrdtStrokeRecord,
} from "./studio-crdt-document";

interface TestElement {
  id: string;
  type: string;
  points?: number[];
  stroke?: string;
  strokeWidth?: number;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  fontSize?: number;
  fill?: string;
  rotation?: number;
}

interface TestPage {
  id: string;
  elements: TestElement[];
}

interface ScenePage extends TestPage {
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  name?: string;
}

function record(
  id: string,
  point: number,
  options: { deleted?: boolean; orderIndex?: number } = {}
): StudioCrdtStrokeRecord {
  return {
    id,
    pageId: "page-a",
    layerId: "page-root",
    status: "finalized",
    deleted: options.deleted ?? false,
    orderIndex: options.orderIndex ?? point,
    payload: {
      version: 1,
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [point, point, point + 1, point + 1],
      pressures: [0.5, 0.5],
      stroke: "#111111",
      strokeWidth: 4,
    },
  };
}

function draw(id: string, point: number): TestElement {
  return {
    id,
    type: "draw",
    points: [point, point, point + 1, point + 1],
    stroke: "#111111",
    strokeWidth: 4,
  };
}

function points(history: TestPage[][], historyIndex: number, id: string): number[] | undefined {
  return history[historyIndex]?.[0]?.elements.find((element) => element.id === id)?.points;
}

function scenePage(id: string, elements: TestElement[], name = id): ScenePage {
  return { id, elements, bg: "#fff", bgGrad: null, canvasH: 1600, name };
}

function textRecord(id: string, text: string, orderIndex: number): StudioCrdtSceneElementRecord {
  return {
    id,
    pageId: "page-a",
    layerId: "lettering",
    deleted: false,
    orderIndex,
    payload: {
      version: 1,
      type: "text",
      props: {
        text, x: 10, y: 20, width: 240, fontSize: 28, fill: "#111", rotation: 0,
      },
    },
  };
}

function pageRecord(id: string, name: string, orderIndex: number): StudioCrdtPageRecord {
  return {
    id,
    deleted: false,
    orderIndex,
    payload: {
      version: 1,
      props: { bg: "#fff", bgGrad: null, canvasH: 1600, name },
    },
  };
}

describe("reconcileStudioCrdtHistory", () => {
  it("hydrates the complete initial frontier into every undo snapshot", () => {
    const history: TestPage[][] = [
      [{ id: "page-a", elements: [{ id: "legacy", type: "text" }] }],
      [{ id: "page-a", elements: [{ id: "legacy", type: "text" }] }],
    ];

    const result = reconcileStudioCrdtHistory(history, 1, [record("remote", 10)], null);

    expect(result.changed).toBe(true);
    expect(result.history[0]?.[0]?.elements.map((element) => element.id)).toEqual([
      "legacy",
      "remote",
    ]);
    expect(result.history[1]?.[0]?.elements.map((element) => element.id)).toEqual([
      "legacy",
      "remote",
    ]);
  });

  it("carries only remotely changed IDs through history and keeps untouched local undo", () => {
    const history: TestPage[][] = [
      [{ id: "page-a", elements: [draw("shared", 1)] }],
      [{ id: "page-a", elements: [draw("shared", 1), draw("local", 5)] }],
    ];
    const records = [record("shared", 20), record("local", 30)];

    const result = reconcileStudioCrdtHistory(history, 1, records, new Set(["shared"]));

    expect(points(result.history, 0, "shared")).toEqual([20, 20, 21, 21]);
    expect(points(result.history, 1, "shared")).toEqual([20, 20, 21, 21]);
    expect(points(result.history, 0, "local")).toBeUndefined();
    expect(points(result.history, 1, "local")).toEqual([30, 30, 31, 31]);
  });

  it("propagates a remote tombstone through every snapshot", () => {
    const history: TestPage[][] = [
      [{ id: "page-a", elements: [draw("deleted", 1)] }],
      [{ id: "page-a", elements: [draw("deleted", 2)] }],
    ];

    const result = reconcileStudioCrdtHistory(
      history,
      1,
      [record("deleted", 3, { deleted: true })],
      new Set(["deleted"])
    );

    expect(result.history[0]?.[0]?.elements).toEqual([]);
    expect(result.history[1]?.[0]?.elements).toEqual([]);
  });

  it("ignores a remote transaction that did not touch a stroke", () => {
    const history: TestPage[][] = [[{ id: "page-a", elements: [draw("local", 1)] }]];

    const result = reconcileStudioCrdtHistory(
      history,
      0,
      [record("local", 9)],
      new Set()
    );

    expect(result.changed).toBe(false);
    expect(result.history).toBe(history);
  });

  it("uses the full scene frontier as reorder context without overwriting an unchanged sibling", () => {
    const a: TestElement = { id: "a", type: "text", text: "A-old" };
    const b: TestElement = { id: "b", type: "text", text: "B-local-history" };
    const history: ScenePage[][] = [
      [scenePage("page-a", [a, b])],
      [scenePage("page-a", [{ ...a }, { ...b }])],
    ];

    const result = reconcileStudioCrdtSceneGraphHistory(
      history,
      1,
      {
        strokes: [],
        sceneElements: [textRecord("a", "A-remote", 5), textRecord("b", "B-frontier", 2)],
        pages: [],
        layerGroups: [],
      },
      {
        strokeIds: new Set(),
        sceneElementIds: new Set(["a"]),
        pageIds: new Set(),
        layerGroupIds: new Set(),
      }
    );

    expect(result.history[0]?.[0]?.elements.map((element) => element.id)).toEqual(["b", "a"]);
    expect(result.history[0]?.[0]?.elements[0]?.text).toBe("B-local-history");
    expect(result.history[0]?.[0]?.elements[1]?.text).toBe("A-remote");
    expect(result.history[1]?.[0]?.elements[0]?.text).toBe("B-frontier");
  });

  it("uses unchanged managed pages as order context while preserving their historical payload", () => {
    const history: ScenePage[][] = [
      [scenePage("page-a", [], "A-old"), scenePage("page-b", [], "B-local-history")],
      [scenePage("page-a", [], "A-current"), scenePage("page-b", [], "B-current")],
    ];

    const result = reconcileStudioCrdtSceneGraphHistory(
      history,
      1,
      {
        strokes: [],
        sceneElements: [],
        pages: [pageRecord("page-a", "A-remote", 5), pageRecord("page-b", "B-frontier", 2)],
        layerGroups: [],
      },
      {
        strokeIds: new Set(),
        sceneElementIds: new Set(),
        pageIds: new Set(["page-a"]),
        layerGroupIds: new Set(),
      }
    );

    expect(result.history[0]?.map((page) => page.id)).toEqual(["page-b", "page-a"]);
    expect(result.history[0]?.[0]?.name).toBe("B-local-history");
    expect(result.history[0]?.[1]?.name).toBe("A-remote");
    expect(result.history[1]?.[0]?.name).toBe("B-frontier");
  });
});
