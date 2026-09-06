import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
  STUDIO_REFERENCE_BOARD_MAX_ITEMS,
  STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION,
  STUDIO_REFERENCE_BOARD_MAX_ZOOM,
  addStudioReferenceBoardItem,
  areStudioReferenceBoardDocumentsEqual,
  canonicalizeStudioReferenceBoardSha256,
  createDefaultStudioReferenceBoardDocument,
  createStudioReferenceBoardDocument,
  createStudioReferenceBoardItem,
  normalizeStudioReferenceBoardDocument,
  normalizeStudioReferenceBoardRotation,
  parseStudioReferenceBoardDocument,
  removeStudioReferenceBoardItem,
  reorderStudioReferenceBoardItem,
  studioReferenceBoardHasContent,
  updateStudioReferenceBoardItem,
  type StudioReferenceBoardItem,
} from "./studio-reference-board";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

function referenceItem(
  id: string,
  sha256 = HASH_A,
  overrides: Partial<StudioReferenceBoardItem> = {}
): StudioReferenceBoardItem {
  return {
    id,
    asset: { sha256 },
    view: { ...DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW },
    ...overrides,
  };
}

describe("studio reference-board document", () => {
  it("creates an empty v1 project document without local panel or selection state", () => {
    const document = createDefaultStudioReferenceBoardDocument();
    expect(document).toEqual({ version: 1, items: [] });
    expect(document).not.toHaveProperty("selectedItemId");
    expect(document).not.toHaveProperty("open");
    expect(document).not.toHaveProperty("rect");
    expect(document).not.toHaveProperty("search");
    expect(studioReferenceBoardHasContent(undefined)).toBe(false);
    expect(studioReferenceBoardHasContent(document)).toBe(false);
  });

  it("canonicalizes asset identity and creates a bounded default/overridden item", () => {
    expect(canonicalizeStudioReferenceBoardSha256("A".repeat(64))).toBe(HASH_A);
    expect(canonicalizeStudioReferenceBoardSha256(`SHA256:${"B".repeat(64)}`)).toBe(HASH_B);
    expect(canonicalizeStudioReferenceBoardSha256("data:image/png;base64,aaaa")).toBeNull();
    expect(normalizeStudioReferenceBoardRotation(181)).toBe(-179);
    expect(normalizeStudioReferenceBoardRotation(-540)).toBe(-180);

    expect(createStudioReferenceBoardItem({
      id: "reference-1",
      asset: {
        sha256: "A".repeat(64),
        assetId: " local-asset ",
        name: " Pose study ",
        mimeType: "IMAGE/PNG",
        width: 1_200.4,
        height: STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION * 2,
        dataUrl: "data:image/png;base64,not-persisted",
      },
      view: {
        centerX: -3,
        centerY: 4,
        zoom: 100,
        rotationDeg: 181,
        flipX: true,
        flipY: true,
        opacity: -1,
        grayscale: true,
      },
    })).toEqual({
      id: "reference-1",
      asset: {
        sha256: HASH_A,
        assetId: "local-asset",
        name: "Pose study",
        mimeType: "image/png",
        width: 1_200,
        height: STUDIO_REFERENCE_BOARD_MAX_MEDIA_DIMENSION,
      },
      view: {
        centerX: 0,
        centerY: 1,
        zoom: STUDIO_REFERENCE_BOARD_MAX_ZOOM,
        rotationDeg: -179,
        flipX: true,
        flipY: true,
        opacity: 0,
        grayscale: true,
      },
    });
  });

  it("tolerantly hydrates legacy shapes, drops invalid/duplicate items, and preserves z-order", () => {
    const normalized = normalizeStudioReferenceBoardDocument({
      references: [
        {
          id: "back",
          hash: "A".repeat(64),
          x: -1,
          y: 2,
          zoom: 0,
          rotation: 725,
          flipped: true,
          opacity: 2,
          grayscale: true,
        },
        { id: "back", sha256: HASH_B },
        { id: "broken", sha256: "not-a-hash" },
        { id: "front", sha256: HASH_B },
      ],
    });

    expect(normalized).toEqual({
      version: 1,
      items: [
        {
          id: "back",
          asset: { sha256: HASH_A },
          view: {
            centerX: 0,
            centerY: 1,
            zoom: 0.05,
            rotationDeg: 5,
            flipX: true,
            flipY: false,
            opacity: 1,
            grayscale: true,
          },
        },
        referenceItem("front", HASH_B),
      ],
    });
    expect(studioReferenceBoardHasContent(normalized)).toBe(true);
    expect(normalizeStudioReferenceBoardDocument({
      version: 2,
      items: [referenceItem("future")],
    })).toEqual(createDefaultStudioReferenceBoardDocument());

    const tooMany = normalizeStudioReferenceBoardDocument({
      items: Array.from(
        { length: STUDIO_REFERENCE_BOARD_MAX_ITEMS + 10 },
        (_, index) => referenceItem(`reference-${index}`)
      ),
    });
    expect(tooMany.items).toHaveLength(STUDIO_REFERENCE_BOARD_MAX_ITEMS);
    expect(tooMany.items[0]?.id).toBe("reference-0");
    expect(tooMany.items.at(-1)?.id).toBe("reference-31");
  });

  it("strictly accepts canonical data, permits repeated assets, and preserves array z-order", () => {
    const back = referenceItem("back", HASH_A, {
      asset: {
        sha256: HASH_A,
        assetId: "asset-back",
        name: "인체 포즈",
        mimeType: "image/webp",
        width: 1_024,
        height: 768,
      },
    });
    const front = referenceItem("front", HASH_A, {
      view: {
        ...DEFAULT_STUDIO_REFERENCE_BOARD_ITEM_VIEW,
        centerX: 0.75,
        rotationDeg: -180,
        opacity: 0.4,
        grayscale: true,
      },
    });
    const document = { version: 1 as const, items: [back, front] };
    expect(parseStudioReferenceBoardDocument(document)).toEqual(document);
    expect(parseStudioReferenceBoardDocument(document)?.items.map(({ id }) => id)).toEqual([
      "back",
      "front",
    ]);
  });

  it("rejects unknown keys at every level, including local UI state and binary source fields", () => {
    const item = referenceItem("reference-1");
    const document = { version: 1 as const, items: [item] };
    expect(parseStudioReferenceBoardDocument({ ...document, selectedItemId: item.id })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      ...document,
      items: [{ ...item, selected: true }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      ...document,
      items: [{ ...item, asset: { ...item.asset, dataUrl: "data:image/png;base64,aaaa" } }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      ...document,
      items: [{ ...item, view: { ...item.view, localScale: 1 } }],
    })).toBeNull();

    const itemsWithProperty = [item] as StudioReferenceBoardItem[] & { preview?: string };
    itemsWithProperty.preview = "data:image/png;base64,aaaa";
    expect(parseStudioReferenceBoardDocument({ version: 1, items: itemsWithProperty })).toBeNull();
  });

  it("rejects accessors without invoking them", () => {
    const item = referenceItem("reference-1");
    let getterCalls = 0;
    const hostileRoot = {
      version: 1,
      get items() {
        getterCalls += 1;
        return [item];
      },
    };
    expect(parseStudioReferenceBoardDocument(hostileRoot)).toBeNull();

    const hostileAsset = {
      get sha256() {
        getterCalls += 1;
        return HASH_A;
      },
    };
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: hostileAsset }],
    })).toBeNull();

    const hostileItems = [item];
    Object.defineProperty(hostileItems, "0", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return item;
      },
    });
    expect(parseStudioReferenceBoardDocument({ version: 1, items: hostileItems })).toBeNull();
    expect(getterCalls).toBe(0);
  });

  it("rejects duplicate IDs, excess references, and non-canonical or unsafe values", () => {
    const item = referenceItem("reference-1");
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [item, item],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: Array.from(
        { length: STUDIO_REFERENCE_BOARD_MAX_ITEMS + 1 },
        (_, index) => referenceItem(`reference-${index}`)
      ),
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: { sha256: "A".repeat(64) } }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: { sha256: HASH_A, name: "data:image/png;base64,aaaa" } }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: { sha256: HASH_A, assetId: "blob:private" } }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: { sha256: HASH_A, mimeType: "text/html" } }],
    })).toBeNull();
    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: { sha256: HASH_A, width: 100 } }],
    })).toBeNull();

    for (const unsafeView of [
      { ...item.view, centerX: -0.01 },
      { ...item.view, centerY: Number.NaN },
      { ...item.view, zoom: STUDIO_REFERENCE_BOARD_MAX_ZOOM + 1 },
      { ...item.view, rotationDeg: 180 },
      { ...item.view, rotationDeg: -0 },
      { ...item.view, opacity: 1.01 },
      { ...item.view, grayscale: "yes" },
    ]) {
      expect(parseStudioReferenceBoardDocument({
        version: 1,
        items: [{ ...item, view: unsafeView }],
      })).toBeNull();
    }

    expect(parseStudioReferenceBoardDocument({
      version: 1,
      items: [{ ...item, asset: new Blob(["raw image bytes"], { type: "image/png" }) }],
    })).toBeNull();
  });

  it("rejects an otherwise field-valid document that exceeds its UTF-8 byte budget", () => {
    const items = Array.from({ length: STUDIO_REFERENCE_BOARD_MAX_ITEMS }, (_, index) => {
      const idPrefix = `reference-${index}-`;
      const assetIdPrefix = `asset-${index}-`;
      return referenceItem(`${idPrefix}${"i".repeat(160 - idPrefix.length)}`, HASH_A, {
        asset: {
          sha256: HASH_A,
          assetId: `${assetIdPrefix}${"a".repeat(160 - assetIdPrefix.length)}`,
          name: "가".repeat(512),
          mimeType: "image/vnd.toonspectrum-reference-board+png",
          width: 10_000,
          height: 10_000,
        },
      });
    });
    expect(parseStudioReferenceBoardDocument({ version: 1, items })).toBeNull();
  });

  it("adds, removes, reorders, and updates immutably while preserving stable item IDs", () => {
    const empty = createDefaultStudioReferenceBoardDocument();
    const back = referenceItem("back", HASH_A);
    const middle = referenceItem("middle", HASH_B);
    const front = referenceItem("front", HASH_A);

    const one = addStudioReferenceBoardItem(empty, back);
    const two = addStudioReferenceBoardItem(one, front);
    const three = addStudioReferenceBoardItem(two, middle, 1);
    expect(empty.items).toEqual([]);
    expect(three.items.map(({ id }) => id)).toEqual(["back", "middle", "front"]);
    expect(addStudioReferenceBoardItem(three, referenceItem("middle"))).toBe(three);

    const reordered = reorderStudioReferenceBoardItem(three, "back", 2);
    expect(reordered.items.map(({ id }) => id)).toEqual(["middle", "front", "back"]);
    expect(reorderStudioReferenceBoardItem(reordered, "missing", 0)).toBe(reordered);
    expect(reorderStudioReferenceBoardItem(reordered, "back", 2)).toBe(reordered);

    const updated = updateStudioReferenceBoardItem(reordered, "front", {
      view: {
        centerX: 2,
        zoom: 0,
        rotationDeg: 540,
        flipX: true,
        opacity: 0.25,
        grayscale: true,
      },
      asset: { name: "Mirrored study" },
    });
    expect(updated.items[1]).toEqual({
      ...front,
      asset: { ...front.asset, name: "Mirrored study" },
      view: {
        ...front.view,
        centerX: 1,
        zoom: 0.05,
        rotationDeg: -180,
        flipX: true,
        opacity: 0.25,
        grayscale: true,
      },
    });
    expect(updateStudioReferenceBoardItem(updated, "missing", {})).toBe(updated);
    expect(updateStudioReferenceBoardItem(updated, "front", {
      asset: { sha256: "data:image/png;base64,aaaa" as `sha256:${string}` },
    })).toBe(updated);

    const removed = removeStudioReferenceBoardItem(updated, "middle");
    expect(removed.items.map(({ id }) => id)).toEqual(["front", "back"]);
    expect(removeStudioReferenceBoardItem(removed, "missing")).toBe(removed);
    expect(three.items.map(({ id }) => id)).toEqual(["back", "middle", "front"]);
  });

  it("enforces the add cap and compares every persisted field including z-order", () => {
    const full = createStudioReferenceBoardDocument(
      Array.from(
        { length: STUDIO_REFERENCE_BOARD_MAX_ITEMS },
        (_, index) => referenceItem(`reference-${index}`)
      )
    );
    expect(addStudioReferenceBoardItem(full, referenceItem("overflow"))).toBe(full);

    const same = structuredClone(full);
    expect(areStudioReferenceBoardDocumentsEqual(full, same)).toBe(true);
    const changedView = structuredClone(full);
    changedView.items[0]!.view.opacity = 0.5;
    expect(areStudioReferenceBoardDocumentsEqual(full, changedView)).toBe(false);
    const changedMetadata = structuredClone(full);
    changedMetadata.items[0]!.asset.name = "다른 이름";
    expect(areStudioReferenceBoardDocumentsEqual(full, changedMetadata)).toBe(false);
    const changedOrder = reorderStudioReferenceBoardItem(full, "reference-0", 1);
    expect(areStudioReferenceBoardDocumentsEqual(full, changedOrder)).toBe(false);
  });
});
