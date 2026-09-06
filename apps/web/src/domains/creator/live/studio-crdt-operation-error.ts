/**
 * Stable failure metadata for the durable CRDT control plane.
 *
 * Socket.IO ACK failures used to lose their server code when they crossed the transport boundary.
 * The ordered outbox could therefore not distinguish a temporary outage from a payload or
 * permission rejection and retried both forever. Keep the raw server code for diagnostics while
 * exposing a deliberately small retry decision to the document binding.
 */
export type StudioCrdtFailureDisposition = "retryable" | "permanent";

export type StudioCrdtOperationErrorSource =
  | "server-ack"
  | "timeout"
  | "connection"
  | "client-validation"
  | "server-response";

export interface StudioCrdtFailureClassification {
  code: string;
  message: string;
  disposition: StudioCrdtFailureDisposition;
  source: StudioCrdtOperationErrorSource | "unknown";
}

const PERMANENT_SERVER_CODES = new Set([
  "invalid_payload",
  "forbidden",
  "unauthenticated",
  "access_revoked",
  "permission_denied",
  "role_revoked",
  "storage_corruption",
]);

const RETRYABLE_SERVER_CODES = new Set([
  "rate_limited",
  "internal_error",
  "not_joined",
  "temporarily_unavailable",
  "service_unavailable",
]);

function serverDisposition(code: string): StudioCrdtFailureDisposition {
  if (PERMANENT_SERVER_CODES.has(code)) return "permanent";
  if (RETRYABLE_SERVER_CODES.has(code)) return "retryable";
  // An explicit, unfamiliar negative ACK is deterministic evidence that the server declined the
  // operation. Retrying it indefinitely risks a hot loop and silent local/server divergence.
  return "permanent";
}

export class StudioCrdtOperationError extends Error {
  readonly code: string;
  readonly disposition: StudioCrdtFailureDisposition;
  readonly source: StudioCrdtOperationErrorSource;

  constructor(options: {
    code: string;
    message: string;
    disposition: StudioCrdtFailureDisposition;
    source: StudioCrdtOperationErrorSource;
  }) {
    super(options.message);
    this.name = "StudioCrdtOperationError";
    this.code = options.code;
    this.disposition = options.disposition;
    this.source = options.source;
  }
}

export function createStudioCrdtServerAckError(
  code: string,
  message: string
): StudioCrdtOperationError {
  return new StudioCrdtOperationError({
    code,
    message,
    disposition: serverDisposition(code),
    source: "server-ack",
  });
}

export function createStudioCrdtRetryableError(
  code: string,
  message: string,
  source: Exclude<StudioCrdtOperationErrorSource, "server-ack">
): StudioCrdtOperationError {
  return new StudioCrdtOperationError({
    code,
    message,
    disposition: "retryable",
    source,
  });
}

export function createStudioCrdtPermanentError(
  code: string,
  message: string,
  source: Exclude<StudioCrdtOperationErrorSource, "server-ack">
): StudioCrdtOperationError {
  return new StudioCrdtOperationError({
    code,
    message,
    disposition: "permanent",
    source,
  });
}

export function classifyStudioCrdtFailure(error: unknown): StudioCrdtFailureClassification {
  if (error instanceof StudioCrdtOperationError) {
    return {
      code: error.code,
      message: error.message,
      disposition: error.disposition,
      source: error.source,
    };
  }
  return {
    code: "transport_error",
    message:
      error instanceof Error && error.message.trim()
        ? error.message
        : "실시간 CRDT 작업을 완료하지 못했습니다.",
    // Unknown JavaScript/network failures remain retryable. Only an explicit negative ACK or a
    // locally proven contract violation is allowed to put the editor into terminal recovery.
    disposition: "retryable",
    source: "unknown",
  };
}
