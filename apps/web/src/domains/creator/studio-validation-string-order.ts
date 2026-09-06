/**
 * Total ordering for validator-local comparisons.
 *
 * This makes JavaScript's default UTF-16 code-unit ordering explicit. It preserves the validator's
 * historical behavior without relying on locale/ICU data and returns zero only for identical
 * strings. Do not use this helper to serialize or hash canonical payloads.
 */
export function compareStudioValidationStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
