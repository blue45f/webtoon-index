import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  type StudioBg3dCaptureArtifactV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS,
} from "./studio-bg3d-artifact-webtoon-fx";
import {
  StudioBg3dRuntimeAdapterRegistry,
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeAdapter,
  type StudioBg3dRuntimeAdapterJob,
  type StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_EXECUTOR,
  StudioBg3dSpecialistWebtoonFxCoordinatorError,
  runStudioBg3dSpecialistWebtoonFxCoordinator,
} from "./studio-bg3d-specialist-webtoon-fx-coordinator";
import {
  STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
  STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
  type StudioBg3dWebtoonFxPass,
} from "./studio-bg3d-webtoon-fx";

import type { StudioBg3dRuntimeId } from "./studio-bg3d-runtime-topology";

const snapshot = createStudioBg3dRuntimeSnapshot(
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  new Map(),
);

function beauty(width: number, height: number): StudioBg3dCaptureArtifactV2 {
  return {
    kind: "beauty",
    width,
    height,
    profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
    data: new Uint8Array(width * height * 4).fill(255),
  };
}

function depth(width: number, height: number): StudioBg3dCaptureArtifactV2 {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = data.length === 1 ? 1 : index / (data.length - 1);
  }
  return {
    kind: "depth",
    width,
    height,
    profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
    data,
  };
}

function emission(width: number, height: number): StudioBg3dCaptureArtifactV2 {
  const data = new Uint8Array(width * height * 4);
  const offset = Math.floor((width * height) / 2) * 4;
  data.set([255, 128, 0, 255], offset);
  return {
    kind: "emission",
    width,
    height,
    profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
    data,
  };
}

function normal(width: number, height: number): StudioBg3dCaptureArtifactV2 {
  const data = new Uint8Array(width * height * 2);
  for (let offset = 0; offset < data.length; offset += 2) {
    data[offset] = 128;
    data[offset + 1] = 128;
  }
  return {
    kind: "normal",
    width,
    height,
    profile: STUDIO_BG3D_NORMAL_PROFILE,
    coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
    packing: STUDIO_BG3D_NORMAL_PACKING,
    data,
  };
}

function artifactResult(
  width: number,
  height: number,
  artifacts: readonly StudioBg3dCaptureArtifactV2[],
): StudioBg3dSpecialistResult {
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width,
    height,
    artifacts,
  };
}

function fxRequest(
  effects: readonly StudioBg3dWebtoonFxPass[],
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly includeDepth?: boolean;
  } = {},
) {
  return {
    kind: "webtoon-fx-capture",
    version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
    width: options.width ?? 2,
    height: options.height ?? 1,
    timeSeconds: 0,
    seed: 17,
    quality: "preview",
    outputIntent: "beauty",
    includeDepth: options.includeDepth ?? false,
    outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
    effects,
  } as const;
}

function adapter(
  runtimeId: StudioBg3dRuntimeId,
  run: (job: StudioBg3dRuntimeAdapterJob) => Promise<StudioBg3dSpecialistResult>,
): StudioBg3dRuntimeAdapter {
  return {
    runtimeId,
    capabilities: new Set(["capture-rgba-depth", "multi-artifact-capture"]),
    runIsolated: run,
    dispose: () => undefined,
  };
}

function coordinatorInput(
  registry: StudioBg3dRuntimeAdapterRegistry,
  request: ReturnType<typeof fxRequest>,
  runtimeIds: readonly StudioBg3dRuntimeId[],
  signal?: AbortSignal,
) {
  return {
    registry,
    jobId: "webtoon-fx-1",
    snapshot,
    request,
    candidates: runtimeIds.map((runtimeId) => ({ runtimeId })),
    ...(signal ? { signal } : {}),
  } as const;
}

