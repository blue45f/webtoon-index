import { isStudioEditorMutationContinuationAllowed } from "../studio-editor-scope";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS,
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS,
  isStudioLayerLiftTrustedArtifactPair,
  verifyStudioLayerLiftArtifactPairReceipt,
} from "./studio-layer-lift-artifact";
import { isTrustedStudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";
import { isStudioSceneLayerLiftTrustedSuccess } from "./studio-layer-lift-contract";
import { isStudioLayerLiftSourceCurrent } from "./studio-layer-lift-plan";

import type { StudioEditorMutationState, StudioEditorMutationTicket } from "../studio-editor-scope";
import type { El } from "../studio-element-model";
import type {
  StudioLayerLiftArtifactPairReceipt,
  StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import type { StudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";
import type {
  StudioSceneLayerLiftResult,
  StudioSceneLayerLiftSuccess,
} from "./studio-layer-lift-contract";
import type { LayerGroup } from "../studio-layers";

const MAXIMUM_OPERATION_EPOCH = 0x7fff_ffff;
const MAXIMUM_AUTHORITY_ID_LENGTH = 160;
const SOURCE_FINGERPRINT_PATTERN =
  /^studio-layer-lift-source-v1:[0-9a-f]{16}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type StudioLayerLiftOperationPersistenceScope =
  | "local-unsaved"
  | "saved-work";

export interface StudioLayerLiftOperationSourceBinding {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceFingerprint: string;
  readonly sourceSha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
}

export interface BeginStudioLayerLiftOperationInput {
  readonly mutationTicket: StudioEditorMutationTicket;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly selectedIds: readonly string[];
  readonly source: StudioLayerLiftOperationSourceBinding;
}

export interface StudioLayerLiftOperationTicket
  extends BeginStudioLayerLiftOperationInput {
  readonly operationEpoch: number;
  readonly persistenceScope: StudioLayerLiftOperationPersistenceScope;
  readonly signal: AbortSignal;
}

export interface StudioLayerLiftOperationCurrentState {
  readonly mutationState: StudioEditorMutationState;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly selectedIds: readonly string[];
  readonly elements: readonly El[];
  readonly groups: readonly LayerGroup[];
}

export type StudioLayerLiftOperationStaleReason =
  | "aborted"
  | "foreign-ticket"
  | "stale-document"
  | "stale-page"
  | "stale-edit-surface"
  | "stale-selection"
  | "stale-source";

export type StudioLayerLiftOperationCurrentResult =
  | Readonly<{ readonly ok: true }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioLayerLiftOperationStaleReason;
    }>;

export interface StudioLayerLiftFinalAdmissionBinding {
  readonly operationEpoch: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly persistenceScope: StudioLayerLiftOperationPersistenceScope;
  readonly mutationTicket: StudioEditorMutationTicket;
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceFingerprint: string;
  readonly sourceSha256: `sha256:${string}`;
  readonly providerReceiptSha256: `sha256:${string}`;
  readonly compositionReceiptSha256: `sha256:${string}`;
  readonly artifactReceiptSha256: `sha256:${string}`;
  readonly background: Readonly<{
    readonly outputId: string;
    readonly sha256: `sha256:${string}`;
  }>;
  readonly foreground: Readonly<{
    readonly outputId: string;
    readonly sha256: `sha256:${string}`;
  }>;
}

export type StudioLayerLiftFinalAdmissionFailureReason =
  | StudioLayerLiftOperationStaleReason
  | "admission-in-progress"
  | "provider-failed"
  | "provider-mismatch"
  | "composition-mismatch"
  | "artifact-mismatch";

export type StudioLayerLiftFinalAdmissionResult =
  | Readonly<{
      readonly ok: true;
      readonly binding: StudioLayerLiftFinalAdmissionBinding;
      /**
       * Fresh byte snapshots re-verified immediately before this one-shot admission was consumed.
       * Product integration must use these buffers instead of the caller-owned input buffers.
       */
      readonly artifacts: StudioLayerLiftTrustedArtifactPair;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: StudioLayerLiftFinalAdmissionFailureReason;
    }>;

export interface StudioLayerLiftFinalAdmissionInput {
  readonly ticket: StudioLayerLiftOperationTicket;
  /**
   * Must read the editor's latest refs. It is invoked once before byte verification and again
   * after the asynchronous digest so immutable React state snapshots cannot hide a stale edit.
   */
  readonly readCurrent: () => StudioLayerLiftOperationCurrentState;
  readonly providerResult: StudioSceneLayerLiftResult;
  readonly artifacts: StudioLayerLiftTrustedArtifactPair;
  readonly compositionReceipt: StudioLayerLiftCompositionReceipt;
}

function hasAuthorityControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function validAuthorityId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= MAXIMUM_AUTHORITY_ID_LENGTH
    && value === value.normalize("NFC")
    && value.trim() === value
    && !hasAuthorityControlCharacter(value)
    && !value.includes("/")
    && !value.includes("\\")
    && value !== "."
    && value !== ".."
  );
}

function validDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validateBeginInput(input: BeginStudioLayerLiftOperationInput): void {
  const { source } = input;
  if (
    !validAuthorityId(input.pageId)
    || !validAuthorityId(source.requestId)
    || !validAuthorityId(source.sourceId)
    || !validAuthorityId(source.backgroundOutputId)
    || !validAuthorityId(source.foregroundOutputId)
    || source.backgroundOutputId === source.foregroundOutputId
    || !SOURCE_FINGERPRINT_PATTERN.test(source.sourceFingerprint)
    || !SHA256_PATTERN.test(source.sourceSha256)
    || !validDimension(source.width)
    || !validDimension(source.height)
    || source.width > STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS
    || source.height > STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS
    || source.width * source.height > STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS
    || input.selectedIds.length !== 1
    || input.selectedIds[0] !== source.sourceId
  ) {
    throw new TypeError("Invalid Scene Layer Lift operation authority.");
  }
}

function sameExactSelection(
  expected: readonly string[],
  current: readonly string[],
): boolean {
  return (
    expected.length === current.length
    && expected.every((id, index) => id === current[index])
  );
}

function finalFailure(
  reason: StudioLayerLiftFinalAdmissionFailureReason,
): Readonly<{ readonly ok: false; readonly reason: StudioLayerLiftFinalAdmissionFailureReason }> {
  return Object.freeze({ ok: false, reason });
}

