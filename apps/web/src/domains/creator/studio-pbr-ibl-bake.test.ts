import { describe, expect, it } from "vitest";

import { directionalAlbedoGgx, fresnelSchlick, srgbToLinear } from "./studio-pbr-brdf";
import {
  STUDIO_PBR_SH9_COEFFICIENTS,
  bakeStudioPbrBrdfLut,
  buildStudioPbrEnergyLossCurve,
  decodeStudioPbrEquirectLinear,
  evaluateStudioPbrIrradianceSh9,
  hashStudioPbrIblBake,
  integrateStudioPbrBrdfTexel,
  prefilterStudioPbrSpecularEquirect,
  projectStudioPbrIrradianceSh9,
  sampleStudioPbrBrdfLut,
  studioPbrDirectionToEquirectUv,
  studioPbrEquirectDirection,
  type StudioPbrEquirectSource,
} from "./studio-pbr-ibl-bake";

/** 균일 sRGB 바이트로 채운 equirect. */
function uniformEquirect(width: number, height: number, byte: number): StudioPbrEquirectSource {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = byte;
    rgba[i + 1] = byte;
    rgba[i + 2] = byte;
    rgba[i + 3] = 255;
  }
  return { width, height, rgba };
}

/** 위쪽 절반만 밝은 equirect(하늘/땅 대비). */
function skyGroundEquirect(width: number, height: number): StudioPbrEquirectSource {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const byte = y < height / 2 ? 240 : 20;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      rgba[i] = byte;
      rgba[i + 1] = byte;
      rgba[i + 2] = byte;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

describe("studio-pbr-ibl-bake: equirect 방향 매핑", () => {
  it("방향 ↔ UV 왕복이 텍셀 중심을 되돌린다", () => {
    const width = 64;
    const height = 32;
    for (const [x, y] of [
      [0, 0],
      [17, 5],
      [31, 16],
      [63, 31],
    ]) {
      const direction = studioPbrEquirectDirection(x, y, width, height);
      const [u, v] = studioPbrDirectionToEquirectUv(direction);
      expect(u * width - 0.5).toBeCloseTo(x, 6);
      expect(v * height - 0.5).toBeCloseTo(y, 6);
    }
  });

  it("y=0 행은 +Y(천정), 마지막 행은 -Y(천저)에 가깝다", () => {
    expect(studioPbrEquirectDirection(0, 0, 64, 32).y).toBeGreaterThan(0.99);
    expect(studioPbrEquirectDirection(0, 31, 64, 32).y).toBeLessThan(-0.99);
  });

  it("모든 방향이 단위 벡터다", () => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 32; x += 4) {
        const d = studioPbrEquirectDirection(x, y, 32, 16);
        expect(Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)).toBeCloseTo(1, 12);
      }
    }
  });

  it("디코딩이 sRGB → 선형 변환을 실제로 적용한다", () => {
    const linear = decodeStudioPbrEquirectLinear(uniformEquirect(4, 2, 128));
    const expected = srgbToLinear(128 / 255);
    expect(linear.rgb[0]).toBeCloseTo(expected, 6);
    // 선형화 없이 128/255 를 그대로 쓴 게 아니라는 것을 확인한다.
    expect(Math.abs(linear.rgb[0] - 128 / 255)).toBeGreaterThan(0.2);
  });
});

