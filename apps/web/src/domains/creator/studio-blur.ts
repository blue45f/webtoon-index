/**
 * Studio Blur Gallery Engine
 * 포토샵 "흐림 효과 갤러리(Blur Gallery)" — 앱에 없던 흐림들을 모았다(기존 Konva 박스 블러와 별개).
 *   gaussian: 분리형 가우시안 — 시그마별 최적 박스 폭(boxesForGauss) 3패스로 진짜 가우시안에 수렴.
 *   motion:   angle 방향 직선을 따라 ±radius px 평균을 내 빠른 이동 잔상을 만든다.
 *   spin:     이미지 중심을 축으로 ±radius도 회전 잔상을 더해 회오리 모션을 낸다.
 *   zoom:     중심에서 방사형으로 거리 배율(1±radius%)을 흔들어 돌진하는 줌 잔상을 낸다.
 * 품질 규칙:
 *   - 모든 샘플/블러는 알파 프리멀티플라이(rgb*α 가중 평균 후 α로 복원) — 투명 픽셀의 숨은
 *     RGB가 반투명 경계로 새며 생기는 검은 프린지를 막는다(알파 채널 자체는 절대 기록 안 함).
 *   - motion/spin/zoom 샘플 수는 실제 이동 거리(px)에 비례해 적응(상한 64) — 강한 설정에서도
 *     잔상이 계단(밴딩)으로 끊기지 않는다. 잔여 밴딩은 픽셀별 결정적 지터(hash2)로 노이즈화.
 * 부분 strength는 흐린 결과를 원본과 t=strength/100로 블렌드(가벼운 흐림). 알파(+3) 보존.
 * 전부 결정적(Math.random 없음, 지터는 hash2 시드 해시) — 같은 입력은 항상 같은 출력.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import { hash2 } from "./studio-grain";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type BlurFxType = "gaussian" | "motion" | "spin" | "zoom";

export type BlurFx = {
  type: BlurFxType; // 흐림 종류(가우시안/모션/스핀/줌)
  strength: number; // 0..100 세기(0이면 항등, 원본과 블렌드 비율)
  radius: number; // 1..40 가우시안 시그마px / 모션 거리px / 스핀 최대도 / 줌 최대%
  angle: number; // 0..360 모션 방향(도) — 모션 외 종류는 무시
};

/** 항등(효과 없음) — strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_BLURFX: BlurFx = { type: "gaussian", strength: 0, radius: 8, angle: 0 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위(0=항등). */
export const BLURFX_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 반경/거리/각도/배율 슬라이더 한 칸 범위 — 1..40, 1 단위. */
export const BLURFX_RADIUS_RANGE = { min: 1, max: 40, step: 1 } as const;
/** 모션 방향 슬라이더 한 칸 범위 — 0..360, 1 단위(모션 전용). */
export const BLURFX_ANGLE_RANGE = { min: 0, max: 360, step: 1 } as const;

/** 흐림 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const BLURFX_TYPES: { id: BlurFxType; label: string }[] = [
  { id: "gaussian", label: "가우시안" },
  { id: "motion", label: "모션" },
  { id: "spin", label: "스핀" },
  { id: "zoom", label: "줌" },
];

// 유효 BlurFxType 집합(외부 입력 검증용).
const BLURFX_TYPE_SET = new Set<BlurFxType>(BLURFX_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 BlurFxType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): BlurFxType {
  return typeof raw === "string" && BLURFX_TYPE_SET.has(raw as BlurFxType) ? (raw as BlurFxType) : DEFAULT_BLURFX.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 BlurFxType(아니면 기본 "gaussian").
 */
