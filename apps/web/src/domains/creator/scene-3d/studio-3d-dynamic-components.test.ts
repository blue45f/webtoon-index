import { describe, expect, it } from "vitest";

import {
  createDynamicComponent,
  evaluateDynamicComponentTransform,
  setDynamicComponentValue,
  DYNAMIC_COMPONENT_PRESETS,
} from "./studio-3d-dynamic-components";

describe("Studio 3D Dynamic Interactive Components Engine", () => {
  it("provides 8 preconfigured dynamic component types", () => {
    expect(DYNAMIC_COMPONENT_PRESETS.length).toBe(8);
    const door = DYNAMIC_COMPONENT_PRESETS.find((p) => p.kind === "door-single-swing");
    expect(door).toBeDefined();
    expect(door?.interactionType).toBe("revolve");
    expect(door?.defaultMaxRange).toBe(90);
  });

  it("evaluates door rotation at closed, 50% open, and fully open states", () => {
    const compClosed = createDynamicComponent("door-1", "door-single-swing", false);
    const closedRes = evaluateDynamicComponentTransform(compClosed);
    expect(closedRes.rotation[1]).toBe(0);
    expect(closedRes.stateLabel).toBe("닫힘 (Closed)");

    const compHalf = setDynamicComponentValue(compClosed, 0.5);
    const halfRes = evaluateDynamicComponentTransform(compHalf);
    expect(halfRes.rotation[1]).toBe(45);
    expect(halfRes.stateLabel).toBe("50% 개방");

    const compOpen = setDynamicComponentValue(compClosed, 1.0);
    const openRes = evaluateDynamicComponentTransform(compOpen);
    expect(openRes.rotation[1]).toBe(90);
    expect(openRes.isOpen).toBe(true);
    expect(openRes.stateLabel).toBe("완전 개방 (Open)");
  });

  it("evaluates sliding window translation along local X axis", () => {
    const compClosed = createDynamicComponent("win-1", "window-sliding", false);
    const compOpen = setDynamicComponentValue(compClosed, 1.0);
    const winRes = evaluateDynamicComponentTransform(compOpen);

    expect(winRes.position[0]).toBe(0.8);
    expect(winRes.rotation[1]).toBe(0);
    expect(winRes.isOpen).toBe(true);
  });
});
