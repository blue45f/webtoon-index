/**
 * Document paper surface catalog — UI labels/groups for {@link PaperGrainKind}.
 *
 * Physics live in `studio-paper-texture` presets; this module only describes how
 * artists pick and preview a sheet. Brush response still comes from
 * `studio-paper-brush-response` (charcoal reacts more than technical pen).
 */

import {
  DEFAULT_STUDIO_PAPER_SURFACE,
  type StudioPaperSurfaceSettings,
} from "./studio-paper-granulation-runtime";
import {
  DEFAULT_PAPER_GRAIN_KIND,
  PAPER_GRAIN_KINDS,
  PAPER_TEXTURE_PRESETS,
  getStudioPaperPhysicsProfile,
  type PaperGrainKind,
} from "./studio-paper-texture";

import type { StudioLivingInkMaterialControls } from "../studio-living-ink-gpu-protocol";

export type StudioPaperSurfaceGroup =
  | "watercolor"
  | "drawing"
  | "oriental"
  | "specialty";

/** Living Ink material axes driven by the document paper catalog (shared names). */
export interface StudioPaperLivingInkMaterialAxes {
  readonly paperFiber: number;
  readonly paperTooth: number;
  readonly granulation: number;
}

export interface StudioPaperSurfaceCatalogEntry {
  readonly id: PaperGrainKind;
  readonly label: string;
  readonly shortLabel: string;
  /** Compact, outcome-first cue shown in the picker. */
  readonly cue: string;
  readonly description: string;
  readonly bestFor: string;
  readonly group: StudioPaperSurfaceGroup;
  /** Soft UI swatch tint (not baked into strokes — page `bg` still owns fill color). */
  readonly swatch: string;
  /** Relative tooth 0..1 for compact previews (from amplitude × toothBias). */
  readonly tooth: number;
  /** Suggested page background when user opts into tint-with-paper. */
  readonly tintBg: string;
  /** Living Ink paper axes — same catalog language as document paper. */
  readonly livingInk: StudioPaperLivingInkMaterialAxes;
}

export type StudioPaperSurfaceCharacteristicId =
  | "tooth"
  | "absorbency"
  | "bleed"
  | "friction";

export interface StudioPaperSurfaceCharacteristic {
  readonly id: StudioPaperSurfaceCharacteristicId;
  readonly label: string;
  readonly value: number;
  readonly valueLabel: string;
}

const GROUP_ORDER: readonly StudioPaperSurfaceGroup[] = [
  "watercolor",
  "drawing",
  "oriental",
  "specialty",
];

export const STUDIO_PAPER_SURFACE_GROUP_LABELS: Readonly<
  Record<StudioPaperSurfaceGroup, string>
> = Object.freeze({
  watercolor: "수채·회화",
  drawing: "스케치·선화",
  oriental: "동양화·수묵",
  specialty: "특수 매체",
});

function toothScore(kind: PaperGrainKind): number {
  const params = PAPER_TEXTURE_PRESETS[kind];
  return Math.min(1, Math.max(0, params.amplitude * (0.55 + params.toothBias * 0.35)));
}

function livingInkAxes(kind: PaperGrainKind): StudioPaperLivingInkMaterialAxes {
  const params = PAPER_TEXTURE_PRESETS[kind];
  const physics = getStudioPaperPhysicsProfile(kind);
  const tooth = toothScore(kind);
  // Fibre from anisotropy + absorbency (oriental sheets read as high fibre).
  const fiber = Math.min(
    1,
    Math.max(
      0,
      (params.fibreAnisotropy - 0.85) / 1.5 * 0.72 + physics.absorbency * 0.28,
    ),
  );
  // Granulation couples heightmap tooth with physics toothGain / contact friction.
  const gran = Math.min(
    1,
    Math.max(
      0,
      params.amplitude * 0.4
        + tooth * 0.28
        + physics.toothGain * 0.18
        + physics.contactFriction * 0.14,
    ),
  );
  return Object.freeze({
    paperFiber: Number(fiber.toFixed(3)),
    paperTooth: Number(Math.min(1, tooth * 0.55 + physics.toothGain * 0.45).toFixed(3)),
    granulation: Number(gran.toFixed(3)),
  });
}

/**
 * Catalog rows in display order. Every {@link PAPER_GRAIN_KINDS} entry must appear exactly once.
 */