export function normalizeBlurFx(b?: Partial<BlurFx> | null): BlurFx {
  const src = b && typeof b === "object" ? b : {};
  return {
    type: normalizeType(src.type),
    strength: clampTo(src.strength, BLURFX_STRENGTH_RANGE.min, BLURFX_STRENGTH_RANGE.max, DEFAULT_BLURFX.strength),
    radius: clampTo(src.radius, BLURFX_RADIUS_RANGE.min, BLURFX_RADIUS_RANGE.max, DEFAULT_BLURFX.radius),
    angle: clampTo(src.angle, BLURFX_ANGLE_RANGE.min, BLURFX_ANGLE_RANGE.max, DEFAULT_BLURFX.angle),
  };
}

/** strength<=0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityBlurFx(b: BlurFx): boolean {
  return b.strength <= 0;
}

// ---------------------------------------------------------------------------
// 샘플링 유틸 — 가장자리 클램프 양선형(bilinear) 보간(motion/spin/zoom 공유)
// ---------------------------------------------------------------------------

// 좌표를 [0, n-1]로 클램프.
function clampCoord(v: number, n: number): number {
  if (v < 0) return 0;
  const max = n - 1;
  return v > max ? max : v;
}

// 프리멀티 가중 합이 이보다 작으면 "전부 투명"으로 보고 원본 픽셀로 폴백한다.
const PREMULTIPLY_EPSILON = 1e-4;

// 잔상 샘플 수 상한 — 이동 거리(px)에 비례해 늘리되 이 값을 넘지 않는다(성능 캡).
const MAX_TRAIL_SAMPLES = 64;

// 픽셀별 결정적 지터 시드(종류별로 분리해 패턴 상관을 끊는다).
const MOTION_JITTER_SEED = 733;
const SPIN_JITTER_SEED = 947;
const ZOOM_JITTER_SEED = 1103;

/**
 * 원본 스냅샷(src)에서 (fx,fy)의 색을 알파 프리멀티플라이 양선형 보간으로 읽는다.
 * out[0..2] = rgb*(α/255) 가중 누적값, out[3] = (α/255) 가중치 합.
 * 호출부가 Σrgbα/Σα로 복원하면 투명 픽셀의 숨은 RGB가 평균을 오염(검은 프린지)하지 않는다.
 * 가장자리는 좌표 클램프(테두리 번짐 방지). 알파 채널 기록 없음.
 */
