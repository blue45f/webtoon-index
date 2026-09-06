/**
 * Clean-room, bounded WILL v1 Annex B OPC/ZIP document profile.
 *
 * The public WILL v1 specification documents the seven-part OPC shape, content types, root
 * relationships, SVG section, and Annex A stroke stream. It lists
 * `sections/_rels/section0.svg.rels`, but does not publish that part's relationship XML or Type
 * URI. This implementation therefore uses an explicitly ToonSpectrum-owned relationship Type and
 * validates its `strokes0` relationship against the SVG `r:id` one-to-one. It is not a Wacom SDK,
 * Wacom certification, trademark authorization, or a claim that arbitrary vendor `.will` files
 * are interoperable.
 */

import {
  buildStudioPackageArchiveBytes,
  type StudioPackageArchiveEntry,
} from "./studio-package-archive";
import {
  decodeStudioWillV1PathList,
  encodeStudioWillV1PathListDetailed,
  STUDIO_WILL_V1_LIMITS,
  STUDIO_WILL_V1_PATH_MEDIA_TYPE,
  STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL,
  STUDIO_WILL_V1_SPECIFICATION_URL,
  StudioWillV1InterchangeError,
  type StudioWillV1Limits,
  type StudioWillV1LossReport,
  type StudioWillV1Path,
  type StudioWillV1PathInput,
} from "./studio-will-v1-interchange";
import {
  readStudioZipArchive,
  StudioZipReaderError,
  type StudioZipInflateRawAdapter,
  type StudioZipReaderSource,
} from "./studio-zip-reader";

import type { StudioCrc32ExecutionMode } from "./studio-crc32-worker-client";

export const STUDIO_WILL_V1_OPC_EXTENSION = ".will" as const;
export const STUDIO_WILL_V1_OPC_MEDIA_TYPE =
  "application/vnd.toonspectrum.will-v1-bounded+zip" as const;
export const STUDIO_WILL_V1_OPC_PROFILE =
  "will-data-format-v1.0/annex-b-opc/toonstudio-bounded-clean-room-1" as const;
export const STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE =
  "https://www.toonstudio.cloud/opc/relationships/will-v1-strokes" as const;

export const STUDIO_WILL_V1_OPC_PARTS = Object.freeze({
  contentTypes: "[Content_Types].xml",
  rootRelationships: "_rels/.rels",
  applicationProperties: "props/app.xml",
  coreProperties: "props/core.xml",
  section: "sections/section0.svg",
  sectionRelationships: "sections/_rels/section0.svg.rels",
  strokes: "sections/media/strokes.protobuf",
});

export const STUDIO_WILL_V1_OPC_REQUIRED_PARTS = Object.freeze([
  STUDIO_WILL_V1_OPC_PARTS.contentTypes,
  STUDIO_WILL_V1_OPC_PARTS.rootRelationships,
  STUDIO_WILL_V1_OPC_PARTS.applicationProperties,
  STUDIO_WILL_V1_OPC_PARTS.coreProperties,
  STUDIO_WILL_V1_OPC_PARTS.section,
  STUDIO_WILL_V1_OPC_PARTS.sectionRelationships,
  STUDIO_WILL_V1_OPC_PARTS.strokes,
] as const);

export const STUDIO_WILL_V1_OPC_LIMITS = Object.freeze({
  maxArchiveBytes: 40 * 1024 * 1024,
  maxXmlPartBytes: 256 * 1024,
  maxStrokesBytes: STUDIO_WILL_V1_LIMITS.maxStrokesBytes,
  maxMetadataCharacters: 1_024,
  maxDimension: 100_000,
  maxXmlDepth: 8,
  maxXmlElements: 64,
  maxXmlAttributesPerElement: 16,
});

export interface StudioWillV1OpcLimits {
  readonly maxArchiveBytes: number;
  readonly maxXmlPartBytes: number;
  readonly maxStrokesBytes: number;
  readonly maxMetadataCharacters: number;
  readonly maxDimension: number;
  readonly maxXmlDepth: number;
  readonly maxXmlElements: number;
  readonly maxXmlAttributesPerElement: number;
}

export interface StudioWillV1OpcMetadataInput {
  readonly title?: string;
  /** Canonical UTC timestamp with whole-second precision. Defaults to a deterministic epoch. */
  readonly createdAt?: string;
  readonly application?: string;
  readonly applicationVersion?: string;
}

export interface StudioWillV1OpcExportInput extends StudioWillV1OpcMetadataInput {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly StudioWillV1PathInput[];
}

export interface StudioWillV1OpcOptions {
  readonly limits?: Partial<StudioWillV1OpcLimits>;
  readonly willLimits?: Partial<StudioWillV1Limits>;
  readonly signal?: AbortSignal;
  /** Explicit direct/reference or Worker-hosted archive CRC backend. */
  readonly crc32ExecutionMode?: StudioCrc32ExecutionMode;
}

export interface StudioWillV1OpcImportOptions extends StudioWillV1OpcOptions {
  readonly inflateRaw?: StudioZipInflateRawAdapter;
}

export const STUDIO_WILL_V1_OPC_ASSURANCE = Object.freeze({
  profile: STUDIO_WILL_V1_OPC_PROFILE,
  implementation: "ToonSpectrum clean-room bounded profile",
  publicSpecification: STUDIO_WILL_V1_SPECIFICATION_URL,
  publicPatentLicense: STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL,
  annexAPathStream: true,
  annexBOpcSevenPartContainer: true,
  publicSpecificationDefinesTopLevelMediaType: false,
  canonicalTopLevelMediaTypeOwner: "ToonSpectrum",
  sectionRelationshipNormativeInPublicSpecification: false,
  vendorCertified: false,
  vendorTrademarkAuthorized: false,
  arbitraryVendorFileInteroperabilityCertified: false,
});

