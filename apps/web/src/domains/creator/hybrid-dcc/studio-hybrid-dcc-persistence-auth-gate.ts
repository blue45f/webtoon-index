/**
 * Keeps the Hybrid DCC usable while Studio authentication is still unavailable.
 *
 * Durable OPFS recovery is scoped to an authenticated owner. An unresolved auth
 * provider must therefore fall back to a truthful in-memory session instead of
 * leaving the editor behind an indefinite recovery screen.
 */
export type StudioHybridDccPersistenceAuthGate =
  | {
      readonly status: "checking";
      readonly shouldAttemptRecovery: true;
    }
  | {
      readonly status: "session-only";
      readonly shouldAttemptRecovery: false;
    };

const RECOVERY_READY_GATE = Object.freeze({
  status: "checking",
  shouldAttemptRecovery: true,
} as const);

const SESSION_ONLY_GATE = Object.freeze({
  status: "session-only",
  shouldAttemptRecovery: false,
} as const);

export function resolveStudioHybridDccPersistenceAuthGate(
  authReady: boolean,
): StudioHybridDccPersistenceAuthGate {
  return authReady ? RECOVERY_READY_GATE : SESSION_ONLY_GATE;
}
