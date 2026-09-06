/**
 * Deterministic production dependency graph and change-impact planner.
 *
 * Edge direction is always dependency -> dependent. The module is deliberately
 * UI/document-model independent: callers project stable production IDs into this
 * graph and can then preview/commit approval and delivery invalidations atomically.
 */

export const STUDIO_PRODUCTION_SEMANTIC_NODE_KINDS = [
  "script",
  "scene",
  "shot",
  "panel",
  "character",
  "dialogue",
  "balloon",
  "scene-3d",
  "layer",
  "asset",
  "translation",
  "approval",
  "delivery",
] as const;

export type StudioProductionSemanticNodeKind =
  (typeof STUDIO_PRODUCTION_SEMANTIC_NODE_KINDS)[number];

export const STUDIO_PRODUCTION_SEMANTIC_EDGE_KINDS = [
  "derives-from ",
  "story-flow",
  "character-reference",
  "dialogue-render",
  "balloon-placement",
  "scene-render",
  "layer-composite",
  "asset-use",
  "translation-source",
  "approval-input",
  "delivery-input",
] as const;

export type StudioProductionSemanticEdgeKind =
  (typeof STUDIO_PRODUCTION_SEMANTIC_EDGE_KINDS)[number];

export type StudioProductionApprovalStatus =
  | "pending"
  | "in-review"
  | "approved"
  | "changes-requested"
  | "invalidated";

export type StudioProductionDeliveryStatus = "draft" | "ready" | "exported" | "stale";

export interface StudioProductionSemanticNode {
  readonly id: string;
  readonly kind: StudioProductionSemanticNodeKind;
  readonly label?: string;
  readonly semanticFingerprint?: string;
  readonly approvalStatus?: StudioProductionApprovalStatus;
  readonly deliveryStatus?: StudioProductionDeliveryStatus;
}

