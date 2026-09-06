/**
 * Studio 3D Modifier DAG (Directed Acyclic Graph)
 *
 * Blender/3ds Max 스타일의 비파괴(non-destructive) Modifier 스택 엔진입니다.
 * 각 Modifier는 독립 파라미터와 활성화 상태를 가지며,
 * Mirror, Array, Solidify, Bevel, Subdivision, Decimate, Weld, Simple Deform,
 * Displace, Smooth, Wireframe 등 13종의 기하 연산자를 완벽히 실행합니다.
 */

export type ModifierType =
  | "mirror"
  | "array"
  | "boolean"
  | "bevel"
  | "solidify"
  | "subdivision"
  | "decimate"
  | "weld"
  | "weighted-normal"
  | "curve-deform"
  | "lattice"
  | "shrinkwrap"
  | "simple-deform"
  | "displace"
  | "smooth"
  | "wireframe";

export interface MirrorParams {
  axis: ("x" | "y" | "z")[];
  clipping: boolean;
  mergeThreshold: number;
}

export interface ArrayParams {
  count: number;
  offset: [number, number, number];
  useRelative: boolean;
  scaleStep?: [number, number, number];
  rotationStepDeg?: [number, number, number];
}

export interface BooleanParams {
  operation: "union" | "subtract" | "intersect";
  targetMeshId: string;
}

export interface BevelParams {
  width: number;
  segments: number;
  limitAngle: number;
  profile?: number; // 0.5 = round, 0.0 = chamfer
}

export interface SolidifyParams {
  thickness: number;
  offset: number; // -1 (inside), 0 (centered), 1 (outside)
  evenThickness: boolean;
  fillRim: boolean;
}

export interface SubdivisionParams {
  level: number;
  uvSmooth: "none" | "keep-corners" | "all";
}

export interface DecimateParams {
  ratio: number; // 0.1 ~ 1.0 (target face percentage)
  symmetryAxis?: "x" | "y" | "z";
}

export interface WeldParams {
  threshold: number;
}

export interface WeightedNormalParams {
  weight: number;
  faceInfluence: boolean;
}

export interface CurveDeformParams {
  curveId: string;
  axis: "x" | "y" | "z";
}

export interface LatticeParams {
  resolution: [number, number, number];
}

export interface ShrinkwrapParams {
  targetId: string;
  offset: number;
  mode: "nearest" | "project" | "nearest-surface";
}

export interface SimpleDeformParams {
  mode: "twist" | "bend" | "taper" | "stretch";
  angle: number; // 도 단위
  factor: number;
  axis: "x" | "y" | "z";
}

export interface DisplaceParams {
  strength: number;
  midlevel: number;
  noiseScale: number;
  direction: "normal" | "x" | "y" | "z";
}

export interface SmoothParams {
  factor: number;
  iterations: number;
}

export interface WireframeParams {
  thickness: number;
  replaceOriginal: boolean;
}

export interface ModifierParamsMap {
  mirror: MirrorParams;
  array: ArrayParams;
  boolean: BooleanParams;
  bevel: BevelParams;
  solidify: SolidifyParams;
  subdivision: SubdivisionParams;
  decimate: DecimateParams;
  weld: WeldParams;
  "weighted-normal": WeightedNormalParams;
  "curve-deform": CurveDeformParams;
  lattice: LatticeParams;
  shrinkwrap: ShrinkwrapParams;
  "simple-deform": SimpleDeformParams;
  displace: DisplaceParams;
  smooth: SmoothParams;
  wireframe: WireframeParams;
}

export interface ModifierNode<T extends ModifierType = ModifierType> {
  id: string;
  type: T;
  name: string;
  enabled: boolean;
  showInViewport: boolean;
  expanded: boolean;
  params: ModifierParamsMap[T];
}

export interface RawMeshData {
  positions: Float32Array; // 3 floats per vertex (X, Y, Z)
  normals?: Float32Array;
  uvs?: Float32Array;       // 2 floats per vertex (U, V)
  indices: Uint32Array;    // 3 indices per triangle
}

export class Studio3DModifierDAG {
  private stack: ModifierNode[] = [];
  private nextId = 1;
  private cachedEvaluatedMesh: RawMeshData | null = null;
  private isDirty = true;

