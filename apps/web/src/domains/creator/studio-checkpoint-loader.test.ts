import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { studioCheckpointKey } from "./studio-checkpoint-loader";
import {
  studioCheckpointKey as durableStudioCheckpointKey,
} from "./studio-checkpoints";

function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("Studio checkpoint lazy product boundary", () => {
  it("keeps the durable SQLite implementation behind a dynamic import", () => {
    const loader = source("./studio-checkpoint-loader.ts");
    // The checkpoint import moved into a host runtime hook when the routes were layered, so the
    // surface spans both files and the specifier is now "../../" rather than "./". Match the
    // module rather than the relative depth — the boundary is which module is imported.
    const page = source("./StudioCuttoonEditorHost.tsx")
      + source("./studio-cuttoon-editor/runtime/useStudioDocumentAccessRuntime.ts");

    expect(loader).toContain('import("./studio-checkpoints")');
    expect(loader).not.toMatch(/from\s+["']\.\/studio-checkpoints["']/u);
    expect(page).toMatch(/from\s+["'][^"']*studio-checkpoint-loader["']/u);
    expect(page).not.toMatch(/from\s+["'][^"']*studio-checkpoints["']/u);
  });

  it.each([
    [{}, "toonspectrum-studio-checkpoints:v12:guest:new"],
    [{ userId: "  artist  ", workId: "work/1" }, null],
    [{ userId: "artist", remixId: "remix 1" }, null],
    [{ userId: "artist", workId: "", remixId: "remix" }, null],
  ] as const)("keeps checkpoint key parity for %j", (input, expected) => {
    const key = studioCheckpointKey(input);
    expect(key).toBe(durableStudioCheckpointKey(input));
    if (expected !== null) expect(key).toBe(expected);
  });
});
