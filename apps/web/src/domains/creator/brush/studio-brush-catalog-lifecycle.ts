/**
 * V17.1 catalogue lifecycle & curated variant-family metadata.
 *
 * Two governance views exist over the same brush SSOT and they answer different questions:
 * - `studio-brush-variant-group-manifest.ts` DERIVES a total partition (every paint id, grouped by
 *   runtime canonical/lane/pack keys) and stages ids by their runtime registration depth.
 * - THIS module is the curated EXPOSURE-TIER view: `core` means "surfaced on a default UI shelf
 *   today" (quick-shelf starter kit + CSP sub tool palette), and variant groups are hand-named
 *   medium families whose membership is obvious from ids/names — comparison-lab material, not a
 *   partition. Most presets are deliberately ungrouped here; the manifest partition covers them.
 *
 * The stage vocabulary is shared with the manifest (`BrushLifecycleStage`) so the two views can
 * never fork the ladder itself; only the `core`/`extended` boundary differs by design (셸프 노출
 * 여부 vs 런타임 등록 깊이). Quarantine and experimental membership come from their single sources
 * (`studio-brush-quarantine.ts` ledger, manifest pin list) — never re-declared here.
 *
 * The core-shelf table below is EXPLICIT for reviewability, and audited fail-fast at module load
 * against the live shelf sources: a shelf edit that is not mirrored here throws instead of letting
 * the metadata drift (지침: 선언과 실재가 어긋나면 조용히 넘어가지 않는다). Metadata only — this
 * slice changes no default listing, shelf, or picker behavior.
 *
 * Imports the FULL catalogue (lazy boundary) plus the governance manifest, so it is
 * governance/lab/CI-side by construction — never import it from always-visible Studio chrome.
 */
import { STUDIO_BEGINNER_BRUSH_IDS } from "../studio-creative-ux";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";
import {
  resolveStudioBrushRuntimeContract,
  studioBrushRuntimeExecutionSignature,
} from "./studio-brush-runtime-contract";
import { STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS } from "./studio-brush-variant-group-manifest";
import { STUDIO_SUB_TOOL_PALETTE_CATEGORIES } from "./studio-sub-tool-palette-data";

import type { StudioBrushCatalogItem } from "./studio-brush-catalog";
import type {
  BrushLifecycleStage,
  StudioBrushVariantComparisonAxis,
} from "./studio-brush-variant-group-manifest";

export type { BrushLifecycleStage, StudioBrushVariantComparisonAxis };

// ---------------------------------------------------------------------------
// Lifecycle stage table
// ---------------------------------------------------------------------------

/**
 * Presets surfaced on a default UI shelf today — the curated `core` tier. Two live sources feed
 * this table and the load audit below keeps it byte-true to both:
 * - 퀵 셸프 스타터 키트 (`STUDIO_BEGINNER_BRUSH_IDS`) — the fallback the compact shelf shows before
 *   any favorite/MRU exists,
 * - CSP 서브 툴 팔레트 (`STUDIO_SUB_TOOL_PALETTE_CATEGORIES`) — the curated category tabs, taken
 *   AFTER its fail-closed builder (unknown/quarantined/mode-mismatched seeds already dropped).
 */
