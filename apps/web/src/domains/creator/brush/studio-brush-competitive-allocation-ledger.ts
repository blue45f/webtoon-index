/**
 * Primitive-only physical allocation and work ledger for competitive brush verification.
 *
 * Product renderers report identities and byte/count values, never the backing object itself.
 * Aliases of one ArrayBuffer/Wasm range/Canvas allocation share a `sharedAllocationId`, so the
 * physical backing is charged once even while ownership moves between the live, Worker, handoff,
 * committed and history stages.
 */

export const STUDIO_BRUSH_COMPETITIVE_ALLOCATION_LEDGER_VERSION = 1 as const;
export const STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_ALLOCATIONS = 32_768 as const;
export const STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_QUEUES = 256 as const;
export const STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_WORK_OWNERS = 512 as const;

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,255}$/u;
const MAX_SAFE_BYTE_LENGTH = Number.MAX_SAFE_INTEGER;
const MAX_ALLOCATION_METRIC = Math.floor(
  Number.MAX_SAFE_INTEGER / STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_ALLOCATIONS,
);
const MAX_QUEUE_METRIC = Math.floor(
  Number.MAX_SAFE_INTEGER / STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_QUEUES,
);
const MAX_WORK_METRIC = Math.floor(
  Number.MAX_SAFE_INTEGER / STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_WORK_OWNERS,
);

export type StudioBrushCompetitiveAllocationCategory =
  | "source"
  | "geometry"
  | "rgba"
  | "canvas"
  | "worker"
  | "history"
  | "queue"
  | "handoff"
  | "scratch";

export type StudioBrushCompetitiveAllocationState =
  | "resident"
  | "transient"
  | "paged"
  | "queued"
  | "pinned";

export interface StudioBrushCompetitiveAllocationInput {
  readonly allocationId: string;
  readonly sharedAllocationId: string;
  readonly scopeId: string;
  readonly ownerId: string;
  readonly category: StudioBrushCompetitiveAllocationCategory;
  readonly state: StudioBrushCompetitiveAllocationState;
  readonly residentBytes: number;
  readonly logicalBytes: number;
  readonly transientBytes: number;
  readonly count: number;
}

export interface StudioBrushCompetitiveQueueInput {
  readonly queueId: string;
  readonly scopeId: string;
  readonly ownerId: string;
  readonly count: number;
  readonly bytes: number;
  readonly oldestEnqueuedAtMilliseconds: number | null;
  readonly backpressure: "none" | "waiting" | "rejected";
  readonly spill: "none" | "pending" | "cas";
}

export interface StudioBrushCompetitiveWorkInput {
  readonly ownerId: string;
  readonly scopeId: string;
  readonly samples: number;
  readonly marks: number;
  readonly contours: number;
  readonly hashBytes: number;
  readonly clearCalls: number;
  readonly clearPixelArea: number;
  readonly drawImageCalls: number;
  readonly drawImagePixelArea: number;
  readonly getImageDataCalls: number;
  readonly getImageDataPixelArea: number;
  readonly putImageDataCalls: number;
  readonly putImageDataPixelArea: number;
  readonly mainThreadGetImageDataCalls: number;
  readonly mainThreadPutImageDataCalls: number;
}

export interface StudioBrushCompetitiveCategorySnapshot {
  readonly count: number;
  readonly residentBytes: number;
  readonly logicalBytes: number;
  readonly transientBytes: number;
}

export interface StudioBrushCompetitivePhysicalAllocationSnapshot {
  readonly sharedAllocationId: string;
  readonly scopeId: string;
  readonly ownerId: string;
  readonly category: StudioBrushCompetitiveAllocationCategory;
  readonly state: StudioBrushCompetitiveAllocationState;
  readonly aliasCount: number;
  readonly count: number;
  readonly residentBytes: number;
  readonly logicalBytes: number;
  readonly transientBytes: number;
}

export interface StudioBrushCompetitiveQueueSnapshot extends StudioBrushCompetitiveQueueInput {
  readonly ageMilliseconds: number;
}

