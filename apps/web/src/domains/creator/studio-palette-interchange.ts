import {
  MAX_COLORS_PER_PALETTE,
  parseGplPalette,
  writeGplPalette,
} from "./studio-palette-library";

/** Palette files stay deliberately small enough to parse synchronously without blocking Studio. */
export const STUDIO_PALETTE_INTERCHANGE_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxColors: MAX_COLORS_PER_PALETTE,
  maxBlocks: 4_096,
  maxNameCodeUnits: 255,
});

export const STUDIO_INDEXED_PALETTE_MAX_COLORS = 256;
export const STUDIO_ACT_TABLE_BYTES = STUDIO_INDEXED_PALETTE_MAX_COLORS * 3;
export const STUDIO_ACT_EXTENDED_BYTES = STUDIO_ACT_TABLE_BYTES + 4;

export type StudioPaletteInterchangeFormat = "aco" | "act" | "ase" | "css" | "gpl" | "json" | "pal";
export type StudioPaletteColorSpace = "display-p3" | "srgb" | "unknown";

export interface StudioPaletteInterchangeColor {
  readonly hex: string;
  readonly name?: string;
  /** Optional source alpha. Current Studio swatches are opaque, so codecs report when this is lost. */
  readonly alpha?: number;
  readonly colorSpace?: StudioPaletteColorSpace;
}

export interface StudioPaletteInterchangeDocument {
  readonly name: string;
  readonly colors: readonly StudioPaletteInterchangeColor[];
}

export type StudioPaletteInterchangeWarningCode =
  | "alpha-discarded"
  | "color-skipped"
  | "names-discarded"
  | "non-rgb-converted"
  | "truncated"
  | "unknown-block-skipped"
  | "wide-gamut-clipped";

export interface StudioPaletteInterchangeWarning {
  readonly code: StudioPaletteInterchangeWarningCode;
  readonly message: string;
}

export interface StudioPaletteInterchangeImportResult {
  readonly palette: StudioPaletteInterchangeDocument;
  readonly skippedColors: number;
  readonly truncated: boolean;
  readonly warnings: readonly StudioPaletteInterchangeWarning[];
}

export interface StudioPaletteInterchangeExportResult<T extends string | Uint8Array> {
  readonly data: T;
  readonly exportedColors: number;
  readonly skippedColors: number;
  readonly truncated: boolean;
  readonly warnings: readonly StudioPaletteInterchangeWarning[];
}

export type StudioPaletteInterchangeErrorCode =
  | "empty"
  | "invalid"
  | "no-colors"
  | "size"
  | "unsupported-version";

const ERROR_MESSAGES: Readonly<Record<StudioPaletteInterchangeErrorCode, string>> = Object.freeze({
  empty: "팔레트 파일이 비어 있습니다.",
  invalid: "팔레트 파일 구조가 올바르지 않거나 손상되었습니다.",
  "no-colors": "팔레트에서 읽을 수 있는 색을 찾지 못했습니다.",
  size: "팔레트 파일이 4MB 안전 처리 한도를 초과했습니다.",
  "unsupported-version": "아직 지원하지 않는 팔레트 파일 버전입니다.",
});

export class StudioPaletteInterchangeError extends Error {
  constructor(readonly code: StudioPaletteInterchangeErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioPaletteInterchangeError";
  }
}

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

function fail(code: StudioPaletteInterchangeErrorCode, cause?: unknown): never {
  throw new StudioPaletteInterchangeError(code, cause === undefined ? undefined : { cause });
}

function assertByteBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) fail("empty");
  if (byteLength > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBytes) fail("size");
}

function decodeText(input: string | Uint8Array): string {
  if (typeof input === "string") {
    assertByteBudget(textEncoder.encode(input).byteLength);
    return input.replace(/^\uFEFF/u, "");
  }
  assertByteBudget(input.byteLength);
  try {
    return fatalTextDecoder.decode(input).replace(/^\uFEFF/u, "");
  } catch (error) {
    return fail("invalid", error);
  }
}

function inputBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assertByteBudget(bytes.byteLength);
  return bytes;
}

function cleanName(value: unknown, fallback = "가져온 팔레트"): string {
  if (typeof value !== "string") return fallback;
  let cleaned = Array.from(value.normalize("NFC"))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join("")
    .trim();
  cleaned = cleaned.slice(0, STUDIO_PALETTE_INTERCHANGE_LIMITS.maxNameCodeUnits);
  const finalCodeUnit = cleaned.charCodeAt(cleaned.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) cleaned = cleaned.slice(0, -1);
  return cleaned || fallback;
}

