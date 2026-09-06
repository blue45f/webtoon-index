import {
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK,
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
} from "./bg3d/studio-bg3d-procedural-starter-pack";
import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "./brush/studio-brush-library";
import { STUDIO_FILTER_PACK_DEFS } from "./filter/studio-filter-pack";

import type {
  StudioMarketplacePackage,
  StudioMarketplacePackageKind,
} from "./studio-marketplace-packages";
import type { CreatorMarketplaceResourceKind } from "@/shared/lib/creator-marketplace-resource-contract";

export type StudioCreatorPackKind = Extract<
  StudioMarketplacePackageKind,
  "brush" | "filter" | "palette" | "template" | "3d-preset" | "3d-asset"
>;

export interface StudioCreatorPortablePackEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: Exclude<StudioCreatorPackKind, "template" | "3d-preset" | "3d-asset">;
  readonly delivery: {
    readonly mode: "portable-json";
    /** Backend envelope의 `definition`; schemaVersion/resourceKind/runtime은 client가 감싼다. */
    readonly definition: Record<string, unknown>;
  };
}

export interface StudioCreatorBuiltinPackEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: "template" | "3d-preset" | "3d-asset";
  readonly delivery: {
    readonly mode: "builtin-ref";
    readonly runtimeRef: string;
  };
}

export type StudioCreatorPackEntry =
  | StudioCreatorPortablePackEntry
  | StudioCreatorBuiltinPackEntry;

export interface StudioCreatorRuntimeBudget {
  readonly entries: number;
  readonly elements?: number;
  readonly nodes?: number;
  readonly triangles?: number;
  readonly drawCalls?: number;
  readonly materials?: number;
  readonly textures?: number;
}

/** Exact server identity used only for safe migration of pre-logical-id community installs. */
export interface StudioCreatorPackMarketplaceSource {
  readonly schema: "creator-marketplace-resource-v1";
  readonly releaseId: string;
  readonly publisherId: string;
  readonly packageId: string;
}

export interface StudioCreatorPackDefinition {
  readonly metadata: StudioMarketplacePackage;
  readonly resourceKind: Exclude<CreatorMarketplaceResourceKind, "asset">;
  readonly entries: readonly StudioCreatorPackEntry[];
  readonly marketplaceSource?: StudioCreatorPackMarketplaceSource;
  readonly runtimeDescriptor: {
    readonly engines: readonly ("canvas2d" | "webgl2" | "webgpu" | "three")[];
    readonly budget: StudioCreatorRuntimeBudget;
  };
}

const CREATOR = Object.freeze({
  id: "toonspectrum-lab",
  name: "ToonSpectrum Lab",
  verified: true,
});

const LICENSE = Object.freeze({
  id: "cc0-1.0",
  label: "CC0 1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  commercialUse: true,
  attributionRequired: false,
  derivativesAllowed: true,
  redistributionAllowed: true,
  sourceVerifiedAt: "2026-07-26T00:00:00.000Z",
  summary: "상업 작품 사용·수정·재배포가 가능한 ToonSpectrum 독자 원본입니다.",
});

const PORTABLE_AVAILABILITY = Object.freeze({
  catalog: "bundled",
  library: "local-only",
  payment: "unavailable",
  cloudSync: "unavailable",
  exportManifest: "local-only",
} as const);

const BUILTIN_AVAILABILITY = Object.freeze({
  catalog: "bundled",
  library: "bundled",
  payment: "unavailable",
  cloudSync: "unavailable",
  exportManifest: "local-only",
} as const);

function includedItems(
  kind: StudioCreatorPackKind,
  entries: readonly StudioCreatorPackEntry[],
) {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind,
    format: entry.delivery.mode === "portable-json" ? "portable-json" : "builtin-ref",
    contentFingerprint: `${entry.id}-v1`,
    tags: [kind, entry.delivery.mode],
  }));
}

