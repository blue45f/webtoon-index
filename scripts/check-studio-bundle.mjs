import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { DIST_DIR } from "./lib/repo-paths.mjs";

const outputDirectory = path.resolve(process.env.STUDIO_BUNDLE_DIR ?? DIST_DIR);
const manifestPath = path.join(outputDirectory, ".vite", "manifest.json");
const studioEntry =
  "src/domains/creator/studio-legacy-editor-adapter.tsx";
const appEntry = "index.html";
// This is the sole production exception to the engine-lab ban. Its transitive Babylon chunks may
// be emitted only behind this analyzable BG3D dynamic import and may not be shared by another owner.
const approvedBabylonSpecialistEntry =
  "src/domains/creator/bg3d/studio-bg3d-babylon-specialist-entry.ts";
const approvedBabylonRuntimeChunkName = "studio-bg3d-babylon-runtime";
const babylonManifestPattern = /(?:@babylonjs|babylon(?:\.js)?)/i;
// The next-generation Three WebGPU renderer is production code, not a lab, but it carries a second
// ~200 KiB gzip renderer graph. It is admitted only behind this analyzable dynamic import so the
// WebGL editor activation never pays for it and no other owner can share the chunk.
const approvedWebgpuRendererEntry =
  "src/domains/creator/bg3d/studio-bg3d-three-webgpu-entry.ts";
// The entry chunk itself carries Three's `three.webgpu`/`three.tsl` builds. They are deliberately
// NOT forced into a named manual chunk: see the note in vite.config.ts — naming one drags the
// shared `three.core` graph in with it and every three importer then pays for the WebGPU engine.
const approvedWebgpuRuntimeChunkName = "studio-bg3d-three-webgpu";
const webgpuRendererManifestPattern =
  /(?:three\.webgpu|three\.tsl|studio-bg3d-three-webgpu)/i;

// Product policy (2026-07-27): bundle bytes and static request counts are
// telemetry, not release vetoes. Quality, drawing latency and feature breadth
// take priority; engine isolation and accidental eager-boundary regressions
// below remain hard failures because they directly affect runtime behavior.
const bundleObservations = [];

