/**
 * Product handoff from the authoritative Hybrid DCC document to Studio's shipping BG3D editor.
 *
 * The DCC half-edge mesh remains the authoring authority. This module creates verified GLB render
 * derivatives, stores them through the existing content-addressed model-library boundary, and
 * materializes an engine-neutral BG3D scene. No Three/Babylon/OCCT object crosses this boundary.
 */

import {
  createStudioBg3dModelAttachment,
  importVerifiedBg3dModelsAtomicallyV12 as importVerifiedBg3dModelsAtomically,
} from "../bg3d/bg3d-model-library";
import { fitStudioBg3dCameraToBounds } from "../bg3d/studio-bg3d-camera-framing";
import { computeStudioBg3dAutoFitScale } from "../bg3d/studio-bg3d-model-scale-contract";
import {
  buildStudioBg3dRoomParts,
  getStudioBg3dRoomPreset,
} from "../bg3d/studio-bg3d-room-builder";
import {
  captureStudioBg3dShot,
  createDefaultStudioBg3dSceneDocument,
  normalizeStudioBg3dGlbAttachment,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  STUDIO_BG3D_GLB_MIME,
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS,
  type StudioBg3dAttachmentRights,
  type StudioBg3dModelAttachment,
  type StudioBg3dPrimitiveNode,
  type StudioBg3dSceneDocument,
  type StudioBg3dSceneNode,
} from "../bg3d/studio-bg3d-scene-document";
import { attachStudioGeneric3dWorkflowMetadata } from "../studio-generic-3d-workflow-metadata";
import {
  assertRenderCacheIsNotAuthority,
  type StudioGeometryAuthorityRecord,
} from "../studio-geometry-authority";
import { evaluateStudioMeshModifierStack } from "../studio-mesh-modifier-stack";
import { sha256HexPortable } from "../studio-sha256";
import { createStudioDefaultSolidBooleanBackend } from "../studio-solid-boolean-backend";

import { deriveStudioHybridDccAssetLayout } from "./studio-hybrid-dcc-asset-layout";
import {
  exportStudioHybridDccGlbBatch,
  type StudioHybridDccGlbExportExecutionBackend,
} from "./studio-hybrid-dcc-glb-export-worker-client";

