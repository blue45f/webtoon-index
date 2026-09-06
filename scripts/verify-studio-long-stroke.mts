/**
 * 스튜디오 장획(長劃) 게이트 — 헤드리스 Chromium 에서 3,200 샘플 한 획을 그려 "긴 획이 끝까지
 * 안전하게 커밋되는가" 를 하드 단언으로 증명한다. 하나라도 깨지면 exit 1 (모든 실패를 나열).
 *
 * 증명하는 것
 * 1. 종이(Konva 스테이지)가 있다 — 없으면 즉시 FAIL, 조용히 통과하지 않는다.
 * 2. 입력 점 수 vs 커밋 점 수 — SQLite 자동저장(verify-studio-brushes.mts persistedStudioDocument 와 같은
 *    훅)에서 커밋 획의 points 를 읽어 디스패치한 pointermove 수와 허용오차 안인지. 입력 단계 거리 필터
 *    (sampleSpacing, studio-brush.ts strokeSampleDistanceForBrushFamily)를 감안해 기대치 =
 *    min(디스패치 수, *디스패치한 제스처* 경로길이(문서 단위)/sampleSpacing). 경로길이는 커밋 점이 아니라
 *    제스처 기하에서 잰다(커밋 점으로 재면 꼬리가 잘려도 자기 자신을 통과시킨다). 같은 이유로 커밋 경로
 *    길이 자체도 디스패치 길이의 ±15% 안이어야 한다(committed-path-length). 훅을 못 읽는 환경(preview
 *    빌드엔 /src 가 없다)에서는 inputDeliveryRatio(관측/디스패치 pointermove) ≥ 0.95 로 대체하고
 *    committedSource 에 그렇게 표기한다.
 * 3. pointerup 뒤 미완 획 0 — 커밋 300ms 후와 900ms 후 캡처가 같고(더 그려지는 것이 없다), 자동저장 문서의
 *    draw 요소가 정확히 1개다. 앱은 라이브/드래프트 획을 DOM 에 노출하지 않으므로 이 두 증거로 판정한다.
 * 4. 라이브 vs 커밋 픽셀 패리티 — 제스처 전반부(버튼 다운) 캡처와 커밋 캡처를 전반부 경로 경계상자 영역에서만
 *    diff. 커밋 이미지 = 라이브 이미지 + 후반부 잉크여야 하므로 전반부 영역 변경 픽셀 ≤ 1%, 후반부 영역
 *    변경 픽셀 ≥ 200. 캡처는 제스처 경계상자(+pad)로 잘라 배너·토스트·툴바 크롬을 diff 에서 배제한다.
 * 5. rAF 프레임시간 p95 ≤ 33.4ms — SwiftShader/헤드리스는 GPU 합성이 없어 60Hz 예산(16.7ms)의 2배.
 * 6. 50ms 초과 longtask ≤ 3 (3,200 샘플 제스처 동안).
 * 7. console.error / pageerror / unhandledrejection 모두 0.
 * 8. 힙: pointerdown 전 → pointerup 후 → 실행취소 + 1s idle(+gc) 후. 해제 후 힙 ≤ 시작 + 64MiB.
 *    측정은 CDP Runtime.getHeapUsage(정밀) 우선, performance.memory.usedJSHeapSize(양자화) 폴백.
 *    둘 다 없으면 memory:"unavailable" 로 보고하고 이 축은 실패시키지 않는다.
 *
 * 실행 (pnpm build 불필요 — 개발 서버가 떠 있으면 된다):
 *   pnpm dev  →  pnpm run verify:studio-long-stroke
 *
 * 환경변수
 *   STUDIO_URL                               기본 http://localhost:5173/studio
 *   TOONSPECTRUM_LONG_STROKE_BRUSH           브러시 이름(기본: 카탈로그 첫 paint 브러시; preview 에선 활성 펜)
 *   TOONSPECTRUM_LONG_STROKE_DPR             deviceScaleFactor(기본 1)
 *   TOONSPECTRUM_LONG_STROKE_WEBGPU=1        --enable-unsafe-webgpu 를 켠다(기본 꺼짐 = Konva/CPU 경로). 헤드리스
 *                                            SwiftShader WebGPU 는 텍스처 생성이 실패해 선택 provider 가 획을 확정하지
 *                                            못한다(2026-09-02 실측: ink-committed FAIL, 커밋 점 0, gpuValidationWarnings
 *                                            15~33). 그 획은 이제 문서에서 지워지지 않고 복구 레코드로 남아 상태 레일의
 *                                            '획 복구'로 되살릴 수 있지만(studio-rejected-stroke-recovery.ts), 자동으로는
 *                                            커밋되지 않으므로(ADR 0018) 이 게이트의 ink-committed 는 여전히 실패한다.
 *                                            게이트가 CI 러너에서 GPU 드라이버 상태를 재는 도구가 되지 않도록 기본은 끈다.
 *   TOONSPECTRUM_LONG_STROKE_LONG_TASK_MAX   50ms 초과 longtask 허용 개수(기본 6 — 상수 주석 참고)
 *   TOONSPECTRUM_LONG_STROKE_SPAWN_PREVIEW=1 vite preview 를 직접 띄운다(pnpm build 선행)
 *   TOONSPECTRUM_VERIFY_DIR                  산출물 루트(기본 os tmpdir) → <dir>/studio-long-stroke/report.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser, type CDPSession, type Page } from "playwright";

import { STUDIO_CANVAS_WIDTH } from "../apps/web/src/domains/creator/canvas/studio-canvas-constants";

import {
  findFreePort,
  spawnVitePreview,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";

const BRUSH_NAME_ENV = process.env.TOONSPECTRUM_LONG_STROKE_BRUSH?.trim() || null;
const BRUSH_ID_ENV = process.env.TOONSPECTRUM_LONG_STROKE_BRUSH_ID?.trim() || null;
const BRUSH_OPERATION_ENV = process.env.TOONSPECTRUM_LONG_STROKE_OPERATION === "erase"
  ? "erase" as const
  : "paint" as const;
const BRUSH_WIDTH_ENV = Number(process.env.TOONSPECTRUM_LONG_STROKE_BRUSH_WIDTH ?? "");
const DEVICE_SCALE_FACTOR = Number(process.env.TOONSPECTRUM_LONG_STROKE_DPR ?? "1") || 1;
const WEBGPU = process.env.TOONSPECTRUM_LONG_STROKE_WEBGPU === "1";
const HEADED = process.env.TOONSPECTRUM_LONG_STROKE_HEADED === "1";
const SCREEN_FILL_PATH = process.env.TOONSPECTRUM_LONG_STROKE_PATH === "screen-fill";
const SPAWN_PREVIEW = process.env.TOONSPECTRUM_LONG_STROKE_SPAWN_PREVIEW === "1";
const OUT_DIR = join(process.env.TOONSPECTRUM_VERIFY_DIR ?? tmpdir(), "studio-long-stroke");
const REPORT_PATH = join(OUT_DIR, "report.json");
const VIEWPORT = { width: 1600, height: 1000 } as const;

// ── 임계값(리포트 thresholds 에 그대로 실린다) ─────────────────────────────────────────────
const PERF_SAMPLES = Number(process.env.TOONSPECTRUM_LONG_STROKE_PERF_SAMPLES ?? "3200") || 3_200;
const PARITY_SAMPLES = Number(process.env.TOONSPECTRUM_LONG_STROKE_PARITY_SAMPLES ?? "1200") || 1_200;
const GESTURE_BATCHES = SCREEN_FILL_PATH ? 48 : 20;
const COMMIT_SETTLE_MS = 300; // pointerup → 커밋 캡처 정착 대기
const PENDING_RECHECK_MS = 900; // 미완 획 검사용 2차 캡처 시점(pointerup 기준)
const POINT_COUNT_TOLERANCE = 0.15; // 커밋 점 수 하한: 기대치의 -15%
const POINT_COUNT_EXTRA_MAX = 4; // 커밋 점 수 상한 여유: pointerdown·pointerup·endpoint seal 샘플
const COMMITTED_PATH_TOLERANCE = 0.15; // 커밋 경로 길이 vs 디스패치 경로 길이(문서 단위) 허용 편차 ±15%
const INPUT_DELIVERY_MIN = 0.95; // 관측 pointermove / 디스패치 pointermove 최소 비율(inputDeliveryRatio)
const FIRST_HALF_CHANGED_RATIO_MAX = 0.01; // 전반부 영역에서 허용되는 라이브↔커밋 변경 픽셀 비율
const INK_MIN_CHANGED_PIXELS = 200; // 잉크 존재 판정 최소 변경 픽셀(6px×640px 획 ≈ 4,000px; 링·토스트 오탐 배제)
const PAD_MIN_CSS = 48; // 경계상자 확장(CSS px) = max(48, 브러시 폭×2): 커서 링·안티에일리어싱 여유
const PIXEL_DELTA_THRESHOLD = 8; // 픽셀 변경 판정 채널差(probe-studio-brush-sweep diffShots 와 동일)
const SETTLED_CHANGED_RATIO_MAX = 0.001; // 정착 판정: 300ms↔900ms 캡처 변경 픽셀 비율 상한
const FRAME_P95_BUDGET_MS = 33.4; // 프레임시간 p95 — 헤드리스/SwiftShader 는 vsync 16.7ms 의 2배
// 3,200 샘플 동안 허용 longtask(>50ms). 첫 획 워밍업·GC·자동저장 flush 가 각 1회씩 나오고, 공유 러너나
// 병행 부하(같은 머신의 vitest 등)에서는 그 수가 두 배로 잡힌다 — 2026-09-02 실측 2건(단독)·4건(병행).
// 회귀 신호는 "수십 건" 단위이므로 6 이 노이즈와 회귀를 가르는 선이다. 환경변수로 조정 가능.
const LONG_TASK_MAX = Number(process.env.TOONSPECTRUM_LONG_STROKE_LONG_TASK_MAX ?? "6") || 6;
const HEAP_GROWTH_MAX_BYTES = 64 * 1024 * 1024; // 해제 후 힙 증가 상한
const COMMIT_READ_TIMEOUT_MS = 8_000; // 커밋 획이 SQLite 자동저장에 나타날 때까지 폴링 상한
/** 개발 서버에서 API(:4001)가 없을 때 나는 선택적 루프백 실패 — 게이트 결함이 아니다. */
const EXPECTED_DEV_NOISE =
  /\/api\/(?:auth\/session|studio-ai\/status|kmas\/merge-on-access|analytics\/traffic\/)|socket\.io/u;
