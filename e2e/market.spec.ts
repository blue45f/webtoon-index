import { expect, test } from "@playwright/test";

import {
  creatorMarketplaceJsonByteSize,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

import type {
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

/**
 * 창작 마켓 E2E 테스트 — 공개 라우트, 인터랙티브 프리뷰(브러시, 팔레트, 필터, 템플릿, 3D), 스튜디오 딥링크 연동을 철저히 검증한다.
 */

const KIND_HREFS = [
  "/market/browse?kind=brush",
  "/market/browse?kind=filter",
  "/market/browse?kind=palette",
  "/market/browse?kind=template",
  "/market/browse?kind=3d-preset",
  "/market/browse?kind=3d-asset",
  "/market/browse?kind=asset",
];

function mockBuiltinResource(input: {
  readonly id: string;
  readonly kind: Extract<CreatorMarketplaceResourceKind, "asset" | "template" | "3d-preset">;
  readonly packageId: string;
  readonly name: string;
  readonly description: string;
  readonly entries: readonly { readonly name: string; readonly runtimeRef: string }[];
}): CreatorMarketplaceResourceRecord {
  return {
    schemaVersion: 1,
    id: input.id,
    packageId: input.packageId,
    name: input.name,
    description: input.description,
    tags: [input.kind, "e2e"],
    kind: input.kind,
    resourceVersion: "1.2.0",
    minimumStudioVersion: "1.0.0",
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: {
      engines: input.kind === "3d-preset" ? ["webgl2", "three"] : ["canvas2d"],
    },
    entries: input.entries.map((entry, index) => ({
      id: `${input.kind}/e2e-${index + 1}`,
      kind: input.kind,
      name: entry.name,
      delivery: {
        mode: "builtin-ref",
        runtimeRef: entry.runtimeRef,
        byteSize: 0,
        sha256: String(index + 1).repeat(64),
      },
    })),
    manifestHash: "f".repeat(64),
    manifestByteSize: 768,
    publisher: {
      id: "123e4567-e89b-42d3-a456-426614174299",
      name: "E2E 검증 작가",
      avatar: null,
    },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

async function routeMarketDetail(
  page: import("@playwright/test").Page,
  record: CreatorMarketplaceResourceRecord,
): Promise<void> {
  await page.route(
    /\/api\/creator\/marketplace\/resources(?:\?.*)?$/u,
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], limit: 5, hasMore: false, nextCursor: null }),
    }),
  );
  await page.route(
    new RegExp(`/creator/marketplace/resources/history/${record.id}(?:\\?.*)?$`),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        packageId: record.packageId,
        anchor: {
          id: record.id,
          resourceVersion: record.resourceVersion,
          listed: true,
        },
        items: [{
          id: record.id,
          releaseOrdinal: 2,
          name: record.name,
          resourceVersion: record.resourceVersion,
          minimumStudioVersion: record.minimumStudioVersion,
          releaseNotes: "E2E 공개 릴리스 노트",
          manifestHash: record.manifestHash,
          createdAt: record.createdAt,
          selected: true,
        }],
        limit: 8,
        hasMore: false,
        nextCursor: null,
      }),
    }),
  );
  await page.route(
    new RegExp(`/creator/marketplace/resources/${record.id}(?:\\?.*)?$`),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(record),
    }),
  );
}

test("마켓 홈은 카테고리 6종과 CTA를 렌더링한다", async ({ page }) => {
  await page.goto("/market");
  await expect(page.getByRole("heading", { name: "창작 마켓" })).toBeVisible();
  await expect(page.getByRole("link", { name: "리소스 둘러보기" })).toBeVisible();
  await expect(page.getByRole("link", { name: "스튜디오에서 공유하기" })).toBeVisible();

  for (const href of KIND_HREFS) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  await expect(page).toHaveTitle(/창작 마켓|Creator Market/);
});