function toHexByte(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

function rgbHex(red: number, green: number, blue: number): string {
  return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}

interface ParsedColorToken {
  readonly hex: string;
  readonly alpha: number;
}

function parseHexColorToken(value: string): ParsedColorToken | null {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.exec(value.trim());
  if (!match) return null;
  const raw = match[1]!.toLowerCase();
  const expanded = raw.length <= 4 ? Array.from(raw, (character) => character + character).join("") : raw;
  return {
    hex: `#${expanded.slice(0, 6)}`,
    alpha: expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1,
  };
}

function parseCssChannel(token: string): number | null {
  const value = token.trim();
  if (value.endsWith("%")) {
    const number = Number(value.slice(0, -1));
    return Number.isFinite(number) ? Math.min(255, Math.max(0, number * 2.55)) : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(255, Math.max(0, number)) : null;
}

function parseCssAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const value = token.trim();
  const number = value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
}

function parseCssColorToken(value: string): ParsedColorToken | null {
  const hex = parseHexColorToken(value);
  if (hex) return hex;
  const match = /^rgba?\((.*)\)$/iu.exec(value.trim());
  if (!match) return null;
  const body = match[1]!.trim();
  const slash = body.split("/");
  if (slash.length > 2) return null;
  const channelBody = slash[0]!.trim();
  const channelTokens = channelBody.includes(",")
    ? channelBody.split(",").map((token) => token.trim())
    : channelBody.split(/\s+/u);
  let alphaToken: string | undefined = slash[1]?.trim();
  if (channelTokens.length === 4 && alphaToken === undefined) alphaToken = channelTokens.pop();
  if (channelTokens.length !== 3) return null;
  const channels = channelTokens.map(parseCssChannel);
  const alpha = parseCssAlpha(alphaToken);
  if (channels.some((channel) => channel === null) || alpha === null) return null;
  return { hex: rgbHex(channels[0]!, channels[1]!, channels[2]!), alpha };
}

function warning(
  code: StudioPaletteInterchangeWarningCode,
  message: string
): StudioPaletteInterchangeWarning {
  return { code, message };
}

function uniqueWarnings(
  warnings: readonly StudioPaletteInterchangeWarning[]
): StudioPaletteInterchangeWarning[] {
  const seen = new Set<string>();
  return warnings.filter((item) => {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finalizeImport(
  name: string,
  colors: StudioPaletteInterchangeColor[],
  skippedColors: number,
  warnings: StudioPaletteInterchangeWarning[]
): StudioPaletteInterchangeImportResult {
  if (colors.length === 0) fail("no-colors");
  const truncated = colors.length > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors;
  if (truncated) {
    warnings.push(warning("truncated", `색 ${STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors}개까지만 가져왔습니다.`));
  }
  return {
    palette: {
      name: cleanName(name),
      colors: colors.slice(0, STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors),
    },
    skippedColors,
    truncated,
    warnings: uniqueWarnings(warnings),
  };
}

interface PreparedPalette {
  readonly colors: StudioPaletteInterchangeColor[];
  readonly name: string;
  readonly skippedColors: number;
  readonly truncated: boolean;
  readonly warnings: StudioPaletteInterchangeWarning[];
}

function prepareExport(
  palette: StudioPaletteInterchangeDocument,
  maxColors: number = STUDIO_PALETTE_INTERCHANGE_LIMITS.maxColors
): PreparedPalette {
  const warnings: StudioPaletteInterchangeWarning[] = [];
  const colors: StudioPaletteInterchangeColor[] = [];
  let skippedColors = 0;
  for (const candidate of palette.colors) {
    const parsed = parseHexColorToken(candidate.hex);
    if (!parsed) {
      skippedColors++;
      continue;
    }
    const alpha = candidate.alpha ?? parsed.alpha;
    if (Number.isFinite(alpha) && alpha < 1) {
      warnings.push(warning("alpha-discarded", "Studio 팔레트는 불투명 sRGB 스와치만 보존하므로 알파를 제거했습니다."));
    }
    if (candidate.colorSpace && candidate.colorSpace !== "srgb") {
      warnings.push(warning("wide-gamut-clipped", "광색역 색은 현재 sRGB 헥스 값으로 클리핑해 저장했습니다."));
    }
    colors.push({ hex: parsed.hex, ...(candidate.name ? { name: cleanName(candidate.name, "색상") } : {}) });
  }
  const truncated = colors.length > maxColors;
  if (truncated) warnings.push(warning("truncated", `색 ${maxColors}개까지만 내보냈습니다.`));
  const limited = colors.slice(0, maxColors);
  if (limited.length === 0) fail("no-colors");
  if (skippedColors > 0) warnings.push(warning("color-skipped", `해석할 수 없는 색 ${skippedColors}개를 건너뛰었습니다.`));
  return {
    colors: limited,
    name: cleanName(palette.name, "ToonSpectrum 팔레트"),
    skippedColors,
    truncated,
    warnings,
  };
}

class BinaryCursor {
  private offset = 0;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  private take(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) fail("invalid");
    const start = this.offset;
    this.offset += count;
    return start;
  }

  u16(): number {
    return this.view.getUint16(this.take(2), false);
  }

  i16(): number {
    return this.view.getInt16(this.take(2), false);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), false);
  }

  f32(): number {
    const value = this.view.getFloat32(this.take(4), false);
    if (!Number.isFinite(value)) fail("invalid");
    return value;
  }

  ascii(count: number): string {
    const start = this.take(count);
    return String.fromCharCode(...this.bytes.subarray(start, start + count));
  }

  slice(count: number): Uint8Array {
    const start = this.take(count);
    return this.bytes.subarray(start, start + count);
  }

  utf16be(codeUnits: number, terminatorRequired = true): string {
    if (!Number.isSafeInteger(codeUnits) || codeUnits < (terminatorRequired ? 1 : 0)) fail("invalid");
    if (codeUnits > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxNameCodeUnits + 1) fail("invalid");
    const start = this.take(codeUnits * 2);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + start, codeUnits * 2);
    const values: number[] = [];
    for (let index = 0; index < codeUnits; index++) values.push(view.getUint16(index * 2, false));
    if (terminatorRequired && values.pop() !== 0) fail("invalid");
    return cleanName(String.fromCharCode(...values), "색상");
  }
}

