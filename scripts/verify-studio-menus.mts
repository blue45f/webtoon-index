/**
 * scripts/verify-studio-menus.mts
 * Desktop headless check: Studio application menus + left rail + menu-driven popovers.
 *
 * Desktop IA (workflow optimization 2026-09-05):
 * - Catalogue: 17 specification groups + AI remains the complete command inventory.
 * - Presentation: ten workflow titles. Fourteen catalogue groups are owned by six
 *   composites: 파일←파일·협업, 편집←편집·선택·변형, 보기←보기·캔버스·창,
 *   삽입←텍스트·벡터·3D, 만화←만화·애니메이션, 효과←필터.
 * - AI remains a standalone title; every source group keeps its caption and row ids.
 * - Toolbelt workflow is insert → reference/3D → scene/style → AI.
 *
 * Run: pnpm exec tsx scripts/verify-studio-menus.mts
 * Expects production build in dist/ (vite preview).
 */
import { spawn, type ChildProcess } from "node:child_process";

import { chromium, type Locator, type Page } from "playwright";

import {
  STUDIO_MAIN_MENU_COMPOSITE_GROUPS,
  STUDIO_MAIN_MENU_PRESENTATION_ORDER,
  studioMainMenuPresentedTitleFor,
} from "../apps/web/src/domains/creator/studio-main-menu-presentation";

import { findFreePort, waitForServer } from "./lib/studio-verify-preview-harness.mjs";

import type { StudioMainMenuCompositeGroupId } from "../apps/web/src/domains/creator/studio-main-menu-presentation";

const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";

interface CatalogueGroup {
  /** §15.3 catalogue group id — the key the presentation folds on. */
  readonly id: string;
  /**
   * Korean group name. For a title that stands on its own this is the menubar
   * label; inside a composite dropdown it is the section caption printed above
   * the group's first row (`data-studio-main-menu-section`).
   */
  readonly caption: string;
  readonly items: readonly string[];
}

/**
 * Every catalogue group and every row it must still expose. Rows are asserted under
 * whichever title now owns them — folding two tables into one must never drop a row,
 * so `buildPresentedMenus()` re-reports any group the presentation does not place.
 */
const CATALOGUE_GROUPS: readonly CatalogueGroup[] = [
  {
    id: "file",
    caption: "파일",
    items: [
      "초안 저장",
      "게시",
      "프로젝트 가져오기…",
      "PSD 가져오기…",
      "ORA / CBZ / WILL 가져오기…",
      "프로젝트 센터…",
      "내보내기 / 다운로드",
      "백업 (.json)",
      "빠른 시작 · 새 작업…",
      "버전 체크포인트…",
      "게시 패키지…",
      "에셋 권리 감사…",
    ],
  },
  {
    id: "edit",
    caption: "편집",
    items: [
      "실행취소",
      "다시실행",
      "잘라내기",
      "복사",
      "붙여넣기",
      "현재 위치에 붙여넣기",
      "선택 제거",
      "복제",
      "작업 내역",
      "펜 압력 설정…",
      "애플리케이션 설정…",
      "자동 액션 · 매크로…",
    ],
  },
  {
    id: "view",
    caption: "보기",
    items: [
      "확대",
      "축소",
      "왼쪽으로 90° 회전",
      "오른쪽으로 90° 회전",
      "화면에 맞게 조정",
      "실제 픽셀 (100%)",
      "현재 보기 저장",
      "제작 인사이트…",
      "미니맵 · 탐색",
      "밑그림 오버레이 (이메레스)",
    ],
  },
  { id: "canvas", caption: "캔버스", items: ["캔버스 크기 · 문서 설정…"] },
  {
    id: "layer",
    caption: "레이어",
    items: [
      "이미지…",
      "레이어 · 맨 위로",
      "레이어 · 맨 뒤로",
      "레이어 자르기…",
      "레이어 마스크 편집…",
      "나만 숨긴 레이어 모두 표시",
    ],
  },
  { id: "select", caption: "선택", items: ["모두 선택", "선택 해제", "선택 반전"] },
  { id: "transform", caption: "변형", items: ["선택 변형"] },
  {
    id: "brush",
    caption: "그리기",
    items: [
      "펜",
      "지우개",
      "채우기",
      "스마트 도형",
      "브러시 프리셋 목록…",
      "브러시 스튜디오…",
      "자연 매체 · 안료…",
      "내 브러시…",
      "브러시 가져오기 (ABR · MYB · KPP)…",
      "배경 · 톤",
      "팔레트 · 브랜드",
    ],
  },
  {
    id: "filter",
    caption: "필터",
    items: [
      "마지막 필터…",
      "가우시안 블러",
      "모션 블러",
      "색조 / 채도 / 밝기",
      "명도 / 대비",
      "색상 커브",
      "레이어 보정 · 레벨",
      "색수차",
      "스케치 선화 정리",
      "노이즈 추가",
    ],
  },
  { id: "vector", caption: "벡터", items: ["요소 · 도형"] },
  {
    id: "text",
    caption: "텍스트",
    items: ["말풍선", "텍스트", "대사 일괄 편집…", "대사 번역 · 다국어…"],
  },
  {
    id: "comic",
    caption: "만화",
    items: [
      "새 페이지",
      "콜라주",
      "톤 · 스크린톤",
      "Writer Room · 대본…",
      "스토리보드 그리드…",
      "제작 바이블…",
      "마감·품질 검사…",
      "세로 스크롤 미리보기…",
      "애니매틱 타임라인…",
    ],
  },
  { id: "animation", caption: "애니메이션", items: ["프레임 애니메이션…"] },
  { id: "3d", caption: "3D", items: ["3D 데생 인형", "3D 캐릭터", "3D 배경"] },
  { id: "collaboration", caption: "협업", items: ["팀 · 공유 권한…", "페이지 검토 · 승인…"] },
  {
    id: "window",
    caption: "창",
    items: [
      "슈퍼심플 레이아웃",
      "전체 레이아웃",
      "패널 접어 넓게",
      "캔버스만",
      "템플릿 · 에셋",
      "참고 이미지 창",
      "멀티 디스플레이 작업공간…",
    ],
  },
  { id: "ai", caption: "AI", items: ["AI 어시스트", "스톡 이미지", "연동 설정"] },
  {
    id: "help",
    caption: "도움말",
    items: [
      "명령 · 속성 통합 검색",
      "CSP · Photoshop 용어 찾기",
      "현재 도구 도움말",
      "사용법 · 기능 튜토리얼",
      "단축키 · 기본 조작",
      "기기 · 브라우저 진단…",
      "복구 가이드…",
      "라이선스 · 서드파티 고지…",
      "버그 리포트 패키지…",
    ],
  },
];