import type {
  StudioHybridDccGlbIssue,
  StudioHybridDccMeshGlbExportResult,
} from "./studio-hybrid-dcc-glb-export";
import type { StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";

const UTF8_ENCODER = new TextEncoder();
const SAFE_SCENE_TEXT_MAX = 80;
const CONTROL_OR_BIDI = new RegExp(
  String.raw`[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]`,
  "gu",
);
const EXTERNAL_OR_SECRET = /(?:\b(?:blob|data|file|https?):|:\/\/|\bwww\.|\b(?:api[-_ ]?key|access[-_ ]?token|secret|password)\b)/iu;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type StudioHybridDccBg3dHandoffErrorCode =
  | "empty-workspace"
  | "asset-budget-exceeded"
  | "export-byte-budget-exceeded"
  | "modifier-preview-invalid"
  | "glb-export-failed"
  | "model-persistence-failed"
  | "attachment-mismatch"
  | "scene-canonicalization-failed"
  | "aborted";

export class StudioHybridDccBg3dHandoffError extends Error {
  readonly code: StudioHybridDccBg3dHandoffErrorCode;

  constructor(code: StudioHybridDccBg3dHandoffErrorCode, message: string) {
    super(message);
    this.name = "StudioHybridDccBg3dHandoffError";
    this.code = code;
  }
}

export type StudioHybridDccBg3dLossCode =
  | "shot-transform-retained-in-dcc"
  | "shot-material-retained-in-dcc"
  | "shot-character-pose-retained-in-dcc"
  | "artist-ink-retained-in-dcc"
  | "glb-export-loss-retained-in-dcc"
  | "glb-export-warning"
  | "bridge-object-retained-in-dcc"
  | "base-material-retained-in-dcc";

export interface StudioHybridDccBg3dLossEntry {
  readonly code: StudioHybridDccBg3dLossCode;
  readonly severity: "info" | "warning";
  readonly assetId?: string;
  readonly shotId?: string;
  readonly sourceIssueCode?: StudioHybridDccGlbIssue["code"];
  readonly count: number;
  readonly resolution: "retained-in-authority";
  readonly detail: string;
}

export interface StudioHybridDccBg3dAssetMapping {
  readonly sourceAssetId: string;
  readonly sourceRevision: number;
  /** Canonical edit-cage hash retained by the DCC document. */
  readonly sourceAuthorityMeshHash: string;
  /** Hash of the exact mesh supplied to the GLB exporter. */
  readonly sourceMeshHash: string;
  readonly sourceGeometryKind: "authority" | "evaluated-modifier-stack";
  readonly sceneNodeId: string;
  readonly attachmentId: string;
  readonly glbHash: `sha256:${string}`;
  readonly glbBytes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly exportIssueCount: number;
}

interface StudioHybridDccBg3dDeliveryRecord extends StudioGeometryAuthorityRecord {
  readonly sourceAuthorityMeshHash: string;
  readonly sourceGeometryKind: StudioHybridDccBg3dAssetMapping["sourceGeometryKind"];
}

export interface StudioHybridDccBg3dShotMapping {
  readonly sourceShotId: string;
  readonly sceneShotId: string;
}

export interface StudioHybridDccBg3dProceduralMapping {
  readonly sourceObjectId: string;
  readonly sourceGeometryHash: string;
  readonly sceneNodeIds: readonly string[];
}

export interface StudioHybridDccBg3dPersistRequest {
  readonly assetId: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256: `sha256:${string}`;
  readonly attachmentId: string;
  readonly rights: StudioBg3dAttachmentRights;
}

export interface StudioHybridDccBg3dPersistedAttachment {
  readonly assetId: string;
  readonly attachment: StudioBg3dModelAttachment;
}

export interface StudioHybridDccBg3dHandoffPorts {
  /** Explicit export backend selected before the handoff begins. Product ports select Worker. */
  readonly glbExportExecutionBackend:
    StudioHybridDccGlbExportExecutionBackend;
  /**
   * Commits the complete request list as one all-or-nothing transaction. Implementations must not
   * resolve until every returned attachment is durable and must leave no new record when rejecting.
   */
  readonly persistAttachments: (
    requests: readonly StudioHybridDccBg3dPersistRequest[],
    signal?: AbortSignal,
  ) => Promise<readonly StudioHybridDccBg3dPersistedAttachment[]>;
}

export interface StudioHybridDccBg3dHandoffResult {
  readonly scene: StudioBg3dSceneDocument;
  readonly sourceDocumentId: string;
  readonly sourceStateHash: string;
  readonly sourceCommandCount: number;
  readonly sourceBridgeSetHash: string;
  readonly sourceBridgeCommandSequence: number;
  readonly sourceWorkspaceHash: `sha256:${string}`;
  readonly assets: readonly StudioHybridDccBg3dAssetMapping[];
  readonly proceduralObjects: readonly StudioHybridDccBg3dProceduralMapping[];
  readonly shots: readonly StudioHybridDccBg3dShotMapping[];
  readonly losses: readonly StudioHybridDccBg3dLossEntry[];
  readonly retainedArtistCorrectionCount: number;
  readonly deliveryEvidence: {
    readonly canonicalSceneVerified: true;
    readonly modelPersistence: {
      readonly status: "receipt-verified" | "not-required";
      readonly persistedAttachmentCount: number;
    };
    readonly canvasDocumentIntegrated: false;
    readonly collaborationVerified: false;
    readonly browserVerified: false;
    readonly productionActivated: false;
  };
}

function stableId(prefix: string, source: string): string {
  const digest = sha256HexPortable(UTF8_ENCODER.encode(source)).slice(0, 32);
  return `${prefix}-${digest}`;
}

function safeSceneText(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(CONTROL_OR_BIDI, "")
    .trim()
    .replace(/\s+/gu, " ");
  if (!normalized || EXTERNAL_OR_SECRET.test(normalized)) return fallback;
  return Array.from(normalized).slice(0, SAFE_SCENE_TEXT_MAX).join("");
}

function canonicalHandoffGlbFileName(value: string): string {
  const stem = value.replace(/\.glb$/iu, "").replace(/[\\/]/gu, " ");
  const safeStem = safeSceneText(stem, "DCC Asset").replace(/[. ]+$/gu, "");
  return `${safeStem || "DCC Asset"}.glb`;
}

function plannedAttachment(
  request: StudioHybridDccBg3dPersistRequest,
): StudioBg3dModelAttachment {
  const normalized = normalizeStudioBg3dGlbAttachment(
    attachStudioGeneric3dWorkflowMetadata({
      id: request.attachmentId,
      name: request.fileName,
      mime: STUDIO_BG3D_GLB_MIME,
      byteSize: request.bytes.byteLength,
      hash: request.expectedSha256,
      rights: request.rights,
      source: "local-library" as const,
    }, { classification: "prop", sourceFormat: "glb" }),
  );
  if (
    !normalized
    || normalized.id !== request.attachmentId
    || normalized.hash !== request.expectedSha256
    || normalized.byteSize !== request.bytes.byteLength
  ) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      `Could not preflight attachment metadata for ${request.assetId}`,
    );
  }
  return normalized;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).toSorted(([left], [right]) =>
    compareCodeUnits(left, right))) {
    if (child !== undefined) result[key] = canonicalJsonValue(child);
  }
  return result;
}

function hashWorkspaceDeliverySource(workspace: StudioHybridDccWorkspace): `sha256:${string}` {
  try {
    const canonical = JSON.stringify(canonicalJsonValue({
      sessionStateHash: workspace.session.state.stateHash,
      sessionCommandCount: workspace.session.state.commandCount,
      bridge: workspace.bridge,
    }));
    if (typeof canonical !== "string") throw new TypeError("Canonical workspace is not JSON");
    return `sha256:${sha256HexPortable(UTF8_ENCODER.encode(canonical))}`;
  } catch {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      "DCC delivery provenance contains a non-serializable value",
    );
  }
}

