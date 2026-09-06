/**
 * Deterministic, UI-independent layout planner for multi-selection editing.
 *
 * The planner deliberately does not mutate the document. It returns an atomic
 * preview/commit patch set so a UI can preview, commit, and undo the same plan.
 * All expensive work is bounded before pair-wise overlap checks begin.
 */

export type StudioSmartLayoutGeometry = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type StudioSmartLayoutPoint = Readonly<{
  x: number;
  y: number;
}>;

export type StudioSmartLayoutNode = StudioSmartLayoutGeometry &
  Readonly<{
    id: string;
    locked?: boolean;
  }>;

export type StudioSmartLayoutConnector = Readonly<{
  id: string;
  fromNodeId: string;
  toNodeId: string;
  points: readonly StudioSmartLayoutPoint[];
  locked?: boolean;
}>;

export type StudioSmartLayoutReference =
  | Readonly<{ kind: "selection" }>
  | Readonly<{ kind: "artboard"; bounds: StudioSmartLayoutGeometry }>
  | Readonly<{ kind: "key-object"; nodeId: string }>;

export type StudioSmartLayoutFlow = "auto" | "horizontal" | "vertical" | "none";
export type StudioSmartLayoutResolvedFlow = Exclude<StudioSmartLayoutFlow, "auto">;
export type StudioSmartLayoutSameSize = "none" | "width" | "height" | "both";
export type StudioSmartLayoutHorizontalAlign = "none" | "left" | "center" | "right";
export type StudioSmartLayoutVerticalAlign = "none" | "top" | "center" | "bottom";

export type StudioSmartLayoutAlignment =
  | "auto"
  | Readonly<{
      horizontal?: StudioSmartLayoutHorizontalAlign;
      vertical?: StudioSmartLayoutVerticalAlign;
    }>;

export type StudioSmartLayoutBudget = Readonly<{
  maxNodes: number;
  maxSelectedNodes: number;
  maxConnectors: number;
  maxConnectorPoints: number;
  maxPatches: number;
  maxPairChecks: number;
}>;

export const STUDIO_SMART_LAYOUT_DEFAULT_BUDGET: StudioSmartLayoutBudget = Object.freeze({
  maxNodes: 4_096,
  maxSelectedNodes: 256,
  maxConnectors: 2_048,
  maxConnectorPoints: 32_768,
  maxPatches: 1_024,
  maxPairChecks: 32_640,
});

export type StudioSmartLayoutRequest = Readonly<{
  nodes: readonly StudioSmartLayoutNode[];
  selectedIds: readonly string[];
  connectors?: readonly StudioSmartLayoutConnector[];
  reference: StudioSmartLayoutReference;
  flow?: StudioSmartLayoutFlow;
  alignment?: StudioSmartLayoutAlignment;
  distribute?: boolean;
  distributionBasis?: "selection" | "reference";
  sameSize?: StudioSmartLayoutSameSize;
  sizeSourceId?: string;
  straightenConnectors?: boolean;
  budget?: Partial<StudioSmartLayoutBudget>;
}>;

export type StudioSmartLayoutNodePatch = Readonly<{
  op: "set-node-geometry";
  id: string;
  before: StudioSmartLayoutGeometry;
  after: StudioSmartLayoutGeometry;
}>;

export type StudioSmartLayoutConnectorPatch = Readonly<{
  op: "set-connector-points";
  id: string;
  before: readonly StudioSmartLayoutPoint[];
  after: readonly StudioSmartLayoutPoint[];
}>;

export type StudioSmartLayoutPatch =
  | StudioSmartLayoutNodePatch
  | StudioSmartLayoutConnectorPatch;

export type StudioSmartLayoutRejectedReason =
  | "invalid-input"
  | "invalid-budget"
  | "budget-exceeded"
  | "insufficient-selection"
  | "duplicate-selection-id"
  | "duplicate-node-id"
  | "duplicate-connector-id"
  | "unknown-selected-node"
  | "locked-selection"
  | "invalid-reference"
  | "invalid-size-source"
  | "invalid-connector-endpoint"
  | "conflicting-operations"
  | "insufficient-distribution-space";

export type StudioSmartLayoutRejected = Readonly<{
  status: "rejected";
  reason: StudioSmartLayoutRejectedReason;
  detail?: string;
  budget?: Readonly<{
    metric: keyof StudioSmartLayoutBudget;
    actual: number;
    limit: number;
  }>;
}>;

