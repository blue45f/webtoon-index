/**
 * Atomic multi-cell coupling between a bristle footprint, the two-well mixer state and the
 * deterministic wet-media field.
 *
 * A real tuft touches many cells at one station. Advancing the one-cell bridge repeatedly would
 * clone and validate the complete field for every bristle contact and could leave callers tempted
 * to publish a partial prefix. This boundary samples one immutable field snapshot, advances only
 * the small brush-side state in deterministic cell order, batches all signed canvas transfers, and
 * applies them to the field exactly once. Any failure returns no advanced state.
 */

import {
  applyStudioWetMediaTileFieldDepositions,
  parseStudioWetMediaTileFieldSettings,
  parseStudioWetMediaTileFieldState,
  STUDIO_WET_MEDIA_TILE_FIELD_LIMITS,
  STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
  type StudioWetMediaLinearRgba,
  type StudioWetMediaTileFieldDeposition,
  type StudioWetMediaTileFieldDepositionReceipt,
  type StudioWetMediaTileFieldFailureReason,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./studio-wet-media-tile-field";
import {
  sampleStudioWetMediaTileFieldCell,
} from "./studio-wet-media-two-well-field-bridge";
import {
  advanceStudioWetMediaTwoWellContact,
  parseStudioWetMediaTwoWellSettings,
  parseStudioWetMediaTwoWellState,
  STUDIO_WET_MEDIA_TWO_WELL_LIMITS,
  STUDIO_WET_MEDIA_TWO_WELL_VERSION,
  type StudioWetMediaCanvasSample,
  type StudioWetMediaContactResult,
  type StudioWetMediaTwoWellFailureReason,
  type StudioWetMediaTwoWellSettings,
  type StudioWetMediaTwoWellState,
} from "./studio-wet-media-two-well-model";

export const STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_BRIDGE_VERSION = 1 as const;
export const STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_MAX_CELLS = Math.floor(
  STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxDepositionOperations / 2,
);

export interface StudioWetMediaBristleFootprintCell {
  readonly cellIndex: number;
  /** Relative contact area. Positive values are normalized across the footprint. */
  readonly coverage: number;
}

export interface StudioWetMediaBristleFootprintContact {
  readonly kind: "studio-wet-media-bristle-footprint-contact";
  readonly version: typeof STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_BRIDGE_VERSION;
  /** First two-well sequence consumed by this footprint. One sequence is used per touched cell. */
  readonly firstSequence: number;
  readonly contactMeasure: number;
  readonly pressure: number;
  readonly flow: number;
  readonly cells: readonly StudioWetMediaBristleFootprintCell[];
}

export interface StudioWetMediaBristleFootprintBridgeInput {
  readonly settings: StudioWetMediaTwoWellSettings;
  readonly brushState: StudioWetMediaTwoWellState;
  readonly fieldSettings: StudioWetMediaTileFieldSettings;
  readonly fieldState: StudioWetMediaTileFieldState;
  readonly contact: StudioWetMediaBristleFootprintContact;
}

export interface StudioWetMediaBristleFootprintCellReceipt {
  readonly cellIndex: number;
  readonly sequence: number;
  readonly normalizedCoverage: number;
  readonly contactMeasure: number;
  readonly sample: StudioWetMediaCanvasSample;
  readonly pickedPigmentMass: number;
  readonly pickedWaterMass: number;
  readonly depositedPigmentMass: number;
  readonly depositedWaterMass: number;
  readonly canvasPigmentMassDelta: number;
  readonly canvasWaterMassDelta: number;
  readonly contact: StudioWetMediaContactResult;
}

export interface StudioWetMediaBristleFootprintBridgeReceipt {
  readonly kind: "studio-wet-media-bristle-footprint-bridge-receipt";
  readonly version: typeof STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_BRIDGE_VERSION;
  readonly twoWellVersion: typeof STUDIO_WET_MEDIA_TWO_WELL_VERSION;
  readonly tileFieldVersion: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly ordering: "cell-index-ascending-v1";
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly cellCount: number;
  readonly totalCoverage: number;
  readonly requestedContactMeasure: number;
  readonly appliedContactMeasure: number;
  readonly pickedPigmentMass: number;
  readonly pickedWaterMass: number;
  readonly depositedPigmentMass: number;
  readonly depositedWaterMass: number;
  readonly canvasPigmentMassDelta: number;
  readonly canvasWaterMassDelta: number;
  readonly closedSystemPigmentConservationError: number;
  readonly closedSystemWaterConservationError: number;
  readonly cells: readonly Readonly<StudioWetMediaBristleFootprintCellReceipt>[];
  readonly field: StudioWetMediaTileFieldDepositionReceipt;
}

export interface StudioWetMediaBristleFootprintBridgeValue {
  readonly brushState: StudioWetMediaTwoWellState;
  readonly fieldState: StudioWetMediaTileFieldState;
  readonly receipt: StudioWetMediaBristleFootprintBridgeReceipt;
}

export type StudioWetMediaBristleFootprintBridgeResult =
  | Readonly<{
      ok: true;
      value: Readonly<StudioWetMediaBristleFootprintBridgeValue>;
    }>
  | Readonly<{
      ok: false;
      stage: "bridge" | "two-well" | "tile-field";
      reason:
        | "invalid-contact"
        | "duplicate-cell"
        | "inactive-cell"
        | "sequence-overflow"
        | "operation-budget"
        | StudioWetMediaTwoWellFailureReason
        | StudioWetMediaTileFieldFailureReason;
      path: string;
      contactIndex?: number;
    }>;

interface NormalizedFootprintCell {
  readonly cellIndex: number;
  readonly coverage: number;
  readonly normalizedCoverage: number;
}

function failure(
  stage: Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }>["stage"],
  reason: Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }>["reason"],
  path: string,
  contactIndex?: number,
): StudioWetMediaBristleFootprintBridgeResult {
  return Object.freeze({
    ok: false,
    stage,
    reason,
    path,
    ...(contactIndex === undefined ? {} : { contactIndex }),
  });
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function canonical(value: number): number {
  if (Object.is(value, -0)) return 0;
  return Math.abs(value) < 1e-14 ? 0 : value;
}

function normalizeContact(
  contact: StudioWetMediaBristleFootprintContact,
  cellCount: number,
):
  | Readonly<{
      firstSequence: number;
      contactMeasure: number;
      pressure: number;
      flow: number;
      totalCoverage: number;
      cells: readonly Readonly<NormalizedFootprintCell>[];
    }>
  | Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }> {
  if (
    !contact
    || contact.kind !== "studio-wet-media-bristle-footprint-contact"
    || contact.version !== STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_BRIDGE_VERSION
    || !Number.isSafeInteger(contact.firstSequence)
    || contact.firstSequence < 0
    || !finiteInRange(
      contact.contactMeasure,
      0,
      STUDIO_WET_MEDIA_TWO_WELL_LIMITS.maxContactMeasure,
    )
    || !finiteInRange(contact.pressure, 0, 1)
    || !finiteInRange(contact.flow, 0, 1)
    || !Array.isArray(contact.cells)
    || contact.cells.length < 1
    || contact.cells.length > STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_MAX_CELLS
  ) {
    return failure("bridge", "invalid-contact", "$.contact") as Extract<
      StudioWetMediaBristleFootprintBridgeResult,
      { ok: false }
    >;
  }

  const seen = new Set<number>();
  const copied: Array<{ cellIndex: number; coverage: number }> = [];
  let totalCoverage = 0;
  for (let index = 0; index < contact.cells.length; index += 1) {
    const cell = contact.cells[index];
    if (
      !cell
      || typeof cell !== "object"
      || !Number.isSafeInteger(cell.cellIndex)
      || cell.cellIndex < 0
      || cell.cellIndex >= cellCount
      || !positiveFinite(cell.coverage)
    ) {
      return failure(
        "bridge",
        "invalid-contact",
        `$.contact.cells[${index}]`,
        index,
      ) as Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }>;
    }
    if (seen.has(cell.cellIndex)) {
      return failure(
        "bridge",
        "duplicate-cell",
        `$.contact.cells[${index}].cellIndex`,
        index,
      ) as Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }>;
    }
    seen.add(cell.cellIndex);
    totalCoverage += cell.coverage;
    if (!Number.isFinite(totalCoverage)) {
      return failure(
        "bridge",
        "invalid-contact",
        "$.contact.cells",
      ) as Extract<StudioWetMediaBristleFootprintBridgeResult, { ok: false }>;
    }
    copied.push({ cellIndex: cell.cellIndex, coverage: cell.coverage });
  }
  if (!positiveFinite(totalCoverage)) {
    return failure("bridge", "invalid-contact", "$.contact.cells") as Extract<
      StudioWetMediaBristleFootprintBridgeResult,
      { ok: false }
    >;
  }
  if (
    contact.firstSequence + copied.length - 1 > Number.MAX_SAFE_INTEGER
  ) {
    return failure("bridge", "sequence-overflow", "$.contact.firstSequence") as Extract<
      StudioWetMediaBristleFootprintBridgeResult,
      { ok: false }
    >;
  }
  copied.sort((left, right) => left.cellIndex - right.cellIndex);
  return Object.freeze({
    firstSequence: contact.firstSequence,
    contactMeasure: contact.contactMeasure,
    pressure: contact.pressure,
    flow: contact.flow,
    totalCoverage,
    cells: Object.freeze(copied.map((cell) => Object.freeze({
      ...cell,
      normalizedCoverage: cell.coverage / totalCoverage,
    }))),
  });
}

