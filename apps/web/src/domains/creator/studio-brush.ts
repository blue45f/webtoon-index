/**
 * Studio Brush Math Utilities
 * Handles freehand stroke point thinning, smoothing, stabilizing, pencil jitter,
 * pressure-width simulation (G-pen) and screentone dot stamping.
 * 전부 순수 함수 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import { STUDIO_BRUSH_DISCOVERY } from "./brush/studio-brush-discovery";
import {
  STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS,
  listStudioBrushEngineLanePresets,
} from "./brush/studio-brush-engine-lane-catalog";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "./studio-pixel-pencil";

/** Artist-facing operation. Render families may be shared, but paint and erase never are. */
export type StudioToolOperation = "paint" | "erase";

// 브러시 프리셋 데이터(드로잉 툴바/우측 패널 공용).
export interface BrushPreset {
  id: string;
  name: string;
  defaultWidth: number;
  defaultOpacity: number;
  /** Durable tool operation; renderer family alone must never imply paint versus erase. */
  operation: StudioToolOperation;
  /** Catalogue preview suggestion only; switching tools preserves the artist's active color. */
  defaultColor?: string;
  /** Locale-independent discovery terms that remain separate from the displayed product name. */
  searchAliases?: readonly string[];
}

type BrushPresetDefinition = Omit<BrushPreset, "operation"> & {
  /** Paint remains the authoring default for concise legacy preset declarations. */
  operation?: StudioToolOperation;
};

function defineBrushPresets(
  presets: readonly BrushPresetDefinition[]
): BrushPreset[] {
  return presets.map((preset) => {
    const discovery = STUDIO_BRUSH_DISCOVERY[preset.id];
    return {
      operation: "paint",
      ...preset,
      ...(discovery ? {
        name: discovery.name,
        searchAliases: [...new Set([
          preset.name,
          ...(preset.searchAliases ?? []),
          ...discovery.aliases,
        ])],
      } : {}),
    };
  });
}

/**
 * Render family — many commercial aliases share one deterministic stroke pipeline.
 * Inspired by Canva/Express (named beginner tools) + Picsart depth without clone branding.
 */
export type StudioBrushRenderFamily =
  | "pen"
  | "gpen"
  | "calligraphy"
  | "perfect"
  | "marker"
  | "highlighter"
  | "neon"
  | "glow"
  | "glitter"
  | "brush"
  | "watercolor"
  | "oil"
  | "pastel"
  | "ink-particle"
  | "airbrush"
  | "dry-media"
  | "pencil"
  | "screentone"
  | "stamp"
  | "pixel";

/** Map preset id → render family (unknown ids fall back to pen). */
export const STUDIO_BRUSH_RENDER_FAMILY: Readonly<Record<string, StudioBrushRenderFamily>> = {
  [STUDIO_PIXEL_PENCIL_RENDER_MODE]: "pixel",
  pen: "pen",
  fineliner: "pen",
  ballpoint: "pen",
  "gel-pen": "pen",
  "glass-pen": "pen",
  "ruling-pen": "pen",
  "technical-pen": "pen",
  gpen: "gpen",
  "school-pen": "gpen",
  "maru-pen": "gpen",
  liner: "gpen",
  "mapping-pen": "gpen",
  kaburapen: "gpen",
  "ink-brush": "stamp",
  "airbrush-fine": "stamp",
  "pencil-grain": "stamp",
  "wash-brush": "stamp",
  calligraphy: "calligraphy",
  "fountain-pen": "calligraphy",
  "parallel-pen": "calligraphy",
  "brush-pen": "calligraphy",
  "standard-eraser": "pen",
  "kneaded-eraser": "pen",
  // perfect-freehand(tldraw) 아웃라인 폴리곤 렌더 — studio-perfect-freehand.ts 어댑터가 그린다.
  "perfect-ink": "perfect",
  "perfect-marker": "perfect",
  marker: "marker",
  "felt-tip": "marker",
  "marker-bold": "marker",
  "alcohol-marker": "marker",
  highlighter: "highlighter",
  "chisel-highlighter": "highlighter",
  "pastel-highlighter": "highlighter",
  neon: "neon",
  glow: "glow",
  "soft-glow": "glow",
  glitter: "glitter",
  "star-dust": "glitter",
  "sparkle-star": "glitter",
  brush: "brush",
  "flat-brush": "brush",
  watercolor: "watercolor",
  "ink-wash": "watercolor",
  "inkwash-pen": "watercolor",
  "inkwash-water-brush": "watercolor",
  "inkwash-bleed-wash": "watercolor",
  "inkwash-white-ink": "watercolor",
  gouache: "watercolor",
  oil: "oil",
  acrylic: "oil",
  "paint-tube": "oil",
  pastel: "pastel",
  "oil-pastel": "pastel",
  "ink-particle": "ink-particle",
  "tangent-normal-brush": "ink-particle",
  "sketchpad-tile": "ink-particle",
  "sketchpad-mirror": "pen",
  "sketchpad-soft-marker": "marker",
  "web-multi-agent": "ink-particle",
  "web-rough-ink": "pen",
  "web-gravity-drip": "ink-particle",
  "web-soft-cloud": "airbrush",
  "web-calligraphy-ribbon": "calligraphy",
  "web-dash-stitch": "pen",
  "web-scatter-stamp": "ink-particle",
  "web-rainbow-flow": "marker",
  "web-lazy-ink": "pen",
  "web-hatch-color": "pen",
  "web-cel-flat": "marker",
  "web-blend-softener": "airbrush",
  "web-dot-tone": "screentone",
  "web-kaleido-ink": "ink-particle",
  "web-fur-strand": "ink-particle",
  "web-contour-double": "pen",
  "web-radial-burst": "ink-particle",
  "web-mirror-ink": "pen",
  "web-grid-ink": "pen",
  "web-spiro-orbit": "ink-particle",
  "web-zigzag-edge": "pen",
  "web-neon-tube": "airbrush",
  "web-pressure-flat": "pen",
  "web-smudge-trail": "airbrush",
  "web-cross-hatch-pen": "pen",
  airbrush: "airbrush",
  "hard-airbrush": "airbrush",
  spray: "airbrush",
  splatter: "airbrush",
  "soft-brush": "airbrush",
  "dry-media": "dry-media",
  crayon: "dry-media",
  chalk: "dry-media",
  charcoal: "dry-media",
  pencil: "pencil",
  "erodible-pencil": "pencil",
  "soft-pencil": "pencil",
  "pencil-2b": "pencil",
  "pencil-6b": "pencil",
  "colored-pencil": "pencil",
  screentone: "screentone",
  crosshatch: "screentone",
  ...Object.fromEntries(
    STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) => [
      row.id,
      row.family as StudioBrushRenderFamily,
    ]),
  ),
};

export function resolveStudioBrushRenderFamily(brushId: unknown): StudioBrushRenderFamily {
  if (typeof brushId !== "string" || !brushId) return "pen";
  const mapped = STUDIO_BRUSH_RENDER_FAMILY[brushId];
  if (mapped) return mapped;
  const laneBase = brushId.includes("--") ? brushId.split("--", 1)[0]! : null;
  if (laneBase) {
    const baseFamily = STUDIO_BRUSH_RENDER_FAMILY[laneBase];
    if (baseFamily) return baseFamily;
  }
  // Pack-expansion / alias ids keep one presentation family so wash/air/dry share UI chrome.
  const id = brushId.toLowerCase();
  if (/(?:watercolor|ink-?wash|inkwash|sumi|gouache|bleed-wash|wet-wash|flat-wash)/u.test(id)) {
    return "watercolor";
  }
  if (/(?:airbrush|soft-brush|^spray$|mist-soft|grand-soft)/u.test(id)) return "airbrush";
  if (/(?:charcoal|crayon|chalk|pastel|dry-media|pencil)/u.test(id)) {
    if (id.includes("pastel") && !id.includes("highlighter")) return "pastel";
    if (id.includes("pencil")) return "pencil";
    return "dry-media";
  }
  if (/(?:oil|acrylic|paint-tube)/u.test(id)) return "oil";
  if (/(?:marker|highlighter|felt-tip)/u.test(id)) {
    return id.includes("highlighter") ? "highlighter" : "marker";
  }
  return "pen";
}

/**
 * Commercial brush kit — Canva/Express beginner names + Picsart expressive media + webtoon line tools.
 * Keep legacy ids first so saved documents remain stable.
 */
