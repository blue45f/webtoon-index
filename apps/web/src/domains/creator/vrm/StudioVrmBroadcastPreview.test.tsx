// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStudioVrmBroadcastPreviewPlan } from "./studio-vrm-broadcast-preview";
import {
  StudioVrmBroadcastPreviewBridge,
  StudioVrmBroadcastPreviewOverlay,
  StudioVrmBroadcastPreviewPanel,
} from "./StudioVrmBroadcastPreview";

import type { RefObject } from "react";

const mockedThreeState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: unknown) => unknown) => selector(mockedThreeState.current),
}));

afterEach(cleanup);

describe("StudioVrmBroadcastPreviewPanel", () => {
  it("offers only the fixed background choices and starts from a native button", () => {
    const onBackgroundChange = vi.fn();
    const onStart = vi.fn();
    render(
      <StudioVrmBroadcastPreviewPanel
        backgroundId="green"
        onBackgroundChange={onBackgroundChange}
        onStart={onStart}
      />,
    );

    expect(screen.getByRole("button", { name: "크로마 그린" }).getAttribute("aria-pressed"))
      .toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "크로마 블루" }));
    expect(onBackgroundChange).toHaveBeenCalledWith("blue");

    const start = screen.getByRole("button", { name: "방송 화면 열기" });
    start.focus();
    expect(document.activeElement).toBe(start);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.getByText(/녹화·송출 연결은 만들지 않/u)).toBeTruthy();
    expect(screen.getByText(/프로젝트·OPFS·Undo 기록에 저장하지 않/u)).toBeTruthy();
  });

  it("locks every choice and start while a parent transaction owns the scene", () => {
    const reason = "캡처·공유 처리가 끝난 뒤 방송 화면을 열 수 있습니다.";
    render(
      <StudioVrmBroadcastPreviewPanel
        backgroundId="black"
        disabledReason={reason}
        onBackgroundChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button").every((button) => (
      (button as HTMLButtonElement).disabled
    ))).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(reason);
  });

  it("announces renderer failures assertively", () => {
    render(
      <StudioVrmBroadcastPreviewPanel
        backgroundId="green"
        error="기존 3D 배경을 복원하지 못했습니다."
        onBackgroundChange={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("복원하지 못했습니다");
  });
});

describe("StudioVrmBroadcastPreviewOverlay", () => {
  it("keeps a focusable explicit exit while stating the external-tool boundary", () => {
    const plan = createStudioVrmBroadcastPreviewPlan({ backgroundId: "blue" });
    if (!plan.ok) throw new Error(plan.reason);
    const onExit = vi.fn();
    const exitButtonRef = { current: null } as RefObject<HTMLButtonElement | null>;
    render(
      <StudioVrmBroadcastPreviewOverlay
        receipt={plan.receipt}
        exitButtonRef={exitButtonRef}
        onExit={onExit}
      />,
    );

    const exit = screen.getByRole("button", { name: "방송 미리보기 종료" });
    expect(exitButtonRef.current).toBe(exit);
    expect(exit.getAttribute("aria-keyshortcuts")).toBe("Escape");
    exit.focus();
    expect(document.activeElement).toBe(exit);
    fireEvent.click(exit);
    expect(onExit).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("외부 도구에서 제어");
  });
});

describe("StudioVrmBroadcastPreviewBridge", () => {
  it("acquires and releases the existing renderer lease synchronously at layout boundaries", () => {
    let clearColor = new THREE.Color("#123456");
    let clearAlpha = 0.35;
    const renderer = {
      getClearAlpha: () => clearAlpha,
      getClearColor: (target: THREE.Color) => target.copy(clearColor),
      setClearColor: (next: THREE.ColorRepresentation, nextAlpha = 1) => {
        clearColor = new THREE.Color(next);
        clearAlpha = nextAlpha;
      },
    };
    const scene = new THREE.Scene();
    const previousBackground = new THREE.Color("#6a5139");
    scene.background = previousBackground;
    const environment = new THREE.Group();
    const ground = new THREE.Mesh();
    environment.visible = true;
    ground.visible = false;
    const invalidate = vi.fn();
    mockedThreeState.current = { gl: renderer, scene, invalidate };
    const plan = createStudioVrmBroadcastPreviewPlan({ backgroundId: "green" });
    if (!plan.ok) throw new Error(plan.reason);

    const view = render(
      <StudioVrmBroadcastPreviewBridge
        receipt={plan.receipt}
        environmentRef={{ current: environment }}
        groundRef={{ current: ground }}
        onError={vi.fn()}
      />,
    );

    // Testing Library returns only after layout effects: no passive-effect tick is required.
    expect(`#${clearColor.getHexString()}`).toBe("#00b140");
    expect(clearAlpha).toBe(1);
    expect(scene.background).toBeNull();
    expect(environment.visible).toBe(false);
    expect(ground.visible).toBe(false);

    view.unmount();
    expect(`#${clearColor.getHexString()}`).toBe("#123456");
    expect(clearAlpha).toBe(0.35);
    expect(scene.background).toBe(previousBackground);
    expect(environment.visible).toBe(true);
    expect(ground.visible).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