export const STUDIO_PAPER_SURFACE_CATALOG: readonly StudioPaperSurfaceCatalogEntry[] = Object.freeze([
  {
    id: "cold-press",
    label: "수채 중목",
    shortLabel: "중목",
    cue: "균형 · 자연스러운 과립",
    description: "완만한 굴곡과 중간 흡수로 안료가 골에 자연스럽게 모입니다. 선명한 붓자국과 부드러운 번짐이 균형을 이룹니다.",
    bestFor: "일반 수채, 워시, 풍경",
    group: "watercolor",
    swatch: "#f4efe6",
    tintBg: "#f4efe6",
    tooth: toothScore("cold-press"),
    livingInk: livingInkAxes("cold-press"),
  },
  {
    id: "hot-press",
    label: "수채 세목",
    shortLabel: "세목",
    cue: "매끈 · 또렷한 선",
    description: "눌러 만든 매끈한 표면이라 번짐과 과립이 적고 가장자리가 또렷합니다. 섬세한 선과 평평한 워시를 유지하기 좋습니다.",
    bestFor: "세필, 펜 선화, 균일 워시",
    group: "watercolor",
    swatch: "#f7f4ef",
    tintBg: "#f7f4ef",
    tooth: toothScore("hot-press"),
    livingInk: livingInkAxes("hot-press"),
  },
  {
    id: "rough",
    label: "수채 황목",
    shortLabel: "황목",
    cue: "거침 · 강한 과립",
    description: "굵고 깊은 요철이 물과 안료를 강하게 붙잡아 얼룩과 과립이 크게 드러납니다. 마른 붓은 봉우리에서 자연스럽게 끊깁니다.",
    bestFor: "드라이브러시, 풍경, 질감 수채",
    group: "watercolor",
    swatch: "#efe6d6",
    tintBg: "#efe6d6",
    tooth: toothScore("rough"),
    livingInk: livingInkAxes("rough"),
  },
  {
    id: "bristol",
    label: "브리스톨",
    shortLabel: "브리스톨",
    cue: "초평활 · 번짐 억제",
    description: "단단하고 매우 매끈해 마찰과 흡수가 낮고 선이 깨끗하게 이어집니다. 여러 번 덧그어도 종이 결이 획을 거의 방해하지 않습니다.",
    bestFor: "잉크, 마커, 정밀 일러스트",
    group: "drawing",
    swatch: "#faf8f5",
    tintBg: "#faf8f5",
    tooth: toothScore("bristol"),
    livingInk: livingInkAxes("bristol"),
  },
  {
    id: "newsprint",
    label: "신문지",
    shortLabel: "신문지",
    cue: "미세결 · 빠른 흡수",
    description: "미세한 결이 있지만 흡수가 빨라 연필 가루와 묽은 잉크가 빠르게 자리 잡습니다. 반복 수정하면 표면이 쉽게 탁해지는 느낌을 냅니다.",
    bestFor: "제스처 드로잉, 러프 스케치",
    group: "drawing",
    swatch: "#ece7dc",
    tintBg: "#ece7dc",
    tooth: toothScore("newsprint"),
    livingInk: livingInkAxes("newsprint"),
  },
  {
    id: "kraft",
    label: "크라프트",
    shortLabel: "크라프트",
    cue: "중간결 · 건식 마찰",
    description: "중간 정도의 이빨이 연필과 콩테 가루를 적당히 붙잡습니다. 종이 톤을 배경에 적용하면 밝은 재료와 어두운 재료를 함께 쓰기 좋습니다.",
    bestFor: "연필, 콩테, 화이트 하이라이트",
    group: "drawing",
    swatch: "#d9c4a0",
    tintBg: "#d9c4a0",
    tooth: toothScore("kraft"),
    livingInk: livingInkAxes("kraft"),
  },
  {
    id: "washi",
    label: "한지",
    shortLabel: "한지",
    cue: "장섬유 · 방향성 번짐",
    description: "긴 섬유 방향을 따라 물과 먹이 퍼져 가장자리가 부드럽고 유기적으로 갈라집니다. 종이 결의 방향성이 획 안에서도 비교적 또렷합니다.",
    bestFor: "수묵, 캘리그래피, 동양화",
    group: "oriental",
    swatch: "#f2ebe0",
    tintBg: "#f2ebe0",
    tooth: toothScore("washi"),
    livingInk: livingInkAxes("washi"),
  },
  {
    id: "canvas",
    label: "캔버스 천",
    shortLabel: "캔버스",
    cue: "굵은 직조 · 물감 걸림",
    description: "씨실과 날실의 굵은 교차가 반복되어 두꺼운 물감이 봉우리에 걸리고 골에는 덜 닿습니다. 붓의 끊김과 물감 덩어리가 규칙적으로 드러납니다.",
    bestFor: "유화, 아크릴, 임파스토",
    group: "specialty",
    swatch: "#e8dfd0",
    tintBg: "#e8dfd0",
    tooth: toothScore("canvas"),
    livingInk: livingInkAxes("canvas"),
  },
  {
    id: "charcoal",
    label: "목탄지",
    shortLabel: "목탄지",
    cue: "깊은 이빨 · 가루 고정",
    description: "깊고 불규칙한 이빨이 목탄과 콩테 가루를 강하게 붙잡아 진한 입자와 흰 틈을 함께 만듭니다. 약한 압력에서도 종이 결이 적극적으로 드러납니다.",
    bestFor: "목탄, 콩테, 흑연",
    group: "specialty",
    swatch: "#e6ddd0",
    tintBg: "#e6ddd0",
    tooth: toothScore("charcoal"),
    livingInk: livingInkAxes("charcoal"),
  },
  {
    id: "pastel-board",
    label: "파스텔지",
    shortLabel: "파스텔",
    cue: "거친 이빨 · 층쌓기",
    description: "고른 중강도 이빨이 파스텔 입자를 붙잡아 여러 색을 겹쳐도 표면 여유가 남습니다. 목탄지보다 패턴은 균일하고 샌디드지보다 마찰은 부드럽습니다.",
    bestFor: "소프트 파스텔, 크레용, 색연필",
    group: "specialty",
    swatch: "#ebe4d8",
    tintBg: "#ebe4d8",
    tooth: toothScore("pastel-board"),
    livingInk: livingInkAxes("pastel-board"),
  },
  {
    id: "cotton-rag",
    label: "면 수채지",
    shortLabel: "면지",
    cue: "부드러운 섬유 · 고른 흡수",
    description: "부드러운 면 섬유가 물을 고르게 받아들이면서 중목에 가까운 요철을 유지합니다. 워시를 여러 겹 쌓거나 다시 걷어낼 때 자연스러운 얼룩이 남습니다.",
    bestFor: "다층 워시, 리프팅, 보존 수채",
    group: "watercolor",
    swatch: "#f3eee5",
    tintBg: "#f3eee5",
    tooth: toothScore("cotton-rag"),
    livingInk: livingInkAxes("cotton-rag"),
  },
  {
    id: "watercolor-block",
    label: "수채 블록",
    shortLabel: "블록",
    cue: "중간결 · 워시 제어",
    description: "표면 사이징이 강해 물이 곧바로 스며들지 않고 잠시 머뭅니다. 중목의 결은 남기면서 번짐 경계와 평면 워시를 더 쉽게 제어할 수 있습니다.",
    bestFor: "평면 워시, 일러스트 수채",
    group: "watercolor",
    swatch: "#f5f0e8",
    tintBg: "#f5f0e8",
    tooth: toothScore("watercolor-block"),
    livingInk: livingInkAxes("watercolor-block"),
  },
  {
    id: "linen-canvas",
    label: "린넨 캔버스",
    shortLabel: "린넨",
    cue: "촘촘한 직조 · 세밀한 터치",
    description: "일반 캔버스보다 촘촘하고 얕은 직조가 반복되어 물감 걸림은 유지하면서도 작은 붓자국이 덜 끊깁니다. 세밀한 회화 표현에 유리합니다.",
    bestFor: "세필 유화, 아크릴, 인물화",
    group: "specialty",
    swatch: "#e6dccb",
    tintBg: "#e6dccb",
    tooth: toothScore("linen-canvas"),
    livingInk: livingInkAxes("linen-canvas"),
  },
  {
    id: "marker-pad",
    label: "마커 패드",
    shortLabel: "마커지",
    cue: "초평활 · 최소 흡수",
    description: "흡수와 마찰이 가장 낮은 축이라 마커 잉크가 표면에서 고르게 이어지고 번짐이 거의 없습니다. 종이 결은 아주 미세하게만 보입니다.",
    bestFor: "알코올 마커, 브러시펜, 렌더링",
    group: "drawing",
    swatch: "#fbfaf7",
    tintBg: "#fbfaf7",
    tooth: toothScore("marker-pad"),
    livingInk: livingInkAxes("marker-pad"),
  },
  {
    id: "manga-paper",
    label: "만화 원고지",
    shortLabel: "원고지",
    cue: "미세결 · 날카로운 선",
    description: "펜촉이 걸리지 않을 만큼 미세한 결과 낮은 흡수로 선의 시작과 끝이 날카롭게 남습니다. 마커지보다 약간의 마찰이 있어 펜 제어감이 있습니다.",
    bestFor: "G펜, 스쿨펜, 만화 선화",
    group: "drawing",
    swatch: "#f8f6f1",
    tintBg: "#f8f6f1",
    tooth: toothScore("manga-paper"),
    livingInk: livingInkAxes("manga-paper"),
  },
  {
    id: "toned-tan",
    label: "톤 스케치(탄)",
    shortLabel: "탄톤",
    cue: "중간결 · 따뜻한 중간톤",
    description: "연필 가루가 자연스럽게 걸리는 중간 결입니다. 권장 탄색 배경을 적용하면 종이색을 중간 명도로 삼아 어둠과 흰 하이라이트를 함께 쌓기 좋습니다.",
    bestFor: "연필, 콩테, 화이트 포인트",
    group: "drawing",
    swatch: "#d8c3a2",
    tintBg: "#d8c3a2",
    tooth: toothScore("toned-tan"),
    livingInk: livingInkAxes("toned-tan"),
  },
  {
    id: "toned-gray",
    label: "톤 스케치(회색)",
    shortLabel: "회톤",
    cue: "중간결 · 중성 중간톤",
    description: "탄톤보다 조금 더 고르고 중성적인 결입니다. 권장 회색 배경을 적용하면 색온도에 치우치지 않고 밝고 어두운 값을 동시에 비교하기 쉽습니다.",
    bestFor: "명암 스케치, 마커, 색연필",
    group: "drawing",
    swatch: "#cfc9c0",
    tintBg: "#cfc9c0",
    tooth: toothScore("toned-gray"),
    livingInk: livingInkAxes("toned-gray"),
  },
  {
    id: "sanded-pastel",
    label: "샌디드 파스텔",
    shortLabel: "샌디드",
    cue: "사포결 · 최고 마찰",
    description: "사포처럼 매우 강한 이빨이 건식 입자를 깊게 고정해 가장 많은 층을 쌓을 수 있습니다. 약한 압력에서도 거친 흰 틈과 진한 입자 침착이 크게 나타납니다.",
    bestFor: "파스텔 다층화, 목탄, 혼합 건식",
    group: "specialty",
    swatch: "#e4d9c8",
    tintBg: "#e4d9c8",
    tooth: toothScore("sanded-pastel"),
    livingInk: livingInkAxes("sanded-pastel"),
  },
  {
    id: "rice-paper",
    label: "선화지",
    shortLabel: "선화지",
    cue: "가느다란 장섬유 · 빠른 번짐",
    description: "가느다란 장섬유가 물과 먹을 빠르게 끌어당겨 획 가장자리가 섬유 방향으로 길게 퍼집니다. 한지보다 표면은 얇고 번짐 반응은 더 즉각적입니다.",
    bestFor: "먹선, 담채, 캘리그래피",
    group: "oriental",
    swatch: "#f4efe6",
    tintBg: "#f4efe6",
    tooth: toothScore("rice-paper"),
    livingInk: livingInkAxes("rice-paper"),
  },
  {
    id: "mulberry",
    label: "닥지(두꺼운 한지)",
    shortLabel: "닥지",
    cue: "성긴 장섬유 · 풍부한 번짐",
    description: "성기고 굵은 닥 섬유와 깊은 골이 물을 많이 받아 불규칙한 발묵과 진한 침착을 만듭니다. 선화지보다 결이 크고 번짐 덩어리도 풍부합니다.",
    bestFor: "발묵, 수묵 워시, 질감 콜라주",
    group: "oriental",
    swatch: "#efe6d8",
    tintBg: "#efe6d8",
    tooth: toothScore("mulberry"),
    livingInk: livingInkAxes("mulberry"),
  },
  {
    id: "vellum",
    label: "벨럼",
    shortLabel: "벨럼",
    cue: "고른 미세결 · 절제된 번짐",
    description: "미세하고 균일한 결이 연필에는 가벼운 마찰을 주면서 잉크 번짐은 억제합니다. 매끈한 선과 은은한 건식 질감을 함께 쓰기 좋습니다.",
    bestFor: "연필, 잉크, 트레이싱 혼합",
    group: "drawing",
    swatch: "#f6f2ea",
    tintBg: "#f6f2ea",
    tooth: toothScore("vellum"),
    livingInk: livingInkAxes("vellum"),
  },
]);