export const BRUSH_PRESETS: BrushPreset[] = defineBrushPresets([
  // —— Line tools (AutoDraw-adjacent clean ink, CSP-style line art) ——
  { id: "pen", name: "펜(매끈)", defaultWidth: 6, defaultOpacity: 1.0 },
  { id: "fineliner", name: "파인라이너", defaultWidth: 2.2, defaultOpacity: 1.0 },
  { id: "ballpoint", name: "볼펜", defaultWidth: 3.5, defaultOpacity: 0.95 },
  {
    id: "gel-pen",
    name: "젤펜(선명)",
    defaultWidth: 3.8,
    defaultOpacity: 1,
    searchAliases: ["젤 펜", "중성펜", "gel pen", "gel ink pen"],
  },
  {
    id: "glass-pen",
    name: "유리펜(잉크 흐름)",
    defaultWidth: 3.1,
    defaultOpacity: 0.92,
    searchAliases: ["글라스 펜", "유리 딥펜", "glass pen", "glass dip pen"],
  },
  {
    id: "ruling-pen",
    name: "룰링펜(잉크 간격)",
    defaultWidth: 4.6,
    defaultOpacity: 0.98,
    searchAliases: ["룰링 펜", "선긋기 펜", "ruling pen", "technical ruling pen"],
  },
  { id: "technical-pen", name: "제도 펜", defaultWidth: 2.5, defaultOpacity: 1.0 },
  { id: "gpen", name: "G펜(필압)", defaultWidth: 7, defaultOpacity: 1.0 },
  {
    id: "school-pen",
    name: "스쿨펜(안정 선화)",
    defaultWidth: 4.2,
    defaultOpacity: 1,
    searchAliases: ["스쿨 펜", "학생 펜", "school pen", "school nib"],
  },
  {
    id: "maru-pen",
    name: "마루펜(세필 탄성)",
    defaultWidth: 2.4,
    defaultOpacity: 1,
    searchAliases: ["마루 펜", "둥근 펜촉", "maru pen", "round manga nib"],
  },
  { id: "mapping-pen", name: "매핑 펜(세밀원고)", defaultWidth: 3.2, defaultOpacity: 1.0 },
  { id: "kaburapen", name: "스푼 펜(스무스)", defaultWidth: 5.5, defaultOpacity: 1.0 },
  { id: "liner", name: "잉크 라이너", defaultWidth: 5, defaultOpacity: 1.0 },
  { id: "ink-brush", name: "잉크 붓(속도)", defaultWidth: 8, defaultOpacity: 1.0 },
  { id: "calligraphy", name: "캘리그래피(펜 기울기)", defaultWidth: 12, defaultOpacity: 1.0 },
  {
    id: "fountain-pen",
    name: "만년필(사선 촉)",
    defaultWidth: 6.5,
    defaultOpacity: 1,
    searchAliases: ["만년필 펜", "잉크 만년필", "fountain pen", "fountain nib"],
  },
  {
    id: "parallel-pen",
    name: "평행펜(넓은 촉)",
    defaultWidth: 18,
    defaultOpacity: 0.98,
    searchAliases: ["패럴렐 펜", "평행 촉", "parallel pen", "parallel calligraphy nib"],
  },
  { id: "brush-pen", name: "모필 붓펜", defaultWidth: 9, defaultOpacity: 1.0 },
  { id: "perfect-ink", name: "캘리 잉크펜(퍼펙트)", defaultWidth: 9, defaultOpacity: 1.0 },
  { id: "perfect-marker", name: "마커 펜(퍼펙트)", defaultWidth: 14, defaultOpacity: 1.0 },
  {
    id: "standard-eraser",
    name: "일반 지우개",
    defaultWidth: 20,
    defaultOpacity: 1,
    operation: "erase",
    searchAliases: ["기본 지우개", "완전 지우개", "standard eraser", "hard eraser"],
  },
  {
    id: "kneaded-eraser",
    name: "떡지우개(저농도)",
    defaultWidth: 26,
    defaultOpacity: 0.38,
    operation: "erase",
    defaultColor: "#b7ada0",
    searchAliases: ["말랑 지우개", "찰흙 지우개", "kneaded eraser", "putty eraser"],
  },
  // —— Markers (Canva Draw / Express / Picsart / CSP) ——
  { id: "marker", name: "마커(굵고 반투명)", defaultWidth: 16, defaultOpacity: 0.6 },
  { id: "felt-tip", name: "펠트펜", defaultWidth: 10, defaultOpacity: 0.85 },
  { id: "marker-bold", name: "볼드 마커", defaultWidth: 28, defaultOpacity: 0.55 },
  { id: "alcohol-marker", name: "알코올 코픽마커", defaultWidth: 20, defaultOpacity: 0.65 },
  { id: "highlighter", name: "형광펜", defaultWidth: 24, defaultOpacity: 0.45, defaultColor: "#ffd84d" },
  { id: "chisel-highlighter", name: "사각 치즐 형광펜", defaultWidth: 28, defaultOpacity: 0.42, defaultColor: "#ff5252" },
  { id: "pastel-highlighter", name: "파스텔 형광펜", defaultWidth: 22, defaultOpacity: 0.5, defaultColor: "#b388ff" },
  { id: "neon", name: "네온 마커", defaultWidth: 18, defaultOpacity: 0.75, defaultColor: "#39ff14" },
  // —— FX glow / sparkle (PicsArt Draw effects kit) ——
  { id: "glow", name: "글로우", defaultWidth: 16, defaultOpacity: 0.9, defaultColor: "#ff4fd8" },
  { id: "soft-glow", name: "소프트 글로우", defaultWidth: 28, defaultOpacity: 0.75, defaultColor: "#5ce1ff" },
  { id: "glitter", name: "글리터", defaultWidth: 22, defaultOpacity: 0.95, defaultColor: "#ffd24a" },
  { id: "star-dust", name: "스타 더스트", defaultWidth: 26, defaultOpacity: 0.9, defaultColor: "#e8f0ff" },
  { id: "sparkle-star", name: "반짝이 별", defaultWidth: 24, defaultOpacity: 0.92, defaultColor: "#fff176" },
  // —— Paint (Picsart / Procreate / Photoshop digital paint) ——
  { id: "brush", name: "붓", defaultWidth: 10, defaultOpacity: 1.0 },
  { id: "flat-brush", name: "평붓(플랫)", defaultWidth: 18, defaultOpacity: 0.9 },
  { id: "watercolor", name: "수채 번짐", defaultWidth: 28, defaultOpacity: 0.55 },
  { id: "ink-wash", name: "수묵 번짐", defaultWidth: 30, defaultOpacity: 0.5 },
  {
    id: "inkwash-pen",
    name: "잉크워시 딥펜(유체 잉크)",
    defaultWidth: 8,
    defaultOpacity: 0.95,
    searchAliases: ["잉크워시 펜", "유체 잉크 펜", "inkwash pen", "fluid ink pen"],
  },
  {
    id: "inkwash-water-brush",
    name: "잉크워시 수채 붓(생동하는 물)",
    defaultWidth: 32,
    defaultOpacity: 0.6,
    searchAliases: ["잉크워시 붓", "생동하는 물", "water brush", "living water brush"],
  },
  {
    id: "inkwash-bleed-wash",
    name: "잉크워시 번짐 워시",
    defaultWidth: 36,
    defaultOpacity: 0.5,
    searchAliases: ["잉크워시 번짐", "유체 번짐", "inkwash bleed", "fluid bleed wash"],
  },
  {
    id: "inkwash-white-ink",
    name: "잉크워시 화이트 잉크",
    defaultWidth: 16,
    defaultOpacity: 0.85,
    searchAliases: ["화이트 잉크", "하얀 잉크", "white ink", "fluid white ink"],
  },
  { id: "gouache", name: "과슈 붓", defaultWidth: 24, defaultOpacity: 0.88 },
  { id: "oil", name: "유화 붓", defaultWidth: 22, defaultOpacity: 0.92 },
  { id: "acrylic", name: "아크릴 물감", defaultWidth: 20, defaultOpacity: 0.95 },
  {
    id: "paint-tube",
    name: "튜브 물감(압출 릴리프)",
    defaultWidth: 30,
    defaultOpacity: 0.96,
    searchAliases: ["물감 튜브", "3D 튜브", "paint tube", "3d tube brush"],
  },
  { id: "airbrush", name: "소프트 에어브러시", defaultWidth: 32, defaultOpacity: 0.7 },
  {
    id: "hard-airbrush",
    name: "하드 에어브러시",
    defaultWidth: 28,
    defaultOpacity: 0.76,
    searchAliases: ["경질 에어브러시", "하드 라운드 분사", "hard airbrush", "hard round airbrush"],
  },
  { id: "airbrush-fine", name: "정밀 에어브러시", defaultWidth: 34, defaultOpacity: 0.85 },
  { id: "wash-brush", name: "물맛 붓(웻엣지)", defaultWidth: 26, defaultOpacity: 0.8 },
  { id: "soft-brush", name: "소프트 브러시", defaultWidth: 36, defaultOpacity: 0.55 },
  { id: "spray", name: "스프레이", defaultWidth: 40, defaultOpacity: 0.55 },
  { id: "splatter", name: "스플래터(흩뿌리기)", defaultWidth: 45, defaultOpacity: 0.65 },
  // —— Texture / dry media ——
  // 흑연 점연필의 겹칠 사다리는 여기 defaultOpacity 가 전부다: 이 브러시들은 별칭 패스 하나를
  // opacityScale 1.0 으로 칠하므로 리본 셀의 알파가 곧 요소 불투명도다. 0.85 에서는 같은 자리를
  // 20번 덧칠해도 평균 농도 82.9 → 91.1 → 95.0 → 97.0 → 97.9 로 5회차부터 멈춘다 — 5회차가
  // 더하는 양이 8비트 한 계단의 0.11 뿐이라 화면에서 같은 픽셀이다. 0.55 는 5회차에도 5.75계단을
  // 더하고 6회차에 0.99 에 닿는 진짜 흑연 사다리를 만들며, 한 획은 여전히 연필선으로 읽힌다.
  // 등급 순서(HB 0.55 < 2B 0.72×0.9=0.65 < 6B 0.85)는 재료 그대로 유지한다.
  // 별칭 프로필의 opacityScale 이 아니라 이 값을 낮추는 이유: defaultOpacity 는 그릴 때
  // DrawEl 에 박히므로 **새 획**만 달라지고 이미 저장된 문서의 획은 한 픽셀도 바뀌지 않는다.
  // opacityScale 은 소급 적용이라 남이 이미 그려 둔 그림을 조용히 흐리게 만든다.
  { id: "pencil", name: "연필", defaultWidth: 2.5, defaultOpacity: 0.55 },
  {
    id: "erodible-pencil",
    name: "마모 연필(닳는 심)",
    defaultWidth: 7,
    defaultOpacity: 0.84,
    searchAliases: ["닳는 연필", "마모 촉", "erodible pencil", "erodible tip"],
  },
  // 2B 도 같은 붕괴였다: 패스 0.9 × 0.88 = 획 알파 0.792, 5회차 증분 0.38계단. 0.72 는 획 알파를
  // 0.65 로 놓아 5회차에 2.49계단을 더한다 — HB 보다 진하고 6B 보다 옅은 등급 순서 그대로다.
  { id: "pencil-2b", name: "2B 드로잉 연필", defaultWidth: 3.5, defaultOpacity: 0.72 },
  // 6B 는 의도적인 예외다. 껍질 8장 + 코어를 합성한 획 알파가 0.8514 라 3회차에 사실상 불투명해
  // 지지만, 눕혀 그은 6B 한 획이 종이를 거의 덮는 것이 재료 그대로다 — 겹칠 사다리를 위해 옅게
  // 만들면 6B 가 아니라 2B 가 된다. 겹칠 회귀 테스트는 이 브러시를 근불투명 행으로 못 박는다.
  { id: "pencil-6b", name: "6B 흑연 연필", defaultWidth: 6, defaultOpacity: 0.9 },
  { id: "soft-pencil", name: "소프트 연필", defaultWidth: 5, defaultOpacity: 0.7 },
  { id: "pencil-grain", name: "그레인 연필", defaultWidth: 4, defaultOpacity: 0.9 },
  { id: "colored-pencil", name: "색연필", defaultWidth: 4.5, defaultOpacity: 0.82 },
  { id: "dry-media", name: "드라이 미디어", defaultWidth: 7, defaultOpacity: 0.92 },
  { id: "crayon", name: "크레용", defaultWidth: 14, defaultOpacity: 0.88 },
  { id: "chalk", name: "초크", defaultWidth: 16, defaultOpacity: 0.8 },
  { id: "charcoal", name: "목탄", defaultWidth: 12, defaultOpacity: 0.88 },
  { id: "pastel", name: "파스텔", defaultWidth: 20, defaultOpacity: 0.72 },
  { id: "oil-pastel", name: "오일 파스텔", defaultWidth: 18, defaultOpacity: 0.85 },
  { id: "ink-particle", name: "잉크 입자", defaultWidth: 8, defaultOpacity: 1.0 },
  {
    id: "tangent-normal-brush",
    name: "탄젠트 노멀 브러시",
    defaultWidth: 20,
    defaultOpacity: 1,
    searchAliases: ["노멀 맵 브러시", "법선 페인트", "tangent normal brush", "normal map brush"],
  },
  {
    id: "sketchpad-tile",
    name: "스케치패드 타일",
    defaultWidth: 18,
    defaultOpacity: 0.92,
    searchAliases: [
      "타일 브러시",
      "패턴 타일",
      "tile brush",
      "sketchpad tile",
      "sketch.io tile",
    ],
  },
  {
    id: "sketchpad-mirror",
    name: "스케치패드 미러",
    defaultWidth: 12,
    defaultOpacity: 0.9,
    searchAliases: [
      "미러 브러시",
      "대칭 획",
      "mirror brush",
      "sketchpad mirror",
      "sketch.io mirror",
    ],
  },
  {
    id: "sketchpad-soft-marker",
    name: "스케치패드 소프트 마커",
    defaultWidth: 22,
    defaultOpacity: 0.72,
    searchAliases: [
      "소프트 마커",
      "스케치 마커",
      "soft marker",
      "sketchpad marker",
      "sketch.io marker",
    ],
  },
  {
    id: "web-multi-agent",
    name: "멀티 에이전트 무리붓",
    defaultWidth: 12,
    defaultOpacity: 0.78,
    searchAliases: [
      "무리 브러시",
      "멀티 펜",
      "bomomo",
      "multi agent brush",
      "swarm brush",
      "웹 드로잉 무리",
    ],
  },
  {
    id: "web-rough-ink",
    name: "러프 핸드 잉크",
    defaultWidth: 7,
    defaultOpacity: 0.92,
    searchAliases: [
      "손그림 잉크",
      "거친 잉크",
      "comic ink",
      "rough ink",
      "sketchy pen",
      "웹 러프 잉크",
    ],
  },
  {
    id: "web-gravity-drip",
    name: "중력 드립 잉크",
    defaultWidth: 14,
    defaultOpacity: 0.88,
    searchAliases: [
      "드립 붓",
      "흘러내림",
      "gravity drip",
      "paint drip",
      "sumo drip",
      "웹 드립",
    ],
  },
  {
    id: "web-soft-cloud",
    name: "소프트 클라우드 스프레이",
    defaultWidth: 26,
    defaultOpacity: 0.55,
    searchAliases: [
      "구름 에어브러시",
      "소프트 스프레이",
      "kleki soft",
      "cloud spray",
      "soft cloud brush",
      "웹 소프트 스프레이",
    ],
  },
  {
    id: "web-calligraphy-ribbon",
    name: "캘리 리본(치즐)",
    defaultWidth: 16,
    defaultOpacity: 0.95,
    searchAliases: [
      "치즐 펜",
      "플랫 캘리",
      "calligraphy chisel",
      "ribbon pen",
      "infinite painter calligraphy",
      "웹 캘리 리본",
    ],
  },
  {
    id: "web-dash-stitch",
    name: "대시 스티치",
    defaultWidth: 5,
    defaultOpacity: 0.9,
    searchAliases: [
      "점선 브러시",
      "스티치",
      "dashed pen",
      "stitch brush",
      "dash stroke",
      "웹 스티치",
    ],
  },
  {
    id: "web-scatter-stamp",
    name: "스캐터 스탬프",
    defaultWidth: 14,
    defaultOpacity: 0.85,
    searchAliases: [
      "스탬프 뿌리기",
      "장식 스탬프",
      "scatter stamp",
      "ibis stamp",
      "fun stamp brush",
      "웹 스캐터",
    ],
  },
  {
    id: "web-rainbow-flow",
    name: "레인보우 플로우",
    defaultWidth: 14,
    defaultOpacity: 0.88,
    searchAliases: [
      "무지개 붓",
      "색상 순환",
      "rainbow brush",
      "hue flow",
      "fun color stroke",
      "웹 레인보우",
    ],
  },
  {
    id: "web-lazy-ink",
    name: "레이지 스무스 잉크",
    defaultWidth: 8,
    defaultOpacity: 0.94,
    searchAliases: [
      "레이지 마우스",
      "스무스 잉크",
      "lazy mouse",
      "stabilizer ink",
      "atrament",
      "웹 레이지 잉크",
    ],
  },
  {
    id: "web-hatch-color",
    name: "해치 채색(평행)",
    defaultWidth: 4,
    defaultOpacity: 0.75,
    searchAliases: [
      "해칭 채색",
      "사선 채색",
      "hatch color",
      "hatching pen",
      "comic hatch",
      "웹 해치 채색",
    ],
  },
  {
    id: "web-cel-flat",
    name: "셀 플랫 마커",
    defaultWidth: 22,
    defaultOpacity: 0.92,
    searchAliases: [
      "플랫 채색",
      "셀 채색",
      "cel shading",
      "flat color marker",
      "anime flat",
      "웹 셀 플랫",
    ],
  },
  {
    id: "web-blend-softener",
    name: "블렌드 소프너",
    defaultWidth: 28,
    defaultOpacity: 0.5,
    searchAliases: [
      "블렌드 툴",
      "부드럽게",
      "magma blend",
      "soft blender",
      "color softener",
      "웹 블렌드",
    ],
  },
  {
    id: "web-dot-tone",
    name: "도트 톤 채색",
    defaultWidth: 10,
    defaultOpacity: 0.8,
    searchAliases: [
      "망점 채색",
      "톤 브러시",
      "dot tone",
      "screentone pen",
      "manga tone",
      "웹 도트 톤",
    ],
  },
  {
    id: "web-kaleido-ink",
    name: "만화경 잉크",
    defaultWidth: 8,
    defaultOpacity: 0.88,
    searchAliases: [
      "방사 대칭",
      "만화경 펜",
      "kaleidoscope",
      "radial symmetry pen",
      "웹 만화경",
    ],
  },
  {
    id: "web-fur-strand",
    name: "퍼 스트랜드",
    defaultWidth: 4,
    defaultOpacity: 0.78,
    searchAliases: [
      "털 브러시",
      "스트랜드",
      "fur brush",
      "strand pen",
      "웹 퍼",
    ],
  },
  {
    id: "web-contour-double",
    name: "더블 컨투어",
    defaultWidth: 5,
    defaultOpacity: 0.92,
    searchAliases: [
      "이중 윤곽",
      "더블 라인",
      "contour double",
      "outline twin",
      "웹 컨투어",
    ],
  },
  {
    id: "web-radial-burst",
    name: "방사 버스트",
    defaultWidth: 3,
    defaultOpacity: 0.85,
    searchAliases: [
      "스피드라인",
      "방사 광선",
      "radial burst",
      "sunburst pen",
      "웹 버스트",
    ],
  },
  {
    id: "web-mirror-ink",
    name: "미러 잉크",
    defaultWidth: 8,
    defaultOpacity: 0.94,
    searchAliases: [
      "대칭 펜",
      "미러 드로잉",
      "mirror ink",
      "axis symmetry",
      "웹 미러",
    ],
  },
  {
    id: "web-grid-ink",
    name: "그리드 스냅 잉크",
    defaultWidth: 6,
    defaultOpacity: 0.95,
    searchAliases: [
      "격자 스냅",
      "그리드 펜",
      "grid snap",
      "pixel assist ink",
      "웹 그리드",
    ],
  },
  {
    id: "web-spiro-orbit",
    name: "스파이로 오빗",
    defaultWidth: 5,
    defaultOpacity: 0.85,
    searchAliases: [
      "스파이로그래프",
      "궤도 펜",
      "spirograph",
      "orbit pen",
      "웹 스파이로",
    ],
  },
  {
    id: "web-zigzag-edge",
    name: "지그재그 엣지",
    defaultWidth: 4,
    defaultOpacity: 0.9,
    searchAliases: [
      "톱니 윤곽",
      "지그재그",
      "zigzag edge",
      "serrated pen",
      "웹 지그재그",
    ],
  },
  {
    id: "web-neon-tube",
    name: "네온 튜브",
    defaultWidth: 10,
    defaultOpacity: 0.9,
    searchAliases: [
      "네온 펜",
      "튜브 네온",
      "neon tube",
      "glow tube pen",
      "웹 네온튜브",
    ],
  },
  {
    id: "web-pressure-flat",
    name: "플랫 필압 잉크",
    defaultWidth: 7,
    defaultOpacity: 0.96,
    searchAliases: [
      "균일 필압",
      "코믹 플랫 선",
      "flat pressure",
      "equalized ink",
      "웹 플랫필압",
    ],
  },
  {
    id: "web-smudge-trail",
    name: "스머지 트레일",
    defaultWidth: 18,
    defaultOpacity: 0.55,
    searchAliases: [
      "잔상 블렌드",
      "스머지 트레일",
      "smudge trail",
      "lag ghost",
      "웹 스머지",
    ],
  },
  {
    id: "web-cross-hatch-pen",
    name: "크로스 해치(교차)",
    defaultWidth: 3,
    defaultOpacity: 0.78,
    searchAliases: [
      "교차 해치",
      "크로스해칭",
      "cross hatch pen",
      "live hatch",
      "웹 크로스해치",
    ],
  },
  { id: "screentone", name: "스크린톤(도트)", defaultWidth: 22, defaultOpacity: 1.0 },
  { id: "crosshatch", name: "크로스 해치(사선)", defaultWidth: 20, defaultOpacity: 0.9 },
  ...listStudioBrushEngineLanePresets(),
]);

