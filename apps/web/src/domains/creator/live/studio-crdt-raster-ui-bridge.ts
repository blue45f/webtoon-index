import {
  resolveStudioInkPressureSamples,
  studioInkFallbackPressure,
  studioInkUsesPathResidualDabSpacing,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";
import {
  planStudioWebGpuCommittedSuffix,
  studioWebGpuCommittedBarrierReason,
  type StudioWebGpuCommittedElementInput,
  type StudioWebGpuCommittedPlanGates,
} from "../render/studio-webgpu-committed-plan";
import {
  processFreehandPoints,
  resampleStrokePressures,
  strokeRenderDistance,
} from "../studio-brush";
import { selectStudioCausalInkSamples } from "../studio-causal-ink";

import type { StudioCrdtDocument } from "./studio-crdt-document";
import type { StudioGpuStroke } from "../render/studio-webgpu-stroke";
import type {
  StudioMaterialMinimumDiameterRatio,
  StudioMaterialPressureModel,
} from "../studio-material-pressure-model";

import {
  STUDIO_RASTER_CRDT_VERSION,
  canonicalStudioRasterJson,
  createStudioRasterOperationLog,
  studioRasterUndoneOperationIds,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
  type StudioRasterSurfaceSpec,
  type StudioRasterUndoAcknowledgement,
  type StudioRasterUndoOperation,
} from "@/shared/lib/studio-crdt-raster-ops";

const MAX_UINT64_DECIMAL = "18446744073709551615";
const ZERO_SHA256 = "0".repeat(64);

export const STUDIO_RASTER_BRUSH_TILE_SIZE = 512;

export interface StudioRasterHistoryPage {
  readonly elements: readonly { readonly id: string; readonly type: string }[];
}

export interface StudioRasterDrawPromotionElement
  extends Omit<StudioWebGpuCommittedElementInput, "panelClip"> {
  readonly type: "draw";
  readonly mode?: "pen" | "eraser";
  readonly sampleSpacing?: unknown;
  readonly groupId?: string;
}

export interface StudioRasterDrawPromotionPlan {
  readonly surface: StudioRasterSurfaceSpec;
  /** The fallback vector stroke and raster operation intentionally share this UUID. */
  readonly operationId: string;
  readonly stroke: StudioGpuStroke;
  readonly intent: "paint";
  readonly semanticParameters: string;
}

export interface StudioRasterOverlaySourceElement extends StudioWebGpuCommittedElementInput {
  readonly hidden?: boolean;
  readonly panelClip: StudioWebGpuCommittedElementInput["panelClip"];
  readonly sampleSpacing?: unknown;
  readonly materialPressureModel?: StudioMaterialPressureModel;
  readonly materialMinimumDiameterRatio?: StudioMaterialMinimumDiameterRatio;
  readonly groupId?: string;
}

export interface StudioRasterOverlaySourceOperation {
  readonly operationId: string;
  /** Canonical source pixels contract. The surface verifies its SHA-256 before hiding vectors. */
  readonly semanticParameters: string;
}

export type StudioRasterOverlayHandoffPlan =
  | {
      readonly status: "ready";
      readonly sourceOperations: readonly StudioRasterOverlaySourceOperation[];
    }
  | {
      readonly status: "ineligible";
      readonly reason:
        | "empty"
        | "surface"
        | "operation"
        | "scene-order"
        | "source";
      readonly sourceOperations: readonly [];
    };

export interface StudioRasterHistoryPublicationResult {
  readonly undoOperationIds: readonly string[];
  readonly acknowledgementIds: readonly string[];
}

function compareDecimalClock(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function incrementDecimalClock(value: string): string {
  if (value === MAX_UINT64_DECIMAL) {
    throw new Error("래스터 Lamport 시계가 uint64 최대값에 도달했습니다.");
  }
  const digits = value.split("");
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry > 0; index -= 1) {
    const digit = Number(digits[index]) + carry;
    digits[index] = String(digit % 10);
    carry = digit >= 10 ? 1 : 0;
  }
  if (carry > 0) digits.unshift("1");
  return digits.join("");
}

function allRasterEventClocks(log: StudioRasterOperationLog): string[] {
  return [
    ...log.operations.map((event) => event.order.logicalClock),
    ...log.undoOperations.map((event) => event.order.logicalClock),
    ...log.undoAcknowledgements.map((event) => event.order.logicalClock),
  ];
}

/** Returns exactly max(observed Lamport clocks) + 1 without relying on BigInt. */
export function nextStudioRasterLogicalClock(
  logs: readonly StudioRasterOperationLog[]
): string {
  let maximum = "0";
  for (const log of logs) {
    for (const clock of allRasterEventClocks(log)) {
      if (compareDecimalClock(clock, maximum) > 0) maximum = clock;
    }
  }
  return incrementDecimalClock(maximum);
}

export function studioRasterBrushSurface(
  pageId: string,
  width: number,
  height: number
): StudioRasterSurfaceSpec {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    surfaceId: `raster:${pageId}:ink`,
    width,
    height,
    tileSize: STUDIO_RASTER_BRUSH_TILE_SIZE,
  };
}

