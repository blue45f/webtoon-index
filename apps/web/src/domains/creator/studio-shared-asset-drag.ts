import {
  STUDIO_ASSET_DATA_URL_MAX_CHARS,
  STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS,
} from "./studio-upload-image-safety";

export type StudioAssetDragPayload =
  | { source: "local"; src: string; width: number; height: number }
  | { source: "community"; assetId: string };

export const STUDIO_ASSET_DRAG_MAX_PAYLOAD_LENGTH =
  STUDIO_ASSET_DATA_URL_MAX_CHARS + 1_024;
export const STUDIO_ASSET_DRAG_MAX_IMAGE_AXIS = 16_384;
export const STUDIO_ASSET_DRAG_MAX_IMAGE_PIXELS =
  STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS;
export const STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES = 2 * 1024 * 1024;

const COMMUNITY_ASSET_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,199}$/u;
const RASTER_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]*={0,2})$/u;
const SVG_BASE64_DATA_URL_PATTERN =
  /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]*={0,2})$/u;
const SVG_PERCENT_PREFIXES = [
  "data:image/svg+xml,",
  "data:image/svg+xml;utf8,",
  "data:image/svg+xml;charset=utf-8,",
] as const;
const SVG_MAX_PERCENT_ENCODED_CHARS =
  STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES * 6;
const SVG_FORBIDDEN_ELEMENT_PATTERN =
  /^(?:[A-Za-z_][\w.-]*:)?(?:script|style|foreignObject|iframe|object|embed|audio|video|animate|animateColor|animateMotion|animateTransform|set|discard|handler|listener)$/iu;
const SVG_EVENT_ATTRIBUTE_PATTERN =
  /(?:^|\s)on[A-Za-z][\w:.-]*\s*=/iu;
const SVG_HREF_ATTRIBUTE_PATTERN =
  /(?:^|\s)(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
const SVG_URL_CALL_PATTERN = /url\s*\(([^)]*)\)/giu;

function hasExactKeys(
  candidate: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(candidate);
  return keys.length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(candidate, key));
}

function hasValidBase64Payload(match: RegExpExecArray | null): boolean {
  if (!match) return false;
  const payload = match[1];
  if (!payload || payload.length > STUDIO_ASSET_DATA_URL_MAX_CHARS) return false;
  // Base64 length can be unpadded, but a one-character remainder can never decode.
  return payload.replace(/=+$/u, "").length % 4 !== 1;
}

