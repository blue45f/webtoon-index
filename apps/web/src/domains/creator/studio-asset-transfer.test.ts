import { describe, expect, it } from "vitest";

import {
  studioTransferCanInsert,
  studioTransferHasFiles,
  type StudioAssetTransferLike,
} from "./studio-asset-transfer";

function transfer(
  types: string[],
  itemTypes: Array<{ kind: string; type: string }> = [],
  fileTypes: string[] = []
): StudioAssetTransferLike {
  return {
    types,
    items: itemTypes,
    files: fileTypes.map((type) => ({ type })),
  } as unknown as StudioAssetTransferLike;
}

describe("studio asset transfer acceptance", () => {
  it("accepts Studio asset and insertion payloads", () => {
    expect(studioTransferCanInsert(transfer(["application/json-asset"]))).toBe(true);
    expect(studioTransferCanInsert(transfer(["application/json-insert"]))).toBe(true);
    expect(
      studioTransferCanInsert(transfer(["application/x-studio-object-insert+json"])),
    ).toBe(true);
  });

  it("accepts image files and rejects known non-image files", () => {
    expect(studioTransferCanInsert(transfer(
      ["Files"],
      [{ kind: "file", type: "image/webp" }]
    ))).toBe(true);
    expect(studioTransferCanInsert(transfer(
      ["Files"],
      [{ kind: "file", type: "application/pdf" }],
      ["application/pdf"]
    ))).toBe(false);
  });

  it("keeps metadata-hidden browser drags eligible until drop inspection", () => {
    const unknownFileDrag = transfer(["Files"]);
    expect(studioTransferHasFiles(unknownFileDrag)).toBe(true);
    expect(studioTransferCanInsert(unknownFileDrag)).toBe(true);
  });

  it("rejects unrelated text transfers", () => {
    const textTransfer = transfer(["text/plain"]);
    expect(studioTransferHasFiles(textTransfer)).toBe(false);
    expect(studioTransferCanInsert(textTransfer)).toBe(false);
  });

  it("fails closed instead of throwing for malformed synthetic transfer lists", () => {
    const throwingList = {
      [Symbol.iterator]() {
        throw new Error("foreign drag");
      },
    };
    const malformed = {
      types: throwingList,
      items: null,
      files: undefined,
    } as unknown as StudioAssetTransferLike;

    expect(() => studioTransferHasFiles(malformed)).not.toThrow();
    expect(() => studioTransferCanInsert(malformed)).not.toThrow();
    expect(studioTransferHasFiles(malformed)).toBe(false);
    expect(studioTransferCanInsert(malformed)).toBe(false);
  });
});
