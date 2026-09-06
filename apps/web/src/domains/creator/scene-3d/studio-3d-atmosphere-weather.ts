/**
 * Studio 3D Atmosphere, Sky & Weather Synthesizer
 *
 * Provides physically-inspired Rayleigh/Mie atmospheric scattering, volumetric skybox
 * parameters, 12 cinematic webtoon weather presets, cloud layer drift calculations,
 * dynamic precipitation particle streams (rain, snow, cherry blossoms, embers),
 * and exponential height fog configurations.
 */

export type WeatherPresetId =
  | "clear-noon"
  | "golden-hour"
  | "dramatic-sunset"
  | "cyberpunk-neon-night"
  | "eerie-fog"
  | "rainy-drizzle"
  | "heavy-thunderstorm"
  | "gentle-snowfall"
  | "blizzard"
  | "cherry-blossom-spring"
  | "autumn-leaves"
  | "fantasy-celestial-aurora";

export type PrecipitationKind = "none" | "rain" | "snow" | "sakura" | "leaves" | "embers";

export interface AtmosphereLightingConfig {
  readonly sunDirection: readonly [number, number, number];
  readonly sunColorHex: string;
  readonly sunIntensity: number;
  readonly ambientGroundColorHex: string;
  readonly ambientSkyColorHex: string;
  readonly ambientIntensity: number;
  readonly exposure: number;
}

export interface AtmosphereFogConfig {
  readonly enabled: boolean;
  readonly colorHex: string;
  readonly density: number;
  readonly near: number;
  readonly far: number;
  readonly heightFalloff: number;
  readonly baseHeight: number;
}

export interface AtmosphereCloudConfig {
  readonly enabled: boolean;
  readonly coverage: number; // 0 (clear) to 1 (overcast)
  readonly density: number;
  readonly altitude: number; // meters
  readonly driftSpeed: number; // m/s
  readonly windDirectionDeg: number;
  readonly cloudColorHex: string;
}

export interface PrecipitationConfig {
  readonly kind: PrecipitationKind;
  readonly particleCount: number;
  readonly dropSpeed: number; // m/s
  readonly size: number;
  readonly colorHex: string;
  readonly opacity: number;
  readonly windSlantAngleDeg: number;
  readonly boundsRadius: number;
}

export interface Studio3DAtmospherePreset {
  readonly id: WeatherPresetId;
  readonly name: string;
  readonly description: string;
  readonly lighting: AtmosphereLightingConfig;
  readonly fog: AtmosphereFogConfig;
  readonly clouds: AtmosphereCloudConfig;
  readonly precipitation: PrecipitationConfig;
}

export interface ParticleVertexData {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly count: number;
}

export class Studio3DAtmosphereEngine {
  private preset: Studio3DAtmospherePreset;

  constructor(initialPresetId: WeatherPresetId = "golden-hour") {
    this.preset = Studio3DAtmosphereEngine.getPreset(initialPresetId);
  }

  public static getPreset(presetId: WeatherPresetId): Studio3DAtmospherePreset {
    const preset = ATMOSPHERE_PRESETS[presetId];
    if (!preset) {
      return ATMOSPHERE_PRESETS["clear-noon"];
    }
    return preset;
  }

  public static getAllPresets(): readonly Studio3DAtmospherePreset[] {
    return Object.values(ATMOSPHERE_PRESETS);
  }

  public getActivePreset(): Studio3DAtmospherePreset {
    return this.preset;
  }

  public setPreset(presetId: WeatherPresetId): void {
    this.preset = Studio3DAtmosphereEngine.getPreset(presetId);
  }

  /**
   * Calculates sun directional vector from azimuth and elevation angles (degrees).
   * Elevation: 0 = horizon, 90 = zenith, -90 = nadir.
   * Azimuth: 0 = North, 90 = East, 180 = South, 270 = West.
   */
  public static calculateSunVector(azimuthDeg: number, elevationDeg: number): [number, number, number] {
    const azRad = (azimuthDeg * Math.PI) / 180;
    const elRad = (elevationDeg * Math.PI) / 180;

    const y = Math.sin(elRad);
    const cosEl = Math.cos(elRad);
    const x = cosEl * Math.sin(azRad);
    const z = cosEl * Math.cos(azRad);

    return [x, y, z];
  }

