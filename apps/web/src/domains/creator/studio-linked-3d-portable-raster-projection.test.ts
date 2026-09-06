import { describe, expect, it, vi } from "vitest";

import {
  projectStudioLinked3dRasterSourcesForPortableExport,
  StudioLinked3dPortableRasterProjectionError,
  type StudioPortableRasterLeaseAcquirer,
} from "./studio-linked-3d-portable-raster-projection";

function locator(character = "a"): string {
  return `studio-opfs-cas:sha256:${character.repeat(64)}`;
}

describe("projectStudioLinked3dRasterSourcesForPortableExport", () => {
  it("deduplicates verified leases, replaces only the export projection, and releases", async () => {
    const release = vi.fn();
    const acquire = vi.fn<StudioPortableRasterLeaseAcquirer>(async () => ({
      kind: "linked-3d-cas",
      src: "blob:verified",
      blob: new Blob(["png"], { type: "image/png" }),
      receipt: null,
      release,
    }));
    const input = [
      { id: "a", type: "image", src: locator() },
      { id: "b", type: "image", src: locator() },
      { id: "c", type: "draw" },
    ] as const;

    const result = await projectStudioLinked3dRasterSourcesForPortableExport(input, {
      acquire,
      encode: async () => "data:image/png;base64,cG5n",
    });

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(result).not.toBe(input);
    expect(result[0]).toMatchObject({ src: "data:image/png;base64,cG5n" });
    expect(result[1]).toMatchObject({ src: "data:image/png;base64,cG5n" });
    expect(input[0].src).toBe(locator());
    expect(result[2]).toBe(input[2]);
  });

  it("keeps ordinary documents allocation-free", async () => {
    const acquire = vi.fn<StudioPortableRasterLeaseAcquirer>();
    const input = [{ id: "ordinary", type: "image", src: "data:image/png;base64,cG5n" }];

    await expect(projectStudioLinked3dRasterSourcesForPortableExport(input, { acquire }))
      .resolves.toBe(input);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed reserved locator without exposing it", async () => {
    await expect(projectStudioLinked3dRasterSourcesForPortableExport([
      { id: "bad", type: "image", src: "studio-opfs-cas:wrong" },
    ])).rejects.toBeInstanceOf(StudioLinked3dPortableRasterProjectionError);
  });

  it("releases a verified lease when encoding fails", async () => {
    const release = vi.fn();
    const acquire = vi.fn<StudioPortableRasterLeaseAcquirer>(async () => ({
      kind: "linked-3d-cas",
      src: "blob:verified",
      blob: new Blob(["png"], { type: "image/png" }),
      receipt: null,
      release,
    }));

    await expect(projectStudioLinked3dRasterSourcesForPortableExport([
      { id: "a", type: "image", src: locator() },
    ], {
      acquire,
      encode: async () => { throw new Error("encode failed"); },
    })).rejects.toThrow("encode failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
