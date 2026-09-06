/** FIFO admission for raster work: cancelled, not-yet-started snapshots are released immediately. */
export interface StudioAbortableSerialQueue<Request, Result> {
  run(
    request: Request,
    execute: (request: Request) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result>;
  /** Cancels waiting work only. The current executor owns its in-flight cancellation. */
  cancelPending(): void;
}

interface QueuedTask<Request, Result> {
  payload: { request: Request; execute: (request: Request) => Promise<Result> } | null;
  signal?: AbortSignal;
  onAbort(): void;
  resolve(result: Result): void;
  reject(error: unknown): void;
  settled: boolean;
}

function abortError(): Error {
  const message = "대기 중인 래스터 작업을 취소했습니다.";
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * Promise-tail queues retain every captured image until the oldest request finishes, even when
 * later strokes have already been cancelled. An explicit queue can unlink those snapshots and
 * reject their callers immediately without terminating somebody else's active Worker.
 */
export function createStudioAbortableSerialQueue<Request, Result>(): StudioAbortableSerialQueue<Request, Result> {
  const queue: QueuedTask<Request, Result>[] = [];
  let current: QueuedTask<Request, Result> | null = null;
  let scheduled = false;

  const settle = (task: QueuedTask<Request, Result>, callback: () => void): void => {
    if (task.settled) return;
    task.settled = true;
    task.payload = null;
    task.signal?.removeEventListener("abort", task.onAbort);
    callback();
  };

  const schedule = (): void => {
    if (scheduled || current || queue.length === 0) return;
    scheduled = true;
    queueMicrotask(pump);
  };

  function pump(): void {
    scheduled = false;
    if (current) return;
    const task = queue.shift();
    if (!task) return;
    const payload = task.payload;
    if (!payload || task.settled || task.signal?.aborted) {
      settle(task, () => task.reject(abortError()));
      schedule();
      return;
    }
    current = task;
    task.payload = null;
    // The executor checks the same signal and owns any active Worker. Cancellation here must not
    // advance the queue before that Worker has actually stopped or completed its operation.
    task.signal?.removeEventListener("abort", task.onAbort);
    void Promise.resolve()
      .then(() => payload.execute(payload.request))
      .then(
        (result) => settle(task, () => task.resolve(result)),
        (error: unknown) => settle(task, () => task.reject(error)),
      )
      .finally(() => {
        current = null;
        schedule();
      });
  }

  return {
    run(request, execute, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<Result>((resolve, reject) => {
        const task: QueuedTask<Request, Result> = {
          payload: { request, execute }, signal, resolve, reject, settled: false,
          onAbort() {
            const index = queue.indexOf(task);
            if (index === -1) return;
            queue.splice(index, 1);
            settle(task, () => reject(abortError()));
            schedule();
          },
        };
        queue.push(task);
        signal?.addEventListener("abort", task.onAbort, { once: true });
        // Covers an AbortSignal-compatible transport which aborts while adding the listener.
        if (signal?.aborted) task.onAbort();
        schedule();
      });
    },
    cancelPending() {
      for (const task of queue.splice(0)) settle(task, () => task.reject(abortError()));
    },
  };
}
