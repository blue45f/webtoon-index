export const STUDIO_BG3D_GLOBAL_ASSET_LOAD_CONCURRENCY = 1;
export const STUDIO_BG3D_ASSET_LOAD_LEASE_TIMEOUT_MS = 120_000;
export const STUDIO_BG3D_SCENE_MUTATION_LEASE_TIMEOUT_MS = 120_000;

const STUDIO_BG3D_MAX_OPERATION_LEASE_TIMEOUT_MS = 10 * 60_000;

export interface StudioBg3dModalSession {
  readonly epoch: number;
}

export interface StudioBg3dOperationLease {
  readonly generation: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  throwIfRevoked(): void;
}

export type StudioBg3dSceneMutationResult<T> =
  | {
      readonly status: "committed";
      readonly value: T;
    }
  | {
      readonly status: "stale";
    };

export interface StudioBg3dAssetLoadGateOptions {
  /** Checked immediately before the queued work receives a global load slot. */
  readonly isCurrent?: () => boolean;
  /** Starts when work receives a slot; queue wait time is deliberately excluded. */
  readonly timeoutMs?: number;
}

export interface StudioBg3dSceneMutationOptions {
  /** Starts when the mutation reaches the head of the global lane. */
  readonly timeoutMs?: number;
  /**
   * The prepare phase crosses an irreversible persistence boundary.
   *
   * A timeout still aborts cooperative work, but the caller and FIFO lane remain quarantined until
   * prepare physically settles. If persistence won the abort race, its value is committed while the
   * originating session is current. A replaced session can wait for the lane and reconcile from the
   * durable persistence journal instead of observing a half-finished delete.
   */
  readonly authoritativePersistence?: boolean;
}

export interface StudioBg3dCombinedAbortSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/**
 * Combines abort authority without relying on `AbortSignal.any`, which is unavailable in part of
 * the editor's supported Safari/iOS range. The first abort reason wins and every listener is
 * detached either immediately after forwarding or when the caller's operation settles.
 */
export function combineStudioBg3dAbortSignals(
  signals: readonly AbortSignal[],
): StudioBg3dCombinedAbortSignal {
  if (signals.length === 0) {
    return { signal: new AbortController().signal, dispose() {} };
  }
  if (signals.length === 1) {
    return { signal: signals[0]!, dispose() {} };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const dispose = () => {
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };
  const forward = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    controller.abort(signal.reason);
    dispose();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      forward(signal);
      break;
    }
    const listener = () => forward(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }

  return { signal: controller.signal, dispose };
}

export class StudioBg3dStaleModalOperationError extends Error {
  readonly code = "stale-modal-epoch";

  constructor() {
    super("닫힌 3D 배경 편집기의 비동기 작업입니다.");
    this.name = "AbortError";
  }
}

export class StudioBg3dOperationLeaseTimeoutError extends Error {
  readonly code = "operation-lease-timeout";
  readonly generation: number;
  readonly scope: "asset-load" | "scene-mutation";
  readonly timeoutMs: number;

  constructor(
    scope: "asset-load" | "scene-mutation",
    generation: number,
    timeoutMs: number,
  ) {
    super(
      scope === "asset-load"
        ? "3D 자산 불러오기가 제한 시간을 초과해 안전하게 중단되었습니다."
        : "3D 장면 변경이 제한 시간을 초과해 안전하게 중단되었습니다.",
    );
    this.name = "TimeoutError";
    this.scope = scope;
    this.generation = generation;
    this.timeoutMs = timeoutMs;
  }
}

interface StudioBg3dOperationLeaseController {
  readonly lease: StudioBg3dOperationLease;
  complete(): void;
  revoke(reason: Error): void;
}

function boundedLeaseTimeout(timeoutMs: number | undefined, fallback: number): number {
  if (timeoutMs === undefined) return fallback;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }
  return Math.min(
    STUDIO_BG3D_MAX_OPERATION_LEASE_TIMEOUT_MS,
    Math.max(1, Math.floor(timeoutMs)),
  );
}

