/**
 * Studio Color Halftone Engine
 * 코믹 CMYK 인쇄 룩 — 픽셀을 C/M/Y/K로 분해해 채널마다 다른 각도로 회전한
 *   "망점 스크린"(dot screen)으로 재구성한다. 흰 바탕 위에 CMY 잉크 점이 겹쳐 찍히고,
 *   strength로 원본과 블렌드한다. mono는 휘도를 단일 흑색 망점으로.
 * 핵심은 결정적 셀 평균 — 각 dotSize 셀의 평균 채널값에 비례한 반지름의 점을
 *   셀 중심에 찍는다(랜덤 없음). 같은 입력은 항상 같은 출력 → 단위 테스트 가능.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type HalftonePattern = "circle" | "line" | "diamond" | "cross";

/**
 * 컬러 하프톤 설정.
 *   dotSize  2..16  px 셀(망점 격자) 크기 — 클수록 굵은 점.
 *   angle    0..90  기준 회전각(도) — 채널별 기본각에 더해지는 오프셋.
 *   mode     cmyk(컬러 4채널 망점)·mono(휘도 단일 흑색 망점).
 *   strength 0..100 원본과의 블렌드 비율(0=항등, 100=완전 망점화).
 *   pattern  망점 형태 — circle(원형)·line(선형)·diamond(마름모)·cross(십자격자).
 */
export type Halftone = {
  dotSize: number;
  angle: number;
  mode: "cmyk" | "mono";
  strength: number;
  pattern?: HalftonePattern;
};

/** 항등(망점화 없음) — strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_HALFTONE: Halftone = {
  dotSize: 4,
  angle: 15,
  mode: "cmyk",
  strength: 0,
};

export const HALFTONE_DOT_RANGE = { min: 2, max: 16, step: 1 } as const;
export const HALFTONE_ANGLE_RANGE = { min: 0, max: 90, step: 1 } as const;
export const HALFTONE_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;

// 유효 모드 및 패턴 집합(외부 입력 검증용).
const HALFTONE_MODES: readonly Halftone["mode"][] = ["cmyk", "mono"];
const HALFTONE_PATTERNS: readonly HalftonePattern[] = ["circle", "line", "diamond", "cross"];

// CMYK 채널별 스크린 기본 회전각(도). 전통 인쇄 각도(C15 M75 Y0 K45)에 angle 오프셋을 더한다.
const CHANNEL_BASE_ANGLES = { c: 15, m: 75, y: 0, k: 45 } as const;
// mono 흑색 스크린은 K와 같은 기본각(45)에서 출발 — angle 오프셋이 더해진다.
const MONO_BASE_ANGLE = CHANNEL_BASE_ANGLES.k;

// 휘도(luma) 가중치 — mono 망점·CMY 점 합성 휘도 계산에 공유.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖 숫자는 각 범위로 클램프, mode는 cmyk·mono만 허용(그 외는 기본 cmyk).
 */
export function normalizeHalftone(h?: Partial<Halftone> | null): Halftone {
  const src = h && typeof h === "object" ? h : {};
  const mode = HALFTONE_MODES.includes(src.mode as Halftone["mode"])
    ? (src.mode as Halftone["mode"])
    : DEFAULT_HALFTONE.mode;
  const pattern =
    src.pattern && HALFTONE_PATTERNS.includes(src.pattern as HalftonePattern)
      ? (src.pattern as HalftonePattern)
      : undefined;
  return {
    dotSize: clampTo(src.dotSize, HALFTONE_DOT_RANGE.min, HALFTONE_DOT_RANGE.max, DEFAULT_HALFTONE.dotSize),
    angle: clampTo(src.angle, HALFTONE_ANGLE_RANGE.min, HALFTONE_ANGLE_RANGE.max, DEFAULT_HALFTONE.angle),
    mode,
    strength: clampTo(
      src.strength,
      HALFTONE_STRENGTH_RANGE.min,
      HALFTONE_STRENGTH_RANGE.max,
      DEFAULT_HALFTONE.strength
    ),
    ...(pattern !== undefined ? { pattern } : {}),
  };
}

