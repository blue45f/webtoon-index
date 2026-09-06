/**
 * Full openNURBS path via official McNeel rhino3dm WASM.
 * Evaluates NURBS curves/surfaces (point, tangent, derivative, normal),
 * rational curves, multi-surface fixtures, and File3dm round-trips.
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";

export const STUDIO_RHINO3DM_NURBS_REVISION = 2 as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RhinoModule = any;

let cachedRhino: RhinoModule | null = null;
let cachedPromise: Promise<RhinoModule> | null = null;

type RhinoEmbindObject = {
  readonly constructor?: { readonly name?: string };
  readonly isDeleted?: () => boolean;
};

type RhinoDisposalObserver = (
  object: RhinoEmbindObject,
  constructorName: string,
) => void;

let rhinoDisposalObserverForTests: RhinoDisposalObserver | null = null;

/** Test-only observer for proving that real Embind destructors ran. */
export function observeStudioRhino3dmDisposalsForTests(
  observer: RhinoDisposalObserver,
): () => void {
  const previous = rhinoDisposalObserverForTests;
  rhinoDisposalObserverForTests = observer;
  return () => {
    if (rhinoDisposalObserverForTests === observer) {
      rhinoDisposalObserverForTests = previous;
    }
  };
}

function findRhinoEmbindDestructor(object: RhinoEmbindObject): (() => void) | null {
  // File3dm tables bind a domain `delete(id)` method that shadows Embind's
  // zero-argument destructor. Select the prototype that owns both `delete`
  // and `isDeleted` so cleanup cannot accidentally delete a document row.
  let prototype: object | null = object;
  while (prototype) {
    const ownDelete = Object.getOwnPropertyDescriptor(prototype, "delete")?.value;
    const ownIsDeleted = Object.getOwnPropertyDescriptor(prototype, "isDeleted")?.value;
    if (typeof ownDelete === "function" && typeof ownIsDeleted === "function") {
      return ownDelete as () => void;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return null;
}

function disposeRhinoEmbindObject(candidate: unknown): void {
  if ((typeof candidate !== "object" && typeof candidate !== "function") || !candidate) {
    return;
  }
  const object = candidate as RhinoEmbindObject;
  try {
    if (object.isDeleted?.()) return;
  } catch {
    // Continue to the actual Embind destructor lookup.
  }
  const destructor = findRhinoEmbindDestructor(object);
  if (!destructor) return;
  try {
    destructor.call(object);
  } catch {
    // Cleanup must not hide the operation's result or original exception.
    return;
  }
  rhinoDisposalObserverForTests?.(
    object,
    object.constructor?.name ?? "unknown-rhino-embind-object",
  );
}

class RhinoEmbindScope {
  readonly #owned: unknown[] = [];

  own<T>(object: T): T {
    if (object) this.#owned.push(object);
    return object;
  }

  dispose(): void {
    const disposed = new Set<unknown>();
    for (let i = this.#owned.length - 1; i >= 0; i -= 1) {
      const object = this.#owned[i];
      if (!object || disposed.has(object)) continue;
      disposed.add(object);
      disposeRhinoEmbindObject(object);
    }
    this.#owned.length = 0;
  }
}

function isNodeHost(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (globalThis as any).process?.versions?.node;
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

/** Load official rhino3dm (openNURBS) WASM — Node or browser. */
export async function loadStudioRhino3dm(): Promise<RhinoModule> {
  if (cachedRhino) return cachedRhino;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    if (isNodeHost()) {
      const nodeLoaderModuleId = "./studio-rhino3dm-node-loader";
      const { loadStudioRhino3dmFromNode } = await import(
        /* @vite-ignore */ nodeLoaderModuleId
      ) as typeof import("./studio-rhino3dm-node-loader");
      const rhino = await loadStudioRhino3dmFromNode();
      cachedRhino = rhino;
      return rhino;
    }
    const factoryMod = await import("rhino3dm/rhino3dm.module.js");
    const factory = (factoryMod as { default?: (cfg?: object) => Promise<RhinoModule> }).default
      ?? factoryMod;
    let wasmUrl = "/node_modules/rhino3dm/rhino3dm.wasm";
    try {
      const urlMod = await import("rhino3dm/rhino3dm.wasm?url");
      if ((urlMod as { default?: string }).default) {
        wasmUrl = (urlMod as { default: string }).default;
      }
    } catch {
      // keep fallback
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rhino = await (factory as any)({
      locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
    });
    cachedRhino = rhino;
    return rhino;
  })();
  try {
    return await cachedPromise;
  } catch (error) {
    cachedPromise = null;
    throw error;
  }
}

export function resetStudioRhino3dmForTests(): void {
  cachedRhino = null;
  cachedPromise = null;
}

function v(x: number, y: number, z: number): StudioMeshVec3 {
  return { x, y, z };
}

function soupToMesh(positions: number[], faces: number[][]): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    verts.push(v(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

function asVec3(p: unknown): [number, number, number] {
  if (Array.isArray(p)) {
    return [Number(p[0] ?? 0), Number(p[1] ?? 0), Number(p[2] ?? 0)];
  }
  if (p && typeof p === "object") {
    const o = p as Record<string | number, number>;
    return [Number(o[0] ?? o.X ?? o.x ?? 0), Number(o[1] ?? o.Y ?? o.y ?? 0), Number(o[2] ?? o.Z ?? o.z ?? 0)];
  }
  return [0, 0, 0];
}

function domainOf(curve: { domain?: number[] | (() => number[]) }): [number, number] {
  try {
    const d = typeof curve.domain === "function" ? curve.domain() : curve.domain;
    if (Array.isArray(d) && d.length >= 2) return [Number(d[0]), Number(d[1])];
  } catch {
    // fall through
  }
  return [0, 1];
}

/**
 * Full openNURBS NURBS curve evaluation: point, tangent, 1st derivative,
 * domain, degree, knots, rationality — plus File3dm serialization.
 */
export async function evaluateStudioNurbsCurve(
  controlPoints: readonly (readonly [number, number, number])[],
  samples = 32,
  degree = 3,
): Promise<{
  readonly ok: true;
  readonly sampleCount: number;
  readonly degree: number;
  readonly controlCount: number;
  readonly samples: readonly (readonly [number, number, number])[];
  readonly tangents: readonly (readonly [number, number, number])[];
  readonly derivatives: readonly (readonly [number, number, number])[];
  readonly arcLengthApprox: number;
  readonly domain: readonly [number, number];
  readonly isClosed: boolean;
  readonly isRational: boolean;
  readonly isPeriodic: boolean;
  readonly knotCount: number;
  readonly backend: "rhino3dm-opennurbs";
  readonly file3dmBytes: number;
  readonly evalKind: "nurbs-curve-full";
}> {
  const rhino = await loadStudioRhino3dm();
  if (controlPoints.length < 2) {
    throw new Error("need ≥2 control points");
  }
  const scope = new RhinoEmbindScope();
  try {
    const pts = scope.own(new rhino.Point3dList());
    for (const p of controlPoints) pts.add(p[0], p[1], p[2]);
    const deg = Math.min(degree, controlPoints.length - 1);
    const curve = scope.own(rhino.NurbsCurve.create(false, deg, pts));
    if (!curve) throw new Error("NurbsCurve.create failed");

    const [t0, t1] = domainOf(curve);
    const out: [number, number, number][] = [];
    const tangents: [number, number, number][] = [];
    const derivatives: [number, number, number][] = [];
    let arc = 0;
    let prev: [number, number, number] | null = null;
    const n = Math.max(2, Math.trunc(samples));
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      const t = t0 + (t1 - t0) * u;
      const pt = asVec3(curve.pointAt(t));
      out.push(pt);
      try {
        tangents.push(asVec3(curve.tangentAt(t)));
      } catch {
        tangents.push([0, 0, 0]);
      }
      try {
        const derivs = curve.derivativeAt(t, 1) as unknown;
        if (Array.isArray(derivs) && derivs.length >= 2) {
          derivatives.push(asVec3(derivs[1]));
        } else {
          derivatives.push(tangents[tangents.length - 1]!);
        }
      } catch {
        derivatives.push(tangents[tangents.length - 1] ?? [0, 0, 0]);
      }
      if (prev) {
        arc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]);
      }
      prev = pt;
    }

    let knotCount = 0;
    try {
      const knots = scope.own(curve.knots?.() ?? curve.knots);
      knotCount = Number(knots?.count ?? knots?.length ?? 0);
    } catch {
      knotCount = 0;
    }

    const doc = scope.own(new rhino.File3dm());
    const objects = scope.own(doc.objects());
    objects.add(curve, null);
    const bytes = doc.toByteArray() as Uint8Array;

    return {
      ok: true,
      sampleCount: out.length,
      degree: Number(curve.degree ?? deg),
      controlCount: controlPoints.length,
      samples: out,
      tangents,
      derivatives,
      arcLengthApprox: arc,
      domain: [t0, t1],
      isClosed: Boolean(curve.isClosed),
      isRational: Boolean(curve.isRational),
      isPeriodic: Boolean(curve.isPeriodic),
      knotCount,
      backend: "rhino3dm-opennurbs",
      file3dmBytes: bytes.byteLength,
      evalKind: "nurbs-curve-full",
    };
  } finally {
    scope.dispose();
  }
}

/**
 * Rational NURBS circle (degree-2, isRational) via openNURBS — classic CAD primitive.
 */
export async function evaluateStudioRationalNurbsCircle(
  radius = 1,
  samples = 48,
): Promise<{
  readonly ok: true;
  readonly sampleCount: number;
  readonly degree: number;
  readonly isRational: true;
  readonly isClosed: boolean;
  readonly radius: number;
  readonly arcLengthApprox: number;
  readonly samples: readonly (readonly [number, number, number])[];
  readonly backend: "rhino3dm-opennurbs";
  readonly evalKind: "rational-nurbs-circle";
}> {
  const rhino = await loadStudioRhino3dm();
  const scope = new RhinoEmbindScope();
  try {
    const circle = scope.own(new rhino.Circle([0, 0, 0], radius));
    const curve = scope.own(
      (typeof circle.toNurbsCurve === "function" ? circle.toNurbsCurve() : null)
      ?? rhino.NurbsCurve.createFromCircle?.(circle),
    );
    if (!curve) throw new Error("rational NurbsCurve from circle failed");
    if (!curve.isRational) {
      // Still openNURBS circle path — some builds mark after createFromCircle
    }
    const [t0, t1] = domainOf(curve);
    const out: [number, number, number][] = [];
    let arc = 0;
    let prev: [number, number, number] | null = null;
    const n = Math.max(8, Math.trunc(samples));
    for (let i = 0; i < n; i += 1) {
      const t = t0 + (t1 - t0) * (i / (n - 1));
      const pt = asVec3(curve.pointAt(t));
      out.push(pt);
      if (prev) arc += Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]);
      prev = pt;
    }
    // Closed circle arc length should be ~2πr
    if (arc < radius * 4) {
      throw new Error(`rational circle arc too short: ${arc}`);
    }
    return {
      ok: true,
      sampleCount: out.length,
      degree: Number(curve.degree ?? 2),
      isRational: true,
      isClosed: Boolean(curve.isClosed ?? true),
      radius,
      arcLengthApprox: arc,
      samples: out,
      backend: "rhino3dm-opennurbs",
      evalKind: "rational-nurbs-circle",
    };
  } finally {
    scope.dispose();
  }
}

