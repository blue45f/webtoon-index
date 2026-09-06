import { studioLiveLockResourcesConflict } from "@/shared/lib/studio-live-lock-resource";

/**
 * Soft-lock mutation guards for Studio live collaboration.
 *
 * Pure helpers over room leases: decide whether the local session may begin an edit on a
 * page/layer/element resource. Does not call claimLock itself — callers claim after canBegin
 * succeeds.
 */

export interface StudioLiveLockLike {
  resource: string;
  claimId: string;
  owner: { sessionId: string; displayName?: string };
  leaseUntil: number;
}

export type StudioLiveResourceKind = "page" | "layer" | "element";

export function studioLivePageResource(pageId: string): string {
  return `page:${pageId}`;
}

export function studioLiveLayerResource(pageId: string, layerId: string): string {
  return `layer:${pageId}:${layerId}`;
}

export function studioLiveElementResource(pageId: string, elementId: string): string {
  return `element:${pageId}:${elementId}`;
}

export interface StudioLiveLayerResourceScope {
  readonly pageId: string;
  readonly layerId: string;
}

/**
 * Parse the layer resource grammar (`layer:<pageId>:<layerId>`). Non-layer ids return null so
 * legacy resources keep exact-match semantics. Kept in parity with the shared parser in
 * `@/shared/lib/studio-live-lock-resource`, which now understands the same layer grammar — this local
 * copy stays only so the guard's conflict rules remain pure over the parsed scope.
 */
export function parseStudioLiveLayerLockResource(
  resourceId: string
): StudioLiveLayerResourceScope | null {
  if (!resourceId.startsWith("layer:")) return null;
  const identity = resourceId.slice("layer:".length);
  const pageSeparator = identity.indexOf(":");
  if (pageSeparator <= 0 || pageSeparator === identity.length - 1) return null;
  return {
    pageId: identity.slice(0, pageSeparator),
    layerId: identity.slice(pageSeparator + 1),
  };
}

/**
 * Layer-aware conflict extension over `studioLiveLockResourcesConflict`.
 *
 * - Page ↔ layer on the same page conflict: a page lease covers all of its layers.
 * - Layer ↔ layer conflict only on the exact same layer; sibling layers stay independent.
 * - Layer ↔ element NEVER conflict here: element ids do not encode their layer
 *   (`element:<pageId>:<elementId>`), so this pure function cannot know the element→layer
 *   mapping. CALLER CONTRACT: an edit that must respect layer leases passes the containing
 *   layer resource alongside its element resources (see `studioLiveMutationResources`
 *   `layerIds`); the layer↔layer exact match then carries the conflict.
 * - Non-layer pairs delegate to the shared page/element grammar unchanged.
 */
export function studioLiveLayerAwareLockResourcesConflict(left: string, right: string): boolean {
  if (left === right) return true;
  const leftLayer = parseStudioLiveLayerLockResource(left);
  const rightLayer = parseStudioLiveLayerLockResource(right);
  if (!leftLayer && !rightLayer) return studioLiveLockResourcesConflict(left, right);
  if (leftLayer && rightLayer) {
    // Same layer is the `left === right` fast path; different layers never conflict.
    return false;
  }
  const layer = (leftLayer ?? rightLayer)!;
  const other = leftLayer ? right : left;
  // A page lease conflicts with every layer on that page. Elements and legacy ids stay
  // independent from layer leases (see caller contract above).
  return other === studioLivePageResource(layer.pageId);
}

/**
 * Resources that must be free (or owned by self) before an edit on these targets.
 *
 * Layer scope contract: `layerIds` claims each layer as a first-class resource
 * (`layer:<pageId>:<layerId>`). Because element ids do not encode layers, layer↔element
 * exclusion is opt-in by the caller: pass the containing `layerIds` together with
 * `elementIds` and the shared layer resource carries the conflict against peer layer
 * leases. Omitting `layerIds` keeps the legacy behavior byte-identical — sibling element
 * edits stay independent and only page leases fence them.
 */
export function studioLiveMutationResources(input: {
  pageId: string;
  layerIds?: readonly string[] | null;
  elementIds?: readonly string[] | null;
}): string[] {
  const pageId = typeof input.pageId === "string" ? input.pageId.trim() : "";
  if (!pageId) return [];
  const resources: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.layerIds ?? []) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const resource = studioLiveLayerResource(pageId, raw.trim());
    if (seen.has(resource)) continue;
    seen.add(resource);
    resources.push(resource);
  }
  for (const raw of input.elementIds ?? []) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const resource = studioLiveElementResource(pageId, raw.trim());
    if (seen.has(resource)) continue;
    seen.add(resource);
    resources.push(resource);
  }
  // An element/layer mutation claims only its concrete scopes. The authoritative hierarchy makes
  // a page lease conflict with every child without turning sibling edits into page-wide
  // contention. A page-only mutation still claims the page resource and blocks all descendants.
  return resources.length > 0 ? resources : [studioLivePageResource(pageId)];
}