function createOperationLease(
  generation: number,
  isExternallyCurrent: () => boolean,
): StudioBg3dOperationLeaseController {
  const controller = new AbortController();
  let active = true;
  let revocationReason: Error | null = null;
  const lease: StudioBg3dOperationLease = Object.freeze({
    generation,
    signal: controller.signal,
    isCurrent: () => active && !controller.signal.aborted && isExternallyCurrent(),
    throwIfRevoked: () => {
      if (active && !controller.signal.aborted && isExternallyCurrent()) return;
      throw revocationReason ?? new StudioBg3dStaleModalOperationError();
    },
  });
  return {
    lease,
    complete() {
      active = false;
    },
    revoke(reason) {
      if (!active) return;
      active = false;
      revocationReason = reason;
      controller.abort(reason);
    },
  };
}

/**
 * Process-wide FIFO admission gate for decoded BG3D assets.
 *
 * A GLB load can temporarily own the source bytes, validation copy, decoded geometry, textures,
 * and GPU upload at the same time. Per-scene byte validation does not bound that transient peak,
 * so every modal generation shares this small gate. A queued stale generation is rejected before
 * it can allocate any of those resources. A task receives a revocable lease so Worker/decoder
 * implementations can terminate their own realm on timeout. The caller is rejected at the
 * deadline, but the physical slot remains quarantined until a non-cooperative task actually
 * settles. This preserves the process-wide transient-memory bound instead of starting a second
 * decoder while the timed-out decoder still owns bytes, geometry, textures, or GPU resources.
 */
export class StudioBg3dAssetLoadGate {
  readonly #maxConcurrent: number;
  readonly #queue: Array<() => void> = [];
  #activeCount = 0;
  #leaseGeneration = 0;

  constructor(maxConcurrent = STUDIO_BG3D_GLOBAL_ASSET_LOAD_CONCURRENCY) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a positive safe integer");
    }
    this.#maxConcurrent = maxConcurrent;
  }

  get activeCount(): number {
    return this.#activeCount;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  run<T>(
    task: (lease: StudioBg3dOperationLease) => Promise<T> | T,
    options: StudioBg3dAssetLoadGateOptions = {},
  ): Promise<T> {
    const timeoutMs = boundedLeaseTimeout(
      options.timeoutMs,
      STUDIO_BG3D_ASSET_LOAD_LEASE_TIMEOUT_MS,
    );
    return new Promise<T>((resolve, reject) => {
      this.#queue.push(() => {
        const generation = ++this.#leaseGeneration;
        const leaseController = createOperationLease(
          generation,
          () => options.isCurrent?.() !== false,
        );
        let callerSettled = false;
        let slotReleased = false;
        const releaseSlot = () => {
          if (slotReleased) return;
          slotReleased = true;
          this.#activeCount -= 1;
          this.#drain();
        };
        const settleCaller = (
          outcome:
            | { readonly status: "resolved"; readonly value: T }
            | { readonly status: "rejected"; readonly reason: unknown },
        ) => {
          if (callerSettled) return;
          callerSettled = true;
          if (timeout !== undefined) clearTimeout(timeout);
          if (outcome.status === "resolved") resolve(outcome.value);
          else reject(outcome.reason);
        };
        const revoke = (reason: Error) => {
          if (callerSettled) return;
          leaseController.revoke(reason);
          settleCaller({ status: "rejected", reason });
        };

        const timeout = setTimeout(() => {
          const reason = options.isCurrent?.() === false
            ? new StudioBg3dStaleModalOperationError()
            : new StudioBg3dOperationLeaseTimeoutError("asset-load", generation, timeoutMs);
          revoke(reason);
        }, timeoutMs);

        void Promise.resolve()
          .then(() => {
            leaseController.lease.throwIfRevoked();
            return task(leaseController.lease);
          })
          .then((value) => {
            if (!callerSettled) {
              if (!leaseController.lease.isCurrent()) {
                revoke(new StudioBg3dStaleModalOperationError());
              } else {
                leaseController.complete();
                settleCaller({ status: "resolved", value });
              }
            }
            releaseSlot();
          }, (reason) => {
            if (!callerSettled) {
              leaseController.complete();
              settleCaller({ status: "rejected", reason });
            }
            releaseSlot();
          });
      });
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#activeCount < this.#maxConcurrent) {
      const start = this.#queue.shift();
      if (!start) return;
      this.#activeCount += 1;
      start();
    }
  }
}

