/**
 * Cross-device bridge for canonical Canvas-linked 3D line passes.
 *
 * Project JSON remains authoritative and keeps its strict OPFS locator. The immutable work-asset
 * lane carries one authenticated PNG per content hash; hydration restores that exact identity to
 * OPFS before owner references and the project are committed under the existing transaction fence.
 */

import {
  collectStudioLinked3dPassProjectArchiveReferences,
  type StudioLinked3dPassProjectArchiveReference,
} from "./studio-linked-3d-pass-project-archive";
import {
  inspectStudioLinked3dPassPng,
  parseStudioLinked3dPassLocator,
  sequenceStudioLinked3dPassOwnerMutation,
  type StudioLinked3dPassArtifactDescriptor,
  type StudioLinked3dPassCasAuthority,
} from "./studio-linked-3d-pass-transaction";
import { sha256HexPortable } from "./studio-sha256";
import {
  deleteUnreferencedStudioWorkAssetUpload,
  downloadStudioWorkAsset,
  uploadStudioWorkAsset,
  type DownloadedStudioWorkAsset,
  type StudioWorkAssetReference,
} from "./studio-work-asset-client";

import type { StudioProjectFile } from "./studio-project-file";

import {
  parseStudioWorkAssetDescriptor,
  serializeStudioWorkAssetDescriptorCanonical,
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
  STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE,
  STUDIO_WORK_ASSET_MAX_IMAGE_AXIS,
  STUDIO_WORK_ASSET_MAX_IMAGE_PIXELS,
  STUDIO_WORK_ASSET_MAX_TOTAL_BYTES_PER_WORK,
  StudioWorkAssetManifestSchema,
  type StudioWorkAssetDescriptor,
  type StudioWorkAssetManifest,
} from "@/shared/lib/studio-work-asset-contract";

export const STUDIO_LINKED_3D_PASS_CLOUD_ASSET_ID_PREFIX =
  "linked3d-pass-sha256-" as const;
export const STUDIO_LINKED_3D_PASS_CLOUD_DEFAULT_MAXIMUM_CONCURRENCY = 3;
export const STUDIO_LINKED_3D_PASS_CLOUD_MAXIMUM_CONCURRENCY = 8;

const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/u;

export class StudioLinked3dPassCloudSyncError extends Error {
  public constructor(
    public readonly code:
      | "invalid-input"
      | "invalid-project"
      | "unsupported-artifact"
      | "opfs-unavailable"
      | "artifact-missing"
      | "artifact-mismatch"
      | "manifest-mismatch"
      | "commit-rejected",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioLinked3dPassCloudSyncError";
  }
}

export type UploadStudioLinked3dPassCloudAsset = (
  workId: string,
  reference: StudioWorkAssetReference,
  descriptor: StudioWorkAssetDescriptor,
  file: Blob,
  signal?: AbortSignal,
) => Promise<StudioWorkAssetManifest>;

export type DownloadStudioLinked3dPassCloudAsset = (
  workId: string,
  reference: StudioWorkAssetReference,
  signal?: AbortSignal,
) => Promise<DownloadedStudioWorkAsset>;

export type CleanupStudioLinked3dPassCloudAsset = (
  workId: string,
  reference: StudioWorkAssetReference,
  expectedSha256: string,
  signal?: AbortSignal,
) => Promise<boolean>;

export interface StudioLinked3dPassCloudUploadReceipt {
  readonly contentHash: `sha256:${string}`;
  readonly reference: StudioWorkAssetReference;
  readonly manifest: StudioWorkAssetManifest;
  readonly ownerIds: readonly string[];
}

interface StudioLinked3dPassCloudPlan {
  readonly artifact: StudioLinked3dPassArtifactDescriptor;
  readonly descriptor: StudioWorkAssetDescriptor;
  readonly reference: StudioWorkAssetReference;
  readonly ownerIds: readonly string[];
}

function cloudError(
  code: StudioLinked3dPassCloudSyncError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new StudioLinked3dPassCloudSyncError(code, message, cause);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("연결형 3D pass cloud 동기화가 취소되었습니다.", "AbortError");
}

