import { describe, expect, it } from "vitest";

import {
  createStudioMultiLightSurfaceProvider,
  createStudioMultiLightSurfaceRecipe,
  isStudioMultiLightSurfaceContentHash,
  parseStudioMultiLightSurfaceRecipe,
  renderStudioMultiLightSurfaceCpuOracle,
  serializeStudioMultiLightSurfaceRecipe,
  STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
  StudioMultiLightSurfaceError,
} from "./studio-multi-light-surface-provider";

import type {
  StudioMultiLightSurfaceImage,
  StudioMultiLightSurfaceLightInput,
  StudioMultiLightSurfaceNormalMap,
  StudioMultiLightSurfaceRecipe,
  StudioMultiLightSurfaceRecipeInput,
  StudioMultiLightSurfaceScalarMap,
  StudioMultiLightSurfaceScalarSemantic,
} from "./studio-multi-light-surface-provider";

function image(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number, number])[],
): StudioMultiLightSurfaceImage {
  return {
    kind: "studio-multi-light-surface-image",
    version: 1,
    width,
    height,
    colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
    data: new Float32Array(pixels.flat()),
  };
}

function solidImage(
  width: number,
  height: number,
  pixel: readonly [number, number, number, number],
): StudioMultiLightSurfaceImage {
  return image(
    width,
    height,
    Array.from({ length: width * height }, () => pixel),
  );
}

function scalarMap(
  width: number,
  height: number,
  semantic: StudioMultiLightSurfaceScalarSemantic,
  values: readonly number[],
): StudioMultiLightSurfaceScalarMap {
  return {
    kind: "studio-multi-light-surface-scalar-map",
    version: 1,
    width,
    height,
    semantic,
    data: new Float32Array(values),
  };
}

function normalMap(
  width: number,
  height: number,
  values: readonly number[],
): StudioMultiLightSurfaceNormalMap {
  return {
    kind: "studio-multi-light-surface-normal-map",
    version: 1,
    width,
    height,
    space: "surface",
    data: new Float32Array(values),
  };
}

function directional(
  id: string,
  color: readonly [number, number, number] = [1, 1, 1],
  direction: readonly [number, number, number] = [0, 0, 1],
  intensity = 1,
): StudioMultiLightSurfaceLightInput {
  return { id, kind: "directional", direction, color, intensity };
}

function recipe(
  overrides: Readonly<{
    height?: StudioMultiLightSurfaceRecipeInput["height"];
    normal?: StudioMultiLightSurfaceRecipeInput["normal"];
    diffuseStrength?: number;
    specularStrength?: number;
    roughness?: StudioMultiLightSurfaceRecipeInput["material"]["roughness"];
    metalness?: StudioMultiLightSurfaceRecipeInput["material"]["metalness"];
    ambientIntensity?: number;
    lights?: readonly StudioMultiLightSurfaceLightInput[];
  }> = {},
): StudioMultiLightSurfaceRecipe {
  const result = createStudioMultiLightSurfaceRecipe({
    height: overrides.height ?? {
      source: "source",
      channel: "alpha",
      midpoint: 0.5,
      scale: 0,
    },
    normal: overrides.normal ?? { source: "height" },
    material: {
      tint: [1, 1, 1],
      diffuseStrength: overrides.diffuseStrength ?? 1,
      specularStrength: overrides.specularStrength ?? 0,
      roughness: overrides.roughness ?? { source: "constant", value: 0.5 },
      metalness: overrides.metalness ?? { source: "constant", value: 0 },
    },
    ambient: {
      color: [1, 1, 1],
      intensity: overrides.ambientIntensity ?? 0,
    },
    lights: overrides.lights ?? [directional("key")],
  } satisfies StudioMultiLightSurfaceRecipeInput);
  if (result.status !== "ready") throw new Error(result.path);
  return result.recipe;
}

function expectErrorCode(
  action: () => unknown,
  code: StudioMultiLightSurfaceError["code"],
): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioMultiLightSurfaceError);
    expect((error as StudioMultiLightSurfaceError).code).toBe(code);
  }
}

async function expectAsyncErrorCode(
  action: () => Promise<unknown>,
  code: StudioMultiLightSurfaceError["code"],
): Promise<void> {
  try {
    await action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioMultiLightSurfaceError);
    expect((error as StudioMultiLightSurfaceError).code).toBe(code);
  }
}

