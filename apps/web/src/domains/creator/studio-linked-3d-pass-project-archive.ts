/**
 * Portable archive bridge for Canvas-linked 3D line passes.
 *
 * Project JSON keeps the strict OPFS locator and content receipt. The ZIP carries the authenticated
 * PNG once per digest, while import restores that byte identity into the product OPFS CAS before a
 * caller can apply the document. An arbitrary `studio-opfs-cas:` string never becomes portable.
 */

import {
  inspectStudioLinked3dPassPng,
  parseStudioLinked3dPassLocator,
  sequenceStudioLinked3dPassOwnerMutation,
  type StudioLinked3dPassCasAuthority,
} from "./studio-linked-3d-pass-transaction";
import { parseStudioLinked3dRenderDocument } from "./studio-linked-3d-render-document";
import { sha256HexPortable } from "./studio-sha256";

import type {
  ImportStudioProjectArchiveResult,
  StudioProjectArchiveAttachmentInput,
  StudioProjectArchiveImportedAttachment,
  StudioProjectArchiveLimits,
  StudioProjectArchiveManifestAttachment,
} from "./studio-project-archive";
import type { StudioProjectFile } from "./studio-project-file";

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const ARCHIVE_RASTER_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/iu;
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
// Keep these hard ceilings aligned with STUDIO_PROJECT_ARCHIVE_LIMITS without introducing the
// project-archive -> linked-pass -> project-archive value-import cycle.
const LINKED_3D_PASS_ARCHIVE_HARD_LIMITS = Object.freeze({
  maxAttachmentBytes: 96_000_000,
  maxAttachments: 512,
  maxTotalAttachmentBytes: 256_000_000,
});

type StudioLinked3dPassArchiveLimits = Pick<
  StudioProjectArchiveLimits,
  "maxAttachmentBytes" | "maxAttachments" | "maxTotalAttachmentBytes"
>;

interface StudioLinked3dPassArchiveStatEntry {
  readonly hash: string;
  readonly bytes: number;
  readonly mime: string;
}

interface StudioLinked3dPassArchiveStatAuthority {
  stat(hash: string): Promise<StudioLinked3dPassArchiveStatEntry | null>;
}

export type StudioLinked3dPassProjectArchiveGuardPhase =
  | "before-stat"
  | "after-stat"
  | "before-get"
  | "after-get"
  | "before-return";

