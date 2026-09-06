/**
 * Bounded W3C InkML interchange for ToonSpectrum digital ink.
 *
 * This is an independent implementation of a small, documented InkML profile. It does not use a
 * commercial SDK, a proprietary `.will` codec, or a hardware identifier. The profile intentionally
 * carries only renderer-relevant sample channels; the richer ToonSpectrum document/brush contract
 * remains authoritative in the native project envelope.
 */

import type { DrawEl } from "./studio-element-model";

export const STUDIO_INKML_NAMESPACE = "http://www.w3.org/2003/InkML";
export const STUDIO_INKML_PROFILE = "toonspectrum-inkml-v1" as const;
export const STUDIO_INKML_MEDIA_TYPE = "application/inkml+xml" as const;

export const STUDIO_INKML_LIMITS = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxStrokes: 100_000,
  maxSamples: 2_000_000,
  maxSamplesPerStroke: 200_000,
  maxIdLength: 128,
  maxXmlDepth: 256,
  maxElements: 250_000,
  maxTraceFormats: 4_096,
  maxContexts: 100_000,
  maxChannelsPerFormat: 64,
  maxNumericTokenCharacters: 96,
});

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const PROFILE_ANNOTATION_TYPE =
  "application/vnd.toonspectrum.inkml-profile";
const TRACE_FORMAT_ID = "toonspectrum-trace-format-v1";
const CONTEXT_ID = "toonspectrum-context-v1";
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/u;
const INTEGER_NUMBER_PATTERN = /^[+-]?\d+$/u;
const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
const DOUBLE_NUMBER_PATTERN =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const MAX_COORDINATE = 1_000_000_000;
const TEXT_ENCODER = new TextEncoder();
const CHANNEL_NAMES = [
  "X",
  "Y",
  "F",
  "OTx",
  "OTy",
  "OR",
  "TS.S",
  "TS.TP",
] as const;

type StudioInkMlChannelName = (typeof CHANNEL_NAMES)[number];

/**
 * Canonical InkML channel ordering uses JavaScript/JSON UTF-16 code-unit order, never the host
 * locale. Keeping the comparator public lets the byte transport validator and XML decoder share
 * exactly one deterministic rule.
 */
export function compareStudioInkMlChannelNames(
  left: string,
  right: string,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface StudioInkMlTraceInput {
  readonly id: string;
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly tiltXs?: readonly number[];
  readonly tiltYs?: readonly number[];
  readonly twists?: readonly number[];
  readonly speeds?: readonly number[];
  readonly tangentialPressures?: readonly number[];
}

export interface StudioInkMlTrace {
  readonly id: string;
  readonly points: readonly number[];
  readonly pressures: readonly number[];
  readonly tiltXs: readonly number[];
  readonly tiltYs: readonly number[];
  readonly twists: readonly number[];
  readonly speeds: readonly number[];
  readonly tangentialPressures: readonly number[];
}

export interface StudioInkMlDocument {
  readonly profile: typeof STUDIO_INKML_PROFILE | "inkml-basic";
  readonly traces: readonly StudioInkMlTrace[];
  readonly ignoredChannels: readonly string[];
}

export interface StudioInkMlCodecOptions {
  readonly maxBytes?: number;
  readonly maxStrokes?: number;
  readonly maxSamples?: number;
  readonly maxSamplesPerStroke?: number;
}

export class StudioInkMlCodecError extends Error {
  readonly code:
    | "runtime-unavailable"
    | "invalid-document"
    | "unsupported-profile"
    | "unsupported-channel-encoding"
    | "limit-exceeded";

  constructor(
    code: StudioInkMlCodecError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioInkMlCodecError";
    this.code = code;
  }
}

interface ResolvedLimits {
  readonly maxBytes: number;
  readonly maxStrokes: number;
  readonly maxSamples: number;
  readonly maxSamplesPerStroke: number;
}

interface ParsedChannel {
  readonly name: string;
  readonly type: "integer" | "decimal" | "double";
  readonly units: string | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

const PROFILE_CHANNEL_CONTRACT: readonly ParsedChannel[] = Object.freeze([
  Object.freeze({ name: "X", type: "decimal", units: "px", minimum: null, maximum: null }),
  Object.freeze({ name: "Y", type: "decimal", units: "px", minimum: null, maximum: null }),
  Object.freeze({ name: "F", type: "decimal", units: "%", minimum: 0, maximum: 1 }),
  Object.freeze({ name: "OTx", type: "decimal", units: "deg", minimum: -90, maximum: 90 }),
  Object.freeze({ name: "OTy", type: "decimal", units: "deg", minimum: -90, maximum: 90 }),
  Object.freeze({ name: "OR", type: "decimal", units: "deg", minimum: 0, maximum: 360 }),
  Object.freeze({ name: "TS.S", type: "decimal", units: "px/ms", minimum: 0, maximum: null }),
  Object.freeze({ name: "TS.TP", type: "decimal", units: "dev", minimum: -1, maximum: 1 }),
]);

function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > maximum
  ) {
    return fail(
      "limit-exceeded",
      `${label} 예산은 1 이상 ${maximum} 이하의 안전한 정수여야 합니다.`,
    );
  }
  return value;
}

function limitsOf(options: StudioInkMlCodecOptions): ResolvedLimits {
  return Object.freeze({
    maxBytes: boundedPositiveInteger(
      options.maxBytes,
      STUDIO_INKML_LIMITS.maxBytes,
      STUDIO_INKML_LIMITS.maxBytes,
      "InkML 바이트",
    ),
    maxStrokes: boundedPositiveInteger(
      options.maxStrokes,
      STUDIO_INKML_LIMITS.maxStrokes,
      STUDIO_INKML_LIMITS.maxStrokes,
      "InkML 획",
    ),
    maxSamples: boundedPositiveInteger(
      options.maxSamples,
      STUDIO_INKML_LIMITS.maxSamples,
      STUDIO_INKML_LIMITS.maxSamples,
      "InkML 전체 샘플",
    ),
    maxSamplesPerStroke: boundedPositiveInteger(
      options.maxSamplesPerStroke,
      STUDIO_INKML_LIMITS.maxSamplesPerStroke,
      STUDIO_INKML_LIMITS.maxSamplesPerStroke,
      "InkML 단일 획 샘플",
    ),
  });
}