class BinaryWriter {
  private readonly bytes: number[] = [];

  u16(value: number): void {
    this.bytes.push((value >>> 8) & 0xff, value & 0xff);
  }

  u32(value: number): void {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  f32(value: number): void {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, false);
    this.raw(new Uint8Array(buffer));
  }

  ascii(value: string): void {
    for (const character of value) this.bytes.push(character.charCodeAt(0) & 0xff);
  }

  utf16be(value: string, prefix: "u16" | "u32"): void {
    const safe = cleanName(value, "색상");
    const length = safe.length + 1;
    if (prefix === "u16") this.u16(length);
    else this.u32(length);
    for (let index = 0; index < safe.length; index++) this.u16(safe.charCodeAt(index));
    this.u16(0);
  }

  raw(value: Uint8Array): void {
    for (const byte of value) this.bytes.push(byte);
  }

  finish(): Uint8Array {
    const output = Uint8Array.from(this.bytes);
    if (output.byteLength > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBytes) fail("size");
    return output;
  }
}

function linearToSrgb(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** CIE Lab (D50, as used by Adobe swatches) to display sRGB (D65). */
function labToHex(lightness: number, a: number, b: number): string {
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (value: number): number => {
    const cube = value ** 3;
    return cube > 216 / 24389 ? cube : (116 * value - 16) / (24389 / 27);
  };
  const x50 = 0.96422 * inverse(fx);
  const y50 = inverse(fy);
  const z50 = 0.82521 * inverse(fz);
  // Bradford D50 -> D65 adaptation.
  const x = x50 * 0.9555766 + y50 * -0.0230393 + z50 * 0.0631636;
  const y = x50 * -0.0282895 + y50 * 1.0099416 + z50 * 0.0210077;
  const z = x50 * 0.0122982 + y50 * -0.020483 + z50 * 1.3299098;
  const red = linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314);
  const green = linearToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556);
  const blue = linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252);
  return rgbHex(red * 255, green * 255, blue * 255);
}

function cmykToHex(cyan: number, magenta: number, yellow: number, black: number): string {
  return rgbHex(
    (1 - Math.min(1, cyan)) * (1 - Math.min(1, black)) * 255,
    (1 - Math.min(1, magenta)) * (1 - Math.min(1, black)) * 255,
    (1 - Math.min(1, yellow)) * (1 - Math.min(1, black)) * 255
  );
}

