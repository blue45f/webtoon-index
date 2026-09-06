/**
 * Studio 3D Procedural Cloner Engine (Spline / 3D DCC Benchmark).
 * Provides Linear, Radial, and Grid Cloners with jitter, scale decay, and spiral offsets.
 */

export type ClonerType = "linear" | "radial" | "grid";

export interface LinearClonerConfig {
  readonly count: number;
  readonly spacing: readonly [number, number, number];
  readonly rotationStep: readonly [number, number, number]; // in degrees
  readonly scaleMultiplier: readonly [number, number, number];
  readonly noiseJitter: readonly [number, number, number];
  readonly randomSeed?: number;
}

export interface RadialClonerConfig {
  readonly count: number;
  readonly radius: number;
  readonly arcDegrees: number; // usually 360
  readonly axis: "x" | "y" | "z";
  readonly alignToTangent: boolean;
  readonly spiralHeight: number; // vertical rise along axis
  readonly randomSeed?: number;
}

export interface GridClonerConfig {
  readonly countX: number;
  readonly countY: number;
  readonly countZ: number;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly spacingZ: number;
  readonly centerGrid: boolean;
  readonly noiseJitter: readonly [number, number, number];
  readonly randomSeed?: number;
}

export interface ClonedInstanceTransform {
  readonly index: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number]; // degrees
  readonly scale: readonly [number, number, number];
}

export interface ClonerGenerationResult {
  readonly clonerType: ClonerType;
  readonly totalInstances: number;
  readonly instances: readonly ClonedInstanceTransform[];
}

/**
 * Pseudo-random generator with deterministic seed.
 */
function createSeededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Generate instances for a Linear Cloner (e.g. stairs, fences, street lamps, building rows).
 */
export function generateLinearCloner(config: LinearClonerConfig): ClonerGenerationResult {
  const count = Math.max(1, Math.min(256, Math.floor(config.count)));
  const rand = createSeededRandom(config.randomSeed ?? 42);
  const instances: ClonedInstanceTransform[] = [];

  for (let i = 0; i < count; i++) {
    const jitterX = (rand() * 2 - 1) * config.noiseJitter[0];
    const jitterY = (rand() * 2 - 1) * config.noiseJitter[1];
    const jitterZ = (rand() * 2 - 1) * config.noiseJitter[2];

    const posX = i * config.spacing[0] + jitterX;
    const posY = i * config.spacing[1] + jitterY;
    const posZ = i * config.spacing[2] + jitterZ;

    const rotX = i * config.rotationStep[0];
    const rotY = i * config.rotationStep[1];
    const rotZ = i * config.rotationStep[2];

    const scX = Math.max(0.001, Math.pow(config.scaleMultiplier[0], i));
    const scY = Math.max(0.001, Math.pow(config.scaleMultiplier[1], i));
    const scZ = Math.max(0.001, Math.pow(config.scaleMultiplier[2], i));

    instances.push({
      index: i,
      position: [posX, posY, posZ],
      rotation: [rotX, rotY, rotZ],
      scale: [scX, scY, scZ],
    });
  }

  return {
    clonerType: "linear",
    totalInstances: instances.length,
    instances: Object.freeze(instances),
  };
}

/**
 * Generate instances for a Radial Cloner (e.g. magic circles, round tables, pillar formations).
 */
export function generateRadialCloner(config: RadialClonerConfig): ClonerGenerationResult {
  const count = Math.max(1, Math.min(256, Math.floor(config.count)));
  const arcRad = (config.arcDegrees * Math.PI) / 180;
  const stepAngle = count > 1 && config.arcDegrees === 360 ? arcRad / count : arcRad / Math.max(1, count - 1);
  const instances: ClonedInstanceTransform[] = [];

  for (let i = 0; i < count; i++) {
    const angle = i * stepAngle;
    const progress = count > 1 ? i / (count - 1) : 0;
    const currentHeight = progress * config.spiralHeight;

    let posX: number;
    let posY: number;
    let posZ: number;
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;

    const angleDeg = (angle * 180) / Math.PI;

    if (config.axis === "y") {
      posX = Math.cos(angle) * config.radius;
      posZ = Math.sin(angle) * config.radius;
      posY = currentHeight;
      if (config.alignToTangent) {
        rotY = -angleDeg + 90;
      }
    } else if (config.axis === "z") {
      posX = Math.cos(angle) * config.radius;
      posY = Math.sin(angle) * config.radius;
      posZ = currentHeight;
      if (config.alignToTangent) {
        rotZ = angleDeg;
      }
    } else {
      // x-axis
      posY = Math.cos(angle) * config.radius;
      posZ = Math.sin(angle) * config.radius;
      posX = currentHeight;
      if (config.alignToTangent) {
        rotX = angleDeg;
      }
    }

    instances.push({
      index: i,
      position: [posX, posY, posZ],
      rotation: [rotX, rotY, rotZ],
      scale: [1, 1, 1],
    });
  }

  return {
    clonerType: "radial",
    totalInstances: instances.length,
    instances: Object.freeze(instances),
  };
}

/**
 * Generate instances for a 3D Grid / Matrix Cloner (e.g. classroom desks, city blocks).
 */
export function generateGridCloner(config: GridClonerConfig): ClonerGenerationResult {
  const cX = Math.max(1, Math.min(32, Math.floor(config.countX)));
  const cY = Math.max(1, Math.min(32, Math.floor(config.countY)));
  const cZ = Math.max(1, Math.min(32, Math.floor(config.countZ)));

  const rand = createSeededRandom(config.randomSeed ?? 101);
  const instances: ClonedInstanceTransform[] = [];

  const offsetX = config.centerGrid ? ((cX - 1) * config.spacingX) / 2 : 0;
  const offsetY = config.centerGrid ? ((cY - 1) * config.spacingY) / 2 : 0;
  const offsetZ = config.centerGrid ? ((cZ - 1) * config.spacingZ) / 2 : 0;

  let idx = 0;
  for (let z = 0; z < cZ; z++) {
    for (let y = 0; y < cY; y++) {
      for (let x = 0; x < cX; x++) {
        const jX = (rand() * 2 - 1) * config.noiseJitter[0];
        const jY = (rand() * 2 - 1) * config.noiseJitter[1];
        const jZ = (rand() * 2 - 1) * config.noiseJitter[2];

        const posX = x * config.spacingX - offsetX + jX;
        const posY = y * config.spacingY - offsetY + jY;
        const posZ = z * config.spacingZ - offsetZ + jZ;

        instances.push({
          index: idx++,
          position: [posX, posY, posZ],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        });
      }
    }
  }

  return {
    clonerType: "grid",
    totalInstances: instances.length,
    instances: Object.freeze(instances),
  };
}
