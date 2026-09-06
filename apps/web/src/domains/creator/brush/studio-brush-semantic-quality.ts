/**
 * Runtime-grounded brush semantics and catalogue-claim audit.
 *
 * Brush names are product promises, not renderer implementations. This module keeps those two
 * layers connected without loading the lazy full catalogue:
 *
 * - UI can expose the exact runtime tip, texture and input dynamics selected for the next stroke.
 * - governance/CI can compare Korean/English catalogue claims against the actual runtime contract,
 *   authored quality axes and deterministic material-response evidence.
 *
 * No renderer behavior or persisted stroke payload changes here. Existing documents replay exactly
 * as before; the module only makes mismatches observable and testable.
 */

import {
  resolveStudioBrushRuntimeContract,
  type StudioBrushRuntimeContract,
  type StudioBrushRuntimeDynamics,
  type StudioBrushRuntimeEngine,
  type StudioBrushRuntimeTexture,
  type StudioBrushRuntimeTip,
} from "./studio-brush-runtime-contract";

export const STUDIO_BRUSH_RUNTIME_TIP_LABELS_KO: Readonly<
  Record<StudioBrushRuntimeTip, string>
> = Object.freeze({
  round: "원형 촉",
  "pressure-round": "필압 원형 촉",
  chisel: "치즐 촉",
  square: "사각 촉",
  "angled-ribbon": "방향성 리본 촉",
  "soft-diffuse": "확산 촉",
  "soft-particle": "소프트 입자 촉",
  flake: "플레이크 촉",
  hard: "하드 촉",
  sponge: "스펀지 촉",
  bristle: "강모 촉",
  grain: "그레인 촉",
  spark: "반짝임 입자 촉",
  "tone-dot": "망점 촉",
  "stamp-ink": "잉크 스탬프 촉",
  "stamp-airbrush": "에어브러시 스탬프 촉",
  "stamp-pencil": "연필 스탬프 촉",
  "stamp-wet-edge": "웻 엣지 스탬프 촉",
});

export const STUDIO_BRUSH_RUNTIME_TEXTURE_LABELS_KO: Readonly<
  Record<StudioBrushRuntimeTexture, string>
> = Object.freeze({
  none: "매끈",
  "soft-gradient": "소프트 그라데이션",
  "wet-edge": "웻 엣지",
  "procedural-grain": "절차형 그레인",
  "procedural-bristle": "절차형 강모",
  "procedural-spark": "결정적 반짝임",
  "tone-grid": "문서 고정 망점",
  "custom-alpha-capable": "알파 질감",
});

export const STUDIO_BRUSH_RUNTIME_DYNAMICS_LABELS_KO: Readonly<
  Record<StudioBrushRuntimeDynamics, string>
> = Object.freeze({
  "causal-pressure": "필압 추종",
  "stamp-pressure-flow": "필압·유량",
  "tilt-pressure": "기울기·필압",
  "outline-pressure": "윤곽 필압",
  "fixed-path": "고정 경로",
  "seeded-particles": "시드 입자",
  "ribbon-pressure": "리본 필압",
  "watercolor-pressure": "수채 필압",
  "bristle-pressure": "강모 필압",
  "mapped-dabs": "다중 매핑",
  "grain-jitter": "그레인·지터",
  "pastel-pressure": "파스텔 필압",
  "global-grid": "문서 고정 격자",
});

