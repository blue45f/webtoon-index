/**
 * 지오메트리 노드 — 방어적 직렬화(문서 스키마 · 라운드트립 · 손상 입력 처리).
 *
 * 레포의 기존 문서 관례(`studio-bg3d-scene-document.ts`)를 따른다: kind/version 봉투,
 * UTF-8 바이트 admission, **예외를 절대 던지지 않는 파서**. 파서는 어떤 쓰레기 입력이 와도
 * `{ ok:false, code, detail }` 로 수렴한다 — `JSON.parse` 실패, null, 문자열, 배열,
 * 버전 불일치, 정의되지 않은 노드 타입, 끊어진 링크, NaN 파라미터, 상한 초과 전부.
 *
 * ## 라운드트립 계약
 * `serialize` 는 **정규형**을 낸다: 노드는 선언 순서 유지, 각 노드의 params 키는 사전순,
 * 링크는 (toNode, toSocket, fromNode, fromSocket) 사전순 정렬. 그래서
 * `serialize(parse(serialize(g)).graph) === serialize(g)` 가 문자열 수준에서 성립한다.
 *
 * ## 파서가 하지 않는 것
 * 사이클 검출은 하지 않는다(그건 평가기의 검증 단계 몫이다). 사이클이 든 문서도 "구조적으로는
 * 유효한 문서"로 파싱되고, 평가할 때 `graph-invalid` 로 거부된다. 이 분리를 유지해야
 * 편집 중 잠깐 사이클이 생긴 그래프도 저장·복원할 수 있다.
 * 정규화 시 **미등록 타입·존재하지 않는 소켓을 가리키는 링크는 문서를 거부**한다(조용히
 * 버리면 사용자 작업이 소리 없이 사라진다).
 */

import {
  studioGeometryDefaultNodeRegistry,
  studioGeometryDefaultParams,
  studioGeometryNormalizeParam,
} from "./studio-geometry-nodes-registry";

import type {
  StudioGeometryGraph,
  StudioGeometryGraphLink,
  StudioGeometryGraphNode,
  StudioGeometryParamValue,
} from "./studio-geometry-nodes-graph";
import type { StudioGeometryNodeRegistry } from "./studio-geometry-nodes-registry";

export const STUDIO_GEOMETRY_NODES_DOC_KIND = "toonspectrum.geometry-nodes" as const;
export const STUDIO_GEOMETRY_NODES_DOC_VERSION = 1 as const;
export const STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES = 256 * 1024;
/** @deprecated 문서 총량은 개수가 아니라 canonical UTF-8 바이트 admission으로 제한한다. */
export const STUDIO_GEOMETRY_NODES_DOC_MAX_NODES = Number.POSITIVE_INFINITY;
/** @deprecated 문서 총량은 개수가 아니라 canonical UTF-8 바이트 admission으로 제한한다. */
export const STUDIO_GEOMETRY_NODES_DOC_MAX_LINKS = Number.POSITIVE_INFINITY;
export const STUDIO_GEOMETRY_NODES_DOC_MAX_ID_LENGTH = 80;

const STUDIO_GEOMETRY_NODES_DOC_MAX_OBJECT_DEPTH = 512;
const studioGeometryNodesUtf8Encoder = new TextEncoder();

export type StudioGeometryNodesDocErrorCode =
  | "dangling-link"
  | "duplicate-node-id"
  | "invalid-id"
  | "invalid-json"
  | "invalid-link"
  | "invalid-node"
  | "kind-mismatch"
  | "link-limit"
  | "node-limit"
  | "not-an-object"
  | "too-large"
  | "unknown-node-type"
  | "unknown-socket"
  | "version-unsupported";

export type StudioGeometryNodesParseResult =
  | { readonly ok: true; readonly graph: StudioGeometryGraph }
  | {
      readonly ok: false;
      readonly code: StudioGeometryNodesDocErrorCode;
      readonly detail: string;
    };

interface SerializedNode {
  readonly id: string;
  readonly type: string;
  readonly params: Record<string, StudioGeometryParamValue>;
}

