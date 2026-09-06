import { describe, expect, it } from "vitest";

import {
  createStudioLiveInstantWorkId,
  isStudioLiveJamWorkId,
  openStudioLiveCompanionTab,
  readStudioLiveRoomQuery,
  resolveStudioLiveSessionWorkId,
  shouldExpectStudioSharedDocument,
  shouldPublishStudioLiveJamRoom,
  shouldRequireStudioLiveServer,
  shouldSeedStudioLiveSharedBootstrapPage,
  studioLiveSharedBootstrapPageId,
  withStudioLiveJamRoom,
} from "./studio-live-jam-session";

describe("studio live jam session", () => {
  it("reads and writes the Magma room query without treating it as a saved work", () => {
    expect(readStudioLiveRoomQuery("?remix=src")).toBeNull();
    expect(readStudioLiveRoomQuery("?room=jam-7")).toBe("jam-7");
    expect(withStudioLiveJamRoom("?remix=src", "jam-7").get("room")).toBe("jam-7");
    expect(shouldPublishStudioLiveJamRoom({
      workId: null,
      remixId: null,
      roomId: null,
    })).toBe(true);
    expect(shouldPublishStudioLiveJamRoom({
      workId: null,
      remixId: null,
      roomId: "jam-7",
    })).toBe(false);
    expect(shouldExpectStudioSharedDocument({
      workAuthScopeKey: "user-1",
      workId: "work-1",
      remixId: null,
    })).toBe(true);
    expect(shouldExpectStudioSharedDocument({
      workAuthScopeKey: "user-1",
      workId: null,
      remixId: null,
    })).toBe(false);
    expect(shouldRequireStudioLiveServer({
      expectsSharedDocument: false,
      draftCollaborationReady: false,
    })).toBe(false);
    expect(shouldRequireStudioLiveServer({
      expectsSharedDocument: false,
      draftCollaborationReady: false,
      liveJam: true,
    })).toBe(true);
    expect(shouldRequireStudioLiveServer({
      expectsSharedDocument: true,
      draftCollaborationReady: false,
    })).toBe(true);
  });

  it("resolves the same session id for a first tab and a second tab that only has the room query", () => {
    const instant = createStudioLiveInstantWorkId(() => 1, () => 0.5);
    expect(instant.startsWith("work-instant-")).toBe(true);
    expect(isStudioLiveJamWorkId(instant)).toBe(true);
    expect(isStudioLiveJamWorkId(createStudioLiveInstantWorkId(() => 1, () => 0))).toBe(
      true,
    );
    const first = resolveStudioLiveSessionWorkId({
      workId: null,
      roomId: null,
      instantWorkId: instant,
    });
    const second = resolveStudioLiveSessionWorkId({
      workId: null,
      roomId: first,
      instantWorkId: "work-instant-other-tab",
    });
    expect(first).toBe(instant);
    expect(second).toBe(first);
    expect(studioLiveSharedBootstrapPageId(first)).toBe(studioLiveSharedBootstrapPageId(second));
    expect(studioLiveSharedBootstrapPageId(first)).toBe(`jam-page-${first}`);
    expect(shouldSeedStudioLiveSharedBootstrapPage(null)).toBe(true);
    expect(shouldSeedStudioLiveSharedBootstrapPage("work-saved-1")).toBe(false);
  });

  it("opens a companion tab at the shipped jam href", () => {
    const opened: string[] = [];
    expect(openStudioLiveCompanionTab("jam-22", (url) => {
      opened.push(url);
      return {} as Window;
    })).toBe(true);
    expect(opened).toEqual(["/studio?room=jam-22"]);
  });
});