describe("studio-pbr-ibl-bake: BRDF LUT 해석해 대조", () => {
  it("roughness=0 에서 (scale,bias) 가 닫힌 해와 정확히 일치한다", () => {
    // α=0 이면 h=n 이므로 v·h = n·v = μ, G=1 이 되어
    //   scale = 1-(1-μ)⁵,  bias = (1-μ)⁵
    // 가 정확히 나온다. 즉 F0·scale+bias 는 정확히 Schlick 프레넬이다.
    for (const mu of [0.05, 0.25, 0.5, 0.75, 1]) {
      const [scale, bias] = integrateStudioPbrBrdfTexel(mu, 0, 32);
      const fc = Math.pow(1 - mu, 5);
      expect(scale).toBeCloseTo(1 - fc, 10);
      expect(bias).toBeCloseTo(fc, 10);
      for (const f0 of [0.04, 0.5, 0.9]) {
        expect(f0 * scale + bias).toBeCloseTo(fresnelSchlick(mu, f0), 10);
      }
    }
  });

  it("scale+bias 가 단일산란 방향 알베도 E(μ,α) 와 같다", () => {
    // 두 적분은 같은 추정량이므로 같은 샘플 수에서 수치적으로 일치해야 한다.
    for (const roughness of [0.2, 0.5, 0.85]) {
      for (const mu of [0.15, 0.6, 0.95]) {
        const [scale, bias] = integrateStudioPbrBrdfTexel(mu, roughness, 128);
        const e = directionalAlbedoGgx(mu, roughness * roughness, 128);
        expect(scale + bias).toBeCloseTo(e, 10);
      }
    }
  });

  it("LUT 전 텍셀이 에너지 상한을 지킨다 — 0 ≤ scale+bias ≤ 1", () => {
    const lut = bakeStudioPbrBrdfLut({ size: 32, sampleCount: 32 });
    for (let i = 0; i < lut.data.length; i += 2) {
      const scale = lut.data[i];
      const bias = lut.data[i + 1];
      expect(scale).toBeGreaterThanOrEqual(0);
      expect(bias).toBeGreaterThanOrEqual(0);
      expect(scale + bias).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("스침각(μ→0)일수록 bias 항이 커진다(프레넬 상승)", () => {
    const rough = 0.4;
    const grazing = integrateStudioPbrBrdfTexel(0.05, rough, 128);
    const facing = integrateStudioPbrBrdfTexel(0.95, rough, 128);
    expect(grazing[1]).toBeGreaterThan(facing[1]);
    expect(facing[1]).toBeLessThan(0.02);
  });

  it("LUT 조회가 텍셀 중심에서 저장값을 그대로 되돌린다", () => {
    const lut = bakeStudioPbrBrdfLut({ size: 16, sampleCount: 16 });
    const x = 5;
    const y = 9;
    const sampled = sampleStudioPbrBrdfLut(lut, (x + 0.5) / 16, (y + 0.5) / 16);
    expect(sampled.scale).toBeCloseTo(lut.data[(y * 16 + x) * 2], 6);
    expect(sampled.bias).toBeCloseTo(lut.data[(y * 16 + x) * 2 + 1], 6);
  });

  it("잘못된 크기/샘플수는 던진다", () => {
    expect(() => bakeStudioPbrBrdfLut({ size: 1 })).toThrow();
    expect(() => bakeStudioPbrBrdfLut({ size: 8, sampleCount: 0 })).toThrow();
  });

  it("에너지 손실 곡선이 러프니스에 따라 단조 감소한다", () => {
    const curve = buildStudioPbrEnergyLossCurve(6, 64);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]).toBeLessThan(curve[i - 1]);
    }
    expect(curve[0]).toBeGreaterThan(0.98);
  });
});

