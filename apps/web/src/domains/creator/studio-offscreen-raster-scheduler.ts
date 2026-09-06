/**
 * OffscreenCanvas 래스터 잡의 순수 스케줄링 코어 — DOM·Worker·타이머 의존이 전혀 없다.
 *
 * 담당:
 *  - runId 발급(세션 내 단조 증가)과 **중재**: 비행 중인 런의 결과만 받아들이고, 늦게 도착한
 *    옛 런의 결과는 stale 로 거부한다(레포의 generation/requestId 가드와 같은 규율).
 *  - **코얼레싱**: 같은 jobKey 로 폭주가 들어오면 대기열에는 최신 것 하나만 남긴다. 슬라이더
 *    드래그·연속 썸네일 갱신이 큐에 쌓이지 않게 하는 게 목적이다.
 *  - **백프레셔**: 서로 다른 키가 maxQueued 를 넘게 쌓이면 가장 오래된 것부터 버린다
 *    (사용자가 마지막으로 요청한 화면이 가장 중요하다).
 *
 * 이 모듈은 페이로드가 무엇인지 모른다(제네릭). 그래서 헤드리스로 결정성을 검증할 수 있고,
 * 실제 OffscreenCanvas 작업은 studio-offscreen-raster-runtime 의 주입 seam 뒤에 남는다.
 */

export type StudioOffscreenQueuePolicy = "coalesce-latest" | "queue-all";

export interface StudioOffscreenSchedulerOptions {
  readonly policy?: StudioOffscreenQueuePolicy;
  /** 대기열에 남길 수 있는 잡 수(비행 중인 잡은 별도). */
  readonly maxQueued?: number;
  /** 첫 runId. 테스트 결정성을 위해 주입 가능. */
  readonly firstRunId?: number;
}

export interface StudioOffscreenSchedulerJob<TPayload> {
  readonly runId: number;
  readonly jobKey: string;
  readonly payload: TPayload;
}

export type StudioOffscreenDropReason =
  /** 같은 jobKey 의 더 새로운 제출이 대기열에서 이 잡을 대체했다. */
  | "coalesced"
  /** 대기열 상한을 넘겨 가장 오래된 잡을 버렸다. */
  | "backpressure"
  /** 명시적 취소. */
  | "cancelled"
  /** 스케줄러가 폐기됐다. */
  | "disposed";

export interface StudioOffscreenDroppedJob<TPayload> {
  readonly job: StudioOffscreenSchedulerJob<TPayload>;
  readonly reason: StudioOffscreenDropReason;
}

export interface StudioOffscreenSubmitOutcome<TPayload> {
  readonly job: StudioOffscreenSchedulerJob<TPayload>;
  /** 이 제출 때문에 대기열에서 빠진 잡들. 호출자는 이들을 실패로 정산해야 한다. */
  readonly dropped: readonly StudioOffscreenDroppedJob<TPayload>[];
  /**
   * 이 제출이 같은 jobKey 의 비행 중 런을 무효화했다면 그 runId. 호출자는 Worker 로 cancel 을
   * 보내고, 그 런의 결과가 뒤늦게 와도 커밋하지 않아야 한다.
   */
  readonly supersededInFlightRunId: number | null;
}

export type StudioOffscreenSettleVerdict<TPayload> =
  | { readonly kind: "accept"; readonly job: StudioOffscreenSchedulerJob<TPayload> }
  | { readonly kind: "stale"; readonly reason: "unknown-run" | "superseded" | "cancelled" };

export interface StudioOffscreenArbitrationState {
  readonly inFlightRunId: number | null;
  readonly cancelledRunIds: ReadonlySet<number>;
  readonly highestIssuedRunId: number;
}

export type StudioOffscreenArbitration = "accept" | "cancelled" | "superseded" | "unknown-run";

/**
 * 중재의 순수 핵심. 비행 중인 런과 정확히 같은 runId 만 통과한다. 취소된 런은 "cancelled",
 * 발급된 적 있으나 이미 대체된 런은 "superseded", 발급된 적 없는 값은 "unknown-run".
 */
export function arbitrateStudioOffscreenRunId(
  state: StudioOffscreenArbitrationState,
  runId: number,
): StudioOffscreenArbitration {
  if (!Number.isSafeInteger(runId) || runId <= 0 || runId > state.highestIssuedRunId) return "unknown-run";
  if (state.cancelledRunIds.has(runId)) return "cancelled";
  if (state.inFlightRunId === runId) return "accept";
  return "superseded";
}

function boundedMaxQueued(value: number | undefined): number {
  if (!Number.isFinite(value)) return 8;
  return Math.max(1, Math.min(256, Math.floor(value ?? 8)));
}

function boundedFirstRunId(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) <= 0) return 1;
  return value as number;
}

/**
 * 단일 실행 슬롯(직렬) 스케줄러. Worker 는 한 번에 한 잡만 처리하므로 슬롯은 하나면 충분하고,
 * 그 덕분에 transfer 소유권 추적도 단순해진다.
 */
export class StudioOffscreenRasterScheduler<TPayload> {
  private readonly policy: StudioOffscreenQueuePolicy;
  private readonly maxQueued: number;
  private queue: StudioOffscreenSchedulerJob<TPayload>[] = [];
  private inFlight: StudioOffscreenSchedulerJob<TPayload> | null = null;
  private cancelled = new Set<number>();
  private nextRunId: number;
  private highestIssued = 0;
  private disposed = false;

