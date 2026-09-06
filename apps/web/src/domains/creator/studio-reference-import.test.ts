// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  assertStudioReferenceGifSignature,
  assertStudioReferenceImportBatch,
  isStudioReferenceEditablePasteTarget,
  isStudioReferenceImportFile,
  planStudioReferenceImports,
} from "./studio-reference-import";
import {
  STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES,
  STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES,
} from "./studio-upload-image-safety";

function file(name: string, type: string, size = 128, bytes = "GIF89a"): File {
  const source = new File([bytes], name, { type });
  Object.defineProperty(source, "size", { configurable: true, value: size });
  return source;
}

describe("studio reference imports", () => {
  it("accepts the four local raster formats and preserves order within available slots", () => {
    const sources = [
      file("one.png", "image/png"),
      file("two.jpg", "image/jpeg"),
      file("three.webp", "image/webp"),
      file("four.gif", "image/gif"),
      file("notes.txt", "text/plain"),
    ];
    const plan = planStudioReferenceImports(sources, 3);
    expect(plan.files.map(({ name }) => name)).toEqual(["one.png", "two.jpg", "three.webp"]);
    expect(plan.overflow.map(({ name }) => name)).toEqual(["four.gif"]);
    expect(plan.unsupported.map(({ name }) => name)).toEqual(["notes.txt"]);
    expect(isStudioReferenceImportFile(file("extension-only.gif", ""))).toBe(true);
  });

  it("enforces per-file and aggregate source byte budgets", () => {
    expect(() => assertStudioReferenceImportBatch([
      file("large.png", "image/png", STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES + 1),
    ])).toThrow(/12MB/);
    const batchFileSize = Math.floor(STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES / 5) + 1;
    expect(() => assertStudioReferenceImportBatch(Array.from(
      { length: 5 },
      (_, index) => file(`${index}.webp`, "image/webp", batchFileSize)
    ))).toThrow(/48MB/);
  });

  it("verifies GIF magic bytes before the browser decoding path", async () => {
    await expect(assertStudioReferenceGifSignature(file("pose.gif", "image/gif")))
      .resolves.toBeUndefined();
    await expect(assertStudioReferenceGifSignature(file("fake.gif", "image/gif", 8, "not-gif!")))
      .rejects.toThrow(/GIF 헤더/);
  });

  it("does not intercept paste while the user is editing text", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editor.append(child);
    expect(isStudioReferenceEditablePasteTarget(input)).toBe(true);
    expect(isStudioReferenceEditablePasteTarget(child)).toBe(true);
    expect(isStudioReferenceEditablePasteTarget(document.body)).toBe(false);
  });
});
