/**
 * Renderer-neutral corrective-driver graph for 2D/3D character rigs.
 *
 * A driver maps an observable scalar (for example a bone rotation or morph
 * weight) to a 0..1 activation curve. Corrections can depend on more than one
 * driver, then contribute deterministic deltas to typed output channels.
 *
 * The module deliberately owns no Three.js, VRM, DOM or React state. Generic
 * 3D models, VRM avatars and future 2D deformers can all project their native
 * channels into this graph without making the saved recipe engine-specific.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION = 1 as const;

export const STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS = Object.freeze({
  maxDrivers: 128,
  maxChannels: 1_024,
  maxCorrections: 512,
  maxTermsPerCorrection: 16,
  maxOutputsPerCorrection: 128,
  maxCurvePoints: 64,
  maxIdentifierCharacters: 128,
  maxBakeSamples: 65_536,
} as const);

export type StudioCorrectiveDriverSourceKind =
  | "bone-rotation"
  | "bone-translation"
  | "bone-scale"
  | "morph-weight"
  | "custom-scalar";

export type StudioCorrectiveDriverUnit =
  | "degrees"
  | "radians"
  | "normalized"
  | "document";

export type StudioCorrectiveChannelKind =
  | "bone-rotation-delta"
  | "bone-translation-delta"
  | "bone-scale-delta"
  | "morph-weight-delta"
  | "mesh-corrective-weight"
  | "material-scalar-delta"
  | "custom-scalar-delta";

export type StudioCorrectiveConflictPolicy =
  | "additive"
  | "maximum-magnitude"
  | "priority-override"
  | "normalized-blend";

export interface StudioCorrectiveCurvePoint {
  readonly input: number;
  readonly output: number;
}

export interface StudioCorrectiveDriver {
  readonly id: string;
  readonly sourceKind: StudioCorrectiveDriverSourceKind;
  readonly subjectId: string;
  readonly component: "x" | "y" | "z" | "scalar";
  readonly unit: StudioCorrectiveDriverUnit;
  readonly inputMin: number;
  readonly inputMax: number;
}

export interface StudioCorrectiveChannel {
  readonly id: string;
  readonly kind: StudioCorrectiveChannelKind;
  readonly subjectId: string;
  readonly component: "x" | "y" | "z" | "scalar";
  readonly baseValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly conflictPolicy: StudioCorrectiveConflictPolicy;
}

export interface StudioCorrectiveDriverTerm {
  readonly driverId: string;
  /** Piecewise-linear, clamped activation curve. Inputs use the driver's unit. */
  readonly curve: readonly StudioCorrectiveCurvePoint[];
}

export interface StudioCorrectiveOutput {
  readonly channelId: string;
  /**
   * Correction delta as a function of the combined 0..1 activation.
   * The curve input must span 0..1 and its output uses the channel's unit.
   */
  readonly curve: readonly StudioCorrectiveCurvePoint[];
}

export interface StudioCorrectiveCorrection {
  readonly id: string;
  readonly priority: number;
  readonly combine: "multiply" | "minimum" | "mean";
  readonly terms: readonly StudioCorrectiveDriverTerm[];
  readonly outputs: readonly StudioCorrectiveOutput[];
}

export interface StudioCorrectiveDriverGraph {
  readonly kind: "studio-corrective-driver-graph";
  readonly version: typeof STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION;
  readonly graphId: string;
  readonly revision: number;
  readonly drivers: readonly StudioCorrectiveDriver[];
  readonly channels: readonly StudioCorrectiveChannel[];
  readonly corrections: readonly StudioCorrectiveCorrection[];
}

export type StudioCorrectiveDriverValues = Readonly<Record<string, number>>;
export type StudioCorrectiveChannelValues = Readonly<Record<string, number>>;

export interface StudioCorrectiveContribution {
  readonly correctionId: string;
  readonly priority: number;
  readonly activation: number;
  readonly delta: number;
}

export interface StudioCorrectiveEvaluation {
  readonly graphId: string;
  readonly revision: number;
  readonly channels: StudioCorrectiveChannelValues;
  readonly activations: Readonly<Record<string, number>>;
  readonly contributions: Readonly<
    Record<string, readonly StudioCorrectiveContribution[]>
  >;
}

export type StudioCorrectiveGraphFailureCode =
  | "invalid-graph"
  | "unsupported-version"
  | "budget-exceeded"
  | "duplicate-id"
  | "missing-reference";

export type StudioCorrectiveGraphResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      code: StudioCorrectiveGraphFailureCode;
      path: string;
      reason: string;
    }>;

