/**
 * 지오메트리 노드 — 메모이제이션 평가기.
 *
 * ## 평가 순서
 * `validateStudioGeometryGraph` 가 낸 위상 순서를 그대로 따른다(동률은 선언 인덱스 우선).
 * 사이클·타입 불일치 등 구조 문제는 평가를 시작하지도 않고 `graph-invalid` 로 되돌린다.
 *
 * ## 캐시 키 (여기가 핵심)
 * 노드의 캐시 키 = FNV-1a( 노드 타입 | 정규화 파라미터 | 각 입력 소켓의 "상류 캐시 키:소켓" ).
 * 노드 **id 는 키에 들어가지 않는다** — 같은 계산이면 다른 노드여도 캐시를 공유한다.
 * 이 정의의 결과로:
 *  - 팬아웃(한 노드가 여러 곳으로 감)이 있어도 그 노드는 **한 번만** 계산된다.
 *  - 같은 그래프를 다시 평가하면 모든 키가 그대로라 **한 번도** 계산하지 않는다.
 *  - 리프 파라미터 하나를 바꾸면 그 노드와 **하류만** 키가 바뀌어 재계산되고, 나머지는 캐시 적중.
 * 테스트는 이 세 가지를 카운팅 스텁 레지스트리로 정수 단언한다.
 *
 * ## 예산
 * 바이트 + 엔트리 이중 LRU(기본 128MiB / 256 엔트리) — WebGPU 타일 런타임의 예산 관용구를
 * 그대로 가져왔다. 맵 삽입 순서가 곧 LRU 순서이고, 적중 시 delete→set 으로 뒤로 민다.
 *
 * ## 실패 전파
 * 노드 평가 실패는 예외가 아니라 `{ ok:false, code, nodeId }` 다. 실패한 노드의 하류는
 * 평가하지 않고 즉시 반환한다(부분 결과를 렌더에 흘리지 않는다).
 */

import { validateStudioGeometryGraph } from "./studio-geometry-nodes-graph";
import {
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryMeshByteLength,
} from "./studio-geometry-nodes-mesh";
import { studioGeometryDefaultNodeRegistry } from "./studio-geometry-nodes-registry";

