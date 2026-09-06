import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

// 헤더 폭 예산 — 데스크탑 헤더는 9개 내비+검색+서재+계정을 한 줄에 수용해야 한다.
// 실측(Pretendard, 2026-06): EN 라벨에 항목별 아이콘 박스(+30px×9)를 더하면 컨테이너
// 상한(max-w 1320px)을 넘겨 어떤 뷰포트에서도 안 들어가고, lg(1024px)에선 검색 폭
// 양보 + EN 단축 라벨 없이는 줄이 넘친다. 한 번 잡은 절충의 재발(아이콘 박스 부활,
// 패딩/검색 폭 원복, EN 라벨 재장문화)을 막는다.
describe("header width budget", () => {
  it("keeps desktop nav links text-only with the narrow lg padding", () => {
    const header = read("components/site-header.tsx");

    // 항목별 아이콘 박스(xl:grid)는 폭 예산상 데스크탑 내비에 되살릴 수 없다
    expect(header).not.toContain("xl:grid");
    expect(header).not.toContain("px-2.5");
    expect(header).toContain("rounded-full px-2 py-2 text-sm font-medium");
    expect(header).toContain("xl:px-3");
  });

  it("narrows the search trigger in the lg band and guards the hint with truncate", () => {
    const header = read("components/site-header.tsx");

    expect(header).toContain("sm:w-48 sm:justify-between lg:w-40 xl:w-56");
    expect(header).toContain("hidden truncate sm:inline");
    // ⌘K 배지는 폭이 빠듯한 lg 구간에서만 양보하고 xl부터 복귀한다
    expect(header).toContain("sm:flex lg:hidden xl:flex");
  });

  it("keeps EN nav labels within the measured width budget", () => {
    // The English dictionary moved out of lib/i18n.ts into the published locale asset when the
    // 75 inlined dictionaries were split off the app shell.
    const en = JSON.parse(read("apps/web/public/i18n/app/nav/en.json")) as Record<string, string>;
    const labels = [
      "home",
      "ranking",
      "calendar",
      "recommend",
      "explore",
      "reviews",
      "community",
      "insights",
      "create",
    ].map((key) => en[`nav.${key}`]);

    expect(labels.filter((label) => typeof label === "string")).toHaveLength(9);
    // 글자수는 폭의 근사 프록시다. 실측(2026-06) 기준 합산 52자에서 lg 여유 ≈25px이므로
    // 개별 ≤9자·합산 ≤56자를 상한으로 잠근다(초과분 ~4자 ≈ 그 여유를 소진).
    for (const label of labels) {
      expect(label.length, label).toBeLessThanOrEqual(9);
    }
    expect(labels.join("").length).toBeLessThanOrEqual(56);
  });
});
