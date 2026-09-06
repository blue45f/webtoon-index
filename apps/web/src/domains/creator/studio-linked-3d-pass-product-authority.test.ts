import { afterEach, describe, expect, it, vi } from "vitest";

import { acquireStudioLinked3dPassProductAuthority } from "./studio-linked-3d-pass-product-authority";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio linked 3D pass product OPFS authority", () => {
  it("fails closed before opening OPFS when origin-wide Web Locks are unavailable", async () => {
    const getDirectory = vi.fn();
    vi.stubGlobal("navigator", {
      storage: { getDirectory },
    });

    await expect(acquireStudioLinked3dPassProductAuthority()).rejects.toMatchObject({
      code: "opfs-unavailable",
    });
    expect(getDirectory).not.toHaveBeenCalled();
  });
});
