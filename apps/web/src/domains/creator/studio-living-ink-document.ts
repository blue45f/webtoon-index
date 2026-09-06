import {
  STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
  STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
  type StudioLivingInkExecutionConfig,
  type StudioLivingInkExecutionReceipt,
} from "./studio-living-ink-execution-protocol";
import { sha256HexPortable } from "./studio-sha256";

import type { DrawEl, El, ImageEl } from "./studio-element-model";
import type { StudioLivingInkOperation } from "./studio-living-ink-field";

export const STUDIO_LIVING_INK_DOCUMENT_RECEIPT_VERSION = 1 as const;

/**
 * JSON-safe physical state stored beside the flattened Living Ink layer.
 *
 * The PNG remains the fail-visible authority when a browser cannot restore WebGL2. The operation
 * journal is deliberately separate: water/fix may be re-enabled only after the whole journal has
 * replayed in a compatible Worker and the last execution receipt has been accepted.
 */
export interface StudioLivingInkDocumentReceipt {
  readonly kind: "studio-living-ink/document-receipt";
  readonly version: typeof STUDIO_LIVING_INK_DOCUMENT_RECEIPT_VERSION;
  readonly protocolVersion: typeof STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION;
  readonly engineVersion: typeof STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION;
  readonly pageId: string;
  readonly routeKey: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly config: StudioLivingInkExecutionConfig;
  readonly journal: readonly StudioLivingInkOperation[];
  readonly sourceElementIds: readonly string[];
  readonly canonicalPngSha256: `sha256:${string}`;
  readonly finalExecutionReceipt: StudioLivingInkExecutionReceipt;
  readonly restorePolicy: "replay-or-flattened-raster-fail-closed";
  readonly fixedPigmentPolicy: "immutable";
  readonly historyEntryCount: 1;
}

export interface StudioLivingInkCanonicalResult {
  readonly src: `data:image/png;base64,${string}`;
  readonly pngSha256: `sha256:${string}`;
  readonly routeKey: string;
  readonly pageId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly config: StudioLivingInkExecutionConfig;
  readonly journal: readonly StudioLivingInkOperation[];
  readonly finalExecutionReceipt: StudioLivingInkExecutionReceipt;
}

export interface StudioLivingInkCanonicalTransaction {
  readonly kind: "studio-living-ink/canonical-transaction";
  readonly version: 1;
  /** Product-facing undo label (Korean “수채 번짐”, not internal Living Ink codename). */
  readonly historyLabel: "수채 번짐 물리 잉크";
  readonly historyEntryCount: 1;
  readonly canonicalImageId: string;
  readonly hiddenSourceId: string | null;
  readonly selectionId: string;
  readonly nextElements: readonly El[];
}

export type StudioLivingInkCanonicalTransactionResult =
  | Readonly<{ ok: true; transaction: StudioLivingInkCanonicalTransaction }>
  | Readonly<{
      ok: false;
      code:
        | "canonical-invalid"
        | "duplicate-image-id"
        | "source-locked"
        | "source-unavailable";
      message: string;
    }>;

export type StudioLivingInkCanonicalImageAuthorityResult =
  | Readonly<{
      ok: true;
      pngSha256: `sha256:${string}`;
      replayToken: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "geometry-mismatch"
        | "page-mismatch"
        | "png-invalid"
        | "png-sha256-mismatch"
        | "receipt-invalid";
      message: string;
    }>;

function failure(
  code: Exclude<StudioLivingInkCanonicalTransactionResult, { ok: true }>["code"],
  message: string,
): StudioLivingInkCanonicalTransactionResult {
  return Object.freeze({ ok: false, code, message });
}

function isSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function canonicalImageFailure(
  code: Exclude<StudioLivingInkCanonicalImageAuthorityResult, { ok: true }>["code"],
  message: string,
): StudioLivingInkCanonicalImageAuthorityResult {
  return Object.freeze({ ok: false, code, message });
}