export type StudioBrushCompetitiveWorkSnapshot = StudioBrushCompetitiveWorkInput;

export interface StudioBrushCompetitiveAllocationLedgerSnapshot {
  readonly kind: "studio-brush-competitive-allocation-ledger/snapshot";
  readonly version: typeof STUDIO_BRUSH_COMPETITIVE_ALLOCATION_LEDGER_VERSION;
  readonly revision: number;
  readonly physicalAllocationCount: number;
  readonly aliasCount: number;
  readonly residentBytes: number;
  readonly logicalBytes: number;
  readonly transientBytes: number;
  readonly physicalAllocations: readonly StudioBrushCompetitivePhysicalAllocationSnapshot[];
  readonly categories: Readonly<Record<
    StudioBrushCompetitiveAllocationCategory,
    StudioBrushCompetitiveCategorySnapshot
  >>;
  readonly queueCount: number;
  readonly queueBytes: number;
  readonly oldestQueueAgeMilliseconds: number;
  readonly backpressuredQueueCount: number;
  readonly spilledQueueCount: number;
  readonly queues: readonly StudioBrushCompetitiveQueueSnapshot[];
  readonly work: readonly StudioBrushCompetitiveWorkSnapshot[];
  readonly mainThreadGetImageDataCalls: number;
  readonly mainThreadPutImageDataCalls: number;
}

export type StudioBrushCompetitiveLedgerMutationResult = Readonly<{
  status: "accepted";
  revision: number;
}> | Readonly<{
  status: "rejected";
  reason:
    | "invalid-input"
    | "allocation-capacity"
    | "queue-capacity"
    | "work-owner-capacity"
    | "shared-allocation-mismatch";
  revision: number;
}>;

type AllocationRecord = StudioBrushCompetitiveAllocationInput;
type QueueRecord = StudioBrushCompetitiveQueueInput;
type WorkRecord = StudioBrushCompetitiveWorkInput;

const ALLOCATION_CATEGORIES = Object.freeze([
  "source",
  "geometry",
  "rgba",
  "canvas",
  "worker",
  "history",
  "queue",
  "handoff",
  "scratch",
] as const satisfies readonly StudioBrushCompetitiveAllocationCategory[]);

const ALLOCATION_STATES = new Set<StudioBrushCompetitiveAllocationState>([
  "resident",
  "transient",
  "paged",
  "queued",
  "pinned",
]);
const ALLOCATION_CATEGORY_SET = new Set<StudioBrushCompetitiveAllocationCategory>(
  ALLOCATION_CATEGORIES,
);
const BACKPRESSURE_VALUES = new Set(["none", "waiting", "rejected"] as const);
const SPILL_VALUES = new Set(["none", "pending", "cas"] as const);

function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validBoundedMetric(value: unknown, maximum: number): value is number {
  return validNonNegativeInteger(value) && (value as number) <= maximum;
}

function validFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function checkedAdd(left: number, right: number): number | null {
  const sum = left + right;
  return Number.isSafeInteger(sum) && sum <= MAX_SAFE_BYTE_LENGTH ? sum : null;
}

