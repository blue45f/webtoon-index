/**
 * Page-owned canonical link between a Scene/Shot revision, OPFS-CAS line pass, Canvas layers, and
 * real artist DrawEl corrections.  The page remains the relationship authority, the Scene remains
 * the 3D authority, and the CAS owns pass bytes; this sidecar stores references and provenance.
 */

import {
  STUDIO_BG3D_LT_LAYER_ROLES,
  type StudioBg3dLtLayerRole,
} from "./bg3d/studio-bg3d-lt-layer-plan";
import {
  applyStudioBg3dShot,
  captureStudioBg3dShot,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import {
  isStudioLinked3dPassRevisionForScene,
  parseStudioLinked3dPassLocator,
  validateStudioLinked3dPassRevisionDescriptor,
  type StudioLinked3dPassRevisionDescriptor,
} from "./studio-linked-3d-pass-transaction";
import { sha256HexPortable } from "./studio-sha256";
import {
  findStudioShared3dStageEntryByBundleId,
  migrateStudioShared3dStageCollectionDocument,
  type StudioShared3dStagePersistedState,
} from "./studio-shared-3d-stage-collection";
import { hashStudioShared3dStageBackground } from "./studio-shared-3d-stage-document";

export const STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND =
  "toonspectrum.studio-linked-3d-render" as const;
export const STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION = 2 as const;
export const STUDIO_LINKED_3D_RENDER_MAX_CORRECTIONS_PER_LINK = 512;
export const STUDIO_LINKED_3D_RENDER_MAX_BYTES = 192 * 1024;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_ENCODER = new TextEncoder();
const ROLE_SET = new Set<string>(STUDIO_BG3D_LT_LAYER_ROLES);

export interface StudioLinked3dRenderLayerReference {
  readonly elementId: string;
  readonly role: StudioBg3dLtLayerRole;
}

export type StudioLinked3dCorrectionConflictCode =
  | "source-provenance-changed"
  | "topology-changed"
  | "object-identities-changed"
  | "pass-revision-changed";

/** Immutable provenance captured on the real DrawEl at pointer-down. */
export interface StudioLinked3dCorrectionProvenance {
  readonly kind: "toonspectrum.linked-3d-correction";
  readonly version: 1;
  readonly bundleId: string;
  readonly pass: "line";
  readonly sourcePassRevision: number;
  readonly sourceHash: `sha256:${string}`;
  readonly baseGeometryHash: `sha256:${string}`;
  readonly topologyHash: `sha256:${string}`;
  readonly objectIdentityHash: `sha256:${string}`;
  readonly basePassRootHash: `sha256:${string}`;
}

export interface StudioLinked3dRenderCorrectionReference {
  readonly elementId: string;
  readonly sourcePassRevision: number;
  readonly appliedPassRevision: number | null;
  readonly status: "applied" | "conflict";
  readonly conflictCode: StudioLinked3dCorrectionConflictCode | null;
}

export interface StudioLinked3dRenderLink {
  readonly bundleId: string;
  readonly shotId: string;
  readonly sourceShotId: string | null;
  readonly stageSourceHash: `sha256:${string}`;
  readonly layers: readonly StudioLinked3dRenderLayerReference[];
  readonly passRevision: StudioLinked3dPassRevisionDescriptor;
  readonly corrections: readonly StudioLinked3dRenderCorrectionReference[];
}

export interface StudioLinked3dRenderDocument {
  readonly kind: typeof STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND;
  readonly version: typeof STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION;
  readonly authority: "studio-project-linked-3d-pass-index";
  readonly links: readonly StudioLinked3dRenderLink[];
}

export interface StudioLinked3dRenderElementLike {
  readonly id: string;
  readonly type: string;
  readonly src?: string;
  readonly groupId?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly flipped?: boolean;
  readonly flippedY?: boolean;
  readonly skewX?: number;
  readonly skewY?: number;
  readonly bg3dLtBundleId?: string;
  readonly bg3dLtRole?: StudioBg3dLtLayerRole;
  readonly bg3dScene?: StudioBg3dSceneDocument;
  readonly linked3dCorrection?: StudioLinked3dCorrectionProvenance;
}

export type StudioLinked3dRenderValidationFailureCode =
  | "invalid-document"
  | "missing-stage"
  | "stage-hash-mismatch"
  | "missing-layer"
  | "invalid-layer"
  | "missing-scene-anchor"
  | "ambiguous-scene-anchor"
  | "missing-shot"
  | "pass-integrity-mismatch"
  | "correction-integrity-mismatch";

export type StudioLinked3dRenderValidationResult =
  | { readonly ok: true; readonly document: StudioLinked3dRenderDocument }
  | {
      readonly ok: false;
      readonly code: StudioLinked3dRenderValidationFailureCode;
      readonly message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeId(value: unknown): string | null {
  return typeof value === "string"
    && SAFE_ID_PATTERN.test(value)
    && !FORBIDDEN_IDS.has(value.toLowerCase())
    ? value
    : null;
}

function safeHash(value: unknown): `sha256:${string}` | null {
  return typeof value === "string" && SHA256_PATTERN.test(value)
    ? value as `sha256:${string}`
    : null;
}

function safeRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function safeRole(value: unknown): StudioBg3dLtLayerRole | null {
  return typeof value === "string" && ROLE_SET.has(value)
    ? value as StudioBg3dLtLayerRole
    : null;
}

export function parseStudioLinked3dCorrectionProvenance(
  value: unknown,
): StudioLinked3dCorrectionProvenance | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "kind",
    "version",
    "bundleId",
    "pass",
    "sourcePassRevision",
    "sourceHash",
    "baseGeometryHash",
    "topologyHash",
    "objectIdentityHash",
    "basePassRootHash",
  ])) return null;
  const bundleId = safeId(value.bundleId);
  const sourcePassRevision = safeRevision(value.sourcePassRevision);
  const sourceHash = safeHash(value.sourceHash);
  const baseGeometryHash = safeHash(value.baseGeometryHash);
  const topologyHash = safeHash(value.topologyHash);
  const objectIdentityHash = safeHash(value.objectIdentityHash);
  const basePassRootHash = safeHash(value.basePassRootHash);
  if (
    value.kind !== "toonspectrum.linked-3d-correction"
    || value.version !== 1
    || value.pass !== "line"
    || !bundleId
    || !sourcePassRevision
    || !sourceHash
    || !baseGeometryHash
    || !topologyHash
    || !objectIdentityHash
    || !basePassRootHash
  ) return null;
  return Object.freeze({
    kind: "toonspectrum.linked-3d-correction",
    version: 1,
    bundleId,
    pass: "line",
    sourcePassRevision,
    sourceHash,
    baseGeometryHash,
    topologyHash,
    objectIdentityHash,
    basePassRootHash,
  });
}

