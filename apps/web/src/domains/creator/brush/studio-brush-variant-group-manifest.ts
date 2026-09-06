/**
 * V17.1 catalogue governance — derived variant groups, quality receipts, lifecycle stages.
 *
 * The brush shelf deliberately keeps intentionally-similar variants across engines (사용자 지시:
 * 필기감/질감이 다르면 이름을 차별화해 중복 유지). That policy is only safe when every shipped
 * paint preset is governed: grouped with its siblings for comparison labs, scored on the fixed
 * 질감 40 / 동역학 15 / 가장자리 10 / 결정성 10 / 고유성 10 / 성능 10 / 편집성 5 weights, and
 * staged on the Lab → Experimental → Extended → Core lifecycle.
 *
 * Everything here is DERIVED from the catalogue SSOT (`STUDIO_PAINT_BRUSH_CATALOG_ITEMS`) — never
 * a hand-maintained list — so a new preset cannot ship ungoverned. Grouping keys, in member order:
 *   - pro-pack preset  → pro-pack category (`pack:{category}`; prefixed because pack categories
 *     such as "marker"/"chalk" collide with real preset ids),
 *   - engine-lane preset (`{base}--{lane}`) → its lane `baseId`. Deliberately NOT collapsed onto
 *     the base preset's runtime `canonicalId`: canonical folding is an engine-dedup fact, while a
 *     lane group is a medium-local comparison lab (예: `ink-wash--*` 수묵 레인은 watercolor 캐노니컬
 *     로 흡수되지 않고 자체 비교군을 이룬다),
 *   - core preset → its runtime-contract `canonicalId`.
 * Keys share one namespace, so lanes hanging off a self-canonical base (예: `oil--*`) merge with
 * that base's core family — exactly the cross-engine comparison the groups exist for.
 *
 * Quality receipts are measurements, never inventions: the bench stage only carries what is
 * mechanically checkable today (plan determinism via same-seed double-run digests and plan-time
 * against the catalogue freeze budget — see `scripts/studio-brush-catalogue-perf-matrix.ts`).
 * Texture/dynamics/edge/uniqueness/editability stay `null` until the browser fidelity labs land;
 * the `bench`/`certified` union makes a partial receipt impossible to mistake for a scored one.
 *
 * Lifecycle stages gate catalogue EXPOSURE only. Persisted strokes replay through the runtime
 * contract regardless of stage (`USED_PRESET_DATA_PRESERVED` — 노출 제거 ≠ 작품 데이터 삭제).
 * V17.1 adds the `quarantined` stage on top: ids in the `studio-brush-quarantine.ts` ledger drop
 * out of the default picker listing while staying fully registered, and the audit at the bottom
 * of this module fail-fasts if a quarantined id ever loses its catalogue row or runtime contract.
 *
 * This module imports the FULL catalogue (`studio-brush-catalog.ts`, a lazy boundary), so it is
 * governance/lab/CI-side by construction — never import it from always-visible Studio chrome.
 */