export function resolveStudioBrushPresetOperation(
  brushId: unknown
): StudioToolOperation {
  if (typeof brushId !== "string") return "paint";
  return BRUSH_PRESETS.find((preset) => preset.id === brushId)?.operation ?? "paint";
}

/**
 * Rehydrates the tool operation from a persistence-safe core id. Legacy and unknown ids keep the
 * historical pen behavior. `drawMode` remains a compatibility projection for callers that have
 * not migrated to `StudioToolOperation`; catalogue state itself owns `operation` directly.
 */
export function resolveStudioBrushPresetDrawMode(
  brushId: unknown
): "pen" | "eraser" {
  return resolveStudioBrushPresetOperation(brushId) === "erase" ? "eraser" : "pen";
}

/** Canva/PicsArt-style quick size chips (screen px brush width). */
export const STUDIO_BRUSH_SIZE_CHIPS = [
  { id: "xs", label: "XS", width: 2 },
  { id: "s", label: "S", width: 6 },
  { id: "m", label: "M", width: 12 },
  { id: "l", label: "L", width: 24 },
  { id: "xl", label: "XL", width: 40 },
  { id: "xxl", label: "2XL", width: 64 },
] as const;

export type StudioBrushSizeChipId = (typeof STUDIO_BRUSH_SIZE_CHIPS)[number]["id"];

export function nearestStudioBrushSizeChip(width: unknown): StudioBrushSizeChipId {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 6;
  let best: (typeof STUDIO_BRUSH_SIZE_CHIPS)[number] = STUDIO_BRUSH_SIZE_CHIPS[1];
  let dist = Math.abs(w - best.width);
  for (const chip of STUDIO_BRUSH_SIZE_CHIPS) {
    const d = Math.abs(w - chip.width);
    if (d < dist) {
      best = chip;
      dist = d;
    }
  }
  return best.id;
}

/** PicsArt-style quick opacity chips (0–1). */
export const STUDIO_BRUSH_OPACITY_CHIPS = [
  { id: "o20", label: "20%", opacity: 0.2 },
  { id: "o40", label: "40%", opacity: 0.4 },
  { id: "o60", label: "60%", opacity: 0.6 },
  { id: "o80", label: "80%", opacity: 0.8 },
  { id: "o100", label: "100%", opacity: 1 },
] as const;

export type StudioBrushOpacityChipId = (typeof STUDIO_BRUSH_OPACITY_CHIPS)[number]["id"];