test("마켓 탐색은 종류 칩 필터와 라이선스 필터를 제공한다", async ({ page }) => {
  await page.goto("/market/browse");
  await expect(page.getByRole("heading", { name: "마켓 탐색" })).toBeVisible();

  const kindGroup = page.getByRole("group", { name: "리소스 종류 필터" });
  await expect(kindGroup.getByRole("button", { name: "전체" })).toBeVisible();
  for (const label of ["브러시", "필터", "팔레트", "템플릿", "3D 프리셋", "3D 에셋", "에셋"]) {
    await expect(kindGroup.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  const licenseGroup = page.getByRole("group", { name: "라이선스 필터" });
  await expect(licenseGroup.getByRole("button", { name: "전체 라이선스" })).toBeVisible();
});

test("배급자·검색·종류·라이선스 조건을 API에 전달하고 한 번에 초기화한다", async ({ page }) => {
  const publisherId = "123e4567-e89b-42d3-a456-426614174210";
  const observedRequests: URL[] = [];
  await page.route(
    /\/api\/creator\/marketplace\/resources(?:\?.*)?$/u,
    async (route) => {
      const url = new URL(route.request().url());
      observedRequests.push(url);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          limit: Number(url.searchParams.get("limit") ?? "12"),
          hasMore: false,
          nextCursor: null,
        }),
      });
    },
  );

  await page.goto(
    `/market/browse?publisher=${publisherId}&q=${encodeURIComponent("잉크")}`
      + "&tag=lineart&kind=brush&license=cc0-1.0",
  );
  await expect(page.getByRole("heading", { name: "마켓 탐색" })).toBeVisible();
  await expect(page.getByLabel("마켓 리소스 검색")).toHaveValue("잉크");
  await expect(page.getByRole("combobox", { name: "정렬 기준" })).toHaveValue(
    "relevance",
  );
  const publisherFilter = page.getByRole("button", {
    name: "배급자: 선택한 배급자 필터 제거",
  });
  await expect(publisherFilter).toContainText("선택한 배급자");
  await expect(publisherFilter).not.toContainText(publisherId);
  await expect(
    page.getByRole("group", { name: "리소스 종류 필터" })
      .getByRole("button", { name: /브러시/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => observedRequests.length).toBeGreaterThan(0);

  const filteredRequest = observedRequests.at(-1)!;
  expect(filteredRequest.searchParams.get("publisher")).toBe(publisherId);
  expect(filteredRequest.searchParams.get("search")).toBe("잉크");
  expect(filteredRequest.searchParams.get("tag")).toBe("lineart");
  expect(filteredRequest.searchParams.get("kind")).toBe("brush");
  expect(filteredRequest.searchParams.get("license")).toBe("cc0-1.0");
  expect(filteredRequest.searchParams.get("sort")).toBe("relevance");

  const requestCountBeforeSort = observedRequests.length;
  await page.getByRole("combobox", { name: "정렬 기준" }).selectOption("newest");
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("newest");
  await expect.poll(() => observedRequests.length).toBeGreaterThan(requestCountBeforeSort);
  expect(observedRequests.at(-1)?.searchParams.get("sort")).toBe("newest");

  const requestCountBeforeReset = observedRequests.length;
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await expect(page).toHaveURL(/\/market\/browse$/u);
  await expect(page.getByLabel("마켓 리소스 검색")).toHaveValue("");
  await expect(page.getByRole("button", { name: /배급자: .* 필터 제거/u })).toHaveCount(0);
  await expect.poll(() => observedRequests.length).toBeGreaterThan(requestCountBeforeReset);

  const resetRequest = observedRequests.at(-1)!;
  for (const parameter of ["publisher", "search", "tag", "kind", "license"]) {
    expect(resetRequest.searchParams.has(parameter)).toBe(false);
  }
  expect(resetRequest.searchParams.get("sort")).toBe("newest");
});

