// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type StudioFloatingSurfaceLayout,
} from "./studio-floating-surface";
import { resetStudioFloatingSurfaceStackForTest } from "./studio-floating-surface-stack";
import { StudioFloatingSurface } from "./StudioFloatingSurface";

class StudioFloatingSurfaceTestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}

Object.defineProperty(globalThis, "PointerEvent", {
  configurable: true,
  value: StudioFloatingSurfaceTestPointerEvent,
});

const DEFAULT_LAYOUT: StudioFloatingSurfaceLayout = Object.freeze({
  version: 2,
  xRatio: 1,
  yRatio: 0,
  width: 300,
  height: 400,
  dock: "free",
  positionLocked: false,
  sizeLocked: false,
});

function Harness({
  onLayoutChange = () => undefined,
  onClose = () => undefined,
  surfaceId = "test-surface",
  label = "테스트 팔레트",
}: {
  onLayoutChange?: (layout: StudioFloatingSurfaceLayout) => void;
  onClose?: () => void;
  surfaceId?: string;
  label?: string;
}) {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  return (
    <StudioFloatingSurface
      surfaceId={surfaceId}
      label={label}
      layout={layout}
      defaultLayout={DEFAULT_LAYOUT}
      minWidth={240}
      minHeight={200}
      maxWidth={600}
      maxHeight={700}
      insetTop={60}
      insetRight={10}
      insetBottom={10}
      insetLeft={10}
      onLayoutChange={(next) => {
        setLayout(next);
        onLayoutChange(next);
      }}
      onClose={onClose}
    >
      <button type="button">내용 버튼</button>
    </StudioFloatingSurface>
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, "innerWidth", {
    configurable: true,
    value: 1_000,
  });
  Object.defineProperty(globalThis, "innerHeight", {
    configurable: true,
    value: 800,
  });
});