/**
 * Converts only the round, opaque source-over pen contract. Erasers stay on Konva until the raster
 * surface owns all pixels below it; otherwise destination-out could not erase non-raster scene
 * content without changing semantics.
 *
 * requireCausalGeometry: true restricts promotion to causal geometry (sampleSpacing/pressureModel
 * set), matching the committed WebGPU handoff's own restriction -- both share
 * studioWebGpuCommittedBarrierReason and opt in for the same reason. Legacy strokes (neither field
 * set) fail the barrier and are never promoted: Konva renders them through its endpoint-width
 * segment path (drawFreehandPenSegments), which this function's dab-based rasterization does not
 * reproduce. The processFreehandPoints/legacy-pressure branch below is therefore currently
 * unreachable in practice -- the barrier already rejects every element that would take it.
 */
export function planStudioRasterDrawPromotion(input: {
  readonly element: StudioRasterDrawPromotionElement;
  readonly pageId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
}): StudioRasterDrawPromotionPlan | null {
  const element = input.element;
  if ((element.mode ?? "pen") !== "pen") return null;
  const barrier = studioWebGpuCommittedBarrierReason(
    {
      ...element,
      panelClip: "none",
    },
    { requireCausalGeometry: true }
  );
  if (barrier !== null) return null;

  const sourcePoints = element.points as readonly number[];
  const sourcePressures = Array.isArray(element.pressures)
    ? element.pressures as readonly number[]
    : undefined;
  const pressureModel = element.pressureModel as StudioInkPressureModel | undefined;
  const causalSampleSpacing = typeof element.sampleSpacing === "number"
    && Number.isFinite(element.sampleSpacing)
    ? element.sampleSpacing
    : null;
  const usesCausalGeometry = causalSampleSpacing !== null || pressureModel !== undefined;
  const causalSamples = usesCausalGeometry
    ? selectStudioCausalInkSamples({
        points: sourcePoints,
        pressures: sourcePressures,
        pressureModel,
        minDistance: causalSampleSpacing ?? 0,
      })
    : null;
  const points = causalSamples
    ? causalSamples.flatMap(({ x, y }) => [x, y])
    : processFreehandPoints(
        [...sourcePoints],
        strokeRenderDistance(element.sampleSpacing)
      );
  const pressures = causalSamples
    ? causalSamples.map(({ pressure }) => pressure)
    : resampleStrokePressures(
        pressureModel === undefined
          ? sourcePressures
          : resolveStudioInkPressureSamples(
              sourcePressures,
              sourcePoints.length / 2,
              pressureModel
            ),
        points.length / 2,
        studioInkFallbackPressure(pressureModel)
      );
  const stroke: StudioGpuStroke = {
    id: element.id,
    points,
    pressures,
    color: element.stroke as string,
    size: Math.max(1, element.strokeWidth as number),
    ...(pressureModel === undefined
      ? {}
      : { pressureModel }),
    opacity: element.opacity as number | undefined,
    composite: "normal",
  };
  const semanticParameters = canonicalStudioRasterJson({
    version: STUDIO_RASTER_CRDT_VERSION,
    tool: "round-pen",
    kernel: "toonspectrum-raster-v1",
    sourceOperationId: element.id,
    stroke: {
      points: stroke.points,
      pressures: stroke.pressures,
      color: stroke.color,
      size: stroke.size,
      opacity: stroke.opacity ?? 1,
      composite: stroke.composite,
      pressureModel: stroke.pressureModel ?? "studio-gpu-pressure-radius-v1",
      pointPipeline: studioInkUsesPathResidualDabSpacing(pressureModel)
        ? "studio-causal-polyline-residual-v3"
        : usesCausalGeometry
          ? "studio-causal-dabs-v1"
          : "studio-freehand-v1",
    },
  });
  return {
    surface: studioRasterBrushSurface(
      input.pageId,
      input.documentWidth,
      input.documentHeight
    ),
    operationId: element.id,
    stroke,
    intent: "paint",
    semanticParameters,
  };
}