  /**
   * Computes atmospheric Rayleigh scattering color based on sun elevation angle.
   */
  public static computeRayleighSkyColor(elevationDeg: number): {
    zenithColor: string;
    horizonColor: string;
    sunColor: string;
  } {
    const el = Math.max(-10, Math.min(90, elevationDeg));

    if (el < 0) {
      // Night / Twilight
      return {
        zenithColor: "#050b14",
        horizonColor: "#0d1b2a",
        sunColor: "#223344",
      };
    } else if (el < 15) {
      // Sunrise / Sunset (Red/Orange dominant)
      const subT = el / 15;
      return {
        zenithColor: subT < 0.5 ? "#1a2436" : "#283b54",
        horizonColor: subT < 0.5 ? "#ff5400" : "#ff7b00",
        sunColor: "#ff9e00",
      };
    } else if (el < 40) {
      // Golden Hour / Late Afternoon
      return {
        zenithColor: "#3a6073",
        horizonColor: "#ffc371",
        sunColor: "#fff1b8",
      };
    } else {
      // High Sun / Midday (Deep Blue Rayleigh)
      return {
        zenithColor: "#1e5799",
        horizonColor: "#7db9e8",
        sunColor: "#ffffff",
      };
    }
  }

  /**
   * Generates precipitation particle stream vertices around a camera origin.
   */
  public generatePrecipitationParticles(
    cameraPosition: readonly [number, number, number] = [0, 0, 0],
    seed = 42,
  ): ParticleVertexData {
    const precip = this.preset.precipitation;
    if (precip.kind === "none" || precip.particleCount <= 0) {
      return {
        positions: new Float32Array(0),
        velocities: new Float32Array(0),
        colors: new Float32Array(0),
        sizes: new Float32Array(0),
        count: 0,
      };
    }

    const count = precip.particleCount;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const sizes = new Float32Array(count);

    const radius = precip.boundsRadius;
    const slantRad = (precip.windSlantAngleDeg * Math.PI) / 180;
    const vx = Math.sin(slantRad) * precip.dropSpeed;
    const vy = -Math.cos(slantRad) * precip.dropSpeed;
    const vz = 0;

    const [r, g, b] = hexToRgb(precip.colorHex);

    let rnd = seed;
    const pseudoRandom = () => {
      rnd = (rnd * 1664525 + 1013904223) % 4294967296;
      return rnd / 4294967296;
    };

    for (let i = 0; i < count; i += 1) {
      const idx3 = i * 3;
      const idx4 = i * 4;

      // Random particle distribution in cylinder around camera
      const theta = pseudoRandom() * 2 * Math.PI;
      const dist = Math.sqrt(pseudoRandom()) * radius;
      const height = (pseudoRandom() * 2 - 1) * radius;

      positions[idx3] = cameraPosition[0] + dist * Math.cos(theta);
      positions[idx3 + 1] = cameraPosition[1] + height;
      positions[idx3 + 2] = cameraPosition[2] + dist * Math.sin(theta);

      // Add slight individual velocity jitter
      const speedJitter = 0.8 + pseudoRandom() * 0.4;
      velocities[idx3] = vx * speedJitter;
      velocities[idx3 + 1] = vy * speedJitter;
      velocities[idx3 + 2] = vz + (pseudoRandom() - 0.5) * 0.5;

      colors[idx4] = r;
      colors[idx4 + 1] = g;
      colors[idx4 + 2] = b;
      colors[idx4 + 3] = precip.opacity * (0.6 + pseudoRandom() * 0.4);

      sizes[i] = precip.size * (0.8 + pseudoRandom() * 0.4);
    }

    return {
      positions,
      velocities,
      colors,
      sizes,
      count,
    };
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [1, 1, 1];
}

export const ATMOSPHERE_PRESETS: Readonly<Record<WeatherPresetId, Studio3DAtmospherePreset>> = {
  "clear-noon": {
    id: "clear-noon",
    name: "쾌청한 한낮",
    description: "선명한 파란 하늘과 직사광선 조명. 일상 학원물 및 활기찬 장면에 최적.",
    lighting: {
      sunDirection: [0.2, 0.9, 0.3],
      sunColorHex: "#ffffff",
      sunIntensity: 1.2,
      ambientGroundColorHex: "#687a8f",
      ambientSkyColorHex: "#99c4ff",
      ambientIntensity: 0.5,
      exposure: 1.0,
    },
    fog: {
      enabled: true,
      colorHex: "#cce0ff",
      density: 0.002,
      near: 10,
      far: 200,
      heightFalloff: 0.01,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.2,
      density: 0.3,
      altitude: 120,
      driftSpeed: 1.5,
      windDirectionDeg: 45,
      cloudColorHex: "#ffffff",
    },
    precipitation: {
      kind: "none",
      particleCount: 0,
      dropSpeed: 0,
      size: 0,
      colorHex: "#ffffff",
      opacity: 0,
      windSlantAngleDeg: 0,
      boundsRadius: 20,
    },
  },
  "golden-hour": {
    id: "golden-hour",
    name: "골든 아워 (황금빛 노을)",
    description: "따뜻한 주황빛 사광선과 긴 그림자. 감성적인 로맨스 및 하교길 연출.",
    lighting: {
      sunDirection: [0.8, 0.25, 0.4],
      sunColorHex: "#ffb703",
      sunIntensity: 1.4,
      ambientGroundColorHex: "#4a3b32",
      ambientSkyColorHex: "#ffb703",
      ambientIntensity: 0.6,
      exposure: 1.1,
    },
    fog: {
      enabled: true,
      colorHex: "#ffd166",
      density: 0.006,
      near: 5,
      far: 120,
      heightFalloff: 0.03,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.4,
      density: 0.5,
      altitude: 100,
      driftSpeed: 2.0,
      windDirectionDeg: 90,
      cloudColorHex: "#ff9f1c",
    },
    precipitation: {
      kind: "none",
      particleCount: 0,
      dropSpeed: 0,
      size: 0,
      colorHex: "#ffffff",
      opacity: 0,
      windSlantAngleDeg: 0,
      boundsRadius: 20,
    },
  },
  "dramatic-sunset": {
    id: "dramatic-sunset",
    name: "비장한 붉은 석양",
    description: "강렬한 진홍빛 하늘과 역광 실루엣. 클라이맥스 결투 및 비장미 넘치는 순간.",
    lighting: {
      sunDirection: [0.95, 0.1, 0.2],
      sunColorHex: "#e63946",
      sunIntensity: 1.6,
      ambientGroundColorHex: "#1d1128",
      ambientSkyColorHex: "#f72585",
      ambientIntensity: 0.4,
      exposure: 1.15,
    },
    fog: {
      enabled: true,
      colorHex: "#7209b7",
      density: 0.008,
      near: 3,
      far: 90,
      heightFalloff: 0.04,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.6,
      density: 0.7,
      altitude: 90,
      driftSpeed: 3.5,
      windDirectionDeg: 120,
      cloudColorHex: "#b5179e",
    },
    precipitation: {
      kind: "none",
      particleCount: 0,
      dropSpeed: 0,
      size: 0,
      colorHex: "#ffffff",
      opacity: 0,
      windSlantAngleDeg: 0,
      boundsRadius: 20,
    },
  },
  "cyberpunk-neon-night": {
    id: "cyberpunk-neon-night",
    name: "사이버펑크 네온 나이트",
    description: "짙은 밤하늘과 푸른/자주빛 네온 림라이트. SF, 액션 및 도심 야경.",
    lighting: {
      sunDirection: [-0.3, -0.8, -0.4],
      sunColorHex: "#4cc9f0",
      sunIntensity: 0.7,
      ambientGroundColorHex: "#03071e",
      ambientSkyColorHex: "#7209b7",
      ambientIntensity: 0.35,
      exposure: 1.3,
    },
    fog: {
      enabled: true,
      colorHex: "#3a0ca3",
      density: 0.012,
      near: 2,
      far: 75,
      heightFalloff: 0.05,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.7,
      density: 0.6,
      altitude: 80,
      driftSpeed: 1.2,
      windDirectionDeg: 180,
      cloudColorHex: "#4361ee",
    },
    precipitation: {
      kind: "none",
      particleCount: 0,
      dropSpeed: 0,
      size: 0,
      colorHex: "#4cc9f0",
      opacity: 0.5,
      windSlantAngleDeg: 0,
      boundsRadius: 20,
    },
  },
  "eerie-fog": {
    id: "eerie-fog",
    name: "음산한 안개 (미스터리)",
    description: "시야가 짙게 가려진 안개와 창백한 조명. 스릴러, 호러 및 잠입 장면.",
    lighting: {
      sunDirection: [0.1, 0.6, 0.2],
      sunColorHex: "#a8dadc",
      sunIntensity: 0.6,
      ambientGroundColorHex: "#1b263b",
      ambientSkyColorHex: "#415a77",
      ambientIntensity: 0.45,
      exposure: 0.9,
    },
    fog: {
      enabled: true,
      colorHex: "#e0e1dd",
      density: 0.045,
      near: 1,
      far: 35,
      heightFalloff: 0.08,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.9,
      density: 0.9,
      altitude: 40,
      driftSpeed: 0.6,
      windDirectionDeg: 0,
      cloudColorHex: "#778da9",
    },
    precipitation: {
      kind: "none",
      particleCount: 0,
      dropSpeed: 0,
      size: 0,
      colorHex: "#ffffff",
      opacity: 0,
      windSlantAngleDeg: 0,
      boundsRadius: 15,
    },
  },
  "rainy-drizzle": {
    id: "rainy-drizzle",
    name: "촉촉한 봄비 / 이슬비",
    description: "차분한 빗줄기와 젖은 바닥 반사. 서정적이고 센치한 일상 연출.",
    lighting: {
      sunDirection: [0.2, 0.7, 0.3],
      sunColorHex: "#bde0fe",
      sunIntensity: 0.75,
      ambientGroundColorHex: "#2b2d42",
      ambientSkyColorHex: "#8d99ae",
      ambientIntensity: 0.5,
      exposure: 1.0,
    },
    fog: {
      enabled: true,
      colorHex: "#a2d2ff",
      density: 0.015,
      near: 3,
      far: 60,
      heightFalloff: 0.03,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.8,
      density: 0.7,
      altitude: 70,
      driftSpeed: 3.0,
      windDirectionDeg: 70,
      cloudColorHex: "#6c757d",
    },
    precipitation: {
      kind: "rain",
      particleCount: 600,
      dropSpeed: 12.0,
      size: 0.08,
      colorHex: "#dbe9f6",
      opacity: 0.7,
      windSlantAngleDeg: 8,
      boundsRadius: 15,
    },
  },
  "heavy-thunderstorm": {
    id: "heavy-thunderstorm",
    name: "폭풍우와 번개",
    description: "거센 장대비와 사나운 바람. 위기 상황 및 재난 스케일의 액션.",
    lighting: {
      sunDirection: [0.1, 0.4, 0.2],
      sunColorHex: "#f4f3ee",
      sunIntensity: 1.1,
      ambientGroundColorHex: "#0b090a",
      ambientSkyColorHex: "#161a1d",
      ambientIntensity: 0.3,
      exposure: 0.85,
    },
    fog: {
      enabled: true,
      colorHex: "#2b2d42",
      density: 0.025,
      near: 2,
      far: 45,
      heightFalloff: 0.04,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 1.0,
      density: 1.0,
      altitude: 50,
      driftSpeed: 8.0,
      windDirectionDeg: 110,
      cloudColorHex: "#1f2421",
    },
    precipitation: {
      kind: "rain",
      particleCount: 1500,
      dropSpeed: 22.0,
      size: 0.12,
      colorHex: "#c8d6e5",
      opacity: 0.85,
      windSlantAngleDeg: 25,
      boundsRadius: 20,
    },
  },
  "gentle-snowfall": {
    id: "gentle-snowfall",
    name: "소복이 내리는 함박눈",
    description: "부드럽게 흩날리는 하얀 눈송이와 포근한 겨울 정취.",
    lighting: {
      sunDirection: [0.3, 0.6, 0.4],
      sunColorHex: "#ffffff",
      sunIntensity: 0.95,
      ambientGroundColorHex: "#e0f2fe",
      ambientSkyColorHex: "#bae6fd",
      ambientIntensity: 0.65,
      exposure: 1.05,
    },
    fog: {
      enabled: true,
      colorHex: "#f0f9ff",
      density: 0.012,
      near: 4,
      far: 70,
      heightFalloff: 0.02,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.7,
      density: 0.6,
      altitude: 90,
      driftSpeed: 1.2,
      windDirectionDeg: 30,
      cloudColorHex: "#e2e8f0",
    },
    precipitation: {
      kind: "snow",
      particleCount: 800,
      dropSpeed: 2.2,
      size: 0.15,
      colorHex: "#ffffff",
      opacity: 0.9,
      windSlantAngleDeg: 10,
      boundsRadius: 18,
    },
  },
  "blizzard": {
    id: "blizzard",
    name: "설원의 눈보라 (블리자드)",
    description: "시야를 집어삼키는 휘몰아치는 눈보라와 혹한의 추위.",
    lighting: {
      sunDirection: [0.2, 0.4, 0.3],
      sunColorHex: "#e2e8f0",
      sunIntensity: 0.7,
      ambientGroundColorHex: "#cbd5e1",
      ambientSkyColorHex: "#94a3b8",
      ambientIntensity: 0.4,
      exposure: 0.9,
    },
    fog: {
      enabled: true,
      colorHex: "#f8fafc",
      density: 0.035,
      near: 1.5,
      far: 35,
      heightFalloff: 0.06,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.95,
      density: 0.95,
      altitude: 45,
      driftSpeed: 9.0,
      windDirectionDeg: 280,
      cloudColorHex: "#64748b",
    },
    precipitation: {
      kind: "snow",
      particleCount: 2000,
      dropSpeed: 15.0,
      size: 0.18,
      colorHex: "#ffffff",
      opacity: 0.95,
      windSlantAngleDeg: 40,
      boundsRadius: 22,
    },
  },
  "cherry-blossom-spring": {
    id: "cherry-blossom-spring",
    name: "흩날리는 벚꽃잎 (봄바람)",
    description: "분홍빛 벚꽃잎이 회오리치며 흩날리는 감성 로맨스 및 신학기 무드.",
    lighting: {
      sunDirection: [0.35, 0.75, 0.3],
      sunColorHex: "#fff0f3",
      sunIntensity: 1.15,
      ambientGroundColorHex: "#ffb3c1",
      ambientSkyColorHex: "#ffccd5",
      ambientIntensity: 0.55,
      exposure: 1.05,
    },
    fog: {
      enabled: true,
      colorHex: "#ffe5ec",
      density: 0.005,
      near: 6,
      far: 100,
      heightFalloff: 0.02,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.3,
      density: 0.4,
      altitude: 110,
      driftSpeed: 2.2,
      windDirectionDeg: 60,
      cloudColorHex: "#fff0f5",
    },
    precipitation: {
      kind: "sakura",
      particleCount: 500,
      dropSpeed: 1.8,
      size: 0.22,
      colorHex: "#ff758f",
      opacity: 0.9,
      windSlantAngleDeg: 25,
      boundsRadius: 16,
    },
  },
  "autumn-leaves": {
    id: "autumn-leaves",
    name: "단풍잎 낙엽 (가을바람)",
    description: "붉고 노란 단풍잎이 나풀거리며 떨어지는 가을 분위기.",
    lighting: {
      sunDirection: [0.6, 0.45, 0.4],
      sunColorHex: "#ffb703",
      sunIntensity: 1.1,
      ambientGroundColorHex: "#7f4f24",
      ambientSkyColorHex: "#ddb892",
      ambientIntensity: 0.5,
      exposure: 1.0,
    },
    fog: {
      enabled: true,
      colorHex: "#ede0d4",
      density: 0.007,
      near: 5,
      far: 85,
      heightFalloff: 0.02,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.4,
      density: 0.5,
      altitude: 100,
      driftSpeed: 2.5,
      windDirectionDeg: 140,
      cloudColorHex: "#cb997e",
    },
    precipitation: {
      kind: "leaves",
      particleCount: 450,
      dropSpeed: 2.0,
      size: 0.25,
      colorHex: "#c1121f",
      opacity: 0.9,
      windSlantAngleDeg: 30,
      boundsRadius: 18,
    },
  },
  "fantasy-celestial-aurora": {
    id: "fantasy-celestial-aurora",
    name: "환상적인 오로라 & 별빛",
    description: "신비로운 에메랄드/바이올렛 오로라와 쏟아지는 별빛. 판타지 및 이세계 연출.",
    lighting: {
      sunDirection: [-0.2, -0.9, -0.3],
      sunColorHex: "#52b788",
      sunIntensity: 0.85,
      ambientGroundColorHex: "#081c15",
      ambientSkyColorHex: "#7400b8",
      ambientIntensity: 0.45,
      exposure: 1.25,
    },
    fog: {
      enabled: true,
      colorHex: "#2d6a4f",
      density: 0.015,
      near: 2,
      far: 65,
      heightFalloff: 0.04,
      baseHeight: 0,
    },
    clouds: {
      enabled: true,
      coverage: 0.5,
      density: 0.6,
      altitude: 130,
      driftSpeed: 1.0,
      windDirectionDeg: 210,
      cloudColorHex: "#64dfdf",
    },
    precipitation: {
      kind: "embers",
      particleCount: 350,
      dropSpeed: -0.6, // Floats upward like magical sparkles
      size: 0.12,
      colorHex: "#80ffdb",
      opacity: 0.85,
      windSlantAngleDeg: 12,
      boundsRadius: 16,
    },
  },
};