/** Visible Korean titles for the six workflow composites. */
const COMPOSITE_TITLES: Readonly<Record<StudioMainMenuCompositeGroupId, string>> = {
  file: "파일",
  edit: "편집",
  view: "보기",
  insert: "삽입",
  comic: "만화",
  filter: "효과",
};

interface PresentedMenu {
  /** Presented (menubar) group id from the presentation order. */
  readonly id: string;
  /** Menubar title — also the dropdown's `aria-label`. */
  readonly title: string;
  /** `true` when several catalogue groups share this workflow title. */
  readonly composite: boolean;
  /** Catalogue groups this title owns, in the order their sections render. */
  readonly sections: readonly CatalogueGroup[];
}

const PRESENTED_ORDER: readonly string[] = STUDIO_MAIN_MENU_PRESENTATION_ORDER;

/**
 * 메뉴 IA 감사가 확정한 표시 제목 10종. 개수·순서·표기를 독립적으로 고정한다.
 * 행과 구획은 정본 카탈로그에서 유도해 중복 대장을 만들지 않는다.
 */
const PINNED_PRESENTED_TITLES: readonly string[] = [
  "파일",
  "편집",
  "보기",
  "삽입",
  "레이어",
  "그리기",
  "만화",
  "효과",
  "AI",
  "도움말",
];

function compositeSourceOrder(presentedId: string): readonly string[] | null {
  return (
    (STUDIO_MAIN_MENU_COMPOSITE_GROUPS as Readonly<Record<string, readonly string[]>>)[
      presentedId
    ] ?? null
  );
}

/**
 * Folds `CATALOGUE_GROUPS` exactly the way the product does: `studioMainMenuPresentedTitleFor`
 * decides which title owns a group and `STUDIO_MAIN_MENU_COMPOSITE_GROUPS` decides the section
 * order inside a composite dropdown. `orphans` catches any catalogue group the presentation
 * would not place, so a future re-fold cannot silently retire rows from this verifier.
 */
