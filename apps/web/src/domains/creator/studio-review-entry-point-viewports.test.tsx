// @vitest-environment jsdom
/**
 * 검수·미리보기 7종의 뷰포트별 도달성 계약.
 *
 * 왜 소스 텍스트 테스트로는 부족한가(`studio-tool-belt-reachability.test.ts`):
 * 그 파일은 문자열 인덱스로 호스트를 찾아 클래스 유무만 본다. 그래서
 * "트리거가 `max-sm:hidden` 이고 앱 메뉴바는 `md:flex` 이고 벨트는 몰입에서 숨는다"는
 * **각각은** 알지만, 셋이 겹쳐 430px 에서 진입점이 0개가 된다는 **결합 결과**는 보지 못했다.
 * 실제로 그 테스트는 "세 뷰포트 중 최소 하나"만 요구해 430px 구멍을 통과시켰다.
 *
 * 여기서는 실제로 렌더한 뒤 조상 체인의 클래스를 폭 W 에서 평가한다. 두 가지를 동시에 잡는다.
 *   1. 버튼이 아예 렌더되지 않는 회귀 (접근성 이름으로 찾으므로)
 *   2. 렌더되지만 조상이 `display:none` 이라 못 누르는 회귀 (폭별 클래스 평가)
 *
 * ## jsdom 의 한계와 그 대응
 * jsdom 에는 `matchMedia` 자체가 없고, `getBoundingClientRect()` 는 항상 0 사각형이며,
 * Tailwind 스타일시트가 로드되지 않아 `getComputedStyle().display` 는 언제나 UA 기본값이다.
 * 즉 기하·계산된 스타일 기반 가시성 판정은 jsdom 에서 전부 공허하다. 그래서 가시성을
 * **클래스 토큰에서** 유도한다 — 그 대가로 모델이 모르는 표현 방식(`print:hidden`,
 * `group-hover:hidden`, `[display:none]` 같은 것)이 들어오면 조용히 통과시킬 위험이 생긴다.
 * `parseDisplayToken()` 이 그 위험을 뒤집는다: 모르는 display 기법을 만나면 무시하지 않고
 * **throw** 한다. 회귀 방지 테스트가 회귀의 은신처가 되지 않게 하는 장치다.
 *
 * 실제 브라우저 기하(진짜 CSS·진짜 `matchMedia`·진짜 `getBoundingClientRect`)는 이 모델이
 * 대신할 수 없다. 그건 프로덕션 빌드를 띄워 확인한다:
 *   pnpm run build && pnpm exec vite preview --port 4399 --strictPort
 * 이 파일은 그 검증을 대체하는 게 아니라, 매 푸시마다 밀리초 단위로 도는 게이트다.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_PROJECT_REVIEW_ACTION_IDS } from "./studio-project-review-actions";
import { StudioMenubarContent } from "./StudioMenubarContent";
import { createProps } from "./StudioMenubarContent.test-fixture";
import { StudioToolHintPreferencesProvider } from "./StudioToolHint";

vi.mock("./studio-page-lazy-ui", () => ({
  StudioExportMenuPanel: () => <div data-studio-export-menu-panel="true" />,
  // `StudioMenubarContent.test.tsx` 는 이 컴포넌트를 `() => <nav />` 로 스텁하는데, 그러면
  // 호출부가 넘긴 className(= 뷰포트 게이트 그 자체)이 버려진다. 여기서는 그 게이트를
  // 평가하는 게 목적이므로 반드시 forward 한다. 실제 컴포넌트와 동일하게 자체 기본 클래스와
  // 합친다(StudioMainMenu.tsx:635).
  StudioMainMenu: ({ className }: { className?: string }) => (
    <nav
      aria-label="데스크톱 앱 메뉴"
      data-studio-main-menu-host="true"
      className={["flex min-w-max shrink-0 flex-nowrap items-center gap-0.5", className]
        .filter(Boolean)
        .join(" ")}
    />
  ),
  preloadStudioAssetMenuPanel: vi.fn(),
  preloadStudioExportMenuPanel: vi.fn(),
}));

vi.mock("./StudioWorkspaceMenuGate", () => ({
  StudioWorkspaceMenuGate: () => <button type="button">작업공간</button>,
}));

/** 진단 하네스가 실제로 조작한 폭 (`docs/perf/heavy-feature-findings.md` §4-1). */
const VIEWPORTS = [1_600, 900, 430] as const;

/** Tailwind 기본 브레이크포인트. `max-*` 는 `(max-width: bp - 0.02px)` 로 생성된다. */
const BREAKPOINTS = { sm: 640, md: 768, lg: 1_024, xl: 1_280, "2xl": 1_536 } as const;
type BreakpointName = keyof typeof BREAKPOINTS;

