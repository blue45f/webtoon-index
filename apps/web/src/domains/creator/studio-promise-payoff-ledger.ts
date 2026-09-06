import { z } from "zod";

export const STUDIO_PROMISE_PAYOFF_LEDGER_VERSION = 1 as const;
export const STUDIO_PROMISE_PAYOFF_MAX_ENTRIES = 240;
export const STUDIO_PROMISE_PAYOFF_MAX_LINKS = 32;
export const STUDIO_PROMISE_PAYOFF_MAX_ID_LENGTH = 120;
export const STUDIO_PROMISE_PAYOFF_MAX_TITLE_LENGTH = 180;
export const STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH = 2_000;
export const STUDIO_PROMISE_PAYOFF_MAX_OWNER_LENGTH = 160;
export const STUDIO_PROMISE_PAYOFF_MAX_LABEL_LENGTH = 160;
export const STUDIO_PROMISE_PAYOFF_MAX_EPISODE = 100_000;

export const STUDIO_PROMISE_PAYOFF_KINDS = [
  "foreshadow",
  "mystery",
  "promise",
  "quest",
  "character-goal",
  "reader-question",
] as const;

export const STUDIO_PROMISE_PAYOFF_STATUSES = [
  "seed",
  "foreshadow",
  "partial-payoff",
  "payoff",
  "intentional-non-payoff",
] as const;

export const STUDIO_PROMISE_PAYOFF_URGENCIES = [
  "low",
  "normal",
  "high",
  "critical",
] as const;

export const STUDIO_PROMISE_PAYOFF_VISIBILITIES = [
  "creator-only",
  "editorial",
  "team",
] as const;

export const STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS = [
  "none",
  "mild",
  "major",
  "ending",
] as const;

export type StudioPromisePayoffKind =
  (typeof STUDIO_PROMISE_PAYOFF_KINDS)[number];
export type StudioPromisePayoffStatus =
  (typeof STUDIO_PROMISE_PAYOFF_STATUSES)[number];
export type StudioPromisePayoffUrgency =
  (typeof STUDIO_PROMISE_PAYOFF_URGENCIES)[number];
export type StudioPromisePayoffVisibility =
  (typeof STUDIO_PROMISE_PAYOFF_VISIBILITIES)[number];
export type StudioPromisePayoffSpoilerLevel =
  (typeof STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS)[number];

export type StudioPromisePayoffDeadlineState =
  | "closed"
  | "unscheduled"
  | "future"
  | "due-soon"
  | "due-now"
  | "overdue";

const IdSchema = z.string().trim().min(1).max(STUDIO_PROMISE_PAYOFF_MAX_ID_LENGTH);
const EpisodeSchema = z
  .number()
  .int()
  .min(1)
  .max(STUDIO_PROMISE_PAYOFF_MAX_EPISODE);

export const StudioPromisePayoffStoryLinkSchema = z
  .object({
    id: IdSchema,
    episode: EpisodeSchema,
    sceneId: IdSchema.optional(),
    pageId: IdSchema.optional(),
    frameId: IdSchema.optional(),
    label: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_LABEL_LENGTH),
    note: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH),
  })
  .strict();

export const StudioPromisePayoffEntrySchema = z
  .object({
    id: IdSchema,
    kind: z.enum(STUDIO_PROMISE_PAYOFF_KINDS),
    title: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_TITLE_LENGTH),
    summary: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH),
    status: z.enum(STUDIO_PROMISE_PAYOFF_STATUSES),
    urgency: z.enum(STUDIO_PROMISE_PAYOFF_URGENCIES),
    owner: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_OWNER_LENGTH),
    visibility: z.enum(STUDIO_PROMISE_PAYOFF_VISIBILITIES),
    spoilerLevel: z.enum(STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS),
    dueEpisode: EpisodeSchema.nullable(),
    seed: StudioPromisePayoffStoryLinkSchema.nullable(),
    foreshadows: z
      .array(StudioPromisePayoffStoryLinkSchema)
      .max(STUDIO_PROMISE_PAYOFF_MAX_LINKS),
    payoff: StudioPromisePayoffStoryLinkSchema.nullable(),
    intentionalNonPayoffReason: z.string().max(STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH),
  })
  .strict();

