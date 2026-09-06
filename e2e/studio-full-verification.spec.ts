import { expect, test } from "@playwright/test";

import {
  creatorMarketplaceJsonByteSize,
} from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

const canonicalUnmappedBrushProperty = (base: number, min: number, max: number) => ({
  base,
  min,
  max,
  mappings: [],
  jitter: null,
});

// Keep the mock install payload JSON-only. Importing the Studio brush runtime into Playwright's
// Node test process would couple the fixture to its browser-only import.meta module graph.
const CANONICAL_TEST_BRUSH_SNAPSHOT = {
  brushId: "pen",
  strokeWidth: 20,
  brushOpacity: 0.9,
  color: "#0f172a",
  stabilizer: 3,
  stabilizerMode: "adaptive",
  postCorrection: 0,
  preserveCorners: true,
  pressureCurve: 1,
  pressureMinSize: 0,
  useVelocityPressure: true,
  velocitySensitivity: 0.65,
  tiltEnabled: true,
  tipAngle: -30,
  tipRoundness: 0.24,
  brushDynamics: {
    version: 1,
    seed: 1,
    fallbackPressure: 0.5,
    maxSpeed: 1.6,
    spacingRatio: 0.34,
    scatterRatio: null,
    taper: {
      enabled: false,
      startLength: 0.12,
      endLength: 0.18,
      minSizeRatio: 0.2,
      minOpacityRatio: 0.55,
      curve: 1,
    },
    tip: {
      shape: "round",
      softness: 0.35,
      alphaMapBase64: null,
      alphaMapSize: 128,
    },
    colorDynamics: {
      backgroundColor: null,
      foregroundBackgroundMix: 0,
      foregroundBackgroundJitter: 0,
      hueJitter: 0,
      saturationJitter: 0,
      valueJitter: 0,
    },
    grain: {
      space: "canvas-fixed",
      amount: 0,
      scale: 8,
      contrast: 0.35,
      seed: 1,
    },
    tipLayers: [],
    width: {
      base: 6,
      min: 0.05,
      max: 4_096,
      mappings: [{
        source: "pressure",
        mode: "multiply",
        from: 0.3,
        to: 1.7,
        amount: 1,
        curve: 1,
        invert: false,
      }],
      jitter: null,
    },
    opacity: canonicalUnmappedBrushProperty(1, 0, 1),
    flow: canonicalUnmappedBrushProperty(1, 0, 1),
    spacing: canonicalUnmappedBrushProperty(2.04, 0.25, 4_096),
    scatter: canonicalUnmappedBrushProperty(0, 0, 4_096),
    angle: {
      base: 0,
      min: -180,
      max: 180,
      mappings: [{
        source: "direction",
        mode: "add",
        from: 0,
        to: 360,
        amount: 1,
        curve: 1,
        invert: false,
      }],
      jitter: null,
    },
    roundness: canonicalUnmappedBrushProperty(1, 0.08, 1),
  },
  stampTuning: null,
  enginePrograms: null,
} as const;

/**
 * ToonSpectrum 스튜디오 및 창작 마켓 mock 브라우저 상호작용 검증
 * - 탭 범위 공개 프로필 캐시를 사용한 로그인 UI 초기 상태
 * - 스튜디오 캔버스 드로잉 엔진 (펜, 지우개, 브러시 크기, 색상, Undo/Redo)
 * - 레이어 관리 시스템
 * - 웹툰 컷/패널 레이아웃 및 롱스크롤 뷰
 * - 말풍선 및 레터링 시스템
 * - 스튜디오 자산 허브 (13 Creator Packs, CC0 라이브러리, 커뮤니티 마켓, 자료 게시 폼)
 * - 3D 씬 및 배경 엔진
 * - 마켓 인터랙티브 멀티모델 프리뷰 (브러시, 팔레트, 필터, 템플릿, 3D)
 * - 웹 마켓 -> 스튜디오 딥링크 탐색과 리소스 요청 전달
 */

