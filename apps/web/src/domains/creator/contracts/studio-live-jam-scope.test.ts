import { describe, expect, it } from "vitest";

import {
  isStudioLiveJamScope,
  isStudioLiveJamWorkId,
  studioRealtimeJamGuestActorId,
} from "./studio-live-jam-scope";

describe("studio live jam scope", () => {
  it("accepts generated instant rooms and rejects saved works", () => {
    expect(isStudioLiveJamWorkId("work-instant-m5kabcde-i54w")).toBe(true);
    expect(isStudioLiveJamWorkId("work-instant-1-0000")).toBe(true);
    expect(isStudioLiveJamWorkId("work-1")).toBe(false);
    expect(
      isStudioLiveJamWorkId("22222222-2222-4222-8222-222222222222"),
    ).toBe(false);
    expect(isStudioLiveJamWorkId("work-instant-other-tab")).toBe(false);
    expect(
      isStudioLiveJamScope({
        workId: "work-instant-m5kabcde-i54w",
        roomId: "work-instant-m5kabcde-i54w",
      }),
    ).toBe(true);
    expect(
      isStudioLiveJamScope({
        workId: "work-instant-m5kabcde-i54w",
        roomId: "work-instant-other-room-i54w",
      }),
    ).toBe(false);
  });

  it("mints a Cloudflare-safe guest subject from the client session id", () => {
    expect(
      studioRealtimeJamGuestActorId(
        "00000000-0000-4000-8000-000000000001",
      ),
    ).toBe("guest:00000000-0000-4000-8000-000000000001");
  });
});