export function nearestStudioBrushOpacityChip(opacity: unknown): StudioBrushOpacityChipId {
  const o =
    typeof opacity === "number" && Number.isFinite(opacity)
      ? Math.min(1, Math.max(0, opacity))
      : 1;
  let best: (typeof STUDIO_BRUSH_OPACITY_CHIPS)[number] = STUDIO_BRUSH_OPACITY_CHIPS[4];
  let dist = Math.abs(o - best.opacity);
  for (const chip of STUDIO_BRUSH_OPACITY_CHIPS) {
    const d = Math.abs(o - chip.opacity);
    if (d < dist) {
      best = chip;
      dist = d;
    }
  }
  return best.id;
}

export const BRUSH_PRESSURE_CURVE_PRESETS = [
  { id: "soft", label: "민감하게", exponent: 0.65, description: "약한 압력에도 굵기가 빠르게 올라옵니다." },
  { id: "linear", label: "기본", exponent: 1, description: "입력 필압을 그대로 반영합니다." },
  { id: "firm", label: "단단하게", exponent: 1.8, description: "더 눌러야 굵기가 크게 올라옵니다." },
] as const;

export type BrushPressureCurvePresetId = (typeof BRUSH_PRESSURE_CURVE_PRESETS)[number]["id"];

export function pressureCurvePresetId(value: unknown): BrushPressureCurvePresetId {
  const safe = finiteNumber(value, 1);
  let closest: (typeof BRUSH_PRESSURE_CURVE_PRESETS)[number] = BRUSH_PRESSURE_CURVE_PRESETS[0];
  let distance = Math.abs(safe - closest.exponent);
  for (const preset of BRUSH_PRESSURE_CURVE_PRESETS.slice(1)) {
    const nextDistance = Math.abs(safe - preset.exponent);
    if (nextDistance < distance) {
      closest = preset;
      distance = nextDistance;
    }
  }
  return closest.id;
}

export function pressureCurveValueForPreset(id: unknown): number {
  return BRUSH_PRESSURE_CURVE_PRESETS.find((preset) => preset.id === id)?.exponent ?? 1;
}

// 손떨림 보정 강도 범위(0=끔 ~ 10=최대).
export const STABILIZER_MAX = 10;

/**
 * 라이브 포인터가 화면에서 이 거리(CSS px) 이상 이동했을 때 다음 문서 점을 채택한다.
 * 캔버스 논리 좌표에 상수를 직접 쓰면 줌 배율만큼 체감 간격이 달라지므로 모든 호출부는
 * `strokeSampleDistanceForScale`을 통해 논리 거리로 변환한다.
 */
export const STROKE_SAMPLE_SCREEN_DISTANCE = 1.5;
export const LEGACY_STROKE_RENDER_DISTANCE = 3;

export function strokeSampleDistanceForScale(scale: unknown): number {
  const safeScale = clamp(finiteNumber(scale, 1), 0.01, 64);
  return STROKE_SAMPLE_SCREEN_DISTANCE / safeScale;
}

/**
 * Input density for non-pixel brush families, expressed in CSS pixels then converted to document
 * space. Thin outline engines need the native sub-pixel route: dropping every other 120/240Hz
 * sample before a G-pen/perfect-freehand stroker turns small curves into visible chords. Broad
 * pigment/particle tools interpolate their own dabs, so a slightly wider admission distance avoids
 * feeding expensive material planners redundant stationary points.
 *
 * This changes only newly-authored source density. Persisted `sampleSpacing` remains versioned with
 * the stroke, pixel pencil keeps its exact one-document-pixel grid, and no renderer is asked to
 * retroactively move an already-visible prefix.
 */
export function strokeSampleDistanceForBrushFamily(
  scale: unknown,
  family: StudioBrushRenderFamily
): number {
  const screenDistance = (
    family === "pen"
    || family === "gpen"
    || family === "calligraphy"
    || family === "perfect"
    || family === "pencil"
  )
    ? 0.5
    : (
        family === "marker"
        || family === "highlighter"
        || family === "neon"
        || family === "glow"
      )
      ? 0.75
      : (
          family === "brush"
          || family === "dry-media"
          || family === "pastel"
          || family === "ink-particle"
        )
        ? 0.8
        : 1;
  const safeScale = clamp(finiteNumber(scale, 1), 0.01, 64);
  return screenDistance / safeScale;
}

/** 새 획은 라이브 채택 간격의 두 배로 가볍게 정리하고, 기존 문서는 과거 3px 결과를 유지한다. */
export function strokeRenderDistance(sampleDistance: unknown): number {
  if (typeof sampleDistance !== "number" || !Number.isFinite(sampleDistance) || sampleDistance <= 0) {
    return LEGACY_STROKE_RENDER_DISTANCE;
  }
  return clamp(sampleDistance * 2, 0.05, 128);
}

export interface SmoothStrokeOptions {
  /** true면 넓은 이웃에서 검출한 의도적인 각점을 이동평균으로 둥글리지 않는다. */
  preserveCorners?: boolean;
  /** 진행 방향 변화가 이 각도 이상이면 각점으로 본다. 기본 55°. */
  cornerThresholdDeg?: number;
}

/** 캘리그래피 펜촉의 수동 폴백 설정. roundness는 단축/장축 비율(0.08~1). */
export interface CalligraphyTipSettings {
  tiltEnabled: boolean;
  angleDeg: number;
  roundness: number;
}

/** PointerEvent와 구조적으로 호환되는 최소 스타일러스 입력(테스트·코얼레스트 이벤트 공용). */
export interface CalligraphyStylusInput {
  pointerType?: unknown;
  tiltX?: unknown;
  tiltY?: unknown;
  twist?: unknown;
}

export type NormalizedCalligraphyPointerType = "pen" | "mouse" | "touch" | "unknown";

/** 브라우저/기기 편차를 제거한 유한한 스타일러스 샘플. */
export interface NormalizedCalligraphyStylusInput {
  pointerType: NormalizedCalligraphyPointerType;
  tiltX: number;
  tiltY: number;
  twist: number;
  /** pen 입력이면서 0이 아닌 유효 tilt가 실제로 전달됐는지 여부. */
  hasTilt: boolean;
}

/** Canvas와 SVG가 동일하게 소비할 수 있는 캘리그래피 선분 표현. */
export interface CalligraphySegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  tipAngleRad: number;
  roundness: number;
}

/** 실제 필압과 마우스/터치 속도 폴백을 한 곳에서 판정하기 위한 순수 함수 입력. */
export interface BrushPressureSampleInput {
  pointerType?: unknown;
  rawPressure?: unknown;
  distance?: unknown;
  /** 샘플 사이 실제 경과 시간(ms). 있으면 distance를 px/ms 속도로 정규화한다. */
  elapsedMs?: unknown;
  velocityFallbackEnabled?: boolean;
  velocitySensitivity?: unknown;
  pressureCurve?: unknown;
  /**
   * CSP Size dynamics Min — residual pen/marker floor as 0..1 of selected size.
   * Applied after the pressure curve on hardware/velocity channels only (not mouse fixed fallback).
   */
  minSizeRatio?: unknown;
  /** 속도 폴백이 최소 압력에 도달하는 CSS px/ms. */
  maxVelocity?: unknown;
  /** elapsedMs가 없는 레거시 호출용 샘플 간 최대 거리. */
  maxDistance?: unknown;
  fallbackPressure?: unknown;
}

/**
 * pointerup 전용 필압 입력. `lastContactPressure`는 이미 사용자 곡선까지 적용되어 문서에
 * 저장된 마지막 접촉 필압이므로 다시 곡선을 적용하지 않는다.
 */
export interface BrushReleasePressureSampleInput extends BrushPressureSampleInput {
  lastContactPressure?: unknown;
}