export const StudioPromisePayoffLedgerSchema = z
  .object({
    version: z.literal(STUDIO_PROMISE_PAYOFF_LEDGER_VERSION),
    currentEpisode: EpisodeSchema,
    entries: z
      .array(StudioPromisePayoffEntrySchema)
      .max(STUDIO_PROMISE_PAYOFF_MAX_ENTRIES),
  })
  .strict();

export type StudioPromisePayoffStoryLink = z.infer<
  typeof StudioPromisePayoffStoryLinkSchema
>;
export type StudioPromisePayoffEntry = z.infer<
  typeof StudioPromisePayoffEntrySchema
>;
export type StudioPromisePayoffLedger = z.infer<
  typeof StudioPromisePayoffLedgerSchema
>;

export type StudioPromisePayoffEntryInput = {
  readonly id?: string;
  readonly kind?: StudioPromisePayoffKind;
} & Partial<Omit<StudioPromisePayoffEntry, "id" | "kind">>;

export type StudioPromisePayoffEntryPatch = Partial<
  Omit<StudioPromisePayoffEntry, "id">
>;

export interface StudioPromisePayoffFilter {
  readonly query?: string;
  readonly kinds?: readonly StudioPromisePayoffKind[];
  readonly statuses?: readonly StudioPromisePayoffStatus[];
  readonly unresolvedOnly?: boolean;
  readonly warningOnly?: boolean;
  readonly owner?: string;
}

export type StudioPromisePayoffWarningCode =
  | "MISSING_SEED"
  | "MISSING_FORESHADOW"
  | "MISSING_PAYOFF"
  | "MISSING_INTENTIONAL_REASON"
  | "UNSCHEDULED_PAYOFF"
  | "DUE_SOON"
  | "DUE_NOW"
  | "OVERDUE"
  | "PAYOFF_BEFORE_SEED"
  | "FORESHADOW_BEFORE_SEED"
  | "FORESHADOW_AFTER_PAYOFF";

export type StudioPromisePayoffWarningSeverity =
  | "critical"
  | "high"
  | "normal"
  | "low";

export interface StudioPromisePayoffWarning {
  readonly code: StudioPromisePayoffWarningCode;
  readonly severity: StudioPromisePayoffWarningSeverity;
  readonly entryId: string;
  readonly message: string;
}

export interface StudioPromisePayoffSummary {
  readonly total: number;
  readonly unresolved: number;
  readonly seeded: number;
  readonly foreshadowing: number;
  readonly partiallyPaid: number;
  readonly paidOff: number;
  readonly intentionalNonPayoff: number;
  readonly dueSoon: number;
  readonly dueNow: number;
  readonly overdue: number;
  readonly unscheduled: number;
  readonly warningEntries: number;
}

export type StudioPromisePayoffMergeConflictPolicy =
  | "merge"
  | "keep-existing"
  | "replace-existing";

export interface StudioPromisePayoffMergeResult {
  readonly ledger: StudioPromisePayoffLedger;
  readonly addedIds: readonly string[];
  readonly updatedIds: readonly string[];
  readonly keptIds: readonly string[];
}

const ENTRY_PATCH_FIELDS = new Set<string>([
  "kind",
  "title",
  "summary",
  "status",
  "urgency",
  "owner",
  "visibility",
  "spoilerLevel",
  "dueEpisode",
  "seed",
  "foreshadows",
  "payoff",
  "intentionalNonPayoffReason",
]);

const CLOSED_STATUSES = new Set<StudioPromisePayoffStatus>([
  "payoff",
  "intentional-non-payoff",
]);

const KIND_SET = new Set<string>(STUDIO_PROMISE_PAYOFF_KINDS);
const STATUS_SET = new Set<string>(STUDIO_PROMISE_PAYOFF_STATUSES);
const URGENCY_SET = new Set<string>(STUDIO_PROMISE_PAYOFF_URGENCIES);
const VISIBILITY_SET = new Set<string>(STUDIO_PROMISE_PAYOFF_VISIBILITIES);
const SPOILER_SET = new Set<string>(STUDIO_PROMISE_PAYOFF_SPOILER_LEVELS);

const WARNING_SEVERITY_ORDER: Readonly<Record<StudioPromisePayoffWarningSeverity, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeLookupText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.normalize("NFKC").trim().replace(/\s+/gu, " "))
    .slice(0, maxLength)
    .join("");
}

function normalizeLongText(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(
    value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim()
  )
    .slice(0, STUDIO_PROMISE_PAYOFF_MAX_TEXT_LENGTH)
    .join("");
}

