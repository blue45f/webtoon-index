/**
 * Normalized, format-agnostic preflight for document and raster imports.
 *
 * Codecs own byte validation; this module owns the artist-facing answer to a different question:
 * "what will still be editable after I import this file?" Keeping that answer pure makes ORA,
 * CBZ, PSD bridges, and ordinary raster insertion use the same severity and blocking vocabulary.
 */

export type StudioInterchangeLossFormat = "cbz" | "ora" | "psd" | "raster";

export type StudioInterchangeLossCategory =
  | "pages"
  | "layers"
  | "resolution"
  | "alpha"
  | "color-space"
  | "editability"
  | "proxy";

export type StudioInterchangeLossSeverity =
  | "neutral"
  | "notice"
  | "warning"
  | "critical";

export type StudioInterchangeLossGate = "advisory" | "blocking";
export type StudioInterchangeLossStatus = "ready" | "review" | "blocked";

export type StudioInterchangeAlphaState =
  | "present"
  | "opaque"
  | "unknown"
  | "not-applicable";

export type StudioInterchangeEditability =
  | "layered"
  | "page-images"
  | "pixels"
  | "preview-only"
  | "unknown"
  | "not-applicable";

export interface StudioInterchangeArtifactProfile {
  /** `null` means that the concept does not apply; `undefined` means it was not inspected. */
  readonly pageCount?: number | null;
  /** `null` means that the concept does not apply; `undefined` means it was not inspected. */
  readonly layerCount?: number | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly alpha?: StudioInterchangeAlphaState;
  readonly colorSpace?: string | null;
  readonly editability?: StudioInterchangeEditability;
}

export interface StudioInterchangeProxyProfile {
  readonly enabled: boolean;
  readonly format?: string;
  /** Encoder quality expressed from 0 through 1. */
  readonly quality?: number;
  readonly width?: number;
  readonly height?: number;
  readonly originalRetained?: boolean;
}

export interface StudioInterchangeLossConstraint {
  readonly category: StudioInterchangeLossCategory;
  readonly message: string;
  readonly gate?: StudioInterchangeLossGate;
  /** Blocking constraints are always promoted to `critical`. */
  readonly severity?: "notice" | "warning";
}

export interface StudioInterchangeLossPreviewInput {
  readonly format: StudioInterchangeLossFormat;
  readonly formatLabel?: string;
  readonly fileName?: string;
  readonly source: StudioInterchangeArtifactProfile;
  readonly result: StudioInterchangeArtifactProfile;
  readonly proxy?: StudioInterchangeProxyProfile;
  /** Codec/policy findings can raise a category's severity or prevent confirmation. */
  readonly constraints?: readonly StudioInterchangeLossConstraint[];
}

export interface StudioInterchangeLossFinding {
  readonly category: StudioInterchangeLossCategory;
  readonly label: string;
  readonly severity: StudioInterchangeLossSeverity;
  readonly gate: StudioInterchangeLossGate;
  readonly sourceValue: string;
  readonly resultValue: string;
  readonly summary: string;
  readonly detail: string;
  readonly notes: readonly string[];
}

export interface StudioInterchangeLossSummary {
  readonly fileName: string;
  readonly formatLabel: string;
  readonly findings: readonly StudioInterchangeLossFinding[];
  readonly status: StudioInterchangeLossStatus;
  readonly highestSeverity: StudioInterchangeLossSeverity;
  readonly canConfirm: boolean;
  readonly advisoryCount: number;
  readonly blockingCount: number;
  readonly headline: string;
  readonly description: string;
}

const FORMAT_LABELS: Readonly<Record<StudioInterchangeLossFormat, string>> = Object.freeze({
  cbz: "CBZ",
  ora: "OpenRaster (ORA)",
  psd: "Photoshop (PSD)",
  raster: "래스터 이미지",
});

const CATEGORY_LABELS: Readonly<Record<StudioInterchangeLossCategory, string>> = Object.freeze({
  pages: "페이지",
  layers: "레이어",
  resolution: "해상도",
  alpha: "투명도",
  "color-space": "색공간",
  editability: "편집성",
  proxy: "프록시 변환",
});

const SEVERITY_RANK: Readonly<Record<StudioInterchangeLossSeverity, number>> = Object.freeze({
  neutral: 0,
  notice: 1,
  warning: 2,
  critical: 3,
});

const ALPHA_LABELS: Readonly<Record<StudioInterchangeAlphaState, string>> = Object.freeze({
  present: "투명 픽셀 있음",
  opaque: "불투명",
  unknown: "확인되지 않음",
  "not-applicable": "해당 없음",
});

