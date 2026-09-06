/**
 * Studio 3D MatCap & Stylized Shader System (Spline / Womp / Clip Studio Benchmark).
 * Real-time MatCaps, Cel Step Shading, Glassmorphism Transmission, Iridescent Sheen,
 * and Emissive Pulsing Neon for 3D meshes.
 */

export type StylizedShaderKind =
  | "anime-cel-toon"
  | "soft-pearl-clay"
  | "metallic-chrome"
  | "manga-sketch-hatch"
  | "gold-rim-light"
  | "neon-cyberpunk-pulse"
  | "frosted-glassmorphism"
  | "iridescent-rainbow"
  | "retro-pixel-dither";

export interface StylizedShaderPreset {
  readonly id: StylizedShaderKind;
  readonly name: string;
  readonly category: "toon" | "clay" | "material" | "special";
  readonly description: string;
  readonly baseColor: string;
  readonly shadowColor: string;
  readonly shadowSteps: 1 | 2 | 3 | 4;
  readonly rimLightIntensity: number;
  readonly rimLightColor: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly transmission: number; // glass transparency
  readonly ior: number; // index of refraction
  readonly emissive: string;
  readonly emissiveIntensity: number;
  readonly pulseFrequencyHz: number; // for pulsating neon
  readonly matcapTextureHint: string;
}

