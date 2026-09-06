import {
  createStudioHokusaiLiveDocumentReceipt,
} from "./studio-hokusai-live-brush-document-receipt";
import { studioHokusaiSourceRevision } from "./studio-hokusai-natural-media-contract";

import type { DrawEl, El, ImageEl } from "../studio-element-model";
import type { StudioHokusaiLiveCanonicalResult } from "./studio-hokusai-live-brush-runtime";

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INPUT_CHUNK_BYTES = 48 * 1_024;
const MAX_PNG_BYTES = 64 * 1_024 * 1_024;

export type StudioHokusaiLiveTransactionFailureCode =
  | "canonical-result-invalid"
  | "duplicate-image-id"
  | "invalid-image-id"
  | "source-changed"
  | "source-locked"
  | "source-unavailable";

export interface StudioHokusaiLiveCanonicalTransaction {
  readonly kind: "studio-hokusai-live/canonical-transaction";
  readonly version: 1;
  readonly historyLabel: "Hokusai 자연매체 획";
  readonly historyEntryCount: 1;
  readonly hiddenSourceId: string;
  readonly canonicalImageId: string;
  readonly selectionId: string;
  /** Commit this immutable array exactly once at the Studio history/CRDT boundary. */
  readonly nextElements: readonly El[];
}

export type StudioHokusaiLiveCanonicalTransactionResult =
  | Readonly<{
      ok: true;
      transaction: StudioHokusaiLiveCanonicalTransaction;
    }>
  | Readonly<{
      ok: false;
      code: StudioHokusaiLiveTransactionFailureCode;
      message: string;
    }>;

function failure(
  code: StudioHokusaiLiveTransactionFailureCode,
  message: string,
): StudioHokusaiLiveCanonicalTransactionResult {
  return Object.freeze({ ok: false, code, message });
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function samePlacement(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let chunkStart = 0; chunkStart < bytes.byteLength; chunkStart += BASE64_INPUT_CHUNK_BYTES) {
    const chunkEnd = Math.min(bytes.byteLength, chunkStart + BASE64_INPUT_CHUNK_BYTES);
    let encoded = "";
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index]!;
      const hasSecond = index + 1 < bytes.byteLength;
      const hasThird = index + 2 < bytes.byteLength;
      const second = hasSecond ? bytes[index + 1]! : 0;
      const third = hasThird ? bytes[index + 2]! : 0;
      encoded += BASE64_ALPHABET[first >> 2];
      encoded += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)];
      encoded += hasSecond
        ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)]
        : "=";
      encoded += hasThird ? BASE64_ALPHABET[third & 63] : "=";
    }
    chunks.push(encoded);
  }
  return chunks.join("");
}

export function studioHokusaiLiveCanonicalPngDataUrl(
  pngBytes: ArrayBuffer,
): `data:image/png;base64,${string}` | null {
  if (pngBytes.byteLength < PNG_SIGNATURE.length || pngBytes.byteLength > MAX_PNG_BYTES) {
    return null;
  }
  const bytes = new Uint8Array(pngBytes);
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  return `data:image/png;base64,${encodeBase64(bytes)}`;
}

/**
 * Builds the hidden-vector + canonical-PNG replacement as one immutable history payload.
 * No element is mutated in place, so callers cannot accidentally create two undo entries.
 */
