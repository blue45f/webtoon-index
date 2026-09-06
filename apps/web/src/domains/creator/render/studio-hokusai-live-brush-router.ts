import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  type StudioHokusaiLiveBrushCapabilities,
  type StudioHokusaiLiveBrushConfig,
} from "./studio-hokusai-live-brush-protocol";
import {
  STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS,
  STUDIO_HOKUSAI_RUNTIME_VERSION,
  type StudioHokusaiMaterialProfileId,
  type StudioHokusaiNaturalMediaPresetId,
} from "./studio-hokusai-natural-media-contract";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

export const STUDIO_HOKUSAI_LIVE_SURFACE_SIZE = 4_096 as const;
export const STUDIO_HOKUSAI_LIVE_SURFACE_HALO_FACTOR = 6 as const;
export const STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION =
  "hokusai-core-natural-media-auto-route-v1" as const;
export const STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE =
  "real-wasm-core-natural-media-output-contract-v2" as const;

export type StudioHokusaiLiveAutoRoutePresetId = Extract<
  StudioHokusaiNaturalMediaPresetId,
  "pencil" | "charcoal" | "oil" | "calligraphy" | "marker"
>;

interface CoreMaterialRoute {
  readonly brushId: string;
  readonly presetId: StudioHokusaiLiveAutoRoutePresetId;
  readonly materialProfileId: StudioHokusaiMaterialProfileId;
}

function coreMaterialRoute(
  brushId: string,
  presetId: StudioHokusaiLiveAutoRoutePresetId,
  materialProfileId: StudioHokusaiMaterialProfileId,
): CoreMaterialRoute {
  return Object.freeze({ brushId, presetId, materialProfileId });
}

const PENCIL_IDS = [
  "pencil",
  "pencil-2b",
  "pencil-6b",
  "soft-pencil",
  "colored-pencil",
  "erodible-pencil",
  "pencil-grain",
] as const;
const CALLIGRAPHY_IDS = [
  "calligraphy",
  "fountain-pen",
  "parallel-pen",
  "brush-pen",
] as const;
const MARKER_IDS = [
  "marker",
  "felt-tip",
  "marker-bold",
  "alcohol-marker",
  "highlighter",
  "chisel-highlighter",
  "pastel-highlighter",
] as const;

export const STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY = Object.freeze({
  version: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
  qualityGate: Object.freeze({
    id: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
    admittedPresets: Object.freeze([
      "pencil",
      "charcoal",
      "oil",
      "calligraphy",
      "marker",
    ] as const),
    requiredEvidence: Object.freeze([
      "real-wasm-visible-output",
      "deterministic-seed-replay",
      "pressure-response",
      "exact-live-commit-receipt",
      "catalog-default-config-snapshot",
      "identity-specific-material-profile",
    ] as const),
  }),
  eligibleCoreIdentities: Object.freeze([
    ...PENCIL_IDS.map((brushId) => coreMaterialRoute(
      brushId,
      "pencil",
      "pencil",
    )),
    coreMaterialRoute("charcoal", "charcoal", "charcoal"),
    coreMaterialRoute("chalk", "charcoal", "chalk"),
    coreMaterialRoute("crayon", "charcoal", "crayon"),
    coreMaterialRoute("dry-media", "charcoal", "charcoal"),
    coreMaterialRoute("pastel", "charcoal", "pastel"),
    coreMaterialRoute("oil-pastel", "charcoal", "oil-pastel"),
    coreMaterialRoute("oil", "oil", "oil"),
    coreMaterialRoute("acrylic", "oil", "acrylic"),
    coreMaterialRoute("paint-tube", "oil", "painterly"),
    coreMaterialRoute("gouache", "oil", "gouache"),
    coreMaterialRoute("brush", "oil", "painterly"),
    coreMaterialRoute("flat-brush", "oil", "painterly"),
    ...CALLIGRAPHY_IDS.map((brushId) => coreMaterialRoute(
      brushId,
      "calligraphy",
      "calligraphy",
    )),
    ...MARKER_IDS.map((brushId) => coreMaterialRoute(
      brushId,
      "marker",
      "marker",
    )),
  ]),
  /**
   * Empty since the calligraphy/marker specialist families cleared the same six-part evidence
   * gate as pencil/charcoal/oil. Kept as a declared, typed field rather than deleted: withholding
   * a family is a normal outcome of that gate, and a future preset lands here before it lands
   * above.
   *
   * SCOPE, so this list is not misread as a production claim: being eligible here is necessary but
   * NOT sufficient to paint with the WASM engine. Production admission runs through
   * `resolveStudioHokusaiProductLiveAdmission`, which additionally requires an entry in
   * STUDIO_HOKUSAI_PRODUCT_PROMOTED_PRESETS - and that list is empty, because the committed
   * full-size comparison failed both visual parity and the 1.2x throughput gate. So the normal
   * shelf still starts no Hokusai stroke for ANY identity, these eleven included. What eligibility
   * buys them is the explicit experimental surface: before this they were refused there too
   * ("identity-not-supported"); now an explicit opt-in reaches the real engine instead of a
   * refusal. Automatic routing for every identity stays gated on new full-size evidence.
   */
  withheldSpecialistIdentities: Object.freeze(
    [] as ReadonlyArray<Readonly<{
      readonly brushId: string;
      readonly candidatePresetId: StudioHokusaiNaturalMediaPresetId;
      readonly reason: "specialist-family-parity-gate-missing";
    }>>,
  ),
});

