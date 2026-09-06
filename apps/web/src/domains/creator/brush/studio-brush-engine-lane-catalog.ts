/**
 * Engine-lane brush shelf — same medium, distinct product engines.
 * Id: `{base}--{lane}` e.g. oil--filbert-ribbon, watercolor--granular.
 */
import type { StudioStampPaperProgramId } from "./studio-brush-stamp-engine";
import type { StudioCroquisCapsulePenProgramId } from "../studio-croquis-capsule-pen-v1";
import type { StudioLivingInkSettledBakeProgramId } from "../studio-living-ink-settled-bake-v1";
import type { StudioPaperPresetIdV1 } from "./studio-paper-media-profile-v1";
import type { StudioSpectralWgmColorMixProgramId } from "../studio-spectral-wgm-mix-v1";
import type { StudioWetEdgeBloomProgramId } from "./studio-wet-edge-bloom-v1";

export const STUDIO_BRUSH_ENGINE_LANE_CATALOG_VERSION =
  "studio-brush-engine-lane-catalog-v1" as const;

export type StudioBrushEngineLaneId =
  | "causal-ink"
  | "perfect-outline"
  | "capsule-outline"
  | "oil-ribbon"
  | "oil-extrude"
  | "wet-dabs"
  | "wet-stamp"
  | "dry-dynamic"
  | "dry-stamp"
  | "spray-dynamic"
  | "spray-stamp"
  | "particle-fx"
  | "angled-ribbon"
  | "pencil-path"
  | "stamp-tone";

export interface StudioBrushEngineLaneCatalogRow {
  readonly id: string;
  readonly name: string;
  readonly baseId: string;
  readonly lane: StudioBrushEngineLaneId;
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
  readonly searchAliases: readonly string[];
  readonly family: string;
  readonly engine: string;
  readonly engineVariant: string;
  readonly canonicalId: string;
  readonly preview: string;
  readonly tip: string;
  readonly texture: string;
  readonly dynamics: string;
  readonly distinctness: "unique" | "profile-variant" | "engine-variant";
}

export interface StudioBrushEngineLaneWatercolorMaterial {
  readonly spacingRatio: number;
  readonly coreRadiusScale: number;
  readonly coreOpacityScale: number;
  readonly diffuseRadiusScale: number;
  readonly diffuseOpacityScale: number;
  /**
   * Opt-in wet-texture program (studio-wet-edge-bloom-v1). Absent means the lane's settled dab
   * plan stays bit-identical to the legacy watercolor pipeline — only lanes that declare a
   * program id are augmented (2026-08-13 brush quality wave).
   */
  readonly wetEdgeBloomProgramId?: StudioWetEdgeBloomProgramId;
  /**
   * Opt-in settled-only fluid bake program (studio-living-ink-settled-bake-v1). Absent means the
   * lane's settled plan stays bit-identical; live prefixes are always identity regardless. A lane
   * row must pin EITHER wetEdgeBloomProgramId OR livingInkBakeProgramId, never both — one wet
   * texture authority per lane (2026-08-13 wave 3).
   */
  readonly livingInkBakeProgramId?: StudioLivingInkSettledBakeProgramId;
}

export interface StudioBrushEngineLaneStampTuning {
  readonly spacingRatio: number;
  readonly flow: number;
  readonly hardness: number;
  readonly minSizeRatio: number;
  readonly sizeScale: number;
  /**
   * Opt-in W7 paper tooth program (studio-brush-stamp-engine). Absent means the lane's dab plan
   * stays bit-identical to the pre-paper stamp pipeline — only lanes that declare a program id
   * sample the paper height field at each dab station (2026-08-13 brush quality wave, F1).
   */
  readonly paperProgramId?: StudioStampPaperProgramId;
  /** Explicit paper sheet for the pinned lane; absent falls back to the program's W7 default. */
  readonly paperPresetId?: StudioPaperPresetIdV1;
}

/**
 * Per-lane colour-pipeline tuning consumed by the lane's dynamics variant
 * (studio-brush-dynamics `STUDIO_BRUSH_DYNAMICS_VARIANTS`). The program pin and
 * the mix channels travel together so a lane can never advertise WGM pigment
 * mixing while shipping nothing to mix (honesty policy): the constant mix plus
 * the per-dab seeded jitter guarantee the pinned mixer is exercised on every
 * stroke, at the shared per-dab colour resolution point Canvas, SVG export and
 * collaboration replay all consume.
 */
export interface StudioBrushEngineLaneColorPigmentTuning {
  readonly pigmentMixProgramId: StudioSpectralWgmColorMixProgramId;
  /** Second pigment of the lane — the paper/underlayer tone the mix pulls toward. */
  readonly backgroundColor: string;
  readonly foregroundBackgroundMix: number;
  readonly foregroundBackgroundJitter: number;
}

type Row = StudioBrushEngineLaneCatalogRow;

function r(
  id: string,
  name: string,
  baseId: string,
  lane: StudioBrushEngineLaneId,
  w: number,
  o: number,
  aliases: readonly string[],
  family: string,
  engine: string,
  engineVariant: string,
  canonicalId: string,
  preview: string,
  tip: string,
  texture: string,
  dynamics: string,
  distinctness: Row["distinctness"],
): Row {
  return Object.freeze({
    id, name, baseId, lane, defaultWidth: w, defaultOpacity: o,
    searchAliases: Object.freeze([...aliases]),
    family, engine, engineVariant, canonicalId, preview, tip, texture, dynamics, distinctness,
  });
}

