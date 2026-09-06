import { describe, expect, it } from "vitest";

import { shouldRenderAppSplash } from "./app-shell-splash";

describe("shouldRenderAppSplash", () => {
  it.each(["/studio", "/studio/", "/studio/tools-companion"])(
    "전용 편집기 %s에서는 앱 인트로를 생략한다",
    (pathname) => {
      expect(shouldRenderAppSplash(pathname)).toBe(false);
    }
  );

  it("게시용 upload 모드는 기존 앱 인트로 흐름을 유지한다", () => {
    expect(shouldRenderAppSplash("/studio", "?mode=upload")).toBe(true);
    expect(shouldRenderAppSplash("/studio/publish")).toBe(true);
    expect(shouldRenderAppSplash("/studio/work/work-1/publish")).toBe(true);
  });

  it.each(["/", "/ranking", "/create", "/create/work-1"])(
    "일반 앱 경로 %s에서는 기존 인트로를 유지한다",
    (pathname) => {
      expect(shouldRenderAppSplash(pathname)).toBe(true);
    },
  );
});
