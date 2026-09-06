import {
  declareTrustedBootstrapProvider,
  EngineCapabilityRegistry,
  estimateProviderCost,
  HybridExecutionPlanner,
  planWithCostShadow,
  providerDescriptorSchema,
  quantizePow2Bucket,
  type CostShadowFingerprint,
  type CostShadowPlanRequest,
  type IslandCostShadowReceipt,
  type ProviderRuntime,
  type SurfaceCostShadowReceipt,
  type SurfacePlan,
} from "@toonspectrum/studio-engine-registry";

import {
  selectStudioStrokeRoute,
  type SelectStudioStrokeRouteResult,
  type StudioStrokeRouteTournamentState,
  type StudioStrokeRouteWorkloadTraits,
} from "./brush/studio-stroke-route-tournament";
import {
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY,
  resolveStudioStrokeSurfaceRoute,
  type StudioStrokeSurfaceRouteKind,
  type StudioStrokeSurfaceRouteSnapshotInput,
} from "./brush/studio-stroke-surface-route";

/**
 * V11 strangler bridge, step (b) of ADR 0001(개정): a shadow
 * HybridExecutionPlanner expresses the existing 8-lane stroke-surface ladder
 * as capability queries and is checked for exhaustive parity against
 * resolveStudioStrokeSurfaceRoute. It renders nothing and never touches the
 * live admission path — same pattern as studio-canonical-vnext-quality-shadow.
 *
 * Parity here is the delegation precondition: only after the planner provably
 * reproduces the pinned-route contract may step (c) route real strokes.
 *
 * V12 §5 (observation-only): an optional tournament probe projects the
 * renderer tournament's winner cache + kill switch onto admitted candidates
 * via selectStudioStrokeRoute. The probe can only be observed:
 * legacyKind/plannedKind/agrees and the
 * planner product are computed exactly as before, with or without a probe,
 * and a pristine probe (empty cache, nothing killed) reports the admitted
 * candidates unchanged. If every candidate is killed, only the observation
 * becomes explicitly unavailable; the authority plan remains untouched. No
 * component may consume this evidence as an execution or retry order.
 *
 * V13 §2.5 (GPU planning, cost shadow): the authority plan is produced through
 * planWithCostShadow so a real workload fingerprint — derived from the
 * tournament probe's stroke traits, the only scene signal this seam sees —
 * feeds the observation-only cost ranking. Disagreement receipts accumulate
 * module-level (readStudioSurfaceCostShadowReceipt) as promotion evidence.
 * Fail closed: a missing or malformed probe records an absent fingerprint and
 * ranks nothing; a cost-shadow observation failure is served by the unchanged
 * legacy planner; the legacy winner keeps sole routing authority either way.
 *
 * P-02c (full-ladder observation): the authority query is capability-narrowed
 * to the single lane the admission ladder already chose, so its cost receipt
 * ranks a singleton and disagreement evidence is structurally zero. A SECOND,
 * observation-only query therefore re-ranks the cost model over the FULL
 * admitted ladder ("stroke.route.any", filtered to the admitted lanes) and
 * feeds only the receipt — never the returned plan. It runs at most once per
 * coarse fingerprint bucket (admitted-lane signature × quantized workload
 * class) so the 8192-state parity loop and the pointerdown hot path stay
 * fast, and absent fingerprints skip it entirely.
 */

/**
 * Truthful runtime substrate per lane, mirrored from each lane's backing
 * implementation in BACKEND_DERIVATIONS (render/studio-engine-provider-bridge)
 * — the same policy render/studio-filter-plan-shadow.ts applies to its shadow
 * descriptors. Every authority query in this module is a capability-narrowed
 * singleton, so the runtime can never change the planner product (the
 * 8192-state parity suite proves it); it exists so the cost shadow's lane
 * classes are real. With the previous all-"js" placeholders every candidate
 * cost identically and full-ladder disagreement was structurally impossible.
 */
const STROKE_LANE_RUNTIME: Readonly<
  Record<StudioStrokeSurfaceRouteKind, ProviderRuntime>
> = Object.freeze({
  "living-ink": "webgpu", // webgpu-live-causal-ink
  hokusai: "wasm-worker", // hokusai-myb-worker
  stamp: "js", // canvas2d-stamp-pattern
  gpu: "webgpu", // canonical-webgpu-* stroke surface
  "live-ink": "js", // canvas2d-causal-ink live overlay
  "wet-ink": "js", // canvas2d-wet-field / wet-ribbon
  dynamic: "js", // canvas2d-dynamic-coverage
  konva: "js", // Konva canvas2d surface
});

