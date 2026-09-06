/**
 * Unified Command Search — one registry-backed index behind the four search
 * boxes the audit found (`docs/rewrite/ux-audit-v5.md` §2.8).
 *
 * Before this module the studio had four disagreeing filters — shortcut help
 * (substring, whitespace-stripped), Quick Access (AND tokens), the inspector
 * navigator (AND tokens, ko locale) and the tutorial hub (substring, localized)
 * — over four disjoint corpora, and no terminology layer at all. A migrating
 * CSP or Photoshop user searching "Paint Bucket" or "레벨" got nothing.
 *
 * Design constraints this file answers:
 *
 * 1. **Consume, don't re-declare.** Aliases come from
 *    `STUDIO_COMMAND_CATALOG` (Wave A: 155 commands / 423 aliases) and from
 *    `STUDIO_SEARCH_CORPUS` for the non-command destinations. Nothing is
 *    duplicated here.
 * 2. **Merging four corpora must not explode the result list.** The audit
 *    warns that a query going from 10 to 165 hits is a regression, so results
 *    are *sectioned*, *ranked* and *capped* (`sectionLimit` / `totalLimit`),
 *    and the true match count stays visible as `totalMatched` instead of being
 *    dumped on screen.
 * 3. **Every result can reach help.** `helpNodeId` rides along on every row so
 *    F1 and the "도움말" affordance have a target.
 */

import { TerminologyIndex } from "@toonspectrum/studio-command-registry";