export const STUDIO_BRUSH_CORE_SHELF_PRESET_IDS: readonly string[] = Object.freeze([
  // 퀵 셸프 스타터 키트
  "pen",
  "gpen",
  "watercolor",
  "inkwash-pen",
  "inkwash-water-brush",
  "airbrush",
  "pencil",
  "marker",
  "brush",
  "highlighter",
  "fountain-pen",
  // 2026-08-22 제2차 로스터 축소: ballpoint·felt-tip 은 causal-ink:round 서명의 굵기 중간값이라
  // 격리 원장(A′)으로 delist 됐습니다 — 스타터 키트에서도 함께 뺐습니다.
  // 2026-09-02 feel-cull: fineliner · pencil-6b · colored-pencil · flat-brush · crosshatch 격리.
  "standard-eraser",
  "kneaded-eraser",
  // 2026-09-04 quality-first 큐레이션: 서브 툴 팔레트가 계열마다 대표 하나만 남기면서
  // maru-pen·calligraphy·erodible-pencil·ink-brush·gouache·oil·airbrush-fine·web-dot-tone 이
  // 셸프에서 빠지고 charcoal--compressed-edge·gouache--matte-body·oil--filbert-ribbon 이
  // 그 자리를 대신한다. 셸프가 SSOT 이고 이 표는 그 거울이다.
  // 2026-09-06 빠른 선택 축소(#771, docs/studio-brush-filter-discovery-2026-09-06.md): 간편
  // 서브 툴 23→18. perfect-ink·pencil-grain·hard-airbrush 는 팔레트에서 빠져 extended 로
  // 내려가고, inkwash-pen·inkwash-water-brush·brush 는 팔레트에서만 빠져 스타터 키트로 core 를
  // 유지한다. 같은 렌더링 판정이 아니라 먼저 보이는 선택지를 줄인 편집 결정이다.
  // 서브 툴 팔레트 — 연필·목탄 (2026-09-02 feel-cull: 6b·colored-pencil 격리, 남은 연필 레인 유지)
  "pencil--side-shade",
  "charcoal--compressed-edge",
  // 서브 툴 팔레트 — 채색·물감 (2026-08-22: ink-wash 는 watercolor 와 같은 서명이라 격리 D′로 delist)
  "gouache--matte-body",
  "oil--filbert-ribbon",
  // 서브 툴 팔레트 — 분사·입자
  "spray",
  "splatter",
  // 서브 툴 팔레트 — 만화
  "web-radial-burst",
  "screentone",
  "web-cross-hatch-pen",
]);

const CATALOG_ITEM_BY_ID: ReadonlyMap<string, StudioBrushCatalogItem> = new Map(
  STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => [item.id, item]),
);

const EXPERIMENTAL_PRESET_ID_SET: ReadonlySet<string> = new Set(
  STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS,
);

const CORE_SHELF_PRESET_ID_SET: ReadonlySet<string> = new Set(
  STUDIO_BRUSH_CORE_SHELF_PRESET_IDS,
);

/** The live default-shelf union the explicit core table must mirror exactly. */
function deriveCoreShelfPresetIds(): ReadonlySet<string> {
  const ids = new Set<string>(STUDIO_BEGINNER_BRUSH_IDS);
  for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
    for (const tool of category.tools) ids.add(tool.id);
  }
  return ids;
}

/**
 * Fail-fast core-table audit. The table is explicit for review, the shelves stay the single source
 * of truth: any divergence (stale entry, un-mirrored shelf addition, a quarantined or
 * experimental-pinned id claiming the core tier, an id the catalogue no longer ships) throws at
 * load instead of resolving a stage the UI does not actually honor.
 */
function auditCoreShelfStageTable(): string[] {
  const issues: string[] = [];
  const derived = deriveCoreShelfPresetIds();
  if (CORE_SHELF_PRESET_ID_SET.size !== STUDIO_BRUSH_CORE_SHELF_PRESET_IDS.length) {
    issues.push("core shelf table contains duplicate ids");
  }
  for (const id of STUDIO_BRUSH_CORE_SHELF_PRESET_IDS) {
    if (!CATALOG_ITEM_BY_ID.has(id)) {
      issues.push(`${id}: core shelf table id is not a shipped catalogue preset`);
    }
    if (isStudioBrushQuarantinedPresetId(id)) {
      issues.push(`${id}: quarantined id can never hold the core exposure tier`);
    }
    if (EXPERIMENTAL_PRESET_ID_SET.has(id)) {
      issues.push(`${id}: experimental-pinned id can never hold the core exposure tier`);
    }
    if (!derived.has(id)) {
      issues.push(`${id}: listed core but surfaced on no default shelf — stale table entry`);
    }
  }
  for (const id of derived) {
    if (!CORE_SHELF_PRESET_ID_SET.has(id)) {
      issues.push(`${id}: surfaced on a default shelf but missing from the core table`);
    }
  }
  return issues;
}

