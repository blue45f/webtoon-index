import { describe, expect, it } from "vitest";

import { classifyStudioBg3dInAppBrowser } from "./studio-bg3d-inapp-browser";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const IOS_WEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36";

describe("Studio BG3D host GPU trust", () => {
  it("asks for an explicit WebGPU opt-in in a messenger WebView", () => {
    expect(classifyStudioBg3dInAppBrowser({
      userAgent: `${ANDROID_WEBVIEW} KAKAOTALK 10.6.5`,
    })).toMatchObject({
      id: "kakaotalk",
      platform: "android",
      isInApp: true,
      gpuTrust: "opt-in",
      label: "카카오톡 인앱 브라우저",
    });

    expect(classifyStudioBg3dInAppBrowser({
      userAgent: `${ANDROID_WEBVIEW} NAVER(inapp; search; 2000; 12.9.6)`,
    })).toMatchObject({ id: "naver", gpuTrust: "opt-in", label: "네이버 인앱 브라우저" });
  });

  it("refuses WebGPU outright in the hosts that cannot keep a device", () => {
    for (const [userAgent, id] of [
      [`${IOS_WEBVIEW} Instagram 350.0.0.0`, "instagram"],
      [`${IOS_WEBVIEW} [FBAN/FBIOS;FBAV/500.0.0.0]`, "facebook"],
      [`${ANDROID_WEBVIEW} Barcelona 350.0`, "threads"],
    ] as const) {
      expect(classifyStudioBg3dInAppBrowser({ userAgent }))
        .toMatchObject({ id, isInApp: true, gpuTrust: "blocked" });
    }
  });

  it("covers hosts the shared detector knows that this policy never enumerated", () => {
    // Consolidating onto `diagnoseStudioInAppBrowser` means new families arrive already classified.
    expect(classifyStudioBg3dInAppBrowser({
      userAgent: `${ANDROID_WEBVIEW} musical_ly_2023 trill_310`,
    })).toMatchObject({ id: "tiktok", gpuTrust: "opt-in", label: "틱톡 인앱 브라우저" });
    expect(classifyStudioBg3dInAppBrowser({
      userAgent: `${ANDROID_WEBVIEW} MicroMessenger/8.0.44`,
    })).toMatchObject({ id: "wechat", gpuTrust: "opt-in", label: "위챗 인앱 브라우저" });
  });

  it("labels a bare embedded WebView without inventing an app name", () => {
    expect(classifyStudioBg3dInAppBrowser({ userAgent: ANDROID_WEBVIEW }))
      .toMatchObject({ id: "android-webview", gpuTrust: "opt-in", label: "안드로이드 웹뷰" });
    expect(classifyStudioBg3dInAppBrowser({ userAgent: IOS_WEBVIEW }))
      .toMatchObject({ id: "ios-webview", gpuTrust: "opt-in", label: "iOS 웹뷰" });
  });

  it("trusts standalone browsers, including WebKit-based iOS ones", () => {
    for (const userAgent of [ANDROID_CHROME, IOS_SAFARI, `${IOS_WEBVIEW} CriOS/133.0.0.0`]) {
      expect(classifyStudioBg3dInAppBrowser({ userAgent }))
        .toMatchObject({ id: null, isInApp: false, gpuTrust: "trusted" });
    }
  });

  it("treats an absent user agent as a trusted standalone browser", () => {
    // The adapter probe already fails closed, so a missing UA must not block a capable desktop.
    expect(classifyStudioBg3dInAppBrowser({}))
      .toMatchObject({ id: null, isInApp: false, gpuTrust: "trusted" });
  });

  it("returns frozen profiles so a status surface cannot mutate the classification", () => {
    expect(Object.isFrozen(classifyStudioBg3dInAppBrowser({ userAgent: ANDROID_CHROME }))).toBe(true);
    expect(Object.isFrozen(classifyStudioBg3dInAppBrowser({
      userAgent: `${ANDROID_WEBVIEW} KAKAOTALK 10.6.5`,
    }))).toBe(true);
  });
});
