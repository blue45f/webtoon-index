// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MARKET_COMPARE_STORAGE_KEY } from "../hooks/use-market-compare";

import { MarketResourceDetailArticle } from "./MarketResourceDetailArticle";
import { MarketWebtoon3dViewerModal } from "./MarketWebtoon3dViewerModal";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { CREATOR_MARKETPLACE_STARTER_RECORDS } from "@/shared/lib/creator-marketplace-starter-catalog";

vi.mock("./MarketResourceReleaseHistory", () => ({ MarketResourceReleaseHistory: () => null }));
vi.mock("./MarketCommentsSection", () => ({ MarketCommentsSection: () => null }));
vi.mock("./MarketReviewsSection", () => ({ MarketReviewsSection: () => null }));
vi.mock("./CreatorMarketplaceCloudLibraryAction", () => ({ CreatorMarketplaceCloudLibraryAction: () => null }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function detail(record: CreatorMarketplaceResourceRecord) {
  return render(
    <MemoryRouter>
      <MarketResourceDetailArticle record={record} relatedItems={[]} staleSavedAt={null} onRetry={() => undefined} />
    </MemoryRouter>,
  );
}

describe("recovered marketplace integrity", () => {
  it("does not turn a noncommercial license or AI disclosure into a commercial/NoAI guarantee", () => {
    const record: CreatorMarketplaceResourceRecord = {
      ...CREATOR_MARKETPLACE_STARTER_RECORDS[0]!,
      license: "cc-by-nc-4.0",
      containsAi: false,
    };
    const { container } = detail(record);
    const rights = screen.getByRole("region", { name: "게시 manifest 기반 권리·호환성 확인" });
    expect(rights.textContent).toContain("CC BY-NC");
    expect(rights.textContent).toContain("AI 사용 미포함으로 공개");
    expect(container.textContent).not.toContain("상업용 웹툰 정식 연재 100% 허용");
    expect(container.textContent).not.toContain("저작권 분쟁으로부터 안전");
    expect(container.textContent).not.toContain("NoAI 조건 공개");
    expect(container.textContent).not.toContain("웹툰 최적화");
    expect(container.textContent).not.toContain("순수 창작");
  });

  it("connects the detail comparison action to the real persistent shortlist", () => {
    const record = CREATOR_MARKETPLACE_STARTER_RECORDS[0]!;
    detail(record);
    const button = screen.getByRole("button", { name: `${record.name} 비교 목록에 추가` });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: `${record.name} 비교 목록에서 제거` }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(MARKET_COMPARE_STORAGE_KEY)).toContain(record.id);
  });

  it("labels the example honestly, omits invented specifications, and links to the real Studio route", () => {
    const id = "123e4567-e89b-42d3-a456-426614174099";
    render(
      <MemoryRouter>
        <MarketWebtoon3dViewerModal open onClose={() => undefined} assetTitle="테스트 3D" studioResourceId={id} />
      </MemoryRouter>,
    );
    const modal = screen.getByRole("dialog");
    expect(modal.textContent).toContain("이 에셋의 실제 메시가 아닙니다");
    expect(modal.textContent).toContain("메시 통계 미제공");
    expect(modal.textContent).not.toContain("45,000");
    expect(modal.textContent).not.toContain("28,000");
    expect(modal.textContent).not.toContain("GLB");
    expect(modal.textContent).not.toContain("NoAI 조건 공개");
    expect(within(modal).getByRole("link", { name: "Studio에서 실제 에셋 확인" }).getAttribute("href"))
      .toBe(`/studio?installMarketResource=${id}&assetMarket=community`);
    fireEvent.click(within(modal).getByRole("button", { name: "웹툰 은선" }));
    expect(within(modal).getByRole("button", { name: "웹툰 은선" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(modal).getByRole("slider", { name: "렌더 모드 예시 회전각" })).toBeTruthy();
  });

  it("rejects invalid optional mesh statistics rather than printing NaN or negative counts", () => {
    render(<MarketWebtoon3dViewerModal open onClose={() => undefined} assetTitle="잘못된 통계" triangleCount={Number.NaN} vertexCount={-1} />);
    const modal = screen.getByRole("dialog");
    expect(modal.textContent).toContain("메시 통계 미제공");
    expect(modal.textContent).not.toContain("Triangles:");
    expect(modal.textContent).not.toContain("Vertices:");
  });

  it("opens the illustrative dialog from the detail without inventing a GLB format or a completed import", () => {
    const source = CREATOR_MARKETPLACE_STARTER_RECORDS.find((record) => record.kind === "3d-preset");
    expect(source).toBeDefined();
    detail(source!);
    fireEvent.click(screen.getByRole("button", { name: "3D 렌더 모드 예시 보기" }));
    const modal = screen.getByRole("dialog");
    expect(modal.textContent).not.toContain("GLB");
    expect(within(modal).getByRole("link", { name: "Studio에서 실제 에셋 확인" }).getAttribute("href"))
      .toBe(`/studio?installMarketResource=${source!.id}&assetMarket=community`);
  });
});