const CALLIGRAPHY_MIN_ROUNDNESS = 0.08;
const CALLIGRAPHY_MIN_BASE_WIDTH = 0.25;
const CALLIGRAPHY_MAX_BASE_WIDTH = 2_048;
const CALLIGRAPHY_MIN_SEGMENT_WIDTH = 0.05;
const CALLIGRAPHY_MAX_SEGMENT_WIDTH = 4_096;
const CALLIGRAPHY_MIN_PRESSURE_SCALE = 0.35;
const CALLIGRAPHY_PRESSURE_SCALE_RANGE = 0.9;
const CALLIGRAPHY_TAP_MIN_RADIUS = 0.35;
const CALLIGRAPHY_TAP_MIN_PRESSURE_SCALE = 0.3;
const CALLIGRAPHY_TAP_PRESSURE_SCALE_RANGE = 1.4;
const DEFAULT_CALLIGRAPHY_SETTINGS: CalligraphyTipSettings = {
  tiltEnabled: true,
  angleDeg: 45,
  roundness: 0.32,
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Largest document-pixel radius that the retained calligraphy renderer can paint for a selected
 * renderer diameter and source-point route.
 *
 * A one-point calligraphy mark takes StudioDrawNode's generic-dot Ellipse route, whose major
 * radius is `max(0.35, effectiveDiameter * (0.3 + pressure * 1.4) / 2)`. Alias pressure profiles
 * can exceed 1, so the compiler supplies the renderer's mapped maximum instead of assuming a
 * normalized source pressure. Multi-point ribbons use `calligraphySegmentStep`: it multiplies the
 * clamped base width by at most `0.35 + 1 * 0.9`, then by the same elliptical projection that
 * `studio-calligraphy-ribbon` divides out when recovering the nib's major radius. Its 0.05px width
 * floor can dominate only at the 0.08 roundness floor, yielding 0.05 / 2 / 0.08 = 0.3125px.
 */
export function studioCalligraphyMaximumNibRadius(
  baseWidth: unknown,
  sourcePointCount: number,
  maximumTapPressure = 1,
): number {
  if (!Number.isSafeInteger(sourcePointCount) || sourcePointCount <= 1) {
    const safeTapBaseWidth = Math.max(0, finiteNumber(baseWidth, 1));
    const safeMaximumTapPressure = Math.max(0, finiteNumber(maximumTapPressure, 1));
    return Math.max(
      CALLIGRAPHY_TAP_MIN_RADIUS,
      safeTapBaseWidth
        * (
          CALLIGRAPHY_TAP_MIN_PRESSURE_SCALE
          + safeMaximumTapPressure * CALLIGRAPHY_TAP_PRESSURE_SCALE_RANGE
        )
        / 2,
    );
  }
  const safeBaseWidth = clamp(
    finiteNumber(baseWidth, 1),
    CALLIGRAPHY_MIN_BASE_WIDTH,
    CALLIGRAPHY_MAX_BASE_WIDTH,
  );
  const pressureRadius = safeBaseWidth
    * (CALLIGRAPHY_MIN_PRESSURE_SCALE + CALLIGRAPHY_PRESSURE_SCALE_RANGE)
    / 2;
  const widthFloorRadius = CALLIGRAPHY_MIN_SEGMENT_WIDTH / 2 / CALLIGRAPHY_MIN_ROUNDNESS;
  return Math.min(
    CALLIGRAPHY_MAX_SEGMENT_WIDTH / 2,
    Math.max(widthFloorRadius, pressureRadius),
  );
}

/**
 * Maps curved pressure into a CSP-style min-size floor: `min + (1 - min) * p`.
 * Invalid ratios collapse to 0 (Magma-compatible zero-pressure coverage).
 */
export function studioBrushPressureWithMinSize(
  pressure01: number,
  minSizeRatio: unknown
): number {
  const pressure = clamp01(finiteNumber(pressure01, 0));
  const min = clamp01(finiteNumber(minSizeRatio, 0));
  if (min <= 0) return pressure;
  return clamp01(min + (1 - min) * pressure);
}

function normalizeDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function normalizeRadians(value: number): number {
  const tau = Math.PI * 2;
  const wrapped = value % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

function normalizePointerType(value: unknown): NormalizedCalligraphyPointerType {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized === "pen" || normalized === "mouse" || normalized === "touch") return normalized;
  return "unknown";
}

/**
 * PointerEvent duck-type 입력을 CSS Pointer Events 범위로 정규화한다.
 * 마우스·터치의 합성 tilt/twist 값은 펜촉 방향으로 오인하지 않도록 버린다.
 */
export function normalizeCalligraphyStylusInput(
  input: CalligraphyStylusInput | null | undefined
): NormalizedCalligraphyStylusInput {
  const pointerType = normalizePointerType(input?.pointerType);
  if (pointerType !== "pen") {
    return { pointerType, tiltX: 0, tiltY: 0, twist: 0, hasTilt: false };
  }

  const tiltX = clamp(finiteNumber(input?.tiltX, 0), -90, 90);
  const tiltY = clamp(finiteNumber(input?.tiltY, 0), -90, 90);
  const twist = clamp(finiteNumber(input?.twist, 0), 0, 359);
  return {
    pointerType,
    tiltX,
    tiltY,
    twist,
    hasTilt: Math.hypot(tiltX, tiltY) > Number.EPSILON,
  };
}

/** 런타임/저장 데이터에서 들어온 캘리그래피 설정을 유한한 렌더 범위로 정규화한다. */
export function sanitizeCalligraphyTipSettings(
  settings: Partial<CalligraphyTipSettings> | null | undefined
): CalligraphyTipSettings {
  return {
    tiltEnabled:
      typeof settings?.tiltEnabled === "boolean"
        ? settings.tiltEnabled
        : DEFAULT_CALLIGRAPHY_SETTINGS.tiltEnabled,
    angleDeg: normalizeDegrees(finiteNumber(settings?.angleDeg, DEFAULT_CALLIGRAPHY_SETTINGS.angleDeg)),
    roundness: clamp(
      finiteNumber(settings?.roundness, DEFAULT_CALLIGRAPHY_SETTINGS.roundness),
      CALLIGRAPHY_MIN_ROUNDNESS,
      1
    ),
  };
}

/**
 * 펜/터치의 유효한 하드웨어 필압을 우선하고, 그렇지 않은 포인터만 이동 거리 기반 의사 필압을
 * 쓴다. Pointer Events 스펙상 압력 센서가 없는 포인터(마우스는 항상, 힘 감지가 없는 터치스크린도
 * 접촉 중엔)는 관례적으로 정확히 0.5를 보고한다 — 이 값은 마우스뿐 아니라 터치에서도 하드웨어
 * 필압에서 제외해야, 실제 힘 감지가 없는 터치 사용자가 굵기 곡선 프리셋(연/강)을 걸어둔 채
 * 그리면 매 획이 이 관례값(0.5)에 곡선이 적용돼 일괄적으로 가늘거나 굵게 나오는 걸 막는다.
 */
export function resolveBrushPressureSample(input: BrushPressureSampleInput = {}): number {
  const pointerType = normalizePointerType(input.pointerType);
  const rawPressure = finiteNumber(input.rawPressure, Number.NaN);
  const hasHardwarePressure = (pointerType === "pen" || pointerType === "touch")
    && rawPressure >= 0 && rawPressure <= 1
    && (pointerType === "pen" || rawPressure !== 0.5);

  let basePressure: number;
  let applyPressureCurve = false;
  if (hasHardwarePressure) {
    basePressure = rawPressure;
    applyPressureCurve = true;
  } else if (input.velocityFallbackEnabled) {
    const distance = Math.max(0, finiteNumber(input.distance, 0));
    const elapsedMs = finiteNumber(input.elapsedMs, Number.NaN);
    const speedRatio = elapsedMs > 0
      ? clamp01((distance / clamp(elapsedMs, 1, 100)) / Math.max(0.01, finiteNumber(input.maxVelocity, 1.6)))
      : clamp01(distance / Math.max(0.001, finiteNumber(input.maxDistance, 28)));
    const sensitivity = clamp01(finiteNumber(input.velocitySensitivity, 0.65));
    basePressure = 1 - speedRatio * sensitivity * 0.75;
    applyPressureCurve = true;
  } else {
    basePressure = clamp01(finiteNumber(input.fallbackPressure, 0.5));
  }

  // A fixed mouse/touch fallback represents the nominal brush width, not simulated pressure.
  // Applying the stylus curve here would make the same cursor render 19% thicker (soft) or 30%
  // thinner (firm). Curves belong only to real pen pressure or the explicitly enabled velocity
  // pressure channel. Min-size floor follows the same rule so mouse nominal width is unchanged.
  if (!applyPressureCurve) return clamp01(basePressure);
  const curve = clamp(finiteNumber(input.pressureCurve, 1), 0.05, 8);
  const curved = clamp01(Math.pow(clamp01(basePressure), curve));
  return studioBrushPressureWithMinSize(curved, input.minSizeRatio);
}

/**
 * 펜이 화면에서 떨어진 pointerup은 Pointer Events 규약상 `pressure=0`을 보고한다. 릴리스
 * 좌표 자체는 빠른 획의 마지막 꼬리로 채택하되, 이 비접촉 0이 실제 마지막 접촉 필압을
 * 덮어쓰지 않게 한다. 일반 pointermove는 계속 `resolveBrushPressureSample`을 사용하므로
 * 접촉 중 장치가 보고한 진짜 0 필압은 그대로 보존된다.
 */
export function resolveBrushReleasePressureSample(
  input: BrushReleasePressureSampleInput = {}
): number {
  const pointerType = normalizePointerType(input.pointerType);
  const rawPressure = finiteNumber(input.rawPressure, Number.NaN);
  if (pointerType === "pen" && rawPressure === 0) {
    const fallbackPressure = clamp01(finiteNumber(input.fallbackPressure, 0.5));
    return clamp01(finiteNumber(input.lastContactPressure, fallbackPressure));
  }
  return resolveBrushPressureSample(input);
}

/**
 * 포인트 스무딩/솎기 뒤의 개수에 맞춰 필압을 선형 재표본화한다.
 * 첫·끝 필압을 보존하며 누락·NaN·Infinity는 fallback으로 치환한다.
 */
export function resampleStrokePressures(
  pressures: readonly number[] | null | undefined,
  outputPointCount: number,
  fallback = 0.5
): number[] {
  const count = Number.isFinite(outputPointCount) ? Math.max(0, Math.floor(outputPointCount)) : 0;
  if (count === 0) return [];

  const safeFallback = clamp01(finiteNumber(fallback, 0.5));
  if (!pressures || pressures.length === 0) return Array(count).fill(safeFallback) as number[];

  if (count === 1) {
    return [clamp01(finiteNumber(pressures[0], safeFallback))];
  }
  if (pressures.length === 1) {
    return Array(count).fill(
      clamp01(finiteNumber(pressures[0], safeFallback))
    ) as number[];
  }

  // Clamp only the two source samples needed by each output station. The previous implementation
  // first allocated a full sanitized copy and then allocated the result, doubling traversal and
  // transient memory on every retained/live symmetry render of a long pressure stroke.
  //
  // An already-aligned journal skips the normalisation entirely. `(index / (count - 1)) *
  // (count - 1)` does not round-trip to `index` in binary floating point — at count = 800 the
  // station for index = 357 lands on 356.99999999999994 and blends in a sliver of its neighbour —
  // so the resampled value of an EARLIER station depended on how long the stroke had grown by.
  // The error is ~1e-15 and invisible, but it broke the byte-equality prefix checks the
  // incremental planners rely on and cost them a full replan per pointer move.
  const result = new Array<number>(count);
  if (pressures.length === count) {
    for (let index = 0; index < count; index++) {
      result[index] = clamp01(finiteNumber(pressures[index], safeFallback));
    }
    return result;
  }
  for (let index = 0; index < count; index++) {
    const sourcePosition = (index / (count - 1)) * (pressures.length - 1);
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(pressures.length - 1, Math.ceil(sourcePosition));
    const amount = sourcePosition - lowerIndex;
    const lower = clamp01(finiteNumber(pressures[lowerIndex], safeFallback));
    const upper = clamp01(finiteNumber(pressures[upperIndex], lower));
    result[index] = clamp01(lower + (upper - lower) * amount);
  }
  return result;
}

function sampleNumberAtProgress(
  values: readonly number[] | null | undefined,
  progress: number,
  fallback: number,
  min: number,
  max: number
): number {
  if (!values || values.length === 0) return fallback;
  if (values.length === 1) return clamp(finiteNumber(values[0], fallback), min, max);
  const sourcePosition = clamp01(progress) * (values.length - 1);
  const lowerIndex = Math.floor(sourcePosition);
  const upperIndex = Math.min(values.length - 1, Math.ceil(sourcePosition));
  const amount = sourcePosition - lowerIndex;
  const lower = clamp(finiteNumber(values[lowerIndex], fallback), min, max);
  const upper = clamp(finiteNumber(values[upperIndex], lower), min, max);
  return clamp(lower + (upper - lower) * amount, min, max);
}

function interpolateTwist(from: number, to: number, amount: number): number {
  const shortestDelta = ((to - from + 540) % 360) - 180;
  return normalizeDegrees(from + shortestDelta * amount);
}

function sampleStylusAtProgress(
  samples: readonly CalligraphyStylusInput[] | null | undefined,
  progress: number
): NormalizedCalligraphyStylusInput {
  if (!samples || samples.length === 0) {
    return { pointerType: "unknown", tiltX: 0, tiltY: 0, twist: 0, hasTilt: false };
  }
  if (samples.length === 1) return normalizeCalligraphyStylusInput(samples[0]);

  const sourcePosition = clamp01(progress) * (samples.length - 1);
  const lowerIndex = Math.floor(sourcePosition);
  const upperIndex = Math.min(samples.length - 1, Math.ceil(sourcePosition));
  const amount = sourcePosition - lowerIndex;
  const lower = normalizeCalligraphyStylusInput(samples[lowerIndex]);
  const upper = normalizeCalligraphyStylusInput(samples[upperIndex]);
  const tiltX = lower.tiltX + (upper.tiltX - lower.tiltX) * amount;
  const tiltY = lower.tiltY + (upper.tiltY - lower.tiltY) * amount;
  return {
    pointerType: lower.pointerType === "pen" || upper.pointerType === "pen" ? "pen" : lower.pointerType,
    tiltX,
    tiltY,
    twist: interpolateTwist(lower.twist, upper.twist, amount),
    hasTilt: (lower.hasTilt || upper.hasTilt) && Math.hypot(tiltX, tiltY) > Number.EPSILON,
  };
}

/**
 * 배치·증분 빌더가 공유하는 선분 하나의 기하 계산. 이동 방향의 법선에 투영된 타원형 펜촉
 * 직경을 width로 계산하고, 다음 선분이 이어받을 travel 각(영거리 스텝은 직전 각 유지)을
 * 함께 돌려준다. 두 빌더의 수치가 여기 한 곳에서 나오므로 라이브/커밋이 함께 움직인다.
 */
function calligraphySegmentStep(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pressure: number,
  stylus: NormalizedCalligraphyStylusInput,
  previousTravelAngle: number,
  safeBaseWidth: number,
  safeSettings: CalligraphyTipSettings,
  fallbackTipAngle: number
): { readonly segment: CalligraphySegment; readonly travelAngle: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const travelAngle = Math.hypot(dx, dy) > Number.EPSILON
    ? Math.atan2(dy, dx)
    : previousTravelAngle;

  let tipAngleRad = fallbackTipAngle;
  let roundness = safeSettings.roundness;
  if (safeSettings.tiltEnabled && stylus.pointerType === "pen") {
    const twistRad = (stylus.twist * Math.PI) / 180;
    if (stylus.hasTilt) {
      const tiltStrength = clamp01(Math.hypot(stylus.tiltX, stylus.tiltY) / 90);
      tipAngleRad = Math.atan2(stylus.tiltY, stylus.tiltX) + twistRad;
      roundness = clamp(
        safeSettings.roundness * (1 - 0.72 * tiltStrength),
        CALLIGRAPHY_MIN_ROUNDNESS,
        1
      );
    } else if (stylus.twist > Number.EPSILON) {
      // 수직으로 세운 펜은 tilt 벡터가 없지만 barrel twist는 여전히 유효할 수 있다.
      tipAngleRad = fallbackTipAngle + twistRad;
    }
  }
  tipAngleRad = normalizeRadians(tipAngleRad);

  const relativeTravelAngle = travelAngle - tipAngleRad;
  const sin = Math.sin(relativeTravelAngle);
  const cos = Math.cos(relativeTravelAngle);
  const ellipticalProjection = Math.sqrt(sin * sin + roundness * roundness * cos * cos);
  const pressureScale = CALLIGRAPHY_MIN_PRESSURE_SCALE
    + pressure * CALLIGRAPHY_PRESSURE_SCALE_RANGE;
  const width = clamp(
    safeBaseWidth * pressureScale * ellipticalProjection,
    CALLIGRAPHY_MIN_SEGMENT_WIDTH,
    CALLIGRAPHY_MAX_SEGMENT_WIDTH,
  );

  return { segment: { x0, y0, x1, y1, width, tipAngleRad, roundness }, travelAngle };
}

/**
 * 점·필압·스타일러스 샘플을 결정적인 캘리그래피 선분으로 변환한다.
 * 각 배열 길이가 달라도 스트로크 진행률로 비례 표본화하며, 이동 방향의 법선에 투영된
 * 타원형 펜촉 직경을 width로 반환해 Canvas/SVG가 같은 결과를 그릴 수 있다.
 */
export function buildCalligraphySegments(
  smoothedPoints: readonly number[],
  pressures: readonly number[] | null | undefined,
  stylusSamples: readonly CalligraphyStylusInput[] | null | undefined,
  baseWidth: number,
  settings: Partial<CalligraphyTipSettings> | null | undefined
): CalligraphySegment[] {
  const pointCount = Math.floor(smoothedPoints.length / 2);
  if (pointCount < 2) return [];

  const safeBaseWidth = clamp(
    finiteNumber(baseWidth, 1),
    CALLIGRAPHY_MIN_BASE_WIDTH,
    CALLIGRAPHY_MAX_BASE_WIDTH,
  );
  const safeSettings = sanitizeCalligraphyTipSettings(settings);
  const fallbackTipAngle = (safeSettings.angleDeg * Math.PI) / 180;
  const segments: CalligraphySegment[] = [];
  let x0 = finiteNumber(smoothedPoints[0], 0);
  let y0 = finiteNumber(smoothedPoints[1], 0);
  let lastTravelAngle = 0;

  for (let pointIndex = 1; pointIndex < pointCount; pointIndex++) {
    const x1 = finiteNumber(smoothedPoints[pointIndex * 2], x0);
    const y1 = finiteNumber(smoothedPoints[pointIndex * 2 + 1], y0);
    const progress = (pointIndex - 0.5) / (pointCount - 1);
    const pressure = sampleNumberAtProgress(pressures, progress, 0.5, 0, 1);
    const stylus = sampleStylusAtProgress(stylusSamples, progress);
    const step = calligraphySegmentStep(
      x0,
      y0,
      x1,
      y1,
      pressure,
      stylus,
      lastTravelAngle,
      safeBaseWidth,
      safeSettings,
      fallbackTipAngle
    );
    segments.push(step.segment);
    lastTravelAngle = step.travelAngle;
    x0 = x1;
    y0 = y1;
  }
  return segments;
}

export interface StudioIncrementalCalligraphySegmentBuilder {
  /**
   * 자라나는 스트로크의 현재 스냅샷을 소비하고 지금까지의 전체 선분 목록을 돌려준다.
   * 이미 소비한 prefix의 선분·표본은 다시 계산하지도 다시 읽지도 않는다 — 포인터 이동 한
   * 번의 비용이 새로 추가된 점 수에만 비례한다. `pressureAt`/`stylusAt`은 점 배열과 나란한
   * 인덱스별 접근자다(배열을 매 이동마다 새로 만들지 않기 위한 형태 — 새 인덱스에서만
   * 호출된다). 반환 배열은 빌더 내부 보관 배열이므로 수정하면 안 된다.
   */
  append(
    flatPoints: readonly number[],
    pressureAt: ((index: number) => number | undefined) | null,
    stylusAt: ((index: number) => CalligraphyStylusInput | null | undefined) | null
  ): readonly CalligraphySegment[];
}

/** 나란한 인덱스별 접근자에서 선분 pointIndex의 중간점 필압. */
function calligraphyMidpointPressureAt(
  pressureAt: ((index: number) => number | undefined) | null,
  pointIndex: number
): number {
  if (!pressureAt) return 0.5;
  const lower = clamp01(finiteNumber(pressureAt(pointIndex - 1), 0.5));
  const upper = clamp01(finiteNumber(pressureAt(pointIndex), lower));
  return clamp01(lower + (upper - lower) * 0.5);
}

/** 나란한 인덱스별 접근자에서 선분 pointIndex의 중간점 스타일러스 표본. */
function calligraphyMidpointStylusAt(
  stylusAt: ((index: number) => CalligraphyStylusInput | null | undefined) | null,
  pointIndex: number
): NormalizedCalligraphyStylusInput {
  if (!stylusAt) {
    return { pointerType: "unknown", tiltX: 0, tiltY: 0, twist: 0, hasTilt: false };
  }
  const lower = normalizeCalligraphyStylusInput(stylusAt(pointIndex - 1));
  const upper = normalizeCalligraphyStylusInput(stylusAt(pointIndex));
  const tiltX = lower.tiltX + (upper.tiltX - lower.tiltX) * 0.5;
  const tiltY = lower.tiltY + (upper.tiltY - lower.tiltY) * 0.5;
  return {
    pointerType: lower.pointerType === "pen" || upper.pointerType === "pen" ? "pen" : lower.pointerType,
    tiltX,
    tiltY,
    twist: interpolateTwist(lower.twist, upper.twist, 0.5),
    hasTilt: (lower.hasTilt || upper.hasTilt) && Math.hypot(tiltX, tiltY) > Number.EPSILON,
  };
}

/**
 * 라이브 오버레이용 증분 캘리그래피 선분 빌더.
 *
 * `buildCalligraphySegments`는 진행률 비례 표본화 때문에 매 이동마다 전체 스트로크를 다시
 * 계산한다(이동당 O(n) → 스트로크당 O(n²) — 장획 게이트가 잡는 바로 그 형태). 입력 표본이
 * 점 배열과 나란할 때(라이브 오버레이가 항상 이 경우다: 필압·스타일러스 모두 점 인덱스별로
 * 만들어진다) 진행률 표본화는 이웃 두 샘플의 정확한 중간점으로 대수적으로 환원되므로, 선분
 * pointIndex는 (점, 표본)의 국소 함수가 되고 유일한 선분 간 상태는 앞으로만 흐르는 travel
 * 각뿐이다 — 즉 append 전용으로 만들 수 있다. 기하 수치는 배치 빌더와 같은
 * `calligraphySegmentStep`에서 나온다(보간 위치가 정확히 0.5라 배치의 (i-0.5)/(n-1)·(n-1)
 * 부동소수 반올림과 최대 1 ulp 차이 — 커밋 시 전체 리플랜이 정본을 다시 그린다).
 *
 * 점 검증은 `pairsFromElement`와 같은 "첫 비유한 좌표에서 절단" 규약을 따르되 새 suffix에만
 * 적용한다(이미 검증한 prefix는 다시 읽지 않는다). prefix가 다시 쓰였는지는 마지막 소비 점
 * 하나로 O(1) 검증하고, 다르면 전체를 다시 만든다(되돌리기·안정화기 재작성 등 — 정확성이
 * 우선, 비용은 그 한 번의 O(n)).
 */
export function createStudioIncrementalCalligraphySegmentBuilder(
  baseWidth: number,
  settings: Partial<CalligraphyTipSettings> | null | undefined
): StudioIncrementalCalligraphySegmentBuilder {
  const safeBaseWidth = clamp(
    finiteNumber(baseWidth, 1),
    CALLIGRAPHY_MIN_BASE_WIDTH,
    CALLIGRAPHY_MAX_BASE_WIDTH,
  );
  const safeSettings = sanitizeCalligraphyTipSettings(settings);
  const fallbackTipAngle = (safeSettings.angleDeg * Math.PI) / 180;
  const segments: CalligraphySegment[] = [];
  let consumedPoints = 0;
  let x0 = 0;
  let y0 = 0;
  let lastTravelAngle = 0;

  const reset = (): void => {
    segments.length = 0;
    consumedPoints = 0;
    x0 = 0;
    y0 = 0;
    lastTravelAngle = 0;
  };

  return {
    append(flatPoints, pressureAt, stylusAt) {
      const pointCount = Math.floor(flatPoints.length / 2);
      if (pointCount < consumedPoints) reset();
      if (consumedPoints > 0) {
        const lastIndex = consumedPoints - 1;
        if (flatPoints[lastIndex * 2] !== x0 || flatPoints[lastIndex * 2 + 1] !== y0) {
          reset();
        }
      }
      if (consumedPoints === 0 && pointCount > 0) {
        const firstX = flatPoints[0];
        const firstY = flatPoints[1];
        if (typeof firstX === "number" && Number.isFinite(firstX)
          && typeof firstY === "number" && Number.isFinite(firstY)) {
          x0 = firstX;
          y0 = firstY;
          consumedPoints = 1;
        }
      }
      for (let pointIndex = consumedPoints; pointIndex >= 1 && pointIndex < pointCount; pointIndex += 1) {
        const x1 = flatPoints[pointIndex * 2];
        const y1 = flatPoints[pointIndex * 2 + 1];
        // 첫 비유한 좌표에서 절단(`pairsFromElement` 규약): 이 점과 그 뒤는 소비하지 않는다.
        if (
          typeof x1 !== "number" || !Number.isFinite(x1)
          || typeof y1 !== "number" || !Number.isFinite(y1)
        ) {
          return segments;
        }
        const step = calligraphySegmentStep(
          x0,
          y0,
          x1,
          y1,
          calligraphyMidpointPressureAt(pressureAt, pointIndex),
          calligraphyMidpointStylusAt(stylusAt, pointIndex),
          lastTravelAngle,
          safeBaseWidth,
          safeSettings,
          fallbackTipAngle
        );
        segments.push(step.segment);
        lastTravelAngle = step.travelAngle;
        x0 = x1;
        y0 = y1;
        consumedPoints = pointIndex + 1;
      }
      return segments;
    },
  };
}

/** 폴리라인 [x0,y0,x1,y1,…] 누적 길이(export·가이드 스냅용). */
export function polylineLength(points: readonly number[]): number {
  if (points.length < 4) return 0;
  let sum = 0;
  for (let i = 2; i < points.length; i += 2) {
    const x0 = points[i - 2]!;
    const y0 = points[i - 1]!;
    const x1 = points[i]!;
    const y1 = points[i + 1]!;
    sum += Math.hypot(x1 - x0, y1 - y0);
  }
  return sum;
}

/** 라이브 드로잉 중 너무 촘촘한 포인트 추가를 건너뛴다(RAF 부하·메모리 절감). */
export function shouldAppendStrokePoint(
  lastX: number,
  lastY: number,
  nextX: number,
  nextY: number,
  minDist = 1.5
): boolean {
  return Math.hypot(nextX - lastX, nextY - lastY) >= minDist;
}

function clampStrength(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.min(STABILIZER_MAX, Math.max(0, strength));
}

/**
 * 손떨림 보정 1단계 — 입력 시점 끌림 보정(지수 이동평균 한 스텝).
 * 직전 확정점(prev)에서 새 입력점(raw)으로 strength가 클수록 천천히 따라간다.
 * strength 0 → 원본 그대로, 10 → 가장 강한 끌림.
 */
export function stabilizePoint(
  prevX: number,
  prevY: number,
  rawX: number,
  rawY: number,
  strength: number
): [number, number] {
  const s = clampStrength(strength);
  if (s === 0) return [rawX, rawY];
  const weight = 1 / (1 + s * 1.4);
  return [prevX + (rawX - prevX) * weight, prevY + (rawY - prevY) * weight];
}

/**
 * 손떨림 보정 2단계 — 스트로크 확정 시 삼각 가중 이동평균 스무딩.
 * 점 개수를 보존(필압 배열과 1:1 정렬 유지)하고 양 끝점은 고정한다.
 * strength 0~10: 0이면 입력 배열을 그대로 반환.
 */
export function smoothStrokePoints(
  points: number[],
  strength: number,
  options: SmoothStrokeOptions = {}
): number[] {
  const s = Math.round(clampStrength(strength));
  if (s === 0 || points.length < 6) return points;

  const radius = Math.max(1, Math.ceil(s / 3)); // 1~4
  const passes = s >= 6 ? 2 : 1;
  const count = Math.floor(points.length / 2);
  const cornerIndices = new Set<number>();
  if (options.preserveCorners && count >= 5) {
    const threshold = clamp(finiteNumber(options.cornerThresholdDeg, 55), 20, 160);
    const neighborhood = Math.max(2, radius * 2);
    const localSpan = Math.min(2, radius);
    const turnAt = (index: number, span: number): number => {
      const beforeIndex = Math.max(0, index - span);
      const afterIndex = Math.min(count - 1, index + span);
      if (beforeIndex === index || afterIndex === index) return 0;
      const beforeX = points[beforeIndex * 2];
      const beforeY = points[beforeIndex * 2 + 1];
      const x = points[index * 2];
      const y = points[index * 2 + 1];
      const afterX = points[afterIndex * 2];
      const afterY = points[afterIndex * 2 + 1];
      if (
        beforeX === undefined || beforeY === undefined || x === undefined || y === undefined
        || afterX === undefined || afterY === undefined
      ) {
        return 0;
      }
      const incomingX = x - beforeX;
      const incomingY = y - beforeY;
      const outgoingX = afterX - x;
      const outgoingY = afterY - y;
      const incomingLength = Math.hypot(incomingX, incomingY);
      const outgoingLength = Math.hypot(outgoingX, outgoingY);
      if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) return 0;
      const cosine = clamp(
        (incomingX * outgoingX + incomingY * outgoingY) / (incomingLength * outgoingLength),
        -1,
        1
      );
      return (Math.acos(cosine) * 180) / Math.PI;
    };
    const localTurns = Array.from({ length: count }, (_, index) => turnAt(index, localSpan));
    for (let i = 1; i < count - 1; i++) {
      const wideTurn = turnAt(i, neighborhood);
      const localTurn = localTurns[i] ?? 0;
      const adjacentAverage = ((localTurns[i - 1] ?? 0) + (localTurns[i + 1] ?? 0)) / 2;
      // 넓은 창에서 방향이 크게 바뀌더라도 원호처럼 곡률이 일정하면 각점이 아니다. 실제
      // 모서리는 좁은 창의 회전량이 충분하고 주변보다 뚜렷한 피크를 이룰 때만 보존한다.
      if (
        wideTurn >= threshold
        && localTurn >= threshold * 0.6
        && localTurn >= adjacentAverage + 12
      ) {
        cornerIndices.add(i);
      }
    }
  }

  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const out = current.slice();
    for (let i = 1; i < count - 1; i++) {
      if (cornerIndices.has(i)) {
        out[i * 2] = points[i * 2]!;
        out[i * 2 + 1] = points[i * 2 + 1]!;
        continue;
      }
      let sx = 0;
      let sy = 0;
      let total = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = Math.min(count - 1, Math.max(0, i + k));
        const w = radius + 1 - Math.abs(k); // 삼각 가중치
        const px = current[j * 2];
        const py = current[j * 2 + 1];
        if (px === undefined || py === undefined) continue;
        sx += px * w;
        sy += py * w;
        total += w;
      }
      if (total > 0) {
        out[i * 2] = sx / total;
        out[i * 2 + 1] = sy / total;
      }
    }
    current = out;
  }
  return current;
}

