/**
 * Studio Watermark — 내보내기 시 작가 서명/워터마크를 출력 픽셀에 합성한다(코미포 및
 * CLIP STUDIO PAINT Ver.3.0/3.1/4.0 벤치마크).
 *
 * CLIP STUDIO PAINT Ver.3.0 ~ 4.0 기능 확장:
 * 1. 단일 위치 워터마크 (Single Position) vs 전면 반복 타일 워터마크 (Repeat Tiling)
 * 2. AI 무단 스크래핑/학습 방지 노이즈 패턴 보호 (Anti-AI Poisoning/Protection Noise Pattern)
 * 3. 블렌드 모드 (Normal, Overlay, Soft-Light, Multiply) 지원
 *
 * 배치 계산 및 노이즈 생성은 순수 함수로 두어 단위 테스트가 가능하고, 실제 캔버스
 * 그리기는 StudioPage 및 내보내기 파이프라인(drawWatermarkOnSlice)이 담당한다.
 */

export type WatermarkPosition = "br" | "bl" | "tr" | "tl" | "center";

export type WatermarkBlendMode = "normal" | "overlay" | "soft-light" | "multiply";

export const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "br", label: "오른쪽 아래" },
  { id: "bl", label: "왼쪽 아래" },
  { id: "tr", label: "오른쪽 위" },
  { id: "tl", label: "왼쪽 위" },
  { id: "center", label: "가운데" },
];

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  position: WatermarkPosition;
  opacity: number; // 0..1
  size: number; // 캔버스 폭 대비 글자 크기 비율(예: 0.028 = 폭의 2.8%)
  repeatTile?: boolean; // 전면 대각 반복 타일링 (CSP 3.0)
  tileSpacing?: number; // 타일 간격 (px)
  blendMode?: WatermarkBlendMode; // 합성 블렌드 모드
  antiAiNoiseEnabled?: boolean; // AI 무단 학습 방지 고주파 노이즈 패턴 보호 (CSP 3.1/4.0)
  antiAiNoiseIntensity?: number; // 노이즈 세기 (1..100)
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: "",
  position: "br",
  opacity: 0.55,
  size: 0.028,
  repeatTile: false,
  tileSpacing: 180,
  blendMode: "normal",
  antiAiNoiseEnabled: false,
  antiAiNoiseIntensity: 35,
};

const POSITION_IDS = new Set(WATERMARK_POSITIONS.map((p) => p.id));
const BLEND_MODES = new Set<WatermarkBlendMode>([
  "normal",
  "overlay",
  "soft-light",
  "multiply",
]);

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** 자유 객체에서 워터마크 설정을 안전하게 읽어 정규화한다(localStorage·doc 호환). */
export function normalizeWatermark(raw: unknown): WatermarkSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WATERMARK };
  const o = raw as Record<string, unknown>;
  const blendModeCandidate = o.blendMode as WatermarkBlendMode;
  return {
    enabled: o.enabled === true,
    text: typeof o.text === "string" ? o.text.slice(0, 60) : "",
    position:
      typeof o.position === "string" && POSITION_IDS.has(o.position as WatermarkPosition)
        ? (o.position as WatermarkPosition)
        : "br",
    opacity:
      typeof o.opacity === "number" ? clamp(o.opacity, 0, 1) : DEFAULT_WATERMARK.opacity,
    size:
      typeof o.size === "number" ? clamp(o.size, 0.012, 0.08) : DEFAULT_WATERMARK.size,
    repeatTile: o.repeatTile === true,
    tileSpacing:
      typeof o.tileSpacing === "number"
        ? clamp(o.tileSpacing, 60, 600)
        : DEFAULT_WATERMARK.tileSpacing,
    blendMode: BLEND_MODES.has(blendModeCandidate) ? blendModeCandidate : "normal",
    antiAiNoiseEnabled: o.antiAiNoiseEnabled === true,
    antiAiNoiseIntensity:
      typeof o.antiAiNoiseIntensity === "number"
        ? clamp(o.antiAiNoiseIntensity, 1, 100)
        : DEFAULT_WATERMARK.antiAiNoiseIntensity,
  };
}

