/** Renderer-independent precision and colour rules for the character workshop. */
export interface CharacterRangeSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const MAX_DIGITS = 12;

export function characterStepDigits(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const [coefficient = "", exponent = "0"] = step.toString().toLowerCase().split("e");
  const fraction = coefficient.split(".")[1]?.length ?? 0;
  return Math.min(MAX_DIGITS, Math.max(0, fraction - Number(exponent)));
}

export function characterRangeSpec(min: number, max: number, step: number): CharacterRangeSpec {
  const lower = Number.isFinite(min) ? min : 0;
  const upper = Number.isFinite(max) ? Math.max(lower, max) : lower;
  return { min: lower, max: upper, step: Number.isFinite(step) && step > 0 ? step : 1 };
}

export function clampCharacterValue(value: number, spec: CharacterRangeSpec, fallback = spec.min): number {
  const finite = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : spec.min;
  return Math.min(spec.max, Math.max(spec.min, finite));
}

/** Remove floating point noise without discarding the precision of typed or Alt-modified values. */
export function finalizeCharacterValue(value: number, spec: CharacterRangeSpec): number {
  return clampCharacterValue(Number(clampCharacterValue(value, spec).toPrecision(15)), spec);
}

export function snapCharacterValue(value: number, spec: CharacterRangeSpec): number {
  const bounded = clampCharacterValue(value, spec);
  // Endpoints are always reachable, even if the span is not divisible by the step.
  if (bounded === spec.min || bounded === spec.max) return bounded;
  return finalizeCharacterValue(spec.min + Math.round((bounded - spec.min) / spec.step) * spec.step, spec);
}

export function nudgeCharacterValue(
  value: number,
  direction: 1 | -1,
  spec: CharacterRangeSpec,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean } = {},
): number {
  const multiplier = modifiers.shiftKey ? 10 : modifiers.altKey ? 0.1 : 1;
  return finalizeCharacterValue(clampCharacterValue(value, spec) + spec.step * multiplier * direction, spec);
}

/** Keep the familiar step precision, but never hide a finer value that is actually in the scene. */
export function formatCharacterNumber(value: number, step: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1e21 || (value !== 0 && Math.abs(value) < 1e-12)) return value.toString();
  const plain = Number(value.toFixed(MAX_DIGITS)).toFixed(MAX_DIGITS);
  const [whole = "0", decimals = ""] = plain.split(".");
  const significant = decimals.replace(/0+$/u, "");
  const digits = Math.max(characterStepDigits(step), significant.length);
  return digits > 0 ? `${whole}.${decimals.slice(0, digits)}` : whole;
}

export function formatCharacterValue(value: number, step: number, unit?: string): string {
  if (unit === "%") return `${formatCharacterNumber(value * 100, step * 100)}%`;
  if (unit === "×") return `${formatCharacterNumber(value, Math.min(step, 0.01))}×`;
  if (unit === "°") return `${formatCharacterNumber(value, step)}°`;
  return `${formatCharacterNumber(value, step)}${unit ? ` ${unit}` : ""}`;
}

/**
 * One comma means a decimal point (1,05). Repeated separators are accepted only as valid
 * three-digit grouping; malformed text such as 1,2,3 is never silently turned into 12.3.
 * NFKC supports full-width keyboards; Unicode minus and space grouping support pasted values.
 */
export function parseCharacterNumber(raw: string): number | null {
  let text = raw.normalize("NFKC").trim().replace(/\u2212/gu, "-");
  if (!text || text.length > 128 || !/^[+-]?[\d., _]+$/u.test(text)) return null;
  const sign = text.startsWith("-") ? "-" : "";
  text = text.replace(/^[+-]/u, "");
  if (/[ _]/u.test(text)) {
    if (!/^\d{1,3}(?:[ _]\d{3})+(?:[.,]\d+)?$/u.test(text)) return null;
    text = text.replace(/[ _]/gu, "");
  }
  const dot = text.lastIndexOf(".");
  const comma = text.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    const decimal = dot > comma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    const parts = text.split(decimal);
    if (parts.length !== 2) return null;
    const [integer = "", fraction = ""] = parts;
    const groups = integer.split(group);
    if (!/^\d{1,3}$/u.test(groups[0] ?? "") || !groups.slice(1).every((part) => /^\d{3}$/u.test(part))) return null;
    if (!/^\d+$/u.test(fraction)) return null;
    text = `${groups.join("")}.${fraction}`;
  } else {
    const separator = comma >= 0 ? "," : ".";
    const parts = text.split(separator);
    if (parts.length > 2) {
      if (!/^\d{1,3}$/u.test(parts[0] ?? "") || !parts.slice(1).every((part) => /^\d{3}$/u.test(part))) return null;
      text = parts.join("");
    } else if (comma >= 0) {
      text = text.replace(",", ".");
    }
  }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text)) return null;
  const value = Number(`${sign}${text}`);
  return Number.isFinite(value) ? value : null;
}

export function normalizeCharacterHex(raw: string): string | null {
  const text = raw.normalize("NFKC").trim();
  const hash = text.startsWith("#") ? text : `#${text}`;
  if (/^#[0-9a-f]{3}$/iu.test(hash)) {
    return `#${hash[1]}${hash[1]}${hash[2]}${hash[2]}${hash[3]}${hash[3]}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/iu.test(hash) ? hash.toLowerCase() : null;
}

/** Synchronous edit state: React may batch the final change and pointer-up in the same render. */
export interface CharacterPrecisionEdit<T> {
  readonly before: T;
  readonly value: T;
}

export function previewCharacterEdit<T>(edit: CharacterPrecisionEdit<T> | null, before: T, value: T): CharacterPrecisionEdit<T> {
  return { before: edit ? edit.before : before, value };
}

export const CHARACTER_RANGE_EDIT_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End",
]);