/** strength<=0 — 즉 원본과 0% 블렌드라 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityHalftone(h: Halftone): boolean {
  return h.strength <= 0;
}

// ---------------------------------------------------------------------------
// 망점 스크린 — 회전 격자 셀 평균 → 셀 중심 점
// ---------------------------------------------------------------------------

/**
 * 단일 채널(0..1 커버리지) 망점 스크린의 "잉크 커버리지" 버퍼를 만든다.
 *
 *  - 화면을 angle만큼 회전한 좌표계에서 dotSize 정사각 셀 격자를 깐다.
 *  - 각 셀의 평균 커버리지 c(0..1)를 구하고, 셀 중심에 반지름 r=sqrt(c)*rMax 점을 찍는다.
 *    (점 면적 ∝ c → 톤 보존. 셀 대각선 절반까지 커지므로 진한 톤은 점이 맞붙어 메워진다.)
 *  - 점 가장자리는 1px 선형 램프로 안티에일리어싱 — ink = clamp(r - dist + 0.5, 0, 1).
 *    램프가 실제 원 경계(dist=r)를 중심으로 대칭이라 점 면적(톤)은 1차 근사로 보존되고,
 *    계단(에일리어싱)과 각도 회전 시 모아레가 크게 줄어든다. 이웃 점이 겹치면 max 커버리지.
 *  - 결과 ink[px]는 연속 커버리지 0..1(경계는 중간값). 결정적.
 *
 * cov: 길이 width*height의 채널 커버리지(0..1). 반환: 같은 길이의 ink 마스크(0..1).
 */
function screenChannel(
  cov: Float32Array,
  width: number,
  height: number,
  dotSize: number,
  angleDeg: number,
  pattern: HalftonePattern = "circle"
): Float32Array {
  const ink = new Float32Array(width * height);
  const cell = Math.max(2, Math.round(dotSize));
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 점 면적 = c * cell² 이 되도록 r = sqrt(c/π) * cell → 톤(평균 밝기) 보존.
  // c=1이면 r = cell/√π ≈ 0.564*cell(점 면적 = 셀 면적, 점이 셀 변 중점에 닿음).
  const rMax = cell / Math.sqrt(Math.PI);

  // 회전 좌표(u,v) → 셀 인덱스. 셀 단위 누적 평균을 위해 합/카운트 맵을 미리 채운다.
  // (큰 이미지 대비: Map 대신 셀 인덱스 → 평탄 배열. 셀 격자 크기는 충분히 작다.)
  // 회전계의 u,v 범위를 먼저 구해 격자 오프셋을 잡는다.
  let minIu = Infinity;
  let minIv = Infinity;
  let maxIu = -Infinity;
  let maxIv = -Infinity;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  for (const [x, y] of corners) {
    const u = x! * cos + y! * sin;
    const v = -x! * sin + y! * cos;
    const iu = Math.floor(u / cell);
    const iv = Math.floor(v / cell);
    if (iu < minIu) minIu = iu;
    if (iv < minIv) minIv = iv;
    if (iu > maxIu) maxIu = iu;
    if (iv > maxIv) maxIv = iv;
  }
  const cols = maxIu - minIu + 1;
  const rows = maxIv - minIv + 1;
  const sum = new Float32Array(cols * rows);
  const cnt = new Float32Array(cols * rows);

  // 1패스: 각 픽셀을 회전계 셀에 누적.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const iu = Math.floor(u / cell) - minIu;
      const iv = Math.floor(v / cell) - minIv;
      const ci = iv * cols + iu;
      sum[ci]! += cov[y * width + x]!;
      cnt[ci]! += 1;
    }
  }

  // 2패스: 각 픽셀이 자기 셀(및 이웃 셀) 중심 점에서 받는 AA 커버리지의 최댓값을 구한다.
  // 점은 셀 중심(회전계 격자 중심)에 있고, 이웃 1칸까지 닿을 수 있어 3x3 셀을 본다.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const baseIu = Math.floor(u / cell);
      const baseIv = Math.floor(v / cell);
      let coverage = 0;
      for (let dv = -1; dv <= 1 && coverage < 1; dv++) {
        for (let du = -1; du <= 1; du++) {
          const iu = baseIu + du - minIu;
          const iv = baseIv + dv - minIv;
          if (iu < 0 || iv < 0 || iu >= cols || iv >= rows) continue;
          const ci = iv * cols + iu;
          const n = cnt[ci]!;
          if (n <= 0) continue;
          const c = sum[ci]! / n; // 셀 평균 커버리지 0..1
          if (c <= 0) continue;

          // 셀 중심 회전계 좌표.
          const cu = (baseIu + du + 0.5) * cell;
          const cv = (baseIv + dv + 0.5) * cell;
          const ddu = u - cu;
          const ddv = v - cv;

          let covVal: number;
          if (pattern === "line") {
            const halfThick = (c * cell) * 0.5;
            const dist = Math.abs(ddv);
            covVal = halfThick - dist + 0.5;
          } else if (pattern === "diamond") {
            const rDia = Math.sqrt(c) * cell * 0.7071;
            const dist = (Math.abs(ddu) + Math.abs(ddv)) * 0.7071;
            covVal = rDia - dist + 0.5;
          } else if (pattern === "cross") {
            const halfArm = (c * cell) * 0.35;
            const distU = Math.abs(ddu);
            const distV = Math.abs(ddv);
            covVal = Math.max(halfArm - distU + 0.5, halfArm - distV + 0.5);
          } else {
            // "circle" (기본)
            const r = Math.sqrt(c) * rMax; // 면적 비례 반지름
            const dist = Math.sqrt(ddu * ddu + ddv * ddv);
            covVal = r - dist + 0.5;
          }

          if (covVal >= 1) {
            coverage = 1;
            break;
          }
          if (covVal > coverage) coverage = covVal;
        }
      }
      ink[y * width + x] = Math.max(0, Math.min(1, coverage));
    }
  }

  return ink;
}

