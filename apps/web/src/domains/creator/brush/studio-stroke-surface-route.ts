/**
 * Pure pointer-down routing contract for Studio's mutually-exclusive live stroke surfaces.
 *
 * The provider-specific begin calls still live at the Studio boundary. Their synchronous admission
 * results are snapshotted here exactly once. Lifecycle consumers must retain the returned route and
 * may not resolve a replacement after append has started: doing so would split visible/canonical
 * pixel authority and can double-render translucent ink.
 */

export const STUDIO_STROKE_SURFACE_ROUTE_VERSION = 1 as const;

export const STUDIO_STROKE_SURFACE_ROUTE_PRIORITY = Object.freeze([
  "living-ink",
  "hokusai",
  "stamp",
  "gpu",
  "live-ink",
  "wet-ink",
  "dynamic",
  "konva",
] as const);

export type StudioStrokeSurfaceRouteKind =
  (typeof STUDIO_STROKE_SURFACE_ROUTE_PRIORITY)[number];

export type StudioStrokeSurfaceProviderState =
  | "failed"
  | "loading"
  | "ready"
  | "unavailable";

export type StudioHokusaiStrokeSurfaceSupport =
  | "flip-unsupported"
  | "rotation-unsupported"
  | "supported"
  | "unavailable";

export interface StudioStrokeSurfaceRouteSnapshotInput {
  readonly strokeId: string;
  readonly pointerId: number;
  readonly strokeEpoch: number;
  readonly livingInk: Readonly<{
    readonly eligible: boolean;
    readonly providerState: StudioStrokeSurfaceProviderState;
    /** True only after the provider's complete runtime capability receipt is accepted. */
    readonly capabilitiesAccepted: boolean;
    /** True only when the provider accepted ownership at this pointer-down boundary. */
    readonly admitted: boolean;
  }>;
  readonly hokusai: Readonly<{
    /** The begin/admission result, not brush identity eligibility alone. */
    readonly admitted: boolean;
    /** Flip/rotation/unbound surfaces must remain on the existing exact route. */
    readonly surface: StudioHokusaiStrokeSurfaceSupport;
  }>;
  readonly stampAdmitted: boolean;
  readonly gpuAdmitted: boolean;
  readonly liveInkAdmitted: boolean;
  readonly wetInkAdmitted: boolean;
  readonly dynamicAdmitted: boolean;
}

type LivingInkUnavailableReason =
  | "living-ink-capabilities-rejected"
  | "living-ink-provider-failed"
  | "living-ink-provider-invalid"
  | "living-ink-provider-loading"
  | "living-ink-provider-unavailable"
  | "living-ink-start-rejected";

type HokusaiUnavailableReason =
  | "hokusai-flip-unsupported"
  | "hokusai-rotation-unsupported"
  | "hokusai-surface-invalid"
  | "hokusai-surface-unavailable";

type StudioStrokeSurfaceSelectionReason =
  | LivingInkUnavailableReason
  | HokusaiUnavailableReason
  | "invalid-pointerdown-snapshot"
  | "no-specialist-route-admitted";

interface StudioStrokeSurfaceRouteBase<Kind extends StudioStrokeSurfaceRouteKind> {
  readonly version: typeof STUDIO_STROKE_SURFACE_ROUTE_VERSION;
  readonly kind: Kind;
  readonly routeKey: `studio-stroke-surface-route-v1:${string}`;
  readonly strokeId: string;
  readonly pointerId: number;
  readonly strokeEpoch: number;
  readonly selectedAt: "pointerdown";
  readonly ownership: "pinned-for-entire-stroke";
  readonly midStrokePromotion: false;
  readonly failureAction: "retain-pinned-route";
  readonly alternateSelection: "explicit-next-pointerdown-only";
}