/** Revalidates the mutable vector fallback immediately before an asynchronous raster append. */
export function studioRasterDrawPromotionSourceMatches(input: {
  readonly plan: StudioRasterDrawPromotionPlan;
  readonly element: StudioRasterDrawPromotionElement | null;
  readonly pageId: string;
  readonly layerId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly panelClipped: boolean;
}): boolean {
  if (!input.element || input.panelClipped) return false;
  const current = planStudioRasterDrawPromotion({
    element: input.element,
    pageId: input.pageId,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
  });
  return current !== null &&
    current.operationId === input.plan.operationId &&
    current.semanticParameters === input.plan.semanticParameters &&
    canonicalStudioRasterJson(current.surface) === canonicalStudioRasterJson(input.plan.surface) &&
    (input.element.groupId ?? "page-root") === input.layerId;
}

function ineligibleRasterOverlay(
  reason: Exclude<StudioRasterOverlayHandoffPlan, { status: "ready" }>["reason"]
): StudioRasterOverlayHandoffPlan {
  return { status: "ineligible", reason, sourceOperations: [] };
}

/**
 * Authorizes the transparent DOM overlay only when it owns the complete visible front suffix.
 * This is deliberately stricter than merely finding matching operation IDs: every active raster
 * operation must still have an unchanged, eligible vector fallback in exactly replay order.
 */
export function planStudioRasterOverlayHandoff(input: {
  readonly log: StudioRasterOperationLog | null;
  readonly elements: readonly StudioRasterOverlaySourceElement[];
  readonly pageId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly gates?: StudioWebGpuCommittedPlanGates;
}): StudioRasterOverlayHandoffPlan {
  const log = input.log;
  if (!log) return ineligibleRasterOverlay("empty");
  const expectedSurface = studioRasterBrushSurface(
    input.pageId,
    input.documentWidth,
    input.documentHeight
  );
  if (canonicalStudioRasterJson(log.surface) !== canonicalStudioRasterJson(expectedSurface)) {
    return ineligibleRasterOverlay("surface");
  }

  const undone = studioRasterUndoneOperationIds(log);
  const operations = log.operations.filter(({ operationId }) => !undone.has(operationId));
  if (operations.length === 0) return ineligibleRasterOverlay("empty");
  if (operations.some((operation) => (
    operation.pageId !== input.pageId ||
    operation.intent !== "paint" ||
    operation.kernel !== "toonspectrum-raster-v1" ||
    operation.patches.length === 0 ||
    operation.patches.some((patch) => (
      patch.effect.kind !== "composite" || patch.effect.blendMode !== "source-over"
    ))
  ))) {
    return ineligibleRasterOverlay("operation");
  }

  const suffix = planStudioWebGpuCommittedSuffix({
    elements: input.elements,
    gates: input.gates,
  });
  const operationIds = operations.map(({ operationId }) => operationId);
  if (
    suffix.status !== "ready" ||
    suffix.elementIds.length !== operationIds.length ||
    suffix.elementIds.some((elementId, index) => elementId !== operationIds[index])
  ) {
    return ineligibleRasterOverlay("scene-order");
  }

  const sourceOperations: StudioRasterOverlaySourceOperation[] = [];
  for (const element of suffix.elements) {
    const source = planStudioRasterDrawPromotion({
      element: element as StudioRasterDrawPromotionElement,
      pageId: input.pageId,
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
    });
    if (!source || source.operationId !== element.id) {
      return ineligibleRasterOverlay("source");
    }
    sourceOperations.push({
      operationId: source.operationId,
      semanticParameters: source.semanticParameters,
    });
  }
  return {
    status: "ready",
    sourceOperations: Object.freeze(
      sourceOperations.map((source) => Object.freeze({ ...source }))
    ),
  };
}

export async function sha256StudioRasterSemanticParameters(
  canonicalParameters: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("래스터 획 게시가 취소되었습니다.", "AbortError");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 브라우저에서는 래스터 도구 SHA-256을 계산할 수 없습니다.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalParameters)
  );
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("래스터 획 게시가 취소되었습니다.", "AbortError");
  }
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function drawIds(pages: readonly StudioRasterHistoryPage[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const element of page.elements) {
      if (element.type === "draw") ids.add(element.id);
    }
  }
  return ids;
}

function drawElementsById(
  pages: readonly StudioRasterHistoryPage[]
): Map<string, StudioRasterHistoryPage["elements"][number]> {
  const elements = new Map<string, StudioRasterHistoryPage["elements"][number]>();
  for (const page of pages) {
    for (const element of page.elements) {
      if (element.type === "draw") elements.set(element.id, element);
    }
  }
  return elements;
}

