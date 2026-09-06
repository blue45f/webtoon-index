/**
 * Studio Volume — WGSL 컴퓨트 이식(빠른 경로)
 *
 * CPU 참조 구현(studio-volume-raymarch / -transmittance / -phase / -sampler)을 컴퓨트 셰이더로
 * 옮긴 것이다. **의도적으로 다른 점**은 딱 하나:
 *
 *   · CPU 는 빈 공간 스킵을 3D-DDA 로 구간 단위로 처리한다(스텝 격자에서 통째로 건너뜀).
 *   · GPU 는 스텝마다 해당 블록의 majorant 를 한 번 읽어 비면 곧장 continue 한다.
 *
 * 블록이 비었다는 것은 그 안의 삼선형 샘플이 정확히 0 이라는 뜻이므로(occupancy 모듈의 에이프런
 * 증명) **두 방식의 결과 이미지는 같다**. DDA 를 워프 단위로 돌리면 발산이 커서 GPU 에서는
 * 오히려 손해라 이 형태를 골랐다. 아낀 비용의 대부분은 트라이리니어 페치가 아니라 **그림자
 * 비율추적 레이**이고, 그건 두 방식 모두 동일하게 제거된다.
 *
 * 방출은 플랑크/CIE 적분을 셰이더에서 하지 않고 CPU 가 구운 LUT(studio-volume-emission)를 선형
 * 보간한다 → 매핑이 CPU 와 정확히 일치한다.
 *
 * 난수는 CPU 와 **같은 PCG 상수·같은 키 순서**를 쓴다. 따라서 같은 seed·같은 픽셀 인덱스면 같은
 * 지터/추적 수열이 나온다(부동소수 반올림 차이만 남는다).
 *
 * ⚠️ 정직한 한계: 이 WGSL 은 node 테스트에서 **실행되지 않는다**(WebGPU 어댑터가 없다).
 *    테스트는 소스 구조(엔트리포인트·바인딩·워크그룹 상수·uniform 오프셋 표)와 디스패치 플랜만
 *    검증한다. 픽셀 단위 GPU↔CPU 패리티는 브라우저 하니스에서 별도로 확인해야 한다.
 */

/** WGSL `@workgroup_size` 리터럴과 반드시 일치(테스트가 소스에서 파싱해 대조). */
export const STUDIO_VOLUME_WORKGROUP_X = 8;
export const STUDIO_VOLUME_WORKGROUP_Y = 8;

/** 컴퓨트 엔트리포인트 이름. */
export const STUDIO_VOLUME_ENTRY_POINT = "main";

/** uniform 버퍼 총 바이트(16의 배수여야 한다 — 테스트가 확인). */
export const STUDIO_VOLUME_UNIFORM_BYTES = 336;

/** 광원 1개당 스토리지 바이트(vec4 2개). */
export const STUDIO_VOLUME_LIGHT_BYTES = 32;

/** 픽셀당 출력 바이트(vec4 2개: rgba + [T, depth, expectedDepth, steps]). */
export const STUDIO_VOLUME_OUTPUT_BYTES_PER_PIXEL = 32;

/**
 * uniform 필드 오프셋(바이트). TS 패커와 WGSL struct 가 어긋나면 조용히 잘못된 그림이 나오므로
 * 표를 코드로 노출하고 테스트가 struct 선언 순서와 대조한다.
 */
export const STUDIO_VOLUME_UNIFORM_OFFSETS = Object.freeze({
  worldToObject: 0,
  cameraOrigin: 64,
  cameraRight: 80,
  cameraUp: 96,
  cameraForward: 112,
  boundsMin: 128,
  boundsMax: 144,
  invCellSize: 160,
  resolution: 176,
  blockDims: 192,
  blockExtent: 208,
  medium: 224,
  march: 240,
  image: 256,
  flags: 272,
  emission: 288,
  emissionRamp: 304,
  ambient: 320,
});

/** 바인드 그룹 0 의 바인딩 인덱스. */
export const STUDIO_VOLUME_BINDINGS = Object.freeze({
  uniforms: 0,
  density: 1,
  temperature: 2,
  occupancy: 3,
  emissionLut: 4,
  lights: 5,
  output: 6,
});

