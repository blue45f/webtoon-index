export type StudioCodecCertificationPipelineGuardErrorCode =
  | "aborted"
  | "invalid-timeout"
  | "timeout";

export class StudioCodecCertificationPipelineGuardError extends Error {
  readonly code: StudioCodecCertificationPipelineGuardErrorCode;

  constructor(code: StudioCodecCertificationPipelineGuardErrorCode) {
    super(`Studio codec certification pipeline ${code}.`);
    this.name = "StudioCodecCertificationPipelineGuardError";
    this.code = code;
  }
}

export interface StudioCodecCertificationPipelineGuardOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly defaultTimeoutMs: number;
  readonly minTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export interface StudioCodecCertificationPipelineGuard {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly run: <T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>;
  readonly close: () => void;
}

export function createStudioCodecCertificationPipelineGuard(
  options: StudioCodecCertificationPipelineGuardOptions,
): StudioCodecCertificationPipelineGuard {
  const timeoutMs = options.timeoutMs ?? options.defaultTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < options.minTimeoutMs
    || timeoutMs > options.maxTimeoutMs
  ) {
    throw new StudioCodecCertificationPipelineGuardError(
      "invalid-timeout",
    );
  }

  const controller = new AbortController();
  const deadlineEpochMs = Date.now() + timeoutMs;
  let termination: "aborted" | "timeout" | null = null;
  const abortExternally = () => {
    termination ??= "aborted";
    controller.abort();
  };
  options.signal?.addEventListener("abort", abortExternally, {
    once: true,
  });
  if (options.signal?.aborted) abortExternally();
  const timer = setTimeout(() => {
    termination ??= "timeout";
    controller.abort();
  }, timeoutMs);

  const run = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (Date.now() >= deadlineEpochMs) {
      termination ??= "timeout";
      controller.abort();
    }
    if (controller.signal.aborted) {
      throw new StudioCodecCertificationPipelineGuardError(
        termination ?? "aborted",
      );
    }
    let abortListener: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        reject(
          new StudioCodecCertificationPipelineGuardError(
            termination ?? "aborted",
          ),
        );
      };
      controller.signal.addEventListener("abort", abortListener, {
        once: true,
      });
      if (controller.signal.aborted) abortListener();
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        aborted,
      ]);
      if (Date.now() >= deadlineEpochMs) {
        termination ??= "timeout";
        controller.abort();
        throw new StudioCodecCertificationPipelineGuardError("timeout");
      }
      return result;
    } finally {
      if (abortListener) {
        controller.signal.removeEventListener("abort", abortListener);
      }
    }
  };

  let closed = false;
  return Object.freeze({
    signal: controller.signal,
    timeoutMs,
    run,
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortExternally);
    },
  });
}