function fail(
  code: StudioInkMlCodecError["code"],
  message: string,
): never {
  throw new StudioInkMlCodecError(code, message);
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    return fail("invalid-document", `${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function decimal(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const fixed = normalized.toFixed(6);
  return fixed.replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1");
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeId(value: unknown, fallback: string): string {
  if (
    typeof value === "string"
    && value.length <= STUDIO_INKML_LIMITS.maxIdLength
    && ID_PATTERN.test(value)
  ) {
    return value;
  }
  return fallback;
}

function aligned(
  values: readonly number[] | undefined,
  index: number,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const value = values?.[index] ?? fallback;
  return finiteInRange(value, minimum, maximum, label);
}

/**
 * Pointer Events twist increases clockwise, while InkML OR increases counter-clockwise.
 * Both domains are normalized to [0, 360), so the conversion is its own inverse.
 */
function oppositeRotationDirection(value: number): number {
  return value === 0 ? 0 : 360 - value;
}

function pointerTwist(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value >= 360
  ) {
    return fail("invalid-document", "펜 회전 값이 허용 범위를 벗어났습니다.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function sampleCountOf(
  trace: StudioInkMlTraceInput,
  limits: ResolvedLimits,
): number {
  if (
    !Array.isArray(trace.points)
    || trace.points.length === 0
    || trace.points.length % 2 !== 0
  ) {
    return fail("invalid-document", "InkML 획의 좌표 배열이 올바르지 않습니다.");
  }
  const count = trace.points.length / 2;
  if (count > limits.maxSamplesPerStroke) {
    return fail("limit-exceeded", "InkML 단일 획 샘플 예산을 초과했습니다.");
  }
  return count;
}

function assertOptionalChannelLengths(
  trace: StudioInkMlTraceInput,
  sampleCount: number,
): void {
  const channels = [
    ["pressures", trace.pressures],
    ["tiltXs", trace.tiltXs],
    ["tiltYs", trace.tiltYs],
    ["twists", trace.twists],
    ["speeds", trace.speeds],
    ["tangentialPressures", trace.tangentialPressures],
  ] as const;
  for (const [name, values] of channels) {
    if (values !== undefined && values.length !== sampleCount) {
      fail(
        "invalid-document",
        `InkML ${name} 채널 길이가 좌표 샘플 수와 다릅니다.`,
      );
    }
  }
}

function traceText(
  trace: StudioInkMlTraceInput,
  sampleCount: number,
  maximumCharacters: number,
): string {
  const samples = new Array<string>(sampleCount);
  let emittedCharacters = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const x = finiteInRange(
      trace.points[index * 2],
      -MAX_COORDINATE,
      MAX_COORDINATE,
      "X 좌표",
    );
    const y = finiteInRange(
      trace.points[index * 2 + 1],
      -MAX_COORDINATE,
      MAX_COORDINATE,
      "Y 좌표",
    );
    const pressure = aligned(
      trace.pressures,
      index,
      0.5,
      0,
      1,
      "필압",
    );
    const tiltX = aligned(trace.tiltXs, index, 0, -90, 90, "X 기울기");
    const tiltY = aligned(trace.tiltYs, index, 0, -90, 90, "Y 기울기");
    const twist = oppositeRotationDirection(
      pointerTwist(trace.twists?.[index] ?? 0),
    );
    const speed = aligned(
      trace.speeds,
      index,
      0,
      0,
      1_000_000,
      "포인터 속도",
    );
    const tangential = aligned(
      trace.tangentialPressures,
      index,
      0,
      -1,
      1,
      "배럴 압력",
    );
    const sample = [
      x,
      y,
      pressure,
      tiltX,
      tiltY,
      twist,
      speed,
      tangential,
    ].map(decimal).join(" ");
    emittedCharacters += sample.length + (index === 0 ? 0 : 1);
    if (emittedCharacters > maximumCharacters) {
      fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
    }
    samples[index] = sample;
  }
  return samples.join(",");
}

function assertOutputBudget(value: string, limits: ResolvedLimits): void {
  if (TEXT_ENCODER.encode(value).byteLength > limits.maxBytes) {
    fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
  }
}

/** Encodes the deterministic ToonSpectrum InkML profile. */
export function encodeStudioInkMl(
  traces: readonly StudioInkMlTraceInput[],
  options: StudioInkMlCodecOptions = {},
): string {
  const limits = limitsOf(options);
  if (!Array.isArray(traces) || traces.length > limits.maxStrokes) {
    return fail("limit-exceeded", "InkML 획 개수 예산을 초과했습니다.");
  }

  const prefix = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<ink xmlns="${STUDIO_INKML_NAMESPACE}">`,
    `<annotation type="${PROFILE_ANNOTATION_TYPE}">${STUDIO_INKML_PROFILE}</annotation>`,
    "<definitions>",
    `<traceFormat xml:id="${TRACE_FORMAT_ID}">`,
    "<channel name=\"X\" type=\"decimal\" units=\"px\"/>",
    "<channel name=\"Y\" type=\"decimal\" units=\"px\"/>",
    "<channel name=\"F\" type=\"decimal\" min=\"0\" max=\"1\" units=\"%\"/>",
    "<channel name=\"OTx\" type=\"decimal\" min=\"-90\" max=\"90\" units=\"deg\"/>",
    "<channel name=\"OTy\" type=\"decimal\" min=\"-90\" max=\"90\" units=\"deg\"/>",
    "<channel name=\"OR\" type=\"decimal\" min=\"0\" max=\"360\" units=\"deg\"/>",
    "<channel name=\"TS.S\" type=\"decimal\" min=\"0\" units=\"px/ms\"/>",
    "<channel name=\"TS.TP\" type=\"decimal\" min=\"-1\" max=\"1\" units=\"dev\"/>",
    "</traceFormat>",
    "</definitions>",
    `<context xml:id="${CONTEXT_ID}" traceFormatRef="#${TRACE_FORMAT_ID}"/>`,
  ].join("");
  const suffix = "</ink>";
  let totalCharacters = prefix.length + suffix.length;
  if (totalCharacters > limits.maxBytes) {
    return fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
  }

  let totalSamples = 0;
  const emittedTraceIds = new Set<string>();
  const encodedTraces = traces.map((trace, index) => {
    const sampleCount = sampleCountOf(trace, limits);
    assertOptionalChannelLengths(trace, sampleCount);
    totalSamples += sampleCount;
    if (totalSamples > limits.maxSamples) {
      return fail("limit-exceeded", "InkML 전체 샘플 예산을 초과했습니다.");
    }
    const id = normalizeId(trace.id, `trace-${index + 1}`);
    if (emittedTraceIds.has(id)) {
      return fail("invalid-document", "InkML 획 ID가 중복되었습니다.");
    }
    emittedTraceIds.add(id);
    const opening =
      `<trace xml:id="${xmlAttribute(id)}" contextRef="#${CONTEXT_ID}" type="penDown">`;
    const closing = "</trace>";
    const bodyBudget =
      limits.maxBytes - totalCharacters - opening.length - closing.length;
    if (bodyBudget < 1) {
      return fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
    }
    const body = traceText(trace, sampleCount, bodyBudget);
    const encodedTrace = `${opening}${body}${closing}`;
    totalCharacters += encodedTrace.length;
    if (totalCharacters > limits.maxBytes) {
      return fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
    }
    return encodedTrace;
  });

  const xml = `${prefix}${encodedTraces.join("")}${suffix}`;
  assertOutputBudget(xml, limits);
  return xml;
}