export interface StudioProductionSemanticEdge {
  readonly id: string;
  readonly kind: StudioProductionSemanticEdgeKind;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

export interface StudioProductionSemanticGraphInput {
  readonly nodes: readonly StudioProductionSemanticNode[];
  readonly edges: readonly StudioProductionSemanticEdge[];
}

export const STUDIO_PRODUCTION_SEMANTIC_CHANGE_KINDS = [
  "content",
  "structure",
  "metadata",
  "approval-state",
  "delivery-config",
] as const;

export type StudioProductionSemanticChangeKind =
  (typeof STUDIO_PRODUCTION_SEMANTIC_CHANGE_KINDS)[number];

export interface StudioProductionSemanticChangeEvent {
  readonly nodeId: string;
  readonly kind: StudioProductionSemanticChangeKind;
  readonly changedFields?: readonly string[];
  readonly beforeFingerprint?: string;
  readonly afterFingerprint?: string;
}

export interface StudioProductionSemanticGraphBudget {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxChanges: number;
  readonly maxChangedFields: number;
  readonly maxTraversalSteps: number;
  readonly maxEvidenceEntries: number;
  readonly maxPatches: number;
}

export const STUDIO_PRODUCTION_SEMANTIC_GRAPH_DEFAULT_BUDGET: StudioProductionSemanticGraphBudget =
  Object.freeze({
    maxNodes: 10_000,
    maxEdges: 50_000,
    maxChanges: 1_000,
    maxChangedFields: 10_000,
    maxTraversalSteps: 200_000,
    maxEvidenceEntries: 250_000,
    maxPatches: 10_000,
  });

export interface StudioProductionNormalizedSemanticGraph {
  readonly nodes: readonly StudioProductionSemanticNode[];
  readonly edges: readonly StudioProductionSemanticEdge[];
  readonly topologicalNodeIds: readonly string[];
}

export type StudioProductionSemanticGraphRejectedReason =
  | "invalid-input"
  | "invalid-budget"
  | "budget-exceeded"
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "duplicate-edge-relation"
  | "dangling-edge"
  | "invalid-edge-contract"
  | "cycle"
  | "insufficient-changes"
  | "unknown-change-node"
  | "conflicting-change-event";

export interface StudioProductionSemanticGraphRejected {
  readonly status: "rejected";
  readonly reason: StudioProductionSemanticGraphRejectedReason;
  readonly detail?: string;
  readonly budget?: Readonly<{
    metric: keyof StudioProductionSemanticGraphBudget;
    actual: number;
    limit: number;
  }>;
}

export interface StudioProductionNormalizedGraphResult {
  readonly status: "ready";
  readonly graph: StudioProductionNormalizedSemanticGraph;
  readonly stats: Readonly<{
    nodeCount: number;
    edgeCount: number;
  }>;
}

export type StudioProductionSemanticGraphResult =
  | StudioProductionNormalizedGraphResult
  | StudioProductionSemanticGraphRejected;

export interface StudioProductionSemanticEvidencePath {
  readonly sourceNodeId: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly distance: number;
}

export interface StudioProductionSemanticImpact {
  readonly nodeId: string;
  readonly nodeKind: StudioProductionSemanticNodeKind;
  readonly evidence: StudioProductionSemanticEvidencePath;
}

export interface StudioProductionNormalizedChangeEvent {
  readonly nodeId: string;
  readonly nodeKind: StudioProductionSemanticNodeKind;
  readonly kinds: readonly StudioProductionSemanticChangeKind[];
  readonly changedFields: readonly string[];
  readonly beforeFingerprint?: string;
  readonly afterFingerprint?: string;
}

export type StudioProductionImpactPatch =
  | Readonly<{
      op: "set-approval-status";
      id: string;
      before: StudioProductionApprovalStatus;
      after: StudioProductionApprovalStatus;
    }>
  | Readonly<{
      op: "set-delivery-status";
      id: string;
      before: StudioProductionDeliveryStatus;
      after: StudioProductionDeliveryStatus;
    }>;

export interface StudioProductionChangeImpactPlan {
  readonly status: "ready" | "noop";
  readonly graph: StudioProductionNormalizedSemanticGraph;
  readonly semanticDiff: Readonly<{
    events: readonly StudioProductionNormalizedChangeEvent[];
    changedNodeCount: number;
    changedFieldCount: number;
    byChangeKind: Readonly<Record<StudioProductionSemanticChangeKind, number>>;
    byNodeKind: Readonly<Record<StudioProductionSemanticNodeKind, number>>;
  }>;
  readonly downstream: readonly StudioProductionSemanticImpact[];
  readonly approvals: Readonly<{
    affectedNodeIds: readonly string[];
    invalidated: readonly StudioProductionSemanticImpact[];
  }>;
  readonly deliveries: Readonly<{
    affectedNodeIds: readonly string[];
    reexport: readonly StudioProductionSemanticImpact[];
  }>;
  readonly commit: Readonly<{
    atomic: true;
    historyLabel: "Invalidate impacted production outputs";
    patches: readonly StudioProductionImpactPatch[];
    inversePatches: readonly StudioProductionImpactPatch[];
  }>;
  readonly stats: Readonly<{
    traversalSteps: number;
    evidenceEntries: number;
    affectedNodeCount: number;
    invalidatedApprovalCount: number;
    reexportDeliveryCount: number;
  }>;
}

export type StudioProductionChangeImpactResult =
  | StudioProductionChangeImpactPlan
  | StudioProductionSemanticGraphRejected;

export interface StudioProductionChangeImpactRequest {
  readonly graph: StudioProductionSemanticGraphInput;
  readonly changes: readonly StudioProductionSemanticChangeEvent[];
  readonly budget?: Partial<StudioProductionSemanticGraphBudget>;
}

type NormalizedGraphInternal = StudioProductionNormalizedSemanticGraph & {
  readonly nodeById: ReadonlyMap<string, StudioProductionSemanticNode>;
  readonly outgoing: ReadonlyMap<string, readonly StudioProductionSemanticEdge[]>;
};

type TraversalRecord = Readonly<{
  distance: number;
  sourceNodeId: string;
  predecessorNodeId?: string;
  predecessorEdge?: StudioProductionSemanticEdge;
}>;

type TraversalState = {
  steps: number;
  evidenceEntries: number;
};

const MAX_ID_LENGTH = 200;
const MAX_LABEL_LENGTH = 240;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_FIELD_LENGTH = 160;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

const NODE_KIND_SET = new Set<string>(STUDIO_PRODUCTION_SEMANTIC_NODE_KINDS);
const EDGE_KIND_SET = new Set<string>(STUDIO_PRODUCTION_SEMANTIC_EDGE_KINDS);
const CHANGE_KIND_SET = new Set<string>(STUDIO_PRODUCTION_SEMANTIC_CHANGE_KINDS);
const APPROVAL_STATUS_SET = new Set<string>([
  "pending",
  "in-review",
  "approved",
  "changes-requested",
  "invalidated",
]);
const DELIVERY_STATUS_SET = new Set<string>(["draft", "ready", "exported", "stale"]);

const EDGE_KIND_ORDER = new Map(
  STUDIO_PRODUCTION_SEMANTIC_EDGE_KINDS.map((kind, index) => [kind, index] as const)
);
const CHANGE_KIND_ORDER = new Map(
  STUDIO_PRODUCTION_SEMANTIC_CHANGE_KINDS.map((kind, index) => [kind, index] as const)
);

const SAME_KIND_DERIVATIONS = new Set<StudioProductionSemanticNodeKind>([
  "script",
  "scene",
  "shot",
  "panel",
  "character",
  "dialogue",
  "balloon",
  "scene-3d",
  "layer",
  "asset",
  "translation",
]);

const STORY_FLOW_PAIRS = new Set([
  "script>scene",
  "scene>shot",
  "shot>panel",
  "scene>dialogue",
  "shot>dialogue",
]);

const CHARACTER_REFERENCE_TARGETS = new Set<StudioProductionSemanticNodeKind>([
  "scene",
  "shot",
  "panel",
  "dialogue",
  "balloon",
  "scene-3d",
  "layer",
]);

const ASSET_USE_TARGETS = new Set<StudioProductionSemanticNodeKind>([
  "scene-3d",
  "layer",
  "panel",
  "balloon",
]);

const APPROVAL_INPUT_SOURCES = new Set<StudioProductionSemanticNodeKind>(
  STUDIO_PRODUCTION_SEMANTIC_NODE_KINDS.filter(
    (kind) => kind !== "approval" && kind !== "delivery"
  )
);

const DELIVERY_INPUT_SOURCES = new Set<StudioProductionSemanticNodeKind>([
  "panel",
  "balloon",
  "scene-3d",
  "layer",
  "asset",
  "translation",
  "approval",
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validId(value: unknown): value is string {
  return validBoundedString(value, MAX_ID_LENGTH);
}

function validNodeKind(value: unknown): value is StudioProductionSemanticNodeKind {
  return typeof value === "string" && NODE_KIND_SET.has(value);
}

function validEdgeKind(value: unknown): value is StudioProductionSemanticEdgeKind {
  return typeof value === "string" && EDGE_KIND_SET.has(value);
}

function validChangeKind(value: unknown): value is StudioProductionSemanticChangeKind {
  return typeof value === "string" && CHANGE_KIND_SET.has(value);
}

function rejected(
  reason: StudioProductionSemanticGraphRejectedReason,
  detail?: string,
  budget?: StudioProductionSemanticGraphRejected["budget"]
): StudioProductionSemanticGraphRejected {
  return Object.freeze({
    status: "rejected" as const,
    reason,
    ...(detail ? { detail } : {}),
    ...(budget ? { budget: Object.freeze({ ...budget }) } : {}),
  });
}

function isGraphRejected(value: unknown): value is StudioProductionSemanticGraphRejected {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status?: unknown }).status === "rejected"
  );
}