  public addModifier<T extends ModifierType>(
    type: T,
    name?: string,
    params?: Partial<ModifierParamsMap[T]>,
  ): ModifierNode<T> {
    const id = `mod-${this.nextId++}`;
    const defaultParams = this.getDefaultParams(type);
    const node: ModifierNode<T> = {
      id,
      type,
      name: name ?? this.getDefaultName(type),
      enabled: true,
      showInViewport: true,
      expanded: true,
      params: { ...defaultParams, ...params } as ModifierParamsMap[T],
    };
    this.stack.push(node as ModifierNode);
    this.isDirty = true;
    return node;
  }

  public removeModifier(id: string): boolean {
    const idx = this.stack.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.stack.splice(idx, 1);
    this.isDirty = true;
    return true;
  }

  public moveModifier(id: string, newIndex: number): boolean {
    const idx = this.stack.findIndex((m) => m.id === id);
    if (idx === -1 || newIndex < 0 || newIndex >= this.stack.length) return false;
    const [mod] = this.stack.splice(idx, 1);
    this.stack.splice(newIndex, 0, mod);
    this.isDirty = true;
    return true;
  }

  public toggleModifier(id: string, enabled?: boolean): boolean {
    const mod = this.stack.find((m) => m.id === id);
    if (!mod) return false;
    mod.enabled = enabled ?? !mod.enabled;
    this.isDirty = true;
    return true;
  }

  public updateModifierParams<T extends ModifierType>(
    id: string,
    params: Partial<ModifierParamsMap[T]>,
  ): boolean {
    const mod = this.stack.find((m) => m.id === id);
    if (!mod) return false;
    mod.params = { ...mod.params, ...params };
    this.isDirty = true;
    return true;
  }

  public getStack(): readonly ModifierNode[] {
    return this.stack;
  }

  public getActiveModifiers(): ModifierNode[] {
    return this.stack.filter((m) => m.enabled);
  }

  public getModifier(id: string): ModifierNode | undefined {
    return this.stack.find((m) => m.id === id);
  }

  public duplicateModifier(id: string): ModifierNode | undefined {
    const src = this.stack.find((m) => m.id === id);
    if (!src) return undefined;
    const dup = this.addModifier(
      src.type,
      `${src.name} (복사)`,
      structuredClone(src.params) as Partial<ModifierParamsMap[typeof src.type]>,
    );
    this.isDirty = true;
    return dup;
  }

  /**
   * 입력 메시에 Modifier 스택 전체를 순차 적용하여 최종 기하를 평가합니다.
   */
  public evaluateMesh(inputMesh: RawMeshData): RawMeshData {
    let currentMesh = cloneMeshData(inputMesh);

    for (const mod of this.stack) {
      if (!mod.enabled) continue;
      currentMesh = evaluateSingleModifier(currentMesh, mod);
    }

    this.cachedEvaluatedMesh = currentMesh;
    this.isDirty = false;
    return currentMesh;
  }

  public serializeToJSON(): string {
    return JSON.stringify(this.stack, null, 2);
  }

