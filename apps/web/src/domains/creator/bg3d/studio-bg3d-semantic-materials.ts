/**
 * Bounded, renderer-neutral semantic material suggestions for Studio BG3D.
 *
 * This module deliberately consumes names only. It never accepts model bytes, texture handles,
 * URLs, glTF extras, engine objects, or executable callbacks. Suggestions remain ephemeral and
 * must be confirmed by a user before they are persisted by a future material-slot UI.
 */

export const STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS = [
  "skin",
  "hair",
  "eyes",
  "clothes",
  "accessory",
  "background",
  "unknown",
] as const;

export const STUDIO_BG3D_CHARACTER_MATERIAL_SLOTS = [
  "skin",
  "hair",
  "eyes",
  "clothes",
  "accessory",
] as const;

export const STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS = 512;
export const STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND = 16;
export const STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAME_BYTES = 128;
export const STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_METADATA_BYTES = 128 * 1024;

export type StudioBg3dSemanticMaterialSlot =
  (typeof STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS)[number];

export type StudioBg3dSemanticMaterialConfidence =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "confirmed";

/**
 * `materialKey` is an adapter-issued ephemeral key (for example `material-3`). Shared source
 * materials should have one descriptor whose mesh/node arrays contain their bounded usages.
 */
export interface StudioBg3dSemanticMaterialDescriptor {
  readonly materialKey: string;
  readonly materialName?: string;
  readonly meshNames?: readonly string[];
  readonly nodeNames?: readonly string[];
}

export interface StudioBg3dSemanticMaterialEvidence {
  readonly slot: Exclude<StudioBg3dSemanticMaterialSlot, "unknown">;
  /** Canonical vocabulary term, never caller-owned text. */
  readonly term: string;
  readonly source: "material-name" | "mesh-name" | "node-name";
  readonly contribution: number;
}

export interface StudioBg3dSemanticMaterialAlternative {
  readonly slot: Exclude<StudioBg3dSemanticMaterialSlot, "unknown">;
  readonly score: number;
}

export interface StudioBg3dSemanticMaterialAssignment {
  readonly materialKey: string;
  readonly slot: StudioBg3dSemanticMaterialSlot;
  /** The classifier never emits `confirmed`; that value is reserved for an explicit UI choice. */
  readonly confidence: Exclude<StudioBg3dSemanticMaterialConfidence, "confirmed">;
  readonly score: number;
  readonly alternatives: readonly StudioBg3dSemanticMaterialAlternative[];
  readonly evidence: readonly StudioBg3dSemanticMaterialEvidence[];
}

export type StudioBg3dSemanticMaterialClassificationErrorCode =
  | "invalid-input"
  | "material-budget-exceeded"
  | "metadata-budget-exceeded"
  | "invalid-descriptor"
  | "duplicate-material-key";

export interface StudioBg3dSemanticMaterialClassificationFailure {
  readonly ok: false;
  readonly code: StudioBg3dSemanticMaterialClassificationErrorCode;
}

export interface StudioBg3dSemanticMaterialClassificationSuccess {
  readonly ok: true;
  readonly assignments: readonly StudioBg3dSemanticMaterialAssignment[];
  readonly counts: Readonly<{
    total: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  }>;
}

export type StudioBg3dSemanticMaterialClassificationResult =
  | StudioBg3dSemanticMaterialClassificationFailure
  | StudioBg3dSemanticMaterialClassificationSuccess;

export const STUDIO_BG3D_SEMANTIC_RENDER_PASS_KINDS = [
  "beauty",
  "character-only",
  "background-only",
  "character-matte",
  "background-matte",
  "semantic-id",
] as const;

export type StudioBg3dSemanticRenderPassKind =
  (typeof STUDIO_BG3D_SEMANTIC_RENDER_PASS_KINDS)[number];

/** Capture-only replacement. It is intentionally not part of SceneDocument material overrides. */
export interface StudioBg3dSemanticPassMaterialOverride {
  readonly shading: "unlit";
  readonly color: string;
  readonly opacity: 1;
  /** Hair cards, lashes, foliage, and cutout clothing must keep their source alpha coverage. */
  readonly preserveSourceAlpha: true;
  readonly doubleSided: true;
  readonly depthWrite: true;
}