function sampleBilinearPremultiplied(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  out: Float32Array
): void {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x0c = clampCoord(x0, width);
  const x1c = clampCoord(x0 + 1, width);
  const y0c = clampCoord(y0, height);
  const y1c = clampCoord(y0 + 1, height);
  const i00 = (y0c * width + x0c) * 4;
  const i10 = (y0c * width + x1c) * 4;
  const i01 = (y1c * width + x0c) * 4;
  const i11 = (y1c * width + x1c) * 4;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  const a00 = (src[i00 + 3]! / 255) * w00;
  const a10 = (src[i10 + 3]! / 255) * w10;
  const a01 = (src[i01 + 3]! / 255) * w01;
  const a11 = (src[i11 + 3]! / 255) * w11;
  for (let c = 0; c < 3; c++) {
    out[c] = src[i00 + c]! * a00 + src[i10 + c]! * a10 + src[i01 + c]! * a01 + src[i11 + c]! * a11;
  }
  out[3] = a00 + a10 + a01 + a11;
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 흐림(원본 스냅샷에서 읽어 제자리 기록, strength 블렌드, 알파 보존)
// ---------------------------------------------------------------------------

/**
 * 흐림 갤러리 제자리 적용 — 항등(strength<=0)이면 no-op. 종류별로 분기한다.
 *
 *   gaussian: boxesForGauss 반경의 분리형 3패스 박스 블러(radius=시그마)로 r/g/b를 부드럽게 푼다.
 *   motion:   angle 단위벡터 방향 ±radius px 구간을 거리 비례 N점 평균(빠른 이동 잔상).
 *   spin:     중심 기준 같은 반지름에서 ±radius도를 호 길이 비례 K점 각 평균(회전 잔상).
 *   zoom:     중심에서 방사 거리 배율 [1-radius/100, 1+radius/100]을 거리 비례 K점 평균(줌 잔상).
 *
 * 흐린 결과는 t=strength/100로 원본과 채널별 블렌드(final = orig*(1-t) + blur*t).
 * 모든 종류가 r/g/b만 변형하고 알파(+3)는 보존한다. 같은 입력=같은 출력(결정적).
 */
export function applyBlurFx(img: StudioImageDataLike, b: BlurFx): void {
  if (isIdentityBlurFx(b)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const t = Math.min(1, Math.max(0, b.strength / 100)); // 블렌드 비율 0..1

  switch (b.type) {
    case "gaussian":
      applyGaussian(data, width, height, b.radius, t);
      break;
    case "motion":
      applyMotion(data, width, height, b.radius, b.angle, t);
      break;
    case "spin":
      applySpin(data, width, height, b.radius, t);
      break;
    case "zoom":
      applyZoom(data, width, height, b.radius, t);
      break;
  }
}

/**
 * 시그마 → 연속 3패스 박스 반경(boxesForGauss, W3C SVG 필터 사양의 표준 알고리즘).
 * 이상 박스 폭(wIdeal)에서 홀수 하한 wl/상한 wu를 잡고, 분산이 시그마²에 맞도록
 * 앞 m패스는 wl, 나머지는 wu를 쓴다 — 고정 반경 3패스보다 저반경 과다 블러가 없고
 * 프로파일이 진짜 가우시안에 3차(piecewise cubic)로 수렴한다. 반경 0 패스는 건너뛴다.
 */
function gaussianBoxRadii(sigma: number): [number, number, number] {
  const passes = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl -= 1;
  if (wl < 1) wl = 1;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4);
  const m = Math.max(0, Math.min(passes, Math.round(mIdeal)));
  const rl = (wl - 1) / 2;
  const ru = (wu - 1) / 2;
  return [m > 0 ? rl : ru, m > 1 ? rl : ru, m > 2 ? rl : ru];
}

/**
 * 가우시안 — 알파 프리멀티플라이 4평면(r·α, g·α, b·α, α)을 boxesForGauss 반경으로
 * 3패스 분리형 박스 블러하고, Σrgbα/Σα로 색을 복원한다. 투명 픽셀의 숨은 RGB는 가중치 0이라
 * 반투명 경계에 검은 프린지를 만들지 않는다(불투명 이미지는 일반 블러와 완전 동일).
 * 최종은 원본과 t로 블렌드(부분 strength=가벼운 흐림). 알파 채널은 절대 기록하지 않는다.
 */
function applyGaussian(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  const radii = gaussianBoxRadii(radius);
  const n = width * height;

  // 프리멀티플라이 평면(인터리브 4채널: r·w, g·w, b·w, w — w=α/255). 알파는 읽기 전용.
  const buf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const w = data[j + 3]! / 255;
    buf[j] = data[j]! * w;
    buf[j + 1] = data[j + 1]! * w;
    buf[j + 2] = data[j + 2]! * w;
    buf[j + 3] = w;
  }

  // 핑퐁 3패스 — H는 buf→tmp, V는 tmp→buf로 쓰므로 매 패스 후 결과가 다시 buf에 모인다.
  const tmp = new Float32Array(n * 4);
  for (const r of radii) {
    if (r <= 0) continue;
    boxBlurPlane4H(buf, tmp, width, height, r);
    boxBlurPlane4V(tmp, buf, width, height, r);
  }

  // 프리멀티 복원 후 원본과 블렌드해 r/g/b 기록.
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const w = buf[j + 3]!;
    let br: number;
    let bg: number;
    let bb: number;
    if (w > PREMULTIPLY_EPSILON) {
      br = buf[j]! / w;
      bg = buf[j + 1]! / w;
      bb = buf[j + 2]! / w;
    } else {
      // 주변까지 전부 투명 — 복원 불가라 원본 RGB 유지(어차피 보이지 않는다).
      br = data[j]!;
      bg = data[j + 1]!;
      bb = data[j + 2]!;
    }
    data[j] = data[j]! + (br - data[j]!) * t;
    data[j + 1] = data[j + 1]! + (bg - data[j + 1]!) * t;
    data[j + 2] = data[j + 2]! + (bb - data[j + 2]!) * t;
  }
}