function rawHash(contentHash: unknown): string {
  if (typeof contentHash !== "string") {
    cloudError("invalid-input", "연결형 3D pass cloud hash가 문자열이 아닙니다.");
  }
  const match = SHA256_PATTERN.exec(contentHash);
  if (!match) {
    cloudError("invalid-input", "연결형 3D pass cloud hash가 strict SHA-256 형식이 아닙니다.");
  }
  return match[1]!;
}

function assertCloudEligibleArtifact(
  artifact: StudioLinked3dPassArtifactDescriptor,
): void {
  const raw = rawHash(artifact.contentHash);
  if (
    artifact.pass !== "line"
    || artifact.role !== "main-line"
    || artifact.mime !== "image/png"
    || parseStudioLinked3dPassLocator(artifact.locator) !== artifact.contentHash
    || artifact.locator !== `studio-opfs-cas:sha256:${raw}`
  ) {
    cloudError("invalid-project", "연결형 3D pass artifact 권위가 strict locator와 일치하지 않습니다.");
  }
  if (
    !Number.isSafeInteger(artifact.byteSize)
    || artifact.byteSize < 1
    || artifact.byteSize > STUDIO_WORK_ASSET_MAX_BYTES_BY_TYPE.image
  ) {
    cloudError("unsupported-artifact", "연결형 3D pass PNG가 cloud image 8 MiB 한도를 넘었습니다.");
  }
  const decodedPixels = artifact.width * artifact.height;
  if (
    !Number.isSafeInteger(artifact.width)
    || !Number.isSafeInteger(artifact.height)
    || artifact.width < 1
    || artifact.height < 1
    || artifact.width > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS
    || artifact.height > STUDIO_WORK_ASSET_MAX_IMAGE_AXIS
    || !Number.isSafeInteger(decodedPixels)
    || decodedPixels > STUDIO_WORK_ASSET_MAX_IMAGE_PIXELS
  ) {
    cloudError(
      "unsupported-artifact",
      "연결형 3D pass PNG가 cloud image 16 MP/16,384 px decode 한도를 넘었습니다.",
    );
  }
}

/** A content-addressed work-asset ID: the same PNG always maps to the same immutable server row. */
export function studioLinked3dPassCloudAssetReference(
  contentHash: `sha256:${string}`,
): StudioWorkAssetReference {
  const hash = rawHash(contentHash);
  return Object.freeze({
    assetId: `${STUDIO_LINKED_3D_PASS_CLOUD_ASSET_ID_PREFIX}${hash}`,
    elementType: "image" as const,
  });
}

/** Produces the exact deterministic descriptor used for both upload and manifest verification. */
export function createStudioLinked3dPassCloudAssetDescriptor(
  artifact: StudioLinked3dPassArtifactDescriptor,
): StudioWorkAssetDescriptor {
  assertCloudEligibleArtifact(artifact);
  const reference = studioLinked3dPassCloudAssetReference(artifact.contentHash);
  return parseStudioWorkAssetDescriptor({
    version: 1,
    element: {
      id: reference.assetId,
      type: reference.elementType,
      x: 0,
      y: 0,
      width: artifact.width,
      height: artifact.height,
      rotation: 0,
    },
  }, reference);
}

function artifactFromReference(
  reference: StudioLinked3dPassProjectArchiveReference,
): StudioLinked3dPassArtifactDescriptor {
  return Object.freeze({
    pass: "line" as const,
    role: "main-line" as const,
    contentHash: reference.contentHash,
    byteSize: reference.byteSize,
    mime: "image/png" as const,
    width: reference.width,
    height: reference.height,
    locator: reference.locator,
  });
}

function sameArtifact(
  left: StudioLinked3dPassArtifactDescriptor,
  right: StudioLinked3dPassArtifactDescriptor,
): boolean {
  return left.contentHash === right.contentHash
    && left.byteSize === right.byteSize
    && left.mime === right.mime
    && left.width === right.width
    && left.height === right.height
    && left.locator === right.locator;
}