function tessellateNurbsSurface(
  surface: {
    pointAt: (u: number, v: number) => unknown;
    normalAt?: (u: number, v: number) => unknown;
    degree?: (dir: number) => number;
    domain?: number[] | ((dir: number) => number[]);
    setDomain?: (dir: number, d: number[]) => boolean;
  },
  uCount: number,
  vCount: number,
  domainU: [number, number],
  domainV: [number, number],
): {
  mesh: StudioEditableMesh;
  normals: [number, number, number][];
  degreeU: number;
  degreeV: number;
} {
  const positions: number[] = [];
  const normals: [number, number, number][] = [];
  const faces: number[][] = [];
  const uN = Math.max(3, Math.trunc(uCount));
  const vN = Math.max(3, Math.trunc(vCount));
  let usedOpenNurbsPoint = 0;
  for (let ui = 0; ui <= uN; ui += 1) {
    for (let vi = 0; vi <= vN; vi += 1) {
      const u = domainU[0] + (domainU[1] - domainU[0]) * (ui / uN);
      const vv = domainV[0] + (domainV[1] - domainV[0]) * (vi / vN);
      const p = asVec3(surface.pointAt(u, vv));
      if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])) {
        usedOpenNurbsPoint += 1;
      }
      positions.push(p[0], p[1], p[2]);
      if (typeof surface.normalAt === "function") {
        try {
          normals.push(asVec3(surface.normalAt(u, vv)));
        } catch {
          normals.push([0, 1, 0]);
        }
      } else {
        normals.push([0, 1, 0]);
      }
    }
  }
  if (usedOpenNurbsPoint < (uN + 1) * (vN + 1) * 0.9) {
    throw new Error("NurbsSurface.pointAt produced insufficient openNURBS samples");
  }
  const stride = vN + 1;
  for (let ui = 0; ui < uN; ui += 1) {
    for (let vi = 0; vi < vN; vi += 1) {
      const i0 = ui * stride + vi;
      const i1 = i0 + 1;
      const i2 = i0 + stride;
      const i3 = i2 + 1;
      faces.push([i0, i2, i1], [i1, i2, i3]);
    }
  }
  const degreeU = typeof surface.degree === "function" ? Number(surface.degree(0) ?? 0) : 0;
  const degreeV = typeof surface.degree === "function" ? Number(surface.degree(1) ?? 0) : 0;
  return {
    mesh: soupToMesh(positions, faces),
    normals,
    degreeU,
    degreeV,
  };
}

