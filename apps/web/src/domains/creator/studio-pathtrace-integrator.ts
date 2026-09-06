/**
 * Studio Path Tracer — 경로 적분기 (studio-pathtrace-integrator)
 *
 * 알고리즘
 *  - 핀홀 카메라 레이 → 최근접 히트 → (NEE + BSDF 샘플) 반복. 각 바운스에서
 *    · **NEE**: 광원 하나를 균등 선택해 직접 샘플하고 any-hit 섀도 레이로 가린다.
 *    · **MIS(power heuristic, β=2)**: 면적 광원에만 적용한다. 포인트 광원은 델타
 *      분포라 BSDF 샘플링이 대응 항을 만들 수 없어 MIS 가 정의되지 않는다 —
 *      NEE 기여를 가중 없이 그대로 더한다.
 *    · **Russian roulette**: `rrStartBounce` 부터 throughput 최대 채널 기준 생존
 *      확률 q ∈ [0.05, 0.95]. 생존 시 1/q 보정 → 무편향(테스트가 RR on/off 평균
 *      일치를 강제).
 *  - `mode: "naive-bsdf"` 는 NEE 를 끄고 BSDF 경로가 광원에 부딪히기만 기다린다.
 *    분산 비교 테스트의 대조군이자 실제 디버그 옵션이다.
 *  - **시간 개념이 없다.** rAF/setTimeout/Date 를 쓰지 않는다 — 호출부가 프레임
 *    예산 안에서 몇 샘플을 돌릴지 정한다.
 *
 * 정직한 한계
 *  - **발광 삼각형은 NEE 대상이 아니다.** 면적 광원은 씬과 분리된 평행사변형 목록이며
 *    BVH 밖에서 해석적으로 교차한다. 지오메트리의 `emissiveLinear` 는 BSDF 경로로만
 *    발견되므로(가중 1) 작고 밝은 발광 메시는 노이즈가 심하다.
 *  - **라이트 트리/many-light 샘플링 없음.** 광원 ≤ 64 를 균등 선택한다 —
 *    광원 수가 늘면 NEE 효율이 선형으로 떨어진다. 선택 확률 1/N 의 역수는 델타 광원은
 *    `geomFactor`, 면적 광원은 `pdfLight` 분모에서 각각 되돌린다(둘 다 없으면 다중
 *    광원 씬이 N 배 어두워진다 — studio-pathtrace-nee-multilight.test.ts 가 잠근다).
 *  - **면적 광원은 섀도 레이를 막지 않는다.** BSDF/카메라 경로는 면적 광원에서 멈추지만
 *    (불투명 발광체) `occludedStudioPathtraceBvh` 는 BVH 삼각형만 본다. 따라서 면적
 *    광원이 서로를 가리는 배치에서는 NEE 와 BSDF 두 추정기의 가시성이 어긋나 MIS 결합이
 *    편향된다. 광원 하나 또는 서로 가리지 않는 배치에서만 무편향이다.
 *  - **DOF·모션 블러 없음**(핀홀 고정), 적응 샘플링 없음.
 *  - `clampIndirect > 0` 은 firefly 를 자르는 **편향** 옵션이다(기본 0 = 끔).
 *  - 컨텍스트는 스크래치를 재사용하므로 **재진입 불가**다. 워커/스레드마다 컨텍스트를
 *    따로 만들어야 한다.
 */

import {
  createStudioPathtraceBsdfSample,
  evalStudioPathtraceBsdf,
  pdfStudioPathtraceBsdf,
  sampleStudioPathtraceBsdf,
} from "./studio-pathtrace-bsdf";
import {
  intersectStudioPathtraceBvh,
  occludedStudioPathtraceBvh,
} from "./studio-pathtrace-bvh";
import {
  createStudioPathtraceHit,
  createStudioPathtraceRay,
  intersectStudioPathtraceParallelogram,
  setStudioPathtraceRay,
  studioPathtraceGeometricNormal,
} from "./studio-pathtrace-geometry";
import {
  STUDIO_PATHTRACE_DIMENSION,
  buildStudioPathtraceOnb,
  studioPathtraceRandom01,
  studioPathtraceStratifiedPixelSample,
} from "./studio-pathtrace-sampler";