export const STYLIZED_SHADER_PRESETS: Record<StylizedShaderKind, StylizedShaderPreset> = {
  "anime-cel-toon": {
    id: "anime-cel-toon",
    name: "애니메이션 3단 셀 셰이딩 (Anime Cel)",
    category: "toon",
    description: "일본/한국 애니메이션 풍의 또렷한 3단계 명암과 림라이트",
    baseColor: "#fde047",
    shadowColor: "#ca8a04",
    shadowSteps: 3,
    rimLightIntensity: 0.8,
    rimLightColor: "#ffffff",
    metalness: 0.0,
    roughness: 0.5,
    transmission: 0.0,
    ior: 1.5,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-anime-cel.png",
  },
  "soft-pearl-clay": {
    id: "soft-pearl-clay",
    name: "소프트 펄 클레이 (Womp Clay)",
    category: "clay",
    description: "Womp/Spline 스타일의 부드럽고 말랑말랑한 클레이 질감",
    baseColor: "#f472b6",
    shadowColor: "#db2777",
    shadowSteps: 2,
    rimLightIntensity: 0.4,
    rimLightColor: "#fce7f3",
    metalness: 0.05,
    roughness: 0.2,
    transmission: 0.0,
    ior: 1.45,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-pearl-clay.png",
  },
  "metallic-chrome": {
    id: "metallic-chrome",
    name: "미러 크롬 메탈릭 (Liquid Chrome)",
    category: "material",
    description: "주변 환경을 반사하는 초고광택 액체 금속/크롬 재질",
    baseColor: "#e2e8f0",
    shadowColor: "#475569",
    shadowSteps: 1,
    rimLightIntensity: 1.0,
    rimLightColor: "#38bdf8",
    metalness: 0.98,
    roughness: 0.05,
    transmission: 0.0,
    ior: 2.4,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-chrome.png",
  },
  "manga-sketch-hatch": {
    id: "manga-sketch-hatch",
    name: "만화 잉크 스케치 해칭 (Manga Ink)",
    category: "toon",
    description: "펜 터치 느낌의 사선 해칭이 그림자에 맺히는 전통 흑백 만화 재질",
    baseColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowSteps: 2,
    rimLightIntensity: 0.2,
    rimLightColor: "#ffffff",
    metalness: 0.0,
    roughness: 0.9,
    transmission: 0.0,
    ior: 1.0,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-manga-hatch.png",
  },
  "gold-rim-light": {
    id: "gold-rim-light",
    name: "골드 림라이트 로열 (Imperial Gold)",
    category: "special",
    description: "피사체 외곽을 황금빛 역광으로 물들이는 고급스러운 연출",
    baseColor: "#1e293b",
    shadowColor: "#020617",
    shadowSteps: 2,
    rimLightIntensity: 1.5,
    rimLightColor: "#facc15",
    metalness: 0.4,
    roughness: 0.3,
    transmission: 0.0,
    ior: 1.6,
    emissive: "#713f12",
    emissiveIntensity: 0.3,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-gold-rim.png",
  },
  "neon-cyberpunk-pulse": {
    id: "neon-cyberpunk-pulse",
    name: "사이버펑크 네온 펄스 (Neon Pulse)",
    category: "special",
    description: "SF/사이버펑크 무드의 주기적으로 숨쉬듯 깜빡이는 발광 네온",
    baseColor: "#0f172a",
    shadowColor: "#020617",
    shadowSteps: 1,
    rimLightIntensity: 1.2,
    rimLightColor: "#22d3ee",
    metalness: 0.1,
    roughness: 0.2,
    transmission: 0.0,
    ior: 1.5,
    emissive: "#06b6d4",
    emissiveIntensity: 2.0,
    pulseFrequencyHz: 1.5,
    matcapTextureHint: "matcap-neon-pulse.png",
  },
  "frosted-glassmorphism": {
    id: "frosted-glassmorphism",
    name: "반투명 글래스모피즘 (Frosted Glass)",
    category: "material",
    description: "빛 굴절과 블러 투과율을 갖는 애플/스플라인 스타일 반투명 유리",
    baseColor: "#ffffff",
    shadowColor: "#94a3b8",
    shadowSteps: 1,
    rimLightIntensity: 0.7,
    rimLightColor: "#ffffff",
    metalness: 0.0,
    roughness: 0.15,
    transmission: 0.85,
    ior: 1.52,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-glass.png",
  },
  "iridescent-rainbow": {
    id: "iridescent-rainbow",
    name: "무지개빛 오팔 펄 (Iridescent Opal)",
    category: "special",
    description: "보는 각도(프레넬)에 따라 다채로운 무지개 빛깔로 변하는 박막 간섭 재질",
    baseColor: "#f8fafc",
    shadowColor: "#c084fc",
    shadowSteps: 2,
    rimLightIntensity: 1.1,
    rimLightColor: "#a855f7",
    metalness: 0.2,
    roughness: 0.1,
    transmission: 0.2,
    ior: 1.65,
    emissive: "#4c1d95",
    emissiveIntensity: 0.2,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-iridescent.png",
  },
  "retro-pixel-dither": {
    id: "retro-pixel-dither",
    name: "레트로 픽셀 디더링 (Retro Dither)",
    category: "toon",
    description: "90년대 레트로 도트 그래픽 및 4x4 베이어 디더 패턴 셰이더",
    baseColor: "#a3e635",
    shadowColor: "#3f6212",
    shadowSteps: 2,
    rimLightIntensity: 0.0,
    rimLightColor: "#000000",
    metalness: 0.0,
    roughness: 1.0,
    transmission: 0.0,
    ior: 1.0,
    emissive: "#000000",
    emissiveIntensity: 0.0,
    pulseFrequencyHz: 0.0,
    matcapTextureHint: "matcap-pixel-dither.png",
  },
};

/**
 * Calculates time-varying uniforms for stylized shaders (e.g. pulse brightness).
 */
export function evaluateShaderUniforms(preset: StylizedShaderPreset, timeSeconds: number) {
  let effectiveEmissiveIntensity = preset.emissiveIntensity;
  if (preset.pulseFrequencyHz > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * preset.pulseFrequencyHz * Math.PI * 2);
    effectiveEmissiveIntensity = preset.emissiveIntensity * (0.4 + 0.6 * pulse);
  }

  return {
    uBaseColor: preset.baseColor,
    uShadowColor: preset.shadowColor,
    uShadowSteps: preset.shadowSteps,
    uRimIntensity: preset.rimLightIntensity,
    uRimColor: preset.rimLightColor,
    uRoughness: preset.roughness,
    uMetalness: preset.metalness,
    uTransmission: preset.transmission,
    uIor: preset.ior,
    uEmissive: preset.emissive,
    uEmissiveIntensity: effectiveEmissiveIntensity,
  };
}