const AUTO_ROUTE_BY_CORE_IDENTITY: ReadonlyMap<string, CoreMaterialRoute> = new Map(
  STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY.eligibleCoreIdentities.map((entry) => [
    entry.brushId,
    entry,
  ]),
);

export type StudioHokusaiLiveAutoRouteDecision =
  | Readonly<{
      readonly status: "admitted";
      readonly identity: string;
      readonly identityAuthority: "brush-id" | "catalog-id";
      readonly presetId: StudioHokusaiLiveAutoRoutePresetId;
      readonly materialProfileId: StudioHokusaiMaterialProfileId;
      readonly policyVersion: typeof STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION;
      readonly qualityGate: typeof STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE;
    }>
  | Readonly<{
      readonly status: "rejected";
      readonly reason:
        | "brush-identity-not-quality-gated"
        | "catalog-identity-not-quality-gated"
        | "catalog-runtime-identity-mismatch";
    }>;

export type StudioHokusaiLiveProviderState =
  | "failed"
  | "loading"
  | "ready"
  | "unavailable";

export interface StudioHokusaiLiveRouteInput {
  readonly brushId: string;
  readonly catalogId?: string | null;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly firstX: number;
  readonly firstY: number;
  readonly radiusPixels: number;
  readonly color: `#${string}`;
  readonly opacity: number;
  readonly seed: number;
  readonly providerState: StudioHokusaiLiveProviderState;
  readonly capabilities?: StudioHokusaiLiveBrushCapabilities | null;
}