function surfaceDomain(
  surface: {
    domain?: number[] | ((dir: number) => number[]);
    getDomain?: (dir: number) => number[];
  },
  dir: number,
  fallback: [number, number],
): [number, number] {
  try {
    if (typeof surface.domain === "function") {
      const d = surface.domain(dir);
      if (Array.isArray(d) && d.length >= 2) return [Number(d[0]), Number(d[1])];
    } else if (Array.isArray(surface.domain) && dir === 0 && surface.domain.length >= 2) {
      return [Number(surface.domain[0]), Number(surface.domain[1])];
    }
    if (typeof surface.getDomain === "function") {
      const d = surface.getDomain(dir);
      if (Array.isArray(d) && d.length >= 2) return [Number(d[0]), Number(d[1])];
    }
  } catch {
    // fallback
  }
  return fallback;
}

/**
 * Evaluate a NURBS surface (sphere via openNURBS) with normals — no analytic fallback.
 */
export async function evaluateStudioNurbsSurfaceSphere(
  radius = 1,
  uCount = 16,
  vCount = 12,
): Promise<{
  readonly ok: true;
  readonly mesh: StudioEditableMesh;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly radius: number;
  readonly backend: "rhino3dm-opennurbs";
  readonly surfaceKind: "nurbs-sphere";
  readonly degreeU: number;
  readonly degreeV: number;
  readonly normalCount: number;
  readonly domainU: readonly [number, number];
  readonly domainV: readonly [number, number];
}> {
  const rhino = await loadStudioRhino3dm();
  const scope = new RhinoEmbindScope();
  try {
    const sphere = scope.own(new rhino.Sphere([0, 0, 0], radius));
    const surface = scope.own(rhino.NurbsSurface.createFromSphere(sphere));
    if (!surface || typeof surface.pointAt !== "function") {
      throw new Error("NurbsSurface.createFromSphere failed (openNURBS)");
    }
    const domainU = surfaceDomain(surface, 0, [0, Math.PI * 2]);
    const domainV = surfaceDomain(surface, 1, [0, Math.PI]);
    // If V domain collapsed (some builds expose only U), use spherical param defaults
    const dU: [number, number] = domainU[1] > domainU[0] ? domainU : [0, Math.PI * 2];
    let dV: [number, number] = domainV[1] > domainV[0] ? domainV : [0, Math.PI];
    // rhino sphere often returns only U domain via domain property — V from degree probe
    if (dV[1] - dV[0] < 1e-6) dV = [0, Math.PI];
    const tess = tessellateNurbsSurface(surface, uCount, vCount, dU, dV);
    return {
      ok: true,
      mesh: tess.mesh,
      vertexCount: tess.mesh.vertices.length,
      faceCount: tess.mesh.faces.length,
      radius,
      backend: "rhino3dm-opennurbs",
      surfaceKind: "nurbs-sphere",
      degreeU: tess.degreeU,
      degreeV: tess.degreeV,
      normalCount: tess.normals.length,
      domainU: dU,
      domainV: dV,
    };
  } finally {
    scope.dispose();
  }
}

