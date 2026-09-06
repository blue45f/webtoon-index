import { describe, expect, it } from "vitest";

import {
  studioCompanionPopupGuidance,
  studioCompanionPopupGuidanceFor,
} from "./studio-companion-popup-guidance";

import { diagnoseStudioInAppBrowser } from "@/src/compat/in-app-browser";

const HREF = "https://toonspectrum.app/studio";
const KAKAO_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK 10.4.3";
const INSTAGRAM_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/21E236 Instagram 320.0.0.0.0 (iPhone15,3; iOS 17_4; ko_KR)";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

describe("studioCompanionPopupGuidanceFor", () => {
  it("keeps the allow-popups instruction for a regular browser", () => {
    const guidance = studioCompanionPopupGuidanceFor(
      diagnoseStudioInAppBrowser({ href: HREF, userAgent: DESKTOP_CHROME }),
    );
    expect(guidance.key).toBe("studio.toolsCompanion.open.popupBlocked");
    expect(guidance.text).toContain("팝업을 허용");
    expect(guidance.escapeHref).toBeNull();
  });

  it("never tells an in-app browser user to allow popups", () => {
    for (const userAgent of [KAKAO_ANDROID, INSTAGRAM_IOS]) {
      const guidance = studioCompanionPopupGuidanceFor(
        diagnoseStudioInAppBrowser({ href: HREF, userAgent }),
      );
      expect(guidance.text).not.toContain("팝업을 허용");
      expect(guidance.key).not.toBe("studio.toolsCompanion.open.popupBlocked");
    }
  });

  it("names the app and carries the escape link where one exists", () => {
    const guidance = studioCompanionPopupGuidanceFor(
      diagnoseStudioInAppBrowser({ href: HREF, userAgent: KAKAO_ANDROID }),
    );
    expect(guidance.text).toContain("카카오톡 인앱 브라우저");
    expect(guidance.escapeHref).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(HREF)}`,
    );
  });

  it("tells the user HOW to escape, not just to escape — the link cannot be rendered", () => {
    // 이 문구가 가는 곳은 문자열만 받는 announce 알림이다. 링크가 있어도 그릴 수 없으므로,
    // 문구 자체가 "어떻게" 를 담지 않으면 사용자는 같은 버튼만 반복해서 누르게 된다.
    for (const userAgent of [KAKAO_ANDROID, INSTAGRAM_IOS]) {
      const diagnosis = diagnoseStudioInAppBrowser({ href: HREF, userAgent });
      const guidance = studioCompanionPopupGuidanceFor(diagnosis);
      expect(guidance.text, userAgent).toContain(diagnosis.escapeHint ?? "");
      expect(guidance.text, userAgent).toMatch(/메뉴|Safari/u);
    }
  });

  it("falls back to the native-menu hint where no scheme can hand the page off", () => {
    const guidance = studioCompanionPopupGuidanceFor(
      diagnoseStudioInAppBrowser({ href: HREF, userAgent: INSTAGRAM_IOS }),
    );
    expect(guidance.text).toContain("인스타그램 인앱 브라우저");
    expect(guidance.text).toContain("Safari");
    expect(guidance.escapeHref).toBeNull();
  });
});

describe("studioCompanionPopupGuidance", () => {
  it("reads the environment off the given scope", () => {
    const scope = {
      location: { href: HREF },
      navigator: { userAgent: KAKAO_ANDROID },
    } as unknown as typeof globalThis;
    expect(studioCompanionPopupGuidance(scope).escapeHref).toContain("kakaotalk://");
  });
});