export interface StudioCompiledCorrectiveDriverGraph {
  readonly graph: StudioCorrectiveDriverGraph;
  readonly graphSha256: `sha256:${string}`;
  readonly driverIds: readonly string[];
  readonly channelIds: readonly string[];
}

export interface StudioCorrectivePreviewFrame {
  readonly offset: number;
  readonly driverValue: number;
  readonly evaluation: StudioCorrectiveEvaluation;
}

export interface StudioCorrectiveBakeSample {
  readonly sampleId: string;
  readonly drivers: StudioCorrectiveDriverValues;
}

export interface StudioCorrectiveBake {
  readonly kind: "studio-corrective-driver-bake";
  readonly version: 1;
  readonly graphId: string;
  readonly graphRevision: number;
  readonly graphSha256: `sha256:${string}`;
  readonly channelIds: readonly string[];
  readonly sampleIds: readonly string[];
  /** Sample-major Float32 values in channelIds order. */
  readonly values: Float32Array;
  readonly valuesSha256: `sha256:${string}`;
}

interface MutableContribution {
  correctionId: string;
  priority: number;
  activation: number;
  delta: number;
}

function failure<T>(
  code: StudioCorrectiveGraphFailureCode,
  path: string,
  reason: string,
): StudioCorrectiveGraphResult<T> {
  return Object.freeze({ ok: false, code, path, reason });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxIdentifierCharacters
  );
}

function validCurve(
  curve: readonly StudioCorrectiveCurvePoint[],
  path: string,
): StudioCorrectiveGraphResult<readonly StudioCorrectiveCurvePoint[]> {
  if (
    !Array.isArray(curve)
    || curve.length < 2
    || curve.length > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxCurvePoints
  ) {
    return failure("invalid-graph", path, "curve point count is invalid");
  }
  let previousInput = Number.NEGATIVE_INFINITY;
  const cloned: StudioCorrectiveCurvePoint[] = [];
  for (let index = 0; index < curve.length; index += 1) {
    const point = curve[index];
    if (
      !point
      || !finite(point.input)
      || !finite(point.output)
      || point.input <= previousInput
    ) {
      return failure(
        "invalid-graph",
        `${path}[${index}]`,
        "curve points must be finite and strictly increasing",
      );
    }
    previousInput = point.input;
    cloned.push(Object.freeze({ input: point.input, output: point.output }));
  }
  return Object.freeze({ ok: true, value: Object.freeze(cloned) });
}

function interpolateCurve(
  curve: readonly StudioCorrectiveCurvePoint[],
  input: number,
): number {
  if (input <= curve[0].input) return curve[0].output;
  const last = curve[curve.length - 1];
  if (input >= last.input) return last.output;
  let low = 0;
  let high = curve.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (curve[middle].input <= input) low = middle;
    else high = middle;
  }
  const left = curve[low];
  const right = curve[high];
  const ratio = (input - left.input) / (right.input - left.input);
  return left.output + (right.output - left.output) * ratio;
}

function canonicalGraphJson(graph: StudioCorrectiveDriverGraph): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(graph));
}