function normalizeId(value: unknown): string {
  return normalizeShortText(value, STUDIO_PROMISE_PAYOFF_MAX_ID_LENGTH);
}

function normalizeEpisode(value: unknown, fallback: number | null): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < 1 || parsed > STUDIO_PROMISE_PAYOFF_MAX_EPISODE) return fallback;
  return parsed;
}

function normalizeEnum<T extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  fallback: T
): T {
  const candidate =
    typeof value === "string" ? value.normalize("NFKC").trim().toLocaleLowerCase() : "";
  return values.has(candidate) ? candidate as T : fallback;
}

function normalizeStoryLink(value: unknown): StudioPromisePayoffStoryLink | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id ?? value.linkId);
  const episode = normalizeEpisode(value.episode ?? value.episodeNumber, null);
  if (!id || episode === null) return null;
  const sceneId = normalizeId(value.sceneId);
  const pageId = normalizeId(value.pageId);
  const frameId = normalizeId(value.frameId ?? value.cutId);
  return StudioPromisePayoffStoryLinkSchema.parse({
    id,
    episode,
    ...(sceneId ? { sceneId } : {}),
    ...(pageId ? { pageId } : {}),
    ...(frameId ? { frameId } : {}),
    label: normalizeShortText(
      value.label ?? value.sceneLabel,
      STUDIO_PROMISE_PAYOFF_MAX_LABEL_LENGTH
    ),
    note: normalizeLongText(value.note ?? value.description),
  });
}

function canonicalStoryLinks(value: unknown): StudioPromisePayoffStoryLink[] {
  if (!Array.isArray(value)) return [];
  const links = new Map<string, StudioPromisePayoffStoryLink>();
  for (const candidate of value) {
    const link = normalizeStoryLink(candidate);
    if (!link || links.has(link.id)) continue;
    links.set(link.id, link);
    if (links.size >= STUDIO_PROMISE_PAYOFF_MAX_LINKS) break;
  }
  return [...links.values()].sort(
    (left, right) => left.episode - right.episode || compareText(left.id, right.id)
  );
}

function normalizeEntry(value: unknown): StudioPromisePayoffEntry | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id ?? value.entryId);
  if (!id) return null;
  const dueEpisode = normalizeEpisode(value.dueEpisode ?? value.payoffDueEpisode, null);
  return StudioPromisePayoffEntrySchema.parse({
    id,
    kind: normalizeEnum(
      value.kind ?? value.type,
      KIND_SET,
      "promise" satisfies StudioPromisePayoffKind
    ),
    title: normalizeShortText(
      value.title ?? value.name,
      STUDIO_PROMISE_PAYOFF_MAX_TITLE_LENGTH
    ),
    summary: normalizeLongText(value.summary ?? value.description),
    status: normalizeEnum(
      value.status,
      STATUS_SET,
      "seed" satisfies StudioPromisePayoffStatus
    ),
    urgency: normalizeEnum(
      value.urgency ?? value.priority,
      URGENCY_SET,
      "normal" satisfies StudioPromisePayoffUrgency
    ),
    owner: normalizeShortText(
      value.owner ?? value.assignee,
      STUDIO_PROMISE_PAYOFF_MAX_OWNER_LENGTH
    ),
    visibility: normalizeEnum(
      value.visibility ?? value.audience,
      VISIBILITY_SET,
      "creator-only" satisfies StudioPromisePayoffVisibility
    ),
    spoilerLevel: normalizeEnum(
      value.spoilerLevel ?? value.spoiler,
      SPOILER_SET,
      "major" satisfies StudioPromisePayoffSpoilerLevel
    ),
    dueEpisode,
    seed: normalizeStoryLink(value.seed ?? value.seedLink),
    foreshadows: canonicalStoryLinks(
      value.foreshadows ?? value.clues ?? value.progressLinks
    ),
    payoff: normalizeStoryLink(value.payoff ?? value.payoffLink),
    intentionalNonPayoffReason: normalizeLongText(
      value.intentionalNonPayoffReason ?? value.nonPayoffReason
    ),
  });
}

