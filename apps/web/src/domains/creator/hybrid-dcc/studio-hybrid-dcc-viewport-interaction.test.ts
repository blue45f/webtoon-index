import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createStudioHybridDccIdentityTransform as identity, hashStudioHybridDccObjectTransform as hash, normalizeStudioHybridDccObjectTransform as normalize, type StudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";
import { beginStudioHybridDccTransformGesture as begin, finishStudioHybridDccTransformGesture as finish } from "./studio-hybrid-dcc-transform-gesture";
import { alignStudioHybridDccObjectBounds as align, copyStudioHybridDccTransformPart as copy, mirrorStudioHybridDccTransformLocal as mirror, resetStudioHybridDccTransformPart as reset } from "./studio-hybrid-dcc-transform-utilities";
import {
  fitStudioHybridDccCamera as fit,
  normalizeStudioHybridDccViewportPreferences as preferences,
  parseStudioHybridDccViewportPreferences as parse,
  resolveStudioHybridDccGizmoSnaps as snaps,
  resolveStudioHybridDccViewportShortcut as shortcut,
  shouldReframeStudioHybridDccCamera as reframe,
  studioHybridDccViewBasis as basis,
  STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS as defaults,
  type StudioHybridDccShortcutContext,
} from "./studio-hybrid-dcc-viewport-interaction";

const context: StudioHybridDccShortcutContext = {
  textEntry: false, selected: true, editingDisabled: false, objectMode: true,
  canTransform: true, canSelectComponents: true, canDuplicate: true, canDelete: true,
};
const source = () => ({ assetId: "cube", geometryStamp: "mesh:1:render:1", transform: identity() });
const moved: StudioHybridDccObjectTransform = { ...identity(), position: [3, -2, 5], rotationEulerRad: [0.4, 0.2, -0.8], scale: [-2, 3, 0.5] };
const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

describe("validated viewport preferences", () => {
  it("defaults invalid versions and malformed JSON without throwing", () => {
    for (const text of [null, "", "{", "[]", "null", "{}", '{"version":2}', "x".repeat(4097)]) assert.deepEqual(parse(text), defaults);
  });
  it("preserves explicit false and rejects non-boolean flags", () => {
    assert.equal(preferences({ ...defaults, snapping: false }).snapping, false);
    assert.equal(preferences({ ...defaults, showGrid: "false" }).showGrid, true);
    assert.equal(preferences({ ...defaults, showAxes: false }).showAxes, false);
  });
  it("bounds all three snap parameters independently", () => {
    for (const key of ["translationStep", "rotationStepDegrees", "scaleStep"] as const) {
      for (const value of [0, -1, Infinity, NaN, "0.1", 1e12]) assert.equal(preferences({ ...defaults, [key]: value })[key], defaults[key]);
    }
    assert.equal(preferences({ ...defaults, translationStep: 0.000001 }).translationStep, 0.000001);
    assert.equal(preferences({ ...defaults, rotationStepDegrees: 180 }).rotationStepDegrees, 180);
  });
  it("removes unknown document-like fields", () => {
    assert.deepEqual(preferences({ ...defaults, geometry: "untrusted", objectTransforms: {} }), defaults);
  });
  it("actually disables all renderer snapping through null", () => {
    assert.deepEqual(snaps({ ...defaults, snapping: false }), { translationSnap: null, rotationSnap: null, scaleSnap: null });
    close(snaps(defaults).rotationSnap!, Math.PI / 12);
    assert.deepEqual(snaps({ ...defaults, translationStep: 0.25, scaleStep: 0.5 }), { translationSnap: 0.25, rotationSnap: Math.PI / 12, scaleSnap: 0.5 });
  });
});

describe("camera fit and explicit navigation intent", () => {
  it("fits sampled sphere surfaces for 36 aspect/radius combinations (18,432 points)", () => {
    for (const width of [240, 320, 640, 1920]) for (const height of [240, 900, 1080]) for (const radius of [0.25, 1, 1000]) {
      const result = fit(radius, width, height);
      const tangent = Math.tan(42 * Math.PI / 360);
      for (let i = 0; i < 512; i += 1) {
        const z = radius * (2 * (i + 0.5) / 512 - 1);
        const ring = Math.sqrt(radius * radius - z * z);
        const angle = i * 2.399963229728653;
        const x = ring * Math.cos(angle), y = ring * Math.sin(angle);
        assert.ok(Math.abs(x / ((result.distance - z) * tangent * width / height)) <= 1);
        assert.ok(Math.abs(y / ((result.distance - z) * tangent)) <= 1);
        assert.ok(2 * radius * result.orthographicZoom <= Math.min(width, height));
      }
    }
  });
  it("rejects zero, negative, nonfinite and extreme unsafe fit inputs", () => {
    for (const radius of [0, -1, NaN, Infinity]) assert.throws(() => fit(radius, 400, 600));
    assert.throws(() => fit(1, 0, 600));
    assert.throws(() => fit(1, 400, 600, 180));
    assert.throws(() => fit(1, 400, 600, 42, 0.5));
  });
  it("uses opposite views with non-collinear up vectors", () => {
    for (const view of ["front", "back", "left", "right", "top", "bottom"] as const) {
      const b = basis(view);
      close(b.direction.reduce((sum, value, i) => sum + value * b.up[i]!, 0), 0);
      close(Math.hypot(...b.direction), 1);
      close(Math.hypot(...b.up), 1);
    }
    assert.deepEqual(basis("back").direction, [0, 0, -1]);
    assert.deepEqual(basis("bottom").up, [0, 0, 1]);
  });
  it("only reframes for initial state or an explicit frame/orientation request", () => {
    const intent = { revision: 1, orientationRevision: 1, view: "front" as const };
    assert.equal(reframe(null, intent), true);
    for (let i = 0; i < 512; i += 1) assert.equal(reframe(intent, { ...intent }), false);
    assert.equal(reframe(intent, { ...intent, revision: 2 }), true);
    assert.equal(reframe(intent, { ...intent, orientationRevision: 2 }), true);
    assert.equal(reframe(intent, { ...intent, view: "top" }), true);
  });
});

