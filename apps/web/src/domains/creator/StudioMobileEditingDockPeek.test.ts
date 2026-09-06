import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 1행 도크는 44px 타깃 10개(+구분선 3개)라 어떤 폰에서도 한 줄에 들어가지 않는다. 도달은
 * 가로 스크롤로 가능하지만, 트랙이 버튼 시작점 바로 뒤에서 끝나면 노출이 몇 px 밖에 안 되고
 * 그 몇 px 은 20px 스크롤 페이드에 완전히 덮여 "여기서 끝"으로 읽힌다. 실측(빌드 후 브라우저):
 *
 *   360px · 간격 4px → 트랙 348px, 8번째(다시실행) 시작 344px → 노출 4px  (❌ 사라짐)
 *   360px · 간격 2px → 트랙 348px, 8번째(다시실행) 시작 328px → 노출 20px (✅ 반 버튼)
 *   390px · 간격 4px → 트랙 378px, 8번째(다시실행) 시작 344px → 노출 34px (✅)
 *
 * 그래서 4px 간격은 390px 이상에서만 켠다. 아래 계산은 그 산술을 고정해, 간격/브레이크포인트를
 * 되돌리면 실패한다.
 */
const DOCK_SOURCE = readFileSync(
  join(process.cwd(), "apps/web/src/domains/creator/StudioMobileEditingDock.tsx"),
  "utf8"
);

const BUTTON = 44;
/** 좌우 패딩 pl/pr-[max(0.375rem,safe-area)] = 6px + 6px. */
const HOST_PADDING = 12;
/** 1행 순서: 선택 | 펜 픽셀 지우개 채우기 도형 | 되돌리기 다시실행 | 브러시, 그리고 펼치기. */
const DIVIDERS_BEFORE_INDEX = [0, 1, 1, 1, 1, 1, 2, 2, 3, 3];

function itemLeft(index: number, gap: number): number {
  const dividers = DIVIDERS_BEFORE_INDEX[index]!;
  // 구분선은 1px 폭 + 양옆 간격을 차지한다.
  return index * (BUTTON + gap) + dividers * (1 + gap);
}

function visiblePx(index: number, viewport: number, gap: number): number {
  const track = viewport - HOST_PADDING;
  return Math.max(0, Math.min(BUTTON, track - itemLeft(index, gap)));
}

/** 소스가 선언한 브레이크포인트를 그대로 읽어 간격을 되돌린다. */
function gapFor(viewport: number): number {
  const match = /min-\[(\d+)px\]:gap-1/.exec(DOCK_SOURCE);
  if (!match) throw new Error("도크 1행의 간격 브레이크포인트를 찾지 못했습니다.");
  return viewport >= Number(match[1]) ? 4 : 2;
}

describe("studio mobile dock scroll affordance", () => {
  it("declares the primary row with a 2px base gap that widens only on wide phones", () => {
    const row = DOCK_SOURCE.slice(
      DOCK_SOURCE.indexOf('data-studio-mobile-dock-scroll="primary"') - 1200
    ).slice(0, 1300);
    expect(row).toContain("gap-0.5");
    expect(row).toContain("min-[390px]:gap-1");
    // 44px 터치 타깃은 어떤 브레이크포인트에서도 줄어들지 않는다.
    expect(DOCK_SOURCE).toContain("min-h-11 min-w-11 shrink-0");
  });

  for (const viewport of [320, 360, 390]) {
    it(`exposes a partial next button at ${viewport}px`, () => {
      const gap = gapFor(viewport);
      const track = viewport - HOST_PADDING;
      const partial = DIVIDERS_BEFORE_INDEX
        .map((_, index) => ({ index, visible: visiblePx(index, viewport, gap) }))
        .filter(({ visible }) => visible > 0 && visible < BUTTON);
      // 잘리는 버튼이 정확히 하나 있고, 그 노출은 페이드(20px)에 삼켜지지 않을 만큼 넓다.
      expect(partial).toHaveLength(1);
      expect(partial[0]!.visible).toBeGreaterThanOrEqual(18);
      // 그리고 실제로 넘치는 상태여야 스크롤 큐가 의미를 갖는다.
      expect(itemLeft(DIVIDERS_BEFORE_INDEX.length - 1, gap) + BUTTON).toBeGreaterThan(track);
    });
  }

  it("keeps both scroll cues legible rather than near-transparent", () => {
    // 페이드 위 화살표가 흐리면 "더 있음" 신호가 사라진다.
    expect(DOCK_SOURCE).not.toContain("text-fg-2/70 opacity-0 transition-opacity");
    expect(DOCK_SOURCE.match(/data-studio-mobile-scroll-cue=/g)).toHaveLength(2);
    expect(DOCK_SOURCE).toContain("text-[0.8rem] font-black leading-none text-fg-2 opacity-0");
  });
});