/** Fail closed: catalog and physics tables must stay in lockstep. */
export function assertStudioPaperSurfaceCatalogComplete(): void {
  const ids = new Set(STUDIO_PAPER_SURFACE_CATALOG.map((entry) => entry.id));
  for (const kind of PAPER_GRAIN_KINDS) {
    if (!ids.has(kind)) {
      throw new Error(`Paper surface catalog missing kind: ${kind}`);
    }
  }
  if (ids.size !== PAPER_GRAIN_KINDS.length) {
    throw new Error("Paper surface catalog has extra or duplicate kinds");
  }
}

export function getStudioPaperSurfaceCatalogEntry(
  kind: PaperGrainKind | unknown,
): StudioPaperSurfaceCatalogEntry {
  const id = typeof kind === "string" && PAPER_GRAIN_KINDS.includes(kind as PaperGrainKind)
    ? (kind as PaperGrainKind)
    : DEFAULT_PAPER_GRAIN_KIND;
  return STUDIO_PAPER_SURFACE_CATALOG.find((entry) => entry.id === id)
    ?? STUDIO_PAPER_SURFACE_CATALOG.find((entry) => entry.id === DEFAULT_PAPER_GRAIN_KIND)!;
}

export function listStudioPaperSurfaceCatalogByGroup(): ReadonlyArray<{
  readonly group: StudioPaperSurfaceGroup;
  readonly label: string;
  readonly entries: readonly StudioPaperSurfaceCatalogEntry[];
}> {
  return GROUP_ORDER.map((group) => ({
    group,
    label: STUDIO_PAPER_SURFACE_GROUP_LABELS[group],
    entries: STUDIO_PAPER_SURFACE_CATALOG.filter((entry) => entry.group === group),
  })).filter((section) => section.entries.length > 0);
}

