import { describe, expect, it } from "vitest";

import { compositeStudioVolumeImageOver } from "./studio-volume-composite";
import { prepareStudioVolume, studioVolumeVoxelIndex } from "./studio-volume-grid";
import { buildStudioVolumeOccupancy } from "./studio-volume-occupancy";
import {
  normalizeStudioVolumeMarch,
  normalizeStudioVolumeMedium,
  type StudioVolumeScene,
} from "./studio-volume-raymarch";
import {
  renderStudioVolume,
  studioVolumeCameraBasis,
  studioVolumeCameraRayDirection,
  type StudioVolumeCamera,
} from "./studio-volume-render";

import type { StudioVolumePrepared } from "./studio-volume-grid";

function blobVolume(n = 32): StudioVolumePrepared {
  const density = new Float32Array(n * n * n);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = (i + 0.5) / n - 0.5;
        const y = (j + 0.5) / n - 0.5;
        const z = (k + 0.5) / n - 0.5;
        const r = Math.hypot(x, y, z);
        density[studioVolumeVoxelIndex([n, n, n], i, j, k)] = r < 0.24 ? 8 * (1 - r / 0.24) : 0;
      }
    }
  }
  return prepareStudioVolume({
    resolution: [n, n, n],
    density,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  });
}

const CAMERA: StudioVolumeCamera = {
  origin: [0.5, 0.5, 3],
  target: [0.5, 0.5, 0.5],
  up: [0, 1, 0],
  fovY: 0.6,
};

const SCENE: StudioVolumeScene = {
  medium: normalizeStudioVolumeMedium({
    densityScale: 1.2,
    scatteringAlbedo: 0.85,
    anisotropy: 0.3,
  }),
  lights: [{ kind: "point", position: [3, 3, 2], color: [1, 0.96, 0.9], intensity: 12 }],
};

describe("studio-volume-render · 카메라", () => {
  it("기저는 정규직교이며 오른손 좌표계다", () => {
    const basis = studioVolumeCameraBasis(CAMERA);
    const right = [basis[0], basis[1], basis[2]];
    const up = [basis[3], basis[4], basis[5]];
    const forward = [basis[6], basis[7], basis[8]];
    for (const v of [right, up, forward]) {
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
    }
    expect(right[0] * up[0] + right[1] * up[1] + right[2] * up[2]).toBeCloseTo(0, 12);
    expect(right[0] * forward[0] + right[1] * forward[1] + right[2] * forward[2]).toBeCloseTo(0, 12);
    expect(forward[2]).toBeCloseTo(-1, 12);
  });

  it("up 이 forward 와 평행해도 무너지지 않는다", () => {
    const basis = studioVolumeCameraBasis({
      origin: [0, 0, 0],
      forward: [0, 1, 0],
      up: [0, 1, 0],
      fovY: 1,
    });
    for (let i = 0; i < 9; i += 3) {
      expect(Math.hypot(basis[i], basis[i + 1], basis[i + 2])).toBeCloseTo(1, 9);
    }
  });

  it("화면 중앙 레이는 forward 와 같고, 상단은 up 쪽으로 기운다", () => {
    const basis = studioVolumeCameraBasis(CAMERA);
    const center = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 32, 32);
    expect(center[0]).toBeCloseTo(basis[6], 12);
    expect(center[1]).toBeCloseTo(basis[7], 12);
    expect(center[2]).toBeCloseTo(basis[8], 12);

    const top = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 32, 0);
    expect(top[1]).toBeGreaterThan(center[1]);
    const bottom = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 32, 64);
    expect(bottom[1]).toBeLessThan(center[1]);
  });

  it("수직 화각이 fovY 와 정확히 일치한다", () => {
    const basis = studioVolumeCameraBasis(CAMERA);
    const top = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 32, 0);
    const bottom = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 32, 64);
    const angle = Math.acos(top[0] * bottom[0] + top[1] * bottom[1] + top[2] * bottom[2]);
    expect(angle).toBeCloseTo(CAMERA.fovY, 10);
  });

  it("가로가 긴 화면은 수평 화각이 넓어진다(aspect 반영)", () => {
    const basis = studioVolumeCameraBasis(CAMERA);
    const wide = studioVolumeCameraRayDirection(basis, 128, 64, CAMERA.fovY, 128, 32);
    const square = studioVolumeCameraRayDirection(basis, 64, 64, CAMERA.fovY, 64, 32);
    expect(Math.abs(wide[0])).toBeGreaterThan(Math.abs(square[0]));
  });
});