export interface StudioWillV1OpcBuildResult {
  readonly bytes: Uint8Array;
  readonly paths: readonly StudioWillV1Path[];
  readonly loss: StudioWillV1LossReport;
  readonly assurance: typeof STUDIO_WILL_V1_OPC_ASSURANCE;
}

export interface StudioWillV1OpcImportResult {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly createdAt: string;
  readonly application: string;
  readonly applicationVersion: string;
  readonly paths: readonly StudioWillV1Path[];
  readonly assurance: typeof STUDIO_WILL_V1_OPC_ASSURANCE;
}

export type StudioWillV1OpcErrorCode =
  | "ABORTED"
  | "ARCHIVE_INVALID"
  | "CONTENT_TYPES_INVALID"
  | "DIMENSION_INVALID"
  | "LIMIT_INVALID"
  | "METADATA_INVALID"
  | "PART_SET_INVALID"
  | "RELATIONSHIP_INVALID"
  | "RESOURCE_LIMIT"
  | "STROKES_INVALID"
  | "SVG_INVALID"
  | "XML_INVALID";

const ERROR_MESSAGES: Readonly<Record<StudioWillV1OpcErrorCode, string>> = Object.freeze({
  ABORTED: "WILL v1 OPC 작업이 취소되었습니다.",
  ARCHIVE_INVALID: "WILL v1 OPC ZIP 구조가 올바르지 않습니다.",
  CONTENT_TYPES_INVALID: "WILL v1 OPC content types가 bounded profile과 일치하지 않습니다.",
  DIMENSION_INVALID: "WILL v1 OPC 문서 크기가 안전 범위를 벗어났습니다.",
  LIMIT_INVALID: "WILL v1 OPC 처리 한도가 올바르지 않습니다.",
  METADATA_INVALID: "WILL v1 OPC metadata가 올바르지 않습니다.",
  PART_SET_INVALID: "WILL v1 OPC는 bounded profile의 7개 part만 포함해야 합니다.",
  RELATIONSHIP_INVALID: "WILL v1 OPC relationship graph가 bounded profile과 일치하지 않습니다.",
  RESOURCE_LIMIT: "WILL v1 OPC 데이터가 안전 처리 한도를 넘었습니다.",
  STROKES_INVALID: "WILL v1 OPC Annex A stroke stream이 올바르지 않습니다.",
  SVG_INVALID: "WILL v1 OPC SVG section이 bounded profile과 일치하지 않습니다.",
  XML_INVALID: "WILL v1 OPC XML part가 안전한 bounded profile과 일치하지 않습니다.",
});

export class StudioWillV1OpcInterchangeError extends Error {
  readonly code: StudioWillV1OpcErrorCode;
  readonly path?: string;

  constructor(
    code: StudioWillV1OpcErrorCode,
    options: { readonly cause?: unknown; readonly path?: string } = {}
  ) {
    super(ERROR_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StudioWillV1OpcInterchangeError";
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
  }
}

const OPC_CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const OPC_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OPC_CORE_PROPERTIES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const OPC_CORE_PROPERTIES_RELATIONSHIP =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const WILL_EXTENDED_PROPERTIES_NAMESPACE =
  "http://schemas.willfileformat.org/2015/relationships/extended-properties";
const WILL_EXTENDED_PROPERTIES_RELATIONSHIP =
  "http://schemas.willfileformat.org/2015/relationships/extended-properties";
const WILL_SECTION_RELATIONSHIP =
  "http://schemas.willfileformat.org/2015/relationships/section";
const WILL_SVG_RELATIONSHIPS_NAMESPACE =
  "http://schemas.willfileformat.org/2015/relationships";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
const DCTERMS_NAMESPACE = "http://purl.org/dc/terms/";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
const STROKE_RELATIONSHIP_ID = "strokes0";
const DEFAULT_CREATED_AT = "1980-01-01T00:00:00Z";
const DEFAULT_TITLE = "Untitled";
const DEFAULT_APPLICATION = "ToonSpectrum";
const DEFAULT_APPLICATION_VERSION = "1.0";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

interface ResolvedMetadata {
  readonly title: string;
  readonly createdAt: string;
  readonly application: string;
  readonly applicationVersion: string;
}

interface XmlNode {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
  readonly text: string;
}

interface XmlCursor {
  readonly source: string;
  index: number;
  elements: number;
  readonly limits: StudioWillV1OpcLimits;
  readonly path: string;
}

function fail(
  code: StudioWillV1OpcErrorCode,
  options?: { readonly cause?: unknown; readonly path?: string }
): never {
  throw new StudioWillV1OpcInterchangeError(code, options);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("ABORTED");
}

function resolveIntegerLimit(
  supplied: number | undefined,
  maximum: number
): number {
  if (supplied === undefined) return maximum;
  if (!Number.isSafeInteger(supplied) || supplied < 0 || supplied > maximum) {
    return fail("LIMIT_INVALID");
  }
  return supplied;
}

function resolveLimits(value?: Partial<StudioWillV1OpcLimits>): StudioWillV1OpcLimits {
  return {
    maxArchiveBytes: resolveIntegerLimit(
      value?.maxArchiveBytes,
      STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes
    ),
    maxXmlPartBytes: resolveIntegerLimit(
      value?.maxXmlPartBytes,
      STUDIO_WILL_V1_OPC_LIMITS.maxXmlPartBytes
    ),
    maxStrokesBytes: resolveIntegerLimit(
      value?.maxStrokesBytes,
      STUDIO_WILL_V1_OPC_LIMITS.maxStrokesBytes
    ),
    maxMetadataCharacters: resolveIntegerLimit(
      value?.maxMetadataCharacters,
      STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters
    ),
    maxDimension: resolveIntegerLimit(
      value?.maxDimension,
      STUDIO_WILL_V1_OPC_LIMITS.maxDimension
    ),
    maxXmlDepth: resolveIntegerLimit(
      value?.maxXmlDepth,
      STUDIO_WILL_V1_OPC_LIMITS.maxXmlDepth
    ),
    maxXmlElements: resolveIntegerLimit(
      value?.maxXmlElements,
      STUDIO_WILL_V1_OPC_LIMITS.maxXmlElements
    ),
    maxXmlAttributesPerElement: resolveIntegerLimit(
      value?.maxXmlAttributesPerElement,
      STUDIO_WILL_V1_OPC_LIMITS.maxXmlAttributesPerElement
    ),
  };
}

function hasUnsafeXmlCodePoint(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0 ||
      (code >= 1 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127 ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      return true;
    }
  }
  return false;
}

