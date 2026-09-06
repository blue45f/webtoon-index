/**
 * Professional brush-shelf route admission contract.
 *
 * The procedural catalogue stores durable strokes on three generic runtime identities. That is a
 * persistence detail, not permission to render a named bristle, knife or physical-particle brush
 * with the generic coverage backend. This contract records the specialist route each high-value
 * shelf preset is expected to use and keeps admission fail-closed until the owning runtime reports
 * an exact live/commit pair as ready.
 *
 * This module does not activate providers or change StudioPage routing. It is a deterministic
 * acceptance boundary for the product integration that follows.
 */

import {
  classifyStudioBrushBackendQuality,
  type StudioBrushBackendAvailability,
  type StudioBrushBackendId,
  type StudioBrushBackendQualityFamily,
  type StudioBrushBackendRouteProfile,
} from "./brush/studio-brush-backend-quality-policy";
import {
  studioBrushPackDescriptorById,
  type StudioBrushPackRuntimeBrushId,
} from "./brush/studio-brush-pack-index";

import type { StudioBrushPackCatalogId } from "./brush/studio-brush-pack-id";

export const STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACT_VERSION = 1 as const;

export const STUDIO_PROFESSIONAL_SHELF_GENERIC_RUNTIME_CARRIERS = Object.freeze([
  "ink-particle",
  "airbrush",
  "dry-media",
] as const satisfies readonly StudioBrushPackRuntimeBrushId[]);

type StudioProfessionalShelfGenericRuntimeCarrier =
  (typeof STUDIO_PROFESSIONAL_SHELF_GENERIC_RUNTIME_CARRIERS)[number];

function isStudioProfessionalShelfGenericRuntimeCarrier(
  runtimeBrushId: string,
): runtimeBrushId is StudioProfessionalShelfGenericRuntimeCarrier {
  return (STUDIO_PROFESSIONAL_SHELF_GENERIC_RUNTIME_CARRIERS as readonly string[])
    .includes(runtimeBrushId);
}

export const STUDIO_PROFESSIONAL_SHELF_TARGET_IDS = Object.freeze([
  "bristle-round-loaded",
  "bristle-fan-dry",
  "bristle-flat-streak",
  "oil-filbert",
  "palette-knife-edge",
  "smoke-wisp-layered",
  "flame-tongue-spark",
  "snow-powder-drift",
  "dust-mote-depth",
  "stage-safe-splatter",
  "leaf-fall-flurry",
] as const satisfies readonly StudioBrushPackCatalogId[]);

export type StudioProfessionalShelfTargetId =
  (typeof STUDIO_PROFESSIONAL_SHELF_TARGET_IDS)[number];

export type StudioProfessionalShelfSemanticProfile =
  | "loaded-bristle-v1"
  | "dry-bristle-v1"
  | "palette-knife-edge-v1"
  | "physics-particle-v1";

export interface StudioProfessionalShelfRouteCandidate {
  readonly liveBackend: StudioBrushBackendId;
  readonly commitBackend: StudioBrushBackendId;
  readonly semanticContract: string;
}

export interface StudioProfessionalShelfRouteContract {
  readonly contractVersion: typeof STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACT_VERSION;
  readonly catalogId: StudioProfessionalShelfTargetId;
  readonly family: StudioBrushBackendQualityFamily;
  readonly routeProfile: StudioBrushBackendRouteProfile;
  readonly semanticProfile: StudioProfessionalShelfSemanticProfile;
  /** Durable catalogue carrier today; never a specialist-rendering quality claim. */
  readonly genericRuntimeCarrier: StudioBrushPackRuntimeBrushId;
  readonly candidates: readonly StudioProfessionalShelfRouteCandidate[];
  readonly unavailablePolicy: Readonly<{
    readonly behavior: "fail-closed";
    readonly preserveExistingSurface: true;
    readonly emitApproximation: false;
  }>;
}

const FAIL_CLOSED = Object.freeze({
  behavior: "fail-closed",
  preserveExistingSurface: true,
  emitApproximation: false,
} as const);

const LOADED_BRISTLE_CANDIDATES = routeCandidates(
  ["professional-bristle-webgpu", "professional-loaded-bristle-v1"],
  ["fiber-bristle-worker", "individual-fiber-wet-v1"],
  ["canvas2d-material-specialist", "retained-wet-material-v1"],
);

const DRY_BRISTLE_CANDIDATES = routeCandidates(
  ["professional-bristle-webgpu", "professional-dry-bristle-v1"],
  ["fiber-bristle-worker", "individual-fiber-dry-v1"],
  ["canvas2d-material-specialist", "retained-dry-material-v1"],
);

