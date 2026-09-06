import { describe, expect, it } from "vitest";

import {
  createStudioLiveSurfaceFilterRecipe,
  renderStudioLiveSurfaceFilterCpuOracle,
  STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
  type StudioLiveSurfaceImage,
} from "./live/studio-live-surface-filter-provider";
import {
  createStudioImpastoHeightProvider,
  type StudioImpastoHeightFieldInput,
} from "./studio-impasto-height-provider";
import {
  createStudioMultiLightSurfaceRecipe,
  renderStudioMultiLightSurfaceCpuOracle,
  STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
  type StudioMultiLightSurfaceImage,
  type StudioMultiLightSurfaceScalarMap,
} from "./studio-multi-light-surface-provider";
import {
  createStudioSpectralPigmentRecipe,
  mixStudioSpectralPigmentRecipe,
  STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT,
} from "./studio-spectral-pigment-mixing-provider";

function spectrum(
  sample: (wavelengthNm: number) => number,
): number[] {
  return Array.from(
    { length: STUDIO_SPECTRAL_PIGMENT_SAMPLE_COUNT },
    (_, index) => sample(400 + index * 10),
  );
}

function image(
  width: number,
  height: number,
  data: Float32Array,
): StudioLiveSurfaceImage {
  return {
    kind: "studio-live-surface-image",
    version: 1,
    width,
    height,
    colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
    data,
  };
}

