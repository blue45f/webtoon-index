import { describe, expect, it } from "vitest";

import {
  planStudioCommittedInkRetainedRetry,
  STUDIO_COMMITTED_INK_RETAINED_MAX_RAF_RETRIES,
  type StudioCommittedInkRetainedRetryState,
} from "./studio-committed-ink-release-retry";

function advance(
  state: StudioCommittedInkRetainedRetryState | null,
  invariantKey = "ready-head:surface-a",
  revision = 7
) {
  return planStudioCommittedInkRetainedRetry(state, { invariantKey, revision });
}

describe("committed ink retained release retry", () => {
  it("schedules a bounded number of frames for one unchanged ready-head invariant", () => {
    let state: StudioCommittedInkRetainedRetryState | null = null;
    for (let attempt = 1; attempt <= STUDIO_COMMITTED_INK_RETAINED_MAX_RAF_RETRIES; attempt += 1) {
      const plan = advance(state);
      expect(plan.status).toBe("schedule");
      expect(plan.state.attempts).toBe(attempt);
      expect(plan.restarted).toBe(attempt === 1);
      state = plan.state;
    }

    const exhausted = advance(state);
    expect(exhausted).toEqual({ status: "exhausted", state, restarted: false });
    expect(advance(exhausted.state)).toEqual(exhausted);
  });

  it("restarts the budget when either the invariant graph or scene revision changes", () => {
    const first = advance(null);
    const second = advance(first.state);
    const changedGraph = advance(second.state, "ready-head:surface-b", 7);
    const changedRevision = advance(changedGraph.state, "ready-head:surface-b", 8);

    expect(second.state.attempts).toBe(2);
    expect(changedGraph).toMatchObject({ status: "schedule", restarted: true });
    expect(changedGraph.state.attempts).toBe(1);
    expect(changedRevision).toMatchObject({ status: "schedule", restarted: true });
    expect(changedRevision.state).toMatchObject({ revision: 8, attempts: 1 });
  });
});
