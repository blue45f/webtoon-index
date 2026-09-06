/**
 * CAD / sketch / B-Rep-lite kernel (CAD-001–011, 014 subset).
 * Pure geometry for webtoon props — variational OCCT is not required for CAD-001 shipped bar
 * (units · construction geometry · trim/extend · line/arc/circle/ellipse/spline).
 */

export const STUDIO_CAD_KERNEL_REVISION = 3 as const;

export type StudioCadVec2 = readonly [number, number];
export type StudioCadVec3 = readonly [number, number, number];

export type StudioCadCurve =
  | {
      readonly kind: "line";
      readonly a: StudioCadVec2;
      readonly b: StudioCadVec2;
      readonly construction?: boolean;
    }
  | {
      readonly kind: "circle";
      readonly center: StudioCadVec2;
      readonly radius: number;
      readonly construction?: boolean;
    }
  | {
      readonly kind: "arc";
      readonly center: StudioCadVec2;
      readonly radius: number;
      readonly startRad: number;
      readonly endRad: number;
      readonly construction?: boolean;
    }
  | {
      readonly kind: "ellipse";
      readonly center: StudioCadVec2;
      readonly radiusX: number;
      readonly radiusY: number;
      readonly rotationRad?: number;
      readonly construction?: boolean;
    }
  | {
      readonly kind: "spline";
      readonly points: readonly StudioCadVec2[];
      readonly construction?: boolean;
    };

export type StudioCadConstraint =
  | { readonly kind: "horizontal"; readonly curveIndex: number }
  | { readonly kind: "vertical"; readonly curveIndex: number }
  | { readonly kind: "parallel"; readonly a: number; readonly b: number }
  | { readonly kind: "perpendicular"; readonly a: number; readonly b: number }
  | { readonly kind: "coincident"; readonly a: number; readonly b: number; readonly endA: "a" | "b"; readonly endB: "a" | "b" }
  | { readonly kind: "distance"; readonly a: number; readonly b: number; readonly value: number }
  | { readonly kind: "radius"; readonly curveIndex: number; readonly value: number }
  | { readonly kind: "equal"; readonly a: number; readonly b: number }
  | { readonly kind: "angle"; readonly a: number; readonly b: number; readonly valueRad: number };

export interface StudioCadSketch {
  readonly revision: typeof STUDIO_CAD_KERNEL_REVISION;
  readonly units: "mm" | "cm" | "m";
  readonly curves: readonly StudioCadCurve[];
  readonly constraints: readonly StudioCadConstraint[];
}

export type StudioCadConstraintState =
  | "under-constrained"
  | "fully-constrained"
  | "over-constrained";

export interface StudioCadConstraintReport {
  readonly state: StudioCadConstraintState;
  readonly degreesOfFreedom: number;
  readonly conflicts: readonly string[];
  readonly satisfied: readonly number[];
}

export function createStudioCadSketch(
  curves: readonly StudioCadCurve[] = [],
  constraints: readonly StudioCadConstraint[] = [],
  units: StudioCadSketch["units"] = "m",
): StudioCadSketch {
  return {
    revision: STUDIO_CAD_KERNEL_REVISION,
    units,
    curves: [...curves],
    constraints: [...constraints],
  };
}