export type StudioSmartLayoutConnectorDisposition =
  | "disabled"
  | "none"
  | "straightened"
  | "already-straight"
  | "skipped-overlap"
  | "skipped-locked";

export type StudioSmartLayoutPlan = Readonly<{
  status: "ready" | "noop";
  reference: StudioSmartLayoutReference;
  flow: StudioSmartLayoutResolvedFlow;
  sizeSourceId: string | null;
  preview: Readonly<{
    nodes: readonly Readonly<{
      id: string;
      geometry: StudioSmartLayoutGeometry;
    }>[];
    connectors: readonly Readonly<{
      id: string;
      points: readonly StudioSmartLayoutPoint[];
    }>[];
    overlapDetected: boolean;
  }>;
  commit: Readonly<{
    atomic: true;
    historyLabel: "Smart Layout Auto Fix";
    patches: readonly StudioSmartLayoutPatch[];
    inversePatches: readonly StudioSmartLayoutPatch[];
  }>;
  connectorDisposition: StudioSmartLayoutConnectorDisposition;
  stats: Readonly<{
    selectedNodeCount: number;
    consideredConnectorCount: number;
    changedNodeCount: number;
    changedConnectorCount: number;
    pairChecks: number;
  }>;
}>;

export type StudioSmartLayoutResult = StudioSmartLayoutPlan | StudioSmartLayoutRejected;

type MutableGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_ABS_COORDINATE = 1_000_000_000;
const ROUNDING_SCALE = 1_000_000;
// eslint-disable-next-line no-control-regex
const ID_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function rejected(
  reason: StudioSmartLayoutRejectedReason,
  detail?: string,
  budget?: StudioSmartLayoutRejected["budget"]
): StudioSmartLayoutRejected {
  return Object.freeze({
    status: "rejected" as const,
    reason,
    ...(detail ? { detail } : {}),
    ...(budget ? { budget: Object.freeze({ ...budget }) } : {}),
  });
}

function finiteCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_ABS_COORDINATE
  );
}

function validGeometry(value: unknown): value is StudioSmartLayoutGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as StudioSmartLayoutGeometry;
  return (
    finiteCoordinate(geometry.x) &&
    finiteCoordinate(geometry.y) &&
    finiteCoordinate(geometry.width) &&
    finiteCoordinate(geometry.height) &&
    geometry.width > 0 &&
    geometry.height > 0
  );
}

function validPoint(value: unknown): value is StudioSmartLayoutPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as StudioSmartLayoutPoint;
  return finiteCoordinate(point.x) && finiteCoordinate(point.y);
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !ID_CONTROL_CHARACTERS.test(value)
  );
}

