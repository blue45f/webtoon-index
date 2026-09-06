/**
 * Deterministic CPU stable-fluid core for wet-media evaluation.
 *
 * Algorithm lineage (MIT):
 * - Jos Stam, "Stable Fluids" (advection + pressure projection)
 * - PavelDoGreat/WebGL-Fluid-Simulation (MIT) — splat, curl/vorticity, Jacobi pressure
 *   https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 *   third_party/webgl-fluid-simulation/LICENSE
 *
 * Product role:
 * - Texture-first evaluation of wet dye transport, not a silent replacement for
 *   Living Ink / wet-ink pins (hybrid-design.md §0 / §4).
 * - No WebGL dependency so unit tests and workers can exercise the same math.
 * - Inkwash (no license) is not copied; field names wet/ink/fixed are conceptual
 *   alignment only.
 */

export const STUDIO_WEBGL_STABLE_FLUID_CORE_VERSION =
  "studio-webgl-stable-fluid-core-v1" as const;

export const STUDIO_WEBGL_STABLE_FLUID_PROVENANCE = Object.freeze({
  stam: "Jos Stam Stable Fluids (academic algorithm)",
  pavelMit:
    "PavelDoGreat/WebGL-Fluid-Simulation MIT — splat/curl/vorticity/pressure structure",
  inkwashConceptOnly:
    "johnowhitaker/inkwash concepts (wet confinement, ink vs fixed) — not source-copied",
  paintWebglConceptOnly:
    "piellardj/paint-webgl ISC — flowmap-driven oriented strokes — not used in this core",
} as const);

export interface StudioStableFluidConfig {
  readonly width: number;
  readonly height: number;
  /** Jacobi iterations for pressure (Pavel default-style low tens). */
  readonly pressureIterations: number;
  readonly velocityDissipation: number;
  readonly densityDissipation: number;
  readonly vorticity: number;
  readonly dt: number;
}

