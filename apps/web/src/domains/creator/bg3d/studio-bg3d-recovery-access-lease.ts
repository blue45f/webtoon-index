import type { StudioBg3dShotBatchRecoveryScope } from "./studio-bg3d-shot-batch-plan";

export const STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS = 5_000;

export interface StudioBg3dRecoveryAccessLease {
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  readonly revision: number;
  readonly projectGeneration: number;
  readonly expiresAt: number;
}

export interface StudioBg3dRecoveryAccessAuthorizationInput {
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  readonly revision: number;
  readonly projectGeneration: number;
  readonly signal: AbortSignal;
  /** Cheap local scope/save/mount proof, evaluated before cache use and again after remote I/O. */
  readonly isLocallyCurrent: () => boolean;
  /** Remote metadata proof. Failures must resolve false or reject; neither is cached. */
  readonly verify: () => Promise<boolean>;
}

interface StudioBg3dRecoveryAccessValidation {
  readonly token: object;
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  readonly revision: number;
  readonly projectGeneration: number;
  readonly signal: AbortSignal;
  readonly promise: Promise<boolean>;
}

export function createStudioBg3dRecoveryAccessLease(input: {
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  readonly revision: number;
  readonly projectGeneration: number;
  readonly authorizedAt: number;
}): StudioBg3dRecoveryAccessLease {
  return Object.freeze({
    scope: input.scope,
    revision: input.revision,
    projectGeneration: input.projectGeneration,
    expiresAt: input.authorizedAt + STUDIO_BG3D_RECOVERY_ACCESS_LEASE_TTL_MS,
  });
}

export function isStudioBg3dRecoveryAccessLeaseReusable(
  lease: StudioBg3dRecoveryAccessLease | null,
  input: {
    readonly scope: StudioBg3dShotBatchRecoveryScope;
    readonly revision: number;
    readonly projectGeneration: number;
    readonly now: number;
  },
): boolean {
  return lease !== null
    && lease.scope === input.scope
    && lease.revision === input.revision
    && lease.projectGeneration === input.projectGeneration
    && input.now < lease.expiresAt;
}

/** Short-lived, fail-closed authorization cache for a single mounted editor instance. */
export class StudioBg3dRecoveryAccessGate {
  private lease: StudioBg3dRecoveryAccessLease | null = null;
  private inFlight: StudioBg3dRecoveryAccessValidation | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  clear(): void {
    this.lease = null;
    this.inFlight = null;
  }

  async authorize(input: StudioBg3dRecoveryAccessAuthorizationInput): Promise<boolean> {
    if (input.signal.aborted || !input.isLocallyCurrent()) return false;
    if (isStudioBg3dRecoveryAccessLeaseReusable(this.lease, {
      scope: input.scope,
      revision: input.revision,
      projectGeneration: input.projectGeneration,
      now: this.now(),
    })) return true;

    const pending = this.inFlight;
    if (
      pending && pending.scope === input.scope && pending.revision === input.revision &&
      pending.projectGeneration === input.projectGeneration && pending.signal === input.signal
    ) {
      const allowed = await pending.promise;
      return allowed && !input.signal.aborted && input.isLocallyCurrent() &&
        isStudioBg3dRecoveryAccessLeaseReusable(this.lease, {
          scope: input.scope,
          revision: input.revision,
          projectGeneration: input.projectGeneration,
          now: this.now(),
        });
    }

    this.lease = null;
    const token = Object.freeze({});
    const validation = (async (): Promise<boolean> => {
      try {
        const allowed = await input.verify();
        if (
          !allowed || input.signal.aborted || !input.isLocallyCurrent() ||
          this.inFlight?.token !== token
        ) return false;
        this.lease = createStudioBg3dRecoveryAccessLease({
          scope: input.scope,
          revision: input.revision,
          projectGeneration: input.projectGeneration,
          authorizedAt: this.now(),
        });
        return true;
      } catch {
        return false;
      }
    })();
    const record: StudioBg3dRecoveryAccessValidation = {
      token,
      scope: input.scope,
      revision: input.revision,
      projectGeneration: input.projectGeneration,
      signal: input.signal,
      promise: validation,
    };
    this.inFlight = record;
    try {
      return await validation;
    } finally {
      if (this.inFlight === record) this.inFlight = null;
    }
  }
}