function isActiveLock(lock: StudioLiveLockLike, now: number): boolean {
  return Number.isFinite(lock.leaseUntil) && lock.leaseUntil > now;
}

/** Active hierarchical lock held by someone other than self, if any. */
export function findConflictingStudioLiveLock(
  locks: readonly StudioLiveLockLike[],
  resource: string,
  selfSessionId: string,
  now = Date.now()
): StudioLiveLockLike | null {
  const self = typeof selfSessionId === "string" ? selfSessionId : "";
  for (const lock of locks) {
    if (!studioLiveLayerAwareLockResourcesConflict(lock.resource, resource)) continue;
    if (!isActiveLock(lock, now)) continue;
    if (lock.owner.sessionId === self) continue;
    return lock;
  }
  return null;
}

/**
 * Page lock blocks all layer/element edits on that page; layer lock blocks that layer (and, via
 * the caller contract on `studioLiveMutationResources`, element edits that declare their layer);
 * element lock blocks only that element. Self-owned locks never conflict.
 */
export function findStudioLiveMutationConflict(input: {
  locks: readonly StudioLiveLockLike[];
  pageId: string;
  layerIds?: readonly string[] | null;
  elementIds?: readonly string[] | null;
  selfSessionId: string;
  now?: number;
}): StudioLiveLockLike | null {
  const now = input.now ?? Date.now();
  const resources = studioLiveMutationResources({
    pageId: input.pageId,
    layerIds: input.layerIds,
    elementIds: input.elementIds,
  });
  for (const resource of resources) {
    const conflict = findConflictingStudioLiveLock(
      input.locks,
      resource,
      input.selfSessionId,
      now
    );
    if (conflict) return conflict;
  }
  return null;
}

export type StudioLiveMutationDecision =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      lock: StudioLiveLockLike;
    };

export function canBeginStudioLiveMutation(input: {
  locks: readonly StudioLiveLockLike[];
  pageId: string;
  layerIds?: readonly string[] | null;
  elementIds?: readonly string[] | null;
  selfSessionId: string;
  now?: number;
}): StudioLiveMutationDecision {
  const conflict = findStudioLiveMutationConflict(input);
  if (!conflict) return { ok: true };
  const who = conflict.owner.displayName?.trim() || "다른 편집자";
  return {
    ok: false,
    reason: `${who}가 이 영역을 편집 중입니다. 잠금이 풀릴 때까지 기다려 주세요.`,
    lock: conflict,
  };
}

/** Whether self currently holds an active claim on the resource. */
export function selfHoldsStudioLiveLock(
  locks: readonly StudioLiveLockLike[],
  resource: string,
  selfSessionId: string,
  now = Date.now()
): boolean {
  const self = typeof selfSessionId === "string" ? selfSessionId : "";
  for (const lock of locks) {
    if (lock.resource !== resource) continue;
    if (!isActiveLock(lock, now)) continue;
    if (lock.owner.sessionId === self) return true;
  }
  return false;
}

/**
 * Plan the set difference for replacing locally tracked edit leases. Shared resources remain held;
 * superseded resources release and only new resources claim. The async coordinator decides the
 * safe operation order and re-confirms retained resources with the authoritative server.
 */
export function planStudioLiveHeldResourceReplace(
  previouslyHeld: readonly string[] | null | undefined,
  nextResources: readonly string[] | null | undefined
): {
  toRelease: readonly string[];
  toClaim: readonly string[];
  held: readonly string[];
} {
  const prev: string[] = [];
  const seenPrev = new Set<string>();
  for (const resource of previouslyHeld ?? []) {
    if (typeof resource !== "string" || resource.length === 0 || seenPrev.has(resource)) continue;
    seenPrev.add(resource);
    prev.push(resource);
  }
  const next: string[] = [];
  const seenNext = new Set<string>();
  for (const resource of nextResources ?? []) {
    if (typeof resource !== "string" || resource.length === 0 || seenNext.has(resource)) continue;
    seenNext.add(resource);
    next.push(resource);
  }
  return {
    toRelease: prev.filter((resource) => !seenNext.has(resource)),
    toClaim: next.filter((resource) => !seenPrev.has(resource)),
    held: next,
  };
}

/** Clear held set (release everything). Pure companion to endLiveResourceEdit. */
export function planStudioLiveHeldResourceClear(
  previouslyHeld: readonly string[] | null | undefined
): { toRelease: readonly string[]; held: readonly string[] } {
  const plan = planStudioLiveHeldResourceReplace(previouslyHeld, []);
  return { toRelease: plan.toRelease, held: plan.held };
}