describe("studio-pbr-ibl-bake: SH9 확산", () => {
  it("균일 환경의 irradiance 가 π·L 로 수렴한다(법선과 무관하게)", () => {
    const byte = 128;
    const l = srgbToLinear(byte / 255);
    const target = Math.PI * l;
    const normals = [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.5773502691896258, y: 0.5773502691896258, z: 0.5773502691896258 },
    ];
    const worstErrorAt = (height: number): number => {
      const sh = projectStudioPbrIrradianceSh9(uniformEquirect(height * 2, height, byte));
      let worst = 0;
      for (const normal of normals) {
        const e = evaluateStudioPbrIrradianceSh9(sh, normal);
        // 세 채널이 같은 소스이므로 서로 정확히 같아야 한다.
        expect(e[1]).toBeCloseTo(e[0], 12);
        expect(e[2]).toBeCloseTo(e[0], 12);
        worst = Math.max(worst, Math.abs(e[0] - target));
      }
      return worst;
    };
    // 64×32 에서도 이미 0.05% 이내다 — 실용상 충분.
    expect(worstErrorAt(32)).toBeLessThan(target * 1e-3);
    // 그리고 실제로 π·L 로 2차 수렴한다(구적 오차이지 계산식 오류가 아님을 증명).
    const coarse = worstErrorAt(32);
    const fine = worstErrorAt(64);
    expect(fine).toBeLessThan(coarse);
    expect(coarse / fine).toBeGreaterThan(3);
    expect(coarse / fine).toBeLessThan(5);
    const finest = worstErrorAt(128);
    expect(finest).toBeLessThan(fine / 3);
    // 실측: 128행에서 상대오차 약 3.2·10⁻⁵. 이 아래로는 구적이 아니라
    // Ramamoorthi 상수의 6자리 반올림이 바닥을 만든다.
    expect(finest).toBeLessThan(target * 5e-5);
  });

  it("균일 환경의 1~2차 밴드 누출이 해상도에 대해 2차로 수렴한다", () => {
    // 기저를 텍셀 중심에서 평가하므로 누출이 정확히 0 은 아니다. 중요한 건 크기가 아니라
    // 수렴 차수다 — 해상도를 2배로 하면 누출이 약 1/4 로 줄어야 구적법이 맞은 것이다.
    const leakageAt = (height: number): number => {
      const sh = projectStudioPbrIrradianceSh9(uniformEquirect(height * 2, height, 200));
      expect(sh.length).toBe(STUDIO_PBR_SH9_COEFFICIENTS);
      let worst = 0;
      for (let band = 1; band < 9; band += 1) {
        for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(sh[band * 3 + c]));
      }
      return worst / sh[0];
    };
    const coarse = leakageAt(16);
    const fine = leakageAt(32);
    const finer = leakageAt(64);
    expect(coarse).toBeLessThan(5e-3);
    // 2차 수렴: 비율이 4 근처(3~5)여야 한다.
    expect(coarse / fine).toBeGreaterThan(3);
    expect(coarse / fine).toBeLessThan(5);
    expect(fine / finer).toBeGreaterThan(3);
    expect(fine / finer).toBeLessThan(5);
  });

  it("텍셀 입체각 합이 정확히 4π 다(에너지 보존의 전제)", () => {
    // 균일 radiance 1 을 넣으면 L00 = Y00·Σdω 이므로 Σdω 를 역산할 수 있다.
    const white = uniformEquirect(32, 16, 255);
    const sh = projectStudioPbrIrradianceSh9(white);
    const totalSolidAngle = sh[0] / 0.282095;
    expect(totalSolidAngle).toBeCloseTo(4 * Math.PI, 5);
  });

  it("하늘/땅 환경에서 위를 본 법선이 아래를 본 법선보다 훨씬 밝다", () => {
    const sh = projectStudioPbrIrradianceSh9(skyGroundEquirect(64, 32));
    const up = evaluateStudioPbrIrradianceSh9(sh, { x: 0, y: 1, z: 0 })[0];
    const down = evaluateStudioPbrIrradianceSh9(sh, { x: 0, y: -1, z: 0 })[0];
    const side = evaluateStudioPbrIrradianceSh9(sh, { x: 1, y: 0, z: 0 })[0];
    expect(up).toBeGreaterThan(down * 4);
    // 옆면은 위/아래 사이에 있어야 한다.
    expect(side).toBeGreaterThan(down);
    expect(side).toBeLessThan(up);
    // 1차 밴드의 y 성분(index 1)이 양수여야 한다 — 밝은 쪽이 +Y.
    expect(sh[3]).toBeGreaterThan(0);
  });

  it("계수 길이가 틀리면 던진다", () => {
    expect(() => evaluateStudioPbrIrradianceSh9(new Float32Array(9), { x: 0, y: 1, z: 0 })).toThrow();
  });
});

