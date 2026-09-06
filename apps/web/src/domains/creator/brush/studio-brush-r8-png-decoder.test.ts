import { describe, expect, it, vi } from "vitest";

import { createStudioBrushR8PngDecoder } from "./studio-brush-r8-png-decoder";


import type { StudioBrushR8DecodedPng } from "./studio-brush-r8-grain-hydrator";

function decoded(): StudioBrushR8DecodedPng {
  return { width: 1, height: 1, bitDepth: 8, colorModel: "RGB", components: 3, channels: 4, alpha: true, getValueByIndex: () => 255 };
}

describe("R8 brush decoder lazy-load recovery", () => {
  it("retries a failed module load instead of poisoning every later texture brush", async () => {
    const decodePng = vi.fn(() => decoded());
    const load = vi.fn<() => Promise<{ decodePng: typeof decodePng }>>()
      .mockRejectedValueOnce(new Error("injected chunk failure"))
      .mockResolvedValue({ decodePng });
    const decode = createStudioBrushR8PngDecoder(load);
    await expect(decode(new Uint8Array())).rejects.toThrow("injected chunk failure");
    await expect(decode(new Uint8Array())).resolves.toMatchObject({ width: 1 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares concurrent loading and a successful decoder across 1,000 brush uses", async () => {
    const decodePng = vi.fn(() => decoded());
    const load = vi.fn(async () => ({ decodePng }));
    const decode = createStudioBrushR8PngDecoder(load);
    await Promise.all(Array.from({ length: 1_000 }, () => decode(new Uint8Array())));
    expect(load).toHaveBeenCalledTimes(1);
    expect(decodePng).toHaveBeenCalledTimes(1_000);
  });

  it("does not reload a healthy decoder when an individual PNG is corrupt", async () => {
    const decodePng = vi.fn(() => decoded())
      .mockImplementationOnce(() => { throw new Error("invalid PNG"); });
    const load = vi.fn(async () => ({ decodePng }));
    const decode = createStudioBrushR8PngDecoder(load);
    await expect(decode(new Uint8Array())).rejects.toThrow("invalid PNG");
    await expect(decode(new Uint8Array())).resolves.toMatchObject({ width: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("recovers from a synchronous loader exception", async () => {
    let attempts = 0;
    const decode = createStudioBrushR8PngDecoder(() => {
      if (attempts++ === 0) throw new Error("synchronous load failure");
      return Promise.resolve({ decodePng: () => decoded() });
    });
    await expect(decode(new Uint8Array())).rejects.toThrow("synchronous load failure");
    await expect(decode(new Uint8Array())).resolves.toMatchObject({ height: 1 });
    expect(attempts).toBe(2);
  });
});
