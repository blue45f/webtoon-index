import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  listStudioCreatorFilterPresets,
  type StudioCreatorInstalledFilterPreset,
  type StudioCreatorPackStorage,
} from "./studio-creator-filter-preset-reader";

const dialogSource = readFileSync(
  new URL("./filter/StudioFilterDialog.tsx", import.meta.url),
  "utf8",
);
const readerSource = readFileSync(
  new URL("./studio-creator-filter-preset-reader.ts", import.meta.url),
  "utf8",
);

function validPreset(
  index: number,
  overrides: Partial<StudioCreatorInstalledFilterPreset> = {},
): StudioCreatorInstalledFilterPreset {
  return {
    id: `creator-pack:filter-pack:vignette-${index}`,
    packageId: "filter-pack",
    entryId: `vignette-${index}`,
    name: `비네트 ${index}`,
    engine: "vignette",
    values: {
      darkness: 35,
      size: 45,
      roundness: 100,
      feather: 60,
    },
    installedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function storageWith(value: unknown): Pick<StudioCreatorPackStorage, "getItem"> {
  return {
    getItem: (key) =>
      key === STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY
        ? JSON.stringify(value)
        : null,
  };
}

describe("Studio Creator filter preset reader boundary", () => {
  it("keeps the legacy reader out of the V12 product filter dialog", () => {
    expect(dialogSource).not.toContain('from "./studio-creator-filter-preset-reader"');
    expect(dialogSource).toContain('from "./studio-filter-library-sqlite-repository"');
    expect(dialogSource).not.toContain('from "./studio-creator-pack-runtime"');
    expect(readerSource).not.toContain('from "./studio-creator-pack-runtime"');
    expect(readerSource).not.toContain('from "./studio-creator-pack-catalog"');
    expect(readerSource).not.toContain("studio-marketplace-packages");
    expect(readerSource).not.toContain("studio-brush-library");
  });

  it("reads only normalized presets for supported filter engines", () => {
    const presets = listStudioCreatorFilterPresets(storageWith([
      validPreset(1),
      validPreset(2, {
        values: {
          darkness: 999,
          size: 45,
          roundness: 100,
          feather: 60,
        },
      }),
      validPreset(3, {
        values: {
          darkness: 35,
          size: 45,
          roundness: 100,
          feather: 60,
          unexpected: 1,
        },
      }),
      { ...validPreset(4), engine: "unknown-filter" },
    ]));

    expect(presets.map((preset) => preset.id)).toEqual([
      "creator-pack:filter-pack:vignette-1",
    ]);
  });

  it("does not impose a preset-count cap and fails closed for malformed or inaccessible storage", () => {
    const many = Array.from(
      { length: 128 },
      (_, index) => validPreset(index),
    );
    expect(listStudioCreatorFilterPresets(storageWith(many))).toHaveLength(128);
    expect(listStudioCreatorFilterPresets(storageWith({ presets: many }))).toEqual([]);
    expect(listStudioCreatorFilterPresets({
      getItem: () => "{broken",
    })).toEqual([]);
    expect(listStudioCreatorFilterPresets({
      getItem: () => {
        throw new Error("blocked");
      },
    })).toEqual([]);
  });
});