describe("Studio multi-light surface immutable recipe", () => {
  it("deep-copies, freezes, fingerprints, serializes and parses an ordered rig", () => {
    const direction = [0, 0, 4] as [number, number, number];
    const lights: StudioMultiLightSurfaceLightInput[] = [
      directional("rim", [0.4, 0.6, 1], direction, 1.5),
      {
        id: "fill",
        kind: "point",
        position: [8, 3, 12],
        color: [1, 0.8, 0.6],
        intensity: 3,
        attenuation: {
          kind: "inverse-square",
          range: 64,
          minimumDistance: 1,
        },
      },
    ];
    const created = createStudioMultiLightSurfaceRecipe({
      height: {
        source: "source",
        channel: "luminance",
        midpoint: 0.4,
        scale: 3,
      },
      normal: { source: "height-and-map", strength: 0.25 },
      material: {
        tint: [0.8, 0.9, 1],
        diffuseStrength: 0.75,
        specularStrength: 0.6,
        roughness: { source: "map", value: 0.4 },
        metalness: { source: "constant", value: 0.1 },
      },
      ambient: { color: [0.2, 0.3, 0.5], intensity: 0.15 },
      lights,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    direction[2] = 99;
    lights.reverse();

    expect(created.recipe.lights.map((light) => light.id)).toEqual([
      "rim",
      "fill",
    ]);
    expect(created.recipe.lights[0]).toMatchObject({
      kind: "directional",
      direction: [0, 0, 1],
    });
    expect(Object.isFrozen(created.recipe)).toBe(true);
    expect(Object.isFrozen(created.recipe.lights)).toBe(true);
    expect(Object.isFrozen(created.recipe.material.tint)).toBe(true);
    expect(isStudioMultiLightSurfaceContentHash(
      created.recipe.fingerprint,
    )).toBe(true);

    const serialized = serializeStudioMultiLightSurfaceRecipe(created.recipe);
    expect(serialized).not.toBeNull();
    expect(parseStudioMultiLightSurfaceRecipe(serialized))
      .toEqual(created.recipe);
    expect(parseStudioMultiLightSurfaceRecipe({
      ...created.recipe,
      fingerprint: `sha256:${"f".repeat(64)}`,
    })).toBeNull();
  });

  it("rejects duplicate IDs, malformed cones, unknown fields and non-finite values", () => {
    const base = {
      height: {
        source: "source",
        channel: "alpha",
        midpoint: 0.5,
        scale: 0,
      },
      normal: { source: "height" },
      material: {
        tint: [1, 1, 1],
        diffuseStrength: 1,
        specularStrength: 0,
        roughness: { source: "constant", value: 0.5 },
        metalness: { source: "constant", value: 0 },
      },
      ambient: { color: [1, 1, 1], intensity: 0 },
    } as const;
    expect(createStudioMultiLightSurfaceRecipe({
      ...base,
      lights: [directional("same"), directional("same")],
    }).status).toBe("rejected");
    expect(createStudioMultiLightSurfaceRecipe({
      ...base,
      lights: [{
        id: "spot",
        kind: "spot",
        position: [0, 0, 4],
        direction: [0, 0, -1],
        color: [1, 1, 1],
        intensity: 1,
        attenuation: {
          kind: "smooth-range",
          range: 10,
          minimumDistance: 1,
        },
        innerConeDegrees: 40,
        outerConeDegrees: 20,
      }],
    }).status).toBe("rejected");
    expect(createStudioMultiLightSurfaceRecipe({
      ...base,
      lights: [{
        ...directional("bad"),
        intensity: Number.NaN,
      }],
    }).status).toBe("rejected");
    expect(createStudioMultiLightSurfaceRecipe({
      ...base,
      lights: [directional("key")],
      extra: true,
    }).status).toBe("rejected");
  });
});

describe("Studio multi-light deterministic CPU oracle", () => {
  it("is additive and permutation-stable while preserving the authored rig order", () => {
    const source = solidImage(1, 1, [0.8, 0.6, 0.4, 0.75]);
    const red = directional("red", [1, 0, 0]);
    const blue = directional("blue", [0, 0, 1]);
    const redOnly = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [red] }),
      source,
    });
    const blueOnly = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [blue] }),
      source,
    });
    const redBlueRecipe = recipe({ lights: [red, blue] });
    const blueRedRecipe = recipe({ lights: [blue, red] });
    const redBlue = renderStudioMultiLightSurfaceCpuOracle({
      recipe: redBlueRecipe,
      source,
    });
    const blueRed = renderStudioMultiLightSurfaceCpuOracle({
      recipe: blueRedRecipe,
      source,
    });

    for (let channel = 0; channel < 3; channel += 1) {
      expect(redBlue.image.data[channel]).toBeCloseTo(
        redOnly.image.data[channel]! + blueOnly.image.data[channel]!,
        6,
      );
    }
    expect([...blueRed.image.data]).toEqual([...redBlue.image.data]);
    expect(blueRed.receipt.outputHash).toBe(redBlue.receipt.outputHash);
    expect(redBlueRecipe.fingerprint).not.toBe(blueRedRecipe.fingerprint);
    expect(redBlue.receipt.rigOrder).toEqual(["red", "blue"]);
    expect(blueRed.receipt.rigOrder).toEqual(["blue", "red"]);
    expect(redBlue.receipt.evaluationOrder).toEqual(["blue", "red"]);
    expect(blueRed.receipt.evaluationOrder).toEqual(["blue", "red"]);
  });

  it("applies a smooth spotlight cone", () => {
    const source = solidImage(5, 1, [1, 1, 1, 1]);
    const spot: StudioMultiLightSurfaceLightInput = {
      id: "spot",
      kind: "spot",
      position: [2, 0, 2],
      direction: [0, 0, -1],
      color: [1, 1, 1],
      intensity: 1,
      attenuation: {
        kind: "smooth-range",
        range: 10,
        minimumDistance: 0.5,
      },
      innerConeDegrees: 10,
      outerConeDegrees: 30,
    };
    const output = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [spot] }),
      source,
    }).image.data;

    expect(output[2 * 4]).toBeGreaterThan(0.5);
    expect(output[0]).toBe(0);
    expect(output[4 * 4]).toBe(0);
  });

  it("supports inverse-square and smooth-range attenuation", () => {
    const source = solidImage(1, 1, [1, 1, 1, 1]);
    const makePoint = (
      id: string,
      z: number,
      kind: "inverse-square" | "smooth-range",
    ): StudioMultiLightSurfaceLightInput => ({
      id,
      kind: "point",
      position: [0, 0, z],
      color: [1, 1, 1],
      intensity: 4,
      attenuation: { kind, range: 20, minimumDistance: 1 },
    });
    const inverseNear = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [makePoint("near", 2, "inverse-square")] }),
      source,
    }).image.data[0]!;
    const inverseFar = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [makePoint("far", 8, "inverse-square")] }),
      source,
    }).image.data[0]!;
    const smoothNear = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [makePoint("near", 2, "smooth-range")] }),
      source,
    }).image.data[0]!;
    const smoothFar = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({ lights: [makePoint("far", 8, "smooth-range")] }),
      source,
    }).image.data[0]!;

    expect(inverseNear).toBeGreaterThan(inverseFar);
    expect(smoothNear).toBeGreaterThan(smoothFar);
  });

  it("uses roughness and metalness maps in its bounded specular response", () => {
    const source = solidImage(2, 1, [0.8, 0.5, 0.2, 1]);
    const roughness = scalarMap(2, 1, "roughness", [0.2, 1]);
    const metalness = scalarMap(1, 1, "metalness", [0.5]);
    const output = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({
        diffuseStrength: 0,
        specularStrength: 1,
        roughness: { source: "map", value: 0.5 },
        metalness: { source: "map", value: 0 },
        lights: [directional("gloss", [1, 1, 1], [0.1, 0, 0.995])],
      }),
      source,
      roughnessMap: roughness,
      metalnessMap: metalness,
    });

    expect(output.image.data[0]).toBeGreaterThan(output.image.data[4]!);
    expect(output.receipt.roughnessMapHash).toMatch(/^sha256:/u);
    expect(output.receipt.metalnessMapHash).toMatch(/^sha256:/u);
  });

  it("resamples signed height and normal maps of different resolutions", () => {
    const source = solidImage(4, 2, [0.7, 0.7, 0.7, 1]);
    const height = scalarMap(2, 1, "signed-height", [-0.5, 0.5]);
    const normals = normalMap(1, 2, [
      0, 0, 1,
      0.6, 0, 0.8,
    ]);
    const output = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({
        height: { source: "separate", scale: 2 },
        normal: { source: "height-and-map", strength: 0.5 },
        lights: [directional("side", [1, 1, 1], [0.7, 0, 0.7])],
      }),
      source,
      heightMap: height,
      normalMap: normals,
    });

    expect(output.image.width).toBe(4);
    expect(output.image.height).toBe(2);
    expect(output.receipt.heightMapHash).toMatch(/^sha256:/u);
    expect(output.receipt.normalMapHash).toMatch(/^sha256:/u);
    expect(new Set([...output.image.data.filter((_, index) => index % 4 === 0)]).size)
      .toBeGreaterThan(1);
  });

  it("preserves every source alpha bit and never aliases or mutates the source", () => {
    const source = image(4, 1, [
      [0.1, 0.2, 0.3, 0],
      [0.4, 0.5, 0.6, 0.25],
      [0.7, 0.8, 0.9, 0.75],
      [1, 0.5, 0.25, 1],
    ]);
    const before = [...source.data];
    const output = renderStudioMultiLightSurfaceCpuOracle({
      recipe: recipe({
        ambientIntensity: 0.2,
        specularStrength: 1,
        lights: [
          directional("key", [1, 0.8, 0.6], [0.2, 0.1, 1], 3),
          directional("rim", [0.2, 0.4, 1], [-0.3, 0, 1], 2),
        ],
      }),
      source,
    });

    expect(output.image.data).not.toBe(source.data);
    expect([...source.data]).toEqual(before);
    expect([3, 7, 11, 15].map((index) => output.image.data[index]))
      .toEqual([0, 0.25, 0.75, 1]);
    expect(output.receipt.alphaContract).toBe(
      "preserve-source-alpha-exactly",
    );
  });

  it("is deterministic across tile sizes and reports honest resource work", () => {
    const source = solidImage(5, 3, [0.4, 0.6, 0.8, 0.9]);
    const input = {
      recipe: recipe({
        ambientIntensity: 0.1,
        lights: [
          directional("b", [0.5, 0.7, 1], [0.2, 0.1, 1], 2),
          directional("a", [1, 0.7, 0.4], [-0.3, 0.1, 1], 1.5),
        ],
      }),
      source,
    };
    const smallTiles = renderStudioMultiLightSurfaceCpuOracle(
      input,
      { tileEdge: 1 },
    );
    const largeTiles = renderStudioMultiLightSurfaceCpuOracle(
      input,
      { tileEdge: 64 },
    );

    expect([...smallTiles.image.data]).toEqual([...largeTiles.image.data]);
    expect(smallTiles.receipt.outputHash).toBe(largeTiles.receipt.outputHash);
    expect(smallTiles.receipt.tileCount).toBe(15);
    expect(largeTiles.receipt.tileCount).toBe(1);
    expect(smallTiles.receipt.haloPixels).toBe(1);
    expect(smallTiles.receipt.workUnits).toBe(5 * 3 * (2 + 8));
    expect(smallTiles.receipt.residentBytes).toBe(
      source.data.byteLength * 2,
    );
  });

  it("fails closed for missing, unexpected, semantically wrong and non-finite maps", () => {
    const source = solidImage(1, 1, [1, 1, 1, 1]);
    const separateRecipe = recipe({
      height: { source: "separate", scale: 1 },
    });
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle({
        recipe: separateRecipe,
        source,
      }),
      "map-required",
    );
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle({
        recipe: recipe(),
        source,
        heightMap: scalarMap(1, 1, "signed-height", [0]),
      }),
      "map-not-allowed",
    );
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle({
        recipe: separateRecipe,
        source,
        heightMap: scalarMap(1, 1, "roughness", [0.5]),
      }),
      "map-required",
    );
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle({
        recipe: separateRecipe,
        source,
        heightMap: scalarMap(1, 1, "signed-height", [Number.NaN]),
      }),
      "invalid-map",
    );
    const invalidSource = solidImage(1, 1, [1, 1, 1, 1]);
    invalidSource.data[0] = Number.POSITIVE_INFINITY;
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle({
        recipe: recipe(),
        source: invalidSource,
      }),
      "invalid-image",
    );
  });

  it("fails closed on work, light and resident-memory budgets and on abort", () => {
    const source = solidImage(4, 4, [1, 1, 1, 1]);
    const input = { recipe: recipe(), source };
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle(
        input,
        { maximumWorkUnits: 1 },
      ),
      "budget-exceeded",
    );
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle(
        input,
        { maximumLights: 1, maximumResidentBytes: 1 },
      ),
      "budget-exceeded",
    );
    const controller = new AbortController();
    controller.abort();
    expectErrorCode(
      () => renderStudioMultiLightSurfaceCpuOracle(
        input,
        { signal: controller.signal },
      ),
      "aborted",
    );
  });
});