function canonicalLedger(
  currentEpisode: unknown,
  entries: readonly StudioPromisePayoffEntry[]
): StudioPromisePayoffLedger {
  const unique = new Map<string, StudioPromisePayoffEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
    if (unique.size >= STUDIO_PROMISE_PAYOFF_MAX_ENTRIES) break;
  }
  return StudioPromisePayoffLedgerSchema.parse({
    version: STUDIO_PROMISE_PAYOFF_LEDGER_VERSION,
    currentEpisode: normalizeEpisode(currentEpisode, 1) ?? 1,
    entries: [...unique.values()].sort((left, right) => compareText(left.id, right.id)),
  });
}

export function createEmptyStudioPromisePayoffLedger(
  currentEpisode = 1
): StudioPromisePayoffLedger {
  return canonicalLedger(currentEpisode, []);
}

export function normalizeStudioPromisePayoffLedger(
  value: unknown
): StudioPromisePayoffLedger {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioPromisePayoffLedger();
    }
  }
  if (!isRecord(decoded)) return createEmptyStudioPromisePayoffLedger();
  const sourceEntries = Array.isArray(decoded.entries)
    ? decoded.entries
    : Array.isArray(decoded.promises)
      ? decoded.promises
      : [];
  const entries: StudioPromisePayoffEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of sourceEntries) {
    const entry = normalizeEntry(candidate);
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    entries.push(entry);
    if (entries.length >= STUDIO_PROMISE_PAYOFF_MAX_ENTRIES) break;
  }
  return canonicalLedger(decoded.currentEpisode ?? decoded.reviewEpisode, entries);
}

export function serializeStudioPromisePayoffLedger(
  value: unknown,
  pretty = false
): string {
  return JSON.stringify(
    normalizeStudioPromisePayoffLedger(value),
    null,
    pretty ? 2 : undefined
  );
}

export function nextStudioPromisePayoffEntryId(
  value: unknown,
  prefix = "promise"
): string {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const safePrefix =
    normalizeId(prefix)
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80)
    || "promise";
  const used = new Set(ledger.entries.map(({ id }) => id));
  for (let index = 1; index <= STUDIO_PROMISE_PAYOFF_MAX_ENTRIES + 1; index += 1) {
    const candidate = `${safePrefix}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("약속 원장에 사용할 안정 ID를 만들 수 없어요.");
}

export function nextStudioPromisePayoffLinkId(
  entry: StudioPromisePayoffEntry,
  stage: "seed" | "foreshadow" | "payoff"
): string {
  const used = new Set([
    entry.seed?.id,
    ...entry.foreshadows.map(({ id }) => id),
    entry.payoff?.id,
  ].filter((id): id is string => Boolean(id)));
  for (let index = 1; index <= STUDIO_PROMISE_PAYOFF_MAX_LINKS + 2; index += 1) {
    const suffix = `-${stage}-${index}`;
    const candidate = `${entry.id.slice(
      0,
      STUDIO_PROMISE_PAYOFF_MAX_ID_LENGTH - suffix.length
    )}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("약속 연결에 사용할 안정 ID를 만들 수 없어요.");
}

export function setStudioPromisePayoffCurrentEpisode(
  value: unknown,
  currentEpisode: number
): StudioPromisePayoffLedger {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const normalized = normalizeEpisode(currentEpisode, null);
  if (normalized === null) throw new Error("현재 작업 회차를 1 이상의 정수로 입력하세요.");
  if (normalized === ledger.currentEpisode) return ledger;
  return canonicalLedger(normalized, ledger.entries);
}

export function addStudioPromisePayoffEntry(
  value: unknown,
  input: StudioPromisePayoffEntryInput = {}
): StudioPromisePayoffLedger {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  if (ledger.entries.length >= STUDIO_PROMISE_PAYOFF_MAX_ENTRIES) {
    throw new Error(`약속 원장은 최대 ${STUDIO_PROMISE_PAYOFF_MAX_ENTRIES}개까지 저장할 수 있어요.`);
  }
  const id = normalizeId(input.id) || nextStudioPromisePayoffEntryId(ledger);
  if (ledger.entries.some((entry) => entry.id === id)) {
    throw new Error("이미 사용 중인 약속 원장 ID예요.");
  }
  const entry = normalizeEntry({
    id,
    kind: input.kind ?? "promise",
    title: input.title ?? `새 약속 ${ledger.entries.length + 1}`,
    summary: input.summary ?? "",
    status: input.status ?? "seed",
    urgency: input.urgency ?? "normal",
    owner: input.owner ?? "",
    visibility: input.visibility ?? "creator-only",
    spoilerLevel: input.spoilerLevel ?? "major",
    dueEpisode: input.dueEpisode ?? null,
    seed: input.seed ?? null,
    foreshadows: input.foreshadows ?? [],
    payoff: input.payoff ?? null,
    intentionalNonPayoffReason: input.intentionalNonPayoffReason ?? "",
  });
  if (!entry) throw new Error("약속 원장 항목을 정규화하지 못했어요.");
  return canonicalLedger(ledger.currentEpisode, [...ledger.entries, entry]);
}