const budgets = {
  // Measured 2026-07-15 after commercial close-out (soft-lock, merge, density, smart filters):
  // StudioPage ~1.03 MiB + static deps ≈ 2.29 MiB raw / ~753 KiB gzip.
  // 2026-07-15 evening: pro-draw prefs, menu portal stacking, chrome polish ≈ 744 KiB gzip.
  // 2026-07-15 residual always-on presence + pressure-curve helpers: ~755 KiB gzip observed.
  // 2026-07-15 Magma selection transform (content bake + marquee translate/scale): ~762 KiB gzip.
  // 2026-07-15 bubble path/export + floating tool popovers + insert/tutorial wiring:
  // observed ~2438 KiB raw / ~787 KiB gzip (tutorial hub remains lazy).
  // 2026-07-16 upload route + scene/panel assembly split: ~2.33 MiB raw / ~771 KiB gzip.
  // 2026-07-16 release planner split + auth graph cleanup: ~2.32 MiB raw / ~768 KiB gzip.
  // 2026-07-16 publication analytics split: ~2.30 MiB raw / ~762 KiB gzip.
  // Preserve the previous headroom while locking in the independently loaded analytics engine.
  // 2026-07-17 hot-path de-React(제스처 줌·커밋 지연 파이프라인·격리 초안 스토어)+스탬프
  // 브러시 4종: ~2397 KiB raw / ~775 KiB gzip 관측 — 소폭 상향.
  // 2026-07-17 모놀리스 분할: 에디터 JSX를 React Compiler 컴파일 memo 자식 9개로 이전.
  // RC memo-cache 코드젠+props 배선 비용 ≈ +5% (~2527 KiB raw / ~826 KiB gzip 관측) 대신
  // 정착 커밋 렌더 570→68ms. 예산은 관측치+약 2% 여유로 상향.
  // 2026-07-18 브러시 탐색 통합·모바일 스탬프 제어 후 선택/크롭/라이브 잉크 호스트를
  // 지연 청크로 분리: ~2580 KiB raw / ~844 KiB gzip. gzip 상한은 유지하고, 새 계약 코드의
  // 0.2% 미만 raw 증가만 잠근다.
  // 2026-07-18 SVG 내보내기·마술봉·리퀴파이 3개를 Worker로 오프로드(client+protocol+worker
  // 파일 9개 추가): 2645087 raw / 865123 gzip 관측(예산을 87/123바이트 초과). 관측치+약 2%
  // 여유로 상향 — 뒤이어 스머지·힐클론 오프로드가 곧바로 예정돼 있다.
  // 2026-07-18 작업공간 manager·이미지 전문 패널·선택 도구 overlay를 실제 사용자 의도
  // 경계로 분리하고 Container의 section barrel 우회를 제거했다. 전체 route 상한은 원격 Worker
  // wave의 더 큰 보수 예산을 유지하고, entry/앱 셸 이후 증분 예산으로 eager 회귀를 별도 잠근다.
  // 2026-07-19 SceneDocument v3의 bounded shot camera/render/LT/visibility parser가 project-file
  // 검증 경로에 남아 incremental raw 2,117,656 bytes로 측정됐다. Three/R3F는 계속 사용자 진입
  // 시점의 dynamic graph에만 있으므로 raw schema 비용 0.24%만 허용하고 gzip 상한은 유지한다.
  // 2026-07-19 드로잉 보조 문서 영속화·다중 참고 보드·원근/아이소메트릭·VRM 장면 메타데이터를
  // Studio의 동기 복구 경로에 추가했다. 무거운 참고 보드/3D UI는 계속 지연 로딩하며, 정적 증가분은
  // 복구 스키마와 StudioPage 배선뿐이다. 관측치(entry 1,196,284/358,997,
  // incremental 2,176,681/708,141, 124 requests)에 약 2% 여유를 두되 전체 route 상한은 유지한다.
  // 2026-07-19 Inspector 3,727줄을 독립 React Compiler 단위로 분리했다. 이전에는 500KB를 넘는
  // StudioPage 전체의 코드 생성을 Babel이 deopt했지만, 새 Inspector 모듈은 정상 컴파일되어
  // entry 1,258,797/376,835, incremental 2,232,628/723,459, 128 requests로 재배치됐다.
  // 전체 Studio route 상한은 그대로 유지하고, 세부 회귀 예산만 실제 관측치+약 2%로 다시 잠근다.
  // 2026-07-20 앱 셸 i18n과 drawing-assist/VRM scene 복구 계약이 함께 반영된 측정치는
  // route 2,733,950/890,637, app-shell 이후 2,234,078/730,639, 133 requests다. 무거운 패널은
  // 여전히 dynamic entry이며, 전체·request 상한만 관측치에 약 2%/1개 여유로 다시 잠근다.
  // 2026-07-20 원격 참고 이미지/공유 에셋 응답 검증, 아이소메트릭 입체, GLB interchange 계약을
  // 추가한 production build는 app-shell 이후 약 2.27MB/740KB, 137 requests와 app entry 약
  // 500KB raw다. 실제 3D/decoder/원본 이미지 payload는 계속 사용자 동작 뒤 dynamic graph에
  // 남아 있으므로, 새 동기 복구·보안 계약의 관측치에 약 2%/1-request 여유만 다시 고정한다.
  // 2026-07-22 안전한 ORA/CBZ 가져오기와 공통 손실 확인 배선 후 2,787,460/910,538 bytes,
  // app-shell 이후 2,285,734/750,241 bytes, 138 requests를 관측했다. 파서·decode/apply·손실 UI는
  // 모두 사용자 선택 뒤 dynamic graph에 유지하고, 공유 page factory 주입으로 추가 요청도 제거했다.
  // raw에는 약 0.2%, route gzip에는 약 0.16%의 작은 drift 여유만 다시 고정한다.
  // 2026-07-23 선-only 페이지도 원본 보존 합성 필터로 처리하고, 4MP/4MiB fail-closed,
  // 공유 descriptor/CRDT의 bounded blur·curve 왕복 검증을 추가했다. production 관측치는
  // 2,795,227/913,046 bytes, app-shell 이후 2,293,501/752,758 bytes이며 요청 수는 138로 불변.
  // 관측치에 0.1~0.2%의 작은 코드젠 drift만 허용하고 요청·incremental gzip 상한은 유지한다.
  // 2026-07-23 compact WebGPU live-journal/whole-group failover와 다중 화면 reference capture의
  // commit-safe 제어면을 추가했다. Worker·raster encoder·reference renderer는 계속 사용자 수요 뒤
  // dynamic graph에 남고 정적 요청 수도 137개로 불변이다. production 관측치는
  // 2,819,602/919,407 bytes, app-shell 이후 2,317,637/759,027 bytes다.
  // 2026-07-23 경쟁사 갭 1차 웨이브(닷지/번·색상범위·퀵마스크·섀도우하이라이트·히스토그램·
  // 필터팩 15종·특수자 3종·GIF/APNG·브러시 120종·데생인형·bg3d 방만들기/태양릭/렌즈·선화 선택
  // 표시·3D 캡처 화질)가 위 reference capture 웨이브와 합류했다. 웨이브 단독 관측 증가분은
  // route +54.6/+19.0 KiB, app-shell 이후 +54.0/+18.7 KiB, +8 requests(신규 패널·엔코더·3D
  // 모듈 전부 lazy 청크)였고, eager 증가는 InspectorAside 확장+메뉴/단축키 데이터뿐이다.
  // 두 웨이브 합산 추정치+약 2% 여유·request +2로 다시 잠근다.
  // 2026-07-24 2D 코어 웨이브: 사용자 글꼴·벡터 지우개 교점·선택 스텐실·세로쓰기 정적 임포트로
  // route raw 2866.5/gzip 938.9 KiB, app-shell 이후 raw 2375.5 KiB·정적 요청 154 관측. 관측치+여유로 재고정.
  // 2026-07-24 경쟁 residual: multi-page bulk, dialogue ruby/format, export package preflight,
  // live mutation gate, auto-color plan panel(lazy)+worker, indices capture glue.
  // production 관측: route raw 2905.0 KiB, app-shell 이후 raw 2413.9 / gzip 794.7 KiB, 156 requests.
  // 무거운 패널·export·3D는 lazy 유지. 관측치+약 2%/+2-request 여유로 재고정.
  // 2026-07-24 CSP 교점까지 지우기 문서 apply 배선(순수 플래너는 기존, StudioPage·dock 가시성):
  // route gzip 956.5 KiB 관측 — gzip 상한만 관측치+약 2%로 재고정(raw·entry는 여유 유지).
  // 2026-07-26 캔버스 뷰포트 compiler boundary + 0%-기본 WebGPU cohort policy:
  // route 3,036,277/994,984 bytes 관측. entry/incremental/gzip 예산은 기존 상한 안이며,
  // raw의 0.04% 초과만 작은 코드젠 drift 여유와 함께 다시 잠근다.
  // 2026-07-27 전체 브러시 카탈로그 즐겨찾기·쓰기 실패 복구, 선화 EDT/색상범위 Worker
  // admission control, OBJ/MTL preflight Worker, Studio 전용 COOP/COEP gate를 반영한 측정치는
  // route raw 3,055,6xx, entry gzip 386,6xx bytes다. 무거운 처리기는 계속 dynamic Worker이고
  // 정적 요청 수와 route gzip은 기존 상한 안이므로 관측치에 0.2% 미만의 여유만 재고정한다.
  studio: { raw: 3_060_000, gzip: 1_000_000 },
  studioEntry: { raw: 1_284_000, gzip: 389_000 },
  // 2026-07-23 저녁: roughjs 스케치 도형·polygon-clipping 패스 불리언 도입 — 두 라이브러리 본체는
  // 다이내믹 청크(예산 밖)이나 어댑터 공유 청크 +1로 정적 요청 149 관측. +1 여유로 재고정.
  // 2026-07-23 밤: perfect-freehand 벡터 펜(퍼펙트 잉크/마커) 어댑터 도입 — 라이브러리 본체는
  // 다이내믹 청크(예산 밖)이나 어댑터 공유 청크 +1로 정적 요청 150 관측. +1 여유로 재고정.
  // 2026-07-24: 비파괴 필터 마스크(studio-filter-mask, KonvaImageNode 정적 임포트) + 말풍선
  // 손그림 외곽선(studio-bubble-outline-style, KonvaBubbleNode 정적 임포트)로 정적 요청 152 관측.
  // 2026-07-24 배선: 필터마스크 페인팅 툴 + 말풍선 병합(StudioPage가 studio-bubble-merge 정적
  // 임포트)로 정적 요청 153·gzip 777.6 KiB 관측. 청크+1, gzip 예산 소폭 상향(+headroom)해 재고정.
  // 2026-07-24 2D 코어 웨이브: app-shell 이후 raw 2375.5 KiB·정적 요청 154 관측. 청크+1·raw 상향 재고정.
  // 2026-07-26: Cloud storage adapter (Google Drive & OneDrive) integration added:
  // measured studioIncremental ~2469 KiB raw / 812.5 KiB gzip.
  // 2026-07-27 위 Worker admission/prefs 경계 반영 후 raw 2,551,xxx bytes를 관측했다.
  // gzip·request 한도는 유지하고 raw 코드젠 drift만 약 0.2% 허용한다.
  studioIncremental: { raw: 2_556_000, gzip: 840_000, chunks: 158 },
  // Rapier deterministic compat is intentionally isolated in a user-triggered module Worker.
  // 2026-07-18 production output: 2,302,139 raw / 855,399 gzip. Keep ~2% version-drift headroom
  // without charging this optional engine to Studio or the 3D editor's initial graph.
  bg3dPhysicsWorker: { raw: 2_350_000, gzip: 875_000 },
  // 2026-07-19 selected-shot/multi-pass/recovery UI baseline. This is the complete static closure
  // activated only after the user opens StudioBackground3D; PSD/physics/engine labs stay isolated.
  // 2026-07-23 방 만들기·태양 릭·렌즈·단면·스케일 가이드(전부 lazy bg3d 청크) 반영:
  // 2,399,700/698,200 bytes, 42 requests 관측 — 관측치+약 2%/1-request 여유로 상향.
  // 2026-07-26 Shapes/View/LT를 500KB 미만 독립 모듈로 분리해 기존 Babel deopt를 제거했다.
  // React Compiler memo-cache 코드젠과 명시적 패널 계약으로 activation closure가
  // 2,466,516/727,099 bytes, 43 requests로 이동했다. Three/R3F·패널은 여전히 Studio route와
  // 분리되고 optional runtime 경계도 불변이므로 관측치에 약 2% drift만 허용한다.
  // 2026-07-27 OBJ/MTL preflight Worker client의 취소·epoch·예산 경계 반영 후 gzip이 기존
  // 상한을 수십 바이트 넘었다. raw·request 한도는 유지하고 gzip만 0.3% 미만 재고정한다.
  bg3dEditor: { raw: 2_516_000, gzip: 744_000, chunks: 43 },
  // Durable recovery, integrity verification, PNG/contact-sheet/PSD clients, and ZIP packaging load
  // only after explicit batch export. 2026-07-20 OffscreenCanvas pass-PNG Worker client/protocol:
  // measured incremental closure 164,352 raw / 43,602 gzip; retain ~2% raw headroom.
  bg3dShotBatchRuntime: { raw: 168_000, gzip: 45_000, chunks: 3 },
  // Per-pass OffscreenCanvas PNG compositor; measured 2,651 raw / 1,156 gzip and isolated from
  // both the editor graph and the batch-runtime static closure by Vite's module Worker boundary.
  bg3dShotPngWorker: { raw: 4_000, gzip: 2_000 },
  // ag-psd is intentionally reachable only through the bounded per-shot PSD module Worker.
  bg3dPsdWorker: { raw: 1_250_000, gzip: 360_000 },
  // OffscreenCanvas/createImageBitmap contact-sheet compositor, isolated from the editor graph.
  bg3dContactSheetWorker: { raw: 80_000, gzip: 25_000 },
  // OBJ/MTL parsing, triangulation, and clone-safe scene canonicalization stay in an isolated
  // module Worker. 2026-07-22 production output: 325,024 raw / 77,443 gzip; retain modest
  // dependency-drift headroom without allowing this parser to join the BG3D editor graph.
  bg3dObjWorker: { raw: 340_000, gzip: 82_000 },
  // Measured after the same build: 443,257 raw / 143,956 gzip.
  app: { raw: 510_000, gzip: 170_000 },
};

// ---------------------------------------------------------------------------
// Ratchet gate (2026-08-08)
// ---------------------------------------------------------------------------
// The reference budgets above stayed advisory, and the 2026-08-08 startup
// measurement showed what that cost: 12 overruns shipped while this script
// exited 0 (Studio route 2.06x, app entry 4.73x its reference). Turning the
// references into hard failures today would break the build outright, so the
// gate instead ratchets against the *last accepted measurement* recorded in
// scripts/bundle-baseline.json:
//
//   - growing past baseline + tolerance      -> exit 1 (regression)
//   - staying flat or shrinking              -> pass, and improvements are
//                                               reported so they can be locked
//   - UPDATE_BUNDLE_BASELINE=1 (--update-baseline) rewrites the baseline to
//     the current measurement (explicit acceptance, both directions)
//   - TIGHTEN_BUNDLE_BASELINE=1 (--tighten) locks improvements only, never
//     loosens a number
//
// The references above remain telemetry: they answer "how far from the design
// target are we", the baseline answers "did this build make it worse".
const baselinePath = path.resolve(
  process.env.STUDIO_BUNDLE_BASELINE ?? path.join("scripts", "bundle-baseline.json"),
);
const baselineSchema = "toonspectrum.bundle-baseline/1";
const cliFlags = new Set(process.argv.slice(2));
const hasFlag = (flagName, envName) =>
  cliFlags.has(flagName) || process.env[envName] === "1";
