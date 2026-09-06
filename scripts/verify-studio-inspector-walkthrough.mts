/**
 * Inspector walkthrough — every control the inspector can present, driven in a
 * real browser, at desktop width and at the 360px mobile baseline.
 *
 * This is not a smoke test. For each control it answers three questions the
 * density work made it necessary to answer:
 *
 *   1. **Reachable?** What is the exact click/keyboard path from a freshly
 *      loaded Studio, and does any step block (collapsed with no affordance,
 *      needs a selection the artist cannot make yet, off-screen at 360px)?
 *   2. **Does it DO something?** Not "the button exists" — an observable state
 *      change: the document model, the layer list, a control's own value, the
 *      inspector's route, or a live-region announcement.
 *   3. **Round trip?** Where a control has an inverse, the inverse works.
 *
 * Run after `pnpm run build`:
 *   pnpm run verify:studio-inspector-walkthrough
 *
 * Findings that are real but out of scope for a hard gate are collected in
 * `notes` rather than failing the run, so the report stays honest about what it
 * could not exercise.
 *
 * `notes` never gate: only a `blocked` row reaches `report.failures` and sets a
 * non-zero exit code. So a control the harness could not drive because the path
 * into it is gone is a `blocked` row, never a note — a note there would let the
 * row silently disappear and the run still print `RESULT: OK`. Notes are only
 * for things outside the inspector's contract (e.g. this preview build cannot
 * create a document element to select).
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { preview, type PreviewServer } from "vite";

import { DIST_DIR } from "./lib/repo-paths.mjs";
import { findFreePort, waitForServer } from "./lib/studio-verify-preview-harness.mjs";

const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const UI_DENSITY_KEY = "toonspectrum-studio-ui-density:v1";
const LANGUAGE_KEY = "toonspectrum-lang";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const IMMERSIVE_SESSION_KEY = "toonspectrum-studio-mobile-immersive:v1";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SCRATCH =
  process.env.TOONSPECTRUM_INSPECTOR_WALKTHROUGH_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-inspector-walkthrough");

const PANEL = '[data-studio-sheet-id="props"]';
const NAVIGATOR = '[data-testid="studio-inspector-navigator"]';

/** The four collapsible groups the canvas panel gained. */
const CANVAS_SECTIONS = [
  "canvas.surface",
  "canvas.resize",
  "canvas.guide-lines",
  "canvas.style",
] as const;

type Verdict = "reachable" | "blocked" | "not-exercised";

interface ControlRow {
  /** Human name, as the artist sees it. */
  control: string;
  /** What must be true for the control to be on screen at all. */
  state: string;
  /** Click/keyboard path from a freshly loaded Studio. */
  path: string;
  verdict: Verdict;
  /** What observable change was asserted, or why none was. */
  effect: string;
  defect?: string;
}

interface Measurement {
  width: number;
  height: number;
}

interface WalkthroughReport {
  desktop: {
    panel: Measurement;
    /** Aside top → first tabpanel top: pure chrome before any content. */
    chromeHeight: number;
    /** Per-band breakdown so the chrome number is auditable, not a single figure. */
    chromeBands: { commandSearchRow?: number; navigator?: number };
    canvasPanelCollapsed: number;
    canvasPanelExpanded: number;
  };
  mobile: {
    panel: Measurement;
    chromeHeight: number;
    canvasPanelCollapsed: number;
    /** Interactive elements inside the sheet whose box is under 44px tall. */
    smallTouchTargets: { label: string; height: number }[];
  };
  rows: ControlRow[];
  notes: string[];
  failures: string[];
}

function log(message: string): void {
  console.log(`[verify-inspector-walkthrough] ${message}`);
}

async function installStudioPreferences(
  context: BrowserContext,
  mobile: boolean,
): Promise<void> {
  await context.addInitScript(
    ({ quickStartKey, densityKey, languageKey, hintKey, immersiveKey, isMobile }) => {
      try {
        globalThis.localStorage.setItem(quickStartKey, "1");
        globalThis.localStorage.setItem(densityKey, JSON.stringify({ mode: "full" }));
        globalThis.localStorage.setItem(
          languageKey,
          JSON.stringify({ state: { lang: "ko" }, version: 0 }),
        );
        if (isMobile) {
          globalThis.localStorage.setItem(hintKey, "1");
          // 몰입 모드는 크롬을 숨긴다 — 측정 대상이 사라지지 않게 창 모드로 고정한다.
          globalThis.sessionStorage.setItem(immersiveKey, "windowed");
        }
      } catch {
        // 저장소가 막혀도 브라우저 계약 자체는 계속 검사해야 한다.
      }
    },
    {
      quickStartKey: QUICKSTART_KEY,
      densityKey: UI_DENSITY_KEY,
      languageKey: LANGUAGE_KEY,
      hintKey: MOBILE_HINT_KEY,
      immersiveKey: IMMERSIVE_SESSION_KEY,
      isMobile: mobile,
    },
  );
  // esbuild `keepNames` 가 page.evaluate 안의 중첩 함수에 심는 헬퍼.
  await context.addInitScript(() => {
    (globalThis as unknown as { __name: (fn: unknown) => unknown }).__name = (fn) => fn;
  });
}

async function dismissHydratedQuickStart(page: Page): Promise<void> {
  const quickStart = page.locator('[data-studio-creative-starter="true"]');
  const mounted = await quickStart
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!mounted) return;
  // 여기서 throw 하면 gotoStudio 가 끊겨 워크스루 전체가 리포트 없이 죽는다. 닫기에
  // 실패하면 이후 행들이 각자 blocked 로 떨어지게 두고 계속 진행한다.
  await clickControl(quickStart.locator('[data-studio-quickstart-dismiss="true"]'));
  await quickStart.waitFor({ state: "detached", timeout: 3_000 }).catch(() => undefined);
}

/** 300ms 시트 트랜지션이 끝나기 전에 재는 것을 막는다. */
async function awaitElementAnimations(locator: Locator): Promise<void> {
  await locator
    .evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map(async (animation) => {
          try {
            await animation.finished;
          } catch {
            /* 취소된 애니메이션은 무시한다. */
          }
        }),
      );
    })
    .catch(() => undefined);
}

async function measure(locator: Locator): Promise<Measurement> {
  await awaitElementAnimations(locator);
  const box = await locator.boundingBox();
  return {
    width: Math.round(box?.width ?? 0),
    height: Math.round(box?.height ?? 0),
  };
}

/** 인스펙터 최상단부터 첫 탭패널까지 — 콘텐츠 이전에 지불하는 순수 크롬. */
async function measureChromeHeight(page: Page): Promise<number> {
  return page.evaluate((panelSelector) => {
    const aside = document.querySelector<HTMLElement>(panelSelector);
    if (!aside) return -1;
    const asideTop = aside.getBoundingClientRect().top;
    const visibleTabpanel = [
      ...aside.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
    ].find((node) => {
      if (node.hidden) return false;
      const rect = node.getBoundingClientRect();
      return rect.height > 2;
    });
    if (!visibleTabpanel) return -1;
    return Math.round(visibleTabpanel.getBoundingClientRect().top - asideTop);
  }, PANEL);
}

async function gotoStudio(page: Page, baseUrl: string): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ authenticated: false, user: null }),
    });
  });
  await page.goto(`${baseUrl}/studio`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page
    .locator('[data-studio-main-menu="true"]')
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
  await dismissHydratedQuickStart(page);
}

/* --------------------------------------------------------------- helpers */

function record(
  rows: ControlRow[],
  row: ControlRow,
): void {
  rows.push(row);
  const mark =
    row.verdict === "reachable" ? "OK  " : row.verdict === "blocked" ? "BLOCK" : "SKIP ";
  log(`${mark} ${row.control} — ${row.effect}`);
}

/** 기본 탭으로 이동하고 실제로 선택됐는지 확인한다. */
function primaryTab(page: Page, tab: string): Locator {
  return page.locator(`${NAVIGATOR} [data-studio-inspector-primary-tab="${tab}"]`).first();
}

async function selectPrimaryTab(page: Page, tab: string): Promise<boolean> {
  const button = primaryTab(page, tab);
  if ((await button.count()) === 0) return false;
  if ((await readAttribute(button, "aria-selected")) !== "true") {
    // 클릭 실패는 false 로 떨어뜨린다 — throw 하면 이 탭 하나 때문에 워크 전체가 끊긴다.
    if (!(await clickControl(button))) return false;
  }
  return (await readAttribute(button, "aria-selected")) === "true";
}

function documentTab(page: Page, label: string): Locator {
  return page.locator(`${NAVIGATOR} [role="tablist"][aria-label="문서 설정"] [role="tab"]`, {
    hasText: label,
  }).first();
}

/**
 * 문서 하위 탭 스트립은 `layout.primary === "document"` 일 때만 마운트된다. 새로고침
 * 직후에는 워크스페이스 하이드레이션이 조금 늦게 primary 를 다시 잡으면서 스트립이 잠깐
 * 사라지고, 그때 잡아 둔 탭 핸들로 클릭하면 "element was detached" 재시도가 기본 30초
 * 타임아웃까지 이어져 **워크스루 전체가 중단**된다(관측 2회). 사용자가 할 법한 복구를
 * 그대로 한다 — 문서 탭을 다시 고르고 짧은 타임아웃으로 재시도한다.
 *
 * 재시도가 소진되면 그건 하이드레이션 흔들림이 아니라 도달 불가다. **호출부는 false 를
 * 반드시 blocked 행으로 기록해야 한다** — note 로 남기면 실패 목록(blocked 행에서만
 * 만들어진다)에 들어가지 않아, 하위 탭이 죽어도 리포트가 RESULT: OK 로 끝난다.
 */