function normalizeMetadataText(
  value: unknown,
  fallback: string,
  maximum: number
): string {
  const candidate = value === undefined ? fallback : value;
  if (
    typeof candidate !== "string" ||
    candidate.length < 1 ||
    candidate.length > maximum ||
    hasUnsafeXmlCodePoint(candidate)
  ) {
    return fail("METADATA_INVALID");
  }
  const normalized = candidate.normalize("NFC");
  if (normalized.length < 1 || normalized.length > maximum) fail("METADATA_INVALID");
  return normalized;
}

function normalizeCreatedAt(value: unknown): string {
  const candidate = value === undefined ? DEFAULT_CREATED_AT : value;
  if (
    typeof candidate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(candidate)
  ) {
    return fail("METADATA_INVALID");
  }
  const parsed = new Date(candidate);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().replace(".000Z", "Z") !== candidate
  ) {
    return fail("METADATA_INVALID");
  }
  return candidate;
}

function resolveMetadata(
  input: StudioWillV1OpcMetadataInput,
  limits: StudioWillV1OpcLimits
): ResolvedMetadata {
  const applicationVersion = normalizeMetadataText(
    input.applicationVersion,
    DEFAULT_APPLICATION_VERSION,
    Math.min(64, limits.maxMetadataCharacters)
  );
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._+ -]{0,63}$/u.test(applicationVersion)) {
    fail("METADATA_INVALID");
  }
  return Object.freeze({
    title: normalizeMetadataText(input.title, DEFAULT_TITLE, limits.maxMetadataCharacters),
    createdAt: normalizeCreatedAt(input.createdAt),
    application: normalizeMetadataText(
      input.application,
      DEFAULT_APPLICATION,
      limits.maxMetadataCharacters
    ),
    applicationVersion,
  });
}

function canonicalDimension(value: unknown, limits: StudioWillV1OpcLimits): string {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > limits.maxDimension ||
    Number(value.toFixed(6)) !== value
  ) {
    return fail("DIMENSION_INVALID");
  }
  return value.toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isValidXmlCodePoint(value: number): boolean {
  return Number.isSafeInteger(value) && (
    value === 9 ||
    value === 10 ||
    value === 13 ||
    (value >= 32 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

function decodeXmlEntities(value: string, path: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const ampersand = value.indexOf("&", cursor);
    if (ampersand < 0) {
      output += value.slice(cursor);
      break;
    }
    output += value.slice(cursor, ampersand);
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon < 0 || semicolon - ampersand > 16) fail("XML_INVALID", { path });
    const entity = value.slice(ampersand + 1, semicolon);
    if (entity === "amp") output += "&";
    else if (entity === "lt") output += "<";
    else if (entity === "gt") output += ">";
    else if (entity === "quot") output += '"';
    else if (entity === "apos") output += "'";
    else {
      const hexadecimal = entity.startsWith("#x");
      const decimal = entity.startsWith("#") && !hexadecimal;
      if (!hexadecimal && !decimal) fail("XML_INVALID", { path });
      const digits = entity.slice(hexadecimal ? 2 : 1);
      if (
        digits.length < 1 ||
        !(hexadecimal ? /^[\da-fA-F]+$/u : /^\d+$/u).test(digits)
      ) {
        fail("XML_INVALID", { path });
      }
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!isValidXmlCodePoint(codePoint)) fail("XML_INVALID", { path });
      output += String.fromCodePoint(codePoint);
    }
    cursor = semicolon + 1;
  }
  if (hasUnsafeXmlCodePoint(output)) fail("XML_INVALID", { path });
  return output;
}

function isNameStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/u.test(character);
}

function isNameCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_.:-]/u.test(character);
}

function parseXmlName(cursor: XmlCursor): string {
  const start = cursor.index;
  if (!isNameStart(cursor.source[cursor.index])) fail("XML_INVALID", { path: cursor.path });
  cursor.index += 1;
  while (isNameCharacter(cursor.source[cursor.index])) cursor.index += 1;
  return cursor.source.slice(start, cursor.index);
}

function skipXmlWhitespace(cursor: XmlCursor): void {
  while (/[\t\n\r ]/u.test(cursor.source[cursor.index] ?? "")) cursor.index += 1;
}

