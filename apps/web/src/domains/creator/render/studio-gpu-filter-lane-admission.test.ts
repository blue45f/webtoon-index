import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureStudioGpuFilterLaneAdmission,
  readStudioGpuFilterLaneAdmission,
  resetStudioGpuFilterLaneAdmissionForTests,
} from "./studio-gpu-filter-lane-admission";

afterEach(() => {
  resetStudioGpuFilterLaneAdmissionForTests();
});

function navigatorWithAdapter(adapter: object | null) {
  return { gpu: { requestAdapter: async () => adapter } };
}

describe("Studio GPU filter lane admission", () => {
  it("starts unknown so a caller never reads a guess as a refusal", () => {
    expect(readStudioGpuFilterLaneAdmission()).toBe("unknown");
  });

  it("admits the lane when an adapter is actually available", async () => {
    await expect(ensureStudioGpuFilterLaneAdmission({
      navigator: navigatorWithAdapter({}),
    })).resolves.toBe("admitted");
    expect(readStudioGpuFilterLaneAdmission()).toBe("admitted");
  });

  it("refuses the lane when requestAdapter resolves null", async () => {
    // The shape a GPU-blocklisted, hardware-acceleration-off, VM or remote-desktop session presents:
    // navigator.gpu exists, so any feature-detect passes, and only the adapter request tells the truth.
    await expect(ensureStudioGpuFilterLaneAdmission({
      navigator: navigatorWithAdapter(null),
    })).resolves.toBe("refused");
    expect(readStudioGpuFilterLaneAdmission()).toBe("refused");
  });

  it("refuses the lane when WebGPU is absent entirely", async () => {
    await expect(ensureStudioGpuFilterLaneAdmission({ navigator: {} }))
      .resolves.toBe("refused");
  });

  it("probes once and shares the result with concurrent callers", async () => {
    const requestAdapter = vi.fn(async () => ({}));
    const [first, second, third] = await Promise.all([
      ensureStudioGpuFilterLaneAdmission({ navigator: { gpu: { requestAdapter } } }),
      ensureStudioGpuFilterLaneAdmission({ navigator: { gpu: { requestAdapter } } }),
      ensureStudioGpuFilterLaneAdmission({ navigator: { gpu: { requestAdapter } } }),
    ]);
    expect([first, second, third]).toEqual(["admitted", "admitted", "admitted"]);
    // A page full of filtered images must not issue one requestAdapter per node.
    expect(requestAdapter).toHaveBeenCalledOnce();
    await ensureStudioGpuFilterLaneAdmission({ navigator: { gpu: { requestAdapter } } });
    expect(requestAdapter).toHaveBeenCalledOnce();
  });

  it("refuses rather than admitting a lane it cannot vouch for when the probe rejects", async () => {
    await expect(ensureStudioGpuFilterLaneAdmission({
      navigator: {
        gpu: {
          requestAdapter: () => {
            throw new Error("adapter exploded");
          },
        },
      },
    })).resolves.toBe("refused");
  });
});