// 가로 박스 블러 — src(4채널 평면)를 행별 슬라이딩 합으로 평균해 dst에 쓴다. 가장자리 클램프.
function boxBlurPlane4H(src: Float32Array, dst: Float32Array, width: number, height: number, r: number): void {
  const win = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let c = 0; c < 4; c++) {
      // 초기 윈도우 합(좌측 가장자리 클램프 포함).
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const xx = clampCoord(k, width);
        sum += src[(row + xx) * 4 + c]!;
      }
      for (let x = 0; x < width; x++) {
        dst[(row + x) * 4 + c] = sum / win;
        // 윈도우를 오른쪽으로 한 칸: 나가는 좌끝 빼고 들어오는 우끝 더함(클램프).
        const outX = clampCoord(x - r, width);
        const inX = clampCoord(x + r + 1, width);
        sum += src[(row + inX) * 4 + c]! - src[(row + outX) * 4 + c]!;
      }
    }
  }
}

// 세로 박스 블러 — src(4채널 평면)를 열별 슬라이딩 합으로 평균해 dst에 쓴다. 가장자리 클램프.
function boxBlurPlane4V(src: Float32Array, dst: Float32Array, width: number, height: number, r: number): void {
  const win = 2 * r + 1;
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const yy = clampCoord(k, height);
        sum += src[(yy * width + x) * 4 + c]!;
      }
      for (let y = 0; y < height; y++) {
        dst[(y * width + x) * 4 + c] = sum / win;
        const outY = clampCoord(y - r, height);
        const inY = clampCoord(y + r + 1, height);
        sum += src[(inY * width + x) * 4 + c]! - src[(outY * width + x) * 4 + c]!;
      }
    }
  }
}

/**
 * 모션 — angle 단위벡터(cosθ, sinθ) 방향으로 ±radius px 구간을 N점 평균(빠른 이동 잔상).
 * N = min(64, 2·radius+1) — 이동 거리에 비례한 적응 표본이라 강한 반경에서도 잔상이 끊기지 않고,
 * 픽셀별 결정적 지터(±반 스텝)로 잔여 밴딩을 노이즈로 흩는다. 샘플은 알파 프리멀티플라이
 * 양선형(가장자리 클램프) — 투명 배경 위 반투명 경계에 검은 프린지가 없다. 원본과 t 블렌드. 알파 보존.
 */
function applyMotion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  angleDeg: number,
  t: number
): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // 표본 수 — 이동 지름(2·radius)당 1표본 이상(상한 MAX_TRAIL_SAMPLES).
  const samples = Math.min(MAX_TRAIL_SAMPLES, Math.max(3, 2 * Math.round(radius) + 1));
  const step = 2 / (samples - 1); // f 격자 간격(-1..1)
  const sampleAt = new Float32Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 결정적 지터 — 샘플 격자를 픽셀마다 ±반 스텝 이내로 흔들어 밴딩을 노이즈로 바꾼다.
      const jitter = (hash2(x, y, MOTION_JITTER_SEED) - 0.5) * step;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sw = 0;
      for (let s = 0; s < samples; s++) {
        const f = s * step - 1 + jitter; // ≈ -1..1 균등 + 지터
        const off = f * radius;
        sampleBilinearPremultiplied(src, width, height, x + dx * off, y + dy * off, sampleAt);
        sr += sampleAt[0]!;
        sg += sampleAt[1]!;
        sb += sampleAt[2]!;
        sw += sampleAt[3]!;
      }
      const j = (y * width + x) * 4;
      let br: number;
      let bg: number;
      let bb: number;
      if (sw > PREMULTIPLY_EPSILON) {
        br = sr / sw;
        bg = sg / sw;
        bb = sb / sw;
      } else {
        br = src[j]!;
        bg = src[j + 1]!;
        bb = src[j + 2]!;
      }
      data[j] = src[j]! + (br - src[j]!) * t;
      data[j + 1] = src[j + 1]! + (bg - src[j + 1]!) * t;
      data[j + 2] = src[j + 2]! + (bb - src[j + 2]!) * t;
    }
  }
}

