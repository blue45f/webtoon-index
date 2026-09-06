/**
 * Shared ZIP/PNG-compatible CRC-32 core.
 *
 * Keep this loop index-based: `for…of` over large typed arrays was measured at more than three
 * times the cost of an indexed loop in the package-export hot path.
 */
const STUDIO_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Register value before any byte has been folded in. */
export const STUDIO_CRC32_INITIAL_STATE = 0xffff_ffff;

/**
 * Folds `bytes[start, end)` into a running CRC-32 register and returns the new register.
 *
 * The register is the raw (un-finalized) state, so callers can split one logical buffer into
 * arbitrary slices — for example to yield to the event loop between slices — and obtain exactly
 * the same digest `calculateStudioCrc32` produces for the whole buffer. Pass the result through
 * `finalizeStudioCrc32` once every slice has been folded in.
 */
export function updateStudioCrc32(
  state: number,
  bytes: Uint8Array,
  start = 0,
  end = bytes.byteLength,
): number {
  let crc = state >>> 0;
  const stop = Math.min(end, bytes.byteLength);
  for (let index = Math.max(0, start); index < stop; index += 1) {
    crc = (crc >>> 8) ^ STUDIO_CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]!;
  }
  return crc >>> 0;
}

/** Turns a running register into the standard ZIP/PNG CRC-32 value. */
export function finalizeStudioCrc32(state: number): number {
  return (state ^ 0xffff_ffff) >>> 0;
}

/** Calculates the standard reflected CRC-32 used by ZIP and PNG. */
export function calculateStudioCrc32(bytes: Uint8Array): number {
  return finalizeStudioCrc32(updateStudioCrc32(STUDIO_CRC32_INITIAL_STATE, bytes));
}