function operationsById(logs: readonly StudioRasterOperationLog[]): Map<string, {
  log: StudioRasterOperationLog;
  operation: StudioRasterOperation;
}> {
  const result = new Map<string, {
    log: StudioRasterOperationLog;
    operation: StudioRasterOperation;
  }>();
  for (const log of logs) {
    for (const operation of log.operations) {
      result.set(operation.operationId, { log, operation });
    }
  }
  return result;
}

function appendUndo(
  document: StudioCrdtDocument,
  log: StudioRasterOperationLog,
  operation: StudioRasterOperation,
  actorId: string,
  uuid: () => string
): string {
  const undo: StudioRasterUndoOperation = {
    version: STUDIO_RASTER_CRDT_VERSION,
    undoOperationId: uuid(),
    targetOperationId: operation.operationId,
    order: {
      logicalClock: nextStudioRasterLogicalClock(document.getRasterOperationLogs()),
      actorId,
    },
  };
  document.mergeRasterOperationLog(createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: log.surface,
    operations: [operation],
    undoOperations: [undo],
    undoAcknowledgements: [],
  }));
  return undo.undoOperationId;
}

function appendAcknowledgement(
  document: StudioCrdtDocument,
  log: StudioRasterOperationLog,
  operation: StudioRasterOperation,
  undo: StudioRasterUndoOperation,
  actorId: string,
  uuid: () => string
): string {
  const acknowledgement: StudioRasterUndoAcknowledgement = {
    version: STUDIO_RASTER_CRDT_VERSION,
    acknowledgementId: uuid(),
    undoOperationId: undo.undoOperationId,
    targetOperationId: operation.operationId,
    order: {
      logicalClock: nextStudioRasterLogicalClock(document.getRasterOperationLogs()),
      actorId,
    },
  };
  document.mergeRasterOperationLog(createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: log.surface,
    operations: [operation],
    undoOperations: [undo],
    undoAcknowledgements: [acknowledgement],
  }));
  return acknowledgement.acknowledgementId;
}

/**
 * Mirrors a local page-history transition into the immutable raster undo protocol. The paired
 * fallback vector and raster operation share an ID, so page undo/redo remains one user action.
 * Foreign operations are ignored because the contract permits only the original actor to undo.
 */
export function publishStudioRasterHistoryTransition(input: {
  readonly document: StudioCrdtDocument;
  readonly previousPages: readonly StudioRasterHistoryPage[];
  readonly nextPages: readonly StudioRasterHistoryPage[];
  readonly actorId: string;
  readonly uuid?: () => string;
}): StudioRasterHistoryPublicationResult {
  const uuid = input.uuid ?? (() => globalThis.crypto.randomUUID());
  const previousIds = drawIds(input.previousPages);
  const nextIds = drawIds(input.nextPages);
  const previousElements = drawElementsById(input.previousPages);
  const nextElements = drawElementsById(input.nextPages);
  const logs = input.document.getRasterOperationLogs();
  const byId = operationsById(logs);
  const undoOperationIds: string[] = [];
  const acknowledgementIds: string[] = [];

  for (const id of previousIds) {
    const sourceChanged = nextIds.has(id) && canonicalStudioRasterJson(previousElements.get(id)) !==
      canonicalStudioRasterJson(nextElements.get(id));
    if (nextIds.has(id) && !sourceChanged) continue;
    const candidate = byId.get(id);
    if (!candidate || candidate.operation.order.actorId !== input.actorId) continue;
    const undone = studioRasterUndoneOperationIds(candidate.log);
    if (undone.has(id)) continue;
    undoOperationIds.push(appendUndo(
      input.document,
      candidate.log,
      candidate.operation,
      input.actorId,
      uuid
    ));
  }

  for (const id of nextIds) {
    if (previousIds.has(id)) continue;
    const candidate = byId.get(id);
    if (!candidate || candidate.operation.order.actorId !== input.actorId) continue;
    const acknowledged = new Set(
      candidate.log.undoAcknowledgements.map(({ undoOperationId }) => undoOperationId)
    );
    const pending = candidate.log.undoOperations.filter((undo) => (
      undo.targetOperationId === id &&
      undo.order.actorId === input.actorId &&
      !acknowledged.has(undo.undoOperationId)
    ));
    for (const undo of pending) {
      acknowledgementIds.push(appendAcknowledgement(
        input.document,
        candidate.log,
        candidate.operation,
        undo,
        input.actorId,
        uuid
      ));
    }
  }

  return Object.freeze({
    undoOperationIds: Object.freeze(undoOperationIds),
    acknowledgementIds: Object.freeze(acknowledgementIds),
  });
}

/** Convenient deterministic placeholder for tests that do not exercise Web Crypto. */
export const STUDIO_RASTER_TEST_SEMANTIC_SHA256 = ZERO_SHA256;