export function patchStudioPromisePayoffEntry(
  value: unknown,
  entryId: string,
  patch: StudioPromisePayoffEntryPatch
): StudioPromisePayoffLedger {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  if (!isRecord(patch)) throw new Error("올바르지 않은 약속 원장 수정 내용이에요.");
  for (const field of Object.keys(patch)) {
    if (!ENTRY_PATCH_FIELDS.has(field)) {
      throw new Error(`수정할 수 없는 약속 원장 필드예요: ${field}`);
    }
  }
  const index = ledger.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return ledger;
  const next = normalizeEntry({ ...ledger.entries[index], ...patch });
  if (!next) throw new Error("약속 원장 항목을 정규화하지 못했어요.");
  if (JSON.stringify(next) === JSON.stringify(ledger.entries[index])) return ledger;
  const entries = ledger.entries.slice();
  entries[index] = next;
  return canonicalLedger(ledger.currentEpisode, entries);
}

export function removeStudioPromisePayoffEntry(
  value: unknown,
  entryId: string
): StudioPromisePayoffLedger {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const entries = ledger.entries.filter((entry) => entry.id !== entryId);
  return entries.length === ledger.entries.length
    ? ledger
    : canonicalLedger(ledger.currentEpisode, entries);
}

export function studioPromisePayoffStatusIsClosed(
  status: StudioPromisePayoffStatus
): boolean {
  return CLOSED_STATUSES.has(status);
}

export function studioPromisePayoffDeadlineState(
  entry: StudioPromisePayoffEntry,
  currentEpisode: number
): StudioPromisePayoffDeadlineState {
  if (studioPromisePayoffStatusIsClosed(entry.status)) return "closed";
  if (entry.dueEpisode === null) return "unscheduled";
  const gap = entry.dueEpisode - currentEpisode;
  if (gap < 0) return "overdue";
  if (gap === 0) return "due-now";
  if (gap <= 2) return "due-soon";
  return "future";
}

export function diagnoseStudioPromisePayoffLedger(
  value: unknown
): StudioPromisePayoffWarning[] {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const warnings: StudioPromisePayoffWarning[] = [];
  const add = (
    entry: StudioPromisePayoffEntry,
    code: StudioPromisePayoffWarningCode,
    severity: StudioPromisePayoffWarningSeverity,
    message: string
  ) => warnings.push({ code, severity, entryId: entry.id, message });

  for (const entry of ledger.entries) {
    const label = entry.title || entry.id;
    if (!entry.seed) {
      add(entry, "MISSING_SEED", "high", `“${label}”의 첫 약속 회차·컷이 연결되지 않았습니다.`);
    }
    if (
      (entry.status === "foreshadow" || entry.status === "partial-payoff")
      && entry.foreshadows.length === 0
    ) {
      add(entry, "MISSING_FORESHADOW", "normal", `“${label}”의 중간 단서가 아직 연결되지 않았습니다.`);
    }
    if (
      (entry.status === "partial-payoff" || entry.status === "payoff")
      && !entry.payoff
    ) {
      add(entry, "MISSING_PAYOFF", "high", `“${label}”의 회수 회차·컷이 연결되지 않았습니다.`);
    }
    if (
      entry.status === "intentional-non-payoff"
      && !entry.intentionalNonPayoffReason
    ) {
      add(
        entry,
        "MISSING_INTENTIONAL_REASON",
        "high",
        `“${label}”을 의도적으로 미회수한 이유를 기록하세요.`
      );
    }

    const deadline = studioPromisePayoffDeadlineState(entry, ledger.currentEpisode);
    if (deadline === "unscheduled") {
      add(entry, "UNSCHEDULED_PAYOFF", "low", `“${label}”의 회수 예정 회차가 없습니다.`);
    } else if (deadline === "due-soon") {
      add(
        entry,
        "DUE_SOON",
        "normal",
        `“${label}”의 회수 마감이 ${entry.dueEpisode}화로 가까워졌습니다.`
      );
    } else if (deadline === "due-now") {
      add(entry, "DUE_NOW", "high", `“${label}”의 회수 마감이 현재 ${ledger.currentEpisode}화입니다.`);
    } else if (deadline === "overdue") {
      add(
        entry,
        "OVERDUE",
        "critical",
        `“${label}”의 회수 마감 ${entry.dueEpisode}화가 지났습니다.`
      );
    }

    if (entry.seed && entry.payoff && entry.payoff.episode < entry.seed.episode) {
      add(entry, "PAYOFF_BEFORE_SEED", "high", `“${label}”의 회수 회차가 첫 약속보다 앞섭니다.`);
    }
    for (const clue of entry.foreshadows) {
      if (entry.seed && clue.episode < entry.seed.episode) {
        add(
          entry,
          "FORESHADOW_BEFORE_SEED",
          "normal",
          `“${label}”의 ${clue.episode}화 단서가 첫 약속보다 앞섭니다.`
        );
      }
      if (entry.payoff && clue.episode > entry.payoff.episode) {
        add(
          entry,
          "FORESHADOW_AFTER_PAYOFF",
          "normal",
          `“${label}”의 ${clue.episode}화 단서가 회수 뒤에 놓였습니다.`
        );
      }
    }
  }

  return warnings.sort(
    (left, right) =>
      WARNING_SEVERITY_ORDER[left.severity] - WARNING_SEVERITY_ORDER[right.severity]
      || compareText(left.entryId, right.entryId)
      || compareText(left.code, right.code)
      || compareText(left.message, right.message)
  );
}