function frozenLayer(value: unknown): StudioLinked3dRenderLayerReference | null {
  if (!isRecord(value) || !hasExactKeys(value, ["elementId", "role"])) return null;
  const elementId = safeId(value.elementId);
  const role = safeRole(value.role);
  return elementId && role ? Object.freeze({ elementId, role }) : null;
}

function frozenCorrection(value: unknown): StudioLinked3dRenderCorrectionReference | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "elementId",
    "sourcePassRevision",
    "appliedPassRevision",
    "status",
    "conflictCode",
  ])) return null;
  const elementId = safeId(value.elementId);
  const sourcePassRevision = safeRevision(value.sourcePassRevision);
  const appliedPassRevision = value.appliedPassRevision === null
    ? null
    : safeRevision(value.appliedPassRevision);
  const conflictCode = value.conflictCode === null
    ? null
    : value.conflictCode === "source-provenance-changed"
      || value.conflictCode === "topology-changed"
      || value.conflictCode === "object-identities-changed"
      || value.conflictCode === "pass-revision-changed"
      ? value.conflictCode
      : undefined;
  if (
    !elementId
    || !sourcePassRevision
    || (value.appliedPassRevision !== null && !appliedPassRevision)
    || (value.status !== "applied" && value.status !== "conflict")
    || conflictCode === undefined
    || (value.status === "applied" && (appliedPassRevision === null || conflictCode !== null))
    || (value.status === "conflict" && (appliedPassRevision !== null || conflictCode === null))
  ) return null;
  return Object.freeze({
    elementId,
    sourcePassRevision,
    appliedPassRevision,
    status: value.status,
    conflictCode,
  });
}