function decodeBase64Svg(match: RegExpExecArray | null): string | null {
  if (!hasValidBase64Payload(match)) return null;
  const payload = match![1];
  const unpaddedLength = payload.replace(/=+$/u, "").length;
  if (
    Math.floor((unpaddedLength * 3) / 4)
    > STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES
  ) return null;
  try {
    const binary = globalThis.atob(payload);
    if (binary.length > STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodePercentEncodedSvgDataUrl(value: string): string | null {
  const prefix = SVG_PERCENT_PREFIXES.find((candidate) => value.startsWith(candidate));
  if (!prefix) return null;
  const payload = value.slice(prefix.length);
  if (!payload || payload.length > SVG_MAX_PERCENT_ENCODED_CHARS) return null;
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return null;
    if (payload[index] !== "%") continue;
    if (!/^[0-9a-f]{2}$/iu.test(payload.slice(index + 1, index + 3))) return null;
    index += 2;
  }
  try {
    const decoded = decodeURIComponent(payload);
    if (
      decoded.length > STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES
      || new TextEncoder().encode(decoded).byteLength
        > STUDIO_ASSET_DRAG_MAX_SVG_DECODED_BYTES
    ) return null;
    return decoded;
  } catch {
    return null;
  }
}

function isSafeInternalSvgReference(value: string): boolean {
  return /^#[A-Za-z_][\w:.-]*$/u.test(value.trim());
}

function hasForbiddenXmlControl(svg: string): boolean {
  for (let index = 0; index < svg.length; index += 1) {
    const code = svg.charCodeAt(index);
    if (
      (code >= 0x00 && code <= 0x08)
      || code === 0x0b
      || code === 0x0c
      || (code >= 0x0e && code <= 0x1f)
      || code === 0x7f
    ) return true;
  }
  return false;
}

function isSafeSvgMarkup(svg: string): boolean {
  if (
    !svg
    || hasForbiddenXmlControl(svg)
    || /<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(svg)
    || /@import\b/iu.test(svg)
    || /(?:java|vb)script\s*:/iu.test(svg)
    || /expression\s*\(/iu.test(svg)
    || /(?:^|\s)xml:base\s*=/iu.test(svg)
  ) return false;

  const withoutDeclaration = svg
    .replace(/^\uFEFF/u, "")
    .trimStart()
    .replace(/^<\?xml(?:\s[^?]*)?\?>\s*/iu, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/u, "");
  if (!/^<svg(?:\s|>)/iu.test(withoutDeclaration)) return false;

  for (let cursor = 0; cursor < svg.length;) {
    const open = svg.indexOf("<", cursor);
    if (open < 0) break;
    let quote = "";
    let close = -1;
    for (let index = open + 1; index < svg.length; index += 1) {
      const character = svg[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        close = index;
        break;
      }
    }
    if (close < 0) return false;
    const tag = svg.slice(open + 1, close);
    const elementName = /^\s*\/?\s*([A-Za-z_][\w:.-]*)/u.exec(tag)?.[1];
    if (
      (elementName && SVG_FORBIDDEN_ELEMENT_PATTERN.test(elementName))
      || SVG_EVENT_ATTRIBUTE_PATTERN.test(tag)
      || /(?:^|\s)xml:base\s*=/iu.test(tag)
    ) return false;

    SVG_HREF_ATTRIBUTE_PATTERN.lastIndex = 0;
    for (
      let match = SVG_HREF_ATTRIBUTE_PATTERN.exec(tag);
      match;
      match = SVG_HREF_ATTRIBUTE_PATTERN.exec(tag)
    ) {
      const reference = match[1] ?? match[2] ?? match[3] ?? "";
      if (!isSafeInternalSvgReference(reference)) return false;
    }
    cursor = close + 1;
  }

  const urlCallCount = svg.match(/url\s*\(/giu)?.length ?? 0;
  let parsedUrlCallCount = 0;
  SVG_URL_CALL_PATTERN.lastIndex = 0;
  for (
    let match = SVG_URL_CALL_PATTERN.exec(svg);
    match;
    match = SVG_URL_CALL_PATTERN.exec(svg)
  ) {
    parsedUrlCallCount += 1;
    const reference = match[1].trim().replace(/^(["'])(.*)\1$/u, "$2");
    if (!isSafeInternalSvgReference(reference)) return false;
  }
  return parsedUrlCallCount === urlCallCount;
}

function isValidSvgDataUrl(value: string): boolean {
  const svg = value.startsWith("data:image/svg+xml;base64,")
    ? decodeBase64Svg(SVG_BASE64_DATA_URL_PATTERN.exec(value))
    : decodePercentEncodedSvgDataUrl(value);
  return svg !== null && isSafeSvgMarkup(svg);
}

function isAllowedStudioAssetDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_ASSET_DATA_URL_MAX_CHARS
  ) return false;
  return (
    hasValidBase64Payload(RASTER_DATA_URL_PATTERN.exec(value))
    || isValidSvgDataUrl(value)
  );
}

function hasSafeImageDimensions(
  candidate: Record<string, unknown>
): candidate is Record<string, unknown> & { width: number; height: number } {
  const { width, height } = candidate;
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > STUDIO_ASSET_DRAG_MAX_IMAGE_AXIS
    || height > STUDIO_ASSET_DRAG_MAX_IMAGE_AXIS
  ) return false;
  const pixels = Math.ceil(width) * Math.ceil(height);
  return Number.isSafeInteger(pixels) && pixels <= STUDIO_ASSET_DRAG_MAX_IMAGE_PIXELS;
}

export function serializeStudioLocalAssetDragPayload(input: {
  src: string;
  width: number;
  height: number;
}): string {
  return JSON.stringify({ source: "local", ...input } satisfies StudioAssetDragPayload);
}

export function serializeStudioCommunityAssetDragPayload(assetId: string): string {
  return JSON.stringify({ source: "community", assetId } satisfies StudioAssetDragPayload);
}

export function parseStudioAssetDragPayload(value: string): StudioAssetDragPayload | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > STUDIO_ASSET_DRAG_MAX_PAYLOAD_LENGTH
  ) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.source === "community") {
    return hasExactKeys(candidate, ["source", "assetId"])
      && typeof candidate.assetId === "string"
      && COMMUNITY_ASSET_ID_PATTERN.test(candidate.assetId)
      ? { source: "community", assetId: candidate.assetId }
      : null;
  }
  // `source` was absent in the pre-lazy-load local drag payload. Keep only the exact legacy
  // envelope and subject it to the same data-URL and allocation budgets as the current shape.
  const expectedKeys = candidate.source === "local"
    ? ["source", "src", "width", "height"]
    : ["src", "width", "height"];
  if (
    (candidate.source !== "local" && candidate.source !== undefined)
    || !hasExactKeys(candidate, expectedKeys)
    || !isAllowedStudioAssetDataUrl(candidate.src)
    || !hasSafeImageDimensions(candidate)
  ) return null;
  return {
    source: "local",
    src: candidate.src,
    width: candidate.width,
    height: candidate.height,
  };
}