function decodeCanonicalPngDataUrl(src: string): Uint8Array | null {
  const prefix = "data:image/png;base64,";
  if (!src.startsWith(prefix)) return null;
  try {
    const binary = globalThis.atob(src.slice(prefix.length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    // MIME labels are not authority. Refuse a payload that hashes correctly but is not a PNG.
    const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
    if (
      bytes.length < signature.length
      || signature.some((value, index) => bytes[index] !== value)
    ) return null;
    return bytes;
  } catch {
    return null;
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `sha256:${sha256HexPortable(bytes)}`;
  // WebCrypto may retain the input view until its asynchronous job completes. Copy only the
  // exact PNG byte range rather than accidentally hashing a larger pooled ArrayBuffer.
  const digest = await subtle.digest("SHA-256", Uint8Array.from(bytes));
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/**
 * Proves that a reopened page's flattened PNG and its physical replay receipt describe the same
 * canonical document layer. This must run before a Worker journal receives edit authority: the
 * raster remains fail-visible when any imported/local-storage field is corrupt.
 */
export async function verifyStudioLivingInkCanonicalImageAuthority(input: Readonly<{
  image: ImageEl;
  expectedPageId: string;
  signal?: AbortSignal;
}>): Promise<StudioLivingInkCanonicalImageAuthorityResult> {
  input.signal?.throwIfAborted();
  const receipt = input.image.livingInkReceipt;
  if (
    !receipt
    || receipt.kind !== "studio-living-ink/document-receipt"
    || receipt.version !== STUDIO_LIVING_INK_DOCUMENT_RECEIPT_VERSION
    || receipt.protocolVersion !== STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    || receipt.engineVersion !== STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION
    || receipt.finalExecutionReceipt.kind !== "studio-living-ink-execution-receipt"
    || receipt.finalExecutionReceipt.version !== STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    || receipt.finalExecutionReceipt.engineVersion !== STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION
    || receipt.finalExecutionReceipt.fixedPigmentPolicy !== "immutable"
    || !isSha256(receipt.canonicalPngSha256)
    || !isSha256(receipt.finalExecutionReceipt.displaySha256)
    || !isSha256(receipt.finalExecutionReceipt.operationSha256)
    || receipt.journal.length === 0
    || receipt.journal.length > 512
    || receipt.journal.some((operation, index) => operation.sequence !== index + 1)
  ) {
    return canonicalImageFailure(
      "receipt-invalid",
      "수채 번짐 물리 영수증 또는 operation journal이 손상되었습니다.",
    );
  }
  if (receipt.pageId !== input.expectedPageId) {
    return canonicalImageFailure(
      "page-mismatch",
      "수채 번짐 PNG 영수증이 현재 페이지를 가리키지 않습니다.",
    );
  }
  if (
    input.image.x !== 0
    || input.image.y !== 0
    || (input.image.rotation ?? 0) !== 0
    || input.image.width !== receipt.documentWidth
    || input.image.height !== receipt.documentHeight
  ) {
    return canonicalImageFailure(
      "geometry-mismatch",
      "수채 번짐 저장 PNG의 문서 좌표 또는 크기가 영수증과 다릅니다.",
    );
  }
  const bytes = decodeCanonicalPngDataUrl(input.image.src);
  if (!bytes) {
    return canonicalImageFailure(
      "png-invalid",
      "수채 번짐 저장 레이어가 실제 PNG 바이트가 아닙니다.",
    );
  }
  const actual = await sha256Bytes(bytes);
  input.signal?.throwIfAborted();
  if (actual !== receipt.canonicalPngSha256) {
    return canonicalImageFailure(
      "png-sha256-mismatch",
      "수채 번짐 저장 PNG의 실제 바이트 SHA-256이 저장 영수증과 다릅니다.",
    );
  }
  return Object.freeze({
    ok: true,
    pngSha256: actual,
    replayToken: studioLivingInkReceiptReplayToken(receipt),
  });
}

function isLivingInkImage(element: El): element is El & ImageEl {
  return element.type === "image"
    && element.livingInkReceipt?.kind === "studio-living-ink/document-receipt";
}

function snapshotJournal(
  journal: readonly StudioLivingInkOperation[],
): readonly StudioLivingInkOperation[] {
  // structuredClone is intentional here: selection coverage arrays must be frozen at the action
  // boundary instead of retaining a mutable quick-mask buffer owned by the selection UI.
  return Object.freeze(structuredClone(journal));
}

export function createStudioLivingInkDocumentReceipt(input: Readonly<{
  result: StudioLivingInkCanonicalResult;
  sourceElementIds: readonly string[];
}>): StudioLivingInkDocumentReceipt | null {
  const { result } = input;
  if (
    !result.pageId
    || !result.routeKey
    || !finitePositiveInteger(result.documentWidth)
    || !finitePositiveInteger(result.documentHeight)
    || !isSha256(result.pngSha256)
    || result.finalExecutionReceipt.kind !== "studio-living-ink-execution-receipt"
    || result.finalExecutionReceipt.version !== STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    || result.finalExecutionReceipt.engineVersion !== STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION
    || result.finalExecutionReceipt.fixedPigmentPolicy !== "immutable"
    || result.journal.length === 0
    || result.journal.length > 512
  ) return null;

  const journal = snapshotJournal(result.journal);
  const sourceElementIds = Object.freeze([
    ...new Set(input.sourceElementIds.filter((id) => typeof id === "string" && id.length > 0)),
  ]);
  return Object.freeze({
    kind: "studio-living-ink/document-receipt",
    version: STUDIO_LIVING_INK_DOCUMENT_RECEIPT_VERSION,
    protocolVersion: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
    engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
    pageId: result.pageId,
    routeKey: result.routeKey,
    documentWidth: result.documentWidth,
    documentHeight: result.documentHeight,
    config: Object.freeze(structuredClone(result.config)),
    journal,
    sourceElementIds,
    canonicalPngSha256: result.pngSha256,
    finalExecutionReceipt: Object.freeze(structuredClone(result.finalExecutionReceipt)),
    restorePolicy: "replay-or-flattened-raster-fail-closed",
    fixedPigmentPolicy: "immutable",
    historyEntryCount: 1,
  });
}

/**
 * Replaces one page-owned physical layer and optionally hides the just-authored recoverable DrawEl
 * in the same immutable history payload. Existing Living Ink layers are updated in place so each
 * stroke does not stack another opaque paper rectangle over the document.
 */
export function createStudioLivingInkCanonicalTransaction(input: Readonly<{
  elements: readonly El[];
  sourceElementId?: string | null;
  canonicalImageId: string;
  result: StudioLivingInkCanonicalResult;
  mutationLocked?: boolean;
}>): StudioLivingInkCanonicalTransactionResult {
  const sourceIndex = input.sourceElementId
    ? input.elements.findIndex(({ id }) => id === input.sourceElementId)
    : -1;
  const source = sourceIndex >= 0 ? input.elements[sourceIndex] : null;
  const drawSource = source?.type === "draw" ? source as DrawEl : null;
  if (input.sourceElementId && (!drawSource || drawSource.hidden === true)) {
    return failure("source-unavailable", "수채 번짐의 복원 가능한 원본 자유곡선을 찾지 못했습니다.");
  }
  if (drawSource && (input.mutationLocked || drawSource.locked)) {
    return failure("source-locked", "잠긴 획에는 수채 번짐 결과를 적용할 수 없습니다.");
  }

  const existingImageIndex = input.elements.findIndex((element) =>
    isLivingInkImage(element) && element.livingInkReceipt?.pageId === input.result.pageId
  );
  if (
    existingImageIndex < 0
    && input.elements.some(({ id }) => id === input.canonicalImageId)
  ) {
    return failure("duplicate-image-id", "수채 번짐 PNG 레이어 ID가 기존 요소와 겹칩니다.");
  }

  const previousReceipt = existingImageIndex >= 0
    ? (input.elements[existingImageIndex] as ImageEl).livingInkReceipt
    : null;
  const receipt = createStudioLivingInkDocumentReceipt({
    result: input.result,
    sourceElementIds: [
      ...(previousReceipt?.sourceElementIds ?? []),
      ...(drawSource ? [drawSource.id] : []),
    ],
  });
  if (!receipt || !input.result.src.startsWith("data:image/png;base64,")) {
    return failure("canonical-invalid", "수채 번짐 물리 상태 또는 저장 PNG 영수증이 올바르지 않습니다.");
  }

  const next = input.elements.slice();
  if (drawSource) {
    const hiddenSource: DrawEl = Object.freeze({
      ...drawSource,
      hidden: true,
      name: `${drawSource.name ?? drawSource.brushCatalogName ?? drawSource.brush ?? "선화"} · 수채 번짐 복원 원본`,
    });
    next[sourceIndex] = hiddenSource;
  }

  const existingImage = existingImageIndex >= 0
    ? next[existingImageIndex] as El & ImageEl
    : null;
  const canonicalImage: El & ImageEl = Object.freeze({
    ...(existingImage ?? {}),
    id: existingImage?.id ?? input.canonicalImageId,
    type: "image",
    src: input.result.src,
    x: 0,
    y: 0,
    width: input.result.documentWidth,
    height: input.result.documentHeight,
    rotation: 0,
    name: "수채 번짐 · 물리 잉크/물/정착",
    lockAspect: true,
    blendMode: "multiply",
    livingInkReceipt: receipt,
  });

  if (existingImageIndex >= 0) {
    next[existingImageIndex] = canonicalImage;
  } else {
    const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : next.length;
    next.splice(insertIndex, 0, canonicalImage);
  }

  return Object.freeze({
    ok: true,
    transaction: Object.freeze({
      kind: "studio-living-ink/canonical-transaction",
      version: 1,
      historyLabel: "수채 번짐 물리 잉크",
      historyEntryCount: 1,
      canonicalImageId: canonicalImage.id,
      hiddenSourceId: drawSource?.id ?? null,
      selectionId: canonicalImage.id,
      nextElements: Object.freeze(next),
    }),
  });
}

export function studioLivingInkReceiptReplayToken(
  receipt: StudioLivingInkDocumentReceipt | null | undefined,
): string {
  return receipt
    ? [
        receipt.pageId,
        receipt.engineVersion,
        receipt.canonicalPngSha256,
        receipt.finalExecutionReceipt.operationSha256,
        receipt.finalExecutionReceipt.displaySha256,
        receipt.journal.length,
        JSON.stringify(receipt.config),
      ].join(":")
    : "living-ink:none";
}
