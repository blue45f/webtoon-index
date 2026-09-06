/**
 * Pure boundary between StudioBackground3D's legacy runtime arrays and the engine-neutral scene
 * document. IndexedDB model ids are accepted only as ephemeral lookup keys and are never copied
 * into a persisted document.
 */

import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_PRIMITIVE_KINDS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
  StudioBg3dSceneDocumentBudgetError,
  normalizeStudioBg3dAnimationPlayback,
  normalizeStudioBg3dConstraintLayer,
  normalizeStudioBg3dGlbAttachment,
  normalizeStudioBg3dMaterialOverride,
  normalizeStudioBg3dPoseLayer,
  normalizeStudioBg3dMorphLayer,
  normalizeStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dModelAttachment,
  type StudioBg3dSceneDocument,
  type StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";

import type { BgCustomModelInstance } from "../studio-background-3d-model";
import type {
  BgPrimitive,
  BgPrimitiveKind,
} from "../studio-background-3d-primitives";

export const STUDIO_BG3D_RUNTIME_ADAPTER_MAX_SCAN_ITEMS =
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES * 4;
export const STUDIO_BG3D_RUNTIME_ADAPTER_MAX_DIAGNOSTICS = 128;

export type StudioBg3dRuntimeAdapterDirection =
  | "runtime-to-document"
  | "document-to-runtime";

export type StudioBg3dRuntimeAdapterDiagnosticCode =
  | "invalid-base-document"
  | "invalid-scene-document"
  | "invalid-runtime-collection"
  | "input-scan-limit-exceeded"
  | "invalid-primitive"
  | "invalid-custom-model"
  | "lossy-custom-model-normalization"
  | "duplicate-node-id"
  | "node-budget-exceeded"
  | "unresolved-storage-model"
  | "invalid-attachment-binding"
  | "unsafe-identity-binding"
  | "conflicting-attachment-id"
  | "conflicting-attachment-hash"
  | "attachment-budget-exceeded"
  | "model-byte-budget-exceeded"
  | "persistence-byte-budget-exceeded"
  | "lossy-shot-repair"
  | "unresolved-attachment"
  | "invalid-storage-binding"
  | "conflicting-storage-binding";

export interface StudioBg3dRuntimeAdapterDiagnostic {
  readonly direction: StudioBg3dRuntimeAdapterDirection;
  readonly code: StudioBg3dRuntimeAdapterDiagnosticCode;
  readonly source: "base" | "primitive" | "custom-model" | "document";
  /** Input-array index; intentionally absent for aggregate or document-level diagnostics. */
  readonly sourceIndex?: number;
  /** Included only when it is already a canonical-safe scene node id. */
  readonly nodeId?: string;
  /** Number of affected records represented by this bounded diagnostic. */
  readonly count: number;
}

/**
 * Runtime-to-document conversion never returns a persistence-safe prefix when a bounded workload
 * does not fit. Callers can distinguish the exact fail-closed reason without changing the success
 * return shape used by the editor.
 */
export class StudioBg3dRuntimeAdapterError extends Error {
  readonly code: StudioBg3dRuntimeAdapterDiagnosticCode;
  readonly source: StudioBg3dRuntimeAdapterDiagnostic["source"];
  readonly sourceIndex?: number;
  readonly nodeId?: string;

  constructor(
    code: StudioBg3dRuntimeAdapterDiagnosticCode,
    source: StudioBg3dRuntimeAdapterDiagnostic["source"],
    details: { readonly sourceIndex?: number; readonly nodeId?: string } = {},
    options?: ErrorOptions,
  ) {
    super(`Studio BG3D runtime adapter failed closed: ${code}.`, options);
    this.name = "StudioBg3dRuntimeAdapterError";
    this.code = code;
    this.source = source;
    this.sourceIndex = details.sourceIndex;
    this.nodeId = details.nodeId;
  }
}

function failAdapter(
  code: StudioBg3dRuntimeAdapterDiagnosticCode,
  source: StudioBg3dRuntimeAdapterDiagnostic["source"],
  details: { readonly sourceIndex?: number; readonly nodeId?: string } = {},
  cause?: unknown,
): never {
  throw new StudioBg3dRuntimeAdapterError(
    code,
    source,
    details,
    cause === undefined ? undefined : { cause },
  );
}

