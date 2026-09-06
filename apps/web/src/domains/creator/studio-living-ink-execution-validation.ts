import {
  STUDIO_LIVING_INK_EXECUTION_LIMITS,
  type StudioLivingInkExecutionApplyOptions,
  type StudioLivingInkExecutionConfig,
} from "./studio-living-ink-execution-protocol";
import {
  STUDIO_LIVING_INK_FIELD_VERSION,
  STUDIO_LIVING_INK_LIMITS,
  type StudioLivingInkBounds,
  type StudioLivingInkOperation,
  type StudioLivingInkSelectionMask,
} from "./studio-living-ink-field";

import type {
  StudioLivingInkDisplayMode,
  StudioLivingInkMaterialControls,
} from "./studio-living-ink-gpu-protocol";

export type StudioLivingInkParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; path: string; message: string }>;

const DISPLAY_MODES = Object.freeze([
  "composite",
  "mobile-pigment",
  "fixed-pigment",
  "water",
  "flow",
] as const satisfies readonly StudioLivingInkDisplayMode[]);

const MATERIAL_KEYS = Object.freeze([
  "brushSizeCells",
  "flow",
  "bleed",
  "dryRate",
  "chromaticSeparation",
  "brushPigmentLoad",
  "capillaryCreep",
  "vorticity",
  "dryingEdgeDeposition",
  "wetOnWetMixing",
  "glazeOverFixed",
  "paperFiber",
  "paperTooth",
  "granulation",
  "edgeDarkening",
  "wetSheen",
  "vignette",
  "beerLambertDensity",
] as const satisfies readonly (keyof StudioLivingInkMaterialControls)[]);

function failure<T>(path: string, message: string): StudioLivingInkParseResult<T> {
  return Object.freeze({ ok: false, path, message });
}

function success<T>(value: T): StudioLivingInkParseResult<T> {
  return Object.freeze({ ok: true, value });
}

function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function exactSubset(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function parseMaterial(value: unknown): StudioLivingInkParseResult<StudioLivingInkMaterialControls> {
  if (!plain(value) || !exact(value, MATERIAL_KEYS)) {
    return failure("$.material", "Living Ink material must contain only the reviewed controls.");
  }
  if (!finite(value.brushSizeCells, 0.25, 192)) {
    return failure("$.material.brushSizeCells", "Living Ink brush size is outside the reviewed range.");
  }
  for (const key of MATERIAL_KEYS) {
    if (key !== "brushSizeCells" && !finite(value[key], 0, 1)) {
      return failure(`$.material.${key}`, "Living Ink material controls must be finite values in [0, 1].");
    }
  }
  return success(Object.freeze({ ...value }) as unknown as StudioLivingInkMaterialControls);
}

export function parseStudioLivingInkExecutionConfig(
  value: unknown,
): StudioLivingInkParseResult<StudioLivingInkExecutionConfig> {
  const keys = [
    "displayWidth",
    "displayHeight",
    "fieldWidth",
    "fieldHeight",
    "coarseBase",
    "seed",
    "material",
    "displayMode",
  ] as const;
  if (!plain(value) || !exact(value, keys)) {
    return failure("$", "Living Ink execution config has unknown or missing fields.");
  }
  if (
    !integer(value.displayWidth, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumDisplayDimension)
    || !integer(value.displayHeight, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumDisplayDimension)
    || !integer(value.fieldWidth, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumFineDimension)
    || !integer(value.fieldHeight, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumFineDimension)
    || !integer(value.seed, 0, 0xffff_ffff)
    || (value.coarseBase !== 128 && value.coarseBase !== 192 && value.coarseBase !== 256)
    || typeof value.displayMode !== "string"
    || !DISPLAY_MODES.includes(value.displayMode as StudioLivingInkDisplayMode)
  ) return failure("$", "Living Ink execution config exceeds its reviewed numeric boundary.");
  const material = parseMaterial(value.material);
  if (!material.ok) return material;
  return success(Object.freeze({
    displayWidth: value.displayWidth,
    displayHeight: value.displayHeight,
    fieldWidth: value.fieldWidth,
    fieldHeight: value.fieldHeight,
    coarseBase: value.coarseBase,
    seed: value.seed,
    material: material.value,
    displayMode: value.displayMode as StudioLivingInkDisplayMode,
  }));
}

function parseBounds(
  value: unknown,
  config: Pick<StudioLivingInkExecutionConfig, "fieldWidth" | "fieldHeight">,
  path: string,
): StudioLivingInkParseResult<StudioLivingInkBounds> {
  if (
    !plain(value)
    || !exact(value, ["x", "y", "width", "height"])
    || !integer(value.x, 0, config.fieldWidth - 1)
    || !integer(value.y, 0, config.fieldHeight - 1)
    || !integer(value.width, 1, config.fieldWidth)
    || !integer(value.height, 1, config.fieldHeight)
    || value.x + value.width > config.fieldWidth
    || value.y + value.height > config.fieldHeight
  ) return failure(path, "Living Ink selection bounds are outside the document field.");
  return success(Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height }));
}