/**
 * `vite preview` serves the production build, where the `/src/**` module specifiers below do not
 * exist. The probe already degrades to its env/fallback path when those imports fail; their 404s
 * are the expected shape of that degradation, not a page defect. A dev-server run keeps counting
 * them, because there the same 404 means the module really is missing.
 */
const PREVIEW_DEV_MODULE_NOISE = /\/src\/domains\/creator\/(?:brush\/studio-brush-catalog|studio-autosave(?:-sqlite-store)?)\.ts/u;
/** WebGPU 검증 경고(console.warning) — 실패 원인 진단용으로 센다. */
const GPU_VALIDATION_WARNING = /is invalid due to a previous error|WebGPU|GPUDevice/u;
/** 개발 서버가 /src 로 서빙하는 모듈 — 페이지 안에서 import 해 stale-dist 없이 카탈로그·자동저장을 읽는다. */
const DEV_MODULES = {
  catalog: "/src/domains/creator/brush/studio-brush-catalog.ts",
  autosave: "/src/domains/creator/studio-autosave.ts",
  sqliteStore: "/src/domains/creator/studio-autosave-sqlite-store.ts",
} as const;

interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Point { readonly x: number; readonly y: number }
/** 캡처(clip) 픽셀 좌표(DPR 반영) 영역. */
interface Region { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
interface Assertion { readonly id: string; readonly ok: boolean; readonly detail: string }
interface PerfSampling {
  readonly frameCount: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number;
  readonly longTaskCount: number; readonly longTaskTotalMs: number;
}
interface DiffResult {
  readonly changedPixels: number; readonly maxChannelDelta: number; readonly width: number; readonly height: number;
  readonly regions: Record<string, { changed: number; pixels: number }>;
}
interface InputCounters { readonly moves: number; readonly coalesced: number; readonly rejections: number }
interface CommittedStroke {
  readonly drawCount: number; readonly points: number[];
  readonly sampleSpacing: number | null; readonly pendingStrokeDurability: unknown;
}
interface BrushChoice {
  readonly id: string | null;
  readonly name: string | null;
  readonly width: number;
  readonly operation: "paint" | "erase";
  readonly source: string;
}
interface SurfaceEvidence {
  readonly gpuEverActive: boolean;
  readonly gpuEverAuthorized: boolean;
  readonly gpuSurfaceKinds: readonly string[];
  readonly refusedStrokeNotices: number;
}
interface GpuAdapterEvidence {
  readonly available: boolean;
  readonly adapterClass: "hardware" | "software" | "unknown" | "unavailable";
  readonly isFallbackAdapter: boolean | null;
  readonly adapterFingerprint: string | null;
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}
type GateGlobals = typeof globalThis & {
  __longStrokeGate?: { moves: number; coalesced: number; rejections: number };
  __longStrokeFrames?: number[];
  __longStrokeLongTasks?: number[];
  __longStrokeObserver?: PerformanceObserver;
  __longStrokeStop?: () => void;
  gc?: () => void;
};

async function inspectGpuAdapter(page: Page): Promise<GpuAdapterEvidence> {
  const unavailable: GpuAdapterEvidence = Object.freeze({
    available: false,
    adapterClass: "unavailable",
    isFallbackAdapter: null,
    adapterFingerprint: null,
    vendor: "",
    architecture: "",
    device: "",
    description: "",
  });
  if (!WEBGPU) return unavailable;
  return page.evaluate(async () => {
    type AdapterInfoLike = Readonly<{
      vendor?: unknown;
      architecture?: unknown;
      device?: unknown;
      description?: unknown;
    }>;
    type AdapterLike = Readonly<{
      info?: AdapterInfoLike;
      isFallbackAdapter?: unknown;
    }>;
    type NavigatorWithGpu = Navigator & Readonly<{
      gpu?: Readonly<{
        requestAdapter(options?: Readonly<{ powerPreference?: "high-performance" }>):
          Promise<AdapterLike | null>;
      }>;
    }>;
    const gpu = (navigator as NavigatorWithGpu).gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({
      powerPreference: "high-performance",
    }) as AdapterLike | null;
    if (!adapter) return null;
    const info = adapter.info ?? {};
    const text = (value: unknown): string =>
      typeof value === "string" ? value.trim() : "";
    const vendor = text(info.vendor);
    const architecture = text(info.architecture);
    const device = text(info.device);
    const description = text(info.description);
    const fallbackValue = adapter.isFallbackAdapter;
    const isFallbackAdapter = typeof fallbackValue === "boolean"
      ? fallbackValue
      : null;
    const adapterFingerprint = [vendor, architecture, device, description]
      .filter((value) => value.length > 0)
      .join(":") || null;
    const identity = adapterFingerprint?.toLowerCase() ?? "";
    const software = /swiftshader|llvmpipe|lavapipe|software|warp|basic render/u
      .test(identity);
    const adapterClass = isFallbackAdapter === true || software
      ? "software" as const
      : adapterFingerprint
        ? "hardware" as const
        : "unknown" as const;
    return {
      available: true,
      adapterClass,
      isFallbackAdapter,
      adapterFingerprint,
      vendor,
      architecture,
      device,
      description,
    };
  }).then((result) => result ?? unavailable).catch(() => unavailable);
}

function log(message: string): void {
  console.log(`[verify-studio-long-stroke] ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MiB`;

/** 현재 DOM 요약 — 활성화 실패 메시지에 붙여 "왜" 를 보이게 한다. */
async function domSummary(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({
    dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
      .map((node) => node.getAttribute("aria-label") ?? node.textContent?.slice(0, 40) ?? ""),
    drawMode: document.querySelector('[data-studio-draw-options="true"]')?.getAttribute("data-studio-active-draw-mode") ?? null,
    activeElement: `${document.activeElement?.tagName ?? ""}#${document.activeElement?.getAttribute("aria-label") ?? ""}`,
    stage: Boolean(document.querySelector(".konvajs-content")),
  }));
}

/**
 * 오버레이(Quick Start Tools 마법사 등)를 닫는다. 마법사는 hydration 뒤 늦게 마운트되므로 스테이지가
 * 보인 뒤 폴링하며, 다이얼로그가 있으면 Close 버튼 → Escape 로 닫고 3회 연속 없을 때 끝낸다.
 */
async function dismissChrome(page: Page): Promise<void> {
  let quiet = 0;
  for (let index = 0; index < 16 && quiet < 3; index += 1) {
    const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      quiet = 0;
      const close = dialog.getByRole("button", { name: /^(?:Close|닫기)$/u }).first();
      if (await close.isVisible().catch(() => false)) await close.click({ timeout: 2_000 }).catch(() => undefined);
      else await page.keyboard.press("Escape").catch(() => undefined);
    } else {
      quiet += 1;
    }
    await page.waitForTimeout(250);
  }
}

/**
 * 종이 경계 — frame-graph 문서 노드 우선, Konva 컨텐츠 폴백. 없으면 throw(단언 1). 종이는 뷰포트보다
 * 클 수 있어(기본 줌에서 세로로 넘친다) 제스처·캡처는 뷰포트와의 교집합(8px 인셋)만 쓴다.
 */
async function paperBox(page: Page): Promise<{ readonly full: Box; readonly visible: Box }> {
  const full = await page.locator("[data-studio-frame-graph-document]").first().boundingBox()
    ?? await page.locator(".konvajs-content").first().boundingBox();
  invariant(full, "stage missing: neither [data-studio-frame-graph-document] nor .konvajs-content has a box");
  const inset = 8;
  const left = Math.max(full.x, inset);
  const top = Math.max(full.y, inset);
  const visible: Box = {
    x: left, y: top,
    width: Math.min(full.x + full.width, VIEWPORT.width - inset) - left,
    height: Math.min(full.y + full.height, VIEWPORT.height - inset) - top,
  };
  invariant(visible.width >= 320 && visible.height >= 240,
    `stage visible area too small for a long stroke: ${JSON.stringify(visible)}`);
  return { full, visible };
}

/** 브러시 작업 모드를 켠다. */
async function activateBrushOperation(
  page: Page,
  operation: "paint" | "erase",
): Promise<void> {
  const expectedMode = operation === "erase" ? "eraser" : "pen";
  const active = (): Promise<boolean> => page.evaluate((mode) => document
    .querySelector('[data-studio-draw-options="true"]')
    ?.getAttribute("data-studio-active-draw-mode") === mode, expectedMode);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 0) await page.keyboard.press(operation === "erase" ? "e" : "b");
    else {
      const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
      await toolbar.getByRole("button", {
        name: operation === "erase" ? "지우개" : "펜",
        exact: true,
      }).click({ timeout: 3_000 }).catch(() => undefined);
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await active()) return;
      await page.waitForTimeout(100);
    }
  }
  throw new Error(`${operation} tool never activated; dom=${await domSummary(page)}`);
}