const EDITABILITY_LABELS: Readonly<Record<StudioInterchangeEditability, string>> = Object.freeze({
  layered: "레이어 구조 편집",
  "page-images": "페이지별 이미지 편집",
  pixels: "픽셀 편집",
  "preview-only": "표시 프록시만 편집",
  unknown: "확인되지 않음",
  "not-applicable": "해당 없음",
});

const EDITABILITY_RANK: Readonly<Record<StudioInterchangeEditability, number>> = Object.freeze({
  layered: 4,
  "page-images": 3,
  pixels: 2,
  "preview-only": 1,
  unknown: 0,
  "not-applicable": 0,
});

interface FindingDraft extends Omit<StudioInterchangeLossFinding, "notes"> {
  notes?: readonly string[];
}

function countLabel(value: number | null | undefined, unit: string): string {
  if (value === null) return "해당 없음";
  if (value === undefined) return "확인되지 않음";
  if (!Number.isSafeInteger(value) || value < 0) return "잘못된 값";
  return `${value.toLocaleString("ko-KR")}${unit}`;
}

function validCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function countFinding(
  category: "layers" | "pages",
  source: number | null | undefined,
  result: number | null | undefined,
  unit: string,
): FindingDraft {
  const sourceValue = countLabel(source, unit);
  const resultValue = countLabel(result, unit);
  const common = { category, label: CATEGORY_LABELS[category], sourceValue, resultValue } as const;

  if (source === null || result === null) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "이 형식에는 적용되지 않습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  if ((source !== undefined && !validCount(source)) || (result !== undefined && !validCount(result))) {
    return {
      ...common,
      severity: "critical",
      gate: "blocking",
      summary: `${CATEGORY_LABELS[category]} 수가 올바르지 않습니다.`,
      detail: `${sourceValue} → ${resultValue}. 파일을 다시 검사해야 합니다.`,
    };
  }
  if (source === undefined || result === undefined) {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: `${CATEGORY_LABELS[category]} 수를 미리 확인하지 못했습니다.`,
      detail: `${sourceValue} → ${resultValue}. 가져온 뒤 결과를 확인하세요.`,
    };
  }
  if (source > 0 && result === 0) {
    return {
      ...common,
      severity: "critical",
      gate: "blocking",
      summary: `${CATEGORY_LABELS[category]}를 가져올 대상이 없습니다.`,
      detail: `${sourceValue} 전체가 제외되므로 현재 설정으로 진행할 수 없습니다.`,
    };
  }
  if (result < source) {
    return {
      ...common,
      severity: "warning",
      gate: "advisory",
      summary: `${sourceValue} 중 ${resultValue}만 유지됩니다.`,
      detail: `${(source - result).toLocaleString("ko-KR")}${unit}이 결과에서 제외되거나 합쳐집니다.`,
    };
  }
  if (result > source) {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: `${sourceValue}가 ${resultValue}로 재구성됩니다.`,
      detail: "내용 손실은 감지되지 않았지만 구조가 달라질 수 있습니다.",
    };
  }
  return {
    ...common,
    severity: "neutral",
    gate: "advisory",
    summary: `${sourceValue}를 그대로 유지합니다.`,
    detail: `${CATEGORY_LABELS[category]} 수가 바뀌지 않습니다.`,
  };
}

