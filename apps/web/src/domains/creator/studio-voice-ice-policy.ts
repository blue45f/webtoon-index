import {
  StudioVoiceIcePolicyResponseSchema,
  type StudioVoiceIcePolicyMode,
  type StudioVoiceIcePolicyResponse,
} from "@/shared/lib/studio-voice-ice-policy-contract";
import { api, toApiError } from "@/src/infrastructure/api";

const STUDIO_VOICE_ICE_REFRESH_MIN_LEAD_MS = 30_000;
const STUDIO_VOICE_ICE_REFRESH_MAX_LEAD_MS = 120_000;
const STUDIO_VOICE_ICE_REFRESH_RETRY_MIN_MS = 5_000;
const STUDIO_VOICE_ICE_REFRESH_RETRY_MAX_MS = 60_000;
const STUDIO_VOICE_ICE_REQUEST_TIMEOUT_MS = 10_000;

type StudioVoiceIceTimer = ReturnType<typeof globalThis.setTimeout>;

export interface StudioVoiceIcePolicyLeaseDependencies {
  loadPolicy?: (workId: string, signal?: AbortSignal) => Promise<unknown>;
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => StudioVoiceIceTimer;
  clearTimer?: (timer: StudioVoiceIceTimer) => void;
  onRefreshError?: (error: unknown, expired: boolean) => void;
  random?: () => number;
  signal?: AbortSignal;
}

interface ResolvedStudioVoiceIcePolicyLeaseDependencies {
  loadPolicy: (workId: string, signal?: AbortSignal) => Promise<unknown>;
  createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => StudioVoiceIceTimer;
  clearTimer: (timer: StudioVoiceIceTimer) => void;
  onRefreshError: (error: unknown, expired: boolean) => void;
  random: () => number;
}

export interface StudioVoiceIcePolicyLease {
  readonly mode: StudioVoiceIcePolicyMode;
  createPeerConnection: () => RTCPeerConnection;
  subscribeConfigurationChange: (listener: () => void) => () => void;
  close: () => void;
}

async function loadStudioVoiceIcePolicy(
  workId: string,
  signal?: AbortSignal
): Promise<StudioVoiceIcePolicyResponse> {
  try {
    const response = await api.get<unknown>(
      `/creator/works/${encodeURIComponent(workId)}/voice/ice`,
      { signal, timeout: STUDIO_VOICE_ICE_REQUEST_TIMEOUT_MS }
    );
    const parsed = StudioVoiceIcePolicyResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("서버가 안전한 음성 연결 설정을 반환하지 않았습니다.");
    }
    return parsed.data;
  } catch (error) {
    throw await toApiError(error, "음성 연결 설정을 불러오지 못했습니다.");
  }
}

function voicePolicyAbortError(): Error {
  const error = new Error("음성 연결 설정 요청이 취소되었습니다.");
  error.name = "AbortError";
  return error;
}

function defaultCreatePeerConnection(
  configuration: RTCConfiguration
): RTCPeerConnection {
  if (typeof RTCPeerConnection !== "function") {
    throw new Error("이 브라우저는 WebRTC 음성 통화를 지원하지 않습니다.");
  }
  return new RTCPeerConnection(configuration);
}

function cloneIceServers(
  policy: StudioVoiceIcePolicyResponse
): RTCIceServer[] {
  return policy.iceServers.map((server) => ({
    urls: [...server.urls],
    ...(server.username === undefined ? {} : { username: server.username }),
    ...(server.credential === undefined ? {} : { credential: server.credential }),
    ...(server.credentialType === undefined
      ? {}
      : { credentialType: server.credentialType }),
  }));
}

function rtcConfiguration(
  policy: StudioVoiceIcePolicyResponse
): RTCConfiguration {
  return {
    iceServers: cloneIceServers(policy),
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceTransportPolicy: "all",
    iceCandidatePoolSize: 0,
  };
}