/** Route lanes as V11 providers, ladder order = registration order. */
function buildShadowRegistry(): EngineCapabilityRegistry {
  const registry = new EngineCapabilityRegistry();
  STUDIO_STROKE_SURFACE_ROUTE_PRIORITY.forEach((kind) => {
    const descriptor = providerDescriptorSchema.parse({
      id: `stroke-route-${kind}`,
      kind: "raster-brush",
      displayName: `Studio stroke surface lane: ${kind}`,
      version: "route-v1",
      license: "internal",
      attribution: "",
      maturity: "production-baseline",
      runtime: STROKE_LANE_RUNTIME[kind],
      capabilities: [`stroke.route.${kind}`, "stroke.route.any"],
      limitations: [
        "provider failure is terminal for the selected route; no automatic lane substitution",
      ],
      previewQuality: "production",
      finalQuality: "production",
      determinism: "tolerance",
      memoryEstimateMb: 0,
      knownIssues: [],
    });
    registry.registerTrustedBootstrap(
      declareTrustedBootstrapProvider(descriptor, {
        classification: "checked-in-first-party",
        source: "apps/web/src/domains/creator/studio-surface-plan-shadow.ts",
        owner: "studio-brush-platform",
        justification: `checked-in Studio stroke surface route: ${kind}`,
      }),
    );
  });
  return registry;
}

function validIdentity(input: StudioStrokeSurfaceRouteSnapshotInput): boolean {
  return (
    typeof input.strokeId === "string" &&
    input.strokeId.trim().length > 0 &&
    Number.isSafeInteger(input.pointerId) &&
    input.pointerId >= 0 &&
    Number.isSafeInteger(input.strokeEpoch) &&
    input.strokeEpoch >= 0
  );
}

/**
 * Admission snapshot → set of admitted lanes. This is the shadow's independent
 * reading of the same admission contract the legacy resolver consumes; the
 * exhaustive parity test proves both readings identical over the full state
 * space, so a drift in either side fails CI.
 */
export function admittedLanes(
  input: StudioStrokeSurfaceRouteSnapshotInput,
): StudioStrokeSurfaceRouteKind[] {
  if (!validIdentity(input)) return ["konva"];
  const lanes: StudioStrokeSurfaceRouteKind[] = [];
  if (
    input.livingInk?.eligible === true &&
    input.livingInk.providerState === "ready" &&
    input.livingInk.capabilitiesAccepted === true &&
    input.livingInk.admitted === true
  ) {
    lanes.push("living-ink");
  }
  if (input.hokusai?.admitted === true && input.hokusai.surface === "supported") {
    lanes.push("hokusai");
  }
  if (input.stampAdmitted) lanes.push("stamp");
  if (input.gpuAdmitted) lanes.push("gpu");
  if (input.liveInkAdmitted) lanes.push("live-ink");
  if (input.wetInkAdmitted) lanes.push("wet-ink");
  if (input.dynamicAdmitted) lanes.push("dynamic");
  lanes.push("konva");
  return lanes;
}

/**
 * Optional V12 §5 tournament probe. `traits` describe the stroke workload the
 * bucket derives from; `state` is already-hydrated in-memory tournament state
 * (the shared StudioRendererTournamentRuntime satisfies it structurally).
 */
export interface StudioStrokeSurfaceShadowTournamentProbe {
  readonly traits: StudioStrokeRouteWorkloadTraits;
  readonly state: StudioStrokeRouteTournamentState;
}

export interface StudioV11SurfacePlanShadowResult {
  legacyKind: StudioStrokeSurfaceRouteKind;
  plannedKind: StudioStrokeSurfaceRouteKind;
  agrees: boolean;
  plan: SurfacePlan;
  /**
   * Observation-only tournament projection of admitted candidates. Null when
   * no probe was supplied. It may be empty with `all-providers-killed`, but it
   * never feeds back into legacyKind/plannedKind/plan.
   */
  tournament: SelectStudioStrokeRouteResult | null;
}

const shadowRegistry = buildShadowRegistry();
const shadowPlanner = new HybridExecutionPlanner(shadowRegistry);