function hsbToHex(hue: number, saturation: number, brightness: number): string {
  const h = ((hue % 1) + 1) % 1 * 6;
  const chroma = brightness * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const base = brightness - chroma;
  const [red, green, blue] = h < 1 ? [chroma, x, 0]
    : h < 2 ? [x, chroma, 0]
      : h < 3 ? [0, chroma, x]
        : h < 4 ? [0, x, chroma]
          : h < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return rgbHex((red + base) * 255, (green + base) * 255, (blue + base) * 255);
}

function aseColor(cursor: BinaryCursor, model: string): string | null {
  if (model === "RGB ") return rgbHex(cursor.f32() * 255, cursor.f32() * 255, cursor.f32() * 255);
  if (model === "Gray") {
    const gray = cursor.f32() * 255;
    return rgbHex(gray, gray, gray);
  }
  if (model === "CMYK") return cmykToHex(cursor.f32(), cursor.f32(), cursor.f32(), cursor.f32());
  if (model === "LAB ") return labToHex(cursor.f32(), cursor.f32(), cursor.f32());
  return null;
}

export function importAdobeAsePalette(input: Uint8Array | ArrayBuffer): StudioPaletteInterchangeImportResult {
  const cursor = new BinaryCursor(inputBytes(input));
  if (cursor.ascii(4) !== "ASEF") fail("invalid");
  const major = cursor.u16();
  cursor.u16();
  if (major !== 1) fail("unsupported-version");
  const blockCount = cursor.u32();
  if (blockCount > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBlocks) fail("invalid");
  const colors: StudioPaletteInterchangeColor[] = [];
  const warnings: StudioPaletteInterchangeWarning[] = [];
  let paletteName = "Adobe ASE 팔레트";
  let skippedColors = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const blockType = cursor.u16();
    const length = cursor.u32();
    const block = new BinaryCursor(cursor.slice(length));
    if (blockType === 0xc001) {
      paletteName = block.utf16be(block.u16());
      if (block.remaining !== 0) fail("invalid");
    } else if (blockType === 0xc002) {
      if (block.remaining !== 0) fail("invalid");
    } else if (blockType === 0x0001) {
      const name = block.utf16be(block.u16());
      const model = block.ascii(4);
      const hex = aseColor(block, model);
      if (hex === null) {
        skippedColors++;
        warnings.push(warning("color-skipped", `지원하지 않는 ASE 색공간 “${model.trim()}” 색을 건너뛰었습니다.`));
        continue;
      }
      block.u16(); // global/spot/normal — Studio has no swatch-type distinction.
      if (block.remaining !== 0) fail("invalid");
      if (model !== "RGB ") warnings.push(warning("non-rgb-converted", "ASE의 Lab/CMYK/Gray 색을 표시용 sRGB로 변환했습니다."));
      colors.push({ hex, name });
    } else {
      warnings.push(warning("unknown-block-skipped", "알 수 없는 ASE 확장 블록을 안전하게 건너뛰었습니다."));
    }
  }
  if (cursor.remaining !== 0) fail("invalid");
  return finalizeImport(paletteName, colors, skippedColors, warnings);
}

function aseNamedBlock(type: number, name: string): Uint8Array {
  const body = new BinaryWriter();
  body.utf16be(name, "u16");
  const bytes = body.finish();
  const block = new BinaryWriter();
  block.u16(type);
  block.u32(bytes.byteLength);
  block.raw(bytes);
  return block.finish();
}

export function exportAdobeAsePalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<Uint8Array> {
  const prepared = prepareExport(palette);
  const writer = new BinaryWriter();
  writer.ascii("ASEF");
  writer.u16(1);
  writer.u16(0);
  writer.u32(prepared.colors.length + 2);
  writer.raw(aseNamedBlock(0xc001, prepared.name));
  for (let index = 0; index < prepared.colors.length; index++) {
    const color = prepared.colors[index]!;
    const body = new BinaryWriter();
    body.utf16be(color.name ?? `색상 ${index + 1}`, "u16");
    body.ascii("RGB ");
    body.f32(parseInt(color.hex.slice(1, 3), 16) / 255);
    body.f32(parseInt(color.hex.slice(3, 5), 16) / 255);
    body.f32(parseInt(color.hex.slice(5, 7), 16) / 255);
    body.u16(0);
    const bytes = body.finish();
    writer.u16(0x0001);
    writer.u32(bytes.byteLength);
    writer.raw(bytes);
  }
  writer.u16(0xc002);
  writer.u32(0);
  return {
    data: writer.finish(),
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: uniqueWarnings(prepared.warnings),
  };
}

