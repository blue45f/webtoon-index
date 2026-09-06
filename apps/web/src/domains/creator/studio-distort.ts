/**
 * Studio Distort / Warp Engine
 * 포토샵 "왜곡(Distort/Warp)" 기하 필터 갤러리 —
 *   twirl:  중심을 축으로 소용돌이처럼 비틀고(가운데·가장자리는 고정, 중간이 회전).
 *   ripple: 중심에서 퍼지는 동심원 물결로 반지름을 진동시킨다.
 *   pinch:  반지름을 안으로 빨아들이거나(핀치) 밖으로 부풀린다(어안/구체화).
 *   wave:   x는 y에, y는 x에 사인파를 더해 격자를 출렁이게 흔든다.
 * 전부 역매핑(inverse map)이다 — 원본 스냅샷을 떠 두고, 목적지 픽셀마다 대응하는
 *   원본 좌표를 구해 이중선형(bilinear)으로 샘플링한다(가장자리 클램프). 알파도 함께
 *   샘플링하므로 보존된다. Math.random·Date 없음 — 같은 입력은 항상 같은 출력(결정적).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type DistortType = "twirl" | "ripple" | "pinch" | "wave";

export type Distort = {
  type: DistortType; // 왜곡 종류(비틀기/물결/핀치/웨이브)
  amount: number; // -100..100 세기·방향(0이면 항등; 부호=방향)
  scale: number; // 1..50 파장/반경 스케일(px)
};

/** 항등(왜곡 없음) — amount 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_DISTORT: Distort = { type: "twirl", amount: 0, scale: 20 };

/** 세기 슬라이더 한 칸 범위 — -100..100, 1 단위. 0=항등, 부호=방향(비틀기 CW/CCW, 핀치 안/밖). */
export const DISTORT_AMOUNT_RANGE = { min: -100, max: 100, step: 1 } as const;
/** 스케일 슬라이더 한 칸 범위 — 1..50, 1 단위. 물결/웨이브 파장(px), 비틀기 반경 감쇠, 핀치 감쇠. */
export const DISTORT_SCALE_RANGE = { min: 1, max: 50, step: 1 } as const;

/** 왜곡 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const DISTORT_TYPES: { id: DistortType; label: string }[] = [
  { id: "twirl", label: "비틀기" },
  { id: "ripple", label: "물결" },
  { id: "pinch", label: "핀치" },
  { id: "wave", label: "웨이브" },
];

// 유효 DistortType 집합(외부 입력 검증용).
const DISTORT_TYPE_SET = new Set<DistortType>(DISTORT_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 DistortType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): DistortType {
  return typeof raw === "string" && DISTORT_TYPE_SET.has(raw as DistortType)
    ? (raw as DistortType)
    : DEFAULT_DISTORT.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 DistortType(아니면 기본 "twirl").
 */
export function normalizeDistort(d?: Partial<Distort> | null): Distort {
  const src = d && typeof d === "object" ? d : {};
  return {
    type: normalizeType(src.type),
    amount: clampTo(src.amount, DISTORT_AMOUNT_RANGE.min, DISTORT_AMOUNT_RANGE.max, DEFAULT_DISTORT.amount),
    scale: clampTo(src.scale, DISTORT_SCALE_RANGE.min, DISTORT_SCALE_RANGE.max, DEFAULT_DISTORT.scale),
  };
}

/** amount가 0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityDistort(d: Distort): boolean {
  return d.amount === 0;
}

// ---------------------------------------------------------------------------
// 이중선형 샘플링 — 소수 좌표를 원본 스냅샷에서 보간(가장자리 클램프, 알파 포함)
// ---------------------------------------------------------------------------

/**
 * 원본 스냅샷(src)에서 (sx,sy) 소수 좌표를 이중선형으로 샘플링해 dest[di..di+3]에 쓴다.
 * 좌표는 [0,width-1]×[0,height-1]로 클램프(가장자리 픽셀 반복)하므로 경계 밖도 안전하다.
 * r/g/b/a 네 채널을 모두 같은 가중치로 보간 — 알파(+3)도 함께 따라오므로 보존된다.
 */
function sampleBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  dest: Uint8ClampedArray,
  di: number
): void {
  // 가장자리 클램프 — 경계 밖 좌표는 가장 가까운 가장자리로.
  // 비유한(NaN/±Infinity) 좌표는 0으로 고정한다. 비교(<,>)는 NaN을 그냥 통과시켜
  // Math.floor(NaN)→NaN 인덱싱→undefined→NaN이 되고, Uint8ClampedArray가 NaN을 0으로
  // 클램프해 알파까지 0이 되는 버그를 막는다(정규화된 입력에선 안 생기지만 방어적으로).
  let fx = Number.isFinite(sx) ? sx : 0;
  let fy = Number.isFinite(sy) ? sy : 0;
  if (fx < 0) fx = 0;
  else if (fx > width - 1) fx = width - 1;
  if (fy < 0) fy = 0;
  else if (fy > height - 1) fy = height - 1;

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1 < width ? x0 + 1 : x0; // 우측 이웃(없으면 자기 자신)
  const y1 = y0 + 1 < height ? y0 + 1 : y0; // 하단 이웃(없으면 자기 자신)
  const tx = fx - x0;
  const ty = fy - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  // 가로 보간 가중치(상단/하단 행) → 세로 보간. 채널 4개 동일 처리.
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  for (let c = 0; c < 4; c++) {
    dest[di + c] = src[i00 + c]! * w00 + src[i10 + c]! * w10 + src[i01 + c]! * w01 + src[i11 + c]! * w11;
  }
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 역매핑 기하 왜곡(제자리 변형, 원본 스냅샷에서 이중선형 샘플)
// ---------------------------------------------------------------------------

/**
 * 왜곡 제자리 적용 — 항등(amount 0)이면 no-op. 원본 스냅샷을 한 번 떠 두고
 * 목적지 픽셀마다 역매핑으로 원본 좌표를 구해 이중선형 샘플링한다(가장자리 클램프).
 *
 *   center=(w/2,h/2), effectR=min(min(w,h)/2, scale), a=amount/100.
 *   twirl:  반지름 r의 감쇠 f=max(0,1-r/effectR)로 회전각 오프셋 a·π·f를 만든다.
 *           원본 각도 = 목적지 각도 - 오프셋 → 중심·가장자리는 고정, 중간만 비틀린다.
 *   ripple: 같은 각도에서 srcR = r + sin(r/scale)·a·scale 만큼 반지름을 진동시킨다.
 *   pinch:  srcR = r·(1 + a·(1 - r/effectR)). a>0이면 안으로 빨려들고(핀치),
 *           a<0이면 밖으로 부푼다(어안/구체화). srcR>=0으로 클램프.
 *   wave:   srcX = x + sin(y/scale)·a·scale, srcY = y + sin(x/scale)·a·scale.
 *
 * 모든 종류가 r/g/b/a를 함께 샘플링하므로 알파(+3)는 보존된다. 같은 입력=같은 출력(결정적).
 */
export function applyDistort(img: StudioImageDataLike, d: Distort): void {
  if (isIdentityDistort(d)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  // 역매핑은 원본을 읽으며 목적지를 덮어쓰므로 반드시 읽기용 스냅샷이 필요하다.
  const src = new Uint8ClampedArray(data);

  switch (d.type) {
    case "twirl":
      distortTwirl(src, data, width, height, d);
      break;
    case "ripple":
      distortRipple(src, data, width, height, d);
      break;
    case "pinch":
      distortPinch(src, data, width, height, d);
      break;
    case "wave":
      distortWave(src, data, width, height, d);
      break;
  }
}

/**
 * 중심 기준 역매핑 공통 루프 — 목적지 픽셀마다 중심 오프셋(dx,dy)·반지름 r을 구해
 * mapSrc(x,y,dx,dy,r)에 위임한다. mapSrc가 [sx,sy]를 주면 그 좌표를, null이면
 * 변위 없음(원본 x,y)을 이중선형 샘플링한다. 중심·항등 분기는 각 mapSrc가 null로 표현해
 * 종류별 가드(r===0 / r>=effectR 등)를 그대로 보존한다. 알파 포함 4채널 보간.
 */
function remapAroundCenter(
  src: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  mapSrc: (x: number, y: number, dx: number, dy: number, r: number) => [number, number] | null
): void {
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      const di = (y * width + x) * 4;
      const mapped = mapSrc(x, y, dx, dy, r);
      if (mapped === null) {
        sampleBilinear(src, width, height, x, y, data, di);
      } else {
        sampleBilinear(src, width, height, mapped[0], mapped[1], data, di);
      }
    }
  }
}

