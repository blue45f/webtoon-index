// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_INSPECTOR_SECTION_STATE,
  isStudioInspectorSectionOpen,
  loadStudioInspectorSectionState,
  normalizeStudioInspectorSectionState,
  readStudioInspectorSectionOpen,
  resetStudioInspectorSectionStateCache,
  saveStudioInspectorSectionState,
  setStudioInspectorSectionOpen,
  STUDIO_INSPECTOR_SECTION_STATE_LIMIT,
  STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY,
  writeStudioInspectorSectionOpen,
  type StudioInspectorSectionStateStorage,
} from "./studio-inspector-section-state";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const storage: StudioInspectorSectionStateStorage & {
    values: Map<string, string>;
  } = {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return storage;
}

describe("normalizeStudioInspectorSectionState", () => {
  it("keeps only boolean entries with a non-blank id", () => {
    expect(
      normalizeStudioInspectorSectionState({
        "element.layout": true,
        "element.bubble": false,
        "element.broken": "true",
        "  ": true,
      }),
    ).toEqual({ "element.bubble": false, "element.layout": true });
  });

  it("rejects non-records outright", () => {
    for (const value of [null, undefined, 42, "x", [true], () => true]) {
      expect(normalizeStudioInspectorSectionState(value)).toBe(
        EMPTY_STUDIO_INSPECTOR_SECTION_STATE,
      );
    }
  });

  it("caps the table so a stale id set cannot grow without bound", () => {
    const oversized = Object.fromEntries(
      Array.from({ length: STUDIO_INSPECTOR_SECTION_STATE_LIMIT + 20 }, (_, index) => [
        `section.${String(index).padStart(3, "0")}`,
        true,
      ]),
    );
    const normalized = normalizeStudioInspectorSectionState(oversized);
    expect(Object.keys(normalized)).toHaveLength(
      STUDIO_INSPECTOR_SECTION_STATE_LIMIT,
    );
    // 잘라내기는 정렬 순서를 따르므로 결정적이다.
    expect(Object.keys(normalized)[0]).toBe("section.000");
  });

  it("returns a frozen table so callers cannot mutate the shared value", () => {
    const normalized = normalizeStudioInspectorSectionState({ a: true });
    expect(Object.isFrozen(normalized)).toBe(true);
  });
});

describe("load/save round trip", () => {
  it("round-trips through a storage seam", () => {
    const storage = memoryStorage();
    saveStudioInspectorSectionState(storage, { "tool.symmetry": true });
    expect(
      storage.values.get(STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY),
    ).toBe('{"tool.symmetry":true}');
    expect(loadStudioInspectorSectionState(storage)).toEqual({
      "tool.symmetry": true,
    });
  });

  it("survives malformed and absent payloads without throwing", () => {
    expect(loadStudioInspectorSectionState(null)).toBe(
      EMPTY_STUDIO_INSPECTOR_SECTION_STATE,
    );
    expect(
      loadStudioInspectorSectionState(
        memoryStorage({ [STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY]: "{" }),
      ),
    ).toBe(EMPTY_STUDIO_INSPECTOR_SECTION_STATE);
  });

  it("never lets a blocked storage break the editing session", () => {
    const hostile: StudioInspectorSectionStateStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadStudioInspectorSectionState(hostile)).toBe(
      EMPTY_STUDIO_INSPECTOR_SECTION_STATE,
    );
    expect(() =>
      saveStudioInspectorSectionState(hostile, { a: true }),
    ).not.toThrow();
  });
});

describe("lookup and update", () => {
  it("falls back to the caller default for an unknown id", () => {
    const state = normalizeStudioInspectorSectionState({ known: true });
    expect(isStudioInspectorSectionOpen(state, "known", false)).toBe(true);
    expect(isStudioInspectorSectionOpen(state, "unknown", false)).toBe(false);
    expect(isStudioInspectorSectionOpen(state, "unknown", true)).toBe(true);
  });

  it("returns the same table when nothing changed", () => {
    const state = normalizeStudioInspectorSectionState({ a: true });
    expect(setStudioInspectorSectionOpen(state, "a", true)).toBe(state);
    expect(setStudioInspectorSectionOpen(state, "   ", true)).toBe(state);
    expect(setStudioInspectorSectionOpen(state, "a", false)).not.toBe(state);
  });

  it("records a false explicitly — closed is a choice, not an absence", () => {
    const state = setStudioInspectorSectionOpen(
      EMPTY_STUDIO_INSPECTOR_SECTION_STATE,
      "element.layout",
      false,
    );
    expect(state["element.layout"]).toBe(false);
    // defaultOpen 이 true 인 섹션도 "접어 뒀다"를 기억해야 한다.
    expect(isStudioInspectorSectionOpen(state, "element.layout", true)).toBe(false);
  });
});

describe("browser singleton", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear?.();
    resetStudioInspectorSectionStateCache();
  });

  it("persists a header toggle and reads it back after a remount", () => {
    expect(readStudioInspectorSectionOpen("element.typography", false)).toBe(false);
    writeStudioInspectorSectionOpen("element.typography", true);

    // 섹션 컴포넌트가 언마운트됐다 다시 마운트된 상황.
    resetStudioInspectorSectionStateCache();
    expect(readStudioInspectorSectionOpen("element.typography", false)).toBe(true);
  });

  it("remembers a section that was closed against its own defaultOpen", () => {
    writeStudioInspectorSectionOpen("canvas.surface", false);
    resetStudioInspectorSectionStateCache();
    expect(readStudioInspectorSectionOpen("canvas.surface", true)).toBe(false);
  });

  it("keeps unrelated sections untouched", () => {
    writeStudioInspectorSectionOpen("canvas.resize", true);
    writeStudioInspectorSectionOpen("canvas.style", true);
    writeStudioInspectorSectionOpen("canvas.resize", false);
    resetStudioInspectorSectionStateCache();
    expect(readStudioInspectorSectionOpen("canvas.resize", true)).toBe(false);
    expect(readStudioInspectorSectionOpen("canvas.style", false)).toBe(true);
  });
});
