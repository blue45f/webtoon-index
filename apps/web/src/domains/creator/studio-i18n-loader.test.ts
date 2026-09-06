import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveI18nValue } from "@/shared/lib/i18n";
import { STUDIO_I18N_NAMESPACES } from "@/shared/lib/i18n-asset-manifest";

import {
  loadStudioI18nDictionaries,
  parseStudioI18nDictionary,
  STUDIO_I18N_ASSET_LOCALES,
  studioI18nAssetUrl,
} from "./studio-i18n-loader";

function readAsset(locale: string): string {
  const merged: Record<string, string> = {};
  for (const namespace of STUDIO_I18N_NAMESPACES) {
    const file = path.resolve(process.cwd(), "apps/web/public/i18n/studio", namespace, `${locale}.json`);
    Object.assign(merged, JSON.parse(readFileSync(file, "utf8")));
  }
  return JSON.stringify(merged);
}

describe("Studio lazy i18n assets", () => {
  it("keeps complete, validated Korean and English dictionaries", () => {
    for (const locale of STUDIO_I18N_ASSET_LOCALES) {
      const dictionary = parseStudioI18nDictionary(readAsset(locale));
      expect(dictionary).not.toBeNull();
      // 1_323 → 1_325: 컴패니언 창의 막다른 상태에 붙인 탈출구 두 줄
      // (studio.toolsCompanion.exit.disconnected / .editor).
      // 1_325 → 1_328: 모바일 도크 "페이지" 버튼의 라벨·열기·닫기 aria 세 키
      // (studio.mobileDock.tool.pages / .pagesOpen / .pagesClose) — 하드코딩 한국어가 `en` 도구막대에
      // 남아 있던 결함.
      // 1_328 → 1_333: 도크 내보내기·찾기 진입점(studio.mobileDock.tool.export / .search / .search.title),
      // 통합 검색 라벨(studio.commandSearch.label), 도구 복합 메뉴 제목(studio.mainMenu.group.tools.label)
      // — UX 감사 2026-09-02 반영분. 이 숫자는 래칫이므로 키를 늘리거나 줄이는 변경은 여기서 한 번 더
      // 눈에 띄어야 한다.
      // 1_333 → 1_334: 필터 메뉴 polar-coordinates 행(studio.mainMenu.item.filter.polar-coordinates).
      // 유니온 웨이브의 마지막 행만 75개 팩 어디에도 키가 없어 `en` 메뉴바에 "극좌표 변환"이 남아
      // 있었다(2026-09-06). 미번역 팩은 위 관례대로 영어 카탈로그 라벨을 든다.
      expect(Object.keys(dictionary ?? {})).toHaveLength(1_334);
    }
    // The mobile dock used to hardcode Korean labels; every pack must now carry the keys that
    // replaced them, so an `en` viewport cannot fall back to Korean chrome.
    for (const key of [
      "studio.mobileDock.label",
      "studio.mobileDock.tool.pixel",
      "studio.mobileDock.tool.shape",
      "studio.mobileDock.tool.undo",
      "studio.mobileDock.tool.redo",
      "studio.mobileDock.brushSettings",
      "studio.mobileDock.tool.pages",
      "studio.mobileDock.pagesOpen",
      "studio.mobileDock.pagesClose",
      "studio.mobileDock.tool.export",
      "studio.mobileDock.tool.search",
      "studio.commandSearch.label",
      "studio.mainMenu.group.tools.label",
      "studio.creativeModes.title",
    ]) {
      for (const locale of STUDIO_I18N_ASSET_LOCALES) {
        expect(parseStudioI18nDictionary(readAsset(locale))?.[key]).toBeTruthy();
      }
      expect(resolveI18nValue("ko", key)).not.toBe(key);
    }
    expect(resolveI18nValue("en", "studio.mobileDock.tool.shape")).toBe("Shape");
    expect(resolveI18nValue("ko", "studio.mobileDock.tool.shape")).toBe("도형");
    // The filter menu generates a row per pack kind, but 28 kinds (the advanced blurs, the
    // clean-up filters and the whole union wave) had no locale keys, so an `en` menubar showed
    // "렌즈 블러" between English rows. Every pack now carries the keys — untranslated locales
    // deliberately hold the English catalogue label, the same pending-translation convention the
    // mobile-dock keys established, because a French reader is better served by "Lens blur"
    // than by Hangul.
    for (const key of [
      "studio.mainMenu.item.filter.lens-blur",
      "studio.mainMenu.item.filter.tilt-shift-blur",
      "studio.mainMenu.item.filter.screentone-removal",
      "studio.mainMenu.item.filter.god-rays",
      "studio.mainMenu.item.filter.wave-warp",
    ]) {
      for (const locale of STUDIO_I18N_ASSET_LOCALES) {
        expect(parseStudioI18nDictionary(readAsset(locale))?.[key]).toBeTruthy();
      }
    }
    expect(resolveI18nValue("en", "studio.mainMenu.item.filter.lens-blur")).toBe("Lens blur");
    expect(resolveI18nValue("ko", "studio.mainMenu.item.filter.lens-blur")).toBe("렌즈 블러");
    expect(resolveI18nValue("ko", "studio.mainMenu.item.filter.god-rays")).toBe("빛줄기");
    expect(resolveI18nValue("ko", "studio.canvas.wheelMode.zoom")).toBe(
      "휠: 캔버스 확대·축소",
    );
    expect(resolveI18nValue("en", "studio.canvas.wheelMode.zoom")).toBe(
      "Wheel: zoom canvas",
    );
    expect(resolveI18nValue("ko", "studio.settings.state.hide")).toBe("숨김");
    // The menubar command bar strip, its slot editor, and the two menu rows that
    // reach the strip and the layer border effect shipped Korean literals. Every
    // pack now carries them translated — these keys must never regress to the
    // "English everywhere" pending-translation shape the filter rows use, because
    // the strip is chrome a reader sees on every screen.
    for (
      const key of [
        "studio.mainMenu.item.window.command-bar",
        "studio.mainMenu.item.window.command-bar.open",
        "studio.mainMenu.item.window.command-bar.unavailable",
        "studio.mainMenu.item.layer.border-effect",
        "studio.mainMenu.item.layer.border-effect.unavailable",
        "studio.commandBar.aria",
        "studio.commandBar.settings",
        "studio.commandBar.settingsDescription",
        "studio.commandBar.settingsTip",
        "studio.commandBar.settingsClose",
        "studio.commandBar.settingsStorageNote",
        "studio.commandBar.showSlots",
        "studio.commandBar.slot",
        "studio.commandBar.slotAria",
        "studio.commandBar.slotEmpty",
        "studio.commandBar.resetDefaults",
        "studio.commandBar.command.undo",
        "studio.commandBar.command.redo",
        "studio.commandBar.command.save",
        "studio.commandBar.command.publish",
        "studio.commandBar.command.download",
        "studio.commandBar.command.export-open",
        "studio.commandBar.command.zoom-fit",
        "studio.commandBar.command.assets",
        "studio.commandBar.command.bubbles",
        "studio.commandBar.command.project",
      ]
    ) {
      const values = STUDIO_I18N_ASSET_LOCALES.map(
        (locale) => parseStudioI18nDictionary(readAsset(locale))?.[key],
      );
      for (const value of values) expect(value).toBeTruthy();
      // A key left untranslated shows up as ~75 copies of the English value. The
      // ceiling is loose rather than 1 because loanwords legitimately collide —
      // "Slot {index}" is the same string in Dutch, German, Czech, Malay and more.
      const english = parseStudioI18nDictionary(readAsset("en"))?.[key];
      expect(values.filter((value) => value === english).length).toBeLessThan(20);
    }
    // Korean stays the authored source of truth for the literals these replaced.
    expect(resolveI18nValue("ko", "studio.commandBar.aria")).toBe("빠른 명령 바");
    expect(resolveI18nValue("ko", "studio.commandBar.settings")).toBe("명령 바 설정");
    expect(resolveI18nValue("ko", "studio.commandBar.slotEmpty")).toBe("빈 슬롯");
    expect(resolveI18nValue("ko", "studio.mainMenu.item.layer.border-effect")).toBe(
      "경계 효과…",
    );
    expect(resolveI18nValue("en", "studio.commandBar.aria")).toBe("Quick command bar");
    expect(resolveI18nValue("en", "studio.mainMenu.item.window.command-bar")).toBe(
      "Show command bar",
    );
    expect(resolveI18nValue("en", "studio.mainMenu.item.window.command-bar.open")).toBe(
      "Hide command bar",
    );
    // Both slot rows interpolate the same placeholder the rest of the packs use.
    for (const key of ["studio.commandBar.slot", "studio.commandBar.slotAria"]) {
      for (const locale of STUDIO_I18N_ASSET_LOCALES) {
        expect(parseStudioI18nDictionary(readAsset(locale))?.[key]).toContain("{index}");
      }
    }
  });

  it("loads both assets in parallel before either Studio route commits", async () => {
    const assets = {
      ko: readAsset("ko"),
      en: readAsset("en"),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const locale = String(input).endsWith("/ko.json") ? "ko" : "en";
      return new Response(assets[locale]);
    });

    await loadStudioI18nDictionaries({
      fetchImpl: fetchMock as typeof fetch,
      baseUrl: "/preview/",
    });

    expect(fetchMock).toHaveBeenCalledTimes(STUDIO_I18N_NAMESPACES.length * 2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/preview/i18n/studio/");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/preview/i18n/studio/");
    expect(studioI18nAssetUrl("ko", "/preview")).toBe(
      "/preview/i18n/studio/mainMenu/ko.json",
    );
  });

  it("rejects malformed, foreign-namespace and oversized dictionaries", () => {
    expect(parseStudioI18nDictionary("{")).toBeNull();
    expect(parseStudioI18nDictionary('{"common.close":"Close"}')).toBeNull();
    expect(parseStudioI18nDictionary("{}")).toBeNull();
    expect(
      parseStudioI18nDictionary(
        JSON.stringify({ "studio.invalid": "x".repeat(4_001) }),
      ),
    ).toBeNull();
  });

  it("keeps Studio strings out of the eagerly loaded global dictionary source", () => {
    const i18nSource = readFileSync(
      path.resolve(process.cwd(), "lib", "i18n.ts"),
      "utf8",
    );
    const studioPageSource = readFileSync(
      path.resolve(
        process.cwd(),
        "src",
        "domains",
        "creator",
        "StudioPage.tsx",
      ),
      "utf8",
    );
    const companionSource = readFileSync(
      path.resolve(
        process.cwd(),
        "src",
        "domains",
        "creator",
        "StudioToolsCompanionPage.tsx",
      ),
      "utf8",
    );
    const creatorRoutesSource = readFileSync(
      path.resolve(
        process.cwd(),
        "src",
        "app",
        "routes",
        "groups",
        "creator.routes.tsx",
      ),
      "utf8",
    );

    expect(i18nSource).not.toMatch(/^\s+"studio\.[^"]+":/mu);
    expect(studioPageSource).not.toContain("studio-i18n");
    expect(companionSource).not.toContain("studio-i18n");
    expect(creatorRoutesSource).toContain("loadStudioI18nDictionaries()");
  });
});