/** 데스크톱 전체 카탈로그에서 정확한 브러시를 선택한다. */
async function selectBrush(
  page: Page,
  name: string,
  operation: "paint" | "erase",
  id: string | null = null,
): Promise<void> {
  await activateBrushOperation(page, operation);
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  let pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  if (await pill.count() === 0) {
    await toolbar.getByRole("button", {
      name: operation === "erase" ? "지우개" : "펜",
      exact: true,
    }).click();
    pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  }
  await pill.waitFor({ state: "visible", timeout: 10_000 });
  await pill.click();
  const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
  await catalog.waitFor({ state: "visible", timeout: 15_000 });
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill(name);
  // Preview builds pin the durable id because their production bundle cannot import the source catalogue.
  // The displayed discovery label may differ from the legacy preset label passed in BRUSH_NAME_ENV.
  const option = id
    ? catalog.locator(`[data-studio-brush-select="${id}"]`)
    : catalog.getByRole("button", { name: `${name} 선택`, exact: true });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.scrollIntoViewIfNeeded();
  await option.click({ force: true });
  await catalog.waitFor({ state: "detached" }).catch(() => undefined);
  if (id) {
    await page.waitForFunction(
      (expectedId) => Array.from(document.querySelectorAll("[data-studio-brush-select]"))
        .some((node) => node.getAttribute("data-studio-brush-select") === expectedId
          && node.getAttribute("aria-pressed") === "true"),
      id,
      { timeout: 15_000 },
    );
  } else {
    await page.waitForFunction(
      (expected) => document.querySelector('[data-studio-brush-active-pill="true"]')
        ?.getAttribute("aria-label")?.includes(expected) === true,
      name,
      { timeout: 15_000 },
    );
  }
  // 데스크톱 카탈로그는 이제 상주형 플로팅 패널이라(closeOnSelection={false}) 선택만으로 닫히지
  // 않는다. 열린 채로 두면 캔버스를 덮어 제스처가 패널 위에서 시작하고, 획이 한 픽셀도 남지
  // 않는다(실측: ink-committed changedPixels=0). 명시적으로 닫고, 안 닫히면 조용히 넘어가지 않는다.
  if (await catalog.count() > 0) {
    await page.getByRole("button", { name: /(?:라이브러리|선택) 닫기$/u })
      .first()
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await catalog.waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
  }
  if (await catalog.count() > 0) {
    throw new Error(
      `brush catalogue stayed open after selecting ${name}; the gesture would land on the panel`,
    );
  }
}

