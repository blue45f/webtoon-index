/**
 * Renderer-free topology selection. Stable IDs, not triangle/raycast indices, are the authority.
 * Neighbourhoods are incidence groups: a high-valence vertex never creates a quadratic edge clique.
 */
export type StudioHybridDccSelectionComponent = "vertex" | "edge" | "face";
export type StudioHybridDccSelectionCommand =
  | "all" | "none" | "invert" | "grow" | "shrink" | "linked" | "boundary" | "loose" | "path";

/** Structural subset of StudioEditableMesh; no renderer or document dependency. */
export interface StudioHybridDccSelectionMesh {
  readonly vertices: readonly { readonly id: number }[];
  readonly halfEdges: readonly {
    readonly id: number;
    readonly vertex: number;
    readonly face: number;
    readonly next: number;
    readonly prev: number;
    readonly twin: number;
  }[];
  readonly faces: readonly { readonly id: number; readonly he: number }[];
}
export const STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS = Object.freeze({
  maxTopologyRecords: 1_000_000,
  maxTraversalWork: 2_000_000,
  maxSelectedElements: 50_000,
  // The shipping panel currently exposes a single-element callback. Refuse rather than truncate
  // a batch that would make its repeated immutable selection validation too expensive.
  maxDispatchChanges: 512,
  maxDispatchSelectionWork: 1_000_000,
});
interface Graph {
  readonly ids: readonly number[];
  readonly incidence: ReadonlyMap<number, readonly number[]>;
  readonly groups: ReadonlyMap<number, readonly number[]>;
  readonly boundary: ReadonlySet<number>;
}
interface Index {
  readonly vertex: Graph;
  readonly edge: Graph;
  readonly face: Graph;
  readonly edgeIds: ReadonlyMap<number, number>;
}
const indices = new WeakMap<StudioHybridDccSelectionMesh, Index>();
const ascending = (left: number, right: number) => left - right;
const stableId = (id: number) => Number.isSafeInteger(id) && id >= 0;
function canonical(values: Iterable<number>): readonly number[] {
  return Object.freeze([...new Set(values)].sort(ascending));
}
function graph(ids: readonly number[], groups: Map<number, readonly number[]>, boundary: Set<number>): Graph {
  const incidence = new Map<number, number[]>(ids.map((id) => [id, []]));
  for (const [group, members] of groups) {
    for (const id of members) incidence.get(id)!.push(group);
  }
  return { ids: canonical(ids), groups, boundary, incidence };
}
function build(mesh: StudioHybridDccSelectionMesh): Index {
  const cached = indices.get(mesh);
  if (cached) return cached;
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.halfEdges) || !Array.isArray(mesh.faces)
    || mesh.vertices.length + mesh.halfEdges.length + mesh.faces.length
      > STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS.maxTopologyRecords) {
    throw new Error("선택 토폴로지 검사 예산을 초과했거나 메시 배열이 잘못되었습니다.");
  }
  const vertices = new Set<number>();
  const faces = new Set<number>();
  for (const vertex of mesh.vertices) {
    if (!vertex || !stableId(vertex.id) || vertices.has(vertex.id)) throw new Error("정점 ID가 잘못되었거나 중복됩니다.");
    vertices.add(vertex.id);
  }
  for (const face of mesh.faces) {
    if (!face || !stableId(face.id) || faces.has(face.id)) throw new Error("면 ID가 잘못되었거나 중복됩니다.");
    faces.add(face.id);
  }
  const halfEdges = mesh.halfEdges;
  for (let i = 0; i < halfEdges.length; i += 1) {
    const edge = halfEdges[i];
    if (!edge || edge.id !== i || !vertices.has(edge.vertex) || !faces.has(edge.face)
      || !stableId(edge.next) || !stableId(edge.prev)
      || halfEdges[edge.next]?.prev !== i || halfEdges[edge.prev]?.next !== i
      || (edge.twin !== -1 && (!stableId(edge.twin) || edge.twin === i
        || halfEdges[edge.twin]?.twin !== i))) throw new Error("메시 모서리 연결이 유효하지 않습니다.");
    const origin = halfEdges[edge.prev]!.vertex;
    if (origin === edge.vertex) throw new Error("길이가 없는 모서리는 선택 그래프로 사용할 수 없습니다.");
    if (edge.twin >= 0) {
      const twin = halfEdges[edge.twin]!;
      if (twin.vertex !== origin || halfEdges[twin.prev]?.vertex !== edge.vertex
        || twin.face === edge.face) throw new Error("모서리 쌍의 방향이나 소유 면이 잘못되었습니다.");
    }
  }
  const owned = new Set<number>();
  for (const face of mesh.faces) {
    const seen = new Set<number>();
    const faceVertices = new Set<number>();
    let id = face.he;
    do {
      const edge = halfEdges[id];
      if (!stableId(id) || !edge || edge.face !== face.id || seen.has(id) || owned.has(id)) {
        throw new Error("면의 모서리 순환이 닫히지 않거나 다른 면과 겹칩니다.");
      }
      if (faceVertices.has(edge.vertex)) throw new Error("면에 중복된 정점이 있습니다.");
      seen.add(id); owned.add(id); faceVertices.add(edge.vertex);
      id = edge.next;
    } while (id !== face.he);
    if (seen.size < 3) throw new Error("면의 정점이 세 개보다 적습니다.");
  }
  if (owned.size !== halfEdges.length) throw new Error("면에 속하지 않는 모서리가 있습니다.");
  const edgeIds = new Map<number, number>();
  const endpoints = new Map<number, readonly number[]>();
  const adjacentFaces = new Map<number, readonly number[]>();
  const incidentEdges = new Map<number, number[]>([...vertices].map((id) => [id, []]));
  const boundaryVertices = new Set<number>();
  const boundaryEdges = new Set<number>();
  const boundaryFaces = new Set<number>();
  for (const edge of halfEdges) {
    const id = edge.twin < 0 ? edge.id : Math.min(edge.id, edge.twin);
    edgeIds.set(edge.id, id);
    if (endpoints.has(id)) continue;
    const pair = canonical([halfEdges[edge.prev]!.vertex, edge.vertex]);
    endpoints.set(id, pair);
    adjacentFaces.set(id, canonical(edge.twin < 0 ? [edge.face] : [edge.face, halfEdges[edge.twin]!.face]));
    for (const vertex of pair) incidentEdges.get(vertex)!.push(id);
    if (edge.twin < 0) {
      boundaryEdges.add(id); boundaryFaces.add(edge.face);
      for (const vertex of pair) boundaryVertices.add(vertex);
    }
  }
  const result: Index = {
    vertex: graph([...vertices], endpoints, boundaryVertices),
    edge: graph([...endpoints.keys()], new Map([...incidentEdges].map(([id, edges]) => [id, canonical(edges)])), boundaryEdges),
    face: graph([...faces], adjacentFaces, boundaryFaces),
    edgeIds,
  };
  indices.set(mesh, result);
  return result;
}

