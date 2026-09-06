import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STUDIO_PATHTRACE_DIMENSION,
  STUDIO_PATHTRACE_U32_TO_UNIT,
  buildStudioPathtraceOnb,
  sampleStudioPathtraceCosineHemisphere,
  sampleStudioPathtraceGgxVndf,
  sampleStudioPathtraceUniformDisk,
  sampleStudioPathtraceUniformTriangle,
  studioPathtraceHash,
  studioPathtracePcgHash,
  studioPathtraceRandom01,
  studioPathtraceStrataPerAxis,
  studioPathtraceStratifiedPixelSample,
} from "./studio-pathtrace-sampler";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ENGINE_FILES = [
  "studio-pathtrace-sampler.ts",
  "studio-pathtrace-geometry.ts",
  "studio-pathtrace-bvh.ts",
  "studio-pathtrace-bsdf.ts",
  "studio-pathtrace-integrator.ts",
  "studio-pathtrace-film.ts",
  "studio-pathtrace-cpu-renderer.ts",
  "studio-pathtrace-scene.ts",
  "studio-pathtrace-wgsl.ts",
];

/** 주석을 제거한 실행 코드만 남긴다(문서에 적힌 "Math.random 금지" 문구가 오탐되지 않게). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("studio-pathtrace-sampler 결정성 계약", () => {
  it("엔진 실행 코드 어디에도 Math.random / Date.now 가 없다", () => {
    for (const file of ENGINE_FILES) {
      const code = stripComments(readFileSync(path.join(HERE, file), "utf-8"));
      expect(code, `${file} 에 Math.random 이 있다`).not.toMatch(/Math\s*\.\s*random/);
      expect(code, `${file} 에 Date.now 가 있다`).not.toMatch(/Date\s*\.\s*now/);
      expect(code, `${file} 에 performance.now 가 있다`).not.toMatch(/performance\s*\.\s*now/);
      expect(code, `${file} 에 setTimeout 이 있다`).not.toMatch(/setTimeout|requestAnimationFrame/);
    }
  });

  it("주석 제거 헬퍼가 실제 코드를 남긴다(위 단언이 공허하지 않다는 확인)", () => {
    const code = stripComments(readFileSync(path.join(HERE, "studio-pathtrace-sampler.ts"), "utf-8"));
    expect(code).toContain("export function studioPathtraceHash");
    expect(code).toContain("Math.imul");
    expect(stripComments("/* Math.random */ const a = 1;")).not.toContain("random");
  });

  it("같은 5-튜플은 항상 같은 u32 를 만든다", () => {
    const a = studioPathtraceHash(1234, 7, 2, 3, 99);
    const b = studioPathtraceHash(1234, 7, 2, 3, 99);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it("인자 하나만 바뀌어도 값이 바뀐다(차원 붕괴 없음)", () => {
    const base = studioPathtraceHash(10, 20, 1, 2, 3);
    expect(studioPathtraceHash(11, 20, 1, 2, 3)).not.toBe(base);
    expect(studioPathtraceHash(10, 21, 1, 2, 3)).not.toBe(base);
    expect(studioPathtraceHash(10, 20, 2, 2, 3)).not.toBe(base);
    expect(studioPathtraceHash(10, 20, 1, 3, 3)).not.toBe(base);
    expect(studioPathtraceHash(10, 20, 1, 2, 4)).not.toBe(base);
  });

  it("PCG 출력은 u32 범위이고 8192개 입력에서 충돌이 없다", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 8192; i += 1) {
      const h = studioPathtracePcgHash(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      seen.add(h);
    }
    expect(seen.size).toBe(8192);
  });

  it("random01 은 [0,1) 이고 평균이 0.5 근처다", () => {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const v = studioPathtraceRandom01(i, 3, 1, 0, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
    expect(STUDIO_PATHTRACE_U32_TO_UNIT * 0xffffffff).toBeLessThan(1);
  });

  it("서로 다른 차원은 상관관계가 낮다", () => {
    const n = 20000;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i += 1) {
      const x = studioPathtraceRandom01(i, 0, 0, STUDIO_PATHTRACE_DIMENSION.bsdfU, 11);
      const y = studioPathtraceRandom01(i, 0, 0, STUDIO_PATHTRACE_DIMENSION.bsdfV, 11);
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const cov = sxy / n - (sx / n) * (sy / n);
    const vx = sxx / n - (sx / n) ** 2;
    const vy = syy / n - (sy / n) ** 2;
    const corr = cov / Math.sqrt(vx * vy);
    expect(Math.abs(corr)).toBeLessThan(0.02);
  });
});

describe("studio-pathtrace-sampler 층화", () => {
  it("완전제곱 spp 는 스트라텀마다 정확히 1샘플을 방문한다", () => {
    const spp = 16;
    const strata = studioPathtraceStrataPerAxis(spp);
    expect(strata).toBe(4);
    const visits = new Map<string, number>();
    const out = [0, 0];
    for (let s = 0; s < spp; s += 1) {
      studioPathtraceStratifiedPixelSample(42, s, spp, 5, out);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThan(1);
      expect(out[1]).toBeGreaterThanOrEqual(0);
      expect(out[1]).toBeLessThan(1);
      const key = `${Math.floor(out[0] * strata)},${Math.floor(out[1] * strata)}`;
      visits.set(key, (visits.get(key) ?? 0) + 1);
    }
    expect(visits.size).toBe(spp);
    for (const count of visits.values()) expect(count).toBe(1);
  });

  it("비완전제곱 spp 도 유효 범위를 벗어나지 않는다", () => {
    const out = [0, 0];
    for (let s = 0; s < 30; s += 1) {
      studioPathtraceStratifiedPixelSample(1, s, 10, 3, out);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThan(1);
      expect(out[1]).toBeGreaterThanOrEqual(0);
      expect(out[1]).toBeLessThan(1);
    }
    expect(studioPathtraceStrataPerAxis(10)).toBe(3);
    expect(studioPathtraceStrataPerAxis(0)).toBe(1);
    expect(studioPathtraceStrataPerAxis(Number.NaN)).toBe(1);
  });
});