export interface StudioLinked3dPassProjectArchiveGuard {
  readonly phase: StudioLinked3dPassProjectArchiveGuardPhase;
  readonly contentHash?: `sha256:${string}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface StudioLinked3dPassProjectArchiveReference {
  readonly pageId: string;
  readonly bundleId: string;
  readonly ownerId: string;
  readonly contentHash: `sha256:${string}`;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly locator: `studio-opfs-cas:sha256:${string}`;
  readonly contentHashPointer: string;
  readonly locatorPointer: string;
  readonly canvasSourcePointer: string;
}

export interface StudioLinked3dPassProjectArchiveEvidence {
  readonly sha256: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly kinds: readonly string[];
  readonly documentReferences: readonly {
    readonly pointer: string;
    readonly usage: string;
    readonly mode?: string;
  }[];
}

export class StudioLinked3dPassProjectArchiveError extends Error {
  public constructor(
    public readonly code:
      | "invalid-project"
      | "attachment-missing"
      | "attachment-mismatch"
      | "attachment-limit"
      | "aborted"
      | "stale"
      | "opfs-unavailable"
      | "commit-rejected",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioLinked3dPassProjectArchiveError";
  }
}

function archiveError(
  code: StudioLinked3dPassProjectArchiveError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new StudioLinked3dPassProjectArchiveError(code, message, cause);
}

function rawHash(hash: `sha256:${string}`): string {
  return hash.slice("sha256:".length);
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function positiveBoundedLimit(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > fallback) {
    archiveError("attachment-limit", `${label}가 portable archive 안전 범위를 벗어났습니다.`);
  }
  return resolved;
}

function resolveArchiveLimits(
  value: Partial<StudioLinked3dPassArchiveLimits> | undefined,
): StudioLinked3dPassArchiveLimits {
  return Object.freeze({
    maxAttachmentBytes: positiveBoundedLimit(
      value?.maxAttachmentBytes,
      LINKED_3D_PASS_ARCHIVE_HARD_LIMITS.maxAttachmentBytes,
      "연결형 3D pass 개별 attachment 한도",
    ),
    maxAttachments: positiveBoundedLimit(
      value?.maxAttachments,
      LINKED_3D_PASS_ARCHIVE_HARD_LIMITS.maxAttachments,
      "연결형 3D pass attachment 수 한도",
    ),
    maxTotalAttachmentBytes: positiveBoundedLimit(
      value?.maxTotalAttachmentBytes,
      LINKED_3D_PASS_ARCHIVE_HARD_LIMITS.maxTotalAttachmentBytes,
      "연결형 3D pass attachment 합계 한도",
    ),
  });
}

function nonNegativeSafeInteger(value: number | undefined, label: string): number {
  const resolved = value ?? 0;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    archiveError("attachment-limit", `${label}가 올바르지 않습니다.`);
  }
  return resolved;
}

function checkedAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    archiveError("attachment-limit", `${label} 합계를 안전하게 계산할 수 없습니다.`);
  }
  return total;
}

function rasterDataUrlByteSize(value: string): number | null {
  const match = ARCHIVE_RASTER_DATA_URL_PATTERN.exec(value);
  if (!match) return null;
  const base64 = match[1]!;
  if (base64.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(base64)) {
    archiveError("invalid-project", "portable archive raster data URL의 Base64 receipt가 올바르지 않습니다.");
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteSize = (base64.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    archiveError("invalid-project", "portable archive raster data URL의 byte receipt가 올바르지 않습니다.");
  }
  return byteSize;
}

/** Mirrors the archive builder's per-candidate accounting without decoding or retaining bytes. */
function embeddedRasterAttachmentBudget(
  project: StudioProjectFile,
  limits: StudioLinked3dPassArchiveLimits,
): { readonly bytes: number; readonly count: number } {
  const pending: unknown[] = [project];
  const visited = new WeakSet<object>();
  let bytes = 0;
  let count = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      const byteSize = rasterDataUrlByteSize(value);
      if (byteSize === null) continue;
      if (byteSize > limits.maxAttachmentBytes) {
        archiveError("attachment-limit", "inline raster가 개별 attachment 안전 한도를 넘었습니다.");
      }
      bytes = checkedAdd(bytes, byteSize, "inline raster attachment byte 수");
      count = checkedAdd(count, 1, "inline raster attachment 수");
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) pending.push(...value);
    else if (isRecord(value)) pending.push(...Object.values(value));
  }
  return Object.freeze({ bytes, count });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    archiveError("aborted", "연결형 3D pass archive 내보내기가 취소되었습니다.", signal.reason);
  }
}

async function assertCurrent(
  input: {
    readonly signal?: AbortSignal;
    readonly isCurrent?: (
      guard: StudioLinked3dPassProjectArchiveGuard,
    ) => boolean | Promise<boolean>;
  },
  phase: StudioLinked3dPassProjectArchiveGuardPhase,
  contentHash?: `sha256:${string}`,
): Promise<void> {
  throwIfAborted(input.signal);
  if (!input.isCurrent) return;
  let current: boolean;
  try {
    current = await input.isCurrent(Object.freeze({
      phase,
      ...(contentHash === undefined ? {} : { contentHash }),
    }));
  } catch (cause) {
    throwIfAborted(input.signal);
    archiveError("stale", "연결형 3D pass archive 범위의 최신 상태를 확인하지 못했습니다.", cause);
  }
  throwIfAborted(input.signal);
  if (!current) {
    archiveError("stale", "프로젝트 세대가 바뀌어 오래된 연결형 3D pass archive를 폐기했습니다.");
  }
}

function assertReferenceReceiptsAgree(
  references: readonly StudioLinked3dPassProjectArchiveReference[],
): void {
  const first = references[0];
  if (!first) archiveError("invalid-project", "연결형 3D pass attachment 참조가 비어 있습니다.");
  if (references.some((reference) => (
    reference.byteSize !== first.byteSize
    || reference.width !== first.width
    || reference.height !== first.height
    || reference.locator !== first.locator
  ))) {
    archiveError(
      "attachment-mismatch",
      "같은 연결형 3D pass SHA-256을 가리키는 프로젝트 receipt가 서로 다릅니다.",
    );
  }
}

function assertPngBytes(
  bytes: Uint8Array,
  reference: StudioLinked3dPassProjectArchiveReference,
): void {
  if (
    bytes.byteLength !== reference.byteSize
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
    || hashBytes(bytes) !== reference.contentHash
  ) {
    archiveError(
      "attachment-mismatch",
      "연결형 3D line pass PNG가 프로젝트의 크기·signature·SHA-256 receipt와 다릅니다.",
    );
  }
  const header = inspectStudioLinked3dPassPng(bytes);
  if (!header || header.width !== reference.width || header.height !== reference.height) {
    archiveError(
      "attachment-mismatch",
      "연결형 3D line pass PNG의 실제 IHDR 크기가 프로젝트 receipt와 다릅니다.",
    );
  }
}

function immutablePngBlob(bytes: Uint8Array): Blob {
  const wholeArrayBuffer = bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : Uint8Array.from(bytes).buffer;
  return new Blob([wholeArrayBuffer], { type: "image/png" });
}

export function collectStudioLinked3dPassProjectArchiveReferences(
  project: StudioProjectFile,
): readonly StudioLinked3dPassProjectArchiveReference[] {
  const references: StudioLinked3dPassProjectArchiveReference[] = [];
  for (let pageIndex = 0; pageIndex < project.pagesList.length; pageIndex += 1) {
    const page = project.pagesList[pageIndex]!;
    if (page.linked3dRender === undefined) continue;
    const document = parseStudioLinked3dRenderDocument(page.linked3dRender);
    if (!document) {
      archiveError("invalid-project", "연결형 3D render receipt가 손상되어 portable archive를 만들 수 없습니다.");
    }
    for (let linkIndex = 0; linkIndex < document.links.length; linkIndex += 1) {
      const link = document.links[linkIndex]!;
      const artifact = link.passRevision.artifact;
      if (parseStudioLinked3dPassLocator(artifact.locator) !== artifact.contentHash) {
        archiveError("invalid-project", "연결형 3D line pass locator가 receipt SHA-256과 다릅니다.");
      }
      const base = `/pagesList/${pageIndex}/linked3dRender/links/${linkIndex}/passRevision/artifact`;
      const mainLineElementId = link.layers.find(({ role }) => role === "main-line")?.elementId;
      const mainLineElementIndex = page.elements.findIndex((element) =>
        isRecord(element) && element.id === mainLineElementId);
      const mainLineElement = page.elements[mainLineElementIndex];
      if (
        mainLineElementIndex < 0
        || !isRecord(mainLineElement)
        || mainLineElement.src !== artifact.locator
      ) {
        archiveError("invalid-project", "연결형 3D line pass가 canonical Canvas source와 다릅니다.");
      }
      references.push(Object.freeze({
        pageId: page.id,
        bundleId: link.bundleId,
        ownerId: `studio-linked-3d-pass:${page.id}:${link.bundleId}`,
        contentHash: artifact.contentHash,
        byteSize: artifact.byteSize,
        width: artifact.width,
        height: artifact.height,
        locator: artifact.locator,
        contentHashPointer: `${base}/contentHash`,
        locatorPointer: `${base}/locator`,
        canvasSourcePointer: `/pagesList/${pageIndex}/elements/${mainLineElementIndex}/src`,
      }));
    }
  }
  return Object.freeze(references);
}

export function hasStudioLinked3dPassProjectArchiveReferences(project: StudioProjectFile): boolean {
  return collectStudioLinked3dPassProjectArchiveReferences(project).length > 0;
}

function evidenceByHash(
  evidence: readonly StudioLinked3dPassProjectArchiveEvidence[],
): ReadonlyMap<string, StudioLinked3dPassProjectArchiveEvidence> {
  const result = new Map<string, StudioLinked3dPassProjectArchiveEvidence>();
  for (const item of evidence) result.set(item.sha256, item);
  return result;
}

export function assertStudioLinked3dPassProjectArchiveEvidence(
  project: StudioProjectFile,
  evidence: readonly StudioLinked3dPassProjectArchiveEvidence[],
): ReadonlySet<string> {
  const coveredLocatorPointers = new Set<string>();
  const byHash = evidenceByHash(evidence);
  for (const reference of collectStudioLinked3dPassProjectArchiveReferences(project)) {
    const attachment = byHash.get(rawHash(reference.contentHash));
    const hasExactReference = attachment?.documentReferences.some((candidate) =>
      candidate.pointer === reference.contentHashPointer
      && candidate.usage === "raster"
      && candidate.mode === "sha256-prefixed") === true;
    if (!attachment) {
      archiveError("attachment-missing", "portable archive에 연결형 3D line pass PNG가 없습니다.");
    }
    if (
      attachment.byteSize !== reference.byteSize
      || attachment.mimeType !== "image/png"
      || !attachment.kinds.includes("raster")
      || !hasExactReference
    ) {
      archiveError("attachment-mismatch", "연결형 3D line pass attachment receipt가 프로젝트와 다릅니다.");
    }
    coveredLocatorPointers.add(reference.locatorPointer);
    coveredLocatorPointers.add(reference.canvasSourcePointer);
  }
  return coveredLocatorPointers;
}

export async function prepareStudioLinked3dPassProjectArchiveExport(input: {
  readonly project: StudioProjectFile;
  readonly authority: StudioLinked3dPassCasAuthority & Partial<
    StudioLinked3dPassArchiveStatAuthority
  >;
  readonly limits?: Partial<StudioLinked3dPassArchiveLimits>;
  /** Attachment inputs already prepared by other archive bridges in this export. */
  readonly consumedAttachmentBytes?: number;
  readonly consumedAttachmentCount?: number;
  readonly signal?: AbortSignal;
  /** Caller-owned route/project generation fence. */
  readonly isCurrent?: (
    guard: StudioLinked3dPassProjectArchiveGuard,
  ) => boolean | Promise<boolean>;
}): Promise<readonly StudioProjectArchiveAttachmentInput[]> {
  throwIfAborted(input.signal);
  if (input.authority.kind !== "opfs") {
    archiveError("opfs-unavailable", "연결형 3D line pass를 내보내려면 durable OPFS CAS가 필요합니다.");
  }
  if (typeof input.authority.stat !== "function") {
    archiveError(
      "opfs-unavailable",
      "연결형 3D line pass를 내보내려면 receipt를 사전 검증할 수 있는 OPFS CAS가 필요합니다.",
    );
  }
  const limits = resolveArchiveLimits(input.limits);
  const consumedAttachmentBytes = nonNegativeSafeInteger(
    input.consumedAttachmentBytes,
    "이미 준비된 attachment byte 수",
  );
  const consumedAttachmentCount = nonNegativeSafeInteger(
    input.consumedAttachmentCount,
    "이미 준비된 attachment 수",
  );
  const grouped = new Map<`sha256:${string}`, StudioLinked3dPassProjectArchiveReference[]>();
  for (const reference of collectStudioLinked3dPassProjectArchiveReferences(input.project)) {
    const group = grouped.get(reference.contentHash) ?? [];
    group.push(reference);
    grouped.set(reference.contentHash, group);
  }
  const sortedGroups = [...grouped].sort(([left], [right]) => left.localeCompare(right));
  const embeddedAttachmentBudget = embeddedRasterAttachmentBudget(input.project, limits);
  const totalAttachmentCount = checkedAdd(
    checkedAdd(
      consumedAttachmentCount,
      embeddedAttachmentBudget.count,
      "이미 준비된 portable archive attachment 수",
    ),
    sortedGroups.length,
    "portable archive attachment 수",
  );
  if (totalAttachmentCount > limits.maxAttachments) {
    archiveError("attachment-limit", "프로젝트 attachment 수가 portable archive 안전 한도를 넘었습니다.");
  }
  let admittedAttachmentBytes = checkedAdd(
    consumedAttachmentBytes,
    embeddedAttachmentBudget.bytes,
    "이미 준비된 portable archive attachment byte 수",
  );
  if (admittedAttachmentBytes > limits.maxTotalAttachmentBytes) {
    archiveError("attachment-limit", "이미 준비된 프로젝트 attachment 합계가 안전 한도를 넘었습니다.");
  }
  for (const [, references] of sortedGroups) {
    assertReferenceReceiptsAgree(references);
    const byteSize = references[0]!.byteSize;
    if (byteSize <= 0 || byteSize > limits.maxAttachmentBytes) {
      archiveError("attachment-limit", "연결형 3D pass PNG가 개별 attachment 한도를 넘었습니다.");
    }
    admittedAttachmentBytes = checkedAdd(
      admittedAttachmentBytes,
      byteSize,
      "portable archive attachment byte 수",
    );
    if (admittedAttachmentBytes > limits.maxTotalAttachmentBytes) {
      archiveError("attachment-limit", "프로젝트 attachment 입력 합계가 안전 한도를 넘었습니다.");
    }
  }

  // Verify every receipt through metadata-only OPFS reads before the first potentially large get.
  // This prevents a late stat failure from retaining an already materialized prefix of PNGs.
  for (const [contentHash, references] of sortedGroups) {
    await assertCurrent(input, "before-stat", contentHash);
    let entry: StudioLinked3dPassArchiveStatEntry | null;
    try {
      entry = await input.authority.stat(contentHash);
    } catch (cause) {
      throwIfAborted(input.signal);
      archiveError("opfs-unavailable", "OPFS CAS의 연결형 3D pass receipt를 읽지 못했습니다.", cause);
    }
    await assertCurrent(input, "after-stat", contentHash);
    if (!entry) archiveError("attachment-missing", "OPFS CAS에서 연결형 3D line pass PNG를 찾지 못했습니다.");
    if (
      entry.hash !== contentHash
      || entry.bytes !== references[0]!.byteSize
      || entry.mime !== "image/png"
    ) {
      archiveError("attachment-mismatch", "OPFS CAS receipt가 프로젝트의 연결형 3D pass receipt와 다릅니다.");
    }
  }

  const attachments: StudioProjectArchiveAttachmentInput[] = [];
  for (const [contentHash, references] of sortedGroups) {
    await assertCurrent(input, "before-get", contentHash);
    let bytes: Uint8Array | null;
    try {
      bytes = await input.authority.get(contentHash, { verify: true });
    } catch (cause) {
      throwIfAborted(input.signal);
      archiveError("opfs-unavailable", "OPFS CAS의 연결형 3D line pass PNG를 읽지 못했습니다.", cause);
    }
    await assertCurrent(input, "after-get", contentHash);
    if (!bytes) archiveError("attachment-missing", "OPFS CAS에서 연결형 3D line pass PNG를 찾지 못했습니다.");
    for (const reference of references) assertPngBytes(bytes, reference);
    attachments.push(Object.freeze({
      kind: "raster" as const,
      // Blob is the archive source's immutable attachment seam. It avoids retaining both the CAS
      // Uint8Array and an additional Uint8Array.from snapshot for every linked pass.
      data: immutablePngBlob(bytes),
      mimeType: "image/png",
      documentReferences: Object.freeze(references
        .map((reference) => Object.freeze({
          pointer: reference.contentHashPointer,
          usage: "raster" as const,
          mode: "sha256-prefixed" as const,
        }))
        .toSorted((left, right) => left.pointer.localeCompare(right.pointer))),
    }));
  }
  await assertCurrent(input, "before-return");
  return Object.freeze(attachments);
}

function importedEvidence(
  attachments: ReadonlyMap<string, StudioProjectArchiveImportedAttachment>,
): StudioLinked3dPassProjectArchiveEvidence[] {
  return [...attachments.values()].map(({ metadata }) => metadata);
}

async function lockOwners<T>(
  authority: StudioLinked3dPassCasAuthority,
  owners: readonly string[],
  index: number,
  task: () => Promise<T>,
): Promise<T> {
  const owner = owners[index];
  if (!owner) return await task();
  return await sequenceStudioLinked3dPassOwnerMutation(
    authority,
    owner,
    async () => await lockOwners(authority, owners, index + 1, task),
  );
}

/** Restore authenticated archive PNGs and apply the document under the same owner-ref fence. */
export async function restoreStudioLinked3dPassProjectArchiveImport<T>(input: {
  readonly archive: Pick<ImportStudioProjectArchiveResult, "project" | "attachments">;
  readonly authority: StudioLinked3dPassCasAuthority;
  readonly apply: (project: StudioProjectFile) => T | false | Promise<T | false>;
}): Promise<T> {
  if (input.authority.kind !== "opfs") {
    archiveError("opfs-unavailable", "연결형 3D line pass를 복원하려면 durable OPFS CAS가 필요합니다.");
  }
  const references = collectStudioLinked3dPassProjectArchiveReferences(input.archive.project);
  assertStudioLinked3dPassProjectArchiveEvidence(
    input.archive.project,
    importedEvidence(input.archive.attachments),
  );
  const referencesByHash = new Map<`sha256:${string}`, StudioLinked3dPassProjectArchiveReference[]>();
  for (const reference of references) {
    const group = referencesByHash.get(reference.contentHash) ?? [];
    group.push(reference);
    referencesByHash.set(reference.contentHash, group);
  }
  for (const [contentHash, hashReferences] of referencesByHash) {
    const attachment = input.archive.attachments.get(rawHash(contentHash));
    if (!attachment) archiveError("attachment-missing", "archive line pass attachment를 찾지 못했습니다.");
    const bytes = new Uint8Array(await attachment.blob.arrayBuffer());
    for (const reference of hashReferences) assertPngBytes(bytes, reference);
    const put = await input.authority.put(bytes, { mime: "image/png" });
    const verified = await input.authority.get(contentHash, { verify: true });
    if (
      put.ref.hash !== contentHash
      || put.ref.bytes !== bytes.byteLength
      || put.ref.mime !== "image/png"
      || !verified
      || hashBytes(verified) !== contentHash
    ) {
      archiveError("attachment-mismatch", "archive line pass를 OPFS CAS에 정확히 복원하지 못했습니다.");
    }
  }

  const desiredByOwner = new Map<string, Set<string>>();
  for (const reference of references) {
    const desired = desiredByOwner.get(reference.ownerId) ?? new Set<string>();
    desired.add(reference.contentHash);
    desiredByOwner.set(reference.ownerId, desired);
  }
  const owners = [...desiredByOwner.keys()].toSorted();
  return await lockOwners(input.authority, owners, 0, async () => {
    const previous = new Map<string, readonly string[]>();
    const updated: string[] = [];
    try {
      for (const owner of owners) {
        const ownerRefs = await input.authority.ownerRefs(owner);
        previous.set(owner, ownerRefs);
        // A durable authority may update its in-memory/index state and then lose the publication
        // acknowledgement. Track the attempted owner before awaiting so commit-outcome-unknown is
        // compensated just like an acknowledged publication.
        updated.push(owner);
        await input.authority.setOwnerRefs(owner, [...new Set([
          ...ownerRefs,
          ...(desiredByOwner.get(owner) ?? []),
        ])].toSorted());
      }
      const result = await input.apply(input.archive.project);
      if (result === false) archiveError("commit-rejected", "Studio가 복원된 3D pass 문서 적용을 거절했습니다.");
      return result;
    } catch (cause) {
      const rollbackFailures: unknown[] = [];
      // Restore in strict reverse publication order. Continue after one owner fails so the maximum
      // recoverable prefix is restored, but never report the archive import as atomic/successful.
      for (const owner of updated.toReversed()) {
        try {
          await input.authority.setOwnerRefs(owner, previous.get(owner) ?? []);
        } catch (rollbackCause) {
          rollbackFailures.push(rollbackCause);
        }
      }
      if (rollbackFailures.length > 0) {
        throw new AggregateError(
          [cause, ...rollbackFailures],
          "연결형 3D pass 문서 적용 실패 뒤 owner 참조 일부를 되돌리지 못했습니다.",
          { cause },
        );
      }
      throw cause;
    }
  });
}

export function studioLinked3dPassArchiveEvidenceFromManifest(
  attachments: readonly StudioProjectArchiveManifestAttachment[],
): readonly StudioLinked3dPassProjectArchiveEvidence[] {
  return attachments;
}
