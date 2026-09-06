// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Group, PerspectiveCamera, Scene } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioHybridDccIdentityTransform } from "./studio-hybrid-dcc-object-transform";
import { STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS } from "./studio-hybrid-dcc-viewport-interaction";
import { StudioHybridDccTransformGizmo } from "./StudioHybridDccTransformGizmo";

const harness = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: Record<string, unknown>) => unknown) => select(harness.state),
}));
beforeEach(() => {
  const camera = new PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(4, 4, 4); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  harness.state = {
    camera, scene: new Scene(), controls: { enabled: true },
    gl: { domElement: document.createElement("canvas") }, invalidate: vi.fn(),
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() {
  const object = new Group();
  const scene = harness.state.scene as Scene;
  scene.add(object);
  const attach = vi.spyOn(TransformControls.prototype, "attach");
  const dispose = vi.spyOn(TransformControls.prototype, "dispose");
  const props = {
    objectRef: { current: object },
    source: { assetId: "cube", geometryStamp: "mesh:1", transform: createStudioHybridDccIdentityTransform() },
    mode: "translate" as const, space: "world" as const,
    preferences: STUDIO_HYBRID_DCC_VIEWPORT_DEFAULTS,
    onCommit: vi.fn(), onDraggingChange: vi.fn(), onNotice: vi.fn(),
  };
  const view = render(<StudioHybridDccTransformGizmo {...props}><span>mesh</span></StudioHybridDccTransformGizmo>);
  const control = attach.mock.contexts[0] as TransformControls;
  return { ...view, props, object, scene, control, attach, dispose };
}
function start(control: TransformControls) {
  act(() => { control.axis = "X"; control.pointerDown(null); });
}
function finish(control: TransformControls) { act(() => control.pointerUp(null)); }

// Real Three.js controls and events, mocked R3F store. These are not WebGL pointer-render tests.
describe("native gizmo gesture lifecycle", () => {
  it("attaches the canonical child rather than a wrapper and owns one scene helper", () => {
    const { attach, object, scene, unmount, dispose } = setup();
    expect(attach).toHaveBeenCalledWith(object);
    expect(scene.children).toHaveLength(2);
    unmount();
    expect(scene.children).toEqual([object]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("commits once and never leaves an uncommitted presentation pose", () => {
    const { props, object, control } = setup();
    start(control); object.position.x = 2; finish(control); finish(control);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith("cube", { ...props.source.transform, position: [2, 0, 0] });
    expect(object.position.toArray()).toEqual([0, 0, 0]);
  });
  it("does not create an undo command for a click with no movement", () => {
    const { props, control } = setup(); start(control); finish(control);
    expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("cancels Escape through public pointerUp before a parent dialog can consume it", () => {
    const { props, object, control } = setup(); start(control); object.position.x = 4;
    const pointerUp = vi.spyOn(control, "pointerUp");
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(pointerUp).toHaveBeenCalledWith(null);
    expect(object.position.toArray()).toEqual([0, 0, 0]);
    expect(control.dragging).toBe(false);
    finish(control); expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("restores source on focus loss and rejects the later pointer-up", () => {
    const { props, object, control } = setup(); start(control); object.position.y = 4;
    fireEvent(window, new Event("blur")); finish(control);
    expect(object.position.toArray()).toEqual([0, 0, 0]);
    expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("cancels a stale gesture when the authoring source changes", () => {
    const { rerender, props, object, control } = setup(); start(control); object.position.x = 4;
    rerender(<StudioHybridDccTransformGizmo {...props} source={{ ...props.source, geometryStamp: "mesh:2", transform: { ...props.source.transform, position: [8, 0, 0] } }}><span>mesh</span></StudioHybridDccTransformGizmo>);
    expect(object.position.toArray()).toEqual([8, 0, 0]);
    finish(control); expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("rejects singular scale and restores the unchanged authoring transform", () => {
    const { props, object, control } = setup(); start(control); object.scale.y = 0; finish(control);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(object.scale.toArray()).toEqual([1, 1, 1]);
    expect(props.onNotice).toHaveBeenLastCalledWith(expect.stringContaining("유효하지 않은 변형"));
  });
  it("forwards null snaps and restores an interrupted gesture on unmount", () => {
    const { rerender, unmount, props, object, control } = setup();
    rerender(<StudioHybridDccTransformGizmo {...props} preferences={{ ...props.preferences, snapping: false }}><span>mesh</span></StudioHybridDccTransformGizmo>);
    expect(control.translationSnap).toBeNull();
    expect(control.rotationSnap).toBeNull();
    expect(control.scaleSnap).toBeNull();
    start(control); object.rotation.x = 0.8; unmount();
    expect(object.rotation.x).toBe(0);
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(control.dragging).toBe(false);
  });
  it("leases navigation only for an active drag and supports the next drag after cancellation", () => {
    const { control, object, props } = setup();
    const navigation = harness.state.controls as { enabled: boolean };
    start(control); expect(navigation.enabled).toBe(false);
    fireEvent(window, new Event("blur")); expect(navigation.enabled).toBe(true);
    start(control); object.position.x = 3; finish(control);
    expect(props.onCommit).toHaveBeenCalledTimes(1); expect(navigation.enabled).toBe(true);
  });
});
