import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { createStudioHybridDccIdentityTransform, type StudioHybridDccObjectTransform } from "./studio-hybrid-dcc-object-transform";
import { createStudioHybridDccSelectionGate } from "./studio-hybrid-dcc-selection-gate";
import {
  createStudioHybridDccTransformRuntime,
  type StudioHybridDccTransformControl,
  type StudioHybridDccTransformRuntimeEvent,
  type StudioHybridDccTransformRuntimeState,
  type StudioHybridDccTransformTarget,
} from "./studio-hybrid-dcc-transform-runtime";

class Vector {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
}
class Target implements StudioHybridDccTransformTarget {
  position = new Vector();
  rotation = new Vector();
  scale = new Vector(1, 1, 1);
  updates = 0;
  updateMatrixWorld() { this.updates += 1; }
}
/** Deliberately models Three's synchronous mouseUp-before-dragging=false ordering. */
class Control implements StudioHybridDccTransformControl<Target> {
  dragging = false;
  target: Target | null = null;
  pointerUps = 0;
  detached = 0;
  listeners = new Map<StudioHybridDccTransformRuntimeEvent, Set<() => void>>();
  attach(target: Target) { this.target = target; }
  detach() { this.target = null; this.detached += 1; }
  addEventListener(event: StudioHybridDccTransformRuntimeEvent, callback: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }
  removeEventListener(event: StudioHybridDccTransformRuntimeEvent, callback: () => void) { this.listeners.get(event)?.delete(callback); }
  emit(event: StudioHybridDccTransformRuntimeEvent) { for (const callback of this.listeners.get(event) ?? []) callback(); }
  pointerDown() { this.dragging = true; this.emit("dragging-changed"); this.emit("mouseDown"); }
  pointerUp(pointer: null) {
    assert.equal(pointer, null);
    this.pointerUps += 1;
    if (this.dragging) this.emit("mouseUp");
    this.dragging = false;
    this.emit("dragging-changed");
  }
}
function fixture(enabled = true) {
  const target = new Target(), control = new Control(), navigation = { enabled };
  const commits: { assetId: string; transform: StudioHybridDccObjectTransform }[] = [];
  const notices: string[] = [], dragging: boolean[] = [];
  let frames = 0;
  const state: StudioHybridDccTransformRuntimeState = {
    source: { assetId: "canonical", geometryStamp: "revision:1", transform: createStudioHybridDccIdentityTransform() },
    onCommit: (assetId, transform) => commits.push({ assetId, transform }),
    onNotice: (message) => notices.push(message), onDraggingChange: (value) => dragging.push(value),
    invalidate: () => { frames += 1; },
  };
  const latest = { current: state };
  const runtime = createStudioHybridDccTransformRuntime(control, target, () => latest.current, navigation);
  return { target, control, navigation, commits, notices, dragging, latest, runtime, get frames() { return frames; } };
}

