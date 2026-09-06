/**
 * Studio 3D Speed Lines & Action Convergence Generator (Clip Studio / Acon3D Benchmark).
 * Generates 3D action speed lines converging towards a target focus in 3D space.
 */

export type SpeedLineKind = "radial-focus" | "linear-streak" | "spiral-tornado";

export interface SpeedLineConfig {
  readonly kind: SpeedLineKind;
  readonly lineCount: number; // 20 to 200
  readonly innerRadius: number; // radius around focus point where lines stop
  readonly outerRadius: number; // boundary where lines start
  readonly focusPoint: readonly [number, number, number];
  readonly lineThickness: number;
  readonly lengthVariation: number;
  readonly taperFactor: number; // 0.0 to 1.0 (thick at start, sharp at tip)
  readonly densityNoise: number;
  readonly color: string; // hex
  readonly opacity: number;
}

export interface SpeedLineSegment {
  readonly id: number;
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly thickness: number;
  readonly alpha: number;
}

export interface SpeedLineSetResult {
  readonly kind: SpeedLineKind;
  readonly totalLines: number;
  readonly focusPoint: readonly [number, number, number];
  readonly segments: readonly SpeedLineSegment[];
}

/**
 * Generates 3D speed lines.
 */
export function generate3dSpeedLines(config: SpeedLineConfig): SpeedLineSetResult {
  const count = Math.max(10, Math.min(300, Math.floor(config.lineCount)));
  const segments: SpeedLineSegment[] = [];

  const [fx, fy, fz] = config.focusPoint;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const noise = Math.sin(i * 13.37) * config.densityNoise;
    const perturbedAngle = angle + noise * 0.2;

    const lengthDelta = Math.cos(i * 7.19) * config.lengthVariation;
    const currentInnerR = Math.max(0.1, config.innerRadius + lengthDelta * 0.5);
    const currentOuterR = Math.max(currentInnerR + 0.5, config.outerRadius + lengthDelta);

    let startX: number;
    let startY: number;
    let startZ: number;
    let endX: number;
    let endY: number;
    let endZ: number;

    if (config.kind === "radial-focus") {
      // Converging towards focus point in 3D sphere / plane
      const elevation = (Math.sin(i * 3.14) * 0.4); // slight 3D elevation
      startX = fx + Math.cos(perturbedAngle) * currentOuterR;
      startY = fy + elevation * currentOuterR;
      startZ = fz + Math.sin(perturbedAngle) * currentOuterR;

      endX = fx + Math.cos(perturbedAngle) * currentInnerR;
      endY = fy + elevation * currentInnerR;
      endZ = fz + Math.sin(perturbedAngle) * currentInnerR;
    } else if (config.kind === "linear-streak") {
      // Parallel action streaks along Z axis
      const spreadX = Math.cos(perturbedAngle) * currentOuterR;
      const spreadY = Math.sin(perturbedAngle) * currentOuterR;
      startX = fx + spreadX;
      startY = fy + spreadY;
      startZ = fz - currentOuterR;

      endX = fx + spreadX;
      endY = fy + spreadY;
      endZ = fz - currentInnerR;
    } else {
      // spiral-tornado
      const spiralOffset = 0.5;
      startX = fx + Math.cos(perturbedAngle + spiralOffset) * currentOuterR;
      startY = fy + currentOuterR * 0.5;
      startZ = fz + Math.sin(perturbedAngle + spiralOffset) * currentOuterR;

      endX = fx + Math.cos(perturbedAngle) * currentInnerR;
      endY = fy;
      endZ = fz + Math.sin(perturbedAngle) * currentInnerR;
    }

    segments.push({
      id: i + 1,
      start: [startX, startY, startZ],
      end: [endX, endY, endZ],
      thickness: Math.max(0.01, config.lineThickness * (1 - noise * 0.3)),
      alpha: Math.min(1.0, Math.max(0.1, config.opacity * (0.8 + Math.abs(noise) * 0.4))),
    });
  }

  return {
    kind: config.kind,
    totalLines: segments.length,
    focusPoint: config.focusPoint,
    segments: Object.freeze(segments),
  };
}