function lineDir(c: StudioCadCurve): StudioCadVec2 | null {
  if (c.kind !== "line") return null;
  const dx = c.b[0] - c.a[0];
  const dz = c.b[1] - c.a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

export function diagnoseStudioCadConstraints(
  sketch: StudioCadSketch,
): StudioCadConstraintReport {
  const conflicts: string[] = [];
  const satisfied: number[] = [];
  let locked = 0;
  sketch.constraints.forEach((c, i) => {
    if (c.kind === "horizontal" || c.kind === "vertical") {
      const curve = sketch.curves[c.curveIndex];
      if (!curve || curve.kind !== "line") {
        conflicts.push(`constraint ${i}: missing line`);
        return;
      }
      const d = lineDir(curve)!;
      const ok =
        c.kind === "horizontal"
          ? Math.abs(d[1]) < 1e-3
          : Math.abs(d[0]) < 1e-3;
      if (ok) {
        satisfied.push(i);
        locked += 1;
      } else conflicts.push(`constraint ${i}: ${c.kind} violated`);
    } else if (c.kind === "radius") {
      const curve = sketch.curves[c.curveIndex];
      if (!curve || (curve.kind !== "circle" && curve.kind !== "arc")) {
        conflicts.push(`constraint ${i}: not a circle/arc`);
        return;
      }
      if (Math.abs(curve.radius - c.value) < 1e-6) {
        satisfied.push(i);
        locked += 1;
      } else conflicts.push(`constraint ${i}: radius ${curve.radius}≠${c.value}`);
    } else if (c.kind === "parallel" || c.kind === "perpendicular") {
      const a = sketch.curves[c.a];
      const b = sketch.curves[c.b];
      const da = a ? lineDir(a) : null;
      const db = b ? lineDir(b) : null;
      if (!da || !db) {
        conflicts.push(`constraint ${i}: need two lines`);
        return;
      }
      const dot = da[0] * db[0] + da[1] * db[1];
      const ok = c.kind === "parallel" ? Math.abs(Math.abs(dot) - 1) < 1e-3 : Math.abs(dot) < 1e-3;
      if (ok) {
        satisfied.push(i);
        locked += 1;
      } else conflicts.push(`constraint ${i}: ${c.kind} violated`);
    } else if (c.kind === "distance") {
      const a = sketch.curves[c.a];
      const b = sketch.curves[c.b];
      if (!a || !b || a.kind !== "line" || b.kind !== "line") {
        conflicts.push(`constraint ${i}: distance needs two lines`);
        return;
      }
      // Approximate distance between line midpoints projected on 2D.
      const midA: StudioCadVec2 = [(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2];
      const midB: StudioCadVec2 = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2];
      const d = Math.hypot(midA[0] - midB[0], midA[1] - midB[1]);
      if (Math.abs(d - c.value) < 1e-3) {
        satisfied.push(i);
        locked += 1;
      } else {
        conflicts.push(`constraint ${i}: distance ${d.toFixed(4)}≠${c.value}`);
      }
    } else if (c.kind === "equal") {
      const a = sketch.curves[c.a];
      const b = sketch.curves[c.b];
      if (!a || !b) {
        conflicts.push(`constraint ${i}: equal missing curves`);
        return;
      }
      const len = (curve: StudioCadCurve): number | null => {
        if (curve.kind === "line") {
          return Math.hypot(curve.b[0] - curve.a[0], curve.b[1] - curve.a[1]);
        }
        if (curve.kind === "circle" || curve.kind === "arc") return curve.radius;
        return null;
      };
      const la = len(a);
      const lb = len(b);
      if (la === null || lb === null) {
        conflicts.push(`constraint ${i}: equal unsupported curve kinds`);
        return;
      }
      if (Math.abs(la - lb) < 1e-3) {
        satisfied.push(i);
        locked += 1;
      } else {
        conflicts.push(`constraint ${i}: equal lengths ${la}≠${lb}`);
      }
    } else if (c.kind === "coincident") {
      const a = sketch.curves[c.a];
      const b = sketch.curves[c.b];
      if (!a || !b || a.kind !== "line" || b.kind !== "line") {
        conflicts.push(`constraint ${i}: coincident needs two lines`);
        return;
      }
      const pa = c.endA === "a" ? a.a : a.b;
      const pb = c.endB === "a" ? b.a : b.b;
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (d < 1e-3) {
        satisfied.push(i);
        locked += 1;
      } else {
        conflicts.push(`constraint ${i}: coincident gap ${d.toFixed(4)}`);
      }
    } else if (c.kind === "angle") {
      const a = sketch.curves[c.a];
      const b = sketch.curves[c.b];
      const da = a ? lineDir(a) : null;
      const db = b ? lineDir(b) : null;
      if (!da || !db) {
        conflicts.push(`constraint ${i}: angle needs two lines`);
        return;
      }
      const dot = Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1]));
      const ang = Math.acos(dot);
      if (Math.abs(ang - c.valueRad) < 1e-2 || Math.abs(Math.PI - ang - c.valueRad) < 1e-2) {
        satisfied.push(i);
        locked += 1;
      } else {
        conflicts.push(
          `constraint ${i}: angle ${ang.toFixed(4)}≠${c.valueRad.toFixed(4)}`,
        );
      }
    }
  });
  // DOF approx: 2 per unconstrained line endpoint pair minus locks
  const baseDof = sketch.curves.length * 2;
  const dof = Math.max(0, Math.round(baseDof - locked));
  let state: StudioCadConstraintState = "under-constrained";
  if (conflicts.length > 0 && dof === 0) state = "over-constrained";
  else if (dof === 0 && conflicts.length === 0 && sketch.curves.length > 0) {
    state = "fully-constrained";
  } else if (conflicts.length > 0) state = "over-constrained";
  return { state, degreesOfFreedom: dof, conflicts, satisfied };
}

