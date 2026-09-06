/**
 * Durable product boundary for one canonical Canvas-linked 3D line pass.
 *
 * The renderer may use ArrayBuffer/Memory64 while encoding, but this boundary immediately copies
 * the finished PNG into the Studio OPFS SHA-256 CAS.  Project JSON retains only the strict
 * descriptor and `studio-opfs-cas:` locator; it never retains the data URL or worker memory.
 */

import {
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioBackground3DLtLayer } from "./scene-3d/studio-3d-insert-contract";
import type { StudioOpfsAssetStore } from "./studio-opfs-asset-store";

export const STUDIO_LINKED_3D_PASS_CAS_ROOT =
  "toonspectrum-studio-linked-3d-passes" as const;
export const STUDIO_LINKED_3D_PASS_LOCATOR_PREFIX = "studio-opfs-cas:sha256:" as const;
export const STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES = 64 * 1024 * 1024;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const LOCATOR_PATTERN = /^studio-opfs-cas:(sha256:[a-f0-9]{64})$/u;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_ENCODER = new TextEncoder();

export interface StudioLinked3dPassArtifactDescriptor {
  readonly pass: "line";
  readonly role: "main-line";
  readonly contentHash: `sha256:${string}`;
  readonly byteSize: number;
  readonly mime: "image/png";
  readonly width: number;
  readonly height: number;
  readonly locator: `studio-opfs-cas:sha256:${string}`;
}

export interface StudioLinked3dPassPngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly decodedRgbaBytes: number;
}

export interface StudioLinked3dPassRevisionDescriptor {
  readonly revision: number;
  readonly sourceHash: `sha256:${string}`;
  readonly sceneHash: `sha256:${string}`;
  readonly cameraHash: `sha256:${string}`;
  readonly baseGeometryHash: `sha256:${string}`;
  readonly topologyHash: `sha256:${string}`;
  readonly objectIdentityHash: `sha256:${string}`;
  readonly objectStableIds: readonly string[];
  readonly passRootHash: `sha256:${string}`;
  readonly artifact: StudioLinked3dPassArtifactDescriptor;
}

export interface StudioLinked3dPreparedPass {
  readonly descriptor: StudioLinked3dPassRevisionDescriptor;
  readonly originalDataUrl: string;
}

export interface StudioLinked3dPassCasAuthority {
  readonly kind: StudioOpfsAssetStore["kind"];
  put(bytes: Uint8Array, options?: { readonly mime?: string }): ReturnType<StudioOpfsAssetStore["put"]>;
  get(hash: string, options?: { readonly verify?: boolean }): ReturnType<StudioOpfsAssetStore["get"]>;
  ownerRefs(owner: string): ReturnType<StudioOpfsAssetStore["ownerRefs"]>;
  setOwnerRefs(owner: string, hashes: readonly string[]): ReturnType<StudioOpfsAssetStore["setOwnerRefs"]>;
  /** Product-only origin-wide owner RMW fence. Tests/non-OPFS adapters use the in-realm fallback. */
  runOwnerMutationExclusive?<T>(owner: string, task: () => Promise<T>): Promise<T>;
}

export class StudioLinked3dPassAuthorityError extends Error {
  public constructor(
    public readonly code:
      | "invalid-input"
      | "invalid-png"
      | "opfs-unavailable"
      | "integrity-mismatch"
      | "commit-rejected",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioLinked3dPassAuthorityError";
  }
}

function passError(
  code: StudioLinked3dPassAuthorityError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new StudioLinked3dPassAuthorityError(code, message, cause);
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function sha256Text(value: string): `sha256:${string}` {
  return sha256Bytes(TEXT_ENCODER.encode(value));
}

/** Bounded PNG IHDR inspection; it never decodes pixels or trusts caller dimensions. */
export function inspectStudioLinked3dPassPng(
  bytes: Uint8Array,
): StudioLinked3dPassPngHeader | null {
  if (
    bytes.byteLength < 33
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8, false) !== 13
    || bytes[12] !== 73
    || bytes[13] !== 72
    || bytes[14] !== 68
    || bytes[15] !== 82
  ) return null;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const allowedDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  const decodedRgbaBytes = width * height * 4;
  if (
    width < 1
    || height < 1
    || !Number.isSafeInteger(decodedRgbaBytes)
    || !allowedDepths[colorType]?.includes(bitDepth)
    || bytes[26] !== 0
    || bytes[27] !== 0
    || (bytes[28] !== 0 && bytes[28] !== 1)
  ) return null;
  return Object.freeze({ width, height, bitDepth, colorType, decodedRgbaBytes });
}