import type { StudioPathtraceBsdfSample } from "./studio-pathtrace-bsdf";
import type { StudioPathtraceBvh } from "./studio-pathtrace-bvh";
import type { StudioPathtraceHit, StudioPathtraceRay } from "./studio-pathtrace-geometry";
import type {
  StudioPathtraceEnvironment,
  StudioPathtraceScene,
} from "./studio-pathtrace-scene";

export type StudioPathtraceIntegratorMode = "nee-mis" | "naive-bsdf";

export interface StudioPathtraceIntegratorOptions {
  readonly mode: StudioPathtraceIntegratorMode;
  /** 산란 이벤트 최대 횟수. 0 이면 카메라에 직접 보이는 발광/환경만 모은다. */
  readonly maxBounces: number;
  readonly russianRoulette: boolean;
  readonly rrStartBounce: number;
  /** > 0 이면 간접 기여의 최대 채널을 이 값으로 자른다(편향). 0 = 끔. */
  readonly clampIndirect: number;
  readonly seed: number;
  /** 픽셀 지터 층화용. 렌더 도중 바뀌면 결정성 계약이 깨진다. */
  readonly samplesPerPixel: number;
}

export const STUDIO_PATHTRACE_DEFAULT_OPTIONS: StudioPathtraceIntegratorOptions = {
  mode: "nee-mis",
  maxBounces: 4,
  russianRoulette: true,
  rrStartBounce: 3,
  clampIndirect: 0,
  seed: 1,
  samplesPerPixel: 16,
};

/** 자기 교차 방지 오프셋(월드 단위). 씬 스케일이 1e4 를 넘으면 키워야 한다. */
export const STUDIO_PATHTRACE_RAY_EPSILON = 1e-4;
/** RR 생존 확률 범위. */
export const STUDIO_PATHTRACE_RR_MIN = 0.05;
export const STUDIO_PATHTRACE_RR_MAX = 0.95;

export interface StudioPathtraceContext {
  readonly scene: StudioPathtraceScene;
  readonly bvh: StudioPathtraceBvh;
  readonly width: number;
  readonly height: number;
  readonly options: StudioPathtraceIntegratorOptions;
  /** 카메라 기저(월드). */
  readonly camPos: Float64Array;
  readonly camRight: Float64Array;
  readonly camUp: Float64Array;
  readonly camForward: Float64Array;
  readonly tanHalfFovY: number;
  readonly aspect: number;
  /** 면적 광원의 정규화 노멀 + 면적 사전계산(광원 i → [nx,ny,nz,area]). */
  readonly areaLightPlanes: Float64Array;
  // --- 스크래치(재진입 불가) ---
  readonly ray: StudioPathtraceRay;
  readonly shadowRay: StudioPathtraceRay;
  readonly hit: StudioPathtraceHit;
  readonly bsdfSample: StudioPathtraceBsdfSample;
  readonly scratch2: Float64Array;
  readonly scratch3: Float64Array;
  readonly scratch3b: Float64Array;
  readonly onb: Float64Array;
}

export interface StudioPathtraceContextInput {
  readonly scene: StudioPathtraceScene;
  readonly bvh: StudioPathtraceBvh;
  readonly width: number;
  readonly height: number;
  readonly options?: Partial<StudioPathtraceIntegratorOptions>;
}