function resolveBudget(
  overrides: Partial<StudioProductionSemanticGraphBudget> | undefined
): StudioProductionSemanticGraphBudget | null {
  const budget = { ...STUDIO_PRODUCTION_SEMANTIC_GRAPH_DEFAULT_BUDGET };
  if (!overrides) return Object.freeze(budget);
  for (const metric of Object.keys(
    STUDIO_PRODUCTION_SEMANTIC_GRAPH_DEFAULT_BUDGET
  ) as (keyof StudioProductionSemanticGraphBudget)[]) {
    const value = overrides[metric];
    if (value === undefined) continue;
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > STUDIO_PRODUCTION_SEMANTIC_GRAPH_DEFAULT_BUDGET[metric]
    ) {
      return null;
    }
    budget[metric] = value;
  }
  return Object.freeze(budget);
}

function budgetExceeded(
  metric: keyof StudioProductionSemanticGraphBudget,
  actual: number,
  budget: StudioProductionSemanticGraphBudget
): StudioProductionSemanticGraphRejected | null {
  const limit = budget[metric];
  return actual > limit
    ? rejected("budget-exceeded", `${metric} exceeded`, { metric, actual, limit })
    : null;
}

function validEdgeContract(
  edgeKind: StudioProductionSemanticEdgeKind,
  fromKind: StudioProductionSemanticNodeKind,
  toKind: StudioProductionSemanticNodeKind
): boolean {
  if (edgeKind === "derives-from ") {
    return fromKind === toKind && SAME_KIND_DERIVATIONS.has(fromKind);
  }
  if (edgeKind === "story-flow") return STORY_FLOW_PAIRS.has(`${fromKind}>${toKind}`);
  if (edgeKind === "character-reference") {
    return fromKind === "character" && CHARACTER_REFERENCE_TARGETS.has(toKind);
  }
  if (edgeKind === "dialogue-render") {
    return fromKind === "dialogue" && toKind === "balloon";
  }
  if (edgeKind === "balloon-placement") {
    return fromKind === "balloon" && toKind === "panel";
  }
  if (edgeKind === "scene-render") return fromKind === "scene-3d" && toKind === "layer";
  if (edgeKind === "layer-composite") return fromKind === "layer" && toKind === "panel";
  if (edgeKind === "asset-use") return fromKind === "asset" && ASSET_USE_TARGETS.has(toKind);
  if (edgeKind === "translation-source") {
    return (fromKind === "dialogue" || fromKind === "balloon") && toKind === "translation";
  }
  if (edgeKind === "approval-input") {
    return APPROVAL_INPUT_SOURCES.has(fromKind) && toKind === "approval";
  }
  return DELIVERY_INPUT_SOURCES.has(fromKind) && toKind === "delivery";
}