function snapshotAllocationInput(input: unknown): AllocationRecord | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const allocationId = ownDataValue(input, "allocationId");
  const sharedAllocationId = ownDataValue(input, "sharedAllocationId");
  const scopeId = ownDataValue(input, "scopeId");
  const ownerId = ownDataValue(input, "ownerId");
  const category = ownDataValue(input, "category");
  const state = ownDataValue(input, "state");
  const residentBytes = ownDataValue(input, "residentBytes");
  const logicalBytes = ownDataValue(input, "logicalBytes");
  const transientBytes = ownDataValue(input, "transientBytes");
  const count = ownDataValue(input, "count");
  if (
    !validId(allocationId)
    || !validId(sharedAllocationId)
    || !validId(scopeId)
    || !validId(ownerId)
    || !ALLOCATION_CATEGORY_SET.has(category as StudioBrushCompetitiveAllocationCategory)
    || !ALLOCATION_STATES.has(state as StudioBrushCompetitiveAllocationState)
    || !validBoundedMetric(residentBytes, MAX_ALLOCATION_METRIC)
    || !validBoundedMetric(logicalBytes, MAX_ALLOCATION_METRIC)
    || !validBoundedMetric(transientBytes, MAX_ALLOCATION_METRIC)
    || !validBoundedMetric(count, MAX_ALLOCATION_METRIC)
  ) return null;
  return {
    allocationId,
    sharedAllocationId,
    scopeId,
    ownerId,
    category: category as StudioBrushCompetitiveAllocationCategory,
    state: state as StudioBrushCompetitiveAllocationState,
    residentBytes,
    logicalBytes,
    transientBytes,
    count,
  };
}

function snapshotQueueInput(input: unknown): QueueRecord | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const queueId = ownDataValue(input, "queueId");
  const scopeId = ownDataValue(input, "scopeId");
  const ownerId = ownDataValue(input, "ownerId");
  const count = ownDataValue(input, "count");
  const bytes = ownDataValue(input, "bytes");
  const oldest = ownDataValue(input, "oldestEnqueuedAtMilliseconds");
  const backpressure = ownDataValue(input, "backpressure");
  const spill = ownDataValue(input, "spill");
  if (
    !validId(queueId)
    || !validId(scopeId)
    || !validId(ownerId)
    || !validBoundedMetric(count, MAX_QUEUE_METRIC)
    || !validBoundedMetric(bytes, MAX_QUEUE_METRIC)
    || !(oldest === null || validFiniteTimestamp(oldest))
    || !BACKPRESSURE_VALUES.has(backpressure as "none" | "waiting" | "rejected")
    || !SPILL_VALUES.has(spill as "none" | "pending" | "cas")
    || (count === 0 && (bytes !== 0 || oldest !== null))
    || (count > 0 && oldest === null)
  ) return null;
  return {
    queueId,
    scopeId,
    ownerId,
    count,
    bytes,
    oldestEnqueuedAtMilliseconds: oldest,
    backpressure: backpressure as QueueRecord["backpressure"],
    spill: spill as QueueRecord["spill"],
  };
}

function snapshotWorkInput(input: unknown): WorkRecord | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const ownerId = ownDataValue(input, "ownerId");
  const scopeId = ownDataValue(input, "scopeId");
  if (!validId(ownerId) || !validId(scopeId)) return null;
  const numericKeys = [
    "samples",
    "marks",
    "contours",
    "hashBytes",
    "clearCalls",
    "clearPixelArea",
    "drawImageCalls",
    "drawImagePixelArea",
    "getImageDataCalls",
    "getImageDataPixelArea",
    "putImageDataCalls",
    "putImageDataPixelArea",
    "mainThreadGetImageDataCalls",
    "mainThreadPutImageDataCalls",
  ] as const satisfies readonly (keyof Omit<WorkRecord, "ownerId" | "scopeId">)[];
  const values: Record<string, number> = {};
  for (const key of numericKeys) {
    const value = ownDataValue(input, key);
    if (!validBoundedMetric(value, MAX_WORK_METRIC)) return null;
    values[key] = value;
  }
  return {
    ownerId,
    scopeId,
    samples: values.samples!,
    marks: values.marks!,
    contours: values.contours!,
    hashBytes: values.hashBytes!,
    clearCalls: values.clearCalls!,
    clearPixelArea: values.clearPixelArea!,
    drawImageCalls: values.drawImageCalls!,
    drawImagePixelArea: values.drawImagePixelArea!,
    getImageDataCalls: values.getImageDataCalls!,
    getImageDataPixelArea: values.getImageDataPixelArea!,
    putImageDataCalls: values.putImageDataCalls!,
    putImageDataPixelArea: values.putImageDataPixelArea!,
    mainThreadGetImageDataCalls: values.mainThreadGetImageDataCalls!,
    mainThreadPutImageDataCalls: values.mainThreadPutImageDataCalls!,
  };
}

