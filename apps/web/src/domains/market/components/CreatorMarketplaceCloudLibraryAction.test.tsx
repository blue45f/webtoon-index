// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorMarketplaceCloudLibraryAction } from "./CreatorMarketplaceCloudLibraryAction";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";
import type { SessionContextValue } from "@/src/compat/auth-session-store";

import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import { SessionContext } from "@/src/compat/auth-session-store";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  list: vi.fn(),
  resolveTarget: vi.fn(),
  setArchived: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

vi.mock("@/src/infrastructure/creator-marketplace-client", () => ({
  acquireCreatorMarketplaceCloudLibraryRelease: mocks.acquire,
  listCreatorMarketplaceCloudLibrary: mocks.list,
  resolveCreatorMarketplaceCloudLibraryAcquisitionTarget: mocks.resolveTarget,
  setCreatorMarketplaceCloudLibraryArchived: mocks.setArchived,
}));

function record(): CreatorMarketplaceResourceRecord {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    schemaVersion: 1,
    packageId: "original/brush/cloud-ink",
    name: "클라우드 잉크",
    kind: "brush",
    resourceVersion: "1.2.0",
    minimumStudioVersion: "1.0.0",
    description: "계정 라이브러리 테스트",
    tags: [],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [],
    manifestHash: "b".repeat(64),
    manifestByteSize: 128,
    publisher: {
      id: "223e4567-e89b-42d3-a456-426614174000",
      name: "작가",
      avatar: null,
    },
    createdAt: "2026-08-31T01:00:00.000Z",
    updatedAt: "2026-08-31T01:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

function session(authenticated: boolean): SessionContextValue {
  if (!authenticated) {
    return {
      data: null,
      ready: true,
      status: "unauthenticated",
      update: async () => null,
    };
  }
  const data = {
    user: { id: "user-1", name: "독자", role: "user" as const },
    token: null,
  };
  return {
    data,
    ready: true,
    status: "authenticated",
    update: async () => data,
  };
}

function renderAction(
  authenticated = true,
  value: CreatorMarketplaceResourceRecord = record(),
) {
  return render(
    <SessionContext.Provider value={session(authenticated)}>
      <CreatorMarketplaceCloudLibraryAction record={value} />
    </SessionContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({
    items: [],
    limit: 2,
    hasMore: false,
    nextCursor: null,
  });
  const current = record();
  mocks.resolveTarget.mockResolvedValue({
    state: "available",
    requestReleaseId: current.id,
    publisherId: current.publisher.id,
    packageId: current.packageId,
    kind: current.kind,
    logicalPackId: creatorMarketplaceStudioPackId(current),
    currentHead: {
      id: current.id,
      resourceVersion: current.resourceVersion,
    },
  });
});

afterEach(cleanup);

describe("CreatorMarketplaceCloudLibraryAction", () => {
  it("로그아웃 상태에서는 private API를 호출하거나 계정 소유를 암시하지 않는다", () => {
    renderAction(false);

    expect(screen.getByText("로그인 후 계정 라이브러리 사용")).toBeTruthy();
    expect(screen.getByText(/기기별 설치와 별개/u)).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.resolveTarget).not.toHaveBeenCalled();
  });

  it("exact logical package를 조회하고 현재 head를 계정 라이브러리에 취득한다", async () => {
    const current = record();
    const logicalPackId = creatorMarketplaceStudioPackId(current);
    mocks.acquire.mockResolvedValue({
      operation: "acquire",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId: "323e4567-e89b-42d3-a456-426614174000",
      logicalPackId,
      updatedAt: "2026-08-31T02:00:00.000Z",
    });
    renderAction();

    const add = await screen.findByRole("button", { name: "계정 라이브러리에 추가" });
    expect(mocks.list).toHaveBeenCalledWith({
      view: "all",
      limit: 2,
      logicalPackId,
    }, expect.any(AbortSignal));
    expect(mocks.resolveTarget).toHaveBeenCalledWith(
      current.id,
      expect.any(AbortSignal),
    );
    fireEvent.click(add);

    expect(await screen.findByText("이 계정의 마켓 라이브러리에 추가했습니다."))
      .toBeTruthy();
    expect(mocks.acquire).toHaveBeenCalledWith(current.id, expect.any(AbortSignal));
    expect(screen.getByRole("button", { name: "계정 라이브러리에 보관" }))
      .toBeTruthy();
  });

  it("과거 상세에서는 검증된 absolute current head와 버전을 명시해 취득한다", async () => {
    const historical = record();
    const headId = "423e4567-e89b-42d3-a456-426614174000";
    const logicalPackId = creatorMarketplaceStudioPackId(historical);
    mocks.resolveTarget.mockResolvedValueOnce({
      state: "available",
      requestReleaseId: historical.id,
      publisherId: historical.publisher.id,
      packageId: historical.packageId,
      kind: historical.kind,
      logicalPackId,
      currentHead: { id: headId, resourceVersion: "2.0.0" },
    });
    mocks.acquire.mockResolvedValueOnce({
      operation: "acquire",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId: "323e4567-e89b-42d3-a456-426614174000",
      logicalPackId,
      updatedAt: "2026-08-31T02:00:00.000Z",
    });
    renderAction(true, historical);

    expect(await screen.findByText(/선택한 릴리스는 과거 버전/u)).toBeTruthy();
    const add = screen.getByRole("button", { name: "현재 v2.0.0 라이브러리에 추가" });
    fireEvent.click(add);

    expect(await screen.findByText(/현재 v2\.0\.0을 이 계정/u)).toBeTruthy();
    expect(mocks.acquire).toHaveBeenCalledWith(headId, expect.any(AbortSignal));
  });

  it.each([
    ["moderated", "관리자 검수"],
    ["owner-delisted", "배급자가 현재 패키지를 내려"],
    ["publisher-unavailable", "현재 활동 중인 배급자"],
  ] as const)("%s acquisition target은 cloud-add를 비활성화한다", async (reason, copy) => {
    const current = record();
    mocks.resolveTarget.mockResolvedValueOnce({
      state: "unavailable",
      requestReleaseId: current.id,
      publisherId: current.publisher.id,
      packageId: current.packageId,
      kind: current.kind,
      logicalPackId: creatorMarketplaceStudioPackId(current),
      reason,
    });
    renderAction(true, current);

    expect(await screen.findByText(new RegExp(copy, "u"))).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", {
      name: "계정 라이브러리에 추가",
    }).disabled).toBe(true);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("target logicalPackId mismatch는 취득 버튼을 열지 않고 재확인으로 닫는다", async () => {
    const current = record();
    mocks.resolveTarget.mockResolvedValueOnce({
      state: "available",
      requestReleaseId: current.id,
      publisherId: current.publisher.id,
      packageId: current.packageId,
      kind: current.kind,
      logicalPackId: `community:${"f".repeat(64)}`,
      currentHead: {
        id: current.id,
        resourceVersion: current.resourceVersion,
      },
    });
    renderAction();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "패키지 식별자가 상세 릴리스와 일치하지 않습니다",
    );
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("late acquisition target은 다른 detail generation을 덮어쓰지 않는다", async () => {
    const first = record();
    const second = {
      ...record(),
      id: "523e4567-e89b-42d3-a456-426614174000",
      packageId: "original/brush/second-cloud-ink",
      name: "두 번째 클라우드 잉크",
    };
    const firstTarget = deferred<Awaited<ReturnType<typeof mocks.resolveTarget>>>();
    mocks.resolveTarget
      .mockReturnValueOnce(firstTarget.promise)
      .mockResolvedValueOnce({
        state: "available",
        requestReleaseId: second.id,
        publisherId: second.publisher.id,
        packageId: second.packageId,
        kind: second.kind,
        logicalPackId: creatorMarketplaceStudioPackId(second),
        currentHead: { id: second.id, resourceVersion: second.resourceVersion },
      });
    mocks.acquire.mockResolvedValueOnce({
      operation: "acquire",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId: "623e4567-e89b-42d3-a456-426614174000",
      logicalPackId: creatorMarketplaceStudioPackId(second),
      updatedAt: "2026-08-31T02:00:00.000Z",
    });
    const rendered = renderAction(true, first);
    await waitFor(() => expect(mocks.resolveTarget).toHaveBeenCalledWith(
      first.id,
      expect.any(AbortSignal),
    ));

    rendered.rerender(
      <SessionContext.Provider value={session(true)}>
        <CreatorMarketplaceCloudLibraryAction record={second} />
      </SessionContext.Provider>,
    );
    const add = await screen.findByRole("button", { name: "계정 라이브러리에 추가" });
    firstTarget.resolve({
      state: "available",
      requestReleaseId: first.id,
      publisherId: first.publisher.id,
      packageId: first.packageId,
      kind: first.kind,
      logicalPackId: creatorMarketplaceStudioPackId(first),
      currentHead: { id: first.id, resourceVersion: first.resourceVersion },
    });
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(add);
    await waitFor(() => expect(mocks.acquire).toHaveBeenCalledWith(
      second.id,
      expect.any(AbortSignal),
    ));
  });

  it("resolve→acquire head race는 실패를 권위 있게 표시하고 explicit retry에서 target을 재조회한다", async () => {
    const historical = record();
    const firstHeadId = "723e4567-e89b-42d3-a456-426614174000";
    const nextHeadId = "823e4567-e89b-42d3-a456-426614174000";
    const logicalPackId = creatorMarketplaceStudioPackId(historical);
    mocks.resolveTarget
      .mockResolvedValueOnce({
        state: "available",
        requestReleaseId: historical.id,
        publisherId: historical.publisher.id,
        packageId: historical.packageId,
        kind: historical.kind,
        logicalPackId,
        currentHead: { id: firstHeadId, resourceVersion: "2.0.0" },
      })
      .mockResolvedValueOnce({
        state: "available",
        requestReleaseId: historical.id,
        publisherId: historical.publisher.id,
        packageId: historical.packageId,
        kind: historical.kind,
        logicalPackId,
        currentHead: { id: nextHeadId, resourceVersion: "3.0.0" },
      });
    mocks.acquire
      .mockRejectedValueOnce(new Error("현재 head가 변경되었습니다."))
      .mockResolvedValueOnce({
        operation: "acquire",
        changed: true,
        membership: "active",
        libraryScope: "account",
        libraryItemId: "923e4567-e89b-42d3-a456-426614174000",
        logicalPackId,
        updatedAt: "2026-08-31T03:00:00.000Z",
      });
    renderAction(true, historical);

    const firstAdd = await screen.findByRole<HTMLButtonElement>("button", {
      name: "현재 v2.0.0 라이브러리에 추가",
    });
    firstAdd.focus();
    fireEvent.click(firstAdd);
    firstAdd.blur();
    expect((await screen.findByRole("alert")).textContent)
      .toContain("현재 head가 변경되었습니다");
    expect(mocks.resolveTarget).toHaveBeenCalledTimes(1);
    const retry = screen.getByRole("button", { name: "다시 확인" });
    await waitFor(() => expect(document.activeElement).toBe(retry));

    fireEvent.click(retry);
    retry.blur();
    const retryAdd = await screen.findByRole("button", {
      name: "현재 v3.0.0 라이브러리에 추가",
    });
    expect(mocks.resolveTarget).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(document.activeElement).toBe(retryAdd));
    fireEvent.click(retryAdd);

    await waitFor(() => expect(mocks.acquire).toHaveBeenNthCalledWith(
      2,
      nextHeadId,
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText(/현재 v3\.0\.0을 이 계정/u)).toBeTruthy();
  });

  it("계정 보관과 로컬 제거를 분리하고 설치 확인 범위를 account-ever로 설명한다", async () => {
    const current = record();
    const logicalPackId = creatorMarketplaceStudioPackId(current);
    const libraryItemId = "323e4567-e89b-42d3-a456-426614174000";
    mocks.list.mockResolvedValueOnce({
      items: [{
        id: libraryItemId,
        logicalPackId,
        packageId: current.packageId,
        name: current.name,
        kind: current.kind,
        membership: "active",
        addedFrom: {
          releaseId: current.id,
          resourceVersion: "1.0.0",
          releaseOrdinal: 1,
          manifestHash: "a".repeat(64),
        },
        addedAt: "2026-08-30T01:00:00.000Z",
        archivedAt: null,
        confirmation: {
          state: "confirmed",
          scope: "account-ever",
          releaseId: current.id,
          resourceVersion: current.resourceVersion,
          releaseOrdinal: 2,
          manifestHash: current.manifestHash,
          firstConfirmedAt: "2026-08-30T02:00:00.000Z",
          lastConfirmedAt: "2026-08-31T01:00:00.000Z",
        },
        catalog: {
          state: "available",
          head: {
            id: current.id,
            name: current.name,
            kind: current.kind,
            resourceVersion: current.resourceVersion,
            minimumStudioVersion: current.minimumStudioVersion,
            releaseOrdinal: 2,
            manifestHash: current.manifestHash,
          },
        },
        updateState: "account-confirmed-current-head",
      }],
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
    mocks.setArchived
      .mockResolvedValueOnce({
        operation: "set-archive",
        changed: true,
        membership: "archived",
        libraryScope: "account",
        libraryItemId,
        logicalPackId,
        updatedAt: "2026-08-31T03:00:00.000Z",
      })
      .mockResolvedValueOnce({
        operation: "set-archive",
        changed: true,
        membership: "active",
        libraryScope: "account",
        libraryItemId,
        logicalPackId,
        updatedAt: "2026-08-31T03:01:00.000Z",
      });
    renderAction();

    expect(await screen.findByText(/계정에 Studio v1\.2\.0 설치 확인됨/u)).toBeTruthy();
    expect(screen.getByText(/현재 기기의 설치 증명이 아닙니다/u)).toBeTruthy();
    const archive = screen.getByRole<HTMLButtonElement>("button", {
      name: "계정 라이브러리에 보관",
    });
    archive.focus();
    // Browsers synthesize this click for Enter on a focused native button.
    fireEvent.click(archive);
    archive.blur();

    expect(await screen.findByText(/로컬 설치는 제거하지 않았습니다/u)).toBeTruthy();
    expect(mocks.setArchived).toHaveBeenCalledWith(
      libraryItemId,
      true,
      expect.any(AbortSignal),
    );
    const restore = screen.getByRole("button", { name: "계정 라이브러리로 복원" });
    await waitFor(() => expect(document.activeElement).toBe(restore));

    fireEvent.click(restore);
    (restore as HTMLButtonElement).blur();
    const archiveAgain = await screen.findByRole("button", {
      name: "계정 라이브러리에 보관",
    });
    await waitFor(() => expect(document.activeElement).toBe(archiveAgain));
    expect(mocks.setArchived).toHaveBeenNthCalledWith(
      2,
      libraryItemId,
      false,
      expect.any(AbortSignal),
    );
  });

  it("조회 실패를 없는 항목으로 축소하지 않고 명시적 재시도를 제공한다", async () => {
    mocks.list.mockRejectedValueOnce(new Error("library unavailable"));
    renderAction();

    expect((await screen.findByRole("alert")).textContent)
      .toContain("library unavailable");
    const retry = screen.getByRole("button", { name: "다시 확인" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("focused retry가 다시 실패해도 새 retry에 초점을 복원하고 다른 사용자 초점은 가로채지 않는다", async () => {
    mocks.list
      .mockRejectedValueOnce(new Error("first load failure"))
      .mockRejectedValueOnce(new Error("second load failure"));
    renderAction();

    const retry = await screen.findByRole<HTMLButtonElement>("button", {
      name: "다시 확인",
    });
    retry.focus();
    fireEvent.click(retry);
    retry.blur();

    const rerenderedRetry = await screen.findByRole<HTMLButtonElement>("button", {
      name: "다시 확인",
    });
    await waitFor(() => expect(document.activeElement).toBe(rerenderedRetry));
    expect(screen.getByRole("alert").textContent).toContain("second load failure");

    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.append(outside);
    rerenderedRetry.focus();
    mocks.list.mockRejectedValueOnce(new Error("third load failure"));
    fireEvent.click(rerenderedRetry);
    outside.focus();
    await screen.findByText(/third load failure/u);
    await waitFor(() => expect(document.activeElement).toBe(outside));
    outside.remove();
  });
});
