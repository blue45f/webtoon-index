import { StudioCrdtDocument } from "./studio-crdt-document";

import type * as Y from "yjs";

export const F754_PROPERTY_SEEDS = [
  0x00c0_ffee,
  0x1357_9bdf,
  0x2468_ace0,
  0x5eed_f754,
  0x7fff_ffff,
] as const;

const TRACE_LIMIT = 96;

/**
 * Small deterministic generator for CI property tests. Mulberry32 keeps every failure reproducible
 * from one unsigned 32-bit seed without adding a runtime dependency to the Studio bundle.
 */
export class F754SeededRandom {
  readonly seed: number;
  private state: number;
  private readonly entries: string[] = [];
  private omittedEntries = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  next(): number {
    this.state = (this.state + 0x6d2b_79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  }

  integer(minimum: number, maximum: number): number {
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum
    ) {
      throw new Error("F-754 integer bounds are invalid");
    }
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  chance(probability: number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error("F-754 probability is invalid");
    }
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error("F-754 cannot pick from an empty collection");
    return values[this.integer(0, values.length - 1)]!;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const target = this.integer(0, index);
      [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
    }
    return shuffled;
  }

  trace(entry: string): void {
    const canonical = entry.replaceAll(/\s+/gu, " ").trim().slice(0, 240);
    if (!canonical) return;
    if (this.entries.length < TRACE_LIMIT) {
      this.entries.push(canonical);
    } else {
      this.omittedEntries += 1;
    }
  }

  failureTrace(): string {
    const lines = this.entries.map(
      (entry, index) => `${String(index + 1).padStart(2, "0")}. ${entry}`
    );
    if (this.omittedEntries > 0) {
      lines.push(`… ${this.omittedEntries} additional bounded steps omitted`);
    }
    return [
      `F-754 seed=0x${this.seed.toString(16).padStart(8, "0")} (${this.seed})`,
      ...lines,
    ].join("\n");
  }
}

export async function withF754FailureTrace(
  random: F754SeededRandom,
  run: () => void | Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\n${random.failureTrace()}`, { cause: error });
  }
}

export function setDeterministicStudioCrdtClientId(
  document: StudioCrdtDocument,
  clientId: number
): void {
  if (!Number.isSafeInteger(clientId) || clientId <= 0 || clientId > 0xffff_ffff) {
    throw new Error("F-754 Yjs client id is outside the uint32 range");
  }
  const yDocument = (document as unknown as { doc: Y.Doc }).doc;
  (yDocument as unknown as { clientID: number }).clientID = clientId;
}

export function canonicalStudioCrdtProjection(document: StudioCrdtDocument): string {
  return JSON.stringify({
    stateVector: Array.from(document.encodeStateVector()),
    strokes: document.getStrokes({ includeDeleted: true }).map((stroke) => ({
      id: stroke.id,
      pageId: stroke.pageId,
      layerId: stroke.layerId,
      status: stroke.status,
      deleted: stroke.deleted,
      payload: stroke.payload,
      orderIndex: stroke.orderIndex,
    })),
  });
}

export async function settleF754Microtasks(iterations = 12): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