interface SerializedDocument {
  readonly kind: typeof STUDIO_GEOMETRY_NODES_DOC_KIND;
  readonly version: typeof STUDIO_GEOMETRY_NODES_DOC_VERSION;
  readonly outputNodeId: string | null;
  readonly nodes: readonly SerializedNode[];
  readonly links: readonly StudioGeometryGraphLink[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SafeObjectSnapshotResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: "invalid-json" | "too-large"; readonly detail: string };

interface SafeObjectSnapshotBudget {
  remainingBytes: number;
}

function objectSnapshotTooLarge(): SafeObjectSnapshotResult {
  return {
    ok: false,
    code: "too-large",
    detail: `객체 canonical UTF-8 문서가 상한 ${STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES}B를 초과합니다.`,
  };
}

function utf8ByteLength(value: string): number {
  return studioGeometryNodesUtf8Encoder.encode(value).byteLength;
}

function consumeSnapshotBytes(
  budget: SafeObjectSnapshotBudget,
  bytes: number
): SafeObjectSnapshotResult | null {
  if (bytes > budget.remainingBytes) {
    return objectSnapshotTooLarge();
  }
  budget.remainingBytes -= bytes;
  return null;
}

function invalidObjectSnapshot(detail: string): SafeObjectSnapshotResult {
  return { ok: false, code: "invalid-json", detail };
}

/**
 * 이미 파싱된 객체를 JSON 의미론의 own-data 스냅샷으로 바꾼다.
 * descriptor만 읽으므로 getter/toJSON/상속 property를 실행하지 않고, 복제하는 동안
 * JSON canonical UTF-8 크기를 증분 계산해 개수 상한 없이도 메모리 폭증을 막는다.
 */
function snapshotObjectValue(
  value: unknown,
  path: string,
  depth: number,
  budget: SafeObjectSnapshotBudget,
  ancestors: WeakSet<object>
): SafeObjectSnapshotResult {
  if (value === null) {
    const failure = consumeSnapshotBytes(budget, 4);
    return failure ?? { ok: true, value: null };
  }
  if (typeof value === "string") {
    // UTF-8은 UTF-16 code unit 수보다 작아지지 않는다. 먼저 거부해
    // 상한보다 큰 문자열의 JSON.stringify/TextEncoder 임시 할당을 막는다.
    if (value.length + 2 > budget.remainingBytes) {
      return objectSnapshotTooLarge();
    }
    const token = JSON.stringify(value);
    const failure = consumeSnapshotBytes(budget, utf8ByteLength(token));
    return failure ?? { ok: true, value };
  }
  if (typeof value === "boolean") {
    const failure = consumeSnapshotBytes(budget, value ? 4 : 5);
    return failure ?? { ok: true, value };
  }
  if (typeof value === "number") {
    const token = JSON.stringify(value) ?? "null";
    const failure = consumeSnapshotBytes(budget, utf8ByteLength(token));
    return failure ?? { ok: true, value };
  }
  if (typeof value !== "object") {
    return invalidObjectSnapshot(`${path}에 JSON으로 안전하지 않은 값이 있습니다.`);
  }
  if (depth > STUDIO_GEOMETRY_NODES_DOC_MAX_OBJECT_DEPTH) {
    return invalidObjectSnapshot(`${path}의 중첩이 안전 범위를 초과합니다.`);
  }
  if (ancestors.has(value)) {
    return invalidObjectSnapshot(`${path}에 순환 참조가 있습니다.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        return invalidObjectSnapshot(`${path}.length가 own-data property가 아닙니다.`);
      }
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        return invalidObjectSnapshot(`${path}.length가 유효하지 않습니다.`);
      }
      const envelopeFailure = consumeSnapshotBytes(budget, 2 + Math.max(0, length - 1));
      if (envelopeFailure) return envelopeFailure;

      const snapshot = new Array<unknown>(length);
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return invalidObjectSnapshot(`${path}[${index}]가 희소하거나 data property가 아닙니다.`);
        }
        const child = snapshotObjectValue(
          descriptor.value,
          `${path}[${index}]`,
          depth + 1,
          budget,
          ancestors
        );
        if (!child.ok) return child;
        snapshot[index] = child.value;
      }
      return { ok: true, value: snapshot };
    }

    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let writtenKeys = 0;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        return invalidObjectSnapshot(`${path}의 property descriptor가 불안정합니다.`);
      }
      if (!("value" in descriptor)) {
        return invalidObjectSnapshot(`${path}.${String(key)}가 accessor property입니다.`);
      }
      if (typeof key !== "string" || !descriptor.enumerable) continue;
      const separatorBytes = writtenKeys === 0 ? 0 : 1;
      if (separatorBytes + key.length + 3 > budget.remainingBytes) {
        return objectSnapshotTooLarge();
      }
      const keyBytes = utf8ByteLength(JSON.stringify(key));
      const propertyFailure = consumeSnapshotBytes(budget, separatorBytes + keyBytes + 1);
      if (propertyFailure) return propertyFailure;
      const child = snapshotObjectValue(
        descriptor.value,
        `${path}.${key}`,
        depth + 1,
        budget,
        ancestors
      );
      if (!child.ok) return child;
      snapshot[key] = child.value;
      writtenKeys += 1;
    }
    const envelopeFailure = consumeSnapshotBytes(budget, 2);
    return envelopeFailure ?? { ok: true, value: snapshot };
  } finally {
    ancestors.delete(value);
  }
}

function createSafeObjectSnapshot(input: object): SafeObjectSnapshotResult {
  try {
    return snapshotObjectValue(
      input,
      "$",
      0,
      { remainingBytes: STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES },
      new WeakSet<object>()
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return invalidObjectSnapshot(`객체 안전 스냅샷 실패: ${detail}`);
  }
}

function fail(
  code: StudioGeometryNodesDocErrorCode,
  detail: string
): StudioGeometryNodesParseResult {
  return { ok: false, code, detail };
}

function sortedParams(
  params: Readonly<Record<string, StudioGeometryParamValue>>
): Record<string, StudioGeometryParamValue> {
  const out: Record<string, StudioGeometryParamValue> = {};
  for (const key of Object.keys(params).sort()) out[key] = params[key];
  return out;
}

function sortLinks(links: readonly StudioGeometryGraphLink[]): StudioGeometryGraphLink[] {
  return links.slice().sort((a, b) => {
    if (a.toNode !== b.toNode) return a.toNode < b.toNode ? -1 : 1;
    if (a.toSocket !== b.toSocket) return a.toSocket < b.toSocket ? -1 : 1;
    if (a.fromNode !== b.fromNode) return a.fromNode < b.fromNode ? -1 : 1;
    if (a.fromSocket !== b.fromSocket) return a.fromSocket < b.fromSocket ? -1 : 1;
    return 0;
  });
}

/** 정규형 JSON 문자열. 같은 그래프는 항상 같은 문자열이 된다. */
export function serializeStudioGeometryNodesGraph(graph: StudioGeometryGraph): string {
  const document: SerializedDocument = {
    kind: STUDIO_GEOMETRY_NODES_DOC_KIND,
    version: STUDIO_GEOMETRY_NODES_DOC_VERSION,
    outputNodeId: graph.outputNodeId,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      params: sortedParams(node.params),
    })),
    links: sortLinks(graph.links).map((link) => ({
      fromNode: link.fromNode,
      fromSocket: link.fromSocket,
      toNode: link.toNode,
      toSocket: link.toSocket,
    })),
  };
  return JSON.stringify(document);
}

function parseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > STUDIO_GEOMETRY_NODES_DOC_MAX_ID_LENGTH) return null;
  return value;
}

/**
 * 문자열 또는 이미 파싱된 객체를 받아 그래프로 정규화한다. **절대 throw 하지 않는다.**
 * 파라미터는 레지스트리 스키마로 정규화되므로(범위 클램프·타입 불일치 시 기본값), NaN·문자열
 * 오염이 그래프 안으로 들어오지 못한다.
 */
export function parseStudioGeometryNodesGraph(
  input: unknown,
  registry: StudioGeometryNodeRegistry = studioGeometryDefaultNodeRegistry
): StudioGeometryNodesParseResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    if (input.length > STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES) {
      return fail("too-large", `문서 ${input.length}B > 상한 ${STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES}B`);
    }
    const inputBytes = utf8ByteLength(input);
    if (inputBytes > STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES) {
      return fail(
        "too-large",
        `문서 ${inputBytes}B > 상한 ${STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES}B`
      );
    }
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail("invalid-json", `JSON 파싱 실패: ${detail}`);
    }
  } else if (typeof input === "object" && input !== null) {
    const snapshot = createSafeObjectSnapshot(input);
    if (!snapshot.ok) return fail(snapshot.code, snapshot.detail);
    raw = snapshot.value;
  }
  if (!isRecord(raw)) return fail("not-an-object", "문서가 객체가 아닙니다.");
  if (raw.kind !== STUDIO_GEOMETRY_NODES_DOC_KIND) {
    return fail("kind-mismatch", `kind 가 "${String(raw.kind)}" 입니다.`);
  }
  if (raw.version !== STUDIO_GEOMETRY_NODES_DOC_VERSION) {
    return fail("version-unsupported", `version ${String(raw.version)} 은 지원하지 않습니다.`);
  }
  if (!Array.isArray(raw.nodes)) return fail("invalid-node", "nodes 가 배열이 아닙니다.");
  if (!Array.isArray(raw.links)) return fail("invalid-link", "links 가 배열이 아닙니다.");
  const nodes: StudioGeometryGraphNode[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.nodes.length; i++) {
    const entry: unknown = raw.nodes[i];
    if (!isRecord(entry)) return fail("invalid-node", `nodes[${i}] 가 객체가 아닙니다.`);
    const id = parseId(entry.id);
    if (id === null) return fail("invalid-id", `nodes[${i}].id 가 유효하지 않습니다.`);
    if (seenIds.has(id)) return fail("duplicate-node-id", `노드 id "${id}" 가 중복입니다.`);
    if (typeof entry.type !== "string") {
      return fail("invalid-node", `nodes[${i}].type 이 문자열이 아닙니다.`);
    }
    const definition = registry.get(entry.type);
    if (!definition) {
      return fail("unknown-node-type", `등록되지 않은 노드 타입 "${entry.type}"`);
    }
    const rawParams = isRecord(entry.params) ? entry.params : {};
    const params: Record<string, StudioGeometryParamValue> = studioGeometryDefaultParams(definition);
    for (const spec of definition.params) {
      params[spec.key] = studioGeometryNormalizeParam(spec, rawParams[spec.key]);
    }
    seenIds.add(id);
    nodes.push({ id, type: entry.type, params: sortedParams(params) });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links: StudioGeometryGraphLink[] = [];
  const occupiedInputs = new Set<string>();
  for (let i = 0; i < raw.links.length; i++) {
    const entry: unknown = raw.links[i];
    if (!isRecord(entry)) return fail("invalid-link", `links[${i}] 가 객체가 아닙니다.`);
    const fromNode = parseId(entry.fromNode);
    const toNode = parseId(entry.toNode);
    if (fromNode === null || toNode === null) {
      return fail("invalid-link", `links[${i}] 의 노드 id 가 유효하지 않습니다.`);
    }
    if (typeof entry.fromSocket !== "string" || typeof entry.toSocket !== "string") {
      return fail("invalid-link", `links[${i}] 의 소켓 이름이 문자열이 아닙니다.`);
    }
    const from = nodeById.get(fromNode);
    const to = nodeById.get(toNode);
    if (!from || !to) {
      return fail("dangling-link", `links[${i}] 가 없는 노드를 가리킵니다(${fromNode} → ${toNode}).`);
    }
    const fromDefinition = registry.get(from.type);
    const toDefinition = registry.get(to.type);
    if (!fromDefinition || !toDefinition) {
      return fail("unknown-node-type", `links[${i}] 의 노드 타입을 찾을 수 없습니다.`);
    }
    if (!fromDefinition.outputs.some((socket) => socket.key === entry.fromSocket)) {
      return fail("unknown-socket", `"${from.type}" 에 출력 소켓 "${entry.fromSocket}" 이 없습니다.`);
    }
    if (!toDefinition.inputs.some((socket) => socket.key === entry.toSocket)) {
      return fail("unknown-socket", `"${to.type}" 에 입력 소켓 "${entry.toSocket}" 이 없습니다.`);
    }
    const inputKey = `${toNode} ${entry.toSocket}`;
    if (occupiedInputs.has(inputKey)) {
      return fail("invalid-link", `입력 소켓 "${inputKey}" 에 링크가 둘 이상입니다.`);
    }
    occupiedInputs.add(inputKey);
    links.push({ fromNode, fromSocket: entry.fromSocket, toNode, toSocket: entry.toSocket });
  }

  let outputNodeId: string | null = null;
  if (raw.outputNodeId !== null && raw.outputNodeId !== undefined) {
    const parsed = parseId(raw.outputNodeId);
    if (parsed === null) return fail("invalid-id", "outputNodeId 가 유효하지 않습니다.");
    if (!nodeById.has(parsed)) {
      return fail("dangling-link", `outputNodeId "${parsed}" 에 해당하는 노드가 없습니다.`);
    }
    outputNodeId = parsed;
  }

  return { ok: true, graph: { nodes, links: sortLinks(links), outputNodeId } };
}

/**
 * 기본 예시 그래프 — 격자 → 압출 → 출력. 패널의 "새 그래프" 초기 상태이자,
 * 직렬화 라운드트립 테스트의 고정 픽스처다.
 */
export function createStudioGeometryNodesStarterGraph(): StudioGeometryGraph {
  const gridDefinition = studioGeometryDefaultNodeRegistry.get("mesh-grid");
  const extrudeDefinition = studioGeometryDefaultNodeRegistry.get("extrude");
  const outputDefinition = studioGeometryDefaultNodeRegistry.get("output");
  const nodes: StudioGeometryGraphNode[] = [];
  if (gridDefinition) {
    nodes.push({ id: "grid", type: "mesh-grid", params: studioGeometryDefaultParams(gridDefinition) });
  }
  if (extrudeDefinition) {
    nodes.push({
      id: "extrude",
      type: "extrude",
      params: { ...studioGeometryDefaultParams(extrudeDefinition), distance: 0.25 },
    });
  }
  if (outputDefinition) {
    nodes.push({ id: "output", type: "output", params: studioGeometryDefaultParams(outputDefinition) });
  }
  return {
    nodes,
    links: [
      { fromNode: "grid", fromSocket: "geometry", toNode: "extrude", toSocket: "geometry" },
      { fromNode: "extrude", fromSocket: "geometry", toNode: "output", toSocket: "geometry" },
    ],
    outputNodeId: "output",
  };
}