export function createStudioPathtraceContext(input: StudioPathtraceContextInput): StudioPathtraceContext {
  const options: StudioPathtraceIntegratorOptions = {
    ...STUDIO_PATHTRACE_DEFAULT_OPTIONS,
    ...input.options,
  };
  const cam = input.scene.camera;
  let fx = cam.target[0] - cam.position[0];
  let fy = cam.target[1] - cam.position[1];
  let fz = cam.target[2] - cam.position[2];
  const flen = Math.hypot(fx, fy, fz) || 1;
  fx /= flen;
  fy /= flen;
  fz /= flen;
  let rx = fy * cam.up[2] - fz * cam.up[1];
  let ry = fz * cam.up[0] - fx * cam.up[2];
  let rz = fx * cam.up[1] - fy * cam.up[0];
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const lights = input.scene.lights;
  const areaLightPlanes = new Float64Array(lights.length * 4);
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    if (light.kind !== "area") continue;
    const cx = light.edgeU[1] * light.edgeV[2] - light.edgeU[2] * light.edgeV[1];
    const cy = light.edgeU[2] * light.edgeV[0] - light.edgeU[0] * light.edgeV[2];
    const cz = light.edgeU[0] * light.edgeV[1] - light.edgeU[1] * light.edgeV[0];
    const area = Math.hypot(cx, cy, cz);
    if (area > 0) {
      areaLightPlanes[i * 4] = cx / area;
      areaLightPlanes[i * 4 + 1] = cy / area;
      areaLightPlanes[i * 4 + 2] = cz / area;
      areaLightPlanes[i * 4 + 3] = area;
    }
  }

  return {
    scene: input.scene,
    bvh: input.bvh,
    width: input.width,
    height: input.height,
    options,
    camPos: Float64Array.from(cam.position),
    camRight: Float64Array.from([rx, ry, rz]),
    camUp: Float64Array.from([ux, uy, uz]),
    camForward: Float64Array.from([fx, fy, fz]),
    tanHalfFovY: Math.tan(cam.fovYRadians * 0.5),
    aspect: input.width / input.height,
    areaLightPlanes,
    ray: createStudioPathtraceRay(),
    shadowRay: createStudioPathtraceRay(),
    hit: createStudioPathtraceHit(),
    bsdfSample: createStudioPathtraceBsdfSample(),
    scratch2: new Float64Array(2),
    scratch3: new Float64Array(3),
    scratch3b: new Float64Array(3),
    onb: new Float64Array(6),
  };
}

/** power heuristic(β=2). 두 pdf 가 모두 0 이면 0. */
export function studioPathtracePowerHeuristic(pdfA: number, pdfB: number): number {
  const a2 = pdfA * pdfA;
  const b2 = pdfB * pdfB;
  const denom = a2 + b2;
  return denom > 0 ? a2 / denom : 0;
}

/** 환경 radiance. out ← [r, g, b]. 방향은 단위 벡터여야 한다. */
export function evalStudioPathtraceEnvironment(
  environment: StudioPathtraceEnvironment,
  dx: number,
  dy: number,
  dz: number,
  out: Float64Array | number[],
): void {
  if (environment.kind === "constant") {
    out[0] = environment.radianceLinear[0];
    out[1] = environment.radianceLinear[1];
    out[2] = environment.radianceLinear[2];
    return;
  }
  // gradient: 위(+y)가 zenith, 수평이 horizon. dx/dz 는 쓰지 않는다(회전 대칭).
  void dx;
  void dz;
  let t = 0.5 * (dy + 1);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  for (let c = 0; c < 3; c += 1) {
    out[c] = environment.horizonLinear[c] * (1 - t) + environment.zenithLinear[c] * t;
  }
}

/** 픽셀 인덱스 + 샘플 인덱스 → 카메라 레이(층화 지터 포함). */
export function generateStudioPathtraceCameraRay(
  ctx: StudioPathtraceContext,
  pixelIndex: number,
  sampleIndex: number,
  ray: StudioPathtraceRay,
): void {
  const { options } = ctx;
  studioPathtraceStratifiedPixelSample(
    pixelIndex,
    sampleIndex,
    options.samplesPerPixel,
    options.seed,
    ctx.scratch2,
  );
  const px = pixelIndex % ctx.width;
  const py = Math.floor(pixelIndex / ctx.width);
  const sx = ((2 * (px + ctx.scratch2[0])) / ctx.width - 1) * ctx.tanHalfFovY * ctx.aspect;
  const sy = (1 - (2 * (py + ctx.scratch2[1])) / ctx.height) * ctx.tanHalfFovY;
  let dx = ctx.camForward[0] + ctx.camRight[0] * sx + ctx.camUp[0] * sy;
  let dy = ctx.camForward[1] + ctx.camRight[1] * sx + ctx.camUp[1] * sy;
  let dz = ctx.camForward[2] + ctx.camRight[2] * sx + ctx.camUp[2] * sy;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  setStudioPathtraceRay(ray, ctx.camPos[0], ctx.camPos[1], ctx.camPos[2], dx, dy, dz);
}