export interface WatermarkPlacement {
  x: number;
  y: number;
  textAlign: "left" | "right" | "center";
  textBaseline: "top" | "bottom" | "middle";
  fontPx: number;
  margin: number;
}

/**
 * 워터마크를 그릴 위치·정렬·글자 크기를 계산한다(순수). 그리기는 호출부가 담당한다.
 * margin은 캔버스 폭의 약 2.5%(최소 12px), fontPx는 폭×size(최소 11px).
 */
export function watermarkPlacement(
  canvasW: number,
  canvasH: number,
  s: WatermarkSettings,
): WatermarkPlacement {
  const margin = Math.max(12, Math.round(canvasW * 0.025));
  const fontPx = Math.max(11, Math.round(canvasW * s.size));
  switch (s.position) {
    case "bl":
      return { x: margin, y: canvasH - margin, textAlign: "left", textBaseline: "bottom", fontPx, margin };
    case "tr":
      return { x: canvasW - margin, y: margin, textAlign: "right", textBaseline: "top", fontPx, margin };
    case "tl":
      return { x: margin, y: margin, textAlign: "left", textBaseline: "top", fontPx, margin };
    case "center":
      return {
        x: Math.round(canvasW / 2),
        y: Math.round(canvasH / 2),
        textAlign: "center",
        textBaseline: "middle",
        fontPx,
        margin,
      };
    default: // "br"
      return { x: canvasW - margin, y: canvasH - margin, textAlign: "right", textBaseline: "bottom", fontPx, margin };
  }
}

/**
 * 반복 타일 모드(repeatTile)를 위한 격자 위치 배열을 계산한다 (순수).
 */
export function generateWatermarkTilePositions(
  canvasW: number,
  canvasH: number,
  spacingPx = 180,
): readonly { readonly x: number; readonly y: number }[] {
  const spacing = Math.max(80, spacingPx);
  const positions: { x: number; y: number }[] = [];

  const startX = -spacing / 2;
  const startY = -spacing / 2;
  const endX = canvasW + spacing;
  const endY = canvasH + spacing;

  let row = 0;
  for (let y = startY; y < endY; y += spacing) {
    const offsetX = (row % 2) * (spacing / 2);
    for (let x = startX + offsetX; x < endX; x += spacing) {
      positions.push({ x: Math.round(x), y: Math.round(y) });
    }
    row++;
  }

  return Object.freeze(positions);
}

/**
 * AI 무단 스크래핑/학습 방지 고주파 미세 노이즈 패턴을 픽셀 데이터에 주입한다 (순수 알고리즘).
 * CLIP STUDIO PAINT Ver.3.1/4.0 파리티:
 * - 인간 시각에는 거의 인지되지 않는 미세 고주파 섭동 패턴을 합성하여
 *   비인가 AI 모델의 특징 맵(Feature map) 추출 및 복제를 방해함.
 */
export function applyAntiAiNoisePattern(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  intensity = 35,
): void {
  const delta = (intensity / 100) * 12; // max +-12 brightness perturbation
  const len = Math.min(pixels.length, width * height * 4);

  for (let i = 0; i < len; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    // High frequency 2D hash
    const pseudo = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const perturb = (pseudo - 0.5) * 2 * delta;

    pixels[i] = Math.min(255, Math.max(0, pixels[i]! + perturb));
    pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1]! + perturb));
    pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2]! + perturb));
    // Alpha channel (i + 3) is untouched
  }
}

/** 내보내기 시 실제로 워터마크나 보호 패턴을 그릴지 — 켜져 있고 (텍스트 또는 노이즈보호) */
export function shouldDrawWatermark(s: WatermarkSettings): boolean {
  if (!s.enabled) return false;
  return s.text.trim().length > 0 || s.antiAiNoiseEnabled === true;
}
