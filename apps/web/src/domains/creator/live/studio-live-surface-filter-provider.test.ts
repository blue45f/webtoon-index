import { describe, expect, it } from "vitest";

import {
  createStudioLiveSurfaceFilterProvider,
  createStudioLiveSurfaceFilterRecipe,
  isStudioLiveSurfaceFilterContentHash,
  parseStudioLiveSurfaceFilterRecipe,
  renderStudioLiveSurfaceFilterCpuOracle,
  serializeStudioLiveSurfaceFilterRecipe,
  STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT,
  STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
  StudioLiveSurfaceFilterError,
} from "./studio-live-surface-filter-provider";

import type {
  StudioLiveSurfaceBoundaryMode,
  StudioLiveSurfaceFilterRecipe,
  StudioLiveSurfaceFilterRecipeInput,
  StudioLiveSurfaceHeightChannel,
  StudioLiveSurfaceImage,
  StudioLiveSurfaceLightInput,
} from "./studio-live-surface-filter-provider";

function image(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number, number])[],
): StudioLiveSurfaceImage {
  return {
    kind: "studio-live-surface-image",
    version: 1,
    width,
    height,
    colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
    data: new Float32Array(pixels.flat()),
  };
}

function solidImage(
  width: number,
  height: number,
  pixel: readonly [number, number, number, number],
): StudioLiveSurfaceImage {
  return image(
    width,
    height,
    Array.from({ length: width * height }, () => pixel),
  );
}

function recipe(
  overrides: Readonly<{
    heightSource?: "source" | "separate";
    heightChannel?: StudioLiveSurfaceHeightChannel;
    scaleX?: number;
    scaleY?: number;
    mapMidpoint?: number;
    boundaryMode?: StudioLiveSurfaceBoundaryMode;
    lightingEnabled?: boolean;
    surfaceScale?: number;
    ambient?: number;
    diffuse?: number;
    specular?: number;
    shininess?: number;
    lightColor?: readonly [number, number, number];
    materialColor?: readonly [number, number, number];
    light?: StudioLiveSurfaceLightInput;
  }> = {},
): StudioLiveSurfaceFilterRecipe {
  const input: StudioLiveSurfaceFilterRecipeInput = {
    heightSource: overrides.heightSource ?? "source",
    heightChannel: overrides.heightChannel ?? "luminance",
    displacement: {
      scaleX: overrides.scaleX ?? 0,
      scaleY: overrides.scaleY ?? 0,
      mapMidpoint: overrides.mapMidpoint ?? 0.5,
      boundaryMode: overrides.boundaryMode ?? "clamp",
    },
    lighting: {
      enabled: overrides.lightingEnabled ?? false,
      surfaceScale: overrides.surfaceScale ?? 1,
      ambient: overrides.ambient ?? 1,
      diffuse: overrides.diffuse ?? 0,
      specular: overrides.specular ?? 0,
      shininess: overrides.shininess ?? 16,
      lightColor: overrides.lightColor ?? [1, 1, 1],
      materialColor: overrides.materialColor ?? [1, 1, 1],
      light: overrides.light ?? {
        kind: "directional",
        direction: [0, 0, 1],
      },
    },
  };
  const result = createStudioLiveSurfaceFilterRecipe(input);
  if (result.status !== "ready") throw new Error(result.path);
  return result.recipe;
}

function expectErrorCode(
  action: () => unknown,
  code: StudioLiveSurfaceFilterError["code"],
): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioLiveSurfaceFilterError);
    expect((error as StudioLiveSurfaceFilterError).code).toBe(code);
  }
}

async function expectAsyncErrorCode(
  action: () => Promise<unknown>,
  code: StudioLiveSurfaceFilterError["code"],
): Promise<void> {
  try {
    await action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioLiveSurfaceFilterError);
    expect((error as StudioLiveSurfaceFilterError).code).toBe(code);
  }
}