/**
 * G펜 — 필압(또는 속도 기반 의사 필압) 배열을 세그먼트 굵기 배열로 변환.
 * 압력이 높을수록 굵고, 스트로크 양 끝은 펜촉처럼 가늘게 테이퍼.
 */
export function gpenSegmentWidths(pressures: number[], baseWidth: number): number[] {
  const safeBase = Math.max(0.5, baseWidth);
  const total = pressures.length;
  if (total === 0) return [];
  const taperSpan = Math.min(4, Math.max(1, Math.floor(total / 3)));

  return pressures.map((rawPressure, index) => {
    const p = Math.min(1, Math.max(0, rawPressure));
    let width = safeBase * (0.22 + p * 1.55);
    const fromStart = index;
    const fromEnd = total - 1 - index;
    const edge = Math.min(fromStart, fromEnd);
    if (edge < taperSpan) {
      const t = (edge + 1) / (taperSpan + 1); // 0~1
      width *= 0.35 + 0.65 * t;
    }
    return Math.max(0.4, width);
  });
}

/**
 * 스크린톤(도트) 브러시 — 폴리라인을 따라 "전역 격자에 정렬된" 도트 좌표를 생성.
 * 격자 정렬 덕분에 겹쳐 칠해도 망점 패턴이 균일하게 메워진다(겹침 중복 제거).
 * 반환: [x0, y0, x1, y1, ...] 평탄 배열. 결정적(랜덤 없음).
 */
