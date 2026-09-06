/**
 * Studio 3D Editable Half-Edge Mesh Core
 *
 * Three.js BufferGeometry는 렌더링용으로는 적합하지만 편집 topology의
 * 원본으로 사용하면 안 된다. 이 모듈은 vertex, half-edge, edge, face의
 * persistent element ID와 편집 연산을 직접 관리한다.
 *
 * 설계서 참조: §4.4 Editable Half-edge Mesh
 */

export interface HEVertex {
  id: string;
  position: [number, number, number];
  normal?: [number, number, number];
  uv?: [number, number];
  halfEdgeId?: string; // 이 정점에서 나가는 반변 중 하나
  selected: boolean;
}

export interface HEHalfEdge {
  id: string;
  originVertexId: string;
  twinId?: string;      // 반대편 반변
  nextId?: string;      // 같은 face 내 다음 반변
  prevId?: string;      // 같은 face 내 이전 반변
  faceId?: string;      // 소속 face (boundary면 undefined)
  edgeId: string;       // 소속 edge
}

export interface HEEdge {
  id: string;
  halfEdgeId: string;   // 이 edge를 대표하는 반변 중 하나
  crease: number;       // 0 = smooth, 1 = hard edge
  selected: boolean;
}

export interface HEFace {
  id: string;
  halfEdgeId: string;   // face의 반변 루프 중 하나
  materialSlot: number;
  selected: boolean;
}

export type ElementType = "vertex" | "edge" | "face";

export interface MeshStats {
  vertices: number;
  edges: number;
  faces: number;
  triangles: number;
  quads: number;
  ngons: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  isolatedVertices: number;
}

export class Studio3DEditableMesh {
  private vertices = new Map<string, HEVertex>();
  private halfEdges = new Map<string, HEHalfEdge>();
  private edges = new Map<string, HEEdge>();
  private faces = new Map<string, HEFace>();
  private edgeIdByVertexPair = new Map<string, string>();
  private halfEdgeIdsByEdge = new Map<string, Set<string>>();
  private vertexPairByEdgeId = new Map<string, string>();
  private nextId = 1;

  private genId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  // ── Vertex Operations ──

  public addVertex(position: [number, number, number], uv?: [number, number]): HEVertex {
    const v: HEVertex = {
      id: this.genId("v"),
      position: [...position],
      uv: uv ? [...uv] : undefined,
      selected: false,
    };
    this.vertices.set(v.id, v);
    return this.cloneVertex(v);
  }

  public removeVertex(id: string): boolean {
    for (const halfEdge of this.halfEdges.values()) {
      if (halfEdge.originVertexId === id) return false;
    }
    return this.vertices.delete(id);
  }

  public moveVertex(id: string, delta: [number, number, number]): boolean {
    const v = this.vertices.get(id);
    if (!v) return false;
    v.position = [v.position[0] + delta[0], v.position[1] + delta[1], v.position[2] + delta[2]];
    return true;
  }

  public getVertex(id: string): HEVertex | undefined {
    const vertex = this.vertices.get(id);
    return vertex ? this.cloneVertex(vertex) : undefined;
  }

  // ── Face Operations ──

  public addFace(vertexIds: string[], materialSlot = 0): HEFace | undefined {
    if (vertexIds.length < 3) return undefined;
    if (new Set(vertexIds).size !== vertexIds.length) return undefined;
    for (const vid of vertexIds) {
      if (!this.vertices.has(vid)) return undefined;
    }

    const faceId = this.genId("f");
    const heIds: string[] = [];

    // 반변(half-edge)들을 생성
    for (let i = 0; i < vertexIds.length; i++) {
      const originVertexId = vertexIds[i];
      const destinationVertexId = vertexIds[(i + 1) % vertexIds.length];
      const pairKey = this.vertexPairKey(originVertexId, destinationVertexId);
      let edgeId = this.edgeIdByVertexPair.get(pairKey);
      if (!edgeId) {
        edgeId = this.genId("e");
        this.edgeIdByVertexPair.set(pairKey, edgeId);
        this.vertexPairByEdgeId.set(edgeId, pairKey);
        this.halfEdgeIdsByEdge.set(edgeId, new Set());
      }

      const heId = this.genId("he");
      heIds.push(heId);
      const he: HEHalfEdge = {
        id: heId,
        originVertexId,
        faceId,
        edgeId,
      };
      this.halfEdges.set(heId, he);

      const incidentHalfEdges = this.halfEdgeIdsByEdge.get(edgeId)!;
      const twin = [...incidentHalfEdges]
        .map((candidateId) => this.halfEdges.get(candidateId))
        .find((candidate) =>
          candidate
          && !candidate.twinId
          && candidate.originVertexId === destinationVertexId
          && this.getHalfEdgeDestination(candidate.id) === originVertexId,
        );
      if (twin) {
        he.twinId = twin.id;
        twin.twinId = he.id;
      }
      incidentHalfEdges.add(heId);

      if (!this.edges.has(edgeId)) {
        this.edges.set(edgeId, {
          id: edgeId,
          halfEdgeId: heId,
          crease: 0,
          selected: false,
        });
      }

      // vertex의 halfEdge 연결
      const vert = this.vertices.get(originVertexId)!;
      if (!vert.halfEdgeId) vert.halfEdgeId = heId;
    }

    // 반변 연결 (next/prev)
    for (let i = 0; i < heIds.length; i++) {
      const he = this.halfEdges.get(heIds[i])!;
      he.nextId = heIds[(i + 1) % heIds.length];
      he.prevId = heIds[(i - 1 + heIds.length) % heIds.length];
    }

    const face: HEFace = { id: faceId, halfEdgeId: heIds[0], materialSlot, selected: false };
    this.faces.set(faceId, face);
    return { ...face };
  }