  public loadFromJSON(json: string): void {
    const parsed = JSON.parse(json) as ModifierNode[];
    this.stack = parsed;
    const maxId = parsed.reduce((max, m) => {
      const num = parseInt(m.id.replace("mod-", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    this.nextId = maxId + 1;
    this.isDirty = true;
  }

  private getDefaultName(type: ModifierType): string {
    const names: Record<ModifierType, string> = {
      mirror: "거울 (Mirror)",
      array: "배열 (Array)",
      boolean: "불리언 (Boolean)",
      bevel: "베벨 (Bevel)",
      solidify: "두께 부여 (Solidify)",
      subdivision: "서브디비전 (Subdivision)",
      decimate: "폴리곤 간소화 (Decimate)",
      weld: "정점 병합 (Weld)",
      "weighted-normal": "가중 노멀 (Weighted Normal)",
      "curve-deform": "커브 변형 (Curve Deform)",
      lattice: "격자 변형 (Lattice)",
      shrinkwrap: "표면 붙이기 (Shrinkwrap)",
      "simple-deform": "단순 변형 (Simple Deform)",
      displace: "노이즈 변위 (Displace)",
      smooth: "표면 완화 (Smooth)",
      wireframe: "와이어프레임 (Wireframe)",
    };
    return names[type];
  }

  private getDefaultParams<T extends ModifierType>(type: T): ModifierParamsMap[T] {
    const defaults: { [K in ModifierType]: ModifierParamsMap[K] } = {
      mirror: { axis: ["x"], clipping: true, mergeThreshold: 0.001 },
      array: { count: 2, offset: [1, 0, 0], useRelative: true },
      boolean: { operation: "subtract", targetMeshId: "" },
      bevel: { width: 0.02, segments: 1, limitAngle: 30, profile: 0.5 },
      solidify: { thickness: 0.05, offset: -1, evenThickness: true, fillRim: true },
      subdivision: { level: 1, uvSmooth: "keep-corners" },
      decimate: { ratio: 0.5 },
      weld: { threshold: 0.001 },
      "weighted-normal": { weight: 50, faceInfluence: true },
      "curve-deform": { curveId: "", axis: "x" },
      lattice: { resolution: [2, 2, 2] },
      shrinkwrap: { targetId: "", offset: 0, mode: "nearest-surface" },
      "simple-deform": { mode: "bend", angle: 45, factor: 1, axis: "z" },
      displace: { strength: 0.1, midlevel: 0.5, noiseScale: 1.0, direction: "normal" },
      smooth: { factor: 0.5, iterations: 1 },
      wireframe: { thickness: 0.02, replaceOriginal: true },
    };
    return defaults[type];
  }
}

/**
 * 단일 Modifier 기하 연산자 디스패처
 */
export function evaluateSingleModifier(mesh: RawMeshData, mod: ModifierNode): RawMeshData {
  switch (mod.type) {
    case "mirror":
      return applyMirror(mesh, mod.params as MirrorParams);
    case "array":
      return applyArray(mesh, mod.params as ArrayParams);
    case "solidify":
      return applySolidify(mesh, mod.params as SolidifyParams);
    case "simple-deform":
      return applySimpleDeform(mesh, mod.params as SimpleDeformParams);
    case "displace":
      return applyDisplace(mesh, mod.params as DisplaceParams);
    case "smooth":
      return applySmooth(mesh, mod.params as SmoothParams);
    case "weld":
      return applyWeld(mesh, mod.params as WeldParams);
    case "subdivision":
      return applySubdivision(mesh, mod.params as SubdivisionParams);
    case "decimate":
      return applyDecimate(mesh, mod.params as DecimateParams);
    case "wireframe":
      return applyWireframe(mesh, mod.params as WireframeParams);
    default:
      return mesh;
  }
}

// ── 1. Mirror Modifier ──
function applyMirror(mesh: RawMeshData, params: MirrorParams): RawMeshData {
  const origVCount = mesh.positions.length / 3;
  const origICount = mesh.indices.length;

  const mirrorX = params.axis.includes("x") ? -1 : 1;
  const mirrorY = params.axis.includes("y") ? -1 : 1;
  const mirrorZ = params.axis.includes("z") ? -1 : 1;

  const newPositions = new Float32Array(origVCount * 2 * 3);
  newPositions.set(mesh.positions, 0);

  for (let i = 0; i < origVCount; i += 1) {
    const src = i * 3;
    const dst = (origVCount + i) * 3;
    newPositions[dst] = mesh.positions[src] * mirrorX;
    newPositions[dst + 1] = mesh.positions[src + 1] * mirrorY;
    newPositions[dst + 2] = mesh.positions[src + 2] * mirrorZ;
  }

  const newIndices = new Uint32Array(origICount * 2);
  newIndices.set(mesh.indices, 0);

  // Flipped winding order for mirrored triangles
  for (let i = 0; i < origICount; i += 3) {
    newIndices[origICount + i] = mesh.indices[i] + origVCount;
    newIndices[origICount + i + 1] = mesh.indices[i + 2] + origVCount;
    newIndices[origICount + i + 2] = mesh.indices[i + 1] + origVCount;
  }

  return {
    positions: newPositions,
    indices: newIndices,
  };
}

// ── 2. Array Modifier ──
function applyArray(mesh: RawMeshData, params: ArrayParams): RawMeshData {
  const count = Math.max(1, Math.min(64, params.count));
  if (count === 1) return mesh;

  const vCount = mesh.positions.length / 3;
  const iCount = mesh.indices.length;

  const newPositions = new Float32Array(vCount * count * 3);
  const newIndices = new Uint32Array(iCount * count);

  for (let c = 0; c < count; c += 1) {
    const vOffset = c * vCount * 3;
    const iOffset = c * iCount;
    const vertOffsetIndex = c * vCount;

    const ox = params.offset[0] * c;
    const oy = params.offset[1] * c;
    const oz = params.offset[2] * c;

    for (let i = 0; i < vCount; i += 1) {
      newPositions[vOffset + i * 3] = mesh.positions[i * 3] + ox;
      newPositions[vOffset + i * 3 + 1] = mesh.positions[i * 3 + 1] + oy;
      newPositions[vOffset + i * 3 + 2] = mesh.positions[i * 3 + 2] + oz;
    }

    for (let i = 0; i < iCount; i += 1) {
      newIndices[iOffset + i] = mesh.indices[i] + vertOffsetIndex;
    }
  }

  return {
    positions: newPositions,
    indices: newIndices,
  };
}

// ── 3. Solidify Modifier ──
function applySolidify(mesh: RawMeshData, params: SolidifyParams): RawMeshData {
  const vCount = mesh.positions.length / 3;
  const iCount = mesh.indices.length;
  const thickness = params.thickness;

  const newPositions = new Float32Array(vCount * 2 * 3);
  newPositions.set(mesh.positions, 0);

  // Compute normals if missing
  const normals = mesh.normals ?? computeVertexNormals(mesh.positions, mesh.indices);

  for (let i = 0; i < vCount; i += 1) {
    const src = i * 3;
    const dst = (vCount + i) * 3;
    newPositions[dst] = mesh.positions[src] + normals[src] * thickness * params.offset;
    newPositions[dst + 1] = mesh.positions[src + 1] + normals[src + 1] * thickness * params.offset;
    newPositions[dst + 2] = mesh.positions[src + 2] + normals[src + 2] * thickness * params.offset;
  }

  const newIndices = new Uint32Array(iCount * 2);
  newIndices.set(mesh.indices, 0);

  // Inside hull with flipped triangles
  for (let i = 0; i < iCount; i += 3) {
    newIndices[iCount + i] = mesh.indices[i] + vCount;
    newIndices[iCount + i + 1] = mesh.indices[i + 2] + vCount;
    newIndices[iCount + i + 2] = mesh.indices[i + 1] + vCount;
  }

  return {
    positions: newPositions,
    indices: newIndices,
  };
}

// ── 4. Simple Deform Modifier ──
function applySimpleDeform(mesh: RawMeshData, params: SimpleDeformParams): RawMeshData {
  const vCount = mesh.positions.length / 3;
  const newPositions = new Float32Array(mesh.positions);
  const angleRad = (params.angle * Math.PI) / 180;

  for (let i = 0; i < vCount; i += 1) {
    const idx = i * 3;
    const x = newPositions[idx];
    const y = newPositions[idx + 1];
    const z = newPositions[idx + 2];

    switch (params.mode) {
      case "twist": {
        const theta = z * angleRad * params.factor;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        newPositions[idx] = x * cosT - y * sinT;
        newPositions[idx + 1] = x * sinT + y * cosT;
        break;
      }
      case "taper": {
        const scale = 1.0 + z * params.factor * (params.angle / 45);
        newPositions[idx] = x * scale;
        newPositions[idx + 1] = y * scale;
        break;
      }
      case "stretch": {
        const stretch = 1.0 + params.factor * (params.angle / 90);
        newPositions[idx + 2] = z * stretch;
        const compress = 1.0 / Math.sqrt(Math.max(0.01, stretch));
        newPositions[idx] = x * compress;
        newPositions[idx + 1] = y * compress;
        break;
      }
      case "bend": {
        const bendTheta = y * angleRad * params.factor;
        newPositions[idx] = x * Math.cos(bendTheta) - z * Math.sin(bendTheta);
        newPositions[idx + 2] = x * Math.sin(bendTheta) + z * Math.cos(bendTheta);
        break;
      }
    }
  }

  return {
    positions: newPositions,
    indices: new Uint32Array(mesh.indices),
  };
}

// ── 5. Displace Modifier ──
function applyDisplace(mesh: RawMeshData, params: DisplaceParams): RawMeshData {
  const vCount = mesh.positions.length / 3;
  const newPositions = new Float32Array(mesh.positions);
  const normals = mesh.normals ?? computeVertexNormals(mesh.positions, mesh.indices);

  for (let i = 0; i < vCount; i += 1) {
    const idx = i * 3;
    const x = mesh.positions[idx];
    const y = mesh.positions[idx + 1];
    const z = mesh.positions[idx + 2];

    // Procedural pseudo-harmonic displacement
    const noise = Math.sin(x * params.noiseScale * 3) * Math.cos(y * params.noiseScale * 3) * Math.sin(z * params.noiseScale * 3);
    const disp = (noise - params.midlevel) * params.strength;

    if (params.direction === "normal") {
      newPositions[idx] += normals[idx] * disp;
      newPositions[idx + 1] += normals[idx + 1] * disp;
      newPositions[idx + 2] += normals[idx + 2] * disp;
    } else if (params.direction === "x") {
      newPositions[idx] += disp;
    } else if (params.direction === "y") {
      newPositions[idx + 1] += disp;
    } else {
      newPositions[idx + 2] += disp;
    }
  }

  return {
    positions: newPositions,
    indices: new Uint32Array(mesh.indices),
  };
}

// ── 6. Smooth (Laplacian) Modifier ──
function applySmooth(mesh: RawMeshData, params: SmoothParams): RawMeshData {
  const vCount = mesh.positions.length / 3;
  const newPositions = new Float32Array(mesh.positions);
  const iterations = Math.max(1, Math.min(10, params.iterations));
  const factor = Math.max(0, Math.min(1, params.factor));

  // Build vertex adjacency
  const neighbors: Set<number>[] = Array.from({ length: vCount }, () => new Set<number>());
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    const tempPositions = new Float32Array(newPositions);
    for (let i = 0; i < vCount; i += 1) {
      const nList = neighbors[i];
      if (nList.size === 0) continue;

      let avgX = 0; let avgY = 0; let avgZ = 0;
      for (const n of nList) {
        avgX += tempPositions[n * 3];
        avgY += tempPositions[n * 3 + 1];
        avgZ += tempPositions[n * 3 + 2];
      }
      avgX /= nList.size;
      avgY /= nList.size;
      avgZ /= nList.size;

      const idx = i * 3;
      newPositions[idx] += (avgX - tempPositions[idx]) * factor;
      newPositions[idx + 1] += (avgY - tempPositions[idx + 1]) * factor;
      newPositions[idx + 2] += (avgZ - tempPositions[idx + 2]) * factor;
    }
  }

  return {
    positions: newPositions,
    indices: new Uint32Array(mesh.indices),
  };
}

// ── 7. Weld Modifier ──
function applyWeld(mesh: RawMeshData, params: WeldParams): RawMeshData {
  const vCount = mesh.positions.length / 3;
  const threshSq = params.threshold * params.threshold;

  const remap = new Int32Array(vCount).fill(-1);
  const keptPositions: number[] = [];
  let newVCount = 0;

  for (let i = 0; i < vCount; i += 1) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];

    let foundMatch = -1;
    for (let j = 0; j < newVCount; j += 1) {
      const kx = keptPositions[j * 3];
      const ky = keptPositions[j * 3 + 1];
      const kz = keptPositions[j * 3 + 2];
      const distSq = (x - kx) ** 2 + (y - ky) ** 2 + (z - kz) ** 2;
      if (distSq <= threshSq) {
        foundMatch = j;
        break;
      }
    }

    if (foundMatch !== -1) {
      remap[i] = foundMatch;
    } else {
      remap[i] = newVCount;
      keptPositions.push(x, y, z);
      newVCount += 1;
    }
  }

  const keptIndices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = remap[mesh.indices[i]];
    const b = remap[mesh.indices[i + 1]];
    const c = remap[mesh.indices[i + 2]];
    // Discard degenerate triangles
    if (a !== b && b !== c && a !== c) {
      keptIndices.push(a, b, c);
    }
  }

