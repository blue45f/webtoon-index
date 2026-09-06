import { z } from "zod";

import { deriveStudioBg3dGlbBudgetProfiles } from "./bg3d/studio-bg3d-device-quality";
import { validateStudioBg3dGlbOffMainThread } from "./bg3d/studio-bg3d-glb-validation-worker-client";
import { STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS } from "./bg3d/studio-bg3d-meshopt";
import {
  STUDIO_BG3D_GLB_MIME,
  STUDIO_BG3D_PRIMITIVE_KINDS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES,
  migrateStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dModelAttachment,
} from "./bg3d/studio-bg3d-scene-document";
import {
  assertStudioLinked3dPassProjectArchiveEvidence,
  StudioLinked3dPassProjectArchiveError,
} from "./studio-linked-3d-pass-project-archive";
import {
  buildStudioPackageArchiveBlob,
  StudioPackageArchiveError,
  type StudioPackageArchiveProgress,
  type StudioPackageArchiveSource,
} from "./studio-package-archive";
import { parseStudioProjectFile, type StudioProjectFile } from "./studio-project-file";
import { parseStudioReferenceBoardDocument } from "./studio-reference-board";
import {
  STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
  migrateStudioShared3dStageCollectionDocument,
} from "./studio-shared-3d-stage-collection";
import { STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND } from "./studio-shared-3d-stage-document";
import {
  STUDIO_VRM_SCENE_DOCUMENT_KIND,
  STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES,
  migrateStudioVrmSceneDocument,
  parseStudioVrmLegacyFragment,
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
  type StudioVrmSurfacePaintTexture,
} from "./vrm/studio-vrm-scene-document";
import {
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
  verifyStudioVrmTexturePaintArtifact,
} from "./vrm/studio-vrm-texture-paint-artifact";
import { SAMPLE_VRMS } from "./vrm/vrm-library";

import type {
  StudioBg3dGlbBudgetProfiles,
  StudioBg3dGlbValidationSuccess,
} from "./bg3d/studio-bg3d-glb-validation";
import type { StudioCrc32ExecutionMode } from "./studio-crc32-worker-client";

/**
 * Self-contained ToonSpectrum project archive.
 *
 * Privacy and integrity boundary:
 * - project input always passes through studio-project-file, which redacts raw AI prompts;
 * - credential-shaped fields are removed before canonical project.json is produced;
 * - embedded raster data URLs and caller-provided binary assets are content-addressed and deduped;
 * - import accepts only the deterministic UTF-8 ZIP32/store subset emitted by our archive writer;
 * - every document and attachment byte is CRC-32, SHA-256, size, MIME-signature, and reference checked.
 */

export const STUDIO_PROJECT_ARCHIVE_SCHEMA = "toonspectrum.studio-project-archive" as const;
/** Current writer version. Import remains compatible with the original version-1 manifest. */
export const STUDIO_PROJECT_ARCHIVE_VERSION = 2 as const;
export const STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX = "toonspectrum-asset://sha256/" as const;
export const STUDIO_PROJECT_ARCHIVE_MIME = "application/vnd.toonspectrum.project+zip" as const;

export const STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS = [
  "raster",
  "mask",
  "reference",
  "vrm",
  "glb",
  "gltf",
  "obj",
  "audio",
] as const;

export type StudioProjectArchiveAttachmentKind =
  (typeof STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS)[number];

export const STUDIO_PROJECT_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 280_000_000,
  maxAttachmentBytes: 96_000_000,
  maxTotalAttachmentBytes: 256_000_000,
  maxProjectBytes: 16_000_000,
  maxManifestBytes: 4_000_000,
  maxAttachments: 512,
  maxReferences: 8_000,
  maxPathBytes: 256,
  maxDepth: 120,
  maxJsonNodes: 500_000,
});

export interface StudioProjectArchiveLimits {
  maxArchiveBytes: number;
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
  maxProjectBytes: number;
  maxManifestBytes: number;
  maxAttachments: number;
  maxReferences: number;
  maxPathBytes: number;
  maxDepth: number;
  maxJsonNodes: number;
}

export type StudioProjectArchiveDiagnosticSeverity = "warning" | "error";

export type StudioProjectArchiveDiagnosticCode =
  | "ARCHIVE_INVALID"
  | "ARCHIVE_SIZE_LIMIT"
  | "ATTACHMENT_COUNT_LIMIT"
  | "ATTACHMENT_MISSING"
  | "ATTACHMENT_ORPHANED"
  | "ATTACHMENT_SIZE_LIMIT"
  | "CANONICAL_JSON_REQUIRED"
  | "CRC_MISMATCH"
  | "DOCUMENT_REFERENCE_CONFLICT"
  | "DOCUMENT_REFERENCE_MISSING"
  | "DOCUMENT_REFERENCE_MISMATCH"
  | "DUPLICATE_PATH"
  | "EXTERNAL_ATTACHMENT_DEPENDENCY"
  | "EXTERNAL_PROJECT_DEPENDENCY"
  | "HASH_MISMATCH"
  | "MANIFEST_INVALID"
  | "MIME_MISMATCH"
  | "MIME_SIGNATURE_MISMATCH"
  | "PATH_INVALID"
  | "PRIVACY_FIELD_REMOVED"
  | "PROJECT_INVALID"
  | "PROJECT_MISSING"
  | "PROJECT_SIZE_LIMIT"
  | "REFERENCE_LIMIT"
  | "UNEXPECTED_ENTRY"
  | "UNSUPPORTED_EMBEDDED_DATA"
  | "ZIP_BOMB"
  | "ZIP_COMPRESSION_UNSUPPORTED"
  | "ZIP_ENTRY_COUNT_LIMIT";

export interface StudioProjectArchiveDiagnostic {
  severity: StudioProjectArchiveDiagnosticSeverity;
  code: StudioProjectArchiveDiagnosticCode;
  message: string;
  path?: string;
  pointer?: string;
}

export class StudioProjectArchiveError extends Error {
  readonly code: StudioProjectArchiveDiagnosticCode;
  readonly diagnostics: StudioProjectArchiveDiagnostic[];

  constructor(
    code: StudioProjectArchiveDiagnosticCode,
    message: string,
    details: Pick<StudioProjectArchiveDiagnostic, "path" | "pointer"> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioProjectArchiveError";
    this.code = code;
    this.diagnostics = [{ severity: "error", code, message, ...details }];
  }
}

export interface StudioProjectArchiveDocumentReference {
  /** RFC 6901 JSON Pointer into canonical project.json. The pointed value must already exist. */
  pointer: string;
  usage: StudioProjectArchiveAttachmentKind;
  /**
   * `asset-uri` replaces the pointed value with a content-addressed archive URI (legacy/default).
   * `sha256-prefixed` authenticates an existing `sha256:<hex>` value without rewriting it, which
   * keeps canonical scene-document hashes valid while still binding them to archive bytes.
   */
  mode?: "asset-uri" | "sha256-prefixed";
}

export interface StudioProjectArchiveAttachmentInput {
  kind: StudioProjectArchiveAttachmentKind;
  data: StudioPackageArchiveSource;
  /** Used only for type validation. Original names are intentionally not persisted. */
  mimeType?: string;
  /** Optional project locations rewritten to an asset URI or authenticated in-place by hash. */
  documentReferences?: readonly StudioProjectArchiveDocumentReference[];
}

export interface BuildStudioProjectArchiveInput {
  /** Current v2 or legacy input accepted by parseStudioProjectFile. */
  project: unknown;
  attachments?: readonly StudioProjectArchiveAttachmentInput[];
}

export interface StudioBg3dProjectArchiveAttachmentPlan {
  /** Raw lowercase digest used by the archive attachment map/path (without `sha256:`). */
  sha256: string;
  byteSize: number;
  mimeType: "model/gltf-binary";
  /** First canonical scene metadata record for UI/resolver context; storage ids are never present. */
  attachment: StudioBg3dModelAttachment;
  /** Strict intersection of every referencing scene and the product validator defaults. */
  validationBudgets: StudioBg3dGlbBudgetProfiles;
  documentReferences: StudioProjectArchiveDocumentReference[];
}

export interface StudioBg3dProjectArchivePlan {
  project: StudioProjectFile;
  attachments: StudioBg3dProjectArchiveAttachmentPlan[];
  totalAttachmentBytes: number;
  referenceCount: number;
}

export interface StudioProjectArchiveOptions {
  limits?: Partial<StudioProjectArchiveLimits>;
  onProgress?: (progress: StudioPackageArchiveProgress) => void;
  /** Fixed before ZIP construction. Browser product callers select `worker`. */
  crc32ExecutionMode?: StudioCrc32ExecutionMode;
}

export interface StudioProjectArchiveManifestProject {
  path: "project.json";
  mimeType: "application/json";
  byteSize: number;
  sha256: string;
}

export interface StudioProjectArchiveManifestAttachment {
  path: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  kinds: StudioProjectArchiveAttachmentKind[];
  documentReferences: StudioProjectArchiveDocumentReference[];
}

export interface StudioProjectArchiveManifest {
  schema: typeof STUDIO_PROJECT_ARCHIVE_SCHEMA;
  version: 1 | typeof STUDIO_PROJECT_ARCHIVE_VERSION;
  project: StudioProjectArchiveManifestProject;
  attachments: StudioProjectArchiveManifestAttachment[];
  totals: {
    entryCount: number;
    attachmentCount: number;
    attachmentBytes: number;
    contentBytes: number;
  };
}

export interface BuildStudioProjectArchiveResult {
  blob: Blob;
  manifest: StudioProjectArchiveManifest;
  /** Canonical project with data URLs replaced by content-addressed archive URIs. */
  canonicalProject: StudioProjectFile;
  canonicalProjectJson: string;
  /** False when project fields or model documents still depend on bytes outside this ZIP. */
  isSelfContained: boolean;
  diagnostics: StudioProjectArchiveDiagnostic[];
}

export interface StudioProjectArchiveImportedAttachment {
  metadata: StudioProjectArchiveManifestAttachment;
  blob: Blob;
}

export interface ImportStudioProjectArchiveOptions {
  limits?: Partial<StudioProjectArchiveLimits>;
  /**
   * Restore raster/mask/reference URI fields to data URLs for direct studio-project-file use.
   * Set false on memory-constrained mobile flows and resolve the returned Blob map lazily instead.
   */
  rehydrateDataUrls?: boolean;
}

export interface ImportStudioProjectArchiveResult {
  project: StudioProjectFile;
  canonicalProject: StudioProjectFile;
  manifest: StudioProjectArchiveManifest;
  attachments: ReadonlyMap<string, StudioProjectArchiveImportedAttachment>;
  isSelfContained: boolean;
  diagnostics: StudioProjectArchiveDiagnostic[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ASSET_URI_PATTERN = /^toonspectrum-asset:\/\/sha256\/([a-f0-9]{64})$/u;
const SAFE_ARCHIVE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_EOCD_BYTES = 22;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

const AttachmentKindSchema = z.enum(STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS);
const DocumentReferenceInputSchema = z
  .object({
    pointer: z.string().min(1).max(2_048),
    usage: AttachmentKindSchema,
    mode: z.enum(["asset-uri", "sha256-prefixed"]).optional(),
  })
  .strict();
const DocumentReferenceSchemaV1 = z
  .object({
    pointer: z.string().min(1).max(2_048),
    usage: AttachmentKindSchema,
  })
  .strict();
const DocumentReferenceSchemaV2 = z
  .object({
    pointer: z.string().min(1).max(2_048),
    usage: AttachmentKindSchema,
    mode: z.enum(["asset-uri", "sha256-prefixed"]),
  })
  .strict();
const ManifestProjectSchema = z
  .object({
    path: z.literal("project.json"),
    mimeType: z.literal("application/json"),
    byteSize: z.number().int().positive().max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxProjectBytes),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();
const ManifestTotalsSchema = z
  .object({
    entryCount: z.number().int().min(2).max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments + 2),
    attachmentCount: z.number().int().nonnegative().max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments),
    attachmentBytes: z.number().int().nonnegative().max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxTotalAttachmentBytes),
    contentBytes: z.number().int().positive().max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxArchiveBytes),
  })
  .strict();
const ManifestAttachmentBaseShape = {
  path: z.string().min(1).max(512),
  mimeType: z.string().regex(MIME_PATTERN).max(120),
  byteSize: z.number().int().positive().max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachmentBytes),
  sha256: z.string().regex(SHA256_PATTERN),
  kinds: z.array(AttachmentKindSchema).min(1).max(STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS.length),
} as const;
const ManifestAttachmentSchemaV1 = z
  .object({
    ...ManifestAttachmentBaseShape,
    documentReferences: z.array(DocumentReferenceSchemaV1).max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences),
  })
  .strict();
const ManifestAttachmentSchemaV2 = z
  .object({
    ...ManifestAttachmentBaseShape,
    documentReferences: z.array(DocumentReferenceSchemaV2).max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences),
  })
  .strict();
const ManifestSchemaV1 = z.object({
  schema: z.literal(STUDIO_PROJECT_ARCHIVE_SCHEMA),
  version: z.literal(1),
  project: ManifestProjectSchema,
  attachments: z.array(ManifestAttachmentSchemaV1).max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments),
  totals: ManifestTotalsSchema,
}).strict();
const ManifestSchemaV2 = z.object({
  schema: z.literal(STUDIO_PROJECT_ARCHIVE_SCHEMA),
  version: z.literal(STUDIO_PROJECT_ARCHIVE_VERSION),
  project: ManifestProjectSchema,
  attachments: z.array(ManifestAttachmentSchemaV2).max(STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments),
  totals: ManifestTotalsSchema,
}).strict();
const ManifestSchema = z.discriminatedUnion("version", [ManifestSchemaV1, ManifestSchemaV2]);

