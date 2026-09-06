import { describe, it, expect } from "vitest";

import {
  createEmptyToon3DPackage,
  serializeToon3DPackage,
  deserializeToon3DPackage,
  validateToon3DPackage,
} from "./studio-3d-package";

describe("Native .toon3d Project Archive Format", () => {
  it("creates a valid empty .toon3d package", () => {
    const pkg = createEmptyToon3DPackage("에피소드 1화 세트장", "김작가");
    expect(pkg.manifest.format).toBe("toon3d");
    expect(pkg.manifest.projectName).toBe("에피소드 1화 세트장");
    expect(pkg.manifest.creator).toBe("김작가");
    expect(pkg.scene.objects.length).toBeGreaterThan(0);
    expect(pkg.storyboard.shots["shot-1"]).toBeDefined();

    const issues = validateToon3DPackage(pkg);
    expect(issues.filter((i) => i.severity === "error").length).toBe(0);
  });

  it("serializes and deserializes .toon3d package preserving TypedArrays and geometry", () => {
    const pkg = createEmptyToon3DPackage("테스트 프로젝트");
    pkg.geometries["mesh-cube"] = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const json = serializeToon3DPackage(pkg);
    expect(json).toContain('"format": "toon3d"');

    const restored = deserializeToon3DPackage(json);
    expect(restored.manifest.projectName).toBe("테스트 프로젝트");
    expect(restored.geometries["mesh-cube"]).toBeDefined();
    expect(restored.geometries["mesh-cube"].positions instanceof Float32Array).toBe(true);
    expect(restored.geometries["mesh-cube"].indices instanceof Uint32Array).toBe(true);
    expect(restored.geometries["mesh-cube"].positions.length).toBe(9);
    expect(restored.geometries["mesh-cube"].indices[1]).toBe(1);
  });

  it("validates missing mandatory fields in damaged package", () => {
    const invalidPkg = {
      manifest: { format: "invalid" },
      scene: {},
    } as unknown as Parameters<typeof validateToon3DPackage>[0];

    const issues = validateToon3DPackage(invalidPkg);
    expect(issues.some((i) => i.field === "manifest.format")).toBe(true);
    expect(issues.some((i) => i.field === "scene.objects")).toBe(true);
  });
});
