import { describe, expect, it } from "vitest";

import {
  diagnoseStudioInAppBrowser,
  diagnoseStudioInAppBrowserFromGlobals,
  studioCanOpenAuxiliaryWindow,
} from "../in-app-browser";

/**
 * 실제로 수집되는 UA 문자열만 쓴다. 이 표가 이 모듈의 계약이다 — 인앱 판정을 넓히는 변경은
 * 아래 "일반 브라우저" 표를 깨지 않고서는 통과할 수 없다.
 */
const IN_APP_UA = {
  kakaotalkAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK 10.4.3",
  kakaotalkIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.3",
  naverAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N Build/TP1A.220624.014; wv) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 " +
    "NAVER(inapp; search; 1000; 12.9.1)",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/21E236 Instagram 320.0.0.0.0 (iPhone15,3; iOS 17_4; ko_KR)",
  lineAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Line/13.5.0/IAB",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/456.0.0.0;FBBV/1]",
  bareAndroidWebView:
    "Mozilla/5.0 (Linux; Android 12; Pixel 5 Build/SP2A.220505.002; wv) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36",
  bareIosWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148",
} as const;

const REGULAR_UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidWhale:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Whale/3.0.0.0 Chrome/124.0.0.0 Mobile Safari/537.36",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
    "Version/17.5 Safari/605.1.15",
} as const;

const HREF = "https://toonspectrum.app/studio/work/abc?surface=canvas#top";

