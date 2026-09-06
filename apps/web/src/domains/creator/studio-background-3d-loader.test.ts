import { describe, expect, it, vi } from "vitest";

import {
  loadStudioBackground3DModule,
  preloadStudioBackground3D,
} from "./studio-background-3d-loader";

vi.mock("./bg3d/StudioBackground3D", () => ({
  StudioBackground3D: function MockStudioBackground3D() {
    return null;
  },
}));

describe("studio background 3D lazy loader", () => {
  it("coalesces intent preload and activation into one module request", async () => {
    const first = loadStudioBackground3DModule();
    preloadStudioBackground3D();
    const second = loadStudioBackground3DModule();

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ StudioBackground3D: expect.any(Function) });
  });
});
