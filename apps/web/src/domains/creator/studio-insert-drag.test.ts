import { describe, expect, it, vi } from "vitest";

import {
  consumeStudioInsertDropTransfer,
  parseStudioInsertDragPayload,
  resolveStudioInsertTarget,
  STUDIO_INSERT_DRAG_MAX_PAYLOAD_LENGTH,
  STUDIO_INSERT_DRAG_MIME,
  writeStudioAssetDragPayload,
  writeStudioInsertDragPayload,
} from "./studio-insert-drag";

describe("Studio insertion drag contract", () => {
  it("writes native insertions through one MIME contract", () => {
    const setData = vi.fn();
    const transfer = {
      effectAllowed: "none" as DataTransfer["effectAllowed"],
      setData,
    };

    writeStudioInsertDragPayload(transfer, { kind: "bubble", variant: "thought" });

    const serialized = JSON.stringify({ kind: "bubble", variant: "thought" });
    expect(setData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledWith(STUDIO_INSERT_DRAG_MIME, serialized);
    expect(transfer.effectAllowed).toBe("copy");
  });

  it("strictly validates all native insert payloads", () => {
    expect(parseStudioInsertDragPayload('{"kind":"text"}')).toEqual({ kind: "text" });
    expect(parseStudioInsertDragPayload('{"kind":"bubble","variant":"shout"}')).toEqual({
      kind: "bubble",
      variant: "shout",
    });
    expect(parseStudioInsertDragPayload('{"kind":"sticker","emoji":"✨"}')).toEqual({
      kind: "sticker",
      emoji: "✨",
    });
    expect(parseStudioInsertDragPayload('{"kind":"bubble","variant":"unknown"}')).toBeNull();
    expect(parseStudioInsertDragPayload('{"kind":"sticker","emoji":""}')).toBeNull();
    expect(parseStudioInsertDragPayload("not-json")).toBeNull();
  });

  it("fails closed for smuggled fields, control-only stickers, arrays, and oversized JSON", () => {
    expect(parseStudioInsertDragPayload('{"kind":"text","assetId":"unexpected"}')).toBeNull();
    expect(parseStudioInsertDragPayload(
      '{"kind":"bubble","variant":"shout","emoji":"unexpected"}'
    )).toBeNull();
    expect(parseStudioInsertDragPayload('{"kind":"sticker","emoji":"\\u0000"}')).toBeNull();
    expect(parseStudioInsertDragPayload('{"kind":"sticker","emoji":"   "}')).toBeNull();
    expect(parseStudioInsertDragPayload('["text"]')).toBeNull();
    expect(parseStudioInsertDragPayload(
      " ".repeat(STUDIO_INSERT_DRAG_MAX_PAYLOAD_LENGTH + 1)
    )).toBeNull();
  });

  it("writes image-backed elements and assets through the shared asset channel", () => {
    const setData = vi.fn();
    const transfer = {
      effectAllowed: "none" as DataTransfer["effectAllowed"],
      setData,
    };

    writeStudioAssetDragPayload(transfer, '{"source":"local"}');

    expect(setData).toHaveBeenCalledWith("application/json-asset", '{"source":"local"}');
    expect(transfer.effectAllowed).toBe("copy");
  });
});

describe("Studio insertion target contract", () => {
  it("prefers and clamps a valid document-space pointer", () => {
    expect(resolveStudioInsertTarget({
      documentWidth: 720,
      documentHeight: 2_000,
      pointer: { x: -40, y: 2_500 },
      selectedFrame: { x: 100, y: 200, width: 300, height: 400 },
      viewport: {
        center: { x: 360, y: 900 },
        bounds: { x: 0, y: 600, width: 720, height: 600 },
      },
    })).toEqual({
      source: "pointer",
      anchor: { x: 0, y: 2_000 },
      bounds: { x: 0, y: 0, width: 720, height: 2_000 },
    });
  });

  it("uses the clipped selected frame before the visible viewport", () => {
    expect(resolveStudioInsertTarget({
      documentWidth: 720,
      documentHeight: 2_000,
      pointer: { x: Number.NaN, y: 100 },
      selectedFrame: { x: -100, y: 200, width: 300, height: 400 },
      viewport: { center: { x: 360, y: 1_100 } },
    })).toEqual({
      source: "selected-frame",
      anchor: { x: 100, y: 400 },
      bounds: { x: 0, y: 200, width: 200, height: 400 },
    });
  });

  it("uses a finite visible viewport for pointer-less mobile tap insertion", () => {
    expect(resolveStudioInsertTarget({
      documentWidth: 720,
      documentHeight: 4_000,
      selectedFrame: { x: 900, y: 5_000, width: 100, height: 100 },
      viewport: {
        center: { x: 380, y: 1_900 },
        bounds: { x: -20, y: 1_500, width: 760, height: 800 },
      },
    })).toEqual({
      source: "viewport",
      anchor: { x: 380, y: 1_900 },
      bounds: { x: 0, y: 1_500, width: 720, height: 800 },
    });
  });

  it("falls back to the document center for entirely malformed targets", () => {
    expect(resolveStudioInsertTarget({
      documentWidth: 720,
      documentHeight: 2_000,
      selectedFrame: { x: Number.NaN, y: 0, width: 10, height: 10 },
      viewport: {
        center: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        bounds: { x: 0, y: 0, width: -1, height: 2 },
      },
    })).toEqual({
      source: "document",
      anchor: { x: 360, y: 1_000 },
      bounds: { x: 0, y: 0, width: 720, height: 2_000 },
    });
  });
});

describe("Studio insertion drop command gate", () => {
  it("allows one undoable command per DataTransfer while accepting a new drag", () => {
    const consumed = new WeakSet<object>();
    const firstTransfer = {};
    const nextTransfer = {};
    const commit = vi.fn();
    const applyDrop = (dataTransfer: object) => {
      if (consumeStudioInsertDropTransfer(consumed, dataTransfer)) commit();
    };

    applyDrop(firstTransfer);
    applyDrop(firstTransfer);
    applyDrop(nextTransfer);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(consumeStudioInsertDropTransfer(consumed, null)).toBe(false);
  });
});
