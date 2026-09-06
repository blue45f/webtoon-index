// StudioAssetMenuPanel의 모바일 터치·접근성 렌더 계약 회귀 테스트.
//
// 저장소 Vitest 환경은 node라 실제 클릭 이벤트 대신 renderToStaticMarkup으로 최초 렌더의
// 접근 가능한 이름, 44px 제어 클래스, hover에 의존하지 않는 작업 진입점을 검증한다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStudioAssetFavoriteId } from "./studio-asset-favorites";
import { StudioAssetMenuPanel } from "./StudioAssetMenuPanel";

import type { StudioAssetMenuPanelProps } from "./StudioAssetMenuPanel";
import type { SharedAssetCatalogItem } from "@/src/infrastructure/creator-client";

const LOCAL_ASSET = {
  id: "local-1",
  name: "로컬 에셋",
  dataUrl: "data:image/png;base64,AA",
  width: 512,
  height: 512,
  createdAt: 1,
  kind: "ai",
};

const SHARED_ASSET: SharedAssetCatalogItem = {
  id: "shared-1",
  name: "공유 에셋",
  previewDataUrl: "data:image/png;base64,AA",
  previewWidth: 160,
  previewHeight: 160,
  previewAvailable: true,
  width: 512,
  height: 512,
  kind: "image",
  downloads: 3,
  author: { id: "author-1", name: "작가", avatar: "" },
  isOwner: true,
  createdAt: "2026-07-11T00:00:00.000Z",
};

const noop = () => {
  // 정적 렌더 테스트라 콜백은 실행되지 않는다.
};
const succeed = () => true;

function renderPanel(overrides: Partial<StudioAssetMenuPanelProps> = {}) {
  const props: StudioAssetMenuPanelProps = {
    assetTab: "mine",
    setAssetTab: noop,
    onUploadAsset: noop,
    assetPrompt: "투명 웹툰 소품",
    setAssetPrompt: noop,
    assetPromptName: "소품",
    setAssetPromptName: noop,
    assetPromptSize: "1024x1024",
    setAssetPromptSize: noop,
    assetPromptQuality: "high",
    setAssetPromptQuality: noop,
    assetGenerating: false,
    onGenerateAsset: noop,
    assetSearchQuery: "",
    setAssetSearchQuery: noop,
    assetSortOrder: "newest",
    setAssetSortOrder: noop,
    favoriteState: { version: 1, ids: [] },
    favoriteOnly: false,
    setFavoriteOnly: noop,
    onToggleFavorite: noop,
    assets: [LOCAL_ASSET],
    assetsLoading: false,
    renamingAssetId: null,
    setRenamingAssetId: noop,
    renamingAssetName: "",
    setRenamingAssetName: noop,
    handleRenameAsset: noop,
    onUseLocalAsset: succeed,
    onShareAsset: noop,
    onDeleteAsset: noop,
    publishingId: null,
    shared: [SHARED_ASSET],
    sharedLoading: false,
    sharedLoadingMore: false,
    sharedHasMore: false,
    sharedError: null,
    loadSharedAssets: noop,
    loadMoreSharedAssets: noop,
    onUseSharedAsset: noop,
    onDeleteSharedAsset: noop,
    onReportSharedAsset: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioAssetMenuPanel {...props} />);
}

describe("StudioAssetMenuPanel mobile asset controls", () => {
  it("renders 44px controls, placement guidance, and an accessible context-aware add action", () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="이미지 에셋 업로드"');
    expect(html).toContain('aria-label="AI 에셋 생성 도구 열기"');
    expect(html).toContain('aria-controls="studio-ai-asset-creator"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="studio-ai-asset-creator" hidden=""');
    expect(html).toContain('aria-label="로컬 에셋 선택한 컷 또는 현재 보이는 위치에 추가"');
    expect(html).toContain('data-studio-asset-placement-help="true"');
    expect(html).toContain("클릭·탭");
    expect(html).toContain("끌어 놓기");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(7);
    expect(html).toContain("lucide-plus");
  });

  it("keeps local management discoverable without hover-only 20px actions", () => {
    const html = renderPanel();

    expect(html).toContain('aria-controls="local-asset-actions-local-1"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="로컬 에셋 관리 작업 열기"');
    expect(html).not.toContain("size-5");
    expect(html).not.toContain("group-hover:opacity-100");
  });

  it("renders 44px save/cancel controls while renaming", () => {
    const html = renderPanel({ renamingAssetId: LOCAL_ASSET.id, renamingAssetName: "새 이름" });

    expect(html).toContain('aria-label="로컬 에셋 새 이름"');
    expect(html).toContain('aria-label="로컬 에셋 이름 저장"');
    expect(html).toContain('aria-label="로컬 에셋 이름 변경 취소"');
    expect(html).not.toContain('aria-controls="local-asset-actions-local-1"');
  });

  it("gives owned shared assets an always-visible management entry and accessible add action", () => {
    const html = renderPanel({ assetTab: "community" });

    expect(html).toContain('data-studio-asset-marketplace-loading="true"');
    expect(html).toContain("커뮤니티 소재를 불러오는 중");
    expect(html).toContain('aria-label="공유 에셋 선택한 컷 또는 현재 보이는 위치에 추가"');
    expect(html).toContain('aria-controls="shared-asset-actions-shared-1"');
    expect(html).toContain('aria-label="공유 에셋 공유 관리 작업 열기"');
    expect(html).not.toContain("group-hover:opacity-100");
  });
});