// spin/zoom 픽셀별 최소 표본 수 — 이동이 짧아도 최소한의 평활은 유지.
const RADIAL_MIN_SAMPLES = 4;
// 이동 거리가 이 값(px)보다 짧으면 잔상이 눈에 안 보이므로 원본을 유지한다(중심부 스킵).
const RADIAL_SKIP_SPAN = 0.5;

/**
 * 중심 기준 방사 샘플 블러 공통 루프(spin/zoom 공유) — 각 픽셀에서 중심 오프셋(px,py)을 구해
 * K점(f=-1..1)에 대해 coordAt(px,py,f)가 주는 원본 좌표를 프리멀티 양선형 샘플·평균한 뒤
 * 원본과 t 블렌드한다. K는 spanOf(px,py)가 주는 실제 이동 거리(px)에 비례해 픽셀마다 적응
 * (중심부는 적게=빠르게, 가장자리는 많게=밴딩 없이) — 상한 MAX_TRAIL_SAMPLES.
 * 잔여 밴딩은 픽셀별 결정적 지터(hash2)로 노이즈화. 종류별로 다른 건 좌표 매핑·거리 함수뿐이다.
 */
function radialSampleBlend(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  t: number,
  jitterSeed: number,
  spanOf: (px: number, py: number) => number,
  coordAt: (px: number, py: number, f: number) => [number, number]
): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷
  const sampleAt = new Float32Array(4);
  for (let y = 0; y < height; y++) {
    const py = y - cy;
    for (let x = 0; x < width; x++) {
      const px = x - cx;
      const span = spanOf(px, py); // 이 픽셀의 총 이동 거리(px)
      if (span < RADIAL_SKIP_SPAN) continue; // 중심부 — 잔상이 안 보이므로 원본 유지
      const K = Math.min(MAX_TRAIL_SAMPLES, Math.max(RADIAL_MIN_SAMPLES, Math.ceil(span)));
      const step = 2 / (K - 1);
      const jitter = (hash2(x, y, jitterSeed) - 0.5) * step;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sw = 0;
      for (let s = 0; s < K; s++) {
        const f = s * step - 1 + jitter; // ≈ -1..1 균등 + 지터
        const [sx, sy] = coordAt(px, py, f);
        sampleBilinearPremultiplied(src, width, height, sx, sy, sampleAt);
        sr += sampleAt[0]!;
        sg += sampleAt[1]!;
        sb += sampleAt[2]!;
        sw += sampleAt[3]!;
      }
      const j = (y * width + x) * 4;
      let br: number;
      let bg: number;
      let bb: number;
      if (sw > PREMULTIPLY_EPSILON) {
        br = sr / sw;
        bg = sg / sw;
        bb = sb / sw;
      } else {
        br = src[j]!;
        bg = src[j + 1]!;
        bb = src[j + 2]!;
      }
      data[j] = src[j]! + (br - src[j]!) * t;
      data[j + 1] = src[j + 1]! + (bg - src[j + 1]!) * t;
      data[j + 2] = src[j + 2]! + (bb - src[j + 2]!) * t;
    }
  }
}

/**
 * 스핀 — 이미지 중심을 축으로 픽셀의 극좌표 각도를 ±radius도 흔들며 같은 반지름을 호 길이
 * 비례 표본으로 평균. 중심 픽셀은 반지름 0이라 불변. 프리멀티 양선형 샘플(가장자리 클램프).
 * 원본과 t 블렌드. 알파 보존.
 */