function normalizeNode(
  value: StudioProductionSemanticNode
): StudioProductionSemanticNode | null {
  if (!value || typeof value !== "object" || !validId(value.id) || !validNodeKind(value.kind)) {
    return null;
  }
  if (
    value.label !== undefined &&
    !validBoundedString(value.label, MAX_LABEL_LENGTH, true)
  ) {
    return null;
  }
  if (
    value.semanticFingerprint !== undefined &&
    !validBoundedString(value.semanticFingerprint, MAX_FINGERPRINT_LENGTH, true)
  ) {
    return null;
  }
  if (value.kind === "approval") {
    if (
      typeof value.approvalStatus !== "string" ||
      !APPROVAL_STATUS_SET.has(value.approvalStatus) ||
      value.deliveryStatus !== undefined
    ) {
      return null;
    }
  } else if (value.approvalStatus !== undefined) {
    return null;
  }
  if (value.kind === "delivery") {
    if (
      typeof value.deliveryStatus !== "string" ||
      !DELIVERY_STATUS_SET.has(value.deliveryStatus) ||
      value.approvalStatus !== undefined
    ) {
      return null;
    }
  } else if (value.deliveryStatus !== undefined) {
    return null;
  }
  return Object.freeze({
    id: value.id,
    kind: value.kind,
    ...(value.label !== undefined
      ? { label: value.label.normalize("NFKC").trim().replace(/\s+/gu, " ") }
      : {}),
    ...(value.semanticFingerprint !== undefined
      ? { semanticFingerprint: value.semanticFingerprint }
      : {}),
    ...(value.kind === "approval" ? { approvalStatus: value.approvalStatus } : {}),
    ...(value.kind === "delivery" ? { deliveryStatus: value.deliveryStatus } : {}),
  });
}

function insertSorted(values: string[], value: string): void {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareStrings(values[middle]!, value) < 0) low = middle + 1;
    else high = middle;
  }
  values.splice(low, 0, value);
}

function normalizeGraphUnsafe(
  input: StudioProductionSemanticGraphInput,
  budget: StudioProductionSemanticGraphBudget
): NormalizedGraphInternal | StudioProductionSemanticGraphRejected {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.nodes) ||
    !Array.isArray(input.edges)
  ) {
    return rejected("invalid-input", "nodes and edges must be arrays");
  }
  const nodeBudgetError = budgetExceeded("maxNodes", input.nodes.length, budget);
  if (nodeBudgetError) return nodeBudgetError;
  const edgeBudgetError = budgetExceeded("maxEdges", input.edges.length, budget);
  if (edgeBudgetError) return edgeBudgetError;

  const nodes: StudioProductionSemanticNode[] = [];
  const nodeById = new Map<string, StudioProductionSemanticNode>();
  for (const rawNode of input.nodes) {
    const node = normalizeNode(rawNode);
    if (!node) return rejected("invalid-input", "invalid production node");
    if (nodeById.has(node.id)) return rejected("duplicate-node-id", node.id);
    nodeById.set(node.id, node);
    nodes.push(node);
  }
  nodes.sort((left, right) => compareStrings(left.id, right.id));

  const edges: StudioProductionSemanticEdge[] = [];
  const edgeIds = new Set<string>();
  const edgeRelations = new Set<string>();
  for (const rawEdge of input.edges) {
    if (
      !rawEdge ||
      typeof rawEdge !== "object" ||
      !validId(rawEdge.id) ||
      !validEdgeKind(rawEdge.kind) ||
      !validId(rawEdge.fromNodeId) ||
      !validId(rawEdge.toNodeId)
    ) {
      return rejected("invalid-input", "invalid production edge");
    }
    if (edgeIds.has(rawEdge.id)) return rejected("duplicate-edge-id", rawEdge.id);
    const from = nodeById.get(rawEdge.fromNodeId);
    const to = nodeById.get(rawEdge.toNodeId);
    if (!from || !to) return rejected("dangling-edge", rawEdge.id);
    if (!validEdgeContract(rawEdge.kind, from.kind, to.kind)) {
      return rejected(
        "invalid-edge-contract",
        `${rawEdge.kind}:${from.kind}>${to.kind}`
      );
    }
    const relationKey = `${rawEdge.kind}\u0000${rawEdge.fromNodeId}\u0000${rawEdge.toNodeId}`;
    if (edgeRelations.has(relationKey)) {
      return rejected("duplicate-edge-relation", rawEdge.id);
    }
    edgeIds.add(rawEdge.id);
    edgeRelations.add(relationKey);
    edges.push(
      Object.freeze({
        id: rawEdge.id,
        kind: rawEdge.kind,
        fromNodeId: rawEdge.fromNodeId,
        toNodeId: rawEdge.toNodeId,
      })
    );
  }
  edges.sort(
    (left, right) =>
      compareStrings(left.fromNodeId, right.fromNodeId) ||
      compareStrings(left.toNodeId, right.toNodeId) ||
      (EDGE_KIND_ORDER.get(left.kind)! - EDGE_KIND_ORDER.get(right.kind)!) ||
      compareStrings(left.id, right.id)
  );

  const outgoing = new Map<string, StudioProductionSemanticEdge[]>();
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    const current = outgoing.get(edge.fromNodeId);
    if (current) current.push(edge);
    else outgoing.set(edge.fromNodeId, [edge]);
    indegree.set(edge.toNodeId, indegree.get(edge.toNodeId)! + 1);
  }
  for (const nodeEdges of outgoing.values()) {
    nodeEdges.sort(
      (left, right) =>
        compareStrings(left.toNodeId, right.toNodeId) ||
        (EDGE_KIND_ORDER.get(left.kind)! - EDGE_KIND_ORDER.get(right.kind)!) ||
        compareStrings(left.id, right.id)
    );
  }

  const ready = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id)
    .sort(compareStrings);
  const topologicalNodeIds: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    topologicalNodeIds.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const nextIndegree = indegree.get(edge.toNodeId)! - 1;
      indegree.set(edge.toNodeId, nextIndegree);
      if (nextIndegree === 0) insertSorted(ready, edge.toNodeId);
    }
  }
  if (topologicalNodeIds.length !== nodes.length) {
    const cycleNodeIds = nodes
      .filter((node) => (indegree.get(node.id) ?? 0) > 0)
      .map((node) => node.id)
      .slice(0, 32);
    return rejected("cycle", cycleNodeIds.join(","));
  }

  return {
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    topologicalNodeIds: Object.freeze(topologicalNodeIds),
    nodeById,
    outgoing,
  };
}