function plansForProject(project: StudioProjectFile): readonly StudioLinked3dPassCloudPlan[] {
  let references: readonly StudioLinked3dPassProjectArchiveReference[];
  try {
    references = collectStudioLinked3dPassProjectArchiveReferences(project);
  } catch (cause) {
    if (cause instanceof StudioLinked3dPassCloudSyncError) throw cause;
    cloudError("invalid-project", "cloud 동기화할 연결형 3D pass receipt가 손상되었습니다.", cause);
  }
  const grouped = new Map<`sha256:${string}`, {
    artifact: StudioLinked3dPassArtifactDescriptor;
    ownerIds: Set<string>;
  }>();
  for (const archiveReference of references) {
    const artifact = artifactFromReference(archiveReference);
    assertCloudEligibleArtifact(artifact);
    const current = grouped.get(artifact.contentHash);
    if (current && !sameArtifact(current.artifact, artifact)) {
      cloudError("invalid-project", "같은 연결형 3D pass SHA-256에 서로 다른 receipt가 연결되었습니다.");
    }
    const group = current ?? { artifact, ownerIds: new Set<string>() };
    group.ownerIds.add(archiveReference.ownerId);
    grouped.set(artifact.contentHash, group);
  }
  if (grouped.size > STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK) {
    cloudError("unsupported-artifact", "연결형 3D pass cloud asset 수가 작품별 한도를 넘었습니다.");
  }
  const totalBytes = [...grouped.values()].reduce(
    (sum, { artifact }) => sum + artifact.byteSize,
    0,
  );
  if (!Number.isSafeInteger(totalBytes) || totalBytes > STUDIO_WORK_ASSET_MAX_TOTAL_BYTES_PER_WORK) {
    cloudError("unsupported-artifact", "연결형 3D pass cloud asset 합계가 작품별 256 MiB 한도를 넘었습니다.");
  }
  return Object.freeze([...grouped.values()]
    .map(({ artifact, ownerIds }) => Object.freeze({
      artifact,
      descriptor: createStudioLinked3dPassCloudAssetDescriptor(artifact),
      reference: studioLinked3dPassCloudAssetReference(artifact.contentHash),
      ownerIds: Object.freeze([...ownerIds].toSorted()),
    }))
    .toSorted((left, right) => left.artifact.contentHash.localeCompare(right.artifact.contentHash)));
}

function assertPngReceipt(bytes: Uint8Array, plan: StudioLinked3dPassCloudPlan): void {
  const header = inspectStudioLinked3dPassPng(bytes);
  if (
    bytes.byteLength !== plan.artifact.byteSize
    || `sha256:${sha256HexPortable(bytes)}` !== plan.artifact.contentHash
    || !header
    || header.width !== plan.artifact.width
    || header.height !== plan.artifact.height
  ) {
    cloudError(
      "artifact-mismatch",
      "연결형 3D pass PNG가 프로젝트의 size·SHA-256·IHDR receipt와 다릅니다.",
    );
  }
}

function assertExactManifest(
  value: unknown,
  plan: StudioLinked3dPassCloudPlan,
): StudioWorkAssetManifest {
  const parsed = StudioWorkAssetManifestSchema.safeParse(value);
  const manifest = parsed.success ? parsed.data : null;
  const intrinsic = manifest?.intrinsicImage;
  if (
    !manifest
    || manifest.assetId !== plan.reference.assetId
    || manifest.elementType !== plan.reference.elementType
    || manifest.mimeType !== plan.artifact.mime
    || manifest.byteSize !== plan.artifact.byteSize
    || manifest.sha256 !== rawHash(plan.artifact.contentHash)
    || !intrinsic
    || intrinsic.width !== plan.artifact.width
    || intrinsic.height !== plan.artifact.height
    || intrinsic.decodedRgbaBytes !== plan.artifact.width * plan.artifact.height * 4
    || serializeStudioWorkAssetDescriptorCanonical(manifest.descriptor)
      !== serializeStudioWorkAssetDescriptorCanonical(plan.descriptor)
  ) {
    cloudError("manifest-mismatch", "work-asset manifest가 연결형 3D pass exact receipt와 다릅니다.");
  }
  return manifest;
}

function maximumConcurrency(value: number | undefined): number {
  const maximum = value ?? STUDIO_LINKED_3D_PASS_CLOUD_DEFAULT_MAXIMUM_CONCURRENCY;
  if (
    !Number.isSafeInteger(maximum)
    || maximum < 1
    || maximum > STUDIO_LINKED_3D_PASS_CLOUD_MAXIMUM_CONCURRENCY
  ) {
    cloudError("invalid-input", "연결형 3D pass cloud 동시성은 1~8 사이의 정수여야 합니다.");
  }
  return maximum;
}