describe("diagnoseStudioInAppBrowser", () => {
  it.each(Object.entries(IN_APP_UA))("detects %s as an in-app browser", (_name, userAgent) => {
    const result = diagnoseStudioInAppBrowser({ href: HREF, userAgent });
    expect(result.inApp).toBe(true);
    expect(result.popupCapable).toBe(false);
    expect(result.id).not.toBeNull();
  });

  it.each(Object.entries(REGULAR_UA))("leaves %s as a regular browser", (_name, userAgent) => {
    const result = diagnoseStudioInAppBrowser({ href: HREF, userAgent });
    expect(result.inApp).toBe(false);
    expect(result.popupCapable).toBe(true);
    expect(result.escape).toBe("none");
    expect(result.id).toBeNull();
  });

  it("names the messenger so the escape copy can address it", () => {
    expect(diagnoseStudioInAppBrowser({ userAgent: IN_APP_UA.kakaotalkAndroid }).name)
      .toBe("카카오톡");
    expect(diagnoseStudioInAppBrowser({ userAgent: IN_APP_UA.naverAndroid }).name)
      .toBe("네이버");
    expect(diagnoseStudioInAppBrowser({ userAgent: IN_APP_UA.instagramIos }).name)
      .toBe("인스타그램");
  });

  it("prefers the messenger signature over the bare Android WebView token", () => {
    // 카카오톡·네이버·라인 안드로이드 UA 에는 `; wv)` 가 함께 들어 있다.
    for (const ua of [
      IN_APP_UA.kakaotalkAndroid,
      IN_APP_UA.naverAndroid,
      IN_APP_UA.lineAndroid,
    ]) {
      expect(diagnoseStudioInAppBrowser({ userAgent: ua }).id).not.toBe("android-webview");
    }
  });

  it("hands KakaoTalk on Android its documented external-browser scheme", () => {
    const result = diagnoseStudioInAppBrowser({
      href: HREF,
      userAgent: IN_APP_UA.kakaotalkAndroid,
    });
    expect(result.escape).toBe("link");
    expect(result.escapeHref).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(HREF)}`,
    );
  });

  it("always carries a manual hint, even when a one-tap link exists", () => {
    // 링크를 렌더링할 수 없는 호출부(문자열만 받는 announce 파이프라인)가 있으므로,
    // 링크가 있다고 해서 안내를 비우면 그쪽에서는 실행 가능한 지시가 사라진다.
    for (const userAgent of Object.values(IN_APP_UA)) {
      const result = diagnoseStudioInAppBrowser({ href: HREF, userAgent });
      expect(result.escapeHint, userAgent).not.toBeNull();
      expect(result.escapeHint?.length ?? 0, userAgent).toBeGreaterThan(0);
    }
  });

  it("falls back to an intent:// hand-off for other Android WebViews", () => {
    const result = diagnoseStudioInAppBrowser({
      href: HREF,
      userAgent: IN_APP_UA.naverAndroid,
    });
    expect(result.escape).toBe("link");
    expect(result.escapeHref).toBe(
      "intent://toonspectrum.app/studio/work/abc?surface=canvas#top" +
      "#Intent;scheme=https;action=android.intent.action.VIEW;end;",
    );
  });

  it("offers manual guidance on iOS, where no scheme can hand the page off", () => {
    const result = diagnoseStudioInAppBrowser({
      href: HREF,
      userAgent: IN_APP_UA.kakaotalkIos,
    });
    expect(result.platform).toBe("ios");
    expect(result.escape).toBe("manual");
    expect(result.escapeHref).toBeNull();
    expect(result.escapeHint).toContain("Safari");
  });

  it("never invents an escape link from a non-http address", () => {
    for (const href of ["", "about:blank", "file:///tmp/index.html", "not a url"]) {
      const result = diagnoseStudioInAppBrowser({
        href,
        userAgent: IN_APP_UA.kakaotalkAndroid,
      });
      expect(result.escapeHref).toBeNull();
      expect(result.escape).toBe("manual");
    }
  });

  it("treats a missing user agent as a regular browser", () => {
    expect(diagnoseStudioInAppBrowser({ userAgent: null }).inApp).toBe(false);
    expect(diagnoseStudioInAppBrowser({ userAgent: "" }).inApp).toBe(false);
    expect(diagnoseStudioInAppBrowser({}).inApp).toBe(false);
  });
});

describe("diagnoseStudioInAppBrowserFromGlobals", () => {
  it("reads the user agent and href off the given scope", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: IN_APP_UA.kakaotalkAndroid },
    } as unknown as typeof globalThis;
    const result = diagnoseStudioInAppBrowserFromGlobals(scope);
    expect(result.id).toBe("kakaotalk");
    expect(result.escapeHref).toContain("kakaotalk://web/openExternal");
  });

  it("stays inert without a navigator (SSR, workers)", () => {
    const result = diagnoseStudioInAppBrowserFromGlobals({} as typeof globalThis);
    expect(result.inApp).toBe(false);
    expect(result.popupCapable).toBe(true);
  });
});

describe("studioCanOpenAuxiliaryWindow", () => {
  it("is false inside an in-app browser even though window.open exists", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: IN_APP_UA.instagramIos },
      open: () => null,
    } as unknown as typeof globalThis;
    expect(studioCanOpenAuxiliaryWindow(scope)).toBe(false);
  });

  it("is true in a regular mobile browser", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: REGULAR_UA.androidChrome },
      open: () => null,
    } as unknown as typeof globalThis;
    expect(studioCanOpenAuxiliaryWindow(scope)).toBe(true);
  });

  it("is false where window.open does not exist at all", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: REGULAR_UA.androidChrome },
    } as unknown as typeof globalThis;
    expect(studioCanOpenAuxiliaryWindow(scope)).toBe(false);
  });
});

describe("diagnoseStudioInAppBrowserFromGlobals caching", () => {
  it("returns a stable result for the same global user agent and href", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: IN_APP_UA.kakaotalkAndroid },
    } as unknown as typeof globalThis;
    // 명시적 scope 는 캐시를 타지 않으므로 매번 새 판정이지만 값은 같아야 한다.
    expect(diagnoseStudioInAppBrowserFromGlobals(scope))
      .toEqual(diagnoseStudioInAppBrowserFromGlobals(scope));
  });

  it("hands back one cached diagnosis for the default scope", () => {
    const first = diagnoseStudioInAppBrowserFromGlobals();
    const second = diagnoseStudioInAppBrowserFromGlobals();
    // 기본 scope 는 캐시되므로 같은 객체가 돌아온다(렌더마다 UA 재파싱을 막는 계약).
    expect(second).toBe(first);
  });
});