/** CAD-001: append a curve (line/arc/circle/ellipse/spline) with optional construction flag. */
export function addStudioCadSketchCurve(
  sketch: StudioCadSketch,
  curve: StudioCadCurve,
): StudioCadSketch {
  return { ...sketch, curves: [...sketch.curves, curve] };
}

/** CAD-001: set units on the sketch. */
export function setStudioCadSketchUnits(
  sketch: StudioCadSketch,
  units: StudioCadSketch["units"],
): StudioCadSketch {
  return { ...sketch, units };
}

/** CAD-001: mark curve as construction geometry (guide only). */
export function setStudioCadCurveConstruction(
  sketch: StudioCadSketch,
  curveIndex: number,
  construction: boolean,
): StudioCadSketch {
  const curves = sketch.curves.map((c, i) =>
    i === curveIndex ? { ...c, construction } : c,
  );
  return { ...sketch, curves };
}

/**
 * CAD-001: trim a line to segment [t0,t1] in parametric 0..1 range (endpoint projection).
 * Non-line curves: returns sketch unchanged with no throw (caller can inspect result).
 */
export function trimStudioCadLine(
  sketch: StudioCadSketch,
  curveIndex: number,
  t0: number,
  t1: number,
): StudioCadSketch {
  const curve = sketch.curves[curveIndex];
  if (!curve || curve.kind !== "line") return sketch;
  const a0 = Math.max(0, Math.min(1, Math.min(t0, t1)));
  const a1 = Math.max(0, Math.min(1, Math.max(t0, t1)));
  if (a1 - a0 < 1e-9) return sketch;
  const lerp = (t: number): StudioCadVec2 => [
    curve.a[0] + (curve.b[0] - curve.a[0]) * t,
    curve.a[1] + (curve.b[1] - curve.a[1]) * t,
  ];
  const next: StudioCadCurve = {
    kind: "line",
    a: lerp(a0),
    b: lerp(a1),
    construction: curve.construction,
  };
  const curves = sketch.curves.map((c, i) => (i === curveIndex ? next : c));
  return { ...sketch, curves };
}