function publicGraph(graph: NormalizedGraphInternal): StudioProductionNormalizedSemanticGraph {
  return Object.freeze({
    nodes: graph.nodes,
    edges: graph.edges,
    topologicalNodeIds: graph.topologicalNodeIds,
  });
}

export function normalizeStudioProductionSemanticGraph(
  input: StudioProductionSemanticGraphInput,
  budgetOverrides?: Partial<StudioProductionSemanticGraphBudget>
): StudioProductionSemanticGraphResult {
  try {
    const budget = resolveBudget(budgetOverrides);
    if (!budget) return rejected("invalid-budget");
    const graph = normalizeGraphUnsafe(input, budget);
    if ("status" in graph) return graph;
    return Object.freeze({
      status: "ready" as const,
      graph: publicGraph(graph),
      stats: Object.freeze({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length }),
    });
  } catch {
    return rejected("invalid-input", "input access failed");
  }
}

type MutableNormalizedChange = {
  nodeId: string;
  nodeKind: StudioProductionSemanticNodeKind;
  kinds: Set<StudioProductionSemanticChangeKind>;
  changedFields: Set<string>;
  beforeFingerprints: Set<string>;
  afterFingerprints: Set<string>;
};

function normalizeChanges(
  changes: readonly StudioProductionSemanticChangeEvent[],
  graph: NormalizedGraphInternal,
  budget: StudioProductionSemanticGraphBudget
):
  | readonly StudioProductionNormalizedChangeEvent[]
  | StudioProductionSemanticGraphRejected {
  const changeBudgetError = budgetExceeded("maxChanges", changes.length, budget);
  if (changeBudgetError) return changeBudgetError;
  if (changes.length === 0) return rejected("insufficient-changes");

  const grouped = new Map<string, MutableNormalizedChange>();
  let changedFieldCount = 0;
  for (const change of changes) {
    if (
      !change ||
      typeof change !== "object" ||
      !validId(change.nodeId) ||
      !validChangeKind(change.kind) ||
      (change.changedFields !== undefined && !Array.isArray(change.changedFields)) ||
      (change.beforeFingerprint !== undefined &&
        !validBoundedString(change.beforeFingerprint, MAX_FINGERPRINT_LENGTH, true)) ||
      (change.afterFingerprint !== undefined &&
        !validBoundedString(change.afterFingerprint, MAX_FINGERPRINT_LENGTH, true))
    ) {
      return rejected("invalid-input", "invalid change event");
    }
    const node = graph.nodeById.get(change.nodeId);
    if (!node) return rejected("unknown-change-node", change.nodeId);
    const fields = change.changedFields ?? [];
    changedFieldCount += fields.length;
    const fieldBudgetError = budgetExceeded(
      "maxChangedFields",
      changedFieldCount,
      budget
    );
    if (fieldBudgetError) return fieldBudgetError;
    if (!fields.every((field) => validBoundedString(field, MAX_FIELD_LENGTH))) {
      return rejected("invalid-input", "invalid changed field");
    }

    let normalized = grouped.get(change.nodeId);
    if (!normalized) {
      normalized = {
        nodeId: change.nodeId,
        nodeKind: node.kind,
        kinds: new Set(),
        changedFields: new Set(),
        beforeFingerprints: new Set(),
        afterFingerprints: new Set(),
      };
      grouped.set(change.nodeId, normalized);
    }
    normalized.kinds.add(change.kind);
    fields.forEach((field) => normalized!.changedFields.add(field));
    if (change.beforeFingerprint !== undefined) {
      normalized.beforeFingerprints.add(change.beforeFingerprint);
    }
    if (change.afterFingerprint !== undefined) {
      normalized.afterFingerprints.add(change.afterFingerprint);
    }
  }

  const events: StudioProductionNormalizedChangeEvent[] = [];
  for (const value of grouped.values()) {
    if (value.beforeFingerprints.size > 1 || value.afterFingerprints.size > 1) {
      return rejected("conflicting-change-event", value.nodeId);
    }
    const kinds = [...value.kinds].sort(
      (left, right) => CHANGE_KIND_ORDER.get(left)! - CHANGE_KIND_ORDER.get(right)!
    );
    const beforeFingerprint = [...value.beforeFingerprints][0];
    const afterFingerprint = [...value.afterFingerprints][0];
    events.push(
      Object.freeze({
        nodeId: value.nodeId,
        nodeKind: value.nodeKind,
        kinds: Object.freeze(kinds),
        changedFields: Object.freeze([...value.changedFields].sort(compareStrings)),
        ...(beforeFingerprint !== undefined ? { beforeFingerprint } : {}),
        ...(afterFingerprint !== undefined ? { afterFingerprint } : {}),
      })
    );
  }
  events.sort((left, right) => compareStrings(left.nodeId, right.nodeId));
  return Object.freeze(events);
}

