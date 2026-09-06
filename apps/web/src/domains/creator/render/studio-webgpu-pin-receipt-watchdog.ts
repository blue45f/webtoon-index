export type StudioGpuPinReceiptTimeoutReason = "first-visible" | "progress";

interface StudioGpuPinReceiptWatchdogScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface StudioGpuPinReceiptWatchdogOptions {
  readonly timeoutMs: number;
  readonly onTimeout: (
    reason: StudioGpuPinReceiptTimeoutReason,
    requestId: string,
  ) => void;
  readonly scheduler?: StudioGpuPinReceiptWatchdogScheduler;
}

const DEFAULT_SCHEDULER: StudioGpuPinReceiptWatchdogScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/**
 * Receipt-correlated fail-visible watchdog for a single pinned live-ink epoch.
 *
 * The first-visible timer is absolute: pointer-frame requests cannot extend it. After the first
 * exact receipt, the first outstanding request starts a progress timer; newer requests update the
 * expected identity without moving that deadline. An exact current receipt is the only event that
 * clears either deadline.
 */
export class StudioGpuPinReceiptWatchdog {
  private readonly timeoutMs: number;
  private readonly onTimeout: StudioGpuPinReceiptWatchdogOptions["onTimeout"];
  private readonly scheduler: StudioGpuPinReceiptWatchdogScheduler;
  private firstVisibleTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private firstVisible = false;
  private expectedRequestId: string | null = null;
  private lastReadyRequestId: string | null = null;
  private epoch = 0;

  public constructor(options: StudioGpuPinReceiptWatchdogOptions) {
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs));
    this.onTimeout = options.onTimeout;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  public begin(requestId: string): void {
    this.cancelTimers();
    this.active = true;
    this.epoch += 1;
    this.expectedRequestId = requestId;
    this.firstVisible = this.lastReadyRequestId === requestId;
    if (this.firstVisible) return;

    const epoch = this.epoch;
    this.firstVisibleTimer = this.scheduler.setTimeout(() => {
      this.firstVisibleTimer = null;
      if (!this.active || this.epoch !== epoch || this.firstVisible) return;
      this.fail("first-visible");
    }, this.timeoutMs);
  }

  /**
   * @param timeoutMs Overrides this watchdog's budget for THIS request only.
   *
   * The default budget is a live-latency budget: a pointer frame that cannot present within it is
   * a broken live surface. A terminal request is a different question — the stroke is finished and
   * nothing is animating, so the only thing the deadline can still catch is a lost receipt, and a
   * commit render on the main thread routinely takes longer than a frame budget. Measured: with a
   * 300 ms budget for both, drawing a handful of ordinary pen strokes raised "WebGPU 라이브 잉크
   * 엔진을 더 이상 사용할 수 없어 현재 획을 취소했습니다" and the finished stroke was deleted.
   */
  public request(requestId: string, timeoutMs?: number): void {
    if (!this.active) return;
    this.expectedRequestId = requestId;
    if (this.lastReadyRequestId === requestId) {
      this.acceptExactReceipt();
      return;
    }
    // Before any visible receipt the immutable epoch timer is the stronger deadline. Crucially,
    // high-frequency appends do not clear or replace it.
    if (!this.firstVisible) return;
    if (this.progressTimer) {
      // An explicit budget answers a different question than the outstanding one, so it replaces
      // that deadline instead of inheriting it. The real order is always frame-then-terminal: a
      // pointer frame arms the 300 ms live deadline and pointer-up's terminal request lands inside
      // it, so without this the 2000 ms terminal budget never applied and the 300 ms deadline
      // cancelled the finished stroke — the exact failure the override was added to prevent.
      // Appends pass no budget, so they still cannot move the deadline that bounds them.
      if (timeoutMs === undefined) return;
      this.scheduler.clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }

    const epoch = this.epoch;
    this.progressTimer = this.scheduler.setTimeout(() => {
      this.progressTimer = null;
      if (
        !this.active
        || this.epoch !== epoch
        || this.expectedRequestId === this.lastReadyRequestId
      ) return;
      this.fail("progress");
    }, Math.max(1, Math.floor(timeoutMs ?? this.timeoutMs)));
  }

  /** Records all receipts, including a synchronous receipt that can arrive before begin/request. */
  public receipt(requestId: string): boolean {
    this.lastReadyRequestId = requestId;
    if (!this.active || requestId !== this.expectedRequestId) return false;
    this.acceptExactReceipt();
    return true;
  }

  public hasExactReceipt(requestId: string): boolean {
    return this.lastReadyRequestId === requestId;
  }

  public cancel(): void {
    this.active = false;
    this.epoch += 1;
    this.expectedRequestId = null;
    this.firstVisible = false;
    this.cancelTimers();
  }

  private acceptExactReceipt(): void {
    this.firstVisible = true;
    if (this.firstVisibleTimer) {
      this.scheduler.clearTimeout(this.firstVisibleTimer);
      this.firstVisibleTimer = null;
    }
    if (this.progressTimer) {
      this.scheduler.clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private fail(reason: StudioGpuPinReceiptTimeoutReason): void {
    const requestId = this.expectedRequestId;
    if (!requestId) return;
    this.active = false;
    this.epoch += 1;
    this.cancelTimers();
    this.onTimeout(reason, requestId);
  }

  private cancelTimers(): void {
    if (this.firstVisibleTimer) this.scheduler.clearTimeout(this.firstVisibleTimer);
    if (this.progressTimer) this.scheduler.clearTimeout(this.progressTimer);
    this.firstVisibleTimer = null;
    this.progressTimer = null;
  }
}