/**
 * Global modal/session authority plus a FIFO scene-mutation lane.
 *
 * The editor is conditionally mounted, so a close/reopen cycle creates a fresh React tree while an
 * unabortable IndexedDB, decoder, or GPU task from the prior tree may still finish. Object identity
 * as well as the numeric epoch is required: only the exact active ticket can commit. Scene add and
 * delete operations share one lane across modal remounts, preventing a late add from resurrecting a
 * model after a later delete (or a late delete from removing a newly re-added model).
 */
export class StudioBg3dModalOperationCoordinator {
  #epoch = 0;
  #activeSession: StudioBg3dModalSession | null = null;
  #sceneMutationTail: Promise<void> = Promise.resolve();
  #sceneMutationLeaseGeneration = 0;
  #activeSceneMutation:
    | {
        readonly generation: number;
        revokeAsStale(): void;
      }
    | null = null;

  beginSession(): StudioBg3dModalSession {
    this.#activeSceneMutation?.revokeAsStale();
    const session = Object.freeze({ epoch: ++this.#epoch });
    this.#activeSession = session;
    return session;
  }

  endSession(session: StudioBg3dModalSession): boolean {
    if (!this.isCurrent(session)) return false;
    this.#activeSession = null;
    this.#epoch += 1;
    this.#activeSceneMutation?.revokeAsStale();
    return true;
  }

  isCurrent(session: StudioBg3dModalSession | null | undefined): boolean {
    return Boolean(session && this.#activeSession === session);
  }

  commitIfCurrent(session: StudioBg3dModalSession, commit: () => void): boolean {
    if (!this.isCurrent(session)) return false;
    commit();
    return true;
  }

  runSceneMutation<T>(
    session: StudioBg3dModalSession,
    prepare: (lease: StudioBg3dOperationLease) => Promise<T> | T,
    commit: (value: T) => void,
    options: StudioBg3dSceneMutationOptions = {},
  ): Promise<StudioBg3dSceneMutationResult<T>> {
    const timeoutMs = boundedLeaseTimeout(
      options.timeoutMs,
      STUDIO_BG3D_SCENE_MUTATION_LEASE_TIMEOUT_MS,
    );
    let resolveCaller!: (result: StudioBg3dSceneMutationResult<T>) => void;
    let rejectCaller!: (reason: unknown) => void;
    const caller = new Promise<StudioBg3dSceneMutationResult<T>>((resolve, reject) => {
      resolveCaller = resolve;
      rejectCaller = reject;
    });
    const physicalOperation = this.#sceneMutationTail.then(() => this.#executeSceneMutation(
      session,
      prepare,
      commit,
      timeoutMs,
      options.authoritativePersistence === true,
      resolveCaller,
      rejectCaller,
    ));
    this.#sceneMutationTail = physicalOperation.then(
      () => undefined,
      () => undefined,
    );
    return caller;
  }

  /**
   * Waits only for the physical FIFO lane. Reopened editors call this before restoration so an
   * authoritative delete from the preceding modal has either rolled back or published its durable
   * journal before attachments are resolved.
   */
  async waitForSceneMutationLane(): Promise<void> {
    await this.#sceneMutationTail;
  }