export interface StudioBg3dSemanticRenderPassOperation {
  readonly materialKey: string;
  readonly resolvedSlot: StudioBg3dSemanticMaterialSlot;
  /** `preserve` never forces a source-hidden material visible; `hide` is the only mutation. */
  readonly visibility: "preserve" | "hide";
  readonly materialOverride?: StudioBg3dSemanticPassMaterialOverride;
}

export interface StudioBg3dSemanticMaterialSelection {
  readonly materialKey: string;
  readonly slot: StudioBg3dSemanticMaterialSlot;
  readonly confidence: StudioBg3dSemanticMaterialConfidence;
}

export interface StudioBg3dSemanticRenderPassOptions {
  /** Suggestions below this threshold are resolved as unknown. Defaults to medium. */
  readonly minimumConfidence?: "low" | "medium" | "high";
  /** How unresolved/unknown materials participate. Defaults by pass kind. */
  readonly unresolvedVisibility?: "preserve" | "hide";
}

export type StudioBg3dSemanticRenderPassErrorCode =
  | "invalid-input"
  | "material-budget-exceeded"
  | "invalid-selection"
  | "duplicate-material-key"
  | "unsupported-pass"
  | "invalid-options";

export interface StudioBg3dSemanticRenderPassFailure {
  readonly ok: false;
  readonly code: StudioBg3dSemanticRenderPassErrorCode;
}

export interface StudioBg3dSemanticRenderPassPlan {
  readonly kind: StudioBg3dSemanticRenderPassKind;
  readonly operations: readonly StudioBg3dSemanticRenderPassOperation[];
  /** Unknown and below-threshold suggestions, in source order, for a review UI. */
  readonly reviewMaterialKeys: readonly string[];
  readonly counts: Readonly<{
    total: number;
    included: number;
    hidden: number;
    review: number;
  }>;
}

export type StudioBg3dSemanticRenderPassResult =
  | StudioBg3dSemanticRenderPassFailure
  | Readonly<{ readonly ok: true; readonly plan: StudioBg3dSemanticRenderPassPlan }>;

interface VocabularyTerm {
  readonly term: string;
  readonly weight: number;
  readonly fragment?: true;
}

type ClassifiedSlot = Exclude<StudioBg3dSemanticMaterialSlot, "unknown">;
type EvidenceSource = StudioBg3dSemanticMaterialEvidence["source"];

interface NormalizedDescriptor {
  readonly materialKey: string;
  readonly materialName: string;
  readonly meshNames: readonly string[];
  readonly nodeNames: readonly string[];
}

interface EvidenceCandidate extends StudioBg3dSemanticMaterialEvidence {
  readonly vocabularyIndex: number;
}

const UTF8_ENCODER = new TextEncoder();
const MATERIAL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,79}$/u;
const FORBIDDEN_KEY_SET = new Set(["constructor", "prototype", "__proto__"]);
const UNSAFE_TEXT_PATTERN = /[\p{Cc}\p{Cf}]/u;
const URL_LIKE_TEXT_PATTERN = /^(?:https?|blob|data|file):/iu;
const SLOT_SET = new Set<string>(STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS);
const PASS_KIND_SET = new Set<string>(STUDIO_BG3D_SEMANTIC_RENDER_PASS_KINDS);
const CONFIDENCE_SET = new Set<string>(["none", "low", "medium", "high", "confirmed"]);
const CHARACTER_SLOT_SET = new Set<string>(STUDIO_BG3D_CHARACTER_MATERIAL_SLOTS);

const SOURCE_MULTIPLIER: Readonly<Record<EvidenceSource, number>> = Object.freeze({
  "material-name": 5,
  "mesh-name": 3,
  "node-name": 1,
});

