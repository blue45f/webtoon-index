import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "./studio-sha256";
import { verifyStudioLivingInkPngDataUrlHash } from "./StudioKonvaImageNode";

function pngDataUrl(bytes: Uint8Array): `data:image/png;base64,${string}` {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${globalThis.btoa(binary)}`;
}

describe("Living Ink canonical handoff", () => {
  it("accepts only the actual PNG bytes named by the persisted receipt", () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const expected = `sha256:${sha256HexPortable(bytes)}` as const;
    expect(verifyStudioLivingInkPngDataUrlHash(pngDataUrl(bytes), expected)).toBe(expected);
  });

  it("fails closed when src bytes are tampered while the receipt hash stays unchanged", () => {
    const original = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const tampered = Uint8Array.from([...original.slice(0, -1), 4]);
    const expected = `sha256:${sha256HexPortable(original)}` as const;
    expect(verifyStudioLivingInkPngDataUrlHash(pngDataUrl(tampered), expected)).toBeNull();
  });
});