export function runStudioHybridDccSelectionCommand(
  mesh: StudioHybridDccSelectionMesh,
  mode: StudioHybridDccSelectionComponent,
  selection: readonly number[],
  command: StudioHybridDccSelectionCommand,
): readonly number[] {
  if (!["vertex", "edge", "face"].includes(mode)) throw new Error("점·선·면 모드에서 사용하세요.");
  if (selection.length > STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS.maxSelectedElements) {
    throw new Error("선택 요소 수가 안전 범위를 벗어났습니다.");
  }
  const index = build(mesh);
  const data = index[mode];
  const selected = new Set<number>();
  for (const id of selection) {
    const normalized = mode === "edge" ? index.edgeIds.get(id) : id;
    if (!stableId(id) || normalized === undefined || !data.incidence.has(normalized)) {
      throw new Error("선택에 현재 메시에서 찾을 수 없는 요소가 있습니다.");
    }
    selected.add(normalized);
  }
  let work = 0;
  const touch = (count = 1) => {
    work += count;
    if (work > STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS.maxTraversalWork) {
      throw new Error("선택 탐색 예산을 초과했습니다. 더 작은 영역으로 나누세요.");
    }
  };
  const checked = (values: Iterable<number>): readonly number[] => {
    const result = canonical(values);
    if (result.length > STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS.maxSelectedElements) {
      throw new Error("결과가 최대 50,000개 선택 한도를 초과했습니다. 부분 선택은 적용하지 않았습니다.");
    }
    return result;
  };
  switch (command) {
    case "none": return Object.freeze([]);
    case "all": return checked(data.ids);
    case "invert": return checked(data.ids.filter((id) => !selected.has(id)));
    case "boundary": return checked(data.boundary);
    case "loose":
      if (mode !== "vertex") throw new Error("고립 정점 선택은 점 모드에서 사용하세요.");
      return checked(data.ids.filter((id) => data.incidence.get(id)!.length === 0));
    case "shrink": {
      const retainGroup = new Map<number, boolean>();
      return checked([...selected].filter((id) => data.incidence.get(id)!.every((group) => {
        if (!retainGroup.has(group)) {
          const members = data.groups.get(group)!; touch(members.length);
          retainGroup.set(group, members.every((member) => selected.has(member)));
        }
        return retainGroup.get(group);
      })));
    }
    case "grow":
    case "linked": {
      const result = new Set(selected);
      const queue = [...selected].sort(ascending);
      const seenGroups = new Set<number>();
      for (let i = 0; i < queue.length; i += 1) {
        touch();
        for (const group of data.incidence.get(queue[i]!)!) {
          if (seenGroups.has(group)) continue;
          seenGroups.add(group);
          for (const next of data.groups.get(group)!) {
            touch();
            if (result.has(next)) continue;
            result.add(next);
            if (result.size > STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS.maxSelectedElements) {
              throw new Error("연결 영역이 최대 50,000개 선택 한도를 초과했습니다.");
            }
            if (command === "linked") queue.push(next);
          }
        }
      }
      return checked(result);
    }
    case "path": {
      if (selected.size !== 2) throw new Error("최단 연결 경로는 시작과 끝 요소 두 개를 선택하세요.");
      const [start, goal] = [...selected].sort(ascending) as [number, number];
      const queue = [start];
      const previous = new Map<number, number | null>([[start, null]]);
      const seenGroups = new Set<number>();
      for (let i = 0; i < queue.length && !previous.has(goal); i += 1) {
        const id = queue[i]!; touch();
        for (const group of data.incidence.get(id)!) {
          if (seenGroups.has(group)) continue;
          seenGroups.add(group);
          for (const next of data.groups.get(group)!) {
            touch();
            if (previous.has(next)) continue;
            previous.set(next, id); queue.push(next);
          }
        }
      }
      if (!previous.has(goal)) throw new Error("두 요소가 서로 다른 연결 영역에 있어 경로가 없습니다.");
      const path: number[] = [];
      let id: number | null = goal;
      while (id !== null) { path.push(id); id = previous.get(id) ?? null; }
      return checked(path);
    }
    default: throw new Error("지원하지 않는 선택 명령입니다.");
  }
}

