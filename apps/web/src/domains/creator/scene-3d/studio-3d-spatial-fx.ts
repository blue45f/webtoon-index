/**
 * Studio 3D Spatial Webtoon FX & 3D Typography Engine
 *
 * 3D 공간 상에 배치되는 웹툰 연출 이펙트 엔진입니다:
 * 1. 3D 원근 집중선 (3D Focus Speed Lines)
 * 2. 3D 궤적 모션 스트릭 (3D Motion Ribbons & Trails)
 * 3. 3D 입체 효과음 / 의성어·의태어 타이포그래피 (3D Sound Effect SFX)
 * 4. 3D 임팩트 버스트 & 충격파 링 (3D Impact Bursts & Shockwaves)
 */

export interface SpatialSpeedLineConfig {
  center: [number, number, number];
  rayCount: number;
  innerRadius: number;
  outerRadius: number;
  lineThickness: number;
  colorHex: string;
  opacity: number;
}

export interface SpatialSpeedLineSegment {
  start: [number, number, number];
  end: [number, number, number];
  thickness: number;
}

export type SfxTextPreset =
  | "쿵" // Thud / Heavy impact
  | "쾅" // Crash / Explosion
  | "촤아악" // Whoosh / Slash
  | "번쩍" // Flash / Gleam
  | "스윽" // Creep / Smooth motion
  | "두근" // Heartbeat / Tension
  | "콰앙" // Big boom
  | "파지지직"; // Electric spark

export interface SpatialSfxTypographyConfig {
  id: string;
  text: string;
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: number;
  extrusionDepth: number; // 3D 입체 두께
  fillColorHex: string;
  outlineColorHex: string;
  outlineWidth: number;
  motionBlurTrail: boolean;
}

export interface SpatialImpactBurstConfig {
  position: [number, number, number];
  pointCount: number; // 뾰족한 스파이크 개수
  innerRadius: number;
  outerRadius: number;
  colorHex: string;
  rotationSpeedDeg: number;
}

export class Studio3DSpatialFxEngine {
  /**
   * 3D 초점 집중선(Focus Speed Lines) 기하 생성
   */
  public generateFocusSpeedLines(config: SpatialSpeedLineConfig): SpatialSpeedLineSegment[] {
    const lines: SpatialSpeedLineSegment[] = [];
    const count = Math.max(8, Math.min(128, config.rayCount));

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      // Slight pseudo-random variance in length
      const lengthVar = 0.8 + 0.4 * Math.sin(i * 13.37);
      const inR = config.innerRadius * lengthVar;
      const outR = config.outerRadius * lengthVar;

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const start: [number, number, number] = [
        config.center[0] + cosA * inR,
        config.center[1] + sinA * inR,
        config.center[2],
      ];

      const end: [number, number, number] = [
        config.center[0] + cosA * outR,
        config.center[1] + sinA * outR,
        config.center[2],
      ];

      lines.push({
        start,
        end,
        thickness: config.lineThickness,
      });
    }

    return lines;
  }

  /**
   * 3D 임팩트 충격파 버스트(Impact Starburst) 2D/3D 정점 생성
   */
  public generateImpactStarburstVertices(config: SpatialImpactBurstConfig): Float32Array {
    const points = Math.max(4, Math.min(32, config.pointCount));
    const totalVertices = points * 2;
    const positions = new Float32Array(totalVertices * 3);

    for (let i = 0; i < totalVertices; i += 1) {
      const isSpike = i % 2 === 0;
      const r = isSpike ? config.outerRadius : config.innerRadius;
      const angle = (i / totalVertices) * Math.PI * 2;

      const x = config.position[0] + Math.cos(angle) * r;
      const y = config.position[1] + Math.sin(angle) * r;
      const z = config.position[2];

      const idx = i * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
    }

    return positions;
  }

  /**
   * 3D 효과음 타이포그래피 프리셋 생성
   */
  public createSfxPreset(
    preset: SfxTextPreset,
    position: [number, number, number] = [0, 1.5, 0],
    scale = 1.0,
  ): SpatialSfxTypographyConfig {
    const colorMap: Record<SfxTextPreset, { fill: string; outline: string; depth: number }> = {
      쿵: { fill: "#ff0054", outline: "#000000", depth: 0.15 },
      쾅: { fill: "#ffbe0b", outline: "#3a0ca3", depth: 0.2 },
      촤아악: { fill: "#4cc9f0", outline: "#03045e", depth: 0.1 },
      번쩍: { fill: "#ffe600", outline: "#ffffff", depth: 0.12 },
      스윽: { fill: "#9d4edd", outline: "#240046", depth: 0.08 },
      두근: { fill: "#f72585", outline: "#7209b7", depth: 0.1 },
      콰앙: { fill: "#fb5607", outline: "#000000", depth: 0.25 },
      파지지직: { fill: "#70e000", outline: "#007200", depth: 0.15 },
    };

    const cfg = colorMap[preset];

    return {
      id: `sfx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: preset,
      position,
      rotationDeg: [0, 0, 0],
      scale,
      extrusionDepth: cfg.depth,
      fillColorHex: cfg.fill,
      outlineColorHex: cfg.outline,
      outlineWidth: 2.5,
      motionBlurTrail: false,
    };
  }
}