const CORE_SHELF_STAGE_TABLE_ISSUES = auditCoreShelfStageTable();
if (CORE_SHELF_STAGE_TABLE_ISSUES.length > 0) {
  throw new Error(
    `Invalid Studio brush lifecycle core table: ${CORE_SHELF_STAGE_TABLE_ISSUES.join("; ")}`,
  );
}

/**
 * Exposure-tier stage of one preset id. Total over the shipped catalogue, `null` beyond it — the
 * caller decides, never a silent stage. Precedence mirrors the manifest resolver (quarantine wins,
 * then the experimental lab pin), and the audits above keep the tiers disjoint so precedence can
 * never mask a table conflict. `lab` is pre-catalogue vocabulary and is never returned for a
 * shipped id.
 */
export function brushLifecycleStageOf(presetId: unknown): BrushLifecycleStage | null {
  if (typeof presetId !== "string" || presetId.length === 0) return null;
  if (isStudioBrushQuarantinedPresetId(presetId)) return "quarantined";
  if (EXPERIMENTAL_PRESET_ID_SET.has(presetId)) return "experimental";
  if (CORE_SHELF_PRESET_ID_SET.has(presetId)) return "core";
  if (CATALOG_ITEM_BY_ID.has(presetId)) return "extended";
  return null;
}

// ---------------------------------------------------------------------------
// Curated variant groups
// ---------------------------------------------------------------------------

export interface BrushVariantGroup {
  readonly id: string;
  /** Korean product intent shared by every member (비교 랩 라벨). */
  readonly intent: string;
  /** Curated members across core/lane/pro sources; quarantined ids stay partitioned (V17.1). */
  readonly memberPresetIds: readonly string[];
  /** Derived from renderer-contract facts — never hand-asserted (지침 6 honesty). */
  readonly comparisonAxes: readonly StudioBrushVariantComparisonAxis[];
}

interface CuratedVariantGroupSeed {
  readonly id: string;
  readonly intent: string;
  readonly memberPresetIds: readonly string[];
}

/**
 * Hand-named medium families whose membership is obvious from ids/names alone — deliberately
 * conservative. Ambiguous ids stay ungrouped rather than guessed (예: `pencil-charcoal-stick` 은
 * 연필/목탄 어느 쪽 주장도 확실치 않아 제외, `brush--oil-lanes` 는 brush 레인이라 oil 계열이
 * 아니다). Quarantined members remain listed: 격리는 노출 제거일 뿐, 비교군 분할은 유지된다.
 */