class BrowserStudioVoiceIcePolicyLease implements StudioVoiceIcePolicyLease {
  private policy: StudioVoiceIcePolicyResponse;
  private readonly workId: string;
  private readonly loadPolicy: (workId: string, signal?: AbortSignal) => Promise<unknown>;
  private readonly createConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => StudioVoiceIceTimer;
  private readonly clearTimer: (timer: StudioVoiceIceTimer) => void;
  private readonly onRefreshError: (error: unknown, expired: boolean) => void;
  private readonly random: () => number;
  private readonly peerConnections = new Set<RTCPeerConnection>();
  private readonly configurationListeners = new Set<() => void>();
  private refreshTimer: StudioVoiceIceTimer | null = null;
  private refreshPromise: Promise<void> | null = null;
  private refreshAbortController: AbortController | null = null;
  private localExpiresAt: number | null;
  private refreshAttempt = 0;
  private closed = false;

  constructor(
    workId: string,
    policy: StudioVoiceIcePolicyResponse,
    dependencies: ResolvedStudioVoiceIcePolicyLeaseDependencies
  ) {
    this.workId = workId;
    this.policy = policy;
    this.loadPolicy = dependencies.loadPolicy;
    this.createConnection = dependencies.createPeerConnection;
    this.now = dependencies.now;
    this.setTimer = dependencies.setTimer;
    this.clearTimer = dependencies.clearTimer;
    this.onRefreshError = dependencies.onRefreshError;
    this.random = dependencies.random;
    this.localExpiresAt = this.localPolicyExpiry(policy);
    this.scheduleRefresh();
  }

  get mode(): StudioVoiceIcePolicyMode {
    return this.policy.mode;
  }

  createPeerConnection = (): RTCPeerConnection => {
    if (this.closed) {
      throw new Error("실시간 연결 설정이 이미 종료되었습니다.");
    }
    if (
      this.policy.mode === "turn" &&
      (this.localExpiresAt === null || this.localExpiresAt <= this.now())
    ) {
      void this.refresh();
      throw new Error("실시간 중계 연결 자격 증명이 만료되었습니다. 잠시 뒤 다시 시도해 주세요.");
    }
    const connection = this.createConnection(rtcConfiguration(this.policy));
    this.peerConnections.add(connection);
    return connection;
  };

  subscribeConfigurationChange = (listener: () => void): (() => void) => {
    if (this.closed) return () => undefined;
    this.configurationListeners.add(listener);
    return () => this.configurationListeners.delete(listener);
  };

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    if (this.refreshTimer !== null) {
      this.clearTimer(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshAbortController?.abort();
    this.refreshAbortController = null;
    this.configurationListeners.clear();
    this.peerConnections.clear();
  };

  private scheduleRefresh(): void {
    if (this.closed || this.policy.mode !== "turn") return;
    const expiresAt = this.localExpiresAt;
    if (expiresAt === null) return;
    const proportionalLead = this.policy.ttlSeconds * 1_000 * 0.2;
    const refreshLead = Math.min(
      STUDIO_VOICE_ICE_REFRESH_MAX_LEAD_MS,
      Math.max(STUDIO_VOICE_ICE_REFRESH_MIN_LEAD_MS, proportionalLead)
    );
    const delay = Math.max(1_000, expiresAt - this.now() - refreshLead);
    this.refreshTimer = this.setTimer(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  private refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshPromise) return this.refreshPromise;
    if (this.refreshTimer !== null) {
      this.clearTimer(this.refreshTimer);
      this.refreshTimer = null;
    }
    const previousExpiry = this.localExpiresAt;
    const refreshAbortController = new AbortController();
    this.refreshAbortController = refreshAbortController;
    const refresh = Promise.resolve(
      this.loadPolicy(this.workId, refreshAbortController.signal)
    )
      .then((response) => {
        if (this.closed) return;
        const parsed = StudioVoiceIcePolicyResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error("서버가 안전한 음성 연결 설정을 반환하지 않았습니다.");
        }
        this.policy = parsed.data;
        this.localExpiresAt = this.localPolicyExpiry(parsed.data);
        this.refreshAttempt = 0;
        this.applyConfigurationToExistingPeers();
        this.scheduleRefresh();
        for (const listener of this.configurationListeners) {
          try {
            listener();
          } catch (error) {
            this.onRefreshError(error, false);
          }
        }
      })
      .catch((error: unknown) => {
        if (this.closed) return;
        const expired = previousExpiry !== null && previousExpiry <= this.now();
        this.onRefreshError(error, expired);
        this.refreshAttempt += 1;
        const exponentialDelay = Math.min(
          STUDIO_VOICE_ICE_REFRESH_RETRY_MAX_MS,
          STUDIO_VOICE_ICE_REFRESH_RETRY_MIN_MS * 2 ** Math.min(4, this.refreshAttempt - 1)
        );
        const random = this.random();
        const jitter = 0.8 + (
          Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5
        ) * 0.4;
        this.refreshTimer = this.setTimer(() => {
          this.refreshTimer = null;
          void this.refresh();
        }, Math.round(exponentialDelay * jitter));
      })
      .finally(() => {
        if (this.refreshAbortController === refreshAbortController) {
          this.refreshAbortController = null;
        }
        if (this.refreshPromise === refresh) this.refreshPromise = null;
      });
    this.refreshPromise = refresh;
    return refresh;
  }

