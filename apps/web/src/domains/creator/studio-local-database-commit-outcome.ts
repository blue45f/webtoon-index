import { isStudioLocalDatabaseWorkerMethod } from "./studio-local-database-worker-protocol";

import type { StudioLocalDatabaseWorkerMethod } from "./studio-local-database-worker-protocol";

/**
 * A durable mutation was delivered, but the response channel died before its definitive result.
 * This leaf module intentionally has no Worker URL/client dependency so persistence authorities can
 * recognize the state without pulling the Worker client into their bundle.
 */
export class StudioLocalDatabaseCommitOutcomeUnknownError extends Error {
  readonly code = "commit-outcome-unknown";
  readonly method: StudioLocalDatabaseWorkerMethod;

  constructor(method: StudioLocalDatabaseWorkerMethod, cause: unknown) {
    super(
      `Studio local database ${method} commit outcome is unknown because its Worker response was lost`,
      { cause },
    );
    this.name = "StudioLocalDatabaseCommitOutcomeUnknownError";
    this.method = method;
  }
}

export function isStudioLocalDatabaseCommitOutcomeUnknownError(
  error: unknown,
): error is StudioLocalDatabaseCommitOutcomeUnknownError {
  if (error instanceof StudioLocalDatabaseCommitOutcomeUnknownError) return true;
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "code") === "commit-outcome-unknown" &&
    isStudioLocalDatabaseWorkerMethod(Reflect.get(error, "method"))
  );
}