const PALETTE_KNIFE_CANDIDATES = routeCandidates(
  ["canvas2d-material-specialist", "retained-wet-material-v1"],
);

const PHYSICS_PARTICLE_CANDIDATES = routeCandidates(
  ["physics-particle-worker", "physics-particle-v1"],
);

function routeCandidates(
  ...rows: readonly (readonly [
    backend: StudioBrushBackendId,
    semanticContract: string,
  ])[]
): readonly StudioProfessionalShelfRouteCandidate[] {
  return Object.freeze(rows.map(([backend, semanticContract]) => Object.freeze({
    liveBackend: backend,
    commitBackend: backend,
    semanticContract,
  })));
}

function shelfContract(
  catalogId: StudioProfessionalShelfTargetId,
  family: StudioBrushBackendQualityFamily,
  routeProfile: StudioBrushBackendRouteProfile,
  semanticProfile: StudioProfessionalShelfSemanticProfile,
  genericRuntimeCarrier: StudioBrushPackRuntimeBrushId,
  candidates: readonly StudioProfessionalShelfRouteCandidate[],
): StudioProfessionalShelfRouteContract {
  return Object.freeze({
    contractVersion: STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACT_VERSION,
    catalogId,
    family,
    routeProfile,
    semanticProfile,
    genericRuntimeCarrier,
    candidates,
    unavailablePolicy: FAIL_CLOSED,
  });
}

export const STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS:
readonly StudioProfessionalShelfRouteContract[] = Object.freeze([
  shelfContract(
    "bristle-round-loaded",
    "wet-media",
    "wet-specialist",
    "loaded-bristle-v1",
    "ink-particle",
    LOADED_BRISTLE_CANDIDATES,
  ),
  shelfContract(
    "bristle-fan-dry",
    "dry-media",
    "dry-specialist",
    "dry-bristle-v1",
    "dry-media",
    DRY_BRISTLE_CANDIDATES,
  ),
  shelfContract(
    "bristle-flat-streak",
    "wet-media",
    "wet-specialist",
    "loaded-bristle-v1",
    "dry-media",
    LOADED_BRISTLE_CANDIDATES,
  ),
  shelfContract(
    "oil-filbert",
    "wet-media",
    "wet-specialist",
    "loaded-bristle-v1",
    "dry-media",
    LOADED_BRISTLE_CANDIDATES,
  ),
  shelfContract(
    "palette-knife-edge",
    "wet-media",
    "wet-specialist",
    "palette-knife-edge-v1",
    "ink-particle",
    PALETTE_KNIFE_CANDIDATES,
  ),
  ...([
    ["smoke-wisp-layered", "airbrush"],
    ["flame-tongue-spark", "ink-particle"],
    ["snow-powder-drift", "airbrush"],
    ["dust-mote-depth", "airbrush"],
    ["stage-safe-splatter", "ink-particle"],
    ["leaf-fall-flurry", "ink-particle"],
  ] as const).map(([catalogId, genericRuntimeCarrier]) => shelfContract(
    catalogId,
    "spray-particle",
    "spray-specialist",
    "physics-particle-v1",
    genericRuntimeCarrier,
    PHYSICS_PARTICLE_CANDIDATES,
  )),
]);

const CONTRACT_BY_ID: ReadonlyMap<
  StudioProfessionalShelfTargetId,
  StudioProfessionalShelfRouteContract
> = new Map(
  STUDIO_PROFESSIONAL_SHELF_ROUTE_CONTRACTS.map((contract) => [
    contract.catalogId,
    contract,
  ]),
);

export function studioProfessionalShelfRouteContractById(
  value: unknown,
): StudioProfessionalShelfRouteContract | null {
  return typeof value === "string"
    ? CONTRACT_BY_ID.get(value as StudioProfessionalShelfTargetId) ?? null
    : null;
}

export type StudioProfessionalShelfRouteAlignment =
  | Readonly<{
      status: "aligned";
      contract: StudioProfessionalShelfRouteContract;
      currentRouteProfile: StudioBrushBackendRouteProfile;
    }>
  | Readonly<{
      status: "generic-carrier-downgrade";
      contract: StudioProfessionalShelfRouteContract;
      currentFamily: StudioBrushBackendQualityFamily;
      currentRouteProfile: StudioBrushBackendRouteProfile;
      currentGenericCarrier: StudioBrushPackRuntimeBrushId;
    }>
  | Readonly<{
      status: "route-profile-mismatch";
      contract: StudioProfessionalShelfRouteContract;
      currentFamily: StudioBrushBackendQualityFamily;
      currentRouteProfile: StudioBrushBackendRouteProfile;
      currentRuntimeBrushId: string;
    }>
  | Readonly<{
      status: "unmanaged";
    }>
  | Readonly<{
      status: "contract-invalid";
      contract: StudioProfessionalShelfRouteContract;
    }>;