export interface StudioStableFluidState {
  readonly config: StudioStableFluidConfig;
  /** Packed RG velocity, length width*height*2 */
  velocity: Float32Array;
  /** Dye density RGBA-less: single channel density for evaluation */
  density: Float32Array;
  /** Optional wet mask [0,1] — velocity damped outside wet (inkwash-inspired). */
  wet: Float32Array;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function indexOf(width: number, x: number, y: number): number {
  return y * width + x;
}

export function createStudioStableFluidState(
  config: Partial<StudioStableFluidConfig> & Pick<StudioStableFluidConfig, "width" | "height">,
): StudioStableFluidState {
  const width = Math.max(8, Math.floor(config.width));
  const height = Math.max(8, Math.floor(config.height));
  const cells = width * height;
  const full: StudioStableFluidConfig = Object.freeze({
    width,
    height,
    pressureIterations: config.pressureIterations ?? 20,
    velocityDissipation: config.velocityDissipation ?? 0.98,
    densityDissipation: config.densityDissipation ?? 0.99,
    vorticity: config.vorticity ?? 8,
    dt: config.dt ?? 0.016,
  });
  return {
    config: full,
    velocity: new Float32Array(cells * 2),
    density: new Float32Array(cells),
    wet: new Float32Array(cells).fill(1),
  };
}

/** Gaussian splat into velocity (force) and/or density (dye), Pavel-style exp falloff. */
export function splatStudioStableFluid(
  state: StudioStableFluidState,
  input: Readonly<{
    x: number;
    y: number;
    radius: number;
    velocityX?: number;
    velocityY?: number;
    density?: number;
    wet?: number;
  }>,
): void {
  const { width, height } = state.config;
  const radius = Math.max(0.5, input.radius);
  const r2 = radius * radius;
  const x0 = Math.floor(clamp(input.x - radius * 2, 0, width - 1));
  const x1 = Math.floor(clamp(input.x + radius * 2, 0, width - 1));
  const y0 = Math.floor(clamp(input.y - radius * 2, 0, height - 1));
  const y1 = Math.floor(clamp(input.y + radius * 2, 0, height - 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - input.x;
      const dy = y + 0.5 - input.y;
      const w = Math.exp(-(dx * dx + dy * dy) / Math.max(1e-6, r2));
      if (w < 1e-4) continue;
      const i = indexOf(width, x, y);
      if (input.velocityX !== undefined || input.velocityY !== undefined) {
        state.velocity[i * 2] = (state.velocity[i * 2] ?? 0)
          + (input.velocityX ?? 0) * w;
        state.velocity[i * 2 + 1] = (state.velocity[i * 2 + 1] ?? 0)
          + (input.velocityY ?? 0) * w;
      }
      if (input.density !== undefined) {
        state.density[i] = Math.min(1, (state.density[i] ?? 0) + input.density * w);
      }
      if (input.wet !== undefined) {
        state.wet[i] = Math.min(1, Math.max(state.wet[i] ?? 0, input.wet * w));
      }
    }
  }
}

function sampleVelocity(
  state: StudioStableFluidState,
  x: number,
  y: number,
): readonly [number, number] {
  const { width, height } = state.config;
  const x0 = Math.floor(clamp(x, 0, width - 1.001));
  const y0 = Math.floor(clamp(y, 0, height - 1.001));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  const i00 = indexOf(width, x0, y0) * 2;
  const i10 = indexOf(width, x1, y0) * 2;
  const i01 = indexOf(width, x0, y1) * 2;
  const i11 = indexOf(width, x1, y1) * 2;
  const vx = mix(
    mix(state.velocity[i00] ?? 0, state.velocity[i10] ?? 0, tx),
    mix(state.velocity[i01] ?? 0, state.velocity[i11] ?? 0, tx),
    ty,
  );
  const vy = mix(
    mix(state.velocity[i00 + 1] ?? 0, state.velocity[i10 + 1] ?? 0, tx),
    mix(state.velocity[i01 + 1] ?? 0, state.velocity[i11 + 1] ?? 0, tx),
    ty,
  );
  return [vx, vy];
}

function sampleScalar(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(clamp(x, 0, width - 1.001));
  const y0 = Math.floor(clamp(y, 0, height - 1.001));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  return mix(
    mix(
      field[indexOf(width, x0, y0)] ?? 0,
      field[indexOf(width, x1, y0)] ?? 0,
      tx,
    ),
    mix(
      field[indexOf(width, x0, y1)] ?? 0,
      field[indexOf(width, x1, y1)] ?? 0,
      tx,
    ),
    ty,
  );
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * One simulation step: advect velocity+density, optional vorticity, pressure project.
 * Wet mask damps velocity (inkwash-inspired confinement without copying their shaders).
 */
export function stepStudioStableFluid(state: StudioStableFluidState): void {
  const { width, height, dt, velocityDissipation, densityDissipation, vorticity, pressureIterations } =
    state.config;
  const cells = width * height;
  const nextVel = new Float32Array(cells * 2);
  const nextDen = new Float32Array(cells);

  // Self-advection of velocity + dye advection (Stam / Pavel).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = indexOf(width, x, y);
      const wet = state.wet[i] ?? 0;
      const damp = velocityDissipation * (0.15 + 0.85 * wet);
      const [vx, vy] = sampleVelocity(
        state,
        x - (state.velocity[i * 2] ?? 0) * dt,
        y - (state.velocity[i * 2 + 1] ?? 0) * dt,
      );
      nextVel[i * 2] = vx * damp;
      nextVel[i * 2 + 1] = vy * damp;
      nextDen[i] = sampleScalar(
        state.density,
        width,
        height,
        x - vx * dt,
        y - vy * dt,
      ) * densityDissipation;
    }
  }
  state.velocity.set(nextVel);
  state.density.set(nextDen);