const updateBaselineRequested = hasFlag("--update-baseline", "UPDATE_BUNDLE_BASELINE");
const tightenBaselineRequested = hasFlag("--tighten", "TIGHTEN_BUNDLE_BASELINE");
const runtimeProbeRequested = hasFlag("--runtime", "STUDIO_BUNDLE_RUNTIME");
const verboseReportRequested = hasFlag("--verbose", "STUDIO_BUNDLE_VERBOSE");

// Byte metrics drift by a few hundred bytes on pure codegen churn, so a flat 2%
// absorbs noise without absorbing a real regression. Chunk counts are small
// integers where every +1 is an extra round trip, so they get the same relative
// tolerance plus a 2-chunk absolute floor for the small closures.
const ratchetPolicy = { byteTolerance: 0.02, countTolerance: 0.02, countSlack: 2 };

// How long a recorded (not re-measured) startup block may be reprinted before the report says it
// can no longer be trusted. One working week: long enough that a normal feature branch never trips
// it, short enough that a silent multi-release drift cannot hide behind it.
const runtimeStalenessDays = 7;

// Onboarding overlays the runtime probe dismisses so it measures a returning
// user's cold entry rather than the first-run tour. Declared here because the
// probe is awaited from the main block, above its own definition.
const runtimeQuickStartKey = "toonspectrum-studio-quick-start-dismissed";
const runtimeMobileHintKey = "toonspectrum-studio-mobile-hint-dismissed";

// Chunks only a first-run visitor downloads. If any land in the measured pass, the probe is
// describing onboarding rather than the returning user it claims to, and every byte it reports
// is inflated by code a returning user never fetches. Declared up here for the same reason the
// two keys above are: the probe is awaited from the main block, above its own definition.
const runtimeFirstRunOnlyChunks = ["StudioQuickStartPanel"];

/** Every number the gate measures, in declaration order, for the ratchet + report. */
const measurements = [];

function recordMeasurement(group, key, kind, value, reference = null) {
  measurements.push({ group, key, kind, value, reference });
}

function ratchetCeiling(kind, baselineValue) {
  if (kind === "count") {
    return Math.max(
      baselineValue + ratchetPolicy.countSlack,
      Math.floor(baselineValue * (1 + ratchetPolicy.countTolerance)),
    );
  }
  return Math.floor(baselineValue * (1 + ratchetPolicy.byteTolerance));
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatMeasurement(kind, value) {
  return kind === "count" ? String(value) : formatKiB(value);
}

function formatRatio(actual, reference) {
  if (!Number.isFinite(reference) || reference <= 0) return "-";
  return `${(actual / reference).toFixed(2)}x`;
}

/**
 * Vite content hashes change every build; the module identity does not.
 * The `$`-anchored fixed width matters: chunk names contain hyphens too
 * (`studio-dynamic-brush-render-plan-B5FOTHv-.js`), so a greedy class would
 * eat the name and collapse unrelated chunks into one identity.
 */
function chunkIdentity(fileName) {
  return fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/u, "").replace(/\.js$/u, "");
}

/** Emitted asset name for a request URL, or "" when the URL is unparseable. */
function resourceFileName(url) {
  try {
    return new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

function renderTable(headers, rows) {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => String(row[column]).length)),
  );
  const renderRow = (cells) =>
    cells
      .map((cell, column) =>
        column === 0
          ? String(cell).padEnd(widths[column])
          : String(cell).padStart(widths[column]),
      )
      .join("  ")
      .trimEnd();
  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => renderRow(row)),
  ].join("\n");
}