export type StudioHokusaiLiveRouteResult =
  | Readonly<{
      readonly status: "ready";
      readonly backendId: "hokusai-myb-worker";
      readonly presetId: StudioHokusaiNaturalMediaPresetId;
      readonly materialProfileId: StudioHokusaiMaterialProfileId;
      readonly semanticContract: "hokusai-live-canonical-v1";
      readonly autoRoutePolicy: Readonly<{
        readonly version: typeof STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION;
        readonly qualityGate: typeof STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE;
        readonly identity: string;
        readonly identityAuthority: "brush-id" | "catalog-id";
      }>;
      readonly config: StudioHokusaiLiveBrushConfig;
      readonly admission: Readonly<{
        readonly boundary: "stroke-start";
        readonly ownership: "pinned-for-entire-stroke";
        readonly midStrokePromotion: false;
        readonly packedDirtyTransfer: true;
        readonly inFlightFrameLimit: 1;
        readonly stalePresentationPolicy: "coalesce-latest";
        readonly inputDropAllowed: false;
        readonly segmentPolicy: "single-bounded-4096-fail-closed";
        readonly midStrokeFallbackForbiddenReason:
          "would-split-pixel-authority-and-break-live-commit-undo-save-parity";
      }>;
    }>
  | Readonly<{
      /** The pre-stroke admission was rejected; no alternative provider ran. */
      readonly status: "unavailable";
      readonly reason:
        | "provider-failed"
        | "provider-loading"
        | "provider-unavailable"
        | "runtime-capability-rejected";
      /** The provider that the caller selected before the attempted stroke. */
      readonly selectedBackendId: "hokusai-myb-worker";
      /** The rejection happens before the first sample is retained or transferred. */
      readonly retainedInput: false;
      /** No Hokusai frame exists for a stroke that never began. */
      readonly lastGoodFrame: null;
      /** The selected provider can only be tried again at a new stroke boundary. */
      readonly nextStrokeOnly: true;
    }>
  | Readonly<{
      readonly status: "not-applicable";
      readonly reason: "brush-not-natural-media" | "invalid-input";
    }>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveStudioHokusaiLivePreset(
  brushId: string,
  catalogId?: string | null,
): StudioHokusaiNaturalMediaPresetId | null {
  const decision = resolveStudioHokusaiLiveAutoRouteDecision(brushId, catalogId);
  return decision.status === "admitted" ? decision.presetId : null;
}

export function resolveStudioHokusaiLiveMaterialProfile(
  brushId: string,
  catalogId?: string | null,
): StudioHokusaiMaterialProfileId | null {
  const decision = resolveStudioHokusaiLiveAutoRouteDecision(brushId, catalogId);
  return decision.status === "admitted" ? decision.materialProfileId : null;
}

/**
 * Auto-route is deliberately catalog-authoritative and fail-closed.
 *
 * Procedural catalogue brushes persist a semantic `catalogId` while sharing one of only three
 * carrier ids (`dry-media`, `ink-particle`, `airbrush`). Falling through from an unqualified
 * catalogue identity to its carrier id promoted every dry-media texture, rake and foliage brush
 * to charcoal. A supplied catalog id must therefore be independently quality-gated and must match
 * the runtime identity for the current core-only gate. Calligraphy and marker remain explicit
 * conversion choices until their specialist renderer parity gate exists.
 */
export function resolveStudioHokusaiLiveAutoRouteDecision(
  brushId: string,
  catalogId?: string | null,
): StudioHokusaiLiveAutoRouteDecision {
  const hasCatalogIdentity = typeof catalogId === "string" && catalogId.length > 0;
  if (hasCatalogIdentity) {
    const route = AUTO_ROUTE_BY_CORE_IDENTITY.get(catalogId);
    if (!route) return { status: "rejected", reason: "catalog-identity-not-quality-gated" };
    if (catalogId !== brushId) {
      return { status: "rejected", reason: "catalog-runtime-identity-mismatch" };
    }
    return {
      status: "admitted",
      identity: catalogId,
      identityAuthority: "catalog-id",
      presetId: route.presetId,
      materialProfileId: route.materialProfileId,
      policyVersion: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
      qualityGate: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
    };
  }
  const route = AUTO_ROUTE_BY_CORE_IDENTITY.get(brushId);
  return route
    ? {
        status: "admitted",
        identity: brushId,
        identityAuthority: "brush-id",
        presetId: route.presetId,
        materialProfileId: route.materialProfileId,
        policyVersion: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_POLICY_VERSION,
        qualityGate: STUDIO_HOKUSAI_LIVE_AUTO_ROUTE_QUALITY_GATE,
      }
    : { status: "rejected", reason: "brush-identity-not-quality-gated" };
}

