import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
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
  type StudioBg3dArtifactCaptureResultV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  StudioBg3dArtifactRasterizationError,
  rasterizeStudioBg3dArtifactCapture,
} from "./studio-bg3d-artifact-rasterization";

function capture(): StudioBg3dArtifactCaptureResultV2 {
  return {
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width: 2,
    height: 1,
    artifacts: [
      {
        kind: "beauty",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
        data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]),
      },
      {
        kind: "depth",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
        data: new Float32Array([0, 1]),
      },
      {
        kind: "normal",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_NORMAL_PROFILE,
        coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
        packing: STUDIO_BG3D_NORMAL_PACKING,
        data: new Uint8Array([128, 128, 255, 128]),
      },
      {
        kind: "object-id",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_STABLE_ID_PROFILE,
        legend: [{ id: 42, stableId: "node:hero", label: "Hero" }],
        data: new Uint32Array([0, 42]),
      },
      {
        kind: "material-id",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_STABLE_ID_PROFILE,
        legend: [{ id: 7, stableId: "material:skin", label: "Skin" }],
        data: new Uint32Array([7, 0]),
      },
      {
        kind: "shadow",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
        data: new Uint8Array([0, 255]),
      },
      {
        kind: "ambient-occlusion",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
        data: new Uint8Array([64, 128]),
      },
      {
        kind: "emission",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
        data: new Uint8Array([0, 128, 255, 255, 64, 0, 0, 128]),
      },
      {
        kind: "velocity",
        width: 2,
        height: 1,
        profile: STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
        data: new Float32Array([0, 0, 20, -10]),
      },
    ],
  };
}

describe("studio-bg3d-artifact-rasterization", () => {
  it("converts beauty, depth and view-space normals into independent RGBA rasters", () => {
    const source = capture();
    const beautyBefore = Array.from(source.artifacts[0]!.data);
    const result = rasterizeStudioBg3dArtifactCapture(source, [
      "beauty",
      "depth",
      "normal",
    ]);

    expect(result.map((raster) => raster.kind)).toEqual(["beauty", "depth", "normal"]);
    expect(Array.from(result[0]!.data)).toEqual(beautyBefore);
    expect(Array.from(result[1]!.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
    expect(result[2]!.data[0]).toBeGreaterThanOrEqual(127);
    expect(result[2]!.data[0]).toBeLessThanOrEqual(129);
    expect(result[2]!.data[1]).toBeGreaterThanOrEqual(127);
    expect(result[2]!.data[1]).toBeLessThanOrEqual(129);
    expect(result[2]!.data[2]).toBe(255);
    expect(result[2]!.data[3]).toBe(255);
    expect(Array.from(source.artifacts[0]!.data)).toEqual(beautyBefore);
    expect(result[0]!.data).not.toBe(source.artifacts[0]!.data);
  });

  it("creates deterministic, collision-free visible colors and a matching stable-ID legend", () => {
    const result = rasterizeStudioBg3dArtifactCapture(capture(), [
      "object-id",
      "material-id",
    ]);
    const objectId = result[0]!;
    const materialId = result[1]!;

    expect(Array.from(objectId.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(objectId.data.slice(4, 7))).not.toEqual([0, 0, 0]);
    expect(objectId.legend).toHaveLength(1);
    expect(objectId.legend?.[0]).toMatchObject({
      id: 42,
      stableId: "node:hero",
      label: "Hero",
    });
    expect(objectId.legend?.[0]?.color).toMatch(/^#[0-9a-f]{6}$/u);
    expect(materialId.legend?.[0]?.color).toBe(objectId.legend?.[0]?.color);
  });

  it("inverts coverage for multiply layers and converts linear emission to sRGB", () => {
    const result = rasterizeStudioBg3dArtifactCapture(capture(), [
      "shadow",
      "ambient-occlusion",
      "emission",
    ]);

    expect(Array.from(result[0]!.data)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    expect(result[1]!.data[0]).toBe(191);
    expect(result[1]!.data[4]).toBe(127);
    expect(result[2]!.data[1]).toBeGreaterThan(180);
    expect(result[2]!.data[1]).toBeLessThan(190);
    expect(result[2]!.data[3]).toBe(255);
    expect(result[2]!.data[7]).toBe(128);
  });

  it("encodes signed velocity with an explicit scale for reversible manifest interpretation", () => {
    const [velocity] = rasterizeStudioBg3dArtifactCapture(capture(), ["velocity"]);

    expect(velocity?.velocityScalePixelsPerSecond).toBe(20);
    expect(Array.from(velocity!.data.slice(0, 4))).toEqual([128, 128, 0, 255]);
    expect(velocity!.data[4]).toBe(255);
    expect(velocity!.data[5]).toBeGreaterThanOrEqual(63);
    expect(velocity!.data[5]).toBeLessThanOrEqual(64);
    expect(velocity!.data[6]).toBe(255);
  });

  it("fails closed for malformed captures and missing requested artifacts", () => {
    const malformed = capture();
    const beauty = malformed.artifacts[0]!;
    const invalid = {
      ...malformed,
      artifacts: [{ ...beauty, data: new Uint8Array(3) }],
    } as StudioBg3dArtifactCaptureResultV2;

    expect(() => rasterizeStudioBg3dArtifactCapture(invalid)).toThrowError(
      new StudioBg3dArtifactRasterizationError("invalid-capture"),
    );
    expect(() => rasterizeStudioBg3dArtifactCapture(capture(), ["beauty", "shadow", "beauty"]))
      .not.toThrow();
    expect(() => rasterizeStudioBg3dArtifactCapture(capture(), ["beauty", "depth", "normal"]))
      .not.toThrow();

    const withoutVelocity = {
      ...capture(),
      artifacts: capture().artifacts.filter((artifact) => artifact.kind !== "velocity"),
    };
    expect(() => rasterizeStudioBg3dArtifactCapture(withoutVelocity, ["velocity"]))
      .toThrowError(new StudioBg3dArtifactRasterizationError("missing-artifact"));
  });
});
