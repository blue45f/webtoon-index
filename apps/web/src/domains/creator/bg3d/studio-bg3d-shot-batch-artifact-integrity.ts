/** Strict integrity boundary for one atomically committed shot-batch result. */

import { compareStudioValidationStrings } from "../studio-validation-string-order";

import {
  verifyStudioBg3dLayeredPsdFile,
  verifyStudioBg3dRgba8PngFile,
} from "./studio-bg3d-file-integrity";
import {
  STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES,
  STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES,
  type StudioBg3dShotBatchImage,
  type StudioBg3dShotBatchLayeredPsd,
  type StudioBg3dShotBatchPsdFallback,
  type StudioBg3dShotBatchSkippedArtifact,
} from "./studio-bg3d-shot-batch";
import {
  STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_PSD_MIME,
} from "./studio-bg3d-shot-psd-contract";

import type {
  StudioBg3dShotBatchPlan,
  StudioBg3dShotBatchPlannedShot,
} from "./studio-bg3d-shot-batch-plan";

export interface StudioBg3dShotBatchShotArtifacts {
  readonly images: readonly StudioBg3dShotBatchImage[];
  readonly skippedArtifacts: readonly StudioBg3dShotBatchSkippedArtifact[];
  readonly layeredPsds: readonly StudioBg3dShotBatchLayeredPsd[];
  readonly psdFallbacks: readonly StudioBg3dShotBatchPsdFallback[];
}

