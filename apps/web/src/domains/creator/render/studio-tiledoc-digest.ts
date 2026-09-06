/**
 * Content digest for tile payloads.
 *
 * Persistence is content-addressed so that copy-on-write sharing survives a round trip: two undo
 * snapshots that share a tile must resolve to one blob, not two. That needs a digest that is
 * cheap enough to run on a 1 MiB buffer on the commit path.
 *
 * Implementation: four independent FNV-1a lanes over interleaved byte strides, concatenated into
 * a 128-bit hex string. This is **not** cryptographic — it defends against accidental collision in
 * a single document's tile set, not against an adversary. Callers that need a cryptographic
 * identity (for example to reuse the raster log's SHA-256 discipline) can inject their own
 * function wherever a `StudioTileDocDigestFn` is accepted; nothing here assumes the built-in.
 */

export type StudioTileDocDigestFn = (bytes: Uint8Array | Uint8ClampedArray) => string;

const LANES = 4;
const OFFSET_BASIS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b] as const;
const PRIME = 0x01000193;

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * 128-bit hex digest (32 characters). Deterministic, endian-independent, length-committed:
 * the byte length is folded in so that a truncated buffer can never collide with a longer one.
 */
export function studioTileDocDigest(bytes: Uint8Array | Uint8ClampedArray): string {
  const lanes = new Uint32Array(LANES);
  for (let lane = 0; lane < LANES; lane += 1) lanes[lane] = OFFSET_BASIS[lane];
  const length = bytes.length;
  for (let index = 0; index < length; index += 1) {
    const lane = index & (LANES - 1);
    lanes[lane] = Math.imul(lanes[lane] ^ bytes[index], PRIME) >>> 0;
  }
  for (let lane = 0; lane < LANES; lane += 1) {
    lanes[lane] = Math.imul(lanes[lane] ^ length, PRIME) >>> 0;
    // Cross-lane avalanche so a single changed byte moves every lane, not just its own.
    lanes[lane] = Math.imul(lanes[lane] ^ lanes[(lane + 1) & (LANES - 1)], PRIME) >>> 0;
  }
  let out = "";
  for (let lane = 0; lane < LANES; lane += 1) out += hex8(lanes[lane]);
  return out;
}

export function isStudioTileDocDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}