function traverse(
  sourceNodeIds: readonly string[],
  graph: NormalizedGraphInternal,
  budget: StudioProductionSemanticGraphBudget,
  state: TraversalState
):
  | ReadonlyMap<string, TraversalRecord>
  | StudioProductionSemanticGraphRejected {
  const records = new Map<string, TraversalRecord>();
  const queue = [...sourceNodeIds].sort(compareStrings);
  for (const sourceNodeId of queue) {
    records.set(sourceNodeId, Object.freeze({ distance: 0, sourceNodeId }));
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const nodeId = queue[cursor++]!;
    const record = records.get(nodeId)!;
    for (const edge of graph.outgoing.get(nodeId) ?? []) {
      state.steps += 1;
      const traversalBudgetError = budgetExceeded(
        "maxTraversalSteps",
        state.steps,
        budget
      );
      if (traversalBudgetError) return traversalBudgetError;
      if (records.has(edge.toNodeId)) continue;
      records.set(
        edge.toNodeId,
        Object.freeze({
          distance: record.distance + 1,
          sourceNodeId: record.sourceNodeId,
          predecessorNodeId: nodeId,
          predecessorEdge: edge,
        })
      );
      queue.push(edge.toNodeId);
    }
  }
  return records;
}

function evidencePath(
  nodeId: string,
  records: ReadonlyMap<string, TraversalRecord>,
  budget: StudioProductionSemanticGraphBudget,
  state: TraversalState
): StudioProductionSemanticEvidencePath | StudioProductionSemanticGraphRejected {
  const target = records.get(nodeId);
  if (!target) return rejected("invalid-input", "missing traversal record");
  const reverseNodeIds = [nodeId];
  const reverseEdgeIds: string[] = [];
  let current = target;
  while (current.predecessorNodeId && current.predecessorEdge) {
    reverseEdgeIds.push(current.predecessorEdge.id);
    reverseNodeIds.push(current.predecessorNodeId);
    const predecessor = records.get(current.predecessorNodeId);
    if (!predecessor) return rejected("invalid-input", "broken traversal predecessor");
    current = predecessor;
  }
  const nodeIds = reverseNodeIds.reverse();
  const edgeIds = reverseEdgeIds.reverse();
  state.evidenceEntries += nodeIds.length + edgeIds.length;
  const evidenceBudgetError = budgetExceeded(
    "maxEvidenceEntries",
    state.evidenceEntries,
    budget
  );
  if (evidenceBudgetError) return evidenceBudgetError;
  return Object.freeze({
    sourceNodeId: target.sourceNodeId,
    nodeIds: Object.freeze(nodeIds),
    edgeIds: Object.freeze(edgeIds),
    distance: target.distance,
  });
}

function emptyChangeKindCounts(): Record<StudioProductionSemanticChangeKind, number> {
  return {
    content: 0,
    structure: 0,
    metadata: 0,
    "approval-state": 0,
    "delivery-config": 0,
  };
}

function emptyNodeKindCounts(): Record<StudioProductionSemanticNodeKind, number> {
  return {
    script: 0,
    scene: 0,
    shot: 0,
    panel: 0,
    character: 0,
    dialogue: 0,
    balloon: 0,
    "scene-3d": 0,
    layer: 0,
    asset: 0,
    translation: 0,
    approval: 0,
    delivery: 0,
  };
}

function invertImpactPatch(
  patch: StudioProductionImpactPatch
): StudioProductionImpactPatch {
  return Object.freeze({
    op: patch.op,
    id: patch.id,
    before: patch.after,
    after: patch.before,
  } as StudioProductionImpactPatch);
}