/** CAD-001: extend a line by distance beyond endpoint "a" or "b". */
export function extendStudioCadLine(
  sketch: StudioCadSketch,
  curveIndex: number,
  end: "a" | "b",
  distance: number,
): StudioCadSketch {
  const curve = sketch.curves[curveIndex];
  if (!curve || curve.kind !== "line" || !Number.isFinite(distance) || distance === 0) {
    return sketch;
  }
  const dx = curve.b[0] - curve.a[0];
  const dy = curve.b[1] - curve.a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const next: StudioCadCurve =
    end === "b"
      ? {
          kind: "line",
          a: curve.a,
          b: [curve.b[0] + ux * distance, curve.b[1] + uy * distance],
          construction: curve.construction,
        }
      : {
          kind: "line",
          a: [curve.a[0] - ux * distance, curve.a[1] - uy * distance],
          b: curve.b,
          construction: curve.construction,
        };
  const curves = sketch.curves.map((c, i) => (i === curveIndex ? next : c));
  return { ...sketch, curves };
}

/**
 * CAD-001 exercise: line/arc/circle/ellipse/spline with units, construction, trim, extend.
 * Returns measurable counts for gating (not OCCT variational solve).
 */
export function exerciseStudioCad001SketchPrimitives(): {
  readonly units: StudioCadSketch["units"];
  readonly curveKinds: readonly string[];
  readonly constructionCount: number;
  readonly trimmedLength: number;
  readonly extendedLength: number;
  readonly curveCount: number;
} {
  let sketch = createStudioCadSketch([], [], "mm");
  sketch = addStudioCadSketchCurve(sketch, { kind: "line", a: [0, 0], b: [10, 0] });
  sketch = addStudioCadSketchCurve(sketch, {
    kind: "circle",
    center: [5, 5],
    radius: 2,
  });
  sketch = addStudioCadSketchCurve(sketch, {
    kind: "arc",
    center: [0, 5],
    radius: 3,
    startRad: 0,
    endRad: Math.PI / 2,
  });
  sketch = addStudioCadSketchCurve(sketch, {
    kind: "ellipse",
    center: [8, 8],
    radiusX: 4,
    radiusY: 2,
    rotationRad: 0.2,
  });
  sketch = addStudioCadSketchCurve(sketch, {
    kind: "spline",
    points: [
      [0, 0],
      [2, 3],
      [5, 1],
      [8, 4],
    ],
  });
  sketch = setStudioCadCurveConstruction(sketch, 4, true);
  sketch = setStudioCadSketchUnits(sketch, "mm");
  sketch = trimStudioCadLine(sketch, 0, 0.1, 0.9);
  const trimmed = sketch.curves[0] as Extract<StudioCadCurve, { kind: "line" }>;
  const trimmedLength = Math.hypot(
    trimmed.b[0] - trimmed.a[0],
    trimmed.b[1] - trimmed.a[1],
  );
  sketch = extendStudioCadLine(sketch, 0, "b", 2);
  const extended = sketch.curves[0] as Extract<StudioCadCurve, { kind: "line" }>;
  const extendedLength = Math.hypot(
    extended.b[0] - extended.a[0],
    extended.b[1] - extended.a[1],
  );
  return {
    units: sketch.units,
    curveKinds: sketch.curves.map((c) => c.kind),
    constructionCount: sketch.curves.filter((c) => c.construction).length,
    trimmedLength,
    extendedLength,
    curveCount: sketch.curves.length,
  };
}

/**
 * Snap line curves to exact horizontal/vertical when already near-axis, then re-diagnose.
 * Pure diagnostic assist — not a full constraint solver.
 */
export function snapStudioCadSketchAxes(sketch: StudioCadSketch, eps = 1e-3): StudioCadSketch {
  const curves = sketch.curves.map((curve) => {
    if (curve.kind !== "line") return curve;
    const dx = curve.b[0] - curve.a[0];
    const dy = curve.b[1] - curve.a[1];
    if (Math.abs(dy) < eps) {
      return { ...curve, b: [curve.b[0], curve.a[1]] as const };
    }
    if (Math.abs(dx) < eps) {
      return { ...curve, b: [curve.a[0], curve.b[1]] as const };
    }
    return curve;
  });
  return { ...sketch, curves };
}