export function summarizeStudioPromisePayoffLedger(
  value: unknown
): StudioPromisePayoffSummary {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const deadlines = ledger.entries.map((entry) =>
    studioPromisePayoffDeadlineState(entry, ledger.currentEpisode)
  );
  const warningEntries = new Set(
    diagnoseStudioPromisePayoffLedger(ledger).map(({ entryId }) => entryId)
  ).size;
  return {
    total: ledger.entries.length,
    unresolved: ledger.entries.filter(({ status }) => !studioPromisePayoffStatusIsClosed(status)).length,
    seeded: ledger.entries.filter(({ status }) => status === "seed").length,
    foreshadowing: ledger.entries.filter(({ status }) => status === "foreshadow").length,
    partiallyPaid: ledger.entries.filter(({ status }) => status === "partial-payoff").length,
    paidOff: ledger.entries.filter(({ status }) => status === "payoff").length,
    intentionalNonPayoff: ledger.entries.filter(
      ({ status }) => status === "intentional-non-payoff"
    ).length,
    dueSoon: deadlines.filter((state) => state === "due-soon").length,
    dueNow: deadlines.filter((state) => state === "due-now").length,
    overdue: deadlines.filter((state) => state === "overdue").length,
    unscheduled: deadlines.filter((state) => state === "unscheduled").length,
    warningEntries,
  };
}

export function searchStudioPromisePayoffLedger(
  value: unknown,
  filter: StudioPromisePayoffFilter = {}
): StudioPromisePayoffEntry[] {
  const ledger = normalizeStudioPromisePayoffLedger(value);
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  const statuses = filter.statuses?.length ? new Set(filter.statuses) : null;
  const warningIds = filter.warningOnly
    ? new Set(diagnoseStudioPromisePayoffLedger(ledger).map(({ entryId }) => entryId))
    : null;
  const owner = normalizeLookupText(filter.owner ?? "");
  const queryTokens = normalizeLookupText(filter.query ?? "").split(" ").filter(Boolean);

  return ledger.entries.filter((entry) => {
    if (kinds && !kinds.has(entry.kind)) return false;
    if (statuses && !statuses.has(entry.status)) return false;
    if (filter.unresolvedOnly && studioPromisePayoffStatusIsClosed(entry.status)) return false;
    if (warningIds && !warningIds.has(entry.id)) return false;
    if (owner && normalizeLookupText(entry.owner) !== owner) return false;
    if (queryTokens.length === 0) return true;
    const links = [entry.seed, ...entry.foreshadows, entry.payoff]
      .filter((link): link is StudioPromisePayoffStoryLink => Boolean(link));
    const haystack = normalizeLookupText([
      entry.id,
      entry.title,
      entry.summary,
      entry.owner,
      ...links.flatMap((link) => [
        `${link.episode}`,
        link.sceneId ?? "",
        link.pageId ?? "",
        link.frameId ?? "",
        link.label,
        link.note,
      ]),
    ].join(" "));
    return queryTokens.every((token) => haystack.includes(token));
  });
}

