import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  planStudioHybridDccSelectionDispatch as plan,
  resolveStudioHybridDccSelectionShortcut as shortcut,
  runStudioHybridDccSelectionCommand as run,
  type StudioHybridDccSelectionComponent as Mode,
  type StudioHybridDccSelectionMesh as Mesh,
} from "./studio-hybrid-dcc-selection-commands";

// This fixture follows the actual half-edge contract: destination vertex, indexed links,
// twin=-1 on an open boundary, and sparse stable vertex/face IDs.
function fixture(polygons: readonly (readonly number[])[], isolated: readonly number[] = []): Mesh {
  const vertices = [...new Set([...polygons.flat(), ...isolated])].map((id) => ({ id }));
  const halfEdges: { id: number; vertex: number; face: number; next: number; prev: number; twin: number }[] = [];
  const faces: { id: number; he: number }[] = [];
  const directed = new Map<string, number>();
  for (const [faceIndex, polygon] of polygons.entries()) {
    const face = faceIndex * 13 + 7;
    const start = halfEdges.length;
    faces.push({ id: face, he: start });
    for (let corner = 0; corner < polygon.length; corner += 1) {
      const origin = polygon[corner]!, destination = polygon[(corner + 1) % polygon.length]!;
      const id = halfEdges.length;
      const twin = directed.get(`${destination}:${origin}`) ?? -1;
      halfEdges.push({ id, vertex: destination, face, twin, next: start + (corner + 1) % polygon.length,
        prev: start + (corner + polygon.length - 1) % polygon.length });
      if (twin >= 0) halfEdges[twin]!.twin = id;
      directed.set(`${origin}:${destination}`, id);
    }
  }
  return { vertices, halfEdges, faces };
}
const strip = fixture([[10, 20, 21, 11], [20, 30, 31, 21], [30, 40, 41, 31]], [99]);
const cube = fixture([[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]);
const modes: readonly Mode[] = ["vertex", "edge", "face"];
const sorted = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => a - b);

describe("stable topology selections", () => {
  it("selects sparse vertex and face IDs rather than storage indices", () => {
    assert.deepEqual(run(strip, "vertex", [], "all"), [10, 11, 20, 21, 30, 31, 40, 41, 99]);
    assert.deepEqual(run(strip, "face", [], "all"), [7, 20, 33]);
  });
  it("represents a twin pair as one canonical undirected edge", () => {
    const edges = run(strip, "edge", [], "all");
    assert.equal(edges.length, 10);
    assert.equal(edges.includes(7), false);
    assert.equal(edges.includes(1), true);
    assert.deepEqual(run(strip, "edge", [7], "grow"), run(strip, "edge", [1], "grow"));
  });
  it("clears selection in every component mode", () => {
    for (const mode of modes) assert.deepEqual(run(strip, mode, run(strip, mode, [], "all"), "none"), []);
  });
  it("inversion is involutive and preserves its complement", () => {
    for (const mode of modes) {
      const all = run(strip, mode, [], "all");
      const selected = all.filter((_, index) => index % 2 === 0);
      const other = run(strip, mode, selected, "invert");
      assert.deepEqual(run(strip, mode, other, "invert"), selected);
      assert.deepEqual(sorted([...selected, ...other]), all);
      assert.equal(other.some((id) => selected.includes(id)), false);
    }
  });
  it("grows exactly one vertex ring, not the entire connected component", () => {
    assert.deepEqual(run(strip, "vertex", [10], "grow"), [10, 11, 20]);
    assert.deepEqual(run(strip, "vertex", [99], "grow"), [99]);
  });
  it("grows faces through shared edges and contracts only selected-region boundaries", () => {
    assert.deepEqual(run(strip, "face", [7], "grow"), [7, 20]);
    assert.deepEqual(run(strip, "face", [7, 20], "shrink"), [7]);
    assert.deepEqual(run(strip, "face", [7, 20, 33], "shrink"), [7, 20, 33]);
  });
  it("retains empty or fully selected neighbourhoods", () => {
    for (const mode of modes) {
      assert.deepEqual(run(strip, mode, [], "grow"), []);
      assert.deepEqual(run(strip, mode, [], "shrink"), []);
      assert.deepEqual(run(strip, mode, [], "linked"), []);
      const all = run(strip, mode, [], "all");
      assert.deepEqual(run(strip, mode, all, "grow"), all);
      assert.deepEqual(run(strip, mode, all, "shrink"), all);
    }
  });
  it("never links separate parts merely because they coexist in one object", () => {
    const mesh = fixture([[1, 2, 3], [10, 11, 12]], [100]);
    assert.deepEqual(run(mesh, "vertex", [1], "linked"), [1, 2, 3]);
    assert.deepEqual(run(mesh, "vertex", [100], "linked"), [100]);
    assert.deepEqual(run(mesh, "face", [7], "linked"), [7]);
    assert.deepEqual(run(mesh, "edge", [0], "linked"), [0, 1, 2]);
  });
  it("links vertex-touching parts in vertex/edge modes but not face mode", () => {
    const mesh = fixture([[0, 1, 2], [0, 10, 11]]);
    assert.deepEqual(run(mesh, "vertex", [1], "linked"), [0, 1, 2, 10, 11]);
    assert.equal(run(mesh, "edge", [0], "linked").length, 6);
    assert.deepEqual(run(mesh, "face", [7], "linked"), [7]);
  });
  it("finds open boundary edges without counting paired internal edges twice", () => {
    assert.equal(run(strip, "edge", [], "boundary").length, 8);
    assert.equal(run(strip, "edge", [], "boundary").includes(1), false);
    assert.deepEqual(run(strip, "face", [], "boundary"), [7, 20, 33]);
    assert.equal(run(strip, "vertex", [], "boundary").includes(99), false);
  });
  it("finds no open boundary in a closed cube", () => {
    for (const mode of modes) assert.deepEqual(run(cube, mode, [], "boundary"), []);
    assert.equal(run(cube, "edge", [], "all").length, 12);
  });
  it("selects isolated vertices and refuses the wrong mode", () => {
    assert.deepEqual(run(strip, "vertex", [], "loose"), [99]);
    assert.throws(() => run(strip, "edge", [], "loose"));
    assert.throws(() => run(strip, "face", [], "loose"));
  });
  it("returns an unweighted shortest topological path through vertices and faces", () => {
    assert.deepEqual(run(strip, "vertex", [10, 40], "path"), [10, 20, 30, 40]);
    assert.deepEqual(run(strip, "face", [33, 7], "path"), [7, 20, 33]);
  });
  it("requires two distinct endpoints and rejects disconnected paths", () => {
    assert.throws(() => run(strip, "vertex", [10], "path"));
    assert.throws(() => run(strip, "vertex", [10, 10], "path"));
    assert.throws(() => run(strip, "vertex", [10, 20, 30], "path"));
    assert.throws(() => run(strip, "vertex", [10, 99], "path"), /경로가 없습니다/u);
  });
  it("does not mutate source geometry or its selection input", () => {
    const mesh = structuredClone(strip), original = JSON.stringify(mesh), selected = Object.freeze([7]);
    for (const operation of ["all", "none", "invert", "grow", "shrink", "linked", "boundary"] as const) {
      assert.ok(Object.isFrozen(run(mesh, "face", selected, operation)));
    }
    assert.equal(JSON.stringify(mesh), original);
    assert.deepEqual(selected, [7]);
  });
});

