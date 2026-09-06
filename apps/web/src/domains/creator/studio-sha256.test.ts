import { describe, expect, it } from "vitest";

import {
  createSha256Portable,
  sha256HexPortable,
} from "./studio-sha256";

const TEXT_ENCODER = new TextEncoder();

function bufferHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("portable Studio SHA-256", () => {
  it.each([
    {
      label: "empty input",
      input: "",
      expected:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      label: "FIPS abc vector",
      input: "abc",
      expected:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      label: "multi-block FIPS vector",
      input:
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected:
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  ])("matches the standard SHA-256 digest for $label", ({ input, expected }) => {
    expect(sha256HexPortable(TEXT_ENCODER.encode(input))).toBe(expected);
  });

  it("matches the preferred native Web Crypto implementation byte-for-byte", async () => {
    const bytes = TEXT_ENCODER.encode(
      "ToonSpectrum portable checksum parity — 한글과 🎨"
    );
    const subtle = globalThis.crypto?.subtle;
    expect(subtle).toBeDefined();
    if (!subtle) return;

    const native = await subtle.digest("SHA-256", bytes);
    expect(sha256HexPortable(bytes)).toBe(bufferHex(native));
  });

  it.each([0, 1, 63, 64, 65, 1_048_593])(
    "matches one-shot hashing for a %i-byte input across arbitrary chunk boundaries",
    async (byteLength) => {
      const bytes = Uint8Array.from(
        { length: byteLength },
        (_, index) => (index * 197 + 31) & 0xff
      );
      const expected = sha256HexPortable(bytes);
      const subtle = globalThis.crypto?.subtle;
      expect(subtle).toBeDefined();
      if (!subtle) return;
      expect(bufferHex(await subtle.digest("SHA-256", bytes))).toBe(expected);

      const hasher = createSha256Portable();
      const chunkPattern = [1, 63, 2, 127, 64, 4_093, 17];
      let offset = 0;
      let chunkIndex = 0;

      hasher.update(bytes.subarray(0, 0));
      while (offset < bytes.byteLength) {
        const nextOffset = Math.min(
          bytes.byteLength,
          offset + chunkPattern[chunkIndex % chunkPattern.length]
        );
        hasher.update(bytes.subarray(offset, nextOffset));
        offset = nextOffset;
        chunkIndex += 1;
      }

      expect(hasher.finalizeHex()).toBe(expected);
    }
  );

  it("copies only an incomplete block instead of retaining a caller chunk", () => {
    const mutableChunk = Uint8Array.from({ length: 63 }, (_, index) => index);
    const expected = sha256HexPortable(mutableChunk.slice());
    const hasher = createSha256Portable().update(mutableChunk);

    mutableChunk.fill(0xff);

    expect(hasher.finalizeHex()).toBe(expected);
  });

  it("fails closed when update or finalize is called after finalization", () => {
    const hasher = createSha256Portable().update(TEXT_ENCODER.encode("closed"));
    expect(hasher.finalizeHex()).toBe(
      sha256HexPortable(TEXT_ENCODER.encode("closed"))
    );

    expect(() => hasher.update(new Uint8Array())).toThrow(/already finalized/);
    expect(() => hasher.finalizeHex()).toThrow(/already finalized/);
  });
});
