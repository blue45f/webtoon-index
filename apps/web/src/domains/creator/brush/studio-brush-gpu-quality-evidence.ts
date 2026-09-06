import {
  STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION,
} from "./studio-brush-gpu-quality-election";
import {
  STUDIO_BRUSH_GPU_QUALITY_EVIDENCE,
  STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_SCHEMA_VERSION,
} from "./studio-brush-gpu-quality-evidence.generated";

export { STUDIO_BRUSH_GPU_QUALITY_EVIDENCE };

export const STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MAX_AGE_MS =
  30 * 24 * 60 * 60 * 1_000;
export const STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MINIMUM_RUN_COUNT = 3;

export interface StudioBrushGpuQualityEvidenceRecord {
  readonly schemaVersion: number;
  readonly rendererContractVersion: number;
  readonly generatedAt: string | null;
  readonly expiresAt: string | null;
  readonly sourceCommit: string | null;
  readonly benchmarkDigest: string | null;
  readonly measurementRunCount: number;
  readonly measuredBrushCount: number;
  readonly hardwareClass: "hardware" | null;
  readonly hardwareAdapterFingerprints: readonly string[];
  readonly approvedBrushIds: readonly string[];
  readonly rejectedBrushIds: readonly string[];
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function finiteTimestamp(value: string | null): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Pure fail-closed validator so tests and rollout code use exactly the same freshness, hardware,
 * renderer-contract, repeated-run, and brush-id rules.
 */
export function studioBrushGpuQualityEvidenceRecordAllows(
  evidence: StudioBrushGpuQualityEvidenceRecord,
  brushCatalogId: unknown,
  now = Date.now(),
): boolean {
  const generatedAt = finiteTimestamp(evidence.generatedAt);
  const expiresAt = finiteTimestamp(evidence.expiresAt);
  const adapterFingerprints = evidence.hardwareAdapterFingerprints;
  return evidence.schemaVersion === STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_SCHEMA_VERSION
    && evidence.rendererContractVersion
      === STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION
    && generatedAt !== null
    && expiresAt !== null
    && generatedAt <= now + FUTURE_CLOCK_SKEW_MS
    && expiresAt >= now
    && expiresAt > generatedAt
    && expiresAt - generatedAt <= STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MAX_AGE_MS
    && typeof evidence.sourceCommit === "string"
    && COMMIT_PATTERN.test(evidence.sourceCommit)
    && typeof evidence.benchmarkDigest === "string"
    && DIGEST_PATTERN.test(evidence.benchmarkDigest)
    && Number.isSafeInteger(evidence.measurementRunCount)
    && evidence.measurementRunCount
      >= STUDIO_BRUSH_GPU_QUALITY_EVIDENCE_MINIMUM_RUN_COUNT
    && Number.isSafeInteger(evidence.measuredBrushCount)
    && evidence.measuredBrushCount > 0
    && evidence.hardwareClass === "hardware"
    && Array.isArray(adapterFingerprints)
    && adapterFingerprints.length > 0
    && adapterFingerprints.every((fingerprint) =>
      typeof fingerprint === "string" && fingerprint.length > 0
    )
    && typeof brushCatalogId === "string"
    && brushCatalogId.length > 0
    && evidence.approvedBrushIds.includes(brushCatalogId);
}

/** Automatic GPU rollout is fail-closed, brush-specific, hardware-bound, and time-bounded. */
export function studioBrushGpuQualityEvidenceAllows(
  brushCatalogId: unknown,
): boolean {
  return studioBrushGpuQualityEvidenceRecordAllows(
    STUDIO_BRUSH_GPU_QUALITY_EVIDENCE,
    brushCatalogId,
  );
}
