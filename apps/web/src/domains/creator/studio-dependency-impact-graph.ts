/**
 * Project-wide dependency and change-impact planning for Studio.
 *
 * An edge is intentionally directional: `dependencyId -> dependentId`. If the dependency
 * changes, the dependent may need review or rework. The module has no React, DOM, canvas, network,
 * persistence, or StudioPage dependency, so project hydration and future Worker execution can use
 * the same deterministic contract.
 */

export const STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION = 1 as const;

export const STUDIO_DEPENDENCY_IMPACT_LIMITS = Object.freeze({
  maxNodes: 20_000,
  maxEdges: 100_000,
  maxChanges: 64,
  maxSelectedNodes: 20_000,
  maxDiagnostics: 256,
  maxTraversalPairs: 250_000,
  maxIdLength: 160,
  maxLabelLength: 160,
  maxReasonLength: 320,
  maxReworkMinutes: 525_600,
});

export const STUDIO_DEPENDENCY_NODE_KINDS = [
  "work",
  "scene",
  "shot",
  "panel",
  "dialogue",
  "localization",
  "balloon",
  "character",
  "costume",
  "location",
  "asset",
  "component",
  "font",
  "camera",
  "lighting",
  "platform",
  "export-preset",
  "task",
  "approval",
  "other",
] as const;

export type StudioDependencyNodeKind =
  (typeof STUDIO_DEPENDENCY_NODE_KINDS)[number];

export const STUDIO_DEPENDENCY_RELATIONS = [
  "uses",
  "contains",
  "derives-from ",
  "styles-with",
  "renders-with",
  "localizes",
  "exports-with",
  "reviews",
  "replaces",
] as const;

export type StudioDependencyRelation =
  (typeof STUDIO_DEPENDENCY_RELATIONS)[number];

export type StudioDependencyApprovalState =
  | "draft"
  | "in-review"
  | "approved";

export interface StudioDependencyNode {
  readonly id: string;
  readonly kind: StudioDependencyNodeKind;
  readonly label: string;
  readonly approval: StudioDependencyApprovalState;
  readonly reworkMinutes: number;
  readonly assigneeId?: string | null;
  readonly version?: string | null;
}

export interface StudioDependencyEdge {
  /** Stable ID of the source object whose change can propagate. */
  readonly dependencyId: string;
  /** Stable ID of the object that consumes or derives from the dependency. */
  readonly dependentId: string;
  readonly relation: StudioDependencyRelation;
  readonly reason?: string;
}

export interface StudioDependencyImpactGraphInput {
  readonly nodes: readonly StudioDependencyNode[];
  readonly edges: readonly StudioDependencyEdge[];
}

export type StudioDependencyGraphDiagnosticCode =
  | "DANGLING_DEPENDENCY"
  | "DANGLING_DEPENDENT"
  | "DUPLICATE_EDGE"
  | "SELF_DEPENDENCY"
  | "DEPENDENCY_CYCLE"
  | "DIAGNOSTIC_LIMIT_APPLIED";

export interface StudioDependencyGraphDiagnostic {
  readonly code: StudioDependencyGraphDiagnosticCode;
  readonly message: string;
  readonly nodeIds: readonly string[];
}

export interface StudioDependencyImpactGraph {
  readonly version: typeof STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION;
  readonly nodes: readonly StudioDependencyNode[];
  readonly edges: readonly StudioDependencyEdge[];
  readonly diagnostics: readonly StudioDependencyGraphDiagnostic[];
}

export type StudioDependencyImpactGraphErrorCode =
  | "INVALID_GRAPH"
  | "GRAPH_LIMIT_EXCEEDED"
  | "DUPLICATE_NODE"
  | "INVALID_CHANGE"
  | "UNKNOWN_CHANGE_NODE"
  | "INVALID_SELECTION";

export class StudioDependencyImpactGraphError extends Error {
  readonly code: StudioDependencyImpactGraphErrorCode;