  // Curl / vorticity confinement (Pavel vorticityProgram structure, simplified).
  if (vorticity > 0) {
    const curl = new Float32Array(cells);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const L = state.velocity[indexOf(width, x - 1, y) * 2 + 1] ?? 0;
        const R = state.velocity[indexOf(width, x + 1, y) * 2 + 1] ?? 0;
        const B = state.velocity[indexOf(width, x, y - 1) * 2] ?? 0;
        const T = state.velocity[indexOf(width, x, y + 1) * 2] ?? 0;
        curl[indexOf(width, x, y)] = 0.5 * (R - L - (T - B));
      }
    }
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = indexOf(width, x, y);
        const cL = Math.abs(curl[indexOf(width, x - 1, y)] ?? 0);
        const cR = Math.abs(curl[indexOf(width, x + 1, y)] ?? 0);
        const cB = Math.abs(curl[indexOf(width, x, y - 1)] ?? 0);
        const cT = Math.abs(curl[indexOf(width, x, y + 1)] ?? 0);
        let fx = cR - cL;
        let fy = cT - cB;
        const len = Math.hypot(fx, fy) + 1e-5;
        fx = (fx / len) * vorticity * (curl[i] ?? 0) * dt;
        fy = (fy / len) * vorticity * (curl[i] ?? 0) * dt;
        state.velocity[i * 2] = (state.velocity[i * 2] ?? 0) + fx;
        state.velocity[i * 2 + 1] = (state.velocity[i * 2 + 1] ?? 0) + fy;
      }
    }
  }

  // Divergence + Jacobi pressure (Pavel pressureShader).
  const div = new Float32Array(cells);
  const pressure = new Float32Array(cells);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const L = state.velocity[indexOf(width, x - 1, y) * 2] ?? 0;
      const R = state.velocity[indexOf(width, x + 1, y) * 2] ?? 0;
      const B = state.velocity[indexOf(width, x, y - 1) * 2 + 1] ?? 0;
      const T = state.velocity[indexOf(width, x, y + 1) * 2 + 1] ?? 0;
      div[indexOf(width, x, y)] = 0.5 * (R - L + T - B);
    }
  }
  for (let iter = 0; iter < pressureIterations; iter += 1) {
    const nextP = new Float32Array(cells);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = indexOf(width, x, y);
        const L = pressure[indexOf(width, x - 1, y)] ?? 0;
        const R = pressure[indexOf(width, x + 1, y)] ?? 0;
        const B = pressure[indexOf(width, x, y - 1)] ?? 0;
        const T = pressure[indexOf(width, x, y + 1)] ?? 0;
        nextP[i] = (L + R + B + T - (div[i] ?? 0)) * 0.25;
      }
    }
    pressure.set(nextP);
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = indexOf(width, x, y);
      const L = pressure[indexOf(width, x - 1, y)] ?? 0;
      const R = pressure[indexOf(width, x + 1, y)] ?? 0;
      const B = pressure[indexOf(width, x, y - 1)] ?? 0;
      const T = pressure[indexOf(width, x, y + 1)] ?? 0;
      state.velocity[i * 2] = (state.velocity[i * 2] ?? 0) - 0.5 * (R - L);
      state.velocity[i * 2 + 1] = (state.velocity[i * 2 + 1] ?? 0) - 0.5 * (T - B);
    }
  }

  // Slow drying of wet mask (inkwash-inspired product behaviour, not their code).
  for (let i = 0; i < cells; i += 1) {
    state.wet[i] = Math.max(0, (state.wet[i] ?? 0) * 0.997);
  }
}

export function studioStableFluidTotalDensity(
  state: StudioStableFluidState,
): number {
  let sum = 0;
  for (let i = 0; i < state.density.length; i += 1) sum += state.density[i] ?? 0;
  return sum;
}

export function studioStableFluidMaxSpeed(
  state: StudioStableFluidState,
): number {
  let max = 0;
  for (let i = 0; i < state.velocity.length; i += 2) {
    const s = Math.hypot(state.velocity[i] ?? 0, state.velocity[i + 1] ?? 0);
    if (s > max) max = s;
  }
  return max;
}