// ---------------------------------------------------------------------------
// 적용 — cmyk(4채널 망점) / mono(흑색 망점), strength 블렌드
// ---------------------------------------------------------------------------

/**
 * 컬러 하프톤 제자리 적용 — 항등(strength<=0)이면 no-op.
 *
 *  cmyk: 각 픽셀을 C M Y K로 분해(K=1-max(r,g,b), C/M/Y는 K 제거 후 잔여)하고,
 *    네 채널을 각각 회전 망점 스크린(C/M/Y/K 기본각 + angle 오프셋)으로 만든다.
 *    흰 바탕(1,1,1)에서 점이 찍힌 곳마다 해당 잉크를 빼서(승법) 재구성한다.
 *  mono: 휘도(잉크 커버리지=1-luma/255)를 단일 흑색 스크린으로. 점=검정, 바탕=흰색.
 *
 *  최종 결과를 strength(0..1)로 원본과 선형 블렌드. 알파(+3) 보존. 결정적(랜덤 없음).
 */
export function applyHalftone(img: StudioImageDataLike, h: Halftone): void {
  if (isIdentityHalftone(h)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const blend = Math.min(1, Math.max(0, h.strength / 100));
  const n = width * height;
  const pattern = h.pattern ?? "circle";

  if (h.mode === "mono") {
    // 잉크 커버리지 = 어두울수록 1(검정), 밝을수록 0(흰).
    const cov = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const luma = LUMA_R * data[j]! + LUMA_G * data[j + 1]! + LUMA_B * data[j + 2]!;
      cov[i] = 1 - luma / 255;
    }
    const ink = screenChannel(cov, width, height, h.dotSize, MONO_BASE_ANGLE + h.angle, pattern);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const v = 255 * (1 - ink[i]!); // 점=검정, 바탕=흰, 가장자리는 AA 중간톤
      data[j] = data[j]! + (v - data[j]!) * blend;
      data[j + 1] = data[j + 1]! + (v - data[j + 1]!) * blend;
      data[j + 2] = data[j + 2]! + (v - data[j + 2]!) * blend;
    }
    return;
  }

  // --- cmyk: 채널별 커버리지 분해 ---
  const cC = new Float32Array(n);
  const cM = new Float32Array(n);
  const cY = new Float32Array(n);
  const cK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const r = data[j]! / 255;
    const g = data[j + 1]! / 255;
    const b = data[j + 2]! / 255;
    const k = 1 - Math.max(r, g, b);
    const inv = 1 - k;
    if (inv <= 1e-6) {
      // 순흑 픽셀 — K만 가득, CMY는 0.
      cC[i] = 0;
      cM[i] = 0;
      cY[i] = 0;
      cK[i] = 1;
    } else {
      cC[i] = (1 - r - k) / inv;
      cM[i] = (1 - g - k) / inv;
      cY[i] = (1 - b - k) / inv;
      cK[i] = k;
    }
  }

  const inkC = screenChannel(cC, width, height, h.dotSize, CHANNEL_BASE_ANGLES.c + h.angle, pattern);
  const inkM = screenChannel(cM, width, height, h.dotSize, CHANNEL_BASE_ANGLES.m + h.angle, pattern);
  const inkY = screenChannel(cY, width, height, h.dotSize, CHANNEL_BASE_ANGLES.y + h.angle, pattern);
  const inkK = screenChannel(cK, width, height, h.dotSize, CHANNEL_BASE_ANGLES.k + h.angle, pattern);

  // 흰 바탕에서 점이 찍힌 잉크를 승법으로 빼서 재구성(AA 커버리지 그대로 승법 — 부드러운 점 경계).
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const kk = 1 - inkK[i]!; // K 잉크 커버리지만큼 어둡게(경계는 부분 잉크)
    let rr = (1 - inkC[i]!) * kk;
    let gg = (1 - inkM[i]!) * kk;
    let bb = (1 - inkY[i]!) * kk;
    rr *= 255;
    gg *= 255;
    bb *= 255;
    data[j] = data[j]! + (rr - data[j]!) * blend;
    data[j + 1] = data[j + 1]! + (gg - data[j + 1]!) * blend;
    data[j + 2] = data[j + 2]! + (bb - data[j + 2]!) * blend;
  }
}

