/**
 * Studio PBR — SSAO (스크린 스페이스 앰비언트 오클루전) 코어, 순수 TS
 *
 * 【웹툰 파이프라인에서 가장 값을 하는 패스】
 *  studio-bg3d-lt-render 의 tone 패스는 휘도를 `tone.levels` 개의 밴드로 양자화한 뒤
 *  dot/line/crosshatch 스크린톤을 깐다. AO 를 **양자화 이전에** 휘도에 곱하면 모서리·틈·
 *  접촉부가 한 밴드 아래로 내려가면서, 배경 어시스턴트가 손으로 넣던 해칭 밀도가
 *  자동으로 생긴다. line.depthEnabled 계열의 내부선 힌트로도 그대로 재사용된다.
 *  그림자 맵이 "덩어리 실루엣"을 준다면 AO 는 "접촉 디테일"을 준다 — 둘은 대체재가 아니다.
 *
 * 【알고리즘】 반구 커널 SSAO(Crytek/Chapman 계열).
 *  1. 픽셀의 선형 뷰 깊이와 뷰 공간 법선으로 뷰 공간 위치 P 를 복원한다.
 *  2. 법선을 +Z 로 하는 TBN 으로 반구 커널을 회전시켜 P 주변 표본점 S 를 만든다.
 *  3. S 를 화면에 재투영해 그 픽셀의 실제 깊이(sceneZ)를 읽는다.
 *  4. sceneZ 가 S 보다 카메라에 가까우면 S 는 지오메트리에 묻힌 것 → 가림 1표.
 *  5. |P.z - sceneZ| 가 radius 보다 크면 무관한 배경이므로 range check 로 감쇠시킨다.
 *  AO = 1 - (가림표/샘플수)·intensity.
 *
 * 【결정성】 커널과 회전 텍스처는 studio-grain 의 hash2(x,y,seed) 로 만든다 —
 *  Math.random 없음, seed 는 호출부가 명시한다. 같은 seed = 바이트 동일 커널.
 *  회전 텍스처를 쓰는 것은 밴딩을 흩기 위함이지 무작위성이 필요해서가 아니다.
 *
 * 【정직한 한계】
 *  - **이 TS 구현은 정확도 기준선이지 프로덕션 경로가 아니다.** 화면 픽셀 × 커널 탭의
 *    O(px·samples) 루프라 이 레포 상한(8,388,608 px)에서 16탭이면 실측 처리율 기준 수 초가
 *    걸린다. 프로덕션은 WGSL 컴퓨트 경로이고, CPU 폴백은
 *    STUDIO_PBR_SSAO_MAX_CPU_PIXELS 가드로 막는다.
 *  - HBAO/GTAO 가 아니다. 수평선 탐색도, 가시성 적분의 코사인 가중도 없어서
 *    물리적으로 정확한 벤딩 노멀/멀티바운스는 나오지 않는다.
 *  - 카메라 모델은 핀홀 원근(focalX/focalY)만 지원한다. 직교 투영·왜곡 렌즈 미지원.
 *  - 반투명·알파 테스트 지오메트리는 깊이 버퍼에 없으면 가림에 참여하지 못한다.
 *
 * 【제품 리스크(단위 테스트로 못 잡는 것)】 AO 에 남은 노이즈/밴딩이 cel 양자화를
 *  통과하면 스크린톤에 얼룩으로 **증폭**된다. 그래서 기본값을 보수적으로(강한 블러 +
 *  낮은 intensity) 잡았고, 밴드 수와의 상호작용은 브라우저 육안 검증이 필요하다.
 */

import { hash2 } from "./studio-grain";

/** CPU 참조 경로 픽셀 상한 — 넘으면 던진다(UI 멈춤 방지). GPU 경로에는 적용되지 않는다. */
export const STUDIO_PBR_SSAO_MAX_CPU_PIXELS = 1_048_576; // 1024×1024

