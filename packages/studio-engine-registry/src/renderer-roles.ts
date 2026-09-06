/**
 * Studio 렌더러/엔진 역할 원장 (machine-checked).
 *
 * 문제: 이 저장소에는 Konva, Canvas2D, Pixi, Vello(Classic GPU / CPU / Hybrid),
 * 전용 WebGPU 브러시, Hokusai WASM, libmypaint WASM, CanvasKit, p5.brush,
 * perfect-freehand, roughjs, Paper.js, Three, Babylon 등 렌더러가 공존한다.
 * 어떤 엔진이 "지금 무엇을 실제로 소유하는가"가 산문 문서에만 있었고, 그 산문이
 * 코드보다 먼저 낡았다(예: 사용자 매뉴얼의 "WebGPU 기반 캔버스" 서술).
 *
 * 이 파일이 단일 진실 원천이다.
 *
 * - 모든 product authority 는 정확히 하나의 `primary` 소유자를 가진다.
 *   (예외는 RENDERER_AUTHORITIES_WITHOUT_PRIMARY 에 이유와 함께 명시한다.)
 * - `lab` 엔진은 제품 import 사이트가 0건임을 스캐너로 증명한다.
 * - `docs/engines/renderer-roles.md` 는 이 원장에서 생성되며, 드리프트하면
 *   테스트가 깨진다.
 *
 * 역할(role) 정의 — 두 축이 아니라 하나의 축이다.
 * - `primary`   제품 authority 를 단독으로 소유한다. 오늘의 기본 엔진.
 * - `provider`  제품에 배선돼 있지만 명시적으로 선택되는 게이트형 엔진.
 *               단독 authority 는 없다.
 * - `reference` 제품 픽셀 경로에 없다. parity/golden/비교 전용.
 * - `lab`       구현은 있으나 제품 호출부가 0건이다. 스캐너가 강제한다.
 */

export type RendererRole = "primary" | "provider" | "reference" | "lab";

/**
 * 제품 권위(authority)의 닫힌 집합. 새 authority 를 추가하려면 소유자
 * `primary` 를 함께 정하거나 RENDERER_AUTHORITIES_WITHOUT_PRIMARY 에 이유를
 * 남겨야 한다.
 */
export type RendererAuthority =
  | "document-display"
  | "pointer-input"
  | "selection-transform-chrome"
  | "raster-brush-commit"
  | "document-vector-island"
  | "selection-overlay-island"
  | "natural-media"
  | "image-filter-island"
  | "stroke-geometry"
  | "shape-sketch"
  | "path-ops-quality"
  | "scene-3d"
  | "scene-3d-specialist";

export const RENDERER_AUTHORITIES: readonly RendererAuthority[] = Object.freeze([
  "document-display",
  "pointer-input",
  "selection-transform-chrome",
  "raster-brush-commit",
  "document-vector-island",
  "selection-overlay-island",
  "natural-media",
  "image-filter-island",
  "stroke-geometry",
  "shape-sketch",
  "path-ops-quality",
  "scene-3d",
  "scene-3d-specialist",
] as const);

export interface RendererRoleEntry {
  readonly id: string;
  readonly displayName: string;
  readonly role: RendererRole;
  /** 승격 목표. 현재 role 과 같으면 invariant 위반(목표가 아니라 현재다). */
  readonly targetRole?: RendererRole;
  /** `primary` 만 authority 를 가질 수 있다. */
  readonly authorities: readonly RendererAuthority[];
  /** repo-relative 경로. 테스트가 디스크 존재를 확인한다. */
  readonly evidence: readonly string[];
  /** import 스캔용 npm specifier 또는 workspace 패키지 이름. */
  readonly moduleSpecifiers: readonly string[];
  /** `lab` 엔진에서 제품 호출부가 0건이어야 하는 export 심볼 이름. */
  readonly productSymbols?: readonly string[];
  /** src/manifest/providers.json 의 E01~E28 후보 조사 id. */
  readonly candidateId?: string;
  readonly adr?: string;
  readonly note: string;
}

export interface RendererAuthorityWithoutPrimary {
  readonly authority: RendererAuthority;
  readonly reason: string;
}

/**
 * 소유자 없는 authority. 여기 있는 항목은 "아직 아무도 primary 가 아니다"를
 * 명시적으로 선언한 것이며, 침묵으로 비어 있는 것과 구별된다.
 */