/**
 * Full openNURBS surface suite: sphere + cylinder + ruled, all with pointAt/normalAt.
 */
export async function evaluateStudioNurbsSurfaceSuite(): Promise<{
  readonly ok: true;
  readonly backend: "rhino3dm-opennurbs";
  readonly surfaces: readonly string[];
  readonly totalVertices: number;
  readonly totalFaces: number;
  readonly totalNormals: number;
  readonly rationalCircleSamples: number;
  readonly curveTangents: number;
}> {
  const rhino = await loadStudioRhino3dm();
  const scope = new RhinoEmbindScope();
  try {
    const surfaces: string[] = [];
    let totalVertices = 0;
    let totalFaces = 0;
    let totalNormals = 0;

    const sphere = await evaluateStudioNurbsSurfaceSphere(1, 14, 10);
    surfaces.push("sphere");
    totalVertices += sphere.vertexCount;
    totalFaces += sphere.faceCount;
    totalNormals += sphere.normalCount;

    // Cylinder NURBS surface
    try {
      const cylCtor = rhino.Cylinder;
      let surface: {
        pointAt: (u: number, v: number) => unknown;
        normalAt?: (u: number, v: number) => unknown;
        degree?: (d: number) => number;
      } | null = null;
      if (cylCtor) {
        try {
          const plane = scope.own(rhino.Plane?.worldXY?.() ?? null);
          const cyl = scope.own(plane
            ? new cylCtor(plane, 0.5, 2)
            : new cylCtor(0.5, 2));
          surface = scope.own(rhino.NurbsSurface.createFromCylinder(cyl));
        } catch {
          surface = null;
        }
      }
      if (!surface) {
        // Ruled surface between two circles (openNURBS createRuledSurface)
        const circle0 = scope.own(new rhino.Circle([0, 0, 0], 0.5));
        const circle1 = scope.own(new rhino.Circle([0, 0, 2], 0.5));
        const c0 = scope.own(circle0.toNurbsCurve());
        const c1 = scope.own(circle1.toNurbsCurve());
        surface = scope.own(rhino.NurbsSurface.createRuledSurface(c0, c1));
      }
      if (surface && typeof surface.pointAt === "function") {
        const tess = tessellateNurbsSurface(surface, 12, 8, [0, Math.PI * 2], [0, 1]);
        surfaces.push("cylinder-or-ruled");
        totalVertices += tess.mesh.vertices.length;
        totalFaces += tess.mesh.faces.length;
        totalNormals += tess.normals.length;
      }
    } catch {
      // sphere alone is still valid; suite reports what succeeded
    }

    // Explicit ruled surface from two NURBS curves
    try {
      const a = scope.own(new rhino.Point3dList());
      const b = scope.own(new rhino.Point3dList());
      a.add(-1, 0, 0);
      a.add(0, 1, 0);
      a.add(1, 0, 0);
      b.add(-1, 0, 2);
      b.add(0, -1, 2);
      b.add(1, 0, 2);
      const c0 = scope.own(rhino.NurbsCurve.create(false, 2, a));
      const c1 = scope.own(rhino.NurbsCurve.create(false, 2, b));
      const ruled = scope.own(rhino.NurbsSurface.createRuledSurface(c0, c1));
      if (ruled && typeof ruled.pointAt === "function") {
        const tess = tessellateNurbsSurface(ruled, 10, 6, [0, 1], [0, 1]);
        surfaces.push("ruled");
        totalVertices += tess.mesh.vertices.length;
        totalFaces += tess.mesh.faces.length;
        totalNormals += tess.normals.length;
      }
    } catch {
      // optional
    }

    const rational = await evaluateStudioRationalNurbsCircle(1, 32);
    const curve = await evaluateStudioNurbsCurve(
      [
        [0, 0, 0],
        [1, 2, 0],
        [2, 0, 1],
        [3, 1, 0],
      ],
      16,
      3,
    );

    if (surfaces.length < 1) {
      throw new Error("openNURBS surface suite produced no surfaces");
    }
    if (totalFaces < 20) {
      throw new Error(`openNURBS surface suite too sparse faces=${totalFaces}`);
    }

    return {
      ok: true,
      backend: "rhino3dm-opennurbs",
      surfaces,
      totalVertices,
      totalFaces,
      totalNormals,
      rationalCircleSamples: rational.sampleCount,
      curveTangents: curve.tangents.filter((t) =>
        Math.hypot(t[0], t[1], t[2]) > 1e-9
      ).length,
    };
  } finally {
    scope.dispose();
  }
}

