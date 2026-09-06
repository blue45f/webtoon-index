import {
  STUDIO_LIVE_AUTH_TICKET_MAX_CODE_UNITS,
  STUDIO_LIVE_AUTH_TICKET_VERSION,
  StudioLiveAuthTicketResponseSchema,
  type StudioLiveAuthTicketResponse,
} from "../../../shared/lib/studio-live-auth-ticket";

import { readOrCreateStudioLiveGuestCredential } from "./studio-live-client-identity";

import { withCsrfHeader } from "@/shared/lib/csrf";
import { apiPath } from "@/src/infrastructure/api";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = STUDIO_LIVE_AUTH_TICKET_MAX_CODE_UNITS + 2_048;

export interface StudioLiveAuthTicketClientOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function createStudioLiveGuestCredential(
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return readOrCreateStudioLiveGuestCredential(null, randomUUID);
}

/** Browser guest principal that survives refresh in this profile. */
export function persistStudioLiveGuestCredential(): string {
  return readOrCreateStudioLiveGuestCredential();
}

/** Exchanges only the ambient HttpOnly cookie for a one-minute Socket.IO admission ticket. */
export async function requestStudioLiveAuthTicket(
  options: StudioLiveAuthTicketClientOptions = {},
): Promise<StudioLiveAuthTicketResponse> {
  const endpoint = options.endpoint ?? apiPath("/creator/studio-live/auth-ticket");
  if (!endpoint || endpoint.includes("#")) {
    throw new Error("실시간 팀 연결 주소가 올바르지 않습니다.");
  }
  if (options.signal?.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = globalThis.setTimeout(
    abort,
    Math.min(30_000, Math.max(1_000, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS))),
  );
  try {
    const response = await (options.fetch ?? globalThis.fetch.bind(globalThis))(
      endpoint,
      {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ version: STUDIO_LIVE_AUTH_TICKET_VERSION }),
        cache: "no-store",
        credentials: "include",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error("로그인된 실시간 팀 연결 정보를 발급받지 못했습니다.");
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("실시간 팀 연결 응답이 허용 크기를 초과했습니다.");
    }
    const source = await response.text();
    if (new TextEncoder().encode(source).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("실시간 팀 연결 응답이 허용 크기를 초과했습니다.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(source);
    } catch {
      throw new Error("실시간 팀 연결 응답을 해석하지 못했습니다.");
    }
    const parsed = StudioLiveAuthTicketResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("실시간 팀 연결 응답이 올바르지 않습니다.");
    }
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