  constructor(code: StudioDependencyImpactGraphErrorCode, message: string) {
    super(message);
    this.name = "StudioDependencyImpactGraphError";
    this.code = code;
  }
}

export const STUDIO_IMPACT_CHANGE_KINDS = [
  "style",
  "content",
  "replacement",
  "specification",
  "deletion",
  "license",
] as const;

export type StudioImpactChangeKind =
  (typeof STUDIO_IMPACT_CHANGE_KINDS)[number];

export interface StudioImpactChange {
  readonly nodeId: string;
  readonly kind: StudioImpactChangeKind;
  readonly reason?: string;
}

export type StudioImpactSeverity = "low" | "medium" | "high" | "critical";

export interface StudioImpactPath {
  readonly rootNodeId: string;
  readonly nodeIds: readonly string[];
  readonly relations: readonly StudioDependencyRelation[];
}

export interface StudioImpactItem {
  readonly node: StudioDependencyNode;
  readonly depth: number;
  readonly severity: StudioImpactSeverity;
  readonly changeKinds: readonly StudioImpactChangeKind[];
  readonly reasons: readonly string[];
  readonly paths: readonly StudioImpactPath[];
  readonly requiresApprovalReview: boolean;
  readonly estimatedReworkMinutes: number;
}

export interface StudioImpactChangedNode {
  readonly node: StudioDependencyNode;
  readonly changeKinds: readonly StudioImpactChangeKind[];
  readonly reasons: readonly string[];
}

export interface StudioImpactAssigneeSummary {
  readonly assigneeId: string;
  readonly nodeIds: readonly string[];
  readonly estimatedReworkMinutes: number;
}

export interface StudioDependencyImpactPreview {
  readonly graphVersion: typeof STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION;
  readonly changed: readonly StudioImpactChangedNode[];
  readonly impacts: readonly StudioImpactItem[];
  readonly severityCounts: Readonly<Record<StudioImpactSeverity, number>>;
  readonly kindCounts: Readonly<Partial<Record<StudioDependencyNodeKind, number>>>;
  readonly approvedImpactCount: number;
  readonly totalEstimatedReworkMinutes: number;
  readonly assignees: readonly StudioImpactAssigneeSummary[];
  readonly unaffectedNodeCount: number;
  readonly truncated: boolean;
  readonly graphDiagnostics: readonly StudioDependencyGraphDiagnostic[];
}

export interface PreviewStudioDependencyImpactOptions {
  readonly maxImpacts?: number;
}

export type StudioImpactApplicationMode = "all" | "selected";

export interface PlanStudioImpactApplicationOptions {
  readonly mode: StudioImpactApplicationMode;
  readonly selectedNodeIds?: readonly string[];
  /** Approved consumers are held for explicit review by default. */
  readonly includeApproved?: boolean;
}

export type StudioImpactSkipReason = "not-selected" | "approved";

export interface StudioImpactSkippedNode {
  readonly nodeId: string;
  readonly reason: StudioImpactSkipReason;
}

export interface StudioImpactTask {
  readonly id: string;
  readonly nodeId: string;
  readonly title: string;
  readonly assigneeId: string | null;
  readonly estimatedReworkMinutes: number;
  readonly triggerNodeIds: readonly string[];
  readonly severity: StudioImpactSeverity;
}

export interface StudioImpactNotification {
  readonly assigneeId: string;
  readonly nodeIds: readonly string[];
  readonly estimatedReworkMinutes: number;
}

export interface StudioImpactApplicationPlan {
  readonly mode: StudioImpactApplicationMode;
  readonly includeApproved: boolean;
  readonly applyNodeIds: readonly string[];
  readonly skipped: readonly StudioImpactSkippedNode[];
  readonly reviewRequiredNodeIds: readonly string[];
  readonly unknownSelectedNodeIds: readonly string[];
  readonly tasks: readonly StudioImpactTask[];
  readonly notifications: readonly StudioImpactNotification[];
  readonly estimatedReworkMinutes: number;
  readonly unaffectedNodeCount: number;
}

