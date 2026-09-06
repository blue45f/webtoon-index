/**
 * Studio Extended Blend — 확장 블렌드(포토샵 전용 10모드) 순수 베이크 엔진.
 *
 * Konva/Canvas 의 globalCompositeOperation 16종에는 없는 포토샵·CSP 전용 블렌드 모드
 * (선형 닷지/선형 번/비비드·선형·핀 라이트/하드 믹스/어두운·밝은 색상/빼기/나누기)를
 * 라이브 합성 대신 "아래 레이어와 병합" 베이크로 제공한다 — Canvas 2D 는 backdrop 픽셀
 * 접근이 없어 이 모드들을 실시간으로 그릴 수 없기 때문(설계상 한계, 우회 불가).
 *
 * 수식 규약:
 *   - 채널 블렌드 B(Cb, Cs) 는 포토샵/PDF 사양의 단위(0..1) 도메인 공식 그대로.
 *   - 알파 합성은 CSS Compositing & Blending Level 1 의
 *     "separable blend mode + source-over" 표준:
 *       co = αs·(1−αb)·Cs + αs·αb·B(Cb,Cs) + (1−αs)·αb·Cb
 *       αo = αs + αb·(1−αs),  출력색 = co/αo (unpremultiply)
 *     opacity 인자는 αs 에 곱해지는 상수(포토샵 레이어 불투명도와 동일 의미).
 *   - 어두운/밝은 색상은 비분리(non-separable) — 픽셀 전체를 광도
 *     Lum(C)=0.3R+0.59G+0.11B 비교로 통째로 고른다(사양의 Lum 정의).
 *   - 반올림은 Math.round(사람이 계산한 기대값과 일치하도록 — Uint8ClampedArray 의
 *     round-half-to-even 대신 통상 반올림을 명시적으로 쓴다).
 *
 * 알파 경계:
 *   - top 픽셀이 (opacity 반영 후) 완전 투명 → base 픽셀 그대로.
 *   - base 픽셀이 완전 투명 → top 픽셀 그대로(알파에는 opacity 만 반영).
 *
 * 순수·결정적 — DOM/캔버스/난수/시간 의존 없음. 입력 버퍼는 절대 변형하지 않는다.
 * 래스터라이즈(요소 → 픽셀)와 커밋은 StudioPage 가 기존 레이어 병합 파이프라인
 * (studio-layer-merge-bake.ts)과 동일한 방식으로 담당한다.
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 카탈로그
// ---------------------------------------------------------------------------

export type StudioExtendedBlendModeId =
  | "linear-dodge"
  | "linear-burn"
  | "vivid-light"
  | "linear-light"
  | "pin-light"
  | "hard-mix"
  | "darker-color"
  | "lighter-color"
  | "subtract"
  | "divide";

/** 모드 선택 칩 목록 — 패널에서 id/라벨/설명으로 사용(HEAL_CLONE_MODES 와 동일 관례). */
export const EXTENDED_BLEND_MODES: {
  id: StudioExtendedBlendModeId;
  label: string;
  tip: string;
}[] = [
  {
    id: "linear-dodge",
    label: "선형 닷지(더하기)",
    tip: "두 색을 그대로 더해 밝힙니다(255 클램프). 빛·발광 이펙트 합성에 씁니다.",
  },
  {
    id: "linear-burn",
    label: "선형 번",
    tip: "두 색의 합에서 255를 빼 어둡게 만듭니다. 곱하기보다 대비가 강한 그림자용.",
  },
  {
    id: "vivid-light",
    label: "비비드 라이트",
    tip: "50% 기준으로 어두우면 색상 번, 밝으면 색상 닷지 — 대비를 강하게 태웁니다.",
  },
  {
    id: "linear-light",
    label: "선형 라이트",
    tip: "50% 기준으로 선형 번/선형 닷지를 합친 모드 — 밝기를 직선적으로 밀어냅니다.",
  },
  {
    id: "pin-light",
    label: "핀 라이트",
    tip: "위 레이어의 밝기에 따라 아래 색을 유지하거나 교체합니다(노이즈·질감 합성용).",
  },
  {
    id: "hard-mix",
    label: "하드 믹스",
    tip: "채널을 0 또는 255로 이진화해 포스터리제이션 느낌을 만듭니다.",
  },
  {
    id: "darker-color",
    label: "어두운 색상",
    tip: "픽셀 전체를 광도로 비교해 더 어두운 쪽 색을 통째로 남깁니다(채널 혼합 없음).",
  },
  {
    id: "lighter-color",
    label: "밝은 색상",
    tip: "픽셀 전체를 광도로 비교해 더 밝은 쪽 색을 통째로 남깁니다(채널 혼합 없음).",
  },
  {
    id: "subtract",
    label: "빼기",
    tip: "아래 색에서 위 색을 뺍니다(0 클램프). 조명 제거·차이 추출에 씁니다.",
  },
  {
    id: "divide",
    label: "나누기",
    tip: "아래 색을 위 색으로 나눕니다(0으로 나누면 흰색). 색 캐스트 제거에 씁니다.",
  },
];

