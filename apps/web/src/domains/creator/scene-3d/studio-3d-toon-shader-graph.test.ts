import { describe, it, expect } from "vitest";

import { Studio3DToonShaderGraph } from "./studio-3d-toon-shader-graph";

describe("Studio3DToonShaderGraph", () => {
  it("evaluates sharp 1-step and soft 2-step cel diffuse shading correctly", () => {
    const graph = new Studio3DToonShaderGraph({ celRamp: "1-step-sharp", shadowThreshold: 0.5 });

    // Lit facing light: normal [0, 1, 0], light [0, 1, 0] -> NdotL = 1.0 -> raw = 1.0
    const lit = graph.evaluateShading({
      normal: [0, 1, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 0, 1],
    });
    expect(lit.diffuseIntensity).toBe(1.0);
    expect(lit.isShadow).toBe(false);

    // Dark opposite light: normal [0, -1, 0], light [0, 1, 0] -> NdotL = -1.0 -> raw = 0.0
    const shadow = graph.evaluateShading({
      normal: [0, -1, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 0, 1],
    });
    expect(shadow.diffuseIntensity).toBe(0.0);
    expect(shadow.isShadow).toBe(true);
  });

  it("evaluates 3-step gradient and halftone stipple ramps", () => {
    const gradientGraph = new Studio3DToonShaderGraph({ celRamp: "3-step-gradient", shadowThreshold: 0.6 });

    const midLit = gradientGraph.evaluateShading({
      normal: [0.707, 0.707, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 0, 1],
    });
    expect([0.0, 0.5, 1.0]).toContain(midLit.diffuseIntensity);

    const stippleGraph = new Studio3DToonShaderGraph({ celRamp: "halftone-stipple", shadowBands: 4 });
    const stippleLit = stippleGraph.evaluateShading({
      normal: [0.5, 0.5, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 0, 1],
    });
    expect(stippleLit.diffuseIntensity).toBeGreaterThanOrEqual(0);
    expect(stippleLit.diffuseIntensity).toBeLessThanOrEqual(1.0);
  });

  it("calculates stylized specular shape glints for anime highlights", () => {
    const graph = new Studio3DToonShaderGraph({
      specularShape: "star",
      specularIntensity: 1.0,
      specularRoughness: 0.05,
    });

    const highlight = graph.evaluateShading({
      normal: [0, 1, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 1, 0], // Eye looking directly down reflection
      uv: [0.5, 0.5], // Center of star
    });

    expect(highlight.specularIntensity).toBeGreaterThan(0.5);
  });

  it("computes anisotropic hair angel ring when hair anisotropy is enabled", () => {
    const graph = new Studio3DToonShaderGraph({
      hairAnisotropyEnabled: true,
      specularIntensity: 1.0,
    });

    const hairHighlight = graph.evaluateShading({
      normal: [0, 0, 1],
      lightDir: [0, 0.7, 0.7],
      viewDir: [0, 0, 1],
      tangent: [1, 0, 0], // Horizontal hair strand tangent
    });

    expect(hairHighlight.specularIntensity).toBeGreaterThan(0);
  });

  it("applies colored rim lighting around grazing angles", () => {
    const graph = new Studio3DToonShaderGraph({
      rimLightIntensity: 0.8,
      rimFresnelPower: 2.0,
    });

    // Perpendicular normal to view direction (grazing edge)
    const rimEdge = graph.evaluateShading({
      normal: [1, 0, 0],
      lightDir: [0, 1, 0],
      viewDir: [0, 0, 1], // N dot V = 0
    });

    expect(rimEdge.rimIntensity).toBeCloseTo(0.8, 2);
  });
});