describe("keyboard policy", () => {
  it("supports six standard views and a projection toggle", () => {
    const codes = ["Numpad1", "Numpad3", "Numpad7"];
    const views = ["front", "right", "top"], opposites = ["back", "left", "bottom"];
    codes.forEach((code, i) => {
      assert.deepEqual(shortcut({ key: "1", code }, context), { kind: "view", view: views[i] });
      assert.deepEqual(shortcut({ key: "1", code, ctrlKey: true }, context), { kind: "view", view: opposites[i] });
    });
    assert.deepEqual(shortcut({ key: "5", code: "Numpad5" }, context), { kind: "toggle-projection" });
  });
  it("supports explicit framing, isolation and snapping commands", () => {
    assert.deepEqual(shortcut({ key: "Home" }, context), { kind: "frame", target: "scene" });
    for (const key of ["f", "."]) assert.deepEqual(shortcut({ key }, context), { kind: "frame", target: "selection" });
    assert.equal(shortcut({ key: "f" }, { ...context, selected: false }), null);
    assert.deepEqual(shortcut({ key: "/" }, context), { kind: "toggle-isolation" });
    assert.deepEqual(shortcut({ key: "Tab", shiftKey: true }, context), { kind: "toggle-snap" });
  });
  it("ignores text entry, IME, repeated and already-consumed input", () => {
    for (const key of ["Delete", "Backspace", "g", "r", "s", "/", "Home"]) {
      assert.equal(shortcut({ key }, { ...context, textEntry: true }), null);
      assert.equal(shortcut({ key }, { ...context, dragging: true }), null);
      for (const property of ["isComposing", "repeat", "defaultPrevented", "altKey", "metaKey"] as const) assert.equal(shortcut({ key, [property]: true }, context), null);
      assert.equal(shortcut({ key, keyCode: 229 }, context), null);
    }
  });
  it("never converts component/read-only/unselected input into object edits", () => {
    for (const key of ["Delete", "Backspace", "g", "r", "s"]) {
      for (const blocked of [{ objectMode: false }, { editingDisabled: true }, { selected: false }]) assert.equal(shortcut({ key }, { ...context, ...blocked }), null);
    }
    assert.equal(shortcut({ key: "D", shiftKey: true }, { ...context, canDuplicate: false }), null);
    assert.equal(shortcut({ key: "s" }, { ...context, canTransform: false }), null);
    assert.equal(shortcut({ key: "Delete", ctrlKey: true }, context), null);
  });
  it("preserves selection mode and reversible duplicate/delete commands", () => {
    assert.deepEqual(shortcut({ key: "2", code: "Digit2" }, context), { kind: "selection", mode: "edge" });
    assert.deepEqual(shortcut({ key: "D", shiftKey: true }, context), { kind: "duplicate" });
    assert.deepEqual(shortcut({ key: "Delete" }, context), { kind: "delete" });
    assert.deepEqual(shortcut({ key: "g" }, context), { kind: "transform", mode: "translate" });
  });
});