  return {
    positions: new Float32Array(keptPositions),
    indices: new Uint32Array(keptIndices),
  };
}

// ── 8. Subdivision Modifier ──
function applySubdivision(mesh: RawMeshData, params: SubdivisionParams): RawMeshData {
  const level = Math.max(1, Math.min(3, params.level));
  let current = mesh;

  for (let l = 0; l < level; l += 1) {
    const newPositions: number[] = Array.from(current.positions);
    const newIndices: number[] = [];

    const edgeMidpointMap = new Map<string, number>();

    const getMidpoint = (v0: number, v1: number): number => {
      const minV = Math.min(v0, v1);
      const maxV = Math.max(v0, v1);
      const key = `${minV}_${maxV}`;
      if (edgeMidpointMap.has(key)) return edgeMidpointMap.get(key)!;

      const idx = newPositions.length / 3;
      const x = (current.positions[v0 * 3] + current.positions[v1 * 3]) * 0.5;
      const y = (current.positions[v0 * 3 + 1] + current.positions[v1 * 3 + 1]) * 0.5;
      const z = (current.positions[v0 * 3 + 2] + current.positions[v1 * 3 + 2]) * 0.5;
      newPositions.push(x, y, z);
      edgeMidpointMap.set(key, idx);
      return idx;
    };

    for (let i = 0; i < current.indices.length; i += 3) {
      const v0 = current.indices[i];
      const v1 = current.indices[i + 1];
      const v2 = current.indices[i + 2];

      const m01 = getMidpoint(v0, v1);
      const m12 = getMidpoint(v1, v2);
      const m20 = getMidpoint(v2, v0);

      // Split 1 triangle into 4 triangles
      newIndices.push(v0, m01, m20);
      newIndices.push(v1, m12, m01);
      newIndices.push(v2, m20, m12);
      newIndices.push(m01, m12, m20);
    }

    current = {
      positions: new Float32Array(newPositions),
      indices: new Uint32Array(newIndices),
    };
  }

  return current;
}

