import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  type StudioBg3dArtifactCaptureResultV2,
  type StudioBg3dCaptureArtifactV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  StudioBg3dRuntimeAdapterRegistry,
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeAdapter,
  type StudioBg3dRuntimeAdapterJob,
  type StudioBg3dSpecialistRequest,
} from "./studio-bg3d-runtime-adapter";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
  normalizeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
  STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
} from "./studio-bg3d-webtoon-fx";

import type { StudioBg3dRuntimeCapability } from "./studio-bg3d-runtime-topology";

function metricsAdapter(): StudioBg3dRuntimeAdapter {
  return {
    runtimeId: "babylon-webgl-lab",
    capabilities: new Set(["physics", "capture-rgba-depth"]),
    async runIsolated(job) {
      return {
        kind: "metrics",
        values: { request: job.request.kind, assets: job.snapshot.assets.length },
      };
    },
    dispose: vi.fn(),
  };
}

function artifactCaptureResultV2(
  artifacts: readonly StudioBg3dCaptureArtifactV2[],
  width = 2,
  height = 1,
): StudioBg3dArtifactCaptureResultV2 {
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width,
    height,
    artifacts,
  };
}

describe("Studio BG3D runtime adapter boundary", () => {
  it("creates a canonical immutable snapshot without renderer objects", () => {
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    expect(snapshot.assets).toEqual([]);
    expect(snapshot.totalAssetBytes).toBe(0);
    expect(JSON.parse(snapshot.canonicalDocumentJson)).toMatchObject({
      kind: "toonspectrum.bg3d-scene",
      version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("checks capabilities, sanitizes DTO results, and disposes registered adapters", async () => {
    const adapter = metricsAdapter();
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, new Map());

    const result = await registry.run(
      "babylon-webgl-lab",
      "physics",
      snapshot,
      {
        kind: "physics-preview",
        durationSeconds: 1,
        stepSeconds: 1 / 60,
        gravity: [0, -9.8, 0],
        world: { bodies: [], solverSubsteps: 2, allowSleep: true },
      },
    );

    expect(result).toEqual({ kind: "metrics", values: { request: "physics-preview", assets: 0 } });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(registry.run(
      "babylon-webgl-lab",
      "splat",
      snapshot,
      { kind: "splat-preview", width: 64, height: 64 },
    )).rejects.toMatchObject({ code: "capability-unavailable" });
    await registry.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
    await expect(registry.run(
      "babylon-webgl-lab",
      "late",
      snapshot,
      { kind: "runtime-metrics" },
    )).rejects.toMatchObject({ code: "registry-disposed" });
  });

  it("rejects physics worlds that reference nodes outside the canonical snapshot", async () => {
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(metricsAdapter());
    const snapshot = createStudioBg3dRuntimeSnapshot(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, new Map());

    await expect(registry.run(
      "babylon-webgl-lab",
      "invalid-physics",
      snapshot,
      {
        kind: "physics-preview",
        durationSeconds: 1,
        stepSeconds: 1 / 60,
        gravity: [0, -9.8, 0],
        world: {
          solverSubsteps: 2,
          allowSleep: true,
          bodies: [{
            nodeId: "not-in-document",
            motion: "dynamic",
            collider: { kind: "sphere", radius: 1 },
            mass: 1,
            friction: 0.5,
            restitution: 0,
            linearDamping: 0,
            angularDamping: 0,
          }],
        },
      },
    )).rejects.toMatchObject({ code: "invalid-request" });
    await registry.dispose();
  });

  it("snapshots a bounded Babylon webtoon FX recipe and requires the specialist capability", async () => {
    let received: StudioBg3dRuntimeAdapterJob["request"] | undefined;
    const capturedRgba = new Uint8Array(16);
    const capturedDepth = new Float32Array(4);
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgpu-lab",
      capabilities: new Set(["capture-rgba-depth", "webtoon-scene-fx"]),
      async runIsolated(job) {
        received = job.request;
        if (job.id === "fx-no-depth") {
          return {
            kind: "capture",
            width: 2,
            height: 2,
            rgba: new Uint8Array(16),
          };
        }
        if (job.id === "fx-wrong-size") {
          return {
            kind: "capture",
            width: 1,
            height: 4,
            rgba: new Uint8Array(16),
            depthFloat32: new Float32Array(4),
          };
        }
        if (job.id === "fx-wrong-kind") {
          return { kind: "metrics", values: { rendered: false } };
        }
        if (job.id === "fx-bad-depth") {
          return {
            kind: "capture",
            width: 2,
            height: 2,
            rgba: new Uint8Array(16),
            depthFloat32: new Float32Array([0, 0.5, 1, Number.NaN]),
          };
        }
        return {
          kind: "capture",
          width: 2,
          height: 2,
          rgba: capturedRgba,
          depthFloat32: capturedDepth,
        };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    const captured = await registry.run(
      "babylon-webgpu-lab",
      "fx-preview",
      snapshot,
      {
        kind: "webtoon-fx-capture",
        version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
        width: 2,
        height: 2,
        timeSeconds: 1.5,
        seed: 17,
        quality: "preview",
        outputIntent: "beauty",
        includeDepth: true,
        outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
        effects: [{
          kind: "toon-outline",
          thicknessPx: 2,
          depthThreshold: 0.08,
          normalThreshold: 0.32,
          color: "#101010",
          opacity: 0.9,
        }],
      },
    );
    expect(captured).toMatchObject({
      kind: "capture",
      width: 2,
      height: 2,
    });
    capturedRgba[0] = 255;
    capturedDepth[0] = 1;
    expect(captured.kind === "capture" && captured.rgba[0]).toBe(0);
    expect(captured.kind === "capture" && captured.depthFloat32?.[0]).toBe(0);
    expect(received).toEqual({
      kind: "webtoon-fx-capture",
      version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
      width: 2,
      height: 2,
      timeSeconds: 1.5,
      seed: 17,
      quality: "preview",
      outputIntent: "beauty",
      includeDepth: true,
      outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
      effects: [{
        kind: "toon-outline",
        thicknessPx: 2,
        depthThreshold: 0.08,
        normalThreshold: 0.32,
        color: "#101010",
        opacity: 0.9,
      }],
    });
    expect(Object.isFrozen(received)).toBe(true);
    expect(
      received?.kind === "webtoon-fx-capture" && Object.isFrozen(received.effects),
    ).toBe(true);
    const boundedFxRequest = {
      kind: "webtoon-fx-capture" as const,
      version: STUDIO_BG3D_WEBTOON_FX_RECIPE_VERSION,
      width: 2,
      height: 2,
      timeSeconds: 0,
      seed: 0,
      quality: "preview" as const,
      outputIntent: "beauty" as const,
      includeDepth: true,
      outputProfile: STUDIO_BG3D_WEBTOON_FX_OUTPUT_PROFILE,
      effects: [{
        kind: "emissive-bloom" as const,
        threshold: 1,
        intensity: 1,
        radiusPx: 8,
      }],
    };
    await expect(registry.run(
      "babylon-webgpu-lab",
      "fx-no-depth",
      snapshot,
      boundedFxRequest,
    )).rejects.toMatchObject({ code: "invalid-result" });
    await expect(registry.run(
      "babylon-webgpu-lab",
      "fx-wrong-kind",
      snapshot,
      boundedFxRequest,
    )).rejects.toMatchObject({ code: "invalid-result" });
    await expect(registry.run(
      "babylon-webgpu-lab",
      "fx-bad-depth",
      snapshot,
      boundedFxRequest,
    )).rejects.toMatchObject({ code: "invalid-result" });
    await expect(registry.run(
      "babylon-webgpu-lab",
      "fx-wrong-size",
      snapshot,
      boundedFxRequest,
    )).rejects.toMatchObject({ code: "invalid-result" });
    await registry.dispose();

    const missingCapabilityRegistry = new StudioBg3dRuntimeAdapterRegistry();
    missingCapabilityRegistry.register({
      ...adapter,
      capabilities: new Set(["capture-rgba-depth"]),
    });
    await expect(missingCapabilityRegistry.run(
      "babylon-webgpu-lab",
      "fx-preview",
      snapshot,
      boundedFxRequest,
    )).rejects.toMatchObject({ code: "capability-unavailable" });
    await missingCapabilityRegistry.dispose();
  });

  it("routes a frozen v2 artifact request and returns a defensive clone-safe result", async () => {
    let received: StudioBg3dRuntimeAdapterJob["request"] | undefined;
    const rendererBeauty = new Uint8Array(8).fill(17);
    const rendererDepth = new Float32Array([0.25, 0.75]);
    const requestedArtifacts = [
      { kind: "beauty" as const, profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
      { kind: "depth" as const, profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
    ];
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgpu-lab",
      capabilities: new Set(["capture-rgba-depth", "multi-artifact-capture"]),
      async runIsolated(job) {
        received = job.request;
        return artifactCaptureResultV2([
          {
            kind: "beauty",
            width: 2,
            height: 1,
            profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
            data: rendererBeauty,
          },
          {
            kind: "depth",
            width: 2,
            height: 1,
            profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
            data: rendererDepth,
          },
        ]);
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    const result = await registry.run(
      "babylon-webgpu-lab",
      "artifact-v2",
      snapshot,
      {
        kind: "artifact-capture-v2",
        version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
        width: 2,
        height: 1,
        artifacts: requestedArtifacts,
      },
    );

    expect(received).toEqual({
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 2,
      height: 1,
      artifacts: requestedArtifacts,
    });
    expect(Object.isFrozen(received)).toBe(true);
    expect(
      received?.kind === "artifact-capture-v2" && Object.isFrozen(received.artifacts),
    ).toBe(true);
    expect(
      received?.kind === "artifact-capture-v2" &&
      received.artifacts.every((artifact) => Object.isFrozen(artifact)),
    ).toBe(true);
    expect(result.kind).toBe(STUDIO_BG3D_ARTIFACT_CAPTURE_KIND);
    if (result.kind !== STUDIO_BG3D_ARTIFACT_CAPTURE_KIND) {
      throw new Error("Expected an admitted v2 artifact capture.");
    }
    expect(result.artifacts[0].data).not.toBe(rendererBeauty);
    expect(result.artifacts[1].data).not.toBe(rendererDepth);
    rendererBeauty[0] = 255;
    rendererDepth[0] = 1;
    requestedArtifacts.pop();
    expect(result.artifacts[0].data[0]).toBe(17);
    expect(result.artifacts[1].data[0]).toBe(0.25);
    expect(received?.kind === "artifact-capture-v2" && received.artifacts).toHaveLength(2);
    expect(structuredClone(result)).toEqual(result);
    await registry.dispose();
  });

  it("fails v2 artifact capture closed on capability, request, and result mismatches", async () => {
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );
    const validRequest = {
      kind: "artifact-capture-v2" as const,
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 2,
      height: 1,
      artifacts: [
        { kind: "beauty" as const, profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE },
        { kind: "depth" as const, profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
      ],
    };

    const withoutCapabilityRun = vi.fn(async () => artifactCaptureResultV2([]));
    const withoutCapability: StudioBg3dRuntimeAdapter = {
      runtimeId: "three-webgl",
      capabilities: new Set(["capture-rgba-depth"]),
      runIsolated: withoutCapabilityRun,
      dispose() {},
    };
    const capabilityRegistry = new StudioBg3dRuntimeAdapterRegistry();
    capabilityRegistry.register(withoutCapability);
    await expect(capabilityRegistry.run(
      "three-webgl",
      "missing-capability",
      snapshot,
      validRequest,
    )).rejects.toMatchObject({ code: "capability-unavailable" });
    expect(withoutCapabilityRun).not.toHaveBeenCalled();
    await capabilityRegistry.dispose();

    const adapterRun = vi.fn(async (job: StudioBg3dRuntimeAdapterJob) => {
      if (job.id === "legacy-result") {
        return { kind: "capture" as const, width: 2, height: 1, rgba: new Uint8Array(8) };
      }
      if (job.id === "missing-pass") {
        return artifactCaptureResultV2([{
          kind: "beauty",
          width: 2,
          height: 1,
          profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
          data: new Uint8Array(8),
        }]);
      }
      if (job.id === "extra-pass") {
        return artifactCaptureResultV2([
          {
            kind: "beauty",
            width: 2,
            height: 1,
            profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
            data: new Uint8Array(8),
          },
          {
            kind: "depth",
            width: 2,
            height: 1,
            profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
            data: new Float32Array(2),
          },
          {
            kind: "normal",
            width: 2,
            height: 1,
            profile: STUDIO_BG3D_NORMAL_PROFILE,
            coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
            packing: STUDIO_BG3D_NORMAL_PACKING,
            data: new Uint8Array(4),
          },
        ]);
      }
      if (job.id === "wrong-size") {
        return artifactCaptureResultV2([
          {
            kind: "beauty",
            width: 1,
            height: 2,
            profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
            data: new Uint8Array(8),
          },
          {
            kind: "depth",
            width: 1,
            height: 2,
            profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
            data: new Float32Array(2),
          },
        ], 1, 2);
      }
      return artifactCaptureResultV2([
        {
          kind: "beauty",
          width: 2,
          height: 1,
          profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
          data: new Uint8Array(8),
        },
        {
          kind: "depth",
          width: 2,
          height: 1,
          profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
          data: new Float32Array([0, Number.NaN]),
        },
      ]);
    });
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register({
      runtimeId: "babylon-webgl-lab",
      capabilities: new Set(["capture-rgba-depth", "multi-artifact-capture"]),
      runIsolated: adapterRun,
      dispose() {},
    });

    const malformedRequest = {
      ...validRequest,
      artifacts: [
        { kind: "beauty", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE },
      ],
    } as unknown as StudioBg3dSpecialistRequest;
    await expect(registry.run(
      "babylon-webgl-lab",
      "malformed-request",
      snapshot,
      malformedRequest,
    )).rejects.toMatchObject({ code: "invalid-request" });
    expect(adapterRun).not.toHaveBeenCalled();

    for (const id of [
      "legacy-result",
      "missing-pass",
      "extra-pass",
      "wrong-size",
      "invalid-depth",
    ]) {
      await expect(registry.run(
        "babylon-webgl-lab",
        id,
        snapshot,
        validRequest,
      )).rejects.toMatchObject({ code: "invalid-result" });
    }
    await registry.dispose();
  });

  it("snapshots an exact frozen physics DTO and rejects hostile request getters", async () => {
    let received: StudioBg3dRuntimeAdapterJob["request"] | undefined;
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgl-lab",
      capabilities: new Set(["physics"]),
      async runIsolated(job) {
        received = job.request;
        return { kind: "metrics", values: { accepted: true } };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, new Map());
    const request = {
      kind: "physics-preview" as const,
      durationSeconds: 1,
      stepSeconds: 1 / 60,
      gravity: [0, -9.8, 0] as const,
      world: { bodies: [], solverSubsteps: 2, allowSleep: true },
      injected: new Uint8Array(1_024),
    };

    await expect(registry.run("babylon-webgl-lab", "exact-physics", snapshot, request))
      .resolves.toMatchObject({ kind: "metrics" });
    expect(received).not.toHaveProperty("injected");
    expect(Object.isFrozen(received)).toBe(true);
    expect(received?.kind === "physics-preview" && Object.isFrozen(received.gravity)).toBe(true);
    expect(received?.kind === "physics-preview" && Object.isFrozen(received.world)).toBe(true);

    const hostile = {
      kind: "physics-preview" as const,
      durationSeconds: 1,
      stepSeconds: 1 / 60,
      gravity: [0, -9.8, 0] as const,
      get world(): never { throw new Error("hostile getter"); },
    };
    await expect(registry.run("babylon-webgl-lab", "hostile", snapshot, hostile))
      .rejects.toMatchObject({ code: "invalid-request" });
    await registry.dispose();
  });

  it("rejects physics previews whose bounded fields still exceed the total work budget", async () => {
    const adapter = metricsAdapter();
    const runIsolated = vi.spyOn(adapter, "runIsolated");
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const crowdedDocument = normalizeStudioBg3dSceneDocument({
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      nodes: Array.from({ length: 256 }, (_, index) => ({
        id: `node-${index}`,
        parentId: null,
        name: `Node ${index}`,
        kind: "primitive" as const,
        primitiveKind: "box" as const,
        color: "#ffffff",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
      })),
    });
    const snapshot = createStudioBg3dRuntimeSnapshot(crowdedDocument, new Map());

    await expect(registry.run("babylon-webgl-lab", "over-budget", snapshot, {
      kind: "physics-preview",
      durationSeconds: 60,
      stepSeconds: 1 / 240,
      gravity: [0, -9.8, 0],
    })).rejects.toMatchObject({ code: "invalid-request" });
    expect(runIsolated).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("serializes same-engine jobs and rejects malformed adapter output", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: (() => void)[] = [];
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "filament-webgl-lab",
      capabilities: new Set(["material-conformance"]),
      async runIsolated() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return { kind: "capture", width: 2, height: 2, rgba: new Uint8Array(3) };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, new Map());
    const first = registry.run(
      "filament-webgl-lab", "first", snapshot,
      { kind: "material-conformance", width: 2, height: 2 },
    );
    const second = registry.run(
      "filament-webgl-lab", "second", snapshot,
      { kind: "material-conformance", width: 2, height: 2 },
    );
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await expect(first).rejects.toMatchObject({ code: "invalid-result" });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();
    await expect(second).rejects.toMatchObject({ code: "invalid-result" });
    expect(maximumActive).toBe(1);
    await registry.dispose();
  });

  it("rejects structurally valid snapshots that did not cross the trusted factory boundary", async () => {
    const adapter = metricsAdapter();
    const runIsolated = vi.spyOn(adapter, "runIsolated");
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );
    const forgedSnapshot = { ...snapshot };

    await expect(registry.run(
      "babylon-webgl-lab",
      "forged",
      forgedSnapshot,
      { kind: "runtime-metrics" },
    )).rejects.toMatchObject({ code: "invalid-snapshot" });
    expect(runIsolated).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("enforces a 16-megapixel budget for raster requests and adapter results", async () => {
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgl-lab",
      capabilities: new Set(["capture-rgba-depth"]),
      async runIsolated() {
        return {
          kind: "capture",
          width: 4_097,
          height: 4_097,
          rgba: new Uint8Array(),
        };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    await expect(registry.run(
      "babylon-webgl-lab",
      "oversized-request",
      snapshot,
      { kind: "capture", width: 4_097, height: 4_097 },
    )).rejects.toMatchObject({ code: "invalid-request" });
    await expect(registry.run(
      "babylon-webgl-lab",
      "oversized-result",
      snapshot,
      { kind: "capture", width: 64, height: 64 },
    )).rejects.toMatchObject({ code: "invalid-result" });
    await registry.dispose();
  });

  it("snapshots adapter capabilities at registration time", async () => {
    const capabilities = new Set<StudioBg3dRuntimeCapability>(["physics"]);
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgl-lab",
      capabilities,
      async runIsolated() {
        return { kind: "metrics", values: { accepted: true } };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    capabilities.delete("physics");
    capabilities.add("material-conformance");

    await expect(registry.run(
      "babylon-webgl-lab",
      "retained-capability",
      snapshot,
      { kind: "physics-preview", durationSeconds: 1, stepSeconds: 1 / 60, gravity: [0, -9.8, 0] },
    )).resolves.toEqual({ kind: "metrics", values: { accepted: true } });
    await expect(registry.run(
      "babylon-webgl-lab",
      "injected-capability",
      snapshot,
      { kind: "material-conformance", width: 64, height: 64 },
    )).rejects.toMatchObject({ code: "capability-unavailable" });
    await registry.dispose();
  });

  it("bounds transform positions, normalizes quaternions, and rejects unsafe result values", async () => {
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgl-lab",
      capabilities: new Set(),
      async runIsolated(job) {
        if (job.id === "normalized") {
          return {
            kind: "transforms",
            samples: [{ nodeId: "hero", position: [1, 2, 3], rotation: [0, 0, 0, 2] }],
          };
        }
        if (job.id === "position-overflow") {
          return {
            kind: "transforms",
            samples: [{
              nodeId: "hero",
              position: [1_000_001, 0, 0],
              rotation: [0, 0, 0, 1],
            }],
          };
        }
        if (job.id === "zero-quaternion") {
          return {
            kind: "transforms",
            samples: [{ nodeId: "hero", position: [0, 0, 0], rotation: [0, 0, 0, 0] }],
          };
        }
        return { kind: "metrics", values: { message: "x".repeat(4_097) } };
      },
      dispose() {},
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );

    await expect(registry.run(
      "babylon-webgl-lab", "normalized", snapshot, { kind: "runtime-metrics" },
    )).resolves.toEqual({
      kind: "transforms",
      samples: [{ nodeId: "hero", position: [1, 2, 3], rotation: [0, 0, 0, 1] }],
    });
    await expect(registry.run(
      "babylon-webgl-lab", "position-overflow", snapshot, { kind: "runtime-metrics" },
    )).rejects.toMatchObject({ code: "invalid-result" });
    await expect(registry.run(
      "babylon-webgl-lab", "zero-quaternion", snapshot, { kind: "runtime-metrics" },
    )).rejects.toMatchObject({ code: "invalid-result" });
    await expect(registry.run(
      "babylon-webgl-lab", "oversized-metric", snapshot, { kind: "runtime-metrics" },
    )).rejects.toMatchObject({ code: "invalid-result" });
    await registry.dispose();
  });

  it("drains active and queued jobs before disposing the runtime adapter", async () => {
    const releases: (() => void)[] = [];
    const entered: string[] = [];
    const disposeAdapter = vi.fn();
    const adapter: StudioBg3dRuntimeAdapter = {
      runtimeId: "babylon-webgl-lab",
      capabilities: new Set(),
      async runIsolated(job) {
        entered.push(job.id);
        await new Promise<void>((resolve) => releases.push(resolve));
        return { kind: "metrics", values: { id: job.id } };
      },
      dispose: disposeAdapter,
    };
    const registry = new StudioBg3dRuntimeAdapterRegistry();
    registry.register(adapter);
    const snapshot = createStudioBg3dRuntimeSnapshot(
      DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      new Map(),
    );
    const first = registry.run(
      "babylon-webgl-lab", "first", snapshot, { kind: "runtime-metrics" },
    );
    const second = registry.run(
      "babylon-webgl-lab", "second", snapshot, { kind: "runtime-metrics" },
    );

    await vi.waitFor(() => expect(entered).toEqual(["first"]));
    const disposing = registry.dispose();
    await Promise.resolve();
    expect(disposeAdapter).not.toHaveBeenCalled();

    releases.shift()?.();
    await vi.waitFor(() => expect(entered).toEqual(["first", "second"]));
    expect(disposeAdapter).not.toHaveBeenCalled();
    releases.shift()?.();

    await expect(first).resolves.toEqual({ kind: "metrics", values: { id: "first" } });
    await expect(second).resolves.toEqual({ kind: "metrics", values: { id: "second" } });
    await disposing;
    expect(disposeAdapter).toHaveBeenCalledOnce();
  });
});