export const RENDERER_AUTHORITIES_WITHOUT_PRIMARY:
  readonly RendererAuthorityWithoutPrimary[] = Object.freeze([
    Object.freeze({
      authority: "image-filter-island" as const,
      reason:
        "필터 island 는 렌더러가 아니라 planner 가 작업 단위로 provider 를 하나 "
        + "고른다(src/domains/creator/filter/studio-filter-island-plan.ts 의 "
        + "one-provider planning boundary). WebGPU/dedicated worker/WASM 레인은 "
        + "packages/studio-engine-registry/src/filter-providers.ts 의 descriptor 로 "
        + "등록되므로, 이 원장의 어떤 단일 렌더러도 상시 소유자가 아니다.",
    }),
  ]);

/**
 * 현재 상태 원장. 각 항목의 판정은 evidence 경로의 실제 코드에서 나왔고,
 * 산문 문서는 보조 근거로만 쓴다.
 */
export const STUDIO_RENDERER_ROLE_LEDGER: readonly RendererRoleEntry[] =
  Object.freeze([
    Object.freeze({
      id: "konva",
      displayName: "Konva / react-konva",
      role: "primary" as const,
      authorities: Object.freeze([
        "document-display" as const,
        "pointer-input" as const,
        "selection-transform-chrome" as const,
      ]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/canvas/StudioCanvasViewport.tsx",
        "apps/web/src/domains/creator/canvas/StudioCanvasViewportStageHost.tsx",
      ]),
      moduleSpecifiers: Object.freeze(["konva", "react-konva"]),
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "Konva `<Stage>` 가 문서 표시와 pointer 입력, 선택/변형 chrome 을 소유한다. "
        + "ADR-0018 은 Konva 를 제거 후보로 두지만 현재 단계에서는 입력·hit-test 와 "
        + "선택/변형 chrome 경계를 계속 맡는다.",
    }),
    Object.freeze({
      id: "canvas2d-draw-node",
      displayName: "Canvas2D StudioDrawNode (Konva 노드)",
      role: "primary" as const,
      authorities: Object.freeze(["raster-brush-commit" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/brush/StudioDrawNode.tsx",
        "apps/web/src/domains/creator/brush/studio-stroke-route-tournament.ts",
        "apps/web/src/domains/creator/brush/studio-stroke-surface-route.ts",
      ]),
      moduleSpecifiers: Object.freeze([]),
      note:
        "fail-visible 종단 경로. pointer-down admission gate 는 living-ink → hokusai "
        + "→ stamp → gpu → live-ink → wet-ink → dynamic → konva 순으로 레인을 고르고, "
        + "마지막 `konva` 레인이 Konva 호스트 위 Canvas2D 커밋이다. 획 시작 시 하나로 "
        + "고정되며(ADR-0018) 실패해도 다른 레인으로 넘기지 않는다.",
    }),
    Object.freeze({
      id: "webgpu-brush-runtime",
      displayName: "전용 WebGPU 브러시 런타임",
      role: "provider" as const,
      targetRole: "primary" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-engine-webgpu-brush-runtime.ts",
        "apps/web/src/domains/creator/render/studio-engine-vnext-brush-provider-gpu-boundary.ts",
        "apps/web/src/domains/creator/render/studio-engine-webgpu-tile-provider-v1.ts",
      ]),
      moduleSpecifiers: Object.freeze([]),
      candidateId: "E28",
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "stroke route 의 `gpu` 레인. 2026-09-02 아키텍처 리뷰의 목표는 이 런타임이 "
        + "raster-brush-commit 의 primary 가 되는 것이지만, 오늘은 명시 선택형 "
        + "provider 이고 종단 커밋 권위는 Canvas2D 가 가진다.",
    }),
    Object.freeze({
      id: "hokusai-wasm",
      displayName: "Hokusai WASM (Rust 자연매체)",
      role: "primary" as const,
      authorities: Object.freeze(["natural-media" as const]),
      evidence: Object.freeze([
        "packages/studio-hokusai-wasm",
        "apps/web/src/domains/creator/render/studio-hokusai-natural-media.worker.ts",
        "apps/web/src/domains/creator/render/studio-hokusai-live-brush.worker.ts",
      ]),
      moduleSpecifiers: Object.freeze(["@toonspectrum/studio-hokusai-wasm"]),
      candidateId: "E12",
      note:
        "자연매체(연필·목탄·유화·수채) 권위. `.myb` 페이로드가 provider-native 정본이며 "
        + "Dedicated Worker 가 pkg/studio_hokusai_wasm.js 를 동적 import 한다. "
        + "stroke route 의 `hokusai` 레인.",
    }),
    Object.freeze({
      id: "libmypaint-wasm",
      displayName: "libmypaint WASM",
      role: "reference" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "packages/studio-brush-platform/src/libmypaint/index.ts",
        "packages/studio-brush-platform/src/__tests__/libmypaint-parity.test.ts",
      ]),
      moduleSpecifiers: Object.freeze([]),
      productSymbols: Object.freeze(["loadLibMypaint"]),
      candidateId: "E11",
      note:
        "Hokusai 자연매체 dab 수학의 parity/golden 기준. `apps/web/src/` 에서 "
        + "`loadLibMypaint` 호출부는 0건이고, src 의 libmypaint 언급은 커널 출처 "
        + "문자열(.myb 레시피 attribution)뿐이다.",
    }),
    Object.freeze({
      id: "canvaskit",
      displayName: "Skia / CanvasKit (WebGL 빌드)",
      role: "primary" as const,
      authorities: Object.freeze(["path-ops-quality" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-canvaskit-adapter.ts",
        "apps/web/src/domains/creator/render/studio-canvaskit-quality-engine.ts",
        "apps/web/src/domains/creator/studio-quality-worker-entry.ts",
      ]),
      moduleSpecifiers: Object.freeze(["canvaskit-wasm"]),
      candidateId: "E01",
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "Skia PathOps / stroke expansion 품질 엔진으로 Worker 에 배선돼 있다. 문서나 "
        + "라이브 프레임 권위가 아니다. 고정된 canvaskit-wasm@0.41.1 은 WebGL 빌드이고 "
        + "GPU island 은 ADR-0018 기준 probe-only 다. 저장 문서에는 CanvasKit 객체나 "
        + "WASM 포인터가 남지 않는다(portable SVG path data 왕복).",
    }),
    Object.freeze({
      id: "vello-cpu",
      displayName: "Vello CPU",
      role: "reference" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "packages/studio-engine-vello",
        "crates/studio-engine-vello",
        "docs/engines/vello-baseline.md",
      ]),
      moduleSpecifiers: Object.freeze([]),
      candidateId: "E04",
      note:
        "결정적 벡터 기준. cross-renderer diff, golden image, 명시 선택 CPU "
        + "reference 로만 쓰인다. ADR-0018 §13 에 따라 GPU 실패 뒤 자동으로 호출되지 "
        + "않는다.",
    }),
    Object.freeze({
      id: "vello-classic-gpu",
      displayName: "Vello Classic GPU (studio-vello-hub)",
      role: "primary" as const,
      authorities: Object.freeze(["document-vector-island" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-vello-hub.ts",
        "apps/web/src/domains/creator/render/studio-vello-hub-capability.ts",
        "apps/web/src/domains/creator/render/studio-vello-hub-surface.tsx",
        "apps/web/src/domains/creator/render/studio-vello-hub-canvas-target.ts",
      ]),
      moduleSpecifiers: Object.freeze([]),
      candidateId: "E02",
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "`studio-vello-hub-document-hybrid-v13` capability 는 기본 활성이고 scope 는 "
        + "`document-vector-hybrid`, documentAuthority=true, inputAuthority=false, "
        + "brushPixelAuthority=false, canonicalDocumentAuthority=false 다. "
        + "productWidePromotionRequiresSoak=true, persistentWinnerStorage=false 이므로 "
        + "전체 문서 컷오버가 아니다. ADR-0018 은 Vello WebGPU/WASM 을 2D 문서 픽셀 "
        + "권위의 목표 엔진으로 두고, 자동 폴백을 금지한다.",
    }),
    Object.freeze({
      id: "vello-hybrid-sparse",
      displayName: "Vello Hybrid sparse-strip GPU (upstream)",
      role: "lab" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-vello-hub-capability.ts",
      ]),
      moduleSpecifiers: Object.freeze(["vello_hybrid"]),
      candidateId: "E03",
      note:
        "`STUDIO_VELLO_HYBRID_SPARSE_CANDIDATE` 는 status=`unavailable-upstream-api`, "
        + "eligible=false 다. 고정된 vello 0.9 Classic 브라우저 아티팩트가 upstream "
        + "vello_hybrid 0.2 sparse-strip GPU 를 채택하지 않았다. 제품의 \"V13 Hybrid\" 는 "
        + "이 크레이트가 아니라 Classic + StudioFrameGraphCompositor 다.",
    }),
    Object.freeze({
      id: "velato-lottie",
      displayName: "Velato (Vello Lottie)",
      role: "lab" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "packages/studio-engine-vello/src/lottie.ts",
        "crates/studio-engine-vello/Cargo.toml",
      ]),
      moduleSpecifiers: Object.freeze([]),
      productSymbols: Object.freeze(["renderLottieToPixelsGpu"]),
      candidateId: "E14",
      note:
        "Rust `lottie` feature 가 Lottie JSON 을 Vello scene 으로 낮추고 TS 가 "
        + "`renderLottieToPixelsGpu()` 를 export 하지만, 비테스트 `apps/web/src/`·`apps/` 에 "
        + "호출부가 0건이다. 현재 Studio Lottie 표면은 Velato 를 쓰지 않는다.",
    }),
    Object.freeze({
      id: "wesl",
      displayName: "WESL shader linker",
      role: "lab" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "packages/studio-engine-registry/src/wesl-compile.ts",
      ]),
      moduleSpecifiers: Object.freeze(["wesl"]),
      productSymbols: Object.freeze(["compileWeslVariant"]),
      note:
        "`compileWeslVariant()` 가 `*.wesl?raw`, `link()`, `@if`, virtual schedule "
        + "module 로 WGSL variant 를 만들지만 비테스트 `apps/web/src/` 호출부가 0건이다. "
        + "제품 shader 기본은 정적 WGSL / 기존 생성기다.",
    }),
    Object.freeze({
      id: "pixi",
      displayName: "PixiJS",
      role: "primary" as const,
      authorities: Object.freeze(["selection-overlay-island" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-pixi-scene-provider.ts",
        "apps/web/src/domains/creator/StudioPixiSceneOverlayHost.tsx",
      ]),
      moduleSpecifiers: Object.freeze(["pixi.js"]),
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "Konva stage 위에 상시 마운트되는 선택 가능 scene 오버레이 호스트. 투명하고 "
        + "pointer-events:none 이라 브러시 픽셀이나 hit-test 권위를 갖지 않는다. "
        + "ADR-0018 §7 에 따라 호출자가 WebGPU 또는 WebGL 중 하나만 허용 목록으로 "
        + "넘긴다(현재 제품 호스트는 WebGPU 명시 선택). 선택이 비면 렌더러를 아예 "
        + "만들지 않는다.",
    }),
    Object.freeze({
      id: "p5-brush",
      displayName: "p5.brush standalone",
      role: "provider" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/brush/studio-p5-brush-standalone-runtime-adapter.ts",
        "apps/web/src/domains/creator/studio-procedural-artistic-brush-provider.ts",
      ]),
      moduleSpecifiers: Object.freeze(["p5.brush"]),
      note:
        "절차적 아티스틱 브러시(수채 fill, flowfield)의 게이트형 provider. Dedicated "
        + "Worker 안 private OffscreenCanvas 에서만 `p5.brush/standalone` 을 동적 "
        + "import 하며, 계약 모듈 자체는 라이브러리 없이 컴파일된다. CI 잡 "
        + "`verify:studio-p5-brush-real-runtime` 가 실런타임을 검증한다.",
    }),
    Object.freeze({
      id: "perfect-freehand",
      displayName: "perfect-freehand",
      role: "primary" as const,
      authorities: Object.freeze(["stroke-geometry" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/studio-perfect-freehand.ts",
        "apps/web/src/domains/creator/hybrid-dcc/studio-hybrid-brush-filter-edit-runtime.ts",
      ]),
      moduleSpecifiers: Object.freeze(["perfect-freehand"]),
      candidateId: "E10",
      note:
        "`getStroke()` 로 pressure outline 을 만드는 결정적 stroke 기하 소유자. "
        + "정적 import 이며 hybrid-DCC 브러시/필터 편집 런타임도 같은 경로를 쓴다.",
    }),
    Object.freeze({
      id: "roughjs",
      displayName: "Rough.js",
      role: "primary" as const,
      authorities: Object.freeze(["shape-sketch" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/studio-rough-shape.ts",
        "apps/web/src/domains/creator/studio-rough-svg-parity.ts",
      ]),
      moduleSpecifiers: Object.freeze(["roughjs"]),
      note:
        "손그림 느낌 도형(sketch presentation) 전용 소유자. generator 는 "
        + "`import(\"roughjs/bin/generator\")` 로 지연 로드되고, SVG parity 모듈이 "
        + "같은 generator 로 출력 동등성을 확인한다.",
    }),
    Object.freeze({
      id: "paper-js",
      displayName: "Paper.js",
      role: "provider" as const,
      authorities: Object.freeze([]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/render/studio-engine-vector-geometry-provider.ts",
      ]),
      moduleSpecifiers: Object.freeze(["paper"]),
      note:
        "벡터 기하 provider 안에서 지연 로드되는 경로 연산 백엔드다(`paperLibraryPromise "
        + "??= import(\"paper\")`). 값 import 가 아니라 타입 import + 동적 import 라서 "
        + "초기 정적 그래프를 오염시키지 않는다. 단독 authority 는 없다 — 2026-09-02 "
        + "리뷰 시점에 \"의존성만 있고 호출부 없음\"으로 알려졌으나 실제로는 제품 호출부가 "
        + "있어 lab 이 아니라 provider 로 판정한다.",
    }),
    Object.freeze({
      id: "three",
      displayName: "Three.js + @pixiv/three-vrm",
      role: "primary" as const,
      authorities: Object.freeze(["scene-3d" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/vrm",
        "apps/web/src/domains/creator/bg3d",
        "apps/web/src/domains/creator/studio-background-3d-model.ts",
      ]),
      moduleSpecifiers: Object.freeze([
        "three",
        "@pixiv/three-vrm",
        "three-mesh-bvh",
      ]),
      candidateId: "E21",
      note:
        "3D 장면·VRM 마네킹·raycast·표면 페인트의 기본 소유자. VRM 표면 브러시는 "
        + "R3F pointer workflow 로 bounded transaction 을 만든다.",
    }),
    Object.freeze({
      id: "babylon",
      displayName: "Babylon.js",
      role: "primary" as const,
      authorities: Object.freeze(["scene-3d-specialist" as const]),
      evidence: Object.freeze([
        "apps/web/src/domains/creator/bg3d/studio-bg3d-babylon-specialist-entry.ts",
        "apps/web/src/domains/creator/bg3d/studio-bg3d-babylon-normal-capture.ts",
        "apps/web/src/domains/creator/bg3d/studio-bg3d-babylon-artifact-capture.ts",
      ]),
      moduleSpecifiers: Object.freeze(["@babylonjs/core", "@babylonjs/loaders"]),
      adr: "docs/adr/0018-no-automatic-engine-fallback-vello-primary.md",
      note:
        "normal/stable-id/artifact capture 같은 전문 pass 의 명시 진입점. ADR-0018 §6 "
        + "에 따라 Three 실패 뒤 자동으로 mount 되지 않는 독립 엔진이다.",
    }),
  ]);

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