function frozenLink(value: unknown): StudioLinked3dRenderLink | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "bundleId",
    "shotId",
    "sourceShotId",
    "stageSourceHash",
    "layers",
    "passRevision",
    "corrections",
  ])) return null;
  const bundleId = safeId(value.bundleId);
  const shotId = safeId(value.shotId);
  const sourceShotId = value.sourceShotId === null ? null : safeId(value.sourceShotId);
  const stageSourceHash = safeHash(value.stageSourceHash);
  if (
    !bundleId
    || !shotId
    || (value.sourceShotId !== null && !sourceShotId)
    || !stageSourceHash
    || !Array.isArray(value.layers)
    || value.layers.length < 1
    || value.layers.length > STUDIO_BG3D_LT_LAYER_ROLES.length
    || !validateStudioLinked3dPassRevisionDescriptor(value.passRevision)
    || !Array.isArray(value.corrections)
    || value.corrections.length > STUDIO_LINKED_3D_RENDER_MAX_CORRECTIONS_PER_LINK
  ) return null;
  const rawPassRevision = value.passRevision;
  const passRevision = Object.freeze({
    ...rawPassRevision,
    objectStableIds: Object.freeze([...rawPassRevision.objectStableIds]),
    artifact: Object.freeze({ ...rawPassRevision.artifact }),
  });
  const layers = value.layers.map(frozenLayer);
  const corrections = value.corrections.map(frozenCorrection);
  if (layers.some((layer) => !layer) || corrections.some((correction) => !correction)) return null;
  const typedLayers = layers as StudioLinked3dRenderLayerReference[];
  const typedCorrections = corrections as StudioLinked3dRenderCorrectionReference[];
  if (
    new Set(typedLayers.map(({ elementId }) => elementId)).size !== typedLayers.length
    || new Set(typedLayers.map(({ role }) => role)).size !== typedLayers.length
    || !typedLayers.some(({ role }) => role === "main-line")
    || new Set(typedCorrections.map(({ elementId }) => elementId)).size !== typedCorrections.length
    || passRevision.sourceHash !== stageSourceHash
  ) return null;
  return Object.freeze({
    bundleId,
    shotId,
    sourceShotId,
    stageSourceHash,
    layers: Object.freeze(typedLayers),
    passRevision,
    corrections: Object.freeze(typedCorrections),
  });
}

export function parseStudioLinked3dRenderDocument(
  value: unknown,
): StudioLinked3dRenderDocument | null {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ["kind", "version", "authority", "links"])) {
      return null;
    }
    if (
      value.kind !== STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND
      || value.version !== STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION
      || value.authority !== "studio-project-linked-3d-pass-index"
      || !Array.isArray(value.links)
    ) return null;
    const links = value.links.map(frozenLink);
    if (links.some((link) => !link)) return null;
    const typedLinks = links as StudioLinked3dRenderLink[];
    if (new Set(typedLinks.map(({ bundleId }) => bundleId)).size !== typedLinks.length) return null;
    const document = Object.freeze({
      kind: STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND,
      version: STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION,
      authority: "studio-project-linked-3d-pass-index" as const,
      links: Object.freeze(typedLinks),
    });
    return TEXT_ENCODER.encode(JSON.stringify(document)).byteLength <= STUDIO_LINKED_3D_RENDER_MAX_BYTES
      ? document
      : null;
  } catch {
    return null;
  }
}

export function serializeStudioLinked3dRenderDocument(value: unknown): string | null {
  const document = parseStudioLinked3dRenderDocument(value);
  return document ? JSON.stringify(document) : null;
}

function failure(
  code: StudioLinked3dRenderValidationFailureCode,
  message: string,
): StudioLinked3dRenderValidationResult {
  return Object.freeze({ ok: false as const, code, message });
}