const CURATED_VARIANT_GROUP_SEEDS: readonly CuratedVariantGroupSeed[] = [
  {
    id: "professional-inking",
    intent: "G펜·마루펜·카부라펜 계열 전문 선화 딥펜 변형군",
    memberPresetIds: [
      "gpen",
      "maru-pen",
      "kaburapen",
      "school-pen",
      "mapping-pen",
      "gpen--croquis-capsule",
      "gpen--causal-round",
      "mypaint-cc0--kabura",
      "g-pen-flex",
      "maru-pen-fine",
    ],
  },
  {
    id: "watercolor",
    intent: "수채 번짐·입상·백런 표현 변형군",
    memberPresetIds: [
      "watercolor",
      "watercolor--granular",
      "watercolor--dense-core",
      "watercolor--edge-stamp",
      "watercolor--edge-bloom",
      "watercolor--granulating",
      "watercolor--fluid-feather",
      "mypaint-cc0--watercolor-fringe",
      "mypaint-cc0--watercolor-expressive",
      "watercolor-detail-round",
      "watercolor-flat-wash",
      "watercolor-wet-bleed",
      "watercolor-edge-stain",
      "watercolor-dry-granule",
      "watercolor-salt-bloom",
      "watercolor-backrun-ring",
      "watercolor-wet-wash",
    ],
  },
  {
    id: "ink-wash",
    intent: "수묵 번짐·갈필 먹 표현 변형군",
    memberPresetIds: [
      "ink-wash",
      "inkwash-pen",
      "inkwash-water-brush",
      "inkwash-bleed-wash",
      "inkwash-white-ink",
      "ink-wash--sumi-core",
      "ink-wash--bleed-halo",
      "ink-wash--fiber-feather",
      "ink-wash--chroma-halo",
      "ink-wash--living-bake",
      "sumi-wash-fray",
    ],
  },
  {
    id: "pencil",
    intent: "흑연·색연필 스케치 변형군",
    memberPresetIds: [
      "pencil",
      "pencil-2b",
      "pencil-6b",
      "pencil-grain",
      "soft-pencil",
      "erodible-pencil",
      "colored-pencil",
      "pencil--side-shade",
      "pencil--stamp-grain",
      "pencil--erodible-wear",
      "mypaint-cc0--2b-pencil",
      "precision-pencil",
      "comfort-pencil",
      "pencil-4b-rough",
      "pencil-hb-mechanical",
      "pencil-colored-soft",
      "pencil-tilt-shading",
    ],
  },
  {
    id: "charcoal",
    intent: "목탄 소프트·압축 질감 변형군",
    memberPresetIds: [
      "charcoal",
      "charcoal--vine-soft",
      "charcoal--compressed-edge",
      "charcoal--mypaint-stamp",
      "mypaint-cc0--charcoal",
      "mypaint-cc0--charcoal-tanda",
      "velvet-charcoal",
      "compressed-charcoal-edge",
    ],
  },
  {
    id: "chalk",
    intent: "초크 분말·압축 질감 변형군",
    memberPresetIds: [
      "chalk",
      "chalk--klecks-powder",
      "chalk--klecks-stamp",
      "chalk-powder",
      "chalk-rough",
      "chalk-compressed",
    ],
  },
  {
    id: "crayon",
    intent: "크레용 왁스 질감 변형군",
    memberPresetIds: [
      "crayon",
      "crayon--wax-scrape",
      "crayon--klecks-stamp",
      "crayon-wax-bold",
    ],
  },
  {
    id: "pastel",
    intent: "파스텔 분말·종이결 변형군",
    memberPresetIds: [
      "pastel",
      "pastel--cake-soft",
      "pastel--soft-stamp",
      "mypaint-cc0--pastel",
      "pastel-paper-soft",
    ],
  },
  {
    id: "oil-pastel",
    intent: "오일 파스텔 왁스막 변형군",
    memberPresetIds: ["oil-pastel", "oil-pastel--waxy-film", "oil-pastel--wgm-mix"],
  },
  {
    id: "oil",
    intent: "유화 리본·임파스토·나이프 변형군",
    memberPresetIds: [
      "oil",
      "oil--filbert-ribbon",
      "oil--flat-ribbon",
      "oil--impasto-ribbon",
      "oil--tube-extrude",
      "oil--knife-edge",
      "mypaint-cc0--oil-paint",
      "oil-filbert",
      "oil-impasto-heavy",
      "oil-dry-scumble",
      "oil-linen-filbert",
    ],
  },
  {
    id: "airbrush",
    intent: "에어브러시 연무·경계 변형군",
    memberPresetIds: [
      "airbrush",
      "hard-airbrush",
      "airbrush-fine",
      "airbrush--klecks-grit",
      "airbrush--hard-envelope",
      "airbrush--stamp-soft",
      "airbrush-grand-soft",
    ],
  },
  {
    id: "marker",
    intent: "마커 촉·알코올·블렌더 변형군",
    memberPresetIds: [
      "marker",
      "perfect-marker",
      "marker-bold",
      "alcohol-marker",
      "sketchpad-soft-marker",
      "marker--chisel-ribbon",
      "marker--soft-dynamic",
      "mypaint-cc0--marker-fat",
      "mypaint-cc0--marker-small",
      "classic-marker",
      "fiber-marker",
      "clean-flat-marker",
      "alcohol-chisel-marker",
      "taper-brush-marker",
      "marker-colorless-blender",
      "marker-wide-chisel",
    ],
  },
];

