import {
  StudioRealtimeTicketRequestSchema,
  type StudioRealtimeTicketRequest,
} from "./studio-realtime-provider-protocol";
import {
  StudioRealtimeTicketDeniedError,
  type StudioRealtimeTicketIssuer,
} from "./studio-realtime-provider-runtime";

import { withCsrfHeader } from "@/shared/lib/csrf";
import { apiPath } from "@/src/infrastructure/api";

const DEFAULT_TICKET_TIMEOUT_MS = 8_000;
const MAX_TICKET_RESPONSE_BYTES = 16 * 1024;

export interface StudioRealtimeHttpTicketIssuerOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function responseByteLength(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  if (!response.body) {
    const source = await response.text();
    if (responseByteLength(source) > MAX_TICKET_RESPONSE_BYTES) {
      throw new Error("실시간 입장권 응답이 허용 크기를 초과했습니다.");
    }
    return source;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_TICKET_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("실시간 입장권 응답이 허용 크기를 초과했습니다.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("실시간 입장권 응답을 해석하지 못했습니다.");
  }
}

/**
 * Short-lived provider-ticket client. Authentication is exclusively the HttpOnly session cookie;
 * neither the cookie nor the returned provider ticket enters storage, URLs, errors, or status.
 */
export class StudioRealtimeHttpTicketIssuer
implements StudioRealtimeTicketIssuer {
  private readonly endpoint: string;
  private readonly fetchRequest: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly scheduleTimeout: (handler: () => void, delay: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;

  constructor(options: StudioRealtimeHttpTicketIssuerOptions) {
    const endpoint = options.endpoint ?? apiPath("/studio-realtime/tickets");
    if (!endpoint || endpoint.includes("#")) {
      throw new Error("실시간 입장권 발급 주소가 올바르지 않습니다.");
    }
    this.endpoint = endpoint;
    this.fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = Math.min(
      30_000,
      Math.max(1_000, Math.trunc(options.timeoutMs ?? DEFAULT_TICKET_TIMEOUT_MS)),
    );
    this.scheduleTimeout =
      options.setTimeout ??
      ((handler, delay) => globalThis.setTimeout(handler, delay));
    this.cancelTimeout =
      options.clearTimeout ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  async issue(
    unsafeRequest: StudioRealtimeTicketRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw abortError();
    const request = StudioRealtimeTicketRequestSchema.safeParse(unsafeRequest);
    if (!request.success) {
      throw new Error("실시간 입장권 요청이 올바르지 않습니다.");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = this.scheduleTimeout(abort, this.timeoutMs);
    try {
      const response = await this.fetchRequest(this.endpoint, {
        method: "POST",
        headers: withCsrfHeader({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(request.data),
        cache: "no-store",
        credentials: "include",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new StudioRealtimeTicketDeniedError();
      }
      if (!response.ok) {
        throw new Error("실시간 작업실 입장권을 발급받지 못했습니다.");
      }
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_TICKET_RESPONSE_BYTES
      ) {
        throw new Error("실시간 입장권 응답이 허용 크기를 초과했습니다.");
      }
      const source = await readBoundedResponseBody(response);
      if (
        source.length === 0 ||
        responseByteLength(source) > MAX_TICKET_RESPONSE_BYTES
      ) {
        throw new Error("실시간 입장권 응답이 올바르지 않습니다.");
      }
      try {
        return JSON.parse(source) as unknown;
      } catch {
        throw new Error("실시간 입장권 응답을 해석하지 못했습니다.");
      }
    } catch (error) {
      if (controller.signal.aborted) throw abortError();
      throw error;
    } finally {
      this.cancelTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
}

export function createStudioRealtimeHttpTicketIssuer(
  options: StudioRealtimeHttpTicketIssuerOptions,
): StudioRealtimeTicketIssuer {
  return new StudioRealtimeHttpTicketIssuer(options);
}