/**
 * 비틀기/핀치의 픽셀 단위 영향 반경. UI의 scale(1..50)이 실제 결과를 제어하도록 하고,
 * 짧은 변을 넘어선 영역에서는 방사형 감쇠가 음수로 뒤집히지 않게 내접 반경으로 제한한다.
 * 직접 호출의 비정상 scale도 normalizeDistort와 같은 범위/기본값으로 fail-safe 처리한다.
 */
function radialInfluenceRadius(width: number, height: number, scale: number): number {
  const imageRadius = Math.min(width, height) / 2;
  if (!(imageRadius > 0)) return 0;
  const safeScale = clampTo(
    scale,
    DISTORT_SCALE_RANGE.min,
    DISTORT_SCALE_RANGE.max,
    DEFAULT_DISTORT.scale
  );
  return Math.min(imageRadius, safeScale);
}

/**
 * 비틀기(twirl) — 중심을 축으로 소용돌이. scale을 픽셀 단위 영향 반경으로 삼고,
 * 반지름 r의 감쇠 f=max(0,1-r/effectR)로
 * 회전각 오프셋 angleOffset = a·π·f 를 만든다(중심 r=0은 변위가 없고, r=effectR은 f=0 → 고정).
 * 원본 각도 srcAngle = destAngle - angleOffset. 부호로 CW/CCW가 갈린다.
 */
function distortTwirl(
  src: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  d: Distort
): void {
  const cx = width / 2;
  const cy = height / 2;
  const effectR = radialInfluenceRadius(width, height, d.scale);
  const a = d.amount / 100;
  remapAroundCenter(src, data, width, height, cx, cy, (_x, _y, dx, dy, r) => {
    // 영향 반경 밖(또는 0)은 회전 없음 → 원본 좌표 그대로.
    if (effectR <= 0 || r >= effectR) return null;
    const f = 1 - r / effectR; // 중심 1, 영향 반경 경계 0
    const angleOffset = a * Math.PI * f;
    const destAngle = Math.atan2(dy, dx);
    const srcAngle = destAngle - angleOffset;
    return [cx + r * Math.cos(srcAngle), cy + r * Math.sin(srcAngle)];
  });
}

/**
 * 물결(ripple) — 중심에서 퍼지는 동심원. 같은 각도(방향)를 유지한 채 반지름만
 * srcR = r + sin(r/scale)·a·scale 로 진동시킨다. scale이 파장, a가 진폭을 정한다.
 */
function distortRipple(
  src: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  d: Distort
): void {
  const cx = width / 2;
  const cy = height / 2;
  const a = d.amount / 100;
  const scale = d.scale;
  remapAroundCenter(src, data, width, height, cx, cy, (_x, _y, dx, dy, r) => {
    // 중심은 방향이 없어 그대로 샘플(진동량 0).
    if (r === 0) return null;
    const srcR = r + Math.sin(r / scale) * a * scale;
    const ratio = srcR / r; // 같은 방향으로 반지름만 스케일.
    return [cx + dx * ratio, cy + dy * ratio];
  });
}

/**
 * 핀치(pinch) — scale을 픽셀 단위 영향 반경으로 삼아 안/밖으로 당긴다.
 * srcR = r·(1 + a·(1 - r/effectR)). a>0이면 중심으로 빨려들고(핀치),
 * a<0이면 부푼다(어안/구체화). 영향 반경 경계와 그 밖은 정확히 원본을 유지한다.
 */