function geometrySignature(element: StudioLinked3dRenderElementLike): string | null {
  const values = [
    element.x,
    element.y,
    element.width,
    element.height,
    element.rotation ?? 0,
    element.skewX ?? 0,
    element.skewY ?? 0,
  ];
  return values.every((value) => typeof value === "number" && Number.isFinite(value))
    ? JSON.stringify([...values, element.flipped === true, element.flippedY === true])
    : null;
}

function correctionState(
  elementId: string,
  provenance: StudioLinked3dCorrectionProvenance,
  pass: StudioLinked3dPassRevisionDescriptor,
): StudioLinked3dRenderCorrectionReference {
  let conflictCode: StudioLinked3dCorrectionConflictCode | null = null;
  if (provenance.objectIdentityHash !== pass.objectIdentityHash) {
    conflictCode = "object-identities-changed";
  } else if (provenance.topologyHash !== pass.topologyHash) conflictCode = "topology-changed";
  else if (provenance.sourceHash !== pass.sourceHash) conflictCode = "source-provenance-changed";
  else if (
    provenance.sourcePassRevision !== pass.revision
    || provenance.basePassRootHash !== pass.passRootHash
  ) conflictCode = "pass-revision-changed";
  return conflictCode
    ? Object.freeze({
        elementId,
        sourcePassRevision: provenance.sourcePassRevision,
        appliedPassRevision: null,
        status: "conflict" as const,
        conflictCode,
      })
    : Object.freeze({
        elementId,
        sourcePassRevision: provenance.sourcePassRevision,
        appliedPassRevision: pass.revision,
        status: "applied" as const,
        conflictCode: null,
      });
}

function correctionReferencesFor(
  bundleId: string,
  pass: StudioLinked3dPassRevisionDescriptor,
  elements: readonly StudioLinked3dRenderElementLike[],
): readonly StudioLinked3dRenderCorrectionReference[] | null {
  const corrections: StudioLinked3dRenderCorrectionReference[] = [];
  for (const element of elements) {
    if (element.linked3dCorrection === undefined) continue;
    const provenance = parseStudioLinked3dCorrectionProvenance(element.linked3dCorrection);
    if (!provenance) return null;
    if (provenance.bundleId !== bundleId) continue;
    if (element.type !== "draw") return null;
    corrections.push(correctionState(element.id, provenance, pass));
  }
  corrections.sort((left, right) => left.elementId.localeCompare(right.elementId));
  return Object.freeze(corrections);
}

