/**
 * Studio Volume — 카메라 · 이미지 렌더 루프(CPU 참조 구현)
 *
 * 핀홀 카메라 하나로 픽셀별 월드 레이를 만들고 `integrateStudioVolumeRay` 를 호출한다.
 * 이 경로가 **정확성의 기준(reference)** 이다 — GPU(WGSL) 경로는 여기에 맞춰 검증한다.
 *
 * 출력은 프리멀티플라이드 선형 RGBA(Float32) + 투과율 + 두 종류의 깊이 버퍼다.
 * 합성 규약은 studio-volume-composite.ts 를 따른다.
 */

import { integrateStudioVolumeRay } from "./studio-volume-raymarch";
import { studioVolumePixelOffset } from "./studio-volume-sampler";

import type { StudioVolumePrepared, StudioVolumeVec3 } from "./studio-volume-grid";
import type { StudioVolumeOccupancy } from "./studio-volume-occupancy";
import type { StudioVolumeMarchParams, StudioVolumeScene } from "./studio-volume-raymarch";

export interface StudioVolumeCamera {
  readonly origin: StudioVolumeVec3;
  /** 카메라가 바라보는 지점. `forward` 가 있으면 무시된다. */
  readonly target?: StudioVolumeVec3 | null;
  /** 정규화 전 전방 방향. 없으면 target - origin. */
  readonly forward?: StudioVolumeVec3 | null;
  readonly up: StudioVolumeVec3;
  /** 수직 화각(라디안). */
  readonly fovY: number;
}

export interface StudioVolumeRenderOptions {
  readonly width: number;
  readonly height: number;
  /** 픽셀당 지터 서브샘플 수. 1 이면 정확히 픽셀 중심(결정적·노이즈 없음). */
  readonly samplesPerPixel: number;
  /**
   * 픽셀별 배경 거리(월드). 길이 width*height. 불투명 배경 앞까지만 적분하게 만든다.
   * null 이면 무한대(배경 없음).
   */
  readonly backgroundDistance?: Float32Array | null;
}

export interface StudioVolumeImage {
  readonly width: number;
  readonly height: number;
  /** 프리멀티플라이드 선형 RGBA. */
  readonly rgba: Float32Array;
  /** 픽셀별 최종 투과율(합성에서 배경 계수로 쓴다). */
  readonly transmittance: Float32Array;
  /** 불투명도 임계 교차 거리. 볼륨을 만나지 않으면 Infinity. */
  readonly depth: Float32Array;
  /** 불투명도 가중 평균 거리. */
  readonly expectedDepth: Float32Array;
  readonly stats: StudioVolumeRenderStats;
}

export interface StudioVolumeRenderStats {
  readonly rays: number;
  /** 1차 레이 마칭에서 평가한 밀도 샘플 총합. */
  readonly densitySamples: number;
  /** 그림자(비율 추적)에서 평가한 밀도 샘플 총합. */
  readonly shadowSamples: number;
  /** 마칭 스텝 격자 크기의 총합(= 스킵이 없었다면 평가했을 샘플 수). */
  readonly plannedSteps: number;
}

/** 카메라 기저(right, up, forward) — 전부 정규화. out = 9원소. */
export function studioVolumeCameraBasis(
  camera: StudioVolumeCamera,
  out: Float64Array = new Float64Array(9)
): Float64Array {
  const origin = camera.origin;
  let fx: number;
  let fy: number;
  let fz: number;
  if (camera.forward) {
    fx = camera.forward[0];
    fy = camera.forward[1];
    fz = camera.forward[2];
  } else if (camera.target) {
    fx = camera.target[0] - origin[0];
    fy = camera.target[1] - origin[1];
    fz = camera.target[2] - origin[2];
  } else {
    fx = 0;
    fy = 0;
    fz = -1;
  }
  let flen = Math.hypot(fx, fy, fz);
  if (!(flen > 0)) {
    fx = 0;
    fy = 0;
    fz = -1;
    flen = 1;
  }
  fx /= flen;
  fy /= flen;
  fz /= flen;

  const up = camera.up;
  let rx = fy * up[2] - fz * up[1];
  let ry = fz * up[0] - fx * up[2];
  let rz = fx * up[1] - fy * up[0];
  let rlen = Math.hypot(rx, ry, rz);
  if (!(rlen > 1e-9)) {
    // up 이 forward 와 평행 — 임의의 직교축으로 폴백한다.
    const ax = Math.abs(fx) < 0.9 ? 1 : 0;
    const ay = Math.abs(fx) < 0.9 ? 0 : 1;
    rx = fy * 0 - fz * ay;
    ry = fz * ax - fx * 0;
    rz = fx * ay - fy * ax;
    rlen = Math.hypot(rx, ry, rz) || 1;
  }
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;

  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  out[0] = rx;
  out[1] = ry;
  out[2] = rz;
  out[3] = ux;
  out[4] = uy;
  out[5] = uz;
  out[6] = fx;
  out[7] = fy;
  out[8] = fz;
  return out;
}