async function mapBounded<TInput, TOutput>(
  values: readonly TInput[],
  maximum: number,
  callerSignal: AbortSignal | undefined,
  task: (value: TInput, transferSignal: AbortSignal) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  if (values.length === 0) {
    throwIfAborted(callerSignal);
    return Object.freeze([]);
  }
  const controller = new AbortController();
  const noFailure = Symbol("no linked 3D pass cloud transfer failure");
  let firstFailure: unknown | typeof noFailure = noFailure;
  const fail = (cause: unknown): void => {
    if (firstFailure !== noFailure) return;
    firstFailure = cause;
    controller.abort(cause);
  };
  const relayCallerAbort = (): void => {
    if (!callerSignal) return;
    try {
      throwIfAborted(callerSignal);
    } catch (cause) {
      fail(cause);
    }
  };
  if (callerSignal?.aborted) relayCallerAbort();
  else callerSignal?.addEventListener("abort", relayCallerAbort, { once: true });

  let cursor = 0;
  const outputs = new Array<TOutput>(values.length);
  const worker = async (): Promise<void> => {
    while (true) {
      if (controller.signal.aborted) return;
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) return;
      try {
        outputs[index] = await task(value, controller.signal);
      } catch (cause) {
        fail(cause);
        return;
      }
      if (controller.signal.aborted) return;
    }
  };
  try {
    await Promise.allSettled(Array.from(
      { length: Math.min(maximum, values.length) },
      async () => await worker(),
    ));
  } finally {
    callerSignal?.removeEventListener("abort", relayCallerAbort);
  }
  if (firstFailure !== noFailure) throw firstFailure;
  return Object.freeze(outputs);
}

function assertProductAuthority(authority: StudioLinked3dPassCasAuthority): void {
  if (authority.kind !== "opfs") {
    cloudError("opfs-unavailable", "연결형 3D pass cloud 동기화에는 durable OPFS CAS가 필요합니다.");
  }
}

async function localBytes(
  authority: StudioLinked3dPassCasAuthority,
  plan: StudioLinked3dPassCloudPlan,
): Promise<Uint8Array | null> {
  let bytes: Uint8Array | null;
  try {
    bytes = await authority.get(plan.artifact.contentHash, { verify: true });
  } catch (cause) {
    cloudError("artifact-mismatch", "OPFS CAS에서 연결형 3D pass를 검증하지 못했습니다.", cause);
  }
  if (!bytes) return null;
  assertPngReceipt(bytes, plan);
  return Uint8Array.from(bytes);
}

async function settleCleanupPlans(input: {
  readonly workId: string;
  readonly plans: readonly StudioLinked3dPassCloudPlan[];
  readonly cleanup: CleanupStudioLinked3dPassCloudAsset;
  readonly maximumConcurrentTransfers: number;
}): Promise<readonly unknown[]> {
  if (input.plans.length === 0) return Object.freeze([]);
  const outcomes = await mapBounded(
    input.plans,
    input.maximumConcurrentTransfers,
    undefined,
    async (plan) => {
      try {
        await input.cleanup(
          input.workId,
          plan.reference,
          rawHash(plan.artifact.contentHash),
        );
        return null;
      } catch (cause) {
        return cause;
      }
    },
  );
  return Object.freeze(outcomes.filter((outcome) => outcome !== null));
}

/**
 * Compensates immutable uploads that did not enter an accepted project revision. The server is the
 * authority for absence: current JSON, every retained revision, and the durable CRDT frontier are
 * checked under the work lock, so calling this after an ambiguous PATCH is safe and idempotent.
 */