describe("Studio live surface immutable recipe", () => {
  it("normalizes, freezes, fingerprints, serializes and parses a clean-room recipe", () => {
    const direction = [0, 0, 2] as [number, number, number];
    const input: StudioLiveSurfaceFilterRecipeInput = {
      heightSource: "separate",
      heightChannel: "red",
      displacement: {
        scaleX: 2.25,
        scaleY: -1.5,
        mapMidpoint: 0.4,
        boundaryMode: "reflect",
      },
      lighting: {
        enabled: true,
        surfaceScale: 3,
        ambient: 0.2,
        diffuse: 0.7,
        specular: 0.35,
        shininess: 24,
        lightColor: [1, 0.8, 0.6],
        materialColor: [0.7, 0.9, 1.1],
        light: { kind: "directional", direction },
      },
    };
    const created = createStudioLiveSurfaceFilterRecipe(input);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    direction[2] = 9;

    expect(created.recipe).toMatchObject({
      kind: "studio-live-surface-filter-recipe",
      version: 1,
      colorContract: "scene-linear-straight-rgba-f32",
      alphaContract: "preserve-displaced-source-alpha",
      heightSource: "separate",
      heightChannel: "red",
      displacement: { boundaryMode: "reflect" },
      lighting: {
        light: { kind: "directional", direction: [0, 0, 1] },
      },
    });
    expect(Object.isFrozen(created.recipe)).toBe(true);
    expect(Object.isFrozen(created.recipe.displacement)).toBe(true);
    expect(Object.isFrozen(created.recipe.lighting)).toBe(true);
    expect(Object.isFrozen(created.recipe.lighting.light)).toBe(true);
    expect(Object.isFrozen(created.recipe.lighting.lightColor)).toBe(true);
    expect(isStudioLiveSurfaceFilterContentHash(
      created.recipe.fingerprint,
    )).toBe(true);

    const serialized = serializeStudioLiveSurfaceFilterRecipe(created.recipe);
    expect(serialized).not.toBeNull();
    expect(parseStudioLiveSurfaceFilterRecipe(serialized))
      .toEqual(created.recipe);
    expect(createStudioLiveSurfaceFilterRecipe(input)).toMatchObject({
      status: "ready",
      recipe: { fingerprint: created.recipe.fingerprint },
    });
  });

  it("rejects unknown fields, malformed vectors and fingerprint drift", () => {
    const base = recipe();
    expect(createStudioLiveSurfaceFilterRecipe({
      heightSource: "source",
      heightChannel: "alpha",
      displacement: {
        scaleX: 0,
        scaleY: 0,
        mapMidpoint: 0.5,
        boundaryMode: "clamp",
        vendorMode: 7,
      },
      lighting: base.lighting,
    })).toEqual({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
    expect(createStudioLiveSurfaceFilterRecipe({
      heightSource: "source",
      heightChannel: "alpha",
      displacement: base.displacement,
      lighting: {
        ...base.lighting,
        light: { kind: "directional", direction: [0, 0, 0] },
      },
    }).status).toBe("rejected");
    expect(parseStudioLiveSurfaceFilterRecipe({
      ...base,
      fingerprint: `sha256:${"f".repeat(64)}`,
    })).toBeNull();
    expect(parseStudioLiveSurfaceFilterRecipe({
      ...base,
      extra: true,
    })).toBeNull();
  });
});

describe("Studio live surface displacement CPU oracle", () => {
  it("supports both same-source and separate height maps without mutating inputs", () => {
    const source = image(3, 1, [
      [0.1, 0.3, 0.7, 0.2],
      [0.5, 0.4, 0.2, 0.6],
      [0.9, 0.2, 0.1, 1],
    ]);
    const separate = image(3, 1, [
      [0.1, 0.3, 0.7, 0.2],
      [0.5, 0.4, 0.2, 0.6],
      [0.9, 0.2, 0.1, 1],
    ]);
    const before = [...source.data];
    const same = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "source",
        heightChannel: "red",
        scaleX: 1.25,
        scaleY: -0.25,
        boundaryMode: "reflect",
      }),
      source,
    }, { tileEdge: 1 });
    const split = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "separate",
        heightChannel: "red",
        scaleX: 1.25,
        scaleY: -0.25,
        boundaryMode: "reflect",
      }),
      source,
      heightMap: separate,
    }, { tileEdge: 2 });

    expect([...source.data]).toEqual(before);
    expect(same.image.data).not.toBe(source.data);
    expect([...same.image.data]).toEqual([...split.image.data]);
    expect(same.receipt).toMatchObject({
      backend: "cpu-typed-array",
      executionModel: "deterministic-tiled-oracle",
      heightSource: "source",
      sourceSize: [3, 1],
      heightMapSize: [3, 1],
      alphaContract: STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT,
      complete: true,
    });
    expect(split.receipt.heightSource).toBe("separate");
    expect(same.receipt.sourceHash).toBe(same.receipt.heightMapHash);
    expect(split.receipt.sourceHash).toBe(split.receipt.heightMapHash);
    expect(same.receipt.outputHash).toBe(split.receipt.outputHash);
    expect(same.receipt.tileCount).toBe(3);
    expect(split.receipt.tileCount).toBe(2);
    expect(same.receipt.haloPixels).toBeGreaterThan(0);
  });

  it.each([
    ["clamp", 1, 1],
    ["reflect", 0.75, 1],
    ["transparent", 0, 0],
  ] as const)(
    "applies subpixel x displacement with %s boundaries",
    (boundaryMode, expectedRed, expectedAlpha) => {
      const source = image(3, 1, [
        [0, 0, 0, 1],
        [0.5, 0, 0, 1],
        [1, 0, 0, 1],
      ]);
      const heightMap = solidImage(1, 1, [1, 1, 1, 1]);
      const result = renderStudioLiveSurfaceFilterCpuOracle({
        recipe: recipe({
          heightSource: "separate",
          heightChannel: "red",
          scaleX: 3,
          mapMidpoint: 0.5,
          boundaryMode,
        }),
        source,
        heightMap,
      });
      const last = 2 * 4;
      expect(result.image.data[last]).toBeCloseTo(expectedRed, 6);
      expect(result.image.data[last + 3]).toBeCloseTo(expectedAlpha, 6);
    },
  );

  it("applies y scale and map midpoint independently", () => {
    const source = image(1, 3, [
      [0, 0, 0, 1],
      [0, 0.5, 0, 1],
      [0, 1, 0, 1],
    ]);
    const heightMap = solidImage(1, 1, [1, 1, 1, 1]);
    const displaced = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "separate",
        heightChannel: "red",
        scaleY: 3,
        mapMidpoint: 0.5,
        boundaryMode: "reflect",
      }),
      source,
      heightMap,
    });
    const neutral = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "separate",
        heightChannel: "red",
        scaleY: 3,
        mapMidpoint: 1,
        boundaryMode: "reflect",
      }),
      source,
      heightMap,
    });
    expect(displaced.image.data[2 * 4 + 1]).toBeCloseTo(0.75, 6);
    expect(neutral.image.data[2 * 4 + 1]).toBeCloseTo(1, 6);
  });
});