export const STUDIO_PBR_SSAO_DEFAULT_SAMPLES = 16;
export const STUDIO_PBR_SSAO_ROTATION_SIZE = 4;

// ---------------------------------------------------------------------------
// 커널 / 회전 텍스처
// ---------------------------------------------------------------------------

export interface StudioPbrSsaoKernelOptions {
  readonly sampleCount?: number;
  readonly seed: number;
}

/**
 * 반구(+Z) 커널을 만든다. 길이 sampleCount·3 의 Float32Array.
 *
 * 각 표본은 단위 반구 안의 벡터이며, 원점 쪽으로 몰리도록 스케일 바이어스
 * scale = lerp(0.1, 1, (i/N)²) 를 곱한다 — 접촉부(가까운 거리)의 표본 밀도를 높여
 * 얇은 틈이 뭉개지지 않게 하는 표준 기법이다.
 */
export function buildStudioPbrSsaoKernel(options: StudioPbrSsaoKernelOptions): Float32Array {
  const sampleCount = options.sampleCount ?? STUDIO_PBR_SSAO_DEFAULT_SAMPLES;
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error(`studio-pbr: SSAO sampleCount 는 1 이상 정수여야 한다 (${sampleCount})`);
  }
  const seed = Math.floor(options.seed) | 0;
  const kernel = new Float32Array(sampleCount * 3);
  for (let i = 0; i < sampleCount; i += 1) {
    // hash2 는 결정적 32비트 믹서다 — 좌표(i, 채널)+seed 로 세 성분을 뽑는다.
    let x = hash2(i, 0, seed) * 2 - 1;
    let y = hash2(i, 1, seed) * 2 - 1;
    let z = hash2(i, 2, seed); // +Z 반구
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 0) {
      x /= length;
      y /= length;
      z /= length;
    } else {
      x = 0;
      y = 0;
      z = 1;
    }
    const t = i / sampleCount;
    const scale = 0.1 + 0.9 * t * t;
    kernel[i * 3] = x * scale;
    kernel[i * 3 + 1] = y * scale;
    kernel[i * 3 + 2] = z * scale;
  }
  return kernel;
}

/**
 * 커널을 픽셀마다 다르게 비틀 회전 벡터 타일(size×size, xy 단위벡터).
 * 밴딩을 고주파로 흩어 블러가 지우기 쉽게 만든다.
 */
export function buildStudioPbrSsaoRotationTexture(size: number, seed: number): Float32Array {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`studio-pbr: 회전 텍스처 size 는 1 이상 정수여야 한다 (${size})`);
  }
  const s = Math.floor(seed) | 0;
  const texture = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const angle = hash2(x, y, s) * Math.PI * 2;
      const index = (y * size + x) * 2;
      texture[index] = Math.cos(angle);
      texture[index + 1] = Math.sin(angle);
    }
  }
  return texture;
}

// ---------------------------------------------------------------------------
// SSAO 계산
// ---------------------------------------------------------------------------

export interface StudioPbrSsaoInput {
  readonly width: number;
  readonly height: number;
  /** 픽셀당 선형 뷰 깊이(카메라로부터의 양수 거리). 0 이하는 "배경"으로 취급. */
  readonly viewZ: Float32Array;
  /** 픽셀당 뷰 공간 단위 법선 3성분(+Z 가 카메라 쪽). */
  readonly normal: Float32Array;
}

export interface StudioPbrSsaoParams {
  /** 뷰 공간 단위의 샘플 반경. */
  readonly radius: number;
  /** 자기 가림 방지 깊이 바이어스(뷰 단위). */
  readonly bias?: number;
  /** AO 세기 0..1(웹툰 톤 밴딩 증폭을 감안해 기본 0.6 으로 보수적). */
  readonly intensity?: number;
  readonly sampleCount?: number;
  readonly seed: number;
  /** NDC 초점거리 x = 1/tan(fovX/2). */
  readonly focalX: number;
  /** NDC 초점거리 y = 1/tan(fovY/2). */
  readonly focalY: number;
  /** 회전 타일 크기(기본 4). 1 이면 회전 없음(결정적 격자). */
  readonly rotationSize?: number;
  /** CPU 픽셀 상한 무시(테스트/오프라인 전용). */
  readonly allowLargeCpuBuffer?: boolean;
}

function smoothstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * SSAO 를 계산해 픽셀당 [0,1] 가시도(1 = 가림 없음)를 돌려준다.
 * 배경(viewZ ≤ 0)은 1 로 채운다 — 하늘에 해칭이 들어가면 안 된다.
 */
export function computeStudioPbrSsao(input: StudioPbrSsaoInput, params: StudioPbrSsaoParams): Float32Array {
  const { width, height, viewZ, normal } = input;
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`studio-pbr: SSAO 해상도가 잘못됐다 (${width}×${height})`);
  }
  if (viewZ.length !== pixelCount) {
    throw new Error(`studio-pbr: viewZ 길이 불일치 (기대 ${pixelCount}, 실제 ${viewZ.length})`);
  }
  if (normal.length !== pixelCount * 3) {
    throw new Error(`studio-pbr: normal 길이 불일치 (기대 ${pixelCount * 3}, 실제 ${normal.length})`);
  }
  if (!params.allowLargeCpuBuffer && pixelCount > STUDIO_PBR_SSAO_MAX_CPU_PIXELS) {
    throw new Error(
      `studio-pbr: CPU SSAO 상한 초과 (${pixelCount} > ${STUDIO_PBR_SSAO_MAX_CPU_PIXELS}) — GPU 경로를 쓰거나 해상도를 낮춰라`,
    );
  }
  const sampleCount = params.sampleCount ?? STUDIO_PBR_SSAO_DEFAULT_SAMPLES;
  const radius = params.radius;
  if (!(radius > 0)) throw new Error(`studio-pbr: SSAO radius 는 양수여야 한다 (${radius})`);
  const bias = params.bias ?? 0.02;
  const intensity = params.intensity ?? 0.6;
  const rotationSize = params.rotationSize ?? STUDIO_PBR_SSAO_ROTATION_SIZE;
  const kernel = buildStudioPbrSsaoKernel({ sampleCount, seed: params.seed });
  const rotation = buildStudioPbrSsaoRotationTexture(rotationSize, params.seed);

  const ao = new Float32Array(pixelCount);
  const { focalX, focalY } = params;

  for (let py = 0; py < height; py += 1) {
    const ndcY = 1 - ((py + 0.5) / height) * 2;
    for (let px = 0; px < width; px += 1) {
      const pixel = py * width + px;
      const z = viewZ[pixel];
      if (!(z > 0)) {
        ao[pixel] = 1;
        continue;
      }
      const ndcX = ((px + 0.5) / width) * 2 - 1;
      const pX = (ndcX * z) / focalX;
      const pY = (ndcY * z) / focalY;
      const pZ = -z;

      let nx = normal[pixel * 3];
      let ny = normal[pixel * 3 + 1];
      let nz = normal[pixel * 3 + 2];
      const nLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLength > 0) {
        nx /= nLength;
        ny /= nLength;
        nz /= nLength;
      } else {
        nx = 0;
        ny = 0;
        nz = 1;
      }

      // 회전 타일에서 랜덤 접선을 뽑아 Gram-Schmidt 로 TBN 구성.
      const rIndex = ((py % rotationSize) * rotationSize + (px % rotationSize)) * 2;
      const rx = rotation[rIndex];
      const ry = rotation[rIndex + 1];
      const rDotN = rx * nx + ry * ny;
      let tx = rx - nx * rDotN;
      let ty = ry - ny * rDotN;
      let tz = -nz * rDotN;
      const tLength = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tLength > 1e-6) {
        tx /= tLength;
        ty /= tLength;
        tz /= tLength;
      } else {
        // 법선이 회전 벡터와 평행하면 임의의 직교 접선으로 대체.
        tx = nz;
        ty = 0;
        tz = -nx;
        const fallback = Math.sqrt(tx * tx + tz * tz) || 1;
        tx /= fallback;
        tz /= fallback;
      }
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;

      let occlusion = 0;
      for (let s = 0; s < sampleCount; s += 1) {
        const kx = kernel[s * 3];
        const ky = kernel[s * 3 + 1];
        const kz = kernel[s * 3 + 2];
        const sx = pX + (tx * kx + bx * ky + nx * kz) * radius;
        const sy = pY + (ty * kx + by * ky + ny * kz) * radius;
        const sz = pZ + (tz * kx + bz * ky + nz * kz) * radius;
        const sampleDepth = -sz;
        if (!(sampleDepth > 0)) continue;
        const sNdcX = (sx * focalX) / sampleDepth;
        const sNdcY = (sy * focalY) / sampleDepth;
        const tx2 = Math.round(((sNdcX + 1) * 0.5) * width - 0.5);
        const ty2 = Math.round(((1 - sNdcY) * 0.5) * height - 0.5);
        if (tx2 < 0 || ty2 < 0 || tx2 >= width || ty2 >= height) continue;
        const sceneZ = viewZ[ty2 * width + tx2];
        if (!(sceneZ > 0)) continue;
        if (sceneZ + bias < sampleDepth) {
          // range check: 깊이 차가 radius 보다 크면 무관한 배경이라 감쇠.
          occlusion += smoothstep01(radius / Math.abs(z - sceneZ));
        }
      }
      const value = 1 - (occlusion / sampleCount) * intensity;
      ao[pixel] = value < 0 ? 0 : value > 1 ? 1 : value;
    }
  }
  return ao;
}