/** 브러시 결정: env → dev 서버 전체 카탈로그 → preview env fallback. */
async function resolveBrush(page: Page): Promise<BrushChoice> {
  const catalog = await page.evaluate(async ({ wantedId, wantedName, modulePath }) => {
    try {
      const module = await import(/* @vite-ignore */ modulePath) as unknown as {
        STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS: ReadonlyArray<{
          id: string; name: string; defaultWidth: number; operation: "paint" | "erase";
        }>;
      };
      const items = module.STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS;
      const item = wantedId
        ? items.find((entry) => entry.id === wantedId) ?? null
        : wantedName
          ? items.find((entry) => entry.name === wantedName) ?? null
          : items.find((entry) => entry.operation === "paint") ?? null;
      return item ? {
        id: item.id,
        name: item.name,
        width: item.defaultWidth,
        operation: item.operation,
      } : null;
    } catch {
      return null;
    }
  }, { wantedId: BRUSH_ID_ENV, wantedName: BRUSH_NAME_ENV, modulePath: DEV_MODULES.catalog });
  if (catalog) return { ...catalog, source: "catalog" };
  if (BRUSH_NAME_ENV) return {
    id: BRUSH_ID_ENV,
    name: BRUSH_NAME_ENV,
    width: Number.isFinite(BRUSH_WIDTH_ENV) && BRUSH_WIDTH_ENV > 0 ? BRUSH_WIDTH_ENV : 12,
    operation: BRUSH_OPERATION_ENV,
    source: "env",
  };
  const label = await page.locator('[data-studio-brush-active-pill="true"]').first()
    .getAttribute("aria-label").catch(() => null);
  return {
    id: null,
    name: null,
    width: 12,
    operation: "paint",
    source: `active-pill:${label ?? "unknown"}`,
  };
}

/** pointermove(캡처)·unhandledrejection 카운터 — 제스처 전에 document 시작 시점에 심는다. */
async function installGateGlobals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { moves: 0, coalesced: 0, rejections: 0 };
    (globalThis as GateGlobals).__longStrokeGate = state;
    window.addEventListener("pointermove", (event) => {
      state.moves += 1;
      const coalesced = (event as PointerEvent & { getCoalescedEvents?: () => readonly PointerEvent[] })
        .getCoalescedEvents?.();
      state.coalesced += Math.max(1, coalesced?.length ?? 0);
    }, { capture: true, passive: true });
    window.addEventListener("unhandledrejection", () => { state.rejections += 1; });
  });
}

async function readCounters(page: Page): Promise<InputCounters> {
  return page.evaluate(() => {
    const state = (globalThis as GateGlobals).__longStrokeGate;
    return { moves: state?.moves ?? 0, coalesced: state?.coalesced ?? 0, rejections: state?.rejections ?? 0 };
  });
}

/** rAF 프레임 간격 + longtask 관측기(probe-studio-brush-sweep installPerfSampler 포트). */
async function installPerfSampler(page: Page): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await page.evaluate(() => {
      const scope = globalThis as GateGlobals;
      // 재시도 시 이전 rAF 루프·관측기를 먼저 멈춘다 — 안 그러면 두 루프가 같은 배열에 밀어 넣어
      // 프레임 간격이 반으로, longtask 수가 두 배로 잡힌다.
      scope.__longStrokeStop?.();
      scope.__longStrokeObserver?.disconnect();
      scope.__longStrokeFrames = [];
      scope.__longStrokeLongTasks = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) scope.__longStrokeLongTasks?.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
      scope.__longStrokeObserver = observer;
      let last = performance.now();
      let running = true;
      const tick = (now: number): void => {
        if (!running) return;
        scope.__longStrokeFrames?.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      scope.__longStrokeStop = () => { running = false; };
    });
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => (globalThis as GateGlobals).__longStrokeFrames?.length ?? 0)) > 0) return;
    log(`rAF sampler suspended (attempt ${attempt + 1}) — retrying`);
  }
  throw new Error("rAF sampler never produced a frame; headless page is suspended");
}

async function sampleSurfaceEvidence(
  page: Page,
  previous: SurfaceEvidence,
): Promise<SurfaceEvidence> {
  const current = await page.evaluate(() => {
    const compositor = document.querySelector('[data-studio-gpu-compositor="true"]');
    const gpuSurfaceKinds = Array.from(document.querySelectorAll('[data-studio-gpu-surface]'))
      .map((node) => node.getAttribute("data-studio-gpu-surface") ?? "")
      .filter(Boolean);
    const noticeText = Array.from(document.querySelectorAll(
      '[role="alert"], [data-studio-rejected-stroke], [data-studio-live-ink-unavailable]',
    )).map((node) => node.textContent ?? "").join("\n");
    return {
      gpuActive: compositor?.getAttribute("data-studio-gpu-active") === "true",
      gpuAuthorized: compositor?.getAttribute("data-studio-gpu-frame-authorized") === "true",
      gpuSurfaceKinds,
      refusedStrokeNotices: (noticeText.match(/선택 거부 사유|stroke refused|획 복구/giu) ?? []).length,
    };
  });
  return {
    gpuEverActive: previous.gpuEverActive || current.gpuActive,
    gpuEverAuthorized: previous.gpuEverAuthorized || current.gpuAuthorized,
    gpuSurfaceKinds: Object.freeze([...new Set([
      ...previous.gpuSurfaceKinds,
      ...current.gpuSurfaceKinds,
    ])].sort()),
    refusedStrokeNotices: Math.max(previous.refusedStrokeNotices, current.refusedStrokeNotices),
  };
}

async function collectPerfSampling(page: Page): Promise<PerfSampling> {
  return page.evaluate((longTaskMinMs) => {
    const scope = globalThis as GateGlobals;
    scope.__longStrokeStop?.();
    const frames = (scope.__longStrokeFrames ?? []).slice().sort((a, b) => a - b);
    const pick = (q: number): number => frames.length === 0
      ? 0
      : frames[Math.min(frames.length - 1, Math.floor(q * frames.length))]!;
    const longTasks = (scope.__longStrokeLongTasks ?? []).filter((ms) => ms > longTaskMinMs);
    scope.__longStrokeObserver?.disconnect();
    delete scope.__longStrokeFrames;
    delete scope.__longStrokeLongTasks;
    delete scope.__longStrokeObserver;
    delete scope.__longStrokeStop;
    return {
      frameCount: frames.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: frames.at(-1) ?? 0,
      longTaskCount: longTasks.length, longTaskTotalMs: longTasks.reduce((sum, ms) => sum + ms, 0),
    };
  }, 50);
}