interface AreaLightHit {
  index: number;
  t: number;
}

const areaLightHit: AreaLightHit = { index: -1, t: Infinity };

function intersectAreaLights(ctx: StudioPathtraceContext, ray: StudioPathtraceRay, tMax: number): AreaLightHit {
  areaLightHit.index = -1;
  areaLightHit.t = Infinity;
  const lights = ctx.scene.lights;
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    if (light.kind !== "area") continue;
    const t = intersectStudioPathtraceParallelogram(
      ray,
      light.origin[0],
      light.origin[1],
      light.origin[2],
      light.edgeU[0],
      light.edgeU[1],
      light.edgeU[2],
      light.edgeV[0],
      light.edgeV[1],
      light.edgeV[2],
      STUDIO_PATHTRACE_RAY_EPSILON,
      tMax,
      ctx.scratch2,
    );
    if (t >= 0 && t < areaLightHit.t) {
      areaLightHit.t = t;
      areaLightHit.index = i;
    }
  }
  return areaLightHit;
}

/**
 * 한 샘플의 선형 radiance. `out` ← [r, g, b].
 * 같은 (pixelIndex, sampleIndex, options.seed) 면 항상 같은 값이다.
 */
export function traceStudioPathtraceRadiance(
  ctx: StudioPathtraceContext,
  pixelIndex: number,
  sampleIndex: number,
  out: Float64Array | number[],
): void {
  const { scene, bvh, options, ray, hit } = ctx;
  const { positions, indices, triMaterial, normals, materials, lights } = scene;
  generateStudioPathtraceCameraRay(ctx, pixelIndex, sampleIndex, ray);

  let thrR = 1;
  let thrG = 1;
  let thrB = 1;
  let radR = 0;
  let radG = 0;
  let radB = 0;
  let prevBsdfPdf = 0;
  let cameraSegment = true;
  const useNee = options.mode === "nee-mis" && lights.length > 0;
  const clamp = options.clampIndirect;

  const env = ctx.scratch3;
  const bsdfValue = ctx.scratch3b;

  for (let bounce = 0; bounce <= options.maxBounces; bounce += 1) {
    const geoHit = intersectStudioPathtraceBvh(
      positions,
      indices,
      bvh,
      ray,
      STUDIO_PATHTRACE_RAY_EPSILON,
      Infinity,
      hit,
    );
    const tGeo = geoHit ? hit.t : Infinity;
    const lightHit = intersectAreaLights(ctx, ray, tGeo);

    // --- 면적 광원 직격 ---
    if (lightHit.index >= 0) {
      const light = lights[lightHit.index];
      if (light.kind === "area") {
        const nx = ctx.areaLightPlanes[lightHit.index * 4];
        const ny = ctx.areaLightPlanes[lightHit.index * 4 + 1];
        const nz = ctx.areaLightPlanes[lightHit.index * 4 + 2];
        const area = ctx.areaLightPlanes[lightHit.index * 4 + 3];
        const cosLight = -(ray.dx * nx + ray.dy * ny + ray.dz * nz);
        const facing = light.twoSided ? Math.abs(cosLight) : cosLight;
        if (facing > 0 && area > 0) {
          let weight = 1;
          if (useNee && !cameraSegment) {
            const dist2 = lightHit.t * lightHit.t;
            const pdfLight = dist2 / (facing * area * lights.length);
            weight = studioPathtracePowerHeuristic(prevBsdfPdf, pdfLight);
          }
          let cr = thrR * light.emissiveLinear[0] * weight;
          let cg = thrG * light.emissiveLinear[1] * weight;
          let cb = thrB * light.emissiveLinear[2] * weight;
          if (clamp > 0 && !cameraSegment) {
            const m = Math.max(cr, Math.max(cg, cb));
            if (m > clamp) {
              const s = clamp / m;
              cr *= s;
              cg *= s;
              cb *= s;
            }
          }
          radR += cr;
          radG += cg;
          radB += cb;
        }
      }
      break;
    }

    // --- 환경(미스) ---
    if (!geoHit) {
      evalStudioPathtraceEnvironment(scene.environment, ray.dx, ray.dy, ray.dz, env);
      radR += thrR * env[0];
      radG += thrG * env[1];
      radB += thrB * env[2];
      break;
    }

    // --- 표면 셰이딩 ---
    const tri = hit.triangle;
    const i0 = indices[tri * 3];
    const i1 = indices[tri * 3 + 1];
    const i2 = indices[tri * 3 + 2];
    const px = ray.ox + ray.dx * hit.t;
    const py = ray.oy + ray.dy * hit.t;
    const pz = ray.oz + ray.dz * hit.t;

    studioPathtraceGeometricNormal(
      positions[i0 * 3],
      positions[i0 * 3 + 1],
      positions[i0 * 3 + 2],
      positions[i1 * 3],
      positions[i1 * 3 + 1],
      positions[i1 * 3 + 2],
      positions[i2 * 3],
      positions[i2 * 3 + 1],
      positions[i2 * 3 + 2],
      env,
    );
    let ngx = env[0];
    let ngy = env[1];
    let ngz = env[2];
    if (ray.dx * ngx + ray.dy * ngy + ray.dz * ngz > 0) {
      ngx = -ngx;
      ngy = -ngy;
      ngz = -ngz;
    }

    let nsx = ngx;
    let nsy = ngy;
    let nsz = ngz;
    if (normals) {
      const w = 1 - hit.u - hit.v;
      let sx = w * normals[i0 * 3] + hit.u * normals[i1 * 3] + hit.v * normals[i2 * 3];
      let sy = w * normals[i0 * 3 + 1] + hit.u * normals[i1 * 3 + 1] + hit.v * normals[i2 * 3 + 1];
      let sz = w * normals[i0 * 3 + 2] + hit.u * normals[i1 * 3 + 2] + hit.v * normals[i2 * 3 + 2];
      const slen = Math.hypot(sx, sy, sz);
      if (slen > 0) {
        sx /= slen;
        sy /= slen;
        sz /= slen;
        if (sx * ngx + sy * ngy + sz * ngz < 0) {
          sx = -sx;
          sy = -sy;
          sz = -sz;
        }
        nsx = sx;
        nsy = sy;
        nsz = sz;
      }
    }

    const material = materials[triMaterial[tri]];

    // 발광 지오메트리 — NEE 대상이 아니므로 가중 1.
    if (
      material.emissiveLinear[0] > 0
      || material.emissiveLinear[1] > 0
      || material.emissiveLinear[2] > 0
    ) {
      radR += thrR * material.emissiveLinear[0];
      radG += thrG * material.emissiveLinear[1];
      radB += thrB * material.emissiveLinear[2];
    }

    if (bounce === options.maxBounces) break;

    // 셰이딩 프레임(z = 셰이딩 노멀). wo 가 표면 아래로 가면 지오메트릭 노멀로 폴백.
    buildStudioPathtraceOnb(nsx, nsy, nsz, ctx.onb);
    let woX = -(ray.dx * ctx.onb[0] + ray.dy * ctx.onb[1] + ray.dz * ctx.onb[2]);
    let woY = -(ray.dx * ctx.onb[3] + ray.dy * ctx.onb[4] + ray.dz * ctx.onb[5]);
    let woZ = -(ray.dx * nsx + ray.dy * nsy + ray.dz * nsz);
    if (woZ <= 0) {
      nsx = ngx;
      nsy = ngy;
      nsz = ngz;
      buildStudioPathtraceOnb(nsx, nsy, nsz, ctx.onb);
      woX = -(ray.dx * ctx.onb[0] + ray.dy * ctx.onb[1] + ray.dz * ctx.onb[2]);
      woY = -(ray.dx * ctx.onb[3] + ray.dy * ctx.onb[4] + ray.dz * ctx.onb[5]);
      woZ = -(ray.dx * nsx + ray.dy * nsy + ray.dz * nsz);
      if (woZ <= 0) break;
    }
    const tx = ctx.onb[0];
    const ty = ctx.onb[1];
    const tz = ctx.onb[2];
    const bx = ctx.onb[3];
    const by = ctx.onb[4];
    const bz = ctx.onb[5];
    const ox = px + ngx * STUDIO_PATHTRACE_RAY_EPSILON;
    const oy = py + ngy * STUDIO_PATHTRACE_RAY_EPSILON;
    const oz = pz + ngz * STUDIO_PATHTRACE_RAY_EPSILON;

    // --- NEE ---
    if (useNee) {
      const uSel = studioPathtraceRandom01(
        pixelIndex,
        sampleIndex,
        bounce,
        STUDIO_PATHTRACE_DIMENSION.lightSelect,
        options.seed,
      );
      let li = Math.floor(uSel * lights.length);
      if (li >= lights.length) li = lights.length - 1;
      const light = lights[li];
      const u1 = studioPathtraceRandom01(
        pixelIndex,
        sampleIndex,
        bounce,
        STUDIO_PATHTRACE_DIMENSION.lightU,
        options.seed,
      );
      const u2 = studioPathtraceRandom01(
        pixelIndex,
        sampleIndex,
        bounce,
        STUDIO_PATHTRACE_DIMENSION.lightV,
        options.seed,
      );

      let targetX: number;
      let targetY: number;
      let targetZ: number;
      let emitR: number;
      let emitG: number;
      let emitB: number;
      let usable: boolean;
      let pdfLight = 0;
      // 포인트 광원은 델타 분포다 — BSDF 샘플링이 이 방향을 만들 수 없어 MIS 대상이 아니다.
      const deltaLight = light.kind === "point";

      if (light.kind === "point") {
        targetX = light.positionWorld[0];
        targetY = light.positionWorld[1];
        targetZ = light.positionWorld[2];
        if (light.radius > 0) {
          const zc = 1 - 2 * u1;
          const rc = Math.sqrt(Math.max(0, 1 - zc * zc));
          const phi = 2 * Math.PI * u2;
          targetX += light.radius * rc * Math.cos(phi);
          targetY += light.radius * rc * Math.sin(phi);
          targetZ += light.radius * zc;
        }
        emitR = light.intensityLinear[0];
        emitG = light.intensityLinear[1];
        emitB = light.intensityLinear[2];
        usable = true;
      } else {
        targetX = light.origin[0] + light.edgeU[0] * u1 + light.edgeV[0] * u2;
        targetY = light.origin[1] + light.edgeU[1] * u1 + light.edgeV[1] * u2;
        targetZ = light.origin[2] + light.edgeU[2] * u1 + light.edgeV[2] * u2;
        emitR = light.emissiveLinear[0];
        emitG = light.emissiveLinear[1];
        emitB = light.emissiveLinear[2];
        usable = ctx.areaLightPlanes[li * 4 + 3] > 0;
      }

      let lx = targetX - ox;
      let ly = targetY - oy;
      let lz = targetZ - oz;
      const dist = Math.hypot(lx, ly, lz);
      if (usable && dist > 0) {
        lx /= dist;
        ly /= dist;
        lz /= dist;
        const cosSurf = lx * nsx + ly * nsy + lz * nsz;
        if (cosSurf > 0) {
          let geomFactor = 0;
          if (deltaLight) {
            // 광원은 `lights` 에서 균등 선택하므로 선택 확률 1/N 을 되돌려야 한다
            // (면적 광원은 pdfLight 분모에 lights.length 가 들어가 이미 반영된다).
            geomFactor = lights.length / (dist * dist);
          } else {
            const nx = ctx.areaLightPlanes[li * 4];
            const ny = ctx.areaLightPlanes[li * 4 + 1];
            const nz = ctx.areaLightPlanes[li * 4 + 2];
            const area = ctx.areaLightPlanes[li * 4 + 3];
            const cosLightRaw = -(lx * nx + ly * ny + lz * nz);
            const twoSided = light.kind === "area" && light.twoSided;
            const cosLight = twoSided ? Math.abs(cosLightRaw) : cosLightRaw;
            if (cosLight > 0) {
              pdfLight = (dist * dist) / (cosLight * area * lights.length);
              geomFactor = pdfLight > 0 ? 1 / pdfLight : 0;
            }
          }
          if (geomFactor > 0) {
            setStudioPathtraceRay(ctx.shadowRay, ox, oy, oz, lx, ly, lz);
            const blocked = occludedStudioPathtraceBvh(
              positions,
              indices,
              bvh,
              ctx.shadowRay,
              STUDIO_PATHTRACE_RAY_EPSILON,
              dist - STUDIO_PATHTRACE_RAY_EPSILON,
              undefined,
            );
            if (!blocked) {
              const wiX = lx * tx + ly * ty + lz * tz;
              const wiY = lx * bx + ly * by + lz * bz;
              const wiZ = cosSurf;
              evalStudioPathtraceBsdf(material, woX, woY, woZ, wiX, wiY, wiZ, bsdfValue);
              // 델타 광원은 MIS 가 정의되지 않으므로 가중치 1, 면적 광원만 power heuristic.
              const weight = deltaLight
                ? 1
                : studioPathtracePowerHeuristic(
                    pdfLight,
                    pdfStudioPathtraceBsdf(material, woX, woY, woZ, wiX, wiY, wiZ),
                  );
              const scale = cosSurf * geomFactor * weight;
              let cr = thrR * bsdfValue[0] * emitR * scale;
              let cg = thrG * bsdfValue[1] * emitG * scale;
              let cb = thrB * bsdfValue[2] * emitB * scale;
              if (clamp > 0 && bounce > 0) {
                const m = Math.max(cr, Math.max(cg, cb));
                if (m > clamp) {
                  const s = clamp / m;
                  cr *= s;
                  cg *= s;
                  cb *= s;
                }
              }
              radR += cr;
              radG += cg;
              radB += cb;
            }
          }
        }
      }
    }

    // --- BSDF 샘플 ---
    const uLobe = studioPathtraceRandom01(
      pixelIndex,
      sampleIndex,
      bounce,
      STUDIO_PATHTRACE_DIMENSION.bsdfLobe,
      options.seed,
    );
    const bu = studioPathtraceRandom01(
      pixelIndex,
      sampleIndex,
      bounce,
      STUDIO_PATHTRACE_DIMENSION.bsdfU,
      options.seed,
    );
    const bv = studioPathtraceRandom01(
      pixelIndex,
      sampleIndex,
      bounce,
      STUDIO_PATHTRACE_DIMENSION.bsdfV,
      options.seed,
    );
    const sample = ctx.bsdfSample;
    sampleStudioPathtraceBsdf(material, woX, woY, woZ, uLobe, bu, bv, sample);
    if (!sample.valid) break;

    const invPdf = sample.wiZ / sample.pdf;
    thrR *= sample.fR * invPdf;
    thrG *= sample.fG * invPdf;
    thrB *= sample.fB * invPdf;
    if (thrR <= 0 && thrG <= 0 && thrB <= 0) break;

    const wdx = sample.wiX * tx + sample.wiY * bx + sample.wiZ * nsx;
    const wdy = sample.wiX * ty + sample.wiY * by + sample.wiZ * nsy;
    const wdz = sample.wiX * tz + sample.wiY * bz + sample.wiZ * nsz;
    setStudioPathtraceRay(ctx.ray, ox, oy, oz, wdx, wdy, wdz);
    prevBsdfPdf = sample.pdf;
    cameraSegment = false;

    // --- Russian roulette (무편향) ---
    if (options.russianRoulette && bounce >= options.rrStartBounce) {
      let q = Math.max(thrR, Math.max(thrG, thrB));
      if (q < STUDIO_PATHTRACE_RR_MIN) q = STUDIO_PATHTRACE_RR_MIN;
      if (q > STUDIO_PATHTRACE_RR_MAX) q = STUDIO_PATHTRACE_RR_MAX;
      const uRr = studioPathtraceRandom01(
        pixelIndex,
        sampleIndex,
        bounce,
        STUDIO_PATHTRACE_DIMENSION.russianRoulette,
        options.seed,
      );
      if (uRr >= q) break;
      const inv = 1 / q;
      thrR *= inv;
      thrG *= inv;
      thrB *= inv;
    }
  }

  out[0] = radR;
  out[1] = radG;
  out[2] = radB;
}