function deriveHandoffSceneBounds(
  layout: ReturnType<typeof deriveStudioHybridDccAssetLayout>,
  proceduralNodes: readonly StudioBg3dPrimitiveNode[],
): { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const include = (
    lower: readonly [number, number, number],
    upper: readonly [number, number, number],
  ) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, lower[axis]);
      max[axis] = Math.max(max[axis]!, upper[axis]);
    }
  };
  for (const item of layout.items) {
    include(item.worldMin, item.worldMax);
  }
  for (const node of proceduralNodes) {
    const { position, scale } = node.transform;
    if (![...position, ...scale].every(Number.isFinite)) return null;
    // A sphere around the unit primitive remains conservative under the persisted Euler rotation.
    const radius = Math.max(0.125, Math.hypot(scale[0], scale[1], scale[2]) / 2);
    include(
      [position[0] - radius, position[1] - radius, position[2] - radius],
      [position[0] + radius, position[1] + radius, position[2] + radius],
    );
  }
  return min.every(Number.isFinite) && max.every(Number.isFinite)
    ? {
        min: min as [number, number, number],
        max: max as [number, number, number],
      }
    : null;
}

function canonicalBg3dRotation(angle: number): number {
  return (((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function canonicalBg3dObjectTransform(
  item: ReturnType<typeof deriveStudioHybridDccAssetLayout>["items"][number],
): {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
} {
  if (item.position.some((component) => Math.abs(component) > 10_000)) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      `Object ${item.assetId} exceeds the BG3D world-coordinate range`,
    );
  }
  const localSize = item.max.map((maximum, axis) =>
    maximum - item.min[axis]!) as [number, number, number];
  const loaderAutoFitScale = computeStudioBg3dAutoFitScale(localSize);
  const bg3dScale = item.scale.map((component) =>
    component / loaderAutoFitScale) as [number, number, number];
  // BG3D normalizes imported roots to a two-unit maximum dimension. Persist the exact inverse on
  // the instance so a one-metre DCC cube remains one metre after handoff instead of silently
  // doubling in size and invalidating the fitted camera. This also preserves large authored sets.
  if (bg3dScale.some((component) => component < 0.001 || component > 1_000)) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      `Object ${item.assetId} cannot preserve its authored size inside the BG3D scale budget`,
    );
  }
  return {
    position: [...item.position],
    rotation: item.rotationEulerRad.map(canonicalBg3dRotation) as [number, number, number],
    scale: bg3dScale,
  };
}

function attachmentsEquivalent(
  actual: StudioBg3dModelAttachment,
  expected: StudioBg3dModelAttachment,
): boolean {
  const normalized = normalizeStudioBg3dGlbAttachment(actual);
  return normalized !== null
    && JSON.stringify(canonicalJsonValue(normalized))
      === JSON.stringify(canonicalJsonValue(expected));
}

function throwIfHandoffAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioHybridDccBg3dHandoffError("aborted", "DCC handoff was cancelled");
  }
}

async function resolveStudioHybridDccDeliveryRecords(
  workspace: StudioHybridDccWorkspace,
  records: readonly StudioGeometryAuthorityRecord[],
  signal?: AbortSignal,
): Promise<readonly StudioHybridDccBg3dDeliveryRecord[]> {
  const backend = createStudioDefaultSolidBooleanBackend();
  const bridgeObjectById = new Map(
    workspace.bridge.set.objects.map((object) => [object.id, object] as const),
  );
  const resolved: StudioHybridDccBg3dDeliveryRecord[] = [];
  for (const record of records) {
    throwIfHandoffAborted(signal);
    if (record.modifierStack.modifiers.length === 0) {
      resolved.push({
        ...record,
        sourceAuthorityMeshHash: record.meshHash,
        sourceGeometryKind: "authority",
      });
      continue;
    }

    const cache = record.renderCache;
    const bridgeHash = bridgeObjectById.get(record.assetId)?.geometryHash;
    if (!cache
      || !assertRenderCacheIsNotAuthority(record)
      || bridgeHash !== cache.derivedFromHash) {
      throw new StudioHybridDccBg3dHandoffError(
        "modifier-preview-invalid",
        `${record.assetId}: 화면에 검증된 비파괴 변형 결과가 없습니다. 미리보기를 다시 계산하거나 변형을 적용한 뒤 전달해 주세요.`,
      );
    }

    let evaluated: Awaited<ReturnType<typeof evaluateStudioMeshModifierStack>>;
    try {
      evaluated = await evaluateStudioMeshModifierStack(record.modifierStack, {
        booleanBackend: backend,
      });
    } catch (error) {
      throw new StudioHybridDccBg3dHandoffError(
        "modifier-preview-invalid",
        `${record.assetId}: ${error instanceof Error ? error.message : "비파괴 변형을 평가하지 못했습니다."}`,
      );
    }
    throwIfHandoffAborted(signal);
    if (!evaluated.ok || evaluated.value.resultHash !== cache.derivedFromHash) {
      throw new StudioHybridDccBg3dHandoffError(
        "modifier-preview-invalid",
        `${record.assetId}: 화면용 변형 결과와 내보내기 재평가 결과가 일치하지 않습니다.`,
      );
    }
    resolved.push({
      ...record,
      mesh: evaluated.value.mesh,
      meshHash: evaluated.value.resultHash,
      sourceAuthorityMeshHash: record.meshHash,
      sourceGeometryKind: "evaluated-modifier-stack",
    });
  }
  return Object.freeze(resolved);
}

