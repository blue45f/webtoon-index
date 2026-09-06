// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStudioBg3dPlacementRaycastScratch,
  resolveStudioBg3dPlacementPointerTarget,
  STUDIO_BG3D_PLACEMENT_RAYCAST_IGNORE_USER_DATA_KEY,
  StudioBg3dPlacementPointerController,
} from "./StudioBg3dPlacementPointerController";

import type { StudioBg3dPlacementPointerControllerProps } from "./StudioBg3dPlacementPointerController";

const fiberMock = vi.hoisted(() => ({
  state: null as unknown,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: unknown) => unknown) => selector(fiberMock.state),
}));

const VIEWPORT_RECT = Object.freeze({ left: 10, top: 20, width: 200, height: 100 });

function makeCamera(
  position: readonly [number, number, number] = [0, 5, 5],
  target: readonly [number, number, number] = [0, 0, 0],
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100_000);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 120,
      height: 100,
      left: 10,
      right: 210,
      toJSON: () => undefined,
      top: 20,
      width: 200,
      x: 10,
      y: 20,
    } satisfies DOMRect),
  });
  document.body.append(canvas);
  return canvas;
}

function makePointerEvent(
  type: "pointerdown" | "pointermove",
  overrides: {
    readonly button?: number;
    readonly clientX?: number;
    readonly clientY?: number;
    readonly isPrimary?: boolean;
    readonly shiftKey?: boolean;
  } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: overrides.button ?? 0,
    cancelable: true,
    clientX: overrides.clientX ?? 110,
    clientY: overrides.clientY ?? 70,
    shiftKey: overrides.shiftKey ?? false,
  });
  Object.defineProperty(event, "isPrimary", {
    configurable: true,
    value: overrides.isPrimary ?? true,
  });
  return event as PointerEvent;
}

function renderController(
  overrides: Partial<StudioBg3dPlacementPointerControllerProps> = {},
) {
  const props: StudioBg3dPlacementPointerControllerProps = {
    active: true,
    objectsRef: { current: new Map() },
    onCancel: vi.fn(),
    onCommit: vi.fn(),
    onMove: vi.fn(),
    onRotate: vi.fn(),
    ...overrides,
  };
  return {
    props,
    rendered: render(<StudioBg3dPlacementPointerController {...props} />),
  };
}