/** 화면 충전 모드는 노출된 종이를 5회 왕복해 긴 선·회전·곡률을 한 획에서 함께 압박한다. */
function screenFillControlPoints(box: Box): readonly Point[] {
  const left = box.x + box.width * 0.08;
  const right = box.x + box.width * 0.92;
  const top = box.y + box.height * 0.12;
  const bottom = box.y + box.height * 0.82;
  const rows = 5;
  const points: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = top + (bottom - top) * row / (rows - 1);
    const startX = row % 2 === 0 ? left : right;
    const endX = row % 2 === 0 ? right : left;
    if (row === 0) points.push({ x: startX, y });
    points.push({ x: endX, y });
    if (row + 1 < rows) {
      const nextY = top + (bottom - top) * (row + 1) / (rows - 1);
      points.push({ x: endX, y: nextY });
    }
  }
  return points;
}

function pointOnPolyline(points: readonly Point[], amount: number): Point {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
    lengths.push(length);
    total += length;
  }
  let target = Math.max(0, Math.min(1, amount)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (target <= length || index === lengths.length - 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const local = length > 0 ? target / length : 0;
      return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
    }
    target -= length;
  }
  return points.at(-1)!;
}

function gesturePoint(box: Box, t: number): Point {
  if (SCREEN_FILL_PATH) return pointOnPolyline(screenFillControlPoints(box), t);
  return {
    x: box.x + box.width * (0.12 + 0.5 * t),
    y: box.y + box.height * (0.2 + 0.42 * t) - Math.sin(t * Math.PI) * box.height * 0.12,
  };
}

function gesturePolylineLength(box: Box, batches = GESTURE_BATCHES): number {
  let total = 0;
  for (let batch = 1; batch <= batches; batch += 1) {
    const from = gesturePoint(box, (batch - 1) / batches);
    const to = gesturePoint(box, batch / batches);
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

function pathBounds(box: Box, t0: number, t1: number, pad: number): Box {
  const samples = SCREEN_FILL_PATH ? 201 : 51;
  const points = Array.from({ length: samples }, (_, index) =>
    gesturePoint(box, t0 + ((t1 - t0) * index) / Math.max(1, samples - 1)));
  const left = Math.min(...points.map((point) => point.x)) - pad;
  const top = Math.min(...points.map((point) => point.y)) - pad;
  return {
    x: left, y: top,
    width: Math.max(...points.map((point) => point.x)) + pad - left,
    height: Math.max(...points.map((point) => point.y)) + pad - top,
  };
}

/** 뷰포트 CSS 사각형 → 캡처(clip) 픽셀 Region(DPR 반영, clip 안으로 클램프). */
function toRegion(rect: Box, clip: Box, dpr: number): Region {
  const px = (value: number, origin: number, max: number): number =>
    Math.max(0, Math.min(Math.round(max * dpr), Math.round((value - origin) * dpr)));
  return {
    left: px(rect.x, clip.x, clip.width), top: px(rect.y, clip.y, clip.height),
    right: px(rect.x + rect.width, clip.x, clip.width), bottom: px(rect.y + rect.height, clip.y, clip.height),
  };
}

/** 20 배치 × steps 로 samples 개 pointermove 를 디스패치한다(버튼은 누른 채 반환). 반환 = 디스패치 수. */
async function drawGesture(page: Page, box: Box, samples: number, onHalf?: () => Promise<void>): Promise<number> {
  const start = gesturePoint(box, 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "left" });
  await page.evaluate(() => {
    const state = (globalThis as GateGlobals).__longStrokeGate;
    if (state) { state.moves = 0; state.coalesced = 0; }
  });
  const batches = GESTURE_BATCHES;
  const perBatch = Math.max(1, Math.floor(samples / batches));
  for (let batch = 1; batch <= batches; batch += 1) {
    const target = gesturePoint(box, batch / batches);
    await page.mouse.move(target.x, target.y, { steps: perBatch });
    if (batch === batches / 2 && onHalf) await onHalf();
  }
  return perBatch * batches;
}

async function shot(page: Page, clip: Box, name: string): Promise<string> {
  const buffer = await page.screenshot({ clip, type: "png", animations: "disabled" });
  writeFileSync(join(OUT_DIR, `${name}.png`), buffer);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** 두 캡처를 페이지 캔버스에 올려 diff(probe-studio-brush-sweep diffShots) + 이름 붙은 region 별 통계. */
async function diffShots(page: Page, a: string, b: string, regions: Record<string, Region>): Promise<DiffResult> {
  return page.evaluate(async ({ left, right, areas, threshold }) => {
    const load = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("shot decode failed"));
      image.src = src;
    });
    const [imageA, imageB] = await Promise.all([load(left), load(right)]);
    const w = Math.min(imageA.naturalWidth, imageB.naturalWidth);
    const h = Math.min(imageA.naturalHeight, imageB.naturalHeight);
    if (w === 0 || h === 0) throw new Error("empty shot");
    const read = (image: HTMLImageElement): Uint8ClampedArray => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("2d context unavailable");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, w, h).data;
    };
    const da = read(imageA);
    const db = read(imageB);
    const named = Object.entries(areas);
    const result = {
      changedPixels: 0, maxChannelDelta: 0, width: w, height: h,
      regions: Object.fromEntries(named.map(([name]) => [name, { changed: 0, pixels: 0 }])) as
        Record<string, { changed: number; pixels: number }>,
    };
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const d = Math.max(
          Math.abs(da[i]! - db[i]!), Math.abs(da[i + 1]! - db[i + 1]!),
          Math.abs(da[i + 2]! - db[i + 2]!), Math.abs(da[i + 3]! - db[i + 3]!),
        );
        const changed = d > threshold;
        if (changed) result.changedPixels += 1;
        if (d > result.maxChannelDelta) result.maxChannelDelta = d;
        for (const [name, area] of named) {
          if (x >= area.left && x < area.right && y >= area.top && y < area.bottom) {
            result.regions[name]!.pixels += 1;
            if (changed) result.regions[name]!.changed += 1;
          }
        }
      }
    }
    return result;
  }, { left: a, right: b, areas: regions, threshold: PIXEL_DELTA_THRESHOLD });
}

/**
 * 커밋 획을 SQLite 자동저장에서 읽는다(verify-studio-brushes.mts persistedStudioDocument 의 dev 포트:
 * dist 매니페스트 대신 /src 모듈을 페이지 안에서 import). preview 빌드(/src 없음)에서는 null.
 */
