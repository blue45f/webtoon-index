import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_SSAO_MAX_CPU_PIXELS,
  blurStudioPbrSsao,
  buildStudioPbrSsaoKernel,
  buildStudioPbrSsaoRotationTexture,
  computeStudioPbrSsao,
  encodeStudioPbrAoLayer,
  type StudioPbrSsaoInput,
  type StudioPbrSsaoParams,
} from "./studio-pbr-ssao";

const WIDTH = 48;
const HEIGHT = 48;
const FOCAL = 1 / Math.tan((60 * Math.PI) / 360); // fov 60°

/** 카메라를 정면으로 마주 보는 평면(깊이 일정). */
function flatPlane(depth: number): StudioPbrSsaoInput {
  const viewZ = new Float32Array(WIDTH * HEIGHT).fill(depth);
  const normal = new Float32Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) normal[i * 3 + 2] = 1;
  return { width: WIDTH, height: HEIGHT, viewZ, normal };
}

/** 왼쪽 절반이 카메라 쪽으로 튀어나온 계단(직각 코너). */
function stepScene(farDepth: number, nearDepth: number): StudioPbrSsaoInput {
  const viewZ = new Float32Array(WIDTH * HEIGHT);
  const normal = new Float32Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = y * WIDTH + x;
      viewZ[i] = x < WIDTH / 2 ? nearDepth : farDepth;
      normal[i * 3 + 2] = 1;
    }
  }
  return { width: WIDTH, height: HEIGHT, viewZ, normal };
}

const PARAMS: StudioPbrSsaoParams = {
  radius: 0.5,
  bias: 0.01,
  intensity: 1,
  sampleCount: 24,
  seed: 1234,
  focalX: FOCAL,
  focalY: FOCAL,
};