describe("studio-pbr-ibl-bake: 스페큘러 prefilter", () => {
  it("균일 환경은 모든 밉에서 그대로 보존된다(가중치 정규화 검증)", () => {
    const byte = 180;
    const expected = srgbToLinear(byte / 255);
    const result = prefilterStudioPbrSpecularEquirect({
      source: uniformEquirect(64, 32, byte),
      baseWidth: 32,
      mipCount: 4,
      sampleCount: 32,
    });
    expect(result.mips.length).toBe(4);
    for (const mip of result.mips) {
      for (let i = 0; i < mip.rgb.length; i += 1) {
        expect(mip.rgb[i]).toBeCloseTo(expected, 5);
      }
    }
  });

  it("밉 해상도와 러프니스가 단조 진행한다", () => {
    const result = prefilterStudioPbrSpecularEquirect({
      source: uniformEquirect(64, 32, 128),
      baseWidth: 64,
      mipCount: 5,
      sampleCount: 8,
    });
    expect(result.mips[0].roughness).toBe(0);
    expect(result.mips[4].roughness).toBe(1);
    for (let i = 1; i < result.mips.length; i += 1) {
      expect(result.mips[i].width).toBeLessThan(result.mips[i - 1].width);
      expect(result.mips[i].roughness).toBeGreaterThan(result.mips[i - 1].roughness);
      expect(result.mips[i].rgb.length).toBe(result.mips[i].width * result.mips[i].height * 3);
    }
  });

  it("러프한 밉일수록 분산이 단조 감소한다(컨볼루션은 수축 사상)", () => {
    // max-min 은 blur 척도로 부적합하다 — 넓은 균일 영역이 있으면 극값이 안 움직인다.
    // 분산은 어떤 저역통과 필터에도 반드시 줄어들므로 "실제로 흐려졌는가"를 잰다.
    const result = prefilterStudioPbrSpecularEquirect({
      source: skyGroundEquirect(128, 64),
      baseWidth: 64,
      mipCount: 4,
      sampleCount: 64,
    });
    const varianceOf = (mip: (typeof result.mips)[number]): number => {
      const count = mip.width * mip.height;
      let mean = 0;
      for (let i = 0; i < mip.rgb.length; i += 3) mean += mip.rgb[i];
      mean /= count;
      let sum = 0;
      for (let i = 0; i < mip.rgb.length; i += 3) sum += (mip.rgb[i] - mean) ** 2;
      return sum / count;
    };
    const variances = result.mips.map(varianceOf);
    // mip0(러프니스 0)은 단순 리샘플이라 계단이 그대로 남아 분산이 최대다.
    expect(variances[0]).toBeGreaterThan(0.1);
    for (let i = 1; i < variances.length; i += 1) {
      expect(variances[i]).toBeLessThan(variances[i - 1]);
    }
    // 가장 러프한 밉은 거의 평탄해진다.
    expect(variances[variances.length - 1]).toBeLessThan(variances[0] * 0.5);
  });

  it("잘못된 baseWidth/mipCount 는 던진다", () => {
    const source = uniformEquirect(16, 8, 100);
    expect(() => prefilterStudioPbrSpecularEquirect({ source, baseWidth: 3 })).toThrow();
    expect(() => prefilterStudioPbrSpecularEquirect({ source, mipCount: 1 })).toThrow();
  });

  it("rgba 길이가 해상도와 어긋나면 던진다", () => {
    expect(() =>
      projectStudioPbrIrradianceSh9({ width: 8, height: 4, rgba: new Uint8ClampedArray(10) }),
    ).toThrow();
  });
});

describe("studio-pbr-ibl-bake: 결정성", () => {
  it("같은 입력을 두 번 구우면 바이트 동일하다", () => {
    const source = skyGroundEquirect(32, 16);
    const first = {
      brdfLut: bakeStudioPbrBrdfLut({ size: 16, sampleCount: 16 }),
      sh9: projectStudioPbrIrradianceSh9(source),
      specular: prefilterStudioPbrSpecularEquirect({ source, baseWidth: 16, mipCount: 3, sampleCount: 16 }),
    };
    const second = {
      brdfLut: bakeStudioPbrBrdfLut({ size: 16, sampleCount: 16 }),
      sh9: projectStudioPbrIrradianceSh9(source),
      specular: prefilterStudioPbrSpecularEquirect({ source, baseWidth: 16, mipCount: 3, sampleCount: 16 }),
    };
    expect(Array.from(second.brdfLut.data)).toEqual(Array.from(first.brdfLut.data));
    expect(Array.from(second.sh9)).toEqual(Array.from(first.sh9));
    for (let i = 0; i < first.specular.mips.length; i += 1) {
      expect(Array.from(second.specular.mips[i].rgb)).toEqual(Array.from(first.specular.mips[i].rgb));
    }
    expect(hashStudioPbrIblBake(second)).toBe(hashStudioPbrIblBake(first));
  });

  it("다이제스트가 입력 변화에 반응한다", () => {
    const a = hashStudioPbrIblBake({ sh9: projectStudioPbrIrradianceSh9(uniformEquirect(16, 8, 100)) });
    const b = hashStudioPbrIblBake({ sh9: projectStudioPbrIrradianceSh9(uniformEquirect(16, 8, 101)) });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("샘플 수가 다르면 LUT 다이제스트가 달라진다", () => {
    const low = hashStudioPbrIblBake({ brdfLut: bakeStudioPbrBrdfLut({ size: 8, sampleCount: 8 }) });
    const high = hashStudioPbrIblBake({ brdfLut: bakeStudioPbrBrdfLut({ size: 8, sampleCount: 32 }) });
    expect(low).not.toBe(high);
  });
});