interface MutableAttachment {
  sha256: string;
  blob: Blob;
  byteSize: number;
  detectedMimeType: string;
  kinds: Set<StudioProjectArchiveAttachmentKind>;
  references: Map<string, StudioProjectArchiveDocumentReference>;
}

interface CanonicalizeContext {
  seen: WeakSet<object>;
  diagnostics: StudioProjectArchiveDiagnostic[];
  limits: StudioProjectArchiveLimits;
  nodes: number;
  minimumJsonBytes?: number;
}

interface BuildContext {
  limits: StudioProjectArchiveLimits;
  diagnostics: StudioProjectArchiveDiagnostic[];
  attachments: Map<string, MutableAttachment>;
  pointerOwners: Map<string, string>;
  pointerModes: Map<string, "asset-uri" | "sha256-prefixed">;
  attachmentCandidates: number;
  processedAttachmentBytes: number;
  references: number;
}

function documentReferenceMode(
  reference: StudioProjectArchiveDocumentReference
): "asset-uri" | "sha256-prefixed" {
  return reference.mode ?? "asset-uri";
}

function sha256Prefixed(sha256: string): string {
  return `sha256:${sha256}`;
}

function intersectBg3dGlbBudgets(
  left: StudioBg3dGlbBudgetProfiles,
  right: StudioBg3dGlbBudgetProfiles
): StudioBg3dGlbBudgetProfiles {
  const profile = (name: "mobile" | "desktop") => ({
    complexity: {
      maxModelBytes: Math.min(left[name].complexity.maxModelBytes, right[name].complexity.maxModelBytes),
      maxNodes: Math.min(left[name].complexity.maxNodes, right[name].complexity.maxNodes),
      maxTriangles: Math.min(left[name].complexity.maxTriangles, right[name].complexity.maxTriangles),
      maxDrawCalls: Math.min(left[name].complexity.maxDrawCalls, right[name].complexity.maxDrawCalls),
      maxMaterials: Math.min(left[name].complexity.maxMaterials, right[name].complexity.maxMaterials),
      maxLights: Math.min(left[name].complexity.maxLights, right[name].complexity.maxLights),
      maxAccessorElements: Math.min(
        left[name].complexity.maxAccessorElements,
        right[name].complexity.maxAccessorElements
      ),
      maxDecodedGeometryBytes: Math.min(
        left[name].complexity.maxDecodedGeometryBytes,
        right[name].complexity.maxDecodedGeometryBytes
      ),
      maxAnimations: Math.min(
        left[name].complexity.maxAnimations,
        right[name].complexity.maxAnimations
      ),
      maxAnimationChannels: Math.min(
        left[name].complexity.maxAnimationChannels,
        right[name].complexity.maxAnimationChannels
      ),
      maxAnimationKeyframes: Math.min(
        left[name].complexity.maxAnimationKeyframes,
        right[name].complexity.maxAnimationKeyframes
      ),
      maxAnimationValues: Math.min(
        left[name].complexity.maxAnimationValues,
        right[name].complexity.maxAnimationValues
      ),
      maxSkins: Math.min(left[name].complexity.maxSkins, right[name].complexity.maxSkins),
      maxJoints: Math.min(left[name].complexity.maxJoints, right[name].complexity.maxJoints),
      maxMorphTargets: Math.min(
        left[name].complexity.maxMorphTargets,
        right[name].complexity.maxMorphTargets
      ),
    },
    textures: {
      maxTextures: Math.min(left[name].textures.maxTextures, right[name].textures.maxTextures),
      maxTotalBytes: Math.min(left[name].textures.maxTotalBytes, right[name].textures.maxTotalBytes),
      maxDimension: Math.min(left[name].textures.maxDimension, right[name].textures.maxDimension),
    },
  });
  return { mobile: profile("mobile"), desktop: profile("desktop") };
}

/**
 * Collect every canonical BG3D model hash and its in-document integrity pointers before bytes are
 * resolved from IndexedDB/archive/bundled storage. Equal hashes dedupe across pages and master
 * elements; conflicting size, MIME, or rights declarations fail closed instead of picking one
 * silently. Optional archive limits let mobile callers preflight with the same budget as build.
 */
export function collectStudioBg3dProjectArchivePlan(
  rawProject: unknown,
  options: Pick<StudioProjectArchiveOptions, "limits"> = {}
): StudioBg3dProjectArchivePlan {
  const limits = resolveLimits(options.limits);
  const boundedProject = canonicalizeProjectValue(rawProject, "", 0, {
    seen: new WeakSet(),
    diagnostics: [],
    limits,
    nodes: 0,
  });
  let project: StudioProjectFile;
  try {
    project = parseStudioProjectFile(boundedProject);
  } catch {
    fail("PROJECT_INVALID", "3D 배경 archive 계획을 만들 수 없는 프로젝트입니다.");
  }
  const boundedParsedProject = canonicalizeProjectValue(project, "", 0, {
    seen: new WeakSet(),
    diagnostics: [],
    limits,
    nodes: 0,
  });
  if (
    textEncoder.encode(canonicalJson(boundedParsedProject)).byteLength
    > limits.maxProjectBytes
  ) {
    fail("PROJECT_SIZE_LIMIT", "3D 배경 archive 계획의 project.json 크기가 안전 한도를 넘었습니다.");
  }
  try {
    project = parseStudioProjectFile(boundedParsedProject);
  } catch {
    fail("PROJECT_INVALID", "3D 배경 archive 계획의 canonical 프로젝트를 만들 수 없습니다.");
  }
  const byHash = new Map<string, StudioBg3dProjectArchiveAttachmentPlan>();
  let totalAttachmentBytes = 0;
  let referenceCount = 0;

  const visitElements = (elements: readonly unknown[], basePointer: string): void => {
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex];
      if (!isRecord(element) || element.type !== "image" || element.bg3dScene === undefined) continue;
      const serialized = serializeStudioBg3dSceneDocument(element.bg3dScene);
      const scene = serialized ? parseStudioBg3dSceneDocument(serialized) : null;
      if (!scene) fail("PROJECT_INVALID", "프로젝트의 3D 배경 장면이 canonical 형식이 아닙니다.");
      const sceneValidationBudgets = deriveStudioBg3dGlbBudgetProfiles(scene);
      for (let attachmentIndex = 0; attachmentIndex < scene.attachments.length; attachmentIndex += 1) {
        const attachment = scene.attachments[attachmentIndex];
        const sha256 = attachment.hash.slice("sha256:".length);
        const reference: StudioProjectArchiveDocumentReference = {
          pointer: `${basePointer}/${elementIndex}/bg3dScene/attachments/${attachmentIndex}/hash`,
          usage: "glb",
          mode: "sha256-prefixed",
        };
        referenceCount += 1;
        if (referenceCount > limits.maxReferences) {
          fail("REFERENCE_LIMIT", "프로젝트의 3D 배경 모델 참조 수가 archive 안전 한도를 넘었습니다.");
        }
        const existing = byHash.get(sha256);
        if (existing) {
          const rightsMatch =
            existing.attachment.rights.status === attachment.rights.status
            && existing.attachment.rights.commercialUse === attachment.rights.commercialUse
            && existing.attachment.rights.attributionRequired === attachment.rights.attributionRequired
            && existing.attachment.rights.attribution === attachment.rights.attribution
            && existing.attachment.rights.licenseName === attachment.rights.licenseName;
          if (
            existing.byteSize !== attachment.byteSize
            || existing.mimeType !== attachment.mime
            || !rightsMatch
          ) {
            fail("DOCUMENT_REFERENCE_CONFLICT", "같은 3D 모델 해시에 서로 다른 크기, MIME 또는 이용 권리가 선언되었습니다.", {
              pointer: reference.pointer,
            });
          }
          existing.validationBudgets = intersectBg3dGlbBudgets(
            existing.validationBudgets,
            sceneValidationBudgets
          );
          existing.documentReferences.push(reference);
          continue;
        }
        if (byHash.size >= limits.maxAttachments) {
          fail("ATTACHMENT_COUNT_LIMIT", "프로젝트의 3D 배경 모델 수가 archive 안전 한도를 넘었습니다.");
        }
        if (attachment.byteSize > limits.maxAttachmentBytes) {
          fail("ATTACHMENT_SIZE_LIMIT", "3D 배경 모델 하나의 크기가 archive 안전 한도를 넘었습니다.", {
            pointer: reference.pointer,
          });
        }
        totalAttachmentBytes += attachment.byteSize;
        if (totalAttachmentBytes > limits.maxTotalAttachmentBytes) {
          fail("ATTACHMENT_SIZE_LIMIT", "프로젝트의 3D 배경 모델 합계가 archive 안전 한도를 넘었습니다.");
        }
        byHash.set(sha256, {
          sha256,
          byteSize: attachment.byteSize,
          mimeType: attachment.mime,
          attachment,
          validationBudgets: sceneValidationBudgets,
          documentReferences: [reference],
        });
      }
    }
  };

  project.pagesList.forEach((page, pageIndex) => {
    visitElements(page.elements, `/pagesList/${pageIndex}/elements`);
  });
  if (isRecord(project.master) && Array.isArray(project.master.elements)) {
    visitElements(project.master.elements, "/master/elements");
  }
  const attachments = [...byHash.values()]
    .map((item) => ({
      ...item,
      documentReferences: item.documentReferences.slice().sort(compareReferences),
    }))
    .sort((left, right) => compareText(left.sha256, right.sha256));
  return { project, attachments, totalAttachmentBytes, referenceCount };
}

interface ZipReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  slice(offset: number, length: number, mimeType: string): Blob;
}

interface ParsedZipEntry {
  path: string;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  dataOffset: number;
  localHeaderOffset: number;
}

function fail(
  code: StudioProjectArchiveDiagnosticCode,
  message: string,
  details: Pick<StudioProjectArchiveDiagnostic, "path" | "pointer"> = {}
): never {
  throw new StudioProjectArchiveError(code, message, details);
}

function warning(
  diagnostics: StudioProjectArchiveDiagnostic[],
  code: StudioProjectArchiveDiagnosticCode,
  message: string,
  details: Pick<StudioProjectArchiveDiagnostic, "path" | "pointer"> = {}
): void {
  if (!diagnostics.some((candidate) =>
    candidate.severity === "warning"
    && candidate.code === code
    && candidate.message === message
    && candidate.path === details.path
    && candidate.pointer === details.pointer
  )) {
    diagnostics.push({ severity: "warning", code, message, ...details });
  }
}

function diagnosticsAreSelfContained(diagnostics: readonly StudioProjectArchiveDiagnostic[]): boolean {
  return !diagnostics.some(({ code }) =>
    code === "EXTERNAL_ATTACHMENT_DEPENDENCY" || code === "EXTERNAL_PROJECT_DEPENDENCY"
  );
}

function rethrowPackageArchiveError(cause: unknown): never {
  if (cause instanceof StudioPackageArchiveError) {
    if (cause.code === "ENTRY_COUNT_LIMIT") {
      fail("ATTACHMENT_COUNT_LIMIT", "ZIP 파일 수가 프로젝트 archive 안전 한도를 넘었습니다.");
    }
    if (cause.code === "ENTRY_SIZE_LIMIT") {
      fail("ATTACHMENT_SIZE_LIMIT", "ZIP 항목 크기가 프로젝트 archive 안전 한도를 넘었습니다.", {
        path: cause.path,
      });
    }
    if (
      cause.code === "TOTAL_SIZE_LIMIT"
      || cause.code === "ARCHIVE_SIZE_LIMIT"
      || cause.code === "ZIP32_OVERFLOW"
    ) {
      fail("ARCHIVE_SIZE_LIMIT", "완성 프로젝트 archive 크기가 브라우저 안전 한도를 넘었습니다.");
    }
    if (cause.code === "PATH_INVALID" || cause.code === "PATH_DUPLICATE") {
      fail(cause.code === "PATH_DUPLICATE" ? "DUPLICATE_PATH" : "PATH_INVALID", cause.message, {
        path: cause.path,
      });
    }
  }
  fail("ARCHIVE_INVALID", "프로젝트 ZIP archive를 조립하지 못했습니다.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolvePositiveLimit(
  value: number | undefined,
  hardMaximum: number,
  label: string
): number {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardMaximum) {
    fail("ARCHIVE_INVALID", `${label} 한도가 올바르지 않습니다.`);
  }
  return value;
}

function resolveLimits(value: Partial<StudioProjectArchiveLimits> | undefined): StudioProjectArchiveLimits {
  return {
    maxArchiveBytes: resolvePositiveLimit(
      value?.maxArchiveBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxArchiveBytes,
      "archive"
    ),
    maxAttachmentBytes: resolvePositiveLimit(
      value?.maxAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachmentBytes,
      "attachment"
    ),
    maxTotalAttachmentBytes: resolvePositiveLimit(
      value?.maxTotalAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxTotalAttachmentBytes,
      "attachment 합계"
    ),
    maxProjectBytes: resolvePositiveLimit(
      value?.maxProjectBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxProjectBytes,
      "project.json"
    ),
    maxManifestBytes: resolvePositiveLimit(
      value?.maxManifestBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxManifestBytes,
      "manifest.json"
    ),
    maxAttachments: resolvePositiveLimit(
      value?.maxAttachments,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments,
      "attachment 수"
    ),
    maxReferences: resolvePositiveLimit(
      value?.maxReferences,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences,
      "문서 참조 수"
    ),
    maxPathBytes: resolvePositiveLimit(
      value?.maxPathBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxPathBytes,
      "경로"
    ),
    maxDepth: resolvePositiveLimit(
      value?.maxDepth,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxDepth,
      "JSON 깊이"
    ),
    maxJsonNodes: resolvePositiveLimit(
      value?.maxJsonNodes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxJsonNodes,
      "JSON 노드 수"
    ),
  };
}

