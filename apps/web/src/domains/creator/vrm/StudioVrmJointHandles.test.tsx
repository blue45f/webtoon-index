// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  constrainStudioVrmJointWorldPoint,
  createStudioVrmJointDragPlane,
  projectStudioVrmJointPointerByMode,
  projectStudioVrmJointPointerToPlane,
  resolveStudioVrmJointDragOutcome,
  resolveStudioVrmJointNodeBindings,
  STUDIO_VRM_JOINT_HANDLE_DEFINITIONS,
  StudioVrmJointHandles,
} from "./StudioVrmJointHandles";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { ReactNode } from "react";

const fiberMock = vi.hoisted(() => ({
  frameCallbacks: [] as Array<() => void>,
  state: null as unknown,
}));
const animationFrameMock = vi.hoisted(() => ({
  nextId: 1,
  callbacks: new Map<number, FrameRequestCallback>(),
}));

vi.mock("@react-three/fiber", () => ({
  useFrame: (callback: () => void) => {
    fiberMock.frameCallbacks.push(callback);
  },
  useThree: (selector: (state: unknown) => unknown) => selector(fiberMock.state),
}));

vi.mock("@react-three/drei/web/Html.js", () => ({
  Html: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function makeVrm(
  nodes: Partial<Record<(typeof STUDIO_VRM_JOINT_HANDLE_DEFINITIONS)[number]["bone"], THREE.Object3D>>
): Pick<VRM, "humanoid"> {
  return {
    humanoid: {
      getNormalizedBoneNode: (name: VRMHumanBoneName) =>
        nodes[name as keyof typeof nodes] ?? null,
    },
  } as unknown as Pick<VRM, "humanoid">;
}

function rejectPointerCapture(handle: HTMLButtonElement) {
  const setPointerCapture = vi.fn(() => {
    throw new Error("pointer capture unavailable");
  });
  const releasePointerCapture = vi.fn();
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

beforeEach(() => {
  animationFrameMock.nextId = 1;
  animationFrameMock.callbacks.clear();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = animationFrameMock.nextId;
    animationFrameMock.nextId += 1;
    animationFrameMock.callbacks.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
    animationFrameMock.callbacks.delete(id);
  }));
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  fiberMock.state = {
    camera,
    scene: new THREE.Scene(),
    gl: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
      },
    },
  };
});

