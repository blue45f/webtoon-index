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
  type SurfaceCostShadowReceipt,
  type SurfacePlan,
} from "@toonspectrum/studio-engine-registry";

import {
  getStudioTournamentRuntime,
  peekStudioTournamentRuntime,
} from "../studio-renderer-tournament-runtime";

import {
  megapixelsOf,
  type StudioFilterLane,
  type StudioFilterLaneCostRanking,
} from "./studio-filter-lane-cost-model";

/**
 * One-provider image-filter planning boundary.
 *
 * Capability inspection selects WebGPU for a supported chain or the dedicated
 * Worker for a chain that is unsupported before execution starts. `lanes` is
 * retained only as a one-item compatibility projection for existing receipts;
 * it is not a retry list. A killed or failed selected provider is unavailable
 * and cannot grant Konva or another provider permission to execute the same
 * operation.
 *
 * The workload fingerprint and cost receipt remain observation-only evidence.
 * They may describe the selected provider but never reorder or replace it.
 * The final readback is explicit in the selected island's `final-export`
 * contract; there are no intermediate interactive-path readbacks.
 */

export type { StudioFilterLane } from "./studio-filter-lane-cost-model";

const LANE_PROVIDER_PREFIX = "filter-lane-";

function buildFilterRegistry(): EngineCapabilityRegistry {
  const registry = new EngineCapabilityRegistry();
  const lanes: Array<{
    lane: StudioFilterLane;
    displayName: string;
    runtime: "webgpu" | "js";
    limitations: string[];
  }> = [
    {
      lane: "gpu-chain",
      displayName: "WebGPU filter chain (M1, single terminal readback)",
      runtime: "webgpu",
      limitations: [
        "supported 5-field chains only — isStudioGpuFilterChainEligible gates admission",
        "unsupported chain or device loss reports this selected lane unavailable",
      ],
    },
    {
      lane: "worker",
      displayName: "Dedicated-worker CPU filter pipeline",
      runtime: "js",
      limitations: ["worker-required chains fail closed and preserve the last presented frame"],
    },
    {
      lane: "konva-native",
      displayName: "Konva synchronous cache filters",
      runtime: "js",
      limitations: ["manual compatibility/reference lane; never selected after another lane fails"],
    },
  ];
  for (const entry of lanes) {
    const descriptor = providerDescriptorSchema.parse({
      id: `${LANE_PROVIDER_PREFIX}${entry.lane}`,
      kind: "filter",
      displayName: entry.displayName,
      version: "studio-filter-island-v1",
      license: "internal",
      attribution: "",
      maturity: "production-baseline",
      runtime: entry.runtime,
      capabilities: [`filter.lane.${entry.lane}`, "filter.phase.final"],
      limitations: entry.limitations,
      previewQuality: "production",
      finalQuality: "production",
      determinism: "tolerance",
      memoryEstimateMb: entry.runtime === "webgpu" ? 24 : 8,
      knownIssues: [],
    });
    registry.registerTrustedBootstrap(
      declareTrustedBootstrapProvider(descriptor, {
        classification: "checked-in-first-party",
        source: "apps/web/src/domains/creator/studio-filter-island-plan.ts",
        owner: "studio-imaging",
        justification: `checked-in Studio filter island lane: ${entry.lane}`,
      }),
    );
  }
  return registry;
}

const filterRegistry = buildFilterRegistry();
const filterPlanner = new HybridExecutionPlanner(filterRegistry);

/* ------------------------------------------------------------------ */
/* Tournament persistence bootstrap — off the interactive path         */
/* ------------------------------------------------------------------ */

/**
 * Planning a filter island used to install the SQLite/OPFS tournament
 * persistence adapter and hydrate the shared runtime *synchronously on the
 * user's click*. Hydration then dynamic-imported `@sqlite.org/sqlite-wasm`,
 * so opening the filter dialog transferred 1.03 MB of which 928 KB
 * (865 KB wasm + 63 KB glue) was tournament telemetry — 90% of the cost of a
 * feature that does not use it (docs/perf/heavy-feature-findings.md §4-4).
 *
 * Persistence is now loaded lazily, once, on an idle callback *after* the
 * first plan has already been returned. Planning itself stays pure and
 * synchronous and reads only in-memory state, so nothing on the interactive
 * path can pull wasm.
 */
