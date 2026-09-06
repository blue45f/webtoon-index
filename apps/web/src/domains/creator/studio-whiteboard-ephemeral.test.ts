import { describe, expect, it } from "vitest";

import {
  createStudioWhiteboardEphemeralSession,
  studioWhiteboardEphemeralHudLabel,
  studioWhiteboardEphemeralIsExpired,
  studioWhiteboardEphemeralSharePath,
} from "./studio-whiteboard-ephemeral";

describe("studio-whiteboard-ephemeral", () => {
  it("creates a volatile shareable board session", () => {
    const session = createStudioWhiteboardEphemeralSession({
      title: "회의 스케치",
      now: 1_000_000,
      ttlMs: 60_000,
    });
    expect(session.volatile).toBe(true);
    expect(session.infinitePan).toBe(true);
    expect(session.roomCode).toHaveLength(6);
    expect(studioWhiteboardEphemeralSharePath(session)).toContain("ephemeral=1");
    expect(studioWhiteboardEphemeralIsExpired(session, 1_000_000 + 59_000)).toBe(false);
    expect(studioWhiteboardEphemeralIsExpired(session, 1_000_000 + 61_000)).toBe(true);
    expect(studioWhiteboardEphemeralHudLabel(session, 1_000_000)).toContain(session.roomCode);
  });
});
