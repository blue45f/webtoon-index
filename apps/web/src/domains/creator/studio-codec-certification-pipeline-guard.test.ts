import { describe, expect, it, vi } from "vitest";

import {
  createStudioCodecCertificationPipelineGuard,
} from "./studio-codec-certification-pipeline-guard";

describe("Studio codec certification pipeline guard", () => {
  it("uses one deadline across sequential codec, conformance, and signing phases", async () => {
    vi.useFakeTimers();
    try {
      const guard = createStudioCodecCertificationPipelineGuard({
        timeoutMs: 100,
        defaultTimeoutMs: 1_000,
        minTimeoutMs: 1,
        maxTimeoutMs: 10_000,
      });
      const codec = guard.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      await vi.advanceTimersByTimeAsync(60);
      await codec;
      const signing = guard.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      const rejected = expect(signing).rejects.toMatchObject({
        code: "timeout",
      });
      await vi.advanceTimersByTimeAsync(40);
      await rejected;
      guard.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the external abort registration race with a stable error", async () => {
    const controller = new AbortController();
    const guard = createStudioCodecCertificationPipelineGuard({
      signal: controller.signal,
      timeoutMs: 10_000,
      defaultTimeoutMs: 10_000,
      minTimeoutMs: 1,
      maxTimeoutMs: 10_000,
    });
    const pending = guard.run(
      () => new Promise<void>(() => undefined),
    );
    controller.abort(new Error("private caller reason"));
    await expect(pending).rejects.toMatchObject({
      code: "aborted",
      message: "Studio codec certification pipeline aborted.",
    });
    guard.close();
  });

  it("rejects invalid timeout budgets before starting a phase", () => {
    expect(() =>
      createStudioCodecCertificationPipelineGuard({
        timeoutMs: 0,
        defaultTimeoutMs: 1_000,
        minTimeoutMs: 1,
        maxTimeoutMs: 10_000,
      })).toThrowError(expect.objectContaining({
        code: "invalid-timeout",
      }));
  });
});
