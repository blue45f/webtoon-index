/**
 * Brush engine composer.
 *
 * A carrier remains selected by the base brush id. The composer combines only portable,
 * renderer-neutral traits and always re-normalizes the result, so custom mixtures keep the base
 * carrier's deposit program, deterministic seed and replay/export contract.
 */

import { resolveStudioBrushRenderFamily, type StudioBrushRenderFamily } from "../studio-brush";

import {
  normalizeStudioBrushDynamicsSettings,
  type NormalizedStudioBrushDynamicsProperty,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  STUDIO_BRUSH_OIL_PROGRAM_KEYS,
  studioOilProgramSetForBrush,
  type StudioBrushEngineProgramSet,
} from "./studio-brush-engine-program-set";
import { countStudioDynamicBrushMarksPerDab } from "./studio-brush-render-budget";
import { describeStudioBrushRuntimeSemantics } from "./studio-brush-semantic-quality";

/** Portable trait slices that can be copied between different brush carriers. */
export type StudioBrushMixTraitSectionId =
  | "tip"
  | "dual-tip"
  | "surface"
  | "pigment"
  | "size-opacity"
  | "flow-spacing"
  | "scatter-orientation"
  | "taper"
  | "grain"
  | "response"
  | "material"
  | "expression";

export type StudioBrushMixTraitGroup = "shape" | "material" | "dynamics" | "bundle";

export interface StudioBrushMixTraitSection {
  readonly id: StudioBrushMixTraitSectionId;
  readonly group: StudioBrushMixTraitGroup;
  readonly label: string;
  readonly description: string;
}

export const STUDIO_BRUSH_MIX_TRAIT_SECTIONS: readonly StudioBrushMixTraitSection[] =
  Object.freeze([
    {
      id: "tip",
      group: "shape",
      label: "펜촉",
      description: "주 촉의 형상·부드러움·사용자 알파를 가져옵니다.",
    },
    {
      id: "dual-tip",
      group: "shape",
      label: "듀얼 팁 · 팁 레이어",
      description: "보조 팁과 최대 2개의 변형 팁 레이어를 가져옵니다.",
    },
    {
      id: "surface",
      group: "material",
      label: "종이 · 그레인",
      description: "캔버스/획 고정 질감, 스케일, 대비와 종이 소스를 가져옵니다.",
    },
    {
      id: "pigment",
      group: "material",
      label: "색상 · 안료",
      description: "전경/배경 안료 혼합과 HSV 변화 규칙을 가져옵니다.",
    },
    {
      id: "size-opacity",
      group: "dynamics",
      label: "크기 · 불투명도",
      description: "필압·속도에 따른 굵기, 투명도와 원형도 반응을 가져옵니다.",
    },
    {
      id: "flow-spacing",
      group: "dynamics",
      label: "도포 · 간격",
      description: "유량, 도장 간격과 상대 간격 비율을 가져옵니다.",
    },
    {
      id: "scatter-orientation",
      group: "dynamics",
      label: "산포 · 방향",
      description: "산포, 회전, 상대 산포 비율과 입력 방향 반응을 가져옵니다.",
    },
    {
      id: "taper",
      group: "dynamics",
      label: "시작 · 끝 테이퍼",
      description: "획 시작과 끝의 길이·굵기·불투명도 곡선을 가져옵니다.",
    },
    {
      id: "grain",
      group: "bundle",
      label: "질감 + 색상 묶음",
      description: "기존 믹서 호환 묶음으로 그레인과 색상 동역학을 함께 가져옵니다.",
    },
    {
      id: "response",
      group: "bundle",
      label: "동적 반응 묶음",
      description: "크기·투명도·유량·간격·산포·회전·원형도·테이퍼를 한 번에 가져옵니다.",
    },
    {
      id: "material",
      group: "bundle",
      label: "재질 엔진 묶음",
      description: "주/보조 팁, 팁 레이어, 종이 질감과 안료 변화를 함께 가져옵니다.",
    },
    {
      id: "expression",
      group: "bundle",
      label: "표현 엔진 묶음",
      description: "모든 휴대 가능한 동적 반응을 한 번에 가져옵니다.",
    },
  ]);

export function isStudioBrushMixTraitSectionId(value: unknown): value is StudioBrushMixTraitSectionId {
  return STUDIO_BRUSH_MIX_TRAIT_SECTIONS.some((section) => section.id === value);
}

