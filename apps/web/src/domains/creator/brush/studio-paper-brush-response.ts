/**
 * 브러시가 종이와 상호작용하는 세기 — 렌더 패밀리 × 문서 종이 물리.
 *
 * 실물에서 종이 결이 보이는 정도는 도구가 정한다. 목탄 가루는 골에 그대로 쌓이고(강한
 * granulation), 수채 안료는 물에 실려 골로 내려앉으며, 기술펜 잉크는 섬유에 즉시 물들어
 * (staining) 종이 요철과 무관하게 균일한 선을 남긴다. 이 표는 그 차이를
 * `studio-paper-texture`의 두 축(granulation / staining)으로 옮긴 뒤,
 * 문서에 깔린 종이(`PAPER_PHYSICS_PROFILES`)의 tooth/sizing/scale 으로 한 번 더 변조한다.
 *
 * **왜 브러시 스냅샷이 아니라 표인가** — 종이 반응은 저장되는 획 상태가 아니라 도구의
 * 물성이다. 문서가 소유하는 것은 *어떤 종이를 깔았는가*(`StudioPaperSurfaceSettings`)뿐이다.
 */

import { resolveStudioBrushRenderFamily, type StudioBrushRenderFamily } from "../studio-brush";

import {
  STUDIO_PAPER_GRANULATION_IDENTITY,
  normalizeStudioPaperGranulationSettings,
  resolveStudioDocumentPaperSurface,
  type StudioPaperGranulationSettings,
} from "./studio-paper-granulation-runtime";
import {
  STUDIO_PAPER_MEDIA_INTERACTION_V1,
  resolveStudioPaperMediumForBrushFamilyV1,
  type StudioPaperMediumV1,
} from "./studio-paper-media-profile-v1";
import {
  studioPaperUsesContactTooth,
  type StudioPaperSubstrateModel,
} from "./studio-paper-substrate-model";
import {
  getStudioPaperPhysicsProfile,
  normalizePaperGrainKind,
  type PaperGrainKind,
} from "./studio-paper-texture";

/**
 * 렌더 패밀리 → 종이 반응 베이스 (cold-press 기준).
 *
 * 자연매체 최대 granulation 0.7 — 0.75를 넘기면 황목/샌디드에서 알파 배수가 상한에 닿아
 * 평균 보존이 깨진다.
 */
export const STUDIO_PAPER_BRUSH_RESPONSE: Readonly<
  Record<StudioBrushRenderFamily, StudioPaperGranulationSettings>
> = Object.freeze({
  "dry-media": { granulation: 0.7, staining: 0.04, scale: 1.5 },
  pastel: { granulation: 0.64, staining: 0.05, scale: 1.45 },
  pencil: { granulation: 0.55, staining: 0.08, scale: 1 },
  watercolor: { granulation: 0.58, staining: 0.18, scale: 1 },
  brush: { granulation: 0.36, staining: 0.2, scale: 1.05 },
  oil: { granulation: 0.3, staining: 0.22, scale: 1.35 },
  calligraphy: { granulation: 0.24, staining: 0.4, scale: 1 },
  // 종이를 타지 않는 도구들 — 정확한 항등.
  airbrush: STUDIO_PAPER_GRANULATION_IDENTITY,
  pen: STUDIO_PAPER_GRANULATION_IDENTITY,
  gpen: STUDIO_PAPER_GRANULATION_IDENTITY,
  perfect: STUDIO_PAPER_GRANULATION_IDENTITY,
  marker: STUDIO_PAPER_GRANULATION_IDENTITY,
  highlighter: STUDIO_PAPER_GRANULATION_IDENTITY,
  neon: STUDIO_PAPER_GRANULATION_IDENTITY,
  glow: STUDIO_PAPER_GRANULATION_IDENTITY,
  glitter: STUDIO_PAPER_GRANULATION_IDENTITY,
  "ink-particle": STUDIO_PAPER_GRANULATION_IDENTITY,
  screentone: STUDIO_PAPER_GRANULATION_IDENTITY,
  stamp: STUDIO_PAPER_GRANULATION_IDENTITY,
  pixel: STUDIO_PAPER_GRANULATION_IDENTITY,
});

// Newly authored core wet strokes already carry their own grain snapshot.
const STUDIO_AUTHORED_WET_DYNAMIC_PAPER_RESPONSE_IDS = new Set([
  "watercolor",
  "ink-wash",
  "inkwash-pen",
  "inkwash-water-brush",
  "inkwash-bleed-wash",
  "inkwash-white-ink",
]);