test("마켓 홈에서 선택한 종류 조건은 브라우저 뒤로·앞으로 이동 후 복원된다", async ({ page }) => {
  await page.route(
    /\/api\/creator\/marketplace\/resources(?:\?.*)?$/u,
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], limit: 12, hasMore: false, nextCursor: null }),
    }),
  );

  await page.goto("/market");
  await page.getByRole("link", { name: "리소스 둘러보기" }).click();
  const kindGroup = page.getByRole("group", { name: "리소스 종류 필터" });
  await kindGroup.getByRole("button", { name: /브러시/ }).click();
  await expect(page).toHaveURL(/\/market\/browse\?kind=brush$/u);

  await page.goBack();
  await expect(page).toHaveURL(/\/market$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/market\/browse\?kind=brush$/u);
  await expect(
    page.getByRole("group", { name: "리소스 종류 필터" })
      .getByRole("button", { name: /브러시/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("종류 칩은 URL 파라미터를 갱신한다", async ({ page }) => {
  await page.goto("/market/browse");
  const kindGroup = page.getByRole("group", { name: "리소스 종류 필터" });
  await kindGroup.getByRole("button", { name: /브러시/ }).click();
  await expect(page).toHaveURL(/market\/browse\?kind=brush$/);
  await expect(kindGroup.getByRole("button", { name: /브러시/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("없는 리소스 상세는 404 안내 또는 오류 상태로 흐름 제어한다", async ({ page }) => {
  await page.goto("/market/resource/123e4567-e89b-42d3-a456-426614174000");
  await expect(page.getByRole("link", { name: "마켓으로 돌아가기" })).toBeVisible();
  await expect(
    page.getByText(/리소스를 찾을 수 없어요|불러올 수 없어요|불러오지 못했습니다/)
  ).toBeVisible({ timeout: 15_000 });
});

test("리소스 상세 페이지에서 브러시 인터랙티브 캔버스를 렌더링한다", async ({ page }) => {
  const resourceId = "123e4567-e89b-12d3-a456-426614174001";
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: "brush" as const,
    runtime: "studio-brush-v1" as const,
    definition: {
      snapshot: {
        size: 14,
        opacity: 0.95,
        flow: 0.9,
        family: "pen",
        color: "#1e293b",
      },
    },
  };
  const byteSize = creatorMarketplaceJsonByteSize(payload);

  const mockBrushResource = {
    schemaVersion: 1,
    id: resourceId,
    packageId: "toon-ink-gpen",
    name: "먹물 G펜 프로",
    description: "웹툰 인물 펜선용 고감도 잉크 브러시",
    tags: ["ink", "gpen", "lineart"],
    kind: "brush",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d", "webgpu"] },
    entries: [
      {
        id: "gpen-entry",
        kind: "brush",
        name: "먹물 G펜",
        delivery: {
          mode: "portable-json",
          mediaType: "application/vnd.toonspectrum.brush+json",
          payload,
          byteSize,
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    ],
    manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    manifestByteSize: 680,
    publisher: { id: "publisher-1", name: "김작가", avatar: null },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };

  await page.route(new RegExp(`/creator/marketplace/resources/${resourceId}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockBrushResource),
    });
  });

  await page.goto(`/market/resource/${resourceId}`);
  await expect(page.getByRole("heading", { name: "먹물 G펜 프로" })).toBeVisible();
  await expect(page.getByText("웹툰 인물 펜선용 고감도 잉크 브러시")).toBeVisible();
  await expect(page.getByRole("link", { name: "스튜디오에 리소스 팩 설치" })).toBeVisible();
  await expect(page.getByRole("button", { name: "메타데이터 스냅샷 다운로드" })).toBeVisible();

  // 브러시 캔버스 프리뷰 확인
  await expect(
    page.getByRole("application", { name: "먹물 G펜 브러시 연습 캔버스" }),
  ).toBeVisible();
  await expect(page.getByText("포인터 또는 키보드로 직접 그려보세요")).toBeVisible();
});

test("리소스 상세 페이지에서 팔레트 스와치와 색상 복사 인터랙션을 렌더링한다", async ({ page }) => {
  const resourceId = "123e4567-e89b-12d3-a456-426614174002";
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: "palette" as const,
    runtime: "studio-palette-v1" as const,
    definition: {
      colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
    },
  };
  const byteSize = creatorMarketplaceJsonByteSize(payload);

  const mockPaletteResource = {
    schemaVersion: 1,
    id: resourceId,
    packageId: "sunset-webtoon-palette",
    name: "노을빛 로맨스 팔레트",
    description: "황혼 시간대 로맨스 판타지 웹툰 전용 컬러 세트",
    tags: ["sunset", "palette", "romance"],
    kind: "palette",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    license: "cc-by-4.0",
    attributionText: "Created by ColorMaster",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [
      {
        id: "sunset-entry",
        kind: "palette",
        name: "노을빛 세트",
        delivery: {
          mode: "portable-json",
          mediaType: "application/vnd.toonspectrum.palette+json",
          payload,
          byteSize,
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    ],
    manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    manifestByteSize: 520,
    publisher: { id: "publisher-2", name: "ColorMaster", avatar: null },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };

  await page.route(new RegExp(`/creator/marketplace/resources/${resourceId}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPaletteResource),
    });
  });

  await page.goto(`/market/resource/${resourceId}`);
  await expect(page.getByRole("heading", { name: "노을빛 로맨스 팔레트" })).toBeVisible();
  await expect(page.getByText("색상 구성 (5색)")).toBeVisible();
  await expect(page.getByRole("button", { name: "#3b82f6 색상 복사" })).toBeVisible();
  await expect(page.getByRole("button", { name: "JSON 저장" })).toBeVisible();
});

test("리소스 상세 페이지에서 필터 전후 슬라이더를 렌더링한다", async ({ page }) => {
  const resourceId = "123e4567-e89b-12d3-a456-426614174003";
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: "filter" as const,
    runtime: "studio-filter-v1" as const,
    definition: {
      engine: "color-adjustment",
      values: {
        contrast: 1.25,
        saturation: 20,
        brightness: 1.05,
      },
    },
  };
  const byteSize = creatorMarketplaceJsonByteSize(payload);

  const mockFilterResource = {
    schemaVersion: 1,
    id: resourceId,
    packageId: "cinematic-film-filter",
    name: "시네마틱 필름 룩",
    description: "웹툰 썸네일 및 드라마틱 씬을 위한 시네마틱 톤 보정 필터",
    tags: ["filter", "cinematic", "tone"],
    kind: "filter",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    license: "toonspectrum-standard",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d", "webgl2", "webgpu"] },
    entries: [
      {
        id: "cinematic-entry",
        kind: "filter",
        name: "시네마틱 필름",
        delivery: {
          mode: "portable-json",
          mediaType: "application/vnd.toonspectrum.filter+json",
          payload,
          byteSize,
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    ],
    manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    manifestByteSize: 620,
    publisher: { id: "publisher-3", name: "필터장인", avatar: null },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };

  await page.route(new RegExp(`/creator/marketplace/resources/${resourceId}`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockFilterResource),
    });
  });

  await page.goto(`/market/resource/${resourceId}`);
  await expect(page.getByRole("heading", { name: "시네마틱 필름 룩" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "필터 효과 참고 일러스트 (시네마틱 필름)" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "필터 적용 예시와 원본 일러스트 비교" })).toBeVisible();
  await expect(page.getByText("실제 Studio 렌더가 아닌", { exact: false })).toBeVisible();
  await expect(page.getByLabel("필터 전후 비교 슬라이더")).toBeVisible();
});

test("에셋 상세는 비어 있는 표지 대신 실제 Studio 적용 정보를 공개한다", async ({ page }) => {
  const record = mockBuiltinResource({
    id: "623e4567-e89b-42d3-a456-426614174001",
    kind: "asset",
    packageId: "e2e/asset/cafe-tray-set",
    name: "카페 트레이 소품 세트",
    description: "Studio 내장 에셋 적용 경계를 검증합니다.",
    entries: [{ name: "카페 트레이", runtimeRef: "studio-asset:cafe-tray-set" }],
  });
  await routeMarketDetail(page, record);

  await page.goto(`/market/resource/${record.id}`);

  await expect(page.getByRole("heading", { name: record.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "에셋 적용 정보 · 카페 트레이" })).toBeVisible();
  await expect(page.getByText("studio-asset:cafe-tray-set")).toBeVisible();
  await expect(page.getByRole("link", { name: "스튜디오 캔버스에 에셋 삽입" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "버전 및 릴리스 노트" })).toBeVisible();
  await expect(page.getByText("E2E 공개 릴리스 노트")).toBeVisible();
  await expect(page.getByRole("link", { name: `v${record.resourceVersion}` })).toHaveAttribute(
    "href",
    `/market/resource/${record.id}`,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/market/resource/${record.id}$`),
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(record.name));
});

test("다중 템플릿 상세는 키보드 탭 이동으로 모든 패키지 항목을 미리본다", async ({ page }) => {
  const record = mockBuiltinResource({
    id: "623e4567-e89b-42d3-a456-426614174002",
    kind: "template",
    packageId: "e2e/template/story-layouts",
    name: "스토리 레이아웃 묶음",
    description: "여러 장면 템플릿을 빠짐없이 검증합니다.",
    entries: [
      { name: "세로 스크롤", runtimeRef: "studio-scene-template:vertical-story" },
      { name: "두 번째 4컷", runtimeRef: "studio-scene-template:4cut-story" },
    ],
  });
  await routeMarketDetail(page, record);

  await page.goto(`/market/resource/${record.id}`);

  const tabs = page.getByRole("tablist", { name: "미리볼 패키지 항목" });
  const firstTab = tabs.getByRole("tab", { name: "세로 스크롤" });
  const secondTab = tabs.getByRole("tab", { name: "두 번째 4컷" });
  await expect(firstTab).toHaveAttribute("aria-selected", "true");
  await firstTab.focus();
  await firstTab.press("ArrowRight");
  await expect(secondTab).toBeFocused();
  await expect(secondTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "템플릿 참고 레이아웃 (두 번째 4컷)" }),
  ).toBeVisible();
  await expect(page.getByText("ID: studio-scene-template:4cut-story")).toBeVisible();
});

test("모바일 3D 상세는 긴 recipe와 package ID에서도 수평 오버플로가 없다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const longSegment = "procedural-city-block-with-lighting-and-camera-".repeat(2);
  const record = mockBuiltinResource({
    id: "623e4567-e89b-42d3-a456-426614174003",
    kind: "3d-preset",
    packageId: `e2e/3d/${longSegment}`,
    name: "절차형 도시 블록",
    description: "긴 식별자의 모바일 상세 레이아웃을 검증합니다.",
    entries: [{
      name: "도시 블록과 카메라",
      runtimeRef: `studio-bg3d-preset:${longSegment}`,
    }],
  });
  await routeMarketDetail(page, record);

  await page.goto(`/market/resource/${record.id}`);

  await expect(
    page.getByRole("heading", { name: "3D 프리셋 참고 일러스트 (도시 블록과 카메라)" }),
  ).toBeVisible();
  await expect(page.getByText(`레시피: studio-bg3d-preset:${longSegment}`)).toBeVisible();
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - window.innerWidth,
    document: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.document).toBeLessThanOrEqual(0);
});

test("스튜디오 마켓 딥링크 진입 시 커뮤니티 탭이 활성화된다", async ({ page }) => {
  await page.goto("/studio?assetMarket=community");
  await expect(page.locator("[data-studio-asset-marketplace-lazy-boundary]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-studio-community-marketplace]")).toBeVisible();
});
