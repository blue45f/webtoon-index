import { describe, expect, it } from "vitest";

import { normalizeStudioVolumeEmissionParams } from "./studio-volume-emission";
import {
  prepareStudioVolume,
  studioVolumeVoxelIndex,
  type StudioVolumePrepared,
} from "./studio-volume-grid";
import { buildStudioVolumeOccupancy } from "./studio-volume-occupancy";
import { henyeyGreensteinPhase } from "./studio-volume-phase";
import {
  STUDIO_VOLUME_DEFAULT_MARCH,
  integrateStudioVolumeRay,
  normalizeStudioVolumeMarch,
  normalizeStudioVolumeMedium,
  type StudioVolumeLight,
  type StudioVolumeMarchParams,
  type StudioVolumeScene,
} from "./studio-volume-raymarch";

function volumeFrom(
  n: number,
  fill: (i: number, j: number, k: number) => number,
  temperature?: (i: number, j: number, k: number) => number
): StudioVolumePrepared {
  const density = new Float32Array(n * n * n);
  const temp = temperature ? new Float32Array(n * n * n) : null;
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const index = studioVolumeVoxelIndex([n, n, n], i, j, k);
        density[index] = fill(i, j, k);
        if (temp && temperature) temp[index] = temperature(i, j, k);
      }
    }
  }
  return prepareStudioVolume({
    resolution: [n, n, n],
    density,
    temperature: temp,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  });
}

/** 가운데 구형 블롭 + 바깥은 완전히 빈 공간(스킵 테스트의 핵심 조건). */
function blobVolume(n = 32, radius = 0.22, hot = false): StudioVolumePrepared {
  const center = (index: number): number => (index + 0.5) / n - 0.5;
  return volumeFrom(
    n,
    (i, j, k) => {
      const r = Math.hypot(center(i), center(j), center(k));
      return r < radius ? 6 * (1 - r / radius) : 0;
    },
    hot
      ? (i, j, k) => {
          const r = Math.hypot(center(i), center(j), center(k));
          return r < radius ? 2200 * (1 - r / radius) : 0;
        }
      : undefined
  );
}

const LIGHT: StudioVolumeLight = {
  kind: "point",
  position: [2, 1.5, 0.5],
  color: [1, 0.95, 0.85],
  intensity: 6,
};

function sceneWith(overrides: Partial<StudioVolumeScene["medium"]> = {}): StudioVolumeScene {
  return {
    medium: normalizeStudioVolumeMedium({
      densityScale: 1.5,
      scatteringAlbedo: 0.85,
      anisotropy: 0.35,
      ...overrides,
    }),
    lights: [LIGHT],
  };
}

function march(overrides: Partial<StudioVolumeMarchParams> = {}): StudioVolumeMarchParams {
  return normalizeStudioVolumeMarch({ stepSize: 0.02, maxSteps: 256, seed: 20260724, ...overrides });
}

