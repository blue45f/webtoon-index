/**
 * Phase-independent recipe parity for the Engine vNext brush vertical slice.
 *
 * Canonical plan hashes deliberately include lifecycle epochs, command sequence and the current
 * accepted sample prefix. They are therefore the right cache/replay identity for one submission,
 * but the wrong proof that Brush Library selection, live preview, commit, reopen and export all
 * retained the same visual recipe. This boundary derives separate cryptographic identities for:
 *
 *  - the immutable recipe;
 *  - the complete visual contract (recipe + colour + composite + seed + transform + assets); and
 *  - one phase's authoritative source samples.
 *
 * Live may contain an exact prefix of commit. Commit, CRDT-reopened and export snapshots must be
 * byte-identical after canonical adaptation. Unsupported retained semantics remain fail-closed.
 */

import { isStudioBrushCatalogSelection } from "../brush/studio-brush-selection";
import {
  adaptStudioDrawElementToCanonicalBrushPlan,
  type StudioCanonicalBrushDrawAdapterReady,
  type StudioCanonicalBrushDrawAdapterRequirement,
} from "../studio-canonical-brush-draw-adapter";
import {
  hashStudioCanonicalBrushPlan,
  type StudioCanonicalBrushAffineTransform,
  type StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import { canonicalStudioCommandJson } from "../studio-command-journal";
import { sha256HexPortable } from "../studio-sha256";

import type { StudioBrushCatalogSelection } from "../brush/studio-brush-selection";
import type { StudioLinearColorSpace } from "../studio-color-quality-engine";
import type { DrawEl } from "../studio-element-model";
import type { StudioEngineWebGpuTexturedBrushAssetPayload } from "./studio-engine-webgpu-textured-brush-plan";

export const STUDIO_ENGINE_VNEXT_BRUSH_LIFECYCLE_PARITY_VERSION = 1 as const;

const TEXT_ENCODER = new TextEncoder();
const CANONICAL_IDENTITY_BUDGET = 8 * 1024 * 1024;

const IDENTITY_TRANSFORM = Object.freeze({
  encoding: "affine-f64-v1",
  m11: 1,
  m12: 0,
  m21: 0,
  m22: 1,
  translateX: 0,
  translateY: 0,
}) satisfies StudioCanonicalBrushAffineTransform;

export type StudioEngineVNextBrushLifecyclePhase =
  | "live"
  | "commit"
  | "reopen"
  | "export";

export interface StudioEngineVNextBrushLifecycleParityInput {
  readonly selection: StudioBrushCatalogSelection;
  readonly live: DrawEl;
  readonly commit: DrawEl;
  readonly reopened: DrawEl;
  /** The exact reopened DrawEl snapshot handed to a retained/raster/vector export boundary. */
  readonly exportSnapshot: DrawEl;
  readonly colorSpace?: StudioLinearColorSpace;
  readonly transform?: StudioCanonicalBrushAffineTransform;
  readonly firstSampleSequence?: number;
  readonly firstTimeMilliseconds?: number;
  readonly fallbackSampleIntervalMilliseconds?: number;
}

export type StudioEngineVNextBrushLifecycleParityFailureReason =
  | "invalid-selection"
  | "selection-mismatch"
  | "canonical-adapter-rejected"
  | "asset-integrity-mismatch"
  | "recipe-mismatch"
  | "visual-contract-mismatch"
  | "live-prefix-mismatch"
  | "committed-source-mismatch"
  | "identity-encoding-failed";

export interface StudioEngineVNextBrushLifecycleParityRejection {
  readonly status: "rejected";
  readonly reason: StudioEngineVNextBrushLifecycleParityFailureReason;
  readonly phase?: StudioEngineVNextBrushLifecyclePhase;
  readonly detail: string;
}

export interface StudioEngineVNextBrushLifecyclePhaseReceipt {
  readonly phase: StudioEngineVNextBrushLifecyclePhase;
  /** Submission identity; this is expected to vary with lifecycle envelope and source prefix. */
  readonly canonicalPlanHash: string;
  readonly recipeDigest: `sha256:${string}`;
  readonly visualContractDigest: `sha256:${string}`;
  readonly strokeContentDigest: `sha256:${string}`;
  readonly authoritativeSampleCount: number;
}

export interface StudioEngineVNextBrushLifecycleParityReceipt {
  readonly kind: "studio-engine-vnext-brush-lifecycle-parity-receipt";
  readonly version: typeof STUDIO_ENGINE_VNEXT_BRUSH_LIFECYCLE_PARITY_VERSION;
  readonly catalogId: string;
  readonly catalogName: string;
  readonly runtimeBrushId: string;
  readonly selectionDigest: `sha256:${string}`;
  readonly recipeDigest: `sha256:${string}`;
  readonly visualContractDigest: `sha256:${string}`;
  readonly committedStrokeDigest: `sha256:${string}`;
  readonly liveIsCommitPrefix: true;
  readonly sameCanonicalRecipe: true;
  readonly sameVisualContract: true;
  readonly sameCommittedStroke: true;
  readonly phases: Readonly<Record<
    StudioEngineVNextBrushLifecyclePhase,
    StudioEngineVNextBrushLifecyclePhaseReceipt
  >>;
  readonly complete: true;
}

export type StudioEngineVNextBrushLifecycleParityResult =
  | Readonly<{
      status: "verified";
      receipt: StudioEngineVNextBrushLifecycleParityReceipt;
    }>
  | StudioEngineVNextBrushLifecycleParityRejection;

interface CompiledPhase {
  readonly phase: StudioEngineVNextBrushLifecyclePhase;
  readonly adapted: StudioCanonicalBrushDrawAdapterReady;
  readonly receipt: StudioEngineVNextBrushLifecyclePhaseReceipt;
}

interface AssetIdentity {
  readonly assetId: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly channel: string;
  readonly format: string;
  readonly byteLength: number;
}

const PHASE_ENVELOPE: Readonly<Record<
  StudioEngineVNextBrushLifecyclePhase,
  Readonly<{ sessionEpoch: number; strokeEpoch: number; commandSequence: number }>
>> = Object.freeze({
  live: Object.freeze({ sessionEpoch: 101, strokeEpoch: 11, commandSequence: 1 }),
  commit: Object.freeze({ sessionEpoch: 101, strokeEpoch: 11, commandSequence: 2 }),
  reopen: Object.freeze({ sessionEpoch: 202, strokeEpoch: 22, commandSequence: 1 }),
  export: Object.freeze({ sessionEpoch: 303, strokeEpoch: 33, commandSequence: 1 }),
});

function reject(
  reason: StudioEngineVNextBrushLifecycleParityFailureReason,
  detail: string,
  phase?: StudioEngineVNextBrushLifecyclePhase,
): StudioEngineVNextBrushLifecycleParityRejection {
  return Object.freeze({
    status: "rejected",
    reason,
    ...(phase ? { phase } : {}),
    detail,
  });
}

function digestCanonical(value: unknown): `sha256:${string}` {
  const canonical = canonicalStudioCommandJson(value, CANONICAL_IDENTITY_BUDGET);
  return `sha256:${sha256HexPortable(TEXT_ENCODER.encode(canonical))}`;
}

function assetIdentity(
  asset: StudioEngineWebGpuTexturedBrushAssetPayload,
): AssetIdentity | null {
  const actualHash = `sha256:${sha256HexPortable(asset.bytes)}`;
  if (asset.contentHash !== actualHash || asset.byteLength !== asset.bytes.byteLength) return null;
  return Object.freeze({
    assetId: asset.assetId,
    contentHash: asset.contentHash,
    width: asset.width,
    height: asset.height,
    channel: asset.channel,
    format: asset.format,
    byteLength: asset.byteLength,
  });
}

function visualContract(
  plan: StudioCanonicalBrushPlan,
  requirements: readonly StudioCanonicalBrushDrawAdapterRequirement[],
  assets: readonly AssetIdentity[],
) {
  return {
    strokeId: plan.strokeId,
    seed: plan.seed,
    coordinateSpace: plan.coordinateSpace,
    transform: plan.transform,
    color: plan.color,
    composite: plan.composite,
    recipe: plan.recipe,
    requirements: [...requirements].sort(),
    assets: [...assets].sort((left, right) =>
      left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
    ),
  };
}

function selectionMatches(
  selection: StudioBrushCatalogSelection,
  element: DrawEl,
): boolean {
  return element.brush === selection.runtimeBrushId
    && element.brushCatalogId === selection.catalogId
    && element.brushCatalogName === selection.catalogName;
}

function compilePhase(
  phase: StudioEngineVNextBrushLifecyclePhase,
  element: DrawEl,
  input: StudioEngineVNextBrushLifecycleParityInput,
): CompiledPhase | StudioEngineVNextBrushLifecycleParityRejection {
  if (!selectionMatches(input.selection, element)) {
    return reject(
      "selection-mismatch",
      "The persisted runtime/catalogue identity no longer matches the selected Brush Library item.",
      phase,
    );
  }
  const envelope = PHASE_ENVELOPE[phase];
  const adapted = adaptStudioDrawElementToCanonicalBrushPlan({
    element,
    ...envelope,
    firstSampleSequence: input.firstSampleSequence ?? 0,
    firstTimeMilliseconds: input.firstTimeMilliseconds ?? 0,
    fallbackSampleIntervalMilliseconds: input.fallbackSampleIntervalMilliseconds ?? 4,
    pointerId: 0,
    flags: 0,
    colorSpace: input.colorSpace ?? "linear-srgb",
    transform: input.transform ?? IDENTITY_TRANSFORM,
  });
  if (adapted.status !== "ready") {
    return reject(
      "canonical-adapter-rejected",
      `${adapted.reason} at ${adapted.path}: ${adapted.detail}`,
      phase,
    );
  }

  const assets: AssetIdentity[] = [];
  for (const asset of adapted.assets) {
    const identity = assetIdentity(asset);
    if (!identity) {
      return reject(
        "asset-integrity-mismatch",
        "A content-addressed canonical brush asset does not match its bytes or byte length.",
        phase,
      );
    }
    assets.push(identity);
  }
  const visual = visualContract(adapted.plan, adapted.requirements, assets);
  const receipt = Object.freeze({
    phase,
    canonicalPlanHash: hashStudioCanonicalBrushPlan(adapted.plan),
    recipeDigest: digestCanonical(adapted.plan.recipe),
    visualContractDigest: digestCanonical(visual),
    strokeContentDigest: digestCanonical({
      visual,
      source: adapted.plan.source,
    }),
    authoritativeSampleCount: adapted.plan.source.samples.length,
  }) satisfies StudioEngineVNextBrushLifecyclePhaseReceipt;
  return Object.freeze({ phase, adapted, receipt });
}

function samplesAreExactPrefix(
  prefix: StudioCanonicalBrushPlan["source"],
  complete: StudioCanonicalBrushPlan["source"],
): boolean {
  if (prefix.samples.length > complete.samples.length) return false;
  for (let index = 0; index < prefix.samples.length; index += 1) {
    if (
      canonicalStudioCommandJson(prefix.samples[index])
      !== canonicalStudioCommandJson(complete.samples[index])
    ) return false;
  }
  return true;
}

/**
 * Verifies Brush Library identity and visual semantics across live, commit, reopen and export.
 *
 * The verifier never repairs or strips unsupported fields. A dynamic paint model without an exact
 * versioned canonical recipe is reported at the exact phase instead of silently rendering a
 * round-dab approximation.
 */
export function verifyStudioEngineVNextBrushLifecycleParity(
  input: StudioEngineVNextBrushLifecycleParityInput,
): StudioEngineVNextBrushLifecycleParityResult {
  if (!isStudioBrushCatalogSelection(input.selection)) {
    return reject("invalid-selection", "The Brush Library selection contract is invalid.");
  }

  try {
    const live = compilePhase("live", input.live, input);
    if ("status" in live) return live;
    const commit = compilePhase("commit", input.commit, input);
    if ("status" in commit) return commit;
    const reopen = compilePhase("reopen", input.reopened, input);
    if ("status" in reopen) return reopen;
    const exportPhase = compilePhase("export", input.exportSnapshot, input);
    if ("status" in exportPhase) return exportPhase;
    const phases = [live, commit, reopen, exportPhase] as const;

    const recipeDigest = commit.receipt.recipeDigest;
    if (phases.some((phase) => phase.receipt.recipeDigest !== recipeDigest)) {
      return reject(
        "recipe-mismatch",
        "At least one lifecycle phase compiled a different canonical brush recipe.",
      );
    }
    const visualContractDigest = commit.receipt.visualContractDigest;
    if (phases.some((phase) => phase.receipt.visualContractDigest !== visualContractDigest)) {
      return reject(
        "visual-contract-mismatch",
        "Colour, composite, seed, transform, requirements or content-addressed assets diverged.",
      );
    }
    if (!samplesAreExactPrefix(live.adapted.plan.source, commit.adapted.plan.source)) {
      return reject(
        "live-prefix-mismatch",
        "The live authoritative samples are not an exact prefix of the committed stroke.",
        "live",
      );
    }
    const committedStrokeDigest = commit.receipt.strokeContentDigest;
    if (
      reopen.receipt.strokeContentDigest !== committedStrokeDigest
      || exportPhase.receipt.strokeContentDigest !== committedStrokeDigest
    ) {
      return reject(
        "committed-source-mismatch",
        "Commit, reopened and export snapshots do not contain the same authoritative stroke.",
      );
    }

    const phaseReceipts = Object.freeze({
      live: live.receipt,
      commit: commit.receipt,
      reopen: reopen.receipt,
      export: exportPhase.receipt,
    });
    return Object.freeze({
      status: "verified",
      receipt: Object.freeze({
        kind: "studio-engine-vnext-brush-lifecycle-parity-receipt",
        version: STUDIO_ENGINE_VNEXT_BRUSH_LIFECYCLE_PARITY_VERSION,
        catalogId: input.selection.catalogId,
        catalogName: input.selection.catalogName,
        runtimeBrushId: input.selection.runtimeBrushId,
        selectionDigest: digestCanonical(input.selection),
        recipeDigest,
        visualContractDigest,
        committedStrokeDigest,
        liveIsCommitPrefix: true,
        sameCanonicalRecipe: true,
        sameVisualContract: true,
        sameCommittedStroke: true,
        phases: phaseReceipts,
        complete: true,
      }),
    });
  } catch {
    return reject(
      "identity-encoding-failed",
      "Lifecycle snapshots could not be encoded as bounded canonical JSON.",
    );
  }
}