async function readCommittedStroke(page: Page): Promise<CommittedStroke | null> {
  const deadline = Date.now() + COMMIT_READ_TIMEOUT_MS;
  let latest: CommittedStroke | null = null;
  while (Date.now() < deadline) {
    latest = await page.evaluate(async (modules) => {
      try {
        const [autosave, store] = await Promise.all([
          import(/* @vite-ignore */ modules.autosave) as unknown as
            Promise<{ studioAutosaveKey(input: Record<string, never>): string }>,
          import(/* @vite-ignore */ modules.sqliteStore) as unknown as
            Promise<{ acquireStudioAutosaveSqliteStore(): Promise<{
              read(key: string): Promise<{ state: string; payload?: unknown } | null>;
            }> }>,
        ]);
        const stored = await (await store.acquireStudioAutosaveSqliteStore()).read(autosave.studioAutosaveKey({}));
        if (stored?.state !== "snapshot" || !stored.payload || typeof stored.payload !== "object") {
          return { drawCount: 0, points: [], sampleSpacing: null, pendingStrokeDurability: null };
        }
        const payload = stored.payload as {
          currentPageId?: unknown; pagesList?: Array<{ id?: unknown; elements?: unknown[] }>;
          pendingStrokeDurability?: unknown;
        };
        const pageRecord = payload.pagesList?.find((entry) => entry.id === payload.currentPageId)
          ?? payload.pagesList?.[0];
        const draws = (pageRecord?.elements ?? []).filter((element): element is Record<string, unknown> =>
          Boolean(element) && typeof element === "object" && (element as Record<string, unknown>).type === "draw");
        const first = draws[0];
        const points = Array.isArray(first?.points)
          ? first.points.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [];
        const spacing = first?.sampleSpacing;
        return {
          drawCount: draws.length, points,
          sampleSpacing: typeof spacing === "number" && Number.isFinite(spacing) ? spacing : null,
          pendingStrokeDurability: payload.pendingStrokeDurability ?? null,
        };
      } catch {
        return null;
      }
    }, DEV_MODULES);
    if (latest === null || latest.drawCount > 0) return latest;
    await page.waitForTimeout(100);
  }
  return latest;
}

function pathLength(points: readonly number[]): number {
  let total = 0;
  for (let index = 2; index + 1 < points.length; index += 2) {
    total += Math.hypot(points[index]! - points[index - 2]!, points[index + 1]! - points[index - 1]!);
  }
  return total;
}

/**
 * 힙 사용량. 1순위 CDP Runtime.getHeapUsage(정밀, collect 시 HeapProfiler.collectGarbage 선행) —
 * 레거시 performance.memory.usedJSHeapSize 는 양자화되고 수십 분 단위로만 갱신돼 세 측정이 같은 값으로
 * 나오므로 폴백으로만 쓴다. 둘 다 없으면 null(단언 8 은 "unavailable").
 */