/** CSS background for a compact swatch (tint + procedural-looking noise via layered gradients). */
export function studioPaperSurfaceSwatchStyle(
  entry: StudioPaperSurfaceCatalogEntry,
): { backgroundColor: string; backgroundImage: string; backgroundSize: string } {
  const tooth = entry.tooth;
  const grainA = Math.round(10 + tooth * 28);
  const grainB = Math.round(6 + tooth * 18);
  const scale = Math.round(8 + (1 - tooth) * 10);
  return {
    backgroundColor: entry.swatch,
    backgroundImage: [
      `radial-gradient(circle at 20% 30%, rgba(90,70,40,${(0.04 + tooth * 0.1).toFixed(3)}) 0 1px, transparent 1.5px)`,
      `radial-gradient(circle at 70% 60%, rgba(60,45,25,${(0.03 + tooth * 0.08).toFixed(3)}) 0 1px, transparent 1.4px)`,
      `repeating-linear-gradient(${entry.id === "washi" ? 12 : entry.id === "canvas" ? 90 : 0}deg, transparent 0 ${scale}px, rgba(80,60,30,${(0.02 + tooth * 0.05).toFixed(3)}) ${scale}px ${scale + 1}px)`,
    ].join(","),
    backgroundSize: `${grainA}px ${grainB}px, ${grainB}px ${grainA}px, 100% 100%`,
  };
}