export interface StudioBg3dRuntimeAdapterCounts {
  readonly inputPrimitives: number;
  readonly inputCustomModels: number;
  readonly emittedPrimitives: number;
  readonly emittedCustomModels: number;
  readonly droppedPrimitives: number;
  readonly droppedCustomModels: number;
}

export interface StudioBg3dRuntimeToDocumentInput {
  readonly primitives: readonly BgPrimitive[];
  readonly customModels: readonly BgCustomModelInstance[];
  /** Ephemeral IndexedDB id -> verified, scene-local canonical attachment metadata. */
  readonly attachmentByStorageModelId: ReadonlyMap<string, StudioBg3dModelAttachment>;
  /** Only settings are preserved; base nodes and attachments are intentionally replaced. */
  readonly baseDocument?: StudioBg3dSceneDocument;
}

export interface StudioBg3dRuntimeToDocumentResult {
  readonly document: StudioBg3dSceneDocument;
  readonly serialized: string;
  readonly diagnostics: readonly StudioBg3dRuntimeAdapterDiagnostic[];
  readonly omittedDiagnosticCount: number;
  readonly counts: StudioBg3dRuntimeAdapterCounts;
}

export type StudioBg3dRuntimeToDocumentAttempt =
  | {
      readonly ok: true;
      readonly value: StudioBg3dRuntimeToDocumentResult;
    }
  | {
      readonly ok: false;
      readonly error: StudioBg3dRuntimeAdapterError;
    };

export interface StudioBg3dDocumentToRuntimeInput {
  readonly document: StudioBg3dSceneDocument;
  /** Canonical attachment id -> ephemeral IndexedDB id for this device/session. */
  readonly storageModelIdByAttachmentId: ReadonlyMap<string, string>;
}

export interface StudioBg3dDocumentToRuntimeResult {
  readonly ok: boolean;
  readonly primitives: BgPrimitive[];
  readonly customModels: BgCustomModelInstance[];
  readonly diagnostics: readonly StudioBg3dRuntimeAdapterDiagnostic[];
  readonly omittedDiagnosticCount: number;
  readonly counts: StudioBg3dRuntimeAdapterCounts;
}

interface PendingNode {
  readonly node: StudioBg3dSceneNode;
  readonly source: "primitive" | "custom-model";
  readonly sourceIndex: number;
}

interface StrictRoundTrip {
  readonly document: StudioBg3dSceneDocument;
  readonly serialized: string;
}

type RuntimePayloadNormalization<Value> =
  | { readonly status: "valid"; readonly value: Value }
  | { readonly status: "invalid" | "lossy" };

type RuntimeModelNodeResult =
  | { readonly node: StudioBg3dSceneNode; readonly diagnosticCode?: never }
  | {
    readonly node: null;
    readonly diagnosticCode:
      | "invalid-custom-model"
      | "lossy-custom-model-normalization";
  };

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const COLOR_PATTERN = /^#[a-f0-9]{6}$/iu;
const FORBIDDEN_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const PRIMITIVE_KIND_SET = new Set<string>(STUDIO_BG3D_PRIMITIVE_KINDS);
const UTF8_ENCODER = new TextEncoder();

class DiagnosticCollector {
  readonly #direction: StudioBg3dRuntimeAdapterDirection;
  readonly #items: StudioBg3dRuntimeAdapterDiagnostic[] = [];
  #total = 0;

  constructor(direction: StudioBg3dRuntimeAdapterDirection) {
    this.#direction = direction;
  }

  add(
    code: StudioBg3dRuntimeAdapterDiagnosticCode,
    source: StudioBg3dRuntimeAdapterDiagnostic["source"],
    options: { readonly sourceIndex?: number; readonly nodeId?: string; readonly count?: number } = {}
  ): void {
    const count = Math.max(1, Math.floor(options.count ?? 1));
    this.#total += 1;
    if (this.#items.length >= STUDIO_BG3D_RUNTIME_ADAPTER_MAX_DIAGNOSTICS) return;
    this.#items.push(Object.freeze({
      direction: this.#direction,
      code,
      source,
      ...(options.sourceIndex === undefined ? {} : { sourceIndex: options.sourceIndex }),
      ...(options.nodeId === undefined ? {} : { nodeId: options.nodeId }),
      count,
    }));
  }

  finish(): {
    readonly diagnostics: readonly StudioBg3dRuntimeAdapterDiagnostic[];
    readonly omittedDiagnosticCount: number;
  } {
    return {
      diagnostics: Object.freeze([...this.#items]),
      omittedDiagnosticCount: Math.max(0, this.#total - this.#items.length),
    };
  }
}

function isSafeNodeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    NODE_ID_PATTERN.test(value) &&
    !FORBIDDEN_ID_SET.has(value.toLowerCase())
  );
}