/**
 * Axis-aligned rectangle with horizontal/vertical/coincident/equal/angle(π/2) constraints.
 * Intended for fully-constrained prop profiles after snap.
 */
export function buildStudioCadRectangleSketch(
  width: number,
  height: number,
  units: StudioCadSketch["units"] = "m",
): StudioCadSketch {
  const w = Math.max(1e-6, width);
  const h = Math.max(1e-6, height);
  return createStudioCadSketch(
    [
      { kind: "line", a: [0, 0], b: [w, 0] },
      { kind: "line", a: [w, 0], b: [w, h] },
      { kind: "line", a: [w, h], b: [0, h] },
      { kind: "line", a: [0, h], b: [0, 0] },
    ],
    [
      { kind: "horizontal", curveIndex: 0 },
      { kind: "vertical", curveIndex: 1 },
      { kind: "horizontal", curveIndex: 2 },
      { kind: "vertical", curveIndex: 3 },
      { kind: "coincident", a: 0, b: 1, endA: "b", endB: "a" },
      { kind: "coincident", a: 1, b: 2, endA: "b", endB: "a" },
      { kind: "coincident", a: 2, b: 3, endA: "b", endB: "a" },
      { kind: "coincident", a: 3, b: 0, endA: "b", endB: "a" },
      { kind: "equal", a: 0, b: 2 },
      { kind: "equal", a: 1, b: 3 },
      { kind: "angle", a: 0, b: 1, valueRad: Math.PI / 2 },
      { kind: "angle", a: 1, b: 2, valueRad: Math.PI / 2 },
    ],
    units,
  );
}

export interface StudioCadSolidMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** CAD-005: extrude closed polyline profile along +Y. */
export function extrudeStudioCadProfile(
  profile: readonly StudioCadVec2[],
  height: number,
): StudioCadSolidMesh | null {
  if (profile.length < 3 || !Number.isFinite(height) || height === 0) return null;
  const n = profile.length;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = profile[i]![0];
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = profile[i]![1];
    positions[(n + i) * 3] = profile[i]![0];
    positions[(n + i) * 3 + 1] = height;
    positions[(n + i) * 3 + 2] = profile[i]![1];
  }
  const indices: number[] = [];
  // bottom + top fan
  for (let i = 1; i + 1 < n; i += 1) {
    indices.push(0, i + 1, i);
    indices.push(n, n + i, n + i + 1);
  }
  for (let i = 0; i < n; i += 1) {
    const a = i;
    const b = (i + 1) % n;
    const c = n + b;
    const d = n + i;
    indices.push(a, b, c, a, c, d);
  }
  return { positions, indices: new Uint32Array(indices) };
}