describe("studio-volume-render · 이미지", () => {
  const prepared = blobVolume(32);
  const occupancy = buildStudioVolumeOccupancy(prepared, 8);
  const march = normalizeStudioVolumeMarch({ stepSize: 0.03, maxSteps: 128, seed: 4242 });

  it("가운데 픽셀은 불투명하고 모서리 픽셀은 투명하다", () => {
    const image = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, {
      width: 17,
      height: 17,
      samplesPerPixel: 1,
    });
    const center = (8 * 17 + 8) * 4;
    expect(image.rgba[center + 3]).toBeGreaterThan(0.5);
    expect(image.rgba[center]).toBeGreaterThan(0);
    expect(image.rgba[3]).toBe(0);
    expect(image.transmittance[0]).toBe(1);
    expect(image.depth[0]).toBe(Number.POSITIVE_INFINITY);
    expect(image.depth[8 * 17 + 8]).toBeGreaterThan(1);
  });

  it("알파는 항상 [0,1], 색은 항상 유한하고 음이 아니다", () => {
    const image = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, {
      width: 12,
      height: 9,
      samplesPerPixel: 2,
    });
    expect(image.rgba.length).toBe(12 * 9 * 4);
    for (let i = 0; i < image.rgba.length; i += 4) {
      expect(image.rgba[i + 3]).toBeGreaterThanOrEqual(0);
      expect(image.rgba[i + 3]).toBeLessThanOrEqual(1);
      for (let c = 0; c < 3; c += 1) {
        expect(Number.isFinite(image.rgba[i + c])).toBe(true);
        expect(image.rgba[i + c]).toBeGreaterThanOrEqual(0);
      }
    }
    for (let i = 0; i < image.transmittance.length; i += 1) {
      expect(image.transmittance[i]).toBeGreaterThanOrEqual(0);
      expect(image.transmittance[i]).toBeLessThanOrEqual(1);
      expect(image.rgba[i * 4 + 3]).toBeCloseTo(1 - image.transmittance[i], 6);
    }
  });

  it("렌더는 결정적이다(두 번 돌려 비트 단위로 동일)", () => {
    const opts = { width: 11, height: 11, samplesPerPixel: 3 };
    const a = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, opts);
    const b = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, opts);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
    expect(Array.from(a.transmittance)).toEqual(Array.from(b.transmittance));
    expect(a.stats).toEqual(b.stats);
  });

  it("samplesPerPixel 1 은 정확히 픽셀 중심 1샘플(지터 없음)", () => {
    const opts = { width: 7, height: 7, samplesPerPixel: 1 };
    const a = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, opts);
    const b = renderStudioVolume(
      prepared,
      SCENE,
      normalizeStudioVolumeMarch({ ...march, seed: march.seed + 1 }),
      occupancy,
      CAMERA,
      opts
    );
    // 서브샘플 위치는 같지만(중심 고정) 마칭 지터 seed 는 달라 완전 동일하진 않다.
    expect(a.stats.rays).toBe(49);
    expect(b.stats.rays).toBe(49);
    expect(a.stats.plannedSteps).toBe(b.stats.plannedSteps);
  });

  it("빈 공간 스킵이 이미지를 바꾸지 않고 샘플 수만 줄인다", () => {
    const opts = { width: 15, height: 15, samplesPerPixel: 1 };
    const naive = renderStudioVolume(
      prepared,
      SCENE,
      normalizeStudioVolumeMarch({ ...march, useOccupancy: false }),
      occupancy,
      CAMERA,
      opts
    );
    const skipped = renderStudioVolume(
      prepared,
      SCENE,
      normalizeStudioVolumeMarch({ ...march, useOccupancy: true }),
      occupancy,
      CAMERA,
      opts
    );
    let maxDiff = 0;
    for (let i = 0; i < naive.rgba.length; i += 1) {
      maxDiff = Math.max(maxDiff, Math.abs(naive.rgba[i] - skipped.rgba[i]));
    }
    expect(maxDiff).toBe(0);
    expect(Array.from(naive.depth)).toEqual(Array.from(skipped.depth));
    expect(skipped.stats.densitySamples).toBeLessThan(naive.stats.densitySamples * 0.75);
    expect(skipped.stats.shadowSamples).toBe(naive.stats.shadowSamples);
    expect(skipped.stats.plannedSteps).toBe(naive.stats.plannedSteps);
  });

  it("배경 거리로 적분을 자르면 알파가 줄어든다", () => {
    const opts = { width: 9, height: 9, samplesPerPixel: 1 };
    const full = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, opts);
    const clipped = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, {
      ...opts,
      backgroundDistance: new Float32Array(81).fill(2.6),
    });
    const center = (4 * 9 + 4) * 4 + 3;
    expect(clipped.rgba[center]).toBeLessThan(full.rgba[center]);
    expect(clipped.rgba[center]).toBeGreaterThan(0);
  });

  it("합성 결과는 배경 알파를 보존한다", () => {
    const opts = { width: 8, height: 8, samplesPerPixel: 1 };
    const image = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, opts);
    const background = new Float32Array(8 * 8 * 4);
    for (let i = 0; i < 64; i += 1) {
      background[i * 4] = 0.05;
      background[i * 4 + 1] = 0.07;
      background[i * 4 + 2] = 0.12;
      background[i * 4 + 3] = 1;
    }
    const composited = compositeStudioVolumeImageOver(image.rgba, background, image.transmittance);
    for (let i = 0; i < 64; i += 1) {
      expect(composited[i * 4 + 3]).toBeCloseTo(1, 5);
      expect(composited[i * 4]).toBeGreaterThan(0);
    }
  });

  it("퇴화 볼륨은 완전 투명 이미지를 낸다", () => {
    const degenerate = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 0],
    });
    const image = renderStudioVolume(degenerate, SCENE, march, null, CAMERA, {
      width: 4,
      height: 4,
      samplesPerPixel: 1,
    });
    expect(Array.from(image.rgba)).toEqual(new Array(64).fill(0));
    expect(Array.from(image.transmittance)).toEqual(new Array(16).fill(1));
  });

  it("0 이하 크기는 최소 1픽셀로 클램프된다", () => {
    const image = renderStudioVolume(prepared, SCENE, march, occupancy, CAMERA, {
      width: 0,
      height: -3,
      samplesPerPixel: 0,
    });
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(image.rgba.length).toBe(4);
    expect(image.stats.rays).toBe(1);
  });
});