export const EXTENDED_BLEND_MODE_DEFAULT: StudioExtendedBlendModeId = "linear-dodge";

/** 패널 불투명도 슬라이더 범위 — HEAL_CLONE_OPACITY_RANGE 와 동일 관례. */
export const EXTENDED_BLEND_OPACITY_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const EXTENDED_BLEND_OPACITY_DEFAULT = 1;

export function isStudioExtendedBlendModeId(
  value: string
): value is StudioExtendedBlendModeId {
  return EXTENDED_BLEND_MODES.some((mode) => mode.id === value);
}

/** 히스토리 라벨·상태 문구용 한글 라벨 조회(모르는 id 는 그대로 반환). */
export function extendedBlendModeLabel(id: string): string {
  return EXTENDED_BLEND_MODES.find((mode) => mode.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 분리(separable) 채널 블렌드 B(cb, cs) — 단위(0..1) 도메인, 포토샵 공식.
 * darker-color / lighter-color 는 비분리라 여기 없음(blendExtended 본문에서 픽셀 단위 처리).
 */
function blendChannelUnit(
  mode: Exclude<StudioExtendedBlendModeId, "darker-color" | "lighter-color">,
  cb: number,
  cs: number
): number {
  switch (mode) {
    case "linear-dodge":
      return Math.min(1, cb + cs);
    case "linear-burn":
      return Math.max(0, cb + cs - 1);
    case "vivid-light":
      // cs=0 → 0, cs=1 → 1 (번/닷지의 0-나눗셈 특이점을 포토샵 관례로 고정).
      if (cs <= 0) return 0;
      if (cs >= 1) return 1;
      return cs <= 0.5
        ? Math.max(0, 1 - (1 - cb) / (2 * cs))
        : Math.min(1, cb / (2 * (1 - cs)));
    case "linear-light":
      return clampUnit(cb + 2 * cs - 1);
    case "pin-light":
      return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case "hard-mix":
      return cb + cs >= 1 ? 1 : 0;
    case "subtract":
      return Math.max(0, cb - cs);
    case "divide":
      // 0으로 나누기 → 흰색(포토샵 관례; 같은 색끼리 나눠도 흰색).
      if (cs <= 0) return 1;
      return Math.min(1, cb / cs);
  }
}

/** 비분리 모드용 광도 — CSS Compositing Level 1 의 Lum(C) = 0.3R + 0.59G + 0.11B. */
function lumUnit(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function assertBufferShape(image: StudioImageDataLike, label: string): void {
  const expected = image.width * image.height * 4;
  if (
    !Number.isInteger(image.width)
    || !Number.isInteger(image.height)
    || image.width <= 0
    || image.height <= 0
    || image.data.length !== expected
  ) {
    throw new Error(`확장 블렌드: ${label} 픽셀 버퍼 크기가 올바르지 않습니다.`);
  }
}

// ---------------------------------------------------------------------------
// 엔진 본체
// ---------------------------------------------------------------------------

/**
 * base(아래 레이어) 위에 top(위 레이어)을 확장 블렌드 모드로 합성한 새 픽셀 버퍼를 만든다.
 *
 * - base/top 은 같은 크기여야 한다(공유 캔버스 공간으로 래스터라이즈는 호출자 몫).
 * - opacity 는 0..1 로 클램프(비유한은 1). 0이면 결과는 base 와 동일하다.
 * - 입력은 변형하지 않고 항상 새 Uint8ClampedArray 를 돌려준다(결정적).
 */
export function blendExtended(
  base: StudioImageDataLike,
  top: StudioImageDataLike,
  mode: StudioExtendedBlendModeId,
  opacity: number
): StudioImageDataLike {
  assertBufferShape(base, "base");
  assertBufferShape(top, "top");
  if (base.width !== top.width || base.height !== top.height) {
    throw new Error("확장 블렌드: base와 top의 크기가 같아야 합니다.");
  }

  const layerOpacity = Number.isFinite(opacity) ? clampUnit(opacity) : 1;
  const separableMode =
    mode === "darker-color" || mode === "lighter-color" ? null : mode;
  const out = new Uint8ClampedArray(base.data.length);
  const baseData = base.data;
  const topData = top.data;

  for (let i = 0; i < baseData.length; i += 4) {
    const alphaBase = baseData[i + 3]! / 255;
    const alphaTop = (topData[i + 3]! / 255) * layerOpacity;

    // top 완전 투명(또는 opacity 0) → base 그대로.
    if (alphaTop <= 0) {
      out[i] = baseData[i]!;
      out[i + 1] = baseData[i + 1]!;
      out[i + 2] = baseData[i + 2]!;
      out[i + 3] = baseData[i + 3]!;
      continue;
    }

    // base 완전 투명 → top 그대로(알파에만 opacity 반영).
    if (alphaBase <= 0) {
      out[i] = topData[i]!;
      out[i + 1] = topData[i + 1]!;
      out[i + 2] = topData[i + 2]!;
      out[i + 3] = Math.round(alphaTop * 255);
      continue;
    }

    const cbR = baseData[i]! / 255;
    const cbG = baseData[i + 1]! / 255;
    const cbB = baseData[i + 2]! / 255;
    const csR = topData[i]! / 255;
    const csG = topData[i + 1]! / 255;
    const csB = topData[i + 2]! / 255;

    let blendR: number;
    let blendG: number;
    let blendB: number;
    if (separableMode) {
      blendR = blendChannelUnit(separableMode, cbR, csR);
      blendG = blendChannelUnit(separableMode, cbG, csG);
      blendB = blendChannelUnit(separableMode, cbB, csB);
    } else {
      const lumTop = lumUnit(csR, csG, csB);
      const lumBase = lumUnit(cbR, cbG, cbB);
      const pickTop =
        mode === "darker-color" ? lumTop < lumBase : lumTop > lumBase;
      // 동률이면 base 유지(결정적 타이브레이크).
      blendR = pickTop ? csR : cbR;
      blendG = pickTop ? csG : cbG;
      blendB = pickTop ? csB : cbB;
    }

    const alphaOut = alphaTop + alphaBase * (1 - alphaTop);
    const weightTopOnly = alphaTop * (1 - alphaBase);
    const weightBlend = alphaTop * alphaBase;
    const weightBaseOnly = (1 - alphaTop) * alphaBase;
    const coR = weightTopOnly * csR + weightBlend * blendR + weightBaseOnly * cbR;
    const coG = weightTopOnly * csG + weightBlend * blendG + weightBaseOnly * cbG;
    const coB = weightTopOnly * csB + weightBlend * blendB + weightBaseOnly * cbB;

    out[i] = Math.round((coR / alphaOut) * 255);
    out[i + 1] = Math.round((coG / alphaOut) * 255);
    out[i + 2] = Math.round((coB / alphaOut) * 255);
    out[i + 3] = Math.round(alphaOut * 255);
  }

  return { data: out, width: base.width, height: base.height };
}