function cloneAndValidateGraph(
  graph: StudioCorrectiveDriverGraph,
): StudioCorrectiveGraphResult<StudioCorrectiveDriverGraph> {
  if (!graph || typeof graph !== "object") {
    return failure("invalid-graph", "$", "graph must be an object");
  }
  if (graph.version !== STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION) {
    return failure(
      "unsupported-version",
      "$.version",
      `expected version ${STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION}`,
    );
  }
  if (
    graph.kind !== "studio-corrective-driver-graph"
    || !validIdentifier(graph.graphId)
    || !Number.isSafeInteger(graph.revision)
    || graph.revision < 0
    || !Array.isArray(graph.drivers)
    || !Array.isArray(graph.channels)
    || !Array.isArray(graph.corrections)
  ) {
    return failure("invalid-graph", "$", "graph header is invalid");
  }
  if (
    graph.drivers.length > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxDrivers
    || graph.channels.length > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxChannels
    || graph.corrections.length
      > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxCorrections
  ) {
    return failure("budget-exceeded", "$", "graph collection budget exceeded");
  }

  const driverIds = new Set<string>();
  const drivers: StudioCorrectiveDriver[] = [];
  for (let index = 0; index < graph.drivers.length; index += 1) {
    const driver = graph.drivers[index];
    const path = `$.drivers[${index}]`;
    if (
      !driver
      || !validIdentifier(driver.id)
      || !validIdentifier(driver.subjectId)
      || ![
        "bone-rotation",
        "bone-translation",
        "bone-scale",
        "morph-weight",
        "custom-scalar",
      ].includes(driver.sourceKind)
      || !["x", "y", "z", "scalar"].includes(driver.component)
      || !["degrees", "radians", "normalized", "document"].includes(driver.unit)
      || !finite(driver.inputMin)
      || !finite(driver.inputMax)
      || driver.inputMax <= driver.inputMin
    ) {
      return failure("invalid-graph", path, "driver is invalid");
    }
    if (driverIds.has(driver.id)) {
      return failure("duplicate-id", `${path}.id`, "duplicate driver id");
    }
    driverIds.add(driver.id);
    drivers.push(Object.freeze({ ...driver }));
  }

  const channelIds = new Set<string>();
  const channels: StudioCorrectiveChannel[] = [];
  for (let index = 0; index < graph.channels.length; index += 1) {
    const channel = graph.channels[index];
    const path = `$.channels[${index}]`;
    if (
      !channel
      || !validIdentifier(channel.id)
      || !validIdentifier(channel.subjectId)
      || ![
        "bone-rotation-delta",
        "bone-translation-delta",
        "bone-scale-delta",
        "morph-weight-delta",
        "mesh-corrective-weight",
        "material-scalar-delta",
        "custom-scalar-delta",
      ].includes(channel.kind)
      || !["x", "y", "z", "scalar"].includes(channel.component)
      || !finite(channel.baseValue)
      || !finite(channel.minimum)
      || !finite(channel.maximum)
      || channel.maximum < channel.minimum
      || channel.baseValue < channel.minimum
      || channel.baseValue > channel.maximum
      || ![
        "additive",
        "maximum-magnitude",
        "priority-override",
        "normalized-blend",
      ].includes(channel.conflictPolicy)
    ) {
      return failure("invalid-graph", path, "channel is invalid");
    }
    if (channelIds.has(channel.id)) {
      return failure("duplicate-id", `${path}.id`, "duplicate channel id");
    }
    channelIds.add(channel.id);
    channels.push(Object.freeze({ ...channel }));
  }

  const correctionIds = new Set<string>();
  const corrections: StudioCorrectiveCorrection[] = [];
  for (let index = 0; index < graph.corrections.length; index += 1) {
    const correction = graph.corrections[index];
    const path = `$.corrections[${index}]`;
    if (
      !correction
      || !validIdentifier(correction.id)
      || !Number.isSafeInteger(correction.priority)
      || !["multiply", "minimum", "mean"].includes(correction.combine)
      || !Array.isArray(correction.terms)
      || correction.terms.length < 1
      || correction.terms.length
        > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxTermsPerCorrection
      || !Array.isArray(correction.outputs)
      || correction.outputs.length < 1
      || correction.outputs.length
        > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxOutputsPerCorrection
    ) {
      return failure("invalid-graph", path, "correction is invalid");
    }
    if (correctionIds.has(correction.id)) {
      return failure("duplicate-id", `${path}.id`, "duplicate correction id");
    }
    correctionIds.add(correction.id);

    const terms: StudioCorrectiveDriverTerm[] = [];
    const termDriverIds = new Set<string>();
    for (let termIndex = 0; termIndex < correction.terms.length; termIndex += 1) {
      const term = correction.terms[termIndex];
      const termPath = `${path}.terms[${termIndex}]`;
      if (!term || !driverIds.has(term.driverId)) {
        return failure(
          "missing-reference",
          `${termPath}.driverId`,
          "driver reference does not exist",
        );
      }
      if (termDriverIds.has(term.driverId)) {
        return failure(
          "duplicate-id",
          `${termPath}.driverId`,
          "a correction cannot reference one driver twice",
        );
      }
      termDriverIds.add(term.driverId);
      const curve = validCurve(term.curve, `${termPath}.curve`);
      if (!curve.ok) return curve;
      if (curve.value.some((point) => point.output < 0 || point.output > 1)) {
        return failure(
          "invalid-graph",
          `${termPath}.curve`,
          "driver activation must stay within 0..1",
        );
      }
      terms.push(Object.freeze({ driverId: term.driverId, curve: curve.value }));
    }

    const outputs: StudioCorrectiveOutput[] = [];
    const outputChannelIds = new Set<string>();
    for (
      let outputIndex = 0;
      outputIndex < correction.outputs.length;
      outputIndex += 1
    ) {
      const output = correction.outputs[outputIndex];
      const outputPath = `${path}.outputs[${outputIndex}]`;
      if (!output || !channelIds.has(output.channelId)) {
        return failure(
          "missing-reference",
          `${outputPath}.channelId`,
          "channel reference does not exist",
        );
      }
      if (outputChannelIds.has(output.channelId)) {
        return failure(
          "duplicate-id",
          `${outputPath}.channelId`,
          "a correction cannot target one channel twice",
        );
      }
      outputChannelIds.add(output.channelId);
      const curve = validCurve(output.curve, `${outputPath}.curve`);
      if (!curve.ok) return curve;
      if (
        curve.value[0].input !== 0
        || curve.value[curve.value.length - 1].input !== 1
      ) {
        return failure(
          "invalid-graph",
          `${outputPath}.curve`,
          "output curve must span activation 0..1",
        );
      }
      outputs.push(
        Object.freeze({ channelId: output.channelId, curve: curve.value }),
      );
    }
    corrections.push(
      Object.freeze({
        id: correction.id,
        priority: correction.priority,
        combine: correction.combine,
        terms: Object.freeze(terms),
        outputs: Object.freeze(outputs),
      }),
    );
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      kind: "studio-corrective-driver-graph",
      version: STUDIO_CORRECTIVE_DRIVER_GRAPH_VERSION,
      graphId: graph.graphId,
      revision: graph.revision,
      drivers: Object.freeze(drivers),
      channels: Object.freeze(channels),
      corrections: Object.freeze(corrections),
    }),
  });
}

