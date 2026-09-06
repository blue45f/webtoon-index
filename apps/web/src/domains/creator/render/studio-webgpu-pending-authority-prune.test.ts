import { describe, expect, it } from "vitest";

import { pruneStudioGpuPendingAuthority } from "./studio-webgpu-pending-authority";

import type { StudioGpuPendingDrawAuthority } from "./studio-webgpu-pending-authority";
import type { DrawEl } from "../studio-element-model";

function authority(id: string, gpuStrokeCount: number): StudioGpuPendingDrawAuthority {
  return { element: { id, type: "draw", points: [0, 0, 1, 1] } as DrawEl, gpuStrokeCount };
}

describe("pruneStudioGpuPendingAuthority", () => {
  it("cuts the rejected group out and keeps every other slice in order", () => {
    const result = pruneStudioGpuPendingAuthority(
      [authority("a", 1), authority("b", 2), authority("c", 1)],
      ["a0", "b0", "b1", "c0"],
      "b",
    );
    expect(result).toEqual({
      status: "pruned",
      authorities: [authority("a", 1), authority("c", 1)],
      gpuStrokes: ["a0", "c0"],
    });
  });

  it("leaves a queue untouched when the rejected stroke is not in it", () => {
    expect(
      pruneStudioGpuPendingAuthority([authority("a", 1), authority("b", 2)], ["a0", "b0", "b1"], "zzz"),
    ).toEqual({ status: "untouched" });
  });

  it("drops the whole queue on corrupt accounting instead of authorizing a partial survivor", () => {
    // Count overruns the stroke list.
    expect(
      pruneStudioGpuPendingAuthority([authority("a", 3)], ["a0", "a1"], "a"),
    ).toEqual({ status: "dropped-all", reason: "invalid-accounting" });
    // Counts under-run the stroke list (an orphan operation at the tail).
    expect(
      pruneStudioGpuPendingAuthority([authority("a", 1)], ["a0", "orphan"], "a"),
    ).toEqual({ status: "dropped-all", reason: "invalid-accounting" });
    // Corrupt accounting is fatal even when the rejected stroke is absent.
    expect(
      pruneStudioGpuPendingAuthority([authority("a", 0)], [], "zzz"),
    ).toEqual({ status: "dropped-all", reason: "invalid-accounting" });
  });

  it("removes the only group as an empty but valid queue", () => {
    expect(pruneStudioGpuPendingAuthority([authority("a", 2)], ["a0", "a1"], "a")).toEqual({
      status: "pruned",
      authorities: [],
      gpuStrokes: [],
    });
  });
});