describe("studio-pathtrace-sampler 워핑", () => {
  it("디스크 샘플은 단위원 안이고 사분면에 고르게 퍼진다", () => {
    const out = [0, 0];
    const quadrants = [0, 0, 0, 0];
    const n = 8000;
    for (let i = 0; i < n; i += 1) {
      const u1 = studioPathtraceRandom01(i, 0, 0, 0, 1);
      const u2 = studioPathtraceRandom01(i, 0, 0, 1, 1);
      sampleStudioPathtraceUniformDisk(u1, u2, out);
      expect(out[0] * out[0] + out[1] * out[1]).toBeLessThanOrEqual(1 + 1e-12);
      quadrants[(out[0] >= 0 ? 0 : 1) + (out[1] >= 0 ? 0 : 2)] += 1;
    }
    for (const q of quadrants) {
      expect(q / n).toBeGreaterThan(0.22);
      expect(q / n).toBeLessThan(0.28);
    }
  });

  it("코사인 반구 샘플은 단위 벡터이고 E[cosθ] = 2/3 이다", () => {
    const out = [0, 0, 0];
    let sumZ = 0;
    const n = 40000;
    for (let i = 0; i < n; i += 1) {
      const u1 = studioPathtraceRandom01(i, 1, 0, 0, 2);
      const u2 = studioPathtraceRandom01(i, 1, 0, 1, 2);
      sampleStudioPathtraceCosineHemisphere(u1, u2, out);
      const len = Math.hypot(out[0], out[1], out[2]);
      expect(Math.abs(len - 1)).toBeLessThan(1e-9);
      expect(out[2]).toBeGreaterThanOrEqual(0);
      sumZ += out[2];
    }
    // 코사인 가중 분포의 E[cosθ] = ∫cos²θ sinθ dθ dφ / π = 2/3
    expect(Math.abs(sumZ / n - 2 / 3)).toBeLessThan(0.005);
  });

  it("GGX VNDF half vector 는 단위 벡터이고 상반구에 있으며 roughness 에 따라 퍼진다", () => {
    const out = [0, 0, 0];
    const spread: number[] = [];
    for (const alpha of [0.02, 0.3]) {
      let sumTilt = 0;
      const n = 5000;
      for (let i = 0; i < n; i += 1) {
        const u1 = studioPathtraceRandom01(i, 2, 0, 0, 3);
        const u2 = studioPathtraceRandom01(i, 2, 0, 1, 3);
        sampleStudioPathtraceGgxVndf(0.3, 0, Math.sqrt(1 - 0.09), alpha, u1, u2, out);
        expect(Math.abs(Math.hypot(out[0], out[1], out[2]) - 1)).toBeLessThan(1e-9);
        expect(out[2]).toBeGreaterThan(0);
        sumTilt += Math.acos(Math.min(1, out[2]));
      }
      spread.push(sumTilt / n);
    }
    expect(spread[0]).toBeLessThan(spread[1]);
    expect(spread[0]).toBeLessThan(0.05);
  });

  it("삼각형 균등 샘플의 무게중심 합은 1 이하이고 평균이 1/3 이다", () => {
    const out = [0, 0];
    let sum0 = 0;
    let sum1 = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const u1 = studioPathtraceRandom01(i, 3, 0, 0, 4);
      const u2 = studioPathtraceRandom01(i, 3, 0, 1, 4);
      sampleStudioPathtraceUniformTriangle(u1, u2, out);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[1]).toBeGreaterThanOrEqual(0);
      expect(out[0] + out[1]).toBeLessThanOrEqual(1 + 1e-12);
      sum0 += out[0];
      sum1 += out[1];
    }
    expect(Math.abs(sum0 / n - 1 / 3)).toBeLessThan(0.01);
    expect(Math.abs(sum1 / n - 1 / 3)).toBeLessThan(0.01);
  });

  it("ONB 는 정규직교이며 z 가 음수인 노멀에서도 성립한다", () => {
    const onb = new Float64Array(6);
    const rawNormals: readonly [number, number, number][] = [
      [0, 0, 1],
      [0, 0, -1],
      [0.6, 0.8, 0],
      [-1, 2, -3],
      [0.001, -0.002, 0.9999],
    ];
    const normals = rawNormals.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      return [x / len, y / len, z / len] as const;
    });
    for (const [nx, ny, nz] of normals) {
      buildStudioPathtraceOnb(nx, ny, nz, onb);
      const t: [number, number, number] = [onb[0], onb[1], onb[2]];
      const b: [number, number, number] = [onb[3], onb[4], onb[5]];
      expect(Math.abs(Math.hypot(...t) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(Math.hypot(...b) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(t[0] * b[0] + t[1] * b[1] + t[2] * b[2])).toBeLessThan(1e-9);
      expect(Math.abs(t[0] * nx + t[1] * ny + t[2] * nz)).toBeLessThan(1e-9);
      expect(Math.abs(b[0] * nx + b[1] * ny + b[2] * nz)).toBeLessThan(1e-9);
    }
  });
});