/** JSON.parse output has no cycles; check it iteratively before any recursive canonical traversal. */
function assertDecodedProjectWithinLimits(
  value: unknown,
  limits: StudioProjectArchiveLimits
): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 1;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > limits.maxDepth) {
      fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 중첩 깊이가 안전 한도를 넘었습니다.");
    }
    const children = Array.isArray(current.value)
      ? current.value
      : isRecord(current.value)
        ? Object.values(current.value)
        : [];
    if (children.length > 0 && current.depth >= limits.maxDepth) {
      fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 중첩 깊이가 안전 한도를 넘었습니다.");
    }
    for (const child of children) {
      nodes += 1;
      if (nodes > limits.maxJsonNodes) {
        fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 노드 수가 안전 한도를 넘었습니다.");
      }
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function pointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function childPointer(parent: string, segment: string): string {
  return `${parent}/${pointerSegment(segment)}`;
}

function credentialShapedKey(key: string): boolean {
  const compact = key.replace(/[-_]/gu, "").toLowerCase();
  return compact === "apikey"
    || compact.endsWith("apikey")
    || compact === "authorization"
    || compact === "authorizationcode"
    || compact === "accesstoken"
    || compact === "refreshtoken"
    || compact === "authtoken"
    || compact === "sessiontoken"
    || compact === "idtoken"
    || compact === "bearertoken"
    || compact === "secret"
    || compact === "secretkey"
    || compact === "apisecret"
    || compact === "clientsecret"
    || compact === "webhooksecret"
    || compact === "signingsecret"
    || compact === "providerkey"
    || compact === "privatekey"
    || compact === "password"
    || compact === "rawprompt"
    || compact === "rawrevisedprompt"
    || compact === "prompttext"
    || compact === "revisedprompttext";
}

function addMinimumCanonicalJsonBytes(
  context: CanonicalizeContext,
  amount: number,
  pointer: string
): void {
  const current = context.minimumJsonBytes ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0 || current > context.limits.maxProjectBytes - amount) {
    fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 크기가 안전 한도를 넘었습니다.", { pointer });
  }
  context.minimumJsonBytes = current + amount;
}