function buildPresentedMenus(): { menus: PresentedMenu[]; orphans: string[] } {
  const orphans: string[] = [];
  const owned = new Map<string, CatalogueGroup[]>();
  for (const group of CATALOGUE_GROUPS) {
    const presentedId = studioMainMenuPresentedTitleFor(group.id);
    if (!PRESENTED_ORDER.includes(presentedId)) {
      orphans.push(`${group.caption} (${group.id}) → ${presentedId}`);
      continue;
    }
    const bucket = owned.get(presentedId);
    if (bucket) bucket.push(group);
    else owned.set(presentedId, [group]);
  }

  const menus: PresentedMenu[] = [];
  for (const presentedId of PRESENTED_ORDER) {
    const sections = owned.get(presentedId);
    if (!sections || sections.length === 0) {
      orphans.push(`제시 제목에 대응하는 카탈로그 그룹 없음: ${presentedId}`);
      continue;
    }
    const sourceOrder = compositeSourceOrder(presentedId);
    const ordered = sourceOrder
      ? [...sections].sort(
        (a, b) => sourceOrder.indexOf(a.id) - sourceOrder.indexOf(b.id),
      )
      : sections;
    menus.push({
      id: presentedId,
      // A stand-alone title renders its own catalogue caption; a composite renders the
      // presentation's own word instead.
      title: sourceOrder
        ? COMPOSITE_TITLES[presentedId as StudioMainMenuCompositeGroupId]
        : ordered[0].caption,
      composite: sourceOrder !== null,
      sections: ordered,
    });
  }
  return { menus, orphans };
}

const { menus: PRESENTED_MENUS, orphans: PRESENTATION_ORPHANS } = buildPresentedMenus();

/**
 * 유도된 표시 제목이 고정 10종과 정확히(개수·순서·표기) 일치하는지 대조한다.
 * 불일치는 `assertMainMenus` 가 실패로 올린다 — 여기서 throw 하면 리포트가 인쇄되기 전에
 * 런이 죽어 어떤 제목이 어긋났는지 보이지 않는다.
 */
function pinnedTitleDrift(): string[] {
  const presented = PRESENTED_MENUS.map((menu) => menu.title);
  const matches =
    presented.length === PINNED_PRESENTED_TITLES.length &&
    presented.every((title, index) => title === PINNED_PRESENTED_TITLES[index]);
  if (matches) return [];
  return [
    `표시 제목 10종 계약 위반 — 기대: [${PINNED_PRESENTED_TITLES.join(" ")}] / 실제: [${presented.join(" ")}]`,
  ];
}

const PRESENTATION_TITLE_DRIFT = pinnedTitleDrift();

/**
 * Menubar title that currently owns a catalogue group (예: "canvas" → 보기). An unmapped group
 * falls back to its own caption instead of throwing: `PRESENTATION_ORPHANS` already reports
 * that case as a failure, and a throw here would abort the run before the report is printed.
 */
function presentedTitleFor(catalogueGroupId: string): string {
  const presentedId = studioMainMenuPresentedTitleFor(catalogueGroupId);
  const menu = PRESENTED_MENUS.find((entry) => entry.id === presentedId);
  if (menu) return menu.title;
  const group = CATALOGUE_GROUPS.find((entry) => entry.id === catalogueGroupId);
  return group?.caption ?? catalogueGroupId;
}

/** Left vertical rail — primary tool surface on desktop. */
const RAIL_TOOLS = [
  "선택 (V)",
  "펜 (B)",
  "지우개 (E)",
  // Fill: when no raster is selected the aria-label becomes the guard reason (still exposed).
  { anyOf: ["채우기 (G)", "래스터 이미지 레이어를 먼저 선택하세요."] },
  "스포이드 (I / Alt+클릭)",
  { anyOf: ["스마트 도형 켜기", "스마트 도형 끄기"] },
  "사각형 도형",
  "타원 도형",
  "텍스트 추가",
  "말풍선 추가",
  "이미지 추가",
  "참고 이미지",
] as const;

/**
 * Open via main menu → assert popover chrome appears.
 *
 * Entries name the CATALOGUE group that owns the row; the runner resolves the menubar
 * title through the presentation, so a row that moves under a composite title (AI now
 * opens from 도구) keeps working without editing this table.
 */