export type StudioStrokeSurfaceRoute =
  | (StudioStrokeSurfaceRouteBase<"living-ink"> & Readonly<{
      readonly reason: "living-ink-ready";
      readonly providerState: "ready";
    }>)
  | (StudioStrokeSurfaceRouteBase<"hokusai"> & Readonly<{
      readonly reason: "hokusai-admitted";
      readonly surface: "supported";
    }>)
  | (StudioStrokeSurfaceRouteBase<"stamp"> & Readonly<{
      readonly reason: "stamp-admitted";
    }>)
  | (StudioStrokeSurfaceRouteBase<"gpu"> & Readonly<{
      readonly reason: "gpu-admitted";
    }>)
  | (StudioStrokeSurfaceRouteBase<"live-ink"> & Readonly<{
      readonly reason: "live-ink-admitted";
    }>)
  | (StudioStrokeSurfaceRouteBase<"wet-ink"> & Readonly<{
      readonly reason: LivingInkUnavailableReason | "wet-ink-admitted";
    }>)
  | (StudioStrokeSurfaceRouteBase<"dynamic"> & Readonly<{
      readonly reason: "dynamic-admitted";
    }>)
  | (StudioStrokeSurfaceRouteBase<"konva"> & Readonly<{
      readonly reason: StudioStrokeSurfaceSelectionReason;
    }>);

function validIdentity(
  input: StudioStrokeSurfaceRouteSnapshotInput,
): boolean {
  return typeof input.strokeId === "string"
    && input.strokeId.trim().length > 0
    && Number.isSafeInteger(input.pointerId)
    && input.pointerId >= 0
    && Number.isSafeInteger(input.strokeEpoch)
    && input.strokeEpoch >= 0;
}

function livingInkUnavailableReason(
  input: StudioStrokeSurfaceRouteSnapshotInput["livingInk"],
): LivingInkUnavailableReason | null {
  if (input?.eligible !== true) return null;
  if (input.providerState === "loading") return "living-ink-provider-loading";
  if (input.providerState === "unavailable") return "living-ink-provider-unavailable";
  if (input.providerState === "failed") return "living-ink-provider-failed";
  if (input.providerState !== "ready") return "living-ink-provider-invalid";
  if (input.capabilitiesAccepted !== true) return "living-ink-capabilities-rejected";
  if (input.admitted !== true) return "living-ink-start-rejected";
  return null;
}

function hokusaiUnavailableReason(
  input: StudioStrokeSurfaceRouteSnapshotInput["hokusai"],
): HokusaiUnavailableReason | null {
  if (!input || input.surface === "supported") return null;
  if (input.surface === "flip-unsupported") return "hokusai-flip-unsupported";
  if (input.surface === "rotation-unsupported") return "hokusai-rotation-unsupported";
  if (input.surface === "unavailable") return "hokusai-surface-unavailable";
  return "hokusai-surface-invalid";
}

function routeBase<Kind extends StudioStrokeSurfaceRouteKind>(
  input: StudioStrokeSurfaceRouteSnapshotInput,
  kind: Kind,
): StudioStrokeSurfaceRouteBase<Kind> {
  return {
    version: STUDIO_STROKE_SURFACE_ROUTE_VERSION,
    kind,
    routeKey: `studio-stroke-surface-route-v1:${input.strokeEpoch}:${input.pointerId}:${input.strokeId}:${kind}`,
    strokeId: input.strokeId,
    pointerId: input.pointerId,
    strokeEpoch: input.strokeEpoch,
    selectedAt: "pointerdown",
    ownership: "pinned-for-entire-stroke",
    midStrokePromotion: false,
    failureAction: "retain-pinned-route",
    alternateSelection: "explicit-next-pointerdown-only",
  };
}

/** Resolve exactly one surface from admission results captured in the pointer-down task. */
export function resolveStudioStrokeSurfaceRoute(
  input: StudioStrokeSurfaceRouteSnapshotInput,
): StudioStrokeSurfaceRoute {
  if (!validIdentity(input)) {
    return Object.freeze({
      ...routeBase(input, "konva"),
      reason: "invalid-pointerdown-snapshot",
    });
  }

  const livingInkReady = input.livingInk?.eligible === true
    && input.livingInk.providerState === "ready"
    && input.livingInk.capabilitiesAccepted === true
    && input.livingInk.admitted === true;
  if (livingInkReady) {
    return Object.freeze({
      ...routeBase(input, "living-ink"),
      reason: "living-ink-ready",
      providerState: "ready",
    });
  }
  if (input.hokusai?.admitted === true && input.hokusai.surface === "supported") {
    return Object.freeze({
      ...routeBase(input, "hokusai"),
      reason: "hokusai-admitted",
      surface: "supported",
    });
  }
  if (input.stampAdmitted === true) {
    return Object.freeze({ ...routeBase(input, "stamp"), reason: "stamp-admitted" });
  }
  if (input.gpuAdmitted === true) {
    return Object.freeze({ ...routeBase(input, "gpu"), reason: "gpu-admitted" });
  }
  if (input.liveInkAdmitted === true) {
    return Object.freeze({ ...routeBase(input, "live-ink"), reason: "live-ink-admitted" });
  }
  if (input.wetInkAdmitted === true) {
    return Object.freeze({
      ...routeBase(input, "wet-ink"),
      reason: livingInkUnavailableReason(input.livingInk) ?? "wet-ink-admitted",
    });
  }
  if (input.dynamicAdmitted === true) {
    return Object.freeze({ ...routeBase(input, "dynamic"), reason: "dynamic-admitted" });
  }
  return Object.freeze({
    ...routeBase(input, "konva"),
    reason: livingInkUnavailableReason(input.livingInk)
      ?? hokusaiUnavailableReason(input.hokusai)
      ?? "no-specialist-route-admitted",
  });
}

