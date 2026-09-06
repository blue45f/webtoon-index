/**
 * Garment / cloth pattern kernel (GAR-001–008 subset) — pure TS, no WebGPU.
 * Pattern polygons, seam graph, XPBD-lite position solver for cloth particles.
 */

export const STUDIO_CLOTH_KERNEL_REVISION = 1 as const;

export type StudioVec2 = readonly [number, number];
export type StudioVec3 = readonly [number, number, number];

export interface StudioClothPatternPanel {
  readonly id: string;
  readonly outline: readonly StudioVec2[];
  readonly internalLines?: readonly (readonly StudioVec2[])[];
  readonly seamAllowance: number;
}

export interface StudioClothSeam {
  readonly id: string;
  readonly panelA: string;
  readonly edgeA: readonly [number, number];
  readonly panelB: string;
  readonly edgeB: readonly [number, number];
  readonly reversed: boolean;
}

export interface StudioClothFabricPreset {
  readonly id: string;
  readonly stretch: number;
  readonly bend: number;
  readonly shear: number;
  readonly density: number;
  readonly damping: number;
}

export const STUDIO_CLOTH_FABRIC_PRESETS: readonly StudioClothFabricPreset[] = [
  { id: "cotton", stretch: 0.9, bend: 0.4, shear: 0.5, density: 1, damping: 0.1 },
  { id: "silk", stretch: 0.7, bend: 0.15, shear: 0.3, density: 0.7, damping: 0.05 },
  { id: "denim", stretch: 0.95, bend: 0.8, shear: 0.7, density: 1.4, damping: 0.15 },
  { id: "knit", stretch: 0.4, bend: 0.2, shear: 0.25, density: 0.9, damping: 0.08 },
];

export interface StudioClothParticle {
  readonly position: StudioVec3;
  readonly invMass: number;
  readonly pinned: boolean;
}

export interface StudioClothDistanceConstraint {
  readonly a: number;
  readonly b: number;
  readonly rest: number;
  readonly compliance: number;
}

export interface StudioClothSimState {
  readonly particles: readonly StudioClothParticle[];
  readonly constraints: readonly StudioClothDistanceConstraint[];
  readonly velocities: readonly StudioVec3[];
  readonly fabric: StudioClothFabricPreset;
}

export function createStudioClothPatternPanel(
  id: string,
  outline: readonly StudioVec2[],
  seamAllowance = 0.01,
): StudioClothPatternPanel {
  return { id, outline: [...outline], seamAllowance, internalLines: [] };
}

export function validateStudioClothSeam(
  panels: readonly StudioClothPatternPanel[],
  seam: StudioClothSeam,
): { readonly ok: boolean; readonly lengthA: number; readonly lengthB: number; readonly mismatch: number } {
  const pa = panels.find((p) => p.id === seam.panelA);
  const pb = panels.find((p) => p.id === seam.panelB);
  if (!pa || !pb) return { ok: false, lengthA: 0, lengthB: 0, mismatch: Infinity };
  const len = (panel: StudioClothPatternPanel, e: readonly [number, number]) => {
    const a = panel.outline[e[0]];
    const b = panel.outline[e[1]];
    if (!a || !b) return 0;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const lengthA = len(pa, seam.edgeA);
  const lengthB = len(pb, seam.edgeB);
  const mismatch = Math.abs(lengthA - lengthB);
  return { ok: mismatch < Math.max(lengthA, lengthB) * 0.15 + 1e-6, lengthA, lengthB, mismatch };
}

function v3(x: number, y: number, z: number): StudioVec3 {
  return [x, y, z];
}

/** Build a grid cloth patch for simulation. */
export function createStudioClothGrid(
  width: number,
  height: number,
  resX: number,
  resY: number,
  fabric: StudioClothFabricPreset = STUDIO_CLOTH_FABRIC_PRESETS[0]!,
): StudioClothSimState {
  const nx = Math.max(2, Math.trunc(resX));
  const ny = Math.max(2, Math.trunc(resY));
  const particles: StudioClothParticle[] = [];
  const velocities: StudioVec3[] = [];
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const pinned = y === 0 && (x === 0 || x === nx - 1);
      particles.push({
        position: v3((x / (nx - 1)) * width, 0, (y / (ny - 1)) * height),
        invMass: pinned ? 0 : 1 / fabric.density,
        pinned,
      });
      velocities.push(v3(0, 0, 0));
    }
  }
  const constraints: StudioClothDistanceConstraint[] = [];
  const idx = (x: number, y: number) => y * nx + x;
  const rest = (a: number, b: number) => {
    const pa = particles[a]!.position;
    const pb = particles[b]!.position;
    return Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  };
  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      if (x + 1 < nx) {
        const a = idx(x, y);
        const b = idx(x + 1, y);
        constraints.push({
          a,
          b,
          rest: rest(a, b),
          compliance: (1 - fabric.stretch) * 0.01,
        });
      }
      if (y + 1 < ny) {
        const a = idx(x, y);
        const b = idx(x, y + 1);
        constraints.push({
          a,
          b,
          rest: rest(a, b),
          compliance: (1 - fabric.stretch) * 0.01,
        });
      }
      if (x + 1 < nx && y + 1 < ny) {
        // shear
        const a = idx(x, y);
        const b = idx(x + 1, y + 1);
        constraints.push({
          a,
          b,
          rest: rest(a, b),
          compliance: (1 - fabric.shear) * 0.02,
        });
      }
    }
  }
  return { particles, constraints, velocities, fabric };
}