beforeEach(() => {
  fiberMock.state = {
    camera: makeCamera(),
    events: { connected: undefined },
    gl: { domElement: makeCanvas() },
  };
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Studio BG3D placement raycast", () => {
  it("prefers the closest actual mapped model surface and returns a normalized world normal", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 2),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.y = 0.5;
    root.add(mesh);
    root.updateWorldMatrix(true, true);

    const target = resolveStudioBg3dPlacementPointerTarget({
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map([["model-1", root]]),
      rect: VIEWPORT_RECT,
    });

    expect(target?.surfaceHit).toBeDefined();
    expect(target?.floorPoint).toBeUndefined();
    expect(Math.hypot(...(target?.surfaceHit?.normal ?? [0, 0, 0]))).toBeCloseTo(1);
    expect(target?.surfaceHit?.point.every(Number.isFinite)).toBe(true);
  });

  it("falls back to the canonical y=0 floor when no mapped surface is hit", () => {
    const target = resolveStudioBg3dPlacementPointerTarget({
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map(),
      rect: VIEWPORT_RECT,
    });

    expect(target).toEqual({ floorPoint: [0, 0] });
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target?.floorPoint)).toBe(true);
  });

  it("never raycasts preview/helper roots or marked helper descendants", () => {
    const preview = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial());
    preview.userData[STUDIO_BG3D_PLACEMENT_RAYCAST_IGNORE_USER_DATA_KEY] = true;
    preview.rotateX(-Math.PI / 2);
    preview.position.y = 2;
    preview.updateWorldMatrix(true, true);

    const target = resolveStudioBg3dPlacementPointerTarget({
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map([["preview", preview]]),
      rect: VIEWPORT_RECT,
    });

    expect(target).toEqual({ floorPoint: [0, 0] });
  });

  it("fails closed when the closest eligible model reports malformed surface data", () => {
    const broken = new THREE.Mesh();
    broken.raycast = (_raycaster, intersections) => {
      intersections.push({
        distance: 1,
        face: { a: 0, b: 0, c: 0, materialIndex: 0, normal: new THREE.Vector3(0, 0, 0) },
        faceIndex: 0,
        object: broken,
        point: new THREE.Vector3(0, 0, 0),
      });
    };

    expect(resolveStudioBg3dPlacementPointerTarget({
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map([["broken", broken]]),
      rect: VIEWPORT_RECT,
    })).toBeNull();
  });

  it("rejects invalid viewports, out-of-viewport samples, non-finite cameras, and world overflow", () => {
    const base = {
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map<string, THREE.Object3D>(),
      rect: VIEWPORT_RECT,
    };
    expect(resolveStudioBg3dPlacementPointerTarget({
      ...base,
      rect: { ...VIEWPORT_RECT, width: 0 },
    })).toBeNull();
    expect(resolveStudioBg3dPlacementPointerTarget({ ...base, clientX: 211 })).toBeNull();
    expect(resolveStudioBg3dPlacementPointerTarget({ ...base, clientY: Number.NaN })).toBeNull();

    const brokenCamera = makeCamera();
    brokenCamera.projectionMatrix.elements[0] = Number.NaN;
    expect(resolveStudioBg3dPlacementPointerTarget({ ...base, camera: brokenCamera })).toBeNull();

    const remoteCamera = makeCamera([20_001, 10, 0], [20_001, 0, 0]);
    expect(resolveStudioBg3dPlacementPointerTarget({ ...base, camera: remoteCamera })).toBeNull();
  });

  it("can reuse one bounded scratch allocation without retaining intersections", () => {
    const scratch = createStudioBg3dPlacementRaycastScratch();
    const input = {
      camera: makeCamera(),
      clientX: 110,
      clientY: 70,
      objects: new Map<string, THREE.Object3D>(),
      rect: VIEWPORT_RECT,
    };

    expect(resolveStudioBg3dPlacementPointerTarget(input, scratch)).toEqual({ floorPoint: [0, 0] });
    expect(resolveStudioBg3dPlacementPointerTarget(input, scratch)).toEqual({ floorPoint: [0, 0] });
    expect(scratch.intersections).toHaveLength(0);
    expect(scratch.roots).toHaveLength(0);
    expect(scratch.rootSet.size).toBe(0);
  });
});