import { STUDIO_COMMAND_CATALOG } from "./studio-command-catalog";
import { STUDIO_FEATURE_TUTORIALS } from "./studio-feature-tutorials";
import { studioInspectorActions } from "./studio-inspector-layout";
import { STUDIO_SEARCH_CORPUS } from "./studio-search-corpus";
import {
  normalizeStudioSearchText,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";

import type {
  StudioInspectorAction,
  StudioInspectorActionContext,
} from "./studio-inspector-layout";
import type {
  StudioSearchKind,
  StudioSearchTarget,
} from "./studio-search-corpus";
import type { TerminologyAlias } from "@toonspectrum/studio-command-registry";

export type { StudioSearchKind, StudioSearchTarget } from "./studio-search-corpus";
export {
  normalizeStudioSearchText,
  studioSearchTextMatches,
  tokenizeStudioSearchQuery,
} from "./studio-search-text";

/* ------------------------------------------------------------------ types */

export interface StudioSearchEntry {
  id: string;
  kind: StudioSearchKind;
  /** Canonical Korean name — the one name this thing is called everywhere. */
  label: string;
  labelEn?: string;
  description?: string;
  /** Korean breadcrumb telling the user where the thing actually lives. */
  location: string;
  shortcut?: string;
  aliases: readonly TerminologyAlias[];
  keywords: readonly string[];
  helpNodeId: string;
  target: StudioSearchTarget | { type: "command"; commandId: string };
  /** Selection-only rows remain discoverable while their action is unavailable. */
  requiresSelection: boolean;
}

export interface StudioSearchResult {
  entry: StudioSearchEntry;
  score: number;
  /** Which field produced the strongest hit — drives the result subtitle. */
  matchedOn: "label" | "alias" | "keyword" | "description" | "shortcut" | "id";
  /** The vendor wording that matched, when it was an alias. */
  matchedAlias?: TerminologyAlias;
}

export interface StudioSearchSection {
  kind: StudioSearchKind;
  label: string;
  results: readonly StudioSearchResult[];
  /** Matches in this section before the cap was applied. */
  matched: number;
  truncated: boolean;
}

export interface StudioSearchOutcome {
  query: string;
  sections: readonly StudioSearchSection[];
  /** Rows actually returned across all sections. Never exceeds `totalLimit`. */
  totalShown: number;
  /** Rows that matched before capping. Shown as "외 N건" rather than rendered. */
  totalMatched: number;
  truncated: boolean;
}

export interface StudioSearchOptions {
  /** Max rows per section. Defaults to 5. */
  sectionLimit?: number;
  /** Max rows overall. Defaults to 12. */
  totalLimit?: number;
  /** Rows scoring below this are dropped as noise. Defaults to 15. */
  minScore?: number;
  /** Restrict to one section. */
  kind?: StudioSearchKind;
  /** Restrict to several sections — the unified dialog's scope chips. */
  kinds?: readonly StudioSearchKind[];
}

export interface StudioSearchIndex {
  entries: readonly StudioSearchEntry[];
  terminology: TerminologyIndex;
}

/* ------------------------------------------------------------- sectioning */

/**
 * Section order is also the tie-break order: an exact hit on a command beats an
 * equally exact hit on a tutorial, because a command is the thing a user can
 * act on right now.
 */
export const STUDIO_SEARCH_SECTION_ORDER: readonly StudioSearchKind[] =
  Object.freeze(["command", "property", "panel", "tutorial"]);

export const STUDIO_SEARCH_SECTION_LABELS: Readonly<
  Record<StudioSearchKind, string>
> = Object.freeze({
  command: "명령",
  property: "속성·보정",
  panel: "패널·팔레트",
  tutorial: "튜토리얼",
});

const KIND_BONUS: Readonly<Record<StudioSearchKind, number>> = Object.freeze({
  command: 6,
  property: 4,
  panel: 3,
  tutorial: 0,
});

export const STUDIO_SEARCH_DEFAULT_SECTION_LIMIT = 5;
export const STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT = 12;
export const STUDIO_SEARCH_DEFAULT_MIN_SCORE = 15;

/* ------------------------------------------------------------ index build */

/**
 * The navigator's vocabulary (`panel` | `property` | `tool`) mapped onto the
 * index's four sections. A `tool` action reveals a concrete control group just
 * like a `property` one — `STUDIO_SEARCH_CORPUS` already files the rows it
 * absorbs from tool actions (e.g. `image-mask`) under `property` — so both land
 * in "속성·보정"; only true navigation targets stay panels.
 */
const INSPECTOR_ACTION_KIND: Readonly<
  Record<NonNullable<StudioInspectorAction["kind"]>, StudioSearchKind>
> = Object.freeze({
  panel: "panel",
  property: "property",
  tool: "property",
});

const ALL_INSPECTOR_ROUTES: StudioInspectorActionContext = {
  hasSelection: true,
  selectedType: "image",
  drawing: true,
  imageToolsAvailable: true,
};

function koLabel(labels: readonly { locale: string; label: string }[]): string {
  return (
    labels.find((entry) => entry.locale === "ko")?.label ??
    labels[0]?.label ??
    ""
  );
}

function enLabel(
  labels: readonly { locale: string; label: string }[],
): string | undefined {
  return labels.find((entry) => entry.locale === "en")?.label;
}

function koDescription(
  labels: readonly { locale: string; description?: string }[],
): string | undefined {
  return (
    labels.find((entry) => entry.locale === "ko")?.description ??
    labels.find((entry) => entry.description !== undefined)?.description
  );
}

/**
 * `category` is the command id namespace (`view`, `filter`, …). Turning it into
 * a Korean breadcrumb keeps every row answering "그건 어디 있나요?".
 */
const CATEGORY_LOCATION: Readonly<Record<string, string>> = Object.freeze({
  file: "메뉴 › 파일",
  edit: "메뉴 › 편집",
  select: "메뉴 › 선택",
  layer: "인스펙터 › 레이어",
  view: "메뉴 › 보기",
  window: "메뉴 › 창",
  tool: "툴레일",
  brush: "그리기 옵션바",
  color: "컬러 팔레트",
  transform: "메뉴 › 편집 › 변형",
  insert: "메뉴 › 삽입",
  text: "메뉴 › 삽입 › 텍스트",
  filter: "메뉴 › 필터",
  ai: "메뉴 › AI",
  help: "메뉴 › 도움말",
});

export function buildStudioSearchIndex(
  inspectorContext: StudioInspectorActionContext = ALL_INSPECTOR_ROUTES,
): StudioSearchIndex {
  const entries: StudioSearchEntry[] = [];

  /* 1 — commands, straight from the Wave A catalog. */
  for (const command of STUDIO_COMMAND_CATALOG) {
    const entry: StudioSearchEntry = {
      id: command.id,
      kind: "command",
      label: koLabel(command.labels),
      location: CATEGORY_LOCATION[command.category] ?? "스튜디오",
      aliases: command.aliases,
      keywords: [command.id, command.category],
      helpNodeId: command.helpNodeId,
      target: { type: "command", commandId: command.id },
      requiresSelection: false,
    };
    const en = enLabel(command.labels);
    if (en !== undefined) entry.labelEn = en;
    const description = koDescription(command.labels);
    if (description !== undefined) entry.description = description;
    if (command.shortcut !== undefined) entry.shortcut = command.shortcut;
    entries.push(entry);
  }

  /* 2 — properties and panels that are not commands. */
  const superseded = new Set<string>();
  for (const item of STUDIO_SEARCH_CORPUS) {
    for (const id of item.supersedes ?? []) superseded.add(id);
    entries.push({
      id: item.id,
      kind: item.kind,
      label: item.label,
      labelEn: item.labelEn,
      description: item.description,
      location: item.location,
      aliases: item.aliases,
      keywords: item.keywords ?? [],
      helpNodeId: item.helpNodeId,
      target: item.target,
      requiresSelection: item.requiresSelection === true,
    });
  }

  /* 3 — inspector routes (the navigator's own corpus), minus absorbed rows. */
  for (const action of studioInspectorActions(inspectorContext)) {
    if (superseded.has(action.id)) continue;
    entries.push({
      id: `inspector.${action.id}`,
      kind: INSPECTOR_ACTION_KIND[action.kind ?? "panel"],
      label: action.label,
      description: action.description,
      aliases: [],
      keywords: action.keywords,
      helpNodeId: `help/inspector/${action.id}`,
      requiresSelection: false,
      // `location` 은 다이얼로그가 라벨 밑에 실제로 그리는 문자열이다. 액션은
      // 이미 정확한 breadcrumb 을 `path` 로 들고 있으므로("문서 › 캔버스 ›
      // 가이드") 통짜 "인스펙터" 로 뭉개지 않는다 — 코퍼스 행이 "인스펙터 ›
      // 대상 › 마스크" 라고 적는 옆줄에서 혼자만 어디로 가는지 못 알려준다.
      location: action.path ? `인스펙터 › ${action.path}` : "인스펙터",
      // 목적지는 통째로 옮긴다. `primary` 만 실으면 탭은 맞고 서브탭은 직전
      // 상태로 남으며, `focusTarget` 을 빠뜨리면 컨트롤 그룹이 열리지 않는다.
      target: {
        type: "inspector",
        primary: action.route.primary,
        ...(action.route.image ? { image: action.route.image } : {}),
        ...(action.route.document ? { document: action.route.document } : {}),
        ...(action.focusTarget ? { focusTarget: action.focusTarget } : {}),
      },
    });
  }

  /* 4 — tutorials. */
  for (const tutorial of STUDIO_FEATURE_TUTORIALS) {
    entries.push({
      id: `tutorial.${tutorial.id}`,
      kind: "tutorial",
      label: tutorial.title,
      description: tutorial.summary,
      location: "도움말 › 기능 튜토리얼",
      aliases: [],
      keywords: [tutorial.category, tutorial.tryAction ?? ""].filter(
        (value) => value.length > 0,
      ),
      helpNodeId: `help/tutorial/${tutorial.id}`,
      target: { type: "tutorial", tutorialId: tutorial.id },
      requiresSelection: false,
    });
  }

  const terminology = new TerminologyIndex();
  for (const entry of entries) {
    if (entry.aliases.length > 0) terminology.add(entry.id, entry.aliases);
  }

  return { entries, terminology };
}

/** Built once — the corpora are frozen declaration data. */
let sharedIndex: StudioSearchIndex | null = null;

export function studioSearchIndex(): StudioSearchIndex {
  sharedIndex ??= buildStudioSearchIndex();
  return sharedIndex;
}

/* ---------------------------------------------------------------- scoring */

type FieldKind = StudioSearchResult["matchedOn"];

interface ScoredField {
  text: string;
  weight: number;
  kind: FieldKind;
  alias?: TerminologyAlias;
}

/** 1.0 exact · 0.7 prefix · 0.45 substring · 0 miss. */
function tokenMatchStrength(field: string, token: string): number {
  if (field === token) return 1;
  if (field.startsWith(token)) return 0.7;
  if (field.includes(token)) return 0.45;
  return 0;
}

function scoredFields(entry: StudioSearchEntry): ScoredField[] {
  const fields: ScoredField[] = [
    { text: normalizeStudioSearchText(entry.label), weight: 1, kind: "label" },
  ];
  if (entry.labelEn) {
    fields.push({
      text: normalizeStudioSearchText(entry.labelEn),
      weight: 0.95,
      kind: "label",
    });
  }
  for (const alias of entry.aliases) {
    fields.push({
      text: normalizeStudioSearchText(alias.term),
      weight: 0.85,
      kind: "alias",
      alias,
    });
  }
  for (const keyword of entry.keywords) {
    fields.push({
      text: normalizeStudioSearchText(keyword),
      weight: 0.6,
      kind: "keyword",
    });
  }
  if (entry.description) {
    fields.push({
      text: normalizeStudioSearchText(entry.description),
      weight: 0.45,
      kind: "description",
    });
  }
  if (entry.shortcut) {
    fields.push({
      text: normalizeStudioSearchText(entry.shortcut),
      weight: 0.5,
      kind: "shortcut",
    });
  }
  fields.push({
    text: normalizeStudioSearchText(entry.id),
    weight: 0.4,
    kind: "id",
  });
  return fields;
}

interface EntryScore {
  score: number;
  matchedOn: FieldKind;
  matchedAlias?: TerminologyAlias;
}

function scoreEntry(
  entry: StudioSearchEntry,
  tokens: readonly string[],
  wholeQuery: string,
): EntryScore | null {
  const fields = scoredFields(entry);
  let total = 0;
  let bestFieldScore = 0;
  let matchedOn: FieldKind = "label";
  let matchedAlias: TerminologyAlias | undefined;

  for (const token of tokens) {
    let best = 0;
    let bestField: ScoredField | null = null;
    for (const field of fields) {
      if (field.text.length === 0) continue;
      const strength = tokenMatchStrength(field.text, token) * field.weight;
      if (strength > best) {
        best = strength;
        bestField = field;
      }
    }
    // AND semantics: one unmatched token disqualifies the row. This is the
    // first and cheapest defence against the 10 → 165 blow-up.
    if (best === 0 || !bestField) return null;
    total += best;
    if (best > bestFieldScore) {
      bestFieldScore = best;
      matchedOn = bestField.kind;
      matchedAlias = bestField.alias;
    }
  }

  let score = (total / tokens.length) * 100;

  // Whole-query exactness outranks any per-token accumulation.
  const labelKey = normalizeStudioSearchText(entry.label);
  if (labelKey === wholeQuery) score += 40;
  else if (
    entry.aliases.some(
      (alias) => normalizeStudioSearchText(alias.term) === wholeQuery,
    )
  ) {
    score += 25;
  }

  score += KIND_BONUS[entry.kind];
  // Shorter canonical names win ties — "채우기" over "참조 레이어 채우기".
  score -= Math.min(labelKey.length, 30) * 0.1;

  const result: EntryScore = { score, matchedOn };
  if (matchedAlias !== undefined) result.matchedAlias = matchedAlias;
  return result;
}

/* ----------------------------------------------------------------- search */

export function searchStudio(
  query: string,
  options: StudioSearchOptions = {},
  index: StudioSearchIndex = studioSearchIndex(),
): StudioSearchOutcome {
  const sectionLimit =
    options.sectionLimit ?? STUDIO_SEARCH_DEFAULT_SECTION_LIMIT;
  const totalLimit = options.totalLimit ?? STUDIO_SEARCH_DEFAULT_TOTAL_LIMIT;
  const minScore = options.minScore ?? STUDIO_SEARCH_DEFAULT_MIN_SCORE;

  const tokens = tokenizeStudioSearchQuery(query);
  if (tokens.length === 0) {
    return {
      query,
      sections: [],
      totalShown: 0,
      totalMatched: 0,
      truncated: false,
    };
  }

  const wholeQuery = normalizeStudioSearchText(query);
  const byKind = new Map<StudioSearchKind, StudioSearchResult[]>();

  for (const entry of index.entries) {
    if (options.kind && entry.kind !== options.kind) continue;
    if (options.kinds && !options.kinds.includes(entry.kind)) continue;
    const scored = scoreEntry(entry, tokens, wholeQuery);
    if (!scored || scored.score < minScore) continue;
    const row: StudioSearchResult = {
      entry,
      score: scored.score,
      matchedOn: scored.matchedOn,
    };
    if (scored.matchedAlias !== undefined) row.matchedAlias = scored.matchedAlias;
    const bucket = byKind.get(entry.kind);
    if (bucket) bucket.push(row);
    else byKind.set(entry.kind, [row]);
  }

  const sections: StudioSearchSection[] = [];
  let totalShown = 0;
  let totalMatched = 0;

  for (const kind of STUDIO_SEARCH_SECTION_ORDER) {
    const bucket = byKind.get(kind);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort(
      (a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label),
    );
    totalMatched += bucket.length;

    const room = Math.max(0, Math.min(sectionLimit, totalLimit - totalShown));
    const results = bucket.slice(0, room);
    totalShown += results.length;
    sections.push({
      kind,
      label: STUDIO_SEARCH_SECTION_LABELS[kind],
      results,
      matched: bucket.length,
      truncated: results.length < bucket.length,
    });
  }

  return {
    query,
    sections,
    totalShown,
    totalMatched,
    truncated: totalShown < totalMatched,
  };
}

/**
 * Vendor-wording lookup on its own — "이 이름으로 부르던 기능이 우리 쪽에서는
 * 무엇인가". Backs the "CSP/Photoshop 용어" affordance in the search dialog.
 */
export function resolveStudioTerminology(
  term: string,
  index: StudioSearchIndex = studioSearchIndex(),
): readonly StudioSearchEntry[] {
  const byId = new Map(index.entries.map((entry) => [entry.id, entry]));
  const matches = index.terminology.resolve(term, { fuzzy: true });
  const seen = new Set<string>();
  const resolved: StudioSearchEntry[] = [];
  for (const match of matches) {
    if (seen.has(match.commandId)) continue;
    seen.add(match.commandId);
    const entry = byId.get(match.commandId);
    if (entry) resolved.push(entry);
  }
  return resolved;
}
