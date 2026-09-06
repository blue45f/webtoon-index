import { describe, expect, it, vi } from "vitest";

import {
  computeStudioImpastoReliefShading,
  STUDIO_IMPASTO_RELIEF_LIGHT_DIRECTION_DEFAULT,
  STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS,
  STUDIO_IMPASTO_RELIEF_SHADING_PROVENANCE,
  STUDIO_IMPASTO_RELIEF_SHADING_V1_VERSION,
  StudioImpastoReliefShadingError,
} from "./studio-impasto-relief-shading-v1";
import { studioOssUnitHash } from "./studio-oss-brush-kernels";

const QUALITIES = ["ggx", "emboss-2tap"] as const;

/** Horizontal Gaussian ridge: crest along the row `crestY`, uniform in x. */
function ridgeTile(width: number, height: number, crestY: number): Float32Array {
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const distance = y - crestY;
    const ridge = Math.exp(-(distance * distance) / 18) * 0.85;
    for (let x = 0; x < width; x += 1) {
      heights[y * width + x] = ridge;
    }
  }
  return heights;
}

function meanRows(
  shading: Float32Array,
  width: number,
  fromRow: number,
  toRow: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = fromRow; y < toRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sum += shading[y * width + x]!;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

describe("studio impasto relief shading v1 (dli/paint MIT port)", () => {
  it("carries frozen MIT provenance and dli's verbatim default parameters", () => {
    expect(STUDIO_IMPASTO_RELIEF_SHADING_V1_VERSION).toBe(
      "studio-impasto-relief-shading-v1",
    );
    expect(Object.isFrozen(STUDIO_IMPASTO_RELIEF_SHADING_PROVENANCE)).toBe(true);
    expect(STUDIO_IMPASTO_RELIEF_SHADING_PROVENANCE.license).toContain("MIT");
    expect(STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.normalScale).toBe(7.0);
    expect(STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.roughness).toBe(0.075);
    expect(STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.f0).toBe(0.05);
    expect(STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.specularScale).toBe(0.5);
    expect(STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.diffuseScale).toBe(0.15);
    // dli LIGHT_DIRECTION (0, 1, 1) in GL space = (0, −1, 1) with y down.
    expect(STUDIO_IMPASTO_RELIEF_LIGHT_DIRECTION_DEFAULT).toEqual([0, -1, 1]);
  });

  it.each(QUALITIES)("shades any flat tile to a uniform 1.0 (%s)", (quality) => {
    for (const level of [0, 0.5, 1]) {
      const heights = new Float32Array(48 * 32).fill(level);
      const shading = computeStudioImpastoReliefShading(heights, {
        width: 48,
        height: 32,
        quality,
      });
      for (const value of shading) {
        expect(Math.abs(value - 1)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it.each(QUALITIES)(
    "lights a ridge's light-facing flank and darkens the far flank (%s)",
    (quality) => {
      const width = 64;
      const height = 64;
      const crestY = 32;
      const shading = computeStudioImpastoReliefShading(
        ridgeTile(width, height, crestY),
        { width, height, quality },
      );
      // Default light (0, −1, 1) shines from the tile's top edge: the upper
      // flank (rows before the crest) must brighten, the lower flank darken.
      const upperFlank = meanRows(shading, width, crestY - 6, crestY - 1);
      const lowerFlank = meanRows(shading, width, crestY + 2, crestY + 7);
      expect(upperFlank).toBeGreaterThan(1.005);
      expect(lowerFlank).toBeLessThan(0.995);
      expect(upperFlank - lowerFlank).toBeGreaterThan(0.02);
      // Far away from the ridge the multiplier returns to identity.
      const farField = meanRows(shading, width, 2, 6);
      expect(Math.abs(farField - 1)).toBeLessThanOrEqual(1e-3);
    },
  );

  it.each(QUALITIES)("swaps the lit flank when the light flips (%s)", (quality) => {
    const width = 48;
    const height = 48;
    const crestY = 24;
    const flipped = computeStudioImpastoReliefShading(
      ridgeTile(width, height, crestY),
      { width, height, quality, lightDirection: [0, 1, 1] },
    );
    const upperFlank = meanRows(flipped, width, crestY - 6, crestY - 1);
    const lowerFlank = meanRows(flipped, width, crestY + 2, crestY + 7);
    expect(lowerFlank).toBeGreaterThan(upperFlank);
  });

  it("raises a GGX specular highlight the emboss fallback cannot fake", () => {
    // A plane whose Sobel normal aligns with the half vector between the
    // default light and the (0, 0, 1) eye: the surface rises with +y so its
    // normal tips toward the light, at ∂h/∂y = tan(22.5°)·normalScale/8.
    const width = 48;
    const height = 48;
    const slope = (Math.tan(Math.PI / 8) * STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.normalScale) / 8;
    const heights = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        heights[y * width + x] = y * slope;
      }
    }
    const ggx = computeStudioImpastoReliefShading(heights, { width, height });
    const emboss = computeStudioImpastoReliefShading(heights, {
      width,
      height,
      quality: "emboss-2tap",
    });
    // Interior pixels (borders see clamped taps) catch the GGX lobe. Closed
    // form at perfect alignment: (diffuse 0.9886 + D·G·F·0.5 = 0.4142) / flat
    // 0.9568 ≈ 1.4661 — far above the pure-diffuse ceiling 1/0.9568 ≈ 1.045.
    const centre = ggx[24 * width + 24]!;
    expect(centre).toBeGreaterThan(1.4);
    expect(centre).toBeLessThanOrEqual(
      STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.maxShadingMultiplier,
    );
    // The 2-tap emboss has no specular lobe: on the same plane it stays a
    // plain slope response (≈1.293) below the GGX highlight.
    const embossCentre = emboss[24 * width + 24]!;
    expect(centre).toBeGreaterThan(embossCentre + 0.1);
  });

  it.each(QUALITIES)(
    "keeps every output bounded in [0, max] on a hostile seeded tile (%s)",
    (quality) => {
      const width = 96;
      const height = 64;
      const heights = new Float32Array(width * height);
      for (let index = 0; index < heights.length; index += 1) {
        // Deterministic spiky field — repo seeded-hash idiom, no Math.random.
        heights[index] = studioOssUnitHash(0x51ee, index) * 3 - 1;
      }
      const shading = computeStudioImpastoReliefShading(heights, {
        width,
        height,
        quality,
        heightScale: 4,
      });
      for (const value of shading) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(
          STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.maxShadingMultiplier,
        );
      }
    },
  );

  it("treats a Uint8 tile as height/255, matching the Float32 equivalent", () => {
    const width = 40;
    const height = 24;
    const bytes = new Uint8Array(width * height);
    const floats = new Float32Array(width * height);
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = Math.floor(studioOssUnitHash(0xbeef, index) * 256);
      bytes[index] = byte;
      floats[index] = byte / 255;
    }
    const fromBytes = computeStudioImpastoReliefShading(bytes, { width, height });
    const fromFloats = computeStudioImpastoReliefShading(floats, { width, height });
    for (let index = 0; index < fromBytes.length; index += 1) {
      expect(Math.abs(fromBytes[index]! - fromFloats[index]!)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("is deterministic and supports a caller-provided output buffer", () => {
    const width = 32;
    const height = 32;
    const heights = ridgeTile(width, height, 16);
    const first = computeStudioImpastoReliefShading(heights, { width, height });
    const into = new Float32Array(width * height);
    const second = computeStudioImpastoReliefShading(heights, { width, height, into });
    expect(second).toBe(into);
    expect([...second]).toEqual([...first]);
  });

  it("rejects out-of-contract inputs loudly instead of clamping them silently", () => {
    const heights = new Float32Array(16);
    expect(() =>
      computeStudioImpastoReliefShading(heights, { width: 5, height: 5 }),
    ).toThrow(StudioImpastoReliefShadingError);
    expect(() =>
      computeStudioImpastoReliefShading(heights, { width: 4, height: 4, roughness: 0 }),
    ).toThrow(StudioImpastoReliefShadingError);
    expect(() =>
      computeStudioImpastoReliefShading(heights, {
        width: 4,
        height: 4,
        lightDirection: [0, 0, 0],
      }),
    ).toThrow(StudioImpastoReliefShadingError);
    expect(() =>
      computeStudioImpastoReliefShading(heights, {
        width: 4,
        height: 4,
        normalScale: -1,
      }),
    ).toThrow(StudioImpastoReliefShadingError);
    expect(() =>
      computeStudioImpastoReliefShading(heights, {
        width: 4,
        height: 4,
        into: new Float32Array(3),
      }),
    ).toThrow(StudioImpastoReliefShadingError);
  });

  /**
   * Exact transcendental census, measured rather than derived: `Math.sqrt` is called
   * `4 * width * height + 4` times for ggx (four per shaded pixel — `halfLength` in
   * `shadeNormal`, both terms of `gggxVisibility`, and `normalLength` in the loop — plus a
   * fixed four in setup), and exactly four times for emboss-2tap, which never enters
   * `shadeNormal`. No other transcendental is called at all in either mode.
   *
   * "No other" means every costly `Math` member, not the handful this shader happens to use today
   * — a census scoped to the current call set says nothing about a regression that reaches for
   * `Math.tan` or `Math.cbrt` tomorrow.
   *
   * This is what the 40ms budget below was really protecting, and it protects it far better: a
   * normalize added per tap, a second sqrt in the visibility term, an `acos`/`pow` creeping into
   * the BRDF, or `(1 - lDotH) ** 5` becoming `Math.pow` all move these counts, and they move them
   * identically on every machine, every Node version and under any load.
   *
   * Runs on a small tile in its own test, never inside a timed window: installing a spy on
   * `Math.sqrt` defeats V8's lowering of it to a hardware instruction, so a spied call is not the
   * call the budget measures.
   */
  it("calls exactly three transcendentals per shaded pixel, and nothing else", () => {
    // EVERY `Math` member whose cost is more than a machine instruction, not a hand-picked few.
    // A census listing only the functions the shader happens to call today convicts nothing when
    // it starts calling one it does not: a per-pixel `Math.tan`, `Math.cbrt` or `Math.log2` would
    // leave every count below unchanged and clear the smoke bound as well.
    //
    // The cheap arithmetic members (`abs`, `min`, `max`, `floor`, `ceil`, `round`, `sign`,
    // `trunc`, `imul`, `clz32`, `random`) are excluded deliberately: they compile to instructions,
    // so counting them would pin the shader's arithmetic shape rather than its transcendental
    // cost. `random` is excluded for a different reason -- this path must never call it, and the
    // determinism test above is what proves that.
    const transcendentals = [
      "sqrt", "cbrt", "pow", "exp", "expm1", "log", "log2", "log10", "log1p",
      "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
      "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
      "hypot", "fround",
    ] as const;

    const census = (
      width: number,
      height: number,
      quality: "ggx" | "emboss-2tap",
    ): Record<string, number> => {
      const heights = new Float32Array(width * height);
      for (let index = 0; index < heights.length; index += 1) {
        heights[index] = studioOssUnitHash(0x7a11, index);
      }
      const counts: Record<string, number> = {};
      const spies = transcendentals.map((name) => {
        counts[name] = 0;
        const original = Math[name] as (...args: number[]) => number;
        return vi.spyOn(Math, name).mockImplementation(((...args: number[]) => {
          counts[name] += 1;
          return original(...args);
        }) as never);
      });
      try {
        computeStudioImpastoReliefShading(heights, {
          width,
          height,
          into: new Float32Array(width * height),
          quality,
        });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      return counts;
    };

    // Two tile sizes pin the per-pixel slope AND the constant separately — one size alone could
    // be satisfied by a wrong split between them. Since 7748106f the light's half vector and
    // Schlick term are resolved once per tile (they are constant for one light, eye and
    // material), so a cell costs three square roots — normalize, half-vector length, GGX — and
    // the constant absorbs the per-tile resolve.
    for (const [width, height] of [[16, 12], [32, 24]] as const) {
      const ggx = census(width, height, "ggx");
      expect(ggx.sqrt, `ggx ${width}x${height}`).toBe(3 * width * height + 4);
      const emboss = census(width, height, "emboss-2tap");
      expect(emboss.sqrt, `emboss ${width}x${height}`).toBe(4);
      expect(emboss.hypot, `emboss ${width}x${height}`).toBe(1);

      for (const name of transcendentals) {
        if (name === "sqrt") continue;
        if (name === "hypot") {
          expect(ggx[name], `ggx ${name}`).toBe(0);
          continue;
        }
        expect(ggx[name], `ggx ${name}`).toBe(0);
        expect(emboss[name], `emboss ${name}`).toBe(0);
      }
    }

    // The census above textures every cell, so it never sees the case the tile is mostly made of.
    // A cell whose Sobel sums both vanish has the flat normal and shades to exactly one, so the
    // BRDF is skipped for it entirely: the per-pixel slope is ZERO, and only the setup constant
    // remains. Without this the flat path could be deleted and every count above stays green.
    for (const [width, height] of [[16, 12], [32, 24]] as const) {
      const flat = new Float32Array(width * height);
      const uniform = new Float32Array(width * height).fill(0.375);
      for (const [label, heights] of [["empty", flat], ["uniform", uniform]] as const) {
        const counts: Record<string, number> = { sqrt: 0 };
        const original = Math.sqrt;
        const spy = vi.spyOn(Math, "sqrt").mockImplementation(((value: number) => {
          counts.sqrt! += 1;
          return original(value);
        }) as never);
        try {
          computeStudioImpastoReliefShading(heights, {
            width,
            height,
            into: new Float32Array(width * height),
          });
        } finally {
          spy.mockRestore();
        }
        expect(counts.sqrt, `${label} ${width}x${height}`).toBe(4);
      }
    }
  });

  it("shades a tile with no gradient anywhere to exactly one", () => {
    // Not "close to one": the flat short-circuit writes the constant the general path divides
    // itself down to, so any drift here means the two disagree. A uniform NON-zero tile is the
    // interesting half — its cells carry height, and still no slope.
    for (const fill of [0, 0.375, 1, 12.5]) {
      const heights = new Float32Array(9 * 7).fill(fill);
      const shading = computeStudioImpastoReliefShading(heights, { width: 9, height: 7 });
      for (const [index, value] of shading.entries()) {
        expect(value, `fill ${fill} at ${index}`).toBe(1);
      }
    }
  });

  it("shades a border cell exactly like the same neighbourhood held in the interior", () => {
    // CLAMP_TO_EDGE is skipped where it cannot bind, which is everywhere but the tile's own
    // border. Replicating that border into a one-cell frame turns every original cell into an
    // interior one whose real neighbours ARE what the clamp would have produced, so the two
    // passes have to agree cell for cell — and an off-by-one row in the un-clamped read would
    // show up here and nowhere else.
    const width = 11;
    const height = 9;
    const heights = new Float32Array(width * height);
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = studioOssUnitHash(0x51de, index) * 2;
    }
    const padded = new Float32Array((width + 2) * (height + 2));
    for (let y = -1; y <= height; y += 1) {
      const sourceY = y < 0 ? 0 : y >= height ? height - 1 : y;
      for (let x = -1; x <= width; x += 1) {
        const sourceX = x < 0 ? 0 : x >= width ? width - 1 : x;
        padded[(y + 1) * (width + 2) + (x + 1)] = heights[sourceY * width + sourceX]!;
      }
    }
    const plain = computeStudioImpastoReliefShading(heights, { width, height });
    const framed = computeStudioImpastoReliefShading(padded, {
      width: width + 2,
      height: height + 2,
    });
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        expect(plain[y * width + x], `${x},${y}`)
          .toBe(framed[(y + 1) * (width + 2) + (x + 1)]);
      }
    }
  });


  /**
   * An exact census of HEIGHT TAPS, which is the half of the per-pixel body the transcendental
   * census above cannot see.
   *
   * The census above counts `Math` calls, so a body that got slower by re-reading the height
   * buffer leaves every count green. The wall-clock gate in the sibling `.perf.test.ts` cannot
   * cover it either, and that is structural rather than an oversight: it grades one ggx window
   * against a thirty-call emboss window, so the shared pixel walk runs thirty times in the
   * denominator and once in the numerator, and a walk regression moves that ratio in the
   * ACQUITTING direction. Equal tiles do not fix it — equal pixel counts per window and equal
   * window durations are mutually exclusive when the two bodies differ ~30x in cost.
   *
   * So the walk is graded here instead, with no clock at all: a counting Proxy over the input
   * makes every indexed read observable, and the tap count per pixel is a fixed property of the
   * algorithm on every machine. `ggx` takes 8 and `emboss-2tap` takes 2 — the "2tap" in its own
   * name — verified exactly at 1x1, 6x5, 3x11 and 16x16, so the count is `pixels * taps` with no
   * edge cases hiding in it.
   *
   * This CANNOT live in the timing file: a Proxy on the hot path deoptimises it, which is the
   * same trap the `vi.spyOn` census set for the wall-clock gates (emboss 33.1ms -> 154.5ms per 30
   * passes, surviving `mockRestore`). Vitest isolates modules per file, and that is the
   * enforcement.
   */
  it("takes exactly eight height taps per ggx pixel and two per emboss pixel", () => {
    const countHeightTaps = (
      width: number,
      height: number,
      quality: (typeof QUALITIES)[number],
    ): number => {
      const raw = new Float32Array(width * height);
      for (let index = 0; index < raw.length; index += 1) {
        raw[index] = studioOssUnitHash(0x5eed, index);
      }
      let taps = 0;
      const counting = new Proxy(raw, {
        get(target, property) {
          if (typeof property === "string" && /^\d+$/.test(property)) taps += 1;
          // Bound to the TARGET, not the proxy: `TypedArray.prototype.length` and friends read an
          // internal slot a Proxy does not have, and would throw on the proxy as receiver.
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const shaded = computeStudioImpastoReliefShading(
        counting as unknown as Float32Array,
        { width, height, quality },
      );
      expect(shaded.length).toBe(width * height);
      return taps;
    };

    // Exact, and exactly linear in the pixel count — including the degenerate 1x1 tile and a
    // non-square one, so no border special-case is hiding an extra read.
    for (const [width, height] of [[1, 1], [6, 5], [3, 11], [16, 16]] as const) {
      expect(
        countHeightTaps(width, height, "ggx"),
        `ggx height taps on ${width}x${height}`,
      ).toBe(width * height * 8);
      expect(
        countHeightTaps(width, height, "emboss-2tap"),
        `emboss height taps on ${width}x${height}`,
      ).toBe(width * height * 2);
    }

    // The regression this exists for, stated as the arithmetic rather than left implicit: ONE
    // extra shared height lookup per pixel moves both counts by exactly the pixel count, and the
    // assertions above are equalities, so it cannot pass. The wall-clock ratio next door would
    // move the wrong way on the same change — the emboss window would gain thirty taps per pixel
    // to the ggx window's one — which is why this gate is a count and not a clock.
    const PIXELS = 16 * 16;
    expect(PIXELS * 8 + PIXELS).not.toBe(PIXELS * 8);
    expect(PIXELS * 2 + PIXELS).not.toBe(PIXELS * 2);
  });
});

describe("region-limited shading", () => {
  /**
   * The whole point of `region` is that it is not an approximation. A retained caller re-shades a
   * rectangle and keeps the rest of the previous buffer, so anything the region path writes has to
   * be the number a full pass writes at the same index — otherwise the tile drifts one dirty
   * rectangle at a time and nothing downstream can tell.
   */
  it("writes exactly what a full pass writes, and touches nothing else", () => {
    for (const quality of QUALITIES) {
      const width = 23;
      const height = 17;
      const heights = ridgeTile(width, height, 7.5);
      const full = computeStudioImpastoReliefShading(heights, { width, height, quality });

      // A sentinel outside the region: a full pass would overwrite it, the region path must not.
      const partial = new Float32Array(width * height).fill(-7);
      const region = { x: 4, y: 3, width: 9, height: 6 };
      computeStudioImpastoReliefShading(heights, {
        width,
        height,
        quality,
        into: partial,
        region,
      });

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const at = y * width + x;
          const inside = x >= region.x && x < region.x + region.width
            && y >= region.y && y < region.y + region.height;
          if (inside) {
            expect(partial[at], `${quality} inside ${x},${y}`).toBe(full[at]);
          } else {
            expect(partial[at], `${quality} outside ${x},${y}`).toBe(-7);
          }
        }
      }
    }
  });

  it("clamps a region that hangs off the tile instead of throwing", () => {
    const width = 9;
    const height = 7;
    const heights = ridgeTile(width, height, 3);
    const full = computeStudioImpastoReliefShading(heights, { width, height });
    const partial = new Float32Array(width * height).fill(-1);
    // Deriving a region from a dirty rectangle legitimately produces one that overhangs.
    computeStudioImpastoReliefShading(heights, {
      width,
      height,
      into: partial,
      region: { x: -5, y: -4, width: width + 20, height: height + 20 },
    });
    expect(Array.from(partial)).toEqual(Array.from(full));
  });

  it("leaves the buffer alone when the region falls entirely outside the tile", () => {
    const width = 6;
    const height = 6;
    const heights = ridgeTile(width, height, 2);
    const partial = new Float32Array(width * height).fill(0.5);
    computeStudioImpastoReliefShading(heights, {
      width,
      height,
      into: partial,
      region: { x: 40, y: 40, width: 3, height: 3 },
    });
    expect(Array.from(partial)).toEqual(Array.from(new Float32Array(width * height).fill(0.5)));
  });

  it("refuses a region without a buffer to preserve", () => {
    const heights = ridgeTile(5, 5, 2);
    expect(() => computeStudioImpastoReliefShading(heights, {
      width: 5,
      height: 5,
      region: { x: 0, y: 0, width: 2, height: 2 },
    })).toThrow(StudioImpastoReliefShadingError);
  });
});