/** Mean-preserving ceiling shared with granulation runtime tests. */
const GRANULATION_CEILING = 0.7;

/**
 * contact-tooth-v2 전용 상한.
 *
 * 0.7은 **평균 보존** 제약에서 나온 값이다 — 레거시 이득은 타일 평균 0으로 정규화되어 있어
 * 강도가 그 위로 가면 알파 배수가 상한에 닿아 균일 획의 총 안료량이 깨진다. peak-catch에는
 * 그 불변식이 없다(가벼운 연필 한 번은 실제로 안료를 덜 남기는 게 옳다). 상한을 0.95로 올려야
 * 접촉면 아래 텍셀이 **정말 비어 보이고**, 그게 종이 이빨이 눈에 보이는 유일한 이유다.
 * 1이 아니라 0.95인 건 완전 0 알파 구멍이 스트로크 경계에서 계단으로 보이기 때문이다.
 */
const CONTACT_TOOTH_GRANULATION_CEILING_V2 = 0.95;

/**
 * 필압 → 이빨 가시성.
 *
 * 필압이 오르면 접촉면이 골까지 내려가 이빨이 메워진다(burnishing). 샘플러의 문턱 이동과
 * 같은 방향으로 작용하되, 이쪽은 **결이 보이는 정도** 자체를 줄인다. 무거운 필압에서도
 * 0으로 떨어뜨리지 않는 이유는 실물에서도 완전히 메워진 종이가 여전히 미세한 결을 남기기 때문.
 */
const CONTACT_TOOTH_HEAVY_VISIBILITY_V2 = 0.55;

function contactToothVisibilityV2(pressure: number): number {
  const safe = clamp(Number.isFinite(pressure) ? pressure : 1, 0, 1);
  return 1 - (1 - CONTACT_TOOTH_HEAVY_VISIBILITY_V2) * safe * safe;
}

/**
 * peak-catch 매체의 강도 승수.
 *
 * 레거시 베이스(연필 0.55, 건식 0.7)는 **평균 보존** 이득에 맞춰 튜닝된 값이라, 그대로 두면
 * 알파 배수의 하한이 `1 - 0.64 = 0.36`에 머물러 골이 절대 비지 않는다. 실측에서 가벼운 필압
 * bare 비율이 0.0%로 나온 원인이 이것이었다. 마른 안료는 접촉면 아래 구멍에 **실제로 닿지
 * 않으므로**, peak-catch에서는 강도가 상한 가까이 가야 종이 이빨이 눈에 보인다.
 * valley-settle(수채)·weave-reveal(유화)에는 걸지 않는다 — 그쪽은 평균 보존이 여전히 옳다.
 */
const CONTACT_TOOTH_PEAK_CATCH_STRENGTH_V2 = 1.55;

function isPeakCatchMediumV2(medium: StudioPaperMediumV1 | null | undefined): boolean {
  return medium != null
    && STUDIO_PAPER_MEDIA_INTERACTION_V1[medium].mode === "peak-catch";
}

/**
 * 종이 반응을 물을 때 함께 넘기는 맥락. 둘 다 생략하면 반환값은 예전과 **정확히 같다**.
 */