afterEach(() => {
  cleanup();
  resetStudioFloatingSurfaceStackForTest();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// `PointerEventInit.isPrimary` defaults to **false** (UI Events spec), so a synthetic pointerdown
// looks like a secondary pointer of a multi-touch gesture unless the test says otherwise. A real
// mouse press always reports `isPrimary: true`, and StudioFloatingSurface.beginPointerSession
// rightly refuses non-primary pointers — so omitting the flag here silently started no drag session
// at all and every assertion below read the untouched layout.

describe("StudioFloatingSurface", () => {
  it("renders viewport-safe desktop window chrome", () => {
    render(<Harness />);
    const surface = screen.getByRole("dialog", { name: "테스트 팔레트" });

    expect(surface.style.left).toBe("690px");
    expect(surface.style.top).toBe("60px");
    expect(surface.style.width).toBe("300px");
    expect(surface.style.height).toBe("400px");
    expect(surface.dataset.dock).toBe("free");
    expect(screen.getByRole("button", { name: "테스트 팔레트 이동" }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "테스트 팔레트 크기 조절" }))
      .toBeTruthy();
    expect(screen.getByRole("button", { name: "테스트 팔레트 왼쪽 크기 조절" }))
      .toBeTruthy();
  });

  it("uses an 8px activation threshold and commits a snapped pointer move once", () => {
    const onLayoutChange = vi.fn();
    render(<Harness onLayoutChange={onLayoutChange} />);
    const handle = screen.getByRole("button", { name: "테스트 팔레트 이동" });

    fireEvent.pointerDown(handle, {
      pointerId: 11,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 800,
      clientY: 80,
    });
    fireEvent.pointerMove(window, {
      pointerId: 11,
      pointerType: "mouse",
      buttons: 1,
      clientX: 795,
      clientY: 83,
    });
    fireEvent.pointerUp(window, {
      pointerId: 11,
      pointerType: "mouse",
      button: 0,
      clientX: 795,
      clientY: 83,
    });
    expect(onLayoutChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, {
      pointerId: 12,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 800,
      clientY: 80,
    });
    fireEvent.pointerMove(window, {
      pointerId: 12,
      pointerType: "mouse",
      buttons: 1,
      clientX: 760,
      clientY: 110,
    });
    fireEvent.pointerUp(window, {
      pointerId: 12,
      pointerType: "mouse",
      button: 0,
      clientX: 760,
      clientY: 110,
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange.mock.calls[0]?.[0]).toMatchObject({
      version: 2,
      width: 300,
      height: 400,
      dock: "free",
    });
    expect(onLayoutChange.mock.calls[0]?.[0].xRatio).toBeLessThan(1);
    expect(onLayoutChange.mock.calls[0]?.[0].yRatio).toBeGreaterThan(0);
  });

  it("cancels an active move with Escape and restores body interaction state", () => {
    const onLayoutChange = vi.fn();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    render(<Harness onLayoutChange={onLayoutChange} />);
    const handle = screen.getByRole("button", { name: "테스트 팔레트 이동" });

    fireEvent.pointerDown(handle, {
      pointerId: 21,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 800,
      clientY: 80,
    });
    fireEvent.pointerMove(window, {
      pointerId: 21,
      pointerType: "mouse",
      buttons: 1,
      clientX: 760,
      clientY: 110,
    });
    expect(document.body.style.cursor).toBe("grabbing");
    expect(document.body.style.userSelect).toBe("none");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    expect(screen.getByRole("dialog", { name: "테스트 팔레트" }).style.transform)
      .toBe("translate3d(0, 0, 0)");
  });

  it("resizes with pointer input and supports keyboard movement/reset", () => {
    const onLayoutChange = vi.fn();
    render(<Harness onLayoutChange={onLayoutChange} />);
    const resize = screen.getByRole("button", {
      name: "테스트 팔레트 크기 조절",
    });

    fireEvent.pointerDown(resize, {
      pointerId: 31,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 990,
      clientY: 460,
    });
    fireEvent.pointerMove(window, {
      pointerId: 31,
      pointerType: "mouse",
      buttons: 1,
      clientX: 950,
      clientY: 500,
    });
    fireEvent.pointerUp(window, {
      pointerId: 31,
      pointerType: "mouse",
      button: 0,
      clientX: 950,
      clientY: 500,
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange.mock.calls[0]?.[0]).toMatchObject({
      width: 260,
      height: 440,
    });

    const move = screen.getByRole("button", { name: "테스트 팔레트 이동" });
    fireEvent.keyDown(move, { key: "ArrowLeft", altKey: true });
    expect(onLayoutChange).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(move, { key: "Home", altKey: true });
    expect(onLayoutChange).toHaveBeenCalledTimes(3);
    expect(onLayoutChange.mock.calls.at(-1)?.[0]).toEqual(DEFAULT_LAYOUT);
  });

  it("expands a right-docked surface from its left edge", () => {
    const onLayoutChange = vi.fn();
    render(<Harness onLayoutChange={onLayoutChange} />);
    fireEvent.click(screen.getByRole("button", {
      name: "테스트 팔레트 창 배치 메뉴",
    }));
    fireEvent.click(screen.getByRole("menuitemradio", {
      name: "오른쪽 가장자리에 도킹",
    }));

    const west = screen.getByRole("button", {
      name: "테스트 팔레트 왼쪽 크기 조절",
    });
    fireEvent.pointerDown(west, {
      pointerId: 41,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 690,
      clientY: 260,
    });
    fireEvent.pointerMove(window, {
      pointerId: 41,
      pointerType: "mouse",
      buttons: 1,
      clientX: 650,
      clientY: 260,
    });
    fireEvent.pointerUp(window, {
      pointerId: 41,
      pointerType: "mouse",
      button: 0,
      clientX: 650,
      clientY: 260,
    });

    expect(onLayoutChange.mock.calls.at(-1)?.[0]).toMatchObject({
      dock: "right",
      width: 340,
    });
    expect(screen.getByRole("dialog", { name: "테스트 팔레트" }).style.left)
      .toBe("650px");
  });

  it("persists dock and lock controls through the window layout menu", () => {
    const onLayoutChange = vi.fn();
    render(<Harness onLayoutChange={onLayoutChange} />);
    const surface = screen.getByRole("dialog", { name: "테스트 팔레트" });
    const menuButton = screen.getByRole("button", {
      name: "테스트 팔레트 창 배치 메뉴",
    });

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("menuitemradio", {
      name: "왼쪽 가장자리에 도킹",
    }));
    expect(surface.dataset.dock).toBe("left");

    fireEvent.click(menuButton);
    const menu = screen.getByRole("menu", { name: "테스트 팔레트 창 배치" });
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", {
      name: /위치 잠금/,
    }));
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", {
      name: /크기 잠금/,
    }));

    expect(surface.dataset.positionLocked).toBe("true");
    expect(surface.dataset.sizeLocked).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", {
      name: "테스트 팔레트 이동",
    }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", {
      name: "테스트 팔레트 크기 조절",
    }).disabled).toBe(true);
    expect(onLayoutChange.mock.calls.at(-1)?.[0]).toMatchObject({
      dock: "left",
      positionLocked: true,
      sizeLocked: true,
    });
  });

  it("brings the most recently interacted window above its peers below modal z-index", () => {
    render(
      <>
        <Harness surfaceId="surface-a" label="팔레트 A" />
        <Harness surfaceId="surface-b" label="팔레트 B" />
      </>,
    );
    const first = screen.getByRole("dialog", { name: "팔레트 A" });
    const second = screen.getByRole("dialog", { name: "팔레트 B" });
    expect(Number(second.style.zIndex)).toBeGreaterThan(Number(first.style.zIndex));

    fireEvent.pointerDown(first);
    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex));
    expect(Number(first.style.zIndex)).toBeLessThan(80);
  });

  it("exposes explicit reset and close actions", () => {
    const onLayoutChange = vi.fn();
    const onClose = vi.fn();
    render(<Harness onLayoutChange={onLayoutChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", {
      name: "테스트 팔레트 창 배치 메뉴",
    }));
    fireEvent.click(screen.getByRole("menuitem", {
      name: "위치·크기·잠금 초기화",
    }));
    expect(onLayoutChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "테스트 팔레트 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