afterEach(() => {
  cleanup();
  fiberMock.frameCallbacks.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioVrmJointHandles helpers", () => {
  it("defines the requested center, left, and right joints with four IK effectors", () => {
    const bones = STUDIO_VRM_JOINT_HANDLE_DEFINITIONS.map((item) => item.bone);
    expect(bones).toEqual([
      "hips",
      "head",
      "leftShoulder",
      "rightShoulder",
      "leftLowerArm",
      "rightLowerArm",
      "leftHand",
      "rightHand",
      "leftLowerLeg",
      "rightLowerLeg",
      "leftFoot",
      "rightFoot",
    ]);
    expect(new Set(bones).size).toBe(bones.length);
    expect(STUDIO_VRM_JOINT_HANDLE_DEFINITIONS.filter((item) => item.effector).map((item) => item.bone))
      .toEqual(["leftHand", "rightHand", "leftFoot", "rightFoot"]);
  });

  it("skips absent and broken normalized bones without hiding valid bindings", () => {
    const hips = new THREE.Object3D();
    const leftHand = new THREE.Object3D();
    const bindings = resolveStudioVrmJointNodeBindings({
      getNormalizedBoneNode: (name) => {
        if (name === "rightShoulder") throw new Error("broken accessor");
        if (name === "hips") return hips;
        if (name === "leftHand") return leftHand;
        return null;
      },
    });

    expect(bindings.map((binding) => binding.bone)).toEqual(["hips", "leftHand"]);
    expect(bindings[0]?.node).toBe(hips);
    expect(bindings[1]?.node).toBe(leftHand);
    expect(resolveStudioVrmJointNodeBindings(null)).toEqual([]);
  });

  it("uses a copied explicit drag plane or a camera-facing plane through the start point", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const start = new THREE.Vector3(1, 2, 3);
    const explicit = new THREE.Plane(new THREE.Vector3(0, 2, 0), -4);

    const copied = createStudioVrmJointDragPlane(camera, start, explicit);
    expect(copied).not.toBe(explicit);
    expect(copied.normal.length()).toBeCloseTo(1);
    expect(copied.constant).toBeCloseTo(-2);
    expect(explicit.normal.length()).toBeCloseTo(2);
    expect(explicit.constant).toBe(-4);

    const cameraFacing = createStudioVrmJointDragPlane(camera, start);
    expect(cameraFacing.distanceToPoint(start)).toBeCloseTo(0);
    expect(Math.abs(cameraFacing.normal.dot(camera.getWorldDirection(new THREE.Vector3()))))
      .toBeCloseTo(1);
  });

  it("projects canvas coordinates onto the 3D drag plane and rejects invalid viewports", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    const center = projectStudioVrmJointPointerToPlane(
      200,
      100,
      { left: 100, top: 0, width: 200, height: 200 },
      camera,
      plane
    );
    expect(center?.x).toBeCloseTo(0);
    expect(center?.y).toBeCloseTo(0);
    expect(center?.z).toBeCloseTo(0);

    expect(projectStudioVrmJointPointerToPlane(
      0,
      0,
      { left: 0, top: 0, width: 0, height: 200 },
      camera,
      plane
    )).toBeNull();
    expect(projectStudioVrmJointPointerToPlane(
      Number.NaN,
      0,
      { left: 0, top: 0, width: 200, height: 200 },
      camera,
      plane
    )).toBeNull();
  });

  it("supports screen-plane axis locks and pointer-driven depth movement", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const start = new THREE.Vector3(1, 2, 0);
    const rect = { left: 0, top: 0, width: 400, height: 400 };

    const lockedScreen = projectStudioVrmJointPointerByMode(
      200,
      200,
      200,
      rect,
      camera,
      plane,
      start,
      "screen",
      "x",
    );
    expect(lockedScreen?.x).toBeCloseTo(0);
    expect(lockedScreen?.y).toBeCloseTo(2);
    expect(lockedScreen?.z).toBeCloseTo(0);

    const depth = projectStudioVrmJointPointerByMode(
      200,
      100,
      200,
      rect,
      camera,
      plane,
      start,
      "depth",
      "free",
    );
    expect(depth?.x).toBeCloseTo(1);
    expect(depth?.y).toBeCloseTo(2);
    expect(depth?.z).toBeLessThan(0);

    const yDepth = projectStudioVrmJointPointerByMode(
      200,
      100,
      200,
      rect,
      camera,
      plane,
      start,
      "depth",
      "y",
    );
    expect(yDepth?.x).toBeCloseTo(1);
    expect(yDepth?.y).toBeGreaterThan(2);
    expect(yDepth?.z).toBeCloseTo(0);

    expect(constrainStudioVrmJointWorldPoint(
      start,
      new THREE.Vector3(3, 4, 5),
      "z",
    )?.toArray()).toEqual([1, 2, 5]);
  });

  it("commits only a previewed pointerup and rolls pointer cancellation back to its start", () => {
    const snapshot = {
      bone: "leftHand" as const,
      startWorld: [1, 2, 3] as const,
      latestWorld: [4, 5, 6] as const,
      didPreview: true,
    };

    expect(resolveStudioVrmJointDragOutcome(snapshot, false)).toEqual({
      kind: "commit",
      bone: "leftHand",
      worldPosition: [4, 5, 6],
    });
    expect(resolveStudioVrmJointDragOutcome(snapshot, true)).toEqual({
      kind: "rollback",
      bone: "leftHand",
      worldPosition: [1, 2, 3],
    });
    expect(resolveStudioVrmJointDragOutcome({ ...snapshot, didPreview: false }, false)).toEqual({
      kind: "selection-only",
      bone: "leftHand",
    });
  });
});