function responsePatch(source: NormalizedStudioBrushDynamicsSettings) {
  return {
    width: source.width,
    opacity: source.opacity,
    flow: source.flow,
    spacing: source.spacing,
    scatter: source.scatter,
    angle: source.angle,
    roundness: source.roundness,
    spacingRatio: source.spacingRatio,
    scatterRatio: source.scatterRatio,
    minimumDiameterRatio: source.minimumDiameterRatio,
    fallbackPressure: source.fallbackPressure,
    maxSpeed: source.maxSpeed,
    taper: source.taper,
  } satisfies Partial<NormalizedStudioBrushDynamicsSettings>;
}

function materialPatch(source: NormalizedStudioBrushDynamicsSettings) {
  return {
    tip: source.tip,
    tipLayers: source.tipLayers,
    dualBrush: source.dualBrush,
    grain: source.grain,
    colorDynamics: source.colorDynamics,
  } satisfies Partial<NormalizedStudioBrushDynamicsSettings>;
}

/**
 * Copy one portable trait slice without replacing carrier identity fields.
 *
 * `depositPipeline`, carrier program pins, `presetId` and `seed` are intentionally retained from
 * `current`. Copying those across families can change which renderer executes and would make the
 * same saved brush replay through a different engine.
 */
export function mergeStudioBrushMixTraitSection(
  sectionId: StudioBrushMixTraitSectionId,
  current: NormalizedStudioBrushDynamicsSettings,
  source: NormalizedStudioBrushDynamicsSettings,
): NormalizedStudioBrushDynamicsSettings {
  let patch: Partial<NormalizedStudioBrushDynamicsSettings>;
  switch (sectionId) {
    case "tip":
      patch = { tip: source.tip };
      break;
    case "dual-tip":
      patch = { tipLayers: source.tipLayers, dualBrush: source.dualBrush };
      break;
    case "surface":
      patch = { grain: source.grain };
      break;
    case "pigment":
      patch = { colorDynamics: source.colorDynamics };
      break;
    case "size-opacity":
      patch = {
        width: source.width,
        opacity: source.opacity,
        roundness: source.roundness,
        minimumDiameterRatio: source.minimumDiameterRatio,
        fallbackPressure: source.fallbackPressure,
        maxSpeed: source.maxSpeed,
      };
      break;
    case "flow-spacing":
      patch = {
        flow: source.flow,
        spacing: source.spacing,
        spacingRatio: source.spacingRatio,
      };
      break;
    case "scatter-orientation":
      patch = {
        scatter: source.scatter,
        scatterRatio: source.scatterRatio,
        angle: source.angle,
      };
      break;
    case "taper":
      patch = { taper: source.taper };
      break;
    case "grain":
      patch = { grain: source.grain, colorDynamics: source.colorDynamics };
      break;
    case "response":
    case "expression":
      patch = responsePatch(source);
      break;
    case "material":
      patch = materialPatch(source);
      break;
  }
  return normalizeStudioBrushDynamicsSettings({ ...current, ...patch });
}

export type StudioBrushMixRecipeId =
  | "webtoon-clean-line"
  | "organic-ink"
  | "granular-wash"
  | "natural-pencil"
  | "wax-and-powder"
  | "bristle-impasto"
  | "soft-atmosphere"
  | "particle-fx";

export interface StudioBrushMixRecipeStep {
  readonly sourceBrushId: string;
  readonly sectionId: StudioBrushMixTraitSectionId;
}

export interface StudioBrushMixRecipe {
  readonly id: StudioBrushMixRecipeId;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly steps: readonly StudioBrushMixRecipeStep[];
}