function parseXmlElement(cursor: XmlCursor, depth: number): XmlNode {
  if (depth > cursor.limits.maxXmlDepth) fail("RESOURCE_LIMIT", { path: cursor.path });
  if (cursor.source[cursor.index] !== "<") fail("XML_INVALID", { path: cursor.path });
  cursor.index += 1;
  if (
    cursor.source[cursor.index] === "/" ||
    cursor.source[cursor.index] === "!" ||
    cursor.source[cursor.index] === "?"
  ) {
    return fail("XML_INVALID", { path: cursor.path });
  }
  const name = parseXmlName(cursor);
  cursor.elements += 1;
  if (cursor.elements > cursor.limits.maxXmlElements) {
    fail("RESOURCE_LIMIT", { path: cursor.path });
  }
  const attributes = new Map<string, string>();
  for (;;) {
    skipXmlWhitespace(cursor);
    const current = cursor.source[cursor.index];
    if (current === "/" || current === ">") break;
    if (attributes.size >= cursor.limits.maxXmlAttributesPerElement) {
      fail("RESOURCE_LIMIT", { path: cursor.path });
    }
    const attributeName = parseXmlName(cursor);
    if (attributes.has(attributeName)) fail("XML_INVALID", { path: cursor.path });
    skipXmlWhitespace(cursor);
    if (cursor.source[cursor.index] !== "=") fail("XML_INVALID", { path: cursor.path });
    cursor.index += 1;
    skipXmlWhitespace(cursor);
    const quote = cursor.source[cursor.index];
    if (quote !== '"' && quote !== "'") fail("XML_INVALID", { path: cursor.path });
    cursor.index += 1;
    const start = cursor.index;
    while (
      cursor.index < cursor.source.length &&
      cursor.source[cursor.index] !== quote
    ) {
      const character = cursor.source[cursor.index];
      if (character === "<" || character === ">") fail("XML_INVALID", { path: cursor.path });
      cursor.index += 1;
    }
    if (cursor.source[cursor.index] !== quote) fail("XML_INVALID", { path: cursor.path });
    const attributeValue = decodeXmlEntities(
      cursor.source.slice(start, cursor.index),
      cursor.path
    );
    cursor.index += 1;
    attributes.set(attributeName, attributeValue);
  }
  if (cursor.source.startsWith("/>", cursor.index)) {
    cursor.index += 2;
    return Object.freeze({
      name,
      attributes,
      children: Object.freeze([]),
      text: "",
    });
  }
  if (cursor.source[cursor.index] !== ">") fail("XML_INVALID", { path: cursor.path });
  cursor.index += 1;
  const children: XmlNode[] = [];
  let text = "";
  for (;;) {
    if (cursor.index >= cursor.source.length) fail("XML_INVALID", { path: cursor.path });
    if (cursor.source.startsWith("</", cursor.index)) {
      cursor.index += 2;
      const closingName = parseXmlName(cursor);
      skipXmlWhitespace(cursor);
      if (closingName !== name || cursor.source[cursor.index] !== ">") {
        fail("XML_INVALID", { path: cursor.path });
      }
      cursor.index += 1;
      break;
    }
    if (cursor.source[cursor.index] === "<") {
      children.push(parseXmlElement(cursor, depth + 1));
      continue;
    }
    const start = cursor.index;
    while (
      cursor.index < cursor.source.length &&
      cursor.source[cursor.index] !== "<"
    ) {
      cursor.index += 1;
    }
    text += decodeXmlEntities(cursor.source.slice(start, cursor.index), cursor.path);
  }
  return Object.freeze({
    name,
    attributes,
    children: Object.freeze(children),
    text,
  });
}

function parseXmlPart(
  bytes: Uint8Array,
  path: string,
  limits: StudioWillV1OpcLimits
): XmlNode {
  if (bytes.byteLength < 1 || bytes.byteLength > limits.maxXmlPartBytes) {
    fail("RESOURCE_LIMIT", { path });
  }
  let source: string;
  try {
    source = textDecoder.decode(bytes);
  } catch (cause) {
    return fail("XML_INVALID", { cause, path });
  }
  if (
    source.startsWith("\uFEFF") ||
    hasUnsafeXmlCodePoint(source) ||
    /<!|<\?(?!xml\b)/iu.test(source)
  ) {
    fail("XML_INVALID", { path });
  }
  if (!source.startsWith(XML_DECLARATION)) fail("XML_INVALID", { path });
  const cursor: XmlCursor = {
    source,
    index: XML_DECLARATION.length,
    elements: 0,
    limits,
    path,
  };
  skipXmlWhitespace(cursor);
  const root = parseXmlElement(cursor, 1);
  skipXmlWhitespace(cursor);
  if (cursor.index !== source.length) fail("XML_INVALID", { path });
  return root;
}

function expectExactAttributes(
  node: XmlNode,
  expected: Readonly<Record<string, string>>,
  code: StudioWillV1OpcErrorCode,
  path: string
): void {
  const entries = Object.entries(expected);
  if (
    node.attributes.size !== entries.length ||
    entries.some(([key, value]) => node.attributes.get(key) !== value)
  ) {
    fail(code, { path });
  }
}

function expectContainerNode(
  node: XmlNode,
  name: string,
  attributes: Readonly<Record<string, string>>,
  code: StudioWillV1OpcErrorCode,
  path: string
): void {
  if (node.name !== name || node.text.trim() !== "") fail(code, { path });
  expectExactAttributes(node, attributes, code, path);
}

function expectLeafText(
  node: XmlNode,
  name: string,
  attributes: Readonly<Record<string, string>>,
  code: StudioWillV1OpcErrorCode,
  path: string
): string {
  if (node.name !== name || node.children.length !== 0) fail(code, { path });
  expectExactAttributes(node, attributes, code, path);
  return node.text;
}