/**
 * 픽셀 (px + ox, py + oy) 의 월드 레이 방향(정규화). basis 는 studioVolumeCameraBasis 결과.
 * NDC 규약: x 는 오른쪽 +, y 는 **위쪽 +**(즉 이미지 행 0 이 화면 상단).
 */
export function studioVolumeCameraRayDirection(
  basis: Float64Array,
  width: number,
  height: number,
  fovY: number,
  px: number,
  py: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  const aspect = width / height;
  const tanHalf = Math.tan(fovY * 0.5);
  const sx = ((2 * px) / width - 1) * aspect * tanHalf;
  const sy = (1 - (2 * py) / height) * tanHalf;
  let dx = basis[6] + basis[0] * sx + basis[3] * sy;
  let dy = basis[7] + basis[1] * sx + basis[4] * sy;
  let dz = basis[8] + basis[2] * sx + basis[5] * sy;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  out[0] = dx;
  out[1] = dy;
  out[2] = dz;
  return out;
}

/** CPU 참조 렌더. 결정적이며 Math.random/Date.now 를 쓰지 않는다. */
export function renderStudioVolume(
  prepared: StudioVolumePrepared,
  scene: StudioVolumeScene,
  march: StudioVolumeMarchParams,
  occupancy: StudioVolumeOccupancy | null,
  camera: StudioVolumeCamera,
  options: StudioVolumeRenderOptions
): StudioVolumeImage {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const spp = Math.max(1, Math.floor(options.samplesPerPixel));
  const pixels = width * height;

  const rgba = new Float32Array(pixels * 4);
  const transmittance = new Float32Array(pixels);
  const depth = new Float32Array(pixels);
  const expectedDepth = new Float32Array(pixels);

  const basis = studioVolumeCameraBasis(camera);
  const origin = camera.origin;
  const dir = new Float64Array(3);
  const offset = new Float64Array(2);

  let densitySamples = 0;
  let shadowSamples = 0;
  let plannedSteps = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const maxDistance = options.backgroundDistance
        ? options.backgroundDistance[pixelIndex]
        : Number.POSITIVE_INFINITY;

      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accT = 0;
      let accDepth = 0;
      let depthHits = 0;
      let accExpected = 0;
      let expectedHits = 0;

      for (let s = 0; s < spp; s += 1) {
        if (spp === 1) {
          offset[0] = 0.5;
          offset[1] = 0.5;
        } else {
          studioVolumePixelOffset(march.seed, pixelIndex, s, offset);
        }
        studioVolumeCameraRayDirection(
          basis,
          width,
          height,
          camera.fovY,
          x + offset[0],
          y + offset[1],
          dir
        );
        const result = integrateStudioVolumeRay(
          prepared,
          scene,
          march,
          occupancy,
          origin[0],
          origin[1],
          origin[2],
          dir[0],
          dir[1],
          dir[2],
          pixelIndex * spp + s,
          maxDistance
        );
        accR += result.r;
        accG += result.g;
        accB += result.b;
        accT += result.transmittance;
        densitySamples += result.densitySamples;
        shadowSamples += result.shadowSamples;
        plannedSteps += result.stepCount;
        if (Number.isFinite(result.depth)) {
          accDepth += result.depth;
          depthHits += 1;
        }
        if (Number.isFinite(result.expectedDepth)) {
          accExpected += result.expectedDepth;
          expectedHits += 1;
        }
      }

      const invSpp = 1 / spp;
      const o = pixelIndex * 4;
      const meanT = accT * invSpp;
      rgba[o] = accR * invSpp;
      rgba[o + 1] = accG * invSpp;
      rgba[o + 2] = accB * invSpp;
      rgba[o + 3] = 1 - meanT;
      transmittance[pixelIndex] = meanT;
      depth[pixelIndex] = depthHits > 0 ? accDepth / depthHits : Number.POSITIVE_INFINITY;
      expectedDepth[pixelIndex] =
        expectedHits > 0 ? accExpected / expectedHits : Number.POSITIVE_INFINITY;
    }
  }

  return {
    width,
    height,
    rgba,
    transmittance,
    depth,
    expectedDepth,
    stats: { rays: pixels * spp, densitySamples, shadowSamples, plannedSteps },
  };
}
