import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STUDIO_VOLUME_DIM_STEP_JITTER,
  createStudioVolumeSampler,
  studioVolumeHashFloat,
  studioVolumeHashKeys,
  studioVolumeHashU32,
  studioVolumePixelOffset,
  studioVolumeStratifiedOffset,
} from "./studio-volume-sampler";

describe("studio-volume-sampler · 결정성", () => {
  it("Math.random / Date.now 를 소스에서 쓰지 않는다", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      "studio-volume-sampler.ts",
      "studio-volume-raymarch.ts",
      "studio-volume-transmittance.ts",
      "studio-volume-render.ts",
      "studio-volume-grid.ts",
      "studio-volume-phase.ts",
      "studio-volume-emission.ts",
      "studio-volume-occupancy.ts",
      "studio-volume-device.ts",
    ];
    for (const file of files) {
      // 호출 형태로만 찾는다(주석에 "Math.random 을 쓰지 않는다" 같은 문장이 있다).
      const source = readFileSync(path.join(here, file), "utf8");
      expect(source, file).not.toContain("Math.random(");
      expect(source, file).not.toContain("Date.now(");
      expect(source, file).not.toContain("performance.now(");
      expect(source, file).not.toContain("crypto.getRandomValues");
    }
  });

  it("같은 키는 항상 같은 값(전역 상태 없음)", () => {
    expect(studioVolumeHashU32(12345)).toBe(studioVolumeHashU32(12345));
    expect(studioVolumeHashKeys(1, 2, 3)).toBe(studioVolumeHashKeys(1, 2, 3));
    expect(studioVolumeHashFloat(9, 8, 7)).toBe(studioVolumeHashFloat(9, 8, 7));
  });

  it("해시는 부호 없는 32비트 정수를 낸다", () => {
    for (let i = 0; i < 2000; i += 1) {
      const h = studioVolumeHashU32(i);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(4294967296);
    }
  });

  it("난수는 [0,1) 안에 머문다", () => {
    let min = 1;
    let max = 0;
    for (let i = 0; i < 50000; i += 1) {
      const u = studioVolumeHashFloat(4242, i, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      if (u < min) min = u;
      if (u > max) max = u;
    }
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it("균등성: 10칸 히스토그램이 기대치의 ±3% 안", () => {
    const bins = new Array(10).fill(0);
    const n = 200000;
    for (let i = 0; i < n; i += 1) {
      bins[Math.floor(studioVolumeHashFloat(77, i, 5) * 10)] += 1;
    }
    for (const count of bins) {
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.003);
    }
  });

  it("키가 하나만 달라도 값이 갈린다(차원 상관 없음)", () => {
    const a = studioVolumeHashFloat(1, 100, 0);
    const b = studioVolumeHashFloat(1, 100, 1);
    const c = studioVolumeHashFloat(1, 101, 0);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("studio-volume-sampler · 서브스트림", () => {
  it("같은 키로 만든 두 샘플러는 같은 수열을 낸다", () => {
    const a = createStudioVolumeSampler(5, 6, 7);
    const b = createStudioVolumeSampler(5, 6, 7);
    for (let i = 0; i < 32; i += 1) expect(a.next()).toBe(b.next());
    expect(a.drawn).toBe(32);
  });

  it("rekey 는 새로 만든 샘플러와 완전히 동일하다(핫패스 재사용 안전)", () => {
    const reused = createStudioVolumeSampler(0, 0);
    reused.next();
    reused.next();
    reused.rekey(11, 22, 33);
    const fresh = createStudioVolumeSampler(11, 22, 33);
    expect(reused.drawn).toBe(0);
    for (let i = 0; i < 16; i += 1) expect(reused.next()).toBe(fresh.next());
  });

  it("reset 은 같은 수열을 재생한다", () => {
    const s = createStudioVolumeSampler(3, 1, 4);
    const first = [s.next(), s.next(), s.next()];
    s.reset();
    expect([s.next(), s.next(), s.next()]).toEqual(first);
  });

  it("서로 다른 키 스트림은 상관이 없다(첫 32개 값이 전부 다름)", () => {
    const a = createStudioVolumeSampler(1, 0);
    const b = createStudioVolumeSampler(1, 1);
    for (let i = 0; i < 32; i += 1) expect(a.next()).not.toBe(b.next());
  });
});

describe("studio-volume-sampler · 계층화 지터", () => {
  it("strength 0 은 정확히 스텝 중점이다", () => {
    for (let k = 0; k < 10; k += 1) {
      expect(studioVolumeStratifiedOffset(1, 2, k, 0)).toBe(0.5);
    }
  });

  it("strength 1 은 [0,1) 을 채우고 평균이 0.5 에 수렴한다", () => {
    let sum = 0;
    const n = 100000;
    for (let k = 0; k < n; k += 1) {
      const o = studioVolumeStratifiedOffset(99, 1, k, 1);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(1);
      sum += o;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  it("strength 0.5 는 중점 주변 [0.25, 0.75) 로 제한된다", () => {
    for (let k = 0; k < 5000; k += 1) {
      const o = studioVolumeStratifiedOffset(5, 5, k, 0.5);
      expect(o).toBeGreaterThanOrEqual(0.25);
      expect(o).toBeLessThan(0.75);
    }
  });

  it("지터는 스텝 인덱스 키에만 의존한다(마칭 경로와 무관)", () => {
    // 스킵 경로가 k=0,1 을 건너뛰어도 k=7 의 지터는 동일해야 한다.
    const direct = studioVolumeStratifiedOffset(42, 3, 7, 1);
    expect(direct).toBe(studioVolumeHashFloat(42, 3, 7, STUDIO_VOLUME_DIM_STEP_JITTER));
  });

  it("픽셀 오프셋은 두 축 모두 [0,1) 이고 결정적이다", () => {
    const a = studioVolumePixelOffset(1, 2, 3);
    const b = studioVolumePixelOffset(1, 2, 3);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[0]).toBeGreaterThanOrEqual(0);
    expect(a[0]).toBeLessThan(1);
    expect(a[1]).toBeGreaterThanOrEqual(0);
    expect(a[1]).toBeLessThan(1);
    expect(a[0]).not.toBe(a[1]);
  });
});
