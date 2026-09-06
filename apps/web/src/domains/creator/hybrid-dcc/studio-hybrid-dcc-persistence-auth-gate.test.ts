import { describe, expect, it } from "vitest";

import { resolveStudioHybridDccPersistenceAuthGate } from "./studio-hybrid-dcc-persistence-auth-gate";

describe("Hybrid DCC persistence auth gate", () => {
  it("opens a truthful session-only editor while authentication is unresolved", () => {
    expect(resolveStudioHybridDccPersistenceAuthGate(false)).toEqual({
      status: "session-only",
      shouldAttemptRecovery: false,
    });
  });

  it("attempts durable recovery only after authentication is ready", () => {
    expect(resolveStudioHybridDccPersistenceAuthGate(true)).toEqual({
      status: "checking",
      shouldAttemptRecovery: true,
    });
  });
});