export function planStudioPaperSurfaceSelection(
  kind: PaperGrainKind,
  seed: number = DEFAULT_STUDIO_PAPER_SURFACE.seed,
): StudioPaperSurfaceSettings {
  return {
    kind,
    seed: Math.trunc(Number.isFinite(seed) ? Math.max(0, seed) : DEFAULT_STUDIO_PAPER_SURFACE.seed),
  };
}

/**
 * Map document paper → Living Ink material axes (shared catalog language).
 * Only paper-related fields change; flow, pigment load and colour behaviour stay under user control.
 */
export function livingInkMaterialPatchForPaper(
  kind: PaperGrainKind | unknown,
): Pick<
  StudioLivingInkMaterialControls,
  "paperFiber" | "paperTooth" | "granulation" | "bleed" | "dryRate"
> {
  const catalog = getStudioPaperSurfaceCatalogEntry(kind);
  const axes = catalog.livingInk;
  const physics = getStudioPaperPhysicsProfile(catalog.id);
  return {
    paperFiber: axes.paperFiber,
    paperTooth: axes.paperTooth,
    granulation: axes.granulation,
    bleed: physics.bleedBias,
    dryRate: physics.dryRate,
  };
}

/** Paper physics snapshot for tools (absorbency / bleed / dry) — UI & wet paths. */
export function paperPhysicsSnapshotForKind(kind: PaperGrainKind | unknown) {
  const id = getStudioPaperSurfaceCatalogEntry(kind).id;
  return getStudioPaperPhysicsProfile(id);
}