function directChildren(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter(
    (child) =>
      child.namespaceURI === STUDIO_INKML_NAMESPACE
      && child.localName === localName,
  );
}

function elementId(element: Element): string | null {
  return element.getAttributeNS(XML_NAMESPACE, "id") ?? element.getAttribute("xml:id");
}

function assertOnlyAttributes(
  element: Element,
  allowedUnqualified: ReadonlySet<string>,
  allowXmlId: boolean,
  code: StudioInkMlCodecError["code"],
  message: string,
): void {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === XMLNS_NAMESPACE) continue;
    if (
      allowXmlId
      && attribute.namespaceURI === XML_NAMESPACE
      && attribute.localName === "id"
    ) {
      continue;
    }
    if (
      attribute.namespaceURI === null
      && allowedUnqualified.has(attribute.localName)
    ) {
      continue;
    }
    fail(code, message);
  }
}

function numericPattern(type: ParsedChannel["type"]): RegExp {
  if (type === "integer") return INTEGER_NUMBER_PATTERN;
  return type === "decimal"
    ? DECIMAL_NUMBER_PATTERN
    : DOUBLE_NUMBER_PATTERN;
}

function parseOptionalNumber(
  value: string | null,
  label: string,
  type: ParsedChannel["type"],
): number | null {
  if (value === null || value === "") return null;
  if (!numericPattern(type).test(value)) {
    return fail(
      "unsupported-channel-encoding",
      `${label} 채널 경계 숫자 문법이 ${type} 형식과 다릅니다.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fail("invalid-document", `${label} 채널 경계가 올바르지 않습니다.`);
  }
  return parsed;
}

function assertSupportedChannelSemantics(channel: ParsedChannel): void {
  const allowedUnits: Readonly<Record<StudioInkMlChannelName, readonly (string | null)[]>> = {
    X: [null, "px"],
    Y: [null, "px"],
    F: [null, "%", "dev"],
    OTx: [null, "deg", "rad"],
    OTy: [null, "deg", "rad"],
    OR: [null, "deg", "rad"],
    "TS.S": [null, "px/ms"],
    "TS.TP": [null, "dev"],
  };
  if (
    CHANNEL_NAMES.includes(channel.name as StudioInkMlChannelName)
    && !allowedUnits[channel.name as StudioInkMlChannelName].includes(
      channel.units,
    )
  ) {
    fail(
      "unsupported-channel-encoding",
      `InkML ${channel.name} 채널 단위 ${channel.units ?? "(없음)"}를 안전하게 해석할 수 없습니다.`,
    );
  }
  if (
    channel.minimum !== null
    && channel.maximum !== null
    && channel.maximum <= channel.minimum
  ) {
    fail(
      "invalid-document",
      `InkML ${channel.name} 채널의 min/max 범위가 올바르지 않습니다.`,
    );
  }
  if (
    channel.name === "F"
    && channel.units === "dev"
    && (channel.minimum === null || channel.maximum === null)
  ) {
    fail(
      "unsupported-channel-encoding",
      "InkML device 필압 채널에는 정규화를 위한 min/max가 모두 필요합니다.",
    );
  }
  if (channel.name === "TS.S" && channel.units !== "px/ms") {
    fail(
      "unsupported-channel-encoding",
      "InkML TS.S 속도 채널에는 px/ms 단위가 필요합니다.",
    );
  }
  if (
    channel.name === "TS.TP"
    && (
      channel.units !== "dev"
      || channel.minimum === null
      || channel.maximum === null
    )
  ) {
    fail(
      "unsupported-channel-encoding",
      "InkML TS.TP 배럴 압력에는 dev 단위와 min/max가 모두 필요합니다.",
    );
  }
}

function channelsOf(format: Element): readonly ParsedChannel[] {
  const channels: ParsedChannel[] = [];
  for (let index = 0; index < format.children.length; index += 1) {
    const element = format.children.item(index);
    if (!element || element.namespaceURI !== STUDIO_INKML_NAMESPACE) continue;
    if (element.localName === "intermittentChannels") {
      return fail(
        "unsupported-channel-encoding",
        "간헐 채널이 포함된 InkML traceFormat은 아직 지원하지 않습니다.",
      );
    }
    if (element.localName !== "channel") continue;
    if (channels.length >= STUDIO_INKML_LIMITS.maxChannelsPerFormat) {
      return fail(
        "limit-exceeded",
        "InkML traceFormat 채널 개수 예산을 초과했습니다.",
      );
    }
    const name = element.getAttribute("name");
    if (!name) {
      return fail("invalid-document", "InkML 채널 이름이 없습니다.");
    }
    const type = element.getAttribute("type") ?? "decimal";
    if (!["integer", "decimal", "double"].includes(type)) {
      return fail(
        "unsupported-channel-encoding",
        `InkML 숫자 채널 형식 ${type}을 지원하지 않습니다.`,
      );
    }
    const parsedType = type as ParsedChannel["type"];
    const orientation = element.getAttribute("orientation");
    if (orientation !== null && orientation !== "+ve") {
      return fail(
        "unsupported-channel-encoding",
        `InkML ${name} 채널의 ${orientation} orientation은 안전 프로필에서 지원하지 않습니다.`,
      );
    }
    if (
      element.hasAttribute("respectTo")
      || element.children.length > 0
    ) {
      return fail(
        "unsupported-channel-encoding",
        `InkML ${name} 채널의 respectTo 또는 mapping은 안전 프로필에서 지원하지 않습니다.`,
      );
    }
    channels.push(Object.freeze({
      name,
      type: parsedType,
      units: element.getAttribute("units"),
      minimum: parseOptionalNumber(element.getAttribute("min"), name, parsedType),
      maximum: parseOptionalNumber(element.getAttribute("max"), name, parsedType),
    }));
  }
  channels.forEach(assertSupportedChannelSemantics);
  const names = new Set(channels.map((channel) => channel.name));
  if (names.size !== channels.length) {
    return fail("invalid-document", "InkML traceFormat 채널 이름이 중복되었습니다.");
  }
  if (!names.has("X") || !names.has("Y")) {
    return fail("invalid-document", "InkML traceFormat에 X/Y 채널이 필요합니다.");
  }
  return Object.freeze(channels);
}

function parseNumericSample(
  text: string,
  channels: readonly ParsedChannel[],
): readonly number[] {
  const expectedValues = channels.length;
  if (
    text.length
      > expectedValues * STUDIO_INKML_LIMITS.maxNumericTokenCharacters
  ) {
    return fail(
      "limit-exceeded",
      "InkML 숫자 샘플 토큰 길이 예산을 초과했습니다.",
    );
  }
  const tokens = text.trim().split(/\s+/u);
  if (
    tokens.length !== expectedValues
    || tokens.some((token) => /^['"*]/u.test(token))
  ) {
    return fail(
      "unsupported-channel-encoding",
      "InkML 상대·미분 압축 또는 채널 개수가 다른 샘플은 지원하지 않습니다.",
    );
  }
  const values = tokens.map((token, index) => {
    const channel = channels[index]!;
    const pattern = numericPattern(channel.type);
    if (!pattern.test(token)) {
      return fail(
        "unsupported-channel-encoding",
        `InkML ${channel.name} 채널 숫자 문법이 ${channel.type} 형식과 다릅니다.`,
      );
    }
    const value = Number(token);
    if (
      (channel.minimum !== null && value < channel.minimum)
      || (channel.maximum !== null && value > channel.maximum)
    ) {
      return fail(
        "invalid-document",
        `InkML ${channel.name} 채널 값이 선언된 min/max 범위를 벗어났습니다.`,
      );
    }
    return value;
  });
  if (values.some((value) => !Number.isFinite(value))) {
    return fail("invalid-document", "InkML 샘플에 유한하지 않은 숫자가 있습니다.");
  }
  return Object.freeze(values);
}

function normalizedPressure(value: number, channel: ParsedChannel): number {
  if (channel.units === null || channel.units === "%") {
    return finiteInRange(value, 0, 1, "필압");
  }
  if (
    channel.minimum !== null
    && channel.maximum !== null
    && channel.maximum > channel.minimum
  ) {
    return finiteInRange(
      (value - channel.minimum) / (channel.maximum - channel.minimum),
      0,
      1,
      "필압",
    );
  }
  return finiteInRange(value, 0, 1, "필압");
}

function normalizedTangentialPressure(
  value: number,
  channel: ParsedChannel,
): number {
  if (
    channel.units !== "dev"
    || channel.minimum === null
    || channel.maximum === null
    || channel.maximum <= channel.minimum
  ) {
    return fail(
      "unsupported-channel-encoding",
      "InkML 배럴 압력의 정규화 범위를 해석할 수 없습니다.",
    );
  }
  if (channel.minimum === -1 && channel.maximum === 1) {
    return finiteInRange(value, -1, 1, "배럴 압력");
  }
  return finiteInRange(
    ((value - channel.minimum) / (channel.maximum - channel.minimum)) * 2 - 1,
    -1,
    1,
    "배럴 압력",
  );
}

function traceFormatIdFromReference(value: string | null): string | null {
  return value?.startsWith("#") ? value.slice(1) : null;
}

function resolveTraceChannels(
  trace: Element,
  formats: ReadonlyMap<string, readonly ParsedChannel[]>,
  contexts: ReadonlyMap<string, string>,
): readonly ParsedChannel[] {
  const contextReference = trace.getAttribute("contextRef");
  if (contextReference !== null) {
    const contextId = traceFormatIdFromReference(contextReference);
    if (!contextId) {
      return fail(
        "unsupported-channel-encoding",
        "InkML trace의 contextRef 형식을 지원하지 않습니다.",
      );
    }
    const formatId = contexts.get(contextId);
    if (!formatId) {
      return fail(
        "unsupported-channel-encoding",
        "InkML trace의 contextRef를 해석할 수 없습니다.",
      );
    }
    const channels = formats.get(formatId);
    if (!channels) {
      return fail(
        "unsupported-channel-encoding",
        "InkML context가 참조하는 traceFormat을 찾을 수 없습니다.",
      );
    }
    return channels;
  }
  // A traceFormat inside <definitions> is declarative only; it does not become the current format.
  // Without an explicit/inherited context this bounded profile follows InkML's DefaultTraceFormat.
  return Object.freeze([
    {
      name: "X",
      type: "decimal",
      units: null,
      minimum: null,
      maximum: null,
    },
    {
      name: "Y",
      type: "decimal",
      units: null,
      minimum: null,
      maximum: null,
    },
  ]);
}

function angleDegrees(
  value: number,
  channel: ParsedChannel,
): number {
  return channel.units === "rad" ? value * 180 / Math.PI : value;
}

function fullTurnDegrees(
  value: number,
  channel: ParsedChannel,
  label: string,
): number {
  const degrees = finiteInRange(
    angleDegrees(value, channel),
    0,
    360,
    label,
  );
  return degrees === 360 ? 0 : degrees;
}

function parser(): DOMParser {
  if (typeof DOMParser === "undefined") {
    return fail(
      "runtime-unavailable",
      "현재 런타임에 안전한 XML DOMParser가 없습니다.",
    );
  }
  return new DOMParser();
}

function assertSafeXmlSource(source: string, limits: ResolvedLimits): string {
  if (TEXT_ENCODER.encode(source).byteLength > limits.maxBytes) {
    return fail("limit-exceeded", "InkML 문서 바이트 예산을 초과했습니다.");
  }
  const withoutDeclaration = source.replace(
    /^\uFEFF?<\?xml\s+version=(?:"1\.[01]"|'1\.[01]')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>/iu,
    "",
  );
  if (
    /<!DOCTYPE|<!ENTITY|<!\[CDATA|<!--|<\?/iu.test(withoutDeclaration)
  ) {
    return fail(
      "unsupported-channel-encoding",
      "DTD, entity, CDATA, 주석 또는 처리 명령이 포함된 InkML은 지원하지 않습니다.",
    );
  }
  type XmlPreflightFrame = {
    readonly localName: string;
    directChannels: number;
  };
  const stack: XmlPreflightFrame[] = [];
  let elementStarts = 0;
  let traceFormats = 0;
  let contexts = 0;
  let traces = 0;
  for (let index = 0; index < withoutDeclaration.length; index += 1) {
    if (withoutDeclaration.charCodeAt(index) !== 0x3c) continue;
    const next = withoutDeclaration.charCodeAt(index + 1);
    const closing = next === 0x2f;
    const tagStart = index;
    const nameStart = tagStart + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (
      nameEnd < withoutDeclaration.length
      && !/[\s/>]/u.test(withoutDeclaration[nameEnd]!)
    ) nameEnd += 1;
    const qualifiedName = withoutDeclaration.slice(nameStart, nameEnd);
    if (qualifiedName.length === 0) {
      return fail("invalid-document", "InkML XML 태그 이름이 없습니다.");
    }
    const localName = qualifiedName.split(":").at(-1)!;
    let quote = 0;
    let tagEnd = -1;
    for (index += closing ? 2 : 1; index < withoutDeclaration.length; index += 1) {
      const character = withoutDeclaration.charCodeAt(index);
      if (quote !== 0) {
        if (character === quote) quote = 0;
        continue;
      }
      if (character === 0x22 || character === 0x27) {
        quote = character;
        continue;
      }
      if (character === 0x3c) {
        return fail(
          "invalid-document",
          "InkML XML 태그가 닫히기 전에 새 태그가 시작되었습니다.",
        );
      }
      if (character === 0x3e) {
        tagEnd = index;
        break;
      }
    }
    if (tagEnd < 0 || quote !== 0) {
      return fail("invalid-document", "InkML XML 태그가 완결되지 않았습니다.");
    }
    let beforeEnd = tagEnd - 1;
    while (
      beforeEnd > tagStart
      && /\s/u.test(withoutDeclaration[beforeEnd]!)
    ) beforeEnd -= 1;
    const selfClosing =
      !closing && withoutDeclaration.charCodeAt(beforeEnd) === 0x2f;

    if (closing) {
      if (stack.length === 0) {
        return fail(
          "invalid-document",
          "InkML XML 닫는 태그의 중첩 구조가 올바르지 않습니다.",
        );
      }
      stack.pop();
      continue;
    }

    elementStarts += 1;
    if (elementStarts > STUDIO_INKML_LIMITS.maxElements) {
      return fail(
        "limit-exceeded",
        "InkML XML 요소 개수 예산을 초과했습니다.",
      );
    }

    if (localName === "traceFormat") {
      traceFormats += 1;
      if (traceFormats > STUDIO_INKML_LIMITS.maxTraceFormats) {
        return fail(
          "limit-exceeded",
          "InkML traceFormat 개수 예산을 초과했습니다.",
        );
      }
    } else if (localName === "context") {
      contexts += 1;
      if (contexts > STUDIO_INKML_LIMITS.maxContexts) {
        return fail("limit-exceeded", "InkML context 개수 예산을 초과했습니다.");
      }
    } else if (localName === "trace") {
      traces += 1;
      if (traces > limits.maxStrokes) {
        return fail("limit-exceeded", "InkML 획 개수 예산을 초과했습니다.");
      }
    }

    const parent = stack.at(-1);
    if (parent?.localName === "traceFormat") {
      if (localName === "intermittentChannels") {
        return fail(
          "unsupported-channel-encoding",
          "간헐 채널이 포함된 InkML traceFormat은 아직 지원하지 않습니다.",
        );
      }
      if (localName === "channel") {
        parent.directChannels += 1;
        if (parent.directChannels > STUDIO_INKML_LIMITS.maxChannelsPerFormat) {
          return fail(
            "limit-exceeded",
            "InkML traceFormat 채널 개수 예산을 초과했습니다.",
          );
        }
      }
    }

    if (!selfClosing) {
      stack.push({ localName, directChannels: 0 });
      if (stack.length > STUDIO_INKML_LIMITS.maxXmlDepth) {
        return fail(
          "limit-exceeded",
          "InkML XML 중첩 깊이 예산을 초과했습니다.",
        );
      }
    }
  }
  return source;
}

function boundedSampleTexts(
  value: string,
  maximumSamples: number,
): readonly string[] {
  if (value === "") {
    return fail("invalid-document", "InkML 획에 샘플이 없습니다.");
  }
  let sampleCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x2c) continue;
    sampleCount += 1;
    if (sampleCount > maximumSamples) {
      return fail(
        "limit-exceeded",
        "InkML 단일 획 샘플 예산을 초과했습니다.",
      );
    }
  }
  return value.split(",");
}

function channelsMatchProfileContract(
  channels: readonly ParsedChannel[] | undefined,
): boolean {
  return channels?.length === PROFILE_CHANNEL_CONTRACT.length
    && channels.every((channel, index) => {
      const expected = PROFILE_CHANNEL_CONTRACT[index]!;
      return channel.name === expected.name
        && channel.type === expected.type
        && channel.units === expected.units
        && channel.minimum === expected.minimum
        && channel.maximum === expected.maximum;
    });
}

function hasNonWhitespaceDirectText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 && (node.textContent?.trim() ?? "") !== "",
  );
}

function assertDeclaredProfileContract(
  root: Element,
  formats: ReadonlyMap<string, readonly ParsedChannel[]>,
  contexts: ReadonlyMap<string, string>,
  traces: readonly Element[],
): void {
  const profileError = "선언된 ToonSpectrum InkML v1 구조가 정확한 프로필 계약과 다릅니다.";
  const rootChildren = Array.from(root.children);
  const definitions = directChildren(root, "definitions");
  const annotations = directChildren(root, "annotation");
  const directContexts = directChildren(root, "context");
  if (
    rootChildren.some((child) =>
      child.namespaceURI !== STUDIO_INKML_NAMESPACE
      || !["annotation", "definitions", "context", "trace"].includes(child.localName)
    )
    || rootChildren.length !== traces.length + 3
    || annotations.length !== 1
    || definitions.length !== 1
    || directContexts.length !== 1
    || formats.size !== 1
    || contexts.size !== 1
    || !channelsMatchProfileContract(formats.get(TRACE_FORMAT_ID))
    || contexts.get(CONTEXT_ID) !== TRACE_FORMAT_ID
    || hasNonWhitespaceDirectText(root)
  ) {
    fail("unsupported-profile", profileError);
  }

  assertOnlyAttributes(root, new Set(), false, "unsupported-profile", profileError);
  const annotation = annotations[0]!;
  assertOnlyAttributes(
    annotation,
    new Set(["type"]),
    false,
    "unsupported-profile",
    profileError,
  );

  const definition = definitions[0]!;
  assertOnlyAttributes(definition, new Set(), false, "unsupported-profile", profileError);
  if (
    definition.children.length !== 1
    || hasNonWhitespaceDirectText(definition)
  ) {
    fail("unsupported-profile", profileError);
  }
  const format = definition.children.item(0);
  if (
    !format
    || format.namespaceURI !== STUDIO_INKML_NAMESPACE
    || format.localName !== "traceFormat"
    || elementId(format) !== TRACE_FORMAT_ID
    || format.children.length !== PROFILE_CHANNEL_CONTRACT.length
    || hasNonWhitespaceDirectText(format)
  ) {
    fail("unsupported-profile", profileError);
  }
  assertOnlyAttributes(format, new Set(), true, "unsupported-profile", profileError);
  for (const channel of Array.from(format.children)) {
    if (
      channel.namespaceURI !== STUDIO_INKML_NAMESPACE
      || channel.localName !== "channel"
      || channel.children.length !== 0
      || hasNonWhitespaceDirectText(channel)
    ) {
      fail("unsupported-profile", profileError);
    }
    assertOnlyAttributes(
      channel,
      new Set(["name", "type", "units", "min", "max"]),
      false,
      "unsupported-profile",
      profileError,
    );
  }

  const context = directContexts[0]!;
  assertOnlyAttributes(
    context,
    new Set(["traceFormatRef"]),
    true,
    "unsupported-profile",
    profileError,
  );
  if (
    elementId(context) !== CONTEXT_ID
    || context.getAttribute("traceFormatRef") !== `#${TRACE_FORMAT_ID}`
    || context.children.length !== 0
    || (context.textContent?.trim() ?? "") !== ""
  ) {
    fail("unsupported-profile", profileError);
  }

  for (const trace of traces) {
    assertOnlyAttributes(
      trace,
      new Set(["contextRef", "type"]),
      true,
      "unsupported-profile",
      profileError,
    );
    if (
      !elementId(trace)
      || trace.getAttribute("contextRef") !== `#${CONTEXT_ID}`
      || trace.getAttribute("type") !== "penDown"
      || trace.children.length !== 0
    ) {
      fail("unsupported-profile", profileError);
    }
  }
}

/**
 * Decodes the ToonSpectrum profile and a bounded basic InkML subset. Unknown channels are reported
 * and ignored; relative/differential compression, intermittent channels, and unsafe XML constructs
 * fail closed.
 */
export function decodeStudioInkMl(
  source: string,
  options: StudioInkMlCodecOptions = {},
): StudioInkMlDocument {
  if (typeof source !== "string") {
    return fail("invalid-document", "InkML 입력은 문자열이어야 합니다.");
  }
  const limits = limitsOf(options);
  // Run every lexical budget before constructing even the parser. Some server-side DOM polyfills
  // allocate superlinearly for very wide XML, while native browser parsers are merely an
  // implementation detail and must not be the security boundary.
  const safeSource = assertSafeXmlSource(source, limits);
  const document = parser().parseFromString(safeSource, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    return fail("invalid-document", "InkML XML 문서를 해석할 수 없습니다.");
  }
  const root = document.documentElement;
  if (
    root.localName !== "ink"
    || root.namespaceURI !== STUDIO_INKML_NAMESPACE
  ) {
    return fail("invalid-document", "W3C InkML 네임스페이스의 ink 루트가 필요합니다.");
  }
  if (
    root.getElementsByTagName("*").length + 1
      > STUDIO_INKML_LIMITS.maxElements
  ) {
    return fail("limit-exceeded", "InkML XML 요소 개수 예산을 초과했습니다.");
  }

  const profileAnnotations = directChildren(root, "annotation").filter((annotation) =>
    annotation.getAttribute("type") === PROFILE_ANNOTATION_TYPE
  );
  if (profileAnnotations.length > 1) {
    return fail(
      "invalid-document",
      "ToonSpectrum InkML 프로필 선언이 중복되었습니다.",
    );
  }
  const profileAnnotation = profileAnnotations[0];
  if (
    profileAnnotation
    && (
      profileAnnotation.children.length !== 0
      || Array.from(profileAnnotation.childNodes).some(
        (node) => node.nodeType !== 3,
      )
    )
  ) {
    return fail(
      "unsupported-profile",
      "ToonSpectrum InkML 프로필 선언은 확장 요소 없는 정확한 텍스트여야 합니다.",
    );
  }
  const declaredProfile = profileAnnotation?.textContent ?? undefined;
  if (
    profileAnnotations.length === 1
    && declaredProfile !== STUDIO_INKML_PROFILE
  ) {
    return fail(
      "unsupported-profile",
      `지원하지 않는 ToonSpectrum InkML 프로필입니다: ${declaredProfile}`,
    );
  }

  const globalIds = new Set<string>();
  const registerElementId = (element: Element): void => {
    const id = elementId(element);
    if (id === null) return;
    if (!ID_PATTERN.test(id)) {
      fail("invalid-document", "InkML xml:id 형식이 올바르지 않습니다.");
    }
    if (globalIds.has(id)) {
      fail(
        "invalid-document",
        "InkML xml:id는 문서 전체에서 고유해야 합니다.",
      );
    }
    globalIds.add(id);
  };
  registerElementId(root);
  const descendantElements = root.getElementsByTagName("*");
  for (let index = 0; index < descendantElements.length; index += 1) {
    const element = descendantElements.item(index);
    if (element) registerElementId(element);
  }

  const formatElements = root.getElementsByTagNameNS(
    STUDIO_INKML_NAMESPACE,
    "traceFormat",
  );
  if (formatElements.length > STUDIO_INKML_LIMITS.maxTraceFormats) {
    return fail("limit-exceeded", "InkML traceFormat 개수 예산을 초과했습니다.");
  }
  const formatMap = new Map<string, readonly ParsedChannel[]>();
  const referenceableFormatIds = new Set<string>();
  for (const [index, format] of Array.from(formatElements).entries()) {
    if (
      format.parentElement?.localName !== "definitions"
      || format.parentElement.namespaceURI !== STUDIO_INKML_NAMESPACE
      || format.parentElement.parentElement !== root
    ) {
      return fail(
        "unsupported-channel-encoding",
        "스트리밍 current traceFormat은 안전 프로필에서 지원하지 않습니다.",
      );
    }
    const declaredId = elementId(format);
    const id = declaredId ?? `anonymous-format-${index}`;
    if (formatMap.has(id)) {
      return fail("invalid-document", "InkML traceFormat ID가 중복되었습니다.");
    }
    formatMap.set(id, channelsOf(format));
    if (declaredId !== null) referenceableFormatIds.add(declaredId);
  }

  const contextElements = root.getElementsByTagNameNS(
    STUDIO_INKML_NAMESPACE,
    "context",
  );
  if (contextElements.length > STUDIO_INKML_LIMITS.maxContexts) {
    return fail("limit-exceeded", "InkML context 개수 예산을 초과했습니다.");
  }
  const contextMap = new Map<string, string>();
  let hasStreamingContext = false;
  for (const context of Array.from(contextElements)) {
    const parent = context.parentElement;
    const isDirectRootContext = parent === root;
    const isDirectDefinitionContext =
      parent?.namespaceURI === STUDIO_INKML_NAMESPACE
      && parent.localName === "definitions"
      && parent.parentElement === root;
    if (!isDirectRootContext && !isDirectDefinitionContext) {
      return fail(
        "unsupported-channel-encoding",
        "InkML context는 ink 또는 그 직계 definitions 아래에만 둘 수 있습니다.",
      );
    }
    hasStreamingContext ||= isDirectRootContext;
    assertOnlyAttributes(
      context,
      new Set(["traceFormatRef"]),
      true,
      "unsupported-channel-encoding",
      "context 상속·캔버스·브러시·타임스탬프 의미는 안전 프로필에서 지원하지 않습니다.",
    );
    if (context.children.length !== 0 || (context.textContent?.trim() ?? "") !== "") {
      return fail(
        "unsupported-channel-encoding",
        "InkML context의 자식 요소는 안전 프로필에서 지원하지 않습니다.",
      );
    }
    const id = elementId(context);
    const reference = context.getAttribute("traceFormatRef");
    const formatId = traceFormatIdFromReference(reference);
    if (
      !id
      || !formatId
      || !ID_PATTERN.test(formatId)
      || !referenceableFormatIds.has(formatId)
    ) {
      return fail(
        "unsupported-channel-encoding",
        "InkML context에는 유효한 xml:id와 기존 traceFormat의 #참조가 필요합니다.",
      );
    }
    contextMap.set(id, formatId);
  }

  const traceNodeList = root.getElementsByTagNameNS(
    STUDIO_INKML_NAMESPACE,
    "trace",
  );
  if (traceNodeList.length > limits.maxStrokes) {
    return fail("limit-exceeded", "InkML 획 개수 예산을 초과했습니다.");
  }
  if (
    root.getElementsByTagNameNS(STUDIO_INKML_NAMESPACE, "traceGroup").length > 0
  ) {
    return fail(
      "unsupported-channel-encoding",
      "traceGroup 상속 context는 안전 프로필에서 지원하지 않습니다.",
    );
  }
  const traceElements = Array.from(traceNodeList);
  if (traceElements.some((trace) => trace.parentElement !== root)) {
    return fail(
      "unsupported-channel-encoding",
      "InkML trace는 안전 프로필에서 ink 루트의 직계 자식이어야 합니다.",
    );
  }
  if (declaredProfile === STUDIO_INKML_PROFILE) {
    assertDeclaredProfileContract(root, formatMap, contextMap, traceElements);
  }

  let totalSamples = 0;
  const ignoredChannels = new Set<string>();
  const decodedTraceIds = new Set<string>();
  const traces = traceElements.map((trace, traceIndex) => {
    const traceType = trace.getAttribute("type");
    if (traceType !== null && traceType !== "penDown") {
      return fail(
        "unsupported-channel-encoding",
        `InkML ${traceType} trace는 그리기 획으로 가져올 수 없습니다.`,
      );
    }
    if (
      trace.hasAttribute("continuation")
      || trace.hasAttribute("priorRef")
      || trace.hasAttribute("brushRef")
    ) {
      return fail(
        "unsupported-channel-encoding",
        "InkML continuation, priorRef 또는 brushRef trace는 안전 프로필에서 지원하지 않습니다.",
      );
    }
    if (hasStreamingContext && !trace.hasAttribute("contextRef")) {
      return fail(
        "unsupported-channel-encoding",
        "스트리밍 current context를 사용하는 trace는 명시적 contextRef가 필요합니다.",
      );
    }
    if (trace.children.length > 0) {
      return fail(
        "unsupported-channel-encoding",
        "InkML trace 내부의 요소 기반 확장은 안전 프로필에서 지원하지 않습니다.",
      );
    }
    const channels = resolveTraceChannels(trace, formatMap, contextMap);
    for (const channel of channels) {
      if (!CHANNEL_NAMES.includes(channel.name as StudioInkMlChannelName)) {
        ignoredChannels.add(channel.name);
      }
    }
    const channelIndex = new Map(
      channels.map((channel, index) => [channel.name, index]),
    );
    const traceTextValue = trace.textContent?.trim() ?? "";
    const remainingSamples = limits.maxSamples - totalSamples;
    if (remainingSamples < 1) {
      return fail("limit-exceeded", "InkML 전체 샘플 예산을 초과했습니다.");
    }
    const sampleTexts = boundedSampleTexts(
      traceTextValue,
      Math.min(limits.maxSamplesPerStroke, remainingSamples),
    );
    totalSamples += sampleTexts.length;
    if (totalSamples > limits.maxSamples) {
      return fail("limit-exceeded", "InkML 전체 샘플 예산을 초과했습니다.");
    }

    const points: number[] = [];
    const pressures: number[] = [];
    const tiltXs: number[] = [];
    const tiltYs: number[] = [];
    const twists: number[] = [];
    const speeds: number[] = [];
    const tangentialPressures: number[] = [];
    for (const sampleText of sampleTexts) {
      const values = parseNumericSample(sampleText, channels);
      const channelOf = (
        name: StudioInkMlChannelName,
      ): ParsedChannel | undefined => {
        const index = channelIndex.get(name);
        return index === undefined ? undefined : channels[index];
      };
      const valueOf = (name: StudioInkMlChannelName, fallback: number) => {
        const index = channelIndex.get(name);
        return index === undefined ? fallback : values[index]!;
      };
      points.push(
        finiteInRange(
          valueOf("X", 0),
          -MAX_COORDINATE,
          MAX_COORDINATE,
          "X 좌표",
        ),
        finiteInRange(
          valueOf("Y", 0),
          -MAX_COORDINATE,
          MAX_COORDINATE,
          "Y 좌표",
        ),
      );
      const pressureIndex = channelIndex.get("F");
      pressures.push(
        pressureIndex === undefined
          ? 0.5
          : normalizedPressure(values[pressureIndex]!, channels[pressureIndex]!),
      );
      tiltXs.push(
        finiteInRange(
          angleDegrees(
            valueOf("OTx", 0),
            channelOf("OTx") ?? {
              name: "OTx",
              type: "decimal",
              units: null,
              minimum: null,
              maximum: null,
            },
          ),
          -90,
          90,
          "X 기울기",
        ),
      );
      tiltYs.push(
        finiteInRange(
          angleDegrees(
            valueOf("OTy", 0),
            channelOf("OTy") ?? {
              name: "OTy",
              type: "decimal",
              units: null,
              minimum: null,
              maximum: null,
            },
          ),
          -90,
          90,
          "Y 기울기",
        ),
      );
      twists.push(
        oppositeRotationDirection(
          fullTurnDegrees(
            valueOf("OR", 0),
            channelOf("OR") ?? {
              name: "OR",
              type: "decimal",
              units: null,
              minimum: null,
              maximum: null,
            },
            "펜 회전",
          ),
        ),
      );
      speeds.push(
        finiteInRange(
          valueOf("TS.S", 0),
          0,
          1_000_000,
          "포인터 속도",
        ),
      );
      tangentialPressures.push(
        channelOf("TS.TP")
          ? normalizedTangentialPressure(
              valueOf("TS.TP", 0),
              channelOf("TS.TP")!,
            )
          : 0,
      );
    }

    const id = normalizeId(elementId(trace), `trace-${traceIndex + 1}`);
    if (decodedTraceIds.has(id)) {
      return fail("invalid-document", "InkML 획 ID가 중복되었습니다.");
    }
    decodedTraceIds.add(id);
    return Object.freeze({
      id,
      points: Object.freeze(points),
      pressures: Object.freeze(pressures),
      tiltXs: Object.freeze(tiltXs),
      tiltYs: Object.freeze(tiltYs),
      twists: Object.freeze(twists),
      speeds: Object.freeze(speeds),
      tangentialPressures: Object.freeze(tangentialPressures),
    });
  });

  return Object.freeze({
    profile: declaredProfile === STUDIO_INKML_PROFILE
      ? STUDIO_INKML_PROFILE
      : "inkml-basic",
    traces: Object.freeze(traces),
    ignoredChannels: Object.freeze(
      [...ignoredChannels].sort(compareStudioInkMlChannelNames),
    ),
  });
}

/** Adapts one retained freehand stroke to the SDK-free InkML profile. */
export function studioDrawElementToInkMlTrace(
  element: Readonly<DrawEl>,
): StudioInkMlTraceInput {
  if (element.kind !== undefined && element.kind !== "freehand") {
    return fail(
      "invalid-document",
      "자유곡선이 아닌 도형은 InkML trace로 변환할 수 없습니다.",
    );
  }
  return Object.freeze({
    id: normalizeId(element.id, "trace-1"),
    points: Object.freeze([...element.points]),
    pressures: element.pressures
      ? Object.freeze([...element.pressures])
      : undefined,
    tiltXs: element.tiltXs ? Object.freeze([...element.tiltXs]) : undefined,
    tiltYs: element.tiltYs ? Object.freeze([...element.tiltYs]) : undefined,
    twists: element.twists ? Object.freeze([...element.twists]) : undefined,
    speeds: element.speeds ? Object.freeze([...element.speeds]) : undefined,
    tangentialPressures: element.tangentialPressures
      ? Object.freeze([...element.tangentialPressures])
      : undefined,
  });
}