/* ------------------------------------------------------------------ */
/* V13 §2.5 cost shadow — fingerprint assembly + receipt counters      */
/* ------------------------------------------------------------------ */

/**
 * Derives the cost-shadow workload fingerprint from the stroke traits the
 * tournament probe already carries — the only scene-shaped input this seam
 * sees. O(1) arithmetic on data in hand; no scene walk, no GPU work.
 *
 * Mapping (a live stroke is exactly one path):
 * - pathCount 1, segmentCount = sampled pointCount (each pointer sample
 *   extends the polyline by one segment);
 * - changedPathRatio 1 — a live stroke is fresh geometry every frame, so the
 *   incremental-repaint discount never applies;
 * - dpr = max(1, canvasScale): the stage scale multiplies presented device
 *   pixels exactly like the cost model's dpr² area term, floored at 1 the
 *   same way estimateProviderCost floors dpr.
 *
 * Fail closed: nullish traits or non-finite/negative counts yield undefined,
 * which planWithCostShadow records as `fingerprint: "absent"` — no ranking,
 * no disagreement evidence, legacy plan untouched.
 */
export function deriveStudioStrokeSurfaceCostFingerprint(
  traits: StudioStrokeRouteWorkloadTraits | null | undefined,
): CostShadowFingerprint | undefined {
  if (!traits) return undefined;
  if (!Number.isFinite(traits.pointCount) || traits.pointCount < 0) return undefined;
  if (!Number.isFinite(traits.canvasScale) || traits.canvasScale <= 0) return undefined;
  return {
    pathCount: 1,
    segmentCount: traits.pointCount,
    changedPathRatio: 1,
    imageCount: 0,
    glyphCount: 0,
    gradientCount: 0,
    isolatedLayerCount: 0,
    maskDepth: 0,
    filterNodeCount: 0,
    visibleAreaRatio: 1,
    dpr: Math.max(1, traits.canvasScale),
  };
}

/**
 * Module-level cost-shadow receipt — same counter idiom as
 * studio-filter-plan-shadow.ts. `agreed + disagreed + absentFingerprint ===
 * total`; `shadowFailures` counts plans the cost shadow could not observe
 * (the legacy planner served them) and is deliberately outside `total`.
 */
export interface StudioSurfaceCostShadowReceipt {
  /** Shadow plans that produced a cost receipt. */
  readonly total: number;
  /** Fingerprinted receipts where the cost winner matched the legacy winner. */
  readonly agreed: number;
  /** Fingerprinted receipts with strictly cheaper evidence for another lane. */
  readonly disagreed: number;
  /** Receipts recorded without a usable fingerprint (fail closed, no ranking). */
  readonly absentFingerprint: number;
  /** Cost-shadow failures; the legacy planner produced the plan unchanged. */
  readonly shadowFailures: number;
  readonly lastReceipt: SurfaceCostShadowReceipt | null;
  readonly lastDisagreement: SurfaceCostShadowReceipt | null;
  /**
   * P-02c full-ladder observation (second query, receipt-only): the cost
   * model re-ranked over every admitted lane — the multi-candidate ladder the
   * narrowed authority query collapses to a singleton. Ran at most once per
   * coarse fingerprint bucket; `fullLadderQueries === fullLadderAgreed +
   * fullLadderDisagreed`. Never feeds the returned plan.
   */
  readonly fullLadderQueries: number;
  /** Full-ladder rankings whose cheapest lane matched the authority winner. */
  readonly fullLadderAgreed: number;
  /** Full-ladder rankings with strictly cheaper evidence for another lane. */
  readonly fullLadderDisagreed: number;
  readonly lastFullLadderReceipt: IslandCostShadowReceipt | null;
  readonly lastFullLadderDisagreement: IslandCostShadowReceipt | null;
}

interface MutableCostShadowCounters {
  total: number;
  agreed: number;
  disagreed: number;
  absentFingerprint: number;
  shadowFailures: number;
  lastReceipt: SurfaceCostShadowReceipt | null;
  lastDisagreement: SurfaceCostShadowReceipt | null;
  fullLadderQueries: number;
  fullLadderAgreed: number;
  fullLadderDisagreed: number;
  lastFullLadderReceipt: IslandCostShadowReceipt | null;
  lastFullLadderDisagreement: IslandCostShadowReceipt | null;
}

