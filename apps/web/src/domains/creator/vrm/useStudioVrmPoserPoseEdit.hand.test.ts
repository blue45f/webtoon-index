import { describe, expect, it, vi } from "vitest";

import { createStudioVrmHandPose } from "./studio-vrm-hand-poses";
import { useStudioVrmPoserPoseEdit } from "./useStudioVrmPoserPoseEdit";

import type { FingerRotationMap } from "./studio-vrm-poser-utils";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";

// Exercise registered hand commands only; the unrelated costume/physics effects
// are intentionally not mounted. Preserve React's other exports for dependencies.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: vi.fn() };
});

function hostFixture({
  initial = {},
  locked = [],
  available,
}: {
  initial?: FingerRotationMap;
  locked?: string[];
  available?: ReadonlySet<string>;
} = {}) {
  let state = { ...initial };
  const setFingerEdits = vi.fn((update: FingerRotationMap | ((previous: FingerRotationMap) => FingerRotationMap)) => {
    state = typeof update === "function" ? update(state) : update;
  });
  const host = {
    vrmRef: {
      current: available
        ? { humanoid: { getNormalizedBoneNode: (bone: string) => available.has(bone) ? {} : null } }
        : null,
    },
    lockedPoseBones: locked,
    jointLimitsEnabled: false,
    setFingerEdits,
  } as unknown as StudioVrmPoserHost;
  useStudioVrmPoserPoseEdit(host);
  return { host, setFingerEdits, read: () => state };
}

describe("poser hand command integration", () => {
  it("preserves the opposite hand while applying all fifteen selected-hand joints", () => {
    const initial = createStudioVrmHandPose("left", "peace");
    const fixture = hostFixture({ initial });
    fixture.host.applyHandPosePreset("right", "holding");
    expect(fixture.read()).toEqual({ ...initial, ...createStudioVrmHandPose("right", "holding") });
  });

  it("keeps locked finger joints rather than replacing them with a preset", () => {
    const initial: FingerRotationMap = { rightIndexProximal: [0.1, 0.2, 0.3] };
    const fixture = hostFixture({ initial, locked: ["rightIndexProximal"] });
    fixture.host.applyHandPosePreset("right", "fist");
    expect(fixture.read().rightIndexProximal).toEqual(initial.rightIndexProximal);
    expect(fixture.read().rightMiddleProximal).toEqual(createStudioVrmHandPose("right", "fist").rightMiddleProximal);
  });

  it("ignores joints unavailable in the currently loaded humanoid", () => {
    const fixture = hostFixture({ available: new Set(["rightIndexProximal", "rightIndexIntermediate"]) });
    fixture.host.applyHandPosePreset("right", "point");
    expect(Object.keys(fixture.read()).sort()).toEqual(["rightIndexIntermediate", "rightIndexProximal"]);
  });

  it("makes no state update when every affected joint is missing or locked", () => {
    const missing = hostFixture({ available: new Set() });
    missing.host.applyHandPosePreset("right", "fist");
    expect(missing.setFingerEdits).not.toHaveBeenCalled();
    const locked = hostFixture({ locked: ["rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal"] });
    locked.host.updateFingerCurl("right", 45, "index");
    expect(locked.setFingerEdits).not.toHaveBeenCalled();
  });

  it("uses functional state updates so consecutive left/right commands do not overwrite each other", () => {
    const fixture = hostFixture();
    fixture.host.applyHandPosePreset("left", "open");
    fixture.host.applyHandPosePreset("right", "penGrip");
    expect(fixture.read()).toEqual({
      ...createStudioVrmHandPose("left", "open"),
      ...createStudioVrmHandPose("right", "penGrip"),
    });
  });

  it("does not leave the previous thumb metacarpal rotation after switching presets", () => {
    const fixture = hostFixture();
    fixture.host.applyHandPosePreset("right", "holding");
    fixture.host.applyHandPosePreset("right", "relaxed");
    expect(fixture.read()).toEqual(createStudioVrmHandPose("right", "relaxed"));
  });

  it("leaves other fingers untouched during a single-finger curl and ignores non-finite input", () => {
    const initial = createStudioVrmHandPose("left", "peace");
    const fixture = hostFixture({ initial });
    fixture.host.updateFingerCurl("left", 35, "index");
    expect(fixture.read().leftMiddleProximal).toEqual(initial.leftMiddleProximal);
    expect(fixture.read().leftThumbMetacarpal).toEqual(initial.leftThumbMetacarpal);
    expect(fixture.read().leftIndexProximal).not.toEqual(initial.leftIndexProximal);
    const before = fixture.read();
    fixture.setFingerEdits.mockClear();
    fixture.host.updateFingerCurl("left", NaN);
    expect(fixture.read()).toBe(before);
    expect(fixture.setFingerEdits).not.toHaveBeenCalled();
  });
});