const MENU_DRIVEN_POPOVERS: {
  groupId: string;
  item: string;
  /** Prefer unique headers so menubar labels are not false positives. */
  expectVisible: string[];
  expectDialogName?: string;
}[] = [
  {
    groupId: "window",
    item: "템플릿 · 에셋",
    expectVisible: ["템플릿", "이메레스", "장면", "클립", "효과"],
  },
  {
    groupId: "brush",
    item: "배경 · 톤",
    expectVisible: ["배경 편집"],
  },
  {
    groupId: "brush",
    item: "팔레트 · 브랜드",
    expectVisible: ["스타일", "팔레트", "브랜드"],
  },
  {
    groupId: "ai",
    item: "AI 어시스트",
    expectVisible: ["AI 연동", "어시스트", "스톡"],
  },
  {
    groupId: "file",
    item: "프로젝트 센터…",
    expectVisible: ["프로젝트 센터", "백업 · 기획 · 제작 · 검수 · 게시"],
    expectDialogName: "프로젝트 센터",
  },
];

function log(msg: string) {
  console.log(`[verify-menus] ${msg}`);
}

async function dismissOverlays(page: Page) {
  for (const text of ["나중에", "닫기", "예시로 시작", "빈 캔버스", "확인"]) {
    try {
      const el = page.getByRole("button", { name: text }).first();
      if (await el.isVisible({ timeout: 300 })) {
        await el.click({ timeout: 600 });
        await page.waitForTimeout(200);
      }
    } catch {
      /* optional */
    }
  }
  await page.keyboard.press("Escape").catch(() => undefined);
}

/**
 * Resolves once the element's box has stopped moving for `quietMs`. Playwright's own
 * stability check only spans two animation frames, which is shorter than the gap between
 * the pointerdown and mouseup it dispatches on a loaded runner.
 */
async function waitForStableBox(target: Locator, quietMs: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let last = await target.boundingBox();
  let quietSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await target.page().waitForTimeout(50);
    const next = await target.boundingBox();
    const same = Boolean(last && next)
      && last!.x === next!.x && last!.y === next!.y
      && last!.width === next!.width && last!.height === next!.height;
    if (!same) quietSince = Date.now();
    last = next;
    if (next && Date.now() - quietSince >= quietMs) return;
  }
}