function mergeLinks(
  existing: readonly StudioPromisePayoffStoryLink[],
  incoming: readonly StudioPromisePayoffStoryLink[]
): StudioPromisePayoffStoryLink[] {
  return canonicalStoryLinks([...existing, ...incoming]);
}

function mergeEntries(
  existing: StudioPromisePayoffEntry,
  incoming: StudioPromisePayoffEntry
): StudioPromisePayoffEntry {
  return StudioPromisePayoffEntrySchema.parse({
    ...existing,
    title: existing.title || incoming.title,
    summary: existing.summary || incoming.summary,
    owner: existing.owner || incoming.owner,
    dueEpisode: existing.dueEpisode ?? incoming.dueEpisode,
    seed: existing.seed ?? incoming.seed,
    payoff: existing.payoff ?? incoming.payoff,
    foreshadows: mergeLinks(existing.foreshadows, incoming.foreshadows),
    intentionalNonPayoffReason:
      existing.intentionalNonPayoffReason || incoming.intentionalNonPayoffReason,
  });
}

export function mergeStudioPromisePayoffLedgers(
  currentValue: unknown,
  incomingValue: unknown,
  policy: StudioPromisePayoffMergeConflictPolicy = "merge"
): StudioPromisePayoffMergeResult {
  const current = normalizeStudioPromisePayoffLedger(currentValue);
  const incoming = normalizeStudioPromisePayoffLedger(incomingValue);
  const entries = new Map(current.entries.map((entry) => [entry.id, entry] as const));
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const keptIds: string[] = [];

  for (const candidate of incoming.entries) {
    const existing = entries.get(candidate.id);
    if (!existing) {
      if (entries.size < STUDIO_PROMISE_PAYOFF_MAX_ENTRIES) {
        entries.set(candidate.id, candidate);
        addedIds.push(candidate.id);
      }
      continue;
    }
    if (policy === "keep-existing") {
      keptIds.push(candidate.id);
      continue;
    }
    const next = policy === "replace-existing"
      ? candidate
      : mergeEntries(existing, candidate);
    entries.set(candidate.id, next);
    if (JSON.stringify(next) === JSON.stringify(existing)) keptIds.push(candidate.id);
    else updatedIds.push(candidate.id);
  }

  const currentEpisode =
    policy === "replace-existing"
      ? incoming.currentEpisode
      : Math.max(current.currentEpisode, incoming.currentEpisode);
  return {
    ledger: canonicalLedger(currentEpisode, [...entries.values()]),
    addedIds: addedIds.sort(compareText),
    updatedIds: updatedIds.sort(compareText),
    keptIds: [...new Set(keptIds)].sort(compareText),
  };
}

export function studioPromisePayoffKindLabel(kind: StudioPromisePayoffKind): string {
  if (kind === "foreshadow") return "복선";
  if (kind === "mystery") return "미스터리";
  if (kind === "promise") return "약속";
  if (kind === "quest") return "퀘스트";
  if (kind === "character-goal") return "인물 목표";
  return "독자 질문";
}

export function studioPromisePayoffStatusLabel(status: StudioPromisePayoffStatus): string {
  if (status === "seed") return "첫 약속";
  if (status === "foreshadow") return "단서 진행";
  if (status === "partial-payoff") return "부분 회수";
  if (status === "payoff") return "회수 완료";
  return "의도적 미회수";
}

export function studioPromisePayoffUrgencyLabel(urgency: StudioPromisePayoffUrgency): string {
  if (urgency === "low") return "낮음";
  if (urgency === "normal") return "보통";
  if (urgency === "high") return "높음";
  return "긴급";
}

export function studioPromisePayoffVisibilityLabel(
  visibility: StudioPromisePayoffVisibility
): string {
  if (visibility === "creator-only") return "작가만";
  if (visibility === "editorial") return "작가·편집";
  return "팀 전체";
}

export function studioPromisePayoffSpoilerLabel(
  level: StudioPromisePayoffSpoilerLevel
): string {
  if (level === "none") return "스포일러 없음";
  if (level === "mild") return "가벼운 스포일러";
  if (level === "major") return "주요 스포일러";
  return "결말 스포일러";
}