async function selectDocumentTab(page: Page, label: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tab = documentTab(page, label);
    const attached = await tab
      .waitFor({ state: "attached", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (attached) {
      if ((await tab.getAttribute("aria-selected").catch(() => null)) === "true") return true;
      const clicked = await tab
        .click({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (
        clicked
        && (await tab.getAttribute("aria-selected").catch(() => null)) === "true"
      ) {
        return true;
      }
    }
    await selectPrimaryTab(page, "document");
  }
  return false;
}

/** 게시 준비 모드의 표식 — 상시 탭이 아니라 내비게이터 위 배너로 나타난다. */
function publishModeBanner(page: Page): Locator {
  return page.locator(`${NAVIGATOR} [data-studio-inspector-publish-mode="true"]`).first();
}

/**
 * 없는/이름이 바뀐 컨트롤을 맨 클릭하면 Playwright 가 기본 30초 동안 재시도하다 throw 해
 * 워크스루 전체가 중단되고, 그 컨트롤을 위해 준비해 둔 defect 문자열은 영영 기록되지
 * 않는다. 클릭은 전부 이 헬퍼를 지나 boolean 으로 떨어뜨려, 실패가 blocked 행이 되게 한다.
 */
async function clickControl(locator: Locator, timeout = 5_000): Promise<boolean> {
  if ((await locator.count().catch(() => 0)) === 0) return false;
  return locator
    .click({ timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * 통합 검색 다이얼로그.
 *
 * `[role="dialog"]` 를 first() 로 잡으면 안 된다 — 작업공간 다이얼로그처럼 `hidden` 으로
 * 상시 마운트된 role=dialog 가 먼저 걸려, 정작 열려 있는 검색 팔레트를 "안 열렸다" 로
 * 읽고 그 백드롭이 이후 클릭을 전부 가로챈다(게시 작업공간 경로를 밟은 뒤 실측).
 */
function commandSearchDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "기능·설정 찾기" });
}

/**
 * 열려 있는 모달을 Esc 로 걷어낸다.
 *
 * 삽입 시도가 엉뚱한 결과를 실행해 도움말 센터 같은 다른 모달이 열리면, 그 백드롭이
 * 이후 클릭을 전부 가로채 워크스루가 30초 타임아웃으로 끊긴다(실측: F1 '말풍선 추가'
 * 뒤 `z-[110]` 도움말 오버레이). 데스크톱 전용 — 모바일 작업 시트 자체가 모달이라
 * 거기서 부르면 시트를 닫아 버린다.
 */
async function dismissOpenModals(page: Page): Promise<void> {
  const modal = page.locator(
    '[role="dialog"][aria-modal="true"]:visible, [role="alertdialog"][aria-modal="true"]:visible',
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await modal.count().catch(() => 0)) === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

/** getAttribute 도 같은 이유로 throw 한다 — 없으면 null 로 떨어뜨린다. */
async function readAttribute(locator: Locator, name: string): Promise<string | null> {
  if ((await locator.count().catch(() => 0)) === 0) return null;
  return locator.getAttribute(name).catch(() => null);
}

/** 실제로 밟은 진입 경로. 검색 색인 하나에 게시 행 전체가 매달리지 않게 구분해 기록한다. */
type PublishModeRoute = "workspace" | "search" | "none";

/** 전환 직전의 활성 작업공간 — 되돌리기 위한 좌표. */
interface WorkspaceIdentity {
  id: string;
  name: string;
}

interface PublishModeEntry {
  /** 게시 준비 모드를 실제로 연 경로. 어느 쪽도 못 열면 "none". */
  route: PublishModeRoute;
  /** 검색 경로를 시도했다면 통합 검색 다이얼로그가 실제로 열렸는가. */
  searchOpened: boolean;
  /** 게시 준비 모드가 화면에 나타났는가. */
  routed: boolean;
  /** 실패 사유 — 행의 effect 가 실제로 일어난 일과 어긋나지 않게 한다. */
  failure: string | null;
  /**
   * 전환은 커밋됐는데 되돌릴 좌표를 잡지 못한 경우의 사유. 복원을 시도할 수조차 없다는
   * 뜻이므로 호출자는 이것을 blocked 행으로 남겨야 한다 — 그러지 않으면 이후 구획이
   * 조용히 '게시' 배치를 재고 리포트는 OK 로 끝난다.
   */
  restoreUnavailable?: string | null;
  /**
   * 작업공간 프리셋 경로가 **실제로 전환을 커밋했다면** 그 직전의 활성 작업공간.
   *
   * `StudioWorkspaceMenu.completeWorkspaceSwitch` 는 `commitState` + `onApplyLayout` 으로
   * 배치를 저장한다. 즉 이 전환은 되돌리지 않으면 이후 구획(E~I·모바일)이 전부 '게시'
   * 배치를 측정하게 되어 기본 배치에 대한 측정이 아니게 된다. 호출부는 게시 행을 다
   * 기록한 뒤 이 작업공간으로 반드시 복원하고, 복원 실패를 blocked 행으로 남겨야 한다.
   */
  restoreWorkspace: WorkspaceIdentity | null;
}

const WORKSPACE_TRIGGER = 'button[aria-label^="작업공간:"]';
const WORKSPACE_DIALOG = '[data-testid="studio-workspace-dialog"]';
const WORKSPACE_SWITCH_GUARD = '[data-testid="studio-workspace-switch-guard"]';

/** 전환 목록에서 현재 활성으로 표시된 작업공간의 id/이름. 목록이 접혀 있어도 읽힌다. */
async function readActiveWorkspace(dialog: Locator): Promise<WorkspaceIdentity | null> {
  const active = dialog
    .locator(
      '[data-workspace-kind="builtin"][aria-current="true"],'
        + ' [data-workspace-kind="custom-switch"][aria-current="true"]',
    )
    .first();
  const id = await readAttribute(active, "data-workspace-id");
  if (!id) return null;
  // aria-label 은 `${이름}, 현재 작업공간` — 이름만 떼어 복원 시 검색어로 쓴다.
  const name = ((await readAttribute(active, "aria-label")) ?? "").split(",")[0]?.trim() ?? "";
  return name ? { id, name } : null;
}

/** 전환 목록에서 이 id 를 가진 버튼(관리 탭의 동명 항목이 아니라). */
function workspaceSwitchOption(dialog: Locator, id: string): Locator {
  const quoted = JSON.stringify(id);
  return dialog
    .locator(
      `[data-workspace-kind="builtin"][data-workspace-id=${quoted}],`
        + ` [data-workspace-kind="custom-switch"][data-workspace-id=${quoted}]`,
    )
    .first();
}

/** 배치 변경이 남아 있으면 뜨는 전환 가드 — 사용자가 하듯 저장 없이 넘어간다. */
async function passWorkspaceSwitchGuard(page: Page): Promise<string | null> {
  const guard = page.locator(WORKSPACE_SWITCH_GUARD);
  const shown = await guard
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return null;
  const discarded = await clickControl(guard.getByRole("button", { name: "저장하지 않고 전환" }));
  return discarded ? null : "작업공간 전환 가드에서 '저장하지 않고 전환' 을 누르지 못했다";
}

/**
 * 게시 구획이 커밋해 둔 작업공간 전환을 원래 작업공간으로 되돌린다.
 *
 * 성공하면 null, 실패하면 사유 문자열을 돌려준다 — 호출부가 blocked 행으로 남길 수 있게
 * throw 하지 않는다. 복원 여부는 트리거의 `aria-label` 과 게시 배너 소멸로 확인한다.
 */
async function restoreWorkspace(page: Page, target: WorkspaceIdentity): Promise<string | null> {
  const trigger = page.locator(WORKSPACE_TRIGGER).first();
  if (!(await clickControl(trigger))) return "작업공간 버튼을 클릭하지 못했다";
  const dialog = page.locator(WORKSPACE_DIALOG);
  const opened = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return "작업공간 다이얼로그가 열리지 않았다";

  const search = dialog.getByLabel("작업공간 검색", { exact: true });
  if ((await search.count()) === 0) return "작업공간 검색 입력이 없다";
  const filtered = await search
    .fill(target.name, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!filtered) return "작업공간 검색어를 입력하지 못했다";

  if (!(await clickControl(workspaceSwitchOption(dialog, target.id)))) {
    return `'${target.name}' 작업공간 항목을 클릭하지 못했다`;
  }
  const guardFailure = await passWorkspaceSwitchGuard(page);
  if (guardFailure) return guardFailure;

  const closed = await dialog
    .waitFor({ state: "hidden", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) return "전환 뒤에도 작업공간 다이얼로그가 닫히지 않았다";

  const label = (await readAttribute(trigger, "aria-label")) ?? "";
  if (!label.startsWith(`작업공간: ${target.name}`)) {
    return `활성 작업공간이 '${target.name}' 로 돌아오지 않았다 (${label || "라벨 없음"})`;
  }
  if (await publishModeBanner(page).isVisible().catch(() => false)) {
    return "작업공간은 되돌아왔으나 게시 준비 배너가 남아 있다";
  }
  return null;
}

/**
 * 게시 작업공간 프리셋으로 게시 준비 모드를 연다.
 *
 * `apps/web/src/domains/creator/studio-workspaces.ts` 의 `id: "publish"`(이름 '게시')는
 * `createBuiltinLayout({ primary: "publish", ... })` 이고, 인스펙터는
 * `publishMode = layout.primary === "publish"` 로 배너를 켠다. 즉 이 전환은 로그인도
 * 검색 색인도 타지 않는 순수 배치 전환이며, 이 워크스루가 이미 읽고 있는
 * `작업공간:` 버튼에서 바로 닿는다.
 */
async function openPublishPreparationModeViaWorkspace(page: Page): Promise<PublishModeEntry> {
  const miss = (
    failure: string,
    restoreTarget: WorkspaceIdentity | null = null,
  ): PublishModeEntry => ({
    route: "none",
    searchOpened: false,
    routed: false,
    failure,
    restoreWorkspace: restoreTarget,
  });
  const trigger = page.locator(WORKSPACE_TRIGGER).first();
  if (!(await clickControl(trigger))) return miss("작업공간 버튼을 클릭하지 못했다");

  const dialog = page.locator(WORKSPACE_DIALOG);
  const dialogOpen = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!dialogOpen) return miss("작업공간 다이얼로그가 열리지 않았다");

  // 전환은 배치를 커밋한다 — 되돌릴 좌표를 전환 **전에** 잡아 둔다.
  const previous = await readActiveWorkspace(dialog);

  // 기본 작업공간 목록은 접혀 있을 수 있다 — 검색어가 있으면 항상 펼쳐진다.
  // exact — '작업공간 검색어 지우기' 버튼과의 부분 일치 충돌을 막는다.
  const search = dialog.getByLabel("작업공간 검색", { exact: true });
  if ((await search.count()) === 0) return miss("작업공간 검색 입력이 없다");
  const filtered = await search
    .fill("게시", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!filtered) return miss("작업공간 검색어를 입력하지 못했다");

  const preset = workspaceSwitchOption(dialog, "publish");
  if (!(await clickControl(preset))) return miss("'게시' 작업공간 프리셋을 클릭하지 못했다");

  // 배치가 변경된 상태면 저장 여부를 묻는 alertdialog 가 먼저 뜬다. 하네스는 배치를
  // 저장할 게 없으므로 사용자가 하듯 '저장하지 않고 전환' 을 고른다.
  const guardFailure = await passWorkspaceSwitchGuard(page);
  if (guardFailure) return miss(guardFailure);

  // 전환이 실제로 커밋됐을 때만 복원 대상을 실어 보낸다 — 커밋되지 않았는데 복원을
  // 시도하면 '이미 활성' 인 항목(disabled)을 눌러 없는 결함을 만들어 낸다.
  const switchedLabel = (await readAttribute(trigger, "aria-label")) ?? "";
  const committed = switchedLabel.startsWith("작업공간: 게시");
  const restoreTarget = committed && previous ? previous : null;
  // 전환은 커밋됐는데 직전 작업공간을 읽지 못한 경우가 가장 위험하다: 되돌릴 좌표가 없으니
  // 복원도 복원 행도 없이 E~I 구획이 '게시' 배치를 재고, 리포트는 OK 로 끝난다. 그 상태를
  // 호출자가 blocked 행으로 남길 수 있도록 사유를 실어 보낸다.
  const restoreUnavailable = committed && !previous
    ? "'게시' 작업공간으로 전환했으나 전환 전 활성 작업공간을 읽지 못해 되돌릴 좌표가 없다"
    : null;

  const routed = await publishModeBanner(page)
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  return {
    route: routed ? "workspace" : "none",
    searchOpened: false,
    routed,
    failure: routed ? null : "'게시' 작업공간으로 전환했으나 게시 준비 배너가 나타나지 않았다",
    restoreWorkspace: restoreTarget,
    restoreUnavailable,
  };
}

/**
 * 통합 검색('현재 패널' 범위)으로 게시 준비 모드를 연다 — 데스크톱은 상단 검색 행,
 * 모바일은 내비게이터의 '찾기' 버튼이며 둘 다 같은 다이얼로그를 연다.
 *
 * 게시 CTA·파일 ▸ 게시는 `studio-page-save-pipeline` 의 로그인 게이트("로그인 후 게시할
 * 수 있어요.")에 먼저 막히고 이 하네스는 세션을 비로그인으로 고정하므로 밟을 수 없다.
 * 하지만 이 검색이 '유일한' 비로그인 경로는 아니다 — 위의 게시 작업공간 프리셋이 세 번째
 * 경로이고, 그쪽이 검색 색인과 독립이라 기본 경로다.
 */
async function openPublishPreparationModeViaSearch(page: Page): Promise<PublishModeEntry> {
  const miss = (searchOpened: boolean, failure: string): PublishModeEntry => ({
    route: "none",
    searchOpened,
    routed: false,
    failure,
    // 검색 경로는 작업공간을 전환하지 않는다 — 되돌릴 것이 없다.
    restoreWorkspace: null,
  });
  const desktopTrigger = page.locator('[data-testid="studio-command-search-trigger"]');
  // 모바일 시트에서는 상단 검색 행이 렌더되지 않는다(hideTrigger) — 같은 다이얼로그를
  // 내비게이터의 '찾기' 버튼이 연다.
  const trigger =
    (await desktopTrigger.count()) > 0
      ? desktopTrigger.first()
      : page.locator(`${NAVIGATOR} [data-studio-inspector-search-trigger="true"]`).first();
  if (!(await clickControl(trigger))) return miss(false, "통합 검색 트리거를 클릭하지 못했다");

  const dialog = commandSearchDialog(page);
  const searchOpened = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!searchOpened) return miss(false, "통합 검색 다이얼로그가 열리지 않았다");

  const inspectorScope = dialog.getByRole("radio", { name: "현재 패널" });
  if ((await readAttribute(inspectorScope, "aria-checked")) !== "true") {
    if (!(await clickControl(inspectorScope))) {
      return miss(true, "'현재 패널' 범위 라디오를 고르지 못했다");
    }
  }
  const combobox = dialog.getByRole("combobox");
  if ((await combobox.count()) === 0) return miss(true, "검색 입력(combobox)이 없다");
  const typed = await combobox
    .fill("작품 정보", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!typed) return miss(true, "검색어를 입력하지 못했다");
  await page.keyboard.press("Enter");
  const routed = await publishModeBanner(page)
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  // 라우팅에 실패하면 다이얼로그가 그대로 남아 이후 클릭을 전부 가로챈다 — 닫고 나간다.
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => undefined);
  }
  return {
    route: routed ? "search" : "none",
    searchOpened: true,
    routed,
    failure: routed ? null : "검색은 열렸으나 Enter 가 게시 준비 모드로 라우팅하지 않았다",
    restoreWorkspace: null,
  };
}

/**
 * 게시 준비 모드 진입 — 작업공간 프리셋을 먼저 밟고, 그 경로가 막히면 통합 검색으로
 * 물러선다. 두 경로 중 하나만 살아 있어도 게시 행들이 구동된다.
 */
async function openPublishPreparationMode(page: Page): Promise<PublishModeEntry> {
  const viaWorkspace = await openPublishPreparationModeViaWorkspace(page);
  if (viaWorkspace.routed) return viaWorkspace;
  // 실패한 작업공간 다이얼로그가 열린 채 남으면 백드롭이 이후 클릭을 전부 가로챈다.
  // (전환 가드가 떠 있으면 첫 Esc 는 가드만 닫는다 — 다이얼로그가 사라질 때까지 반복한다.)
  const workspaceDialog = page.locator(WORKSPACE_DIALOG);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await workspaceDialog.isVisible().catch(() => false))) break;
    await page.keyboard.press("Escape");
    await workspaceDialog.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
  }
  const viaSearch = await openPublishPreparationModeViaSearch(page);
  // 작업공간 경로가 배너까지 가지 못했더라도 전환 자체는 커밋됐을 수 있다 —
  // 복원 대상은 어느 경로로 진입했든 그대로 들고 나간다.
  if (viaSearch.routed) {
    return {
      ...viaSearch,
      restoreWorkspace: viaWorkspace.restoreWorkspace,
      restoreUnavailable: viaWorkspace.restoreUnavailable ?? null,
    };
  }
  return {
    ...viaSearch,
    restoreWorkspace: viaWorkspace.restoreWorkspace,
    restoreUnavailable: viaWorkspace.restoreUnavailable ?? null,
    failure: `작업공간 경로: ${viaWorkspace.failure ?? "실패"}; 검색 경로: ${viaSearch.failure ?? "실패"}`,
  };
}

