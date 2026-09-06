import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { computeStudioImpastoReliefShading } from "./studio-impasto-relief-shading-v1";

import type { StudioImpastoReliefShadingOptions } from "./studio-impasto-relief-shading-v1";

type HeightTile = Float32Array | Float64Array | Uint8Array | Uint8ClampedArray;
const saturate = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;

/**
 * Independent scalar oracle for the pre-hoist GGX path. Deliberately computes the half vector
 * and Fresnel term per normal, preserving the operation order from b51a9d23a35ac7d2736ddc4ab67eb498c1c81430.
 * Do not replace this with a call to the production kernel or share its precomputed constants.
 */
function referenceGgx(heights: HeightTile, options: StudioImpastoReliefShadingOptions): Float32Array {
  const { width, height } = options;
  const normalScale = (options.normalScale ?? 7) / (options.resolutionScale ?? 1);
  const roughness = options.roughness ?? 0.075;
  const f0 = options.f0 ?? 0.05;
  const specularScale = options.specularScale ?? 0.5;
  const diffuseScale = options.diffuseScale ?? 0.15;
  const max = options.maxShadingMultiplier ?? 4;
  const light = options.lightDirection ?? [0, -1, 1];
  const length = Math.sqrt(light[0] * light[0] + light[1] * light[1] + light[2] * light[2]);
  const lx = light[0] / length;
  const ly = light[1] / length;
  const lz = light[2] / length;
  const scale = (heights instanceof Uint8Array || heights instanceof Uint8ClampedArray ? 1 / 255 : 1) * (options.heightScale ?? 1);
  const out = options.into ?? new Float32Array(width * height);
  const shade = (nx: number, ny: number, nz: number) => {
    const halfLength = Math.sqrt(lx * lx + ly * ly + (lz + 1) * (lz + 1));
    const hx = lx / halfLength;
    const hy = ly / halfLength;
    const hz = (lz + 1) / halfLength;
    const nDotL = saturate(nx * lx + ny * ly + nz * lz);
    const nDotH = saturate(nx * hx + ny * hy + nz * hz);
    const nDotV = saturate(nz);
    const lDotH = saturate(lx * hx + ly * hy + lz * hz);
    const a2 = roughness * roughness;
    const d = nDotH * nDotH * (a2 - 1) + 1;
    const distribution = a2 / (Math.PI * d * d);
    const gl = nDotL + Math.sqrt(a2 + (1 - a2) * nDotL * nDotL);
    const gv = nDotV + Math.sqrt(a2 + (1 - a2) * nDotV * nDotV);
    const visibility = 1 / (gl * gv);
    const fresnel = (1 - f0) * ((1 - lDotH) ** 5) + f0;
    const diffuse = nDotL * diffuseScale + (1 - diffuseScale);
    return diffuse + distribution * visibility * fresnel * specularScale;
  };
  const flat = shade(0, 0, 1);
  const at = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]! * scale;
  const region = options.region;
  const x0 = region ? Math.max(0, Math.floor(region.x)) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y)) : 0;
  const x1 = region ? Math.min(width, Math.ceil(region.x + region.width)) : width;
  const y1 = region ? Math.min(height, Math.ceil(region.y + region.height)) : height;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const tl = at(x - 1, y - 1), top = at(x, y - 1), tr = at(x + 1, y - 1);
      const left = at(x - 1, y), right = at(x + 1, y);
      const bl = at(x - 1, y + 1), bottom = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = tl - tr + 2 * left - 2 * right + bl - br;
      const gy = tl + 2 * top + tr - bl - 2 * bottom - br;
      if (gx === 0 && gy === 0) { out[y * width + x] = 1; continue; }
      const normalLength = Math.sqrt(gx * gx + gy * gy + normalScale * normalScale);
      const value = shade(gx / normalLength, gy / normalLength, normalScale / normalLength) / flat;
      out[y * width + x] = value < 0 ? 0 : value > max ? max : value;
    }
  }
  return out;
}

function fixture(length: number): Float64Array {
  let seed = 784;
  return Float64Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0x1_0000_0000) * 255;
  });
}

function sameBytes(actual: Float32Array, expected: Float32Array) {
  assert.equal(actual.length, expected.length);
  assert.equal(Buffer.compare(
    Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
    Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
  ), 0, "the optimized shading must remain byte-identical to the scalar oracle");
}

const LIGHTS: readonly (readonly [number, number, number])[] = [
  [0, -1, 1], [0.4, 1, 2], [0, 0, 1], [1, 0, -0.25], [0.3, -0.4, 2],
];