import type { StudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import type {
  StudioGeometryGraph,
  StudioGeometryGraphIssue,
  StudioGeometryGraphLink,
  StudioGeometryParamValue,
} from "./studio-geometry-nodes-graph";
import type {
  StudioGeometryBudgets,
  StudioGeometryFailureCode,
} from "./studio-geometry-nodes-mesh";
import type {
  StudioGeometryNodeRegistry,
  StudioGeometryOutputs,
  StudioGeometryValue,
} from "./studio-geometry-nodes-registry";

export const STUDIO_GEOMETRY_CACHE_DEFAULT_BYTES = 128 * 1024 * 1024;
export const STUDIO_GEOMETRY_CACHE_DEFAULT_ENTRIES = 256;

export interface StudioGeometryEvaluatorOptions {
  readonly registry?: StudioGeometryNodeRegistry;
  readonly booleanBackend?: StudioGeometryNodesPlanarBooleanBackend | null;
  readonly budgets?: StudioGeometryBudgets;
  readonly cacheMaxBytes?: number;
  readonly cacheMaxEntries?: number;
}

export interface StudioGeometryEvaluatorStats {
  readonly evaluations: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cachedEntries: number;
  readonly cachedBytes: number;
}

export type StudioGeometryEvaluateResult =
  | {
      readonly ok: true;
      readonly nodeId: string;
      readonly outputs: StudioGeometryOutputs;
      readonly order: readonly string[];
      /** 이번 호출에서 실제로 계산한 노드 수(캐시 적중 제외). */
      readonly computed: number;
      readonly hits: number;
    }
  | {
      readonly ok: false;
      readonly code: StudioGeometryFailureCode | "graph-invalid" | "no-output-node";
      readonly detail: string;
      readonly nodeId: string | null;
      readonly issues: readonly StudioGeometryGraphIssue[];
    };

export interface StudioGeometryNodesEvaluator {
  readonly evaluate: (graph: StudioGeometryGraph) => StudioGeometryEvaluateResult;
  readonly stats: () => StudioGeometryEvaluatorStats;
  readonly clearCache: () => void;
}

// ---------------------------------------------------------------------------
// 키 생성
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32비트 — Math.imul 만 쓰므로 엔진 무관하게 동일. */
export function studioGeometryFnv1a(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 파라미터를 키 순서대로 직렬화. -0 은 0 으로 접어 키가 갈리지 않게 한다. */
export function studioGeometryCanonicalParams(
  params: Readonly<Record<string, StudioGeometryParamValue>>
): string {
  const keys = Object.keys(params).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number") parts.push(`${key}=${value === 0 ? 0 : value}`);
    else parts.push(`${key}=${String(value)}`);
  }
  return parts.join(",");
}

interface CacheEntry {
  readonly outputs: StudioGeometryOutputs;
  readonly bytes: number;
}

function valueBytes(value: StudioGeometryValue): number {
  switch (value.kind) {
    case "geometry":
      return studioGeometryMeshByteLength(value.mesh);
    case "points":
      return value.points.positions.byteLength + (value.points.normals?.byteLength ?? 0);
    default:
      return 16;
  }
}

function outputsBytes(outputs: StudioGeometryOutputs): number {
  let total = 0;
  for (const key of Object.keys(outputs)) total += valueBytes(outputs[key]);
  return total;
}

// ---------------------------------------------------------------------------
// 평가기
// ---------------------------------------------------------------------------

export function createStudioGeometryNodesEvaluator(
  options: StudioGeometryEvaluatorOptions = {}
): StudioGeometryNodesEvaluator {
  const registry = options.registry ?? studioGeometryDefaultNodeRegistry;
  const budgets = options.budgets ?? STUDIO_GEOMETRY_DEFAULT_BUDGETS;
  const booleanBackend = options.booleanBackend ?? null;
  const maxBytes =
    Number.isFinite(options.cacheMaxBytes ?? NaN) && (options.cacheMaxBytes as number) > 0
      ? (options.cacheMaxBytes as number)
      : STUDIO_GEOMETRY_CACHE_DEFAULT_BYTES;
  const maxEntries =
    Number.isFinite(options.cacheMaxEntries ?? NaN) && (options.cacheMaxEntries as number) > 0
      ? Math.trunc(options.cacheMaxEntries as number)
      : STUDIO_GEOMETRY_CACHE_DEFAULT_ENTRIES;

  const cache = new Map<string, CacheEntry>();
  let cachedBytes = 0;
  let evaluations = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  const touch = (key: string): CacheEntry | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  };

  const store = (key: string, outputs: StudioGeometryOutputs): void => {
    const bytes = outputsBytes(outputs);
    if (bytes > maxBytes) return;
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key);
      cachedBytes -= existing.bytes;
    }
    cache.set(key, { outputs, bytes });
    cachedBytes += bytes;
    while ((cachedBytes > maxBytes || cache.size > maxEntries) && cache.size > 0) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      const victim = cache.get(oldest.value);
      cache.delete(oldest.value);
      if (victim) cachedBytes -= victim.bytes;
    }
  };

  const evaluate = (graph: StudioGeometryGraph): StudioGeometryEvaluateResult => {
    const validation = validateStudioGeometryGraph(graph, registry);
    if (!validation.ok) {
      return {
        ok: false,
        code: "graph-invalid",
        detail:
          validation.cycleNodeIds.length > 0
            ? `그래프에 사이클이 있습니다: ${validation.cycleNodeIds.join(", ")}`
            : validation.issues.map((entry) => entry.detail).join(" / "),
        nodeId: validation.issues[0]?.nodeId ?? null,
        issues: validation.issues,
      };
    }
    const order = validation.order;
    if (order.length === 0) {
      return { ok: false, code: "no-output-node", detail: "노드가 없습니다.", nodeId: null, issues: [] };
    }
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, StudioGeometryGraphLink>();
    for (const link of graph.links) incoming.set(`${link.toNode} ${link.toSocket}`, link);

    const keyByNode = new Map<string, string>();
    const outputsByNode = new Map<string, StudioGeometryOutputs>();
    let computed = 0;
    let hits = 0;

    for (const nodeId of order) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const definition = registry.get(node.type);
      if (!definition) {
        return {
          ok: false,
          code: "invalid-parameter",
          detail: `등록되지 않은 노드 타입 "${node.type}"`,
          nodeId,
          issues: [],
        };
      }
      const inputs: Record<string, StudioGeometryValue | undefined> = {};
      const keyParts: string[] = [node.type, studioGeometryCanonicalParams(node.params)];
      const sortedInputs = definition.inputs.slice().sort((a, b) => (a.key < b.key ? -1 : 1));
      for (const spec of sortedInputs) {
        const link = incoming.get(`${nodeId} ${spec.key}`);
        if (!link) {
          if (!spec.optional) {
            return {
              ok: false,
              code: "missing-input",
              detail: `노드 "${nodeId}" 의 필수 입력 "${spec.key}" 가 연결되지 않았습니다.`,
              nodeId,
              issues: [],
            };
          }
          keyParts.push(`${spec.key}=-`);
          continue;
        }
        const upstream = outputsByNode.get(link.fromNode);
        const value = upstream?.[link.fromSocket];
        if (!value) {
          return {
            ok: false,
            code: "missing-input",
            detail: `노드 "${nodeId}" 의 입력 "${spec.key}" 상류 출력이 없습니다.`,
            nodeId,
            issues: [],
          };
        }
        inputs[spec.key] = value;
        keyParts.push(`${spec.key}=${keyByNode.get(link.fromNode) ?? "?"}:${link.fromSocket}`);
      }
      const cacheKey = studioGeometryFnv1a(keyParts.join("|"));
      keyByNode.set(nodeId, cacheKey);
      const cached = touch(cacheKey);
      if (cached) {
        cacheHits += 1;
        hits += 1;
        outputsByNode.set(nodeId, cached.outputs);
        continue;
      }
      cacheMisses += 1;
      evaluations += 1;
      computed += 1;
      const result = definition.evaluate({
        params: node.params,
        inputs,
        booleanBackend,
        budgets,
      });
      if (!result.ok) {
        return { ok: false, code: result.code, detail: result.detail, nodeId, issues: [] };
      }
      outputsByNode.set(nodeId, result.value);
      store(cacheKey, result.value);
    }

    const targetId = graph.outputNodeId ?? order[order.length - 1];
    const outputs = outputsByNode.get(targetId);
    if (!outputs) {
      return {
        ok: false,
        code: "no-output-node",
        detail: `출력 노드 "${targetId}" 를 평가하지 못했습니다.`,
        nodeId: targetId,
        issues: [],
      };
    }
    return { ok: true, nodeId: targetId, outputs, order, computed, hits };
  };

  return {
    evaluate,
    stats: () => ({
      evaluations,
      cacheHits,
      cacheMisses,
      cachedEntries: cache.size,
      cachedBytes,
    }),
    clearCache: () => {
      cache.clear();
      cachedBytes = 0;
    },
  };
}