function dimensionLabel(width: number | null | undefined, height: number | null | undefined): string {
  if (width === null || height === null) return "해당 없음";
  if (width === undefined || height === undefined) return "확인되지 않음";
  if (!validDimension(width) || !validDimension(height)) return "잘못된 값";
  return `${width.toLocaleString("ko-KR")} × ${height.toLocaleString("ko-KR")} px`;
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function resolutionFinding(
  source: StudioInterchangeArtifactProfile,
  result: StudioInterchangeArtifactProfile,
): FindingDraft {
  const sourceValue = dimensionLabel(source.width, source.height);
  const resultValue = dimensionLabel(result.width, result.height);
  const common = {
    category: "resolution" as const,
    label: CATEGORY_LABELS.resolution,
    sourceValue,
    resultValue,
  };
  if (
    source.width === null || source.height === null ||
    result.width === null || result.height === null
  ) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "이 형식에는 고정 해상도가 적용되지 않습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  const values = [source.width, source.height, result.width, result.height];
  if (values.some((value) => value !== undefined && !validDimension(value))) {
    return {
      ...common,
      severity: "critical",
      gate: "blocking",
      summary: "해상도 정보가 올바르지 않습니다.",
      detail: `${sourceValue} → ${resultValue}. 1px 이상의 안전한 크기가 필요합니다.`,
    };
  }
  if (values.some((value) => value === undefined)) {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: "출력 해상도를 미리 확인하지 못했습니다.",
      detail: `${sourceValue} → ${resultValue}. 가져온 뒤 선명도와 크기를 확인하세요.`,
    };
  }
  const sourceWidth = source.width as number;
  const sourceHeight = source.height as number;
  const resultWidth = result.width as number;
  const resultHeight = result.height as number;
  if (sourceWidth === resultWidth && sourceHeight === resultHeight) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "원본 픽셀 크기를 그대로 유지합니다.",
      detail: `${sourceValue}로 가져옵니다.`,
    };
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const resultRatio = resultWidth / resultHeight;
  const aspectChanged = Math.abs(sourceRatio - resultRatio) / sourceRatio > 0.001;
  const downscaled = resultWidth < sourceWidth || resultHeight < sourceHeight;
  return {
    ...common,
    severity: "warning",
    gate: "advisory",
    summary: aspectChanged
      ? "크기와 가로세로 비율이 바뀝니다."
      : downscaled
        ? "가져오는 동안 해상도가 축소됩니다."
        : "가져오는 동안 해상도가 확대됩니다.",
    detail: `${sourceValue} → ${resultValue}. 픽셀 재표본화로 선명도가 달라질 수 있습니다.`,
  };
}

function alphaValue(value: StudioInterchangeAlphaState | undefined): string {
  return ALPHA_LABELS[value ?? "unknown"];
}

function alphaFinding(
  source: StudioInterchangeArtifactProfile,
  result: StudioInterchangeArtifactProfile,
): FindingDraft {
  const sourceAlpha = source.alpha ?? "unknown";
  const resultAlpha = result.alpha ?? "unknown";
  const sourceValue = alphaValue(sourceAlpha);
  const resultValue = alphaValue(resultAlpha);
  const common = {
    category: "alpha" as const,
    label: CATEGORY_LABELS.alpha,
    sourceValue,
    resultValue,
  };
  if (sourceAlpha === "not-applicable" || resultAlpha === "not-applicable") {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "이 형식에는 투명도가 적용되지 않습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  if (sourceAlpha === "unknown" || resultAlpha === "unknown") {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: "투명도 보존 여부를 미리 확인하지 못했습니다.",
      detail: `${sourceValue} → ${resultValue}. 가장자리와 배경을 확인하세요.`,
    };
  }
  if (sourceAlpha === "present" && resultAlpha === "opaque") {
    return {
      ...common,
      severity: "warning",
      gate: "advisory",
      summary: "투명 픽셀이 불투명 배경에 합성됩니다.",
      detail: "알파 채널을 다시 분리할 수 없으므로 배경색과 가장자리를 확인하세요.",
    };
  }
  return {
    ...common,
    severity: "neutral",
    gate: "advisory",
    summary: sourceAlpha === "present" ? "투명도를 유지합니다." : "불투명 상태를 유지합니다.",
    detail: `${sourceValue} → ${resultValue}`,
  };
}

function normalizedColorSpace(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function colorSpaceFinding(
  source: StudioInterchangeArtifactProfile,
  result: StudioInterchangeArtifactProfile,
): FindingDraft {
  const sourceValue = source.colorSpace === null ? "해당 없음" : source.colorSpace?.trim() || "확인되지 않음";
  const resultValue = result.colorSpace === null ? "해당 없음" : result.colorSpace?.trim() || "확인되지 않음";
  const common = {
    category: "color-space" as const,
    label: CATEGORY_LABELS["color-space"],
    sourceValue,
    resultValue,
  };
  if (source.colorSpace === null || result.colorSpace === null) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "이 형식에는 색공간 변환이 적용되지 않습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  if (!source.colorSpace?.trim() || !result.colorSpace?.trim()) {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: "색공간 또는 ICC 프로필을 확인하지 못했습니다.",
      detail: `${sourceValue} → ${resultValue}. 가져온 뒤 기준 색상과 비교하세요.`,
    };
  }
  if (normalizedColorSpace(source.colorSpace) === normalizedColorSpace(result.colorSpace)) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: `${sourceValue} 색공간을 유지합니다.`,
      detail: "색공간 이름 기준으로 변환이 감지되지 않았습니다.",
    };
  }
  return {
    ...common,
    severity: "warning",
    gate: "advisory",
    summary: `${sourceValue}에서 ${resultValue}(으)로 변환됩니다.`,
    detail: "프로필 변환 또는 프로필 제거로 채도와 명암이 달라질 수 있습니다.",
  };
}