function fail(message) {
  console.error(`studio bundle check failed: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(manifestPath)) {
  fail(`missing ${path.relative(process.cwd(), manifestPath)}; run "pnpm run build" first`);
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  function staticClosure(entryKey) {
    const visited = new Set();
    const visit = (key) => {
      if (visited.has(key)) return;
      const entry = manifest[key];
      if (!entry) throw new Error(`manifest import ${JSON.stringify(key)} is missing`);
      visited.add(key);
      for (const imported of entry.imports ?? []) visit(imported);
    };
    visit(entryKey);
    return visited;
  }

  function measure(keys) {
    let raw = 0;
    let gzip = 0;
    for (const key of keys) {
      const entry = manifest[key];
      const filePath = path.join(outputDirectory, entry.file);
      const bytes = fs.readFileSync(filePath);
      raw += bytes.byteLength;
      gzip += gzipSync(bytes).byteLength;
    }
    return { raw, gzip };
  }

  function describe(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  function checkBudget(label, actual, budget) {
    recordMeasurement("static", `${label} raw`, "bytes", actual.raw, budget.raw);
    recordMeasurement("static", `${label} gzip`, "bytes", actual.gzip, budget.gzip);
    if (actual.raw > budget.raw) {
      bundleObservations.push(
        `${label} static JS is ${describe(actual.raw)} raw (reference ${describe(budget.raw)})`,
      );
    }
    if (actual.gzip > budget.gzip) {
      bundleObservations.push(
        `${label} static JS is ${describe(actual.gzip)} gzip (reference ${describe(budget.gzip)})`,
      );
    }
  }

  function observeCount(label, actual, reference) {
    recordMeasurement("static", `${label} chunks`, "count", actual, reference);
    if (actual > reference) {
      bundleObservations.push(
        `${label} uses ${actual} static JS requests (reference ${reference})`,
      );
    }
  }

  function matchingEntries(keys, pattern) {
    return [...keys].filter((key) => {
      const entry = manifest[key];
      return pattern.test([key, entry.src, entry.file].filter(Boolean).join(" "));
    });
  }

  function matchingManifestEntries(pattern) {
    return Object.entries(manifest)
      .filter(([key, entry]) => pattern.test([key, entry.src, entry.file].filter(Boolean).join(" ")))
      .map(([key]) => key);
  }

  // Test/source modules are never production runtime assets. This is a hard integrity boundary,
  // not a byte-budget observation: a templated `new URL()` can otherwise make Vite glob a nearby
  // `*.test.ts` file and publish its source verbatim without joining an eager JS closure.
  const emittedTestSourceEntries = Object.entries(manifest)
    .filter(([key, entry]) => {
      const source = String(entry.src ?? key);
      const file = String(entry.file ?? "");
      return /(?:^|\/)\.?(?:[^/]+\.)?(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu.test(source)
        || /(?:^|\/)[^/]+\.(?:test|spec)-[^/]+\.(?:[cm]?[jt]sx?)$/iu.test(file)
        || /\.(?:ts|tsx)$/iu.test(file);
    })
    .map(([key]) => key);
  if (emittedTestSourceEntries.length > 0) {
    fail(
      `production manifest emitted test/source assets: ${emittedTestSourceEntries.join(", ")}`,
    );
  }

  function checkDynamicBoundary(label, pattern, staticKeys) {
    const matching = matchingManifestEntries(pattern);
    const dynamicEntries = matching.filter((key) => manifest[key].isDynamicEntry === true);
    if (dynamicEntries.length === 0) {
      fail(`${label} is missing an analyzable dynamic manifest entry`);
      return;
    }
    const eagerEntries = dynamicEntries.filter((key) => staticKeys.has(key));
    if (eagerEntries.length > 0) {
      fail(`${label} returned to the Studio static graph: ${eagerEntries.join(", ")}`);
    }
  }

  function dynamicTargetsFromStaticClosure(entryKey) {
    const targets = new Set();
    for (const key of staticClosure(entryKey)) {
      for (const target of manifest[key].dynamicImports ?? []) targets.add(target);
    }
    return targets;
  }

  /** Everything an entry can reach by any import edge, static or dynamic, transitively. */
  function reachableClosure(entryKey) {
    const visited = new Set();
    const queue = [entryKey];
    while (queue.length > 0) {
      const key = queue.pop();
      if (visited.has(key)) continue;
      const entry = manifest[key];
      if (!entry) throw new Error(`manifest import ${JSON.stringify(key)} is missing`);
      visited.add(key);
      queue.push(...(entry.imports ?? []), ...(entry.dynamicImports ?? []));
    }
    return visited;
  }

  function checkApprovedLazySpecialistBoundary({ // NOSONAR javascript:S3776
    label,
    pattern,
    approvedEntrySource,
    requiredRuntimeChunkName,
    approvedParentEntryKey,
    forbiddenStaticClosures,
  }) {
    const matching = matchingManifestEntries(pattern);
    if (matching.length === 0) {
      fail(
        `${label} production activation is missing its approved emitted entry/runtime chunk`,
      );
      return;
    }

    const approvedEntries = Object.entries(manifest)
      .filter(([key, entry]) => key === approvedEntrySource || entry.src === approvedEntrySource)
      .map(([key]) => key);
    if (approvedEntries.length !== 1) {
      fail(
        `${label} requires exactly one approved entry ${approvedEntrySource}, found ${approvedEntries.length}`,
      );
      return;
    }

    const approvedEntryKey = approvedEntries[0];
    const approvedEntry = manifest[approvedEntryKey];
    if (!matching.includes(approvedEntryKey)) {
      fail(`${label} approved entry did not match its engine policy: ${approvedEntryKey}`);
      return;
    }
    if (approvedEntry.isDynamicEntry !== true) {
      fail(`${label} approved entry is not a dynamic manifest entry: ${approvedEntryKey}`);
    }
    const runtimeChunks = matching.filter((key) => {
      const entry = manifest[key];
      return key.includes(requiredRuntimeChunkName) ||
        entry.file?.includes(requiredRuntimeChunkName);
    });
    if (runtimeChunks.length !== 1) {
      fail(
        `${label} requires one manifest-visible ${requiredRuntimeChunkName} chunk, found ${runtimeChunks.length}`,
      );
    }

    const forbiddenStaticMatches = new Set();
    for (const [closureLabel, staticKeys] of forbiddenStaticClosures) {
      for (const key of matching) {
        if (staticKeys.has(key)) forbiddenStaticMatches.add(`${closureLabel}: ${key}`);
      }
    }
    if (forbiddenStaticMatches.size > 0) {
      fail(
        `${label} returned to a forbidden static graph: ${[...forbiddenStaticMatches].join(", ")}`,
      );
    }

    const approvedClosure = staticClosure(approvedEntryKey);
    const outsideApprovedClosure = matching.filter((key) => !approvedClosure.has(key));
    if (outsideApprovedClosure.length > 0) {
      fail(
        `${label} code was emitted outside the approved specialist closure: ${outsideApprovedClosure.join(", ")}`,
      );
    }

    const staticOwnersOutsideApprovedClosure = Object.keys(manifest).filter((key) => {
      if (approvedClosure.has(key)) return false;
      const closure = staticClosure(key);
      return matching.some((matchingKey) => closure.has(matchingKey));
    });
    if (staticOwnersOutsideApprovedClosure.length > 0) {
      fail(
        `${label} code is shared by an unapproved static owner: ${staticOwnersOutsideApprovedClosure.join(", ")}`,
      );
    }

    // The specialist must be one hop from the approved parent — a nested waterfall would make
    // activating it cost two round trips.
    if (!dynamicTargetsFromStaticClosure(approvedParentEntryKey).has(approvedEntryKey)) {
      fail(
        `${label} is not dynamically imported from the approved parent closure `
          + `${approvedParentEntryKey}; activating it would cost a nested waterfall`,
      );
    }

    // Every other call site must still belong to the approved parent's own graph. Counting the
    // importers used to stand in for that, but the count says nothing about ownership: a second
    // legitimate call site inside the editor (a thumbnail job borrowing the live renderer) reads
    // identically to an unrelated feature pulling in a whole second renderer, which is the thing
    // worth failing on. Reachability answers the real question, and the static-owner checks above
    // still guarantee nothing downloads this graph without the editor.
    const parentReachable = reachableClosure(approvedParentEntryKey);
    const foreignDynamicImporters = Object.entries(manifest)
      .filter(([key, entry]) =>
        (entry.dynamicImports ?? []).includes(approvedEntryKey) && !parentReachable.has(key))
      .map(([key]) => key);
    if (foreignDynamicImporters.length > 0) {
      fail(
        `${label} is dynamically imported from outside the approved parent's graph: `
          + foreignDynamicImporters.join(", "),
      );
    }
  }

  try {
    const studioKeys = staticClosure(studioEntry);
    const appKeys = staticClosure(appEntry);
    const studioIncrementalKeys = new Set([...studioKeys].filter((key) => !appKeys.has(key)));
    const studioSize = measure(studioKeys);
    const studioEntrySize = measure(new Set([studioEntry]));
    const studioIncrementalSize = measure(studioIncrementalKeys);
    const appSize = measure(appKeys);

    checkBudget("Studio route", studioSize, budgets.studio);
    checkBudget("StudioPage entry", studioEntrySize, budgets.studioEntry);
    checkBudget("Studio route after app shell", studioIncrementalSize, budgets.studioIncremental);
    observeCount(
      "Studio route after app shell",
      studioIncrementalKeys.size,
      budgets.studioIncremental.chunks,
    );
    checkBudget("app entry", appSize, budgets.app);

    const eagerDocumentEngines = matchingEntries(
      studioKeys,
      /studio-(?:svg-export|psd-export|psd-import)/,
    );
    if (eagerDocumentEngines.length > 0) {
      fail(`SVG/PSD engines returned to the Studio static graph: ${eagerDocumentEngines.join(", ")}`);
    }

    const eagerCrdtRuntime = matchingEntries(
      studioKeys,
      /(?:studio-crdt-document|studio-crdt-room-binding|node_modules.*\/yjs\/)/,
    );
    if (eagerCrdtRuntime.length > 0) {
      fail(`Yjs/CRDT runtime returned to the Studio static graph: ${eagerCrdtRuntime.join(", ")}`);
    }

    const eagerOptionalStudioWorkflows = matchingEntries(
      studioKeys,
      /(?:StudioUploadPublish|studio-(?:comipo-assembly|comipo-shipped|comipo-insert|panel-layouts|scene-templates))/,
    );
    if (eagerOptionalStudioWorkflows.length > 0) {
      fail(
        `upload/template workflows returned to the Studio static graph: ${eagerOptionalStudioWorkflows.join(", ")}`,
      );
    }

    checkDynamicBoundary(
      "optional publish manifest verification runtime",
      /src\/domains\/creator\/studio-publish-package-manifest-runtime\.ts/,
      studioKeys,
    );

    const eagerReleasePlanner = matchingEntries(
      studioKeys,
      /studio-release-schedule(?!-loader)/,
    );
    if (eagerReleasePlanner.length > 0) {
      fail(`release planning engine returned to the Studio static graph: ${eagerReleasePlanner.join(", ")}`);
    }

    const eagerPublicationAnalytics = matchingEntries(
      studioKeys,
      /studio-publication-analytics(?!-loader)/,
    );
    if (eagerPublicationAnalytics.length > 0) {
      fail(
        `publication analytics engine returned to the Studio static graph: ${eagerPublicationAnalytics.join(", ")}`,
      );
    }

    const eagerVoiceRuntime = matchingEntries(
      studioKeys,
      /(?:studio-voice-call(?!-model)|studio-voice-ice-policy)/,
    );
    if (eagerVoiceRuntime.length > 0) {
      fail(
        `optional WebRTC voice runtime returned to the Studio static graph: ${eagerVoiceRuntime.join(", ")}`,
      );
    }

    const eagerLayerNavigator = matchingEntries(
      studioKeys,
      /StudioLayerNavigator(?:\.tsx)?/,
    );
    if (eagerLayerNavigator.length > 0) {
      fail(
        `optional layer navigator returned to the Studio static graph: ${eagerLayerNavigator.join(", ")}`,
      );
    }

    const eagerColorVisionCoach = matchingEntries(
      studioKeys,
      /(?:studio-color-vision-coach|StudioColorBlindPreviewToggle)/,
    );
    if (eagerColorVisionCoach.length > 0) {
      fail(
        `optional color-vision coach UI returned to the Studio static graph: ${eagerColorVisionCoach.join(", ")}`,
      );
    }

    const standaloneColorVisionModel = matchingEntries(
      studioIncrementalKeys,
      /studio-color-vision-model/,
    );
    if (standaloneColorVisionModel.length > 0) {
      fail(
        `live color-vision model became an extra Studio request: ${standaloneColorVisionModel.join(", ")}`,
      );
    }

    const optionalUiBoundaries = [
      ["deferred Studio inspector", /src\/domains\/creator\/StudioInspectorAside\.tsx/],
      ["optional comments session", /src\/domains\/creator\/StudioCommentsPanelSession\.tsx/],
      ["optional Studio menubar commands", /src\/domains\/creator\/StudioMenubarContent\.tsx/],
      ["optional mobile editing dock", /src\/domains\/creator\/StudioMobileEditingDock\.tsx/],
      ["optional view tools HUD", /src\/domains\/creator\/StudioViewToolsHud\.tsx/],
      ["optional tools companion protocol", /src\/domains\/creator\/studio-tools-companion\.ts/],
      ["optional workspace manager", /src\/domains\/creator\/StudioWorkspaceMenu\.tsx/],
      ["optional color palette", /src\/domains\/creator\/StudioColorPalettePanel\.tsx/],
      ["optional flood fill panel", /src\/domains\/creator\/StudioFloodFillPanel\.tsx/],
      ["optional palette library", /src\/domains\/creator\/StudioPaletteLibraryPanel\.tsx/],
      ["optional panel split tool", /src\/domains\/creator\/StudioPanelSplitTool\.tsx/],
      ["optional pixel-edit brush runtime", /src\/domains\/creator\/studio-pixel-edit-brush-runtime\.ts/],
      ["optional AI scenario codec", /src\/domains\/creator\/studio-scenario-scenes\.ts/],
      ["optional AI palette codec", /src\/domains\/creator\/studio-palette-suggest\.ts/],
      ["optional heal/clone overlay", /src\/domains\/creator\/StudioHealCloneOverlay\.tsx/],
      ["optional history brush overlay", /src\/domains\/creator\/StudioHistoryBrushOverlay\.tsx/],
      ["optional isometric overlay", /src\/domains\/creator\/StudioIsometricGridOverlay\.tsx/],
      ["optional layer mask overlay", /src\/domains\/creator\/(?:layer\/)?StudioLayerMaskOverlay\.tsx/],
      ["optional perspective overlay", /src\/domains\/creator\/StudioPerspectiveOverlay\.tsx/],
      ["optional puppet warp overlay", /src\/domains\/creator\/StudioPuppetWarpOverlay\.tsx/],
    ];
    for (const [label, pattern] of optionalUiBoundaries) {
      checkDynamicBoundary(label, pattern, studioKeys);
    }

    const commentSessionEntries = matchingManifestEntries(
      /src\/domains\/creator\/StudioCommentsPanelSession\.tsx/,
    ).filter((key) => manifest[key].isDynamicEntry === true);
    if (commentSessionEntries.length !== 1) {
      fail(
        `expected one StudioCommentsPanelSession dynamic entry, found ${commentSessionEntries.length}`,
      );
    } else {
      const nestedCommentPanels = matchingEntries(
        dynamicTargetsFromStaticClosure(commentSessionEntries[0]),
        /src\/domains\/creator\/StudioCommentsPanel\.tsx/,
      );
      if (nestedCommentPanels.length > 0) {
        fail(
          "comments session introduced a nested StudioCommentsPanel dynamic waterfall: "
            + nestedCommentPanels.join(", "),
        );
      }
    }

    const eagerBackgroundCatalog = matchingEntries(
      studioKeys,
      /studio-background-presets/,
    );
    if (eagerBackgroundCatalog.length > 0) {
      fail(
        `optional background preset catalog returned to the Studio static graph: ${eagerBackgroundCatalog.join(", ")}`,
      );
    }

    const eagerFrameAnimationExport = matchingEntries(
      studioKeys,
      /(?:studio-frame-animation-export|studio-motion-export)/,
    );
    if (eagerFrameAnimationExport.length > 0) {
      fail(
        `optional frame-animation WebM runtime returned to the Studio static graph: ${eagerFrameAnimationExport.join(", ")}`,
      );
    }

    const eager3dRuntime = matchingEntries(
      studioKeys,
      /(?:studio-background-3d-primitives|StudioBackground3D|studio-bg3d-three-webgpu-lab|react-three-fiber|three\.(?:module|webgpu))/,
    );
    if (eager3dRuntime.length > 0) {
      fail(`optional 3D runtime returned to the Studio static graph: ${eager3dRuntime.join(", ")}`);
    }

    const emittedUnapprovedProductionEngineLabs = matchingManifestEntries(
      /(?:studio-bg3d-engine-benchmark-browser|playcanvas)/i,
    );
    if (emittedUnapprovedProductionEngineLabs.length > 0) {
      fail(
        `unapproved 3D engine lab code was emitted into the production manifest: ${emittedUnapprovedProductionEngineLabs.join(", ")}`,
      );
    }

    checkDynamicBoundary(
      "optional 3D background editor",
      /src\/domains\/creator\/(?:bg3d\/)?StudioBackground3D\.tsx/,
      studioKeys,
    );
    const background3dEntries = matchingManifestEntries(
      /src\/domains\/creator\/(?:bg3d\/)?StudioBackground3D\.tsx/,
    );
    if (background3dEntries.length !== 1) {
      fail(`expected one StudioBackground3D manifest entry, found ${background3dEntries.length}`);
    } else {
      const background3dKeys = staticClosure(background3dEntries[0]);
      checkApprovedLazySpecialistBoundary({
        label: "Babylon specialist",
        pattern: babylonManifestPattern,
        approvedEntrySource: approvedBabylonSpecialistEntry,
        requiredRuntimeChunkName: approvedBabylonRuntimeChunkName,
        approvedParentEntryKey: background3dEntries[0],
        forbiddenStaticClosures: [
          ["app entry", appKeys],
          ["Studio route", studioKeys],
          ["BG3D editor activation", background3dKeys],
        ],
      });
      checkApprovedLazySpecialistBoundary({
        label: "Three WebGPU renderer",
        pattern: webgpuRendererManifestPattern,
        approvedEntrySource: approvedWebgpuRendererEntry,
        requiredRuntimeChunkName: approvedWebgpuRuntimeChunkName,
        approvedParentEntryKey: background3dEntries[0],
        forbiddenStaticClosures: [
          ["app entry", appKeys],
          ["Studio route", studioKeys],
          ["BG3D editor activation", background3dKeys],
        ],
      });
      const background3dSize = measure(background3dKeys);
      checkBudget("BG3D editor activation", background3dSize, budgets.bg3dEditor);
      observeCount(
        "BG3D editor activation",
        background3dKeys.size,
        budgets.bg3dEditor.chunks,
      );
      checkDynamicBoundary(
        "optional BG3D shot-batch runtime",
        /src\/domains\/creator\/(?:bg3d\/)?studio-bg3d-shot-batch-runtime\.ts/,
        background3dKeys,
      );
      const shotBatchRuntimeEntries = matchingManifestEntries(
        /src\/domains\/creator\/(?:bg3d\/)?studio-bg3d-shot-batch-runtime\.ts/,
      ).filter((key) => manifest[key].isDynamicEntry === true);
      if (shotBatchRuntimeEntries.length !== 1) {
        fail(`expected one BG3D shot-batch runtime entry, found ${shotBatchRuntimeEntries.length}`);
      } else {
        const shotBatchRuntimeEntry = shotBatchRuntimeEntries[0];
        const editorDynamicTargets = dynamicTargetsFromStaticClosure(background3dEntries[0]);
        if (!editorDynamicTargets.has(shotBatchRuntimeEntry)) {
          fail("BG3D shot-batch runtime introduced a nested dynamic-import waterfall");
        }
        const runtimeIncrementalKeys = new Set(
          [...staticClosure(shotBatchRuntimeEntry)].filter((key) => !background3dKeys.has(key)),
        );
        checkBudget(
          "BG3D shot-batch runtime after editor",
          measure(runtimeIncrementalKeys),
          budgets.bg3dShotBatchRuntime,
        );
        observeCount(
          "BG3D shot-batch runtime after editor",
          runtimeIncrementalKeys.size,
          budgets.bg3dShotBatchRuntime.chunks,
        );
      }
      const eagerShotBatchProductionRuntime = matchingEntries(
        background3dKeys,
        /(?:_studio-bg3d-shot-batch-|studio-bg3d-file-integrity|studio-package-archive|studio-bg3d-shot-batch-(?:artifact-integrity|archive-verifier|download-gate|plan|queue|recovery-store|worker-client))/,
      ).filter((key) => !/shot-batch-(?:limits|pass-catalog|runtime)/.test(key));
      if (eagerShotBatchProductionRuntime.length > 0) {
        fail(
          "optional BG3D shot-batch verification/archive runtime returned to the editor static graph: "
            + eagerShotBatchProductionRuntime.join(", "),
        );
      }
      const eagerPhysicsRuntime = matchingEntries(
        background3dKeys,
        /(?:studio-bg3d-physics-worker-client|node_modules.*rapier3d)/,
      );
      if (eagerPhysicsRuntime.length > 0) {
        fail(
          `optional BG3D physics runtime returned to the 3D editor static graph: ${eagerPhysicsRuntime.join(", ")}`,
        );
      }
      const eagerPsdRuntime = matchingEntries(
        background3dKeys,
        /(?:src\/domains\/creator\/(?:bg3d\/)?studio-bg3d-shot-psd\.ts|node_modules.*ag-psd)/,
      );
      if (eagerPsdRuntime.length > 0) {
        fail(
          `optional BG3D PSD writer returned to the 3D editor static graph: ${eagerPsdRuntime.join(", ")}`,
        );
      }
      const eagerContactSheetRuntime = matchingEntries(
        background3dKeys,
        /src\/domains\/creator\/(?:bg3d\/)?studio-bg3d-shot-contact-sheet\.ts/,
      );
      if (eagerContactSheetRuntime.length > 0) {
        fail(
          `optional BG3D contact-sheet compositor returned to the editor static graph: ${eagerContactSheetRuntime.join(", ")}`,
        );
      }
      checkDynamicBoundary(
        "optional BG3D physics runtime",
        /src\/domains\/creator\/(?:bg3d\/)?studio-bg3d-physics-worker-client\.ts/,
        background3dKeys,
      );
    }

    const pngWorkerFiles = fs.readdirSync(path.join(outputDirectory, "assets"))
      .filter((file) => /^studio-bg3d-shot-png\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
    if (pngWorkerFiles.length !== 1) {
      fail(`expected one isolated BG3D pass-PNG Worker asset, found ${pngWorkerFiles.length}`);
    } else {
      const bytes = fs.readFileSync(path.join(outputDirectory, "assets", pngWorkerFiles[0]));
      checkBudget("BG3D pass-PNG Worker", {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes).byteLength,
      }, budgets.bg3dShotPngWorker);
    }

    const contactSheetWorkerFiles = fs.readdirSync(path.join(outputDirectory, "assets"))
      .filter((file) => /^studio-bg3d-shot-contact-sheet\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
    if (contactSheetWorkerFiles.length !== 1) {
      fail(`expected one isolated BG3D contact-sheet Worker asset, found ${contactSheetWorkerFiles.length}`);
    } else {
      const bytes = fs.readFileSync(path.join(outputDirectory, "assets", contactSheetWorkerFiles[0]));
      checkBudget("BG3D contact-sheet Worker", {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes).byteLength,
      }, budgets.bg3dContactSheetWorker);
    }

    const objWorkerFiles = fs.readdirSync(path.join(outputDirectory, "assets"))
      .filter((file) => /^studio-bg3d-obj\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
    if (objWorkerFiles.length !== 1) {
      fail(`expected one isolated BG3D OBJ Worker asset, found ${objWorkerFiles.length}`);
    } else {
      const bytes = fs.readFileSync(path.join(outputDirectory, "assets", objWorkerFiles[0]));
      checkBudget("BG3D OBJ Worker", {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes).byteLength,
      }, budgets.bg3dObjWorker);
    }

    const psdWorkerFiles = fs.readdirSync(path.join(outputDirectory, "assets"))
      .filter((file) => /^studio-bg3d-shot-psd\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
    if (psdWorkerFiles.length !== 1) {
      fail(`expected one isolated BG3D PSD Worker asset, found ${psdWorkerFiles.length}`);
    } else {
      const bytes = fs.readFileSync(path.join(outputDirectory, "assets", psdWorkerFiles[0]));
      checkBudget("BG3D PSD Worker", {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes).byteLength,
      }, budgets.bg3dPsdWorker);
    }

    const physicsWorkerFiles = fs.readdirSync(path.join(outputDirectory, "assets"))
      .filter((file) => /^studio-bg3d-physics\.worker-[A-Za-z0-9_-]+\.js$/u.test(file));
    if (physicsWorkerFiles.length !== 1) {
      fail(`expected one isolated BG3D physics Worker asset, found ${physicsWorkerFiles.length}`);
    } else {
      const bytes = fs.readFileSync(path.join(outputDirectory, "assets", physicsWorkerFiles[0]));
      checkBudget("BG3D physics Worker", {
        raw: bytes.byteLength,
        gzip: gzipSync(bytes).byteLength,
      }, budgets.bg3dPhysicsWorker);
    }

    const eagerWebglIntro = matchingEntries(appKeys, /(?:IntroSplash|three\.module)/);
    if (eagerWebglIntro.length > 0) {
      fail(`optional WebGL intro returned to the app entry: ${eagerWebglIntro.join(", ")}`);
    }

    // --- entry modulepreload contract -------------------------------------
    // A <link rel="modulepreload"> is a highest-priority fetch on *every* route. The chunks below
    // are either route-specific engines or resolve behind an explicit fallback chain, so none of
    // them may sit on the entry document's critical path. Keep in sync with
    // ENTRY_PRELOAD_EXCLUSIONS in vite.config.ts.
    const entryPreloadExclusions = [
      "studio-konva-runtime",
      "StudioVrmPoser",
      "three.module",
      "three-vrm.module",
      "GLTFLoader",
      "lucide-studio-core-icons",
      "i18n",
    ];
    const entryHtmlPath = path.join(outputDirectory, "index.html");
    if (!fs.existsSync(entryHtmlPath)) {
      fail(`missing ${path.relative(process.cwd(), entryHtmlPath)}`);
    } else {
      const entryHtml = fs.readFileSync(entryHtmlPath, "utf8");
      const preloadedHrefs = [...entryHtml.matchAll(/<link[^>]*rel="modulepreload"[^>]*>/g)]
        .map((match) => /href="([^"]+)"/.exec(match[0])?.[1])
        .filter((href) => typeof href === "string");
      const leaked = preloadedHrefs.filter((href) =>
        entryPreloadExclusions.some((chunkName) => href.includes(chunkName)),
      );
      if (leaked.length > 0) {
        fail(
          `entry document modulepreloads excluded chunk(s): ${leaked.join(", ")} `
            + "(see ENTRY_PRELOAD_EXCLUSIONS in vite.config.ts)",
        );
      }
    }

    // --- no locale mega-dictionary in the shell ---------------------------
    // Every locale but ko/en ships as a lazy apps/web/public/i18n/app/<namespace>/<locale>.json asset. If the whole
    // DICT is ever inlined back into a shell chunk, the i18n chunk balloons past this cap long
    // before anyone notices the extra megabyte of parse work on the critical path.
    const i18nShellChunkCeilingBytes = 256 * 1024;
    for (const key of appKeys) {
      const entry = manifest[key];
      const fileName = path.basename(entry.file);
      if (!/(?:^|[-/])i18n[-.]/.test(fileName)) continue;
      const rawBytes = fs.statSync(path.join(outputDirectory, entry.file)).size;
      if (rawBytes > i18nShellChunkCeilingBytes) {
        fail(
          `app shell i18n chunk ${fileName} is ${formatKiB(rawBytes)} raw (cap ${formatKiB(i18nShellChunkCeilingBytes)}); `
            + "locale dictionaries belong in apps/web/public/i18n/app/<namespace>/<locale>.json, not the shell",
        );
      }
    }

    // Chunk counts the reference budgets never observed. They are the cheapest
    // signal for "a lazy boundary silently joined the eager graph".
    recordMeasurement("static", "Studio route chunks", "count", studioKeys.size);
    recordMeasurement("static", "app entry chunks", "count", appKeys.size);

    // Manifest file names of everything the static graph already accounts for.
    // Anything the browser downloads that is NOT in here arrived through a
    // dynamic import — the blind spot the runtime probe exists to measure.
    const staticClosureFileNames = new Set(
      [...studioKeys, ...appKeys].map((key) => path.basename(manifest[key].file)),
    );

    const runtimeReport = runtimeProbeRequested
      ? await probeRuntimeStartup(staticClosureFileNames)
      : null;
    if (runtimeReport) {
      for (const metric of runtimeReport.metrics) {
        recordMeasurement("runtime", metric.key, metric.kind, metric.value);
      }
    }

    reportBundleGate({
      runtimeReport,
      structuralSummary:
        `studio bundle structural check passed: Studio ${studioKeys.size} chunks, ${describe(studioSize.raw)} raw / ${describe(studioSize.gzip)} gzip; `
          + `StudioPage ${describe(studioEntrySize.raw)} raw / ${describe(studioEntrySize.gzip)} gzip; `
          + `after app shell ${studioIncrementalKeys.size} chunks, ${describe(studioIncrementalSize.raw)} raw / ${describe(studioIncrementalSize.gzip)} gzip; `
          + `app ${appKeys.size} chunks, ${describe(appSize.raw)} raw / ${describe(appSize.gzip)} gzip; `
          + `${bundleObservations.length} non-blocking size/request observation(s)`,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------
// Baseline I/O
// ---------------------------------------------------------------------------

/** Repo-relative when it lives in the repo, absolute when it does not. */
function baselineDisplayPath() {
  const relative = path.relative(process.cwd(), baselinePath);
  return relative.startsWith("..") ? baselinePath : relative;
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (parsed.schema !== baselineSchema) {
    throw new Error(
      `${baselineDisplayPath()} has schema ${JSON.stringify(parsed.schema)}, expected ${JSON.stringify(baselineSchema)}`,
    );
  }
  return parsed;
}

function writeBaseline({ previous, runtimeReport, tightenOnly }) { // NOSONAR javascript:S3776
  const nextStatic = { ...(previous?.static ?? {}) };
  let changed = 0;
  for (const measurement of measurements) {
    if (measurement.group !== "static") continue;
    const current = nextStatic[measurement.key];
    if (tightenOnly && typeof current === "number" && measurement.value >= current) continue;
    if (current !== measurement.value) changed += 1;
    nextStatic[measurement.key] = measurement.value;
  }

  let nextRuntime = previous?.runtime ?? null;
  if (runtimeReport) {
    const previousRuntimeMetrics = previous?.runtime?.metrics ?? {};
    const runtimeMetrics = { ...(tightenOnly ? previousRuntimeMetrics : {}) };
    for (const metric of runtimeReport.metrics) {
      const current = previousRuntimeMetrics[metric.key];
      if (tightenOnly && typeof current === "number" && metric.value >= current) continue;
      if (current !== metric.value) changed += 1;
      runtimeMetrics[metric.key] = metric.value;
    }
    nextRuntime = {
      recordedAt: new Date().toISOString(),
      probe: runtimeReport.probe,
      metrics: runtimeMetrics,
      // Hash-free module identities, so the list survives rebuilds and a diff
      // says *which* module became eager rather than only how many did.
      eagerDynamicChunks: runtimeReport.eagerChunks.map((chunk) => chunk.name).sort(),
    };
  }

  // Every number here can be re-derived by re-running the gate. The one thing that cannot is
  // the sentence a human wrote explaining *why* a regression was accepted — and rewriting
  // `note` wholesale destroyed exactly that on 2026-08-14, silently deleting the brush wave's
  // own accounting of its ~100 KiB. Regenerate the boilerplate, carry the rest.
  const generatedNote =
    "Last accepted measurement of scripts/check-studio-bundle.mjs. Regressions beyond the "
    + "tolerance fail the build; see docs/perf/bundle-gate.md. Regenerate with "
    + "UPDATE_BUNDLE_BASELINE=1 node scripts/check-studio-bundle.mjs.";
  const priorNote = typeof previous?.note === "string" ? previous.note : "";
  const authoredNote = priorNote.startsWith(generatedNote)
    ? priorNote.slice(generatedNote.length).trim()
    : priorNote.trim();

  const next = {
    schema: baselineSchema,
    recordedAt: new Date().toISOString(),
    note: authoredNote ? `${generatedNote} ${authoredNote}` : generatedNote,
    policy: {
      ...ratchetPolicy,
      authority: "scripts/check-studio-bundle.mjs (this file records the values only)",
    },
    static: nextStatic,
    runtime: nextRuntime,
  };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  return changed;
}

// ---------------------------------------------------------------------------
// Ratchet evaluation + report
// ---------------------------------------------------------------------------

function evaluateRatchet(group, baselineMetrics) {
  const rows = [];
  const seen = new Set();
  for (const measurement of measurements) {
    if (measurement.group !== group) continue;
    seen.add(measurement.key);
    const baselineValue = baselineMetrics?.[measurement.key];
    if (typeof baselineValue !== "number") {
      rows.push({ ...measurement, baselineValue: null, ceiling: null, status: "unbaselined" });
      continue;
    }
    const ceiling = ratchetCeiling(measurement.kind, baselineValue);
    const improvedFloor = measurement.kind === "count"
      ? baselineValue
      : Math.floor(baselineValue * (1 - ratchetPolicy.byteTolerance));
    let status;
    if (measurement.value > ceiling) status = "REGRESSED";
    else if (measurement.value < improvedFloor) status = "improved";
    else status = "ok";
    rows.push({ ...measurement, baselineValue, ceiling, status });
  }
  const stale = Object.keys(baselineMetrics ?? {}).filter((key) => !seen.has(key));
  return { rows, stale };
}

function ratchetTable(rows) {
  return renderTable(
    ["metric", "current", "baseline", "max allowed", "vs baseline", "status"],
    rows.map((row) => [
      row.key,
      formatMeasurement(row.kind, row.value),
      row.baselineValue === null ? "-" : formatMeasurement(row.kind, row.baselineValue),
      row.ceiling === null ? "-" : formatMeasurement(row.kind, row.ceiling),
      row.baselineValue === null ? "-" : formatRatio(row.value, row.baselineValue),
      row.status,
    ]),
  );
}

function reportReferenceOverages() {
  const overages = measurements
    .filter((measurement) => measurement.reference !== null && measurement.value > measurement.reference)
    .map((measurement) => ({
      ...measurement,
      ratio: measurement.value / measurement.reference,
    }))
    .sort((left, right) => right.ratio - left.ratio);

  console.log("");
  console.log(
    `reference budgets: ${overages.length} of ${measurements.filter((m) => m.reference !== null).length} measurements exceed their design reference`,
  );
  console.log(
    "  (references are telemetry, not release vetoes — the ratchet below is what fails the build)",
  );
  if (overages.length === 0) return;
  console.log(
    renderTable(
      ["item", "current", "reference", "ratio"],
      overages.map((overage) => [
        `  ${overage.key}`,
        formatMeasurement(overage.kind, overage.value),
        formatMeasurement(overage.kind, overage.reference),
        formatRatio(overage.value, overage.reference),
      ]),
    ),
  );
}

/**
 * The runtime block is the only measurement this gate cannot recompute from the manifest, so a
 * plain `check:studio-bundle` reprints it verbatim. That is how the 2026-08-13 static acceptance
 * shipped while the runtime numbers still described the 2026-08-10 build: the printed table looked
 * authoritative but was three days and one accepted static ratchet out of date. Say so out loud.
 */
function runtimeStalenessWarnings(baseline) {
  const recordedAt = Date.parse(baseline?.runtime?.recordedAt ?? "");
  if (!Number.isFinite(recordedAt)) return [];
  const warnings = [];
  const acceptedAt = Date.parse(baseline?.recordedAt ?? "");
  if (Number.isFinite(acceptedAt) && recordedAt < acceptedAt) {
    warnings.push(
      `studio bundle observation: the recorded startup measurement (${baseline.runtime.recordedAt}) `
        + `predates the last accepted static measurement (${baseline.recordedAt}). Static growth `
        + "accepted since then is invisible to the numbers printed above.",
    );
  }
  const ageDays = Math.floor((Date.now() - recordedAt) / 86_400_000);
  if (ageDays >= runtimeStalenessDays) {
    warnings.push(
      `studio bundle observation: the recorded startup measurement is ${ageDays} day(s) old `
        + `(staleness window ${runtimeStalenessDays} days).`,
    );
  }
  if (warnings.length > 0) {
    warnings.push(
      "  re-measure with \"node scripts/check-studio-bundle.mjs --runtime\" before trusting the "
        + "block above.",
    );
  }
  return warnings;
}

function reportRuntimeSection(runtimeReport, baseline) { // NOSONAR javascript:S3776
  console.log("");
  if (!runtimeReport) {
    const recorded = baseline?.runtime;
    if (!recorded) {
      console.log(
        "eager-dynamic: not measured (run `node scripts/check-studio-bundle.mjs --runtime` to record a baseline)",
      );
      return;
    }
    console.log(
      `eager-dynamic (last recorded ${recorded.recordedAt}, NOT re-measured this run — pass --runtime to re-measure)`,
    );
    console.log(
      renderTable(
        ["item", "recorded"],
        Object.entries(recorded.metrics).map(([key, value]) => [
          `  ${key}`,
          key.includes("bytes") ? formatKiB(value) : String(value),
        ]),
      ),
    );
    console.log(
      `  ${recorded.eagerDynamicChunks.length} module(s) declared dynamic in the manifest were loaded during startup with no user input`,
    );
    for (const warning of runtimeStalenessWarnings(baseline)) console.warn(warning);
    return;
  }

  console.log(
    `eager-dynamic (measured now: ${runtimeReport.probe.url}, settle ${runtimeReport.probe.settleMs} ms, `
      + `interactive ${runtimeReport.probe.interactiveMs ?? "n/a"} ms, crossOriginIsolated ${runtimeReport.probe.crossOriginIsolated})`,
  );
  console.log(
    renderTable(
      ["item", "measured"],
      runtimeReport.metrics.map((metric) => [
        `  ${metric.key}`,
        formatMeasurement(metric.kind, metric.value),
      ]),
    ),
  );
  const top = runtimeReport.eagerChunks.slice(0, 12);
  if (top.length > 0) {
    console.log("  heaviest chunks the manifest calls dynamic but startup loads anyway:");
    console.log(
      renderTable(
        ["chunk", "decoded", "arrived"],
        top.map((chunk) => [
          `    ${chunk.name}`,
          formatKiB(chunk.decodedBytes),
          `+${Math.round(chunk.startMs)} ms`,
        ]),
      ),
    );
  }
  const recordedNames = new Set(baseline?.runtime?.eagerDynamicChunks ?? []);
  if (recordedNames.size > 0) {
    const currentNames = new Set(runtimeReport.eagerChunks.map((chunk) => chunk.name));
    const added = [...currentNames].filter((name) => !recordedNames.has(name)).sort();
    const removed = [...recordedNames].filter((name) => !currentNames.has(name)).sort();
    if (added.length > 0) console.log(`  newly eager vs baseline: ${added.join(", ")}`);
    if (removed.length > 0) console.log(`  no longer eager vs baseline: ${removed.join(", ")}`);
    if (added.length === 0 && removed.length === 0) {
      console.log("  eager-dynamic module set is identical to the baseline");
    }
  }
}

function reportBundleGate({ runtimeReport, structuralSummary }) { // NOSONAR javascript:S3776
  const baseline = loadBaseline();

  for (const observation of bundleObservations) {
    console.warn(`studio bundle observation: ${observation}`);
  }
  reportReferenceOverages();

  console.log("");
  if (!baseline && !updateBaselineRequested) {
    fail(
      `missing ${baselineDisplayPath()}; create it with `
        + "\"UPDATE_BUNDLE_BASELINE=1 node scripts/check-studio-bundle.mjs\"",
    );
    return;
  }

  const staticRatchet = evaluateRatchet("static", baseline?.static);
  const runtimeRatchet = runtimeReport
    ? evaluateRatchet("runtime", baseline?.runtime?.metrics)
    : { rows: [], stale: [] };
  const rows = [...staticRatchet.rows, ...runtimeRatchet.rows];
  const regressions = rows.filter((row) => row.status === "REGRESSED");
  const improvements = rows.filter((row) => row.status === "improved");
  const unbaselined = rows.filter((row) => row.status === "unbaselined");

  console.log(
    `ratchet vs ${baselineDisplayPath()}`
      + (baseline ? ` (recorded ${baseline.recordedAt})` : " (new baseline)")
      + `: tolerance +${(ratchetPolicy.byteTolerance * 100).toFixed(0)}% bytes, `
      + `+${(ratchetPolicy.countTolerance * 100).toFixed(0)}%/${ratchetPolicy.countSlack} chunks`,
  );
  if (verboseReportRequested || regressions.length > 0 || unbaselined.length > 0) {
    console.log(ratchetTable(verboseReportRequested ? rows : [...regressions, ...unbaselined]));
  }
  console.log(
    `  ${rows.length - regressions.length - unbaselined.length} within baseline, `
      + `${improvements.length} improved, ${regressions.length} regressed, ${unbaselined.length} unbaselined`
      + (verboseReportRequested ? "" : " (pass --verbose for the full table)"),
  );
  if (staticRatchet.stale.length > 0) {
    console.log(`  baseline entries no longer measured: ${staticRatchet.stale.join(", ")}`);
  }

  reportRuntimeSection(runtimeReport, baseline);
  console.log("");

  if (updateBaselineRequested || tightenBaselineRequested) {
    const changed = writeBaseline({
      previous: baseline,
      runtimeReport,
      tightenOnly: !updateBaselineRequested,
    });
    console.log(
      `${updateBaselineRequested ? "baseline updated" : "baseline tightened"}: `
        + `${changed} value(s) rewritten in ${baselineDisplayPath()}`
        + (updateBaselineRequested && regressions.length > 0
          ? ` (${regressions.length} regression(s) explicitly accepted)`
          : ""),
    );
  } else {
    for (const row of regressions) {
      fail(
        `${row.key} regressed to ${formatMeasurement(row.kind, row.value)} `
          + `(baseline ${formatMeasurement(row.kind, row.baselineValue)}, `
          + `max allowed ${formatMeasurement(row.kind, row.ceiling)}, `
          + `${formatRatio(row.value, row.baselineValue)}); shrink it or accept it with `
          + "UPDATE_BUNDLE_BASELINE=1",
      );
    }
    for (const row of unbaselined) {
      fail(
        `${row.key} has no baseline entry; record it with UPDATE_BUNDLE_BASELINE=1`,
      );
    }
    if (improvements.length > 0) {
      console.log(
        `${improvements.length} measurement(s) improved — lock them in with TIGHTEN_BUNDLE_BASELINE=1`,
      );
    }
  }

  if (!process.exitCode) console.log(structuralSummary);
}

// ---------------------------------------------------------------------------
// Runtime probe: "declared dynamic, loaded anyway"
// ---------------------------------------------------------------------------
// A manifest cannot answer this. `checkDynamicBoundary` only proves a module is
// absent from the static graph, which an import awaited at mount satisfies just
// as well as one behind a button. The 2026-08-08 measurement found 55 such
// chunks (1,037 KiB) arriving within 1.1 s of a cold /studio entry. The only
// way to see them is to load the built bundle in a browser and diff what was
// actually fetched against the manifest closure — which is what this does.

async function waitForPreviewServer(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`vite preview exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`vite preview did not become reachable at ${baseUrl}`);
}

/**
 * Establish the returning-user state the measured pass depends on.
 *
 * Onboarding dismissal used to live in localStorage, which the init script above could seed
 * before navigation. It now lives in studio-ui-preferences-sqlite (OPFS), which no init script
 * can reach — so the only honest way to become a returning user is to *be* one: visit once,
 * dismiss, and let the write land. The measured pass then reuses this context, so the OPFS
 * database it wrote is still there.
 *
 * Failures here are deliberately swallowed. A warm-up that cannot dismiss still leaves the
 * measurement runnable, and the first-run assertion after the measured pass is what refuses to
 * let a contaminated number pass as clean.
 */
async function warmUpReturningUser(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/studio`, { waitUntil: "commit", timeout: 180_000 });
    await page.waitForSelector(".konvajs-content, canvas", { state: "attached", timeout: 120_000 });
    // The coach does not appear at first paint: its gate waits for the UI preference, work and
    // autosave hydrations, all of which resolve after the SQLite worker is up. Dismissing on the
    // canvas signal alone fires before the panel exists and silently changes nothing, so wait for
    // the panel's own dismiss control instead of a clock.
    const dismiss = await page.waitForSelector("[data-studio-quickstart-dismiss='true']", {
      state: "visible",
      timeout: 60_000,
    });
    await dismiss.click();
    // The dismissal persists through an async SQLite write; give it room to reach OPFS before
    // the context's next page asks for it.
    await page.waitForTimeout(3000);
  } catch {
    // Warm-up is best effort by design — see above.
  } finally {
    await page.close();
  }
}