  #executeSceneMutation<T>(
    session: StudioBg3dModalSession,
    prepare: (lease: StudioBg3dOperationLease) => Promise<T> | T,
    commit: (value: T) => void,
    timeoutMs: number,
    authoritativePersistence: boolean,
    resolveCaller: (result: StudioBg3dSceneMutationResult<T>) => void,
    rejectCaller: (reason: unknown) => void,
  ): Promise<void> {
    if (!this.isCurrent(session)) {
      resolveCaller({ status: "stale" });
      return Promise.resolve();
    }

    return new Promise<void>((resolvePhysical) => {
      const generation = ++this.#sceneMutationLeaseGeneration;
      const leaseController = createOperationLease(
        generation,
        () => this.isCurrent(session),
      );
      let callerSettled = false;
      let physicalSettled = false;
      let timeoutError: StudioBg3dOperationLeaseTimeoutError | null = null;
      const clearActiveLease = () => {
        if (this.#activeSceneMutation?.generation === generation) {
          this.#activeSceneMutation = null;
        }
      };
      const finishPhysical = () => {
        if (physicalSettled) return;
        physicalSettled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        clearActiveLease();
        resolvePhysical();
      };
      const settleCallerStale = () => {
        if (callerSettled) return;
        callerSettled = true;
        resolveCaller({ status: "stale" });
      };
      const revokeAsStale = () => {
        if (physicalSettled) return;
        leaseController.revoke(new StudioBg3dStaleModalOperationError());
        settleCallerStale();
        if (!authoritativePersistence) finishPhysical();
      };

      this.#activeSceneMutation = {
        generation,
        revokeAsStale,
      };
      const timeout = setTimeout(() => {
        if (!this.isCurrent(session)) {
          revokeAsStale();
          return;
        }
        timeoutError = new StudioBg3dOperationLeaseTimeoutError(
          "scene-mutation",
          generation,
          timeoutMs,
        );
        leaseController.revoke(timeoutError);
        if (!authoritativePersistence) {
          callerSettled = true;
          rejectCaller(timeoutError);
          finishPhysical();
        }
      }, timeoutMs);

      let prepared: Promise<T> | T;
      try {
        leaseController.lease.throwIfRevoked();
        prepared = prepare(leaseController.lease);
      } catch (reason) {
        leaseController.complete();
        callerSettled = true;
        rejectCaller(reason);
        finishPhysical();
        return;
      }

      void Promise.resolve(prepared)
        .then((value) => {
          if (physicalSettled) return;
          if (authoritativePersistence && timeoutError) {
            if (!this.isCurrent(session)) {
              settleCallerStale();
              finishPhysical();
              return;
            }
            try {
              commit(value);
              leaseController.complete();
              if (!callerSettled) {
                callerSettled = true;
                resolveCaller({ status: "committed", value });
              }
            } catch (reason) {
              if (!callerSettled) {
                callerSettled = true;
                rejectCaller(reason);
              }
            }
            finishPhysical();
            return;
          }
          if (callerSettled || !leaseController.lease.isCurrent() || !this.isCurrent(session)) {
            settleCallerStale();
            finishPhysical();
            return;
          }

          // Move out of the revocable async phase first. No await/event-loop boundary is permitted
          // between the exact lease+session check and this synchronous commit.
          leaseController.complete();
          try {
            commit(value);
            callerSettled = true;
            resolveCaller({ status: "committed", value });
          } catch (reason) {
            callerSettled = true;
            rejectCaller(reason);
          }
          finishPhysical();
        }, (reason) => {
          if (physicalSettled) return;
          if (authoritativePersistence && timeoutError) {
            if (!this.isCurrent(session)) {
              settleCallerStale();
            } else if (!callerSettled) {
              callerSettled = true;
              rejectCaller(timeoutError);
            }
            finishPhysical();
            return;
          }
          if (callerSettled || !leaseController.lease.isCurrent() || !this.isCurrent(session)) {
            settleCallerStale();
            finishPhysical();
            return;
          }
          leaseController.complete();
          callerSettled = true;
          rejectCaller(reason);
          finishPhysical();
        });
    });
  }
}

export const studioBg3dGlobalAssetLoadGate = new StudioBg3dAssetLoadGate();
export const studioBg3dModalOperationCoordinator = new StudioBg3dModalOperationCoordinator();