function editabilityValue(value: StudioInterchangeEditability | undefined): string {
  return EDITABILITY_LABELS[value ?? "unknown"];
}

function editabilityFinding(
  source: StudioInterchangeArtifactProfile,
  result: StudioInterchangeArtifactProfile,
): FindingDraft {
  const sourceEditability = source.editability ?? "unknown";
  const resultEditability = result.editability ?? "unknown";
  const sourceValue = editabilityValue(sourceEditability);
  const resultValue = editabilityValue(resultEditability);
  const common = {
    category: "editability" as const,
    label: CATEGORY_LABELS.editability,
    sourceValue,
    resultValue,
  };
  if (sourceEditability === "not-applicable" || resultEditability === "not-applicable") {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: "이 형식에는 구조 편집성이 적용되지 않습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  if (sourceEditability === "unknown" || resultEditability === "unknown") {
    return {
      ...common,
      severity: "notice",
      gate: "advisory",
      summary: "가져온 뒤의 편집 범위를 미리 확인하지 못했습니다.",
      detail: `${sourceValue} → ${resultValue}`,
    };
  }
  if (sourceEditability === resultEditability) {
    return {
      ...common,
      severity: "neutral",
      gate: "advisory",
      summary: `${sourceValue} 범위를 유지합니다.`,
      detail: "가져오기 전후의 기본 편집 단위가 같습니다.",
    };
  }
  if (EDITABILITY_RANK[resultEditability] < EDITABILITY_RANK[sourceEditability]) {
    return {
      ...common,
      severity: "warning",
      gate: "advisory",
      summary: `${sourceValue}에서 ${resultValue}(으)로 제한됩니다.`,
      detail: "원본의 텍스트·벡터·레이어 의미를 결과에서 개별 편집하지 못할 수 있습니다.",
    };
  }
  return {
    ...common,
    severity: "notice",
    gate: "advisory",
    summary: `${sourceValue}가 ${resultValue}(으)로 재구성됩니다.`,
    detail: "편집 단위가 추가되더라도 원본의 의미 구조가 자동 복원되는 것은 아닙니다.",
  };
}

function proxyFinding(proxy?: StudioInterchangeProxyProfile): FindingDraft {
  const common = {
    category: "proxy" as const,
    label: CATEGORY_LABELS.proxy,
    sourceValue: "원본 데이터",
  };
  if (!proxy?.enabled) {
    return {
      ...common,
      resultValue: "원본 사용",
      severity: "neutral",
      gate: "advisory",
      summary: "표시 프록시를 만들지 않습니다.",
      detail: "가져오기 결과가 원본 데이터 경로를 사용합니다.",
    };
  }
  const hasOneDimension = proxy.width !== undefined || proxy.height !== undefined;
  const invalidDimensions = hasOneDimension && (
    proxy.width === undefined || proxy.height === undefined ||
    !validDimension(proxy.width) || !validDimension(proxy.height)
  );
  const invalidQuality = proxy.quality !== undefined && (
    !Number.isFinite(proxy.quality) || proxy.quality < 0 || proxy.quality > 1
  );
  const format = proxy.format?.trim() || "프록시 이미지";
  const dimension = proxy.width !== undefined && proxy.height !== undefined
    ? `${proxy.width.toLocaleString("ko-KR")} × ${proxy.height.toLocaleString("ko-KR")} px`
    : "자동 크기";
  const quality = proxy.quality === undefined
    ? ""
    : ` · 품질 ${Math.round(proxy.quality * 100)}%`;
  const resultValue = `${format} · ${dimension}${quality}`;
  if (invalidDimensions || invalidQuality) {
    return {
      ...common,
      resultValue,
      severity: "critical",
      gate: "blocking",
      summary: "프록시 변환 설정이 올바르지 않습니다.",
      detail: "유효한 가로·세로 크기와 0 이상 1 이하의 품질이 필요합니다.",
    };
  }
  if (proxy.originalRetained) {
    return {
      ...common,
      resultValue,
      severity: "notice",
      gate: "advisory",
      summary: "가벼운 표시 프록시를 만들고 원본도 보관합니다.",
      detail: "캔버스에서는 프록시를 사용하지만 다시 연결하거나 고품질 출력할 원본은 유지됩니다.",
    };
  }
  return {
    ...common,
    resultValue,
    severity: "warning",
    gate: "advisory",
    summary: "원본 대신 표시 프록시를 편집하게 됩니다.",
    detail: "프록시에 없는 픽셀과 압축 전 정보는 이 프로젝트에서 복원할 수 없습니다.",
  };
}