export interface StudioBrushRuntimeSemanticPresentation {
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly operation: "erase" | "paint";
  readonly engine: StudioBrushRuntimeEngine;
  readonly engineVariant: string;
  readonly canonicalId: string;
  readonly tip: StudioBrushRuntimeTip;
  readonly texture: StudioBrushRuntimeTexture;
  readonly dynamics: StudioBrushRuntimeDynamics;
  readonly tipLabelKo: string;
  readonly textureLabelKo: string;
  readonly dynamicsLabelKo: string;
  readonly summaryKo: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Describes a catalogue identity through the renderer carrier that actually executes it.
 *
 * Core brushes normally use the same id for both arguments. Procedural catalogue brushes pass
 * their display `catalogId` plus the generic runtime carrier (`ink-particle`, `airbrush` or
 * `dry-media`). Keeping both ids in the receipt avoids claiming that a decorative preset owns a
 * renderer it merely configures.
 */
export function describeStudioBrushRuntimeSemantics(
  catalogIdInput: unknown,
  runtimeBrushIdInput?: unknown,
): StudioBrushRuntimeSemanticPresentation | null {
  const catalogId = nonEmptyString(catalogIdInput);
  if (!catalogId) return null;
  const runtimeBrushId = nonEmptyString(runtimeBrushIdInput) ?? catalogId;
  const contract = resolveStudioBrushRuntimeContract(runtimeBrushId);
  if (!contract) return null;
  const tipLabelKo = STUDIO_BRUSH_RUNTIME_TIP_LABELS_KO[contract.tip];
  const textureLabelKo = STUDIO_BRUSH_RUNTIME_TEXTURE_LABELS_KO[contract.texture];
  const dynamicsLabelKo = STUDIO_BRUSH_RUNTIME_DYNAMICS_LABELS_KO[contract.dynamics];
  return Object.freeze({
    catalogId,
    runtimeBrushId,
    operation: contract.operation ?? "paint",
    engine: contract.engine,
    engineVariant: contract.engineVariant,
    canonicalId: contract.canonicalId,
    tip: contract.tip,
    texture: contract.texture,
    dynamics: contract.dynamics,
    tipLabelKo,
    textureLabelKo,
    dynamicsLabelKo,
    summaryKo: `${tipLabelKo} · ${textureLabelKo} · ${dynamicsLabelKo}`,
  });
}

export interface StudioBrushSemanticQualityAxes {
  readonly edgeSoftness?: number;
  readonly grain?: number;
  readonly wetness?: number;
  readonly bristle?: number;
  readonly particleScatter?: number;
  readonly anisotropy?: number;
  readonly opacityBuildUp?: number;
  readonly pressureResponse?: number;
  readonly tiltResponse?: number;
  readonly velocityResponse?: number;
  readonly accumulation?: number;
  readonly stabilization?: number;
}

export interface StudioBrushSemanticMaterialEvidence {
  /** Scatter distance divided by rendered dab size. */
  readonly meanScatterRatio?: number;
  readonly tipAlphaVariance?: number;
  readonly grainMultiplierVariance?: number;
  readonly materialAlphaVariance?: number;
  readonly occupiedRatio?: number;
  readonly dualBlendMode?: "multiply" | "none" | "screen";
}

export interface StudioBrushSemanticAuditInput {
  readonly catalogId: string;
  readonly runtimeBrushId?: string;
  readonly name: string;
  readonly shortName?: string;
  readonly hint?: string;
  readonly searchAliases?: readonly string[];
  readonly portfolioLabel?: string;
  readonly operation?: "erase" | "paint";
  readonly previewStyle?: string;
  readonly axes?: StudioBrushSemanticQualityAxes;
  readonly material?: StudioBrushSemanticMaterialEvidence | null;
  /** Exact planner/dynamics evidence when available. Undefined means “not measured”, not false. */
  readonly pressureResponsive?: boolean;
}

export type StudioBrushSemanticIssueSeverity = "error" | "warning";

export type StudioBrushSemanticIssueCode =
  | "missing-runtime-contract"
  | "operation-contract-mismatch"
  | "eraser-name-operation-mismatch"
  | "wet-claim-without-wet-response"
  | "grain-claim-without-grain-response"
  | "bristle-claim-without-bristle-response"
  | "directional-claim-without-directional-tip"
  | "particle-claim-without-particle-response"
  | "glow-claim-without-glow-response"
  | "tone-claim-without-grid-response"
  | "pressure-claim-without-pressure-response"
  | "fixed-pressure-claim-with-responsive-response";

export interface StudioBrushSemanticIssue {
  readonly severity: StudioBrushSemanticIssueSeverity;
  readonly code: StudioBrushSemanticIssueCode;
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly messageKo: string;
}

export interface StudioBrushSemanticAuditResult {
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly presentation: StudioBrushRuntimeSemanticPresentation | null;
  readonly normalizedClaims: string;
  readonly issues: readonly StudioBrushSemanticIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
}

const CLAIM_PATTERNS = Object.freeze({
  eraser: /(?:지우개|소거|eraser|erase)/iu,
  wet: /(?:수채|수묵|물붓|워시|번짐|젖은|watercolou?r|ink\s*wash|wash|wet[\s-]*edge|bleed|sumi)/iu,
  grain: /(?:그레인|과립|종이\s*결|공극|거친\s*결|백묵|분필|목탄|파스텔|크레용|흑연|grain|granulat|paper\s*tooth|chalk|charcoal|pastel|crayon|graphite)/iu,
  bristle: /(?:강모|붓결|필버트|팬\s*붓|갈퀴|bristle|filbert|fan\s*brush|rake)/iu,
  directional: /(?:평붓|평면|납작|치즐|칼끝|칼날|리본|사각|타원|측면|방향성|chisel|flat[\s-]*brush|flat[\s-]*nib|knife|ribbon|square|oval|side[\s-]*shade)/iu,
  particle: /(?:입자|알갱이|가루|스프레이|스플래터|흩어|글리터|반짝|별|눈송이|먼지|particle|spray|splatter|scatter|glitter|spark|star|flake|dust)/iu,
  glow: /(?:네온|발광|후광|광선|글로우|neon|glow|halo|luminous)/iu,
  tone: /(?:망점|스크린톤|톤\s*도트|해칭|교차선|격자|그리드|패턴|screentone|halftone|cross[\s-]*hatch|hatch|grid|pattern)/iu,
  pressure: /(?:필압에\s*따라|압력에\s*따라|필압\s*반응|pressure[\s-]*(?:sensitive|response)|responds?\s*to\s*pressure)/iu,
  fixedPressure: /(?:필압을?\s*무시|압력을?\s*무시|균일\s*굵기|일정\s*굵기|고정\s*굵기|uniform(?:\s*width)?|fixed[\s-]*pressure|pressure[\s-]*flat)/iu,
});

function finite01(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function combinedClaimText(input: StudioBrushSemanticAuditInput): string {
  return [
    input.catalogId,
    input.name,
    input.shortName,
    input.hint,
    input.portfolioLabel,
    ...(input.searchAliases ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, " ")
    .trim();
}

function contractSupportsPressure(contract: StudioBrushRuntimeContract): boolean {
  return !(
    contract.dynamics === "fixed-path"
    || contract.dynamics === "global-grid"
  );
}

function issue(
  input: StudioBrushSemanticAuditInput,
  runtimeBrushId: string,
  severity: StudioBrushSemanticIssueSeverity,
  code: StudioBrushSemanticIssueCode,
  messageKo: string,
): StudioBrushSemanticIssue {
  return Object.freeze({
    severity,
    code,
    catalogId: input.catalogId,
    runtimeBrushId,
    messageKo,
  });
}

/**
 * Compares catalogue language with the renderer contract and measured evidence.
 *
 * Only missing runtime authority, operation disagreement and an eraser/paint contradiction are hard
 * errors. Material-language mismatches are warnings because authored alpha maps can carry visual
 * evidence that a lightweight runtime contract cannot fully describe. The governance audit supplies
 * material-response metrics to turn those warnings into evidence-backed decisions.
 */
export function auditStudioBrushSemanticClaims(
  input: StudioBrushSemanticAuditInput,
): StudioBrushSemanticAuditResult {
  const runtimeBrushId = nonEmptyString(input.runtimeBrushId) ?? input.catalogId;
  const presentation = describeStudioBrushRuntimeSemantics(
    input.catalogId,
    runtimeBrushId,
  );
  const text = combinedClaimText(input);
  const issues: StudioBrushSemanticIssue[] = [];

  if (!presentation) {
    issues.push(issue(
      input,
      runtimeBrushId,
      "error",
      "missing-runtime-contract",
      `“${input.name}”(${input.catalogId})의 실행 브러시 ${runtimeBrushId}에 런타임 계약이 없습니다.`,
    ));
    return Object.freeze({
      catalogId: input.catalogId,
      runtimeBrushId,
      presentation: null,
      normalizedClaims: text,
      issues: Object.freeze(issues),
      errorCount: 1,
      warningCount: 0,
    });
  }

  const contract = resolveStudioBrushRuntimeContract(runtimeBrushId)!;
  const contractOperation = contract.operation ?? "paint";
  if (input.operation && input.operation !== contractOperation) {
    issues.push(issue(
      input,
      runtimeBrushId,
      "error",
      "operation-contract-mismatch",
      `카탈로그 동작 ${input.operation}과 런타임 동작 ${contractOperation}이 다릅니다.`,
    ));
  }

  const eraserClaim = CLAIM_PATTERNS.eraser.test(text);
  if (eraserClaim !== (input.operation === "erase" || contractOperation === "erase")) {
    issues.push(issue(
      input,
      runtimeBrushId,
      "error",
      "eraser-name-operation-mismatch",
      eraserClaim
        ? "이름은 지우개를 약속하지만 실제 동작은 페인트입니다."
        : "실제 동작은 지우개인데 이름·설명에 지우개 의미가 없습니다.",
    ));
  }

  const axes = input.axes ?? {};
  const material = input.material ?? {};
  const previewStyle = input.previewStyle ?? "";
  const supportsWet =
    contract.engine === "watercolor-dabs"
    || contract.texture === "wet-edge"
    || finite01(axes.wetness) >= 0.35;
  const supportsGrain =
    contract.texture === "procedural-grain"
    || contract.texture === "custom-alpha-capable"
    || contract.tip === "grain"
    || contract.tip === "sponge"
    || contract.tip === "bristle"
    || contract.tip === "stamp-pencil"
    || finite01(axes.grain) >= 0.3
    || finiteNonNegative(material.grainMultiplierVariance) >= 0.002
    || finiteNonNegative(material.materialAlphaVariance) >= 0.003;
  const supportsBristle =
    contract.engine === "oil-ribbon"
    || contract.texture === "procedural-bristle"
    || contract.tip === "bristle"
    || finite01(axes.bristle) >= 0.3;
  const supportsDirectional =
    contract.engine === "oil-ribbon"
    || contract.texture === "procedural-bristle"
    || contract.tip === "chisel"
    || contract.tip === "square"
    || contract.tip === "angled-ribbon"
    || contract.dynamics === "tilt-pressure"
    || contract.dynamics === "ribbon-pressure"
    || previewStyle === "calligraphy"
    || finite01(axes.anisotropy) >= 0.3
    || finite01(axes.tiltResponse) >= 0.2;
  const supportsParticle =
    contract.engine === "particle-scatter"
    || contract.dynamics === "seeded-particles"
    || contract.tip === "soft-particle"
    || contract.tip === "spark"
    || contract.tip === "flake"
    || previewStyle === "dots"
    || previewStyle === "glitter"
    || finite01(axes.particleScatter) >= 0.25
    || finiteNonNegative(material.meanScatterRatio) >= 0.08;
  const supportsGlow =
    contract.engine === "neon-halo"
    || contract.engine === "glow-halo"
    || contract.texture === "procedural-spark"
    || (
      contract.texture === "soft-gradient"
      && (contract.tip === "soft-diffuse" || contract.tip === "spark")
    );
  const supportsTone =
    contract.engine === "screentone-dots"
    || contract.texture === "tone-grid"
    || contract.dynamics === "global-grid"
    || previewStyle === "tone";
  const pressureResponsive =
    input.pressureResponsive ?? (
      finite01(axes.pressureResponse) >= 0.1
        ? true
        : contractSupportsPressure(contract)
    );

  const warn = (
    pattern: RegExp,
    supported: boolean,
    code: StudioBrushSemanticIssueCode,
    messageKo: string,
  ) => {
    if (pattern.test(text) && !supported) {
      issues.push(issue(input, runtimeBrushId, "warning", code, messageKo));
    }
  };

  warn(
    CLAIM_PATTERNS.wet,
    supportsWet,
    "wet-claim-without-wet-response",
    "이름·설명은 젖은 매체/번짐을 약속하지만 웻 엣지 엔진이나 충분한 wetness 근거가 없습니다.",
  );
  warn(
    CLAIM_PATTERNS.grain,
    supportsGrain,
    "grain-claim-without-grain-response",
    "이름·설명은 종이 결·과립을 약속하지만 런타임/재질 응답에서 그레인 근거가 부족합니다.",
  );
  warn(
    CLAIM_PATTERNS.bristle,
    supportsBristle,
    "bristle-claim-without-bristle-response",
    "이름·설명은 강모/필버트 결을 약속하지만 강모 엔진·팁·품질축 근거가 없습니다.",
  );
  warn(
    CLAIM_PATTERNS.directional,
    supportsDirectional,
    "directional-claim-without-directional-tip",
    "이름·설명은 평붓·치즐·방향성 촉을 약속하지만 실제 촉/기울기 응답이 방향성을 뒷받침하지 않습니다.",
  );
  warn(
    CLAIM_PATTERNS.particle,
    supportsParticle,
    "particle-claim-without-particle-response",
    "이름·설명은 입자·산포를 약속하지만 실제 입자 엔진/산포 응답 근거가 없습니다.",
  );
  warn(
    CLAIM_PATTERNS.glow,
    supportsGlow,
    "glow-claim-without-glow-response",
    "이름·설명은 네온/후광을 약속하지만 발광·소프트 광학 응답 근거가 없습니다.",
  );
  warn(
    CLAIM_PATTERNS.tone,
    supportsTone,
    "tone-claim-without-grid-response",
    "이름·설명은 망점·해칭·격자를 약속하지만 문서 고정 패턴 응답 근거가 없습니다.",
  );
  warn(
    CLAIM_PATTERNS.pressure,
    pressureResponsive,
    "pressure-claim-without-pressure-response",
    "이름·설명은 필압 반응을 약속하지만 실제 플래너/동역학에서 필압 차이가 확인되지 않습니다.",
  );
  if (CLAIM_PATTERNS.fixedPressure.test(text) && pressureResponsive) {
    issues.push(issue(
      input,
      runtimeBrushId,
      "warning",
      "fixed-pressure-claim-with-responsive-response",
      "이름·설명은 필압을 무시한다고 약속하지만 실제 플래너/동역학은 필압에 반응합니다.",
    ));
  }

  const errorCount = issues.filter(({ severity }) => severity === "error").length;
  return Object.freeze({
    catalogId: input.catalogId,
    runtimeBrushId,
    presentation,
    normalizedClaims: text,
    issues: Object.freeze(issues),
    errorCount,
    warningCount: issues.length - errorCount,
  });
}