function applySpin(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxRad = (radius * Math.PI) / 180; // ±각도 범위(라디안)
  radialSampleBlend(
    data,
    width,
    height,
    cx,
    cy,
    t,
    SPIN_JITTER_SEED,
    // 총 이동 거리 = 호 길이 2·maxRad·dist.
    (px, py) => 2 * maxRad * Math.sqrt(px * px + py * py),
    (px, py, f) => {
      const dist = Math.sqrt(px * px + py * py);
      const baseAng = Math.atan2(py, px);
      const ang = baseAng + f * maxRad;
      return [cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist];
    }
  );
}

/**
 * 줌 — 이미지 중심에서 방사 직선을 따라 거리 배율 [1-radius/100, 1+radius/100]을 이동 거리
 * 비례 표본으로 평균(돌진 잔상). 중심 픽셀은 배율을 곱해도 제자리라 불변. 프리멀티 양선형 샘플.
 * 원본과 t 블렌드. 알파 보존.
 */
function applyZoom(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const span = radius / 100; // 배율 흔들림 폭(±)
  radialSampleBlend(
    data,
    width,
    height,
    cx,
    cy,
    t,
    ZOOM_JITTER_SEED,
    // 총 이동 거리 = 2·span·dist (방사 방향).
    (px, py) => 2 * span * Math.sqrt(px * px + py * py),
    (px, py, f) => {
      const scale = 1 + f * span; // 1-span..1+span
      return [cx + px * scale, cy + py * scale];
    }
  );
}

// ---------------------------------------------------------------------------
// 흐림 갤러리 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 흐림 조합.
// 모든 value는 normalizeBlurFx를 통과(strength 0..100, radius 1..40, angle 0..360, type 유효).
// ---------------------------------------------------------------------------

export type BlurFxPreset = { id: string; label: string; tip: string; value: BlurFx };

export const BLURFX_PRESETS: BlurFxPreset[] = [
  {
    id: "soft-focus",
    label: "소프트 포커스",
    tip: "은은한 가우시안 흐림으로 부드럽고 몽환적인 분위기를 더합니다.",
    value: normalizeBlurFx({ type: "gaussian", strength: 60, radius: 6, angle: 0 }),
  },
  {
    id: "speed",
    label: "스피드",
    tip: "강한 가로 모션 잔상으로 빠르게 지나가는 속도감을 연출합니다.",
    value: normalizeBlurFx({ type: "motion", strength: 85, radius: 24, angle: 0 }),
  },
  {
    id: "motion-strong",
    label: "강한 모션",
    tip: "대각선 방향의 굵은 모션 블러로 격렬한 움직임을 표현합니다.",
    value: normalizeBlurFx({ type: "motion", strength: 100, radius: 32, angle: 45 }),
  },
  {
    id: "impact-spin",
    label: "임팩트 스핀",
    tip: "중심을 축으로 도는 회전 잔상으로 충격·현기증 연출을 만듭니다.",
    value: normalizeBlurFx({ type: "spin", strength: 90, radius: 18, angle: 0 }),
  },
  {
    id: "focus-zoom",
    label: "집중 줌",
    tip: "중심으로 빨려드는 방사형 줌 잔상으로 시선을 한 점에 모읍니다.",
    value: normalizeBlurFx({ type: "zoom", strength: 90, radius: 20, angle: 0 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeBlurFx로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 bfType(string)과
 * bfStrength·bfRadius·bfAngle(각 number)를 읽어 normalizeBlurFx로 안전 변환 후 applyBlurFx.
 * 항등(strength 0)이거나 attrs가 비면 no-op.
 */
export function blurFxKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const b = normalizeBlurFx({
    type: typeof attrs.bfType === "string" ? (attrs.bfType as BlurFxType) : undefined,
    strength: attrNumber(attrs.bfStrength),
    radius: attrNumber(attrs.bfRadius),
    angle: attrNumber(attrs.bfAngle),
  });
  if (isIdentityBlurFx(b)) return;
  applyBlurFx(imageData, b);
}