describe("studio-volume-raymarch · 빈 볼륨", () => {
  it("밀도가 전부 0 이면 투과율은 정확히 1, 인스캐터는 정확히 0", () => {
    const prepared = volumeFrom(16, () => 0);
    const result = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march(),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(result.transmittance).toBe(1);
    expect(result.alpha).toBe(0);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
    expect(result.depth).toBe(Number.POSITIVE_INFINITY);
    expect(result.expectedDepth).toBe(Number.POSITIVE_INFINITY);
    expect(result.shadowSamples).toBe(0);
  });

  it("밀도가 있어도 빈 영역만 지나가는 레이는 투과율 1(마칭 자체는 실행)", () => {
    const prepared = blobVolume(32);
    const result = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march(),
      null,
      -1,
      0.03,
      0.03,
      1,
      0,
      0,
      0
    );
    expect(result.densitySamples).toBeGreaterThan(10);
    expect(result.transmittance).toBe(1);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it("볼륨을 완전히 비껴가는 레이는 즉시 빈 결과", () => {
    const prepared = blobVolume(16);
    const result = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march(),
      null,
      -1,
      9,
      9,
      1,
      0,
      0,
      0
    );
    expect(result.transmittance).toBe(1);
    expect(result.densitySamples).toBe(0);
    expect(result.stepCount).toBe(0);
  });

  it("퇴화 볼륨(두께 0 bounds)도 던지지 않는다", () => {
    const degenerate = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 0, 0],
    });
    expect(() =>
      integrateStudioVolumeRay(degenerate, sceneWith(), march(), null, -1, 0, 0, 1, 0, 0, 0)
    ).not.toThrow();
    const result = integrateStudioVolumeRay(
      degenerate,
      sceneWith(),
      march(),
      null,
      -1,
      0,
      0,
      1,
      0,
      0,
      0
    );
    expect(result.transmittance).toBe(1);
  });

  it("1×1×1 볼륨도 정상 적분한다", () => {
    const prepared = prepareStudioVolume({
      resolution: [1, 1, 1],
      density: new Float32Array([2]),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    const occupancy = buildStudioVolumeOccupancy(prepared, 8);
    expect(occupancy.dims).toEqual([1, 1, 1]);
    const result = integrateStudioVolumeRay(
      prepared,
      sceneWith({ densityScale: 1 }),
      march({ jitter: 0 }),
      occupancy,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    // 균질 σ=2, d=1 → T = exp(-2).
    expect(result.transmittance).toBeCloseTo(Math.exp(-2), 10);
    expect(result.alpha).toBeCloseTo(1 - Math.exp(-2), 10);
    expect(result.r).toBeGreaterThan(0);
  });
});

describe("studio-volume-raymarch · 물리", () => {
  it("균질 매질의 마칭 투과율이 exp(-σd) 와 맞는다", () => {
    const prepared = volumeFrom(8, () => 3);
    for (const stepSize of [0.5, 0.1, 0.01]) {
      const result = integrateStudioVolumeRay(
        prepared,
        { medium: normalizeStudioVolumeMedium({ densityScale: 0.5 }), lights: [] },
        march({ stepSize, jitter: 0, transmittanceCutoff: 0 }),
        null,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        0
      );
      expect(result.transmittance).toBeCloseTo(Math.exp(-1.5), 10);
    }
  });

  it("알베도 0(순수 흡수)이면 산란 기여가 사라진다", () => {
    const prepared = blobVolume(24);
    const scattering = integrateStudioVolumeRay(
      prepared,
      sceneWith({ scatteringAlbedo: 0.9 }),
      march(),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const absorbing = integrateStudioVolumeRay(
      prepared,
      sceneWith({ scatteringAlbedo: 0 }),
      march(),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(scattering.r).toBeGreaterThan(0);
    expect(absorbing.r).toBe(0);
    // 소광은 알베도와 무관 → 투과율은 동일해야 한다.
    expect(absorbing.transmittance).toBeCloseTo(scattering.transmittance, 12);
  });

  it("역광(전방 산란)이 정면광보다 밝다 — HG g>0 규약 검증", () => {
    const prepared = blobVolume(24);
    // 카메라는 x=-1 에서 +x 를 본다. 역광 = 볼륨 뒤(+x)에 있는 광원이 -x 로 빛을 보내는 것
    // → 빛의 진행방향과 카메라로 향하는 방향이 같다(전방 산란, cosθ = +1).
    const behind: StudioVolumeLight = {
      kind: "directional",
      direction: [-1, 0, 0],
      color: [1, 1, 1],
      intensity: 1,
    };
    const front: StudioVolumeLight = {
      kind: "directional",
      direction: [1, 0, 0],
      color: [1, 1, 1],
      intensity: 1,
    };
    const backlit = integrateStudioVolumeRay(
      prepared,
      { medium: normalizeStudioVolumeMedium({ anisotropy: 0.7 }), lights: [behind] },
      march({ shadowMode: "none" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const frontlit = integrateStudioVolumeRay(
      prepared,
      { medium: normalizeStudioVolumeMedium({ anisotropy: 0.7 }), lights: [front] },
      march({ shadowMode: "none" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(backlit.r).toBeGreaterThan(frontlit.r);
    const ratio = backlit.r / frontlit.r;
    expect(ratio).toBeCloseTo(henyeyGreensteinPhase(0.7, 1) / henyeyGreensteinPhase(0.7, -1), 6);
  });

  it("g=0(등방)이면 광원 방향과 무관하게 같은 밝기다", () => {
    const prepared = blobVolume(24);
    const make = (dir: [number, number, number]): number =>
      integrateStudioVolumeRay(
        prepared,
        {
          medium: normalizeStudioVolumeMedium({ anisotropy: 0 }),
          lights: [{ kind: "directional", direction: dir, color: [1, 1, 1], intensity: 1 }],
        },
        march({ shadowMode: "none" }),
        null,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        0
      ).r;
    expect(make([1, 0, 0])).toBeCloseTo(make([-1, 0, 0]), 12);
    expect(make([0, 1, 0])).toBeCloseTo(make([1, 0, 0]), 12);
  });

  it("그림자를 켜면 인스캐터가 줄어든다(자기그림자)", () => {
    const prepared = blobVolume(24);
    const noShadow = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march({ shadowMode: "none" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const shadowed = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march({ shadowMode: "ratio-tracking" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(shadowed.r).toBeLessThan(noShadow.r);
    expect(shadowed.shadowSamples).toBeGreaterThan(0);
    expect(noShadow.shadowSamples).toBe(0);
  });

  it("광원 세기를 2배 하면 인스캐터도 정확히 2배(선형)", () => {
    const prepared = blobVolume(24);
    const base = integrateStudioVolumeRay(
      prepared,
      { medium: normalizeStudioVolumeMedium(), lights: [LIGHT] },
      march({ shadowMode: "none" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const doubled = integrateStudioVolumeRay(
      prepared,
      {
        medium: normalizeStudioVolumeMedium(),
        lights: [{ ...LIGHT, intensity: LIGHT.intensity * 2 }],
      },
      march({ shadowMode: "none" }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(doubled.r / base.r).toBeCloseTo(2, 10);
  });

  it("온도 필드는 방출을 더한다(광원 없이도 빛난다)", () => {
    const cold = blobVolume(24, 0.22, false);
    const hot = blobVolume(24, 0.22, true);
    const scene = (prepared: StudioVolumePrepared) =>
      integrateStudioVolumeRay(
        prepared,
        {
          medium: normalizeStudioVolumeMedium({
            densityScale: 1.5,
            scatteringAlbedo: 0.5,
            emission: normalizeStudioVolumeEmissionParams({ ignitionK: 900, referenceK: 1500 }),
            emissionScale: 1,
          }),
          lights: [],
        },
        march(),
        null,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        0
      );
    const coldResult = scene(cold);
    const hotResult = scene(hot);
    expect(coldResult.r).toBe(0);
    expect(hotResult.r).toBeGreaterThan(0);
    // 불은 붉다 — R > G > B.
    expect(hotResult.r).toBeGreaterThan(hotResult.g);
    expect(hotResult.g).toBeGreaterThan(hotResult.b);
  });

  it("깊이는 알파 임계 교차 거리이고 볼륨 스팬 안에 있다", () => {
    const prepared = blobVolume(32);
    const result = integrateStudioVolumeRay(
      prepared,
      sceneWith({ densityScale: 8 }),
      march({ depthAlphaThreshold: 0.5 }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(result.alpha).toBeGreaterThan(0.5);
    expect(result.depth).toBeGreaterThan(1);
    expect(result.depth).toBeLessThan(2);
    expect(result.expectedDepth).toBeGreaterThan(1);
    expect(result.expectedDepth).toBeLessThan(2);
  });

  it("maxDistance 로 배경 앞까지만 적분한다", () => {
    const prepared = blobVolume(32);
    const full = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march(),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const clipped = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march(),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0,
      1.5
    );
    expect(clipped.alpha).toBeLessThan(full.alpha);
    expect(clipped.transmittance).toBeGreaterThan(full.transmittance);
  });
});

describe("studio-volume-raymarch · 결정성", () => {
  it("같은 입력은 항상 비트 단위로 같은 결과를 낸다", () => {
    const prepared = blobVolume(24);
    const run = () =>
      integrateStudioVolumeRay(prepared, sceneWith(), march(), null, -1, 0.5, 0.5, 1, 0, 0, 17);
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it("seed 를 바꾸면 결과가 달라진다(난수가 실제로 쓰인다)", () => {
    const prepared = blobVolume(24);
    const a = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march({ seed: 1 }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    const b = integrateStudioVolumeRay(
      prepared,
      sceneWith(),
      march({ seed: 2 }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      0
    );
    expect(a.r).not.toBe(b.r);
    expect(Math.abs(a.r - b.r) / a.r).toBeLessThan(0.2);
  });

  it("march/medium 정규화는 쓰레기 값을 기본값으로 되돌린다", () => {
    const m = normalizeStudioVolumeMarch({
      stepSize: Number.NaN,
      maxSteps: -5,
      jitter: 99,
      shadowMode: "bogus" as never,
    });
    expect(m.stepSize).toBe(STUDIO_VOLUME_DEFAULT_MARCH.stepSize);
    expect(m.maxSteps).toBe(1);
    expect(m.jitter).toBe(1);
    expect(m.shadowMode).toBe("ratio-tracking");

    // 유한한 범위 밖 값은 클램프.
    const clamped = normalizeStudioVolumeMedium({
      densityScale: -7,
      scatteringAlbedo: 5,
      anisotropy: -3,
      ambientRadiance: [Number.NaN, 1, 2],
    });
    expect(clamped.densityScale).toBe(0);
    expect(clamped.scatteringAlbedo).toBe(1);
    expect(clamped.anisotropy).toBe(-0.995);
    expect(clamped.ambientRadiance).toEqual([0, 1, 2]);

    // 비유한 값은 클램프가 아니라 기본값으로 되돌린다(±Infinity 를 0/1e9 로 읽으면 의도와 다르다).
    const nonFinite = normalizeStudioVolumeMedium({
      densityScale: Number.NEGATIVE_INFINITY,
      anisotropy: Number.NaN,
    });
    expect(nonFinite.densityScale).toBe(1);
    expect(nonFinite.anisotropy).toBe(0.3);
  });
});

describe("studio-volume-raymarch · 빈 공간 스킵 동치성", () => {
  const prepared = blobVolume(32);
  const occupancy = buildStudioVolumeOccupancy(prepared, 8);
  const scene = sceneWith();

  /** 볼륨을 가로지르는 여러 레이(축 평행 + 대각선)로 두 경로를 비교한다. */
  const rays: Array<{ o: [number, number, number]; d: [number, number, number] }> = [];
  for (let i = 0; i < 24; i += 1) {
    const u = 0.15 + (0.7 * i) / 23;
    rays.push({ o: [-1, u, 0.5], d: [1, 0, 0] });
    rays.push({ o: [u, -1, 0.4], d: [0, 1, 0] });
  }
  const inv = Math.sqrt(1 / 3);
  rays.push({ o: [-0.5, -0.5, -0.5], d: [inv, inv, inv] });
  rays.push({ o: [1.5, 1.5, 1.5], d: [-inv, -inv, -inv] });
  const inv2 = Math.sqrt(1 / 2);
  rays.push({ o: [-0.5, -0.5, 0.5], d: [inv2, inv2, 0] });

  it("점유 블록은 전체의 절반 이하다(스킵할 여지가 실제로 있다)", () => {
    expect(occupancy.occupiedBlocks).toBeLessThanOrEqual(occupancy.totalBlocks / 2);
    expect(occupancy.occupiedBlocks).toBeGreaterThan(0);
  });

  it("스킵 결과가 나이브 마칭과 **비트 단위로** 동일하다", () => {
    let maxDiff = 0;
    let compared = 0;
    for (let index = 0; index < rays.length; index += 1) {
      const { o, d } = rays[index];
      const naive = integrateStudioVolumeRay(
        prepared,
        scene,
        march({ useOccupancy: false }),
        occupancy,
        o[0],
        o[1],
        o[2],
        d[0],
        d[1],
        d[2],
        index
      );
      const skipped = integrateStudioVolumeRay(
        prepared,
        scene,
        march({ useOccupancy: true }),
        occupancy,
        o[0],
        o[1],
        o[2],
        d[0],
        d[1],
        d[2],
        index
      );
      expect(skipped.stepCount).toBe(naive.stepCount);
      expect(skipped.r).toBe(naive.r);
      expect(skipped.g).toBe(naive.g);
      expect(skipped.b).toBe(naive.b);
      expect(skipped.transmittance).toBe(naive.transmittance);
      expect(skipped.depth).toBe(naive.depth);
      expect(skipped.expectedDepth).toBe(naive.expectedDepth);
      maxDiff = Math.max(maxDiff, Math.abs(skipped.r - naive.r));
      compared += 1;
    }
    expect(compared).toBe(rays.length);
    expect(maxDiff).toBe(0);
  });

  it("스킵이 밀도 샘플 수와 그림자 샘플 수를 실제로 줄인다", () => {
    let naiveDensity = 0;
    let skippedDensity = 0;
    let naiveShadow = 0;
    let skippedShadow = 0;
    for (let index = 0; index < rays.length; index += 1) {
      const { o, d } = rays[index];
      const naive = integrateStudioVolumeRay(
        prepared,
        scene,
        march({ useOccupancy: false }),
        occupancy,
        o[0],
        o[1],
        o[2],
        d[0],
        d[1],
        d[2],
        index
      );
      const skipped = integrateStudioVolumeRay(
        prepared,
        scene,
        march({ useOccupancy: true }),
        occupancy,
        o[0],
        o[1],
        o[2],
        d[0],
        d[1],
        d[2],
        index
      );
      expect(skipped.densitySamples).toBeLessThanOrEqual(naive.densitySamples);
      naiveDensity += naive.densitySamples;
      skippedDensity += skipped.densitySamples;
      naiveShadow += naive.shadowSamples;
      skippedShadow += skipped.shadowSamples;
    }
    expect(naiveDensity).toBeGreaterThan(0);
    expect(skippedDensity).toBeLessThan(naiveDensity * 0.75);
    // 그림자 레이는 σ>0 인 스텝에서만 나가므로 두 경로가 같아야 한다(스킵이 물리를 안 바꾼다).
    expect(skippedShadow).toBe(naiveShadow);
  });

  it("가득 찬 볼륨에서는 스킵이 아무것도 못 줄이지만 결과는 동일하다", () => {
    const full = volumeFrom(16, () => 1);
    const fullOccupancy = buildStudioVolumeOccupancy(full, 8);
    expect(fullOccupancy.occupiedBlocks).toBe(fullOccupancy.totalBlocks);
    const naive = integrateStudioVolumeRay(
      full,
      scene,
      march({ useOccupancy: false }),
      fullOccupancy,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      3
    );
    const skipped = integrateStudioVolumeRay(
      full,
      scene,
      march({ useOccupancy: true }),
      fullOccupancy,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      3
    );
    expect(skipped.r).toBe(naive.r);
    expect(skipped.transmittance).toBe(naive.transmittance);
    expect(skipped.densitySamples).toBe(naive.densitySamples);
  });

  it("블록 크기를 바꿔도 결과는 동일하다(스킵 구조는 순수 최적화)", () => {
    const reference = integrateStudioVolumeRay(
      prepared,
      scene,
      march({ useOccupancy: false }),
      null,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      11
    );
    for (const blockSize of [2, 4, 8, 16]) {
      const occ = buildStudioVolumeOccupancy(prepared, blockSize);
      const skipped = integrateStudioVolumeRay(
        prepared,
        scene,
        march({ useOccupancy: true }),
        occ,
        -1,
        0.5,
        0.5,
        1,
        0,
        0,
        11
      );
      expect(skipped.r).toBe(reference.r);
      expect(skipped.transmittance).toBe(reference.transmittance);
    }
  });
});
