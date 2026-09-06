import { describe, expect, it, vi } from "vitest";

import { checkBrowserCompatibility, classifyError, getBrowserInfo } from "../browser-check";

describe("browser-check compat module", () => {
  it("should get browser info without crashing", () => {
    const info = getBrowserInfo();
    expect(info).toHaveProperty("name");
    expect(info).toHaveProperty("version");
    expect(info).toHaveProperty("os");
  });

  it("should check browser compatibility", () => {
    const res = checkBrowserCompatibility();
    expect(res).toHaveProperty("isSupported");
    expect(res).toHaveProperty("missingFeatures");
    expect(Array.isArray(res.missingFeatures)).toBe(true);
  });

  it("should classify network error correctly", () => {
    const err = new Error("Failed to fetch");
    const analysis = classifyError(err);
    expect(analysis.type).toBe("network");
    expect(analysis.isCompatibilityIssue).toBe(false);
  });

  it("should classify chunk load error correctly", () => {
    const err = new Error("Failed to fetch dynamically imported module /src/pages/Home.tsx");
    const analysis = classifyError(err);
    expect(analysis.type).toBe("chunk_load");
    expect(analysis.isCompatibilityIssue).toBe(false);
  });

  it("should classify general error when environment is fully supported", () => {
    const err = new Error("Custom business logic crash");
    const analysis = classifyError(err);
    expect(analysis.type).toBe("general");
    expect(analysis.isCompatibilityIssue).toBe(false);
  });

  it("does not treat app method TypeErrors as a browser-update wall", () => {
    const err = new TypeError("target_0.park is not a function");
    const analysis = classifyError(err);
    expect(analysis.type).toBe("general");
    expect(analysis.isCompatibilityIssue).toBe(false);
  });
});

describe("browser-check in-app browser awareness", () => {
  it("reports the in-app diagnosis alongside feature support", () => {
    const result = checkBrowserCompatibility();
    expect(result).toHaveProperty("inAppBrowser");
    expect(result.inAppBrowser).toHaveProperty("inApp");
    expect(result.inAppBrowser).toHaveProperty("popupCapable");
  });

  it("does not tell an in-app browser user to update their browser", async () => {
    // 인앱 브라우저에는 설정 화면도 업데이트 경로도 없다 — 같은 진단이라도 안내는 달라야 한다.
    vi.resetModules();
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Mobile/21E236 Instagram 320.0.0.0.0 (iPhone15,3; iOS 17_4; ko_KR)",
    });
    vi.stubGlobal("location", { href: "https://toonspectrum.app/studio" });
    try {
      const fresh = await import("../browser-check");
      const analysis = fresh.classifyError(
        new TypeError("WebGPU is not supported in this environment"),
      );
      expect(analysis.isCompatibilityIssue).toBe(true);
      expect(analysis.title).toContain("인앱 브라우저");
      expect(analysis.message).toContain("인스타그램");
      expect(analysis.message).not.toContain("업데이트");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
