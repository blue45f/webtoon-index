import {
  STUDIO_REALTIME_PROVIDER_LIMITS,
  STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
  StudioRealtimeConnectionRequestSchema,
  StudioRealtimePublishAckSchema,
  StudioRealtimeTicketSchema,
  negotiateStudioRealtimeProvider,
  parseStudioRealtimeInboundEvent,
  parseStudioRealtimeOutboundEvent,
  type StudioRealtimeCapability,
  type StudioRealtimeConnectionRequest,
  type StudioRealtimeInboundEvent,
  type StudioRealtimeOutboundEvent,
  type StudioRealtimeProviderHello,
  type StudioRealtimePublishAck,
  type StudioRealtimeScope,
  type StudioRealtimeTicketRequest,
  type StudioRealtimeWorkload,
} from "./studio-realtime-provider-protocol";

export type StudioRealtimeProviderKind =
  | "supabase-realtime"
  | "socket-io"
  | "custom";

export interface StudioRealtimeProviderDescriptor {
  readonly providerId: string;
  readonly kind: StudioRealtimeProviderKind;
  readonly protocolVersion: typeof STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION;
}

export type StudioRealtimeAdapterDisconnect = Readonly<{
  code:
    | "network-lost"
    | "provider-shutdown"
    | "ticket-expired"
    | "access-revoked"
    | "protocol-error";
  recoverable: boolean;
}>;

export interface StudioRealtimeProviderAdapterHandlers {
  readonly onEvent: (value: unknown) => void;
  readonly onDisconnect: (reason: StudioRealtimeAdapterDisconnect) => void;
}

/**
 * SDK-free provider port. Supabase Realtime and Socket.IO adapters implement this exact boundary,
 * so the product can prefer a purpose-specific host and fall back without changing feature
 * semantics. `ticket` is memory-only and must not be copied into adapter state after connect.
 */