export function parseStudioLivingInkExecutionSelection(
  value: unknown,
  config: Pick<StudioLivingInkExecutionConfig, "fieldWidth" | "fieldHeight">,
  path = "$.selection",
): StudioLivingInkParseResult<StudioLivingInkSelectionMask | null> {
  if (value === null) return success(null);
  if (
    !plain(value)
    || !exact(value, ["kind", "version", "bounds", "coverage"])
    || value.kind !== "studio-living-ink-selection-mask"
    || value.version !== STUDIO_LIVING_INK_FIELD_VERSION
    || !Array.isArray(value.coverage)
  ) return failure(path, "Living Ink selection mask is malformed.");
  const bounds = parseBounds(value.bounds, config, `${path}.bounds`);
  if (!bounds.ok) return bounds;
  const expected = bounds.value.width * bounds.value.height;
  if (value.coverage.length !== expected) {
    return failure(`${path}.coverage`, "Living Ink selection coverage length does not match its bounds.");
  }
  const coverage = new Array<number>(expected);
  for (let index = 0; index < expected; index += 1) {
    const channel = value.coverage[index];
    if (!finite(channel, 0, 1)) {
      return failure(`${path}.coverage[${index}]`, "Living Ink selection coverage must be finite and in [0, 1].");
    }
    coverage[index] = Object.is(channel, -0) ? 0 : channel;
  }
  return success(Object.freeze({
    kind: "studio-living-ink-selection-mask",
    version: STUDIO_LIVING_INK_FIELD_VERSION,
    bounds: bounds.value,
    coverage: Object.freeze(coverage),
  }));
}