function isFiniteVec3(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function isSafeStorageModelId(value: unknown): value is string {
  if (typeof value !== "string" || !value || UTF8_ENCODER.encode(value).byteLength > 512) {
    return false;
  }
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x1f || point === 0x7f) return false;
  }
  return true;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Capture the exact JSON value seen by the persistence normalizers before inspecting it. Besides
 * making getters/toJSON run at most once, this preserves JSON boundary semantics for NaN and
 * Infinity (`null`) and lets us distinguish a valid canonical payload from a lenient repair.
 */
function snapshotJsonValue(value: unknown):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false } {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { ok: false };
    return { ok: true, value: JSON.parse(serialized) as unknown };
  } catch {
    return { ok: false };
  }
}

function jsonStructuresEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonStructuresEqual(item, right[index]));
  }
  if (!isJsonRecord(left) || !isJsonRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => (
    key === rightKeys[index] && jsonStructuresEqual(left[key], right[key])
  ));
}

function normalizeRuntimePayloadLosslessly<Value>(
  raw: unknown,
  normalize: (value: unknown) => Value | null,
  upgrade?: (value: unknown) => unknown,
): RuntimePayloadNormalization<Value> {
  const snapshot = snapshotJsonValue(raw);
  if (!snapshot.ok) return { status: "invalid" };
  const input = upgrade ? upgrade(snapshot.value) : snapshot.value;
  let normalized: Value | null;
  try {
    normalized = normalize(input);
  } catch (cause) {
    // SceneDocument deliberately throws typed budget failures so direct persistence callers can
    // reject an oversized document. At this per-model adapter boundary the established contract is
    // to drop the complete lossy model with a bounded diagnostic, never leak an event-loop error.
    if (cause instanceof StudioBg3dSceneDocumentBudgetError) return { status: "lossy" };
    throw cause;
  }
  if (!normalized) return { status: "invalid" };
  if (!jsonStructuresEqual(input, normalized)) return { status: "lossy" };
  return { status: "valid", value: normalized };
}

function upgradeAimOnlyV2ConstraintLayer(value: unknown): unknown {
  if (
    isJsonRecord(value) &&
    Array.isArray(value.aims) &&
    !Object.prototype.hasOwnProperty.call(value, "twoBoneIks")
  ) {
    return { ...value, twoBoneIks: [] };
  }
  return value;
}

function strictRoundTrip(raw: unknown): StrictRoundTrip | null {
  const serialized = serializeStudioBg3dSceneDocument(raw);
  if (!serialized) return null;
  const document = parseStudioBg3dSceneDocument(serialized);
  if (!document || serializeStudioBg3dSceneDocument(document) !== serialized) return null;
  return { document, serialized };
}

/** Internal runtime arrays are editor state, so sanitize them explicitly before persistence. */
function normalizedRuntimeRoundTrip(raw: unknown): StrictRoundTrip | null {
  return strictRoundTrip(normalizeStudioBg3dSceneDocument(raw));
}

function settingsOnlyDocument(
  base: StudioBg3dSceneDocument,
  attachments: readonly StudioBg3dModelAttachment[],
  nodes: readonly StudioBg3dSceneNode[]
): StudioBg3dSceneDocument {
  return {
    kind: base.kind,
    version: base.version,
    camera: base.camera,
    render: base.render,
    background: base.background,
    lighting: base.lighting,
    quality: base.quality,
    output: base.output,
    budgets: base.budgets,
    attachments,
    nodes,
    ...(base.shots === undefined ? {} : { shots: base.shots }),
    ...(base.activeShotId === undefined ? {} : { activeShotId: base.activeShotId }),
  };
}

function canonicalBaseDocument(
  raw: StudioBg3dSceneDocument | undefined,
  diagnostics: DiagnosticCollector
): StudioBg3dSceneDocument {
  if (!raw) return DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT;
  const roundTrip = strictRoundTrip(raw);
  if (roundTrip) return roundTrip.document;
  diagnostics.add("invalid-base-document", "base");
  return DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT;
}

function readMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value | undefined {
  try {
    return map.get(key);
  } catch {
    return undefined;
  }
}

function primitiveNodeFromRuntime(value: BgPrimitive): StudioBg3dSceneNode | null {
  if (
    !isSafeNodeId(value?.id) ||
    typeof value?.kind !== "string" ||
    !PRIMITIVE_KIND_SET.has(value.kind) ||
    !isFiniteVec3(value.position) ||
    !isFiniteVec3(value.rotation) ||
    !isFiniteVec3(value.scale) ||
    typeof value.color !== "string" ||
    !COLOR_PATTERN.test(value.color)
  ) {
    return null;
  }
  const materialOverride = value.materialOverride === undefined
    ? undefined
    : normalizeStudioBg3dMaterialOverride(value.materialOverride);
  return {
    id: value.id,
    name: value.name || value.kind,
    kind: "primitive",
    primitiveKind: value.kind as BgPrimitiveKind,
    color: value.color,
    ...(materialOverride ? { materialOverride } : {}),
    transform: {
      position: [...value.position],
      rotation: [...value.rotation],
      scale: [...value.scale],
    },
    visible: value.visible !== false,
    locked: value.locked === true,
    castsShadow: true,
    receivesShadow: true,
    parentId: value.parentId ?? null,
  };
}

function modelNodeFromRuntime(
  value: BgCustomModelInstance,
  attachmentId: string
): RuntimeModelNodeResult {
  if (
    !isSafeNodeId(value?.id) ||
    !isFiniteVec3(value.position) ||
    !isFiniteVec3(value.rotation) ||
    !isFiniteVec3(value.scale)
  ) {
    return { node: null, diagnosticCode: "invalid-custom-model" };
  }

  const rawMaterialOverride = value.materialOverride;
  const rawAnimation = value.animation;
  const rawPose = value.pose;
  const rawMorph = value.morph;
  const rawConstraints = value.constraints;
  const payloads = [
    rawMaterialOverride === undefined
      ? undefined
      : normalizeRuntimePayloadLosslessly(
        rawMaterialOverride,
        normalizeStudioBg3dMaterialOverride,
      ),
    rawAnimation === undefined
      ? undefined
      : normalizeRuntimePayloadLosslessly(
        rawAnimation,
        normalizeStudioBg3dAnimationPlayback,
      ),
    rawPose === undefined
      ? undefined
      : normalizeRuntimePayloadLosslessly(rawPose, normalizeStudioBg3dPoseLayer),
    rawMorph === undefined
      ? undefined
      : normalizeRuntimePayloadLosslessly(rawMorph, normalizeStudioBg3dMorphLayer),
    rawConstraints === undefined
      ? undefined
      : normalizeRuntimePayloadLosslessly(
        rawConstraints,
        normalizeStudioBg3dConstraintLayer,
        upgradeAimOnlyV2ConstraintLayer,
      ),
  ] as const;
  const invalidPayload = payloads.find((payload) => payload?.status === "invalid");
  if (invalidPayload) {
    return { node: null, diagnosticCode: "invalid-custom-model" };
  }
  const lossyPayload = payloads.find((payload) => payload?.status === "lossy");
  if (lossyPayload) {
    return { node: null, diagnosticCode: "lossy-custom-model-normalization" };
  }

  const materialOverride = payloads[0]?.status === "valid" ? payloads[0].value : undefined;
  const animation = payloads[1]?.status === "valid" ? payloads[1].value : undefined;
  const pose = payloads[2]?.status === "valid" ? payloads[2].value : undefined;
  const morph = payloads[3]?.status === "valid" ? payloads[3].value : undefined;
  const constraints = payloads[4]?.status === "valid" ? payloads[4].value : undefined;
  return {
    node: {
      id: value.id,
      name: value.name || "GLB 모델",
      kind: "model",
      attachmentId,
      transform: {
        position: [...value.position],
        rotation: [...value.rotation],
        scale: [...value.scale],
      },
      visible: value.visible !== false,
      locked: value.locked === true,
      castsShadow: true,
      receivesShadow: true,
      parentId: value.parentId ?? null,
      ...(materialOverride ? { materialOverride } : {}),
      ...(animation ? { animation } : {}),
      ...(pose ? { pose } : {}),
      ...(morph ? { morph } : {}),
      ...(constraints ? { constraints } : {}),
    },
  };
}