/**
 * Reports whether the current catalogue classification reaches the specialist route expected by
 * this contract. Connected bristle/knife materials now align with the synchronous Canvas
 * specialist; still-unwired physics FX remain explicit three-carrier downgrades rather than being
 * mislabeled as specialist-ready.
 */
export function inspectStudioProfessionalShelfRouteAlignment(
  catalogId: unknown,
): StudioProfessionalShelfRouteAlignment {
  const contract = studioProfessionalShelfRouteContractById(catalogId);
  if (!contract) return { status: "unmanaged" };
  const descriptor = studioBrushPackDescriptorById(contract.catalogId);
  const classification = classifyStudioBrushBackendQuality({
    catalogId: contract.catalogId,
  });
  if (
    !descriptor
    || descriptor.runtimeBrushId !== contract.genericRuntimeCarrier
    || classification.status !== "classified"
    || classification.identity.source !== "pro"
  ) {
    return { status: "contract-invalid", contract };
  }
  const { identity } = classification;
  if (
    identity.family === contract.family
    && identity.routeProfile === contract.routeProfile
  ) {
    return {
      status: "aligned",
      contract,
      currentRouteProfile: identity.routeProfile,
    };
  }
  if (isStudioProfessionalShelfGenericRuntimeCarrier(identity.runtimeBrushId)) {
    return {
      status: "generic-carrier-downgrade",
      contract,
      currentFamily: identity.family,
      currentRouteProfile: identity.routeProfile,
      currentGenericCarrier: identity.runtimeBrushId,
    };
  }
  return {
    status: "route-profile-mismatch",
    contract,
    currentFamily: identity.family,
    currentRouteProfile: identity.routeProfile,
    currentRuntimeBrushId: identity.runtimeBrushId,
  };
}

export interface StudioProfessionalShelfRouteInput {
  readonly catalogId: unknown;
  /**
   * Caller-owned readiness snapshot. Omission never inherits an audit default: a target provider
   * must explicitly report ready for this stroke before it can own live or committed pixels.
   */
  readonly availability?: Readonly<Partial<
    Record<StudioBrushBackendId, StudioBrushBackendAvailability>
  >>;
}

export type StudioProfessionalShelfRouteResult =
  | Readonly<{
      status: "ready";
      contract: StudioProfessionalShelfRouteContract;
      liveBackend: StudioBrushBackendId;
      commitBackend: StudioBrushBackendId;
      semanticContract: string;
    }>
  | Readonly<{
      status: "pending";
      reason: "specialist-backend-loading";
      contract: StudioProfessionalShelfRouteContract;
      preserveExistingSurface: true;
      emitApproximation: false;
    }>
  | Readonly<{
      status: "blocked";
      reason: "specialist-backend-unavailable";
      contract: StudioProfessionalShelfRouteContract;
      preserveExistingSurface: true;
      emitApproximation: false;
    }>
  | Readonly<{
      status: "unmanaged";
    }>;

function explicitAvailability(
  backend: StudioBrushBackendId,
  availability: StudioProfessionalShelfRouteInput["availability"],
): StudioBrushBackendAvailability {
  const value = availability?.[backend];
  return value === "ready"
    || value === "loading"
    || value === "unavailable"
    || value === "failed"
    ? value
    : "unavailable";
}

/**
 * Selects the first exact specialist pair whose live and commit runtimes are explicitly ready.
 * Generic coverage backends are not candidates and therefore cannot silently satisfy this gate.
 */
export function resolveStudioProfessionalShelfRoute(
  input: StudioProfessionalShelfRouteInput,
): StudioProfessionalShelfRouteResult {
  const contract = studioProfessionalShelfRouteContractById(input.catalogId);
  if (!contract) return { status: "unmanaged" };
  let loading = false;
  for (const candidate of contract.candidates) {
    const live = explicitAvailability(candidate.liveBackend, input.availability);
    const commit = explicitAvailability(candidate.commitBackend, input.availability);
    if (live === "ready" && commit === "ready") {
      return Object.freeze({
        status: "ready",
        contract,
        liveBackend: candidate.liveBackend,
        commitBackend: candidate.commitBackend,
        semanticContract: candidate.semanticContract,
      });
    }
    if (live === "loading" || commit === "loading") loading = true;
  }
  if (loading) {
    return {
      status: "pending",
      reason: "specialist-backend-loading",
      contract,
      preserveExistingSurface: true,
      emitApproximation: false,
    };
  }
  return {
    status: "blocked",
    reason: "specialist-backend-unavailable",
    contract,
    preserveExistingSurface: true,
    emitApproximation: false,
  };
}