/**
 * 분리형 박스 블러(가로 → 세로), 가장자리는 clamp-to-edge.
 * WGSL 블러 패스와 **같은 커널**이다 — GPU/CPU 대조의 기준선.
 * 에지 인식 블러가 아니다: 깊이 경계를 넘어 번지므로 radius 를 과하게 키우면 실루엣이
 * 흐려진다(기본 2 권장).
 */
export function blurStudioPbrSsao(ao: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (ao.length !== width * height) {
    throw new Error(`studio-pbr: AO 길이 불일치 (기대 ${width * height}, 실제 ${ao.length})`);
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`studio-pbr: 블러 radius 는 0 이상 정수여야 한다 (${radius})`);
  }
  if (radius === 0) return Float32Array.from(ao);
  const taps = radius * 2 + 1;
  const horizontal = new Float32Array(ao.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        sum += ao[y * width + sx];
      }
      horizontal[y * width + x] = sum / taps;
    }
  }
  const vertical = new Float32Array(ao.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        sum += horizontal[sy * width + x];
      }
      vertical[y * width + x] = sum / taps;
    }
  }
  return vertical;
}

/**
 * AO 를 LT 파이프라인이 먹을 수 있는 그레이스케일 RGBA 레이어 바이트로 바꾼다.
 * studio-bg3d-depth-pass 의 깊이 → 레이어 변환과 같은 계약(비사전곱, 알파 255).
 * 값 그대로 0..255 로 선형 양자화한다 — sRGB 인코딩을 하지 않는 것은 AO 가 색이 아니라
 * **곱셈 계수**이기 때문이다.
 */
export function encodeStudioPbrAoLayer(ao: Float32Array, width: number, height: number): Uint8ClampedArray {
  if (ao.length !== width * height) {
    throw new Error(`studio-pbr: AO 길이 불일치 (기대 ${width * height}, 실제 ${ao.length})`);
  }
  const bytes = new Uint8ClampedArray(ao.length * 4);
  for (let i = 0; i < ao.length; i += 1) {
    const v = Math.round(Math.min(1, Math.max(0, ao[i])) * 255);
    bytes[i * 4] = v;
    bytes[i * 4 + 1] = v;
    bytes[i * 4 + 2] = v;
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}
