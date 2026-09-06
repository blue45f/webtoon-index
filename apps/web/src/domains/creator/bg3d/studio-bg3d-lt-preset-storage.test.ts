import { describe, expect, it } from "vitest";

import {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
  createStudioBg3dLtUserPreset,
} from "./studio-bg3d-lt-preset-library";
import {
  STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY,
  STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY,
  loadStudioBg3dLtUserPresetsFromStorage,
  saveStudioBg3dLtUserPresetsToStorage,
  type StudioBg3dLtPresetStorage,
} from "./studio-bg3d-lt-preset-storage";
import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
} from "./studio-bg3d-lt-presets";

class MemoryStorage implements StudioBg3dLtPresetStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<readonly [string, string]> = [];
  throwOnRead = false;
  readonly rejectedWriteKeys = new Set<string>();

  getItem(key: string): string | null {
    if (this.throwOnRead) throw new Error("blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.rejectedWriteKeys.has(key)) throw new Error("quota");
    this.values.set(key, value);
    this.writes.push([key, value]);
  }
}

function onePresetJson(): string {
  const source = STUDIO_BG3D_LT_BUILT_IN_PRESETS[0];
  const result = createStudioBg3dLtUserPreset(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, {
    id: "user.storage",
    name: "저장 프리셋",
    description: "저장 어댑터 테스트용 LT 프리셋입니다.",
    line: source.line,
    tone: source.tone,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.canonicalJson;
}

describe("Studio BG3D LT preset storage adapter", () => {
  it("uses explicit versioned primary and quarantine keys", () => {
    expect(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY).toMatch(/\.v1$/u);
    expect(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY).toMatch(/\.v1$/u);
    expect(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY).not.toBe(
      STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY
    );
  });

  it("returns the shared empty payload for a missing key without writing", () => {
    const storage = new MemoryStorage();
    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);

    expect(result).toEqual({
      status: "missing",
      payload: EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      quarantined: false,
      rewritten: false,
    });
    expect(result.payload).toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
    expect(storage.writes).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("loads canonical JSON without rewriting or touching quarantine", () => {
    const storage = new MemoryStorage();
    const canonicalJson = onePresetJson();
    storage.values.set(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, canonicalJson);

    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);
    expect(result.status).toBe("loaded");
    expect(result.payload.presets.map((preset) => preset.id)).toEqual(["user.storage"]);
    expect(result.quarantined).toBe(false);
    expect(result.rewritten).toBe(false);
    expect(storage.writes).toEqual([]);
  });

  it("quarantines corruption before replacing the primary value with canonical empty JSON", () => {
    const storage = new MemoryStorage();
    const corrupt = "{broken-json";
    storage.values.set(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, corrupt);

    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);
    expect(result).toEqual({
      status: "recovered",
      payload: EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      quarantined: true,
      rewritten: true,
    });
    expect(storage.writes).toEqual([
      [STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY, corrupt],
      [STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON],
    ]);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY)).toBe(corrupt);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY)).toBe(
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON
    );
  });

  it("still repairs the primary key when the independent quarantine write is rejected", () => {
    const storage = new MemoryStorage();
    storage.values.set(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, "corrupt");
    storage.rejectedWriteKeys.add(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY);

    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);
    expect(result.status).toBe("recovered");
    expect(result.quarantined).toBe(false);
    expect(result.rewritten).toBe(true);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY)).toBe(
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON
    );
  });

  it("does not duplicate an oversized corrupt value into the bounded quarantine slot", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY,
      "x".repeat(STUDIO_BG3D_LT_PRESET_MAX_BYTES + 1)
    );

    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);
    expect(result).toMatchObject({ status: "recovered", quarantined: false, rewritten: true });
    expect(storage.values.has(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY)).toBe(false);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY)).toBe(
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON
    );
  });

  it("keeps a trusted in-memory recovery result when the primary rewrite also fails", () => {
    const storage = new MemoryStorage();
    storage.values.set(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, "corrupt");
    storage.rejectedWriteKeys.add(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY);

    const result = loadStudioBg3dLtUserPresetsFromStorage(storage);
    expect(result.status).toBe("recovered");
    expect(result.payload).toBe(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
    expect(result.quarantined).toBe(true);
    expect(result.rewritten).toBe(false);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY)).toBe("corrupt");
  });

  it("fails closed when storage reads are unavailable", () => {
    const storage = new MemoryStorage();
    storage.throwOnRead = true;

    expect(loadStudioBg3dLtUserPresetsFromStorage(storage)).toEqual({
      status: "unavailable",
      payload: EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      quarantined: false,
      rewritten: false,
    });
  });

  it("writes only canonical library JSON and catches policy or quota errors", () => {
    const storage = new MemoryStorage();
    const canonicalJson = onePresetJson();

    expect(saveStudioBg3dLtUserPresetsToStorage(storage, canonicalJson)).toBe(true);
    expect(storage.values.get(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY)).toBe(canonicalJson);
    expect(saveStudioBg3dLtUserPresetsToStorage(storage, "{invalid")).toBe(false);
    expect(storage.writes).toHaveLength(1);

    storage.rejectedWriteKeys.add(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY);
    expect(saveStudioBg3dLtUserPresetsToStorage(storage, canonicalJson)).toBe(false);
    expect(storage.writes).toHaveLength(1);
  });
});