describe("StudioBg3dPlacementPointerController", () => {
  it("commits from the connected R3F event source when the canvas is pointer-transparent", () => {
    const onCommit = vi.fn();
    const state = fiberMock.state as {
      events: { connected: HTMLElement | undefined };
      gl: { domElement: HTMLCanvasElement };
    };
    const viewport = document.createElement("div");
    document.body.append(viewport);
    viewport.append(state.gl.domElement);
    state.events.connected = viewport;

    renderController({ onCommit });
    viewport.dispatchEvent(makePointerEvent("pointerdown"));

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0]).toEqual({ floorPoint: [0, 0] });
  });

  it("does not intercept placement controls inside the connected event source", () => {
    const onCommit = vi.fn();
    const controlPointerDown = vi.fn();
    const state = fiberMock.state as {
      events: { connected: HTMLElement | undefined };
      gl: { domElement: HTMLCanvasElement };
    };
    const viewport = document.createElement("div");
    const controls = document.createElement("div");
    controls.dataset.bg3dViewportControl = "true";
    const rotateButton = document.createElement("button");
    rotateButton.addEventListener("pointerdown", controlPointerDown);
    controls.append(rotateButton);
    viewport.append(state.gl.domElement, controls);
    document.body.append(viewport);
    state.events.connected = viewport;

    renderController({ onCommit });
    const event = makePointerEvent("pointerdown");
    expect(rotateButton.dispatchEvent(event)).toBe(true);

    expect(event.defaultPrevented).toBe(false);
    expect(controlPointerDown).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("emits native primary-pointer hover and commit targets with Shift state", () => {
    const onMove = vi.fn();
    const onCommit = vi.fn();
    const canvas = (fiberMock.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement;
    renderController({ onCommit, onMove });

    canvas.dispatchEvent(makePointerEvent("pointermove", { shiftKey: true }));
    canvas.dispatchEvent(makePointerEvent("pointerdown", { shiftKey: true }));

    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0]?.[0]).toEqual({ floorPoint: [0, 0] });
    expect(onMove.mock.calls[0]?.[1]).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0]).toEqual({ floorPoint: [0, 0] });
    expect(onCommit.mock.calls[0]?.[1]).toBe(true);
  });

  it("blocks placement pointerdown before bubble-phase R3F selection/orbit handlers", () => {
    const onCommit = vi.fn();
    const bubbleHandler = vi.fn();
    const canvas = (fiberMock.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement;
    canvas.addEventListener("pointerdown", bubbleHandler);
    renderController({ onCommit });
    const event = makePointerEvent("pointerdown");

    expect(canvas.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbleHandler).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("blocks but never commits secondary pointers or non-primary buttons", () => {
    const onCommit = vi.fn();
    const canvas = (fiberMock.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement;
    renderController({ onCommit });
    const secondaryPointer = makePointerEvent("pointerdown", { isPrimary: false });
    const rightButton = makePointerEvent("pointerdown", { button: 2 });

    canvas.dispatchEvent(secondaryPointer);
    canvas.dispatchEvent(rightButton);

    expect(secondaryPointer.defaultPrevented).toBe(true);
    expect(rightButton.defaultPrevented).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("supports Escape and bracket rotation shortcuts without hijacking text entry", () => {
    const onCancel = vi.fn();
    const onRotate = vi.fn();
    renderController({ onCancel, onRotate });

    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "BracketLeft",
      key: "[",
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "BracketRight",
      key: "]",
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
    }));

    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "BracketRight",
      key: "]",
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "BracketRight",
      ctrlKey: true,
      key: "]",
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      repeat: true,
    }));

    expect(onRotate.mock.calls).toEqual([["counter-clockwise"], ["clockwise"]]);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("reads the latest callbacks and object map without rebuilding stale event closures", () => {
    const staleMove = vi.fn();
    const latestMove = vi.fn();
    const originalRef = { current: new Map<string, THREE.Object3D>() };
    const canvas = (fiberMock.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement;
    const { props, rendered } = renderController({ objectsRef: originalRef, onMove: staleMove });

    rendered.rerender(
      <StudioBg3dPlacementPointerController
        {...props}
        onMove={latestMove}
      />,
    );
    canvas.dispatchEvent(makePointerEvent("pointermove"));

    expect(staleMove).not.toHaveBeenCalled();
    expect(latestMove).toHaveBeenCalledOnce();
  });

  it("removes canvas and window listeners when inactive or unmounted", () => {
    const onCancel = vi.fn();
    const onCommit = vi.fn();
    const bubbleHandler = vi.fn();
    const canvas = (fiberMock.state as { gl: { domElement: HTMLCanvasElement } }).gl.domElement;
    canvas.addEventListener("pointerdown", bubbleHandler);
    const { props, rendered } = renderController({ onCancel, onCommit });

    rendered.rerender(
      <StudioBg3dPlacementPointerController
        {...props}
        active={false}
      />,
    );
    const inactiveEvent = makePointerEvent("pointerdown");
    expect(canvas.dispatchEvent(inactiveEvent)).toBe(true);
    expect(inactiveEvent.defaultPrevented).toBe(false);
    expect(bubbleHandler).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();

    rendered.unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
