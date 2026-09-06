// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { findStoredBrushSnapshotForMarketplace } from "./marketplace-brush-publish-snapshot";
import { MarketplaceBrushPublishShortcut } from "./MarketplaceBrushPublishShortcut";

function createStorage(entries: Readonly<Record<string, string>>): Storage {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    clear() {},
    getItem(key: string) {
      return entries[key] ?? null;
    },
    key(index: number) {
      return keys[index] ?? null;
    },
    removeItem() {},
    setItem() {},
  };
}

afterEach(() => {
  cleanup();
});

describe("MarketplaceBrushPublishShortcut", () => {
  it("selects the richest brush snapshot without depending on storage order", () => {
    const storage = createStorage({
      "studio-brush-light": JSON.stringify({ name: "Simple", brushTip: { size: 12 } }),
      unrelated: JSON.stringify({ enginePrograms: [{ id: "ignored" }] }),
      "studio-brush-rich": JSON.stringify({
        name: "Layered watercolor",
        enginePrograms: [{ id: "wet" }, { id: "grain" }],
        dualBrush: { enabled: true },
        grain: { scale: 0.8 },
        pressureCurve: [0, 0.4, 1],
      }),
    });

    expect(findStoredBrushSnapshotForMarketplace(storage)).toEqual({
      name: "Layered watercolor",
      enginePrograms: [{ id: "wet" }, { id: "grain" }],
      dualBrush: { enabled: true },
      grain: { scale: 0.8 },
      pressureCurve: [0, 0.4, 1],
    });
  });

  it("ignores malformed, unrelated, and blocked storage entries", () => {
    const storage = createStorage({
      "studio-brush-broken": "{broken",
      analytics: JSON.stringify({ enginePrograms: [{ id: "not-a-brush-cache" }] }),
    });
    expect(findStoredBrushSnapshotForMarketplace(storage)).toBeNull();

    const blockedStorage = {
      get length(): number {
        throw new DOMException("Blocked", "SecurityError");
      },
      key(): string | null {
        throw new DOMException("Blocked", "SecurityError");
      },
      getItem(): string | null {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(findStoredBrushSnapshotForMarketplace(blockedStorage)).toBeNull();
  });

  it("skips one inaccessible cache entry and keeps scanning", () => {
    const entries = createStorage({
      "studio-brush-blocked": JSON.stringify({ enginePrograms: [{ id: "blocked" }] }),
      "studio-brush-safe": JSON.stringify({
        enginePrograms: [{ id: "safe" }],
        dualBrush: { enabled: true },
      }),
    });
    const storage = {
      ...entries,
      getItem(key: string) {
        if (key === "studio-brush-blocked") {
          throw new DOMException("Blocked", "SecurityError");
        }
        return entries.getItem(key);
      },
    } as Storage;

    expect(findStoredBrushSnapshotForMarketplace(storage)).toEqual({
      enginePrograms: [{ id: "safe" }],
      dualBrush: { enabled: true },
    });
  });

  it("exposes a stable accessible publishing action and recovers after a provider error", async () => {
    render(
      <MarketplaceBrushPublishShortcut
        snapshotProvider={() => {
          throw new Error("현재 브러시를 읽지 못했습니다.");
        }}
      />,
    );

    const button = screen.getByTestId("brush-studio-marketplace-publish") as HTMLButtonElement;
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("현재 브러시 원본을 보존해 등록합니다.");

    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("현재 브러시를 읽지 못했습니다.");
      expect(button.getAttribute("aria-busy")).toBe("false");
      expect(button.disabled).toBe(false);
    });
  });
});