  public removeFace(id: string): boolean {
    const face = this.faces.get(id);
    if (!face) return false;

    // 연결된 반변들 제거
    const heIds = this.getFaceHalfEdges(id);
    for (const heId of heIds) {
      const he = this.halfEdges.get(heId);
      if (he) {
        if (he.twinId) {
          const twin = this.halfEdges.get(he.twinId);
          if (twin) twin.twinId = undefined;
        }

        const incidentHalfEdges = this.halfEdgeIdsByEdge.get(he.edgeId);
        incidentHalfEdges?.delete(heId);
        this.halfEdges.delete(heId);

        if (!incidentHalfEdges || incidentHalfEdges.size === 0) {
          this.halfEdgeIdsByEdge.delete(he.edgeId);
          this.edges.delete(he.edgeId);
          const pairKey = this.vertexPairByEdgeId.get(he.edgeId);
          if (pairKey) this.edgeIdByVertexPair.delete(pairKey);
          this.vertexPairByEdgeId.delete(he.edgeId);
        } else {
          const edge = this.edges.get(he.edgeId);
          if (edge?.halfEdgeId === heId) {
            edge.halfEdgeId = incidentHalfEdges.values().next().value as string;
          }
        }
      }
    }
    const removed = this.faces.delete(id);
    this.repairVertexHalfEdgeReferences();
    return removed;
  }

  // ── Selection ──

  public selectAll(type: ElementType): void {
    const map = type === "vertex" ? this.vertices : type === "edge" ? this.edges : this.faces;
    for (const el of map.values()) {
      (el as { selected: boolean }).selected = true;
    }
  }

  public deselectAll(): void {
    for (const v of this.vertices.values()) v.selected = false;
    for (const e of this.edges.values()) e.selected = false;
    for (const f of this.faces.values()) f.selected = false;
  }

  public getSelected(type: ElementType): string[] {
    const map = type === "vertex" ? this.vertices : type === "edge" ? this.edges : this.faces;
    return [...map.values()].filter((el) => (el as { selected: boolean }).selected).map((el) => (el as { id: string }).id);
  }

  // ── Topology Query ──

  public getFaceVertexCount(faceId: string): number {
    return this.getFaceHalfEdges(faceId).length;
  }