export interface StudioRealtimeProviderAdapter {
  readonly descriptor: StudioRealtimeProviderDescriptor;
  connect(
    request: StudioRealtimeConnectionRequest,
    ticket: string,
    handlers: StudioRealtimeProviderAdapterHandlers,
    signal: AbortSignal,
  ): Promise<unknown>;
  publish(
    event: StudioRealtimeOutboundEvent,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void> | void;
}

export interface StudioRealtimeProviderAdapterFactory {
  readonly descriptor: StudioRealtimeProviderDescriptor;
  create(): Promise<StudioRealtimeProviderAdapter> | StudioRealtimeProviderAdapter;
}

export interface StudioRealtimeTicketIssuer {
  issue(
    request: StudioRealtimeTicketRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export type StudioRealtimeProviderStatus =
  | Readonly<{ state: "idle"; providerId: null; attempt: 0 }>
  | Readonly<{
      state: "connecting" | "reconnecting";
      providerId: string | null;
      attempt: number;
    }>
  | Readonly<{ state: "ready"; providerId: string; attempt: number }>
  | Readonly<{
      state: "waiting";
      providerId: null;
      attempt: number;
      retryInMs: number;
    }>
  | Readonly<{
      state: "revoked";
      providerId: string | null;
      attempt: number;
    }>
  | Readonly<{ state: "disposed"; providerId: null; attempt: number }>;

export interface StudioRealtimeProviderSessionOptions {
  readonly scope: StudioRealtimeScope;
  readonly clientInstanceId: string;
  readonly sessionId: string;
  readonly requiredWorkloads: readonly StudioRealtimeWorkload[];
  readonly requiredCapabilities: readonly StudioRealtimeCapability[];
  readonly providers: readonly StudioRealtimeProviderAdapterFactory[];
  readonly ticketIssuer: StudioRealtimeTicketIssuer;
  readonly reconnect?: Readonly<{
    initialDelayMs?: number;
    maximumDelayMs?: number;
    multiplier?: number;
    jitter?: number;
  }>;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

export class StudioRealtimeProviderUnavailableError extends Error {
  readonly code = "studio-realtime-provider-unavailable";

  constructor() {
    super("요청한 실시간 기능을 모두 제공하는 호스트에 연결하지 못했습니다.");
    this.name = "StudioRealtimeProviderUnavailableError";
  }
}

export class StudioRealtimeProviderContractError extends Error {
  readonly code = "studio-realtime-provider-contract-error";

  constructor(message = "실시간 공급자 계약이 올바르지 않습니다.") {
    super(message);
    this.name = "StudioRealtimeProviderContractError";
  }
}

/**
 * The optional provider cannot reconstruct authoritative state from its
 * bounded history. The caller must keep the workload on the primary
 * transport instead of retrying the same impossible cursor forever.
 */
export class StudioRealtimeProviderFallbackRequiredError extends Error {
  readonly code = "studio-realtime-provider-fallback-required";
  readonly providerId: string;

  constructor(providerId: string) {
    super("실시간 공급자의 보존 범위를 벗어나 기본 협업 경로를 사용합니다.");
    this.name = "StudioRealtimeProviderFallbackRequiredError";
    this.providerId = providerId;
  }
}

/**
 * 401/403 ticket responses are authorization decisions, not brownouts.
 * Reconnecting would hammer `/tickets` without changing the outcome.
 */
export class StudioRealtimeTicketDeniedError extends Error {
  readonly code = "studio-realtime-ticket-denied";

  constructor() {
    super("실시간 작업실 입장 권한이 없습니다.");
    this.name = "StudioRealtimeTicketDeniedError";
  }
}

interface ActiveProvider {
  readonly adapter: StudioRealtimeProviderAdapter;
  readonly hello: StudioRealtimeProviderHello;
  readonly generation: number;
}

const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u;
const MAX_SEEN_IDEMPOTENCY_KEYS = 4_096;
const DEFAULT_INITIAL_RECONNECT_MS = 750;
const DEFAULT_MAXIMUM_RECONNECT_MS = 30_000;
const DEFAULT_RECONNECT_MULTIPLIER = 1.8;
const DEFAULT_RECONNECT_JITTER = 0.2;

function assertDescriptor(
  descriptor: StudioRealtimeProviderDescriptor,
): void {
  if (
    !descriptor ||
    !PROVIDER_ID.test(descriptor.providerId) ||
    (descriptor.kind !== "supabase-realtime" &&
      descriptor.kind !== "socket-io" &&
      descriptor.kind !== "custom") ||
    descriptor.protocolVersion !== STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION
  ) {
    throw new StudioRealtimeProviderContractError(
      "실시간 공급자 설명자가 올바르지 않습니다.",
    );
  }
}

function sameScope(left: StudioRealtimeScope, right: StudioRealtimeScope): boolean {
  return left.workId === right.workId && left.roomId === right.roomId;
}

function containsExactly<Value>(
  granted: readonly Value[],
  requested: readonly Value[],
): boolean {
  if (granted.length !== requested.length) return false;
  const grantSet = new Set(granted);
  return requested.every((value) => grantSet.has(value));
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function safeFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export class StudioRealtimeProviderSession {
  private readonly options: StudioRealtimeProviderSessionOptions;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly initialReconnectMs: number;
  private readonly maximumReconnectMs: number;
  private readonly reconnectMultiplier: number;
  private readonly reconnectJitter: number;
  private readonly eventListeners = new Set<
    (event: StudioRealtimeInboundEvent) => void
  >();
  private readonly statusListeners = new Set<
    (status: StudioRealtimeProviderStatus) => void
  >();
  private readonly resume = new Map<
    StudioRealtimeWorkload,
    { serverSequence: string; eventId: string }
  >();
  private readonly lastServerSequence = new Map<StudioRealtimeWorkload, bigint>();
  private readonly nextClientSequence = new Map<StudioRealtimeWorkload, bigint>();
  private readonly publishingWorkloads = new Set<StudioRealtimeWorkload>();
  private readonly seenIdempotencyKeys = new Set<string>();
  private readonly lifecycleAbort = new AbortController();

  private active: ActiveProvider | null = null;
  private connectPromise: Promise<StudioRealtimeProviderHello> | null = null;
  private reconnectTimer: unknown | null = null;
  private status: StudioRealtimeProviderStatus = {
    state: "idle",
    providerId: null,
    attempt: 0,
  };
  private generation = 0;
  private reconnectAttempt = 0;
  private disposed = false;

  constructor(options: StudioRealtimeProviderSessionOptions) {
    const request = StudioRealtimeConnectionRequestSchema.safeParse({
      version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
      clientInstanceId: options.clientInstanceId,
      sessionId: options.sessionId,
      scope: options.scope,
      requiredWorkloads: options.requiredWorkloads,
      requiredCapabilities: options.requiredCapabilities,
      resume: [],
    });
    if (!request.success || options.providers.length === 0) {
      throw new StudioRealtimeProviderContractError(
        "실시간 세션 옵션이 올바르지 않습니다.",
      );
    }
    const identities = new Set<string>();
    for (const factory of options.providers) {
      assertDescriptor(factory.descriptor);
      if (identities.has(factory.descriptor.providerId)) {
        throw new StudioRealtimeProviderContractError(
          "실시간 공급자 식별자가 중복되었습니다.",
        );
      }
      identities.add(factory.descriptor.providerId);
    }
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.scheduleTimeout =
      options.setTimeout ??
      ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout =
      options.clearTimeout ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    const initialReconnectMs = safeFiniteNumber(
      options.reconnect?.initialDelayMs ?? DEFAULT_INITIAL_RECONNECT_MS,
      DEFAULT_INITIAL_RECONNECT_MS,
    );
    this.initialReconnectMs = Math.max(
      100,
      Math.trunc(initialReconnectMs),
    );
    const maximumReconnectMs = safeFiniteNumber(
      options.reconnect?.maximumDelayMs ?? DEFAULT_MAXIMUM_RECONNECT_MS,
      DEFAULT_MAXIMUM_RECONNECT_MS,
    );
    this.maximumReconnectMs = Math.max(
      this.initialReconnectMs,
      Math.trunc(maximumReconnectMs),
    );
    this.reconnectMultiplier = Math.max(
      1,
      Math.min(
        4,
        safeFiniteNumber(
          options.reconnect?.multiplier ?? DEFAULT_RECONNECT_MULTIPLIER,
          DEFAULT_RECONNECT_MULTIPLIER,
        ),
      ),
    );
    this.reconnectJitter = Math.max(
      0,
      Math.min(
        0.5,
        safeFiniteNumber(
          options.reconnect?.jitter ?? DEFAULT_RECONNECT_JITTER,
          DEFAULT_RECONNECT_JITTER,
        ),
      ),
    );
    for (const workload of options.requiredWorkloads) {
      this.nextClientSequence.set(workload, BigInt(1));
    }
  }

  get ready(): boolean {
    return this.active !== null && this.status.state === "ready";
  }

  get currentStatus(): StudioRealtimeProviderStatus {
    return this.status;
  }

  get providerId(): string | null {
    return this.active?.hello.providerId ?? null;
  }

  connect(signal?: AbortSignal): Promise<StudioRealtimeProviderHello> {
    if (this.disposed) return Promise.reject(abortError());
    if (this.active) return Promise.resolve(this.active.hello);
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.generation;
    const request = this.connectionRequest();
    const attempt = this.reconnectAttempt;
    this.emitStatus({
      state: attempt === 0 ? "connecting" : "reconnecting",
      providerId: null,
      attempt,
    });
    const promise = this.connectProviders(request, generation, signal)
      .catch((error: unknown) => {
        if (
          !this.disposed &&
          (error instanceof StudioRealtimeProviderFallbackRequiredError ||
            error instanceof StudioRealtimeTicketDeniedError)
        ) {
          this.generation += 1;
          this.emitStatus({
            state: "revoked",
            providerId:
              error instanceof StudioRealtimeProviderFallbackRequiredError
                ? error.providerId
                : null,
            attempt,
          });
          throw error;
        }
        if (
          !this.disposed &&
          !signal?.aborted &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          this.scheduleReconnect();
        }
        throw error;
      })
      .finally(() => {
        if (this.connectPromise === promise) this.connectPromise = null;
      });
    this.connectPromise = promise;
    return promise;
  }

  subscribe(listener: (event: StudioRealtimeInboundEvent) => void): () => void {
    if (this.disposed) return () => undefined;
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  subscribeStatus(
    listener: (status: StudioRealtimeProviderStatus) => void,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.statusListeners.add(listener);
    try {
      listener(this.status);
    } catch {
      // An eager observer failure cannot block provider connection setup.
    }
    return () => this.statusListeners.delete(listener);
  }

  async publish(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<StudioRealtimePublishAck> {
    if (this.disposed || signal?.aborted) throw abortError();
    const active = this.active;
    if (!active || this.status.state !== "ready") {
      throw new StudioRealtimeProviderUnavailableError();
    }
    const event = parseStudioRealtimeOutboundEvent(
      value,
      this.options.scope,
      this.options.sessionId,
    );
    if (!event) throw new StudioRealtimeProviderContractError();
    if (!active.hello.acceptedWorkloads.includes(event.workload)) {
      throw new StudioRealtimeProviderContractError(
        "현재 공급자가 요청한 실시간 작업을 제공하지 않습니다.",
      );
    }
    const expectedSequence =
      this.nextClientSequence.get(event.workload) ?? BigInt(1);
    if (BigInt(event.clientSequence) !== expectedSequence) {
      throw new StudioRealtimeProviderContractError(
        "실시간 발행 순서가 연속적이지 않습니다.",
      );
    }
    if (this.publishingWorkloads.has(event.workload)) {
      throw new StudioRealtimeProviderContractError(
        "같은 실시간 작업의 이전 발행 확인을 기다리고 있습니다.",
      );
    }
    this.publishingWorkloads.add(event.workload);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.lifecycleAbort.signal.addEventListener("abort", abort, { once: true });
    try {
      let raw: unknown;
      try {
        raw = await active.adapter.publish(event, controller.signal);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw abortError();
        throw new StudioRealtimeProviderUnavailableError();
      }
      const parsed = StudioRealtimePublishAckSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.providerId !== active.hello.providerId ||
        parsed.data.providerSessionId !== active.hello.providerSessionId ||
        !sameScope(parsed.data.scope, this.options.scope) ||
        parsed.data.workload !== event.workload ||
        parsed.data.eventId !== event.eventId ||
        parsed.data.idempotencyKey !== event.idempotencyKey ||
        parsed.data.clientSequence !== event.clientSequence
      ) {
        throw new StudioRealtimeProviderContractError(
          "실시간 공급자 발행 확인이 요청과 일치하지 않습니다.",
        );
      }
      this.nextClientSequence.set(event.workload, expectedSequence + BigInt(1));
      return parsed.data;
    } finally {
      this.publishingWorkloads.delete(event.workload);
      signal?.removeEventListener("abort", abort);
      this.lifecycleAbort.signal.removeEventListener("abort", abort);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.lifecycleAbort.abort();
    if (this.reconnectTimer !== null) {
      this.cancelTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const active = this.active;
    this.active = null;
    this.eventListeners.clear();
    this.seenIdempotencyKeys.clear();
    this.publishingWorkloads.clear();
    this.resume.clear();
    this.lastServerSequence.clear();
    if (active) {
      try {
        await active.adapter.close();
      } catch {
        // Disposal is best effort; provider errors never expose token-bearing SDK details.
      }
    }
    this.emitStatus({ state: "disposed", providerId: null, attempt: this.reconnectAttempt });
    this.statusListeners.clear();
  }

  private connectionRequest(): StudioRealtimeConnectionRequest {
    return StudioRealtimeConnectionRequestSchema.parse({
      version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
      clientInstanceId: this.options.clientInstanceId,
      sessionId: this.options.sessionId,
      scope: this.options.scope,
      requiredWorkloads: [...this.options.requiredWorkloads],
      requiredCapabilities: [...this.options.requiredCapabilities],
      resume: this.options.requiredWorkloads.flatMap((workload) => {
        const cursor = this.resume.get(workload);
        return cursor ? [{ workload, ...cursor }] : [];
      }),
    });
  }

  private async connectProviders(
    request: StudioRealtimeConnectionRequest,
    generation: number,
    callerSignal?: AbortSignal,
  ): Promise<StudioRealtimeProviderHello> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    callerSignal?.addEventListener("abort", abort, { once: true });
    this.lifecycleAbort.signal.addEventListener("abort", abort, { once: true });
    let fallbackRequired:
      | StudioRealtimeProviderFallbackRequiredError
      | null = null;
    try {
      if (callerSignal?.aborted || this.lifecycleAbort.signal.aborted) {
        throw abortError();
      }
      for (const factory of this.options.providers) {
        if (controller.signal.aborted) throw abortError();
        const providerId = factory.descriptor.providerId;
        this.emitStatus({
          state: this.reconnectAttempt === 0 ? "connecting" : "reconnecting",
          providerId,
          attempt: this.reconnectAttempt,
        });
        let adapter: StudioRealtimeProviderAdapter | null = null;
        try {
          adapter = await factory.create();
          assertDescriptor(adapter.descriptor);
          if (
            adapter.descriptor.providerId !== providerId ||
            adapter.descriptor.kind !== factory.descriptor.kind
          ) {
            throw new StudioRealtimeProviderContractError();
          }
          const ticketRequest: StudioRealtimeTicketRequest = {
            version: STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION,
            providerId,
            sessionId: request.sessionId,
            scope: request.scope,
            workloads: request.requiredWorkloads,
            capabilities: request.requiredCapabilities,
          };
          const rawTicket = await this.options.ticketIssuer.issue(
            ticketRequest,
            controller.signal,
          );
          const ticket = StudioRealtimeTicketSchema.safeParse(rawTicket);
          const currentTime = this.now();
          if (
            !ticket.success ||
            ticket.data.providerId !== providerId ||
            !sameScope(ticket.data.scope, request.scope) ||
            !containsExactly(ticket.data.workloads, request.requiredWorkloads) ||
            !containsExactly(ticket.data.capabilities, request.requiredCapabilities) ||
            !Number.isFinite(currentTime) ||
            Date.parse(ticket.data.expiresAt) <= currentTime + 1_000
          ) {
            throw new StudioRealtimeProviderContractError(
              "실시간 입장권의 권한 또는 유효 시간이 올바르지 않습니다.",
            );
          }
          const handlers: StudioRealtimeProviderAdapterHandlers = {
            onEvent: (value) =>
              this.receiveProviderEvent(value, adapter!, generation),
            onDisconnect: (reason) =>
              this.providerDisconnected(reason, adapter!, generation),
          };
          // The opaque token is consumed in this stack frame and never assigned to session state.
          const rawHello = await adapter.connect(
            request,
            ticket.data.ticket,
            handlers,
            controller.signal,
          );
          const negotiation = negotiateStudioRealtimeProvider(
            request,
            rawHello,
            providerId,
          );
          if (!negotiation.ok) {
            await adapter.close();
            adapter = null;
            continue;
          }
          if (
            this.disposed ||
            generation !== this.generation ||
            controller.signal.aborted
          ) {
            await adapter.close();
            throw abortError();
          }
          this.active = {
            adapter,
            hello: negotiation.hello,
            generation,
          };
          for (const resumeResult of negotiation.hello.resume) {
            this.lastServerSequence.set(
              resumeResult.workload,
              BigInt(resumeResult.serverSequence),
            );
          }
          this.reconnectAttempt = 0;
          this.emitStatus({
            state: "ready",
            providerId,
            attempt: 0,
          });
          return negotiation.hello;
        } catch (error) {
          if (adapter) {
            try {
              await adapter.close();
            } catch {
              // Candidate cleanup must not leak provider SDK details into product errors.
            }
          }
          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            throw abortError();
          }
          if (error instanceof StudioRealtimeProviderFallbackRequiredError) {
            fallbackRequired = error;
          }
          if (error instanceof StudioRealtimeTicketDeniedError) {
            throw error;
          }
        }
      }
      if (fallbackRequired) throw fallbackRequired;
      throw new StudioRealtimeProviderUnavailableError();
    } finally {
      callerSignal?.removeEventListener("abort", abort);
      this.lifecycleAbort.signal.removeEventListener("abort", abort);
    }
  }

  private receiveProviderEvent(
    value: unknown,
    adapter: StudioRealtimeProviderAdapter,
    generation: number,
  ): void {
    const active = this.active;
    if (
      this.disposed ||
      !active ||
      active.adapter !== adapter ||
      active.generation !== generation
    ) {
      return;
    }
    const event = parseStudioRealtimeInboundEvent(value, this.options.scope);
    if (
      !event ||
      !this.options.requiredWorkloads.includes(event.workload) ||
      !active.hello.acceptedWorkloads.includes(event.workload) ||
      (event.targetSessionId !== null &&
        event.targetSessionId !== this.options.sessionId)
    ) {
      this.providerDisconnected(
        { code: "protocol-error", recoverable: true },
        adapter,
        generation,
      );
      return;
    }
    const previousSequence =
      this.lastServerSequence.get(event.workload) ?? BigInt(0);
    const nextSequence = BigInt(event.serverSequence);
    if (nextSequence <= previousSequence) return;
    if (
      this.seenIdempotencyKeys.has(event.idempotencyKey) ||
      nextSequence !== previousSequence + BigInt(1)
    ) {
      this.providerDisconnected(
        { code: "protocol-error", recoverable: true },
        adapter,
        generation,
      );
      return;
    }
    this.lastServerSequence.set(event.workload, nextSequence);
    this.resume.set(event.workload, {
      serverSequence: event.serverSequence,
      eventId: event.eventId,
    });
    this.rememberIdempotencyKey(event.idempotencyKey);
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // One UI consumer cannot corrupt resume state or prevent delivery to other subscribers.
      }
    }
  }

  private providerDisconnected(
    reason: StudioRealtimeAdapterDisconnect,
    adapter: StudioRealtimeProviderAdapter,
    generation: number,
  ): void {
    const active = this.active;
    if (
      this.disposed ||
      !active ||
      active.adapter !== adapter ||
      active.generation !== generation
    ) {
      return;
    }
    this.active = null;
    this.closeDetachedAdapter(adapter);
    if (!reason.recoverable || reason.code === "access-revoked") {
      this.generation += 1;
      this.emitStatus({
        state: "revoked",
        providerId: adapter.descriptor.providerId,
        attempt: this.reconnectAttempt,
      });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    const exponential = Math.min(
      this.maximumReconnectMs,
      this.initialReconnectMs *
        this.reconnectMultiplier ** Math.max(0, this.reconnectAttempt - 1),
    );
    const randomSample = Math.max(
      0,
      Math.min(1, safeFiniteNumber(this.random(), 0.5)),
    );
    const randomOffset = (randomSample * 2 - 1) * this.reconnectJitter;
    const delay = Math.max(100, Math.round(exponential * (1 + randomOffset)));
    this.emitStatus({
      state: "waiting",
      providerId: null,
      attempt: this.reconnectAttempt,
      retryInMs: delay,
    });
    this.reconnectTimer = this.scheduleTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private rememberIdempotencyKey(key: string): void {
    this.seenIdempotencyKeys.add(key);
    if (this.seenIdempotencyKeys.size <= MAX_SEEN_IDEMPOTENCY_KEYS) return;
    const oldest = this.seenIdempotencyKeys.values().next().value;
    if (typeof oldest === "string") this.seenIdempotencyKeys.delete(oldest);
  }

  private closeDetachedAdapter(adapter: StudioRealtimeProviderAdapter): void {
    try {
      const result = adapter.close();
      if (result && typeof (result as Promise<void>).then === "function") {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Best-effort teardown only.
    }
  }

  private emitStatus(status: StudioRealtimeProviderStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Status observers are outside the provider lifecycle authority boundary.
      }
    }
  }
}

export const STUDIO_REALTIME_PROVIDER_SECURITY_BOUNDARY = Object.freeze({
  ticketStoredBySession: false,
  ticketIncludedInEvents: false,
  ticketIncludedInStatus: false,
  ticketIncludedInErrors: false,
  maximumTicketLifetimeMs:
    STUDIO_REALTIME_PROVIDER_LIMITS.maxTicketLifetimeMs,
  silentCapabilityDowngradeAllowed: false,
} as const);
