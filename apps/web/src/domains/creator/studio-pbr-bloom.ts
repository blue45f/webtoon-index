/**
 * Studio PBR — 블룸(광원 번짐) 코어, 순수 TS
 *
 * 【웹툰 파이프라인에서의 정직한 위치 — 최하위, LT 모드에서는 오히려 해롭다】
 *  블룸은 선 경계를 넘어 번진다. main-line / texture-line / tone 패스에서 켜면 cel
 *  양자화 뒤에 선이 뭉툭한 헤일로로 변해 선화 품질을 직접 깎아먹는다. 그래서 이 모듈의
 *  기본 정책은 **LT 계열 패스에서 OFF** 이고, 야경·네온 이펙트 컷의 beauty/color 패스
 *  에서만 켜는 것이다(STUDIO_PBR_BLOOM_SAFE_PASSES 참고). 이 순위를 흐리면 안 된다.
 *
 * 【알고리즘】 Jimenez(COD:AW) 듀얼 필터 체인.
 *  1. 밝기 추출: 소프트 니(knee) 커브로 threshold 근처를 부드럽게 밟아 올린다.
 *     threshold-knee 아래는 **정확히 0**, threshold+knee 위는 정확히 (br-threshold)/br 이다.
 *  2. 다운샘플: 13탭 커널(중앙 박스 4탭 0.5 + 십자 4탭 0.25 + 모서리 4탭 0.125 + 중심 0.125),
 *     가중치 합 정확히 1 — 균일 입력이 그대로 보존된다(테스트가 단언).
 *  3. 업샘플: 3×3 텐트([1,2,1]⊗[1,2,1]/16), 역시 합 1.
 *  4. 합성: 체인을 위로 접어 올리며 누적하고 intensity 로 원본에 가산한다.
 *
 * 【정직한 한계】
 *  - 렌즈 더트/고스팅/애너모픽 스트릭 없음. 단순 가우시안 근사 번짐이다.
 *  - 물리적 산란(PSF 컨볼루션)이 아니라 예술적 근사다.
 *  - 스레숄드 방식은 시간적 불안정(반짝임)을 낳을 수 있다 — 정지 컷 렌더가 주 용도라
 *    허용했지만, 애니메이션 컷에서는 카르마-style 에너지 보존 블룸이 더 낫다.
 */

/** 블룸을 켜도 안전한 shot batch 패스 — LT 계열(main-line/texture-line/tone)은 제외한다. */
export const STUDIO_PBR_BLOOM_SAFE_PASSES = ["beauty", "color"] as const;

export interface StudioPbrBloomThresholdParams {
  /** 이 휘도 위부터 번진다. */
  readonly threshold: number;
  /** 소프트 니 폭. 0 이면 하드 컷(밴딩 위험). */
  readonly knee: number;
}

export interface StudioPbrBloomImage {
  readonly width: number;
  readonly height: number;
  /** width·height·3 선형 RGB(HDR, 1 초과 허용). */
  readonly rgb: Float32Array;
}

function assertImage(image: StudioPbrBloomImage, label: string): void {
  const expected = image.width * image.height * 3;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
    throw new Error(`studio-pbr: ${label} 해상도가 잘못됐다 (${image.width}×${image.height})`);
  }
  if (image.rgb.length !== expected) {
    throw new Error(`studio-pbr: ${label} rgb 길이 불일치 (기대 ${expected}, 실제 ${image.rgb.length})`);
  }
}

/**
 * 소프트 니 기여 계수. 반환값은 원본 색에 곱할 스칼라 [0,1].
 *
 * 검증 가능한 두 극한:
 *   br ≤ threshold - knee  → 정확히 0
 *   br ≥ threshold + knee  → 정확히 (br - threshold)/br
 */
export function studioPbrBloomKneeWeight(brightness: number, params: StudioPbrBloomThresholdParams): number {
  const br = brightness;
  if (!(br > 0)) return 0;
  const { threshold, knee } = params;
  const hard = br - threshold;
  if (knee <= 0) return hard > 0 ? hard / br : 0;
  let soft = br - threshold + knee;
  soft = soft < 0 ? 0 : soft > 2 * knee ? 2 * knee : soft;
  soft = (soft * soft) / (4 * knee);
  const contribution = Math.max(soft, hard);
  return contribution > 0 ? contribution / br : 0;
}

/**
 * 밝은 부분만 남긴 이미지를 만든다. 밝기 척도는 max(r,g,b) 다 — 채도 높은 단색 네온이
 * 휘도 기준으로는 임계를 못 넘어 사라지는 문제를 피하려는 의도적 선택이다.
 */
export function extractStudioPbrBloomBright(
  image: StudioPbrBloomImage,
  params: StudioPbrBloomThresholdParams,
): StudioPbrBloomImage {
  assertImage(image, "bloom 입력");
  const out = new Float32Array(image.rgb.length);
  for (let i = 0; i < image.rgb.length; i += 3) {
    const r = image.rgb[i];
    const g = image.rgb[i + 1];
    const b = image.rgb[i + 2];
    const weight = studioPbrBloomKneeWeight(Math.max(r, g, b), params);
    if (weight <= 0) continue;
    out[i] = r * weight;
    out[i + 1] = g * weight;
    out[i + 2] = b * weight;
  }
  return { width: image.width, height: image.height, rgb: out };
}

// ---------------------------------------------------------------------------
// 13탭 다운샘플 / 9탭 텐트 업샘플
// ---------------------------------------------------------------------------