const ROLES_WITHOUT_AUTHORITY: readonly RendererRole[] = Object.freeze([
  "provider",
  "reference",
  "lab",
]);

/**
 * 순수 검사기. 실패를 던지지 않고 사람이 읽을 수 있는 이슈 문자열 배열을 돌려준다.
 */
export function rendererRoleLedgerInvariants(
  ledger: readonly RendererRoleEntry[],
  authoritiesWithoutPrimary: readonly RendererAuthorityWithoutPrimary[] =
    RENDERER_AUTHORITIES_WITHOUT_PRIMARY,
): readonly string[] {
  const issues: string[] = [];

  const seenIds = new Set<string>();
  for (const entry of ledger) {
    if (seenIds.has(entry.id)) {
      issues.push(`duplicate ledger id: ${entry.id}`);
    }
    seenIds.add(entry.id);

    if (entry.evidence.length === 0) {
      issues.push(`${entry.id}: evidence must not be empty`);
    }
    if (entry.note.trim().length === 0) {
      issues.push(`${entry.id}: note must not be empty`);
    }
    if (entry.targetRole !== undefined && entry.targetRole === entry.role) {
      issues.push(
        `${entry.id}: targetRole "${entry.targetRole}" equals current role; omit it`,
      );
    }
    if (entry.candidateId !== undefined && !/^E\d{2}$/.test(entry.candidateId)) {
      issues.push(
        `${entry.id}: candidateId "${entry.candidateId}" must match /^E\\d{2}$/`,
      );
    }
    if (
      ROLES_WITHOUT_AUTHORITY.includes(entry.role)
      && entry.authorities.length > 0
    ) {
      issues.push(
        `${entry.id}: role "${entry.role}" must not own authorities `
        + `(${entry.authorities.join(", ")})`,
      );
    }
    if (entry.role === "primary" && entry.authorities.length === 0) {
      issues.push(`${entry.id}: role "primary" must own at least one authority`);
    }
    if (
      entry.role === "lab"
      && entry.moduleSpecifiers.length === 0
      && (entry.productSymbols?.length ?? 0) === 0
    ) {
      issues.push(
        `${entry.id}: lab entry must declare a scannable identity `
        + `(moduleSpecifiers or productSymbols)`,
      );
    }
    const seenAuthorities = new Set<RendererAuthority>();
    for (const authority of entry.authorities) {
      if (seenAuthorities.has(authority)) {
        issues.push(`${entry.id}: duplicate authority ${authority}`);
      }
      seenAuthorities.add(authority);
    }
  }

  const unowned = new Set(
    authoritiesWithoutPrimary.map((declaration) => declaration.authority),
  );
  for (const declaration of authoritiesWithoutPrimary) {
    if (declaration.reason.trim().length === 0) {
      issues.push(
        `${declaration.authority}: unowned declaration needs a reason`,
      );
    }
  }

  for (const authority of RENDERER_AUTHORITIES) {
    const owners = ledger.filter(
      (entry) => entry.role === "primary" && entry.authorities.includes(authority),
    );
    if (unowned.has(authority)) {
      if (owners.length > 0) {
        issues.push(
          `${authority}: declared unowned but owned by `
          + `${owners.map((entry) => entry.id).join(", ")}`,
        );
      }
      continue;
    }
    if (owners.length !== 1) {
      issues.push(
        `${authority}: expected exactly 1 primary owner, found ${owners.length}`
        + (owners.length > 0
          ? ` (${owners.map((entry) => entry.id).join(", ")})`
          : "; list it in RENDERER_AUTHORITIES_WITHOUT_PRIMARY with a reason"),
      );
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Lab import scanner (filesystem-agnostic)                            */
/* ------------------------------------------------------------------ */

export interface LabEngineProductImportViolation {
  readonly entryId: string;
  readonly file: string;
  readonly specifierOrSymbol: string;
}

export interface FindLabEngineProductImportsOptions {
  /** 스캔할 루트들(예: ["src", "apps"]). */
  readonly roots: readonly string[];
  readonly ledger: readonly RendererRoleEntry[];
  /** 파일 내용을 돌려준다. */
  readonly readFile: (file: string) => string;
  /** 루트 하위 파일 경로를 모두 열거한다(재귀). */
  readonly listFiles: (root: string) => readonly string[];
}

const PRODUCT_SOURCE_EXTENSIONS: readonly string[] = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
]);

const TEST_FILE_PATTERN = /\.(test|spec|stories)\.[cm]?tsx?$/;
const TEST_DIRECTORY_PATTERN = /(^|[\\/])__tests__[\\/]/;

/** 제품 소스 파일인지(테스트·스토리 제외). */
export function isRendererRoleProductSourceFile(file: string): boolean {
  if (!PRODUCT_SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))) {
    return false;
  }
  if (TEST_DIRECTORY_PATTERN.test(file)) return false;
  if (TEST_FILE_PATTERN.test(file)) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importPatternFor(specifier: string): RegExp {
  const escaped = escapeRegExp(specifier);
  // `from "x"`, `import("x")`, `require("x")`, `import "x"` 그리고 subpath.
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)`
    + String.raw`["'](${escaped}(?:/[^"']*)?)["']`,
  );
}

function symbolPatternFor(symbol: string): RegExp {
  return new RegExp(String.raw`\b${escapeRegExp(symbol)}\b`);
}

/**
 * `lab` 항목의 제품 호출부를 찾는다. fs 를 주입받으므로 테스트에서 가짜
 * 파일 시스템으로도, 제품 경계 테스트에서 실제 fs 로도 돌릴 수 있다.
 */
export function findLabEngineProductImports(
  options: FindLabEngineProductImportsOptions,
): readonly LabEngineProductImportViolation[] {
  const labEntries = options.ledger.filter((entry) => entry.role === "lab");
  if (labEntries.length === 0) return Object.freeze([]);

  const probes = labEntries.flatMap((entry) => [
    ...entry.moduleSpecifiers.map((specifier) => ({
      entryId: entry.id,
      label: specifier,
      pattern: importPatternFor(specifier),
    })),
    ...(entry.productSymbols ?? []).map((symbol) => ({
      entryId: entry.id,
      label: symbol,
      pattern: symbolPatternFor(symbol),
    })),
  ]);
  if (probes.length === 0) return Object.freeze([]);

  const violations: LabEngineProductImportViolation[] = [];
  const scanned = new Set<string>();
  for (const root of options.roots) {
    for (const file of options.listFiles(root)) {
      if (scanned.has(file)) continue;
      scanned.add(file);
      if (!isRendererRoleProductSourceFile(file)) continue;
      const source = options.readFile(file);
      for (const probe of probes) {
        if (probe.pattern.test(source)) {
          violations.push({
            entryId: probe.entryId,
            file,
            specifierOrSymbol: probe.label,
          });
        }
      }
    }
  }
  return Object.freeze(violations);
}

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

const ROLE_ORDER: readonly RendererRole[] = Object.freeze([
  "primary",
  "provider",
  "reference",
  "lab",
]);

const ROLE_LABEL: Readonly<Record<RendererRole, string>> = Object.freeze({
  primary: "primary (단독 소유)",
  provider: "provider (명시 선택)",
  reference: "reference (비교 전용)",
  lab: "lab (제품 호출부 0)",
});

export const RENDERER_ROLES_DOC_PATH = "docs/engines/renderer-roles.md" as const;
export const RENDERER_ROLES_GENERATOR_PATH =
  "scripts/generate-studio-renderer-roles.mts" as const;
export const RENDERER_ROLES_LEDGER_PATH =
  "packages/studio-engine-registry/src/renderer-roles.ts" as const;

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function codeList(values: readonly string[]): string {
  if (values.length === 0) return "—";
  return values.map((value) => `\`${cell(value)}\``).join("<br>");
}