  constructor(options: StudioOffscreenSchedulerOptions = {}) {
    this.policy = options.policy ?? "coalesce-latest";
    this.maxQueued = boundedMaxQueued(options.maxQueued);
    this.nextRunId = boundedFirstRunId(options.firstRunId);
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get inFlightRunId(): number | null {
    return this.inFlight?.runId ?? null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** 대기열 스냅샷(제출 순서). 테스트·계측용 읽기 전용 뷰. */
  peekQueue(): readonly StudioOffscreenSchedulerJob<TPayload>[] {
    return this.queue.slice();
  }

  arbitrationState(): StudioOffscreenArbitrationState {
    return {
      inFlightRunId: this.inFlight?.runId ?? null,
      cancelledRunIds: new Set(this.cancelled),
      highestIssuedRunId: this.highestIssued,
    };
  }

  submit(jobKey: string, payload: TPayload): StudioOffscreenSubmitOutcome<TPayload> {
    if (this.disposed) {
      throw new Error("폐기된 OffscreenCanvas 래스터 스케줄러에는 잡을 제출할 수 없습니다.");
    }
    const runId = this.nextRunId;
    this.nextRunId = runId >= Number.MAX_SAFE_INTEGER ? 1 : runId + 1;
    this.highestIssued = Math.max(this.highestIssued, runId);
    const job: StudioOffscreenSchedulerJob<TPayload> = { runId, jobKey, payload };

    const dropped: StudioOffscreenDroppedJob<TPayload>[] = [];
    let supersededInFlightRunId: number | null = null;

    if (this.policy === "coalesce-latest") {
      const kept: StudioOffscreenSchedulerJob<TPayload>[] = [];
      for (const queued of this.queue) {
        if (queued.jobKey === jobKey) dropped.push({ job: queued, reason: "coalesced" });
        else kept.push(queued);
      }
      this.queue = kept;
      if (this.inFlight && this.inFlight.jobKey === jobKey) {
        supersededInFlightRunId = this.inFlight.runId;
        this.cancelled.add(this.inFlight.runId);
      }
    }

    this.queue.push(job);
    while (this.queue.length > this.maxQueued) {
      const evicted = this.queue.shift();
      if (!evicted) break;
      dropped.push({ job: evicted, reason: "backpressure" });
    }

    return { job, dropped, supersededInFlightRunId };
  }

  /** 실행 슬롯이 비어 있으면 다음 잡을 꺼내 비행 상태로 만든다. 비어 있지 않으면 null. */
  takeNext(): StudioOffscreenSchedulerJob<TPayload> | null {
    if (this.disposed || this.inFlight) return null;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      if (this.cancelled.has(next.runId)) continue;
      this.inFlight = next;
      return next;
    }
    return null;
  }

  /**
   * 결과 정산.
   *  - accept: 비행 중인 런과 일치 → 슬롯을 비우고 페이로드 커밋을 허가한다.
   *  - stale: 커밋 금지. 다만 **취소된 비행 런의 결과가 도착한 경우엔 그 런이 끝난 것이므로**
   *    슬롯도 함께 비운다(안 그러면 이미 취소된 런이 실행 슬롯을 영원히 붙들어 교착된다).
   *    비행 중이 아닌 옛 런의 늦은 결과는 슬롯을 전혀 건드리지 않는다.
   */
  settle(runId: number): StudioOffscreenSettleVerdict<TPayload> {
    const verdict = arbitrateStudioOffscreenRunId(this.arbitrationState(), runId);
    if (verdict !== "accept") {
      if (this.inFlight?.runId === runId) this.inFlight = null;
      // 취소·대체된 런의 결과가 도착했으니 취소 장부에서 지워도 안전하다(무한 성장 방지).
      this.cancelled.delete(runId);
      return { kind: "stale", reason: verdict === "unknown-run" ? "unknown-run" : verdict };
    }
    const job = this.inFlight as StudioOffscreenSchedulerJob<TPayload>;
    this.inFlight = null;
    this.cancelled.delete(runId);
    return { kind: "accept", job };
  }

  /**
   * 특정 런 취소. 대기 중이면 즉시 큐에서 뺀다. 비행 중이면 취소 장부에 올려 결과가 와도
   * stale 로 떨어지게 한다(실행 슬롯은 결과/타임아웃이 정리한다).
   */
  cancel(runId: number): StudioOffscreenDroppedJob<TPayload> | null {
    const index = this.queue.findIndex((job) => job.runId === runId);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      this.cancelled.add(runId);
      return { job, reason: "cancelled" };
    }
    if (this.inFlight?.runId === runId) {
      this.cancelled.add(runId);
      return { job: this.inFlight, reason: "cancelled" };
    }
    return null;
  }

  /** 비행 중인 런을 강제로 포기하고 슬롯을 연다(타임아웃·Worker 재생성 경로). */
  abandonInFlight(): StudioOffscreenSchedulerJob<TPayload> | null {
    const job = this.inFlight;
    if (!job) return null;
    this.cancelled.add(job.runId);
    this.inFlight = null;
    return job;
  }

  dispose(): readonly StudioOffscreenDroppedJob<TPayload>[] {
    if (this.disposed) return [];
    this.disposed = true;
    const dropped: StudioOffscreenDroppedJob<TPayload>[] = this.queue.map((job) => ({
      job,
      reason: "disposed" as const,
    }));
    this.queue = [];
    if (this.inFlight) {
      dropped.push({ job: this.inFlight, reason: "disposed" });
      this.cancelled.add(this.inFlight.runId);
      this.inFlight = null;
    }
    return dropped;
  }
}