export function studioLinked3dPassLocator(
  hash: `sha256:${string}`,
): `studio-opfs-cas:sha256:${string}` {
  if (!SHA256_PATTERN.test(hash)) passError("invalid-input", "3D 패스 hash가 올바르지 않습니다.");
  return `${STUDIO_LINKED_3D_PASS_LOCATOR_PREFIX}${hash.slice("sha256:".length)}`;
}

export function parseStudioLinked3dPassLocator(value: unknown): `sha256:${string}` | null {
  if (typeof value !== "string") return null;
  const match = LOCATOR_PATTERN.exec(value);
  return match ? match[1] as `sha256:${string}` : null;
}

function finitePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export interface StudioLinked3dSceneRevisionSignatures {
  readonly sceneHash: `sha256:${string}`;
  readonly cameraHash: `sha256:${string}`;
  readonly baseGeometryHash: `sha256:${string}`;
  readonly topologyHash: `sha256:${string}`;
  readonly objectIdentityHash: `sha256:${string}`;
  readonly objectStableIds: readonly string[];
}

export function computeStudioLinked3dSceneRevisionSignatures(
  scene: StudioBg3dSceneDocument,
): StudioLinked3dSceneRevisionSignatures {
  const serialized = serializeStudioBg3dSceneDocument(scene);
  if (!serialized) passError("invalid-input", "canonical 3D Scene revision을 직렬화하지 못했습니다.");
  const attachmentHashById = new Map(scene.attachments.map((attachment) => [
    attachment.id,
    attachment.hash,
  ] as const));
  const objectStableIds = scene.nodes.map(({ id }) => `obj/${id}`).toSorted();
  const geometry = scene.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    transform: node.transform,
    visible: node.visible,
    parentId: node.parentId ?? null,
    ...(node.kind === "primitive"
      ? { primitiveKind: node.primitiveKind }
      : { attachmentId: node.attachmentId, attachmentHash: attachmentHashById.get(node.attachmentId) }),
  }));
  const topology = scene.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    parentId: node.parentId ?? null,
    ...(node.kind === "primitive"
      ? { primitiveKind: node.primitiveKind }
      : { attachmentId: node.attachmentId, attachmentHash: attachmentHashById.get(node.attachmentId) }),
  }));
  return Object.freeze({
    sceneHash: sha256Text(serialized),
    cameraHash: sha256Text(JSON.stringify(scene.camera)),
    baseGeometryHash: sha256Text(JSON.stringify(geometry)),
    topologyHash: sha256Text(JSON.stringify(topology)),
    objectIdentityHash: sha256Text(JSON.stringify(objectStableIds)),
    objectStableIds: Object.freeze(objectStableIds),
  });
}

export function computeStudioLinked3dPassRootHash(input: Omit<
  StudioLinked3dPassRevisionDescriptor,
  "passRootHash"
>): `sha256:${string}` {
  return sha256Text(JSON.stringify({
    version: 1,
    revision: input.revision,
    sourceHash: input.sourceHash,
    sceneHash: input.sceneHash,
    cameraHash: input.cameraHash,
    baseGeometryHash: input.baseGeometryHash,
    topologyHash: input.topologyHash,
    objectIdentityHash: input.objectIdentityHash,
    objectStableIds: input.objectStableIds,
    artifact: {
      pass: input.artifact.pass,
      role: input.artifact.role,
      contentHash: input.artifact.contentHash,
      byteSize: input.artifact.byteSize,
      mime: input.artifact.mime,
      width: input.artifact.width,
      height: input.artifact.height,
      locator: input.artifact.locator,
    },
  }));
}

