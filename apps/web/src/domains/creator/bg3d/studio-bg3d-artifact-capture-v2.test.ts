import { describe, expect, it } from "vitest";

import {
  normalizeStudioBg3dArtifactCaptureRequestV2,
  normalizeStudioBg3dArtifactCaptureResultV2,
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DATA_BYTES,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  STUDIO_BG3D_STABLE_ID_PROFILE,
  STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
} from "./studio-bg3d-artifact-capture-v2";

function capture(
  artifacts: readonly unknown[],
  width = 2,
  height = 1,
): Record<string, unknown> {
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width,
    height,
    artifacts,
  };
}

it("admits SceneDocument-compatible tilde stable IDs", () => {
  const result = normalizeStudioBg3dArtifactCaptureResultV2(capture([{
    kind: "object-id",
    width: 1,
    height: 1,
    profile: STUDIO_BG3D_STABLE_ID_PROFILE,
    legend: [{ id: 1, stableId: "obj/node~variant", label: "Node variant" }],
    data: Uint32Array.from([1]),
  }], 1, 1));

  expect(result?.artifacts[0]).toMatchObject({
    kind: "object-id",
    legend: [{ id: 1, stableId: "obj/node~variant", label: "Node variant" }],
  });
});

function beauty(
  data: unknown = new Uint8Array(8),
  width = 2,
  height = 1,
): Record<string, unknown> {
  return {
    kind: "beauty",
    width,
    height,
    profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
    data,
  };
}

function everyArtifact(width = 2, height = 1): Record<string, unknown>[] {
  const pixels = width * height;
  return [
    beauty(new Uint8Array(pixels * 4), width, height),
    {
      kind: "depth",
      width,
      height,
      profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
      data: new Float32Array(pixels).fill(0.5),
    },
    {
      kind: "normal",
      width,
      height,
      profile: STUDIO_BG3D_NORMAL_PROFILE,
      coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
      packing: STUDIO_BG3D_NORMAL_PACKING,
      data: new Uint8Array(pixels * 2).fill(128),
    },
    {
      kind: "object-id",
      width,
      height,
      profile: STUDIO_BG3D_STABLE_ID_PROFILE,
      legend: pixels > 1
        ? [
            { id: 2, stableId: "scene/chair", label: "Chair" },
            { id: 1, stableId: "scene/hero", label: "Hero" },
          ]
        : [{ id: 1, stableId: "scene/hero", label: "Hero" }],
      data: pixels > 1
        ? Uint32Array.from({ length: pixels }, (_, index) => index % 2 + 1)
        : new Uint32Array([1]),
    },
    {
      kind: "material-id",
      width,
      height,
      profile: STUDIO_BG3D_STABLE_ID_PROFILE,
      legend: [{ id: 7, stableId: "material/skin", label: "Skin" }],
      data: new Uint32Array(pixels).fill(7),
    },
    {
      kind: "shadow",
      width,
      height,
      profile: STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
      data: new Uint8Array(pixels).fill(64),
    },
    {
      kind: "ambient-occlusion",
      width,
      height,
      profile: STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
      data: new Uint8Array(pixels).fill(96),
    },
    {
      kind: "emission",
      width,
      height,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array(pixels * 4).fill(32),
    },
    {
      kind: "velocity",
      width,
      height,
      profile: STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
      data: new Float32Array(pixels * 2).fill(2.5),
    },
  ];
}

function replaceData(
  artifact: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  return { ...artifact, data };
}

describe("normalizeStudioBg3dArtifactCaptureRequestV2", () => {
  it("snapshots a bounded, unique artifact/profile request", () => {
    const requested = everyArtifact().map(({ kind, profile }) => ({ kind, profile }));
    const input = {
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 2,
      height: 1,
      artifacts: requested,
    };

    const normalized = normalizeStudioBg3dArtifactCaptureRequestV2(input);

    expect(normalized).toEqual(input);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.artifacts)).toBe(true);
    expect(normalized?.artifacts.every((artifact) => Object.isFrozen(artifact))).toBe(true);
    requested.pop();
    expect(normalized?.artifacts).toHaveLength(9);
  });

  it("fails closed on unknown keys, mismatched profiles, duplicates, and excessive output plans", () => {
    const base = {
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: 2,
      height: 1,
      artifacts: [{ kind: "beauty", profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }],
    };
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      extra: true,
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      artifacts: [{ ...base.artifacts[0], extra: true }],
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      artifacts: [{ kind: "beauty", profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE }],
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      artifacts: [base.artifacts[0], base.artifacts[0]],
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      artifacts: [],
    })).toBeNull();

    const allArtifacts = everyArtifact().map(({ kind, profile }) => ({ kind, profile }));
    expect(normalizeStudioBg3dArtifactCaptureRequestV2({
      ...base,
      width: 4_096,
      height: 4_096,
      artifacts: allArtifacts,
    })).toBeNull();
  });
});