const VOCABULARY: Readonly<Record<ClassifiedSlot, readonly VocabularyTerm[]>> = deepFreeze({
  skin: [
    term("skin", 4), term("dermis", 4), term("flesh", 3), term("complexion", 3),
    term("face", 1), term("body", 1), term("head", 1), term("hand", 1),
    term("hands", 1), term("neck", 1), term("ear", 1), term("ears", 1),
    term("피부", 4, true), term("얼굴", 2, true), term("맨살", 4, true),
    term("スキン", 4, true), term("皮膚", 4, true),
  ],
  hair: [
    term("hair", 4), term("hairstyle", 4), term("bang", 3), term("bangs", 3),
    term("fringe", 3), term("braid", 3), term("ponytail", 3), term("eyebrow", 2),
    term("eyebrows", 2), term("brow", 2), term("머리카락", 4, true),
    term("헤어", 4, true), term("앞머리", 4, true), term("눈썹", 2, true),
    term("髪の毛", 4, true), term("ヘア", 4, true),
  ],
  eyes: [
    term("eye", 4), term("eyes", 4), term("eyeball", 4), term("iris", 4),
    term("pupil", 4), term("cornea", 4), term("sclera", 4), term("eyelash", 3),
    term("eyelashes", 3), term("lash", 3), term("lashes", 3),
    term("눈동자", 4, true), term("홍채", 4, true), term("동공", 4, true),
    term("속눈썹", 3, true), term("아이리스", 4, true), term("瞳", 4, true),
    term("まつげ", 3, true),
  ],
  clothes: [
    term("cloth", 4), term("clothes", 4), term("clothing", 4), term("garment", 4),
    term("apparel", 4), term("outfit", 4), term("costume", 4), term("shirt", 4),
    term("blouse", 4), term("pants", 4), term("trousers", 4), term("skirt", 4),
    term("dress", 4), term("jacket", 4), term("coat", 4), term("uniform", 4),
    term("hoodie", 4), term("sleeve", 3), term("shoe", 3), term("shoes", 3),
    term("boot", 3), term("boots", 3), term("sock", 3), term("socks", 3),
    term("glove", 3), term("gloves", 3), term("의상", 4, true),
    term("옷", 4), term("셔츠", 4, true), term("바지", 4, true),
    term("치마", 4, true), term("드레스", 4, true), term("衣装", 4, true),
    term("服装", 4, true),
  ],
  accessory: [
    term("accessory", 4), term("accessories", 4), term("prop", 4), term("props", 4),
    term("glasses", 4), term("spectacles", 4), term("earring", 4), term("earrings", 4),
    term("necklace", 4), term("jewelry", 4), term("jewellery", 4), term("bracelet", 4),
    term("watch", 3), term("hat", 3), term("cap", 3), term("helmet", 3),
    term("bag", 3), term("backpack", 3), term("belt", 3), term("weapon", 4),
    term("sword", 4), term("gun", 4), term("안경", 4, true),
    term("액세서리", 4, true), term("소품", 4, true), term("귀걸이", 4, true),
    term("목걸이", 4, true), term("모자", 3, true), term("가방", 3, true),
    term("アクセサリー", 4, true), term("小物", 4, true),
  ],
  background: [
    term("background", 4), term("environment", 4), term("terrain", 4), term("landscape", 4),
    term("world", 3), term("scene", 2), term("building", 4), term("architecture", 4),
    term("room", 4), term("interior", 4), term("exterior", 4), term("ground", 3),
    term("floor", 3), term("wall", 3), term("ceiling", 3), term("road", 3),
    term("street", 3), term("sky", 3), term("furniture", 3), term("tree", 2),
    term("배경", 4, true), term("환경", 4, true), term("건물", 4, true),
    term("방", 3), term("바닥", 3, true), term("벽", 3), term("천장", 3, true),
    term("거리", 3, true), term("背景", 4, true), term("環境", 4, true),
  ],
});

const SEMANTIC_ID_COLORS: Readonly<Record<StudioBg3dSemanticMaterialSlot, string>> =
  Object.freeze({
    skin: "#ff7043",
    hair: "#7e57c2",
    eyes: "#29b6f6",
    clothes: "#66bb6a",
    accessory: "#ffee58",
    background: "#26a69a",
    unknown: "#78909c",
  });

const WHITE_MATTE_OVERRIDE: StudioBg3dSemanticPassMaterialOverride = Object.freeze({
  shading: "unlit",
  color: "#ffffff",
  opacity: 1,
  preserveSourceAlpha: true,
  doubleSided: true,
  depthWrite: true,
});