function definePack(input: {
  id: string;
  name: string;
  summary: string;
  category: string;
  kind: StudioCreatorPackKind;
  tags: readonly string[];
  entries: readonly StudioCreatorPackEntry[];
  engines: StudioMarketplacePackage["compatibility"]["renderer"];
  contractEngines: StudioCreatorPackDefinition["runtimeDescriptor"]["engines"];
  formats: readonly string[];
  budget: StudioCreatorRuntimeBudget;
  builtin?: boolean;
}): StudioCreatorPackDefinition {
  return Object.freeze({
    resourceKind: input.kind,
    entries: Object.freeze([...input.entries]),
    runtimeDescriptor: Object.freeze({
      engines: Object.freeze([...input.contractEngines]),
      budget: Object.freeze({ ...input.budget }),
    }),
    metadata: Object.freeze({
      schema: "toonspectrum.studio-marketplace-package",
      id: input.id,
      name: input.name,
      summary: input.summary,
      category: input.category,
      tags: Object.freeze([...input.tags]),
      kind: input.kind,
      access: "free",
      accessLabel: "무료",
      origin: "original-procedural",
      creator: CREATOR,
      version: "1.0.0",
      packageFingerprint: `${input.id}:1.0.0`,
      compatibility: Object.freeze({
        studioVersion: "1.0.0",
        renderer: Object.freeze([...input.engines]),
        devices: Object.freeze(["desktop", "tablet", "mobile"] as const),
        formats: Object.freeze([...input.formats]),
      }),
      license: LICENSE,
      includedItems: Object.freeze(includedItems(input.kind, input.entries)),
      changelog: Object.freeze([{
        version: "1.0.0",
        releasedAt: "2026-07-26T00:00:00.000Z",
        changes: Object.freeze(["독자 제작 무료 스타터 팩 최초 공개"]),
      }]),
      placementPresets: Object.freeze([]),
      availability: input.builtin ? BUILTIN_AVAILABILITY : PORTABLE_AVAILABILITY,
      updatedAt: "2026-07-26T00:00:00.000Z",
    } satisfies StudioMarketplacePackage),
  });
}

const brushEntries = Object.freeze([
  {
    id: "ts-pack-production-gpen",
    name: "연재 G펜 · 즉시 반응",
    kind: "brush",
    delivery: {
      mode: "portable-json",
      definition: {
        snapshot: {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          sourcePresetId: "ts-pack-production-gpen",
          sourcePresetName: "연재 G펜 · 즉시 반응",
          brushId: "gpen",
          strokeWidth: 7,
          color: "#16100c",
          pressureCurve: 0.9,
          pressureMinSize: 0.08,
        },
      },
    },
  },
  {
    id: "ts-pack-story-pencil",
    name: "콘티 2B 연필",
    kind: "brush",
    delivery: {
      mode: "portable-json",
      definition: {
        snapshot: {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          sourcePresetId: "ts-pack-story-pencil",
          sourcePresetName: "콘티 2B 연필",
          brushId: "pencil-2b",
          strokeWidth: 3.5,
          brushOpacity: 0.88,
          color: "#282422",
          pressureMinSize: 0.12,
        },
      },
    },
  },
  {
    id: "ts-pack-flat-marker",
    name: "밑색 플랫 마커",
    kind: "brush",
    delivery: {
      mode: "portable-json",
      definition: {
        snapshot: {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          sourcePresetId: "ts-pack-flat-marker",
          sourcePresetName: "밑색 플랫 마커",
          brushId: "marker",
          strokeWidth: 18,
          brushOpacity: 0.72,
          color: "#e96f55",
          pressureCurve: 1.15,
        },
      },
    },
  },
] as const satisfies readonly StudioCreatorPortablePackEntry[]);

const filterEntries = Object.freeze([
  {
    id: "ts-filter-focus-vignette",
    name: "대사 집중 비네트",
    kind: "filter",
    delivery: {
      mode: "portable-json",
      definition: {
        engine: "vignette",
        values: { ...STUDIO_FILTER_PACK_DEFS.vignette.defaults, darkness: 42, size: 62 },
      },
    },
  },
  {
    id: "ts-filter-night-duotone",
    name: "야간 듀오톤",
    kind: "filter",
    delivery: {
      mode: "portable-json",
      definition: {
        engine: "duotone",
        values: { shadow: "#172038", highlight: "#f4cf9a" },
      },
    },
  },
  {
    id: "ts-filter-print-grain",
    name: "인쇄 질감 노이즈",
    kind: "filter",
    delivery: {
      mode: "portable-json",
      definition: {
        engine: "noise-add",
        values: { amount: 14, seed: 2718 },
      },
    },
  },
] as const satisfies readonly StudioCreatorPortablePackEntry[]);

const paletteEntries = Object.freeze([
  {
    id: "ts-palette-romance-light",
    name: "로맨스 소프트 라이트",
    kind: "palette",
    delivery: {
      mode: "portable-json",
      definition: {
        colors: ["#2f2430", "#f28f9d", "#ffc4bd", "#ffe3c8", "#fff8ee"],
      },
    },
  },
  {
    id: "ts-palette-night-city",
    name: "도시 야간 조명",
    kind: "palette",
    delivery: {
      mode: "portable-json",
      definition: {
        colors: ["#111827", "#25304f", "#536d9c", "#58c8d8", "#f2bd66", "#f06c75"],
      },
    },
  },
  {
    id: "ts-palette-action-impact",
    name: "액션 임팩트",
    kind: "palette",
    delivery: {
      mode: "portable-json",
      definition: {
        colors: ["#16100c", "#4a1115", "#b9252d", "#f0643c", "#ffc857", "#f7f2e8"],
      },
    },
  },
] as const satisfies readonly StudioCreatorPortablePackEntry[]);