import { STUDIO_PAINT_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { studioBrushEngineLaneRowById } from "./studio-brush-engine-lane-catalog";
import {
  studioBrushPackDescriptorById,
  type StudioBrushPackCategory,
} from "./studio-brush-pack-index";
import {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID,
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
} from "./studio-brush-quarantine";
import {
  resolveStudioBrushRuntimeContract,
  studioBrushRuntimeExecutionSignature,
} from "./studio-brush-runtime-contract";

import type { StudioBrushCatalogItem } from "./studio-brush-catalog";

export {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID,
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
};

export const STUDIO_BRUSH_VARIANT_GROUP_MANIFEST_VERSION =
  "studio-brush-variant-group-manifest-v1" as const;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * `lab` is the pre-catalogue stage (candidate recipes exercised by the fidelity labs only). The
 * resolver below can never return it for a shipped id — anything inside the SSOT is at least
 * `experimental` — but the stage participates in the type so lab manifests share one vocabulary.
 *
 * `quarantined` is the exposure-removal stage (V17.1): the preset stays fully registered — SSOT
 * row, runtime contract, byte-identical persisted replay — but the catalogue picker stops listing
 * it (`studio-brush-catalog.ts` derives its default listing from this stage). Membership lives in
 * the `studio-brush-quarantine.ts` ledger, one reason per id, and is audited below.
 */
export type BrushLifecycleStage =
  | "lab"
  | "experimental"
  | "extended"
  | "core"
  | "quarantined";

/**
 * Shipped ids pinned to the `experimental` stage while their browser-lab receipts are pending.
 * The current wave's new engine lanes are appended here by the catalogue integrator in the same
 * change that lands their rows, so they surface as 실험 단계 from day one.
 * 2026-08-13 brush quality wave: 11 new engine lanes (dry-stamp x4, wet-texture x4, oil x3).
 * 2026-08-13 wave 3: 17 new engine lanes (CC0 MyPaint verbatim import x12, croquis capsule x2,
 * living-ink settled bake x2, bristle-physics oil x1).
 *
 * 2026-08-21 roster reduction wave: 12 pins were RESOLVED rather than renewed. The lab period
 * exists to decide whether a lane earns a permanent shelf slot; for those 12 the answer came back
 * "no — it shares an execution signature with a lane that already ships", so the pin was removed
 * here and the id moved to the quarantine ledger with its measured reason. Resolving the pin first
 * is exactly what the audit below demands (`resolve the pin first`), so the guard stays strict:
 * this list and the quarantine ledger must remain disjoint.
 */
export const STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS: readonly string[] = Object.freeze([
  "crayon--klecks-stamp",
  "chalk--klecks-stamp",
  "charcoal--mypaint-stamp",
  "pastel--soft-stamp",
  "watercolor--edge-bloom",
  "ink-wash--fiber-feather",
  "ink-wash--chroma-halo",
  "brush--impasto-relief",
  "brush--bristle-depletion",
  // 2026-08-27 oil-pastel--wgm-mix 핀 RESOLVED: 랩의 답은 "영구 진열대 부적격" — contact-tooth
  // 결합에서 커밋 탭이 알파 0.014 로 붕괴(실측). 격리 원장으로 이동.
  // 2026-08-13 wave 3 (2026-08-21 웨이브에서 중복 12종의 핀을 해제하고 격리 원장으로 옮김)
  // 2026-09-02 feel-cull: 2b-pencil · dry-brush · splatter · kabura · marker-fat
  // 핀 RESOLVED — 같은 stamp 서명을 이미 노출 중인 코어 스탬프와 공유해 격리 원장으로 이동.
  "mypaint-cc0--ink-blot",
  // 2026-08-27 mypaint-cc0--watercolor-fringe 핀 RESOLVED: 커밋 스탬프 워시 탭 16px@delta3
  // 결정적 불가시(실측). 격리 원장으로 이동.
  "gpen--croquis-capsule",
  "pen--croquis-stabilized",
  "ink-wash--living-bake",
  "brush--bristle-physics",
]);

const EXPERIMENTAL_LANE_PRESET_ID_SET: ReadonlySet<string> = new Set(
  STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS,
);

/**
 * Stage resolution is derivational, mirroring the grouping-key sources:
 * quarantine ledger → experimental pin → pro pack (`extended`) → engine lane (`extended`) →
 * runtime contract (`core`). Unknown ids resolve to `null` — the caller decides, never a silent
 * stage. Quarantine wins over every other stage: exposure is removed even though the preset stays
 * fully registered for persisted-document replay (`USED_PRESET_DATA_PRESERVED`).
 */
export function resolveStudioBrushLifecycleStage(
  brushId: unknown,
): BrushLifecycleStage | null {
  if (typeof brushId !== "string" || brushId.length === 0) return null;
  if (isStudioBrushQuarantinedPresetId(brushId)) return "quarantined";
  if (EXPERIMENTAL_LANE_PRESET_ID_SET.has(brushId)) return "experimental";
  if (studioBrushPackDescriptorById(brushId)) return "extended";
  if (studioBrushEngineLaneRowById(brushId)) return "extended";
  if (resolveStudioBrushRuntimeContract(brushId)) return "core";
  return null;
}

/**
 * Fail-fast quarantine registration audit (pen-convergence guard). Quarantine is EXPOSURE removal
 * only, so every ledger entry must still be a fully registered paint preset:
 * - SSOT catalogue row present — persisted documents keep resolving metadata by id,
 * - runtime contract present — `resolveStudioBrushRuntime` keeps resolving `exact`, never the pen
 *   safe-fallback and never a silent texture substitute (지침 3),
 * - a pro pack preset may be delisted, but only while another preset in ITS OWN pack category stays
 *   exposed (2026-08-21 owner decision: the pack is allowed to shrink — 비슷한 질감이 너무 많다 —
 *   but no purchased category may go dark, and the descriptor itself never leaves the pack, so the
 *   ordinal-seeded dynamics of every OTHER pack id stay byte-identical),
 * - never a pinned experimental lane (lab period) — resolve the pin first,
 * - a non-quarantined canonical sibling exists — the owner's removal precondition (그룹 내 대안)
 *   stays mechanically true, which also shields self-canonical core family representatives.
 */
function auditStudioBrushQuarantineRegistration(): string[] {
  const paintIds = new Set(STUDIO_PAINT_BRUSH_CATALOG_ITEMS.map((item) => item.id));
  const issues: string[] = [];
  for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
    if ((STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID[quarantinedId] ?? "").trim().length === 0) {
      issues.push(`${quarantinedId}: quarantine entry has no owner-auditable reason`);
    }
    if (!paintIds.has(quarantinedId)) {
      issues.push(`${quarantinedId}: not a shipped paint preset — quarantine would orphan persisted strokes`);
    }
    const packDescriptor = studioBrushPackDescriptorById(quarantinedId);
    if (packDescriptor) {
      // Owner-sold content may be delisted, never orphaned: the pack category the buyer paid for
      // must still hand them a working brush. The descriptor stays in the pack either way, so
      // replay and every other id's array-ordinal dynamics are untouched.
      const exposedCategorySibling = STUDIO_PAINT_BRUSH_CATALOG_ITEMS.some((item) => (
        item.id !== quarantinedId
        && !isStudioBrushQuarantinedPresetId(item.id)
        && studioBrushPackDescriptorById(item.id)?.category === packDescriptor.category
      ));
      if (!exposedCategorySibling) {
        issues.push(
          `${quarantinedId}: pro-pack preset leaves no exposed ${packDescriptor.category} sibling`,
        );
      }
    }
    if (EXPERIMENTAL_LANE_PRESET_ID_SET.has(quarantinedId)) {
      issues.push(`${quarantinedId}: pinned experimental lane keeps its lab period — resolve the pin first`);
    }
    // Pro-pack ids never own a contract under their own name — they materialize onto one of the
    // three durable pack runtimes, exactly as `resolveVariantGroupMemberFacts` resolves them. Look
    // the contract up the same way so the "would converge to the pen safe-fallback" check keeps
    // testing the real replay path instead of failing on a lookup that was never going to hit.
    const contractId = packDescriptor ? packDescriptor.runtimeBrushId : quarantinedId;
    const contract = resolveStudioBrushRuntimeContract(contractId);
    if (!contract) {
      issues.push(`${quarantinedId}: runtime contract missing — the id would converge to the pen safe-fallback`);
      continue;
    }
    // A pro id shares its runtime brush with ~50 pack siblings, so its `canonicalId` is that shared
    // runtime and says nothing about whether an alternative stays exposed. The pack-category check
    // above is that preset's version of this invariant; running the family check here as well would
    // only re-assert a fact about the runtime trio.
    if (packDescriptor) continue;
    // The invariant is that an alternative stays drawable, not that the id happens to be a
    // variant of something. A self-canonical preset therefore qualifies when its render family
    // still exposes another preset (사용자 기준: "대체 브러시군이 있다면"), which is exactly the
    // case for defective singletons whose family siblings are verified working.
    if (contract.canonicalId === quarantinedId) {
      const exposedFamilySibling = STUDIO_PAINT_BRUSH_CATALOG_ITEMS.some((item) => (
        item.id !== quarantinedId
        && !isStudioBrushQuarantinedPresetId(item.id)
        && resolveStudioBrushRuntimeContract(item.id)?.family === contract.family
      ));
      if (!exposedFamilySibling) {
        issues.push(
          `${quarantinedId}: self-canonical preset leaves no exposed ${contract.family} alternative`,
        );
      }
    } else if (isStudioBrushQuarantinedPresetId(contract.canonicalId)) {
      issues.push(`${quarantinedId}: canonical alternative ${contract.canonicalId} is quarantined too`);
    }
  }
  return issues;
}