describe("Studio live surface height-gradient lighting", () => {
  it("responds to gradient direction while preserving every displaced alpha", () => {
    const source = solidImage(5, 1, [0.4, 0.4, 0.4, 0.37]);
    const heightMap = image(5, 1, [
      [0, 0, 0, 1],
      [0.25, 0.25, 0.25, 1],
      [0.5, 0.5, 0.5, 1],
      [0.75, 0.75, 0.75, 1],
      [1, 1, 1, 1],
    ]);
    const towardSlope = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "separate",
        heightChannel: "red",
        lightingEnabled: true,
        surfaceScale: 2,
        ambient: 0.1,
        diffuse: 1,
        specular: 0,
        materialColor: [1, 0.5, 2],
        lightColor: [1, 0.5, 0.25],
        light: { kind: "directional", direction: [-1, 0, 1] },
      }),
      source,
      heightMap,
    });
    const awayFromSlope = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        heightSource: "separate",
        heightChannel: "red",
        lightingEnabled: true,
        surfaceScale: 2,
        ambient: 0.1,
        diffuse: 1,
        specular: 0,
        materialColor: [1, 0.5, 2],
        lightColor: [1, 0.5, 0.25],
        light: { kind: "directional", direction: [1, 0, 1] },
      }),
      source,
      heightMap,
    });
    const center = 2 * 4;
    expect(towardSlope.image.data[center])
      .toBeGreaterThan(awayFromSlope.image.data[center]!);
    for (let index = 3; index < towardSlope.image.data.length; index += 4) {
      expect(towardSlope.image.data[index]).toBe(source.data[index]);
      expect(awayFromSlope.image.data[index]).toBe(source.data[index]);
    }
  });

  it("combines ambient, diffuse and specular with point, light and material colors", () => {
    const source = solidImage(1, 1, [0.4, 0.2, 0.1, 0.37]);
    const result = renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({
        lightingEnabled: true,
        surfaceScale: 1,
        ambient: 0.2,
        diffuse: 0.5,
        specular: 0.3,
        shininess: 8,
        lightColor: [1, 0.5, 0.25],
        materialColor: [1, 0.5, 2],
        light: { kind: "point", position: [0, 0, 10] },
      }),
      source,
    });
    expect([...result.image.data]).toEqual([
      expect.closeTo(0.58, 5),
      expect.closeTo(0.195, 5),
      expect.closeTo(0.14, 5),
      source.data[3],
    ]);
  });
});