export function screentoneDotsForStroke(points: number[], brushRadius: number, pitch: number): number[] {
  const r = Math.max(1, brushRadius);
  const p = Math.max(2, pitch);
  if (points.length < 2) return [];

  // 격자 인덱스(ix, iy)를 정수 하나로 패킹 — 문자열 키(`${ix}:${iy}`) 대신 숫자 Set을 써서
  // 스트로크당 수천 번 호출되는 해시 경로에서 문자열 할당/해싱 비용을 없앤다.
  // 망점 격자는 이 바이어스 범위(±1,048,576칸)에 절대 도달하지 않는다.
  const GRID_KEY_BIAS = 1 << 20;
  const GRID_KEY_STRIDE = GRID_KEY_BIAS * 2;
  const seen = new Set<number>();
  const dots: number[] = [];

  const stampAt = (cx: number, cy: number) => {
    const minIx = Math.floor((cx - r) / p);
    const maxIx = Math.ceil((cx + r) / p);
    const minIy = Math.floor((cy - r) / p);
    const maxIy = Math.ceil((cy + r) / p);
    for (let iy = minIy; iy <= maxIy; iy++) {
      // 홀수 행은 반 피치 어긋난 허니컴 배열(망점 느낌).
      const rowOffset = (iy % 2 === 0 ? 0 : 0.5) * p;
      for (let ix = minIx; ix <= maxIx; ix++) {
        const dx = ix * p + rowOffset;
        const dy = iy * p;
        if ((dx - cx) * (dx - cx) + (dy - cy) * (dy - cy) > r * r) continue;
        const key = (iy + GRID_KEY_BIAS) * GRID_KEY_STRIDE + (ix + GRID_KEY_BIAS);
        if (seen.has(key)) continue;
        seen.add(key);
        dots.push(dx, dy);
      }
    }
  };

  // 폴리라인을 일정 간격으로 리샘플하며 도장 찍기.
  const step = Math.max(1, r * 0.5);
  let prevX = points[0];
  let prevY = points[1];
  if (prevX === undefined || prevY === undefined) return [];
  stampAt(prevX, prevY);
  let carried = 0;

  for (let i = 2; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x === undefined || y === undefined) continue;
    const segLen = Math.hypot(x - prevX, y - prevY);
    if (segLen === 0) continue;
    let traveled = step - carried;
    while (traveled <= segLen) {
      const t = traveled / segLen;
      stampAt(prevX + (x - prevX) * t, prevY + (y - prevY) * t);
      traveled += step;
    }
    carried = segLen - (traveled - step);
    prevX = x;
    prevY = y;
  }
  stampAt(prevX, prevY);

  return dots;
}

export interface StudioIncrementalScreentoneDotsBuilder {
  /**
   * 자라나는 획의 현재 스냅샷을 소비하고 배치 `screentoneDotsForStroke`와 값·순서가 정확히
   * 같은 도트 배열을 돌려준다(같은 도장/중복제거 워크를 같은 순서로 잇는다). 이미 소비한 raw
   * prefix 는 다시 읽지 않으며(마지막 소비 쌍 하나로 O(1) 검증), 되돌리기·재작성·반지름/피치
   * 변경이 감지되면 전체를 다시 만든다. 유일한 소급점은 배치가 매 호출 끝에 찍는 끝점 도장
   * 하나다 — 그 도장의 도트와 격자 키를 기록해 두고 다음 호출에서 걷어낸 뒤 이어 걷는다.
   * 반환 배열은 내부 보관 배열이므로 수정하면 안 된다.
   */
  plan(points: readonly number[], brushRadius: number, pitch: number): number[];
}