/** 탭의 실제 소유 panel을 aria-controls로 찾고, 구버전 빌드에는 aria-label을 쓴다. */
async function controlledPanel(
  page: Page,
  tab: Locator,
  fallbackLabels: readonly string[],
): Promise<Locator> {
  const panelId = await tab.getAttribute("aria-controls").catch(() => null);
  if (panelId) {
    const linked = page.locator(`${PANEL} [id=${JSON.stringify(panelId)}]`).first();
    if ((await linked.count()) > 0) return linked;
  }
  const fallbackSelector = fallbackLabels
    .map((label) => `${PANEL} [role="tabpanel"][aria-label=${JSON.stringify(label)}]`)
    .join(", ");
  return page.locator(fallbackSelector || `${PANEL} [data-missing-controlled-panel]`).first();
}

function sectionHeader(page: Page, sectionId: string): Locator {
  return page.locator(`[data-inspector-section="${sectionId}"] > button`).first();
}

/** 헤더에 키보드 포커스를 준 뒤 Enter 로 연다 — 마우스 전용이 아님을 증명한다. */
async function openSectionByKeyboard(page: Page, sectionId: string): Promise<boolean> {
  const header = sectionHeader(page, sectionId);
  if ((await header.count()) === 0) return false;
  await header.scrollIntoViewIfNeeded().catch(() => undefined);
  await header.focus();
  const focused = await header.evaluate((node) => node === document.activeElement);
  if (!focused) return false;
  await page.keyboard.press("Enter");
  return (await header.getAttribute("aria-expanded")) === "true";
}

/* ------------------------------------------------------------- desktop run */