async function heapUsed(
  page: Page, cdp: CDPSession | null, collect: boolean,
): Promise<{ readonly bytes: number | null; readonly source: string }> {
  if (cdp) {
    try {
      if (collect) await cdp.send("HeapProfiler.collectGarbage");
      const usage = await cdp.send("Runtime.getHeapUsage");
      return { bytes: usage.usedSize, source: "cdp:Runtime.getHeapUsage" };
    } catch { /* CDP 미지원 → performance.memory 폴백 */ }
  }
  const bytes = await page.evaluate((runGc) => {
    if (runGc) (globalThis as GateGlobals).gc?.();
    const used = (performance as Performance & { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
    return typeof used === "number" && Number.isFinite(used) ? used : null;
  }, collect);
  return { bytes, source: "performance.memory.usedJSHeapSize" };
}

/** 상단 명령 바 실행취소("Undo", 툴벨트 "실행취소" 폴백)가 disabled 될 때까지 클릭. 반환 = 클릭 수. */
async function undoAll(page: Page): Promise<number> {
  const undo = page.getByRole("button", { name: /^(?:Undo|실행취소)$/u }).filter({ hasNot: page.locator("[disabled]") });
  let clicks = 0;
  for (; clicks < 8; clicks += 1) {
    const enabled = await undo.first().isEnabled({ timeout: 1_000 }).catch(() => false);
    if (!enabled) break;
    await undo.first().click();
    await page.waitForTimeout(140);
  }
  return clicks;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const assertions: Assertion[] = [];
  const check = (id: string, ok: boolean, detail: string): void => { assertions.push({ id, ok, detail }); };
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let gpuValidationWarnings = 0;
  const preview = SPAWN_PREVIEW
    ? await (async () => {
        const port = await findFreePort({ unavailableMessage: "could not reserve preview port" });
        const child = spawnVitePreview({ port, runner: "node-vite-bin", logPath: join(OUT_DIR, "preview.log") });
        const origin = `http://127.0.0.1:${port}/`;
        await waitForServer(origin, { maxAttempts: 100, pollIntervalMs: 100, requestInit: { redirect: "manual" } });
        return { child, studioUrl: `${origin}studio` };
      })()
    : null;
  const studioUrl = preview?.studioUrl ?? process.env.STUDIO_URL ?? "http://localhost:5173/studio";
  let browser: Browser | null = null;
  const report: Record<string, unknown> = {
    kind: "toonspectrum-studio-long-stroke-gate-v1",
    generatedAt: new Date().toISOString(),
    studioUrl, viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR, webgpuFlag: WEBGPU,
    brushId: BRUSH_ID_ENV, brushOperation: BRUSH_OPERATION_ENV,
    pathMode: SCREEN_FILL_PATH ? "screen-fill-serpentine" : "diagonal",
    thresholds: {
      PERF_SAMPLES, PARITY_SAMPLES, COMMIT_SETTLE_MS, PENDING_RECHECK_MS, POINT_COUNT_TOLERANCE,
      POINT_COUNT_EXTRA_MAX, INPUT_DELIVERY_MIN, FIRST_HALF_CHANGED_RATIO_MAX, INK_MIN_CHANGED_PIXELS, PAD_MIN_CSS,
      PIXEL_DELTA_THRESHOLD, SETTLED_CHANGED_RATIO_MAX, FRAME_P95_BUDGET_MS, LONG_TASK_MAX, HEAP_GROWTH_MAX_BYTES,
    },
  };
  try {
    browser = await chromium.launch({
      headless: !HEADED,
      args: [
        ...(WEBGPU ? [
          "--enable-unsafe-webgpu",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ] : ["--disable-features=WebGPU"]),
        "--js-flags=--expose-gc",
        "--no-sandbox",
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const cdp = await context.newCDPSession(page).catch(() => null);
    await cdp?.send("HeapProfiler.enable").catch(() => undefined);
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "warning" && GPU_VALIDATION_WARNING.test(message.text())) gpuValidationWarnings += 1;
      const text = message.type() === "error" ? `${message.text()} @ ${message.location().url}` : null;
      if (!text) return;
      const expected = EXPECTED_DEV_NOISE.test(text)
        || (SPAWN_PREVIEW && PREVIEW_DEV_MODULE_NOISE.test(text));
      if (!expected) consoleErrors.push(text.slice(0, 300));
    });
    // tsx(esbuild keepNames)가 직렬화된 page.evaluate 함수에 남기는 __name 헬퍼 — 브라우저에는 없다
    // (verify-studio-brush-latency.mts 와 같은 shim). 문자열 스크립트라 자신은 변환되지 않는다.
    await page.addInitScript("globalThis.__name ??= (target) => target;");
    await installGateGlobals(page);
    await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const gpuAdapter = await inspectGpuAdapter(page);
    report.gpuAdapter = gpuAdapter;
    log(`gpu adapter: ${gpuAdapter.adapterClass} · ${gpuAdapter.adapterFingerprint ?? "unidentified"}`);
    await page.locator(".konvajs-content").first().waitFor({ state: "visible", timeout: 60_000 })
      .catch(() => undefined);
    await dismissChrome(page);
    const brush = await resolveBrush(page);
    await activateBrushOperation(page, brush.operation);
    if (brush.name) await selectBrush(page, brush.name, brush.operation, brush.id);
    log(`brush: ${brush.name ?? "(active pen)"} width ${brush.width} (${brush.source}) · webgpu flag ${WEBGPU}`);
    report.brush = brush;
    report.frameGraphDocument = await page.locator("[data-studio-frame-graph-document]").first()
      .getAttribute("data-studio-frame-graph-document").catch(() => null);

    // 단언 1 — 종이. 없으면 throw → FATAL.
    const { full, visible: box } = await paperBox(page);
    const padCss = Math.max(PAD_MIN_CSS, brush.width * 2);
    const clip = pathBounds(box, 0, 1, padCss);
    const midX = gesturePoint(box, 0.5).x;
    const firstHalf = pathBounds(box, 0, SCREEN_FILL_PATH ? 0.46 : 0.5, padCss);
    const secondHalf = pathBounds(box, SCREEN_FILL_PATH ? 0.54 : 0.5, 1, padCss);
    const regions = SCREEN_FILL_PATH ? {
      firstHalf: toRegion(firstHalf, clip, DEVICE_SCALE_FACTOR),
      secondHalf: toRegion(secondHalf, clip, DEVICE_SCALE_FACTOR),
    } : {
      firstHalf: toRegion({ ...firstHalf, width: midX - padCss - firstHalf.x }, clip, DEVICE_SCALE_FACTOR),
      secondHalf: toRegion({ ...secondHalf, x: midX + padCss, width: secondHalf.x + secondHalf.width - midX - padCss },
        clip, DEVICE_SCALE_FACTOR),
    };
    const localPathPoints = Array.from({ length: 257 }, (_, index) => {
      const point = gesturePoint(box, index / 256);
      return { x: point.x - clip.x, y: point.y - clip.y };
    });
    report.paper = {
      full, visible: box, clip, padCss, regions, localPathPoints,
      pathMode: SCREEN_FILL_PATH ? "screen-fill-serpentine" : "diagonal",
    };
    check("stage-present", true,
      `paper ${Math.round(full.width)}×${Math.round(full.height)} @ (${Math.round(full.x)},${Math.round(full.y)}),`
      + ` visible ${Math.round(box.width)}×${Math.round(box.height)}, clip ${Math.round(clip.width)}×${Math.round(clip.height)}`);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(120);

    // 패스 A — 라이브 vs 커밋 (600 샘플). 커서 링이 diff 에 섞이지 않도록 up 뒤 마우스를 clip 밖으로 옮긴다.
    const blankShot = await shot(page, clip, "00-blank");
    let surfaceEvidence: SurfaceEvidence = {
      gpuEverActive: false,
      gpuEverAuthorized: false,
      gpuSurfaceKinds: Object.freeze([]),
      refusedStrokeNotices: 0,
    };
    let liveShot = "";
    const dispatched = await drawGesture(page, box, PARITY_SAMPLES, async () => {
      surfaceEvidence = await sampleSurfaceEvidence(page, surfaceEvidence);
      liveShot = await shot(page, clip, "01-live");
    });
    await page.mouse.up({ button: "left" });
    const parityCounters = await readCounters(page);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(COMMIT_SETTLE_MS);
    const committedShot = await shot(page, clip, "02-committed");
    surfaceEvidence = await sampleSurfaceEvidence(page, surfaceEvidence);
    await page.waitForTimeout(PENDING_RECHECK_MS - COMMIT_SETTLE_MS);
    const settledShot = await shot(page, clip, "03-settled");
    const committed = await readCommittedStroke(page);
    const inkDiff = await diffShots(page, blankShot, committedShot, {});
    const liveDiff = await diffShots(page, liveShot, committedShot, regions);
    const settleDiff = await diffShots(page, committedShot, settledShot, {});
    const deliveryRatio = Math.min(1, Math.max(parityCounters.moves, parityCounters.coalesced) / dispatched);
    const committedPoints = committed ? committed.points.length / 2 : null;
    // 기대 점 수는 *디스패치한* 제스처 기하에서 도출한다 — 커밋 점에서 도출하면 꼬리가 잘려도 경로가
    // 같은 비율로 줄어 단언이 자기 자신을 통과시킨다. CSS px → 문서 단위 환산은 종이의 CSS 폭 대비 문서
    // 폭(STUDIO_CANVAS_WIDTH)이다(sampleSpacing 은 문서 단위).
    const gestureLengthCss = gesturePolylineLength(box);
    const cssToDocument = STUDIO_CANVAS_WIDTH / full.width;
    const gestureLengthDocument = gestureLengthCss * cssToDocument;
    const committedPathLength = committed ? pathLength(committed.points) : null;
    const expectedPoints = committed && committed.sampleSpacing && committed.sampleSpacing > 0
      ? Math.min(dispatched, Math.floor(gestureLengthDocument / committed.sampleSpacing) + 1)
      : dispatched;
    report.parity = {
      dispatchedMoves: dispatched, observedPointerMoves: parityCounters.moves,
      coalescedSamples: parityCounters.coalesced, inputDeliveryRatio: deliveryRatio,
      committedSource: committed
        ? "sqlite-autosave(/src import)"
        : "unavailable (preview build?) → inputDeliveryRatio fallback",
      gestureLengthCss, cssToDocument, gestureLengthDocument, committedPathLength,
      committedPoints, expectedCommittedPoints: expectedPoints, sampleSpacing: committed?.sampleSpacing ?? null,
      drawCount: committed?.drawCount ?? null, pendingStrokeDurability: committed?.pendingStrokeDurability ?? null,
      diffs: { blankVsCommitted: inkDiff, liveVsCommitted: liveDiff, committed300VsSettled900: settleDiff },
    };
    const gpuNote = gpuValidationWarnings > 0 ? ` · ${gpuValidationWarnings} WebGPU validation warnings` : "";
    check("ink-committed", inkDiff.changedPixels >= INK_MIN_CHANGED_PIXELS,
      `blank→committed changedPixels=${inkDiff.changedPixels} (min ${INK_MIN_CHANGED_PIXELS})${gpuNote}`);
    if (committed && committedPoints !== null && committedPathLength !== null) {
      const lower = Math.ceil(expectedPoints * (1 - POINT_COUNT_TOLERANCE));
      const upper = dispatched + POINT_COUNT_EXTRA_MAX;
      check("input-vs-committed-points", committedPoints >= lower && committedPoints <= upper,
        `committed=${committedPoints} expected ${lower}..${upper} (dispatched=${dispatched}, `
        + `gesture ${gestureLengthDocument.toFixed(1)}doc-px / sampleSpacing=${committed.sampleSpacing ?? "none"}, `
        + `drawCount=${committed.drawCount})${gpuNote}`);
      // 점 수와 별개로 커밋 경로의 *길이* 가 입력 경로 길이와 맞아야 한다 — 꼬리가 잘리면 점 수가 맞아도
      // 길이에서 드러난다.
      const lengthLower = gestureLengthDocument * (1 - COMMITTED_PATH_TOLERANCE);
      const lengthUpper = gestureLengthDocument * (1 + COMMITTED_PATH_TOLERANCE);
      check("committed-path-length", committedPathLength >= lengthLower && committedPathLength <= lengthUpper,
        `committed path ${committedPathLength.toFixed(1)}doc-px vs dispatched ${gestureLengthDocument.toFixed(1)}doc-px `
        + `(±${Math.round(COMMITTED_PATH_TOLERANCE * 100)}%, css→doc ×${cssToDocument.toFixed(4)})${gpuNote}`);
    } else {
      check("input-vs-committed-points(inputDeliveryRatio fallback)", deliveryRatio >= INPUT_DELIVERY_MIN,
        `committed hook unavailable; inputDeliveryRatio=${deliveryRatio.toFixed(3)} (min ${INPUT_DELIVERY_MIN})`);
    }
    check("input-delivery-ratio", deliveryRatio >= INPUT_DELIVERY_MIN,
      `observed=${parityCounters.moves} coalesced=${parityCounters.coalesced} / dispatched=${dispatched}`
      + ` → ${deliveryRatio.toFixed(3)}`);
    const settleRatio = settleDiff.changedPixels / (settleDiff.width * settleDiff.height);
    check("no-unfinished-strokes(pixels 300ms↔900ms)", settleRatio <= SETTLED_CHANGED_RATIO_MAX,
      `changed=${settleDiff.changedPixels}/${settleDiff.width * settleDiff.height}`
      + ` (${(settleRatio * 100).toFixed(3)}%) Δmax=${settleDiff.maxChannelDelta}`);
    if (committed) {
      check("no-unfinished-strokes(persisted draw count)", committed.drawCount === 1,
        `drawCount=${committed.drawCount}${gpuNote}`);
    }
    const second = liveDiff.regions.secondHalf!;
    check("live-vs-committed-second-half-ink", second.changed >= INK_MIN_CHANGED_PIXELS,
      `second-half region changed=${second.changed}/${second.pixels} (min ${INK_MIN_CHANGED_PIXELS})`
      + ` · whole clip changed=${liveDiff.changedPixels} Δmax=${liveDiff.maxChannelDelta}`);
    const first = liveDiff.regions.firstHalf!;
    const firstHalfRatio = first.pixels > 0 ? first.changed / first.pixels : 1;
    check("live-vs-committed-first-half-parity", firstHalfRatio <= FIRST_HALF_CHANGED_RATIO_MAX,
      `first-half region changed=${first.changed}/${first.pixels}`
      + ` (${(firstHalfRatio * 100).toFixed(2)}%, max ${FIRST_HALF_CHANGED_RATIO_MAX * 100}%)`);

    // 패스 B — 장획 성능 + 메모리 (3,200 샘플).
    const undoneA = await undoAll(page);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(300);
    const heapBefore = await heapUsed(page, cdp, true);
    await installPerfSampler(page);
    const perfStarted = performance.now();
    const perfDispatched = await drawGesture(page, box, PERF_SAMPLES, async () => {
      surfaceEvidence = await sampleSurfaceEvidence(page, surfaceEvidence);
    });
    await page.mouse.up({ button: "left" });
    const drawMilliseconds = performance.now() - perfStarted;
    await page.waitForTimeout(400);
    const perf = await collectPerfSampling(page);
    const perfCounters = await readCounters(page);
    const heapAfterUp = await heapUsed(page, cdp, false);
    const undoneB = await undoAll(page);
    await page.waitForTimeout(1_000);
    const heapAfterRelease = await heapUsed(page, cdp, true);
    const perfDelivery = Math.min(1, Math.max(perfCounters.moves, perfCounters.coalesced) / perfDispatched);
    surfaceEvidence = await sampleSurfaceEvidence(page, surfaceEvidence);
    report.surfaceEvidence = surfaceEvidence;
    report.perf = {
      dispatchedMoves: perfDispatched, observedPointerMoves: perfCounters.moves,
      inputDeliveryRatio: perfDelivery, drawMilliseconds, frames: perf,
      undoClicks: { afterParity: undoneA, afterPerf: undoneB },
    };
    check("frame-time-p95", perf.p95 <= FRAME_P95_BUDGET_MS,
      `p50=${perf.p50.toFixed(1)} p95=${perf.p95.toFixed(1)} max=${perf.max.toFixed(1)}ms`
      + ` over ${perf.frameCount} frames (budget ${FRAME_P95_BUDGET_MS})`);
    check("long-tasks", perf.longTaskCount <= LONG_TASK_MAX,
      `${perf.longTaskCount} tasks >50ms (${perf.longTaskTotalMs.toFixed(0)}ms total, max ${LONG_TASK_MAX})`);
    check("perf-input-delivery-ratio", perfDelivery >= INPUT_DELIVERY_MIN,
      `${perfCounters.moves}/${perfDispatched} → ${perfDelivery.toFixed(3)}`);
    if (heapBefore.bytes === null || heapAfterRelease.bytes === null) {
      report.memory = "unavailable";
      check("heap-after-release", true, "heap usage unavailable (no CDP, no performance.memory) — not asserted");
    } else {
      report.memory = {
        source: heapAfterRelease.source, beforePointerDown: heapBefore.bytes,
        afterPointerUp: heapAfterUp.bytes, afterUndoIdle: heapAfterRelease.bytes,
      };
      check("heap-after-release", heapAfterRelease.bytes <= heapBefore.bytes + HEAP_GROWTH_MAX_BYTES,
        `before=${mib(heapBefore.bytes)} afterUp=${heapAfterUp.bytes === null ? "?" : mib(heapAfterUp.bytes)}`
        + ` afterRelease=${mib(heapAfterRelease.bytes)} (limit +${mib(HEAP_GROWTH_MAX_BYTES)},`
        + ` undo clicks ${undoneB}, ${heapAfterRelease.source})`);
    }
    const rejections = (await readCounters(page)).rejections;
    report.browserErrors = { console: consoleErrors, page: pageErrors, unhandledRejections: rejections, gpuValidationWarnings };
    check("browser-errors", consoleErrors.length === 0 && pageErrors.length === 0 && rejections === 0,
      `console=${consoleErrors.length} pageerror=${pageErrors.length} unhandledrejection=${rejections}${gpuNote}`);
    await context.close();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    report.fatal = message;
    check("fatal", false, message.split("\n")[0] ?? message);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (preview) await stopChildProcess(preview.child).catch(() => undefined);
  }
  const failed = assertions.filter((entry) => !entry.ok);
  report.assertions = assertions;
  report.ok = failed.length === 0;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const width = Math.max(...assertions.map((entry) => entry.id.length));
  for (const entry of assertions) log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.id.padEnd(width)}  ${entry.detail}`);
  for (const error of [...consoleErrors, ...pageErrors]) log(`  browser: ${error}`);
  log(`report ${REPORT_PATH}`);
  if (failed.length > 0) {
    log(`${failed.length}/${assertions.length} assertions FAILED: ${failed.map((entry) => entry.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  log(`ALL ${assertions.length} LONG-STROKE ASSERTIONS OK`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
}
