/**
 * Studio 광원 및 그림자 커스터마이징(Light & Shadow Gizmo) 연산기.
 *
 * 구체(Spherical) 컨트롤러의 방위각(Azimuth) 및 고도각(Elevation) 각도를 기반으로
 * 3D 태양/조명 방향 벡터, 그림자 투영 오프셋, 그림자 농도(Opacity) 및 웹툰 무드 프리셋을 연산한다.
 */

export interface StudioLightDirection {
  /** 방위각 (도 0~360). 0=정면광, 90=우측광, 180=역광, 270=좌측광. */
  readonly azimuthDeg: number;
  /** 고도각 (도 -90~90). 90=직사 직광(머리 위), 0=수평광, -90=하단 탑라이트. */
  readonly elevationDeg: number;
}

export interface StudioShadowConfig {
  /** 그림자 투영 강도/농도 (0~1). 기본값 0.6. */
  readonly opacity: number;
  /** 그림자 퍼짐/부드러움(Soft Shadow Blur px). 기본값 4. */
  readonly blurPx: number;
  /** 그림자 투영 X 오프셋 배율. */
  readonly shadowVectorX: number;
  /** 그림자 투영 Y 오프셋 배율. */
  readonly shadowVectorY: number;
}

export interface StudioMoodLightingPreset {
  readonly id: string;
  readonly label: string;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly shadowOpacity: number;
  readonly shadowBlurPx: number;
  readonly ambientColor: readonly [number, number, number];
}

/** 웹툰 컷 분위기별 씬 광원 프리셋. */
export const STUDIO_MOOD_LIGHTING_PRESETS: readonly StudioMoodLightingPreset[] = [
  {
    id: "noon",
    label: "맑은 대낮 (정면 상단광)",
    azimuthDeg: 30,
    elevationDeg: 60,
    shadowOpacity: 0.5,
    shadowBlurPx: 4,
    ambientColor: [255, 255, 255],
  },
  {
    id: "sunset",
    label: "노을/석양 (낮은 수평광)",
    azimuthDeg: 200,
    elevationDeg: 15,
    shadowOpacity: 0.7,
    shadowBlurPx: 8,
    ambientColor: [255, 180, 120],
  },
  {
    id: "thriller",
    label: "스릴러/공포 (하단 역광)",
    azimuthDeg: 180,
    elevationDeg: -45,
    shadowOpacity: 0.85,
    shadowBlurPx: 2,
    ambientColor: [100, 120, 160],
  },
  {
    id: "night",
    label: "달빛 밤 (어두운 푸른 광)",
    azimuthDeg: 120,
    elevationDeg: 45,
    shadowOpacity: 0.6,
    shadowBlurPx: 6,
    ambientColor: [80, 100, 140],
  },
];

/**
 * 구체 방위각/고도각에서 3D 3축 단위 광원 방향 벡터 [x, y, z]를 연산한다.
 */
export function computeLightVectorFromSpherical(
  spherical: StudioLightDirection,
): readonly [number, number, number] {
  const azRad = (spherical.azimuthDeg * Math.PI) / 180;
  const elRad = (spherical.elevationDeg * Math.PI) / 180;

  const cosEl = Math.cos(elRad);
  const x = Math.sin(azRad) * cosEl;
  const y = Math.sin(elRad);
  const z = Math.cos(azRad) * cosEl;

  return [x, y, z];
}

/**
 * 광원 방향 벡터에서 2D 캔버스 그림자 투영 벡터 및 농도 스펙을 연산한다.
 */
export function computeShadowConfigFromLight(
  spherical: StudioLightDirection,
  baseOpacity: number = 0.6,
  blurPx: number = 4,
): StudioShadowConfig {
  const [lx, ly, lz] = computeLightVectorFromSpherical(spherical);

  // 그림자 투영 방향은 광원 반대 방향
  const shadowVectorX = -lx * 10;
  const shadowVectorY = -lz * 10;

  // 광원이 낮을수록 그림자가 길어지고 옅어짐
  const elevationFactor = Math.max(0.2, Math.abs(ly));
  const opacity = Math.min(1.0, baseOpacity * (1 / (elevationFactor + 0.2)));

  return {
    opacity,
    blurPx,
    shadowVectorX,
    shadowVectorY,
  };
}