/**
 * XPBD-lite distance constraints (GAR-005). Deterministic substeps.
 */
export function stepStudioClothXpbd(
  state: StudioClothSimState,
  dt: number,
  substeps = 4,
  gravity: StudioVec3 = [0, -9.81, 0],
): StudioClothSimState {
  const steps = Math.max(1, Math.min(32, Math.trunc(substeps)));
  const h = dt / steps;
  const positions = state.particles.map((p) => [...p.position] as [number, number, number]);
  const velocities = state.velocities.map((v) => [...v] as [number, number, number]);

  for (let s = 0; s < steps; s += 1) {
    // integrate
    for (let i = 0; i < positions.length; i += 1) {
      if (state.particles[i]!.pinned || state.particles[i]!.invMass === 0) continue;
      velocities[i]![0] += gravity[0] * h;
      velocities[i]![1] += gravity[1] * h;
      velocities[i]![2] += gravity[2] * h;
      const damp = 1 - state.fabric.damping * h;
      velocities[i]![0] *= damp;
      velocities[i]![1] *= damp;
      velocities[i]![2] *= damp;
      positions[i]![0] += velocities[i]![0] * h;
      positions[i]![1] += velocities[i]![1] * h;
      positions[i]![2] += velocities[i]![2] * h;
    }
    // constraints
    for (const c of state.constraints) {
      const pa = positions[c.a]!;
      const pb = positions[c.b]!;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const dz = pb[2] - pa[2];
      const dist = Math.hypot(dx, dy, dz) || 1e-8;
      const w0 = state.particles[c.a]!.invMass;
      const w1 = state.particles[c.b]!.invMass;
      if (w0 + w1 === 0) continue;
      const alpha = c.compliance / (h * h);
      const C = dist - c.rest;
      const dtLambda = -C / (w0 + w1 + alpha);
      const corrX = (dx / dist) * dtLambda;
      const corrY = (dy / dist) * dtLambda;
      const corrZ = (dz / dist) * dtLambda;
      if (w0 > 0) {
        pa[0] -= corrX * w0;
        pa[1] -= corrY * w0;
        pa[2] -= corrZ * w0;
      }
      if (w1 > 0) {
        pb[0] += corrX * w1;
        pb[1] += corrY * w1;
        pb[2] += corrZ * w1;
      }
    }
    // floor collision y=0
    for (let i = 0; i < positions.length; i += 1) {
      if (positions[i]![1] < 0) {
        positions[i]![1] = 0;
        velocities[i]![1] = Math.max(0, velocities[i]![1]!);
      }
    }
  }

  // recompute velocities from positions delta not needed — already integrated
  return {
    fabric: state.fabric,
    constraints: state.constraints,
    particles: state.particles.map((p, i) => ({
      ...p,
      position: positions[i]! as StudioVec3,
    })),
    velocities: velocities as StudioVec3[],
  };
}

export function pinStudioClothParticles(
  state: StudioClothSimState,
  indices: readonly number[],
): StudioClothSimState {
  const set = new Set(indices);
  return {
    ...state,
    particles: state.particles.map((p, i) =>
      set.has(i) ? { ...p, pinned: true, invMass: 0 } : p,
    ),
  };
}