describe("bounded and validated topology", () => {
  it("rejects sparse arrays and invalid IDs", () => {
    assert.throws(() => run({ ...strip, vertices: new Array(3) }, "vertex", [], "all"));
    assert.throws(() => run({ ...strip, halfEdges: new Array(3) }, "edge", [], "all"));
    assert.throws(() => run({ ...strip, faces: new Array(3) }, "face", [], "all"));
    assert.throws(() => run({ ...strip, vertices: [...strip.vertices, strip.vertices[0]!] }, "vertex", [], "all"));
    for (const value of [-1, NaN, Infinity, 0.5, 123456]) assert.throws(() => run(strip, "vertex", [value], "linked"));
    assert.throws(() => run(strip, "vertex", new Array(3), "all"));
  });
  it("rejects wrong storage IDs, asymmetric twins and invalid face ownership", () => {
    const corrupt = (patch: Partial<Mesh["halfEdges"][number]>) => ({ ...strip, halfEdges: strip.halfEdges.map((edge, i) => i === 0 ? { ...edge, ...patch } : edge) });
    for (const patch of [{ id: 12 }, { twin: 0 }, { twin: 100 }, { next: 2 }, { face: 999 }, { vertex: 999 }]) {
      assert.throws(() => run(corrupt(patch), "edge", [], "all"));
    }
    assert.throws(() => run({ ...strip, faces: strip.faces.slice(1) }, "face", [], "all"));
  });
  it("rejects corrupt loops instead of looping forever", () => {
    assert.throws(() => run({ ...strip, faces: strip.faces.map((face, i) => i === 0 ? { ...face, he: -1 } : face) }, "face", [], "all"));
    const mesh = fixture([[0, 1, 2, 1]]);
    assert.throws(() => run(mesh, "face", [], "all"));
  });
  it("rejects excessive topology before traversing it", () => {
    assert.throws(() => run({ vertices: new Array(1_000_001), halfEdges: [], faces: [] }, "vertex", [], "all"), /예산/u);
  });
  it("refuses selections over 50,000 rather than silently truncating", () => {
    const mesh = fixture([], Array.from({ length: 50_001 }, (_, i) => i));
    assert.throws(() => run(mesh, "vertex", [], "all"), /50,000/u);
    assert.throws(() => run(mesh, "vertex", new Array(50_001).fill(0), "none"));
  });
  it("handles a 4,000-spoke high-valence vertex without constructing a clique", () => {
    const spokes = Array.from({ length: 4_000 }, (_, i) => [0, i * 2 + 1, i * 2 + 2]);
    const mesh = fixture(spokes);
    assert.equal(run(mesh, "edge", [0], "linked").length, 12_000);
    assert.equal(run(mesh, "vertex", [0], "grow").length, 8_001);
  });
  it("matches an independent vertex BFS oracle over 64 grid and endpoint fixtures", () => {
    for (let size = 2; size <= 9; size += 1) {
      const polygons: number[][] = [];
      for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) {
        const a = row * (size + 1) + col;
        polygons.push([a, a + 1, a + size + 2, a + size + 1]);
      }
      const mesh = fixture(polygons);
      const neighbours = new Map<number, Set<number>>();
      for (const polygon of polygons) for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
        if (!neighbours.has(a)) neighbours.set(a, new Set());
        if (!neighbours.has(b)) neighbours.set(b, new Set());
        neighbours.get(a)!.add(b); neighbours.get(b)!.add(a);
      }
      for (let seed = 0; seed < 8; seed += 1) {
        const start = seed % neighbours.size;
        const goal = neighbours.size - 1;
        if (start === goal) continue;
        const queue = [start], distances = new Map([[start, 0]]);
        for (let i = 0; i < queue.length; i += 1) for (const next of neighbours.get(queue[i]!)!) {
          if (distances.has(next)) continue;
          distances.set(next, distances.get(queue[i]!)! + 1); queue.push(next);
        }
        const path = run(mesh, "vertex", [start, goal], "path");
        assert.equal(path.length, distances.get(goal)! + 1);
        assert.ok(path.includes(start) && path.includes(goal));
        assert.deepEqual(run(mesh, "vertex", [start], "grow"), sorted([start, ...neighbours.get(start)!]));
      }
    }
  });
});

