import { describe, expect, it } from "vitest";

import {
  resolveStudioDccRouteAccess,
  type StudioDccRouteAccessInput,
} from "./studio-dcc-route-access";

const editableSavedWork: StudioDccRouteAccessInput = {
  collaborationOperationSyncPending: false,
  documentReloadRequired: false,
  expectsSharedDocument: true,
  liveRoom: false,
  liveRoomEditAuthorityReady: false,
  remixId: null,
  sharedDocumentAccess: "edit",
  sharedDocumentCanView: true,
  sharedDocumentStatus: "active",
  studioAuthReady: true,
  studioAuthUserId: "author-1",
  workHydrated: true,
  workHydrationFailed: false,
  workHydrationUnsupportedFormat: false,
  workId: "work-1",
};

describe("Studio DCC route access", () => {
  it("keeps a saved-work deep link pending until auth and hydration are authoritative", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      studioAuthReady: false,
      studioAuthUserId: null,
      workHydrated: false,
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
    })).toBe("pending");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      workHydrated: false,
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
    })).toBe("pending");
    expect(resolveStudioDccRouteAccess(editableSavedWork)).toBe("allowed");
  });

  it("denies unauthenticated, read-only, failed, and reload-required saved work", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      studioAuthUserId: null,
    })).toBe("denied");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      sharedDocumentAccess: "view",
    })).toBe("denied");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      workHydrationFailed: true,
    })).toBe("denied");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      documentReloadRequired: true,
    })).toBe("denied");
  });

  it("suspends editing during a transient collaboration frontier without denying the route", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      collaborationOperationSyncPending: true,
    })).toBe("pending");
  });

  it("uses the reconciled durable room authority when no saved-work document exists", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      expectsSharedDocument: true,
      liveRoom: true,
      liveRoomEditAuthorityReady: false,
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      workId: null,
    })).toBe("pending");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      expectsSharedDocument: true,
      liveRoom: true,
      liveRoomEditAuthorityReady: true,
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      workId: null,
    })).toBe("allowed");
  });

  it("does not let a hydrated remix bypass its live-room durable authority", () => {
    const roomRemix = {
      ...editableSavedWork,
      expectsSharedDocument: true,
      liveRoom: true,
      remixId: "source-1",
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      workId: null,
    } satisfies StudioDccRouteAccessInput;

    expect(resolveStudioDccRouteAccess({
      ...roomRemix,
      liveRoomEditAuthorityReady: false,
    })).toBe("pending");
    expect(resolveStudioDccRouteAccess({
      ...roomRemix,
      liveRoomEditAuthorityReady: true,
    })).toBe("allowed");
  });

  it("waits for a remix source before treating it as an editable draft", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      expectsSharedDocument: false,
      remixId: "source-1",
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      workHydrated: false,
      workId: null,
    })).toBe("pending");
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      expectsSharedDocument: false,
      remixId: "source-1",
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      workId: null,
    })).toBe("allowed");
  });

  it("keeps an unsaved local draft available without inventing server authority", () => {
    expect(resolveStudioDccRouteAccess({
      ...editableSavedWork,
      expectsSharedDocument: false,
      liveRoom: false,
      liveRoomEditAuthorityReady: false,
      remixId: null,
      sharedDocumentAccess: null,
      sharedDocumentCanView: false,
      sharedDocumentStatus: null,
      studioAuthReady: false,
      studioAuthUserId: null,
      workHydrated: true,
      workId: null,
    })).toBe("allowed");
  });
});