async function walkDesktop(
  browser: Browser,
  baseUrl: string,
  report: WalkthroughReport,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: "ko-KR",
  });
  await installStudioPreferences(context, false);
  const page = await context.newPage();
  const rows = report.rows;

  try {
    await gotoStudio(page, baseUrl);
    const panel = page.locator(PANEL);
    await panel.waitFor({ state: "visible", timeout: 20_000 });

    report.desktop.panel = await measure(panel);
    report.desktop.chromeHeight = await measureChromeHeight(page);
    report.desktop.chromeBands = await page.evaluate((panelSelector) => {
      const aside = document.querySelector<HTMLElement>(panelSelector);
      if (!aside) return {};
      const height = (selector: string) =>
        Math.round(
          aside.querySelector<HTMLElement>(selector)?.getBoundingClientRect().height ?? 0,
        );
      return {
        commandSearchRow: height('[data-studio-command-search-row="true"]'),
        navigator: height('[data-testid="studio-inspector-navigator"]'),
      };
    }, PANEL);
    log(
      `desktop panel ${report.desktop.panel.width}×${report.desktop.panel.height}, chrome ${report.desktop.chromeHeight}px`,
    );

    /* ---- A. 상단 크롬 --------------------------------------------------- */

    const searchTrigger = page.locator('[data-testid="studio-command-search-trigger"]');
    const collapse = panel.locator('button[title="작업 패널 접기"]');
    const chromeRow = panel.locator('[data-studio-command-search-row="true"]');
    const chromeRowCount = await chromeRow.count();
    record(rows, {
      control: "상단 크롬 행 (기능 검색 + 접기)",
      state: "항상 (데스크톱)",
      path: "인스펙터 최상단",
      verdict:
        chromeRowCount === 1 && (await searchTrigger.count()) === 1 && (await collapse.count()) === 1
          ? "reachable"
          : "blocked",
      effect: `검색 트리거와 접기가 한 행에 있다 (행 ${chromeRowCount}개)`,
      defect:
        chromeRowCount === 1
          ? undefined
          : "검색/접기가 별도 행으로 분리돼 세로 공간을 두 번 먹는다",
    });

    // F1 로 통합 검색이 열리고 Esc 로 닫힌다.
    await page.keyboard.press("F1");
    const dialogOpen = await commandSearchDialog(page)
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (dialogOpen) await page.keyboard.press("Escape");
    record(rows, {
      control: "통합 명령 검색 (F1)",
      state: "항상",
      path: "F1, 또는 인스펙터 상단 '기능 검색' 클릭",
      verdict: dialogOpen ? "reachable" : "blocked",
      effect: dialogOpen ? "다이얼로그가 열리고 Esc 로 닫힌다" : "F1 이 다이얼로그를 열지 못함",
      defect: dialogOpen ? undefined : "F1 바인딩이 동작하지 않는다",
    });

    // 기본 탭 3개(대상·레이어·문서) — 클릭 시 대응 탭패널이 실제로 보여야 한다.
    // 작품 정보는 상시 탭이 아니라 게시 CTA·파일 메뉴·검색이 여는 '게시 준비' 모드다
    // (UX 감사 2026-09-02 §5.3); 아래 검색 시나리오가 그 경로를 따로 검증한다.
    // 문서 탭이 어느 하위 탭으로 착지하는지는 활성 워크스페이스가 정한다
    // (기본 '스토리보드' 프로필은 미니맵으로 연다). 그래서 세 하위 패널 중
    // 하나가 보이면 통과로 본다 — 아래에서 착지 지점을 따로 기록한다.
    for (const [tab, label, panelLabels] of [
      ["properties", "대상", ["선택 요소 속성", "시작 안내", "그리기 도구 설정", "전문 픽셀 도구"]],
      ["layers", "레이어", ["레이어"]],
      ["document", "문서", ["캔버스 설정", "페이지 색보정", "미니맵과 페이지 탐색"]],
    ] as const) {
      const selected = await selectPrimaryTab(page, tab);
      const panel = await controlledPanel(page, primaryTab(page, tab), panelLabels);
      // 탭패널은 lazy 마운트/트랜지션을 지날 수 있으므로 잠깐 폴링한다.
      let visible = false;
      for (let attempt = 0; attempt < 20 && !visible; attempt += 1) {
        visible = await panel.isVisible().catch(() => false)
          && (await panel.boundingBox())?.height !== undefined
          && ((await panel.boundingBox())?.height ?? 0) > 2;
        if (!visible) await page.waitForTimeout(250);
      }
      record(rows, {
        control: `기본 탭 · ${label}`,
        state: "항상",
        path: `인스펙터 탭 스트립 → ${label}`,
        verdict: selected && visible ? "reachable" : "blocked",
        effect: selected
          ? `aria-selected=true, 대응 탭패널(${panelLabels[0]}) 표시됨=${visible}`
          : "탭이 선택되지 않음",
        defect: selected && !visible ? "탭은 선택되지만 대응 패널이 보이지 않는다" : undefined,
      });
    }

    // 키보드 방향키 순회.
    const firstTab = page.locator(`${NAVIGATOR} [data-studio-inspector-primary-tab="properties"]`);
    await selectPrimaryTab(page, "properties");
    await firstTab.focus();
    await page.keyboard.press("ArrowRight");
    const movedTo = await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-studio-inspector-primary-tab") ?? null,
    );
    record(rows, {
      control: "탭 스트립 키보드 순회 (←/→/Home/End)",
      state: "항상",
      path: "탭에 포커스 → ArrowRight",
      verdict: movedTo === "layers" ? "reachable" : "blocked",
      effect: `ArrowRight 로 포커스가 ${movedTo ?? "이동 안 함"} 으로 갔다`,
      defect: movedTo === "layers" ? undefined : "방향키 순회가 동작하지 않는다",
    });

    // 기능·설정 찾기(통합 검색, 범위 '현재 패널') — 입력 후 Enter 가 실제로 라우팅해야 한다.
    // 인스펙터 안의 로컬 검색은 통합 다이얼로그로 합쳐졌다(감사 §5.5: 화면당 검색 하나).
    await selectPrimaryTab(page, "properties");
    // 이 행은 검색 경로 자체가 대상이므로 작업공간 프리셋으로 물러서지 않는다.
    const searchEntry = await openPublishPreparationModeViaSearch(page);
    const localSearchOpened = searchEntry.searchOpened;
    const routedByLocalSearch = searchEntry.routed;
    record(rows, {
      control: "기능·설정 찾기 (통합 검색 · 현재 패널 범위)",
      state: "항상",
      path: "검색 행 → 범위 '현재 패널' → 검색어 → Enter",
      verdict: localSearchOpened && routedByLocalSearch ? "reachable" : "blocked",
      effect: routedByLocalSearch
        ? "'작품 정보' 입력 + Enter 가 게시 준비 모드로 실제 이동시켰다"
        : (searchEntry.failure ?? "검색이 게시 준비 모드로 라우팅하지 않았다"),
      defect: routedByLocalSearch
        ? undefined
        : localSearchOpened
          ? "결과 Enter 가 no-op"
          : "인스펙터에서 통합 검색 다이얼로그를 열지 못한다",
    });

    /* ---- B. 페이지 ▸ 캔버스 (변경된 패널) -------------------------------- */

    await selectPrimaryTab(page, "document");
    const activeWorkspaceLabel = await page
      .getByRole("button", { name: /^작업공간:/u })
      .first()
      .getAttribute("aria-label");
    const defaultStoryboardActive = activeWorkspaceLabel?.startsWith("작업공간: 스토리보드")
      ?? false;
    const landedOn = await page.evaluate(
      (panelSelector) =>
        [
          ...(document
            .querySelector<HTMLElement>(panelSelector)
            ?.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="문서 설정"] [role="tab"]')
            ?? []),
        ].find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent?.trim() ?? null,
      PANEL,
    );
    record(rows, {
      control: "페이지 탭 하위 착지 지점 (캔버스 / 색보정 / 미니맵)",
      state: "페이지 탭",
      path: "페이지 탭 클릭 (1 스텝)",
      verdict: defaultStoryboardActive && landedOn === "미니맵" ? "reachable" : "blocked",
      effect: `활성 ${activeWorkspaceLabel ?? "작업공간 확인 불가"}; '${landedOn}' 하위 탭으로 착지한다`,
      defect: !defaultStoryboardActive
        ? `새 Studio가 기본 '스토리보드' 작업공간으로 시작하지 않았다 (${activeWorkspaceLabel ?? "라벨 없음"})`
        : landedOn !== "미니맵"
          ? `스토리보드 작업공간의 Page 계약은 '미니맵'인데 실제 착지는 '${landedOn}' 이다`
          : undefined,
    });

    const canvasTabSelected = await selectDocumentTab(page, "캔버스");
    const canvasPanel = await controlledPanel(page, documentTab(page, "캔버스"), ["캔버스 설정"]);
    const canvasPanelVisible =
      canvasTabSelected
      && (await canvasPanel
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => true)
        .catch(() => false));
    if (!canvasPanelVisible) {
      // 여기서 그냥 throw 하면 리포트가 통째로 사라져 무엇이 막혔는지 남지 않는다.
      // blocked 행으로 남기고 데스크톱 워크를 끝낸다 — 실패 목록이 이 행을 집어 든다.
      record(rows, {
        control: "페이지 ▸ 캔버스 패널",
        state: "페이지 탭",
        path: "페이지 탭 → 캔버스 (2 스텝)",
        verdict: "blocked",
        effect: `'캔버스' 하위 탭 선택됨=${canvasTabSelected}, 캔버스 설정 패널 표시됨=false`,
        defect: "문서 ▸ 캔버스 패널에 도달할 수 없어 캔버스 컨트롤 전체를 구동하지 못했다",
      });
      return;
    }
    report.desktop.canvasPanelCollapsed = (await measure(canvasPanel)).height;

    // 기본 티어는 접기 없이 닿아야 한다 + 실제로 동작해야 한다.
    const readHeightValue = async (): Promise<string | null> =>
      page
        .locator(`${PANEL} span[aria-label^="높이 "]`)
        .first()
        .textContent()
        .catch(() => null);
    const heightValueBefore = await readHeightValue();
    const heightIncreased = await clickControl(
      canvasPanel.getByRole("button", { name: "높이 240px 늘리기" }),
    );
    const heightValueAfter = heightIncreased ? await readHeightValue() : heightValueBefore;
    const heightChanged = heightIncreased && heightValueBefore !== heightValueAfter;
    // 되돌리기(역동작) — 값이 되돌아오지 않으면 왕복 계약이 깨진 것이므로 게이트한다.
    const heightDecreased = heightChanged
      ? await clickControl(canvasPanel.getByRole("button", { name: "높이 240px 줄이기" }))
      : false;
    const heightRestored = heightDecreased && (await readHeightValue()) === heightValueBefore;
    record(rows, {
      control: "캔버스 높이 ± (기본 티어)",
      state: "페이지 ▸ 캔버스",
      path: "페이지 탭 → 캔버스 → 높이 +/−  (2 스텝)",
      verdict: heightChanged && heightRestored ? "reachable" : "blocked",
      effect: `${heightValueBefore} → ${heightValueAfter}, '줄이기' 클릭됨=${heightDecreased}, 역동작 복원=${heightRestored}`,
      defect: !heightIncreased
        ? "'높이 240px 늘리기' 버튼이 없거나 클릭되지 않는다"
        : !heightChanged
          ? "높이 버튼이 값을 바꾸지 않는다"
          : !heightDecreased
            ? "'높이 240px 줄이기' 버튼이 없거나 클릭되지 않아 되돌릴 수 없다"
            : heightRestored
              ? undefined
              : "'줄이기' 가 원래 높이로 되돌리지 못한다 (왕복이 깨져 이후 행이 바뀐 캔버스를 측정한다)",
    });

    /**
     * 체크박스 왕복 — 켜고, 관측하고, 되돌린다.
     *
     * 맨 `click()` 은 컨트롤이 사라지거나 가려지면 30초 뒤 throw 해 워크스루 전체를
     * 끊는다. 모든 클릭을 `clickControl` 로 흘려 boolean 으로 떨어뜨리고, 켠 상태에서
     * 관측할 것이 있으면 `observe` 로 받는다.
     */
    const toggleRoundTrip = async (
      toggle: Locator,
      observe?: (checked: boolean | null) => Promise<boolean>,
    ): Promise<{
      exists: boolean;
      before: boolean | null;
      after: boolean | null;
      clicked: boolean;
      observed: boolean;
      restoreClicked: boolean;
      restored: boolean;
    }> => {
      const exists = (await toggle.count().catch(() => 0)) > 0;
      const before = exists ? await toggle.isChecked().catch(() => null) : null;
      const clicked = await clickControl(toggle);
      const after = clicked ? await toggle.isChecked().catch(() => null) : null;
      const observed = clicked && observe ? await observe(after) : false;
      const restoreClicked = clicked ? await clickControl(toggle) : false;
      const restored =
        restoreClicked && (await toggle.isChecked().catch(() => null)) === before;
      return { exists, before, after, clicked, observed, restoreClicked, restored };
    };

    /** 체크박스 행의 결함 문구 — 어느 단계에서 멈췄는지 한 줄로 말한다. */
    const toggleDefect = (
      label: string,
      result: {
        exists: boolean;
        before: boolean | null;
        after: boolean | null;
        clicked: boolean;
        restoreClicked: boolean;
        restored: boolean;
      },
    ): string | undefined => {
      if (!result.exists) return `'${label}' 체크박스가 렌더되지 않는다`;
      if (!result.clicked) return `'${label}' 체크박스를 클릭할 수 없다 (가려졌거나 사라진다)`;
      if (result.before === result.after) return `'${label}' 클릭이 체크 상태를 바꾸지 않는다`;
      if (!result.restoreClicked) return `'${label}' 을 다시 눌러 되돌릴 수 없다`;
      if (!result.restored) return `'${label}' 역동작이 원래 상태로 되돌리지 못한다`;
      return undefined;
    };

    const gridToggle = canvasPanel.getByLabel("그리드 격자 표시");
    const gridSizeSelect = canvasPanel.getByRole("combobox", { name: "그리드 간격" });
    const grid = await toggleRoundTrip(gridToggle, async (checked) => {
      // 기대 상태를 잠깐 기다린 뒤 **실제** 가시성을 읽는다 — 즉시 읽으면 React 커밋
      // 한 프레임 차이로 정상 동작을 결함으로 오진한다.
      await gridSizeSelect
        .waitFor({ state: checked === true ? "visible" : "hidden", timeout: 4_000 })
        .catch(() => undefined);
      return gridSizeSelect.isVisible().catch(() => false);
    });
    // 간격 select 는 격자가 켜져 있을 때만 나와야 한다 — 노출 여부가 체크 상태와
    // 일치하는지로 재면 '켜졌든 꺼졌든 통과' 인 자명한 판정이 되지 않는다.
    const gridSizeMatchesState = grid.after !== null && grid.observed === grid.after;
    const gridDefect = toggleDefect("그리드 격자 표시", grid);
    record(rows, {
      control: "그리드 격자 표시 + 간격 (기본 티어)",
      state: "페이지 ▸ 캔버스",
      path: "페이지 탭 → 캔버스 → 체크박스 (2 스텝)",
      verdict: !gridDefect && gridSizeMatchesState ? "reachable" : "blocked",
      effect: `체크 상태 ${grid.before}→${grid.after}, 그 상태에서 간격 select 노출=${grid.observed}, 역동작 복원=${grid.restored}`,
      defect:
        gridDefect
        ?? (gridSizeMatchesState
          ? undefined
          : `간격 select 노출(${grid.observed})이 격자 체크 상태(${grid.after})와 어긋난다`),
    });

    const snapToggle = canvasPanel.getByRole("checkbox", { name: /스냅/u }).first();
    const snap = await toggleRoundTrip(snapToggle);
    const snapDefect = toggleDefect("정렬 가이드(스냅)", snap);
    record(rows, {
      control: "정렬 가이드(스냅) (기본 티어)",
      state: "페이지 ▸ 캔버스",
      path: "페이지 탭 → 캔버스 → 체크박스 (2 스텝)",
      verdict: snapDefect ? "blocked" : "reachable",
      effect: `${snap.before}→${snap.after}, 역동작 복원=${snap.restored}`,
      defect: snapDefect,
    });

    const webtoonToggle = canvasPanel.getByLabel("웹툰 규격 가이드");
    const webtoon = await toggleRoundTrip(webtoonToggle, async (checked) => {
      const legend = canvasPanel
        .getByText(/플랫폼 표준폭|웹툰 규격 가이드를 여는 중/u)
        .first();
      await legend
        .waitFor({ state: checked === true ? "visible" : "hidden", timeout: 8_000 })
        .catch(() => undefined);
      return legend.isVisible().catch(() => false);
    });
    // isChecked() 는 언제나 boolean 이므로 `!== undefined` 로는 아무것도 판정하지 못했다.
    // 실제로 재는 것: 체크 상태가 바뀌고, 켠 동안 규격 범례가 나타나고, 되돌아온다.
    const webtoonDefect = toggleDefect("웹툰 규격 가이드", webtoon);
    // 범례도 체크 상태를 따라야 한다 — 켜면 나오고 꺼져 있으면 없다.
    const webtoonLegendMatchesState =
      webtoon.after !== null && webtoon.observed === webtoon.after;
    record(rows, {
      control: "웹툰 규격 가이드 (기본 티어)",
      state: "페이지 ▸ 캔버스",
      path: "페이지 탭 → 캔버스 → 체크박스 (2 스텝)",
      verdict: !webtoonDefect && webtoonLegendMatchesState ? "reachable" : "blocked",
      effect: `체크 상태 ${webtoon.before}→${webtoon.after}, 그 상태에서 규격 범례 노출=${webtoon.observed}, 역동작 복원=${webtoon.restored}`,
      defect:
        webtoonDefect
        ?? (webtoonLegendMatchesState
          ? undefined
          : `규격 범례 노출(${webtoon.observed})이 체크 상태(${webtoon.after})와 어긋난다`),
    });

    record(rows, {
      control: "배경색 (기본 티어)",
      state: "페이지 ▸ 캔버스",
      path: "페이지 탭 → 캔버스 → 색상 입력 (2 스텝)",
      verdict: (await canvasPanel.getByLabel("배경색").count()) === 1 ? "reachable" : "blocked",
      effect: "네이티브 <input type=color> 로 노출됨 (헤드리스에서 OS 색상 대화상자는 구동 불가)",
    });

    // 접힌 섹션 — 열기 전에는 컨트롤이 DOM 에 없어야 하고, 키보드로 열려야 한다.
    for (const sectionId of CANVAS_SECTIONS) {
      const header = sectionHeader(page, sectionId);
      const exists = (await header.count()) === 1;
      const expandedBefore = exists ? await header.getAttribute("aria-expanded") : null;
      // 헤더 텍스트에는 sr-only 배지 문장이 붙는다 — 제목 span 만 읽는다.
      const label = exists
        ? ((await header.locator("span.truncate").first().textContent()) ?? "").trim()
        : sectionId;
      const openedByKeyboard = exists ? await openSectionByKeyboard(page, sectionId) : false;
      record(rows, {
        control: `접기 섹션 · ${label || sectionId}`,
        state: "페이지 ▸ 캔버스",
        path: `페이지 탭 → 캔버스 → 섹션 헤더 (Tab 으로 포커스 후 Enter)  (3 스텝)`,
        verdict: openedByKeyboard ? "reachable" : "blocked",
        effect: `aria-expanded ${expandedBefore} → ${openedByKeyboard ? "true" : "실패"}; 키보드 Enter 로 열림`,
        defect: exists
          ? openedByKeyboard
            ? undefined
            : "헤더는 있으나 키보드로 열리지 않는다"
          : "섹션 헤더가 렌더되지 않는다",
      });
    }

    report.desktop.canvasPanelExpanded = (await measure(canvasPanel)).height;

    // 펼친 뒤에야 나타나는 컨트롤들이 실제로 있고 동작하는지.
    const gutterSlider = canvasPanel.getByRole("slider", { name: /패널 여백/u });
    const gutterExists = (await gutterSlider.count()) > 0;
    const gutterDisabled = gutterExists ? await gutterSlider.isDisabled() : true;
    const gutterReason = canvasPanel.locator("[data-studio-panel-gutter-reason]");
    const gutterReasonText = (await gutterReason.textContent().catch(() => null))?.trim() ?? null;
    const gutterReasonId = await gutterReason.getAttribute("id").catch(() => null);
    const gutterDescribedBy = gutterExists
      ? await gutterSlider.getAttribute("aria-describedby")
      : null;
    const gutterUnavailableExplained = !gutterDisabled || (
      Boolean(gutterReasonText) && gutterReasonId === gutterDescribedBy
    );
    record(rows, {
      control: "패널 여백 (Gutter) — 접기 뒤",
      state: "페이지 ▸ 캔버스 ▸ 크기·여백 펼침",
      path: "페이지 탭 → 캔버스 → '크기·여백' 펼치기 → 슬라이더 (3 스텝)",
      verdict: gutterExists && gutterUnavailableExplained ? "reachable" : "blocked",
      effect: gutterDisabled
        ? `비활성 사유가 인라인으로 노출되고 aria-describedby로 연결됨: ${gutterReasonText ?? "사유 없음"}`
        : "슬라이더가 활성 상태로 노출됨",
      defect: !gutterExists
        ? "패널 여백 슬라이더가 렌더되지 않는다"
        : gutterDisabled && !gutterUnavailableExplained
          ? "비활성 사유가 없거나 슬라이더의 aria-describedby와 연결되지 않았다"
          : undefined,
    });

    for (const [name, note] of [
      ["+ 세로 가이드", "가이드선"],
      ["+ 가로 가이드", "가이드선"],
      ["배경 편집기 · 리사이저 열기", "배경·종이 질감"],
    ] as const) {
      const button = canvasPanel.getByRole("button", { name });
      record(rows, {
        control: `${name} — 접기 뒤`,
        state: `페이지 ▸ 캔버스 ▸ ${note} 펼침`,
        path: `페이지 탭 → 캔버스 → '${note}' 펼치기 → 버튼 (3 스텝)`,
        verdict: (await button.count()) > 0 ? "reachable" : "blocked",
        effect: (await button.count()) > 0 ? "펼친 뒤 클릭 가능한 버튼으로 노출됨" : "없음",
      });
    }

    // 가이드 추가는 실제로 문서를 바꿔야 한다 — 목록에 항목이 생기는지 확인한다.
    const addVertical = canvasPanel.getByRole("button", { name: "+ 세로 가이드" });
    if ((await addVertical.count()) > 0) {
      const addClicked = await clickControl(addVertical);
      const guideSlider = canvasPanel.getByRole("slider", { name: /가이드 #1 위치/u });
      const created =
        addClicked
        && (await guideSlider
          .waitFor({ state: "visible", timeout: 4_000 })
          .then(() => true)
          .catch(() => false));
      let deleteClicked = false;
      let removed = false;
      if (created) {
        // 맨 click() 이면 버튼이 사라진/가려진 순간 30초 뒤 throw 해 워크스루가 통째로
        // 끊긴다 — 실패를 boolean 으로 받아 이 행의 결함으로 남긴다.
        deleteClicked = await clickControl(
          canvasPanel.getByRole("button", { name: "모든 가이드 삭제" }),
        );
        removed =
          deleteClicked
          && (await guideSlider
            .waitFor({ state: "detached", timeout: 4_000 })
            .then(() => true)
            .catch(() => false));
      }
      record(rows, {
        control: "가이드 추가 → 목록 → 전체 삭제 (왕복)",
        state: "페이지 ▸ 캔버스 ▸ 가이드선 펼침",
        path: "'+ 세로 가이드' → 목록 항목 확인 → '모든 가이드 삭제'",
        verdict: created && removed ? "reachable" : "blocked",
        effect: `'+ 세로 가이드' 클릭됨=${addClicked}, 가이드 생성=${created}, '모든 가이드 삭제' 클릭됨=${deleteClicked}, 목록이 사라짐=${removed}`,
        defect: !addClicked
          ? "'+ 세로 가이드' 버튼을 클릭할 수 없다"
          : !created
            ? "'+ 세로 가이드' 가 가이드를 만들지 않는다"
            : !deleteClicked
              ? "'모든 가이드 삭제' 버튼이 없거나 클릭되지 않아 추가한 가이드를 되돌릴 수 없다"
              : removed
                ? undefined
                : "삭제가 목록을 비우지 않는다",
      });
    }

    // 접기 상태가 새로고침을 넘어 유지되는지 — 실제 localStorage 를 통과하는 왕복.
    const persistedSection = CANVAS_SECTIONS[1];
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissHydratedQuickStart(page);
    await page.locator(PANEL).waitFor({ state: "visible", timeout: 20_000 });
    await selectPrimaryTab(page, "document");
    // 하위 탭을 못 고르면 접기 상태를 볼 수조차 없다. 반환값을 버리면 그 경우에도
    // aria-expanded=null 이 나와 엉뚱하게 "접기 선택이 사라진다" 로 보고된다.
    const reloadedCanvasTabSelected = await selectDocumentTab(page, "캔버스");
    const persistedExpanded = reloadedCanvasTabSelected
      ? await readAttribute(sectionHeader(page, persistedSection), "aria-expanded")
      : null;
    record(rows, {
      control: "접기 상태 유지 (새로고침 왕복)",
      state: "페이지 ▸ 캔버스",
      path: "섹션 펼치기 → 새로고침 → 같은 섹션 확인",
      verdict: reloadedCanvasTabSelected && persistedExpanded === "true"
        ? "reachable"
        : "blocked",
      effect: reloadedCanvasTabSelected
        ? `새로고침 뒤 ${persistedSection} 의 aria-expanded=${persistedExpanded}`
        : "새로고침 뒤 재시도 3회 동안 '캔버스' 하위 탭이 선택되지 않아 접기 유지 여부를 볼 수 없었다",
      defect: !reloadedCanvasTabSelected
        ? "새로고침 뒤 문서 ▸ 캔버스 하위 탭을 고를 수 없다 — 접기 유지 여부를 판정할 수 없다"
        : persistedExpanded === "true"
          ? undefined
          : "새로고침하면 접기 선택이 사라진다 (탭 왕복마다 다시 열어야 함)",
    });

    /* ---- C. 페이지 ▸ 색보정 / 미니맵 ------------------------------------ */

    if (await selectDocumentTab(page, "색보정")) {
      const gradePanel = await controlledPanel(page, documentTab(page, "색보정"), ["페이지 색보정"]);
      const gradeToggle = gradePanel.locator('button[aria-expanded="false"]').first();
      const hadDisclosure = (await gradeToggle.count()) > 0;
      // 색보정 본체는 lazy 라 이 디스클로저 버튼이 not-stable → not-visible 로 바뀐다.
      // 맨 click() 이면 그 순간 30초 타임아웃으로 throw 해 JSON 리포트와 모바일 워크까지
      // 통째로 날아간다(실측) — 실패를 boolean 으로 받아 blocked 행으로 남긴다.
      const gradeDisclosureOpened = hadDisclosure ? await clickControl(gradeToggle) : false;
      // 색보정 본체는 lazy 다 — 로딩 폴백이 걷힐 때까지 기다린 뒤에 센다.
      await gradePanel
        .locator('input[type="range"]')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => undefined);
      const gradeControls = await gradePanel
        .locator('input[type="range"], button')
        .count();
      record(rows, {
        control: "페이지 색보정",
        state: "페이지 ▸ 색보정",
        path: "페이지 탭 → 색보정 → (닫혀 있으면) 펼치기 (2~3 스텝)",
        verdict:
          gradeControls > 1 && (!hadDisclosure || gradeDisclosureOpened)
            ? "reachable"
            : "blocked",
        effect: `펼친 뒤 컨트롤 ${gradeControls}개 노출 (디스클로저 존재=${hadDisclosure}, 클릭됨=${gradeDisclosureOpened})`,
        defect:
          hadDisclosure && !gradeDisclosureOpened
            ? "색보정 디스클로저 버튼을 클릭할 수 없다 — lazy 본체가 붙는 사이 버튼이 사라진다"
            : gradeControls > 1
              ? undefined
              : "펼쳐도 색보정 컨트롤이 나타나지 않는다",
      });
    } else {
      // 하위 탭을 못 고르면 그 컨트롤은 도달 불가다. note 는 게이트를 통과시키므로
      // (실패 목록은 blocked 행에서만 만들어진다) 반드시 blocked 행으로 남긴다.
      record(rows, {
        control: "페이지 색보정",
        state: "페이지 ▸ 색보정",
        path: "페이지 탭 → 색보정 (2 스텝)",
        verdict: "blocked",
        effect: "재시도 3회 뒤에도 '색보정' 하위 탭이 선택되지 않았다",
        defect: "문서 ▸ 색보정 하위 탭을 고를 수 없어 색보정 컨트롤에 도달할 수 없다",
      });
    }

    if (await selectDocumentTab(page, "미니맵")) {
      const minimap = page.locator(`${PANEL} [aria-label^="미니맵:"]`);
      const minimapVisible = await minimap.isVisible().catch(() => false);
      let keyboardFocusable = false;
      if (minimapVisible) {
        await minimap.focus();
        keyboardFocusable = await minimap.evaluate((node) => node === document.activeElement);
      }
      record(rows, {
        control: "미니맵 · 페이지 탐색",
        state: "페이지 ▸ 미니맵",
        path: "페이지 탭 → 미니맵 (2 스텝)",
        verdict: minimapVisible ? "reachable" : "blocked",
        effect: `렌더됨=${minimapVisible}, 키보드 포커스 가능=${keyboardFocusable} (방향키 스크롤 지원)`,
        defect:
          minimapVisible && !keyboardFocusable
            ? "미니맵이 키보드로 포커스되지 않는다"
            : undefined,
      });
    } else {
      record(rows, {
        control: "미니맵 · 페이지 탐색",
        state: "페이지 ▸ 미니맵",
        path: "페이지 탭 → 미니맵 (2 스텝)",
        verdict: "blocked",
        effect: "재시도 3회 뒤에도 '미니맵' 하위 탭이 선택되지 않았다",
        defect: "문서 ▸ 미니맵 하위 탭을 고를 수 없어 미니맵에 도달할 수 없다",
      });
    }

    /* ---- D. 게시 준비 (탭이 아니라 라우트) ------------------------------- */

    // 예전에는 'publish' 기본 탭을 눌러 이 입력들을 쟀다. 그 탭은 §5.3 에서 사라졌고
    // 작품 정보는 게시 CTA·파일 ▸ 게시·게시 작업공간·검색이 여는 '게시 준비' 모드가 됐다.
    // 재는 대상(제목·설명·태그가 실제로 값을 받는가)은 그대로 두고, 진입만 제품 경로로
    // 바꾼 뒤 이 모드에만 있는 '편집으로 돌아가기' 왕복을 새 행으로 더한다. 기본 진입은
    // 검색 색인과 독립인 '게시' 작업공간 프리셋이고, 막히면 통합 검색으로 물러선다.
    const publishEntry = await openPublishPreparationMode(page);
    const publishRouteLabel =
      publishEntry.route === "workspace"
        ? "게시 작업공간 프리셋"
        : publishEntry.route === "search"
          ? "통합 검색"
          : "진입 실패";
    const inspectorPanel = page.locator(PANEL);
    let titleKept = false;
    let publishFieldsAccepted = false;
    if (publishEntry.routed) {
      // 입력이 없거나 접근명이 바뀌면 fill 이 30초 뒤 throw 하며 워크스루를 끊는다 —
      // 아래 defect 문자열이 기록되도록 값 채우기도 boolean 으로 떨어뜨린다.
      const fillField = async (name: string, value: string): Promise<boolean> => {
        const field = inspectorPanel.getByRole("textbox", { name, exact: true });
        if ((await field.count()) === 0) return false;
        const filled = await field
          .fill(value, { timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!filled) return false;
        return (await field.inputValue().catch(() => null)) === value;
      };
      titleKept = await fillField("작품 제목 (필수)", "워크스루 제목");
      const descriptionKept = await fillField("게시용 설명", "설명");
      const tagsKept = await fillField("게시용 태그", "태그1,태그2");
      publishFieldsAccepted = descriptionKept && tagsKept;
    }
    record(rows, {
      control: "작품 정보 (제목·설명·태그)",
      state: "게시 준비 모드 (상시 탭 아님)",
      path: "작업공간 ▸ '게시' 프리셋 (막히면 통합 검색 → '작품 정보' → Enter) → 입력",
      verdict:
        publishEntry.routed && titleKept && publishFieldsAccepted ? "reachable" : "blocked",
      effect: publishEntry.routed
        ? `${publishRouteLabel} 로 진입; 제목이 문서 상태로 반영됨=${titleKept}, 설명/태그 입력 수용됨=${publishFieldsAccepted}`
        : `게시 준비 모드에 도달하지 못함 — ${publishEntry.failure ?? "사유 미상"}`,
      defect: !publishEntry.routed
        ? "게시 준비 모드에 도달할 수 없다 — 게시 CTA·파일 메뉴는 비로그인 세션에서 저장 게이트에 막히고, 게시 작업공간 프리셋과 통합 검색 두 경로도 모두 실패했다"
        : titleKept
          ? publishFieldsAccepted
            ? undefined
            : "설명·태그 입력이 값을 유지하지 못한다"
          : "작품 정보 입력이 값을 유지하지 못한다",
    });

    // 왕복 — 탭이 아니므로 '편집으로 돌아가기' 가 유일한 복귀 경로다.
    let returnedToEditing = false;
    let backClicked = false;
    if (publishEntry.routed) {
      backClicked = await clickControl(
        publishModeBanner(page).getByRole("button", { name: "편집으로 돌아가기" }),
      );
      const bannerGone =
        backClicked
        && (await publishModeBanner(page)
          .waitFor({ state: "hidden", timeout: 5_000 })
          .then(() => true)
          .catch(() => false));
      returnedToEditing =
        bannerGone
        && (await readAttribute(primaryTab(page, "properties"), "aria-selected")) === "true";
    }
    record(rows, {
      control: "게시 준비 → 편집으로 돌아가기 (왕복)",
      state: "게시 준비 모드",
      path: "게시 준비 배너 → '편집으로 돌아가기' (1 스텝)",
      verdict: returnedToEditing ? "reachable" : "blocked",
      effect: publishEntry.routed
        ? `'편집으로 돌아가기' 클릭됨=${backClicked}, 배너가 사라지고 대상 탭이 다시 선택됨=${returnedToEditing}`
        : `게시 준비 모드에 도달하지 못해 복귀 버튼을 밟지 못했다 — ${publishEntry.failure ?? "사유 미상"}`,
      defect: returnedToEditing
        ? undefined
        : !publishEntry.routed
          ? "게시 준비 모드 진입이 막혀 복귀 경로를 구동하지 못했다"
          : backClicked
            ? "게시 준비 모드가 편집으로 돌아가지 못한다 — 탭이 아니므로 탭 스트립으로도 빠져나올 수 없다"
            : "'편집으로 돌아가기' 버튼이 없거나 클릭되지 않는다 — 게시 준비 모드에서 빠져나올 어포던스가 없다",
    });

    // 작업공간 프리셋으로 진입했다면 배치가 커밋된 상태다 — 여기서 되돌리지 않으면
    // 아래 E~I 구획과 모바일 워크가 기본 배치가 아니라 '게시' 배치를 측정한다.
    // 복원 자체를 행으로 남겨, 조용히 실패해도 리포트가 RESULT: OK 로 끝나지 않게 한다.
    if (publishEntry.restoreUnavailable) {
      // 전환은 커밋됐는데 되돌릴 좌표가 없다. 복원을 시도할 수조차 없으므로 아래 구획들은
      // '게시' 배치를 재게 된다 — 그 사실 자체가 실패다.
      record(rows, {
        control: "게시 작업공간 → 원래 작업공간 복원 (측정 전제)",
        state: "게시 작업공간으로 전환된 뒤",
        path: "작업공간 버튼 → 전환 전 활성 항목 (2 스텝)",
        verdict: "blocked",
        effect: `복원 불가 — ${publishEntry.restoreUnavailable}`,
        defect: "게시 작업공간 전환이 커밋된 채로 남아 이후 행들이 기본 배치를 측정하지 못한다",
      });
    } else if (publishEntry.restoreWorkspace) {
      const target = publishEntry.restoreWorkspace;
      const restoreFailure = await restoreWorkspace(page, target);
      record(rows, {
        control: "게시 작업공간 → 원래 작업공간 복원 (측정 전제)",
        state: "게시 작업공간으로 전환된 뒤",
        path: `작업공간 버튼 → '${target.name}' 다시 선택 (2 스텝)`,
        verdict: restoreFailure === null ? "reachable" : "blocked",
        effect:
          restoreFailure === null
            ? `활성 작업공간이 '${target.name}'(${target.id}) 로 돌아왔고 게시 배너도 사라졌다`
            : `복원 실패 — ${restoreFailure}`,
        defect:
          restoreFailure === null
            ? undefined
            : "게시 작업공간 전환이 커밋된 채로 남아 이후 행들이 기본 배치를 측정하지 못한다",
      });
    }

    /* ---- E. 레이어 ------------------------------------------------------ */

    await selectPrimaryTab(page, "layers");
    const layersPanel = await controlledPanel(page, primaryTab(page, "layers"), ["레이어"]);
    const layerNavigatorMounted = await layersPanel
      .locator("section, ul, [role='tree'], [role='listbox']")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    record(rows, {
      control: "레이어 탐색기",
      state: "레이어 탭",
      path: "레이어 탭 (1 스텝)",
      verdict: layerNavigatorMounted ? "reachable" : "blocked",
      effect: `lazy 로드된 레이어 탐색기가 마운트됨=${layerNavigatorMounted}`,
    });

    /* ---- F. 속성 · 선택 없음 (시작 안내) --------------------------------- */

    await selectPrimaryTab(page, "properties");
    const coach = page.locator('[data-testid="studio-inspector-empty-coach"]');
    const coachVisible = await coach.isVisible().catch(() => false);
    if (coachVisible) {
      // 시작 안내는 세 카드다(UX 감사 2026-09-02 §5.8) — 선택 도구·레이어 패널 카드는 탭과 단축키로 대체됐다.
      for (const [name, accessibleName] of [
        ["펜으로 그리기", "펜으로 그리기"],
        ["이미지 편집", "이미지 편집 · 전문 도구 열기"],
        ["사용법 따라 하기", "스튜디오 사용법 따라 하기"],
      ] as const) {
        record(rows, {
          control: `시작 안내 · ${name}`,
          state: "속성 탭 · 선택 없음 · 그리기 아님",
          path: "속성 탭 → 카드 버튼 (2 스텝)",
          verdict:
            (await coach.getByRole("button", { name: accessibleName, exact: true }).count()) > 0
              ? "reachable"
              : "blocked",
          effect: "빈 상태에서 다음 행동을 제안하는 카드로 노출됨",
        });
      }
      // 펜 버튼은 실제로 도구를 바꾸고 인스펙터를 그리기 패널로 넘겨야 한다.
      // 클릭 자체가 카드 리렌더와 겹치면 맨 click() 은 30초 뒤 throw 해 워크스루를
      // 끊는다 — boolean 으로 받아 이 행의 결함으로 남긴다.
      const penClicked = await clickControl(
        coach.getByRole("button", { name: /펜으로 그리기/u }),
      );
      const switchedToDrawing =
        penClicked
        && (await page
          .locator('[data-testid="studio-inspector-context-drawing-panel"]')
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false));
      record(rows, {
        control: "시작 안내 → 그리기 전환 (실효)",
        state: "속성 탭 · 선택 없음",
        path: "'펜으로 그리기' 클릭",
        verdict: switchedToDrawing ? "reachable" : "blocked",
        effect: `'펜으로 그리기' 클릭됨=${penClicked}, 인스펙터가 그리기 도구 설정 패널로 실제 전환됨=${switchedToDrawing}`,
        defect: !penClicked
          ? "'펜으로 그리기' 카드 버튼을 클릭할 수 없다"
          : switchedToDrawing
            ? undefined
            : "버튼이 도구를 바꾸지 못한다",
      });
    } else {
      // 게이트가 아니라 note 인 이유: 이 빌드는 제품 결정상 Studio 를 **그리기 모드**로
      // 열고(스튜디오 기본 도구 = 펜), 그 상태에서 속성 탭은 시작 안내가 아니라 그리기
      // 도구 설정 패널을 보여 준다. 즉 '선택 없음 · 그리기 아님' 이라는 빈 코치 상태는
      // 이 진입 경로에서 실제로 발생하지 않는다 — 도달 불가가 아니라 존재하지 않는
      // 상태이므로 blocked 행이 아니라 note 다.
      report.notes.push(
        "시작 안내(빈 코치) 카드 행은 구동하지 않았다 — 이 빌드는 제품 결정상 Studio 를 "
          + "그리기 모드(기본 도구 = 펜)로 열기 때문에, 속성 탭이 곧바로 그리기 도구 설정 "
          + "패널로 진입해 '선택 없음 · 그리기 아님' 빈 코치 상태 자체가 발생하지 않는다. "
          + "인스펙터가 막은 것이 아니라 그 상태가 없는 것이라 blocked 가 아니라 note 다.",
      );
    }

    /* ---- G. 속성 · 그리기 도구 ------------------------------------------ */

    const drawingPanel = page.locator('[data-testid="studio-inspector-context-drawing-panel"]');
    if (await drawingPanel.isVisible().catch(() => false)) {
      let presetGroup = drawingPanel.getByRole("group", { name: "브러시 크기 프리셋" });
      let presetSurface = drawingPanel;
      // 전체 팔레트 모드에서는 컨트롤이 인라인이지만, 기본 icon-popup 모드에서는
      // 도구 속성 런처를 먼저 열어야 한다. 숨은 DOM을 직접 찾지 말고 실제 사용자 경로를 밟는다.
      let presetVisible = await presetGroup.isVisible().catch(() => false);
      let presetPath = "펜 도구(B) → 속성 탭 → 프리셋 클릭 (2 스텝)";
      if (!presetVisible) {
        const trigger = drawingPanel.locator(
          '[data-studio-drawing-palette-icon-trigger="tool-properties"]',
        ).first();
        // drawingPanel 자체가 먼저 보이고 palette stack은 lazy/Suspense 뒤에 붙을 수 있다.
        // 즉시 isVisible 한 번으로 icon-popup 모드를 놓치지 않도록 런처를 제한 시간 기다린다.
        const triggerVisible = await trigger
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (triggerVisible && (await clickControl(trigger))) {
          const popup = page.locator(
            '[data-studio-drawing-palette-overlay="palette"]'
              + '[data-studio-drawing-palette-overlay-id="tool-properties"]',
          );
          const popupVisible = await popup
            .waitFor({ state: "visible", timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
          if (popupVisible) {
            presetSurface = popup;
            presetGroup = popup.getByRole("group", { name: "브러시 크기 프리셋" });
            presetVisible = await presetGroup
              .waitFor({ state: "visible", timeout: 15_000 })
              .then(() => true)
              .catch(() => false);
            presetPath = "펜 도구(B) → 도구 속성 팝업 → 프리셋 클릭 (3 스텝)";
          }
        } else {
          // 저장된 프레젠테이션이 full이면 런처 없이 인라인 팔레트가 늦게 나타난다.
          presetVisible = await presetGroup
            .waitFor({ state: "visible", timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
        }
      }
      let sizeApplied = false;
      let presetClicked = false;
      let presetDiagnostics = "preset group not visible";
      if (presetVisible) {
        const target = presetGroup.getByRole("button", { name: "브러시 크기 30px" });
        const readPresetState = async () => ({
          pressed: await presetGroup
            .locator('button[aria-pressed="true"]')
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
          range: await presetSurface.locator('input[type="range"]').first().inputValue(),
        });
        const before = await readPresetState();
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        presetClicked = await clickControl(target);
        // React가 같은 클릭에서 도구 메모리와 최근 크기 목록을 함께 갱신한다. 프로덕션
        // 번들/느린 CI에서는 커밋이 Playwright click 반환보다 한 프레임 늦을 수 있으므로,
        // 즉시 읽기 한 번으로 정상 동작을 실패 처리하지 않고 짧고 제한된 시간만 관찰한다.
        const pressedDeadline = Date.now() + 2_000;
        while (presetClicked) {
          sizeApplied = (await readAttribute(target, "aria-pressed")) === "true";
          if (sizeApplied || Date.now() >= pressedDeadline) break;
          await page.waitForTimeout(50);
        }
        const after = await readPresetState();
        presetDiagnostics = `before=${JSON.stringify(before)}; after=${JSON.stringify(after)}`;
      }
      record(rows, {
        control: "브러시 크기 프리셋 그리드",
        state: "속성 탭 · 그리기 도구",
        path: presetPath,
        verdict: presetVisible && sizeApplied ? "reachable" : "blocked",
        effect: `30px 프리셋 클릭됨=${presetClicked}, aria-pressed=true 로 적용됨=${sizeApplied}; ${presetDiagnostics}`,
        defect: !presetVisible
          ? undefined
          : presetClicked
            ? sizeApplied
              ? undefined
              : "프리셋 클릭이 활성 크기를 바꾸지 않는다"
            : "30px 프리셋 버튼을 클릭할 수 없다",
      });

      for (const sectionId of [
        "tool.line-correction",
        "tool.brush-studio",
        "tool.brush-engines",
        "tool.symmetry",
        "tool.rulers",
      ]) {
        const header = sectionHeader(page, sectionId);
        const exists = (await header.count()) > 0;
        const opened = exists ? await openSectionByKeyboard(page, sectionId) : false;
        record(rows, {
          control: `도구 속성 접기 · ${sectionId}`,
          state: "속성 탭 · 그리기 도구",
          path: "펜 도구 → 속성 탭 → 섹션 헤더 Enter (3 스텝)",
          verdict: exists ? (opened ? "reachable" : "blocked") : "not-exercised",
          effect: exists
            ? `키보드로 펼침=${opened}`
            : "이 도구 모드에서는 렌더되지 않음 (해당 도구 선택 시에만 노출)",
          defect: exists && !opened ? "헤더는 있으나 키보드로 열리지 않는다" : undefined,
        });
      }
    }

    /* ---- H. 속성 · 선택 있음 -------------------------------------------- */

    // 실제 스트로크를 그려 선택 가능한 요소를 만든다 — "선택이 필요한데 만들 방법이
    // 없다" 를 검증하려면 만들 방법 자체를 밟아 봐야 한다.
    const stage = page.locator("[data-studio-canvas-viewport] canvas").first();
    const stageBox = await stage.boundingBox().catch(() => null);
    let selectionPanelVisible = false;
    if (stageBox) {
      const cx = stageBox.x + stageBox.width / 2;
      const cy = stageBox.y + Math.min(stageBox.height / 2, 240);
      await page.mouse.move(cx - 60, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + 40, { steps: 12 });
      await page.mouse.move(cx + 60, cy, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(400);

      await page.keyboard.press("v");
      await page.waitForTimeout(200);
      await page.mouse.click(cx, cy + 30);
      await page.waitForTimeout(400);
      selectionPanelVisible = await page
        .locator('[data-testid="studio-inspector-context-selection"]')
        .isVisible()
        .catch(() => false);
    }

    // 캔버스 히트테스트가 빗나가도 요소를 만들고 고르는 경로가 있어야 한다 —
    // "선택이 필요한데 만들 방법이 없다"를 배제하는 두 번째·세 번째 동선.
    let insertedViaCommandSearch = false;
    if (!selectionPanelVisible) {
      // F1 통합 검색 → '말풍선 추가' — 빈 문서에서 선택 가능한 요소를 만드는 정식 경로.
      await page.keyboard.press("F1");
      const dialog = commandSearchDialog(page);
      if (
        await dialog
          .waitFor({ state: "visible", timeout: 5_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await page.keyboard.type("말풍선 추가");
        await page.waitForTimeout(500);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        // 검색이 아무것도 못 찾으면 다이얼로그가 그대로 남고, 엉뚱한 결과가 실행되면
        // 도움말 센터 같은 다른 모달이 열린다 — 어느 쪽이든 백드롭이 이후 클릭을 전부
        // 가로채므로 열린 모달을 모두 닫고 나간다.
        await dismissOpenModals(page);
        await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
        await selectPrimaryTab(page, "properties");
        selectionPanelVisible = await page
          .locator('[data-testid="studio-inspector-context-selection"]')
          .waitFor({ state: "visible", timeout: 6_000 })
          .then(() => true)
          .catch(() => false);
        insertedViaCommandSearch = selectionPanelVisible;
      }
    }

    let selectedViaLayerPanel = false;
    if (!selectionPanelVisible) {
      await selectPrimaryTab(page, "layers");
      const row = page.locator(`${PANEL} [role="treeitem"]`).first();
      if (
        await row
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        await clickControl(row);
        await selectPrimaryTab(page, "properties");
        selectionPanelVisible = await page
          .locator('[data-testid="studio-inspector-context-selection"]')
          .waitFor({ state: "visible", timeout: 6_000 })
          .then(() => true)
          .catch(() => false);
        selectedViaLayerPanel = selectionPanelVisible;
      }
    }
    record(rows, {
      control: "선택 요소 속성 진입 (스트로크 그리기 → 선택)",
      state: "속성 탭 · 요소 선택됨",
      path: insertedViaCommandSearch
        ? "F1 통합 검색 → '말풍선 추가' → Enter → 속성 탭 (3 스텝)"
        : selectedViaLayerPanel
          ? "펜으로 캔버스 드래그 → 레이어 탭 → 레이어 행 클릭 → 속성 탭 (4 스텝)"
          : "펜으로 캔버스 드래그 → V → 스트로크 클릭 (3 스텝)",
      verdict: selectionPanelVisible ? "reachable" : "not-exercised",
      effect: selectionPanelVisible
        ? `선택 요소 속성 탭패널이 나타났다 (F1 삽입 경로=${insertedViaCommandSearch}, 레이어 패널 경로=${selectedViaLayerPanel})`
        : "헤드리스에서 캔버스 히트테스트·F1 삽입·레이어 행 어느 쪽으로도 선택을 만들지 못했다",
      defect: undefined,
    });

    if (selectionPanelVisible) {
      const selectionPanel = page.locator('[data-testid="studio-inspector-context-selection"]');
      const opacity = selectionPanel.getByRole("slider", { name: /불투명도/u }).first();
      let opacityChanged = false;
      if ((await opacity.count()) > 0) {
        const before = await opacity.inputValue();
        await opacity.fill("50");
        opacityChanged = (await opacity.inputValue()) !== before;
      }
      // 존재만으로 통과시키면 슬라이더가 값을 먹지 않아도 reachable 이 된다 —
      // 측정한 opacityChanged 가 판정을 쥐게 한다.
      const opacityExists = (await opacity.count()) > 0;
      record(rows, {
        control: "선택 요소 · 불투명도 (기본 티어)",
        state: "속성 탭 · 요소 선택됨",
        path: "요소 선택 → 슬라이더 (0 추가 스텝)",
        verdict: opacityExists && opacityChanged ? "reachable" : "blocked",
        effect: `슬라이더 존재=${opacityExists}, 값 변경 반영됨=${opacityChanged}`,
        defect: !opacityExists
          ? "선택 요소 속성에 불투명도 슬라이더가 없다"
          : opacityChanged
            ? undefined
            : "불투명도 슬라이더가 값을 받지 않는다",
      });

      for (const sectionId of [
        "element.layout",
        "element.order-align",
        "element.constraints",
      ]) {
        const header = sectionHeader(page, sectionId);
        const exists = (await header.count()) > 0;
        const opened = exists ? await openSectionByKeyboard(page, sectionId) : false;
        record(rows, {
          control: `선택 요소 접기 · ${sectionId}`,
          state: "속성 탭 · 요소 선택됨",
          path: "요소 선택 → 섹션 헤더 Enter (1 스텝)",
          verdict: exists ? (opened ? "reachable" : "blocked") : "not-exercised",
          effect: exists ? `키보드로 펼침=${opened}` : "이 선택 타입에서는 렌더되지 않음",
        });
      }
    } else {
      report.notes.push(
        "선택 기반 컨트롤(불투명도·혼합 모드·클리핑·그룹·배치·정렬·순서·타이포그래피·말풍선 등)은 "
          + "이 하니스에서 구동하지 못했다. 원인은 인스펙터가 아니라 문서다: "
          + "펜 스트로크 드래그 · F1 통합 검색 '말풍선 추가' · 레이어 탭의 레이어 트리 행 클릭 "
          + "세 경로를 모두 밟았지만 "
          + "vite preview(백엔드 API 없음)에서는 문서에 요소가 하나도 생기지 않았다(레이어 트리 0행, JS 오류 없음, "
          + "502 는 /api 프록시뿐). 즉 '선택이 필요한 컨트롤에 도달할 수 없다'가 아니라 "
          + "'이 하니스에서 선택 대상을 만들 수 없다'다. 해당 분기는 jsdom 단위 테스트가 덮는다.",
      );
    }

    /* ---- I. 접기/펼치기 왕복 ------------------------------------------- */

    await selectPrimaryTab(page, "properties");
    const collapseButton = panel.locator('button[title="작업 패널 접기"]');
    const collapseClicked = await clickControl(collapseButton);
    const collapsedAway =
      collapseClicked
      && (await panel
        .waitFor({ state: "hidden", timeout: 5_000 })
        .then(() => true)
        .catch(() => false));
    const edgeRail = page.locator('button[title="작업 패널 펼치기"]');
    const railVisible = await edgeRail.isVisible().catch(() => false);
    let restored = false;
    if (railVisible && (await clickControl(edgeRail))) {
      restored = await panel
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    }
    record(rows, {
      control: "인스펙터 접기 → 엣지 레일 → 펼치기 (왕복)",
      state: "데스크톱",
      path: "인스펙터 상단 '접기' → 우측 엣지 레일 '작업 패널' 클릭",
      verdict: collapsedAway && restored ? "reachable" : "blocked",
      effect: `'접기' 클릭됨=${collapseClicked}, 접힘=${collapsedAway}, 복구 레일 노출=${railVisible}, 복원=${restored} — 캔버스가 패널 폭 전체를 회수한다`,
      defect: !collapseClicked
        ? "'작업 패널 접기' 버튼을 클릭할 수 없다"
        : collapsedAway && !railVisible
          ? "접은 뒤 되돌릴 어포던스가 없다"
          : undefined,
    });

    await page.screenshot({ path: join(SCRATCH, "inspector-desktop.png") }).catch(() => undefined);
  } finally {
    await context.close();
  }
}

/* -------------------------------------------------------------- mobile run */

async function walkMobile(
  browser: Browser,
  baseUrl: string,
  report: WalkthroughReport,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    isMobile: true,
    userAgent: MOBILE_UA,
    locale: "ko-KR",
  });
  await installStudioPreferences(context, true);
  const page = await context.newPage();
  const rows = report.rows;

  try {
    await gotoStudio(page, baseUrl);
    await page
      .locator('nav[aria-label="스튜디오 모바일 도구막대"]')
      .waitFor({ state: "visible", timeout: 20_000 });

    // 인스펙터 런처('패널')는 접힌 2행에 있다. 1행의 '도구' disclosure 는 가로
    // 드로잉 스크롤 밖에 고정되어, 360px 첫 화면에서도 스와이프 없이 보여야 한다.
    const workspaceToggle = page.locator('[data-studio-mobile-workspace-toggle="true"]');
    const toggleInitiallyVisible = await workspaceToggle.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const dockBounds = element
        .closest<HTMLElement>('[data-studio-mobile-editing-dock="true"]')
        ?.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return Boolean(
        dockBounds
        && !element.closest('[data-studio-mobile-dock-scroll]')
        && bounds.width >= 44
        && bounds.height >= 44
        && bounds.left >= dockBounds.left - 0.5
        && bounds.right <= dockBounds.right + 0.5
        && bounds.left >= -0.5
        && bounds.right <= window.innerWidth + 0.5
        && (hit === element || element.contains(hit))
      );
    });
    const toggleExpandedBefore = await readAttribute(workspaceToggle, "aria-expanded");
    const toggleClicked = await clickControl(workspaceToggle);
    const toggleExpandedAfter = toggleClicked
      ? await readAttribute(workspaceToggle, "aria-expanded")
      : null;
    record(rows, {
      control: "모바일 작업공간 도구 펼치기 (인스펙터 진입 선행 단계)",
      state: "360px",
      path: "하단 도크 1행의 고정 ∧ '도구' 토글 (1 스텝)",
      verdict:
        toggleInitiallyVisible && toggleExpandedAfter === "true"
          ? "reachable"
          : "blocked",
      effect:
        `초기 고정·히트 가능=${toggleInitiallyVisible}; `
        + `aria-expanded ${toggleExpandedBefore} → ${toggleExpandedAfter}; `
        + "2행(댓글·페이지·필터·새 작업·패널·색각·줌)이 나타난다",
      defect:
        !toggleInitiallyVisible
          ? "도구 토글이 첫 화면에 고정되지 않았거나 실제 히트테스트를 통과하지 못한다"
          : !toggleClicked
            ? "'도구' 토글을 클릭할 수 없다"
            : toggleExpandedAfter !== "true"
              ? "작업공간 토글이 2행을 펼치지 못한다"
              : undefined,
    });

    const launcher = page.locator(
      'nav[aria-label="스튜디오 모바일 도구막대"] button[aria-label="작업 패널"]',
    );
    const launcherInitiallyVisible = await launcher.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const scrollBounds = element
        .closest<HTMLElement>('[data-studio-mobile-dock-scroll="secondary"]')
        ?.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return Boolean(
        scrollBounds
        && bounds.width >= 44
        && bounds.height >= 44
        && bounds.left >= scrollBounds.left - 0.5
        && bounds.right <= scrollBounds.right + 0.5
        && (hit === element || element.contains(hit))
      );
    });
    if (!launcherInitiallyVisible) {
      record(rows, {
        control: "모바일 작업 패널 열기",
        state: "360px · 도구 행 펼침",
        path: "하단 도구막대 '도구' → '패널' (2 스텝)",
        verdict: "blocked",
        effect: "패널 런처가 2행의 초기 가시 영역에 없거나 실제 히트테스트를 통과하지 못함",
      });
      return;
    }
    const launcherClicked = await clickControl(launcher);

    const sheet = page.locator(PANEL);
    const opened =
      launcherClicked
      && (await sheet
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false));
    record(rows, {
      control: "모바일 작업 패널 열기",
      state: "360px",
      path: "하단 도구막대 '도구' → '패널' (2 스텝)",
      verdict: opened ? "reachable" : "blocked",
      effect: `런처 초기 가시·히트 가능=${launcherInitiallyVisible}, 클릭됨=${launcherClicked}; role=dialog 시트가 올라옴=${opened}`,
      defect: opened
        ? undefined
        : launcherClicked
          ? "360px 에서 인스펙터에 도달할 수 없다"
          : "'작업 패널' 런처를 클릭할 수 없다",
    });
    if (!opened) return;

    report.mobile.panel = await measure(sheet);
    report.mobile.chromeHeight = await measureChromeHeight(page);
    log(
      `mobile sheet ${report.mobile.panel.width}×${report.mobile.panel.height}, chrome ${report.mobile.chromeHeight}px`,
    );

    // 탭 스트립이 360px 에서도 전부 닿는가. 스트립은 세 탭이다(대상·레이어·문서) —
    // 작품 정보는 탭이 아니라 아래에서 따로 재는 '게시 준비' 모드다(§5.3).
    for (const tab of ["properties", "layers", "document"]) {
      const button = page.locator(`${NAVIGATOR} [data-studio-inspector-primary-tab="${tab}"]`);
      // boundingBox() 는 요소를 기다렸다가 throw 한다 — 탭이 사라지면 그 사실을 보고할
      // 행에 닿기도 전에 워크 전체가 끊긴다. 없으면 null 로 받아 blocked 행으로 남긴다.
      const box = (await button.count()) > 0
        ? await button.boundingBox().catch(() => null)
        : null;
      const inViewport = box !== null && box.x >= 0 && box.x + box.width <= 360;
      record(rows, {
        control: `모바일 탭 · ${tab}`,
        state: "360px · 속성 시트 열림",
        path: "'작업' 시트 → 탭 스트립 (2 스텝)",
        verdict: inViewport ? "reachable" : "blocked",
        effect: `가로 360px 안에 들어옴=${inViewport} (x=${Math.round(box?.x ?? -1)}, w=${Math.round(box?.width ?? 0)})`,
        defect: inViewport
          ? undefined
          : box === null
            ? "탭이 렌더되지 않아 360px 안에 있는지 잴 수 없다"
            : "탭이 뷰포트 밖으로 잘린다",
      });
    }

    // 네 번째 탭이 사라진 자리 — 작품 정보는 시트 헤더의 '찾기'(같은 통합 다이얼로그)로
    // 열리는 게시 준비 모드다. 예전 'publish 탭' 행이 재던 것(360px 안에 들어오는가)을
    // 이 모드의 배너와 복귀 버튼에 대해 그대로 재고, 복귀까지 확인한다. 여기서 작업공간
    // 프리셋으로 물러서지 않는 이유: 시트가 모달이라 뒤의 메뉴바 작업공간 버튼은 이
    // 상태에서 사용자도 누를 수 없다 — 이 화면의 실제 경로는 시트의 '찾기' 하나다.
    const mobilePublishEntry = await openPublishPreparationModeViaSearch(page);
    let publishBannerBox: { x: number; width: number } | null = null;
    let publishBackInViewport = false;
    let mobileReturnedToEditing = false;
    let mobileBackClicked = false;
    if (mobilePublishEntry.routed) {
      const banner = publishModeBanner(page);
      const bannerBox = await banner.boundingBox().catch(() => null);
      publishBannerBox = bannerBox ? { x: bannerBox.x, width: bannerBox.width } : null;
      const back = banner.getByRole("button", { name: "편집으로 돌아가기" });
      const backBox =
        (await back.count().catch(() => 0)) > 0
          ? await back.boundingBox().catch(() => null)
          : null;
      publishBackInViewport =
        backBox !== null && backBox.x >= 0 && backBox.x + backBox.width <= 360;
      mobileBackClicked = await clickControl(back);
      const bannerGone =
        mobileBackClicked
        && (await banner
          .waitFor({ state: "hidden", timeout: 5_000 })
          .then(() => true)
          .catch(() => false));
      mobileReturnedToEditing =
        bannerGone
        && (await readAttribute(primaryTab(page, "properties"), "aria-selected")) === "true";
    }
    record(rows, {
      control: "모바일 게시 준비 모드 (작품 정보)",
      state: "360px · 작업 시트 열림",
      path: "'작업' 시트 → '찾기' → '작품 정보' → Enter (4 스텝)",
      verdict:
        mobilePublishEntry.routed && publishBackInViewport && mobileReturnedToEditing
          ? "reachable"
          : "blocked",
      effect: mobilePublishEntry.routed
        ? `배너 x=${Math.round(publishBannerBox?.x ?? -1)}, w=${Math.round(publishBannerBox?.width ?? 0)}; `
          + `'편집으로 돌아가기' 가 360px 안=${publishBackInViewport}, 클릭됨=${mobileBackClicked}; `
          + `편집 복귀=${mobileReturnedToEditing}`
        : `게시 준비 모드에 도달하지 못함 — ${mobilePublishEntry.failure ?? "사유 미상"}`,
      defect: !mobilePublishEntry.routed
        ? "360px 에서 작품 정보(게시 준비)에 도달할 수 없다"
        : !publishBackInViewport
          ? "복귀 버튼이 뷰포트 밖으로 잘린다"
          : !mobileBackClicked
            ? "'편집으로 돌아가기' 버튼을 클릭할 수 없다"
            : !mobileReturnedToEditing
              ? "게시 준비 모드에서 편집으로 돌아오지 못한다"
              : undefined,
    });

    await selectPrimaryTab(page, "document");
    const mobileCanvasTabSelected = await selectDocumentTab(page, "캔버스");
    const canvasPanel = await controlledPanel(page, documentTab(page, "캔버스"), ["캔버스 설정"]);
    const mobileCanvasVisible =
      mobileCanvasTabSelected && (await canvasPanel.isVisible().catch(() => false));
    if (mobileCanvasVisible) {
      report.mobile.canvasPanelCollapsed = (await measure(canvasPanel)).height;
      const collapsedHeaders = await page
        .locator('[data-inspector-section-open="false"]')
        .count();
      record(rows, {
        control: "모바일 캔버스 패널 (접힌 기본 상태)",
        state: "360px · 페이지 ▸ 캔버스",
        path: "'작업' 시트 → 페이지 → 캔버스 (3 스텝)",
        verdict: collapsedHeaders >= CANVAS_SECTIONS.length ? "reachable" : "blocked",
        effect: `접힌 섹션 ${collapsedHeaders}개, 패널 높이 ${report.mobile.canvasPanelCollapsed}px`,
      });
    } else {
      // 조용히 행을 빼면 360px 캔버스 패널이 사라져도 리포트는 OK 로 끝난다.
      record(rows, {
        control: "모바일 캔버스 패널 (접힌 기본 상태)",
        state: "360px · 페이지 ▸ 캔버스",
        path: "'작업' 시트 → 페이지 → 캔버스 (3 스텝)",
        verdict: "blocked",
        effect: `'캔버스' 하위 탭 선택됨=${mobileCanvasTabSelected}, 캔버스 설정 패널 표시됨=false`,
        defect: "360px 에서 페이지 ▸ 캔버스 패널에 도달할 수 없다",
      });
    }

    // 터치 대상 감사 — 시트 안의 모든 인터랙티브 요소.
    report.mobile.smallTouchTargets = await page.evaluate((panelSelector) => {
      const sheetRoot = document.querySelector<HTMLElement>(panelSelector);
      if (!sheetRoot) return [];
      const interactive = [
        ...sheetRoot.querySelectorAll<HTMLElement>(
          'button, [role="tab"], a[href], select, input:not([type="hidden"]), textarea, [role="button"]',
        ),
      ];
      const small: { label: string; height: number }[] = [];
      for (const node of interactive) {
        if (node.closest("[hidden]") || node.hasAttribute("hidden")) continue;
        const rect = node.getBoundingClientRect();
        if (rect.height < 2 || rect.width < 2) continue;
        // 실제 탭 대상은 감싸는 <label> 이나 부모 hit-area 일 수 있다
        // (스와치 버튼, 체크박스 행). 그 높이를 유효 터치 크기로 본다.
        const effective = Math.max(
          rect.height,
          node.parentElement?.getBoundingClientRect().height ?? 0,
          node.closest("label")?.getBoundingClientRect().height ?? 0,
        );
        if (effective >= 44) continue;
        const label =
          node.getAttribute("aria-label")
          ?? node.getAttribute("title")
          ?? (node.textContent ?? "").trim().slice(0, 30)
          ?? node.tagName;
        small.push({ label: label || node.tagName, height: Math.round(rect.height) });
      }
      return small;
    }, PANEL);

    // 시트 스냅 — 크기를 바꿔 캔버스를 되찾을 수 있는가.
    // 페이지 시트에도 같은 핸들이 있다 — 속성 시트의 것만 잡는다.
    const handle = sheet
      .locator('[data-studio-sheet-drag-handle="true"][data-studio-sheet-kind="props"]')
      .first();
    const snapBefore = await readAttribute(sheet, "data-studio-sheet-snap");
    let snapChanged = false;
    let handleClicked = false;
    if ((await handle.count()) > 0) {
      handleClicked = await clickControl(handle);
      if (handleClicked) {
        await awaitElementAnimations(sheet);
        snapChanged = (await readAttribute(sheet, "data-studio-sheet-snap")) !== snapBefore;
      }
    }
    record(rows, {
      control: "모바일 시트 스냅 (compact/medium/full)",
      state: "360px · 속성 시트 열림",
      path: "시트 상단 드래그 핸들 탭 (2 스텝)",
      verdict: snapChanged ? "reachable" : "blocked",
      effect: `핸들 클릭됨=${handleClicked}; 스냅 ${snapBefore} → ${await readAttribute(sheet, "data-studio-sheet-snap")} — 시트를 줄여 캔버스를 되찾을 수 있다`,
      defect: snapChanged
        ? undefined
        : handleClicked
          ? "핸들 탭이 스냅을 바꾸지 않는다"
          : "시트 드래그 핸들이 없거나 클릭되지 않는다",
    });

    const closeButton = page.getByRole("button", { name: "작업 패널 닫기", exact: true });
    let closed = false;
    const closeClicked = await clickControl(closeButton);
    if (closeClicked) {
      closed = await sheet
        .waitFor({ state: "hidden", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
    }
    record(rows, {
      control: "모바일 시트 닫기 (왕복)",
      state: "360px · 속성 시트 열림",
      path: "시트 헤더 X (1 스텝)",
      verdict: closed ? "reachable" : "blocked",
      effect: `'작업 패널 닫기' 클릭됨=${closeClicked}, 시트가 닫혀 캔버스가 화면 전체를 회수함=${closed}`,
      defect: closed
        ? undefined
        : closeClicked
          ? "닫기 버튼을 눌러도 시트가 닫히지 않는다"
          : "시트 헤더에 '작업 패널 닫기' 버튼이 없거나 클릭되지 않는다",
    });

    await page.screenshot({ path: join(SCRATCH, "inspector-mobile-360.png") }).catch(() => undefined);
  } finally {
    await context.close();
  }
}

/* --------------------------------------------------------------------- run */

async function main(): Promise<void> {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error('missing dist/index.html; run "pnpm run build" first');
  }

  const port = await findFreePort({ unavailableMessage: "could not allocate preview port" });
  const baseUrl = `http://127.0.0.1:${port}`;
  let previewServer: PreviewServer | null = null;
  let browser: Browser | null = null;

  const report: WalkthroughReport = {
    desktop: {
      panel: { width: 0, height: 0 },
      chromeHeight: -1,
      chromeBands: {},
      canvasPanelCollapsed: -1,
      canvasPanelExpanded: -1,
    },
    mobile: {
      panel: { width: 0, height: 0 },
      chromeHeight: -1,
      canvasPanelCollapsed: -1,
      smallTouchTargets: [],
    },
    rows: [],
    notes: [],
    failures: [],
  };

  try {
    previewServer = await preview({
      preview: { host: "127.0.0.1", port, strictPort: true },
    });
    await waitForServer(baseUrl, {
      notReadyMessage: `preview did not become ready: ${baseUrl}`,
    });
    log(`production preview ready @ ${baseUrl}`);

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    await walkDesktop(browser, baseUrl, report);
    await walkMobile(browser, baseUrl, report);
  } finally {
    await browser?.close().catch(() => undefined);
    await previewServer?.close();
  }

  for (const row of report.rows) {
    if (row.verdict === "blocked") {
      report.failures.push(`${row.control}: ${row.defect ?? row.effect}`);
    }
  }
  if (report.desktop.canvasPanelCollapsed >= report.desktop.canvasPanelExpanded) {
    report.failures.push(
      "canvas panel is not actually shorter when collapsed — the disclosure buys nothing",
    );
  }
  // 크롬 높이는 재기만 하고 게이트하지 않으면, -1(패널이나 첫 탭패널을 아예 못 찾음)이
  // 리포트에 찍힌 채로 RESULT: OK 가 나온다. 측정 실패는 측정값이 아니라 결함이다.
  for (const [surface, chromeHeight] of [
    ["desktop", report.desktop.chromeHeight],
    ["mobile", report.mobile.chromeHeight],
  ] as const) {
    if (chromeHeight < 0) {
      report.failures.push(
        `${surface} 인스펙터 크롬 높이를 측정하지 못했다 (${chromeHeight}) — `
          + "속성 패널이나 보이는 첫 탭패널을 찾지 못했다",
      );
    }
  }
  // 360px 터치 대상도 같다 — 목록만 출력하고 게이트하지 않으면 44px 회귀가 통과한다.
  if (report.mobile.smallTouchTargets.length > 0) {
    report.failures.push(
      `360px 시트 안 터치 대상 ${report.mobile.smallTouchTargets.length}건이 44px 미만: `
        + report.mobile.smallTouchTargets
          .map((target) => `${target.label}(${target.height}px)`)
          .join(", "),
    );
  }

  console.log(JSON.stringify(report, null, 2));
  const reachable = report.rows.filter((row) => row.verdict === "reachable").length;
  log(
    `${reachable}/${report.rows.length} controls reachable and effective; `
      + `${report.rows.filter((r) => r.verdict === "not-exercised").length} not exercised`,
  );

  // 게이트를 깨지는 않지만 사람이 봐야 하는 것들 — "동선은 있으나 매끄럽지 않다".
  const softFindings = report.rows.filter((row) => row.verdict !== "blocked" && row.defect);
  if (softFindings.length > 0) {
    log(`FINDINGS (게이트 미실패, 검토 대상 ${softFindings.length}건):`);
    for (const row of softFindings) log(`  · ${row.control}: ${row.defect}`);
  }
  if (report.mobile.smallTouchTargets.length > 0) {
    log(`360px 44px 미만 터치 대상 ${report.mobile.smallTouchTargets.length}건:`);
    for (const target of report.mobile.smallTouchTargets) {
      log(`  · ${target.label} (${target.height}px)`);
    }
  }
  for (const note of report.notes) log(`NOTE: ${note}`);
  if (report.failures.length > 0) {
    log(`RESULT: FAIL (${report.failures.length})`);
    for (const failure of report.failures) log(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  log("RESULT: OK");
}

void main().catch((error: unknown) => {
  console.error("[verify-inspector-walkthrough] fatal:", error);
  process.exitCode = 1;
});