export const STUDIO_VOLUME_WGSL = /* wgsl */ `
struct VolumeUniforms {
  worldToObject : mat4x4<f32>,
  cameraOrigin : vec4<f32>,
  cameraRight : vec4<f32>,
  cameraUp : vec4<f32>,
  cameraForward : vec4<f32>,
  boundsMin : vec4<f32>,
  boundsMax : vec4<f32>,
  invCellSize : vec4<f32>,
  resolution : vec4<u32>,
  blockDims : vec4<u32>,
  blockExtent : vec4<f32>,
  medium : vec4<f32>,
  march : vec4<f32>,
  image : vec4<u32>,
  flags : vec4<u32>,
  emission : vec4<f32>,
  emissionRamp : vec4<f32>,
  ambient : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uni : VolumeUniforms;
@group(0) @binding(1) var<storage, read> densityField : array<f32>;
@group(0) @binding(2) var<storage, read> temperatureField : array<f32>;
@group(0) @binding(3) var<storage, read> occupancyField : array<f32>;
@group(0) @binding(4) var<storage, read> emissionLut : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> lights : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> outputBuffer : array<vec4<f32>>;

const INV_FOUR_PI : f32 = 0.07957747154594767;
const RR_THRESHOLD : f32 = 0.05;
const RR_KILL : f32 = 0.75;
const MAX_TRACKING_EVENTS : u32 = 512u;
const ISOTROPIC_EPSILON : f32 = 1e-4;
const FAR : f32 = 1e30;

fn pcgHash(value : u32) -> u32 {
  let state : u32 = value * 747796405u + 2891336453u;
  let shifted : u32 = ((state >> ((state >> 28u) + 4u)) ^ state);
  let word : u32 = shifted * 277803737u;
  return (word >> 22u) ^ word;
}

fn hashKeys3(seed : u32, k0 : u32, k1 : u32, k2 : u32) -> u32 {
  var h : u32 = pcgHash(seed);
  h = pcgHash(h ^ k0);
  h = pcgHash(h ^ k1);
  h = pcgHash(h ^ k2);
  return h;
}

fn toFloat01(bits : u32) -> f32 {
  return f32(bits) * 2.3283064365386963e-10;
}

// CPU HashSampler 와 동일: base 를 키 해시로 잡고 counter 를 다시 해시해 xor.
struct Tracker {
  base : u32,
  counter : u32,
};

fn trackerNext(tracker : ptr<function, Tracker>) -> f32 {
  (*tracker).counter = (*tracker).counter + 1u;
  let bits : u32 = pcgHash((*tracker).base ^ pcgHash((*tracker).counter));
  return toFloat01(bits);
}

fn voxelIndex(i : u32, j : u32, k : u32) -> u32 {
  return i + uni.resolution.x * (j + uni.resolution.y * k);
}

fn clampIndex(value : i32, maxIndex : i32) -> u32 {
  return u32(clamp(value, 0, maxIndex));
}

fn sampleTrilinear(useTemperature : bool, p : vec3<f32>) -> f32 {
  let lo : vec3<f32> = uni.boundsMin.xyz;
  let hi : vec3<f32> = uni.boundsMax.xyz;
  if (any(p < lo) || any(p > hi)) {
    return 0.0;
  }
  let g : vec3<f32> = (p - lo) * uni.invCellSize.xyz - vec3<f32>(0.5);
  let f0 : vec3<f32> = floor(g);
  let t : vec3<f32> = g - f0;
  let maxIndex : vec3<i32> = vec3<i32>(uni.resolution.xyz) - vec3<i32>(1);
  let i0 : vec3<i32> = vec3<i32>(f0);
  let x0 : u32 = clampIndex(i0.x, maxIndex.x);
  let x1 : u32 = clampIndex(i0.x + 1, maxIndex.x);
  let y0 : u32 = clampIndex(i0.y, maxIndex.y);
  let y1 : u32 = clampIndex(i0.y + 1, maxIndex.y);
  let z0 : u32 = clampIndex(i0.z, maxIndex.z);
  let z1 : u32 = clampIndex(i0.z + 1, maxIndex.z);

  var c000 : f32; var c100 : f32; var c010 : f32; var c110 : f32;
  var c001 : f32; var c101 : f32; var c011 : f32; var c111 : f32;
  if (useTemperature) {
    c000 = temperatureField[voxelIndex(x0, y0, z0)];
    c100 = temperatureField[voxelIndex(x1, y0, z0)];
    c010 = temperatureField[voxelIndex(x0, y1, z0)];
    c110 = temperatureField[voxelIndex(x1, y1, z0)];
    c001 = temperatureField[voxelIndex(x0, y0, z1)];
    c101 = temperatureField[voxelIndex(x1, y0, z1)];
    c011 = temperatureField[voxelIndex(x0, y1, z1)];
    c111 = temperatureField[voxelIndex(x1, y1, z1)];
  } else {
    c000 = densityField[voxelIndex(x0, y0, z0)];
    c100 = densityField[voxelIndex(x1, y0, z0)];
    c010 = densityField[voxelIndex(x0, y1, z0)];
    c110 = densityField[voxelIndex(x1, y1, z0)];
    c001 = densityField[voxelIndex(x0, y0, z1)];
    c101 = densityField[voxelIndex(x1, y0, z1)];
    c011 = densityField[voxelIndex(x0, y1, z1)];
    c111 = densityField[voxelIndex(x1, y1, z1)];
  }

  let c00 : f32 = mix(c000, c100, t.x);
  let c10 : f32 = mix(c010, c110, t.x);
  let c01 : f32 = mix(c001, c101, t.x);
  let c11 : f32 = mix(c011, c111, t.x);
  return mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
}

fn blockOccupied(p : vec3<f32>) -> bool {
  if (uni.flags.y == 0u || uni.blockDims.x == 0u) {
    return true;
  }
  let local : vec3<f32> = (p - uni.boundsMin.xyz) / uni.blockExtent.xyz;
  let dims : vec3<i32> = vec3<i32>(uni.blockDims.xyz) - vec3<i32>(1);
  let b : vec3<i32> = clamp(vec3<i32>(floor(local)), vec3<i32>(0), dims);
  let index : u32 = u32(b.x) + uni.blockDims.x * (u32(b.y) + uni.blockDims.y * u32(b.z));
  return occupancyField[index] > uni.march.w;
}

// 슬랩 교차(분기 없는 벡터 형태). 반환 x = tEnter, y = tExit. tExit <= tEnter 이면 교차 없음.
// 축 루프 + 동적 벡터 인덱싱(uni.boundsMin[axis])을 피한다 — 워프 발산이 없고, 유니폼 버퍼
// 멤버의 런타임 인덱싱을 까다롭게 다루는 드라이버도 건드리지 않는다.
// d 성분이 0 이면 1e-20 로 치환한다: 원점이 슬랩 안이면 ±1e20 스케일의 무제약 구간이 되고,
// 밖이면 tNear 가 폭발해 자동으로 "교차 없음"이 된다(별도 분기 불필요).
fn intersectBounds(o : vec3<f32>, d : vec3<f32>, tMin : f32, tMax : f32) -> vec2<f32> {
  let lo : vec3<f32> = uni.boundsMin.xyz;
  let hi : vec3<f32> = uni.boundsMax.xyz;
  let safeD : vec3<f32> = select(d, vec3<f32>(1e-20), abs(d) < vec3<f32>(1e-20));
  let inv : vec3<f32> = vec3<f32>(1.0) / safeD;
  let t0 : vec3<f32> = (lo - o) * inv;
  let t1 : vec3<f32> = (hi - o) * inv;
  let tNear : vec3<f32> = min(t0, t1);
  let tFar : vec3<f32> = max(t0, t1);
  let tEnter : f32 = max(tMin, max(tNear.x, max(tNear.y, tNear.z)));
  let tExit : f32 = min(tMax, min(tFar.x, min(tFar.y, tFar.z)));
  if (tExit <= tEnter) {
    return vec2<f32>(0.0, -1.0);
  }
  return vec2<f32>(tEnter, tExit);
}

fn henyeyGreenstein(g : f32, cosTheta : f32) -> f32 {
  if (abs(g) < ISOTROPIC_EPSILON) {
    return INV_FOUR_PI;
  }
  let mu : f32 = clamp(cosTheta, -1.0, 1.0);
  let denom : f32 = max(1.0 + g * g - 2.0 * g * mu, 1e-12);
  return INV_FOUR_PI * (1.0 - g * g) / (denom * sqrt(denom));
}

fn ignitionGate(temperature : f32) -> f32 {
  let ignition : f32 = uni.emission.x;
  if (temperature <= ignition) {
    return 0.0;
  }
  let ramp : f32 = uni.emissionRamp.x;
  if (ramp <= 0.0) {
    return 1.0;
  }
  let t : f32 = clamp((temperature - ignition) / ramp, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn emissionRadiance(temperature : f32) -> vec3<f32> {
  let gate : f32 = ignitionGate(temperature);
  if (gate <= 0.0) {
    return vec3<f32>(0.0);
  }
  let maxK : f32 = uni.emission.z;
  let lutSize : u32 = uni.flags.z;
  if (lutSize < 2u || maxK <= 0.0) {
    return vec3<f32>(0.0);
  }
  let clamped : f32 = min(temperature, maxK);
  let g : f32 = clamp(clamped / maxK, 0.0, 1.0) * f32(lutSize - 1u);
  let i0 : u32 = min(u32(floor(g)), lutSize - 2u);
  let f : f32 = g - f32(i0);
  let a : vec3<f32> = emissionLut[i0].xyz;
  let b : vec3<f32> = emissionLut[i0 + 1u].xyz;
  return mix(a, b, f);
}

fn ratioTracking(
  o : vec3<f32>,
  d : vec3<f32>,
  tEnter : f32,
  tExit : f32,
  majorant : f32,
  tracker : ptr<function, Tracker>
) -> f32 {
  if (tExit <= tEnter || majorant <= 0.0) {
    return 1.0;
  }
  let invMajorant : f32 = 1.0 / majorant;
  var t : f32 = tEnter;
  var weight : f32 = 1.0;
  let densityScale : f32 = uni.medium.x;

  for (var events : u32 = 0u; events < MAX_TRACKING_EVENTS; events = events + 1u) {
    let u : f32 = trackerNext(tracker);
    t = t - log(max(1.0 - u, 1e-20)) * invMajorant;
    if (t >= tExit) {
      break;
    }
    let sigma : f32 = densityScale * sampleTrilinear(false, o + t * d);
    weight = weight * max(1.0 - sigma * invMajorant, 0.0);
    if (weight <= 0.0) {
      return 0.0;
    }
    if (weight < RR_THRESHOLD) {
      if (trackerNext(tracker) < RR_KILL) {
        return 0.0;
      }
      weight = weight / (1.0 - RR_KILL);
    }
  }
  return min(weight, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let width : u32 = uni.image.x;
  let height : u32 = uni.image.y;
  if (gid.x >= width || gid.y >= height) {
    return;
  }
  let pixelIndex : u32 = gid.y * width + gid.x;

  let aspect : f32 = f32(width) / f32(height);
  let tanHalf : f32 = uni.march.y;
  let sx : f32 = ((2.0 * (f32(gid.x) + 0.5)) / f32(width) - 1.0) * aspect * tanHalf;
  let sy : f32 = (1.0 - (2.0 * (f32(gid.y) + 0.5)) / f32(height)) * tanHalf;
  let worldDir : vec3<f32> = normalize(
    uni.cameraForward.xyz + uni.cameraRight.xyz * sx + uni.cameraUp.xyz * sy
  );
  let worldOrigin : vec3<f32> = uni.cameraOrigin.xyz;

  let objectOrigin : vec3<f32> = (uni.worldToObject * vec4<f32>(worldOrigin, 1.0)).xyz;
  let objectDir : vec3<f32> = (uni.worldToObject * vec4<f32>(worldDir, 0.0)).xyz;

  let span : vec2<f32> = intersectBounds(objectOrigin, objectDir, 0.0, FAR);
  if (span.y <= span.x) {
    outputBuffer[pixelIndex * 2u] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    outputBuffer[pixelIndex * 2u + 1u] = vec4<f32>(1.0, FAR, FAR, 0.0);
    return;
  }

  let spanLength : f32 = span.y - span.x;
  let stepCount : u32 = max(1u, min(uni.image.z, u32(ceil(spanLength / uni.march.x))));
  let dt : f32 = spanLength / f32(stepCount);

  let densityScale : f32 = uni.medium.x;
  let albedo : f32 = uni.medium.y;
  let g : f32 = uni.medium.z;
  let emissionScale : f32 = uni.medium.w;
  let jitter : f32 = uni.emissionRamp.z;
  let seed : u32 = uni.image.w;
  let lightCount : u32 = uni.flags.x;
  let useShadows : bool = uni.flags.w == 1u;
  let majorant : f32 = densityScale * uni.emissionRamp.w;
  let depthThreshold : f32 = uni.emissionRamp.y;

  var transmittance : f32 = 1.0;
  var radiance : vec3<f32> = vec3<f32>(0.0);
  var depth : f32 = FAR;
  var depthWeight : f32 = 0.0;
  var depthWeighted : f32 = 0.0;
  var evaluated : f32 = 0.0;

  for (var k : u32 = 0u; k < stepCount; k = k + 1u) {
    let u : f32 = toFloat01(hashKeys3(seed, pixelIndex, k, 0u));
    let offset : f32 = select(0.5, 0.5 + jitter * (u - 0.5), jitter > 0.0);
    let t : f32 = span.x + (f32(k) + offset) * dt;
    let p : vec3<f32> = clamp(
      objectOrigin + t * objectDir,
      uni.boundsMin.xyz,
      uni.boundsMax.xyz
    );

    if (!blockOccupied(p)) {
      continue;
    }

    let density : f32 = sampleTrilinear(false, p);
    evaluated = evaluated + 1.0;
    let sigmaT : f32 = densityScale * density;
    if (sigmaT <= 0.0) {
      continue;
    }

    let sigmaS : f32 = albedo * sigmaT;
    let sigmaA : f32 = sigmaT - sigmaS;
    let stepT : f32 = exp(-sigmaT * dt);
    let weight : f32 = (1.0 - stepT) / sigmaT;

    var source : vec3<f32> = vec3<f32>(0.0);
    if (sigmaS > 0.0 && lightCount > 0u) {
      let worldPoint : vec3<f32> = worldOrigin + t * worldDir;
      for (var li : u32 = 0u; li < lightCount; li = li + 1u) {
        let slot : vec4<f32> = lights[li * 2u];
        let payload : vec4<f32> = lights[li * 2u + 1u];
        var wi : vec3<f32>;
        var radianceIn : vec3<f32>;
        var distance : f32;
        if (slot.w > 0.5) {
          wi = -normalize(slot.xyz);
          distance = FAR;
          radianceIn = payload.xyz;
        } else {
          let delta : vec3<f32> = slot.xyz - worldPoint;
          distance = length(delta);
          if (distance <= 0.0) {
            continue;
          }
          wi = delta / distance;
          let falloff : f32 = select(1.0, 1.0 / (distance * distance), payload.w > 0.5);
          radianceIn = payload.xyz * falloff;
        }
        let phase : f32 = henyeyGreenstein(g, dot(wi, worldDir));
        var shadow : f32 = 1.0;
        if (useShadows) {
          var tracker : Tracker;
          tracker.base = hashKeys3(seed, pixelIndex, k, 3u + li);
          tracker.counter = 0u;
          let shadowDir : vec3<f32> = (uni.worldToObject * vec4<f32>(wi, 0.0)).xyz;
          let shadowSpan : vec2<f32> = intersectBounds(p, shadowDir, 0.0, distance);
          if (shadowSpan.y > shadowSpan.x) {
            shadow = ratioTracking(p, shadowDir, shadowSpan.x, shadowSpan.y, majorant, &tracker);
          }
        }
        source = source + radianceIn * (sigmaS * phase * shadow);
      }
    }

    if (sigmaS > 0.0) {
      source = source + uni.ambient.xyz * sigmaS;
    }

    if (sigmaA > 0.0 && emissionScale > 0.0) {
      let temperature : f32 = sampleTrilinear(true, p);
      source = source + emissionRadiance(temperature) * (sigmaA * emissionScale);
    }

    radiance = radiance + source * (transmittance * weight);
    let opacity : f32 = transmittance * (1.0 - stepT);
    depthWeight = depthWeight + opacity;
    depthWeighted = depthWeighted + opacity * t;
    transmittance = transmittance * stepT;
    if (depth >= FAR && (1.0 - transmittance) >= depthThreshold) {
      depth = t;
    }
    if (transmittance < uni.march.z) {
      break;
    }
  }

  let expectedDepth : f32 = select(FAR, depthWeighted / max(depthWeight, 1e-20), depthWeight > 0.0);
  outputBuffer[pixelIndex * 2u] = vec4<f32>(radiance, 1.0 - transmittance);
  outputBuffer[pixelIndex * 2u + 1u] = vec4<f32>(transmittance, depth, expectedDepth, evaluated);
}
`;

/** WGSL 소스에서 선언된 struct 필드 순서를 뽑는다(오프셋 표 대조용 테스트 유틸). */
export function studioVolumeWgslUniformFieldOrder(): string[] {
  const match = /struct VolumeUniforms \{([\s\S]*?)\};/.exec(STUDIO_VOLUME_WGSL);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes(":"))
    .map((line) => line.split(":")[0].trim());
}
