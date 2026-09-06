import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resolveStudioCommunityMarketplaceInitialView } from "./studio-community-marketplace-view";
import { StudioCommunityMarketplacePanel } from "./StudioCommunityMarketplacePanel";

import { useI18n } from "@/shared/lib/i18n";

const source = readFileSync(
  new URL("./StudioCommunityMarketplacePanel.tsx", import.meta.url),
  "utf8",
);
const lifecycleSource = readFileSync(
  new URL("./StudioCommunityMarketplaceLifecycle.tsx", import.meta.url),
  "utf8",
);
const cloudSyncSource = readFileSync(
  new URL("./studio-community-marketplace-cloud-sync.ts", import.meta.url),
  "utf8",
);
const assetMenuSource = readFileSync(
  new URL("./StudioAssetMenuPanel.tsx", import.meta.url),
  "utf8",
);
const assetPopoverSource = readFileSync(
  new URL("./StudioAssetToolPopoverBody.tsx", import.meta.url),
  "utf8",
);

describe("StudioCommunityMarketplacePanel", () => {
  beforeEach(() => {
    useI18n.getState().setLang("ko");
  });

  it("collapsed 상태에서는 서버 요청 UI를 지연하고 온라인 경계를 정확히 설명한다", () => {
    const html = renderToStaticMarkup(<StudioCommunityMarketplacePanel />);

    expect(html).toContain("온라인 Creator 공유");
    expect(html).toContain("공개 탐색 · 실제 설치 · 내 자료 게시");
    expect(html).not.toContain("온라인 공유 보기");
    expect(html).not.toContain("무료 공유 마켓에 게시");
  });

  it("공개·계정 보관함·내 공유·자료 게시 탭과 모든 공통 리소스 종류를 노출한다", () => {
    const html = renderToStaticMarkup(
      <StudioCommunityMarketplacePanel initialOpen onUseAsset={() => true} />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="');
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain("공개 마켓");
    expect(html).toContain("계정 보관함");
    expect(html).toContain("내 공유");
    expect(html).toContain("자료 게시");
    for (const label of ["에셋", "브러시", "필터", "팔레트", "템플릿", "3D"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("이름·설명·태그 검색");
    expect(html).toContain("검색");
    expect(source).not.toContain("<h5");
    expect(source).toContain('<h3 className="text-[0.7rem] font-black text-fg">');
  });

  it("share 딥링크는 패널을 연 채 자료 게시 탭을 최초 선택한다", () => {
    const searchParams = new URLSearchParams(
      "assetMarket=community&communityView=share",
    );
    const html = renderToStaticMarkup(
      <StudioCommunityMarketplacePanel
        initialOpen={searchParams.get("assetMarket") === "community"}
        initialView={resolveStudioCommunityMarketplaceInitialView(searchParams)}
        onUseAsset={() => true}
      />,
    );

    expect(html).toMatch(/<details open=""[^>]*>/u);
    expect(html).toMatch(
      /role="tab" aria-selected="true"[^>]*>자료 게시<\/button>/u,
    );
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("무료 공유 마켓에 게시");
    expect(html).toContain("릴리스 버전 (SemVer)");
    expect(html).toContain('maxLength="40"');
    expect(html).not.toContain("이름·설명·태그 검색");
  });

  it("communityView를 읽을 때 다른 Studio query를 변경하지 않는다", () => {
    const searchParams = new URLSearchParams(
      "room=live-1&assetMarket=community&communityView=share&titleId=title-1",
    );
    const originalSearch = searchParams.toString();

    expect(resolveStudioCommunityMarketplaceInitialView(searchParams)).toBe("share");
    expect(searchParams.toString()).toBe(originalSearch);

    expect(resolveStudioCommunityMarketplaceInitialView(
      new URLSearchParams("communityView=library"),
    )).toBe("library");
  });

  it("실제 서버 목록·게시·소유자 delist와 로컬 설치·제거 경로를 연결한다", () => {
    expect(source).toContain("listCreatorMarketplaceResources");
    expect(source).toContain("listCreatorMarketplaceOwnedHeads");
    expect(source).toContain("listCreatorMarketplaceCloudLibrary");
    expect(source).toContain("synchronizeStudioCommunityMarketplaceInstalledPack");
    expect(cloudSyncSource).toContain("confirmCreatorMarketplaceStudioInstall");
    expect(source).toContain("setCreatorMarketplaceCloudLibraryArchived");
    expect(source).toContain("publishCreatorMarketplaceResource");
    expect(source).toContain("deleteCreatorMarketplaceResource");
    expect(source).toContain("installStudioCreatorPack");
    expect(source).toContain("uninstallStudioCreatorPack");
    expect(source).toContain("projectCreatorMarketplaceRecordToAssets");
    expect(source).toContain("createStudioOriginalFreeAssetRecord");
    expect(source).toContain("CreatorMarketplaceReportAction");
    expect(lifecycleSource).toContain("StudioOwnedReleaseLifecycleActions");
    expect(lifecycleSource).toContain("목록에서 내리기");
    expect(lifecycleSource).toContain("다시 공개");
    expect(lifecycleSource).toContain("listCreatorMarketplaceOwnedHistory");
    expect(source).toContain('|| projection.pack.metadata.kind === "palette"');
  });

  it("권리·AI·라이선스 확인 없이 게시할 수 없고 가짜 성공을 표시하지 않는다", () => {
    expect(source).toContain("studio.community.share.ownershipStatement");
    expect(source).toContain("studio.community.share.derivativeStatement");
    expect(source).toContain("studio.community.share.aiIncludedLabel");
    expect(source).toContain("attributionRequired");
    expect(source).toContain("const ready = Boolean(candidate)");
    expect(source).toContain("resourceVersionValid");
    expect(source).toContain("resourceVersion: normalizedResourceVersion");
    expect(source).toContain("await publishCreatorMarketplaceResource(manifest)");
    expect(source).toContain("await deleteCreatorMarketplaceResource(record.id)");
    expect(source).toContain("비공개 릴리스 이력은 내 공유 목록에 유지됩니다");
    expect(source).toContain("releaseNotes");
  });

  it("에셋 메뉴가 커뮤니티 활성화 뒤 패널을 지연 로드하고 캔버스 삽입 콜백을 전달한다", () => {
    expect(assetMenuSource).not.toContain(
      'from "./StudioCommunityMarketplacePanel"',
    );
    expect(assetMenuSource).toContain(
      'import("./StudioCommunityMarketplacePanel")',
    );
    expect(assetMenuSource).toContain("<LazyStudioCommunityMarketplacePanel");
    expect(assetMenuSource).toContain("initialOpen");
    expect(assetMenuSource).toContain("initialView={initialView}");
    expect(assetMenuSource).toContain("onUseAsset={onUseLocalAsset}");
    expect(assetPopoverSource).toContain(
      "useStudioCommunityMarketplaceInitialView()",
    );
    expect(assetPopoverSource).toContain(
      "communityMarketplaceInitialView={communityMarketplaceInitialView}",
    );
  });
});
