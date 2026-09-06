import { serializeStudioBg3dSceneDocument, type StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import { sha256HexPortable } from "./studio-sha256";
import {
  createStudioShared3dSceneSessionFromElements,
  type StudioShared3dElementSource,
} from "./studio-shared-3d-scene-bridge";

import type { StudioVrmSceneDocument } from "./vrm/studio-vrm-scene-document";

export const STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND =
  "toonspectrum.studio-shared-3d-stage" as const;
export const STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION = 1 as const;
export const STUDIO_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES = 8 * 1024;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const MODEL_RUNTIME_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}:sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PROVENANCE_TEXT_LENGTH = 160;
const TEXT_ENCODER = new TextEncoder();

export type StudioShared3dStageCapturePolicy =
  | "require-all-linked"
  | "background-only";

export interface StudioShared3dStageBackgroundLink {
  /** Stable LT bundle identity. The scene-owning raster may move when a layer is deleted. */
  readonly bundleId: string;
  /** SHA-256 of the complete canonical BG3D scene document. */
  readonly sourceHash: `sha256:${string}`;
}

export interface StudioShared3dStageCharacterLink {
  readonly elementId: string;
  /** Changes only when the linked model authority changes, not for pose or placement. */
  readonly modelRuntimeKey: string;
  /** SHA-256 of the complete canonical VRM scene document. */
  readonly sourceHash: `sha256:${string}`;
  /** This Stage changed a visible source layer to hidden during its capture transaction. */
  readonly hiddenByStage?: true;
}

/**
 * Small, reference-only provenance retained when a Hybrid DCC workspace creates the background.
 * Geometry, commands and GLB bytes stay in their existing authorities; this block never copies them.
 */
export interface StudioShared3dStageDccSource {
  readonly sourceDocumentId: string;
  readonly sourceStateHash: string;
  readonly sourceWorkspaceHash: `sha256:${string}`;
  readonly sourceBridgeSetHash: string;
  readonly sourceCommandCount: number;
  readonly sourceBridgeCommandSequence: number;
}

/**
 * Page-owned Shared Stage v1. The page is the ownership boundary, so links never duplicate pageId,
 * transforms, camera, lighting, pose, wardrobe, expressions or model bytes.
 */
export interface StudioShared3dStageDocument {
  readonly kind: typeof STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND;
  readonly version: typeof STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION;
  readonly authority: "page-background-with-linked-character-sources";
  readonly capturePolicy: StudioShared3dStageCapturePolicy;
  readonly background: StudioShared3dStageBackgroundLink;
  readonly characters: readonly StudioShared3dStageCharacterLink[];
  readonly dccSource?: StudioShared3dStageDccSource;
}

export interface StudioShared3dStageElementSource extends StudioShared3dElementSource {
  readonly bg3dScene?: StudioBg3dSceneDocument;
  readonly bg3dLtBundleId?: string;
  readonly vrmScene?: StudioVrmSceneDocument;
  readonly hidden?: boolean;
}

export interface StudioShared3dStageVisibilityRelease<
  T extends StudioShared3dStageElementSource,
> {
  readonly nextElements: readonly T[];
  readonly restoredElementIds: readonly string[];
}

export type StudioShared3dStageResolutionPhase =
  | "ambiguous-background"
  | "invalid"
  | "live-update"
  | "missing-background"
  | "partial"
  | "ready"
  | "stale-background"
  | "unlinked";

export interface StudioShared3dStageResolution {
  readonly phase: StudioShared3dStageResolutionPhase;
  readonly backgroundBundleId: string | null;
  readonly backgroundElementId: string | null;
  /** Exact and same-model live sources that are safe to show in this stage. */
  readonly linkedCharacterElementIds: readonly string[];
  readonly updatedCharacterElementIds: readonly string[];
  readonly missingCharacterElementIds: readonly string[];
  /** Same element ID now points to a different model authority. */
  readonly replacedCharacterElementIds: readonly string[];
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (
      point <= 0x1f
      || (point >= 0x7f && point <= 0x9f)
      || (point >= 0x202a && point <= 0x202e)
      || (point >= 0x2066 && point <= 0x2069)
    ) return true;
  }
  return false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeId(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || hasControlCharacter(value)
  ) return null;
  if (!SAFE_ID_PATTERN.test(value) || FORBIDDEN_IDS.has(value.toLowerCase())) return null;
  return value;
}