const NODE_KIND_SET = new Set<string>(STUDIO_DEPENDENCY_NODE_KINDS);
const RELATION_SET = new Set<string>(STUDIO_DEPENDENCY_RELATIONS);
const APPROVAL_SET = new Set<string>(["draft", "in-review", "approved"]);
const CHANGE_KIND_SET = new Set<string>(STUDIO_IMPACT_CHANGE_KINDS);
const FORBIDDEN_IDS = new Set(["__proto__", "prototype", "constructor"]);

const CHANGE_STRENGTH: Readonly<Record<StudioImpactChangeKind, number>> = {
  style: 1,
  content: 2,
  replacement: 3,
  specification: 3,
  deletion: 4,
  license: 4,
};

const SEVERITY_ORDER: Readonly<Record<StudioImpactSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function fail(
  code: StudioDependencyImpactGraphErrorCode,
  message: string,
): never {
  throw new StudioDependencyImpactGraphError(code, message);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function canonicalText(
  value: unknown,
  label: string,
  maximumLength: number,
  options: { allowEmpty?: boolean; forbidPrototypeKey?: boolean } = {},
): string {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || (!options.allowEmpty && value.length === 0)
    || value.length > maximumLength
    || hasControlCharacters(value)
    || (options.forbidPrototypeKey && FORBIDDEN_IDS.has(value))
  ) {
    fail("INVALID_GRAPH", `${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function canonicalOptionalText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return canonicalText(value, label, maximumLength);
}

function canonicalNode(raw: StudioDependencyNode, index: number): StudioDependencyNode {
  const id = canonicalText(
    raw?.id,
    `nodes[${index}].id`,
    STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
    { forbidPrototypeKey: true },
  );
  const label = canonicalText(
    raw?.label,
    `nodes[${index}].label`,
    STUDIO_DEPENDENCY_IMPACT_LIMITS.maxLabelLength,
  );
  if (!NODE_KIND_SET.has(raw?.kind)) {
    fail("INVALID_GRAPH", `nodes[${index}].kind 값이 올바르지 않습니다.`);
  }
  if (!APPROVAL_SET.has(raw?.approval)) {
    fail("INVALID_GRAPH", `nodes[${index}].approval 값이 올바르지 않습니다.`);
  }
  if (
    !Number.isSafeInteger(raw?.reworkMinutes)
    || raw.reworkMinutes < 0
    || raw.reworkMinutes > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxReworkMinutes
  ) {
    fail("INVALID_GRAPH", `nodes[${index}].reworkMinutes 값이 올바르지 않습니다.`);
  }
  const assigneeId =
    raw.assigneeId === null || raw.assigneeId === undefined
      ? raw.assigneeId
      : canonicalText(
          raw.assigneeId,
          `nodes[${index}].assigneeId`,
          STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
          { forbidPrototypeKey: true },
        );
  const version =
    raw.version === null || raw.version === undefined
      ? raw.version
      : canonicalText(
          raw.version,
          `nodes[${index}].version`,
          STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
        );
  return Object.freeze({
    id,
    kind: raw.kind,
    label,
    approval: raw.approval,
    reworkMinutes: raw.reworkMinutes,
    ...(assigneeId !== undefined ? { assigneeId } : {}),
    ...(version !== undefined ? { version } : {}),
  });
}

function canonicalEdge(raw: StudioDependencyEdge, index: number): StudioDependencyEdge {
  const dependencyId = canonicalText(
    raw?.dependencyId,
    `edges[${index}].dependencyId`,
    STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
    { forbidPrototypeKey: true },
  );
  const dependentId = canonicalText(
    raw?.dependentId,
    `edges[${index}].dependentId`,
    STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
    { forbidPrototypeKey: true },
  );
  if (!RELATION_SET.has(raw?.relation)) {
    fail("INVALID_GRAPH", `edges[${index}].relation 값이 올바르지 않습니다.`);
  }
  const reason = canonicalOptionalText(
    raw.reason,
    `edges[${index}].reason`,
    STUDIO_DEPENDENCY_IMPACT_LIMITS.maxReasonLength,
  );
  return Object.freeze({
    dependencyId,
    dependentId,
    relation: raw.relation,
    ...(reason ? { reason } : {}),
  });
}

function freezeDiagnostic(
  code: StudioDependencyGraphDiagnosticCode,
  message: string,
  nodeIds: readonly string[],
): StudioDependencyGraphDiagnostic {
  return Object.freeze({
    code,
    message,
    nodeIds: Object.freeze([...nodeIds].sort()),
  });
}

function adjacencyFor(
  nodeIds: readonly string[],
  edges: readonly StudioDependencyEdge[],
  reverse: boolean,
): Map<string, string[]> {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    const from = reverse ? edge.dependentId : edge.dependencyId;
    const to = reverse ? edge.dependencyId : edge.dependentId;
    adjacency.get(from)?.push(to);
  }
  for (const values of adjacency.values()) values.sort();
  return adjacency;
}

function finishingOrder(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  for (const root of nodeIds) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack: Array<{ nodeId: string; next: number }> = [
      { nodeId: root, next: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const children = adjacency.get(frame.nodeId) ?? [];
      const child = children[frame.next];
      if (child !== undefined) {
        frame.next += 1;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push({ nodeId: child, next: 0 });
        }
        continue;
      }
      order.push(frame.nodeId);
      stack.pop();
    }
  }
  return order;
}

function dependencyCycles(
  nodeIds: readonly string[],
  edges: readonly StudioDependencyEdge[],
): string[][] {
  const forward = adjacencyFor(nodeIds, edges, false);
  const reverse = adjacencyFor(nodeIds, edges, true);
  const order = finishingOrder(nodeIds, forward);
  const assigned = new Set<string>();
  const cycles: string[][] = [];

  for (let orderIndex = order.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const root = order[orderIndex]!;
    if (assigned.has(root)) continue;
    assigned.add(root);
    const component: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      component.push(nodeId);
      for (const child of reverse.get(nodeId) ?? []) {
        if (assigned.has(child)) continue;
        assigned.add(child);
        stack.push(child);
      }
    }
    if (component.length > 1) cycles.push(component.sort());
  }
  return cycles.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

export function createStudioDependencyImpactGraph(
  input: StudioDependencyImpactGraphInput,
): StudioDependencyImpactGraph {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    return fail("INVALID_GRAPH", "변경 영향 그래프 입력이 올바르지 않습니다.");
  }
  if (
    input.nodes.length > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxNodes
    || input.edges.length > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxEdges
  ) {
    return fail("GRAPH_LIMIT_EXCEEDED", "변경 영향 그래프가 안전 한도를 초과했습니다.");
  }

  const nodes = input.nodes.map(canonicalNode).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const nodeById = new Map<string, StudioDependencyNode>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) {
      return fail("DUPLICATE_NODE", `중복된 변경 영향 노드 ID입니다: ${node.id}`);
    }
    nodeById.set(node.id, node);
  }

  const diagnostics: StudioDependencyGraphDiagnostic[] = [];
  let omittedDiagnosticCount = 0;
  const addDiagnostic = (
    code: StudioDependencyGraphDiagnosticCode,
    message: string,
    nodeIds: readonly string[],
  ) => {
    if (diagnostics.length < STUDIO_DEPENDENCY_IMPACT_LIMITS.maxDiagnostics) {
      diagnostics.push(freezeDiagnostic(code, message, nodeIds));
    } else {
      omittedDiagnosticCount += 1;
    }
  };

  const edges: StudioDependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  for (let index = 0; index < input.edges.length; index += 1) {
    const edge = canonicalEdge(input.edges[index]!, index);
    const dependencyExists = nodeById.has(edge.dependencyId);
    const dependentExists = nodeById.has(edge.dependentId);
    if (!dependencyExists) {
      addDiagnostic(
        "DANGLING_DEPENDENCY",
        `존재하지 않는 원본을 참조합니다: ${edge.dependencyId}`,
        [edge.dependencyId, edge.dependentId],
      );
    }
    if (!dependentExists) {
      addDiagnostic(
        "DANGLING_DEPENDENT",
        `존재하지 않는 사용 위치를 참조합니다: ${edge.dependentId}`,
        [edge.dependencyId, edge.dependentId],
      );
    }
    if (!dependencyExists || !dependentExists) continue;
    if (edge.dependencyId === edge.dependentId) {
      addDiagnostic(
        "SELF_DEPENDENCY",
        `객체가 자기 자신을 참조합니다: ${edge.dependencyId}`,
        [edge.dependencyId],
      );
      continue;
    }
    const edgeKey = JSON.stringify([
      edge.dependencyId,
      edge.dependentId,
      edge.relation,
    ]);
    if (edgeKeys.has(edgeKey)) {
      addDiagnostic(
        "DUPLICATE_EDGE",
        `중복된 변경 영향 연결입니다: ${edge.dependencyId} → ${edge.dependentId}`,
        [edge.dependencyId, edge.dependentId],
      );
      continue;
    }
    edgeKeys.add(edgeKey);
    edges.push(edge);
  }
  edges.sort(
    (left, right) =>
      left.dependencyId.localeCompare(right.dependencyId)
      || left.dependentId.localeCompare(right.dependentId)
      || left.relation.localeCompare(right.relation),
  );

  for (const cycle of dependencyCycles(
    nodes.map(({ id }) => id),
    edges,
  )) {
    addDiagnostic(
      "DEPENDENCY_CYCLE",
      `순환 참조를 발견했습니다: ${cycle.join(" → ")}`,
      cycle,
    );
  }
  if (omittedDiagnosticCount > 0) {
    if (diagnostics.length === STUDIO_DEPENDENCY_IMPACT_LIMITS.maxDiagnostics) {
      diagnostics.pop();
      omittedDiagnosticCount += 1;
    }
    diagnostics.push(
      freezeDiagnostic(
        "DIAGNOSTIC_LIMIT_APPLIED",
        `진단 ${omittedDiagnosticCount}개를 안전 한도 때문에 생략했습니다.`,
        [],
      ),
    );
  }

  return Object.freeze({
    version: STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    diagnostics: Object.freeze(diagnostics),
  });
}

interface RootChange {
  readonly node: StudioDependencyNode;
  readonly kinds: Set<StudioImpactChangeKind>;
  readonly reasons: Set<string>;
}

interface MutableImpact {
  readonly node: StudioDependencyNode;
  depth: number;
  readonly kinds: Set<StudioImpactChangeKind>;
  readonly reasons: Set<string>;
  readonly paths: Map<string, StudioImpactPath>;
}

function severityForImpact(
  kinds: ReadonlySet<StudioImpactChangeKind>,
  depth: number,
  approved: boolean,
): StudioImpactSeverity {
  let strongest = 1;
  let criticalAtAnyDepth = false;
  for (const kind of kinds) {
    strongest = Math.max(strongest, CHANGE_STRENGTH[kind]);
    criticalAtAnyDepth ||= kind === "deletion" || kind === "license";
  }
  if (criticalAtAnyDepth) return "critical";
  if (approved && strongest >= 2) return "high";
  if (strongest >= 3) return depth <= 2 ? "high" : "medium";
  if (strongest >= 2) return "medium";
  return "low";
}

function outgoingEdges(
  graph: StudioDependencyImpactGraph,
): Map<string, StudioDependencyEdge[]> {
  const outgoing = new Map<string, StudioDependencyEdge[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) outgoing.get(edge.dependencyId)?.push(edge);
  return outgoing;
}

function sortedChangeKinds(
  kinds: ReadonlySet<StudioImpactChangeKind>,
): StudioImpactChangeKind[] {
  return [...kinds].sort(
    (left, right) =>
      CHANGE_STRENGTH[right] - CHANGE_STRENGTH[left]
      || left.localeCompare(right),
  );
}

function assigneeSummaries(
  impacts: readonly StudioImpactItem[],
): StudioImpactAssigneeSummary[] {
  const mutable = new Map<
    string,
    { nodeIds: string[]; estimatedReworkMinutes: number }
  >();
  for (const impact of impacts) {
    const assigneeId = impact.node.assigneeId;
    if (!assigneeId) continue;
    const summary = mutable.get(assigneeId) ?? {
      nodeIds: [],
      estimatedReworkMinutes: 0,
    };
    summary.nodeIds.push(impact.node.id);
    summary.estimatedReworkMinutes += impact.estimatedReworkMinutes;
    mutable.set(assigneeId, summary);
  }
  return [...mutable.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assigneeId, summary]) =>
      Object.freeze({
        assigneeId,
        nodeIds: Object.freeze(summary.nodeIds.sort()),
        estimatedReworkMinutes: summary.estimatedReworkMinutes,
      })
    );
}

export function previewStudioDependencyImpact(
  graph: StudioDependencyImpactGraph,
  changes: readonly StudioImpactChange[],
  options: PreviewStudioDependencyImpactOptions = {},
): StudioDependencyImpactPreview {
  if (
    !graph
    || graph.version !== STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION
    || !Array.isArray(graph.nodes)
    || !Array.isArray(graph.edges)
    || !Array.isArray(changes)
    || changes.length === 0
    || changes.length > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxChanges
  ) {
    return fail("INVALID_CHANGE", "변경 영향 미리보기 요청이 올바르지 않습니다.");
  }
  const maximumImpacts = options.maxImpacts
    ?? STUDIO_DEPENDENCY_IMPACT_LIMITS.maxNodes;
  if (
    !Number.isSafeInteger(maximumImpacts)
    || maximumImpacts < 1
    || maximumImpacts > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxNodes
  ) {
    return fail("INVALID_CHANGE", "변경 영향 미리보기 한도가 올바르지 않습니다.");
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const roots = new Map<string, RootChange>();
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    const nodeId = canonicalText(
      change?.nodeId,
      `changes[${index}].nodeId`,
      STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
      { forbidPrototypeKey: true },
    );
    if (!CHANGE_KIND_SET.has(change?.kind)) {
      return fail("INVALID_CHANGE", `changes[${index}].kind 값이 올바르지 않습니다.`);
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      return fail("UNKNOWN_CHANGE_NODE", `변경할 객체를 찾을 수 없습니다: ${nodeId}`);
    }
    const reason = canonicalOptionalText(
      change.reason,
      `changes[${index}].reason`,
      STUDIO_DEPENDENCY_IMPACT_LIMITS.maxReasonLength,
    );
    const root = roots.get(nodeId) ?? {
      node,
      kinds: new Set<StudioImpactChangeKind>(),
      reasons: new Set<string>(),
    };
    root.kinds.add(change.kind);
    if (reason) root.reasons.add(reason);
    roots.set(nodeId, root);
  }

  const outgoing = outgoingEdges(graph);
  const rootIds = new Set(roots.keys());
  const impacts = new Map<string, MutableImpact>();
  let traversalPairs = 0;
  let truncated = false;

  for (const root of [...roots.values()].sort((left, right) =>
    left.node.id.localeCompare(right.node.id)
  )) {
    const visited = new Set([root.node.id]);
    const queue: Array<{
      nodeId: string;
      nodeIds: readonly string[];
      relations: readonly StudioDependencyRelation[];
    }> = [{ nodeId: root.node.id, nodeIds: [root.node.id], relations: [] }];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++]!;
      for (const edge of outgoing.get(current.nodeId) ?? []) {
        traversalPairs += 1;
        if (
          traversalPairs > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxTraversalPairs
        ) {
          truncated = true;
          break;
        }
        if (visited.has(edge.dependentId)) continue;
        visited.add(edge.dependentId);
        const nextNodeIds = [...current.nodeIds, edge.dependentId];
        const nextRelations = [...current.relations, edge.relation];
        queue.push({
          nodeId: edge.dependentId,
          nodeIds: nextNodeIds,
          relations: nextRelations,
        });
        if (rootIds.has(edge.dependentId)) continue;
        const node = nodeById.get(edge.dependentId)!;
        let impact = impacts.get(node.id);
        if (!impact) {
          if (impacts.size >= maximumImpacts) {
            truncated = true;
            continue;
          }
          impact = {
            node,
            depth: nextRelations.length,
            kinds: new Set(),
            reasons: new Set(),
            paths: new Map(),
          };
          impacts.set(node.id, impact);
        }
        impact.depth = Math.min(impact.depth, nextRelations.length);
        for (const kind of root.kinds) impact.kinds.add(kind);
        for (const reason of root.reasons) impact.reasons.add(reason);
        impact.paths.set(
          root.node.id,
          Object.freeze({
            rootNodeId: root.node.id,
            nodeIds: Object.freeze(nextNodeIds),
            relations: Object.freeze(nextRelations),
          }),
        );
      }
      if (
        traversalPairs > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxTraversalPairs
      ) {
        break;
      }
    }
    if (traversalPairs > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxTraversalPairs) break;
  }

  const frozenImpacts = [...impacts.values()]
    .map((impact): StudioImpactItem => {
      const severity = severityForImpact(
        impact.kinds,
        impact.depth,
        impact.node.approval === "approved",
      );
      return Object.freeze({
        node: impact.node,
        depth: impact.depth,
        severity,
        changeKinds: Object.freeze(sortedChangeKinds(impact.kinds)),
        reasons: Object.freeze([...impact.reasons].sort()),
        paths: Object.freeze(
          [...impact.paths.values()].sort((left, right) =>
            left.rootNodeId.localeCompare(right.rootNodeId)
          ),
        ),
        requiresApprovalReview: impact.node.approval === "approved",
        estimatedReworkMinutes: impact.node.reworkMinutes,
      });
    })
    .sort(
      (left, right) =>
        left.depth - right.depth
        || SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
        || left.node.id.localeCompare(right.node.id),
    );

  const severityCounts: Record<StudioImpactSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const kindCounts: Partial<Record<StudioDependencyNodeKind, number>> = {};
  let approvedImpactCount = 0;
  let totalEstimatedReworkMinutes = 0;
  for (const impact of frozenImpacts) {
    severityCounts[impact.severity] += 1;
    kindCounts[impact.node.kind] = (kindCounts[impact.node.kind] ?? 0) + 1;
    approvedImpactCount += impact.requiresApprovalReview ? 1 : 0;
    totalEstimatedReworkMinutes += impact.estimatedReworkMinutes;
  }

  const changed = [...roots.values()]
    .sort((left, right) => left.node.id.localeCompare(right.node.id))
    .map((root): StudioImpactChangedNode =>
      Object.freeze({
        node: root.node,
        changeKinds: Object.freeze(sortedChangeKinds(root.kinds)),
        reasons: Object.freeze([...root.reasons].sort()),
      })
    );

  return Object.freeze({
    graphVersion: STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION,
    changed: Object.freeze(changed),
    impacts: Object.freeze(frozenImpacts),
    severityCounts: Object.freeze(severityCounts),
    kindCounts: Object.freeze(kindCounts),
    approvedImpactCount,
    totalEstimatedReworkMinutes,
    assignees: Object.freeze(assigneeSummaries(frozenImpacts)),
    unaffectedNodeCount: Math.max(
      0,
      graph.nodes.length - roots.size - frozenImpacts.length,
    ),
    truncated,
    graphDiagnostics: graph.diagnostics,
  });
}

function selectedIds(
  options: PlanStudioImpactApplicationOptions,
): Set<string> {
  if (options.mode !== "selected") return new Set();
  if (
    !Array.isArray(options.selectedNodeIds)
    || options.selectedNodeIds.length === 0
    || options.selectedNodeIds.length
      > STUDIO_DEPENDENCY_IMPACT_LIMITS.maxSelectedNodes
  ) {
    return fail("INVALID_SELECTION", "선택 적용 대상이 올바르지 않습니다.");
  }
  const selected = new Set<string>();
  for (let index = 0; index < options.selectedNodeIds.length; index += 1) {
    selected.add(
      canonicalText(
        options.selectedNodeIds[index],
        `selectedNodeIds[${index}]`,
        STUDIO_DEPENDENCY_IMPACT_LIMITS.maxIdLength,
        { forbidPrototypeKey: true },
      ),
    );
  }
  return selected;
}

function impactNotifications(
  impacts: readonly StudioImpactItem[],
): StudioImpactNotification[] {
  return assigneeSummaries(impacts).map((summary) =>
    Object.freeze({
      assigneeId: summary.assigneeId,
      nodeIds: summary.nodeIds,
      estimatedReworkMinutes: summary.estimatedReworkMinutes,
    })
  );
}

export function planStudioImpactApplication(
  preview: StudioDependencyImpactPreview,
  options: PlanStudioImpactApplicationOptions,
): StudioImpactApplicationPlan {
  if (
    !preview
    || preview.graphVersion !== STUDIO_DEPENDENCY_IMPACT_GRAPH_VERSION
    || !Array.isArray(preview.impacts)
    || (options?.mode !== "all" && options?.mode !== "selected")
  ) {
    return fail("INVALID_SELECTION", "변경 영향 적용 계획 요청이 올바르지 않습니다.");
  }
  const selected = selectedIds(options);
  const knownImpactIds = new Set(preview.impacts.map(({ node }) => node.id));
  const unknownSelectedNodeIds =
    options.mode === "selected"
      ? [...selected].filter((nodeId) => !knownImpactIds.has(nodeId)).sort()
      : [];
  const includeApproved = options.includeApproved === true;
  const apply: StudioImpactItem[] = [];
  const skipped: StudioImpactSkippedNode[] = [];
  const reviewRequiredNodeIds: string[] = [];

  for (const impact of preview.impacts) {
    if (options.mode === "selected" && !selected.has(impact.node.id)) {
      skipped.push(Object.freeze({ nodeId: impact.node.id, reason: "not-selected" }));
      continue;
    }
    if (impact.requiresApprovalReview && !includeApproved) {
      skipped.push(Object.freeze({ nodeId: impact.node.id, reason: "approved" }));
      reviewRequiredNodeIds.push(impact.node.id);
      continue;
    }
    apply.push(impact);
  }

  const tasks = apply.map((impact): StudioImpactTask =>
    Object.freeze({
      id: `impact:${impact.node.id}`,
      nodeId: impact.node.id,
      title: `${impact.node.label} 재검토`,
      assigneeId: impact.node.assigneeId ?? null,
      estimatedReworkMinutes: impact.estimatedReworkMinutes,
      triggerNodeIds: Object.freeze(
        impact.paths.map(({ rootNodeId }) => rootNodeId).sort(),
      ),
      severity: impact.severity,
    })
  );

  return Object.freeze({
    mode: options.mode,
    includeApproved,
    applyNodeIds: Object.freeze(apply.map(({ node }) => node.id)),
    skipped: Object.freeze(skipped),
    reviewRequiredNodeIds: Object.freeze(reviewRequiredNodeIds.sort()),
    unknownSelectedNodeIds: Object.freeze(unknownSelectedNodeIds),
    tasks: Object.freeze(tasks),
    notifications: Object.freeze(impactNotifications(apply)),
    estimatedReworkMinutes: apply.reduce(
      (total, impact) => total + impact.estimatedReworkMinutes,
      0,
    ),
    unaffectedNodeCount: preview.unaffectedNodeCount,
  });
}