function emptyCostShadowCounters(): MutableCostShadowCounters {
  return {
    total: 0,
    agreed: 0,
    disagreed: 0,
    absentFingerprint: 0,
    shadowFailures: 0,
    lastReceipt: null,
    lastDisagreement: null,
    fullLadderQueries: 0,
    fullLadderAgreed: 0,
    fullLadderDisagreed: 0,
    lastFullLadderReceipt: null,
    lastFullLadderDisagreement: null,
  };
}

let costShadowCounters = emptyCostShadowCounters();

/**
 * Coarse-bucket memo for the full-ladder observation: one entry per
 * admitted-lane signature × power-of-two workload class. Bounded by the 128
 * possible admitted-lane sets times a handful of size classes, so it can
 * never grow with plan volume.
 */
const fullLadderSeenBuckets = new Set<string>();

export function readStudioSurfaceCostShadowReceipt(): StudioSurfaceCostShadowReceipt {
  return Object.freeze({ ...costShadowCounters });
}

/** Test seam — each suite starts from a clean slate. */
export function resetStudioSurfaceCostShadowReceipt(): void {
  costShadowCounters = emptyCostShadowCounters();
  fullLadderSeenBuckets.clear();
}

function recordSurfaceCostShadowReceipt(receipt: SurfaceCostShadowReceipt): void {
  costShadowCounters.total += 1;
  costShadowCounters.lastReceipt = receipt;
  const fingerprinted = receipt.islands.some((island) => island.fingerprint !== "absent");
  if (!fingerprinted) costShadowCounters.absentFingerprint += 1;
  else if (receipt.agreed) costShadowCounters.agreed += 1;
  else {
    costShadowCounters.disagreed += 1;
    costShadowCounters.lastDisagreement = receipt;
  }
}

/**
 * P-02c: coarse memo key for the full-ladder observation. The admitted-lane
 * signature pins the ladder (and thereby the authority winner); the quantized
 * segment/dpr classes pool nearby workloads exactly like the tournament's
 * scene-fingerprint buckets, so a stroke in progress re-ranks once, not per
 * pointer sample.
 */
function strokeFullLadderBucket(
  lanes: readonly StudioStrokeSurfaceRouteKind[],
  fingerprint: CostShadowFingerprint,
): string {
  return `${lanes.join(">")}|seg${quantizePow2Bucket(fingerprint.segmentCount)}|dpr${quantizePow2Bucket(fingerprint.dpr)}`;
}

/**
 * P-02c second query — observation only. Re-ranks the cost model over the
 * FULL admitted ladder (the "stroke.route.any" candidates restricted to the
 * lanes the admission snapshot admitted) against the authority winner, and
 * records the outcome into the receipt counters. Nothing here can reach the
 * returned plan: the function has no return value and no caller reads its
 * effects on the planning path. Ranking only admitted lanes keeps the
 * evidence honest — a cheaper but inadmissible lane must never look like a
 * disagreement (fail closed, quality never traded for cost).
 */
function observeStrokeFullLadderCosts(
  lanes: readonly StudioStrokeSurfaceRouteKind[],
  legacyWinner: string,
  fingerprint: CostShadowFingerprint | undefined,
): void {
  if (fingerprint === undefined) return;
  const bucket = strokeFullLadderBucket(lanes, fingerprint);
  if (fullLadderSeenBuckets.has(bucket)) return;
  fullLadderSeenBuckets.add(bucket);
  const admittedIds = new Set(lanes.map((kind) => `stroke-route-${kind}`));
  const candidates = shadowRegistry
    .query("raster-brush", ["stroke.route.any"])
    .filter((candidate) => admittedIds.has(candidate.descriptor.id));
  // A singleton ladder cannot disagree by construction — recording it would
  // pad the agreement count with structural zeros, which is exactly the
  // evidence defect this second query exists to fix.
  if (candidates.length < 2) return;
  const costs = candidates
    .map((candidate) => estimateProviderCost(candidate.descriptor, fingerprint))
    .sort((a, b) =>
      a.total !== b.total ? a.total - b.total : a.providerId < b.providerId ? -1 : 1,
    );
  const cheapest = costs[0];
  if (cheapest === undefined) return;
  // Exact-total ties defer to the authority winner: disagreement requires
  // strictly cheaper evidence — same rule as planWithCostShadow.
  const legacyTiesCheapest = costs.some(
    (cost) => cost.total === cheapest.total && cost.providerId === legacyWinner,
  );
  const costWinner = legacyTiesCheapest ? legacyWinner : cheapest.providerId;
  const observation: IslandCostShadowReceipt = {
    islandId: "live-stroke",
    legacyWinner,
    costWinner,
    agreed: costWinner === legacyWinner,
    fingerprint,
    costs,
  };
  costShadowCounters.fullLadderQueries += 1;
  costShadowCounters.lastFullLadderReceipt = observation;
  if (observation.agreed) costShadowCounters.fullLadderAgreed += 1;
  else {
    costShadowCounters.fullLadderDisagreed += 1;
    costShadowCounters.lastFullLadderDisagreement = observation;
  }
}