// ---------------------------------------------------------------------------
// 코믹 하프톤 프리셋 — 첫 항목 없음(전부 strength>0의 실효 프리셋).
// 모든 value는 normalizeHalftone을 통과(범위 안, mode 유효).
// ---------------------------------------------------------------------------

export type HalftonePreset = { id: string; label: string; tip: string; value: Halftone };

export const HALFTONE_PRESETS: HalftonePreset[] = [
  {
    id: "comic-color",
    label: "코믹 컬러",
    tip: "고운 CMYK 망점으로 미국 코믹스풍 컬러 인쇄 질감을 냅니다.",
    value: normalizeHalftone({ dotSize: 4, angle: 15, mode: "cmyk", strength: 100 }),
  },
  {
    id: "coarse-print",
    label: "거친 인쇄",
    tip: "굵은 CMYK 망점으로 저해상도 인쇄물 같은 거친 도트를 만듭니다.",
    value: normalizeHalftone({ dotSize: 8, angle: 15, mode: "cmyk", strength: 100 }),
  },
  {
    id: "mono-dots",
    label: "흑백 망점",
    tip: "휘도를 단일 흑색 망점으로 바꿔 흑백 만화 스크린톤 느낌을 냅니다.",
    value: normalizeHalftone({ dotSize: 4, angle: 45, mode: "mono", strength: 100 }),
  },
  {
    id: "newsprint",
    label: "신문",
    tip: "촘촘한 흑색 망점과 약한 블렌드로 신문 인쇄 같은 거친 흑백 톤을 냅니다.",
    value: normalizeHalftone({ dotSize: 3, angle: 45, mode: "mono", strength: 90 }),
  },
  {
    id: "pop-art",
    label: "팝아트",
    tip: "큼직한 CMYK 망점으로 리히텐슈타인풍 팝아트 도트를 강하게 입힙니다.",
    value: normalizeHalftone({ dotSize: 10, angle: 15, mode: "cmyk", strength: 100 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeHalftone으로 안전 변환, 항등/무효/strength0이면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 htDot·htAngle·htMode·htStrength을 읽어
 * normalizeHalftone으로 안전 변환 후 applyHalftone. 항등(strength0)이거나 attrs가 비면 no-op.
 */
export function halftoneKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const mode = attrs.htMode === "cmyk" || attrs.htMode === "mono" ? attrs.htMode : undefined;
  const h = normalizeHalftone({
    dotSize: attrNumber(attrs.htDot),
    angle: attrNumber(attrs.htAngle),
    mode,
    strength: attrNumber(attrs.htStrength),
  });
  if (isIdentityHalftone(h)) return;
  applyHalftone(imageData, h);
}