describe("StudioVrmJointHandles interaction boundary", () => {
  it("renders only available bones as keyboard-accessible fixed-size controls", () => {
    const vrm = makeVrm({
      hips: new THREE.Object3D(),
      leftHand: new THREE.Object3D(),
    });

    render(<StudioVrmJointHandles vrm={vrm} selectedBone="leftHand" screenSize={24} />);

    const hips = screen.getByRole("button", { name: "골반 관절 선택" });
    const leftHand = screen.getByRole("button", { name: "왼손 관절 IK 목표 이동" });
    expect(hips.getAttribute("aria-pressed")).toBe("false");
    expect(leftHand.getAttribute("aria-pressed")).toBe("true");
    expect(leftHand.getAttribute("aria-keyshortcuts")).toContain("ArrowLeft");
    expect(leftHand.style.width).toBe("44px");
    expect(
      (leftHand.querySelector('[data-handle-visual="target"]') as HTMLElement).style.width,
    ).toBe("24px");
    expect(screen.queryByRole("button", { name: "오른손 관절 IK 목표 이동" })).toBeNull();
  });

  it("renders an accessible 44px pole handle for each supplied active constraint", () => {
    const vrm = makeVrm({ leftHand: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        selectedBone="leftHand"
        selectedPole="leftHand"
        poleSceneTargets={{ leftHand: [0.4, 1.2, 0.3] }}
      />,
    );

    const target = screen.getByRole("button", { name: "왼손 관절 IK 목표 이동" });
    const pole = screen.getByRole("button", { name: "왼손 IK 폴 방향 이동" });
    expect(target.getAttribute("aria-pressed")).toBe("false");
    expect(pole.getAttribute("aria-pressed")).toBe("true");
    expect(pole.getAttribute("data-ik-control")).toBe("pole");
    expect(pole.style.width).toBe("44px");
    expect(pole.style.height).toBe("44px");
  });

  it("stops pointer bubbling, locks orbit interaction, and does not commit a selection-only press", () => {
    const onParentPointerDown = vi.fn();
    const onSelectBone = vi.fn();
    const onInteractionActiveChange = vi.fn();
    const onEffectorCommit = vi.fn();
    const vrm = makeVrm({ leftHand: new THREE.Object3D() });
    render(
      <div onPointerDown={onParentPointerDown}>
        <StudioVrmJointHandles
          vrm={vrm}
          onSelectBone={onSelectBone}
          onInteractionActiveChange={onInteractionActiveChange}
          onEffectorCommit={onEffectorCommit}
        />
      </div>
    );
    const handle = screen.getByRole("button", { name: "왼손 관절 IK 목표 이동" });

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });

    expect(onParentPointerDown).not.toHaveBeenCalled();
    expect(onSelectBone).toHaveBeenCalledOnce();
    expect(onSelectBone).toHaveBeenCalledWith("leftHand");
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
    expect(onEffectorCommit).not.toHaveBeenCalled();
  });

  it("coalesces pointer moves and synchronously flushes the latest target before pointerup commit", () => {
    const onEffectorPreview = vi.fn();
    const onEffectorCommit = vi.fn();
    const vrm = makeVrm({ leftHand: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        onEffectorPreview={onEffectorPreview}
        onEffectorCommit={onEffectorCommit}
      />
    );
    const handle = screen.getByRole("button", { name: "왼손 관절 IK 목표 이동" });

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 160, clientY: 140 });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(onEffectorPreview).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 7, button: 0, clientX: 160, clientY: 140 });

    const expected = projectStudioVrmJointPointerToPlane(
      160,
      140,
      { left: 0, top: 0, width: 400, height: 400 },
      (fiberMock.state as { camera: THREE.Camera }).camera,
      new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
    )!;
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(animationFrameMock.callbacks).toHaveLength(0);
    expect(onEffectorPreview).toHaveBeenCalledOnce();
    expect(onEffectorCommit).toHaveBeenCalledOnce();
    expect(onEffectorPreview.mock.calls[0]).toEqual(onEffectorCommit.mock.calls[0]);
    expect(onEffectorCommit.mock.calls[0]?.[0]).toBe("leftHand");
    expect(onEffectorCommit.mock.calls[0]?.[1][0]).toBeCloseTo(expected.x);
    expect(onEffectorCommit.mock.calls[0]?.[1][1]).toBeCloseTo(expected.y);
    expect(onEffectorCommit.mock.calls[0]?.[1][2]).toBeCloseTo(expected.z);
  });

  it("commits exactly once from a matching window pointerup when pointer capture throws", () => {
    const onEffectorPreview = vi.fn();
    const onEffectorCommit = vi.fn();
    const onEffectorRollback = vi.fn();
    const onInteractionActiveChange = vi.fn();
    const vrm = makeVrm({ leftHand: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        onEffectorPreview={onEffectorPreview}
        onEffectorCommit={onEffectorCommit}
        onEffectorRollback={onEffectorRollback}
        onInteractionActiveChange={onInteractionActiveChange}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "왼손 관절 IK 목표 이동",
    }) as HTMLButtonElement;
    const pointerCapture = rejectPointerCapture(handle);
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    fireEvent.pointerDown(handle, {
      pointerId: 21,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 21,
      clientX: 150,
      clientY: 130,
    });
    fireEvent.pointerUp(window, { pointerId: 99 });

    expect(pointerCapture.setPointerCapture).toHaveBeenCalledWith(21);
    expect(onEffectorCommit).not.toHaveBeenCalled();
    expect(onInteractionActiveChange.mock.calls).toEqual([[true]]);

    fireEvent.pointerUp(window, { pointerId: 21 });

    expect(onEffectorPreview).toHaveBeenCalledOnce();
    expect(onEffectorCommit).toHaveBeenCalledOnce();
    expect(onEffectorRollback).not.toHaveBeenCalled();
    expect(onEffectorPreview.mock.calls[0]).toEqual(onEffectorCommit.mock.calls[0]);
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
    expect(pointerCapture.releasePointerCapture).not.toHaveBeenCalled();
    for (const eventName of ["pointerup", "pointercancel", "blur"]) {
      expect(addEventListener).toHaveBeenCalledWith(eventName, expect.any(Function));
      expect(removeEventListener).toHaveBeenCalledWith(eventName, expect.any(Function));
    }

    // A late local release and every removed window fallback must be harmless.
    fireEvent.pointerUp(handle, { pointerId: 21, button: 0 });
    fireEvent.pointerCancel(window, { pointerId: 21 });
    fireEvent(window, new Event("blur"));
    expect(onEffectorPreview).toHaveBeenCalledOnce();
    expect(onEffectorCommit).toHaveBeenCalledOnce();
    expect(onEffectorRollback).not.toHaveBeenCalled();
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("rolls back exactly once from a matching window pointercancel", () => {
    const onEffectorPreview = vi.fn();
    const onEffectorCommit = vi.fn();
    const onEffectorRollback = vi.fn();
    const onInteractionActiveChange = vi.fn();
    const hand = new THREE.Object3D();
    hand.position.set(0.25, 1.1, -0.2);
    render(
      <StudioVrmJointHandles
        vrm={makeVrm({ rightHand: hand })}
        onEffectorPreview={onEffectorPreview}
        onEffectorCommit={onEffectorCommit}
        onEffectorRollback={onEffectorRollback}
        onInteractionActiveChange={onInteractionActiveChange}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "오른손 관절 IK 목표 이동",
    }) as HTMLButtonElement;
    rejectPointerCapture(handle);

    fireEvent.pointerDown(handle, {
      pointerId: 22,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 22,
      clientX: 145,
      clientY: 135,
    });
    fireEvent.pointerCancel(window, { pointerId: 22 });

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(animationFrameMock.callbacks).toHaveLength(0);
    expect(onEffectorPreview).not.toHaveBeenCalled();
    expect(onEffectorCommit).not.toHaveBeenCalled();
    expect(onEffectorRollback).toHaveBeenCalledOnce();
    expect(onEffectorRollback).toHaveBeenCalledWith("rightHand", [0.25, 1.1, -0.2]);
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);

    fireEvent.pointerUp(window, { pointerId: 22 });
    fireEvent.pointerCancel(handle, { pointerId: 22 });
    expect(onEffectorCommit).not.toHaveBeenCalled();
    expect(onEffectorRollback).toHaveBeenCalledOnce();
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("rolls a pole back exactly once when the window blurs", () => {
    const onPolePreview = vi.fn();
    const onPoleCommit = vi.fn();
    const onPoleRollback = vi.fn();
    const onInteractionActiveChange = vi.fn();
    const vrm = makeVrm({ leftFoot: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        poleSceneTargets={{ leftFoot: [0.2, 0.6, 0.4] }}
        onPolePreview={onPolePreview}
        onPoleCommit={onPoleCommit}
        onPoleRollback={onPoleRollback}
        onInteractionActiveChange={onInteractionActiveChange}
      />,
    );
    const pole = screen.getByRole("button", {
      name: "왼발 IK 폴 방향 이동",
    }) as HTMLButtonElement;
    rejectPointerCapture(pole);

    fireEvent.pointerDown(pole, {
      pointerId: 23,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(pole, {
      pointerId: 23,
      clientX: 145,
      clientY: 130,
    });
    fireEvent(window, new Event("blur"));

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(animationFrameMock.callbacks).toHaveLength(0);
    expect(onPolePreview).not.toHaveBeenCalled();
    expect(onPoleCommit).not.toHaveBeenCalled();
    expect(onPoleRollback).toHaveBeenCalledOnce();
    expect(onPoleRollback).toHaveBeenCalledWith("leftFoot", [0.2, 0.6, 0.4]);
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);

    fireEvent.pointerUp(window, { pointerId: 23 });
    fireEvent.pointerCancel(pole, { pointerId: 23 });
    fireEvent(window, new Event("blur"));
    expect(onPoleCommit).not.toHaveBeenCalled();
    expect(onPoleRollback).toHaveBeenCalledOnce();
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("cancels a queued preview when the handle session is remounted", () => {
    const onEffectorPreview = vi.fn();
    const onEffectorRollback = vi.fn();
    const vrm = makeVrm({ rightHand: new THREE.Object3D() });
    const view = render(
      <StudioVrmJointHandles
        key="session-1"
        vrm={vrm}
        onEffectorPreview={onEffectorPreview}
        onEffectorRollback={onEffectorRollback}
      />
    );
    const handle = screen.getByRole("button", { name: "오른손 관절 IK 목표 이동" });
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 80, clientY: 90 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 130, clientY: 120 });

    expect(animationFrameMock.callbacks).toHaveLength(1);
    view.rerender(
      <StudioVrmJointHandles
        key="session-2"
        vrm={vrm}
        onEffectorPreview={onEffectorPreview}
        onEffectorRollback={onEffectorRollback}
      />
    );

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(animationFrameMock.callbacks).toHaveLength(0);
    expect(onEffectorPreview).not.toHaveBeenCalled();
    expect(onEffectorRollback).toHaveBeenCalledOnce();
  });

  it("rolls an active effector interaction back when its handle unmounts", () => {
    const onEffectorRollback = vi.fn();
    const onInteractionActiveChange = vi.fn();
    const hand = new THREE.Object3D();
    hand.position.set(0.25, 1.1, -0.2);
    const view = render(
      <StudioVrmJointHandles
        vrm={makeVrm({ rightHand: hand })}
        onEffectorRollback={onEffectorRollback}
        onInteractionActiveChange={onInteractionActiveChange}
      />
    );
    const handle = screen.getByRole("button", { name: "오른손 관절 IK 목표 이동" });
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 80, clientY: 90 });
    view.unmount();

    expect(onEffectorRollback).toHaveBeenCalledOnce();
    expect(onEffectorRollback).toHaveBeenCalledWith("rightHand", [0.25, 1.1, -0.2]);
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
    for (const eventName of ["pointerup", "pointercancel", "blur"]) {
      expect(removeEventListener).toHaveBeenCalledWith(eventName, expect.any(Function));
    }
    fireEvent.pointerUp(window, { pointerId: 3 });
    fireEvent(window, new Event("blur"));
    expect(onEffectorRollback).toHaveBeenCalledOnce();
    expect(onInteractionActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it("previews and commits a pole drag through the shared pointer transaction", () => {
    const onPolePreview = vi.fn();
    const onPoleCommit = vi.fn();
    const onPoleRollback = vi.fn();
    const vrm = makeVrm({ leftFoot: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        poleSceneTargets={{ leftFoot: [0.2, 0.6, 0.4] }}
        onPolePreview={onPolePreview}
        onPoleCommit={onPoleCommit}
        onPoleRollback={onPoleRollback}
      />,
    );
    const pole = screen.getByRole("button", { name: "왼발 IK 폴 방향 이동" });

    fireEvent.pointerDown(pole, { pointerId: 12, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(pole, { pointerId: 12, clientX: 145, clientY: 120 });
    fireEvent.pointerUp(pole, { pointerId: 12, button: 0, clientX: 145, clientY: 120 });

    expect(onPolePreview).toHaveBeenCalledOnce();
    expect(onPoleCommit).toHaveBeenCalledOnce();
    expect(onPolePreview.mock.calls[0]).toEqual(onPoleCommit.mock.calls[0]);
    expect(onPoleCommit.mock.calls[0]?.[0]).toBe("leftFoot");
    expect(onPoleRollback).not.toHaveBeenCalled();
  });

  it("restores the pole baseline when pointer cancellation interrupts a drag", () => {
    const onPoleCommit = vi.fn();
    const onPoleRollback = vi.fn();
    const vrm = makeVrm({ rightFoot: new THREE.Object3D() });
    render(
      <StudioVrmJointHandles
        vrm={vrm}
        poleSceneTargets={{ rightFoot: [-0.2, 0.6, 0.4] }}
        onPoleCommit={onPoleCommit}
        onPoleRollback={onPoleRollback}
      />,
    );
    const pole = screen.getByRole("button", { name: "오른발 IK 폴 방향 이동" });

    fireEvent.pointerDown(pole, { pointerId: 13, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(pole, { pointerId: 13, clientX: 140, clientY: 130 });
    fireEvent.pointerCancel(pole, { pointerId: 13, clientX: 140, clientY: 130 });

    expect(onPoleCommit).not.toHaveBeenCalled();
    expect(onPoleRollback).toHaveBeenCalledOnce();
    expect(onPoleRollback).toHaveBeenCalledWith("rightFoot", [-0.2, 0.6, 0.4]);
  });
});