describe("Studio real-media provider pipeline", () => {
  it("carries spectral pigment through signed impasto into relightable linear pixels", () => {
    const pigmentRecipe = createStudioSpectralPigmentRecipe({
      pigments: [
        {
          id: "warm",
          reflectance: spectrum((wavelength) => (
            wavelength >= 570 ? 0.78 : 0.09
          )),
          weight: 2,
        },
        {
          id: "cool",
          reflectance: spectrum((wavelength) => (
            wavelength <= 510 ? 0.7 : 0.12
          )),
          weight: 1,
        },
      ],
      opticalThickness: 4,
    });
    expect(pigmentRecipe.status).toBe("ready");
    if (pigmentRecipe.status !== "ready") return;
    const pigment = mixStudioSpectralPigmentRecipe(
      pigmentRecipe.recipe,
    ).artifact.displayLinearRgbClamped;

    const width = 9;
    const height = 9;
    const pixelCount = width * height;
    const colors = new Float32Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      colors[index * 4] = 0.08;
      colors[index * 4 + 1] = 0.08;
      colors[index * 4 + 2] = 0.08;
      colors[index * 4 + 3] = 1;
    }
    const field: StudioImpastoHeightFieldInput = {
      width,
      height,
      heights: new Float32Array(pixelCount),
      colors,
      roughness: new Float32Array(pixelCount).fill(0.65),
    };
    const impasto = createStudioImpastoHeightProvider({ epoch: 1 }).apply({
      epoch: 1,
      field,
      depositions: [{
        id: "spectral-dab",
        mode: "add-height",
        x: 4,
        y: 4,
        radius: 3,
        depth: 0.8,
        hardness: 0.15,
        falloff: 1.8,
        flow: 1,
        pressure: 0.9,
        velocity: 0.2,
        expression: {
          pressure: { minimum: 0.15, invert: false, exponent: 1.2 },
        },
        paperStrength: 0,
        textureStrength: 0,
        depthJitter: 0,
        jitterSmoothing: 0,
        seed: 7,
        color: [pigment[0], pigment[1], pigment[2], 1],
        roughness: 0.28,
        plow: { strength: 0.12, radius: 1.5 },
      }],
    });

    const maximumHeight = Math.max(...impasto.field.heights);
    expect(maximumHeight).toBeGreaterThan(0);
    const heightData = new Float32Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      const normalizedHeight = maximumHeight > 0
        ? Math.max(0, impasto.field.heights[index] / maximumHeight)
        : 0;
      heightData[index * 4] = normalizedHeight;
      heightData[index * 4 + 1] = normalizedHeight;
      heightData[index * 4 + 2] = normalizedHeight;
      heightData[index * 4 + 3] = 1;
    }

    const recipe = createStudioLiveSurfaceFilterRecipe({
      heightSource: "separate",
      heightChannel: "red",
      displacement: {
        scaleX: 0,
        scaleY: 0,
        mapMidpoint: 0.5,
        boundaryMode: "clamp",
      },
      lighting: {
        enabled: true,
        surfaceScale: 2.5,
        ambient: 0.18,
        diffuse: 0.82,
        specular: 0.3,
        shininess: 20,
        lightColor: [1, 0.88, 0.72],
        materialColor: [1, 1, 1],
        light: {
          kind: "directional",
          direction: [-0.5, -0.4, 1],
        },
      },
    });
    expect(recipe.status).toBe("ready");
    if (recipe.status !== "ready") return;
    const rendered = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe.recipe,
      source: image(width, height, impasto.field.colors!),
      heightMap: image(width, height, heightData),
    });

    const center = (4 * width + 4) * 4;
    const edge = (4 * width + 1) * 4;
    expect(rendered.image.data[center + 3]).toBe(1);
    expect(rendered.image.data[edge + 3]).toBe(1);
    expect(rendered.image.data.slice(center, center + 3))
      .not.toEqual(rendered.image.data.slice(edge, edge + 3));
    expect(rendered.receipt.heightSource).toBe("separate");
    expect(rendered.receipt.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(impasto.receipt.conservation.conserved).toBe(true);
  });

  it("reuses signed impasto height and roughness in an ordered multi-light rig", () => {
    const width = 7;
    const height = 7;
    const pixels = width * height;
    const colors = new Float32Array(pixels * 4);
    for (let index = 0; index < pixels; index += 1) {
      colors[index * 4] = 0.42;
      colors[index * 4 + 1] = 0.18;
      colors[index * 4 + 2] = 0.08;
      colors[index * 4 + 3] = index % 3 === 0 ? 0.6 : 1;
    }
    const impasto = createStudioImpastoHeightProvider({ epoch: 1 }).apply({
      epoch: 1,
      field: {
        width,
        height,
        heights: new Float32Array(pixels),
        colors,
        roughness: new Float32Array(pixels).fill(0.8),
      },
      depositions: [{
        id: "ridge",
        mode: "add-height",
        x: 3,
        y: 3,
        radius: 2.5,
        depth: 1.4,
        hardness: 0,
        falloff: 2,
        flow: 1,
        pressure: 1,
        velocity: 0,
        paperStrength: 0,
        textureStrength: 0,
        depthJitter: 0,
        jitterSmoothing: 0,
        seed: 11,
        roughness: 0.22,
      }],
    });

    const recipe = createStudioMultiLightSurfaceRecipe({
      height: { source: "separate", scale: 1.8 },
      normal: { source: "height" },
      material: {
        tint: [1, 1, 1],
        diffuseStrength: 0.78,
        specularStrength: 0.52,
        roughness: { source: "map", value: 0.5 },
        metalness: { source: "constant", value: 0.08 },
      },
      ambient: { color: [0.18, 0.25, 0.42], intensity: 0.12 },
      lights: [
        {
          id: "warm-key",
          kind: "spot",
          position: [3, 2, 8],
          direction: [0, 0.1, -1],
          color: [1, 0.64, 0.38],
          intensity: 14,
          attenuation: {
            kind: "smooth-range",
            range: 18,
            minimumDistance: 0.5,
          },
          innerConeDegrees: 24,
          outerConeDegrees: 55,
        },
        {
          id: "cool-rim",
          kind: "directional",
          direction: [-0.5, 0.2, 1],
          color: [0.28, 0.5, 1],
          intensity: 0.75,
        },
      ],
    });
    expect(recipe.status).toBe("ready");
    if (recipe.status !== "ready") return;
    const source: StudioMultiLightSurfaceImage = {
      kind: "studio-multi-light-surface-image",
      version: 1,
      width,
      height,
      colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
      data: impasto.field.colors!,
    };
    const heightMap: StudioMultiLightSurfaceScalarMap = {
      kind: "studio-multi-light-surface-scalar-map",
      version: 1,
      width,
      height,
      semantic: "signed-height",
      data: impasto.field.heights,
    };
    const roughnessMap: StudioMultiLightSurfaceScalarMap = {
      kind: "studio-multi-light-surface-scalar-map",
      version: 1,
      width,
      height,
      semantic: "roughness",
      data: impasto.field.roughness!,
    };
    const rendered = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe.recipe,
      source,
      heightMap,
      roughnessMap,
    });

    const center = (3 * width + 3) * 4;
    const corner = 0;
    expect(rendered.image.data[center + 3]).toBe(source.data[center + 3]);
    expect(rendered.image.data[corner + 3]).toBe(source.data[corner + 3]);
    expect(rendered.image.data.slice(center, center + 3))
      .not.toEqual(rendered.image.data.slice(corner, corner + 3));
    expect(rendered.receipt.rigOrder).toEqual(["warm-key", "cool-rim"]);
    expect(rendered.receipt.evaluationOrder).toEqual([
      "cool-rim",
      "warm-key",
    ]);
    expect(rendered.receipt.roughnessMapHash)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(rendered.receipt.heightMapHash)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