const templateEntries = Object.freeze([
  ["ts-template-confession", "고백 장면", "studio-scene-template:confession"],
  ["ts-template-action-chase", "액션 추격", "studio-scene-template:action-chase"],
  ["ts-template-daily-talk", "일상 대화", "studio-scene-template:daily-talk"],
].map(([id, name, runtimeRef]) => ({
  id,
  name,
  kind: "template" as const,
  delivery: { mode: "builtin-ref" as const, runtimeRef },
})));

const bg3dEntry = Object.freeze({
  id: "ts-bg3d-procedural-starter",
  name: STUDIO_BG3D_PROCEDURAL_STARTER_PACK.label,
  kind: "3d-preset" as const,
  delivery: {
    mode: "builtin-ref" as const,
    runtimeRef: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
  },
});

export const STUDIO_CREATOR_PACK_CATALOG = Object.freeze([
  definePack({
    id: "ts-creator-pack-production-brushes",
    name: "웹툰 원고 브러시 미니 팩",
    summary: "G펜·콘티 연필·밑색 마커를 기존 Studio 브러시 라이브러리에 실제 설치합니다.",
    category: "브러시",
    kind: "brush",
    tags: ["브러시", "원고", "필기감"],
    entries: brushEntries,
    engines: ["canvas2d"],
    contractEngines: ["canvas2d"],
    formats: ["studio-brush-v1", "portable-json"],
    budget: { entries: brushEntries.length },
  }),
  definePack({
    id: "ts-creator-pack-scene-filters",
    name: "웹툰 장면 보정 프리셋",
    summary: "비네트·듀오톤·노이즈 값을 기존 비파괴 필터 패치로 변환하는 로컬 프리셋입니다.",
    category: "필터",
    kind: "filter",
    tags: ["필터", "장면", "보정"],
    entries: filterEntries,
    engines: ["canvas2d", "webgl"],
    contractEngines: ["canvas2d", "webgl2"],
    formats: ["studio-filter-v1", "portable-json"],
    budget: { entries: filterEntries.length },
  }),
  definePack({
    id: "ts-creator-pack-story-palettes",
    name: "장르 조명 팔레트",
    summary: "로맨스·야경·액션 팔레트를 기존 Studio 팔레트 라이브러리에 실제 저장합니다.",
    category: "팔레트",
    kind: "palette",
    tags: ["팔레트", "색상", "장르"],
    entries: paletteEntries,
    engines: ["canvas2d", "svg"],
    contractEngines: ["canvas2d"],
    formats: ["studio-palette-v1", "portable-json"],
    budget: { entries: paletteEntries.length },
  }),
  definePack({
    id: "ts-creator-pack-scene-templates",
    name: "연재 장면 템플릿 셀렉션",
    summary: "이미 설치된 Studio 장면 템플릿의 안정적인 ID만 참조하며 알 수 없는 ID는 거부합니다.",
    category: "템플릿",
    kind: "template",
    tags: ["템플릿", "장면", "연재"],
    entries: templateEntries,
    engines: ["canvas2d", "svg"],
    contractEngines: ["canvas2d"],
    formats: ["studio-template-v1", "builtin-ref"],
    budget: { entries: templateEntries.length, elements: 32 },
    builtin: true,
  }),
  definePack({
    id: "ts-creator-pack-bg3d-procedural",
    name: "절차형 3D 무료 스타터",
    summary: "외부 파일 없이 생성되는 내장 3D 팩을 참조하며 WebGL2/WebGPU 호환성과 예산을 먼저 검사합니다.",
    category: "3D 프리셋",
    kind: "3d-preset",
    tags: ["3D", "배경", "절차형"],
    entries: [bg3dEntry],
    engines: ["webgl", "webgpu"],
    contractEngines: ["webgl2", "webgpu", "three"],
    formats: ["studio-bg3d-preset-v1", "builtin-ref"],
    budget: {
      entries: 1,
      ...STUDIO_BG3D_PROCEDURAL_STARTER_PACK.budget,
    },
    builtin: true,
  }),
] satisfies readonly StudioCreatorPackDefinition[]);

export function findStudioCreatorPack(
  packageId: string,
): StudioCreatorPackDefinition | null {
  return STUDIO_CREATOR_PACK_CATALOG.find(
    (pack) => pack.metadata.id === packageId,
  ) ?? null;
}