export function validateStudioLinked3dPassRevisionDescriptor(
  value: unknown,
): value is StudioLinked3dPassRevisionDescriptor {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "revision",
    "sourceHash",
    "sceneHash",
    "cameraHash",
    "baseGeometryHash",
    "topologyHash",
    "objectIdentityHash",
    "objectStableIds",
    "passRootHash",
    "artifact",
  ])) return false;
  const descriptor = value as Partial<StudioLinked3dPassRevisionDescriptor>;
  const artifact = descriptor.artifact;
  if (
    !finitePositiveInteger(descriptor.revision)
    || !SHA256_PATTERN.test(descriptor.sourceHash ?? "")
    || !SHA256_PATTERN.test(descriptor.sceneHash ?? "")
    || !SHA256_PATTERN.test(descriptor.cameraHash ?? "")
    || !SHA256_PATTERN.test(descriptor.baseGeometryHash ?? "")
    || !SHA256_PATTERN.test(descriptor.topologyHash ?? "")
    || !SHA256_PATTERN.test(descriptor.objectIdentityHash ?? "")
    || !SHA256_PATTERN.test(descriptor.passRootHash ?? "")
    || !Array.isArray(descriptor.objectStableIds)
    || descriptor.objectStableIds.length > 512
    || descriptor.objectStableIds.some((id) =>
      typeof id !== "string" || !/^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u.test(id))
    || new Set(descriptor.objectStableIds).size !== descriptor.objectStableIds.length
    || !isPlainRecord(artifact)
    || !hasExactKeys(artifact, [
      "pass",
      "role",
      "contentHash",
      "byteSize",
      "mime",
      "width",
      "height",
      "locator",
    ])
    || artifact.pass !== "line"
    || artifact.role !== "main-line"
    || !SHA256_PATTERN.test(artifact.contentHash)
    || parseStudioLinked3dPassLocator(artifact.locator) !== artifact.contentHash
    || !finitePositiveInteger(artifact.byteSize)
    || artifact.byteSize > STUDIO_LINKED_3D_PASS_MAX_PNG_BYTES
    || artifact.mime !== "image/png"
    || !finitePositiveInteger(artifact.width)
    || !finitePositiveInteger(artifact.height)
  ) return false;
  const { passRootHash: _root, ...withoutRoot } = descriptor as StudioLinked3dPassRevisionDescriptor;
  return computeStudioLinked3dPassRootHash(withoutRoot) === descriptor.passRootHash;
}

export function isStudioLinked3dPassRevisionForScene(
  value: unknown,
  scene: StudioBg3dSceneDocument,
): value is StudioLinked3dPassRevisionDescriptor {
  if (!validateStudioLinked3dPassRevisionDescriptor(value)) return false;
  try {
    const signatures = computeStudioLinked3dSceneRevisionSignatures(scene);
    return value.sourceHash === signatures.sceneHash
      && value.sceneHash === signatures.sceneHash
      && value.cameraHash === signatures.cameraHash
      && value.baseGeometryHash === signatures.baseGeometryHash
      && value.topologyHash === signatures.topologyHash
      && value.objectIdentityHash === signatures.objectIdentityHash
      && JSON.stringify(value.objectStableIds) === JSON.stringify(signatures.objectStableIds);
  } catch {
    return false;
  }
}

export interface PrepareStudioLinked3dLinePassInput {
  readonly authority: StudioLinked3dPassCasAuthority;
  readonly sourceHash: `sha256:${string}`;
  readonly scene: StudioBg3dSceneDocument;
  readonly layers: readonly StudioBackground3DLtLayer[];
  readonly previous?: StudioLinked3dPassRevisionDescriptor | null;
}

export async function prepareStudioLinked3dLinePass(
  input: PrepareStudioLinked3dLinePassInput,
): Promise<StudioLinked3dPreparedPass> {
  const { prepareStudioLinked3dLinePassRuntime } = await import("./studio-linked-3d-pass-transaction-runtime"
  );
  return await prepareStudioLinked3dLinePassRuntime(input);
}

export async function sequenceStudioLinked3dPassOwnerMutation<T>(
  authority: StudioLinked3dPassCasAuthority,
  ownerId: string,
  task: () => Promise<T>,
): Promise<T> {
  const { sequenceStudioLinked3dPassOwnerMutationRuntime } = await import("./studio-linked-3d-pass-transaction-runtime"
  );
  return await sequenceStudioLinked3dPassOwnerMutationRuntime(authority, ownerId, task);
}

/**
 * Fences one document/history commit behind CAS retention. A rejected/throwing document mutation
 * restores the exact previous owner set; successfully retained hashes stay available to undo/redo.
 */
export interface CommitStudioLinked3dPreparedPassInput<T> {
  readonly authority: StudioLinked3dPassCasAuthority;
  readonly ownerId: string;
  readonly prepared: StudioLinked3dPreparedPass;
  readonly apply: (descriptor: StudioLinked3dPassRevisionDescriptor) => T | false;
}

export async function commitStudioLinked3dPreparedPass<T>(
  input: CommitStudioLinked3dPreparedPassInput<T>,
): Promise<T> {
  const { commitStudioLinked3dPreparedPassRuntime } = await import("./studio-linked-3d-pass-transaction-runtime"
  );
  return await commitStudioLinked3dPreparedPassRuntime(input);
}