describe("preflighted selection callback plans", () => {
  it("uses a minimal delta and removes before adding", () => {
    assert.deepEqual(plan([1, 2, 3], [2, 3, 4], true), [{ operation: "subtract", id: 1 }, { operation: "add", id: 4 }]);
    assert.deepEqual(plan([1, 2], [1, 2], true), []);
  });
  it("uses one clear command even for a very large current selection", () => {
    assert.deepEqual(plan(Array.from({ length: 50_000 }, (_, i) => i), [], true), [{ operation: "clear" }]);
  });
  it("refuses oversized callback work before any callback can execute", () => {
    assert.throws(() => plan([], Array.from({ length: 513 }, (_, i) => i), true), /512/u);
    const before = Array.from({ length: 50_000 }, (_, i) => i);
    assert.throws(() => plan(before, before.slice(100), false), /512/u);
    assert.throws(() => plan([NaN], [], true));
  });
  it("returns an immutable plan and does not alter either input", () => {
    const before = Object.freeze([3, 2, 1]), after = Object.freeze([5]);
    const steps = plan(before, after, true);
    assert.ok(Object.isFrozen(steps));
    assert.ok(steps.every(Object.isFrozen));
    assert.deepEqual(before, [3, 2, 1]); assert.deepEqual(after, [5]);
  });
  it("produces exactly the requested result for 256 overlapping selection fixtures", () => {
    for (let seed = 0; seed < 256; seed += 1) {
      const before = Array.from({ length: 50 }, (_, i) => i).filter((i) => (i + seed) % 3 === 0);
      const after = Array.from({ length: 60 }, (_, i) => i).filter((i) => (i * 7 + seed) % 5 === 0);
      for (const canClear of [true, false]) {
        const current = new Set(before);
        for (const step of plan(before, after, canClear)) {
          if (step.operation === "clear") current.clear();
          else if (step.operation === "add") current.add(step.id);
          else current.delete(step.id);
        }
        assert.deepEqual(sorted(current), after);
      }
    }
  });
});

describe("selection shortcut policy", () => {
  it("exposes only the documented combinations", () => {
    assert.equal(shortcut({ key: "a" }), "all");
    assert.equal(shortcut({ key: "A", altKey: true }), "none");
    assert.equal(shortcut({ key: "i", ctrlKey: true }), "invert");
    assert.equal(shortcut({ key: "l" }), "linked");
    assert.equal(shortcut({ key: "+", code: "NumpadAdd", ctrlKey: true }), "grow");
    assert.equal(shortcut({ key: "-", code: "NumpadSubtract", ctrlKey: true }), "shrink");
    assert.equal(shortcut({ key: "l", ctrlKey: true }), null);
    assert.equal(shortcut({ key: "Delete" }), null);
  });
  it("rejects repeats, IME, reserved modifiers and consumed events", () => {
    for (const flag of ["repeat", "isComposing", "defaultPrevented", "shiftKey"] as const) assert.equal(shortcut({ key: "a", [flag]: true }), null);
    assert.equal(shortcut({ key: "a", keyCode: 229 }), null);
    assert.equal(shortcut({ key: "a", altKey: true, ctrlKey: true }), null);
    assert.equal(shortcut({ key: "a", metaKey: true }), null);
  });
});