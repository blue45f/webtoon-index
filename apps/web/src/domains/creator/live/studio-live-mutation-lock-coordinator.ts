import type {
  StudioLiveLockAcquireResult,
  StudioLiveLockLease,
} from "./studio-live-collaboration-protocol";

export interface StudioLiveMutationLockRoom {
  claimLockAsync(resource: string): Promise<StudioLiveLockAcquireResult>;
  releaseLock(resource: string): boolean;
}

export type StudioLiveMutationLockAcquireFailure = Exclude<
  StudioLiveLockAcquireResult,
  { status: "acquired" }
>;

export type StudioLiveMutationLockReplaceResult =
  | {
      ok: true;
      held: readonly string[];
      locks: readonly StudioLiveLockLease[];
    }
  | {
      ok: false;
      held: readonly [];
      failure: StudioLiveMutationLockAcquireFailure;
    };

function uniqueResources(resources: readonly string[] | null | undefined): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of resources ?? []) {
    if (typeof value !== "string") continue;
    const resource = value.trim();
    if (!resource || seen.has(resource)) continue;
    seen.add(resource);
    unique.push(resource);
  }
  return unique;
}

/**
 * Replaces one live-edit lease set as an all-or-nothing client transaction.
 *
 * Every desired resource is re-confirmed with the authoritative server, including a resource that
 * was already tracked locally. Claims run in parallel so a multi-selection does not add one network
 * round trip per element. Any denial, timeout or revocation releases both newly acquired leases and
 * the previously tracked set before returning; callers therefore never start an edit with a partial
 * lock set. Old leases that are no longer desired are released only after every new claim succeeds.
 */
export async function replaceStudioLiveMutationLocks(input: {
  room: StudioLiveMutationLockRoom | null;
  previouslyHeld?: readonly string[] | null;
  nextResources?: readonly string[] | null;
}): Promise<StudioLiveMutationLockReplaceResult> {
  const previous = uniqueResources(input.previouslyHeld);
  const next = uniqueResources(input.nextResources);
  const room = input.room;
  if (!room) return { ok: true, held: next, locks: [] };

  const results = await Promise.all(
    next.map((resource) => room.claimLockAsync(resource))
  );
  const failure = results.find(
    (result): result is StudioLiveMutationLockAcquireFailure => result.status !== "acquired"
  );
  if (failure) {
    const release = new Set(previous);
    for (const result of results) {
      if (result.status === "acquired") release.add(result.resource);
    }
    for (const resource of release) room.releaseLock(resource);
    return { ok: false, held: [], failure };
  }

  const retained = new Set(next);
  for (const resource of previous) {
    if (!retained.has(resource)) room.releaseLock(resource);
  }
  return {
    ok: true,
    held: next,
    locks: results.flatMap((result) => result.status === "acquired" ? [result.lock] : []),
  };
}

/** Releases a tracked mutation set once, tolerating already-expired or server-revoked leases. */
export function releaseStudioLiveMutationLocks(
  room: Pick<StudioLiveMutationLockRoom, "releaseLock"> | null,
  held: readonly string[] | null | undefined
): readonly [] {
  if (room) {
    for (const resource of uniqueResources(held)) room.releaseLock(resource);
  }
  return [];
}