export function studioHokusaiLiveCapabilitiesAreAdmissible(
  capabilities: StudioHokusaiLiveBrushCapabilities | null | undefined,
): capabilities is StudioHokusaiLiveBrushCapabilities {
  return capabilities?.engine === "reearth-hokusai"
    && capabilities.engineVersion === STUDIO_HOKUSAI_RUNTIME_VERSION
    && capabilities.surfaceAdapterVersion === STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION
    && capabilities.liveAdapterVersion === STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION
    && capabilities.wasm === true
    && capabilities.dedicatedWorker === true
    && capabilities.packedDirtyFrames === true
    && capabilities.transferableFrames === true
    && capabilities.epochCancellation === true
    && capabilities.canonicalPng === true
    && capabilities.liveCommitParityReceipt === true
    && capabilities.materialTexture === "studio-hokusai-material-texture-v2"
    && capabilities.materialProfileRouting === "identity-profile-v1"
    && capabilities.endpointPolicy === "tapered-start-no-dab-carrier-v1"
    && capabilities.mainThreadFullFrameCopy === false;
}

export function planStudioHokusaiLiveSegment(
  input: Readonly<{
    documentWidth: number;
    documentHeight: number;
    contactX: number;
    contactY: number;
    radiusPixels: number;
    segmentIndex: number;
  }>,
): Pick<
  StudioHokusaiLiveBrushConfig,
  | "documentHeight"
  | "documentWidth"
  | "logicalOriginX"
  | "logicalOriginY"
  | "segmentIndex"
  | "surfaceHeight"
  | "surfaceWidth"
> | null {
  const values = [
    input.documentWidth,
    input.documentHeight,
    input.contactX,
    input.contactY,
    input.radiusPixels,
  ];
  if (
    !values.every(Number.isFinite)
    || input.documentWidth <= 0
    || input.documentHeight <= 0
    || input.documentWidth > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
    || input.documentHeight > STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxSourceCoordinate
    || input.radiusPixels <= 0
    || !Number.isSafeInteger(input.segmentIndex)
    || input.segmentIndex < 0
  ) return null;
  const halo = Math.ceil(input.radiusPixels * STUDIO_HOKUSAI_LIVE_SURFACE_HALO_FACTOR);
  const target = clamp(
    Math.max(512, halo * 2),
    1,
    STUDIO_HOKUSAI_NATURAL_MEDIA_LIMITS.maxDimension,
  );
  const surfaceWidth = Math.min(Math.ceil(input.documentWidth), Math.max(
    target,
    Math.min(STUDIO_HOKUSAI_LIVE_SURFACE_SIZE, Math.ceil(input.documentWidth)),
  ));
  const surfaceHeight = Math.min(Math.ceil(input.documentHeight), Math.max(
    target,
    Math.min(STUDIO_HOKUSAI_LIVE_SURFACE_SIZE, Math.ceil(input.documentHeight)),
  ));
  const logicalOriginX = clamp(
    input.contactX - surfaceWidth / 2,
    0,
    Math.max(0, input.documentWidth - surfaceWidth),
  );
  const logicalOriginY = clamp(
    input.contactY - surfaceHeight / 2,
    0,
    Math.max(0, input.documentHeight - surfaceHeight),
  );
  return {
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    surfaceWidth,
    surfaceHeight,
    logicalOriginX,
    logicalOriginY,
    segmentIndex: input.segmentIndex,
  };
}

/**
 * Current v1 admission owns one bounded 4096px stroke-local segment. Switching to Canvas2D after
 * pointer-down would split pixel authority and make the visible prefix differ from canonical
 * undo/save replay, so a boundary crossing is rejected before that batch is transferred. This is
 * deliberately observable; it must not clip or silently change engines. A future v2 may aggregate
 * multiple receipted segment PNGs into one document transaction.
 */
