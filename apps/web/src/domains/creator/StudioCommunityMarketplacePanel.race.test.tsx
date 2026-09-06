// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioCommunityMarketplacePanel } from "./StudioCommunityMarketplacePanel";

import type {
  CreatorMarketplaceOwnedHistoryPage,
  CreatorMarketplaceOwnedRelease,
  CreatorMarketplaceResourceListPage,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import { useI18n } from "@/shared/lib/i18n";
import { SessionContext } from "@/src/compat/auth-session-store";
import { NotFoundError } from "@/src/infrastructure/use-api-resource";

const mocks = vi.hoisted(() => ({
  acquireLibrary: vi.fn(),
  acquireFilterRepository: vi.fn(),
  confirmInstall: vi.fn(),
  createPublishManifest: vi.fn(),
  deleteResource: vi.fn(),
  getResource: vi.fn(),
  installPack: vi.fn(),
  listBrushes: vi.fn(),
  listCandidates: vi.fn(),
  listFilters: vi.fn(),
  listOwnedHistory: vi.fn(),
  listMine: vi.fn(),
  listLibrary: vi.fn(),
  listPalettes: vi.fn(),
  listPublic: vi.fn(),
  inspectInstallState: vi.fn(),
  openBrushRepository: vi.fn(),
  projectPack: vi.fn(),
  projectAssets: vi.fn(),
  publishResource: vi.fn(),
  relistResource: vi.fn(),
  reportResource: vi.fn(),
  runtimeCompatibility: vi.fn(),
  setLibraryArchived: vi.fn(),
  storage: {},
  uninstallPack: vi.fn(),
}));

vi.mock("@/src/infrastructure/creator-marketplace-client", () => ({
  acquireCreatorMarketplaceCloudLibraryRelease: mocks.acquireLibrary,
  confirmCreatorMarketplaceStudioInstall: mocks.confirmInstall,
  deleteCreatorMarketplaceResource: mocks.deleteResource,
  getCreatorMarketplaceResource: mocks.getResource,
  listCreatorMarketplaceCloudLibrary: mocks.listLibrary,
  listCreatorMarketplaceResources: mocks.listPublic,
  listCreatorMarketplaceOwnedHeads: async (...args: unknown[]) => {
    const page = await mocks.listMine(...args);
    return {
      ...page,
      items: page.items.map((item: CreatorMarketplaceResourceRecord | {
        resource: CreatorMarketplaceResourceRecord;
        releaseOrdinal: number;
        hidden: boolean;
        delistedAt: string | null;
      }, index: number) => "resource" in item
        ? item
        : {
            resource: item,
            releaseOrdinal: index + 1,
            hidden: false,
            delistedAt: null,
            packageModeration: { state: "active", revision: 0, hiddenAt: null },
          }),
    };
  },
  listCreatorMarketplaceOwnedHistory: mocks.listOwnedHistory,
  relistCreatorMarketplaceResource: mocks.relistResource,
  publishCreatorMarketplaceResource: mocks.publishResource,
  reportCreatorMarketplaceResource: mocks.reportResource,
  setCreatorMarketplaceCloudLibraryArchived: mocks.setLibraryArchived,
  creatorMarketplaceReportErrorCode: (error: unknown) => (
    error && typeof error === "object" && "code" in error
      ? (error as { code: string }).code
      : "unknown"
  ),
}));

vi.mock("./studio-community-marketplace", () => ({
  createStudioCommunityPublishManifest: mocks.createPublishManifest,
  listStudioCommunityShareCandidates: mocks.listCandidates,
  projectCreatorMarketplaceRecordToAssets: mocks.projectAssets,
  projectCreatorMarketplaceRecordToStudioPack: mocks.projectPack,
  studioCommunityShareCandidateIdentity: (candidate: { id: string; kind: string }) => ({
    scheme: "v2",
    packageId: `community/${candidate.kind}/v2-${candidate.id}`,
    entryId: `${candidate.kind}/v2-${candidate.id}`,
  }),
  studioCommunityShareCandidateLegacyIdentity: (candidate: { id: string; kind: string }) => ({
    scheme: "legacy",
    packageId: `community/${candidate.kind}/legacy-${candidate.id}`,
    entryId: `${candidate.kind}/legacy-${candidate.id}`,
  }),
}));

vi.mock("./filter/studio-filter-library-sqlite-repository", () => ({
  acquireProductFilterLibraryRepository: mocks.acquireFilterRepository,
  readAllFilterPresetsFromRepository: mocks.listFilters,
  subscribeStudioFilterLibraryChanges: () => () => undefined,
}));

vi.mock("./brush/studio-brush-library-sqlite-repository", () => ({
  openProductBrushLibraryRepository: mocks.openBrushRepository,
  readAllBrushesFromRepository: mocks.listBrushes,
}));

vi.mock("./studio-palette-sqlite-repository", () => ({
  getProductStudioPaletteSqliteRepository: () => ({
    list: mocks.listPalettes,
    subscribe: () => () => undefined,
  }),
}));

vi.mock("./studio-creator-pack-runtime", () => ({
  browserStudioCreatorPackStorage: () => mocks.storage,
  inspectStudioCreatorPackInstallState: () => "available",
}));

vi.mock("./studio-creator-pack-product-runtime", () => ({
  inspectStudioCreatorPackInstallStateProduct: mocks.inspectInstallState,
  installStudioCreatorPackProduct: mocks.installPack,
  uninstallStudioCreatorPackProduct: mocks.uninstallPack,
}));

vi.mock("./studio-marketplace-runtime-compatibility", () => ({
  getProductStudioMarketplaceRuntimeCompatibility: mocks.runtimeCompatibility,
}));

vi.mock("./studio-original-free-asset-packs", () => ({
  createStudioOriginalFreeAssetRecord: (asset: unknown) => asset,
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

function resource(
  id: string,
  name: string,
  isOwner: boolean,
): CreatorMarketplaceResourceRecord {
  return {
    id,
    schemaVersion: 1,
    packageId: `community/template/${id}`,
    name,
    kind: "template",
    containsAi: false,
    publisher: { id: "publisher-1", name: "작가", avatar: null },
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    description: "",
    license: "cc0-1.0",
    entries: [],
    tags: [],
    isOwner,
  } as unknown as CreatorMarketplaceResourceRecord;
}

function cloudBrushRecord(): CreatorMarketplaceResourceRecord {
  return {
    ...resource(
      "123e4567-e89b-42d3-a456-426614174000",
      "계정 잉크 브러시",
      false,
    ),
    packageId: "original/brush/account-ink",
    kind: "brush",
    publisher: {
      id: "223e4567-e89b-42d3-a456-426614174000",
      name: "브러시 작가",
      avatar: null,
    },
    manifestHash: "b".repeat(64),
    manifestByteSize: 128,
    compatibility: { engines: ["canvas2d"] },
    provenance: { origin: "original", authoredByPublisher: true },
    attributionText: "",
    access: "free",
    createdAt: "2026-08-31T01:00:00.000Z",
    updatedAt: "2026-08-31T01:00:00.000Z",
  };
}

function authenticatedSessionValue() {
  const data = {
    user: { id: "reader-1", name: "독자", role: "user" as const },
    token: null,
  };
  return {
    data,
    ready: true as const,
    status: "authenticated" as const,
    update: async () => data,
  };
}

function page(
  items: CreatorMarketplaceResourceRecord[],
  nextCursor: string | null = null,
): CreatorMarketplaceResourceListPage {
  return {
    items,
    limit: 12,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

function cloudLibraryItem(
  current: CreatorMarketplaceResourceRecord,
  confirmation: "none" | "confirmed" = "none",
) {
  const logicalPackId = creatorMarketplaceStudioPackId(current);
  return {
    id: "323e4567-e89b-42d3-a456-426614174000",
    logicalPackId,
    packageId: current.packageId,
    name: current.name,
    kind: current.kind,
    membership: "active" as const,
    addedFrom: {
      releaseId: current.id,
      resourceVersion: current.resourceVersion,
      releaseOrdinal: 1,
      manifestHash: current.manifestHash,
    },
    addedAt: "2026-08-31T01:00:00.000Z",
    archivedAt: null,
    confirmation: confirmation === "confirmed"
      ? {
          state: "confirmed" as const,
          scope: "account-ever" as const,
          releaseId: current.id,
          resourceVersion: current.resourceVersion,
          releaseOrdinal: 1,
          manifestHash: current.manifestHash,
          firstConfirmedAt: "2026-08-31T01:30:00.000Z",
          lastConfirmedAt: "2026-08-31T01:30:00.000Z",
        }
      : { state: "none" as const },
    catalog: {
      state: "available" as const,
      head: {
        id: current.id,
        name: current.name,
        kind: current.kind,
        resourceVersion: current.resourceVersion,
        minimumStudioVersion: current.minimumStudioVersion,
        releaseOrdinal: 1,
        manifestHash: current.manifestHash,
      },
    },
    updateState: confirmation === "confirmed"
      ? "account-confirmed-current-head" as const
      : "no-account-confirmation" as const,
  };
}

function installableProjection(current: CreatorMarketplaceResourceRecord) {
  return {
    status: "installable" as const,
    pack: {
      metadata: {
        id: creatorMarketplaceStudioPackId(current),
        kind: current.kind,
        version: current.resourceVersion,
        packageFingerprint: current.manifestHash,
        creator: { id: current.publisher.id },
      },
      entries: [],
      marketplaceSource: {
        schema: "creator-marketplace-resource-v1" as const,
        releaseId: current.id,
        publisherId: current.publisher.id,
        packageId: current.packageId,
      },
    },
  };
}

function ownedHistoryPage(
  packageId: string,
  releases: CreatorMarketplaceOwnedRelease[] = [],
): CreatorMarketplaceOwnedHistoryPage {
  return {
    packageId,
    items: releases,
    limit: 1,
    hasMore: false,
    nextCursor: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getResource.mockReset();
  useI18n.getState().setLang("ko");
  mocks.acquireFilterRepository.mockResolvedValue({ repository: {} });
  mocks.listFilters.mockResolvedValue([]);
  mocks.openBrushRepository.mockResolvedValue({ authority: "sqlite", repository: {} });
  mocks.listBrushes.mockResolvedValue([]);
  mocks.listPalettes.mockResolvedValue([]);
  mocks.listCandidates.mockReturnValue([
    { id: "brush-1", kind: "brush", name: "게시 후보", definition: {} },
  ]);
  mocks.listMine.mockResolvedValue(page([]));
  mocks.listLibrary.mockResolvedValue({
    items: [],
    limit: 12,
    hasMore: false,
    nextCursor: null,
  });
  mocks.listOwnedHistory.mockImplementation((params: { packageId: string; limit: number }) =>
    Promise.resolve({
      packageId: params.packageId,
      items: [],
      limit: params.limit,
      hasMore: false,
      nextCursor: null,
    }));
  mocks.relistResource.mockResolvedValue({
    relisted: true,
    changed: true,
    id: "123e4567-e89b-42d3-a456-426614174000",
    delistedAt: null,
  });
  mocks.createPublishManifest.mockResolvedValue({});
  mocks.inspectInstallState.mockResolvedValue("available");
  mocks.installPack.mockResolvedValue({
    status: "installed",
    installedCount: 1,
    message: "로컬 SQL 카탈로그에 설치했습니다.",
  });
  mocks.uninstallPack.mockResolvedValue({
    status: "uninstalled",
    installedCount: 1,
    message: "기기에서 제거했습니다.",
  });
  mocks.setLibraryArchived.mockResolvedValue({
    operation: "set-archive",
    changed: true,
    membership: "archived",
    libraryScope: "account",
    libraryItemId: "323e4567-e89b-42d3-a456-426614174000",
    logicalPackId: `community:${"a".repeat(64)}`,
    updatedAt: "2026-08-31T02:00:00.000Z",
  });
  mocks.runtimeCompatibility.mockResolvedValue({
    currentStudioVersion: "1.0.0",
    supportedEngines: ["canvas2d", "webgl2", "three"],
    unverifiedEngines: [],
  });
  mocks.projectPack.mockReturnValue({
    status: "unsupported",
    reason: "테스트에서는 설치 투영을 사용하지 않습니다.",
  });
  mocks.projectAssets.mockReturnValue({
    assets: [],
    unsupportedCount: 0,
    reason: "테스트에서는 에셋 투영을 사용하지 않습니다.",
  });
});

afterEach(() => {
  cleanup();
});

describe("StudioCommunityMarketplacePanel request races", () => {
  it("네 개의 market tab은 roving tabindex와 순환 Arrow/Home/End 이동을 제공한다", async () => {
    mocks.listPublic.mockResolvedValue(page([]));
    render(<StudioCommunityMarketplacePanel initialOpen />);

    const community = screen.getByRole<HTMLButtonElement>("tab", { name: "공개 마켓" });
    const library = screen.getByRole<HTMLButtonElement>("tab", { name: "계정 보관함" });
    const mine = screen.getByRole<HTMLButtonElement>("tab", { name: "내 공유" });
    const share = screen.getByRole<HTMLButtonElement>("tab", { name: "자료 게시" });
    expect(community.tabIndex).toBe(0);
    expect([library.tabIndex, mine.tabIndex, share.tabIndex]).toEqual([-1, -1, -1]);

    community.focus();
    fireEvent.keyDown(community, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(share);
    expect(share.getAttribute("aria-selected")).toBe("true");
    expect(share.tabIndex).toBe(0);
    expect(community.tabIndex).toBe(-1);

    fireEvent.keyDown(share, { key: "Home" });
    expect(document.activeElement).toBe(community);
    expect(community.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(community, { key: "ArrowRight" });
    expect(document.activeElement).toBe(library);
    expect(library.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(library, { key: "End" });
    expect(document.activeElement).toBe(share);
    expect(share.getAttribute("aria-selected")).toBe("true");
  });

  it("호환성 측정 중에는 설치를 보류하고 실패 후 명시적으로 다시 확인한다", async () => {
    const pendingCompatibility = deferred<{
      currentStudioVersion: string;
      supportedEngines: string[];
      unverifiedEngines: string[];
    }>();
    mocks.listPublic.mockResolvedValue(page([]));
    mocks.runtimeCompatibility
      .mockReturnValueOnce(pendingCompatibility.promise)
      .mockResolvedValueOnce({
        currentStudioVersion: "1.0.0",
        supportedEngines: ["canvas2d", "webgl2", "three"],
        unverifiedEngines: [],
      });

    render(<StudioCommunityMarketplacePanel initialOpen />);

    expect(screen.getByRole("status").textContent).toContain(
      "Studio 버전과 기기 렌더링 엔진을 확인하고 있어요.",
    );
    await act(async () => {
      pendingCompatibility.reject(new Error("WebGPU adapter probe failed"));
      await pendingCompatibility.promise.catch(() => undefined);
    });

    expect(screen.getByRole("alert").textContent).toContain("WebGPU adapter probe failed");
    fireEvent.click(screen.getByRole("button", { name: "호환성 다시 확인" }));
    await waitFor(() => expect(mocks.runtimeCompatibility).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "호환성 다시 확인" })).toBeNull();
    });
  });

  it("부분 엔진 측정은 확인된 엔진을 유지하면서 미확정 엔진 재측정을 제공한다", async () => {
    mocks.listPublic.mockResolvedValue(page([]));
    mocks.runtimeCompatibility.mockResolvedValueOnce({
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d", "webgl2", "three"],
      unverifiedEngines: ["webgpu"],
    });

    render(<StudioCommunityMarketplacePanel initialOpen />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "확인된 엔진용 자료는 계속 사용할 수 있고",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "호환성 다시 확인" }));
    await waitFor(() => expect(mocks.runtimeCompatibility).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "호환성 다시 확인" })).toBeNull();
    });
  });

  it("확인된 엔진이 없으면 부분 성공을 주장하지 않고 전체 측정 실패로 안내한다", async () => {
    mocks.listPublic.mockResolvedValue(page([]));
    mocks.runtimeCompatibility.mockResolvedValueOnce({
      currentStudioVersion: "1.0.0",
      supportedEngines: [],
      unverifiedEngines: ["webgpu"],
    });

    render(<StudioCommunityMarketplacePanel initialOpen />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("설치 호환성을 확인할 수 없어요");
      expect(alert.textContent).not.toContain("확인된 엔진용 자료는 계속 사용할 수 있고");
    });
    expect(screen.getByRole("button", { name: "호환성 다시 확인" })).toBeTruthy();
  });

  it("잘못된 release SemVer를 막고 입력한 새 버전을 manifest 생성에 전달한다", async () => {
    mocks.listPublic.mockResolvedValue(page([]));
    mocks.listMine.mockResolvedValue(page([]));
    mocks.publishResource.mockResolvedValue(resource("published-1", "새 릴리스", true));

    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    const versionInput = screen.getByLabelText("릴리스 버전 (SemVer)");
    const submit = screen.getByRole("button", { name: "무료 공유 마켓에 게시" });

    fireEvent.change(versionInput, { target: { value: "1.0.0-01" } });
    expect((versionInput as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(versionInput, { target: { value: "1.1.0+build.7" } });
    fireEvent.change(screen.getByLabelText("릴리스 노트 (선택)"), {
      target: { value: "  압력 곡선 개선  " },
    });
    expect((versionInput as HTMLInputElement).getAttribute("aria-invalid")).toBe("false");
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.createPublishManifest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceVersion: "1.1.0+build.7",
        releaseNotes: "  압력 곡선 개선  ",
        resolvedIdentity: expect.objectContaining({ scheme: "v2" }),
      }),
    ));
  });

  it("v2와 legacy packageId를 exact history로 조회해 legacy prerelease를 연속 게시한다", async () => {
    const exact = {
      ...resource("exact", "현재 후보", true),
      packageId: "community/brush/legacy-brush-1",
      resourceVersion: "1.2.3-01",
    };
    const exactRelease = {
      resource: exact,
      releaseOrdinal: 2,
      hidden: false,
      delistedAt: null,
      packageModeration: { state: "active", revision: 0, hiddenAt: null },
    } satisfies CreatorMarketplaceOwnedRelease;
    mocks.listOwnedHistory.mockImplementation((params: { packageId: string }) =>
      Promise.resolve(ownedHistoryPage(
        params.packageId,
        params.packageId.includes("legacy-") ? [exactRelease] : [],
      )));
    mocks.publishResource.mockResolvedValue(exact);

    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);

    expect(await screen.findByText("현재 헤드 v1.2.3-01")).toBeTruthy();
    expect((screen.getByLabelText("릴리스 버전 (SemVer)") as HTMLInputElement).value)
      .toBe("1.2.3");
    expect(mocks.listOwnedHistory.mock.calls.map((call) => call[0])).toEqual([
      { packageId: "community/brush/v2-brush-1", limit: 1 },
      { packageId: "community/brush/legacy-brush-1", limit: 1 },
    ]);
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    fireEvent.click(screen.getByRole("button", { name: "무료 공유 마켓에 게시" }));
    await waitFor(() => expect(mocks.createPublishManifest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resolvedIdentity: expect.objectContaining({
          scheme: "legacy",
          packageId: "community/brush/legacy-brush-1",
        }),
      }),
    ));
  });

  it("사용자가 버전을 건드린 뒤에는 늦은 head 응답이 값을 덮지 않는다", async () => {
    const pendingHead = deferred<CreatorMarketplaceOwnedHistoryPage>();
    mocks.listOwnedHistory
      .mockReturnValueOnce(pendingHead.promise)
      .mockResolvedValueOnce(ownedHistoryPage("community/brush/legacy-brush-1"));
    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    const versionInput = screen.getByLabelText("릴리스 버전 (SemVer)");
    fireEvent.change(versionInput, { target: { value: "7.0.0" } });

    await act(async () => {
      const late = {
        ...resource("late", "늦은 현재 후보", true),
        packageId: "community/brush/v2-brush-1",
        resourceVersion: "2.0.0",
      };
      pendingHead.resolve(ownedHistoryPage(late.packageId, [{
        resource: late,
        releaseOrdinal: 2,
        hidden: false,
        delistedAt: null,
        packageModeration: { state: "active", revision: 0, hiddenAt: null },
      }]));
      await pendingHead.promise;
    });

    await screen.findByText("현재 헤드 v2.0.0");
    expect((versionInput as HTMLInputElement).value).toBe("7.0.0");
  });

  it("hidden head는 검수 해제 전 successor 게시를 막고 delisted head는 허용한다", async () => {
    const exact = {
      ...resource("hidden", "숨김 후보", true),
      packageId: "community/brush/v2-brush-1",
      resourceVersion: "2.0.0",
    };
    mocks.listOwnedHistory
      .mockResolvedValueOnce(ownedHistoryPage(exact.packageId, [{
        resource: exact,
        releaseOrdinal: 2,
        hidden: true,
        delistedAt: null,
        packageModeration: {
          state: "hidden",
          revision: 1,
          hiddenAt: "2026-08-31T00:00:00.000Z",
        },
      }]))
      .mockResolvedValueOnce(ownedHistoryPage("community/brush/legacy-brush-1"));
    const rendered = render(
      <StudioCommunityMarketplacePanel initialOpen initialView="share" />,
    );
    expect(await screen.findByText(/관리자 검수로 숨겨진 패키지는/u)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    expect((screen.getByRole("button", { name: "무료 공유 마켓에 게시" }) as HTMLButtonElement).disabled)
      .toBe(true);

    rendered.unmount();
    vi.clearAllMocks();
    mocks.listCandidates.mockReturnValue([
      { id: "brush-1", kind: "brush", name: "게시 후보", definition: {} },
    ]);
    mocks.acquireFilterRepository.mockResolvedValue({ repository: {} });
    mocks.listFilters.mockResolvedValue([]);
    mocks.openBrushRepository.mockResolvedValue({ authority: "sqlite", repository: {} });
    mocks.listBrushes.mockResolvedValue([]);
    mocks.listPalettes.mockResolvedValue([]);
    mocks.listOwnedHistory
      .mockResolvedValueOnce(ownedHistoryPage(exact.packageId, [{
        resource: exact,
        releaseOrdinal: 2,
        hidden: false,
        delistedAt: "2026-08-31T00:00:00.000Z",
        packageModeration: { state: "active", revision: 2, hiddenAt: null },
      }]))
      .mockResolvedValueOnce(ownedHistoryPage("community/brush/legacy-brush-1"));
    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    expect(await screen.findByText(/목록에서 내린 현재 헤드여도/u)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "무료 공유 마켓에 게시" }) as HTMLButtonElement).disabled)
        .toBe(false);
    });
  });

  it("v2와 legacy package history가 모두 있으면 모호한 후속 게시를 차단한다", async () => {
    const v2Resource = {
      ...resource("v2-head", "v2 헤드", true),
      packageId: "community/brush/v2-brush-1",
    };
    const legacyResource = {
      ...resource("legacy-head", "legacy 헤드", true),
      packageId: "community/brush/legacy-brush-1",
    };
    mocks.listOwnedHistory
      .mockResolvedValueOnce(ownedHistoryPage(v2Resource.packageId, [{
        resource: v2Resource,
        releaseOrdinal: 1,
        hidden: false,
        delistedAt: null,
        packageModeration: { state: "active", revision: 0, hiddenAt: null },
      }]))
      .mockResolvedValueOnce(ownedHistoryPage(legacyResource.packageId, [{
        resource: legacyResource,
        releaseOrdinal: 4,
        hidden: false,
        delistedAt: null,
        packageModeration: { state: "active", revision: 0, hiddenAt: null },
      }]));

    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    expect((await screen.findByRole("alert")).textContent)
      .toContain("v2와 legacy package 이력이 모두 있어");
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    expect((screen.getByRole("button", { name: "무료 공유 마켓에 게시" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(mocks.createPublishManifest).not.toHaveBeenCalled();
  });

  it("409 latest-version message를 일반 오류로 바꾸지 않고 그대로 알린다", async () => {
    mocks.publishResource.mockRejectedValue(new Error("현재 최신 버전은 2.0.0입니다."));
    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    const submit = screen.getByRole("button", { name: "무료 공유 마켓에 게시" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent)
      .toContain("현재 최신 버전은 2.0.0입니다.");
  });

  it("설치 상태 조회 실패를 한 번만 알리고 같은 카드를 무한 재조회하지 않는다", async () => {
    const packRecord = resource("pack-1", "상태 오류 브러시", false);
    mocks.listPublic.mockResolvedValue(page([packRecord]));
    mocks.projectPack.mockReturnValue({
      status: "installable",
      pack: { metadata: { kind: "brush" } },
    });
    mocks.inspectInstallState.mockRejectedValue(new Error("SQLite receipt corrupt"));

    render(<StudioCommunityMarketplacePanel initialOpen />);

    expect(await screen.findByText(packRecord.name)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("SQLite receipt corrupt");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.inspectInstallState).toHaveBeenCalledTimes(1);
  });

  it("공개 마켓 카드에서 로그인 사용자가 같은 신고 대화상자를 제출한다", async () => {
    const publicRecord = resource(
      "123e4567-e89b-42d3-a456-426614174000",
      "카드 신고 대상",
      false,
    );
    mocks.listPublic.mockResolvedValue(page([publicRecord]));
    mocks.reportResource.mockResolvedValue({
      reported: true,
      reportId: "423e4567-e89b-42d3-a456-426614174000",
      status: "open",
    });
    const data = {
      user: { id: "reporter-1", name: "신고 사용자", role: "user" },
      token: null,
    };

    render(
      <SessionContext.Provider value={{
        data,
        ready: true,
        status: "authenticated",
        update: async () => data,
      }}>
        <StudioCommunityMarketplacePanel initialOpen />
      </SessionContext.Provider>,
    );

    expect(await screen.findByText(publicRecord.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "리소스 신고" }));
    fireEvent.change(await screen.findByLabelText("신고 사유"), {
      target: { value: "spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "신고 제출" }));

    await waitFor(() => expect(mocks.reportResource).toHaveBeenCalledWith(
      publicRecord.id,
      { reason: "spam", details: "" },
    ));
    expect(await screen.findByText("신고가 접수되었습니다.")).toBeTruthy();
  });

  it("mine head를 lifecycle 카드로 유지하고 delist 후 같은 카드에서 retry-safe relist한다", async () => {
    const mineRecord = resource("mine-head", "수명주기 브러시", true);
    mocks.listMine.mockResolvedValue({
      ...page([]),
      items: [{
        resource: mineRecord,
        releaseOrdinal: 3,
        hidden: false,
        delistedAt: null,
        packageModeration: { state: "active", revision: 0, hiddenAt: null },
      }],
    });
    mocks.deleteResource.mockResolvedValue(undefined);
    mocks.relistResource.mockResolvedValue({
      relisted: true,
      changed: true,
      id: mineRecord.id,
      delistedAt: null,
    });

    render(<StudioCommunityMarketplacePanel initialOpen initialView="mine" />);
    expect(await screen.findByText(mineRecord.name)).toBeTruthy();
    expect(screen.getByText("공개 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기" }));
    expect(mocks.deleteResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "목록에서 내리기 확인" }));
    await waitFor(() => expect(mocks.deleteResource).toHaveBeenCalledWith(mineRecord.id));
    expect(screen.getByText(mineRecord.name)).toBeTruthy();
    expect(screen.getByText("목록 내림")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다시 공개" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 공개 확인" }));
    await waitFor(() => expect(mocks.relistResource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("공개 중")).toBeTruthy());
    expect(screen.getByText(mineRecord.name)).toBeTruthy();
  });

  it("abort를 무시하고 늦게 끝난 공개 첫 페이지도 mine 결과를 덮지 못한다", async () => {
    const stalePublicRecord = resource("public-1", "늦은 공개 첫 페이지", false);
    const mineRecord = resource("mine-1", "현재 내 공유", true);
    const stalePublic = deferred<CreatorMarketplaceResourceListPage>();
    mocks.listPublic.mockReturnValue(stalePublic.promise);
    mocks.listMine.mockResolvedValue(page([mineRecord]));

    render(<StudioCommunityMarketplacePanel initialOpen />);
    await waitFor(() => expect(mocks.listPublic).toHaveBeenCalledOnce());
    const publicSignal = mocks.listPublic.mock.calls[0]?.[1] as AbortSignal;

    fireEvent.click(screen.getByRole("tab", { name: "내 공유" }));
    expect(await screen.findByText(mineRecord.name)).toBeTruthy();
    expect(publicSignal.aborted).toBe(true);

    await act(async () => {
      stalePublic.resolve(page([stalePublicRecord]));
      await stalePublic.promise;
    });

    expect(screen.getByText(mineRecord.name)).toBeTruthy();
    expect(screen.queryByText(stalePublicRecord.name)).toBeNull();
  });

  it("게시 성공 안내와 확인된 카드를 mine 새로고침 실패에도 유지한다", async () => {
    const publicRecord = resource("public-1", "이전 공개 자료", false);
    const publishedRecord = resource("published-1", "방금 게시한 자료", true);
    const mineResponse = deferred<CreatorMarketplaceResourceListPage>();
    mocks.listPublic.mockResolvedValue(page([publicRecord]));
    mocks.listMine.mockReturnValue(mineResponse.promise);
    mocks.publishResource.mockResolvedValue(publishedRecord);

    render(<StudioCommunityMarketplacePanel initialOpen />);
    expect(await screen.findByText(publicRecord.name)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "자료 게시" }));
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    const submit = screen.getByRole("button", { name: "무료 공유 마켓에 게시" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.publishResource).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "내 공유" }).getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(screen.getByText(publishedRecord.name)).toBeTruthy();
    expect(screen.queryByText(publicRecord.name)).toBeNull();
    expect(screen.queryByRole("button", { name: "목록에서 내리기" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(publishedRecord.name);

    await act(async () => {
      mineResponse.reject(new Error("내 공유 새로고침 실패"));
      await mineResponse.promise.catch(() => undefined);
    });

    expect(screen.getByRole("alert").textContent).toContain("내 공유 새로고침 실패");
    expect(screen.getByText(publishedRecord.name)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(publishedRecord.name);
  });

  it("폼이 사라진 뒤 끝난 게시 POST가 사용자의 이후 탭 선택을 바꾸지 않는다", async () => {
    const publishedRecord = resource("published-late", "늦게 완료된 게시물", true);
    const pendingPublish = deferred<CreatorMarketplaceResourceRecord>();
    mocks.listPublic.mockResolvedValue(page([]));
    mocks.publishResource.mockReturnValue(pendingPublish.promise);

    render(<StudioCommunityMarketplacePanel initialOpen initialView="share" />);
    fireEvent.click(screen.getByLabelText("제가 직접 제작했으며 게시·재배포할 권리를 보유합니다."));
    fireEvent.click(screen.getByLabelText("다른 마켓 상품을 복제하거나 알아보기 어렵게 변형한 자료가 아닙니다."));
    const submit = screen.getByRole("button", { name: "무료 공유 마켓에 게시" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.publishResource).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("tab", { name: "공개 마켓" }));
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "공개 마켓" }).getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(screen.queryByRole("button", { name: "무료 공유 마켓에 게시" })).toBeNull();

    await act(async () => {
      pendingPublish.resolve(publishedRecord);
      await pendingPublish.promise;
    });

    expect(
      screen.getByRole("tab", { name: "공개 마켓" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByText(publishedRecord.name)).toBeNull();
    expect(screen.queryByText(/무료 공유 마켓에 게시했습니다/)).toBeNull();
  });

  it("이전 공개 loadMore가 늦게 끝나도 mine 결과에 append하지 않는다", async () => {
    const publicRecord = resource("public-1", "공개 첫 페이지", false);
    const stalePublicRecord = resource("public-2", "늦은 공개 다음 페이지", false);
    const mineRecord = resource("mine-1", "내 공유 자료", true);
    const staleLoadMore = deferred<CreatorMarketplaceResourceListPage>();
    mocks.listPublic
      .mockResolvedValueOnce(page([publicRecord], "public_cursor"))
      .mockReturnValueOnce(staleLoadMore.promise);
    mocks.listMine.mockResolvedValue(page([mineRecord]));

    render(<StudioCommunityMarketplacePanel initialOpen />);
    expect(await screen.findByText(publicRecord.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
    await waitFor(() => expect(mocks.listPublic).toHaveBeenCalledTimes(2));
    const loadMoreSignal = mocks.listPublic.mock.calls[1]?.[1] as AbortSignal;

    fireEvent.click(screen.getByRole("tab", { name: "내 공유" }));
    expect(await screen.findByText(mineRecord.name)).toBeTruthy();
    expect(loadMoreSignal.aborted).toBe(true);

    await act(async () => {
      staleLoadMore.resolve(page([stalePublicRecord]));
      await staleLoadMore.promise;
    });

    expect(screen.getByText(mineRecord.name)).toBeTruthy();
    expect(screen.queryByText(stalePublicRecord.name)).toBeNull();
  });

  it("새 필터 첫 페이지가 시작되면 이전 records와 cursor를 즉시 비운다", async () => {
    const publicRecord = resource("public-1", "이전 전체 자료", false);
    const filteredRecord = resource("brush-1", "새 브러시 자료", false);
    const filteredResponse = deferred<CreatorMarketplaceResourceListPage>();
    mocks.listPublic
      .mockResolvedValueOnce(page([publicRecord], "public_cursor"))
      .mockReturnValueOnce(filteredResponse.promise);

    render(<StudioCommunityMarketplacePanel initialOpen />);
    expect(await screen.findByText(publicRecord.name)).toBeTruthy();
    expect(screen.getByRole("button", { name: "더 불러오기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "브러시" }));
    await waitFor(() => expect(mocks.listPublic).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(publicRecord.name)).toBeNull();
    expect(screen.queryByRole("button", { name: "더 불러오기" })).toBeNull();
    expect(mocks.listPublic).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "brush" }),
      expect.any(AbortSignal),
    );
    const filteredRequest = mocks.listPublic.mock.lastCall?.[0] as {
      cursor?: string;
    };
    expect(filteredRequest.cursor).toBeUndefined();

    await act(async () => {
      filteredResponse.resolve(page([filteredRecord]));
      await filteredResponse.promise;
    });

    expect(screen.getByText(filteredRecord.name)).toBeTruthy();
  });

  it("stale loadMore 오류와 finally가 현재 mine loadMore 상태를 바꾸지 않는다", async () => {
    const publicRecord = resource("public-1", "공개 첫 페이지", false);
    const mineRecord = resource("mine-1", "내 공유 첫 페이지", true);
    const nextMineRecord = resource("mine-2", "내 공유 다음 페이지", true);
    const stalePublicLoadMore = deferred<CreatorMarketplaceResourceListPage>();
    const currentMineLoadMore = deferred<CreatorMarketplaceResourceListPage>();
    mocks.listPublic
      .mockResolvedValueOnce(page([publicRecord], "public_cursor"))
      .mockReturnValueOnce(stalePublicLoadMore.promise);
    mocks.listMine
      .mockResolvedValueOnce(page([mineRecord], "mine_cursor"))
      .mockReturnValueOnce(currentMineLoadMore.promise);

    render(<StudioCommunityMarketplacePanel initialOpen />);
    expect(await screen.findByText(publicRecord.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
    await waitFor(() => expect(mocks.listPublic).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("tab", { name: "내 공유" }));
    expect(await screen.findByText(mineRecord.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
    await waitFor(() => expect(mocks.listMine).toHaveBeenCalledTimes(2));
    const currentLoadMoreButton = screen.getByRole("button", { name: "더 불러오기" });
    expect((currentLoadMoreButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      stalePublicLoadMore.reject(new Error("폐기된 공개 다음 페이지 오류"));
      await stalePublicLoadMore.promise.catch(() => undefined);
    });

    expect(screen.queryByText("폐기된 공개 다음 페이지 오류")).toBeNull();
    expect((screen.getByRole("button", { name: "더 불러오기" }) as HTMLButtonElement).disabled)
      .toBe(true);

    await act(async () => {
      currentMineLoadMore.resolve(page([nextMineRecord]));
      await currentMineLoadMore.promise;
    });

    expect(screen.getByText(mineRecord.name)).toBeTruthy();
    expect(screen.getByText(nextMineRecord.name)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "더 불러오기" })).toBeNull();
  });

  it("계정 보관함은 private membership과 현재 공개 head를 교차 검증해 Studio 카드로 연다", async () => {
    const current = cloudBrushRecord();
    const item = cloudLibraryItem(current, "confirmed");
    mocks.listLibrary.mockResolvedValue({
      items: [item],
      limit: 12,
      hasMore: false,
      nextCursor: null,
    });
    mocks.getResource.mockResolvedValue(current);
    mocks.inspectInstallState.mockResolvedValue("installed");
    mocks.projectPack.mockReturnValue({
      status: "installable",
      pack: {
        metadata: {
          id: item.logicalPackId,
          kind: "brush",
          version: current.resourceVersion,
          packageFingerprint: current.manifestHash,
          creator: { id: current.publisher.id },
        },
        entries: [],
        marketplaceSource: {
          schema: "creator-marketplace-resource-v1",
          releaseId: current.id,
          publisherId: current.publisher.id,
          packageId: current.packageId,
        },
      },
    });
    mocks.setLibraryArchived.mockResolvedValue({
      operation: "set-archive",
      changed: true,
      membership: "archived",
      libraryScope: "account",
      libraryItemId: item.id,
      logicalPackId: item.logicalPackId,
      updatedAt: "2026-08-31T02:00:00.000Z",
    });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );

    expect(await screen.findByText(current.name)).toBeTruthy();
    expect(screen.getByRole("heading", { name: current.name, level: 3 })).toBeTruthy();
    expect(screen.getByText(/계정 라이브러리 활성/u)).toBeTruthy();
    expect(screen.getByText(/Studio v1\.0\.0 설치 확인 이력/u)).toBeTruthy();
    expect(mocks.listLibrary).toHaveBeenCalledWith(
      { view: "active", limit: 12 },
      expect.any(AbortSignal),
    );
    expect(mocks.getResource).toHaveBeenCalledWith(
      current.id,
      expect.any(AbortSignal),
    );
    const archive = screen.getByRole<HTMLButtonElement>("button", {
      name: "계정 라이브러리에 보관",
    });
    archive.focus();
    fireEvent.click(archive);
    archive.blur();
    await waitFor(() => expect(mocks.setLibraryArchived).toHaveBeenCalledWith(
      item.id,
      true,
      expect.any(AbortSignal),
    ));
    expect(screen.getByRole("status").textContent)
      .toContain("로컬 설치는 제거하지 않았습니다");
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "보관 항목" }),
    ));
  });

  it("idempotent account membership 응답은 불필요하게 카드를 재로딩하지 않고 같은 action에 초점을 복원한다", async () => {
    const current = cloudBrushRecord();
    const item = cloudLibraryItem(current, "confirmed");
    mocks.listLibrary.mockResolvedValue({
      items: [item],
      limit: 12,
      hasMore: false,
      nextCursor: null,
    });
    mocks.getResource.mockResolvedValue(current);
    mocks.setLibraryArchived.mockResolvedValue({
      operation: "set-archive",
      changed: false,
      membership: "active",
      libraryScope: "account",
      libraryItemId: item.id,
      logicalPackId: item.logicalPackId,
      updatedAt: "2026-08-31T02:00:00.000Z",
    });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );
    const archive = await screen.findByRole<HTMLButtonElement>("button", {
      name: "계정 라이브러리에 보관",
    });
    archive.focus();
    fireEvent.click(archive);
    archive.blur();

    await waitFor(() => expect(document.activeElement).toBe(archive));
    expect(mocks.listLibrary).toHaveBeenCalledTimes(1);
  });

  it("account membership 오류 뒤에는 action을 복원하되 사용자가 옮긴 초점은 가로채지 않는다", async () => {
    const current = cloudBrushRecord();
    const item = cloudLibraryItem(current, "confirmed");
    const pending = deferred<never>();
    mocks.listLibrary.mockResolvedValue({
      items: [item],
      limit: 12,
      hasMore: false,
      nextCursor: null,
    });
    mocks.getResource.mockResolvedValue(current);
    mocks.setLibraryArchived.mockReturnValue(pending.promise);

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );
    const archive = await screen.findByRole<HTMLButtonElement>("button", {
      name: "계정 라이브러리에 보관",
    });
    const activeView = screen.getByRole<HTMLButtonElement>("button", { name: "활성 항목" });
    archive.focus();
    fireEvent.click(archive);
    activeView.focus();
    pending.reject(new Error("archive temporarily unavailable"));

    expect(await screen.findByText(/archive temporarily unavailable/u)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(activeView));
  });

  it("제재된 계정 이력은 private fact로 보존하되 공개 head fetch와 설치를 차단한다", async () => {
    const current = cloudBrushRecord();
    const available = cloudLibraryItem(current, "confirmed");
    const moderated = {
      ...available,
      catalog: { state: "unavailable" as const, reason: "moderated" as const },
      updateState: "catalog-unavailable" as const,
    };
    mocks.listLibrary.mockResolvedValue({
      items: [moderated],
      limit: 12,
      hasMore: false,
      nextCursor: null,
    });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );

    expect(await screen.findByText(current.name)).toBeTruthy();
    expect(screen.getByText(/관리자 검수로 숨겨진 패키지/u)).toBeTruthy();
    expect(screen.getByText(/기존 계정 취득·설치 확인 이력은 보존/u)).toBeTruthy();
    expect(mocks.getResource).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "무료 설치" })).toBeNull();
  });

  it("계정 활성 조회가 늦게 끝나도 보관 보기 결과를 덮지 않는다", async () => {
    const current = cloudBrushRecord();
    const staleActive = deferred<{
      items: ReturnType<typeof cloudLibraryItem>[];
      limit: number;
      hasMore: boolean;
      nextCursor: null;
    }>();
    mocks.listLibrary
      .mockReturnValueOnce(staleActive.promise)
      .mockResolvedValueOnce({
        items: [],
        limit: 12,
        hasMore: false,
        nextCursor: null,
      });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(mocks.listLibrary).toHaveBeenCalledTimes(1));
    const activeSignal = mocks.listLibrary.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "보관 항목" }));
    await waitFor(() => expect(mocks.listLibrary).toHaveBeenCalledTimes(2));
    expect(activeSignal.aborted).toBe(true);
    expect(await screen.findByText("계정 라이브러리에 보관된 항목이 없습니다."))
      .toBeTruthy();

    await act(async () => {
      staleActive.resolve({
        items: [cloudLibraryItem(current)],
        limit: 12,
        hasMore: false,
        nextCursor: null,
      });
      await staleActive.promise;
    });
    expect(screen.queryByText(current.name)).toBeNull();
  });

  it.each([
    "관리자 숨김",
    "배급자 목록 내림",
    "배급자 계정 중지",
  ])("%s로 action-time public GET이 404면 로컬 설치 전에 중단한다", async () => {
    const current = cloudBrushRecord();
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue(installableProjection(current));
    mocks.getResource.mockRejectedValue(new NotFoundError());

    render(<StudioCommunityMarketplacePanel initialOpen />);
    const install = await screen.findByRole<HTMLButtonElement>("button", {
      name: "무료 설치",
    });
    install.focus();
    fireEvent.click(install);
    install.blur();

    expect((await screen.findByRole("alert")).textContent)
      .toContain("더 이상 공개 상태를 확인할 수 없어 로컬 설치");
    expect(screen.getByRole("alert").textContent)
      .toContain("공개 목록을 새로고침한 뒤 다시 시도");
    expect(mocks.getResource).toHaveBeenCalledWith(
      current.id,
      expect.any(AbortSignal),
    );
    expect(mocks.installPack).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(install));
  });

  it.each([
    ["release id", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      id: "423e4567-e89b-42d3-a456-426614174000",
    })],
    ["publisher/logical pack", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      publisher: {
        ...current.publisher,
        id: "423e4567-e89b-42d3-a456-426614174001",
      },
    })],
    ["package/logical pack", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      packageId: "original/brush/replaced-account-ink",
    })],
    ["kind", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      kind: "filter" as const,
    })],
    ["version", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      resourceVersion: "2.0.0",
    })],
    ["manifest", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      manifestHash: "c".repeat(64),
    })],
    ["minimum Studio", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      minimumStudioVersion: "2.0.0",
    })],
    ["manifest byte size", (current: CreatorMarketplaceResourceRecord) => ({
      ...current,
      manifestByteSize: current.manifestByteSize + 1,
    })],
  ] as const)("action-time %s evidence mismatch는 captured pack 설치를 차단한다", async (_label, mutate) => {
    const current = cloudBrushRecord();
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue(installableProjection(current));
    mocks.getResource.mockResolvedValue(mutate(current));

    render(<StudioCommunityMarketplacePanel initialOpen />);
    fireEvent.click(await screen.findByRole("button", { name: "무료 설치" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("현재 공개 릴리스 증거가 이 카드와 달라 로컬 설치");
    expect(mocks.installPack).not.toHaveBeenCalled();
  });

  it("이미 설치된 pack 제거는 public GET과 네트워크 가용성에 의존하지 않는다", async () => {
    const current = cloudBrushRecord();
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.inspectInstallState.mockResolvedValue("installed");
    mocks.projectPack.mockReturnValue(installableProjection(current));
    mocks.getResource.mockRejectedValue(new NotFoundError());

    render(<StudioCommunityMarketplacePanel initialOpen />);
    fireEvent.click(await screen.findByRole("button", { name: "기기에서 제거" }));

    await waitFor(() => expect(mocks.uninstallPack).toHaveBeenCalledTimes(1));
    expect(mocks.getResource).not.toHaveBeenCalled();
  });

  it("에셋 삽입도 action-time 공개 상태를 확인하고 404면 캔버스를 변경하지 않는다", async () => {
    const current: CreatorMarketplaceResourceRecord = {
      ...cloudBrushRecord(),
      id: "423e4567-e89b-42d3-a456-426614174010",
      packageId: "original/asset/account-prop",
      name: "공개 검증 소품",
      kind: "asset",
    };
    const useAsset = vi.fn(() => true);
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.projectAssets.mockReturnValue({
      assets: [{ id: "asset-prop-1", name: "검증 소품" }],
      unsupportedCount: 0,
      reason: null,
    });
    mocks.getResource.mockRejectedValue(new NotFoundError());

    render(
      <StudioCommunityMarketplacePanel initialOpen onUseAsset={useAsset} />,
    );
    const insert = await screen.findByRole<HTMLButtonElement>("button", {
      name: "캔버스에 추가",
    });
    insert.focus();
    fireEvent.click(insert);
    insert.blur();

    expect((await screen.findByRole("alert")).textContent)
      .toContain("더 이상 공개 상태를 확인할 수 없어 에셋 삽입");
    expect(useAsset).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(insert));
  });

  it("보관된 cloud history 카드도 action-time public 404를 설치 가능 상태로 가장하지 않는다", async () => {
    const current = cloudBrushRecord();
    const activeItem = cloudLibraryItem(current, "confirmed");
    const archivedItem = {
      ...activeItem,
      membership: "archived" as const,
      archivedAt: "2026-08-31T02:00:00.000Z",
    };
    mocks.listLibrary.mockResolvedValue({
      items: [archivedItem],
      limit: 12,
      hasMore: false,
      nextCursor: null,
    });
    mocks.getResource
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new NotFoundError());
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue(installableProjection(current));

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen initialView="library" />
      </SessionContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "무료 설치" }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("더 이상 공개 상태를 확인할 수 없어 로컬 설치");
    expect(mocks.getResource).toHaveBeenCalledTimes(2);
    expect(mocks.installPack).not.toHaveBeenCalled();
  });

  it("public revalidation은 single-flight이며 사용자가 옮긴 초점을 오류 뒤 가로채지 않는다", async () => {
    const current = cloudBrushRecord();
    const pending = deferred<CreatorMarketplaceResourceRecord>();
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue(installableProjection(current));
    mocks.getResource.mockReturnValue(pending.promise);

    render(<StudioCommunityMarketplacePanel initialOpen />);
    const install = await screen.findByRole<HTMLButtonElement>("button", {
      name: "무료 설치",
    });
    install.focus();
    fireEvent.click(install);
    expect(screen.getByRole("button", { name: "공개 상태 확인 중…" }))
      .toBeTruthy();
    fireEvent.click(install);
    expect(mocks.getResource).toHaveBeenCalledTimes(1);

    const mineTab = screen.getByRole<HTMLButtonElement>("tab", { name: "내 공유" });
    mineTab.focus();
    await act(async () => {
      pending.reject(new NotFoundError());
      await pending.promise.catch(() => undefined);
    });

    expect(screen.getByRole("alert").textContent)
      .toContain("공개 목록을 새로고침한 뒤 다시 시도");
    expect(document.activeElement).toBe(mineTab);
    expect(mocks.installPack).not.toHaveBeenCalled();
  });

  it("탭 전환으로 폐기된 public GET이 abort를 무시하고 끝나도 stale local install을 시작하지 않는다", async () => {
    const current = cloudBrushRecord();
    const pending = deferred<CreatorMarketplaceResourceRecord>();
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue(installableProjection(current));
    mocks.getResource.mockReturnValue(pending.promise);

    render(<StudioCommunityMarketplacePanel initialOpen />);
    fireEvent.click(await screen.findByRole("button", { name: "무료 설치" }));
    await waitFor(() => expect(mocks.getResource).toHaveBeenCalledTimes(1));
    const signal = mocks.getResource.mock.calls[0]?.[1] as AbortSignal;
    const mineTab = screen.getByRole<HTMLButtonElement>("tab", { name: "내 공유" });
    mineTab.focus();
    fireEvent.click(mineTab);
    expect(signal.aborted).toBe(true);

    await act(async () => {
      pending.resolve(current);
      await pending.promise;
    });

    expect(mocks.installPack).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(mineTab);
  });

  it("로컬 설치 커밋 뒤에만 atomic exact 설치 확인을 기록한다", async () => {
    const current = cloudBrushRecord();
    const item = cloudLibraryItem(current);
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.getResource.mockResolvedValue(current);
    mocks.inspectInstallState.mockResolvedValue("available");
    mocks.projectPack.mockReturnValue({
      status: "installable",
      pack: {
        metadata: {
          id: item.logicalPackId,
          kind: "brush",
          version: current.resourceVersion,
          packageFingerprint: current.manifestHash,
          creator: { id: current.publisher.id },
        },
        entries: [],
        marketplaceSource: {
          schema: "creator-marketplace-resource-v1",
          releaseId: current.id,
          publisherId: current.publisher.id,
          packageId: current.packageId,
        },
      },
    });
    mocks.confirmInstall.mockResolvedValue({
      operation: "confirm-studio-install",
      changed: true,
      membership: "active",
      libraryScope: "account",
      libraryItemId: item.id,
      logicalPackId: item.logicalPackId,
      updatedAt: "2026-08-31T02:00:00.000Z",
      acknowledgement: {
        releaseId: current.id,
        manifestHash: current.manifestHash,
      },
      confirmation: {
        scope: "account-ever",
        releaseId: current.id,
        resourceVersion: current.resourceVersion,
        releaseOrdinal: 1,
        manifestHash: current.manifestHash,
        confirmedAt: "2026-08-31T02:00:00.000Z",
      },
    });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen />
      </SessionContext.Provider>,
    );
    const install = await screen.findByRole<HTMLButtonElement>("button", { name: "무료 설치" });
    install.focus();
    fireEvent.click(install);
    install.blur();

    await waitFor(() => expect(mocks.confirmInstall).toHaveBeenCalledWith(
      current.id,
      {
        schemaVersion: 1,
        logicalPackId: item.logicalPackId,
        packageFingerprint: current.manifestHash,
      },
    ));
    expect(mocks.getResource).toHaveBeenCalledWith(
      current.id,
      expect.any(AbortSignal),
    );
    expect(mocks.installPack).toHaveBeenCalledTimes(1);
    expect(mocks.getResource.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.installPack.mock.invocationCallOrder[0]!);
    expect(mocks.installPack.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.confirmInstall.mock.invocationCallOrder[0]!);
    expect(mocks.acquireLibrary).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent)
      .toContain("실제 Studio 설치를 확인했습니다");
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "무료 설치" }),
    ));
  });

  it("계정 확인 실패는 성공한 로컬 설치를 되돌리지 않고 exact 재검증 뒤 재시도한다", async () => {
    const current = cloudBrushRecord();
    const item = cloudLibraryItem(current);
    mocks.listPublic.mockResolvedValue(page([current]));
    mocks.getResource.mockResolvedValue(current);
    mocks.inspectInstallState
      .mockResolvedValueOnce("available")
      .mockResolvedValue("installed");
    mocks.projectPack.mockReturnValue({
      status: "installable",
      pack: {
        metadata: {
          id: item.logicalPackId,
          kind: "brush",
          version: current.resourceVersion,
          packageFingerprint: current.manifestHash,
          creator: { id: current.publisher.id },
        },
        entries: [],
        marketplaceSource: {
          schema: "creator-marketplace-resource-v1",
          releaseId: current.id,
          publisherId: current.publisher.id,
          packageId: current.packageId,
        },
      },
    });
    mocks.confirmInstall
      .mockRejectedValueOnce(new Error("cloud temporarily unavailable"))
      .mockResolvedValueOnce({
        operation: "confirm-studio-install",
        changed: false,
        membership: "active",
        libraryScope: "account",
        libraryItemId: item.id,
        logicalPackId: item.logicalPackId,
        updatedAt: "2026-08-31T02:00:00.000Z",
        acknowledgement: {
          releaseId: current.id,
          manifestHash: current.manifestHash,
        },
        confirmation: {
          scope: "account-ever",
          releaseId: current.id,
          resourceVersion: current.resourceVersion,
          releaseOrdinal: 1,
          manifestHash: current.manifestHash,
          confirmedAt: "2026-08-31T02:00:00.000Z",
        },
      });

    render(
      <SessionContext.Provider value={authenticatedSessionValue()}>
        <StudioCommunityMarketplacePanel initialOpen />
      </SessionContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "무료 설치" }));

    expect(await screen.findByText(/로컬 설치는 유지됩니다/u)).toBeTruthy();
    const retry = await screen.findByRole("button", {
      name: "계정 설치 확인 다시 동기화",
    });
    expect(mocks.uninstallPack).not.toHaveBeenCalled();
    retry.focus();
    fireEvent.click(retry);
    retry.blur();

    await waitFor(() => expect(mocks.confirmInstall).toHaveBeenCalledTimes(2));
    expect(mocks.inspectInstallState).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status").textContent)
      .toContain("이미 최신입니다");
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "기기에서 제거" }),
    ));
  });
});