function emptyCategorySnapshot(): StudioBrushCompetitiveCategorySnapshot {
  return Object.freeze({
    count: 0,
    residentBytes: 0,
    logicalBytes: 0,
    transientBytes: 0,
  });
}

function rejected(
  reason: Extract<StudioBrushCompetitiveLedgerMutationResult, { status: "rejected" }>["reason"],
  revision: number,
): StudioBrushCompetitiveLedgerMutationResult {
  return Object.freeze({ status: "rejected" as const, reason, revision });
}

export interface StudioBrushCompetitiveAllocationLedger {
  readonly upsertAllocation: (
    input: StudioBrushCompetitiveAllocationInput,
  ) => StudioBrushCompetitiveLedgerMutationResult;
  readonly releaseAllocation: (allocationId: string) => StudioBrushCompetitiveLedgerMutationResult;
  readonly releaseScope: (scopeId: string) => Readonly<{
    status: "accepted" | "rejected";
    releasedAllocationCount: number;
    releasedQueueCount: number;
    releasedWorkOwnerCount: number;
    revision: number;
  }>;
  readonly setQueue: (
    input: StudioBrushCompetitiveQueueInput,
  ) => StudioBrushCompetitiveLedgerMutationResult;
  readonly releaseQueue: (queueId: string) => StudioBrushCompetitiveLedgerMutationResult;
  readonly addWork: (
    input: StudioBrushCompetitiveWorkInput,
  ) => StudioBrushCompetitiveLedgerMutationResult;
  readonly snapshot: (nowMilliseconds?: number) => StudioBrushCompetitiveAllocationLedgerSnapshot;
  readonly clear: () => void;
}