function parseAcoColor(space: number, words: readonly number[]): { hex: string; converted: boolean } | null {
  const unit = (value: number): number => value / 65535;
  if (space === 0) return { hex: rgbHex(unit(words[0]!) * 255, unit(words[1]!) * 255, unit(words[2]!) * 255), converted: false };
  if (space === 1) return { hex: hsbToHex(unit(words[0]!), unit(words[1]!), unit(words[2]!)), converted: true };
  if (space === 2) return {
    hex: cmykToHex(1 - unit(words[0]!), 1 - unit(words[1]!), 1 - unit(words[2]!), 1 - unit(words[3]!)),
    converted: true,
  };
  if (space === 7) {
    const signed = (value: number): number => value > 0x7fff ? value - 0x10000 : value;
    return { hex: labToHex(words[0]! / 100, signed(words[1]!) / 100, signed(words[2]!) / 100), converted: true };
  }
  if (space === 8) {
    const gray = Math.min(1, words[0]! / 10_000) * 255;
    return { hex: rgbHex(gray, gray, gray), converted: true };
  }
  if (space === 9) return {
    hex: cmykToHex(1 - words[0]! / 10_000, 1 - words[1]! / 10_000, 1 - words[2]! / 10_000, 1 - words[3]! / 10_000),
    converted: true,
  };
  return null;
}

interface AcoSection {
  readonly colors: StudioPaletteInterchangeColor[];
  readonly converted: boolean;
  readonly skipped: number;
  readonly version: number;
}

function readAcoSection(cursor: BinaryCursor): AcoSection {
  const version = cursor.u16();
  if (version !== 1 && version !== 2) fail("unsupported-version");
  const count = cursor.u16();
  if (count > STUDIO_PALETTE_INTERCHANGE_LIMITS.maxBlocks) fail("invalid");
  const colors: StudioPaletteInterchangeColor[] = [];
  let skipped = 0;
  let converted = false;
  for (let index = 0; index < count; index++) {
    const space = cursor.u16();
    const words = [cursor.u16(), cursor.u16(), cursor.u16(), cursor.u16()];
    const name = version === 2 ? cursor.utf16be(cursor.u32()) : `색상 ${index + 1}`;
    const parsed = parseAcoColor(space, words);
    if (!parsed) {
      skipped++;
      continue;
    }
    converted ||= parsed.converted;
    colors.push({ hex: parsed.hex, name });
  }
  return { colors, converted, skipped, version };
}

export function importAdobeAcoPalette(input: Uint8Array | ArrayBuffer): StudioPaletteInterchangeImportResult {
  const cursor = new BinaryCursor(inputBytes(input));
  const first = readAcoSection(cursor);
  const second = cursor.remaining > 0 ? readAcoSection(cursor) : null;
  if (cursor.remaining !== 0 || (second && (first.version !== 1 || second.version !== 2))) fail("invalid");
  const selected = second ?? first;
  const warnings: StudioPaletteInterchangeWarning[] = [];
  const skipped = first.skipped + (second?.skipped ?? 0);
  if (selected.converted) warnings.push(warning("non-rgb-converted", "ACO의 HSB/Lab/CMYK/Gray 색을 표시용 sRGB로 변환했습니다."));
  if (skipped > 0) warnings.push(warning("color-skipped", `지원하지 않는 ACO 색공간 색 ${skipped}개를 건너뛰었습니다.`));
  return finalizeImport("Adobe ACO 팔레트", selected.colors, skipped, warnings);
}

function writeAcoSection(writer: BinaryWriter, version: 1 | 2, colors: readonly StudioPaletteInterchangeColor[]): void {
  writer.u16(version);
  writer.u16(colors.length);
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index]!;
    writer.u16(0);
    writer.u16(Math.round(parseInt(color.hex.slice(1, 3), 16) / 255 * 65535));
    writer.u16(Math.round(parseInt(color.hex.slice(3, 5), 16) / 255 * 65535));
    writer.u16(Math.round(parseInt(color.hex.slice(5, 7), 16) / 255 * 65535));
    writer.u16(0);
    if (version === 2) writer.utf16be(color.name ?? `색상 ${index + 1}`, "u32");
  }
}