describe("Studio live surface budgets and provider lifecycle", () => {
  it("fails closed for height-source, image, pixel, memory, halo and tile violations", () => {
    const source = solidImage(3, 1, [0.5, 0.5, 0.5, 1]);
    const separateRecipe = recipe({ heightSource: "separate" });
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: separateRecipe,
      source,
    }), "height-map-required");
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe(),
      source,
      heightMap: source,
    }), "height-map-not-allowed");
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe(),
      source,
    }, { maximumPixels: 2 }), "budget-exceeded");
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe(),
      source,
    }, { maximumResidentBytes: 1 }), "budget-exceeded");
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe({ scaleX: 8 }),
      source,
    }, { maximumHaloPixels: 1 }), "budget-exceeded");
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe(),
      source,
    }, { tileEdge: 1, maximumTiles: 2 }), "budget-exceeded");

    const malformed = {
      ...source,
      data: new Float32Array(source.data),
    };
    malformed.data[3] = Number.NaN;
    expectErrorCode(() => renderStudioLiveSurfaceFilterCpuOracle({
      recipe: recipe(),
      source: malformed,
    }), "invalid-image");
  });

  it("enforces epoch, sequence, abort and disposal with deterministic receipts", async () => {
    const source = solidImage(2, 2, [0.25, 0.5, 0.75, 0.8]);
    const effect = recipe({
      lightingEnabled: true,
      ambient: 0.3,
      diffuse: 0.7,
      specular: 0.1,
    });
    const firstCreation = createStudioLiveSurfaceFilterProvider({
      initialDeviceEpoch: 3,
      tileEdge: 1,
    });
    const replayCreation = createStudioLiveSurfaceFilterProvider({
      initialDeviceEpoch: 3,
      tileEdge: 1,
    });
    expect(firstCreation.status).toBe("ready");
    expect(replayCreation.status).toBe("ready");
    if (firstCreation.status !== "ready" || replayCreation.status !== "ready") {
      return;
    }
    const request = {
      requestSequence: 1,
      deviceEpoch: 3,
      recipe: effect,
      source,
    };
    const first = await firstCreation.provider.execute(request);
    const replay = await replayCreation.provider.execute(request);
    expect(first).toMatchObject({
      kind: "studio-live-surface-filter-receipt",
      version: 1,
      providerRevision: 1,
      requestSequence: 1,
      deviceEpoch: 3,
      complete: true,
      oracle: {
        backend: "cpu-typed-array",
        colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
        alphaContract: STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT,
      },
    });
    expect(first.receiptHash).toBe(replay.receiptHash);
    expect(first.oracle.outputHash).toBe(replay.oracle.outputHash);
    expect(isStudioLiveSurfaceFilterContentHash(first.receiptHash)).toBe(true);
    await expectAsyncErrorCode(
      () => firstCreation.provider.execute(request),
      "request-sequence",
    );
    await expectAsyncErrorCode(
      () => firstCreation.provider.execute({
        ...request,
        requestSequence: 2,
        deviceEpoch: 2,
      }),
      "device-epoch",
    );

    const abortCreation = createStudioLiveSurfaceFilterProvider({
      initialDeviceEpoch: 3,
    });
    if (abortCreation.status !== "ready") return;
    const controller = new AbortController();
    controller.abort("cancelled");
    await expectAsyncErrorCode(
      () => abortCreation.provider.execute({
        ...request,
        signal: controller.signal,
      }),
      "aborted",
    );
    expect((await abortCreation.provider.execute(request)).requestSequence)
      .toBe(1);
    expect(abortCreation.provider.advanceDeviceEpoch()).toBe(4);
    await expectAsyncErrorCode(
      () => abortCreation.provider.execute(request),
      "device-epoch",
    );
    expect((await abortCreation.provider.execute({
      ...request,
      deviceEpoch: 4,
    })).requestSequence).toBe(1);
    abortCreation.provider.dispose();
    await expectAsyncErrorCode(
      () => abortCreation.provider.execute({
        ...request,
        requestSequence: 2,
        deviceEpoch: 4,
      }),
      "disposed",
    );
    expect(abortCreation.provider.snapshot()).toMatchObject({
      state: "disposed",
      deviceEpoch: 4,
      lastRequestSequence: 1,
    });
  });

  it("rejects invalid provider options and unknown runtime request fields", async () => {
    expect(createStudioLiveSurfaceFilterProvider({
      tileEdge: 0,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
    const created = createStudioLiveSurfaceFilterProvider();
    if (created.status !== "ready") return;
    await expectAsyncErrorCode(
      () => created.provider.execute({
        requestSequence: 1,
        deviceEpoch: 1,
        recipe: recipe(),
        source: solidImage(1, 1, [0, 0, 0, 1]),
        unexpected: true,
      } as never),
      "invalid-request",
    );
  });
});