function validateContentTypes(root: XmlNode): void {
  const path = STUDIO_WILL_V1_OPC_PARTS.contentTypes;
  expectContainerNode(
    root,
    "Types",
    { xmlns: OPC_CONTENT_TYPES_NAMESPACE },
    "CONTENT_TYPES_INVALID",
    path
  );
  const mappings = new Map<string, string>();
  for (const child of root.children) {
    if (child.children.length !== 0 || child.text.trim() !== "") {
      fail("CONTENT_TYPES_INVALID", { path });
    }
    if (child.name === "Default") {
      if (
        child.attributes.size !== 2 ||
        !child.attributes.has("Extension") ||
        !child.attributes.has("ContentType")
      ) {
        fail("CONTENT_TYPES_INVALID", { path });
      }
      const key = `default:${child.attributes.get("Extension")}`;
      if (mappings.has(key)) fail("CONTENT_TYPES_INVALID", { path });
      mappings.set(key, child.attributes.get("ContentType") ?? "");
    } else if (child.name === "Override") {
      if (
        child.attributes.size !== 2 ||
        !child.attributes.has("PartName") ||
        !child.attributes.has("ContentType")
      ) {
        fail("CONTENT_TYPES_INVALID", { path });
      }
      const key = `override:${child.attributes.get("PartName")}`;
      if (mappings.has(key)) fail("CONTENT_TYPES_INVALID", { path });
      mappings.set(key, child.attributes.get("ContentType") ?? "");
    } else {
      fail("CONTENT_TYPES_INVALID", { path });
    }
  }
  const expected = new Map<string, string>([
    ["default:rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["default:svg", "image/svg+xml"],
    ["default:jpg", "image/jpeg"],
    ["default:jpeg", "image/jpeg"],
    ["default:png", "image/png"],
    ["default:protobuf", STUDIO_WILL_V1_PATH_MEDIA_TYPE],
    [
      "override:/props/core.xml",
      "application/vnd.openxmlformats-package.core-properties+xml",
    ],
    [
      "override:/props/app.xml",
      "application/vnd.willfileformat.extended-properties+xml",
    ],
  ]);
  if (
    mappings.size !== expected.size ||
    [...expected].some(([key, value]) => mappings.get(key) !== value)
  ) {
    fail("CONTENT_TYPES_INVALID", { path });
  }
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function parseRelationships(root: XmlNode, path: string): readonly Relationship[] {
  expectContainerNode(
    root,
    "Relationships",
    { xmlns: OPC_RELATIONSHIPS_NAMESPACE },
    "RELATIONSHIP_INVALID",
    path
  );
  const ids = new Set<string>();
  const relationships = root.children.map((child) => {
    if (child.name !== "Relationship" || child.children.length !== 0 || child.text.trim() !== "") {
      return fail("RELATIONSHIP_INVALID", { path });
    }
    if (
      child.attributes.size !== 3 ||
      !child.attributes.has("Id") ||
      !child.attributes.has("Type") ||
      !child.attributes.has("Target")
    ) {
      return fail("RELATIONSHIP_INVALID", { path });
    }
    const id = child.attributes.get("Id") ?? "";
    const type = child.attributes.get("Type") ?? "";
    const target = child.attributes.get("Target") ?? "";
    if (
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.test(id) ||
      ids.has(id) ||
      type.length < 1 ||
      target.length < 1 ||
      /(?:^|\/)\.\.(?:\/|$)|\\/u.test(target) ||
      hasUnsafeXmlCodePoint(target)
    ) {
      return fail("RELATIONSHIP_INVALID", { path });
    }
    ids.add(id);
    return Object.freeze({ id, type, target });
  });
  return Object.freeze(relationships);
}

function validateRootRelationships(root: XmlNode): void {
  const path = STUDIO_WILL_V1_OPC_PARTS.rootRelationships;
  const relationships = parseRelationships(root, path);
  const expected = new Map<string, readonly [string, string]>([
    ["core-properties", [OPC_CORE_PROPERTIES_RELATIONSHIP, "/props/core.xml"]],
    ["extended-properties", [WILL_EXTENDED_PROPERTIES_RELATIONSHIP, "/props/app.xml"]],
    ["section0", [WILL_SECTION_RELATIONSHIP, "/sections/section0.svg"]],
  ]);
  if (
    relationships.length !== expected.size ||
    relationships.some((relationship) => {
      const match = expected.get(relationship.id);
      return !match || match[0] !== relationship.type || match[1] !== relationship.target;
    })
  ) {
    fail("RELATIONSHIP_INVALID", { path });
  }
}

function validateSectionRelationships(root: XmlNode): string {
  const path = STUDIO_WILL_V1_OPC_PARTS.sectionRelationships;
  const relationships = parseRelationships(root, path);
  const relationship = relationships[0];
  if (
    relationships.length !== 1 ||
    relationship?.id !== STROKE_RELATIONSHIP_ID ||
    relationship.type !== STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE ||
    relationship.target !== "media/strokes.protobuf"
  ) {
    fail("RELATIONSHIP_INVALID", { path });
  }
  return relationship.id;
}

function validateApplicationProperties(
  root: XmlNode,
  limits: StudioWillV1OpcLimits
): Pick<ResolvedMetadata, "application" | "applicationVersion"> {
  const path = STUDIO_WILL_V1_OPC_PARTS.applicationProperties;
  expectContainerNode(
    root,
    "Properties",
    { xmlns: WILL_EXTENDED_PROPERTIES_NAMESPACE },
    "METADATA_INVALID",
    path
  );
  if (root.children.length !== 2) fail("METADATA_INVALID", { path });
  const applicationNode = root.children.find((child) => child.name === "Application");
  const versionNode = root.children.find((child) => child.name === "AppVersion");
  if (!applicationNode || !versionNode) fail("METADATA_INVALID", { path });
  const application = normalizeMetadataText(
    expectLeafText(applicationNode, "Application", {}, "METADATA_INVALID", path),
    "",
    limits.maxMetadataCharacters
  );
  const applicationVersion = normalizeMetadataText(
    expectLeafText(versionNode, "AppVersion", {}, "METADATA_INVALID", path),
    "",
    Math.min(64, limits.maxMetadataCharacters)
  );
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._+ -]{0,63}$/u.test(applicationVersion)) {
    fail("METADATA_INVALID", { path });
  }
  return { application, applicationVersion };
}