export type StudioHybridDccSelectionDispatchStep =
  | { readonly operation: "clear" }
  | { readonly operation: "add" | "subtract"; readonly id: number };

/** Preflight the entire legacy callback batch before the first UI state mutation. */
export function planStudioHybridDccSelectionDispatch(
  before: readonly number[], after: readonly number[], canClear: boolean,
): readonly StudioHybridDccSelectionDispatchStep[] {
  const limit = STUDIO_HYBRID_DCC_SELECTION_COMMAND_LIMITS;
  if (before.length > limit.maxSelectedElements || after.length > limit.maxSelectedElements) {
    throw new Error("선택 요소 수가 안전 범위를 벗어났습니다.");
  }
  for (const id of [...before, ...after]) if (!stableId(id)) throw new Error("선택 ID가 유효하지 않습니다.");
  const old = new Set(before), next = new Set(after);
  const remove = [...old].filter((id) => !next.has(id)).sort(ascending);
  const add = [...next].filter((id) => !old.has(id)).sort(ascending);
  const delta: StudioHybridDccSelectionDispatchStep[] = [
    ...remove.map((id) => ({ operation: "subtract" as const, id })),
    ...add.map((id) => ({ operation: "add" as const, id })),
  ];
  const reset: StudioHybridDccSelectionDispatchStep[] = [
    { operation: "clear" }, ...[...next].sort(ascending).map((id) => ({ operation: "add" as const, id })),
  ];
  const steps = canClear && reset.length < delta.length ? reset : delta;
  let count = old.size, work = 0;
  for (const step of steps) {
    count = step.operation === "clear" ? 0 : count + (step.operation === "add" ? 1 : -1);
    work += count;
  }
  if (steps.length > limit.maxDispatchChanges || work > limit.maxDispatchSelectionWork) {
    throw new Error("현재 선택 연결 경로는 한 번에 최대 512개 변경을 지원합니다. 더 작은 영역으로 나누세요. 부분 적용은 하지 않았습니다.");
  }
  return Object.freeze(steps.map((step) => Object.freeze(step)));
}

/** Scoped canvas shortcuts only; callers must exclude text entry and object/disabled modes. */
export function resolveStudioHybridDccSelectionShortcut(event: {
  readonly key: string; readonly code?: string; readonly altKey?: boolean;
  readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly shiftKey?: boolean;
  readonly repeat?: boolean; readonly isComposing?: boolean; readonly keyCode?: number;
  readonly defaultPrevented?: boolean;
}): StudioHybridDccSelectionCommand | null {
  if (event.repeat || event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (event.altKey) return key === "a" && !event.ctrlKey && !event.metaKey ? "none" : null;
  if (event.ctrlKey || event.metaKey) {
    if (key === "i") return "invert";
    if (event.code === "NumpadAdd") return "grow";
    if (event.code === "NumpadSubtract") return "shrink";
    return null;
  }
  return key === "a" ? "all" : key === "l" ? "linked" : null;
}
