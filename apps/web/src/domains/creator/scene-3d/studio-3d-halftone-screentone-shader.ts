/**
 * studio-3d-halftone-screentone-shader.ts
 *
 * Clip Studio Paint & Manga-style 3D Screentone, Halftone Shading & Color Temperature Engine.
 * Computes procedural 2D/3D screen space manga dots, crosshatching patterns,
 * and converts lighting color temperatures (Kelvin 1800K ~ 9500K) to chromaticity RGB.
 */

export type ScreentonePatternType =
  | "manga-dot-grid"
  | "diagonal-crosshatch"
  | "concentric-rings"
  | "stipple-sand"
  | "horizontal-lines";

export interface ScreentoneShaderConfig {
  readonly pattern: ScreentonePatternType;
  readonly frequencyLpi: number; // Lines/Dots per unit (e.g., 25 to 80)
  readonly angleDegrees: number; // Dot grid angle (standard: 45° for black, 15°/75° for color)
  readonly dotSizeMax: number; // 0.1 to 1.0
  readonly threshold: number; // Shadow threshold 0.0 to 1.0
  readonly sharpness: number; // Edge sharpness 0.0 to 1.0
  readonly colorTemperatureKelvin: number; // 1800K (candle) to 9500K (blue sky)
  readonly toneColor: string; // Shadow tone color (default: #111115)
  readonly paperColor: string; // Base paper color (default: #ffffff)
}

export interface ScreentonePreset {
  readonly id: string;
  readonly name: string;
  readonly pattern: ScreentonePatternType;
  readonly frequencyLpi: number;
  readonly angleDegrees: number;
  readonly dotSizeMax: number;
  readonly threshold: number;
  readonly kelvin: number;
  readonly description: string;
}

export const SCREENTONE_PRESETS: readonly ScreentonePreset[] = [
  {
    id: "shonen-manga-dots",
    name: "소년 만화 망점 (Shonen Manga Dot 60L)",
    pattern: "manga-dot-grid",
    frequencyLpi: 60,
    angleDegrees: 45,
    dotSizeMax: 0.85,
    threshold: 0.5,
    kelvin: 6500,
    description: "전형적인 소년 액션 만화의 60선 원형 망점 톤",
  },
  {
    id: "noir-crosshatch",
    name: "다크 누아르 빗금 (Noir Crosshatch)",
    pattern: "diagonal-crosshatch",
    frequencyLpi: 40,
    angleDegrees: 30,
    dotSizeMax: 0.9,
    threshold: 0.6,
    kelvin: 4500,
    description: "무겁고 긴장감 넘치는 스릴러·범죄 장르의 교차 빗금 명암",
  },
  {
    id: "fantasy-stipple-sand",
    name: "판타지 모래알 톤 (Stipple Sand)",
    pattern: "stipple-sand",
    frequencyLpi: 75,
    angleDegrees: 0,
    dotSizeMax: 0.6,
    threshold: 0.45,
    kelvin: 5500,
    description: "로맨스 판타지 및 마법 연출에 어울리는 미세 분말 그라데이션",
  },
  {
    id: "retro-comic-pop",
    name: "레트로 팝아트 망점 (Pop Art Halftone)",
    pattern: "manga-dot-grid",
    frequencyLpi: 24,
    angleDegrees: 15,
    dotSizeMax: 1.0,
    threshold: 0.4,
    kelvin: 6000,
    description: "굵직하고 선명한 아메리칸 코믹스 팝아트 스타일",
  },
  {
    id: "sunset-warm-manga",
    name: "골든아워 노을 톤 (Warm Sunset 3200K)",
    pattern: "manga-dot-grid",
    frequencyLpi: 50,
    angleDegrees: 45,
    dotSizeMax: 0.75,
    threshold: 0.55,
    kelvin: 3200,
    description: "따스한 석양 노을빛이 감도는 3200K 텅스텐 온도의 망점 셰이딩",
  },
  {
    id: "cyberpunk-cool-blue",
    name: "사이버펑크 블루 톤 (Cool Blue 8500K)",
    pattern: "horizontal-lines",
    frequencyLpi: 55,
    angleDegrees: 0,
    dotSizeMax: 0.8,
    threshold: 0.65,
    kelvin: 8500,
    description: "차가운 밤하늘과 네온 사인을 표현하는 수평 스캔라인 톤",
  },
];

/**
 * Converts a Color Temperature in Kelvin (1000K to 12000K) to linear RGB values
 * Uses Tanner Helland's algorithm for blackbody radiation chromaticity.
 */
export function calculateKelvinRgb(kelvin: number): readonly [number, number, number] {
  const temp = Math.max(1000, Math.min(12000, kelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  // Calculate Red
  if (temp <= 66) {
    r = 255;
  } else {
    r = temp - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }

  // Calculate Green
  if (temp <= 66) {
    g = temp;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  } else {
    g = temp - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }
  g = Math.max(0, Math.min(255, g));

  // Calculate Blue
  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = temp - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }

  return [r / 255, g / 255, b / 255];
}

/**
 * Evaluates the 2D procedural screentone value at normalized screen/surface coordinates (u, v)
 * given a lighting luminance value (0.0 = dark shadow, 1.0 = full highlight).
 * Returns 1.0 for ink/tone coverage and 0.0 for paper.
 */
export function sampleScreentone(
  u: number,
  v: number,
  luminance: number,
  config: ScreentoneShaderConfig,
): number {
  if (luminance >= config.threshold) {
    return 0.0; // Highlight area: pure paper
  }

  const rad = (config.angleDegrees * Math.PI) / 180;
  const rotU = u * Math.cos(rad) - v * Math.sin(rad);
  const rotV = u * Math.sin(rad) + v * Math.cos(rad);

  const freq = config.frequencyLpi;
  const cellU = ((rotU * freq) % 1.0 + 1.0) % 1.0;
  const cellV = ((rotV * freq) % 1.0 + 1.0) % 1.0;

  // Inverted shadow intensity: darker areas have larger dots
  const shadowWeight = 1.0 - (luminance / Math.max(0.001, config.threshold));
  const targetDotRadius = (shadowWeight * config.dotSizeMax) * 0.5;

  let patternDist: number;

  if (config.pattern === "manga-dot-grid") {
    // Distance from the center (0.5, 0.5) of the cell
    const distToCenter = Math.sqrt(Math.pow(cellU - 0.5, 2) + Math.pow(cellV - 0.5, 2));
    patternDist = distToCenter;
  } else if (config.pattern === "diagonal-crosshatch") {
    const lineDist1 = Math.abs(cellU - 0.5);
    const lineDist2 = Math.abs(cellV - 0.5);
    patternDist = Math.min(lineDist1, lineDist2);
  } else if (config.pattern === "horizontal-lines") {
    patternDist = Math.abs(cellV - 0.5);
  } else {
    // Stipple / concentric
    const dist = Math.sqrt(Math.pow(cellU - 0.5, 2) + Math.pow(cellV - 0.5, 2));
    patternDist = (dist * 3.0) % 0.5;
  }

  return patternDist <= targetDotRadius ? 1.0 : 0.0;
}