export async function compensateStudioLinked3dPassCloudUploads(input: {
  readonly workId: string;
  readonly receipts: readonly StudioLinked3dPassCloudUploadReceipt[];
  readonly maximumConcurrentTransfers?: number;
  readonly cleanup?: CleanupStudioLinked3dPassCloudAsset;
}): Promise<void> {
  if (!input.workId.trim()) cloudError("invalid-input", "cloud 정리 작품 ID가 비어 있습니다.");
  const plansByAssetId = new Map<string, StudioLinked3dPassCloudPlan>();
  for (const receipt of input.receipts) {
    const expectedReference = studioLinked3dPassCloudAssetReference(receipt.contentHash);
    if (
      receipt.reference.assetId !== expectedReference.assetId
      || receipt.reference.elementType !== expectedReference.elementType
      || receipt.manifest.assetId !== expectedReference.assetId
      || receipt.manifest.elementType !== expectedReference.elementType
      || receipt.manifest.sha256 !== rawHash(receipt.contentHash)
    ) {
      cloudError("invalid-input", "연결형 3D pass cloud 정리 영수증이 exact identity와 다릅니다.");
    }
    plansByAssetId.set(expectedReference.assetId, {
      artifact: {
        pass: "line",
        role: "main-line",
        contentHash: receipt.contentHash,
        byteSize: receipt.manifest.byteSize,
        mime: "image/png",
        width: receipt.manifest.intrinsicImage?.width ?? 0,
        height: receipt.manifest.intrinsicImage?.height ?? 0,
        locator: `studio-opfs-cas:${receipt.contentHash}`,
      },
      descriptor: receipt.manifest.descriptor,
      reference: expectedReference,
      ownerIds: receipt.ownerIds,
    });
  }
  const failures = await settleCleanupPlans({
    workId: input.workId,
    plans: [...plansByAssetId.values()],
    cleanup: input.cleanup ?? deleteUnreferencedStudioWorkAssetUpload,
    maximumConcurrentTransfers: maximumConcurrency(input.maximumConcurrentTransfers),
  });
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "연결형 3D pass cloud 업로드 보상을 모두 완료하지 못했습니다.",
    );
  }
}

export async function ensureStudioLinked3dPassCloudArtifacts(input: {
  readonly workId: string;
  readonly project: StudioProjectFile;
  readonly authority: StudioLinked3dPassCasAuthority;
  readonly signal?: AbortSignal;
  readonly maximumConcurrentTransfers?: number;
  readonly upload?: UploadStudioLinked3dPassCloudAsset;
  readonly cleanup?: CleanupStudioLinked3dPassCloudAsset;
}): Promise<readonly StudioLinked3dPassCloudUploadReceipt[]> {
  if (!input.workId.trim()) cloudError("invalid-input", "cloud 동기화 작품 ID가 비어 있습니다.");
  assertProductAuthority(input.authority);
  throwIfAborted(input.signal);
  const plans = plansForProject(input.project);
  const upload = input.upload ?? uploadStudioWorkAsset;
  const cleanup = input.cleanup ?? (input.upload
    ? async () => false
    : deleteUnreferencedStudioWorkAssetUpload);
  const maximum = maximumConcurrency(input.maximumConcurrentTransfers);
  const attemptedPlans = new Map<string, StudioLinked3dPassCloudPlan>();
  try {
    return await mapBounded(
      plans,
      maximum,
      input.signal,
      async (plan, transferSignal) => {
        const bytes = await localBytes(input.authority, plan);
        if (!bytes) {
          cloudError("artifact-missing", "OPFS CAS에 cloud 업로드할 연결형 3D pass PNG가 없습니다.");
        }
        throwIfAborted(transferSignal);
        // Mark the deterministic receipt before transport. A committed response can be lost, and
        // the server-side cleanup proof makes compensating a pre-existing referenced row a no-op.
        attemptedPlans.set(plan.reference.assetId, plan);
        const manifest = assertExactManifest(await upload(
          input.workId,
          plan.reference,
          plan.descriptor,
          new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
          transferSignal,
        ), plan);
        throwIfAborted(transferSignal);
        return Object.freeze({
          contentHash: plan.artifact.contentHash,
          reference: plan.reference,
          manifest,
          ownerIds: plan.ownerIds,
        });
      },
    );
  } catch (cause) {
    const cleanupFailures = await settleCleanupPlans({
      workId: input.workId,
      plans: [...attemptedPlans.values()],
      cleanup,
      maximumConcurrentTransfers: maximum,
    });
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupFailures],
        "연결형 3D pass cloud 업로드 실패 뒤 미참조 asset을 모두 정리하지 못했습니다.",
        { cause },
      );
    }
    throw cause;
  }
}

