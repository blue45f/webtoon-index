import { describe, expect, it } from "vitest";

import {
  advanceStudioDraftIdentityScope,
  createStudioDraftIdentityScope,
  invalidateStudioOwnerDetailAfterSharedSave,
  isStudioSourceHydrationPending,
  isStudioCuttoonSourceFormat,
  isStudioEditorAsyncScopeCurrent,
  isStudioEditorCollaborationLocked,
  isStudioEditorMutationContinuationAllowed,
  studioEditorInstanceKey,
} from "./studio-editor-scope";

describe("isStudioEditorCollaborationLocked", () => {
  it("공유 편집은 CRDT pair와 최초 remote frontier가 모두 준비될 때까지 잠근다", () => {
    expect(
      isStudioEditorCollaborationLocked({
        documentAccessLocked: false,
        operationSyncRequired: true,
        operationSyncReady: false,
      })
    ).toBe(true);
    expect(
      isStudioEditorCollaborationLocked({
        documentAccessLocked: false,
        operationSyncRequired: true,
        operationSyncReady: true,
      })
    ).toBe(false);
  });

  it("로컬 초안은 CRDT 지연 로딩 때문에 잠그지 않으며 기존 문서 잠금은 항상 우선한다", () => {
    expect(
      isStudioEditorCollaborationLocked({
        documentAccessLocked: false,
        operationSyncRequired: false,
        operationSyncReady: false,
      })
    ).toBe(false);
    expect(
      isStudioEditorCollaborationLocked({
        documentAccessLocked: true,
        operationSyncRequired: false,
        operationSyncReady: true,
      })
    ).toBe(true);
  });
});

describe("studioEditorInstanceKey", () => {
  it("저장 작품은 계정이 바뀌면 이전 문서 state를 재사용하지 않는다", () => {
    const accountA = studioEditorInstanceKey({
      authScopeKey: "account-a",
      workId: "private-work",
      remixId: null,
    });
    const accountB = studioEditorInstanceKey({
      authScopeKey: "account-b",
      workId: "private-work",
      remixId: null,
    });

    expect(accountA).not.toBe(accountB);
  });

  it("같은 계정에서도 작품이 바뀌면 새 편집기 instance를 만든다", () => {
    const first = studioEditorInstanceKey({
      authScopeKey: "account-a",
      workId: "work-a",
      remixId: null,
    });
    const second = studioEditorInstanceKey({
      authScopeKey: "account-a",
      workId: "work-b",
      remixId: null,
    });

    expect(first).not.toBe(second);
  });

  it("같은 draft session epoch에서는 guest 초안을 최초 로그인 후에도 보존한다", () => {
    expect(
      studioEditorInstanceKey({ authScopeKey: null, workId: null, remixId: null })
    ).toBe(
      studioEditorInstanceKey({ authScopeKey: "account-a", workId: null, remixId: null })
    );
    expect(
      studioEditorInstanceKey({ authScopeKey: null, workId: null, remixId: "remix-1" })
    ).toBe(
      studioEditorInstanceKey({ authScopeKey: "account-a", workId: null, remixId: "remix-1" })
    );
  });

  it("구분자가 포함된 opaque id도 JSON tuple로 충돌 없이 구분한다", () => {
    expect(
      studioEditorInstanceKey({ authScopeKey: "a:work", workId: "b", remixId: null })
    ).not.toBe(
      studioEditorInstanceKey({ authScopeKey: "a", workId: "work:b", remixId: null })
    );
  });

  it("같은 계정·작품 문자열이 남아도 unmount 또는 abort된 비동기 저장은 오래된 요청이다", () => {
    const request = { authScopeKey: "account-a", workId: "work-a" };
    expect(
      isStudioEditorAsyncScopeCurrent(request, {
        ...request,
        mounted: true,
        aborted: false,
      })
    ).toBe(true);
    expect(
      isStudioEditorAsyncScopeCurrent(request, {
        ...request,
        mounted: false,
        aborted: false,
      })
    ).toBe(false);
    expect(
      isStudioEditorAsyncScopeCurrent(request, {
        ...request,
        mounted: true,
        aborted: true,
      })
    ).toBe(false);
  });
});