const STUDIO_BRUSH_QUARANTINE_REGISTRATION_ISSUES = auditStudioBrushQuarantineRegistration();
if (STUDIO_BRUSH_QUARANTINE_REGISTRATION_ISSUES.length > 0) {
  throw new Error(
    `Invalid Studio brush quarantine manifest: ${STUDIO_BRUSH_QUARANTINE_REGISTRATION_ISSUES.join("; ")}`,
  );
}

// ---------------------------------------------------------------------------
// Variant groups
// ---------------------------------------------------------------------------

export type StudioBrushVariantGroupKind = "medium-family" | "pro-pack-category";

/**
 * Axes on which the members of one group verifiably differ. The first six compare the renderer
 * contract tuple (pro presets contribute the durable engine they materialize onto plus their own
 * preview/defaults). The last two capture differentiation the tuple cannot see:
 * - `runtime-profile`: 2+ non-pro members share one execution signature, so the runtime tells
 *   them apart through exact-id profiles (the declared `profile-variant` mechanism).
 * - `procedural-profile`: 2+ pro-pack members — every pack id owns a distinct ordinal-seeded
 *   dynamics snapshot by construction.
 */
export type StudioBrushVariantComparisonAxis =
  | "engine"
  | "engine-variant"
  | "tip"
  | "texture"
  | "dynamics"
  | "preview"
  | "default-tuning"
  | "runtime-profile"
  | "procedural-profile";

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

