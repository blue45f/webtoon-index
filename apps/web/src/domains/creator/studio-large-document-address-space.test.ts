import { describe, expect, it } from "vitest";

import {
  createStudioLargeDocumentAddressSpace,
  planStudioLargeDocumentWorkingSetWindow,
  resolveStudioLargeDocumentShardSpan,
  resolveStudioLargeDocumentPixelAddress,
  resolveStudioLargeDocumentTileAddress,
  STUDIO_LARGE_DOCUMENT_FOUR_GIB_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_TILE_PAYLOAD_BYTES,
} from "./studio-large-document-address-space";

describe("studio large-document BigInt address space", () => {
  it("crosses the 4 GiB layer boundary without 32-bit wrapping", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(32_768),
      heightPixels: BigInt(32_768),
      layerCount: BigInt(2),
    });

    expect(space).not.toBeNull();
    expect(space?.layerStrideBytes).toBe(STUDIO_LARGE_DOCUMENT_FOUR_GIB_BYTES);
    expect(space?.logicalByteLength).toBe(BigInt(8) * BigInt(1024) * BigInt(1024) * BigInt(1024));

    const firstTileOnSecondLayer = space && resolveStudioLargeDocumentTileAddress(space, {
      column: BigInt(0),
      row: BigInt(0),
      layerIndex: BigInt(1),
    });
    expect(firstTileOnSecondLayer).toMatchObject({
      slotIndex: BigInt(4_096),
      byteOffset: STUDIO_LARGE_DOCUMENT_FOUR_GIB_BYTES,
      byteEndExclusive: STUDIO_LARGE_DOCUMENT_FOUR_GIB_BYTES + BigInt(1_048_576),
    });
  });

  it("addresses a 512 GiB logical document and its bottom-right edge exactly", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(262_144),
      heightPixels: BigInt(524_288),
    });

    expect(space?.logicalByteLength).toBe(BigInt(512) * BigInt(1024) * BigInt(1024) * BigInt(1024));
    const lastTile = space && resolveStudioLargeDocumentTileAddress(space, {
      column: BigInt(511),
      row: BigInt(1_023),
    });
    expect(lastTile?.slotIndex).toBe(BigInt(524_287));
    expect(lastTile?.byteEndExclusive).toBe(space?.logicalByteLength);

    const lastChannel = space && resolveStudioLargeDocumentPixelAddress(space, {
      x: BigInt(262_143),
      y: BigInt(524_287),
      channelOffset: BigInt(3),
    });
    expect(lastChannel?.byteOffset).toBe((space?.logicalByteLength ?? BigInt(0)) - BigInt(1));
  });

  it("remains exact above Number.MAX_SAFE_INTEGER", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(2_147_483_648),
      heightPixels: BigInt(2_097_152),
    });

    expect(space?.logicalByteLength).toBe(BigInt(1) << BigInt(54));
    expect(space?.logicalByteLength).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const lastTile = space && resolveStudioLargeDocumentTileAddress(space, {
      column: BigInt(4_194_303),
      row: BigInt(4_095),
    });
    expect(lastTile?.byteEndExclusive).toBe(BigInt(1) << BigInt(54));
  });

  it("maps offsets above Number.MAX_SAFE_INTEGER into Number-safe OPFS shards", () => {
    const globalByteOffset = (BigInt(1) << BigInt(54)) + BigInt(1_000_000_000);
    const first = resolveStudioLargeDocumentShardSpan({
      globalByteOffset,
      remainingByteLength: BigInt(200_000_000),
    });

    expect(first).toMatchObject({
      shardIndex: globalByteOffset / BigInt(1_073_741_824),
      shardByteOffset: 1_000_000_000,
      byteLength: 64 * 1024 * 1024,
    });
    expect(Number.isSafeInteger(first?.shardByteOffset)).toBe(true);
    expect(first?.globalByteEndExclusive).toBe(
      globalByteOffset + BigInt(64 * 1024 * 1024),
    );

    const boundary = resolveStudioLargeDocumentShardSpan({
      globalByteOffset: BigInt(1_073_741_824) - BigInt(16),
      remainingByteLength: BigInt(64),
    });
    expect(boundary).toMatchObject({
      shardIndex: BigInt(0),
      shardByteOffset: 1_073_741_808,
      byteLength: 16,
    });
  });

  it("plans a tile-aligned bounded working-set window at a hundreds-GB offset", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(262_144),
      heightPixels: BigInt(524_288),
    });
    const window = space && planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(400), row: BigInt(900) },
      tilesBefore: BigInt(96),
      tilesAfter: BigInt(160),
      maxResidentBytes: BigInt(64) * BigInt(1024) * BigInt(1024),
    });

    expect(window).not.toBeNull();
    expect(window?.tileCount).toBe(BigInt(64));
    expect(window?.byteLength).toBe(BigInt(64) * BigInt(1024) * BigInt(1024));
    expect(window?.byteOffset).toBeGreaterThan(BigInt(400) * BigInt(1024) * BigInt(1024) * BigInt(1024));
    expect(window && window.firstSlotIndex <= window.focusSlotIndex).toBe(true);
    expect(window && window.focusSlotIndex < window.lastSlotIndexExclusive).toBe(true);
    expect(window?.byteEndExclusive).toBeLessThanOrEqual(space?.logicalByteLength ?? BigInt(0));
  });

  it("clamps a working-set window at both document ends while retaining the focus", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1_024),
      heightPixels: BigInt(1_024),
    });
    expect(space?.logicalTileCount).toBe(BigInt(4));

    const start = space && planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(0), row: BigInt(0) },
      tilesBefore: BigInt(10),
      tilesAfter: BigInt(10),
      maxResidentBytes: BigInt(3) * BigInt(1_048_576),
    });
    expect(start).toMatchObject({
      firstSlotIndex: BigInt(0),
      lastSlotIndexExclusive: BigInt(3),
      tileCount: BigInt(3),
    });

    const end = space && planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(1), row: BigInt(1) },
      tilesBefore: BigInt(10),
      tilesAfter: BigInt(10),
      maxResidentBytes: BigInt(3) * BigInt(1_048_576),
    });
    expect(end).toMatchObject({
      firstSlotIndex: BigInt(1),
      lastSlotIndexExclusive: BigInt(4),
      tileCount: BigInt(3),
    });
  });

  it.each([
    { widthPixels: -BigInt(1), heightPixels: BigInt(1) },
    { widthPixels: BigInt(1), heightPixels: -BigInt(1) },
    { widthPixels: BigInt(0), heightPixels: BigInt(1) },
    { widthPixels: 1.5, heightPixels: BigInt(1) },
    { widthPixels: Number.MAX_SAFE_INTEGER + 1, heightPixels: BigInt(1) },
    { widthPixels: BigInt(1), heightPixels: BigInt(1), layerCount: BigInt(0) },
    { widthPixels: BigInt(1), heightPixels: BigInt(1), tileSizePixels: BigInt(0) },
    { widthPixels: BigInt(1), heightPixels: BigInt(1), bytesPerPixel: Number.NaN },
  ])("rejects invalid dimensions and non-integral inputs: %o", (input) => {
    expect(createStudioLargeDocumentAddressSpace(input)).toBeNull();
  });

  it("fails closed when tile, layer, or total-byte multiplication exceeds the signed-64 boundary", () => {
    expect(createStudioLargeDocumentAddressSpace({
      widthPixels: STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
      heightPixels: BigInt(2),
      tileSizePixels: BigInt(1),
      bytesPerPixel: BigInt(1),
    })).toBeNull();
    expect(createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1),
      heightPixels: BigInt(1),
      tileSizePixels: BigInt(1) << BigInt(32),
      bytesPerPixel: BigInt(1),
    })).toBeNull();
    expect(createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1),
      heightPixels: BigInt(1),
      layerCount: STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
      bytesPerPixel: BigInt(2),
      tileSizePixels: BigInt(1),
    })).toBeNull();
  });

  it("keeps every materialized tile inside the bounded WASM view contract", () => {
    expect(createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1),
      heightPixels: BigInt(1),
      tileSizePixels: BigInt(8_192),
      bytesPerPixel: BigInt(4),
    })?.tilePayloadBytes).toBe(STUDIO_LARGE_DOCUMENT_MAX_TILE_PAYLOAD_BYTES);
    expect(createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1),
      heightPixels: BigInt(1),
      tileSizePixels: BigInt(8_193),
      bytesPerPixel: BigInt(4),
    })).toBeNull();
  });

  it("rejects negative, fractional, out-of-range, and oversized working-set requests", () => {
    const space = createStudioLargeDocumentAddressSpace({
      widthPixels: BigInt(1_024),
      heightPixels: BigInt(1_024),
    });
    expect(space).not.toBeNull();
    if (!space) return;

    expect(resolveStudioLargeDocumentTileAddress(space, { column: -BigInt(1), row: BigInt(0) })).toBeNull();
    expect(resolveStudioLargeDocumentTileAddress(space, { column: 0.5, row: BigInt(0) })).toBeNull();
    expect(resolveStudioLargeDocumentTileAddress(space, { column: BigInt(2), row: BigInt(0) })).toBeNull();
    expect(resolveStudioLargeDocumentTileAddress(space, {
      column: BigInt(0),
      row: BigInt(0),
      layerIndex: BigInt(1),
    })).toBeNull();
    expect(resolveStudioLargeDocumentPixelAddress(space, {
      x: BigInt(1_024),
      y: BigInt(0),
    })).toBeNull();
    expect(resolveStudioLargeDocumentPixelAddress(space, {
      x: BigInt(0),
      y: BigInt(0),
      channelOffset: BigInt(4),
    })).toBeNull();
    expect(planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(0), row: BigInt(0) },
      maxResidentBytes: BigInt(1_048_575),
    })).toBeNull();
    expect(planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(0), row: BigInt(0) },
      tilesBefore: -BigInt(1),
      maxResidentBytes: BigInt(1_048_576),
    })).toBeNull();
    expect(planStudioLargeDocumentWorkingSetWindow(space, {
      focus: { column: BigInt(0), row: BigInt(0) },
      tilesAfter: STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
      maxResidentBytes: BigInt(1_048_576),
    })).toBeNull();
  });
});
