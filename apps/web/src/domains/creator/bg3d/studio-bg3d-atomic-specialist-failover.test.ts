import { describe, expect, it, vi } from "vitest";

import {
  StudioBg3dAtomicSpecialistError,
  runStudioBg3dAtomicSpecialist,
} from "./studio-bg3d-atomic-specialist-failover";
import {
  StudioBg3dRuntimeBoundaryError,
  StudioBg3dRuntimeAdapterRegistry,
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeSnapshot,
  type StudioBg3dSpecialistRequest,
  type StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";

import type { StudioBg3dRuntimeId } from "./studio-bg3d-runtime-topology";

const snapshot = createStudioBg3dRuntimeSnapshot(
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  new Map(),
);
const request = Object.freeze({ kind: "runtime-metrics" }) satisfies
  StudioBg3dSpecialistRequest;
const metrics = Object.freeze({
  kind: "metrics",
  values: Object.freeze({ ready: true }),
}) satisfies StudioBg3dSpecialistResult;

function inputFor(
  run: (
    runtimeId: StudioBg3dRuntimeId,
    id: string,
    value: StudioBg3dRuntimeSnapshot,
    valueRequest: StudioBg3dSpecialistRequest,
    signal?: AbortSignal,
  ) => Promise<StudioBg3dSpecialistResult>,
  candidateIds: readonly StudioBg3dRuntimeId[] = ["babylon-webgpu-lab"],
  requestValue: StudioBg3dSpecialistRequest = request,
) {
  const registry = new StudioBg3dRuntimeAdapterRegistry();
  for (const runtimeId of candidateIds) {
    registry.register({
      runtimeId,
      capabilities: new Set(),
      runIsolated: (job) =>
        run(runtimeId, job.id, job.snapshot, job.request, job.signal),
      dispose: () => undefined,
    });
  }
  return {
    registry,
    jobId: "capture-1",
    snapshot,
    request: requestValue,
    candidates: candidateIds.map((runtimeId) => ({ runtimeId })),
  } as const;
}

describe("Studio BG3D atomic specialist single-runtime transaction", () => {
  it("returns one complete result from the preselected runtime", async () => {
    const run = vi.fn().mockResolvedValue(metrics);

    const result = await runStudioBg3dAtomicSpecialist(inputFor(run));

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      runtimeId: "babylon-webgpu-lab",
      result: metrics,
      attempts: [{ runtimeId: "babylon-webgpu-lab", outcome: "succeeded" }],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.attempts)).toBe(true);
  });

  it.each([
    "engine-init-failed",
    "device-lost",
    "context-lost",
    "renderer-unavailable",
  ] as const)("fails closed after %s without starting another runtime", async (code) => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error(code), { code }));

    await expect(runStudioBg3dAtomicSpecialist(inputFor(run))).rejects.toMatchObject({
      code: "terminal-attempt-failed",
      attempts: [{
        runtimeId: "babylon-webgpu-lab",
        outcome: "failed",
        errorCode: code,
      }],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rejects a multi-runtime plan before any adapter executes", async () => {
    const run = vi.fn().mockResolvedValue(metrics);
    await expect(runStudioBg3dAtomicSpecialist(inputFor(run, [
      "babylon-webgpu-lab",
      "babylon-webgl-lab",
    ]))).rejects.toMatchObject({ code: "invalid-candidates" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each<readonly [{ readonly runtimeId: StudioBg3dRuntimeId }[]]>([
    [[]],
    [[{ runtimeId: "not-a-runtime" as StudioBg3dRuntimeId }]],
  ])("rejects an invalid singleton selection", async (candidates) => {
    const run = vi.fn().mockResolvedValue(metrics);
    await expect(runStudioBg3dAtomicSpecialist({
      ...inputFor(run),
      candidates,
    })).rejects.toMatchObject({ code: "invalid-candidates" });
    expect(run).not.toHaveBeenCalled();
  });

  it("never retries an invalid result and exposes no partial output", async () => {
    const partial = { kind: "capture", width: 1, height: 1, rgba: new Uint8Array([255]) };
    const run = vi.fn().mockResolvedValue(partial as unknown as StudioBg3dSpecialistResult);
    await expect(runStudioBg3dAtomicSpecialist(inputFor(run))).rejects.toMatchObject({
      code: "terminal-attempt-failed",
      attempts: [{ errorCode: "unknown", outcome: "failed" }],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats caller abort as terminal", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      throw new StudioBg3dRuntimeBoundaryError("aborted");
    });
    await expect(runStudioBg3dAtomicSpecialist({
      ...inputFor(run),
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: "aborted",
      attempts: [{ runtimeId: "babylon-webgpu-lab", outcome: "aborted" }],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports a pre-abort without invoking the selected runtime", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn().mockResolvedValue(metrics);
    await expect(runStudioBg3dAtomicSpecialist({
      ...inputFor(run),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted", attempts: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a candidate whose runtimeId is exposed through a getter", async () => {
    const run = vi.fn().mockResolvedValue(metrics);
    const candidate = Object.defineProperty({}, "runtimeId", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    await expect(runStudioBg3dAtomicSpecialist({
      ...inputFor(run),
      candidates: [candidate] as unknown as readonly [{
        readonly runtimeId: StudioBg3dRuntimeId;
      }],
    })).rejects.toMatchObject({ code: "invalid-candidates" });
    expect(run).not.toHaveBeenCalled();
  });

  it("snapshots the immutable request before the one runtime call", async () => {
    const mutableRequest = { kind: "runtime-metrics" } as
      StudioBg3dSpecialistRequest & { kind: string };
    const observed: StudioBg3dSpecialistRequest[] = [];
    const run = vi.fn(async (
      _runtimeId: StudioBg3dRuntimeId,
      _id: string,
      _snapshot: StudioBg3dRuntimeSnapshot,
      valueRequest: StudioBg3dSpecialistRequest,
    ) => {
      observed.push(valueRequest);
      mutableRequest.kind = "capture";
      return metrics;
    });
    await runStudioBg3dAtomicSpecialist(inputFor(run, undefined, mutableRequest));
    expect(observed).toHaveLength(1);
    expect(observed[0]?.kind).toBe("runtime-metrics");
    expect(Object.isFrozen(observed[0])).toBe(true);
  });

  it("classifies a throwing error-code getter without retrying", async () => {
    const failure = Object.defineProperty(new Error("opaque"), "code", {
      get: () => {
        throw new Error("must not escape");
      },
    });
    const run = vi.fn().mockRejectedValue(failure);
    let captured: unknown;
    try {
      await runStudioBg3dAtomicSpecialist(inputFor(run));
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(StudioBg3dAtomicSpecialistError);
    expect(captured).toMatchObject({
      code: "terminal-attempt-failed",
      attempts: [{ errorCode: "unknown", outcome: "failed" }],
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