export interface BrushVariantGroup {
  readonly groupId: string;
  readonly kind: StudioBrushVariantGroupKind;
  /** Korean product intent shared by every member (비교 랩/셸프 그룹 라벨). */
  readonly intent: string;
  /** SSOT preset the medium group hangs off; `null` for pro-pack category groups. */
  readonly anchorPresetId: string | null;
  /** Pro-pack category for pack groups; `null` for medium groups. */
  readonly packCategory: StudioBrushPackCategory | null;
  /** SSOT catalogue order — every paint id appears in exactly one group. */
  readonly memberPresetIds: readonly string[];
  readonly comparisonAxes: readonly StudioBrushVariantComparisonAxis[];
}

const STUDIO_BRUSH_PACK_CATEGORY_LABEL_KO: Readonly<Record<StudioBrushPackCategory, string>> =
  Object.freeze({
    ink: "잉크",
    sketch: "스케치",
    chalk: "초크",
    flat: "평붓",
    marker: "마커",
    texture: "질감",
    paint: "페인트",
    rake: "갈퀴",
    foliage: "초목",
    pattern: "패턴",
    stamp: "스탬프",
    pixel: "픽셀",
    tone: "톤",
    effect: "효과",
  });

type VariantGroupMemberSource = "core" | "engine-lane" | "pro-pack";