export interface StudioBg3dShotBatchVerifiedBlob {
  readonly kind: "png" | "psd";
  readonly key: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface StudioBg3dVerifiedShotBatchShotArtifacts
  extends StudioBg3dShotBatchShotArtifacts {
  readonly blobs: readonly StudioBg3dShotBatchVerifiedBlob[];
  readonly totalBytes: number;
  readonly artifactCount: number;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareStudioValidationStrings);
  const canonical = [...expected].sort(compareStudioValidationStrings);
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

function integrityError(message: string): Error {
  const error = new Error(message);
  error.name = "DataError";
  return error;
}

function assertShotIdentity(
  shot: StudioBg3dShotBatchPlannedShot,
  artifact: { readonly shotId: string; readonly shotName: string },
): void {
  if (artifact.shotId !== shot.shotId || artifact.shotName !== shot.shotName) {
    throw integrityError("컷 artifact가 고정 계획의 컷과 일치하지 않습니다.");
  }
}

function snapshotArtifacts(
  input: StudioBg3dShotBatchShotArtifacts,
): StudioBg3dShotBatchShotArtifacts {
  for (const image of input.images) {
    if (!hasExactKeys(image, [
      "shotId", "shotName", "width", "height", "pass", "requestedHeight", "wasReduced", "png",
    ])) throw integrityError("컷 PNG artifact 필드가 올바르지 않습니다.");
  }
  for (const skipped of input.skippedArtifacts) {
    if (!hasExactKeys(skipped, ["shotId", "shotName", "pass", "reason"])) {
      throw integrityError("컷 생략 artifact 필드가 올바르지 않습니다.");
    }
  }
  for (const artifact of input.layeredPsds) {
    if (!hasExactKeys(artifact, ["shotId", "shotName", "width", "height", "psd"])) {
      throw integrityError("컷 PSD artifact 필드가 올바르지 않습니다.");
    }
  }
  for (const fallback of input.psdFallbacks) {
    if (!hasExactKeys(fallback, ["shotId", "shotName", "reason"])) {
      throw integrityError("컷 PSD fallback 필드가 올바르지 않습니다.");
    }
  }
  return {
    images: input.images.map((image) => ({
      shotId: image.shotId,
      shotName: image.shotName,
      width: image.width,
      height: image.height,
      pass: image.pass,
      requestedHeight: image.requestedHeight,
      wasReduced: image.wasReduced,
      png: image.png,
    })),
    skippedArtifacts: input.skippedArtifacts.map((item) => ({
      shotId: item.shotId,
      shotName: item.shotName,
      pass: item.pass,
      reason: item.reason,
    })),
    layeredPsds: input.layeredPsds.map((item) => ({
      shotId: item.shotId,
      shotName: item.shotName,
      width: item.width,
      height: item.height,
      psd: item.psd,
    })),
    psdFallbacks: input.psdFallbacks.map((item) => ({
      shotId: item.shotId,
      shotName: item.shotName,
      reason: item.reason,
    })),
  };
}

async function verifyPng(
  shot: StudioBg3dShotBatchPlannedShot,
  image: StudioBg3dShotBatchImage,
  signal?: AbortSignal,
): Promise<StudioBg3dShotBatchVerifiedBlob> {
  assertShotIdentity(shot, image);
  if (
    image.pass === undefined || !shot.files.some(({ pass }) => pass === image.pass) ||
    image.width !== shot.capture.width || image.height !== shot.capture.height ||
    image.requestedHeight !== shot.capture.requestedHeight ||
    image.wasReduced !== shot.capture.wasReduced ||
    !(image.png instanceof Blob) || image.png.type !== "image/png" ||
    image.png.size < 24 || image.png.size > STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES
  ) {
    throw integrityError("컷 PNG artifact가 고정 계획 또는 안전 예산과 일치하지 않습니다.");
  }
  const receipt = await verifyStudioBg3dRgba8PngFile(image.png, {
    expectedWidth: image.width,
    expectedHeight: image.height,
    maxBytes: STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES,
    signal,
  });
  return {
    kind: "png",
    key: `${shot.shotId}:${image.pass}`,
    sha256: receipt.sha256,
    byteSize: receipt.byteSize,
  };
}

async function verifyPsd(
  shot: StudioBg3dShotBatchPlannedShot,
  artifact: StudioBg3dShotBatchLayeredPsd,
  signal?: AbortSignal,
): Promise<StudioBg3dShotBatchVerifiedBlob> {
  assertShotIdentity(shot, artifact);
  if (
    artifact.width !== shot.capture.width || artifact.height !== shot.capture.height ||
    !(artifact.psd instanceof Blob) || artifact.psd.type !== STUDIO_BG3D_SHOT_PSD_MIME ||
    artifact.psd.size < 26 || artifact.psd.size > STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES
  ) {
    throw integrityError("컷 PSD artifact가 고정 계획 또는 안전 예산과 일치하지 않습니다.");
  }
  const receipt = await verifyStudioBg3dLayeredPsdFile(artifact.psd, {
    expectedWidth: artifact.width,
    expectedHeight: artifact.height,
    maxBytes: STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
    signal,
  });
  return {
    kind: "psd",
    key: `${shot.shotId}:layered-psd`,
    sha256: receipt.sha256,
    byteSize: receipt.byteSize,
  };
}

function copyArtifacts(
  input: StudioBg3dShotBatchShotArtifacts,
  blobs: readonly StudioBg3dShotBatchVerifiedBlob[],
): StudioBg3dVerifiedShotBatchShotArtifacts {
  const totalBytes = blobs.reduce((total, blob) => total + blob.byteSize, 0);
  return Object.freeze({
    images: Object.freeze(input.images.map((image) => Object.freeze({
      shotId: image.shotId,
      shotName: image.shotName,
      width: image.width,
      height: image.height,
      pass: image.pass,
      requestedHeight: image.requestedHeight,
      wasReduced: image.wasReduced,
      png: image.png,
    }))),
    skippedArtifacts: Object.freeze(input.skippedArtifacts.map((item) => Object.freeze({
      shotId: item.shotId,
      shotName: item.shotName,
      pass: item.pass,
      reason: item.reason,
    }))),
    layeredPsds: Object.freeze(input.layeredPsds.map((item) => Object.freeze({
      shotId: item.shotId,
      shotName: item.shotName,
      width: item.width,
      height: item.height,
      psd: item.psd,
    }))),
    psdFallbacks: Object.freeze(input.psdFallbacks.map((item) => Object.freeze({
      shotId: item.shotId,
      shotName: item.shotName,
      reason: item.reason,
    }))),
    blobs: Object.freeze(blobs.map((blob) => Object.freeze({
      kind: blob.kind,
      key: blob.key,
      sha256: blob.sha256,
      byteSize: blob.byteSize,
    }))),
    totalBytes,
    artifactCount: input.images.length + input.skippedArtifacts.length +
      input.layeredPsds.length + input.psdFallbacks.length,
  });
}

/**
 * Validates completeness, full PNG/PSD structure, pixel profile, and SHA-256 outside a transaction.
 * The returned value is safe to stage in one jobs+artifacts+usage transaction.
 */
export async function verifyStudioBg3dShotBatchShotArtifacts(
  plan: StudioBg3dShotBatchPlan,
  shotId: string,
  input: StudioBg3dShotBatchShotArtifacts,
  signal?: AbortSignal,
): Promise<StudioBg3dVerifiedShotBatchShotArtifacts> {
  if (signal?.aborted) throw new DOMException("컷 artifact 검증이 취소되었습니다.", "AbortError");
  const shot = plan.shots.find((candidate) => candidate.shotId === shotId);
  if (!shot || !hasExactKeys(input, [
    "images", "skippedArtifacts", "layeredPsds", "psdFallbacks",
  ]) ||
    !Array.isArray(input.images) || !Array.isArray(input.skippedArtifacts) ||
    !Array.isArray(input.layeredPsds) || !Array.isArray(input.psdFallbacks) ||
    input.images.length > shot.files.length || input.skippedArtifacts.length > shot.files.length ||
    input.layeredPsds.length > 1 || input.psdFallbacks.length > 1) {
    throw integrityError("컷 artifact 묶음이 올바르지 않습니다.");
  }
  // Snapshot all mutable arrays and metadata before the first await. Blob bytes are immutable;
  // caller-owned objects are not, so validation, hashing, and persistence share this one copy.
  const snapshot = snapshotArtifacts(input);
  const imagePasses = new Set<string>();
  for (const image of snapshot.images) {
    if (image.pass === undefined || imagePasses.has(image.pass)) {
      throw integrityError("컷 PNG pass가 없거나 중복되었습니다.");
    }
    imagePasses.add(image.pass);
  }
  const skippedPasses = new Set<string>();
  for (const skipped of snapshot.skippedArtifacts) {
    assertShotIdentity(shot, skipped);
    if (!shot.files.some(({ pass }) => pass === skipped.pass) ||
      (skipped.reason !== "disabled" && skipped.reason !== "unavailable") ||
      skippedPasses.has(skipped.pass) || imagePasses.has(skipped.pass)) {
      throw integrityError("컷 완료/생략 pass가 중복되거나 계획 밖입니다.");
    }
    skippedPasses.add(skipped.pass);
  }
  for (const { pass } of shot.files) {
    if (!imagePasses.has(pass) && !skippedPasses.has(pass)) {
      throw integrityError("컷의 요청 pass가 완료 또는 생략으로 정확히 설명되지 않았습니다.");
    }
  }
  if (
    (plan.includeLayeredPsd && snapshot.layeredPsds.length + snapshot.psdFallbacks.length !== 1) ||
    (!plan.includeLayeredPsd && (snapshot.layeredPsds.length > 0 || snapshot.psdFallbacks.length > 0)) ||
    snapshot.layeredPsds.length > 1 || snapshot.psdFallbacks.length > 1
  ) {
    throw integrityError("컷 PSD 완료/fallback 계약이 계획과 일치하지 않습니다.");
  }
  for (const fallback of snapshot.psdFallbacks) {
    assertShotIdentity(shot, fallback);
    if (!(["budget", "unavailable", "worker-failed"] as const).includes(fallback.reason)) {
      throw integrityError("컷 PSD fallback 사유가 올바르지 않습니다.");
    }
  }

  // Hash sequentially: seven 24 MiB pass blobs plus a PSD must not be copied into memory at once.
  const blobs: StudioBg3dShotBatchVerifiedBlob[] = [];
  for (const image of snapshot.images) {
    if (signal?.aborted) throw new DOMException("컷 artifact 검증이 취소되었습니다.", "AbortError");
    blobs.push(await verifyPng(shot, image, signal));
  }
  for (const artifact of snapshot.layeredPsds) {
    if (signal?.aborted) throw new DOMException("컷 artifact 검증이 취소되었습니다.", "AbortError");
    blobs.push(await verifyPsd(shot, artifact, signal));
  }
  const totalBytes = blobs.reduce((total, blob) => total + blob.byteSize, 0);
  if (totalBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES) {
    throw new RangeError("컷 artifact 묶음이 배치 저장 예산을 벗어났습니다.");
  }
  return copyArtifacts(snapshot, blobs);
}

/** Revalidates persisted Blob bytes against their stored SHA-256 receipts. */
export async function reverifyStudioBg3dShotBatchShotArtifacts(
  plan: StudioBg3dShotBatchPlan,
  shotId: string,
  stored: StudioBg3dVerifiedShotBatchShotArtifacts,
  signal?: AbortSignal,
): Promise<StudioBg3dVerifiedShotBatchShotArtifacts> {
  if (!hasExactKeys(stored, [
    "images", "skippedArtifacts", "layeredPsds", "psdFallbacks",
    "blobs", "totalBytes", "artifactCount",
  ]) || !Array.isArray(stored.blobs) || !Number.isSafeInteger(stored.totalBytes) ||
    stored.blobs.length > (plan.shots.find(({ shotId: id }) => id === shotId)?.files.length ?? 0) + 1 ||
    stored.totalBytes < 0 || stored.totalBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES ||
    !Number.isSafeInteger(stored.artifactCount) || stored.artifactCount < 0 ||
    stored.blobs.some((blob) =>
      !hasExactKeys(blob, ["kind", "key", "sha256", "byteSize"]) ||
      (blob.kind !== "png" && blob.kind !== "psd") ||
      typeof blob.key !== "string" || !SHA256_PATTERN.test(blob.sha256) ||
      !Number.isSafeInteger(blob.byteSize) || blob.byteSize < 1
    )) throw integrityError("저장된 컷 artifact 무결성 영수증이 올바르지 않습니다.");
  const verified = await verifyStudioBg3dShotBatchShotArtifacts(plan, shotId, {
    images: stored.images,
    skippedArtifacts: stored.skippedArtifacts,
    layeredPsds: stored.layeredPsds,
    psdFallbacks: stored.psdFallbacks,
  }, signal);
  if (
    verified.totalBytes !== stored.totalBytes || verified.artifactCount !== stored.artifactCount ||
    verified.blobs.length !== stored.blobs.length ||
    verified.blobs.some((blob, index) => {
      const receipt = stored.blobs[index];
      return !receipt || blob.kind !== receipt.kind || blob.key !== receipt.key ||
        blob.sha256 !== receipt.sha256 || blob.byteSize !== receipt.byteSize;
    })
  ) throw integrityError("저장된 컷 artifact 바이트가 무결성 영수증과 일치하지 않습니다.");
  return verified;
}