/** Writes the common ACO v1 + v2 pair: legacy readers use v1, modern readers retain v2 names. */
export function exportAdobeAcoPalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<Uint8Array> {
  const prepared = prepareExport(palette);
  const writer = new BinaryWriter();
  writeAcoSection(writer, 1, prepared.colors);
  writeAcoSection(writer, 2, prepared.colors);
  return {
    data: writer.finish(),
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: uniqueWarnings(prepared.warnings),
  };
}

function warningsForNamelessPalette(
  prepared: PreparedPalette,
  formatLabel: string
): StudioPaletteInterchangeWarning[] {
  const warnings = [...prepared.warnings];
  const namedColors = prepared.colors.filter((color) => Boolean(color.name)).length;
  if (namedColors > 0) {
    warnings.push(warning(
      "names-discarded",
      `${formatLabel} 형식은 색 이름을 저장하지 않아 이름 ${namedColors}개를 제외했습니다.`
    ));
  }
  return uniqueWarnings(warnings);
}

/**
 * Reads Photoshop's fixed 256-entry Adobe Color Table. Extended ACT files append
 * a big-endian color count and transparent palette index to the 768-byte RGB table.
 */
export function importAdobeActPalette(
  input: Uint8Array | ArrayBuffer
): StudioPaletteInterchangeImportResult {
  const data = inputBytes(input);
  if (data.byteLength !== STUDIO_ACT_TABLE_BYTES && data.byteLength !== STUDIO_ACT_EXTENDED_BYTES) {
    fail("invalid");
  }

  let colorCount = STUDIO_INDEXED_PALETTE_MAX_COLORS;
  let transparentIndex = 0xffff;
  if (data.byteLength === STUDIO_ACT_EXTENDED_BYTES) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const declaredCount = view.getUint16(STUDIO_ACT_TABLE_BYTES, false);
    colorCount = declaredCount === 0 ? STUDIO_INDEXED_PALETTE_MAX_COLORS : declaredCount;
    transparentIndex = view.getUint16(STUDIO_ACT_TABLE_BYTES + 2, false);
    if (colorCount > STUDIO_INDEXED_PALETTE_MAX_COLORS) fail("invalid");
    if (transparentIndex !== 0xffff && transparentIndex >= colorCount) fail("invalid");
  }

  const colors: StudioPaletteInterchangeColor[] = [];
  for (let index = 0; index < colorCount; index++) {
    const offset = index * 3;
    colors.push({ hex: rgbHex(data[offset]!, data[offset + 1]!, data[offset + 2]!) });
  }
  const warnings = transparentIndex === 0xffff
    ? []
    : [warning(
      "alpha-discarded",
      `ACT 투명 색 인덱스 ${transparentIndex}는 현재 불투명 Studio 스와치로 가져와 투명도를 제거했습니다.`
    )];
  return finalizeImport("Adobe ACT 팔레트", colors, 0, warnings);
}

/** Writes the extended 772-byte ACT form so the actual color count is unambiguous. */
export function exportAdobeActPalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<Uint8Array> {
  const prepared = prepareExport(palette, STUDIO_INDEXED_PALETTE_MAX_COLORS);
  const data = new Uint8Array(STUDIO_ACT_EXTENDED_BYTES);
  prepared.colors.forEach((color, index) => {
    const offset = index * 3;
    data[offset] = parseInt(color.hex.slice(1, 3), 16);
    data[offset + 1] = parseInt(color.hex.slice(3, 5), 16);
    data[offset + 2] = parseInt(color.hex.slice(5, 7), 16);
  });
  const view = new DataView(data.buffer);
  view.setUint16(STUDIO_ACT_TABLE_BYTES, prepared.colors.length, false);
  view.setUint16(STUDIO_ACT_TABLE_BYTES + 2, 0xffff, false);
  return {
    data,
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: warningsForNamelessPalette(prepared, "ACT"),
  };
}