  private localPolicyExpiry(policy: StudioVoiceIcePolicyResponse): number | null {
    if (policy.mode !== "turn") return null;
    // Use the strictly validated policy duration from the authenticated response, but anchor it
    // to local receipt time. This avoids expiring fresh credentials early merely because the
    // browser clock differs from the issuer clock. The 10s HTTP timeout bounds how much transport
    // delay can extend this lease.
    return this.now() + policy.ttlSeconds * 1_000;
  }

  private applyConfigurationToExistingPeers(): void {
    const configuration = rtcConfiguration(this.policy);
    for (const connection of this.peerConnections) {
      if (connection.connectionState === "closed") {
        this.peerConnections.delete(connection);
        continue;
      }
      if (typeof connection.setConfiguration !== "function") continue;
      try {
        connection.setConfiguration(configuration);
      } catch (error) {
        this.onRefreshError(error, false);
      }
    }
  }
}

export async function acquireStudioVoiceIcePolicyLease(
  workId: string,
  dependencies: StudioVoiceIcePolicyLeaseDependencies = {}
): Promise<StudioVoiceIcePolicyLease> {
  if (dependencies.signal?.aborted) throw voicePolicyAbortError();
  const resolvedDependencies: ResolvedStudioVoiceIcePolicyLeaseDependencies = {
    loadPolicy: dependencies.loadPolicy ?? loadStudioVoiceIcePolicy,
    createPeerConnection:
      dependencies.createPeerConnection ?? defaultCreatePeerConnection,
    now: dependencies.now ?? Date.now,
    setTimer:
      dependencies.setTimer ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    clearTimer:
      dependencies.clearTimer ??
      ((timer) => globalThis.clearTimeout(timer)),
    onRefreshError: dependencies.onRefreshError ?? (() => undefined),
    random: dependencies.random ?? Math.random,
  };
  const response = await resolvedDependencies.loadPolicy(workId, dependencies.signal);
  if (dependencies.signal?.aborted) throw voicePolicyAbortError();
  const policy = StudioVoiceIcePolicyResponseSchema.safeParse(response);
  if (!policy.success) {
    throw new Error("서버가 안전한 음성 연결 설정을 반환하지 않았습니다.");
  }
  return new BrowserStudioVoiceIcePolicyLease(
    workId,
    policy.data,
    resolvedDependencies
  );
}
