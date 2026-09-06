import { describe, expect, it } from "vitest";

import {
  createStudioImpastoHeightProvider,
  STUDIO_IMPASTO_HEIGHT_BUDGETS,
  StudioImpastoHeightProviderError,
  type StudioImpastoBrushDeposition,
  type StudioImpastoHeightFieldInput,
  type StudioImpastoHeightRequest,
} from "./studio-impasto-height-provider";

function deposition(
  overrides: Partial<StudioImpastoBrushDeposition> = {},
): StudioImpastoBrushDeposition {
  return {
    id: "dab-1",
    mode: "add-height",
    x: 4,
    y: 4,
    radius: 2,
    depth: 2,
    hardness: 1,
    falloff: 1,
    flow: 1,
    pressure: 1,
    velocity: 0,
    paperStrength: 0,
    textureStrength: 0,
    depthJitter: 0,
    jitterSmoothing: 0,
    seed: 42,
    ...overrides,
  };
}

function field(
  overrides: Partial<StudioImpastoHeightFieldInput> = {},
): StudioImpastoHeightFieldInput {
  return {
    width: 9,
    height: 9,
    heights: new Float32Array(81),
    ...overrides,
  };
}

function request(
  overrides: Partial<StudioImpastoHeightRequest> = {},
): StudioImpastoHeightRequest {
  return {
    epoch: 1,
    field: field(),
    depositions: [deposition()],
    ...overrides,
  };
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(StudioImpastoHeightProviderError);
    return (error as StudioImpastoHeightProviderError).code;
  }
}

