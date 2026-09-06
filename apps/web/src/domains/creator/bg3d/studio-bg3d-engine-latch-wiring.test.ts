import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES } from "./studio-bg3d-engine-selection";

/**
 * Every WebGL-only feature must actually reach the latch.
 *
 * `vrmCharacters` shipped observed-but-never-latched: the view model computed it, the selection
 * policy knew what to do with it, and the hook in between forwarded only `webxr`. Nothing failed —
 * the fence simply never fired, which is the same shape as the MToon brand guard it exists to
 * work around. The unit tests missed it because they call `selectStudioBg3dEngine` and
 * `latchStudioBg3dWebglOnlyFeatures` directly, so both ends passed while the wire between them
 * was cut.
 *
 * The hook reads each field by name on purpose — the caller rebuilds the observed object every
 * render, so forwarding it whole would re-run the effect every render. That trade is what makes a
 * new field easy to forget, so the drift is asserted here instead of trusted.
 */
const runtimeSource = readFileSync(
  new URL("./useStudioBg3dEngineRuntime.ts", import.meta.url),
  "utf8",
);
const viewModelSource = readFileSync(
  new URL("./studio-bg3d-editor-view-model.ts", import.meta.url),
  "utf8",
);

describe("BG3D WebGL-only feature latch wiring", () => {
  it("latches every field the feature type declares", () => {
    const latchCall = runtimeSource.slice(
      runtimeSource.indexOf("latchStudioBg3dWebglOnlyFeatures(current,"),
      runtimeSource.indexOf("}, [observed"),
    );
    expect(latchCall.length).toBeGreaterThan(0);

    for (const field of Object.keys(EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES)) {
      expect(latchCall, `${field} is never handed to the latch`).toContain(`${field}:`);
    }
  });

  it("keeps each observed field in the effect's dependency list", () => {
    // A field read but left out of the deps latches only when some other field happens to change.
    const deps = runtimeSource.slice(
      runtimeSource.indexOf("}, [observed"),
      runtimeSource.indexOf("}, [observed") + 200,
    );
    for (const field of Object.keys(EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES)) {
      const observedName = `observed${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      expect(deps, `${observedName} missing from the effect deps`).toContain(observedName);
    }
  });

  it("has the view model reporting every field the latch expects", () => {
    const observed = viewModelSource.slice(
      viewModelSource.indexOf("observedWebglOnlyFeatures: {"),
      viewModelSource.indexOf("observedWebglOnlyFeatures: {") + 700,
    );
    for (const field of Object.keys(EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES)) {
      expect(observed, `${field} is never observed`).toContain(`${field}:`);
    }
  });
});