function term(value: string, weight: number, fragment = false): VocabularyTerm {
  return Object.freeze({ term: value, weight, ...(fragment ? { fragment: true as const } : {}) });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function failure(
  code: StudioBg3dSemanticMaterialClassificationErrorCode,
): StudioBg3dSemanticMaterialClassificationFailure {
  return Object.freeze({ ok: false, code });
}

function passFailure(code: StudioBg3dSemanticRenderPassErrorCode): StudioBg3dSemanticRenderPassFailure {
  return Object.freeze({ ok: false, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMaterialKey(value: unknown): value is string {
  return typeof value === "string"
    && MATERIAL_KEY_PATTERN.test(value)
    && !FORBIDDEN_KEY_SET.has(value.toLowerCase());
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let normalized: string;
  try {
    normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  } catch {
    return null;
  }
  if (
    UNSAFE_TEXT_PATTERN.test(normalized)
    || URL_LIKE_TEXT_PATTERN.test(normalized)
    || UTF8_ENCODER.encode(normalized).byteLength > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAME_BYTES
  ) {
    return null;
  }
  return normalized;
}

function normalizeNames(value: unknown): readonly string[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND) {
    return null;
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const normalized = normalizeName(item);
    if (normalized === null) return null;
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return Object.freeze(output);
}

function normalizeDescriptor(value: unknown): NormalizedDescriptor | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !["materialKey", "materialName", "meshNames", "nodeNames"].includes(key))) {
    return null;
  }
  if (!isMaterialKey(value.materialKey)) return null;
  const materialName = value.materialName === undefined ? "" : normalizeName(value.materialName);
  const meshNames = normalizeNames(value.meshNames);
  const nodeNames = normalizeNames(value.nodeNames);
  if (materialName === null || meshNames === null || nodeNames === null) return null;
  return Object.freeze({ materialKey: value.materialKey, materialName, meshNames, nodeNames });
}

function lexicalTokens(value: string): Readonly<{ normalized: string; tokens: ReadonlySet<string> }> {
  const separated = value
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")
    .replace(/([\p{L}])(\d)/gu, "$1 $2")
    .replace(/(\d)([\p{L}])/gu, "$1 $2")
    .toLowerCase();
  return {
    normalized: separated,
    tokens: new Set(separated.split(/[^\p{L}\p{N}]+/u).filter(Boolean)),
  };
}

function termMatches(
  lexical: Readonly<{ normalized: string; tokens: ReadonlySet<string> }>,
  vocabularyTerm: VocabularyTerm,
): boolean {
  if (lexical.tokens.has(vocabularyTerm.term)) return true;
  if (!vocabularyTerm.fragment) return false;
  for (const tokenValue of lexical.tokens) {
    if (tokenValue.includes(vocabularyTerm.term)) return true;
  }
  return false;
}

function classifyDescriptor(
  descriptor: NormalizedDescriptor,
): StudioBg3dSemanticMaterialAssignment {
  const bestEvidenceByTerm = new Map<string, EvidenceCandidate>();
  // A descriptor can contain up to 33 names. Tokenize each bounded name once, then reuse the
  // result across every vocabulary term instead of repeating Unicode regex work O(V * N).
  const sources: ReadonlyArray<readonly [EvidenceSource, readonly ReturnType<typeof lexicalTokens>[]]> = [
    ["material-name", descriptor.materialName ? [lexicalTokens(descriptor.materialName)] : []],
    ["mesh-name", descriptor.meshNames.map(lexicalTokens)],
    ["node-name", descriptor.nodeNames.map(lexicalTokens)],
  ];
  let vocabularyIndex = 0;
  for (const slot of STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS) {
    if (slot === "unknown") continue;
    for (const vocabularyTerm of VOCABULARY[slot]) {
      for (const [source, names] of sources) {
        if (!names.some((name) => termMatches(name, vocabularyTerm))) continue;
        const evidenceKey = `${slot}\u0000${vocabularyTerm.term}`;
        const candidate: EvidenceCandidate = {
          slot,
          term: vocabularyTerm.term,
          source,
          contribution: vocabularyTerm.weight * SOURCE_MULTIPLIER[source],
          vocabularyIndex,
        };
        const current = bestEvidenceByTerm.get(evidenceKey);
        if (!current || candidate.contribution > current.contribution) {
          bestEvidenceByTerm.set(evidenceKey, candidate);
        }
      }
      vocabularyIndex += 1;
    }
  }

  const evidence = [...bestEvidenceByTerm.values()].sort((left, right) => (
    right.contribution - left.contribution
    || STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS.indexOf(left.slot)
      - STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS.indexOf(right.slot)
    || left.vocabularyIndex - right.vocabularyIndex
  ));
  const scores = new Map<ClassifiedSlot, number>();
  for (const item of evidence) scores.set(item.slot, (scores.get(item.slot) ?? 0) + item.contribution);
  const alternatives = STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS
    .filter((slot): slot is ClassifiedSlot => slot !== "unknown")
    .map((slot) => ({ slot, score: scores.get(slot) ?? 0 }))
    .filter((item) => item.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS.indexOf(left.slot)
        - STUDIO_BG3D_SEMANTIC_MATERIAL_SLOTS.indexOf(right.slot)
    ));
  const winner = alternatives[0];
  if (!winner) {
    return deepFreeze({
      materialKey: descriptor.materialKey,
      slot: "unknown",
      confidence: "none",
      score: 0,
      alternatives: [],
      evidence: [],
    });
  }
  const margin = winner.score - (alternatives[1]?.score ?? 0);
  const confidence = winner.score >= 12 && margin >= 8
    ? "high"
    : winner.score >= 8 && margin >= 3
      ? "medium"
      : "low";
  return deepFreeze({
    materialKey: descriptor.materialKey,
    slot: winner.slot,
    confidence,
    score: winner.score,
    alternatives,
    evidence: evidence.slice(0, 12).map(({ vocabularyIndex: _vocabularyIndex, ...item }) => item),
  });
}

