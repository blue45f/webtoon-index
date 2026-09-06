/**
 * Safe numeric editing helpers for the Studio transform inspector.
 *
 * Transform fields accept the compact arithmetic artists expect from desktop DCC tools without
 * evaluating JavaScript: plain numbers, one binary operation, relative assignments (`+=`, `-=`,
 * `*=`, `/=`), and percentages. Every result is finite, bounded and rounded before it reaches the
 * document model, so a malformed draft can never publish NaN/Infinity or float-noise history.
 */

export type StudioTransformPercentMode = "absolute" | "relative";

export interface StudioTransformFieldResolveOptions {
  readonly min?: number;
  readonly max?: number;
  /**
   * `relative`: `150%` means current × 1.5 (position/size/rotation fields).
   * `absolute`: `60%` means 60 in the displayed unit (the opacity field already displays 0–100).
   */
  readonly percentMode?: StudioTransformPercentMode;
}

export interface StudioTransformFieldStepInput extends StudioTransformFieldResolveOptions {
  readonly current: number;
  readonly draft?: string | null;
  readonly direction: -1 | 1;
  readonly step?: number;
  readonly coarseStep?: number;
  readonly fineStep?: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

const NUMBER_SOURCE = String.raw`[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?`;
const NUMBER_PATTERN = new RegExp(`^(${NUMBER_SOURCE})$`, "i");
const RELATIVE_PATTERN = new RegExp(`^([+*/-])=\\s*(${NUMBER_SOURCE})$`, "i");
const BINARY_PATTERN = new RegExp(`^(${NUMBER_SOURCE})\\s*([+*/-])\\s*(${NUMBER_SOURCE})$`, "i");
const PERCENT_PATTERN = new RegExp(`^(${NUMBER_SOURCE})\\s*%$`, "i");
const SUFFIX_PATTERN = /(?:px|deg|°)\s*$/iu;
const ROUND_PRECISION = 1_000_000;

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

function calculate(left: number, operator: string, right: number): number | null {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  let result: number;
  switch (operator) {
    case "+":
      result = left + right;
      break;
    case "-":
      result = left - right;
      break;
    case "*":
      result = left * right;
      break;
    case "/":
      if (right === 0) return null;
      result = left / right;
      break;
    default:
      return null;
  }
  return Number.isFinite(result) ? result : null;
}

/** Removes visual units only; no arbitrary identifier or function syntax is accepted. */
function normalizeDraft(draft: string): string {
  return draft.trim().replaceAll(",", "").replace(SUFFIX_PATTERN, "").trim();
}

/** Stable model number: finite, clamped, six decimals, and never negative zero. */
export function normalizeStudioTransformFieldValue(
  value: number,
  options: StudioTransformFieldResolveOptions = {},
): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(clamp(value, options.min, options.max) * ROUND_PRECISION) / ROUND_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Resolves one field draft without `eval`/`Function`.
 *
 * Supported examples: `120`, `120px`, `45deg`, `+=10`, `*=1.25`, `100/3`, `150%`.
 */
export function resolveStudioTransformFieldDraft(
  draft: string,
  current: number,
  options: StudioTransformFieldResolveOptions = {},
): number | null {
  if (!Number.isFinite(current)) return null;
  const normalized = normalizeDraft(draft);
  if (normalized === "") return null;

  const relative = RELATIVE_PATTERN.exec(normalized);
  if (relative) {
    const operand = Number(relative[2]);
    const value = calculate(current, relative[1]!, operand);
    return value === null ? null : normalizeStudioTransformFieldValue(value, options);
  }

  const percent = PERCENT_PATTERN.exec(normalized);
  if (percent) {
    const amount = Number(percent[1]);
    const value = options.percentMode === "absolute" ? amount : current * (amount / 100);
    return normalizeStudioTransformFieldValue(value, options);
  }

  const binary = BINARY_PATTERN.exec(normalized);
  if (binary) {
    const value = calculate(Number(binary[1]), binary[2]!, Number(binary[3]));
    return value === null ? null : normalizeStudioTransformFieldValue(value, options);
  }

  const plain = NUMBER_PATTERN.exec(normalized);
  if (!plain) return null;
  return normalizeStudioTransformFieldValue(Number(plain[1]), options);
}

/** Human-readable draft value without exponential float noise. */
export function formatStudioTransformFieldValue(value: number): string {
  const normalized = normalizeStudioTransformFieldValue(value);
  return normalized === null ? "0" : String(normalized);
}

/**
 * Computes one keyboard nudge while keeping it as a local draft. Enter/blur still produces the
 * single durable commit, even when the artist held an arrow key for many repeated events.
 */
export function stepStudioTransformFieldValue(
  input: StudioTransformFieldStepInput,
): number {
  const base =
    input.draft === undefined || input.draft === null
      ? input.current
      : resolveStudioTransformFieldDraft(input.draft, input.current, input) ?? input.current;
  const normal = finite(input.step) && input.step > 0 ? input.step : 1;
  const coarse = finite(input.coarseStep) && input.coarseStep > 0 ? input.coarseStep : normal * 10;
  const fine = finite(input.fineStep) && input.fineStep > 0 ? input.fineStep : normal / 10;
  const amount =
    input.shiftKey && input.altKey
      ? normal
      : input.shiftKey
        ? coarse
        : input.altKey
          ? fine
          : normal;
  return normalizeStudioTransformFieldValue(base + amount * input.direction, input) ?? input.current;
}