export interface StudioPaperBrushResponseContext {
  /** 0..1 캐노니컬 필압. 생략하면 필압 결합이 아예 걸리지 않는다(역사적 계약). */
  readonly pressure?: number;
  /** 획이 들고 있는 substrate 세대. 생략 = 레거시 valley-multiply. */
  readonly model?: StudioPaperSubstrateModel;
  /** 상호작용 매체. `resolveStudioPaperBrushResponse`가 브러시에서 스스로 채운다. */
  readonly medium?: StudioPaperMediumV1 | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply document paper physics to a brush-family base response.
 * Identity brushes stay exact identity (same object reference).
 */
export function applyStudioPaperPhysicsToBrushResponse(
  base: StudioPaperGranulationSettings,
  paperKind: PaperGrainKind | unknown,
  context?: StudioPaperBrushResponseContext,
): StudioPaperGranulationSettings {
  if (
    base === STUDIO_PAPER_GRANULATION_IDENTITY
    || (base.granulation <= 0 && base.staining <= 0)
  ) {
    return STUDIO_PAPER_GRANULATION_IDENTITY;
  }
  const physics = getStudioPaperPhysicsProfile(paperKind);
  // Dry-media friction boosts lodging; wet absorbency slightly lifts granulation for washes.
  const dryBoost = 0.72 + physics.contactFriction * 0.45;
  const wetBoost = 0.85 + physics.absorbency * 0.22;
  const mediumBlend = dryBoost * 0.55 + wetBoost * 0.45;
  const contactTooth = studioPaperUsesContactTooth(context?.model);
  // 필압은 v2 획에서만, 그리고 실제로 값이 넘어왔을 때만 결합한다. 둘 중 하나라도 없으면
  // 아래 식은 예전과 항이 완전히 동일해 기존 호출부의 반환값이 비트 단위로 보존된다.
  const toothVisibility = contactTooth && context?.pressure !== undefined
    ? contactToothVisibilityV2(context.pressure)
    : 1;
  const peakCatchLift = contactTooth && isPeakCatchMediumV2(context?.medium)
    ? CONTACT_TOOTH_PEAK_CATCH_STRENGTH_V2
    : 1;
  const granulation = clamp(
    base.granulation * physics.toothGain * mediumBlend * toothVisibility * peakCatchLift,
    0,
    contactTooth ? CONTACT_TOOTH_GRANULATION_CEILING_V2 : GRANULATION_CEILING,
  );
  const staining = clamp(base.staining * physics.sizingGain, 0, 1);
  const scale = clamp(
    base.scale * physics.scaleMul,
    0.25,
    16,
  );
  return normalizeStudioPaperGranulationSettings({
    granulation,
    staining,
    scale,
  });
}

/**
 * 브러시 id → 종이 반응.
 * 문서 종이를 넘기지 않으면 현재 문서 표면(`resolveStudioDocumentPaperSurface`)을 쓴다.
 */
export function resolveStudioPaperBrushResponse(
  brushId: unknown,
  paperKind?: PaperGrainKind | unknown,
  context?: StudioPaperBrushResponseContext | number,
): StudioPaperGranulationSettings {
  if (
    typeof brushId === "string"
    && STUDIO_AUTHORED_WET_DYNAMIC_PAPER_RESPONSE_IDS.has(brushId.trim().toLowerCase())
  ) {
    return STUDIO_PAPER_GRANULATION_IDENTITY;
  }
  const family = resolveStudioBrushRenderFamily(brushId);
  const base = STUDIO_PAPER_BRUSH_RESPONSE[family];
  if (base === STUDIO_PAPER_GRANULATION_IDENTITY) {
    return STUDIO_PAPER_GRANULATION_IDENTITY;
  }
  const kind = paperKind !== undefined && paperKind !== null
    ? normalizePaperGrainKind(paperKind)
    : resolveStudioDocumentPaperSurface().kind;
  const normalized = normalizeStudioPaperBrushResponseContext(context);
  return applyStudioPaperPhysicsToBrushResponse(
    base,
    kind,
    normalized === undefined
      ? undefined
      : {
        ...normalized,
        // 매체는 브러시가 결정한다. 호출부가 굳이 덮어쓸 이유가 없으므로 여기서 채운다.
        medium: normalized.medium ?? resolveStudioPaperMediumForBrushFamilyV1(family),
      },
  );
}

/** 세 번째 인자는 필압 숫자 하나로도, 맥락 오브젝트로도 받는다. 생략은 역사적 계약이다. */
function normalizeStudioPaperBrushResponseContext(
  context?: StudioPaperBrushResponseContext | number,
): StudioPaperBrushResponseContext | undefined {
  if (context === undefined) return undefined;
  return typeof context === "number" ? { pressure: context } : context;
}

/**
 * 이 브러시가 종이와 상호작용하는 **매체**. null이면 종이를 아예 타지 않는 도구다.
 * 극성 분류(건식/수채/유화)의 단일 권위는 `studio-paper-media-profile-v1`이다.
 */
export function resolveStudioPaperBrushMedium(brushId: unknown): StudioPaperMediumV1 | null {
  if (
    typeof brushId === "string"
    && STUDIO_AUTHORED_WET_DYNAMIC_PAPER_RESPONSE_IDS.has(brushId.trim().toLowerCase())
  ) {
    return null;
  }
  const family = resolveStudioBrushRenderFamily(brushId);
  if (STUDIO_PAPER_BRUSH_RESPONSE[family] === STUDIO_PAPER_GRANULATION_IDENTITY) {
    return null;
  }
  return resolveStudioPaperMediumForBrushFamilyV1(family);
}

/**
 * Rank helper for tests / UI: effective granulation strength on a given paper.
 */
export function resolveStudioPaperBrushEffectiveGranulation(
  brushId: unknown,
  paperKind?: PaperGrainKind | unknown,
): number {
  const response = resolveStudioPaperBrushResponse(brushId, paperKind);
  return response.granulation * (1 - response.staining);
}