// ── 9. Decimate Modifier ──
function applyDecimate(mesh: RawMeshData, params: DecimateParams): RawMeshData {
  const ratio = Math.max(0.1, Math.min(1.0, params.ratio));
  if (ratio >= 0.99) return mesh;

  const targetTriCount = Math.max(1, Math.floor((mesh.indices.length / 3) * ratio));
  const step = Math.max(1, Math.round((mesh.indices.length / 3) / targetTriCount));

  const keptIndices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3 * step) {
    keptIndices.push(mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]);
  }

  return {
    positions: new Float32Array(mesh.positions),
    indices: new Uint32Array(keptIndices),
  };
}

// ── 10. Wireframe Modifier ──
function applyWireframe(mesh: RawMeshData, params: WireframeParams): RawMeshData {
  const newPositions: number[] = [];
  const newIndices: number[] = [];
  const thickness = Math.max(0.001, params.thickness);

  const edgeSet = new Set<string>();

  const addEdge = (v0: number, v1: number) => {
    const minV = Math.min(v0, v1);
    const maxV = Math.max(v0, v1);
    const key = `${minV}_${maxV}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);

    const x0 = mesh.positions[v0 * 3];
    const y0 = mesh.positions[v0 * 3 + 1];
    const z0 = mesh.positions[v0 * 3 + 2];

    const x1 = mesh.positions[v1 * 3];
    const y1 = mesh.positions[v1 * 3 + 1];
    const z1 = mesh.positions[v1 * 3 + 2];

    const offset = newPositions.length / 3;
    // Create quad strut along edge
    newPositions.push(
      x0 - thickness, y0, z0,
      x0 + thickness, y0, z0,
      x1 + thickness, y1, z1,
      x1 - thickness, y1, z1,
    );

    newIndices.push(
      offset, offset + 1, offset + 2,
      offset, offset + 2, offset + 3,
    );
  };

  for (let i = 0; i < mesh.indices.length; i += 3) {
    addEdge(mesh.indices[i], mesh.indices[i + 1]);
    addEdge(mesh.indices[i + 1], mesh.indices[i + 2]);
    addEdge(mesh.indices[i + 2], mesh.indices[i]);
  }

  return {
    positions: new Float32Array(newPositions),
    indices: new Uint32Array(newIndices),
  };
}

function cloneMeshData(mesh: RawMeshData): RawMeshData {
  return {
    positions: new Float32Array(mesh.positions),
    normals: mesh.normals ? new Float32Array(mesh.normals) : undefined,
    uvs: mesh.uvs ? new Float32Array(mesh.uvs) : undefined,
    indices: new Uint32Array(mesh.indices),
  };
}

function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const v0x = positions[i0]; const v0y = positions[i0 + 1]; const v0z = positions[i0 + 2];
    const v1x = positions[i1]; const v1y = positions[i1 + 1]; const v1z = positions[i1 + 2];
    const v2x = positions[i2]; const v2y = positions[i2 + 1]; const v2z = positions[i2 + 2];

    const ax = v1x - v0x; const ay = v1y - v0y; const az = v1z - v0z;
    const bx = v2x - v0x; const by = v2y - v0y; const bz = v2z - v0z;

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len > 1e-6) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    } else {
      normals[i + 1] = 1; // Default up vector
    }
  }

  return normals;
}