function canonicalizeProjectValue(
  value: unknown,
  pointer: string,
  depth: number,
  context: CanonicalizeContext,
  inArray = false
): unknown {
  context.nodes += 1;
  if (context.nodes > context.limits.maxJsonNodes) {
    fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 노드 수가 안전 한도를 넘었습니다.", { pointer });
  }
  if (depth > context.limits.maxDepth) {
    fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 중첩 깊이가 안전 한도를 넘었습니다.", { pointer });
  }
  if (value === null) {
    addMinimumCanonicalJsonBytes(context, 4, pointer);
    return value;
  }
  if (typeof value === "string") {
    addMinimumCanonicalJsonBytes(context, value.length + 2, pointer);
    return value;
  }
  if (typeof value === "boolean") {
    addMinimumCanonicalJsonBytes(context, value ? 4 : 5, pointer);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("PROJECT_INVALID", "프로젝트에 유한하지 않은 숫자가 포함되어 있습니다.", { pointer });
    }
    addMinimumCanonicalJsonBytes(context, String(value).length, pointer);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return inArray ? null : undefined;
  }
  if (typeof value === "bigint" || !isPlainRecord(value) && !Array.isArray(value)) {
    fail("PROJECT_INVALID", "프로젝트에 JSON으로 저장할 수 없는 값이 포함되어 있습니다.", { pointer });
  }
  const object = value as object;
  if (context.seen.has(object)) {
    fail("PROJECT_INVALID", "프로젝트에 순환 참조가 포함되어 있습니다.", { pointer });
  }
  context.seen.add(object);
  try {
    if (Array.isArray(value)) {
      if (depth >= context.limits.maxDepth && value.length > 0) {
        fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 중첩 깊이가 안전 한도를 넘었습니다.", { pointer });
      }
      if (context.nodes > context.limits.maxJsonNodes - value.length) {
        fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 노드 수가 안전 한도를 넘었습니다.", { pointer });
      }
      addMinimumCanonicalJsonBytes(context, 2 + Math.max(0, value.length - 1), pointer);
      return value.map((item, index) =>
        canonicalizeProjectValue(item, childPointer(pointer, String(index)), depth + 1, context, true)
      );
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (depth >= context.limits.maxDepth && keys.length > 0) {
      fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 중첩 깊이가 안전 한도를 넘었습니다.", { pointer });
    }
    if (context.nodes > context.limits.maxJsonNodes - keys.length) {
      fail("PROJECT_SIZE_LIMIT", "프로젝트 JSON 노드 수가 안전 한도를 넘었습니다.", { pointer });
    }
    addMinimumCanonicalJsonBytes(context, 2 + Math.max(0, keys.length - 1), pointer);
    for (const key of keys) {
      const nextPointer = childPointer(pointer, key);
      if (credentialShapedKey(key)) {
        warning(
          context.diagnostics,
          "PRIVACY_FIELD_REMOVED",
          "프로젝트 archive에서 자격 증명 또는 비공개 AI 원문 필드를 제거했습니다.",
          { pointer: nextPointer }
        );
        continue;
      }
      addMinimumCanonicalJsonBytes(context, key.length + 3, nextPointer);
      const normalized = canonicalizeProjectValue(value[key], nextPointer, depth + 1, context);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    context.seen.delete(object);
  }
}

function canonicalJson(value: unknown): string {
  const serialize = (candidate: unknown): string => {
    if (candidate === null || typeof candidate === "number" || typeof candidate === "boolean") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "string") return JSON.stringify(candidate);
    if (Array.isArray(candidate)) return `[${candidate.map(serialize).join(",")}]`;
    if (!isRecord(candidate)) fail("CANONICAL_JSON_REQUIRED", "canonical JSON 값이 올바르지 않습니다.");
    return `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${serialize(candidate[key])}`).join(",")}}`;
  };
  return serialize(value);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    fail("ARCHIVE_INVALID", "이 브라우저에서는 SHA-256 무결성 검사를 사용할 수 없습니다.");
  }
  const digestInput = bytes.byteOffset === 0
    && bytes.buffer instanceof ArrayBuffer
    && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : (() => {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return copy.buffer;
      })();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().split(";", 1)[0] ?? "";
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function rasterMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (bytes.length >= 3 && hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function audioMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WAVE"
  ) return "audio/wav";
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "fLaC") return "audio/flac";
  if (bytes.length >= 3 && String.fromCharCode(...bytes.slice(0, 3)) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "audio/aac";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") return "audio/mp4";
  if (bytes.length >= 4 && hasBytes(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  return null;
}

function glbJson(bytes: Uint8Array): Record<string, unknown> | null {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(0, 4)) !== "glTF") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
  if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) return null;
  let offset = 12;
  let document: Record<string, unknown> | null = null;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const chunkView = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const chunkLength = chunkView.getUint32(0, true);
    const chunkType = chunkView.getUint32(4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkLength % 4 !== 0 || chunkEnd > bytes.length) return null;
    if (chunkIndex === 0) {
      if (chunkType !== 0x4e4f_534a) return null;
      try {
        const paddedJsonText = fatalTextDecoder.decode(bytes.subarray(chunkStart, chunkEnd));
        let jsonEnd = paddedJsonText.length;
        while (jsonEnd > 0) {
          const code = paddedJsonText.charCodeAt(jsonEnd - 1);
          if (code !== 0 && code !== 0x20) break;
          jsonEnd -= 1;
        }
        const jsonText = paddedJsonText.slice(0, jsonEnd);
        const parsed: unknown = JSON.parse(jsonText);
        if (!isRecord(parsed) || !isRecord(parsed.asset) || typeof parsed.asset.version !== "string"
          || !/^2(?:\.|$)/u.test(parsed.asset.version)) return null;
        document = parsed;
      } catch {
        return null;
      }
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  return offset === bytes.length && chunkIndex > 0 ? document : null;
}

function decodeUtf8(bytes: Uint8Array, code: StudioProjectArchiveDiagnosticCode, message: string): string {
  try {
    return fatalTextDecoder.decode(bytes);
  } catch {
    fail(code, message);
  }
}

function gltfJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fatalTextDecoder.decode(bytes));
    if (!isRecord(parsed) || !isRecord(parsed.asset)) return null;
    const version = parsed.asset.version;
    return typeof version === "string" && /^2(?:\.|$)/u.test(version) ? parsed : null;
  } catch {
    return null;
  }
}

function objTextValid(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = fatalTextDecoder.decode(bytes);
  } catch {
    return false;
  }
  if (text.includes("\0")) return false;
  return text.split(/\r?\n/gu).some((line) => /^(?:#|o\s|g\s|v\s|vt\s|vn\s|f\s|mtllib\s|usemtl\s)/u.test(line.trim()));
}

function validateDeclaredMime(declared: string, allowed: readonly string[]): void {
  if (!declared || declared === "application/octet-stream") return;
  if (!allowed.includes(declared)) {
    fail("MIME_MISMATCH", "attachment의 선언 MIME 형식과 실제 자산 종류가 다릅니다.");
  }
}

function inspectAttachmentBytes(
  bytes: Uint8Array,
  kind: StudioProjectArchiveAttachmentKind,
  declaredMimeType: string,
  diagnostics: StudioProjectArchiveDiagnostic[]
): string {
  if (kind === "raster" || kind === "mask" || kind === "reference") {
    const detected = rasterMimeType(bytes);
    if (!detected) fail("MIME_SIGNATURE_MISMATCH", "래스터 attachment의 파일 서명이 올바르지 않습니다.");
    validateDeclaredMime(declaredMimeType, [detected]);
    return detected;
  }
  if (kind === "vrm" || kind === "glb") {
    const document = glbJson(bytes);
    if (!document) {
      fail("MIME_SIGNATURE_MISMATCH", `${kind.toUpperCase()} attachment의 파일 서명이 올바르지 않습니다.`);
    }
    inspectGltfExternalDependencies(document, diagnostics);
    const canonical = kind === "vrm" ? "model/vrm" : "model/gltf-binary";
    validateDeclaredMime(declaredMimeType, [canonical, "model/gltf-binary", "model/vrm"]);
    return canonical;
  }
  if (kind === "gltf") {
    const document = gltfJson(bytes);
    if (!document) fail("MIME_SIGNATURE_MISMATCH", "glTF attachment의 JSON 구조가 올바르지 않습니다.");
    validateDeclaredMime(declaredMimeType, ["model/gltf+json", "application/json"]);
    inspectGltfExternalDependencies(document, diagnostics);
    return "model/gltf+json";
  }
  if (kind === "obj") {
    if (!objTextValid(bytes)) fail("MIME_SIGNATURE_MISMATCH", "OBJ attachment의 텍스트 구조가 올바르지 않습니다.");
    validateDeclaredMime(declaredMimeType, ["model/obj", "text/plain"]);
    const text = decodeUtf8(bytes, "MIME_SIGNATURE_MISMATCH", "OBJ attachment를 읽지 못했습니다.");
    if (/^\s*mtllib\s+\S+/mu.test(text)) {
      warning(
        diagnostics,
        "EXTERNAL_ATTACHMENT_DEPENDENCY",
        "OBJ가 archive에 포함되지 않은 재질 파일을 참조할 수 있습니다."
      );
    }
    return "model/obj";
  }
  const detected = audioMimeType(bytes);
  if (!detected) fail("MIME_SIGNATURE_MISMATCH", "audio attachment의 파일 서명이 올바르지 않습니다.");
  validateDeclaredMime(declaredMimeType, [detected]);
  return detected;
}

function isSelfContainedUri(value: string): boolean {
  return value.startsWith("data:") || ASSET_URI_PATTERN.test(value);
}

function inspectGltfExternalDependencies(
  document: Record<string, unknown>,
  diagnostics: StudioProjectArchiveDiagnostic[]
): void {
  for (const collectionName of ["buffers", "images"] as const) {
    const collection = document[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const candidate of collection) {
      // A nested data URI carries its own bytes. A toonspectrum-asset URI is not self-contained
      // until a future glTF resource manifest explicitly binds that hash to an archive attachment.
      if (!isRecord(candidate) || typeof candidate.uri !== "string" || candidate.uri.startsWith("data:")) continue;
      warning(
        diagnostics,
        "EXTERNAL_ATTACHMENT_DEPENDENCY",
        `glTF ${collectionName} 항목이 archive 외부 파일을 참조합니다.`
      );
    }
  }
}

function extensionFor(mimeType: string, kinds: ReadonlySet<StudioProjectArchiveAttachmentKind>): string {
  if (kinds.has("vrm")) return "vrm";
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
    "model/obj": "obj",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/mpeg": "mp3",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
  };
  const extension = extensions[mimeType];
  if (!extension) fail("MIME_MISMATCH", "지원하지 않는 attachment MIME 형식입니다.");
  return extension;
}

function canonicalAttachmentMime(attachment: MutableAttachment): string {
  if (attachment.kinds.has("vrm")) return "model/vrm";
  return attachment.detectedMimeType;
}

function attachmentPath(sha256: string, mimeType: string, kinds: ReadonlySet<StudioProjectArchiveAttachmentKind>): string {
  return `assets/sha256/${sha256}.${extensionFor(mimeType, kinds)}`;
}

function assetUri(sha256: string): string {
  return `${STUDIO_PROJECT_ARCHIVE_ASSET_URI_PREFIX}${sha256}`;
}

export function studioProjectArchiveAssetSha256(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ASSET_URI_PATTERN.exec(value)?.[1] ?? null;
}

/** Resolve a canonical project asset URI against an authenticated import result without a URL. */
export function resolveStudioProjectArchiveAttachment(
  attachments: ReadonlyMap<string, StudioProjectArchiveImportedAttachment>,
  value: unknown
): StudioProjectArchiveImportedAttachment | null {
  const sha256 = studioProjectArchiveAssetSha256(value);
  return sha256 ? attachments.get(sha256) ?? null : null;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    fail("MIME_SIGNATURE_MISMATCH", "래스터 data URL의 Base64 데이터가 올바르지 않습니다.");
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    fail("MIME_SIGNATURE_MISMATCH", "래스터 data URL을 해석하지 못했습니다.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return globalThis.btoa(chunks.join(""));
}

function parseRasterDataUrl(
  value: string,
  maxAttachmentBytes: number
): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(value);
  if (!match) return null;
  const mimeType = normalizeMimeType(match[1]);
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) return null;
  if (match[2].length > Math.ceil(maxAttachmentBytes / 3) * 4 + 4) {
    fail("ATTACHMENT_SIZE_LIMIT", "래스터 data URL이 개별 attachment 안전 한도를 넘었습니다.");
  }
  const bytes = decodeBase64(match[2]);
  const detected = rasterMimeType(bytes);
  if (detected !== mimeType) {
    fail("MIME_SIGNATURE_MISMATCH", "래스터 data URL의 MIME과 실제 파일 서명이 다릅니다.");
  }
  return { mimeType, bytes };
}

function referenceUsage(pointer: string): "raster" | "mask" | "reference" {
  const tail = pointer.split("/").at(-1)?.replace(/~1/gu, "/").replace(/~0/gu, "~").toLowerCase() ?? "";
  if (tail.includes("mask")) return "mask";
  if (tail.includes("reference") || tail.includes("thumbnail")) return "reference";
  return "raster";
}

function sourceToBlob(source: StudioPackageArchiveSource, mimeType: string): Blob {
  if (source instanceof Blob) return source.slice(0, source.size, mimeType || source.type);
  if (source instanceof Uint8Array) {
    const copy = source.slice();
    return new Blob([copy.buffer as ArrayBuffer], { type: mimeType });
  }
  if (source instanceof ArrayBuffer) {
    return new Blob([source.slice(0)], { type: mimeType });
  }
  fail("ARCHIVE_INVALID", "지원하지 않는 attachment 바이트 형식입니다.");
}

async function addAttachmentCandidate(
  context: BuildContext,
  input: StudioProjectArchiveAttachmentInput
): Promise<MutableAttachment> {
  context.attachmentCandidates += 1;
  if (context.attachmentCandidates > context.limits.maxAttachments) {
    fail("ATTACHMENT_COUNT_LIMIT", "프로젝트 attachment 수가 안전 한도를 넘었습니다.");
  }
  const declaredMime = normalizeMimeType(
    input.mimeType || (input.data instanceof Blob ? input.data.type : "")
  );
  const blob = sourceToBlob(input.data, declaredMime);
  if (blob.size <= 0 || blob.size > context.limits.maxAttachmentBytes) {
    fail("ATTACHMENT_SIZE_LIMIT", "개별 프로젝트 attachment 크기가 안전 한도를 넘었습니다.");
  }
  context.processedAttachmentBytes += blob.size;
  if (context.processedAttachmentBytes > context.limits.maxTotalAttachmentBytes) {
    fail("ATTACHMENT_SIZE_LIMIT", "프로젝트 attachment 입력 합계가 안전 한도를 넘었습니다.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== blob.size) {
    fail("ATTACHMENT_SIZE_LIMIT", "attachment가 보고한 크기와 실제 바이트 크기가 다릅니다.");
  }
  const detectedMimeType = inspectAttachmentBytes(bytes, input.kind, declaredMime, context.diagnostics);
  const sha256 = await sha256Bytes(bytes);
  const existing = context.attachments.get(sha256);
  if (existing) {
    if (rasterMimeType(bytes) === null && existing.detectedMimeType !== detectedMimeType
      && !(new Set([existing.detectedMimeType, detectedMimeType]).size === 2
        && [existing.detectedMimeType, detectedMimeType].every((mime) => ["model/vrm", "model/gltf-binary"].includes(mime)))) {
      fail("MIME_MISMATCH", "동일한 attachment 바이트가 충돌하는 MIME 종류로 선언되었습니다.");
    }
    existing.kinds.add(input.kind);
    return existing;
  }
  if (context.attachments.size >= context.limits.maxAttachments) {
    fail("ATTACHMENT_COUNT_LIMIT", "중복 제거 후 attachment 수가 안전 한도를 넘었습니다.");
  }
  const attachment: MutableAttachment = {
    sha256,
    blob: blob.slice(0, blob.size, detectedMimeType),
    byteSize: blob.size,
    detectedMimeType,
    kinds: new Set([input.kind]),
    references: new Map(),
  };
  context.attachments.set(sha256, attachment);
  return attachment;
}

async function extractEmbeddedAssets(
  value: unknown,
  pointer: string,
  context: BuildContext
): Promise<unknown> {
  if (typeof value === "string") {
    if (!value.startsWith("data:")) return value;
    const parsed = parseRasterDataUrl(value, context.limits.maxAttachmentBytes);
    if (!parsed) {
      if (/^data:image\/(?:png|jpeg|gif|webp)(?:;|,)/iu.test(value)) {
        fail("MIME_SIGNATURE_MISMATCH", "래스터 data URL 형식 또는 Base64 데이터가 올바르지 않습니다.", {
          pointer,
        });
      }
      warning(
        context.diagnostics,
        "UNSUPPORTED_EMBEDDED_DATA",
        "지원하지 않는 inline data URL은 project.json 내부에 그대로 보존했습니다.",
        { pointer }
      );
      return value;
    }
    const usage = referenceUsage(pointer);
    const attachment = await addAttachmentCandidate(context, {
      kind: usage,
      data: parsed.bytes,
      mimeType: parsed.mimeType,
    });
    addDocumentReference(context, attachment, { pointer, usage });
    return assetUri(attachment.sha256);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = await extractEmbeddedAssets(value[index], childPointer(pointer, String(index)), context);
    }
    return value;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      value[key] = await extractEmbeddedAssets(value[key], childPointer(pointer, key), context);
    }
  }
  return value;
}

/**
 * Older Studio builds appended percent-encoded BG3D or VRM poser JSON to a captured PNG. Convert
 * those payloads to separate canonical scene fields before raster extraction. Legacy custom
 * models contain only local IndexedDB keys, so archiving them without an explicit binary resolver
 * would be lossy; those projects fail with an actionable boundary instead.
 */
function migrateLegacyStudio3dImageFragments(project: Record<string, unknown>): void {
  const primitiveKinds = new Set<string>(STUDIO_BG3D_PRIMITIVE_KINDS);
  const finiteVec3Within = (candidate: unknown, minimum: number, maximum: number): boolean =>
    Array.isArray(candidate)
    && candidate.length === 3
    && candidate.every((component) =>
      typeof component === "number"
      && Number.isFinite(component)
      && component >= minimum
      && component <= maximum
    );
  const primitivePreservesTransform = (candidate: unknown): boolean =>
    isRecord(candidate)
    && typeof candidate.kind === "string"
    && primitiveKinds.has(candidate.kind)
    && finiteVec3Within(candidate.position, -10_000, 10_000)
    && finiteVec3Within(candidate.rotation, -Number.MAX_VALUE, Number.MAX_VALUE)
    && finiteVec3Within(candidate.scale, 0.001, 1_000)
    && typeof candidate.color === "string"
    && /^#[a-f0-9]{6}$/iu.test(candidate.color);
  const visitElements = (value: unknown, basePointer: string): void => {
    if (!Array.isArray(value)) return;
    for (let index = 0; index < value.length; index += 1) {
      const element = value[index];
      if (!isRecord(element) || element.type !== "image" || typeof element.src !== "string") continue;
      const separator = element.src.indexOf("#");
      if (separator < 0) continue;
      const pointer = `${basePointer}/${index}/src`;
      const baseDataUrl = element.src.slice(0, separator);
      const encodedFragment = element.src.slice(separator + 1);
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/iu.test(baseDataUrl)) continue;
      if (
        element.bg3dScene !== undefined
        || element.vrmScene !== undefined
        || encodedFragment.length === 0
        || textEncoder.encode(encodedFragment).byteLength
          > Math.max(
            STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES,
            STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
          ) * 3
      ) {
        fail("PROJECT_INVALID", "레거시 3D 배경 fragment를 안전하게 변환할 수 없습니다.", { pointer });
      }
      let decodedFragment: string;
      let decoded: unknown;
      try {
        decodedFragment = decodeURIComponent(encodedFragment);
        decoded = JSON.parse(decodedFragment) as unknown;
      } catch {
        fail("PROJECT_INVALID", "레거시 3D 배경 fragment를 해석할 수 없습니다.", { pointer });
      }
      if (
        isRecord(decoded)
        && (decoded.tool === "vrm-poser" || (decoded.tool === undefined && decoded.modelId !== undefined))
      ) {
        const migratedVrm = parseStudioVrmLegacyFragment(element.src, {
          bundledModels: SAMPLE_VRMS.map(({ id, name }) => ({ id, name })),
        });
        if (!migratedVrm) {
          fail("PROJECT_INVALID", "레거시 3D 데생 인형 fragment를 해석할 수 없습니다.", { pointer });
        }
        if (migratedVrm.status === "unresolved-model") {
          fail(
            "PROJECT_INVALID",
            "레거시 업로드 VRM을 먼저 Studio에서 다시 열어 모델 attachment로 저장해 주세요.",
            { pointer }
          );
        }
        const canonicalVrmSceneJson = serializeStudioVrmSceneDocument(migratedVrm.document);
        if (!canonicalVrmSceneJson) {
          fail("PROJECT_INVALID", "레거시 3D 데생 인형 장면을 canonical 형식으로 저장할 수 없습니다.", {
            pointer,
          });
        }
        value[index] = {
          ...element,
          src: migratedVrm.rasterSrc,
          vrmScene: JSON.parse(canonicalVrmSceneJson) as unknown,
        };
        continue;
      }
      if (
        !isRecord(decoded)
        || decoded.tool !== "bg3d"
        || !Array.isArray(decoded.primitives)
      ) {
        fail("PROJECT_INVALID", "지원하지 않는 레거시 이미지 fragment입니다.", { pointer });
      }
      if (Array.isArray(decoded.customModels) && decoded.customModels.length > 0) {
        fail(
          "PROJECT_INVALID",
          "레거시 3D 모델을 먼저 Studio에서 다시 열어 GLB attachment로 저장해 주세요.",
          { pointer }
        );
      }
      if (!decoded.primitives.every(primitivePreservesTransform)) {
        fail(
          "PROJECT_INVALID",
          "레거시 3D 배경 요소의 위치·회전·크기를 손실 없이 변환할 수 없습니다.",
          { pointer }
        );
      }
      const migrated = migrateStudioBg3dSceneDocument(decodedFragment);
      if (!migrated || migrated.nodes.length !== decoded.primitives.length) {
        fail("PROJECT_INVALID", "레거시 3D 배경 요소를 손실 없이 변환할 수 없습니다.", { pointer });
      }
      const canonicalSceneJson = serializeStudioBg3dSceneDocument(migrated);
      if (!canonicalSceneJson) {
        fail("PROJECT_INVALID", "레거시 3D 배경 장면을 canonical 형식으로 저장할 수 없습니다.", {
          pointer,
        });
      }
      value[index] = {
        ...element,
        src: baseDataUrl,
        bg3dScene: JSON.parse(canonicalSceneJson) as unknown,
      };
    }
  };

  const pages = project.pagesList;
  if (Array.isArray(pages)) {
    pages.forEach((page, pageIndex) => {
      if (isRecord(page)) visitElements(page.elements, `/pagesList/${pageIndex}/elements`);
    });
  }
  if (isRecord(project.master)) visitElements(project.master.elements, "/master/elements");
}

function addDocumentReference(
  context: BuildContext,
  attachment: MutableAttachment,
  reference: StudioProjectArchiveDocumentReference
): void {
  const mode = documentReferenceMode(reference);
  const canonicalReference: StudioProjectArchiveDocumentReference = {
    pointer: reference.pointer,
    usage: reference.usage,
    mode,
  };
  const key = `${reference.pointer}\u0000${reference.usage}\u0000${mode}`;
  if (attachment.references.has(key)) return;
  const existingReference = [...attachment.references.values()].find(
    (candidate) => candidate.pointer === reference.pointer
  );
  if (
    existingReference
    && (
      existingReference.usage !== reference.usage
      || documentReferenceMode(existingReference) !== mode
    )
  ) {
    fail("DOCUMENT_REFERENCE_CONFLICT", "하나의 프로젝트 위치에 서로 다른 attachment 용도가 선언되었습니다.", {
      pointer: reference.pointer,
    });
  }
  context.references += 1;
  if (context.references > context.limits.maxReferences) {
    fail("REFERENCE_LIMIT", "프로젝트 attachment 문서 참조 수가 안전 한도를 넘었습니다.");
  }
  const owner = context.pointerOwners.get(reference.pointer);
  const existingMode = context.pointerModes.get(reference.pointer);
  if (owner && (owner !== attachment.sha256 || existingMode !== mode)) {
    fail("DOCUMENT_REFERENCE_CONFLICT", "하나의 프로젝트 위치가 서로 다른 attachment를 참조합니다.", {
      pointer: reference.pointer,
    });
  }
  context.pointerOwners.set(reference.pointer, attachment.sha256);
  context.pointerModes.set(reference.pointer, mode);
  attachment.references.set(key, canonicalReference);
}

function decodePointerSegment(value: string): string {
  if (/~(?![01])/u.test(value)) fail("DOCUMENT_REFERENCE_MISSING", "JSON Pointer escape가 올바르지 않습니다.");
  return value.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/") || pointer.length > 2_048) {
    fail("DOCUMENT_REFERENCE_MISSING", "attachment JSON Pointer가 올바르지 않습니다.", { pointer });
  }
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

function dangerousPointerSegment(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}

function getPointer(root: unknown, pointer: string): { found: boolean; value?: unknown } {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (dangerousPointerSegment(segment)) return { found: false };
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
    } else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function setPointer(root: unknown, pointer: string, value: unknown): boolean {
  const segments = pointerSegments(pointer);
  const final = segments.pop();
  if (!final || dangerousPointerSegment(final)) return false;
  let current = root;
  for (const segment of segments) {
    if (dangerousPointerSegment(segment)) return false;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return false;
      current = current[Number(segment)];
    } else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return false;
    }
  }
  if (Array.isArray(current)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(final)) return false;
    const index = Number(final);
    if (index >= current.length) return false;
    current[index] = value;
    return true;
  }
  if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, final)) return false;
  current[final] = value;
  return true;
}

function probableAssetField(pointer: string): boolean {
  const tail = pointer.split("/").at(-1)?.toLowerCase() ?? "";
  return /(src|url|href|model|audio|reference|texture|file|asset)/u.test(tail);
}

function scanExternalProjectDependencies(
  value: unknown,
  pointer: string,
  diagnostics: StudioProjectArchiveDiagnostic[],
  coveredPointers: ReadonlySet<string> = new Set(),
): void {
  if (typeof value === "string") {
    if (isSelfContainedUri(value) || coveredPointers.has(pointer)) return;
    const probableAsset = probableAssetField(pointer);
    const hasUriScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
    if (
      /^(?:https?:|blob:)/iu.test(value)
      || (probableAsset && (value.startsWith("/") || hasUriScheme))
    ) {
      warning(
        diagnostics,
        "EXTERNAL_PROJECT_DEPENDENCY",
        "프로젝트 필드가 archive 외부 자산을 참조합니다.",
        { pointer }
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanExternalProjectDependencies(
      item,
      childPointer(pointer, String(index)),
      diagnostics,
      coveredPointers,
    ));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      scanExternalProjectDependencies(item, childPointer(pointer, key), diagnostics, coveredPointers);
    }
  }
}

function linked3dArchiveCoverage(
  project: StudioProjectFile,
  evidence: Parameters<typeof assertStudioLinked3dPassProjectArchiveEvidence>[1],
): ReadonlySet<string> {
  try {
    return assertStudioLinked3dPassProjectArchiveEvidence(project, evidence);
  } catch (cause) {
    if (!(cause instanceof StudioLinked3dPassProjectArchiveError)) throw cause;
    if (cause.code === "attachment-missing") {
      fail("ATTACHMENT_MISSING", cause.message);
    }
    if (cause.code === "attachment-mismatch") {
      fail("DOCUMENT_REFERENCE_MISMATCH", cause.message);
    }
    fail("PROJECT_INVALID", cause.message);
  }
}

function collectProjectAssetUris(
  value: unknown,
  pointer: string,
  output: Map<string, string>
): void {
  const sha256 = studioProjectArchiveAssetSha256(value);
  if (sha256) {
    output.set(pointer, sha256);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectProjectAssetUris(item, childPointer(pointer, String(index)), output));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      collectProjectAssetUris(item, childPointer(pointer, key), output);
    }
  }
}

function assertProjectAssetUrisCovered(
  value: unknown,
  pointerOwners: ReadonlyMap<string, string>,
  attachmentHashes: ReadonlySet<string>
): void {
  const projectUris = new Map<string, string>();
  collectProjectAssetUris(value, "", projectUris);
  for (const [pointer, sha256] of projectUris) {
    if (pointerOwners.get(pointer) !== sha256 || !attachmentHashes.has(sha256)) {
      fail("ATTACHMENT_MISSING", "project.json의 content-addressed 자산 참조가 manifest attachment와 연결되지 않습니다.", {
        pointer,
      });
    }
  }
}

interface StudioReferenceBoardIntegrityReference {
  pointer: string;
  sha256: string;
}

function collectReferenceBoardIntegrityReferences(
  project: StudioProjectFile
): StudioReferenceBoardIntegrityReference[] {
  const document = parseStudioReferenceBoardDocument(project.referenceBoard);
  if (!document) return [];
  return document.items.map((item, index) => ({
    pointer: `/referenceBoard/items/${index}/asset/sha256`,
    sha256: item.asset.sha256.slice("sha256:".length),
  }));
}

/**
 * A raw `sha256:` value is only an identity, not evidence that its bytes are inside the ZIP.
 * Reference-board hashes are optional external dependencies, so unlike BG3D models they produce a
 * self-containment warning instead of making project export/import fail.
 */
function warnUncoveredReferenceBoardAttachments(
  project: StudioProjectFile,
  diagnostics: StudioProjectArchiveDiagnostic[],
  isCovered: (reference: StudioReferenceBoardIntegrityReference) => boolean
): void {
  for (const reference of collectReferenceBoardIntegrityReferences(project)) {
    if (isCovered(reference)) continue;
    warning(
      diagnostics,
      "EXTERNAL_PROJECT_DEPENDENCY",
      "참고 보드 이미지 바이트가 project archive에 포함되지 않았습니다.",
      { pointer: reference.pointer }
    );
  }
}

interface Bg3dArchiveAttachmentEvidence {
  readonly byteSize: number;
  readonly mimeType: string;
  readonly kinds: readonly StudioProjectArchiveAttachmentKind[];
  readonly documentReferences: readonly StudioProjectArchiveDocumentReference[];
}

interface VrmSurfacePaintArchiveReference {
  readonly sha256: string;
  readonly bindingKey: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly pointer: string;
}

interface VrmSurfacePaintArchiveAttachmentPlan {
  readonly sha256: string;
  readonly bindingKey: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly documentReferences: readonly StudioProjectArchiveDocumentReference[];
}

function collectVrmSurfacePaintArchivePlan(
  project: unknown,
): readonly VrmSurfacePaintArchiveAttachmentPlan[] {
  let parsed: StudioProjectFile;
  try {
    parsed = parseStudioProjectFile(project);
  } catch {
    fail("PROJECT_INVALID", "VRM 표면 페인팅 참조를 확인할 프로젝트가 올바르지 않습니다.");
  }
  const references: VrmSurfacePaintArchiveReference[] = [];
  const visitElements = (elements: readonly unknown[], basePointer: string): void => {
    elements.forEach((element, elementIndex) => {
      if (!isRecord(element) || element.type !== "image" || element.vrmScene === undefined) return;
      const serialized = serializeStudioVrmSceneDocument(element.vrmScene);
      const scene = serialized ? parseStudioVrmSceneDocument(serialized) : null;
      if (!scene) {
        fail("PROJECT_INVALID", "VRM 표면 페인팅 장면 문서가 올바르지 않습니다.");
      }
      scene.surfacePaint.textures.forEach((
        texture: StudioVrmSurfacePaintTexture,
        textureIndex: number,
      ) => {
        references.push({
          sha256: texture.hash.slice("sha256:".length),
          bindingKey: texture.bindingKey,
          byteSize: texture.byteSize,
          width: texture.width,
          height: texture.height,
          pointer: `${basePointer}/${elementIndex}/vrmScene/surfacePaint/textures/${textureIndex}/hash`,
        });
      });
    });
  };
  parsed.pagesList.forEach((page, pageIndex) => {
    visitElements(page.elements, `/pagesList/${pageIndex}/elements`);
  });
  if (isRecord(parsed.master) && Array.isArray(parsed.master.elements)) {
    visitElements(parsed.master.elements, "/master/elements");
  }

  const grouped = new Map<string, VrmSurfacePaintArchiveAttachmentPlan>();
  for (const reference of references) {
    const existing = grouped.get(reference.sha256);
    if (
      existing
      && (
        existing.byteSize !== reference.byteSize
        || existing.width !== reference.width
        || existing.height !== reference.height
      )
    ) {
      fail(
        "DOCUMENT_REFERENCE_MISMATCH",
        "같은 VRM 표면 페인팅 PNG 해시에 서로 다른 무결성 정보가 선언되었습니다.",
        { pointer: reference.pointer },
      );
    }
    const documentReference: StudioProjectArchiveDocumentReference = {
      pointer: reference.pointer,
      usage: "raster",
      mode: "sha256-prefixed",
    };
    if (existing) {
      grouped.set(reference.sha256, {
        ...existing,
        documentReferences: [...existing.documentReferences, documentReference],
      });
    } else {
      grouped.set(reference.sha256, {
        sha256: reference.sha256,
        bindingKey: reference.bindingKey,
        byteSize: reference.byteSize,
        width: reference.width,
        height: reference.height,
        documentReferences: [documentReference],
      });
    }
  }
  return [...grouped.values()].sort((left, right) => compareText(left.sha256, right.sha256));
}

function assertVrmSurfacePaintIntegrityReferencesCovered(
  project: unknown,
  attachmentsByHash: ReadonlyMap<string, Bg3dArchiveAttachmentEvidence>,
): readonly VrmSurfacePaintArchiveAttachmentPlan[] {
  const plan = collectVrmSurfacePaintArchivePlan(project);
  for (const attachment of plan) {
    const evidence = attachmentsByHash.get(attachment.sha256);
    if (!evidence) {
      fail(
        "ATTACHMENT_MISSING",
        "VRM 표면 페인팅 PNG 바이트가 프로젝트 archive에 없습니다.",
        { pointer: attachment.documentReferences[0]?.pointer },
      );
    }
    if (evidence.byteSize !== attachment.byteSize) {
      fail(
        "DOCUMENT_REFERENCE_MISMATCH",
        "VRM 표면 페인팅 PNG 크기가 장면 문서와 다릅니다.",
        { pointer: attachment.documentReferences[0]?.pointer },
      );
    }
    if (evidence.mimeType !== "image/png" || !evidence.kinds.includes("raster")) {
      fail(
        "MIME_MISMATCH",
        "VRM 표면 페인팅은 검증 가능한 PNG raster attachment만 참조할 수 있습니다.",
        { pointer: attachment.documentReferences[0]?.pointer },
      );
    }
    for (const reference of attachment.documentReferences) {
      if (!evidence.documentReferences.some((candidate) =>
        candidate.pointer === reference.pointer
        && candidate.usage === "raster"
        && documentReferenceMode(candidate) === "sha256-prefixed"
      )) {
        fail(
          "ATTACHMENT_MISSING",
          "VRM 표면 페인팅 해시가 archive PNG attachment와 연결되지 않았습니다.",
          { pointer: reference.pointer },
        );
      }
    }
  }
  return plan;
}

async function validateVrmSurfacePaintPng(
  plan: VrmSurfacePaintArchiveAttachmentPlan,
  bytes: Uint8Array,
): Promise<void> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (
    bytes.byteLength !== plan.byteSize
    || bytes.byteLength < 24
    || !signature.every((value, index) => bytes[index] === value)
  ) {
    fail("MIME_SIGNATURE_MISMATCH", "VRM 표면 페인팅 PNG 파일 서명이 올바르지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8, false) !== 13
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
    || view.getUint32(16, false) !== plan.width
    || view.getUint32(20, false) !== plan.height
  ) {
    fail(
      "DOCUMENT_REFERENCE_MISMATCH",
      "VRM 표면 페인팅 PNG 크기가 장면 문서의 무결성 정보와 다릅니다.",
      { pointer: plan.documentReferences[0]?.pointer },
    );
  }
  try {
    await verifyStudioVrmTexturePaintArtifact({
      schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
      kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
      bindingKey: plan.bindingKey,
      contentHash: `sha256:${plan.sha256}`,
      mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
      byteLength: plan.byteSize,
      width: plan.width,
      height: plan.height,
    }, bytes);
  } catch {
    fail(
      "MIME_SIGNATURE_MISMATCH",
      "VRM 표면 페인팅 PNG가 구조·CRC·SHA-256 무결성 검사를 통과하지 못했습니다.",
      { pointer: plan.documentReferences[0]?.pointer },
    );
  }
}

function assertBg3dIntegrityReferencesCovered(
  project: unknown,
  attachmentsByHash: ReadonlyMap<string, Bg3dArchiveAttachmentEvidence>,
  limits: StudioProjectArchiveLimits
): StudioBg3dProjectArchivePlan {
  const plan = collectStudioBg3dProjectArchivePlan(project, { limits });
  for (const attachment of plan.attachments) {
    const evidence = attachmentsByHash.get(attachment.sha256);
    if (!evidence) {
      fail("ATTACHMENT_MISSING", "3D 배경 장면의 GLB 바이트가 프로젝트 archive에 없습니다.");
    }
    if (evidence.byteSize !== attachment.byteSize) {
      fail("DOCUMENT_REFERENCE_MISMATCH", "3D 배경 장면의 모델 크기가 archive GLB 바이트와 다릅니다.");
    }
    if (
      evidence.mimeType !== STUDIO_BG3D_GLB_MIME
      || !evidence.kinds.includes("glb")
    ) {
      fail("MIME_MISMATCH", "3D 배경 장면은 검증 가능한 GLB attachment만 참조할 수 있습니다.");
    }
    for (const reference of attachment.documentReferences) {
      const matched = evidence.documentReferences.some((candidate) =>
        candidate.pointer === reference.pointer
        && candidate.usage === "glb"
        && documentReferenceMode(candidate) === "sha256-prefixed"
      );
      if (!matched) {
        fail("ATTACHMENT_MISSING", "3D 배경 장면 해시가 archive GLB attachment와 연결되지 않았습니다.", {
          pointer: reference.pointer,
        });
      }
    }
  }
  return plan;
}

async function validateBg3dArchiveGlb(
  attachment: StudioBg3dProjectArchiveAttachmentPlan,
  bytes: Uint8Array,
  usedBytes: number,
  maximumBytes: number
): Promise<StudioBg3dGlbValidationSuccess> {
  const validationOutcome = await validateStudioBg3dGlbOffMainThread(bytes, {
    declared: {
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      mimeType: attachment.mimeType,
    },
    cumulative: { usedBytes, maximumBytes },
    profile: "desktop",
    budgets: attachment.validationBudgets,
    supportedRequiredExtensions: STUDIO_BG3D_CANONICAL_REQUIRED_GLTF_EXTENSIONS,
  }).catch(() => fail(
    "MIME_SIGNATURE_MISMATCH",
    "3D 배경 GLB의 무결성·내장 리소스·복잡도 안전 검사를 실행하지 못했습니다."
  ));
  const result = validationOutcome.result;
  if (!result.ok) {
    fail(
      "MIME_SIGNATURE_MISMATCH",
      "3D 배경 GLB가 무결성·내장 리소스·복잡도 안전 검사를 통과하지 못했습니다."
    );
  }
  return result;
}

function compareReferences(
  left: StudioProjectArchiveDocumentReference,
  right: StudioProjectArchiveDocumentReference
): number {
  return compareText(left.pointer, right.pointer)
    || compareText(left.usage, right.usage)
    || compareText(documentReferenceMode(left), documentReferenceMode(right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareKinds(
  left: StudioProjectArchiveAttachmentKind,
  right: StudioProjectArchiveAttachmentKind
): number {
  return STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS.indexOf(left)
    - STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS.indexOf(right);
}

function finalizeManifestAttachment(attachment: MutableAttachment): StudioProjectArchiveManifestAttachment {
  const mimeType = canonicalAttachmentMime(attachment);
  return {
    path: attachmentPath(attachment.sha256, mimeType, attachment.kinds),
    mimeType,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
    kinds: [...attachment.kinds].sort(compareKinds),
    documentReferences: [...attachment.references.values()]
      .map((reference) => ({
        pointer: reference.pointer,
        usage: reference.usage,
        mode: documentReferenceMode(reference),
      }))
      .sort(compareReferences),
  };
}

function validateCanonicalManifest(manifest: StudioProjectArchiveManifest, limits: StudioProjectArchiveLimits): void {
  if (manifest.attachments.length > limits.maxAttachments) {
    fail("ATTACHMENT_COUNT_LIMIT", "manifest attachment 수가 안전 한도를 넘었습니다.");
  }
  const paths = new Set<string>();
  const hashes = new Set<string>();
  const pointers = new Map<string, string>();
  const pointerModes = new Map<string, "asset-uri" | "sha256-prefixed">();
  let attachmentBytes = 0;
  let references = 0;
  let previousPath = "";
  for (const attachment of manifest.attachments) {
    if (attachment.path <= previousPath) {
      fail("MANIFEST_INVALID", "manifest attachment 목록이 canonical 경로 순서가 아닙니다.");
    }
    previousPath = attachment.path;
    if (paths.has(attachment.path) || hashes.has(attachment.sha256)) {
      fail("MANIFEST_INVALID", "manifest attachment 경로 또는 해시가 중복되었습니다.", { path: attachment.path });
    }
    paths.add(attachment.path);
    hashes.add(attachment.sha256);
    const kindSet = new Set(attachment.kinds);
    if (kindSet.size !== attachment.kinds.length || [...attachment.kinds].sort(compareKinds).join("\0") !== attachment.kinds.join("\0")) {
      fail("MANIFEST_INVALID", "manifest attachment 종류가 canonical 순서가 아닙니다.", { path: attachment.path });
    }
    const expectedPath = attachmentPath(attachment.sha256, attachment.mimeType, kindSet);
    if (attachment.path !== expectedPath) {
      fail("MANIFEST_INVALID", "manifest content-addressed 경로가 해시 또는 MIME과 맞지 않습니다.", { path: attachment.path });
    }
    attachmentBytes += attachment.byteSize;
    if (attachment.byteSize > limits.maxAttachmentBytes || attachmentBytes > limits.maxTotalAttachmentBytes) {
      fail("ATTACHMENT_SIZE_LIMIT", "manifest attachment 크기가 안전 한도를 넘었습니다.", { path: attachment.path });
    }
    let previousReference = "";
    for (const reference of attachment.documentReferences) {
      references += 1;
      if (
        (manifest.version === 1 && reference.mode !== undefined)
        || (manifest.version === STUDIO_PROJECT_ARCHIVE_VERSION && reference.mode === undefined)
      ) {
        fail("MANIFEST_INVALID", "manifest 버전에 맞는 문서 참조 mode가 아닙니다.", {
          path: attachment.path,
          pointer: reference.pointer,
        });
      }
      if (!kindSet.has(reference.usage)) {
        fail("MANIFEST_INVALID", "manifest 문서 참조 usage가 attachment 종류와 연결되지 않습니다.", {
          path: attachment.path,
          pointer: reference.pointer,
        });
      }
      const mode = documentReferenceMode(reference);
      const key = `${reference.pointer}\u0000${reference.usage}\u0000${mode}`;
      if (key <= previousReference) {
        fail("MANIFEST_INVALID", "manifest 문서 참조가 canonical 순서가 아닙니다.", { path: attachment.path });
      }
      previousReference = key;
      const owner = pointers.get(reference.pointer);
      const existingMode = pointerModes.get(reference.pointer);
      if (owner && (owner !== attachment.sha256 || existingMode !== mode)) {
        fail("DOCUMENT_REFERENCE_CONFLICT", "manifest의 한 문서 위치가 여러 attachment를 참조합니다.", {
          pointer: reference.pointer,
        });
      }
      pointers.set(reference.pointer, attachment.sha256);
      pointerModes.set(reference.pointer, mode);
    }
  }
  if (references > limits.maxReferences) fail("REFERENCE_LIMIT", "manifest 문서 참조 수가 안전 한도를 넘었습니다.");
  if (
    manifest.totals.entryCount !== manifest.attachments.length + 2
    || manifest.totals.attachmentCount !== manifest.attachments.length
    || manifest.totals.attachmentBytes !== attachmentBytes
    || manifest.totals.contentBytes !== manifest.project.byteSize + attachmentBytes
  ) {
    fail("MANIFEST_INVALID", "manifest 합계가 실제 선언 항목과 일치하지 않습니다.");
  }
}

/** Build a deterministic, self-contained `.toonproject.zip` Blob without writing or downloading. */
export async function buildStudioProjectArchive(
  input: BuildStudioProjectArchiveInput,
  options: StudioProjectArchiveOptions = {}
): Promise<BuildStudioProjectArchiveResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("PROJECT_INVALID", "프로젝트 archive 입력이 올바르지 않습니다.");
  }
  if (input.attachments !== undefined && !Array.isArray(input.attachments)) {
    fail("ATTACHMENT_COUNT_LIMIT", "attachment 입력 목록이 배열이 아닙니다.");
  }
  const limits = resolveLimits(options.limits);
  const diagnostics: StudioProjectArchiveDiagnostic[] = [];
  const boundedInput = canonicalizeProjectValue(input.project, "", 0, {
    seen: new WeakSet(),
    diagnostics,
    limits,
    nodes: 0,
  });
  let parsedProject: StudioProjectFile;
  try {
    parsedProject = parseStudioProjectFile(boundedInput);
  } catch (cause) {
    throw new StudioProjectArchiveError(
      "PROJECT_INVALID",
      "올바르지 않은 ToonSpectrum 프로젝트라 archive를 만들 수 없습니다.",
      {},
      cause,
    );
  }
  const canonicalProjectValue = canonicalizeProjectValue(parsedProject, "", 0, {
    seen: new WeakSet(),
    diagnostics,
    limits,
    nodes: 0,
  });
  if (!isRecord(canonicalProjectValue)) fail("PROJECT_INVALID", "프로젝트 JSON 루트가 올바르지 않습니다.");
  migrateLegacyStudio3dImageFragments(canonicalProjectValue);
  const context: BuildContext = {
    limits,
    diagnostics,
    attachments: new Map(),
    pointerOwners: new Map(),
    pointerModes: new Map(),
    attachmentCandidates: 0,
    processedAttachmentBytes: 0,
    references: 0,
  };
  await extractEmbeddedAssets(canonicalProjectValue, "", context);

  for (const candidate of input.attachments ?? []) {
    if (!isRecord(candidate)
      || !STUDIO_PROJECT_ARCHIVE_ATTACHMENT_KINDS.includes(candidate.kind as StudioProjectArchiveAttachmentKind)) {
      fail("MIME_MISMATCH", "지원하지 않는 attachment 종류입니다.");
    }
    if (candidate.documentReferences !== undefined && !Array.isArray(candidate.documentReferences)) {
      fail("DOCUMENT_REFERENCE_MISSING", "attachment 문서 참조 목록이 배열이 아닙니다.");
    }
    const attachmentInput = candidate as unknown as StudioProjectArchiveAttachmentInput;
    const attachment = await addAttachmentCandidate(context, attachmentInput);
    const references = candidate.documentReferences ?? [];
    if (references.length === 0) {
      warning(
        diagnostics,
        "ATTACHMENT_ORPHANED",
        "attachment가 project.json 문서 위치와 연결되지 않았습니다."
      );
    }
    for (const reference of references) {
      const parsedReference = DocumentReferenceInputSchema.safeParse(reference);
      if (!parsedReference.success) {
        fail("DOCUMENT_REFERENCE_MISSING", "attachment 문서 참조 형식이 올바르지 않습니다.");
      }
      const documentReference: StudioProjectArchiveDocumentReference = parsedReference.data;
      if (documentReference.usage !== attachmentInput.kind) {
        fail("DOCUMENT_REFERENCE_CONFLICT", "attachment reference usage와 attachment kind가 다릅니다.", {
          pointer: documentReference.pointer,
        });
      }
      const current = getPointer(canonicalProjectValue, documentReference.pointer);
      if (!current.found) {
        fail("DOCUMENT_REFERENCE_MISSING", "attachment가 가리키는 프로젝트 위치를 찾을 수 없습니다.", {
          pointer: documentReference.pointer,
        });
      }
      const currentHash = studioProjectArchiveAssetSha256(current.value);
      if (documentReferenceMode(documentReference) === "sha256-prefixed") {
        if (current.value !== sha256Prefixed(attachment.sha256)) {
          fail("DOCUMENT_REFERENCE_MISMATCH", "프로젝트의 SHA-256 참조가 attachment 바이트와 일치하지 않습니다.", {
            pointer: documentReference.pointer,
          });
        }
      } else {
        if (currentHash && currentHash !== attachment.sha256) {
          fail("DOCUMENT_REFERENCE_CONFLICT", "프로젝트 위치에 이미 다른 attachment가 연결되어 있습니다.", {
            pointer: documentReference.pointer,
          });
        }
        if (!setPointer(canonicalProjectValue, documentReference.pointer, assetUri(attachment.sha256))) {
          fail("DOCUMENT_REFERENCE_MISSING", "attachment 프로젝트 위치를 갱신하지 못했습니다.", {
            pointer: documentReference.pointer,
          });
        }
      }
      addDocumentReference(context, attachment, documentReference);
    }
  }

  assertProjectAssetUrisCovered(
    canonicalProjectValue,
    context.pointerOwners,
    new Set(context.attachments.keys())
  );
  const archiveAttachmentEvidence = new Map(
    [...context.attachments].map(([sha256, attachment]) => [sha256, {
      byteSize: attachment.byteSize,
      mimeType: canonicalAttachmentMime(attachment),
      kinds: [...attachment.kinds],
      documentReferences: [...attachment.references.values()],
    }]),
  );
  const surfacePaintPlan = assertVrmSurfacePaintIntegrityReferencesCovered(
    canonicalProjectValue,
    archiveAttachmentEvidence,
  );
  for (const planned of surfacePaintPlan) {
    const source = context.attachments.get(planned.sha256);
    if (!source) {
      fail("ATTACHMENT_MISSING", "VRM 표면 페인팅 PNG 바이트를 찾지 못했습니다.");
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await source.blob.arrayBuffer());
    } catch {
      fail("MIME_SIGNATURE_MISMATCH", "VRM 표면 페인팅 PNG 바이트를 읽지 못했습니다.");
    }
    await validateVrmSurfacePaintPng(planned, bytes);
  }
  const bg3dPlan = assertBg3dIntegrityReferencesCovered(
    canonicalProjectValue,
    archiveAttachmentEvidence,
    limits
  );
  let bg3dCumulativeBytes = 0;
  for (const planned of bg3dPlan.attachments) {
    const source = context.attachments.get(planned.sha256);
    if (!source) fail("ATTACHMENT_MISSING", "3D 배경 GLB 바이트를 찾지 못했습니다.");
    const result = await validateBg3dArchiveGlb(
      planned,
      new Uint8Array(await source.blob.arrayBuffer()),
      bg3dCumulativeBytes,
      limits.maxTotalAttachmentBytes
    );
    source.blob = new Blob([result.verifiedBytes.slice().buffer as ArrayBuffer], {
      type: STUDIO_BG3D_GLB_MIME,
    });
    bg3dCumulativeBytes = result.cumulativeBytesAfter;
  }

  const canonicalProject = parseStudioProjectFile(canonicalProjectValue);
  const linked3dCoveredPointers = linked3dArchiveCoverage(
    canonicalProject,
    [...archiveAttachmentEvidence].map(([sha256, evidence]) => ({ sha256, ...evidence })),
  );
  warnUncoveredReferenceBoardAttachments(
    canonicalProject,
    diagnostics,
    ({ pointer, sha256 }) => {
      const attachment = context.attachments.get(sha256);
      return context.pointerOwners.get(pointer) === sha256
        && context.pointerModes.get(pointer) === "sha256-prefixed"
        && attachment?.kinds.has("reference") === true
        && [...attachment.references.values()].some((reference) =>
          reference.pointer === pointer
          && reference.usage === "reference"
          && documentReferenceMode(reference) === "sha256-prefixed"
        );
    }
  );
  scanExternalProjectDependencies(canonicalProject, "", diagnostics, linked3dCoveredPointers);
  const canonicalProjectJson = canonicalJson(canonicalProjectValue);
  const projectBytes = textEncoder.encode(canonicalProjectJson);
  if (projectBytes.byteLength > limits.maxProjectBytes) {
    fail("PROJECT_SIZE_LIMIT", "content-addressed project.json 크기가 안전 한도를 넘었습니다.");
  }
  const projectSha256 = await sha256Bytes(projectBytes);
  const finalizedAttachments = [...context.attachments.values()]
    .map(finalizeManifestAttachment)
    .sort((left, right) => compareText(left.path, right.path));
  const attachmentBytes = finalizedAttachments.reduce((total, item) => total + item.byteSize, 0);
  const manifest: StudioProjectArchiveManifest = {
    schema: STUDIO_PROJECT_ARCHIVE_SCHEMA,
    version: STUDIO_PROJECT_ARCHIVE_VERSION,
    project: {
      path: "project.json",
      mimeType: "application/json",
      byteSize: projectBytes.byteLength,
      sha256: projectSha256,
    },
    attachments: finalizedAttachments,
    totals: {
      entryCount: finalizedAttachments.length + 2,
      attachmentCount: finalizedAttachments.length,
      attachmentBytes,
      contentBytes: projectBytes.byteLength + attachmentBytes,
    },
  };
  validateCanonicalManifest(manifest, limits);
  const manifestJson = canonicalJson(manifest);
  const manifestBytes = textEncoder.encode(manifestJson);
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    fail("MANIFEST_INVALID", "manifest.json 크기가 안전 한도를 넘었습니다.");
  }
  const mutableByHash = context.attachments;
  const entries = [
    { path: "manifest.json", data: manifestBytes },
    { path: "project.json", data: projectBytes },
    ...finalizedAttachments.map((item) => {
      const source = mutableByHash.get(item.sha256);
      if (!source) fail("ATTACHMENT_MISSING", "내부 attachment 데이터를 찾지 못했습니다.", { path: item.path });
      return { path: item.path, data: source.blob };
    }),
  ];
  let blob: Blob;
  try {
    blob = await buildStudioPackageArchiveBlob(entries, {
      mimeType: STUDIO_PROJECT_ARCHIVE_MIME,
      crc32ExecutionMode: options.crc32ExecutionMode ?? "worker",
      limits: {
        maxFiles: limits.maxAttachments + 2,
        maxEntryBytes: Math.max(limits.maxAttachmentBytes, limits.maxProjectBytes, limits.maxManifestBytes),
        maxTotalBytes: Math.min(limits.maxArchiveBytes, limits.maxTotalAttachmentBytes + limits.maxProjectBytes + limits.maxManifestBytes),
        maxArchiveBytes: limits.maxArchiveBytes,
        maxPathBytes: limits.maxPathBytes,
      },
      onProgress: options.onProgress,
    });
  } catch (cause) {
    rethrowPackageArchiveError(cause);
  }
  return {
    blob,
    manifest,
    canonicalProject,
    canonicalProjectJson,
    isSelfContained: diagnosticsAreSelfContained(diagnostics),
    diagnostics,
  };
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of bytes) value = (value >>> 8) ^ (crc32Table[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffff_ffff) >>> 0;
}

function createZipReader(source: StudioPackageArchiveSource, limits: StudioProjectArchiveLimits): ZipReader {
  if (source instanceof Blob) {
    if (source.size <= 0 || source.size > limits.maxArchiveBytes) {
      fail("ARCHIVE_SIZE_LIMIT", "프로젝트 archive 크기가 안전 한도를 넘었습니다.");
    }
    return {
      size: source.size,
      async read(offset, length) {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > source.size) {
          fail("ARCHIVE_INVALID", "ZIP 데이터 범위가 올바르지 않습니다.");
        }
        const bytes = new Uint8Array(await source.slice(offset, offset + length).arrayBuffer());
        if (bytes.byteLength !== length) fail("ARCHIVE_INVALID", "ZIP 데이터를 모두 읽지 못했습니다.");
        return bytes;
      },
      slice(offset, length, mimeType) {
        return source.slice(offset, offset + length, mimeType);
      },
    };
  }
  if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) {
    fail("ARCHIVE_INVALID", "지원하지 않는 프로젝트 archive 바이트 형식입니다.");
  }
  const bytes = source instanceof Uint8Array
    ? source.slice()
    : new Uint8Array(source.slice(0));
  if (bytes.byteLength <= 0 || bytes.byteLength > limits.maxArchiveBytes) {
    fail("ARCHIVE_SIZE_LIMIT", "프로젝트 archive 크기가 안전 한도를 넘었습니다.");
  }
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
        fail("ARCHIVE_INVALID", "ZIP 데이터 범위가 올바르지 않습니다.");
      }
      return bytes.slice(offset, offset + length);
    },
    slice(offset, length, mimeType) {
      const copy = bytes.slice(offset, offset + length);
      return new Blob([copy.buffer as ArrayBuffer], { type: mimeType });
    },
  };
}

function validateImportedPath(value: string, limits: StudioProjectArchiveLimits): string {
  if (
    value.length === 0
    || value !== value.normalize("NFKC")
    || !SAFE_ARCHIVE_PATH_PATTERN.test(value)
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || textEncoder.encode(value).byteLength > limits.maxPathBytes
  ) {
    fail("PATH_INVALID", "ZIP 안에 안전하지 않은 파일 경로가 있습니다.", { path: value });
  }
  const segments = value.split("/");
  if (segments.some((segment) =>
    !segment
    || segment === "."
    || segment === ".."
    || segment.trim() !== segment
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
  )) {
    fail("PATH_INVALID", "ZIP 파일 경로에 순회 또는 빈 구간이 있습니다.", { path: value });
  }
  return value;
}

async function parseZipEntries(reader: ZipReader, limits: StudioProjectArchiveLimits): Promise<ParsedZipEntry[]> {
  if (reader.size < ZIP_EOCD_BYTES) fail("ARCHIVE_INVALID", "ZIP 종료 레코드를 찾을 수 없습니다.");
  const eocdOffset = reader.size - ZIP_EOCD_BYTES;
  const eocd = await reader.read(eocdOffset, ZIP_EOCD_BYTES);
  if (uint32(eocd, 0) !== ZIP_EOCD_SIGNATURE || uint16(eocd, 20) !== 0) {
    fail("ARCHIVE_INVALID", "주석 또는 후행 데이터가 있는 ZIP은 가져올 수 없습니다.");
  }
  if (uint16(eocd, 4) !== 0 || uint16(eocd, 6) !== 0) {
    fail("ARCHIVE_INVALID", "분할 ZIP은 가져올 수 없습니다.");
  }
  const entryCount = uint16(eocd, 10);
  if (entryCount !== uint16(eocd, 8) || entryCount < 2 || entryCount > limits.maxAttachments + 2) {
    fail("ZIP_ENTRY_COUNT_LIMIT", "ZIP 파일 수가 프로젝트 archive 안전 한도를 벗어났습니다.");
  }
  const centralBytes = uint32(eocd, 12);
  const centralOffset = uint32(eocd, 16);
  if (centralOffset + centralBytes !== eocdOffset || centralBytes > entryCount * (ZIP_CENTRAL_HEADER_BYTES + limits.maxPathBytes)) {
    fail("ARCHIVE_INVALID", "ZIP 중앙 디렉터리 범위가 올바르지 않습니다.");
  }
  const central = await reader.read(centralOffset, centralBytes);
  const entries: ParsedZipEntry[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  let totalUncompressed = 0;
  const maxZipEntryBytes = Math.max(
    limits.maxAttachmentBytes,
    limits.maxProjectBytes,
    limits.maxManifestBytes
  );
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + ZIP_CENTRAL_HEADER_BYTES > central.length || uint32(central, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      fail("ARCHIVE_INVALID", "ZIP 중앙 디렉터리 항목이 손상되었습니다.");
    }
    const flags = uint16(central, cursor + 8);
    const method = uint16(central, cursor + 10);
    const expectedCrc = uint32(central, cursor + 16);
    const compressedBytes = uint32(central, cursor + 20);
    const uncompressedBytes = uint32(central, cursor + 24);
    const nameBytes = uint16(central, cursor + 28);
    const extraBytes = uint16(central, cursor + 30);
    const commentBytes = uint16(central, cursor + 32);
    const localHeaderOffset = uint32(central, cursor + 42);
    const next = cursor + ZIP_CENTRAL_HEADER_BYTES + nameBytes + extraBytes + commentBytes;
    if (next > central.length || flags !== ZIP_UTF8_FLAG || extraBytes !== 0 || commentBytes !== 0) {
      fail("ARCHIVE_INVALID", "ZIP 플래그, extra field 또는 comment가 허용된 형식이 아닙니다.");
    }
    if (method !== ZIP_STORE_METHOD) {
      if (uncompressedBytes > Math.max(compressedBytes * 10, maxZipEntryBytes)) {
        fail("ZIP_BOMB", "압축 해제 크기가 비정상적으로 큰 ZIP 항목을 차단했습니다.");
      }
      fail("ZIP_COMPRESSION_UNSUPPORTED", "압축된 ZIP 항목은 프로젝트 archive에서 지원하지 않습니다.");
    }
    if (compressedBytes !== uncompressedBytes || uncompressedBytes > maxZipEntryBytes) {
      fail("ZIP_BOMB", "ZIP 항목의 압축 또는 크기 선언이 안전하지 않습니다.");
    }
    totalUncompressed += uncompressedBytes;
    if (totalUncompressed > limits.maxArchiveBytes) {
      fail("ZIP_BOMB", "ZIP 전체 해제 크기가 안전 한도를 넘었습니다.");
    }
    let path: string;
    try {
      path = fatalTextDecoder.decode(central.subarray(cursor + ZIP_CENTRAL_HEADER_BYTES, cursor + ZIP_CENTRAL_HEADER_BYTES + nameBytes));
    } catch {
      fail("PATH_INVALID", "ZIP 파일명이 올바른 UTF-8이 아닙니다.");
    }
    path = validateImportedPath(path, limits);
    const comparisonKey = path.toLowerCase();
    if (seen.has(comparisonKey)) fail("DUPLICATE_PATH", "ZIP 안에 중복 파일 경로가 있습니다.", { path });
    seen.add(comparisonKey);

    const localHeader = await reader.read(localHeaderOffset, ZIP_LOCAL_HEADER_BYTES + nameBytes);
    if (
      uint32(localHeader, 0) !== ZIP_LOCAL_SIGNATURE
      || uint16(localHeader, 6) !== flags
      || uint16(localHeader, 8) !== method
      || uint32(localHeader, 14) !== expectedCrc
      || uint32(localHeader, 18) !== compressedBytes
      || uint32(localHeader, 22) !== uncompressedBytes
      || uint16(localHeader, 26) !== nameBytes
      || uint16(localHeader, 28) !== 0
    ) {
      fail("ARCHIVE_INVALID", "ZIP local header와 중앙 디렉터리가 일치하지 않습니다.", { path });
    }
    let localName: string;
    try {
      localName = fatalTextDecoder.decode(localHeader.subarray(ZIP_LOCAL_HEADER_BYTES));
    } catch {
      fail("PATH_INVALID", "ZIP local 파일명이 올바른 UTF-8이 아닙니다.", { path });
    }
    if (localName !== path) fail("ARCHIVE_INVALID", "ZIP local 파일명이 중앙 디렉터리와 다릅니다.", { path });
    entries.push({
      path,
      crc32: expectedCrc,
      compressedBytes,
      uncompressedBytes,
      dataOffset: localHeaderOffset + ZIP_LOCAL_HEADER_BYTES + nameBytes,
      localHeaderOffset,
    });
    cursor = next;
  }
  if (cursor !== central.length) fail("ARCHIVE_INVALID", "ZIP 중앙 디렉터리 뒤에 해석되지 않은 데이터가 있습니다.");
  const localOrder = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  let expectedOffset = 0;
  for (const entry of localOrder) {
    if (entry.localHeaderOffset !== expectedOffset || entry.dataOffset + entry.compressedBytes > centralOffset) {
      fail("ARCHIVE_INVALID", "ZIP local 항목 사이에 숨겨진 데이터나 겹침이 있습니다.", { path: entry.path });
    }
    expectedOffset = entry.dataOffset + entry.compressedBytes;
  }
  if (expectedOffset !== centralOffset) fail("ARCHIVE_INVALID", "ZIP local 데이터와 중앙 디렉터리 사이에 숨겨진 데이터가 있습니다.");
  return entries;
}

async function readVerifiedEntry(reader: ZipReader, entry: ParsedZipEntry): Promise<Uint8Array> {
  const bytes = await reader.read(entry.dataOffset, entry.uncompressedBytes);
  if (crc32(bytes) !== entry.crc32) {
    fail("CRC_MISMATCH", "ZIP 항목의 CRC-32 무결성 검사가 실패했습니다.", { path: entry.path });
  }
  return bytes;
}

function parseCanonicalJson<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  code: StudioProjectArchiveDiagnosticCode,
  label: string
): T {
  let text: string;
  let decoded: unknown;
  try {
    text = fatalTextDecoder.decode(bytes);
    decoded = JSON.parse(text);
  } catch {
    fail(code, `${label} JSON을 해석하지 못했습니다.`);
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) fail(code, `${label} schema가 올바르지 않습니다.`);
  if (canonicalJson(parsed.data) !== text) {
    fail("CANONICAL_JSON_REQUIRED", `${label}이 canonical JSON 형식이 아닙니다.`);
  }
  return parsed.data;
}

/**
 * Projects strict historical VRM scenes and singular Shared Stage v1 values to the current
 * schemas for archive-writer compatibility checks. The projections are deliberately composed in
 * one pass so an archive containing both historical forms remains importable.
 */
function promoteStrictHistoricalProjectSchema(
  project: Record<string, unknown>,
): Record<string, unknown> | null {
  let changed = false;
  let invalid = false;
  const visitElements = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map((element) => {
      if (
        !isRecord(element)
        || element.type !== "image"
        || !isRecord(element.vrmScene)
        || element.vrmScene.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
        || (
          element.vrmScene.version !== 1
          && element.vrmScene.version !== 2
          && element.vrmScene.version !== 3
          && element.vrmScene.version !== 4
        )
      ) return element;
      const migrated = migrateStudioVrmSceneDocument(element.vrmScene);
      const serialized = serializeStudioVrmSceneDocument(migrated);
      const canonical = serialized ? parseStudioVrmSceneDocument(serialized) : null;
      if (!canonical) {
        invalid = true;
        return element;
      }
      changed = true;
      return { ...element, vrmScene: canonical };
    });
  };

  const pages = Array.isArray(project.pagesList)
    ? project.pagesList.map((page) => {
        if (!isRecord(page)) return page;
        const nextPage: Record<string, unknown> = {
          ...page,
          elements: visitElements(page.elements),
        };
        const historicalSharedStage = isRecord(page.shared3dStage)
          && (
            (
              page.shared3dStage.kind === STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND
              && page.shared3dStage.version === 1
            )
            || (
              page.shared3dStage.kind === STUDIO_SHARED_3D_STAGE_COLLECTION_KIND
              && page.shared3dStage.version === 2
            )
          );
        if (historicalSharedStage) {
          const migrated = migrateStudioShared3dStageCollectionDocument(page.shared3dStage);
          if (!migrated) invalid = true;
          else {
            changed = true;
            nextPage.shared3dStage = migrated;
          }
        }
        return nextPage;
      })
    : project.pagesList;
  const master = isRecord(project.master)
    ? { ...project.master, elements: visitElements(project.master.elements) }
    : project.master;
  if (invalid) return null;
  if (!changed) return project;
  const promoted: Record<string, unknown> = { ...project, pagesList: pages };
  if (Object.hasOwn(project, "master")) promoted.master = master;
  return promoted;
}

function parseCanonicalProject(
  bytes: Uint8Array,
  limits: StudioProjectArchiveLimits,
  diagnostics: StudioProjectArchiveDiagnostic[],
  manifestVersion: StudioProjectArchiveManifest["version"]
): { stored: StudioProjectFile; value: Record<string, unknown> } {
  let text: string;
  let decoded: unknown;
  try {
    text = fatalTextDecoder.decode(bytes);
    decoded = JSON.parse(text);
  } catch {
    fail("PROJECT_INVALID", "project.json을 해석하지 못했습니다.");
  }
  if (!isRecord(decoded)) {
    fail("CANONICAL_JSON_REQUIRED", "project.json이 canonical JSON 형식이 아닙니다.");
  }
  assertDecodedProjectWithinLimits(decoded, limits);
  if (canonicalJson(decoded) !== text) {
    fail("CANONICAL_JSON_REQUIRED", "project.json이 canonical JSON 형식이 아닙니다.");
  }
  const sanitized = canonicalizeProjectValue(decoded, "", 0, {
    seen: new WeakSet(),
    diagnostics,
    limits,
    nodes: 0,
  });
  if (!isRecord(sanitized) || canonicalJson(sanitized) !== text) {
    fail(
      "PROJECT_INVALID",
      "project.json에 writer가 허용하지 않는 비공개 또는 비정규 필드가 포함되어 있습니다."
    );
  }
  let stored: StudioProjectFile;
  try {
    stored = parseStudioProjectFile(sanitized);
  } catch {
    fail("PROJECT_INVALID", "project.json이 ToonSpectrum 프로젝트 schema와 맞지 않습니다.");
  }
  const writerCanonical = canonicalizeProjectValue(stored, "", 0, {
    seen: new WeakSet(),
    diagnostics,
    limits,
    nodes: 0,
  });
  const historicalProjection = manifestVersion === STUDIO_PROJECT_ARCHIVE_VERSION
    ? promoteStrictHistoricalProjectSchema(sanitized)
    : null;
  const writerMatchesStored = isRecord(writerCanonical)
    && canonicalJson(writerCanonical) === text;
  const writerMatchesHistoricalProjection = isRecord(writerCanonical)
    && historicalProjection !== null
    && canonicalJson(writerCanonical) === canonicalJson(historicalProjection);
  if (
    !isRecord(writerCanonical)
    || (
      manifestVersion === STUDIO_PROJECT_ARCHIVE_VERSION
      && !writerMatchesStored
      && !writerMatchesHistoricalProjection
    )
  ) {
    fail(
      "PROJECT_INVALID",
      "project.json이 현재 writer의 canonical 프로젝트 구조와 일치하지 않습니다."
    );
  }
  return { stored, value: sanitized };
}

function manifestMimeAllowed(mimeType: string, kinds: readonly StudioProjectArchiveAttachmentKind[]): boolean {
  if (kinds.includes("vrm")) return mimeType === "model/vrm";
  return true;
}

/**
 * Import and fully authenticate a self-contained project archive without creating object URLs.
 * Passing a Blob enables slice-based random access; Uint8Array/ArrayBuffer inputs are defensively
 * snapshotted and therefore best reserved for tests or already-small archives.
 */
export async function importStudioProjectArchive(
  source: StudioPackageArchiveSource,
  options: ImportStudioProjectArchiveOptions = {}
): Promise<ImportStudioProjectArchiveResult> {
  const limits = resolveLimits(options.limits);
  const diagnostics: StudioProjectArchiveDiagnostic[] = [];
  const reader = createZipReader(source, limits);
  const zipEntries = await parseZipEntries(reader, limits);
  const byPath = new Map(zipEntries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get("manifest.json");
  if (!manifestEntry) fail("MANIFEST_INVALID", "manifest.json이 없는 프로젝트 archive입니다.");
  if (manifestEntry.uncompressedBytes > limits.maxManifestBytes) {
    fail("MANIFEST_INVALID", "manifest.json 크기가 안전 한도를 넘었습니다.");
  }
  const manifest = parseCanonicalJson(
    await readVerifiedEntry(reader, manifestEntry),
    ManifestSchema,
    "MANIFEST_INVALID",
    "manifest.json"
  );
  validateCanonicalManifest(manifest, limits);
  const expectedPaths = new Set(["manifest.json", manifest.project.path, ...manifest.attachments.map((item) => item.path)]);
  for (const path of expectedPaths) {
    if (!byPath.has(path)) {
      fail(path === "project.json" ? "PROJECT_MISSING" : "ATTACHMENT_MISSING", "manifest가 선언한 파일이 archive에 없습니다.", { path });
    }
  }
  for (const path of byPath.keys()) {
    if (!expectedPaths.has(path)) fail("UNEXPECTED_ENTRY", "manifest에 없는 파일이 archive에 포함되어 있습니다.", { path });
  }
  if (byPath.size !== manifest.totals.entryCount) fail("MANIFEST_INVALID", "manifest 파일 수 합계가 ZIP과 다릅니다.");

  const projectEntry = byPath.get(manifest.project.path);
  if (!projectEntry) fail("PROJECT_MISSING", "project.json이 없는 프로젝트 archive입니다.");
  if (projectEntry.uncompressedBytes !== manifest.project.byteSize || projectEntry.uncompressedBytes > limits.maxProjectBytes) {
    fail("PROJECT_SIZE_LIMIT", "project.json 크기가 manifest 또는 안전 한도와 다릅니다.");
  }
  const projectBytes = await readVerifiedEntry(reader, projectEntry);
  if (await sha256Bytes(projectBytes) !== manifest.project.sha256) {
    fail("HASH_MISMATCH", "project.json SHA-256 무결성 검사가 실패했습니다.", { path: manifest.project.path });
  }
  const parsedProject = parseCanonicalProject(
    projectBytes,
    limits,
    diagnostics,
    manifest.version
  );
  const canonicalProject = parsedProject.stored;
  const rehydratedValue = JSON.parse(canonicalJson(parsedProject.value)) as Record<string, unknown>;
  const importedAttachments = new Map<string, StudioProjectArchiveImportedAttachment>();
  const manifestAssetPointerOwners = new Map<string, string>();
  for (const attachment of manifest.attachments) {
    for (const reference of attachment.documentReferences) {
      if (documentReferenceMode(reference) === "asset-uri") {
        manifestAssetPointerOwners.set(reference.pointer, attachment.sha256);
      }
    }
  }
  assertProjectAssetUrisCovered(
    parsedProject.value,
    manifestAssetPointerOwners,
    new Set(manifest.attachments.map(({ sha256 }) => sha256))
  );
  const bg3dPlan = assertBg3dIntegrityReferencesCovered(
    parsedProject.stored,
    new Map(manifest.attachments.map((attachment) => [attachment.sha256, attachment])),
    limits
  );
  const bg3dPlanByHash = new Map(bg3dPlan.attachments.map((attachment) => [
    attachment.sha256,
    attachment,
  ]));
  const surfacePaintPlan = assertVrmSurfacePaintIntegrityReferencesCovered(
    parsedProject.stored,
    new Map(manifest.attachments.map((attachment) => [attachment.sha256, attachment])),
  );
  const surfacePaintPlanByHash = new Map(surfacePaintPlan.map((attachment) => [
    attachment.sha256,
    attachment,
  ]));
  let bg3dCumulativeBytes = 0;

  for (const metadata of manifest.attachments) {
    const entry = byPath.get(metadata.path);
    if (!entry) fail("ATTACHMENT_MISSING", "attachment 파일이 archive에 없습니다.", { path: metadata.path });
    if (entry.uncompressedBytes !== metadata.byteSize) {
      fail("ATTACHMENT_SIZE_LIMIT", "attachment 크기가 manifest와 다릅니다.", { path: metadata.path });
    }
    const bytes = await readVerifiedEntry(reader, entry);
    if (await sha256Bytes(bytes) !== metadata.sha256) {
      fail("HASH_MISMATCH", "attachment SHA-256 무결성 검사가 실패했습니다.", { path: metadata.path });
    }
    if (!manifestMimeAllowed(metadata.mimeType, metadata.kinds)) {
      fail("MIME_MISMATCH", "VRM attachment MIME 선언이 올바르지 않습니다.", { path: metadata.path });
    }
    const detectedKinds = new Set(metadata.kinds);
    for (const kind of metadata.kinds) {
      const detected = inspectAttachmentBytes(bytes, kind, metadata.mimeType, diagnostics);
      const vrmGlbAlias = metadata.kinds.includes("vrm") && (kind === "vrm" || kind === "glb");
      if (!vrmGlbAlias && metadata.mimeType !== detected) {
        fail("MIME_MISMATCH", "attachment MIME 선언이 실제 파일과 다릅니다.", { path: metadata.path });
      }
    }
    if (attachmentPath(metadata.sha256, metadata.mimeType, detectedKinds) !== metadata.path) {
      fail("PATH_INVALID", "attachment content-addressed 경로가 올바르지 않습니다.", { path: metadata.path });
    }
    const plannedSurfacePaint = surfacePaintPlanByHash.get(metadata.sha256);
    if (plannedSurfacePaint) {
      await validateVrmSurfacePaintPng(plannedSurfacePaint, bytes);
    }
    let rehydratedDataUrl: string | undefined;
    for (const reference of metadata.documentReferences) {
      const current = getPointer(rehydratedValue, reference.pointer);
      const mode = documentReferenceMode(reference);
      const expected = mode === "sha256-prefixed"
        ? sha256Prefixed(metadata.sha256)
        : assetUri(metadata.sha256);
      if (!current.found || current.value !== expected) {
        fail("DOCUMENT_REFERENCE_MISMATCH", "project.json의 attachment 참조가 manifest와 다릅니다.", {
          path: metadata.path,
          pointer: reference.pointer,
        });
      }
      if (
        mode === "asset-uri"
        && options.rehydrateDataUrls !== false
        && (reference.usage === "raster" || reference.usage === "mask" || reference.usage === "reference")
        && !setPointer(
          rehydratedValue,
          reference.pointer,
          rehydratedDataUrl ??= `data:${metadata.mimeType};base64,${bytesToBase64(bytes)}`
        )
      ) {
        fail("DOCUMENT_REFERENCE_MISMATCH", "프로젝트 data URL 참조를 복원하지 못했습니다.", {
          path: metadata.path,
          pointer: reference.pointer,
        });
      }
    }
    const plannedBg3d = bg3dPlanByHash.get(metadata.sha256);
    let importedBlob = reader.slice(entry.dataOffset, entry.uncompressedBytes, metadata.mimeType);
    if (plannedBg3d) {
      const result = await validateBg3dArchiveGlb(
        plannedBg3d,
        bytes,
        bg3dCumulativeBytes,
        limits.maxTotalAttachmentBytes
      );
      importedBlob = new Blob([result.verifiedBytes.slice().buffer as ArrayBuffer], {
        type: STUDIO_BG3D_GLB_MIME,
      });
      bg3dCumulativeBytes = result.cumulativeBytesAfter;
    }
    importedAttachments.set(metadata.sha256, {
      metadata,
      blob: importedBlob,
    });
  }

  const manifestByHash = new Map(manifest.attachments.map((attachment) => [
    attachment.sha256,
    attachment,
  ]));
  const linked3dCoveredPointers = linked3dArchiveCoverage(canonicalProject, manifest.attachments);
  warnUncoveredReferenceBoardAttachments(
    canonicalProject,
    diagnostics,
    ({ pointer, sha256 }) => {
      const attachment = manifestByHash.get(sha256);
      return attachment?.kinds.includes("reference") === true
        && attachment.documentReferences.some((reference) =>
          reference.pointer === pointer
          && reference.usage === "reference"
          && documentReferenceMode(reference) === "sha256-prefixed"
        );
    }
  );
  scanExternalProjectDependencies(rehydratedValue, "", diagnostics, linked3dCoveredPointers);
  let project: StudioProjectFile;
  try {
    project = parseStudioProjectFile(rehydratedValue);
  } catch {
    fail("PROJECT_INVALID", "attachment 복원 후 프로젝트가 studio-project-file 경계와 맞지 않습니다.");
  }
  return {
    project,
    canonicalProject,
    manifest,
    attachments: importedAttachments,
    isSelfContained: diagnosticsAreSelfContained(diagnostics),
    diagnostics,
  };
}