async function restorePlan(
  input: {
    readonly workId: string;
    readonly authority: StudioLinked3dPassCasAuthority;
    readonly signal?: AbortSignal;
    readonly download: DownloadStudioLinked3dPassCloudAsset;
  },
  plan: StudioLinked3dPassCloudPlan,
): Promise<void> {
  if (await localBytes(input.authority, plan)) return;
  throwIfAborted(input.signal);
  const downloaded = await input.download(input.workId, plan.reference, input.signal);
  assertExactManifest(downloaded.manifest, plan);
  if (
    downloaded.blob.type !== "image/png"
    || downloaded.blob.size !== plan.artifact.byteSize
  ) {
    cloudError("artifact-mismatch", "work-asset PNG body가 exact manifest envelope와 다릅니다.");
  }
  throwIfAborted(input.signal);
  const bytes = new Uint8Array(await downloaded.blob.arrayBuffer());
  throwIfAborted(input.signal);
  assertPngReceipt(bytes, plan);
  const put = await input.authority.put(Uint8Array.from(bytes), { mime: "image/png" });
  const verified = await localBytes(input.authority, plan);
  if (
    put.ref.hash !== plan.artifact.contentHash
    || put.ref.bytes !== plan.artifact.byteSize
    || put.ref.mime !== "image/png"
    || !verified
  ) {
    cloudError("artifact-mismatch", "work-asset PNG를 OPFS CAS에 정확히 복원하지 못했습니다.");
  }
  throwIfAborted(input.signal);
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

export async function hydrateStudioLinked3dPassCloudArtifacts<T>(input: {
  readonly workId: string;
  readonly project: StudioProjectFile;
  readonly authority: StudioLinked3dPassCasAuthority;
  readonly apply: (project: StudioProjectFile) => T | false | Promise<T | false>;
  readonly signal?: AbortSignal;
  readonly maximumConcurrentTransfers?: number;
  readonly download?: DownloadStudioLinked3dPassCloudAsset;
}): Promise<T> {
  if (!input.workId.trim()) cloudError("invalid-input", "cloud 복원 작품 ID가 비어 있습니다.");
  assertProductAuthority(input.authority);
  throwIfAborted(input.signal);
  const plans = plansForProject(input.project);
  const download = input.download ?? downloadStudioWorkAsset;
  await mapBounded(
    plans,
    maximumConcurrency(input.maximumConcurrentTransfers),
    input.signal,
    async (plan, transferSignal) => await restorePlan({
      workId: input.workId,
      authority: input.authority,
      signal: transferSignal,
      download,
    }, plan),
  );
  throwIfAborted(input.signal);

  const desiredByOwner = new Map<string, Set<string>>();
  for (const plan of plans) {
    for (const ownerId of plan.ownerIds) {
      const desired = desiredByOwner.get(ownerId) ?? new Set<string>();
      desired.add(plan.artifact.contentHash);
      desiredByOwner.set(ownerId, desired);
    }
  }
  const owners = [...desiredByOwner.keys()].toSorted();
  return await lockOwners(input.authority, owners, 0, async () => {
    const previous = new Map<string, readonly string[]>();
    const updated: string[] = [];
    try {
      for (const owner of owners) {
        throwIfAborted(input.signal);
        const ownerRefs = await input.authority.ownerRefs(owner);
        previous.set(owner, ownerRefs);
        // Publication can mutate durable owner state before its acknowledgement is lost. Record
        // the attempted owner before awaiting so that failure enters exact compensation.
        updated.push(owner);
        await input.authority.setOwnerRefs(owner, [...new Set([
          ...ownerRefs,
          ...(desiredByOwner.get(owner) ?? []),
        ])].toSorted());
      }
      throwIfAborted(input.signal);
      const result = await input.apply(input.project);
      if (result === false) {
        cloudError("commit-rejected", "Studio가 cloud 복원된 연결형 3D pass 문서 적용을 거절했습니다.");
      }
      return result;
    } catch (cause) {
      const rollbackFailures: unknown[] = [];
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
          "cloud 연결형 3D pass 복원 실패 뒤 owner 참조 일부를 되돌리지 못했습니다.",
          { cause },
        );
      }
      throw cause;
    }
  });
}
