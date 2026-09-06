import { describe, expect, it, vi } from "vitest";

import { withStudioRasterSourceProjection } from "./studio-raster-source-projection";

import type { StudioRasterSourceProjectionAcquire } from "./studio-raster-source-projection";

function locator(character = "a"): string {
  return `studio-opfs-cas:sha256:${character.repeat(64)}`;
}

function linkedAcquire(release = vi.fn()): StudioRasterSourceProjectionAcquire {
  return vi.fn(async (source) => source.startsWith("studio-opfs-cas:") ? ({
      kind: "linked-3d-cas" as const,
      src: `blob:${source.slice(-8)}`,
      blob: new Blob(["png"], { type: "image/png" }),
      receipt: {
        contentHash: source.slice("studio-opfs-cas:".length) as `sha256:${string}`,
        byteSize: 3,
        mime: "image/png" as const,
        width: 1,
        height: 1,
      },
      release,
    }) : ({
      kind: "passthrough" as const,
      src: source,
      blob: null,
      receipt: null,
      release: vi.fn(),
    }));
}

describe("withStudioRasterSourceProjection", () => {
  it("deduplicates linked sources, projects copies, and releases after the operation", async () => {
    const release = vi.fn();
    const acquire = linkedAcquire(release);
    const values = [
      { id: "a", src: locator() },
      { id: "b", src: locator() },
      { id: "ordinary", src: "data:image/png;base64,cG5n" },
    ];

    const result = await withStudioRasterSourceProjection({
      acquire,
      consumer: "test",
      values,
      run: async (projected) => {
        expect(release).not.toHaveBeenCalled();
        expect(projected[0]?.src).toBe("blob:aaaaaaaa");
        expect(projected[1]?.src).toBe("blob:aaaaaaaa");
        expect(projected[2]).toBe(values[2]);
        return "done";
      },
    });

    expect(result).toBe("done");
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(values[0]?.src).toBe(locator());
  });

  it("releases every acquired lease when the consumer fails", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const acquire = vi.fn<StudioRasterSourceProjectionAcquire>(async (source) => {
      const release = vi.fn();
      releases.push(release);
      return {
        kind: "linked-3d-cas",
        src: `blob:${source.slice(-1)}`,
        blob: new Blob(["png"], { type: "image/png" }),
        receipt: {
          contentHash: source.slice("studio-opfs-cas:".length) as `sha256:${string}`,
          byteSize: 3,
          mime: "image/png",
          width: 1,
          height: 1,
        },
        release,
      };
    });

    await expect(withStudioRasterSourceProjection({
      acquire,
      consumer: "test",
      values: [{ src: locator("a") }, { src: locator("b") }],
      run: async () => { throw new Error("compose failed"); },
    })).rejects.toThrow("compose failed");
    expect(releases).toHaveLength(2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("fails aggregate admission before invoking the consumer", async () => {
    const release = vi.fn();
    const acquire = vi.fn<StudioRasterSourceProjectionAcquire>(async (source) => ({
      kind: "linked-3d-cas",
      src: "blob:large",
      blob: new Blob(["x"], { type: "image/png" }),
      receipt: {
        contentHash: source.slice("studio-opfs-cas:".length) as `sha256:${string}`,
        byteSize: 64 * 1024 * 1024,
        mime: "image/png",
        width: 8_192,
        height: 8_192,
      },
      release,
    }));
    const run = vi.fn(async () => undefined);

    await expect(withStudioRasterSourceProjection({
      acquire,
      consumer: "test",
      values: [{ src: locator("a") }, { src: locator("b") }],
      run,
    })).rejects.toThrow("aggregate budget");
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });
});