/** Reads the JASC Paint Shop Pro palette grammar without accepting count mismatches or trailing records. */
export function importJascPalPalette(
  input: string | Uint8Array
): StudioPaletteInterchangeImportResult {
  const normalized = decodeText(input).replace(/\r\n?/gu, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = body.split("\n");
  if (lines[0] !== "JASC-PAL") fail("invalid");
  if (lines[1] !== "0100") fail("unsupported-version");
  if (!/^[1-9]\d{0,2}$/u.test(lines[2] ?? "")) fail("invalid");
  const colorCount = Number(lines[2]);
  if (colorCount > STUDIO_INDEXED_PALETTE_MAX_COLORS || lines.length !== colorCount + 3) fail("invalid");

  const colors: StudioPaletteInterchangeColor[] = [];
  for (let index = 0; index < colorCount; index++) {
    const match = /^(\d{1,3})[ \t]+(\d{1,3})[ \t]+(\d{1,3})$/u.exec(lines[index + 3]!);
    if (!match) fail("invalid");
    const channels = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (channels.some((channel) => channel > 255)) fail("invalid");
    colors.push({ hex: rgbHex(channels[0]!, channels[1]!, channels[2]!) });
  }
  return finalizeImport("JASC-PAL 팔레트", colors, 0, []);
}

export function exportJascPalPalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<string> {
  const prepared = prepareExport(palette, STUDIO_INDEXED_PALETTE_MAX_COLORS);
  const lines = ["JASC-PAL", "0100", String(prepared.colors.length)];
  for (const color of prepared.colors) {
    lines.push([
      parseInt(color.hex.slice(1, 3), 16),
      parseInt(color.hex.slice(3, 5), 16),
      parseInt(color.hex.slice(5, 7), 16),
    ].join(" "));
  }
  const data = `${lines.join("\r\n")}\r\n`;
  assertByteBudget(textEncoder.encode(data).byteLength);
  return {
    data,
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: warningsForNamelessPalette(prepared, "JASC-PAL"),
  };
}

export function importGplPalette(input: string | Uint8Array): StudioPaletteInterchangeImportResult {
  const text = decodeText(input);
  try {
    const parsed = parseGplPalette(text);
    return finalizeImport(
      parsed.name || "GIMP GPL 팔레트",
      parsed.colors.map((color) => ({ hex: color.hex, ...(color.name ? { name: color.name } : {}) })),
      parsed.skippedLines,
      parsed.skippedLines > 0
        ? [warning("color-skipped", `해석할 수 없는 GPL 줄 ${parsed.skippedLines}개를 건너뛰었습니다.`)]
        : []
    );
  } catch (error) {
    if (error instanceof StudioPaletteInterchangeError) throw error;
    return fail("invalid", error);
  }
}

export function exportGplPalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<string> {
  const prepared = prepareExport(palette);
  const data = writeGplPalette({ name: prepared.name, colors: prepared.colors.map((color) => color.hex) });
  assertByteBudget(textEncoder.encode(data).byteLength);
  return {
    data,
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: uniqueWarnings(prepared.warnings),
  };
}

export function importCssVariablePalette(input: string | Uint8Array): StudioPaletteInterchangeImportResult {
  const text = decodeText(input);
  const colors: StudioPaletteInterchangeColor[] = [];
  const warnings: StudioPaletteInterchangeWarning[] = [];
  let skipped = 0;
  const declaration = /--([\p{L}\p{N}_-]{1,255})\s*:\s*([^;{}]{1,256})\s*;/gu;
  for (const match of text.matchAll(declaration)) {
    const parsed = parseCssColorToken(match[2]!);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (parsed.alpha < 1) warnings.push(warning("alpha-discarded", "CSS 색상의 알파를 제거하고 불투명 sRGB 스와치로 가져왔습니다."));
    colors.push({ hex: parsed.hex, name: cleanName(match[1]!.replaceAll("-", " "), "색상") });
  }
  if (skipped > 0) warnings.push(warning("color-skipped", `색으로 해석할 수 없는 CSS 변수 ${skipped}개를 건너뛰었습니다.`));
  return finalizeImport("CSS 변수 팔레트", colors, skipped, warnings);
}

function cssVariableName(value: string, index: number, used: Set<string>): string {
  const base = value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || `color-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

export function exportCssVariablePalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<string> {
  const prepared = prepareExport(palette);
  const used = new Set<string>();
  const lines = [`/* ${prepared.name} — ToonSpectrum */`, ":root {"];
  prepared.colors.forEach((color, index) => {
    lines.push(`  --${cssVariableName(color.name ?? "", index, used)}: ${color.hex};`);
  });
  lines.push("}", "");
  const data = lines.join("\n");
  assertByteBudget(textEncoder.encode(data).byteLength);
  return {
    data,
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: uniqueWarnings(prepared.warnings),
  };
}

interface JsonPalettePayload {
  readonly schema: "toonspectrum.palette";
  readonly version: 1;
  readonly name: string;
  readonly colors: readonly { readonly hex: string; readonly name?: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function importJsonPalette(input: string | Uint8Array): StudioPaletteInterchangeImportResult {
  const text = decodeText(input);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return fail("invalid", error);
  }
  if (!isRecord(value) || value.schema !== "toonspectrum.palette" || value.version !== 1 || !Array.isArray(value.colors)) {
    fail("invalid");
  }
  const warnings: StudioPaletteInterchangeWarning[] = [];
  const colors: StudioPaletteInterchangeColor[] = [];
  let skipped = 0;
  for (const candidate of value.colors) {
    const rawHex = typeof candidate === "string" ? candidate : isRecord(candidate) ? candidate.hex : null;
    const parsed = typeof rawHex === "string" ? parseHexColorToken(rawHex) : null;
    if (!parsed) {
      skipped++;
      continue;
    }
    const rawAlpha = isRecord(candidate) && candidate.alpha !== undefined ? candidate.alpha : parsed.alpha;
    if (typeof rawAlpha !== "number" || !Number.isFinite(rawAlpha) || rawAlpha < 0 || rawAlpha > 1) {
      skipped++;
      continue;
    }
    if (rawAlpha < 1) warnings.push(warning("alpha-discarded", "JSON 팔레트의 알파를 제거하고 불투명 sRGB 스와치로 가져왔습니다."));
    const sourceSpace = isRecord(candidate) && typeof candidate.colorSpace === "string" ? candidate.colorSpace : "srgb";
    if (sourceSpace !== "srgb") warnings.push(warning("wide-gamut-clipped", "JSON 광색역 표시는 sRGB 헥스 값으로 클리핑해 가져왔습니다."));
    const name = isRecord(candidate) && typeof candidate.name === "string" ? cleanName(candidate.name, "색상") : undefined;
    colors.push({ hex: parsed.hex, ...(name ? { name } : {}) });
  }
  if (skipped > 0) warnings.push(warning("color-skipped", `해석할 수 없는 JSON 색 ${skipped}개를 건너뛰었습니다.`));
  return finalizeImport(typeof value.name === "string" ? value.name : "JSON 팔레트", colors, skipped, warnings);
}

export function exportJsonPalette(
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<string> {
  const prepared = prepareExport(palette);
  const payload: JsonPalettePayload = {
    schema: "toonspectrum.palette",
    version: 1,
    name: prepared.name,
    colors: prepared.colors.map((color) => ({ hex: color.hex, ...(color.name ? { name: color.name } : {}) })),
  };
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  assertByteBudget(textEncoder.encode(data).byteLength);
  return {
    data,
    exportedColors: prepared.colors.length,
    skippedColors: prepared.skippedColors,
    truncated: prepared.truncated,
    warnings: uniqueWarnings(prepared.warnings),
  };
}

export function importStudioPalette(
  format: StudioPaletteInterchangeFormat,
  input: string | Uint8Array | ArrayBuffer
): StudioPaletteInterchangeImportResult {
  if (format === "ase") return importAdobeAsePalette(input instanceof ArrayBuffer ? input : typeof input === "string" ? fail("invalid") : input);
  if (format === "aco") return importAdobeAcoPalette(input instanceof ArrayBuffer ? input : typeof input === "string" ? fail("invalid") : input);
  if (format === "act") return importAdobeActPalette(input instanceof ArrayBuffer ? input : typeof input === "string" ? fail("invalid") : input);
  if (input instanceof ArrayBuffer) return importStudioPalette(format, new Uint8Array(input));
  if (format === "pal") return importJascPalPalette(input);
  if (format === "gpl") return importGplPalette(input);
  if (format === "css") return importCssVariablePalette(input);
  return importJsonPalette(input);
}

export function exportStudioPalette(
  format: StudioPaletteInterchangeFormat,
  palette: StudioPaletteInterchangeDocument
): StudioPaletteInterchangeExportResult<string | Uint8Array> {
  if (format === "ase") return exportAdobeAsePalette(palette);
  if (format === "aco") return exportAdobeAcoPalette(palette);
  if (format === "act") return exportAdobeActPalette(palette);
  if (format === "pal") return exportJascPalPalette(palette);
  if (format === "gpl") return exportGplPalette(palette);
  if (format === "css") return exportCssVariablePalette(palette);
  return exportJsonPalette(palette);
}
