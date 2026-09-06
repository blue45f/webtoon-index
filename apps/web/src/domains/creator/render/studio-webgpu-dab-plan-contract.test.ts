import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  PlannedStudioGpuDabs,
  StudioGpuBatch,
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./studio-webgpu-dab-plan-contract";

function dab(overrides: Partial<StudioGpuDab> = {}): StudioGpuDab {
  return {
    x: 4,
    y: 8,
    radius: 3,
    red: 1,
    green: 0.5,
    blue: 0.25,
    alpha: 0.75,
    composite: "normal",
    ...overrides,
  };
}

describe("studio WebGPU dab-plan contract", () => {
  it("keeps the full-frame and tiled planners on one renderer-neutral shape", () => {
    const batch: StudioGpuBatch = {
      composite: "normal",
      firstInstance: 0,
      instanceCount: 1,
    };
    const plan: PlannedStudioGpuDabs = {
      dabs: [dab()],
      batches: [batch],
      complete: true,
    };

    expect(plan).toEqual({
      dabs: [dab()],
      batches: [batch],
      complete: true,
    });
    expectTypeOf(plan.dabs).toEqualTypeOf<StudioGpuDab[]>();
    expectTypeOf(plan.batches).toEqualTypeOf<StudioGpuBatch[]>();
  });

  it("extends the exact plan with append-versus-rebuild authority only", () => {
    const update: StudioGpuDabRenderUpdate = {
      mode: "append",
      dabs: [dab({ composite: "erase" })],
      batches: [{ composite: "erase", firstInstance: 0, instanceCount: 1 }],
      complete: false,
    };

    expect(update.mode).toBe("append");
    expect(update.dabs[0]?.composite).toBe("erase");
    expectTypeOf<StudioGpuDabRenderUpdate>().toMatchTypeOf<PlannedStudioGpuDabs>();
  });
});
