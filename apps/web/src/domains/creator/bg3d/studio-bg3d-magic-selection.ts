/**
 * Renderer-neutral eligibility boundary for the first Studio 3D Magic Layer slice.
 *
 * The first slice intentionally supports only a fresh insertion containing canonical primitives.
 * Model/custom geometry and attachment-backed scenes stay fail-closed until their stable-ID
 * ownership and persistence contract is defined. This helper never mutates or retains the scene.
 */

import {
  collectStudioBg3dEffectivelyVisibleEntityIds,
  resolveStudioBg3dHierarchy,
} from "./studio-bg3d-hierarchy";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_KIND,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
  STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
  type StudioBg3dSceneDocument,
  type StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";

export type StudioBg3dMagicSelectionOperation = "insert" | "update";

export interface ResolveStudioBg3dMagicSelectionInput {
  /** Update/re-edit is deliberately ineligible in the first vertical slice. */
  readonly operation: StudioBg3dMagicSelectionOperation;
  /** Canonical document produced by the runtime-to-document adapter. */
  readonly document: StudioBg3dSceneDocument;
  /** Complete editor selection snapshot. Exactly one ID is required. */
  readonly selectedIds: readonly string[];
}

export type StudioBg3dMagicSelectionIneligibleReason =
  | "attachments-not-supported"
  | "invalid-document"
  | "invalid-input"
  | "invalid-selected-id"
  | "model-nodes-not-supported"
  | "selected-node-hidden"
  | "selected-node-missing"
  | "selected-node-not-primitive"
  | "selection-count"
  | "update-not-supported";

export const STUDIO_BG3D_MAGIC_SELECTION_REASON_MESSAGES = Object.freeze({
  "attachments-not-supported":
    "첨부 모델이 없는 기본 도형 장면에서만 Magic Layer를 만들 수 있어요.",
  "invalid-document":
    "3D 장면 데이터가 올바르지 않아 Magic Layer를 만들 수 없어요.",
  "invalid-input":
    "Magic Layer 선택 정보를 확인할 수 없어요.",
  "invalid-selected-id":
    "선택한 3D 객체 식별자가 올바르지 않아요.",
  "model-nodes-not-supported":
    "첫 Magic Layer는 기본 3D 도형만 지원해요. 모델 객체를 제거해 주세요.",
  "selected-node-hidden":
    "숨겨진 3D 객체에는 Magic Layer를 만들 수 없어요.",
  "selected-node-missing":
    "선택한 3D 객체를 현재 장면에서 찾을 수 없어요.",
  "selected-node-not-primitive":
    "첫 Magic Layer는 선택한 기본 3D 도형에만 적용할 수 있어요.",
  "selection-count":
    "Magic Layer로 분리할 기본 3D 도형 하나만 선택해 주세요.",
  "update-not-supported":
    "첫 Magic Layer는 새 3D 배경을 추가할 때만 만들 수 있어요.",
} satisfies Readonly<Record<StudioBg3dMagicSelectionIneligibleReason, string>>);

export interface StudioBg3dMagicSelectionSnapshot {
  readonly selectedId: string;
  /** Stable object identity consumed by the Babylon object-ID legend. */
  readonly stableId: string;
}

export interface StudioBg3dMagicSelectionEligible {
  readonly ok: true;
  readonly snapshot: StudioBg3dMagicSelectionSnapshot;
}

export interface StudioBg3dMagicSelectionIneligible {
  readonly ok: false;
  readonly reason: StudioBg3dMagicSelectionIneligibleReason;
  readonly message: string;
}

export type StudioBg3dMagicSelectionResult =
  | StudioBg3dMagicSelectionEligible
  | StudioBg3dMagicSelectionIneligible;

type UnknownRecord = Record<PropertyKey, unknown>;

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const STABLE_OBJECT_ID_PATTERN = /^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_NODE_IDS = new Set(["constructor", "prototype", "__proto__"]);

