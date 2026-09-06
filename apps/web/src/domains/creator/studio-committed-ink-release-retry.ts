/** A retained surface-release invariant gets only a small paint-frame recovery budget. */
export const STUDIO_COMMITTED_INK_RETAINED_MAX_RAF_RETRIES = 4;

export interface StudioCommittedInkRetainedRetryState {
  readonly invariantKey: string;
  readonly revision: number;
  readonly attempts: number;
}

export type StudioCommittedInkRetainedRetryPlan = Readonly<{
  status: "schedule" | "exhausted";
  state: StudioCommittedInkRetainedRetryState;
  restarted: boolean;
}>;

/**
 * Budgets only an unchanged retained invariant. A new scene revision or a changed authority graph
 * starts a fresh bounded recovery epoch; repeated calls after exhaustion remain inert.
 */
export function planStudioCommittedInkRetainedRetry(
  current: StudioCommittedInkRetainedRetryState | null,
  input: Readonly<{ invariantKey: string; revision: number }>
): StudioCommittedInkRetainedRetryPlan {
  const sameInvariant = current !== null
    && current.invariantKey === input.invariantKey
    && current.revision === input.revision;
  const attempts = sameInvariant ? current.attempts : 0;
  if (attempts >= STUDIO_COMMITTED_INK_RETAINED_MAX_RAF_RETRIES) {
    return Object.freeze({ status: "exhausted", state: current!, restarted: false });
  }
  return Object.freeze({
    status: "schedule",
    state: Object.freeze({
      invariantKey: input.invariantKey,
      revision: input.revision,
      attempts: attempts + 1,
    }),
    restarted: !sameInvariant,
  });
}
