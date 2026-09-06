import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// DESIGN.md: warm-ink/OKLCH 토큰 강제 — `#000`/`#fff` 절대 금지, 중립 그림자는 hue 64–70 축.
// 한 번 정리한 일탈(raw white 텍스트, 쿨 무채색 shadow-black, 하드코딩 스킵링크 색)의 재발을 막는다.
describe("design token discipline", () => {
  it("keeps recommend view accent CTAs on the on-accent token instead of raw white", () => {
    const view = read("components/recommend-view.tsx");

    expect(view).not.toContain("text-white");
    expect(view).toContain("text-on-accent");
  });

  it("keeps floating switcher and share menu shadows on the warm-ink axis", () => {
    const paths = ["components/share-button.tsx"];

    for (const path of paths) {
      const source = read(path);
      expect(source, path).not.toContain("shadow-black");
      expect(source, path).toContain("shadow-[oklch(0.1_0.02_70/");
    }
  });

  it("renders the skip link with theme tokens so contrast holds in both themes", () => {
    // 스킵 링크는 웹 애플리케이션 셸(AppShell)에 산다(App.tsx 는 라우터+크롬만 조립).
    const shell = read("apps/web/src/app/AppShell.tsx");

    expect(shell).not.toContain("bg-white");
    expect(shell).not.toContain("#1a1410");
    expect(shell).toContain("focus:bg-fg");
    expect(shell).toContain("focus:text-canvas");
  });
});