/** Curated multi-source recipes. The selected brush remains the carrier in every recipe. */
export const STUDIO_BRUSH_MIX_RECIPES = Object.freeze([
  {
    id: "webtoon-clean-line",
    name: "웹툰 선화 하이브리드",
    description: "하드 에어브러시의 매끈한 촉, 잉크 입자의 압력 반응, 미러 펜의 균일 도포를 조합합니다.",
    tags: Object.freeze(["선화", "필압", "클린"]),
    steps: Object.freeze([
      { sourceBrushId: "hard-airbrush", sectionId: "tip" },
      { sourceBrushId: "ink-particle", sectionId: "size-opacity" },
      { sourceBrushId: "sketchpad-mirror", sectionId: "flow-spacing" },
    ]),
  },
  {
    id: "organic-ink",
    name: "유기적 먹선",
    description: "러프 잉크 형상에 드라이 미디어 종이결과 잉크 입자 반응을 더합니다.",
    tags: Object.freeze(["먹선", "질감", "붓펜"]),
    steps: Object.freeze([
      { sourceBrushId: "web-rough-ink", sectionId: "tip" },
      { sourceBrushId: "dry-media", sectionId: "surface" },
      { sourceBrushId: "ink-particle", sectionId: "expression" },
    ]),
  },
  {
    id: "granular-wash",
    name: "과립 수채 워시",
    description: "과립 종이결, 농밀한 코어, 즉시 번지는 방향 반응을 결합합니다.",
    tags: Object.freeze(["수채", "과립", "번짐"]),
    steps: Object.freeze([
      { sourceBrushId: "watercolor--granulating", sectionId: "surface" },
      { sourceBrushId: "watercolor--dense-core", sectionId: "size-opacity" },
      { sourceBrushId: "ink-wash--fiber-feather", sectionId: "flow-spacing" },
      { sourceBrushId: "watercolor", sectionId: "pigment" },
    ]),
  },
  {
    id: "natural-pencil",
    name: "천연 연필심",
    description: "마모 연필촉, 바인 목탄 종이결, 드라이 미디어 압력 반응을 조합합니다.",
    tags: Object.freeze(["연필", "목탄", "스케치"]),
    steps: Object.freeze([
      { sourceBrushId: "erodible-pencil", sectionId: "tip" },
      { sourceBrushId: "charcoal--vine-soft", sectionId: "surface" },
      { sourceBrushId: "dry-media", sectionId: "expression" },
    ]),
  },
  {
    id: "wax-and-powder",
    name: "왁스 · 가루 혼합",
    description: "크레용 재질, 오일파스텔 도포, 초크 산포를 섞습니다.",
    tags: Object.freeze(["크레용", "파스텔", "초크"]),
    steps: Object.freeze([
      { sourceBrushId: "crayon", sectionId: "material" },
      { sourceBrushId: "oil-pastel", sectionId: "flow-spacing" },
      { sourceBrushId: "chalk", sectionId: "scatter-orientation" },
    ]),
  },
  {
    id: "bristle-impasto",
    name: "강모 임파스토",
    description: "필버트 촉, 튜브 페인트 압력 반응, 목탄 종이결로 두꺼운 물감 결을 만듭니다.",
    tags: Object.freeze(["유화", "강모", "임파스토"]),
    steps: Object.freeze([
      { sourceBrushId: "oil--filbert-ribbon", sectionId: "tip" },
      { sourceBrushId: "paint-tube", sectionId: "expression" },
      { sourceBrushId: "charcoal", sectionId: "surface" },
    ]),
  },
  {
    id: "soft-atmosphere",
    name: "소프트 대기 브러시",
    description: "소프트 브러시 재질과 에어브러시 반응, 구름 산포를 결합합니다.",
    tags: Object.freeze(["에어브러시", "안개", "배경"]),
    steps: Object.freeze([
      { sourceBrushId: "soft-brush", sectionId: "material" },
      { sourceBrushId: "airbrush", sectionId: "expression" },
      { sourceBrushId: "web-soft-cloud", sectionId: "scatter-orientation" },
    ]),
  },
  {
    id: "particle-fx",
    name: "입자 FX 스캐터",
    description: "멀티 에이전트 입자 재질, 잉크 입자 반응, 산포 스탬프 배치를 조합합니다.",
    tags: Object.freeze(["FX", "입자", "스캐터"]),
    steps: Object.freeze([
      { sourceBrushId: "web-multi-agent", sectionId: "material" },
      { sourceBrushId: "ink-particle", sectionId: "size-opacity" },
      { sourceBrushId: "web-scatter-stamp", sectionId: "flow-spacing" },
      { sourceBrushId: "spray", sectionId: "scatter-orientation" },
    ]),
  },
] satisfies readonly StudioBrushMixRecipe[]);

export function studioBrushMixRecipeById(id: unknown): StudioBrushMixRecipe | null {
  return STUDIO_BRUSH_MIX_RECIPES.find((recipe) => recipe.id === id) ?? null;
}