describe("Studio multi-light provider lifecycle", () => {
  it("owns admission before request getters and rechecks disposal before commit", async () => {
    const creation = createStudioMultiLightSurfaceProvider();
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const source = solidImage(1, 1, [1, 1, 1, 1]);
    const hostile = {
      requestSequence: 1,
      deviceEpoch: 1,
      recipe: recipe(),
      get source() {
        provider.dispose();
        return source;
      },
    };
    await expect(provider.execute(hostile)).rejects.toMatchObject({
      code: "disposed",
    });
    expect(provider.snapshot()).toMatchObject({
      state: "disposed",
      lastRequestSequence: 0,
    });
  });

  it("snapshots signal once and refuses disposal before final commit", async () => {
    const creation = createStudioMultiLightSurfaceProvider();
    if (creation.status !== "ready") throw new Error(creation.path);
    const provider = creation.provider;
    const nativeSignal = new AbortController().signal;
    let signalReads = 0;
    const hostile = {
      requestSequence: 1,
      deviceEpoch: 1,
      recipe: recipe(),
      source: solidImage(1, 1, [1, 1, 1, 1]),
      get signal() {
        signalReads += 1;
        provider.dispose();
        return nativeSignal;
      },
    };
    await expect(provider.execute(hostile)).rejects.toMatchObject({
      code: "disposed",
    });
    expect(signalReads).toBe(1);
    expect(provider.snapshot()).toMatchObject({
      state: "disposed",
      lastRequestSequence: 0,
    });
  });

  it("enforces sequence and epoch, resets on epoch advance, and fails after dispose", async () => {
    const created = createStudioMultiLightSurfaceProvider({
      initialDeviceEpoch: 7,
      tileEdge: 2,
    });
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const source = solidImage(2, 1, [0.5, 0.6, 0.7, 0.8]);
    const surfaceRecipe = recipe();
    const first = await created.provider.execute({
      requestSequence: 1,
      deviceEpoch: 7,
      recipe: surfaceRecipe,
      source,
    });
    expect(first.complete).toBe(true);
    expect(isStudioMultiLightSurfaceContentHash(first.receiptHash)).toBe(true);
    expect(first.output.data).not.toBe(source.data);

    await expectAsyncErrorCode(
      () => created.provider.execute({
        requestSequence: 1,
        deviceEpoch: 7,
        recipe: surfaceRecipe,
        source,
      }),
      "request-sequence",
    );
    expect(created.provider.advanceDeviceEpoch()).toBe(8);
    await expectAsyncErrorCode(
      () => created.provider.execute({
        requestSequence: 1,
        deviceEpoch: 7,
        recipe: surfaceRecipe,
        source,
      }),
      "device-epoch",
    );
    await expect(created.provider.execute({
      requestSequence: 1,
      deviceEpoch: 8,
      recipe: surfaceRecipe,
      source,
    })).resolves.toMatchObject({ complete: true, deviceEpoch: 8 });
    created.provider.dispose();
    expect(created.provider.snapshot().state).toBe("disposed");
    await expectAsyncErrorCode(
      () => created.provider.execute({
        requestSequence: 2,
        deviceEpoch: 8,
        recipe: surfaceRecipe,
        source,
      }),
      "disposed",
    );
  });

  it("rejects malformed options and does not consume a sequence after validation failure", async () => {
    expect(createStudioMultiLightSurfaceProvider({
      maximumLights: 0,
    }).status).toBe("rejected");
    expect(createStudioMultiLightSurfaceProvider({
      unknown: true,
    } as never).status).toBe("rejected");
    const created = createStudioMultiLightSurfaceProvider();
    if (created.status !== "ready") throw new Error(created.path);
    const source = solidImage(1, 1, [1, 1, 1, 1]);
    const surfaceRecipe = recipe({
      height: { source: "separate", scale: 1 },
    });
    await expectAsyncErrorCode(
      () => created.provider.execute({
        requestSequence: 1,
        deviceEpoch: 1,
        recipe: surfaceRecipe,
        source,
      }),
      "map-required",
    );
    await expect(created.provider.execute({
      requestSequence: 1,
      deviceEpoch: 1,
      recipe: surfaceRecipe,
      source,
      heightMap: scalarMap(1, 1, "signed-height", [0]),
    })).resolves.toMatchObject({ requestSequence: 1, complete: true });
  });
});