export function createStudioBrushCompetitiveAllocationLedger(): StudioBrushCompetitiveAllocationLedger {
  const allocations = new Map<string, AllocationRecord>();
  const allocationAliases = new Map<string, Set<string>>();
  const queues = new Map<string, QueueRecord>();
  const work = new Map<string, WorkRecord>();
  let revision = 0;

  const advanceRevision = (): number => {
    revision = revision >= Number.MAX_SAFE_INTEGER ? 1 : revision + 1;
    return revision;
  };

  const accepted = (): StudioBrushCompetitiveLedgerMutationResult => Object.freeze({
    status: "accepted" as const,
    revision: advanceRevision(),
  });

  const deleteAllocation = (allocationId: string): boolean => {
    const current = allocations.get(allocationId);
    if (!current) return false;
    allocations.delete(allocationId);
    const aliases = allocationAliases.get(current.sharedAllocationId);
    aliases?.delete(allocationId);
    if (aliases?.size === 0) allocationAliases.delete(current.sharedAllocationId);
    return true;
  };

  const ledger: StudioBrushCompetitiveAllocationLedger = {
    upsertAllocation(input) {
      const next = snapshotAllocationInput(input);
      if (!next) return rejected("invalid-input", revision);
      if (!allocations.has(next.allocationId)
        && allocations.size >= STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_ALLOCATIONS) {
        return rejected("allocation-capacity", revision);
      }
      const previous = allocations.get(next.allocationId);
      if (previous && previous.sharedAllocationId !== next.sharedAllocationId) {
        return rejected("invalid-input", revision);
      }
      const aliases = allocationAliases.get(next.sharedAllocationId);
      if (aliases) for (const aliasId of aliases) {
        const current = allocations.get(aliasId);
        if (!current) continue;
        if (
          current.allocationId !== next.allocationId
          && (
            current.scopeId !== next.scopeId
            || current.ownerId !== next.ownerId
            || current.category !== next.category
            || current.state !== next.state
            || current.residentBytes !== next.residentBytes
            || current.logicalBytes !== next.logicalBytes
            || current.transientBytes !== next.transientBytes
            || current.count !== next.count
          )
        ) return rejected("shared-allocation-mismatch", revision);
      }
      allocations.set(next.allocationId, next);
      if (!aliases) allocationAliases.set(next.sharedAllocationId, new Set([next.allocationId]));
      else aliases.add(next.allocationId);
      return accepted();
    },

    releaseAllocation(allocationId) {
      if (!validId(allocationId)) return rejected("invalid-input", revision);
      deleteAllocation(allocationId);
      return accepted();
    },

    releaseScope(scopeId) {
      if (!validId(scopeId)) {
        return Object.freeze({
          status: "rejected" as const,
          releasedAllocationCount: 0,
          releasedQueueCount: 0,
          releasedWorkOwnerCount: 0,
          revision,
        });
      }
      let releasedAllocationCount = 0;
      let releasedQueueCount = 0;
      let releasedWorkOwnerCount = 0;
      for (const [id, record] of allocations) {
        if (record.scopeId !== scopeId) continue;
        deleteAllocation(id);
        releasedAllocationCount += 1;
      }
      for (const [id, record] of queues) {
        if (record.scopeId !== scopeId) continue;
        queues.delete(id);
        releasedQueueCount += 1;
      }
      for (const [id, record] of work) {
        if (record.scopeId !== scopeId) continue;
        work.delete(id);
        releasedWorkOwnerCount += 1;
      }
      return Object.freeze({
        status: "accepted" as const,
        releasedAllocationCount,
        releasedQueueCount,
        releasedWorkOwnerCount,
        revision: advanceRevision(),
      });
    },

    setQueue(input) {
      const next = snapshotQueueInput(input);
      if (!next) return rejected("invalid-input", revision);
      if (!queues.has(next.queueId) && queues.size >= STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_QUEUES) {
        return rejected("queue-capacity", revision);
      }
      queues.set(next.queueId, next);
      return accepted();
    },

    releaseQueue(queueId) {
      if (!validId(queueId)) return rejected("invalid-input", revision);
      queues.delete(queueId);
      return accepted();
    },

    addWork(input) {
      const delta = snapshotWorkInput(input);
      if (!delta) return rejected("invalid-input", revision);
      const key = `${delta.scopeId}\u0000${delta.ownerId}`;
      const current = work.get(key);
      if (!current && work.size >= STUDIO_BRUSH_COMPETITIVE_MAX_LEDGER_WORK_OWNERS) {
        return rejected("work-owner-capacity", revision);
      }
      if (!current) {
        work.set(key, delta);
        return accepted();
      }
      const next: Record<string, number | string> = {
        ownerId: current.ownerId,
        scopeId: current.scopeId,
      };
      for (const key of Object.keys(current) as (keyof WorkRecord)[]) {
        if (key === "ownerId" || key === "scopeId") continue;
        const sum = checkedAdd(current[key], delta[key]);
        if (sum === null) return rejected("invalid-input", revision);
        next[key] = sum;
      }
      work.set(key, next as unknown as WorkRecord);
      return accepted();
    },

    snapshot(nowMilliseconds = performance.now()) {
      const now = validFiniteTimestamp(nowMilliseconds) ? nowMilliseconds : 0;
      const physical = new Map<string, AllocationRecord>();
      for (const [sharedAllocationId, aliases] of allocationAliases) {
        const allocationId = aliases.values().next().value as string | undefined;
        const record = allocationId ? allocations.get(allocationId) : undefined;
        if (record) physical.set(sharedAllocationId, record);
      }
      const mutableCategories = Object.fromEntries(ALLOCATION_CATEGORIES.map((category) => [
        category,
        { count: 0, residentBytes: 0, logicalBytes: 0, transientBytes: 0 },
      ])) as Record<StudioBrushCompetitiveAllocationCategory, {
        count: number;
        residentBytes: number;
        logicalBytes: number;
        transientBytes: number;
      }>;
      let residentBytes = 0;
      let logicalBytes = 0;
      let transientBytes = 0;
      const physicalAllocations: StudioBrushCompetitivePhysicalAllocationSnapshot[] = [];
      for (const record of physical.values()) {
        const category = mutableCategories[record.category];
        category.count += record.count;
        category.residentBytes += record.residentBytes;
        category.logicalBytes += record.logicalBytes;
        category.transientBytes += record.transientBytes;
        residentBytes += record.residentBytes;
        logicalBytes += record.logicalBytes;
        transientBytes += record.transientBytes;
        physicalAllocations.push(Object.freeze({
          sharedAllocationId: record.sharedAllocationId,
          scopeId: record.scopeId,
          ownerId: record.ownerId,
          category: record.category,
          state: record.state,
          aliasCount: allocationAliases.get(record.sharedAllocationId)?.size ?? 0,
          count: record.count,
          residentBytes: record.residentBytes,
          logicalBytes: record.logicalBytes,
          transientBytes: record.transientBytes,
        }));
      }
      let queueCount = 0;
      let queueBytes = 0;
      let oldestQueueAgeMilliseconds = 0;
      let backpressuredQueueCount = 0;
      let spilledQueueCount = 0;
      const queueSnapshots: StudioBrushCompetitiveQueueSnapshot[] = [];
      for (const queue of queues.values()) {
        queueCount += queue.count;
        queueBytes += queue.bytes;
        if (queue.oldestEnqueuedAtMilliseconds !== null) {
          oldestQueueAgeMilliseconds = Math.max(
            oldestQueueAgeMilliseconds,
            Math.max(0, now - queue.oldestEnqueuedAtMilliseconds),
          );
        }
        if (queue.backpressure !== "none") backpressuredQueueCount += 1;
        if (queue.spill === "cas") spilledQueueCount += 1;
        queueSnapshots.push(Object.freeze({
          ...queue,
          ageMilliseconds: queue.oldestEnqueuedAtMilliseconds === null
            ? 0
            : Math.max(0, now - queue.oldestEnqueuedAtMilliseconds),
        }));
      }
      const workSnapshot = [...work.values()]
        .sort((left, right) => (
          left.scopeId.localeCompare(right.scopeId)
          || left.ownerId.localeCompare(right.ownerId)
        ))
        .map((record) => Object.freeze({ ...record }));
      return Object.freeze({
        kind: "studio-brush-competitive-allocation-ledger/snapshot" as const,
        version: STUDIO_BRUSH_COMPETITIVE_ALLOCATION_LEDGER_VERSION,
        revision,
        physicalAllocationCount: physical.size,
        aliasCount: allocations.size - physical.size,
        residentBytes,
        logicalBytes,
        transientBytes,
        physicalAllocations: Object.freeze(physicalAllocations.sort((left, right) => (
          left.sharedAllocationId.localeCompare(right.sharedAllocationId)
        ))),
        categories: Object.freeze(Object.fromEntries(
          ALLOCATION_CATEGORIES.map((category) => [
            category,
            Object.freeze(mutableCategories[category] ?? emptyCategorySnapshot()),
          ]),
        ) as Record<StudioBrushCompetitiveAllocationCategory, StudioBrushCompetitiveCategorySnapshot>),
        queueCount,
        queueBytes,
        oldestQueueAgeMilliseconds,
        backpressuredQueueCount,
        spilledQueueCount,
        queues: Object.freeze(queueSnapshots.sort((left, right) => (
          left.queueId.localeCompare(right.queueId)
        ))),
        work: Object.freeze(workSnapshot),
        mainThreadGetImageDataCalls: workSnapshot.reduce(
          (sum, record) => sum + record.mainThreadGetImageDataCalls,
          0,
        ),
        mainThreadPutImageDataCalls: workSnapshot.reduce(
          (sum, record) => sum + record.mainThreadPutImageDataCalls,
          0,
        ),
      });
    },

    clear() {
      allocations.clear();
      allocationAliases.clear();
      queues.clear();
      work.clear();
      advanceRevision();
    },
  };
  return Object.freeze(ledger);
}