export interface StudioBrushMixRecipeResult {
  readonly settings: NormalizedStudioBrushDynamicsSettings;
  readonly appliedStepCount: number;
  readonly missingSourceBrushIds: readonly string[];
}

/** Applies every resolvable recipe step in serialized order; missing sources never corrupt a mix. */
export function applyStudioBrushMixRecipe(
  recipeId: StudioBrushMixRecipeId,
  current: NormalizedStudioBrushDynamicsSettings,
  sources: Readonly<Record<string, NormalizedStudioBrushDynamicsSettings | null | undefined>>,
): StudioBrushMixRecipeResult {
  const recipe = studioBrushMixRecipeById(recipeId);
  if (!recipe) {
    return { settings: current, appliedStepCount: 0, missingSourceBrushIds: [] };
  }
  let settings = current;
  let appliedStepCount = 0;
  const missing = new Set<string>();
  for (const step of recipe.steps) {
    const source = sources[step.sourceBrushId];
    if (!source) {
      missing.add(step.sourceBrushId);
      continue;
    }
    settings = mergeStudioBrushMixTraitSection(step.sectionId, settings, source);
    appliedStepCount += 1;
  }
  return {
    settings,
    appliedStepCount,
    missingSourceBrushIds: Object.freeze([...missing]),
  };
}

const STUDIO_BRUSH_ENGINE_FAMILY_LABELS: Readonly<Record<StudioBrushRenderFamily, string>> =
  Object.freeze({
    pen: "펜 · 잉크",
    gpen: "G펜 · 만화 펜",
    calligraphy: "캘리그래피",
    perfect: "퍼펙트 아웃라인",
    marker: "마커",
    highlighter: "형광펜",
    neon: "네온",
    glow: "글로우",
    glitter: "글리터",
    brush: "붓 · 브러시",
    watercolor: "수채",
    oil: "유화 · 아크릴",
    pastel: "파스텔",
    "ink-particle": "잉크 입자",
    airbrush: "에어브러시",
    "dry-media": "드라이 미디어",
    pencil: "연필",
    screentone: "스크린톤",
    stamp: "도장 스탬프",
    pixel: "픽셀",
  });

export function studioBrushEngineFamilyLabel(brushId: string): string {
  return STUDIO_BRUSH_ENGINE_FAMILY_LABELS[resolveStudioBrushRenderFamily(brushId)] ?? "펜 · 잉크";
}

export type StudioBrushMixComplexityLevel = "light" | "balanced" | "intensive";
export type StudioBrushMixQualityIssueSeverity = "notice" | "warning";

export interface StudioBrushMixQualityIssue {
  readonly id: string;
  readonly severity: StudioBrushMixQualityIssueSeverity;
  readonly title: string;
  readonly description: string;
}

export interface StudioBrushMixQualityAnalysis {
  readonly qualityScore: number;
  readonly complexityScore: number;
  readonly complexityLevel: StudioBrushMixComplexityLevel;
  readonly estimatedMarksPerDab: number;
  readonly activeModuleCount: number;
  readonly mappedInputCount: number;
  readonly issues: readonly StudioBrushMixQualityIssue[];
}

const DYNAMIC_PROPERTIES = [
  "width",
  "opacity",
  "flow",
  "spacing",
  "scatter",
  "angle",
  "roundness",
] as const;

type DynamicPropertyKey = (typeof DYNAMIC_PROPERTIES)[number];

function activeMappingCount(settings: NormalizedStudioBrushDynamicsSettings): number {
  return DYNAMIC_PROPERTIES.reduce(
    (total, key) => total + settings[key].mappings.length,
    0,
  );
}

function activeJitterCount(settings: NormalizedStudioBrushDynamicsSettings): number {
  return DYNAMIC_PROPERTIES.reduce(
    (total, key) => total + (settings[key].jitter?.amount ? 1 : 0),
    0,
  );
}

function propertyHasDynamics(property: NormalizedStudioBrushDynamicsProperty): boolean {
  return property.mappings.length > 0 || (property.jitter?.amount ?? 0) > 0;
}

function colorDynamicsActive(settings: NormalizedStudioBrushDynamicsSettings): boolean {
  const color = settings.colorDynamics;
  return Boolean(
    color.backgroundColor
      || color.foregroundBackgroundMix > 0
      || color.foregroundBackgroundJitter > 0
      || color.hueJitter > 0
      || color.saturationJitter > 0
      || color.valueJitter > 0
      || color.pigmentMixProgramId,
  );
}

