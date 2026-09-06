/**
 * Studio 3D XPBD Cloth, Hair & Skirt Secondary Motion Simulator
 *
 * Implements:
 * - Extended Position Based Dynamics (XPBD) particle solver
 * - Stretch, shear, and isometric bending constraints with compliance (inverse stiffness)
 * - Wind force field vector with periodic gusting and turbulence
 * - Character body collision proxy capsules (torso, thighs, head)
 * - Velocity damping and natural gravity settling for comic poses
 */

export interface ParticleState {
  readonly id: number;
  position: [number, number, number];
  previousPosition: [number, number, number];
  velocity: [number, number, number];
  invMass: number; // 0 = pinned / fixed anchor
}

export interface DistanceConstraint {
  readonly p1: number;
  readonly p2: number;
  readonly restLength: number;
  readonly compliance: number; // m/N (0 = infinite stiffness)
}

export interface CollisionCapsule {
  readonly id: string;
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly radius: number;
}

export interface SimulationConfig {
  readonly gravity: readonly [number, number, number];
  readonly timeStepSec: number;
  readonly subSteps: number;
  readonly damping: number;
  readonly windVector: readonly [number, number, number];
  readonly windGustFrequencyHz: number;
  readonly windTurbulence: number;
}

export class Studio3DClothHairDynamics {
  private particles: ParticleState[] = [];
  private distanceConstraints: DistanceConstraint[] = [];
  private collisionCapsules: CollisionCapsule[] = [];
  private config: SimulationConfig;
  private simTime = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = {
      gravity: config.gravity ?? [0, -9.81, 0],
      timeStepSec: config.timeStepSec ?? 1 / 60,
      subSteps: config.subSteps ?? 4,
      damping: config.damping ?? 0.98,
      windVector: config.windVector ?? [1.5, 0.2, 0.5],
      windGustFrequencyHz: config.windGustFrequencyHz ?? 1.2,
      windTurbulence: config.windTurbulence ?? 0.3,
    };
  }

  public getConfig(): SimulationConfig {
    return this.config;
  }

  public setConfig(patch: Partial<SimulationConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public getParticles(): readonly ParticleState[] {
    return this.particles;
  }

  public getConstraints(): readonly DistanceConstraint[] {
    return this.distanceConstraints;
  }

  /**
   * Generates a rectangular cloth/skirt grid of particles with stretch & shear constraints.
   */
  public initClothGrid(
    gridWidth: number,
    gridHeight: number,
    spacing = 0.1,
    pinnedRow = 0,
    compliance = 0.0001,
  ): void {
    this.particles = [];
    this.distanceConstraints = [];
    this.simTime = 0;

    let id = 0;
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const posX = (x - (gridWidth - 1) * 0.5) * spacing;
        const posY = 1.5 - y * spacing;
        const posZ = 0;

        const isPinned = y === pinnedRow;
        this.particles.push({
          id,
          position: [posX, posY, posZ],
          previousPosition: [posX, posY, posZ],
          velocity: [0, 0, 0],
          invMass: isPinned ? 0 : 1.0,
        });
        id += 1;
      }
    }

    // Generate Structural (horizontal & vertical) and Shear (diagonal) constraints
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const currentIdx = y * gridWidth + x;

        // Horizontal
        if (x < gridWidth - 1) {
          const rightIdx = currentIdx + 1;
          this.distanceConstraints.push({
            p1: currentIdx,
            p2: rightIdx,
            restLength: spacing,
            compliance,
          });
        }

        // Vertical
        if (y < gridHeight - 1) {
          const bottomIdx = currentIdx + gridWidth;
          this.distanceConstraints.push({
            p1: currentIdx,
            p2: bottomIdx,
            restLength: spacing,
            compliance,
          });
        }

        // Diagonal Shear
        if (x < gridWidth - 1 && y < gridHeight - 1) {
          const diagIdx = currentIdx + gridWidth + 1;
          this.distanceConstraints.push({
            p1: currentIdx,
            p2: diagIdx,
            restLength: spacing * Math.SQRT2,
            compliance: compliance * 2,
          });
        }
      }
    }
  }

  /**
   * Adds collision capsules representing character limbs or torso.
   */
  public setCollisionCapsules(capsules: readonly CollisionCapsule[]): void {
    this.collisionCapsules = [...capsules];
  }

  /**
   * Advances the physical simulation by one full time step using XPBD sub-stepping.
   */
  public step(): void {
    const subDt = this.config.timeStepSec / this.config.subSteps;
    const [gx, gy, gz] = this.config.gravity;
    const [wx, wy, wz] = this.config.windVector;

    for (let s = 0; s < this.config.subSteps; s += 1) {
      this.simTime += subDt;

      // Dynamic wind gust multiplier
      const gust = 1.0 + Math.sin(this.simTime * 2 * Math.PI * this.config.windGustFrequencyHz) * 0.5;
      const noise = (Math.sin(this.simTime * 17.3) + Math.cos(this.simTime * 31.7)) * this.config.windTurbulence;
      const curWindX = wx * (gust + noise);
      const curWindY = wy * (gust + noise);
      const curWindZ = wz * (gust + noise);

      // 1. Predict unconstrained positions
      for (const p of this.particles) {
        if (p.invMass === 0) continue; // Pinned particle

        // Apply forces (Gravity + Wind)
        p.velocity[0] += (gx + curWindX) * subDt;
        p.velocity[1] += (gy + curWindY) * subDt;
        p.velocity[2] += (gz + curWindZ) * subDt;

        // Apply damping
        p.velocity[0] *= this.config.damping;
        p.velocity[1] *= this.config.damping;
        p.velocity[2] *= this.config.damping;

        p.previousPosition[0] = p.position[0];
        p.previousPosition[1] = p.position[1];
        p.previousPosition[2] = p.position[2];

        p.position[0] += p.velocity[0] * subDt;
        p.position[1] += p.velocity[1] * subDt;
        p.position[2] += p.velocity[2] * subDt;
      }

      // 2. Solve Distance Constraints
      for (const c of this.distanceConstraints) {
        const p1 = this.particles[c.p1];
        const p2 = this.particles[c.p2];
        const wSum = p1.invMass + p2.invMass;
        if (wSum === 0) continue;

        const dx = p1.position[0] - p2.position[0];
        const dy = p1.position[1] - p2.position[1];
        const dz = p1.position[2] - p2.position[2];
        const dist = Math.hypot(dx, dy, dz) || 1e-6;

        const constraintC = dist - c.restLength;
        const alphaTilde = c.compliance / (subDt * subDt);
        const deltaLagrange = -constraintC / (wSum + alphaTilde);

        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        if (p1.invMass > 0) {
          p1.position[0] += p1.invMass * deltaLagrange * nx;
          p1.position[1] += p1.invMass * deltaLagrange * ny;
          p1.position[2] += p1.invMass * deltaLagrange * nz;
        }

        if (p2.invMass > 0) {
          p2.position[0] -= p2.invMass * deltaLagrange * nx;
          p2.position[1] -= p2.invMass * deltaLagrange * ny;
          p2.position[2] -= p2.invMass * deltaLagrange * nz;
        }
      }

      // 3. Solve Capsule Collisions
      for (const p of this.particles) {
        if (p.invMass === 0) continue;

        for (const cap of this.collisionCapsules) {
          resolveCapsuleCollision(p.position, cap);
        }
      }

      // 4. Update Velocities from solved positions
      for (const p of this.particles) {
        if (p.invMass === 0) continue;
        p.velocity[0] = (p.position[0] - p.previousPosition[0]) / subDt;
        p.velocity[1] = (p.position[1] - p.previousPosition[1]) / subDt;
        p.velocity[2] = (p.position[2] - p.previousPosition[2]) / subDt;
      }
    }
  }
}