export interface StudioFilterTournamentBootstrap {
  /** Idle-time scheduler. Must never run its task synchronously. */
  schedule: (task: () => void) => void;
  /** Loads the persistence glue (dynamic import in production). */
  loadPersistence: () => Promise<{
    installStudioTournamentSqlitePersistence: () => void;
  }>;
}

const DEFAULT_TOURNAMENT_BOOTSTRAP: StudioFilterTournamentBootstrap = {
  schedule: (task) => {
    const idle = (
      globalThis as {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => unknown;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") idle(() => task(), { timeout: 4_000 });
    else globalThis.setTimeout(task, 0);
  },
  loadPersistence: () => import("../studio-tournament-sqlite-persistence"),
};

let tournamentBootstrap = DEFAULT_TOURNAMENT_BOOTSTRAP;
let tournamentBootstrapStarted = false;

/**
 * Test seam for the idle bootstrap. `null` restores the production behaviour
 * and re-arms the one-shot so each suite starts from a clean slate.
 */
export function installStudioFilterTournamentBootstrap(
  bootstrap: StudioFilterTournamentBootstrap | null,
): void {
  tournamentBootstrap = bootstrap ?? DEFAULT_TOURNAMENT_BOOTSTRAP;
  tournamentBootstrapStarted = false;
}

function scheduleTournamentBootstrap(): void {
  if (tournamentBootstrapStarted) return;
  tournamentBootstrapStarted = true;
  const bootstrap = tournamentBootstrap;
  bootstrap.schedule(() => {
    void bootstrap
      .loadPersistence()
      .then(async (module) => {
        // Must be installed before the shared runtime is first created —
        // getStudioTournamentRuntime() below resolves the adapter once.
        module.installStudioTournamentSqlitePersistence();
        const runtime = getStudioTournamentRuntime();
        await runtime.hydrate();
        const status = runtime.persistenceStatus();
        if (!status.durable) {
          console.warn(
            "studio filter tournament is memory-only; SQLite/OPFS persistence is unavailable",
            status,
          );
        }
      })
      .catch((error: unknown) => {
        // Do not construct a replacement runtime after a failed module load.
        // The selected provider remains unchanged and the failure is
        // observable for Studio reliability status/telemetry.
        console.warn("studio tournament persistence bootstrap skipped", error);
      });
  });
}

/**
 * Pixels and chain length for the element being filtered. Either give a pixel
 * count directly or the dimensions to multiply; `chainSteps` is the number of
 * filter passes (Konva filter array length), which is what the CPU lanes are
 * linear in.
 */
export type StudioFilterIslandWorkload = {
  /** Filter passes the CPU lanes run. Values < 1 are treated as 1. */
  chainSteps: number;
  /** GPU dispatches after LUT fusion; derived from chainSteps when omitted. */
  gpuDispatchCount?: number;
} & ({ pixelCount: number } | { width: number; height: number });

export interface StudioFilterIslandPlanInput {
  /** Result of isStudioGpuFilterChainEligible for the current element. */
  gpuChainEligible: boolean;
  /**
   * Size + chain length of the work. Omitted/null keeps the historical
   * size-blind selection byte-for-byte (callers that cannot measure their
   * workload must not be silently reassigned).
   */
  workload?: StudioFilterIslandWorkload | null;
}

export interface StudioFilterIslandPlan {
  /** Compatibility projection of the one selected lane; it is never a retry ladder. */
  lanes: readonly [StudioFilterLane];
  /** The only provider allowed to execute this filter operation. */
  selectedLane: StudioFilterLane;
  /** A killed selected provider is unavailable; another provider is not substituted. */
  status: "selected" | "unavailable";
  unavailableReason: "selected-provider-killed" | null;
  plan: SurfacePlan;
  /**
   * Cost ranking that produced the pre-tournament order, or null when the
   * caller passed no workload or the selected provider has no useful comparison.
   */
  laneCosts: StudioFilterLaneCostRanking | null;
}

function resolvePixelCount(workload: StudioFilterIslandWorkload): number {
  if ("pixelCount" in workload) return workload.pixelCount;
  return workload.width * workload.height;
}

/* ------------------------------------------------------------------ */
/* V13 §2.5 cost shadow — fingerprint assembly + receipt counters      */
/* ------------------------------------------------------------------ */

/**
 * AREA ENCODING CONTRACT (shared with
 * `@toonspectrum/studio-engine-registry`'s `presentedMegapixels`, which is the
 * only consumer of these two fields):
 *
 *     presentedMegapixels = clamp01(visibleAreaRatio) × max(1, dpr)²
 *                           × COST_MODEL_REFERENCE.referenceSurfaceMegapixels  (= 1 MP)
 *
 * Two clamps constrain how an island's true area can be expressed:
 * `visibleAreaRatio` is clamped into [0, 1], and `dpr` is FLOORED AT 1 (a
 * sub-1 dpr must never shrink work below the logical surface). So the area
 * factor must be split across the two fields by regime:
 *
 * - `megapixels >= 1` ⇒ `visibleAreaRatio = 1`, `dpr = √megapixels`
 *   (dpr carries the whole factor; the ratio is saturated).
 * - `megapixels < 1`  ⇒ `dpr = 1`, `visibleAreaRatio = megapixels`
 *   (dpr is pinned at its floor; the ratio carries the whole factor).
 *
 * Both branches satisfy `visibleAreaRatio × max(1, dpr)² === megapixels`
 * exactly, and they agree at the seam (megapixels === 1 ⇒ 1 × 1² = 1).
 *
 * This split is load-bearing evidence, not cosmetics. The previous encoding
 * was `dpr = √max(1, megapixels), visibleAreaRatio = 1`, whose `max(1, …)`
 * floored EVERY sub-megapixel island to a full 1 MP. The registry's newly
 * calibrated `fixedMs + perMegapixelMs × megapixels` model has a real lane
 * crossover — the gpu lane's measured ~2.4 ms submit floor only amortizes
 * once the area is large enough — so flattening every small island to 1 MP
 * made the crossover structurally unobservable: small islands rendered as
 * 1 MP always land on the gpu side of it.
 *
 * A followup may lift this helper into the registry package so both sides
 * import one encoder instead of restating the contract.
 */
function encodeIslandAreaFactor(megapixels: number): {
  visibleAreaRatio: number;
  dpr: number;
} {
  if (megapixels >= 1) return { visibleAreaRatio: 1, dpr: Math.sqrt(megapixels) };
  return { visibleAreaRatio: megapixels, dpr: 1 };
}

/**
 * Derives the cost-shadow workload fingerprint from the island fields the
 * caller already supplies. O(1) arithmetic on data in hand.
 *
 * Mapping (mirrors fingerprintRenderScene's filter-group accounting):
 * - filterNodeCount = chainSteps (one graph node per filter pass, clamped to
 *   ≥1 the same way the cost tier clamps it);
 * - isolatedLayerCount 1 — the island always runs as one forced offscreen
 *   isolation; imageCount 1 — the filtered element's bitmap;
 * - changedPathRatio 1 — a filter run recomputes fully (inert here anyway:
 *   the island carries no path geometry);
 * - visibleAreaRatio + dpr per {@link encodeIslandAreaFactor}: the model's
 *   area factor (visibleAreaRatio × max(1, dpr)²) equals the island's TRUE
 *   megapixels — sub-megapixel islands included — making per-area
 *   raster/layering/transfer terms linear in island size, the same scaling
 *   studio-filter-lane-cost-model uses.
 *
 * Fail closed: a nullish workload, a non-finite/non-positive pixel count, or
 * an area that does not survive the conversion as a strictly positive finite
 * number (e.g. a denormal pixel count underflowing to 0 megapixels) yields
 * undefined, which planWithCostShadow records as `fingerprint: "absent"` — no
 * ranking, no disagreement evidence, legacy plan untouched. A fabricated
 * stand-in area would be worse than no evidence at all.
 */
export function deriveStudioFilterIslandCostFingerprint(
  workload: StudioFilterIslandWorkload | null | undefined,
): CostShadowFingerprint | undefined {
  if (!workload) return undefined;
  const pixelCount = resolvePixelCount(workload);
  if (!Number.isFinite(pixelCount) || pixelCount <= 0) return undefined;
  const megapixels = megapixelsOf(pixelCount);
  // Guard the conversion itself, not just its input: `pixelCount / 1e6` can
  // underflow a denormal to exactly 0, and a zero area is not evidence.
  if (!Number.isFinite(megapixels) || megapixels <= 0) return undefined;
  const chainSteps = Math.max(
    1,
    Number.isFinite(workload.chainSteps) ? workload.chainSteps : 1,
  );
  const { visibleAreaRatio, dpr } = encodeIslandAreaFactor(megapixels);
  return {
    pathCount: 0,
    segmentCount: 0,
    changedPathRatio: 1,
    imageCount: 1,
    glyphCount: 0,
    gradientCount: 0,
    isolatedLayerCount: 1,
    maskDepth: 0,
    filterNodeCount: chainSteps,
    visibleAreaRatio,
    dpr,
  };
}

/**
 * Module-level cost-shadow receipt — same counter idiom as
 * studio-filter-plan-shadow.ts. `agreed + disagreed + absentFingerprint ===
 * total`; `shadowFailures` counts plans the cost shadow could not observe
 * (the legacy planner served them) and is deliberately outside `total`.
 */
export interface StudioFilterIslandCostShadowReceipt {
  /** Island plans that produced a cost receipt. */
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
   * island bucket; `fullLadderQueries === fullLadderAgreed +
   * fullLadderDisagreed`. Never feeds the returned plan or lanes.
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
 * Coarse-bucket memo for the full-ladder observation, keyed by
 * studioFilterIslandBucket — eligibility class × quantized size/chain class,
 * so its cardinality is a handful of pow-2 classes, never plan volume.
 */
const fullLadderSeenBuckets = new Set<string>();

export function readStudioFilterIslandCostShadowReceipt(): StudioFilterIslandCostShadowReceipt {
  return Object.freeze({ ...costShadowCounters });
}

/** Test seam — each suite starts from a clean slate. */
export function resetStudioFilterIslandCostShadowReceipt(): void {
  costShadowCounters = emptyCostShadowCounters();
  fullLadderSeenBuckets.clear();
}

function recordFilterIslandCostShadowReceipt(receipt: SurfaceCostShadowReceipt): void {
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
 * P-02c second query — observation only. Re-ranks the cost model over the
 * full admitted observation set (the "filter.phase.final" candidates restricted to
 * the providers admitted before execution) against the authority winner, and
 * records the outcome into the receipt counters. Nothing here can reach the
 * returned plan or lane ladder: the function has no return value and no
 * caller reads its effects on the planning path. Ranking only admitted lanes
 * keeps the evidence honest — the GPU chain outside its eligibility gate
 * must never look like a cheaper alternative (fail closed, quality never
 * traded for cost).
 */
function observeFilterFullLadderCosts(
  bucket: string,
  admittedLanes: readonly StudioFilterLane[],
  legacyWinner: string,
  fingerprint: CostShadowFingerprint | undefined,
): void {
  if (fingerprint === undefined) return;
  if (fullLadderSeenBuckets.has(bucket)) return;
  fullLadderSeenBuckets.add(bucket);
  const admittedIds = new Set(
    admittedLanes.map((lane) => `${LANE_PROVIDER_PREFIX}${lane}`),
  );
  const candidates = filterRegistry
    .query("filter", ["filter.phase.final"])
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
    islandId: "image-filter-chain",
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
 * to `filterPlanner.plan(request)` — planWithCostShadow runs the legacy
 * selection first and only observes alongside it. If the call throws, the
 * legacy planner is re-run alone to disambiguate: an unsatisfiable request
 * rethrows here exactly as before the cost shadow existed, while a legacy
 * success means only the shadow side broke — counted, plan served (fail
 * closed).
 */
function planFilterIslandWithCostReceipt(request: CostShadowPlanRequest): SurfacePlan {
  let receipt: SurfaceCostShadowReceipt;
  let plan: SurfacePlan;
  try {
    ({ plan, receipt } = planWithCostShadow(filterRegistry, request));
  } catch {
    const legacyPlan = filterPlanner.plan(request);
    costShadowCounters.shadowFailures += 1;
    return legacyPlan;
  }
  recordFilterIslandCostShadowReceipt(receipt);
  return plan;
}

/**
 * Deterministic workload class for the bucket key. Quantized with the same
 * power-of-two quantizer the tournament's scene fingerprint uses, so nearby
 * sizes pool their cost samples instead of fragmenting the cache; `u` marks an
 * unknown (workload-less) call so it can never share a bucket with a measured
 * one. 256²→p17, 512²→p19, 1024²→p21, 2048²→p23, 4096²→p25.
 */
function studioFilterWorkloadClass(
  workload: StudioFilterIslandWorkload | null | undefined,
): string {
  if (!workload) return "pu|su";
  const pixelCount = resolvePixelCount(workload);
  if (!Number.isFinite(pixelCount) || pixelCount <= 0) return "pu|su";
  const steps = Number.isFinite(workload.chainSteps) ? Math.max(1, workload.chainSteps) : 1;
  return `p${quantizePow2Bucket(pixelCount)}|s${quantizePow2Bucket(steps)}`;
}

/**
 * Tournament winner-cache bucket for this island. Keyed by eligibility class
 * *and* workload class: a decision measured on a 256² single-step chain says
 * nothing about a 4096² five-step chain, and pooling them was exactly the bug
 * this bucket split fixes.
 */
export function studioFilterIslandBucket(input: StudioFilterIslandPlanInput): string {
  const eligibility = input.gpuChainEligible ? 1 : 0;
  return `studio-filter-island|gpu${eligibility}|${studioFilterWorkloadClass(input.workload)}`;
}

/** Provider id under which a lane races in the tournament/kill switch. */
export function studioFilterLaneProviderId(lane: StudioFilterLane): string {
  return `${LANE_PROVIDER_PREFIX}${lane}`;
}

export function planStudioFilterIslandLanes(
  input: StudioFilterIslandPlanInput,
): StudioFilterIslandPlan {
  const headLane: StudioFilterLane = input.gpuChainEligible ? "gpu-chain" : "worker";
  // V13 §2.5: the caller's workload fields are the real fingerprint data; no
  // workload (or a degenerate one) ⇒ undefined ⇒ receipt records "absent".
  const fingerprint = deriveStudioFilterIslandCostFingerprint(input.workload);
  const plan = planFilterIslandWithCostReceipt({
    surfaceId: "studio-image-filter-island",
    // Terminal single readback is part of this island's contract, so it must
    // plan as final-export; "interactive" would (correctly) refuse the plan.
    mode: "final-export",
    primaryOwnerId: `${LANE_PROVIDER_PREFIX}konva-native`,
    islands: [
      {
        islandId: "image-filter-chain",
        kind: "filter",
        requiredCapabilities: [`filter.lane.${headLane}`],
        selectedProviderId: `${LANE_PROVIDER_PREFIX}${headLane}`,
        availableTransports: ["cpu-readback"],
        ...(fingerprint === undefined ? {} : { fingerprint }),
      },
    ],
  });
  const plannedProviderId = plan.islands[0]?.providerId;
  if (!plannedProviderId?.startsWith(LANE_PROVIDER_PREFIX)) {
    throw new Error("Studio filter planner returned an invalid selected provider.");
  }
  const selectedLane = plannedProviderId.slice(LANE_PROVIDER_PREFIX.length) as StudioFilterLane;
  if (selectedLane !== "gpu-chain" && selectedLane !== "worker" && selectedLane !== "konva-native") {
    throw new Error(`Studio filter planner selected an unknown lane: ${selectedLane}`);
  }
  // Tournament telemetry may deny this exact provider, but cached winners and cost observations
  // cannot reorder or replace it. `peek` keeps persistence off the synchronous planning path.
  const runtime = peekStudioTournamentRuntime();
  const bucket = studioFilterIslandBucket(input);
  observeFilterFullLadderCosts(
    bucket,
    [selectedLane],
    plannedProviderId,
    fingerprint,
  );
  const selectedProviderKilled = runtime?.killSwitch.isKilled(plannedProviderId) === true;

  // Last statement on purpose: everything above already produced the plan, so
  // the bootstrap can only ever run after this call returned.
  scheduleTournamentBootstrap();

  return {
    lanes: [selectedLane],
    selectedLane,
    status: selectedProviderKilled ? "unavailable" : "selected",
    unavailableReason: selectedProviderKilled ? "selected-provider-killed" : null,
    plan,
    laneCosts: null,
  };
}