describe("studio-pbr-ssao: 커널 생성", () => {
  it("모든 표본이 +Z 반구 안이고 단위 구를 벗어나지 않는다", () => {
    const kernel = buildStudioPbrSsaoKernel({ sampleCount: 64, seed: 7 });
    expect(kernel.length).toBe(64 * 3);
    for (let i = 0; i < 64; i += 1) {
      const x = kernel[i * 3];
      const y = kernel[i * 3 + 1];
      const z = kernel[i * 3 + 2];
      expect(z).toBeGreaterThanOrEqual(0);
      expect(Math.sqrt(x * x + y * y + z * z)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("스케일 바이어스로 앞쪽 표본이 원점에 더 가깝다", () => {
    const n = 64;
    const kernel = buildStudioPbrSsaoKernel({ sampleCount: n, seed: 7 });
    const lengthAt = (i: number): number =>
      Math.sqrt(kernel[i * 3] ** 2 + kernel[i * 3 + 1] ** 2 + kernel[i * 3 + 2] ** 2);
    // 첫 표본은 0.1 배 스케일, 마지막은 1 에 가깝다.
    expect(lengthAt(0)).toBeCloseTo(0.1, 5);
    expect(lengthAt(n - 1)).toBeGreaterThan(0.9);
    // 평균 반경이 균등 분포(0.5)보다 작아야 접촉부 밀도가 높아진다.
    let mean = 0;
    for (let i = 0; i < n; i += 1) mean += lengthAt(i);
    expect(mean / n).toBeLessThan(0.5);
  });

  it("같은 seed 는 바이트 동일, 다른 seed 는 다르다(Math.random 없음)", () => {
    const a = buildStudioPbrSsaoKernel({ sampleCount: 16, seed: 42 });
    const b = buildStudioPbrSsaoKernel({ sampleCount: 16, seed: 42 });
    const c = buildStudioPbrSsaoKernel({ sampleCount: 16, seed: 43 });
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });

  it("회전 텍스처는 전부 단위 벡터이고 seed 결정적이다", () => {
    const texture = buildStudioPbrSsaoRotationTexture(4, 99);
    expect(texture.length).toBe(4 * 4 * 2);
    for (let i = 0; i < 16; i += 1) {
      const x = texture[i * 2];
      const y = texture[i * 2 + 1];
      expect(Math.sqrt(x * x + y * y)).toBeCloseTo(1, 6);
    }
    expect(Array.from(buildStudioPbrSsaoRotationTexture(4, 99))).toEqual(Array.from(texture));
    expect(Array.from(buildStudioPbrSsaoRotationTexture(4, 100))).not.toEqual(Array.from(texture));
  });

  it("잘못된 인자는 던진다", () => {
    expect(() => buildStudioPbrSsaoKernel({ sampleCount: 0, seed: 1 })).toThrow();
    expect(() => buildStudioPbrSsaoRotationTexture(0, 1)).toThrow();
  });
});

describe("studio-pbr-ssao: 가림 계산", () => {
  it("가림이 없는 평면은 AO 가 정확히 1 이다", () => {
    const ao = computeStudioPbrSsao(flatPlane(5), PARAMS);
    for (let i = 0; i < ao.length; i += 1) expect(ao[i]).toBe(1);
  });

  it("배경(viewZ ≤ 0)은 1 로 남는다 — 하늘에 해칭이 들어가면 안 된다", () => {
    const scene = flatPlane(5);
    const viewZ = Float32Array.from(scene.viewZ);
    viewZ[0] = 0;
    viewZ[1] = -3;
    const ao = computeStudioPbrSsao({ ...scene, viewZ }, PARAMS);
    expect(ao[0]).toBe(1);
    expect(ao[1]).toBe(1);
  });

  it("직각 코너에서 AO 가 정량적으로 떨어지고, 멀어지면 회복한다", () => {
    const ao = computeStudioPbrSsao(stepScene(5, 4.7), PARAMS);
    const row = Math.floor(HEIGHT / 2);
    const atCorner = ao[row * WIDTH + Math.floor(WIDTH / 2)];
    const nearCorner = ao[row * WIDTH + Math.floor(WIDTH / 2) + 2];
    const farFromCorner = ao[row * WIDTH + WIDTH - 2];
    // 코너 바로 옆(먼 쪽 평면)은 가까운 벽에 실제로 가려진다.
    expect(atCorner).toBeLessThan(0.9);
    expect(atCorner).toBeGreaterThan(0);
    // 가림은 코너에서 멀어질수록 약해진다.
    expect(nearCorner).toBeGreaterThan(atCorner);
    // 반경 밖은 완전히 회복한다.
    expect(farFromCorner).toBe(1);
  });

  it("intensity 0 이면 AO 가 전부 1 이고, 키우면 단조로 어두워진다", () => {
    const scene = stepScene(5, 4.7);
    const at = (intensity: number): number => {
      const ao = computeStudioPbrSsao(scene, { ...PARAMS, intensity });
      return ao[Math.floor(HEIGHT / 2) * WIDTH + Math.floor(WIDTH / 2)];
    };
    expect(at(0)).toBe(1);
    const values = [0.25, 0.5, 0.75, 1].map(at);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  it("반경이 커질수록 더 넓은 영역이 어두워진다", () => {
    const scene = stepScene(5, 4.7);
    const darkCount = (radius: number): number => {
      const ao = computeStudioPbrSsao(scene, { ...PARAMS, radius });
      let count = 0;
      for (let i = 0; i < ao.length; i += 1) if (ao[i] < 0.99) count += 1;
      return count;
    };
    expect(darkCount(0.8)).toBeGreaterThan(darkCount(0.3));
  });

  it("같은 입력·같은 seed 는 바이트 동일한 결과다", () => {
    const scene = stepScene(5, 4.7);
    const a = computeStudioPbrSsao(scene, PARAMS);
    const b = computeStudioPbrSsao(scene, PARAMS);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("AO 값이 항상 [0,1] 이다", () => {
    const ao = computeStudioPbrSsao(stepScene(5, 4.0), { ...PARAMS, radius: 1.5, intensity: 1 });
    for (let i = 0; i < ao.length; i += 1) {
      expect(ao[i]).toBeGreaterThanOrEqual(0);
      expect(ao[i]).toBeLessThanOrEqual(1);
    }
  });

  it("입력 길이 불일치·잘못된 반경은 던진다", () => {
    const scene = flatPlane(5);
    expect(() => computeStudioPbrSsao({ ...scene, viewZ: new Float32Array(3) }, PARAMS)).toThrow();
    expect(() => computeStudioPbrSsao({ ...scene, normal: new Float32Array(3) }, PARAMS)).toThrow();
    expect(() => computeStudioPbrSsao(scene, { ...PARAMS, radius: 0 })).toThrow();
  });

  it("CPU 픽셀 상한을 넘으면 던지고, 명시 해제하면 통과한다", () => {
    const big = STUDIO_PBR_SSAO_MAX_CPU_PIXELS + 1;
    const oversized: StudioPbrSsaoInput = {
      width: big,
      height: 1,
      viewZ: new Float32Array(big),
      normal: new Float32Array(big * 3),
    };
    expect(() => computeStudioPbrSsao(oversized, PARAMS)).toThrow(/상한 초과/);
    // 해제 플래그가 실제로 가드를 건너뛴다(배경뿐이라 즉시 끝난다).
    const ao = computeStudioPbrSsao(oversized, { ...PARAMS, allowLargeCpuBuffer: true });
    expect(ao.length).toBe(big);
  });
});

describe("studio-pbr-ssao: 블러", () => {
  it("균일 필드는 블러해도 그대로다", () => {
    const ao = new Float32Array(8 * 8).fill(0.37);
    const blurred = blurStudioPbrSsao(ao, 8, 8, 2);
    for (let i = 0; i < blurred.length; i += 1) expect(blurred[i]).toBeCloseTo(0.37, 6);
  });

  it("radius 0 은 항등이지만 새 배열을 돌려준다", () => {
    const ao = Float32Array.from({ length: 16 }, (_, i) => i / 16);
    const blurred = blurStudioPbrSsao(ao, 4, 4, 0);
    expect(Array.from(blurred)).toEqual(Array.from(ao));
    expect(blurred).not.toBe(ao);
  });

  it("델타의 총합이 보존되고 실제로 퍼진다(에너지 보존)", () => {
    const size = 16;
    const ao = new Float32Array(size * size);
    const center = 8 * size + 8;
    ao[center] = 1;
    const blurred = blurStudioPbrSsao(ao, size, size, 2);
    let sum = 0;
    for (let i = 0; i < blurred.length; i += 1) sum += blurred[i];
    expect(sum).toBeCloseTo(1, 6);
    // 5×5 분리형 박스라 중심값은 정확히 1/25 여야 한다.
    expect(blurred[center]).toBeCloseTo(1 / 25, 8);
    // 커널 밖은 정확히 0.
    expect(blurred[8 * size + 11]).toBe(0);
  });

  it("반경이 클수록 피크가 낮아진다", () => {
    const size = 24;
    const ao = new Float32Array(size * size);
    ao[12 * size + 12] = 1;
    const peaks = [1, 2, 4].map((r) => blurStudioPbrSsao(ao, size, size, r)[12 * size + 12]);
    for (let i = 1; i < peaks.length; i += 1) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
  });

  it("길이 불일치·음수 반경은 던진다", () => {
    expect(() => blurStudioPbrSsao(new Float32Array(10), 4, 4, 1)).toThrow();
    expect(() => blurStudioPbrSsao(new Float32Array(16), 4, 4, -1)).toThrow();
  });
});

describe("studio-pbr-ssao: LT 레이어 인코딩", () => {
  it("AO 를 그레이스케일 RGBA 로 선형 양자화한다(sRGB 인코딩 없음)", () => {
    const ao = Float32Array.from([0, 0.5, 1, 0.25]);
    const bytes = encodeStudioPbrAoLayer(ao, 4, 1);
    expect(bytes.length).toBe(16);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0, 0, 0, 255]);
    // 0.5 는 sRGB 인코딩(≈188)이 아니라 선형 128 이어야 한다 — AO 는 곱셈 계수다.
    expect(bytes[4]).toBe(128);
    expect(bytes[8]).toBe(255);
    expect(bytes[12]).toBe(64);
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });

  it("범위 밖 값은 클램프된다", () => {
    const bytes = encodeStudioPbrAoLayer(Float32Array.from([-1, 2]), 2, 1);
    expect(bytes[0]).toBe(0);
    expect(bytes[4]).toBe(255);
  });

  it("길이 불일치는 던진다", () => {
    expect(() => encodeStudioPbrAoLayer(new Float32Array(3), 2, 2)).toThrow();
  });
});