describe("Studio signed impasto height provider", () => {
  it("is deterministic for seeded ordered depositions and changes with the seed", () => {
    const jittered = deposition({
      depthJitter: 0.85,
      jitterSmoothing: 0.7,
    });
    const first = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({ depositions: [jittered] }),
    );
    const second = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({ depositions: [jittered] }),
    );
    const otherSeed = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({
        depositions: [{ ...jittered, seed: jittered.seed + 1 }],
      }),
    );

    expect(first.field.heights).toEqual(second.field.heights);
    expect(first.receipt.afterHash).toBe(second.receipt.afterHash);
    expect(first.receipt.afterHash).not.toBe(otherSeed.receipt.afterHash);
    expect(first.receipt).toMatchObject({
      backend: "cpu-f32-oracle",
      algorithm: "signed-textured-height-plow-v1",
      complete: true,
    });
  });

  it("supports signed excavation, erase-to-zero, flattening, and ordered replay", () => {
    const provider = createStudioImpastoHeightProvider({ epoch: 1 });
    const artifact = provider.apply(
      request({
        depositions: [
          deposition({ id: "raise", depth: 2 }),
          deposition({
            id: "excavate",
            mode: "excavate",
            depth: 5,
          }),
          deposition({
            id: "flatten",
            mode: "flatten",
            targetHeight: -1,
            radius: 1,
          }),
        ],
      }),
    );
    expect(artifact.field.heights[4 * 9 + 4]).toBe(-1);
    expect(artifact.receipt.minimumHeight).toBeLessThan(0);

    const erased = provider.apply(
      request({
        field: field({
          heights: new Float32Array(81).fill(-3),
        }),
        depositions: [
          deposition({
            id: "erase",
            mode: "erase-height",
            radius: 1,
          }),
        ],
      }),
    );
    expect(erased.field.heights[4 * 9 + 4]).toBe(0);
    expect(erased.field.heights[0]).toBe(-3);
    expect(erased.receipt.sequence).toBe(2);
  });

  it("combines radial fade, paper and texture luminance, and expression curves", () => {
    const paper = new Float32Array(49).fill(0.5);
    const texture = new Float32Array(49).fill(0.5);
    const artifact = createStudioImpastoHeightProvider({ epoch: 1 }).apply({
      epoch: 1,
      field: {
        width: 7,
        height: 7,
        heights: new Float32Array(49),
        paperLuminance: paper,
        textureLuminance: texture,
      },
      depositions: [
        deposition({
          x: 3,
          y: 3,
          radius: 3,
          depth: 4,
          hardness: 0,
          pressure: 0.5,
          velocity: 0.25,
          expression: {
            pressure: { minimum: 0.2, invert: false, exponent: 1 },
            velocity: { minimum: 0.1, invert: true, exponent: 1 },
          },
          paperStrength: 1,
          textureStrength: 1,
        }),
      ],
    });

    expect(artifact.field.heights[3 * 7 + 3]).toBeCloseTo(0.465, 6);
    expect(artifact.field.heights[3 * 7]).toBe(0);
    expect(artifact.field.heights[3 * 7 + 2]).toBeGreaterThan(0);
    expect(artifact.field.heights[3 * 7 + 2]).toBeLessThan(0.465);
  });

  it("redistributes plowed material into a bounded ring without deleting height", () => {
    const plain = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({
        field: field({ width: 11, height: 11, heights: new Float32Array(121) }),
        depositions: [
          deposition({ x: 5, y: 5, radius: 2, depth: 3 }),
        ],
      }),
    );
    const plowed = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({
        field: field({ width: 11, height: 11, heights: new Float32Array(121) }),
        depositions: [
          deposition({
            x: 5,
            y: 5,
            radius: 2,
            depth: 3,
            plow: { strength: 0.5, radius: 2 },
          }),
        ],
      }),
    );

    const center = 5 * 11 + 5;
    const outerRing = 5 * 11 + 8;
    expect(plowed.field.heights[center]).toBeLessThan(
      plain.field.heights[center]!,
    );
    expect(plowed.field.heights[outerRing]).toBeGreaterThan(0);
    expect(plowed.receipt.conservation).toMatchObject({
      conserved: true,
    });
    expect(plowed.receipt.conservation.plowRemovedHeight).toBeGreaterThan(0);
    expect(
      plowed.receipt.conservation.plowRedistributedHeight,
    ).toBeCloseTo(
      plowed.receipt.conservation.plowRemovedHeight,
      4,
    );
    expect(plowed.receipt.conservation.afterHeightSum).toBeCloseTo(
      plain.receipt.conservation.afterHeightSum,
      4,
    );
    expect(
      Math.abs(plowed.receipt.conservation.conservationError),
    ).toBeLessThanOrEqual(plowed.receipt.conservation.tolerance);
  });

  it("updates cloned optional color and roughness channels without aliasing inputs", () => {
    const heights = new Float32Array(25);
    const colors = new Float32Array(100);
    const roughness = new Float32Array(25).fill(0.2);
    const input = field({
      width: 5,
      height: 5,
      heights,
      colors,
      roughness,
    });
    const artifact = createStudioImpastoHeightProvider({ epoch: 1 }).apply(
      request({
        field: input,
        depositions: [
          deposition({
            x: 2,
            y: 2,
            radius: 1,
            color: [0.8, 0.4, 0.2, 1],
            roughness: 0.9,
          }),
        ],
      }),
    );
    const center = 2 * 5 + 2;
    const painted = artifact.field.colors!.slice(
      center * 4,
      center * 4 + 4,
    );
    expect(painted[0]).toBeCloseTo(0.8, 6);
    expect(painted[1]).toBeCloseTo(0.4, 6);
    expect(painted[2]).toBeCloseTo(0.2, 6);
    expect(painted[3]).toBe(1);
    expect(artifact.field.roughness![center]).toBeCloseTo(0.9, 6);
    expect(artifact.field.heights).not.toBe(heights);
    expect(artifact.field.colors).not.toBe(colors);
    expect(artifact.field.roughness).not.toBe(roughness);
    expect(heights.every((value) => value === 0)).toBe(true);
    expect(colors.every((value) => value === 0)).toBe(true);
    expect(
      roughness.every((value) => Math.abs(value - 0.2) < 0.000_001),
    ).toBe(true);
    expect(artifact.receipt.beforeHash).not.toBe(artifact.receipt.afterHash);
  });

  it("fails closed on cancellation, stale epochs, budgets, NaN and disposal", () => {
    const provider = createStudioImpastoHeightProvider({ epoch: 2 });
    expect(errorCode(() => provider.apply(request()))).toBe("epoch-mismatch");

    const controller = new AbortController();
    controller.abort();
    expect(
      errorCode(() =>
        provider.apply(request({ epoch: 2, signal: controller.signal })),
      ),
    ).toBe("aborted");
    expect(
      errorCode(() =>
        provider.apply(request({ epoch: 2, maximumWorkUnits: 1 })),
      ),
    ).toBe("budget-exceeded");
    expect(
      errorCode(() =>
        provider.apply(request({ epoch: 2, maximumMemoryBytes: 1 })),
      ),
    ).toBe("budget-exceeded");
    expect(
      errorCode(() =>
        provider.apply(
          request({
            epoch: 2,
            field: field({
              heights: new Float32Array([
                Number.NaN,
                ...new Float32Array(80),
              ]),
            }),
          }),
        ),
      ),
    ).toBe("invalid-request");
    expect(
      errorCode(() =>
        provider.apply(
          request({
            epoch: 2,
            depositions: [
              deposition({
                radius:
                  STUDIO_IMPASTO_HEIGHT_BUDGETS.maxBrushRadius + 1,
              }),
            ],
          }),
        ),
      ),
    ).toBe("invalid-request");
    expect(provider.snapshot()).toEqual({
      state: "ready",
      epoch: 2,
      sequence: 0,
    });

    provider.advanceEpoch(3);
    expect(provider.snapshot().epoch).toBe(3);
    provider.dispose();
    expect(provider.snapshot().state).toBe("disposed");
    expect(
      errorCode(() => provider.apply(request({ epoch: 3 }))),
    ).toBe("disposed");
    expect(errorCode(() => provider.advanceEpoch(4))).toBe("disposed");
  });
});