export function createStudioIncrementalScreentoneDotsBuilder(): StudioIncrementalScreentoneDotsBuilder {
  let configR = 0;
  let configP = 0;
  const seen = new Set<number>();
  const dots: number[] = [];
  let consumedPairs = 0;
  let lastRawX = 0;
  let lastRawY = 0;
  let prevX = 0;
  let prevY = 0;
  let carried = 0;
  /** 지난 호출의 끝점 도장이 추가한 도트 수와 격자 키 — 다음 호출에서 되돌린다. */
  let endStampDotStart = 0;
  const endStampKeys: number[] = [];

  const GRID_KEY_BIAS = 1 << 20;
  const GRID_KEY_STRIDE = GRID_KEY_BIAS * 2;

  const reset = (): void => {
    seen.clear();
    dots.length = 0;
    consumedPairs = 0;
    carried = 0;
    endStampDotStart = 0;
    endStampKeys.length = 0;
  };

  /** 배치 `stampAt` 그대로 — recordKeys 가 있으면 새로 추가한 격자 키를 기록한다. */
  const stampAt = (cx: number, cy: number, recordKeys: number[] | null): void => {
    const r = configR;
    const p = configP;
    const minIx = Math.floor((cx - r) / p);
    const maxIx = Math.ceil((cx + r) / p);
    const minIy = Math.floor((cy - r) / p);
    const maxIy = Math.ceil((cy + r) / p);
    for (let iy = minIy; iy <= maxIy; iy++) {
      const rowOffset = (iy % 2 === 0 ? 0 : 0.5) * p;
      for (let ix = minIx; ix <= maxIx; ix++) {
        const dx = ix * p + rowOffset;
        const dy = iy * p;
        if ((dx - cx) * (dx - cx) + (dy - cy) * (dy - cy) > r * r) continue;
        const key = (iy + GRID_KEY_BIAS) * GRID_KEY_STRIDE + (ix + GRID_KEY_BIAS);
        if (seen.has(key)) continue;
        seen.add(key);
        if (recordKeys) recordKeys.push(key);
        dots.push(dx, dy);
      }
    }
  };

  return {
    plan(points, brushRadius, pitch) {
      const r = Math.max(1, brushRadius);
      const p = Math.max(2, pitch);
      const pairCount = Math.floor(points.length / 2);
      if (points.length < 2) {
        reset();
        configR = r;
        configP = p;
        return [];
      }
      if (r !== configR || p !== configP || pairCount < consumedPairs) {
        reset();
        configR = r;
        configP = p;
      }
      if (consumedPairs > 0) {
        const lastIndex = consumedPairs - 1;
        if (
          points[lastIndex * 2] !== lastRawX
          || points[lastIndex * 2 + 1] !== lastRawY
        ) {
          reset();
        }
      }

      // 휘발 꼬리 되돌리기: 지난 호출의 끝점 도장을 걷는다.
      for (const key of endStampKeys) seen.delete(key);
      endStampKeys.length = 0;
      dots.length = endStampDotStart;

      const step = Math.max(1, r * 0.5);
      for (let index = consumedPairs; index < pairCount; index += 1) {
        const x = points[index * 2]!;
        const y = points[index * 2 + 1]!;
        if (index === 0) {
          prevX = x;
          prevY = y;
          stampAt(prevX, prevY, null);
        } else {
          // 배치 루프 본문 그대로(carried 이월식 포함 — 비트 동일 재생).
          const segLen = Math.hypot(x - prevX, y - prevY);
          if (segLen !== 0) {
            let traveled = step - carried;
            while (traveled <= segLen) {
              const t = traveled / segLen;
              stampAt(prevX + (x - prevX) * t, prevY + (y - prevY) * t, null);
              traveled += step;
            }
            carried = segLen - (traveled - step);
            prevX = x;
            prevY = y;
          }
        }
        lastRawX = x;
        lastRawY = y;
        consumedPairs = index + 1;
      }

      // 끝점 도장(휘발): 도트/키를 기록해 다음 호출이 걷을 수 있게 한다.
      endStampDotStart = dots.length;
      stampAt(prevX, prevY, endStampKeys);
      return dots;
    },
  };
}

const INCREMENTAL_SCREENTONE_CACHE = new Map<
  string,
  StudioIncrementalScreentoneDotsBuilder
>();
/** 활성 초안은 하나지만 draft/commit 리렌더가 겹치는 짧은 창을 위해 소수의 최근 획을 유지한다. */
const INCREMENTAL_SCREENTONE_CACHE_LIMIT = 8;

/**
 * 획 키(요소 id)로 보관된 증분 스크린톤 도트 플랜 — `StudioDrawNode` 활성 초안의
 * `screentoneDotsForStroke` 자리 교체용. 반환 배열은 내부 보관 배열이므로 수정하면 안 된다.
 */
export function screentoneDotsForStrokeIncremental(
  strokeKey: string,
  points: readonly number[],
  brushRadius: number,
  pitch: number,
): number[] {
  let builder = INCREMENTAL_SCREENTONE_CACHE.get(strokeKey);
  if (builder) {
    // LRU 갱신: 재삽입으로 삽입 순서를 최근 사용 순서로 유지한다.
    INCREMENTAL_SCREENTONE_CACHE.delete(strokeKey);
  } else {
    builder = createStudioIncrementalScreentoneDotsBuilder();
  }
  INCREMENTAL_SCREENTONE_CACHE.set(strokeKey, builder);
  while (INCREMENTAL_SCREENTONE_CACHE.size > INCREMENTAL_SCREENTONE_CACHE_LIMIT) {
    const oldest = INCREMENTAL_SCREENTONE_CACHE.keys().next().value;
    if (oldest === undefined) break;
    INCREMENTAL_SCREENTONE_CACHE.delete(oldest);
  }
  return builder.plan(points, brushRadius, pitch);
}

/** 스크린톤 도트 반지름(피치에 비례하는 망점 크기). */
export function screentoneDotRadius(pitch: number): number {
  return Math.max(0.8, pitch * 0.32);
}

// Simple deterministic hash function for pencil jitter (flashing-free noise)
function hash(n: number): number {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

/**
 * Thins and smooths a list of 2D points [x0, y0, x1, y1, ...].
 * 1. Thinning: discards points that are too close to the previous point.
 * 2. Smoothing: applies a weighted moving average to remove high-frequency jitter.
 */
export function processFreehandPoints(
  points: number[],
  minDistance = LEGACY_STROKE_RENDER_DISTANCE
): number[] {
  if (points.length < 4) return points;

  const safeMinDistance = clamp(
    finiteNumber(minDistance, LEGACY_STROKE_RENDER_DISTANCE),
    0,
    128
  );

  // 1. Light point-thinning (distance thresholding with endpoint & curvature guard)
  const thinned: number[] = [points[0], points[1]];
  let lastX = points[0];
  let lastY = points[1];
  
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x === undefined || y === undefined) continue;

    const dist = Math.hypot(x - lastX, y - lastY);
    // Keep point if it is at least safeMinDistance away or it is the very last point in the path
    if (dist >= safeMinDistance || i === points.length - 2) {
      thinned.push(x, y);
      lastX = x;
      lastY = y;
    }
  }

  // 2. High-precision 5-sample Gaussian smoothing kernel preserving crisp corners
  if (thinned.length < 6) return thinned;
  const smoothed: number[] = [thinned[0]!, thinned[1]!];

  for (let i = 2; i < thinned.length - 2; i += 2) {
    const prevX = thinned[i - 2]!;
    const prevY = thinned[i - 1]!;
    const currX = thinned[i]!;
    const currY = thinned[i + 1]!;
    const nextX = thinned[i + 2]!;
    const nextY = thinned[i + 3]!;

    // Detect sharp directional changes so intentional corners (> 60 deg) remain crisp while smooth curves are silky
    const dx1 = currX - prevX;
    const dy1 = currY - prevY;
    const dx2 = nextX - currX;
    const dy2 = nextY - currY;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    const dot = len1 > 0 && len2 > 0 ? (dx1 * dx2 + dy1 * dy2) / (len1 * len2) : 1;

    if (dot < 0.45) {
      // Preserve sharp corners
      smoothed.push(currX, currY);
    } else {
      // Smooth 0.25 / 0.5 / 0.25 weighting for natural handwriting feel
      const sx = 0.25 * prevX + 0.5 * currX + 0.25 * nextX;
      const sy = 0.25 * prevY + 0.5 * currY + 0.25 * nextY;
      smoothed.push(sx, sy);
    }
  }

  smoothed.push(thinned[thinned.length - 2]!, thinned[thinned.length - 1]!);
  return smoothed;
}

export interface StudioFreehandRenderPathOptions {
  /**
   * 새 입력 파이프라인이 획 생성 시 기록한 문서 좌표 샘플 간격.
   * 유한한 숫자가 있으면 이미 채택·보정된 점이므로 다시 스무딩하지 않는다.
   */
  sampleSpacing: unknown;
  /** 기존 문서에만 적용할 과거 Konva tension 값. */
  legacyTension: number;
  /**
   * 이미 채택된 새 입력점을 다시 이동평균하지 않으면서 연결형 Line 엔진이 적용할 장력.
   * 생략하면 causal prefix의 과거 픽셀을 고정하는 기존 값 0을 유지한다.
   */
  acceptedTension?: number;
  /** 기존 문서의 점 정리에 적용할 최소 거리. 생략하면 과거 3px 규칙을 쓴다. */
  legacyMinDistance?: number;
}

export interface StudioFreehandRenderPath {
  points: number[];
  tension: number;
}

/**
 * 저장된 획 버전에 맞는 렌더 경로를 고른다.
 *
 * 새 획의 points는 입력 단계에서 이미 채택·보정된 확정 샘플이다. 렌더 단계에서
 * 다시 이동평균이나 곡선 tension을 적용하면 뒤에 점이 추가될 때 앞부분의 픽셀이
 * 다시 움직이므로 원본 배열을 그대로 사용한다. sampleSpacing이 없는 레거시 문서는
 * 과거의 processFreehandPoints + tension 결과를 유지한다.
 */
export function resolveStudioFreehandRenderPath(
  points: number[],
  {
    sampleSpacing,
    legacyTension,
    acceptedTension = 0,
    legacyMinDistance = LEGACY_STROKE_RENDER_DISTANCE,
  }: StudioFreehandRenderPathOptions
): StudioFreehandRenderPath {
  if (typeof sampleSpacing === "number" && Number.isFinite(sampleSpacing)) {
    return {
      points,
      tension: typeof acceptedTension === "number" && Number.isFinite(acceptedTension)
        ? Math.min(1, Math.max(0, acceptedTension))
        : 0,
    };
  }

  return {
    points: processFreehandPoints(points, legacyMinDistance),
    tension: legacyTension,
  };
}

/**
 * Applies a stable deterministic jitter to points [x0, y0, ...] to simulate a pencil texture.
 */
export function processPencilPoints(points: number[]): number[] {
  const output: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x === undefined || y === undefined) continue;

    // Stable, deterministic offset between -0.75 and 0.75 pixels
    const dx = (hash(i * 17 + 5) - 0.5) * 1.5;
    const dy = (hash(i * 31 + 13) - 0.5) * 1.5;
    output.push(x + dx, y + dy);
  }
  return output;
}