export function createStudioHokusaiLiveCanonicalTransaction(input: Readonly<{
  elements: readonly El[];
  sourceElementId: string;
  /** Optimistic-concurrency revision captured when the authoritative live stroke was finalized. */
  expectedSourceRevision: `hokusai-source-v1:${string}`;
  canonicalImageId: string;
  result: StudioHokusaiLiveCanonicalResult;
  mutationLocked?: boolean;
}>): StudioHokusaiLiveCanonicalTransactionResult {
  const sourceIndex = input.elements.findIndex(({ id }) => id === input.sourceElementId);
  const source = sourceIndex >= 0 ? input.elements[sourceIndex] : null;
  if (
    !source
    || source.type !== "draw"
    || source.hidden === true
    || source.mode === "eraser"
    || (source.kind ?? "freehand") !== "freehand"
    // A deliberate tap is one contact sample, and the hidden restore vector for it is a single
    // point that Studio already renders as a dot. Demanding two samples here rejected every
    // natural-media tap after the engine had legitimately composed its mark.
    || source.points.length < 2
    || source.points.length % 2 !== 0
  ) {
    return failure(
      "source-unavailable",
      "Hokusai 획의 복원 가능한 원본 자유곡선을 찾지 못했습니다.",
    );
  }
  if (input.mutationLocked || source.locked) {
    return failure("source-locked", "잠긴 획에는 Hokusai 결과를 적용할 수 없습니다.");
  }
  if (typeof input.canonicalImageId !== "string" || input.canonicalImageId.length === 0) {
    return failure("invalid-image-id", "Hokusai PNG 레이어 ID가 올바르지 않습니다.");
  }
  if (input.elements.some(({ id }) => id === input.canonicalImageId)) {
    return failure("duplicate-image-id", "Hokusai PNG 레이어 ID가 기존 요소와 겹칩니다.");
  }

  const sourceRevision = studioHokusaiSourceRevision(source);
  if (sourceRevision !== input.expectedSourceRevision) {
    return failure(
      "source-changed",
      "Hokusai 처리 뒤 원본 획이 바뀌어 이전 결과를 적용하지 않았습니다.",
    );
  }

  const { finalFrame, receipt } = input.result;
  const placement = finalFrame.logicalPlacement;
  const segment = receipt.segments.length === 1 ? receipt.segments[0] : null;
  const expectedPixelBytes = placement.width * placement.height * 4;
  const pngSrc = studioHokusaiLiveCanonicalPngDataUrl(input.result.pngBytes);
  if (
    receipt.strokeId !== source.id
    || receipt.sampleCount !== source.points.length / 2
    || receipt.segmentCount !== 1
    || !segment
    || segment.segmentIndex !== finalFrame.segmentIndex
    || !samePlacement(segment.logicalPlacement, placement)
    || segment.pixelHash !== finalFrame.pixelHash
    || receipt.settledPixelHash !== finalFrame.pixelHash
    || receipt.lastLivePixelHash !== finalFrame.pixelHash
    || receipt.exactLiveCommitParity !== true
    || !finitePositive(placement.width)
    || !finitePositive(placement.height)
    || !Number.isSafeInteger(placement.width)
    || !Number.isSafeInteger(placement.height)
    || finalFrame.pixels.byteLength !== expectedPixelBytes
    || !pngSrc
  ) {
    return failure(
      "canonical-result-invalid",
      "Hokusai live/commit 패리티 또는 canonical PNG 영수증이 올바르지 않습니다.",
    );
  }

  const documentReceipt = createStudioHokusaiLiveDocumentReceipt({
    sourceElementId: source.id,
    sourceRevision,
    canonical: receipt,
  });
  if (!documentReceipt) {
    return failure(
      "canonical-result-invalid",
      "Hokusai 저장 영수증을 문서 형식으로 정규화하지 못했습니다.",
    );
  }

  const hiddenSource: DrawEl = Object.freeze({
    ...source,
    hidden: true,
    name: `${source.name ?? source.brush ?? "선화"} · Hokusai 복원 원본`,
  });
  const canonicalImage: ImageEl & Pick<
    El,
    | "alphaLocked"
    | "blendMode"
    | "clipBelow"
    | "groupId"
    | "layerColor"
    | "layerRole"
    | "lockAspect"
    | "name"
    | "noClip"
  > = Object.freeze({
    id: input.canonicalImageId,
    type: "image",
    src: pngSrc,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: 0,
    name: `${source.name ?? source.brush ?? "브러시"} · Hokusai`,
    lockAspect: true,
    hokusaiLiveReceipt: documentReceipt,
    ...(source.groupId ? { groupId: source.groupId } : {}),
    ...(source.noClip !== undefined ? { noClip: source.noClip } : {}),
    ...(source.blendMode ? { blendMode: source.blendMode } : {}),
    ...(source.clipBelow !== undefined ? { clipBelow: source.clipBelow } : {}),
    ...(source.alphaLocked !== undefined ? { alphaLocked: source.alphaLocked } : {}),
    ...(source.layerRole ? { layerRole: source.layerRole } : {}),
    ...(source.layerColor ? { layerColor: source.layerColor } : {}),
  });
  const nextElements = input.elements.slice();
  nextElements[sourceIndex] = hiddenSource;
  nextElements.splice(sourceIndex + 1, 0, canonicalImage);

  return Object.freeze({
    ok: true,
    transaction: Object.freeze({
      kind: "studio-hokusai-live/canonical-transaction",
      version: 1,
      historyLabel: "Hokusai 자연매체 획",
      historyEntryCount: 1,
      hiddenSourceId: source.id,
      canonicalImageId: canonicalImage.id,
      selectionId: canonicalImage.id,
      nextElements: Object.freeze(nextElements),
    }),
  });
}