export type StudioStrokeSurfaceLifecyclePhase =
  | "append"
  | "cancel"
  | "finish"
  | "handoff";

export interface StudioStrokeSurfaceLifecycleClaim {
  readonly phase: StudioStrokeSurfaceLifecyclePhase;
  readonly routeKey: string;
  readonly strokeId: string;
  readonly kind: StudioStrokeSurfaceRouteKind;
}

export type StudioStrokeSurfaceLifecycleOwnership =
  | Readonly<{
      readonly status: "owned";
      readonly phase: StudioStrokeSurfaceLifecyclePhase;
      readonly owner: StudioStrokeSurfaceRouteKind;
      /** The exact pointer-down object; consumers must keep this identity through handoff. */
      readonly route: StudioStrokeSurfaceRoute;
    }>
  | Readonly<{
      readonly status: "rejected";
      readonly reason: "route-key-mismatch" | "route-kind-mismatch" | "stroke-id-mismatch";
    }>;

/** Fail closed when a stale/mismatched surface tries to append, finish, cancel, or hand off. */
export function claimStudioStrokeSurfaceLifecycle(
  route: StudioStrokeSurfaceRoute,
  claim: StudioStrokeSurfaceLifecycleClaim,
): StudioStrokeSurfaceLifecycleOwnership {
  if (claim.routeKey !== route.routeKey) {
    return Object.freeze({ status: "rejected", reason: "route-key-mismatch" });
  }
  if (claim.strokeId !== route.strokeId) {
    return Object.freeze({ status: "rejected", reason: "stroke-id-mismatch" });
  }
  if (claim.kind !== route.kind) {
    return Object.freeze({ status: "rejected", reason: "route-kind-mismatch" });
  }
  return Object.freeze({ status: "owned", phase: claim.phase, owner: route.kind, route });
}

export interface StudioStrokeSurfacePresentationReceipt {
  readonly routeKey: string;
  readonly kind: StudioStrokeSurfaceRouteKind;
  readonly status: "failed" | "pending" | "presented";
}

/** Suppress the retained Konva draft only after this exact specialist route has presented. */
export function studioStrokeSurfaceRouteSuppressesDraft(
  route: StudioStrokeSurfaceRoute,
  receipt: StudioStrokeSurfacePresentationReceipt,
): boolean {
  return route.kind !== "konva"
    && receipt.routeKey === route.routeKey
    && receipt.kind === route.kind
    && receipt.status === "presented";
}

export type StudioStrokeSurfaceFailureCause =
  | "device-lost"
  | "provider-failed"
  | "surface-lost";

/** A mid-stroke failure retains lifecycle ownership; only the next pointer-down may reroute. */
export function studioStrokeSurfaceRouteFailurePolicy(
  route: StudioStrokeSurfaceRoute,
  cause: StudioStrokeSurfaceFailureCause,
): Readonly<{
  readonly cause: StudioStrokeSurfaceFailureCause;
  readonly route: StudioStrokeSurfaceRoute;
  readonly owner: StudioStrokeSurfaceRouteKind;
  readonly action: "retain-pinned-route";
  readonly allowProviderSubstitution: false;
  readonly alternateSelection: "explicit-next-pointerdown-only";
  readonly presentation: "preserve-last-presented-frame";
}> {
  return Object.freeze({
    cause,
    route,
    owner: route.kind,
    action: "retain-pinned-route",
    allowProviderSubstitution: false,
    alternateSelection: "explicit-next-pointerdown-only",
    presentation: "preserve-last-presented-frame",
  });
}