describe("transform gesture transaction boundary", () => {
  it("detaches its starting transform and does not mutate authority", () => {
    const current = source();
    const gesture = begin(current);
    assert.notEqual(gesture.source.transform, current.transform);
    assert.notEqual(gesture.source.transform.position, current.transform.position);
    assert.deepEqual(current.transform, identity());
  });
  it("recognizes no-op and negative-zero gestures without adding commands", () => {
    const current = source(), gesture = begin(current);
    assert.deepEqual(finish(gesture, current, identity()), { kind: "unchanged" });
    assert.deepEqual(finish(gesture, current, { ...identity(), position: [-0, 0, -0] }), { kind: "unchanged" });
    const negativeZero = { ...identity(), position: [-0, 0, -0] as const };
    assert.equal(hash(negativeZero), hash(JSON.parse(JSON.stringify(negativeZero)) as StudioHybridDccObjectTransform));
    assert.equal(hash(identity()), [0, 0, 0, 0, 0, 0, 1, 1, 1].map((value) => value.toPrecision(17)).join(","));
  });
  it("accepts valid reflected transforms without mutating the input", () => {
    const current = source(), candidate = structuredClone(moved);
    const result = finish(begin(current), current, candidate);
    assert.equal(result.kind, "commit");
    if (result.kind !== "commit") throw new Error("expected commit");
    assert.deepEqual(result.transform, moved);
    assert.notEqual(result.transform.position, candidate.position);
    assert.deepEqual(current.transform, identity());
  });
  it("rejects changed source asset, geometry, or transform", () => {
    const current = source(), gesture = begin(current);
    for (const changed of [{ ...current, assetId: "other" }, { ...current, geometryStamp: "revision:2" }, { ...current, transform: moved }]) {
      assert.equal(finish(gesture, changed, moved).kind, "reject");
    }
  });
  it("rejects zero scales, non-finite, over-range and sparse arrays", () => {
    const current = source(), gesture = begin(current);
    for (const candidate of [
      { ...moved, scale: [1, 0, 1] }, { ...moved, position: [NaN, 0, 0] },
      { ...moved, position: [1_000_001, 0, 0] }, { ...moved, rotationEulerRad: new Array(3) },
      { ...moved, scale: new Array(3) }, { ...moved, position: new Array(3) },
    ]) assert.equal(finish(gesture, current, candidate).kind, "reject");
  });
  it("validates 1,024 finite gesture candidates against the canonical contract", () => {
    const current = source(), gesture = begin(current);
    for (let i = 1; i <= 1024; i += 1) {
      const candidate = { ...identity(), position: [Math.sin(i), i / 100, -i / 100] };
      const result = finish(gesture, current, candidate);
      assert.equal(result.kind, "commit");
      if (result.kind === "commit") assert.deepEqual(result.transform, normalize(candidate));
    }
  });
});

describe("reusable authoring utilities", () => {
  it("copies selected fields without changing unrelated transform components", () => {
    const next = copy(identity(), moved, "rotationEulerRad");
    assert.deepEqual(next.rotationEulerRad, moved.rotationEulerRad);
    assert.deepEqual(next.position, [0, 0, 0]);
    assert.deepEqual(next.scale, [1, 1, 1]);
    assert.notEqual(next.rotationEulerRad, moved.rotationEulerRad);
  });
  it("resets individual components or the whole transform", () => {
    assert.deepEqual(reset(moved, "all"), identity());
    const next = reset(moved, "scale");
    assert.deepEqual(next.scale, [1, 1, 1]);
    assert.deepEqual(next.position, moved.position);
    assert.deepEqual(next.rotationEulerRad, moved.rotationEulerRad);
  });
  it("mirrors involutively on each local axis including reflected sources", () => {
    for (const axis of [0, 1, 2] as const) assert.deepEqual(mirror(mirror(moved, axis), axis), moved);
  });
  it("places a prop bottom on a shelf top with a precise gap", () => {
    const next = align(moved, { min: [1, -3, 4], max: [5, -1, 6] },
      { min: [0, 2, 0], max: [10, 3, 10] }, 1, "min", "max", 0.02);
    close(next.position[1], 4.02);
    close(-3 + (next.position[1] - moved.position[1]), 3.02);
    assert.deepEqual(next.rotationEulerRad, moved.rotationEulerRad);
    assert.deepEqual(next.scale, moved.scale);
  });
  it("aligns each pair of AABB anchors on all three axes", () => {
    const anchors = ["min", "center", "max"] as const;
    const own = { min: [-2, -1, 0] as const, max: [2, 3, 4] as const };
    const other = { min: [5, 6, 7] as const, max: [7, 8, 9] as const };
    const pick = (bounds: typeof own | typeof other, axis: 0 | 1 | 2, anchor: typeof anchors[number]) => anchor === "center" ? (bounds.min[axis] + bounds.max[axis]) / 2 : bounds[anchor][axis];
    for (const axis of [0, 1, 2] as const) for (const a of anchors) for (const b of anchors) {
      const next = align(identity(), own, other, axis, a, b, 0.25);
      close(pick(own, axis, a) + next.position[axis], pick(other, axis, b) + 0.25);
    }
  });
  it("rejects inverted, nonfinite or sparse bounds", () => {
    const good = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };
    assert.throws(() => align(identity(), { ...good, min: [2, 0, 0] }, good, 0, "min", "max"));
    assert.throws(() => align(identity(), good, good, 0, "min", "max", Infinity));
    const sparse = new Array<number>(3);
    sparse[0] = 1; sparse[2] = 3;
    assert.throws(() => normalize({ ...identity(), position: sparse }));
  });
});