export function validateStudioLinked3dRenderDocumentAgainstPage(input: {
  readonly value: unknown;
  readonly elements: readonly StudioLinked3dRenderElementLike[];
  readonly shared3dStage: StudioShared3dStagePersistedState | undefined;
}): StudioLinked3dRenderValidationResult {
  const document = parseStudioLinked3dRenderDocument(input.value);
  if (!document) return failure("invalid-document", "연결된 3D 렌더 인덱스가 손상되었습니다.");
  const stageCollection = migrateStudioShared3dStageCollectionDocument(input.shared3dStage);
  if (!stageCollection) return failure("missing-stage", "연결된 공유 3D Stage를 찾지 못했습니다.");
  const elementsById = new Map(input.elements.map((element) => [element.id, element] as const));

  for (const link of document.links) {
    const stage = findStudioShared3dStageEntryByBundleId(stageCollection, link.bundleId);
    if (!stage) return failure("missing-stage", `3D 링크 ${link.bundleId}의 Stage가 없습니다.`);
    if (link.sourceShotId !== null && !stage.dccSource) {
      return failure("missing-stage", `DCC Shot ${link.sourceShotId}의 원본 Stage가 없습니다.`);
    }
    if (
      stage.background.sourceHash !== link.stageSourceHash
      || link.passRevision.sourceHash !== link.stageSourceHash
    ) return failure("stage-hash-mismatch", `3D 링크 ${link.bundleId}의 Stage 해시가 다릅니다.`);
    const completeBundle = input.elements.filter((element) => element.bg3dLtBundleId === link.bundleId);
    if (
      completeBundle.length !== link.layers.length
      || completeBundle.some((element) => element.type !== "image" || safeRole(element.bg3dLtRole) === null)
      || completeBundle.some((element, index) =>
        element.id !== link.layers[index]?.elementId || element.bg3dLtRole !== link.layers[index]?.role)
    ) return failure("invalid-layer", `3D 링크 ${link.bundleId}의 전체 레이어 집합이 다릅니다.`);
    const layerElements: StudioLinked3dRenderElementLike[] = [];
    for (const layer of link.layers) {
      const element = elementsById.get(layer.elementId);
      if (!element) return failure("missing-layer", `3D 링크 레이어 ${layer.elementId}가 없습니다.`);
      if (
        element.type !== "image"
        || element.bg3dLtBundleId !== link.bundleId
        || element.bg3dLtRole !== layer.role
      ) return failure("invalid-layer", `3D 링크 레이어 ${layer.elementId}의 역할이 다릅니다.`);
      if (
        layer.role === "main-line"
        && element.src !== link.passRevision.artifact.locator
      ) return failure("pass-integrity-mismatch", "canonical line pass locator가 Canvas 레이어와 다릅니다.");
      layerElements.push(element);
    }
    const groupIds = new Set(layerElements.map(({ groupId }) => groupId));
    const geometry = new Set(layerElements.map(geometrySignature));
    if (
      groupIds.size !== 1
      || groupIds.has(undefined)
      || geometry.size !== 1
      || geometry.has(null)
    ) return failure("invalid-layer", `3D 링크 ${link.bundleId}의 레이어 배치가 일치하지 않습니다.`);
    const anchors = layerElements.filter(({ bg3dScene }) => bg3dScene !== undefined);
    if (anchors.length < 1) return failure("missing-scene-anchor", "3D 장면 원본 앵커가 없습니다.");
    if (anchors.length > 1) return failure("ambiguous-scene-anchor", "3D 장면 원본 앵커가 중복되었습니다.");
    const scene = anchors[0]!.bg3dScene!;
    if (hashStudioShared3dStageBackground(scene) !== link.stageSourceHash) {
      return failure("stage-hash-mismatch", "Canvas 장면과 공유 Stage의 해시가 다릅니다.");
    }
    if (
      scene.activeShotId !== link.shotId
      || !scene.shots?.some(({ id }) => id === link.shotId)
      || ensureStudioLinked3dRenderShot(scene, { allowCreate: false }) !== scene
    ) {
      return failure("missing-shot", `연결된 Shot ${link.shotId}를 장면에서 찾지 못했습니다.`);
    }
    if (!isStudioLinked3dPassRevisionForScene(link.passRevision, scene)) {
      return failure(
        "pass-integrity-mismatch",
        `3D 링크 ${link.bundleId}의 pass revision이 canonical Scene과 다릅니다.`,
      );
    }
    const corrections = correctionReferencesFor(link.bundleId, link.passRevision, input.elements);
    if (!corrections || JSON.stringify(corrections) !== JSON.stringify(link.corrections)) {
      return failure(
        "correction-integrity-mismatch",
        `3D 링크 ${link.bundleId}의 artist correction provenance가 다릅니다.`,
      );
    }
  }
  return Object.freeze({ ok: true as const, document });
}

/**
 * Reverse-audit reserved Canvas state. A locator or correction provenance without the page-owned
 * sidecar would otherwise become a hidden second relationship authority.
 */