/**
 * Strictly validates and classifies a bounded descriptor list. No raw name is copied into output,
 * which keeps URL-looking or path-looking labels inert and out of render/persistence plans.
 */
export function classifyStudioBg3dSemanticMaterials(
  raw: unknown,
): StudioBg3dSemanticMaterialClassificationResult {
  try {
    if (!Array.isArray(raw)) return failure("invalid-input");
    if (raw.length > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS) {
      return failure("material-budget-exceeded");
    }
    const descriptors: NormalizedDescriptor[] = [];
    const keys = new Set<string>();
    let metadataBytes = 0;
    for (const item of raw) {
      const descriptor = normalizeDescriptor(item);
      if (!descriptor) return failure("invalid-descriptor");
      if (keys.has(descriptor.materialKey)) return failure("duplicate-material-key");
      keys.add(descriptor.materialKey);
      metadataBytes += UTF8_ENCODER.encode(descriptor.materialKey).byteLength;
      metadataBytes += UTF8_ENCODER.encode(descriptor.materialName).byteLength;
      for (const name of descriptor.meshNames) metadataBytes += UTF8_ENCODER.encode(name).byteLength;
      for (const name of descriptor.nodeNames) metadataBytes += UTF8_ENCODER.encode(name).byteLength;
      if (metadataBytes > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_METADATA_BYTES) {
        return failure("metadata-budget-exceeded");
      }
      descriptors.push(descriptor);
    }
    const assignments = descriptors.map(classifyDescriptor);
    const counts = { total: assignments.length, high: 0, medium: 0, low: 0, unknown: 0 };
    for (const assignment of assignments) {
      if (assignment.confidence === "none") counts.unknown += 1;
      else counts[assignment.confidence] += 1;
    }
    return deepFreeze({ ok: true, assignments, counts });
  } catch {
    return failure("invalid-input");
  }
}

function isSelection(value: unknown): value is StudioBg3dSemanticMaterialSelection {
  return isRecord(value)
    && isMaterialKey(value.materialKey)
    && typeof value.slot === "string"
    && SLOT_SET.has(value.slot)
    && typeof value.confidence === "string"
    && CONFIDENCE_SET.has(value.confidence)
    && !(value.slot === "unknown" && value.confidence === "confirmed")
    && !(value.slot === "unknown" && value.confidence !== "none")
    && !(value.slot !== "unknown" && value.confidence === "none");
}

function confidenceRank(value: StudioBg3dSemanticMaterialConfidence): number {
  switch (value) {
    case "confirmed": return 4;
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    case "none": return 0;
  }
}