function nodesMatchPrefix(
  pending: readonly PendingNode[],
  count: number,
  document: StudioBg3dSceneDocument
): boolean {
  if (document.nodes.length !== count) return false;
  for (let index = 0; index < count; index += 1) {
    const expected = pending[index]?.node;
    const actual = document.nodes[index];
    if (
      !expected ||
      !actual ||
      expected.id !== actual.id ||
      expected.kind !== actual.kind ||
      (expected.kind === "model" &&
        (actual.kind !== "model" || expected.attachmentId !== actual.attachmentId))
    ) {
      return false;
    }
  }
  return true;
}

function shotStateMatches(
  base: StudioBg3dSceneDocument,
  document: StudioBg3dSceneDocument,
): boolean {
  return jsonStructuresEqual(base.shots, document.shots) &&
    base.activeShotId === document.activeShotId;
}

/** Converts legacy runtime arrays to a strict, persistence-safe canonical scene document. */
export function adaptStudioBg3dRuntimeToDocument(
  input: StudioBg3dRuntimeToDocumentInput
): StudioBg3dRuntimeToDocumentResult {
  const diagnostics = new DiagnosticCollector("runtime-to-document");
  const base = canonicalBaseDocument(input.baseDocument, diagnostics);
  const primitives = Array.isArray(input.primitives) ? input.primitives : [];
  const customModels = Array.isArray(input.customModels) ? input.customModels : [];
  if (!Array.isArray(input.primitives)) diagnostics.add("invalid-runtime-collection", "primitive");
  if (!Array.isArray(input.customModels)) {
    diagnostics.add("invalid-runtime-collection", "custom-model");
  }
  if (primitives.length > STUDIO_BG3D_RUNTIME_ADAPTER_MAX_SCAN_ITEMS) {
    failAdapter("input-scan-limit-exceeded", "primitive");
  }
  if (customModels.length > STUDIO_BG3D_RUNTIME_ADAPTER_MAX_SCAN_ITEMS) {
    failAdapter("input-scan-limit-exceeded", "custom-model");
  }

  const pending: PendingNode[] = [];
  const nodeIds = new Set<string>();
  const attachments: StudioBg3dModelAttachment[] = [];
  const attachmentById = new Map<string, { attachment: StudioBg3dModelAttachment; json: string }>();
  const attachmentIdByHash = new Map<string, string>();
  let cumulativeModelBytes = 0;
  const nodeLimit = Math.min(
    STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
    base.budgets.complexity.maxNodes
  );

  const primitiveScanCount = primitives.length;
  for (let index = 0; index < primitiveScanCount; index += 1) {
    const node = primitiveNodeFromRuntime(primitives[index] as BgPrimitive);
    if (!node) {
      diagnostics.add("invalid-primitive", "primitive", { sourceIndex: index });
      continue;
    }
    if (nodeIds.has(node.id)) {
      diagnostics.add("duplicate-node-id", "primitive", {
        sourceIndex: index,
        nodeId: node.id,
      });
      continue;
    }
    if (pending.length >= nodeLimit) {
      failAdapter("node-budget-exceeded", "primitive", {
        sourceIndex: index,
        nodeId: node.id,
      });
    }
    pending.push({ node, source: "primitive", sourceIndex: index });
    nodeIds.add(node.id);
  }
  const customModelScanCount = customModels.length;
  for (let index = 0; index < customModelScanCount; index += 1) {
    const instance = customModels[index] as BgCustomModelInstance;
    if (
      !instance ||
      !isSafeNodeId(instance.id) ||
      !isSafeStorageModelId(instance.modelId) ||
      !isFiniteVec3(instance.position) ||
      !isFiniteVec3(instance.rotation) ||
      !isFiniteVec3(instance.scale)
    ) {
      diagnostics.add("invalid-custom-model", "custom-model", { sourceIndex: index });
      continue;
    }
    if (nodeIds.has(instance.id)) {
      diagnostics.add("duplicate-node-id", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    if (pending.length >= nodeLimit) {
      failAdapter("node-budget-exceeded", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
    }

    const rawAttachment = readMapValue(input.attachmentByStorageModelId, instance.modelId);
    if (rawAttachment === undefined) {
      diagnostics.add("unresolved-storage-model", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    const attachment = normalizeStudioBg3dGlbAttachment(rawAttachment);
    if (!attachment) {
      diagnostics.add("invalid-attachment-binding", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    if (attachment.id === instance.modelId) {
      diagnostics.add("unsafe-identity-binding", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }

    const json = JSON.stringify(attachment);
    const existingById = attachmentById.get(attachment.id);
    if (existingById && existingById.json !== json) {
      diagnostics.add("conflicting-attachment-id", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    const existingIdForHash = attachmentIdByHash.get(attachment.hash);
    if (existingIdForHash && existingIdForHash !== attachment.id) {
      diagnostics.add("conflicting-attachment-hash", "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    if (!existingById) {
      if (attachments.length >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS) {
        failAdapter("attachment-budget-exceeded", "custom-model", {
          sourceIndex: index,
          nodeId: instance.id,
        });
      }
      if (
        cumulativeModelBytes + attachment.byteSize >
        base.budgets.complexity.maxModelBytes
      ) {
        failAdapter("model-byte-budget-exceeded", "custom-model", {
          sourceIndex: index,
          nodeId: instance.id,
        });
      }
      attachments.push(attachment);
      attachmentById.set(attachment.id, { attachment, json });
      attachmentIdByHash.set(attachment.hash, attachment.id);
      cumulativeModelBytes += attachment.byteSize;
    }

    const modelNode = modelNodeFromRuntime(instance, attachment.id);
    if (!modelNode.node) {
      diagnostics.add(modelNode.diagnosticCode, "custom-model", {
        sourceIndex: index,
        nodeId: instance.id,
      });
      continue;
    }
    pending.push({ node: modelNode.node, source: "custom-model", sourceIndex: index });
    nodeIds.add(modelNode.node.id);
  }
  let roundTrip: StrictRoundTrip | null;
  const emittedNodes = pending.map((entry) => entry.node);
  const referencedAttachmentIds = new Set(emittedNodes.flatMap((node) =>
    node.kind === "model" ? [node.attachmentId] : []));
  const emittedAttachments = attachments.filter((attachment) =>
    referencedAttachmentIds.has(attachment.id));
  try {
    roundTrip = normalizedRuntimeRoundTrip(
      settingsOnlyDocument(base, emittedAttachments, emittedNodes),
    );
  } catch (cause) {
    if (cause instanceof StudioBg3dSceneDocumentBudgetError) {
      failAdapter("persistence-byte-budget-exceeded", "document", {}, cause);
    }
    throw cause;
  }
  if (!roundTrip) failAdapter("persistence-byte-budget-exceeded", "document");
  if (!nodesMatchPrefix(pending, pending.length, roundTrip.document)) {
    failAdapter("persistence-byte-budget-exceeded", "document");
  }
  if (!shotStateMatches(base, roundTrip.document)) {
    failAdapter("lossy-shot-repair", "base");
  }

  const emittedPrimitives = roundTrip.document.nodes.filter(
    (node) => node.kind === "primitive"
  ).length;
  const emittedCustomModels = roundTrip.document.nodes.length - emittedPrimitives;
  const finished = diagnostics.finish();
  return {
    document: roundTrip.document,
    serialized: roundTrip.serialized,
    ...finished,
    counts: Object.freeze({
      inputPrimitives: primitives.length,
      inputCustomModels: customModels.length,
      emittedPrimitives,
      emittedCustomModels,
      droppedPrimitives: primitives.length - emittedPrimitives,
      droppedCustomModels: customModels.length - emittedCustomModels,
    }),
  };
}

/**
 * Product/UI boundary for the throwing adapter. Budget failures are expected admission outcomes,
 * not render/event-loop exceptions; unexpected programmer errors continue to propagate.
 */
export function tryAdaptStudioBg3dRuntimeToDocument(
  input: StudioBg3dRuntimeToDocumentInput,
): StudioBg3dRuntimeToDocumentAttempt {
  try {
    return { ok: true, value: adaptStudioBg3dRuntimeToDocument(input) };
  } catch (error) {
    if (error instanceof StudioBg3dRuntimeAdapterError) {
      return { ok: false, error };
    }
    throw error;
  }
}

/** Hydrates a strict canonical document into fresh legacy runtime arrays using explicit bindings. */
export function hydrateStudioBg3dDocumentToRuntime(
  input: StudioBg3dDocumentToRuntimeInput
): StudioBg3dDocumentToRuntimeResult {
  const diagnostics = new DiagnosticCollector("document-to-runtime");
  const canonical = strictRoundTrip(input.document);
  if (!canonical) {
    diagnostics.add("invalid-scene-document", "document");
    const finished = diagnostics.finish();
    return {
      ok: false,
      primitives: [],
      customModels: [],
      ...finished,
      counts: Object.freeze({
        inputPrimitives: 0,
        inputCustomModels: 0,
        emittedPrimitives: 0,
        emittedCustomModels: 0,
        droppedPrimitives: 0,
        droppedCustomModels: 0,
      }),
    };
  }

  const primitives: BgPrimitive[] = [];
  const customModels: BgCustomModelInstance[] = [];
  const attachmentIdByStorageModelId = new Map<string, string>();
  let inputPrimitives = 0;
  let inputCustomModels = 0;
  for (let index = 0; index < canonical.document.nodes.length; index += 1) {
    const node = canonical.document.nodes[index];
    if (node.kind === "primitive") {
      inputPrimitives += 1;
      primitives.push({
        id: node.id,
        kind: node.primitiveKind,
        color: node.color,
        materialOverride: node.materialOverride ? { ...node.materialOverride } : undefined,
        name: node.name !== node.primitiveKind ? node.name : undefined,
        position: [...node.transform.position],
        rotation: [...node.transform.rotation],
        scale: [...node.transform.scale],
        visible: node.visible !== false,
        locked: node.locked === true,
        parentId: node.parentId ?? null,
      });
      continue;
    }

    inputCustomModels += 1;
    const storageModelId = readMapValue(
      input.storageModelIdByAttachmentId,
      node.attachmentId
    );
    if (storageModelId === undefined) {
      diagnostics.add("unresolved-attachment", "custom-model", {
        sourceIndex: index,
        nodeId: node.id,
      });
      continue;
    }
    if (!isSafeStorageModelId(storageModelId)) {
      diagnostics.add("invalid-storage-binding", "custom-model", {
        sourceIndex: index,
        nodeId: node.id,
      });
      continue;
    }
    if (storageModelId === node.attachmentId) {
      diagnostics.add("unsafe-identity-binding", "custom-model", {
        sourceIndex: index,
        nodeId: node.id,
      });
      continue;
    }
    const existingAttachmentId = attachmentIdByStorageModelId.get(storageModelId);
    if (existingAttachmentId && existingAttachmentId !== node.attachmentId) {
      diagnostics.add("conflicting-storage-binding", "custom-model", {
        sourceIndex: index,
        nodeId: node.id,
      });
      continue;
    }
    attachmentIdByStorageModelId.set(storageModelId, node.attachmentId);
    customModels.push({
      id: node.id,
      modelId: storageModelId,
      name: node.name !== "GLB 모델" ? node.name : undefined,
      position: [...node.transform.position],
      rotation: [...node.transform.rotation],
      scale: [...node.transform.scale],
      visible: node.visible !== false,
      locked: node.locked === true,
      parentId: node.parentId ?? null,
      materialOverride: node.materialOverride ? { ...node.materialOverride } : undefined,
      animation: node.animation ? { ...node.animation } : undefined,
      pose: node.pose ? {
        ...node.pose,
        joints: node.pose.joints.map((joint) => ({
          jointKey: joint.jointKey,
          rotationOffset: [...joint.rotationOffset],
        })),
      } : undefined,
      morph: node.morph ? {
        ...node.morph,
        targets: node.morph.targets.map((target) => ({ ...target })),
      } : undefined,
      constraints: node.constraints ? {
        ...node.constraints,
        aims: node.constraints.aims.map((aim) => ({ ...aim, target: [...aim.target] })),
        ...(node.constraints.twoBoneIks ? {
          twoBoneIks: node.constraints.twoBoneIks.map((ik) => ({
            ...ik,
            target: [...ik.target],
            poleTarget: [...ik.poleTarget],
          })),
        } : {}),
      } : undefined,
    });
  }

  const finished = diagnostics.finish();
  return {
    ok: true,
    primitives,
    customModels,
    ...finished,
    counts: Object.freeze({
      inputPrimitives,
      inputCustomModels,
      emittedPrimitives: primitives.length,
      emittedCustomModels: customModels.length,
      droppedPrimitives: inputPrimitives - primitives.length,
      droppedCustomModels: inputCustomModels - customModels.length,
    }),
  };
}