export function validateStudioLinked3dReservedPageState(input: {
  readonly value: unknown;
  readonly elements: readonly StudioLinked3dRenderElementLike[];
}): StudioLinked3dRenderValidationResult | { readonly ok: true; readonly document: undefined } {
  const document = input.value === undefined
    ? undefined
    : parseStudioLinked3dRenderDocument(input.value);
  if (input.value !== undefined && !document) {
    return failure("invalid-document", "연결된 3D 렌더 인덱스가 손상되었습니다.");
  }
  const locatorOwners = new Map<string, string>();
  const correctionOwners = new Map<string, string>();
  for (const link of document?.links ?? []) {
    const mainLine = link.layers.find(({ role }) => role === "main-line");
    if (mainLine) locatorOwners.set(mainLine.elementId, link.passRevision.artifact.locator);
    for (const correction of link.corrections) correctionOwners.set(correction.elementId, link.bundleId);
  }
  let visited = new WeakSet<object>();
  const findUnownedLocator = (
    value: unknown,
    path: string,
    allowedPath: string,
    allowedLocator: string | undefined,
  ): string | null => {
    if (typeof value === "string") {
      if (!value.startsWith("studio-opfs-cas:")) return null;
      return path === allowedPath
        && parseStudioLinked3dPassLocator(value) !== null
        && allowedLocator === value
        ? null
        : path;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const invalidPath = findUnownedLocator(
          value[index],
          `${path}/${index}`,
          allowedPath,
          allowedLocator,
        );
        if (invalidPath) return invalidPath;
      }
      return null;
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) continue;
      const invalidPath = findUnownedLocator(
        descriptor.value,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        allowedPath,
        allowedLocator,
      );
      if (invalidPath) return invalidPath;
    }
    return null;
  };
  for (let elementIndex = 0; elementIndex < input.elements.length; elementIndex += 1) {
    const element = input.elements[elementIndex]!;
    visited = new WeakSet<object>();
    const invalidLocatorPath = findUnownedLocator(
      element,
      `/elements/${elementIndex}`,
      `/elements/${elementIndex}/src`,
      locatorOwners.get(element.id),
    );
    if (invalidLocatorPath) {
      return failure(
        "pass-integrity-mismatch",
        `Canvas 요소 ${element.id}의 reserved 3D pass locator가 page receipt에 귀속되지 않았습니다.`,
      );
    }
    if (element.linked3dCorrection !== undefined) {
      const provenance = parseStudioLinked3dCorrectionProvenance(element.linked3dCorrection);
      if (
        !provenance
        || element.type !== "draw"
        || correctionOwners.get(element.id) !== provenance.bundleId
      ) {
        return failure(
          "correction-integrity-mismatch",
          `Canvas correction ${element.id}가 active 3D pass receipt에 귀속되지 않았습니다.`,
        );
      }
    }
  }
  return document
    ? Object.freeze({ ok: true as const, document })
    : Object.freeze({ ok: true as const, document: undefined });
}