function complexityLevel(score: number): StudioBrushMixComplexityLevel {
  if (score < 34) return "light";
  if (score < 68) return "balanced";
  return "intensive";
}

function programCount(
  brushId: string,
  enginePrograms?: StudioBrushEngineProgramSet | null,
): number {
  let count = 0;
  if (resolveStudioBrushRenderFamily(brushId) === "oil") {
    const oil = enginePrograms?.oil ?? studioOilProgramSetForBrush(brushId);
    count += STUDIO_BRUSH_OIL_PROGRAM_KEYS.filter((key) => oil[key]).length;
  }
  const watercolor = enginePrograms?.watercolor;
  if (watercolor?.wetEdgeBloomProgramId) count += 1;
  if (watercolor?.livingInkBakeProgramId) count += 1;
  return count;
}

/** Deterministic authoring-time quality/performance diagnosis for the current combination. */
export function analyzeStudioBrushMixQuality(
  brushId: string,
  settings: NormalizedStudioBrushDynamicsSettings,
  enginePrograms?: StudioBrushEngineProgramSet | null,
): StudioBrushMixQualityAnalysis {
  const activeTipLayers = settings.tipLayers.filter((layer) => layer.opacity > 0).length;
  const dualBrushActive = settings.dualBrush?.enabled ?? false;
  const grainActive = settings.grain.amount > 0;
  const pigmentActive = colorDynamicsActive(settings);
  const mappedInputCount = activeMappingCount(settings);
  const jitterCount = activeJitterCount(settings);
  const activePrograms = programCount(brushId, enginePrograms);
  const estimatedMarksPerDab = countStudioDynamicBrushMarksPerDab(settings, 7);
  const activeModuleCount = 1
    + activeTipLayers
    + (dualBrushActive ? 1 : 0)
    + (grainActive ? 1 : 0)
    + (pigmentActive ? 1 : 0)
    + (settings.taper.enabled ? 1 : 0)
    + activePrograms
    + DYNAMIC_PROPERTIES.filter((key) => propertyHasDynamics(settings[key])).length;

  const rawComplexity =
    Math.min(52, estimatedMarksPerDab * 0.55)
    + activeTipLayers * 9
    + (dualBrushActive ? 7 : 0)
    + (grainActive ? 7 : 0)
    + (pigmentActive ? 4 : 0)
    + Math.min(14, mappedInputCount * 1.4)
    + Math.min(8, jitterCount * 1.2)
    + activePrograms * 5;
  const complexityScore = Math.round(Math.min(100, rawComplexity));
  const issues: StudioBrushMixQualityIssue[] = [];

  const spacingRatio = settings.spacingRatio;
  const scatterRatio = settings.scatterRatio;
  if (spacingRatio !== null && spacingRatio > 0.32 && activeTipLayers === 0) {
    issues.push({
      id: "carrier-gaps",
      severity: "warning",
      title: "도장 간격이 넓습니다",
      description: "연속 획에서 개별 도장 실루엣이나 끊김이 보일 수 있습니다.",
    });
  }
  if (spacingRatio !== null && spacingRatio < 0.035 && estimatedMarksPerDab >= 40) {
    issues.push({
      id: "dense-overdraw",
      severity: "warning",
      title: "다중 팁 오버드로가 큽니다",
      description: "매우 촘촘한 간격과 복잡한 팁이 함께 켜져 입력 지연 가능성이 있습니다.",
    });
  }
  if (scatterRatio !== null && scatterRatio > 0.5 && spacingRatio !== null && spacingRatio > 0.2) {
    issues.push({
      id: "scatter-holes",
      severity: "notice",
      title: "산포가 간격보다 큽니다",
      description: "연속 재질이라면 중심부 밀도가 고르지 않을 수 있습니다.",
    });
  }
  if (settings.grain.amount > 0.82 && settings.grain.scale < 1.5) {
    issues.push({
      id: "grain-aliasing",
      severity: "notice",
      title: "미세 그레인이 강합니다",
      description: "작은 확대율에서 모아레나 거친 계단이 보일 수 있습니다.",
    });
  }
  const colorNoise = settings.colorDynamics.foregroundBackgroundJitter
    + settings.colorDynamics.saturationJitter
    + settings.colorDynamics.valueJitter
    + settings.colorDynamics.hueJitter / 180;
  if (colorNoise > 1.35) {
    issues.push({
      id: "color-noise",
      severity: "notice",
      title: "색상 변화 폭이 큽니다",
      description: "연속 도포에서는 색이 떨리거나 얼룩처럼 보일 수 있습니다.",
    });
  }
  if (estimatedMarksPerDab > 96 || complexityScore >= 82) {
    issues.push({
      id: "interactive-cost",
      severity: "warning",
      title: "실시간 비용이 높습니다",
      description: "저사양 장치에서는 라이브 품질 단계가 자동으로 낮아질 수 있습니다.",
    });
  } else if (estimatedMarksPerDab > 48 || complexityScore >= 64) {
    issues.push({
      id: "interactive-cost-notice",
      severity: "notice",
      title: "복합 엔진 비용이 중간 이상입니다",
      description: "긴 획과 대칭 복제에서 렌더 예산을 더 빨리 사용할 수 있습니다.",
    });
  }

  const qualityPenalty = issues.reduce(
    (total, issue) => total + (issue.severity === "warning" ? 14 : 7),
    0,
  );
  return {
    qualityScore: Math.max(40, 100 - qualityPenalty),
    complexityScore,
    complexityLevel: complexityLevel(complexityScore),
    estimatedMarksPerDab,
    activeModuleCount,
    mappedInputCount,
    issues: Object.freeze(issues),
  };
}

