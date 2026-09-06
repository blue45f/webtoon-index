// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { usePageSocialMeta } from "./use-document-title";

function MetaProbe({ path, title }: { path: string; title: string }) {
  usePageSocialMeta({
    canonicalPath: path,
    title,
    description: "창작 리소스를 실제 Studio 호환성과 함께 탐색합니다.",
    type: "article",
    imageAlt: "창작 마켓 공유 카드",
  });
  return null;
}

function installHeadFixtures(): void {
  document.head.innerHTML = `
    <link rel="canonical" href="https://www.toonstudio.cloud/">
    <meta property="og:type" content="website">
    <meta property="og:title" content="기본 제목">
    <meta property="og:description" content="기본 설명">
    <meta property="og:url" content="https://www.toonstudio.cloud/">
    <meta property="og:image" content="https://www.toonstudio.cloud/og-web.png">
    <meta property="og:image:alt" content="기본 이미지">
    <meta name="twitter:title" content="기본 제목">
    <meta name="twitter:description" content="기본 설명">
    <meta name="twitter:image" content="https://www.toonstudio.cloud/og-web.png">
  `;
}

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
});

describe("usePageSocialMeta", () => {
  it("updates canonical, Open Graph, and Twitter metadata for a route", () => {
    installHeadFixtures();
    render(<MetaProbe path="/market/resource/resource-1" title="먹선 브러시 · 툰스펙트럼" />);

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href"))
      .toBe("https://www.toonstudio.cloud/market/resource/resource-1");
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute("content"))
      .toBe("article");
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content"))
      .toBe("먹선 브러시 · 툰스펙트럼");
    expect(document.querySelector('meta[name="twitter:description"]')?.getAttribute("content"))
      .toBe("창작 리소스를 실제 Studio 호환성과 함께 탐색합니다.");
  });

  it("restores the previous route metadata on unmount", () => {
    installHeadFixtures();
    const view = render(<MetaProbe path="market" title="창작 마켓 · 툰스펙트럼" />);
    view.unmount();

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href"))
      .toBe("https://www.toonstudio.cloud/");
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content"))
      .toBe("기본 제목");
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute("content"))
      .toBe("website");
  });
});
