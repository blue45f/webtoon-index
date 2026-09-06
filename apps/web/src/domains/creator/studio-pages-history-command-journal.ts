import {
  createStudioCommandEnvelope,
  createStudioCommandJournal,
  restoreStudioCommandJournal,
  type StudioCommandJournal,
  type StudioCommandJsonValue,
  type StudioCommandReplayPlan,
} from "./studio-command-journal";

const STUDIO_HISTORY_JOURNAL_ACTOR_ID = "actor:local-studio";
const DEFAULT_HISTORY_JOURNAL_MAX_RECORDS = 512;
const DEFAULT_HISTORY_JOURNAL_COMPACT_AT = 448;
const STUDIO_HISTORY_DIGEST_PREFIX = "shs1-";
const studioHistoryContentDigestCache = new WeakMap<object, string>();

export interface StudioHistoryJournalPageLike {
  readonly id: string;
  readonly elements: readonly unknown[];
  readonly canvasH: number;
}

export interface StudioHistoryJournalSnapshotSummary {
  readonly historyIndex: number;
  readonly pageCount: number;
  readonly elementCount: number;
  readonly contentDigest: string;
  readonly pages: readonly Readonly<{
    id: string;
    elementCount: number;
    canvasH: number;
    contentDigest: string;
  }>[];
}

export interface StudioHistoryJournalTransitionInput {
  readonly mutationKind: string;
  readonly previousPages: readonly StudioHistoryJournalPageLike[];
  readonly nextPages: readonly StudioHistoryJournalPageLike[];
  readonly previousHistoryIndex: number;
  readonly nextHistoryIndex: number;
  readonly coalesceKey?: string;
}

export interface StudioPagesHistoryCommandJournalOptions {
  readonly maxRecords?: number;
  readonly compactAt?: number;
  /** CRC/checksum-verified durable frontier produced by serialize(). */
  readonly serialized?: string;
}

export interface StudioHistoryJournalNavigationTarget {
  readonly pages: readonly StudioHistoryJournalPageLike[];
  readonly historyIndex: number;
}

export type StudioHistoryJournalNavigationResult = "recorded" | "rebased";

function boundedSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}