  private getFaceHalfEdges(faceId: string): string[] {
    const face = this.faces.get(faceId);
    if (!face) return [];
    const result: string[] = [];
    let current = face.halfEdgeId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      result.push(current);
      const he = this.halfEdges.get(current);
      if (!he?.nextId) break;
      current = he.nextId;
    }
    return result;
  }

  // ── Mesh Statistics ──

  public getStats(): MeshStats {
    let triangles = 0;
    let quads = 0;
    let ngons = 0;
    let boundaryEdges = 0;

    for (const face of this.faces.values()) {
      const count = this.getFaceVertexCount(face.id);
      if (count === 3) triangles++;
      else if (count === 4) quads++;
      else if (count > 4) ngons++;
    }

    let nonManifoldEdges = 0;
    for (const incidentHalfEdges of this.halfEdgeIdsByEdge.values()) {
      if (incidentHalfEdges.size === 1) boundaryEdges++;
      if (incidentHalfEdges.size > 2) nonManifoldEdges++;
    }

    const isolatedVertices = [...this.vertices.values()].filter((v) => !v.halfEdgeId).length;

    return {
      vertices: this.vertices.size,
      edges: this.edges.size,
      faces: this.faces.size,
      triangles,
      quads,
      ngons,
      boundaryEdges,
      nonManifoldEdges,
      isolatedVertices,
    };
  }

  // ── Validation ──

  public validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // 고립 정점 검사
    for (const v of this.vertices.values()) {
      if (!v.halfEdgeId) {
        issues.push(`고립 정점: ${v.id}`);
      }
    }

    // face의 최소 3 정점 검사
    for (const face of this.faces.values()) {
      const halfEdgeIds = this.getFaceHalfEdges(face.id);
      const count = halfEdgeIds.length;
      if (count < 3) {
        issues.push(`퇴화 면(정점 ${count}개): ${face.id}`);
      }
      const vertexIds = halfEdgeIds
        .map((halfEdgeId) => this.halfEdges.get(halfEdgeId)?.originVertexId)
        .filter((vertexId): vertexId is string => Boolean(vertexId));
      if (new Set(vertexIds).size !== vertexIds.length) {
        issues.push(`중복 정점이 있는 면: ${face.id}`);
      }

      for (const halfEdgeId of halfEdgeIds) {
        const halfEdge = this.halfEdges.get(halfEdgeId);
        if (halfEdge?.faceId !== face.id) {
          issues.push(`면 루프 참조 불일치: ${face.id}/${halfEdgeId}`);
        }
      }
    }

    for (const halfEdge of this.halfEdges.values()) {
      const origin = this.vertices.get(halfEdge.originVertexId);
      const edge = this.edges.get(halfEdge.edgeId);
      const next = halfEdge.nextId ? this.halfEdges.get(halfEdge.nextId) : undefined;
      const prev = halfEdge.prevId ? this.halfEdges.get(halfEdge.prevId) : undefined;
      if (!origin) issues.push(`없는 정점을 참조하는 반변: ${halfEdge.id}`);
      if (!edge) issues.push(`없는 변을 참조하는 반변: ${halfEdge.id}`);
      if (!next || next.prevId !== halfEdge.id) {
        issues.push(`반변 next/prev 참조 불일치: ${halfEdge.id}`);
      }
      if (!prev || prev.nextId !== halfEdge.id) {
        issues.push(`반변 prev/next 참조 불일치: ${halfEdge.id}`);
      }
      if (halfEdge.twinId) {
        const twin = this.halfEdges.get(halfEdge.twinId);
        if (!twin || twin.twinId !== halfEdge.id || twin.edgeId !== halfEdge.edgeId) {
          issues.push(`반변 twin 참조 불일치: ${halfEdge.id}`);
        } else if (
          twin.originVertexId !== this.getHalfEdgeDestination(halfEdge.id)
          || this.getHalfEdgeDestination(twin.id) !== halfEdge.originVertexId
        ) {
          issues.push(`반변 twin 방향 불일치: ${halfEdge.id}`);
        }
      }
    }

    for (const [edgeId, incidentHalfEdges] of this.halfEdgeIdsByEdge) {
      const edge = this.edges.get(edgeId);
      if (!edge || !incidentHalfEdges.has(edge.halfEdgeId)) {
        issues.push(`변 대표 반변 참조 불일치: ${edgeId}`);
      }
      if (incidentHalfEdges.size > 2) {
        issues.push(`비다양체 변: ${edgeId}`);
      } else if (incidentHalfEdges.size === 2) {
        const [firstId, secondId] = [...incidentHalfEdges];
        const first = this.halfEdges.get(firstId);
        const second = this.halfEdges.get(secondId);
        if (first?.twinId !== secondId || second?.twinId !== firstId) {
          issues.push(`인접 면의 반변 방향 불일치: ${edgeId}`);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }

  // ── Serialization ──

  public getAllVertices(): HEVertex[] {
    return [...this.vertices.values()].map((vertex) => this.cloneVertex(vertex));
  }

  public getAllHalfEdges(): HEHalfEdge[] {
    return [...this.halfEdges.values()].map((halfEdge) => ({ ...halfEdge }));
  }

  public getAllEdges(): HEEdge[] {
    return [...this.edges.values()].map((edge) => ({ ...edge }));
  }

  public getAllFaces(): HEFace[] {
    return [...this.faces.values()].map((face) => ({ ...face }));
  }

  private cloneVertex(vertex: HEVertex): HEVertex {
    return {
      ...vertex,
      position: [...vertex.position],
      normal: vertex.normal ? [...vertex.normal] : undefined,
      uv: vertex.uv ? [...vertex.uv] : undefined,
    };
  }

  private vertexPairKey(vertexIdA: string, vertexIdB: string): string {
    return vertexIdA < vertexIdB
      ? `${vertexIdA}\u0000${vertexIdB}`
      : `${vertexIdB}\u0000${vertexIdA}`;
  }

  private getHalfEdgeDestination(halfEdgeId: string): string | undefined {
    const halfEdge = this.halfEdges.get(halfEdgeId);
    if (!halfEdge?.nextId) return undefined;
    return this.halfEdges.get(halfEdge.nextId)?.originVertexId;
  }

  private repairVertexHalfEdgeReferences(): void {
    for (const vertex of this.vertices.values()) vertex.halfEdgeId = undefined;
    for (const halfEdge of this.halfEdges.values()) {
      const vertex = this.vertices.get(halfEdge.originVertexId);
      if (vertex && !vertex.halfEdgeId) vertex.halfEdgeId = halfEdge.id;
    }
  }
}