function safeHash(value: unknown): `sha256:${string}` | null {
  return typeof value === "string" && value.length === 71 && SHA256_PATTERN.test(value)
    ? value as `sha256:${string}`
    : null;
}

function safeModelRuntimeKey(value: unknown): string | null {
  return typeof value === "string"
    && value.length <= 200
    && MODEL_RUNTIME_KEY_PATTERN.test(value)
    ? value
    : null;
}

function safeProvenanceText(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_PROVENANCE_TEXT_LENGTH
    || hasControlCharacter(value)
    || hasUnpairedSurrogate(value)
  ) return null;
  return value;
}

function safeCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(value))}`;
}

export function hashStudioShared3dStageBackground(
  scene: StudioBg3dSceneDocument,
): `sha256:${string}` | null {
  const canonical = serializeStudioBg3dSceneDocument(scene);
  return canonical ? sha256Text(canonical) : null;
}

function parseBackgroundLink(value: unknown): StudioShared3dStageBackgroundLink | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["bundleId", "sourceHash"])) return null;
  const bundleId = safeId(value.bundleId);
  const sourceHash = safeHash(value.sourceHash);
  return bundleId && sourceHash ? Object.freeze({ bundleId, sourceHash }) : null;
}

function parseCharacterLink(value: unknown): StudioShared3dStageCharacterLink | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["elementId", "modelRuntimeKey", "sourceHash", "hiddenByStage"])
  ) return null;
  const elementId = safeId(value.elementId);
  const modelRuntimeKey = safeModelRuntimeKey(value.modelRuntimeKey);
  const sourceHash = safeHash(value.sourceHash);
  const hiddenByStage = value.hiddenByStage;
  if (!elementId || !modelRuntimeKey || !sourceHash) return null;
  if (hiddenByStage !== undefined && hiddenByStage !== true) return null;
  if (!modelRuntimeKey.startsWith(`${elementId}:`)) return null;
  return Object.freeze({
    elementId,
    modelRuntimeKey,
    sourceHash,
    ...(hiddenByStage === true ? { hiddenByStage: true as const } : {}),
  });
}

function parseDccSource(value: unknown): StudioShared3dStageDccSource | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "sourceDocumentId",
    "sourceStateHash",
    "sourceWorkspaceHash",
    "sourceBridgeSetHash",
    "sourceCommandCount",
    "sourceBridgeCommandSequence",
  ])) return null;
  const sourceDocumentId = safeProvenanceText(value.sourceDocumentId);
  const sourceStateHash = safeProvenanceText(value.sourceStateHash);
  const sourceWorkspaceHash = safeHash(value.sourceWorkspaceHash);
  const sourceBridgeSetHash = safeProvenanceText(value.sourceBridgeSetHash);
  const sourceCommandCount = safeCount(value.sourceCommandCount);
  const sourceBridgeCommandSequence = safeCount(value.sourceBridgeCommandSequence);
  if (
    !sourceDocumentId
    || !sourceStateHash
    || !sourceWorkspaceHash
    || !sourceBridgeSetHash
    || sourceCommandCount === null
    || sourceBridgeCommandSequence === null
  ) return null;
  return Object.freeze({
    sourceDocumentId,
    sourceStateHash,
    sourceWorkspaceHash,
    sourceBridgeSetHash,
    sourceCommandCount,
    sourceBridgeCommandSequence,
  });
}

export function parseStudioShared3dStageDocument(
  value: unknown,
): StudioShared3dStageDocument | null {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, [
      "kind",
      "version",
      "authority",
      "capturePolicy",
      "background",
      "characters",
      "dccSource",
    ])) return null;
    // Snapshot every accessor-backed field once. Validation must never read a stateful getter a
    // second time and then construct a document from a different value (TOCTOU).
    const kind = value.kind;
    const version = value.version;
    const authority = value.authority;
    const capturePolicy = value.capturePolicy;
    const rawBackground = value.background;
    const rawCharacters = value.characters;
    const rawDccSource = value.dccSource;
    if (
      kind !== STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND
      || version !== STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION
      || authority !== "page-background-with-linked-character-sources"
      || (capturePolicy !== "require-all-linked"
        && capturePolicy !== "background-only")
    ) return null;
    const background = parseBackgroundLink(rawBackground);
    if (!background || !Array.isArray(rawCharacters)) {
      return null;
    }
    const characterCount = rawCharacters.length;
    if (!Number.isSafeInteger(characterCount) || characterCount < 0 || characterCount > 12) {
      return null;
    }
    const characterCandidates: unknown[] = [];
    for (let index = 0; index < characterCount; index += 1) {
      characterCandidates.push(rawCharacters[index]);
    }
    if (rawCharacters.length !== characterCount) return null;
    const characters: StudioShared3dStageCharacterLink[] = [];
    const seen = new Set<string>();
    for (const candidate of characterCandidates) {
      const link = parseCharacterLink(candidate);
      if (!link || seen.has(link.elementId)) return null;
      seen.add(link.elementId);
      characters.push(link);
    }
    if (capturePolicy === "background-only" && characters.length > 0) return null;
    const dccSource = rawDccSource === undefined
      ? undefined
      : parseDccSource(rawDccSource);
    if (rawDccSource !== undefined && !dccSource) return null;
    const document: StudioShared3dStageDocument = Object.freeze({
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy,
      background,
      characters: Object.freeze(characters),
      ...(dccSource ? { dccSource } : {}),
    });
    return TEXT_ENCODER.encode(JSON.stringify(document)).byteLength
      <= STUDIO_SHARED_3D_STAGE_DOCUMENT_MAX_BYTES
      ? document
      : null;
  } catch {
    return null;
  }
}

export function serializeStudioShared3dStageDocument(value: unknown): string | null {
  const document = parseStudioShared3dStageDocument(value);
  return document ? JSON.stringify(document) : null;
}

function findBackgroundAnchors(
  elements: readonly StudioShared3dStageElementSource[],
  bundleId: string,
): StudioShared3dStageElementSource[] {
  return elements.filter((element) =>
    element.type === "image"
    && element.bg3dLtBundleId === bundleId
    && element.bg3dScene !== undefined);
}

/**
 * Resolves one page-local VRM authority without letting unrelated cast order, the 12-character
 * runtime budget, or a duplicate element ID choose a different source on our behalf.
 */
function exactCharacterSource(
  elements: readonly StudioShared3dStageElementSource[],
  elementId: string,
) {
  const matches = elements.filter((element) => element.id === elementId);
  if (matches.length !== 1) return null;
  const session = createStudioShared3dSceneSessionFromElements(matches);
  return session.characters.length === 1 && session.characters[0]?.elementId === elementId
    ? session.characters[0]
    : null;
}

export function resolveStudioShared3dStageBundleIdForElement(
  elements: readonly StudioShared3dStageElementSource[],
  elementId: string | undefined,
): string | null {
  if (!elementId) return null;
  const matches = elements.filter((element) => element.id === elementId);
  if (matches.length !== 1) return null;
  return safeId(matches[0]?.bg3dLtBundleId) ?? null;
}

export function createStudioShared3dStageDocument(input: {
  readonly backgroundBundleId: string;
  readonly elements: readonly StudioShared3dStageElementSource[];
  /** Omit for the legacy all-page cast. Pass a receipt-bound list for a saved composition. */
  readonly characterElementIds?: readonly string[];
  /** Exact sources changed from visible to hidden by the same capture transaction. */
  readonly hiddenByStageElementIds?: readonly string[];
  readonly capturePolicy?: StudioShared3dStageCapturePolicy;
  readonly dccSource?: StudioShared3dStageDccSource;
}): StudioShared3dStageDocument | null {
  const backgroundBundleId = safeId(input.backgroundBundleId);
  if (!backgroundBundleId) return null;
  const backgrounds = findBackgroundAnchors(input.elements, backgroundBundleId);
  const backgroundScene = backgrounds.length === 1 ? backgrounds[0]?.bg3dScene : undefined;
  const backgroundHash = backgroundScene
    ? hashStudioShared3dStageBackground(backgroundScene)
    : null;
  if (!backgroundHash) return null;

  const requestedIds = input.characterElementIds;
  if (
    requestedIds
    && (requestedIds.length > 12 || new Set(requestedIds).size !== requestedIds.length)
  ) return null;
  const selected = requestedIds === undefined
    ? createStudioShared3dSceneSessionFromElements(input.elements).characters
    : requestedIds.map((elementId) => exactCharacterSource(input.elements, elementId));
  if (selected.some((character) => !character)) return null;
  const hiddenByStageIds = input.hiddenByStageElementIds ?? [];
  if (
    hiddenByStageIds.length > 12
    || new Set(hiddenByStageIds).size !== hiddenByStageIds.length
    || hiddenByStageIds.some((elementId) => !safeId(elementId))
  ) return null;
  const selectedIds = new Set(selected.map((character) => character!.elementId));
  if (hiddenByStageIds.some((elementId) => !selectedIds.has(elementId))) return null;
  if (hiddenByStageIds.some((elementId) => {
    const matches = input.elements.filter((element) => element.id === elementId);
    return matches.length !== 1 || matches[0]?.hidden !== true;
  })) return null;
  const hiddenByStage = new Set(hiddenByStageIds);
  const capturePolicy = input.capturePolicy ?? "require-all-linked";
  const characters = capturePolicy === "background-only"
    ? []
    : selected.map((character) => ({
        elementId: character!.elementId,
        modelRuntimeKey: character!.modelRuntimeKey,
        sourceHash: character!.sourceHash,
        ...(hiddenByStage.has(character!.elementId) ? { hiddenByStage: true as const } : {}),
      }));
  if (capturePolicy === "background-only" && hiddenByStage.size > 0) return null;
  return parseStudioShared3dStageDocument({
    kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
    version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
    authority: "page-background-with-linked-character-sources",
    capturePolicy,
    background: { bundleId: backgroundBundleId, sourceHash: backgroundHash },
    characters,
    ...(input.dccSource ? { dccSource: input.dccSource } : {}),
  });
}

/**
 * Refreshes hashes only for the same linked authorities. A model replacement remains stale until
 * the creator explicitly re-links it; a missing source keeps its tombstone so undo can recover it.
 */
export function refreshStudioShared3dStageDocument(
  value: unknown,
  elements: readonly StudioShared3dStageElementSource[],
): StudioShared3dStageDocument | null {
  const document = parseStudioShared3dStageDocument(value);
  if (!document) return null;
  const backgrounds = findBackgroundAnchors(elements, document.background.bundleId);
  const backgroundHash = backgrounds.length === 1 && backgrounds[0]?.bg3dScene
    ? hashStudioShared3dStageBackground(backgrounds[0].bg3dScene)
    : null;
  return parseStudioShared3dStageDocument({
    ...document,
    background: {
      ...document.background,
      sourceHash: backgroundHash ?? document.background.sourceHash,
    },
    characters: document.characters.map((link) => {
      const character = exactCharacterSource(elements, link.elementId);
      return character?.modelRuntimeKey === link.modelRuntimeKey
        ? { ...link, sourceHash: character.sourceHash }
        : link;
    }),
  });
}

export function remapStudioShared3dStageDocumentElementIds(
  value: unknown,
  elementIdMap: ReadonlyMap<string, string>,
): StudioShared3dStageDocument | null {
  const document = parseStudioShared3dStageDocument(value);
  if (!document) return null;
  const characters: StudioShared3dStageCharacterLink[] = [];
  for (const character of document.characters) {
    const elementId = safeId(elementIdMap.get(character.elementId));
    if (!elementId) return null;
    const modelHash = character.modelRuntimeKey.slice(character.modelRuntimeKey.indexOf(":"));
    characters.push({
      ...character,
      elementId,
      modelRuntimeKey: `${elementId}${modelHash}`,
    });
  }
  return parseStudioShared3dStageDocument({ ...document, characters });
}

/**
 * Releases only source-layer visibility explicitly owned by this Stage. Missing, replaced or
 * duplicate authorities are left untouched; callers can still delete the raster without guessing.
 */
export function releaseStudioShared3dStageOwnedSourceVisibility<
  T extends StudioShared3dStageElementSource,
>(
  value: unknown,
  elements: readonly T[],
): StudioShared3dStageVisibilityRelease<T> {
  const document = parseStudioShared3dStageDocument(value);
  const ownedById = new Map(
    document?.characters
      .filter(({ hiddenByStage }) => hiddenByStage === true)
      .map(({ elementId, modelRuntimeKey }) => [elementId, modelRuntimeKey] as const) ?? [],
  );
  if (ownedById.size === 0) {
    return Object.freeze({
      nextElements: elements,
      restoredElementIds: Object.freeze([]),
    });
  }
  const counts = new Map<string, number>();
  for (const element of elements) {
    if (ownedById.has(element.id)) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
  }
  const restoredElementIds: string[] = [];
  const nextElements = elements.map((element) => {
    if (
      !ownedById.has(element.id)
      || counts.get(element.id) !== 1
      || element.type !== "image"
      || !element.vrmScene
      || element.hidden !== true
      || exactCharacterSource(elements, element.id)?.modelRuntimeKey !== ownedById.get(element.id)
    ) return element;
    restoredElementIds.push(element.id);
    return { ...element, hidden: false };
  });
  return Object.freeze({
    nextElements: restoredElementIds.length > 0 ? Object.freeze(nextElements) : elements,
    restoredElementIds: Object.freeze(restoredElementIds),
  });
}

function emptyResolution(
  phase: StudioShared3dStageResolutionPhase,
  message: string,
  backgroundBundleId: string | null = null,
  backgroundElementId: string | null = null,
): StudioShared3dStageResolution {
  return Object.freeze({
    phase,
    backgroundBundleId,
    backgroundElementId,
    linkedCharacterElementIds: Object.freeze([]),
    updatedCharacterElementIds: Object.freeze([]),
    missingCharacterElementIds: Object.freeze([]),
    replacedCharacterElementIds: Object.freeze([]),
    message,
  });
}

export function resolveStudioShared3dStageDocument(
  value: unknown,
  elements: readonly StudioShared3dStageElementSource[],
): StudioShared3dStageResolution {
  if (value === undefined || value === null) {
    return emptyResolution("unlinked", "아직 이 배경과 캐릭터 원본이 연결되지 않았어요.");
  }
  const document = parseStudioShared3dStageDocument(value);
  if (!document) {
    return emptyResolution("invalid", "공유 3D 장면 연결 정보가 손상되어 자동 연결하지 않았어요.");
  }
  const backgrounds = findBackgroundAnchors(elements, document.background.bundleId);
  if (backgrounds.length === 0) {
    return emptyResolution(
      "missing-background",
      "연결된 3D 배경 원본을 찾지 못했어요.",
      document.background.bundleId,
    );
  }
  if (backgrounds.length !== 1) {
    return emptyResolution(
      "ambiguous-background",
      "3D 배경 원본이 둘 이상이라 안전하게 하나를 고르지 않았어요.",
      document.background.bundleId,
    );
  }
  const background = backgrounds[0]!;
  const currentBackgroundHash = background.bg3dScene
    ? hashStudioShared3dStageBackground(background.bg3dScene)
    : null;
  if (currentBackgroundHash !== document.background.sourceHash) {
    return emptyResolution(
      "stale-background",
      "3D 배경 원본이 연결 당시와 달라 현재 원본으로 다시 연결해야 해요.",
      document.background.bundleId,
      background.id,
    );
  }
  const linked: string[] = [];
  const updated: string[] = [];
  const missing: string[] = [];
  const replaced: string[] = [];
  for (const link of document.characters) {
    const character = exactCharacterSource(elements, link.elementId);
    if (!character) {
      missing.push(link.elementId);
    } else if (character.modelRuntimeKey !== link.modelRuntimeKey) {
      replaced.push(link.elementId);
    } else {
      linked.push(link.elementId);
      if (character.sourceHash !== link.sourceHash) updated.push(link.elementId);
    }
  }
  const partial = missing.length > 0 || replaced.length > 0;
  const phase = partial ? "partial" : updated.length > 0 ? "live-update" : "ready";
  return Object.freeze({
    phase,
    backgroundBundleId: document.background.bundleId,
    backgroundElementId: background.id,
    linkedCharacterElementIds: Object.freeze(linked),
    updatedCharacterElementIds: Object.freeze(updated),
    missingCharacterElementIds: Object.freeze(missing),
    replacedCharacterElementIds: Object.freeze(replaced),
    message: partial
      ? `공유 캐릭터 ${linked.length}/${document.characters.length}명만 안전하게 연결했어요.`
      : updated.length > 0
        ? `공유 3D 장면 · 캐릭터 ${updated.length}명의 원본 변경을 감지했어요.`
        : document.characters.length === 0
          ? "공유 3D 장면 · 배경만 연결됨"
          : `공유 3D 장면 · 배경 1개 · 캐릭터 ${linked.length}명 연결됨`,
  });
}