/**
 * Applies conservative, opt-in authoring fixes for the risks reported by
 * `analyzeStudioBrushMixQuality`. Carrier/program identity is never changed.
 */
export function stabilizeStudioBrushMixQuality(
  settings: NormalizedStudioBrushDynamicsSettings,
): NormalizedStudioBrushDynamicsSettings {
  const estimatedMarksPerDab = countStudioDynamicBrushMarksPerDab(settings, 7);
  let spacingRatio = settings.spacingRatio;
  if (spacingRatio !== null) {
    if (spacingRatio > 0.32) spacingRatio = 0.22;
    if (spacingRatio < 0.035 && estimatedMarksPerDab >= 40) spacingRatio = 0.045;
  }

  let scatterRatio = settings.scatterRatio;
  if (
    scatterRatio !== null
    && scatterRatio > 0.5
    && spacingRatio !== null
    && spacingRatio > 0.2
  ) {
    scatterRatio = 0.22;
  }

  const grain = settings.grain.amount > 0.82 && settings.grain.scale < 1.5
    ? { ...settings.grain, amount: 0.72, scale: 2 }
    : settings.grain;

  const colorNoise = settings.colorDynamics.foregroundBackgroundJitter
    + settings.colorDynamics.saturationJitter
    + settings.colorDynamics.valueJitter
    + settings.colorDynamics.hueJitter / 180;
  const colorDynamics = colorNoise > 1.35
    ? {
        ...settings.colorDynamics,
        foregroundBackgroundJitter: Math.min(0.25, settings.colorDynamics.foregroundBackgroundJitter),
        hueJitter: Math.min(32, settings.colorDynamics.hueJitter),
        saturationJitter: Math.min(0.25, settings.colorDynamics.saturationJitter),
        valueJitter: Math.min(0.25, settings.colorDynamics.valueJitter),
      }
    : settings.colorDynamics;

  return normalizeStudioBrushDynamicsSettings({
    ...settings,
    spacingRatio,
    scatterRatio,
    grain,
    colorDynamics,
  });
}