describe("normalizeStudioBg3dArtifactCaptureResultV2", () => {
  it("accepts every renderer-neutral artifact and returns an owned clone-safe snapshot", () => {
    const inputArtifacts = everyArtifact();
    const inputBeauty = inputArtifacts[0].data as Uint8Array;
    inputBeauty[0] = 211;

    const result = normalizeStudioBg3dArtifactCaptureResultV2(capture(inputArtifacts));

    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected the complete artifact capture to be admitted.");
    expect(result.artifacts).toHaveLength(9);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(result.artifacts.every((artifact) => Object.isFrozen(artifact))).toBe(true);
    expect(result.artifacts[0].data).not.toBe(inputBeauty);
    expect(result.artifacts[0].data[0]).toBe(211);

    const objectIds = result.artifacts.find((artifact) => artifact.kind === "object-id");
    expect(objectIds?.legend.map(({ id }) => id)).toEqual([1, 2]);
    expect(Object.isFrozen(objectIds?.legend)).toBe(true);
    expect(Object.isFrozen(objectIds?.legend[0])).toBe(true);

    inputBeauty[0] = 0;
    (inputArtifacts[3].legend as { id: number; stableId: string; label: string }[])[0].label =
      "Changed";
    expect(result.artifacts[0].data[0]).toBe(211);
    expect(objectIds?.legend.find(({ id }) => id === 2)?.label).toBe("Chair");

    const cloned = structuredClone(result);
    expect(cloned).toEqual(result);
    expect(cloned.artifacts[0].data).toBeInstanceOf(Uint8Array);
    expect(cloned.artifacts.find((artifact) => artifact.kind === "depth")?.data)
      .toBeInstanceOf(Float32Array);
    expect(cloned.artifacts.find((artifact) => artifact.kind === "object-id")?.data)
      .toBeInstanceOf(Uint32Array);
  });

  it("keeps beauty optional and accepts a bounded single-artifact result", () => {
    const depth = {
      kind: "depth",
      width: 1,
      height: 1,
      profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
      data: new Float32Array([0.25]),
    };

    const result = normalizeStudioBg3dArtifactCaptureResultV2(capture([depth], 1, 1));

    expect(result?.artifacts).toHaveLength(1);
    expect(result?.artifacts[0]).toMatchObject({ kind: "depth", width: 1, height: 1 });
  });

  it("fails closed on unknown fields, unknown kinds, duplicate kinds, and legacy shapes", () => {
    expect(normalizeStudioBg3dArtifactCaptureResultV2({
      ...capture([beauty()]),
      extra: true,
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      ...beauty(),
      extra: true,
    }]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      ...beauty(),
      kind: "renderer-private-pass",
    }]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(),
      beauty(),
    ]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2({
      width: 2,
      height: 1,
      rgba: new Uint8Array(8),
    })).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([]))).toBeNull();
  });

  it("returns null rather than propagating hostile property access", () => {
    const input = capture([beauty()]);
    Object.defineProperty(input, "width", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });

    expect(normalizeStudioBg3dArtifactCaptureResultV2(input)).toBeNull();
  });

  it("validates top-level and per-artifact dimensions independently", () => {
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture(
      [beauty(new Uint8Array(4), 1, 1)],
      2,
      1,
    ))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([beauty()], 0, 1))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture(
      [beauty()],
      STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION + 1,
      1,
    ))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture(
      [beauty()],
      STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION,
      STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION,
    ))).toBeNull();
  });

  it("rejects an aggregate artifact plan over the byte budget before reading large buffers", () => {
    const width = 4_096;
    const height = 4_096;
    const artifacts = everyArtifact(1, 1).map((artifact) => ({
      ...artifact,
      width,
      height,
    }));

    expect(STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DATA_BYTES).toBe(256 * 1024 * 1024);
    expect(normalizeStudioBg3dArtifactCaptureResultV2(
      capture(artifacts, width, height),
    )).toBeNull();
  });

  it("rejects wrong, aliased, oversized, subclassed, and shared typed-array storage", () => {
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(new Uint8ClampedArray(8)),
    ]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(new Uint8Array(7)),
    ]))).toBeNull();

    const offsetView = new Uint8Array(new ArrayBuffer(9), 1, 8);
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(offsetView),
    ]))).toBeNull();

    const oversizedBackingStore = new Uint8Array(new ArrayBuffer(9), 0, 8);
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(oversizedBackingStore),
    ]))).toBeNull();

    class UnsafeUint8Array extends Uint8Array {}
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      beauty(new UnsafeUint8Array(8)),
    ]))).toBeNull();

    if (typeof SharedArrayBuffer === "function") {
      expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
        beauty(new Uint8Array(new SharedArrayBuffer(8))),
      ]))).toBeNull();
    }
  });

  it("rejects resizable ArrayBuffers when the runtime exposes them", () => {
    type ResizableArrayBufferConstructor = {
      new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer;
    };
    let buffer: ArrayBuffer | null = null;
    try {
      const Constructor = ArrayBuffer as unknown as ResizableArrayBufferConstructor;
      const candidate = new Constructor(8, { maxByteLength: 16 });
      if ((candidate as ArrayBuffer & { readonly resizable?: boolean }).resizable === true) {
        buffer = candidate;
      }
    } catch {
      // The current JS runtime does not implement resizable ArrayBuffer yet.
    }

    if (buffer) {
      expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
        beauty(new Uint8Array(buffer)),
      ]))).toBeNull();
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
    1.01,
  ])("rejects invalid normalized depth value %s", (value) => {
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      kind: "depth",
      width: 1,
      height: 1,
      profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
      data: new Float32Array([value]),
    }], 1, 1))).toBeNull();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1_000_001,
    1_000_001,
  ])("rejects invalid velocity component %s", (value) => {
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      kind: "velocity",
      width: 1,
      height: 1,
      profile: STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
      data: new Float32Array([value, 0]),
    }], 1, 1))).toBeNull();
  });

  it("requires the canonical normal profile, coordinate space, packing, and byte length", () => {
    const normal = everyArtifact()[2];

    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      ...normal,
      coordinateSpace: "world",
    }]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      ...normal,
      packing: "rgb8",
    }]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
      ...normal,
      profile: "normal-renderer-dependent",
    }]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      replaceData(normal, new Uint8Array(3)),
    ]))).toBeNull();
  });

  it("requires stable, unique, referentially complete object and material legends", () => {
    const objectIds = everyArtifact()[3];
    const cases: Record<string, unknown>[][] = [
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: "Hero" },
        { id: 1, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/shared", label: "Hero" },
        { id: 2, stableId: "scene/shared", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 0, stableId: "scene/background", label: "Background" },
        { id: 1, stableId: "scene/hero", label: "Hero" },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "bad stable id", label: "Hero" },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: " Hero " },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: "Hero\nInjected" },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: "Hero\u200bInjected" },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: "Hero", extra: true },
        { id: 2, stableId: "scene/chair", label: "Chair" },
      ] }],
      [{ ...objectIds, legend: [
        { id: 1, stableId: "scene/hero", label: "Hero" },
      ] }],
    ];

    for (const artifacts of cases) {
      expect(normalizeStudioBg3dArtifactCaptureResultV2(capture(artifacts))).toBeNull();
    }
  });

  it("independently enforces profiles and typed-array families for every artifact family", () => {
    for (const artifact of everyArtifact()) {
      expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([{
        ...artifact,
        profile: "unknown-profile",
      }]))).toBeNull();
    }

    const depth = everyArtifact()[1];
    const objectIds = everyArtifact()[3];
    const velocity = everyArtifact()[8];
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      replaceData(depth, new Uint32Array(2)),
    ]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      replaceData(objectIds, new Float32Array(2)),
    ]))).toBeNull();
    expect(normalizeStudioBg3dArtifactCaptureResultV2(capture([
      replaceData(velocity, new Float64Array(4)),
    ]))).toBeNull();
  });
});
