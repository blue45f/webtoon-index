/**
 * studio-3d-postprocess-vfx-pipeline.ts
 *
 * Marmoset Toolbag & Unreal Engine-inspired Post-Processing Lens Effects & Bokeh DoF Engine.
 * Manages Depth of Field (DoF Bokeh), Bloom Glow, Chromatic Aberration,
 * Vignette, and Color Grading Look-Up presets for 3D webtoon rendering.
 */

export type BokehShapeType = "circular" | "hexagonal" | "anamorphic-streak";

export type ColorGradingPresetId =
  | "anime-vibrant"
  | "moody-cinematic-warm"
  | "cyberpunk-high-contrast"
  | "bleach-bypass-gritty"
  | "pastel-dreamy"
  | "clean-neutral";

export interface DepthOfFieldConfig {
  readonly enabled: boolean;
  readonly focusDistance: number; // in meters (0.5 to 50m)
  readonly focalLength: number; // in mm (e.g. 35mm, 50mm, 85mm portrait)
  readonly fStop: number; // Aperture (f/1.4 to f/16)
  readonly bokehShape: BokehShapeType;
  readonly maxBlurRadius: number; // 0.0 to 1.0
}

export interface BloomGlowConfig {
  readonly enabled: boolean;
  readonly threshold: number; // 0.6 to 1.0
  readonly intensity: number; // 0.0 to 3.0
  readonly radius: number; // 0.1 to 1.0
  readonly tintColor: string; // e.g. #ffffff or #ffd700
}

export interface ChromaticAberrationConfig {
  readonly enabled: boolean;
  readonly offsetPixels: number; // 0.0 to 10.0
  readonly radialFactor: number; // 0.0 (center) to 1.0 (screen edge)
}

export interface VignetteConfig {
  readonly enabled: boolean;
  readonly darkness: number; // 0.0 to 1.0
  readonly radius: number; // 0.2 to 1.2
  readonly softness: number; // 0.1 to 0.8
}

export interface PostProcessVfxPipelineConfig {
  readonly dof: DepthOfFieldConfig;
  readonly bloom: BloomGlowConfig;
  readonly chromaticAberration: ChromaticAberrationConfig;
  readonly vignette: VignetteConfig;
  readonly colorGrading: ColorGradingPresetId;
}

export interface ColorGradingPreset {
  readonly id: ColorGradingPresetId;
  readonly name: string;
  readonly saturation: number; // 0.5 to 1.5
  readonly contrast: number; // 0.7 to 1.4
  readonly exposure: number; // -1.0 to 1.0
  readonly temperatureOffset: number; // -0.3 (cool) to +0.3 (warm)
  readonly description: string;
}

export const COLOR_GRADING_PRESETS: readonly ColorGradingPreset[] = [
  {
    id: "anime-vibrant",
    name: "생생한 애니 색감 (Anime Vibrant)",
    saturation: 1.25,
    contrast: 1.15,
    exposure: 0.1,
    temperatureOffset: 0.05,
    description: "선명하고 화사한 K-웹툰 및 일본 극장판 애니메이션 스타일",
  },
  {
    id: "moody-cinematic-warm",
    name: "시네마틱 웜 무드 (Cinematic Warm)",
    saturation: 0.95,
    contrast: 1.2,
    exposure: -0.05,
    temperatureOffset: 0.18,
    description: "황금빛 조명과 깊은 암부의 감성적인 영화적 분위기",
  },
  {
    id: "cyberpunk-high-contrast",
    name: "사이버펑크 네온 (Cyberpunk Neon)",
    saturation: 1.35,
    contrast: 1.3,
    exposure: 0.0,
    temperatureOffset: -0.15,
    description: "네온 퍼플과 사이안 컬러가 돋보이는 고대비 SF 무드",
  },
  {
    id: "bleach-bypass-gritty",
    name: "블리치 바이패스 (Bleach Bypass)",
    saturation: 0.6,
    contrast: 1.35,
    exposure: 0.05,
    temperatureOffset: -0.05,
    description: "채도를 낮추고 극적인 명암비를 부여하는 액션/스릴러 톤",
  },
  {
    id: "pastel-dreamy",
    name: "파스텔 몽환 (Pastel Dreamy)",
    saturation: 0.9,
    contrast: 0.85,
    exposure: 0.2,
    temperatureOffset: 0.08,
    description: "부드럽고 몽환적인 순정만화 및 회상 장면 연출",
  },
  {
    id: "clean-neutral",
    name: "내추럴 스탠다드 (Clean Neutral)",
    saturation: 1.0,
    contrast: 1.0,
    exposure: 0.0,
    temperatureOffset: 0.0,
    description: "원작 텍스처 본연의 색감을 정직하게 유지하는 표준 렌더링",
  },
];

export const DEFAULT_POSTPROCESS_CONFIG: PostProcessVfxPipelineConfig = {
  dof: {
    enabled: false,
    focusDistance: 3.0,
    focalLength: 50,
    fStop: 2.8,
    bokehShape: "circular",
    maxBlurRadius: 0.6,
  },
  bloom: {
    enabled: true,
    threshold: 0.8,
    intensity: 1.2,
    radius: 0.5,
    tintColor: "#ffffff",
  },
  chromaticAberration: {
    enabled: false,
    offsetPixels: 2.5,
    radialFactor: 0.8,
  },
  vignette: {
    enabled: true,
    darkness: 0.45,
    radius: 0.75,
    softness: 0.4,
  },
  colorGrading: "anime-vibrant",
};

/**
 * Computes the circle of confusion (CoC) blur diameter in normalized screen units
 * given a distance from the camera.
 */
export function calculateCircleOfConfusion(
  subjectDistance: number,
  dofConfig: DepthOfFieldConfig,
): number {
  if (!dofConfig.enabled) return 0.0;

  const focusDist = dofConfig.focusDistance;
  const f = dofConfig.focalLength / 1000; // convert mm to m
  const n = dofConfig.fStop;

  // Standard lens CoC formula: CoC = |S - d| / d * (f^2 / (N * (S - f)))
  const numerator = Math.abs(focusDist - subjectDistance);
  const lensAperture = f / n;
  const cocMm = (numerator / Math.max(0.01, subjectDistance)) * (lensAperture * (f / Math.max(0.001, focusDist - f))) * 1000;

  const normalizedBlur = Math.min(dofConfig.maxBlurRadius, cocMm * 0.02);
  return normalizedBlur;
}