function validateCoreProperties(
  root: XmlNode,
  limits: StudioWillV1OpcLimits
): Pick<ResolvedMetadata, "createdAt" | "title"> {
  const path = STUDIO_WILL_V1_OPC_PARTS.coreProperties;
  expectContainerNode(
    root,
    "coreProperties",
    {
      xmlns: OPC_CORE_PROPERTIES_NAMESPACE,
      "xmlns:dc": DC_NAMESPACE,
      "xmlns:dcterms": DCTERMS_NAMESPACE,
      "xmlns:xsi": XSI_NAMESPACE,
    },
    "METADATA_INVALID",
    path
  );
  if (root.children.length !== 2) fail("METADATA_INVALID", { path });
  const createdNode = root.children.find((child) => child.name === "dcterms:created");
  const titleNode = root.children.find((child) => child.name === "dc:title");
  if (!createdNode || !titleNode) fail("METADATA_INVALID", { path });
  const createdAt = normalizeCreatedAt(
    expectLeafText(
      createdNode,
      "dcterms:created",
      { "xsi:type": "dcterms:W3CDTF" },
      "METADATA_INVALID",
      path
    )
  );
  const title = normalizeMetadataText(
    expectLeafText(titleNode, "dc:title", {}, "METADATA_INVALID", path),
    "",
    limits.maxMetadataCharacters
  );
  return { createdAt, title };
}

function validateSvgSection(
  root: XmlNode,
  relationshipId: string,
  limits: StudioWillV1OpcLimits
): { readonly width: number; readonly height: number } {
  const path = STUDIO_WILL_V1_OPC_PARTS.section;
  if (root.name !== "svg" || root.text.trim() !== "" || root.children.length !== 1) {
    fail("SVG_INVALID", { path });
  }
  const widthSource = root.attributes.get("width");
  const heightSource = root.attributes.get("height");
  if (widthSource === undefined || heightSource === undefined) fail("SVG_INVALID", { path });
  const width = Number(widthSource);
  const height = Number(heightSource);
  const canonicalWidth = canonicalDimension(width, limits);
  const canonicalHeight = canonicalDimension(height, limits);
  expectExactAttributes(
    root,
    {
      xmlns: SVG_NAMESPACE,
      "xmlns:r": WILL_SVG_RELATIONSHIPS_NAMESPACE,
      width: canonicalWidth,
      height: canonicalHeight,
      viewBox: `0 0 ${canonicalWidth} ${canonicalHeight}`,
    },
    "SVG_INVALID",
    path
  );
  const marker = root.children[0];
  if (!marker || marker.name !== "g" || marker.children.length !== 0 || marker.text.trim() !== "") {
    fail("SVG_INVALID", { path });
  }
  expectExactAttributes(marker, { "r:id": relationshipId }, "SVG_INVALID", path);
  return Object.freeze({ width, height });
}

function contentTypesXml(): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<Types xmlns="${OPC_CONTENT_TYPES_NAMESPACE}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="protobuf" ContentType="${STUDIO_WILL_V1_PATH_MEDIA_TYPE}"/>
  <Override PartName="/props/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/props/app.xml" ContentType="application/vnd.willfileformat.extended-properties+xml"/>
</Types>
`);
}

function rootRelationshipsXml(): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<Relationships xmlns="${OPC_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="core-properties" Type="${OPC_CORE_PROPERTIES_RELATIONSHIP}" Target="/props/core.xml"/>
  <Relationship Id="extended-properties" Type="${WILL_EXTENDED_PROPERTIES_RELATIONSHIP}" Target="/props/app.xml"/>
  <Relationship Id="section0" Type="${WILL_SECTION_RELATIONSHIP}" Target="/sections/section0.svg"/>
</Relationships>
`);
}

function sectionRelationshipsXml(): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<Relationships xmlns="${OPC_RELATIONSHIPS_NAMESPACE}">
  <Relationship Id="${STROKE_RELATIONSHIP_ID}" Type="${STUDIO_WILL_V1_OPC_STROKE_RELATIONSHIP_TYPE}" Target="media/strokes.protobuf"/>
</Relationships>
`);
}

function applicationPropertiesXml(metadata: ResolvedMetadata): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<Properties xmlns="${WILL_EXTENDED_PROPERTIES_NAMESPACE}">
  <Application>${escapeXml(metadata.application)}</Application>
  <AppVersion>${escapeXml(metadata.applicationVersion)}</AppVersion>
</Properties>
`);
}

function corePropertiesXml(metadata: ResolvedMetadata): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<coreProperties xmlns="${OPC_CORE_PROPERTIES_NAMESPACE}" xmlns:dc="${DC_NAMESPACE}" xmlns:dcterms="${DCTERMS_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}">
  <dcterms:created xsi:type="dcterms:W3CDTF">${metadata.createdAt}</dcterms:created>
  <dc:title>${escapeXml(metadata.title)}</dc:title>
</coreProperties>
`);
}

function sectionSvgXml(width: string, height: string): Uint8Array {
  return textEncoder.encode(`${XML_DECLARATION}
