/**
 * Atomic bridge between the provider-neutral two-well mixer brush and the deterministic wet-media
 * tile field.
 *
 * The two-well model calculates pickup/deposition mass. The tile field owns canvas-side mobile
 * water, pigment mass and optical-density colour. This bridge samples one contact cell, advances
 * the brush, and applies both signed field deltas in one immutable transaction. If either model
 * rejects, neither the caller's brush state nor field state advances.
 */

import {
  applyStudioWetMediaTileFieldDepositions,
  parseStudioWetMediaTileFieldSettings,
  parseStudioWetMediaTileFieldState,
  STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
  type StudioWetMediaLinearRgba,
  type StudioWetMediaTileFieldDeposition,
  type StudioWetMediaTileFieldDepositionReceipt,
  type StudioWetMediaTileFieldFailureReason,
  type StudioWetMediaTileFieldSettings,
  type StudioWetMediaTileFieldState,
} from "./studio-wet-media-tile-field";
import {
  advanceStudioWetMediaTwoWellContact,
  parseStudioWetMediaTwoWellSettings,
  parseStudioWetMediaTwoWellState,
  STUDIO_WET_MEDIA_TWO_WELL_VERSION,
  type StudioWetMediaCanvasSample,
  type StudioWetMediaContactResult,
  type StudioWetMediaLinearRgba as StudioWetMediaTwoWellLinearRgba,
  type StudioWetMediaTwoWellFailureReason,
  type StudioWetMediaTwoWellSettings,
  type StudioWetMediaTwoWellState,
} from "./studio-wet-media-two-well-model";

export const STUDIO_WET_MEDIA_TWO_WELL_FIELD_BRIDGE_VERSION = 1 as const;

export interface StudioWetMediaTwoWellFieldContact {
  readonly kind: "studio-wet-media-two-well-field-contact";
  readonly version: typeof STUDIO_WET_MEDIA_TWO_WELL_FIELD_BRIDGE_VERSION;
  readonly cellIndex: number;
  readonly sequence: number;
  readonly contactMeasure: number;
  readonly pressure: number;
  readonly flow: number;
}

export interface StudioWetMediaTwoWellFieldBridgeInput {
  readonly settings: StudioWetMediaTwoWellSettings;
  readonly brushState: StudioWetMediaTwoWellState;
  readonly fieldSettings: StudioWetMediaTileFieldSettings;
  readonly fieldState: StudioWetMediaTileFieldState;
  readonly contact: StudioWetMediaTwoWellFieldContact;
}

export interface StudioWetMediaTwoWellFieldBridgeReceipt {
  readonly kind: "studio-wet-media-two-well-field-bridge-receipt";
  readonly version: typeof STUDIO_WET_MEDIA_TWO_WELL_FIELD_BRIDGE_VERSION;
  readonly twoWellVersion: typeof STUDIO_WET_MEDIA_TWO_WELL_VERSION;
  readonly tileFieldVersion: typeof STUDIO_WET_MEDIA_TILE_FIELD_VERSION;
  readonly cellIndex: number;
  readonly sequence: number;
  readonly sampledPigmentMass: number;
  readonly sampledWaterMass: number;
  readonly pickedPigmentMass: number;
  readonly pickedWaterMass: number;
  readonly depositedPigmentMass: number;
  readonly depositedWaterMass: number;
  readonly canvasPigmentMassDelta: number;
  readonly canvasWaterMassDelta: number;
  readonly closedSystemPigmentConservationError: number;
  readonly closedSystemWaterConservationError: number;
  readonly field: StudioWetMediaTileFieldDepositionReceipt;
}

export interface StudioWetMediaTwoWellFieldBridgeValue {
  readonly brushState: StudioWetMediaTwoWellState;
  readonly fieldState: StudioWetMediaTileFieldState;
  readonly sample: StudioWetMediaCanvasSample;
  readonly contact: StudioWetMediaContactResult;
  readonly receipt: StudioWetMediaTwoWellFieldBridgeReceipt;
}