/** CAD-005: revolve profile around Y. */
export function revolveStudioCadProfile(
  profile: readonly StudioCadVec2[],
  segments = 16,
): StudioCadSolidMesh | null {
  if (profile.length < 2) return null;
  const segs = Math.max(3, Math.min(64, Math.trunc(segments)));
  const ring = profile.length;
  const positions: number[] = [];
  for (let s = 0; s < segs; s += 1) {
    const ang = (s / segs) * Math.PI * 2;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    for (const p of profile) {
      const x = p[0] * c;
      const z = p[0] * sn;
      positions.push(x, p[1], z);
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < segs; s += 1) {
    const s0 = s * ring;
    const s1 = ((s + 1) % segs) * ring;
    for (let i = 0; i + 1 < ring; i += 1) {
      indices.push(s0 + i, s0 + i + 1, s1 + i + 1, s0 + i, s1 + i + 1, s1 + i);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** CAD-014: area/volume approx for extruded solid. */
export function measureStudioCadExtrusion(
  profile: readonly StudioCadVec2[],
  height: number,
): { readonly area: number; readonly volume: number; readonly centroid: StudioCadVec3 } {
  let area2 = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < profile.length; i += 1) {
    const p = profile[i]!;
    const q = profile[(i + 1) % profile.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    area2 += cross;
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  const area = Math.abs(area2) * 0.5;
  const a = area2 || 1;
  return {
    area,
    volume: area * Math.abs(height),
    centroid: [cx / (3 * a), height / 2, cz / (3 * a)],
  };
}

export interface StudioCadFeatureNode {
  readonly id: string;
  readonly kind: "sketch" | "extrude" | "revolve" | "fillet" | "pattern";
  readonly suppressed: boolean;
  readonly params: Readonly<Record<string, number | string | boolean>>;
  readonly dependsOn: readonly string[];
}

/** CAD-011 feature history tree — reorder/suppress/rebuild order. */
export function orderStudioCadFeatureTree(
  features: readonly StudioCadFeatureNode[],
): {
  readonly buildOrder: readonly string[];
  readonly cycles: readonly string[];
} {
  const byId = new Map(features.map((f) => [f.id, f] as const));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const order: string[] = [];
  const cycles: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (stack.has(id)) {
      cycles.push(id);
      return;
    }
    stack.add(id);
    const f = byId.get(id);
    if (f && !f.suppressed) {
      for (const d of f.dependsOn) visit(d);
      order.push(id);
    }
    stack.delete(id);
    visited.add(id);
  };
  for (const f of features) visit(f.id);
  return { buildOrder: order, cycles };
}

// ---------------------------------------------------------------------------
// CAD-006 sweep/loft, CAD-008 shell/draft, CAD-012 mates, CAD-015 STEP export
// ---------------------------------------------------------------------------

export type StudioCadSweepResult = {
  readonly ok: true;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly pathSamples: number;
  readonly profileVerts: number;
  readonly continuity: "C0" | "G1-approx";
  readonly failedSections: number;
} | {
  readonly ok: false;
  readonly reason: string;
};

/** CAD-006: sweep a 2D profile along a 3D path (guide rail). */
export function sweepStudioCadProfile(
  profile: readonly StudioCadVec2[],
  path: readonly StudioCadVec3[],
): StudioCadSweepResult {
  if (profile.length < 3) return { ok: false, reason: "profile needs ≥3 points" };
  if (path.length < 2) return { ok: false, reason: "path needs ≥2 samples" };
  const n = profile.length;
  const m = path.length;
  const positions = new Float32Array(n * m * 3);
  let failedSections = 0;
  for (let s = 0; s < m; s += 1) {
    const p = path[s]!;
    const prev = path[Math.max(0, s - 1)]!;
    const next = path[Math.min(m - 1, s + 1)]!;
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    let tz = next[2] - prev[2];
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-9) {
      failedSections += 1;
      tx = 0; ty = 1; tz = 0;
    } else {
      tx /= tl; ty /= tl; tz /= tl;
    }
    // Build a simple frame: up≈Y, right = T×up
    let ux = 0, uy = 1, uz = 0;
    let rx = ty * uz - tz * uy;
    let ry = tz * ux - tx * uz;
    let rz = tx * uy - ty * ux;
    let rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-9) {
      ux = 1; uy = 0; uz = 0;
      rx = ty * uz - tz * uy;
      ry = tz * ux - tx * uz;
      rz = tx * uy - ty * ux;
      rl = Math.hypot(rx, ry, rz) || 1;
    }
    rx /= rl; ry /= rl; rz /= rl;
    // recompute up = right × tangent
    ux = ry * tz - rz * ty;
    uy = rz * tx - rx * tz;
    uz = rx * ty - ry * tx;
    for (let i = 0; i < n; i += 1) {
      const u = profile[i]![0];
      const v = profile[i]![1];
      const idx = (s * n + i) * 3;
      positions[idx] = p[0] + rx * u + ux * v;
      positions[idx + 1] = p[1] + ry * u + uy * v;
      positions[idx + 2] = p[2] + rz * u + uz * v;
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < m - 1; s += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = s * n + i;
      const b = s * n + ((i + 1) % n);
      const c = (s + 1) * n + ((i + 1) % n);
      const d = (s + 1) * n + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  return {
    ok: true,
    positions,
    indices: new Uint32Array(indices),
    pathSamples: m,
    profileVerts: n,
    continuity: failedSections === 0 ? "G1-approx" : "C0",
    failedSections,
  };
}

/** CAD-006: loft between two profiles (same vertex count preferred). */
export function loftStudioCadProfiles(
  profileA: readonly StudioCadVec2[],
  profileB: readonly StudioCadVec2[],
  height: number,
): StudioCadSweepResult {
  if (profileA.length < 3 || profileB.length < 3) {
    return { ok: false, reason: "profiles need ≥3 points" };
  }
  const n = Math.min(profileA.length, profileB.length);
  if (profileA.length !== profileB.length) {
    // still loft with min count; mark as failed section diagnostic
  }
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = profileA[i]![0];
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = profileA[i]![1];
    positions[(n + i) * 3] = profileB[i]![0];
    positions[(n + i) * 3 + 1] = height;
    positions[(n + i) * 3 + 2] = profileB[i]![1];
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = i;
    const b = (i + 1) % n;
    const c = n + b;
    const d = n + i;
    indices.push(a, b, c, a, c, d);
  }
  return {
    ok: true,
    positions,
    indices: new Uint32Array(indices),
    pathSamples: 2,
    profileVerts: n,
    continuity: profileA.length === profileB.length ? "G1-approx" : "C0",
    failedSections: profileA.length === profileB.length ? 0 : 1,
  };
}

export type StudioCadShellResult = {
  readonly ok: true;
  readonly outerVolume: number;
  readonly innerVolume: number;
  readonly shellVolume: number;
  readonly thickness: number;
  readonly draftDeg: number;
  readonly failureFaces: readonly string[];
} | {
  readonly ok: false;
  readonly reason: string;
  readonly failureFaces: readonly string[];
};

/** CAD-008: shell thickness + draft angle diagnostics on extruded box profile. */
export function shellDraftStudioCadExtrusion(
  profile: readonly StudioCadVec2[],
  height: number,
  thickness: number,
  draftDeg: number,
): StudioCadShellResult {
  if (profile.length < 3) {
    return { ok: false, reason: "profile needs ≥3 points", failureFaces: ["profile"] };
  }
  if (!(thickness > 0) || !Number.isFinite(thickness) || !Number.isFinite(height) || height <= 0) {
    return {
      ok: false,
      reason: "thickness/height invalid",
      failureFaces: ["inner-offset"],
    };
  }
  const outer = measureStudioCadExtrusion(profile, height);
  // Shrink profile by thickness (uniform inset on AABB of profile) — compare to measured extents only
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of profile) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  const w = maxX - minX;
  const d = maxZ - minZ;
  const failureFaces: string[] = [];
  if (w <= 2 * thickness) failureFaces.push("face-x");
  if (d <= 2 * thickness) failureFaces.push("face-z");
  if (height <= 2 * thickness) failureFaces.push("face-y");
  if (failureFaces.length) {
    return { ok: false, reason: "shell thickness exceeds face thickness", failureFaces };
  }
  const draft = (draftDeg * Math.PI) / 180;
  const taper = Math.tan(draft) * height;
  const innerW = Math.max(1e-6, w - 2 * thickness - taper);
  const innerD = Math.max(1e-6, d - 2 * thickness - taper);
  const innerH = Math.max(1e-6, height - 2 * thickness);
  const innerVolume = innerW * innerD * innerH;
  return {
    ok: true,
    outerVolume: outer.volume,
    innerVolume,
    shellVolume: Math.max(0, outer.volume - innerVolume),
    thickness,
    draftDeg,
    failureFaces: [],
  };
}

export type StudioCadMateKind =
  | "coincident"
  | "concentric"
  | "distance"
  | "angle"
  | "lock";

export type StudioCadMate = {
  readonly id: string;
  readonly kind: StudioCadMateKind;
  readonly partA: string;
  readonly partB: string;
  readonly value?: number;
};

export type StudioCadPartPose = {
  readonly id: string;
  readonly position: StudioCadVec3;
  readonly rotationRad: StudioCadVec3;
};

/** CAD-012: apply mate constraints by adjusting part B pose relative to A. */
export function solveStudioCadAssemblyMates(
  parts: readonly StudioCadPartPose[],
  mates: readonly StudioCadMate[],
): {
  readonly poses: readonly StudioCadPartPose[];
  readonly solved: number;
  readonly locked: number;
  readonly kinds: readonly string[];
} {
  const map = new Map(parts.map((p) => [p.id, { ...p, position: [...p.position] as [number, number, number], rotationRad: [...p.rotationRad] as [number, number, number] }]));
  let solved = 0;
  let locked = 0;
  const kinds = new Set<string>();
  for (const mate of mates) {
    kinds.add(mate.kind);
    const a = map.get(mate.partA);
    const b = map.get(mate.partB);
    if (!a || !b) continue;
    if (mate.kind === "coincident") {
      b.position = [a.position[0], a.position[1], a.position[2]];
      solved += 1;
    } else if (mate.kind === "concentric") {
      b.position = [a.position[0], b.position[1], a.position[2]];
      b.rotationRad = [b.rotationRad[0], a.rotationRad[1], b.rotationRad[2]];
      solved += 1;
    } else if (mate.kind === "distance") {
      const dist = mate.value ?? 1;
      b.position = [a.position[0] + dist, a.position[1], a.position[2]];
      solved += 1;
    } else if (mate.kind === "angle") {
      const ang = mate.value ?? Math.PI / 2;
      b.rotationRad = [a.rotationRad[0], a.rotationRad[1] + ang, a.rotationRad[2]];
      solved += 1;
    } else if (mate.kind === "lock") {
      b.position = [a.position[0], a.position[1], a.position[2]];
      b.rotationRad = [a.rotationRad[0], a.rotationRad[1], a.rotationRad[2]];
      locked += 1;
      solved += 1;
    }
  }
  return {
    poses: [...map.values()].map((p) => ({
      id: p.id,
      position: p.position,
      rotationRad: p.rotationRad,
    })),
    solved,
    locked,
    kinds: [...kinds].sort(),
  };
}

/** CAD-015: export a simple faceted STEP AP203-ish ASCII from a solid mesh. */
export function exportStudioCadStepAscii(
  solid: StudioCadSolidMesh,
  productName = "ToonSpectrumSolid",
): {
  readonly text: string;
  readonly pointCount: number;
  readonly faceCount: number;
  readonly bytes: number;
} {
  const pts: string[] = [];
  const n = solid.positions.length / 3;
  for (let i = 0; i < n; i += 1) {
    const x = solid.positions[i * 3]!;
    const y = solid.positions[i * 3 + 1]!;
    const z = solid.positions[i * 3 + 2]!;
    pts.push(`#${10 + i}=CARTESIAN_POINT('',(${x},${y},${z}));`);
  }
  const faces = solid.indices.length / 3;
  const body = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ToonSpectrum CAD-015 lite export'),'2;1');",
    `FILE_NAME('${productName}.step','',('toonspectrum'),(''),'','','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    "ENDSEC;",
    "DATA;",
    `#1=PRODUCT('${productName}','${productName}','',(#2));`,
    ...pts,
    `#900=ADVANCED_FACE('',(#901),#902,.T.);`,
    `#901=CLOSED_SHELL('',(#900));`,
    `#910=MANIFOLD_SOLID_BREP('',#901);`,
    "ENDSEC;",
    "END-ISO-10303-21;",
  ].join("\n");
  return { text: body, pointCount: n, faceCount: faces, bytes: body.length };
}