function parseMark(
  value: unknown,
  config: Pick<StudioLivingInkExecutionConfig, "fieldWidth" | "fieldHeight">,
  waterOnly: boolean,
  path: string,
): StudioLivingInkParseResult<Record<string, unknown>> {
  const keys = waterOnly
    ? ["x", "y", "radius", "pressure", "speed", "waterMass"]
    : ["x", "y", "radius", "pressure", "speed", "waterMass", "pigmentMass", "color"];
  if (!plain(value) || !exact(value, keys)) return failure(path, "Living Ink mark is malformed.");
  if (
    !finite(value.x, -STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells, config.fieldWidth + STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    || !finite(value.y, -STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells, config.fieldHeight + STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    || !finite(value.radius, 0.25, STUDIO_LIVING_INK_LIMITS.maxBrushRadiusCells)
    || !finite(value.pressure, 0, 1)
    || !finite(value.speed, 0, STUDIO_LIVING_INK_LIMITS.maxSpeedCellsPerSecond)
    || !finite(value.waterMass, 0, 64)
    || (!waterOnly && !finite(value.pigmentMass, 0, 64))
  ) return failure(path, "Living Ink mark contains a non-finite or out-of-budget channel.");
  if (!waterOnly && (
    !Array.isArray(value.color)
    || value.color.length !== 4
    || !value.color.every((channel) => finite(channel, 0, 1))
  )) return failure(`${path}.color`, "Living Ink pigment colour must be finite linear RGBA.");
  return success(Object.freeze({
    ...value,
    ...(waterOnly ? {} : { color: Object.freeze([...(value.color as number[])]) }),
  }));
}

export function parseStudioLivingInkExecutionOperation(
  value: unknown,
  config: Pick<StudioLivingInkExecutionConfig, "fieldWidth" | "fieldHeight">,
): StudioLivingInkParseResult<StudioLivingInkOperation> {
  if (!plain(value) || value.version !== STUDIO_LIVING_INK_FIELD_VERSION) {
    return failure("$.operation", "Living Ink operation is malformed.");
  }
  if (!integer(value.sequence, 1, Number.MAX_SAFE_INTEGER)) {
    return failure("$.operation.sequence", "Living Ink operation sequence is invalid.");
  }
  if (value.kind === "ink" || value.kind === "water") {
    if (!exact(value, ["kind", "version", "sequence", "tool", "marks", "selection"])) {
      return failure("$.operation", "Living Ink deposit operation has unknown or missing fields.");
    }
    const validTool = value.kind === "water"
      ? value.tool === "water-brush"
      : ["pen", "brush", "pigment-water-brush", "white-gouache"].includes(value.tool as string);
    if (!validTool || !Array.isArray(value.marks) || value.marks.length > STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumMarksPerRequest) {
      return failure("$.operation.marks", "Living Ink deposit operation exceeds its mark boundary.");
    }
    const marks: Record<string, unknown>[] = [];
    for (let index = 0; index < value.marks.length; index += 1) {
      const mark = parseMark(value.marks[index], config, value.kind === "water", `$.operation.marks[${index}]`);
      if (!mark.ok) return mark;
      marks.push(mark.value);
    }
    const selection = parseStudioLivingInkExecutionSelection(value.selection, config, "$.operation.selection");
    if (!selection.ok) return selection;
    return success(Object.freeze({
      kind: value.kind,
      version: STUDIO_LIVING_INK_FIELD_VERSION,
      sequence: value.sequence,
      tool: value.tool,
      marks: Object.freeze(marks),
      selection: selection.value,
    }) as unknown as StudioLivingInkOperation);
  }
  if (value.kind === "fix" || value.kind === "clear") {
    if (!exact(value, ["kind", "version", "sequence", "scope", "selection"])) {
      return failure("$.operation", "Living Ink mask operation has unknown or missing fields.");
    }
    if (value.scope !== "all" && value.scope !== "selection") {
      return failure("$.operation.scope", "Living Ink mask operation scope is invalid.");
    }
    const selection = parseStudioLivingInkExecutionSelection(value.selection, config, "$.operation.selection");
    if (!selection.ok) return selection;
    if ((value.scope === "selection") !== (selection.value !== null)) {
      return failure("$.operation.selection", "Living Ink selection scope and mask must agree.");
    }
    return success(Object.freeze({
      kind: value.kind,
      version: STUDIO_LIVING_INK_FIELD_VERSION,
      sequence: value.sequence,
      scope: value.scope,
      selection: selection.value,
    }));
  }
  if (value.kind === "advance") {
    if (
      !exact(value, ["kind", "version", "sequence", "fixedTicks"])
      || !integer(value.fixedTicks, 1, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumAdvanceTicks)
    ) return failure("$.operation.fixedTicks", "Living Ink advance operation exceeds its fixed-tick boundary.");
    return success(Object.freeze({
      kind: "advance",
      version: STUDIO_LIVING_INK_FIELD_VERSION,
      sequence: value.sequence,
      fixedTicks: value.fixedTicks,
    }));
  }
  return failure("$.operation.kind", "Living Ink operation kind is unknown.");
}

export function parseStudioLivingInkExecutionApplyOptions(
  value: unknown,
): StudioLivingInkParseResult<StudioLivingInkExecutionApplyOptions> {
  const allowed = ["simulationTicks", "quality", "displayMode", "present"] as const;
  if (!plain(value) || !exactSubset(value, allowed)) {
    return failure("$.options", "Living Ink apply options have unknown fields.");
  }
  if (
    (value.simulationTicks !== undefined && !integer(value.simulationTicks, 0, STUDIO_LIVING_INK_EXECUTION_LIMITS.maximumAdvanceTicks))
    || (value.quality !== undefined && value.quality !== "interactive" && value.quality !== "settle")
    || (
      value.displayMode !== undefined
      && (typeof value.displayMode !== "string" || !DISPLAY_MODES.includes(value.displayMode as StudioLivingInkDisplayMode))
    )
    || (value.present !== undefined && typeof value.present !== "boolean")
  ) return failure("$.options", "Living Ink apply options exceed their reviewed boundary.");
  return success(Object.freeze({ ...value }) as StudioLivingInkExecutionApplyOptions);
}