export function compileStudioCorrectiveDriverGraph(
  graph: StudioCorrectiveDriverGraph,
): StudioCorrectiveGraphResult<StudioCompiledCorrectiveDriverGraph> {
  const validated = cloneAndValidateGraph(graph);
  if (!validated.ok) return validated;
  const value = validated.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      graph: value,
      graphSha256: `sha256:${sha256HexPortable(canonicalGraphJson(value))}`,
      driverIds: Object.freeze(value.drivers.map((driver) => driver.id)),
      channelIds: Object.freeze(value.channels.map((channel) => channel.id)),
    }),
  });
}

function combinedActivation(
  correction: StudioCorrectiveCorrection,
  driverValues: StudioCorrectiveDriverValues,
): number {
  const activations = correction.terms.map((term) => {
    const value = driverValues[term.driverId];
    return interpolateCurve(term.curve, finite(value) ? value : 0);
  });
  switch (correction.combine) {
    case "multiply":
      return activations.reduce((product, activation) => product * activation, 1);
    case "minimum":
      return Math.min(...activations);
    case "mean":
      return activations.reduce((sum, activation) => sum + activation, 0)
        / activations.length;
  }
}

function resolveContributions(
  channel: StudioCorrectiveChannel,
  contributions: readonly MutableContribution[],
  baseValue: number,
): number {
  if (contributions.length === 0) return baseValue;
  let delta = 0;
  switch (channel.conflictPolicy) {
    case "additive":
      delta = contributions.reduce(
        (sum, contribution) => sum + contribution.delta,
        0,
      );
      break;
    case "maximum-magnitude": {
      const winner = [...contributions].sort(
        (left, right) =>
          Math.abs(right.delta) - Math.abs(left.delta)
          || right.priority - left.priority
          || left.correctionId.localeCompare(right.correctionId),
      )[0];
      delta = winner.delta;
      break;
    }
    case "priority-override": {
      const winner = [...contributions].sort(
        (left, right) =>
          right.priority - left.priority
          || right.activation - left.activation
          || left.correctionId.localeCompare(right.correctionId),
      )[0];
      delta = winner.delta;
      break;
    }
    case "normalized-blend": {
      const activationSum = contributions.reduce(
        (sum, contribution) => sum + contribution.activation,
        0,
      );
      delta = activationSum > 0
        ? contributions.reduce(
          (sum, contribution) =>
            sum + contribution.delta * contribution.activation,
          0,
        ) / activationSum
        : 0;
      break;
    }
  }
  return Math.min(channel.maximum, Math.max(channel.minimum, baseValue + delta));
}