<svg xmlns="${SVG_NAMESPACE}" xmlns:r="${WILL_SVG_RELATIONSHIPS_NAMESPACE}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g r:id="${STROKE_RELATIONSHIP_ID}"/>
</svg>
`);
}

function assertXmlBudget(bytes: Uint8Array, limits: StudioWillV1OpcLimits, path: string): void {
  if (bytes.byteLength < 1 || bytes.byteLength > limits.maxXmlPartBytes) {
    fail("RESOURCE_LIMIT", { path });
  }
}

function archiveLimits(limits: StudioWillV1OpcLimits) {
  return {
    maxFiles: STUDIO_WILL_V1_OPC_REQUIRED_PARTS.length,
    maxEntryBytes: Math.max(limits.maxXmlPartBytes, limits.maxStrokesBytes),
    maxTotalBytes: Math.min(
      STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes,
      limits.maxStrokesBytes + limits.maxXmlPartBytes * 6
    ),
    maxArchiveBytes: limits.maxArchiveBytes,
  };
}

/**
 * Builds deterministic ZIP32 bytes for the ToonSpectrum bounded WILL v1 Annex B profile.
 *
 * Every entry uses the ZIP writer's deterministic DOS epoch, stored method, fixed physical order,
 * normalized path, and CRC-32. No clock, random ID, or host metadata enters the byte stream.
 */
export async function buildStudioWillV1OpcBytes(
  input: StudioWillV1OpcExportInput,
  options: StudioWillV1OpcOptions = {}
): Promise<StudioWillV1OpcBuildResult> {
  throwIfAborted(options.signal);
  if (!input || typeof input !== "object") fail("METADATA_INVALID");
  const limits = resolveLimits(options.limits);
  const width = canonicalDimension(input.width, limits);
  const height = canonicalDimension(input.height, limits);
  const metadata = resolveMetadata(input, limits);
  let encoded: ReturnType<typeof encodeStudioWillV1PathListDetailed>;
  try {
    encoded = encodeStudioWillV1PathListDetailed(input.paths, {
      limits: {
        ...options.willLimits,
        maxStrokesBytes: Math.min(
          options.willLimits?.maxStrokesBytes ?? STUDIO_WILL_V1_LIMITS.maxStrokesBytes,
          limits.maxStrokesBytes
        ),
      },
    });
  } catch (cause) {
    if (cause instanceof StudioWillV1InterchangeError) {
      return fail(
        cause.code === "RESOURCE_LIMIT" ? "RESOURCE_LIMIT" : "STROKES_INVALID",
        { cause, path: STUDIO_WILL_V1_OPC_PARTS.strokes }
      );
    }
    return fail("STROKES_INVALID", {
      cause,
      path: STUDIO_WILL_V1_OPC_PARTS.strokes,
    });
  }
  if (encoded.bytes.byteLength > limits.maxStrokesBytes) {
    fail("RESOURCE_LIMIT", { path: STUDIO_WILL_V1_OPC_PARTS.strokes });
  }
  const xmlParts = {
    contentTypes: contentTypesXml(),
    rootRelationships: rootRelationshipsXml(),
    applicationProperties: applicationPropertiesXml(metadata),
    coreProperties: corePropertiesXml(metadata),
    section: sectionSvgXml(width, height),
    sectionRelationships: sectionRelationshipsXml(),
  };
  for (const [key, bytes] of Object.entries(xmlParts)) {
    const path = STUDIO_WILL_V1_OPC_PARTS[key as keyof typeof xmlParts];
    assertXmlBudget(bytes, limits, path);
  }
  const entries: readonly StudioPackageArchiveEntry[] = [
    { path: STUDIO_WILL_V1_OPC_PARTS.contentTypes, data: xmlParts.contentTypes },
    { path: STUDIO_WILL_V1_OPC_PARTS.applicationProperties, data: xmlParts.applicationProperties },
    { path: STUDIO_WILL_V1_OPC_PARTS.coreProperties, data: xmlParts.coreProperties },
    { path: STUDIO_WILL_V1_OPC_PARTS.strokes, data: encoded.bytes },
    { path: STUDIO_WILL_V1_OPC_PARTS.section, data: xmlParts.section },
    {
      path: STUDIO_WILL_V1_OPC_PARTS.sectionRelationships,
      data: xmlParts.sectionRelationships,
    },
    { path: STUDIO_WILL_V1_OPC_PARTS.rootRelationships, data: xmlParts.rootRelationships },
  ];
  let bytes: Uint8Array;
  try {
    bytes = await buildStudioPackageArchiveBytes(entries, {
      limits: archiveLimits(limits),
      signal: options.signal,
      crc32ExecutionMode: options.crc32ExecutionMode ?? "direct-bounded",
    });
  } catch (cause) {
    if (options.signal?.aborted) return fail("ABORTED", { cause });
    return fail("ARCHIVE_INVALID", { cause });
  }
  throwIfAborted(options.signal);
  return Object.freeze({
    bytes,
    paths: encoded.paths,
    loss: encoded.loss,
    assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
  });
}

function assertExactPartSet(paths: readonly string[]): void {
  if (
    paths.length !== STUDIO_WILL_V1_OPC_REQUIRED_PARTS.length ||
    STUDIO_WILL_V1_OPC_REQUIRED_PARTS.some((path) => !paths.includes(path))
  ) {
    fail("PART_SET_INVALID");
  }
}

/**
 * Imports only the explicit ToonSpectrum bounded seven-part profile.
 *
 * This intentionally fails closed for extra media, paints, extra sections, external relationships,
 * scripts, arbitrary SVG, and vendor-specific extensions. Those require separate profiled codecs
 * and interoperability evidence rather than silent data loss.
 */
export async function importStudioWillV1Opc(
  source: StudioZipReaderSource,
  options: StudioWillV1OpcImportOptions = {}
): Promise<StudioWillV1OpcImportResult> {
  throwIfAborted(options.signal);
  const limits = resolveLimits(options.limits);
  let archive: Awaited<ReturnType<typeof readStudioZipArchive>>;
  try {
    archive = await readStudioZipArchive(source, {
      limits: {
        maxArchiveBytes: limits.maxArchiveBytes,
        maxEntries: STUDIO_WILL_V1_OPC_REQUIRED_PARTS.length,
        maxEntryCompressedBytes: Math.max(limits.maxXmlPartBytes, limits.maxStrokesBytes),
        maxEntryUncompressedBytes: Math.max(limits.maxXmlPartBytes, limits.maxStrokesBytes),
        maxTotalUncompressedBytes: Math.min(
          STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes,
          limits.maxStrokesBytes + limits.maxXmlPartBytes * 6
        ),
        maxCentralDirectoryBytes: 64 * 1024,
        maxPathBytes: 256,
        maxCompressionRatio: 20,
        maxCommentBytes: 0,
      },
      inflateRaw: options.inflateRaw,
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) return fail("ABORTED", { cause });
    if (cause instanceof StudioZipReaderError) return fail("ARCHIVE_INVALID", { cause });
    return fail("ARCHIVE_INVALID", { cause });
  }
  if (archive.comment !== "" || archive.entries.some((entry) => entry.directory)) {
    fail("PART_SET_INVALID");
  }
  assertExactPartSet(archive.entries.map((entry) => entry.path));
  let contentTypesBytes: Uint8Array;
  let rootRelationshipsBytes: Uint8Array;
  let applicationPropertiesBytes: Uint8Array;
  let corePropertiesBytes: Uint8Array;
  let sectionBytes: Uint8Array;
  let sectionRelationshipsBytes: Uint8Array;
  let strokesBytes: Uint8Array;
  try {
    [
      contentTypesBytes,
      rootRelationshipsBytes,
      applicationPropertiesBytes,
      corePropertiesBytes,
      sectionBytes,
      sectionRelationshipsBytes,
      strokesBytes,
    ] = await Promise.all([
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.contentTypes, { signal: options.signal }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.rootRelationships, { signal: options.signal }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.applicationProperties, { signal: options.signal }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.coreProperties, { signal: options.signal }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.section, { signal: options.signal }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.sectionRelationships, {
        signal: options.signal,
      }),
      archive.readEntry(STUDIO_WILL_V1_OPC_PARTS.strokes, { signal: options.signal }),
    ]);
  } catch (cause) {
    if (options.signal?.aborted) return fail("ABORTED", { cause });
    return fail("ARCHIVE_INVALID", { cause });
  }
  const xmlParts = [
    [contentTypesBytes, STUDIO_WILL_V1_OPC_PARTS.contentTypes],
    [rootRelationshipsBytes, STUDIO_WILL_V1_OPC_PARTS.rootRelationships],
    [applicationPropertiesBytes, STUDIO_WILL_V1_OPC_PARTS.applicationProperties],
    [corePropertiesBytes, STUDIO_WILL_V1_OPC_PARTS.coreProperties],
    [sectionBytes, STUDIO_WILL_V1_OPC_PARTS.section],
    [sectionRelationshipsBytes, STUDIO_WILL_V1_OPC_PARTS.sectionRelationships],
  ] as const;
  for (const [bytes, path] of xmlParts) assertXmlBudget(bytes, limits, path);
  if (strokesBytes.byteLength < 1 || strokesBytes.byteLength > limits.maxStrokesBytes) {
    fail("RESOURCE_LIMIT", { path: STUDIO_WILL_V1_OPC_PARTS.strokes });
  }
  const contentTypes = parseXmlPart(
    contentTypesBytes,
    STUDIO_WILL_V1_OPC_PARTS.contentTypes,
    limits
  );
  const rootRelationships = parseXmlPart(
    rootRelationshipsBytes,
    STUDIO_WILL_V1_OPC_PARTS.rootRelationships,
    limits
  );
  const applicationProperties = parseXmlPart(
    applicationPropertiesBytes,
    STUDIO_WILL_V1_OPC_PARTS.applicationProperties,
    limits
  );
  const coreProperties = parseXmlPart(
    corePropertiesBytes,
    STUDIO_WILL_V1_OPC_PARTS.coreProperties,
    limits
  );
  const section = parseXmlPart(sectionBytes, STUDIO_WILL_V1_OPC_PARTS.section, limits);
  const sectionRelationships = parseXmlPart(
    sectionRelationshipsBytes,
    STUDIO_WILL_V1_OPC_PARTS.sectionRelationships,
    limits
  );
  validateContentTypes(contentTypes);
  validateRootRelationships(rootRelationships);
  const relationshipId = validateSectionRelationships(sectionRelationships);
  const dimensions = validateSvgSection(section, relationshipId, limits);
  const applicationMetadata = validateApplicationProperties(applicationProperties, limits);
  const coreMetadata = validateCoreProperties(coreProperties, limits);
  let paths: readonly StudioWillV1Path[];
  try {
    paths = decodeStudioWillV1PathList(strokesBytes, {
      limits: {
        ...options.willLimits,
        maxStrokesBytes: Math.min(
          options.willLimits?.maxStrokesBytes ?? STUDIO_WILL_V1_LIMITS.maxStrokesBytes,
          limits.maxStrokesBytes
        ),
      },
    });
  } catch (cause) {
    if (cause instanceof StudioWillV1InterchangeError) {
      return fail(
        cause.code === "RESOURCE_LIMIT" ? "RESOURCE_LIMIT" : "STROKES_INVALID",
        { cause, path: STUDIO_WILL_V1_OPC_PARTS.strokes }
      );
    }
    return fail("STROKES_INVALID", {
      cause,
      path: STUDIO_WILL_V1_OPC_PARTS.strokes,
    });
  }
  throwIfAborted(options.signal);
  return Object.freeze({
    ...dimensions,
    ...coreMetadata,
    ...applicationMetadata,
    paths,
    assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
  });
}