describe("impasto shading call-local light constants", () => {
  it("preserves all bytes across four input encodings, small edges and material choices", () => {
    for (const ArrayType of [Float32Array, Float64Array, Uint8Array, Uint8ClampedArray]) {
      for (const [width, height] of [[1, 1], [1, 19], [23, 1], [17, 19], [67, 79]]) {
        const input = new ArrayType(fixture(width * height));
        for (let variant = 0; variant < 10; variant += 1) {
          const options: StudioImpastoReliefShadingOptions = {
            width, height, lightDirection: LIGHTS[variant % LIGHTS.length],
            heightScale: variant % 2 ? 3 : -0.5, normalScale: variant % 3 ? 7 : 2.25,
            resolutionScale: variant % 2 ? 1 : 2, roughness: variant % 4 ? 0.075 : 0.7,
            f0: variant % 3 ? 0.05 : 0.4, specularScale: variant % 5 ? 0.5 : 0,
            diffuseScale: variant % 2 ? 0.15 : 1, maxShadingMultiplier: variant % 3 ? 4 : 1,
          };
          sameBytes(computeStudioImpastoReliefShading(input, options), referenceGgx(input, options));
        }
      }
    }
  });

  it("matches the scalar path on a dense 40,000-cell relief field", () => {
    const input = Float32Array.from(fixture(40_000), (value) => value / 255);
    const options = { width: 200, height: 200, heightScale: 3 };
    sameBytes(computeStudioImpastoReliefShading(input, options), referenceGgx(input, options));
  });

  it("does not carry light or material constants into the next call", () => {
    const input = new Float32Array(fixture(323));
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const options = { width: 17, height: 19, lightDirection: LIGHTS[iteration % LIGHTS.length], f0: iteration % 2 ? 0.05 : 0.7, roughness: iteration % 2 ? 0.075 : 1 };
      sameBytes(computeStudioImpastoReliefShading(input, options), referenceGgx(input, options));
    }
  });

  it("preserves clipped retained updates, untouched sentinels and output buffer identity", () => {
    const input = new Float32Array(fixture(323));
    const before = input.slice();
    const actual = new Float32Array(323).fill(-7);
    const expected = actual.slice();
    for (const region of [{ x: -1.25, y: 2.1, width: 9.1, height: 12.7 }, { x: 14, y: 15, width: 20, height: 20 }]) {
      const options = { width: 17, height: 19, heightScale: 3, region };
      assert.equal(computeStudioImpastoReliefShading(input, { ...options, into: actual }), actual);
      referenceGgx(input, { ...options, into: expected });
      sameBytes(actual, expected);
    }
    assert.deepEqual(input, before);
    assert.equal(actual[0], -7);
  });

  it("keeps flat and empty-region results unchanged", () => {
    const input = new Float32Array(20).fill(0.4);
    assert.deepEqual(computeStudioImpastoReliefShading(input, { width: 4, height: 5 }), new Float32Array(20).fill(1));
    const into = new Float32Array(20).fill(-9);
    assert.equal(computeStudioImpastoReliefShading(input, { width: 4, height: 5, into, region: { x: 1, y: 1, width: 0, height: 2 } }), into);
    assert.deepEqual(into, new Float32Array(20).fill(-9));
  });

  it("leaves the explicit emboss fallback and its flat-light behavior intact", () => {
    const input = new Float32Array(fixture(323));
    assert.deepEqual(computeStudioImpastoReliefShading(input, { width: 17, height: 19, quality: "emboss-2tap", lightDirection: [0, 0, 1] }), new Float32Array(323).fill(1));
    const options = { width: 17, height: 19, quality: "emboss-2tap" as const };
    const output = computeStudioImpastoReliefShading(input, options);
    assert.ok(output.every((value) => Number.isFinite(value) && value >= 0 && value <= 4));
    sameBytes(output, computeStudioImpastoReliefShading(input, { ...options, f0: 0.9, roughness: 0.6 }));
  });

  it("still rejects invalid inputs instead of hiding them behind a cache", () => {
    const input = new Float32Array(1);
    for (const options of [
      { width: 0, height: 1 }, { width: 2, height: 1 },
      { width: 1, height: 1, roughness: 0 },
      { width: 1, height: 1, normalScale: Number.NaN },
      { width: 1, height: 1, lightDirection: [0, 0, 0] as const },
      { width: 1, height: 1, region: { x: 0, y: 0, width: 1, height: 1 } },
    ]) assert.throws(() => computeStudioImpastoReliefShading(input, options), { name: "StudioImpastoReliefShadingError" });
  });
});