function pushMassOperations(
  operations: StudioWetMediaTileFieldDeposition[],
  cellIndex: number,
  result: StudioWetMediaContactResult,
): void {
  const pickup = result.pickupFromCanvas;
  if (pickup.waterMass > 0 || pickup.pigmentMass > 0) {
    operations.push({
      cellIndex,
      waterMassDelta: -pickup.waterMass,
      pigmentMassDelta: -pickup.pigmentMass,
      color: pickup.color as StudioWetMediaLinearRgba,
    });
  }
  const deposition = result.depositionToCanvas;
  if (deposition.waterMass > 0 || deposition.pigmentMass > 0) {
    operations.push({
      cellIndex,
      waterMassDelta: deposition.waterMass,
      pigmentMassDelta: deposition.pigmentMass,
      color: deposition.color as StudioWetMediaLinearRgba,
    });
  }
}

export function advanceStudioWetMediaBristleFootprint(
  input: StudioWetMediaBristleFootprintBridgeInput,
): StudioWetMediaBristleFootprintBridgeResult {
  const settings = parseStudioWetMediaTwoWellSettings(input?.settings);
  if (!settings.ok) return failure("two-well", settings.reason, settings.path);
  const initialBrush = parseStudioWetMediaTwoWellState(
    input?.brushState,
    settings.value,
  );
  if (!initialBrush.ok) {
    return failure("two-well", initialBrush.reason, initialBrush.path);
  }
  const fieldSettings = parseStudioWetMediaTileFieldSettings(input?.fieldSettings);
  if (!fieldSettings.ok) {
    return failure("tile-field", fieldSettings.reason, fieldSettings.path);
  }
  const initialField = parseStudioWetMediaTileFieldState(
    input?.fieldState,
    fieldSettings.value,
  );
  if (!initialField.ok) {
    return failure("tile-field", initialField.reason, initialField.path);
  }

  const normalized = normalizeContact(
    input?.contact,
    fieldSettings.value.width * fieldSettings.value.height,
  );
  if ("stage" in normalized) return normalized;

  let brushState = initialBrush.value;
  const operations: StudioWetMediaTileFieldDeposition[] = [];
  const cells: StudioWetMediaBristleFootprintCellReceipt[] = [];
  let pickedPigmentMass = 0;
  let pickedWaterMass = 0;
  let depositedPigmentMass = 0;
  let depositedWaterMass = 0;
  let twoWellPigmentError = 0;
  let twoWellWaterError = 0;
  let appliedContactMeasure = 0;

  for (let index = 0; index < normalized.cells.length; index += 1) {
    const cell = normalized.cells[index]!;
    const sample = sampleStudioWetMediaTileFieldCell(
      initialField.value,
      cell.cellIndex,
    );
    if (!sample) {
      return failure(
        "bridge",
        "inactive-cell",
        `$.contact.cells[${index}].cellIndex`,
        index,
      );
    }
    const contactMeasure = normalized.contactMeasure * cell.normalizedCoverage;
    appliedContactMeasure += contactMeasure;
    const advanced = advanceStudioWetMediaTwoWellContact(
      settings.value,
      brushState,
      {
        sequence: normalized.firstSequence + index,
        contactMeasure,
        pressure: normalized.pressure,
        flow: normalized.flow,
        canvas: sample,
      },
    );
    if (!advanced.ok) {
      return failure(
        "two-well",
        advanced.reason,
        advanced.path,
        index,
      );
    }
    brushState = advanced.value.state;
    pushMassOperations(operations, cell.cellIndex, advanced.value);
    if (operations.length > STUDIO_WET_MEDIA_TILE_FIELD_LIMITS.maxDepositionOperations) {
      return failure("bridge", "operation-budget", "$.contact.cells", index);
    }

    const pickup = advanced.value.pickupFromCanvas;
    const deposition = advanced.value.depositionToCanvas;
    pickedPigmentMass += pickup.pigmentMass;
    pickedWaterMass += pickup.waterMass;
    depositedPigmentMass += deposition.pigmentMass;
    depositedWaterMass += deposition.waterMass;
    twoWellPigmentError += advanced.value.receipt.pigmentConservationError;
    twoWellWaterError += advanced.value.receipt.waterConservationError;
    cells.push(Object.freeze({
      cellIndex: cell.cellIndex,
      sequence: normalized.firstSequence + index,
      normalizedCoverage: cell.normalizedCoverage,
      contactMeasure,
      sample,
      pickedPigmentMass: pickup.pigmentMass,
      pickedWaterMass: pickup.waterMass,
      depositedPigmentMass: deposition.pigmentMass,
      depositedWaterMass: deposition.waterMass,
      canvasPigmentMassDelta: canonical(
        deposition.pigmentMass - pickup.pigmentMass,
      ),
      canvasWaterMassDelta: canonical(
        deposition.waterMass - pickup.waterMass,
      ),
      contact: advanced.value,
    }));
  }

  const applied = applyStudioWetMediaTileFieldDepositions(
    fieldSettings.value,
    initialField.value,
    operations,
  );
  if (!applied.ok) return failure("tile-field", applied.reason, applied.path);

  const canvasPigmentMassDelta = depositedPigmentMass - pickedPigmentMass;
  const canvasWaterMassDelta = depositedWaterMass - pickedWaterMass;
  const closedSystemPigmentConservationError =
    twoWellPigmentError
    + applied.value.receipt.appliedPigmentMassDelta
    - canvasPigmentMassDelta;
  const closedSystemWaterConservationError =
    twoWellWaterError
    + applied.value.receipt.appliedWaterMassDelta
    - canvasWaterMassDelta;
  const receipt: StudioWetMediaBristleFootprintBridgeReceipt = Object.freeze({
    kind: "studio-wet-media-bristle-footprint-bridge-receipt",
    version: STUDIO_WET_MEDIA_BRISTLE_FOOTPRINT_BRIDGE_VERSION,
    twoWellVersion: STUDIO_WET_MEDIA_TWO_WELL_VERSION,
    tileFieldVersion: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    ordering: "cell-index-ascending-v1",
    firstSequence: normalized.firstSequence,
    lastSequence: normalized.firstSequence + normalized.cells.length - 1,
    cellCount: normalized.cells.length,
    totalCoverage: normalized.totalCoverage,
    requestedContactMeasure: normalized.contactMeasure,
    appliedContactMeasure,
    pickedPigmentMass,
    pickedWaterMass,
    depositedPigmentMass,
    depositedWaterMass,
    canvasPigmentMassDelta: canonical(canvasPigmentMassDelta),
    canvasWaterMassDelta: canonical(canvasWaterMassDelta),
    closedSystemPigmentConservationError: canonical(
      closedSystemPigmentConservationError,
    ),
    closedSystemWaterConservationError: canonical(
      closedSystemWaterConservationError,
    ),
    cells: Object.freeze(cells),
    field: applied.value.receipt,
  });

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      brushState,
      fieldState: applied.value.state,
      receipt,
    }),
  });
}