export type StudioWetMediaTwoWellFieldBridgeResult =
  | Readonly<{ ok: true; value: StudioWetMediaTwoWellFieldBridgeValue }>
  | Readonly<{
      ok: false;
      stage: "bridge" | "two-well" | "tile-field";
      reason:
        | "invalid-contact"
        | "inactive-cell"
        | StudioWetMediaTwoWellFailureReason
        | StudioWetMediaTileFieldFailureReason;
      path: string;
    }>;

function failure(
  stage: Extract<StudioWetMediaTwoWellFieldBridgeResult, { ok: false }>["stage"],
  reason: Extract<StudioWetMediaTwoWellFieldBridgeResult, { ok: false }>["reason"],
  path: string,
): StudioWetMediaTwoWellFieldBridgeResult {
  return Object.freeze({ ok: false, stage, reason, path });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validContact(
  contact: StudioWetMediaTwoWellFieldContact,
  cellCount: number,
): boolean {
  return Boolean(
    contact
    && contact.kind === "studio-wet-media-two-well-field-contact"
    && contact.version === STUDIO_WET_MEDIA_TWO_WELL_FIELD_BRIDGE_VERSION
    && Number.isSafeInteger(contact.cellIndex)
    && contact.cellIndex >= 0
    && contact.cellIndex < cellCount
    && Number.isSafeInteger(contact.sequence)
    && contact.sequence >= 0
    && finite(contact.contactMeasure)
    && finite(contact.pressure)
    && finite(contact.flow),
  );
}

function canonical(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Reconstructs the mobile pigment reflectance stored at one field cell.
 *
 * The tile field stores additive optical-density load (`density * pigmentMass`). Dividing by the
 * mobile mass yields the well colour's optical density; Beer-Lambert inversion returns the same
 * linear reflectance that was originally deposited, including mixed colours.
 */
export function sampleStudioWetMediaTileFieldCell(
  fieldState: StudioWetMediaTileFieldState,
  cellIndex: number,
): StudioWetMediaCanvasSample | null {
  const cellCount = fieldState.width * fieldState.height;
  if (
    !Number.isSafeInteger(cellIndex)
    || cellIndex < 0
    || cellIndex >= cellCount
    || fieldState.activeMask[cellIndex] !== 1
  ) return null;

  const pigmentMass = fieldState.mobilePigmentMass[cellIndex]!;
  const waterMass = fieldState.surfaceWater[cellIndex]!;
  const color: StudioWetMediaTwoWellLinearRgba = pigmentMass > 0
    ? Object.freeze([
        Math.exp(-fieldState.mobilePigmentOpticalDensity[0][cellIndex]! / pigmentMass),
        Math.exp(-fieldState.mobilePigmentOpticalDensity[1][cellIndex]! / pigmentMass),
        Math.exp(-fieldState.mobilePigmentOpticalDensity[2][cellIndex]! / pigmentMass),
        1 - Math.exp(-pigmentMass / Math.max(0.25, 1 + waterMass)),
      ])
    : Object.freeze([0, 0, 0, 0]);

  return Object.freeze({
    color,
    availablePigmentMass: pigmentMass,
    availableWaterMass: waterMass,
  });
}

export function advanceStudioWetMediaTwoWellFieldContact(
  input: StudioWetMediaTwoWellFieldBridgeInput,
): StudioWetMediaTwoWellFieldBridgeResult {
  const settings = parseStudioWetMediaTwoWellSettings(input?.settings);
  if (!settings.ok) return failure("two-well", settings.reason, settings.path);
  const brushState = parseStudioWetMediaTwoWellState(
    input?.brushState,
    settings.value,
  );
  if (!brushState.ok) return failure("two-well", brushState.reason, brushState.path);

  const fieldSettings = parseStudioWetMediaTileFieldSettings(input?.fieldSettings);
  if (!fieldSettings.ok) {
    return failure("tile-field", fieldSettings.reason, fieldSettings.path);
  }
  const fieldState = parseStudioWetMediaTileFieldState(
    input?.fieldState,
    fieldSettings.value,
  );
  if (!fieldState.ok) return failure("tile-field", fieldState.reason, fieldState.path);

  const cellCount = fieldSettings.value.width * fieldSettings.value.height;
  if (!validContact(input?.contact, cellCount)) {
    return failure("bridge", "invalid-contact", "$.contact");
  }
  const sample = sampleStudioWetMediaTileFieldCell(
    fieldState.value,
    input.contact.cellIndex,
  );
  if (!sample) return failure("bridge", "inactive-cell", "$.contact.cellIndex");

  const advanced = advanceStudioWetMediaTwoWellContact(
    settings.value,
    brushState.value,
    {
      sequence: input.contact.sequence,
      contactMeasure: input.contact.contactMeasure,
      pressure: input.contact.pressure,
      flow: input.contact.flow,
      canvas: sample,
    },
  );
  if (!advanced.ok) return failure("two-well", advanced.reason, advanced.path);

  const pickup = advanced.value.pickupFromCanvas;
  const deposition = advanced.value.depositionToCanvas;
  const operations: StudioWetMediaTileFieldDeposition[] = [];
  if (pickup.waterMass > 0 || pickup.pigmentMass > 0) {
    operations.push({
      cellIndex: input.contact.cellIndex,
      waterMassDelta: -pickup.waterMass,
      pigmentMassDelta: -pickup.pigmentMass,
      color: pickup.color as StudioWetMediaLinearRgba,
    });
  }
  if (deposition.waterMass > 0 || deposition.pigmentMass > 0) {
    operations.push({
      cellIndex: input.contact.cellIndex,
      waterMassDelta: deposition.waterMass,
      pigmentMassDelta: deposition.pigmentMass,
      color: deposition.color as StudioWetMediaLinearRgba,
    });
  }

  const applied = applyStudioWetMediaTileFieldDepositions(
    fieldSettings.value,
    fieldState.value,
    operations,
  );
  if (!applied.ok) return failure("tile-field", applied.reason, applied.path);

  const canvasPigmentMassDelta =
    deposition.pigmentMass - pickup.pigmentMass;
  const canvasWaterMassDelta =
    deposition.waterMass - pickup.waterMass;
  const closedSystemPigmentConservationError =
    advanced.value.receipt.pigmentConservationError
    + (
      applied.value.receipt.appliedPigmentMassDelta
      - canvasPigmentMassDelta
    );
  const closedSystemWaterConservationError =
    advanced.value.receipt.waterConservationError
    + (
      applied.value.receipt.appliedWaterMassDelta
      - canvasWaterMassDelta
    );

  const receipt: StudioWetMediaTwoWellFieldBridgeReceipt = Object.freeze({
    kind: "studio-wet-media-two-well-field-bridge-receipt",
    version: STUDIO_WET_MEDIA_TWO_WELL_FIELD_BRIDGE_VERSION,
    twoWellVersion: STUDIO_WET_MEDIA_TWO_WELL_VERSION,
    tileFieldVersion: STUDIO_WET_MEDIA_TILE_FIELD_VERSION,
    cellIndex: input.contact.cellIndex,
    sequence: input.contact.sequence,
    sampledPigmentMass: sample.availablePigmentMass,
    sampledWaterMass: sample.availableWaterMass,
    pickedPigmentMass: pickup.pigmentMass,
    pickedWaterMass: pickup.waterMass,
    depositedPigmentMass: deposition.pigmentMass,
    depositedWaterMass: deposition.waterMass,
    canvasPigmentMassDelta: canonical(canvasPigmentMassDelta),
    canvasWaterMassDelta: canonical(canvasWaterMassDelta),
    closedSystemPigmentConservationError: canonical(
      closedSystemPigmentConservationError,
    ),
    closedSystemWaterConservationError: canonical(
      closedSystemWaterConservationError,
    ),
    field: applied.value.receipt,
  });

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      brushState: advanced.value.state,
      fieldState: applied.value.state,
      sample,
      contact: advanced.value,
      receipt,
    }),
  });
}