describe("StudioAssetMenuPanel favorites", () => {
  it("keeps the selected sort order inside favorite and non-favorite groups", () => {
    const assets = [
      { ...LOCAL_ASSET, id: "ga", name: "가 에셋", createdAt: 1 },
      { ...LOCAL_ASSET, id: "da", name: "다 에셋", createdAt: 3 },
      { ...LOCAL_ASSET, id: "na", name: "나 에셋", createdAt: 2 },
    ];
    const html = renderPanel({
      assetSortOrder: "name",
      assets,
      favoriteState: {
        version: 1,
        ids: [
          createStudioAssetFavoriteId("local", "na"),
          createStudioAssetFavoriteId("local", "da"),
        ],
      },
    });

    const na = html.indexOf('data-favorite-id="local:na"');
    const da = html.indexOf('data-favorite-id="local:da"');
    const ga = html.indexOf('data-favorite-id="local:ga"');
    expect(na).toBeGreaterThan(-1);
    expect(na).toBeLessThan(da);
    expect(da).toBeLessThan(ga);
  });

  it("intersects the favorite-only filter with the current search", () => {
    const html = renderPanel({
      favoriteOnly: true,
      assetSearchQuery: "match",
      assets: [
        { ...LOCAL_ASSET, id: "match-favorite", name: "Match Favorite" },
        { ...LOCAL_ASSET, id: "match-regular", name: "Match Regular" },
        { ...LOCAL_ASSET, id: "hidden-favorite", name: "Hidden Favorite" },
      ],
      favoriteState: {
        version: 1,
        ids: [
          createStudioAssetFavoriteId("local", "match-favorite"),
          createStudioAssetFavoriteId("local", "hidden-favorite"),
        ],
      },
    });

    expect(html).toContain('data-favorite-id="local:match-favorite"');
    expect(html).not.toContain('data-favorite-id="local:match-regular"');
    expect(html).not.toContain('data-favorite-id="local:hidden-favorite"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("explains an empty favorite-only intersection instead of reporting a generic search miss", () => {
    const html = renderPanel({ favoriteOnly: true });

    expect(html).toContain('role="status"');
    expect(html).toContain("조건에 맞는 즐겨찾기가 없습니다.");
    expect(html).toContain("별표를 추가하거나 검색 조건을 바꿔보세요.");
    expect(html).not.toContain("검색 결과가 없습니다.");
  });

  it("keeps identical local and community raw IDs in separate favorite namespaces", () => {
    const rawId = "same-id";
    const favoriteState = {
      version: 1 as const,
      ids: [createStudioAssetFavoriteId("local", rawId)],
    };
    const localHtml = renderPanel({
      assets: [{ ...LOCAL_ASSET, id: rawId, name: "같은 로컬" }],
      shared: [{ ...SHARED_ASSET, id: rawId, name: "같은 공유" }],
      favoriteState,
    });
    const communityHtml = renderPanel({
      assetTab: "community",
      assets: [{ ...LOCAL_ASSET, id: rawId, name: "같은 로컬" }],
      shared: [{ ...SHARED_ASSET, id: rawId, name: "같은 공유" }],
      favoriteState,
    });

    expect(localHtml).toContain('data-favorite-id="local:same-id"');
    expect(localHtml).toContain('aria-label="같은 로컬 즐겨찾기에서 제거" aria-pressed="true"');
    expect(communityHtml).toContain('data-favorite-id="community:same-id"');
    expect(communityHtml).toContain('aria-label="같은 공유 즐겨찾기에 추가" aria-pressed="false"');
  });

  it("renders the star as a 44px sibling control, separate from use and management actions", () => {
    const html = renderPanel();
    const favoriteButton = html.indexOf('aria-label="로컬 에셋 즐겨찾기에 추가"');
    const favoriteButtonEnd = html.indexOf("</button>", favoriteButton);
    const useButton = html.indexOf('aria-label="로컬 에셋 선택한 컷 또는 현재 보이는 위치에 추가"');

    expect(html).toContain('aria-label="즐겨찾기만"');
    expect(html).toContain('aria-label="로컬 에셋 즐겨찾기에 추가" aria-pressed="false"');
    expect(html.slice(favoriteButton, favoriteButtonEnd)).toContain("size-11");
    expect(favoriteButton).toBeGreaterThan(-1);
    expect(favoriteButtonEnd).toBeLessThan(useButton);
    expect(html.slice(favoriteButton, favoriteButtonEnd)).not.toContain("캔버스에 추가");
    expect(html.slice(favoriteButton, favoriteButtonEnd)).not.toContain("관리 작업");
  });
});