/**
 * Authority plan through the cost shadow. The returned plan is byte-identical
 * to `shadowPlanner.plan(request)` — planWithCostShadow runs the legacy
 * selection first and only observes alongside it. If the call throws, the
 * legacy planner is re-run alone to disambiguate: an unsatisfiable request
 * rethrows here exactly as before the cost shadow existed, while a legacy
 * success means only the shadow side broke — counted, plan served (fail
 * closed).
 */
function planSurfaceShadowWithCostReceipt(request: CostShadowPlanRequest): SurfacePlan {
  let receipt: SurfaceCostShadowReceipt;
  let plan: SurfacePlan;
  try {
    ({ plan, receipt } = planWithCostShadow(shadowRegistry, request));
  } catch {
    const legacyPlan = shadowPlanner.plan(request);
    costShadowCounters.shadowFailures += 1;
    return legacyPlan;
  }
  recordSurfaceCostShadowReceipt(receipt);
  return plan;
}

export function planStudioStrokeSurfaceShadow(
  input: StudioStrokeSurfaceRouteSnapshotInput,
  tournamentProbe?: StudioStrokeSurfaceShadowTournamentProbe,
): StudioV11SurfacePlanShadowResult {
  const lanes = admittedLanes(input);
  // Highest-priority admitted lane, expressed as a capability disjunction:
  // the ladder is encoded once (registration order); the planner asks for the
  // first lane the ladder admits.
  const targetLane = STUDIO_STROKE_SURFACE_ROUTE_PRIORITY.find((kind) =>
    lanes.includes(kind),
  );
  // V13 §2.5: the probe's traits are the real workload data this seam holds;
  // no probe (or malformed traits) ⇒ undefined ⇒ receipt records "absent".
  const fingerprint = deriveStudioStrokeSurfaceCostFingerprint(
    tournamentProbe?.traits,
  );
  const plan = planSurfaceShadowWithCostReceipt({
    surfaceId: `shadow:${input.strokeEpoch}:${input.pointerId}:${input.strokeId}`,
    mode: "interactive",
    primaryOwnerId: `stroke-route-${targetLane ?? "konva"}`,
    islands: [
      {
        islandId: "live-stroke",
        kind: "raster-brush",
        requiredCapabilities: [`stroke.route.${targetLane ?? "konva"}`],
        selectedProviderId: `stroke-route-${targetLane ?? "konva"}`,
        availableTransports: ["same-gpu-texture", "image-bitmap"],
        ...(fingerprint === undefined ? {} : { fingerprint }),
      },
    ],
  });
  const plannedProviderId = plan.islands[0]?.providerId ?? "stroke-route-konva";
  // P-02c: second, observation-only query over the full admitted ladder.
  // Feeds only the receipt counters; the plan above is already final.
  observeStrokeFullLadderCosts(lanes, plannedProviderId, fingerprint);
  const plannedKind = plannedProviderId.replace(
    "stroke-route-",
    "",
  ) as StudioStrokeSurfaceRouteKind;
  const legacyKind = resolveStudioStrokeSurfaceRoute(input).kind;
  // Observation only: the tournament projection runs after (and independent
  // of) the parity computation, so a probe can never alter the shadow verdict.
  const tournament = tournamentProbe
    ? selectStudioStrokeRoute({
        lanes,
        traits: tournamentProbe.traits,
        state: tournamentProbe.state,
      })
    : null;
  return {
    legacyKind,
    plannedKind,
    agrees: legacyKind === plannedKind,
    plan,
    tournament,
  };
}
