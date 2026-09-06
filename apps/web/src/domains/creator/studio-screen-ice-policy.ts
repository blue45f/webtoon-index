import {
  acquireStudioVoiceIcePolicyLease,
  type StudioVoiceIcePolicyLease,
  type StudioVoiceIcePolicyLeaseDependencies,
} from "./studio-voice-ice-policy";

import {
  StudioVoiceIcePolicyResponseSchema,
  type StudioVoiceIcePolicyMode,
} from "@/shared/lib/studio-voice-ice-policy-contract";
import { api, toApiError } from "@/src/infrastructure/api";

const STUDIO_SCREEN_ICE_REQUEST_TIMEOUT_MS = 10_000;

export type StudioScreenIcePolicyMode = StudioVoiceIcePolicyMode;
export type StudioScreenIcePolicyLease = StudioVoiceIcePolicyLease;
export type StudioScreenIcePolicyLeaseDependencies =
  StudioVoiceIcePolicyLeaseDependencies;

export interface StudioScreenIcePolicySessionDependencies
  extends Omit<StudioScreenIcePolicyLeaseDependencies, "signal"> {
  acquireLease?: (
    workId: string,
    dependencies: StudioScreenIcePolicyLeaseDependencies
  ) => Promise<StudioScreenIcePolicyLease>;
}

async function loadStudioScreenIcePolicy(
  workId: string,
  signal?: AbortSignal
) {
  try {
    const response = await api.get<unknown>(
      `/creator/works/${encodeURIComponent(workId)}/screen-share/ice`,
      { signal, timeout: STUDIO_SCREEN_ICE_REQUEST_TIMEOUT_MS }
    );
    const parsed = StudioVoiceIcePolicyResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("서버가 안전한 화면 공유 연결 설정을 반환하지 않았습니다.");
    }
    return parsed.data;
  } catch (error) {
    throw await toApiError(error, "화면 공유 연결 설정을 불러오지 못했습니다.");
  }
}

/**
 * Reuses the rotating, authenticated WebRTC lease implementation while keeping screen-share
 * authorization and rate limiting on a dedicated server endpoint. This prevents read-only
 * screen viewers from accidentally inheriting voice-call permission.
 */
export function acquireStudioScreenIcePolicyLease(
  workId: string,
  dependencies: StudioScreenIcePolicyLeaseDependencies = {}
): Promise<StudioScreenIcePolicyLease> {
  return acquireStudioVoiceIcePolicyLease(workId, {
    ...dependencies,
    loadPolicy: dependencies.loadPolicy ?? loadStudioScreenIcePolicy,
  });
}

/**
 * Lazily owns a screen ICE lease only while a user is actively sharing or watching.
 * Creating the session performs no I/O; concurrent activation intents share one request.
 */
export class StudioScreenIcePolicySession {
  private readonly workId: string;
  private readonly dependencies: StudioScreenIcePolicySessionDependencies;
  private readonly listeners = new Set<() => void>();
  private lease: StudioScreenIcePolicyLease | null = null;
  private activation: Promise<void> | null = null;
  private activationAbortController: AbortController | null = null;
  private unsubscribeLease: (() => void) | null = null;
  private generation = 0;
  private closed = false;

  constructor(
    workId: string,
    dependencies: StudioScreenIcePolicySessionDependencies = {}
  ) {
    this.workId = workId;
    this.dependencies = dependencies;
  }

  get mode(): StudioScreenIcePolicyMode | null {
    return this.lease?.mode ?? null;
  }

  ensureActive(): Promise<void> {
    if (this.closed) return Promise.reject(screenPolicySessionClosedError());
    if (this.lease) return Promise.resolve();
    if (this.activation) return this.activation;

    const generation = ++this.generation;
    const abortController = new AbortController();
    this.activationAbortController = abortController;
    const {
      acquireLease = acquireStudioScreenIcePolicyLease,
      ...leaseDependencies
    } = this.dependencies;
    const activation = acquireLease(this.workId, {
      ...leaseDependencies,
      signal: abortController.signal,
    })
      .then((lease) => {
        if (this.closed || generation !== this.generation) {
          lease.close();
          throw screenPolicySessionClosedError();
        }
        this.lease = lease;
        this.unsubscribeLease = lease.subscribeConfigurationChange(() => {
          for (const listener of this.listeners) listener();
        });
      })
      .finally(() => {
        if (this.activation === activation) this.activation = null;
        if (this.activationAbortController === abortController) {
          this.activationAbortController = null;
        }
      });
    this.activation = activation;
    return activation;
  }

  createPeerConnection = (): RTCPeerConnection => {
    if (this.closed) throw screenPolicySessionClosedError();
    if (!this.lease) {
      throw new Error("화면 공유 보안 연결이 아직 준비되지 않았습니다.");
    }
    return this.lease.createPeerConnection();
  };

  subscribeConfigurationChange(listener: () => void): () => void {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  release(): void {
    if (this.closed) return;
    ++this.generation;
    this.activationAbortController?.abort();
    this.activationAbortController = null;
    this.activation = null;
    this.unsubscribeLease?.();
    this.unsubscribeLease = null;
    this.lease?.close();
    this.lease = null;
  }

  close(): void {
    if (this.closed) return;
    this.release();
    this.closed = true;
    this.listeners.clear();
  }
}

function screenPolicySessionClosedError(): Error {
  const error = new Error("화면 공유 보안 연결이 종료되었습니다.");
  error.name = "AbortError";
  return error;
}