export interface StudioBrushEngineStackEntry {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

/** Lists the complete visible engine stack, including material modules and cost diagnosis. */
export function describeStudioBrushEngineStack(
  brushId: string,
  settings: NormalizedStudioBrushDynamicsSettings,
  enginePrograms?: StudioBrushEngineProgramSet | null,
): readonly StudioBrushEngineStackEntry[] {
  const entries: StudioBrushEngineStackEntry[] = [
    {
      id: "carrier",
      label: studioBrushEngineFamilyLabel(brushId),
      active: true,
    },
  ];
  const semantics = describeStudioBrushRuntimeSemantics(brushId);
  if (semantics) {
    entries.push({
      id: "runtime-semantics",
      label: semantics.summaryKo,
      active: true,
    });
  }
  if (settings.depositPipeline) {
    entries.push({
      id: "deposit-pipeline",
      label: settings.depositPipeline === "causal-deposit-v3-segmented"
        ? "인과 도포 v3 (세그먼트)"
        : "인과 도포 v2",
      active: true,
    });
  }
  if (settings.dryMediaKernelProgram) {
    entries.push({ id: "dry-media-kernel", label: "드라이 미디어 전용 커널", active: true });
  }
  if (settings.softFalloffLinearProgram) {
    entries.push({ id: "soft-falloff", label: "소프트 폴오프 선형 누적", active: true });
  }
  if (settings.causalStampGridRule) {
    entries.push({ id: "stamp-grid", label: "인과 스탬프 그리드 v2", active: true });
  }

  entries.push({
    id: "primary-tip",
    label: settings.tip.alphaMapBase64
      ? `사용자 알파 팁 · ${settings.tip.alphaMapSize}px`
      : `주 펜촉 · ${settings.tip.shape}`,
    active: true,
  });
  if (settings.dualBrush?.enabled) {
    entries.push({
      id: "dual-tip",
      label: `듀얼 팁 · ${settings.dualBrush.blendMode}`,
      active: true,
    });
  }
  const activeTipLayers = settings.tipLayers.filter((layer) => layer.opacity > 0).length;
  if (activeTipLayers > 0) {
    entries.push({ id: "tip-layers", label: `추가 팁 레이어 · ${activeTipLayers}개`, active: true });
  }
  if (settings.grain.amount > 0) {
    entries.push({
      id: "grain",
      label: `그레인 · ${settings.grain.space === "canvas-fixed" ? "캔버스 고정" : "획 고정"}`,
      active: true,
    });
  }
  if (colorDynamicsActive(settings)) {
    entries.push({
      id: "pigment",
      label: settings.colorDynamics.pigmentMixProgramId ? "스펙트럴 안료 혼합" : "색상 동역학",
      active: true,
    });
  }
  const mappedChannels = DYNAMIC_PROPERTIES.filter((key: DynamicPropertyKey) =>
    propertyHasDynamics(settings[key]),
  ).length;
  if (mappedChannels > 0) {
    entries.push({ id: "input-mappings", label: `입력 매핑 · ${mappedChannels}채널`, active: true });
  }
  if (settings.taper.enabled) {
    entries.push({ id: "taper", label: "시작 · 끝 테이퍼", active: true });
  }

  if (resolveStudioBrushRenderFamily(brushId) === "oil") {
    const baseline = studioOilProgramSetForBrush(brushId);
    const oil = enginePrograms?.oil ?? baseline;
    const oilLabels: Record<(typeof STUDIO_BRUSH_OIL_PROGRAM_KEYS)[number], string> = {
      bristlePhysics: "붓털 물리",
      bristleLoadDynamics: "물감 소모 (갈필)",
      impastoRelief: "임파스토 릴리프",
    };
    for (const key of STUDIO_BRUSH_OIL_PROGRAM_KEYS) {
      entries.push({ id: `oil-${key}`, label: oilLabels[key], active: oil[key] });
    }
  }
  const watercolor = enginePrograms?.watercolor;
  if (watercolor?.wetEdgeBloomProgramId) {
    entries.push({
      id: "watercolor-wet-edge-bloom",
      label: `수채 블룸 · ${watercolor.wetEdgeBloomProgramId}`,
      active: true,
    });
  }
  if (watercolor?.livingInkBakeProgramId) {
    entries.push({
      id: "watercolor-living-ink-bake",
      label: `정착 베이크 · ${watercolor.livingInkBakeProgramId}`,
      active: true,
    });
  }

  const quality = analyzeStudioBrushMixQuality(brushId, settings, enginePrograms);
  const complexityLabel = quality.complexityLevel === "light"
    ? "경량"
    : quality.complexityLevel === "balanced"
      ? "균형"
      : "고부하";
  entries.push({
    id: "mix-complexity",
    label: `복잡도 · ${complexityLabel} (${quality.estimatedMarksPerDab} mark/dab)`,
    active: true,
  });
  if (quality.issues.length > 0) {
    entries.push({
      id: "quality-diagnosis",
      label: `품질 진단 · 주의 ${quality.issues.length}건`,
      active: true,
    });
  }
  return entries;
}

export function suggestStudioBrushMixName(baseBrushName: string): string {
  const base = baseBrushName.trim() || "커스텀 브러시";
  return `${base} 조합`;
}