function planImpactUnsafe(
  request: StudioProductionChangeImpactRequest
): StudioProductionChangeImpactResult {
  if (
    !request ||
    typeof request !== "object" ||
    !Array.isArray(request.changes)
  ) {
    return rejected("invalid-input");
  }
  const budget = resolveBudget(request.budget);
  if (!budget) return rejected("invalid-budget");
  const graph = normalizeGraphUnsafe(request.graph, budget);
  if (isGraphRejected(graph)) return graph;
  const events = normalizeChanges(request.changes, graph, budget);
  if (isGraphRejected(events)) return events;

  const traversalState: TraversalState = { steps: 0, evidenceEntries: 0 };
  const changedNodeIds = events.map((event) => event.nodeId);
  const changedNodeIdSet = new Set(changedNodeIds);
  const generalTraversal = traverse(changedNodeIds, graph, budget, traversalState);
  if ("status" in generalTraversal) return generalTraversal;

  const invalidatingSourceIds = events
    .filter((event) =>
      event.kinds.some(
        (kind) => kind !== "approval-state" && kind !== "delivery-config"
      )
    )
    .map((event) => event.nodeId);
  const invalidatingTraversal =
    invalidatingSourceIds.length > 0
      ? traverse(invalidatingSourceIds, graph, budget, traversalState)
      : new Map<string, TraversalRecord>();
  if ("status" in invalidatingTraversal) return invalidatingTraversal;

  const downstream: StudioProductionSemanticImpact[] = [];
  const affectedNodeIds = [...generalTraversal.keys()]
    .filter((nodeId) => !changedNodeIdSet.has(nodeId))
    .sort(compareStrings);
  for (const nodeId of affectedNodeIds) {
    const evidence = evidencePath(nodeId, generalTraversal, budget, traversalState);
    if ("status" in evidence) return evidence;
    downstream.push(
      Object.freeze({
        nodeId,
        nodeKind: graph.nodeById.get(nodeId)!.kind,
        evidence,
      })
    );
  }

  const affectedApprovalNodeIds = [...generalTraversal.keys()]
    .filter((nodeId) => graph.nodeById.get(nodeId)?.kind === "approval")
    .sort(compareStrings);
  const invalidatedApprovals: StudioProductionSemanticImpact[] = [];
  for (const nodeId of [...invalidatingTraversal.keys()].sort(compareStrings)) {
    const node = graph.nodeById.get(nodeId)!;
    if (
      node.kind !== "approval" ||
      (node.approvalStatus !== "approved" && node.approvalStatus !== "in-review")
    ) {
      continue;
    }
    const evidence = evidencePath(nodeId, invalidatingTraversal, budget, traversalState);
    if ("status" in evidence) return evidence;
    invalidatedApprovals.push(
      Object.freeze({ nodeId, nodeKind: "approval", evidence })
    );
  }

  const affectedDeliveryNodeIds = [...generalTraversal.keys()]
    .filter((nodeId) => graph.nodeById.get(nodeId)?.kind === "delivery")
    .sort(compareStrings);
  const reexportDeliveries: StudioProductionSemanticImpact[] = [];
  for (const nodeId of affectedDeliveryNodeIds) {
    const node = graph.nodeById.get(nodeId)!;
    if (node.kind !== "delivery" || node.deliveryStatus !== "exported") continue;
    const evidence = evidencePath(nodeId, generalTraversal, budget, traversalState);
    if ("status" in evidence) return evidence;
    reexportDeliveries.push(
      Object.freeze({ nodeId, nodeKind: "delivery", evidence })
    );
  }

  const patches: StudioProductionImpactPatch[] = [
    ...invalidatedApprovals.map((impact) => {
      const node = graph.nodeById.get(impact.nodeId)!;
      return Object.freeze({
        op: "set-approval-status" as const,
        id: node.id,
        before: node.approvalStatus!,
        after: "invalidated" as const,
      });
    }),
    ...reexportDeliveries.map((impact) => {
      const node = graph.nodeById.get(impact.nodeId)!;
      return Object.freeze({
        op: "set-delivery-status" as const,
        id: node.id,
        before: node.deliveryStatus!,
        after: "stale" as const,
      });
    }),
  ].sort(
    (left, right) =>
      compareStrings(left.id, right.id) || compareStrings(left.op, right.op)
  );
  const patchBudgetError = budgetExceeded("maxPatches", patches.length, budget);
  if (patchBudgetError) return patchBudgetError;

  const byChangeKind = emptyChangeKindCounts();
  const byNodeKind = emptyNodeKindCounts();
  let changedFieldCount = 0;
  for (const event of events) {
    byNodeKind[event.nodeKind] += 1;
    event.kinds.forEach((kind) => {
      byChangeKind[kind] += 1;
    });
    changedFieldCount += event.changedFields.length;
  }

  const frozenPatches = Object.freeze(patches);
  const inversePatches = Object.freeze([...patches].reverse().map(invertImpactPatch));
  return Object.freeze({
    status: downstream.length > 0 || patches.length > 0 ? "ready" : "noop",
    graph: publicGraph(graph),
    semanticDiff: Object.freeze({
      events,
      changedNodeCount: events.length,
      changedFieldCount,
      byChangeKind: Object.freeze(byChangeKind),
      byNodeKind: Object.freeze(byNodeKind),
    }),
    downstream: Object.freeze(downstream),
    approvals: Object.freeze({
      affectedNodeIds: Object.freeze(affectedApprovalNodeIds),
      invalidated: Object.freeze(invalidatedApprovals),
    }),
    deliveries: Object.freeze({
      affectedNodeIds: Object.freeze(affectedDeliveryNodeIds),
      reexport: Object.freeze(reexportDeliveries),
    }),
    commit: Object.freeze({
      atomic: true,
      historyLabel: "Invalidate impacted production outputs" as const,
      patches: frozenPatches,
      inversePatches,
    }),
    stats: Object.freeze({
      traversalSteps: traversalState.steps,
      evidenceEntries: traversalState.evidenceEntries,
      affectedNodeCount: downstream.length,
      invalidatedApprovalCount: invalidatedApprovals.length,
      reexportDeliveryCount: reexportDeliveries.length,
    }),
  });
}

