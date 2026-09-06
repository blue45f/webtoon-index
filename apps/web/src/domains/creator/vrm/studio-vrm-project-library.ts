import { parseStudioProjectFile, type StudioProjectFile } from "../studio-project-file";

import {
  evaluateStudioVrmLicenseAuthority,
  inspectStudioVrmLicenseAuthority,
  prepareStudioVrmProjectArchiveAttestation,
  studioVrmProjectArchiveActionContext,
  type StudioVrmLicenseAuthority,
  type StudioVrmProjectArchiveAttestationPlan,
  type StudioVrmProjectArchiveUseContextReceipt,
} from "./studio-vrm-license-product-gate";
import {
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
  type StudioVrmAttachmentModel,
  type StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";
import {
  canonicalizeVrmContentHash,
  deleteStoredVrmModelIfIdentityMatches,
  ensureStoredVrmContentIdentity,
  getStoredVrmModelByHash,
  hashVrmBlob,
  inspectVrmGlbBytes,
  saveVerifiedVrmBlobWithDisposition,
  VRM_VALIDATION_VERSION,
  type SaveVerifiedVrmBlobDisposition,
  type VrmContentHash,
  type VrmStoredModelRecord,
  type VrmStoredModelWithContentIdentity,
} from "./vrm-library";

import type {
  ImportStudioProjectArchiveResult,
  StudioProjectArchiveAttachmentInput,
  StudioProjectArchiveDocumentReference,
  StudioProjectArchiveImportedAttachment,
} from "../studio-project-archive";

/**
 * Portable VRM archive bridge.
 *
 * Scene documents own only a stable content hash and public model metadata. Device-local
 * SQLite/OPFS storage ids remain behind this boundary and are never written into project.json.
 * Export and import both re-read and validate the complete GLB/VRM payload instead of trusting
 * cached manifest metadata.
 */

export type StudioVrmProjectLibraryDiagnosticCode =
  | "ATTACHMENT_BYTES_INVALID"
  | "ATTACHMENT_HASH_MISMATCH"
  | "ATTACHMENT_METADATA_MISMATCH"
  | "ATTACHMENT_MIME_MISMATCH"
  | "ATTACHMENT_MISSING"
  | "LOCAL_MODEL_BYTES_INVALID"
  | "LOCAL_MODEL_HASH_MISMATCH"
  | "LOCAL_MODEL_LICENSE_RESTRICTED"
  | "LOCAL_MODEL_METADATA_CONFLICT"
  | "LOCAL_MODEL_MIME_MISMATCH"
  | "LOCAL_MODEL_NOT_FOUND"
  | "LOCAL_MODEL_SAVE_FAILED"
  | "LOCAL_MODEL_SIZE_MISMATCH";

export interface StudioVrmProjectLibraryDiagnostic {
  readonly code: StudioVrmProjectLibraryDiagnosticCode;
  readonly message: string;
  readonly hash: VrmContentHash;
  readonly pointers: readonly string[];
  /** Human-readable policy causes when a license gate—not byte integrity—blocked export. */
  readonly policyReasons?: readonly string[];
}

export interface StudioVrmProjectArchiveReference {
  readonly hash: VrmContentHash;
  /** RFC 6901 pointer to the canonical `model.hash` field in project.json. */
  readonly pointer: string;
  readonly scenePointer: string;
  readonly scope: "page" | "master";
  readonly pageIndex?: number;
  readonly elementIndex: number;
  readonly model: StudioVrmAttachmentModel;
}

export type StudioVrmProjectArchiveMissingReason =
  | "bytes-invalid"
  | "hash-mismatch"
  | "license-restricted"
  | "metadata-conflict"
  | "mime-mismatch"
  | "not-found"
  | "size-mismatch";

export interface StudioVrmProjectArchiveMissingModel {
  readonly hash: VrmContentHash;
  readonly pointers: readonly string[];
  readonly reason: StudioVrmProjectArchiveMissingReason;
  readonly policyReasons?: readonly string[];
}

export interface PrepareStudioVrmProjectArchiveExportResult {
  readonly attachments: readonly StudioProjectArchiveAttachmentInput[];
  readonly missing: readonly StudioVrmProjectArchiveMissingModel[];
  readonly diagnostics: readonly StudioVrmProjectLibraryDiagnostic[];
  readonly isComplete: boolean;
}

export interface StudioVrmProjectLibraryDependencies {
  readonly getStoredByContentHash: (hash: string) => Promise<VrmStoredModelRecord | null>;
  readonly ensureStoredIdentity: (
    record: VrmStoredModelRecord,
  ) => Promise<VrmStoredModelWithContentIdentity>;
  readonly hashBlob: (blob: Blob) => Promise<VrmContentHash>;
  readonly inspectGlbVrmBytes: typeof inspectVrmGlbBytes;
  readonly saveVerifiedBlobWithDisposition: typeof saveVerifiedVrmBlobWithDisposition;
  readonly deleteStoredIfIdentityMatches: typeof deleteStoredVrmModelIfIdentityMatches;
}

export interface PreparedStudioVrmProjectArchiveModel {
  readonly hash: VrmContentHash;
  readonly expectedBytes: number;
  readonly name: string;
  /** Null means the archive copy was unavailable/invalid; final local reuse may still resolve it. */
  readonly blob: Blob | null;
}

export interface RestoreStudioVrmProjectArchiveImportResult {
  /** Canonical snapshots; VRM scene documents are unchanged and contain no local model ids. */
  readonly project: StudioProjectFile;
  readonly canonicalProject: StudioProjectFile;
  /** Authenticated blobs retained in memory only; preparation performs no durable writes. */
  readonly prepared: readonly PreparedStudioVrmProjectArchiveModel[];
  readonly reused: ReadonlyArray<{ hash: VrmContentHash; modelId: string }>;
  readonly unresolved: readonly VrmContentHash[];
  readonly diagnostics: readonly StudioVrmProjectLibraryDiagnostic[];
}

export interface InstallStudioVrmProjectArchiveImportResult<ApplyResult> {
  readonly project: StudioProjectFile;
  readonly installed: ReadonlyArray<{ hash: VrmContentHash; modelId: string }>;
  readonly reused: ReadonlyArray<{ hash: VrmContentHash; modelId: string }>;
  readonly unresolved: readonly VrmContentHash[];
  readonly diagnostics: readonly StudioVrmProjectLibraryDiagnostic[];
  readonly applyResult: ApplyResult;
}

export interface InstallStudioVrmProjectArchiveImportOptions<ApplyResult> {
  /** A false result triggers exact compensation of only rows created by this import. */
  readonly didApply: (result: ApplyResult) => boolean;
}

export type StudioVrmProjectLibraryErrorCode =
  | "import-commit-failed"
  | "import-plan-invalid"
  | "import-project-mismatch"
  | "project-invalid";

const ERROR_MESSAGES: Readonly<Record<StudioVrmProjectLibraryErrorCode, string>> = Object.freeze({
  "import-commit-failed": "검증된 VRM 원본을 프로젝트 적용 경계에서 안전하게 저장하지 못했습니다.",
  "import-plan-invalid": "VRM archive 가져오기 준비 결과가 현재 검증 세션에 속하지 않습니다.",
  "import-project-mismatch": "검증한 프로젝트와 복구할 VRM 장면 원본이 일치하지 않습니다.",
  "project-invalid": "VRM 모델 참조를 수집할 프로젝트가 올바르지 않습니다.",
});

export class StudioVrmProjectLibraryError extends Error {
  readonly code: StudioVrmProjectLibraryErrorCode;

  constructor(code: StudioVrmProjectLibraryErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioVrmProjectLibraryError";
    this.code = code;
  }
}

const DEFAULT_DEPENDENCIES: StudioVrmProjectLibraryDependencies = Object.freeze({
  getStoredByContentHash: getStoredVrmModelByHash,
  ensureStoredIdentity: ensureStoredVrmContentIdentity,
  hashBlob: hashVrmBlob,
  inspectGlbVrmBytes: inspectVrmGlbBytes,
  saveVerifiedBlobWithDisposition: saveVerifiedVrmBlobWithDisposition,
  deleteStoredIfIdentityMatches: deleteStoredVrmModelIfIdentityMatches,
});

const PREPARED_IMPORTS = new WeakSet<object>();

function resolveDependencies(
  overrides: Partial<StudioVrmProjectLibraryDependencies>,
): StudioVrmProjectLibraryDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCanonicalScene(value: unknown): StudioVrmSceneDocument | null {
  const serialized = serializeStudioVrmSceneDocument(value);
  return serialized ? parseStudioVrmSceneDocument(serialized) : null;
}

interface ProjectVrmSnapshot {
  readonly project: StudioProjectFile;
  readonly references: StudioVrmProjectArchiveReference[];
  readonly sceneFingerprints: string[];
}

function snapshotProjectVrmReferences(project: unknown): ProjectVrmSnapshot {
  let parsed: StudioProjectFile;
  try {
    parsed = parseStudioProjectFile(project);
  } catch {
    throw new StudioVrmProjectLibraryError("project-invalid");
  }
  const references: StudioVrmProjectArchiveReference[] = [];
  const sceneFingerprints: string[] = [];

  const visitElements = (
    elements: readonly unknown[],
    basePointer: string,
    scope: "page" | "master",
    pageIndex?: number,
  ): void => {
    elements.forEach((element, elementIndex) => {
      if (!isRecord(element) || element.type !== "image" || element.vrmScene === undefined) return;
      const scene = parseCanonicalScene(element.vrmScene);
      if (!scene) throw new StudioVrmProjectLibraryError("project-invalid");
      const scenePointer = `${basePointer}/${elementIndex}/vrmScene`;
      const serialized = serializeStudioVrmSceneDocument(scene);
      if (!serialized) throw new StudioVrmProjectLibraryError("project-invalid");
      sceneFingerprints.push(`${scenePointer}\u0000${serialized}`);
      if (scene.model.source !== "attachment") return;
      const canonicalHash = canonicalizeVrmContentHash(scene.model.hash);
      if (!canonicalHash || canonicalHash !== scene.model.hash) {
        throw new StudioVrmProjectLibraryError("project-invalid");
      }
      references.push({
        hash: canonicalHash,
        pointer: `${scenePointer}/model/hash`,
        scenePointer,
        scope,
        ...(pageIndex === undefined ? {} : { pageIndex }),
        elementIndex,
        model: scene.model,
      });
    });
  };

  parsed.pagesList.forEach((page, pageIndex) => {
    visitElements(page.elements, `/pagesList/${pageIndex}/elements`, "page", pageIndex);
  });
  if (isRecord(parsed.master) && Array.isArray(parsed.master.elements)) {
    visitElements(parsed.master.elements, "/master/elements", "master");
  }
  return { project: parsed, references, sceneFingerprints };
}

/** Collects attachment-backed VRM references in page order followed by master element order. */
export function collectStudioVrmProjectArchiveReferences(
  project: StudioProjectFile | unknown,
): StudioVrmProjectArchiveReference[] {
  return snapshotProjectVrmReferences(project).references;
}

function groupReferences(
  references: readonly StudioVrmProjectArchiveReference[],
): Map<VrmContentHash, StudioVrmProjectArchiveReference[]> {
  const grouped = new Map<VrmContentHash, StudioVrmProjectArchiveReference[]>();
  for (const reference of references) {
    const existing = grouped.get(reference.hash);
    if (existing) existing.push(reference);
    else grouped.set(reference.hash, [reference]);
  }
  return grouped;
}

function metadataConflict(
  references: readonly StudioVrmProjectArchiveReference[],
): boolean {
  const first = references[0]?.model;
  return !first || references.some(({ model }) =>
    model.hash !== first.hash
    || model.byteSize !== first.byteSize
    || !["model/vrm", "model/gltf-binary"].includes(model.mime)
  );
}

type BlobVerificationFailure = Exclude<
  StudioVrmProjectArchiveMissingReason,
  "license-restricted" | "metadata-conflict" | "not-found"
>;

interface BlobVerificationResult {
  readonly failure: BlobVerificationFailure | null;
  readonly licenseAuthority: StudioVrmLicenseAuthority | null;
}

async function verifyVrmBlob(
  blob: Blob,
  expectedHash: VrmContentHash,
  expectedBytes: number,
  dependencies: StudioVrmProjectLibraryDependencies,
): Promise<BlobVerificationResult> {
  const failed = (failure: BlobVerificationFailure): BlobVerificationResult => ({
    failure,
    licenseAuthority: null,
  });
  if (!Number.isSafeInteger(blob.size) || blob.size !== expectedBytes) {
    return failed("size-mismatch");
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch {
    return failed("bytes-invalid");
  }
  if (bytes.byteLength !== expectedBytes) return failed("size-mismatch");
  let licenseAuthority: StudioVrmLicenseAuthority;
  try {
    licenseAuthority = inspectStudioVrmLicenseAuthority(
      dependencies.inspectGlbVrmBytes(bytes).json,
    );
  } catch {
    return failed("bytes-invalid");
  }
  try {
    const actualHash = canonicalizeVrmContentHash(await dependencies.hashBlob(blob));
    return actualHash === expectedHash
      ? { failure: null, licenseAuthority }
      : failed("hash-mismatch");
  } catch {
    return failed("bytes-invalid");
  }
}

interface VerifiedStoredModel {
  readonly record: VrmStoredModelWithContentIdentity;
  readonly blob: Blob;
  readonly licenseAuthority: StudioVrmLicenseAuthority;
}

interface ResolveStoredModelResult {
  readonly match: VerifiedStoredModel | null;
  readonly reason: StudioVrmProjectArchiveMissingReason;
}

async function resolveVerifiedStoredModel(
  hash: VrmContentHash,
  expectedBytes: number,
  dependencies: StudioVrmProjectLibraryDependencies,
): Promise<ResolveStoredModelResult> {
  let stored: VrmStoredModelRecord | null;
  try {
    stored = await dependencies.getStoredByContentHash(hash);
  } catch {
    return { match: null, reason: "not-found" };
  }
  if (!stored) return { match: null, reason: "not-found" };

  let ensured: VrmStoredModelWithContentIdentity;
  try {
    ensured = await dependencies.ensureStoredIdentity(stored);
  } catch {
    return { match: null, reason: "bytes-invalid" };
  }
  if (canonicalizeVrmContentHash(ensured.contentHash) !== hash) {
    return { match: null, reason: "hash-mismatch" };
  }
  if (
    ensured.byteSize !== expectedBytes
    || ensured.blob.size !== expectedBytes
    || ensured.validationVersion !== VRM_VALIDATION_VERSION
  ) {
    return { match: null, reason: "size-mismatch" };
  }
  if (ensured.mimeType !== "model/gltf-binary") {
    return { match: null, reason: "mime-mismatch" };
  }
  const verification = await verifyVrmBlob(ensured.blob, hash, expectedBytes, dependencies);
  return verification.failure || !verification.licenseAuthority
    ? { match: null, reason: verification.failure ?? "bytes-invalid" }
    : {
        match: {
          record: ensured,
          blob: ensured.blob,
          licenseAuthority: verification.licenseAuthority,
        },
        reason: "not-found",
      };
}

function diagnosticForMissing(
  missing: StudioVrmProjectArchiveMissingModel,
): StudioVrmProjectLibraryDiagnostic {
  const details: Record<StudioVrmProjectArchiveMissingReason, {
    code: StudioVrmProjectLibraryDiagnosticCode;
    message: string;
  }> = {
    "bytes-invalid": {
      code: "LOCAL_MODEL_BYTES_INVALID",
      message: "로컬 VRM이 GLB/VRM 안전 검사를 통과하지 못해 archive에 포함하지 않았습니다.",
    },
    "hash-mismatch": {
      code: "LOCAL_MODEL_HASH_MISMATCH",
      message: "로컬 VRM의 실제 SHA-256이 장면 문서의 모델 해시와 일치하지 않습니다.",
    },
    "license-restricted": {
      code: "LOCAL_MODEL_LICENSE_RESTRICTED",
      message: "VRM 이용 조건이 프로젝트 archive 재배포를 허용하지 않아 모델 파일을 포함하지 않았습니다.",
    },
    "metadata-conflict": {
      code: "LOCAL_MODEL_METADATA_CONFLICT",
      message: "같은 VRM 해시를 참조하는 장면들의 모델 크기 또는 MIME 정보가 충돌합니다.",
    },
    "mime-mismatch": {
      code: "LOCAL_MODEL_MIME_MISMATCH",
      message: "로컬 VRM의 검증된 MIME 정보가 VRM 라이브러리 계약과 일치하지 않습니다.",
    },
    "not-found": {
      code: "LOCAL_MODEL_NOT_FOUND",
      message: "장면이 가리키는 VRM을 이 기기의 검증 라이브러리에서 찾지 못했습니다.",
    },
    "size-mismatch": {
      code: "LOCAL_MODEL_SIZE_MISMATCH",
      message: "로컬 VRM의 실제 크기가 장면 문서의 모델 크기와 일치하지 않습니다.",
    },
  };
  return {
    ...details[missing.reason],
    hash: missing.hash,
    pointers: missing.pointers,
    ...(missing.policyReasons ? { policyReasons: missing.policyReasons } : {}),
  };
}

/**
 * Resolves, re-hashes, and validates every attachment-backed VRM. Equal hashes become one archive
 * attachment with all of their exact model-hash pointers. Missing or conflicting rows are never
 * substituted with a similarly named/id'd model.
 */
export async function prepareStudioVrmProjectArchiveExport(
  project: StudioProjectFile | unknown,
  dependencyOverrides: Partial<StudioVrmProjectLibraryDependencies> = {},
  useContextReceipt: StudioVrmProjectArchiveUseContextReceipt | null = null,
): Promise<PrepareStudioVrmProjectArchiveExportResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  // Capture a bounded canonical snapshot before the first asynchronous library lookup.
  const grouped = groupReferences(snapshotProjectVrmReferences(project).references);
  const attachments: StudioProjectArchiveAttachmentInput[] = [];
  const missing: StudioVrmProjectArchiveMissingModel[] = [];

  for (const [hash, references] of grouped) {
    const pointers = references.map(({ pointer }) => pointer);
    if (metadataConflict(references)) {
      missing.push({ hash, pointers, reason: "metadata-conflict" });
      continue;
    }
    const expectedBytes = references[0]?.model.byteSize;
    if (!expectedBytes) {
      missing.push({ hash, pointers, reason: "metadata-conflict" });
      continue;
    }
    const resolved = await resolveVerifiedStoredModel(hash, expectedBytes, dependencies);
    if (!resolved.match) {
      missing.push({ hash, pointers, reason: resolved.reason });
      continue;
    }
    const receipt = resolved.match.licenseAuthority.status === "verified"
      ? resolved.match.licenseAuthority.receipt
      : null;
    const archivePolicy = evaluateStudioVrmLicenseAuthority(
      resolved.match.licenseAuthority,
      "project-archive-redistribution",
      receipt ? studioVrmProjectArchiveActionContext(useContextReceipt, receipt) : {},
    );
    if (!archivePolicy.authorized) {
      missing.push({
        hash,
        pointers,
        reason: "license-restricted",
        policyReasons: archivePolicy.reasons.map(({ message }) => message),
      });
      continue;
    }
    const documentReferences: StudioProjectArchiveDocumentReference[] = pointers.map((pointer) => ({
      pointer,
      usage: "vrm",
      mode: "sha256-prefixed",
    }));
    attachments.push({
      kind: "vrm",
      data: resolved.match.blob,
      mimeType: "model/vrm",
      documentReferences,
    });
  }

  const diagnostics = missing.map(diagnosticForMissing);
  return { attachments, missing, diagnostics, isComplete: missing.length === 0 };
}

/** Read-only first pass used to render the exact multi-model archive consent UI. */
export async function prepareStudioVrmProjectArchiveUseContextAttestation(
  project: StudioProjectFile | unknown,
  dependencyOverrides: Partial<StudioVrmProjectLibraryDependencies> = {},
): Promise<StudioVrmProjectArchiveAttestationPlan> {
  const dependencies = resolveDependencies(dependencyOverrides);
  const grouped = groupReferences(snapshotProjectVrmReferences(project).references);
  const authorities: Array<StudioVrmLicenseAuthority | null> = [];
  for (const [hash, references] of grouped) {
    if (metadataConflict(references)) {
      authorities.push(null);
      continue;
    }
    const expectedBytes = references[0]?.model.byteSize;
    if (!expectedBytes) {
      authorities.push(null);
      continue;
    }
    const resolved = await resolveVerifiedStoredModel(hash, expectedBytes, dependencies);
    authorities.push(resolved.match?.licenseAuthority ?? null);
  }
  return prepareStudioVrmProjectArchiveAttestation(authorities);
}

function sceneSnapshotsMatch(left: ProjectVrmSnapshot, right: ProjectVrmSnapshot): boolean {
  return left.sceneFingerprints.length === right.sceneFingerprints.length
    && left.sceneFingerprints.every((fingerprint, index) =>
      fingerprint === right.sceneFingerprints[index]
    );
}

type ImportedAttachmentFailure =
  | "bytes-invalid"
  | "hash-mismatch"
  | "metadata-mismatch"
  | "mime-mismatch"
  | "missing"
  | "size-mismatch";

function attachmentCoversAllReferences(
  imported: StudioProjectArchiveImportedAttachment,
  hash: VrmContentHash,
  expectedBytes: number,
  references: readonly StudioVrmProjectArchiveReference[],
): ImportedAttachmentFailure | null {
  const rawHash = hash.slice("sha256:".length);
  if (imported.metadata.sha256 !== rawHash || imported.metadata.byteSize !== expectedBytes) {
    return "metadata-mismatch";
  }
  if (
    imported.metadata.mimeType !== "model/vrm"
    || imported.blob.type !== "model/vrm"
    || !imported.metadata.kinds.includes("vrm")
  ) {
    return "mime-mismatch";
  }
  const authenticatedPointers = new Set(
    imported.metadata.documentReferences
      .filter((reference) =>
        reference.usage === "vrm" && reference.mode === "sha256-prefixed"
      )
      .map(({ pointer }) => pointer),
  );
  return references.every(({ pointer }) => authenticatedPointers.has(pointer))
    ? null
    : "metadata-mismatch";
}

function diagnosticForImportedFailure(
  hash: VrmContentHash,
  pointers: readonly string[],
  failure: ImportedAttachmentFailure,
): StudioVrmProjectLibraryDiagnostic {
  const details: Record<ImportedAttachmentFailure, {
    code: StudioVrmProjectLibraryDiagnosticCode;
    message: string;
  }> = {
    "bytes-invalid": {
      code: "ATTACHMENT_BYTES_INVALID",
      message: "archive의 VRM attachment가 GLB/VRM 안전 검사를 통과하지 못했습니다.",
    },
    "hash-mismatch": {
      code: "ATTACHMENT_HASH_MISMATCH",
      message: "archive VRM attachment의 실제 SHA-256이 장면 문서와 일치하지 않습니다.",
    },
    "metadata-mismatch": {
      code: "ATTACHMENT_METADATA_MISMATCH",
      message: "archive VRM attachment가 장면 문서의 모델 해시 위치와 안전하게 연결되지 않았습니다.",
    },
    "mime-mismatch": {
      code: "ATTACHMENT_MIME_MISMATCH",
      message: "archive attachment의 kind 또는 MIME이 VRM 계약과 일치하지 않습니다.",
    },
    missing: {
      code: "ATTACHMENT_MISSING",
      message: "가져온 archive에 장면이 사용하는 VRM attachment가 없습니다.",
    },
    "size-mismatch": {
      code: "ATTACHMENT_METADATA_MISMATCH",
      message: "archive VRM attachment의 실제 크기가 장면 문서와 일치하지 않습니다.",
    },
  };
  return { ...details[failure], hash, pointers };
}

/**
 * Authenticates only VRM attachments referenced by the imported project. This phase is deliberately
 * read-only: blobs stay in this bounded in-memory plan until the caller reaches the exact project
 * mutation seam. Local storage is never opened here because a cold SQLite open may migrate schema;
 * verified local reuse is resolved only at final commit.
 */
export async function restoreStudioVrmProjectArchiveImport(
  archive: ImportStudioProjectArchiveResult,
  dependencyOverrides: Partial<StudioVrmProjectLibraryDependencies> = {},
): Promise<RestoreStudioVrmProjectArchiveImportResult> {
  const dependencies = resolveDependencies(dependencyOverrides);
  // Snapshot both authenticated variants before the first await. Raster rehydration may differ,
  // but every complete VRM scene (including bundled scenes) must remain byte-for-byte canonical.
  const canonicalSnapshot = snapshotProjectVrmReferences(archive.canonicalProject);
  const projectSnapshot = snapshotProjectVrmReferences(archive.project);
  if (!sceneSnapshotsMatch(canonicalSnapshot, projectSnapshot)) {
    throw new StudioVrmProjectLibraryError("import-project-mismatch");
  }

  const grouped = groupReferences(canonicalSnapshot.references);
  const prepared: PreparedStudioVrmProjectArchiveModel[] = [];
  const reused: Array<{ hash: VrmContentHash; modelId: string }> = [];
  const unresolved: VrmContentHash[] = [];
  const diagnostics: StudioVrmProjectLibraryDiagnostic[] = [];

  for (const [hash, references] of grouped) {
    const pointers = references.map(({ pointer }) => pointer);
    if (metadataConflict(references)) {
      unresolved.push(hash);
      diagnostics.push({
        code: "LOCAL_MODEL_METADATA_CONFLICT",
        message: "같은 VRM 해시를 참조하는 장면들의 모델 크기 또는 MIME 정보가 충돌합니다.",
        hash,
        pointers,
      });
      continue;
    }
    const expectedBytes = references[0]?.model.byteSize;
    if (!expectedBytes) {
      unresolved.push(hash);
      diagnostics.push({
        code: "LOCAL_MODEL_METADATA_CONFLICT",
        message: "VRM 장면의 모델 크기 정보가 올바르지 않습니다.",
        hash,
        pointers,
      });
      continue;
    }
    const pending = {
      hash,
      expectedBytes,
      name: references[0]?.model.name ?? "VRM 모델",
    };
    const imported = archive.attachments.get(hash.slice("sha256:".length));
    if (!imported) {
      unresolved.push(hash);
      diagnostics.push(diagnosticForImportedFailure(hash, pointers, "missing"));
      prepared.push(Object.freeze({ ...pending, blob: null }));
      continue;
    }
    const coverageFailure = attachmentCoversAllReferences(
      imported,
      hash,
      expectedBytes,
      references,
    );
    if (coverageFailure) {
      unresolved.push(hash);
      diagnostics.push(diagnosticForImportedFailure(hash, pointers, coverageFailure));
      prepared.push(Object.freeze({ ...pending, blob: null }));
      continue;
    }
    const byteVerification = await verifyVrmBlob(
      imported.blob,
      hash,
      expectedBytes,
      dependencies,
    );
    if (byteVerification.failure) {
      unresolved.push(hash);
      diagnostics.push(diagnosticForImportedFailure(
        hash,
        pointers,
        byteVerification.failure,
      ));
      prepared.push(Object.freeze({ ...pending, blob: null }));
      continue;
    }
    prepared.push(Object.freeze({
      ...pending,
      blob: imported.blob,
    }));
  }

  const result: RestoreStudioVrmProjectArchiveImportResult = Object.freeze({
    project: projectSnapshot.project,
    canonicalProject: canonicalSnapshot.project,
    prepared: Object.freeze(prepared),
    reused: Object.freeze(reused),
    unresolved: Object.freeze(unresolved),
    diagnostics: Object.freeze(diagnostics),
  });
  PREPARED_IMPORTS.add(result);
  return result;
}

interface CreatedStudioVrmImportRow {
  readonly hash: VrmContentHash;
  readonly modelId: string;
}

async function rollbackCreatedStudioVrmImportRows(
  rows: readonly CreatedStudioVrmImportRow[],
  dependencies: StudioVrmProjectLibraryDependencies,
): Promise<void> {
  const failures: unknown[] = [];
  for (const row of [...rows].reverse()) {
    try {
      // False is a safe no-op: the exact created id+hash pair is already absent or no longer
      // matches. In either case compensation did not delete someone else's row.
      await dependencies.deleteStoredIfIdentityMatches(row.modelId, row.hash);
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "프로젝트 적용 실패 뒤 새로 만든 VRM 원본 일부를 안전하게 되돌리지 못했습니다.",
    );
  }
}

async function verifyCommittedStudioVrmRow(
  disposition: SaveVerifiedVrmBlobDisposition,
  model: PreparedStudioVrmProjectArchiveModel,
  dependencies: StudioVrmProjectLibraryDependencies,
): Promise<VrmStoredModelWithContentIdentity | null> {
  let verified: VrmStoredModelWithContentIdentity;
  try {
    verified = await dependencies.ensureStoredIdentity(disposition.record);
  } catch {
    return null;
  }
  if (
    canonicalizeVrmContentHash(verified.contentHash) !== model.hash
    || verified.byteSize !== model.expectedBytes
    || verified.mimeType !== "model/gltf-binary"
    || verified.validationVersion !== VRM_VALIDATION_VERSION
  ) return null;
  const blobVerification = await verifyVrmBlob(
    verified.blob,
    model.hash,
    model.expectedBytes,
    dependencies,
  );
  return blobVerification.failure ? null : verified;
}

/**
 * Commits a read-only import plan at the final mutation seam and then applies the project. If the
 * downstream apply is rejected or throws, compensation compares both the newly-created private id
 * and its canonical hash. Deduplicated/pre-existing rows are never eligible for deletion.
 */
export async function installPreparedStudioVrmProjectArchiveImportAndApply<ApplyResult>(
  preparedImport: RestoreStudioVrmProjectArchiveImportResult,
  project: StudioProjectFile | unknown,
  applyProject: (project: StudioProjectFile) => ApplyResult | Promise<ApplyResult>,
  options: InstallStudioVrmProjectArchiveImportOptions<ApplyResult>,
  dependencyOverrides: Partial<StudioVrmProjectLibraryDependencies> = {},
): Promise<InstallStudioVrmProjectArchiveImportResult<ApplyResult>> {
  if (!PREPARED_IMPORTS.has(preparedImport)) {
    throw new StudioVrmProjectLibraryError("import-plan-invalid");
  }
  const dependencies = resolveDependencies(dependencyOverrides);
  const applySnapshot = snapshotProjectVrmReferences(project);
  const preparedSnapshot = snapshotProjectVrmReferences(preparedImport.project);
  if (!sceneSnapshotsMatch(preparedSnapshot, applySnapshot)) {
    throw new StudioVrmProjectLibraryError("import-project-mismatch");
  }
  // A prepared Blob plan is mutation-scoped and one-shot; retrying requires a fresh authenticated
  // archive read so callers cannot replay stale bytes after a failed route/application attempt.
  PREPARED_IMPORTS.delete(preparedImport);

  const installed: CreatedStudioVrmImportRow[] = [];
  const reused: Array<{ hash: VrmContentHash; modelId: string }> = [];
  const unresolved = [...preparedImport.unresolved];
  const diagnostics = [...preparedImport.diagnostics];
  try {
    for (const model of preparedImport.prepared) {
      const existing = await resolveVerifiedStoredModel(
        model.hash,
        model.expectedBytes,
        dependencies,
      );
      if (existing.match) {
        reused.push({ hash: model.hash, modelId: existing.match.record.id });
        const unresolvedIndex = unresolved.indexOf(model.hash);
        if (unresolvedIndex >= 0) unresolved.splice(unresolvedIndex, 1);
        for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
          if (diagnostics[index]?.hash === model.hash) diagnostics.splice(index, 1);
        }
        continue;
      }

      if (!model.blob) continue;

      let disposition: SaveVerifiedVrmBlobDisposition;
      try {
        disposition = await dependencies.saveVerifiedBlobWithDisposition({
          name: model.name,
          blob: model.blob,
          expectedHash: model.hash,
        });
      } catch (cause) {
        throw new StudioVrmProjectLibraryError("import-commit-failed", { cause });
      }
      if (disposition.created) {
        // Register before post-write verification so every newly rooted row is compensatable.
        installed.push({ hash: model.hash, modelId: disposition.record.id });
      }
      const verified = await verifyCommittedStudioVrmRow(disposition, model, dependencies);
      if (!verified) throw new StudioVrmProjectLibraryError("import-commit-failed");
      if (!disposition.created) {
        reused.push({ hash: model.hash, modelId: verified.id });
      } else if (verified.id !== disposition.record.id) {
        throw new StudioVrmProjectLibraryError("import-commit-failed");
      }
    }

    const applyResult = await applyProject(applySnapshot.project);
    if (!options.didApply(applyResult)) {
      await rollbackCreatedStudioVrmImportRows(installed, dependencies);
      installed.length = 0;
    }
    return {
      project: applySnapshot.project,
      installed: Object.freeze([...installed]),
      reused: Object.freeze(reused),
      unresolved: Object.freeze(unresolved),
      diagnostics: Object.freeze(diagnostics),
      applyResult,
    };
  } catch (cause) {
    try {
      await rollbackCreatedStudioVrmImportRows(installed, dependencies);
    } catch (rollbackCause) {
      throw new AggregateError(
        [cause, rollbackCause],
        "VRM archive 가져오기와 정확한 보상을 모두 완료하지 못했습니다.",
        { cause: rollbackCause },
      );
    }
    throw cause;
  }
}