/** Jimenez 13탭 커널 — [dx, dy, weight]. 가중치 합은 정확히 1. */
export const STUDIO_PBR_BLOOM_DOWNSAMPLE_TAPS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.125],
  [-1, -1, 0.125],
  [1, -1, 0.125],
  [-1, 1, 0.125],
  [1, 1, 0.125],
  [-2, -2, 0.03125],
  [0, -2, 0.0625],
  [2, -2, 0.03125],
  [-2, 0, 0.0625],
  [2, 0, 0.0625],
  [-2, 2, 0.03125],
  [0, 2, 0.0625],
  [2, 2, 0.03125],
];

/** 3×3 텐트 업샘플 커널 — [dx, dy, weight/16]. 합은 정확히 1. */
export const STUDIO_PBR_BLOOM_UPSAMPLE_TAPS: readonly (readonly [number, number, number])[] = [
  [-1, -1, 1 / 16],
  [0, -1, 2 / 16],
  [1, -1, 1 / 16],
  [-1, 0, 2 / 16],
  [0, 0, 4 / 16],
  [1, 0, 2 / 16],
  [-1, 1, 1 / 16],
  [0, 1, 2 / 16],
  [1, 1, 1 / 16],
];

function fetchClamped(image: StudioPbrBloomImage, x: number, y: number, channel: number): number {
  const cx = x < 0 ? 0 : x >= image.width ? image.width - 1 : x;
  const cy = y < 0 ? 0 : y >= image.height ? image.height - 1 : y;
  return image.rgb[(cy * image.width + cx) * 3 + channel];
}

/** 절반 해상도로 13탭 다운샘플(최소 1×1). 소스 좌표는 반픽셀 단위로 잡는다. */
export function downsampleStudioPbrBloom(image: StudioPbrBloomImage): StudioPbrBloomImage {
  assertImage(image, "bloom 다운샘플 입력");
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x * 2;
      const sy = y * 2;
      const out = (y * width + x) * 3;
      for (const [dx, dy, weight] of STUDIO_PBR_BLOOM_DOWNSAMPLE_TAPS) {
        for (let c = 0; c < 3; c += 1) {
          rgb[out + c] += fetchClamped(image, sx + dx, sy + dy, c) * weight;
        }
      }
    }
  }
  return { width, height, rgb };
}

/** 지정 해상도로 3×3 텐트 업샘플. */
export function upsampleStudioPbrBloom(
  image: StudioPbrBloomImage,
  targetWidth: number,
  targetHeight: number,
): StudioPbrBloomImage {
  assertImage(image, "bloom 업샘플 입력");
  const rgb = new Float32Array(targetWidth * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.floor((y * image.height) / targetHeight);
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.floor((x * image.width) / targetWidth);
      const out = (y * targetWidth + x) * 3;
      for (const [dx, dy, weight] of STUDIO_PBR_BLOOM_UPSAMPLE_TAPS) {
        for (let c = 0; c < 3; c += 1) {
          rgb[out + c] += fetchClamped(image, sx + dx, sy + dy, c) * weight;
        }
      }
    }
  }
  return { width: targetWidth, height: targetHeight, rgb };
}

/**
 * 밝기 추출 결과에서 다운샘플 체인을 만든다(레벨 0 = 원본 해상도).
 * 해상도가 1 이하로 떨어지면 조기 종료한다.
 */
export function buildStudioPbrBloomChain(bright: StudioPbrBloomImage, levels: number): StudioPbrBloomImage[] {
  if (!Number.isInteger(levels) || levels < 1) {
    throw new Error(`studio-pbr: bloom levels 는 1 이상 정수여야 한다 (${levels})`);
  }
  const chain: StudioPbrBloomImage[] = [bright];
  for (let i = 1; i < levels; i += 1) {
    const previous = chain[chain.length - 1];
    if (previous.width <= 2 || previous.height <= 2) break;
    chain.push(downsampleStudioPbrBloom(previous));
  }
  return chain;
}

export interface StudioPbrBloomComposeParams {
  /** 원본에 더할 블룸 세기. 0 이면 정확히 항등. */
  readonly intensity: number;
  /** 체인 레벨 간 혼합비(0..1). 클수록 넓게 퍼진다. 기본 0.5. */
  readonly levelBlend?: number;
}

/**
 * 체인을 위로 접어 올린 뒤 원본에 가산 합성한다.
 * intensity 0 이면 입력 rgb 와 **바이트 동일**한 복사본을 돌려준다(항등 보장).
 */
export function composeStudioPbrBloom(
  hdr: StudioPbrBloomImage,
  chain: readonly StudioPbrBloomImage[],
  params: StudioPbrBloomComposeParams,
): StudioPbrBloomImage {
  assertImage(hdr, "bloom 합성 원본");
  if (chain.length === 0) throw new Error("studio-pbr: bloom 체인이 비었다");
  const out = Float32Array.from(hdr.rgb);
  if (params.intensity === 0) return { width: hdr.width, height: hdr.height, rgb: out };
  const blend = params.levelBlend ?? 0.5;

  let accumulated = chain[chain.length - 1];
  for (let level = chain.length - 2; level >= 0; level -= 1) {
    const target = chain[level];
    const up = upsampleStudioPbrBloom(accumulated, target.width, target.height);
    const merged = new Float32Array(target.rgb.length);
    for (let i = 0; i < merged.length; i += 1) {
      merged[i] = target.rgb[i] * (1 - blend) + up.rgb[i] * blend;
    }
    accumulated = { width: target.width, height: target.height, rgb: merged };
  }
  const final =
    accumulated.width === hdr.width && accumulated.height === hdr.height
      ? accumulated
      : upsampleStudioPbrBloom(accumulated, hdr.width, hdr.height);
  for (let i = 0; i < out.length; i += 1) out[i] += final.rgb[i] * params.intensity;
  return { width: hdr.width, height: hdr.height, rgb: out };
}
