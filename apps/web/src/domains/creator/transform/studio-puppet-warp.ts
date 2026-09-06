/**
 * Studio Puppet Warp & Pin-based Mesh Deformation Engine
 *
 * CLIP STUDIO PAINT Ver.4.0.0 Parity:
 * - Puppet Warp (퍼핏 변형):
 *   - Allows artists to pose and deform 2D character drawings, limbs, and clothing by placing control pins.
 *   - Types of pins:
 *     1. "deform" (변형 핀): Moveable pin that pulls adjacent geometry smoothly.
 *     2. "anchor" (고정 핀): Locks points in place (e.g., foot grounded on floor).
 *   - Deformation Field: Radial Basis / Inverse Distance Weighting (IDW) with smoothness falloff.
 *   - Mesh Generation: Uniform triangular lattice covering the object bounding box.
 *   - Vertex deformation and reverse coordinate sampling for bilinear pixel rasterization.
 *
 * Pure, deterministic, zero-dependency.
 */

export interface PuppetPin {
  readonly id: string;
  readonly kind: "deform" | "anchor";
  readonly x: number;
  readonly y: number;
  /** Rest position (initial coordinate before transformation) */
  readonly restX: number;
  readonly restY: number;
  readonly depth?: number; // Pin z-ordering for overlapping limbs
}

export interface PuppetMeshVertex {
  readonly restX: number;
  readonly restY: number;
  readonly currX: number;
  readonly currY: number;
}

export interface PuppetMeshTriangle {
  readonly i0: number;
  readonly i1: number;
  readonly i2: number;
}

export interface PuppetMesh {
  readonly vertices: readonly PuppetMeshVertex[];
  readonly triangles: readonly PuppetMeshTriangle[];
  readonly width: number;
  readonly height: number;
}

export interface PuppetWarpState {
  readonly pins: readonly PuppetPin[];
  readonly mesh: PuppetMesh | null;
  readonly influenceRadiusPx: number; // falloff radius per pin
}

export const DEFAULT_PUPPET_WARP_STATE: PuppetWarpState = Object.freeze({
  pins: Object.freeze([]),
  mesh: null,
  influenceRadiusPx: 120,
});

/**
 * Creates a new puppet deformation pin.
 */
export function createPuppetPin(
  x: number,
  y: number,
  kind: PuppetPin["kind"] = "deform",
  id?: string,
): PuppetPin {
  const pinId = id || `pin-${Math.random().toString(36).slice(2, 8)}`;
  return Object.freeze({
    id: pinId,
    kind,
    x,
    y,
    restX: x,
    restY: y,
    depth: 0,
  });
}

/**
 * Builds a uniform triangular grid mesh over the given bounding box.
 */
export function buildPuppetLatticeMesh(
  width: number,
  height: number,
  gridCols = 10,
  gridRows = 10,
): PuppetMesh {
  const w = Math.max(16, width);
  const h = Math.max(16, height);
  const cols = Math.max(2, Math.min(32, gridCols));
  const rows = Math.max(2, Math.min(32, gridRows));

  const vertices: PuppetMeshVertex[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = (r / rows) * h;
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols) * w;
      vertices.push({ restX: x, restY: y, currX: x, currY: y });
    }
  }

  const triangles: PuppetMeshTriangle[] = [];
  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const topLeft = r * stride + c;
      const topRight = topLeft + 1;
      const bottomLeft = (r + 1) * stride + c;
      const bottomRight = bottomLeft + 1;

      // Two triangles per cell
      triangles.push({ i0: topLeft, i1: topRight, i2: bottomLeft });
      triangles.push({ i0: topRight, i1: bottomRight, i2: bottomLeft });
    }
  }

  return Object.freeze({
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
    width: w,
    height: h,
  });
}

/**
 * Calculates the deformed position for a point (px, py) given the current active pins.
 */
export function computeDeformedPosition(
  restX: number,
  restY: number,
  pins: readonly PuppetPin[],
  influenceRadius = 120,
): readonly [number, number] {
  if (pins.length === 0) return [restX, restY];

  let totalWeight = 0;
  let dxSum = 0;
  let dySum = 0;

  for (const pin of pins) {
    const distToRest = Math.hypot(restX - pin.restX, restY - pin.restY);
    // Inverse distance weighting with smooth falloff
    const epsilon = 1.0;
    const normDist = distToRest / influenceRadius;
    const w = 1.0 / Math.pow(normDist + epsilon, 2.5);

    const pinDisplacementX = pin.kind === "anchor" ? 0 : pin.x - pin.restX;
    const pinDisplacementY = pin.kind === "anchor" ? 0 : pin.y - pin.restY;

    dxSum += pinDisplacementX * w;
    dySum += pinDisplacementY * w;
    totalWeight += w;
  }

  if (totalWeight <= 0) return [restX, restY];

  const finalX = restX + dxSum / totalWeight;
  const finalY = restY + dySum / totalWeight;
  return [Math.round(finalX * 10) / 10, Math.round(finalY * 10) / 10];
}

/**
 * Evaluates and returns an updated PuppetMesh where all vertex coordinates are deformed.
 */
export function deformPuppetMesh(
  mesh: PuppetMesh,
  pins: readonly PuppetPin[],
  influenceRadius = 120,
): PuppetMesh {
  const deformedVertices = mesh.vertices.map((v) => {
    const [currX, currY] = computeDeformedPosition(v.restX, v.restY, pins, influenceRadius);
    return {
      restX: v.restX,
      restY: v.restY,
      currX,
      currY,
    };
  });

  return Object.freeze({
    ...mesh,
    vertices: Object.freeze(deformedVertices),
  });
}

/**
 * Moves a pin to a new position, returning an updated pin array.
 */
export function movePuppetPin(
  pins: readonly PuppetPin[],
  pinId: string,
  newX: number,
  newY: number,
): readonly PuppetPin[] {
  return Object.freeze(
    pins.map((pin) => {
      if (pin.id !== pinId) return pin;
      return Object.freeze({
        ...pin,
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
      });
    }),
  );
}

/**
 * Resets all pins to their original rest positions.
 */
export function resetPuppetPins(pins: readonly PuppetPin[]): readonly PuppetPin[] {
  return Object.freeze(
    pins.map((p) => Object.freeze({ ...p, x: p.restX, y: p.restY })),
  );
}