function semanticIdOverride(slot: StudioBg3dSemanticMaterialSlot): StudioBg3dSemanticPassMaterialOverride {
  return Object.freeze({
    ...WHITE_MATTE_OVERRIDE,
    color: SEMANTIC_ID_COLORS[slot],
  });
}

function defaultUnresolvedVisibility(kind: StudioBg3dSemanticRenderPassKind): "preserve" | "hide" {
  return kind === "beauty" || kind === "semantic-id" ? "preserve" : "hide";
}

function isValidOptions(value: unknown): value is StudioBg3dSemanticRenderPassOptions {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "minimumConfidence" && key !== "unresolvedVisibility")) {
    return false;
  }
  return (value.minimumConfidence === undefined
      || value.minimumConfidence === "low"
      || value.minimumConfidence === "medium"
      || value.minimumConfidence === "high")
    && (value.unresolvedVisibility === undefined
      || value.unresolvedVisibility === "preserve"
      || value.unresolvedVisibility === "hide");
}

/**
 * Produces capture-only operations. Adapters must snapshot and restore source material visibility,
 * combine `preserve` with the source visibility, and dispose temporary unlit materials afterward.
 */
export function createStudioBg3dSemanticRenderPassPlan(
  rawSelections: unknown,
  rawKind: unknown,
  rawOptions?: unknown,
): StudioBg3dSemanticRenderPassResult {
  try {
    if (!Array.isArray(rawSelections)) return passFailure("invalid-input");
    if (rawSelections.length > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS) {
      return passFailure("material-budget-exceeded");
    }
    if (typeof rawKind !== "string" || !PASS_KIND_SET.has(rawKind)) {
      return passFailure("unsupported-pass");
    }
    if (!isValidOptions(rawOptions)) return passFailure("invalid-options");
    const kind = rawKind as StudioBg3dSemanticRenderPassKind;
    const options = rawOptions as StudioBg3dSemanticRenderPassOptions | undefined;
    const minimumRank = confidenceRank(options?.minimumConfidence ?? "medium");
    const unresolvedVisibility = options?.unresolvedVisibility
      ?? defaultUnresolvedVisibility(kind);
    const seen = new Set<string>();
    const operations: StudioBg3dSemanticRenderPassOperation[] = [];
    const reviewMaterialKeys: string[] = [];
    for (const rawSelection of rawSelections) {
      if (!isSelection(rawSelection)) return passFailure("invalid-selection");
      if (seen.has(rawSelection.materialKey)) return passFailure("duplicate-material-key");
      seen.add(rawSelection.materialKey);
      const qualified = rawSelection.slot !== "unknown"
        && confidenceRank(rawSelection.confidence) >= minimumRank;
      const resolvedSlot = qualified ? rawSelection.slot : "unknown";
      if (!qualified) reviewMaterialKeys.push(rawSelection.materialKey);

      let include: boolean;
      if (kind === "beauty" || kind === "semantic-id") include = true;
      else if (resolvedSlot === "unknown") include = unresolvedVisibility === "preserve";
      else if (kind === "character-only" || kind === "character-matte") {
        include = CHARACTER_SLOT_SET.has(resolvedSlot);
      } else {
        include = resolvedSlot === "background";
      }

      let materialOverride: StudioBg3dSemanticPassMaterialOverride | undefined;
      if (include && (kind === "character-matte" || kind === "background-matte")) {
        materialOverride = WHITE_MATTE_OVERRIDE;
      } else if (include && kind === "semantic-id") {
        materialOverride = semanticIdOverride(resolvedSlot);
      }
      operations.push(Object.freeze({
        materialKey: rawSelection.materialKey,
        resolvedSlot,
        visibility: include ? "preserve" : "hide",
        ...(materialOverride ? { materialOverride } : {}),
      }));
    }
    const included = operations.filter((operation) => operation.visibility === "preserve").length;
    return deepFreeze({
      ok: true,
      plan: {
        kind,
        operations,
        reviewMaterialKeys,
        counts: {
          total: operations.length,
          included,
          hidden: operations.length - included,
          review: reviewMaterialKeys.length,
        },
      },
    });
  } catch {
    return passFailure("invalid-input");
  }
}