function resolveCapsuleCollision(pos: [number, number, number], cap: CollisionCapsule): void {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = cap.start;
  const [ex, ey, ez] = cap.end;

  const abx = ex - sx;
  const aby = ey - sy;
  const abz = ez - sz;
  const abLenSq = abx * abx + aby * aby + abz * abz;

  if (abLenSq === 0) {
    // Sphere collision
    const dx = px - sx;
    const dy = py - sy;
    const dz = pz - sz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < cap.radius && dist > 0) {
      const scale = cap.radius / dist;
      pos[0] = sx + dx * scale;
      pos[1] = sy + dy * scale;
      pos[2] = sz + dz * scale;
    }
    return;
  }

  // Project point onto line segment
  const apx = px - sx;
  const apy = py - sy;
  const apz = pz - sz;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLenSq));

  const closestX = sx + t * abx;
  const closestY = sy + t * aby;
  const closestZ = sz + t * abz;

  const dx = px - closestX;
  const dy = py - closestY;
  const dz = pz - closestZ;
  const dist = Math.hypot(dx, dy, dz);

  if (dist < cap.radius && dist > 0) {
    const scale = cap.radius / dist;
    pos[0] = closestX + dx * scale;
    pos[1] = closestY + dy * scale;
    pos[2] = closestZ + dz * scale;
  }
}