describe("Studio draft identity scope", () => {
  it("guest 초안은 최초 로그인 계정이 같은 epoch에서 claim한다", () => {
    const guest = createStudioDraftIdentityScope("new", null);
    const claimed = advanceStudioDraftIdentityScope(guest, "new", "account-a");

    expect(claimed.epoch).toBe(guest.epoch);
    expect(claimed.claimedAuthScopeKey).toBe("account-a");
  });

  it("인증된 계정에서 logout 또는 다른 계정으로 바뀌면 epoch를 올려 원고를 격리한다", () => {
    const accountA = createStudioDraftIdentityScope("new", "account-a");
    const loggedOut = advanceStudioDraftIdentityScope(accountA, "new", null);
    const accountBDirect = advanceStudioDraftIdentityScope(accountA, "new", "account-b");
    const accountBAfterLogout = advanceStudioDraftIdentityScope(loggedOut, "new", "account-b");

    expect(loggedOut.epoch).toBe(accountA.epoch + 1);
    expect(accountBDirect.epoch).toBe(accountA.epoch + 1);
    // logout에서 이미 빈 instance로 격리했으므로 그 guest 초안을 B가 claim할 때는 다시 remount하지 않는다.
    expect(accountBAfterLogout.epoch).toBe(loggedOut.epoch);
  });

  it("new/remix route가 바뀌면 계정이 같아도 별도 draft epoch를 만든다", () => {
    const newDraft = createStudioDraftIdentityScope("new", "account-a");
    const remixDraft = advanceStudioDraftIdentityScope(newDraft, "remix:source-1", "account-a");

    expect(remixDraft.epoch).toBe(newDraft.epoch + 1);
    expect(
      studioEditorInstanceKey({
        authScopeKey: "account-a",
        workId: null,
        remixId: "source-1",
        draftSessionEpoch: remixDraft.epoch,
      })
    ).not.toBe(
      studioEditorInstanceKey({
        authScopeKey: "account-a",
        workId: null,
        remixId: null,
        draftSessionEpoch: newDraft.epoch,
      })
    );
  });

  it("업로드 draft도 인증 계정 logout/전환 시 새 epoch로 격리한다", () => {
    const accountA = createStudioDraftIdentityScope("upload:work-a", "account-a");
    const loggedOut = advanceStudioDraftIdentityScope(accountA, "upload:work-a", null);
    const accountB = advanceStudioDraftIdentityScope(accountA, "upload:work-a", "account-b");
    const otherWork = advanceStudioDraftIdentityScope(accountA, "upload:work-b", "account-a");

    expect(loggedOut.epoch).toBe(accountA.epoch + 1);
    expect(accountB.epoch).toBe(accountA.epoch + 1);
    expect(otherWork.epoch).toBe(accountA.epoch + 1);
  });
});

describe("isStudioEditorMutationContinuationAllowed", () => {
  const ticket = {
    authScopeKey: "account-a",
    workId: "work-a",
    accessGeneration: 4,
    documentGeneration: 12,
  };

  it("같은 scope와 access generation의 편집 가능 문서만 비동기 결과를 반영한다", () => {
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        mounted: true,
        aborted: false,
        locked: false,
      })
    ).toBe(true);
  });

  it("await 중 역할이 읽기 전용으로 바뀌거나 access generation이 바뀌면 결과를 폐기한다", () => {
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        mounted: true,
        aborted: false,
        locked: true,
      })
    ).toBe(false);
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        accessGeneration: 5,
        mounted: true,
        aborted: false,
        locked: false,
      })
    ).toBe(false);
  });

  it("await 중 원고가 편집되어 document generation이 바뀌면 오래된 결과를 폐기한다", () => {
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        documentGeneration: 13,
        mounted: true,
        aborted: false,
        locked: false,
      })
    ).toBe(false);
  });

  it("계정·작품 scope가 바뀌거나 unmount/abort되면 결과를 폐기한다", () => {
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        authScopeKey: "account-b",
        mounted: true,
        aborted: false,
        locked: false,
      })
    ).toBe(false);
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        mounted: false,
        aborted: false,
        locked: false,
      })
    ).toBe(false);
    expect(
      isStudioEditorMutationContinuationAllowed(ticket, {
        ...ticket,
        mounted: true,
        aborted: true,
        locked: false,
      })
    ).toBe(false);
  });
});

describe("invalidateStudioOwnerDetailAfterSharedSave", () => {
  it("revision 숫자가 같아 보여도 이전 doc snapshot을 재사용하지 않는다", () => {
    const staleDetail = {
      revision: 8,
      doc: { pagesList: ["old-page"], fx: { duration: 120 } },
    };

    expect(invalidateStudioOwnerDetailAfterSharedSave(staleDetail)).toBeNull();
  });
});

describe("isStudioSourceHydrationPending", () => {
  it("저장 작품과 리믹스 원본은 인증 여부와 무관하게 hydration 완료 전 잠근다", () => {
    expect(isStudioSourceHydrationPending("public-work", null, false)).toBe(true);
    expect(isStudioSourceHydrationPending(null, "public-remix-source", false)).toBe(true);
  });

  it("새 원고와 hydration 완료 원고는 source lock을 만들지 않는다", () => {
    expect(isStudioSourceHydrationPending(null, null, false)).toBe(false);
    expect(isStudioSourceHydrationPending("public-work", null, true)).toBe(false);
    expect(isStudioSourceHydrationPending(null, "public-remix-source", true)).toBe(false);
  });
});

describe("isStudioCuttoonSourceFormat", () => {
  it("cuttoon만 컷툰 편집기 hydration 대상으로 허용한다", () => {
    expect(isStudioCuttoonSourceFormat("cuttoon")).toBe(true);
    expect(isStudioCuttoonSourceFormat("upload")).toBe(false);
    expect(isStudioCuttoonSourceFormat(undefined)).toBe(false);
  });
});
