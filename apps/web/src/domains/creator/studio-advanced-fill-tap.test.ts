import { describe, expect, it } from "vitest";

import {
  beginStudioAdvancedFillTap,
  endStudioAdvancedFillTap,
  moveStudioAdvancedFillTap,
} from "./studio-advanced-fill-tap";

describe("Advanced Fill pointer-up tap recognizer", () => {
  it("executes one primary-button tap only after pointer-up", () => {
    const started = beginStudioAdvancedFillTap(null, {
      pointerId: 1,
      point: { x: 20, y: 30 },
      button: 0,
      isPrimary: true,
    });
    const moved = moveStudioAdvancedFillTap(started, 1, { x: 25, y: 34 });

    expect(endStudioAdvancedFillTap(moved, 1)).toEqual({ gesture: null, execute: true });
  });

  it("cancels a one-finger scroll once movement exceeds the tap threshold", () => {
    const started = beginStudioAdvancedFillTap(null, {
      pointerId: 4,
      point: { x: 100, y: 100 },
      button: 0,
    });
    const moved = moveStudioAdvancedFillTap(started, 4, { x: 100, y: 109 });

    expect(endStudioAdvancedFillTap(moved, 4).execute).toBe(false);
  });

  it("blocks both fingers of a pinch regardless of release order", () => {
    const first = beginStudioAdvancedFillTap(null, {
      pointerId: 7,
      point: { x: 30, y: 40 },
      button: 0,
    });
    const pinch = beginStudioAdvancedFillTap(first, {
      pointerId: 8,
      point: { x: 90, y: 40 },
      button: 0,
      isPrimary: false,
    });
    const secondUp = endStudioAdvancedFillTap(pinch, 8);
    const firstUp = endStudioAdvancedFillTap(secondUp.gesture!, 7);

    expect(secondUp.execute).toBe(false);
    expect(firstUp).toEqual({ gesture: null, execute: false });
  });

  it("rejects secondary mouse buttons and pointer cancellation", () => {
    const secondary = beginStudioAdvancedFillTap(null, {
      pointerId: 2,
      point: { x: 0, y: 0 },
      button: 2,
    });
    const primary = beginStudioAdvancedFillTap(null, {
      pointerId: 3,
      point: { x: 0, y: 0 },
      button: 0,
    });

    expect(endStudioAdvancedFillTap(secondary, 2).execute).toBe(false);
    expect(endStudioAdvancedFillTap(primary, 3, true).execute).toBe(false);
  });
});