describe("canonical transform runtime", () => {
  it("attaches the exact canonical target, never an implicit wrapper", () => {
    const f = fixture(); assert.equal(f.control.target, f.target); f.runtime.dispose();
  });
  it("commits a translated canonical target exactly once and restores display until authority updates", () => {
    const f = fixture(); f.control.pointerDown(); f.target.position.x = 4;
    f.control.pointerUp(null); f.control.pointerUp(null);
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0]!.assetId, "canonical");
    assert.deepEqual(f.commits[0]!.transform.position, [4, 0, 0]);
    assert.equal(f.target.position.x, 0); assert.equal(f.navigation.enabled, true);
    f.runtime.dispose();
  });
  it("does not commit a click with no movement", () => {
    const f = fixture(); f.control.pointerDown(); f.control.pointerUp(null);
    assert.equal(f.commits.length, 0); f.runtime.dispose();
  });
  it("cancels via the public API without committing its reentrant mouseUp", () => {
    const f = fixture(); f.control.pointerDown(); f.target.position.y = 8;
    assert.equal(f.runtime.cancel("cancel"), true);
    assert.equal(f.control.pointerUps, 1); assert.equal(f.control.dragging, false);
    assert.equal(f.runtime.active, false); assert.equal(f.target.position.y, 0);
    assert.equal(f.commits.length, 0); assert.equal(f.navigation.enabled, true);
    f.control.pointerUp(null); assert.equal(f.commits.length, 0); f.runtime.dispose();
  });
  it("starts a new drag successfully after cancellation", () => {
    const f = fixture(); f.control.pointerDown(); f.runtime.cancel();
    f.control.pointerDown(); f.target.scale.x = -2; f.control.pointerUp(null);
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0]!.transform.scale[0], -2); f.runtime.dispose();
  });
  it("rejects source changes between start and finish", () => {
    const f = fixture(); f.control.pointerDown(); f.target.position.x = 7;
    f.latest.current = { ...f.latest.current, source: { ...f.latest.current.source, geometryStamp: "revision:2" } };
    f.control.pointerUp(null);
    assert.equal(f.commits.length, 0); assert.equal(f.target.position.x, 0);
    assert.ok(f.notices.at(-1)?.includes("원본이 변경")); f.runtime.dispose();
  });
  it("restores the latest authority rather than the obsolete gesture start", () => {
    const f = fixture(); f.control.pointerDown(); f.target.position.x = 7;
    f.latest.current = { ...f.latest.current, source: { ...f.latest.current.source,
      transform: { ...createStudioHybridDccIdentityTransform(), position: [12, 3, 4] } } };
    f.runtime.cancel(); assert.equal(f.target.position.x, 12); assert.equal(f.commits.length, 0); f.runtime.dispose();
  });
  it("rejects singular and nonfinite transforms without damaging authority", () => {
    for (const value of [0, NaN, Infinity]) {
      const f = fixture(); f.control.pointerDown(); f.target.scale.y = value; f.control.pointerUp(null);
      assert.equal(f.commits.length, 0); assert.equal(f.target.scale.y, 1); f.runtime.dispose();
    }
  });
  it("recovers from a synchronous command failure with no phantom display pose", () => {
    const f = fixture(); f.latest.current = { ...f.latest.current, onCommit: () => { throw new Error("denied"); } };
    f.control.pointerDown(); f.target.position.z = 9; f.control.pointerUp(null);
    assert.equal(f.target.position.z, 0); assert.equal(f.notices.at(-1), "denied"); f.runtime.dispose();
  });
  it("preserves an already-disabled navigation controller", () => {
    const f = fixture(false); f.control.pointerDown(); f.target.position.x = 1; f.control.pointerUp(null);
    assert.equal(f.navigation.enabled, false); f.runtime.dispose(); assert.equal(f.navigation.enabled, false);
  });
  it("leases orbit immediately on dragging-changed and returns it after interruption", () => {
    const f = fixture(); f.control.pointerDown(); assert.equal(f.navigation.enabled, false);
    f.runtime.cancel(); assert.equal(f.navigation.enabled, true); f.runtime.dispose();
  });
  it("does not overwrite another owner's explicit navigation enable", () => {
    const f = fixture(false); f.control.pointerDown(); f.navigation.enabled = true;
    f.runtime.cancel(); assert.equal(f.navigation.enabled, true); f.runtime.dispose();
  });
  it("disposes idempotently, cancels active edits and removes every owned listener", () => {
    const f = fixture(); f.control.pointerDown(); f.target.rotation.x = 1;
    f.runtime.dispose(); f.runtime.dispose();
    assert.equal(f.target.rotation.x, 0); assert.equal(f.commits.length, 0);
    assert.equal(f.control.detached, 1); assert.equal(f.control.target, null);
    assert.equal([...f.control.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0);
    const frames = f.frames; f.control.emit("change"); assert.equal(f.frames, frames);
  });
  it("routes committed edits to the latest callback without recreating controls", () => {
    const f = fixture(); let calls = 0;
    f.latest.current = { ...f.latest.current, onCommit: () => { calls += 1; } };
    f.control.pointerDown(); f.target.position.x = 1; f.control.pointerUp(null);
    assert.equal(calls, 1); assert.equal(f.commits.length, 0); f.runtime.dispose();
  });
  it("allows cancellation when native dragging begins but gesture validation fails", () => {
    const f = fixture(); f.latest.current = { ...f.latest.current, source: { ...f.latest.current.source, geometryStamp: "" } };
    f.control.pointerDown(); assert.equal(f.control.dragging, false);
    assert.equal(f.commits.length, 0); assert.equal(f.navigation.enabled, true); f.runtime.dispose();
  });
});

describe("event-only selection guard", () => {
  function fixture() {
    const callbacks: (() => void)[] = [], cancelled: number[] = [];
    const gate = createStudioHybridDccSelectionGate((callback, delay) => {
      assert.equal(delay, 120); callbacks.push(callback); return callbacks.length - 1;
    }, (id) => cancelled.push(id));
    return { gate, callbacks, cancelled };
  }
  it("does not schedule work merely to check selection availability", () => {
    const f = fixture(); for (let i = 0; i < 1000; i += 1) assert.equal(f.gate.allows(), true);
    assert.equal(f.callbacks.length, 0); f.gate.dispose();
  });
  it("suppresses the post-drag click and releases selection once the timer runs", () => {
    const f = fixture(); f.gate.suppress(); assert.equal(f.gate.allows(), false);
    f.callbacks[0]!(); assert.equal(f.gate.allows(), true); f.gate.dispose();
  });
  it("does not let an old timer release a newer suppression lease", () => {
    const f = fixture(); f.gate.suppress(); f.gate.suppress();
    assert.deepEqual(f.cancelled, [0]); f.callbacks[0]!(); assert.equal(f.gate.allows(), false);
    f.callbacks[1]!(); assert.equal(f.gate.allows(), true); f.gate.dispose();
  });
  it("cannot rearm or release the guard after unmount", () => {
    const f = fixture(); f.gate.suppress(); f.gate.dispose(); f.gate.suppress(); f.callbacks[0]!();
    assert.equal(f.gate.allows(), false); assert.equal(f.callbacks.length, 1); assert.deepEqual(f.cancelled, [0]);
  });
});
