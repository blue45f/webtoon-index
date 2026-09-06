// @vitest-environment jsdom

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CharacterShaperLandingPage } from "./CharacterShaperLandingPage";

const SLOT_LABELS = [
  "얼굴형",
  "눈",
  "눈동자",
  "코",
  "입",
  "귀",
  "헤어",
  "체형",
  "상의",
  "하의",
  "신발",
  "액세서리",
  "표정",
  "포즈",
  "손 포즈",
];

function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function readAppLocale(locale: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const namespace of readdirSync(path.resolve(process.cwd(), "apps/web/public/i18n/app"))) {
    const file = path.resolve(process.cwd(), "apps/web/public/i18n/app", namespace, `${locale}.json`);
    try { Object.assign(merged, JSON.parse(readFileSync(file, "utf8"))); } catch { /* namespace has no locale */ }
  }
  return merged;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/shaper"]}>
      <CharacterShaperLandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="description" content="기본 설명">
    <link rel="canonical" href="https://www.toonstudio.cloud/">
    <meta property="og:title" content="기본 제목">
    <meta property="og:url" content="https://www.toonstudio.cloud/">
  `;
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
});

describe("CharacterShaperLandingPage", () => {
  it("opens with the hero headline and both calls to action", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "프리셋으로 시작하는 3D 웹툰 캐릭터" }),
    ).toBeTruthy();

    // 히어로와 마무리 CTA 모두 실제 도구(/studio/character)로 보낸다.
    const openLinks = screen.getAllByRole("link", { name: "스튜디오에서 열기" });
    expect(openLinks.length).toBe(2);
    for (const link of openLinks) expect(link.getAttribute("href")).toBe("/studio/character");

    expect(screen.getByRole("link", { name: "사용 가이드" }).getAttribute("href")).toBe("#how-to");
    expect(screen.getByRole("img", { name: /슬롯 카드에 둘러싸인 3D 캐릭터/ })).toBeTruthy();
  });

  it("names every slot, walks five numbered steps, and lists the shortcuts", () => {
    const { container } = renderPage();

    for (const slot of SLOT_LABELS) {
      expect(screen.getAllByText(slot, { exact: false }).length, slot).toBeGreaterThan(0);
    }

    const howTo = container.querySelector<HTMLElement>("#how-to");
    expect(howTo).not.toBeNull();
    expect(within(howTo!).getByRole("heading", { level: 2 }).textContent).toBe("다섯 단계로 첫 캐릭터 만들기");
    const steps = howTo!.querySelectorAll("ol > li");
    expect(steps.length).toBe(5);
    expect(steps[0]?.textContent).toContain("모델 고르기");
    expect(steps[4]?.textContent).toContain("투명 PNG·PSD 출력");
    // 각 단계는 설명과 팁을 함께 싣는다.
    expect(howTo!.textContent?.match(/팁/g)?.length).toBe(5);

    const table = screen.getByRole("table");
    for (const key of ["1", "0", "⌘Z", "⇧⌘Z", "T", "B", "Esc"]) {
      expect(within(table).getByText(key, { selector: "kbd" }), key).toBeTruthy();
    }
    for (const action of ["슬롯 이동", "되돌리기", "다시 실행", "턴테이블", "표면 드로잉", "닫기"]) {
      expect(within(table).getByText(action, { selector: "td" }), action).toBeTruthy();
    }
  });

  it("states the honest capability boundaries and answers four questions", () => {
    const { container } = renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "지원 범위와 한계" })).toBeTruthy();
    expect(screen.getAllByText(/VRM 0\.x/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/shape key/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MediaPipe/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SQLite\/OPFS/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/권한에 동의한 뒤에만/).length).toBeGreaterThan(0);

    const faqItems = container.querySelectorAll("details");
    expect(faqItems.length).toBe(4);
    for (const item of faqItems) {
      expect(item.querySelector("summary")?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("owns the document title, description, canonical URL and JSON-LD for /shaper", () => {
    renderPage();

    expect(document.title).toBe("캐릭터 셰이퍼 · 툰스펙트럼");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain(
      "투명 PNG와 레이어 PSD",
    );
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://www.toonstudio.cloud/shaper",
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "캐릭터 셰이퍼 · 툰스펙트럼",
    );

    const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
    expect(jsonLd).not.toBeNull();
    const parsed = JSON.parse(jsonLd!.textContent ?? "{}") as Record<string, unknown>;
    expect(parsed["@type"]).toBe("WebPage");
    expect(parsed.url).toBe("https://www.toonstudio.cloud/shaper");
  });
});

describe("/shaper registration", () => {
  it("is wired into the router, titles, manifest, sitemap, footer and mobile navigation", () => {
    // AppRouter now renders one <Route> per entry of the grouped route table, so the /shaper
    // registration lives in the creator group rather than in the router JSX.
    expect(readRepoFile("apps/web/src/app/routes/groups/creator.routes.tsx")).toContain(
      '{ id: "creator-character-shaper", path: "/shaper", element: <CharacterShaperLandingPage /> }',
    );
    expect(readRepoFile("apps/web/src/app/routes/route-titles.ts")).toContain('"/shaper": "route.shaper"');
    expect(readRepoFile("apps/web/src/app/routes/route-manifest.ts")).toContain(
      '{ path: "/shaper", label: "route.shaper" }',
    );
    expect(readRepoFile("scripts/build-static-catalog.ts")).toContain('"/shaper"');
    expect(readRepoFile("components/site-footer.tsx")).toContain(
      '{ key: "footer.link.shaper", href: "/shaper" }',
    );
    expect(readRepoFile("components/site-header-mobile-nav.tsx")).toContain('href: "/shaper"');
  });

  it("publishes the new app-shell keys in the built-in locales", () => {
    const ko = readAppLocale("ko");
    const en = readAppLocale("en");

    expect(ko["route.shaper"]).toBe("캐릭터 셰이퍼");
    expect(en["route.shaper"]).toBe("Character Shaper");
    for (const key of ["nav.shaper", "footer.link.shaper", "footer.section.create", "footer.link.studio"]) {
      expect(typeof ko[key], key).toBe("string");
      expect(typeof en[key], key).toBe("string");
    }
  });
});