export function planStudioProductionChangeImpact(
  request: StudioProductionChangeImpactRequest
): StudioProductionChangeImpactResult {
  try {
    return planImpactUnsafe(request);
  } catch {
    return rejected("invalid-input", "input access failed");
  }
}

export type StudioProductionImpactApplyRejectedReason =
  | "invalid-input"
  | "duplicate-node-id"
  | "duplicate-patch-target"
  | "missing-node"
  | "wrong-node-kind"
  | "stale-node";

export type StudioProductionImpactApplyResult<N extends StudioProductionSemanticNode> =
  | Readonly<{ status: "applied"; nodes: readonly N[] }>
  | Readonly<{
      status: "rejected";
      reason: StudioProductionImpactApplyRejectedReason;
      id?: string;
    }>;

function applyRejected(
  reason: StudioProductionImpactApplyRejectedReason,
  id?: string
): Readonly<{
  status: "rejected";
  reason: StudioProductionImpactApplyRejectedReason;
  id?: string;
}> {
  return Object.freeze({ status: "rejected", reason, ...(id ? { id } : {}) });
}

/**
 * Applies forward or inverse impact patches only after the entire snapshot is
 * preflighted. This makes status invalidation compatible with one undo entry and
 * prevents a stale collaboration snapshot from being partially modified.
 */
export function applyStudioProductionImpactPatches<
  N extends StudioProductionSemanticNode,
>(
  nodes: readonly N[],
  patches: readonly StudioProductionImpactPatch[]
): StudioProductionImpactApplyResult<N> {
  try {
    if (!Array.isArray(nodes) || !Array.isArray(patches)) return applyRejected("invalid-input");
    const nodeById = new Map<string, N>();
    for (const node of nodes) {
      if (!node || typeof node !== "object" || !validId(node.id)) {
        return applyRejected("invalid-input");
      }
      if (nodeById.has(node.id)) return applyRejected("duplicate-node-id", node.id);
      nodeById.set(node.id, node);
    }

    const patchById = new Map<string, StudioProductionImpactPatch>();
    for (const patch of patches) {
      if (!patch || typeof patch !== "object" || !validId(patch.id)) {
        return applyRejected("invalid-input");
      }
      if (patchById.has(patch.id)) return applyRejected("duplicate-patch-target", patch.id);
      const node = nodeById.get(patch.id);
      if (!node) return applyRejected("missing-node", patch.id);
      if (patch.op === "set-approval-status") {
        if (
          node.kind !== "approval" ||
          !APPROVAL_STATUS_SET.has(patch.before) ||
          !APPROVAL_STATUS_SET.has(patch.after)
        ) {
          return applyRejected("wrong-node-kind", patch.id);
        }
        if (node.approvalStatus !== patch.before) {
          return applyRejected("stale-node", patch.id);
        }
      } else if (patch.op === "set-delivery-status") {
        if (
          node.kind !== "delivery" ||
          !DELIVERY_STATUS_SET.has(patch.before) ||
          !DELIVERY_STATUS_SET.has(patch.after)
        ) {
          return applyRejected("wrong-node-kind", patch.id);
        }
        if (node.deliveryStatus !== patch.before) {
          return applyRejected("stale-node", patch.id);
        }
      } else {
        return applyRejected("invalid-input");
      }
      patchById.set(patch.id, patch);
    }

    const nextNodes = nodes.map((node) => {
      const patch = patchById.get(node.id);
      if (!patch) return node;
      if (patch.op === "set-approval-status") {
        return { ...node, approvalStatus: patch.after } as N;
      }
      return { ...node, deliveryStatus: patch.after } as N;
    });
    return Object.freeze({
      status: "applied" as const,
      nodes: Object.freeze(nextNodes),
    });
  } catch {
    return applyRejected("invalid-input");
  }
}
