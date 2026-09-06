/**
 * studio-3d-mesh-deformers.ts
 *
 * Spline & Cinema4D-inspired Procedural 3D Mesh Deformers Engine.
 * Modifies 3D geometry vertices non-destructively with Bend, Twist, Taper,
 * Squash & Stretch, and 3D Perlin-like Noise Displacement.
 */

export type DeformerKind =
  | "bend"
  | "twist"
  | "taper"
  | "squash-stretch"
  | "noise-displacement";

export interface MeshDeformerConfig {
  readonly kind: DeformerKind;
  readonly strength: number; // -2.0 to 2.0 or angles
  readonly axis: "x" | "y" | "z";
  readonly minBound: number; // lower limit of deformation zone (e.g. -1.0)
  readonly maxBound: number; // upper limit of deformation zone (e.g. 1.0)
  readonly noiseFrequency?: number;
  readonly noiseSpeed?: number;
}

export interface DeformedVertexResult {
  readonly originalCount: number;
  readonly deformedPositions: Float32Array;
  readonly boundingBox: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

/**
 * Applies procedural deformer calculation to a contiguous [x, y, z, x, y, z...] array
 */
export function applyMeshDeformer(
  positions: Float32Array | readonly number[],
  config: MeshDeformerConfig,
  time = 0.0,
): DeformedVertexResult {
  const count = Math.floor(positions.length / 3);
  const out = new Float32Array(positions.length);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const range = Math.max(0.001, config.maxBound - config.minBound);

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    let x = positions[idx]!;
    let y = positions[idx + 1]!;
    let z = positions[idx + 2]!;

    // Primary axis evaluation coordinate
    const primaryCoord = config.axis === "y" ? y : config.axis === "z" ? z : x;
    const normalizedH = Math.max(0, Math.min(1, (primaryCoord - config.minBound) / range));

    switch (config.kind) {
      case "bend": {
        // Bend along primary axis (e.g. bending like an arch)
        const angleRad = (config.strength * Math.PI) / 180;
        const bendFactor = normalizedH * angleRad;
        if (config.axis === "y") {
          const newX = x * Math.cos(bendFactor) - (y - config.minBound) * Math.sin(bendFactor);
          const newY = config.minBound + x * Math.sin(bendFactor) + (y - config.minBound) * Math.cos(bendFactor);
          x = newX;
          y = newY;
        } else if (config.axis === "z") {
          const newX = x * Math.cos(bendFactor) - (z - config.minBound) * Math.sin(bendFactor);
          const newZ = config.minBound + x * Math.sin(bendFactor) + (z - config.minBound) * Math.cos(bendFactor);
          x = newX;
          z = newZ;
        }
        break;
      }

      case "twist": {
        // Rotate around the selected axis progressively with height
        const twistAngle = normalizedH * (config.strength * (Math.PI / 180));
        if (config.axis === "y") {
          const newX = x * Math.cos(twistAngle) - z * Math.sin(twistAngle);
          const newZ = x * Math.sin(twistAngle) + z * Math.cos(twistAngle);
          x = newX;
          z = newZ;
        } else if (config.axis === "z") {
          const newX = x * Math.cos(twistAngle) - y * Math.sin(twistAngle);
          const newY = x * Math.sin(twistAngle) + y * Math.cos(twistAngle);
          x = newX;
          y = newY;
        } else {
          const newY = y * Math.cos(twistAngle) - z * Math.sin(twistAngle);
          const newZ = y * Math.sin(twistAngle) + z * Math.cos(twistAngle);
          y = newY;
          z = newZ;
        }
        break;
      }

      case "taper": {
        // Scale radial cross-section by taper factor
        const scaleFactor = Math.max(0.01, 1.0 + config.strength * normalizedH);
        if (config.axis === "y") {
          x *= scaleFactor;
          z *= scaleFactor;
        } else if (config.axis === "z") {
          x *= scaleFactor;
          y *= scaleFactor;
        } else {
          y *= scaleFactor;
          z *= scaleFactor;
        }
        break;
      }

      case "squash-stretch": {
        // Volume-conserving cartoon squash and stretch
        const stretch = 1.0 + config.strength;
        const squash = stretch > 0.001 ? 1.0 / Math.sqrt(stretch) : 1.0;
        if (config.axis === "y") {
          y *= stretch;
          x *= squash;
          z *= squash;
        } else if (config.axis === "z") {
          z *= stretch;
          x *= squash;
          y *= squash;
        } else {
          x *= stretch;
          y *= squash;
          z *= squash;
        }
        break;
      }

      case "noise-displacement": {
        // Organic ripple noise displacement
        const freq = config.noiseFrequency ?? 2.0;
        const speed = config.noiseSpeed ?? 1.5;
        const noiseVal = Math.sin(x * freq + time * speed) * Math.cos(y * freq + time * speed) * Math.sin(z * freq);
        const disp = noiseVal * config.strength * 0.1;
        x += disp;
        y += disp;
        z += disp;
        break;
      }
    }

    out[idx] = x;
    out[idx + 1] = y;
    out[idx + 2] = z;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    originalCount: count,
    deformedPositions: out,
    boundingBox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}