async function probeRuntimeStartup(staticClosureFileNames) {
  const port = Number(process.env.STUDIO_BUNDLE_RUNTIME_PORT ?? 4288);
  const settleMs = Number(process.env.STUDIO_BUNDLE_RUNTIME_SETTLE_MS ?? 5000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const viteBin = path.resolve("node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteBin)) {
    throw new Error("--runtime needs node_modules/vite (install dependencies first)");
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("--runtime needs the playwright package (install dependencies first)");
  }

  const server = spawn(
    process.execPath,
    [
      viteBin,
      "preview",
      "--port",
      String(port),
      "--strictPort",
      // Bind explicitly: vite's default `localhost` resolves to ::1 on macOS,
      // which the IPv4 probe below would never reach.
      "--host",
      "127.0.0.1",
      "--outDir",
      outputDirectory,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const serverLog = [];
  server.stdout.on("data", (chunk) => serverLog.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverLog.push(String(chunk)));

  try {
    await waitForPreviewServer(baseUrl, server, 90_000).catch((error) => {
      throw new Error(`${error.message}\n${serverLog.join("").slice(-2000)}`);
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      // Resource Timing defaults to a 250-entry buffer; Studio blows past that.
      // The localStorage seeds are kept for older builds, but they are no longer the
      // authority: `quick-start-dismissed` and `mobile-hint-dismissed` moved into
      // studio-ui-preferences-sqlite, so writing the keys silently stopped dismissing
      // anything and every "returning user" number recorded since was a first-run tour.
      // The warm-up pass below is what actually establishes the returning-user state.
      await context.addInitScript(`(() => {
        try { performance.setResourceTimingBufferSize(3000); } catch {}
        try {
          localStorage.setItem(${JSON.stringify(runtimeQuickStartKey)}, "1");
          localStorage.setItem(${JSON.stringify(runtimeMobileHintKey)}, "1");
        } catch {}
      })();`);
      await warmUpReturningUser(context, baseUrl);
      const page = await context.newPage();
      const startedAt = Date.now();
      await page.goto(`${baseUrl}/studio`, { waitUntil: "commit", timeout: 180_000 });
      let interactiveMs = null;
      try {
        await page.waitForSelector(".konvajs-content, canvas", {
          state: "attached",
          timeout: 120_000,
        });
        interactiveMs = Date.now() - startedAt;
      } catch {
        // Record the probe anyway: a Studio that never paints is a different
        // failure, and the byte accounting is still the signal we want.
      }
      // Keep observing after first paint so mount-time dynamic imports that
      // resolve late are still attributed to "startup, no user input".
      await page.waitForTimeout(settleMs);

      const observed = await page.evaluate(() => ({
        crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
        resources: performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          startMs: entry.startTime,
          decodedBytes: entry.decodedBodySize,
        })),
      }));

      const scripts = observed.resources
        .map((resource) => ({ ...resource, fileName: resourceFileName(resource.name) }))
        .filter((resource) => resource.fileName.endsWith(".js"));

      const eager = scripts
        .filter((resource) => !staticClosureFileNames.has(resource.fileName))
        .map((resource) => ({
          name: chunkIdentity(resource.fileName),
          file: resource.fileName,
          decodedBytes: resource.decodedBytes,
          startMs: resource.startMs,
        }))
        .sort((left, right) => right.decodedBytes - left.decodedBytes);

      const sum = (records) => records.reduce((total, record) => total + record.decodedBytes, 0);
      // The warm-up is best effort, so this is the part that must not be. A number that
      // silently describes onboarding is worse than no number: it reads as authoritative
      // and it moves the ratchet.
      const firstRunLeaks = eager.filter((chunk) =>
        runtimeFirstRunOnlyChunks.some((name) => chunk.name.startsWith(name)),
      );
      if (firstRunLeaks.length > 0) {
        console.warn(
          "studio bundle observation: the startup measurement below still contains first-run "
            + `onboarding (${firstRunLeaks.map((chunk) => chunk.name).join(", ")}). It describes a `
            + "new visitor, not the returning user the probe reports, so its requests and bytes are "
            + "inflated by code a returning user never fetches.",
        );
      }
      return {
        probe: {
          url: "/studio",
          settleMs,
          viewport: "1440x900",
          interactiveMs,
          crossOriginIsolated: observed.crossOriginIsolated,
          returningUser: firstRunLeaks.length === 0,
        },
        metrics: [
          { key: "startup JS requests", kind: "count", value: scripts.length },
          { key: "startup JS decoded bytes", kind: "bytes", value: sum(scripts) },
          { key: "eager-dynamic requests", kind: "count", value: eager.length },
          { key: "eager-dynamic decoded bytes", kind: "bytes", value: sum(eager) },
        ],
        eagerChunks: eager,
      };
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}