describe("Studio BG3D specialist Webtoon FX coordinator", () => {
  it("captures one beauty/depth bundle and preserves its exact CPU plan provenance", async () => {
    const run = vi.fn(async (job: StudioBg3dRuntimeAdapterJob) => {
      expect(job.request).toMatchObject({
        kind: "artifact-capture-v2",
        width: 2,
        height: 1,
        artifacts: [
          { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
          { kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
        ],
      });
      return artifactResult(2, 1, [beauty(2, 1), depth(2, 1)]);
    });
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));

    const result = await runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "depth-atmosphere",
          startDepth: 0.1,
          endDepth: 0.9,
          density: 2,
          color: "#ffffff",
          opacity: 1,
        }], { includeDepth: true }),
        ["babylon-webgl-lab"],
      ),
    );

    expect(result.kind).toBe("specialist-webtoon-fx-result");
    expect(result.result.kind).toBe("capture");
    expect(result.result.depthFloat32).toEqual(new Float32Array([0, 1]));
    expect(result.provenance).toMatchObject({
      runtimeId: "babylon-webgl-lab",
      attempts: [{
        runtimeId: "babylon-webgl-lab",
        outcome: "succeeded",
      }],
      cpuEffectPlan: {
        kind: STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_EXECUTOR,
        width: 2,
        height: 1,
        includeDepth: true,
        sourceArtifacts: [
          { kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
          { kind: "depth", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
        ],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
    expect(Object.isFrozen(result.provenance.attempts)).toBe(true);
    expect(Object.isFrozen(result.provenance.cpuEffectPlan)).toBe(true);
    await registry.dispose();
  });

  it("rejects a multi-runtime capture plan before either runtime executes", async () => {
    const first = vi.fn(async () => {
      throw new Error("must not execute");
    });
    const second = vi.fn(async () => artifactResult(3, 1, [beauty(3, 1)]));
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgpu-lab", first));
    registry.register(adapter("babylon-webgl-lab", second));

    await expect(runStudioBg3dSpecialistWebtoonFxCoordinator({
      ...coordinatorInput(
        registry,
        fxRequest([{
          kind: "emissive-bloom",
          threshold: 0,
          intensity: 1,
          radiusPx: 1,
        }], { width: 3 }),
        ["babylon-webgpu-lab", "babylon-webgl-lab"],
      ),
      jobId: "webtoon-fx-multi-runtime-rejected",
    })).rejects.toMatchObject({
      code: "artifact-capture-failed",
      attempts: [],
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("requests depth for an effect but does not expose it unless the recipe asks for it", async () => {
    const run = vi.fn(async () =>
      artifactResult(2, 1, [beauty(2, 1), depth(2, 1)])
    );
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));

    const result = await runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "depth-atmosphere",
          startDepth: 0,
          endDepth: 1,
          density: 1,
          color: "#ffffff",
          opacity: 0.5,
        }]),
        ["babylon-webgl-lab"],
      ),
    );

    expect(result.result.depthFloat32).toBeUndefined();
    expect(result.provenance.cpuEffectPlan.sourceArtifacts.map(
      (artifact) => artifact.kind,
    )).toEqual(["beauty", "depth"]);
    await registry.dispose();
  });

  it("requests one complete beauty/depth/normal bundle for toon outline", async () => {
    const run = vi.fn(async (job: StudioBg3dRuntimeAdapterJob) => {
      expect(
        job.request.kind === "artifact-capture-v2" &&
        job.request.artifacts.map((artifact) => artifact.kind),
      ).toEqual(["beauty", "depth", "normal"]);
      return artifactResult(2, 1, [
        beauty(2, 1),
        depth(2, 1),
        normal(2, 1),
      ]);
    });
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));

    const result = await runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "toon-outline",
          thicknessPx: 1,
          depthThreshold: 0.1,
          normalThreshold: 0.1,
          color: "#000000",
          opacity: 1,
        }]),
        ["babylon-webgl-lab"],
      ),
    );

    expect(result.provenance.cpuEffectPlan.sourceArtifacts.map(
      (artifact) => artifact.kind,
    )).toEqual(["beauty", "depth", "normal"]);
    expect(run).toHaveBeenCalledTimes(1);
    await registry.dispose();
  });

  it("fails unsupported passes before invoking any runtime", async () => {
    const run = vi.fn(async () => artifactResult(2, 1, [beauty(2, 1)]));
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));

    await expect(runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "speed-lines",
          density: 0.5,
          strength: 1,
          center: [0.5, 0.5],
          color: "#ffffff",
          opacity: 1,
          seed: 2,
        }]),
        ["babylon-webgl-lab"],
      ),
    )).rejects.toMatchObject({
      code: "unsupported-effect",
      attempts: [],
    });
    expect(run).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("rejects CPU-ineligible requests before starting an expensive capture", async () => {
    const run = vi.fn(async () => artifactResult(1, 1, [beauty(1, 1), depth(1, 1)]));
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));
    const width = 513;
    const height = 512;
    expect(width * height).toBeGreaterThan(STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS);

    await expect(runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "depth-atmosphere",
          startDepth: 0,
          endDepth: 1,
          density: 1,
          color: "#ffffff",
          opacity: 1,
        }], { width, height }),
        ["babylon-webgl-lab"],
      ),
    )).rejects.toMatchObject({
      code: "pixel-budget-exceeded",
      attempts: [],
    });
    expect(run).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("treats a partial artifact result as terminal and never asks another runtime to fill it", async () => {
    const partial = vi.fn(async () =>
      artifactResult(2, 1, [beauty(2, 1)])
    );
    const fallback = vi.fn(async () =>
      artifactResult(2, 1, [beauty(2, 1), depth(2, 1)])
    );
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgpu-lab", partial));
    registry.register(adapter("babylon-webgl-lab", fallback));

    await expect(runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "depth-atmosphere",
          startDepth: 0,
          endDepth: 1,
          density: 1,
          color: "#ffffff",
          opacity: 1,
        }]),
        ["babylon-webgpu-lab"],
      ),
    )).rejects.toMatchObject({
      code: "artifact-capture-failed",
      attempts: [{
        runtimeId: "babylon-webgpu-lab",
        outcome: "failed",
        errorCode: "unknown",
      }],
    });
    expect(partial).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("never substitutes beauty for a missing canonical emission artifact", async () => {
    const run = vi.fn(async () =>
      artifactResult(2, 1, [beauty(2, 1)])
    );
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgl-lab", run));

    await expect(runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        fxRequest([{
          kind: "emissive-bloom",
          threshold: 0,
          intensity: 1,
          radiusPx: 1,
        }]),
        ["babylon-webgl-lab"],
      ),
    )).rejects.toMatchObject({
      code: "artifact-capture-failed",
      attempts: [{
        runtimeId: "babylon-webgl-lab",
        outcome: "failed",
        errorCode: "unknown",
      }],
    });
    expect(run).toHaveBeenCalledTimes(1);
    await registry.dispose();
  });

  it("snapshots the recipe before the selected runtime and preserves the original CPU plan", async () => {
    const effects: StudioBg3dWebtoonFxPass[] = [{
      kind: "emissive-bloom",
      threshold: 0,
      intensity: 1,
      radiusPx: 0,
    }];
    const mutableRequest = fxRequest(effects);
    const selected = vi.fn(async () => {
      effects[0] = {
        kind: "speed-lines",
        density: 0.5,
        strength: 1,
        center: [0.5, 0.5],
        color: "#ffffff",
        opacity: 1,
        seed: 1,
      };
      return artifactResult(2, 1, [beauty(2, 1), emission(2, 1)]);
    });
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgpu-lab", selected));

    const result = await runStudioBg3dSpecialistWebtoonFxCoordinator(
      coordinatorInput(
        registry,
        mutableRequest,
        ["babylon-webgpu-lab"],
      ),
    );

    expect(result.provenance.cpuEffectPlan.effects).toEqual([{
      kind: "emissive-bloom",
      threshold: 0,
      intensity: 1,
      radiusPx: 0,
    }]);
    expect(selected).toHaveBeenCalledTimes(1);
    await registry.dispose();
  });

  it("propagates caller abort as terminal provenance without running a fallback", async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { code: "aborted" });
    });
    const fallback = vi.fn(async () =>
      artifactResult(2, 1, [beauty(2, 1), depth(2, 1)])
    );
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter("babylon-webgpu-lab", first));
    registry.register(adapter("babylon-webgl-lab", fallback));

    let captured: unknown;
    try {
      await runStudioBg3dSpecialistWebtoonFxCoordinator(
        coordinatorInput(
          registry,
          fxRequest([{
            kind: "depth-atmosphere",
            startDepth: 0,
            endDepth: 1,
            density: 1,
            color: "#ffffff",
            opacity: 1,
          }]),
          ["babylon-webgpu-lab"],
          controller.signal,
        ),
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(
      StudioBg3dSpecialistWebtoonFxCoordinatorError,
    );
    expect(captured).toMatchObject({
      code: "aborted",
      attempts: [{
        runtimeId: "babylon-webgpu-lab",
        outcome: "aborted",
      }],
    });
    expect(fallback).not.toHaveBeenCalled();
    await registry.dispose();
  });
});