export function studioHokusaiLiveSampleFitsPinnedSegment(
  config: Pick<
    StudioHokusaiLiveBrushConfig,
    | "documentHeight"
    | "documentWidth"
    | "logicalOriginX"
    | "logicalOriginY"
    | "radiusPixels"
    | "surfaceHeight"
    | "surfaceWidth"
  >,
  sample: Readonly<{ x: number; y: number }>,
): boolean {
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return false;
  const halo = Math.max(1, config.radiusPixels * 2);
  const minimumX = config.logicalOriginX > 0
    ? config.logicalOriginX + halo
    : config.logicalOriginX;
  const minimumY = config.logicalOriginY > 0
    ? config.logicalOriginY + halo
    : config.logicalOriginY;
  const surfaceRight = config.logicalOriginX + config.surfaceWidth;
  const surfaceBottom = config.logicalOriginY + config.surfaceHeight;
  const maximumX = surfaceRight < config.documentWidth
    ? surfaceRight - halo
    : surfaceRight;
  const maximumY = surfaceBottom < config.documentHeight
    ? surfaceBottom - halo
    : surfaceBottom;
  return sample.x >= minimumX
    && sample.y >= minimumY
    && sample.x < maximumX
    && sample.y < maximumY;
}

export function resolveStudioHokusaiLiveRoute(
  input: StudioHokusaiLiveRouteInput,
): StudioHokusaiLiveRouteResult {
  const autoRoute = resolveStudioHokusaiLiveAutoRouteDecision(
    input.brushId,
    input.catalogId,
  );
  if (autoRoute.status !== "admitted") {
    return { status: "not-applicable", reason: "brush-not-natural-media" };
  }
  const presetId = autoRoute.presetId;
  const materialProfileId = autoRoute.materialProfileId;
  const segment = planStudioHokusaiLiveSegment({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    contactX: input.firstX,
    contactY: input.firstY,
    radiusPixels: input.radiusPixels,
    segmentIndex: 0,
  });
  if (
    !segment
    || typeof input.color !== "string"
    || !/^#[0-9a-f]{6}$/u.test(input.color)
    || !Number.isFinite(input.opacity)
    || input.opacity <= 0
    || input.opacity > 1
    || !Number.isSafeInteger(input.seed)
    || input.seed < 0
    || input.seed > 0xffff_ffff
  ) return { status: "not-applicable", reason: "invalid-input" };
  if (input.providerState !== "ready") {
    return {
      status: "unavailable",
      reason: input.providerState === "loading"
        ? "provider-loading"
        : input.providerState === "failed"
          ? "provider-failed"
          : "provider-unavailable",
      selectedBackendId: "hokusai-myb-worker",
      retainedInput: false,
      lastGoodFrame: null,
      nextStrokeOnly: true,
    };
  }
  if (!studioHokusaiLiveCapabilitiesAreAdmissible(input.capabilities)) {
    return {
      status: "unavailable",
      reason: "runtime-capability-rejected",
      selectedBackendId: "hokusai-myb-worker",
      retainedInput: false,
      lastGoodFrame: null,
      nextStrokeOnly: true,
    };
  }
  return {
    status: "ready",
    backendId: "hokusai-myb-worker",
    presetId,
    materialProfileId,
    semanticContract: "hokusai-live-canonical-v1",
    autoRoutePolicy: {
      version: autoRoute.policyVersion,
      qualityGate: autoRoute.qualityGate,
      identity: autoRoute.identity,
      identityAuthority: autoRoute.identityAuthority,
    },
    config: {
      ...segment,
      presetId,
      materialProfileId,
      color: input.color,
      opacity: input.opacity,
      radiusPixels: input.radiusPixels,
      seed: input.seed,
    },
    admission: {
      boundary: "stroke-start",
      ownership: "pinned-for-entire-stroke",
      midStrokePromotion: false,
      packedDirtyTransfer: true,
      inFlightFrameLimit: 1,
      stalePresentationPolicy: "coalesce-latest",
      inputDropAllowed: false,
      segmentPolicy: "single-bounded-4096-fail-closed",
      midStrokeFallbackForbiddenReason:
        "would-split-pixel-authority-and-break-live-commit-undo-save-parity",
    },
  };
}