/**
 * Fail-fast curated-group referential integrity: every member is a shipped catalogue preset, no
 * id belongs to two families, no family is a trivial singleton. Runs BEFORE fact derivation so a
 * dangling id reports as governance drift, never as a downstream TypeError.
 */
function auditCuratedVariantGroupSeeds(): string[] {
  const issues: string[] = [];
  const seenGroupIds = new Set<string>();
  const ownerGroupIdByMemberId = new Map<string, string>();
  for (const seed of CURATED_VARIANT_GROUP_SEEDS) {
    if (seenGroupIds.has(seed.id)) issues.push(`${seed.id}: duplicate variant group id`);
    seenGroupIds.add(seed.id);
    if (seed.intent.trim().length === 0) issues.push(`${seed.id}: variant group has no intent`);
    if (seed.memberPresetIds.length < 2) {
      issues.push(`${seed.id}: variant group needs at least two members to compare`);
    }
    for (const memberId of seed.memberPresetIds) {
      if (!CATALOG_ITEM_BY_ID.has(memberId)) {
        issues.push(`${seed.id}: member ${memberId} is not a shipped catalogue preset`);
      }
      const ownerGroupId = ownerGroupIdByMemberId.get(memberId);
      if (ownerGroupId !== undefined) {
        issues.push(`${memberId}: claimed by both ${ownerGroupId} and ${seed.id}`);
      }
      ownerGroupIdByMemberId.set(memberId, seed.id);
    }
  }
  return issues;
}

const CURATED_VARIANT_GROUP_ISSUES = auditCuratedVariantGroupSeeds();
if (CURATED_VARIANT_GROUP_ISSUES.length > 0) {
  throw new Error(
    `Invalid Studio brush variant group metadata: ${CURATED_VARIANT_GROUP_ISSUES.join("; ")}`,
  );
}

interface CuratedMemberComparisonFacts {
  readonly isPro: boolean;
  readonly engine: string;
  readonly engineVariant: string;
  readonly tip: string;
  readonly texture: string;
  readonly dynamics: string;
  readonly preview: string;
  readonly executionSignature: string;
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
}

function curatedMemberComparisonFacts(presetId: string): CuratedMemberComparisonFacts {
  const item = CATALOG_ITEM_BY_ID.get(presetId);
  if (!item) {
    // Unreachable after the seed audit; kept so the invariant is loud, never a silent skip.
    throw new Error(`Studio brush lifecycle: ${presetId} left the catalogue after the audit`);
  }
  const packDescriptor = item.source === "pro" ? studioBrushPackDescriptorById(item.id) : null;
  if (item.source === "pro" && !packDescriptor) {
    throw new Error(`Studio brush lifecycle: pro preset ${presetId} has no pack descriptor`);
  }
  const contractId = packDescriptor ? packDescriptor.runtimeBrushId : item.id;
  const contract = resolveStudioBrushRuntimeContract(contractId);
  if (!contract) {
    throw new Error(
      `Studio brush lifecycle: ${presetId} has no runtime contract via ${contractId}`,
    );
  }
  return {
    isPro: packDescriptor !== null,
    engine: contract.engine,
    engineVariant: contract.engineVariant,
    tip: contract.tip,
    texture: contract.texture,
    dynamics: contract.dynamics,
    preview: item.previewStyle,
    executionSignature: studioBrushRuntimeExecutionSignature(contract),
    defaultWidth: item.defaultWidth,
    defaultOpacity: item.defaultOpacity,
  };
}