/** display 를 바꾸는 유틸리티. 이 목록에 없는 토큰은 display 와 무관하다고 본다. */
const DISPLAY_UTILITIES = new Set([
  "block", "inline-block", "inline", "flex", "inline-flex", "table", "inline-table",
  "table-caption", "table-cell", "table-column", "table-column-group", "table-footer-group",
  "table-header-group", "table-row-group", "table-row", "flow-root", "grid", "inline-grid",
  "contents", "list-item", "hidden",
]);

/** 우리가 폭 W 에서 평가할 수 있는 변형 접두사. */
const KNOWN_VARIANTS = new Set<string>([
  ...Object.keys(BREAKPOINTS),
  ...Object.keys(BREAKPOINTS).map((name) => `max-${name}`),
]);

interface DisplayToken {
  readonly utility: string;
  readonly variant: string | null;
  readonly important: boolean;
}

/**
 * `variant:variant:utility` 를 쪼갠다 — 단, `[...]` 안의 `:` 는 구분자가 아니다
 * (`[&::-webkit-scrollbar]:hidden` 의 `::` 를 변형 경계로 오해하면 안 된다).
 */
function splitVariants(token: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of token) {
    if (character === "[") depth += 1;
    else if (character === "]") depth -= 1;
    if (character === ":" && depth === 0) {
      segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  segments.push(current);
  return segments;
}

/**
 * display 토큰으로 파싱한다. display 유틸리티가 아니면 `null`.
 *
 * 모델이 평가할 수 없는 display 기법은 여기서 throw 한다 — 조용히 무시하면 그 순간
 * 이 테스트는 아무것도 지키지 않게 된다. 새 기법을 도입하려면 이 함수를 먼저 가르쳐야 한다.
 */
function parseDisplayToken(token: string): DisplayToken | null {
  if (/^\[display:/u.test(token) || /:\[display:/u.test(token)) {
    throw new Error(
      `[가시성 모델] 임의값 display 유틸리티 "${token}" 는 폭별로 평가할 수 없습니다. ` +
        "브레이크포인트 변형으로 바꾸거나 이 평가기를 확장하세요.",
    );
  }

  const segments = splitVariants(token);
  const rawUtility = segments.at(-1) ?? "";
  const important = rawUtility.startsWith("!");
  const utility = important ? rawUtility.slice(1) : rawUtility;
  if (!DISPLAY_UTILITIES.has(utility)) return null;

  const variants = segments.slice(0, -1);
  if (variants.length === 0) return { utility, variant: null, important };
  // `[&::-webkit-scrollbar]:hidden` 같은 의사요소 대상 변형은 요소 **자신의** display 를
  // 바꾸지 않는다(스크롤바 의사요소를 숨길 뿐). 도달성과 무관하므로 건너뛴다.
  // 반면 `[&>button]:hidden` 처럼 진짜 자식을 겨냥하는 임의 변형은 도달성에 영향을 주므로
  // 아래 throw 로 떨어뜨린다 — 모르는 것을 조용히 넘기지 않는다는 원칙은 유지된다.
  if (variants.some((variant) => /^\[.*::/u.test(variant))) return null;
  if (variants.length > 1 || !KNOWN_VARIANTS.has(variants[0] ?? "")) {
    throw new Error(
      `[가시성 모델] display 유틸리티 "${token}" 의 변형을 폭만으로 평가할 수 없습니다 ` +
        `(알고 있는 변형: ${[...KNOWN_VARIANTS].join(", ")}). ` +
        "폭 기반 변형으로 바꾸거나 이 평가기를 확장하세요.",
    );
  }
  return { utility, variant: variants[0] ?? null, important };
}

function variantAppliesAt(variant: string | null, width: number): boolean {
  if (variant === null) return true;
  if (variant.startsWith("max-")) {
    const name = variant.slice(4) as BreakpointName;
    return width < BREAKPOINTS[name];
  }
  return width >= BREAKPOINTS[variant as BreakpointName];
}

/**
 * 폭 W 에서 이 토큰이 얼마나 세게 이기는가.
 *
 * `cn()` 은 `twMerge(clsx(...))` 라(lib/utils.ts) 같은 변형 그룹 안의 충돌은 렌더 시점에
 * 이미 "마지막 승"으로 정리돼 있다. 남는 건 그룹 **사이**의 우선순위뿐이다:
 * `!important` > 브레이크포인트 변형 > 기본. 예) `cn("hidden md:flex", immersive && "!hidden")`
 * 는 1600px 비몰입에서 flex, 몰입에서 none 이어야 한다.
 */
function tokenWeight(token: DisplayToken): number {
  if (token.important) return 1_000_000;
  if (token.variant === null) return 0;
  const name = (token.variant.startsWith("max-") ? token.variant.slice(4) : token.variant) as BreakpointName;
  return 1_000 + BREAKPOINTS[name];
}

function displayAt(element: Element, width: number): string {
  let winner: { weight: number; utility: string } | null = null;
  for (const token of element.className.split(/\s+/u).filter(Boolean)) {
    const parsed = parseDisplayToken(token);
    if (parsed === null || !variantAppliesAt(parsed.variant, width)) continue;
    const weight = tokenWeight(parsed);
    // 동점이면 나중에 선언된 쪽이 이긴다(CSS 소스 순서).
    if (winner === null || weight >= winner.weight) winner = { weight, utility: parsed.utility };
  }
  return winner?.utility ?? "block";
}

/** 조상 체인 전체를 걸어 폭 W 에서 포인터로 닿을 수 있는지 판정한다. */
function isReachableAt(element: Element | null, width: number): boolean {
  if (element === null) return false;
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (displayAt(node, width) === "hidden") return false;
    if (node.hasAttribute("hidden") || node.hasAttribute("inert")) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
  }
  return true;
}

/**
 * 벨트에 있던 7종의 접근성 이름. 이름으로 찾는 이유: 사용자가 실제로 인지하는 것이 이름이고,
 * 버튼이 통째로 사라지는 회귀도 같은 단언 하나로 잡히기 때문이다.
 */
const REVIEW_ACTIONS = [
  { id: "anim-timeline", name: "다중 레이어 타임라인" },
  { id: "timelapse", name: "타임랩스 녹화" },
  { id: "storyboard-grid", name: "스토리보드 그리드 보기" },
  { id: "scroll-preview", name: "세로 스크롤 미리보기" },
  { id: "continuity", name: "마감·품질 검사" },
  { id: "comments", name: "문서 댓글" },
  { id: "page-review", name: "페이지 검토와 편집 잠금" },
] as const;

/**
 * 몰입 모드는 폰·태블릿 폭에서 기본 ON 이다(`studio-mobile-immersive.ts` — sessionStorage 에
 * "windowed" 가 없으면 true). `isMobile` 은 `(max-width: 1023px)` 라 900px 도 몰입이다.
 * 기본 상태에서 도달 가능해야 의미가 있으므로 몰입 값을 폭에서 유도한다.
 */
function defaultShellAt(width: number): { isMobile: boolean; mobileImmersive: boolean } {
  const isMobile = width <= 1_023;
  return { isMobile, mobileImmersive: isMobile };
}

function renderMenubarAt(width: number, overrides: Record<string, unknown> = {}) {
  const shell = defaultShellAt(width);
  return render(
    <StudioToolHintPreferencesProvider mode="compact" touchHoldDelayMs={640} reduceMotion>
      <StudioMenubarContent
        {...createProps({
          ...shell,
          // 시트를 연 상태로 렌더해야 7종 버튼이 DOM 에 존재한다. 트리거의 가시성은
          // 따로 검사하므로, 열어둔 것이 도달성을 부풀리지 않는다.
          projectActionsOpen: true,
          ...overrides,
        })}
      />
    </StudioToolHintPreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("검수·미리보기 진입점 — 뷰포트별 도달성", () => {
  it("선언된 7종과 렌더되는 7종이 일치한다", () => {
    expect(REVIEW_ACTIONS.map((action) => action.id)).toEqual([
      ...STUDIO_PROJECT_REVIEW_ACTION_IDS,
    ]);
  });

  describe.each(VIEWPORTS)("%dpx", (width) => {
    it("7종 모두 가시 진입점을 가진다", () => {
      renderMenubarAt(width);

      // 시트의 트리거("프로젝트 센터")가 보이지 않으면 시트 안의 버튼은 열 수 없다.
      const sheetTrigger = screen.getByRole("button", { name: "프로젝트 센터" });
      const sheetReachable = isReachableAt(sheetTrigger, width);

      const unreachable = REVIEW_ACTIONS.filter((action) => {
        const button = screen.getByRole("button", { name: action.name });
        expect(
          button.getAttribute("data-studio-project-action"),
          `${action.name} 의 안정 셀렉터가 사라졌습니다`,
        ).toBe(action.id);
        return !(sheetReachable && isReachableAt(button, width));
      });

      expect(
        unreachable.map((action) => action.name),
        `${width}px 기본 상태에서 포인터로 닿을 수 없는 기능`,
      ).toEqual([]);
    });
  });

  it("호스트별 가시성 지도를 스냅샷으로 고정한다", () => {
    const hostsAt = (width: number) => {
      const { unmount } = renderMenubarAt(width);
      const map = {
        "앱 메뉴바(보기 메뉴)": isReachableAt(
          document.querySelector('[data-studio-main-menu-host="true"]'),
          width,
        ),
        "프로젝트 센터 시트": isReachableAt(
          screen.getByRole("button", { name: "프로젝트 센터" }),
          width,
        ),
        "내보내기 옵션": screen
          .getAllByRole("button", { name: "내보내기 옵션" })
          .some((button) => isReachableAt(button, width)),
      };
      unmount();
      return map;
    };

    // 앱 메뉴바가 1600px 에서만 보이는 것은 의도된 설계다(몰입 모드는 1023px 이하 기본 ON).
    // 그래서 보기 메뉴는 데스크톱 발견성 경로일 뿐, 폰·태블릿의 유일한 경로가 될 수 없다.
    // 내보내기 옵션 셰브론은 모바일에서도 44px 타깃으로 남는다(`isMobile && "min-h-11 min-w-11"`) —
    // 430px 몰입 모드에서 닿는 것이 현재 계약이며, 예전 스냅샷의 false 는 그 승격 이전 값이었다.
    expect(Object.fromEntries(VIEWPORTS.map((w) => [w, hostsAt(w)]))).toMatchInlineSnapshot(`
      {
        "1600": {
          "내보내기 옵션": true,
          "앱 메뉴바(보기 메뉴)": true,
          "프로젝트 센터 시트": true,
        },
        "430": {
          "내보내기 옵션": true,
          "앱 메뉴바(보기 메뉴)": false,
          "프로젝트 센터 시트": true,
        },
        "900": {
          "내보내기 옵션": true,
          "앱 메뉴바(보기 메뉴)": false,
          "프로젝트 센터 시트": true,
        },
      }
    `);
  });

  it("몰입 모드를 끈 폰 폭에서도 도달성이 유지된다", () => {
    renderMenubarAt(430, { isMobile: true, mobileImmersive: false });

    const sheetTrigger = screen.getByRole("button", { name: "프로젝트 센터" });
    expect(isReachableAt(sheetTrigger, 430)).toBe(true);
  });

  describe("가시성 평가기", () => {
    it("모르는 display 기법은 무시하지 않고 실패시킨다", () => {
      expect(() => parseDisplayToken("print:hidden")).toThrow(/평가할 수 없습니다/u);
      expect(() => parseDisplayToken("group-hover:flex")).toThrow(/평가할 수 없습니다/u);
      expect(() => parseDisplayToken("[display:none]")).toThrow(/평가할 수 없습니다/u);
      expect(() => parseDisplayToken("md:[display:none]")).toThrow(/평가할 수 없습니다/u);
    });

    it("display 와 무관한 유틸리티는 통과시킨다", () => {
      for (const token of ["shrink-0", "gap-1.5", "min-h-11", "sm:grid-cols-3", "relative"]) {
        expect(parseDisplayToken(token)).toBeNull();
      }
    });

    it("의사요소만 겨냥한 변형은 요소 자신의 display 로 세지 않는다", () => {
      expect(parseDisplayToken("[&::-webkit-scrollbar]:hidden")).toBeNull();
      // 진짜 자식을 겨냥하는 임의 변형은 여전히 평가 불가로 실패해야 한다.
      expect(() => parseDisplayToken("[&>button]:hidden")).toThrow(/평가할 수 없습니다/u);
    });

    it("Tailwind 우선순위를 실제 호스트 클래스 문자열로 재현한다", () => {
      const menuHost = (immersive: boolean) =>
        ["flex min-w-max shrink-0 flex-nowrap items-center gap-0.5", "hidden min-w-max shrink-0 md:flex", immersive ? "!hidden" : ""]
          .filter(Boolean)
          .join(" ");
      const el = (className: string) => {
        const node = document.createElement("div");
        node.className = className;
        return node;
      };

      // 브레이크포인트 변형이 기본 `hidden` 을 이긴다.
      expect(displayAt(el(menuHost(false)), 1_600)).toBe("flex");
      // `!important` 는 브레이크포인트 변형을 이긴다 — 몰입에서는 폭과 무관하게 숨는다.
      expect(displayAt(el(menuHost(true)), 1_600)).toBe("hidden");
      expect(displayAt(el(menuHost(false)), 430)).toBe("hidden");
      // `max-*` 는 그 브레이크포인트 미만에서만 적용된다.
      expect(displayAt(el("relative shrink-0 max-sm:hidden"), 430)).toBe("hidden");
      expect(displayAt(el("relative shrink-0 max-sm:hidden"), 900)).toBe("block");
      // 벨트 호스트: 데스크톱은 lg:hidden, 몰입 폰은 max-lg:hidden.
      expect(displayAt(el("max-lg:hidden lg:hidden"), 1_600)).toBe("hidden");
      expect(displayAt(el("max-lg:hidden lg:hidden"), 430)).toBe("hidden");
      expect(displayAt(el("lg:hidden"), 430)).toBe("block");
    });
  });
});
