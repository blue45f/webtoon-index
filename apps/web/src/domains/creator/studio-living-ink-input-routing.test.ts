import { describe, expect, it } from "vitest";

import {
  createDefaultLivingInkInputRoutingState,
  livingInkBarrelActive,
  livingInkModeLabel,
  resolveLivingInkPressure,
  resolveLivingInkStrokeRoute,
  withPencilSeen,
  STUDIO_LIVING_INK_BARREL_BUTTON_MASK,
} from "./studio-living-ink-input-routing";

describe("Living Ink dual-wield input routing", () => {
  it("maps pen to ink and finger-after-pencil to water", () => {
    let state = createDefaultLivingInkInputRoutingState("ink");
    state = withPencilSeen(state, "pen");
    expect(state.pencilSeen).toBe(true);

    const pen = resolveLivingInkStrokeRoute(state, {
      pointerId: 1,
      pointerType: "pen",
      buttons: 1,
      pressure: 0.7,
    });
    expect(pen.accept).toBe(true);
    expect(pen.mode).toBe("ink");
    expect(pen.pointerSource).toBe("pen");
    expect(pen.toolMode).toBe("pressure-speed-pen");

    const finger = resolveLivingInkStrokeRoute(state, {
      pointerId: 2,
      pointerType: "touch",
      buttons: 1,
      pressure: 0.5,
    });
    expect(finger.accept).toBe(true);
    expect(finger.mode).toBe("water");
    expect(finger.pointerSource).toBe("finger");
    expect(finger.toolMode).toBe("clean-water-brush");
    expect(livingInkModeLabel(finger.mode, finger)).toContain("손가락");
  });

  it("rejects a secondary pointer while a stroke is active (palm / dual-contact)", () => {
    const state = {
      ...createDefaultLivingInkInputRoutingState("ink"),
      pencilSeen: true,
      activePointerId: 7,
    };
    const rejected = resolveLivingInkStrokeRoute(state, {
      pointerId: 8,
      pointerType: "touch",
      buttons: 1,
      pressure: 0.4,
    });
    expect(rejected.accept).toBe(false);
    expect(rejected.rejectReason).toBe("palm-while-pen");
  });

  it("swaps ink↔water when barrel/eraser bits are held", () => {
    const state = createDefaultLivingInkInputRoutingState("ink");
    expect(livingInkBarrelActive(STUDIO_LIVING_INK_BARREL_BUTTON_MASK)).toBe(true);
    const swapped = resolveLivingInkStrokeRoute(state, {
      pointerId: 1,
      pointerType: "pen",
      buttons: STUDIO_LIVING_INK_BARREL_BUTTON_MASK | 1,
      pressure: 0.6,
    });
    expect(swapped.accept).toBe(true);
    expect(swapped.barrelSwapActive).toBe(true);
    // Pen defaults to ink; barrel flips to water.
    expect(swapped.mode).toBe("water");
  });

  it("prefers Force Touch pressure over the browser placeholder", () => {
    const force = resolveLivingInkPressure(
      {
        pointerId: 1,
        pointerType: "mouse",
        buttons: 1,
        pressure: 0.5,
        forceTouch: 0.82,
      },
      "mouse",
    );
    expect(force.pressureSource).toBe("force-touch");
    expect(force.pressure).toBeCloseTo(0.82, 5);

    const hardware = resolveLivingInkPressure(
      {
        pointerId: 1,
        pointerType: "pen",
        buttons: 1,
        pressure: 0.33,
      },
      "pen",
    );
    expect(hardware.pressureSource).toBe("hardware");
    expect(hardware.pressure).toBeCloseTo(0.33, 5);

    const simulated = resolveLivingInkPressure(
      {
        pointerId: 1,
        pointerType: "touch",
        buttons: 1,
        pressure: 0,
      },
      "finger",
    );
    expect(simulated.pressureSource).toBe("speed-simulated");
  });
});