function failure(
  reason: StudioBg3dMagicSelectionIneligibleReason,
): StudioBg3dMagicSelectionIneligible {
  return Object.freeze({
    ok: false,
    reason,
    message: STUDIO_BG3D_MAGIC_SELECTION_REASON_MESSAGES[reason],
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeCanonicalNodeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    NODE_ID_PATTERN.test(value) &&
    !FORBIDDEN_NODE_IDS.has(value.toLowerCase())
  );
}

function isCanonicalDocumentRoot(
  value: unknown,
): value is StudioBg3dSceneDocument {
  if (!isRecord(value)) return false;
  try {
    return (
      value.kind === STUDIO_BG3D_SCENE_DOCUMENT_KIND &&
      value.version === STUDIO_BG3D_SCENE_DOCUMENT_VERSION &&
      Array.isArray(value.attachments) &&
      Array.isArray(value.nodes) &&
      value.nodes.length <= STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES
    );
  } catch {
    return false;
  }
}

interface CanonicalNodeIndex {
  readonly selectedNode: StudioBg3dSceneNode | null;
  readonly selectedNodeEffectivelyVisible: boolean;
  readonly hasModelNode: boolean;
}

function indexCanonicalNodes(
  nodes: readonly StudioBg3dSceneNode[],
  selectedId: string,
): CanonicalNodeIndex | null {
  const seenIds = new Set<string>();
  let selectedNode: StudioBg3dSceneNode | null = null;
  let hasModelNode = false;
  try {
    for (const node of nodes) {
      if (
        !isRecord(node) ||
        !isSafeCanonicalNodeId(node.id) ||
        seenIds.has(node.id) ||
        (node.kind !== "primitive" && node.kind !== "model") ||
        typeof node.visible !== "boolean" ||
        (
          node.parentId !== undefined &&
          node.parentId !== null &&
          !isSafeCanonicalNodeId(node.parentId)
        )
      ) {
        return null;
      }
      seenIds.add(node.id);
      if (node.kind === "model") hasModelNode = true;
      if (node.id === selectedId) selectedNode = node as StudioBg3dSceneNode;
    }
    const hierarchy = resolveStudioBg3dHierarchy(nodes);
    if (
      hierarchy.repairedOrphans !== 0 ||
      hierarchy.repairedSelfParents !== 0 ||
      hierarchy.repairedCycles !== 0
    ) {
      return null;
    }
    const effectivelyVisibleIds =
      collectStudioBg3dEffectivelyVisibleEntityIds(nodes);
    return {
      selectedNode,
      selectedNodeEffectivelyVisible: effectivelyVisibleIds.has(selectedId),
      hasModelNode,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a frozen selection identity that can be compared after every asynchronous capture step.
 * All unsupported first-slice states return a typed UI-facing failure without partial eligibility.
 */
export function resolveStudioBg3dMagicSelection(
  input: ResolveStudioBg3dMagicSelectionInput,
): StudioBg3dMagicSelectionResult {
  if (!isRecord(input)) return failure("invalid-input");

  let operation: unknown;
  let document: unknown;
  let selectedIds: unknown;
  try {
    operation = input.operation;
    document = input.document;
    selectedIds = input.selectedIds;
  } catch {
    return failure("invalid-input");
  }

  if (operation !== "insert" && operation !== "update") {
    return failure("invalid-input");
  }
  if (operation === "update") return failure("update-not-supported");
  if (!isCanonicalDocumentRoot(document)) return failure("invalid-document");
  if (!Array.isArray(selectedIds)) return failure("invalid-input");
  if (selectedIds.length !== 1) return failure("selection-count");

  const selectedId = selectedIds[0];
  if (!isSafeCanonicalNodeId(selectedId)) {
    return failure("invalid-selected-id");
  }
  const stableId = `obj/${selectedId}`;
  if (!STABLE_OBJECT_ID_PATTERN.test(stableId)) {
    return failure("invalid-selected-id");
  }

  if (document.attachments.length !== 0) {
    return failure("attachments-not-supported");
  }

  const indexed = indexCanonicalNodes(document.nodes, selectedId);
  if (!indexed) return failure("invalid-document");
  if (!indexed.selectedNode) return failure("selected-node-missing");
  if (indexed.selectedNode.kind !== "primitive") {
    return failure("selected-node-not-primitive");
  }
  if (!indexed.selectedNodeEffectivelyVisible) {
    return failure("selected-node-hidden");
  }
  if (indexed.hasModelNode) return failure("model-nodes-not-supported");

  const snapshot = Object.freeze({ selectedId, stableId });
  return Object.freeze({ ok: true, snapshot });
}