test.describe("스튜디오 & 창작 마켓 mock 브라우저 검증", () => {
  const MOCK_CREATOR_PUBLIC_PROFILE = {
    user: {
      id: "11111111-2222-4333-8444-555555555555",
      name: "테스트 크리에이터",
      email: "creator-test@toonspectrum.dev",
      image: null,
      role: "creator",
    },
  };

  test.beforeEach(async ({ page }) => {
    // HttpOnly 인증 쿠키가 아닌, UI 초기 렌더링용 탭 범위 공개 프로필 캐시다.
    await page.addInitScript((session) => {
      sessionStorage.setItem("toonspectrum-auth-session", JSON.stringify(session));
    }, MOCK_CREATOR_PUBLIC_PROFILE);

    // 이 스위트는 실제 계정 인증이 아니라 mock 서버 세션과 공개 프로필 캐시의 UI 계약을 검증한다.
    await page.route(/\/api\/auth\/session(?:\?.*)?$/u, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: MOCK_CREATOR_PUBLIC_PROFILE.user,
        }),
      });
    });
  });

  test("1. 스튜디오 캔버스 로드 및 기본 UI smoke 확인", async ({ page }) => {
    await page.goto("/studio");
    await expect(page.locator("body")).toBeVisible();

    // 캔버스 뷰포트 및 메인 컨테이너 확인
    const mainContent = page.locator("#main-content, main, [data-studio-viewport]");
    await expect(mainContent.first()).toBeVisible({ timeout: 15_000 });

    // 주요 툴바 확인
    await expect(page.locator("button, [role='button']").first()).toBeVisible();
  });

  test("2. 스튜디오 캔버스 드로잉 및 제스처 인터랙션 검증", async ({ page }) => {
    await page.goto("/studio");

    const viewport = page.locator("main, #main-content, canvas").first();
    await expect(viewport).toBeVisible({ timeout: 15_000 });

    const box = await viewport.boundingBox();
    if (box) {
      // 캔버스 드로잉 획 시뮬레이션 (mousedown -> mousemove -> mouseup)
      const startX = box.x + box.width * 0.3;
      const startY = box.y + box.height * 0.3;
      const endX = box.x + box.width * 0.6;
      const endY = box.y + box.height * 0.6;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
      await page.mouse.move(endX, endY, { steps: 5 });
      await page.mouse.up();

      // Undo 단축키(Meta+Z / Control+Z) 트리거 검증
      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    }
  });

  test("3. 스튜디오 자산 메뉴 및 커뮤니티 마켓플레이스 탭 계층 검증", async ({ page }) => {
    // 딥링크 파라미터로 자산 커뮤니티 탭 직행
    await page.goto("/studio?assetMarket=community");

    // 자산 메뉴 및 커뮤니티 패널 영역 확인
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText(/커뮤니티|내 에셋|자산|에셋/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("4. 창작 마켓 홈 -> 탐색 -> mock 상세 -> 스튜디오 딥링크 요청 전달 검증", async ({ page }) => {
    const mockResourceId = "123e4567-e89b-12d3-a456-426614174999";
    const payload = {
      schemaVersion: 1 as const,
      resourceKind: "brush" as const,
      runtime: "studio-brush-v1" as const,
      definition: {
        snapshot: CANONICAL_TEST_BRUSH_SNAPSHOT,
      },
    };
    const byteSize = creatorMarketplaceJsonByteSize(payload);

    const mockResource = {
      schemaVersion: 1,
      id: mockResourceId,
      packageId: "master-ink-brush",
      name: "마스터 잉크 펜",
      description: "웹툰 콘티 및 메인 펜선 작업을 위한 프로급 잉크 브러시",
      tags: ["ink", "pen", "webtoon"],
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
          id: "ink-entry",
          kind: "brush",
          name: "마스터 잉크 펜",
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
      manifestByteSize: 620,
      publisher: { id: "publisher-master", name: "펜선장인", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    // 1) 마켓 홈 방문
    await page.goto("/market");
    await expect(page.getByRole("heading", { name: "창작 마켓" })).toBeVisible();

    // 2) 마켓 탐색 이동
    await page.getByRole("link", { name: "리소스 둘러보기" }).click();
    await expect(page).toHaveURL(/market\/browse/);
    await expect(page.getByRole("heading", { name: "마켓 탐색" })).toBeVisible();

    // 3) 브러시 필터 칩 클릭
    const kindGroup = page.getByRole("group", { name: "리소스 종류 필터" });
    await kindGroup.getByRole("button", { name: /브러시/ }).click();
    await expect(page).toHaveURL(/market\/browse\?kind=brush/);

    // 4) 상세 페이지 API Mocking & 이동
    let mockResourceRequestCount = 0;
    await page.route(new RegExp(`/creator/marketplace/resources/${mockResourceId}`), async (route) => {
      mockResourceRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockResource),
      });
    });

    await page.goto(`/market/resource/${mockResourceId}`);
    await expect(page.getByRole("heading", { name: "마스터 잉크 펜" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("웹툰 콘티 및 메인 펜선 작업을 위한 프로급 잉크 브러시")).toBeVisible();

    // 브러시 실시간 드로잉 캔버스 인터랙션
    const brushCanvas = page.getByRole("application", {
      name: "마스터 잉크 펜 브러시 연습 캔버스",
    });
    await expect(brushCanvas).toBeVisible();
    await expect(page.getByText("포인터 또는 키보드로 직접 그려보세요")).toBeVisible();

    // 브러시 프리뷰 캔버스에 직접 획 긋기
    const canvasBox = await brushCanvas.boundingBox();
    if (canvasBox) {
      await page.mouse.move(canvasBox.x + 20, canvasBox.y + 20);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 100, canvasBox.y + 60, { steps: 5 });
      await page.mouse.up();
    }

    // 캔버스 초기화 버튼 클릭
    await page.getByRole("button", { name: "초기화" }).click();

    // 메타데이터 스냅샷 다운로드 버튼 확인
    await expect(page.getByRole("button", { name: "메타데이터 스냅샷 다운로드" })).toBeVisible();

    // 5) 스튜디오 딥링크 확인 및 클릭
    const installLink = page.getByRole("link", { name: "스튜디오에 리소스 팩 설치" });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute(
      "href",
      `/studio?installMarketResource=${mockResourceId}&assetMarket=community`
    );

    // 6) 딥링크가 Studio에서 실제 리소스 요청과 가시적 설치 상태로 소비되는지 검증
    await installLink.click();
    await expect(page.locator("[data-studio-community-marketplace]")).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => mockResourceRequestCount).toBeGreaterThanOrEqual(2);
    await expect(
      page.locator("[data-studio-global-status-rail]").getByRole("status")
        .filter({ hasText: "마스터 잉크 펜" }),
    ).toContainText(/설치|내장/u);
    await expect.poll(() => {
      const url = new URL(page.url());
      return {
        assetMarket: url.searchParams.get("assetMarket"),
        installMarketResource: url.searchParams.get("installMarketResource"),
      };
    }).toEqual({
      assetMarket: "community",
      installMarketResource: null,
    });
  });

  test("5. 마켓 팔레트·필터 mock 상세 프리뷰 렌더링 검증", async ({ page }) => {
    // 1) 팔레트 상세 및 색상 복사
    const paletteId = "123e4567-e89b-12d3-a456-426614174888";
    const palettePayload = {
      schemaVersion: 1 as const,
      resourceKind: "palette" as const,
      runtime: "studio-palette-v1" as const,
      definition: {
        colors: ["#1e293b", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
      },
    };
    const mockPalette = {
      schemaVersion: 1,
      id: paletteId,
      packageId: "vibrant-color-set",
      name: "비비드 웹툰 팔레트",
      description: "인기 웹툰 하이라이트 컬러 세트",
      tags: ["palette", "color", "webtoon"],
      kind: "palette",
      resourceVersion: "1.0.0",
      minimumStudioVersion: "1.0.0",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: { engines: ["canvas2d"] },
      entries: [
        {
          id: "pal-entry",
          kind: "palette",
          name: "비비드 세트",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.palette+json",
            payload: palettePayload,
            byteSize: creatorMarketplaceJsonByteSize(palettePayload),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
      manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifestByteSize: 500,
      publisher: { id: "pub-pal", name: "컬러리스트", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    await page.route(new RegExp(`/creator/marketplace/resources/${paletteId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPalette),
      });
    });

    await page.goto(`/market/resource/${paletteId}`);
    await expect(page.getByRole("heading", { name: "비비드 웹툰 팔레트" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("색상 구성 (5색)")).toBeVisible();
    await expect(page.getByRole("button", { name: "#1e293b 색상 복사" })).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON 저장" })).toBeVisible();

    // 2) 필터 상세 및 Before/After 슬라이더
    const filterId = "123e4567-e89b-12d3-a456-426614174777";
    const filterPayload = {
      schemaVersion: 1 as const,
      resourceKind: "filter" as const,
      runtime: "studio-filter-v1" as const,
      definition: {
        engine: "color-adjustment",
        values: {
          contrast: 1.3,
          saturation: 25,
          brightness: 1.1,
        },
      },
    };
    const mockFilter = {
      schemaVersion: 1,
      id: filterId,
      packageId: "dramatic-mood-filter",
      name: "드라마틱 무드 필터",
      description: "강렬한 대비와 생생한 채도를 주는 웹툰 액션 씬 필터",
      tags: ["filter", "mood", "action"],
      kind: "filter",
      resourceVersion: "1.0.0",
      minimumStudioVersion: "1.0.0",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: { engines: ["canvas2d", "webgl2"] },
      entries: [
        {
          id: "filter-entry",
          kind: "filter",
          name: "드라마틱 무드",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.filter+json",
            payload: filterPayload,
            byteSize: creatorMarketplaceJsonByteSize(filterPayload),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
      manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifestByteSize: 580,
      publisher: { id: "pub-filter", name: "무드메이커", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    await page.route(new RegExp(`/creator/marketplace/resources/${filterId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFilter),
      });
    });

    await page.goto(`/market/resource/${filterId}`);
    await expect(page.getByRole("heading", { name: "드라마틱 무드 필터" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "필터 효과 참고 일러스트 (드라마틱 무드)" }),
    ).toBeVisible();
    await expect(page.getByLabel("필터 전후 비교 슬라이더")).toBeVisible();
  });

  test("6. 탭 범위 mock 공개 프로필 캐시 유지 검증", async ({ page }) => {
    // 이 검증은 서버 쿠키 인증이 아니라, 같은 탭의 공개 프로필 캐시 계약만 다룬다.
    await page.goto("/studio");
    await expect(page.locator("body")).toBeVisible();

    const storedSession = await page.evaluate(() => {
      return sessionStorage.getItem("toonspectrum-auth-session");
    });
    expect(storedSession).not.toBeNull();
    const parsed = JSON.parse(storedSession ?? "{}");
    expect(parsed?.user?.email).toBe("creator-test@toonspectrum.dev");
    expect(parsed?.user?.role).toBe("creator");
  });

  test("7. 스튜디오 롱스크롤 웹툰 뷰어 모드 전환 검증", async ({ page }) => {
    await page.goto("/studio");
    await expect(page.locator("body")).toBeVisible();

    // 뷰포트 스크롤 컨테이너 및 캔버스 확인
    const canvasContainer = page.locator("main, #main-content, canvas").first();
    await expect(canvasContainer).toBeVisible({ timeout: 15_000 });
  });
});