const COMPARISON_AXIS_ORDER: readonly StudioBrushVariantComparisonAxis[] = Object.freeze([
  "engine",
  "engine-variant",
  "tip",
  "texture",
  "dynamics",
  "preview",
  "default-tuning",
  "runtime-profile",
  "procedural-profile",
]);

function countDistinct<T>(values: readonly T[]): number {
  return new Set(values).size;
}

/**
 * Same axis rules as the manifest's mechanical partition, applied to a curated member set: an axis
 * is emitted only when the renderer-contract facts verifiably differ on it. Duplicated from
 * `studio-brush-variant-group-manifest.ts` because the helper is not exported there — extraction
 * into a shared module is flagged as a follow-up so the two derivations cannot drift.
 */
function deriveCuratedComparisonAxes(
  members: readonly CuratedMemberComparisonFacts[],
): readonly StudioBrushVariantComparisonAxis[] {
  if (members.length < 2) return Object.freeze([]);
  const axes = new Set<StudioBrushVariantComparisonAxis>();
  if (countDistinct(members.map((m) => m.engine)) > 1) axes.add("engine");
  const variantsByEngine = new Map<string, Set<string>>();
  for (const member of members) {
    const variants = variantsByEngine.get(member.engine) ?? new Set<string>();
    variants.add(member.engineVariant);
    variantsByEngine.set(member.engine, variants);
  }
  if ([...variantsByEngine.values()].some((variants) => variants.size > 1)) {
    axes.add("engine-variant");
  }
  if (countDistinct(members.map((m) => m.tip)) > 1) axes.add("tip");
  if (countDistinct(members.map((m) => m.texture)) > 1) axes.add("texture");
  if (countDistinct(members.map((m) => m.dynamics)) > 1) axes.add("dynamics");
  if (countDistinct(members.map((m) => m.preview)) > 1) axes.add("preview");
  if (countDistinct(members.map((m) => `${m.defaultWidth}@${m.defaultOpacity}`)) > 1) {
    axes.add("default-tuning");
  }
  const nonProBySignature = new Map<string, number>();
  let proMemberCount = 0;
  for (const member of members) {
    if (member.isPro) {
      proMemberCount += 1;
      continue;
    }
    nonProBySignature.set(
      member.executionSignature,
      (nonProBySignature.get(member.executionSignature) ?? 0) + 1,
    );
  }
  if ([...nonProBySignature.values()].some((count) => count > 1)) axes.add("runtime-profile");
  if (proMemberCount > 1) axes.add("procedural-profile");
  return Object.freeze(COMPARISON_AXIS_ORDER.filter((axis) => axes.has(axis)));
}

/** Curated medium-family groups with axes derived from renderer-contract facts. */
export const STUDIO_BRUSH_VARIANT_GROUPS: readonly BrushVariantGroup[] = Object.freeze(
  CURATED_VARIANT_GROUP_SEEDS.map((seed) =>
    Object.freeze({
      id: seed.id,
      intent: seed.intent,
      memberPresetIds: Object.freeze([...seed.memberPresetIds]),
      comparisonAxes: deriveCuratedComparisonAxes(
        seed.memberPresetIds.map(curatedMemberComparisonFacts),
      ),
    }),
  ),
);

const VARIANT_GROUP_BY_MEMBER_PRESET_ID: ReadonlyMap<string, BrushVariantGroup> = new Map(
  STUDIO_BRUSH_VARIANT_GROUPS.flatMap((group) =>
    group.memberPresetIds.map((memberId) => [memberId, group] as [string, BrushVariantGroup]),
  ),
);

/**
 * Curated family owning the given preset id, or `null` for the (majority of) presets outside any
 * curated family — coverage here is deliberately partial; the manifest partition is the total one.
 */
export function brushVariantGroupOf(presetId: unknown): BrushVariantGroup | null {
  return typeof presetId === "string"
    ? VARIANT_GROUP_BY_MEMBER_PRESET_ID.get(presetId) ?? null
    : null;
}