function digestBytesWithWebCrypto(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<`sha256:${string}` | null> {
  const withPrefix = (hex: string): `sha256:${string}` => `sha256:${hex}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return Promise.resolve(withPrefix(sha256HexPortable(bytes)));
  }
  return subtle.digest("SHA-256", bytes).then((digest) => {
    const hex = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return withPrefix(hex);
  }, () => null);
}

/**
 * Provider parsing snapshots every plane into a fixed ArrayBuffer, but Uint8Array elements remain
 * mutable. Queue every native digest in one JavaScript turn, then compare the bytes that are still
 * present at final admission with their provider-bound receipts.
 */
async function doTrustedProviderPlanesMatchReceipts(
  result: StudioSceneLayerLiftSuccess,
): Promise<boolean> {
  const expected: Array<`sha256:${string}`> = [];
  const digests: Array<Promise<`sha256:${string}` | null>> = [];
  for (const layer of result.layers) {
    expected.push(layer.rgba.sha256, layer.mask.sha256);
    digests.push(
      digestBytesWithWebCrypto(layer.rgba.bytes),
      digestBytesWithWebCrypto(layer.mask.bytes),
    );
  }
  const actual = await Promise.all(digests);
  return (
    actual.length === expected.length
    && actual.every((digest, index) => digest === expected[index])
  );
}

/**
 * Owns one capacity-one Scene Layer Lift operation for an editor instance.
 *
 * Every new operation aborts the previous ticket. A result may mutate the document only when
 * the exact registry-owned ticket, document generation, page, edit surface, selection and source
 * fingerprint are still current. Saved/local persistence is derived from the mutation ticket's
 * real work scope instead of trusting a caller-provided string.
 */
export class StudioLayerLiftOperationRegistry {
  #epoch = 0;
  readonly #usedRequestIds = new Set<string>();
  readonly #finalAdmissions = new Set<StudioLayerLiftOperationTicket>();
  #active:
    | Readonly<{
        readonly ticket: StudioLayerLiftOperationTicket;
        readonly controller: AbortController;
      }>
    | null = null;

  get activeTicket(): StudioLayerLiftOperationTicket | null {
    return this.#active?.ticket ?? null;
  }

  begin(
    input: BeginStudioLayerLiftOperationInput,
  ): StudioLayerLiftOperationTicket {
    validateBeginInput(input);
    if (this.#usedRequestIds.has(input.source.requestId)) {
      throw new TypeError(
        "Scene Layer Lift request IDs cannot be reused in one editor registry.",
      );
    }
    this.invalidate();
    this.#usedRequestIds.add(input.source.requestId);
    this.#epoch =
      this.#epoch >= MAXIMUM_OPERATION_EPOCH ? 1 : this.#epoch + 1;
    const controller = new AbortController();
    const ticket: StudioLayerLiftOperationTicket = Object.freeze({
      ...input,
      mutationTicket: Object.freeze({ ...input.mutationTicket }),
      selectedIds: Object.freeze([...input.selectedIds]),
      source: Object.freeze({ ...input.source }),
      operationEpoch: this.#epoch,
      persistenceScope:
        input.mutationTicket.workId === null ? "local-unsaved" : "saved-work",
      signal: controller.signal,
    });
    this.#active = Object.freeze({ ticket, controller });
    return ticket;
  }

  checkCurrent(
    ticket: StudioLayerLiftOperationTicket,
    current: StudioLayerLiftOperationCurrentState,
  ): StudioLayerLiftOperationCurrentResult {
    if (this.#active?.ticket !== ticket) {
      return { ok: false, reason: "foreign-ticket" };
    }
    if (ticket.signal.aborted) {
      return { ok: false, reason: "aborted" };
    }
    if (
      !isStudioEditorMutationContinuationAllowed(
        ticket.mutationTicket,
        current.mutationState,
      )
    ) {
      return { ok: false, reason: "stale-document" };
    }
    if (ticket.pageId !== current.pageId) {
      return { ok: false, reason: "stale-page" };
    }
    if (ticket.masterEditMode !== current.masterEditMode) {
      return { ok: false, reason: "stale-edit-surface" };
    }
    if (!sameExactSelection(ticket.selectedIds, current.selectedIds)) {
      return { ok: false, reason: "stale-selection" };
    }
    if (
      !isStudioLayerLiftSourceCurrent(ticket.source.sourceFingerprint, {
        elements: current.elements,
        groups: current.groups,
        sourceId: ticket.source.sourceId,
      })
    ) {
      return { ok: false, reason: "stale-source" };
    }
    return { ok: true };
  }

  /**
   * One-shot final commit gate. It snapshots and re-hashes the mutable PNG buffers, re-checks the
   * editor authority after the asynchronous digest, then consumes the ticket. Product integration
   * must use the returned artifact snapshots immediately in its document transaction.
   */
  async admitFinal(
    input: StudioLayerLiftFinalAdmissionInput,
  ): Promise<StudioLayerLiftFinalAdmissionResult> {
    if (this.#active?.ticket !== input.ticket) {
      return finalFailure("foreign-ticket");
    }
    if (this.#finalAdmissions.has(input.ticket)) {
      return finalFailure("admission-in-progress");
    }
    this.#finalAdmissions.add(input.ticket);
    try {
      return await this.#admitFinalWithLease(input);
    } finally {
      this.#finalAdmissions.delete(input.ticket);
    }
  }

  async #admitFinalWithLease(
    input: StudioLayerLiftFinalAdmissionInput,
  ): Promise<StudioLayerLiftFinalAdmissionResult> {
    let initialState: StudioLayerLiftOperationCurrentState;
    try {
      initialState = input.readCurrent();
    } catch {
      return finalFailure("stale-document");
    }
    const current = this.checkCurrent(input.ticket, initialState);
    if (!current.ok) return finalFailure(current.reason);
    if (input.providerResult.status !== "success") {
      return finalFailure("provider-failed");
    }
    if (
      !isStudioSceneLayerLiftTrustedSuccess(input.providerResult)
      || !doesStudioSceneLayerLiftResultMatchOperation(
        input.ticket,
        input.providerResult,
      )
    ) {
      return finalFailure("provider-mismatch");
    }
    if (
      !isStudioLayerLiftTrustedArtifactPair(input.artifacts)
      || !doesStudioLayerLiftArtifactReceiptMatchOperation(
        input.ticket,
        input.artifacts.receipt,
      )
      || !doesTrustedArtifactPairMatchReceipt(input.artifacts)
    ) {
      return finalFailure("artifact-mismatch");
    }
    if (
      !isTrustedStudioLayerLiftCompositionReceipt(input.compositionReceipt)
      || !doesStudioLayerLiftCompositionReceiptMatchOperation({
        ticket: input.ticket,
        providerResult: input.providerResult,
        artifacts: input.artifacts,
        compositionReceipt: input.compositionReceipt,
      })
    ) {
      return finalFailure("composition-mismatch");
    }
    if (!(await doTrustedProviderPlanesMatchReceipts(input.providerResult))) {
      return finalFailure("provider-mismatch");
    }

    let verifiedArtifacts: StudioLayerLiftTrustedArtifactPair;
    try {
      verifiedArtifacts = await verifyStudioLayerLiftArtifactPairReceipt({
        requestId: input.ticket.source.requestId,
        sourceId: input.ticket.source.sourceId,
        sourceWidth: input.ticket.source.width,
        sourceHeight: input.ticket.source.height,
        backgroundOutputId: input.ticket.source.backgroundOutputId,
        foregroundOutputId: input.ticket.source.foregroundOutputId,
        receipt: input.artifacts.receipt,
        backgroundBytes: input.artifacts.background.bytes,
        foregroundBytes: input.artifacts.foreground.bytes,
      });
    } catch {
      return finalFailure("artifact-mismatch");
    }

    let stateAfterVerification: StudioLayerLiftOperationCurrentState;
    try {
      stateAfterVerification = input.readCurrent();
    } catch {
      return finalFailure("stale-document");
    }
    const currentAfterVerification = this.checkCurrent(
      input.ticket,
      stateAfterVerification,
    );
    if (!currentAfterVerification.ok) {
      return finalFailure(currentAfterVerification.reason);
    }
    if (!this.finish(input.ticket)) {
      return finalFailure("foreign-ticket");
    }

    const binding: StudioLayerLiftFinalAdmissionBinding = Object.freeze({
      operationEpoch: input.ticket.operationEpoch,
      pageId: input.ticket.pageId,
      masterEditMode: input.ticket.masterEditMode,
      persistenceScope: input.ticket.persistenceScope,
      mutationTicket: input.ticket.mutationTicket,
      requestId: input.ticket.source.requestId,
      sourceId: input.ticket.source.sourceId,
      sourceFingerprint: input.ticket.source.sourceFingerprint,
      sourceSha256: input.ticket.source.sourceSha256,
      providerReceiptSha256: input.providerResult.receipt.receiptSha256,
      compositionReceiptSha256: input.compositionReceipt.receiptSha256,
      artifactReceiptSha256: verifiedArtifacts.receipt.receiptSha256,
      background: Object.freeze({
        outputId: verifiedArtifacts.background.outputId,
        sha256: verifiedArtifacts.background.sha256,
      }),
      foreground: Object.freeze({
        outputId: verifiedArtifacts.foreground.outputId,
        sha256: verifiedArtifacts.foreground.sha256,
      }),
    });
    return Object.freeze({
      ok: true,
      binding,
      artifacts: verifiedArtifacts,
    });
  }

  finish(ticket: StudioLayerLiftOperationTicket): boolean {
    if (this.#active?.ticket !== ticket) return false;
    this.#active = null;
    return true;
  }

  invalidate(ticket?: StudioLayerLiftOperationTicket): boolean {
    const active = this.#active;
    if (!active || (ticket !== undefined && active.ticket !== ticket)) {
      return false;
    }
    this.#active = null;
    active.controller.abort();
    return true;
  }
}

/**
 * The artifact validator already authenticates PNG bytes and re-hashes its receipt. This final
 * binding prevents a valid pair from another request/source/output allocation being committed by
 * an otherwise current editor operation.
 */
export function doesStudioLayerLiftArtifactReceiptMatchOperation(
  ticket: StudioLayerLiftOperationTicket,
  receipt: StudioLayerLiftArtifactPairReceipt,
): boolean {
  return (
    receipt.requestId === ticket.source.requestId
    && receipt.sourceId === ticket.source.sourceId
    && receipt.sourceWidth === ticket.source.width
    && receipt.sourceHeight === ticket.source.height
    && receipt.background.outputId === ticket.source.backgroundOutputId
    && receipt.foreground.outputId === ticket.source.foregroundOutputId
  );
}

function doesTrustedArtifactPairMatchReceipt(
  artifacts: StudioLayerLiftTrustedArtifactPair,
): boolean {
  return (
    artifacts.background.outputId === artifacts.receipt.background.outputId
    && artifacts.background.width === artifacts.receipt.background.width
    && artifacts.background.height === artifacts.receipt.background.height
    && artifacts.background.pixelCount === artifacts.receipt.background.pixelCount
    && artifacts.background.byteLength === artifacts.receipt.background.byteLength
    && artifacts.background.decodedByteLength
      === artifacts.receipt.background.decodedByteLength
    && artifacts.background.sha256 === artifacts.receipt.background.sha256
    && artifacts.background.bytes.byteLength
      === artifacts.receipt.background.byteLength
    && artifacts.foreground.outputId === artifacts.receipt.foreground.outputId
    && artifacts.foreground.width === artifacts.receipt.foreground.width
    && artifacts.foreground.height === artifacts.receipt.foreground.height
    && artifacts.foreground.pixelCount === artifacts.receipt.foreground.pixelCount
    && artifacts.foreground.byteLength === artifacts.receipt.foreground.byteLength
    && artifacts.foreground.decodedByteLength
      === artifacts.receipt.foreground.decodedByteLength
    && artifacts.foreground.sha256 === artifacts.receipt.foreground.sha256
    && artifacts.foreground.bytes.byteLength
      === artifacts.receipt.foreground.byteLength
  );
}

/**
 * Binds the semantic provider result to the normalized source snapshot that launched the
 * operation. This check is separate from the PNG artifact pair because a provider result may be
 * rejected before output images are encoded.
 */
export function doesStudioSceneLayerLiftResultMatchOperation(
  ticket: StudioLayerLiftOperationTicket,
  result: StudioSceneLayerLiftSuccess,
): boolean {
  return (
    result.requestId === ticket.source.requestId
    && result.source.sourceId === ticket.source.sourceId
    && result.source.width === ticket.source.width
    && result.source.height === ticket.source.height
    && result.source.sha256 === ticket.source.sourceSha256
    && result.receipt.requestId === ticket.source.requestId
    && result.receipt.sourceSha256 === ticket.source.sourceSha256
  );
}

export function doesStudioLayerLiftCompositionReceiptMatchOperation(input: {
  readonly ticket: StudioLayerLiftOperationTicket;
  readonly providerResult: StudioSceneLayerLiftSuccess;
  readonly artifacts: StudioLayerLiftTrustedArtifactPair;
  readonly compositionReceipt: StudioLayerLiftCompositionReceipt;
}): boolean {
  const {
    ticket,
    providerResult,
    artifacts,
    compositionReceipt,
  } = input;
  return (
    compositionReceipt.requestId === ticket.source.requestId
    && compositionReceipt.sourceSha256 === ticket.source.sourceSha256
    && compositionReceipt.providerReceiptSha256
      === providerResult.receipt.receiptSha256
    && compositionReceipt.providerLayers.length === providerResult.layers.length
    && compositionReceipt.providerLayers.every((layer, index) => {
      const providerLayer = providerResult.layers[index];
      return (
        providerLayer !== undefined
        && layer.layerId === providerLayer.layerId
        && layer.role === providerLayer.role
        && layer.order === providerLayer.order
        && layer.rgba.sha256 === providerLayer.rgba.sha256
        && layer.mask.sha256 === providerLayer.mask.sha256
      );
    })
    && compositionReceipt.background.outputId
      === ticket.source.backgroundOutputId
    && compositionReceipt.background.outputId
      === artifacts.background.outputId
    && compositionReceipt.background.artifactSha256
      === artifacts.background.sha256
    && compositionReceipt.foreground.outputId
      === ticket.source.foregroundOutputId
    && compositionReceipt.foreground.outputId
      === artifacts.foreground.outputId
    && compositionReceipt.foreground.artifactSha256
      === artifacts.foreground.sha256
  );
}