function canonicalNumber(value: number): number {
  const rounded = Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function frozenGeometry(value: StudioSmartLayoutGeometry): StudioSmartLayoutGeometry {
  return Object.freeze({
    x: canonicalNumber(value.x),
    y: canonicalNumber(value.y),
    width: canonicalNumber(value.width),
    height: canonicalNumber(value.height),
  });
}

function exactGeometry(value: StudioSmartLayoutGeometry): StudioSmartLayoutGeometry {
  return Object.freeze({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  });
}

function frozenPoint(value: StudioSmartLayoutPoint): StudioSmartLayoutPoint {
  return Object.freeze({
    x: canonicalNumber(value.x),
    y: canonicalNumber(value.y),
  });
}

function exactPoints(
  points: readonly StudioSmartLayoutPoint[]
): readonly StudioSmartLayoutPoint[] {
  return Object.freeze(points.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

function _frozenCanonicalPoints(
  points: readonly StudioSmartLayoutPoint[]
): readonly StudioSmartLayoutPoint[] {
  return Object.freeze(points.map(frozenPoint));
}

function geometryEqual(
  left: StudioSmartLayoutGeometry,
  right: StudioSmartLayoutGeometry
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function pointsEqual(
  left: readonly StudioSmartLayoutPoint[],
  right: readonly StudioSmartLayoutPoint[]
): boolean {
  return (
    left.length === right.length &&
    left.every((point, index) => {
      const other = right[index];
      return Boolean(other && point.x === other.x && point.y === other.y);
    })
  );
}

function resolveBudget(
  overrides: Partial<StudioSmartLayoutBudget> | undefined
): StudioSmartLayoutBudget | null {
  const budget = { ...STUDIO_SMART_LAYOUT_DEFAULT_BUDGET };
  if (!overrides) return Object.freeze(budget);

  for (const metric of Object.keys(
    STUDIO_SMART_LAYOUT_DEFAULT_BUDGET
  ) as (keyof StudioSmartLayoutBudget)[]) {
    const override = overrides[metric];
    if (override === undefined) continue;
    if (
      !Number.isSafeInteger(override) ||
      override <= 0 ||
      override > STUDIO_SMART_LAYOUT_DEFAULT_BUDGET[metric]
    ) {
      return null;
    }
    budget[metric] = override;
  }
  return Object.freeze(budget);
}

function budgetExceeded(
  metric: keyof StudioSmartLayoutBudget,
  actual: number,
  budget: StudioSmartLayoutBudget
): StudioSmartLayoutRejected | null {
  const limit = budget[metric];
  return actual > limit
    ? rejected("budget-exceeded", `${metric} exceeded`, { metric, actual, limit })
    : null;
}

function unionGeometry(values: readonly StudioSmartLayoutGeometry[]): MutableGeometry {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x + value.width);
    maxY = Math.max(maxY, value.y + value.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function centerX(value: StudioSmartLayoutGeometry): number {
  return value.x + value.width / 2;
}

function centerY(value: StudioSmartLayoutGeometry): number {
  return value.y + value.height / 2;
}

function inferFlow(
  selected: readonly StudioSmartLayoutNode[],
  selectionBounds: StudioSmartLayoutGeometry
): StudioSmartLayoutResolvedFlow {
  const centersX = selected.map(centerX);
  const centersY = selected.map(centerY);
  const rangeX = Math.max(...centersX) - Math.min(...centersX);
  const rangeY = Math.max(...centersY) - Math.min(...centersY);
  if (rangeX !== rangeY) return rangeX > rangeY ? "horizontal" : "vertical";
  if (selectionBounds.width !== selectionBounds.height) {
    return selectionBounds.width > selectionBounds.height ? "horizontal" : "vertical";
  }
  return "horizontal";
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function representativeSizeSource(
  selected: readonly StudioSmartLayoutNode[],
  sameSize: StudioSmartLayoutSameSize
): StudioSmartLayoutNode {
  const medianWidth = median(selected.map((node) => node.width));
  const medianHeight = median(selected.map((node) => node.height));
  return [...selected].sort((left, right) => {
    const leftScore =
      (sameSize === "height" ? 0 : Math.abs(left.width - medianWidth)) +
      (sameSize === "width" ? 0 : Math.abs(left.height - medianHeight));
    const rightScore =
      (sameSize === "height" ? 0 : Math.abs(right.width - medianWidth)) +
      (sameSize === "width" ? 0 : Math.abs(right.height - medianHeight));
    return leftScore - rightScore || left.id.localeCompare(right.id);
  })[0]!;
}

function resolveAlignment(
  alignment: StudioSmartLayoutAlignment,
  flow: StudioSmartLayoutResolvedFlow
): {
  horizontal: StudioSmartLayoutHorizontalAlign;
  vertical: StudioSmartLayoutVerticalAlign;
} {
  if (alignment === "auto") {
    if (flow === "horizontal") return { horizontal: "none", vertical: "center" };
    if (flow === "vertical") return { horizontal: "center", vertical: "none" };
    return { horizontal: "none", vertical: "none" };
  }
  return {
    horizontal: alignment.horizontal ?? "none",
    vertical: alignment.vertical ?? "none",
  };
}

function applySameSize(
  geometry: MutableGeometry,
  source: StudioSmartLayoutGeometry,
  sameSize: StudioSmartLayoutSameSize
): void {
  const cx = centerX(geometry);
  const cy = centerY(geometry);
  if (sameSize === "width" || sameSize === "both") geometry.width = source.width;
  if (sameSize === "height" || sameSize === "both") geometry.height = source.height;
  geometry.x = cx - geometry.width / 2;
  geometry.y = cy - geometry.height / 2;
}

function applyAlignment(
  geometry: MutableGeometry,
  target: StudioSmartLayoutGeometry,
  alignment: ReturnType<typeof resolveAlignment>
): void {
  if (alignment.horizontal === "left") geometry.x = target.x;
  else if (alignment.horizontal === "center") {
    geometry.x = centerX(target) - geometry.width / 2;
  } else if (alignment.horizontal === "right") {
    geometry.x = target.x + target.width - geometry.width;
  }

  if (alignment.vertical === "top") geometry.y = target.y;
  else if (alignment.vertical === "center") {
    geometry.y = centerY(target) - geometry.height / 2;
  } else if (alignment.vertical === "bottom") {
    geometry.y = target.y + target.height - geometry.height;
  }
}

function distribute(
  geometries: Map<string, MutableGeometry>,
  selectedIds: readonly string[],
  flow: Exclude<StudioSmartLayoutResolvedFlow, "none">,
  basis: StudioSmartLayoutGeometry,
  allowBasisExpansion: boolean
): boolean {
  const horizontal = flow === "horizontal";
  const ordered = selectedIds
    .map((id) => ({ id, geometry: geometries.get(id)! }))
    .sort((left, right) => {
      const leading = horizontal
        ? left.geometry.x - right.geometry.x
        : left.geometry.y - right.geometry.y;
      const centers = horizontal
        ? centerX(left.geometry) - centerX(right.geometry)
        : centerY(left.geometry) - centerY(right.geometry);
      return leading || centers || left.id.localeCompare(right.id);
    });
  const totalExtent = ordered.reduce(
    (sum, item) => sum + (horizontal ? item.geometry.width : item.geometry.height),
    0
  );
  const basisStart = horizontal ? basis.x : basis.y;
  const basisExtent = horizontal ? basis.width : basis.height;
  if (!allowBasisExpansion && totalExtent > basisExtent) return false;

  const extent = Math.max(basisExtent, totalExtent);
  const start = allowBasisExpansion
    ? basisStart + (basisExtent - extent) / 2
    : basisStart;
  const gap = ordered.length > 1 ? (extent - totalExtent) / (ordered.length - 1) : 0;
  let cursor = start;
  for (const item of ordered) {
    if (horizontal) item.geometry.x = cursor;
    else item.geometry.y = cursor;
    cursor += (horizontal ? item.geometry.width : item.geometry.height) + gap;
  }
  return true;
}

function overlaps(
  left: StudioSmartLayoutGeometry,
  right: StudioSmartLayoutGeometry
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function boundaryPoint(
  from: StudioSmartLayoutGeometry,
  to: StudioSmartLayoutGeometry,
  fallbackDirection: 1 | -1
): StudioSmartLayoutPoint {
  const fromX = centerX(from);
  const fromY = centerY(from);
  let dx = centerX(to) - fromX;
  const dy = centerY(to) - fromY;
  if (dx === 0 && dy === 0) dx = fallbackDirection;
  const xScale = dx === 0 ? Number.POSITIVE_INFINITY : from.width / 2 / Math.abs(dx);
  const yScale = dy === 0 ? Number.POSITIVE_INFINITY : from.height / 2 / Math.abs(dy);
  const scale = Math.min(xScale, yScale);
  return frozenPoint({ x: fromX + dx * scale, y: fromY + dy * scale });
}

function canonicalReference(
  reference: StudioSmartLayoutReference
): StudioSmartLayoutReference {
  if (reference.kind === "selection") return Object.freeze({ kind: "selection" });
  if (reference.kind === "key-object") {
    return Object.freeze({ kind: "key-object", nodeId: reference.nodeId });
  }
  return Object.freeze({ kind: "artboard", bounds: frozenGeometry(reference.bounds) });
}

function invertPatch(patch: StudioSmartLayoutPatch): StudioSmartLayoutPatch {
  if (patch.op === "set-node-geometry") {
    return Object.freeze({
      op: patch.op,
      id: patch.id,
      before: patch.after,
      after: patch.before,
    });
  }
  return Object.freeze({
    op: patch.op,
    id: patch.id,
    before: patch.after,
    after: patch.before,
  });
}

function planUnsafe(request: StudioSmartLayoutRequest): StudioSmartLayoutResult {
  if (!request || typeof request !== "object") return rejected("invalid-input");
  if (
    !Array.isArray(request.nodes) ||
    !Array.isArray(request.selectedIds) ||
    (request.connectors !== undefined && !Array.isArray(request.connectors))
  ) {
    return rejected("invalid-input", "nodes, selectedIds, and connectors must be arrays");
  }

  const budget = resolveBudget(request.budget);
  if (!budget) return rejected("invalid-budget");
  const connectors = request.connectors ?? [];

  const countChecks: readonly [
    keyof StudioSmartLayoutBudget,
    number,
  ][] = [
    ["maxNodes", request.nodes.length],
    ["maxSelectedNodes", request.selectedIds.length],
    ["maxConnectors", connectors.length],
  ];
  for (const [metric, actual] of countChecks) {
    const overBudget = budgetExceeded(metric, actual, budget);
    if (overBudget) return overBudget;
  }
  if (request.selectedIds.length < 2) {
    return rejected("insufficient-selection", "Smart Layout Auto Fix requires two or more nodes");
  }

  const nodeById = new Map<string, StudioSmartLayoutNode>();
  for (const node of request.nodes) {
    const rawNode = node as unknown as Record<string, unknown>;
    if (
      !node ||
      typeof node !== "object" ||
      typeof rawNode.id !== "string" ||
      !validId(rawNode.id) ||
      !validGeometry(node) ||
      (rawNode.locked !== undefined && typeof rawNode.locked !== "boolean")
    ) {
      return rejected("invalid-input", "invalid node");
    }
    const nodeId = rawNode.id;
    if (nodeById.has(nodeId)) return rejected("duplicate-node-id", nodeId);
    nodeById.set(nodeId, node as StudioSmartLayoutNode);
  }

  const selectedIdSet = new Set<string>();
  for (const id of request.selectedIds) {
    if (!validId(id)) return rejected("invalid-input", "invalid selected node id");
    if (selectedIdSet.has(id)) return rejected("duplicate-selection-id", id);
    const node = nodeById.get(id);
    if (!node) return rejected("unknown-selected-node", id);
    if (node.locked) return rejected("locked-selection", id);
    selectedIdSet.add(id);
  }
  const selectedIds = [...selectedIdSet].sort((left, right) => left.localeCompare(right));
  const selected = selectedIds.map((id) => nodeById.get(id)!);

  const pairChecks = (selected.length * (selected.length - 1)) / 2;
  const pairBudgetError = budgetExceeded("maxPairChecks", pairChecks, budget);
  if (pairBudgetError) return pairBudgetError;

  const connectorById = new Map<string, StudioSmartLayoutConnector>();
  let connectorPointCount = 0;
  for (const connector of connectors) {
    if (
      !connector ||
      typeof connector !== "object" ||
      !validId(connector.id) ||
      !validId(connector.fromNodeId) ||
      !validId(connector.toNodeId) ||
      !Array.isArray(connector.points) ||
      connector.points.length < 2 ||
      (connector.locked !== undefined && typeof connector.locked !== "boolean")
    ) {
      return rejected("invalid-input", "invalid connector");
    }
    if (connectorById.has(connector.id)) {
      return rejected("duplicate-connector-id", connector.id);
    }
    if (!nodeById.has(connector.fromNodeId) || !nodeById.has(connector.toNodeId)) {
      return rejected("invalid-connector-endpoint", connector.id);
    }
    connectorPointCount += connector.points.length;
    const connectorPointBudgetError = budgetExceeded(
      "maxConnectorPoints",
      connectorPointCount,
      budget
    );
    if (connectorPointBudgetError) return connectorPointBudgetError;
    if (!connector.points.every(validPoint)) {
      return rejected("invalid-input", `invalid connector point: ${connector.id}`);
    }
    connectorById.set(connector.id, connector);
  }

  const reference = request.reference;
  if (!reference || typeof reference !== "object") return rejected("invalid-reference");
  if (
    reference.kind !== "selection" &&
    reference.kind !== "artboard" &&
    reference.kind !== "key-object"
  ) {
    return rejected("invalid-reference");
  }
  if (reference.kind === "artboard" && !validGeometry(reference.bounds)) {
    return rejected("invalid-reference", "invalid artboard bounds");
  }
  if (
    reference.kind === "key-object" &&
    (!validId(reference.nodeId) || !selectedIdSet.has(reference.nodeId))
  ) {
    return rejected("invalid-reference", "key object must be selected");
  }

  const requestedFlow = request.flow ?? "auto";
  if (
    requestedFlow !== "auto" &&
    requestedFlow !== "horizontal" &&
    requestedFlow !== "vertical" &&
    requestedFlow !== "none"
  ) {
    return rejected("invalid-input", "invalid flow");
  }
  const sameSize = request.sameSize ?? "both";
  if (
    sameSize !== "none" &&
    sameSize !== "width" &&
    sameSize !== "height" &&
    sameSize !== "both"
  ) {
    return rejected("invalid-input", "invalid sameSize");
  }
  const alignmentRequest = request.alignment ?? "auto";
  if (
    alignmentRequest !== "auto" &&
    (!alignmentRequest ||
      typeof alignmentRequest !== "object" ||
      !["none", "left", "center", "right", undefined].includes(
        alignmentRequest.horizontal
      ) ||
      !["none", "top", "center", "bottom", undefined].includes(
        alignmentRequest.vertical
      ))
  ) {
    return rejected("invalid-input", "invalid alignment");
  }
  const distributionBasis = request.distributionBasis ?? "selection";
  if (distributionBasis !== "selection" && distributionBasis !== "reference") {
    return rejected("invalid-input", "invalid distribution basis");
  }

  const selectionBounds = unionGeometry(selected);
  const flow =
    requestedFlow === "auto" ? inferFlow(selected, selectionBounds) : requestedFlow;
  const alignment = resolveAlignment(alignmentRequest, flow);
  const distributeNodes = request.distribute ?? true;
  if (
    distributeNodes &&
    ((flow === "horizontal" && alignment.horizontal !== "none") ||
      (flow === "vertical" && alignment.vertical !== "none"))
  ) {
    return rejected(
      "conflicting-operations",
      "alignment and distribution cannot control the same axis"
    );
  }

  let sizeSource: StudioSmartLayoutNode | null = null;
  if (sameSize !== "none") {
    if (request.sizeSourceId !== undefined) {
      if (!validId(request.sizeSourceId) || !selectedIdSet.has(request.sizeSourceId)) {
        return rejected("invalid-size-source");
      }
      sizeSource = nodeById.get(request.sizeSourceId)!;
    } else if (reference.kind === "key-object") {
      sizeSource = nodeById.get(reference.nodeId)!;
    } else {
      sizeSource = representativeSizeSource(selected, sameSize);
    }
  }

  const relevantConnectors = [...connectorById.values()]
    .filter(
      (connector) =>
        selectedIdSet.has(connector.fromNodeId) && selectedIdSet.has(connector.toNodeId)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const patchUpperBound = selected.length + relevantConnectors.length;
  const patchBudgetError = budgetExceeded("maxPatches", patchUpperBound, budget);
  if (patchBudgetError) return patchBudgetError;

  const geometries = new Map<string, MutableGeometry>();
  for (const node of selected) {
    const geometry = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    if (sizeSource) applySameSize(geometry, sizeSource, sameSize);
    geometries.set(node.id, geometry);
  }

  let alignmentTarget: StudioSmartLayoutGeometry;
  if (reference.kind === "selection") {
    alignmentTarget = selectionBounds;
  } else if (reference.kind === "artboard") {
    alignmentTarget = reference.bounds;
  } else {
    alignmentTarget = geometries.get(reference.nodeId)!;
  }
  for (const id of selectedIds) applyAlignment(geometries.get(id)!, alignmentTarget, alignment);

  if (distributeNodes && flow !== "none") {
    let distributionTarget: StudioSmartLayoutGeometry;
    if (distributionBasis === "selection") {
      distributionTarget = selectionBounds;
    } else if (reference.kind === "selection") {
      distributionTarget = selectionBounds;
    } else if (reference.kind === "artboard") {
      distributionTarget = reference.bounds;
    } else {
      distributionTarget = geometries.get(reference.nodeId)!;
    }
    if (
      !distribute(
        geometries,
        selectedIds,
        flow,
        distributionTarget,
        distributionBasis === "selection"
      )
    ) {
      return rejected(
        "insufficient-distribution-space",
        "selected extents exceed the reference bounds"
      );
    }
  }

  const previewNodes = selectedIds.map((id) =>
    Object.freeze({
      id,
      geometry: frozenGeometry(geometries.get(id)!),
    })
  );
  const finalGeometryById = new Map(
    previewNodes.map((item) => [item.id, item.geometry] as const)
  );

  let overlapDetected = false;
  for (let leftIndex = 0; leftIndex < previewNodes.length && !overlapDetected; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < previewNodes.length; rightIndex++) {
      if (
        overlaps(
          previewNodes[leftIndex]!.geometry,
          previewNodes[rightIndex]!.geometry
        )
      ) {
        overlapDetected = true;
        break;
      }
    }
  }

  const nodePatches: StudioSmartLayoutNodePatch[] = [];
  for (const item of previewNodes) {
    const original = nodeById.get(item.id)!;
    const before = exactGeometry(original);
    if (!geometryEqual(before, item.geometry)) {
      nodePatches.push(
        Object.freeze({
          op: "set-node-geometry",
          id: item.id,
          before,
          after: item.geometry,
        })
      );
    }
  }

  const straightenConnectors = request.straightenConnectors ?? true;
  const connectorPatches: StudioSmartLayoutConnectorPatch[] = [];
  const previewConnectors: {
    id: string;
    points: readonly StudioSmartLayoutPoint[];
  }[] = [];
  let lockedRelevantConnectorCount = 0;

  for (const connector of relevantConnectors) {
    const originalPoints = exactPoints(connector.points);
    let finalPoints = originalPoints;
    if (straightenConnectors && !overlapDetected && !connector.locked) {
      const from = finalGeometryById.get(connector.fromNodeId)!;
      const to = finalGeometryById.get(connector.toNodeId)!;
      const forwardDirection = connector.fromNodeId.localeCompare(connector.toNodeId) <= 0 ? 1 : -1;
      finalPoints = Object.freeze([
        boundaryPoint(from, to, forwardDirection),
        boundaryPoint(to, from, forwardDirection === 1 ? -1 : 1),
      ]);
      if (!pointsEqual(originalPoints, finalPoints)) {
        connectorPatches.push(
          Object.freeze({
            op: "set-connector-points",
            id: connector.id,
            before: originalPoints,
            after: finalPoints,
          })
        );
      }
    } else if (connector.locked) {
      lockedRelevantConnectorCount += 1;
    }
    previewConnectors.push(Object.freeze({ id: connector.id, points: finalPoints }));
  }

  let connectorDisposition: StudioSmartLayoutConnectorDisposition;
  if (!straightenConnectors) connectorDisposition = "disabled";
  else if (relevantConnectors.length === 0) connectorDisposition = "none";
  else if (overlapDetected) connectorDisposition = "skipped-overlap";
  else if (connectorPatches.length > 0) connectorDisposition = "straightened";
  else if (lockedRelevantConnectorCount === relevantConnectors.length) {
    connectorDisposition = "skipped-locked";
  } else connectorDisposition = "already-straight";

  const patches: readonly StudioSmartLayoutPatch[] = Object.freeze([
    ...nodePatches,
    ...connectorPatches,
  ]);
  const inversePatches: readonly StudioSmartLayoutPatch[] = Object.freeze(
    [...patches].reverse().map(invertPatch)
  );
  const plan: StudioSmartLayoutPlan = Object.freeze({
    status: patches.length === 0 ? "noop" : "ready",
    reference: canonicalReference(reference),
    flow,
    sizeSourceId: sizeSource?.id ?? null,
    preview: Object.freeze({
      nodes: Object.freeze(previewNodes),
      connectors: Object.freeze(previewConnectors),
      overlapDetected,
    }),
    commit: Object.freeze({
      atomic: true,
      historyLabel: "Smart Layout Auto Fix",
      patches,
      inversePatches,
    }),
    connectorDisposition,
    stats: Object.freeze({
      selectedNodeCount: selected.length,
      consideredConnectorCount: relevantConnectors.length,
      changedNodeCount: nodePatches.length,
      changedConnectorCount: connectorPatches.length,
      pairChecks,
    }),
  });
  return plan;
}

/**
 * Build a deterministic layout transaction. Invalid/hostile inputs are rejected
 * instead of throwing so callers cannot accidentally commit a partial layout.
 */
export function planStudioSmartLayoutAutoFix(
  request: StudioSmartLayoutRequest
): StudioSmartLayoutResult {
  try {
    return planUnsafe(request);
  } catch {
    return rejected("invalid-input", "input access failed");
  }
}

export type StudioSmartLayoutApplyRejectedReason =
  | "invalid-input"
  | "duplicate-patch-target"
  | "missing-node"
  | "missing-connector"
  | "stale-node"
  | "stale-connector";

export type StudioSmartLayoutApplyResult<
  N extends StudioSmartLayoutNode,
  C extends StudioSmartLayoutConnector,
> =
  | Readonly<{
      status: "applied";
      nodes: readonly N[];
      connectors: readonly C[];
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioSmartLayoutApplyRejectedReason;
      id?: string;
    }>;

function applyRejected(
  reason: StudioSmartLayoutApplyRejectedReason,
  id?: string
): Readonly<{ status: "rejected"; reason: StudioSmartLayoutApplyRejectedReason; id?: string }> {
  return Object.freeze({ status: "rejected", reason, ...(id ? { id } : {}) });
}

/**
 * Apply a plan (or its inverse) only when every `before` value still matches.
 * The full preflight happens before any output is produced, providing an
 * optimistic stale-document guard and all-or-nothing semantics.
 */
export function applyStudioSmartLayoutPatches<
  N extends StudioSmartLayoutNode,
  C extends StudioSmartLayoutConnector,
>(
  snapshot: Readonly<{ nodes: readonly N[]; connectors?: readonly C[] }>,
  patches: readonly StudioSmartLayoutPatch[]
): StudioSmartLayoutApplyResult<N, C> {
  try {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !Array.isArray(snapshot.nodes) ||
      !Array.isArray(patches) ||
      (snapshot.connectors !== undefined && !Array.isArray(snapshot.connectors))
    ) {
      return applyRejected("invalid-input");
    }

    const nodes = snapshot.nodes;
    const connectors = snapshot.connectors ?? [];
    const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
    const connectorById = new Map(
      connectors.map((connector) => [connector.id, connector] as const)
    );
    const nodePatches = new Map<string, StudioSmartLayoutNodePatch>();
    const connectorPatches = new Map<string, StudioSmartLayoutConnectorPatch>();

    for (const patch of patches) {
      if (!patch || typeof patch !== "object" || !validId(patch.id)) {
        return applyRejected("invalid-input");
      }
      if (patch.op === "set-node-geometry") {
        if (nodePatches.has(patch.id)) return applyRejected("duplicate-patch-target", patch.id);
        const node = nodeById.get(patch.id);
        if (!node) return applyRejected("missing-node", patch.id);
        if (!validGeometry(patch.before) || !validGeometry(patch.after)) {
          return applyRejected("invalid-input", patch.id);
        }
        if (!geometryEqual(node, patch.before)) return applyRejected("stale-node", patch.id);
        nodePatches.set(patch.id, patch);
      } else if (patch.op === "set-connector-points") {
        if (connectorPatches.has(patch.id)) {
          return applyRejected("duplicate-patch-target", patch.id);
        }
        const connector = connectorById.get(patch.id);
        if (!connector) return applyRejected("missing-connector", patch.id);
        if (
          !Array.isArray(patch.before) ||
          !Array.isArray(patch.after) ||
          patch.before.length < 2 ||
          patch.after.length < 2 ||
          !patch.before.every(validPoint) ||
          !patch.after.every(validPoint)
        ) {
          return applyRejected("invalid-input", patch.id);
        }
        if (!pointsEqual(connector.points, patch.before)) {
          return applyRejected("stale-connector", patch.id);
        }
        connectorPatches.set(patch.id, patch);
      } else {
        return applyRejected("invalid-input");
      }
    }

    const nextNodes = nodes.map((node) => {
      const patch = nodePatches.get(node.id);
      return patch ? ({ ...node, ...patch.after } as N) : node;
    });
    const nextConnectors = connectors.map((connector) => {
      const patch = connectorPatches.get(connector.id);
      return patch ? ({ ...connector, points: patch.after } as C) : connector;
    });
    return Object.freeze({
      status: "applied" as const,
      nodes: Object.freeze(nextNodes),
      connectors: Object.freeze(nextConnectors),
    });
  } catch {
    return applyRejected("invalid-input");
  }
}
