// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioMobileHistoryTouchGestures } from "./studio-mobile-history-touch-gesture-host";

import type { StudioAppSettings } from "./studio-app-settings";
import type { StudioMobileHistoryGestureActions } from "./studio-mobile-history-touch-gesture-host";
import type { RefObject } from "react";

// 실제 HUD 판정은 페이지 셸 런타임이 DOM 조상 사슬을 훑는다. 여기서 관심 있는 계약은 "HUD 를
// 누른 터치는 후보가 되지 않는다" 뿐이라 data-hud 한 칸으로 대신한다.
vi.mock("./studio-page-shell-runtime", () => ({
  isStudioViewToolsHudEventTarget: (target: unknown) =>
    target instanceof HTMLElement && target.dataset.hud === "true",
}));

type TouchPoint = { identifier: number; clientX: number; clientY: number };

function settings(
  twoFinger: "pan-zoom" | "undo-redo",
  threeFinger: "undo" | "toggle-ui" | "none",
): StudioAppSettings {
  return { touch: { twoFinger, threeFinger } } as unknown as StudioAppSettings;
}

/**
 * 훅은 event.touches / event.target / preventDefault 만 읽는다. jsdom 은 TouchEvent 생성자를
 * 신뢰할 수 없게 구현하므로 평범한 Event 에 touches 를 얹어 보낸다.
 */
function fire(node: HTMLElement, type: string, points: TouchPoint[], from: HTMLElement = node) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: points });
  from.dispatchEvent(event);
  return event;
}

const TWO: TouchPoint[] = [
  { identifier: 1, clientX: 100, clientY: 100 },
  { identifier: 2, clientX: 160, clientY: 100 },
];
const THREE: TouchPoint[] = [...TWO, { identifier: 3, clientX: 220, clientY: 100 }];

function mount(options?: {
  appSettings?: StudioAppSettings;
  isMobile?: boolean;
  owned?: boolean;
}) {
  const node = document.createElement("div");
  document.body.append(node);
  const actions: StudioMobileHistoryGestureActions = { undo: vi.fn(), toggleUi: vi.fn() };
  const vibrate = vi.fn();
  Object.defineProperty(globalThis.navigator, "vibrate", { value: vibrate, configurable: true });
  // 훅이 두 번(터치 시작·종료) 읽는 시계를 직접 쥐고 탭과 롱프레스를 갈라 놓는다.
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const view = renderHook(() =>
    useStudioMobileHistoryTouchGestures({
      surfaceRef: { current: node } as RefObject<HTMLDivElement | null>,
      isMobile: options?.isMobile ?? true,
      canvasPointerGestureIsOwned: () => options?.owned ?? false,
      appSettingsRef: {
        current: options?.appSettings ?? settings("undo-redo", "toggle-ui"),
      } as RefObject<StudioAppSettings>,
      gestureRef: { current: actions } as RefObject<StudioMobileHistoryGestureActions>,
    }),
  );
  return { node, actions, vibrate, view, advance: (ms: number) => { now += ms; } };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("useStudioMobileHistoryTouchGestures", () => {
  it("runs undo on a settled two-finger tap and buzzes once", () => {
    const { node, actions, vibrate, advance } = mount();
    fire(node, "touchstart", TWO);
    advance(120);
    const end = fire(node, "touchend", []);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect(actions.toggleUi).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(8);
    // 탭으로 인정된 순간에만 브라우저 기본 동작을 막는다.
    expect(end.defaultPrevented).toBe(true);
  });

  it("routes the three-finger tap by preference, and does nothing when it is off", () => {
    const toggle = mount();
    fire(toggle.node, "touchstart", THREE);
    toggle.advance(50);
    fire(toggle.node, "touchend", []);
    expect(toggle.actions.toggleUi).toHaveBeenCalledTimes(1);
    expect(toggle.actions.undo).not.toHaveBeenCalled();
    cleanup();

    const undo = mount({ appSettings: settings("undo-redo", "undo") });
    fire(undo.node, "touchstart", THREE);
    undo.advance(50);
    fire(undo.node, "touchend", []);
    expect(undo.actions.undo).toHaveBeenCalledTimes(1);
    cleanup();

    const off = mount({ appSettings: settings("pan-zoom", "none") });
    fire(off.node, "touchstart", THREE);
    off.advance(50);
    const end = fire(off.node, "touchend", []);
    expect(off.actions.undo).not.toHaveBeenCalled();
    expect(off.actions.toggleUi).not.toHaveBeenCalled();
    // 제스처로 인정하지 않았으면 기본 동작도 그대로 둬야 스크롤이 살아 있다.
    expect(end.defaultPrevented).toBe(false);
  });

  it("rejects a drag past the 12px slop and a hold past 320ms", () => {
    const dragged = mount();
    fire(dragged.node, "touchstart", TWO);
    fire(dragged.node, "touchmove", [
      { identifier: 1, clientX: 100, clientY: 113 },
      { identifier: 2, clientX: 160, clientY: 100 },
    ]);
    dragged.advance(60);
    fire(dragged.node, "touchend", []);
    expect(dragged.actions.undo).not.toHaveBeenCalled();
    cleanup();

    const held = mount();
    fire(held.node, "touchstart", TWO);
    held.advance(321);
    fire(held.node, "touchend", []);
    expect(held.actions.undo).not.toHaveBeenCalled();
  });

  it("stands down for an owned canvas gesture, a HUD target, and a lifted finger", () => {
    const owned = mount({ owned: true });
    fire(owned.node, "touchstart", TWO);
    owned.advance(50);
    fire(owned.node, "touchend", []);
    expect(owned.actions.undo).not.toHaveBeenCalled();
    cleanup();

    const hud = mount();
    const button = document.createElement("button");
    button.dataset.hud = "true";
    hud.node.append(button);
    fire(hud.node, "touchstart", TWO, button);
    hud.advance(50);
    fire(hud.node, "touchend", []);
    expect(hud.actions.undo).not.toHaveBeenCalled();
    cleanup();

    // 세 손가락 중 하나만 떼면 아직 제스처가 끝난 게 아니다.
    const partial = mount();
    fire(partial.node, "touchstart", THREE);
    partial.advance(50);
    fire(partial.node, "touchend", [TWO[0]!, TWO[1]!]);
    expect(partial.actions.toggleUi).not.toHaveBeenCalled();
  });

  it("attaches nothing on desktop and detaches on unmount", () => {
    const desktop = mount({ isMobile: false });
    fire(desktop.node, "touchstart", TWO);
    desktop.advance(50);
    fire(desktop.node, "touchend", []);
    expect(desktop.actions.undo).not.toHaveBeenCalled();
    cleanup();

    const mobile = mount();
    mobile.view.unmount();
    fire(mobile.node, "touchstart", TWO);
    mobile.advance(50);
    fire(mobile.node, "touchend", []);
    expect(mobile.actions.undo).not.toHaveBeenCalled();
  });
});