function raisedSeverity(
  current: StudioInterchangeLossSeverity,
  requested: StudioInterchangeLossSeverity,
): StudioInterchangeLossSeverity {
  return SEVERITY_RANK[requested] > SEVERITY_RANK[current] ? requested : current;
}

function applyConstraints(
  draft: FindingDraft,
  constraints: readonly StudioInterchangeLossConstraint[],
): StudioInterchangeLossFinding {
  let severity = draft.severity;
  let gate = draft.gate;
  const notes = [...(draft.notes ?? [])];
  for (const constraint of constraints) {
    const message = constraint.message.trim();
    if (message) notes.push(message);
    if (constraint.gate === "blocking") {
      gate = "blocking";
      severity = "critical";
    } else {
      severity = raisedSeverity(severity, constraint.severity ?? "notice");
    }
  }
  if (gate === "blocking") severity = "critical";
  return Object.freeze({ ...draft, severity, gate, notes: Object.freeze(notes) });
}

function highestSeverity(findings: readonly StudioInterchangeLossFinding[]): StudioInterchangeLossSeverity {
  let highest: StudioInterchangeLossSeverity = "neutral";
  for (const finding of findings) highest = raisedSeverity(highest, finding.severity);
  return highest;
}

function fallbackProfileValue(
  format: StudioInterchangeLossFormat,
  profile: StudioInterchangeArtifactProfile,
): StudioInterchangeArtifactProfile {
  const defaultPageCount = format === "cbz" ? undefined : 1;
  const defaultLayerCount = format === "cbz" ? null : format === "raster" ? 1 : undefined;
  return {
    ...profile,
    pageCount: profile.pageCount === undefined ? defaultPageCount : profile.pageCount,
    layerCount: profile.layerCount === undefined ? defaultLayerCount : profile.layerCount,
  };
}

export function summarizeStudioInterchangeLoss(
  input: StudioInterchangeLossPreviewInput,
): StudioInterchangeLossSummary {
  const source = fallbackProfileValue(input.format, input.source);
  const result = fallbackProfileValue(input.format, input.result);
  const drafts: readonly FindingDraft[] = [
    countFinding("pages", source.pageCount, result.pageCount, "페이지"),
    countFinding("layers", source.layerCount, result.layerCount, "개"),
    resolutionFinding(source, result),
    alphaFinding(source, result),
    colorSpaceFinding(source, result),
    editabilityFinding(source, result),
    proxyFinding(input.proxy),
  ];
  const constraints = input.constraints ?? [];
  const findings = drafts.map((draft) => applyConstraints(
    draft,
    constraints.filter((constraint) => constraint.category === draft.category),
  ));
  const blockingCount = findings.filter((finding) => finding.gate === "blocking").length;
  const advisoryCount = findings.filter(
    (finding) => finding.gate === "advisory" && finding.severity !== "neutral",
  ).length;
  const severity = highestSeverity(findings);
  const status: StudioInterchangeLossStatus = blockingCount > 0
    ? "blocked"
    : advisoryCount > 0
      ? "review"
      : "ready";
  const headline = status === "blocked"
    ? "현재 설정으로는 가져올 수 없습니다"
    : status === "review"
      ? "가져오기 전에 변경 내용을 확인하세요"
      : "원본 특성을 그대로 가져올 수 있습니다";
  const description = status === "blocked"
    ? `${blockingCount.toLocaleString("ko-KR")}개 항목을 해결한 뒤 다시 시도하세요.`
    : status === "review"
      ? `${advisoryCount.toLocaleString("ko-KR")}개 항목이 변환되거나 추가 확인이 필요합니다.`
      : "페이지, 레이어, 픽셀 및 편집성 손실이 감지되지 않았습니다.";

  return Object.freeze({
    fileName: input.fileName?.trim() || "가져올 파일",
    formatLabel: input.formatLabel?.trim() || FORMAT_LABELS[input.format],
    findings: Object.freeze(findings),
    status,
    highestSeverity: severity,
    canConfirm: blockingCount === 0,
    advisoryCount,
    blockingCount,
    headline,
    description,
  });
}