async function digestGlbBytes(
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<`sha256:${string}`> {
  throwIfHandoffAborted(signal);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    throwIfHandoffAborted(signal);
    return `sha256:${Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function rightsForRecord(
  workspace: StudioHybridDccWorkspace,
  record: StudioGeometryAuthorityRecord,
): StudioBg3dAttachmentRights {
  const bom = workspace.session.state.rightsBom.find(({ assetId }) => assetId === record.assetId);
  if (!bom) {
    return {
      status: "unknown",
      commercialUse: false,
      attributionRequired: false,
    };
  }
  const creator = bom.creator.trim();
  const license = bom.license.trim();
  const licenseKey = license.toLowerCase();
  // `derivative: original` describes the source relation, not copyright ownership. An externally
  // authored CC-BY original must remain licensed and attributable.
  const owned = creator.toLowerCase() === "studio" && bom.derivative === "original";
  const publicDomain = /^(?:cc0(?:-1\.0)?|public[- ]domain)$/iu.test(licenseKey);
  const unknownLicense = !license || /^(?:unknown|unverified|none|n\/a)$/iu.test(licenseKey);
  const nonCommercial = /(?:^|[-_ ])(?:nc|noncommercial|non-commercial)(?:[-_ ]|$)/iu
    .test(licenseKey);
  const status = publicDomain
    ? "public-domain"
    : owned
      ? "owned"
      : unknownLicense || !creator
        ? "unknown"
        : "licensed";
  const commercialUse = status !== "unknown"
    && !nonCommercial
    && (owned || publicDomain || /commercial/iu.test(bom.useScope));
  const attributionRequired = status === "licensed";
  return {
    status,
    commercialUse,
    attributionRequired,
    ...(attributionRequired && creator ? { attribution: creator.slice(0, 160) } : {}),
    ...(license ? { licenseName: license.slice(0, 160) } : {}),
  };
}

function uploadSource(request: StudioHybridDccBg3dPersistRequest) {
  const owned = Uint8Array.from(request.bytes);
  return {
    name: request.fileName,
    size: owned.byteLength,
    type: STUDIO_BG3D_GLB_MIME,
    async arrayBuffer(): Promise<ArrayBuffer> {
      return Uint8Array.from(owned).buffer;
    },
  };
}

async function persistAttachmentsWithModelLibrary(
  requests: readonly StudioHybridDccBg3dPersistRequest[],
  signal?: AbortSignal,
): Promise<readonly StudioHybridDccBg3dPersistedAttachment[]> {
  const records = await importVerifiedBg3dModelsAtomically(
    requests.map((request) => ({
      file: uploadSource(request),
      expectedSha256: request.expectedSha256,
      rights: request.rights,
    })),
    { signal },
  );
  const recordByHash = new Map(records.map((record) => [record.contentHash, record] as const));
  return requests.map((request) => {
    const record = recordByHash.get(request.expectedSha256);
    if (!record) {
      throw new StudioHybridDccBg3dHandoffError(
        "model-persistence-failed",
        `Verified model record missing for ${request.assetId}`,
      );
    }
    const attachment = attachStudioGeneric3dWorkflowMetadata(
      createStudioBg3dModelAttachment(record, {
        attachmentId: request.attachmentId,
        source: "local-library",
      }),
      { classification: "prop", sourceFormat: "glb" },
    );
    return { assetId: request.assetId, attachment };
  });
}

export const DEFAULT_STUDIO_HYBRID_DCC_BG3D_HANDOFF_PORTS: StudioHybridDccBg3dHandoffPorts =
  Object.freeze({
    glbExportExecutionBackend: "worker",
    persistAttachments: persistAttachmentsWithModelLibrary,
  });

function materializeProceduralBridgeObjects(
  workspace: StudioHybridDccWorkspace,
): {
  readonly nodes: readonly StudioBg3dPrimitiveNode[];
  readonly mappings: readonly StudioHybridDccBg3dProceduralMapping[];
} {
  const nodes: StudioBg3dPrimitiveNode[] = [];
  const mappings: StudioHybridDccBg3dProceduralMapping[] = [];
  for (const object of workspace.bridge.set.objects) {
    if (workspace.session.state.geometry.records[object.id]) continue;
    const roomMatch = /^room:([A-Za-z0-9._~-]{1,80}):(\d+)$/u.exec(object.geometryHash);
    if (!roomMatch) continue;
    const preset = getStudioBg3dRoomPreset(roomMatch[1]!);
    if (!preset) continue;
    const parts = buildStudioBg3dRoomParts(preset.spec);
    if (Number(roomMatch[2]) !== parts.length) continue;
    const sceneNodeIds: string[] = [];
    for (const [index, part] of parts.entries()) {
      const id = stableId(
        "dcc-procedural",
        `${workspace.session.state.documentId}:${object.id}:${object.geometryHash}:${index}`,
      );
      sceneNodeIds.push(id);
      nodes.push({
        id,
        name: safeSceneText(part.name, `Room part ${index + 1}`),
        kind: "primitive",
        primitiveKind: part.kind,
        color: part.color,
        transform: {
          position: [...part.position],
          rotation: [...part.rotation],
          scale: [...part.scale],
        },
        parentId: null,
        visible: object.visible,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
      });
    }
    mappings.push({
      sourceObjectId: object.id,
      sourceGeometryHash: object.geometryHash,
      sceneNodeIds: Object.freeze(sceneNodeIds),
    });
  }
  return {
    nodes: Object.freeze(nodes),
    mappings: Object.freeze(mappings),
  };
}

function collectLosses(
  workspace: StudioHybridDccWorkspace,
  exports: readonly {
    readonly assetId: string;
    readonly issues: readonly StudioHybridDccGlbIssue[];
  }[],
  mappedSourceObjectIds: ReadonlySet<string>,
): StudioHybridDccBg3dLossEntry[] {
  const losses: StudioHybridDccBg3dLossEntry[] = [];
  for (const exported of exports) {
    for (const issue of exported.issues) {
      losses.push({
        code: issue.severity === "loss"
          ? "glb-export-loss-retained-in-dcc"
          : "glb-export-warning",
        severity: "warning",
        assetId: exported.assetId,
        sourceIssueCode: issue.code,
        count: 1,
        resolution: "retained-in-authority",
        detail: issue.detail,
      });
    }
  }
  for (const object of workspace.bridge.set.objects) {
    if (!mappedSourceObjectIds.has(object.id)) {
      losses.push({
        code: "bridge-object-retained-in-dcc",
        severity: "warning",
        assetId: object.id,
        count: 1,
        resolution: "retained-in-authority",
        detail: "렌더 가능한 Geometry Authority 또는 지원되는 절차형 bridge가 없어 DCC 원본에 보존했습니다.",
      });
      continue;
    }
    if (
      workspace.session.state.geometry.records[object.id] &&
      object.materialId !== "default"
    ) {
      losses.push({
        code: "base-material-retained-in-dcc",
        severity: "warning",
        assetId: object.id,
        count: 1,
        resolution: "retained-in-authority",
        detail: `기본 재질 '${safeSceneText(object.materialId, "unknown")}'은 DCC 원본에 보존되고 현재 GLB 파생물에는 베이크하지 않았습니다.`,
      });
    }
  }
  for (const shot of workspace.bridge.shots) {
    const transformCount = Object.keys(shot.overrides.transform ?? {}).length;
    if (transformCount > 0) {
      losses.push({
        code: "shot-transform-retained-in-dcc",
        severity: "warning",
        shotId: shot.id,
        count: transformCount,
        resolution: "retained-in-authority",
        detail: "컷별 변형은 DCC 원본에 보존되며 현재 BG3D 파생 장면에는 베이크하지 않습니다.",
      });
    }
    const materialCount = Object.keys(shot.overrides.material ?? {}).length;
    if (materialCount > 0) {
      losses.push({
        code: "shot-material-retained-in-dcc",
        severity: "warning",
        shotId: shot.id,
        count: materialCount,
        resolution: "retained-in-authority",
        detail: "컷별 재질은 DCC 원본에 보존되며 BG3D Shot 스키마 확장 전까지 전송하지 않습니다.",
      });
    }
    const poseCount = Object.keys(shot.overrides.characterPose ?? {}).length;
    if (poseCount > 0) {
      losses.push({
        code: "shot-character-pose-retained-in-dcc",
        severity: "warning",
        shotId: shot.id,
        count: poseCount,
        resolution: "retained-in-authority",
        detail: "캐릭터 포즈 override는 DCC 원본에 보존됩니다.",
      });
    }
  }
  const inkCount = workspace.bridge.artistCorrections.deltas.length;
  if (inkCount > 0) {
    losses.push({
      code: "artist-ink-retained-in-dcc",
      severity: "info",
      count: inkCount,
      resolution: "retained-in-authority",
      detail: "작가 선 보정 delta는 DCC linked-ink 원본에 보존되고 GLB 렌더 파생물에는 포함되지 않습니다.",
    });
  }
  return losses;
}

function captureBridgeShots(
  baseScene: StudioBg3dSceneDocument,
  workspace: StudioHybridDccWorkspace,
  nodeIdsBySourceObjectId: ReadonlyMap<string, readonly string[]>,
): { readonly scene: StudioBg3dSceneDocument; readonly mappings: StudioHybridDccBg3dShotMapping[] } {
  let scene = baseScene;
  const mappings: StudioHybridDccBg3dShotMapping[] = [];
  const sourceObjectIdByNodeId = new Map<string, string>();
  for (const [sourceObjectId, nodeIds] of nodeIdsBySourceObjectId) {
    for (const nodeId of nodeIds) sourceObjectIdByNodeId.set(nodeId, sourceObjectId);
  }
  for (const [index, shot] of workspace.bridge.shots.entries()) {
    const sceneShotId = stableId("dcc-shot", `${workspace.session.state.documentId}:${shot.id}`);
    const cameraOverride = shot.overrides.camera;
    const camera = cameraOverride
      ? {
          ...scene.camera,
          position: cameraOverride.position ?? scene.camera.position,
          target: cameraOverride.target ?? scene.camera.target,
          fovDegrees: cameraOverride.fov ?? scene.camera.fovDegrees,
        }
      : scene.camera;
    const visibility = shot.overrides.visibility ?? {};
    const nodes = scene.nodes.map((node) => {
      const sourceObjectId = sourceObjectIdByNodeId.get(node.id);
      const override = sourceObjectId ? visibility[sourceObjectId] : undefined;
      return override === undefined ? node : { ...node, visible: override };
    });
    const captured = captureStudioBg3dShot(
      { ...scene, camera, nodes },
      {
        id: sceneShotId,
        name: safeSceneText(shot.name, `Shot ${index + 1}`),
      },
    );
    if (!captured) {
      throw new StudioHybridDccBg3dHandoffError(
        "scene-canonicalization-failed",
        `Could not capture DCC shot ${shot.id}`,
      );
    }
    const { activeShotId: _discardedActiveShotId, ...capturedWithoutActiveShot } = captured;
    // A Shot captures temporary presentation overrides. Restore the base view so the handoff does
    // not silently turn the last Shot into the root scene.
    scene = {
      ...capturedWithoutActiveShot,
      camera: baseScene.camera,
      nodes: baseScene.nodes,
    };
    mappings.push({ sourceShotId: shot.id, sceneShotId });
  }
  return { scene, mappings };
}

/**
 * Preflights the complete canonical BG3D scene before committing every DCC derivative through one
 * all-or-nothing persistence batch. The scene is returned only after the durable receipts match.
 */
export async function handoffStudioHybridDccWorkspaceToBg3d(
  workspace: StudioHybridDccWorkspace,
  options: {
    readonly signal?: AbortSignal;
    readonly ports?: StudioHybridDccBg3dHandoffPorts;
  } = {},
): Promise<StudioHybridDccBg3dHandoffResult> {
  const ports = options.ports ?? DEFAULT_STUDIO_HYBRID_DCC_BG3D_HANDOFF_PORTS;
  const authorityRecords = Object.values(workspace.session.state.geometry.records)
    .sort((left, right) => compareCodeUnits(left.assetId, right.assetId));
  const procedural = materializeProceduralBridgeObjects(workspace);
  if (authorityRecords.length === 0 && procedural.nodes.length === 0) {
    throw new StudioHybridDccBg3dHandoffError(
      "empty-workspace",
      "3D 배경 편집기로 보낼 DCC 오브젝트가 없습니다.",
    );
  }
  if (authorityRecords.length > STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS) {
    throw new StudioHybridDccBg3dHandoffError(
      "asset-budget-exceeded",
      `DCC 오브젝트 ${authorityRecords.length}개가 배경 편집기 첨부 한도 `
      + `${STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS}개를 넘습니다. `
      + "불필요한 방 파츠·복제본을 줄인 뒤 다시 전달하세요.",
    );
  }
  if (workspace.bridge.shots.length > STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS) {
    throw new StudioHybridDccBg3dHandoffError(
      "asset-budget-exceeded",
      `DCC 컷 ${workspace.bridge.shots.length}개가 배경 편집기 컷 한도 `
      + `${STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS}개를 넘습니다.`,
    );
  }
  const records = await resolveStudioHybridDccDeliveryRecords(
    workspace,
    authorityRecords,
    options.signal,
  );

  const exported: Array<{
    readonly record: StudioHybridDccBg3dDeliveryRecord;
    readonly result: Extract<StudioHybridDccMeshGlbExportResult, { readonly ok: true }>;
    readonly expectedSha256: `sha256:${string}`;
  }> = [];
  let exportResults: readonly StudioHybridDccMeshGlbExportResult[];
  try {
    const exportOutcome = records.length > 0
      ? await exportStudioHybridDccGlbBatch(records.map((record) => ({
          assetId: record.assetId,
          mesh: record.mesh,
          sourceHash: record.meshHash,
          sourceRevision: record.revision,
        })), {
          signal: options.signal,
          executionBackend: ports.glbExportExecutionBackend,
        })
      : null;
    exportResults = exportOutcome?.results ?? [];
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new StudioHybridDccBg3dHandoffError("aborted", "DCC handoff was cancelled");
    }
    throw new StudioHybridDccBg3dHandoffError(
      "glb-export-failed",
      error instanceof Error ? error.message : "DCC GLB worker export failed",
    );
  }
  if (exportResults.length !== records.length) {
    throw new StudioHybridDccBg3dHandoffError(
      "glb-export-failed",
      "DCC GLB worker returned an incomplete export batch",
    );
  }
  let cumulativeExportBytes = 0;
  for (const [index, record] of records.entries()) {
    throwIfHandoffAborted(options.signal);
    const result = exportResults[index]!;
    if (!result.ok) {
      throw new StudioHybridDccBg3dHandoffError(
        "glb-export-failed",
        `${record.assetId}: ${result.report.issues.map((issue) => issue.detail).join("; ")}`,
      );
    }
    if (result.bytes.byteLength > STUDIO_BG3D_GLB_MAX_BYTES - cumulativeExportBytes) {
      throw new StudioHybridDccBg3dHandoffError(
        "export-byte-budget-exceeded",
        `DCC GLB derivatives exceed the ${STUDIO_BG3D_GLB_MAX_BYTES}-byte scene budget`,
      );
    }
    cumulativeExportBytes += result.bytes.byteLength;
    const expectedSha256 = await digestGlbBytes(result.bytes, options.signal);
    exported.push({ record, result, expectedSha256 });
  }

  const requests: StudioHybridDccBg3dPersistRequest[] = exported.map(({ record, result, expectedSha256 }) => ({
    assetId: record.assetId,
    fileName: canonicalHandoffGlbFileName(result.fileName),
    bytes: result.bytes,
    expectedSha256,
    attachmentId: stableId(
      "dcc-attachment",
      `${workspace.session.state.documentId}:${record.assetId}`,
    ),
    rights: rightsForRecord(workspace, record),
  }));

  const plannedAttachmentByAssetId = new Map(requests.map((request) => [
    request.assetId,
    plannedAttachment(request),
  ] as const));

  const nodeIdsBySourceObjectId = new Map<string, readonly string[]>();
  const attachments: StudioBg3dModelAttachment[] = [];
  const nodes: StudioBg3dSceneNode[] = [...procedural.nodes];
  const mappings: StudioHybridDccBg3dAssetMapping[] = [];
  for (const mapping of procedural.mappings) {
    nodeIdsBySourceObjectId.set(mapping.sourceObjectId, mapping.sceneNodeIds);
  }
  const layout = deriveStudioHybridDccAssetLayout(records.map((record) => ({
    assetId: record.assetId,
    meshHash: record.meshHash,
    mesh: record.mesh,
    transform: workspace.session.state.objectTransforms[record.assetId],
  })));
  if (layout.errors.length > 0 || layout.items.length !== records.length) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      `Could not derive canonical presentation layout: ${layout.errors.map(({ assetId, message }) => `${assetId}: ${message}`).join("; ")}`,
    );
  }
  const layoutByAssetId = new Map(layout.items.map((item) => [item.assetId, item] as const));
  for (const [index, { record, result, expectedSha256 }] of exported.entries()) {
    const attachment = plannedAttachmentByAssetId.get(record.assetId);
    if (!attachment || attachment.hash !== expectedSha256) {
      throw new StudioHybridDccBg3dHandoffError(
        "scene-canonicalization-failed",
        `Planned attachment mismatch for ${record.assetId}`,
      );
    }
    const sceneNodeId = stableId(
      "dcc-node",
      `${workspace.session.state.documentId}:${record.assetId}`,
    );
    nodeIdsBySourceObjectId.set(record.assetId, [sceneNodeId]);
    const sharedObject = workspace.bridge.set.objects.find(({ id }) => id === record.assetId);
    const layoutItem = layoutByAssetId.get(record.assetId);
    if (!layoutItem) {
      throw new StudioHybridDccBg3dHandoffError(
        "scene-canonicalization-failed",
        `Missing presentation layout for ${record.assetId}`,
      );
    }
    const transform = canonicalBg3dObjectTransform(layoutItem);
    attachments.push(attachment);
    nodes.push({
      id: sceneNodeId,
      name: safeSceneText(record.assetId, `DCC Asset ${index + 1}`),
      kind: "model",
      attachmentId: attachment.id,
      transform,
      parentId: null,
      visible: sharedObject?.visible !== false,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    });
    mappings.push({
      sourceAssetId: record.assetId,
      sourceRevision: record.revision,
      sourceAuthorityMeshHash: record.sourceAuthorityMeshHash,
      sourceMeshHash: record.meshHash,
      sourceGeometryKind: record.sourceGeometryKind,
      sceneNodeId,
      attachmentId: attachment.id,
      glbHash: expectedSha256,
      glbBytes: result.bytes.byteLength,
      triangles: result.metrics.triangles,
      vertices: result.metrics.vertices,
      exportIssueCount: result.report.issues.length,
    });
  }

  const defaultScene = createDefaultStudioBg3dSceneDocument();
  if (nodes.length > defaultScene.budgets.complexity.maxNodes) {
    throw new StudioHybridDccBg3dHandoffError(
      "asset-budget-exceeded",
      `DCC node count ${nodes.length} exceeds ${defaultScene.budgets.complexity.maxNodes}`,
    );
  }
  const sceneBounds = deriveHandoffSceneBounds(layout, procedural.nodes);
  const fittedCamera = sceneBounds
    ? fitStudioBg3dCameraToBounds({
        camera: defaultScene.camera,
        bounds: sceneBounds,
        viewportAspect: 16 / 9,
        padding: 1.22,
        maxDistance: 10_000,
      })
    : null;
  if (!fittedCamera) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      "Could not frame the complete DCC delivery inside the BG3D camera limits",
    );
  }
  const baseScene: StudioBg3dSceneDocument = {
    ...defaultScene,
    camera: fittedCamera,
    render: {
      ...defaultScene.render,
      toneMapping: "aces",
      exposure: 1.05,
    },
    attachments,
    nodes,
  };
  const captured = captureBridgeShots(baseScene, workspace, nodeIdsBySourceObjectId);
  const serialized = serializeStudioBg3dSceneDocument(captured.scene);
  const scene = serialized ? parseStudioBg3dSceneDocument(serialized) : null;
  if (!scene) {
    throw new StudioHybridDccBg3dHandoffError(
      "scene-canonicalization-failed",
      "DCC handoff did not produce a canonical BG3D scene document",
    );
  }

  const sourceWorkspaceHash = hashWorkspaceDeliverySource(workspace);
  const losses = Object.freeze(collectLosses(
    workspace,
    exported.map(({ record, result }) => ({
      assetId: record.assetId,
      issues: result.report.issues,
    })),
    new Set(nodeIdsBySourceObjectId.keys()),
  ));
  const retainedArtistCorrectionCount = workspace.bridge.artistCorrections.deltas.length;
  const successfulResult: StudioHybridDccBg3dHandoffResult = Object.freeze({
    scene,
    sourceDocumentId: workspace.session.state.documentId,
    sourceStateHash: workspace.session.state.stateHash,
    sourceCommandCount: workspace.session.state.commandCount,
    sourceBridgeSetHash: workspace.bridge.set.setHash,
    sourceBridgeCommandSequence: workspace.bridge.commandSequence,
    sourceWorkspaceHash,
    assets: Object.freeze(mappings),
    proceduralObjects: procedural.mappings,
    shots: Object.freeze(captured.mappings),
    losses,
    retainedArtistCorrectionCount,
    deliveryEvidence: Object.freeze({
      canonicalSceneVerified: true,
      modelPersistence: Object.freeze({
        status: requests.length > 0 ? "receipt-verified" : "not-required",
        persistedAttachmentCount: requests.length,
      }),
      // This handoff creates the canonical BG3D payload. The caller integrates it into the canvas
      // only after this function returns, so claiming document integration here would be false.
      canvasDocumentIntegrated: false,
      collaborationVerified: false,
      browserVerified: false,
      productionActivated: false,
    }),
  });

  // All fallible layout, Shot, camera, attachment, provenance, loss-report and result assembly runs
  // before the one durable transaction. After commit, only the adapter receipts are compared with
  // the already-canonical plan; there is no second source serialization that could orphan a GLB.
  throwIfHandoffAborted(options.signal);
  let persisted: readonly StudioHybridDccBg3dPersistedAttachment[];
  try {
    persisted = requests.length > 0
      ? await ports.persistAttachments(requests, options.signal)
      : [];
  } catch (error) {
    if (error instanceof StudioHybridDccBg3dHandoffError) throw error;
    throw new StudioHybridDccBg3dHandoffError(
      "model-persistence-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  throwIfHandoffAborted(options.signal);
  const persistedByAssetId = new Map(
    persisted.map(({ assetId, attachment }) => [assetId, attachment] as const),
  );
  if (persisted.length !== records.length || persistedByAssetId.size !== records.length) {
    throw new StudioHybridDccBg3dHandoffError(
      "attachment-mismatch",
      "Persisted attachment set does not match the DCC asset set",
    );
  }
  for (const [assetId, expected] of plannedAttachmentByAssetId) {
    const actual = persistedByAssetId.get(assetId);
    if (!actual || !attachmentsEquivalent(actual, expected)) {
      throw new StudioHybridDccBg3dHandoffError(
        "attachment-mismatch",
        `Persisted attachment metadata mismatch for ${assetId}`,
      );
    }
  }

  return successfulResult;
}
