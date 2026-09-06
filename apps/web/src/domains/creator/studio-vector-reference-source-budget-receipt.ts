declare const studioVectorReferenceSourceBudgetReceiptBrand: unique symbol;

/**
 * Opaque proof that an exact element array was already JSON-serialized and UTF-8 measured under
 * an exact source budget. Runtime metadata lives in the private WeakMap, so callers cannot forge
 * a receipt by constructing a structurally similar object.
 */
export interface StudioVectorReferenceSourceBudgetReceipt {
  readonly [studioVectorReferenceSourceBudgetReceiptBrand]: true;
}

interface StudioVectorReferenceSourceBudgetReceiptMetadata {
  readonly elements: readonly unknown[];
  readonly elementSnapshot: readonly unknown[];
  readonly maxSourceBytes: number;
  readonly sourceByteLength: number;
}

const SOURCE_BUDGET_RECEIPTS = new WeakMap<
  StudioVectorReferenceSourceBudgetReceipt,
  StudioVectorReferenceSourceBudgetReceiptMetadata
>();
const UTF8_ENCODER = new TextEncoder();

export function createStudioVectorReferenceSourceBudgetReceipt(
  elements: readonly unknown[],
  maxSourceBytes: number,
): {
  readonly receipt: StudioVectorReferenceSourceBudgetReceipt;
  readonly sourceByteLength: number;
} {
  const serializedSource = JSON.stringify(elements);
  if (serializedSource === undefined) throw new TypeError("empty vector source budget receipt");
  const sourceByteLength = UTF8_ENCODER.encode(serializedSource).byteLength;
  if (
    !Number.isSafeInteger(maxSourceBytes)
    || maxSourceBytes <= 0
  ) {
    throw new RangeError("invalid vector source budget receipt");
  }
  const receipt = Object.freeze({}) as StudioVectorReferenceSourceBudgetReceipt;
  SOURCE_BUDGET_RECEIPTS.set(receipt, {
    elements,
    elementSnapshot: [...elements],
    maxSourceBytes,
    sourceByteLength,
  });
  queueMicrotask(() => SOURCE_BUDGET_RECEIPTS.delete(receipt));
  return { receipt, sourceByteLength };
}

/**
 * One-shot same-turn consumption. Product preparation reads before its first await; any delayed
 * wrapper or later mutation crosses the microtask expiry and falls back to canonical measurement.
 */
export function readStudioVectorReferenceSourceBudgetReceipt(
  receipt: StudioVectorReferenceSourceBudgetReceipt | undefined,
  elements: readonly unknown[],
  maxSourceBytes: number,
): number | null {
  if (!receipt) return null;
  const metadata = SOURCE_BUDGET_RECEIPTS.get(receipt);
  SOURCE_BUDGET_RECEIPTS.delete(receipt);
  if (
    !metadata
    || metadata.elements !== elements
    || metadata.maxSourceBytes !== maxSourceBytes
    || metadata.elementSnapshot.length !== elements.length
    || metadata.elementSnapshot.some((element, index) => element !== elements[index])
  ) return null;
  return metadata.sourceByteLength;
}