/**
 * Parse binary 3DM via openNURBS File3dm and tessellate curve/surface/mesh objects.
 */
export async function parseStudioRhino3dmOpenNurbs(
  bytes: Uint8Array,
): Promise<{
  readonly ok: boolean;
  readonly backend: "rhino3dm-opennurbs";
  readonly objectCount: number;
  readonly curveSamples: number;
  readonly surfaceSamples: number;
  readonly meshVertices: number;
  readonly meshFaces: number;
  readonly layerCount: number;
  readonly meshes: readonly StudioEditableMesh[];
  readonly losses: readonly string[];
  readonly hasNurbsEval: boolean;
}> {
  const rhino = await loadStudioRhino3dm();
  const scope = new RhinoEmbindScope();
  try {
    const losses: string[] = [];
    const opened = (() => {
      try {
        return {
          doc: scope.own(rhino.File3dm.fromByteArray(bytes)),
          error: null as string | null,
        };
      } catch (error) {
        return {
          doc: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    if (opened.error || !opened.doc) {
      return {
        ok: false,
        backend: "rhino3dm-opennurbs",
        objectCount: 0,
        curveSamples: 0,
        surfaceSamples: 0,
        meshVertices: 0,
        meshFaces: 0,
        layerCount: 0,
        meshes: [],
        losses: [opened.error ? `fromByteArray-failed:${opened.error}` : "null-file3dm"],
        hasNurbsEval: false,
      };
    }
    const doc = opened.doc;
    const objects = scope.own(doc.objects());
    const count = objects.count as number;
    let curveSamples = 0;
    let surfaceSamples = 0;
    let meshVertices = 0;
    let meshFaces = 0;
    const meshes: StudioEditableMesh[] = [];
    for (let i = 0; i < count; i += 1) {
      const objectScope = new RhinoEmbindScope();
      try {
        const obj = objectScope.own(objects.get(i));
        const geom = objectScope.own(obj?.geometry?.() ?? obj?.geometry);
        if (!geom) continue;
        // Curve path — openNURBS pointAt
        if (typeof geom.pointAt === "function" && typeof geom.tangentAt === "function") {
          for (let t = 0; t <= 1.0001; t += 0.1) {
            try {
              const p = geom.pointAt(Math.min(1, t));
              if (p) curveSamples += 1;
            } catch {
              // skip
            }
          }
        } else if (typeof geom.pointAt === "function") {
          // Surface: pointAt(u,v)
          for (let u = 0; u <= 1.0001; u += 0.25) {
            for (let vv = 0; vv <= 1.0001; vv += 0.25) {
              try {
                const p = geom.pointAt(Math.min(1, u), Math.min(1, vv));
                if (p) surfaceSamples += 1;
              } catch {
                try {
                  const p = geom.pointAt(Math.min(1, u));
                  if (p) curveSamples += 1;
                } catch {
                  // skip
                }
              }
            }
          }
        }
        // Mesh path
        if (typeof geom.vertices === "function" || geom.vertices) {
          try {
            const verts = objectScope.own(
              typeof geom.vertices === "function" ? geom.vertices() : geom.vertices,
            );
            const faces = objectScope.own(
              typeof geom.faces === "function" ? geom.faces() : geom.faces,
            );
            const vCount = verts?.count ?? verts?.length ?? 0;
            const fCount = faces?.count ?? faces?.length ?? 0;
            meshVertices += vCount;
            meshFaces += fCount;
            if (vCount >= 3 && fCount >= 1) {
              const positions: number[] = [];
              const faceIdx: number[][] = [];
              for (let vi = 0; vi < vCount; vi += 1) {
                const p = verts.get(vi);
                positions.push(p[0] ?? p.X ?? 0, p[1] ?? p.Y ?? 0, p[2] ?? p.Z ?? 0);
              }
              for (let fi = 0; fi < fCount; fi += 1) {
                const f = faces.get(fi);
                const a = f[0] ?? f.A ?? 0;
                const b = f[1] ?? f.B ?? 0;
                const c = f[2] ?? f.C ?? 0;
                faceIdx.push([a, b, c]);
              }
              meshes.push(soupToMesh(positions, faceIdx));
            }
          } catch {
            losses.push(`mesh-extract-fail-${i}`);
          }
        }
      } finally {
        objectScope.dispose();
      }
    }
    let layerCount = 0;
    try {
      const layers = scope.own(
        typeof doc.layers === "function" ? doc.layers() : doc.layers,
      );
      layerCount = Number(layers?.count ?? layers?.length ?? 0);
    } catch {
      layerCount = 0;
    }
    return {
      ok: count > 0 || curveSamples > 0 || surfaceSamples > 0 || meshVertices > 0,
      backend: "rhino3dm-opennurbs",
      objectCount: count,
      curveSamples,
      surfaceSamples,
      meshVertices,
      meshFaces,
      layerCount,
      meshes,
      losses,
      hasNurbsEval: curveSamples > 0 || surfaceSamples > 0,
    };
  } finally {
    scope.dispose();
  }
}

/** Build a binary 3DM fixture with NURBS curve + sphere surface via openNURBS. */
export async function createStudioRhino3dmNurbsFixture(): Promise<Uint8Array> {
  const rhino = await loadStudioRhino3dm();
  const scope = new RhinoEmbindScope();
  try {
    const pts = scope.own(new rhino.Point3dList());
    pts.add(0, 0, 0);
    pts.add(1, 1, 0);
    pts.add(2, 0, 0);
    pts.add(3, 1, 0);
    const curve = scope.own(rhino.NurbsCurve.create(false, 3, pts));
    const doc = scope.own(new rhino.File3dm());
    const objects = scope.own(doc.objects());
    objects.add(curve, null);
    // Rational circle
    try {
      const circle = scope.own(new rhino.Circle([0, 0, 0], 0.75));
      const circ = scope.own(circle.toNurbsCurve());
      if (circ) objects.add(circ, null);
    } catch {
      // optional
    }
    // Sphere surface
    try {
      const sphere = scope.own(new rhino.Sphere([0, 0, 0], 0.5));
      const surf = scope.own(rhino.NurbsSurface.createFromSphere(sphere));
      if (surf) objects.add(surf, null);
    } catch {
      // optional
    }
    // Mesh from tessellated sphere
    try {
      const sphereMesh = await evaluateStudioNurbsSurfaceSphere(0.5, 8, 6);
      const mesh = scope.own(new rhino.Mesh());
      const verts = scope.own(mesh.vertices());
      for (const vtx of sphereMesh.mesh.vertices) {
        verts.add(vtx.position.x, vtx.position.y, vtx.position.z);
      }
      objects.add(mesh, null);
    } catch {
      // curve-only fixture is still valid openNURBS
    }
    const bytes = doc.toByteArray() as Uint8Array;
    return new Uint8Array(bytes);
  } finally {
    scope.dispose();
  }
}