export const STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS: readonly StudioBrushEngineLaneCatalogRow[] =
  Object.freeze([
    r("oil--filbert-ribbon", "유화 · 필버트 리본", "oil", "oil-ribbon", 26, 0.93, ["필버트 유화", "oil filbert"], "oil", "oil-ribbon", "filbert-lanes", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "engine-variant"),
    r("oil--flat-ribbon", "유화 · 플랫 리본", "oil", "oil-ribbon", 28, 0.94, ["플랫 유화", "oil flat"], "oil", "oil-ribbon", "flat-lanes", "oil", "oil", "hard", "procedural-bristle", "bristle-pressure", "engine-variant"),
    r("oil--impasto-ribbon", "유화 · 임파스토(소모 없음)", "oil", "oil-ribbon", 30, 0.97, ["임파스토 유화", "임파스토 리본", "물감 소모 없는 임파스토"], "oil", "oil-ribbon", "impasto-lanes", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "engine-variant"),
    r("oil--tube-extrude", "유화 · 튜브 릴리프", "oil", "oil-extrude", 32, 0.96, ["튜브 유화"], "oil", "dynamic-dabs", "extruded-bead-ribbon", "paint-tube", "oil", "hard", "procedural-bristle", "mapped-dabs", "profile-variant"),
    r("oil--knife-edge", "유화 · 팔레트 나이프", "oil", "oil-extrude", 34, 0.98, ["팔레트 나이프"], "oil", "dynamic-dabs", "palette-knife-blade", "paint-tube", "oil", "hard", "none", "mapped-dabs", "engine-variant"),
    r("acrylic--stiff-ribbon", "아크릴 · 경질 리본", "acrylic", "oil-ribbon", 22, 0.96, ["경질 아크릴"], "oil", "oil-ribbon", "acrylic-stiff-lanes", "oil", "oil", "hard", "procedural-bristle", "bristle-pressure", "engine-variant"),
    r("acrylic--polymer-flat", "아크릴 · 폴리머 평면", "acrylic", "oil-extrude", 24, 0.95, ["아크릴 평붓"], "oil", "dynamic-dabs", "acrylic-polymer-flat", "paint-tube", "oil", "hard", "none", "mapped-dabs", "engine-variant"),
    r("watercolor--granular", "수채 · 과립 번짐", "watercolor", "wet-dabs", 30, 0.52, ["과립 수채"], "watercolor", "watercolor-dabs", "granular", "watercolor", "soft", "sponge", "procedural-grain", "watercolor-pressure", "engine-variant"),
    r("watercolor--dense-core", "수채 · 농밀 코어", "watercolor", "wet-dabs", 26, 0.62, ["농밀 수채"], "watercolor", "watercolor-dabs", "dense-core", "watercolor", "soft", "bristle", "wet-edge", "watercolor-pressure", "engine-variant"),
    r("watercolor--edge-stamp", "수채 · 웻엣지 스탬프", "watercolor", "wet-stamp", 28, 0.58, ["웻엣지 수채"], "stamp", "stamp-dabs", "watercolor", "wash-brush", "soft", "stamp-wet-edge", "wet-edge", "stamp-pressure-flow", "profile-variant"),
    r("ink-wash--sumi-core", "수묵 · 농묵 코어", "ink-wash", "wet-dabs", 28, 0.72, ["농묵"], "watercolor", "watercolor-dabs", "sumi-dense", "watercolor", "soft", "bristle", "wet-edge", "watercolor-pressure", "engine-variant"),
    r("ink-wash--bleed-halo", "수묵 · 맑은 번짐", "ink-wash", "wet-dabs", 36, 0.48, ["수묵 번짐", "번짐 후광", "clear bleed"], "watercolor", "watercolor-dabs", "bleed-halo", "watercolor", "soft", "soft-diffuse", "soft-gradient", "watercolor-pressure", "engine-variant"),
    // Coffee-ring drying rim (inkwash edge 1.35): same wet-dabs engine, edge-response differentiated.
    r("watercolor--edge-bloom", "수채 · 엣지 블룸", "watercolor", "wet-dabs", 30, 0.55, ["엣지 블룸 수채", "coffee ring"], "watercolor", "watercolor-dabs", "edge-bloom", "watercolor", "soft", "sponge", "wet-edge", "watercolor-pressure", "engine-variant"),
    // Fibre-permeability pigment granulation (inkwash uGrain 0.55 + MoXi paper): texture differentiated.
    r("watercolor--granulating", "수채 · 입상 워시", "watercolor", "wet-dabs", 32, 0.5, ["입상 수채", "granulating wash"], "watercolor", "watercolor-dabs", "granulating-wash", "watercolor", "soft", "sponge", "procedural-grain", "watercolor-pressure", "engine-variant"),
    // Fresh-ink feathering steered by the fibre field (wetness 0.16 at 2.8x radius): sumi wet-line input response.
    r("ink-wash--fiber-feather", "수묵 · 생지 번짐(즉시)", "ink-wash", "wet-dabs", 30, 0.6, ["섬유 페더링", "fiber feather", "젖은 채 번짐"], "watercolor", "watercolor-dabs", "fiber-feather", "watercolor", "soft", "bristle", "procedural-grain", "watercolor-pressure", "engine-variant"),
    // Cheap-ink chromatography (R/G/B bleed vector): warm core, faint fast cool fringe.
    r("ink-wash--chroma-halo", "수묵 · 크로마 후광", "ink-wash", "wet-dabs", 34, 0.5, ["크로마 후광", "chroma halo"], "watercolor", "watercolor-dabs", "chroma-halo", "watercolor", "soft", "soft-diffuse", "soft-gradient", "watercolor-pressure", "engine-variant"),
    r("gouache--matte-body", "과슈 · 매트 바디", "gouache", "wet-dabs", 24, 0.92, ["매트 과슈"], "watercolor", "watercolor-dabs", "matte-body", "watercolor", "soft", "hard", "none", "watercolor-pressure", "engine-variant"),
    r("gouache--flat-stamp", "과슈 · 평면 스탬프", "gouache", "wet-stamp", 26, 0.9, ["과슈 스탬프"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("charcoal--vine-soft", "목탄 · 바인 소프트", "charcoal", "dry-dynamic", 14, 0.7, ["바인 목탄"], "dry-media", "dynamic-dabs", "charcoal-vine", "charcoal", "texture", "sponge", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("charcoal--compressed-edge", "목탄 · 압축 모서리", "charcoal", "dry-dynamic", 12, 0.88, ["압축 목탄"], "dry-media", "dynamic-dabs", "charcoal-compressed", "charcoal", "texture", "hard", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("crayon--wax-scrape", "크레용 · 왁스 스크레이프", "crayon", "dry-dynamic", 16, 0.9, ["왁스 크레용"], "dry-media", "dynamic-dabs", "crayon-wax-scrape", "crayon", "texture", "hard", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("chalk--klecks-powder", "초크 · 클레크스 가루", "chalk", "dry-dynamic", 18, 0.78, ["클레크스 초크"], "dry-media", "dynamic-dabs", "chalk-klecks", "chalk", "texture", "sponge", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("pastel--cake-soft", "파스텔 · 케이크 소프트", "pastel", "dry-dynamic", 22, 0.7, ["소프트 파스텔"], "pastel", "dynamic-dabs", "pastel-cake", "pastel", "soft", "sponge", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("oil-pastel--waxy-film", "오일파스텔 · 왁스 필름", "oil-pastel", "dry-dynamic", 20, 0.88, ["오일 파스텔 필름"], "pastel", "dynamic-dabs", "oil-pastel-film", "oil-pastel", "soft", "bristle", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    // 기존 oil-pastel dynamic-dabs 위에서 색 파이프라인만 libmypaint WGM 안료 혼합으로 교체 — 색 응답
    // 차별 변형. 실제 배선은 ENGINE_LANE_COLOR_PIGMENT_TUNING(spectral-wgm-v1 핀)이 담당한다(F3).
    r("oil-pastel--wgm-mix", "오일파스텔 · 안료 혼합", "oil-pastel", "dry-dynamic", 20, 0.9, ["안료 혼합 파스텔", "pigment mix pastel"], "pastel", "dynamic-dabs", "oil-pastel-wgm-pigment", "oil-pastel", "soft", "bristle", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    // 검증된 OSS 드라이 스탬프 레인(2026-08-13): dynamic-dabs 형제와 의도적 유사 변종 — 실행 엔진이
    // stamp-dabs 라 교차 엔진 canonical 을 가질 수 없어(감사: engine-variant 는 동일 엔진 요구)
    // 각 레인이 자기 스탬프 시그니처의 canonical(unique)이다.
    // Klecks 왁스 베드를 검증된 스탬프 walker로 — crayon--wax-scrape(dynamic-dabs)와 의도적 유사 변종(겹침 빌드업 필기감이 다르다).
    r("crayon--klecks-stamp", "크레용 · 클레크스 스탬프", "crayon", "dry-stamp", 16, 0.9, ["클레크스 크레용", "crayon klecks stamp"], "dry-media", "stamp-dabs", "crayon", "crayon--klecks-stamp", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "unique"),
    // Klecks genBrushAlpha01 파우더 팁 스탬프 — chalk--klecks-powder(dynamic-dabs)와 같은 DNA, 다른 실행 시그니처.
    r("chalk--klecks-stamp", "초크 · 클레크스 스탬프", "chalk", "dry-stamp", 18, 0.78, ["클레크스 초크 스탬프", "chalk klecks stamp"], "dry-media", "stamp-dabs", "chalk", "chalk--klecks-stamp", "texture", "stamp-airbrush", "procedural-grain", "stamp-pressure-flow", "unique"),
    // libmypaint charcoal.myb DNA 스탬프 — grit/scrape 이가 살아 있는 목탄, vine/compressed 다이나믹 레인과 공존.
    r("charcoal--mypaint-stamp", "목탄 · MyPaint 스탬프", "charcoal", "dry-stamp", 13, 0.82, ["마이페인트 목탄", "charcoal mypaint stamp"], "dry-media", "stamp-dabs", "charcoal", "charcoal--mypaint-stamp", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "unique"),
    // 소프트 파스텔 케이크 스탬프(smoothstep 벨벳 어깨) — pastel--cake-soft(dynamic-dabs)의 스탬프 자매 레인.
    r("pastel--soft-stamp", "파스텔 · 소프트 스탬프", "pastel", "dry-stamp", 22, 0.72, ["소프트 파스텔 스탬프", "pastel soft stamp"], "pastel", "stamp-dabs", "pastel", "pastel--soft-stamp", "soft", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "unique"),
    r("pencil--side-shade", "연필 · 측면 음영", "pencil", "pencil-path", 10, 0.68, ["측면 연필"], "pencil", "pencil-path", "side-shade", "pencil", "dashed", "grain", "procedural-grain", "grain-jitter", "engine-variant"),
    r("pencil--stamp-grain", "연필 · 그레인 스탬프", "pencil", "spray-stamp", 5, 0.9, ["그레인 연필 스탬프"], "stamp", "stamp-dabs", "pencil", "pencil-grain", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "profile-variant"),
    r("pencil--erodible-wear", "연필 · 마모 심", "pencil", "dry-dynamic", 8, 0.84, ["마모 연필 레인"], "pencil", "dynamic-dabs", "progressive-wear-ribbon", "erodible-pencil", "texture", "grain", "procedural-grain", "mapped-dabs", "profile-variant"),
    r("airbrush--klecks-grit", "에어브러시 · 클레크스 그릿", "airbrush", "spray-dynamic", 36, 0.66, ["클레크스 에어"], "airbrush", "dynamic-dabs", "airbrush-klecks-grit", "airbrush", "soft", "soft-particle", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("airbrush--hard-envelope", "에어브러시 · 하드 엔벨로프", "airbrush", "spray-dynamic", 30, 0.78, ["하드 에어 레인"], "airbrush", "dynamic-dabs", "connected-hard-envelope", "hard-airbrush", "solid", "hard", "none", "mapped-dabs", "profile-variant"),
    r("airbrush--stamp-soft", "에어브러시 · 소프트 스탬프", "airbrush", "spray-stamp", 34, 0.8, ["소프트 스탬프 에어"], "stamp", "stamp-dabs", "airbrush", "airbrush-fine", "soft", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "profile-variant"),
    r("spray--equal-area", "스프레이 · 등면적 산란", "spray", "spray-dynamic", 44, 0.52, ["등면적 스프레이"], "airbrush", "dynamic-dabs", "spray-equal-area", "airbrush", "dots", "flake", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("splatter--burst-cloud", "스플래터 · 버스트 클라우드", "splatter", "spray-dynamic", 48, 0.68, ["버스트 스플래터"], "airbrush", "dynamic-dabs", "splatter-burst", "airbrush", "dots", "flake", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("pen--perfect-taper", "펜 · 퍼펙트 테이퍼", "pen", "perfect-outline", 8, 1, ["퍼펙트 펜"], "perfect", "perfect-outline", "ink-taper", "perfect-ink", "calligraphy", "pressure-round", "none", "outline-pressure", "profile-variant"),
    r("gpen--causal-round", "G펜 · 연속 원형", "gpen", "causal-ink", 7, 1, ["연속 G펜"], "pen", "causal-ink", "round", "pen", "solid", "round", "none", "causal-pressure", "profile-variant"),
    r("calligraphy--perfect-chisel", "캘리 · 퍼펙트 치즐", "calligraphy", "perfect-outline", 14, 0.98, ["퍼펙트 캘리"], "perfect", "perfect-outline", "marker-flat", "perfect-marker", "solid", "round", "none", "outline-pressure", "profile-variant"),
    r("marker--chisel-ribbon", "마커 · 치즐 리본", "marker", "angled-ribbon", 18, 0.7, ["치즐 마커"], "brush", "angled-ribbon", "minus-30deg", "brush", "wavy", "angled-ribbon", "none", "ribbon-pressure", "profile-variant"),
    r("marker--soft-dynamic", "마커 · 소프트 다이나믹", "marker", "spray-dynamic", 20, 0.58, ["소프트 마커 레인"], "airbrush", "dynamic-dabs", "soft-brush", "airbrush", "soft", "round", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    r("brush--oil-lanes", "붓 · 오일 레인 강모", "brush", "oil-ribbon", 16, 0.94, ["강모 붓 리본"], "oil", "oil-ribbon", "bristle-lanes", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "profile-variant"),
    r("brush--dry-rake", "붓 · 드라이 갈퀴", "brush", "dry-dynamic", 18, 0.82, ["드라이 갈퀴 붓"], "dry-media", "dynamic-dabs", "brush-dry-rake", "charcoal", "texture", "bristle", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    // 유화 리본과 동일 캐리어, 정착 레인에 dli GGX 릴리프 라이팅 오버레이 — 질감(임파스토 입체감) 차별 변형.
    // 기본값 24/0.97: acrylic(20/0.95)과 연속성 감사 지문이 충돌하지 않도록 두껍고 거의 불투명한
    // 임파스토 기본 손맛으로 차별화(2026-08-13).
    r("brush--impasto-relief", "붓 · 임파스토 릴리프", "brush", "oil-ribbon", 24, 0.97, ["임파스토 릴리프 붓", "impasto relief"], "oil", "oil-ribbon", "impasto-relief-shaded", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "engine-variant"),
    // 동일 oil-ribbon 엔진에 압력 모멘텀(0.75 damping)+잉크 고갈 스트릭 — 입력 응답 차별 변형(갈필)
    r("brush--bristle-depletion", "붓 · 강모 고갈", "brush", "oil-ribbon", 17, 0.9, ["강모 고갈 붓", "갈필 유화", "dry bristle"], "oil", "oil-ribbon", "bristle-load-depletion", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "engine-variant"),
    r("glitter--star-field", "글리터 · 스타필드", "glitter", "particle-fx", 28, 0.92, ["스타필드 글리터"], "glitter", "particle-scatter", "star-dust", "glitter", "glitter", "spark", "procedural-spark", "seeded-particles", "engine-variant"),
    r("screentone--sparse-grid", "스크린톤 · 성긴 격자", "screentone", "stamp-tone", 24, 0.88, ["성긴 스크린톤"], "screentone", "screentone-dots", "sparse-grid", "screentone", "tone", "tone-dot", "tone-grid", "global-grid", "engine-variant"),
    r("ink-particle--scatter-cloud", "잉크입자 · 산란 구름", "ink-particle", "spray-dynamic", 20, 0.85, ["산란 잉크입자"], "ink-particle", "dynamic-dabs", "ink-scatter-cloud", "ink-particle", "dots", "flake", "custom-alpha-capable", "mapped-dabs", "engine-variant"),
    // ── 2026-08-13 wave 3 (lifecycle experimental) ──────────────────────────────────────────────
    // CC0 MyPaint 축자 이식 풀(mypaint-brushes, CC0-1.0): 파라미터 테이블·킨드 해석·dab 선형화는
    // studio-cc0-mypaint-preset-import-v1 이 단일 튜닝 소스다 — ENGINE_LANE_STAMP_TUNING 에 이
    // id들을 추가하지 말 것(중복 행은 죽은 설정). engineVariant 는 프리셋이 핀한 검증 스탬프
    // 킨드와 정확히 일치해야 하며(카탈로그 계약 감사: stampKind === engineVariant), 프리셋별
    // exact-id 튜닝은 profile-variant 규율로 선언된다 — watercolor--edge-stamp 전례.
    r("mypaint-cc0--charcoal", "MyPaint 오픈소스 · 목탄", "mypaint-cc0", "dry-stamp", 14, 0.75, ["CC0 목탄", "mypaint charcoal"], "dry-media", "stamp-dabs", "charcoal", "charcoal--mypaint-stamp", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--charcoal-tanda", "MyPaint 오픈소스 · 목탄 슬리버", "mypaint-cc0", "dry-stamp", 12, 0.8, ["목탄 슬리버", "charcoal sliver"], "dry-media", "stamp-dabs", "charcoal", "charcoal--mypaint-stamp", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--2b-pencil", "MyPaint 오픈소스 · 2B 연필", "mypaint-cc0", "dry-stamp", 9, 0.9, ["CC0 2B", "2b pencil"], "pencil", "stamp-dabs", "pencil", "pencil-grain", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "profile-variant"),
    // engineVariant/tip/texture follow the stamp kind, which moved from "ink" (the solid-disc tip)
    // to "charcoal" in studio-cc0-mypaint-preset-import-v1 — see the note there. The catalog
    // contract asserts these three agree with the resolved kind, which is exactly how the old
    // mismatch would have been caught if the kind had ever been questioned.
    r("mypaint-cc0--dry-brush", "MyPaint 오픈소스 · 드라이 브러시", "mypaint-cc0", "dry-stamp", 18, 0.85, ["CC0 드라이 브러시", "dry brush"], "dry-media", "stamp-dabs", "charcoal", "charcoal--mypaint-stamp", "texture", "stamp-pencil", "procedural-grain", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--splatter", "MyPaint 오픈소스 · 스플래터", "mypaint-cc0", "spray-stamp", 42, 0.7, ["CC0 스플래터", "splatter burst"], "stamp", "stamp-dabs", "airbrush", "airbrush-fine", "dots", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "profile-variant"),
    // ink-blot 이 "mypaint" 스탬프 킨드 시그니처의 카탈로그 canonical(unique); oil-paint 는 같은
    // 킨드의 exact-id 튜닝 변형(profile-variant)이다.
    r("mypaint-cc0--ink-blot", "MyPaint 오픈소스 · 잉크 블롯", "mypaint-cc0", "wet-stamp", 30, 0.85, ["잉크 블롯", "ink blot"], "stamp", "stamp-dabs", "mypaint", "mypaint-cc0--ink-blot", "soft", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "unique"),
    r("mypaint-cc0--kabura", "MyPaint 오픈소스 · 카부라 펜", "mypaint-cc0", "wet-stamp", 6, 1, ["카부라", "kabura pen"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--watercolor-fringe", "MyPaint 오픈소스 · 수채 프린지", "mypaint-cc0", "wet-stamp", 34, 0.55, ["수채 프린지", "watercolor fringe"], "stamp", "stamp-dabs", "watercolor", "wash-brush", "soft", "stamp-wet-edge", "wet-edge", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--watercolor-expressive", "MyPaint 오픈소스 · 수채 익스프레시브", "mypaint-cc0", "wet-stamp", 30, 0.5, ["수채 익스프레시브", "watercolor expressive"], "stamp", "stamp-dabs", "watercolor", "wash-brush", "soft", "stamp-wet-edge", "wet-edge", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--oil-paint", "MyPaint 오픈소스 · 오일 페인트", "mypaint-cc0", "wet-stamp", 24, 0.93, ["CC0 오일", "oil paint"], "stamp", "stamp-dabs", "mypaint", "mypaint-cc0--ink-blot", "oil", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--pastel", "MyPaint 오픈소스 · 파스텔", "mypaint-cc0", "dry-stamp", 20, 0.72, ["CC0 파스텔", "pastel cc0"], "pastel", "stamp-dabs", "pastel", "pastel--soft-stamp", "texture", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--calligraphy", "MyPaint 오픈소스 · 캘리그래피", "mypaint-cc0", "wet-stamp", 15, 1, ["CC0 캘리그래피", "mypaint calligraphy"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--marker-fat", "MyPaint 오픈소스 · 광폭 마커", "mypaint-cc0", "wet-stamp", 24, 1, ["CC0 마커", "mypaint marker"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--marker-small", "MyPaint 오픈소스 · 세필 마커", "mypaint-cc0", "wet-stamp", 10, 1, ["CC0 세필 마커", "marker small"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--slow-ink", "MyPaint 오픈소스 · 슬로우 잉크", "mypaint-cc0", "wet-stamp", 12, 1, ["CC0 슬로우 잉크", "slow ink"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--knife", "MyPaint 오픈소스 · 나이프", "mypaint-cc0", "wet-stamp", 22, 0.95, ["CC0 나이프", "paint knife"], "stamp", "stamp-dabs", "ink", "ink-brush", "solid", "stamp-ink", "none", "stamp-pressure-flow", "profile-variant"),
    r("mypaint-cc0--spray", "MyPaint 오픈소스 · 스프레이", "mypaint-cc0", "spray-stamp", 40, 0.6, ["CC0 스프레이", "spray fade"], "stamp", "stamp-dabs", "airbrush", "airbrush-fine", "dots", "stamp-airbrush", "soft-gradient", "stamp-pressure-flow", "profile-variant"),
    // croquis.js(MIT OR Apache-2.0) 외접 탄젠트 캡슐 잉킹 — 필압 스파이크에서도 무벌지 가변 굵기.
    // 프로그램 핀은 ENGINE_LANE_CROQUIS_CAPSULE_PROGRAM(아래) — wetEdgeBloomProgramId 규율 미러.
    // 폭 7.5는 gpen(7px) 계열 정렬을 유지하면서 gpen--causal-round(7/1)와의 연속성 감사 지문
    // 충돌만 피한 값. 두 캡슐 레인은 같은 엔진의 변형이라 스태빌라이즈드가 캡슐의 engine-variant.
    r("gpen--croquis-capsule", "G펜 · 크로키 캡슐", "gpen", "capsule-outline", 7.5, 1, ["크로키 G펜", "croquis gpen", "캡슐 G펜"], "gpen", "capsule-outline", "croquis-capsule", "gpen--croquis-capsule", "solid", "pressure-round", "none", "outline-pressure", "unique"),
    // 0.96 opacity: croquis(스케치) 안정화 선의 살짝 투명한 연출이자, 0.025-quantized perceptual
    // planner fingerprint를 형제 캡슐 레인(불투명 1.0)과 구분하는 정직한 기본값 차등.
    r("pen--croquis-stabilized", "펜 · 크로키 안정화", "pen", "capsule-outline", 8, 0.96, ["크로키 안정화 펜", "croquis stabilized pen", "풀드 스트링 펜"], "gpen", "capsule-outline", "croquis-capsule-pulled-string", "gpen--croquis-capsule", "calligraphy", "pressure-round", "none", "outline-pressure", "engine-variant"),
    // 물리 질감 레인: 리빙잉크 정착 베이크(수묵/수채, 프로그램 핀은 워터컬러 재질 행) +
    // WetBrush-2D 강모 물리(유화 — 캐리어 옵션은 studioOilRibbonProgramsForBrush 의 id 매트릭스,
    // 또는 저장 브러시의 프로그램 세트가 정하고 두 렌더러가 같은 리졸버를 부른다. 2026-08-15 이후
    // 이 레인만의 옵션이 아니다).
    r("ink-wash--living-bake", "수묵 · 정착 건조", "ink-wash", "wet-dabs", 30, 0.66, ["리빙잉크 수묵", "living ink bake", "리빙잉크 베이크", "들면 마르는 수묵"], "watercolor", "watercolor-dabs", "living-ink-settled-bake", "watercolor", "soft", "bristle", "wet-edge", "watercolor-pressure", "engine-variant"),
    r("watercolor--fluid-feather", "수채 · 유체 페더", "watercolor", "wet-dabs", 28, 0.52, ["유체 페더", "fluid feather"], "watercolor", "watercolor-dabs", "fluid-feather-bake", "watercolor", "soft", "sponge", "wet-edge", "watercolor-pressure", "engine-variant"),
    r("brush--bristle-physics", "유화 · 물리 강모 갈필", "brush", "oil-ribbon", 18, 0.92, ["물리 강모 붓", "physics bristle", "WetBrush", "붓 · 물리 강모"], "oil", "oil-ribbon", "bristle-physics-tuft", "oil", "oil", "bristle", "procedural-bristle", "bristle-pressure", "engine-variant"),
  ]);

const LANE_ID_RE = /^([a-z0-9-]+)--([a-z0-9-]+)$/u;

export function isStudioBrushEngineLaneId(brushId: string): boolean {
  return LANE_ID_RE.test(brushId);
}

export function resolveStudioBrushEngineLaneBaseId(
  brushId: string | null | undefined,
): string | null {
  if (!brushId) return null;
  return LANE_ID_RE.exec(brushId.trim().toLowerCase())?.[1] ?? null;
}

export function listStudioBrushEngineLaneIds(): readonly string[] {
  return Object.freeze(STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) => row.id));
}

export function studioBrushEngineLaneRowById(
  brushId: string | null | undefined,
): StudioBrushEngineLaneCatalogRow | null {
  if (!brushId) return null;
  return STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.find((row) => row.id === brushId) ?? null;
}

export function listStudioBrushEngineLanePresets(): readonly {
  id: string;
  name: string;
  defaultWidth: number;
  defaultOpacity: number;
  searchAliases: readonly string[];
}[] {
  return Object.freeze(
    STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) =>
      Object.freeze({
        id: row.id,
        name: row.name,
        defaultWidth: row.defaultWidth,
        defaultOpacity: row.defaultOpacity,
        searchAliases: row.searchAliases,
      }),
    ),
  );
}

export function studioBrushEngineLaneDiameterScale(
  brushId: string | null | undefined,
): number | null {
  if (!brushId || !isStudioBrushEngineLaneId(brushId)) return null;
  let hash = 2166136261;
  for (let i = 0; i < brushId.length; i++) {
    hash ^= brushId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 0.84 + (((hash >>> 0) % 10_000) / 10_000) * 0.52;
}

export function resolveStudioBrushEngineLaneDynamicsPresetId(
  brushId: string | null | undefined,
): "ink-particle" | "airbrush" | "dry-media" | null {
  const row = studioBrushEngineLaneRowById(brushId);
  if (!row || row.engine !== "dynamic-dabs") return null;
  const v = row.engineVariant;
  if (
    v.includes("airbrush") || v.includes("spray") || v.includes("splatter")
    || v === "soft-brush" || v === "connected-hard-envelope"
  ) return "airbrush";
  if (
    v.includes("charcoal") || v.includes("crayon") || v.includes("chalk")
    || v.includes("pastel") || v.includes("dry") || v === "brush-dry-rake"
  ) return "dry-media";
  return "ink-particle";
}

const ENGINE_LANE_WATERCOLOR_MATERIAL: Readonly<
  Record<string, StudioBrushEngineLaneWatercolorMaterial>
> = Object.freeze({
  "watercolor--granular": Object.freeze({
    spacingRatio: 0.196, coreRadiusScale: 0.62, coreOpacityScale: 1.15,
    diffuseRadiusScale: 1.95, diffuseOpacityScale: 0.42,
  }),
  "watercolor--dense-core": Object.freeze({
    spacingRatio: 0.112, coreRadiusScale: 0.95, coreOpacityScale: 1.85,
    diffuseRadiusScale: 1.15, diffuseOpacityScale: 0.38,
  }),
  "ink-wash--sumi-core": Object.freeze({
    spacingRatio: 0.098, coreRadiusScale: 0.88, coreOpacityScale: 2.05,
    diffuseRadiusScale: 1.25, diffuseOpacityScale: 0.4,
  }),
  "ink-wash--bleed-halo": Object.freeze({
    spacingRatio: 0.168, coreRadiusScale: 0.55, coreOpacityScale: 1.2,
    diffuseRadiusScale: 2.15, diffuseOpacityScale: 0.48,
  }),
  "gouache--matte-body": Object.freeze({
    spacingRatio: 0.140, coreRadiusScale: 1.05, coreOpacityScale: 1.65,
    diffuseRadiusScale: 0.9, diffuseOpacityScale: 0.22,
  }),
  // 2026-08-13 wet-texture lanes: material + opt-in wet-edge-bloom program (기존 레인 무변경).
  "watercolor--edge-bloom": Object.freeze({
    spacingRatio: 0.182, coreRadiusScale: 0.7, coreOpacityScale: 1.2,
    diffuseRadiusScale: 1.75, diffuseOpacityScale: 0.5,
    wetEdgeBloomProgramId: "edge-bloom",
  }),
  "watercolor--granulating": Object.freeze({
    spacingRatio: 0.210, coreRadiusScale: 0.66, coreOpacityScale: 1.1,
    diffuseRadiusScale: 1.9, diffuseOpacityScale: 0.44,
    wetEdgeBloomProgramId: "granulating-wash",
  }),
  "ink-wash--fiber-feather": Object.freeze({
    spacingRatio: 0.126, coreRadiusScale: 0.8, coreOpacityScale: 1.7,
    diffuseRadiusScale: 1.5, diffuseOpacityScale: 0.42,
    wetEdgeBloomProgramId: "fiber-feather",
  }),
  "ink-wash--chroma-halo": Object.freeze({
    spacingRatio: 0.168, coreRadiusScale: 0.6, coreOpacityScale: 1.35,
    diffuseRadiusScale: 1.9, diffuseOpacityScale: 0.46,
    wetEdgeBloomProgramId: "chroma-halo",
  }),
  // 2026-08-13 wave 3 physics-texture lanes: settled-only 리빙잉크 베이크 핀. 정착 시에만
  // 유체장이 번짐/림/페더를 굽는다(라이브 프리픽스는 항등) — UI 카피도 "정착 시 번짐"으로.
  "ink-wash--living-bake": Object.freeze({
    spacingRatio: 0.140, coreRadiusScale: 0.82, coreOpacityScale: 1.75,
    diffuseRadiusScale: 1.6, diffuseOpacityScale: 0.44,
    livingInkBakeProgramId: "sumi-flow-bake",
  }),
  "watercolor--fluid-feather": Object.freeze({
    spacingRatio: 0.182, coreRadiusScale: 0.68, coreOpacityScale: 1.15,
    diffuseRadiusScale: 1.85, diffuseOpacityScale: 0.46,
    livingInkBakeProgramId: "fluid-feather-lite",
  }),
});

const ENGINE_LANE_STAMP_TUNING: Readonly<
  Record<string, StudioBrushEngineLaneStampTuning>
> = Object.freeze({
  "watercolor--edge-stamp": Object.freeze({
    spacingRatio: 0.055, flow: 0.18, hardness: 0.18, minSizeRatio: 0.48, sizeScale: 1.12,
  }),
  "gouache--flat-stamp": Object.freeze({
    spacingRatio: 0.22, flow: 0.92, hardness: 0.95, minSizeRatio: 0.12, sizeScale: 1.05,
  }),
  "airbrush--stamp-soft": Object.freeze({
    spacingRatio: 0.08, flow: 0.11, hardness: 0.04, minSizeRatio: 0.78, sizeScale: 1.18,
  }),
  "pencil--stamp-grain": Object.freeze({
    spacingRatio: 0.17, flow: 0.48, hardness: 0.72, minSizeRatio: 0.28, sizeScale: 0.92,
  }),
  // 2026-08-13 dry-stamp lanes: 연속 베드 간격(0.03..0.2) — 연필 스탬프(0.24)보다 촘촘해야
  // 폴리곤 확장 없이 왁스/파우더 결이 이어진다.
  // 종이 핀(F1): 네 레인만 W7 peak-catch 프로그램을 옵트인한다 — 크레용·초크·목탄은 판화지
  // (깊은 알갱이 이빨), 파스텔은 켄트지(고운 미세 이빨). 핀 없는 스탬프 레인은 비트 동일.
  "crayon--klecks-stamp": Object.freeze({
    spacingRatio: 0.16, flow: 0.74, hardness: 0.86, minSizeRatio: 0.42, sizeScale: 1.0,
    paperProgramId: "dry-peak-catch-v1", paperPresetId: "printmaking",
  }),
  "chalk--klecks-stamp": Object.freeze({
    spacingRatio: 0.14, flow: 0.4, hardness: 0.24, minSizeRatio: 0.55, sizeScale: 1.08,
    paperProgramId: "dry-peak-catch-v1", paperPresetId: "printmaking",
  }),
  "charcoal--mypaint-stamp": Object.freeze({
    spacingRatio: 0.18, flow: 0.58, hardness: 0.45, minSizeRatio: 0.34, sizeScale: 1.04,
    paperProgramId: "dry-peak-catch-v1", paperPresetId: "printmaking",
  }),
  "pastel--soft-stamp": Object.freeze({
    spacingRatio: 0.13, flow: 0.5, hardness: 0.32, minSizeRatio: 0.52, sizeScale: 1.1,
    paperProgramId: "dry-peak-catch-v1", paperPresetId: "kent",
  }),
});

const ENGINE_LANE_COLOR_PIGMENT_TUNING: Readonly<
  Record<string, StudioBrushEngineLaneColorPigmentTuning>
> = Object.freeze({
  // F3(2026-08-13): oil-pastel--wgm-mix 만 libmypaint WGM 안료 프로그램을 핀한다. 종이톤
  // 배경 안료(따뜻한 크라프트지)와 dab별 시드 지터가 실제 오일파스텔 스컴블(브로큰 컬러)을
  // 만든다 — 평균 0.26 혼합 ± 0.3 지터가 0으로 클램프되는 dab(스틱이 완전히 덮는 순수 안료
  // 알갱이)과 0.56까지 종이톤이 비치는 dab을 한 획 안에 섞고, 0이 아닌 혼합은 전부 WGM
  // 커널을 지난다. 핀 없는 형제 레인(waxy-film 등)은 색 파이프라인 비트 동일.
  "oil-pastel--wgm-mix": Object.freeze({
    pigmentMixProgramId: "spectral-wgm-v1",
    backgroundColor: "#e8d9b5",
    foregroundBackgroundMix: 0.26,
    foregroundBackgroundJitter: 0.3,
  }),
});

/**
 * Opt-in croquis capsule-outline program pins (studio-croquis-capsule-pen-v1) — the exact
 * wetEdgeBloomProgramId/pigmentMixProgramId discipline: a brush id gains the capsule engine only
 * through an explicit pin here; every unpinned brush keeps its current renderer byte-identically,
 * and unknown/removed ids resolve to null so they can never converge to another renderer
 * (2026-08-13 wave 3).
 */
const ENGINE_LANE_CROQUIS_CAPSULE_PROGRAM: Readonly<
  Record<string, StudioCroquisCapsulePenProgramId>
> = Object.freeze({
  "gpen--croquis-capsule": "croquis-capsule-v1",
  "pen--croquis-stabilized": "croquis-capsule-pulled-string-v1",
});

const ENGINE_LANE_LABEL_KO: Readonly<Record<StudioBrushEngineLaneId, string>> = Object.freeze({
  "causal-ink": "연속 잉크",
  "perfect-outline": "퍼펙트 아웃라인",
  "capsule-outline": "캡슐 아웃라인",
  "oil-ribbon": "오일 리본",
  "oil-extrude": "튜브·나이프",
  "wet-dabs": "웻 다브",
  "wet-stamp": "웻 스탬프",
  "dry-dynamic": "드라이 다이나믹",
  "dry-stamp": "드라이 스탬프",
  "spray-dynamic": "스프레이 다이나믹",
  "spray-stamp": "소프트 스탬프",
  "particle-fx": "파티클 FX",
  "angled-ribbon": "각진 리본",
  "pencil-path": "연필 패스",
  "stamp-tone": "톤 스탬프",
});

export function resolveStudioBrushEngineLaneWatercolorMaterial(
  brushId: string | null | undefined,
): StudioBrushEngineLaneWatercolorMaterial | null {
  if (!brushId) return null;
  return ENGINE_LANE_WATERCOLOR_MATERIAL[brushId] ?? null;
}

export function resolveStudioBrushEngineLaneStampTuning(
  brushId: string | null | undefined,
): StudioBrushEngineLaneStampTuning | null {
  if (!brushId) return null;
  return ENGINE_LANE_STAMP_TUNING[brushId] ?? null;
}

export function resolveStudioBrushEngineLaneColorPigmentTuning(
  brushId: string | null | undefined,
): StudioBrushEngineLaneColorPigmentTuning | null {
  if (!brushId) return null;
  return ENGINE_LANE_COLOR_PIGMENT_TUNING[brushId] ?? null;
}

/** Fail-closed: only explicitly pinned lane ids resolve a croquis capsule program id. */
export function resolveStudioBrushEngineLaneCroquisCapsuleProgramId(
  brushId: string | null | undefined,
): StudioCroquisCapsulePenProgramId | null {
  if (!brushId) return null;
  return ENGINE_LANE_CROQUIS_CAPSULE_PROGRAM[brushId] ?? null;
}

export function resolveStudioBrushEngineLaneLabelKo(
  brushId: string | null | undefined,
): string | null {
  const row = studioBrushEngineLaneRowById(brushId);
  return row ? (ENGINE_LANE_LABEL_KO[row.lane] ?? row.lane) : null;
}