function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(value))}`;
}

export function ensureStudioLinked3dRenderShot(
  scene: StudioBg3dSceneDocument,
  options: { readonly allowCreate: boolean },
): StudioBg3dSceneDocument | null {
  if (scene.activeShotId && scene.shots?.some(({ id }) => id === scene.activeShotId)) {
    const applied = applyStudioBg3dShot(scene, scene.activeShotId);
    const currentSerialized = serializeStudioBg3dSceneDocument(scene);
    const appliedSerialized = serializeStudioBg3dSceneDocument(applied);
    if (applied && currentSerialized && currentSerialized === appliedSerialized) return scene;
  }
  if (!options.allowCreate) return null;
  const serialized = serializeStudioBg3dSceneDocument(scene);
  if (!serialized) return null;
  const seed = sha256Text(serialized).slice(7, 31);
  for (let ordinal = 0; ordinal < 64; ordinal += 1) {
    const id = ordinal === 0 ? `canvas-${seed}` : `canvas-${seed}-${ordinal}`;
    if (scene.shots?.some((shot) => shot.id === id)) continue;
    const captured = captureStudioBg3dShot(scene, {
      id,
      name: ordinal === 0 ? "Canvas Linked Shot" : `Canvas Linked Shot ${ordinal + 1}`,
    });
    if (captured?.activeShotId === id) return captured;
  }
  return null;
}

export function materializeStudioLinked3dLinePassLocator<T extends StudioLinked3dRenderElementLike>(
  elements: readonly T[],
  bundleId: string,
  passRevision: StudioLinked3dPassRevisionDescriptor,
): T[] | null {
  if (!safeId(bundleId) || !validateStudioLinked3dPassRevisionDescriptor(passRevision)) return null;
  let matches = 0;
  const next = elements.map((element) => {
    if (
      element.type !== "image"
      || element.bg3dLtBundleId !== bundleId
      || element.bg3dLtRole !== "main-line"
    ) return element;
    matches += 1;
    return { ...element, src: passRevision.artifact.locator };
  });
  return matches === 1 ? next as T[] : null;
}

export function upsertStudioLinked3dRenderLink(input: {
  readonly value: unknown;
  readonly bundleId: string;
  readonly shotId: string;
  readonly sourceShotId?: string | null;
  readonly passRevision: StudioLinked3dPassRevisionDescriptor;
  readonly elements: readonly StudioLinked3dRenderElementLike[];
  readonly shared3dStage: StudioShared3dStagePersistedState;
}): StudioLinked3dRenderDocument | null {
  const current = input.value === undefined
    ? Object.freeze({
        kind: STUDIO_LINKED_3D_RENDER_DOCUMENT_KIND,
        version: STUDIO_LINKED_3D_RENDER_DOCUMENT_VERSION,
        authority: "studio-project-linked-3d-pass-index" as const,
        links: Object.freeze([]),
      })
    : parseStudioLinked3dRenderDocument(input.value);
  const bundleId = safeId(input.bundleId);
  const shotId = safeId(input.shotId);
  const requestedSourceShotId = input.sourceShotId === undefined || input.sourceShotId === null
    ? null
    : safeId(input.sourceShotId);
  const stage = findStudioShared3dStageEntryByBundleId(input.shared3dStage, bundleId);
  if (
    !current
    || !bundleId
    || !shotId
    || !validateStudioLinked3dPassRevisionDescriptor(input.passRevision)
    || input.passRevision.sourceHash !== stage?.background.sourceHash
    || (input.sourceShotId !== undefined && input.sourceShotId !== null && !requestedSourceShotId)
  ) return null;
  const layers = input.elements
    .filter((element) =>
      element.type === "image"
      && element.bg3dLtBundleId === bundleId
      && safeRole(element.bg3dLtRole) !== null)
    .map((element) => Object.freeze({ elementId: element.id, role: element.bg3dLtRole! }));
  if (layers.length < 1 || layers.length > STUDIO_BG3D_LT_LAYER_ROLES.length) return null;
  const previous = current.links.find((link) => link.bundleId === bundleId);
  const sourceShotId = input.sourceShotId === undefined
    ? previous?.shotId === shotId ? previous.sourceShotId : null
    : requestedSourceShotId;
  const corrections = correctionReferencesFor(bundleId, input.passRevision, input.elements);
  if (!corrections) return null;
  const nextLink = Object.freeze({
    bundleId,
    shotId,
    sourceShotId,
    stageSourceHash: stage!.background.sourceHash,
    layers: Object.freeze(layers),
    passRevision: input.passRevision,
    corrections,
  });
  const links = [...current.links.filter((link) => link.bundleId !== bundleId), nextLink]
    .toSorted((left, right) => left.bundleId.localeCompare(right.bundleId));
  const next = parseStudioLinked3dRenderDocument({ ...current, links });
  if (!next) return null;
  return validateStudioLinked3dRenderDocumentAgainstPage({
    value: next,
    elements: input.elements,
    shared3dStage: input.shared3dStage,
  }).ok ? next : null;
}

export function createStudioLinked3dCorrectionProvenance(
  value: unknown,
  selectedElementId: string | null | undefined,
): StudioLinked3dCorrectionProvenance | null {
  const document = parseStudioLinked3dRenderDocument(value);
  if (!document || !selectedElementId) return null;
  const link = document.links.find(({ layers }) =>
    layers.some(({ elementId }) => elementId === selectedElementId));
  if (!link) return null;
  const pass = link.passRevision;
  return Object.freeze({
    kind: "toonspectrum.linked-3d-correction",
    version: 1,
    bundleId: link.bundleId,
    pass: "line",
    sourcePassRevision: pass.revision,
    sourceHash: pass.sourceHash,
    baseGeometryHash: pass.baseGeometryHash,
    topologyHash: pass.topologyHash,
    objectIdentityHash: pass.objectIdentityHash,
    basePassRootHash: pass.passRootHash,
  });
}

export function removeStudioLinked3dRenderLinks(
  value: unknown,
  bundleIds: readonly string[],
): StudioLinked3dRenderDocument | undefined | null {
  if (value === undefined) return undefined;
  const document = parseStudioLinked3dRenderDocument(value);
  if (!document) return null;
  const removals = new Set(bundleIds);
  const links = document.links.filter(({ bundleId }) => !removals.has(bundleId));
  return links.length === 0 ? undefined : Object.freeze({ ...document, links: Object.freeze(links) });
}

/** Preserve visible strokes while explicitly removing their retired 3D reapplication authority. */
export function detachStudioLinked3dCorrections<T extends StudioLinked3dRenderElementLike>(
  elements: readonly T[],
  bundleIds: readonly string[],
): T[] | null {
  const removals = new Set(bundleIds);
  let changed = false;
  const next: T[] = [];
  for (const element of elements) {
    if (element.linked3dCorrection === undefined) {
      next.push(element);
      continue;
    }
    const provenance = parseStudioLinked3dCorrectionProvenance(element.linked3dCorrection);
    if (!provenance) return null;
    if (!removals.has(provenance.bundleId)) {
      next.push(element);
      continue;
    }
    const { linked3dCorrection: _retired, ...detached } = element;
    next.push(detached as T);
    changed = true;
  }
  return changed ? next : [...elements];
}

export function reconcileStudioLinked3dRenderDocumentAfterElementMutation(input: {
  readonly value: unknown;
  readonly elements: readonly StudioLinked3dRenderElementLike[];
  readonly shared3dStage: StudioShared3dStagePersistedState | undefined;
}): StudioLinked3dRenderDocument | undefined | null {
  if (input.value === undefined) return undefined;
  const document = parseStudioLinked3dRenderDocument(input.value);
  if (!document) return null;
  const elementsById = new Map(input.elements.map((element) => [element.id, element] as const));
  const links: StudioLinked3dRenderLink[] = [];
  for (const link of document.links) {
    const stage = findStudioShared3dStageEntryByBundleId(input.shared3dStage, link.bundleId);
    if (!stage || stage.background.sourceHash !== link.stageSourceHash) continue;
    const layers = link.layers.filter(({ elementId, role }) => {
      const element = elementsById.get(elementId);
      return element?.type === "image"
        && element.bg3dLtBundleId === link.bundleId
        && element.bg3dLtRole === role;
    });
    if (layers.length === 0 || !layers.some(({ role }) => role === "main-line")) continue;
    const corrections = correctionReferencesFor(link.bundleId, link.passRevision, input.elements);
    if (!corrections) return null;
    links.push(Object.freeze({ ...link, layers: Object.freeze(layers), corrections }));
  }
  if (links.length === 0) return undefined;
  const next = parseStudioLinked3dRenderDocument({ ...document, links });
  if (!next) return null;
  const validation = validateStudioLinked3dRenderDocumentAgainstPage({
    value: next,
    elements: input.elements,
    shared3dStage: input.shared3dStage,
  });
  return validation.ok ? validation.document : null;
}

export function studioLinked3dRenderElementIds(value: unknown): readonly string[] | null {
  const document = parseStudioLinked3dRenderDocument(value);
  return document
    ? Object.freeze(document.links.flatMap((link) => [
        ...link.layers.map(({ elementId }) => elementId),
        ...link.corrections.map(({ elementId }) => elementId),
      ]))
    : null;
}

export function remapStudioLinked3dRenderDocumentElementIds(
  value: unknown,
  elementIds: ReadonlyMap<string, string>,
): StudioLinked3dRenderDocument | null {
  const document = parseStudioLinked3dRenderDocument(value);
  if (!document) return null;
  return parseStudioLinked3dRenderDocument({
    ...document,
    links: document.links.map((link) => ({
      ...link,
      layers: link.layers.map((layer) => ({
        ...layer,
        elementId: elementIds.get(layer.elementId),
      })),
      corrections: link.corrections.map((correction) => ({
        ...correction,
        elementId: elementIds.get(correction.elementId),
      })),
    })),
  });
}