function hashStudioHistoryDigestParts(parts: readonly string[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const part of parts) {
    const framed = `${part.length}:${part}`;
    for (let index = 0; index < framed.length; index += 1) {
      const code = framed.charCodeAt(index);
      first = Math.imul(first ^ (code & 0xff), 0x01000193);
      first = Math.imul(first ^ (code >>> 8), 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
      second ^= second >>> 13;
    }
  }
  return `${STUDIO_HISTORY_DIGEST_PREFIX}${(first >>> 0)
    .toString(16)
    .padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Merkle-style content digest for editor snapshots.
 *
 * Snapshot values are treated as immutable (the same contract as the bounded React history).
 * Weakly caching child objects means a drag only re-hashes the changed element and the arrays/pages
 * on its path; large unchanged image sources and point arrays are never copied into journal records
 * or re-read for every pointer sample. Property descriptors are inspected without invoking getters.
 */
function studioHistoryContentDigest(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet<object>()
): string {
  if (value === null) return hashStudioHistoryDigestParts(["null"]);
  if (typeof value === "string") {
    return hashStudioHistoryDigestParts(["string", value]);
  }
  if (typeof value === "boolean") {
    return hashStudioHistoryDigestParts(["boolean", value ? "1" : "0"]);
  }
  if (typeof value === "number") {
    const normalized = Number.isFinite(value)
      ? JSON.stringify(Object.is(value, -0) ? 0 : value)
      : String(value);
    return hashStudioHistoryDigestParts(["number", normalized]);
  }
  if (typeof value === "bigint") {
    return hashStudioHistoryDigestParts(["bigint", value.toString()]);
  }
  if (typeof value === "undefined") {
    return hashStudioHistoryDigestParts(["undefined"]);
  }
  if (typeof value === "symbol") {
    return hashStudioHistoryDigestParts(["symbol", value.description ?? ""]);
  }
  if (typeof value === "function") {
    return hashStudioHistoryDigestParts(["function"]);
  }

  const cached = studioHistoryContentDigestCache.get(value);
  if (cached && !ancestors.has(value)) return cached;
  if (ancestors.has(value)) return hashStudioHistoryDigestParts(["cycle"]);
  ancestors.add(value);
  try {
    const parts: string[] = [Array.isArray(value) ? "array" : "object"];
    if (Array.isArray(value)) {
      parts.push(String(value.length));
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        parts.push(
          descriptor && Object.hasOwn(descriptor, "value")
            ? studioHistoryContentDigest(descriptor.value, ancestors)
            : hashStudioHistoryDigestParts(["array-hole"])
        );
      }
    } else {
      const keys = Reflect.ownKeys(value)
        .filter((key): key is string => typeof key === "string")
        .sort();
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        parts.push(key);
        parts.push(
          Object.hasOwn(descriptor, "value")
            ? studioHistoryContentDigest(descriptor.value, ancestors)
            : hashStudioHistoryDigestParts(["accessor"])
        );
      }
    }
    const digest = hashStudioHistoryDigestParts(parts);
    studioHistoryContentDigestCache.set(value, digest);
    return digest;
  } finally {
    ancestors.delete(value);
  }
}

export function summarizeStudioHistorySnapshot(
  pages: readonly StudioHistoryJournalPageLike[],
  historyIndex: number
): StudioHistoryJournalSnapshotSummary {
  const allSummaries = pages.map((page) => ({
    id: String(page.id).slice(0, 128),
    elementCount: boundedSafeInteger(page.elements.length),
    canvasH: Number.isFinite(page.canvasH) ? page.canvasH : 0,
    // Keep command records bounded while still distinguishing edits that preserve array length
    // (dragging, text edits, point changes, recolouring, and similar mutations).
    contentDigest: studioHistoryContentDigest(page),
  }));
  const contentDigest = hashStudioHistoryDigestParts(
    allSummaries.flatMap((page) => [
      page.id,
      String(page.elementCount),
      String(page.canvasH),
      page.contentDigest,
    ])
  );
  const summaries = allSummaries.slice(0, 200);
  return Object.freeze({
    historyIndex: boundedSafeInteger(historyIndex),
    pageCount: allSummaries.length,
    elementCount: allSummaries.reduce(
      (total, page) => total + page.elementCount,
      0
    ),
    contentDigest,
    pages: Object.freeze(summaries.map((page) => Object.freeze(page))),
  });
}

function transitionPayload(
  mutationKind: string,
  snapshot: StudioHistoryJournalSnapshotSummary
): StudioCommandJsonValue {
  return {
    mutationKind: boundedLabel(mutationKind, "history.commit"),
    snapshot: snapshot as unknown as StudioCommandJsonValue,
  };
}

/**
 * Integrity journal for the existing Studio snapshot-history boundary.
 *
 * The snapshot array remains the mutation authority during the staged migration. The journal
 * records deterministic forward/inverse receipts for every local history transition so command
 * ordering, coalescing, actor ownership, replay checksums, and corruption detection can be adopted
 * without changing the editor's proven large-document memory representation.
 */
export class StudioPagesHistoryCommandJournal {
  private readonly maxRecords: number;
  private readonly compactAt: number;
  private journalValue: StudioCommandJournal<StudioCommandJsonValue>;
  private activeCoalesceKey: string | null = null;
  private activeCoalesceGroupId: string | null = null;
  private pendingCoalescedTransition: StudioHistoryJournalTransitionInput | null =
    null;

  constructor(options: StudioPagesHistoryCommandJournalOptions = {}) {
    const maxRecords = options.maxRecords ?? DEFAULT_HISTORY_JOURNAL_MAX_RECORDS;
    const compactAt = options.compactAt ?? DEFAULT_HISTORY_JOURNAL_COMPACT_AT;
    if (
      !Number.isSafeInteger(maxRecords) ||
      maxRecords < 8 ||
      !Number.isSafeInteger(compactAt) ||
      compactAt < 4 ||
      compactAt >= maxRecords
    ) {
      throw new Error("Studio history journal limits are invalid.");
    }
    this.maxRecords = maxRecords;
    this.compactAt = compactAt;
    this.journalValue = options.serialized === undefined
      ? this.createJournal()
      : restoreStudioCommandJournal<StudioCommandJsonValue>(options.serialized);
    if (options.serialized !== undefined) {
      if (
        this.journalValue.extensions.integration !== "studio-pages-history"
        || this.journalValue.extensions.version !== 1
      ) {
        throw new Error("Restored Studio history journal belongs to another integration.");
      }
      if (this.journalValue.limits.maxRecords !== this.maxRecords) {
        throw new Error("Restored Studio history journal limits do not match this runtime.");
      }
    }
  }

  private createJournal(): StudioCommandJournal<StudioCommandJsonValue> {
    return createStudioCommandJournal<StudioCommandJsonValue>({
      limits: {
        maxRecords: this.maxRecords,
        maxPayloadBytes: 128 * 1024,
        maxSerializedBytes: 4 * 1024 * 1024,
      },
      extensions: {
        integration: "studio-pages-history",
        version: 1,
      },
    });
  }

  private nextIdentity(prefix: string): {
    id: string;
    lamport: number;
  } {
    const sequence = this.journalValue.nextSequence;
    return {
      id: `${prefix}:${sequence}`,
      lamport: sequence,
    };
  }

  private compactIfNeeded(snapshot: StudioHistoryJournalSnapshotSummary): void {
    if (this.journalValue.length < this.compactAt) return;
    this.journalValue.compact({
      id: `checkpoint:${this.journalValue.nextSequence}`,
      state: snapshot as unknown as StudioCommandJsonValue,
      extensions: {
        integration: "studio-pages-history",
      },
    });
    this.activeCoalesceKey = null;
    this.activeCoalesceGroupId = null;
  }

  /**
   * Establishes a new local undo/redo horizon at the exact authoritative snapshot selected by the
   * caller. This is used after arbitrary history navigation or when retained journal groups no
   * longer reach an otherwise valid snapshot-history move.
   */
  rebase(target: StudioHistoryJournalNavigationTarget): void {
    const snapshot = summarizeStudioHistorySnapshot(
      target.pages,
      target.historyIndex
    );
    this.journalValue = this.createJournal();
    this.journalValue.compact({
      id: "checkpoint:history-rebase",
      state: snapshot as unknown as StudioCommandJsonValue,
      extensions: {
        integration: "studio-pages-history",
        reason: "history-horizon-rebase",
      },
    });
    this.activeCoalesceKey = null;
    this.activeCoalesceGroupId = null;
    this.pendingCoalescedTransition = null;
  }

  private appendTransition(input: StudioHistoryJournalTransitionInput): void {
    const previous = summarizeStudioHistorySnapshot(
      input.previousPages,
      input.previousHistoryIndex
    );
    const next = summarizeStudioHistorySnapshot(
      input.nextPages,
      input.nextHistoryIndex
    );
    this.compactIfNeeded(previous);
    const identity = this.nextIdentity("command");
    const coalesceKey =
      input.coalesceKey === undefined
        ? null
        : boundedLabel(input.coalesceKey, "coalesced");
    let groupId: string;
    if (
      coalesceKey !== null &&
      coalesceKey === this.activeCoalesceKey &&
      this.activeCoalesceGroupId
    ) {
      groupId = this.activeCoalesceGroupId;
    } else {
      groupId = `group:${identity.lamport}`;
      this.activeCoalesceKey = coalesceKey;
      this.activeCoalesceGroupId = coalesceKey === null ? null : groupId;
    }

    this.journalValue.appendCommand(
      createStudioCommandEnvelope({
        ...identity,
        actorId: STUDIO_HISTORY_JOURNAL_ACTOR_ID,
        transactionId: null,
        groupId,
        command: {
          kind: "studio.history.transition",
          payload: transitionPayload(input.mutationKind, next),
        },
        inverse: {
          kind: "studio.history.transition",
          payload: transitionPayload(input.mutationKind, previous),
        },
        extensions: {
          coalesced: coalesceKey !== null,
        },
      })
    );
  }

  private flushPendingCoalescedTransition(): void {
    const pending = this.pendingCoalescedTransition;
    if (!pending) return;
    this.appendTransition(pending);
    this.pendingCoalescedTransition = null;
  }

  /**
   * Pointer-heavy coalesced edits keep only their initial inverse and latest forward snapshot until
   * an observable journal boundary (undo/redo, another command, replay, or serialization). This
   * removes journal hashing/allocation from every pointermove while preserving the exact final
   * transition represented by the authoritative snapshot history.
   */
  recordTransition(input: StudioHistoryJournalTransitionInput): void {
    if (input.coalesceKey !== undefined) {
      const coalesceKey = boundedLabel(input.coalesceKey, "coalesced");
      const pending = this.pendingCoalescedTransition;
      const continuesPending =
        pending?.coalesceKey === coalesceKey
        && (
          pending.nextHistoryIndex === input.previousHistoryIndex
          || pending.nextHistoryIndex === input.nextHistoryIndex
        );
      if (pending && continuesPending) {
        this.pendingCoalescedTransition = {
          ...pending,
          mutationKind: input.mutationKind,
          nextPages: input.nextPages,
          nextHistoryIndex: input.nextHistoryIndex,
          coalesceKey,
        };
        return;
      }
      this.flushPendingCoalescedTransition();
      this.pendingCoalescedTransition = {
        ...input,
        coalesceKey,
      };
      return;
    }

    this.flushPendingCoalescedTransition();
    this.appendTransition(input);
  }

  recordUndo(
    target: StudioHistoryJournalNavigationTarget
  ): StudioHistoryJournalNavigationResult {
    this.flushPendingCoalescedTransition();
    this.activeCoalesceKey = null;
    this.activeCoalesceGroupId = null;
    const groupId = this.journalValue.peekUndoGroup(
      STUDIO_HISTORY_JOURNAL_ACTOR_ID
    );
    if (!groupId) {
      this.rebase(target);
      return "rebased";
    }
    const identity = this.nextIdentity("undo");
    this.journalValue.undo({
      ...identity,
      actorId: STUDIO_HISTORY_JOURNAL_ACTOR_ID,
      groupId,
    });
    return "recorded";
  }

  recordRedo(
    target: StudioHistoryJournalNavigationTarget
  ): StudioHistoryJournalNavigationResult {
    this.flushPendingCoalescedTransition();
    this.activeCoalesceKey = null;
    this.activeCoalesceGroupId = null;
    const groupId = this.journalValue.peekRedoGroup(
      STUDIO_HISTORY_JOURNAL_ACTOR_ID
    );
    if (!groupId) {
      this.rebase(target);
      return "rebased";
    }
    const identity = this.nextIdentity("redo");
    this.journalValue.redo({
      ...identity,
      actorId: STUDIO_HISTORY_JOURNAL_ACTOR_ID,
      groupId,
    });
    return "recorded";
  }

  /**
   * Resets only the local command horizon after an external document replacement or an arbitrary
   * history jump. The authoritative Studio snapshot is kept by the caller.
   */
  reset(): void {
    this.journalValue = this.createJournal();
    this.activeCoalesceKey = null;
    this.activeCoalesceGroupId = null;
    this.pendingCoalescedTransition = null;
  }

  replayPlan(): StudioCommandReplayPlan<StudioCommandJsonValue> {
    this.flushPendingCoalescedTransition();
    return this.journalValue.replayPlan();
  }

  serialize(): string {
    this.flushPendingCoalescedTransition();
    return this.journalValue.serialize();
  }

  /**
   * Confirms that a restored integrity frontier describes the content snapshot already loaded by
   * the product autosave authority. A mismatch is rebased instead of applying undo receipts to a
   * different document generation.
   */
  matchesTarget(target: StudioHistoryJournalNavigationTarget): boolean {
    const expected = summarizeStudioHistorySnapshot(target.pages, target.historyIndex);
    const plan = this.replayPlan();
    let current: StudioHistoryJournalSnapshotSummary | null = null;
    const checkpoint = plan.checkpoint?.state;
    if (checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)) {
      current = checkpoint as unknown as StudioHistoryJournalSnapshotSummary;
    }
    for (const batch of plan.batches) {
      for (const operation of batch.operations) {
        if (operation.kind !== "studio.history.transition") continue;
        const payload = operation.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
        const snapshot = (payload as Record<string, unknown>).snapshot;
        if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
          current = snapshot as unknown as StudioHistoryJournalSnapshotSummary;
        }
      }
    }
    return current !== null
      && current.historyIndex === expected.historyIndex
      && current.pageCount === expected.pageCount
      && current.elementCount === expected.elementCount
      && current.contentDigest === expected.contentDigest;
  }
}

export function createStudioPagesHistoryCommandJournal(
  options: StudioPagesHistoryCommandJournalOptions = {}
): StudioPagesHistoryCommandJournal {
  return new StudioPagesHistoryCommandJournal(options);
}

export function restoreStudioPagesHistoryCommandJournal(
  serialized: string,
): StudioPagesHistoryCommandJournal {
  return new StudioPagesHistoryCommandJournal({ serialized });
}