async function openMainMenuGroup(page: Page, label: string): Promise<void> {
  const nav = page.locator('[data-studio-main-menu="true"]');
  await nav.waitFor({ state: "visible", timeout: 15000 });
  // Close any open group first
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(80);
  const btn = nav.getByRole("menuitem", { name: label, exact: true });
  const menu = page.locator(`[role="menu"][aria-label="${label}"]`);
  // The workspace chip to the left of the titles grows by a "변경됨"/"세션" badge once the
  // workspace preferences settle after a cold load. Traced on CI's Chrome build (2026-09-06):
  // when that badge lands between the pointerdown and the mouseup of the first click, every
  // title shifts ~38px, the click falls on the bar instead of the button and no menu opens,
  // although every later open settles in well under 100ms. Let the title hold still first and
  // retry a click that was swallowed that way; a menu that never opens still fails.
  await waitForStableBox(btn, 350, 4000);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await btn.click({ timeout: 5000 });
    const opened = await menu
      .waitFor({ state: "visible", timeout: attempt === 0 ? 2500 : 5000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
    if ((await btn.getAttribute("aria-expanded").catch(() => null)) === "true") {
      // The click landed and the dropdown is on its way; do not toggle it shut again.
      await menu.waitFor({ state: "visible", timeout: 5000 });
      return;
    }
    if (attempt === 0) {
      log(`  retry: 메인 메뉴 [${label}] 첫 클릭이 제목 이동에 밀려 무시됨 — 안정화 후 다시 클릭`);
      await waitForStableBox(btn, 350, 4000);
    }
  }
  throw new Error(`메인 메뉴 [${label}] 열기 실패: 다시 클릭해도 메뉴가 열리지 않음`);
}

async function hasVisibleMenuItem(menu: Locator, name: string): Promise<boolean> {
  for (const role of ["menuitem", "menuitemcheckbox", "menuitemradio"] as const) {
    // Shortcut badges are intentionally part of the rendered row and therefore extend the
    // computed accessible name (for example `초안 저장 ⌘S`).  Keep the semantic-role check while
    // requiring the row's visible label span to match exactly; a partial role-name query alone
    // would let `게시` pass by finding `게시 패키지…`.
    const matches = menu.getByRole(role, { name, exact: false });
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      const row = matches.nth(index);
      // Scope the exact text lookup to this row. Passing a locator rooted at `menu` into
      // `filter({ has })` would look for a nested menu below the row and incorrectly return zero.
      if ((await row.getByText(name, { exact: true }).count()) === 0) continue;
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      if (await row.isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

/**
 * Section caption inside a composite dropdown. The caption is no longer hidden from
 * assistive tech: `StudioMainMenu` wraps each source catalogue group in a
 * `role="group"` whose `aria-labelledby` points at the caption node (which still carries
 * `data-studio-main-menu-section`), so the caption *is* the section's accessible name and
 * the rows keep their own `menuitem` roles.
 *
 * Given both handles, the accessible query is the one worth making: it passes only when
 * the wrapper still has the group role AND `aria-labelledby` still resolves to a node
 * holding exactly this caption — delete the caption and the name resolves to nothing, so
 * the check fails, which is the property this helper owes its caller. A bare
 * `[data-studio-main-menu-section="…"]` lookup is weaker in the direction that matters
 * now: it would stay green if the labelling broke and the composite dropdown collapsed
 * back into one unannounced flat list of ~15 rows.
 *
 * The visibility pass is still required — an accessible name says nothing about the
 * caption being drawn — and it is scoped inside the matched group, using the data
 * attribute purely as the pointer to the labelling node.
 */
async function hasVisibleSectionCaption(menu: Locator, caption: string): Promise<boolean> {
  const groups = menu.getByRole("group", { name: caption, exact: true });
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const node = groups
      .nth(index)
      .locator(`[data-studio-main-menu-section="${caption}"]`)
      .first();
    if ((await node.count()) === 0) continue;
    await node.scrollIntoViewIfNeeded().catch(() => undefined);
    if (await node.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function hasVisibleText(page: Page, text: string): Promise<boolean> {
  const matches = page.getByText(text);
  const count = await matches.count();
  for (let index = 0; index < count; index += 1) {
    if (await matches.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * 고정 내보내기 옵션 컨트롤 — 액션 레인의 그것 하나.
 *
 * 이름만으로는 못 집는다: §15.3 커맨드 바가 사용자 설정이라 같은 명령이 슬롯에도 놓일 수
 * 있고, Playwright 의 `name` 은 기본이 **부분 일치**라 슬롯의 한정 이름("슬롯 4: 내보내기
 * 옵션")까지 함께 걸려 strict mode 위반이 된다. 제품은 두 컨트롤을 서로 다른 접근명으로
 * 갈라 놓았으므로(`StudioMenubarContent` 의 `resolveStudioCommandBarSlotNames`), 검증기도
 * "액션 레인의 정확한 이름" 이라는 원래 뜻 그대로 좁혀서 묻는다.
 */
function exportOptionsTrigger(page: Page) {
  return page
    .locator('[data-studio-menubar-actions="true"]')
    .getByRole("button", { name: "내보내기 옵션", exact: true });
}

async function assertChrome(page: Page): Promise<string[]> {
  const failures: string[] = [];
  const checks: { name: string; ok: () => Promise<boolean> }[] = [
    {
      name: "앱 메뉴바",
      ok: async () => page.locator('[data-studio-app-menubar="true"]').isVisible(),
    },
    {
      name: "메인 메뉴",
      ok: async () => page.locator('[data-studio-main-menu="true"]').isVisible(),
    },
    {
      name: "툴벨트 DOM 마운트 (데스크톱은 오프스크린)",
      ok: async () => (await page.locator('[data-studio-tool-belt="true"]').count()) > 0,
    },
    {
      name: "좌측 툴 레일",
      ok: async () =>
        (await page.locator('[data-studio-tool-rail="true"]').isVisible().catch(() => false)) ||
        (await page.getByRole("button", { name: "펜 (B)" }).isVisible().catch(() => false)),
    },
    {
      name: "다운로드",
      ok: async () => page.getByRole("button", { name: /다운로드/ }).first().isVisible(),
    },
    {
      name: "내보내기 옵션",
      ok: async () => exportOptionsTrigger(page).isVisible(),
    },
  ];
  for (const c of checks) {
    if (!(await c.ok().catch(() => false))) failures.push(`크롬 미노출: ${c.name}`);
  }
  return failures;
}

async function assertMainMenus(page: Page): Promise<string[]> {
  const failures: string[] = [];
  // The pinned ten come first: if the presentation re-folded, every derived assertion
  // below is measuring the wrong menubar and this line is the only one that says so.
  for (const drift of PRESENTATION_TITLE_DRIFT) {
    failures.push(drift);
  }
  // A catalogue group the presentation refuses to place would silently stop being
  // asserted, so surface it as a failure rather than skipping it.
  for (const orphan of PRESENTATION_ORPHANS) {
    failures.push(`메뉴 표현 매핑 누락: ${orphan}`);
  }

  const nav = page.locator('[data-studio-main-menu="true"]');
  if (!(await nav.isVisible().catch(() => false))) {
    failures.push("메인 메뉴 nav 미노출 (lg 이상 뷰포트 필요)");
    return failures;
  }

  // Presented titles are always visible. Folded catalogue groups remain section captions,
  // while AI stays a first-class title.
  const triggerCount = await nav.locator("[data-studio-main-menu-trigger]").count();
  if (triggerCount !== PINNED_PRESENTED_TITLES.length) {
    failures.push(
      `메인 메뉴 제목 수 불일치: 기대 ${PINNED_PRESENTED_TITLES.length} / 실제 ${triggerCount}`,
    );
  }

  for (const menu of PRESENTED_MENUS) {
    if (!(await nav.getByRole("menuitem", { name: menu.title, exact: true }).isVisible().catch(() => false))) {
      failures.push(`메인 메뉴 그룹 버튼 미노출: ${menu.title}`);
    }
  }

  for (const presented of PRESENTED_MENUS) {
    try {
      await openMainMenuGroup(page, presented.title);
      const menu = page.locator(`[role="menu"][aria-label="${presented.title}"]`);
      for (const section of presented.sections) {
        // Only a composite dropdown captions its sections; a stand-alone title's caption
        // is the menubar label itself and is not repeated inside the panel.
        if (presented.composite && !(await hasVisibleSectionCaption(menu, section.caption))) {
          failures.push(`메인 메뉴 [${presented.title}] 섹션 캡션 없음: ${section.caption}`);
        }
        for (const item of section.items) {
          const visible = await hasVisibleMenuItem(menu, item);
          if (!visible) {
            const where = presented.composite
              ? `${presented.title} ▸ ${section.caption}`
              : presented.title;
            failures.push(`메인 메뉴 [${where}] 항목 없음: ${item}`);
          }
        }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
    } catch (err) {
      failures.push(
        `메인 메뉴 [${presented.title}] 열기 실패: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return failures;
}

async function assertReferenceWindowToggle(page: Page): Promise<string[]> {
  const failures: string[] = [];
  const panel = page.getByRole("region", { name: "포즈 참고 보드" });
  // 창 is owned by 보기; resolve through the presentation so this check follows the IA.
  const windowTitle = presentedTitleFor("window");
  const openWindowMenu = async (): Promise<Locator> => {
    await openMainMenuGroup(page, windowTitle);
    return page
      .locator(`[role="menu"][aria-label="${windowTitle}"]`)
      .locator('[data-studio-menu-item-id="reference-window"]');
  };

  let row = await openWindowMenu();
  if ((await row.getAttribute("role")) !== "menuitemcheckbox") {
    failures.push("참고 이미지 창이 menuitemcheckbox 의미를 노출하지 않음");
  }
  if ((await row.getAttribute("aria-checked")) === "true") {
    await row.click();
    await panel.waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
    row = await openWindowMenu();
  }
  if ((await row.getAttribute("aria-checked")) !== "false") {
    failures.push("참고 이미지 창 닫힘 상태를 aria-checked=false로 노출하지 않음");
  }

  await row.click();
  const openedAt = Date.now();
  const immediateFeedback = page.locator(
    '[data-studio-reference-panel-loading="true"], [role="region"][aria-label="포즈 참고 보드"]',
  );
  const feedbackVisible = await immediateFeedback.first()
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (!feedbackVisible) {
    failures.push("참고 이미지 창을 여는 동안 즉각적인 로딩 피드백을 노출하지 않음");
  }
  const panelVisible = await panel
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!panelVisible) {
    failures.push("창 → 참고 이미지 창으로 포즈 참고 보드를 열 수 없음");
    return failures;
  }

  row = await openWindowMenu();
  if ((await row.getAttribute("aria-checked")) !== "true") {
    failures.push("참고 이미지 창 열림 상태를 aria-checked=true로 노출하지 않음");
  }
  await row.click();
  await panel.waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
  if (await panel.isVisible().catch(() => false)) {
    failures.push("창 → 참고 이미지 창으로 포즈 참고 보드를 닫을 수 없음");
  }

  if (failures.length === 0) {
    log(`  reference window toggle ok: open + checked + close (${Date.now() - openedAt}ms)`);
  }
  return failures;
}

async function assertRailTools(page: Page): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of RAIL_TOOLS) {
    if (typeof entry === "string") {
      const byLabel = page.getByRole("button", { name: entry }).first();
      const byTitle = page.locator(`[title="${entry}"]`).first();
      const visible =
        (await byLabel.isVisible().catch(() => false)) ||
        (await byTitle.isVisible().catch(() => false));
      if (!visible) {
        if (entry === "이미지 추가") {
          const img = page.getByText("이미지 추가", { exact: true }).first();
          if ((await img.count().catch(() => 0)) > 0) continue;
        }
        failures.push(`좌측 레일 도구 미노출: ${entry}`);
      }
      continue;
    }
    const ok = await Promise.any(
      entry.anyOf.map(async (label) => {
        const visible =
          (await page.getByRole("button", { name: label }).first().isVisible().catch(() => false)) ||
          (await page.locator(`[title="${label}"]`).first().isVisible().catch(() => false));
        if (!visible) throw new Error("miss");
        return true;
      })
    ).catch(() => false);
    if (!ok) failures.push(`좌측 레일 도구 미노출: ${entry.anyOf.join(" | ")}`);
  }
  return failures;
}

async function closeFloatingUi(page: Page) {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(80);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.mouse.click(24, 120);
  await page.waitForTimeout(120);
}

async function assertMenuDrivenPopovers(page: Page): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of MENU_DRIVEN_POPOVERS) {
    const title = presentedTitleFor(entry.groupId);
    try {
      await closeFloatingUi(page);
      await openMainMenuGroup(page, title);
      const menu = page.locator(`[role="menu"][aria-label="${title}"]`);
      await menu.getByRole("menuitem", { name: entry.item }).click({ timeout: 4000 });
      // Lazy panels + fixed popovers need a beat after main-menu close
      await page.waitForTimeout(700);

      if (entry.expectDialogName) {
        const dialog = page.getByRole("dialog", { name: entry.expectDialogName });
        await dialog.waitFor({ state: "visible", timeout: 5000 });
      }

      let matched = 0;
      for (const text of entry.expectVisible) {
        if (await hasVisibleText(page, text)) matched += 1;
      }
      if (matched === 0) {
        failures.push(
          `메뉴 연동 팝오버 내용 없음: ${title} → ${entry.item} (expected ${entry.expectVisible.join(", ")})`
        );
      } else {
        log(`  popover ok: ${title} → ${entry.item} (${matched}/${entry.expectVisible.length} markers)`);
      }
      await closeFloatingUi(page);
    } catch (err) {
      failures.push(
        `메뉴 연동 팝오버 실패 (${title}/${entry.item}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return failures;
}

async function assertWorkspaceDeviceEditor(page: Page): Promise<string[]> {
  const failures: string[] = [];
  try {
    await closeFloatingUi(page);
    const trigger = page.getByRole("button", { name: /^작업공간:/ }).first();
    await trigger.click({ timeout: 4000 });

    const quickDialog = page.getByRole("dialog", { name: "작업공간" });
    await quickDialog.waitFor({ state: "visible", timeout: 5000 });
    await quickDialog.getByRole("button", { name: "작업공간 관리", exact: true }).click({
      timeout: 4000,
    });

    const management = page.getByRole("dialog", { name: "작업공간 관리" });
    await management.waitFor({ state: "visible", timeout: 5000 });
    await management.getByRole("button", { name: "전환 설정", exact: true }).click({
      timeout: 4000,
    });

    for (const marker of ["모바일 주요 도구 위치", "기기별 배치"]) {
      if (!(await management.getByText(marker, { exact: true }).first().isVisible().catch(() => false))) {
        failures.push(`작업공간 기기 편집기 표식 미노출: ${marker}`);
      }
    }
    if (!(await management.getByRole("group", { name: "조정할 기기" }).isVisible().catch(() => false))) {
      failures.push("작업공간 기기 편집기 표식 미노출: 조정할 기기");
    }
    for (const device of ["펜 디스플레이", "모바일", "키보드", "마우스", "터치"]) {
      const choice = management.getByRole("button", {
        name: new RegExp(`^${device}(?: ·|$)`),
      });
      if (!(await choice.isVisible().catch(() => false))) {
        failures.push(`작업공간 기기 축 선택지 미노출: ${device}`);
      }
    }
    for (const side of ["왼쪽", "오른쪽"]) {
      const choice = management.getByRole("button", {
        name: new RegExp(`모바일 주요 도구 ${side} 배치`),
      });
      if (!(await choice.isVisible().catch(() => false))) {
        failures.push(`모바일 손잡이 선택지 미노출: ${side}`);
      }
    }

    if (failures.length === 0) log("  workspace device editor ok: 5 devices + handedness");
    await management.getByRole("button", { name: "작업공간 메뉴 닫기", exact: true }).click();
    await page.waitForTimeout(100);
  } catch (err) {
    failures.push(
      `작업공간 기기 편집기: ${err instanceof Error ? err.message : String(err)}`,
    );
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  return failures;
}

async function assertDrawOptionsBar(page: Page): Promise<string[]> {
  const failures: string[] = [];
  try {
    await page.getByRole("button", { name: "펜 (B)" }).click({ timeout: 4000 });
    await page.waitForTimeout(400);
    const bar =
      (await page.locator('[data-studio-draw-options="true"]').isVisible().catch(() => false)) ||
      (await page.getByText(/안정화|브러시|크기|불투명/).first().isVisible().catch(() => false)) ||
      (await page.getByRole("slider").first().isVisible().catch(() => false));
    if (!bar) failures.push("펜 선택 후 드로잉 옵션 바 미노출");
    else log("  draw options bar ok");
  } catch (err) {
    failures.push(`드로잉 옵션 바: ${err instanceof Error ? err.message : String(err)}`);
  }
  return failures;
}

async function assertExportOptions(page: Page): Promise<string[]> {
  const failures: string[] = [];
  try {
    await exportOptionsTrigger(page).click({ timeout: 4000 });
    await page.waitForTimeout(350);
    const ok =
      (await page.getByText(/배율|포맷|PNG|JPG|WebP|투명/).first().isVisible().catch(() => false)) ||
      (await page.locator("text=PNG").first().isVisible().catch(() => false));
    if (!ok) failures.push("내보내기 옵션 패널 미노출");
    else log("  export options ok");
    await page.keyboard.press("Escape");
  } catch (err) {
    failures.push(`내보내기 옵션: ${err instanceof Error ? err.message : String(err)}`);
  }
  return failures;
}

async function main() {
  const port = await findFreePort({ unavailableMessage: "could not allocate port" });
  const url = `http://127.0.0.1:${port}/studio`;
  let child: ChildProcess | null = null;
  let exitCode: number;

  try {
    child = spawn(
      "pnpm",
      ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    child.stderr?.on("data", (d) => {
      const s = String(d);
      if (!s.includes("ECONNREFUSED") && !s.includes("proxy error")) process.stderr.write(d);
    });
    await waitForServer(`http://127.0.0.1:${port}/`, {
      timeoutMs: 20000,
      notReadyMessage: `preview not ready: http://127.0.0.1:${port}/`,
    });
    log(`preview ready @ ${url}`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.addInitScript(({ key }) => {
      try {
        window.localStorage.setItem(key, "1");
        // The assertions below intentionally use Korean product labels. Chromium's CI locale is
        // commonly en-US, so pin the persisted app locale instead of depending on the host.
        window.localStorage.setItem(
          "toonspectrum-lang",
          JSON.stringify({ state: { lang: "ko" }, version: 0 })
        );
        // Full density so every main-menu → toolbar popover host is mounted.
        window.localStorage.setItem(
          "toonspectrum-studio-ui-density:v1",
          JSON.stringify({ mode: "full" })
        );
      } catch {
        /* ignore */
      }
    }, { key: QUICKSTART_KEY });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(900);
    await dismissOverlays(page);

    await page.locator('[data-studio-editor="true"], [data-studio-app-shell="true"]').first().waitFor({
      state: "attached",
      timeout: 20000,
    });
    await page.locator('[data-studio-main-menu="true"]').waitFor({ state: "visible", timeout: 20000 });

    const failures = [
      ...(await assertChrome(page)),
      ...(await assertMainMenus(page)),
      ...(await assertReferenceWindowToggle(page)),
      ...(await assertRailTools(page)),
      ...(await assertMenuDrivenPopovers(page)),
      ...(await assertWorkspaceDeviceEditor(page)),
      ...(await assertDrawOptionsBar(page)),
      ...(await assertExportOptions(page)),
    ];

    if (failures.length === 0) {
      log("PASS: optimized menus exposed (10 titles + sections + rail + popovers + draw options + export)");
      exitCode = 0;
    } else {
      log(`FAIL (${failures.length}):`);
      for (const f of failures) log(`  - ${f}`);
      const menubar = await page.locator('[data-studio-app-menubar="true"]').innerText().catch(() => "(none)");
      log(`menubar text:\n${menubar}`);
      exitCode = 1;
    }

    await browser.close();
  } catch (err) {
    console.error("[verify-menus] fatal:", err);
    exitCode = 1;
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 500).unref?.();
    }
  }
  process.exit(exitCode);
}

void main();
