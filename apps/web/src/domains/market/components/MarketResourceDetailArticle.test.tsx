// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketResourceDetailArticle } from "./MarketResourceDetailArticle";

import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
  writeCreatorMarketplaceInstallReceipt,
} from "@/shared/lib/creator-marketplace-install-receipt";
import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";

vi.mock("./MarketResourceReleaseHistory", () => ({
  MarketResourceReleaseHistory: ({ resourceId }: { resourceId: string }) => (
    <div data-testid="release-history" data-resource-id={resourceId} />
  ),
}));

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalShareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");

function restoreNavigatorProperty(
  property: "clipboard" | "share",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(navigator, property, descriptor);
  else Reflect.deleteProperty(navigator, property);
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY);
  restoreNavigatorProperty("clipboard", originalClipboardDescriptor);
  restoreNavigatorProperty("share", originalShareDescriptor);
  vi.restoreAllMocks();
});

function marketRecord(kind: Extract<
  CreatorMarketplaceResourceKind,
  "asset" | "brush" | "template" | "3d-preset"
>): CreatorMarketplaceResourceRecord {
  const runtimeRef = kind === "asset"
    ? "studio-asset:starter-prop"
    : kind === "template"
      ? "studio-scene-template:vertical-story"
      : kind === "3d-preset"
        ? "toonspectrum-bg3d-procedural-starter-v1"
        : "studio-brush:starter-ink";
  return {
    schemaVersion: 1,
    packageId: `original/${kind}/starter`,
    name: kind === "asset"
      ? "스타터 소품"
      : kind === "template"
        ? "세로 스토리 템플릿"
        : kind === "3d-preset"
          ? "절차형 3D 배경"
          : "스타터 잉크 브러시",
    description: "마켓 상세 접근성 테스트 리소스",
    kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["스타터", "테스트"],
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: `${kind}/starter`,
      kind,
      name: "스타터 항목",
      delivery: {
        mode: "builtin-ref",
        runtimeRef,
        byteSize: 0,
        sha256: "a".repeat(64),
      },
    }],
    id: kind === "asset"
      ? "123e4567-e89b-42d3-a456-426614174000"
      : kind === "template"
        ? "223e4567-e89b-42d3-a456-426614174000"
        : kind === "3d-preset"
          ? "523e4567-e89b-42d3-a456-426614174000"
          : "423e4567-e89b-42d3-a456-426614174000",
    manifestHash: "b".repeat(64),
    manifestByteSize: 512,
    publisher: {
      id: "323e4567-e89b-42d3-a456-426614174000",
      name: "마켓 작가",
      avatar: null,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

function renderDetail(record: CreatorMarketplaceResourceRecord) {
  return render(
    <MemoryRouter>
      <MarketResourceDetailArticle
        record={record}
        relatedItems={[]}
        staleSavedAt={null}
        onRetry={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("MarketResourceDetailArticle actions and metadata", () => {
  it("describes asset insertion and connects publisher profile, catalog, and license routes", () => {
    const record = marketRecord("asset");
    const { container } = renderDetail(record);

    expect(
      screen.getByRole("link", { name: "스튜디오 캔버스에 에셋 삽입" }).getAttribute("href"),
    ).toBe(`/studio?installMarketResource=${record.id}&assetMarket=community`);
    expect(screen.getByText(/지원되는 첫 에셋을 현재 캔버스에 삽입/u)).toBeTruthy();
    expect(screen.getByRole("link", { name: "마켓 작가" }).getAttribute("href"))
      .toBe(`/u/${record.publisher.id}`);
    expect(screen.getByRole("link", { name: "이 배급자의 마켓 리소스" }).getAttribute("href"))
      .toBe(`/market/browse?publisher=${record.publisher.id}`);
    expect(screen.getByRole("link", { name: "같은 종류의 리소스 더 보기" }).getAttribute("href"))
      .toBe("/market/browse?kind=asset");
    expect(screen.getByRole("link", { name: "ToonSpectrum 표준 사용권" }).getAttribute("href"))
      .toBe("/terms");
    expect(screen.getByText("작품 사용은 자유, 리소스 파일 재배포는 불가")).toBeTruthy();
    expect(screen.getByRole("button", { name: "메타데이터 스냅샷 다운로드" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "세션 확인 중" })).toBeTruthy();
    expect(screen.getByTestId("release-history").getAttribute("data-resource-id"))
      .toBe(record.id);
    expect(screen.getByRole("heading", { name: /에셋 적용 정보 · 스타터 항목/u })).toBeTruthy();
    expect(screen.getByText("studio-asset:starter-prop")).toBeTruthy();
    expect(container.innerHTML).toContain("var(--color-card)");
    expect(container.innerHTML).not.toContain("text-white");
    expect(container.innerHTML).not.toContain("bg-black");
  });

  it("opens the template catalog without promising installation or canvas insertion", () => {
    renderDetail(marketRecord("template"));

    expect(screen.getByRole("link", { name: "장면 템플릿 카탈로그 열기" })).toBeTruthy();
    expect(screen.getByText(/장면 카드를 눌러야 현재 컷에 적용/u)).toBeTruthy();
    expect(screen.queryByText("스튜디오에 리소스 팩 설치")).toBeNull();
    expect(screen.queryByText(/1클릭으로 설치 및 캔버스 삽입/u)).toBeNull();
  });

  it("opens the 3D background catalog without claiming that an asset was inserted", () => {
    renderDetail(marketRecord("3d-preset"));

    expect(screen.getByRole("link", { name: "3D 배경 카탈로그 열기" })).toBeTruthy();
    expect(screen.getByText(/항목을 직접 선택해야 장면에 추가/u)).toBeTruthy();
    expect(screen.queryByText(/3D.*삽입/u)).toBeNull();
  });

  it("describes installable brush resources as local tool-library packs", () => {
    renderDetail(marketRecord("brush"));

    expect(screen.getByRole("link", { name: "스튜디오에 리소스 팩 설치" })).toBeTruthy();
    expect(screen.getByText(/로컬 도구 라이브러리에 설치/u)).toBeTruthy();
    expect(screen.getByText("이 기기·브라우저에서 확인된 설치 영수증 없음"))
      .toBeTruthy();
    expect(screen.getByText(/계정 소유권이나 클라우드 동기화 상태가 아닙니다/u))
      .toBeTruthy();
  });

  it("labels an exact local receipt as installed and an older release receipt as updateable", () => {
    const current = marketRecord("brush");
    const logicalPackId = creatorMarketplaceStudioPackId(current);
    expect(writeCreatorMarketplaceInstallReceipt({
      logicalPackId,
      packageVersion: current.resourceVersion,
      packageFingerprint: current.manifestHash,
      kind: "brush",
      installedAt: Date.now(),
    })).toBe(true);
    renderDetail(current);

    expect(screen.getByText(`이 기기·브라우저에 v${current.resourceVersion} 설치 확인됨`))
      .toBeTruthy();
    expect(screen.getByRole("link", { name: "스튜디오에서 설치 상태 확인" }))
      .toBeTruthy();

    cleanup();
    const nextRelease = {
      ...current,
      id: "623e4567-e89b-42d3-a456-426614174000",
      resourceVersion: "2.0.0",
      manifestHash: "c".repeat(64),
    } satisfies CreatorMarketplaceResourceRecord;
    renderDetail(nextRelease);

    expect(screen.getByText("업데이트 가능 · 설치 v1.0.0 → 마켓 v2.0.0"))
      .toBeTruthy();
    expect(screen.getByRole("link", { name: "스튜디오에서 v2.0.0로 업데이트" }))
      .toBeTruthy();
  });

  it("refreshes the same-device label for custom and cross-tab storage events", async () => {
    const record = marketRecord("brush");
    const logicalPackId = creatorMarketplaceStudioPackId(record);
    renderDetail(record);
    expect(screen.getByText("이 기기·브라우저에서 확인된 설치 영수증 없음"))
      .toBeTruthy();

    writeCreatorMarketplaceInstallReceipt({
      logicalPackId,
      packageVersion: record.resourceVersion,
      packageFingerprint: record.manifestHash,
      kind: "brush",
      installedAt: Date.now(),
    });
    await waitFor(() => {
      expect(screen.getByText("이 기기·브라우저에 v1.0.0 설치 확인됨"))
        .toBeTruthy();
    });

    localStorage.removeItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", {
      key: CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
    }));
    await waitFor(() => {
      expect(screen.getByText("이 기기·브라우저에서 확인된 설치 영수증 없음"))
        .toBeTruthy();
    });
  });

  it("wraps a maximum-width package ID inside the mobile metadata column", () => {
    const packageId = `original/asset/${"very-long-package-segment-".repeat(6)}`
      .slice(0, 160);
    renderDetail({ ...marketRecord("asset"), packageId });

    const packageValue = screen.getByText(packageId);
    expect(packageValue.className).toContain("break-all");
    expect(packageValue.className).toContain("max-w-full");
    expect(packageValue.closest("dd")?.className).toContain("min-w-0");
  });

  it("lets artists inspect every previewable entry instead of hiding entries after the first", () => {
    const first = marketRecord("template");
    const record: CreatorMarketplaceResourceRecord = {
      ...first,
      entries: [
        first.entries[0],
        {
          ...first.entries[0],
          id: "template/second",
          name: "두 번째 4컷 템플릿",
          delivery: {
            mode: "builtin-ref",
            runtimeRef: "studio-scene-template:4cut-story",
            byteSize: 0,
            sha256: "c".repeat(64),
          },
        },
      ],
    };
    renderDetail(record);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: /스타터 항목/u })).toBeTruthy();

    const firstTab = screen.getByRole("tab", { name: "스타터 항목" });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });

    expect(screen.getByRole("heading", { name: /두 번째 4컷 템플릿/u })).toBeTruthy();
    expect(screen.getByText("ID: studio-scene-template:4cut-story")).toBeTruthy();
    expect(screen.getByText(/선택은 상세 미리보기만 바꾸며/u)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "두 번째 4컷 템플릿" }),
    );
  });

  it("announces a recoverable error when share and clipboard APIs cannot complete", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderDetail(marketRecord("asset"));

    fireEvent.click(screen.getByRole("button", { name: "링크 공유" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "공유할 수 없어요 · 다시 시도" })).toBeTruthy();
    });
  });
});
