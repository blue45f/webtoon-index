import {
  canonicalStudioRasterJson,
  type StudioRasterOperationLog,
} from "@/shared/lib/studio-crdt-raster-ops";

export interface StudioRasterServerAuthorityEntry {
  readonly surfaceId: string;
  /** SHA-256 of the exact surface, operation, undo and redo-acknowledgement frontier. */
  readonly logSha256: string;
}

export type StudioRasterServerAuthoritySnapshot =
  readonly StudioRasterServerAuthorityEntry[];

export type StudioRasterLogAuthorityHasher = (
  log: StudioRasterOperationLog,
  signal?: AbortSignal
) => Promise<string>;

const EMPTY_STUDIO_RASTER_SERVER_AUTHORITY: StudioRasterServerAuthoritySnapshot =
  Object.freeze([]);

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("래스터 서버 승인 확인이 취소되었습니다.", "AbortError");
}

/**
 * Binds renderer authority to the complete immutable raster event frontier. Operation ids alone
 * are insufficient: a local undo or redo acknowledgement must also receive a server ACK before it
 * is allowed to change which Konva fallbacks are hidden.
 */
export async function sha256StudioRasterOperationLogAuthority(
  log: StudioRasterOperationLog,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 브라우저에서는 래스터 서버 승인 SHA-256을 계산할 수 없습니다.");
  }
  const encoded = new TextEncoder().encode(canonicalStudioRasterJson({
    authorityVersion: 1,
    log,
  }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  throwIfAborted(signal);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function captureStudioRasterServerAuthoritySnapshot(
  logs: readonly StudioRasterOperationLog[],
  options: {
    readonly signal?: AbortSignal;
    readonly hash?: StudioRasterLogAuthorityHasher;
  } = {}
): Promise<StudioRasterServerAuthoritySnapshot> {
  const hash = options.hash ?? sha256StudioRasterOperationLogAuthority;
  const sorted = [...logs].sort((left, right) =>
    left.surface.surfaceId.localeCompare(right.surface.surfaceId)
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.surface.surfaceId === sorted[index]!.surface.surfaceId) {
      throw new Error("같은 래스터 surface의 서버 승인 상태가 중복되었습니다.");
    }
  }
  const entries = await Promise.all(sorted.map(async (log) => Object.freeze({
    surfaceId: log.surface.surfaceId,
    logSha256: await hash(log, options.signal),
  })));
  throwIfAborted(options.signal);
  return Object.freeze(entries);
}

export function sameStudioRasterServerAuthoritySnapshot(
  left: StudioRasterServerAuthoritySnapshot,
  right: StudioRasterServerAuthoritySnapshot
): boolean {
  return left === right || (
    left.length === right.length && left.every((entry, index) =>
      entry.surfaceId === right[index]?.surfaceId &&
      entry.logSha256 === right[index]?.logSha256
    )
  );
}

export function studioRasterServerAuthorityForSurface(
  snapshot: StudioRasterServerAuthoritySnapshot,
  surfaceId: string
): string | null {
  return snapshot.find((entry) => entry.surfaceId === surfaceId)?.logSha256 ?? null;
}

/**
 * Produces authority only when the exact raster frontier is unchanged across a real server ACK
 * barrier. A stroke/undo arriving during the network round trip returns null and must be retried;
 * this closes the small race between a successful ACK and renderer handoff authorization.
 */
export async function approveStudioRasterServerAuthority(input: {
  readonly readLogs: () => readonly StudioRasterOperationLog[];
  readonly waitForAuthoritativeAck: () => Promise<unknown>;
  readonly signal?: AbortSignal;
  readonly hash?: StudioRasterLogAuthorityHasher;
}): Promise<StudioRasterServerAuthoritySnapshot | null> {
  const before = await captureStudioRasterServerAuthoritySnapshot(input.readLogs(), {
    signal: input.signal,
    hash: input.hash,
  });
  if (before.length === 0) return before;
  throwIfAborted(input.signal);
  await input.waitForAuthoritativeAck();
  throwIfAborted(input.signal);
  const after = await captureStudioRasterServerAuthoritySnapshot(input.readLogs(), {
    signal: input.signal,
    hash: input.hash,
  });
  return sameStudioRasterServerAuthoritySnapshot(before, after) ? after : null;
}

export interface StudioRasterServerAuthorityCoordinatorOptions {
  readonly readLogs: () => readonly StudioRasterOperationLog[];
  readonly waitForAuthoritativeAck: () => Promise<unknown>;
  readonly onAuthorityChange: (snapshot: StudioRasterServerAuthoritySnapshot) => void;
  readonly onError?: (cause: unknown) => void;
  readonly debounceMs?: number;
  readonly hash?: StudioRasterLogAuthorityHasher;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/**
 * Coalesces a burst of raster mutations into one server barrier. Invalidation is synchronous and
 * fail-closed; network work happens after the short debounce, and a mutation that arrives during
 * an in-flight barrier is folded into exactly one follow-up pass.
 */
export class StudioRasterServerAuthorityCoordinator {
  private readonly controller = new AbortController();
  private readonly debounceMs: number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private authority: StudioRasterServerAuthoritySnapshot =
    EMPTY_STUDIO_RASTER_SERVER_AUTHORITY;
  private timer: unknown = null;
  private dirty = false;
  private running: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly options: StudioRasterServerAuthorityCoordinatorOptions) {
    this.debounceMs = Math.max(0, Math.min(1_000, Math.trunc(options.debounceMs ?? 60)));
    this.scheduleTimeout = options.setTimeout ?? ((handler, delay) =>
      globalThis.setTimeout(handler, delay));
    this.cancelTimeout = options.clearTimeout ?? ((handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void {
    this.invalidate();
  }

  invalidate(): void {
    if (this.closed) return;
    this.dirty = true;
    this.publish(EMPTY_STUDIO_RASTER_SERVER_AUTHORITY);
    if (this.running || this.timer !== null) return;
    this.timer = this.scheduleTimeout(() => {
      this.timer = null;
      void this.beginRun();
    }, this.debounceMs);
  }

  /** Test/save seam; normal editing uses the coalesced scheduled path. */
  flushNow(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.dirty = true;
    if (this.timer !== null) {
      this.cancelTimeout(this.timer);
      this.timer = null;
    }
    return this.beginRun();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dirty = false;
    if (this.timer !== null) this.cancelTimeout(this.timer);
    this.timer = null;
    this.controller.abort(new DOMException("래스터 서버 승인 범위가 변경되었습니다.", "AbortError"));
  }

  private beginRun(): Promise<void> {
    if (this.running) return this.running;
    const run = this.run().finally(() => {
      if (this.running === run) this.running = null;
      if (!this.closed && this.dirty && this.timer === null) {
        this.timer = this.scheduleTimeout(() => {
          this.timer = null;
          void this.beginRun();
        }, this.debounceMs);
      }
    });
    this.running = run;
    return run;
  }

  private async run(): Promise<void> {
    while (!this.closed && this.dirty) {
      this.dirty = false;
      try {
        const approved = await approveStudioRasterServerAuthority({
          readLogs: this.options.readLogs,
          waitForAuthoritativeAck: this.options.waitForAuthoritativeAck,
          signal: this.controller.signal,
          hash: this.options.hash,
        });
        if (this.closed) return;
        if (approved === null || this.dirty) {
          this.dirty = true;
          continue;
        }
        this.publish(approved);
      } catch (cause) {
        if (
          this.closed || this.controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) return;
        this.options.onError?.(cause);
        // A connectivity/capability transition reconstructs or invalidates the coordinator. Do not
        // hot-loop a server failure while the safe vector fallback is already visible.
        return;
      }
    }
  }

  private publish(snapshot: StudioRasterServerAuthoritySnapshot): void {
    if (sameStudioRasterServerAuthoritySnapshot(this.authority, snapshot)) return;
    this.authority = snapshot;
    this.options.onAuthorityChange(snapshot);
  }
}
