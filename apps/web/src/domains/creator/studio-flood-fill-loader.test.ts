import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadFloodFillSourceImage } from "./studio-flood-fill";

class FakeImage {
  static instances: FakeImage[] = [];
  crossOrigin = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  private value = "";

  constructor() {
    FakeImage.instances.push(this);
  }

  set src(next: string) {
    this.value = next;
  }

  get src(): string {
    return this.value;
  }
}

describe("loadFloodFillSourceImage cancellation", () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops a pending decode by clearing src and rejects with AbortError", async () => {
    const controller = new AbortController();
    const pending = loadFloodFillSourceImage("https://example.test/line.png", controller.signal);
    const image = FakeImage.instances[0]!;

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(image.src).toBe("");
  });

  it("never starts decoding when the signal is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadFloodFillSourceImage("https://example.test/line.png", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeImage.instances[0]?.src).toBe("");
  });

  it("removes the abort listener after a successful load", async () => {
    const controller = new AbortController();
    const pending = loadFloodFillSourceImage("data:image/png;base64,x", controller.signal);
    const image = FakeImage.instances[0]!;

    image.onload?.();
    await expect(pending).resolves.toBe(image);
    controller.abort();

    expect(image.src).toBe("data:image/png;base64,x");
  });
});