export function evaluateStudioCorrectiveDriverGraph(
  compiled: StudioCompiledCorrectiveDriverGraph,
  driverValues: StudioCorrectiveDriverValues,
  baseOverrides: StudioCorrectiveChannelValues = {},
): StudioCorrectiveEvaluation {
  const contributionMap = new Map<string, MutableContribution[]>();
  const activations: Record<string, number> = {};
  for (const correction of compiled.graph.corrections) {
    const activation = Math.min(
      1,
      Math.max(0, combinedActivation(correction, driverValues)),
    );
    activations[correction.id] = activation;
    if (activation <= 0) continue;
    for (const output of correction.outputs) {
      const delta = interpolateCurve(output.curve, activation);
      const list = contributionMap.get(output.channelId) ?? [];
      list.push({
        correctionId: correction.id,
        priority: correction.priority,
        activation,
        delta,
      });
      contributionMap.set(output.channelId, list);
    }
  }

  const channels: Record<string, number> = {};
  const immutableContributions: Record<
    string,
    readonly StudioCorrectiveContribution[]
  > = {};
  for (const channel of compiled.graph.channels) {
    const requestedBase = baseOverrides[channel.id];
    const baseValue = finite(requestedBase)
      ? Math.min(channel.maximum, Math.max(channel.minimum, requestedBase))
      : channel.baseValue;
    const contributions = contributionMap.get(channel.id) ?? [];
    channels[channel.id] = resolveContributions(
      channel,
      contributions,
      baseValue,
    );
    immutableContributions[channel.id] = Object.freeze(
      contributions.map((contribution) => Object.freeze({ ...contribution })),
    );
  }

  return Object.freeze({
    graphId: compiled.graph.graphId,
    revision: compiled.graph.revision,
    channels: Object.freeze(channels),
    activations: Object.freeze(activations),
    contributions: Object.freeze(immutableContributions),
  });
}

export function previewStudioCorrectiveDriver(
  compiled: StudioCompiledCorrectiveDriverGraph,
  driverValues: StudioCorrectiveDriverValues,
  focusDriverId: string,
  offsets: readonly number[],
  baseOverrides: StudioCorrectiveChannelValues = {},
): readonly StudioCorrectivePreviewFrame[] {
  if (!compiled.driverIds.includes(focusDriverId)) {
    throw new Error(`unknown corrective driver: ${focusDriverId}`);
  }
  if (
    offsets.length > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxCurvePoints
    || offsets.some((offset) => !finite(offset))
  ) {
    throw new Error("corrective preview offsets are invalid");
  }
  const current = finite(driverValues[focusDriverId])
    ? driverValues[focusDriverId]
    : 0;
  return Object.freeze(
    offsets.map((offset) => {
      const driverValue = current + offset;
      const nextDrivers = { ...driverValues, [focusDriverId]: driverValue };
      return Object.freeze({
        offset,
        driverValue,
        evaluation: evaluateStudioCorrectiveDriverGraph(
          compiled,
          nextDrivers,
          baseOverrides,
        ),
      });
    }),
  );
}

function float32Bytes(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, values[index], true);
  }
  return bytes;
}

export function bakeStudioCorrectiveDriverGraph(
  compiled: StudioCompiledCorrectiveDriverGraph,
  samples: readonly StudioCorrectiveBakeSample[],
  baseOverrides: StudioCorrectiveChannelValues = {},
): StudioCorrectiveBake {
  if (
    samples.length > STUDIO_CORRECTIVE_DRIVER_GRAPH_BUDGETS.maxBakeSamples
    || samples.some(
      (sample) =>
        !validIdentifier(sample.sampleId)
        || Object.values(sample.drivers).some((value) => !finite(value)),
    )
  ) {
    throw new Error("corrective bake sample budget or value is invalid");
  }
  const sampleIds = samples.map((sample) => sample.sampleId);
  if (new Set(sampleIds).size !== sampleIds.length) {
    throw new Error("corrective bake sample ids must be unique");
  }
  const values = new Float32Array(
    samples.length * compiled.channelIds.length,
  );
  samples.forEach((sample, sampleIndex) => {
    const evaluation = evaluateStudioCorrectiveDriverGraph(
      compiled,
      sample.drivers,
      baseOverrides,
    );
    compiled.channelIds.forEach((channelId, channelIndex) => {
      values[sampleIndex * compiled.channelIds.length + channelIndex] =
        evaluation.channels[channelId] ?? 0;
    });
  });
  return Object.freeze({
    kind: "studio-corrective-driver-bake",
    version: 1,
    graphId: compiled.graph.graphId,
    graphRevision: compiled.graph.revision,
    graphSha256: compiled.graphSha256,
    channelIds: Object.freeze([...compiled.channelIds]),
    sampleIds: Object.freeze(sampleIds),
    values,
    valuesSha256: `sha256:${sha256HexPortable(float32Bytes(values))}`,
  });
}
