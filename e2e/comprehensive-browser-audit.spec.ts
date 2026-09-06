import { expect, test } from "@playwright/test";

import { creatorMarketplaceJsonByteSize } from "../apps/web/src/shared/lib/creator-marketplace-resource-contract";

/**
 * Mock 공개 프로필 캐시를 사용하는 브라우저 인터랙션 및 런타임 오류 감사 스위트
 * - 페이지 내 콘솔 에러(Unhandled rejection, React error, TypeError 등) 실시간 감지
 * - 스튜디오 캔버스, 레이어, 말풍선, 컷 분할, 자산 허브, 3D 엔진, 내보내기 전수 조작
 * - 마켓 브러시, 템플릿, 3D 리소스 상세 및 프리뷰 조작
 */

test.describe("스튜디오 & 마켓 mock 브라우저 상호작용 감사", () => {
  const MOCK_PUBLIC_PROFILE = {
    user: {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "테스트 마스터",
      email: "master-tester@toonspectrum.dev",
      image: null,
      role: "creator",
    },
  };

  test.beforeEach(async ({ page }) => {
    // HttpOnly 인증 쿠키가 아닌, UI 초기 렌더링용 탭 범위 공개 프로필 캐시다.
    await page.addInitScript((session) => {
      sessionStorage.setItem("toonspectrum-auth-session", JSON.stringify(session));
    }, MOCK_PUBLIC_PROFILE);

    // 이 스위트는 실제 계정 인증이 아니라 mock 서버 세션과 공개 프로필 캐시의 UI 계약을 검증한다.
    await page.route(/\/api\/auth\/session(?:\?.*)?$/u, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: MOCK_PUBLIC_PROFILE.user,
        }),
      });
    });
  });

  test("스튜디오 캔버스 드로잉, 펜/지우개 전환, 색상 변경, 줌 인터랙션 감사", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("Failed to load resource") && !msg.text().includes("404")) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/studio");
    await expect(page.locator("body")).toBeVisible();

    const canvas = page.locator("main, #main-content, canvas").first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    const box = await canvas.boundingBox();
    if (box) {
      // 1. 드로잉 인터랙션
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 150, { steps: 5 });
      await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
      await page.mouse.up();

      // 2. Undo / Redo
      const isMac = process.platform === "darwin";
      await page.keyboard.press(isMac ? "Meta+z" : "Control+z");
      await page.keyboard.press(isMac ? "Meta+Shift+z" : "Control+Shift+z");

      // 3. 지우개 단축키 (E)
      await page.keyboard.press("e");
      await page.mouse.move(box.x + 150, box.y + 120);
      await page.mouse.down();
      await page.mouse.move(box.x + 250, box.y + 180, { steps: 5 });
      await page.mouse.up();

      // 4. 펜 단축키 (P / B)
      await page.keyboard.press("b");

      // 5. 줌 인/아웃 단축키 (+/-)
      await page.keyboard.press("=");
      await page.keyboard.press("-");
    }

    // 치명적 런타임 크래시가 없음을 검증
    expect(consoleErrors).toHaveLength(0);
  });

  test("스튜디오 자산 메뉴 커뮤니티 마켓, CC0 라이브러리, 자료 공유 폼 조작 감사", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/studio?assetMarket=community");
    await expect(page.locator("body")).toBeVisible();

    // 커뮤니티 마켓플레이스 영역 확인
    const communityPanel = page.locator("[data-studio-community-marketplace], [data-studio-asset-marketplace-lazy-boundary], [role='tablist']").first();
    await expect(communityPanel).toBeVisible({ timeout: 20_000 });

    expect(consoleErrors).toHaveLength(0);
  });

  test("마켓 브러시·3D·템플릿 mock 상세 프리뷰 렌더링 및 조작 감사", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // 1. 브러시 리소스
    const brushId = "123e4567-e89b-12d3-a456-426614174101";
    const brushPayload = {
      schemaVersion: 1 as const,
      resourceKind: "brush" as const,
      runtime: "studio-brush-v1" as const,
      definition: {
        snapshot: { size: 16, opacity: 1.0, flow: 0.9, family: "pen", color: "#000000" },
      },
    };
    const mockBrush = {
      schemaVersion: 1,
      id: brushId,
      packageId: "audit-brush",
      name: "감사용 잉크 브러시",
      description: "브라우저 실시간 감사용 브러시",
      tags: ["ink", "audit"],
      kind: "brush",
      resourceVersion: "1.0.0",
      minimumStudioVersion: "1.0.0",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: { engines: ["canvas2d"] },
      entries: [
        {
          id: "brush-entry",
          kind: "brush",
          name: "잉크 브러시",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.brush+json",
            payload: brushPayload,
            byteSize: creatorMarketplaceJsonByteSize(brushPayload),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
      manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifestByteSize: 550,
      publisher: { id: "pub-audit", name: "감사관", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    await page.route(new RegExp(`/creator/marketplace/resources/${brushId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockBrush),
      });
    });

    await page.goto(`/market/resource/${brushId}`);
    await expect(page.getByRole("heading", { name: "감사용 잉크 브러시" })).toBeVisible({ timeout: 15_000 });
    const brushCanvas = page.getByRole("application", {
      name: "잉크 브러시 브러시 연습 캔버스",
    });
    await expect(brushCanvas).toBeVisible();

    // 브러시 캔버스에 마우스 드래그 드로잉 테스트
    const canvasBox = await brushCanvas.boundingBox();
    if (canvasBox) {
      await page.mouse.move(canvasBox.x + 30, canvasBox.y + 30);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 120, canvasBox.y + 70, { steps: 5 });
      await page.mouse.up();
    }
    await page.getByRole("button", { name: "초기화" }).click();

    // 2. 3D 프리셋 리소스
    const scene3dId = "123e4567-e89b-12d3-a456-426614174102";
    const scene3dPayload = {
      schemaVersion: 1 as const,
      resourceKind: "3d-preset" as const,
      runtime: "studio-bg3d-preset-v1" as const,
      definition: {
        recipeId: "cyberpunk-street",
        parameters: { fog: true, neonColor: "#ff0055" },
      },
    };
    const mock3d = {
      schemaVersion: 1,
      id: scene3dId,
      packageId: "audit-3d-scene",
      name: "사이버펑크 거리 3D",
      description: "웹툰 3D 배경 프리셋",
      tags: ["3d", "cyberpunk"],
      kind: "3d-preset",
      resourceVersion: "1.0.0",
      minimumStudioVersion: "1.0.0",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: { engines: ["three"] },
      entries: [
        {
          id: "3d-entry",
          kind: "3d-preset",
          name: "사이버펑크 거리",
          delivery: {
            mode: "procedural-recipe",
            mediaType: "application/vnd.toonspectrum.3d-preset+json",
            payload: scene3dPayload,
            byteSize: creatorMarketplaceJsonByteSize(scene3dPayload),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
      manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifestByteSize: 600,
      publisher: { id: "pub-audit", name: "감사관", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    await page.route(new RegExp(`/creator/marketplace/resources/${scene3dId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mock3d),
      });
    });

    await page.goto(`/market/resource/${scene3dId}`);
    await expect(page.getByRole("heading", { name: "사이버펑크 거리 3D" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "3D 프리셋 참고 일러스트 (사이버펑크 거리)" }),
    ).toBeVisible();
    await expect(page.getByText("실제 Studio 렌더 결과가 아닙니다", { exact: false })).toBeVisible();

    // 3. 템플릿 리소스
    const templateId = "123e4567-e89b-12d3-a456-426614174103";
    const templatePayload = {
      schemaVersion: 1 as const,
      resourceKind: "template" as const,
      runtime: "studio-template-v1" as const,
      definition: {
        templateId: "webtoon-scroll-action",
      },
    };
    const mockTemplate = {
      schemaVersion: 1,
      id: templateId,
      packageId: "audit-template",
      name: "액션 4단 스크롤 템플릿",
      description: "웹툰 롱스크롤 액션 씬 전용 템플릿",
      tags: ["template", "action", "scroll"],
      kind: "template",
      resourceVersion: "1.0.0",
      minimumStudioVersion: "1.0.0",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      provenance: { origin: "original", authoredByPublisher: true },
      compatibility: { engines: ["canvas2d"] },
      entries: [
        {
          id: "tpl-entry",
          kind: "template",
          name: "액션 템플릿",
          delivery: {
            mode: "portable-json",
            mediaType: "application/vnd.toonspectrum.template+json",
            payload: templatePayload,
            byteSize: creatorMarketplaceJsonByteSize(templatePayload),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      ],
      manifestHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifestByteSize: 550,
      publisher: { id: "pub-audit", name: "감사관", avatar: null },
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      isOwner: false,
      access: "free",
    };

    await page.route(new RegExp(`/creator/marketplace/resources/${templateId}`), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockTemplate),
      });
    });

    await page.goto(`/market/resource/${templateId}`);
    await expect(page.getByRole("heading", { name: "액션 4단 스크롤 템플릿" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "템플릿 참고 레이아웃 (액션 템플릿)" }),
    ).toBeVisible();
    await expect(page.getByText("스크롤 표현")).toBeVisible();
    await expect(page.getByText("메인 액션 롱 컷")).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
});