function distortPinch(
  src: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  d: Distort
): void {
  const cx = width / 2;
  const cy = height / 2;
  const effectR = radialInfluenceRadius(width, height, d.scale);
  const a = d.amount / 100;
  remapAroundCenter(src, data, width, height, cx, cy, (_x, _y, dx, dy, r) => {
    // 중심 및 영향 반경 경계/밖은 변위 0 → 그대로. 이 가드가 음수 falloff를 차단한다.
    if (r === 0 || effectR <= 0 || r >= effectR) return null;
    const falloff = Math.max(0, 1 - r / effectR); // 중심 1, 영향 반경 경계 0
    let srcR = r * (1 + a * falloff);
    if (srcR < 0) srcR = 0; // 반지름 음수 방지
    const ratio = srcR / r;
    return [cx + dx * ratio, cy + dy * ratio];
  });
}

/**
 * 웨이브(wave) — 직교 사인 흔들림. srcX = x + sin(y/scale)·a·scale,
 * srcY = y + sin(x/scale)·a·scale. 가로/세로가 서로의 위상으로 출렁여 깃발처럼 흔들린다.
 */
function distortWave(
  src: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  d: Distort
): void {
  const a = d.amount / 100;
  const scale = d.scale;
  const span = a * scale; // 변위 진폭(px)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x + Math.sin(y / scale) * span;
      const sy = y + Math.sin(x / scale) * span;
      const di = (y * width + x) * 4;
      sampleBilinear(src, width, height, sx, sy, data, di);
    }
  }
}

// ---------------------------------------------------------------------------
// 웹툰 왜곡 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 왜곡 조합.
// 모든 value는 normalizeDistort를 통과(amount -100..100, scale 1..50, type 유효).
// ---------------------------------------------------------------------------

export type DistortPreset = { id: string; label: string; tip: string; value: Distort };

export const DISTORT_PRESETS: DistortPreset[] = [
  {
    id: "swirl",
    label: "소용돌이",
    tip: "중심을 축으로 시계 방향으로 비틀어 빨려드는 소용돌이를 만듭니다.",
    value: normalizeDistort({ type: "twirl", amount: 60, scale: 20 }),
  },
  {
    id: "swirl-reverse",
    label: "역소용돌이",
    tip: "반시계 방향으로 비틀어 반대로 풀리는 소용돌이를 만듭니다.",
    value: normalizeDistort({ type: "twirl", amount: -60, scale: 20 }),
  },
  {
    id: "ripple",
    label: "잔물결",
    tip: "중심에서 퍼지는 동심원 물결로 수면에 비친 듯한 일렁임을 더합니다.",
    value: normalizeDistort({ type: "ripple", amount: 35, scale: 14 }),
  },
  {
    id: "fisheye",
    label: "어안",
    tip: "중심을 볼록하게 부풀려 어안 렌즈로 본 듯한 구체 왜곡을 줍니다.",
    value: normalizeDistort({ type: "pinch", amount: -55, scale: 20 }),
  },
  {
    id: "shake",
    label: "흔들림",
    tip: "가로세로로 출렁이는 사인 파동으로 화면이 흔들리는 연출을 만듭니다.",
    value: normalizeDistort({ type: "wave", amount: 30, scale: 12 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeDistort로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 dsType(string)과
 * dsAmount·dsScale(각 number)를 읽어 normalizeDistort로 안전 변환 후 applyDistort.
 * 항등(amount 0)이거나 attrs가 비면 no-op.
 */
export function distortKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const d = normalizeDistort({
    type: typeof attrs.dsType === "string" ? (attrs.dsType as DistortType) : undefined,
    amount: attrNumber(attrs.dsAmount),
    scale: attrNumber(attrs.dsScale),
  });
  if (isIdentityDistort(d)) return;
  applyDistort(imageData, d);
}
