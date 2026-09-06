import {
  formatMarketByteSize,
  formatMarketDate,
  marketKindMeta,
  marketLicenseMeta,
} from "./market-kind";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

const ENGINE_LABELS: Readonly<Record<string, string>> = {
  canvas2d: "Canvas 2D",
  webgl2: "WebGL 2",
  webgpu: "WebGPU",
  three: "Three.js",
};

const DELIVERY_LABELS: Readonly<Record<string, string>> = {
  "portable-json": "portable JSON",
  "procedural-recipe": "절차형 레시피",
  "builtin-ref": "Studio 내장 참조",
};

export interface MarketComparisonRow {
  readonly key: string;
  readonly label: string;
  readonly values: readonly string[];
  readonly different: boolean;
}

export interface MarketComparisonSummary {
  readonly itemCount: number;
  readonly kindCount: number;
  readonly licenseCount: number;
  readonly totalEntryCount: number;
  readonly totalManifestBytes: number;
  readonly aiIncludedCount: number;
  readonly commonEngines: readonly string[];
}

function row(
  key: string,
  label: string,
  values: readonly string[],
): MarketComparisonRow {
  return {
    key,
    label,
    values,
    different: new Set(values).size > 1,
  };
}

function engines(record: CreatorMarketplaceResourceRecord): string {
  return record.compatibility.engines
    .map((engine) => ENGINE_LABELS[engine] ?? engine)
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

function deliveryModes(record: CreatorMarketplaceResourceRecord): string {
  const modes = [...new Set(record.entries.map((entry) => entry.delivery.mode))];
  return modes.map((mode) => DELIVERY_LABELS[mode] ?? mode).join(", ");
}

function provenance(record: CreatorMarketplaceResourceRecord): string {
  if (record.provenance.origin === "original") return "배급자 직접 제작으로 공개";
  return `외부 허용 출처 · ${record.provenance.sourceName}`;
}

export function createMarketComparisonRows(
  records: readonly CreatorMarketplaceResourceRecord[],
): MarketComparisonRow[] {
  return [
    row("kind", "종류", records.map((record) => marketKindMeta(record.kind).label)),
    row("publisher", "배급자", records.map((record) => record.publisher.name)),
    row("version", "현재 버전", records.map((record) => `v${record.resourceVersion}`)),
    row(
      "minimum-studio",
      "최소 Studio 버전",
      records.map((record) => `v${record.minimumStudioVersion}`),
    ),
    row(
      "license",
      "라이선스",
      records.map((record) => marketLicenseMeta(record.license).label),
    ),
    row("engines", "호환 엔진", records.map(engines)),
    row(
      "entries",
      "패키지 항목",
      records.map((record) => `${record.entries.length}개`),
    ),
    row(
      "size",
      "manifest 크기",
      records.map((record) => formatMarketByteSize(record.manifestByteSize)),
    ),
    row("delivery", "전달 방식", records.map(deliveryModes)),
    row(
      "ai",
      "AI 사용 공개",
      records.map((record) => record.containsAi ? "포함으로 공개" : "미포함으로 공개"),
    ),
    row("provenance", "출처", records.map(provenance)),
    row(
      "attribution",
      "출처 표기문",
      records.map((record) => record.attributionText || "표기문 없음"),
    ),
    row("updated", "최근 업데이트", records.map((record) => formatMarketDate(record.updatedAt))),
  ];
}

export function summarizeMarketComparison(
  records: readonly CreatorMarketplaceResourceRecord[],
): MarketComparisonSummary {
  const engineSets = records.map((record) => new Set(record.compatibility.engines));
  const commonEngines = engineSets.length === 0
    ? []
    : [...engineSets[0]!]
        .filter((engine) => engineSets.every((set) => set.has(engine)))
        .map((engine) => ENGINE_LABELS[engine] ?? engine)
        .sort((left, right) => left.localeCompare(right));

  return {
    itemCount: records.length,
    kindCount: new Set(records.map((record) => record.kind)).size,
    licenseCount: new Set(records.map((record) => record.license)).size,
    totalEntryCount: records.reduce((sum, record) => sum + record.entries.length, 0),
    totalManifestBytes: records.reduce(
      (sum, record) => sum + record.manifestByteSize,
      0,
    ),
    aiIncludedCount: records.filter((record) => record.containsAi).length,
    commonEngines,
  };
}