interface VariantGroupMemberFacts {
  readonly presetId: string;
  readonly source: VariantGroupMemberSource;
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

interface VariantGroupKey {
  readonly groupId: string;
  readonly kind: StudioBrushVariantGroupKind;
  readonly anchorPresetId: string | null;
  readonly packCategory: StudioBrushPackCategory | null;
}

function resolveVariantGroupMemberFacts(item: StudioBrushCatalogItem): VariantGroupMemberFacts {
  const packDescriptor = item.source === "pro" ? studioBrushPackDescriptorById(item.id) : null;
  if (item.source === "pro" && !packDescriptor) {
    throw new Error(`Studio brush variant manifest: pro preset ${item.id} has no pack descriptor`);
  }
  const contractId = packDescriptor ? packDescriptor.runtimeBrushId : item.id;
  const contract = resolveStudioBrushRuntimeContract(contractId);
  if (!contract) {
    // The runtime-contract module fail-fasts at load when a core preset lacks a contract, so this
    // guard only fires on impossible states (e.g. a pack runtime id leaving the durable trio).
    throw new Error(`Studio brush variant manifest: ${item.id} has no runtime contract via ${contractId}`);
  }
  const source: VariantGroupMemberSource = packDescriptor
    ? "pro-pack"
    : studioBrushEngineLaneRowById(item.id)
      ? "engine-lane"
      : "core";
  return {
    presetId: item.id,
    source,
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

function resolveVariantGroupKey(
  item: StudioBrushCatalogItem,
  intentNameByPresetId: ReadonlyMap<string, string>,
): VariantGroupKey & { readonly intent: string } {
  const packDescriptor = item.source === "pro" ? studioBrushPackDescriptorById(item.id) : null;
  if (packDescriptor) {
    return {
      groupId: `pack:${packDescriptor.category}`,
      kind: "pro-pack-category",
      anchorPresetId: null,
      packCategory: packDescriptor.category,
      intent: `${STUDIO_BRUSH_PACK_CATEGORY_LABEL_KO[packDescriptor.category]} 프로 팩 변형군`,
    };
  }
  const laneRow = studioBrushEngineLaneRowById(item.id);
  const anchorPresetId = laneRow
    ? laneRow.baseId
    : resolveStudioBrushRuntimeContract(item.id)?.canonicalId ?? null;
  if (!anchorPresetId) {
    throw new Error(`Studio brush variant manifest: ${item.id} resolves no grouping key`);
  }
  return {
    groupId: `medium:${anchorPresetId}`,
    kind: "medium-family",
    anchorPresetId,
    packCategory: null,
    intent: `${intentNameByPresetId.get(anchorPresetId) ?? anchorPresetId} 계열 변형군`,
  };
}

function countDistinct<T>(values: readonly T[]): number {
  return new Set(values).size;
}

function deriveVariantGroupComparisonAxes(
  members: readonly VariantGroupMemberFacts[],
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
    if (member.source === "pro-pack") {
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

/**
 * Partition every SSOT paint id into exactly one variant group. Pure and deterministic: member
 * order preserves catalogue order, group order preserves first-member appearance.
 */
export function buildStudioBrushVariantGroups(): readonly BrushVariantGroup[] {
  const intentNameByPresetId = new Map(
    STUDIO_PAINT_BRUSH_CATALOG_ITEMS.map((item) => [item.id, item.name]),
  );
  const draftsByGroupId = new Map<
    string,
    VariantGroupKey & { readonly intent: string; readonly members: VariantGroupMemberFacts[] }
  >();
  for (const item of STUDIO_PAINT_BRUSH_CATALOG_ITEMS) {
    const key = resolveVariantGroupKey(item, intentNameByPresetId);
    const draft = draftsByGroupId.get(key.groupId) ?? { ...key, members: [] };
    draft.members.push(resolveVariantGroupMemberFacts(item));
    draftsByGroupId.set(key.groupId, draft);
  }
  return Object.freeze(
    [...draftsByGroupId.values()].map((draft) =>
      Object.freeze({
        groupId: draft.groupId,
        kind: draft.kind,
        intent: draft.intent,
        anchorPresetId: draft.anchorPresetId,
        packCategory: draft.packCategory,
        memberPresetIds: Object.freeze(draft.members.map((member) => member.presetId)),
        comparisonAxes: deriveVariantGroupComparisonAxes(draft.members),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Quality receipts
// ---------------------------------------------------------------------------

export type StudioBrushQualityAxis =
  | "texture"
  | "dynamics"
  | "edge"
  | "determinism"
  | "uniqueness"
  | "performance"
  | "editability";

const QUALITY_AXIS_ORDER: readonly StudioBrushQualityAxis[] = Object.freeze([
  "texture",
  "dynamics",
  "edge",
  "determinism",
  "uniqueness",
  "performance",
  "editability",
]);

/**
 * 질감 우선 정책의 수치 고정판(질감 40 / 동역학 15 / 가장자리 10 / 결정성 10 / 고유성 10 /
 * 성능 10 / 편집성 5). Performance stays a veto elsewhere (freeze budgets); its 10% here only
 * ranks presets that already passed the veto — texture is never traded for speed.
 */
export const STUDIO_BRUSH_QUALITY_WEIGHTS: Readonly<Record<StudioBrushQualityAxis, number>> =
  Object.freeze({
    texture: 0.4,
    dynamics: 0.15,
    edge: 0.1,
    determinism: 0.1,
    uniqueness: 0.1,
    performance: 0.1,
    editability: 0.05,
  });

export type StudioBrushQualityReceiptStatus = "bench" | "certified";

/**
 * Bench receipt: only the mechanically-measured axes may carry numbers. The browser-lab axes are
 * typed `null` — not merely nullable — so a fabricated texture/dynamics score cannot compile, and
 * `totalScore` stays `null` because a weighted total over missing axes would be an invention.
 */
export interface BrushQualityReceiptBench {
  readonly presetId: string;
  readonly status: "bench";
  readonly textureScore: null;
  readonly dynamicsScore: null;
  readonly edgeScore: null;
  readonly determinismScore: number | null;
  readonly uniquenessScore: null;
  readonly performanceScore: number | null;
  readonly editabilityScore: null;
  readonly totalScore: null;
  readonly measuredAxes: readonly StudioBrushQualityAxis[];
  readonly pendingAxes: readonly StudioBrushQualityAxis[];
}

/** Certified receipt: every axis measured (browser labs included) and the weighted total fixed. */
export interface BrushQualityReceiptCertified {
  readonly presetId: string;
  readonly status: "certified";
  readonly textureScore: number;
  readonly dynamicsScore: number;
  readonly edgeScore: number;
  readonly determinismScore: number;
  readonly uniquenessScore: number;
  readonly performanceScore: number;
  readonly editabilityScore: number;
  readonly totalScore: number;
  readonly measuredAxes: readonly StudioBrushQualityAxis[];
  readonly pendingAxes: readonly [];
}

export type BrushQualityReceipt = BrushQualityReceiptBench | BrushQualityReceiptCertified;

/**
 * Raw bench observation produced by the catalogue perf matrix
 * (`scripts/studio-brush-catalogue-perf-matrix.ts`): one timed plan against the freeze budget
 * plus a same-seed second plan for digest comparison. `null` digests mean the id planned on a
 * contract-only path where no geometry stream exists to hash — unmeasured, never failed.
 */
export interface StudioBrushQualityBenchMeasurement {
  readonly planOk: boolean;
  readonly planElapsedMs: number;
  readonly planBudgetMs: number;
  readonly planDigestFirst: string | null;
  readonly planDigestSecond: string | null;
}

/** FNV-1a(32) over the IEEE-754 bytes of a numeric plan stream. Seed-stable, Date/random-free. */
export function computeStudioBrushPlanDigest(stream: Iterable<number>): string {
  const view = new DataView(new ArrayBuffer(8));
  let hash = 0x811c_9dc5;
  for (const value of stream) {
    view.setFloat64(0, value, true);
    for (let byte = 0; byte < 8; byte += 1) {
      hash ^= view.getUint8(byte);
      hash = Math.imul(hash, 0x0100_0193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Build the bench-stage receipt for one preset from a mechanical measurement.
 * - `determinismScore`: 1 when both same-seed digests exist and match, 0 when they diverge,
 *   `null` when the path produced no digest (unmeasured — a missing probe is never a failure).
 * - `performanceScore`: plan time normalized against the freeze budget
 *   (`1 − elapsed/budget`, clamped to [0, 1]; 1 ≈ instant, 0 = at/over the freeze budget).
 * A failed plan measures nothing: both axes stay `null` rather than pretending a score.
 */
export function computeStudioBrushQualityReceiptSkeleton(
  presetId: string,
  benchMeasurement?: StudioBrushQualityBenchMeasurement | null,
): BrushQualityReceiptBench {
  let determinismScore: number | null = null;
  let performanceScore: number | null = null;
  if (benchMeasurement && benchMeasurement.planOk) {
    if (
      benchMeasurement.planDigestFirst !== null
      && benchMeasurement.planDigestSecond !== null
    ) {
      determinismScore =
        benchMeasurement.planDigestFirst === benchMeasurement.planDigestSecond ? 1 : 0;
    }
    if (
      Number.isFinite(benchMeasurement.planElapsedMs)
      && Number.isFinite(benchMeasurement.planBudgetMs)
      && benchMeasurement.planBudgetMs > 0
    ) {
      performanceScore = clampUnit(
        1 - Math.max(0, benchMeasurement.planElapsedMs) / benchMeasurement.planBudgetMs,
      );
    }
  }
  const measuredAxes = QUALITY_AXIS_ORDER.filter(
    (axis) =>
      (axis === "determinism" && determinismScore !== null)
      || (axis === "performance" && performanceScore !== null),
  );
  return Object.freeze({
    presetId,
    status: "bench",
    textureScore: null,
    dynamicsScore: null,
    edgeScore: null,
    determinismScore,
    uniquenessScore: null,
    performanceScore,
    editabilityScore: null,
    totalScore: null,
    measuredAxes: Object.freeze(measuredAxes),
    pendingAxes: Object.freeze(QUALITY_AXIS_ORDER.filter((axis) => !measuredAxes.includes(axis))),
  });
}

/**
 * Promote a fully-measured axis record to a certified receipt with the weighted total. Throws on
 * any missing/out-of-range score — certification must be loud about fabricated inputs.
 */
export function certifyStudioBrushQualityReceipt(
  presetId: string,
  scores: Readonly<Record<StudioBrushQualityAxis, number>>,
): BrushQualityReceiptCertified {
  for (const axis of QUALITY_AXIS_ORDER) {
    const score = scores[axis];
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(
        `Studio brush quality receipt: ${presetId} ${axis} score ${String(score)} is not in [0, 1]`,
      );
    }
  }
  const totalScore = QUALITY_AXIS_ORDER.reduce(
    (total, axis) => total + STUDIO_BRUSH_QUALITY_WEIGHTS[axis] * scores[axis],
    0,
  );
  return Object.freeze({
    presetId,
    status: "certified",
    textureScore: scores.texture,
    dynamicsScore: scores.dynamics,
    edgeScore: scores.edge,
    determinismScore: scores.determinism,
    uniquenessScore: scores.uniqueness,
    performanceScore: scores.performance,
    editabilityScore: scores.editability,
    totalScore,
    measuredAxes: QUALITY_AXIS_ORDER,
    pendingAxes: Object.freeze([]) as readonly [],
  });
}
