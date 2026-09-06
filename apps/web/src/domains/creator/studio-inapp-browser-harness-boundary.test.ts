import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `verify:studio-inapp-browser` 는 브라우저를 띄우는 게이트라 유닛 테스트가 실행할 수 없다.
 * 대신 이 파일이 게이트의 **계약**을 잠근다 — 무엇을 실패로 볼지, 무엇을 면제할지가 조용히
 * 느슨해지면 게이트는 초록불만 내는 장식이 된다.
 */
const harness = readFileSync(
  resolve(process.cwd(), "scripts/verify-studio-inapp-browser.mts"),
  "utf8",
);

describe("Studio in-app browser harness boundary", () => {
  it("sweeps the messengers that actually carry Korean webtoon traffic", () => {
    for (const token of ["KAKAOTALK", "Instagram", "NAVER(inapp"]) {
      expect(harness).toContain(token);
    }
  });

  it("probes the companion with a VALID session, not only the no-session error path", () => {
    // 이 게이트가 한 번 놓친 결함이 정확히 여기 있었다. 세션 없는 컴패니언 URL 은 "세션 없음"
    // 에러 경로로 빠지는데, 그 경로는 마침 출구를 렌더링해서 초록불이 났다. 실제 공유 링크는
    // 유효한 세션을 달고 와서 에러 없이 연결만 안 되는 상태에 도달한다 — 그때 출구가 없었다.
    expect(harness).toContain('const VALID_COMPANION_SESSION = "studio-inapp-verify-session-0001";');
    // studio-tools-companion.ts 의 /^[A-Za-z0-9_-]{12,96}$/ 를 통과해야 에러 경로를 피한다.
    expect("studio-inapp-verify-session-0001").toMatch(/^[A-Za-z0-9_-]{12,96}$/u);
    expect(harness).toContain('id: "companion-workspace-session"');
    expect(harness).toContain('id: "companion-review-session"');
    expect(harness).toContain("session=${VALID_COMPANION_SESSION}");
  });

  it("reports profile-scoped routes it skipped instead of silently narrowing", () => {
    expect(harness).toContain("route.profiles && !route.profiles.includes(profile.id)");
    expect(harness).toContain("skipped ${skipped} profile-scoped route runs");
  });

  it("covers every Studio route family, not just the editor", () => {
    for (const path of [
      '"/studio"',
      '"/studio/comic"',
      '"/studio/animation"',
      '"/studio/publish"',
      '"/studio/companion/workspace"',
      '"/studio/projects"',
      '"/studio/nope"',
    ]) {
      expect(harness).toContain(path);
    }
  });

  it("fails on popup affordances that an in-app browser cannot honor", () => {
    expect(harness).toContain("data-studio-presence-companion-tab");
    expect(harness).toContain("target === '_blank'");
    expect(harness).toContain("dead popup affordance:");
  });

  it("requires an in-page exit on every route", () => {
    // 인앱 브라우저에는 주소창도 뒤로 가기도 없다. 출구 판정에 쓰는 표식이 사라지면
    // 막다른 화면이 다시 통과한다.
    expect(harness).toContain("data-studio-mobile-app-mode");
    expect(harness).toContain("data-studio-route-exit");
    expect(harness).toContain("no in-page exit");
  });

  it("excuses only the static preview's missing API and font CDNs", () => {
    // 면제 목록이 넓어지면 진짜 런타임 오류가 조용히 통과한다.
    const ignored = harness.slice(
      harness.indexOf("const IGNORED_CONSOLE"),
      harness.indexOf("] as const;", harness.indexOf("const IGNORED_CONSOLE")),
    );
    expect(ignored).toContain("/api/kmas/merge-on-access");
    expect(ignored).toContain("/api/studio-ai/status");
    expect(ignored).toContain("fonts.googleapis.com");
    expect(ignored).not.toContain("localhost");
    expect(ignored).not.toContain("127.0.0.1");
    expect(harness).toContain("console errors:");
  });

  it("does not count horizontally scrollable rows as unreachable UI", () => {
    // 도크의 드로잉 도구 행은 가로 스크롤로 도달하도록 설계돼 있다 — 잘림이 아니다.
    expect(harness).toContain("function scrollRow(el)");
    expect(harness).toContain("if (!row && (rect.right > vw + EPS");
    expect(harness).toContain("if (!row && !disabled");
  });

  it("keeps the 44px tap contract as the measured minimum", () => {
    expect(harness).toContain("const MIN_TAP_PX = 43.5;");
  });

  it("measures after entry animations settle, without waiting on infinite ones", () => {
    // scale(0.98) 진입 중에 재면 44px 타깃이 43.1px 로 잡혀 없는 회귀를 보고한다. 반대로
    // 무한 펄스까지 기다리면 조건이 영원히 참이 되지 않아 라우트마다 타임아웃만 태운다.
    expect(harness).toContain("document.getAnimations()");
    expect(harness).toContain("iterations === Infinity");
    expect(harness).toContain("await settleAnimations(page);");
  });
});