function clampAxis(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function paperCharacteristicValueLabel(
  id: StudioPaperSurfaceCharacteristicId,
  value: number,
): string {
  if (id === "tooth") {
    if (value < 0.24) return "매우 매끈";
    if (value < 0.4) return "매끈";
    if (value < 0.58) return "중간";
    if (value < 0.76) return "거침";
    return "매우 거침";
  }
  if (id === "bleed") {
    if (value < 0.2) return "거의 없음";
    if (value < 0.38) return "적음";
    if (value < 0.58) return "보통";
    if (value < 0.78) return "큼";
    return "매우 큼";
  }
  if (value < 0.25) return "매우 낮음";
  if (value < 0.42) return "낮음";
  if (value < 0.62) return "보통";
  if (value < 0.8) return "높음";
  return "매우 높음";
}

/** User-facing axes sourced from the same paper profile used by brush rendering. */
export function getStudioPaperSurfaceCharacteristics(
  kind: PaperGrainKind | unknown,
): readonly StudioPaperSurfaceCharacteristic[] {
  const catalog = getStudioPaperSurfaceCatalogEntry(kind);
  const physics = getStudioPaperPhysicsProfile(catalog.id);
  const values: ReadonlyArray<
    readonly [StudioPaperSurfaceCharacteristicId, string, number]
  > = [
    ["tooth", "결", catalog.livingInk.paperTooth],
    ["absorbency", "흡수", physics.absorbency],
    ["bleed", "번짐", physics.bleedBias],
    ["friction", "가루 고정", physics.contactFriction],
  ];
  return values.map(([id, label, rawValue]) => {
    const value = clampAxis(rawValue);
    return Object.freeze({
      id,
      label,
      value,
      valueLabel: paperCharacteristicValueLabel(id, value),
    });
  });
}

/** Reverse: which catalog paper best matches Living Ink fibre/tooth (for UI active state). */
export function matchPaperKindFromLivingInkMaterial(
  material: Pick<StudioLivingInkMaterialControls, "paperFiber" | "paperTooth" | "granulation">,
): PaperGrainKind {
  let best: PaperGrainKind = DEFAULT_PAPER_GRAIN_KIND;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of STUDIO_PAPER_SURFACE_CATALOG) {
    const dFiber = entry.livingInk.paperFiber - material.paperFiber;
    const dTooth = entry.livingInk.paperTooth - material.paperTooth;
    const dGran = entry.livingInk.granulation - material.granulation;
    const score = dFiber * dFiber + dTooth * dTooth + dGran * dGran;
    if (score < bestScore) {
      bestScore = score;
      best = entry.id;
    }
  }
  return best;
}

export interface StudioPaperSurfaceApplyPlan {
  readonly surface: StudioPaperSurfaceSettings;
  readonly tintBg: string | null;
  readonly livingInk: Pick<
    StudioLivingInkMaterialControls,
    "paperFiber" | "paperTooth" | "granulation" | "bleed" | "dryRate"
  >;
  readonly catalog: StudioPaperSurfaceCatalogEntry;
}

/** One-shot plan when the user picks a paper in canvas settings. */
export function planStudioPaperSurfaceApply(input: {
  readonly kind: PaperGrainKind;
  readonly seed?: number;
  readonly applyTintBackground?: boolean;
}): StudioPaperSurfaceApplyPlan {
  const catalog = getStudioPaperSurfaceCatalogEntry(input.kind);
  const surface = planStudioPaperSurfaceSelection(
    catalog.id,
    input.seed ?? DEFAULT_STUDIO_PAPER_SURFACE.seed,
  );
  return {
    surface,
    tintBg: input.applyTintBackground ? catalog.tintBg : null,
    livingInk: livingInkMaterialPatchForPaper(catalog.id),
    catalog,
  };
}
