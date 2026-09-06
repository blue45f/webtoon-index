import { describe, expect, it } from "vitest";

import {
  COLOR_WHEEL_CANCEL_RADIUS_PX,
  COLOR_WHEEL_INNER_DEADZONE_PX,
  COLOR_WHEEL_MAX_SLICES,
  COLOR_WHEEL_MOVE_CANCEL_PX,
  COLOR_WHEEL_SWATCH_RADIUS_PX,
  clampWheelCenter,
  colorWheelSliceAngle,
  colorWheelSliceOffset,
  hitTestColorWheel,
  isKeyboardActivatedClick,
  selectWheelColors,
  shouldCancelLongPress,
} from "./studio-color-wheel";

describe("selectWheelColors", () => {
  it("truncates to max (default 8) and preserves order", () => {
    const colors = Array.from({ length: 12 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
    const picked = selectWheelColors(colors);
    expect(picked).toHaveLength(COLOR_WHEEL_MAX_SLICES);
    expect(picked).toEqual(colors.slice(0, 8));
  });

  it("passes through short lists unchanged (no padding)", () => {
    const colors = ["#111111", "#222222"];
    expect(selectWheelColors(colors)).toEqual(colors);
  });

  it("does not mutate the input array", () => {
    const colors = ["#111111", "#222222", "#333333"];
    const copy = [...colors];
    selectWheelColors(colors, 1);
    expect(colors).toEqual(copy);
  });

  it("handles a custom max and non-finite/negative max safely", () => {
    const colors = ["#111111", "#222222", "#333333"];
    expect(selectWheelColors(colors, 2)).toEqual(["#111111", "#222222"]);
    expect(selectWheelColors(colors, -5)).toEqual([]);
    expect(selectWheelColors(colors, Number.NaN)).toEqual(colors.slice(0, COLOR_WHEEL_MAX_SLICES));
  });
});

describe("colorWheelSliceAngle", () => {
  it("places index 0 at the top (-PI/2)", () => {
    expect(colorWheelSliceAngle(0, 8)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("spaces slices evenly clockwise", () => {
    const total = 4;
    expect(colorWheelSliceAngle(1, total)).toBeCloseTo(-Math.PI / 2 + Math.PI / 2, 10);
    expect(colorWheelSliceAngle(2, total)).toBeCloseTo(-Math.PI / 2 + Math.PI, 10);
    expect(colorWheelSliceAngle(3, total)).toBeCloseTo(-Math.PI / 2 + (3 * Math.PI) / 2, 10);
  });

  it("falls back to -PI/2 when total <= 0", () => {
    expect(colorWheelSliceAngle(0, 0)).toBe(-Math.PI / 2);
    expect(colorWheelSliceAngle(0, -3)).toBe(-Math.PI / 2);
  });
});

describe("colorWheelSliceOffset", () => {
  it("puts index 0 directly above center (negative y, zero x)", () => {
    const offset = colorWheelSliceOffset(0, 8, 100);
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.y).toBeCloseTo(-100, 9);
  });

  it("uses the default swatch radius when omitted", () => {
    const offset = colorWheelSliceOffset(0, 8);
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(COLOR_WHEEL_SWATCH_RADIUS_PX, 9);
  });

  it("keeps every slice at the same distance from center", () => {
    const total = 6;
    for (let i = 0; i < total; i++) {
      const { x, y } = colorWheelSliceOffset(i, total, 50);
      expect(Math.hypot(x, y)).toBeCloseTo(50, 9);
    }
  });
});

describe("shouldCancelLongPress", () => {
  it("does not cancel for tiny jitter under the threshold", () => {
    expect(shouldCancelLongPress(1, 1, COLOR_WHEEL_MOVE_CANCEL_PX)).toBe(false);
  });

  it("cancels once movement exceeds the threshold", () => {
    expect(shouldCancelLongPress(10, 0, COLOR_WHEEL_MOVE_CANCEL_PX)).toBe(true);
    expect(shouldCancelLongPress(0, 10, COLOR_WHEEL_MOVE_CANCEL_PX)).toBe(true);
  });

  it("uses the exported default threshold when omitted", () => {
    expect(shouldCancelLongPress(0, 0)).toBe(false);
    expect(shouldCancelLongPress(COLOR_WHEEL_MOVE_CANCEL_PX + 1, 0)).toBe(true);
  });
});

describe("hitTestColorWheel", () => {
  it("returns none inside the inner deadzone", () => {
    expect(hitTestColorWheel(0, 0, 8)).toEqual({ kind: "none" });
    expect(hitTestColorWheel(COLOR_WHEEL_INNER_DEADZONE_PX - 1, 0, 8)).toEqual({ kind: "none" });
  });

  it("returns cancel beyond the cancel radius", () => {
    expect(hitTestColorWheel(COLOR_WHEEL_CANCEL_RADIUS_PX + 1, 0, 8)).toEqual({ kind: "cancel" });
  });

  it("returns none when there are zero colors regardless of distance", () => {
    expect(hitTestColorWheel(1000, 1000, 0)).toEqual({ kind: "none" });
  });

  it("round-trips every slice offset back to its own index", () => {
    for (const total of [1, 2, 3, 5, 8]) {
      for (let i = 0; i < total; i++) {
        const { x, y } = colorWheelSliceOffset(i, total, COLOR_WHEEL_SWATCH_RADIUS_PX);
        expect(hitTestColorWheel(x, y, total)).toEqual({ kind: "slice", index: i });
      }
    }
  });

  it("resolves straight-up to slice 0 for an 8-slice wheel", () => {
    expect(hitTestColorWheel(0, -COLOR_WHEEL_SWATCH_RADIUS_PX, 8)).toEqual({ kind: "slice", index: 0 });
  });

  it("resolves straight-down to the opposite slice for an 8-slice wheel", () => {
    expect(hitTestColorWheel(0, COLOR_WHEEL_SWATCH_RADIUS_PX, 8)).toEqual({ kind: "slice", index: 4 });
  });

  it("wraps correctly just past the boundary back to slice 0", () => {
    const total = 8;
    const angle = colorWheelSliceAngle(0, total) - (2 * Math.PI) / total / 2 + 0.001; // 살짝 index0 경계 안쪽(반시계 방향)
    const x = Math.cos(angle) * COLOR_WHEEL_SWATCH_RADIUS_PX;
    const y = Math.sin(angle) * COLOR_WHEEL_SWATCH_RADIUS_PX;
    expect(hitTestColorWheel(x, y, total)).toEqual({ kind: "slice", index: 0 });
  });

  it("respects custom inner/cancel radii", () => {
    expect(hitTestColorWheel(5, 0, 8, 10, 20)).toEqual({ kind: "none" });
    expect(hitTestColorWheel(25, 0, 8, 10, 20)).toEqual({ kind: "cancel" });
    expect(hitTestColorWheel(15, 0, 8, 10, 20)).toEqual({ kind: "slice", index: 2 });
  });
});

describe("isKeyboardActivatedClick", () => {
  // 회귀 테스트 — StudioColorWheelOverlay의 스와치 버튼은 마우스/터치 클릭 시 pointerup이 먼저
  // 부모 오버레이 div로 버블링돼 선택을 확정한다. 버튼의 onClick이 detail을 확인하지 않고 또
  // onSelect/onClose를 부르면 같은 클릭 한 번에 선택이 두 번 일어난다(실제 브라우저 DOM으로
  // 재현: pointerdown+pointerup+click(detail=1) 시퀀스를 버튼에 dispatch하고 부모 div의 버블된
  // pointerup 리스너와 버튼 자신의 click 리스너 호출 수를 셌더니 가드 없이는 2, 이 술어로 가드하면
  // 실제 클릭은 1, btn.click()으로 흉내낸 키보드 활성화(detail=0)도 1로 확인됨).
  it("treats detail 0 (keyboard/programmatic activation) as keyboard-activated", () => {
    expect(isKeyboardActivatedClick(0)).toBe(true);
  });

  it("treats detail >= 1 (real pointer clicks) as not keyboard-activated — already handled via bubbled pointerup", () => {
    expect(isKeyboardActivatedClick(1)).toBe(false);
    expect(isKeyboardActivatedClick(2)).toBe(false);
  });
});

describe("clampWheelCenter", () => {
  it("leaves an already-centered point untouched", () => {
    expect(clampWheelCenter(500, 400, 1000, 800, 100)).toEqual({ x: 500, y: 400 });
  });

  it("pushes points near the edges inward by the margin", () => {
    expect(clampWheelCenter(0, 0, 1000, 800, 100)).toEqual({ x: 100, y: 100 });
    expect(clampWheelCenter(1000, 800, 1000, 800, 100)).toEqual({ x: 900, y: 700 });
  });

  it("falls back to a stable margin-pinned point on tiny viewports (no NaN/inversion)", () => {
    const result = clampWheelCenter(10, 10, 50, 50, 100);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
  });
});