function sortedLedger(
  ledger: readonly RendererRoleEntry[],
): readonly RendererRoleEntry[] {
  return [...ledger].sort((a, b) => {
    const roleDelta = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (roleDelta !== 0) return roleDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 원장 → 문서 본문. 순수 함수이며 같은 입력에 항상 같은 문자열을 준다.
 * 날짜·환경·랜덤을 넣지 않는다(드리프트 가드가 이걸 비교한다).
 */
export function renderRendererRoleLedgerMarkdown(
  ledger: readonly RendererRoleEntry[] = STUDIO_RENDERER_ROLE_LEDGER,
  authoritiesWithoutPrimary: readonly RendererAuthorityWithoutPrimary[] =
    RENDERER_AUTHORITIES_WITHOUT_PRIMARY,
): string {
  const lines: string[] = [];

  lines.push(
    `<!-- GENERATED FILE — DO NOT EDIT BY HAND. -->`,
    `<!-- Source of truth: ${RENDERER_ROLES_LEDGER_PATH} (STUDIO_RENDERER_ROLE_LEDGER) -->`,
    `<!-- Regenerate: pnpm generate:studio-renderer-roles -->`,
    `<!-- Verify: pnpm verify:studio-renderer-roles -->`,
    ``,
    `# Studio 렌더러/엔진 역할 원장`,
    ``,
    `이 문서는 손으로 쓰지 않는다. \`${RENDERER_ROLES_LEDGER_PATH}\` 의`,
    `\`STUDIO_RENDERER_ROLE_LEDGER\` 에서 \`${RENDERER_ROLES_GENERATOR_PATH}\` 가 생성하며,`,
    `디스크 내용이 원장과 다르면 테스트가 깨진다. 엔진 역할을 바꾸려면 문서가 아니라`,
    `원장을 고쳐야 한다.`,
    ``,
    `## 역할 정의`,
    ``,
    `| 역할 | 뜻 |`,
    `| --- | --- |`,
    `| \`primary\` | 제품 권위(authority)를 단독으로 소유한다. 오늘의 기본 엔진. |`,
    `| \`provider\` | 제품에 배선돼 있지만 명시적으로 선택되는 게이트형 엔진. 단독 권위 없음. |`,
    `| \`reference\` | 제품 픽셀 경로에 없다. parity/golden/비교 전용. |`,
    `| \`lab\` | 구현은 있으나 제품 호출부가 0건이다. import 스캐너가 강제한다. |`,
    ``,
    `기계 검사 불변식:`,
    ``,
    `1. 모든 권위는 정확히 하나의 \`primary\` 소유자를 가진다(아래 "소유자 없는 권위" 예외).`,
    `2. \`provider\`/\`reference\`/\`lab\` 은 권위를 가질 수 없다.`,
    `3. \`lab\` 엔진의 모듈 지정자·심볼은 \`apps/web/src/\`, \`apps/\` 비테스트 소스에 0건이어야 한다.`,
    `4. 모든 근거 경로는 디스크에 실제로 존재해야 한다.`,
    ``,
    `## 원장`,
    ``,
    `| id | 역할 | 목표 역할 | 권위 | 근거 경로 | 후보ID | 비고 |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
  );

  for (const entry of sortedLedger(ledger)) {
    lines.push(
      `| \`${cell(entry.id)}\`<br>${cell(entry.displayName)} `
      + `| ${ROLE_LABEL[entry.role]} `
      + `| ${entry.targetRole === undefined ? "—" : ROLE_LABEL[entry.targetRole]} `
      + `| ${codeList(entry.authorities)} `
      + `| ${codeList(entry.evidence)} `
      + `| ${entry.candidateId === undefined ? "—" : `\`${cell(entry.candidateId)}\``} `
      + `| ${cell(entry.note)} |`,
    );
  }

  lines.push(``, `## 권위별 단독 소유자`, ``, `| 권위 | primary 소유자 |`, `| --- | --- |`);
  const unowned = new Map(
    authoritiesWithoutPrimary.map((declaration) => [
      declaration.authority,
      declaration.reason,
    ]),
  );
  for (const authority of RENDERER_AUTHORITIES) {
    if (unowned.has(authority)) continue;
    const owners = ledger
      .filter(
        (entry) => entry.role === "primary" && entry.authorities.includes(authority),
      )
      .map((entry) => `\`${cell(entry.id)}\``);
    lines.push(
      `| \`${cell(authority)}\` | ${owners.length === 0 ? "**없음(불변식 위반)**" : owners.join(", ")} |`,
    );
  }

  lines.push(``, `## 소유자 없는 권위`, ``);
  if (unowned.size === 0) {
    lines.push(`없음. 모든 권위에 단독 \`primary\` 소유자가 있다.`);
  } else {
    lines.push(`| 권위 | 이유 |`, `| --- | --- |`);
    for (const authority of RENDERER_AUTHORITIES) {
      const reason = unowned.get(authority);
      if (reason === undefined) continue;
      lines.push(`| \`${cell(authority)}\` | ${cell(reason)} |`);
    }
  }

  const labEntries = sortedLedger(ledger).filter((entry) => entry.role === "lab");
  lines.push(``, `## lab 엔진 스캔 대상`, ``);
  if (labEntries.length === 0) {
    lines.push(`\`lab\` 엔진이 없다.`);
  } else {
    lines.push(
      `아래 지정자·심볼은 \`apps/web/src/\`, \`apps/\` 의 비테스트 \`.ts\`/\`.tsx\`/\`.mts\` 에서`,
      `0건이어야 한다. 위반은 테스트가 파일 단위로 보고한다.`,
      ``,
      `| id | 모듈 지정자 | 제품 심볼 |`,
      `| --- | --- | --- |`,
    );
    for (const entry of labEntries) {
      lines.push(
        `| \`${cell(entry.id)}\` | ${codeList(entry.moduleSpecifiers)} `
        + `| ${codeList(entry.productSymbols ?? [])} |`,
      );
    }
  }

  lines.push(``);
  return lines.join("\n");
}
